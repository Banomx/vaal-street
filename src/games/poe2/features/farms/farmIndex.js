/* Turning a mechanic's markets into one comparable return series.

   The basket is a fixed-weight (Laspeyres) index: weights are taken once from
   the latest snapshot and held, so a move in the index is a move in prices and
   never a move in the weights. Rebasing to 100 at the start of the window is
   deliberate — the tower rules give relative exposure between mechanics but
   nothing gives absolute yield per map, so a level in Exalted would be a claim
   this data cannot support.

   The three rules that keep a summed basket honest are the same ones
   src/games/poe1/features/strategies/stratHistory.js documents for saved
   strategies, and they exist for the same reason: a total that silently loses a
   member reads as a market crash.

     - A member with no stored history is excluded and named, never back-filled
       with its current price.
     - The plotted window is the overlap of the members that do have history,
       from the latest first sample to the earliest last sample.
     - Inside that window a member with no sample at a timestamp contributes its
       nearest one, because sources are collected minutes apart. */

import { buildPriceTimeline } from "../pricing/priceTimeline.js";

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/* Enough members that one of them dropping out cannot masquerade as a trend. */
export const MIN_MEMBERS = 3;

export const WEIGHT_MODES = [
  ["supply", "Traded supply"],
  ["turnover", "Traded value"],
  ["equal", "Equal"],
];

/* Units cleared per hour is the closest observable stand-in for how often an
   item is produced, because the supply reaching the exchange comes from people
   farming it. It is still a market measurement and not a drop rate, which is
   why the UI labels it "traded supply". */
export function poolWeights(members = [], mode = "supply") {
  const basis = members.map(({ name, entry }) => {
    const volume = Number(entry?.volume1H) || 0;
    const price = Number(entry?.exalted) || 0;
    const raw = mode === "equal" ? 1 : mode === "turnover" ? price * volume : volume;
    return { name, raw: raw > 0 ? raw : 0 };
  });
  const total = basis.reduce((sum, item) => sum + item.raw, 0);
  /* No usable basis at all falls back to equal shares rather than to zero, so a
     mechanic whose feed briefly reports no volume still charts. */
  if (!(total > 0)) return new Map(members.map(({ name }) => [name, 1 / (members.length || 1)]));
  return new Map(basis.map(({ name, raw }) => [name, raw / total]));
}

export function concentration(weights) {
  const shares = [...weights.values()].sort((left, right) => right - left);
  return { top: shares[0] ?? 0, heavy: (shares[0] ?? 0) >= .5 };
}

export function poolFlow(members = []) {
  return members.reduce((sum, { entry }) => sum + (Number(entry?.exalted) || 0) * (Number(entry?.volume1H) || 0), 0);
}

/* Both feeds carry liquidity evidence, but not the same evidence: GGG reports
   what actually cleared in the hour, poe.ninja reports how many are listed.
   They are tiered separately so a deep listing count is not read as trade. */
export function liquidity(entry) {
  const volume = Number(entry?.volume1H) || 0;
  if (volume > 0) {
    const label = volume < 10 ? "Barely trades" : volume < 100 ? "Light trade" : volume < 1000 ? "Active trade" : "Heavy trade";
    return { basis: "volume", count: volume, label, tone: volume < 10 ? "thin" : volume < 100 ? "limited" : "active", unit: "traded/h" };
  }
  const listings = Number(entry?.listingCount) || 0;
  if (!listings) return { basis: "none", count: 0, label: "Liquidity unknown", tone: "unknown", unit: "" };
  const label = listings < 100 ? "Thin market" : listings < 1000 ? "Limited listings" : listings < 5000 ? "Active market" : "Deep market";
  return { basis: "listings", count: listings, label, tone: listings < 100 ? "thin" : listings < 1000 ? "limited" : "active", unit: "listed" };
}

function seriesFor(history, name) {
  const values = Array.isArray(history?.series?.[name]) ? history.series[name] : null;
  if (!values) return null;
  let first = -1;
  let last = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (finite(values[index]) == null) continue;
    if (first < 0) first = index;
    last = index;
  }
  return first < 0 ? null : { values, first, last };
}

