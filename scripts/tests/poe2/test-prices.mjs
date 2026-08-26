import assert from "node:assert/strict";
import { describePriceSources, enrichPriceMetadata, exchangeToPrices, itemStateKey, mergePrices, normalizeItemClass, poe2QuoteScore, scoutToPrices, selectTrackedLeagues, slugifyLeague, stashToPrices } from "../../poe2/prices.mjs";
import { buildGggExchangeSnapshot, buildGggPrices, DIVINE_ID, EXALTED_ID, ratioBounds } from "../../poe2/ggg-exchange.mjs";
import { groupMarkets, marketCategory, marketSubcategory } from "../../../src/games/poe2/features/pricing/marketCategories.js";
import { buildTabletFamilies, sortTabletRows, tabletFamily, tabletFamilyTimeline } from "../../../src/games/poe2/features/farms/tabletFarms.js";

const exchange = exchangeToPrices({
  core: { primary: "divine", rates: { exalted: 400 } },
  items: [{ id: "x", name: "Breach Splinter" }],
  lines: [{ id: "x", primaryValue: .25, count: 9 }],
});
assert.equal(exchange.divineExalted, 400);
assert.equal(exchange.prices["Breach Splinter"].exalted, 100);
assert.equal(exchange.prices["Breach Splinter"].itemId, "x", "normalized quotes retain a stable source id for future features");

