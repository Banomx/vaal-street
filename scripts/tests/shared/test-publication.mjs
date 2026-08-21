/* Staging, promotion and the publication gates.

   The rule these protect is one the project learned the hard way: a run that
   cannot produce a good dataset must leave the previous one exactly as it was.
   Generating in place makes that impossible, because by the time the run knows
   it is bad it has already overwritten its own fallback.

   Run: node scripts/tests/shared/test-publication.mjs
*/

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  QualityReport, clearAbandonedStages, collapsed, contentHash, createStage,
  isNotFuture, orderedUnique, roundPrice, sourceRecord, writeJsonFile,
} from "../../shared/dataset.mjs";
import { validatePoe1 } from "../../poe1/validate.mjs";
import { validatePoe2 } from "../../poe2/validate.mjs";

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const write = (file, value) => writeJsonFile(file, value);

/* ---- rounding: a price must never become zero ---- */
assert.equal(roundPrice(0), null, "zero is not a price");
assert.equal(roundPrice(-1), null, "a negative number is not a price");
assert.equal(roundPrice(Number.NaN), null);
assert.equal(roundPrice(Infinity), null);
assert.equal(roundPrice(12.3456), 12.35);
assert.ok(roundPrice(0.001) > 0, "a Rogue's Marker at 0.001c stays priced instead of rounding to free");
assert.ok(roundPrice(1e-9) > 0, "even an absurdly cheap item keeps a positive quote");

/* ---- generic value checks ---- */
assert.equal(isNotFuture(ago(1)), true);
assert.equal(isNotFuture(new Date(NOW + 6 * 3600e3).toISOString()), false, "six hours ahead is not clock skew");
assert.deepEqual(orderedUnique([ago(3), ago(2), ago(1)]), []);
assert.equal(orderedUnique([ago(1), ago(3)]).length, 1, "an out-of-order timestamp is reported");
assert.equal(orderedUnique([ago(1), ago(1)]).length, 1, "a duplicate timestamp is reported");
assert.equal(collapsed(12, 4900), true, "4,900 names becoming 12 is a collapse");
assert.equal(collapsed(4700, 4900), false, "ordinary league churn is not");
assert.equal(collapsed(3, 4), false, "a tiny previous sample cannot trigger a collapse");
assert.equal(contentHash({ a: 1 }), contentHash({ a: 1 }), "the hash is stable for equal content");
assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));

/* ---- source provenance ---- */
const record = sourceRecord({
  id: "poe.ninja", endpointFamily: "exchange", requestedType: "Scarab",
  requestedAt: ago(0.1), observedAt: ago(2), rawRows: 130, accepted: 125, rejected: 5,
  rejectedReasons: { invalid_price: 5 }, ok: true, status: 200,
});
assert.equal(record.accepted, 125);
assert.equal(record.rejectedReasons.invalid_price, 5);
assert.ok(record.freshnessMinutes >= 119 && record.freshnessMinutes <= 121, "freshness is derived from the observation time");
assert.equal("etag" in record, false, "absent fields are dropped rather than published as null");

/* ---- quality report ---- */
const report = new QualityReport({ game: "poe1" });
report.pass("a", "fine");
assert.equal(report.state, "ok");
report.warn("b", "drifting");
assert.equal(report.state, "warning");
report.degrade("c", "incomplete");
assert.equal(report.state, "degraded");
assert.equal(report.publishable, true, "degraded still publishes");
report.fail("d", "broken");
assert.equal(report.state, "failure");
assert.equal(report.publishable, false, "a failure blocks publication");
const manifest = report.toJSON();
assert.equal(manifest.counts.ok, 1);
assert.equal(manifest.checks.every((check) => check.level !== "ok"), true, "the manifest carries what needs acting on");

/* ---- staging: a failed run leaves the published tree untouched ---- */
{
  const root = await mkdtemp(path.join(tmpdir(), "vs-stage-"));
  const final = path.join(root, "poe1");
  await write(path.join(final, "index.json"), { schemaVersion: 1, generatedAt: ago(2), leagues: [{ name: "Live", slug: "Live" }] });
  await write(path.join(final, "Live", "prices.json"), { generatedAt: ago(2), prices: { "Chaos Orb": { c: 1 } } });

  const stage = await createStage(final);
  assert.notEqual(stage.dir, final, "generation happens somewhere else entirely");
  assert.ok((await readdir(stage.dir)).includes("Live"),
    "staging is seeded from the live tree so carry-forward rules keep working");
  await write(path.join(stage.dir, "index.json"), { schemaVersion: 1, generatedAt: ago(0), leagues: [] });
  await stage.discard();

  const survived = JSON.parse(await readFile(path.join(final, "index.json"), "utf8"));
  assert.equal(survived.leagues.length, 1, "discarding staging leaves the published tree exactly as it was");
  assert.equal((await readdir(root)).length, 1, "and removes its own scratch directory");
}

