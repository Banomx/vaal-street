import { BOSSES } from "../bosses/bossData.js";

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
export const FLOOR_NOTE = "Tablet quotes are Normal-rarity only — no source prices a rolled one — so every entry cost here is a floor rather than the price of what someone would actually run.";

/* Mapping entry uses the Normal tablet for every mechanic. Logbooks stay in
   Expedition output baskets; boss logbook costs live in bosses/bossData.js. */
export const EXPEDITION_ENTRY_NOTE = "Mapping entry uses an Expedition Tablet. Logbooks remain in the output basket; logbook boss entry is priced in Boss profit.";

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
  /* Incursion has no GGG family of its own. Paths identify currencies and
     related Theses; role classification below excludes Theses from the index. */
  vaal: { paths: [/^Metadata\/Items\/Currency\/CurrencyIncursion/, /^Metadata\/Items\/SoulCores\/Thesis/] },
};

/* Uniques are themed chase output and no structural field connects
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
  vaal: [],
};

/* GGG groups every Omen under Ritual for trading. RePoE's metadata paths and
   poe2db's Abyss related-item list provide the narrower drop-source identity,
   so Abyss-specific omens are reassigned without double counting. */
export const POOL_CAVEATS = {
  expedition: "This is an Expedition market basket, including logbooks, Sagas and Flux. Market membership does not establish which encounter produces each item or its drop rate.",
  vaal: "Temple currencies form the baseline basket. Atziri rewards and related Thesis augments are shown separately; prices do not imply ordinary temple yield.",
  breach: "Catalysts, splinters and Breachstones form the market basket. Breachlord and curated chase rewards are separate. Exchange categories do not prove a drop source or rate.",
  delirium: "Liquid emotions and Simulacrum access markets form the basket. Simulacrum uniques and Raven’s Reflection are separate encounter rewards.",
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

/* Boss catalogue membership is reused without importing its probability model.
   Shared ordinary outputs (Omens, bones and logbooks) remain index candidates. */
const BOSS_FAMILIES = { Expedition: "expedition", Breach: "breach", Delirium: "delirium", Ritual: "ritual", Abyss: "abyss", "Fate of the Vaal": "vaal" };
const SHARED_GROUPS = new Set(["omen", "bone"]);
const ORDINARY_CURATED = new Set(["An Audience with the King", "Call of the Shadows", "Kulemak's Invitation"]);
const curatedIndex = () => {
  const index = new Map();
  for (const [id, names] of Object.entries(CURATED)) for (const name of names) {
    index.set(name, { id, reason: ORDINARY_CURATED.has(name) ? null : "Themed chase reward" });
  }
  for (const boss of BOSSES) {
    const id = BOSS_FAMILIES[boss.group];
    if (!id) continue;
    for (const group of boss.groups) {
      if (SHARED_GROUPS.has(group.id)) continue;
      for (const drop of group.drops) {
        if (drop.item === "Expedition Logbook") continue;
        const previous = index.get(drop.item);
        const origin = boss.name;
        index.set(drop.item, { id, reason: previous?.bosses ? `Boss reward: ${[...new Set([...previous.bosses, origin])].join(" / ")}` : `Boss reward: ${origin}`, bosses: [...new Set([...(previous?.bosses || []), origin])] });
      }
    }
  }
  index.set("Breachlord Sac", { id: "breach", reason: "Breachlord / Genesis reward and boss access item" });
  for (const name of ["Kurgal's Gaze", "Tecrod's Gaze", "Amanamu's Gaze", "Ulaman's Gaze"]) {
    index.set(name, { id: "abyss", reason: "Abyssal Depths chase augment" });
  }
  return index;
};

const validPrice = (entry) => Number.isFinite(Number(entry?.exalted)) && Number(entry.exalted) > 0;

export function mechanicPools(prices = {}) {
  const pools = Object.fromEntries(COMPETING.map((id) => [id, { id, label: FAMILY_LABELS[id], members: [], chase: [], unpriced: [] }]));
  const curated = curatedIndex();
  for (const [name, entry] of Object.entries(prices || {})) {
    const identity = curated.get(name);
    const id = identity?.id || mechanicFor(name, entry);
    if (!id) continue;
    if (!validPrice(entry)) { pools[id].unpriced.push(name); continue; }
    const thesis = /^Metadata\/Items\/SoulCores\/Thesis/.test(String(entry.metadataPath || ""));
    const reason = identity?.reason || (thesis ? "Related Vaal crafting augment; outside the baseline basket" : null);
    (reason ? pools[id].chase : pools[id].members).push({ name, entry, curated: !!identity, reason });
  }
  for (const pool of Object.values(pools)) {
    pool.members.sort((left, right) => Number(right.entry.exalted) - Number(left.entry.exalted));
    pool.chase.sort((left, right) => Number(right.entry.exalted) - Number(left.entry.exalted));
    pool.caveat = POOL_CAVEATS[pool.id] || null;
  }
  return pools;
}

export function curatedCoverage(prices = {}) {
  const index = curatedIndex();
  const missing = [...index].filter(([name]) => !validPrice(prices?.[name])).map(([name, { id }]) => ({ mechanic: id, name }));
  return { total: index.size, matched: index.size - missing.length, missing };
}

export const hasOutputPool = (id) => COMPETING.includes(id);
