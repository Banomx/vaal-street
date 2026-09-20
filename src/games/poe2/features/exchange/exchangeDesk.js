import { windowEvidence } from "../../shared/marketWindow.js";

export const EXALTED_ID = "Metadata/Items/Currency/CurrencyAddModToRare";
export const DIVINE_ID = "Metadata/Items/Currency/CurrencyModValues";
export const CHAOS_ID = "Metadata/Items/Currency/CurrencyRerollRare";

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function canonicalPairKey(left, right) {
  return [left, right].sort().join("|");
}

function quoteCanonicalPair(pair, itemId, quoteId) {
  if (!pair || ![pair.left, pair.right].includes(itemId) || ![pair.left, pair.right].includes(quoteId)) return null;
  if (pair.left === itemId) {
    return {
      rate: positive(pair.rightPerLeft),
      low: positive(pair.lowRightPerLeft),
      high: positive(pair.highRightPerLeft),
      itemVolume: positive(pair.leftVolume),
      quoteVolume: positive(pair.rightVolume),
    };
  }
  const rate = positive(pair.rightPerLeft);
  const low = positive(pair.lowRightPerLeft);
  const high = positive(pair.highRightPerLeft);
  return rate && low && high ? {
    rate: 1 / rate,
    low: 1 / high,
    high: 1 / low,
    itemVolume: positive(pair.rightVolume),
    quoteVolume: positive(pair.leftVolume),
  } : null;
}

function pairLookup(exchange) {
  return new Map((exchange?.pairs || []).map((pair) => [pair.id || canonicalPairKey(pair.left, pair.right), pair]));
}

function itemName(exchange, id) {
  return exchange?.items?.[id]?.name || id?.split("/").pop() || id;
}

export function buildExchangeRouteOptions(exchange, itemId, { minTurnoverExalted = 0 } = {}) {
  if (!itemId || itemId === EXALTED_ID) return [];
  const pairs = pairLookup(exchange);
  const routes = [];
  for (const pair of exchange?.pairs || []) {
    if (![pair.left, pair.right].includes(itemId)) continue;
    const quoteId = pair.left === itemId ? pair.right : pair.left;
    const itemQuote = quoteCanonicalPair(pair, itemId, quoteId);
    if (!itemQuote?.rate) continue;
    const quoteExalted = quoteId === EXALTED_ID ? { rate: 1, low: 1, high: 1, quoteVolume: itemQuote.quoteVolume }
      : quoteCanonicalPair(pairs.get(canonicalPairKey(quoteId, EXALTED_ID)), quoteId, EXALTED_ID);
    if (!quoteExalted?.rate) continue;
    const firstLegTurnover = (itemQuote.quoteVolume || 0) * quoteExalted.rate;
    const normalizationTurnover = quoteId === EXALTED_ID ? firstLegTurnover : (quoteExalted.quoteVolume || 0);
    const limitingTurnoverExalted = Math.min(firstLegTurnover || 0, normalizationTurnover || 0);
    if (limitingTurnoverExalted < minTurnoverExalted) continue;
    const priceExalted = itemQuote.rate * quoteExalted.rate;
    const lowExalted = (itemQuote.low || itemQuote.rate) * (quoteExalted.low || quoteExalted.rate);
    const highExalted = (itemQuote.high || itemQuote.rate) * (quoteExalted.high || quoteExalted.rate);
    routes.push({
      itemId,
      quoteId,
      quoteName: itemName(exchange, quoteId),
      routeLabel: quoteId === EXALTED_ID ? "direct Exalted"
        : quoteId === DIVINE_ID ? "via Divine" : `via ${itemName(exchange, quoteId)}`,
      rateQuotePerItem: itemQuote.rate,
      lowQuotePerItem: itemQuote.low || itemQuote.rate,
      highQuotePerItem: itemQuote.high || itemQuote.rate,
      priceExalted,
      lowExalted,
      highExalted,
      rangePercent: lowExalted > 0 ? highExalted / lowExalted - 1 : 0,
      itemVolume: itemQuote.itemVolume || 0,
      firstLegTurnoverExalted: firstLegTurnover,
      limitingTurnoverExalted,
      normalizationRate: quoteExalted.rate,
    });
  }
  return routes.sort((left, right) => left.priceExalted - right.priceExalted);
}

