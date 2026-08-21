/* Delve dataset + engine tests. Node only, no DOM:
     node scripts/test-delve.mjs

   Two jobs. Integrity — the dataset can't reference a fossil no biome
   lists, a biome whose depth ramp runs backwards, or a boss whose drop
   table doesn't match the wiki figures. And arithmetic — hand-checked
   fixtures for the biome value, the depth weighting, and the boss EV,
   so a refactor that changes a number has to change a number here too. */

import assert from "node:assert/strict";
import {
  BIOMES, FOSSILS, DELVE_BOSSES, DEFAULTS, GUIDE_SAMPLE, TUNABLES, NODES, FALLBACKS, SOURCES,
  COMMUNITY_DEPTH_GUIDE,
} from "../../../src/games/poe1/features/delve/delveData.js";
import {
  weightAt, weightExact, biomeShares, makePriceOf, fossilRows, rangeStats,
  computeBiome, computeBiomes, computeStash, computeWalls, clusterValueSeries,
  computeDelveBosses, killDistribution, sanitizeSettings,
  biomeValueSeries, defaultSampleProfile, sanitizeSampleProfile, uniqueSampleName, sampleMetrics,
  communityChanceAt, communitySpecialChance, communityBossChance,
} from "../../../src/games/poe1/features/delve/delve.js";
import { makeResolver, bossItems } from "../../../src/games/poe1/features/bosses/bossProfit.js";

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

console.log("delve dataset");

test("every biome has a sane depth ramp", () => {
  for (const b of BIOMES) {
    assert.ok(b.weight.lo.depth < b.weight.hi.depth, `${b.name}: ramp ends before it starts`);
    assert.ok(b.weight.lo.weight >= 0 && b.weight.hi.weight >= 0, `${b.name}: negative weight`);
    assert.notEqual(b.weight.lo.weight, b.weight.hi.weight, `${b.name}: ramp goes nowhere`);
  }
});

test("city biomes have a boss and no fossil pool; the others are the reverse", () => {
  for (const b of BIOMES) {
    if (b.city) {
      assert.equal(b.pool.length, 0, `${b.name}: city biome with a fossil pool`);
      assert.ok(b.boss && DELVE_BOSSES.some((x) => x.id === b.boss), `${b.name}: no boss`);
    } else {
      assert.ok(!b.boss, `${b.name}: non-city biome with a boss`);
    }
  }
});

test("the six exclusive fossils each belong to exactly one biome", () => {
  const excl = FOSSILS.filter((f) => f.exclusive);
  assert.equal(excl.length, 6, `expected 6 exclusive fossils, got ${excl.length}`);
  for (const f of excl) assert.equal(f.biomes.length, 1, `${f.name} is exclusive but in ${f.biomes.length} biomes`);
});

test("every fossil sits in at least one biome, and every pool name is a known fossil", () => {
  const names = new Set(FOSSILS.map((f) => f.name));
  for (const f of FOSSILS) assert.ok(f.biomes.length > 0, `${f.name} has no biome`);
  for (const b of BIOMES) for (const n of b.pool) assert.ok(names.has(n), `${b.name}: unknown fossil ${n}`);
});

test("every exclusive node in NODES matches its biome's declared node", () => {
  for (const n of NODES.filter((x) => x.kind === "exclusive")) {
    const b = BIOMES.find((x) => x.id === n.biome);
    assert.ok(b, `${n.name}: unknown biome ${n.biome}`);
    assert.equal(b.exclusive.node, n.name, `${n.name}: biome says ${b.exclusive.node}`);
    assert.equal(b.exclusive.fossil, n.fossil, `${n.name}: biome says ${b.exclusive.fossil}`);
  }
});

test("every guide yield names a real fallback and declares where it came from", () => {
  for (const t of TUNABLES) {
    assert.ok(t.key in GUIDE_SAMPLE, `yield ${t.key} has no guide fallback`);
    assert.ok(t.source in SOURCES, `tunable ${t.key} has no source tag`);
    assert.ok(t.help, `tunable ${t.key} has no explanation`);
  }
});

test("the guide baseline has no hidden extra fossil or boss-frequency knob", () => {
  const by = Object.fromEntries(TUNABLES.map((t) => [t.key, t]));
  assert.equal(by.exclusiveQty.source, "observed");
  assert.equal(by.stashQtyLow.source, "observed");
  assert.equal(by.stashQtyHigh.source, "observed");
  assert.ok(!("exclusiveExtra" in GUIDE_SAMPLE));
  assert.ok(!("bossPerCity" in DEFAULTS));
  assert.ok(GUIDE_SAMPLE.stashQtyLow < GUIDE_SAMPLE.stashQtyHigh, "the stash range must not be inverted");
  // Pinned so a stray edit to the baseline shows up as a failing test rather
  // than as quietly different EV on every biome card.
  assert.deepEqual(GUIDE_SAMPLE, { exclusiveQty: 1, stashQtyLow: 4, stashQtyHigh: 10, wallQtyLow: 4, wallQtyHigh: 6 });
});

test("all six exclusive encounters carry the data-mined tier, weight and minimum depth", () => {
  for (const b of BIOMES.filter((x) => x.exclusive)) {
    assert.equal(b.exclusive.tier, 4, `${b.name}: tier`);
    assert.equal(b.exclusive.weight, 100, `${b.name}: weight`);
    assert.ok(b.exclusive.minDepth >= 35, `${b.name}: minimum depth`);
  }
});

