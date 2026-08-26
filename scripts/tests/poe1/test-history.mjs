/* Regression test for the history layer of the snapshot script.

   Everything here is about data that cannot be re-fetched later. The site's
   curves are grown one hourly point at a time and stored only in the last
   deployment, so the failures worth guarding are the silent ones:

   1. A run that cannot price a family must keep that family's deployed files.
      Writing nothing deletes them from the site, and the next run then starts
      the curve again from a single point — which is how the Astrolabe graph
      ended up holding a day and a half of a three-month league.
   2. poe.ninja's league-long backfill is ~90 requests, so it is fetched once
      and reused. Stored as absolute timestamps, because `daysAgo` silently
      slides off the axis the moment it is reused.
   3. Every family shares one day axis. Strat Watcher adds a scarab series to
      an Astrolabe series; if the two anchor day 0 differently that sum is
      nonsense.
   4. Previous deployment reads use the game-scoped data path. The old path is
      only a migration fallback; reading only that path restarts every curve
      after the repository's PoE 1 / PoE 2 split.
   5. Accumulated points thin rather than disappear, and the change windows
      keep full resolution because they are read straight off these points.

   Run: node scripts/test-history.mjs
*/

import { mkdir, mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-history-test-"));
const PAGES = "https://pages.test/base";
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const LEAGUE_START = new Date(NOW - 10 * 86400e3).toISOString();

const CHAOS_IN_PRIMARY = 0.1;
const CORE = {
  primary: "exalted-orb",
  items: [
    { id: "chaos-orb", name: "Chaos Orb" },
    { id: "divine-orb", name: "Divine Orb" },
    { id: "exalted-orb", name: "Exalted Orb" },
  ],
  rates: { "chaos-orb": CHAOS_IN_PRIMARY, "divine-orb": 130, "exalted-orb": 1 },
};
const exchange = (lines) => J({
  core: CORE,
  lines: lines.map(([id, v]) => ({ id, primaryValue: v, sparkline: { data: [1, 2, 3] } })),
});

const SCARAB = "Divination Scarab of Pilfering";
const ASTROLABE = "Templar Astrolabe";

/* Astrolabes price today; catalysts deliberately do not, so the carry-forward
   path is the one under test rather than a happy path. */
const EXCHANGE_DATA = {
  Currency: [["chaos-orb", CHAOS_IN_PRIMARY], ["divine-orb", 130]],
  Scarab: [["divination-scarab-of-pilfering", 18.0]],   // -> 180c today
  Astrolabe: [["templar-astrolabe", 30.0]],             // -> 300c today
};

/* The previous deployment. Scarabs carry a long accumulated curve (including
   points old enough to be thinned and one past the retention window), the
   Astrolabe has a short one, and catalysts have a curve but no live price. */
// Two points on one old UTC day, spelled out so the collapse is tested rather
// than depending on what time of day the suite happens to run.
const OLD_DAY = new Date(NOW - 7 * 86400e3).toISOString().slice(0, 10);
const SCARAB_SELF = {
  points: [
    { t: new Date(NOW - 500 * 86400e3).toISOString(), values: { [SCARAB]: 1 }, rate: 1000 },   // beyond retention
    { t: `${OLD_DAY}T01:00:00.000Z`, values: { [SCARAB]: 100 }, rate: 1000 },
    { t: `${OLD_DAY}T02:00:00.000Z`, values: { [SCARAB]: 101 }, rate: 1000 },
    { t: ago(48), values: { [SCARAB]: 150 }, rate: 1000 },
    { t: ago(24), values: { [SCARAB]: 160 }, rate: 1200 },
    { t: ago(2), values: { [SCARAB]: 178 }, rate: 1290 },
    { t: ago(1), values: { [SCARAB]: 179 }, rate: 1295 },
  ],
};
const ASTRO_SELF = { points: [{ t: ago(2), values: { [ASTROLABE]: 290 }, rate: 1290 } ] };
const CATALYST_SELF = { points: [{ t: ago(2), values: { "Intrinsic Catalyst": 42 }, rate: 1290 } ] };
/* Fetched on some earlier run: the league's first days, which no accumulated
   history can ever reach back to. */
const SCARAB_BACKFILL = {
  fetchedAt: ago(72),
  source: "ninja",
  series: {
    [SCARAB]: [
      { t: new Date(NOW - 9 * 86400e3).toISOString(), value: 90 },
      { t: new Date(NOW - 8 * 86400e3).toISOString(), value: 95 },
      // Overlaps the accumulated curve, and disagrees with it on purpose.
      { t: ago(24), value: 5 },
    ],
  },
};

/* A checked-in point from an emergency Pages-artifact recovery. The live
   deployment also has history, so the run must merge rather than merely use
   this as a missing-file fallback. */
await mkdir(path.join(OUT_DIR, "Allflame"), { recursive: true });
await writeFile(path.join(OUT_DIR, "Allflame", "scarabs-selfhistory.json"), JSON.stringify({
  points: [{ t: ago(3), values: { [SCARAB]: 171 }, rate: 1280 }],
}));

const hits = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const type = u.searchParams.get("type");
  hits.push(`${u.origin}${u.pathname}${type ? "?type=" + type : ""}`);

  if (u.origin === "https://pages.test") {
    const prefix = "/base/data/poe1/Allflame/";
    if (!u.pathname.startsWith(prefix)) return NOPE();
    const file = u.pathname.slice(prefix.length);
    if (file === "scarabs-selfhistory.json") return J(SCARAB_SELF);
    if (file === "scarabs-backfill.json") return J(SCARAB_BACKFILL);
    if (file === "astrolabes-selfhistory.json") return J(ASTRO_SELF);
    if (file === "catalysts-selfhistory.json") return J(CATALYST_SELF);
    if (file === "catalysts.json") return J({ generatedAt: ago(1), items: [{ name: "Intrinsic Catalyst", chaosValue: 42 }] });
    if (file === "catalysts-history.json") return J({ "Intrinsic Catalyst": [{ day: 8, value: 42 }] });
    return NOPE();
  }
  if (u.pathname.startsWith("/api/data/")) return NOPE();                     // legacy is dead
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: LEAGUE_START }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    return EXCHANGE_DATA[type] ? exchange(EXCHANGE_DATA[type]) : J({ core: CORE, lines: [] });
  }
  if (u.pathname.startsWith("/poe1/api/economy/stash/")) return J({ lines: [] });
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
process.env.PAGES_BASE_URL = PAGES;
const mod = await import("../../poe1/fetch-data.mjs");

