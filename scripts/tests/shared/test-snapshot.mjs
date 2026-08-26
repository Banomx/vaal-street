import assert from "node:assert/strict";
import {
  CORRUPT, INCOMPATIBLE, MISSING, OFFLINE, READY,
  checkDocument, describeAge, freshness, isUsable, leagueFile, leagueFileUrl,
  loadDocument, qualityNotes, readJson, summarize, worstLevel, worstState,
} from "../../../src/shared/data/snapshot.js";
import { allowsDemo, allowsLiveApi, resolveDataMode } from "../../../src/shared/data/dataMode.js";
import { QualityReport } from "../../shared/dataset.mjs";

/* A stand-in for the browser's fetch: every route is one of the failure modes
   the reader has to be able to tell apart. */
function stubFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (route === "throw") throw new Error("network down");
    if (route === "unparseable") return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } };
    if (typeof route === "number") return { ok: false, status: route, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => route };
  };
}

/* ---- document contract ---- */
assert.equal(checkDocument(null).state, MISSING);
assert.equal(checkDocument([1, 2]).state, CORRUPT, "an array is not a snapshot document");
assert.equal(checkDocument("nope").state, CORRUPT);
assert.equal(checkDocument({ schemaVersion: 1, prices: {} }, { supported: [1], required: ["prices"] }).state, READY);
assert.equal(checkDocument({ schemaVersion: 2 }, { supported: [1] }).state, INCOMPATIBLE,
  "a newer schema is refused rather than read on a guess");
assert.equal(checkDocument({ schemaVersion: 1 }, { supported: [1], required: ["prices"] }).state, CORRUPT,
  "a required field that is absent makes the document unusable");

/* A file written before versioning is readable but flagged, so the page can
   say the data predates the contract instead of implying it was checked. */
const legacy = checkDocument({ generatedAt: "2026-08-21T00:00:00Z" }, { supported: [1] });
assert.equal(legacy.state, READY);
assert.equal(legacy.legacy, true);
assert.equal(checkDocument({}, { supported: [1], allowLegacy: false }).state, INCOMPATIBLE);

/* Derived history files are bare maps with nowhere to put an envelope. They
   must not be reported as legacy forever. */
const bare = checkDocument({ "Some Scarab": [{ day: 0, value: 3 }] }, { versioned: false });
assert.equal(bare.state, READY);
assert.equal(bare.legacy, undefined);

/* ---- transport failure modes stay distinguishable ---- */
const routes = {
  "/ok.json": { schemaVersion: 1, prices: { "Chaos Orb": { c: 1 } } },
  "/future.json": { schemaVersion: 99 },
  "/garbage.json": "unparseable",
  "/down.json": "throw",
  "/error.json": 500,
};
const fetchImpl = stubFetch(routes);

assert.equal((await readJson("/ok.json", { fetchImpl })).state, READY);
assert.equal((await readJson("/nothing.json", { fetchImpl })).state, MISSING, "404 is 'never generated'");
assert.equal((await readJson("/down.json", { fetchImpl })).state, OFFLINE, "a failed request is not an empty dataset");
assert.equal((await readJson("/error.json", { fetchImpl })).state, OFFLINE);
assert.equal((await readJson("/garbage.json", { fetchImpl })).state, CORRUPT,
  "a 200 that will not parse is a broken deployment, not missing data");

const good = await loadDocument("/ok.json", { supported: [1], required: ["prices"], fetchImpl });
assert.ok(isUsable(good));
assert.equal(good.data.prices["Chaos Orb"].c, 1);

const wrongVersion = await loadDocument("/future.json", { supported: [1], fetchImpl });
assert.equal(wrongVersion.state, INCOMPATIBLE);
assert.equal(wrongVersion.data, undefined, "an incompatible document never reaches the caller's render path");
assert.ok(!isUsable(wrongVersion));

assert.equal((await loadDocument(null, { fetchImpl })).state, MISSING, "a file the index does not name is missing, not fetched");

/* ---- the index files map ---- */
const league = { name: "Allflame", slug: "Allflame", files: { prices: "prices.json", scarabs: "scarabs.json" } };
assert.equal(leagueFile(league, "prices", {}), "prices.json");
assert.equal(leagueFile(league, "gems", { gems: "gems.json" }), "gems.json", "defaults cover an index written before the map");
assert.equal(leagueFile({ slug: "x" }, "gems", {}), null);
assert.equal(leagueFileUrl("/data/poe1", league, "scarabs", {}), "/data/poe1/Allflame/scarabs.json");
assert.equal(leagueFileUrl("/data/poe1", { name: "Runes of Aldur", slug: "runes-of-aldur" }, "prices", { prices: "prices.json" }),
  "/data/poe1/runes-of-aldur/prices.json");
