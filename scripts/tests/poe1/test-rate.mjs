/* Regression test for the divine-rate layer of the snapshot script.

   The site's "did this actually go up, or did chaos deflate?" toggle rests on
   three things that are easy to break silently:

   1. Every self-history point must carry the divine rate at the moment it was
      written, and points written before that existed must stay usable.
   2. The change windows must gain a divine-denominated twin (change1R through
      friends) computed from the rate at BOTH ends of the window — using
      today's rate for the old end is the mistake that makes the whole feature
      lie.
   3. The backfill has to survive poe.ninja quoting the ratio upside down.
      A divine is 1300 chaos; the endpoint may say 0.000769.

   The fixture below is built so the two numbers disagree loudly: the scarab is
   +20% in chaos over 48h and -7.7% in divine over the same window.

   Run: node scripts/test-rate.mjs
*/

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-rate-test-"));
const PAGES = "https://pages.test/base";
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const LEAGUE_START = new Date(NOW - 8 * 86400e3).toISOString();

/* chaos costs 0.1 exalted -> everything quoted in the primary is x10 to reach
   chaos, and a divine at 130 exalted is 1300c. */
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
const EXCHANGE_DATA = {
  Currency: [["chaos-orb", CHAOS_IN_PRIMARY], ["divine-orb", 130]],
  Scarab: [["divination-scarab-of-pilfering", 18.0]],   // -> 180c today
  Astrolabe: [["templar-astrolabe", 7.7]],
};

const SCARAB = "Divination Scarab of Pilfering";
/* Previous deployment's accumulated history. The 12h point deliberately has no
   rate — that is what every point written before this feature looks like. */
const PREV_SELF = {
  points: [
    { t: ago(48), values: { [SCARAB]: 150 }, rate: 1000 },
    { t: ago(24), values: { [SCARAB]: 160 }, rate: 1200 },
    { t: ago(12), values: { [SCARAB]: 165 } },
    { t: ago(8), values: { [SCARAB]: 170 }, rate: 1280 },
    { t: ago(4), values: { [SCARAB]: 175 }, rate: 1300 },
    { t: ago(2), values: { [SCARAB]: 178 }, rate: 1290 },
    { t: ago(1), values: { [SCARAB]: 179 }, rate: 1295 },
  ],
};

/* poe.ninja's legacy currency history, quoted divine-per-chaos (i.e. upside
   down) — the script has to notice and flip it. */
const BACKFILL_RATES = [[0, 1300], [1, 1290], [2, 1200], [3, 1100], [4, 1000], [5, 950], [6, 900]];

const hits = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const type = u.searchParams.get("type");
  hits.push(`${u.origin}${u.pathname}${type ? "?type=" + type : ""}`);

  if (u.origin === "https://pages.test") {
    if (u.pathname === "/base/data/Allflame/selfhistory.json") return J(PREV_SELF);
    return NOPE();   // no previous astrolabe/catalyst history
  }
  if (u.pathname === "/api/data/currencyoverview") {
    return J({ lines: [], currencyDetails: [{ id: 7, name: "Divine Orb" }] });
  }
  if (u.pathname === "/api/data/currencyhistory") {
    if (u.searchParams.get("currencyId") !== "7") return NOPE();
    return J({
      receiveCurrencyGraphData: BACKFILL_RATES.map(([daysAgo, rate]) => ({ daysAgo, value: 1 / rate, count: 40 })),
      payCurrencyGraphData: BACKFILL_RATES.map(([daysAgo]) => ({ daysAgo, value: 5 + daysAgo })),
    });
  }
  if (u.pathname.startsWith("/api/data/")) return NOPE();                     // rest of legacy is dead
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
delete process.env.RESET_HISTORY;
await import("../../poe1/fetch-data.mjs");

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
const scarabs = await read("scarabs.json");
const self = await read("scarabs-selfhistory.json");
const item = scarabs.items.find((i) => i.name === SCARAB);

