/* Snapshots PoE 1 market data into public/data/poe1/ so the site can run on static
   hosting (GitHub Pages) without a CORS proxy.
   Run: npm run data:poe1

   Sources, best first: GGG's hourly Currency Exchange digest (completed
   trades), then poe.ninja, then poe.watch. `getPriceMap` states the full rule.

   poe.ninja moved its API (docs: https://poe.ninja/docs/api). This script
   adapts at runtime:
     leagues:  /poe1/api/economy/leagues  (fallback: index-state, legacy)
     prices:   exchange overview + stash item overview (fallbacks: the stash
               currency overview, then the legacy itemoverview)
     history:  legacy itemhistory if alive; otherwise the script accumulates
               its OWN history by reading the previous deployment's data and
               appending today's prices (selfhistory.json).

   Every self-history point also carries the divine rate at that moment, which
   is what lets the site tell "this scarab got more valuable" apart from "chaos
   deflated under it" (rateHistory + the change*R fields below).             */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {
  watchLeagues, matchWatchLeague, fetchWatchLeague, watchCategoryItems, watchStatus,
  fetchWatchBeta,
} from "./sources/poewatch.mjs";
import {
  fetchGggExchange, fetchGggPriceLookback, mergeGggLookback,
} from "./sources/ggg-exchange.mjs";
import {
  GEM_HISTORY_CAP, GEM_HISTORY_HOURLY_HOURS, HOUR_MS, RATE_HISTORY_CAP, SELF_HISTORY_CAP,
  applySelfChanges, buildRateHistory, historyOrigin, historySourceOf, mergeBackfill,
  SIGNED_HISTORY_KEYS, mergeHistorySeedDocument, mergeSelfHistory, normalizePoint, ratePointsFrom,
  rateSane, rebuildDerivedHistory, sanitizeCarried, stitchHistory, thinPoints,
} from "./history.mjs";
import { CATEGORIES, CATEGORY_BY_KEY, FETCHED_CATEGORIES } from "../../src/games/poe1/catalogue/categories.js";
import {
  CROSS_CHECK, EXCHANGE_TYPES, LEGACY_TYPES, STASH_CURRENCY_TYPES, STASH_ITEM_TYPES,
} from "./endpoints.mjs";
import { nameIndex } from "../shared/repoe.mjs";
import { enrichFromRepoe } from "./enrich.mjs";
import {
  changesFromSparkline, chaosDivisor, currencyEvidence, evidenceFrom, exchangeNamesById,
  exchangeRows, isBaseVariant, normKey, slugToName,
} from "./sources/ninja.mjs";
import { GCP_NAME, VAAL_ORB_NAME, computeGems, parseVariant } from "../../src/games/poe1/features/gems/gems.js";
import {
  applyRenames, breakingNames, describeDiff, diffCatalogue, identityKind, stableId, unresolvedSeries,
} from "../../src/games/poe1/catalogue/catalogue.js";
import { classificationCoverage, isGggCategory } from "../../src/games/poe1/catalogue/classify.js";
import { describeSpreads } from "../../src/games/poe1/features/pricing/priceCheck.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  QualityReport, USER_AGENT, clearAbandonedStages, createStage, roundPrice, writeJsonFile,
} from "../shared/dataset.mjs";
import { POE1_SCHEMA_VERSION, checkCuratedCoverage, validatePoe1 } from "./validate.mjs";

const NINJA = "https://poe.ninja";
/* Where the run publishes to, and where it actually writes.

   `OUT` is a staging directory for the length of a run and only becomes the
   published tree once every gate has passed. Generating in place makes failing
   safely impossible: by the time you know a run is bad you have already
   overwritten the thing you would have fallen back to. */
const FINAL_OUT = process.env.DATA_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data", "poe1");
let OUT = FINAL_OUT;
const HEADERS = { "User-Agent": USER_AGENT };
let localHistorySeeds = new Map();
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.FETCH_TIMEOUT_MS) || 30_000);
const HISTORY_LEAGUES = 2;   // ninja backfill only for the first N leagues (politeness)
const DELAY_MS = 300;
const GGG_THIN_PRICE_MAX_AGE_HOURS = Math.max(1, Number(process.env.GGG_THIN_PRICE_MAX_AGE_HOURS) || 24);

/* Retention windows, the day axis, thinning, merging and the change windows all
   live in ./history.mjs — they are pure, and recovery tools have to reach them
   without importing this file, which takes a snapshot the moment it loads.
   Re-exported here because the regression suite drives them through this
   module's public surface. */
export {
  applySelfChanges, historyOrigin, mergeBackfill, mergeSelfHistory, stitchHistory, thinPoints,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
async function tryJson(url) { try { return await getJson(url); } catch { return null; } }

const median = (arr) => {
  const s = arr.filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* ---------- leagues ---------- */
async function getLeagues() {
  const current = [];
  const previous = [];
  // Documented: plain array [{id, name}], first = current challenge league
  const a = await tryJson(`${NINJA}/poe1/api/economy/leagues`);
  if (Array.isArray(a) && a.length && a[0].id) {
    console.log("Current leagues via /poe1/api/economy/leagues");
    for (const l of a) current.push({ name: l.name || l.id, params: [l.id, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || l.start || null });
  }
  // index-state carries the previous ("old") economy leagues, and doubles as
  // a fallback for the current ones
  const b = await tryJson(`${NINJA}/poe1/api/data/index-state`) || await tryJson(`${NINJA}/api/data/getindexstate`);
  if (b) {
    if (!current.length) {
      for (const l of b.economyLeagues || []) current.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "current", start: l.startAt || l.startDate || null });
    }
    for (const l of b.oldEconomyLeagues || []) {
      previous.push({ name: l.name, params: [l.url, l.name].filter(Boolean), group: "previous" });
    }
    if (previous.length) console.log(`Previous leagues via index-state: ${previous.map((l) => l.name).join(", ")}`);
  }
  const seen = new Set();
  const all = [...current, ...previous].filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true)));
  if (!all.length) throw new Error("Could not fetch league list from any known endpoint");
  return all;
}

/* Publish the stable key beside the display name.

   History is keyed by display name and stays that way for now — every consumer
   reads it, and re-keying the whole contract at once would break all of them
   for a benefit nothing yet uses. What the migration to stable keys needs is
   the map from one to the other, recorded at the moment both are known. Once
   two consecutive snapshots carry it, a name-keyed series can be moved to its
   stable key with evidence rather than by guesswork.

   `identity` says how the key was obtained, because a Metadata path GGG stated
   and a path recovered by matching names are not the same claim. */
function attachStableKeys(items) {
  for (const item of items || []) {
    const key = stableId(item);
    if (key) item.key = key;
    if (!item.identity && key) item.identity = identityKind(key);
  }
  return items;
}

/* What to credit in the UI. The site says where its numbers came from, and
   that claim has to track what actually answered on the day — poe.watch can be
   down, or thin on a category, and saying "poe.watch" then would be a lie. */
function sourceLabel({ ggg = 0, watch = 0, ninja = 0 } = {}) {
  // Listed in precedence order, so the credit line reads as the sourcing rule.
  const sources = [];
  if (ggg) sources.push("GGG Currency Exchange");
  if (ninja) sources.push("poe.ninja");
  if (watch) sources.push("poe.watch");
  if (sources.length < 2) return sources[0] || null;
  return `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}`;
}

function mergeGggCategory(fallbackItems, ggg, key, divineRate) {
  const official = (ggg?.items || []).filter((item) => isGggCategory(item, key));
  const byName = new Map((fallbackItems || []).map((item) => [item.name, { ...item }]));
  for (const item of official) {
    const previous = byName.get(item.name) || {};
    byName.set(item.name, {
      ...previous,
      ...item,
      divineValue: divineRate > 0 ? item.chaosValue / divineRate : 0,
    });
  }
  return {
    items: [...byName.values()],
    officialCount: official.length,
    fallbackCount: [...byName.keys()].filter((name) => !ggg?.prices?.[name]).length,
  };
}

/* The GGG digest is completed trades, so it has absolute priority over both
   listing feeds wherever it quotes a name. poe.ninja outranks poe.watch below
   it, which is what settles non-currency items between those two. */
function mergeGggPriceMap(priceMap, ggg, leagueParam) {
  if (!ggg || !Object.keys(ggg.prices || {}).length) return priceMap;
  const out = priceMap || { prices: {}, leagueParam, divisor: 1, counts: {}, categories: 0 };
  for (const [name, entry] of Object.entries(ggg.prices)) {
    const previous = out.prices[name];
    out.prices[name] = {
      ...(previous || {}),
      ...entry,
      ...(previous?.v ? { v: previous.v } : {}),
    };
    // GGG supersedes whatever supplied the name before, so a `source` left over
    // from poe.watch would now be a lie on screen.
    delete out.prices[name].source;
  }
  out.counts = { ...(out.counts || {}), "GGG Currency Exchange": Object.keys(ggg.prices).length };
  out.categories = Object.keys(out.counts).length;
  return out;
}

/* ---------- extra exchange categories (same features as scarabs) ----------
   Described once in src/games/poe1/catalogue/categories.js, which the app reads too, so adding a
   family never means editing the same list in two places. */
const EXTRA_CATEGORIES = FETCHED_CATEGORIES;