const stash = stashToPrices({
  core: { primary: "divine", rates: { exalted: 400 } },
  lines: [
  { name: "Temporalis", primaryValue: 2.25, listingCount: 4 },
  { name: "Temporalis", primaryValue: 2.125, listingCount: 2 },
] });
assert.equal(stash.Temporalis.exalted, 850, "the cheapest priced variant is conservative for EV");
assert.equal(stashToPrices({ core: { primary: "exalted" }, lines: [{ name: "Temporalis", primaryValue: 3 }] }, "UniqueArmours").Temporalis.type, "UniqueArmours", "stash feed families are retained for market browsing");
const precursorTablets = stashToPrices({ core: { primary: "exalted" }, lines: [
  { name: "Breach Tablet", baseType: "Breach Tablet", variant: "Rare", primaryValue: 8, listingCount: 100 },
  { name: "Breach Tablet", baseType: "Breach Tablet", variant: "Normal", primaryValue: 20, listingCount: 40 },
  { name: "Breach Tablet", baseType: "Breach Tablet", variant: "Magic", primaryValue: 10, listingCount: 80 },
] }, "PrecursorTablets");
assert.equal(precursorTablets["Breach Tablet"].variant, "Normal", "Normal tablet quotes are retained as the Popular Farms baseline");
assert.equal(precursorTablets["Breach Tablet"].exalted, 20);
const typedStash = stashToPrices({ core: { primary: "exalted" }, lines: [{ name: "Bluetongue", category: "Ezomyte [Sword|One Hand Sword]", baseType: "Shortsword", primaryValue: 3 }] }, "UniqueWeapons");
assert.equal(typedStash.Bluetongue.itemClass, "One Hand Sword", "poe.ninja's GGG category markup is normalized to the stable item class");
assert.equal(normalizeItemClass("Ezomyte [Sword|One Hand Sword]"), "One Hand Sword");
assert.equal(marketCategory("Divine Orb", { source: "GGG completed trades" }), "currency");
assert.equal(marketCategory("Temporalis", { itemClass: "Body Armour", marketFamily: "UniqueArmours" }), "equipment");
assert.equal(marketCategory("Uncut Skill Gem (Level 20)", { type: "uncutgems" }), "gems");
assert.equal(marketCategory("Dream Fragments", { itemClass: "Ring", marketFamily: "UniqueAccessories" }), "equipment", "explicit gear metadata wins over a fragment-like name");
assert.equal(marketCategory("Splinterheart", { type: "weapon" }), "equipment", "explicit weapon metadata wins over a fragment-like name");
assert.equal(marketCategory("Rune of the Prism", {}), "crafting");
assert.equal(marketCategory("Omen of Resurgence", {}), "league");
assert.equal(marketCategory("A Newly Introduced Support", { itemClass: "SoulCore", marketFamily: "LineageSupportGems" }), "gems", "new Lineage Supports need no display-name rule");
assert.equal(marketCategory("A Newly Introduced Rune", { itemClass: "StackableCurrency", marketFamily: "Runes", tags: ["rune"] }), "crafting", "new runes are classified from feed metadata");
assert.equal(marketCategory("Refined Necrotic Catalyst", { itemClass: "Breach", tags: ["jewel_catalyst", "minion_catalyst"] }), "crafting", "specific catalyst metadata wins over the broad jewel tag");
assert.equal(marketCategory("Simulacrum Splinter", { itemClass: "Delirium", marketFamily: "Fragments" }), "fragments", "fragment identity wins over its league metadata");
assert.equal(marketCategory("Clear Skies", { itemClass: "Tablet", tags: ["tower_augment_delirium"] }), "maps", "tablet identity wins over its league metadata");
assert.equal(marketCategory("Idol of Alira", { itemClass: "SoulCore", tags: ["idol"] }), "league", "idols are not mixed into Soul Cores");
assert.equal(marketCategory("A Newly Introduced Key", { itemClass: "VaultKey" }), "fragments");
assert.equal(marketSubcategory("crafting", "Greater Essence of Haste", { type: "essences" }), "essences");
assert.equal(marketSubcategory("crafting", "Refined Necrotic Catalyst", { tags: ["jewel_catalyst"] }), "catalysts");
assert.equal(marketSubcategory("crafting", "Liquid Verisium", { itemClass: "Verisium", metadataPath: "Metadata/Items/Currency/CurrencyRerollRemnant" }), "metals", "Verisium is not a Delirium liquid");
assert.equal(marketSubcategory("league", "Gnawed Jawbone", { itemClass: "Abyss" }), "abyss");
assert.equal(marketSubcategory("league", "Synthetic Breach Item", { itemClass: "Breach" }), "breach");
assert.equal(marketSubcategory("league", "Omen of Resurgence", { itemClass: "Ritual" }), "omens");
assert.equal(marketSubcategory("league", "Head of the King", { itemClass: "Ritual" }), "ritual");
assert.equal(marketSubcategory("league", "Idol of Alira", { type: "ritual", tags: ["idol"] }), "idols", "specific item identity wins over an overly broad feed family");
assert.equal(marketSubcategory("league", "Architect's Orb", { itemClass: "Vaal", tags: ["incursion_currency"] }), "incursion");
assert.equal(marketSubcategory("fragments", "Azmeri Reliquary Key", { type: "vaultkeys" }), "reliquary");
assert.equal(marketSubcategory("fragments", "Origin Core", { type: "vaultkeys" }), "encounter");
assert.equal(marketSubcategory("fragments", "Ancient Crisis Fragment", { type: "vaultkeys" }), "fragments");
assert.equal(marketSubcategory("equipment", "Temporalis", { itemClass: "Body Armour" }), "body-armour");
assert.equal(marketSubcategory("equipment", "Dream Fragments", { itemClass: "Ring" }), "rings");
assert.equal(marketSubcategory("equipment", "Bluetongue", { itemClass: "One Hand Sword" }), "weapons");
assert.deepEqual(groupMarkets(["Divine Orb", "Temporalis"], {
  "Divine Orb": { source: "GGG completed trades" },
  Temporalis: { itemClass: "Body Armour", marketFamily: "UniqueArmours" },
}).currency, ["Divine Orb"]);
assert.deepEqual(groupMarkets(["Greater Essence of Haste"], {
  "Greater Essence of Haste": { type: "essences" },
}).subgroups.crafting.essences, ["Greater Essence of Haste"]);

