import assert from "node:assert/strict";
import {
  SUSPECT_MIN_SCORE, applyRenames, breakingNames, describeDiff, diffCatalogue, isQuiet,
  identityKind, similarity, stableId,
} from "../../../src/games/poe1/catalogue/catalogue.js";
import { CATEGORIES, CATEGORY_BY_KEY, FETCHED_CATEGORIES, TAB_CATEGORIES } from "../../../src/games/poe1/catalogue/categories.js";
import { CURRENT_SCARABS, GROUPS, groupForName, isCurrentScarab } from "../../../src/games/poe1/catalogue/scarabs.js";

/* ---- category catalogue ---- */
assert.ok(CATEGORIES.length >= 5);
for (const cat of CATEGORIES) {
  assert.ok(cat.key && cat.label && cat.file, `${cat.key} is fully described`);
  assert.ok(cat.re instanceof RegExp, `${cat.key} matches names by regex, not by a name list`);
  assert.ok(Array.isArray(cat.watch) && cat.watch.length, `${cat.key} narrows poe.watch categories`);
  assert.ok(cat.re.test(`Some ${cat.label.replace(/s$/, "")}`), `${cat.key} regex matches its own family`);
}
assert.equal(new Set(CATEGORIES.map((c) => c.key)).size, CATEGORIES.length, "category keys are unique");
assert.equal(CATEGORY_BY_KEY.catalysts.ninjaType, "Currency");
assert.ok(!FETCHED_CATEGORIES.some((c) => c.key === "scarabs"), "scarabs keep their own fetch path");
assert.deepEqual(Object.keys(TAB_CATEGORIES), ["astrolabes", "catalysts"]);
assert.ok(TAB_CATEGORIES.catalysts.re.test("Turbulent Catalyst"));

/* ---- scarab catalogue ----
   Checked against poedb's Scarab item class, which is generated from the game
   files. The count is asserted because both failures are silent: a retired
   scarab left in makes a mechanic look bigger than the set you can farm, and
   one GGG adds that is missing here reads as legacy and gets filtered out of
   the tab. */
const scarabNames = Object.values(GROUPS).flat();
assert.equal(scarabNames.length, 118, "poedb lists 118 droppable scarabs");
assert.equal(new Set(scarabNames).size, scarabNames.length, "no scarab is listed under two mechanics");
assert.equal(CURRENT_SCARABS.size, 118);
for (const [group, names] of Object.entries(GROUPS)) {
  assert.ok(names.length, `${group} has members`);
  for (const name of names) assert.equal(groupForName(name), group, `${name} maps back to ${group}`);
}

/* The retired Breach set is what the feeds actually serve alongside the live
   one — nine rows under one mechanic, four of which nobody can farm. */
assert.equal(GROUPS.Breach.length, 5);
for (const gone of ["Breach Scarab", "Breach Scarab of Splintering", "Breach Scarab of Lordship",
                    "Breach Scarab of Snares", "Breach Scarab of the Dreamer"]) {
  assert.equal(isCurrentScarab(gone), false, `${gone} no longer drops`);
  assert.equal(groupForName(gone), "Breach", "but it still belongs to Breach when a snapshot prices it");
}
// Other reworks the same rule covers, without anyone listing them by hand.
assert.equal(isCurrentScarab("Abyss Scarab of Edifice"), false, "3.29 replaced it with 'of Crystals'");
assert.equal(isCurrentScarab("Abyss Scarab of the Consort"), true);
assert.equal(isCurrentScarab("Legion Scarab of The Sekhema"), false);
assert.equal(isCurrentScarab("Trarthan Scarab of Renown"), true);

// Anything new keeps grouping itself without a code change.
assert.equal(groupForName("Trarthan Scarab of Renown"), "Trarthan");
assert.equal(groupForName("Whatever Scarab of Tomorrow"), "Whatever");
assert.equal(groupForName("Scarab of Evolution"), "Universal", "a bare 'Scarab of' is never a mechanic");
assert.equal(groupForName("Influencing Scarab of Hordes"), "Influence");
assert.equal(groupForName("Horned Scarab of Glittering"), "Horned");

