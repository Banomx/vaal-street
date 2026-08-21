const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PRICE_HISTORY_SCHEMA_VERSION = 1;
export const PRICE_HISTORY_HOURLY_HOURS = 168;
export const PRICE_HISTORY_MAX_DAYS = 430;
export const TABLET_BASELINE_VERSION = 1;

function finitePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rowsFromHistory(history) {
  const timestamps = Array.isArray(history?.timestamps) ? history.timestamps : [];
  const rates = Array.isArray(history?.divineExalted) ? history.divineExalted : [];
  const series = history?.series && typeof history.series === "object" ? history.series : {};
  const rows = new Map();

  for (let index = 0; index < timestamps.length; index += 1) {
    const atMs = Date.parse(timestamps[index]);
    if (!Number.isFinite(atMs)) continue;
    const prices = {};
    for (const [name, values] of Object.entries(series)) {
      if (!Array.isArray(values)) continue;
      const value = finitePrice(values[index]);
      if (value != null) prices[name] = value;
    }
    rows.set(new Date(atMs).toISOString(), {
      divineExalted: finitePrice(rates[index]),
      prices,
    });
  }
  return rows;
}

function historyFromRows(rows, { league = "", generatedAt = null, tabletBaselineVersion = null } = {}) {
  const entries = [...rows.entries()].sort(([left], [right]) => Date.parse(left) - Date.parse(right));
  const timestamps = entries.map(([at]) => at);
  const names = [...new Set(entries.flatMap(([, row]) => Object.keys(row.prices || {})))].sort((a, b) => a.localeCompare(b));
  const series = Object.fromEntries(names.map((name) => [name, entries.map(([, row]) => finitePrice(row.prices?.[name]))]));

  return {
    schemaVersion: PRICE_HISTORY_SCHEMA_VERSION,
    generatedAt: generatedAt || timestamps[timestamps.length - 1] || new Date().toISOString(),
    league,
    retention: {
      hourlyHours: PRICE_HISTORY_HOURLY_HOURS,
      maxDays: PRICE_HISTORY_MAX_DAYS,
    },
    timestamps,
    divineExalted: entries.map(([, row]) => finitePrice(row.divineExalted)),
    series,
    ...(tabletBaselineVersion ? { tabletBaselineVersion } : {}),
  };
}

export function mergePriceHistories(...histories) {
  const documents = histories.filter(Boolean);
  const rows = new Map();
  for (const history of documents) {
    for (const [timestamp, row] of rowsFromHistory(history)) rows.set(timestamp, row);
  }
  const newest = documents[documents.length - 1] || {};
  return historyFromRows(rows, {
    league: newest.league || documents.find((history) => history?.league)?.league || "",
    generatedAt: newest.generatedAt,
    tabletBaselineVersion: newest.tabletBaselineVersion || documents.find((history) => history?.tabletBaselineVersion)?.tabletBaselineVersion || null,
  });
}

export function thinPriceHistory(history, {
  nowMs = Date.now(),
  hourlyHours = PRICE_HISTORY_HOURLY_HOURS,
  maxDays = PRICE_HISTORY_MAX_DAYS,
} = {}) {
  const minimum = nowMs - maxDays * DAY_MS;
  const hourlyCutoff = nowMs - hourlyHours * HOUR_MS;
  const recent = [];
  const daily = new Map();

  for (const entry of rowsFromHistory(history)) {
    const atMs = Date.parse(entry[0]);
    if (atMs < minimum || atMs > nowMs + HOUR_MS) continue;
    if (atMs >= hourlyCutoff) recent.push(entry);
    else daily.set(new Date(atMs).toISOString().slice(0, 10), entry);
  }

  return historyFromRows(new Map([...daily.values(), ...recent]), {
    league: history?.league || "",
    generatedAt: history?.generatedAt,
    tabletBaselineVersion: history?.tabletBaselineVersion || null,
  });
}

function normalTabletNames(snapshot) {
  return Object.entries(snapshot?.prices || {}).filter(([, entry]) =>
    String(entry?.marketFamily || "").toLowerCase() === "precursortablets"
      && String(entry?.variant || "").toLowerCase() === "normal")
    .map(([name]) => name);
}

export function appendPriceSnapshot(history, snapshot, { nowMs } = {}) {
  const timestampMs = Date.parse(snapshot?.generatedAt);
  if (!Number.isFinite(timestampMs)) throw new Error("PoE 2 snapshot has no valid generatedAt timestamp");
  const prices = Object.fromEntries(Object.entries(snapshot?.prices || {})
    .map(([name, entry]) => [name, finitePrice(entry?.exalted)])
    .filter(([, value]) => value != null));
  const tabletNames = normalTabletNames(snapshot);
  let compatibleHistory = history;
  if (tabletNames.length && history && history.tabletBaselineVersion !== TABLET_BASELINE_VERSION) {
    const series = { ...(history.series || {}) };
    for (const name of tabletNames) delete series[name];
    compatibleHistory = { ...history, series };
  }
  const point = historyFromRows(new Map([[new Date(timestampMs).toISOString(), {
    divineExalted: finitePrice(snapshot?.divineExalted),
    prices,
  }]]), {
    league: snapshot?.league || history?.league || "",
    generatedAt: new Date(timestampMs).toISOString(),
    tabletBaselineVersion: tabletNames.length ? TABLET_BASELINE_VERSION : compatibleHistory?.tabletBaselineVersion || null,
  });
  const merged = mergePriceHistories(compatibleHistory, point);
  merged.generatedAt = new Date(timestampMs).toISOString();
  if (tabletNames.length) merged.tabletBaselineVersion = TABLET_BASELINE_VERSION;
  return thinPriceHistory(merged, { nowMs: nowMs ?? timestampMs });
}