async function getExchangeCategory(lgParams, type, nameRe, divisor = null) {
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${encodeURIComponent(type)}`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j, nameRe, divisor);
      if (adapted.items.length) return adapted;
    }
    await sleep(DELAY_MS);
  }
  return null;
}

/* ---------- prices ---------- */
async function getScarabPrices(lgParams, divisor = null, watch = null) {
  // 1) documented new home: exchange overview (different shape)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const adapted = adaptExchange(j, /scarab/i, divisor);
      if (adapted.items.length) {
        console.log(`  prices via exchange overview (league=${p}, ${adapted.items.length} items)`);
        return { ...adapted, source: "exchange", leagueParam: p };
      }
      // Nothing matched — dump structure so the workflow log shows what came back
      console.log(`  exchange overview answered for ${p} but 0 items matched. Diagnostics:`);
      console.log(`    lines: ${j.lines.length}, core.items: ${(j.core?.items || []).length}, primary: ${j.core?.primary}, secondary: ${j.core?.secondary}`);
      console.log(`    sample line: ${JSON.stringify(j.lines[0]).slice(0, 400)}`);
      console.log(`    sample core.items[0]: ${JSON.stringify((j.core?.items || [])[0]).slice(0, 400)}`);
    }
    await sleep(DELAY_MS);
  }
  // 2) poe.watch, when poe.ninja had nothing. Its scarab category is a single
  //    flat array with listing counts attached, so there is nothing to
  //    calibrate and nothing to disambiguate.
  if (watch?.rows?.length) {
    const items = watchCategoryItems(watch.rows, /scarab/i, watch.rate, ["scarab"], watch.exchange);
    if (items.length) {
      console.log(`  prices via poe.watch (${items.length} scarabs)`);
      return { items, source: "watch", leagueParam: lgParams[0], exchangeDivineRate: watch.rate };
    }
  }
  // 3) legacy itemoverview (kept alive via redirects historically)
  for (const p of lgParams) {
    const j = await tryJson(`${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=Scarab`);
    if (j && Array.isArray(j.lines) && j.lines.length) {
      const items = j.lines.filter((l) => l.name).map((l) => ({
        id: l.id, name: l.name,
        chaosValue: l.chaosValue ?? 0,
        divineValue: l.divineValue ?? 0,
        ...changesFromSparkline(l.sparkline || l.sparkLine),
      }));
      if (items.length) {
        console.log(`  prices via legacy itemoverview (league=${p}, ${items.length} items)`);
        return { items, source: "legacy", leagueParam: p };
      }
      console.log(`  legacy itemoverview answered for ${p} but yielded 0 usable items`);
    }
    await sleep(DELAY_MS);
  }
  return null;
}

async function getNameDictionary(p) {
  const dict = {};
  for (const t of ["Currency", "Fragment"]) {
    const j = await tryJson(`${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(p)}&type=${t}`);
    await sleep(DELAY_MS);
    for (const l of (j?.lines || [])) {
      const n = l.currencyTypeName || l.name;
      if (n) dict[normKey(n)] = n;
    }
  }
  return dict;
}

function adaptExchange(j, nameRe = /scarab/i, divisor = null) {
  const core = j.core || {};
  const coreItems = core.items || [];
  const itemsById = {};
  for (const it of coreItems) {
    if (it.id != null) itemsById[it.id] = it;
    if (it.itemId != null) itemsById[it.itemId] = it;
  }
  const findId = (needle) => {
    for (const it of coreItems) if ((it.name || "").toLowerCase() === needle) return it.id ?? it.itemId;
    return null;
  };
  const chaosId = findId("chaos orb");
  const divineId = findId("divine orb");
  const rates = core.rates || {};

  // rates[x] = units of x per 1 primary. When chaos itself is the primary
  // (observed for PoE1 scarabs), primaryValue is already the chaos price.
  const rChaos = core.primary === chaosId ? (rates[chaosId] ?? 1) : rates[chaosId];

  const raw = j.lines
    .map((l) => {
      const meta = itemsById[l.id] || itemsById[l.itemId] || null;
      // core.items only carries the reference currencies; scarab names live
      // in the line id as a slug (e.g. "divination-scarab-of-pilfering").
      const name = (meta && meta.name) || l.name || slugToName(l.id ?? l.itemId);
      return { line: l, name };
    })
    .filter((x) => x.name && nameRe.test(x.name));
  if (!raw.length) return { items: [] };

  const convert = (mult) => raw.map(({ line }) => Math.max(0, (line.primaryValue ?? 0) * mult));
  let chaosVals;
  if (divisor && divisor > 0) {
    // Explicit calibration from the Currency exchange: primaryValue is quoted
    // in the primary reference currency, so dividing by chaos's own price in
    // that currency yields chaos. Exact, and works whatever the primary is.
    chaosVals = convert(1 / divisor);
  } else if (!rChaos || rChaos === 1) {
    chaosVals = convert(1);
  } else {
    // Last-ditch heuristic for when we could not find Chaos Orb at all. This
    // guesses the direction of core.rates and can be off by rChaos^2, so the
    // calibrated path above is always preferred.
    const a = convert(rChaos);
    const b = convert(1 / rChaos);
    chaosVals = (median(a) >= 0.05 && median(a) <= 50000) ? a : b;
  }

  // Divine rate in chaos. With a calibration divisor this is just divine's
  // own quote converted the same way; otherwise fall back to guessing.
  let divineRate = null;
  if (divisor && divisor > 0 && rates[divineId] != null) {
    const c = rates[divineId] / divisor;
    if (c >= 20 && c <= 20000) divineRate = c;
  }
  if (divineRate == null && rChaos != null && rates[divineId] != null && rates[divineId] !== 0) {
    for (const c of [rChaos / rates[divineId], rates[divineId] / rChaos]) {
      if (c >= 20 && c <= 20000) { divineRate = c; break; }
    }
  }

  const items = raw.map(({ line, name }, i) => ({
    id: line.id ?? line.itemId ?? name,
    name,
    chaosValue: roundPrice(chaosVals[i]) ?? 0,
    divineValue: divineRate ? (chaosVals[i] ?? 0) / divineRate : 0,
    ...changesFromSparkline(line.sparkline || line.sparkLine),
  }));
  return { items, exchangeDivineRate: divineRate ?? undefined };
}

/* ---------- broad price map (boss profitability) ----------
   One name -> price lookup covering everything a boss can drop or cost.

   Two documented endpoint families (https://poe.ninja/docs/api):

     exchange/current/overview   bulk-traded things — currency, FRAGMENTS,
                                 scarabs, astrolabes, omens, embers. Lines
                                 carry `primaryValue`, not chaos.
     stash/current/item/overview uniques, gems, div cards, maps. Lines
                                 carry `chaosValue` directly.

   The exchange endpoint is the one that bites. Its `primaryValue` is
   "price expressed in the primary reference currency", and that currency
   is not always chaos — get the direction wrong and every fragment is off
   by the chaos:primary ratio. The docs don't define the sign of
   `core.rates`, so rather than guess we calibrate on Chaos Orb itself:

       chaos price = primaryValue / primaryValue(Chaos Orb)

   If chaos IS the primary, its own price is 1 and the divisor is a no-op.
   Either way the arithmetic is exact rather than heuristic, and the run
   logs Chaos Orb's computed price as a self-check. */

/* Which endpoint serves what, which types are enabled, and why the documented
   rest is skipped, all live in ./endpoints.mjs. Keeping the documented list and
   the consumed subset in one registry is what makes "is this missing on
   purpose?" answerable without archaeology. */

const exchUrl = (p, t) => `${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(p)}&type=${t}`;
const stashItemUrl = (p, t) => `${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(p)}&type=${t}`;
const stashCurrUrl = (p, t) => `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(p)}&type=${t}`;
const legacyUrl = (p, t) => `${NINJA}/api/data/itemoverview?league=${encodeURIComponent(p)}&type=${t}`;

/* Resolve the league param that answers, and the chaos calibration, once —
   every exchange-shaped fetch for that league then converts identically. */
async function getExchangeContext(lgParams) {
  for (const p of lgParams) {
    const currency = await tryJson(exchUrl(p, "Currency"));
    await sleep(DELAY_MS);
    if (!exchangeRows(currency).length) {
      console.log(`  league param "${p}": Currency exchange returned nothing, trying next`);
      continue;
    }
    const divisor = chaosDivisor(currency);
    if (divisor == null) {
      console.log("  WARNING: Chaos Orb not found in the Currency exchange — falling back to heuristic conversion");
    } else {
      const names = exchangeNamesById(currency);
      console.log(`  exchange primary is ${names[currency.core?.primary] || currency.core?.primary || "?"}; chaos divisor ${divisor}`);
    }
    const dict = await getNameDictionary(p);
    if (Object.keys(dict).length) console.log(`  name dictionary: ${Object.keys(dict).length} currency/fragment names`);
    return { leagueParam: p, divisor, currency, dict };
  }
  return null;
}

/* Source precedence, best first. GGG is not in this list — it is merged over
   the finished map afterwards and outranks everything here, because it is the
   only source quoting completed trades.

     0  poe.ninja exchange / stash items — the primary. The exchange covers
        everything fungible; the stash item overview covers everything else
        in the game, which is the half GGG does not price at all.
     1  poe.ninja stash currency  (gap-fill only)
     2  poe.watch — the fallback. It carries names poe.ninja does not list,
        including the unidentified markets the boss tab depends on, and it
        answers when poe.ninja is down or thin on a category.
     3  the pre-migration legacy endpoint

   poe.watch keeps its whole entry where it wins (listing counts, `wid`, its
   own exchange figures); where poe.ninja wins, poe.watch's number is not
   thrown away either — it is recorded as `alt.watch` for the disagreement
   check below. */
const RANK = { ninja: 0, ninjaStashCurrency: 1, watch: 2, legacy: 3 };

async function getPriceMap(lgParams, ctx, watch = null) {
  const p = ctx ? ctx.leagueParam : lgParams[0];
  if (!p) return null;
  const div = (ctx?.divisor) || 1;

  const acc = {};
  const counts = {};
  const missed = [];
  // rank 0 beats rank 1 beats rank 2: a name already priced by a
  // direct-chaos source is never re-priced from a converted one.
  // `variant` is poe.ninja's roll label ("Life", "ES", "1 Prefix, 2 Suffix").
  // Kept per name so a drop line that identifies WHICH variant it is can be
  // priced exactly, instead of falling back to the floor across all of them.
  /* Evidence accumulates across the rows that stand behind one quote: listing
     counts sum, the deepest traded market wins the volume figure, and item
     state is taken from the preferred (base-variant) row, since that is the
     form being priced. */
  const mergeEvidence = (into, ev, preferred) => {
    if (!ev) return into;
    const out = into || {};
    for (const key of ["sid", "did", "bt"]) if (out[key] == null && ev[key] != null) out[key] = ev[key];
    if (ev.lc) out.lc = (out.lc || 0) + ev.lc;
    if (ev.cnt) out.cnt = (out.cnt || 0) + ev.cnt;
    if (ev.vol && !(out.vol >= ev.vol)) {
      out.vol = ev.vol;
      if (ev.mvc) out.mvc = ev.mvc;
      if (ev.mvr) out.mvr = ev.mvr;
    }
    if (preferred) for (const key of ["cor", "lk", "gl", "gq"]) if (ev[key] != null) out[key] = ev[key];
    return out;
  };
  const add = (rank, name, chaos, preferred, variant = null, evidence = null) => {
    if (!name || !(chaos > 0)) return;
    const e = acc[name];
    if (e && e.rank < rank) return;
    if (!e || e.rank > rank) {
      acc[name] = { rank, all: [chaos], base: preferred ? [chaos] : [], byVariant: {}, ev: mergeEvidence(null, evidence, preferred) };
      if (variant) acc[name].byVariant[variant] = chaos;
      return;
    }
    e.all.push(chaos);
    if (preferred) e.base.push(chaos);
    e.ev = mergeEvidence(e.ev, evidence, preferred);
    // Same variant listed twice (different links, say): keep the cheaper.
    if (variant && (e.byVariant[variant] == null || chaos < e.byVariant[variant])) e.byVariant[variant] = chaos;
  };
  const tally = (t, n) => { if (n) counts[t] = (counts[t] || 0) + n; else missed.push(t); };

  // 1. exchange — the bulk market, and the documented home for everything
  //    fungible. Needs the chaos calibration.
  for (const t of EXCHANGE_TYPES) {
    const j = (t === "Currency" && ctx?.currency) ? ctx.currency : await tryJson(exchUrl(p, t));
    if (!(t === "Currency" && ctx?.currency)) await sleep(DELAY_MS);
    const rows = exchangeRows(j, ctx?.dict, { divisor: div });
    for (const r of rows) add(RANK.ninja, r.name, r.primaryValue / div, true, null, r.evidence);
    tally(`exch:${t}`, rows.length);
  }

  // 2. stash items — uniques, gems, maps; priced per listing, already chaos
  for (const t of STASH_ITEM_TYPES) {
    const j = await tryJson(stashItemUrl(p, t));
    await sleep(DELAY_MS);
    const lines = (j && Array.isArray(j.lines)) ? j.lines : [];
    let n = 0;
    for (const l of lines) {
      const chaos = l.chaosValue ?? l.chaosEquivalent;
      if (!l.name || !(chaos > 0)) continue;
      add(RANK.ninja, l.name, chaos, isBaseVariant(t, l), l.variant || null, evidenceFrom(l));
      // Maps are labelled inconsistently — the tier 17s group under
      // "Nightmare Map" and baseType isn't always the display name.
      if (/Map$/.test(t) && l.baseType && l.baseType !== l.name) add(RANK.ninja, l.baseType, chaos, true, null, evidenceFrom(l));
      n++;
    }
    tally(t, n);
    if (t === "Map" && n) {
      const t17 = lines
        .filter((l) => /citadel|fortress|sanctuary|ziggurat|abomination|nightmare/i.test(`${l.name} ${l.baseType || ""}`))
        .map((l) => `${l.name}${l.baseType && l.baseType !== l.name ? ` [${l.baseType}]` : ""}${l.variant ? ` (${l.variant})` : ""} ${Math.round(l.chaosValue)}c`);
      console.log(`    tier 17 map listings: ${t17.length ? t17.join(", ") : "none matched"}`);
    }
  }

  // 3. stash currency — gap-fill only, for names the exchange didn't carry
  for (const t of STASH_CURRENCY_TYPES) {
    const j = await tryJson(stashCurrUrl(p, t));
    await sleep(DELAY_MS);
    /* The currency overview publishes identity alongside the price:
       `currencyDetails` carries the trade id and icon per name, and each line
       carries both sides of the book. Both were being dropped, which is why a
       currency row could not say how deep either side was. */
    const details = new Map();
    for (const d of (j?.currencyDetails || [])) if (d?.name) details.set(d.name, d);
    let n = 0, filled = 0;
    for (const l of (j?.lines || [])) {
      const name = l.currencyTypeName || l.name;
      const chaos = l.chaosEquivalent ?? l.chaosValue;
      if (!name || !(chaos > 0)) continue;
      if (!acc[name]) filled++;
      add(RANK.ninjaStashCurrency, name, chaos, true, null, currencyEvidence(l, details.get(name)));
      n++;
    }
    tally(`stash:${t}`, n);
    if (filled) console.log(`    stash ${t} filled ${filled} name(s) the exchange did not list`);
  }

  // 3b. cross-family retry — a type the docs place in one family sometimes
  //     only answers from the other.
  for (const t of CROSS_CHECK) {
    if (counts[t]) continue;
    const j = await tryJson(exchUrl(p, t));
    await sleep(DELAY_MS);
    const rows = exchangeRows(j, ctx?.dict, { divisor: div });
    if (!rows.length) continue;
    for (const r of rows) add(RANK.ninja, r.name, r.primaryValue / div, true, null, r.evidence);
    counts[`exch:${t}`] = rows.length;
    console.log(`    ${t} answered from the exchange, not the stash item overview`);
  }

  // 4. legacy, for anything the documented families never answered
  for (const t of LEGACY_TYPES) {
    if (counts[t] || counts[`exch:${t}`]) continue;
    const j = await tryJson(legacyUrl(p, t));
    await sleep(DELAY_MS);
    let n = 0;
    for (const l of (j?.lines || [])) {
      if (l.name && l.chaosValue > 0) { add(RANK.legacy, l.name, l.chaosValue, isBaseVariant(t, l), null, evidenceFrom(l)); n++; }
    }
    if (n) counts[`legacy:${t}`] = n;
  }

  /* poe.ninja's floor, captured before poe.watch is merged in so it is
     unambiguously poe.ninja's own number. The floor, not the typical figure:
     boss lines are quoted from `lo`, so comparing anything else would flag
     items over a number the site never shows. */
  const ninjaFloor = {};
  for (const [name, e] of Object.entries(acc)) {
    const pick = e.base.length ? e.base : e.all;
    if (pick.length) ninjaFloor[name] = Math.min(...pick);
  }
  /* poe.watch runs last and now ranks last: add() keeps whatever sits at a
     better rank, so this fills the names poe.ninja did not carry and leaves
     the rest alone. The unidentified markets land here uncontested —
     poe.ninja has no "Unidentified X" rows at all — which is what keeps the
     boss tab's unidentified-first rule working under poe.ninja primacy. */
  if (watch?.prices) {
    let n = 0;
    let filled = 0;
    for (const [name, e] of Object.entries(watch.prices)) {
      if (!(e.c > 0)) continue;
      if (!acc[name]) filled++;
      add(RANK.watch, name, e.c, true);
      n++;
    }
    if (n) counts["poe.watch"] = n;
    if (filled) console.log(`    poe.watch filled ${filled} name(s) poe.ninja did not price`);
  }

  if (!Object.keys(acc).length) return null;

  const midLow = midLowOf;
  const prices = {};
  for (const [name, e] of Object.entries(acc)) {
    // A poe.watch entry already resolved its own spread and listing count over
    // the full row set; re-deriving them from the single value added above
    // would throw that away. No roll variants to graft on here any more: a
    // name poe.ninja split by roll is a name poe.ninja priced, so it never
    // reaches poe.watch's branch.
    const w = (e.rank === RANK.watch) ? watch?.prices?.[name] : null;
    if (w) {
      // `source` marks the exception, not every entry: absence means GGG or
      // poe.ninja. The UI badges the line so a price sourced differently from
      // everything around it says so.
      prices[name] = { ...w, source: "poe.watch" };
      continue;
    }
    // All three bases must describe the SAME population: the item as a boss
    // drops it. poe.ninja's "variants" mix two unrelated things — genuine roll
    // variants (Atziri's Splendour Armour vs ES/Eva) and post-drop states a
    // boss never hands you (a corrupted 21/20 gem, a 6-linked unique). Spanning
    // e.all let the second kind into lo/hi, which is how a level-1 Pacifism
    // Support worth about a divine showed a "best roll" of 482 divine — that is
    // the corrupted level 21 copy, not the gem that drops.
    // Where base variants exist they ARE the drop; where none do (every listing
    // carries a roll variant) the full spread is the real spread.
    const pick = e.base.length ? e.base : e.all;
    // ...and when every listing is a roll variant, the drop is a RANDOM one, so
    // the floor is the honest quote, not the middle. poe.ninja's variant list
    // isn't weighted by how often each roll occurs, and the dear variants are
    // dear precisely because they are the rare rolls — a median over the list
    // reads as if half your drops hit them. Atziri's Splendour is the case in
    // point: it sells for single-digit chaos, but its list runs from that to
    // several hundred, and the median put it over 40c inside Uber Atziri's
    // pool, where it carries 39% of the loot share.
    const typical = e.base.length ? midLow(pick) : Math.min(...pick);
    const c = roundPrice(typical);
    // No usable quote means the name is left out. Publishing it at zero would
    // read as a free item to every consumer downstream.
    if (c == null) continue;
    prices[name] = {
      c,
      lo: roundPrice(Math.min(...pick)) ?? c,
      hi: roundPrice(Math.max(...pick)) ?? c,
      n: pick.length,
      ...(e.ev || {}),
    };
    // Only worth carrying when there is a choice to make. One variant is just
    // the base price under another name.
    const vs = Object.keys(e.byVariant || {});
    if (vs.length > 1) {
      const v = {};
      for (const k of vs) { const rounded = roundPrice(e.byVariant[k]); if (rounded != null) v[k] = rounded; }
      prices[name].v = v;
    }
  }

  /* Cross-feed check, for this log only. poe.ninja wins either way now, so a
     disagreement changes no number and has no business on a price entry —
     writing `alt` and `spread` into every name only bloated the file the
     browser downloads. It stays here because a feed that starts pricing a
     different item state is otherwise invisible for weeks. */
  const pairs = [];
  for (const name of Object.keys(prices)) {
    const wlo = watch?.prices?.[name]?.lo;
    if (wlo > 0 && ninjaFloor[name] > 0) pairs.push({ name, watch: wlo, ninja: ninjaFloor[name] });
  }
  const spreads = describeSpreads(pairs);
  if (spreads.length) {
    console.log(`    feeds disagree on ${spreads.length} name(s) (poe.ninja is used either way):`);
    for (const line of spreads) console.log(`      ${line}`);
  }
  if (!prices["Chaos Orb"]) prices["Chaos Orb"] = { c: 1, lo: 1, hi: 1, n: 1 };

  const chaosCheck = prices["Chaos Orb"].c;
  if (Math.abs(chaosCheck - 1) > 0.02) {
    console.log(`    WARNING: Chaos Orb priced at ${chaosCheck}c — exchange calibration looks wrong`);
  }
  if (missed.length) console.log(`    no data for: ${missed.join(", ")}`);
  console.log(`    sources: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  return { prices, leagueParam: p, divisor: div, counts, categories: Object.keys(counts).length };
}

