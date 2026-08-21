/* ================================================================
   GEM LEVELLING PROFIT — pure maths, no React.

   The trade is: buy a gem at level 1, level it to its cap, then either
   sell it or spend a Vaal Orb on it. This module answers what that is
   worth, given poe.ninja's per-variant gem prices.

   poe.ninja prices a gem once per variant, and the variant string is
   the whole model: "20/20" is level 20, 20% quality, uncorrupted;
   "21/20c" is the same gem corrupted at level 21. Every tier this tab
   talks about is one of those rows, so nothing here holds a list of
   gem names — the level cap and quality cap of each gem are read off
   what poe.ninja lists for it.

   Corruption rules (poewiki, Vaal Orb). Four effects, equal weight:

     1/4  no effect beyond becoming corrupted
     1/4  level +1 or -1, 50/50            -> +1 is 1/8
     1/4  quality +1..10 or -1..10, 50/50  -> quality caps at 23
     1/4  the gem becomes its Vaal version

   A gem with no Vaal version — every support, every Awakened gem, the
   three exceptional gems — has nothing to become, so that quarter is
   treated as no effect. That is what keeps +1 level at the published
   1/8 rather than 1/6; `vaalSlot: "redistribute"` is the other reading
   and is offered as a setting rather than assumed away.
   ================================================================ */

export const SETTINGS_KEY = "sl.gems.settings.v1";

/* Level and quality both move by exactly one roll, so the outcome table is
   small enough to state literally. Splitting it out means test-gems.mjs can
   assert the weights sum to 1 without re-deriving them. */
export const CORRUPT = {
  none: 1 / 4,
  level: 1 / 4,      // half up, half down
  quality: 1 / 4,    // half up, half down, magnitude 1..10 uniform
  vaal: 1 / 4,
  qualityMax: 23,
  qualityRoll: 10,
};

export const DEFAULTS = {
  /* Below this many listings a market is called thin. poe.ninja's price is a
     listing floor, so a handful of asks can be one optimistic seller — which
     is exactly the case where a paper profit does not clear. Five is where the
     quote stops being one person's opinion; raise it if you want the filter
     stricter. */
  thinListings: 5,
  /* On by default. A gem whose profit rests on a market with a handful of
     listings is the common case, not the exception, and showing those first
     makes the whole list read as free money. Untick it to see them. */
  hideThin: true,
  /* Quality-up is capped at 23, so a 20% gem lands on 23 eight rolls in ten.
     Nothing else in the model is tunable: the corruption weights are published. */
  vaalSlot: "none",           // "none" | "redistribute"
  /* What the tab ranks by when nothing is chosen. */
  minTargetPrice: 0,          // chaos; drop gems worth less than this at the cap
  priceOverrides: {},

  /* ---- levelling time ----
     Gem experience per minute, measured rather than derived: 134.3M in 13
     minutes of Simulacrum at character level 100, 0% quality (Marcel, 3.28).
     Your own rate is whatever your farm actually pays, hence the box. */
  xpPerMinute: Math.round(134_300_000 / 13),
  /* Quality carried WHILE levelling an exceptional gem, which is not the same
     as the quality you sell it at. 20 from prisms plus 10 from a matching
     socket colour is the working setup. */
  xpQuality: 30,
  /* Per-family overrides for the totals below, empty unless you correct one. */
  xpTotals: {},
};

/* ---------------- levelling time ----------------

   How long a gem takes to reach its cap, which is the difference between a
   trade worth doing and one that ties up a gem slot all evening.

   Families are picked by LEVEL CAP, with one extra bit — whether the gem is a
   support — because the two gems that share cap 20 do not share a curve: an
   active gem needs 341.3M and a support 342.0M. That bit comes from the name
   ending in "Support", which is a pattern rather than a list, the same way
   scarab grouping and the category regexes work. Nothing here enumerates gems.

   Totals are cumulative experience from level 1, supplied from in-game data
   rather than scraped: poewiki's progression tables did not survive being read
   programmatically (they interleave the per-level and cumulative columns, and
   the figures that came back were an order of magnitude out). Every total is
   editable in the UI for that reason.

   `qualityXp` marks the families whose quality reads "This Gem gains (5-100)%
   increased Experience" — 5% per point. That is Empower, Enhance, Enlighten
   and their Awakened versions, which are the only Awakened exceptional gems.
   On every other gem quality does something else and buys no time. */