test("boss drop rates keep sampled values and visibly marked estimates separate", () => {
  const rate = (id, key) => {
    const b = DELVE_BOSSES.find((x) => x.id === id);
    const d = b.groups.flatMap((group) => group.drops).find((x) => (x.key || x.item) === key);
    assert.ok(d, `${id}: no drop line ${key}`);
    return d.share ?? d.chance;
  };
  near(rate("ahuatotli", "Cerberus Limb"), 0.60, 1e-9, "Cerberus Limb");
  near(rate("ahuatotli", "Curiosity"), 0.40, 1e-9, "Curiosity");
  near(rate("ahuatotli", "Doryani's Machinarium"), 0.16, 1e-9, "Machinarium");
  near(rate("kurgal", "hale-1"), 0.40, 1e-9, "Hale Negator 1s");
  near(rate("kurgal", "misery"), 0.20, 1e-9, "Misery in Darkness");
  near(rate("aul", "@auls-uprising"), 0.61, 1e-9, "Aul's Uprising");
  near(rate("aul", "Crown of the Tyrant"), 0.15, 1e-9, "Crown of the Tyrant");
  near(rate("kurgal", "zorath"), 0.50, 1e-9, "Zorath's preliminary rate");
  near(rate("aul", "Desecrated Virtue"), 0.03, 1e-9, "unpublished-rate default");
});

test("each boss has a guaranteed 100% unique pool and separate additional rolls", () => {
  for (const boss of DELVE_BOSSES) {
    const unique = boss.groups.find((group) => group.kind === "pool");
    const extra = boss.groups.find((group) => group.kind === "independent");
    assert.ok(unique, `${boss.name}: no unique pool`);
    assert.ok(extra, `${boss.name}: no additional-drop group`);
    near(unique.drops.reduce((sum, drop) => sum + drop.share, 0), 1, 1e-9, `${boss.name} pool`);
    assert.equal(unique.rolls, 1, `${boss.name}: unique pool must roll once`);
  }
});

test("unrated drop lines use the requested marked 3% default", () => {
  for (const b of DELVE_BOSSES) {
    for (const d of b.groups.flatMap((group) => group.drops)) {
      const rate = d.share ?? d.chance;
      if (d.unrated) {
        assert.equal(rate, 0.03, `${b.name}: ${d.item} does not use the 3% default`);
        assert.match(d.estimateNote || "", /3% default/i, `${b.name}: ${d.item} needs a visible notice`);
      }
      assert.ok(rate >= 0 && rate <= 1, `${b.name}: ${d.item} rate out of range`);
    }
  }
});

test("no declared price is stale or undated", () => {
  const declared = [
    ...Object.entries(FALLBACKS),
    ...DELVE_BOSSES.flatMap((boss) => boss.groups.flatMap((group) => group.drops)
      .filter((drop) => drop.fallback).map((drop) => [drop.item, drop.fallback])),
  ];
  for (const [name, fb] of declared) {
    assert.ok(fb.asOf, `${name}: declared price with no asOf`);
    assert.ok(fb.chaos > 0 || fb.divine > 0, `${name}: declared price with no value`);
  }
});

console.log("depth -> weight");

test("weights are exact at both ends of the ramp", () => {
  const frozen = BIOMES.find((b) => b.id === "frozen");
  assert.equal(weightAt(frozen, 10), 0);
  assert.equal(weightAt(frozen, 15), 0);
  assert.equal(weightAt(frozen, 30), 100);
  assert.equal(weightAt(frozen, 900), 100);
  assert.equal(weightExact(frozen, 30), true);
  assert.equal(weightExact(frozen, 22), false);
});

test("Mines ramps down, not up", () => {
  const mines = BIOMES.find((b) => b.id === "mines");
  assert.equal(weightAt(mines, 10), 100);
  assert.equal(weightAt(mines, 60), 0);
  assert.ok(weightAt(mines, 40) < 100 && weightAt(mines, 40) > 0, "mid-ramp should be between the ends");
});

test("the ramp is monotonic", () => {
  for (const b of BIOMES) {
    const up = b.weight.hi.weight > b.weight.lo.weight;
    let prev = weightAt(b, 0);
    for (let d = 1; d <= 600; d += 1) {
      const w = weightAt(b, d);
      assert.ok(up ? w >= prev - 1e-9 : w <= prev + 1e-9, `${b.name} is not monotonic at depth ${d}`);
      prev = w;
    }
  }
});

test("shares sum to 1 and the deep-mine city shares match the wiki weights", () => {
  const { rows } = biomeShares(600);
  const total = rows.reduce((s, r) => s + r.share, 0);
  near(total, 1, 1e-9, "shares");
  // At depth 600 every ramp is finished: six 100-weight biomes plus
  // 23 + 23 + 17 for the cities. Mines is 0 by then.
  const denom = 6 * 100 + 23 + 23 + 17;
  near(rows.find((r) => r.biome.id === "vaal").share, 23 / denom, 1e-9, "Vaal Outpost");
  near(rows.find((r) => r.biome.id === "primeval").share, 17 / denom, 1e-9, "Primeval Ruins");
  near(rows.find((r) => r.biome.id === "mines").share, 0, 1e-9, "Mines");
});

test("current data-mined city biome ramps finish at their effect depths", () => {
  const caps = { vaal: [63, 23], "abyssal-city": [135, 23], primeval: [200, 17] };
  for (const [id, [depth, weight]] of Object.entries(caps)) {
    const biome = BIOMES.find((row) => row.id === id);
    assert.equal(biome.weight.hi.depth, depth, `${biome.name}: effect depth`);
    near(weightAt(biome, depth), weight, 1e-9, `${biome.name}: capped weight`);
  }
});

