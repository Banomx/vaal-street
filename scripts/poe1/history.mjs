/* PoE 1 history: the pure part.

   Everything here is a function of its arguments — no network, no clock beyond
   an injectable `nowMs`, no module-level output directory. That is the point:
   `fetch-data.mjs` runs a snapshot the moment it is imported, so recovery tools
   and regression tests could not reach this logic while it lived there.

   The rules encoded here are the ones that cost real data when they are wrong:
   accumulated points are the only copy of a league's curve, and every derived
   file is a projection of them that has to be rebuilt whenever they change. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;

/* History retention, one rule for every family.

   The workflow runs hourly, so an unthinned league would be ~2,900 points.
   Recent hours stay at full resolution because the change badges read 1h to
   48h straight off these points; everything older collapses to one point per
   UTC day, which is all a league-long curve can render anyway.

   MAX_DAYS is the "compare the last two leagues" window: a league is 3-5 months,
   so ~14 months keeps two complete timelines readable end to end. A thinned league
   costs ~72 + 430 = roughly 500 points, so the cap is headroom against a
   pathological run rather than the thing doing the shaping. */
export const HISTORY_HOURLY_HOURS = 72;
export const HISTORY_MAX_DAYS = 430;
export const SELF_HISTORY_CAP = 1200;
/* Gems keep a tighter budget: there are ~800 of them against 120 scarabs, so
   the same point count is an order of magnitude more bytes. */
export const GEM_HISTORY_HOURLY_HOURS = 48;
export const GEM_HISTORY_CAP = 400;
export const RATE_HISTORY_CAP = 600; // max points in the emitted chaos-per-divine series

/* A divine has never been worth less than ~20c or more than a few thousand.
   Every rate that enters the pipeline goes through this, because the shape of
   the source (ratio vs. inverse ratio) is not always knowable up front. */
export const rateSane = (v) => typeof v === "number" && isFinite(v) && v >= 20 && v <= 20000;

/* `dropNonPositive` cleans a *price* series: a zero there is never a real
   price, it is what two-decimal rounding did to an item worth a thousandth of a
   chaos, and it draws a crash that never happened. Applying it while reading
   means a run that merely loads an old file repairs it.

   Gem history is the exception and must never be cleaned this way — it stores
   levelling profit, which is signed, and a gem that loses money is a real
   observation rather than a rounding artefact. */
export function normalizePoint(p, { dropNonPositive = false } = {}) {
  // old format: {date: "YYYY-MM-DD"}; new format: {t: ISO timestamp}
  // `rate` (chaos per divine) is newer still — points written before the
  // divine-rate feature simply don't have one, and everything downstream
  // treats a missing rate as "not measurable here" rather than an error.
  let values = p.values || {};
  if (dropNonPositive) {
    values = {};
    for (const [name, value] of Object.entries(p.values || {})) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) values[name] = value;
    }
  }
  const out = { t: p.t || `${p.date}T00:00:00Z`, values };
  if (rateSane(p.rate)) out.rate = p.rate;
  return out;
}

/** Families whose stored values are prices. Gems store signed profit. */
export const SIGNED_HISTORY_KEYS = new Set(["gems"]);

/* Full resolution for the recent window, one point per UTC day before it, and
   nothing older than the retention window at all. Keeps the newest point of
   each older day, so the curve stays a curve and the file stays small. */
export function thinPoints(points, { nowMs = Date.now(), hourlyHours = HISTORY_HOURLY_HOURS, maxDays = HISTORY_MAX_DAYS } = {}) {
  const cutoff = nowMs - hourlyHours * HOUR_MS;
  const oldest = nowMs - maxDays * DAY_MS;
  const kept = [];
  const dayLast = new Map();
  for (const p of points) {
    const ms = Date.parse(p.t);
    if (!isFinite(ms) || ms < oldest) continue;
    if (ms >= cutoff) { kept.push(p); continue; }
    dayLast.set(p.t.slice(0, 10), p);
  }
  return [...dayLast.values(), ...kept].sort((a, b) => (a.t < b.t ? -1 : 1));
}

const timestampOf = (point) => Date.parse(point?.t);

/* A checked-in recovery seed and the newest deployment can overlap. Merge by
   timestamp and let the deployed point win, since it is the newer authority.
   Losing these raw points is irreversible, so the recovery rule belongs in the
   regression suite. */
export function mergeSelfHistory(seed = { points: [] }, deployed = { points: [] }) {
  const byTime = new Map();
  for (const point of [...(seed.points || []), ...(deployed.points || [])]) {
    const ms = timestampOf(point);
    if (isFinite(ms)) byTime.set(point.t, point);
  }
  return {
    ...seed,
    ...deployed,
    points: [...byTime.values()].sort((a, b) => timestampOf(a) - timestampOf(b)),
  };
}