export const XP_PER_QUALITY = 5;      // % increased experience per 1% quality

export const XP_FAMILIES = [
  { key: "normal", cap: 20, support: false, label: "skill gem", xp: 341_331_311, qualityXp: false },
  { key: "normalSupport", cap: 20, support: true, label: "support gem", xp: 342_039_899, qualityXp: false },
  { key: "exceptional", cap: 3, label: "Empower / Enhance / Enlighten", xp: 1_666_045_137, qualityXp: true },
  { key: "awakenedExceptional", cap: 4, label: "Awakened Empower / Enhance / Enlighten", xp: 2_086_927_923, qualityXp: true },
  /* The only figure here not supplied from in-game data. It is poewiki's
     Awakened Added Fire Damage table, which at least sums correctly across its
     four steps, but it has not been checked against the game. */
  { key: "awakened", cap: 5, label: "other Awakened supports", xp: 192_082_865, qualityXp: false, unconfirmed: true },
];

export function xpFamily(maxLevel, isSupport = false) {
  return XP_FAMILIES.find((f) => f.cap === maxLevel && (f.support === undefined || f.support === isSupport)) || null;
}

/* Minutes to take one gem from level 1 to its cap. Returns null rather than a
   guess when the cap is not one this knows — a gem shape with no baseline is
   better left blank than given a made-up duration. */
export function levellingTime(maxLevel, {
  isSupport = false, xpPerMinute = DEFAULTS.xpPerMinute,
  xpQuality = DEFAULTS.xpQuality, xpTotals = {},
} = {}) {
  const family = xpFamily(maxLevel, isSupport);
  if (!family || !(xpPerMinute > 0)) return null;
  const total = xpTotals[family.key] > 0 ? xpTotals[family.key] : family.xp;
  const bonus = family.qualityXp ? (XP_PER_QUALITY * Math.max(0, xpQuality)) / 100 : 0;
  const effective = total / (1 + bonus);
  return { family, total, bonus, effective, minutes: effective / xpPerMinute };
}

/* Prices for these come out of prices.json like any other currency. */
export const GCP_NAME = "Gemcutter's Prism";
export const VAAL_ORB_NAME = "Vaal Orb";

/* ---------------- variant parsing ----------------

   poe.ninja's gem variant strings, as served by the stash item overview:

     "1"           level 1, no quality, uncorrupted
     "1/20"        level 1, 20% quality
     "20/20c"      level 20, 20% quality, corrupted
     "5"           an Awakened gem at level 5 (quality only feeds experience,
                   so those rows carry no quality at all)
     "20/20 Divergent"   alternate quality

   Alternate quality is a different item with a different acquisition route —
   you cannot Gemcutter a Superior gem into a Divergent one — so it is parsed
   and then excluded rather than silently mixed into the Superior market. */
const ALT_QUALITIES = ["Anomalous", "Divergent", "Phantasmal"];

export function parseVariant(variant) {
  if (variant == null) return null;
  const raw = String(variant).trim();
  if (!raw) return null;
  let alt = null;
  let head = raw;
  for (const a of ALT_QUALITIES) {
    if (head.toLowerCase().endsWith(a.toLowerCase())) {
      alt = a;
      head = head.slice(0, -a.length).trim();
      break;
    }
  }
  const m = /^(\d+)(?:\/(\d+))?\s*(c?)$/i.exec(head);
  if (!m) return null;
  return {
    level: Number(m[1]),
    quality: m[2] == null ? 0 : Number(m[2]),
    corrupted: m[3].toLowerCase() === "c",
    alt,
  };
}