/* Nearest sample rather than interpolation: an hourly feed that missed a beat
   has not told us the price moved, only that it did not report. */
function nearest(series, index) {
  const direct = finite(series.values[index]);
  if (direct != null) return direct;
  for (let step = 1; step < series.values.length; step += 1) {
    const before = index - step >= series.first ? finite(series.values[index - step]) : null;
    if (before != null) return before;
    const after = index + step <= series.last ? finite(series.values[index + step]) : null;
    if (after != null) return after;
  }
  return null;
}

export function buildBasketIndex(history, members = [], { mode = "supply", rangeHours = null, divineAdjusted = false } = {}) {
  const timestamps = Array.isArray(history?.timestamps) ? history.timestamps : [];
  const rates = Array.isArray(history?.divineExalted) ? history.divineExalted : [];
  const weights = poolWeights(members, mode);
  const excluded = [];
  const included = [];

  for (const member of members) {
    const series = seriesFor(history, member.name);
    if (!series) { excluded.push(member.name); continue; }
    included.push({ ...member, series, weight: weights.get(member.name) || 0 });
  }

  const empty = (reason) => ({
    points: [], change: null, unit: "Index", included: included.map((item) => item.name),
    excluded, weights, concentration: concentration(weights), reason,
  });
  if (!timestamps.length) return empty("no stored history yet");
  if (included.length < MIN_MEMBERS) {
    return empty(`only ${included.length} of ${members.length} markets have stored history`);
  }

  /* The overlap, so the basket holds the same members from end to end. */
  let start = Math.max(...included.map((item) => item.series.first));
  const end = Math.min(...included.map((item) => item.series.last));
  if (start > end) return empty("the members' histories do not overlap");

  if (rangeHours) {
    const cutoff = Date.parse(timestamps[end]) - rangeHours * 3600e3;
    while (start < end && Date.parse(timestamps[start]) < cutoff) start += 1;
  }

  /* Weights are renormalized across the members that survived, so excluding an
     unhistoried market shrinks the basket instead of quietly scaling it down. */
  const surviving = included.reduce((sum, item) => sum + item.weight, 0);
  const share = (item) => (surviving > 0 ? item.weight / surviving : 1 / included.length);

  const raw = [];
  for (let index = start; index <= end; index += 1) {
    const rate = finite(rates[index]);
    if (divineAdjusted && rate == null) continue;
    let value = 0;
    let complete = true;
    for (const item of included) {
      const price = nearest(item.series, index);
      if (price == null) { complete = false; break; }
      value += share(item) * (divineAdjusted ? price / rate : price);
    }
    if (complete && value > 0) raw.push({ at: Date.parse(timestamps[index]), timestamp: timestamps[index], basket: value });
  }
  if (raw.length < 2) return empty("not enough overlapping snapshots to compare");

  const base = raw[0].basket;
  const points = raw.map((point) => ({ ...point, value: (point.basket / base) * 100 }));
  return {
    points,
    change: points[points.length - 1].value / 100 - 1,
    unit: "Index",
    included: included.map((item) => item.name),
    excluded,
    weights,
    concentration: concentration(weights),
    reason: null,
  };
}

/* A mover has to be sellable to be worth reading, so a market with almost no
   trade and almost no listings cannot headline one. */
const MOVER_VOLUME = 5;
const MOVER_LISTINGS = 50;

export function poolMovers(history, members = [], { rangeHours = null, divineAdjusted = false, limit = 3 } = {}) {
  const rows = [];
  for (const member of members) {
    const market = liquidity(member.entry);
    if (market.basis === "volume" ? market.count < MOVER_VOLUME : market.count < MOVER_LISTINGS) continue;
    const timeline = buildPriceTimeline(history, member.name, { currency: "exalted", rangeHours });
    const change = divineAdjusted ? timeline.divineAdjustedChange : timeline.change;
    if (change == null || !Number.isFinite(change)) continue;
    rows.push({ ...member, change, market });
  }
  rows.sort((left, right) => right.change - left.change);
  return {
    up: rows.filter((row) => row.change > 0).slice(0, limit),
    down: rows.filter((row) => row.change < 0).slice(-limit).reverse(),
  };
}
