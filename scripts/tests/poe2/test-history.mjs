import assert from "node:assert/strict";
import { appendPriceSnapshot, mergePriceHistories, thinPriceHistory } from "../../poe2/history.mjs";
import { appendExchangeSnapshot, mergeExchangeHistories, thinExchangeHistory } from "../../poe2/exchange-history.mjs";
import { buildPriceTimeline } from "../../../src/games/poe2/features/pricing/priceTimeline.js";

const snapshot = (generatedAt, prices, divineExalted = 400) => ({
  generatedAt,
  league: "Test League",
  divineExalted,
  prices: Object.fromEntries(Object.entries(prices).map(([name, exalted]) => [name, { exalted }])),
});

let history = appendPriceSnapshot(null, snapshot("2026-08-20T10:00:00.000Z", { A: 10, B: 20, "Chaos Orb": 2 }));
history = appendPriceSnapshot(history, snapshot("2026-08-20T11:00:00.000Z", { A: 12, C: 30, "Chaos Orb": 3 }, 420));
assert.deepEqual(history.timestamps, ["2026-08-20T10:00:00.000Z", "2026-08-20T11:00:00.000Z"]);
assert.deepEqual(history.series.A, [10, 12]);
assert.deepEqual(history.series.B, [20, null], "an absent quote remains a visible gap instead of a stale carried price");
assert.deepEqual(history.series.C, [null, 30], "new market names align with earlier timestamps");
assert.deepEqual(history.divineExalted, [400, 420]);

const replacement = appendPriceSnapshot(null, snapshot("2026-08-20T11:00:00.000Z", { A: 99 }, 500));
const merged = mergePriceHistories(history, replacement);
assert.deepEqual(merged.series.A, [10, 99], "the newest document wins when two stores contain the same snapshot hour");
assert.deepEqual(merged.series.B, [20, null], "replacing one timestamp does not damage the rest of the aligned series");