// 0) the accumulated curve survives the rename: the fixture only serves the
// legacy unprefixed file, and its seven points have to land in the new one.
ok(hits.some((h) => h === "https://pages.test/base/data/Allflame/scarabs-selfhistory.json"),
   "the prefixed self-history must be tried first");
ok(hits.some((h) => h === "https://pages.test/base/data/Allflame/selfhistory.json"),
   "the legacy unprefixed name must still be read when the prefixed one is missing");

// today's snapshot
ok(near(item?.chaosValue, 180), `scarab today ${item?.chaosValue} != 180`);
ok(near(scarabs.divineRate, 1300, 1), `divineRate ${scarabs.divineRate} != 1300`);

// 1) the new point records the rate, and the rate-less legacy point survives
const last = self.points[self.points.length - 1];
ok(near(last.rate, 1300, 1), `new self point rate ${last.rate} != 1300`);
ok(self.points.length === 8, `self points ${self.points.length} != 8`);
ok(self.points.filter((p) => p.rate == null).length === 1, "the rate-less legacy point should be kept as-is");

// 2) nominal vs divine-denominated change — the whole point of the feature
ok(near(item?.change1, 0.559, 0.02), `change1 ${item?.change1} != 0.559`);
ok(near(item?.change1R, 0.172, 0.02), `change1R ${item?.change1R} != 0.172`);
ok(near(item?.change2, 1.124, 0.02), `change2 ${item?.change2} != 1.124`);
ok(near(item?.change2R, 0.346, 0.02), `change2R ${item?.change2R} != 0.346`);
ok(near(item?.change24, 12.5, 0.05), `change24 ${item?.change24} != 12.5`);
ok(near(item?.change24R, 3.846, 0.02), `change24R ${item?.change24R} != 3.846`);
ok(near(item?.change48, 20, 0.05), `change48 ${item?.change48} != 20`);
ok(near(item?.change48R, -7.692, 0.02), `change48R ${item?.change48R} != -7.692`);
// Using today's rate on both ends would collapse the two into the same number.
ok(!near(item?.change48, item?.change48R, 0.5), "real change must differ from nominal when the rate moved");

// 3) backfill: quoted upside down, and the pay-side series is noise
const rh = scarabs.rateHistory;
ok(Array.isArray(rh) && rh.length >= 8, `rateHistory ${rh?.length} points, expected >= 8`);
ok(scarabs.rateHistorySource === "ninja+self", `rateHistorySource ${scarabs.rateHistorySource}`);
ok(rh.every((p) => p.rate >= 20 && p.rate <= 20000), "every rate must be plausible (inversion mishandled?)");
ok(rh.some((p) => near(p.rate, 900, 1)), "day-6 backfill rate (900c) missing — inversion not undone");
ok(rh.every((p, i) => i === 0 || p.day >= rh[i - 1].day), "rateHistory must be sorted by day");
ok(rh.every((p) => p.day >= 0), "no rate point may sit before day 0");
ok(near(rh[rh.length - 1].rate, 1300, 1), `last rate ${rh[rh.length - 1].rate} != 1300`);

// league start is 8 days back and known, so day 0 is league start
ok(rh.some((p) => near(p.day, 6, 0.05) && near(p.rate, 1000, 1)), "48h-ago snapshot should land on day 6 at 1000c");
ok(!rh.some((p) => p.day > 7.4 && p.day < 7.6), "the rate-less point must not contribute a rate");

// the extra category tabs get their own series on their own axis
const astro = await read("astrolabes.json");
ok(Array.isArray(astro.rateHistory) && astro.rateHistory.length >= 7,
   `astrolabes rateHistory ${astro.rateHistory?.length} points, expected >= 7`);
ok(near(astro.rateHistory[astro.rateHistory.length - 1].rate, 1300, 1), "astrolabe rate series must end at today's rate");

// and the backfill was actually attempted through the documented path
ok(hits.some((h) => h.includes("/api/data/currencyhistory")), "currencyhistory must be consulted for backfill");

console.log(`\nchaos ${item?.change48?.toFixed(1)}% vs divine ${item?.change48R?.toFixed(1)}% over 48h · ${rh?.length} rate points`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