/* Lower-middle median: with an even number of listings (a unique with two
   variants) the shared median() helper returns the dearer one, biasing every
   EV upward. Cheaper side wins. */
function midLowOf(arr) {
  const a = arr.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
  return a.length ? a[Math.ceil(a.length / 2) - 1] : 0;
}

/* Every item the boss tab references, checked against what we actually got.
   Anything listed here shows "no price" in the UI. For each miss we also
   suggest the closest names that ARE priced, which distinguishes the two
   causes: a spelling that drifted (fixable in bossData.js) versus an item
   poe.ninja genuinely doesn't list (nothing to fix). */
function suggestNames(missing, allNames, k = 3) {
  const tok = (x) => new Set(String(x).toLowerCase().match(/[a-z0-9]+/g) || []);
  const want = tok(missing);
  if (!want.size) return [];
  const scored = [];
  for (const n of allNames) {
    const have = tok(n);
    let shared = 0;
    for (const t of want) if (have.has(t)) shared++;
    if (!shared) continue;
    scored.push([shared / Math.max(want.size, have.size), n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.filter(([sc]) => sc >= 0.3).slice(0, k).map(([, n]) => n);
}

async function reportUnpricedBossItems(prices, leagueName = "", detailed = true) {
  let mod;
  try {
    mod = {
      data: await import("../../src/games/poe1/features/bosses/bossData.js"),
      calc: await import("../../src/games/poe1/features/bosses/bossProfit.js"),
      delve: await import("../../src/games/poe1/features/delve/delveData.js"),
    };
  } catch (e) {
    console.log(`    (boss item check skipped: ${e.message})`);
    return;
  }
  const resolve = mod.calc.makeResolver(prices, { divineRate: prices["Divine Orb"]?.c || 0 });
  const missing = new Map();   // item name -> where it appears
  const declared = new Set();  // priced from bossData's fallback, not the API
  const varOk = [];            // drop lines priced on a specific roll variant
  const varMiss = [];          // lines that named a variant nothing matched
  // Every fossil the Delve tab prices. A fossil that stops resolving takes a
  // biome average down with it silently, so it is worth a line in the log —
  // but only one line: fossil names are stable, so a miss is a thin economy,
  // not a spelling that drifted, and the per-item "closest priced name" hints
  // the boss items get would be 20 lines of noise.
  const fossilMisses = mod.delve.FOSSILS
    .filter((f) => !(prices[f.name]?.c > 0))
    .map((f) => f.name);
  for (const b of [...mod.data.BOSSES, ...mod.delve.DELVE_BOSSES]) {
    const c = mod.calc.computeBoss(b, resolve);
    for (const l of c.entryLines) {
      if (l.fallback) declared.add(`${l.item}${l.fallbackAge != null ? ` (${l.fallbackAge}d old)` : ""}`);
      else if (!l.found) missing.set(l.item, `entry: ${b.name}`);
    }
    for (const l of c.dropLines) {
      if (l.variant) varOk.push(`${l.item} [${l.variant}] ${Math.round(l.unit)}c`);
      else if (l.variantMissed) {
        // The item HAS variants and this line claimed one, but the strings
        // didn't line up — so the line is quoting the name-wide price. This is
        // the only way to see that from outside, so print BOTH sides and let
        // the mapping be corrected in bossData.
        const vs = Object.keys(prices[l.item]?.v || {});
        varMiss.push(`${b.name} / "${l.label}" wanted "${mod.calc.variantHint({ label: l.label })}" — ${l.item} has: ${vs.join(" | ")}`);
      }
      if (l.fallback) declared.add(`${l.item}${l.fallbackAge != null ? ` (${l.fallbackAge}d old)` : ""}`);
      else if (!l.found && l.qty > 0 && !missing.has(l.item)) missing.set(l.item, b.name);
    }
  }
  if (declared.size && detailed) {
    console.log(`    ${leagueName ? leagueName + ": " : ""}priced from a declared fallback, not the API (${declared.size}): ${[...declared].sort().join(", ")}`);
  }
  const tag = leagueName ? `${leagueName}: ` : "";
  if (detailed) {
    if (varOk.length) console.log(`    ${tag}priced on a specific roll variant (${varOk.length}): ${varOk.join(", ")}`);
    if (varMiss.length) {
      console.log(`    ${tag}${varMiss.length} drop line(s) name a variant that did NOT match — each is using the name-wide price:`);
      for (const m of varMiss) console.log(`      ${m}`);
    }
    // Any priced item carrying variants is a candidate for splitting a drop
    // line, so list them once: it is the only view of what poe.ninja actually
    // splits on, and guessing those strings blind is how they drift.
    const withVariants = Object.entries(prices)
      .filter(([, e]) => e.v && Object.keys(e.v).length > 1)
      .map(([n, e]) => `${n} (${Object.keys(e.v).length})`);
    if (withVariants.length) {
      console.log(`    ${tag}${withVariants.length} priced item(s) have roll variants: ${withVariants.slice(0, 40).join(", ")}${withVariants.length > 40 ? ", …" : ""}`);
    }
  }
  if (fossilMisses.length) {
    console.log(`    ${tag}${fossilMisses.length}/${mod.delve.FOSSILS.length} delve fossils unpriced: ${fossilMisses.join(", ")}`);
  } else {
    console.log(`    ${tag}delve fossils — all ${mod.delve.FOSSILS.length} priced`);
  }
  if (!missing.size) {
    console.log(`    ${tag}boss items — every referenced name resolved to a price`);
    return;
  }
  // Only the current league gets the full breakdown. Old and hardcore leagues
  // legitimately don't trade half these items, and printing 50 lines each just
  // buries the one list that matters.
  if (!detailed) {
    console.log(`    ${tag}${missing.size} boss item(s) unpriced (expected — thin economy; rerun with the current league for detail)`);
    return;
  }
  const names = Object.keys(prices);
  console.log(`    ${tag}boss items with NO PRICE (${missing.size}) — closest priced names alongside:`);
  for (const [item, where] of [...missing].sort()) {
    const hints = suggestNames(item, names);
    console.log(`      ${item}  [${where}]  ->  ${hints.length ? hints.join(" | ") : "nothing similar is priced"}`);
  }
}

let configuredBossPriceNamesPromise = null;
function configuredBossPriceNames() {
  if (!configuredBossPriceNamesPromise) {
    configuredBossPriceNamesPromise = Promise.all([
      import("../../src/games/poe1/features/bosses/bossData.js"),
      import("../../src/games/poe1/features/delve/delveData.js"),
    ]).then(([data, delve]) => {
      const names = new Set();
      for (const boss of [...data.BOSSES, ...delve.DELVE_BOSSES]) {
        for (const line of boss.entry || []) if (line.item) names.add(line.item);
        for (const group of boss.groups || []) {
          for (const line of group.drops || []) {
            if (!line.item) continue;
            if (line.item.startsWith("@")) {
              for (const item of (data.SYNTHETIC[line.item]?.items || [])) names.add(item);
            } else names.add(line.item);
          }
        }
      }
      return [...names];
    });
  }
  return configuredBossPriceNamesPromise;
}

/* ---------- divine rate ---------- */
async function getDivineRate(lgParam, fallback) {
  const urls = [
    `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(lgParam)}&type=Currency`,
    `${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lgParam)}&type=Currency`,
  ];
  for (const u of urls) {
    const j = await tryJson(u);
    const div = j && (j.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
    if (div?.chaosEquivalent) return div.chaosEquivalent;
    await sleep(DELAY_MS);
  }
  return fallback ?? 185;
}

/* ---------- ninja per-item history (legacy only) ----------

   Answers in `daysAgo`, which only means anything at the moment of the
   request, so it is converted to absolute timestamps here — that is what makes
   the result storable and reusable on later runs.

   It also has to be converted per point rather than per item. Reading day 0 as
   "this item's oldest point" put every item on its own origin, so a scarab
   listed since day 40 sat on top of one listed since day 0 and the set total
   summed two different weeks. */
async function getNinjaHistory(lgParam, type, items, nowMs = Date.now()) {
  const series = {};
  let consecutiveFails = 0;
  for (const it of items) {
    const arr = await tryJson(`${NINJA}/api/data/itemhistory?league=${encodeURIComponent(lgParam)}&type=${encodeURIComponent(type)}&itemId=${it.id}`);
    if (Array.isArray(arr) && arr.length) {
      consecutiveFails = 0;
      const points = arr
        .filter((p) => typeof p.daysAgo === "number" && p.value > 0)
        .sort((x, y) => y.daysAgo - x.daysAgo)
        .map((p) => ({ t: new Date(nowMs - p.daysAgo * 86400000).toISOString(), value: p.value }));
      if (points.length) series[it.name] = points;
    } else if (++consecutiveFails >= 3 && Object.keys(series).length === 0) {
      console.log("  ninja itemhistory appears dead, skipping");
      return {};
    }
    await sleep(DELAY_MS);
  }
  return series;
}

/* ---------- self-accumulated history ---------- */
function pagesBaseUrl() {
  if (process.env.PAGES_BASE_URL) return process.env.PAGES_BASE_URL.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return null;
  const [owner, name] = repo.split("/");
  return `https://${owner}.github.io/${name}`;
}

const HISTORY_SEED_FILE = /(^|-)selfhistory\.json$|(^|-)history\.json$|(^|-)backfill\.json$/;
const historySeedKey = (slug, file) => `${slug}/${file}`;

async function readLocalHistorySeeds() {
  const seeds = new Map();
  try {
    for (const league of await readdir(OUT, { withFileTypes: true })) {
      if (!league.isDirectory()) continue;
      const dir = path.join(OUT, league.name);
      for (const file of await readdir(dir, { withFileTypes: true })) {
        if (!file.isFile() || !HISTORY_SEED_FILE.test(file.name)) continue;
        const text = await readFile(path.join(dir, file.name), "utf8");
        try { JSON.parse(text); } catch { continue; }
        seeds.set(historySeedKey(league.name, file.name), text);
      }
    }
  } catch { /* a clean checkout may have no generated data yet */ }
  return seeds;
}

function localHistorySeed(slug, file) {
  const text = localHistorySeeds.get(historySeedKey(slug, file));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* Deployments before the game split stored league data directly under
   `/data/<league>/`; current deployments scope it under `/data/poe1/`.
   History is accumulated from the previous deployment, so every reader must
   prefer the scoped path and retain the old path only as a migration fallback.
   Missing this on even one reader silently restarts that dataset's curve. */
async function deployedLeagueJson(base, slug, file) {
  const deployed = await tryJson(`${base}/data/poe1/${slug}/${file}`)
    ?? await tryJson(`${base}/data/${slug}/${file}`);
  const seed = localHistorySeed(slug, file);
  return seed ? mergeHistorySeedDocument(file, seed, deployed) : deployed;
}

async function previousPriceSnapshot(slug) {
  const base = pagesBaseUrl();
  if (!base) return null;
  return deployedLeagueJson(base, slug, "prices.json");
}

/* poe.watch's active price is the figure worth having for a boss drop: what is
   clearing rather than the cheapest ask. It is one request per item and lives
   outside the documented API, so it is fetched only for the names the boss and
   Delve tables actually price, only for the primary current league, and never
   for a name the GGG digest already settled with completed trades.

   Since poe.ninja took primacy this reaches only poe.watch's own names. `wid`
   is written by the poe.watch branch of the price map, so a name poe.ninja
   priced has none and is skipped. That is the intent: poe.watch is the
   fallback now, so it sharpens the prices it supplies rather than
   second-guessing the ones it did not.

   A failure at any point leaves the existing figure in place. The listing floor
   is a perfectly good answer; this is an improvement on it, not a dependency. */
const BETA_PRICE_LIMIT = Math.max(0, Number(process.env.WATCH_BETA_LIMIT ?? 300));

async function applyBetaPrices(prices, watchName) {
  if (!watchName || !BETA_PRICE_LIMIT) return 0;
  const wanted = (await configuredBossPriceNames())
    .filter((name) => {
      const e = prices[name];
      return e && e.wid != null && e.exchangeSource !== "GGG";
    })
    .slice(0, BETA_PRICE_LIMIT);
  let applied = 0;
  let failed = 0;
  for (const name of wanted) {
    const entry = prices[name];
    let beta = null;
    try {
      beta = await fetchWatchBeta(entry.wid, watchName);
    } catch {
      failed++;
    }
    await sleep(DELAY_MS);
    if (!beta) continue;
    // Keep what the listings said; the active price replaces the quote, not
    // the evidence behind it.
    entry.listedC = entry.c;
    entry.c = beta.c;
    entry.beta = {
      confidence: beta.confidence, samples: beta.samples,
      asOf: beta.asOf, calculator: beta.calculator,
      ...(beta.lowConfidence ? { lowConfidence: true } : {}),
    };
    applied++;
  }
  console.log(`    poe.watch active price: applied to ${applied}/${wanted.length} configured name(s)`
    + (failed ? `, ${failed} request(s) failed` : ""));
  return applied;
}

/* ---------- catalogue drift ----------
   Categories are fetched by type plus a name regex, so an item GGG adds shows
   up on its own. What needs watching is the other direction: a name that
   leaves a feed takes its accumulated history with it and silently unprices
   any curated boss or Delve line referencing it. Comparing each category
   against the previously deployed file turns that into a line in this log on
   the hour it happens rather than something noticed weeks later. */

async function previousCategoryItems(slug, file) {
  const base = pagesBaseUrl();
  if (!base) return null;
  const previous = await deployedLeagueJson(base, slug, file);
  return Array.isArray(previous?.items) ? previous.items : null;
}

/* Names the curated datasets price by string. A catalogue change touching one
   of these is a breakage; anything else is just news. */
let curatedNamesPromise = null;
function curatedNames() {
  if (!curatedNamesPromise) {
    curatedNamesPromise = Promise.all([configuredBossPriceNames(), import("../../src/games/poe1/features/delve/delveData.js")])
      .then(([boss, delve]) => new Set([...boss, ...delve.FOSSILS.map((f) => f.name)]))
      .catch(() => new Set());
  }
  return curatedNamesPromise;
}

async function trackCatalogue(slug, cat, items, curated) {
  const previous = await previousCategoryItems(slug, cat.file);
  const empty = { added: [], removed: [], renamed: [], suspected: [], breaking: [] };
  if (!previous) {
    console.log(`  ${cat.key}: ${items.length} items, no previous snapshot to compare against`);
    return { key: cat.key, label: cat.label, count: items.length, first: true, ...empty };
  }
  const diff = diffCatalogue(previous, items);
  const breaking = breakingNames(diff, curated);
  console.log(`  ${describeDiff(cat.key, diff)}`);
  if (diff.collisions?.length) {
    console.log(`  ${cat.key}: ${diff.collisions.length} identity collision(s) — reported, never applied`);
  }
  if (breaking.length) {
    console.log(`  ${cat.key}: CURATED NAMES AFFECTED — ${breaking.join(", ")}`
      + " (update the relevant dataset under src/games/poe1/features/)");
  }
  return {
    key: cat.key, label: cat.label, count: diff.count, first: false,
    added: diff.added, removed: diff.removed, renamed: diff.renamed,
    suspected: diff.suspected, breaking,
  };
}

/* Hourly exchange digests contain only that hour's completed trades. Keep a
   recent official boss-item price from the preceding deployment when the new
   hour is empty; the original trade hour travels with the entry, so it cannot
   silently live forever. Returns the number of names restored. */
function carryRecentGggBossPrices(snapshot, previous, names, latestHourISO) {
  if (!snapshot || !previous?.prices || !latestHourISO) return 0;
  const latestMs = Date.parse(latestHourISO);
  if (!isFinite(latestMs)) return 0;
  const prices = {};
  for (const name of names) {
    if (snapshot.prices?.[name]) continue;
    const entry = previous.prices[name];
    if (!(entry?.c > 0) || entry.exchangeSource !== "GGG") continue;
    const marketHour = entry.marketHour || previous.gggHour;
    const marketMs = Date.parse(marketHour);
    const ageHours = (latestMs - marketMs) / HOUR_MS;
    if (!isFinite(ageHours) || ageHours < 0 || ageHours > GGG_THIN_PRICE_MAX_AGE_HOURS) continue;
    prices[name] = {
      ...entry,
      marketHour: new Date(marketMs).toISOString(),
      staleHours: Math.max(1, Math.round(ageHours)),
    };
  }
  mergeGggLookback(snapshot, { prices, items: [] });
  return Object.keys(prices).length;
}

/* Every family stores its accumulated snapshots the same way, under its own
   key: `<key>-selfhistory.json`. Scarabs used to write the unprefixed
   `selfhistory.json`; that name is read once so the accumulated curve carries
   over into the prefixed file rather than restarting at a single point. */
const LEGACY_SELF_HISTORY = { scarabs: "selfhistory.json" };

async function loadSelfHistory(slug, key) {
  const base = pagesBaseUrl();
  if (!base || process.env.RESET_HISTORY === "true") return { points: [] };
  const names = [`${key}-selfhistory.json`, LEGACY_SELF_HISTORY[key]].filter(Boolean);
  const dropNonPositive = !SIGNED_HISTORY_KEYS.has(key);
  for (const name of names) {
    const prev = await deployedLeagueJson(base, slug, name);
    if (prev && Array.isArray(prev.points) && prev.points.length) {
      return { points: prev.points.map((point) => normalizePoint(point, { dropNonPositive })) };
    }
  }
  return { points: [] };
}

async function updateSelfHistory(slug, key, items, rate = null, renames = []) {
  const self = await loadSelfHistory(slug, key);
  /* Points are keyed by display name, so an id-confirmed rename would restart
     that item's history at zero. Carrying the old key forward keeps its change
     windows intact. Only id-confirmed renames arrive here — a guess from name
     similarity would risk grafting a sibling's price curve onto the wrong
     item, which is worse than a day of blank percentages. */
  applyRenames(self.points, renames);
  const points = thinPoints(self.points);
  const values = {};
  /* A price that rounds away is not a free item, so it is left out and the
     series carries a gap rather than a zero. */
  for (const it of items) { const value = roundPrice(it.chaosValue); if (value != null) values[it.name] = value; }
  const point = { t: new Date().toISOString(), values }; // one point per run
  if (rateSane(rate)) point.rate = Math.round(rate * 100) / 100;
  points.push(point);
  points.sort((a, b) => (a.t < b.t ? -1 : 1));
  while (points.length > SELF_HISTORY_CAP) points.shift();
  return { points };
}

async function updateGemHistory(slug, profits, rate) {
  const self = await loadSelfHistory(slug, "gems");
  const points = thinPoints(self.points, { hourlyHours: GEM_HISTORY_HOURLY_HOURS });
  const point = { t: new Date().toISOString(), values: profits };
  if (rateSane(rate)) point.rate = Math.round(rate * 100) / 100;
  points.push(point);
  while (points.length > GEM_HISTORY_CAP) points.shift();
  return { points };
}

/* ---------- skill gems ----------

   One request gets every gem at every level/quality/corruption state poe.ninja
   carries, which is the entire dataset the levelling tab needs. Alternate
   quality (Anomalous / Divergent / Phantasmal) is parsed and dropped: you
   cannot Gemcutter a Superior gem into one, so it is a different trade with a
   different input, and mixing it into the Superior market would misprice both.

   Listing counts come along for free and are kept per variant — a 21/20 quoted
   off three asks is the case where the paper profit does not clear, and that
   is only visible if the count travels with the price. */
async function getGemVariants(lgParams) {
  for (const p of lgParams) {
    const j = await tryJson(stashItemUrl(p, "SkillGem"));
    await sleep(DELAY_MS);
    const lines = (j && Array.isArray(j.lines)) ? j.lines : [];
    if (!lines.length) continue;

    const byName = new Map();
    let alt = 0;
    for (const l of lines) {
      const chaos = l.chaosValue ?? l.chaosEquivalent;
      if (!l.name || !(chaos > 0)) continue;
      // A gem with no variant string is a level 1 with no quality.
      const v = parseVariant(l.variant ?? `${l.gemLevel ?? 1}${l.gemQuality ? `/${l.gemQuality}` : ""}${l.corrupted ? "c" : ""}`);
      if (!v) continue;
      if (v.alt) { alt++; continue; }
      // The parsed variant is the source of truth, but the explicit fields win
      // when poe.ninja sets them — they are what the docs describe.
      const level = l.gemLevel ?? v.level;
      const quality = l.gemQuality ?? v.quality;
      const corrupted = l.corrupted ?? v.corrupted;
      if (!byName.has(l.name)) byName.set(l.name, { name: l.name, icon: l.icon || null, spark: null, variants: [] });
      const row = byName.get(l.name);
      row.variants.push({
        l: level, q: quality, ...(corrupted ? { c: 1 } : {}),
        v: roundPrice(chaos) ?? chaos,
        ...(l.listingCount != null || l.count != null ? { n: l.listingCount ?? l.count } : {}),
      });
      // The sparkline shown in the list is the gem's own price trend at the
      // level cap, which is the variant this tab is about.
      const sp = ((l.sparkline || l.sparkLine || {}).data || []).filter((x) => x != null);
      if (!corrupted && sp.length && (!row.spark || level > row.sparkLevel)) {
        row.spark = sp.map((x) => Math.round(x * 10) / 10);
        row.sparkLevel = level;
      }
    }
    for (const row of byName.values()) delete row.sparkLevel;
    const rows = [...byName.values()];
    console.log(`  gems: ${rows.length} names, ${rows.reduce((n, r) => n + r.variants.length, 0)} variants (league=${p}${alt ? `, ${alt} alternate-quality rows skipped` : ""})`);
    return rows;
  }
  return null;
}

/* Recompute change windows from our own accumulated points when we have data
   old enough; otherwise sparkline-derived values (24h/48h only) stay. The
   15-min tolerance forgives GitHub's cron starting a few minutes late. */
/* ---------- poe.ninja backfill ----------

   The legacy itemhistory endpoint hands over a whole league in one request per
   item, which is the only way a league that started before this site did has a
   graph at all. It is ~90 requests per league, so it is fetched ONCE: the
   result is stored with absolute timestamps and carried forward from the last
   deployment on every later run.

   Absolute timestamps are the point. The endpoint answers in `daysAgo`, which
   is only meaningful at the moment of the request; storing it raw would make a
   backfill fetched last week silently slide a week off the axis. */
async function loadBackfill(slug, key) {
  const base = pagesBaseUrl();
  if (!base || process.env.RESET_HISTORY === "true") return null;
  const prev = await deployedLeagueJson(base, slug, `${key}-backfill.json`);
  return (prev && prev.series && Object.keys(prev.series).length) ? prev : null;
}

/* Prices in, one family's history out. Scarabs and every category go through
   this, so their curves are built by the same code against the same origin —
   which is what lets Strat Watcher add a scarab series to an Astrolabe one. */
async function buildFamilyHistory({ slug, key, league, items, divineRate, renames = [], leagueParam, ninjaType = null }) {
  let stored = await loadBackfill(slug, key);
  // Only the legacy poe.ninja endpoint serves per-item history, and only for
  // some families. Once fetched it is never fetched again for that league.
  if (!stored && ninjaType && league.group === "current") {
    const series = await getNinjaHistory(leagueParam, ninjaType, items);
    const count = Object.keys(series).length;
    if (count) {
      stored = { fetchedAt: new Date().toISOString(), source: "ninja", series };
      console.log(`  ${key}: backfilled ${count} series from poe.ninja (once per league)`);
    }
  }
  const backfill = stored?.series || {};
  /* Self-history only grows for running leagues: a finished league's prices
     are frozen, so appending today's would draw a flat tail that never traded.
     It still loads, so last league keeps the curve it accumulated. */
  const self = league.group === "current"
    ? await updateSelfHistory(slug, key, items, divineRate, renames)
    : await loadSelfHistory(slug, key);
  applySelfChanges(items, self);
  /* Names the curve holds that the catalogue no longer lists. Never removed —
     a series is the only copy of what an item did, and a retired name can come
     back — but a growing list is how you notice a feed quietly dropping rows. */
  const orphaned = unresolvedSeries(self.points, items.map((item) => item.name));
  if (orphaned.length) {
    console.log(`  ${key}: ${orphaned.length} accumulated series no longer in the catalogue, retained: `
      + `${orphaned.slice(0, 12).join(", ")}${orphaned.length > 12 ? `, +${orphaned.length - 12} more` : ""}`);
  }
  return { backfillFile: stored, backfill, self, orphaned };
}

function familyHistoryFiles({ backfill, self, t0Ms }) {
  const history = t0Ms == null ? {} : stitchHistory({ backfill, self, t0Ms });
  return { history, historySource: historySourceOf(history, backfill, self) };
}

/* ---------- chaos-per-divine history ----------

   The site can answer "did this scarab gain value, or did chaos just deflate?"
   only if it knows what a divine cost on every past day. Two sources:

     1. backfill — poe.ninja's legacy currency history, when it answers, hands
        over the whole league in one request. Its shape has changed over the
        years and the ratio is sometimes quoted the other way up, so accept
        anything that yields {daysAgo, value} pairs, try both orientations and
        keep whichever produces plausible rates.
     2. accumulation — every snapshot stores its own rate, so the curve keeps
        growing even when (1) is dead, which is the steady state. */
/* poe.ninja's legacy currency history hands over a whole league in one request
   when it answers, which is the only way a league older than this site has a
   rate line at all. Its shape has changed over the years and the ratio is
   sometimes quoted the other way up, so `ratePointsFrom` tries both
   orientations and keeps whichever produces plausible rates. When it is dead
   the curve still grows from our own snapshots, so failure is silent. */
async function getDivineRateBackfill(lgParam) {
  const overview = await tryJson(`${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(lgParam)}&type=Currency`);
  const divine = (overview?.currencyDetails || []).find((d) => d?.name === "Divine Orb");
  if (!divine?.id) return [];
  await sleep(DELAY_MS);
  const j = await tryJson(`${NINJA}/api/data/currencyhistory?league=${encodeURIComponent(lgParam)}&type=Currency&currencyId=${divine.id}`);
  if (!j) return [];
  const candidates = Array.isArray(j)
    ? [j]
    : [j.receiveCurrencyGraphData, j.payCurrencyGraphData, j.lines, j.data];
  let best = [];
  for (const c of candidates) {
    const pts = ratePointsFrom(c);
    if (pts.length > best.length) best = pts;
  }
  return best;
}

/* ---------- reuse mode: mirror the currently deployed data ----------

   A push deploys code only: DATA_MODE=reuse copies the live deployment's data
   forward instead of taking a new snapshot. Anything NOT listed here is
   therefore deleted by that deploy — the file vanishes from the site and, if
   it was a self-history, the next scheduled run starts accumulating from zero.

   So this list is not decoration. The per-family names are derived from
   src/games/poe1/catalogue/categories.js rather than retyped, because a family added there and
   forgotten here is silently wiped on the next code push. `gems` is its own
   shape (not an exchange category) so it is named explicitly, and
   scripts/tests/poe1/test-fetch-shapes.mjs asserts that every file a run writes appears
   in this list. */
export const FAMILY_FILES = (key) => [
  `${key}.json`,            // current prices
  `${key}-history.json`,    // backfill + accumulation, stitched, what the app plots
  `${key}-selfhistory.json`,// raw accumulated snapshots, one point per run
  `${key}-backfill.json`,   // poe.ninja's curve, fetched once per league
];

export const LEAGUE_FILES = [
  "prices.json", "catalogue.json", "sources.json",
  ...CATEGORIES.flatMap((c) => FAMILY_FILES(c.key)),
  "gems.json", "gems-history.json", "gems-selfhistory.json",
  /* Scarabs wrote these two before every family shared one naming rule. They
     stay in the mirror list so a code push during the changeover does not
     delete the accumulated curve out from under the run that migrates it; once
     a fetch run has written scarabs-selfhistory.json they simply stop
     existing and these entries become no-ops. */
  "history.json", "selfhistory.json",
];

async function tryText(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

/* Copy named files from the live deployment into this run's output. Used by
   reuse mode for whole leagues, and by the fetch path for a family whose feeds
   came back empty this hour — a run that writes nothing for a family deletes
   it from the site, and with it the accumulated history the next run would
   have grown. One bad hour should cost an hour, not the league. */
async function carryForward(slug, files) {
  const base = pagesBaseUrl();
  if (!base) return 0;
  const dir = path.join(OUT, slug);
  await mkdir(dir, { recursive: true });
  let copied = 0;
  const cleaned = [];
  for (const f of files) {
    const body = await tryText(`${base}/data/poe1/${slug}/${f}`)
      ?? await tryText(`${base}/data/${slug}/${f}`); // migration from the old unscoped layout
    if (body == null) continue;
    /* What is on the site was written by whatever code was live at the time,
       so it can hold values the current gates reject. Clean on the way in: the
       gates are right that a zero price must not be published, and a reuse run
       cannot produce a better number, so carrying one forward unchanged would
       make the run unpublishable for good. */
    let text = body;
    try {
      const { doc, dropped } = sanitizeCarried(f, JSON.parse(body));
      if (dropped.length) { text = JSON.stringify(doc); cleaned.push(`${f}: ${dropped.join(", ")}`); }
    } catch { /* not JSON we know how to clean — copy it verbatim */ }
    await writeFile(path.join(dir, f), text);
    copied++;
  }
  if (cleaned.length) {
    console.log(`  ${slug}: cleaned carried-forward data — ${cleaned.slice(0, 6).join("; ")}`
      + `${cleaned.length > 6 ? `, +${cleaned.length - 6} more` : ""}`);
  }
  return copied;
}

async function applyLocalHistorySeeds(allowedSlugs) {
  let merged = 0;
  for (const [key, seedText] of localHistorySeeds) {
    const slash = key.indexOf("/");
    const slug = key.slice(0, slash);
    const file = key.slice(slash + 1);
    if (!allowedSlugs.has(slug)) continue;
    let seed;
    try { seed = JSON.parse(seedText); } catch { continue; }
    const target = path.join(OUT, slug, file);
    let deployed = null;
    try { deployed = JSON.parse(await readFile(target, "utf8")); } catch { /* seed restores a missing file */ }
    const restored = mergeHistorySeedDocument(file, seed, deployed);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(restored));
    merged++;
  }
  return merged;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

/* What a league directory actually contains, as a logical-name -> filename
   map on the index entry.

   The browser used to guess: it requested every file it had ever known about
   and read a 404 as "no data", which makes "this family was not generated this
   hour" and "this build is asking for a file that no longer exists" the same
   event. Publishing the manifest means a rename in here needs no matching
   change in the app, and a file the run genuinely failed to write is visible
   as an absence from the manifest rather than as a silent empty panel.

   The key is the filename camel-cased: `scarabs-history.json` ->
   `scarabsHistory`. Mechanical on purpose — a new family needs no entry in a
   translation table that someone would forget to update. */
function fileKey(name) {
  return name.replace(/\.json$/, "").replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

async function describeLeagueFiles(dir) {
  let names;
  try { names = await readdir(dir); } catch { return {}; }
  const files = {};
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    /* An empty or unreadable file is not published as available — advertising
       it would send the browser after something it cannot use. */
    try { if ((await stat(path.join(dir, name))).size < 2) continue; } catch { continue; }
    files[fileKey(name)] = name;
  }
  return files;
}

/* Every family that keeps an accumulated curve, so a rebuild covers all of
   them rather than whichever one someone remembered. */
const DERIVED_KEYS = [...CATEGORIES.map((c) => c.key), "gems"];

/* Reuse mode overlays the live deployment onto the checked-in tree instead of
   replacing it. The tree is a recovery seed — after a repository move it is the
   only copy of the timeline, because the previous Pages site is gone — so a
   league the deployment no longer serves is kept and marked stale rather than
   deleted. Nothing here removes files. */
async function mirrorExisting() {
  const base = pagesBaseUrl();
  if (!base) return false;
  const idxText = await tryText(`${base}/data/poe1/index.json`)
    ?? await tryText(`${base}/data/index.json`); // migration from the old unscoped layout
  let idx = null;
  if (idxText) { try { idx = JSON.parse(idxText); } catch { /* fall back to the local index */ } }
  const local = await readJson(path.join(OUT, "index.json"));
  const merged = new Map();
  for (const league of [...(local?.leagues || []), ...(idx?.leagues || [])]) {
    if (league?.slug) merged.set(league.slug, { ...merged.get(league.slug), ...league });
  }
  if (!merged.size) return false;

  await mkdir(OUT, { recursive: true });
  const kept = [];
  for (const league of merged.values()) {
    const copied = await carryForward(league.slug, LEAGUE_FILES);
    const seeded = await readJson(path.join(OUT, league.slug, "prices.json"));
    if (!copied && !seeded) { console.log(`- ${league.name}: nothing deployed and nothing checked in, dropping`); continue; }
    kept.push(copied ? { ...league, stale: undefined } : { ...league, stale: true });
    /* Filled in after the history merge below, so the manifest describes the
       tree that is actually published rather than the one mid-restore. */
    console.log(`- ${league.name}: ${copied
      ? `reused ${copied} deployed file(s)`
      : "no deployed data — kept the checked-in recovery snapshot, marked stale"}`);
  }
  if (!kept.length) return false;
  const restored = await applyLocalHistorySeeds(new Set(kept.map((league) => league.slug)));
  if (restored) console.log(`Merged ${restored} checked-in history recovery file(s).`);
  let rebuilt = 0;
  for (const league of kept) {
    rebuilt += (await rebuildDerivedHistory(path.join(OUT, league.slug), DERIVED_KEYS)).rebuilt;
  }
  if (rebuilt) console.log(`Rebuilt ${rebuilt} derived history file(s) from the merged raw snapshots.`);
  const listed = [];
  for (const league of kept) {
    listed.push(JSON.parse(JSON.stringify({ ...league, files: await describeLeagueFiles(path.join(OUT, league.slug)) })));
  }
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({
    ...(idx || local || {}),
    schemaVersion: POE1_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    leagues: listed,
  }));
  return true;
}

/* ---------- main ---------- */
async function main() {
  localHistorySeeds = await readLocalHistorySeeds();
  if (localHistorySeeds.size) console.log(`Found ${localHistorySeeds.size} checked-in history recovery file(s).`);
  if ((process.env.DATA_MODE || "fetch") === "reuse") {
    if (await mirrorExisting()) {
      console.log("Code-only deploy: reused deployed data, no new snapshot taken.");
      return;
    }
    console.log("Nothing deployed to reuse — falling back to a full fetch.");
  }
  /* The output tree is not wiped first. It holds the checked-in recovery seeds,
     and a family whose feed fails this hour keeps its last file instead of
     disappearing from the site; `written` below is what decides which leagues
     the index actually advertises. */
  await mkdir(OUT, { recursive: true });
  const previousIndex = await readJson(path.join(OUT, "index.json"));

  const leagues = await getLeagues();
  console.log("Leagues:", leagues.map((l) => l.name).join(", "));

  // One GGG digest contains every league and every exchange-traded pair for a
  // completed hour. It is the primary source when available; failure is not
  // fatal because poe.ninja and poe.watch remain complete fallbacks.
  let gggExchange = null;
  try {
    gggExchange = await fetchGggExchange();
    console.log(`GGG Currency Exchange: ${gggExchange.marketCount} markets for hour ${gggExchange.hourISO}, ${gggExchange.baseItemCount} base-item names`);
  } catch (e) {
    console.log(`GGG Currency Exchange unavailable — fallbacks only (${e.message})`);
  }

  // poe.watch names its leagues independently, so resolve the list once and
  // map each of ours onto it. An empty list here is not fatal: every code path
  // below falls through to poe.ninja.
  const watchLgs = await watchLeagues();
  console.log(watchLgs.length
    ? `poe.watch leagues: ${watchLgs.map((l) => l.name).join(", ")}`
    : "poe.watch unreachable — this run is poe.ninja only");
  if (watchLgs.length) {
    // A feed that has stopped moving reads as a quiet market from the outside.
    const st = await watchStatus();
    if (st) console.log(`poe.watch status: ${st.computed}/${st.requested} stashes processed, change ${String(st.changeID).slice(0, 24)}…`);
  }

  /* Built once for the whole run: the name index is the same for every league,
     and rebuilding it per family would walk a 20k-entry dictionary 40 times. */
  const repoeIndex = gggExchange?.baseItems ? nameIndex(gggExchange.baseItems) : null;

  const written = [];
  for (const [li, lg] of leagues.entries()) {
    const metadataCoverage = [];
    const classification = [];
    try {
      const ggg = gggExchange?.byLeague?.[lg.name] || null;
      if (ggg) {
        console.log(`  GGG: ${Object.keys(ggg.prices).length} named prices from ${ggg.markets} active markets (${ggg.directChaos} direct chaos, ${ggg.viaDivine} via divine)`);
      }
      // One poe.watch pull per league covers every tab: scarabs, the extra
      // categories and the boss price map all read from these same rows.
      const watchName = matchWatchLeague(lg.name, watchLgs);
      const watch = watchName ? await fetchWatchLeague(watchName) : null;
      if (watch) {
        const cats = Object.entries(watch.counts).filter(([, n]) => n).length;
        console.log(`  poe.watch: ${watch.rows.length} rows over ${cats} categories via /${watch.source}, ${Object.keys(watch.prices).length} names`
          + (watch.failed.length ? `, no data for ${watch.failed.join("/")}` : ""));
        console.log(`  poe.watch exchange: ${watch.exchange.length} traded pairs`
          + (watch.exchange.length ? " — volume-weighted trade prices override listing means where they overlap" : " (none; listing means only)"));
        console.log(`  poe.watch divine rate: ${Math.round(watch.rate)}c via ${watch.rateSource}`
          + (watch.direct ? ` (Divine Orb's own listing says ${Math.round(watch.direct)}c — thin, so not preferred)` : ""));
      } else if (watchLgs.length) {
        console.log(`  poe.watch: no league matching "${lg.name}" — poe.ninja only for this one`);
      }

      const ctx = await getExchangeContext(lg.params);
      const priced = await getScarabPrices(lg.params, ctx?.divisor, watch);
      const source = priced?.source || "ggg";
      const leagueParam = priced?.leagueParam || ctx?.leagueParam || lg.params[0];
      const exchangeDivineRate = priced?.exchangeDivineRate;

      // Divine rate: when prices come from the exchange overview, derive the
      // rate from that same response (live market, consistent with the scarab
      // prices). The stash/legacy currency endpoints can serve stale values.
      const divineRate = (ggg?.divineRate > 0)
        ? ggg.divineRate
        : (watch?.rate > 0)
        ? watch.rate
        : (source === "exchange" && exchangeDivineRate)
          ? exchangeDivineRate
          : await getDivineRate(leagueParam, exchangeDivineRate);
      const mergedScarabs = mergeGggCategory(priced?.items || [], ggg, "scarabs", divineRate);
      const items = mergedScarabs.items;
      const scarabCoverage = enrichFromRepoe(items, gggExchange?.baseItems, repoeIndex);
      const scarabClassification = classificationCoverage(items, "scarabs");
      attachStableKeys(items);
      if (!items.length) {
        // Writing nothing would delete this league from the site and restart
        // every accumulated curve in it. Keep the last good snapshot instead.
        const slug = slugify(lg.name);
        const carried = await carryForward(slug, LEAGUE_FILES);
        console.log(`- ${lg.name}: no usable scarab data — ${carried ? `kept the ${carried} deployed file(s), marked stale` : "and nothing deployed to keep"}`);
        /* Same treatment as any other league that produced nothing this hour:
           keep what was there, say it is stale, and publish the manifest of
           what is actually in the directory. This branch used to advertise the
           league as fresh and without a files map — so the browser guessed
           filenames and presented an old snapshot as current. */
        if (carried) {
          written.push({
            name: lg.name, slug, group: lg.group || "current", stale: true,
            files: await describeLeagueFiles(path.join(OUT, slug)),
          });
        }
        continue;
      }
      // divineValue may be missing/zero from some sources — recompute
      for (const it of items) if (!it.divineValue) it.divineValue = it.chaosValue / divineRate;

      const slug = slugify(lg.name);
      /* One drift report per run. The primary current league is the catalogue
         the curated boss and Delve datasets are written against, and every
         extra league would cost another round of requests for the same news. */
      const trackDrift = lg.group === "current" && li === 0;
      const curated = trackDrift ? await curatedNames() : null;
      const catalogue = [];
      const scarabDrift = trackDrift
        ? await trackCatalogue(slug, CATEGORY_BY_KEY.scarabs, items, curated)
        : null;
      if (scarabDrift) catalogue.push(scarabDrift);
      const scarabHist = await buildFamilyHistory({
        slug, key: "scarabs", league: lg, items, divineRate,
        renames: scarabDrift?.renamed, leagueParam,
        // poe.watch also has a seven-point daily series, but it is shallower
        // than what the hourly snapshots already hold, so only poe.ninja's
        // league-long curve is worth a backfill.
        ninjaType: (source === "legacy" && li < HISTORY_LEAGUES) ? "Scarab" : null,
      });
      const { self } = scarabHist;
      /* One origin for the whole league — the categories below reuse it, so
         every tab's day 3 is the same moment. */
      const origin = historyOrigin({ leagueStart: lg.start, backfill: scarabHist.backfill, self });
      const historyAxis = origin?.axis || "league day";
      const { history, historySource } = familyHistoryFiles({ ...scarabHist, t0Ms: origin?.t0Ms });

      // One rate backfill attempt per league, and only where there is a chart
      // to put it on. If poe.ninja's history endpoints are dead the rate curve
      // still grows from our own snapshots, so this stays silent on failure.
      let rateBackfill = [];
      if (lg.group === "current" && li < HISTORY_LEAGUES) {
        try { rateBackfill = await getDivineRateBackfill(leagueParam); } catch { /* accumulate instead */ }
      }
      /* Built once and written into every family's file: the rate line shares
         the price line's axis, and now every family shares one axis. */
      const rateHistory = origin
        ? buildRateHistory({ self, backfill: rateBackfill, t0Ms: origin.t0Ms })
        : [];
      const rateHistorySource = !rateHistory.length ? "none" : rateBackfill.length ? "ninja+self" : "self";

      const dir = path.join(OUT, slug);
      await mkdir(dir, { recursive: true });
      const generatedAt = new Date().toISOString();
      const scarabSource = sourceLabel({
        ggg: mergedScarabs.officialCount,
        watch: source === "watch" ? mergedScarabs.fallbackCount : 0,
        ninja: source !== "watch" && source !== "ggg" ? mergedScarabs.fallbackCount : 0,
      });
      /* historyOrigin is the absolute moment day 0 sits on. The day axis alone
         cannot be re-anchored later, so storing it is what lets reuse mode
         rebuild these curves without calling poe.ninja for the league start. */
      const historyOriginISO = origin ? new Date(origin.t0Ms).toISOString() : null;
      await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, generatedAt, gggHour: ggg ? gggExchange.hourISO : null, divineRate, priceSource: scarabSource, historySource, historyAxis, historyOrigin: historyOriginISO, rateHistory, rateHistorySource, items }));
      await writeFile(path.join(dir, "scarabs-history.json"), JSON.stringify(history));
      await writeFile(path.join(dir, "scarabs-selfhistory.json"), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, ...self }));
      if (scarabHist.backfillFile) await writeFile(path.join(dir, "scarabs-backfill.json"), JSON.stringify(scarabHist.backfillFile));
      // broad price map for the boss profitability tab
      let currencyPrices = null;
      try {
        let pm = mergeGggPriceMap(await getPriceMap(lg.params, ctx, watch), ggg, leagueParam);
        // The newest GGG digest may know an exchange item but have zero trades
        // for it in that single hour. Only the primary current league pays the
        // cost of repairing boss-item gaps: first reuse a still-recent official
        // price from the prior deployment, then scan bounded older GGG hours
        // for supported names which remain completely unpriced.
        if (pm && ggg && li === 0) {
          const bossNames = await configuredBossPriceNames();
          const missingBossNames = () => bossNames.filter((name) => !(pm.prices[name]?.c > 0));
          const carried = carryRecentGggBossPrices(
            ggg,
            await previousPriceSnapshot(slug),
            missingBossNames(),
            gggExchange.hourISO,
          );
          if (carried) {
            pm = mergeGggPriceMap(pm, ggg, leagueParam);
            console.log(`  GGG thin markets: retained ${carried} recent official boss price(s) from the prior snapshot`);
          }

          const lookback = await fetchGggPriceLookback(gggExchange, {
            league: lg.name,
            names: missingBossNames(),
            maxHours: GGG_THIN_PRICE_MAX_AGE_HOURS,
          });
          if (Object.keys(lookback.prices).length) {
            mergeGggLookback(ggg, lookback);
            pm = mergeGggPriceMap(pm, ggg, leagueParam);
            console.log(`  GGG thin markets: recovered ${Object.keys(lookback.prices).length}/${lookback.supported.length} supported boss price(s) from ${lookback.hoursChecked} earlier hour(s)`);
          } else if (lookback.supported.length) {
            console.log(`  GGG thin markets: no completed trades for ${lookback.supported.join(", ")} in the previous ${GGG_THIN_PRICE_MAX_AGE_HOURS}h`);
          }
        }
        if (pm && li === 0 && watchName) await applyBetaPrices(pm.prices, watchName);
        if (pm) {
          const priceSource = sourceLabel({
            ggg: pm.counts?.["GGG Currency Exchange"] || 0,
            watch: pm.counts?.["poe.watch"] || 0,
            ninja: Object.entries(pm.counts || {}).filter(([k]) => k !== "poe.watch" && k !== "GGG Currency Exchange").reduce((n, [, v]) => n + v, 0),
          });
          await writeFile(path.join(dir, "prices.json"), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, generatedAt, gggHour: ggg ? gggExchange.hourISO : null, divineRate, priceSource, prices: pm.prices }));
          console.log(`  prices: ${Object.keys(pm.prices).length} names across ${pm.categories} sources (league=${pm.leagueParam})`);
          await reportUnpricedBossItems(pm.prices, lg.name, li === 0);
          currencyPrices = pm.prices;
        } else {
          console.log(`  prices: NO DATA for ${lg.name} — every endpoint family came back empty`);
        }
      } catch (e) {
        console.log(`  prices: FAILED (${e.message})`);
      }

      /* gem levelling — one poe.ninja request, kept per variant.
         The profit curve is accumulated here rather than in the browser: the
         alternative is shipping every variant price for every gem for a whole
         league, which is megabytes for a line chart. Today's figures on the
         site are recomputed live from gems.json, so an override or a changed
         assumption moves the row; the stored curve is what the model saw at
         each snapshot under the published corruption weights. */
      try {
        const gemRows = await getGemVariants(lg.params);
        if (gemRows && gemRows.length) {
          const gcp = currencyPrices?.[GCP_NAME]?.c || 0;
          const vaalOrb = currencyPrices?.[VAAL_ORB_NAME]?.c || 0;
          if (!gcp) console.log(`  gems: WARNING — no ${GCP_NAME} price, so the "level it yourself" input cost is understated`);
          await writeFile(path.join(dir, "gems.json"), JSON.stringify({
            schemaVersion: POE1_SCHEMA_VERSION, generatedAt, divineRate, priceSource: "poe.ninja stash item overview",
            gcp, vaalOrb, gems: gemRows,
          }));

          let gemHist = {};
          let gemSelf = { points: [] };
          if (lg.group === "current") {
            const computed = computeGems(gemRows, { gcp, vaalOrb });
            const profits = {};
            for (const g of computed) {
              // A gem with no target market has no profit to record, and an
              // empty key per gem per hour is the bulk of the file.
              if (g.profit == null || !isFinite(g.profit)) continue;
              profits[g.name] = Math.round(g.profit * 100) / 100;
            }
            gemSelf = await updateGemHistory(slug, profits, divineRate);
            // Gem profit is not a price, so there is nothing to backfill — but
            // it shares the league axis so its chart reads like the others.
            gemHist = origin ? stitchHistory({ self: gemSelf, t0Ms: origin.t0Ms }) : {};
            console.log(`  gems: ${Object.keys(profits).length} priced, ${gemSelf.points.length} history point(s), 1 GCP ${Math.round(gcp)}c, 1 Vaal Orb ${Math.round(vaalOrb)}c`);
          }
          await writeFile(path.join(dir, "gems-history.json"), JSON.stringify(gemHist));
          await writeFile(path.join(dir, "gems-selfhistory.json"), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, ...gemSelf }));
        } else {
          console.log(`  gems: no data for ${lg.name}`);
        }
      } catch (e) {
        console.log(`  gems: FAILED (${e.message})`);
      }

      // extra categories: astrolabes + catalysts, same treatment as scarabs
      for (const cat of EXTRA_CATEGORIES) {
        try {
          // Same order as everywhere else: poe.ninja's exchange first, then
          // poe.watch for a category poe.ninja served nothing for.
          let r = await getExchangeCategory(lg.params, cat.ninjaType, cat.re, ctx?.divisor);
          if (!r && watch) {
            const wi = watchCategoryItems(watch.rows, cat.re, watch.rate || divineRate, cat.watch, watch.exchange);
            if (wi.length) r = { items: wi, source: "watch" };
          }
          const rate2 = ggg?.divineRate || r?.exchangeDivineRate || divineRate;
          const mergedCat = mergeGggCategory(r?.items || [], ggg, cat.key, rate2);
          const catItems = mergedCat.items;
          const catCoverage = enrichFromRepoe(catItems, gggExchange?.baseItems, repoeIndex);
          attachStableKeys(catItems);
          if (catCoverage.total) metadataCoverage.push({ family: cat.key, ...catCoverage });
          classification.push({ family: cat.key, ...classificationCoverage(catItems, cat.key) });
          if (!catItems.length) {
            const kept = await carryForward(slug, FAMILY_FILES(cat.key));
            console.log(`  ${cat.key}: no data for ${lg.name}${kept ? ` — kept the ${kept} deployed file(s)` : ""}`);
            continue;
          }
          for (const it of catItems) if (!it.divineValue) it.divineValue = it.chaosValue / rate2;
          const catDrift = trackDrift ? await trackCatalogue(slug, cat, catItems, curated) : null;
          if (catDrift) catalogue.push(catDrift);
          const catFam = await buildFamilyHistory({
            slug, key: cat.key, league: lg, items: catItems, divineRate: rate2,
            renames: catDrift?.renamed, leagueParam,
            // No legacy history endpoint answers for these families, so their
            // curve is what the hourly snapshots have accumulated.
            ninjaType: null,
          });
          const { history: catHist, historySource: catHistorySource } =
            familyHistoryFiles({ ...catFam, t0Ms: origin?.t0Ms });
          const catPriceSource = sourceLabel({
            ggg: mergedCat.officialCount,
            watch: r?.source === "watch" ? mergedCat.fallbackCount : 0,
            ninja: r && r.source !== "watch" ? mergedCat.fallbackCount : 0,
          });
          await writeFile(path.join(dir, `${cat.key}.json`), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, generatedAt, gggHour: ggg ? gggExchange.hourISO : null, divineRate: rate2, priceSource: catPriceSource, historySource: catHistorySource, historyAxis, historyOrigin: historyOriginISO, rateHistory, rateHistorySource, items: catItems }));
          await writeFile(path.join(dir, `${cat.key}-history.json`), JSON.stringify(catHist));
          await writeFile(path.join(dir, `${cat.key}-selfhistory.json`), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, ...catFam.self }));
          if (catFam.backfillFile) await writeFile(path.join(dir, `${cat.key}-backfill.json`), JSON.stringify(catFam.backfillFile));
          console.log(`  ${cat.key}: ${catItems.length} items (${mergedCat.officialCount} priced by GGG), ${Object.keys(catHist).length} history series`);
        } catch (e) {
          const kept = await carryForward(slug, FAMILY_FILES(cat.key));
          console.log(`  ${cat.key}: FAILED (${e.message})${kept ? ` — kept the ${kept} deployed file(s)` : ""}`);
        }
      }

      /* Provenance for the league, kept out of prices.json because every
         browser downloads that file hourly and this is diagnostic. It states
         which digest and which dictionary the numbers came from, how many rows
         each source offered, and how much of the result RePoE could identify. */
      if (scarabCoverage.total) metadataCoverage.unshift({ family: "scarabs", ...scarabCoverage });
      classification.unshift({ family: "scarabs", ...scarabClassification });
      await writeFile(path.join(dir, "sources.json"), JSON.stringify({
        schemaVersion: POE1_SCHEMA_VERSION,
        generatedAt,
        league: lg.name,
        gggHour: ggg ? gggExchange.hourISO : null,
        nextChangeId: ggg ? gggExchange.nextChangeId ?? null : null,
        sources: gggExchange?.sources || [],
        metadataCoverage,
        classification,
      }));

      if (catalogue.length) {
        const breaking = catalogue.flatMap((entry) => entry.breaking);
        await writeFile(path.join(dir, "catalogue.json"), JSON.stringify({ schemaVersion: POE1_SCHEMA_VERSION, generatedAt, categories: catalogue }));
        if (breaking.length) console.log(`  catalogue: ${breaking.length} curated name(s) need attention`);
      }

      written.push({ name: lg.name, slug, group: lg.group || "current", files: await describeLeagueFiles(dir) });
      console.log(`- ${lg.name}: ${items.length} scarabs, ${Object.keys(history).length} history series, 1 div = ${Math.round(divineRate)}c, rate history ${rateHistory.length}pt (${rateHistorySource})`);
    } catch (e) {
      /* A league that throws used to vanish from the index while the run still
         reported success, which silently deletes its accumulated history on the
         next pass. Keep the last good copy and say it is stale instead. */
      const slug = slugify(lg.name);
      const carried = await carryForward(slug, LEAGUE_FILES);
      const seeded = await readJson(path.join(OUT, slug, "prices.json"));
      console.log(`- ${lg.name}: FAILED (${e.message})${carried || seeded ? " — kept the last valid snapshot, marked stale" : ""}`);
      if (carried || seeded) {
        written.push({
          name: lg.name, slug, group: lg.group || "current", stale: true,
          files: await describeLeagueFiles(path.join(OUT, slug)),
        });
      }
    }
  }

  /* A league the source list stopped naming is not proof the league retired —
     it is far more often one bad response. Retain what it had, flagged, so a
     quiet upstream failure cannot erase a timeline. */
  const fetched = new Set(written.map((league) => league.slug));
  for (const league of previousIndex?.leagues || []) {
    if (!league?.slug || fetched.has(league.slug)) continue;
    const carried = await carryForward(league.slug, LEAGUE_FILES);
    const seeded = await readJson(path.join(OUT, league.slug, "prices.json"));
    if (!carried && !seeded) { console.log(`- ${league.name}: gone from the source list and nothing left to keep`); continue; }
    written.push({ ...league, stale: true, files: await describeLeagueFiles(path.join(OUT, league.slug)) });
    console.log(`- ${league.name}: gone from the source list — retained its last snapshot, marked stale`);
  }

  if (!written.length) throw new Error("No league data could be fetched — aborting so the old deployment stays up.");
  const fresh = written.filter((league) => !league.stale).length;
  if (!fresh) throw new Error("Every league is stale — aborting so the old deployment stays up.");
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({
    schemaVersion: POE1_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    leagues: written,
  }));
  console.log(`Done. Wrote ${written.length} league(s) (${fresh} fresh) to ${OUT}`);
}