const tabletFamilies = buildTabletFamilies({
  "Breach Tablet": { exalted: 12, itemClass: "Tablet", marketFamily: "PrecursorTablets", variant: "Normal", tags: ["tower_augment_breach"] },
  "Wraeclast Besieged": { exalted: 40, itemClass: "Tablet", marketFamily: "UniqueTablets", baseType: "Breach Tablet", tags: ["tower_augment_breach"] },
  "Clear Skies": { exalted: 20, itemClass: "Tablet", marketFamily: "UniqueTablets", baseType: "Delirium Tablet", tags: ["tower_augment_delirium"] },
});
assert.equal(tabletFamily("Wraeclast Besieged", { tags: ["tower_augment_breach"] }), "breach");
assert.equal(tabletFamily("Temple Tablet", { tags: ["tower_augment_incursion"] }), "vaal", "Temple tablets use the Fate of the Vaal league card");
assert.equal(tabletFamilies.find((group) => group.id === "breach").baseline.name, "Breach Tablet", "default tablets are the mechanic baseline");
assert.deepEqual(tabletFamilies.find((group) => group.id === "breach").uniques.map((row) => row.name), ["Wraeclast Besieged"]);
assert.equal(tabletFamilies.find((group) => group.id === "delirium").baselineName, "Delirium Tablet", "unique metadata identifies a missing baseline without treating the unique as its price");
assert.deepEqual(sortTabletRows([
  { label: "Breach", baselineValue: 188, timeline: { change: .2 } },
  { label: "Ritual", baselineValue: 248, timeline: { change: .1 } },
  { label: "Abyss", baselineValue: 122, timeline: { change: .3 } },
]).map((row) => row.label), ["Ritual", "Breach", "Abyss"], "Popular Farms defaults to descending Normal-tablet value");
const breachFamily = tabletFamilies.find((group) => group.id === "breach");
const legacyTabletTimeline = tabletFamilyTimeline({
  timestamps: ["2026-08-21T10:00:00.000Z", "2026-08-21T11:00:00.000Z"],
  divineExalted: [360, 360],
  series: { "Breach Tablet": [8, 20], "Chaos Orb": [30, 30] },
}, breachFamily, { currency: "exalted" });
assert.deepEqual(legacyTabletTimeline.points.map((point) => point.value), [20], "the client hides incompatible cheapest-rarity history before the scheduled migration runs");
assert.equal(legacyTabletTimeline.change, null);

const metadataMerge = mergePrices({ Test: { exalted: 4, source: "poe.ninja exchange", type: "LineageSupportGems", itemId: "test-id" } }, {
  Test: { exalted: 3, source: "GGG completed trades" },
});
assert.equal(metadataMerge.Test.type, "LineageSupportGems", "higher-priority quotes retain useful catalogue metadata");
assert.equal(metadataMerge.Test.itemId, "test-id");

const enrichable = { NewBase: { exalted: 1, source: "PoE2Scout" } };
const coverage = enrichPriceMetadata(enrichable, {
  "Metadata/Items/Test/NewBase": { name: "NewBase", item_class: "Helmet", tags: ["armour"] },
});
assert.equal(enrichable.NewBase.itemClass, "Helmet", "RePoE metadata enriches non-GGG quotes by stable base name");
assert.deepEqual(enrichable.NewBase.tags, ["armour"]);
assert.equal(enrichable.NewBase.identityConfidence, "name",
  "a display-name match is recorded as the weaker identity it is");
assert.deepEqual({ total: coverage.total, byName: coverage.byName, unmatched: coverage.unmatched }, { total: 1, byName: 1, unmatched: 0 },
  "enrichment reports coverage so it can be measured rather than assumed");

/* Two Metadata paths sharing one display name is a real case, and a name match
   against it is not evidence about which item was priced. */