/* ---- staging: promotion replaces the tree atomically ---- */
{
  const root = await mkdtemp(path.join(tmpdir(), "vs-stage-"));
  const final = path.join(root, "poe1");
  await write(path.join(final, "index.json"), { schemaVersion: 1, generatedAt: ago(2), leagues: [{ name: "Old", slug: "Old" }] });
  const stage = await createStage(final, { seed: false });
  await write(path.join(stage.dir, "index.json"), { schemaVersion: 1, generatedAt: ago(0), leagues: [{ name: "New", slug: "New" }] });
  await stage.promote();
  const promoted = JSON.parse(await readFile(path.join(final, "index.json"), "utf8"));
  assert.equal(promoted.leagues[0].name, "New");
  assert.deepEqual(await readdir(root), ["poe1"], "no staging or previous directory is left behind");
}

/* ---- abandoned staging directories are cleaned by the next run ---- */
{
  const root = await mkdtemp(path.join(tmpdir(), "vs-stage-"));
  const final = path.join(root, "poe1");
  await mkdir(final, { recursive: true });
  await mkdir(`${final}.staging-999-1`, { recursive: true });
  await mkdir(path.join(root, "unrelated"), { recursive: true });
  assert.equal(await clearAbandonedStages(final), 1);
  const left = (await readdir(root)).sort();
  assert.deepEqual(left, ["poe1", "unrelated"], "only this script's own leftovers are removed");
}

/* ---- PoE 1 gates ---- */
async function poe1Tree(mutate = () => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "vs-poe1-"));
  const tree = {
    index: { schemaVersion: 1, generatedAt: ago(0), leagues: [{ name: "Allflame", slug: "Allflame", group: "current" }] },
    prices: { schemaVersion: 1, generatedAt: ago(0), divineRate: 200, prices: { "Chaos Orb": { c: 1 }, Scarab: { c: 12.5 } } },
    scarabs: {
      schemaVersion: 1, generatedAt: ago(0), divineRate: 200, priceSource: "poe.ninja",
      historyAxis: "days since first snapshot", historyOrigin: ago(48),
      rateHistory: [{ day: 0, rate: 190 }, { day: 1, rate: 200 }], rateHistorySource: "self",
      items: [{ name: "Scarab", chaosValue: 12.5 }],
    },
    self: { schemaVersion: 1, points: [
      { t: ago(48), values: { Scarab: 11 }, rate: 190 },
      { t: ago(24), values: { Scarab: 12 }, rate: 195 },
      { t: ago(0), values: { Scarab: 12.5 }, rate: 200 },
    ] },
    history: { Scarab: [{ day: 0, value: 11 }, { day: 1, value: 12 }, { day: 2, value: 12.5 }] },
  };
  mutate(tree);
  await write(path.join(dir, "index.json"), tree.index);
  await write(path.join(dir, "Allflame", "prices.json"), tree.prices);
  await write(path.join(dir, "Allflame", "scarabs.json"), tree.scarabs);
  await write(path.join(dir, "Allflame", "scarabs-selfhistory.json"), tree.self);
  await write(path.join(dir, "Allflame", "scarabs-history.json"), tree.history);
  return dir;
}
const codes = (result) => result.checks.filter((check) => check.level !== "ok").map((check) => check.code);

assert.equal((await validatePoe1(await poe1Tree())).publishable, true, "a healthy tree publishes");

assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.prices.prices["Rogues Marker"] = { c: 0 }; })))
  .includes("price-not-positive"), "a zero price fails publication");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.prices.prices.Broken = { c: Number.NaN }; })))
  .includes("price-not-positive"), "NaN fails publication");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.scarabs.items.push({ name: "Scarab", chaosValue: 9 }); })))
  .includes("duplicate-item-key"), "a duplicate item key fails publication");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.prices.prices["Chaos Orb"] = { c: 7 }; })))
  .includes("chaos-self-check"), "Chaos Orb pricing itself at 7c means the calibration is inverted");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.scarabs.rateHistory = [{ day: 0, rate: 200 }]; })))
  .includes("rate-history-collapsed"),
  "three rate-bearing raw points beside a one-point rate line is the derived-rebuild bug");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.index.schemaVersion = 99; })))
  .includes("schema-version"), "an unsupported schema version fails rather than being guessed at");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.self.points[0].t = new Date(NOW + 9 * 3600e3).toISOString(); })))
  .includes("history-future") , "an impossible future sample fails publication");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.index.leagues.push({ name: "Ghost", slug: "Ghost" }); })))
  .includes("league-files-missing"), "an index entry with no files on disk fails publication");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.index.leagues[0].stale = true; })))
  .includes("all-stale"), "a run where every league is stale must not pass as fresh");
