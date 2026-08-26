/* Which PoE 2 markets belong to which league mechanic, and the tower rules that
   decide how much of each mechanic a loadout is exposed to.

   This file asserts *membership*, never drop rates. The snapshot says what an
   item is; the tower rules say how tablets interact. Neither says how much of
   anything a map actually produces, so nothing here may be read as a yield.

   Tower rules (game knowledge supplied by the user on 2026-08-22, not measured
   by this project — see docs/architecture.md):

     1. A tower node takes 3 tablets, or 4 on a city biome.
     2. Mechanic tablets compete: each one added lowers the natural spawn chance
        of the others, and filling every slot with one mechanic makes it the
        only major mechanic that spawns.
     3. More copies of a tablet means more encounters of that mechanic.
     4. Every non-unique tablet can roll 2 prefix and 2 suffix.
     5. Overseer and Irradiated sit outside the contest. They raise other loot
        through their own affixes and the atlas tree, by an amount nothing this
        project can observe.
     6. Vaal realizes late, as usable temple room rather than as drops in the
        map that ran the tablet.

   Rules 1-3 support relative exposure between mechanics. Rules 4-6 do not
   support a number at all and are surfaced as caveats instead of modelled. */

export const FAMILY_ORDER = ["atlas", "bossing", "breach", "ritual", "delirium", "abyss", "expedition", "vaal"];

export const FAMILY_LABELS = {
  atlas: "Atlas",
  bossing: "Map bosses",
  breach: "Breach",
  ritual: "Ritual",
  delirium: "Delirium",
  abyss: "Abyss",
  expedition: "Expedition",
  vaal: "Fate of the Vaal",
};

export const TONES = {
  atlas: "#d19a52",
  bossing: "#c46c52",
  breach: "#9b72db",
  ritual: "#a66bba",
  delirium: "#7892bb",
  abyss: "#6a8f61",
  expedition: "#5ea97d",
  vaal: "#c46c52",
};

/* Rule 2: only these compete for a map's major mechanic. */
export const COMPETING = ["breach", "ritual", "delirium", "abyss", "expedition", "vaal"];

/* Rule 5: these occupy a slot without taking a share of the contest. */
export const NEUTRAL = ["bossing", "atlas"];

/* Rule 1. */
export const SLOTS = { standard: 3, city: 4 };

/* Rule 6. */
export const DEFERRED = {
  vaal: "Vaal grants usable temple room rather than immediate drops, so its return is realized in later maps and is not comparable per map with a mechanic like Abyss that drops directly.",
};

/* Rule 5, said once where the UI can quote it. */
export const NEUTRAL_NOTE = "Overseer and Irradiated tablets do not compete for the map's major mechanic and have no attributable output market. They raise other loot through their own affix rolls and atlas-tree choices by an amount no available data measures.";

/* Rule 4. */
export const FLOOR_NOTE = "Tablet and logbook quotes are Normal-rarity only — no source prices a rolled one — so every entry cost here is a floor rather than the price of what someone would actually run.";

/* Rule 3b: a tablet covers the maps in its tower's radius, roughly ten of them,
   and an Expedition Logbook grants roughly ten maps of Expedition. One block of
   access either way, so the two quotes compare directly and neither is divided
   down to a per-map figure — "around ten" is too soft to bake into an absolute
   number the page displays.

   Most mechanics are entered through their precursor tablet, which is what
   `buildTabletFamilies` already resolves. Expedition is not: no source prices
   an Expedition Tablet, and the logbook is the thing people actually buy. It is
   matched on its tag rather than its name for the same reason the pools are —
   a rename should not silently unprice the entry side.

   The logbook is deliberately left in the Expedition return pool as well. An
   expedition drops logbooks, so sustain is part of what the mechanic returns,
   and holding it out would understate Expedition. The consequence is that one
   item sits on both sides of that card, which damps the spread a little
   (+11.9% against +12.1% held out on the checked-in snapshot); ENTRY_DUAL_ROLE
   is what the card says about it rather than leaving a reader to assume the two
   sides are independent. */