const ambiguous = { Twin: { exalted: 2, source: "PoE2Scout" } };
const ambiguousCoverage = enrichPriceMetadata(ambiguous, {
  "Metadata/Items/Test/TwinA": { name: "Twin", item_class: "Ring", tags: ["ring"] },
  "Metadata/Items/Test/TwinB": { name: "Twin", item_class: "Amulet", tags: ["amulet"] },
});
assert.equal(ambiguousCoverage.ambiguous, 1, "an ambiguous name match is counted as ambiguous");
assert.equal(ambiguous.Twin.identityConfidence, "name-ambiguous", "and says so on the entry");

const unmatchedCoverage = enrichPriceMetadata({ Mystery: { exalted: 1, source: "PoE2Scout" } }, {
  "Metadata/Items/Test/Other": { name: "Other" },
});
assert.deepEqual(unmatchedCoverage.unmatchedNames, ["Mystery"], "unmatched names are reported, not swallowed");

const hateforge = stashToPrices({
  core: { primary: "divine", rates: { exalted: 346.8 } },
  lines: [{ name: "Hateforge", primaryValue: .5766, listingCount: 682 }],
});
assert.equal(hateforge.Hateforge.exalted, 199.96488, "PoE 2 stash prices convert from the declared primary currency to Exalted");

const exaltedStash = stashToPrices({ core: { primary: "exalted", rates: { divine: 1 / 400 } }, lines: [
  { name: "The Adorned", primaryValue: 30, listingCount: 10 },
] });
assert.equal(exaltedStash["The Adorned"].exalted, 30, "Exalted-primary stash values are not converted twice");

const merged = mergePrices({ Temporalis: stash.Temporalis }, { Temporalis: { exalted: 800, source: "poe.ninja exchange" } });
assert.equal(merged.Temporalis.exalted, 800, "completed exchange pricing wins when present");

const scout = scoutToPrices([
  { Name: "Temporalis", Text: "Temporalis Silk Robe", CurrentPrice: 1200, CategoryApiId: "armour" },
  { Name: "Temporalis", Text: "Temporalis Silk Robe", CurrentPrice: 1100, CategoryApiId: "armour" },
  { Name: null, Text: "Origin Spark", CurrentPrice: 75, CategoryApiId: "fragment" },
  { Name: "No Price", CurrentPrice: null },
]);
assert.equal(scout.Temporalis.exalted, 1100, "PoE2Scout keeps the conservative floor when a name has variants");
assert.equal(scout["Origin Spark"].source, "PoE2Scout", "PoE2Scout falls back to Text for items without a Name");
assert.equal(mergePrices({ Temporalis: stash.Temporalis }, scout).Temporalis.exalted, 850, "PoE2Scout cannot replace poe.ninja stash prices");
assert.equal(mergePrices({ "Origin Spark": scout["Origin Spark"] }, { "Origin Spark": { exalted: 70, source: "poe.ninja exchange" } })["Origin Spark"].exalted, 70, "poe.ninja exchange replaces PoE2Scout gap-fill");

const now = Date.now();
const staleOfficial = { exalted: 50, source: "GGG completed trades", marketHour: new Date(now - 72 * 3600e3).toISOString(), volumeExalted: 1 };
const liquidNinja = { exalted: 48, source: "poe.ninja exchange", observedAt: new Date(now - 3600e3).toISOString(), volumeExalted: 100000 };
assert.ok(poe2QuoteScore(liquidNinja, now) > poe2QuoteScore(staleOfficial, now),
  "fresh liquid evidence can beat a stale higher-trust source");
assert.equal(mergePrices({ Test: staleOfficial }, { Test: liquidNinja }).Test.exalted, 48,
  "the merge applies the evidence-aware score rather than fixed precedence");
assert.equal(mergePrices({ Stateful: { exalted: 10, source: "poe.ninja stash", variant: "Normal" } },
  { Stateful: { exalted: 20, source: "GGG completed trades", variant: "Corrupted", corrupted: true } }).Stateful.exalted, 10,
  "incompatible item states are never compared as interchangeable quotes");
assert.deepEqual(selectTrackedLeagues([{ name: "Runes of Aldur" }, { name: "Hardcore" }, { name: "Standard" }]), ["Runes of Aldur", "Standard"]);
assert.equal(slugifyLeague("Runes of Aldur"), "runes-of-aldur");