export const variantKey = (level, quality, corrupted) =>
  `${level}/${quality}${corrupted ? "c" : ""}`;

/* How a tier is written on screen. "21/20" is how everyone says a level 21,
   20% quality gem, but "6/0" is not how anyone refers to an Awakened gem at
   level 6 — quality there is only experience, so the level is the whole name. */
export const tierLabel = (level, quality) => (quality > 0 ? `${level}/${quality}` : `level ${level}`);

/* ---------------- building gems out of snapshot rows ----------------

   Input is whatever `gems.json` carries: one row per gem name with its
   variants. Each variant is { l, q, c, v (chaos), n (listings) }. The same
   shape is produced straight off poe.ninja by the snapshot script, so the
   browser and the script run identical code over identical data. */

export function buildGems(rows = []) {
  const byName = {};
  for (const row of rows) {
    if (!row || !row.name) continue;
    const variants = {};
    for (const v of row.variants || []) {
      if (!(v.v > 0)) continue;
      variants[variantKey(v.l, v.q, !!v.c)] = {
        level: v.l, quality: v.q, corrupted: !!v.c,
        chaos: v.v, listings: v.n ?? null,
      };
    }
    if (!Object.keys(variants).length) continue;
    byName[row.name] = { name: row.name, icon: row.icon || null, spark: row.spark || null, variants };
  }

  /* The cap is whatever poe.ninja lists uncorrupted, which is the honest
     answer for every family at once: 20 for a normal gem, 5 for an Awakened
     one, 3 for Empower/Enhance/Enlighten. No table of gem names to maintain,
     and a gem GGG adds is modelled on the next snapshot. */
  const out = [];
  for (const gem of Object.values(byName)) {
    const clean = Object.values(gem.variants).filter((v) => !v.corrupted);
    if (!clean.length) continue;
    const maxLevel = Math.max(...clean.map((v) => v.level));
    const maxQuality = Math.max(...clean.map((v) => v.quality));
    // Nothing to level: poe.ninja only carries this gem at level 1, so there
    // is no target market and no trade to price.
    if (maxLevel <= 1) continue;
    const vaalName = `Vaal ${gem.name}`;
    out.push({
      ...gem,
      maxLevel,
      maxQuality,
      /* A Vaal gem is inherently corrupted, so it can never be the gem you
         buy, level and quality — it is only ever an outcome. */
      isVaal: /^Vaal /.test(gem.name),
      /* Which cap-20 experience curve applies. A pattern, not a list — every
         support gem in the game ends in "Support". */
      isSupport: / Support$/.test(gem.name),
      vaalName: byName[vaalName] ? vaalName : null,
    });
  }
  return { gems: out.filter((g) => !g.isVaal), byName };
}

/* ---------------- quoting a variant ----------------

   poe.ninja lists the variants people actually trade, which is not every
   (level, quality) pair. A corrupted 20/14 has no market of its own, so the
   quote walks down to the nearest listed corrupted variant at the same level
   and says so. Walking DOWN rather than to the nearest either way keeps the
   substitute a gem you could actually sell for at least that much. */
