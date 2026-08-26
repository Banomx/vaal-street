/* Regression test for PoE 2 reuse mode and failure behaviour.

   Push events build with DATA_MODE=reuse. Reuse used to overwrite each league's
   timeline with whatever the live site held, so the deploy that shipped a
   checked-in recovery seed was also the deploy that destroyed it — and after a
   repository move the seed is the only surviving copy, because the previous
   Pages site goes with the old repository.

   The other half is exit codes. A snapshot that cannot be built must fail the
   workflow: GitHub Pages keeps the last successful deployment when a run fails,
   so exiting non-zero leaves a healthy site up, while exiting 0 on a half-built
   tree replaces it with the damage.

   Run: node scripts/tests/poe2/test-reuse.mjs
*/

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fails = 0;
const ok = (condition, message) => { if (!condition) { fails++; console.log("FAIL:", message); } };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = await mkdtemp(path.join(tmpdir(), "vs-poe2-reuse-"));
const PAGES = "https://pages.test/base";
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();

/* The checked-in seed: ten hours of Runes of Aldur, and a Standard league the
   deployment has already lost. */
const seedTimestamps = [];
for (let h = 12; h >= 3; h -= 1) seedTimestamps.push(ago(h));
const seedHistory = {
  schemaVersion: 1,
  generatedAt: seedTimestamps.at(-1),
  league: "Runes of Aldur",
  retention: { hourlyHours: 168, maxDays: 430 },
  timestamps: seedTimestamps,
  divineExalted: seedTimestamps.map((_, i) => 400 + i),
  series: { "Chaos Orb": seedTimestamps.map((_, i) => 10 + i) },
};

await mkdir(path.join(OUT_DIR, "runes-of-aldur"), { recursive: true });
await mkdir(path.join(OUT_DIR, "standard"), { recursive: true });
await writeFile(path.join(OUT_DIR, "runes-of-aldur", "price-history.json"), JSON.stringify(seedHistory));
await writeFile(path.join(OUT_DIR, "runes-of-aldur", "prices.json"), JSON.stringify({
  schemaVersion: 1, generatedAt: ago(3), league: "Runes of Aldur", divineExalted: 409, prices: { "Chaos Orb": { exalted: 19 } },
}));
await writeFile(path.join(OUT_DIR, "standard", "prices.json"), JSON.stringify({
  schemaVersion: 1, generatedAt: ago(30), league: "Standard", divineExalted: 278, prices: { "Chaos Orb": { exalted: 7 } },
}));
await writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify({
  schemaVersion: 1,
  generatedAt: ago(3),
  leagues: [
    { name: "Runes of Aldur", slug: "runes-of-aldur", group: "current" },
    { name: "Standard", slug: "standard", group: "permanent" },
  ],
}));

/* The live deployment: one league, one history point — the state a build that
   could not read the previous deployment leaves behind. */
const deployedHistory = {
  schemaVersion: 1,
  generatedAt: ago(1),
  league: "Runes of Aldur",
  timestamps: [ago(1)],
  divineExalted: [500],
  series: { "Chaos Orb": [25] },
};

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.origin !== "https://pages.test") return NOPE();
  const file = u.pathname.replace("/base/data/poe2/", "");
  if (file === "index.json") return J({ schemaVersion: 1, generatedAt: ago(1), leagues: [{ name: "Runes of Aldur", slug: "runes-of-aldur", group: "current" }] });
  if (file === "runes-of-aldur/prices.json") {
    /* What the live site actually holds: rows written by an older generator
       that the current gates reject. Reuse can only carry them, so unless they
       are cleaned on the way in the run can never publish again. */
    return J({
      schemaVersion: 1, generatedAt: ago(1), league: "Runes of Aldur", divineExalted: 500,
      prices: { "Chaos Orb": { exalted: 25 }, INCOMPLETE: { exalted: 4 }, "Ghosted Rune": { exalted: 0 } },
    });
  }
  if (file === "runes-of-aldur/price-history.json") return J(deployedHistory);
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
process.env.PAGES_BASE_URL = PAGES;
process.env.DATA_MODE = "reuse";
await import("../../poe2/fetch-data.mjs");

await (async () => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const index = JSON.parse(await readFile(path.join(OUT_DIR, "index.json"), "utf8"));
    if (Date.parse(index.generatedAt) > NOW) return;
    if (Date.now() > deadline) throw new Error("reuse did not finish within 60s");
    await new Promise((r) => setTimeout(r, 100));
  }
})();

const read = async (...parts) => JSON.parse(await readFile(path.join(OUT_DIR, ...parts), "utf8"));
const history = await read("runes-of-aldur", "price-history.json");
const index = await read("index.json");

ok(history.timestamps.length === seedTimestamps.length + 1,
  `reuse publishes the union, expected ${seedTimestamps.length + 1} points, got ${history.timestamps.length}`);
ok(seedTimestamps.every((t) => history.timestamps.includes(t)),
  "a one-point deployment cannot overwrite a richer local timeline");
ok(history.timestamps.includes(ago(1)), "the deployment's newer point is kept too");
ok(history.timestamps.every((t, i) => i === 0 || Date.parse(t) >= Date.parse(history.timestamps[i - 1])),
  "merged timestamps stay ordered");
ok(history.series["Chaos Orb"].length === history.timestamps.length,
  "every series stays aligned with the timestamp axis after merging");
ok(history.series["Chaos Orb"].at(-1) === 25, "the newest deployed value survives the merge");

/* The carried price file is cleaned, not published and not refused. */
const reusedPrices = (await read("runes-of-aldur", "prices.json")).prices;
ok(reusedPrices["Chaos Orb"].exalted === 25, "a real carried price is untouched");
ok(reusedPrices.INCOMPLETE === undefined, "a placeholder row carried from the deployment is dropped");
ok(reusedPrices["Ghosted Rune"] === undefined, "and so is a row quoted at zero — absent is unknown, zero is free");

ok((await read("runes-of-aldur", "prices.json")).prices["Chaos Orb"].exalted === 25,
  "current prices come from the deployment, which is newer than the seed");
ok(index.leagues.find((l) => l.slug === "standard"),
  "a league missing from the deployed index but present locally is kept");
ok((await read("standard", "prices.json")).prices["Chaos Orb"].exalted === 7,
  "that league keeps its checked-in snapshot");
ok(index.leagues.every((l) => l.files?.priceHistory === "price-history.json"),
  "every league advertises its file map so the browser can follow it");
ok(index.schemaVersion === 1, "the index states the schema it was written against");

/* A failed fetch must not be laundered into a success by the presence of an old
   local index. Run the real entry point with the network removed. */
const { code } = await new Promise((resolve) => {
  execFile(process.execPath, [
    "--input-type=module",
    "-e", "globalThis.fetch = async () => { throw new Error('network down'); }; await import(process.env.POE2_ENTRY);",
  ], {
    cwd: ROOT,
    env: { ...process.env, POE2_ENTRY: path.join(ROOT, "scripts", "poe2", "fetch-data.mjs"), DATA_OUT: OUT_DIR, DATA_MODE: "fetch" },
  }, (error) => resolve({ code: error?.code ?? 0 }));
});
ok(code === 1, `a fetch that cannot reach any source must exit non-zero even with a local index present, got ${code}`);

if (fails) { console.log(`${fails} FAILURES`); process.exit(1); }
console.log("PoE 2 reuse and failure handling passed.");
