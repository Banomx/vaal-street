import assert from "node:assert/strict";
import {
  FARM_STRATEGIES_KEY, FARM_STRATEGY_COUNT_LIMIT, FARM_STRATEGY_KEY,
  computeFarmStrategy, loadFarmStrategies, loadFarmStrategy,
  sanitizeFarmStrategies, sanitizeFarmStrategy, saveFarmStrategies, saveFarmStrategy,
} from "../../../src/games/poe1/features/strategies/farmStrategy.js";
import { CHANGE_WINDOW_OPTIONS, nearestHistoryWindow, nearestRateWindow } from "../../../src/games/poe1/features/pricing/marketWindows.js";
import { combineStratHistory } from "../../../src/games/poe1/features/strategies/stratHistory.js";

const storage = new Map();
const fakeStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const clean = sanitizeFarmStrategy({
  name: "  Harvest loop  ",
  scarabs: ["A", "A", "B", "C", "D", "E", "F", null],
  astrolabe: "  Templar Astrolabe  ",
});
assert.deepEqual(clean, { id: "", name: "Harvest loop", scarabs: ["A", "A", "B", "C", "D"], astrolabe: "Templar Astrolabe" });
assert.deepEqual(sanitizeFarmStrategy({ name: "Legacy", scarabs: ["A"] }),
  { id: "", name: "Legacy", scarabs: ["A"], astrolabe: "" }, "older saved strategies migrate without being lost");

saveFarmStrategy(clean, fakeStorage);
assert.deepEqual(loadFarmStrategy(fakeStorage), clean);
assert.ok(storage.has(FARM_STRATEGY_KEY));
const migrated = loadFarmStrategies(fakeStorage);
assert.equal(migrated.length, 1, "the old single strategy migrates into Strat Watcher");
assert.ok(migrated[0].id);

const eleven = Array.from({ length: 11 }, (_, index) => ({ id: index < 2 ? "duplicate" : `id-${index}`, name: `Strat ${index}`, scarabs: ["A"] }));
const capped = saveFarmStrategies(eleven, fakeStorage);
assert.equal(capped.length, FARM_STRATEGY_COUNT_LIMIT);
assert.equal(new Set(capped.map((strategy) => strategy.id)).size, FARM_STRATEGY_COUNT_LIMIT, "strategy ids stay unique");
assert.ok(storage.has(FARM_STRATEGIES_KEY));
assert.deepEqual(loadFarmStrategies(fakeStorage), capped);
assert.equal(sanitizeFarmStrategies("junk").length, 0);

const computed = computeFarmStrategy(clean, [
  { name: "A", chaosValue: 10, change1: 100, change1R: 50 },
  { name: "B", chaosValue: 20, change1: 0, change1R: -10 },
  { name: "C", chaosValue: 5, change1: -50, change1R: -60 },
  { name: "D", chaosValue: 15, change1: 50, change1R: 20 },
], [
  { name: "Templar Astrolabe", chaosValue: 40, change1: 25, change1R: 5 },
]);
assert.equal(computed.scarabMembers.length, 5, "duplicate scarabs occupy separate map-device slots");
assert.equal(computed.members.length, 6, "the Astrolabe contributes to the complete farming setup");
assert.equal(computed.total, 100);
assert.equal(computed.astrolabeItem.name, "Templar Astrolabe");
assert.equal(computed.hasItems, true);
assert.deepEqual(computed.missing, []);
assert.ok(Number.isFinite(computed.change1));
assert.ok(Number.isFinite(computed.change1R));
assert.notEqual(computed.change1, computed.change1R, "divine-adjusted movement stays separate");

const missing = computeFarmStrategy({ name: "Thin league", scarabs: ["A", "Gone"], astrolabe: "Gone Astrolabe" }, [
  { name: "A", chaosValue: 10 },
]);
assert.deepEqual(missing.missing, ["Gone", "Gone Astrolabe"]);
assert.equal(missing.change1, null);

