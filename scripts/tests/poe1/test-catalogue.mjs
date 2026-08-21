import assert from "node:assert/strict";
import {
  SUSPECT_MIN_SCORE, applyRenames, breakingNames, describeDiff, diffCatalogue, isQuiet,
  similarity, stableId,
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

/* ---- stable ids ---- */
assert.equal(stableId({ id: 42 }), 42);
assert.equal(stableId({ id: "42" }), 42);
assert.equal(stableId({ id: "ritual-scarab-of-wisps" }), null, "a name-derived slug carries no continuity");
assert.equal(stableId({}), null);

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
assert.deepEqual(renamed.renamed, [{ from: "Turbulent Catalyst", to: "Storm Catalyst", id: 7 }]);
assert.deepEqual(renamed.added, []);
assert.deepEqual(renamed.removed, []);
assert.deepEqual(renamed.suspected, [], "an id-confirmed rename is not also reported as a guess");
assert.equal(renamed.count, 2);

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