test("community depth curves start at unlock and reach their declared caps", () => {
  assert.equal(communitySpecialChance(34, 35), 0);
  assert.ok(communitySpecialChance(35, 35) > 0);
  near(communitySpecialChance(1500, 35), 0.90, 1e-9, "special-node cap");
  near(communitySpecialChance(3000, 35), 0.90, 1e-9, "special-node post-cap");

  assert.equal(communityBossChance(129, 130), 0);
  assert.ok(communityBossChance(130, 130) > 0);
  near(communityBossChance(600, 130), 0.15, 1e-9, "boss cap");
  near(communityChanceAt(10, 1, { capDepth: 10, capChance: 2 }), 1, 1e-9, "chance clamp");
  assert.deepEqual(COMMUNITY_DEPTH_GUIDE, {
    specialNode: { capDepth: 1500, capChance: 0.90 },
    bossInCity: { capDepth: 600, capChance: 0.15 },
    fracturedWall: { chance: 0.15 },
  });
});

console.log("biome value");

/* A price list simple enough to check the arithmetic by hand: every
   Abyssal Depths pool fossil at 10c, Hollow Fossil at 300c. */
const PRICES = {
  "Aberrant Fossil": { c: 10 }, "Bound Fossil": { c: 10 },
  "Gilded Fossil": { c: 10 }, "Lucent Fossil": { c: 10 },
  "Hollow Fossil": { c: 300 },
};
const priceOf = makePriceOf([PRICES]);

test("pool range and node values use the declared scenarios", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const s = { ...DEFAULTS, exclusiveQty: 3 };
  const r = computeBiome(abyssal, priceOf, s);
  assert.deepEqual(r.poolRange, { low: 10, median: 10, high: 10 });
  near(r.exclusive.nodeValue, 900, 1e-9, "Crystal Spire");
  near(r.headline, 900, 1e-9, "headline");
  assert.equal(r.headlineLabel, "Crystal Spire");
});

test("community Depth EV blends the special node against a stash, nothing else", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const s = { ...DEFAULTS, depth: 600, exclusiveQty: 3 };
  const r = computeBiome(abyssal, priceOf, s);
  const chance = communitySpecialChance(600, abyssal.exclusive.minDepth);
  const stash = computeStash(priceOf, s).range;
  near(r.specialChance, chance, 1e-9, "special replacement chance");
  near(r.depthAdjustedRange.median,
    chance * 900 + (1 - chance) * stash.median, 1e-9, "depth-adjusted node EV");
  assert.equal(r.depthAdjustedFound, true);
});

test("depth EV needs the target and the stash priced, not the biome's own list", () => {
  // The named node drops its own fossil and nothing else, so an unpriced biome
  // pool must not blank out a Depth EV the stash can still supply.
  const thin = makePriceOf([{ "Hollow Fossil": { c: 300 }, "Aetheric Fossil": { c: 9 } }]);
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const r = computeBiome(abyssal, thin, { ...DEFAULTS, depth: 600 });
  assert.equal(r.poolCoverage < 1, true, "the biome's own pool is mostly unpriced here");
  assert.equal(r.depthAdjustedFound, true, "but the target and the stash both have a price");
  assert.ok(r.depthAdjustedRange.median > 0);
});

test("range median averages the two middle values for an even pool", () => {
  assert.deepEqual(rangeStats([40, 10, 30, 20]), { low: 10, median: 25, high: 40 });
  assert.deepEqual(rangeStats([12]), { low: 12, median: 12, high: 12 });
  assert.deepEqual(rangeStats([]), { low: 0, median: 0, high: 0 });
});

test("nothing in the biome maths depends on a node frequency any more", () => {
  // The unit is one node. If a stray per-delve knob crept back in, feeding
  // it would move the numbers — and that is exactly the bug this replaced.
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const plain = computeBiome(abyssal, priceOf, DEFAULTS);
  const salted = computeBiome(abyssal, priceOf, {
    ...DEFAULTS, exclusivePerDelve: 99, genericPerDelve: 99, cachePerDelve: 99,
  });
  near(salted.headline, plain.headline, 1e-9, "headline");
  near(salted.depthAdjustedRange.median, plain.depthAdjustedRange.median, 1e-9, "depth EV");
  assert.ok(!("perDelve" in plain), "perDelve should be gone from the result");
});

test("city bosses are not mixed into the fossil-target model", () => {
  const vaal = BIOMES.find((b) => b.id === "vaal");
  const r = computeBiome(vaal, priceOf, DEFAULTS, 500);
  near(r.headline, 0, 1e-9, "city fossil headline");
  assert.equal(r.exclusive, null);
});

test("turning off fractured walls drops the wall-locked fossils from the pool", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const withWalls = computeBiome(abyssal, makePriceOf([{ ...PRICES, "Lucent Fossil": { c: 100 } }]), DEFAULTS);
  const without = computeBiome(abyssal, makePriceOf([{ ...PRICES, "Lucent Fossil": { c: 100 } }]), { ...DEFAULTS, openWalls: false });
  assert.ok(without.poolRange.high < withWalls.poolRange.high, "dropping a dear wall-locked fossil should lower the high scenario");
  assert.ok(!without.poolNames.includes("Lucent Fossil"), "Lucent should be gone");
  assert.ok(!without.poolNames.includes("Gilded Fossil"), "Gilded should be gone");
  near(without.exclusive.nodeValue, withWalls.exclusive.nodeValue, 1e-9, "walls must not move the target");
});

