/* Regression test for the PoE 2 Popular farms mechanic layer.

   Two things are being defended here. The first is that mechanic membership
   comes from evidence and not from a name that happens to look right: the same
   `marketFamily` field carries GGG's exchange category and PoE2Scout's
   CategoryApiId, and the latter puts Soul Cores under `expedition` and Idols
   under `ritual`. Reading it without checking the source silently files a rune
   as Expedition output.

   The second is that a summed basket stays honest. A member with no history
   must leave the basket and be named, the plotted window must be the members'
   overlap, and the weights must be fixed — otherwise a market that starts
   trading mid-window shows up as a price move that never happened.

   Fixtures only; this test never reads public/data.

   Run: node scripts/tests/poe2/test-farms.mjs
*/

import assert from "node:assert/strict";
import { buildTabletFamilies, tabletFamilyTimeline } from "../../../src/games/poe2/features/farms/tabletFarms.js";
import {
  COMPETING, NEUTRAL, POOL_CAVEATS, SLOTS, curatedCoverage,
  hasOutputPool, mechanicFor, mechanicPools,
} from "../../../src/games/poe2/features/farms/mechanics.js";
import {
  MIN_MEMBERS, buildBasketIndex, concentration, farmSignal, liquidity, poolContributions, poolFlow,
  poolMovers, poolWeights, topOfPool,
} from "../../../src/games/poe2/features/farms/farmIndex.js";

let fails = 0;
const ok = (condition, message) => { if (!condition) { fails++; console.log("FAIL:", message); } };
const near = (value, expected, message, epsilon = 1e-9) =>
  ok(Math.abs(value - expected) < epsilon, `${message} (got ${value}, expected ${expected})`);

const ggg = (marketFamily, extra = {}) => ({
  source: "GGG completed trades", marketFamily, exalted: 10, volume1H: 100, ...extra,
});
const stash = (marketFamily, extra = {}) => ({
  source: "poe.ninja stash", marketFamily, exalted: 500, listingCount: 800, ...extra,
});

/* ---- mechanic identity ---- */

ok(mechanicFor("Sibilant Catalyst", ggg("Breach")) === "breach", "a GGG Breach row is Breach output");
ok(mechanicFor("Omen of Chance", ggg("Ritual")) === "ritual", "a GGG Ritual row is Ritual output");
ok(mechanicFor("Omen of Light", ggg("Ritual", {
  metadataPath: "Metadata/Items/Currency/OmenOnAnnulRemoveAbyssMod",
})) === "abyss", "an Abyss Omen's RePoE path overrides GGG's broad Ritual trading family");
ok(mechanicFor("Omen of Abyssal Echoes", {
  source: "PoE2Scout", marketFamily: "ritual", exalted: 5,
  metadataPath: "Metadata/Items/Currency/OmenOnAbyssRerollOptions",
}) === "abyss", "Abyss Omen identity survives when the selected quote is a gap-fill source");
ok(/metadata paths/.test(POOL_CAVEATS.abyss) && /reassigned/.test(POOL_CAVEATS.ritual),
  "both cards explain why the exchange family and farm ownership differ");

/* PoE2Scout reuses the field with its own vocabulary. */
ok(mechanicFor("Emergent Vigour", { source: "PoE2Scout", marketFamily: "expedition", exalted: 5 }) === null,
  "a PoE2Scout `expedition` Soul Core is not Expedition output");
ok(mechanicFor("Idol of Oak", { source: "PoE2Scout", marketFamily: "ritual", exalted: 5 }) === null,
  "a PoE2Scout `ritual` Idol is not Ritual output");

/* Structural paths carry the mechanics GGG gives no family to. */
ok(mechanicFor("Architect's Orb", { source: "GGG completed trades", marketFamily: "Currency", metadataPath: "Metadata/Items/Currency/CurrencyIncursionDoubleCorrupt" }) === "vaal",
  "an Incursion currency path is Vaal output even under the Currency family");
ok(mechanicFor("Jiquani's Thesis", { source: "GGG completed trades", marketFamily: "SoulCores", metadataPath: "Metadata/Items/SoulCores/ThesisOfSouls" }) === "vaal",
  "a Thesis is Vaal output");
