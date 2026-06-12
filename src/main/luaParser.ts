// Parses WoW SavedVariables Lua table format into a JavaScript object.
// Handles: string keys ["key"], array entries, strings, numbers, booleans, nested tables.

type LuaValue = string | number | boolean | null | LuaTable;
type LuaTable = { [key: string]: LuaValue } | LuaValue[];

function isArrayTable(obj: { [key: string]: LuaValue }): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return true;
  return keys.every((k, i) => k === String(i + 1));
}

class LuaParser {
  private src: string;
  private pos: number = 0;

  constructor(src: string) {
    this.src = src;
  }

  private peek(): string { return this.src[this.pos] ?? ""; }
  private consume(): string { return this.src[this.pos++] ?? ""; }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.src.length) {
      if (/\s/.test(this.peek())) { this.consume(); continue; }
      if (this.src.startsWith("--", this.pos)) {
        while (this.pos < this.src.length && this.peek() !== "\n") this.consume();
        continue;
      }
      break;
    }
  }

  private parseString(): string {
    const quote = this.consume();
    let result = "";
    while (this.pos < this.src.length && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.consume();
        const esc = this.consume();
        result += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
      } else {
        result += this.consume();
      }
    }
    this.consume();
    return result;
  }

  private parseLongString(): string {
    this.consume(); // [
    let level = 0;
    while (this.peek() === "=") { this.consume(); level++; }
    this.consume(); // [
    const closing = "]" + "=".repeat(level) + "]";
    let result = "";
    while (this.pos < this.src.length) {
      if (this.src.startsWith(closing, this.pos)) {
        this.pos += closing.length;
        break;
      }
      result += this.consume();
    }
    return result;
  }

  private parseNumber(): number {
    let s = "";
    if (this.peek() === "-") s += this.consume();
    while (/[\d.eE+\-x]/.test(this.peek())) s += this.consume();
    return Number(s);
  }

  private parseValue(): LuaValue {
    this.skipWhitespaceAndComments();
    const ch = this.peek();

    if (ch === "{") return this.parseTable();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === "[" && this.src[this.pos + 1] === "[") return this.parseLongString();
    if (ch === "-" || /\d/.test(ch)) return this.parseNumber();

    if (this.src.startsWith("true", this.pos))  { this.pos += 4; return true; }
    if (this.src.startsWith("false", this.pos)) { this.pos += 5; return false; }
    if (this.src.startsWith("nil", this.pos))   { this.pos += 3; return null; }

    return null;
  }

  private parseTable(): LuaTable {
    this.consume(); // {
    const obj: { [key: string]: LuaValue } = {};
    let arrayIdx = 1;

    while (true) {
      this.skipWhitespaceAndComments();
      if (this.peek() === "}") { this.consume(); break; }
      if (this.peek() === ",") { this.consume(); continue; }

      if (this.peek() === "[") {
        this.consume(); // [
        this.skipWhitespaceAndComments();
        let key: string;
        if (this.peek() === '"' || this.peek() === "'") {
          key = this.parseString();
        } else {
          key = String(this.parseNumber());
        }
        this.skipWhitespaceAndComments();
        this.consume(); // ]
        this.skipWhitespaceAndComments();
        this.consume(); // =
        const val = this.parseValue();
        obj[key] = val;
      } else if (/[a-zA-Z_]/.test(this.peek())) {
        let key = "";
        while (/[a-zA-Z0-9_]/.test(this.peek())) key += this.consume();
        this.skipWhitespaceAndComments();
        this.consume(); // =
        const val = this.parseValue();
        obj[key] = val;
      } else {
        const val = this.parseValue();
        if (val !== null) obj[String(arrayIdx++)] = val;
      }

      this.skipWhitespaceAndComments();
      if (this.peek() === ",") this.consume();
    }

    if (isArrayTable(obj)) {
      return Object.values(obj);
    }
    return obj;
  }

  parse(): LuaTable | null {
    try {
      this.skipWhitespaceAndComments();
      return this.parseTable();
    } catch {
      return null;
    }
  }
}

// ── Localization normalization ────────────────────────────────────────────────
// WoW spec IDs are locale-independent; spec names from GetSpecializationInfo()
// are localized. We use the ID for accurate English name lookup when available,
// and fall back to a French→English text map for legacy/pre-fix runs.

