/* What poe.ninja documents for PoE 2, what this project fetches, and why the
   rest is left alone. Same split as the PoE 1 registry: the documented list and
   the consumed subset are different things and both belong in one place.

   Transcribed from https://poe.ninja/docs/api and verified on 2026-08-21. Four
   documented exchange types were missing from the fetcher before that check —
   UncutGems, Essences, Idols and Runes — so every item in them was either
   unpriced or fell through to a listing feed.

   `unit` states what a parsed row is denominated in before conversion, because
   getting that wrong scales an entire category silently. */

export const VERIFIED = "2026-08-21";
export const DOCS_URL = "https://poe.ninja/docs/api";

export const FAMILIES = {
  exchange: {
    id: "ninja.poe2.exchange",
    path: "/exchange/current/overview",
    quotes: "primaryValue in the response's declared primary currency",
  },
  stashItem: {
    id: "ninja.poe2.stashItem",
    path: "/stash/current/item/overview",
    quotes: "primaryValue in the response's declared primary currency",
  },
};

export const DOCUMENTED = [
  // ---- exchange ----
  { type: "Currency", family: "exchange", category: "Currency", unit: "primary", enabled: true, consumer: "price tracker, boss EV, Divine/Exalted rate" },
  { type: "Fragments", family: "exchange", category: "Fragments & keys", unit: "primary", enabled: true, consumer: "boss entry costs" },
  { type: "Abyss", family: "exchange", category: "League items", unit: "primary", enabled: true, consumer: "boss drops, price tracker" },
  { type: "UncutGems", family: "exchange", category: "Gems", unit: "primary", enabled: true, consumer: "boss drops (uncut skill/support/spirit gems), price tracker" },
  { type: "LineageSupportGems", family: "exchange", category: "Gems", unit: "primary", enabled: true, consumer: "boss drop tables" },
  { type: "Essences", family: "exchange", category: "Crafting materials", unit: "primary", enabled: true, consumer: "price tracker, crafting category" },
  { type: "SoulCores", family: "exchange", category: "Crafting materials", unit: "primary", enabled: true, consumer: "boss drops, price tracker" },
  { type: "Idols", family: "exchange", category: "League items", unit: "primary", enabled: true, consumer: "price tracker, league category" },
  { type: "Runes", family: "exchange", category: "Crafting materials", unit: "primary", enabled: true, consumer: "boss drop tables (rune pools), price tracker" },
  { type: "Ritual", family: "exchange", category: "League items", unit: "primary", enabled: true, consumer: "boss drops, price tracker" },
  { type: "Expedition", family: "exchange", category: "League items", unit: "primary", enabled: true, consumer: "price tracker" },
  { type: "Delirium", family: "exchange", category: "Crafting materials", unit: "primary", enabled: true, consumer: "price tracker" },
  { type: "Breach", family: "exchange", category: "League items", unit: "primary", enabled: true, consumer: "boss drops, price tracker" },
  { type: "Verisium", family: "exchange", category: "Crafting materials", unit: "primary", enabled: true, consumer: "price tracker" },

  // ---- stash items ----
  { type: "UniqueWeapons", family: "stashItem", category: "Unique gear", unit: "primary", enabled: true, consumer: "boss drop tables, price tracker" },
  { type: "UniqueArmours", family: "stashItem", category: "Unique gear", unit: "primary", enabled: true, consumer: "boss drop tables, price tracker" },
  { type: "UniqueAccessories", family: "stashItem", category: "Unique gear", unit: "primary", enabled: true, consumer: "boss drop tables, price tracker" },
  { type: "UniqueFlasks", family: "stashItem", category: "Unique gear", unit: "primary", enabled: true, consumer: "price tracker" },
  { type: "UniqueCharms", family: "stashItem", category: "Unique gear", unit: "primary", enabled: true, consumer: "price tracker" },
  { type: "UniqueJewels", family: "stashItem", category: "Jewels & relics", unit: "primary", enabled: true, consumer: "boss drop tables" },
  { type: "UniqueSanctumRelics", family: "stashItem", category: "Jewels & relics", unit: "primary", enabled: true, consumer: "price tracker" },
  { type: "UniqueTablets", family: "stashItem", category: "Maps & tablets", unit: "primary", enabled: true, consumer: "Popular farms (context tiles)" },
  { type: "PrecursorTablets", family: "stashItem", category: "Maps & tablets", unit: "primary", enabled: true, consumer: "Popular farms baseline" },
];

const enabledIn = (family) => DOCUMENTED.filter((entry) => entry.family === family && entry.enabled).map((entry) => entry.type);

export const EXCHANGE_TYPES = enabledIn("exchange");
export const STASH_TYPES = enabledIn("stashItem");
export const OMITTED = DOCUMENTED.filter((entry) => !entry.enabled);

/* Currency is the calibration and rate source; without it the whole snapshot is
   unscaled, so an empty response there is a failure rather than a quiet hour. */
export const REQUIRED_TYPES = [{ family: "exchange", type: "Currency" }];
