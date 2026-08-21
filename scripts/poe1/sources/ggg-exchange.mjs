/* GGG's public Currency Exchange feed.

   The feed is an hourly digest of completed trades. It identifies items by
   their internal Metadata path, so RePoE is used only as a name dictionary;
   all prices and volumes in this module come from GGG.

   GGG does not publish the current hour. The workflow runs after the hourly
   boundary and asks for the previous completed hour, falling back one more
   hour when that digest has not reached the CDN yet.

   Thin items can have a market row but no completed trades in the latest
   digest. `fetchGggPriceLookback` can recover only requested, exchange-backed
   names from recent completed hours; it is deliberately not a full-history
   download. */

const GGG_BASE = process.env.GGG_EXCHANGE_BASE || "https://web.poecdn.com/api/currency-exchange";
const REPOE_URL = process.env.REPOE_BASE_ITEMS_URL || "https://repoe-fork.github.io/base_items.min.json";
const HEADERS = {
  "User-Agent": "scarab-ledger-snapshot/0.4 (contact: github.com/Banomx/scarab-ledger)",
  Accept: "application/json",
};

export const CHAOS_ID = "Metadata/Items/Currency/CurrencyRerollRare";
export const DIVINE_ID = "Metadata/Items/Currency/CurrencyModValues";
const HOUR_MS = 3600_000;

const rounded = (v) => {
  if (!(v > 0) || !isFinite(v)) return 0;
  const places = v >= 10 ? 2 : v >= 1 ? 3 : 4;
  return Math.round(v * (10 ** places)) / (10 ** places);
};

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function amount(market, field, id) {
  const n = Number(market?.[field]?.[id]);
  return isFinite(n) && n > 0 ? n : 0;
}

/* Units of `quote` paid per unit of `item`. The two volume totals describe
   everything that closed in the hour, so their quotient is the hourly
   volume-weighted mean rate. */
export function tradedRate(market, item, quote) {
  const itemVolume = amount(market, "volume_traded", item);
  const quoteVolume = amount(market, "volume_traded", quote);
  return itemVolume && quoteVolume ? quoteVolume / itemVolume : 0;
}

function ratioBounds(market, item, quote) {
  const values = ["lowest_ratio", "highest_ratio"]
    .map((field) => {
      const itemUnits = amount(market, field, item);
      const quoteUnits = amount(market, field, quote);
      return itemUnits && quoteUnits ? quoteUnits / itemUnits : 0;
    })
    .filter((v) => v > 0 && isFinite(v));
  return values.length
    ? { lo: Math.min(...values), hi: Math.max(...values) }
    : null;
}

export function buildGggLeagueSnapshot(markets, baseItems, league, { hour = null } = {}) {
  const active = (markets || []).filter((market) => {
    if (market?.league !== league || market?.market_pair?.length !== 2) return false;
    return market.market_pair.every((id) => amount(market, "volume_traded", id) > 0);
  });
  const pairs = new Map(active.map((market) => [pairKey(...market.market_pair), market]));
  const findPair = (a, b) => pairs.get(pairKey(a, b)) || null;
  const divineMarket = findPair(DIVINE_ID, CHAOS_ID);
  const divineRate = divineMarket ? tradedRate(divineMarket, DIVINE_ID, CHAOS_ID) : 0;

  const ids = new Set(active.flatMap((market) => market.market_pair));
  ids.add(CHAOS_ID);
  const prices = {};
  const selected = {};
  let directChaos = 0;
  let viaDivine = 0;

  for (const id of ids) {
    const meta = baseItems?.[id];
    const name = meta?.name;
    if (!name) continue;

    let chaos = id === CHAOS_ID ? 1 : 0;
    let bounds = id === CHAOS_ID ? { lo: 1, hi: 1 } : null;
    let volume1H = 0;
    let method = "unit";
    const chaosMarket = id === CHAOS_ID ? null : findPair(id, CHAOS_ID);
    if (chaosMarket) {
      chaos = tradedRate(chaosMarket, id, CHAOS_ID);
      bounds = ratioBounds(chaosMarket, id, CHAOS_ID);
      volume1H = amount(chaosMarket, "volume_traded", id);
      method = "direct-chaos";
      directChaos++;
    } else if (id !== DIVINE_ID && divineRate > 0) {
      const market = findPair(id, DIVINE_ID);
      if (market) {
        chaos = tradedRate(market, id, DIVINE_ID) * divineRate;
        const rawBounds = ratioBounds(market, id, DIVINE_ID);
        bounds = rawBounds && { lo: rawBounds.lo * divineRate, hi: rawBounds.hi * divineRate };
        volume1H = amount(market, "volume_traded", id);
        method = "via-divine";
        viaDivine++;
      }
    } else if (id === DIVINE_ID && divineRate > 0) {
      chaos = divineRate;
      bounds = ratioBounds(divineMarket, DIVINE_ID, CHAOS_ID);
      volume1H = amount(divineMarket, "volume_traded", DIVINE_ID);
      method = "direct-chaos";
      directChaos++;
    }
    if (!(chaos > 0)) continue;

    const entry = {
      c: rounded(chaos),
      lo: rounded(bounds?.lo || chaos),
      hi: rounded(bounds?.hi || chaos),
      n: 1,
      exchange: true,
      exchangeSource: "GGG",
      volume1H,
      gggId: id,
      method,
      ...(hour ? { marketHour: new Date(hour * 1000).toISOString() } : {}),
    };
    // Different Metadata entries can share a display name. Prefer the one
    // with more completed trades instead of allowing iteration order to win.
    if (prices[name] && (prices[name].volume1H || 0) >= volume1H) continue;
    prices[name] = entry;
    selected[name] = { id, meta };
  }

  const items = Object.entries(prices).map(([name, entry]) => ({
    id: selected[name].id,
    name,
    chaosValue: entry.c,
    divineValue: divineRate > 0 ? entry.c / divineRate : 0,
    change24: 0,
    change48: 0,
    exchange: true,
    exchangeSource: "GGG",
    volume1H: entry.volume1H,
    ...(entry.marketHour ? { marketHour: entry.marketHour } : {}),
    itemClass: selected[name].meta.item_class || null,
    tags: selected[name].meta.tags || [],
  }));

  return {
    league,
    divineRate: rounded(divineRate),
    prices,
    items,
    markets: active.length,
    directChaos,
    viaDivine,
  };
}