const SPEC_ID_TO_ENGLISH: Record<number, string> = {
  // Death Knight
  250: "Blood", 251: "Frost", 252: "Unholy",
  // Demon Hunter
  577: "Havoc", 581: "Vengeance",
  // Druid
  102: "Balance", 103: "Feral", 104: "Guardian", 105: "Restoration",
  // Evoker
  1467: "Devastation", 1468: "Preservation", 1473: "Augmentation",
  // Hunter
  253: "Beast Mastery", 254: "Marksmanship", 255: "Survival",
  // Mage
  62: "Arcane", 63: "Fire", 64: "Frost",
  // Monk
  268: "Brewmaster", 269: "Windwalker", 270: "Mistweaver",
  // Paladin
  65: "Holy", 66: "Protection", 70: "Retribution",
  // Priest
  256: "Discipline", 257: "Holy", 258: "Shadow",
  // Rogue
  259: "Assassination", 260: "Outlaw", 261: "Subtlety",
  // Shaman
  262: "Elemental", 263: "Enhancement", 264: "Restoration",
  // Warlock
  265: "Affliction", 266: "Demonology", 267: "Destruction",
  // Warrior
  71: "Arms", 72: "Fury", 73: "Protection",
};

// French WoW spec names → English. Ambiguous names (Givre=Frost Mage or DK,
// Sacré=Holy Pala or Priest, Restauration=Druid or Shaman) all map to the same
// English name so role detection remains correct even without specId.
const FR_SPEC_TO_ENGLISH: Record<string, string> = {
  // Mage
  "arcanes": "Arcane",
  "feu": "Fire",
  "givre": "Frost",
  // Death Knight
  "sang": "Blood",
  "impie": "Unholy",
  // Demon Hunter (Havoc in French is "Dévastation", same word as Evoker Devastation
  // but disambiguated by specId when available)
  "dévastation": "Devastation",
  "vengeance": "Vengeance",
  // Druid
  "équilibre": "Balance",
  "farouche": "Feral",
  "gardien": "Guardian",
  "restauration": "Restoration",
  // Evoker
  "préservation": "Preservation",
  "augmentation": "Augmentation",
  // Hunter
  "maîtrise des bêtes": "Beast Mastery",
  "précision": "Marksmanship",
  "survie": "Survival",
  // Monk
  "brasseur": "Brewmaster",
  "tissevent": "Mistweaver",
  "nuage de jade": "Windwalker",
  // Paladin
  "sacré": "Holy",
  "protection": "Protection",
  "vindicte": "Retribution",
  // Priest
  "discipline": "Discipline",
  "ombre": "Shadow",
  // Rogue
  "assassinat": "Assassination",
  "hors-la-loi": "Outlaw",
  "finesse": "Subtlety",
  // Shaman
  "élémentaire": "Elemental",
  "amélioration": "Enhancement",
  // Warlock
  "affliction": "Affliction",
  "démonologie": "Demonology",
  "destruction": "Destruction",
  // Warrior
  "armes": "Arms",
  "furie": "Fury",
  "fureur": "Fury",
};

// ChallengeMode mapID → canonical English dungeon name.
// Source of truth: C_ChallengeMode.GetActiveChallengeMapID() is locale-independent.
// Add new IDs as dungeons are confirmed in-game.
const DUNGEON_ID_TO_ENGLISH: Record<number, string> = {
  161: "Skyreach",
  239: "Seat of the Triumvirate",
  402: "Algeth'ar Academy",
  556: "Pit of Saron",
  557: "Windrunner Spire",
  558: "Magisters' Terrace",
  559: "Nexus-Point Xenas",
  560: "Maisara Caverns",
};

// Only runs in the current M+ season are uploaded and shown in the addon.
export const CURRENT_SEASON_DUNGEONS = new Set([
  "Algeth'ar Academy",
  "Magisters' Terrace",
  "Maisara Caverns",
  "Nexus-Point Xenas",
  "Pit of Saron",
  "Seat of the Triumvirate",
  "Skyreach",
  "Windrunner Spire",
]);

const SPEC_ID_TO_CLASS: Record<number, string> = {
  250:"DEATHKNIGHT",251:"DEATHKNIGHT",252:"DEATHKNIGHT",
  577:"DEMONHUNTER",581:"DEMONHUNTER",
  102:"DRUID",103:"DRUID",104:"DRUID",105:"DRUID",
  1467:"EVOKER",1468:"EVOKER",1473:"EVOKER",
  253:"HUNTER",254:"HUNTER",255:"HUNTER",
  62:"MAGE",63:"MAGE",64:"MAGE",
  268:"MONK",269:"MONK",270:"MONK",
  65:"PALADIN",66:"PALADIN",70:"PALADIN",
  256:"PRIEST",257:"PRIEST",258:"PRIEST",
  259:"ROGUE",260:"ROGUE",261:"ROGUE",
  262:"SHAMAN",263:"SHAMAN",264:"SHAMAN",
  265:"WARLOCK",266:"WARLOCK",267:"WARLOCK",
  71:"WARRIOR",72:"WARRIOR",73:"WARRIOR",
};

const SPEC_ID_TO_ROLE: Record<number, string> = {
  // Tanks
  250:"TANK",581:"TANK",104:"TANK",268:"TANK",66:"TANK",73:"TANK",
  // Healers
  105:"HEALER",1468:"HEALER",270:"HEALER",65:"HEALER",256:"HEALER",257:"HEALER",264:"HEALER",
  // DPS (everything else defaults to DPS)
};

