/* ================================================================
   BOSS PROFITABILITY DATASET
   ----------------------------------------------------------------
   A boss is: what it costs to open, what it drops, and how long a run
   takes. Profit/hr falls out of that.

   Drops are split into GROUPS because they don't all roll the same way:

     kind: "pool"        one guaranteed drop picked from the group.
                         Each line has a `share` (they sum to ~1).
                         Covers both the unique pool and the guaranteed
                         fragment / astrolabe tables.
     kind: "weighted"    the group has a `base` chance to drop at all;
                         if it does, one line is picked by `weight`.
     kind: "independent" each line rolls on its own `chance`. Set
                         `quantityScaled: true` and these get multiplied
                         by (1 + quantity/100) — area item quantity.

   Line fields: { item, share|chance|weight, label?, key?, unidentified?,
                  note?, unrated? }
     item   name used for the poe.ninja price lookup
     label  what to show, when it differs (variants, item level)
     key    override identity, needed only when one boss lists the same
            item more than once (Catarina's three Cinderswallow Urns)
     unidentified
            the boss hands this over unidentified, so price it on the
            unidentified market first. Do NOT write it into the label —
            the UI badges the line `Unid` when the price really came from
            that market.
     note   a short explanation that belongs on the row rather than in this
            file — why a line was merged, why a rate is provisional. The UI
            renders it as a hoverable ⓘ.
     unrated
            the drop is real but no rate is published for it. Set `chance: 0`
            with it: the line is listed and badged `unrated`, contributes
            nothing to the EV, and stays editable so you can put your own
            figure in. Inventing a number here would be worse than showing a
            zero, because a zero is visibly a zero. `unratedNote` overrides the
            tooltip when the source says something more specific.

   `rates`:
     "ledger"   — from the drop tables Marcel supplied (2026-08 league
                  data, matches the numbers he's running against).
     "estimate" — the drops are documented but the rates aren't published
                  anywhere; the numbers are placeholders. Badged in the UI.
     "wiki"     — poewiki.net. Nothing uses this now that the boss list is
                  exactly the ledger set, but it stays supported so a boss
                  can be added from the wiki without touching the engine.

   Only bosses that exist in the current PoE 1 build are listed. Anything
   that has been removed from the game (the Breachlord fights, the Atziri
   apex, Aul, the Trialmaster, Lycia, Olroth, Saresh) is deliberately absent.

   No line here carries a hand-set price any more. There used to be eleven —
   Orb of Dominance and five reliquary keys — from when poe.ninja had no listing
   for them; poe.watch prices all of them, and within days the hardcoded figures
   had drifted badly (Cosmic Reliquary Key 9 divine written down against 13 on
   the market, Reverent 7 against 10). A number that does not move is wrong
   shortly after it is typed.

   The `fallback: { divine: N }` / `{ chaos: N }` mechanism still exists for the
   case where a source drops an item mid-league, and `asOf` records when such a
   number was last checked so the UI can badge it `set Nd` rather than let it
   pass as current. Adding one back should be a deliberate act: run
   `npm run audit-drops` first and confirm the market really has nothing.

   `ttk` from the ledger set is the WHOLE cycle (their KPH = 3600/ttk),
   so those bosses carry overhead 0. Bosses where I estimated the time
   myself split it into ttk + overhead.

   Everything here is editable in the UI and the edits persist.
   ================================================================ */

export const GROUP_ORDER = [
  "Pinnacle", "Eldritch", "Incarnation", "Vaal", "Breach",
  "Synthesis", "Harvest", "T17", "Other",
];

export const GROUP_TONES = {
  "Pinnacle": "#c9a24b",
  "Eldritch": "#8f6ad4",
  "Incarnation": "#6a8cd4",
  "Vaal": "#c96a3f",
  "Breach": "#b06ad4",
  "Synthesis": "#7f8fd4",
  "Harvest": "#5fc9b0",
  "T17": "#d4a86a",
  "Other": "#8fb46a",
};

/* Available for any boss that drops "a random X". A fixed `items` list makes
   the aggregate strict: every named outcome must be priced before an average
   is shown. Regex aggregates keep their existing market-wide behaviour. */
export const SYNTHETIC = {
  "@auls-uprising": {
    label: "Aul's Uprising",
    items: [
      "Aul's Uprising (Anger)",
      "Aul's Uprising (Clarity)",
      "Aul's Uprising (Determination)",
      "Aul's Uprising (Discipline)",
      "Aul's Uprising (Envy)",
      "Aul's Uprising (Grace)",
      "Aul's Uprising (Haste)",
      "Aul's Uprising (Hatred)",
      "Aul's Uprising (Malevolence)",
      "Aul's Uprising (Pride)",
      "Aul's Uprising (Purity of Elements)",
      "Aul's Uprising (Purity of Fire)",
      "Aul's Uprising (Purity of Ice)",
      "Aul's Uprising (Purity of Lightning)",
      "Aul's Uprising (Vitality)",
      "Aul's Uprising (Wrath)",
      "Aul's Uprising (Zealotry)",
    ],
    match: (n) => /^Aul's Uprising \([^)]+\)$/.test(n),
  },
  "@awakened-common": {
    label: "Awakened support gem (random, non-exceptional)",
    match: (n) => /^Awakened .+ Support$/.test(n) && !/(Enlighten|Empower|Enhance)/.test(n),
  },
  "@awakened-exceptional": {
    label: "Awakened Enlighten / Empower / Enhance",
    match: (n) => /^Awakened (Enlighten|Empower|Enhance) Support$/.test(n),
  },
};