/* ---- stable ids ----

   A Metadata path is the game's own identity and outranks everything: GGG
   renaming an item does not change it, and it is the same string across leagues
   and across sources. A numeric id is real continuity too, but only within the
   source that assigned it, so the scope is part of the key. */
assert.equal(stableId({ id: 42 }), "source:42");
assert.equal(stableId({ id: "42" }), "source:42");
assert.equal(stableId({ id: 42 }, { source: "watch" }), "watch:42",
  "the same number from two feeds is two different items");
assert.equal(stableId({ gggId: "Metadata/Items/Currency/CurrencyRerollRare" }), "metadata:Metadata/Items/Currency/CurrencyRerollRare");
assert.equal(stableId({ metadataPath: "Metadata/Items/Scarabs/Abyss" }), "metadata:Metadata/Items/Scarabs/Abyss");
assert.equal(stableId({ id: "Metadata/Items/Scarabs/Abyss" }), "metadata:Metadata/Items/Scarabs/Abyss");
assert.equal(stableId({ gggId: "Metadata/Items/Scarabs/Abyss", id: 42 }), "metadata:Metadata/Items/Scarabs/Abyss",
  "the Metadata path wins when both are present");
assert.equal(stableId({ id: "ritual-scarab-of-wisps" }), null, "a name-derived slug carries no continuity");
assert.equal(stableId({}), null);
assert.equal(identityKind(stableId({ gggId: "Metadata/Items/X" })), "metadata");
assert.equal(identityKind(stableId({ id: 3 })), "source");
assert.equal(stableId({ metadataPath: "Metadata/Items/X", identity: "name" }), null,
  "a path recovered by matching display names is the display name again — it cannot confirm a rename");
assert.equal(stableId({ metadataPath: "Metadata/Items/X", identity: "name-ambiguous" }), null);
assert.equal(stableId({ gggId: "Metadata/Items/X", identity: "name" }), "metadata:Metadata/Items/X",
  "but a path the source itself stated still counts");

/* ---- similarity ---- */
assert.equal(similarity("Tangled Fossil", "Tangled Fossil"), 1);
assert.ok(similarity("Ritual Scarab of Wisps", "Ritual Scarab of Abundance") > 0.5,
  "siblings score high, which is exactly why similarity may not auto-apply");
assert.equal(similarity("Tangled Fossil", ""), 0);

/* ---- the safe case: an id says the name moved ---- */
const renamed = diffCatalogue(
  [{ id: 7, name: "Turbulent Catalyst" }, { id: 8, name: "Imbued Catalyst" }],
  [{ id: 7, name: "Storm Catalyst" }, { id: 8, name: "Imbued Catalyst" }],
);
assert.deepEqual(renamed.renamed, [{ from: "Turbulent Catalyst", to: "Storm Catalyst", id: "source:7", identity: "source" }]);
assert.deepEqual(renamed.added, []);
assert.deepEqual(renamed.removed, []);
assert.deepEqual(renamed.suspected, [], "an id-confirmed rename is not also reported as a guess");
assert.equal(renamed.count, 2);

/* ---- a Metadata path confirms a rename the same way, and more strongly ----

   This is the case GGG actually produces: the display name changes, the
   Metadata path does not, and the item's accumulated curve should follow it. */
const metadataRenamed = diffCatalogue(
  [{ gggId: "Metadata/Items/Scarabs/Storm", name: "Turbulent Catalyst" }],
  [{ gggId: "Metadata/Items/Scarabs/Storm", name: "Storm Catalyst" }],
);
assert.deepEqual(metadataRenamed.renamed, [{
  from: "Turbulent Catalyst", to: "Storm Catalyst",
  id: "metadata:Metadata/Items/Scarabs/Storm", identity: "metadata",
}], "a Metadata path is continuity evidence and is acted on");
assert.deepEqual(metadataRenamed.suspected, []);

