/* Source evidence: what a published price is allowed to forget.

   Every field here was being fetched and thrown away. That is worse than never
   asking for it, because the request was paid for and the answer looked
   complete: a quote with no volume, no listing count and no item state cannot
   be told apart from a deep, liquid, correctly-identified one.

   Run: node scripts/tests/poe1/test-evidence.mjs
*/

import assert from "node:assert/strict";
import { poe1QuoteScore, poe1StateCompatible } from "../../poe1/quote.mjs";
import {
  changesFromSparkline, chaosDivisor, currencyEvidence, evidenceFrom, exchangeNamesById,
  exchangeRows, isBaseVariant, slugToName,
} from "../../poe1/sources/ninja.mjs";
import { buildGggLeagueSnapshot, CHAOS_ID, DIVINE_ID } from "../../poe1/sources/ggg-exchange.mjs";
import { nameIndex, validateBaseItems } from "../../shared/repoe.mjs";
import { CROSS_CHECK, DOCUMENTED, EXCHANGE_TYPES, FAMILIES, OMITTED, STASH_ITEM_TYPES } from "../../poe1/endpoints.mjs";

/* ---- exchange liquidity evidence survives normalization ---- */
const exchangePayload = {
  core: {
    primary: "chaos-orb",
    items: [{ id: "chaos-orb", name: "Chaos Orb" }, { id: "divine-orb", name: "Divine Orb" }],
    rates: { "chaos-orb": 1, "divine-orb": 200 },
  },
  lines: [{
    id: "divination-scarab-of-pilfering",
    primaryValue: 18,
    volumePrimaryValue: 3600,
    maxVolumeCurrency: "divine-orb",
    maxVolumeRate: 0.09,
    listingCount: 42,
    count: 7,
    detailsId: "divination-scarab-of-pilfering",
    sparkline: { data: [1, 2, 3] },
  }],
};
const rows = exchangeRows(exchangePayload, null, { divisor: 1 });
assert.equal(rows.length, 1);
const evidence = rows[0].evidence;
assert.equal(evidence.vol, 3600, "traded volume is the difference between a real market and one quote");
assert.equal(evidence.mvc, "divine-orb", "the pair that carried the volume is named");
assert.equal(evidence.mvr, 0.09);
assert.equal(evidence.lc, 42, "listing count survives");
assert.equal(evidence.cnt, 7);
assert.equal(evidence.sid, "divination-scarab-of-pilfering", "the source's own id is kept");
assert.equal(evidence.did, "divination-scarab-of-pilfering");

/* Volume is quoted in the primary reference currency, so it converts with the
   same divisor the price does — otherwise it is wrong by the chaos:primary
   ratio, exactly like an uncalibrated price. */
assert.equal(exchangeRows(exchangePayload, null, { divisor: 0.5 })[0].evidence.vol, 7200);

assert.equal(chaosDivisor(exchangePayload), 1, "chaos as the primary means a no-op divisor");
assert.equal(exchangeNamesById(exchangePayload)["divine-orb"], "Divine Orb");
assert.equal(slugToName("the-maven-s-writ"), "The Maven's Writ", "a lone s is a lost apostrophe");
assert.deepEqual(changesFromSparkline({ data: [10, 12, 15] }), { change24: 3, change48: 5 });

/* ---- stash item state survives normalization ---- */
const stashLine = {
  name: "Cinderswallow Urn", baseType: "Silver Flask", id: 8812, detailsId: "cinderswallow-urn-life",
  chaosValue: 120, listingCount: 18, count: 3, variant: "Life", corrupted: true, links: 6,
  gemLevel: 21, gemQuality: 20, icon: "https://web.poecdn.com/urn.png",
};
const stash = evidenceFrom(stashLine);
assert.equal(stash.bt, "Silver Flask", "the base type is kept when it differs from the display name");
assert.equal(stash.did, "cinderswallow-urn-life");
assert.equal(stash.sid, 8812);
assert.equal(stash.lc, 18);
assert.equal(stash.cor, 1, "corruption is a different item, not a footnote");
assert.equal(stash.lk, 6);
assert.equal(stash.gl, 21);
assert.equal(stash.gq, 20);
assert.equal(evidenceFrom({ name: "Plain", chaosValue: 1 }), null, "a row with nothing to say adds no bytes");

