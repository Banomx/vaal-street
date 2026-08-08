/* ================================================================
   DELVE DATASET
   ----------------------------------------------------------------
   Three questions the Delve tab answers, and the data each needs:

     "what are fossils worth?"     -> FOSSILS (names + which biome
                                      pool they sit in). Prices come from
                                      the shared GGG/watch/ninja snapshots.
     "which biome do I want?"      -> BIOMES: the common fossil pool,
                                      the exclusive fossil node, and
                                      the depth thresholds that decide
                                      whether the biome spawns at all.
     "what is a delve boss worth?" -> DELVE_BOSSES, in the same drop
                                      group shape src/bossData.js uses,
                                      so src/bossProfit.js prices them
                                      without a second engine.

   Sources
   -------
   Biome fossil pools and boss minimum depths come from poewiki. Current
   biome weights plus encounter tier, weight and minimum depth come from
   PoEDB's data-mined Delve table. Boss drop rates are poewiki's per-monster
   "Estimated drop rates in version 3.25.0, n=100" lists — real sampled
   numbers, not guesses, which is why `rates: "wiki"` here means the same
   confidence `rates: "ledger"` means in bossData.js.

   PoEDB also exposes each encounter's tier, minimum depth and selection
   weight. Every exclusive fossil encounter is tier 4 with weight 100.
   The exact reward-tier curve is not public, so the depth model below is
   explicitly community guidance: a 90% special-node replacement cap at
   depth 1500 and a 15% boss-within-city cap at depth 600. Personal hourly
   figures still come only from a player's saved sample profile.
   ================================================================ */

/* ---------------- biomes ----------------

   `weight` is the data-mined spawn weight surfaced by PoEDB, expressed as
   the two ends of its depth ramp: at `lo.depth` and shallower the weight is
   `lo.weight`, at `hi.depth` and deeper it is `hi.weight`. The documented
   middle is non-linear but its curve is not published, so the engine
   smoothsteps it and the UI says so.

   Mines is the one biome that ramps DOWN (100 early, 0 by depth 52).

   `pool` is the biome's common fossil drop pool. `wall: true` fossils in
   FOSSILS are the ones the wiki flags as sitting behind fractured walls —
   in the pool, but you need to blast for them.

   `exclusive` is the biome-only fossil node: the whole reason to steer
   toward a biome rather than take whatever the mine gives you. */