export function quoteVariant(gem, { level, quality, corrupted }, byName = null, name = null) {
  const source = name && byName ? byName[name] : gem;
  if (!source) return { chaos: 0, listings: null, exact: false, missing: true };
  const exact = source.variants[variantKey(level, quality, corrupted)];
  if (exact) return { chaos: exact.chaos, listings: exact.listings, exact: true, from: variantKey(level, quality, corrupted) };

  const sameLevel = Object.values(source.variants)
    .filter((v) => v.level === level && v.corrupted === corrupted && v.quality <= quality)
    .sort((a, b) => b.quality - a.quality)[0];
  if (sameLevel) {
    return {
      chaos: sameLevel.chaos, listings: sameLevel.listings, exact: false,
      from: variantKey(sameLevel.level, sameLevel.quality, sameLevel.corrupted),
    };
  }
  /* Nothing listed at or below that quality. Reach UP to the nearest listed
     one instead rather than calling the outcome worthless: a corrupted 20/15
     is worth less than the 20/20c above it, but it is not worth nothing, and
     zeroing an eighth of the outcome table would understate every EV on the
     page. This overstates, which is why the row is badged. */
  const nearest = Object.values(source.variants)
    .filter((v) => v.level === level && v.corrupted === corrupted)
    .sort((a, b) => a.quality - b.quality)[0];
  if (nearest) {
    return {
      chaos: nearest.chaos, listings: nearest.listings, exact: false,
      from: variantKey(nearest.level, nearest.quality, nearest.corrupted),
    };
  }
  /* Last resort: the same gem in the other corruption state. */
  const fallback = Object.values(source.variants)
    .filter((v) => v.level === level)
    .sort((a, b) => Math.abs(a.quality - quality) - Math.abs(b.quality - quality))[0];
  if (fallback) {
    return {
      chaos: fallback.chaos, listings: fallback.listings, exact: false,
      from: variantKey(fallback.level, fallback.quality, fallback.corrupted),
    };
  }
  return { chaos: 0, listings: null, exact: false, missing: true };
}

/* ---------------- the corruption outcome table ----------------

   Returned as display buckets rather than 22 individual rolls: the quality
   band 10..19 has no market of its own and neither does 21..22 in practice,
   so a row per roll would be 22 rows quoting the same three prices. Each
   bucket keeps its own probability and its own weighted price. */
