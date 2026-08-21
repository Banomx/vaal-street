export const CHANGE_WINDOW_OPTIONS = ["1h", "2h", "4h", "8h", "12h", "24h", "48h"];

export const CHANGE_KEYS = Object.fromEntries(
  CHANGE_WINDOW_OPTIONS.map((window) => [window, `change${parseInt(window, 10)}`]),
);

export function weightedChange(items, key) {
  let now = 0;
  let previous = 0;
  let measurable = false;
  for (const item of items) {
    let change = item?.[key];
    if (change == null || !Number.isFinite(change)) change = 0;
    else measurable = true;
    const price = Number(item?.chaosValue) || 0;
    now += price;
    previous += price / Math.max(0.05, 1 + change / 100);
  }
  return measurable && previous > 0 ? (now / previous - 1) * 100 : null;
}

export function nearestHistoryWindow(history, window) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const hours = parseInt(window, 10);
  if (!(hours > 0)) return null;
  const last = history[history.length - 1];
  const target = last.day - hours / 24;
  let reference = history[0];
  for (const point of history) {
    if (Math.abs(point.day - target) < Math.abs(reference.day - target)) reference = point;
  }
  // Hourly jobs can drift around the boundary. Keep enough tolerance for that,
  // but never turn a many-hours-old point into a fake 1h or 2h comparison.
  const toleranceDays = 0.03;
  if (Math.abs(reference.day - target) > toleranceDays) return null;
  return { reference, last };
}

export function nearestRateWindow(history, window) {
  const match = nearestHistoryWindow(history, window);
  if (!match || !(match.reference.rate > 0) || !(match.last.rate > 0)) return null;
  return { ...match, pct: (match.last.rate / match.reference.rate - 1) * 100 };
}
