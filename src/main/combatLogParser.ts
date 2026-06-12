import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { AVOIDABLE_SPELL_IDS } from "./avoidableSpells";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CombatStats {
  damageDone:           number;
  healingDone:          number;
  healingEffective:     number;
  damageTaken:          number;
  avoidableDamageTaken: number;
  absorbs:              number;
  interruptCount:       number;
  dispelCount:          number;
  deathCount:           number;
  // Damage TAKEN broken down by enemy spell (spellId → {name, total}). Uploaded so the SITE can
  // sum "avoidable" damage from a server-side curated spell list — no per-spell list on the client.
  damageTakenBySpell:   Map<number, { name: string; total: number }>;
}

export interface LogRun {
  dungeonName:    string;
  mapId:          number;
  keystoneLevel:  number;
  affixIds:       number[];
  startTime:      Date;
  endTime:        Date;
  durationSecs:   number;
  // Combat span (first to last party-combat event), in seconds. This is the WarcraftLogs
  // DPS/HPS denominator — it trims pre-pull / post-final downtime that the keystone timer
  // (durationSecs) includes. Use this for DPS/HPS, durationSecs for the displayed run time.
  combatTimeSecs: number;
  completed:      boolean;
  inTime:         boolean;
  // GUID → player info from COMBATANT_INFO
  combatants:     Map<string, { specId: number; nameRealm: string }>;
  // GUID → combat stats
  stats:          Map<string, CombatStats>;
  // Set when an Augmentation Evoker was in the party (DPS already redistributed)
  augEvokerGuid:  string | null;
}

// ── Path helpers ───────────────────────────────────────────────────────────────

