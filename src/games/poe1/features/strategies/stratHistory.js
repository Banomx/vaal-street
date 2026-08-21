/* ================================================================
   SAVED-STRATEGY HISTORY
   ----------------------------------------------------------------
   Every other graph in the site plots one series. A saved strategy is
   up to six items that were priced independently, so its graph has to
   add series that do not start on the same day and were not sampled
   at the same minutes.

   Two rules keep the total honest:

   - An item with no history at all is dropped from the sum and named
     in `without`. Carrying its current price backwards would draw a
     plateau that never traded.
   - The plotted window is the OVERLAP of the items that do have
     history: from the latest first day to the earliest last day.
     Before that day at least one item is missing, and a total that
     quietly loses a scarab halfway back reads as a price crash.

   Inside the window an item without a sample on that exact day
   contributes its nearest one. Sources are sampled hourly at slightly
   different times, so exact-day matching alone would leave the total
   full of holes.

   Duplicate scarabs are separate map-device slots, so pass them as
   separate entries — they are summed twice, the same way
   computeFarmStrategy() prices them twice.
   ================================================================ */

function cleanPoints(raw) {
  if (!Array.isArray(raw)) return [];
  // Number.isFinite, not isFinite: a null price coerces to 0 and would draw a
  // free scarab rather than a missing one.
  return raw
    .filter((p) => p && Number.isFinite(p.day) && Number.isFinite(p.value))
    .map((p) => ({ day: p.day, value: p.value }))
    .sort((a, b) => a.day - b.day);
}

function valueAt(points, day) {
  let best = points[0];
  for (const p of points) {
    if (p.day === day) return p.value;
    if (Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
  }
  return best.value;
}

/* members: [{ name, points }] in slot order, duplicates included.
   focus:   item name to plot on its own alongside the total, or null. */
export function combineStratHistory(members = [], focus = null) {
  const series = [];
  const without = [];
  for (const member of members) {
    if (!member || !member.name) continue;
    const points = cleanPoints(member.points);
    if (points.length) series.push({ name: member.name, points });
    else if (!without.includes(member.name)) without.push(member.name);
  }

  const base = { rows: [], from: null, to: null, covered: series.length, of: members.length, without, clipped: false };
  if (!series.length) return base;

  const from = Math.max(...series.map((s) => s.points[0].day));
  const to = Math.min(...series.map((s) => s.points[s.points.length - 1].day));
  const unionFrom = Math.min(...series.map((s) => s.points[0].day));
  const unionTo = Math.max(...series.map((s) => s.points[s.points.length - 1].day));
  const clipped = from > unionFrom || to < unionTo;
  if (!(to >= from)) return { ...base, from, to, clipped: true };

  const days = new Set([from, to]);
  for (const s of series) for (const p of s.points) if (p.day >= from && p.day <= to) days.add(p.day);

  const rows = [...days].sort((a, b) => a - b).map((day) => {
    let chaos = 0;
    let focusChaos = null;
    for (const s of series) {
      const value = valueAt(s.points, day);
      chaos += value;
      // A focused scarab held in two slots is worth two of it on the chart,
      // for the same reason it is counted twice in the total.
      if (focus && s.name === focus) focusChaos = (focusChaos || 0) + value;
    }
    return { day, chaos, focusChaos };
  });

  return { rows, from, to, covered: series.length, of: members.length, without, clipped };
}