export const ENTRY_SOURCES = {
  expedition: {
    kind: "logbook",
    tag: /^expedition_logbook$/,
    label: "Expedition Logbook",
    unit: "roughly 10 maps of Expedition, the same block of access a tablet buys",
  },
};

export const ENTRY_DUAL_ROLE = "Expeditions drop logbooks, so the logbook is both the entry cost here and part of the return basket. Sustain is counted rather than ignored, which damps the spread slightly.";

/* Anything without a declaration is entered through its precursor tablet. */
export function entrySource(id) {
  return ENTRY_SOURCES[id] || null;
}

/* Resolved from the snapshot rather than from a name list, so a mechanic whose
   entry item is simply not quoted this hour reports an unknown entry instead of
   borrowing some other market's price. */
export function resolveEntry(id, prices = {}) {
  const source = ENTRY_SOURCES[id];
  if (!source) return null;
  for (const [name, entry] of Object.entries(prices || {})) {
    if ((entry?.tags || []).some((tag) => source.tag.test(tag))) return { ...source, name, entry };
  }
  return { ...source, name: null, entry: null };
}

/* The exchange category is only trustworthy as a mechanic name when it came
   from GGG's own feed. PoE2Scout's CategoryApiId lands in the same field in
   lower case and means something else entirely: its `expedition` family holds
   Soul Cores and its `ritual` family holds Idols. */
const GGG_SOURCE = "GGG completed trades";

const MECHANIC_POOLS = {
  breach: { family: "Breach" },
  ritual: { family: "Ritual" },
  /* Simulacrum and its splinter trade under the generic Fragments family, so
     the affliction tags are what puts them back with Delirium. */
  delirium: { family: "Delirium", tag: /^affliction_(splinter|orb)$/ },
  /* GGG's exchange puts every Omen in Ritual. RePoE's stable metadata paths
     distinguish the Abyss crafting omens, so this specific rule must win over
     the broader exchange family below. The eight current paths use both
     `OmenOnAbyss...` and forms such as `OmenOnAnnulRemoveAbyssMod`, so Abyss
     is matched anywhere in the stable Omen path rather than in the name. */
  abyss: { family: "Abyss", paths: [/^Metadata\/Items\/Currency\/OmenOn[^/]*Abyss/] },
  expedition: { family: "Expedition" },
  /* Incursion has no GGG family of its own; the metadata path is the whole
     pool, Vaal currencies plus the four Theses. */
  vaal: { paths: [/^Metadata\/Items\/Currency\/CurrencyIncursion/, /^Metadata\/Items\/SoulCores\/Thesis/] },
};

/* Uniques are a mechanic's most-wanted output and no structural field connects
   them to it: Xoph's Blood is just a UniqueAccessory. Names are therefore
   curated, verified against poe2db.tw on 2026-08-22 — membership only, since
   that source publishes no weights either.

   Curated data references items by display name, so a rename silently unprices
   a line. `curatedCoverage` reports any name that matched nothing rather than
   letting it disappear. */
const CURATED = {
  breach: [
    "Nightfall", "Xoph's Blood", "Choir of the Storm", "The Pandemonius",
    "Hand of Wisdom and Action", "Beyond Reach", "Controlled Metamorphosis",
    "Skin of the Loyal", "Breachlord Sac",
  ],
  ritual: [
    "Pragmatism", "The Burden of Shadows", "Beetlebite", "From Nothing",
    "Ingenuity", "An Audience with the King", "Head of the King", "Call of the Shadows",
  ],
  delirium: [
    "Assailum", "Melting Maelstrom", "Perfidy", "Collapsing Horizon",
    "Strugglescream", "Megalomaniac", "Voices", "Raven's Reflection",
  ],
  abyss: [
    "Darkness Enthroned", "Grip of Kulemak", "Heart of the Well",
    "The Unborn Lich", "Undying Hate", "Kulemak's Invitation",
  ],
  expedition: [
    "Eventide Petals", "Uhtred's Chalice", "Svalinn", "Keeper of the Arc",
    "Olroth's Resolve", "Olrovasara", "Heroic Tragedy",
  ],
  /* Vaal's structural pool already covers its tradeable output; poe2db has no
     reachable Atziri's Temple page to curate uniques from. Left empty rather
     than guessed. */
  vaal: [],
};