/* Generate into staging, gate the result, and only then replace the published
   tree. A run that cannot pass its own gates exits non-zero and leaves the
   previous deployment live — GitHub Pages only uploads after a successful
   workflow, so failing loudly is strictly safer than publishing the damage. */
async function run() {
  const cleared = await clearAbandonedStages(FINAL_OUT);
  if (cleared) console.log(`Cleared ${cleared} abandoned staging director(ies).`);
  const stage = await createStage(FINAL_OUT);
  OUT = stage.dir;
  try {
    await main();
    const report = await validatePoe1(OUT, { previousDir: FINAL_OUT, report: new QualityReport({ game: "poe1" }) });
    const index = await readJson(path.join(OUT, "index.json"));
    const primary = index?.leagues?.find((league) => !league.stale && league.group === "current");
    if (primary) {
      try { await checkCuratedCoverage(OUT, FINAL_OUT, report, { league: primary.slug }); }
      catch (error) { report.warn("curated-coverage", `coverage check skipped: ${error.message}`); }
    }
    await writeJsonFile(path.join(OUT, "quality.json"), report.toJSON());
    report.print();
    if (!report.publishable) {
      throw new Error(`PoE 1 dataset failed ${report.failures.length} publication gate(s) — not publishing`);
    }
    await stage.promote();
    console.log(`Promoted the staged PoE 1 dataset to ${FINAL_OUT}.`);
  } catch (error) {
    await stage.discard();
    throw error;
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
