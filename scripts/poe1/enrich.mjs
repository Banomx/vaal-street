/* RePoE enrichment for PoE 1 selected items.

   Pure, and separate from `fetch-data.mjs` because that file takes a snapshot
   the moment it is imported. Identity confidence is the point: a Metadata path
   is evidence about which item was priced, a display name is a guess that is
   usually right, and a display name two paths answer to is no evidence at all. */

import { nameIndex } from "../shared/repoe.mjs";

/* RePoE metadata for every selected item, not only the ones GGG priced.

   The dictionary is fetched once per run for the GGG digest anyway, so the
   fallback rows in a league GGG does not cover — Hardcore Allflame, Standard —
   were going unenriched purely because nothing looked them up. Match by
   Metadata path first, since that is the strong identity, and fall back to
   display name as an explicitly weaker one. The confidence is recorded on the
   item so a consumer can tell the two apart. */
export function enrichFromRepoe(items, baseItems, index = null) {
  const coverage = { total: 0, byPath: 0, byName: 0, ambiguous: 0, unmatched: 0, ambiguousNames: [], unmatchedNames: [] };
  if (!baseItems) return coverage;
  const { byName, ambiguous } = index || nameIndex(baseItems);
  for (const item of items || []) {
    coverage.total += 1;
    const path = typeof item.gggId === "string" && item.gggId.startsWith("Metadata/") ? item.gggId : null;
    const direct = path ? baseItems[path] : null;
    if (direct) {
      coverage.byPath += 1;
      if (!item.itemClass && direct.item_class) item.itemClass = direct.item_class;
      if ((!item.tags || !item.tags.length) && Array.isArray(direct.tags)) item.tags = direct.tags;
      if (!item.identity) item.identity = "metadata-path";
      continue;
    }
    const matched = byName.get(item.name);
    if (!matched) {
      coverage.unmatched += 1;
      if (coverage.unmatchedNames.length < 40) coverage.unmatchedNames.push(item.name);
      continue;
    }
    if (ambiguous.has(item.name)) {
      /* More than one Metadata path answers to this name, so the match says
         nothing about which item was priced. Report it and enrich nothing —
         a wrong item class is worse than a missing one. */
      coverage.ambiguous += 1;
      if (coverage.ambiguousNames.length < 40) coverage.ambiguousNames.push(item.name);
      if (!item.identity) item.identity = "name-ambiguous";
      continue;
    }
    coverage.byName += 1;
    if (!item.itemClass && matched.itemClass) item.itemClass = matched.itemClass;
    if ((!item.tags || !item.tags.length) && matched.tags.length) item.tags = matched.tags;
    if (!item.metadataPath && matched.metadataPath) item.metadataPath = matched.metadataPath;
    if (!item.identity) item.identity = "name";
  }
  return coverage;
}
