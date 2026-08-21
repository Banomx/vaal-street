/* Gem levelling engine tests. Node only, no DOM:
     node scripts/test-gems.mjs

   Two jobs. Rules — the corruption weights are published, so they are
   asserted literally here and a refactor that moves them has to move
   them here too. And arithmetic — hand-checked EV fixtures over a small
   synthetic gem set, including the cases the shape of poe.ninja's data
   actually produces: a support gem with no Vaal version, an Awakened
   gem whose quality does nothing, and a quality band poe.ninja does not
   list at all. */

import assert from "node:assert/strict";
import {
  CORRUPT, DEFAULTS, XP_FAMILIES, XP_PER_QUALITY, buildGems, computeGem, computeGems,
  corruptionOutcomes, inputCost, levellingTime, parseVariant, quoteVariant,
  sanitizeSettings, variantKey,
} from "../../../src/games/poe1/features/gems/gems.js";

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/* ---------------- fixtures ----------------

   Prices are round numbers chosen so every expected value below can be
   worked out on paper, not copied from a run. */
const V = (l, q, c, v, n) => ({ l, q, ...(c ? { c: 1 } : {}), v, ...(n == null ? {} : { n }) });

const SNAPSHOT = [
  {
    // A normal skill gem WITH a Vaal version.
    name: "Cyclone",
    variants: [
      V(1, 0, 0, 10, 400), V(1, 20, 0, 60, 120), V(20, 20, 0, 100, 90),
      V(20, 20, 1, 80, 40), V(21, 20, 1, 1000, 12), V(19, 20, 1, 40, 8),
      V(20, 23, 1, 300, 15), V(20, 0, 1, 20, 30),
    ],
  },
  { name: "Vaal Cyclone", variants: [V(20, 20, 1, 200, 25), V(1, 0, 0, 5, 50)] },
  {
    // A support gem: no Vaal version, so a quarter of the rolls do nothing.
    name: "Fork Support",
    variants: [
      V(1, 0, 0, 2, 500), V(1, 20, 0, 30, 200), V(20, 20, 0, 50, 150),
      V(20, 20, 1, 45, 60), V(21, 20, 1, 400, 20), V(19, 20, 1, 20, 10),
      V(20, 23, 1, 120, 9),
    ],
  },
  {
    // Awakened: level cap 5, quality is only experience so poe.ninja lists none.
    name: "Awakened Enlighten Support",
    variants: [
      V(1, 0, 0, 5000, 30), V(5, 0, 0, 90000, 6),
      V(5, 0, 1, 85000, 4), V(6, 0, 1, 400000, 2), V(4, 0, 1, 20000, 3),
    ],
  },
  // Only ever listed at level 1: nothing to level, so it is not a row.
  { name: "Portal", variants: [V(1, 0, 0, 1, 900)] },
];

const built = buildGems(SNAPSHOT);
const gem = (name) => built.gems.find((g) => g.name === name);

console.log("variant parsing");

test("poe.ninja's variant strings round-trip", () => {
  assert.deepEqual(parseVariant("1"), { level: 1, quality: 0, corrupted: false, alt: null });
  assert.deepEqual(parseVariant("1/20"), { level: 1, quality: 20, corrupted: false, alt: null });
  assert.deepEqual(parseVariant("20/20c"), { level: 20, quality: 20, corrupted: true, alt: null });
  assert.deepEqual(parseVariant("5"), { level: 5, quality: 0, corrupted: false, alt: null });
  assert.equal(variantKey(21, 20, true), "21/20c");
  assert.equal(variantKey(5, 0, false), "5/0");
});

test("alternate quality is recognised so it can be excluded, not mixed in", () => {
  assert.equal(parseVariant("20/20 Divergent").alt, "Divergent");
  assert.equal(parseVariant("1/20c Anomalous").alt, "Anomalous");
  assert.equal(parseVariant("20/20c Phantasmal").corrupted, true);
  assert.equal(parseVariant(""), null);
  assert.equal(parseVariant("Relic"), null);
});