export async function fetchGggExchange({ now = Date.now() } = {}) {
  const currentHour = Math.floor(now / HOUR_MS) * (HOUR_MS / 1000);
  let payload = null;
  let hour = 0;
  let lastError = null;

  for (const hoursBack of [1, 2]) {
    hour = currentHour - hoursBack * (HOUR_MS / 1000);
    try {
      const candidate = await getJson(`${GGG_BASE}/${hour}`);
      if (Array.isArray(candidate?.markets) && candidate.markets.length) {
        payload = candidate;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (!payload) throw lastError || new Error("GGG returned no completed hourly market digest");

  const baseItems = await getJson(REPOE_URL);
  const leagues = [...new Set(payload.markets.map((market) => market.league).filter(Boolean))];
  const byLeague = {};
  for (const league of leagues) {
    byLeague[league] = buildGggLeagueSnapshot(payload.markets, baseItems, league, { hour });
  }
  return {
    hour,
    hourISO: new Date(hour * 1000).toISOString(),
    nextChangeId: payload.next_change_id,
    marketCount: payload.markets.length,
    baseItemCount: Object.keys(baseItems || {}).length,
    byLeague,
    // Kept in memory for the targeted thin-market lookup below. These are not
    // written to public/data; only the selected named prices are emitted.
    _baseItems: baseItems,
    _markets: payload.markets,
  };
}

function supportedNameIds(markets, baseItems, league, requested) {
  const wanted = new Set(requested || []);
  const byName = new Map();
  for (const market of markets || []) {
    if (market?.league !== league) continue;
    for (const id of market.market_pair || []) {
      const name = baseItems?.[id]?.name;
      if (!wanted.has(name)) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(id);
    }
  }
  return byName;
}

/* Search recent completed hours only for requested names which GGG exposes in
   the current league's Currency Exchange market. This distinction matters:
   uniques missing from poe.watch/poe.ninja must not trigger 24 large digest
   downloads when GGG never prices uniques through this feed. */
export async function fetchGggPriceLookback(exchange, {
  league,
  names = [],
  maxHours = 24,
} = {}) {
  if (!exchange?.hour || !league || !exchange._baseItems || !exchange._markets) {
    return { prices: {}, items: [], supported: [], unresolved: [], hoursChecked: 0 };
  }

  const current = exchange.byLeague?.[league];
  const requested = [...new Set(names)].filter((name) => name && !current?.prices?.[name]);
  const idsByName = supportedNameIds(exchange._markets, exchange._baseItems, league, requested);
  const unresolved = new Set(idsByName.keys());
  const prices = {};
  const items = [];
  let hoursChecked = 0;

  for (let offset = 1; offset <= maxHours && unresolved.size; offset++) {
    const hour = exchange.hour - offset * (HOUR_MS / 1000);
    let payload;
    try {
      payload = await getJson(`${GGG_BASE}/${hour}`);
    } catch {
      continue;
    }
    if (!Array.isArray(payload?.markets) || !payload.markets.length) continue;
    hoursChecked++;
    const snapshot = buildGggLeagueSnapshot(payload.markets, exchange._baseItems, league, { hour });
    for (const name of [...unresolved]) {
      const entry = snapshot.prices[name];
      if (!entry) continue;
      prices[name] = { ...entry, staleHours: offset };
      const item = snapshot.items.find((candidate) => candidate.name === name);
      if (item) items.push({ ...item, staleHours: offset });
      unresolved.delete(name);
    }
  }

  return {
    prices,
    items,
    supported: [...idsByName.keys()],
    unresolved: [...unresolved],
    hoursChecked,
  };
}

export function mergeGggLookback(snapshot, lookback) {
  if (!snapshot || !lookback) return snapshot;
  const existingItems = new Set((snapshot.items || []).map((item) => item.name));
  for (const [name, entry] of Object.entries(lookback.prices || {})) {
    if (!snapshot.prices[name]) snapshot.prices[name] = entry;
  }
  for (const item of lookback.items || []) {
    if (!existingItems.has(item.name)) {
      snapshot.items.push(item);
      existingItems.add(item.name);
    }
  }
  snapshot.backfilled = (snapshot.backfilled || 0) + Object.keys(lookback.prices || {}).length;
  return snapshot;
}
