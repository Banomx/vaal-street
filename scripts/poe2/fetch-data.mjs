import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describePriceSources, enrichPriceMetadata, exchangeToPrices, mergePrices, sanitizeCarriedPrices, scoutToPrices, selectTrackedLeagues, slugifyLeague, stashToPrices } from "./prices.mjs";
import { fetchGggPoe2 } from "./ggg-exchange.mjs";
import { appendPriceSnapshot, mergePriceHistories } from "./history.mjs";
import { appendExchangeSnapshot, mergeExchangeHistories } from "./exchange-history.mjs";
import { BOSSES } from "../../src/games/poe2/features/bosses/bossData.js";
import { computeBosses, summarizePriceCoverage } from "../../src/games/poe2/features/bosses/bossProfit.js";
import { QualityReport, USER_AGENT, clearAbandonedStages, createStage, sourceRecord } from "../shared/dataset.mjs";
import { POE2_SCHEMA_VERSION, validatePoe2 } from "./validate.mjs";
import { EXCHANGE_TYPES, STASH_TYPES } from "./endpoints.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/* `OUT` is a staging directory for the length of a run and only becomes the
   published tree once the gates pass. Generating in place would mean a bad run
   has already destroyed the thing it should have fallen back to. */
const FINAL_OUT = process.env.DATA_OUT || join(ROOT, "public", "data", "poe2");
let OUT = FINAL_OUT;
const API = "https://poe.ninja/poe2/api/economy";
const SCOUT_API = "https://api.poe2scout.com/poe2/Leagues";

const FETCH_TIMEOUT_MS = Number(process.env.POE2_FETCH_TIMEOUT_MS || 30000);
/* Accepted types, their consumers and the documented ones deliberately skipped
   live in ./endpoints.mjs. UncutGems, Essences, Idols and Runes were absent from
   this list until 2026-08-21, which left everything in them unpriced or pushed
   onto a listing feed. */

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

export const LEAGUE_FILES = {
  prices: "prices.json",
  priceHistory: "price-history.json",
  exchangeMarkets: "exchange-markets.json",
  exchangeHistory: "exchange-history.json",
};

async function tryGetJson(url) {
  try { return await getJson(url); }
  catch { return null; }
}

/* The checked-in `public/data/poe2` tree is a recovery seed, not scratch: it is
   the only copy of a timeline that survives a repository move, because the
   previous deployment disappears with the old Pages site. Reuse mode therefore
   merges it with whatever is deployed rather than overwriting it. */