/* ---- an identity two current names answer to is never a rename ---- */
const collided = diffCatalogue(
  [{ gggId: "Metadata/Items/Scarabs/Storm", name: "Turbulent Catalyst" }],
  [
    { gggId: "Metadata/Items/Scarabs/Storm", name: "Storm Catalyst" },
    { gggId: "Metadata/Items/Scarabs/Storm", name: "Gale Catalyst" },
  ],
);
assert.deepEqual(collided.renamed, [], "an ambiguous identity must not move a history key");
assert.equal(collided.collisions.length, 1, "it is reported instead");
assert.deepEqual(collided.collisions[0].to, ["Gale Catalyst", "Storm Catalyst"]);
assert.equal(isQuiet(collided), false, "and a collision is never a quiet run");

/* ---- two current items under one display name ---- */
const duplicated = diffCatalogue(
  [{ id: 1, name: "Tangled Fossil" }],
  [{ id: 1, name: "Tangled Fossil" }, { id: 2, name: "Tangled Fossil" }],
);
assert.deepEqual(duplicated.duplicateNames, ["Tangled Fossil"],
  "history is keyed by name, so two items under one name would merge into one series");
assert.equal(isQuiet(duplicated), false);
assert.match(describeDiff("fossils", duplicated), /duplicate display name/);

/* ---- the unsafe case: no id, so it stays a suggestion ---- */
const guessed = diffCatalogue(
  [{ id: "turbulent-catalyst", name: "Turbulent Catalyst" }],
  [{ id: "storm-catalyst", name: "Storm Catalyst" }],
);
assert.deepEqual(guessed.renamed, [], "slug ids never confirm a rename");
assert.equal(guessed.suspected.length, 1);
assert.equal(guessed.suspected[0].from, "Turbulent Catalyst");
assert.equal(guessed.suspected[0].to, "Storm Catalyst");
assert.ok(guessed.suspected[0].score >= SUSPECT_MIN_SCORE);
assert.deepEqual(guessed.added, [], "a suspected rename is not double-counted as an addition");
assert.deepEqual(guessed.removed, []);

/* ---- a genuinely new item is just new ---- */
const grown = diffCatalogue(
  [{ id: 1, name: "Intrinsic Catalyst" }],
  [{ id: 1, name: "Intrinsic Catalyst" }, { id: 2, name: "Unstable Catalyst" }],
);
assert.deepEqual(grown.added, ["Unstable Catalyst"]);
assert.deepEqual(grown.removed, []);
assert.deepEqual(grown.suspected, []);

/* One retired sibling plus one new sibling must not pair one-to-one across a
   whole family: greedy pairing is one-to-one, so a second retirement cannot
   reuse a name already claimed. */
const siblings = diffCatalogue(
  [{ name: "Ritual Scarab of Wisps" }, { name: "Ritual Scarab of Corpses" }],
  [{ name: "Ritual Scarab of Abundance" }],
);
assert.equal(siblings.suspected.length, 1);
assert.equal(siblings.removed.length, 1);
assert.ok(!siblings.suspected.some((p) => p.to !== "Ritual Scarab of Abundance"));

/* ---- first run has nothing to compare against ---- */
const first = diffCatalogue([], [{ id: 1, name: "Intrinsic Catalyst" }]);
assert.deepEqual(first.added, ["Intrinsic Catalyst"]);
assert.equal(isQuiet(first), false);
assert.equal(isQuiet(diffCatalogue([{ id: 1, name: "A" }], [{ id: 1, name: "A" }])), true);

/* ---- only curated references actually break ---- */
const curated = new Set(["Turbulent Catalyst", "Tangled Fossil"]);
assert.deepEqual(breakingNames(renamed, curated), ["Turbulent Catalyst"]);
assert.deepEqual(breakingNames(grown, curated), [], "an addition breaks nothing");
assert.deepEqual(breakingNames(guessed, ["Nothing Relevant"]), []);

