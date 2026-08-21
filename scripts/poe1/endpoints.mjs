/* What poe.ninja documents for PoE 1, what this project actually fetches, and
   why the rest is left alone.

   These are two different lists and they were previously mixed together, which
   made "is this type missing on purpose?" unanswerable without archaeology.
   `DOCUMENTED` is transcribed from https://poe.ninja/docs/api. `enabled: false`
   means a documented type we deliberately do not request, and the reason is
   part of the entry rather than a comment somewhere else.

   Verified against the published docs on 2026-08-21. When poe.ninja moves
   again, re-check with `node scripts/poe1/tools/probe-price.mjs --counts` and
   update `VERIFIED` below — the date is the claim, so it has to move with the
   check. */

export const VERIFIED = "2026-08-21";
export const DOCS_URL = "https://poe.ninja/docs/api";

/* Documented endpoint families, and the shape each one answers with. The
   difference matters: exchange lines quote `primaryValue` in a reference
   currency that is not always chaos, while stash lines quote chaos directly.
   Reading a family from the wrong endpoint gives numbers that look plausible
   and are wrong. */
export const FAMILIES = {
  exchange: {
    id: "ninja.exchange",
    url: (league, type) => `/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`,
    quotes: "primaryValue in the response's primary reference currency",
  },
  stashItem: {
    id: "ninja.stashItem",
    url: (league, type) => `/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${type}`,
    quotes: "chaosValue",
  },
  stashCurrency: {
    id: "ninja.stashCurrency",
    url: (league, type) => `/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(league)}&type=${type}`,
    quotes: "chaosEquivalent",
  },
};

/* `consumer` names the feature that would break if the type stopped answering,
   which is the only honest justification for spending a request on it. */
