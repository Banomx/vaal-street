import assert from "node:assert/strict";
import {
  CHAOS_ID, DIVINE_ID, tradedRate, buildGggLeagueSnapshot, fetchGggExchange,
  fetchGggPriceLookback, mergeGggLookback,
} from "../../poe1/sources/ggg-exchange.mjs";

const SCARAB = "Metadata/Items/Scarabs/TestScarab";
const FOSSIL = "Metadata/Items/Currency/Delve/TestFossil";
const DEAD = "Metadata/Items/Currency/DeadMarket";
const KEEPER = "Metadata/Items/DivinationCards/DivinationCardKeepersCorruption";

const market = (league, a, b, av, bv, low = [av, bv], high = [av, bv]) => ({
  league,
  market_id: `${a}|${b}`,
  market_pair: [a, b],
  volume_traded: { [a]: av, [b]: bv },
  lowest_stock: { [a]: 1, [b]: 1 },
  highest_stock: { [a]: 1, [b]: 1 },
  lowest_ratio: { [a]: low[0], [b]: low[1] },
  highest_ratio: { [a]: high[0], [b]: high[1] },
});

const markets = [
  market("Test League", DIVINE_ID, CHAOS_ID, 10, 2000, [1, 195], [1, 205]),
  market("Test League", SCARAB, CHAOS_ID, 40, 100, [2, 5], [4, 12]),
  market("Test League", FOSSIL, DIVINE_ID, 5, 1, [5, 1], [4, 1]),
  market("Test League", DEAD, CHAOS_ID, 0, 10),
  market("Other League", SCARAB, CHAOS_ID, 1, 999),
];
const baseItems = {
  [CHAOS_ID]: { name: "Chaos Orb", item_class: "StackableCurrency", tags: ["currency"] },
  [DIVINE_ID]: { name: "Divine Orb", item_class: "StackableCurrency", tags: ["currency"] },
  [SCARAB]: { name: "Test Scarab", item_class: "MapFragment", tags: ["scarab"] },
  [FOSSIL]: { name: "Test Fossil", item_class: "StackableCurrency", tags: ["fossil"] },
  [DEAD]: { name: "Dead Market", item_class: "StackableCurrency", tags: ["currency"] },
  [KEEPER]: { name: "Keeper's Corruption", item_class: "DivinationCard", tags: ["divination_card"] },
};

assert.equal(tradedRate(markets[1], SCARAB, CHAOS_ID), 2.5, "volume quotient is the hourly traded price");
const snapshot = buildGggLeagueSnapshot(markets, baseItems, "Test League");
assert.equal(snapshot.divineRate, 200, "divine is priced directly in chaos");
assert.equal(snapshot.prices["Test Scarab"].c, 2.5, "direct chaos market wins");
assert.equal(snapshot.prices["Test Scarab"].lo, 2.5, "ratio range lower bound is preserved");
assert.equal(snapshot.prices["Test Scarab"].hi, 3, "ratio range upper bound is preserved");
assert.equal(snapshot.prices["Test Fossil"].c, 40, "divine-only market converts through the GGG divine rate");
assert.equal(snapshot.prices["Test Fossil"].method, "via-divine");
assert.equal(snapshot.prices["Dead Market"], undefined, "zero-volume markets never become prices");
assert.equal(snapshot.prices["Test Scarab"].c, 2.5, "another league cannot contaminate the selected league");

// The CDN can lag the boundary. The fetcher retries the preceding completed
// hour, then resolves Metadata ids through RePoE without changing the price.
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("base_items")) return new Response(JSON.stringify(baseItems), { status: 200 });
  if (calls.filter((x) => x.includes("currency-exchange")).length === 1) {
    return new Response(JSON.stringify({ next_change_id: 0, markets: [] }), { status: 200 });
  }
  return new Response(JSON.stringify({ next_change_id: 123, markets }), { status: 200 });
};
try {
  const fetched = await fetchGggExchange({ now: Date.UTC(2026, 7, 7, 12, 30) });
  assert.equal(fetched.hourISO, "2026-08-07T10:00:00.000Z", "a missing previous hour falls back one more hour");
  assert.equal(fetched.byLeague["Test League"].prices["Test Scarab"].c, 2.5);
} finally {
  globalThis.fetch = originalFetch;
}

// A supported item with no trades in the newest digest may use its most
// recent completed GGG hour. Unsupported names must not widen the search.
const latestHour = Date.UTC(2026, 7, 7, 17) / 1000;
const thinMarkets = [...markets, market("Test League", KEEPER, CHAOS_ID, 0, 0)];
const thinSnapshot = buildGggLeagueSnapshot(thinMarkets, baseItems, "Test League", { hour: latestHour });
const exchange = {
  hour: latestHour,
  byLeague: { "Test League": thinSnapshot },
  _baseItems: baseItems,
  _markets: thinMarkets,
};
const oldMarkets = [...markets, market("Test League", KEEPER, CHAOS_ID, 5, 30, [1, 6], [1, 6])];
globalThis.fetch = async () => new Response(JSON.stringify({ markets: oldMarkets }), { status: 200 });
try {
  const lookback = await fetchGggPriceLookback(exchange, {
    league: "Test League",
    names: ["Keeper's Corruption", "Unsupported Unique"],
    maxHours: 2,
  });
  assert.deepEqual(lookback.supported, ["Keeper's Corruption"]);
  assert.equal(lookback.prices["Keeper's Corruption"].c, 6);
  assert.equal(lookback.prices["Keeper's Corruption"].staleHours, 1);
  assert.equal(lookback.prices["Unsupported Unique"], undefined);
  mergeGggLookback(thinSnapshot, lookback);
  assert.equal(thinSnapshot.prices["Keeper's Corruption"].c, 6);
  assert.equal(thinSnapshot.backfilled, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("GGG exchange tests passed");
