import assert from "node:assert/strict";
import { initialSpotlights, promoteSpotlight, reconcileSpotlights } from "../../../src/shared/ui/spotlightRotation.js";

const ids = ["boss", "gems", "farms", "market", "delve", "watcher"];
let state = initialSpotlights(ids);
assert.deepEqual(state.shown, ids.slice(0, 3));
state = { ...state, pinned: ["boss"], selected: { boss: "second" } };
for (let i = 0; i < 15; i++) {
  const before = state;
  state = promoteSpotlight(state);
  assert.equal(state.shown[0], "boss", "automatic rotation preserves pinned panels");
  assert.equal(state.shown.filter((id, slot) => id !== before.shown[slot]).length, 1, "only one panel changes per tick");
  assert.equal(new Set([...state.shown, ...state.queue]).size, ids.length, "no category is lost or duplicated");
  assert.equal(state.selected.boss, "second", "inspection selection survives rotation");
}
state = { ...state, pinned: [...state.shown] };
assert.equal(promoteSpotlight(state), state, "all pins stop automatic and manual promotion");
const reconciled = reconcileSpotlights(state, ["boss", "new", "market"]);
assert.deepEqual(new Set([...reconciled.shown, ...reconciled.queue]), new Set(["boss", "new", "market"]));
assert(reconciled.pinned.every((id) => reconciled.shown.includes(id)), "removed categories do not leave stale pins");
assert.deepEqual(initialSpotlights(["a", "a", "b"]).shown, ["a", "b"]);
assert.deepEqual(promoteSpotlight(initialSpotlights([])).shown, []);
console.log("Spotlight rotation checks passed");
