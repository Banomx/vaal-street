import { buildPriceTimeline } from "../pricing/priceTimeline.js";
import { FAMILY_LABELS, FAMILY_ORDER } from "./mechanics.js";

/* The tablet family ids and the mechanic ids are deliberately the same set, so
   a tablet baseline and its mechanic's output pool join without a lookup. They
   live in mechanics.js and are re-exported here for the existing importers. */
export { FAMILY_LABELS, FAMILY_ORDER };

function textFor(name, entry) {
  return [name, entry?.baseType, entry?.marketFamily, entry?.type, entry?.itemClass, ...(entry?.tags || [])]
    .filter(Boolean).join(" ").toLowerCase();
}

export function tabletFamily(name, entry) {
  const text = textFor(name, entry);
  if (/tower_augment_map_boss|overseer tablet|map boss/.test(text)) return "bossing";
  if (/tower_augment_incursion|temple tablet|incursion tablet/.test(text)) return "vaal";
  for (const family of ["breach", "ritual", "delirium", "abyss", "expedition"]) {
    if (new RegExp(`tower_augment_${family}|\\b${family} (?:precursor )?tablet\\b`).test(text)) return family;
  }
  return "atlas";
}

export function isTabletMarket(name, entry) {
  return /tablet|tower_augment/.test(textFor(name, entry));
}

function isDefaultTablet(name, entry) {
  const family = String(entry?.marketFamily || "").toLowerCase();
  if (family === "uniquetablets") return false;
  return family === "precursortablets"
    || (/tablet/i.test(entry?.itemClass || "") && entry?.variant && name === entry?.baseType);
}

function preferredBaseline(entries) {
  return [...entries].sort((left, right) => {
    const leftFamily = String(left.entry.marketFamily || "").toLowerCase() === "precursortablets" ? 1 : 0;
    const rightFamily = String(right.entry.marketFamily || "").toLowerCase() === "precursortablets" ? 1 : 0;
    return rightFamily - leftFamily || (right.entry.volume1H || right.entry.listingCount || 0) - (left.entry.volume1H || left.entry.listingCount || 0);
  })[0] || null;
}

export function buildTabletFamilies(prices = {}) {
  const groups = new Map();
  for (const [name, entry] of Object.entries(prices || {})) {
    if (!isTabletMarket(name, entry)) continue;
    const id = tabletFamily(name, entry);
    const group = groups.get(id) || { id, label: FAMILY_LABELS[id] || id, defaults: [], uniques: [] };
    const row = { name, entry };
    (isDefaultTablet(name, entry) ? group.defaults : group.uniques).push(row);
    groups.set(id, group);
  }

  return [...groups.values()].map((group) => {
    const baseline = preferredBaseline(group.defaults);
    const inferredBaselineName = baseline?.name || group.uniques.map((row) => row.entry.baseType).find(Boolean) || `${group.label} Tablet`;
    return {
      ...group,
      baseline,
      baselineName: inferredBaselineName,
      uniques: group.uniques.sort((left, right) => Number(right.entry.exalted) - Number(left.entry.exalted)),
    };
  }).sort((left, right) => FAMILY_ORDER.indexOf(left.id) - FAMILY_ORDER.indexOf(right.id));
}

export function tabletFamilyTimeline(history, family, options = {}) {
  let compatibleHistory = history;
  const normalBaseline = String(family.baseline?.entry?.marketFamily || "").toLowerCase() === "precursortablets"
    && String(family.baseline?.entry?.variant || "").toLowerCase() === "normal";
  if (normalBaseline && history?.timestamps?.length && history.tabletBaselineVersion !== 1) {
    const last = history.timestamps.length - 1;
    compatibleHistory = {
      ...history,
      timestamps: [history.timestamps[last]],
      divineExalted: [history.divineExalted?.[last] ?? null],
      series: {
        [family.baselineName]: [history.series?.[family.baselineName]?.[last] ?? family.baseline.entry.exalted ?? null],
        "Chaos Orb": [history.series?.["Chaos Orb"]?.[last] ?? null],
      },
    };
  }
  const timeline = buildPriceTimeline(compatibleHistory, family.baselineName, options);
  return {
    ...timeline,
    change: options.divineAdjusted ? timeline.divineAdjustedChange : timeline.change,
  };
}

export function sortTabletRows(rows, mode = "value") {
  return [...rows].sort((left, right) => mode === "movement"
    ? (right.timeline?.change ?? -Infinity) - (left.timeline?.change ?? -Infinity)
    : mode === "name" ? left.label.localeCompare(right.label)
      : Number(right.baselineValue || 0) - Number(left.baselineValue || 0) || left.label.localeCompare(right.label));
}