const itemId = "Metadata/Items/Test/BossEntry";
const market = (a, b, av, bv, low = [av, bv], high = [av, bv]) => ({
  league: "Test",
  market_pair: [a, b],
  volume_traded: { [a]: av, [b]: bv },
  lowest_ratio: { [a]: low[0], [b]: low[1] },
  highest_ratio: { [a]: high[0], [b]: high[1] },
});
const official = buildGggPrices([
  market(DIVINE_ID, EXALTED_ID, 2, 800, [1, 390], [1, 410]),
  market(itemId, DIVINE_ID, 10, 1, [12, 1], [8, 1]),
], { [itemId]: { name: "Boss Entry", item_class: "PinnacleKeyStackable", tags: ["default"], inherits_from: "Metadata/Items/MapFragments/PinnacleKeyStackable" }, [DIVINE_ID]: { name: "Divine Orb" }, [EXALTED_ID]: { name: "Exalted Orb" } }, "Test");
assert.equal(official.divineExalted, 400);
assert.equal(official.prices["Boss Entry"].exalted, 40, "GGG Divine pairs convert through the same-hour Exalted rate");
assert.equal(official.prices["Boss Entry"].itemId, itemId, "GGG Metadata ids remain available in the normalized market catalogue");
assert.equal(official.prices["Boss Entry"].itemClass, "PinnacleKeyStackable");
assert.deepEqual(official.prices["Boss Entry"].tags, ["default"]);
assert.equal(mergePrices({ "Boss Entry": { exalted: 99, source: "poe.ninja exchange" } }, official.prices)["Boss Entry"].exalted, 40, "GGG completed trades have priority");
assert.deepEqual(ratioBounds(market(itemId, DIVINE_ID, 10, 1, [12, 1], [8, 1]), itemId, DIVINE_ID), { low: 1 / 12, high: 1 / 8 });
const exchangeSnapshot = buildGggExchangeSnapshot([
  market(DIVINE_ID, EXALTED_ID, 2, 800, [1, 390], [1, 410]),
  market(itemId, DIVINE_ID, 10, 1, [12, 1], [8, 1]),
], { [itemId]: { name: "Boss Entry", item_class: "Fragment" }, [DIVINE_ID]: { name: "Divine Orb" }, [EXALTED_ID]: { name: "Exalted Orb" } }, "Test", 1_787_200_000);
assert.equal(exchangeSnapshot.pairs.length, 2);
assert.equal(exchangeSnapshot.items[itemId].type, "Fragment");
const storedBossPair = exchangeSnapshot.pairs.find((pair) => pair.id.includes(itemId));
assert.equal(storedBossPair.leftVolume + storedBossPair.rightVolume, 11, "both completed sides of every pair are retained");
assert.ok(storedBossPair.lowRightPerLeft <= storedBossPair.highRightPerLeft, "traded bounds are normalized after canonical pair ordering");

console.log("PoE 2 price parsing passed.");

/* ---- endpoint registry ----

   Two documented facts that were wrong for months: four exchange types were
   never requested, so everything in them was unpriced or fell through to a
   listing feed. The registry is the single place both lists live. */
const registry = await import("../../poe2/endpoints.mjs");
for (const type of ["UncutGems", "Essences", "Idols", "Runes"]) {
  assert.ok(registry.EXCHANGE_TYPES.includes(type), `${type} is a documented exchange type and must be requested`);
}
assert.equal(new Set(registry.EXCHANGE_TYPES).size, registry.EXCHANGE_TYPES.length, "no type is requested twice");
assert.ok(registry.DOCUMENTED.every((entry) => entry.enabled ? entry.consumer : entry.reason),
  "every enabled type names its consumer and every skipped one states why");
assert.ok(registry.DOCUMENTED.every((entry) => registry.FAMILIES[entry.family]),
  "every type names a documented endpoint family");

