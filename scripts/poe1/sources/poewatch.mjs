/* ================================================================
   POE.WATCH — listing/trade evidence and gap-fill source

   poe.watch (https://docs.poe.watch) publishes one flat array per item
   category, and each row already carries what this project had to work for
   against poe.ninja: a chaos price, how many listings it came from, a
   low-confidence flag, and a week of daily history. There is no per-league
   endpoint discovery, no reference-currency calibration, and no split between
   "exchange" and "stash" families with different shapes.

   It also lists things poe.ninja simply does not, most importantly the
   UNIDENTIFIED forms of veiled uniques — "Unidentified Cinderswallow Urn" is
   its own item at roughly nine times the identified price. That is exactly
   what Catarina drops, and it is why her pool read as worthless.

   poe.ninja remains the higher-trust listing source. poe.watch fills markets it
   does not carry and can win a nearby disagreement when its fresher/deeper
   evidence outweighs that trust prior.

   ---- on the price unit ----
   `mean`, `min` and `max` are chaos. This is worth stating because the API
   makes you infer it: there is no Chaos Orb row (nothing prices the unit in
   itself), and Exalted Orb reads 1, which looks like a base currency but is
   just an exalt being worth about a chaos these days. Divine Orb reads ~173,
   which agrees with poe.ninja, so chaos it is.

   ---- which endpoints, and why ----
   /compact?league=X   every category in ONE request. The per-category /get
                       needed 22 round trips for the same data.
   /exchange/ratios    the currency exchange. Its `price` is a VOLUME-WEIGHTED
                       MEAN OF ACTUAL TRADES, where /compact's `mean` is a mean
                       of listings — asks people posted, not deals that closed.
                       Where both know an item the exchange wins, and it also
                       carries real 24h volume and change.
   /status             how fresh the data is, logged so a stalled feed is
                       visible rather than looking like a quiet market.

   ---- on the divine rate ----
   NOT from Divine Orb's own `mean`. That row is an item listing like any
   other, it is thin (a few dozen a day, flagged lowConfidence), and it reads
   about 173 while the rest of the site disagrees.

   The real rate is the currency exchange one. /exchange/ratios states it
   directly: each entry's price is quoted in both chaos and divine, so the
   ratio of the two IS the rate, taken from whichever entries trade in enough
   volume to be trustworthy. /compact rows can recover the same number from
   mean/divine, and that is the fallback.

   Both are rounded to two decimals, so the ladders below prefer entries whose
   divine figure is large enough for that rounding not to matter: an item worth
   0.02 divine pins the rate to +/-25, one worth 4 pins it to +/-0.03.

   The `exalted` field stays unused: it is inconsistent even between rows that
   share a mean.
   ================================================================ */

import { JSON_HEADERS, roundPrice, sourceRecord } from "../../shared/dataset.mjs";

const BASE = process.env.WATCH_BASE || "https://api.poe.watch";
/* The beta pricing panel is served by the site rather than the documented API,
   and is not in the published schema. It is the only place `activePrice` — what
   is actually clearing, rather than the cheapest ask — is exposed. */
const SITE = process.env.WATCH_SITE_BASE || "https://poe.watch";
const HEADERS = { ...JSON_HEADERS };

/* Every category the site has a use for. `bases` is ~18k rows of crafting
   bases and `enchantment` is helmet enchants — neither is referenced by any
   tab, and both are large, so they are deliberately not fetched. */
/* Category names are NOT stable between the query and the response: you ask
   /get for `flask` and every row comes back tagged `flasks`; `weapon` becomes
   `weapons`, `currency` rows can come back as `catalysts`. /compact only ever
   gives you the response form. Matching the two literally silently dropped
   every unique, flask, jewel and gem from the price map — 2,600 names survived
   and looked healthy, so nothing announced it.
   Compare loosely, and never allow-list: skip only what is genuinely unwanted
   and keep whatever else the API decides to call things. */
const catKey = (c) => String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
export function catMatches(rowCat, wanted) {
  if (!wanted || !wanted.length) return true;
  const k = catKey(rowCat);
  return wanted.some((w) => catKey(w) === k);
}

/* ~18k crafting bases and every helmet enchant. Nothing references either,
   and both are large enough to be worth not carrying around. */
const SKIP_CATEGORIES = ["bases", "enchantment"];

