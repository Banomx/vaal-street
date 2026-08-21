/* Pure calculation layer for the Delve tab. No React, so the maths is
   testable on its own (scripts/tests/poe1/test-delve.mjs).

   Four things are computed here:

     target value  what one biome-exclusive fossil encounter is worth.
     biome share   how much of the mine that biome occupies at a given
                   depth, from the data-mined spawn weights.
     depth value   expected value of one fossil node outside Smuggler's Stashes using the
                   explicitly labelled community special-node curve.
     opportunity   a relative 0-100 routing index from biome share and that
                   community depth-adjusted node value.
     sample value  a personal low/median/high hourly projection, shown only
                   when a saved profile contains timed observations.
     boss value    expected chaos per kill, and the SHAPE of that: a
                   16% Doryani's Machinarium makes the mean a number you
                   will rarely see on any single kill, and you get a
                   handful of these a league, not thirty in a row.

   The boss drop maths is deliberately not reimplemented — delve bosses
   are declared in bossData.js's group shape and priced by its
   computeBoss(), so there is exactly one drop engine in the codebase. */

import { computeBoss } from "../bosses/bossProfit.js";
import {
  BIOMES, BIOME_BY_ID, DELVE_BOSSES, DELVE_BOSS_BY_ID,
  DEFAULTS, GUIDE_SAMPLE, FALLBACKS, FOSSILS, COMMUNITY_DEPTH_GUIDE,
} from "./delveData.js";

export const SETTINGS_KEY = "sl.delve.settings.v1";
export const SAMPLE_PROFILES_KEY = "sl.delve.sampleProfiles.v1";
export const ACTIVE_SAMPLE_PROFILE_KEY = "sl.delve.activeSampleProfile.v1";

