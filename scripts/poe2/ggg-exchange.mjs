import { JSON_HEADERS, sourceRecord } from "../shared/dataset.mjs";
import { fetchBaseItems } from "../shared/repoe.mjs";

const BASE = process.env.GGG_POE2_EXCHANGE_BASE || "https://web.poecdn.com/api/currency-exchange/poe2";
const ITEMS_URL = process.env.REPOE_POE2_ITEMS_URL || "https://repoe-fork.github.io/poe2/base_items.min.json";
const HEADERS = { ...JSON_HEADERS };
const HOUR = 3600;
const FETCH_TIMEOUT_MS = Number(process.env.POE2_FETCH_TIMEOUT_MS || 30000);

export const EXALTED_ID = "Metadata/Items/Currency/CurrencyAddModToRare";
export const DIVINE_ID = "Metadata/Items/Currency/CurrencyModValues";

const amount = (market, field, id) => {
  const value = Number(market?.[field]?.[id]);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const pairKey = (a, b) => [a, b].sort().join("|");

export function tradedRate(market, item, quote) {
  const itemVolume = amount(market, "volume_traded", item);
  const quoteVolume = amount(market, "volume_traded", quote);
  return itemVolume && quoteVolume ? quoteVolume / itemVolume : 0;
}

export function ratioBounds(market, item, quote) {
  const values = ["lowest_ratio", "highest_ratio"].map((field) => {
    const itemUnits = amount(market, field, item);
    const quoteUnits = amount(market, field, quote);
    return itemUnits && quoteUnits ? quoteUnits / itemUnits : 0;
  }).filter((value) => value > 0 && Number.isFinite(value));
  return values.length ? { low: Math.min(...values), high: Math.max(...values) } : null;
}

export function buildGggExchangeSnapshot(markets, baseItems, league, hour = null) {
  const active = (markets || []).filter((market) => market?.league === league && market?.market_pair?.length === 2
    && market.market_pair.every((id) => amount(market, "volume_traded", id) > 0));
  const ids = new Set(active.flatMap((market) => market.market_pair));
  const items = Object.fromEntries([...ids].map((id) => [id, {
    name: baseItems?.[id]?.name || id.split("/").pop() || id,
    type: baseItems?.[id]?.item_class || baseItems?.[id]?.itemClass || null,
    tags: Array.isArray(baseItems?.[id]?.tags) ? baseItems[id].tags : [],
  }]));
  const pairs = active.map((market) => {
    const [first, second] = [...market.market_pair].sort();
    const bounds = ratioBounds(market, first, second);
    const rate = tradedRate(market, first, second);
    return {
      id: pairKey(first, second),
      left: first,
      right: second,
      leftVolume: amount(market, "volume_traded", first),
      rightVolume: amount(market, "volume_traded", second),
      rightPerLeft: rate,
      lowRightPerLeft: bounds?.low || rate,
      highRightPerLeft: bounds?.high || rate,
      lowStock: [amount(market, "lowest_stock", first), amount(market, "lowest_stock", second)],
      highStock: [amount(market, "highest_stock", first), amount(market, "highest_stock", second)],
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const marketHour = hour ? new Date(hour * 1000).toISOString() : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    marketHour,
    league,
    items,
    pairs,
  };
}

export function buildGggPrices(markets, baseItems, league, hour = null) {
  const active = (markets || []).filter((market) => market?.league === league && market?.market_pair?.length === 2
    && market.market_pair.every((id) => amount(market, "volume_traded", id) > 0));
  const pairs = new Map(active.map((market) => [pairKey(...market.market_pair), market]));
  const find = (a, b) => pairs.get(pairKey(a, b));
  const divineExalted = tradedRate(find(DIVINE_ID, EXALTED_ID), DIVINE_ID, EXALTED_ID);
  const ids = new Set(active.flatMap((market) => market.market_pair));
  const prices = {};

  for (const id of ids) {
    const name = baseItems?.[id]?.name;
    if (!name) continue;
    let exalted = id === EXALTED_ID ? 1 : 0;
    let volume1H = 0;
    const direct = id === EXALTED_ID ? null : find(id, EXALTED_ID);
    if (direct) {
      exalted = tradedRate(direct, id, EXALTED_ID);
      volume1H = amount(direct, "volume_traded", id);
    } else if (id === DIVINE_ID) {
      exalted = divineExalted;
    } else if (divineExalted > 0) {
      const viaDivine = find(id, DIVINE_ID);
      if (viaDivine) {
        exalted = tradedRate(viaDivine, id, DIVINE_ID) * divineExalted;
        volume1H = amount(viaDivine, "volume_traded", id);
      }
    }
    if (!(exalted > 0)) continue;
    /* Stock and the hour's own low/high ratio band travel with the price. A
       completed-trade mean says what cleared; the band and the stock say how
       much room there was around it, which is the difference between a price
       you can act on and one hour's coincidence. */
    const bounds = direct ? ratioBounds(direct, id, EXALTED_ID)
      : id !== DIVINE_ID && divineExalted > 0 && find(id, DIVINE_ID)
        ? (() => {
          const raw = ratioBounds(find(id, DIVINE_ID), id, DIVINE_ID);
          return raw ? { low: raw.low * divineExalted, high: raw.high * divineExalted } : null;
        })()
        : null;
    const stockMarket = direct || (id === DIVINE_ID ? find(DIVINE_ID, EXALTED_ID) : find(id, DIVINE_ID));
    const entry = {
      exalted,
      volume1H,
      ...(bounds ? { low: bounds.low, high: bounds.high } : {}),
      ...(stockMarket ? {
        lowStock: amount(stockMarket, "lowest_stock", id) || undefined,
        highStock: amount(stockMarket, "highest_stock", id) || undefined,
      } : {}),
      source: "GGG completed trades",
      itemId: id,
      type: baseItems?.[id]?.item_class || baseItems?.[id]?.itemClass || null,
      itemClass: baseItems?.[id]?.item_class || baseItems?.[id]?.itemClass || null,
      tags: Array.isArray(baseItems?.[id]?.tags) ? baseItems[id].tags : [],
      metadataPath: id,
      inheritsFrom: baseItems?.[id]?.inherits_from || baseItems?.[id]?.inheritsFrom || null,
      marketHour: hour ? new Date(hour * 1000).toISOString() : null,
    };
    if (!prices[name] || volume1H > (prices[name].volume1H || 0)) prices[name] = entry;
  }
  return { prices, divineExalted, exchange: buildGggExchangeSnapshot(markets, baseItems, league, hour) };
}

async function getJson(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function fetchGggPoe2({ now = Date.now() } = {}) {
  const current = Math.floor(now / 1000 / HOUR) * HOUR;
  let payload;
  let hour;
  let lastError;
  for (const back of [1, 2]) {
    hour = current - back * HOUR;
    try {
      const candidate = await getJson(`${BASE}/${hour}`);
      if (candidate?.markets?.length) { payload = candidate; break; }
    } catch (error) { lastError = error; }
  }
  if (!payload) throw lastError || new Error("GGG returned no completed PoE 2 trade digest");
  const { baseItems, provenance: repoe } = await fetchBaseItems(ITEMS_URL, {
    id: "repoe.poe2.baseItems", headers: HEADERS, timeoutMs: FETCH_TIMEOUT_MS,
  });
  const leagues = [...new Set(payload.markets.map((market) => market.league).filter(Boolean))];
  return {
    hour,
    marketHour: new Date(hour * 1000).toISOString(),
    nextChangeId: payload.next_change_id ?? null,
    marketCount: payload.markets.length,
    baseItems,
    sources: [
      sourceRecord({
        id: "ggg.poe2.currencyExchange",
        endpointFamily: "ggg",
        url: `${BASE}/${hour}`,
        requestedAt: new Date().toISOString(),
        observedAt: new Date(hour * 1000).toISOString(),
        ok: true,
        rawRows: payload.markets.length,
        version: payload.next_change_id != null ? String(payload.next_change_id) : null,
      }),
      repoe,
    ],
    byLeague: Object.fromEntries(leagues.map((league) => [league, buildGggPrices(payload.markets, baseItems, league, hour)])),
  };
}
