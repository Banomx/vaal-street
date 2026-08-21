/* RePoE base-item dictionaries, with provenance.

   Both games resolve GGG Metadata paths to display names through RePoE, from
   different URLs but with an identical file shape and an identical need: the
   fork publishes no version, manifest or build stamp (checked 2026-08-21 at
   https://repoe-fork.github.io/), so "which dictionary was this?" can only be
   answered from what the response itself carries — the URL, when it was read,
   the cache validators the server sent, and a hash of the bytes.

   That matters because every display name in a snapshot comes from here. A
   dictionary that quietly changes shape renames the whole catalogue at once,
   and without a recorded hash a metadata change is indistinguishable from a
   code change when an item suddenly moves. */

import { contentHash, sourceRecord } from "./dataset.mjs";

/* A dictionary in an unexpected shape must not be consumed. Failing the read is
   recoverable — the run falls back to a source that carries names itself — but
   consuming an empty or restructured file is not, because it silently unprices
   or renames everything downstream. */
export function validateBaseItems(baseItems, { expectedEntries = 1000 } = {}) {
  if (!baseItems || typeof baseItems !== "object" || Array.isArray(baseItems)) {
    throw new Error("RePoE base items: expected an object keyed by Metadata path");
  }
  const keys = Object.keys(baseItems);
  if (!keys.length) throw new Error("RePoE base items: empty export");
  const metadataKeys = keys.filter((key) => key.startsWith("Metadata/")).length;
  if (metadataKeys < keys.length * 0.9) {
    throw new Error("RePoE base items: keys are not Metadata paths");
  }
  const named = keys.filter((key) => typeof baseItems[key]?.name === "string" && baseItems[key].name).length;
  if (named < keys.length * 0.5) {
    throw new Error("RePoE base items: most entries carry no display name");
  }
  /* Size is coverage, not shape. A short but well-formed dictionary is usable —
     the run says how thin it was and the publication gate decides — whereas a
     restructured one is not usable at all, which is why only the checks above
     throw. */
  const warnings = keys.length < expectedEntries
    ? [`only ${keys.length} entries, well below the ${expectedEntries} a full export carries`]
    : [];
  return { entries: keys.length, named, warnings };
}

export async function fetchBaseItems(url, { id, headers = {}, timeoutMs = 30000 } = {}) {
  const requestedAt = new Date().toISOString();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const text = await response.text();
  const baseItems = JSON.parse(text);
  const shape = validateBaseItems(baseItems);
  return {
    baseItems,
    provenance: sourceRecord({
      id,
      endpointFamily: "repoe",
      url,
      requestedAt,
      ok: true,
      status: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      hash: contentHash(text),
      rawRows: shape.entries,
      accepted: shape.named,
      rejected: shape.entries - shape.named,
      ...(shape.entries !== shape.named ? { rejectedReasons: { no_display_name: shape.entries - shape.named } } : {}),
      warnings: shape.warnings,
    }),
  };
}

/* Name -> metadata, and the names that more than one Metadata path claims.

   A name match is a weaker identity than a path match and has to be reported as
   one. Quest and hidden variants lose to the real item; anything still tied is
   ambiguous, and an ambiguous match is evidence about the dictionary rather
   than about the item. */
export function nameIndex(baseItems) {
  const byName = new Map();
  const ambiguous = new Set();
  const rankOf = (entry) => entry?.itemClass === "QuestItem" ? 0 : entry?.itemClass === "HiddenItem" ? 1 : 2;
  for (const [metadataPath, item] of Object.entries(baseItems || {})) {
    if (!item?.name) continue;
    const candidate = {
      metadataPath,
      itemClass: item.item_class || item.itemClass || null,
      tags: Array.isArray(item.tags) ? item.tags : [],
      inheritsFrom: item.inherits_from || item.inheritsFrom || null,
    };
    const held = byName.get(item.name);
    if (!held) { byName.set(item.name, candidate); continue; }
    if (rankOf(candidate) > rankOf(held)) { byName.set(item.name, candidate); continue; }
    if (rankOf(candidate) === rankOf(held)) ambiguous.add(item.name);
  }
  return { byName, ambiguous };
}