test("fractured walls are a biome property, not a fossil one", () => {
  const byName = Object.fromEntries(FOSSILS.map((f) => [f.name, f]));
  // The wiki lists Fundamental behind a wall in Magma Fissure and loose in
  // Sulphur Vents. `wallIn` keeps that per-biome fact, so closing walls removes
  // it from Magma's pool only.
  assert.deepEqual(byName["Fundamental Fossil"].wallIn, ["magma"]);
  const magma = BIOMES.find((b) => b.id === "magma");
  const sulphur = BIOMES.find((b) => b.id === "sulphur");
  assert.ok(!computeBiome(magma, priceOf, { ...DEFAULTS, openWalls: false }).poolNames.includes("Fundamental Fossil"));
  assert.ok(computeBiome(sulphur, priceOf, { ...DEFAULTS, openWalls: false }).poolNames.includes("Fundamental Fossil"));
  // `wall` is the coarser question the pools ask: can a wall hand you this at
  // all. Every fossil with a wall entry anywhere belongs to the wall pool.
  for (const name of ["Fundamental Fossil", "Gilded Fossil", "Lucent Fossil", "Sanctified Fossil", "Shuddering Fossil"]) {
    assert.equal(byName[name].wall, true, `${name} comes out of a wall somewhere`);
  }
  assert.equal(byName["Aberrant Fossil"].wall, false, "a fossil no biome walls off is not wall loot");
  // Wall fossils are never stash loot, whichever way the toggle is set.
  for (const walls of [true, false]) {
    const pool = computeStash(priceOf, { ...DEFAULTS, openWalls: walls }).poolNames;
    for (const name of ["Fundamental Fossil", "Gilded Fossil", "Lucent Fossil", "Sanctified Fossil", "Shuddering Fossil"]) {
      assert.ok(!pool.includes(name), `${name} must stay out of the stash with openWalls=${walls}`);
    }
  }
});

test("a Smuggler's Stash prices the generic pool for the whole mine, not one biome", () => {
  const stash = computeStash(priceOf, DEFAULTS);
  for (const f of FOSSILS.filter((x) => x.exclusive)) {
    assert.ok(!stash.poolNames.includes(f.name), `${f.name} is a biome target, not stash loot`);
  }
  assert.equal(stash.poolNames.length, FOSSILS.filter((f) => !f.exclusive && !f.wall).length);
  assert.equal(stash.qtyLow, GUIDE_SAMPLE.stashQtyLow);
  assert.equal(stash.qtyHigh, GUIDE_SAMPLE.stashQtyHigh);
  // Every priced non-exclusive fossil is 10c in this fixture, so the spread is
  // the cluster size alone: 4 at the cheapest, 7 (the mean cluster) at the
  // median, 10 at the dearest.
  near(stash.range.low, 40, 1e-9, "smallest cluster");
  near(stash.range.median, 70, 1e-9, "mean cluster at the median outcome");
  near(stash.range.high, 100, 1e-9, "largest cluster");
  assert.equal(stash.found, true);
});

test("the stash pool ignores the wall setting and survives an inverted range", () => {
  const closed = computeStash(priceOf, { ...DEFAULTS, openWalls: false });
  assert.deepEqual(closed.poolNames, computeStash(priceOf, DEFAULTS).poolNames,
    "the wall setting does not move the stash pool either way");
  const inverted = computeStash(priceOf, { ...DEFAULTS, stashQtyLow: 10, stashQtyHigh: 4 });
  assert.equal(inverted.qtyLow, 4, "a reversed range is read the right way round");
  assert.equal(inverted.qtyHigh, 10);
});

test("the stash is one figure for the mine, so every biome shares it", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  assert.ok(all.stash, "computeBiomes exposes the stash beside the biome rows");
  assert.ok(all.rows.every((r) => !("cacheRange" in r)), "no per-biome cache range survives");
});

test("the exclusive node is worth far more than an ordinary one, which is the point of the tab", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const r = computeBiome(abyssal, priceOf, DEFAULTS);
  assert.ok(r.exclusive.nodeValue > computeStash(priceOf, DEFAULTS).range.median,
    "with a 300c exclusive fossil the biome node should beat a median stash");
});

test("an unpriced fossil is excluded from the range, not counted as zero", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const partial = makePriceOf([{ "Aberrant Fossil": { c: 10 }, "Bound Fossil": { c: 30 } }]);
  const r = computeBiome(abyssal, partial, DEFAULTS);
  assert.deepEqual(r.poolRange, { low: 10, median: 20, high: 30 });
  near(r.poolCoverage, 0.5, 1e-9, "coverage");
});

test("the stash share is the mine-wide complement of the special-node curve", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  const fossilBiomes = all.rows.filter((r) => !r.biome.city && r.exclusive && r.share > 0);
  const totalShare = fossilBiomes.reduce((t, r) => t + r.share, 0);
  const meanSpecial = fossilBiomes.reduce((t, r) => t + r.share * r.specialChance, 0) / totalShare;
  near(all.stash.share, 1 - meanSpecial, 1e-9, "stash share of fossil nodes");
  assert.ok(all.stash.share > 0 && all.stash.share < 1);
  assert.equal(all.cities.length, 3);
  assert.equal(all.targets.length, 6);
});

test("a stash is scored and normalised on the same opportunity scale as a biome", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  near(all.stash.opportunityRaw, all.stash.share * all.stash.range.median, 1e-9, "stash raw score");
  const top = Math.max(all.stash.opportunityIndex, ...all.targets.map((r) => r.opportunityIndex));
  near(top, 100, 1e-9, "the leader is 100 whether it is a biome or the stash");
  assert.ok(all.stash.opportunityIndex > 0, "a stash never scores zero — it still spawns");
});

test("the stash keeps an opportunity score at the special-node cap", () => {
  // 90% special at depth 1500 still leaves one fossil node in ten a stash, so
  // it must stay on the board rather than dropping out of the ranking.
  const deep = computeBiomes(priceOf, { ...DEFAULTS, depth: COMMUNITY_DEPTH_GUIDE.specialNode.capDepth });
  assert.ok(deep.stash.opportunityIndex > 0, "a stash at the cap is still worth ranking");
  assert.ok(deep.stash.opportunityIndex < 100, "but the special nodes lead by then");
  const shallow = computeBiomes(priceOf, { ...DEFAULTS, depth: 300 });
  assert.ok(shallow.stash.opportunityIndex > deep.stash.opportunityIndex,
    "stashes matter more the shallower you are");
});