const num = (v, d) => (v == null || !isFinite(Number(v)) ? d : Number(v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function rangeStats(values) {
  const sorted = values.filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return { low: 0, median: 0, high: 0 };
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { low: sorted[0], median, high: sorted[sorted.length - 1] };
}

/* ---------------- depth -> spawn weight ----------------

   The documented data gives two ends of the ramp but not the non-linear
   middle curve. Smoothstep is the honest stand-in: it matches both endpoints
   exactly, is monotonic, and eases at each end. Anything between the
   thresholds is therefore approximate, and the UI says so rather than
   presenting an interpolated share as fact. */
export function weightAt(biome, depth) {
  const { lo, hi } = biome.weight;
  const d = num(depth, 0);
  if (d <= lo.depth) return lo.weight;
  if (d >= hi.depth) return hi.weight;
  const t = (d - lo.depth) / (hi.depth - lo.depth);
  const s = t * t * (3 - 2 * t);
  return lo.weight + (hi.weight - lo.weight) * s;
}

/* Is this depth inside the ramp (interpolated) or past it (exact)? */
export function weightExact(biome, depth) {
  const d = num(depth, 0);
  return d <= biome.weight.lo.depth || d >= biome.weight.hi.depth;
}

/* Share of the mine each biome occupies at `depth`. Weights are relative,
   so the share is a biome's weight over the total of all of them. */
export function biomeShares(depth) {
  const rows = BIOMES.map((b) => ({ biome: b, weight: weightAt(b, depth), exact: weightExact(b, depth) }));
  const total = rows.reduce((s, r) => s + r.weight, 0);
  for (const r of rows) r.share = total > 0 ? r.weight / total : 0;
  return { rows, total };
}

/* Community working curves. Only the cap depths/chances are commonly cited;
   the exact server-side curve is unknown. Linear interpolation from each
   encounter's unlock depth is deliberately simple, visible in the UI and easy
   to replace if GGG or a sufficiently large sample publishes a better model. */
export function communityChanceAt(depth, minDepth, guide) {
  const d = num(depth, 0);
  const start = Math.max(1, num(minDepth, 1));
  if (d < start) return 0;
  const capDepth = Math.max(start, num(guide?.capDepth, start));
  const capChance = Math.min(1, Math.max(0, num(guide?.capChance, 0)));
  if (d >= capDepth || capDepth === start) return capChance;
  return capChance * ((d - start + 1) / (capDepth - start + 1));
}

export const communitySpecialChance = (depth, minDepth = 35) =>
  communityChanceAt(depth, minDepth, COMMUNITY_DEPTH_GUIDE.specialNode);

export const communityBossChance = (depth, minDepth) =>
  communityChanceAt(depth, minDepth, COMMUNITY_DEPTH_GUIDE.bossInCity);

/* ---------------- prices ----------------

   `priceOf(name)` is supplied by the caller so the same engine works off
   the fossils.json snapshot (which carries trend data) or the broader
   prices.json map (which does not), without knowing which it got. */

export function makePriceOf(sources = [], { overrides = {}, divineRate = 0 } = {}) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const index = new Map();
  for (const src of sources) {
    if (!src) continue;
    for (const [name, entry] of Object.entries(src)) {
      const k = norm(name);
      if (!index.has(k)) index.set(k, { name, entry });
    }
  }
  return function priceOf(name) {
    const override = Number(overrides[name]);
    if (overrides[name] != null && isFinite(override) && override > 0) {
      return { chaos: override, found: true, overridden: true, entry: null };
    }
    const hit = index.get(norm(name));
    if (hit && hit.entry && hit.entry.c > 0) {
      return { chaos: hit.entry.c, found: true, overridden: false, entry: hit.entry };
    }
    const fb = FALLBACKS[name];
    if (fb) {
      const c = fb.chaos > 0 ? fb.chaos : fb.divine > 0 && divineRate > 0 ? fb.divine * divineRate : 0;
      if (c > 0) return { chaos: c, found: true, overridden: false, fallback: fb, entry: null };
    }
    return { chaos: 0, found: false, overridden: false, entry: null };
  };
}

/* ---------------- fossils ---------------- */

export function fossilRows(priceOf) {
  return FOSSILS.map((f) => {
    const p = priceOf(f.name);
    return { ...f, chaos: p.chaos, found: p.found, overridden: p.overridden, entry: p.entry };
  }).sort((a, b) => b.chaos - a.chaos);
}

/* ---------------- biomes ----------------

   The unit here is ONE NODE, deliberately.

   The first version quoted biomes "per delve level", which meant
   node value x how often you find one — and how often you find one is
   published nowhere, so the headline rode on a number I made up. It was
   wrong by 3x, and no amount of labelling fixes a figure whose biggest
   input is a guess. A node value is price x count: the count is still an
   assumption, but a small, checkable one ("a Crystal Spire drops about
   three Hollow Fossils"), not a frequency nobody can observe.

   A normal biome's headline is its exclusive fossil encounter: the active
   sample profile's quantity times the live fossil price. The community depth
   value treats a fossil node outside Smuggler's Stashes as either that special encounter or
   a generic fossil node. City bosses live in their own calculation and never
   enter this ranking. Smuggler's Stashes use low/median/high pool scenarios because no public data establishes equal fossil probabilities. */

export function computeBiome(biome, priceOf, settings = {}, stashRange = null) {
  const s = { ...DEFAULTS, ...GUIDE_SAMPLE, ...settings };
  /* The biome's own fossil list. Nothing in the value model reads it any more —
     a fossil node here is the named node or a stash, and both have their own
     pools — but it is still what the biome drops, and the wall filter applies
     to it: Fundamental is behind a wall in Magma Fissure and lies about freely
     in Sulphur Vents. */
  const poolNames = biome.pool.filter((n) => s.openWalls || !(biome.walls || []).includes(n));
  const poolPrices = byPriceDesc(poolNames.map((n) => ({ name: n, ...priceOf(n) })));
  const priced = poolPrices.filter((p) => p.found).map((p) => p.chaos);
  const poolRange = rangeStats(priced);
  const poolCoverage = poolNames.length ? priced.length / poolNames.length : 1;

  let exclusive = null;
  if (biome.exclusive) {
    const p = priceOf(biome.exclusive.fossil);
    const available = weightAt(biome, s.depth) > 0 && s.depth >= biome.exclusive.minDepth;
    exclusive = {
      ...biome.exclusive, chaos: p.chaos, found: p.found,
      available,
      qty: s.exclusiveQty,
      nodeValue: s.exclusiveQty * p.chaos,
    };
  }

  /* A fossil node is either the biome's special node or a Smuggler's Stash.
     There is no third "generic fossil node": loose fossils drop as ordinary
     loot from any node, which is not a node type you can steer towards. The
     stash pool is mine-wide, so it is passed in rather than derived per biome. */
  const stash = stashRange || computeStash(priceOf, s).range;
  const headline = exclusive ? exclusive.nodeValue : 0;
  const headlineLabel = exclusive ? exclusive.node : "No exclusive fossil node";
  const specialChance = exclusive?.available
    ? communitySpecialChance(s.depth, exclusive.minDepth)
    : 0;
  const depthAdjustedRange = exclusive ? {
    low: specialChance * exclusive.nodeValue + (1 - specialChance) * stash.low,
    median: specialChance * exclusive.nodeValue + (1 - specialChance) * stash.median,
    high: specialChance * exclusive.nodeValue + (1 - specialChance) * stash.high,
  } : { low: 0, median: 0, high: 0 };
  const depthAdjustedFound = !!(exclusive?.found && stash.median > 0);

  return {
    biome, poolNames, poolPrices, poolRange, poolCoverage,
    exclusive, stashRange: stash,
    headline, headlineLabel,
    specialChance, depthAdjustedRange, depthAdjustedFound,
  };
}

/* Cluster nodes — a Smuggler's Stash and a fractured wall. Neither is a biome
   encounter: both draw on a mine-wide fossil pool and hand over a cluster
   rather than one fossil, so both are computed once and share this shape.

   Low is the smallest cluster at the cheapest priced outcome, high the largest
   at the dearest, median the mean cluster at the median outcome. Nothing here
   claims a distribution between the fossils — no public data gives one. */
/* Dearest first, unpriced last. A pool list is read to find what is worth
   picking up, so alphabetical order buries the answer. */
function byPriceDesc(rows) {
  return rows.slice().sort((a, b) => {
    if (a.found !== b.found) return a.found ? -1 : 1;
    return (b.chaos || 0) - (a.chaos || 0) || a.name.localeCompare(b.name);
  });
}

function clusterNode(priceOf, poolFossils, qtyLowRaw, qtyHighRaw) {
  const poolNames = poolFossils.map((f) => f.name);
  const poolPrices = byPriceDesc(poolNames.map((n) => ({ name: n, ...priceOf(n) })));
  const priced = poolPrices.filter((p) => p.found).map((p) => p.chaos);
  const poolRange = rangeStats(priced);
  const qtyLow = Math.min(qtyLowRaw, qtyHighRaw);
  const qtyHigh = Math.max(qtyLowRaw, qtyHighRaw);
  return {
    poolNames, poolPrices, poolRange,
    poolCoverage: poolNames.length ? priced.length / poolNames.length : 1,
    qtyLow, qtyHigh,
    range: {
      low: qtyLow * poolRange.low,
      median: ((qtyLow + qtyHigh) / 2) * poolRange.median,
      high: qtyHigh * poolRange.high,
    },
    found: priced.length > 0,
  };
}

/* A stash chest can hand over any fossil except the six biome targets, which
   drop only from their own named node, and the wall fossils, which a fractured
   wall hands over instead. Both exclusions are unconditional, so unlike the
   biome pools this one does not move with openWalls. */
export function computeStash(priceOf, settings = {}) {
  const s = { ...DEFAULTS, ...GUIDE_SAMPLE, ...settings };
  return clusterNode(priceOf, FOSSILS.filter((f) => !f.exclusive && !f.wall), s.stashQtyLow, s.stashQtyHigh);
}

/* A fractured wall is the mirror image: it holds the fossils a wall can hand
   over, which the stash pool leaves out. It is not a fossil node either — it turns
   up in the darkness on the way to one — so its share is per node travelled
   to and sits outside the special/stash split rather than competing with it. */
export function computeWalls(priceOf, settings = {}) {
  const s = { ...DEFAULTS, ...GUIDE_SAMPLE, ...settings };
  return clusterNode(priceOf, FOSSILS.filter((f) => !f.exclusive && f.wall), s.wallQtyLow, s.wallQtyHigh);
}

/* One cluster node's value day by day, from the fossil price history. The day
   axis is every day any pool fossil was priced; a day with no priced fossil
   contributes nothing rather than a zero. */
export function clusterValueSeries(cluster, histories, settings = {}) {
  const s = { ...DEFAULTS, ...GUIDE_SAMPLE, ...settings };
  const daySet = new Set();
  for (const name of cluster.poolNames) for (const p of (histories?.[name] || [])) daySet.add(p.day);
  const days = [...daySet].sort((a, b) => a - b);
  if (days.length < 2) return [];
  const meanQty = (cluster.qtyLow + cluster.qtyHigh) / 2;
  return days.map((day) => {
    const priced = [];
    for (const name of cluster.poolNames) {
      const h = histories?.[name];
      if (!h || !h.length) continue;
      const pt = h.find((p) => p.day === day);
      if (pt && pt.value > 0) priced.push(pt.value);
    }
    return { day, value: rangeStats(priced).median * meanQty };
  }).filter((p) => p.value > 0);
}

export function personalProjection(row, sample, stashRange = null) {
  if (!sample?.hasTimedSample || !row.exclusive?.found) return null;
  const point = (key) => (
    sample.exclusivePerHour * row.exclusive.nodeValue
    + sample.stashPerHour * (stashRange ? stashRange[key] : 0)
  );
  return { low: point("low"), median: point("median"), high: point("high") };
}

/* Opportunity combines the community depth-adjusted value of one fossil node
   outside Smuggler's Stashes with the data-mined biome share, then normalises the result.
   It remains a relative routing score rather than chaos per generated node. */
export function computeBiomes(priceOf, settings = {}, sample = null) {
  const s = { ...DEFAULTS, ...GUIDE_SAMPLE, ...settings };
  const { rows } = biomeShares(s.depth);
  const stash = computeStash(priceOf, s);
  const walls = computeWalls(priceOf, s);
  const shareBy = Object.fromEntries(rows.map((r) => [r.biome.id, r]));
  let out = BIOMES.map((b) => {
    const c = computeBiome(b, priceOf, s, stash.range);
    const sh = shareBy[b.id];
    const opportunityRaw = c.exclusive?.available && c.depthAdjustedFound
      ? sh.share * c.depthAdjustedRange.median
      : 0;
    return {
      ...c,
      weight: sh.weight,
      share: sh.share,
      exact: sh.exact,
      opportunityRaw,
      personalRange: personalProjection(c, sample, stash.range),
    };
  });
  /* How often a fossil node is a stash rather than the biome's special node,
     across the mine. Each biome's special-node chance keys off its own unlock
     depth, so the mine-wide figure is weighted by biome share. This is the
     complement of the special-node curve by construction: at depth 300 that is
     roughly 16% special and 84% stash, reaching the 90/10 cap at depth 1500. */
  const fossilBiomes = out.filter((r) => !r.biome.city && r.exclusive && r.share > 0);
  const fossilShare = fossilBiomes.reduce((t, r) => t + r.share, 0);
  const meanSpecial = fossilShare > 0
    ? fossilBiomes.reduce((t, r) => t + r.share * r.specialChance, 0) / fossilShare
    : 0;
  stash.share = 1 - meanSpecial;
  /* A stash is scored the same way a biome is — how often you get one times
     what it is worth — and normalised against the same leader. The two shares
     have different denominators (a biome's is share of the mine, a stash's is
     share of fossil nodes), so this stays a relative routing score rather than
     currency, which is all Opportunity ever claimed to be. A stash never
     vanishes with depth: at the 1500 cap it is still one fossil node in ten. */
  stash.opportunityRaw = stash.found ? stash.share * stash.range.median : 0;
  /* A wall's share is per node travelled to rather than per fossil node, so it
     is a third denominator in the same relative score. Kept here because the
     question the ranking answers — what is worth steering towards — is the same
     one for a wall as for a biome. */
  walls.share = COMMUNITY_DEPTH_GUIDE.fracturedWall.chance;
  walls.opportunityRaw = walls.found ? walls.share * walls.range.median : 0;

  const topOpportunity = Math.max(0, stash.opportunityRaw, walls.opportunityRaw, ...out.map((r) => r.opportunityRaw));
  const toIndex = (raw) => (topOpportunity > 0 ? (raw / topOpportunity) * 100 : 0);
  out = out.map((r) => ({ ...r, opportunityIndex: toIndex(r.opportunityRaw) }));
  stash.opportunityIndex = toIndex(stash.opportunityRaw);
  walls.opportunityIndex = toIndex(walls.opportunityRaw);
  const anyInterpolated = out.some((r) => !r.exact && r.weight > 0);
  return {
    rows: out,
    stash,
    walls,
    targets: out.filter((r) => !r.biome.city && r.exclusive),
    cities: out.filter((r) => r.biome.city),
    anyInterpolated,
    depth: s.depth,
  };
}

/* A biome's node value, day by day, from the fossil price history.

   Same question the mechanic panel's "set total across the league" answers,
   asked of a biome instead of a scarab set: is this biome's exclusive target
   getting better, or did everything just go up? The day axis comes only from
   that target fossil; common-pool history cannot manufacture extra points.

   City biomes have no fossil pool, so they get no curve — their value is
   their boss, and a boss drop table has no price history of its own. An
   empty array is the honest answer there, not a flat line. */
export function biomeValueSeries(biome, histories, settings = {}, bossValue = null) {
  const names = biome.exclusive ? [biome.exclusive.fossil] : [];
  const daySet = new Set();
  for (const n of names) for (const p of (histories?.[n] || [])) daySet.add(p.day);
  const days = [...daySet].sort((a, b) => a - b);
  if (days.length < 2) return [];
  return days.map((d) => {
    const priceOf = (name) => {
      const h = histories?.[name];
      if (!h || !h.length) return { chaos: 0, found: false };
      const pt = h.find((p) => p.day === d)
        ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]);
      return { chaos: pt.value, found: pt.value > 0 };
    };
    return { day: d, value: computeBiome(biome, priceOf, settings, bossValue).headline };
  });
}

