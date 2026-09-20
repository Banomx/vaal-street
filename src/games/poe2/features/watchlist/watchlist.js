import { createJsonStore } from "../../../../shared/storage/jsonStore.js";

export const WATCHLIST_LIMIT = 100;
export function watchlistStore(league, storage) {
  return createJsonStore({ game: "poe2", feature: "watchlist." + encodeURIComponent(league), storage });
}
export function sanitizeWatchlist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || seen.has(entry.name)) return [];
    seen.add(entry.name);
    const target = Number(entry.target);
    return [{
      name: entry.name, direction: entry.direction === "above" ? "above" : "below",
      unit: ["exalted", "chaos", "divine"].includes(entry.unit) ? entry.unit : "exalted",
      target: Number.isFinite(target) && target > 0 ? target : null,
    }];
  }).slice(0, WATCHLIST_LIMIT);
}
export function evaluateWatch(entry, snapshot, now = Date.now()) {
  const quote = snapshot?.prices?.[entry.name];
  const price = quote?.exalted;
  const divisor = entry.unit === "divine" ? snapshot?.divineExalted
    : entry.unit === "chaos" ? snapshot?.prices?.["Chaos Orb"]?.exalted : 1;
  const at = Date.parse(quote?.marketHour || quote?.observedAt || snapshot?.generatedAt || "");
  const stale = !Number.isFinite(at) || now - at > 3 * 3600e3 || at > now + 5 * 60e3;
  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(divisor) && divisor > 0)) {
    return { value: null, reached: false, state: "No quote", at };
  }
  const value = price / divisor;
  const reached = entry.target != null && (entry.direction === "above" ? value >= entry.target : value <= entry.target);
  return { value, at, reached: !stale && reached,
    state: stale ? "Stale quote" : entry.target == null ? "Watching" : reached ? "Target met" : "Waiting" };
}