async function localLeagueSlugs() {
  try {
    const entries = await readdir(OUT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch { return []; }
}

function historyPointCount(history) {
  return Array.isArray(history?.timestamps) ? history.timestamps.length : 0;
}

function exchangePointCount(history) {
  return Array.isArray(history?.snapshots) ? history.snapshots.length : 0;
}

/* Reuse runs on every code push. It used to replace each league's timeline with
   whatever the live site happened to hold, so a recovery seed richer than the
   deployment was destroyed by the very deploy that shipped it. Merge instead,
   assert the result is no poorer than either input, and write the index last so
   a half-downloaded reuse never advertises files that are not there yet. */
async function reuseDeployment() {
  const base = deployedBase();
  if (!base) return false;
  const index = await tryGetJson(`${base}/data/poe2/index.json`);
  const deployedLeagues = Array.isArray(index?.leagues) ? index.leagues : [];
  const seeded = await localLeagueSlugs();
  const slugs = [...new Set([...deployedLeagues.map((league) => league.slug), ...seeded])].filter(Boolean);
  if (!slugs.length) return false;

  const staged = [];
  for (const slug of slugs) {
    const url = (file) => `${base}/data/poe2/${encodeURIComponent(slug)}/${file}`;
    const localPrices = await readJsonFile(join(OUT, slug, LEAGUE_FILES.prices));
    const carried = await tryGetJson(url(LEAGUE_FILES.prices)) ?? localPrices;
    if (!carried?.prices) {
      console.warn(`${slug}: no deployed or local price snapshot — league not reused`);
      continue;
    }
    const { doc: prices, dropped } = sanitizeCarriedPrices(carried);
    if (dropped.length) console.log(`${slug}: cleaned carried prices — ${dropped.join(", ")}`);

    const localHistory = await readJsonFile(join(OUT, slug, LEAGUE_FILES.priceHistory));
    const deployedHistory = await tryGetJson(url(LEAGUE_FILES.priceHistory));
    let priceHistory = (localHistory || deployedHistory)
      ? mergePriceHistories(localHistory, deployedHistory)
      : appendPriceSnapshot(null, prices);
    if (historyPointCount(priceHistory) < Math.max(historyPointCount(localHistory), historyPointCount(deployedHistory))) {
      throw new Error(`${slug}: merged price history lost points — refusing to publish`);
    }

    const localExchange = await readJsonFile(join(OUT, slug, LEAGUE_FILES.exchangeHistory));
    const deployedExchange = await tryGetJson(url(LEAGUE_FILES.exchangeHistory));
    const exchangeHistory = (localExchange || deployedExchange)
      ? mergeExchangeHistories(localExchange, deployedExchange)
      : null;
    if (exchangeHistory
      && exchangePointCount(exchangeHistory) < Math.max(exchangePointCount(localExchange), exchangePointCount(deployedExchange))) {
      throw new Error(`${slug}: merged exchange history lost snapshots — refusing to publish`);
    }

    const markets = await tryGetJson(url(LEAGUE_FILES.exchangeMarkets))
      ?? await readJsonFile(join(OUT, slug, LEAGUE_FILES.exchangeMarkets));

    const entry = deployedLeagues.find((league) => league.slug === slug);
    staged.push({
      league: {
        name: entry?.name || prices.league || slug,
        slug,
        group: entry?.group || (prices.league === "Standard" ? "permanent" : "current"),
        files: { ...LEAGUE_FILES },
      },
      files: { prices, priceHistory, exchangeHistory, markets },
      restored: historyPointCount(priceHistory) - historyPointCount(deployedHistory),
    });
  }
  if (!staged.length) return false;

  for (const { league, files } of staged) {
    await writeJson(join(OUT, league.slug, LEAGUE_FILES.prices), files.prices);
    await writeJson(join(OUT, league.slug, LEAGUE_FILES.priceHistory), files.priceHistory);
    if (files.markets) await writeJson(join(OUT, league.slug, LEAGUE_FILES.exchangeMarkets), files.markets);
    if (files.exchangeHistory) await writeJson(join(OUT, league.slug, LEAGUE_FILES.exchangeHistory), files.exchangeHistory);
  }
  await writeJson(join(OUT, "index.json"), {
    // A code-only deployment may be carrying version-1 snapshots from the
    // previous build. Do not relabel that tree as schema 2; the next fresh run
    // upgrades it after producing and validating the new provenance contract.
    schemaVersion: staged.every((entry) => entry.files.prices?.schemaVersion === POE2_SCHEMA_VERSION)
      ? POE2_SCHEMA_VERSION : 1,
    generatedAt: new Date().toISOString(),
    leagues: staged.map((entry) => entry.league),
  });
  for (const entry of staged) {
    console.log(`Reused ${entry.league.name}: ${historyPointCount(entry.files.priceHistory)} price point(s)`
      + `, ${exchangePointCount(entry.files.exchangeHistory)} exchange snapshot(s)`
      + (entry.restored > 0 ? ` — restored ${entry.restored} point(s) the deployment had lost` : ""));
  }
  return true;
}

async function previousExchangeData(slug) {
  let current = await readJsonFile(join(OUT, slug, "exchange-markets.json"));
  let history = await readJsonFile(join(OUT, slug, "exchange-history.json"));
  const base = deployedBase();
  if (!base) return { current, history };
  try { current = await getJson(`${base}/data/poe2/${encodeURIComponent(slug)}/exchange-markets.json`); }
  catch { /* No deployed pair snapshot yet. */ }
  try {
    const deployed = await getJson(`${base}/data/poe2/${encodeURIComponent(slug)}/exchange-history.json`);
    history = mergeExchangeHistories(history, deployed);
  } catch { /* No deployed pair history yet. */ }
  return { current, history };
}

async function previousPriceHistory(slug) {
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
  const sources = [];
  const scoutUrl = `${SCOUT_API}/${encoded}/Items`;
  const scoutRequestedAt = new Date().toISOString();
  const scoutPayloadPromise = getJson(scoutUrl)
    .catch((error) => { console.warn(`${name}/PoE2Scout: ${error.message}`); return null; });

  const request = async (family, type, url) => {
    const requestedAt = new Date().toISOString();
    try {
      return { type, url, requestedAt, payload: await getJson(url) };
    } catch (error) {
      console.warn(`${name}/${type}: ${error.message}`);
      sources.push(sourceRecord({ id: `ninja.poe2.${family}`, endpointFamily: family, requestedType: type, url, requestedAt, ok: false, warnings: [error.message] }));
      return null;
    }
  };
  const exchangePayloads = await Promise.all(EXCHANGE_TYPES.map((type) =>
    request("exchange", type, `${API}/exchange/current/overview?league=${encoded}&type=${type}`)));
  const stashPayloads = await Promise.all(STASH_TYPES.map((type) =>
    request("stashItem", type, `${API}/stash/current/item/overview?league=${encoded}&type=${type}`)));
  const scoutPayload = await scoutPayloadPromise;

  const scoutPrices = scoutToPrices(scoutPayload);
  for (const entry of Object.values(scoutPrices)) if (!entry.observedAt) entry.observedAt = scoutRequestedAt;
  const scoutParse = scoutPrices.__parse || {};
  sources.push(sourceRecord({
    id: "poe2scout.items", endpointFamily: "scout", url: scoutUrl, requestedAt: scoutRequestedAt,
    observedAt: scoutRequestedAt, ok: !!scoutPayload, rawRows: scoutParse.rawRows ?? 0, accepted: scoutParse.accepted ?? 0,
    rejected: scoutParse.rejected ?? 0, rejectedReasons: scoutParse.rejectedReasons,
    skipped: scoutParse.skipped ?? 0, skippedReasons: scoutParse.skippedReasons,
  }));

  const ninjaPrices = {};
  let divineExalted = ggg?.divineExalted || 0;
  for (const result of exchangePayloads) {
    if (!result) continue;
    const parsed = exchangeToPrices(result.payload, result.type);
    for (const entry of Object.values(parsed.prices)) if (!entry.observedAt) entry.observedAt = result.requestedAt;
    if (parsed.divineExalted) divineExalted = parsed.divineExalted;
    mergePrices(ninjaPrices, parsed.prices);
    sources.push(sourceRecord({
      id: "ninja.poe2.exchange", endpointFamily: "exchange", requestedType: result.type, url: result.url,
      requestedAt: result.requestedAt, observedAt: result.requestedAt,
      ok: true, rawRows: parsed.rawRows, accepted: parsed.accepted,
      rejected: parsed.rejected, rejectedReasons: parsed.rejectedReasons,
    }));
  }
  for (const result of stashPayloads) {
    if (!result) continue;
    const parsed = stashToPrices(result.payload, result.type);
    for (const entry of Object.values(parsed)) if (!entry.observedAt) entry.observedAt = result.requestedAt;
    mergePrices(ninjaPrices, parsed);
    const stats = parsed.__parse || {};
    sources.push(sourceRecord({
      id: "ninja.poe2.stashItem", endpointFamily: "stashItem", requestedType: result.type, url: result.url,
      requestedAt: result.requestedAt, observedAt: result.requestedAt,
      ok: true, rawRows: stats.rawRows, accepted: stats.accepted,
      rejected: stats.rejected, rejectedReasons: stats.rejectedReasons,
    }));
  }
  const prices = mergePrices({}, scoutPrices);
  mergePrices(prices, ninjaPrices);
  mergePrices(prices, ggg?.prices);
  const coverage = enrichPriceMetadata(prices, ggg?.baseItems);
  enrichPriceMetadata(ninjaPrices, ggg?.baseItems);
  enrichPriceMetadata(scoutPrices, ggg?.baseItems);

  return {
    schemaVersion: POE2_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    league: name,
    priceSource: describePriceSources(prices),
    divineExalted,
    sources: [...(ggg?.sources || []), ...sources],
    metadataCoverage: coverage,
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
    const snapshot = await fetchLeague(name, {
      ...gggLeague,
      baseItems: ggg.baseItems,
      // `sources` belongs to the digest envelope, not an individual league.
      // Passing only `byLeague[name]` silently dropped the provenance for the
      // GGG prices selected below and for the RePoE dictionary that identified
      // them.
      sources: ggg.sources,
    });
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
      files: { ...LEAGUE_FILES },
    });
    const coverage = summarizePriceCoverage(computeBosses(BOSSES, snapshot.prices, {}));
    console.log(`${name}: ${Object.keys(snapshot.prices).length} prices · ${history.timestamps.length} price points · ${gggLeague?.exchange?.pairs?.length || 0} completed exchange pairs · boss market coverage ${coverage.priced}/${coverage.total}`);
    if (coverage.missing.length) {
      const preview = coverage.missing.slice(0, 20).map((item) => `${item.item}${item.variant ? ` (${item.variant})` : ""}`).join(", ");
      console.warn(`${name}: ${coverage.missing.length} boss-market item(s) unpriced: ${preview}${coverage.missing.length > 20 ? `, +${coverage.missing.length - 20} more` : ""}`);
    }
  }
  await writeJson(join(OUT, "index.json"), { schemaVersion: POE2_SCHEMA_VERSION, generatedAt: new Date().toISOString(), leagues });
}

/* Generate into staging, gate the result, promote only on success.

   A failed snapshot must fail the workflow. GitHub Pages keeps the previous
   successful deployment when a run fails, so exiting non-zero leaves the last
   good site up; exiting 0 on a half-built tree replaces it with the damage. */
async function run() {
  const cleanup = await clearAbandonedStages(FINAL_OUT);
  if (cleanup.recovered) console.log(`Recovered the previous PoE 2 dataset after an interrupted promotion.`);
  if (cleanup.removed) console.log(`Cleared ${cleanup.removed} abandoned staging director(ies).`);
  const stage = await createStage(FINAL_OUT);
  OUT = stage.dir;
  try {
    await main();
    const report = await validatePoe2(OUT, { previousDir: FINAL_OUT, report: new QualityReport({ game: "poe2" }) });
    await writeJson(join(OUT, "quality.json"), report.toJSON());
    report.print();
    if (!report.publishable) {
      throw new Error(`PoE 2 dataset failed ${report.failures.length} publication gate(s) — not publishing`);
    }
    await stage.promote();
    console.log(`Promoted the staged PoE 2 dataset to ${FINAL_OUT}.`);
  } catch (error) {
    await stage.discard();
    throw error;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