/* ---------------- bosses ---------------- */

export function computeDelveBosses(resolve, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const bossOv = settings.bosses || {};
  const { rows } = biomeShares(s.depth);
  return DELVE_BOSSES.map((b) => {
    const rawOverride = bossOv[b.id] || {};
    // Before the unique pools were modelled explicitly, the Delve editor saved
    // every percentage under `chance`. Preserve those local profiles by moving
    // old pool values to `share` at calculation time.
    const drops = { ...(rawOverride.drops || {}) };
    for (const group of b.groups.filter((candidate) => candidate.kind === "pool")) {
      for (const drop of group.drops) {
        const key = drop.key || drop.item;
        const old = drops[key];
        if (old?.share == null && old?.chance != null) drops[key] = { ...old, share: old.chance };
      }
    }
    const computed = computeBoss(b, resolve, { ...rawOverride, drops });
    const biome = BIOME_BY_ID[b.biome];
    const sh = biome ? weightAt(biome, s.depth) : 0;
    const share = rows.find((r) => r.biome.id === b.biome)?.share ?? 0;
    const available = s.depth >= b.minDepth;
    const encounterChance = available ? communityBossChance(s.depth, b.minDepth) : 0;
    return {
      ...computed, delve: b, biome, weight: sh, share,
      available,
      encounterChance,
      bossComponentPerCityNode: computed.gross * encounterChance,
      bossComponentPerMineNode: computed.gross * encounterChance * share,
    };
  });
}