export function mergeBackfill(seed = { series: {} }, deployed = { series: {} }) {
  const series = {};
  for (const name of new Set([...Object.keys(seed.series || {}), ...Object.keys(deployed.series || {})])) {
    const byTime = new Map();
    for (const point of [...(seed.series?.[name] || []), ...(deployed.series?.[name] || [])]) {
      const ms = timestampOf(point);
      if (isFinite(ms)) byTime.set(point.t, point);
    }
    series[name] = [...byTime.values()].sort((a, b) => timestampOf(a) - timestampOf(b));
  }
  return { ...seed, ...deployed, series };
}

export function derivedHistoryPointCount(history) {
  return Object.values(history || {}).reduce((count, points) => count + (Array.isArray(points) ? points.length : 0), 0);
}

/* ---------- carried-forward data is not trusted data ----------

   Reuse mode and the per-family fallback both copy files from the previous
   deployment. That deployment was written by whatever code was live at the
   time, so it can hold values the current rules reject — the sub-0.005c
   prices that two-decimal rounding turned into `0` are the case that actually
   happened, and they sat in every league's prices.json.

   Carrying them forward unchanged makes the publication gates unsatisfiable:
   the gate is right that a zero price must not reach the site, and a reuse run
   has no way to produce a better number, so the run would fail forever and
   the deployment would freeze. Cleaning on the way in is the only move that
   converges — and it is the same rule the recovery tool applies, because zero
   is not a cheap price, it is an unknown one.

   Dropping a value is not the same as dropping the point or the item: the
   observation that the market existed at that hour survives, only the false
   number goes. Returns the cleaned document and a list of what was dropped, so
   a run says it rather than quietly rewriting history. */
export function sanitizeCarried(file, doc, { key = null } = {}) {
  const dropped = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { doc, dropped };

  if (file === "prices.json" && doc.prices) {
    const prices = {};
    let count = 0;
    for (const [name, entry] of Object.entries(doc.prices)) {
      /* Absent is unknown and legal; present-and-zero is the bug. */
      if (entry?.c === undefined || (Number.isFinite(entry.c) && entry.c > 0)) prices[name] = entry;
      else count += 1;
    }
    if (count) dropped.push(`${count} price(s) quoted at zero or worse`);
    return { doc: { ...doc, prices }, dropped };
  }

  if (file.endsWith("selfhistory.json")) {
    /* Gem history stores signed levelling profit, so a negative value is an
       observation rather than a fault. */
    const family = key || file.replace(/-?selfhistory\.json$/, "");
    if (SIGNED_HISTORY_KEYS.has(family)) return { doc, dropped };
    const points = Array.isArray(doc.points) ? doc.points : [];
    let count = 0;
    const cleaned = points.map((point) => {
      const values = {};
      for (const [name, value] of Object.entries(point?.values || {})) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) values[name] = value;
        else count += 1;
      }
      return { ...point, values };
    });
    if (count) dropped.push(`${count} stored value(s) at zero or worse`);
    return { doc: { ...doc, points: cleaned }, dropped };
  }

  if (Array.isArray(doc.items)) {
    const items = doc.items.filter((item) => Number.isFinite(item?.chaosValue) && item.chaosValue > 0);
    if (items.length !== doc.items.length) dropped.push(`${doc.items.length - items.length} unpriced item(s)`);
    return { doc: { ...doc, items }, dropped };
  }

  return { doc, dropped };
}

export function mergeHistorySeedDocument(file, seed, deployed) {
  if (!deployed) return seed;
  if (file.endsWith("selfhistory.json")) return mergeSelfHistory(seed, deployed);
  if (file.endsWith("backfill.json")) return mergeBackfill(seed, deployed);
  // A reset can choose a new fallback day zero. Do not splice two derived day
  // axes together; keep the fuller curve and let the rebuild below redraw it
  // from the merged absolute-time self-history above.
  return derivedHistoryPointCount(seed) > derivedHistoryPointCount(deployed) ? seed : deployed;
}

/* ---------- one day axis per league ----------

   Everything a league plots hangs off a single origin: the scarab curves, the
   category curves and the chaos-per-divine line. That is what lets the site
   add a scarab series to an Astrolabe series and mean it — before this, each
   family anchored day 0 at its own first snapshot, so "day 3" meant a
   different moment on each tab.

   League start is the origin whenever we know it and it is plausible. The
   guard is against Standard, whose "start" is 2013 and would put every point
   at day 4700; a league that has outlived the retention window is equally not
   something to anchor to. */
