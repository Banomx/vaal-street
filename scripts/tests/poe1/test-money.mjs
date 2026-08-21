/* Money formatting, including the "smart" currency mode.

   Smart quotes each value in whichever unit reads cleanly: chaos below
   SMART_DIV_AT divines, divine at or above it. Two things make this easy to
   get wrong, so both are pinned here:

     1. The boundary is inclusive and measured in CHAOS against the live rate,
        not against a fixed number — a 2-divine item is 300c in one league and
        3000c in another.
     2. A chart cannot switch unit halfway down its own axis, so a series takes
        one unit chosen from its peak. A series whose peak earns divine is drawn
        entirely in divine, fractions and all.

   Run: node scripts/test-money.mjs
*/
import { SMART_DIV_AT, fmtChaos, fmtDiv, fmtPrice, unitFor, unitForSeries } from "../../../src/games/poe1/features/pricing/money.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const RATE = 180;                 // chaos per divine
const CUT = SMART_DIV_AT * RATE;  // 360c

/* ---- the fixed modes ignore the value entirely ---- */
eq(unitFor(1, "chaos", RATE), "chaos", "chaos mode stays chaos when tiny");
eq(unitFor(999999, "chaos", RATE), "chaos", "chaos mode stays chaos when huge");
eq(unitFor(1, "divine", RATE), "divine", "divine mode stays divine when tiny");

/* ---- smart switches at the boundary, inclusive ---- */
eq(unitFor(CUT - 0.01, "smart", RATE), "chaos", "just under the cut is chaos");
eq(unitFor(CUT, "smart", RATE), "divine", "exactly at the cut is divine");
eq(unitFor(CUT + 0.01, "smart", RATE), "divine", "just over the cut is divine");
eq(unitFor(0, "smart", RATE), "chaos", "zero is chaos");

/* Negative values (profit deltas) are judged on magnitude — a 900c loss is as
   unreadable in chaos as a 900c gain. */
eq(unitFor(-CUT, "smart", RATE), "divine", "a big loss reads in divine too");
eq(unitFor(-1, "smart", RATE), "chaos", "a small loss stays chaos");

/* The cut follows the rate, not a hardcoded chaos figure. */
eq(unitFor(400, "smart", 100), "divine", "400c is 4 divine at rate 100");
eq(unitFor(400, "smart", 1300), "chaos", "400c is a fraction of a divine at rate 1300");

/* Before the snapshot loads the rate is 0; dividing by it would print
   Infinity, so smart has to stay in chaos until a rate exists. */
eq(unitFor(999999, "smart", 0), "chaos", "no rate yet -> chaos, never Infinity");
ok(!/Infinity|NaN/.test(fmtPrice(999999, "smart", 0)), `no rate must not print Infinity: ${fmtPrice(999999, "smart", 0)}`);

/* ---- rendering ---- */
eq(fmtPrice(50, "smart", RATE), "50.0c", "small value renders as chaos");
eq(fmtPrice(1800, "smart", RATE), "10.0 div", "big value renders as divine");
eq(fmtPrice(1800, "chaos", RATE), "1.8kc", "chaos mode abbreviates thousands");
eq(fmtPrice(50, "divine", RATE), "0.28 div", "divine mode keeps two decimals near zero");
eq(fmtChaos(12.34), "12.3", "chaos one decimal");
eq(fmtChaos(1234), "1.2k", "chaos thousands");
eq(fmtDiv(0.004), "0.004", "sub-0.1 divine keeps three decimals");

/* ---- a series takes ONE unit, from its peak ---- */
eq(unitForSeries([1, 5, 20], "smart", RATE), "chaos", "series that never gets big stays chaos");
eq(unitForSeries([1, 5, CUT + 1], "smart", RATE), "divine",
   "one point over the cut pulls the whole axis to divine");
eq(unitForSeries([], "smart", RATE), "chaos", "empty series must not throw");
eq(unitForSeries([1, NaN, 20], "smart", RATE), "chaos", "a NaN point must not poison the peak");
eq(unitForSeries([1, 5, 9999], "chaos", RATE), "chaos", "fixed mode overrides the peak");

console.log(`\nsmart cut: ${SMART_DIV_AT} div = ${CUT}c at ${RATE}c/div`);
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