/* ---- liquidity evidence survives parsing ---- */
const liquid = exchangeToPrices({
  core: { primary: "divine", rates: { exalted: 400 } },
  items: [{ id: "breach-splinter", name: "Breach Splinter" }],
  lines: [{
    id: "breach-splinter", primaryValue: .25, count: 9,
    volumePrimaryValue: 12.5, maxVolumeCurrency: "exalted", maxVolumeRate: 100,
    sparkline: { data: [1, 2, null, 3] },
  }],
}, "Fragments");
const splinter = liquid.prices["Breach Splinter"];
assert.equal(splinter.volumeExalted, 12.5 * 400, "traded volume is kept and converted to the display unit");
assert.equal(splinter.maxVolumeCurrency, "exalted", "the pair that carried the volume is kept");
assert.equal(splinter.maxVolumeRate, 100);
assert.deepEqual(splinter.sparkline, [1, 2, 3], "the sparkline is kept, with gaps removed");
assert.equal(splinter.quotedIn, "divine", "the response's own primary currency travels with the quote");
assert.equal(liquid.rawRows, 1);
assert.equal(liquid.accepted, 1);

/* ---- stash item state survives parsing ---- */
const stateful = stashToPrices({
  core: { primary: "exalted", rates: { exalted: 1 } },
  lines: [{
    name: "Hateforge", baseType: "Ornate Gauntlets", id: 4211, itemId: "hateforge", detailsId: "hateforge-ornate",
    primaryValue: 200, listingCount: 682, variant: "Two Sockets", corrupted: true, levelRequired: 45,
    category: "UniqueArmours", icon: "https://web.poecdn.com/hateforge.png", sparkLine: { data: [5, 6, 7] },
  }],
}, "UniqueArmours");
const forge = stateful.Hateforge;
assert.equal(forge.variant, "Two Sockets", "the variant is part of the item, not decoration");
assert.equal(forge.corrupted, true, "corruption is a different item state and is retained");
assert.equal(forge.levelRequired, 45);
assert.equal(forge.baseType, "Ornate Gauntlets");
assert.equal(forge.detailsId, "hateforge-ornate");
assert.equal(forge.sourceId, 4211, "the source's own numeric id is kept for continuity checks");
assert.equal(forge.icon, "https://web.poecdn.com/hateforge.png");
assert.deepEqual(forge.sparkline, [5, 6, 7]);
assert.equal(stateful.__parse.accepted, 1);

/* ---- placeholder rows never become markets ---- */
const scoutRows = scoutToPrices([
  { Name: "INCOMPLETE", CurrentPrice: 5 },
  { Name: "  ", CurrentPrice: 5 },
  { Name: "12345", CurrentPrice: 5 },
  { Name: "Real Item", CurrentPrice: 0 },
  { Name: "Another Item", CurrentPrice: 3, CurrentQuantity: 7 },
]);
assert.deepEqual(Object.keys(scoutRows), ["Another Item"], "placeholders are rejected and unpriced markets are skipped");
assert.equal(scoutRows.__parse.rejected, 3);
assert.equal(scoutRows.__parse.rejectedReasons.placeholder_name, 3);
assert.equal(scoutRows.__parse.skipped, 1);
assert.equal(scoutRows.__parse.skippedReasons.unpriced, 1);

/* ---- the credit line is derived from what answered ---- */
assert.equal(describePriceSources({ a: { source: "GGG completed trades" } }), "GGG completed trades");
assert.equal(
  describePriceSources({ a: { source: "GGG completed trades" }, b: { source: "poe.ninja stash" }, c: { source: "PoE2Scout" } }),
  "GGG completed trades, poe.ninja, then PoE2Scout gap-fill",
);
assert.equal(describePriceSources({ a: { source: "PoE2Scout" } }), "PoE2Scout gap-fill",
  "a run that only Scout answered for must not credit GGG");
assert.equal(describePriceSources({}), "no source answered");