const now = Date.parse("2026-08-20T12:00:00.000Z");
const raw = {
  generatedAt: "2026-08-20T11:00:00.000Z",
  league: "Test League",
  timestamps: [
    "2025-06-15T12:00:00.000Z",
    "2026-05-12T08:00:00.000Z",
    "2026-05-12T20:00:00.000Z",
    "2026-08-12T08:00:00.000Z",
    "2026-08-12T20:00:00.000Z",
    "2026-08-15T08:00:00.000Z",
    "2026-08-15T20:00:00.000Z",
    "2026-08-20T10:00:00.000Z",
    "2026-08-20T11:00:00.000Z",
  ],
  divineExalted: [300, 320, 325, 330, 335, 350, 360, 400, 410],
  series: { A: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
};
const thinned = thinPriceHistory(raw, { nowMs: now });
assert.deepEqual(thinned.timestamps, [
  "2026-05-12T20:00:00.000Z",
  "2026-08-12T20:00:00.000Z",
  "2026-08-15T08:00:00.000Z",
  "2026-08-15T20:00:00.000Z",
  "2026-08-20T10:00:00.000Z",
  "2026-08-20T11:00:00.000Z",
], "expired points are removed, old days keep their newest sample, and the latest seven days stay hourly");
assert.deepEqual(thinned.series.A, [3, 5, 6, 7, 8, 9]);

const exaltedTimeline = buildPriceTimeline(history, "A", { currency: "exalted" });
assert.deepEqual(exaltedTimeline.points.map((point) => point.value), [10, 12]);
assert.equal(exaltedTimeline.unit, "Exalted");
assert.ok(Math.abs(exaltedTimeline.change - .2) < 1e-12);
assert.ok(Math.abs(exaltedTimeline.divineAdjustedChange - (12 / 420 / (10 / 400) - 1)) < 1e-12,
  "Divine adjustment compares price/rate at both ends instead of dividing both prices by today's rate");
assert.equal(exaltedTimeline.canDivineAdjust, true);
const chaosTimeline = buildPriceTimeline(history, "A", { currency: "chaos" });
assert.deepEqual(chaosTimeline.points.map((point) => point.value), [5, 4], "historical Chaos display uses each snapshot's Exalted/Chaos rate");
assert.equal(chaosTimeline.unit, "Chaos");
const divineTimeline = buildPriceTimeline(history, "B", { currency: "divine" });
assert.equal(divineTimeline.points[0].value, .05, "historical Divine display uses the rate stored with that same snapshot");
assert.equal(divineTimeline.points.length, 1, "missing prices remain chart gaps rather than carrying forward stale values");
assert.equal(divineTimeline.canDivineAdjust, false, "an adjusted move needs priced, rated endpoints on both sides of the window");

const legacyTabletHistory = appendPriceSnapshot(null, snapshot("2026-08-20T10:00:00.000Z", { "Breach Tablet": 8 }));
const normalTabletSnapshot = snapshot("2026-08-20T11:00:00.000Z", {});
normalTabletSnapshot.prices["Breach Tablet"] = {
  exalted: 20,
  marketFamily: "PrecursorTablets",
  variant: "Normal",
};
const migratedTabletHistory = appendPriceSnapshot(legacyTabletHistory, normalTabletSnapshot);
assert.deepEqual(migratedTabletHistory.series["Breach Tablet"], [null, 20],
  "legacy cheapest-rarity tablet points are removed when Normal becomes the baseline");
assert.equal(migratedTabletHistory.tabletBaselineVersion, 1, "the tablet migration is recorded so later Normal points remain continuous");
const continuedTabletHistory = appendPriceSnapshot(migratedTabletHistory, {
  ...normalTabletSnapshot,
  generatedAt: "2026-08-20T12:00:00.000Z",
  prices: { "Breach Tablet": { ...normalTabletSnapshot.prices["Breach Tablet"], exalted: 22 } },
});
assert.deepEqual(continuedTabletHistory.series["Breach Tablet"], [null, 20, 22], "compatible Normal-tablet history accumulates after migration");

const exchangeSnapshot = (marketHour, leftVolume, rightVolume, rate = rightVolume / leftVolume) => ({
  generatedAt: new Date(Date.parse(marketHour) + 20 * 60 * 1000).toISOString(),
  marketHour,
  league: "Test League",
  items: { A: { name: "A" }, B: { name: "B" } },
  pairs: [{
    id: "A|B",
    left: "A",
    right: "B",
    leftVolume,
    rightVolume,
    rightPerLeft: rate,
    lowRightPerLeft: rate * .9,
    highRightPerLeft: rate * 1.1,
  }],
});
let exchangeHistory = appendExchangeSnapshot(null, exchangeSnapshot("2026-08-20T10:00:00.000Z", 10, 100));
exchangeHistory = appendExchangeSnapshot(exchangeHistory, exchangeSnapshot("2026-08-20T11:00:00.000Z", 20, 240));
assert.deepEqual(exchangeHistory.pairKeys, ["A|B"]);
assert.deepEqual(exchangeHistory.snapshots.map((point) => point.pairs[0].slice(1, 4)), [[10, 100, 10], [20, 240, 12]],
  "pair history retains both completed volumes and the volume-weighted rate");
const exchangeReplacement = appendExchangeSnapshot(null, exchangeSnapshot("2026-08-20T11:00:00.000Z", 30, 390));
assert.equal(mergeExchangeHistories(exchangeHistory, exchangeReplacement).snapshots[1].pairs[0][1], 30,
  "deployed pair history wins an overlapping official hour");
const oldExchange = {
  ...exchangeHistory,
  snapshots: [
    { ...exchangeHistory.snapshots[0], at: "2026-08-12T08:00:00.000Z" },
    { ...exchangeHistory.snapshots[1], at: "2026-08-12T20:00:00.000Z" },
    { ...exchangeHistory.snapshots[0], at: "2026-08-15T08:00:00.000Z" },
    { ...exchangeHistory.snapshots[1], at: "2026-08-15T20:00:00.000Z" },
  ],
};
assert.deepEqual(thinExchangeHistory(oldExchange, { nowMs: now }).snapshots.map((point) => point.at), [
  "2026-08-12T20:00:00.000Z",
  "2026-08-15T08:00:00.000Z",
  "2026-08-15T20:00:00.000Z",
], "exchange pairs use the same seven-day hourly then daily retention contract");

console.log("PoE 2 price history passed.");