assert.equal(leagueFileUrl("/data/poe1", league, "nothing", {}), null);

/* ---- freshness ---- */
const now = Date.parse("2026-08-21T12:00:00Z");
assert.equal(freshness("2026-08-21T11:30:00Z", { now }).level, "fresh");
assert.equal(freshness("2026-08-21T04:00:00Z", { now }).level, "stale");
assert.equal(freshness("2026-08-19T04:00:00Z", { now }).level, "dead");
assert.equal(freshness("2026-08-22T12:00:00Z", { now }).level, "future", "a future stamp is a clock fault, not fresh data");
assert.equal(freshness(undefined, { now }).level, "unknown");
assert.equal(describeAge(0.5), "in the last hour");
assert.equal(describeAge(72), "3 days ago");

/* ---- ordering ---- */
assert.equal(worstState([READY, MISSING, INCOMPATIBLE, OFFLINE]), INCOMPATIBLE);
assert.equal(worstState([READY, READY]), READY);
assert.equal(worstLevel(["ok", "notice", "warning"]), "warning");

/* ---- quality report passthrough ----
   Built from a real QualityReport, not a hand-written object: the browser
   reading a field the generator does not write fails silently — the banner
   just never mentions a degraded run — and that is exactly what happened
   before this test existed. */
const report = new QualityReport({ game: "poe1" });
report.pass("curated-coverage", "40/40 curated names priced");
report.fail("price-collapse", "priced names fell from 900 to 4");
report.degrade("stale-leagues", "1 of 3 league(s) are stale");
report.warn("thin-history", "fine");
const published = JSON.parse(JSON.stringify(report.toJSON()));
assert.equal(published.state, "failure");
assert.equal(published.counts.failure, 1);
const notes = qualityNotes(published);
assert.equal(notes.length, 3, "the banner names failures, degradations and notable warnings");
assert.equal(notes[0].level, "error");
assert.ok(/price-collapse/.test(notes[0].text), "the check code reaches the reader");
assert.equal(notes[1].level, "warning");
assert.ok(/stale-leagues/.test(notes[1].text));
assert.equal(notes[2].level, "notice");
assert.ok(/fine/.test(notes[2].text), "a warning is explained instead of reduced to an opaque count");
assert.deepEqual(qualityNotes(null), []);

/* ---- the whole verdict ---- */
const clean = summarize({
  documents: { "Prices for this league": good, "Stored price history": { state: MISSING } },
  required: ["Prices for this league"],
  generatedAt: "2026-08-21T11:30:00Z",
  now,
});
assert.equal(clean.state, READY);
assert.equal(clean.level, "notice", "an absent history is said out loud, but it is not an error");
assert.ok(clean.notes.some((note) => /has not been generated yet/.test(note.text)));
assert.equal(clean.usable, true);

const broken = summarize({
  documents: { "Prices for this league": wrongVersion },
  required: ["Prices for this league"],
  generatedAt: "2026-08-21T11:30:00Z",
  now,
});
assert.equal(broken.state, INCOMPATIBLE);
assert.equal(broken.level, "error");
assert.equal(broken.usable, false, "an unreadable price file must not be presented as a market");

const old = summarize({
  documents: { "Prices for this league": good },
  required: ["Prices for this league"],
  generatedAt: "2026-08-20T00:00:00Z",
  now,
});
assert.equal(old.state, READY);
assert.ok(old.notes.some((note) => /last updated/.test(note.text)), "a stale snapshot always says so");

/* An aborted request is a league the reader already left, not a failure to
   report at them. */
const aborted = summarize({
  documents: { "Prices for this league": { state: OFFLINE, aborted: true } },
  required: ["Prices for this league"],
  generatedAt: "2026-08-21T11:30:00Z",
  now,
});
assert.equal(aborted.state, READY);
assert.equal(aborted.notes.length, 0);

/* ---- data mode ----
   The rule that keeps a published page off somebody else's API and keeps
   sample data from ever standing in for a market. */
assert.equal(resolveDataMode("", { dev: false }), "static", "a production build reads snapshots and nothing else");
assert.equal(resolveDataMode("", { dev: true }), "auto");
assert.equal(resolveDataMode("?data=demo", { dev: false }), "demo", "demo is reachable, but only on request");
assert.equal(resolveDataMode("?data=LIVE", { dev: false }), "live");
assert.equal(resolveDataMode("?data=nonsense", { dev: false }), "static", "an unknown mode falls back to the safe one");
assert.equal(allowsLiveApi("static"), false, "production never calls the legacy poe.ninja endpoints");
assert.equal(allowsDemo("static"), false, "production never substitutes sample data for a failed load");
assert.equal(allowsLiveApi("auto"), true);
assert.equal(allowsDemo("demo"), true);

console.log("Snapshot contract tests passed.");
