import { THREAD_ITEMS } from "../../src/games/poe1/catalogue/categories.js";
import { contentHash, sourceRecord } from "../shared/dataset.mjs";

// Verified 2026-11-14 against GGG's completed-trade Metadata IDs and
// https://www.pathofexile.com/api/trade/data/static (Fragments).
// RePoE currently omits these. Never derive arbitrary item names from paths.
export const THREAD_METADATA = Object.fromEntries(THREAD_ITEMS.map(({ id, name }) => [id, {
  name, item_class: "MapFragment", tags: [],
}]));

// Same verification: exchange IDs identify the mechanic, while the official
// trade catalogue and game art identify its new Astrolabe name.
export const ASTROLABE_METADATA = {
  "Metadata/Items/Currency/AstrolabeBestiary": { name: "Feral Astrolabe", item_class: "StackableCurrency", tags: [] },
  "Metadata/Items/Currency/AstrolabeBetrayal": { name: "Immortal Astrolabe", item_class: "StackableCurrency", tags: [] },
  "Metadata/Items/Currency/AstrolabeIncursion": { name: "Royal Astrolabe", item_class: "StackableCurrency", tags: [] },
};

export function withThreadMetadata(baseItems = {}) {
  // New upstream metadata takes precedence once the dictionary catches up.
  return { ...THREAD_METADATA, ...ASTROLABE_METADATA, ...baseItems };
}


export function threadMetadataSource() {
  const entries = { ...THREAD_METADATA, ...ASTROLABE_METADATA };
  return sourceRecord({
    id: "catalogue.poe1.patchMetadata", endpointFamily: "reviewed-metadata",
    url: "https://github.com/Banomx/vaal-street/blob/main/scripts/poe1/threadMetadata.mjs",
    requestedAt: new Date().toISOString(), ok: true,
    hash: contentHash(JSON.stringify(entries)),
    rawRows: Object.keys(entries).length, accepted: Object.keys(entries).length,
  });
}