assert.equal(isBaseVariant("SkillGem", { gemLevel: 1, gemQuality: 0 }), true);
assert.equal(isBaseVariant("SkillGem", { gemLevel: 21, gemQuality: 20, corrupted: true }), false,
  "a corrupted 21/20 is not the gem a boss hands over");
assert.equal(isBaseVariant("UniqueArmour", { links: 6 }), false);

/* ---- stash currency: both sides of the book ---- */
const currency = currencyEvidence(
  { detailsId: "divine-orb", pay: { value: 0.0049, count: 120 }, receive: { value: 205, count: 88 } },
  { id: 26, name: "Divine Orb", tradeId: "divine" },
);
assert.equal(currency.sid, 26, "currencyDetails carries the identity the lines do not");
assert.equal(currency.tid, "divine");
assert.equal(currency.did, "divine-orb");
assert.equal(currency.recv.v, 205, "the receive side is kept");
assert.equal(currency.recv.n, 88, "with the depth behind it");
assert.ok(currency.pay.v > 0, "and a sub-hundredth pay price is not rounded away to free");
assert.equal(currency.pay.n, 120);
assert.equal(currencyEvidence({}, null), null);

/* ---- GGG stock bounds and digest identity ---- */
const SCARAB = "Metadata/Items/Scarabs/TestScarab";
const gggMarkets = [{
  league: "Test",
  market_pair: [SCARAB, CHAOS_ID],
  volume_traded: { [SCARAB]: 10, [CHAOS_ID]: 180 },
  lowest_ratio: { [SCARAB]: 1, [CHAOS_ID]: 16 },
  highest_ratio: { [SCARAB]: 1, [CHAOS_ID]: 20 },
  lowest_stock: { [SCARAB]: 4, [CHAOS_ID]: 50 },
  highest_stock: { [SCARAB]: 900, [CHAOS_ID]: 4000 },
}];
const baseItems = {
  [SCARAB]: { name: "Test Scarab", item_class: "Scarab", tags: ["scarab", "default"] },
  [CHAOS_ID]: { name: "Chaos Orb", item_class: "StackableCurrency", tags: ["currency"] },
  [DIVINE_ID]: { name: "Divine Orb", item_class: "StackableCurrency", tags: ["currency"] },
};
const snapshot = buildGggLeagueSnapshot(gggMarkets, baseItems, "Test", { hour: 1787328000 });
const scarab = snapshot.prices["Test Scarab"];
assert.equal(scarab.c, 18, "the volume-weighted completed rate is unchanged by any of this");
assert.equal(scarab.lo, 16);
assert.equal(scarab.hi, 20);
assert.equal(scarab.lowStock, 4, "GGG publishes stock behind the market and it is now kept");
assert.equal(scarab.highStock, 900);
assert.equal(scarab.marketHour, "2026-08-21T16:00:00.000Z", "the exact digest hour travels with the entry");
assert.equal(scarab.gggId, SCARAB, "the Metadata path is the identity, not the display name");

/* ---- RePoE: shape is validated before it is trusted ---- */
assert.throws(() => validateBaseItems(null), /expected an object/);
assert.throws(() => validateBaseItems([]), /expected an object/);
assert.throws(() => validateBaseItems({}), /empty export/);
assert.throws(() => validateBaseItems({ NotAPath: { name: "x" }, AlsoNot: { name: "y" } }), /not Metadata paths/,
  "a restructured dictionary must not be consumed — every display name comes from it");