ok(mechanicFor("Simulacrum Splinter", ggg("Fragments", { tags: ["affliction_orb", "currency"] })) === "delirium",
  "affliction tags pull Simulacrum splinters back to Delirium");
ok(mechanicFor("Divine Orb", ggg("Currency")) === null, "plain currency belongs to no mechanic");

ok(COMPETING.length === 6 && !COMPETING.some((id) => NEUTRAL.includes(id)),
  "the competing and neutral sets are disjoint");
ok(NEUTRAL.every((id) => !hasOutputPool(id)),
  "Overseer and Irradiated have no attributable output pool");
ok(SLOTS.standard === 3 && SLOTS.city === 4, "a tower takes 3 tablets, 4 on a city biome");

/* ---- pool assembly ---- */

const prices = {
  "Sibilant Catalyst": ggg("Breach", { exalted: 55, volume1H: 198 }),
  "Breach Splinter": ggg("Breach", { exalted: 0.32, volume1H: 7993 }),
  Breachstone: ggg("Breach", { exalted: 189, volume1H: 30 }),
  "Breachlord Sac": ggg("Fragments", { exalted: 3323, volume1H: 142 }),
  "Xoph's Blood": stash("UniqueAccessories", { exalted: 2, listingCount: 1381 }),
  Nightfall: stash("UniqueArmours", { exalted: 45, listingCount: 3416 }),
  "Emergent Vigour": { source: "PoE2Scout", marketFamily: "expedition", exalted: 2705 },
  "Omen of Light": ggg("Ritual", {
    exalted: 2808, volume1H: 12, metadataPath: "Metadata/Items/Currency/OmenOnAnnulRemoveAbyssMod",
  }),
};

const pools = mechanicPools(prices);
const breach = pools.breach;
const names = breach.members.map((member) => member.name);
ok(names.includes("Sibilant Catalyst") && names.includes("Breach Splinter") && names.includes("Breachstone"),
  "structural Breach markets join the pool");
ok(!names.includes("Breachlord Sac"),
  "cleared volume cannot promote a chase reward into the index");
ok(!names.includes("Xoph's Blood") && !names.includes("Nightfall"),
  "stash-quoted uniques stay out of the volume-weighted pool");
ok(breach.chase.map((item) => item.name).sort().join() === "Breachlord Sac,Nightfall,Xoph's Blood",
  "stash-quoted uniques surface as chase items");
ok(!Object.values(pools).some((pool) => pool.members.some((member) => member.name === "Emergent Vigour")),
  "a PoE2Scout family never places an item in a mechanic pool");
ok(pools.abyss.members.some((member) => member.name === "Omen of Light")
  && !pools.ritual.members.some((member) => member.name === "Omen of Light"),
"an Abyss Omen appears once, in Abyss rather than Ritual");

const seen = new Map();
for (const pool of Object.values(pools)) {
  for (const member of [...pool.members, ...pool.chase]) {
    ok(!seen.has(member.name), `${member.name} is claimed by exactly one mechanic`);
    seen.set(member.name, pool.id);
  }
}

const coverage = curatedCoverage({ Nightfall: stash("UniqueArmours") });
ok(coverage.missing.length === coverage.total - 1,
  "curated names without a quote are counted as missing");
ok(coverage.missing.every((item) => item.name && item.mechanic),
  "every missing curated name is reported by name and mechanic");
ok(coverage.missing.some((item) => item.name === "Xoph's Blood"),
  "a curated name that matched nothing is named, not dropped");

