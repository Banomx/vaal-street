import assert from "node:assert/strict";
import { buildFarmHighlights } from "../../../src/games/poe2/features/overview/overviewHighlights.js";

assert.deepEqual(buildFarmHighlights(), { pressure: [], flow: [] }, "missing data never becomes a ranking");
const quote = (family, exalted, volume1H) => ({ source: "GGG completed trades", marketFamily: family, exalted, volume1H });
const markets = {
  "Breach Precursor Tablet": { ...quote("PrecursorTablets", 20, 10), baseType: "Breach Precursor Tablet" },
  "Sibilant Catalyst": quote("Breach", 20, 100),
  "Xoph's Catalyst": quote("Breach", 20, 100),
  "Esh's Catalyst": quote("Breach", 20, 100),
  "Omen of Chance": quote("Ritual", 5, 10),
};
const timestamps = [0, 6, 12, 18, 24].map((hour) => new Date(Date.UTC(2026, 9, 1) + hour * 3600e3).toISOString());
const history = { timestamps, divineExalted: timestamps.map(() => 100), series: {
  "Breach Precursor Tablet": [10, 12, 15, 18, 20],
  "Sibilant Catalyst": [10, 12, 15, 18, 20],
  "Xoph's Catalyst": [10, 12, 15, 18, 20],
  "Esh's Catalyst": [10, 12, 15, 18, 20],
} };
const result = buildFarmHighlights(markets, history);
assert.equal(result.pressure[0]?.id, "breach");
assert(Math.abs(result.pressure[0].spread) < 1e-9, "doubling both entry and output is zero relative pressure");
assert.equal(result.pressure[0].limited, false, "complete balanced history has usable evidence");
assert.equal(result.flow[0].flow, 6000, "completed output value excludes tablet entry");
assert.equal(buildFarmHighlights(markets).pressure.length, 0, "no history produces no invented pressure");
const missing = structuredClone(history);
delete missing.series["Esh's Catalyst"];
assert.equal(buildFarmHighlights(markets, missing).pressure.length, 0, "fewer than three output histories cannot rank");
const partial = { ...history, timestamps: timestamps.map((_, i) => new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toISOString()) };
assert.equal(buildFarmHighlights(markets, partial).pressure[0].limited, true, "partial windows retain a visible evidence warning");
console.log("PoE 2 overview evidence checks passed");