console.log("gem construction");

test("the level and quality caps are read off what poe.ninja lists", () => {
  assert.equal(gem("Cyclone").maxLevel, 20);
  assert.equal(gem("Cyclone").maxQuality, 20);
  assert.equal(gem("Awakened Enlighten Support").maxLevel, 5);
  assert.equal(gem("Awakened Enlighten Support").maxQuality, 0);
});

test("a Vaal gem is an outcome, never a row, and a level-1-only gem is neither", () => {
  assert.ok(!built.gems.some((g) => g.name === "Vaal Cyclone"), "Vaal Cyclone should not be sellable input");
  assert.ok(built.byName["Vaal Cyclone"], "but it still has to be priceable as an outcome");
  assert.ok(!built.gems.some((g) => g.name === "Portal"), "Portal has nothing to level");
  assert.equal(gem("Cyclone").vaalName, "Vaal Cyclone");
  assert.equal(gem("Fork Support").vaalName, null);
});

console.log("corruption weights");

test("the four effects are equal and the sub-rolls are 50/50", () => {
  assert.equal(CORRUPT.none, 0.25);
  assert.equal(CORRUPT.level, 0.25);
  assert.equal(CORRUPT.quality, 0.25);
  assert.equal(CORRUPT.vaal, 0.25);
  assert.equal(CORRUPT.qualityMax, 23);
  assert.equal(CORRUPT.qualityRoll, 10);
});

test("+1 level is 1/8 on a gem with a Vaal version", () => {
  const rows = corruptionOutcomes(gem("Cyclone"), {}, built.byName);
  const up = rows.find((r) => r.key === "levelUp");
  near(up.p, 1 / 8, 1e-12, "+1 level");
  near(sum(rows.map((r) => r.p)), 1, 1e-12, "outcome weights");
});

test("+1 level stays 1/8 when there is no Vaal version to become", () => {
  const rows = corruptionOutcomes(gem("Fork Support"), {}, built.byName);
  near(rows.find((r) => r.key === "levelUp").p, 1 / 8, 1e-12, "+1 level");
  // The Vaal quarter does nothing, so "no change" carries half the mass.
  near(rows.find((r) => r.key === "same").p, 0.5, 1e-12, "no change");
  assert.ok(!rows.some((r) => r.key === "vaal"), "a support gem has no Vaal outcome");
  near(sum(rows.map((r) => r.p)), 1, 1e-12, "outcome weights");
});

test("the strict reading puts +1 level at 1/6 instead", () => {
  const rows = corruptionOutcomes(gem("Fork Support"), { vaalSlot: "redistribute" }, built.byName);
  near(rows.find((r) => r.key === "levelUp").p, 1 / 6, 1e-12, "+1 level");
  near(sum(rows.map((r) => r.p)), 1, 1e-12, "outcome weights");
});

test("quality up from 20% lands on 23% eight rolls in ten", () => {
  const up = corruptionOutcomes(gem("Cyclone"), {}, built.byName).find((r) => r.key === "qualityUp");
  const at = (q) => up.parts.find((p) => p.quality === q);
  near(at(21).p, 0.1, 1e-12, "21%");
  near(at(22).p, 0.1, 1e-12, "22%");
  near(at(23).p, 0.8, 1e-12, "23%");
  assert.equal(up.quality, 23, "the headline roll is the capped one");
  assert.equal(up.label, "Quality 21–23%");
});

test("quality down from 20% is 10-19% uniform", () => {
  const down = corruptionOutcomes(gem("Cyclone"), {}, built.byName).find((r) => r.key === "qualityDown");
  assert.equal(down.parts.length, 10);
  for (const part of down.parts) near(part.p, 0.1, 1e-12, `${part.quality}%`);
  assert.equal(down.label, "Quality 10–19%");
});