export function buildExchangeRows(exchange, priceData) {
  const rows = [];
  for (const itemId of Object.keys(exchange?.items || {})) {
    if (itemId === EXALTED_ID) continue;
    const routeOptions = buildExchangeRouteOptions(exchange, itemId);
    if (!routeOptions.length) continue;
    const directExalted = routeOptions.find((route) => route.quoteId === EXALTED_ID);
    const directDivine = routeOptions.find((route) => route.quoteId === DIVINE_ID);
    const primary = directExalted || directDivine || [...routeOptions].sort((left, right) => right.limitingTurnoverExalted - left.limitingTurnoverExalted)[0];
    const bestBuy = routeOptions[0];
    const bestSell = routeOptions[routeOptions.length - 1];
    const name = itemName(exchange, itemId);
    const listing = priceData?.sourcePrices?.poeNinja?.[name] || null;
    const listingExalted = positive(listing?.exalted);
    rows.push({
      itemId,
      name,
      type: exchange?.items?.[itemId]?.type || null,
      quoteRoute: primary.routeLabel,
      priceExalted: primary.priceExalted,
      lowExalted: primary.lowExalted,
      highExalted: primary.highExalted,
      itemVolume: primary.itemVolume,
      turnoverExalted: primary.firstLegTurnoverExalted,
      rangePercent: primary.rangePercent,
      routeOptions,
      bestBuy,
      bestSell,
      routeCount: routeOptions.length,
      routeGap: bestBuy?.priceExalted ? bestSell.priceExalted / bestBuy.priceExalted - 1 : 0,
      buySavingsVsExalted: directExalted?.priceExalted ? 1 - bestBuy.priceExalted / directExalted.priceExalted : null,
      sellPremiumVsExalted: directExalted?.priceExalted ? bestSell.priceExalted / directExalted.priceExalted - 1 : null,
      listingExalted,
      listingSource: listing?.source || null,
      quoteGap: listingExalted ? listingExalted / primary.priceExalted - 1 : null,
    });
  }
  return rows.sort((left, right) => right.turnoverExalted - left.turnoverExalted);
}

export function filterExchangeRowsByTurnover(rows, minimumTurnoverExalted = 0, { minItemVolume = 0 } = {}) {
  const floor = Math.max(0, Number(minimumTurnoverExalted) || 0);
  const unitFloor = Math.max(0, Number(minItemVolume) || 0);
  return (rows || []).flatMap((row) => {
    const routeOptions = (row.routeOptions || [])
      .filter((route) => route.limitingTurnoverExalted >= floor && (unitFloor <= 0 || (Number(route.itemVolume) || 0) >= unitFloor))
      .sort((left, right) => left.priceExalted - right.priceExalted);
    if (!routeOptions.length) return [];
    const bestBuy = routeOptions[0];
    const bestSell = routeOptions[routeOptions.length - 1];
    const representative = [...routeOptions].sort((a, b) => b.limitingTurnoverExalted - a.limitingTurnoverExalted)[0];
    return [{
      ...row,
      itemVolume: representative.itemVolume ?? row.itemVolume,
      turnoverExalted: representative.firstLegTurnoverExalted ?? representative.limitingTurnoverExalted,
      lowExalted: representative.lowExalted ?? row.lowExalted,
      highExalted: representative.highExalted ?? row.highExalted,
      priceExalted: representative.priceExalted ?? row.priceExalted,
      quoteRoute: representative.routeLabel ?? row.quoteRoute,
      rangePercent: representative.rangePercent ?? row.rangePercent,
      quoteGap: row.listingExalted && representative.priceExalted
        ? row.listingExalted / representative.priceExalted - 1 : row.quoteGap,
      routeOptions,
      bestBuy,
      bestSell,
      totalRouteCount: row.totalRouteCount || row.routeCount,
      routeCount: routeOptions.length,
      routeGap: bestBuy.priceExalted ? bestSell.priceExalted / bestBuy.priceExalted - 1 : 0,
    }];
  });
}