/* GGG groups every Omen under Ritual for trading. RePoE's metadata paths and
   poe2db's Abyss related-item list provide the narrower drop-source identity,
   so Abyss-specific omens are reassigned without double counting. */
export const POOL_CAVEATS = {
  ritual: "GGG's exchange groups every Omen under Ritual. Abyss-specific Omens are reassigned from their RePoE metadata paths, so this basket keeps the remaining Ritual markets.",
  abyss: "Abyss-specific Omens are assigned here from their RePoE metadata paths even though GGG's exchange lists every Omen under Ritual.",
};

function matchesSpecific(rule, entry) {
  if (!rule) return false;
  if (rule.tag && (entry?.tags || []).some((tag) => rule.tag.test(tag))) return true;
  if (rule.paths?.some((path) => path.test(String(entry?.metadataPath || "")))) return true;
  return false;
}

function matchesFamily(rule, entry) {
  return !!rule?.family && entry?.source === GGG_SOURCE && entry?.marketFamily === rule.family;
}

/* Structural identity only. A name reaches a mechanic through curation instead
   when nothing in its metadata connects it. */
export function mechanicFor(name, entry) {
  /* Specific tags and paths take precedence over GGG's broad trading family.
     This is what keeps an Abyss Omen out of Ritual while leaving ordinary
     Ritual Omens there. */
  for (const id of COMPETING) if (matchesSpecific(MECHANIC_POOLS[id], entry)) return id;
  for (const id of COMPETING) if (matchesFamily(MECHANIC_POOLS[id], entry)) return id;
  return null;
}

const curatedIndex = () => {
  const index = new Map();
  for (const [id, names] of Object.entries(CURATED)) for (const name of names) index.set(name, id);
  return index;
};

/* An item earns a place in the weighted index only if it carries the evidence
   the weights are built from. GGG volume and poe.ninja listing counts are not
   the same measurement, so a stash-quoted unique is held back as a chase item
   rather than given a fabricated share of a volume-weighted basket. */
const tradeable = (entry) => Number(entry?.volume1H) > 0;

export function mechanicPools(prices = {}) {
  const pools = Object.fromEntries(COMPETING.map((id) => [id, { id, label: FAMILY_LABELS[id], members: [], chase: [] }]));
  const curated = curatedIndex();
  const claimed = new Set();

  for (const [name, entry] of Object.entries(prices || {})) {
    const id = mechanicFor(name, entry);
    if (!id) continue;
    pools[id].members.push({ name, entry, curated: false });
    claimed.add(name);
  }

  for (const [name, id] of curated) {
    const entry = prices?.[name];
    if (!entry || claimed.has(name)) continue;
    claimed.add(name);
    (tradeable(entry) ? pools[id].members : pools[id].chase).push({ name, entry, curated: true });
  }

  for (const pool of Object.values(pools)) {
    pool.members.sort((left, right) => Number(right.entry.exalted || 0) - Number(left.entry.exalted || 0));
    pool.chase.sort((left, right) => Number(right.entry.exalted || 0) - Number(left.entry.exalted || 0));
    pool.caveat = POOL_CAVEATS[pool.id] || null;
  }
  return pools;
}

export function curatedCoverage(prices = {}) {
  const missing = [];
  let total = 0;
  for (const [id, names] of Object.entries(CURATED)) {
    for (const name of names) {
      total += 1;
      if (!prices?.[name]) missing.push({ mechanic: id, name });
    }
  }
  return { total, matched: total - missing.length, missing };
}

export const hasOutputPool = (id) => COMPETING.includes(id);