assert.ok(codes(await validatePoe1(await poe1Tree((t) => { t.prices.prices.Carried = { c: 5, staleHours: 400 }; })))
  .includes("stale-carry"), "carried official prices cannot outlive their age limit");

{
  const previous = await poe1Tree((t) => {
    for (let index = 0; index < 60; index += 1) t.prices.prices[`Item ${index}`] = { c: 1 + index };
    t.index.leagues.push({ name: "Standard", slug: "Standard" }, { name: "Hardcore", slug: "Hardcore" });
  });
  await write(path.join(previous, "Standard", "prices.json"), { generatedAt: ago(1), prices: { "Chaos Orb": { c: 1 } } });
  await write(path.join(previous, "Hardcore", "prices.json"), { generatedAt: ago(1), prices: { "Chaos Orb": { c: 1 } } });
  const shrunk = codes(await validatePoe1(await poe1Tree(), { previousDir: previous }));
  assert.ok(shrunk.includes("league-collapse"), "losing most leagues fails rather than publishing quietly");
  assert.ok(shrunk.includes("price-collapse"), "a source that stops answering fails rather than publishing 2 names");
}

/* ---- PoE 2 gates ---- */
async function poe2Tree(mutate = () => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "vs-poe2-"));
  const files = { prices: "prices.json", priceHistory: "price-history.json", exchangeMarkets: "exchange-markets.json", exchangeHistory: "exchange-history.json" };
  const tree = {
    index: { schemaVersion: 1, generatedAt: ago(0), leagues: [{ name: "Standard", slug: "standard", group: "permanent", files }] },
    prices: {
      schemaVersion: 1, generatedAt: ago(0), league: "Standard", divineExalted: 400,
      priceSource: "GGG completed trades, then poe.ninja",
      prices: { "Exalted Orb": { exalted: 1, source: "GGG completed trades" }, "Chaos Orb": { exalted: 0.05, source: "poe.ninja exchange" } },
    },
    history: {
      schemaVersion: 1, generatedAt: ago(0), league: "Standard",
      timestamps: [ago(2), ago(1), ago(0)],
      divineExalted: [390, 395, 400],
      series: { "Chaos Orb": [0.04, null, 0.05] },
    },
  };
  mutate(tree);
  await write(path.join(dir, "index.json"), tree.index);
  await write(path.join(dir, "standard", "prices.json"), tree.prices);
  if (tree.history) await write(path.join(dir, "standard", "price-history.json"), tree.history);
  return dir;
}

assert.equal((await validatePoe2(await poe2Tree())).publishable, true, "a healthy PoE 2 tree publishes");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.prices.prices.INCOMPLETE = { exalted: 3 }; })))
  .includes("placeholder-item"), "an INCOMPLETE row must never reach the site");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.prices.prices.Broken = { exalted: 0 }; })))
  .includes("price-not-positive"));
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.prices.prices["Exalted Orb"] = { exalted: 400 }; })))
  .includes("exalted-self-check"), "Exalted must price itself at 1, or every number is scaled wrongly");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.history.series["Chaos Orb"] = [0.04, 0.05]; })))
  .includes("history-alignment"), "a series shorter than the timestamp axis fails publication");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.history.timestamps = [ago(1), ago(2), ago(0)]; })))
  .includes("history-timestamps"), "out-of-order timestamps fail publication");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { delete t.index.leagues[0].files; })))
  .includes("index-files"), "an index the browser cannot follow fails publication");
assert.ok(codes(await validatePoe2(await poe2Tree((t) => { t.index.schemaVersion = 2; })))
  .includes("schema-version"));
{
  const missingHistory = await validatePoe2(await poe2Tree((t) => { t.history = null; }));
  assert.ok(codes(missingHistory).includes("history-missing"), "missing history is degraded, not invented");
  assert.equal(missingHistory.publishable, true, "and it still publishes, visibly incomplete");
}
{
  const previous = await poe2Tree();
  const shrunk = await validatePoe2(await poe2Tree((t) => { t.history.timestamps = [ago(0)]; t.history.divineExalted = [400]; t.history.series = { "Chaos Orb": [0.05] }; }),
    { previousDir: previous });
  assert.ok(codes(shrunk).includes("history-shrank"), "a timeline that lost points must not publish");
}

console.log("Publication gates passed.");