test("pool lists come back dearest first, with unpriced fossils at the end", () => {
  const thin = makePriceOf([{ "Sanctified Fossil": { c: 41.1 }, "Shuddering Fossil": { c: 22.9 }, "Gilded Fossil": { c: 9.7 }, "Fundamental Fossil": { c: 10.6 } }]);
  const walls = computeWalls(thin, DEFAULTS);
  assert.deepEqual(walls.poolPrices.map((p) => p.name),
    ["Sanctified Fossil", "Shuddering Fossil", "Fundamental Fossil", "Gilded Fossil", "Lucent Fossil"],
    "dearest first; the unpriced Lucent sinks to the bottom");
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const priced = computeBiome(abyssal, priceOf, DEFAULTS).poolPrices.filter((p) => p.found);
  for (let i = 1; i < priced.length; i++) {
    assert.ok(priced[i - 1].chaos >= priced[i].chaos, "biome pools are ordered too");
  }
});

test("a fractured wall holds exactly the fossils nothing else drops", () => {
  const walls = computeWalls(priceOf, DEFAULTS);
  const stash = computeStash(priceOf, DEFAULTS);
  assert.deepEqual(walls.poolNames.slice().sort(),
    FOSSILS.filter((f) => f.wall).map((f) => f.name).sort());
  assert.equal(walls.poolNames.length, 5);
  for (const name of walls.poolNames) {
    assert.ok(!stash.poolNames.includes(name), `${name} cannot be in both pools`);
  }
  // The two pools plus the six targets account for every fossil, with no overlap.
  assert.equal(walls.poolNames.length + stash.poolNames.length + 6, FOSSILS.length);
  assert.equal(walls.qtyLow, GUIDE_SAMPLE.wallQtyLow);
  assert.equal(walls.qtyHigh, GUIDE_SAMPLE.wallQtyHigh);
});

test("a wall is scored on its own per-node share, outside the special/stash split", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  near(all.walls.share, COMMUNITY_DEPTH_GUIDE.fracturedWall.chance, 1e-9, "wall share");
  near(all.walls.opportunityRaw, all.walls.share * all.walls.range.median, 1e-9, "wall raw score");
  // It must not be taken out of the fossil-node split, which stays whole.
  near(all.stash.share + all.rows.find((r) => r.biome.id === "abyssal").specialChance, 1, 0.05,
    "the special/stash split still accounts for every fossil node");
});

test("a cluster's value series needs two priced days and never plots a zero", () => {
  const stash = computeStash(priceOf, DEFAULTS);
  assert.deepEqual(clusterValueSeries(stash, {}, DEFAULTS), [], "no history, no line");
  const histories = { "Aberrant Fossil": [{ day: 1, value: 10 }, { day: 2, value: 20 }] };
  const series = clusterValueSeries(stash, histories, DEFAULTS);
  assert.equal(series.length, 2);
  near(series[0].value, 10 * 7, 1e-9, "median pool price times the mean cluster");
  near(series[1].value, 20 * 7, 1e-9, "and again on the next day");
  const gap = clusterValueSeries(stash, { "Aberrant Fossil": [{ day: 1, value: 0 }, { day: 2, value: 20 }] }, DEFAULTS);
  assert.equal(gap.length, 1, "an unpriced day is dropped rather than plotted at zero");
});

test("the stash share tracks depth: mostly stashes shallow, mostly special at the cap", () => {
  const shallow = computeBiomes(priceOf, { ...DEFAULTS, depth: 300 }).stash.share;
  const deep = computeBiomes(priceOf, { ...DEFAULTS, depth: COMMUNITY_DEPTH_GUIDE.specialNode.capDepth }).stash.share;
  assert.ok(shallow > 0.8, `expected most fossil nodes to be stashes at depth 300, got ${shallow}`);
  near(deep, 1 - COMMUNITY_DEPTH_GUIDE.specialNode.capChance, 1e-9, "stash share at the cap");
});

test("opportunity is relative, normalised and excludes cities", () => {
  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600 });
  // The leader is whichever node type scores highest — a biome or the stash.
  const best = Math.max(all.stash.opportunityIndex, ...all.targets.map((r) => r.opportunityIndex));
  near(best, 100, 1e-9, "best index");
  for (const r of all.targets) {
    assert.ok(Number.isFinite(r.opportunityIndex), `${r.biome.name}: finite index`);
    assert.ok(r.opportunityIndex >= 0 && r.opportunityIndex <= 100, `${r.biome.name}: bounded index`);
    near(r.opportunityRaw, r.depthAdjustedFound ? r.share * r.depthAdjustedRange.median : 0, 1e-9,
      `${r.biome.name}: community depth-adjusted raw value`);
  }
  for (const r of all.cities) assert.equal(r.opportunityIndex, 0, `${r.biome.name}: city index`);
  for (const r of all.rows) assert.ok(!("expected" in r), `${r.biome.name}: stale expected currency`);
});

test("missing target prices produce zero indices instead of NaN", () => {
  const all = computeBiomes(makePriceOf([]), { ...DEFAULTS, depth: 600 });
  for (const r of all.targets) assert.equal(r.opportunityIndex, 0);
});