export function corruptionOutcomes(gem, { vaalSlot = DEFAULTS.vaalSlot, overrides = {} } = {}, byName = null) {
  const L = gem.maxLevel;
  const Q = gem.maxQuality;
  const hasVaal = !!gem.vaalName;

  let pNone = CORRUPT.none;
  let pLevel = CORRUPT.level;
  let pQuality = CORRUPT.quality;
  let pVaal = CORRUPT.vaal;
  if (!hasVaal) {
    if (vaalSlot === "redistribute") {
      // Only three effects are possible, so each takes a third.
      pVaal = 0;
      pNone = pLevel = pQuality = 1 / 3;
    } else {
      // The roll happens and nothing comes of it.
      pNone += pVaal;
      pVaal = 0;
    }
  }

  const roll = CORRUPT.qualityRoll;
  /* Quality up: +1..+10 uniform, capped at 23. From 20% that is 21, 22 and
     then 23 for the remaining eight rolls, which is why 23 is the outcome
     people actually plan around. */
  const upBand = {};
  for (let d = 1; d <= roll; d++) {
    const q = Math.min(CORRUPT.qualityMax, Q + d);
    upBand[q] = (upBand[q] || 0) + 1 / roll;
  }
  const downBand = {};
  for (let d = 1; d <= roll; d++) {
    const q = Math.max(0, Q - d);
    downBand[q] = (downBand[q] || 0) + 1 / roll;
  }

  const band = (key, p, weights) => {
    let chaos = 0;
    let exact = true;
    let listings = null;
    let quality = null;
    const parts = [];
    for (const [q, w] of Object.entries(weights)) {
      const quote = quoteVariant(gem, { level: L, quality: Number(q), corrupted: true }, byName);
      chaos += w * quote.chaos;
      if (!quote.exact) exact = false;
      // The band's headline listing count is the one carrying most of the
      // weight — the roll you are actually hoping for.
      if (quality == null || w > weights[quality]) { quality = Number(q); listings = quote.listings; }
      parts.push({ quality: Number(q), p: w, chaos: quote.chaos, listings: quote.listings, exact: quote.exact });
    }
    return { key, label: qualityLabel(weights), p, chaos, exact, listings, level: L, quality, parts };
  };

  /* A roll that cannot change anything is the same outcome as no change, so
     it is folded in rather than listed twice: quality down on a 0% Awakened
     gem, and level down on a gem that only exists at one level. */
  const downQualities = Object.keys(downBand).map(Number);
  const qualityDownIsNoop = downQualities.length === 1 && downQualities[0] === Q;
  const levelDownPossible = L - 1 >= 1;
  if (qualityDownIsNoop) pNone += pQuality / 2;
  if (!levelDownPossible) pNone += pLevel / 2;

  const rows = [];
  rows.push({
    key: "same", label: hasVaal ? "No change" : "No change (incl. the Vaal roll)",
    p: pNone, level: L, quality: Q,
    ...pick(quoteVariant(gem, { level: L, quality: Q, corrupted: true }, byName)),
  });
  rows.push({
    key: "levelUp", label: `Level ${L + 1}`, p: pLevel / 2, level: L + 1, quality: Q,
    ...pick(quoteVariant(gem, { level: L + 1, quality: Q, corrupted: true }, byName)),
  });
  if (levelDownPossible) {
    rows.push({
      key: "levelDown", label: `Level ${L - 1}`, p: pLevel / 2, level: L - 1, quality: Q,
      ...pick(quoteVariant(gem, { level: L - 1, quality: Q, corrupted: true }, byName)),
    });
  }
  rows.push(band("qualityUp", pQuality / 2, upBand));
  if (!qualityDownIsNoop) rows.push(band("qualityDown", pQuality / 2, downBand));
  if (pVaal > 0) {
    rows.push({
      key: "vaal", label: gem.vaalName, p: pVaal, level: L, quality: Q, vaal: true,
      ...pick(quoteVariant(null, { level: L, quality: Q, corrupted: true }, byName, gem.vaalName)),
    });
  }
  /* A single-variant outcome is a market you can look up and correct; a band
     is an average over rolls poe.ninja does not list separately, so there is
     no one price to override. Only the former take an override. */
  for (const r of rows) {
    if (r.parts) continue;
    r.item = `${r.vaal ? gem.vaalName : gem.name} ${variantKey(r.level, r.quality, true)}`;
    const o = overrides[r.item];
    if (o > 0) { r.chaos = o; r.overridden = true; }
  }
  return rows.filter((r) => r.p > 0);
}

function pick(quote) {
  return { chaos: quote.chaos, listings: quote.listings, exact: quote.exact, missing: !!quote.missing, from: quote.from };
}

function qualityLabel(weights) {
  const qs = Object.keys(weights).map(Number).sort((a, b) => a - b);
  const lo = qs[0], hi = qs[qs.length - 1];
  return lo === hi ? `Quality ${lo}%` : `Quality ${lo}–${hi}%`;
}

/* ---------------- input cost ----------------

   Two ways to hold a level 1 gem at full quality, and which is cheaper moves
   week to week: buy the 1/20 someone already Gemcuttered, or buy the 1/0 and
   spend the prisms yourself. The tab takes the cheaper of the two and says
   which, because on a popular gem the 1/20 is routinely cheaper than 20
   prisms. Gems whose quality does nothing (Awakened) need no prisms at all,
   and this falls out of maxQuality being 0 for them. */
