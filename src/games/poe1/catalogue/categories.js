/* Market categories — one definition, read by both sides.

   Every tradable family the site tracks is described here once. The hourly
   snapshot (`scripts/poe1/fetch-data.mjs`) uses `ninjaType` / `re` / `watch` to
   decide what to fetch, and the app uses `tab` to decide what to render.
   Nothing anywhere holds a list of individual item names, so an item GGG adds
   to an existing family appears on the next run without a code change.

   Adding a future family is one entry here plus a nav entry in `../Poe1App.jsx`.

   `re` matches display names, and `watch` narrows which poe.watch categories
   that regex is allowed to match inside — without it, /fossil/i happily picks
   up a unique with the word in its name. Both are required for that reason. */

export const CATEGORIES = [
  {
    key: "scarabs",
    label: "Scarabs",
    file: "scarabs.json",
    ninjaType: "Scarab",
    re: /scarab/i,
    watch: ["scarab"],
    /* Scarabs keep a bespoke fetch path: they are the only family with a
       legacy poe.ninja endpoint still serving per-item history, and the app
       groups them by mechanic. The snapshot therefore fetches them
       separately, but drift tracking treats them like every other family. */
    ownFetch: true,
    tab: null,
  },
  {
    key: "astrolabes",
    label: "Astrolabes",
    file: "astrolabes.json",
    ninjaType: "Astrolabe",
    re: /astrolabe/i,
    watch: ["currency"],
    tab: { shape: "ring" },
  },
  {
    // You query poe.watch's `currency` for catalysts but the rows come back
    // tagged `catalysts`, so both spellings have to be accepted.
    key: "catalysts",
    label: "Catalysts",
    file: "catalysts.json",
    ninjaType: "Currency",
    re: /catalyst/i,
    watch: ["currency", "catalysts"],
    tab: { shape: "gem" },
  },
  {
    /* The Delve tab could read fossil prices out of prices.json, which already
       covers the Fossil and Resonator types for the boss tab. They get their
       own categories anyway because prices.json is a bare name -> price map:
       no sparkline, no self-history, so no "is this fossil going up?" — which
       is the whole question a delver is asking. */
    key: "fossils",
    label: "Fossils",
    file: "fossils.json",
    ninjaType: "Fossil",
    re: /fossil/i,
    watch: ["fossil"],
    tab: null,
  },
  {
    key: "resonators",
    label: "Resonators",
    file: "resonators.json",
    ninjaType: "Resonator",
    re: /resonator/i,
    watch: ["resonator"],
    tab: null,
  },
];

export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

/** Families the snapshot fetches through the generic exchange-category path. */
export const FETCHED_CATEGORIES = CATEGORIES.filter((c) => !c.ownFetch);

/** Families that render as their own tab, keyed for the app's tab table. */
export const TAB_CATEGORIES = Object.fromEntries(
  CATEGORIES.filter((c) => c.tab).map((c) => [c.key, { label: c.label, type: c.ninjaType, re: c.re, ...c.tab }]),
);