assert.deepEqual(CHANGE_WINDOW_OPTIONS, ["1h", "2h", "4h", "8h", "12h", "24h", "48h"]);
assert.equal(nearestRateWindow([{ day: 1, rate: 100 }, { day: 1 + 1 / 24, rate: 101 }], "2h"), null,
  "a 1h-old rate must not be reused as a fake 2h comparison");
assert.ok(nearestRateWindow([{ day: 1, rate: 100 }, { day: 1 + 2 / 24, rate: 101 }], "2h"));
assert.equal(nearestHistoryWindow([{ day: 1, value: 10 }, { day: 1 + 1 / 24, value: 12 }], "2h"), null,
  "a 1h-old gem point must not be shown as a 2h price change");
assert.deepEqual(
  nearestHistoryWindow([{ day: 1, value: 10 }, { day: 1 + 2 / 24, value: 12 }], "2h"),
  { reference: { day: 1, value: 10 }, last: { day: 1 + 2 / 24, value: 12 } },
);

/* ---- combined strategy graph ---- */
const hA = [{ day: 0, value: 10 }, { day: 1, value: 12 }, { day: 2, value: 14 }];
const hB = [{ day: 1, value: 5 }, { day: 2, value: 6 }];

const both = combineStratHistory([{ name: "A", points: hA }, { name: "B", points: hB }]);
assert.deepEqual(both.rows.map((r) => [r.day, r.chaos]), [[1, 17], [2, 20]],
  "the window starts where every member has data, not where the longest one does");
assert.equal(both.from, 1);
assert.equal(both.to, 2);
assert.equal(both.clipped, true, "day 0 was dropped, and the UI says so");
assert.equal(both.covered, 2);
assert.deepEqual(both.without, []);

const dupes = combineStratHistory([
  { name: "A", points: hA }, { name: "A", points: hA }, { name: "B", points: hB },
], "A");
assert.equal(dupes.rows[0].chaos, 29, "a scarab in two slots is bought twice");
assert.equal(dupes.rows[0].focusChaos, 24, "and the overlay shows both copies too");

const gap = combineStratHistory([
  { name: "A", points: [{ day: 1, value: 10 }, { day: 1.5, value: 20 }, { day: 2, value: 30 }] },
  { name: "B", points: [{ day: 1, value: 5 }, { day: 2, value: 6 }] },
]);
assert.deepEqual(gap.rows.map((r) => r.chaos), [15, 25, 36],
  "an item without a sample on that exact hour contributes its nearest one");

const oneShared = combineStratHistory([
  { name: "A", points: [{ day: 1, value: 10 }, { day: 1.5, value: 20 }] },
  { name: "B", points: [{ day: 1.2, value: 5 }] },
]);
assert.equal(oneShared.rows.length, 1,
  "a member with a single snapshot pins the window to that day — the chart then reports it has nothing to draw");

const thin = combineStratHistory([{ name: "A", points: hA }, { name: "Gone", points: undefined }]);
assert.deepEqual(thin.without, ["Gone"], "an item with no history is named, not faked");
assert.equal(thin.covered, 1);
assert.equal(thin.of, 2);
assert.deepEqual(thin.rows.map((r) => r.chaos), [10, 12, 14]);

const apart = combineStratHistory([
  { name: "A", points: [{ day: 0, value: 1 }, { day: 1, value: 1 }] },
  { name: "B", points: [{ day: 4, value: 1 }, { day: 5, value: 1 }] },
]);
assert.deepEqual(apart.rows, [], "histories that never overlap draw nothing rather than a guess");
assert.equal(apart.clipped, true);

assert.deepEqual(combineStratHistory([]).rows, []);
assert.deepEqual(combineStratHistory([{ name: "A", points: [{ day: 0, value: null }] }]).without, ["A"],
  "points without a usable value do not count as history");

console.log("Farming strategy tests passed");