test("a biome's node curve re-prices its exclusive target on each day", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const hist = {
    "Hollow Fossil": [{ day: 0, value: 150 }, { day: 1, value: 300 }],
    "Aberrant Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Bound Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Gilded Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
    "Lucent Fossil": [{ day: 0, value: 5 }, { day: 1, value: 10 }],
  };
  const s = biomeValueSeries(abyssal, hist, DEFAULTS);
  assert.equal(s.length, 2);
  // the target price doubled, so the target node value doubles too
  near(s[1].value, s[0].value * 2, 1e-6, "doubling every price");
  // and day 1 must equal what computeBiome says about day 1's prices
  const direct = computeBiome(abyssal, makePriceOf([{
    "Hollow Fossil": { c: 300 }, "Aberrant Fossil": { c: 10 },
    "Bound Fossil": { c: 10 }, "Gilded Fossil": { c: 10 }, "Lucent Fossil": { c: 10 },
  }]), DEFAULTS);
  near(s[1].value, direct.headline, 1e-6, "curve endpoint vs the live number");
});

test("a city biome gets no curve rather than a flat lie", () => {
  const vaal = BIOMES.find((b) => b.id === "vaal");
  assert.deepEqual(biomeValueSeries(vaal, { "Hollow Fossil": [{ day: 0, value: 1 }] }, DEFAULTS, 500), []);
});

test("one data point is not a curve", () => {
  const abyssal = BIOMES.find((b) => b.id === "abyssal");
  const histories = {
    "Hollow Fossil": [{ day: 0, value: 100 }],
    "Aberrant Fossil": [{ day: 0, value: 4 }, { day: 1, value: 8 }],
  };
  assert.deepEqual(biomeValueSeries(abyssal, histories, DEFAULTS), []);
});

console.log("bosses");

const BOSS_PRICES = {
  "Cerberus Limb": { c: 100 }, "Curiosity": { c: 50 },
  "Doryani's Machinarium": { c: 1000 },
  "Ahkeli's Mountain": { c: 10 }, "Uzaza's Meadow": { c: 10 }, "Putembo's Valley": { c: 10 },
};
const bossResolve = makeResolver(BOSS_PRICES, {});

test("Ahuatotli's EV is the sum of chance x price", () => {
  const rows = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 });
  const a = rows.find((r) => r.delve.id === "ahuatotli");
  const want = 0.60 * 100 + 0.40 * 50 + 0.16 * 1000 + 3 * (0.08 * 10);
  near(a.gross, want, 1e-6, "Ahuatotli gross");
});

test("a per-line pool-share override moves the EV", () => {
  const base = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli").gross;
  const bumped = computeDelveBosses(bossResolve, {
    ...DEFAULTS, depth: 600,
    bosses: { ahuatotli: { drops: { "Doryani's Machinarium": { share: 0.32 } } } },
  }).find((r) => r.delve.id === "ahuatotli").gross;
  near(bumped - base, 0.16 * 1000, 1e-6, "doubling the Machinarium rate");
});

test("old chance-based pool overrides migrate without changing saved profiles", () => {
  const migrated = computeDelveBosses(bossResolve, {
    ...DEFAULTS, depth: 600,
    bosses: { ahuatotli: { drops: { "Doryani's Machinarium": { chance: 0.32 } } } },
  }).find((r) => r.delve.id === "ahuatotli");
  const explicit = computeDelveBosses(bossResolve, {
    ...DEFAULTS, depth: 600,
    bosses: { ahuatotli: { drops: { "Doryani's Machinarium": { share: 0.32 } } } },
  }).find((r) => r.delve.id === "ahuatotli");
  near(migrated.gross, explicit.gross, 1e-9, "old chance override vs pool share");
});

test("boss rows expose city share and the labelled community encounter model", () => {
  const rows = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 });
  const a = rows.find((r) => r.delve.id === "ahuatotli");
  const denom = 6 * 100 + 23 + 23 + 17;
  near(a.share, 23 / denom, 1e-9, "Vaal city share");
  near(a.encounterChance, 0.15, 1e-9, "boss chance cap");
  near(a.bossComponentPerCityNode, a.gross * 0.15, 1e-9, "boss EV per city node");
  near(a.bossComponentPerMineNode, a.gross * 0.15 * a.share, 1e-9, "mine-weighted boss EV");
  assert.ok(!("encountersPer100" in a));
});

test("minimum depth gates availability", () => {
  const shallow = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 60 });
  assert.equal(shallow.find((r) => r.delve.id === "ahuatotli").available, true);   // 50
  assert.equal(shallow.find((r) => r.delve.id === "kurgal").available, false);     // 90
  assert.equal(shallow.find((r) => r.delve.id === "aul").available, false);        // 130
});

test("a single kill's median sits below the mean when one line carries the EV", () => {
  const a = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli");
  const d = killDistribution(a, 20000, 7);
  // 16% of 1000c is 160 of the 260c mean, so most kills must come in under it
  near(d.mean, a.gross, a.gross * 0.05, "simulated mean should track the EV");
  assert.ok(d.median < d.mean, `median ${d.median} should sit below mean ${d.mean}`);
  assert.ok(d.p90 > d.median, "p90 should sit above the median");
  assert.equal(d.blank, 0, "the guaranteed unique pool must not simulate blank kills");
});