assert.throws(() => validateBaseItems({ "Metadata/A": {}, "Metadata/B": {}, "Metadata/C": { name: "c" } }), /no display name/);
const shape = validateBaseItems(baseItems);
assert.equal(shape.entries, 3);
assert.equal(shape.named, 3);
assert.ok(shape.warnings.length, "a dictionary far below a full export says so instead of passing silently");

/* ---- RePoE: match confidence and coverage are reported ---- */
const { enrichFromRepoe } = await import("../../poe1/enrich.mjs");
const twins = {
  "Metadata/Items/TwinA": { name: "Twin", item_class: "Ring", tags: ["ring"] },
  "Metadata/Items/TwinB": { name: "Twin", item_class: "Amulet", tags: ["amulet"] },
  ...baseItems,
};
const items = [
  { name: "Test Scarab", gggId: SCARAB, chaosValue: 18 },
  { name: "Chaos Orb", chaosValue: 1 },
  { name: "Twin", chaosValue: 5 },
  { name: "Nothing Knows This", chaosValue: 2 },
];
const coverage = enrichFromRepoe(items, twins, nameIndex(twins));
assert.equal(coverage.total, 4);
assert.equal(coverage.byPath, 1, "a Metadata path is the strong match");
assert.equal(coverage.byName, 1, "a unique display name is the weaker one");
assert.equal(coverage.ambiguous, 1, "a name two paths answer to is evidence about the dictionary, not the item");
assert.equal(coverage.unmatched, 1);
assert.deepEqual(coverage.ambiguousNames, ["Twin"]);
assert.deepEqual(coverage.unmatchedNames, ["Nothing Knows This"]);
assert.equal(items[0].identity, "metadata-path");
assert.equal(items[0].itemClass, "Scarab", "path matches enrich");
assert.equal(items[1].identity, "name");
assert.equal(items[2].identity, "name-ambiguous");
assert.equal(items[2].itemClass, undefined, "an ambiguous match enriches nothing — a wrong class is worse than none");

const scoreNow = Date.now();
assert.ok(
  poe1QuoteScore({ c: 20, daily: 100000, asOf: new Date(scoreNow - 3600e3).toISOString() }, "watch", scoreNow)
    > poe1QuoteScore({ c: 21, volume1H: 1, marketHour: new Date(scoreNow - 72 * 3600e3).toISOString() }, "ggg", scoreNow),
  "fresh liquid evidence can beat a stale official observation",
);
assert.equal(poe1StateCompatible({ cor: false, gl: 20 }, { cor: true, gl: 20 }), false,
  "different item states cannot replace each other");

/* ---- endpoint registry ---- */
assert.ok(EXCHANGE_TYPES.includes("Currency") && EXCHANGE_TYPES.includes("Scarab"));
assert.ok(STASH_ITEM_TYPES.includes("SkillGem"));
assert.ok(!EXCHANGE_TYPES.includes("BaseType") && !STASH_ITEM_TYPES.includes("BaseType"),
  "BaseType is ~18k rows nothing prices and must stay off");
assert.ok(OMITTED.length, "the documented types we skip are recorded, not merely absent");
assert.ok(OMITTED.every((entry) => entry.reason), "and each one says why");
assert.ok(DOCUMENTED.filter((entry) => entry.enabled).every((entry) => entry.consumer),
  "an enabled type names the feature that would break without it");
assert.ok(DOCUMENTED.every((entry) => FAMILIES[entry.family]), "every type names a documented endpoint family");
for (const type of CROSS_CHECK) {
  assert.ok(DOCUMENTED.some((entry) => entry.type === type), `${type} is cross-checked, so it must be a documented type`);
}
const exchangeSet = new Set(EXCHANGE_TYPES);
assert.equal(exchangeSet.size, EXCHANGE_TYPES.length, "no type is requested twice per run");

console.log("PoE 1 source evidence passed.");
