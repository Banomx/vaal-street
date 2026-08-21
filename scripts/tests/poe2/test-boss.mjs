import assert from "node:assert/strict";
import { BOSSES, bossDropKey, estimatedDrops } from "../../../src/games/poe2/features/bosses/bossData.js";
import { computeBoss, computeBosses, fmtPrice, makePriceResolver, sanitizeSettings, summarizePriceCoverage } from "../../../src/games/poe2/features/bosses/bossProfit.js";

assert.equal(new Set(BOSSES.map((boss) => boss.id)).size, BOSSES.length, "boss ids must be unique");
assert.ok(BOSSES.some((boss) => boss.group === "Anomaly"), "anomaly maps are included");
assert.ok(estimatedDrops().length > 0, "unknown rates are reviewable estimates");
assert.ok(estimatedDrops().every(({ line }) => line.note), "every estimate explains its basis");

const bodach = BOSSES.find((boss) => boss.id === "the-bodach");
assert.deepEqual(bodach.groupTags, ["Ritual"], "The Bodach keeps Ritual as a secondary group");
assert.ok(BOSSES.find((boss) => boss.id === "arbiter-of-divinity").groupTags.includes("Atlas"));
assert.ok(BOSSES.find((boss) => boss.id === "raven-trickster").groupTags.includes("Delirium"));
const uberArbiter = BOSSES.find((boss) => boss.id === "uber-arbiter-of-ash");
assert.equal(uberArbiter.name, "Uber The Arbiter of Ash");
assert.deepEqual(uberArbiter.entry.map((line) => line.item), [
  "Faded Crisis Fragment", "Ancient Crisis Fragment", "Weathered Crisis Fragment",
], "Uber Arbiter uses the three distinct Crisis fragments");

const uhtredRune = BOSSES.find((boss) => boss.id === "uhtred").groups.flatMap((group) => group.drops)
  .find((line) => line.item === "Depleted Mana Rune");
assert.equal(makePriceResolver({ "Runeseeker's Call": { exalted: 1200 } })(uhtredRune).exalted, 1200,
  "Depleted Mana Rune is valued through its Runeseeker's Call conversion");
const aberration = BOSSES.find((boss) => boss.id === "aberration");
assert.deepEqual(aberration.groups.find((group) => group.id === "runes").drops.map((line) => line.item), [
  "Emergent Instinct", "Emergent Protection", "Emergent Vigour", "Emergent Possibility",
], "The Aberration's runes have their own drop table");
assert.deepEqual(aberration.groups.find((group) => group.id === "lineage").drops.map((line) => line.item), [
  "Olroth's Conviction", "Olroth's Hubris",
], "The Aberration keeps actual Lineage Supports separate from runes");
assert.ok(BOSSES.every((boss) => boss.groups.every((group) => !/^Additional/.test(group.label))),
  "independent drop tables use their real item-family labels");

const megalomaniacs = BOSSES.find((boss) => boss.id === "simulacrum").groups.flatMap((group) => group.drops)
  .filter((line) => line.item === "Megalomaniac");
assert.equal(megalomaniacs.length, 2);
assert.ok(megalomaniacs.every((line) => line.gamble), "both Megalomaniac variants are marked as gambles");
assert.ok(megalomaniacs.every((line) => makePriceResolver({ Megalomaniac: { exalted: 2 } })(line).exalted === 2),
  "Megalomaniac variants use the normal market quote as a conservative floor");

const retiredOmens = [
  "Omen of Corruption", "Omen of Dextral Alchemy", "Omen of Dextral Coronation",
  "Omen of Greater Annulment", "Omen of Sinistral Alchemy", "Omen of Sinistral Coronation",
];
const currentOmens = BOSSES.find((boss) => boss.id === "king-in-mists").groups.find((group) => group.id === "omen").drops;
assert.ok(retiredOmens.every((name) => !currentOmens.some((line) => line.item === name)), "0.5-removed Omens stay out of King in the Mists EV");
assert.ok(!BOSSES.find((boss) => boss.id === "atziri").groups.flatMap((group) => group.drops)
  .some((line) => line.item === "Sacrificial Regalia"), "Atziri's rare Sacrificial Regalia is not assigned a market EV");
const prices = Object.fromEntries([...(bodach.entry || []), ...bodach.groups.flatMap((group) => group.drops)]
  .map((line, index) => [line.item, { exalted: index + 1 }]));
const computed = computeBoss(bodach, makePriceResolver(prices));
const coverage = summarizePriceCoverage([computed]);
assert.equal(coverage.missing.length, 0, "coverage sees every priced Bodach drop");
assert.equal(coverage.priced, coverage.total, "coverage reports a complete configured market set");
const mainPool = computed.groups.find((group) => group.id === "unique");
assert.ok(Math.abs(mainPool.lines.reduce((sum, line) => sum + line.chance, 0) - 1) < 1e-9, "rounded guaranteed pools normalize to one drop");
assert.equal(computed.groups.find((group) => group.id === "lineage").lines[0].chance, .05, "independent rates are not normalized");

const estimate = estimatedDrops()[0];
const key = bossDropKey(estimate.boss.id, estimate.group.id, estimate.line);
const before = computeBosses(BOSSES, { [estimate.line.item]: { exalted: 100 } }, {})
  .find((row) => row.boss.id === estimate.boss.id).gross;
const after = computeBosses(BOSSES, { [estimate.line.item]: { exalted: 100 } }, { rateOverrides: { [key]: estimate.line.rate * 2 } })
  .find((row) => row.boss.id === estimate.boss.id).gross;
assert.notEqual(before, after, "editable estimated rates affect EV");

assert.equal(makePriceResolver({ "Morrigan's Insight": { exalted: 12 } })("Mórrigan's Insight").exalted, 12, "accent-insensitive price matching works");
assert.equal(sanitizeSettings({ rateOverrides: { a: -1, b: 20, c: .4 } }).rateOverrides.b, 10, "rate overrides are bounded");
assert.match(fmtPrice(500, "smart", 250), /div/, "smart display switches large values to Divine");
assert.equal(fmtPrice(100, "chaos", 250, 20), "5.00 chaos", "fixed Chaos display converts from Exalted");

const timedSettings = sanitizeSettings({
  ttkProfiles: [{ id: "mine", name: "My pace", times: { "the-bodach": 120, junk: -3 } }],
  activeTtkProfileId: "mine",
});
const timed = computeBosses(BOSSES, prices, timedSettings).find((row) => row.boss.id === "the-bodach");
assert.equal(timed.ttkSeconds, 120);
assert.ok(Math.abs(timed.profitPerHour - timed.net * 30) < 1e-9, "custom TTK unlocks profit/hour without a default time");
const untimed = computeBosses(BOSSES, prices, {}).find((row) => row.boss.id === "the-bodach");
assert.equal(untimed.profitPerHour, null, "no profile means no assumed profit/hour");
assert.deepEqual(timedSettings.ttkProfiles[0].times, { "the-bodach": 120 }, "invalid custom times are removed");

console.log(`PoE 2 boss model: ${BOSSES.length} encounters, ${estimatedDrops().length} reviewable rates.`);