export function historyOrigin({ leagueStart, backfill = {}, self = { points: [] }, nowMs = Date.now() }) {
  const ms = leagueStart ? Date.parse(leagueStart) : NaN;
  if (isFinite(ms) && ms <= nowMs && nowMs - ms <= HISTORY_MAX_DAYS * DAY_MS) {
    return { t0Ms: ms, axis: "league day" };
  }
  let earliest = null;
  const seen = (candidate) => { if (isFinite(candidate) && (earliest == null || candidate < earliest)) earliest = candidate; };
  for (const points of Object.values(backfill)) for (const p of points || []) seen(Date.parse(p.t));
  for (const p of self.points || []) seen(Date.parse(p.t));
  return earliest == null ? null : { t0Ms: earliest, axis: "days since first snapshot" };
}

/* Backfill and accumulation stitched onto that axis, the same way
   buildRateHistory does it for the divine rate: bucket both by time, let our
   own snapshots win where they overlap — they are hourly and they are ours —
   then convert to days.

   backfill: { name: [{ t, value }] }   self: { points: [{ t, values }] }
   out:      { name: [{ day, value }] } — the shape the app plots. */
export function stitchHistory({ backfill = {}, self = { points: [] }, t0Ms, nowMs = Date.now() }) {
  const byName = new Map();
  const put = (name, ms, value) => {
    if (!isFinite(ms) || ms > nowMs + HOUR_MS || !(value > 0)) return;
    let bucket = byName.get(name);
    if (!bucket) byName.set(name, (bucket = new Map()));
    bucket.set(Math.round(ms / 600e3), { ms, value }); // 10-min buckets
  };
  for (const [name, points] of Object.entries(backfill)) {
    for (const p of points || []) put(name, Date.parse(p.t), p.value);
  }
  for (const p of self.points || []) {
    const ms = Date.parse(p.t);
    for (const [name, value] of Object.entries(p.values || {})) put(name, ms, value);
  }
  const out = {};
  for (const [name, bucket] of byName) {
    // Points before day 0 have no axis to sit on — the same rule the rate line
    // uses, so the two series always share a domain.
    const series = [...bucket.values()]
      .sort((a, b) => a.ms - b.ms)
      .map((p) => ({ day: Math.round(((p.ms - t0Ms) / DAY_MS) * 100) / 100, value: p.value }))
      .filter((p) => isFinite(p.day) && p.day >= -0.01)
      .map((p) => ({ day: Math.max(0, p.day), value: p.value }));
    if (series.length) out[name] = series;
  }
  return out;
}

export function historySourceOf(history, backfill, self) {
  if (!Object.keys(history || {}).length) return "none";
  const hasBackfill = Object.keys(backfill || {}).length > 0;
  const hasSelf = (self?.points || []).length > 0;
  return hasBackfill && hasSelf ? "ninja+self" : hasBackfill ? "ninja" : "self";
}

/* ---------- chaos-per-divine history ---------- */

export function ratePointsFrom(list) {
  const raw = [];
  for (const e of list || []) {
    const daysAgo = e?.daysAgo ?? e?.DaysAgo;
    const value = e?.value ?? e?.Value;
    if (typeof daysAgo === "number" && typeof value === "number" && value > 0) raw.push({ daysAgo, value });
  }
  if (raw.length < 3) return [];
  // The same series read as chaos-per-divine and as divine-per-chaos; whichever
  // lands inside a believable band is the one poe.ninja meant.
  let best = [];
  for (const invert of [false, true]) {
    const pts = raw
      .map((p) => ({ daysAgo: p.daysAgo, rate: invert ? 1 / p.value : p.value }))
      .filter((p) => rateSane(p.rate));
    if (pts.length > best.length && pts.length >= raw.length * 0.6) best = pts;
  }
  return best;
}

/* Merge accumulated + backfilled rates onto the league's day axis, so the rate
   line and every price line on the page share an x. */
export function buildRateHistory({ self, backfill = [], t0Ms, nowMs = Date.now() }) {
  const byMs = new Map();
  for (const p of backfill) {
    const ms = nowMs - p.daysAgo * DAY_MS;
    byMs.set(Math.round(ms / 600e3), { ms, rate: p.rate }); // 10-min buckets
  }
  // Our own snapshots are the more trustworthy source, so they overwrite.
  for (const p of (self.points || []).map(normalizePoint)) {
    if (!rateSane(p.rate)) continue;
    const ms = Date.parse(p.t);
    if (!isFinite(ms)) continue;
    byMs.set(Math.round(ms / 600e3), { ms, rate: p.rate });
  }
  let out = [...byMs.values()]
    .sort((a, b) => a.ms - b.ms)
    .map((p) => ({ day: Math.round(((p.ms - t0Ms) / DAY_MS) * 100) / 100, rate: Math.round(p.rate * 100) / 100 }))
    // Points older than day 0 have no price line to sit next to; dropping them
    // keeps the chart domain identical to the one the price series defines.
    .filter((p) => isFinite(p.day) && p.day >= -0.01)
    .map((p) => ({ day: Math.max(0, p.day), rate: p.rate }));
  if (out.length > RATE_HISTORY_CAP) {
    const step = Math.ceil(out.length / RATE_HISTORY_CAP);
    const thinned = out.filter((_, i) => i % step === 0);
    if (thinned[thinned.length - 1] !== out[out.length - 1]) thinned.push(out[out.length - 1]);
    out = thinned;
  }
  return out;
}

