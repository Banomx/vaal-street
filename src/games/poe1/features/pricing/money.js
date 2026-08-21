/* ================================================================
   MONEY FORMATTING
   Pure functions, no React — the whole site quotes prices through
   these, and scripts/tests/poe1/test-money.mjs covers them.

   Three currency modes:
     "chaos"   every value in chaos
     "divine"  every value in divine
     "smart"   whichever unit reads cleanly for that particular value
   ================================================================ */

/* Above this many divines, "smart" switches a value over to divine.
   Below it, chaos. 2 divine is roughly where a chaos figure stops being
   something you can read at a glance. */
export const SMART_DIV_AT = 2;

export function fmtChaos(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return Math.round(v).toString();
  return v.toFixed(1);
}

/* Two decimals is fine for whole-divine sums, but the boss tab shows per-drop
   expected values that are often a few chaos — those collapsed to "0.00 div".
   Below 0.1 divine, show three. */
export function fmtDiv(v) {
  return v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3);
}

/* Which unit one value should be quoted in.
   For the fixed modes this just hands the mode back, so callers can run every
   value through it without branching on the mode themselves.

   Note the rate guard: before the divine rate loads it is 0, and dividing by
   it would print Infinity. Smart falls back to chaos until the rate arrives. */
export function unitFor(chaos, currency, rate) {
  if (currency !== "smart") return currency;
  return (rate > 0 && Math.abs(chaos) >= SMART_DIV_AT * rate) ? "divine" : "chaos";
}

export function fmtPrice(chaos, currency, rate) {
  return unitFor(chaos, currency, rate) === "chaos"
    ? `${fmtChaos(chaos)}c`
    : `${fmtDiv(chaos / rate)} div`;
}

/* A chart has one y axis, so it needs ONE unit for the whole series — mixing
   units down a single axis would make the line meaningless. Pick from the
   largest point: if the peak deserves divine, the whole series is drawn in
   divine, and the small early values render as fractions rather than the axis
   flipping unit halfway along. */
export function unitForSeries(chaosValues, currency, rate) {
  const peak = Math.max(0, ...(chaosValues || []).filter((v) => isFinite(v)));
  return unitFor(peak, currency, rate);
}