assert.match(describeDiff("catalysts", renamed), /renamed/);
assert.match(describeDiff("catalysts", diffCatalogue([{ id: 1, name: "A" }], [{ id: 1, name: "A" }])), /no catalogue change/);

/* ---- history survives an id-confirmed rename ---- */
const points = [
  { t: "1", values: { "Turbulent Catalyst": 10, "Imbued Catalyst": 4 } },
  { t: "2", values: { "Turbulent Catalyst": 12, "Imbued Catalyst": 4 } },
];
applyRenames(points, renamed.renamed);
assert.deepEqual(points[1].values, { "Storm Catalyst": 12, "Imbued Catalyst": 4 },
  "the old key is carried forward so change windows do not restart");
assert.equal(points[0].values["Turbulent Catalyst"], undefined);

// Real data for the surviving name is never overwritten by the old key.
const collision = [{ values: { Old: 1, New: 2 } }];
applyRenames(collision, [{ from: "Old", to: "New" }]);
assert.deepEqual(collision[0].values, { Old: 1, New: 2 });
assert.deepEqual(applyRenames(undefined, [{ from: "a", to: "b" }]), undefined);

console.log("Catalogue tests passed");

/* ---- classification: metadata before display names ----

   Scarabs already had a strong tag; every other family was matched on its
   display name alone, which is a label rather than an identity. The tier is
   reported so a family that has quietly fallen back to name matching is
   visible instead of looking exactly like a healthy one. */
const { classifyItem, classificationCoverage, CLASSIFICATION_EXCEPTIONS } = await import("../../../src/games/poe1/catalogue/classify.js");

assert.deepEqual(classifyItem({ name: "Abyss Scarab", tags: ["scarab", "default"] }, "scarabs"),
  { match: true, confidence: "metadata" });
assert.deepEqual(classifyItem({ name: "Some New Thing", tags: ["astrolabe"] }, "astrolabes"),
  { match: true, confidence: "metadata" },
  "an astrolabe GGG adds is classified from its tag, with no name rule and no code change");
assert.deepEqual(classifyItem({ name: "Prime Chaotic Resonator", itemClass: "DelveStackableSocketableCurrency" }, "resonators"),
  { match: true, confidence: "metadata" });
assert.deepEqual(classifyItem({ name: "Aberrant Fossil", tags: ["delve_fossil"] }, "fossils"),
  { match: true, confidence: "metadata" });
assert.deepEqual(classifyItem({ name: "Intrinsic Catalyst", tags: ["jewel_catalyst"] }, "catalysts"),
  { match: true, confidence: "metadata" });

assert.deepEqual(classifyItem({ name: "Turbulent Catalyst" }, "catalysts"), { match: true, confidence: "name" },
  "with no metadata at all the anchored name pattern still answers");
assert.deepEqual(classifyItem({ name: "Fossilised Spirit Shield" }, "fossils"), { match: false, confidence: null },
  "an anchored pattern refuses a unique that merely contains the word");
assert.deepEqual(classifyItem({ name: "Bottled Faith" }, "scarabs"), { match: false, confidence: null });

/* Metadata that positively identifies another family is an answer, not a
   fall-through: whatever the name ends in, GGG has already said what it is. */
assert.deepEqual(classifyItem({ name: "Something Resonator", tags: ["delve_fossil"] }, "resonators"),
  { match: false, confidence: "metadata" });

const coverage = classificationCoverage([
  { name: "Abyss Scarab", tags: ["scarab"] },
  { name: "Legion Scarab", tags: ["scarab"] },
  { name: "Mystery Scarab" },
  { name: "Bottled Faith" },
], "scarabs");
assert.equal(coverage.total, 3);
assert.equal(coverage.metadata, 2);
assert.equal(coverage.name, 1, "the name-only tier is counted, not hidden");
assert.deepEqual(coverage.nameOnly, ["Mystery Scarab"]);

