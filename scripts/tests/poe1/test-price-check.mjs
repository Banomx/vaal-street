import assert from "node:assert/strict";
import {
  VOLATILE_RATIO, comparePrices, describeSpreads, sourceNote,
} from "../../../src/games/poe1/features/pricing/priceCheck.js";

/* ---- comparing two feeds ---- */
assert.equal(comparePrices(10, 10).volatile, false);
assert.equal(comparePrices(10, 14).volatile, false, "ordinary churn between feeds is not a disagreement");
assert.equal(comparePrices(10, 15).volatile, true, "at the threshold exactly");
assert.equal(comparePrices(1300, 8).volatile, true, "the identified/unidentified case this exists for");
assert.equal(comparePrices(8, 1300).ratio, comparePrices(1300, 8).ratio, "order must not matter");
// A gap is not a disagreement: one feed simply not knowing an item would tag
// most of the map if it counted.
assert.equal(comparePrices(10, 0), null);
assert.equal(comparePrices(10, undefined), null);
assert.equal(comparePrices(null, null), null);
assert.equal(comparePrices(10, 15, { ratio: 3 }).volatile, false, "the threshold is adjustable");
assert.equal(VOLATILE_RATIO, 1.5);

/* ---- the log line ---- */
// Log only: this never touches a price entry, so it takes the raw pairs.
const flagged = [
  { name: "Cheap", watch: 1, ninja: 3 },
  { name: "Dear", watch: 8, ninja: 1300 },
  { name: "Quiet", watch: 4, ninja: 4 },
  { name: "Lonely", watch: 5 },
];
const lines = describeSpreads(flagged);
assert.equal(lines.length, 2, "only disagreements are reported — a one-feed name is not one");
assert.match(lines[0], /^Dear:/, "widest gap first — that is the one moving an EV");
assert.match(lines[0], /poe\.watch 8c vs poe\.ninja 1300c \(162\.5x\)/);
assert.deepEqual(describeSpreads([]), []);
assert.deepEqual(describeSpreads(undefined), []);
assert.equal(describeSpreads(flagged, { limit: 1 }).length, 2, "a truncated list says how much it dropped");
assert.match(describeSpreads(flagged, { limit: 1 })[1], /1 more/);

/* ---- the comparison must be like for like ---- */
// Two feeds whose floors agree are not in disagreement, however far apart their
// means are — and the floor is what a boss line quotes.
assert.equal(comparePrices(8, 8.2).volatile, false, "matching floors never flag");
assert.deepEqual(describeSpreads([{ name: "Calm", watch: 8, ninja: 8.2 }]), []);

/* ---- what the reader is told ---- */
// The only thing worth saying on a line is that poe.ninja did not have it.
assert.match(sourceNote({ c: 8, source: "poe.watch" }), /poe\.ninja does not list this item/);
assert.match(sourceNote({ c: 8, source: "poe.watch" }), /comes from poe\.watch/);
// Everything else is the unremarkable case and says nothing. An entry only
// carries `source` when poe.watch supplied it.
assert.equal(sourceNote({ c: 8 }), null, "a poe.ninja price is the norm and needs no badge");
assert.equal(sourceNote({ c: 8, exchangeSource: "GGG" }), null, "nor does a completed GGG trade");
assert.equal(sourceNote({ c: 8, source: "poe.ninja" }), null, "only the fallback is called out");
assert.equal(sourceNote(null), null);

// Disagreeing feeds no longer say anything on the line: poe.ninja won, and the
// old `contested` badge warned about prices that were fine.
assert.equal(sourceNote({ c: 8, volatile: true, spread: 5 }), null);

console.log("Price check tests passed");
