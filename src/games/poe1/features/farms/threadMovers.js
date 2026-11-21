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
  }).sort((a, b) => (b.movement ?? -Infinity) - (a.movement ?? -Infinity) || a.name.localeCompare(b.name));
}