export function getCombatLogPath(wowPath: string): string {
  const logsDir = join(wowPath, "Logs");
  const primary = join(logsDir, "WoWCombatLog.txt");
  if (existsSync(primary)) return primary;

  // WoW creates timestamped files (WoWCombatLog-MMDDYY_HHMMSS.txt) when split logging is on.
  try {
    const candidates = readdirSync(logsDir)
      .filter((f) => f.startsWith("WoWCombatLog") && f.endsWith(".txt"))
      .map((f) => ({ f, mtime: statSync(join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length > 0) return join(logsDir, candidates[0].f);
  } catch { /* logsDir unreadable */ }

  return primary;
}

// ── Timestamp parsing ──────────────────────────────────────────────────────────
// WoW log format: "M/D/YYYY HH:MM:SS.mmm  EVENT_TYPE,..."
// Two spaces separate the timestamp from the payload.
// The year is included since WoW 12.x (was omitted in older versions).

function parseLogTs(s: string): Date | null {
  // Keep the sub-second fraction (e.g. 16:25:51.4512) so the run segment span is exact —
  // dropping it rounds every timestamp to the whole second and skews DPS/HPS ~0.1%.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const ms = m[7] ? Math.round(parseFloat("0." + m[7]) * 1000) : 0;
  return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6], ms);
}

// Augmentation Evoker — spec ID used to detect Aug in the party roster
const AUG_EVOKER_SPEC_ID = 1473;

// Absorb spells that DEFER/mitigate damage but are NOT healing — excluded from HPS,
// mirroring WarcraftLogs. 115069 = Stagger (Brewmaster): it spreads damage into a DoT,
// so counting it as healing massively inflates a Brewmaster's HPS (verified: ~200M on a
// single +19 run). Add other pure-mitigation absorb IDs here if they surface.
const NON_HEALING_ABSORB_IDS = new Set<number>([115069]);

// ── Full run detection from the combat log ─────────────────────────────────────
// Scans the combat log for CHALLENGE_MODE_START/END blocks, builds complete runs
// including party roster from COMBATANT_INFO and combat stats.
// No SavedVariables required — everything comes from the log file.

// Runs longer than 2 hours are impossible in M+; used to safe-skip old START events.
const MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000;

export async function parseRunsFromLog(logPath: string, afterMs = 0): Promise<LogRun[]> {
  const runs: LogRun[] = [];
  if (!existsSync(logPath)) return runs;

  // ── Line-by-line pass ────────────────────────────────────────────────────────
  interface PendingRun {
    dungeonName:   string;
    mapId:         number;
    keystoneLevel: number;
    affixIds:      number[];
    startTime:     Date;
    // First / last party-combat event timestamps (ms) → combat span for DPS/HPS.
    firstCombatMs: number;
    lastCombatMs:  number;
    combatants:    Map<string, { specId: number; nameRealm: string }>;
    stats:         Map<string, CombatStats>;
    // Accumulates *_DAMAGE_SUPPORT amounts: buffedOwnerGUID → supporterGUID → totalDamage.
    // Resolved at CHALLENGE_MODE_END to redistribute Aug Evoker contributions.
    augSupport:    Map<string, Map<string, number>>;
  }

  let pending: PendingRun | null = null;

  // Tracks GUID → "Name-Realm" from any player-sourced combat event
  const guidToNameRealm = new Map<string, string>();

  // Tracks pet/guardian GUID → owner player GUID (for pet damage attribution)
  const petToOwner = new Map<string, string>();

  // WoW 12.x (Midnight) uses advanced combat logging by default.
  // This inserts a 19-field unit-snapshot block after the spell prefix, pushing
  // damage/heal amounts from f[12] to f[31] (spell events) or f[28] (swing events).
  // Detection: if f[12] starts with a GUID prefix → advanced logging is on.
  const GUID_PREFIX = /^(Player|Creature|Pet|Vehicle|Vignette)-/;
  const isAdvancedSpell  = (fields: string[]) => GUID_PREFIX.test(fields[12] ?? "");
  const isAdvancedSwing  = (fields: string[]) => GUID_PREFIX.test(fields[9]  ?? "");

  function getOrCreate(guid: string, stats: Map<string, CombatStats>): CombatStats {
    if (!stats.has(guid)) {
      stats.set(guid, {
        damageDone: 0, healingDone: 0, healingEffective: 0,
        damageTaken: 0, avoidableDamageTaken: 0,
        absorbs: 0, interruptCount: 0, dispelCount: 0, deathCount: 0,
        damageTakenBySpell: new Map(),
      });
    }
    return stats.get(guid)!;
  }

  // Extract "Name-Realm-Region" or "Name-Realm" from the name field in a log line.
  // WoW log format: Player-SERVERID-PLAYERID,"Name-Realm-EU"
  // We strip the trailing region suffix (e.g. "-EU", "-US").
  function extractNameRealm(rawName: string): string {
    // Remove surrounding quotes if present
    const s = rawName.replace(/^"|"$/g, "");
    // Strip known region suffixes: -EU, -US, -KR, -TW, -CN
    return s.replace(/-(?:EU|US|KR|TW|CN)$/i, "");
  }

  await new Promise<void>((resolve) => {
    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const sep = line.indexOf("  ");
      if (sep < 0) return;

      const ts = parseLogTs(line.substring(0, sep));
      if (!ts) return;

      const payload = line.substring(sep + 2);
      const ev = payload.substring(0, payload.indexOf(","));

      // ── CHALLENGE_MODE_START ────────────────────────────────────────────────
      // Format: CHALLENGE_MODE_START,"DungeonName",zoneId,challengeMapId,keystoneLevel,[affixId,affixId,...]
      if (ev === "CHALLENGE_MODE_START") {
        const nameMatch = payload.match(/^CHALLENGE_MODE_START,"([^"]+)",\d+,(\d+),(\d+),\[([^\]]*)\]/);
        if (nameMatch) {
          // Skip runs that started so long ago they must have ended before our watermark.
          // Leaving pending=null causes all intermediate events to be skipped (fast path).
          if (afterMs > 0 && ts.getTime() + MAX_RUN_DURATION_MS < afterMs) {
            return;
          }
          const affixIds = nameMatch[4]
            .split(",")
            .map(Number)
            .filter((n) => n > 0);
          pending = {
            dungeonName:   nameMatch[1],
            mapId:         parseInt(nameMatch[2]),
            keystoneLevel: parseInt(nameMatch[3]),
            affixIds,
            startTime:     ts,
            firstCombatMs: 0,
            lastCombatMs:  0,
            combatants:    new Map(),
            stats:         new Map(),
            augSupport:    new Map(),
          };
          guidToNameRealm.clear();
          // petToOwner is intentionally NOT cleared here: pets summoned before
          // CHALLENGE_MODE_START (e.g. Warlock Felguard) fire SPELL_SUMMON before
          // the run begins and must remain in the map for damage attribution.
        }
        return;
      }

      // ── CHALLENGE_MODE_END ─────────────────────────────────────────────────
      // Format: CHALLENGE_MODE_END,mapId,success,keystoneLevel,elapsedMs,...
      if (ev === "CHALLENGE_MODE_END" && pending) {
        const f = payload.split(",");
        const success  = parseInt(f[2] ?? "0");
        const elapsedMs = parseInt(f[4] ?? "0");
        if (success === 1 && elapsedMs > 0 && (afterMs === 0 || ts.getTime() > afterMs)) {
          const durationSecs = Math.round(elapsedMs / 1000);
          // Cross-reference GUIDs: assign nameRealm to combatants
          for (const [guid, info] of pending.combatants) {
            const nr = guidToNameRealm.get(guid);
            if (nr) info.nameRealm = nr;
          }

          // ── Augmentation Evoker DPS redistribution ───────────────────────────
          // All *_DAMAGE_SUPPORT amounts attributed to the Aug Evoker are subtracted
          // from each buffed player (or pet owner) and added to the Aug.
          // This mirrors WarcraftLogs "Augmented" view — direct contributions only.
          let augGuid: string | null = null;
          for (const [guid, info] of pending.combatants) {
            if (info.specId === AUG_EVOKER_SPEC_ID) { augGuid = guid; break; }
          }

          if (augGuid && pending.augSupport.size > 0) {
            let totalMoved = 0;
            for (const [ownerGuid, supporterMap] of pending.augSupport) {
              const augAmt = supporterMap.get(augGuid) ?? 0;
              if (augAmt <= 0) continue;
              const ownerStats = pending.stats.get(ownerGuid);
              if (!ownerStats) continue;
              const reduction = Math.min(augAmt, ownerStats.damageDone);
              ownerStats.damageDone -= reduction;
              totalMoved += reduction;
            }
            if (totalMoved > 0) {
              getOrCreate(augGuid, pending.stats).damageDone += totalMoved;
            }
          }

          // DPS/HPS denominator. WarcraftLogs divides by the key SEGMENT span
          // (CHALLENGE_MODE_START → END wall-clock), NOT the first→last combat-event span
          // (which starts ~10s late, when the group reaches the first pack) and NOT the
          // keystone timer in durationSecs (which adds death-penalty time). Verified: the
          // segment span equals WCL "Active" to ~0% on a +13 Pit of Saron (1175.6s).
          // Keep sub-second precision — rounding to whole seconds skews DPS ~0.1%.
          const segmentSpanMs  = ts.getTime() - pending.startTime.getTime();
          const combatTimeSecs = segmentSpanMs > 1000
            ? segmentSpanMs / 1000
            : (pending.lastCombatMs > pending.firstCombatMs
                ? (pending.lastCombatMs - pending.firstCombatMs) / 1000
                : durationSecs);

          runs.push({
            dungeonName:   pending.dungeonName,
            mapId:         pending.mapId,
            keystoneLevel: pending.keystoneLevel,
            affixIds:      pending.affixIds,
            startTime:     pending.startTime,
            endTime:       ts,
            durationSecs,
            combatTimeSecs,
            completed:     true,
            inTime:        true,
            combatants:    pending.combatants,
            stats:         pending.stats,
            augEvokerGuid: augGuid,
          });
        }
        pending = null;
        return;
      }

      // ── SPELL_SUMMON — track pet/guardian → owner for damage attribution ──
      // Tracked globally (not just inside pending) so that pets summoned before
      // CHALLENGE_MODE_START (e.g. Warlock Felguard) are captured.
      // Format: SPELL_SUMMON,ownerGUID,ownerName,...,petGUID,...
      if (ev === "SPELL_SUMMON") {
        const f2 = payload.split(",");
        const owner = f2[1] ?? "";
        const pet   = f2[5] ?? "";
        if (owner.startsWith("Player-") && pet && !pet.startsWith("Player-")) {
          petToOwner.set(pet, owner);
        }
        if (!pending) return;
        // fall through to name-tracking below
      }

      // ── COMBATANT_INFO ─────────────────────────────────────────────────────
      // Format: COMBATANT_INFO,GUID,strength,int,agi,stam,str,dodge,parry,block,
      //         critMelee,critRanged,critSpell,speed,lifesteal,hMelee,hRanged,hSpell,
      //         avoidance,mastery,versDmgDone,versHealDone,versDmgTaken,armor,specId,[talents],...
      // specId is always at position 25 (0-indexed), before any nested array.
      if (ev === "COMBATANT_INFO" && pending) {
        const firstBracket = payload.indexOf("[");
        const head = firstBracket > 0 ? payload.substring(0, firstBracket) : payload;
        const f = head.split(",");
        const guid   = f[1] ?? "";
        const specId = parseInt(f[25] ?? "0") || 0;
        if (guid.startsWith("Player-")) {
          pending.combatants.set(guid, { specId, nameRealm: "" });
        }
        return;
      }

      if (!pending) return;

      // ── Track player names from combat events ──────────────────────────────
      // All player-sourced events have: GUID,"Name-Realm-EU" at positions 1,2
      const f  = payload.split(",");
      const src = f[1] ?? "";
      const srcName = f[2] ?? "";
      const dst = f[5] ?? "";
      const dstName = f[6] ?? "";

      if (src.startsWith("Player-") && srcName && !guidToNameRealm.has(src)) {
        guidToNameRealm.set(src, extractNameRealm(srcName));
      }
      if (dst.startsWith("Player-") && dstName && !guidToNameRealm.has(dst)) {
        guidToNameRealm.set(dst, extractNameRealm(dstName));
      }

      // Auto-detect pet → owner from SWING_DAMAGE advanced block.
      // For SWING_DAMAGE (not _LANDED), the advanced unit block describes the ATTACKER:
      //   f[9]  = attacker unit GUID  (matches f[1]/src)
      //   f[10] = attacker owner GUID (player GUID if this is a pet)
      // This catches melee pets (hunter pet, DK ghoul, warlock demon) that were
      // summoned before the log file started and never emitted SPELL_SUMMON.
      if (ev === "SWING_DAMAGE" && !src.startsWith("Player-") && isAdvancedSwing(f)) {
        const ownerGuid = f[10] ?? "";
        if (ownerGuid.startsWith("Player-") && pending.combatants.has(ownerGuid) && !petToOwner.has(src)) {
          petToOwner.set(src, ownerGuid);
        }
      }

      // Auto-detect pet → owner from SPELL_CAST_SUCCESS advanced block, which describes the
      // CASTER: f[12] = caster GUID, f[13] = owner GUID. Catches caster pets (e.g. Shaman
      // elementals, DK gargoyle/magus, mage elemental) whose first action is a cast — the
      // cast precedes their damage, so this maps them before any damage is attributed. Without
      // it, caster-pet damage was dropped (verified: ~15% undercount on some specs vs WCL).
      if (ev === "SPELL_CAST_SUCCESS" && !src.startsWith("Player-") && isAdvancedSpell(f)) {
        const ownerGuid = f[13] ?? "";
        if (ownerGuid.startsWith("Player-") && pending.combatants.has(ownerGuid) && !petToOwner.has(src)) {
          petToOwner.set(src, ownerGuid);
        }
      }

      // Resolve pet → owner so pet damage/healing counts for the player (like WarcraftLogs)
      const resolveOwner = (guid: string) => petToOwner.get(guid) ?? guid;
      const srcResolved = resolveOwner(src);
      const dstResolved = resolveOwner(dst);

      const srcIn = pending.combatants.has(srcResolved);
      const dstIn = pending.combatants.has(dstResolved);
      if (!srcIn && !dstIn) return;

      // Combat span for the DPS/HPS denominator: first→last party damage/heal event.
      if (ev === "SPELL_DAMAGE" || ev === "RANGE_DAMAGE" || ev === "SPELL_PERIODIC_DAMAGE" ||
          ev === "SWING_DAMAGE" || ev === "SPELL_HEAL" || ev === "SPELL_PERIODIC_HEAL") {
        const t = ts.getTime();
        if (pending.firstCombatMs === 0) pending.firstCombatMs = t;
        pending.lastCombatMs = t;
      }

      // ── Combat stats ───────────────────────────────────────────────────────
      switch (ev) {
        case "SPELL_DAMAGE":
        case "RANGE_DAMAGE":
        case "SPELL_PERIODIC_DAMAGE": {
          // f[9] = spellId, f[10] = spell name (quoted). VERIFIED on a real Midnight log:
          //   …,dstFlags(f[7]),dstRaidFlags(f[8]),589(f[9]),"Mot de l'ombre : Douleur"(f[10]),…
          // (589 = Shadow Word: Pain). v1.2.46 wrongly read f[8] (=dstRaidFlags "0x80000000" →
          // parseInt parses the 0x hex → one garbage id for every spell), breaking damageTakenBySpell
          // AND the legacy AVOIDABLE_SPELL_IDS match. Avoidable is computed server-side from
          // damageTakenBySpell, so the real id + name must be captured here. Fixed in v1.2.47.
          const spellId   = parseInt(f[9] ?? "0") || 0;
          const spellName = (f[10] ?? "").replace(/^"|"$/g, "");
          // Advanced logging (WoW 12.x): f[12] is a GUID → 19-field advanced block
          // shifts damage amount from f[12] to f[31].
          const adv = isAdvancedSpell(f);
          const rawAmt   = parseInt(f[adv ? 31 : 12] ?? "0") || 0;
          // Overkill sits 2 fields after the amount (f[33]/f[14]); -1 means "no overkill".
          // WarcraftLogs reports EFFECTIVE damage (HP actually removed), so subtract overkill —
          // otherwise killing blows over-count (worst on tanks cleaving near-dead trash: ~14% vs
          // ~8% on DPS). Validated ±1.5% vs WCL on a +13 Pit of Saron.
          const overkill = parseInt(f[adv ? 33 : 14] ?? "0") || 0;
          const amt = rawAmt - Math.max(0, overkill);
          // Absorbed portion of THIS hit (suffix field: f[37] adv / f[18] non-adv). Details!/WCL
          // count it as damage taken; we only counted the landed amount, reading ~10-25% low. Adding
          // it here (per-spell, tied to the right hit) matches Details! to the integer — verified on a
          // Pit +12. (v1.2.48 tried SPELL_ABSORBED events but f[9] mis-attributed them.)
          const absorbed = parseInt(f[adv ? 37 : 18] ?? "0") || 0;
          if (srcIn && !dstIn) getOrCreate(srcResolved, pending.stats).damageDone += amt;
          else if (srcIn && dstIn && srcResolved !== dstResolved) {
            // Damage to an ALLY (e.g. Tempered in Battle) = negative healing, like WarcraftLogs.
            // Excludes self-damage (src===dst, e.g. Stagger ticks).
            const s = getOrCreate(srcResolved, pending.stats);
            s.healingDone      -= amt;
            s.healingEffective -= amt;
          }
          if (dstIn) {
            const s = getOrCreate(dstResolved, pending.stats);
            const taken = amt + absorbed; // gross damage taken (landed + absorbed), matches Details!/WCL
            s.damageTaken += taken;
            if (spellId && AVOIDABLE_SPELL_IDS.has(spellId)) s.avoidableDamageTaken += taken;
            // Per-spell damage taken from an ENEMY (skip ally cleave / self) → server avoidable calc.
            if (taken > 0 && !srcIn && spellId) {
              const e = s.damageTakenBySpell.get(spellId);
              if (e) e.total += taken;
              else s.damageTakenBySpell.set(spellId, { name: spellName, total: taken });
            }
          }
          break;
        }
        // *_DAMAGE_SUPPORT events: fired for each *_DAMAGE event when an Augmentation
        // Evoker buff (Ebon Might, Breath of Eons, etc.) contributed to the hit.
        // Source = buffed entity (player or pet); last field = supporter GUID (Aug Evoker).
        // Amount at f[31] (spell, advanced) — same position as the base damage event.
        // Accumulated per owner here; redistributed to Aug at CHALLENGE_MODE_END.
        case "SPELL_DAMAGE_SUPPORT":
        case "RANGE_DAMAGE_SUPPORT":
        case "SPELL_PERIODIC_DAMAGE_SUPPORT": {
          if (!srcIn) break;
          const supporter = (f[f.length - 1] ?? "").trim();
          if (!supporter.startsWith("Player-")) break;
          const adv = isAdvancedSpell(f);
          const amt = parseInt(f[adv ? 31 : 12] ?? "0") || 0;
          if (amt <= 0) break;
          const inner = pending.augSupport.get(srcResolved) ?? new Map<string, number>();
          inner.set(supporter, (inner.get(supporter) ?? 0) + amt);
          pending.augSupport.set(srcResolved, inner);
          break;
        }
        case "SWING_DAMAGE_SUPPORT": {
          if (!srcIn) break;
          const supporter = (f[f.length - 1] ?? "").trim();
          if (!supporter.startsWith("Player-")) break;
          const adv = isAdvancedSwing(f);
          const amt = parseInt(f[adv ? 28 : 9] ?? "0") || 0;
          if (amt <= 0) break;
          const inner = pending.augSupport.get(srcResolved) ?? new Map<string, number>();
          inner.set(supporter, (inner.get(supporter) ?? 0) + amt);
          pending.augSupport.set(srcResolved, inner);
          break;
        }
        case "SWING_DAMAGE": {
          // Count only SWING_DAMAGE, NOT SWING_DAMAGE_LANDED — both events fire for the
          // same melee hit (LANDED is the post-application variant); counting both doubles
          // all melee damage. Advanced logging: f[9] is a GUID → amount shifts to f[28].
          const adv = isAdvancedSwing(f);
          const rawAmt   = parseInt(f[adv ? 28 : 9] ?? "0") || 0;
          const overkill = parseInt(f[adv ? 30 : 11] ?? "0") || 0; // overkill = amount index + 2
          const amt = rawAmt - Math.max(0, overkill);
          if (srcIn && !dstIn) getOrCreate(srcResolved, pending.stats).damageDone += amt;
          else if (srcIn && dstIn && srcResolved !== dstResolved) {
            const s = getOrCreate(srcResolved, pending.stats); // friendly-fire = negative healing
            s.healingDone      -= amt;
            s.healingEffective -= amt;
          }
          if (dstIn)           getOrCreate(dstResolved, pending.stats).damageTaken += amt;
          break;
        }
        case "SWING_DAMAGE_LANDED":
          // Same hit as SWING_DAMAGE — skip entirely to avoid double-counting.
          break;
        case "SPELL_HEAL":
        case "SPELL_PERIODIC_HEAL": {
          if (!srcIn) break;
          // WarcraftLogs HPS rule (validated to ±0.7% on a +19): count healing to a PLAYER, or
          // to the CASTER'S OWN pet/guardian/summon — but NOT to *other* players' pets. This is
          // the key nuance: a DPS healing his own ghoul/pet (Death Strike, Leech) IS credited
          // (Rudychlop/Lpke), while a healer's AoE (Chain Heal, Healing Rain, Healing Tide)
          // topping off *teammates'* pets is NOT (that was the Resto Shaman +3.4% over-count —
          // 3.82m of his healing landed on allies' pets). Resolve the raw dst to its owner:
          // own-pet ⇔ dstResolved === srcResolved.
          const healDstIsPlayer = pending.combatants.has(dst);
          if (!healDstIsPlayer && dstResolved !== srcResolved) break;
          // f[31]=heal amount (gross), f[33]=overhealing → effective = amount − overheal.
          const adv  = isAdvancedSpell(f);
          const amt  = parseInt(f[adv ? 31 : 12] ?? "0") || 0;
          const over = parseInt(f[adv ? 33 : 13] ?? "0") || 0;
          const s    = getOrCreate(srcResolved, pending.stats);
          s.healingDone      += amt;
          s.healingEffective += Math.max(0, amt - over);
          break;
        }
        case "SPELL_HEAL_ABSORBED": {
          // Healing the source did that was absorbed by an enemy anti-heal debuff. Added back
          // (SPELL_HEAL counts net of this). Same target rule as SPELL_HEAL: a player, or the
          // caster's own pet/summon — never another player's pet.
          if (!srcIn || (!pending.combatants.has(dst) && dstResolved !== srcResolved)) break;
          const adv = isAdvancedSpell(f);
          const amt = parseInt(f[adv ? 31 : 12] ?? "0") || 0;
          getOrCreate(srcResolved, pending.stats).healingDone      += amt;
          getOrCreate(srcResolved, pending.stats).healingEffective += amt;
          break;
        }
        case "SPELL_INTERRUPT":
          if (srcIn) getOrCreate(srcResolved, pending.stats).interruptCount++;
          break;
        case "SPELL_DISPEL":
        case "SPELL_STOLEN":
          if (srcIn) getOrCreate(srcResolved, pending.stats).dispelCount++;
          break;
        case "SPELL_ABSORBED": {
          // SPELL_ABSORBED layout (with or without the attacker-spell block):
          //   attacker(1-4), victim(5-8), [attackerSpell(9-11)], shieldCaster(GUID,name,flags,raid),
          //   shieldSpellId, shieldSpellName, school, absorbedAmount, totalShield, critical
          // The last 3 fields are always absorbedAmount, totalShield, critical, and the shield
          // caster GUID is 10 fields from the end. Verified against real 12.x logs.
          const absorbed = parseInt(f[f.length - 3] ?? "0") || 0;
          if (absorbed <= 0) break;
          const shieldSpellId = parseInt(f[f.length - 6] ?? "0") || 0;
          if (NON_HEALING_ABSORB_IDS.has(shieldSpellId)) break; // Stagger etc. — not healing
          const shieldCaster = (f[f.length - 10] ?? "").trim();
          const casterResolved = resolveOwner(shieldCaster);
          // NOTE: the absorbed portion of damage TAKEN is added via the SPELL_DAMAGE suffix (f[37]),
          // NOT here — attributing SPELL_ABSORBED by f[9] mis-assigned amounts (v1.2.48 bug). This
          // handler only credits the shield caster's healing + enemy-absorbed damage done.
          if (dstIn || (shieldCaster.startsWith("Player-") && pending.combatants.has(casterResolved))) {
            // Defensive absorb protecting a party member → credit the shield caster's healing.
            // WarcraftLogs counts absorbed (prevented) damage as effective healing.
            if (pending.combatants.has(casterResolved)) {
              const s = getOrCreate(casterResolved, pending.stats);
              s.healingDone      += absorbed;
              s.healingEffective += absorbed;
              s.absorbs          += absorbed;
            }
          } else if (srcIn) {
            // A party member's outgoing damage was absorbed by an enemy shield →
            // WarcraftLogs counts this as damage done.
            getOrCreate(srcResolved, pending.stats).damageDone += absorbed;
          }
          break;
        }
        case "UNIT_DIED":
          // Use raw dst (not dstResolved) — pet deaths must not count as player deaths
          if (pending.combatants.has(dst)) getOrCreate(dst, pending.stats).deathCount++;
          break;
      }
    });

    rl.on("close", resolve);
    rl.on("error", () => resolve());
  });

  return runs;
}