export const BIOMES = [
  {
    id: "mines", name: "Mines", tone: "#8b7d63", city: false,
    pool: ["Metallic Fossil", "Serrated Fossil", "Pristine Fossil", "Aetheric Fossil"],
    weight: { lo: { depth: 30, weight: 100 }, hi: { depth: 52, weight: 0 } },
    exclusive: null,
    themed: [],
    note: "The starting biome. Gone by depth 52 — nothing to plan around.",
  },
  {
    id: "fungal", name: "Fungal Caverns", tone: "#7fa650", city: false,
    pool: ["Dense Fossil", "Aberrant Fossil", "Opulent Fossil", "Corroded Fossil", "Gilded Fossil"],
    weight: { lo: { depth: 4, weight: 0 }, hi: { depth: 20, weight: 100 } },
    exclusive: { node: "Haunted Tomb", fossil: "Tangled Fossil", minDepth: 35, tier: 4, weight: 100 },
    themed: ["Echoing Lair (beasts)", "Renegade Camp (chaos)", "Restless Rubble (chaos)", "Beast Burrow (minion/aura)", "Necromancer's Excavation (minion/aura)"],
  },
  {
    id: "petrified", name: "Petrified Forest", tone: "#a67f4a", city: false,
    pool: ["Bound Fossil", "Jagged Fossil", "Corroded Fossil", "Sanctified Fossil"],
    weight: { lo: { depth: 4, weight: 0 }, hi: { depth: 20, weight: 100 } },
    exclusive: { node: "Stonewood Hollow", fossil: "Bloodstained Fossil", minDepth: 35, tier: 4, weight: 100 },
    themed: ["Ritual Grounds (talismans)", "Nesting Grounds (physical)", "Grim Copse (minion/aura)"],
  },
  {
    id: "abyssal", name: "Abyssal Depths", tone: "#5f7fb0", city: false,
    pool: ["Aberrant Fossil", "Bound Fossil", "Gilded Fossil", "Lucent Fossil"],
    weight: { lo: { depth: 10, weight: 0 }, hi: { depth: 25, weight: 100 } },
    exclusive: { node: "Crystal Spire", fossil: "Hollow Fossil", minDepth: 35, tier: 4, weight: 100 },
    themed: ["Haunted Remains (abyss)", "Unspeakable Shrine (abyss)", "Haunted Remains (mana/curse)", "Necromancer's Excavation (minion/aura)"],
  },
  {
    id: "frozen", name: "Frozen Hollow", tone: "#6fb4c9", city: false,
    pool: ["Frigid Fossil", "Serrated Fossil", "Prismatic Fossil", "Sanctified Fossil", "Shuddering Fossil"],
    weight: { lo: { depth: 15, weight: 0 }, hi: { depth: 30, weight: 100 } },
    exclusive: { node: "Time-Lost Cavern", fossil: "Glyphic Fossil", minDepth: 35, tier: 4, weight: 100 },
    themed: ["Frigid Recess (essences)", "Mutewind Base (cold)", "Restless Rubble (cold)"],
  },
  {
    id: "magma", name: "Magma Fissure", tone: "#c25f3f", city: false,
    pool: ["Scorched Fossil", "Prismatic Fossil", "Pristine Fossil", "Deft Fossil", "Fundamental Fossil"],
    weight: { lo: { depth: 20, weight: 0 }, hi: { depth: 40, weight: 100 } },
    exclusive: { node: "Molten Cavity", fossil: "Faceted Fossil", minDepth: 35, tier: 4, weight: 100 },
    themed: ["Redblade Base (fire)", "Sweltering Burrow (fire)", "Restless Rubble (fire)"],
  },
  {
    id: "sulphur", name: "Sulphur Vents", tone: "#c9a24b", city: false,
    pool: ["Metallic Fossil", "Opulent Fossil", "Aetheric Fossil", "Fundamental Fossil"],
    weight: { lo: { depth: 35, weight: 0 }, hi: { depth: 55, weight: 100 } },
    exclusive: { node: "Humid Fissure", fossil: "Fractured Fossil", minDepth: 36, tier: 4, weight: 100 },
    themed: ["Brinerot Base (lightning)", "Restless Rubble (lightning)"],
  },
  {
    id: "vaal", name: "Vaal Outpost", tone: "#c96a3f", city: true,
    pool: [],
    weight: { lo: { depth: 32, weight: 0 }, hi: { depth: 63, weight: 23 } },
    exclusive: null,
    themed: ["Ruined Chamber (multiple loot containers)", "The Grand Architect's Temple (Ahuatotli)"],
    boss: "ahuatotli",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
  {
    id: "abyssal-city", name: "Abyssal City", tone: "#7f6ad4", city: true,
    pool: [],
    weight: { lo: { depth: 70, weight: 0 }, hi: { depth: 135, weight: 23 } },
    exclusive: null,
    themed: ["Abyssal Chamber (multiple loot containers)", "The Lich's Tomb (Kurgal)"],
    boss: "kurgal",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
  {
    id: "primeval", name: "Primeval Ruins", tone: "#b06ad4", city: true,
    pool: [],
    weight: { lo: { depth: 110, weight: 0 }, hi: { depth: 200, weight: 17 } },
    exclusive: null,
    themed: ["Primeval Chamber (multiple loot containers)", "The Crystal King's Throne (Aul)"],
    boss: "aul",
    note: "City biome: better loot, more and harder monsters, no fossil pool of its own.",
  },
];

export const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

/* ---------------- fossils ----------------

   Derived from the biome pools above plus the six exclusive nodes, so a
   fossil can never appear here with a biome the biome table disagrees
   with. `wall` marks the three the wiki flags as behind fractured walls:
   they are in the pool, but only if you blow the wall open. */

const WALL_LOCKED = new Set(["Gilded Fossil", "Lucent Fossil", "Sanctified Fossil"]);

function buildFossils() {
  const map = new Map();
  const touch = (name) => {
    if (!map.has(name)) map.set(name, { name, biomes: [], exclusive: null, wall: WALL_LOCKED.has(name) });
    return map.get(name);
  };
  for (const b of BIOMES) {
    for (const f of b.pool) touch(f).biomes.push(b.id);
    if (b.exclusive) {
      const f = touch(b.exclusive.fossil);
      f.biomes.push(b.id);
      f.exclusive = { biome: b.id, node: b.exclusive.node };
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const FOSSILS = buildFossils();
export const FOSSIL_BY_NAME = Object.fromEntries(FOSSILS.map((f) => [f.name, f]));

/* Fossils poe.ninja prices that this dataset does not place in a biome —
   drop sources outside the biome tables (Niko, league content, removed
   biomes). Listed so the price table can still show them instead of
   pretending they don't exist. */
export const UNPLACED_NOTE = "not in any biome pool on the wiki's Delve page";

/* ---------------- nodes ----------------

   The six exclusive entries map a named encounter to its biome-only fossil.
   Generic nodes and caches are priced from low/median/high outcomes in the
   active biome's priced pool. Their quantities come from the active sample
   profile, falling back to GUIDE_SAMPLE category by category. */

export const NODE_KINDS = {
  exclusive: { label: "Biome fossil node", tone: "#c9a24b" },
  generic: { label: "Generic fossil node", tone: "#8fb46a" },
  cache: { label: "Smuggler's cache", tone: "#6fb4c9" },
  chamber: { label: "City chamber", tone: "#b06ad4" },
};

export const NODES = [
  { id: "crystal-spire", name: "Crystal Spire", kind: "exclusive", biome: "abyssal", fossil: "Hollow Fossil" },
  { id: "humid-fissure", name: "Humid Fissure", kind: "exclusive", biome: "sulphur", fossil: "Fractured Fossil" },
  { id: "molten-cavity", name: "Molten Cavity", kind: "exclusive", biome: "magma", fossil: "Faceted Fossil" },
  { id: "time-lost-cavern", name: "Time-Lost Cavern", kind: "exclusive", biome: "frozen", fossil: "Glyphic Fossil" },
  { id: "stonewood-hollow", name: "Stonewood Hollow", kind: "exclusive", biome: "petrified", fossil: "Bloodstained Fossil" },
  { id: "haunted-tomb", name: "Haunted Tomb", kind: "exclusive", biome: "fungal", fossil: "Tangled Fossil" },
  { id: "fossil-node", name: "Fossil node (generic)", kind: "generic", biome: null,
    note: "The unnamed “Contains Fossils” nodes — priced against whichever biome you are standing in." },
  { id: "smugglers-cache", name: "Smuggler's cache", kind: "cache", biome: null,
    note: "Drops a cluster rather than a single fossil, which is what makes it worth the detour." },
];

/* ---------------- sample defaults ----------------

   These are fallbacks for a profile with no observations yet. They are
   deliberately separate from persisted Delve settings: once a player logs
   nodes and fossil totals, the observed averages replace them. */

export const DEFAULTS = {
  depth: 300,
  openWalls: true,
};

/* Working depth model from current deep-Delve community guidance. These are
   kept together so an official curve can replace them without hunting through
   calculation or UI code. Between unlock and cap the engine uses a visible
   linear interpolation; it is an estimate, not a data-mined probability. */
export const COMMUNITY_DEPTH_GUIDE = {
  specialNode: { capDepth: 1500, capChance: 0.90 },
  bossInCity: { capDepth: 600, capChance: 0.15 },
};

/* Working per-node fossil counts, used until the active sample profile has
   enough logged observations to replace them category by category. These are
   current in-play counts rather than figures lifted from a guide. */
export const GUIDE_SAMPLE = {
  exclusiveQty: 1,
  genericQty: 1,
  cacheQty: 4,
};

/* Where each assumption comes from, badged in the UI so a number with a
   source doesn't sit next to one I picked and look equally solid.

     observed   someone counted it and said so out loud. Thin evidence,
                but still evidence.
     placeholder no published count. Kept conservative until a profile has
                 a personal sample.
     personal   calculated from the active profile's logged observations. */
export const SOURCES = {
  datamined: { tag: "data", tone: "ok" },
  observed: { tag: "guide", tone: "ok" },
  placeholder: { tag: "fallback", tone: "warn" },
  personal: { tag: "my sample", tone: "personal" },
};

export const TUNABLES = [
  { key: "exclusiveQty", label: "Special fossils per biome node", group: "Per node", step: 0.5,
    source: "observed",
    help: "One special fossil per targeted node, counted in current play. Older guide write-ups quote more; a logged sample profile replaces this either way." },
  { key: "genericQty", label: "Fossils per generic fossil node", group: "Per node", step: 0.5,
    source: "placeholder",
    help: "No published count. One is the conservative fallback until the active profile has observations." },
  { key: "cacheQty", label: "Fossils per smuggler's cache", group: "Per node", step: 0.5,
    source: "observed",
    help: "About four fossils per cache, counted in current play. One person counting — treat it as a data point, not a rate." },
];

/* ---------------- resonators ---------------- */

export const RESONATOR_ORDER = ["Primitive", "Potent", "Powerful", "Prime"];
export const RESONATOR_SOCKETS = { Primitive: 1, Potent: 2, Powerful: 3, Prime: 4 };

/* ---------------- delve bosses ----------------

   Same shape as src/bossData.js so src/bossProfit.js prices them. Each boss
   has a normal unique pool whose measured shares total 100%, plus cards or
   fragments that roll independently. That distinction does not change EV,
   but it does change the one-kill distribution: a boss always gives one item
   from its normal pool rather than having a fake chance to drop nothing.

   Rates are poewiki's "Estimated drop rates in version 3.25.0, n=100"
   lists. Lines the wiki names as drops but leaves out of the rate list use
   an editable 3% default and carry `unrated: true`, so the estimate is visible
   instead of passing as sampled data.

   No `entry` cost: you don't buy your way into a delve boss, you find
   one. `ttk` is only here because computeBoss wants it; the tab reports
   value per kill plus city-biome share. The separate community depth model
   estimates the boss component per eligible city node; it never changes the
   item drop rates declared below. */

const pool = (drops) => ({ id: "unique", kind: "pool", label: "Unique pool", rolls: 1, displayOrder: "source", drops });
const indep = (drops) => ({ id: "extra", kind: "independent", label: "Additional drops", displayOrder: "source", drops });

export const DELVE_BOSSES = [
  {
    id: "ahuatotli", name: "Ahuatotli, the Blind", biome: "vaal", minDepth: 50,
    node: "The Grand Architect's Temple", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Cerberus Limb", share: 0.60 },
        { item: "Doryani's Machinarium", share: 0.16 },
        { item: "Ahkeli's Mountain", share: 0.08 },
        { item: "Uzaza's Meadow", share: 0.08 },
        { item: "Putembo's Valley", share: 0.08 },
      ]),
      indep([
        { item: "Curiosity", chance: 0.40 },
      ]),
    ],
  },
  {
    id: "kurgal", name: "Kurgal, the Blackblooded", biome: "abyssal-city", minDepth: 90,
    node: "The Lich's Tomb", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 75, overhead: 0,
    groups: [
      pool([
        { key: "command-1", item: "Command of the Pit", label: "Command of the Pit (1 socket)", share: 0.15 },
        { key: "command-2", item: "Command of the Pit", label: "Command of the Pit (2 socket)", share: 0.05 },
        { key: "hale-1", item: "Hale Negator", label: "Hale Negator (1 socket)", share: 0.40 },
        { key: "hale-2", item: "Hale Negator", label: "Hale Negator (2 socket)", share: 0.10 },
        { key: "ahkeli", item: "Ahkeli's Valley", share: 0.10 },
        { key: "uzaza", item: "Uzaza's Mountain", share: 0.10 },
        { key: "putembo", item: "Putembo's Meadow", share: 0.10 },
      ]),
      indep([
        { key: "misery", item: "Misery in Darkness", chance: 0.20 },
        // Preliminary Allflame estimate. The conditional outcome is treated as
        // one of the four Eye variants at equal weight, so the collapsed line
        // uses their live sum divided by four and the UI can reveal each price.
        { key: "zorath", item: "@zorath-eyes", label: "Zorath's Eye",
          chance: 0.50, preliminary: true,
          preliminaryNote: "Preliminary 50% estimate; edit this rate if you have a better sample." },
      ]),
    ],
  },
  {
    id: "aul", name: "Aul, the Crystal King", biome: "primeval", minDepth: 130,
    node: "The Crystal King's Throne", rates: "wiki", sample: "3.25.0, n=100",
    ttk: 90, overhead: 0,
    groups: [
      pool([
        // No aggregate source exposes the unidentified market. poe.watch does
        // expose all 17 identified aura outcomes separately, so use their
        // arithmetic mean and show the complete breakdown in the UI.
        { item: "@auls-uprising", label: "Aul's Uprising", share: 0.61 },
        { item: "Crown of the Tyrant", share: 0.15 },
        { item: "Ahkeli's Meadow", share: 0.08 },
        { item: "Uzaza's Valley", share: 0.08 },
        { item: "Putembo's Mountain", share: 0.08 },
      ]),
      indep([
        { item: "Luminous Trove", chance: 0.16 },
        // A divination card, so GGG's exchange feed can price it. The wiki
        // lists the drop but publishes no rate; use the requested 3% default
        // and keep it visibly marked and editable.
        { item: "Desecrated Virtue", chance: 0.03, unrated: true,
          estimateNote: "No published rate; using an editable 3% default." },
      ]),
    ],
  },
];

export const DELVE_BOSS_BY_ID = Object.fromEntries(DELVE_BOSSES.map((b) => [b.id, b]));

/* Declared prices for names poe.ninja doesn't carry, in the same shape
   bossData.js uses: { "Item": { divine: N, asOf: "YYYY-MM-DD" } }, quoted
   in divine so they track the rate instead of going stale when chaos moves.

   Empty on purpose. Exchange-backed fossils, fragments and cards are priced
   by GGG first; poe.watch and poe.ninja cover the remaining item markets.
   Aul's unidentified amulet has no supported automated market. Its drop line
   instead uses the strict arithmetic mean of all 17 identified aura outcomes
   supplied by poe.watch, with the complete breakdown visible in the UI. */
export const FALLBACKS = {};