await (async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(OUT_DIR, "index.json"), "utf8"); return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error("snapshot did not finish within 120s");
    await new Promise((r) => setTimeout(r, 200));
  }
})();

/* ---- assertions ---- */
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.01) => a != null && isFinite(a) && Math.abs(a - b) <= eps;
const read = async (f) => JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", f), "utf8"));

/* 1) one folder, one naming rule */
const files = new Set(await readdir(path.join(OUT_DIR, "Allflame")));
for (const f of ["scarabs.json", "scarabs-history.json", "scarabs-selfhistory.json", "scarabs-backfill.json",
                 "astrolabes.json", "astrolabes-history.json", "astrolabes-selfhistory.json"]) {
  ok(files.has(f), `${f} missing from the league folder`);
}
ok(!files.has("history.json") && !files.has("selfhistory.json"),
   "the unprefixed scarab files must not be written any more");

/* 2) the backfill is reused, not refetched */
ok(!hits.some((h) => h.includes("/api/data/itemhistory")),
   "a stored backfill must not trigger another ~90 requests to poe.ninja");
ok(hits.includes(`${PAGES}/data/poe1/Allflame/scarabs-selfhistory.json`),
   "accumulated history must be restored from the game-scoped deployment path");
ok(hits.includes(`${PAGES}/data/poe1/Allflame/scarabs-backfill.json`),
   "stored backfill must be restored from the game-scoped deployment path");
const storedBackfill = await read("scarabs-backfill.json");
ok(storedBackfill.series?.[SCARAB]?.length === 3, "the stored backfill is carried forward verbatim");
ok(storedBackfill.series[SCARAB].every((p) => Date.parse(p.t) > 0),
   "backfill points are stored as absolute timestamps, not daysAgo");

/* 3) backfill and accumulation on one axis, ours winning the overlap */
const hist = await read("scarabs-history.json");
const series = hist[SCARAB] || [];
const at = (day) => series.find((p) => near(p.day, day, 0.05));
ok(near(at(1)?.value, 90), `day 1 comes from the backfill: ${at(1)?.value}`);
ok(near(at(2)?.value, 95), `day 2 comes from the backfill: ${at(2)?.value}`);
ok(near(at(9)?.value, 160), "in the overlap our own snapshot wins, not the backfill's 5c");
ok(series.every((p, i) => i === 0 || p.day >= series[i - 1].day), "history must be sorted by day");
ok(series.every((p) => p.day >= 0), "no point may sit before day 0");
ok(near(series[series.length - 1].value, 180), "the curve ends at today's price");

/* 4) league start is day 0, and every family agrees on it */
const scarabs = await read("scarabs.json");
const astro = await read("astrolabes.json");
ok(scarabs.historyAxis === "league day", `scarab axis ${scarabs.historyAxis}`);
ok(astro.historyAxis === scarabs.historyAxis, "every family must report the same axis");
ok(scarabs.historySource === "ninja+self", `scarab history source ${scarabs.historySource}`);
ok(astro.historySource === "self", `astrolabe history source ${astro.historySource}`);
const astroSeries = (await read("astrolabes-history.json"))[ASTROLABE] || [];
// The Astrolabe's 2h-old accumulated point and the scarab's 2h-old one were
// taken at the same moment, so they have to land on the same day.
const scarabAt2h = series.find((p) => near(p.value, 178));
ok(near(astroSeries[0]?.day, scarabAt2h?.day, 0.05),
   `same moment, different tabs: astrolabe day ${astroSeries[0]?.day} vs scarab day ${scarabAt2h?.day}`);