/* ---------------- one kill, not thirty ----------------

   Expected value is a long-run average, and nobody delves a boss long-run.
   This rolls a single kill `trials` times and reports the distribution, so
   the tab can say "the mean is 400c, but half your kills come in under
   180c" instead of quoting the mean alone and letting it read as typical.

   Seeded, so the numbers don't flicker while you edit a rate. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function killDistribution(computed, trials = 4000, seed = 0xd317e) {
  const rnd = mulberry32(seed);
  const pools = [], weighted = [], indep = [];
  for (const g of computed.groups) {
    const lines = g.lines.map((l) => ({
      p: l.rate, v: l.unit, qty: l.qty,
      variants: l.priceEntry?.components?.map((part) => part.chaos).filter((value) => value > 0) || null,
    }));
    if (g.kind === "pool") pools.push({ rolls: g.rolls, lines });
    else if (g.kind === "weighted") weighted.push({ base: g.base, total: g.totalWeight, lines });
    else indep.push({ lines, scale: g.scaled ? 1 + computed.quantity / 100 : 1 });
  }
  const lineValue = (line) => line.variants?.length
    ? line.variants[Math.floor(rnd() * line.variants.length)]
    : line.v;
  const vals = new Array(trials);
  for (let t = 0; t < trials; t++) {
    let v = 0;
    for (const g of pools) {
      for (let r = 0; r < g.rolls; r++) {
        let x = rnd(), acc = 0;
        for (const l of g.lines) { acc += l.p; if (x <= acc) { v += lineValue(l); break; } }
      }
    }
    for (const g of weighted) {
      if (rnd() < g.base && g.total > 0) {
        let x = rnd() * g.total, acc = 0;
        for (const l of g.lines) { acc += l.p; if (x <= acc) { v += lineValue(l); break; } }
      }
    }
    for (const g of indep) {
      for (const l of g.lines) {
        // A rate above 100% is "one guaranteed copy plus a chance at
        // another" — split it rather than clamping, which would quietly
        // cap the drop at one and undercount the boss.
        const rate = l.p * g.scale;
        const whole = Math.floor(rate);
        for (let copy = 0; copy < whole; copy++) v += lineValue(l);
        if (rnd() < rate - whole) v += lineValue(l);
      }
    }
    vals[t] = v;
  }
  vals.sort((a, b) => a - b);
  const q = (f) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * vals.length)))];
  return {
    mean: mean(vals),
    median: q(0.5),
    p10: q(0.10),
    p25: q(0.25),
    p75: q(0.75),
    p90: q(0.90),
    // "how often does a kill land under half the mean" — the number that
    // tells you whether the average is a lie for any single fight
    blank: vals.filter((v) => v === 0).length / vals.length,
    trials,
  };
}

/* ---------------- observation profiles ---------------- */