test("a roll that cannot change anything folds into no change", () => {
  // Awakened gems sit at 0% quality, so the downward roll is a no-op and
  // listing it as its own outcome would double-count the same gem.
  const rows = corruptionOutcomes(gem("Awakened Enlighten Support"), {}, built.byName);
  assert.ok(!rows.some((r) => r.key === "qualityDown"), "0% quality cannot roll down");
  // 1/4 none + 1/4 vaal (nothing to become) + 1/8 quality down = 5/8.
  near(rows.find((r) => r.key === "same").p, 0.625, 1e-12, "no change");
  near(sum(rows.map((r) => r.p)), 1, 1e-12, "outcome weights");
});

console.log("quoting");

test("an exact variant is quoted exactly, with its listing count", () => {
  const q = quoteVariant(gem("Cyclone"), { level: 21, quality: 20, corrupted: true });
  assert.equal(q.chaos, 1000);
  assert.equal(q.listings, 12);
  assert.equal(q.exact, true);
});

test("an unlisted quality walks DOWN to the nearest listed one and says so", () => {
  // Nothing is listed at corrupted 20/14, so the quote is the 20/0c below it.
  const q = quoteVariant(gem("Cyclone"), { level: 20, quality: 14, corrupted: true });
  assert.equal(q.chaos, 20);
  assert.equal(q.exact, false);
  assert.equal(q.from, "20/0c");
});

test("a variant with nothing below it is unpriced rather than guessed", () => {
  const q = quoteVariant(gem("Fork Support"), { level: 25, quality: 20, corrupted: true });
  assert.equal(q.chaos, 0);
  assert.equal(q.missing, true);
});

console.log("input cost");

test("the cheaper of the two routes wins, and the row says which", () => {
  // 1/20 costs 60; 1/0 at 10 plus 20 prisms at 3 costs 70.
  const cheap = inputCost(gem("Cyclone"), { gcp: 3 });
  assert.equal(cheap.chaos, 60);
  assert.equal(cheap.kind, "listed");
  // Push the prism price down and levelling it yourself takes over.
  const diy = inputCost(gem("Cyclone"), { gcp: 1 });
  assert.equal(diy.chaos, 30);
  assert.equal(diy.kind, "gcp");
  assert.equal(diy.label, "Buy 1/0 + 20 GCP");
});

test("a gem whose quality does nothing buys no prisms", () => {
  const awk = inputCost(gem("Awakened Enlighten Support"), { gcp: 3 });
  assert.equal(awk.chaos, 5000);
  assert.equal(awk.label, "Buy 1/0");
});

test("an override replaces the input cost and is flagged", () => {
  const forced = inputCost(gem("Cyclone"), { gcp: 3, overrides: { "Cyclone input": 42 } });
  assert.equal(forced.chaos, 42);
  assert.equal(forced.overridden, true);
});

console.log("expected value");