/* Classification follows reward identity, independent of price feed and volume. */
const audit = mechanicPools({
  "Head of the King": ggg("Ritual", { exalted: 100, volume1H: 999 }),
  "Raven's Reflection": ggg("Delirium", { exalted: 50, volume1H: 999 }),
  "Expedition Logbook": ggg("Expedition", { exalted: 20, volume1H: 2 }),
  "Ancient Collarbone": ggg("Abyss", { exalted: 20, volume1H: 2 }),
  "Atziri's Rule": stash("UniqueWeapons", { exalted: 20 }),
  "Olroth's Conviction": ggg("LineageSupportGems", { exalted: 30, volume1H: 5 }),
  "Jiquani's Thesis": ggg("SoulCores", { exalted: 1000, volume1H: 5, metadataPath: "Metadata/Items/SoulCores/ThesisOfSouls" }),
  "Broken quote": ggg("Breach", { exalted: 0 }),
  "Invalid quote": ggg("Breach", { exalted: Infinity }),
});
for (const [id, name] of [["ritual", "Head of the King"], ["delirium", "Raven's Reflection"], ["vaal", "Atziri's Rule"], ["vaal", "Jiquani's Thesis"], ["expedition", "Olroth's Conviction"]]) {
  ok(audit[id].chase.some((item) => item.name === name && item.reason) && !audit[id].members.some((item) => item.name === name), `${name} stays outside the baseline with an explanation`);
}
ok(audit.expedition.members.some((item) => item.name === "Expedition Logbook"), "logbooks remain ordinary Expedition basket markets");
ok(audit.abyss.members.some((item) => item.name === "Ancient Collarbone"), "shared ordinary bones are not made boss-exclusive");
ok(audit.breach.members.length === 0 && audit.breach.unpriced.length === 2, "invalid and zero prices are disclosed and excluded");
ok(curatedCoverage({ Nightfall: { exalted: 0 } }).matched === 0, "a zero quote is missing coverage, not a valid price");
ok(pools.expedition.chase.some((item) => item.name === "Emergent Vigour"), "explicit boss curation can identify a reward independently of an unreliable market family");

/* ---- weights ---- */

const members = [
  { name: "A", entry: { exalted: 10, volume1H: 60 } },
  { name: "B", entry: { exalted: 100, volume1H: 30 } },
  { name: "C", entry: { exalted: 1000, volume1H: 10 } },
];
const supply = poolWeights(members, "supply");
near(supply.get("A"), .6, "supply weight is the share of cleared units");
const turnover = poolWeights(members, "turnover");
near(turnover.get("C"), 10000 / (600 + 3000 + 10000), "turnover weight is the share of cleared value");
const equal = poolWeights(members, "equal");
near(equal.get("A"), 1 / 3, "equal weighting ignores both price and volume");
near([...supply.values()].reduce((sum, value) => sum + value, 0), 1, "weights are normalized");

const noBasis = poolWeights([{ name: "A", entry: { exalted: 5 } }, { name: "B", entry: { exalted: 5 } }], "supply");
near(noBasis.get("A"), .5, "a pool with no volume at all falls back to equal shares");

near(concentration(supply).top, .6, "concentration reports the largest share");
ok(concentration(supply).heavy === true, "a 60% share is flagged as concentrated");
ok(concentration(equal).heavy === false, "an even basket is not flagged");
near(poolFlow(members), 10 * 60 + 100 * 30 + 1000 * 10, "flow is cleared value per hour");

/* ---- liquidity evidence ---- */

ok(liquidity({ volume1H: 200 }).basis === "volume", "cleared volume is preferred evidence");
ok(liquidity({ volume1H: 20, volumeExalted: 5000 }).basis === "volume", "cleared units win when both trade measurements exist");
ok(liquidity({ volumeExalted: 2500 }).basis === "turnover" && liquidity({ volumeExalted: 2500 }).unit === "ex/h",
  "poe.ninja exchange turnover is visible when unit volume is unavailable");
ok(liquidity({ listingCount: 3000 }).basis === "listings", "listings are used when nothing cleared");
ok(liquidity({ source: "PoE2Scout" }).basis === "none" && liquidity({ source: "PoE2Scout" }).label === "No depth from PoE2Scout",
  "a quote source without depth evidence is named rather than reported as unexplained unknown liquidity");