ok(near(astro.rateHistory?.at(-1)?.rate, scarabs.rateHistory?.at(-1)?.rate),
   "one rate curve per league, shared by every family");

/* 5) a family the feeds could not price keeps what was deployed */
ok(files.has("catalysts.json") && files.has("catalysts-selfhistory.json"),
   "catalysts priced nothing this run, so its deployed files must survive");
const catSelf = await read("catalysts-selfhistory.json");
ok(catSelf.points?.length === 1 && near(catSelf.points[0].values["Intrinsic Catalyst"], 42),
   "the carried-forward curve is the deployed one, untouched");

/* 6) thinning keeps the windows exact and drops what is past retention */
const self = await read("scarabs-selfhistory.json");
const stamps = self.points.map((p) => Date.parse(p.t));
ok(!stamps.some((ms) => ms < NOW - 440 * 86400e3), "points past the retention window must be dropped");
ok(self.points.filter((p) => Date.parse(p.t) < NOW - 72 * 3600e3).length === 1,
   "the two points on the same old UTC day collapse to one");
ok(self.points.filter((p) => Date.parse(p.t) >= NOW - 72 * 3600e3).length === 6,
   "everything inside the hourly window is kept, including the recovery seed and this run's point");
ok(self.points.some((p) => near(p.values?.[SCARAB], 171)),
   "a checked-in recovery point must survive a full fetch, not only reuse mode");
const item = scarabs.items.find((i) => i.name === SCARAB);
ok(near(item?.change24, 12.5, 0.05), `change24 ${item?.change24} != 12.5 — the 24h point was thinned away`);
ok(near(item?.change48, 20, 0.05), `change48 ${item?.change48} != 20`);
// 4h has no point of its own; the nearest older one is 24h old and must not be
// dressed up as a 4h move.
ok(item?.change4 == null, `a 24h-old point must not answer the 4h window (got ${item?.change4})`);

/* A finished league does not append snapshots, but its final stored window is
   still measurable. Feed placeholders and a later fetch must not flatten it. */
const frozen = [{ name: SCARAB, chaosValue: 999, change24: 0 }];
mod.applySelfChanges(frozen, { points: [
  { t: ago(24), values: { [SCARAB]: 80 }, rate: 100 },
  { t: ago(0), values: { [SCARAB]: 100 }, rate: 110 },
] });
ok(near(frozen[0].change24, 25), `finished-league change uses the final stored price: ${frozen[0].change24}`);
ok(near(frozen[0].change24R, 13.636, 0.01), `finished-league divine change uses the final stored rate: ${frozen[0].change24R}`);

/* 7) the pure pieces, directly */
const thinned = mod.thinPoints([
  { t: new Date(NOW - 500 * 86400e3).toISOString(), values: {} },
  { t: new Date(NOW - 5 * 86400e3).toISOString(), values: {} },
  { t: new Date(NOW - 5 * 86400e3 + 3600e3).toISOString(), values: {} },
  { t: ago(1), values: {} },
], { nowMs: NOW });
ok(thinned.length === 2, `thinPoints kept ${thinned.length}, expected 2 (one old day + one recent)`);

const origin = mod.historyOrigin({ leagueStart: new Date(2013, 0, 1).toISOString(), self: { points: [{ t: ago(1), values: {} }] } });
ok(origin?.axis === "days since first snapshot", "Standard's 2013 start must not become day 0");

/* 8) a recovery seed keeps old points while the deployed overlap wins */
const recoveryTime = ago(6);
const mergedSelf = mod.mergeSelfHistory(
  { points: [{ t: ago(12), values: { [SCARAB]: 120 } }, { t: recoveryTime, values: { [SCARAB]: 140 } }] },
  { points: [{ t: recoveryTime, values: { [SCARAB]: 145 } }, { t: ago(1), values: { [SCARAB]: 180 } }] },
);
ok(mergedSelf.points.length === 3, `recovery self-history kept ${mergedSelf.points.length} points, expected 3`);
ok(mergedSelf.points.find((point) => point.t === recoveryTime)?.values?.[SCARAB] === 145,
   "the deployed snapshot must win a recovery overlap");
const mergedBackfill = mod.mergeBackfill(
  { series: { [SCARAB]: [{ t: ago(240), value: 90 }] } },
  { series: { [SCARAB]: [{ t: ago(216), value: 95 }] } },
);
ok(mergedBackfill.series[SCARAB].length === 2, "recovery backfill must retain both absolute-time points");

console.log(`\n${series.length} stitched scarab points, ${self.points.length} accumulated, axis "${scarabs.historyAxis}"`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
