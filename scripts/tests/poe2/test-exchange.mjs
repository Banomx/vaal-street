import assert from "node:assert/strict";
import { appendExchangeSnapshot } from "../../poe2/exchange-history.mjs";
import { buildGggExchangeSnapshot, DIVINE_ID, EXALTED_ID } from "../../poe2/ggg-exchange.mjs";
import { assessExchangeRoute, buildExchangeOverview, buildExchangeRouteOptions, buildExchangeRouteTimeline, buildExchangeRows, buildExchangeTimeline, CHAOS_ID, estimateExchangeExecution, filterExchangeRowsByTurnover, findTriangleChecks } from "../../../src/games/poe2/features/exchange/exchangeDesk.js";

const ITEM = "Metadata/Items/Test/Item";
const MIDDLE = "Metadata/Items/Test/Middle";
const DIVINE_QUOTED = "Metadata/Items/Test/DivineQuoted";
const market = (a, b, av, bv, low = [av, bv], high = [av, bv]) => ({
  league: "Test",
  market_pair: [a, b],
  volume_traded: { [a]: av, [b]: bv },
  lowest_ratio: { [a]: low[0], [b]: low[1] },
  highest_ratio: { [a]: high[0], [b]: high[1] },
});
const items = {
  [ITEM]: { name: "Test Item", item_class: "Currency" },
  [MIDDLE]: { name: "Middle Currency", item_class: "Currency" },
  [DIVINE_QUOTED]: { name: "Divine-Quoted Currency", item_class: "Currency" },
  [DIVINE_ID]: { name: "Divine Orb", item_class: "Currency" },
  [CHAOS_ID]: { name: "Chaos Orb", item_class: "Currency" },
  [EXALTED_ID]: { name: "Exalted Orb", item_class: "Currency" },
};
const markets = (itemExalted, divineExalted) => [
  market(ITEM, EXALTED_ID, 10, 10 * itemExalted, [1, itemExalted * .9], [1, itemExalted * 1.1]),
  market(MIDDLE, EXALTED_ID, 100, 200),
  market(ITEM, MIDDLE, 10, 60),
  market(DIVINE_QUOTED, DIVINE_ID, 5, 1),
  market(DIVINE_ID, EXALTED_ID, 2, 2 * divineExalted),
  market(CHAOS_ID, EXALTED_ID, 100, 200),
];

const current = buildGggExchangeSnapshot(markets(10, 400), items, "Test", Date.parse("2026-08-20T10:00:00.000Z") / 1000);
const rows = buildExchangeRows(current, { sourcePrices: { poeNinja: {
  "Test Item": { exalted: 11, source: "poe.ninja exchange" },
} } });
const row = rows.find((entry) => entry.itemId === ITEM);
assert.equal(row.priceExalted, 10);
assert.equal(row.itemVolume, 10);
assert.equal(row.turnoverExalted, 100);
assert.ok(Math.abs(row.rangePercent - (11 / 9 - 1)) < 1e-12);
assert.ok(Math.abs(row.quoteGap - .1) < 1e-12, "the desk compares the independent poe.ninja quote with GGG's completed mean");
const routeOptions = buildExchangeRouteOptions(current, ITEM);
assert.deepEqual(routeOptions.map((entry) => entry.quoteName), ["Exalted Orb", "Middle Currency"]);
assert.equal(routeOptions[0].priceExalted, 10, "direct Exalted is the cheapest way to buy the sample item");
assert.equal(routeOptions[1].priceExalted, 12, "the item-to-middle and middle-to-Exalted legs normalize into one comparable rate");
assert.equal(row.bestBuy.quoteName, "Exalted Orb");
assert.equal(row.bestSell.quoteName, "Middle Currency");
assert.ok(Math.abs(row.routeGap - .2) < 1e-12);
const turnoverFiltered = filterExchangeRowsByTurnover([{
  name: "Synthetic market",
  turnoverExalted: 5000,
  routeCount: 3,
  routeOptions: [
    { quoteName: "Thin cheap route", priceExalted: 1, limitingTurnoverExalted: 100 },
    { quoteName: "Liquid buy route", priceExalted: 5, limitingTurnoverExalted: 2000 },
    { quoteName: "Liquid sell route", priceExalted: 10, limitingTurnoverExalted: 3000 },
  ],
}], 1000);
assert.equal(turnoverFiltered.length, 1);
assert.equal(turnoverFiltered[0].bestBuy.quoteName, "Liquid buy route", "the table's buy route obeys its turnover filter");
assert.equal(turnoverFiltered[0].bestSell.quoteName, "Liquid sell route", "the table's sell route obeys its turnover filter");
assert.equal(turnoverFiltered[0].routeCount, 2);
assert.equal(turnoverFiltered[0].totalRouteCount, 3);
assert.equal(turnoverFiltered[0].routeGap, 1, "route difference is recalculated from eligible routes only");
const stricterTurnoverFiltered = filterExchangeRowsByTurnover(turnoverFiltered, 2500);
assert.equal(stricterTurnoverFiltered[0].bestBuy.quoteName, "Liquid sell route",
  "raising the table floor replaces a previous buy winner when its route becomes ineligible");
