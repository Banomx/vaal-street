/* Regression test for PoE 1 history recovery.

   The failure this guards against actually happened: the repository moved, the
   new Pages site had no deployment yet, every previous-deployment read 404'd
   silently, and two hours of builds republished a thinned copy of the
   checked-in seed. Eighty-seven hourly points per family and an entire league
   survived only in a downloaded artifact.

   Three rules come out of that:

   1. Reuse mode merges the checked-in recovery seed with the deployment rather
      than replacing it, and the merge can only ever add points.
   2. Restoring raw points rebuilds everything projected from them. A league
      shipping an 83-point raw curve beside a one-point rate line is the bug,
      not a cosmetic mismatch.
   3. A league the deployment no longer serves is kept and marked stale. A
      missing league is far more often one bad response than a retirement, and
      dropping it deletes its accumulated history on the next pass.

   Run: node scripts/tests/poe1/test-recovery.mjs
*/

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRateHistory, rebuildDerivedHistory } from "../../poe1/history.mjs";

let fails = 0;
const ok = (condition, message) => { if (!condition) { fails++; console.log("FAIL:", message); } };

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const SCARAB = "Divination Scarab of Pilfering";

/* ---- 1) the derived rebuild, on the shape the checked-in tree actually had ---- */
{
  const dir = await mkdtemp(path.join(tmpdir(), "vs-rebuild-"));
  const points = [];
  for (let h = 96; h >= 1; h -= 1) points.push({ t: ago(h), values: { [SCARAB]: 100 + h }, rate: 200 + h });
  await writeFile(path.join(dir, "scarabs-selfhistory.json"), JSON.stringify({ points }));
  // Exactly what the checked-in Allflame snapshot held: many raw rate points,
  // one emitted rate point, and no stored origin to re-anchor from.
  await writeFile(path.join(dir, "scarabs.json"), JSON.stringify({
    generatedAt: ago(1),
    historyAxis: "days since first snapshot",
    rateHistory: [{ day: 0, rate: 201.24 }],
    rateHistorySource: "self",
    items: [{ name: SCARAB, chaosValue: 101 }],
  }));

  const result = await rebuildDerivedHistory(dir, ["scarabs"]);
  const snapshot = JSON.parse(await readFile(path.join(dir, "scarabs.json"), "utf8"));
  const history = JSON.parse(await readFile(path.join(dir, "scarabs-history.json"), "utf8"));

  ok(result.rebuilt === 1, `one family rebuilt, got ${result.rebuilt}`);
  ok(snapshot.rateHistory.length === points.length,
    `${points.length} rate-bearing raw points must emit ${points.length} rate points, got ${snapshot.rateHistory.length}`);
  ok(snapshot.rateHistory.every((p, i) => i === 0 || p.day >= snapshot.rateHistory[i - 1].day),
    "the rebuilt rate curve is ordered by day");
  ok(snapshot.historyOrigin === points[0].t,
    "the rebuild stores the origin so the axis can be reconstructed next time");
  ok((history[SCARAB] || []).length === points.length,
    `the price curve rebuilds too, got ${(history[SCARAB] || []).length}`);
  ok(snapshot.items?.[0]?.name === SCARAB, "rebuilding derived files leaves the current prices alone");

  // Second pass must be a no-op on the numbers: the stored origin is now used
  // instead of being recomputed, so the axis cannot drift under repeated runs.
  await rebuildDerivedHistory(dir, ["scarabs"]);
  const again = JSON.parse(await readFile(path.join(dir, "scarabs.json"), "utf8"));
  ok(JSON.stringify(again.rateHistory) === JSON.stringify(snapshot.rateHistory),
    "a second rebuild produces an identical curve");
}

/* ---- 2) a raw curve with no rates emits no rate line, rather than a fake one ---- */
{
  const rateless = buildRateHistory({
    self: { points: [{ t: ago(3), values: {} }, { t: ago(2), values: {} }] },
    t0Ms: NOW - 3 * 3600e3,
  });
  ok(rateless.length === 0, "points without a stored rate contribute nothing to the rate curve");
}

/* ---- 3) reuse mode: merge the seed, rebuild, keep the undeployed league ---- */
const OUT_DIR = await mkdtemp(path.join(tmpdir(), "vs-recovery-"));
const PAGES = "https://pages.test/base";
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

/* The checked-in tree: a rich Allflame curve, plus a Hardcore league the live
   deployment has already dropped. */
const SEED_POINTS = [];
for (let h = 96; h >= 4; h -= 1) SEED_POINTS.push({ t: ago(h), values: { [SCARAB]: 100 + h }, rate: 200 + h });

