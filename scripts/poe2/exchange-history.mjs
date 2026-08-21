import { PRICE_HISTORY_HOURLY_HOURS, PRICE_HISTORY_MAX_DAYS } from "./history.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rowsFromHistory(history) {
  const keys = Array.isArray(history?.pairKeys) ? history.pairKeys : [];
  const rows = new Map();
  for (const snapshot of Array.isArray(history?.snapshots) ? history.snapshots : []) {
    const atMs = Date.parse(snapshot?.at);
    if (!Number.isFinite(atMs)) continue;
    const pairs = new Map();
    for (const values of Array.isArray(snapshot?.pairs) ? snapshot.pairs : []) {
      const key = keys[Number(values?.[0])];
      if (!key) continue;
      const metrics = values.slice(1, 7).map(positive);
      if (metrics.every((value) => value != null)) pairs.set(key, metrics);
    }
    rows.set(new Date(atMs).toISOString(), pairs);
  }
  return rows;
}

function historyFromRows(rows, { league = "", generatedAt = null, items = {} } = {}) {
  const entries = [...rows.entries()].sort(([left], [right]) => Date.parse(left) - Date.parse(right));
  const pairKeys = [...new Set(entries.flatMap(([, pairs]) => [...pairs.keys()]))].sort();
  const pairIndex = new Map(pairKeys.map((key, index) => [key, index]));
  return {
    schemaVersion: 1,
    generatedAt: generatedAt || entries[entries.length - 1]?.[0] || new Date().toISOString(),
    league,
    retention: { hourlyHours: PRICE_HISTORY_HOURLY_HOURS, maxDays: PRICE_HISTORY_MAX_DAYS },
    items,
    pairKeys,
    snapshots: entries.map(([at, pairs]) => ({
      at,
      pairs: [...pairs.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, metrics]) => [pairIndex.get(key), ...metrics]),
    })),
  };
}

export function mergeExchangeHistories(...histories) {
  const documents = histories.filter(Boolean);
  const rows = new Map();
  let items = {};
  for (const history of documents) {
    for (const [at, pairs] of rowsFromHistory(history)) rows.set(at, pairs);
    items = { ...items, ...(history.items || {}) };
  }
  const newest = documents[documents.length - 1] || {};
  return historyFromRows(rows, {
    league: newest.league || documents.find((history) => history?.league)?.league || "",
    generatedAt: newest.generatedAt,
    items,
  });
}

export function thinExchangeHistory(history, {
  nowMs = Date.now(),
  hourlyHours = PRICE_HISTORY_HOURLY_HOURS,
  maxDays = PRICE_HISTORY_MAX_DAYS,
} = {}) {
  const minimum = nowMs - maxDays * DAY_MS;
  const hourlyCutoff = nowMs - hourlyHours * HOUR_MS;
  const daily = new Map();
  const recent = [];
  for (const entry of rowsFromHistory(history)) {
    const atMs = Date.parse(entry[0]);
    if (atMs < minimum || atMs > nowMs + HOUR_MS) continue;
    if (atMs >= hourlyCutoff) recent.push(entry);
    else daily.set(new Date(atMs).toISOString().slice(0, 10), entry);
  }
  return historyFromRows(new Map([...daily.values(), ...recent]), {
    league: history?.league || "",
    generatedAt: history?.generatedAt,
    items: history?.items || {},
  });
}

export function appendExchangeSnapshot(history, snapshot, { nowMs } = {}) {
  const atMs = Date.parse(snapshot?.marketHour || snapshot?.generatedAt);
  if (!Number.isFinite(atMs)) throw new Error("PoE 2 exchange snapshot has no valid market hour");
  const pairs = new Map((snapshot?.pairs || []).map((pair) => [pair.id, [
    positive(pair.leftVolume),
    positive(pair.rightVolume),
    positive(pair.rightPerLeft),
    positive(pair.lowRightPerLeft),
    positive(pair.highRightPerLeft),
  ]]).filter(([, values]) => values.every((value) => value != null)));
  const point = historyFromRows(new Map([[new Date(atMs).toISOString(), pairs]]), {
    league: snapshot?.league || history?.league || "",
    generatedAt: snapshot?.generatedAt,
    items: snapshot?.items || {},
  });
  const merged = mergeExchangeHistories(history, point);
  merged.generatedAt = snapshot?.generatedAt || new Date(atMs).toISOString();
  return thinExchangeHistory(merged, { nowMs: nowMs ?? atMs });
}
