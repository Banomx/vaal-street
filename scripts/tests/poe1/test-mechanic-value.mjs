import assert from "node:assert/strict";
import { MECHANICS, rankMechanics, valueMechanic } from "../../../src/games/poe1/features/mechanics/mechanicValue.js";

const mechanic = { id: "fixture", name: "Fixture", drops: ["A", "B", "C"] };
const hour = "2026-11-09T18:00:00Z";
const snapshot = {
  generatedAt: "2026-11-09T19:00:00Z",
  gggHour: hour,
  prices: {
    A: { c: 10, exchangeSource: "GGG", volume1H: 8, marketHour: hour },
    B: { c: 4, exchangeSource: "GGG", volume1H: 500, marketHour: "2026-11-09T17:00:00Z", staleHours: 1 },
    C: { c: 1, volume1H: 5000 },
  },
};
const sample = { runs: "4", minutes: "30", cost: "8", counts: { A: "2", B: "0", C: "3" } };
const row = valueMechanic(mechanic, snapshot, sample);
assert.equal(row.flow, 80, "Only same-hour completed trades contribute to flow");
assert.equal(row.flowCoverage, 1);
assert.equal(row.netPerHour, 30, "Reprices tracked units, subtracts total cost and scales by elapsed minutes");
assert.equal(row.netPerRun, 3.75);
assert.equal(valueMechanic(mechanic, snapshot, { ...sample, counts: { ...sample.counts, B: "1" } }).netPerHour, null, "Older quotes do not price observed loot");
assert.equal(valueMechanic(mechanic, snapshot, { ...sample, counts: { ...sample.counts, C: "" } }).netPerHour, null, "Blank does not mean zero");
assert.equal(valueMechanic(mechanic, snapshot, { ...sample, cost: "" }).netPerHour, null, "Cost must be explicit");
assert.equal(valueMechanic(mechanic, snapshot, { ...sample, minutes: "0" }).netPerHour, null, "Zero minutes cannot rank");
const partial = { ...snapshot, prices: { A: snapshot.prices.A } };
assert.equal(valueMechanic(mechanic, partial, sample).netPerHour, null, "Missing positive drop cannot be priced");
const loss = valueMechanic(mechanic, partial, { ...sample, counts: { A: "0", B: "0", C: "0" } });
assert.equal(loss.netPerHour, -16, "Recorded zero drops preserve the loss without requiring unused quotes");
assert.equal(valueMechanic(mechanic, null, sample).netPerHour, null);
assert.deepEqual(rankMechanics([{ name: "unknown", netPerHour: null }, { name: "loss", netPerHour: -16 }, row], "netPerHour").map(({ name }) => name), ["Fixture", "loss", "unknown"]);
const allDrops = MECHANICS.flatMap(({ drops }) => drops);
assert.equal(new Set(allDrops).size, allDrops.length, "Each default item belongs to one comparison basket");
console.log("PoE 1 mechanic reward and sample valuation checks passed.");
