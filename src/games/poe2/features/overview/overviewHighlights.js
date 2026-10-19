import { buildTabletFamilies, tabletFamilyTimeline } from "../farms/tabletFarms.js";
import { FAMILY_LABELS, FAMILY_ORDER, mechanicPools } from "../farms/mechanics.js";
import { buildBasketIndex, poolFlow } from "../farms/farmIndex.js";
import { windowEvidence } from "../../shared/marketWindow.js";

// Reuse the farm tab's basket, entry alignment and evidence rules. This is
// relative price pressure, not a yield or profit estimate.
export function buildFarmHighlights(markets = {}, history = null) {
  const families = new Map(buildTabletFamilies(markets).map((family) => [family.id, family]));
  const pools = mechanicPools(markets);
  const ids = [...new Set([...FAMILY_ORDER, ...families.keys()])];
  const rows = ids.filter((id) => families.has(id) || pools[id]?.members.length).map((id) => {
    const family = families.get(id);
    const pool = pools[id];
    const timeline = family?.baselineName
      ? tabletFamilyTimeline(history, family, { currency: "exalted", rangeHours: 24, divineAdjusted: false }) : null;
    const index = pool ? buildBasketIndex(history, pool.members, {
      mode: "supply", rangeHours: 24, divineAdjusted: false,
      entryName: timeline?.points.length >= 2 ? family.baselineName : null,
    }) : null;
    const entryChange = index?.entryChange;
    const spread = index?.change != null && entryChange != null && entryChange > -1
      ? (1 + index.change) / (1 + entryChange) - 1 : null;
    const evidence = windowEvidence(index?.points || [], 24, Date.parse(history?.timestamps?.at(-1)));
    return {
      id, label: family?.label || FAMILY_LABELS[id] || id, spread, index, evidence,
      limited: evidence.samples < 4 || evidence.partial || evidence.stale || !!index?.equalFallback || !!index?.concentration.heavy,
      members: pool?.members.length || 0, flow: pool ? poolFlow(pool.members) : 0,
    };
  });
  return {
    pressure: rows.filter((row) => Number.isFinite(row.spread)).sort((a, b) => b.spread - a.spread).slice(0, 3),
    flow: rows.filter((row) => row.flow > 0).sort((a, b) => b.flow - a.flow).slice(0, 3),
  };
}
