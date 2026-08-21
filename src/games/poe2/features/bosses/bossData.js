/* PoE 2 boss EV data stays isolated from PoE 1: item names, encounter entry,
   pool rules and confidence labels all change independently between games.

   Pool percentages from community samples are used as relative weights and
   normalized to one guaranteed drop. That preserves the encounter rule when
   rounded samples total 99.5% or 102%. Independent drops are never normalized.

   basis:
     wiki       supplied poe2wiki community sample
     community non-wiki sample cited in the note
     estimate   inferred from Maxroll rarity wording or an unknown wiki rate

   Every estimate is editable in the UI and deliberately remains badged. */

export const GROUP_ORDER = [
  "Pinnacle", "Atlas", "Trials", "Expedition", "Breach", "Delirium",
  "Ritual", "Abyss", "Fate of the Vaal", "Anomaly",
];

export const GROUP_TONES = {
  Pinnacle: "#d19a52",
  Atlas: "#6f93c2",
  Trials: "#bc7bd8",
  Expedition: "#5ea97d",
  Breach: "#9b72db",
  Delirium: "#7892bb",
  Ritual: "#a66bba",
  Abyss: "#6a8f61",
  "Fate of the Vaal": "#c46c52",
  Anomaly: "#4aa3a0",
};

export const SOURCE_LABELS = {
  wiki: { label: "wiki sample", className: "wiki" },
  community: { label: "community", className: "community" },
  estimate: { label: "needs review", className: "estimate" },
};

const WIKI = "wiki";
const COMMUNITY = "community";
const ESTIMATE = "estimate";

const drop = (item, rate, basis = WIKI, options = {}) => ({ item, rate, basis, ...options });
const pool = (id, label, drops, options = {}) => ({ id, label, kind: "pool", drops, ...options });
const extra = (id, label, drops, options = {}) => ({ id, label, kind: "independent", drops, ...options });
const fixed = (id, label, drops, options = {}) => ({ id, label, kind: "fixed", drops, ...options });
const entry = (...items) => items.map(([item, qty = 1]) => ({ item, qty }));

const estimated = (item, rate, rarity, note) => drop(item, rate, ESTIMATE, {
  rarity,
  note: note || `Inferred from Maxroll's ${rarity} label; verify this rate.`,
});

const CURRENT_OMENS = [
  "Omen of Amelioration", "Omen of Dextral Annulment", "Omen of Dextral Erasure",
  "Omen of Dextral Exaltation", "Omen of Greater Exaltation", "Omen of Refreshment",
  "Omen of Resurgence", "Omen of Sinistral Annulment", "Omen of Sinistral Erasure",
  "Omen of Sinistral Exaltation", "Omen of Whittling",
];
const OmenPool = CURRENT_OMENS.map((item) => drop(item, 1 / CURRENT_OMENS.length, ESTIMATE, {
  note: "The encounter guarantees at least one current Omen, but the supplied source gives no relative weights; equal shares are used for EV.",
}));