ok(farmSignal(.2).tone === "gain" && /Outputs/.test(farmSignal(.2).label), "positive spread gets a glanceable favourable signal");
ok(farmSignal(-.2).tone === "loss" && /Entry/.test(farmSignal(-.2).label), "negative spread gets a glanceable unfavourable signal");
ok(farmSignal(.01).tone === "flat" && farmSignal(null).tone === "unknown", "small spreads and missing history are not overstated");

/* ---- the index ---- */

const at = (hour) => new Date(Date.UTC(2026, 7, 20, hour)).toISOString();
const timestamps = [at(0), at(1), at(2), at(3)];
const flat = { timestamps, divineExalted: [100, 100, 100, 100], series: { A: [10, 10, 10, 10], B: [10, 10, 10, 10], C: [10, 10, 10, 10] } };

const flatIndex = buildBasketIndex(flat, members);
ok(flatIndex.points.length === 4, "a complete history charts every snapshot");
near(flatIndex.points[0].value, 100, "the index is rebased to 100 at the window start");
near(flatIndex.change, 0, "flat prices are a flat index");

/* Weights are fixed at the snapshot, so changing volume alone must not move a
   line that is only supposed to report prices. */
const heavier = members.map((member) => ({ ...member, entry: { ...member.entry, volume1H: member.entry.volume1H * 7 } }));
near(buildBasketIndex(flat, heavier).change, 0, "a volume change with flat prices leaves the index still");

const doubled = { ...flat, series: { A: [10, 10, 10, 20], B: [10, 10, 10, 20], C: [10, 10, 10, 20] } };
near(buildBasketIndex(doubled, members).change, 1, "a doubling of every member doubles the index");

/* One member moves; the index must move by that member's share and no more. */
const oneMoved = { ...flat, series: { A: [10, 10, 10, 20], B: [10, 10, 10, 10], C: [10, 10, 10, 10] } };
near(buildBasketIndex(oneMoved, members).change, .6, "a member's move enters the index at its weight");

const missing = buildBasketIndex({ ...flat, series: { A: flat.series.A, B: flat.series.B } }, members);
ok(missing.excluded.includes("C"), "a member with no stored history is excluded");
ok(missing.points.length === 0 && /only 2 of 3/.test(missing.reason),
  "dropping below the minimum returns no index and says why");

/* A member whose series starts late must shorten the window rather than make
   the basket jump on the snapshot it joins. */
const late = {
  timestamps,
  divineExalted: [100, 100, 100, 100],
  series: { A: [10, 10, 10, 10], B: [10, 10, 10, 10], C: [null, null, 10, 10] },
};
const lateIndex = buildBasketIndex(late, members);
ok(lateIndex.points.length === 2, "the window is the members' overlap, not the longest series");
near(lateIndex.change, 0, "a member joining mid-window produces no step");

const gap = {
  timestamps,
  divineExalted: [100, 100, 100, 100],
  series: { A: [10, null, 10, 10], B: [10, 10, 10, 10], C: [10, 10, 10, 10] },
};
ok(buildBasketIndex(gap, members).points.length === 4,
  "a single missed hour uses the nearest sample instead of dropping the snapshot");

ok(buildBasketIndex({ timestamps: [], series: {} }, members).reason === "no stored history yet",
  "a league with no history says so rather than charting a point");
ok(buildBasketIndex(flat, members.slice(0, MIN_MEMBERS - 1)).points.length === 0,
  "fewer than the minimum members never charts");

/* Divine-adjusted removes the rate drift rather than reporting it as a move. */
const drifting = {
  timestamps,
  divineExalted: [100, 100, 100, 200],
  series: { A: [10, 10, 10, 20], B: [10, 10, 10, 20], C: [10, 10, 10, 20] },
};
near(buildBasketIndex(drifting, members, { divineAdjusted: true }).change, 0,
  "a move that only tracked the Divine rate is flat once adjusted");
near(buildBasketIndex(drifting, members).change, 1, "the same move is a real gain in Exalted");

/* ---- spread ---- */

/* Return against entry is a ratio, not a subtraction. Runes of Aldur priced the
   Delirium Tablet up 486% against a basket down 6%; subtracting reported that
   as "-492%", a number with no meaning. The ratio says the basket bought 84%
   less tablet than it did at the start of the window. */