// Compare same-item/hour routes; unit counts across different items are not comparable.
export function assessRouteDepth(route, peers = []) {
  const valid = (entry) => Number.isFinite(entry?.itemVolume) && entry.itemVolume > 0
    && Number.isFinite(entry?.limitingTurnoverExalted) && entry.limitingTurnoverExalted > 0;
  if (!valid(route)) return { level: "unknown", label: "Unknown", reason: "Completed units or turnover unavailable" };
  const cohort = peers.filter(valid);
  const units = route.itemVolume;
  const turnover = route.limitingTurnoverExalted;
  if (units < 5 || turnover < 100) return { level: "low", label: "Low", reason: "Below 5 completed units/h or 100 Exalted/h" };
  if (cohort.length < 4) {
    const level = units >= 25 && turnover >= 500 ? "high" : "medium";
    return { level, label: level === "high" ? "High" : "Medium", reason: "Fewer than four routes: absolute bands (High: 25 units/h and 500 Exalted/h)" };
  }
  // Midranks keep tied markets equal rather than promoting every tie to High.
  const rank = (key) => {
    const below = cohort.filter((entry) => entry[key] < route[key]).length;
    const equal = cohort.filter((entry) => entry[key] === route[key]).length;
    return Math.min(1, Math.max(0, (below + Math.max(0, equal - 1) / 2) / (cohort.length - 1)));
  };
  const score = Math.min(rank("itemVolume"), rank("limitingTurnoverExalted"));
  const level = score >= .75 && units >= 25 && turnover >= 500 ? "high" : score >= .25 ? "medium" : "low";
  return {
    level, label: level === "high" ? "High" : level === "medium" ? "Medium" : "Low",
    reason: "Relative depth across " + cohort.length + " same-item/hour routes: weaker unit/turnover rank " + Math.round(score * 100) + "%. High: both in the top quarter, at least 25 units/h and 500 Exalted/h. Medium: rank at least 25%. Price range is separate.",
  };
}

export function assessExchangeRoute(route, {
  minTurnoverExalted = 1000,
  minItemVolume = 10,
  routeGap = 0,
} = {}) {
  if (!route) return { level: "unknown", label: "No evidence", reasons: ["No completed route"] };
  // Discovery filters can expose small markets; they must not upgrade evidence.
  const turnoverFloor = Math.max(100, Number(minTurnoverExalted) || 0);
  const unitFloor = Math.max(5, Number(minItemVolume) || 0);
  const turnover = Number(route.limitingTurnoverExalted) || 0;
  const units = Number(route.itemVolume) || 0;
  const range = Number(route.rangePercent) || 0;
  const gap = Math.max(0, Number(routeGap) || 0);
  const reasons = [];
  let level = "high";

  if (units < unitFloor) reasons.push("too few completed units for confidence");
  else if (unitFloor && units < unitFloor * 5) reasons.push("modest completed unit count");
  if (turnover < turnoverFloor) reasons.push("too little completed turnover for confidence");
  else if (turnoverFloor && turnover < turnoverFloor * 5) reasons.push("modest limiting turnover");
  if (range > .5) reasons.push("very wide completed range");
  else if (range > .2) reasons.push("wide completed range");
  if (gap > .5) reasons.push("extreme cross-route disagreement");
  else if (gap > .2) reasons.push("large cross-route disagreement");

  if (units < unitFloor || turnover < turnoverFloor || range > .5 || gap > .5) level = "low";
  else if (reasons.length) level = "medium";
  return {
    level,
    label: level === "high" ? "High confidence" : level === "medium" ? "Use caution" : "Low confidence",
    reasons: reasons.length ? reasons : ["deep completed flow and a contained traded range"],
  };
}

export function strongestEvidenceRoute(routes = [], options = {}) {
  const rank = { high: 2, medium: 1, low: 0, unknown: -1 };
  return [...routes].sort((a, b) =>
    rank[assessExchangeRoute(b, options).level] - rank[assessExchangeRoute(a, options).level]
      || b.limitingTurnoverExalted - a.limitingTurnoverExalted
      || a.rangePercent - b.rangePercent)[0] || null;
}