/* ---- shared tables ---- */

const pool = (drops, label = "Unique pool") => ({ id: "pool", kind: "pool", label, rolls: 1, drops });
const guaranteed = (drops, label = "Guaranteed") => ({ id: "guaranteed", kind: "pool", label, rolls: 1, drops });
const extra = (drops, quantityScaled = false) =>
  ({ id: "additional", kind: "independent", label: "Additional drops", quantityScaled, drops });

/* The Incarnation fights all drop the same astrolabe table. */
const ASTROLABES = guaranteed([
  { item: "Templar Astrolabe", share: 0.33 },
  { item: "Grasping Astrolabe", share: 0.0744 },
  { item: "Runic Astrolabe", share: 0.0744 },
  { item: "Chaotic Astrolabe", share: 0.0744 },
  { item: "Fungal Astrolabe", share: 0.0744 },
  { item: "Nameless Astrolabe", share: 0.0744 },
  { item: "Timeless Astrolabe", share: 0.0744 },
  { item: "Deceptive Astrolabe", share: 0.0744 },
  { item: "Lightless Astrolabe", share: 0.0744 },
  { item: "Fruiting Astrolabe", share: 0.0744 },
], "Guaranteed astrolabe");

const SHAPER_FRAGS = guaranteed([
  { item: "Fragment of Shape", share: 0.5 },
  { item: "Fragment of Knowledge", share: 0.5 },
]);
const SHAPER_EXTRA = [
  { item: "Shaper's Exalted Orb", chance: 0.12 },
  { item: "Orb of Dominance", chance: 0.03 },
  { item: "Voidstorm Support", label: "Voidstorm", chance: 0.02 },
];
/* The ledger table lists these under Sirus and leaves Uber Sirus's cell blank;
   they are applied to both, since Uber Sirus is the same fight and demonstrably
   still drops Awakener's Orbs. The influenced rare items in the same cell
   (Warlord / Crusader / Redeemer / Hunter) carry no rate and no market name, so
   they are not lines here. */
const SIRUS_EXTRA = [
  { item: "Awakener's Orb", chance: 0.20 },
  { item: "Orb of Dominance", chance: 0.05 },
  { item: "Annihilation Support", chance: 0.05 },
  { item: "A Fate Worse Than Death", chance: 0.04 },
];
/* Same shape as SIRUS_EXTRA: the table lists these under Venarius and leaves
   Uber Venarius's cell blank, so both fights carry them. Both rates are
   published with a "~" — they are the table's own approximations, not ours.

   Imperfect Memories runs at 0.5%, the bound the table gives it ("<0.5%?",
   marked "confirmation needed") taken as a preliminary estimate. */
const VENARIUS_EXTRA = [
  { item: "Greater Kinetic Instability Support", aliases: ["Kinetic Flux"], chance: 0.10 },
  { item: "The Hook", chance: 0.05 },
  { item: "Imperfect Memories", chance: 0.005,
    note: "The drop table gives this as \"<0.5%?\" and marks it as needing confirmation. 0.5% is that "
      + "bound taken as a preliminary estimate — it contributes to the EV, so treat that contribution "
      + "as provisional." },
];
const MAVEN_EXTRA = [
  { item: "Orb of Conflict", chance: 0.35 },
  { item: "Invert the Rules Support", chance: 0.10 },
];
/* Both Dread fights. Congregation Support's 5% is Marcel's figure — the table
   lists the gem with no rate at all, the same way it does Exarch's Overheat
   Support. Everything else here is the table's. */
const DREAD_EXTRA = [
  { item: "Orb of Unravelling", chance: 0.33 },
  { item: "Bound by Destiny", unidentified: true, chance: 0.10 },
  { item: "Congregation Support", chance: 0.05 },
];
/* Both Fear fights. The table lists them under Regular Fear and leaves Uber's
   cell blank, the same way Sirus and Venarius do. "Memory Strand items" in the
   same cell have no rate and no market name, so they are not a line. */
const FEAR_EXTRA = [
  { item: "Orb of Intention", chance: 0.50 },
  { item: "Bound by Destiny", unidentified: true, chance: 0.10 },
  { item: "Greater Devour Support", chance: 0.05 },
];
const ELDRITCH_ORBS = [
  { item: "Eldritch Orb of Annulment", chance: 0.05 },
  { item: "Eldritch Chaos Orb", chance: 0.05 },
  { item: "Eldritch Exalted Orb", chance: 0.05 },
];
/* Both Exarch fights, per the table's own note that the list is shared and
   only Regular Exarch scales it by area quantity.

   The Eldritch Voidstone in the same cell is a quest item that drops once, on
   the first kill after the Eater is down. It is not a per-kill outcome and not
   a market item, so it is not a line.

   Overheat Support's 5% predates this table, which lists the gem with no rate
   at all. Left as it was rather than replaced with a zero — but it is the
   weakest number in the block. */