// ── Legacy per-GUID stats parser (kept for backward compat) ───────────────────
// Used when SavedVariables already has the run metadata and we just need stats.
export async function parseCombatLog(
  logPath: string,
  runStart: Date,
  durationSecs: number,
  partyGuids: Set<string>
): Promise<Map<string, CombatStats>> {
  const result = new Map<string, CombatStats>();
  if (!partyGuids.size || !existsSync(logPath)) return result;

  const windowStart = new Date(runStart.getTime() - 30_000);
  const windowEnd   = new Date(runStart.getTime() + (durationSecs + 30) * 1_000);

  function getOrCreate(guid: string): CombatStats {
    if (!result.has(guid)) {
      result.set(guid, {
        damageDone: 0, healingDone: 0, healingEffective: 0,
        damageTaken: 0, avoidableDamageTaken: 0,
        absorbs: 0, interruptCount: 0, dispelCount: 0, deathCount: 0,
        damageTakenBySpell: new Map(),
      });
    }
    return result.get(guid)!;
  }

  await new Promise<void>((resolve) => {
    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    let pastEnd = false;

    rl.on("line", (line) => {
      if (pastEnd) { rl.close(); return; }

      const sep = line.indexOf("  ");
      if (sep < 0) return;

      const ts = parseLogTs(line.substring(0, sep));
      if (!ts) return;

      if (ts < windowStart) return;
      if (ts > windowEnd) { pastEnd = true; rl.close(); return; }

      const f  = line.substring(sep + 2).split(",");
      if (f.length < 6) return;

      const ev  = f[0];
      const src = f[1];
      const dst = f[5];

      const srcIn = partyGuids.has(src);
      const dstIn = partyGuids.has(dst);
      if (!srcIn && !dstIn) return;

      switch (ev) {
        case "SPELL_DAMAGE":
        case "RANGE_DAMAGE":
        case "SPELL_PERIODIC_DAMAGE": {
          const spellId = parseInt(f[9] ?? "0") || 0;
          const amt     = parseInt(f[12] ?? "0") || 0;
          if (srcIn && !dstIn) getOrCreate(src).damageDone += amt;
          if (dstIn) {
            const s = getOrCreate(dst);
            s.damageTaken += amt;
            if (spellId && AVOIDABLE_SPELL_IDS.has(spellId)) s.avoidableDamageTaken += amt;
          }
          break;
        }
        case "SWING_DAMAGE":
        case "SWING_DAMAGE_LANDED": {
          const amt = parseInt(f[9] ?? "0") || 0;
          if (srcIn && !dstIn) getOrCreate(src).damageDone += amt;
          if (dstIn)           getOrCreate(dst).damageTaken += amt;
          break;
        }
        case "SPELL_HEAL":
        case "SPELL_PERIODIC_HEAL": {
          if (!srcIn) break;
          const amt  = parseInt(f[12] ?? "0") || 0;
          const over = parseInt(f[13] ?? "0") || 0;
          const s    = getOrCreate(src);
          s.healingDone      += amt;
          s.healingEffective += Math.max(0, amt - over);
          break;
        }
        case "SPELL_HEAL_ABSORBED": {
          if (!srcIn) break;
          const amt = parseInt(f[12] ?? "0") || 0;
          getOrCreate(src).healingDone      += amt;
          getOrCreate(src).healingEffective += amt;
          break;
        }
        case "SPELL_INTERRUPT":
          if (srcIn) getOrCreate(src).interruptCount++;
          break;
        case "SPELL_DISPEL":
        case "SPELL_STOLEN":
          if (srcIn) getOrCreate(src).dispelCount++;
          break;
        case "SPELL_ABSORBED": {
          const isGuid = (s: string) => s.startsWith("0x") || /^[A-Za-z]+-\d+-[0-9A-Fa-f]+$/.test(s);
          let caster: string | undefined;
          let absAmt = 0;
          if (f.length >= 20 && isGuid(f[12] ?? "")) {
            caster = f[12]; absAmt = parseInt(f[19] ?? "0") || 0;
          } else if (f.length >= 17 && isGuid(f[9] ?? "")) {
            caster = f[9];  absAmt = parseInt(f[16] ?? "0") || 0;
          }
          if (caster && partyGuids.has(caster)) getOrCreate(caster).absorbs += absAmt;
          break;
        }
        case "UNIT_DIED":
          if (dstIn) getOrCreate(dst).deathCount++;
          break;
      }
    });

    rl.on("close", resolve);
    rl.on("error", () => resolve());
  });

  return result;
}