await mkdir(path.join(OUT_DIR, "Allflame"), { recursive: true });
await mkdir(path.join(OUT_DIR, "Hardcore"), { recursive: true });
await writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify({
  generatedAt: ago(50),
  leagues: [
    { name: "Allflame", slug: "Allflame", group: "current" },
    { name: "Hardcore", slug: "Hardcore", group: "current" },
  ],
}));
await writeFile(path.join(OUT_DIR, "Allflame", "scarabs-selfhistory.json"), JSON.stringify({ points: SEED_POINTS }));
await writeFile(path.join(OUT_DIR, "Allflame", "prices.json"), JSON.stringify({ generatedAt: ago(50), prices: { [SCARAB]: { c: 101 } } }));
await writeFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), JSON.stringify({
  generatedAt: ago(50), historyAxis: "days since first snapshot", rateHistory: [{ day: 0, rate: 201 }], items: [],
}));
await writeFile(path.join(OUT_DIR, "Hardcore", "prices.json"), JSON.stringify({ generatedAt: ago(120), prices: { [SCARAB]: { c: 55 } } }));
await writeFile(path.join(OUT_DIR, "Hardcore", "scarabs.json"), JSON.stringify({
  generatedAt: ago(120), historyAxis: "days since first snapshot", rateHistory: [], items: [],
}));
await writeFile(path.join(OUT_DIR, "Hardcore", "scarabs-selfhistory.json"), JSON.stringify({
  points: [{ t: ago(122), values: { [SCARAB]: 54 }, rate: 300 }, { t: ago(120), values: { [SCARAB]: 55 }, rate: 301 }],
}));

/* The live deployment: Allflame only, and thinned down to two points — the
   state the broken build left behind. */
const DEPLOYED_POINTS = [
  { t: ago(96), values: { [SCARAB]: 196 }, rate: 296 },   // overlaps the seed
  { t: ago(1), values: { [SCARAB]: 300 }, rate: 400 },    // newer than the seed
];

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.origin !== "https://pages.test") return NOPE();
  const file = u.pathname.replace("/base/data/poe1/", "");
  if (file === "index.json") return J({ generatedAt: ago(1), leagues: [{ name: "Allflame", slug: "Allflame", group: "current" }] });
  if (file === "Allflame/scarabs-selfhistory.json") return J({ points: DEPLOYED_POINTS });
  if (file === "Allflame/scarabs.json") {
    return J({ generatedAt: ago(1), historyAxis: "days since first snapshot", rateHistory: [{ day: 0, rate: 400 }], items: [{ name: SCARAB, chaosValue: 300 }] });
  }
  if (file === "Allflame/prices.json") return J({ generatedAt: ago(1), prices: { [SCARAB]: { c: 300 } } });
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
process.env.PAGES_BASE_URL = PAGES;
process.env.DATA_MODE = "reuse";
delete process.env.RESET_HISTORY;
await import("../../poe1/fetch-data.mjs");

await (async () => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const index = JSON.parse(await readFile(path.join(OUT_DIR, "index.json"), "utf8"));
    if (Date.parse(index.generatedAt) > Date.parse(ago(0.1))) return;
    if (Date.now() > deadline) throw new Error("reuse did not finish within 60s");
    await new Promise((r) => setTimeout(r, 100));
  }
})();

const read = async (...parts) => JSON.parse(await readFile(path.join(OUT_DIR, ...parts), "utf8"));
const self = await read("Allflame", "scarabs-selfhistory.json");
const snapshot = await read("Allflame", "scarabs.json");
const index = await read("index.json");

const seedTimes = new Set(SEED_POINTS.map((p) => p.t));
ok(self.points.length === SEED_POINTS.length + 1,
  `the union keeps every seed point plus the deployment's newer one, got ${self.points.length} of ${SEED_POINTS.length + 1}`);
ok(SEED_POINTS.every((p) => self.points.some((q) => q.t === p.t)),
  "a one-point deployment cannot overwrite a richer checked-in seed");
ok(self.points.find((p) => p.t === ago(96))?.values[SCARAB] === 196,
  "where both hold the same hour the deployed point wins, being the newer authority");
ok(self.points.some((p) => p.t === ago(1) && !seedTimes.has(p.t)),
  "the deployment's newer point is added rather than discarded");
ok(self.points.every((p, i) => i === 0 || p.t >= self.points[i - 1].t), "merged points stay ordered");

ok(snapshot.rateHistory.length === self.points.length,
  `the restored raw curve is projected back into the snapshot: ${snapshot.rateHistory.length} rate points for ${self.points.length} raw points`);
ok(snapshot.items?.[0]?.name === SCARAB, "the deployed current prices are what reuse publishes");
ok(((await read("Allflame", "scarabs-history.json"))[SCARAB] || []).length === self.points.length,
  "the plotted curve is rebuilt from the merged points, not carried over from the deployment");

const hardcore = index.leagues.find((l) => l.slug === "Hardcore");
ok(hardcore, "a league the deployment stopped serving is kept, not silently dropped");
ok(hardcore?.stale === true, "and it is marked stale rather than passed off as current");
ok(index.leagues.find((l) => l.slug === "Allflame")?.stale === undefined,
  "a league the deployment does serve is not flagged");
ok((await read("Hardcore", "prices.json")).prices[SCARAB].c === 55,
  "the undeployed league keeps its checked-in snapshot");

if (fails) { console.log(`${fails} FAILURES`); process.exit(1); }
console.log("PoE 1 history recovery passed.");