export const WATCH_CATEGORIES = [
  "currency",      // orbs, astrolabes, catalysts, lifeforce, the entry costs
  "fragment",      // breachstones, invitations' cousins, boss keys
  "invitation",
  "scarab",
  "card",
  "oil", "essence", "fossil", "resonator", "deliriumOrb", "incubator", "beast",
  "map", "uniqueMap",
  "flask", "armour", "weapon", "accessory", "jewel", "gem",
  "heist", "corpses", "deepwater",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function watchJson(pathAndQuery) {
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathAndQuery}`);
  return res.json();
}
/* Failures are logged rather than swallowed: an empty category and an
   unreachable host look identical downstream, and confusing the two once cost
   an afternoon on the poe.ninja side. */
let quiet = false;
async function tryWatch(p) {
  try { return await watchJson(p); }
  catch (e) {
    if (!quiet) { console.log(`    poe.watch ${p} — ${e.message}`); quiet = true; }
    return null;
  }
}

/* ---------- leagues ---------- */

export async function watchLeagues() {
  const j = await tryWatch("/leagues");
  return Array.isArray(j) ? j.filter((l) => l && l.name) : [];
}

/* poe.ninja and poe.watch mostly agree on league names, but not always on
   punctuation or the SSF/Ruthless prefixes, so match in widening steps rather
   than requiring an exact string. */
export function matchWatchLeague(name, leagues) {
  if (!name || !leagues?.length) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  for (const l of leagues) if (l.name === name) return l.name;
  for (const l of leagues) if (norm(l.name) === n) return l.name;
  return null;
}

/* ---------- rows ---------- */

/* One row per priced item form. Gems repeat by level/quality/corruption and
   armour by link count, which is how the base-variant rule below can work. */
export function normaliseRow(r) {
  if (!r || !r.name) return null;
  const chaos = Number(r.mean);
  if (!(chaos > 0)) return null;
  return {
    name: String(r.name),
    id: r.id,
    group: r.group || null,
    chaos,
    lo: Number(r.min) > 0 ? Number(r.min) : chaos,
    hi: Number(r.max) > 0 ? Number(r.max) : chaos,
    daily: Number(r.daily) || 0,
    lowConfidence: r.lowConfidence === true,
    linkCount: r.linkCount ?? null,
    gemLevel: r.gemLevel ?? null,
    gemQuality: r.gemQuality ?? null,
    gemCorrupted: r.gemIsCorrupted === true,
    itemLevel: Number(r.itemLevel) || 0,
  };
}

/* The form a boss actually drops, mirroring the rule the poe.ninja path uses:
   a level-1, zero-quality, uncorrupted gem, and an unlinked item. A corrupted
   21/20 gem and a 6-link are post-drop states, not drops. */
export function isGemRow(row) {
  return row.gemLevel != null || row.gemQuality != null || row.gemCorrupted === true;
}

/* The form a boss hands over: unidentified where that exists, and never a
   corrupted one. A corrupted copy is a different item — it cannot be modified
   further, and its price reflects that, not the drop. */
export function isWatchBaseVariant(row) {
  if (row.gemCorrupted === true) return false;
  if (isGemRow(row)) {
    return (row.gemLevel ?? 1) <= 1 && (row.gemQuality ?? 0) === 0;
  }
  if (row.linkCount != null) return row.linkCount === 0;
  return true;
}

/* ---------- divine rate ---------- */

const rateSane = (v) => typeof v === "number" && isFinite(v) && v >= 20 && v <= 20000;
const median = (a) => {
  const s = a.filter((v) => isFinite(v) && v > 0).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* Divine Orb's own chaos price is the rate. The cross-check exists because
   poe.watch's per-row `divine` field implies a different one, and if those two
   ever converge or the gap explodes, that is worth seeing in the log rather
   than silently repricing the entire site. */
/* Walk a set of (chaos, divine, weight) quotes from strict to loose and stop
   at the first tier with enough of them to median. Shared by both rate
   sources so they cannot drift apart. */
function rateLadder(quotes, tiers) {
  for (const [minDivine, minWeight] of tiers) {
    const s = quotes
      .filter((q) => q.divine >= minDivine && q.weight >= minWeight && q.chaos > 0)
      .map((q) => q.chaos / q.divine);
    if (s.length >= 3) {
      const m = median(s);
      if (rateSane(m)) return m;
    }
  }
  return 0;
}

export function watchDivineRate(rows, exchange = null) {
  // 1. The exchange itself: every entry is quoted in both currencies, so the
  //    ratio is the rate. Weighted by 24h volume — a pair that barely trades
  //    is not evidence about the rate.
  const fromExchange = rateLadder(
    (exchange || [])
      .filter((e) => !e.lowConfidence)
      .map((e) => ({ chaos: e.chaos, divine: e.divine, weight: e.volume24H || 0 })),
    [[1, 1000], [0.5, 100], [0.1, 0], [0.01, 0]]
  );

  // 2. The same ratio recovered from /compact rows.
  const fromRows = rateLadder(
    rows.filter((r) => !r.lowConfidence).map((r) => ({ chaos: r.chaos, divine: r.divineField, weight: r.daily })),
    [[4, 20], [1, 20], [0.5, 10], [0.1, 0]]
  );

  // 3. Last resort: Divine Orb as an item listing. Thin, and it reads low —
  //    only used when a league is too young for either ratio to exist.
  const div = rows.find((r) => r.name === "Divine Orb" && r.chaos > 0);
  const direct = div ? div.chaos : 0;

  const rate = fromExchange || fromRows || (rateSane(direct) ? direct : 0);
  const rateSource = fromExchange ? "exchange ratios"
    : fromRows ? "item divine ratio"
    : direct ? "Divine Orb listing (thin)" : "none";
  return { rate, rateSource, fromExchange, fromRows, direct };
}

/* ---------- exchange ratios ----------
   The shipped OpenAPI describes an older shape than the API serves, so read
   defensively: prefer the canonical `price` block (volume-weighted mean of
   real trades), fall back to the chaos side's own figures. */
export function normaliseExchange(e) {
  if (!e || !e.name) return null;
  const p = e.price || {};
  const cs = e.chaos || {};
  const chaos = Number(p.chaos ?? cs.chaosValue ?? cs.value);
  const divine = Number(p.divine ?? cs.divineValue) || 0;
  if (!(chaos > 0)) return null;
  return {
    name: String(e.name),
    id: e.id,
    category: e.category || null,
    chaos,
    divine,
    lowConfidence: (p.lowConfidence ?? cs.lowConfidence) === true,
    volume24H: Number(cs.volume24H) || 0,
    change24H: Number(cs.change24H) || 0,
    method: p.method || null,
  };
}

/* ---------- price map ---------- */

/* Collapses rows to one entry per name, with the same semantics the rest of
   the pipeline already uses:
     - where base variants exist they ARE the item; other forms are ignored
     - otherwise the floor, because an unspecified roll is worth its cheapest
   `daily` and `lowConfidence` ride along so a thin price can be flagged
   rather than presented with the same authority as a liquid one. */
/* Dead asks must not price an item — an Unidentified Glorious Vanity row has sat
   at 61.5 million chaos on `daily: 0` while a traded row for the same name
   quotes 2.2k — but requiring volume outright is the wrong cure. It throws away
   cheap thin rows too, and every one of those it drops pushes the quote up.

   So volume only ever disqualifies a row for being *expensive*: an untraded row
   is kept when it undercuts everything that moved, and dropped when it sits
   above. A silent cheap listing is still a listing you could have bought; a
   silent dear one is an ask nobody took. If nothing traded at all the rows are
   all there is, which keeps prices alive in a quiet league. */
function traded(rows) {
  const moved = rows.filter((r) => r.daily > 0);
  if (!moved.length) return rows;
  const floor = Math.min(...moved.map((r) => r.lo));
  return rows.filter((r) => r.daily > 0 || r.lo < floor);
}

export function watchPriceMap(rows, exchange = null) {
  const acc = {};
  for (const r of rows) {
    const e = acc[r.name] || (acc[r.name] = { all: [], base: [], daily: 0, thin: true });
    e.all.push(r);
    if (isWatchBaseVariant(r)) e.base.push(r);
    e.daily = Math.max(e.daily, r.daily);
    if (!r.lowConfidence) e.thin = false;
  }
  const prices = {};
const excluded = new Set();
  for (const [name, e] of Object.entries(acc)) {
    /* Gems are strict. A boss hands you a level 1, zero quality, uncorrupted
       gem, and nothing else — so that exact form is the only acceptable price.
       Falling back to the cheapest of whatever else exists would quote a 20/20
       or a corrupted 21 as if it dropped that way, which is wrong by a factor
       that grows with how good the gem is. No base row means no price, and the
       drop is hidden rather than flattered. */
    if (e.all.some(isGemRow) && !e.base.length) { excluded.add(name); continue; }

    const pick = traded(e.base.length ? e.base : e.all);
    /* An unidentified unique is sold as an unopened gamble. poe.watch exposes
       the current listing floor in `min`; that is the price a player can
       actually buy the gamble for, while `mean` is pulled upward by stale or
       optimistic asks. Identified items keep the existing mean-based rule. */
    const quote = (r) => /^unidentified\b/i.test(name) ? r.lo : r.chaos;
    const chaos = pick.map(quote);
    // With base variants the cheapest base is the drop; without them every row
    // is a roll and the floor is the honest quote for an unspecified one.
    const c = Math.min(...chaos);
    prices[name] = {
      c: roundPrice(c),
      lo: roundPrice(Math.min(...pick.map((r) => r.lo))),
      hi: roundPrice(Math.max(...pick.map((r) => r.hi))),
      n: pick.length,
      daily: e.daily,
      ...(pick[0]?.id != null ? { wid: pick[0].id } : {}),
      ...(e.thin ? { thin: true } : {}),
    };

    /* Some unidentified boss uniques have the same display name at several
       item levels, but those levels are different markets. Keep the normal
       name as a safe fallback and add exact keys for the boss table to target.
       Watcher's Eye already includes 85/86+ in its poe.watch display name, so
       it naturally stays separate without an extra synthetic key. */
    const levels = [...new Set(e.all.map((r) => r.itemLevel).filter((level) => level > 0))];
    if (levels.length > 1) {
      for (const level of levels) {
        const levelAll = e.all.filter((r) => r.itemLevel === level);
        const levelBase = levelAll.filter(isWatchBaseVariant);
        const levelPick = traded(levelBase.length ? levelBase : levelAll);
        const levelChaos = levelPick.map(quote);
        prices[`${name} (ilvl ${level})`] = {
          c: roundPrice(Math.min(...levelChaos)),
          lo: roundPrice(Math.min(...levelPick.map((r) => r.lo))),
          hi: roundPrice(Math.max(...levelPick.map((r) => r.hi))),
          n: levelPick.length,
          daily: Math.max(...levelPick.map((r) => r.daily)),
          ...(levelPick[0]?.id != null ? { wid: levelPick[0].id } : {}),
          ...(levelPick.every((r) => r.lowConfidence) ? { thin: true } : {}),
        };
      }
    }
  }

  /* The exchange overrides the listing mean wherever it trades the item. Its
     figure is a volume-weighted mean of trades that actually happened; `mean`
     is an average of asks, which includes everything nobody bought. Only
     confident, actually-traded pairs are allowed to override. */
  let overrode = 0;
  for (const x of (exchange || [])) {
    if (x.lowConfidence || !(x.chaos > 0) || !(x.volume24H > 0)) continue;
    // A gem excluded above stays excluded: the exchange does not say which
    // level or quality it traded, so it cannot reinstate a base-form price.
    if (excluded.has(x.name)) continue;
    const prev = prices[x.name];
    prices[x.name] = {
      ...(prev || { lo: x.chaos, hi: x.chaos, n: 1 }),
      c: roundPrice(x.chaos),
      exchange: true,
      volume24H: x.volume24H,
      ...(x.change24H ? { change24H: x.change24H } : {}),
    };
    delete prices[x.name].thin;
    if (prev) overrode++;
  }
  if (overrode) Object.defineProperty(prices, "__exchangeOverrides", { value: overrode, enumerable: false });
  return prices;
}

/* ---------- the whole snapshot for one league ---------- */

function collect(list, rows, counts) {
  for (const raw of list) {
    const row = normaliseRow(raw);
    if (!row) continue;
    const cat = raw.category || null;
    if (cat && catMatches(cat, SKIP_CATEGORIES)) continue;
    row.divineField = Number(raw.divine) || 0;
    row.change = Number(raw.change) || 0;
    row.category = cat;
    rows.push(row);
    counts[cat || "?"] = (counts[cat || "?"] || 0) + 1;
  }
}

export async function fetchWatchLeague(leagueName, { delayMs = 150, categories = WATCH_CATEGORIES } = {}) {
  const rows = [];
  const counts = {};
  const failed = [];
  const sources = [];
  let source = "compact";

  const traced = async (pathAndQuery, { id, endpointFamily, requestedType } = {}) => {
    const requestedAt = new Date().toISOString();
    const payload = await tryWatch(pathAndQuery);
    const rawRows = Array.isArray(payload) ? payload.length
      : Array.isArray(payload?.items) ? payload.items.length : undefined;
    sources.push(sourceRecord({
      id, endpointFamily, requestedType, url: `${BASE}${pathAndQuery}`, requestedAt,
      observedAt: requestedAt,
      ok: payload != null, rawRows,
      ...(!payload ? { warnings: ["request failed or returned no JSON"] } : {}),
    }));
    return payload;
  };

  // One request for everything. /compact returns the same ItemData rows the
  // per-category endpoint does, already tagged with their category.
  const compact = await traced(`/compact?league=${encodeURIComponent(leagueName)}`, {
    id: "poewatch.compact", endpointFamily: "compact",
  });
  if (Array.isArray(compact?.items)) {
    collect(compact.items, rows, counts);
  } else {
    // Fall back to the per-category endpoint. Slower, but it is the difference
    // between a stale snapshot and no snapshot.
    source = "per-category";
    for (const cat of categories) {
      const j = await traced(`/get?category=${encodeURIComponent(cat)}&league=${encodeURIComponent(leagueName)}`, {
        id: "poewatch.category", endpointFamily: "category", requestedType: cat,
      });
      if (!Array.isArray(j)) { failed.push(cat); await sleep(delayMs); continue; }
      collect(j.map((r) => ({ ...r, category: cat })), rows, counts);
      await sleep(delayMs);
    }
  }
  if (!rows.length) {
    return {
      rows: [], exchange: [], counts, failed, source, sources, prices: {},
      rate: 0, rateSource: "none", direct: 0,
    };
  }

  const exRaw = await traced(`/exchange/ratios?league=${encodeURIComponent(leagueName)}&game=poe1`, {
    id: "poewatch.exchange", endpointFamily: "exchange",
  });
  const exchange = Array.isArray(exRaw?.items)
    ? exRaw.items.map(normaliseExchange).filter(Boolean)
    : [];

  const rate = watchDivineRate(rows, exchange);
  return {
    rows, exchange, counts, failed, source, sources,
    prices: watchPriceMap(rows, exchange),
    ...rate,
  };
}

/* Data freshness. A feed that has stopped moving looks exactly like a quiet
   market from the outside, so the run says which it is. */
export async function watchStatus() {
  const j = await tryWatch("/status");
  if (!j) return null;
  return { changeID: j.changeID, requested: j.requestedStashes, computed: j.computedStashes };
}

/* Rows for one category, in the shape the per-tab JSON files want.
   `change` is poe.watch's own day-over-day figure; the site's finer 4h/8h
   windows still come from its accumulated self-history, which has better
   resolution than a daily series. */
export function watchCategoryItems(rows, re, divineRate, cats = null, exchange = null) {
  // Exchange figures win here too, for the same reason they do in the price
  // map: traded beats asked.
  const byName = {};
  for (const x of (exchange || [])) {
    if (!x.lowConfidence && x.chaos > 0 && x.volume24H > 0) byName[x.name] = x;
  }

  const out = [];
  const seen = new Set();
  for (const r of rows) {
    // Categories narrow before the name test: a bare /fossil/i or /scarab/i
    // over every row invites a unique with the word in its name.
    if (cats && !catMatches(r.category, cats)) continue;
    if (!re.test(r.name) || seen.has(r.name)) continue;
    if (!isWatchBaseVariant(r)) continue;
    seen.add(r.name);
    const x = byName[r.name];
    const chaos = x ? x.chaos : r.chaos;
    // Seed the movement badges from poe.watch so a fresh deployment is not
    // blank; the site's own 4-hourly self-history replaces these as it fills.
    const change = x?.change24H ?? r.change ?? 0;
    out.push({
      id: r.id, name: r.name,
      chaosValue: roundPrice(chaos) ?? 0,
      divineValue: divineRate > 0 ? chaos / divineRate : 0,
      change24: change, change48: change,
      daily: x ? x.volume24H : r.daily,
      ...(x ? { exchange: true } : {}),
      ...(!x && r.lowConfidence ? { thin: true } : {}),
    });
  }
  return out;
}

/* ---------- beta "active price" ----------

   poe.watch's own item page shows an active price alongside the listing stats:
   a figure derived from what is clearing rather than from the cheapest ask.
   For a boss drop that is the number worth having — The Untouched Soul lists a
   20c floor against a 50c mean while the active price is 9c.

   One request per item, so callers pass only the names they need and the
   snapshot keeps its delay between calls. A failure is not fatal anywhere: the
   listing floor remains a perfectly good answer. */
export function betaUrl(id, league) {
  return `${SITE}/detailed/${encodeURIComponent(id)}/beta`
    + `?league=${encodeURIComponent(league)}&merchant=all&corrupted=any&scale=linear`;
}

export function adaptBeta(json) {
  const b = json?.betaPricing;
  const price = Number(b?.activePrice);
  if (!(price > 0)) return null;
  return {
    c: roundPrice(price),
    confidence: b.liveConfidence || null,
    lowConfidence: b.liveLowConfidence === true,
    samples: Number(b.liveSampleCount) || 0,
    asOf: b.livePriceAsOf || null,
    calculator: b.liveCalculatorVersion || null,
  };
}

export async function fetchWatchBeta(id, league) {
  const res = await fetch(betaUrl(id, league), { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for beta ${id}`);
  return adaptBeta(await res.json());
}
