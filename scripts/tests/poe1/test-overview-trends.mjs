import assert from "node:assert/strict";
import { TREND_DEPTH, TREND_ROTATION_MS, pickTrend, rotateDesks, rotateTrend } from "../../../src/games/poe1/features/overview/overviewTrends.js";

const rows = [
  { name: "a", change: 12 },
  { name: "b", change: -4 },
  { name: "c", change: 7 },
  { name: "d", change: -19 },
  { name: "e", change: 0 },
  { name: "f", change: null },
  { name: "g", change: 3 },
  { name: "h", change: -1 },
];
const changeOf = (row) => row.change;

assert.equal(TREND_DEPTH, 3);
assert.deepEqual(pickTrend(rows, changeOf, "up").map((row) => row.name), ["a", "c", "g"]);
assert.deepEqual(pickTrend(rows, changeOf, "down").map((row) => row.name), ["d", "b", "h"]);
assert.deepEqual(pickTrend(rows, changeOf, "up", { depth: 2 }).map((row) => row.name), ["a", "c"]);

// A flat or unmeasured window is not a trend in either direction.
assert.deepEqual(pickTrend(rows, changeOf, "up").filter((row) => row.change <= 0), []);
assert.deepEqual(pickTrend([{ change: 0 }, { change: null }, { change: NaN }], changeOf, "down"), []);
assert.deepEqual(pickTrend(null, changeOf, "up"), []);

// Levels rather than movements rank without a sign filter, so an all-negative
// boss list still has a best three and a worst three.
const nets = [{ net: -5 }, { net: -80 }, { net: -12 }, { net: -1 }];
assert.deepEqual(pickTrend(nets, (row) => row.net, "up", { signed: false }).map((row) => row.net), [-1, -5, -12]);
assert.deepEqual(pickTrend(nets, (row) => row.net, "down", { signed: false }).map((row) => row.net), [-80, -12, -5]);
assert.deepEqual(pickTrend(nets, (row) => row.net, "up").length, 0, "signed ranking still refuses negative gains");

const list = ["x", "y", "z"];
assert.deepEqual(rotateTrend(list, 0), { entry: "x", index: 0, count: 3 });
assert.deepEqual(rotateTrend(list, 4), { entry: "y", index: 1, count: 3 });
assert.deepEqual(rotateTrend(list, -1), { entry: "z", index: 2, count: 3 }, "the tick never produces a negative index");
assert.deepEqual(rotateTrend([], 3), { entry: null, index: 0, count: 0 });
assert.deepEqual(rotateTrend(undefined, 3), { entry: null, index: 0, count: 0 });
assert.deepEqual(rotateTrend(["only"], 99), { entry: "only", index: 0, count: 1 });

// The highlight steps one desk per tick; entries only advance once it has
// been all the way round, so every desk shows its #1 before any shows its #2.
assert.deepEqual(rotateDesks(4, 0), { index: 0, round: 0 });
assert.deepEqual(rotateDesks(4, 3), { index: 3, round: 0 });
assert.deepEqual(rotateDesks(4, 4), { index: 0, round: 1 }, "a full lap advances the entries");
assert.deepEqual(rotateDesks(4, 9), { index: 1, round: 2 });
assert.deepEqual(rotateDesks(1, 7), { index: 0, round: 7 }, "one desk advances its entry every tick");
assert.deepEqual(rotateDesks(0, 5), { index: 0, round: 0 }, "no desks is not a crash");
assert.deepEqual(rotateDesks(3, -1), { index: 2, round: -1 }, "the index never goes negative");

assert.equal(TREND_ROTATION_MS, 5000);

console.log("Overview trend tests passed");