export function inputCost(gem, { gcp = 0, overrides = {} } = {}) {
  const Q = gem.maxQuality;
  const options = [];
  const listed = quoteVariant(gem, { level: 1, quality: Q, corrupted: false });
  if (listed.chaos > 0 && listed.exact) {
    options.push({ kind: "listed", label: `Buy 1/${Q}`, chaos: listed.chaos, listings: listed.listings });
  }
  const bare = quoteVariant(gem, { level: 1, quality: 0, corrupted: false });
  // On a gem whose quality does nothing — Awakened — the bare gem IS the
  // quality gem, so listing both routes would show the same purchase twice.
  if (Q > 0 && bare.chaos > 0 && bare.exact) {
    const prisms = Q > 0 ? Q * gcp : 0;
    options.push({
      kind: "gcp",
      label: Q > 0 ? `Buy 1/0 + ${Q} GCP` : "Buy 1/0",
      chaos: bare.chaos + prisms, listings: bare.listings, gemChaos: bare.chaos, prisms,
    });
  }
  const item = `${gem.name} input`;
  const override = overrides[item];
  if (!options.length) {
    // Nothing listed at level 1: the gem is bought at the cap or not at all.
    return { item, chaos: override > 0 ? override : 0, overridden: override > 0, missing: !(override > 0), options: [] };
  }
  options.sort((a, b) => a.chaos - b.chaos);
  const best = options[0];
  return {
    item,
    chaos: override > 0 ? override : best.chaos,
    overridden: override > 0,
    kind: best.kind, label: best.label, listings: best.listings, options,
  };
}

/* ---------------- one gem ---------------- */

export function computeGem(gem, ctx = {}) {
  const {
    gcp = 0, vaalOrb = 0, byName = null,
    vaalSlot = DEFAULTS.vaalSlot, overrides = {},
    xpPerMinute = DEFAULTS.xpPerMinute, xpQuality = DEFAULTS.xpQuality, xpTotals = {},
  } = ctx;

  const input = inputCost(gem, { gcp, overrides });
  const targetItem = `${gem.name} ${variantKey(gem.maxLevel, gem.maxQuality, false)}`;
  const targetQuote = quoteVariant(gem, { level: gem.maxLevel, quality: gem.maxQuality, corrupted: false });
  const targetOverride = overrides[targetItem];
  const target = {
    ...targetQuote,
    item: targetItem,
    chaos: targetOverride > 0 ? targetOverride : targetQuote.chaos,
    overridden: targetOverride > 0,
  };

  const outcomes = corruptionOutcomes(gem, { vaalSlot, overrides }, byName);
  const corruptEV = outcomes.reduce((sum, o) => sum + o.p * o.chaos, 0);

  const levelProfit = target.chaos > 0 && input.chaos > 0 ? target.chaos - input.chaos : null;
  const vaalProfit = corruptEV > 0 && input.chaos > 0 ? corruptEV - input.chaos - vaalOrb : null;
  const best = pickBest(levelProfit, vaalProfit);

  /* Every outcome that is worth less than the uncorrupted gem is a loss taken
     on purpose, so the downside is worth naming rather than hiding inside a
     mean: this is the share of corruptions that end below what you already
     had in hand. */
  const brickChance = target.chaos > 0
    ? outcomes.filter((o) => o.chaos < target.chaos).reduce((s, o) => s + o.p, 0)
    : null;

  /* How thin the trade actually is. Ranking by the worst market anywhere on
     the route would be led by outcomes worth nothing — the level 19 nobody
     wants is always the shallowest listing — so only the markets carrying at
     least a tenth of the money count. Those are the ones you have to sell
     into for the profit above to exist. */
  const material = outcomes.filter((o) => corruptEV > 0 && o.p * o.chaos >= 0.1 * corruptEV);
  const listingFloor = minListings(best.path === "vaal"
    ? [input.listings, ...material.map((o) => o.listings)]
    : [input.listings, target.listings]);

  /* Profit alone ranks a 30-minute normal gem above a 6-minute Empower that
     pays half as much, which is backwards if what you are spending is gem
     slots and evenings. Dividing by the time the gem occupies one is the
     comparison the tab was missing. */
  const xp = levellingTime(gem.maxLevel, { isSupport: gem.isSupport, xpPerMinute, xpQuality, xpTotals });
  const profitPerHour = xp && xp.minutes > 0 && best.value != null
    ? (best.value * 60) / xp.minutes
    : null;

  return {
    name: gem.name,
    icon: gem.icon,
    spark: gem.spark,
    maxLevel: gem.maxLevel,
    maxQuality: gem.maxQuality,
    vaalName: gem.vaalName,
    input,
    target,
    outcomes,
    /* The one outcome people plan around, lifted out for the list: a 1-in-8
       +1 level is the whole reason to put an orb on a finished gem, and it is
       not the same number as the average below. */
    levelUp: outcomes.find((o) => o.key === "levelUp") || null,
    corruptEV,
    vaalOrb,
    levelProfit,
    vaalProfit,
    profit: best.value,
    path: best.path,
    roi: best.value != null && input.chaos > 0 ? best.value / (input.chaos + (best.path === "vaal" ? vaalOrb : 0)) : null,
    brickChance,
    listingFloor,
    xp,
    profitPerHour,
    /* Almost every gem has SOME substituted quote — poe.ninja does not list a
       corrupted 20/14 for anything — so badging on that alone would put the
       badge on every row and mean nothing. It flags a substitution that is
       actually carrying the number. */
    approx: !target.exact || material.some((o) => !o.exact),
    unpriced: !(target.chaos > 0) || input.missing,
  };
}

