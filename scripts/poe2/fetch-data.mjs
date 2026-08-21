import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichPriceMetadata, exchangeToPrices, mergePrices, scoutToPrices, selectTrackedLeagues, slugifyLeague, stashToPrices } from "./prices.mjs";
import { fetchGggPoe2 } from "./ggg-exchange.mjs";
import { appendPriceSnapshot, mergePriceHistories } from "./history.mjs";
import { appendExchangeSnapshot, mergeExchangeHistories } from "./exchange-history.mjs";
import { BOSSES } from "../../src/games/poe2/features/bosses/bossData.js";
import { computeBosses, summarizePriceCoverage } from "../../src/games/poe2/features/bosses/bossProfit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.DATA_OUT || join(ROOT, "public", "data", "poe2");
const API = "https://poe.ninja/poe2/api/economy";
const SCOUT_API = "https://api.poe2scout.com/poe2/Leagues";
const USER_AGENT = "scarab-ledger/0.1 (+https://github.com/; PoE2 market snapshot)";
const FETCH_TIMEOUT_MS = Number(process.env.POE2_FETCH_TIMEOUT_MS || 30000);
const EXCHANGE_TYPES = ["Currency", "Fragments", "Abyss", "LineageSupportGems", "Ritual", "Expedition", "Delirium", "Breach", "Verisium", "SoulCores"];
const STASH_TYPES = ["UniqueWeapons", "UniqueArmours", "UniqueAccessories", "UniqueFlasks", "UniqueCharms", "UniqueJewels", "UniqueSanctumRelics", "UniqueTablets", "PrecursorTablets"];

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return null; }
}

function deployedBase() {
  if (process.env.PAGES_BASE_URL) return process.env.PAGES_BASE_URL.replace(/\/$/, "");
  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const owner = process.env.GITHUB_REPOSITORY?.split("/")[0];
  return owner && repository ? `https://${owner}.github.io/${repository}` : "";
}

async function reuseDeployment() {
  const base = deployedBase();
  if (!base) return false;
  try {
    const index = await getJson(`${base}/data/poe2/index.json`);
    if (!index?.leagues?.length) return false;
    const reusedIndex = {
      ...index,
      schemaVersion: 1,
      leagues: index.leagues.map((league) => ({
        ...league,
        files: {
          prices: "prices.json",
          priceHistory: "price-history.json",
          exchangeMarkets: "exchange-markets.json",
          exchangeHistory: "exchange-history.json",
        },
      })),
    };
    await writeJson(join(OUT, "index.json"), reusedIndex);
    for (const league of reusedIndex.leagues) {
      const prices = await getJson(`${base}/data/poe2/${encodeURIComponent(league.slug)}/prices.json`);
      await writeJson(join(OUT, league.slug, "prices.json"), prices);
      let history;
      try { history = await getJson(`${base}/data/poe2/${encodeURIComponent(league.slug)}/price-history.json`); }
      catch { history = appendPriceSnapshot(null, prices); }
      await writeJson(join(OUT, league.slug, "price-history.json"), history);
      for (const file of ["exchange-markets.json", "exchange-history.json"]) {
        try { await writeJson(join(OUT, league.slug, file), await getJson(`${base}/data/poe2/${encodeURIComponent(league.slug)}/${file}`)); }
        catch { /* Exchange-pair storage starts with the next scheduled fetch. */ }
      }
    }
    console.log(`Reused ${reusedIndex.leagues.length} deployed PoE 2 price snapshots and timelines.`);
    return true;
  } catch (error) {
    console.warn(`Could not reuse deployed PoE 2 data: ${error.message}`);
    return false;
  }
}

async function previousExchangeData(slug) {
  let current = await readJsonFile(join(OUT, slug, "exchange-markets.json"));
  let history = process.env.RESET_HISTORY === "true" ? null : await readJsonFile(join(OUT, slug, "exchange-history.json"));
  const base = deployedBase();
  if (!base) return { current, history };
  try { current = await getJson(`${base}/data/poe2/${encodeURIComponent(slug)}/exchange-markets.json`); }
  catch { /* No deployed pair snapshot yet. */ }
  if (process.env.RESET_HISTORY === "true") return { current, history: null };
  try {
    const deployed = await getJson(`${base}/data/poe2/${encodeURIComponent(slug)}/exchange-history.json`);
    history = mergeExchangeHistories(history, deployed);
  } catch { /* No deployed pair history yet. */ }
  return { current, history };
}

async function previousPriceHistory(slug) {
  if (process.env.RESET_HISTORY === "true") return null;
  const local = await readJsonFile(join(OUT, slug, "price-history.json"));
  const base = deployedBase();
  if (!base) return local;
  try {
    const deployed = await getJson(`${base}/data/poe2/${encodeURIComponent(slug)}/price-history.json`);
    return mergePriceHistories(local, deployed);
  } catch (error) {
    console.warn(`${slug}/price history: ${error.message}`);
    return local;
  }
}