export const DOCUMENTED = [
  // ---- exchange: everything fungible ----
  { type: "Currency", family: "exchange", enabled: true, consumer: "broad price map, divine rate, chaos calibration" },
  { type: "Fragment", family: "exchange", enabled: true, consumer: "boss entry costs" },
  { type: "Scarab", family: "exchange", enabled: true, consumer: "Scarabs tab, Popular farms, Strat Watcher" },
  { type: "Astrolabe", family: "exchange", enabled: true, consumer: "Astrolabes tab, Strat Watcher" },
  { type: "Omen", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "Tattoo", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "AllflameEmber", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "Runegraft", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "DjinnCoin", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "DivinationCard", family: "exchange", enabled: true, consumer: "boss drop tables" },
  { type: "Artifact", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "Oil", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "DeliriumOrb", family: "exchange", enabled: true, consumer: "broad price map" },
  { type: "Fossil", family: "exchange", enabled: true, consumer: "Delve biome EV, Fossils tab" },
  { type: "Resonator", family: "exchange", enabled: true, consumer: "Resonators tab" },
  { type: "Essence", family: "exchange", enabled: true, consumer: "broad price map" },
  {
    type: "Ducat", family: "exchange", enabled: false,
    reason: "Kalguur-league currency. No tab or curated dataset references it, so it would cost a request per run for nothing.",
  },
  {
    type: "EnshroudingCrystal", family: "exchange", enabled: false,
    reason: "League-specific and unreferenced by any boss, Delve or category dataset. Enable together with a consumer, not before.",
  },

  // ---- stash items: everything priced per listing ----
  { type: "UniqueWeapon", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "UniqueArmour", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "UniqueAccessory", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "UniqueFlask", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "UniqueJewel", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "SkillGem", family: "stashItem", enabled: true, consumer: "Gem levelling tab, boss gem drops" },
  { type: "Map", family: "stashItem", enabled: true, consumer: "boss entry costs, tier 17 maps" },
  { type: "UniqueMap", family: "stashItem", enabled: true, consumer: "boss drop tables" },
  { type: "BlightedMap", family: "stashItem", enabled: true, consumer: "broad price map" },
  { type: "BlightRavagedMap", family: "stashItem", enabled: true, consumer: "broad price map" },
  { type: "Invitation", family: "stashItem", enabled: true, consumer: "Eldritch boss entry costs" },
  { type: "Vial", family: "stashItem", enabled: true, consumer: "Incursion boss drops" },
  { type: "Beast", family: "stashItem", enabled: true, consumer: "broad price map" },
  { type: "UniqueRelic", family: "stashItem", enabled: true, consumer: "broad price map" },
  {
    type: "BaseType", family: "stashItem", enabled: false,
    reason: "~18k crafting-base rows. Nothing prices a bare base, and the download would dominate every run.",
  },
  {
    type: "ForbiddenJewel", family: "stashItem", enabled: false,
    reason: "Forbidden Flame/Flesh are priced through their unidentified markets on poe.watch, which is what a boss actually drops.",
  },
  {
    type: "ClusterJewel", family: "stashItem", enabled: false,
    reason: "Rolled crafting output rather than a boss drop; no curated dataset references a cluster jewel by name.",
  },
  {
    type: "ImbuedGem", family: "stashItem", enabled: false,
    reason: "Not a levelling target and not a boss drop. SkillGem covers everything the gem tab models.",
  },
  {
    type: "Flask", family: "stashItem", enabled: false,
    reason: "Base flasks are vendor-priced; UniqueFlask covers the drops.",
  },
  {
    type: "ValdoMap", family: "stashItem", enabled: false,
    reason: "Retired content. Re-enable with a consumer if it returns.",
  },
  { type: "Memory", family: "stashItem", enabled: false, reason: "Probed 2026-08 on Allflame and served nothing in any family." },
  { type: "IncursionTemple", family: "stashItem", enabled: false, reason: "Probed 2026-08 and served nothing; no curated line references a temple." },
  { type: "ScryingOrb", family: "stashItem", enabled: false, reason: "Probed 2026-08 and served nothing." },
  { type: "Incubator", family: "stashItem", enabled: false, reason: "Probed 2026-08 and served nothing in any family." },
  { type: "Corpse", family: "stashItem", enabled: false, reason: "Probed 2026-08 and served nothing." },
  { type: "Wombgift", family: "stashItem", enabled: false, reason: "Probed 2026-08 and served nothing." },
  { type: "ShrineBelt", family: "stashItem", enabled: false, reason: "No curated dataset references one." },
  { type: "UniqueTincture", family: "stashItem", enabled: false, reason: "No curated dataset references one." },

  // ---- stash currency: the same goods as the exchange, priced the older way ----
  { type: "Currency", family: "stashCurrency", enabled: true, consumer: "gap-fill for names the exchange did not carry; the display-name dictionary" },
  { type: "Fragment", family: "stashCurrency", enabled: true, consumer: "gap-fill; the display-name dictionary" },
];

const enabledIn = (family) => DOCUMENTED.filter((entry) => entry.family === family && entry.enabled).map((entry) => entry.type);

export const EXCHANGE_TYPES = enabledIn("exchange");
export const STASH_ITEM_TYPES = enabledIn("stashItem");
export const STASH_CURRENCY_TYPES = enabledIn("stashCurrency");
export const OMITTED = DOCUMENTED.filter((entry) => !entry.enabled);

/* The published lists have disagreed with reality more than once, so a type
   that comes back empty from its documented family is retried against the other
   one before the run gives up on it. */
export const CROSS_CHECK = ["Invitation", "Vial", "Beast", "UniqueRelic"];

/* The pre-migration endpoint. Both legacy families answered nothing when probed
   in 2026-08, but the fallback only fires for types the documented families
   left empty, so it costs nothing until the new API moves again. It is a
   compatibility adapter, not a supported contract: its shapes are validated
   before use and its failure is never fatal. */
export const LEGACY_TYPES = ["UniqueRelic", "Vial", "Invitation"];

/* Endpoint families whose emptiness is a failure rather than a quiet market.
   Currency is the calibration source; without it every bulk price is unscaled. */
export const REQUIRED_TYPES = [
  { family: "exchange", type: "Currency" },
  { family: "exchange", type: "Scarab" },
];