/* Both Eater fights, mirroring EXARCH_EXTRA — the two tables have the same
   shape and the same footnote about only the regular fight scaling with area
   quantity. Gluttony Support's 5% is Marcel's figure; the table lists the gem
   with no rate. The Eldritch Voidstone in the same cell is the quest item and
   is not a line, for the reason given under EXARCH_EXTRA. */
const EATER_EXTRA = [
  { item: "Exceptional Eldritch Ichor", chance: 0.15 },
  ...ELDRITCH_ORBS,
  { item: "Gluttony Support", chance: 0.05 },
  { item: "Auspicious Ambitions", chance: 0.005,
    note: "The drop table lists this drop with no rate. 0.5% is a preliminary estimate, "
      + "not a published figure — it contributes to the EV, so treat that contribution as provisional." },
];
const EXARCH_EXTRA = [
  { item: "Exceptional Eldritch Ember", chance: 0.15 },
  ...ELDRITCH_ORBS,
  { item: "Overheat Support", chance: 0.05 },
  { item: "Auspicious Ambitions", chance: 0.005,
    note: "The drop table gives this as \"<1%\". 0.5% is a preliminary estimate inside that bound, "
      + "not a measured rate — it contributes to the EV, so treat that contribution as provisional." },
];

export const BOSSES = [
  /* ================= Pinnacle ================= */
  {
    id: "shaper", name: "The Shaper", group: "Pinnacle", rates: "wiki",
    entry: [
      { item: "Fragment of the Hydra" }, { item: "Fragment of the Phoenix" },
      { item: "Fragment of the Chimera" }, { item: "Fragment of the Minotaur" },
    ],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Shaper's Touch", share: 0.56 },
        { item: "Voidwalker", share: 0.26 },
        { item: "Solstice Vigil", share: 0.15 },
        { item: "Dying Sun", share: 0.03 },
      ]),
      SHAPER_FRAGS,
      extra(SHAPER_EXTRA),
    ],
  },
  {
    id: "uber-shaper", name: "Uber Shaper", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Cosmic Fragment", qty: 4 }],
    ttk: 300, overhead: 0,
    groups: [
      pool([
        { item: "Echoes of Creation", share: 0.33 },
        { item: "Entropic Devastation", share: 0.30 },
        { item: "The Tides of Time", share: 0.18 },
        { item: "The Unblinking Eye", share: 0.17 },
        { item: "Starforge", share: 0.02 },
      ]),
      SHAPER_FRAGS,
      extra([
        { item: "Sublime Vision", unidentified: true, chance: 0.02 },
        { item: "Cosmic Reliquary Key", chance: 0.01 },
        ...SHAPER_EXTRA,
      ]),
    ],
  },
  {
    id: "elder", name: "The Elder", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Fragment of Purification" }, { item: "Fragment of Constriction" },
      { item: "Fragment of Enslavement" }, { item: "Fragment of Eradication" },
    ],
    ttk: 110, overhead: 0,
    groups: [
      pool([
        { item: "Cyclopean Coil", share: 0.30 },
        { item: "Blasphemer's Grasp", share: 0.30 },
        { item: "Nebuloch", share: 0.10 },
        { item: "Hopeshredder", share: 0.10 },
        { item: "Shimmeron", share: 0.10 },
        { item: "Impresence", share: 0.10 },
      ]),
      guaranteed([
        { item: "Fragment of Terror", share: 0.5 },
        { item: "Fragment of Emptiness", share: 0.5 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Watcher's Eye (2-mod, ilvl 85)", unidentified: true,
          aliases: ["Unidentified Watcher's Eye 85"], chance: 0.40 },
        { item: "Elder's Exalted Orb", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.02 },
        { item: "Eldritch Blasphemy Support", chance: 0.02 },
      ]),
    ],
  },
  {
    id: "uber-elder", name: "Uber Elder", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Fragment of Knowledge" }, { item: "Fragment of Shape" },
      { item: "Fragment of Terror" }, { item: "Fragment of Emptiness" },
    ],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "Mark of the Shaper", share: 0.35 },
        { item: "Mark of the Elder", share: 0.35 },
        { item: "Voidfletcher", share: 0.15 },
        { item: "Indigon", share: 0.12 },
        { item: "Disintegrator", share: 0.03 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Watcher's Eye (3-mod, ilvl 86)", unidentified: true,
          aliases: ["Unidentified Watcher's Eye 86+"], chance: 0.30 },
        { item: "Shaper's Exalted Orb", chance: 0.15 },
        { item: "Elder's Exalted Orb", chance: 0.10 },
        { item: "Void Shockwave Support", label: "Void Shockwave", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.05 },
        { item: "Auspicious Ambitions", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "uber-uber-elder", name: "Uber Uber Elder", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Decaying Fragment", qty: 4 }],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Call of the Void", share: 0.40 },
        { item: "The Devourer of Minds", share: 0.30 },
        { item: "Soul Ascension", share: 0.10 },
        { item: "Impresence", share: 0.10 },
        { item: "The Eternity Shroud", share: 0.06 },
        { item: "Voidforge", share: 0.04 },
      ]),
      extra([
        { item: "Watcher's Eye", label: "Watcher's Eye (3-mod, ilvl 86)", unidentified: true,
          aliases: ["Unidentified Watcher's Eye 86+"], chance: 0.30 },
        { item: "Shaper's Exalted Orb", chance: 0.20 },
        { item: "Elder's Exalted Orb", chance: 0.15 },
        { item: "Void Shockwave Support", label: "Void Shockwave", chance: 0.10 },
        { item: "Orb of Dominance", chance: 0.08 },
        { item: "Curio of Decay", chance: 0.05 },
        { item: "Sublime Vision", unidentified: true, chance: 0.02 },
        { item: "Decaying Reliquary Key", chance: 0.015 },
        { item: "Auspicious Ambitions", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "sirus", name: "Sirus, Awakener of Worlds", group: "Pinnacle", rates: "ledger",
    entry: [
      { item: "Al-Hezmin's Crest" }, { item: "Baran's Crest" },
      { item: "Drox's Crest" }, { item: "Veritania's Crest" },
    ],
    ttk: 210, overhead: 0,
    groups: [
      pool([
        { item: "Hands of the High Templar", share: 0.42 },
        { item: "Crown of the Inward Eye", share: 0.33 },
        { item: "The Burden of Truth", share: 0.20 },
        { item: "Thread of Hope", label: "Thread of Hope (ilvl 86)", unidentified: true,
          aliases: ["Unidentified Thread of Hope (ilvl 86)"], share: 0.05 },
      ]),
      extra(SIRUS_EXTRA),
    ],
  },
  {
    id: "uber-sirus", name: "Uber Sirus", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Awakening Fragment", qty: 4 }],
    ttk: 270, overhead: 0,
    groups: [
      pool([
        { item: "Thread of Hope", label: "Thread of Hope (Massive, ilvl 87)", unidentified: true,
          aliases: ["Unidentified Thread of Hope (ilvl 87)"], share: 0.44 },
        { item: "The Tempest Rising", share: 0.29 },
        { item: "Zana's Ingenuity", share: 0.18 },
        { item: "Oriath's End", share: 0.08 },
        // The table gives this one as "≤1%"; 1% is what makes the pool sum to 1.
        { item: "The Saviour", share: 0.01 },
      ]),
      extra([{ item: "Oubliette Reliquary Key", chance: 0.015 }, ...SIRUS_EXTRA]),
    ],
  },
  {
    id: "maven", name: "The Maven", group: "Pinnacle", rates: "ledger",
    entry: [{ item: "The Maven's Writ" }],
    ttk: 240, overhead: 0,
    groups: [
      pool([
        { item: "Legacy of Fury", share: 0.44 },
        { item: "Graven's Secret", share: 0.16 },
        { item: "Arn's Anguish", share: 0.16 },
        { item: "Olesya's Delight", share: 0.16 },
        { item: "Doppelgänger Guise", share: 0.07 },
        { item: "Echoforge", share: 0.01 },
      ]),
      extra(MAVEN_EXTRA),
    ],
  },
  {
    id: "uber-maven", name: "Uber Maven", group: "Pinnacle", uber: true, rates: "ledger",
    entry: [{ item: "Reality Fragment", qty: 4 }],
    ttk: 300, overhead: 0,
    groups: [
      pool([
        { item: "Viridi's Veil", share: 0.52 },
        { item: "Impossible Escape", unidentified: true, share: 0.33 },
        { item: "Grace of the Goddess", share: 0.13 },
        { item: "Progenesis", share: 0.02 },
      ]),
      {
        id: "gems", kind: "weighted", label: "Awakened gems", base: 0.02,
        drops: [
          { item: "Awakened Empower Support", weight: 1 },
          { item: "Awakened Enhance Support", weight: 1 },
          { item: "Awakened Enlighten Support", weight: 1 },
        ],
      },
      extra([
        { item: "Orb of Conflict", chance: 0.30 },
        { item: "Invert the Rules Support", chance: 0.10 },
        { item: "Curio of Potential", chance: 0.05 },
        { item: "Eclipse Support", chance: 0.02 },
        { item: "Shiny Reliquary Key", chance: 0.015 },
      ]),
    ],
  },

  /* ================= Eldritch ================= */
  {
    id: "exarch", name: "The Searing Exarch", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Incandescent Invitation" }],
    ttk: 90, overhead: 0, quantity: 70,
    groups: [
      pool([
        { item: "Dawnbreaker", share: 0.63 },
        { item: "Dawnstrider", share: 0.35 },
        { item: "Dissolution of the Flesh", share: 0.02 },
      ]),
      extra([
        { item: "Forbidden Flame", label: "Forbidden Flame (ilvl 86)", unidentified: true,
          aliases: ["Unidentified Forbidden Flame (ilvl 86)"], chance: 0.05 },
        ...EXARCH_EXTRA,
      ], true),
    ],
  },
  {
    id: "uber-exarch", name: "Uber Searing Exarch", group: "Eldritch", uber: true, rates: "ledger",
    entry: [{ item: "Blazing Fragment", qty: 4 }],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "The Annihilating Light", share: 0.455 },
        { item: "Annihilation's Approach", share: 0.29 },
        { item: "Crystallised Omniscience", share: 0.24 },
        { item: "The Celestial Brace", share: 0.015 },
      ]),
      extra([
        // Encounter-specific: the table lists the Hidden Ascendancy Notable
        // variant with no rate, so the 5% here is the normal fight's figure.
        { item: "Forbidden Flame", label: "Forbidden Flame (ilvl 87)", unidentified: true,
          aliases: ["Unidentified Forbidden Flame (ilvl 87)"], chance: 0.05 },
        { item: "Archive Reliquary Key", chance: 0.015 },
        { item: "Curio of Absorption", chance: 0.05 },
        ...EXARCH_EXTRA,
      ]),
    ],
  },
  {
    id: "eater", name: "The Eater of Worlds", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Screaming Invitation" }],
    ttk: 45, overhead: 0, quantity: 70,
    groups: [
      pool([
        { item: "Inextricable Fate", share: 0.55 },
        { item: "The Gluttonous Tide", share: 0.43 },
        { item: "Melding of the Flesh", share: 0.02 },
      ]),
      extra([
        { item: "Forbidden Flesh", label: "Forbidden Flesh (ilvl 86)", unidentified: true,
          aliases: ["Unidentified Forbidden Flesh (ilvl 86)"], chance: 0.05 },
        ...EATER_EXTRA,
      ], true),
    ],
  },
  {
    id: "uber-eater", name: "Uber Eater of Worlds", group: "Eldritch", uber: true, rates: "ledger",
    entry: [{ item: "Devouring Fragment", qty: 4 }],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "Ravenous Passion", share: 0.68 },
        { item: "Ashes of the Stars", share: 0.30 },
        { item: "Nimis", share: 0.02 },
      ]),
      extra([
        // Encounter-specific: the table gives the Hidden Ascendancy Notable
        // variant no rate, so the 5% here is the normal fight's figure.
        { item: "Forbidden Flesh", label: "Forbidden Flesh (ilvl 87)", unidentified: true,
          aliases: ["Unidentified Forbidden Flesh (ilvl 87)"], chance: 0.05 },
        { item: "Visceral Reliquary Key", chance: 0.01 },
        { item: "Curio of Consumption", chance: 0.05 },
        ...EATER_EXTRA,
      ]),
    ],
  },
  {
    id: "black-star", name: "The Black Star", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Polaric Invitation" }],
    ttk: 30, overhead: 0, quantity: 50,
    groups: [
      extra([
        { item: "Grand Eldritch Ember", chance: 0.12 },
        { item: "Greater Eldritch Ember", chance: 0.12 },
        { item: "The Eternal Struggle", chance: 0.05 },
        ...ELDRITCH_ORBS,
        { item: "Polaric Devastation", chance: 0.03 },
        { item: "Sudden Dawn", chance: 0.03 },
      ], true),
    ],
  },
  {
    id: "infinite-hunger", name: "The Infinite Hunger", group: "Eldritch", rates: "ledger",
    entry: [{ item: "Writhing Invitation" }],
    ttk: 30, overhead: 0, quantity: 50,
    groups: [
      extra([
        { item: "Grand Eldritch Ichor", chance: 0.12 },
        { item: "Greater Eldritch Ichor", chance: 0.12 },
        { item: "The Eternal Struggle", chance: 0.05 },
        ...ELDRITCH_ORBS,
        { item: "Ceaseless Feast", chance: 0.03 },
        { item: "Black Zenith", chance: 0.03 },
        { item: "Choking Guilt", chance: 0.005 },
      ], true),
    ],
  },

  /* ================= Incarnation ================= */
  {
    id: "incarnation-neglect", name: "Incarnation of Neglect", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Loneliness" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Betrayal's Sting", share: 0.50 },
        { item: "The Arkhon's Tools", share: 0.38 },
        { item: "Venarius' Astrolabe", share: 0.10 },
        { item: "Legacy of the Rose", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Remembrance", chance: 0.33 },
        { item: "Bound by Destiny", unidentified: true, chance: 0.10 },
        { item: "Frostmage Support", chance: 0.05 },
        { item: "Monochrome", chance: 0.03 },
      ]),
    ],
  },
  {
    id: "uber-incarnation-neglect", name: "Uber Incarnation of Neglect", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Lonely Fragment", qty: 4 }],
    ttk: 120, overhead: 0,
    groups: [
      pool([
        { item: "Refuge in Isolation", share: 0.55 },
        { item: "Bitter Instinct", share: 0.30 },
        { item: "Haunting Memories", share: 0.13 },
        { item: "Festering Resentment", share: 0.02 },
      ]),
      ASTROLABES,
      extra([
        { item: "Orb of Remembrance", chance: 0.33 },
        { item: "Bound by Destiny", unidentified: true, chance: 0.10 },
        { item: "Frostmage Support", chance: 0.05 },
        { item: "Monochrome", chance: 0.03 },
        { item: "Lonely Reliquary Key", chance: 0.01 },
      ]),
    ],
  },
  {
    id: "incarnation-dread", name: "Incarnation of Dread", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Reverence" }],
    ttk: 200, overhead: 0,
    groups: [
      pool([
        { item: "Bonemeld", share: 0.55 },
        { item: "The Dark Monarch", share: 0.35 },
        { item: "Seven Teachings", share: 0.08 },
        { item: "Wine of the Prophet", share: 0.02 },
      ]),
      ASTROLABES,
      extra(DREAD_EXTRA),
    ],
  },
  {
    id: "uber-incarnation-dread", name: "Uber Incarnation of Dread", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Reverent Fragment", qty: 4 }],
    ttk: 270, overhead: 0,
    groups: [
      pool([
        { item: "The Hallowed Monarch", share: 0.54 },
        { item: "Whispers of Infinity", share: 0.30 },
        { item: "Wellwater Phylactery", share: 0.14 },
        { item: "The Golden Charlatan", share: 0.02 },
      ]),
      ASTROLABES,
      extra([{ item: "Reverent Reliquary Key", chance: 0.01 }, ...DREAD_EXTRA]),
    ],
  },
  {
    id: "incarnation-fear", name: "Incarnation of Fear", group: "Incarnation", rates: "ledger",
    entry: [{ item: "Echo of Trauma" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Servant of Decay", share: 0.50 },
        { item: "The Unseen Hue", share: 0.40 },
        { item: "Enmity's Embrace", share: 0.08 },
        { item: "Starcaller", share: 0.02 },
      ]),
      ASTROLABES,
      extra(FEAR_EXTRA),
    ],
  },
  {
    id: "uber-incarnation-fear", name: "Uber Incarnation of Fear", group: "Incarnation", uber: true, rates: "ledger",
    entry: [{ item: "Traumatic Fragment", qty: 4 }],
    ttk: 120, overhead: 0,
    groups: [
      pool([
        { item: "The Caged Mammoth", share: 0.60 },
        { item: "Coiling Whisper", share: 0.36 },
        { item: "Wing of the Wyvern", share: 0.02 },
        { item: "Woespike", share: 0.02 },
      ]),
      ASTROLABES,
      extra([{ item: "Traumatic Reliquary Key", chance: 0.01 }, ...FEAR_EXTRA]),
    ],
  },

  /* ================= Vaal ================= */
  {
    id: "uber-atziri", name: "Uber Atziri", group: "Vaal", uber: true, rates: "ledger",
    entry: [
      { item: "Mortal Grief" }, { item: "Mortal Ignorance" },
      { item: "Mortal Rage" }, { item: "Mortal Hope" },
    ],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "The Vertex", share: 0.42 },
        { item: "Atziri's Splendour", share: 0.39 },
        { item: "Triumvirate Authority", share: 0.06 },
        { item: "Atziri's Acuity", share: 0.06 },
        { item: "Atziri's Reflection", share: 0.03 },
        { item: "Atziri's Rule", share: 0.03 },
        { item: "Atziri's Disfavour", share: 0.01 },
      ]),
      extra([
        { item: "Beauty", chance: 0.125 },
        { item: "Vaal Sacrifice Support", chance: 0.10 },
        { item: "Greater Spell Echo Support", chance: 0.05 },
      ]),
    ],
  },

  /* ================= Breach ================= */
  {
    id: "esh-tul", name: "Esh-Tul", group: "Breach", rates: "ledger",
    entry: [{ item: "Hivebrain Gland" }],
    ttk: 180, overhead: 0,
    groups: [
      pool([
        { item: "Hand of the Lords", share: 0.30 },
        { item: "The Will of Xoph", share: 0.17 },
        { item: "The Will of Tul", share: 0.17 },
        { item: "The Will of Esh", share: 0.17 },
        { item: "The Will of Uul-Netol", share: 0.10 },
        { item: "The Grey Wind", share: 0.05 },
        { item: "The Sundered Will", share: 0.03 },
        { item: "Uul-Netol's Vow", share: 0.01 },
      ]),
      extra([
        { item: "Flesh of Xesht", chance: 0.20 },
        { item: "Something Dark", chance: 0.10 },
        { item: "Foulgrasp Support", chance: 0.10 },
        { item: "The Escape", chance: 0.06 },
        // The game and poe.ninja both call it Hiveborn Support; poe.watch files
        // it as Summon Hiveborn, which is what the alias is for.
        { item: "Hiveborn Support", aliases: ["Summon Hiveborn"], chance: 0.05 },
      ]),
    ],
  },

  /* ================= Synthesis ================= */
  {
    id: "cortex", name: "Venarius (Cortex)", group: "Synthesis", rates: "ledger",
    entry: [{ item: "Cortex" }],
    ttk: 150, overhead: 0,
    groups: [
      pool([
        { item: "Offering to the Serpent", share: 0.43 },
        { item: "Perepiteia", share: 0.43 },
        { item: "Garb of the Ephemeral", share: 0.09 },
        { item: "Bottled Faith", share: 0.05 },
      ]),
      extra(VENARIUS_EXTRA),
    ],
  },
  {
    id: "uber-cortex", name: "Uber Venarius", group: "Synthesis", uber: true, rates: "ledger",
    entry: [{ item: "Synthesising Fragment", qty: 4 }],
    ttk: 210, overhead: 0,
    groups: [
      pool([
        { item: "Nebulis", share: 0.34 },
        { item: "Mask of the Tribunal", share: 0.34 },
        { item: "Circle of Ambition", share: 0.19 },
        { item: "The Apostate", share: 0.08 },
        { item: "Rational Doctrine", share: 0.05 },
      ]),
      extra([{ item: "Forgotten Reliquary Key", chance: 0.015 }, ...VENARIUS_EXTRA]),
    ],
  },

  /* ================= Harvest ================= */
  {
    id: "oshabi", name: "Oshabi, Avatar of the Grove", group: "Harvest", rates: "ledger",
    entry: [{ item: "Sacred Blossom" }],
    ttk: 60, overhead: 0,
    groups: [
      pool([
        { item: "Forbidden Shako", unidentified: true, share: 0.52 },
        { item: "Law of the Wilds", share: 0.20 },
        { item: "Witchhunter's Judgment", share: 0.16 },
        { item: "Abhorrent Interrogation", share: 0.12 },
      ]),
      extra([
        // poe.watch files lifeforce under its full name; the short form is the
        // one the ledger tables use.
        { item: "Sacred Lifeforce", label: "Sacred Crystallised Lifeforce",
          aliases: ["Sacred Crystallised Lifeforce", "Sacred Crystalised Lifeforce"], chance: 1.00 },
        { item: "Pacifism Support", chance: 0.12 },
        { item: "The Aspirant", chance: 0.10 },
        { item: "Greater Unleash Support", chance: 0.04 },
      ]),
    ],
  },


  /* ================= Tier 17 maps =================
     The only source of uber fragments, so they belong next to the bosses
     those fragments open.

     Fragments drop as a STACK whose size scales with area item quantity,
     not as an independent per-item roll — so they're a pool with multiple
     rolls, and the roll count is the editable number in the group header:

        below 235% IIQ   1-3 fragments   -> 2
        235-250% IIQ     2-3 fragments   -> 2.5
        250%+ IIQ        2-4 fragments   -> 3

     Defaults sit at the low-IIQ midpoint. Which fragment type you get is
     assumed uniform across the map's types; nobody publishes a split.

     The unique drops are a flat 5% — a community figure off Reddit, not
     measured data. Everything here is a starting point, not a source.

     Entry cost: poe.ninja does not price the five tier 17s separately — it
     lists one "Nightmare Map" line covering all of them, so that is what
     every entry resolves to. The label keeps the real map name on screen. */
  {
    id: "t17-abomination", name: "Abomination", group: "T17", rates: "estimate",
    entry: [{ item: "Nightmare Map", label: "Abomination Map", aliases: ["Abomination Map", "Abomination"] }],
    ttk: 240, overhead: 60,
    note: "Fragment count scales with area quantity: 1-3 below 235% IIQ, 2-3 at 235-250%, 2-4 above 250%. The roll count in the Fragments header is set to 2, the low-IIQ midpoint — raise it to 2.5 or 3 if you run higher quant. Non-fragment drop rates are 5% community estimates.",
    groups: [
      { id: "pool", kind: "pool", label: "Fragments", rolls: 2, drops: [
        { item: "Awakening Fragment", share: 0.5 },
        { item: "Reality Fragment", share: 0.5 },
      ] },
      extra([
        { item: "Malachai's Mark", chance: 0.05 },
        { item: "Unholy Trinity Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "t17-citadel", name: "Citadel", group: "T17", rates: "estimate",
    entry: [{ item: "Nightmare Map", label: "Citadel Map", aliases: ["Citadel Map", "Citadel"] }],
    ttk: 240, overhead: 60,
    note: "Fragment count scales with area quantity: 1-3 below 235% IIQ, 2-3 at 235-250%, 2-4 above 250%. The roll count in the Fragments header is set to 2, the low-IIQ midpoint — raise it to 2.5 or 3 if you run higher quant. Unique rates are a 5% community estimate.",
    groups: [
      { id: "pool", kind: "pool", label: "Fragments", rolls: 2, drops: [
        { item: "Cosmic Fragment", share: 0.5 },
        { item: "Synthesising Fragment", share: 0.5 },
      ] },
      extra([
        { item: "Manastorm", chance: 0.05 },
        { item: "Cast on Ward Break Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "t17-fortress", name: "Fortress", group: "T17", rates: "estimate",
    entry: [{ item: "Nightmare Map", label: "Fortress Map", aliases: ["Fortress Map", "Fortress"] }],
    ttk: 240, overhead: 60,
    note: "Fragment count scales with area quantity: 1-3 below 235% IIQ, 2-3 at 235-250%, 2-4 above 250%. The roll count in the Fragments header is set to 2, the low-IIQ midpoint — raise it to 2.5 or 3 if you run higher quant. Unique rates are a 5% community estimate.",
    groups: [
      { id: "pool", kind: "pool", label: "Fragments", rolls: 2, drops: [
        { item: "Decaying Fragment", share: 0.5 },
        { item: "Synthesising Fragment", share: 0.5 },
      ] },
      extra([
        { item: "Yoke of Suffering", chance: 0.05 },
        { item: "Overloaded Intensity Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "t17-ziggurat", name: "Ziggurat", group: "T17", rates: "estimate",
    entry: [{ item: "Nightmare Map", label: "Ziggurat Map", aliases: ["Ziggurat Map", "Ziggurat"] }],
    ttk: 240, overhead: 60,
    note: "Fragment count scales with area quantity: 1-3 below 235% IIQ, 2-3 at 235-250%, 2-4 above 250%. The roll count in the Fragments header is set to 2, the low-IIQ midpoint — raise it to 2.5 or 3 if you run higher quant. Unique rates are a 5% community estimate.",
    groups: [
      { id: "pool", kind: "pool", label: "Fragments", rolls: 2, drops: [
        { item: "Devouring Fragment", share: 0.5 },
        { item: "Blazing Fragment", share: 0.5 },
      ] },
      extra([
        { item: "Keeper's Corruption", chance: 0.05 },
        { item: "Nook's Crown", chance: 0.05 },
        { item: "Wraithlord", chance: 0.05 },
        { item: "Communion Support", chance: 0.05 },
      ]),
    ],
  },
  {
    id: "t17-sanctuary", name: "Sanctuary", group: "T17", rates: "estimate",
    entry: [{ item: "Nightmare Map", label: "Sanctuary Map", aliases: ["Sanctuary Map", "Sanctuary"] }],
    ttk: 240, overhead: 60,
    note: "Fragment count scales with area quantity: 1-3 below 235% IIQ, 2-3 at 235-250%, 2-4 above 250%. The roll count in the Fragments header is set to 2, the low-IIQ midpoint — raise it to 2.5 or 3 if you run higher quant. Unique rates are a 5% community estimate.",
    groups: [
      { id: "pool", kind: "pool", label: "Fragments", rolls: 2, drops: [
        { item: "Lonely Fragment", share: 0.3333 },
        { item: "Traumatic Fragment", share: 0.3333 },
        { item: "Reverent Fragment", share: 0.3333 },
      ] },
      extra([
        { item: "The Dark Seer", chance: 0.05 },
        { item: "Scornful Herald Support", chance: 0.05 },
      ]),
    ],
  },

  /* ================= Other ================= */
  {
    id: "catarina", name: "Catarina, Master of Undeath", group: "Other", rates: "ledger",
    entry: [{ item: "Syndicate Medallion" }],
    ttk: 120, overhead: 0,
    groups: [
      /* Every drop here is veiled, so `unidentified: true` says it once per
         line and the labels are just the item names. They used to read
         "Veiled Cinderswallow Urn" because the word in the label was what
         drove the unidentified lookup; the flag does that now, and repeating
         "veiled" on six consecutive rows told the reader nothing. */
      pool([
        { key: "urn", item: "Cinderswallow Urn", unidentified: true, share: 0.30 },
        { key: "spinehail", item: "Spinehail", unidentified: true, share: 0.20 },
        /* The table splits this by veiled mod count — 17% at three mods, 1% at
           four — but no feed prices the four-mod cane separately, so pricing
           the split would quote the three-mod figure for both. One line at the
           combined 18%, and the note says so on the row. */
        { key: "kulemak", item: "Cane of Kulemak", unidentified: true, share: 0.18,
          note: "The drop table splits this into a 3-veiled-mod cane at 17% and a 4-veiled-mod one at 1%. "
            + "No market prices the 4-mod cane on its own, so quoting the split would put the 3-mod price "
            + "on both. The two are one line at their combined 18% instead." },
        { key: "diadem", item: "The Devouring Diadem", unidentified: true, share: 0.16 },
        { key: "bitterbind", item: "Bitterbind Point", unidentified: true, share: 0.10 },
        { key: "hunger", item: "The Queen's Hunger", unidentified: true, share: 0.06 },
      ]),
      extra([
        { item: "Allflame Ember of Kulemak", chance: 0.60 },
        { item: "Zorath's Eye of the Endless", chance: 0.50,
          note: "The drop table calls this a preliminary estimate, not a measured rate." },
        { item: "Veiled Exalted Orb", chance: 0.25 },
        { item: "Communion Support", chance: 0.10 },
        /* The table bounds Nook's Crown at "<0.5%" and gives Keeper's Corruption
           no figure at all. Both run at that bound as a preliminary estimate,
           so they contribute to the EV — treat that contribution as provisional. */
        { item: "Nook's Crown", chance: 0.005,
          note: "The drop table gives this as \"<0.5%\". 0.5% is that bound taken as a preliminary "
            + "estimate, not a measured rate — it contributes to the EV, so treat that contribution "
            + "as provisional." },
        { item: "Keeper's Corruption", chance: 0.005,
          note: "The drop table publishes no rate for this one. 0.5% is a preliminary estimate "
            + "inherited from Nook's Crown, not a measured rate — it contributes to the EV, so treat "
            + "that contribution as provisional." },
      ]),
    ],
  },
  {
    id: "king-in-the-mists", name: "King in the Mists", group: "Other", rates: "ledger",
    entry: [{ item: "An Audience with the King" }],
    ttk: 45, overhead: 0,
    groups: [
      pool([
        { item: "The Untouched Soul", share: 0.40 },
        { item: "Pragmatism", share: 0.35 },
        { item: "The Light of Meaning", unidentified: true, share: 0.20 },
        { item: "The Burden of Shadows", share: 0.05 },
      ]),
      extra([
        // poe.watch files this as "Bursting Toad"; the game calls it Hextoad
        // Support, and the game's name is the one worth showing.
        { item: "Hextoad Support", aliases: ["Bursting Toad"], chance: 0.10 },
        { item: "Hexpass Support", chance: 0.10 },
      ]),
    ],
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