export function assessExchangeMarket(row, options = {}) {
  const buy = assessExchangeRoute(row.bestBuy, { ...options, routeGap: row.routeGap });
  const sell = assessExchangeRoute(row.bestSell, { ...options, routeGap: row.routeGap });
  const rank = { high: 2, medium: 1, low: 0, unknown: -1 };
  return rank[buy.level] <= rank[sell.level] ? buy : sell;
}

function compactQuote(values, key, itemId, quoteId) {
  if (!values) return null;
  const [left, right] = key.split("|");
  return quoteCanonicalPair({
    left,
    right,
    leftVolume: values[1],
    rightVolume: values[2],
    rightPerLeft: values[3],
    lowRightPerLeft: values[4],
    highRightPerLeft: values[5],
  }, itemId, quoteId);
}

function prepareExchangeHistory(history) {
  const keys = Array.isArray(history?.pairKeys) ? history.pairKeys : [];
  return {
    keys,
    indexByKey: new Map(keys.map((key, index) => [key, index])),
    snapshots: (history?.snapshots || []).map((snapshot) => ({
      at: snapshot?.at,
      atMs: Date.parse(snapshot?.at),
      pairs: new Map((snapshot?.pairs || []).map((values) => [Number(values?.[0]), values])),
    })),
  };
}

function emptyTimeline() {
  return { points: [], change: null, divineAdjustedChange: null, canDivineAdjust: false };
}

function exchangeRouteTimelineFromPrepared(prepared, itemId, quoteId, rangeHours) {
  if (!itemId || !quoteId || itemId === quoteId) return emptyTimeline();
  const itemQuoteKey = canonicalPairKey(itemId, quoteId);
  const itemQuoteIndex = prepared.indexByKey.get(itemQuoteKey) ?? -1;
  const quoteExaltedKey = canonicalPairKey(quoteId, EXALTED_ID);
  const quoteExaltedIndex = quoteId === EXALTED_ID ? -1 : prepared.indexByKey.get(quoteExaltedKey) ?? -1;
  const divineKey = canonicalPairKey(DIVINE_ID, EXALTED_ID);
  const divineIndex = prepared.indexByKey.get(divineKey) ?? -1;
  const chaosKey = canonicalPairKey(CHAOS_ID, EXALTED_ID);
  const chaosIndex = prepared.indexByKey.get(chaosKey) ?? -1;
  if (itemQuoteIndex < 0 || (quoteId !== EXALTED_ID && quoteExaltedIndex < 0)) return emptyTimeline();
  let points = prepared.snapshots.map((snapshot) => {
    const at = snapshot.atMs;
    const divineValues = snapshot.pairs.get(divineIndex);
    const divine = compactQuote(divineValues, divineKey, DIVINE_ID, EXALTED_ID);
    const chaosValues = snapshot.pairs.get(chaosIndex);
    const chaos = compactQuote(chaosValues, chaosKey, CHAOS_ID, EXALTED_ID);
    const itemValues = snapshot.pairs.get(itemQuoteIndex);
    const item = compactQuote(itemValues, itemQuoteKey, itemId, quoteId);
    const quoteExalted = quoteId === EXALTED_ID
      ? { rate: 1, low: 1, high: 1, quoteVolume: item?.quoteVolume }
      : compactQuote(snapshot.pairs.get(quoteExaltedIndex), quoteExaltedKey, quoteId, EXALTED_ID);
    if (!Number.isFinite(at) || !item?.rate || !quoteExalted?.rate) return null;
    const price = item.rate * quoteExalted.rate;
    const firstLegTurnover = (item.quoteVolume || 0) * quoteExalted.rate;
    const normalizationTurnover = quoteId === EXALTED_ID ? firstLegTurnover : quoteExalted.quoteVolume || 0;
    return {
      at,
      timestamp: snapshot.at,
      price,
      low: (item.low || item.rate) * (quoteExalted.low || quoteExalted.rate),
      high: (item.high || item.rate) * (quoteExalted.high || quoteExalted.rate),
      itemVolume: item.itemVolume,
      turnoverExalted: firstLegTurnover,
      limitingTurnoverExalted: Math.min(firstLegTurnover, normalizationTurnover),
      divineExalted: divine?.rate || null,
      chaosExalted: chaos?.rate || null,
      adjustedPrice: divine?.rate ? price / divine.rate : null,
    };
  }).filter(Boolean);
  const latestAt = Math.max(...prepared.snapshots.map((snapshot) => snapshot.atMs).filter(Number.isFinite));
  if (rangeHours) points = points.filter((point) => point.at >= latestAt - rangeHours * 60 * 60 * 1000);
  const first = points[0];
  const last = points[points.length - 1];
  const canDivineAdjust = points.length >= 2 && first.adjustedPrice != null && last.adjustedPrice != null;
  return {
    points,
    change: points.length >= 2 ? last.price / first.price - 1 : null,
    divineAdjustedChange: canDivineAdjust ? last.adjustedPrice / first.adjustedPrice - 1 : null,
    canDivineAdjust,
    evidence: windowEvidence(points, rangeHours, latestAt),
  };
}