export const BOSSES = [
  {
    id: "arbiter-of-divinity", name: "The Arbiter of Divinity", group: "Pinnacle", groupTags: ["Atlas"],
    location: "The Origin Tower", sourceUrl: "https://www.poe2wiki.net/wiki/The_Arbiter_of_Divinity",
    rateSummary: "Maxroll rarity estimates",
    entry: entry(["Origin Core"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        estimated("Decree of Loyalty", .30, "Common"),
        estimated("Decree of Acuity", .30, "Common"),
        estimated("Decree of Flight", .15, "Uncommon"),
        estimated("Opportunity", .15, "Uncommon"),
        estimated("The Ordained", .07, "Rare"),
        estimated("Immaculate Adherence", .03, "Very Rare"),
      ]),
      extra("lineage", "Lineage supports", [
        estimated("Her Declaration", .02, "Very Rare"),
        estimated("Seraph's Heart", .02, "Very Rare"),
      ]),
    ],
  },
  {
    id: "the-bodach", name: "The Bodach", group: "Pinnacle", groupTags: ["Ritual"], location: "Caer Tarth",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Bodach", rateSummary: "poe2wiki n=100",
    entry: entry(["Call of the Shadows", 5]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Vestige of Darkness", .56), drop("Forgotten Warden", .26),
        drop("Sylvan's Effigy", .10), drop("Liminal Coil", .05), drop("Periphery", .05),
      ], { sampled: true }),
      extra("lineage", "Lineage supports", [
        drop("Catha's Brilliance", .05), drop("Mórrigan's Insight", .05),
      ]),
      extra("runes", "Runes", [
        drop("Carved Mischief", .06), drop("Carved Majesty", .02),
        drop("Carved Tenacity", .01),
        drop("Carved Cunning", .005, ESTIMATE, { note: "The wiki reports <1%; 0.5% is the midpoint placeholder." }),
      ]),
    ],
  },
  {
    id: "raven-trickster", name: "Tangmazu, the Raven Trickster", group: "Pinnacle", groupTags: ["Delirium"],
    location: "The Withered Hollow", sourceUrl: "https://www.poe2wiki.net/wiki/The_Raven_Trickster",
    rateSummary: "poe2wiki community sample", entry: entry(["Raven's Reflection"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Veilpiercer", .35), drop("Sadist's Mercy", .30), drop("The Auspex", .17),
        drop("Horror's Flight", .10), drop("The Raven's Flock", .05), drop("Split Personality", .03),
      ]),
      extra("lineage", "Lineage supports", [
        drop("Trickster's Shard", .043), drop("Tangmazu's Thurible", .035),
      ]),
      extra("runes", "Runes", [
        drop("Raven-Touched Shard", .025),
      ]),
    ],
  },
  {
    id: "arbiter-of-ash", name: "The Arbiter of Ash", group: "Pinnacle", groupTags: ["Atlas"], location: "The Burning Monolith",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Arbiter_of_Ash", rateSummary: "regular · supplied wiki table",
    entry: entry(["Ancient Crisis Fragment"], ["Faded Crisis Fragment"], ["Weathered Crisis Fragment"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Morior Invictus", .48),
        drop("Solus Ipse", .02, ESTIMATE, { rarity: "Very Rare", note: "Unknown in the supplied regular table; assigned 2% from Maxroll's Very Rare label." }),
        drop("Sine Aequo", .05, ESTIMATE, { rarity: "Rare", note: "Unknown in the supplied regular table; assigned 5% from Maxroll's Rare label." }),
        drop("Ab Aeterno", .10, ESTIMATE, { rarity: "Uncommon", note: "Unknown in the supplied regular table; assigned the remaining 10% after the other rarity estimates." }),
        drop("Sacred Flame", .12), drop("Prism of Belief", .23),
      ]),
      extra("reliquary", "Reliquary key", [
        drop("The Arbiter's Reliquary Key", .005, ESTIMATE, { note: "Reported as <1%; 0.5% is a reviewable midpoint placeholder." }),
      ]),
      extra("lineage", "Lineage supports", [
        drop("Arbiter's Ignition", .03),
      ]),
    ],
  },
  {
    id: "uber-arbiter-of-ash", name: "Uber The Arbiter of Ash", group: "Pinnacle", groupTags: ["Atlas"], location: "The Burning Monolith",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Arbiter_of_Ash", rateSummary: "uber · supplied wiki n=100",
    entry: entry(["Faded Crisis Fragment"], ["Ancient Crisis Fragment"], ["Weathered Crisis Fragment"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Morior Invictus", .41), drop("Solus Ipse", .23), drop("Sine Aequo", .06),
        drop("Ab Aeterno", .08), drop("Sacred Flame", .07), drop("Prism of Belief", .15),
      ]),
      extra("reliquary", "Reliquary key", [
        drop("The Arbiter's Reliquary Key", .005, ESTIMATE, { note: "Reported as <1%; 0.5% is a reviewable midpoint placeholder." }),
      ]),
      extra("lineage", "Lineage supports", [
        drop("Arbiter's Ignition", .06),
      ]),
    ],
  },
  {
    id: "zarokh", name: "Zarokh, the Temporal", group: "Trials", location: "Trial of the Sekhemas",
    sourceUrl: "https://www.poe2wiki.net/wiki/Zarokh,_the_Temporal", rateSummary: "wiki relic table + lineage estimates",
    entryNote: "A four-floor Djinn Barya has variable modifiers and no single honest entry quote, so entry cost is not subtracted.",
    groups: [
      pool("relic", "At least one unique relic", [
        drop("The Burden of Leadership", .355), drop("The Peacemaker's Draught", .355),
        drop("The Desperate Alliance", .195), drop("The Changing Seasons", .09),
        drop("The Last Flame", .001, ESTIMATE, { note: "The wiki reports <0.1%; the upper bound is used for EV." }),
      ], { sampled: true }),
      extra("lineage", "Lineage supports", [
        estimated("Zarokh's Revolt", .05, "Uncommon", "No sampled rate supplied; provisional 5%."),
        estimated("Varashta's Blessing", .03, "Rare", "No sampled rate supplied; provisional 3%."),
        estimated("Zarokh's Refrain", .02, "Rare", "No sampled rate supplied; provisional 2%."),
      ]),
    ],
  },
  {
    id: "trialmaster", name: "The Trialmaster", group: "Trials", location: "Trial of Chaos",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Trialmaster", rateSummary: "Maxroll rarity estimates",
    entry: entry(["Cowardly Fate"], ["Deadly Fate"], ["Victorious Fate"]),
    groups: [pool("unique", "One guaranteed unique", [
      estimated("Glimpse of Chaos", .34, "Common"), estimated("Zerphi's Genesis", .34, "Common"),
      estimated("Mahuxotl's Machination", .18, "Uncommon"), estimated("Hateforge", .07, "Very Rare"),
      estimated("The Adorned", .07, "Very Rare"),
    ])],
  },
  {
    id: "olroth", name: "Olroth, Origin of the Fall", group: "Expedition", location: "Expedition Logbook",
    sourceUrl: "https://www.poe2wiki.net/wiki/Olroth,_Origin_of_the_Fall", rateSummary: "Maxroll rarity estimates",
    entryNote: "A Logbook contains more than this boss and has variable implicit value, so no whole-Logbook entry cost is charged to one kill.",
    groups: [
      fixed("guaranteed", "Guaranteed", [drop("Shattered Triskelion", 1, ESTIMATE, { note: "Maxroll labels this Always." })]),
      pool("unique", "Boss unique pool", [
        estimated("Keeper of the Arc", .35, "Common"), estimated("Olrovasara", .35, "Common"),
        estimated("Svalinn", .13, "Rare"), estimated("Heroic Tragedy", .13, "Rare"),
        estimated("Olroth's Resolve", .02, "Extremely Rare"), estimated("Olroth's Reliquary Key", .02, "Extremely Rare"),
      ]),
      extra("lineage", "Lineage supports", [
        estimated("Uhtred's Exodus", .06, "Uncommon"), estimated("Uhtred's Omen", .02, "Very Rare"),
        estimated("Uhtred's Augury", .005, "Extremely Rare"),
      ]),
    ],
  },
  {
    id: "uhtred", name: "Uhtred, the Stardrinker", group: "Expedition", location: "Expedition Logbook",
    sourceUrl: "https://www.poe2wiki.net/wiki/Uhtred,_the_Stardrinker", rateSummary: "Maxroll estimates",
    entryNote: "A Logbook contains more than this boss, so entry cost is omitted.",
    groups: [
      pool("unique", "Boss unique pool", [
        estimated("Uhtred's Crest of the Chalice", .50, "Common"), estimated("Uhtred's Chalice", .50, "Common"),
      ]),
      extra("lineage", "Lineage supports", [
        estimated("Uhtred's Rite", .05, "Unrated"), estimated("Uhtred's Constellation", .03, "Unrated"),
      ]),
      extra("runes", "Runes", [
        drop("Depleted Mana Rune", .02, ESTIMATE, {
          rarity: "Unrated",
          aliases: ["Runeseeker's Call"],
          priceProxy: "Runeseeker's Call",
          note: "The Rune converts into Runeseeker's Call, whose exchange quote is used as its market value.",
        }),
      ]),
    ],
  },
  {
    id: "styrn", name: "Styrn, Fallen Knight of Aldur", group: "Expedition", location: "Tomb of the Fallen Knight",
    sourceUrl: "https://www.poe2wiki.net/wiki/Styrn,_Fallen_Knight_of_Aldur", rateSummary: "Maxroll estimates",
    groups: [
      fixed("guaranteed", "Guaranteed", [drop("Expedition Logbook", 1, ESTIMATE, { note: "Maxroll labels this Guaranteed." })]),
      pool("crest", "One expedition crest", [
        drop("Olroth's Crest of the Sun", .25, ESTIMATE, { note: "No weights supplied; equal shares are provisional." }),
        drop("Uhtred's Crest of the Chalice", .25, ESTIMATE, { note: "No weights supplied; equal shares are provisional." }),
        drop("Medved's Crest of the Circle", .25, ESTIMATE, { note: "No weights supplied; equal shares are provisional." }),
        drop("Vorana's Crest of the Scythe", .25, ESTIMATE, { note: "No weights supplied; equal shares are provisional." }),
      ]),
      extra("lineage", "Lineage supports", [
        estimated("Styrn's Mountain", .05, "Unrated"), estimated("Styrn's Ferocity", .02, "Unrated"),
      ]),
    ],
  },
  {
    id: "aberration", name: "The Aberration", group: "Expedition", location: "Ruins of Kingsmarch",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Aberration", rateSummary: "supplied wiki table",
    entry: entry(["The Triskelion Reforged"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Venerable Starlit Ore", .36), drop("Warding Starlit Ore", .32),
        drop("Veridical Starlit Ore", .16), drop("Revered Starlit Ore", .12), drop("Twisted Empyrean", .04),
      ]),
      extra("lineage", "Lineage supports", [
        drop("Olroth's Conviction", .06), drop("Olroth's Hubris", .04),
      ]),
      extra("runes", "Runes", [
        drop("Emergent Instinct", .025), drop("Emergent Protection", .02),
        drop("Emergent Vigour", .005), drop("Emergent Possibility", .015),
      ]),
    ],
  },
  {
    id: "xesht", name: "Xesht, We That Are One", group: "Breach", location: "The Twisted Domain",
    sourceUrl: "https://www.poe2wiki.net/wiki/Xesht,_We_That_Are_One", rateSummary: "supplied wiki n=143",
    entry: entry(["Breachstone"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        drop("Beyond Reach", .295), drop("Xoph's Blood", .14), drop("The Pandemonius", .105),
        drop("Choir of the Storm", .175), drop("Hand of Wisdom and Action", .10),
        drop("Skin of the Loyal", .07), drop("Controlled Metamorphosis", .11),
        drop("Xesht's Reliquary Key", .005),
      ], { sampled: true }),
      extra("lineage", "Lineage supports", [
        drop("Xoph's Pyre", .03),
        drop("Tul's Stillness", .01, ESTIMATE, { note: "The supplied wiki table shows ?; 1% is inferred from the neighbouring lineage rates." }),
        drop("Esh's Radiance", .01), drop("Uul-Netol's Embrace", .015),
      ]),
    ],
  },
  {
    id: "simulacrum", name: "Simulacrum", group: "Delirium", location: "Simulacrum of Delusion",
    sourceUrl: "https://www.poe2wiki.net/wiki/Simulacrum", rateSummary: "poe2wiki n=59",
    entry: entry(["Simulacrum"]),
    groups: [
      pool("unique", "One wave-7 unique", [
        drop("Assailum", .42), drop("Perfidy", .33), drop("Collapsing Horizon", .10),
        drop("Melting Maelstrom", .04), drop("Strugglescream", .02),
        drop("Megalomaniac", .03, WIKI, {
          label: "Megalomaniac (2 mod)", variant: "2 mod", allowBaseVariantPrice: true, gamble: true,
          note: "Uses poe.ninja's normal Megalomaniac quote as a conservative floor; valuable notable combinations can sell for many Divines.",
        }),
        drop("Megalomaniac", .03, WIKI, {
          key: "Megalomaniac (3 mod)", label: "Megalomaniac (3 mod)", variant: "3 mod", allowBaseVariantPrice: true, gamble: true,
          note: "Uses poe.ninja's normal Megalomaniac quote as a conservative floor; valuable notable combinations can sell for many Divines.",
        }),
        drop("Voices", .01, ESTIMATE, { note: "Reported as ~1%." }),
        drop("Tangmazu's Reliquary Key", .005, ESTIMATE, { note: "Reported as <1%; 0.5% is used for EV." }),
      ], { sampled: true }),
      fixed("reflection", "Guaranteed encounter items", [drop("Raven's Reflection", 1.2, WIKI, { note: "80% one copy and 20% two copies = 1.2 expected." })]),
    ],
  },
  {
    id: "king-in-mists", name: "The King in the Mists", group: "Ritual", location: "Crux of Nothingness",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_King_in_the_Mists", rateSummary: "Maxroll rarity estimates",
    entry: entry(["An Audience with the King"]),
    groups: [
      pool("unique", "One guaranteed unique", [
        estimated("Beetlebite", .40, "Common"), estimated("Ingenuity", .40, "Common"),
        estimated("The Burden of Shadows", .08, "Rare"), estimated("Pragmatism", .02, "Very Rare"),
        estimated("From Nothing", .08, "Rare"), estimated("Ritualistic Reliquary Key", .02, "Extremely Rare"),
      ]),
      fixed("head", "Guaranteed", [drop("Head of the King", 1, ESTIMATE, { note: "Maxroll labels this Guaranteed." })]),
      pool("omen", "At least one guaranteed Omen", OmenPool),
    ],
  },
  {
    id: "kulemak-immediate", name: "Vessel of Kulemak (take the ring)", group: "Abyss", location: "The Black Cathedral",
    sourceUrl: "https://www.poe2wiki.net/wiki/Vessel_of_Kulemak", rateSummary: "supplied wiki n=200",
    entry: entry(["Kulemak's Invitation"]),
    groups: [
      fixed("ring", "Guaranteed", [drop("Grip of Kulemak", 1)]),
      pool("bone", "One preserved bone", [
        drop("Ancient Jawbone", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
        drop("Ancient Rib", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
        drop("Ancient Collarbone", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
      ]),
      pool("unique", "Take the ring immediately", [drop("The Unborn Lich", .38), drop("Darkness Enthroned", .62)]),
      extra("lineage", "Lineage supports", [drop("Tecrod's Revenge", .065, COMMUNITY, { note: "Supplied range 6–7%; midpoint used." })]),
    ],
  },
  {
    id: "kulemak-full", name: "Vessel of Kulemak (fully empowered)", group: "Abyss", location: "The Black Cathedral",
    sourceUrl: "https://www.poe2wiki.net/wiki/Vessel_of_Kulemak", rateSummary: "supplied wiki n=200",
    entry: entry(["Kulemak's Invitation"]),
    groups: [
      fixed("ring", "Guaranteed", [drop("Grip of Kulemak", 1)]),
      pool("bone", "One preserved bone", [
        drop("Ancient Jawbone", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
        drop("Ancient Rib", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
        drop("Ancient Collarbone", 1 / 3, ESTIMATE, { note: "No relative weights supplied; equal shares are provisional." }),
      ]),
      pool("unique", "Fully empowered unique", [
        drop("The Unborn Lich", .38), drop("Darkness Enthroned", .56),
        drop("Undying Hate", .04), drop("The Master's Reach", .02),
      ]),
      extra("lineage", "Lineage supports", [drop("Tecrod's Revenge", .065, COMMUNITY, { note: "Supplied range 6–7%; midpoint used." })]),
    ],
  },
  {
    id: "atziri", name: "Atziri, the Red Queen", group: "Fate of the Vaal", location: "Atziri's Temple",
    sourceUrl: "https://www.poe2wiki.net/wiki/Atziri,_the_Red_Queen", rateSummary: "supplied wiki n=100 + 0.5.4 estimates",
    entryNote: "Temple construction has no single tradeable entry item, so entry cost is omitted.",
    groups: [
      pool("unique", "One vault unique", [
        drop("Atziri's Step", .35), drop("Drillneck", .32), drop("Atziri's Splendour", .12),
        drop("Atziri's Rule", .12), drop("Atziri's Contempt", .08), drop("Flesh Crucible", .01),
      ]),
      extra("lineage", "Lineage supports", [
        drop("Atziri's Impatience", .08), drop("Zerphi's Infamy", .11),
        drop("Atziri's Communion", .05, ESTIMATE, { note: "The supplied table shows ?; provisional 5%." }),
      ]),
      extra("sacrifice", "Orbs of Sacrifice", [
        drop("Kamasa's Orb of Sacrifice", .025, ESTIMATE, { note: "The overall and relative rates are unpublished; provisional 10% total split equally." }),
        drop("Kopec's Orb of Sacrifice", .025, ESTIMATE, { note: "The overall and relative rates are unpublished; provisional 10% total split equally." }),
        drop("Yaomac's Orb of Sacrifice", .025, ESTIMATE, { note: "The overall and relative rates are unpublished; provisional 10% total split equally." }),
        drop("Yugul's Orb of Sacrifice", .025, ESTIMATE, { note: "The overall and relative rates are unpublished; provisional 10% total split equally." }),
      ]),
    ],
  },
  {
    id: "jade-isles", name: "Manoki, the Chosen", group: "Anomaly", location: "The Jade Isles",
    sourceUrl: "https://www.poe2wiki.net/wiki/The_Jade_Isles", rateSummary: "poe2wiki approximate",
    groups: [pool("lineage", "Anomaly lineage pool", [
      drop("Tawhoa's Tending", .48), drop("Tasalio's Rhythm", .35),
      drop("Kaom's Madness", .15), drop("Rakiata's Flow", .02),
    ])],
  },
  {
    id: "sacred-reservoir", name: "Zahmir, the Blade Sovereign", group: "Anomaly", location: "Sacred Reservoir",
    sourceUrl: "https://www.poe2wiki.net/wiki/Sacred_Reservoir", rateSummary: "poe2wiki approximate",
    groups: [pool("lineage", "Anomaly lineage pool", [
      drop("Varashta's Blessing", .60), drop("Khatal's Rejuvenation", .20),
      drop("Zarokh's Refrain", .15), drop("Garukhan's Resolve", .05),
    ])],
  },
  {
    id: "derelict-mansion", name: "Varloch, the Ashen Lord and Avelyne, the Withered Rose", group: "Anomaly", location: "Derelict Mansion",
    sourceUrl: "https://www.poe2wiki.net/wiki/Derelict_Mansion", rateSummary: "provisional community split · needs review",
    groups: [pool("lineage", "Anomaly lineage pool", [
      drop("Ailith's Chimes", .50, ESTIMATE, { note: "Provisional 50% split based on an unverified community report; supplied wiki screenshot has no rates." }),
      drop("Einhar's Beastrite", .40, ESTIMATE, { note: "Provisional 40% split based on an unverified community report; supplied wiki screenshot has no rates." }),
      drop("Rigwald's Ferocity", .10, ESTIMATE, { note: "Provisional 10% split based on an unverified community report; supplied wiki screenshot has no rates." }),
    ])],
  },
  {
    id: "sealed-vault", name: "Ytzara, Blood Oracle and Maztli, Flesh-Shaper", group: "Anomaly", location: "Sealed Vault",
    sourceUrl: "https://www.poe2wiki.net/wiki/Sealed_Vault", rateSummary: "wiki pool · reviewable weights",
    groups: [pool("lineage", "Anomaly lineage pool", [
      drop("Paquate's Pact", .45, ESTIMATE, { note: "The wiki names the pool but publishes no weights; provisional 45%." }),
      drop("Xibaqua's Rending", .30, ESTIMATE, { note: "The wiki names the pool but publishes no weights; provisional 30%." }),
      drop("Atalui's Bloodletting", .15, ESTIMATE, { note: "The wiki names the pool but publishes no weights; provisional 15%." }),
      drop("Atziri's Allure", .10, ESTIMATE, { note: "The wiki names the pool but publishes no weights; provisional 10%." }),
    ])],
  },
];

export function bossDropKey(bossId, groupId, line) {
  return `${bossId}:${groupId}:${line.key || line.item}`;
}

export function estimatedDrops() {
  return BOSSES.flatMap((boss) => boss.groups.flatMap((group) =>
    group.drops.filter((line) => line.basis === ESTIMATE).map((line) => ({ boss, group, line }))));
}
