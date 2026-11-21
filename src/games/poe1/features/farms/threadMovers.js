import { THREAD_ITEMS } from "../../catalogue/categories.js";
import { CHANGE_KEYS, CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";

export function threadMovers(items, window) {
  const key = CHANGE_KEYS[window];
  const quoted = (items || []).filter((item) => Number.isFinite(item.chaosValue) && item.chaosValue > 0);
  const measured = quoted.filter((item) => Number.isFinite(item[key]) && !(item.staleHours > 0));
  return {
    quoted: quoted.length,
    measured: measured.length,
    rising: measured.filter((item) => item[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
      .map((item) => ({ ...item, movement: item[key] })),
  };
}

export function threadPriceRows(items = [], window) {
  const key = CHANGE_KEYS[window];
  return THREAD_ITEMS.map((thread) => {
    const item = items.find((row) => [row.id, row.gggId, row.metadataPath].includes(thread.id))
      || items.find((row) => row.name === thread.name);
    const price = Number.isFinite(item?.chaosValue) && item.chaosValue > 0 ? item.chaosValue : null;
    const movement = price !== null && !(item?.staleHours > 0) && Number.isFinite(item?.[key]) ? item[key] : null;
    return { ...thread, price, movement };
  }).sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity) || a.name.localeCompare(b.name));
}

const HOUR = 3600_000;

// Every row shares the selected time axis. Hourly jobs get 15m boundary slack.
export function threadTimeline(history, name, window = "48h") {
  const byTime = new Map();
  for (const point of history?.points || []) {
    const t = Date.parse(point?.t);
    if (Number.isFinite(t)) byTime.set(t, point.values?.[name]);
  }
  if (!byTime.size) return { points: [], segments: [], gaps: [], start: null, end: null };
  const end = Math.max(...byTime.keys());
  const hours = CHANGE_WINDOW_OPTIONS.includes(window) ? parseInt(window, 10) : 48;
  const target = end - hours * HOUR;
  const sorted = [...byTime].sort((a, b) => a[0] - b[0]);
  const boundary = sorted.filter(([t]) => t <= target && t >= target - HOUR / 4).at(-1);
  const start = boundary?.[0] ?? target;
  const points = [];
  const segments = [];
  let segment = null;
  for (const [t, value] of sorted) {
    if (t < start) continue;
    if (!Number.isFinite(value) || value <= 0) { segment = null; continue; }
    const point = { t, value };
    if (!segment || t - segment.at(-1).t > 2.25 * HOUR) {
      segment = [];
      segments.push(segment);
    }
    segment.push(point);
    points.push(point);
  }
  const gaps = [];
  let previous = start;
  for (const segment of segments) {
    if (segment[0].t - previous > HOUR / 4) gaps.push({ start: previous, end: segment[0].t });
    previous = segment.at(-1).t;
  }
  if (end - previous > HOUR / 4) gaps.push({ start: previous, end });
  return { points, segments, gaps, start, end };
}

export function threadChartCursor(timeline, time) {
  if (!timeline.points.length || !Number.isFinite(time)) return null;
  const gap = timeline.gaps.find((gap) => time > gap.start && time < gap.end);
  if (gap) return { gap };
  let index = 0;
  for (let i = 1; i < timeline.points.length; i++) {
    if (Math.abs(timeline.points[i].t - time) < Math.abs(timeline.points[index].t - time)) index = i;
  }
  return { point: timeline.points[index], index };
}