assert.ok(CLASSIFICATION_EXCEPTIONS.every((entry) => entry.name && entry.key && entry.reason),
  "a reviewed exception states what it is and why it exists");

/* Every family the site renders must classify from metadata or an anchored
   name — never fall into nothing. This is the check that catches a category
   silently emptying after a GGG tag change. */
for (const category of CATEGORIES) {
  const probe = { name: `Test ${category.label.replace(/s$/, "")}`, tags: [] };
  const byName = classifyItem({ ...probe, name: category.key === "scarabs" ? "Test Scarab"
    : category.key === "astrolabes" ? "Test Astrolabe"
      : category.key === "catalysts" ? "Test Catalyst"
        : category.key === "fossils" ? "Test Fossil" : "Test Resonator" }, category.key);
  assert.equal(byName.match, true, `${category.key} must still resolve for a plainly named item`);
}

/* ---- history key migration ----

   Accumulated history is keyed by display name, so a rename has to be followed
   or the item restarts at one point. Every rule here exists because the
   alternative destroys the only copy of a curve. */
const { migrateHistoryKeys, unresolvedSeries } = await import("../../../src/games/poe1/catalogue/catalogue.js");

/* confirmed rename: the curve follows the item */
const confirmed = [
  { t: "2026-08-01T00:00:00.000Z", values: { "Turbulent Catalyst": 10 } },
  { t: "2026-08-02T00:00:00.000Z", values: { "Turbulent Catalyst": 12 } },
];
const movedReport = migrateHistoryKeys(confirmed, [{ from: "Turbulent Catalyst", to: "Storm Catalyst" }]);
assert.deepEqual(confirmed.map((point) => point.values), [{ "Storm Catalyst": 10 }, { "Storm Catalyst": 12 }]);
assert.deepEqual(movedReport.moved, ["Turbulent Catalyst -> Storm Catalyst"]);

/* the new name already holds data: that is a real observation for the name we
   are keeping, and a rename must not overwrite it */
const occupied = [{ t: "2026-08-01T00:00:00.000Z", values: { Old: 10, New: 99 } }];
const blockedReport = migrateHistoryKeys(occupied, [{ from: "Old", to: "New" }]);
assert.deepEqual(occupied[0].values, { Old: 10, New: 99 }, "an occupied key is left alone");
assert.deepEqual(blockedReport.blocked, ["Old -> New"], "and the refusal is reported");

/* two renames claiming one new name: neither can be trusted */
const contestedPoints = [{ t: "2026-08-01T00:00:00.000Z", values: { A: 1, B: 2 } }];
const contestedReport = migrateHistoryKeys(contestedPoints, [{ from: "A", to: "C" }, { from: "B", to: "C" }]);
assert.deepEqual(contestedPoints[0].values, { A: 1, B: 2 }, "an ambiguous target moves nothing");
assert.deepEqual(contestedReport.contested, ["C"]);
assert.deepEqual(contestedReport.moved, []);

/* a removed item keeps its series */
const removedPoints = [{ t: "2026-08-01T00:00:00.000Z", values: { "Breach Scarab of Snares": 4, "Abyss Scarab": 9 } }];
migrateHistoryKeys(removedPoints, []);
assert.equal(removedPoints[0].values["Breach Scarab of Snares"], 4, "a retired item's curve is never deleted");
assert.deepEqual(unresolvedSeries(removedPoints, ["Abyss Scarab"]), ["Breach Scarab of Snares"],
  "it is reported instead, because a name can come back");

/* a source id changing while the name stays put is not a rename at all */
const idChanged = diffCatalogue([{ id: 7, name: "Imbued Catalyst" }], [{ id: 9, name: "Imbued Catalyst" }]);
assert.deepEqual(idChanged.renamed, [], "the item is still there under the same name");
assert.deepEqual(idChanged.added, []);
assert.deepEqual(idChanged.removed, []);

console.log("Catalogue identity tests passed");
