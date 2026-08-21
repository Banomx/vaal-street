import { gameDataBase } from "../../shared/data/paths.js";
import { allowsDemo, allowsLiveApi, resolveDataMode } from "../../shared/data/dataMode.js";
import { CATEGORIES } from "./catalogue/categories.js";

export const POE1_STATIC_BASE = gameDataBase("poe1");

export const POE1_API_BASES = [
  "/ninja/poe1/api/data",
  "https://poe.ninja/poe1/api/data",
  "/ninja/api/data",
  "https://poe.ninja/api/data",
];

export const POE1_EXCHANGE_BASES = [
  "/ninja/poe1/api/economy",
  "https://poe.ninja/poe1/api/economy",
];

/* Data formats this build knows how to read. `scripts/poe1/validate.mjs` owns
   the number the generator stamps; anything not listed here is refused
   visibly instead of being rendered on a guess. Add the new number here in the
   same change that starts writing it, and keep the old one until no
   deployment can still be serving it. */
export const POE1_SCHEMA_VERSIONS = [1];

/* Fallback filenames for a league entry that does not name its own files.
   Current runs always write the `files` map; this covers a deployment
   mid-swap and any tree carried forward from an older run. */
export const POE1_LEAGUE_FILES = {
  prices: "prices.json",
  catalogue: "catalogue.json",
  sources: "sources.json",
  gems: "gems.json",
  gemsHistory: "gems-history.json",
  /* Scarabs used this name before every family shared one naming rule. A
     deployment written by an older run still serves it. */
  history: "history.json",
  /* One pair per market family, derived so a family added to the catalogue
     needs no second entry here. */
  ...Object.fromEntries(CATEGORIES.flatMap((category) => [
    [category.key, `${category.key}.json`],
    [`${category.key}History`, `${category.key}-history.json`],
  ])),
};

/* Which data sources this page may use — see ../../shared/data/dataMode.js.
   For PoE 1 that is: the generated snapshots (always), poe.ninja's API (dev
   and ?data=live only) and the sample dataset (?data=demo, or the last resort
   in dev). */
export function currentDataMode() {
  const search = typeof window !== "undefined" ? window.location?.search : "";
  return resolveDataMode(search, { dev: !!import.meta.env?.DEV });
}

export { allowsDemo, allowsLiveApi, resolveDataMode };
