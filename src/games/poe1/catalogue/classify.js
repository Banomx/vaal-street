/* Which market family an item belongs to, and how confident that answer is.

   Three tiers, strongest first, and the tier is reported rather than hidden:

     `metadata`  GGG's own tags and item class. This is what the game says the
                 item is, so it survives a display name changing and it prices a
                 newly added item on the run it appears.
     `exception` a reviewed, named exception. Each one states why the metadata
                 is not enough, so the list stays short and auditable instead of
                 growing into a second classifier.
     `name`      a display-name pattern. Last resort, because a name is a label
                 rather than an identity: /fossil/i cheerfully claims a unique
                 with the word in its name, which is why the pattern is anchored
                 and why this tier is reported separately in the drift log.

   Scarabs already had a strong tag; the other families were name-only, which is
   the gap this closes. Nothing here holds a list of individual item names — a
   scarab GGG adds tomorrow still lands in its family with no code change. */

const has = (item, tag) => Array.isArray(item?.tags) && item.tags.includes(tag);
const classIs = (item, ...names) => {
  const itemClass = String(item?.itemClass || "").toLowerCase();
  return names.some((name) => itemClass === name.toLowerCase());
};

/* GGG tags and item classes per family, checked against the tags RePoE
   publishes for the current build (2026-08). A family with no reliable tag
   simply has none, and falls through to the tiers below. */
const METADATA_RULES = {
  scarabs: (item) => has(item, "scarab") || classIs(item, "Scarab"),
  astrolabes: (item) => has(item, "astrolabe") || classIs(item, "Astrolabe"),
  catalysts: (item) => has(item, "catalyst") || has(item, "jewel_catalyst") || classIs(item, "Catalyst"),
  fossils: (item) => has(item, "fossil") || has(item, "delve_fossil") || classIs(item, "DelveSocketableCurrency", "Fossil"),
  resonators: (item) => has(item, "resonator") || has(item, "delve_stackable_socketable_currency") || classIs(item, "DelveStackableSocketableCurrency", "Resonator"),
};

/* Reviewed exceptions. Empty on purpose: every family currently resolves from
   metadata or from its anchored name pattern, and an exception that is not
   needed is a rule nobody will remember to remove. Add one only with the reason
   it exists, and `scripts/tests/poe1/test-catalogue.mjs` will hold you to it. */
export const CLASSIFICATION_EXCEPTIONS = [
  // { name: "Some Item", key: "catalysts", reason: "GGG tags it as currency only" },
];

/* Anchored so a unique with the word in its name cannot claim the family. */
const NAME_RULES = {
  scarabs: /scarab/i,
  astrolabes: /astrolabe$/i,
  catalysts: /catalyst$/i,
  fossils: /fossil$/i,
  resonators: /resonator$/i,
};

/** `{ match: boolean, confidence: "metadata" | "exception" | "name" | null }` */
export function classifyItem(item, key) {
  if (!item?.name) return { match: false, confidence: null };
  const exception = CLASSIFICATION_EXCEPTIONS.find((entry) => entry.name === item.name);
  if (exception) return { match: exception.key === key, confidence: "exception" };
  if (METADATA_RULES[key]?.(item)) return { match: true, confidence: "metadata" };
  /* Metadata that positively identifies another family is a "no" rather than a
     fall-through: an item GGG tags as a fossil is not a resonator, whatever its
     name ends in. */
  for (const [other, rule] of Object.entries(METADATA_RULES)) {
    if (other !== key && rule(item)) return { match: false, confidence: "metadata" };
  }
  if (NAME_RULES[key]?.test(item.name)) return { match: true, confidence: "name" };
  return { match: false, confidence: null };
}

export function isGggCategory(item, key) {
  return classifyItem(item, key).match;
}

/** How a set of items was classified, for the drift report and quality gates. */
export function classificationCoverage(items, key) {
  const counts = { total: 0, metadata: 0, exception: 0, name: 0 };
  const nameOnly = [];
  for (const item of items || []) {
    const { match, confidence } = classifyItem(item, key);
    if (!match) continue;
    counts.total += 1;
    counts[confidence] += 1;
    if (confidence === "name" && nameOnly.length < 40) nameOnly.push(item.name);
  }
  return { ...counts, nameOnly };
}