/* ---- GGG stock and completed bounds are kept ---- */
const stockMarket = {
  league: "Test",
  market_pair: [EXALTED_ID, "Metadata/Items/Test/Thing"],
  volume_traded: { [EXALTED_ID]: 100, "Metadata/Items/Test/Thing": 10 },
  lowest_ratio: { [EXALTED_ID]: 90, "Metadata/Items/Test/Thing": 10 },
  highest_ratio: { [EXALTED_ID]: 120, "Metadata/Items/Test/Thing": 10 },
  lowest_stock: { [EXALTED_ID]: 5, "Metadata/Items/Test/Thing": 2 },
  highest_stock: { [EXALTED_ID]: 500, "Metadata/Items/Test/Thing": 40 },
};
const stocked = buildGggPrices([stockMarket], { "Metadata/Items/Test/Thing": { name: "Thing" } }, "Test", 1700000000);
assert.equal(stocked.prices.Thing.exalted, 10, "the volume-weighted completed rate is unchanged");
assert.equal(stocked.prices.Thing.low, 9, "the hour's own low ratio is kept");
assert.equal(stocked.prices.Thing.high, 12);
assert.equal(stocked.prices.Thing.lowStock, 2, "stock bounds are kept rather than discarded");
assert.equal(stocked.prices.Thing.highStock, 40);

console.log("PoE 2 source evidence passed.");

/* ---- item state is identity, not decoration ----

   "The cheapest quote for this name" is only meaningful while every quote
   describes the same item. A corrupted copy cannot be modified further and is
   priced accordingly, so collapsing it into the same headline answers a
   different question than the one asked. */
assert.equal(itemStateKey({ variant: "Two Sockets", corrupted: true, levelRequired: 45 }), "two sockets|corrupted|ilvl45");
assert.equal(itemStateKey({ variant: "Normal" }), "normal");
assert.equal(itemStateKey({}), null, "currency has no state to key on");

const states = stashToPrices({
  core: { primary: "exalted", rates: { exalted: 1 } },
  lines: [
    { name: "Hateforge", primaryValue: 40, variant: "Two Sockets", corrupted: true, listingCount: 3 },
    { name: "Hateforge", primaryValue: 100, variant: "Two Sockets", listingCount: 9 },
    { name: "Hateforge", primaryValue: 130, variant: "Three Sockets", listingCount: 4 },
  ],
}, "UniqueArmours");
assert.equal(states.Hateforge.exalted, 100,
  "a cheaper corrupted row does not become the headline for an uncorrupted item");
assert.equal(states.Hateforge.corrupted, undefined);
assert.equal(Object.keys(states.Hateforge.variants).length, 3, "every distinct state is kept and comparable");
assert.equal(states.Hateforge.variants["two sockets|corrupted"].exalted, 40);
assert.equal(states.Hateforge.variants["three sockets"].exalted, 130);
assert.equal(states.Hateforge.variants["two sockets"].listingCount, 9);

const single = stashToPrices({
  core: { primary: "exalted", rates: { exalted: 1 } },
  lines: [{ name: "Solo", primaryValue: 5, variant: "Normal" }],
}, "UniqueArmours");
assert.equal(single.Solo.variants, undefined,
  "one state is the headline under another name and costs no bytes");

/* The tablet baseline rule still holds: Normal is the baseline whatever a
   Magic or Rare copy costs, because that is the market Popular farms tracks. */
const tabletStates = stashToPrices({
  core: { primary: "exalted", rates: { exalted: 1 } },
  lines: [
    { name: "Breach Tablet", baseType: "Breach Tablet", variant: "Rare", primaryValue: 8 },
    { name: "Breach Tablet", baseType: "Breach Tablet", variant: "Normal", primaryValue: 20 },
  ],
}, "PrecursorTablets");
assert.equal(tabletStates["Breach Tablet"].variant, "Normal");
assert.equal(tabletStates["Breach Tablet"].variants.rare.exalted, 8, "the other rarities stay visible as context");

console.log("PoE 2 item state passed.");