assert.equal(stricterTurnoverFiltered[0].bestSell.quoteName, "Liquid sell route");
assert.equal(stricterTurnoverFiltered[0].routeGap, 0);
assert.equal(filterExchangeRowsByTurnover(turnoverFiltered, 6000).length, 0, "the overall market turnover must also pass the floor");
assert.equal(filterExchangeRowsByTurnover([{ ...turnoverFiltered[0], itemVolume: 4,
  routeOptions: turnoverFiltered[0].routeOptions.map((route) => ({ ...route, itemVolume: 4 })) }], 1000, { minItemVolume: 5 }).length, 0,
"an expensive but rarely completed item does not pass the unit-volume floor");
assert.equal(buildExchangeRouteOptions(current, ITEM, { minTurnoverExalted: 1000 }).length, 0,
  "route choices can suppress a path when either leg lacks enough completed turnover");
const divineQuotedRow = rows.find((entry) => entry.itemId === DIVINE_QUOTED);
assert.equal(divineQuotedRow.priceExalted, 80, "markets quoted in Divine are normalized through the same-hour Divine/Exalted pair");
assert.equal(divineQuotedRow.turnoverExalted, 400);
assert.equal(divineQuotedRow.quoteRoute, "via Divine");

const triangles = findTriangleChecks(current);
const route = triangles.find((entry) => entry.itemId === ITEM && entry.middleId === MIDDLE);
assert.ok(route, "a sufficiently traded two-leg route is compared with the direct Exalted market");
assert.equal(route.direct, 10);
assert.equal(route.indirect, 12);
assert.ok(Math.abs(route.gap - .2) < 1e-12);
assert.equal(findTriangleChecks(current, { minTurnoverExalted: 1000 }).length, 0,
  "thin routes are suppressed instead of being presented as arbitrage");

let history = appendExchangeSnapshot(null, current);
history = appendExchangeSnapshot(history,
  buildGggExchangeSnapshot(markets(12, 440), items, "Test", Date.parse("2026-08-20T11:00:00.000Z") / 1000));
const timeline = buildExchangeTimeline(history, ITEM);
assert.deepEqual(timeline.points.map((point) => point.price), [10, 12]);
assert.deepEqual(timeline.points.map((point) => point.chaosExalted), [2, 2], "exchange history retains the same-hour Exalted/Chaos rate for display conversion");
assert.ok(Math.abs(timeline.change - .2) < 1e-12);
assert.ok(Math.abs(timeline.divineAdjustedChange - (12 / 440 / (10 / 400) - 1)) < 1e-12);
assert.equal(timeline.canDivineAdjust, true);
const middleRouteTimeline = buildExchangeRouteTimeline(history, ITEM, MIDDLE);
assert.deepEqual(middleRouteTimeline.points.map((point) => point.price), [12, 12],
  "route history follows the selected item/quote pair and its same-hour Exalted normalization leg");
assert.equal(middleRouteTimeline.change, 0);
const divineQuotedTimeline = buildExchangeTimeline(history, DIVINE_QUOTED);
assert.deepEqual(divineQuotedTimeline.points.map((point) => point.price), [80, 88]);
assert.ok(Math.abs(divineQuotedTimeline.divineAdjustedChange) < 1e-12,
  "a flat Divine quote stays flat after adjustment even while Exalted weakens");
const overview = buildExchangeOverview(rows, history, { limit: 3 });
assert.equal(overview.historySnapshots, 2);
assert.equal(overview.quoteGaps[0].itemId, ITEM, "the overview surfaces independently comparable source gaps");
assert.equal(overview.movers[0].itemId, ITEM, "the overview ranks meaningful 24-hour moves by magnitude");
assert.ok(overview.liquidity.every((entry, index, list) => !index || list[index - 1].turnoverExalted >= entry.turnoverExalted));
assert.equal(overview.ranges[0].itemId, ITEM, "the overview isolates the widest completed range even when most markets were flat");
assert.equal(overview.medianRange, 0);
assert.ok(Math.abs(overview.movementByItem[ITEM].change - .2) < 1e-12,
  "the table can reuse the overview's indexed 24-hour movement calculation");

const execution = estimateExchangeExecution(row, 20, { participation: .5 });
assert.equal(execution.plannedHourlyUnits, 5);
assert.equal(execution.hoursToClear, 4);
assert.equal(execution.completedValue, 200);
assert.equal(execution.lowValue, 180);
assert.equal(execution.highValue, 220);
assert.equal(execution.listingValue, 220);
assert.equal(execution.listingDifference, 20);
assert.equal(execution.flowFit, "several-hours");
const routedExecution = estimateExchangeExecution(routeOptions[1], 20, { participation: .5 });
assert.equal(routedExecution.limitingTurnoverExalted, 120);
assert.equal(routedExecution.hoursToClear, 4,
  "route timing respects both completed item units and the limiting normalized leg");
const cautiousExecution = estimateExchangeExecution(row, 1, { participation: .001 });
assert.equal(cautiousExecution.participation, .001, "the model honors the UI's 0.1% minimum instead of silently clamping it to 1%");
assert.equal(cautiousExecution.hoursToClear, 100);

assert.equal(assessExchangeRoute({ itemVolume: 100, limitingTurnoverExalted: 10000, rangePercent: .1 }, {
  minItemVolume: 10, minTurnoverExalted: 1000, routeGap: .05,
}).level, "high");
assert.equal(assessExchangeRoute({ itemVolume: 20, limitingTurnoverExalted: 2000, rangePercent: .25 }, {
  minItemVolume: 10, minTurnoverExalted: 1000, routeGap: .1,
}).level, "medium");
assert.equal(assessExchangeRoute({ itemVolume: 100, limitingTurnoverExalted: 10000, rangePercent: .1 }, {
  minItemVolume: 10, minTurnoverExalted: 1000, routeGap: .75,
}).level, "low", "extreme cross-route disagreement is surfaced as low confidence rather than green profit");

console.log("PoE 2 Currency Exchange desk passed.");