function pickBest(levelProfit, vaalProfit) {
  if (levelProfit == null && vaalProfit == null) return { value: null, path: null };
  if (vaalProfit == null) return { value: levelProfit, path: "level" };
  if (levelProfit == null) return { value: vaalProfit, path: "vaal" };
  return vaalProfit > levelProfit ? { value: vaalProfit, path: "vaal" } : { value: levelProfit, path: "level" };
}

function minListings(values) {
  const nums = values.filter((v) => typeof v === "number" && isFinite(v));
  return nums.length ? Math.min(...nums) : null;
}

export function computeGems(rows, ctx = {}) {
  const { gems, byName } = buildGems(rows);
  return gems.map((g) => computeGem(g, { ...ctx, byName }));
}

/* ---------------- the profit curve ----------------

   `gems-history.json` stores one number per gem per snapshot: the profit the
   model saw at the time, under the published corruption weights. It is a
   snapshot-time figure — a price override or a changed assumption moves
   today's row and not the curve — because storing every variant price for
   every gem for a whole league would be a multi-megabyte download for a curve
   nobody reads that closely. The UI says so next to the chart. */
export function profitSeries(hist, name) {
  const rows = (hist && hist[name]) || [];
  return rows.filter((r) => r && isFinite(r.day) && isFinite(r.value));
}

/* ---------------- settings ---------------- */

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitizeSettings(JSON.parse(raw));
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function sanitizeSettings(raw) {
  const out = { ...DEFAULTS, priceOverrides: {}, xpTotals: {} };
  if (raw && typeof raw === "object") {
    if (typeof raw.hideThin === "boolean") out.hideThin = raw.hideThin;
    if (raw.vaalSlot === "redistribute" || raw.vaalSlot === "none") out.vaalSlot = raw.vaalSlot;
    for (const k of ["thinListings", "minTargetPrice", "xpPerMinute", "xpQuality"]) {
      const n = Number(raw[k]);
      if (isFinite(n) && n >= 0) out[k] = n;
    }
    if (raw.xpTotals && typeof raw.xpTotals === "object") {
      out.xpTotals = {};
      for (const f of XP_FAMILIES) {
        const n = Number(raw.xpTotals[f.key]);
        if (isFinite(n) && n > 0) out.xpTotals[f.key] = n;
      }
    }
    if (raw.priceOverrides && typeof raw.priceOverrides === "object") {
      for (const [k, v] of Object.entries(raw.priceOverrides)) {
        const price = Number(v);
        if (isFinite(price) && price > 0) out.priceOverrides[k] = price;
      }
    }
  }
  out.thinListings = Math.min(10000, Math.round(out.thinListings));
  return out;
}