function exchangeTimelineFromPrepared(prepared, itemId, rangeHours) {
  const directKey = canonicalPairKey(itemId, EXALTED_ID);
  if (prepared.indexByKey.has(directKey)) return exchangeRouteTimelineFromPrepared(prepared, itemId, EXALTED_ID, rangeHours);
  const divineQuoteKey = canonicalPairKey(itemId, DIVINE_ID);
  if (prepared.indexByKey.has(divineQuoteKey)) return exchangeRouteTimelineFromPrepared(prepared, itemId, DIVINE_ID, rangeHours);
  return emptyTimeline();
}

export function buildExchangeTimeline(history, itemId, { rangeHours = null } = {}) {
  return exchangeTimelineFromPrepared(prepareExchangeHistory(history), itemId, rangeHours);
}

export function buildExchangeRouteTimeline(history, itemId, quoteId, { rangeHours = null } = {}) {
  return exchangeRouteTimelineFromPrepared(prepareExchangeHistory(history), itemId, quoteId, rangeHours);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildExchangeOverview(rows, history, {
  minTurnoverExalted = 10,
  moveHours = 24,
  limit = 5,
} = {}) {
  const liquid = (rows || []).filter((row) => row.turnoverExalted >= minTurnoverExalted);
  const preparedHistory = prepareExchangeHistory(history);
  const liquidity = [...liquid].sort((left, right) => right.turnoverExalted - left.turnoverExalted).slice(0, limit);
  const ranges = liquid.filter((row) => row.rangePercent > 0)
    .sort((left, right) => right.rangePercent - left.rangePercent).slice(0, limit);
  const quoteGaps = liquid.filter((row) => row.quoteGap != null)
    .sort((left, right) => Math.abs(right.quoteGap) - Math.abs(left.quoteGap)).slice(0, limit);
  const movementByItem = {};
  const movers = liquid.map((row) => {
    const timeline = exchangeTimelineFromPrepared(preparedHistory, row.itemId, moveHours);
    movementByItem[row.itemId] = {
      change: timeline.evidence?.partial || timeline.evidence?.stale ? null : timeline.change,
      divineAdjustedChange: timeline.evidence?.partial || timeline.evidence?.stale ? null : timeline.divineAdjustedChange,
      evidence: timeline.evidence,
      historyPoints: timeline.points.length,
    };
    return movementByItem[row.itemId].change == null ? null : {
      ...row,
      change: timeline.change,
      divineAdjustedChange: timeline.divineAdjustedChange,
      historyPoints: timeline.points.length,
    };
  }).filter(Boolean).sort((left, right) => Math.abs(right.change) - Math.abs(left.change)).slice(0, limit);
  const quoteCount = (rows || []).filter((row) => row.quoteGap != null).length;
  return {
    totalTurnoverExalted: (rows || []).reduce((sum, row) => sum + row.turnoverExalted, 0),
    liquidMarkets: liquid.length,
    quoteCoverage: rows?.length ? quoteCount / rows.length : 0,
    medianRange: median(liquid.map((row) => row.rangePercent)),
    historySnapshots: Array.isArray(history?.snapshots) ? history.snapshots.length : 0,
    liquidity,
    movers,
    quoteGaps,
    ranges,
    movementByItem,
  };
}

export function estimateExchangeExecution(row, amount, { participation = .8 } = {}) {
  const units = Math.max(0, Number(amount) || 0);
  const share = Math.min(1, Math.max(.001, Number(participation) || .8));
  const observedHourlyUnits = Math.max(0, Number(row?.itemVolume) || 0);
  const plannedHourlyUnits = observedHourlyUnits * share;
  const completedValue = units * (Number(row?.priceExalted) || 0);
  const itemLegHours = units > 0 && plannedHourlyUnits > 0 ? units / plannedHourlyUnits : null;
  const limitingTurnover = positive(row?.limitingTurnoverExalted);
  const valueLegHours = limitingTurnover && completedValue > 0 ? completedValue / (limitingTurnover * share) : null;
  const hoursToClear = itemLegHours == null ? valueLegHours
    : valueLegHours == null ? itemLegHours : Math.max(itemLegHours, valueLegHours);
  const lowValue = units * (Number(row?.lowExalted) || Number(row?.priceExalted) || 0);
  const highValue = units * (Number(row?.highExalted) || Number(row?.priceExalted) || 0);
  const listingValue = row?.listingExalted ? units * row.listingExalted : null;
  const flowFit = hoursToClear == null ? "unknown" : hoursToClear <= 1 ? "fits" : hoursToClear <= 4 ? "several-hours" : "large";
  return {
    units,
    participation: share,
    observedHourlyUnits,
    plannedHourlyUnits,
    limitingTurnoverExalted: limitingTurnover,
    hoursToClear,
    completedValue,
    lowValue,
    highValue,
    listingValue,
    listingDifference: listingValue == null ? null : listingValue - completedValue,
    shareOfObservedHour: observedHourlyUnits > 0 ? units / observedHourlyUnits : null,
    flowFit,
  };
}

export function findTriangleChecks(exchange, { minTurnoverExalted = 10, minGap = .02 } = {}) {
  const pairs = pairLookup(exchange);
  const direct = new Map();
  for (const id of Object.keys(exchange?.items || {})) {
    if (id === EXALTED_ID) continue;
    const pair = pairs.get(canonicalPairKey(id, EXALTED_ID));
    const quote = quoteCanonicalPair(pair, id, EXALTED_ID);
    if (quote?.rate) direct.set(id, quote);
  }
  const checks = [];
  for (const [itemId, itemDirect] of direct) {
    if (itemId === DIVINE_ID || (itemDirect.quoteVolume || 0) < minTurnoverExalted) continue;
    for (const pair of exchange?.pairs || []) {
      if (![pair.left, pair.right].includes(itemId) || [pair.left, pair.right].includes(EXALTED_ID)) continue;
      const middleId = pair.left === itemId ? pair.right : pair.left;
      const middleDirect = direct.get(middleId);
      if (!middleDirect || (middleDirect.quoteVolume || 0) < minTurnoverExalted) continue;
      const firstLeg = quoteCanonicalPair(pair, itemId, middleId);
      const firstTurnover = (firstLeg?.quoteVolume || 0) * middleDirect.rate;
      if (!firstLeg?.rate || firstTurnover < minTurnoverExalted) continue;
      const indirect = firstLeg.rate * middleDirect.rate;
      const gap = indirect / itemDirect.rate - 1;
      if (Math.abs(gap) < minGap) continue;
      checks.push({
        itemId,
        item: itemName(exchange, itemId),
        middleId,
        middle: itemName(exchange, middleId),
        direct: itemDirect.rate,
        indirect,
        gap,
        limitingTurnoverExalted: Math.min(itemDirect.quoteVolume, middleDirect.quoteVolume, firstTurnover),
      });
    }
  }
  return checks.sort((left, right) => Math.abs(right.gap) - Math.abs(left.gap));
}


// Only recent hourly observations are compared. A missing pair is unknown, not zero.
function recentSignalHistory(history, hours) {
  const prepared = prepareExchangeHistory(history);
  const valid = prepared.snapshots.filter((snapshot) => Number.isFinite(snapshot.atMs))
    .sort((a, b) => a.atMs - b.atMs);
  const latestAt = valid.at(-1)?.atMs ?? null;
  const buckets = new Map();
  for (const snapshot of valid) {
    if (snapshot.atMs > latestAt - hours * 3600e3) buckets.set(Math.floor(snapshot.atMs / 3600e3), snapshot);
  }
  return { ...prepared, snapshots: [...buckets.values()], latestAt };
}

export function buildUnusualActivity(history, { minimumMultiple = 2, minimumUnits = 10 } = {}) {
  const prepared = recentSignalHistory(history, 25);
  const latestAt = prepared.latestAt;
  const totals = prepared.snapshots.map((snapshot) => {
    const units = new Map();
    for (const [index, values] of snapshot.pairs) {
      const ids = prepared.keys[index]?.split("|");
      if (ids?.length !== 2) continue;
      ids.forEach((id, side) => {
        const volume = positive(values[side + 1]);
        if (volume) units.set(id, (units.get(id) || 0) + volume);
      });
    }
    return { at: snapshot.atMs, units };
  });
  const latest = totals.at(-1);
  let evaluated = 0;
  let insufficient = 0;
  const rows = [];
  for (const [itemId, units] of latest?.units || []) {
    const baselineValues = totals.slice(0, -1).map((hour) => hour.units.get(itemId)).filter((value) => value > 0);
    if (baselineValues.length < 6) { insufficient++; continue; }
    evaluated++;
    const baseline = median(baselineValues);
    const multiple = units / baseline;
    if (units < minimumUnits || multiple < minimumMultiple) continue;
    const prices = exchangeTimelineFromPrepared(prepared, itemId, 24).points;
    const latestPrice = prices.find((point) => point.at === latestAt)?.price;
    const earlierPrices = prices.filter((point) => point.at < latestAt).map((point) => point.price);
    const priceMedian = earlierPrices.length >= 6 ? median(earlierPrices) : null;
    rows.push({
      itemId, name: history?.items?.[itemId]?.name || itemId.split("/").pop(),
      units, baseline, multiple, samples: baselineValues.length,
      priceChange: latestPrice > 0 && priceMedian > 0 ? latestPrice / priceMedian - 1 : null,
    });
  }
  return { latestAt, evaluated, insufficient, rows: rows.sort((a, b) => b.multiple - a.multiple || a.name.localeCompare(b.name)) };
}

export function buildRouteConsistency(history, itemId, quoteId, {
  side = "sell", minItemVolume = 10, minTurnoverExalted = 1000,
} = {}) {
  const prepared = recentSignalHistory(history, 24);
  const empty = { samples: 0, wins: 0, score: null, medianEdge: null, streak: 0, wideRanges: 0, latestAt: prepared.latestAt };
  if (!itemId || !quoteId) return { ...empty, reason: "Select a route to inspect its history." };
  if (quoteId === EXALTED_ID) return { ...empty, reason: "Direct Exalted is the comparison baseline." };
  const route = exchangeRouteTimelineFromPrepared(prepared, itemId, quoteId, 24);
  const direct = new Map(exchangeRouteTimelineFromPrepared(prepared, itemId, EXALTED_ID, 24).points.map((point) => [point.at, point]));
  const enough = (point) => point && point.itemVolume >= Math.max(5, minItemVolume)
    && point.limitingTurnoverExalted >= Math.max(100, minTurnoverExalted);
  const points = route.points.flatMap((point) => {
    const reference = direct.get(point.at);
    if (!enough(point) || !enough(reference)) return [];
    const edge = side === "buy" ? 1 - point.price / reference.price : point.price / reference.price - 1;
    return [{ at: point.at, edge, win: edge >= .01,
      wide: point.high / point.low - 1 > .5 || reference.high / reference.low - 1 > .5 }];
  });
  const wins = points.filter((point) => point.win).length;
  let streak = 0;
  let expectedHour = Math.floor(prepared.latestAt / 3600e3);
  for (const point of [...points].reverse()) {
    if (!point.win || Math.floor(point.at / 3600e3) !== expectedHour) break;
    streak++; expectedHour--;
  }
  return { ...empty, samples: points.length, wins,
    score: points.length >= 6 ? wins / points.length : null,
    medianEdge: points.length ? median(points.map((point) => point.edge)) : null,
    streak, wideRanges: points.filter((point) => point.wide).length,
    reason: points.length < 6 ? "At least six comparable hours are needed for a consistency score." : null,
  };
}
