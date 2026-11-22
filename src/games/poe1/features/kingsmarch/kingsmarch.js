import { priceTimeline } from "../pricing/marketTimeline.js";

const positive = (value) => Number.isFinite(value) && value > 0;

export function kingsmarchSnapshot(documents, kind) {
  const family = documents[kind];
  const broad = documents.prices;
  if (!family || typeof family !== "object") return broad;
  if (!broad || typeof broad !== "object") return family;
  return Date.parse(family.generatedAt) >= Date.parse(broad.generatedAt) ? family : broad;
}

export function valuePort(port, snapshot) {
  const byName = new Map((snapshot?.items || []).map((item) => [item.name, item]));
  const items = port.items.map((name) => {
    const item = byName.get(name) || snapshot?.prices?.[name];
    const value = item?.chaosValue ?? item?.c;
    const carried = item?.stale === true || item?.staleHours > 0;
    return { name, price: positive(value) ? value : null, carried };
  }).sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity) || a.name.localeCompare(b.name));
  const priced = items.filter((item) => item.price !== null && !item.carried);
  const average = priced.length ? priced.reduce((sum, item) => sum + item.price, 0) / priced.length : null;
  const sorted = priced.map((item) => item.price).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
  return { ...port, items, average, median, quoted: priced.length, complete: priced.length === port.items.length };
}

export function portTimeline(history, port, window, itemName = null) {
  return priceTimeline(history, (point) => {
    if (itemName) return point.values?.[itemName];
    const values = port.items.map((item) => point.values?.[typeof item === "string" ? item : item.name]);
    return values.every(positive) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, window);
}

export function rankPorts(ports) {
  return [...ports].sort((a, b) => Number(b.complete) - Number(a.complete)
    || (b.average ?? -Infinity) - (a.average ?? -Infinity) || a.port.localeCompare(b.port));
}