/* ---------- change windows ---------- */

const CHANGE_WINDOWS = [[1, "change1"], [2, "change2"], [4, "change4"], [8, "change8"], [12, "change12"], [24, "change24"], [48, "change48"]];

export function applySelfChanges(items, self) {
  const pts = (self.points || []).map(normalizePoint);
  if (pts.length < 2) return;
  const last = pts[pts.length - 1];
  const now = Date.parse(last.t);
  /* The newest point at least `hours` old — and not much older than that.
     Without the upper bound a gap in the schedule turns a four-hour-old price
     into the "1h" badge, which is the same lie nearestRateWindow guards
     against on the rate line. One run's slack (plus the 15 min of drift the
     lower bound already allows) is as far as a window may stretch. */
  const refFor = (hours) => {
    const cutoff = now - (hours * 3600e3 - 15 * 60e3);
    const oldest = now - (hours + 1) * 3600e3 - 15 * 60e3;
    let ref = null;
    for (const p of pts) { if (Date.parse(p.t) <= cutoff) ref = p; else break; }
    return ref && Date.parse(ref.t) >= oldest ? ref : null;
  };
  for (const [hours, key] of CHANGE_WINDOWS) {
    const ref = refFor(hours);
    if (!ref) continue;
    for (const it of items) {
      const v = ref.values[it.name];
      const latest = last.values[it.name];
      if (v > 0 && latest > 0) it[key] = (latest / v - 1) * 100;
      /* Same window, priced in divine instead of chaos: this is the move the
         item made against the rest of the economy rather than against a chaos
         orb that is itself drifting. Only computable once both ends of the
         window know their rate. */
      if (v > 0 && latest > 0 && rateSane(ref.rate) && rateSane(last.rate)) {
        it[`${key}R`] = ((latest / last.rate) / (v / ref.rate) - 1) * 100;
      }
    }
  }
}

/* ---------- rebuilding the derived files ----------

   `<key>-history.json` and the `rateHistory` embedded in each family snapshot
   are projections of `<key>-selfhistory.json` onto the league's day axis. Any
   path that restores or merges raw points therefore has to redraw them, or the
   league ships a one-point rate line beside an 83-point raw curve — which is
   exactly what the checked-in Allflame snapshot did.

   `historyOrigin` is written into the snapshot for this: a day axis on its own
   cannot be re-anchored, and the league start comes from poe.ninja, which the
   reuse path never calls. */
async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

export function rebuildOrigin(snapshot, { self, backfill }) {
  const stored = Date.parse(snapshot?.historyOrigin);
  if (isFinite(stored)) return stored;
  if (snapshot?.historyAxis === "league day") return null; // unknowable without the league start
  return historyOrigin({ backfill, self })?.t0Ms ?? null;
}

export async function rebuildDerivedHistory(dir, keys) {
  const scarabSelf = await readJson(path.join(dir, "scarabs-selfhistory.json")) || { points: [] };
  const scarabBackfill = (await readJson(path.join(dir, "scarabs-backfill.json")))?.series || {};
  const t0Ms = rebuildOrigin(await readJson(path.join(dir, "scarabs.json")), { self: scarabSelf, backfill: scarabBackfill });
  if (t0Ms == null) return { rebuilt: 0, ratePoints: 0 };
  // One rate curve per league, built the same way the fetch path builds it.
  const rateHistory = buildRateHistory({ self: scarabSelf, backfill: [], t0Ms });
  let rebuilt = 0;
  for (const key of keys) {
    const self = await readJson(path.join(dir, `${key}-selfhistory.json`));
    if (!Array.isArray(self?.points) || !self.points.length) continue;
    const backfill = (await readJson(path.join(dir, `${key}-backfill.json`)))?.series || {};
    const history = stitchHistory({ backfill, self, t0Ms });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${key}-history.json`), JSON.stringify(history));
    rebuilt++;
    const snapshot = await readJson(path.join(dir, `${key}.json`));
    if (!snapshot || key === "gems") continue; // gems plot profit, not a rate line
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify({
      ...snapshot,
      historyAxis: snapshot.historyAxis || "days since first snapshot",
      historyOrigin: new Date(t0Ms).toISOString(),
      historySource: historySourceOf(history, backfill, self),
      rateHistory,
      rateHistorySource: rateHistory.length ? "self" : "none",
    }));
  }
  return { rebuilt, ratePoints: rateHistory.length };
}