const spread = (ret, entry) => (1 + ret) / (1 + entry) - 1;
near(spread(-.064, 4.86), .936 / 5.86 - 1, "spread is the return relative to the entry cost");
ok(spread(-.064, 4.86) > -1, "a ratio spread cannot fall below losing everything");
near(spread(.5, .5), 0, "return and entry moving together is no spread at all");
ok(spread(.2, 0) > 0 && spread(0, .2) < 0, "spread takes the sign of the side that outpaced");

/* ---- a mechanic with output but no tablet ---- */

/* This league prices no Expedition Tablet while Expedition clears more than any
   other mechanic. Keying the card list off tablet families alone dropped it
   from the page entirely, so pool membership has to be able to stand alone. */
const expeditionPrices = {
  "Expedition Logbook": ggg("Expedition", { exalted: 414, volume1H: 95, tags: ["expedition_logbook", "default"] }),
  "Perfect Flux": ggg("Expedition", { exalted: 11852, volume1H: 28 }),
  "Void Flux": ggg("Expedition", { exalted: 12, volume1H: 300 }),
};
const tabletless = mechanicPools(expeditionPrices);
ok(tabletless.expedition.members.length === 3,
  "a mechanic's pool exists independently of whether its tablet is quoted");
ok(poolFlow(tabletless.expedition.members) > 0,
  "flow is reported for a mechanic with no tablet baseline");

/* Mapping entry uses tablets; logbooks remain output and boss-entry items. */
const entryPrices = { ...expeditionPrices,
  "Expedition Tablet": { exalted: 8, marketFamily: "PrecursorTablets", variant: "Normal", tags: ["tower_augment_expedition"] },
};
const expeditionFamily = buildTabletFamilies(entryPrices).find(row => row.id === "expedition");
assert.equal(expeditionFamily.baseline.name, "Expedition Tablet");
assert.equal(expeditionFamily.baseline.entry.exalted, 8);
assert.ok(!buildTabletFamilies(expeditionPrices).some(row => row.baseline?.name === "Expedition Logbook"));
assert.ok(tabletless.expedition.members.some(member => member.name === "Expedition Logbook"), "logbooks remain farm output");
const expeditionEntryHistory = { tabletBaselineVersion: 1,
  timestamps: ["2026-09-06T00:00:00Z", "2026-09-06T12:00:00Z", "2026-09-07T00:00:00Z"],
  divineExalted: [400, 400, 400], series: { "Expedition Tablet": [4, 6, 8] },
};
assert.equal(tabletFamilyTimeline(expeditionEntryHistory, expeditionFamily, { rangeHours: 1, currency: "exalted" }).change, null);
assert.equal(tabletFamilyTimeline(expeditionEntryHistory, expeditionFamily, { rangeHours: 12, currency: "exalted" }).points.length, 2);
assert.equal(tabletFamilyTimeline(expeditionEntryHistory, expeditionFamily, { rangeHours: 48, currency: "exalted" }).change, 1);

/* ---- contributions, movers and top of pool ---- */

const moverHistory = {
  timestamps,
  divineExalted: [100, 100, 100, 100],
  series: { Deep: [10, 10, 10, 15], Sinking: [10, 10, 10, 5], Illiquid: [10, 10, 10, 900] },
};
const moverMembers = [
  { name: "Deep", entry: { exalted: 15, volume1H: 500 } },
  { name: "Sinking", entry: { exalted: 5, volume1H: 500 } },
  { name: "Illiquid", entry: { exalted: 900, volume1H: 1 } },
];
const { index: moverIndex, rows: moverRows } = poolContributions(moverHistory, moverMembers);

/* The property that makes contribution ranking meaningful: every market's share
   of the move adds up to the move. Without it the numbers would look plausible
   and mean nothing — the first attempt used weight x percentage change, which
   summed to 38 points against a 2.88% index move. */
near(moverRows.reduce((sum, row) => sum + (row.contribution || 0), 0), moverIndex.change,
  "index contributions sum to the index change", 1e-12);

