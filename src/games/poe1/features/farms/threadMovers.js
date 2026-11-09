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
