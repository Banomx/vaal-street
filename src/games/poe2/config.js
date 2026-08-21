import { gameDataBase } from "../../shared/data/paths.js";

export const POE2_STATIC_BASE = gameDataBase("poe2");

/* Data formats this build knows how to read. The generator stamps
   `schemaVersion` on every document it writes (scripts/poe2/validate.mjs owns
   the number); anything not listed here is refused visibly rather than
   rendered on a guess. Add the new number here in the same change that starts
   writing it, and keep the old one until no deployment can still be serving
   it. */
export const POE2_SCHEMA_VERSIONS = [1];

/* Fallback filenames for an index whose league entries do not name their own
   files. Current runs always write the `files` map, so this only covers a
   deployment mid-swap or a carried-forward tree from an older run. */
export const POE2_LEAGUE_FILES = {
  prices: "prices.json",
  priceHistory: "price-history.json",
  exchangeMarkets: "exchange-markets.json",
  exchangeHistory: "exchange-history.json",
};