test("Kurgal drops the Inevitable Eye alone, not an average of all four", () => {
  // The other three Eyes come from unrelated content, so averaging them in
  // quoted a price for an item this boss never gives you.
  const prices = {
    "Zorath's Eye of Malevolence": { c: 20 },
    "Zorath's Eye of Authority": { c: 16 },
    "Zorath's Eye of the Inevitable": { c: 1300 },
    "Zorath's Eye of the Endless": { c: 26 },
  };
  const kurgal = computeDelveBosses(makeResolver(prices), { ...DEFAULTS, depth: 600 })
    .find((row) => row.delve.id === "kurgal");
  const eye = kurgal.dropLines.find((line) => line.key === "zorath");
  near(eye.unit, 1300, 1e-9, "the Inevitable's own price");
  near(eye.value, 1300 * 0.50, 1e-9, "50% preliminary Eye EV");
  const names = bossItems(DELVE_BOSSES.find((boss) => boss.id === "kurgal"));
  assert.ok(names.has("Zorath's Eye of the Inevitable"), "hourly gap-fill still chases the one Eye");
  for (const other of ["Zorath's Eye of Malevolence", "Zorath's Eye of Authority", "Zorath's Eye of the Endless"]) {
    assert.ok(!names.has(other), `${other} is not Kurgal loot and must not be priced for this table`);
  }
});