export const SAMPLE_FIELDS = [
  { key: "minutes", label: "Minutes observed", step: 1 },
  { key: "exclusiveNodes", label: "Exclusive fossil nodes", step: 1 },
  { key: "exclusiveFossils", label: "Exclusive fossils dropped", step: 1 },
  /* Stored keys stay `cache*`: they are persisted in the saved sample profiles
     under sl.delve.sampleProfiles.v1, so renaming them would silently discard
     everyone's logged observations. Only the labels changed. */
  { key: "cacheNodes", label: "Smuggler's Stashes", step: 1 },
  { key: "cacheFossils", label: "Stash fossils dropped", step: 1 },
];

const emptyObservations = () => Object.fromEntries(SAMPLE_FIELDS.map((f) => [f.key, 0]));

export function defaultSampleProfile(name = "Guide baseline", builtIn = name === "Guide baseline") {
  return {
    name,
    builtIn,
    sampleDepth: 300,
    observations: emptyObservations(),
  };
}

export function sanitizeSampleProfile(raw, fallbackName = "My sample") {
  const cleanName = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName;
  const out = defaultSampleProfile(cleanName, false);
  const depth = Number(raw?.sampleDepth);
  if (isFinite(depth)) out.sampleDepth = Math.min(65535, Math.max(1, Math.round(depth)));
  for (const f of SAMPLE_FIELDS) {
    const n = Number(raw?.observations?.[f.key]);
    if (isFinite(n)) out.observations[f.key] = f.key === "minutes" ? Math.max(0, n) : Math.max(0, Math.round(n));
  }
  /* Profiles saved before fossil nodes collapsed to special-or-stash counted
     "generic fossil nodes" separately. Those observations were counting the
     same encounter, so they fold into the stash totals on load rather than
     being dropped. The migration is one-way and the old keys do not survive. */
  const legacyNodes = Number(raw?.observations?.genericNodes);
  const legacyFossils = Number(raw?.observations?.genericFossils);
  if (isFinite(legacyNodes) && legacyNodes > 0) out.observations.cacheNodes += Math.max(0, Math.round(legacyNodes));
  if (isFinite(legacyFossils) && legacyFossils > 0) out.observations.cacheFossils += Math.max(0, Math.round(legacyFossils));
  return out;
}