test("Cyclone's corruption EV is the hand-worked figure", () => {
  /* 1/4  no change      80
     1/8  level 21     1000
     1/8  level 19       40
     1/8  quality up   0.1*? — 21% and 22% are unlisted so they quote 20/20c
                       at 80, and 23% quotes 300:
                       0.1*80 + 0.1*80 + 0.8*300 = 256
     1/8  quality down  every roll walks down to 20/0c at 20 -> 20
     1/4  Vaal Cyclone  200
     EV = 0.25*80 + 0.125*1000 + 0.125*40 + 0.125*256 + 0.125*20 + 0.25*200
        = 20 + 125 + 5 + 32 + 2.5 + 50 = 234.5 */
  const r = computeGem(gem("Cyclone"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  near(r.corruptEV, 234.5, 1e-9, "corrupt EV");
  near(r.levelProfit, 40, 1e-9, "level & sell profit");     // 100 - 60
  near(r.vaalProfit, 169.5, 1e-9, "level & vaal profit");   // 234.5 - 60 - 5
  assert.equal(r.path, "vaal");
  near(r.profit, 169.5, 1e-9, "headline profit");
});

test("the return is measured against everything you spent, orb included", () => {
  const r = computeGem(gem("Cyclone"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  near(r.roi, 169.5 / 65, 1e-9, "return on cost");
});

test("a support gem's missing Vaal outcome shows up in the EV", () => {
  /* 1/2  no change      45   (the Vaal quarter does nothing)
     1/8  level 21      400
     1/8  level 19       20
     1/8  quality up    0.1*45 + 0.1*45 + 0.8*120 = 105
     1/8  quality down  nothing corrupted is listed below 20/20c, so every
                        roll reaches up to that at 45 — an overstatement the
                        row is badged for, and still better than calling an
                        eighth of the table worthless
     EV = 0.5*45 + 0.125*400 + 0.125*20 + 0.125*105 + 0.125*45
        = 22.5 + 50 + 2.5 + 13.125 + 5.625 = 93.75 */
  const r = computeGem(gem("Fork Support"), { gcp: 1, vaalOrb: 5, byName: built.byName });
  near(r.corruptEV, 93.75, 1e-9, "corrupt EV");
  assert.equal(r.approx, true, "the quality bands are substituted, so the row is approximate");
});

test("levelling and selling wins when corruption is a coin flip on a cheap gem", () => {
  // Fork input is min(30, 2 + 20*1) = 22; selling at 50 beats 93.75 - 22 - 90.
  const r = computeGem(gem("Fork Support"), { gcp: 1, vaalOrb: 90, byName: built.byName });
  near(r.levelProfit, 28, 1e-9, "level & sell profit");
  assert.equal(r.path, "level");
});

test("the downside is named rather than buried in the mean", () => {
  const r = computeGem(gem("Cyclone"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  // Below the uncorrupted 100: no change (80), level 19 (40) and the quality
  // band that walks down to 20 — 0.25 + 0.125 + 0.125.
  near(r.brickChance, 0.5, 1e-9, "share of corruptions ending below the gem you had");
});

test("the thinnest market on the route is what the row reports", () => {
  const r = computeGem(gem("Cyclone"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  /* Only the markets carrying a tenth of the EV count: level 21 (125 of
     234.5, 12 listed), the quality band (32, 15 listed) and Vaal Cyclone
     (50, 25 listed), against the 1/20 input's 120. The level 19 market is
     the shallowest at 8 and is correctly ignored — it is worth 5. */
  assert.equal(r.listingFloor, 12, "the level 21 market is the thin one that matters");
});

test("an override on an outcome moves the EV", () => {
  const r = computeGem(gem("Cyclone"), {
    gcp: 3, vaalOrb: 5, byName: built.byName,
    overrides: { "Cyclone 21/20c": 500 },
  });
  // 1/8 of the 500 drop off the 1000 assumption: 234.5 - 62.5 = 172.
  near(r.corruptEV, 172, 1e-9, "corrupt EV after the override");
  assert.equal(r.outcomes.find((o) => o.key === "levelUp").overridden, true);
});

test("a band has no single market, so it takes no override", () => {
  const r = computeGem(gem("Cyclone"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  for (const o of r.outcomes) {
    if (o.parts) assert.equal(o.item, undefined, `${o.key} should not be overridable`);
    else assert.ok(o.item, `${o.key} should be overridable`);
  }
});

console.log("whole snapshot");

test("computeGems prices every levellable gem and nothing else", () => {
  const rows = computeGems(SNAPSHOT, { gcp: 3, vaalOrb: 5 });
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Awakened Enlighten Support", "Cyclone", "Fork Support"]);
  for (const r of rows) assert.ok(isFinite(r.profit), `${r.name} has no profit`);
});

test("Awakened Enlighten's EV survives poe.ninja listing no quality variants", () => {
  /* 5/8  no change    85000  (none + vaal + the dead quality-down roll)
     1/8  level 6     400000
     1/8  level 4      20000
     1/8  quality up   every roll walks down to 5/0c at 85000
     EV = 0.625*85000 + 0.125*400000 + 0.125*20000 + 0.125*85000
        = 53125 + 50000 + 2500 + 10625 = 116250 */
  const r = computeGem(gem("Awakened Enlighten Support"), { gcp: 3, vaalOrb: 5, byName: built.byName });
  near(r.corruptEV, 116250, 1e-6, "corrupt EV");
  near(r.levelProfit, 85000, 1e-6, "level & sell profit");
});

console.log("levelling time");

test("a family is picked by level cap plus the support flag, never by name", () => {
  assert.equal(levellingTime(3, {}).family.key, "exceptional");
  assert.equal(levellingTime(4, {}).family.key, "awakenedExceptional");
  assert.equal(levellingTime(5, {}).family.key, "awakened");
  // The two cap-20 curves are different, and only the support flag separates them.
  assert.equal(levellingTime(20, { isSupport: false }).family.key, "normal");
  assert.equal(levellingTime(20, { isSupport: true }).family.key, "normalSupport");
  assert.notEqual(levellingTime(20, { isSupport: false }).total, levellingTime(20, { isSupport: true }).total);
  // A cap this does not know gets no duration rather than an invented one.
  assert.equal(levellingTime(7, {}), null);
});

test("the support flag comes off the name pattern, not a list", () => {
  const { gems } = buildGems(SNAPSHOT);
  assert.equal(gems.find((g) => g.name === "Cyclone").isSupport, false);
  assert.equal(gems.find((g) => g.name === "Fork Support").isSupport, true);
  assert.equal(gems.find((g) => g.name === "Awakened Enlighten Support").isSupport, true);
});

test("quality buys experience on exactly six gems and no others", () => {
  /* Empower, Enhance, Enlighten and their three Awakened versions — the only
     gems whose quality reads "This Gem gains (5-100)% increased Experience".
     They are also the only gems at caps 3 and 4, which is how they are found
     without naming them. 30 quality x 5% = 150% increased, so 2.5x the rate. */
  assert.equal(XP_PER_QUALITY, 5);
  assert.deepEqual(
    XP_FAMILIES.filter((f) => f.qualityXp).map((f) => f.cap).sort(),
    [3, 4],
    "only the two exceptional caps gain experience from quality",
  );
  near(levellingTime(3, {}).bonus, 1.5, 1e-12, "Empower / Enhance / Enlighten");
  near(levellingTime(4, {}).bonus, 1.5, 1e-12, "their Awakened versions");
  assert.equal(levellingTime(20, { isSupport: false }).bonus, 0, "a skill gem's quality does nothing for experience");
  assert.equal(levellingTime(20, { isSupport: true }).bonus, 0, "nor does a support gem's");
  assert.equal(levellingTime(5, {}).bonus, 0, "nor an ordinary Awakened gem's");
  // Raising the box must not shorten a single unaffected gem's levelling time.
  for (const [cap, support] of [[20, false], [20, true], [5, false]]) {
    const base = levellingTime(cap, { isSupport: support });
    const raised = levellingTime(cap, { isSupport: support, xpQuality: 200 });
    near(raised.minutes, base.minutes, 1e-12, `cap ${cap}${support ? " support" : ""} is untouched by the quality box`);
  }
});

test("the measured rate turns experience into minutes", () => {
  // 134.3M in 13 minutes is the default, so a 341.3M skill gem is 33 min...
  near(levellingTime(20, {}).minutes, 33.0, 0.1, "skill gem");
  // ...and 1.666B of Empower, even at 2.5x, is nearly twice that.
  near(levellingTime(3, {}).minutes, 64.5, 0.2, "Empower");
  near(levellingTime(4, {}).minutes, 80.8, 0.2, "Awakened Empower");
  // Halve the rate, double the time.
  near(levellingTime(20, { xpPerMinute: DEFAULTS.xpPerMinute / 2 }).minutes, 66.1, 0.2, "at half rate");
});

test("an edited total is used instead of the wiki baseline", () => {
  const t = levellingTime(20, { xpTotals: { normal: 100_000_000 } });
  assert.equal(t.total, 100_000_000);
  near(t.minutes, 100e6 / DEFAULTS.xpPerMinute, 1e-9, "minutes follow the override");
});

test("profit per hour inverts the ranking when the fat gem is the slow one", () => {
  /* This is the whole point of the column. Cyclone pays more per gem, but it
     holds the socket for 33 minutes; the Awakened support pays less and caps
     in 19, so per hour of levelling it is the better use of the slot. */
  const awakened = {
    name: "Awakened Fork Support",
    variants: [V(1, 0, 0, 200, 90), V(5, 0, 0, 320, 40), V(5, 0, 1, 260, 25), V(6, 0, 1, 400, 20)],
  };
  const rows = computeGems([...SNAPSHOT, awakened], { gcp: 3, vaalOrb: 5 });
  const cyclone = rows.find((r) => r.name === "Cyclone");
  const awk = rows.find((r) => r.name === "Awakened Fork Support");
  near(cyclone.xp.minutes, 33.0, 0.1, "Cyclone levelling time");
  near(awk.xp.minutes, 18.6, 0.2, "Awakened levelling time");
  near(cyclone.profitPerHour, (cyclone.profit * 60) / cyclone.xp.minutes, 1e-9, "profit per hour is profit over time");
  assert.ok(cyclone.profit > awk.profit, "Cyclone pays more per gem");
  assert.ok(awk.profitPerHour > cyclone.profitPerHour, "but the Awakened gem pays more per hour of levelling");
});

test("an exceptional gem is slow despite its quality bonus", () => {
  /* 1.666B even at 2.5x is 64 minutes, nearly twice a normal gem. Before the
     real totals arrived this read as six minutes and put Empower at the top of
     the per-hour list, which was the wrong answer by an order of magnitude. */
  const empower = {
    name: "Empower Support",
    variants: [V(1, 20, 0, 50, 80), V(3, 20, 0, 120, 40), V(3, 20, 1, 90, 25), V(4, 20, 1, 150, 30)],
  };
  const [emp] = computeGems([empower], { gcp: 3, vaalOrb: 5 });
  near(emp.xp.minutes, 64.5, 0.2, "Empower levelling time");
  assert.ok(emp.xp.minutes > levellingTime(20, { isSupport: true }).minutes, "slower than a normal support");
});

console.log("settings");

test("thin markets are hidden until you ask for them", () => {
  // A profit resting on four listings is the common case here, so the list
  // opens on the trades that can actually clear.
  assert.equal(DEFAULTS.hideThin, true);
  assert.equal(DEFAULTS.thinListings, 5);
  assert.equal(DEFAULTS.xpQuality, 30, "20 from prisms plus 10 from a matching socket");
  assert.equal(sanitizeSettings({}).hideThin, true);
  assert.equal(sanitizeSettings({ hideThin: false }).hideThin, false);
});

test("settings are clamped and unknown keys are dropped", () => {
  const s = sanitizeSettings({ thinListings: "35", hideThin: true, vaalSlot: "nonsense", junk: 1, priceOverrides: { a: 5, b: -1 } });
  assert.equal(s.thinListings, 35);
  assert.equal(s.hideThin, true);
  assert.equal(s.vaalSlot, DEFAULTS.vaalSlot);
  assert.deepEqual(s.priceOverrides, { a: 5 });
  assert.equal(s.junk, undefined);
});

test("experience overrides are kept per known family and nothing else", () => {
  const s = sanitizeSettings({ xpPerMinute: "5000000", xpQuality: 20, xpTotals: { normal: 5, nonsense: 9, awakened: -1 } });
  assert.equal(s.xpPerMinute, 5000000);
  assert.equal(s.xpQuality, 20);
  assert.deepEqual(s.xpTotals, { normal: 5 });
});

console.log(failed ? `\n${failed} test(s) failed` : "\nall gem tests passed");
process.exit(failed ? 1 : 0);