test("a synthetic drop keeps its average — the floor rule is for single items", () => {
  // Aul hands over one random aura of 17, so the mean is the EV. Quoting the
  // cheapest member instead would understate the line by design.
  const boss = DELVE_BOSSES.find((row) => row.id === "aul");
  const names = [...bossItems(boss)].filter((name) => /^Aul's Uprising \([^)]+\)$/.test(name));
  const priced = Object.fromEntries(names.map((name, i) => [name, { c: 10 + i * 10, lo: 1, hi: 900, n: 3 }]));
  const rows = computeDelveBosses(makeResolver(priced), { ...DEFAULTS, depth: 600 });
  const line = rows.find((r) => r.delve.id === "aul").dropLines.find((l) => l.key === "@auls-uprising");
  const mean = names.reduce((sum, _, i) => sum + 10 + i * 10, 0) / names.length;
  near(line.unit, mean, 1e-9, "synthetic stays at the arithmetic mean");
  assert.ok(!line.floorQuote, "and is not marked as floor-quoted");
});

test("the Aul line prices the complete 17-aura market as a strict arithmetic average", () => {
  const boss = DELVE_BOSSES.find((row) => row.id === "aul");
  const names = [...bossItems(boss)].filter((name) => /^Aul's Uprising \([^)]+\)$/.test(name));
  assert.equal(names.length, 17, "Aul dropdown needs every aura outcome");

  const prices = Object.fromEntries(names.map((name, i) => [name, { c: (i + 1) * 10 }]));
  const aul = computeDelveBosses(makeResolver(prices), { ...DEFAULTS, depth: 600 })
    .find((row) => row.delve.id === "aul");
  const amulet = aul.dropLines.find((line) => line.key === "@auls-uprising");
  near(amulet.unit, 90, 1e-9, "17-aura average");
  near(amulet.value, 90 * 0.61, 1e-9, "Aul's Uprising pool EV");
  assert.equal(amulet.priceEntry.components.length, 17, "dropdown needs all 17 prices");

  const partial = { ...prices };
  delete partial[names[0]];
  const missing = computeDelveBosses(makeResolver(partial), { ...DEFAULTS, depth: 600 })
    .find((row) => row.delve.id === "aul");
  assert.ok(!missing.dropLines.some((line) => line.key === "@auls-uprising"),
    "a partial outcome list must not silently change the average");
});

test("Kurgal keeps same-item socket variants beside each other", () => {
  const kurgal = computeDelveBosses(makeResolver({
    "Command of the Pit": { c: 10 },
    "Hale Negator": { c: 20 },
  }), { ...DEFAULTS, depth: 600 }).find((row) => row.delve.id === "kurgal");
  assert.deepEqual(kurgal.dropLines.slice(0, 4).map((line) => line.key),
    ["command-1", "command-2", "hale-1", "hale-2"]);
});

test("one-kill simulation rolls the actual synthetic variant, not a fixed average item", () => {
  const computed = {
    quantity: 0,
    groups: [{
      kind: "independent", scaled: false,
      lines: [{ rate: 1, unit: 340.5, qty: 1, priceEntry: { components: [
        { chaos: 20 }, { chaos: 16 }, { chaos: 1300 }, { chaos: 26 },
      ] } }],
    }],
  };
  const spread = killDistribution(computed, 20000, 17);
  near(spread.mean, 340.5, 8, "synthetic variant simulation mean");
  assert.ok(spread.median < 30, `median should be a common Eye, got ${spread.median}`);
  assert.equal(spread.p90, 1300, "the expensive Eye should remain visible in the upper tail");
});

test("the simulation is seeded, so it doesn't flicker between renders", () => {
  const a = computeDelveBosses(bossResolve, { ...DEFAULTS, depth: 600 })
    .find((r) => r.delve.id === "ahuatotli");
  assert.deepEqual(killDistribution(a, 500), killDistribution(a, 500));
});

test("a rate above 100% pays out more than one copy", () => {
  const fake = {
    quantity: 0,
    groups: [{
      kind: "independent", rolls: 1, base: 0, totalWeight: 0, scaled: false,
      lines: [{ rate: 2.5, unit: 100, qty: 2.5 }],
    }],
  };
  const d = killDistribution(fake, 20000, 3);
  near(d.mean, 250, 6, "2.5 copies at 100c");
  assert.ok(d.median >= 200, "at least two copies every kill");
});

console.log("settings");

test("sanitize clamps depth and drops junk", () => {
  assert.equal(sanitizeSettings({ depth: -5 }).depth, 1);
  assert.equal(sanitizeSettings({ depth: 1e9 }).depth, 65535);
  assert.equal(sanitizeSettings({ depth: "abc" }).depth, DEFAULTS.depth);
  assert.equal(sanitizeSettings({ openWalls: "yes" }).openWalls, DEFAULTS.openWalls);
  const stale = sanitizeSettings({ exclusiveQty: 4, exclusiveExtra: 2, bossPerCity: 0.5, exclusivePerDelve: 0.35 });
  for (const key of ["exclusiveQty", "exclusiveExtra", "bossPerCity", "exclusivePerDelve"])
    assert.ok(!(key in stale), `${key} should move out of global settings`);
  assert.deepEqual(sanitizeSettings({ bosses: { nope: {} } }).bosses, {});
});

console.log("sample profiles");

test("the guide profile carries no fake observations or timed rate", () => {
  const profile = defaultSampleProfile();
  const metrics = sampleMetrics(profile);
  assert.equal(profile.name, "Guide baseline");
  assert.equal(profile.builtIn, true);
  assert.equal(metrics.hasObservations, false);
  assert.equal(metrics.hasTimedSample, false);
  assert.deepEqual(metrics.quantities, GUIDE_SAMPLE);
});

test("custom observations replace guide quantities and produce a finite personal pace", () => {
  const profile = sanitizeSampleProfile({
    name: "Depth 600",
    sampleDepth: 600,
    observations: {
      minutes: 120,
      exclusiveNodes: 4, exclusiveFossils: 16,
      // Saved before fossil nodes collapsed to special-or-stash: these fold in.
      genericNodes: 2, genericFossils: 6,
      cacheNodes: 1, cacheFossils: 8,
    },
  });
  const metrics = sampleMetrics(profile);
  assert.deepEqual(metrics.observations.genericNodes, undefined, "the legacy field does not survive the migration");
  assert.equal(metrics.observations.cacheNodes, 3, "old generic nodes fold into the stash count");
  assert.equal(metrics.observations.cacheFossils, 14, "old generic fossils fold into the stash count");
  assert.deepEqual(metrics.quantities, {
    exclusiveQty: 4, stashQtyLow: 14 / 3, stashQtyHigh: 14 / 3,
    wallQtyLow: GUIDE_SAMPLE.wallQtyLow, wallQtyHigh: GUIDE_SAMPLE.wallQtyHigh,
  }, "a measured stash average replaces both ends of the guide range; walls have no sample field yet");
  near(metrics.exclusivePerHour, 2, 1e-9, "exclusive encounters/hour");
  near(metrics.stashPerHour, 1.5, 1e-9, "stash encounters/hour");
  near(metrics.exclusiveShare, 4 / 7, 1e-9, "exclusive share of recorded fossil encounters");

  const all = computeBiomes(priceOf, { ...DEFAULTS, depth: 600, ...metrics.quantities }, metrics);
  const abyssal = all.targets.find((r) => r.biome.id === "abyssal");
  near(abyssal.personalRange.median, 2470, 1e-9, "personal median/hour");
  assert.ok(Number.isFinite(abyssal.personalRange.high));
});

test("zero-count categories fall back independently and zero-fossil nodes are valid", () => {
  const fallback = sampleMetrics(sanitizeSampleProfile({
    observations: { exclusiveFossils: 9 },
  }));
  assert.equal(fallback.quantities.exclusiveQty, GUIDE_SAMPLE.exclusiveQty);
  assert.equal(fallback.quantities.stashQtyLow, GUIDE_SAMPLE.stashQtyLow);
  assert.equal(fallback.quantities.stashQtyHigh, GUIDE_SAMPLE.stashQtyHigh);
  assert.equal(fallback.warnings.length, 1);
  assert.equal(fallback.hasTimedSample, false);
});

test("a timed dry route remains a valid zero-rate personal sample", () => {
  const dry = sampleMetrics(sanitizeSampleProfile({ observations: { minutes: 90 } }));
  assert.equal(dry.hasTimedSample, true);
  assert.equal(dry.totalEncounters, 0);
  assert.equal(dry.exclusivePerHour, 0);
  const abyssal = computeBiomes(priceOf, { ...DEFAULTS, ...dry.quantities }, dry).targets
    .find((r) => r.biome.id === "abyssal");
  assert.deepEqual(abyssal.personalRange, { low: 0, median: 0, high: 0 });
});

test("sample sanitising clamps depths and observations", () => {
  const p = sanitizeSampleProfile({
    name: "  ", sampleDepth: 1e9,
    observations: { minutes: -5, exclusiveNodes: -2, cacheFossils: "7" },
  }, "Imported");
  assert.equal(p.name, "Imported");
  assert.equal(p.sampleDepth, 65535);
  assert.equal(p.observations.minutes, 0);
  assert.equal(p.observations.exclusiveNodes, 0);
  assert.equal(p.observations.cacheFossils, 7);
  assert.equal(uniqueSampleName([{ name: "Run" }, { name: "Run 2" }], "Run"), "Run 3");
});

test("price overrides survive a round trip, stay positive and win over the snapshot", () => {
  const s = sanitizeSettings({ priceOverrides: { "Hollow Fossil": 500, zero: 0, negative: -5, junk: "x" } });
  assert.equal(s.priceOverrides["Hollow Fossil"], 500);
  assert.ok(!("zero" in s.priceOverrides));
  assert.ok(!("negative" in s.priceOverrides));
  assert.ok(!("junk" in s.priceOverrides));
  const p = makePriceOf([PRICES], { overrides: s.priceOverrides });
  assert.equal(p("Hollow Fossil").chaos, 500);
  assert.equal(p("Hollow Fossil").overridden, true);
  assert.equal(makePriceOf([], { overrides: { "Hollow Fossil": -1 } })("Hollow Fossil").found, false);
});

test("fossil rows come back priced and sorted", () => {
  const rows = fossilRows(priceOf);
  assert.equal(rows[0].name, "Hollow Fossil");
  assert.ok(rows.some((r) => !r.found), "unpriced fossils should still be listed");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].chaos >= rows[i].chaos, "not sorted");
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall delve tests passed");
process.exit(failed ? 1 : 0);