export function specIdToClass(specId: number): string {
  return SPEC_ID_TO_CLASS[specId] ?? "UNKNOWN";
}
export function specIdToRole(specId: number): string {
  return SPEC_ID_TO_ROLE[specId] ?? "DPS";
}

export function normalizeSpecName(spec: string, specId?: number): string {
  // Prefer ID-based lookup (locale-independent)
  if (specId && specId > 0) {
    const english = SPEC_ID_TO_ENGLISH[specId];
    if (english) return english;
  }
  // Fall back to French→English text map
  if (spec) {
    const lower = spec.toLowerCase().trim();
    const mapped = FR_SPEC_TO_ENGLISH[lower];
    if (mapped) return mapped;
  }
  // Already English or unknown — return as-is
  return spec;
}

export function normalizeDungeonName(name: string, dungeonId?: number): string {
  if (dungeonId && dungeonId > 0) {
    const english = DUNGEON_ID_TO_ENGLISH[dungeonId];
    if (english) return english;
  }
  return name;
}

export interface KTRun {
  id: string;
  addonVersion?: string;
  playerName: string;
  realm: string;
  region: string;
  wowClass: string;
  spec: string;
  specId?: number;
  role: string;
  ilvl?: number;
  dungeonId?: number;
  dungeonName: string;
  keystoneLevel: number;
  affixes: string[];
  completed: boolean;
  inTime: boolean;
  durationSecs?: number;
  timeLimitSecs?: number;
  runDate: string;
  party: KTPlayerData[];
}

export interface KTPlayerData {
  name: string;
  realm?: string;
  guid?: string;
  class?: string;
  spec?: string;
  specId?: number;
  role?: string;
  ilvl?: number;
  damageDoneTotal?: number;
  healingDoneTotal?: number;
  healingDoneEffective?: number;
  damageTakenTotal?: number;
  damageTakenAvoidable?: number;
  interrupts?: unknown[];
  dispels?: unknown[];
  deaths?: unknown[];
  crowdControls?: unknown[];
}

export interface KTSavedVars {
  runs: Record<string, KTRun>;
  pendingUploads: Record<string, boolean>;
}

export function readPlayerFromSavedVars(wowPath: string, accountName: string): { playerName: string; realm: string; region: string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("path") as typeof import("path");
    const luaPath = join(wowPath, "WTF", "Account", accountName, "SavedVariables", "KeystoneTrust.lua");
    const content = readFileSync(luaPath, "utf8");
    const vars = parseSavedVars(content);
    if (!vars || !Object.keys(vars.runs).length) return null;
    const runs = Object.values(vars.runs);
    const latest = runs.reduce((a, b) => new Date(a.runDate) >= new Date(b.runDate) ? a : b);
    if (!latest.playerName || !latest.realm) return null;
    return { playerName: latest.playerName, realm: latest.realm, region: latest.region || "eu" };
  } catch { return null; }
}

export function parseSavedVars(fileContent: string): KTSavedVars | null {
  const match = fileContent.match(/KeystoneTrustDB\s*=\s*(\{[\s\S]*\})\s*$/);
  if (!match) return null;

  const parser = new LuaParser(match[1]);
  const raw = parser.parse() as Record<string, unknown> | null;
  if (!raw) return null;

  const runs: Record<string, KTRun> = {};
  const rawRuns = raw["runs"] as Record<string, unknown> ?? {};

  for (const [id, runRaw] of Object.entries(rawRuns)) {
    const r = runRaw as Record<string, unknown>;
    runs[id] = {
      id,
      addonVersion:  r["addonVersion"]  as string | undefined,
      playerName:    r["playerName"]    as string ?? "",
      realm:         r["realm"]         as string ?? "",
      region:        r["region"]        as string ?? "eu",
      wowClass:      r["wowClass"]      as string ?? "",
      spec:          r["spec"]          as string ?? "",
      specId:        r["specId"]        as number | undefined,
      role:          r["role"]          as string ?? "",
      ilvl:          r["ilvl"]          as number | undefined,
      dungeonId:     r["dungeonId"]     as number | undefined,
      dungeonName:   r["dungeonName"]   as string ?? "",
      keystoneLevel: r["keystoneLevel"] as number ?? 0,
      affixes:       (r["affixes"] as string[] | undefined) ?? [],
      completed:     r["completed"]     as boolean ?? false,
      inTime:        r["inTime"]        as boolean ?? false,
      durationSecs:  r["durationSecs"]  as number | undefined,
      timeLimitSecs: r["timeLimitSecs"] as number | undefined,
      runDate:       r["runDate"]       as string ?? new Date().toISOString(),
      party:         (r["party"] as KTPlayerData[] | undefined) ?? [],
    };
  }

  const pendingUploads = (raw["pendingUploads"] as Record<string, boolean> | undefined) ?? {};

  return { runs, pendingUploads };
}

