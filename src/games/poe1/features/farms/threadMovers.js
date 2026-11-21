import { THREAD_ITEMS } from "../../catalogue/categories.js";
import { CHANGE_KEYS } from "../pricing/marketWindows.js";

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

// Keep one shared 48h time axis and break lines across missing hourly data.
export function threadTimeline(history, name) {
  const byTime = new Map();
  for (const point of history?.points || []) {
    const t = Date.parse(point?.t);
    if (Number.isFinite(t)) byTime.set(t, point.values?.[name]);
  }
  if (!byTime.size) return { points: [], segments: [], start: null, end: null };
  const end = Math.max(...byTime.keys());
  const start = end - 48 * HOUR;
  const points = [];
  const segments = [];
  let segment = null;
  for (const [t, value] of [...byTime].sort((a, b) => a[0] - b[0])) {
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
  return { points, segments, start, end };
}