export function loadSampleProfiles() {
  const guide = defaultSampleProfile();
  try {
    const parsed = JSON.parse(localStorage.getItem(SAMPLE_PROFILES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [guide];
    const customs = parsed
      .map((p, i) => sanitizeSampleProfile(p, `My sample ${i + 1}`))
      .filter((p) => p.name !== guide.name);
    return [guide, ...customs];
  } catch {
    return [guide];
  }
}

export function saveSampleProfiles(profiles) {
  try {
    const customs = profiles.filter((p) => !p.builtIn).map((p) => sanitizeSampleProfile(p));
    localStorage.setItem(SAMPLE_PROFILES_KEY, JSON.stringify(customs));
  } catch { /* quota / private mode */ }
}

export function loadActiveSampleProfile(profiles) {
  try {
    const name = localStorage.getItem(ACTIVE_SAMPLE_PROFILE_KEY);
    if (name && profiles.some((p) => p.name === name)) return name;
  } catch { /* private mode */ }
  return profiles[0]?.name || "Guide baseline";
}

export function saveActiveSampleProfile(name) {
  try { localStorage.setItem(ACTIVE_SAMPLE_PROFILE_KEY, name); } catch { /* private mode */ }
}

export function uniqueSampleName(profiles, base) {
  if (!profiles.some((p) => p.name === base)) return base;
  let i = 2;
  while (profiles.some((p) => p.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function sampleMetrics(profile) {
  const p = profile?.builtIn ? profile : sanitizeSampleProfile(profile || {});
  const o = { ...emptyObservations(), ...(p.observations || {}) };
  const average = (nodes, fossils, fallback) => nodes > 0 ? fossils / nodes : fallback;
  const exclusiveQty = average(o.exclusiveNodes, o.exclusiveFossils, GUIDE_SAMPLE.exclusiveQty);
  /* A measured average is a point estimate, so a profile with logged stashes
     collapses the guide's 4-10 spread onto its own number rather than keeping
     a range it did not observe. */
  const stashObserved = o.cacheNodes > 0 ? o.cacheFossils / o.cacheNodes : null;
  const stashQtyLow = stashObserved ?? GUIDE_SAMPLE.stashQtyLow;
  const stashQtyHigh = stashObserved ?? GUIDE_SAMPLE.stashQtyHigh;
  const totalEncounters = o.exclusiveNodes + o.cacheNodes;
  // A timed route with zero fossil encounters is still real evidence. Keeping
  // it as a zero-rate sample avoids biasing profiles toward successful runs.
  const hasTimedSample = o.minutes > 0;
  const perHour = (count) => hasTimedSample ? count * 60 / o.minutes : 0;
  const warnings = [];
  for (const [nodes, fossils, label] of [
    [o.exclusiveNodes, o.exclusiveFossils, "exclusive"],
    [o.cacheNodes, o.cacheFossils, "stash"],
  ]) if (nodes === 0 && fossils > 0) warnings.push(`${label} fossils need at least one matching node`);
  return {
    profile: p,
    sampleDepth: p.sampleDepth,
    observations: o,
    quantities: {
      exclusiveQty, stashQtyLow, stashQtyHigh,
      wallQtyLow: GUIDE_SAMPLE.wallQtyLow, wallQtyHigh: GUIDE_SAMPLE.wallQtyHigh,
    },
    quantitySources: {
      exclusiveQty: o.exclusiveNodes > 0 ? "personal" : "observed",
      stashQtyLow: o.cacheNodes > 0 ? "personal" : "observed",
      stashQtyHigh: o.cacheNodes > 0 ? "personal" : "observed",
      // No sample field logs walls yet, so these stay on the working figures.
      wallQtyLow: "observed",
      wallQtyHigh: "observed",
    },
    exclusivePerHour: perHour(o.exclusiveNodes),
    stashPerHour: perHour(o.cacheNodes),
    exclusiveShare: totalEncounters > 0 ? o.exclusiveNodes / totalEncounters : null,
    totalEncounters,
    hasTimedSample,
    hasObservations: Object.values(o).some((v) => v > 0),
    warnings,
  };
}

/* ---------------- settings persistence ---------------- */

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
  const out = { ...DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof DEFAULTS[k] === "boolean") { if (typeof raw[k] === "boolean") out[k] = raw[k]; }
      else if (isFinite(Number(raw[k])) && raw[k] !== null && raw[k] !== "") out[k] = Math.max(0, Number(raw[k]));
    }
    if (raw.priceOverrides && typeof raw.priceOverrides === "object") {
      out.priceOverrides = {};
      for (const [k, v] of Object.entries(raw.priceOverrides)) {
        const price = Number(v);
        if (isFinite(price) && price > 0) out.priceOverrides[k] = price;
      }
    }
    if (raw.bosses && typeof raw.bosses === "object") {
      out.bosses = {};
      for (const [id, b] of Object.entries(raw.bosses)) if (DELVE_BOSS_BY_ID[id] && b && typeof b === "object") out.bosses[id] = b;
    }
  }
  out.depth = Math.min(65535, Math.max(1, Math.round(out.depth)));
  return out;
}
