// Avoidable damage spell IDs for Mythic+ dungeons — Midnight Season 1.
//
// A "hit" counts as avoidable if the player could have moved, interrupted, or
// used a cooldown to prevent it. Ground effects, frontals, and telegraphed AoEs
// are the primary categories.
//
// How to update this list:
//   1. Run the key and look for SPELL_DAMAGE events in WoWCombatLog.txt where
//      your character took damage from a boss/trash ability you dodged (or failed to).
//   2. Cross-reference with Wowhead encounter pages or WarcraftLogs fight breakdowns.
//   3. Add the spellId here under the correct dungeon comment block.
//
// IDs come from SPELL_DAMAGE events: field index 9 (f[9]) in the log line.

export const AVOIDABLE_SPELL_IDS = new Set<number>([

  // ── Skyreach (WoD — recycled) ────────────────────────────────────────────────
  // Ranjit
  160172, // Windwall (ground ring)
  160179, // Four Winds (spinning blades)
  // Araknath
  161228, // Combustion (fire ground)
  // Rukhran
  161407, // Solar Breath (frontal cone)
  161352, // Quills (spread AoE)
  // High Sage Viryx
  160288, // Lens Flare (ground beam)
  160283, // Skydrop (falling bomb)

  // ── Seat of the Triumvirate (Legion — recycled) ──────────────────────────────
  // Zuraal the Ascended
  244751, // Void Slash (frontal)
  // Saprish
  248694, // Ravage (charge)
  // Viceroy Nezhar
  248228, // Dark Squall (swirling void ground)
  // L'ura
  246919, // Collapsing Void (soak/void zone)
  248230, // Void Surge (expanding ring)

  // ── Algeth'ar Academy (Dragonflight — recycled) ──────────────────────────────
  // Overgrown Ancient
  388392, // Lashing Roots (line)
  388456, // Splinterbark (frontal)
  // Echo of Doragosa
  388943, // Arcane Expulsion (expanding ring)
  388960, // Power Field (ground AoE)
  // Crawth
  388722, // Gust (knockback cone)
  // Vexamus
  387923, // Mana Void (falling void zone)
  387967, // Arcane Overload (explosion zone)

  // ── Pit of Saron (WotLK — recycled) ─────────────────────────────────────────
  // Forgemaster Garfrost
  68875,  // Permafrost (ground zone)
  // Ick
  68987,  // Poison Nova (spread)
  69012,  // Pursuit (charge, 2nd target)
  // Scourgelord Tyrannus
  69278,  // Unholy Power (frontal)

  // ── New Midnight dungeons (IDs TBD — add when discovered) ───────────────────
  // Maisara Caverns: TBD
  // Nexus-Point Xenas: TBD
  // Magisters' Terrace: TBD
  // Windrunner Spire: TBD
]);
