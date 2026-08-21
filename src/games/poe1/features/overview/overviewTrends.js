/* Overview trend selection.

   The Overview renders the same five desks twice: once reading the top of each
   list, once reading the bottom. Both sides cycle through their own three
   entries on a shared tick, so the ranking and the cycling live here where
   scripts/tests/poe1/test-overview-trends.mjs can reach them without React. */

export const TREND_DEPTH = 3;
export const TREND_ROTATION_MS = 5000;

/** The top (`direction` "up") or bottom ("down") entries of `rows` by `valueOf`.

    `signed` drops entries on the wrong side of zero, which is what makes a
    rising list actually rising rather than merely least-bad. Rankings that are
    a level rather than a movement — boss net, Delve opportunity — pass
    `signed: false` and get a plain best/worst slice instead. A non-finite value
    never ranks: an unmeasured window is not a trend. */
export function pickTrend(rows, valueOf, direction, { depth = TREND_DEPTH, signed = true } = {}) {
  const up = direction !== "down";
  return (rows || [])
    .map((row) => ({ row, value: Number(valueOf(row)) }))
    .filter(({ value }) => Number.isFinite(value) && (!signed || (up ? value > 0 : value < 0)))
    .sort((a, b) => up ? b.value - a.value : a.value - b.value)
    .slice(0, Math.max(0, depth))
    .map(({ row }) => row);
}

/** Which desk the feature highlights, and which round of entries every desk is
    showing.

    The highlight moves one desk per tick; the entries only advance once the
    tick has been all the way round. So the page walks across the desks showing
    each one's strongest entry, then walks across again showing each one's
    second — rather than changing desk AND entry together, which skips most of
    what the shortlists hold. */
export function rotateDesks(count, tick) {
  if (!count) return { index: 0, round: 0 };
  const t = Math.trunc(tick);
  return { index: ((t % count) + count) % count, round: Math.floor(t / count) };
}

/** The entry a rotation tick currently points at, plus its position, so the UI
    can say "2/3" instead of silently swapping the headline out. */
export function rotateTrend(list, tick) {
  const count = (list || []).length;
  if (!count) return { entry: null, index: 0, count: 0 };
  const index = ((Math.trunc(tick) % count) + count) % count;
  return { entry: list[index], index, count };
}