/* Ranking by percentage would put the cheap market on top; by contribution the
   market that actually carried the index does. This is the Ritual bug: three
   sub-2-Exalted omens headlined while Omen of Chance at 5,635 never appeared. */
const byPercent = [...moverRows].sort((a, b) => b.change - a.change)[0];
const byContribution = [...moverRows].sort((a, b) => b.contribution - a.contribution)[0];
ok(byPercent.name === "Illiquid", "percentage ranking favours the cheap, thin market");
ok(byContribution.name === "Deep", "contribution ranking favours the market that moved the index");
ok(byPercent.name !== byContribution.name,
  "the two rankings genuinely differ, so the switch is not cosmetic");

const movers = poolMovers(moverRows);
ok(movers.up.map((row) => row.name).join() === "Deep", "risers are ranked by contribution");
ok(movers.down.map((row) => row.name).join() === "Sinking", "fallers are reported separately");
ok(![...movers.up, ...movers.down].some((row) => row.name === "Illiquid"),
  "a market nobody trades cannot headline a mover list");

/* The shortlist gate is the reason a thin market must still be reachable. */
const top = topOfPool(moverRows);
ok(top[0].name === "Illiquid",
  "top of pool is a price sort, so the expensive thin market is visible");
ok(top[0].market.count === 1 && top[0].market.basis === "volume",
  "its thinness travels with it rather than being hidden");
ok(topOfPool(moverRows, 2).length === 2, "top of pool respects its limit");

/* Nothing is dropped: the table renders one row per member, gate or no gate. */
ok(moverRows.length === moverMembers.length,
  "every pool member has a row, so the full table hides nothing");

const changingRate = { ...moverHistory, divineExalted: [100, 120, 150, 200] };
const adjusted = poolContributions(changingRate, moverMembers, { divineAdjusted: true });
near(adjusted.rows.reduce((sum, row) => sum + (row.contribution || 0), 0), adjusted.index.change,
  "Divine-adjusted contributions add up to the adjusted basket move");
const entryHistory = { ...changingRate, series: { ...changingRate.series,
  Entry: [null, null, 20, 40], Deep: [1, 2, 10, 15],
} };
const aligned = poolContributions(entryHistory, moverMembers, { entryName: "Entry" });
ok(aligned.index.points.length === 2, "entry and basket use their common observed window");
near(aligned.index.entryChange, 1, "entry change uses those same endpoints");
near(aligned.rows.reduce((sum, row) => sum + (row.contribution || 0), 0), aligned.index.change,
  "member contributions use the basket endpoints even when histories begin earlier");
const alignedDivine = poolContributions(entryHistory, moverMembers, { entryName: "Entry", divineAdjusted: true });
near((1 + aligned.index.change) / (1 + aligned.index.entryChange),
  (1 + alignedDivine.index.change) / (1 + alignedDivine.index.entryChange),
  "return versus entry is currency-invariant when both sides use the same timestamps");
const dominant = buildBasketIndex({ ...flat, series: { A: [1000, 1000, 1000, 1000], B: [1, 1, 1, 1], C: [1, 1, 1, 1] } }, members, { mode: "equal" });
ok(dominant.concentration.top > .99 && dominant.dominant[0] === "A",
  "concentration shows economic influence, even when nominal item weights are equal");
const unweightedLate = buildBasketIndex({ ...flat, series: { ...flat.series, D: [null, null, null, 5] } },
  [...members, { name: "D", entry: { exalted: 5 } }]);
ok(unweightedLate.points.length === 4 && unweightedLate.excluded.includes("D"),
  "an unweighted market cannot shorten the whole basket's history");
const longGap = { timestamps: [at(0), at(5), at(10)], divineExalted: [100, 100, 100],
  series: { A: [10, null, 10], B: [10, 10, 10], C: [10, 10, 10] } };
ok(buildBasketIndex(longGap, members).points.length === 2,
  "a multi-hour quote gap is not silently filled with a remote observation");

console.log(fails ? `${fails} failing assertion(s)` : "test-farms: all assertions passed");
process.exit(fails ? 1 : 0);