async function fetchLeague(name, ggg) {
  const encoded = encodeURIComponent(name);
  const scoutPayloadPromise = getJson(`${SCOUT_API}/${encoded}/Items`)
    .catch((error) => { console.warn(`${name}/PoE2Scout: ${error.message}`); return null; });
  const exchangePayloads = await Promise.all(EXCHANGE_TYPES.map(async (type) => {
    try { return { type, payload: await getJson(`${API}/exchange/current/overview?league=${encoded}&type=${type}`) }; }
    catch (error) { console.warn(`${name}/${type}: ${error.message}`); return null; }
  }));
  const stashPayloads = await Promise.all(STASH_TYPES.map(async (type) => {
    try { return { type, payload: await getJson(`${API}/stash/current/item/overview?league=${encoded}&type=${type}`) }; }
    catch (error) { console.warn(`${name}/${type}: ${error.message}`); return null; }
  }));
  const scoutPayload = await scoutPayloadPromise;

  const scoutPrices = scoutToPrices(scoutPayload);
  const ninjaPrices = {};
  let divineExalted = ggg?.divineExalted || 0;
  for (const result of exchangePayloads) {
    if (!result) continue;
    const parsed = exchangeToPrices(result.payload, result.type);
    if (parsed.divineExalted) divineExalted = parsed.divineExalted;
    mergePrices(ninjaPrices, parsed.prices);
  }
  for (const result of stashPayloads) {
    if (result) mergePrices(ninjaPrices, stashToPrices(result.payload, result.type));
  }
  const prices = mergePrices({}, scoutPrices);
  mergePrices(prices, ninjaPrices);
  mergePrices(prices, ggg?.prices);
  enrichPriceMetadata(prices, ggg?.baseItems);
  enrichPriceMetadata(ninjaPrices, ggg?.baseItems);
  enrichPriceMetadata(scoutPrices, ggg?.baseItems);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    league: name,
    priceSource: "GGG completed trades, then poe.ninja PoE 2 economy API, then PoE2Scout gap-fill",
    divineExalted,
    prices,
    sourcePrices: {
      poeNinja: ninjaPrices,
      poe2Scout: scoutPrices,
    },
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (process.env.DATA_MODE === "reuse" && await reuseDeployment()) return;

  const response = await getJson(`${API}/leagues`);
  const names = selectTrackedLeagues(response?.economyLeagues || response?.leagues || response, Number(process.env.POE2_LEAGUE_LIMIT || 2));
  if (!names.length) throw new Error("poe.ninja returned no PoE 2 leagues");
  let ggg = { byLeague: {} };
  try { ggg = await fetchGggPoe2(); }
  catch (error) { console.warn(`GGG PoE 2 feed unavailable: ${error.message}`); }
  const leagues = [];
  for (const name of names) {
    const slug = slugifyLeague(name);
    const previousHistory = await previousPriceHistory(slug);
    const previousExchange = await previousExchangeData(slug);
    const gggLeague = ggg.byLeague[name];
    const snapshot = await fetchLeague(name, { ...gggLeague, baseItems: ggg.baseItems });
    await writeJson(join(OUT, slug, "prices.json"), snapshot);
    const history = appendPriceSnapshot(previousHistory, snapshot);
    await writeJson(join(OUT, slug, "price-history.json"), history);
    let exchangeHistory = previousExchange.history;
    if (gggLeague?.exchange?.pairs?.length) {
      exchangeHistory = appendExchangeSnapshot(exchangeHistory, gggLeague.exchange);
      await writeJson(join(OUT, slug, "exchange-markets.json"), gggLeague.exchange);
      await writeJson(join(OUT, slug, "exchange-history.json"), exchangeHistory);
    } else if (previousExchange.current) {
      await writeJson(join(OUT, slug, "exchange-markets.json"), previousExchange.current);
      if (exchangeHistory) await writeJson(join(OUT, slug, "exchange-history.json"), exchangeHistory);
    }
    leagues.push({
      name,
      slug,
      group: name === "Standard" ? "permanent" : "current",
      files: {
        prices: "prices.json",
        priceHistory: "price-history.json",
        exchangeMarkets: "exchange-markets.json",
        exchangeHistory: "exchange-history.json",
      },
    });
    const coverage = summarizePriceCoverage(computeBosses(BOSSES, snapshot.prices, {}));
    console.log(`${name}: ${Object.keys(snapshot.prices).length} prices · ${history.timestamps.length} price points · ${gggLeague?.exchange?.pairs?.length || 0} completed exchange pairs · boss market coverage ${coverage.priced}/${coverage.total}`);
    if (coverage.missing.length) {
      const preview = coverage.missing.slice(0, 20).map((item) => `${item.item}${item.variant ? ` (${item.variant})` : ""}`).join(", ");
      console.warn(`${name}: ${coverage.missing.length} boss-market item(s) unpriced: ${preview}${coverage.missing.length > 20 ? `, +${coverage.missing.length - 20} more` : ""}`);
    }
  }
  await writeJson(join(OUT, "index.json"), { schemaVersion: 1, generatedAt: new Date().toISOString(), leagues });
}

main().catch(async (error) => {
  console.error(error);
  try {
    const prior = JSON.parse(await readFile(join(ROOT, "public", "data", "poe2", "index.json"), "utf8"));
    if (prior?.leagues?.length) process.exit(0);
  } catch { /* no prior snapshot */ }
  process.exit(1);
});
