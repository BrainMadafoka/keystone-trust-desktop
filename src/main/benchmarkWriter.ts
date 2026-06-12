import { writeFileSync } from "fs";
import { join } from "path";

export interface DungeonEntry {
  name: string;
  level: number;
  rank:   string | null;
  topPct: number | null;
  dps: number;
  hps: number;
  kicks: number;
  deaths: number;
}

export interface PlayerBenchmark {
  roles: {
    DPS?:    DungeonEntry[];
    HEALER?: DungeonEntry[];
    TANK?:   DungeonEntry[];
  };
}

function escapeLua(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Fixed dungeon order — must match KT_DNG written in the benchmark file header.
const DUNGEON_NAMES = [
  "Algeth'ar Academy", "Magisters' Terrace", "Maisara Caverns", "Nexus-Point Xenas",
  "Pit of Saron",      "Seat of the Triumvirate", "Skyreach",   "Windrunner Spire",
];
const DUNGEON_INDEX = new Map(DUNGEON_NAMES.map((n, i) => [n.toLowerCase(), i + 1]));

function getDungeonIndex(name: string): number {
  return DUNGEON_INDEX.get(name.toLowerCase())
      ?? DUNGEON_INDEX.get(name.toLowerCase().replace(/^the\s+/i, ""))
      ?? 0;
}

// ─── v5 format — realm-bucketed base62 blobs ──────────────────────────────────
// Designed to scale to ~1M profiles. Two compounding wins over a flat Lua table:
//
//  1. NO per-profile hash node / string header. Profiles are concatenated into one
//     big string PER REALM (~250-2000 strings total) instead of N interned strings
//     in an N-entry hash. Lookup = string.find within the player's realm blob
//     (C-fast, sub-ms even for a 5k-player realm).
//  2. Dense payload: every field base62-encoded (1 char: dungeon idx, level, rank
//     code, kicks, deaths; 2 chars: perf in THOUSANDS — the tooltip only shows
//     "207k" so the low digits are dead weight). No separators inside a payload.
//
// File globals:
//   KT_DNG   = {dungeon names}            (idx → name)
//   KT_RANK  = {rank strings}             (code → name, 0 = no rank)
//   KT_REALM = {["realm-slug"]=blobIndex} (realm → position in KT_DB)
//   KT_DB    = {"<blob1>", "<blob2>", …}  (one blob per realm)
//   KT_COUNT = total profiles
//
// Blob layout (names lowercase, sorted, leading "\n" so every record is "\nname\t"):
//   "\n<name>\t<payload>\n<name>\t<payload>…"
//   payload = b62(role) .. repeat[ b62(idx) b62(lvl) b62(rankcode) b62x2(perf/1000) b62x2(kicks) b62(deaths) ]
//   (per-dungeon block = 8 chars; kicks needs 2 because some keys log >61 interrupts)
//   role: 1 DPS · 2 HEALER · 3 TANK
//
// Keys are kept VERBATIM (the input map is already unique-keyed). We must NOT
// lowercase/dedup them: the server emits deliberate aliases that the addon relies on
// — a realm-compact alias ("khaz-modan" ⇄ "khazmodan", LFG tooltips drop separators)
// and an original-case alias for non-ASCII names (Lua's string.lower can't lowercase
// Cyrillic/accented letters, so the addon searches the name as-is). Realm slug = the
// realm part of the "name-realm" key (name = up to the first "-", since WoW names never
// contain "-"); it already matches the addon's NormalizeRealm output.
//
// IMPORTANT: this encoding MUST stay byte-identical to the server's serializeLua() in
// src/app/api/addon/all-benchmarks/route.ts (the daily addon release fetches the .lua
// from there). Change both together.
// Loose realm key — MUST match looseRealmKey() in src/lib/realm-aliases.ts and LooseRealm() in
// the addon: ASCII-only lowercase + strip separators; non-ASCII (Cyrillic/CJK) kept verbatim.
const looseKey = (s: string): string => (s ?? "").replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[ \-.'()]/g, "");

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const b1 = (n: number): string => B62[Math.max(0, Math.min(61, Math.round(n)))];
const b2 = (n: number): string => {
  const v = Math.max(0, Math.min(3843, Math.round(n)));
  return B62[Math.floor(v / 62)] + B62[v % 62];
};

export function writeBenchmarkLua(
  wowPath: string,
  _accountName: string,
  benchmarks: Record<string, PlayerBenchmark>,
  aliasLK: Record<string, string> = {}
): void {
  const filePath = join(
    wowPath, "Interface", "AddOns", "KeystoneTrust", "KeystoneTrustBenchmarks.lua"
  );

  // Rank → 1-based code (first-seen order), emitted as KT_RANK. 0 = no rank.
  const rankCode = new Map<string, number>();
  const rankList: string[] = [];
  const codeFor = (rank: string | null): number => {
    if (!rank) return 0;
    let c = rankCode.get(rank);
    if (c === undefined) { rankList.push(rank); c = rankList.length; rankCode.set(rank, c); }
    return c;
  };

  // Group profiles by realm (keys kept verbatim — see header note on aliases).
  const realms = new Map<string, { name: string; payload: string }[]>();
  let count = 0;

  for (const [nameRealm, data] of Object.entries(benchmarks)) {
    const dash = nameRealm.indexOf("-");
    if (dash <= 0 || dash >= nameRealm.length - 1) continue; // need both name and realm
    const name  = nameRealm.slice(0, dash);
    const realm = nameRealm.slice(dash + 1);

    const dpsEntries    = data.roles.DPS    ?? [];
    const healerEntries = data.roles.HEALER ?? [];
    const tankEntries   = data.roles.TANK   ?? [];

    let role: number;
    let entries: DungeonEntry[];
    let isHealer: boolean;
    if (healerEntries.length > 0)    { role = 2; entries = healerEntries; isHealer = true;  }
    else if (tankEntries.length > 0) { role = 3; entries = tankEntries;   isHealer = false; }
    else                             { role = 1; entries = dpsEntries;    isHealer = false; }
    if (entries.length === 0) continue;

    let payload = b1(role);
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const d of sorted) {
      const perfK = (isHealer ? d.hps : d.dps) / 1000;
      payload += b1(getDungeonIndex(d.name)) + b1(d.level) + b1(codeFor(d.rank))
               + b2(perfK) + b2(d.kicks) + b1(d.deaths);
    }

    let arr = realms.get(realm);
    if (!arr) { arr = []; realms.set(realm, arr); }
    arr.push({ name, payload });
    count++;
  }

  // Assign realm blob indices (sorted for determinism) + build blobs.
  const realmSlugs = [...realms.keys()].sort();
  const present = new Set(realmSlugs);
  const realmIndexLines: string[] = [];
  const dbLines: string[] = [];
  realmSlugs.forEach((realm, i) => {
    realmIndexLines.push(`["${escapeLua(realm)}"]=${i + 1}`);
    const players = realms.get(realm)!.sort((a, b) => a.name.localeCompare(b.name));
    // Emit \n and \t as escape sequences so the Lua string literal stays single-line.
    const blob = players.map(p => `\\n${escapeLua(p.name)}\\t${p.payload}`).join("");
    dbLines.push(`"${blob}",`);
  });

  // KT_REALM_ALIAS: looseKey → canonical bucket slug (addon fallback when NormalizeRealm misses).
  // (1) every present bucket's own slug → keeps LFG CamelCase/separator matching after the merge;
  // (2) Blizzard localized (Cyrillic/CJK) names that can't be derived from the en_US slug.
  const aliasMap = new Map<string, string>();
  for (const c of realmSlugs) { const lk = looseKey(c); if (lk && lk !== c) aliasMap.set(lk, c); }
  for (const [lk, canon] of Object.entries(aliasLK)) { if (present.has(canon)) aliasMap.set(lk, canon); }
  const aliasLines = [...aliasMap].map(([lk, canon]) => `["${escapeLua(lk)}"]="${escapeLua(canon)}"`);

  const lines: string[] = [
    "-- Keystone Trust — données téléchargées depuis wowkeystonetrust.com",
    `-- Mis à jour le : ${new Date().toISOString()}`,
    "-- Format v5 (blobs par royaume, base62, décodage paresseux) — mémoire minimale",
    `KT_DNG={${DUNGEON_NAMES.map(n => `"${escapeLua(n)}"`).join(",")}}`,
    `KT_RANK={${rankList.map(r => `"${escapeLua(r)}"`).join(",")}}`,
    `KT_REALM={${realmIndexLines.join(",")}}`,
    `KT_REALM_ALIAS={${aliasLines.join(",")}}`,
    `KT_COUNT=${count}`,
    "KT_DB={",
    ...dbLines,
    "}",
  ];

  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}
