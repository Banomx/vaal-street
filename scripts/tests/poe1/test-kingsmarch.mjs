import assert from "node:assert/strict";
import { KINGSMARCH_PORTS, KINGSMARCH_ITEM_NAMES } from "../../../src/games/poe1/features/kingsmarch/ports.js";
import { kingsmarchSnapshot, portTimeline, rankPorts, valuePort } from "../../../src/games/poe1/features/kingsmarch/kingsmarch.js";
import { CATEGORY_BY_KEY } from "../../../src/games/poe1/catalogue/categories.js";
import { classifyItem } from "../../../src/games/poe1/catalogue/classify.js";

const byId = Object.fromEntries(KINGSMARCH_PORTS.map((port) => [port.id, port]));
assert.deepEqual(KINGSMARCH_PORTS.map((port) => port.items.length), [21, 15, 17, 11, 13, 13]);
assert.equal(KINGSMARCH_ITEM_NAMES.length, 84);
assert.equal(new Set(KINGSMARCH_PORTS.filter((port) => port.kind === "tattoos").flatMap((port) => port.items)).size, 53);
assert.equal(new Set(KINGSMARCH_PORTS.filter((port) => port.kind === "runegrafts").flatMap((port) => port.items)).size, 31);
for (const port of KINGSMARCH_PORTS) {
  assert.equal(new Set(port.items).size, port.items.length);
  for (const name of port.items) assert.ok(CATEGORY_BY_KEY[port.kind].re.test(name));
}
assert.ok(byId["tattoo-str"].items.includes("Tattoo of the Valako Shieldbearer"));
assert.ok(byId["tattoo-str"].items.includes("Tattoo of the Tasalio Bladedancer"));
assert.ok(byId["tattoo-int"].items.includes("Tattoo of the Kitava Heart Eater"));
assert.ok(byId["tattoo-dex"].items.includes("Journey Tattoo of the Mind"));
assert.ok(!KINGSMARCH_ITEM_NAMES.some((name) => /Honoured|Makanga|Loyalty Tattoo|Scarab/.test(name)));
for (const port of KINGSMARCH_PORTS.filter((port) => port.kind === "runegrafts")) {
  for (const common of ["Runegraft of the Angler", "Runegraft of the Fortress", "Runegraft of Gemcraft"]) assert.ok(port.items.includes(common));
}
assert.equal(classifyItem({ name: "Runegraft of the River", gggId: "Metadata/Items/Currency/RunegraftStrength" }, "runegrafts").confidence, "metadata");
assert.equal(classifyItem({ name: "Tattoo of the Valako Shieldbearer", gggId: "Metadata/Items/Currency/AncestralTattooValako4" }, "tattoos").confidence, "metadata");

const pool = { id: "example", port: "Example", items: ["Common", "Rare"] };
const oldFamily = { generatedAt: "2026-11-21T20:00:00Z" };
const newBroad = { generatedAt: "2026-11-21T21:00:00Z" };
assert.equal(kingsmarchSnapshot({ tattoos: oldFamily, prices: newBroad }, "tattoos"), newBroad);
assert.equal(kingsmarchSnapshot({ tattoos: oldFamily, prices: "missing" }, "tattoos"), oldFamily);
const complete = valuePort(pool, { prices: { Common: { c: 10 }, Rare: { c: 90 }, Ignored: { c: 99999 } } });
assert.equal(complete.average, 50, "each eligible item has equal weight; unrelated prices never enter the pool");
assert.equal(complete.median, 50);
assert.equal(complete.complete, true);
const partial = valuePort(pool, { prices: { Common: { c: 10 } } });
assert.equal(partial.average, 10, "unknown is excluded, not assigned zero");
assert.equal(partial.quoted, 1);
assert.equal(partial.complete, false);
assert.equal(valuePort(pool, { items: [{ name: "Common", chaosValue: 10 }, { name: "Rare", chaosValue: 90, staleHours: 2 }] }).average, 10);
assert.equal(valuePort(pool, { prices: { Common: { c: 0 }, Rare: { c: -2 } } }).average, null);
assert.equal(rankPorts([{ ...partial, average: 900 }, complete])[0].complete, true, "a partial mean must not outrank complete pools");

const end = Date.parse("2026-11-21T23:00:00Z");
const history = { points: [
  { t: new Date(end - 2 * 3600_000).toISOString(), values: { Common: 10, Rare: 90 } },
  { t: new Date(end - 3600_000).toISOString(), values: { Common: 20 } },
  { t: new Date(end).toISOString(), values: { Common: 30, Rare: 90 } },
] };
const mean = portTimeline(history, pool, "4h");
assert.deepEqual(mean.points.map((point) => point.value), [50, 60]);
assert.deepEqual(portTimeline(history, complete, "4h").points.map((point) => point.value), [50, 60],
  "the priced port model used by the UI retains the same historical membership");
assert.equal(mean.segments.length, 2, "a missing pool member breaks the mean graph instead of causing a fake crash");
assert.deepEqual(portTimeline(history, pool, "4h", "Common").points.map((point) => point.value), [10, 20, 30]);
assert.equal(portTimeline(history, pool, "1h").points.length, 1);
assert.deepEqual(portTimeline(null, pool, "48h").points, []);
console.log("Kingsmarch reward pools, equal-weight averages and history passed.");
