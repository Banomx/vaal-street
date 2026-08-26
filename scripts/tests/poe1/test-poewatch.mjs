/* poe.watch as the fallback price source.

   The API cannot be reached from CI, so this stubs it and runs the real
   snapshot script end to end, the same way test-fetch-shapes does for
   poe.ninja. What it pins down:

     1. Precedence. poe.ninja wins wherever both sources know an item, and
        poe.watch fills what poe.ninja doesn't carry — which is most of what
        the boss tab needs, since the unidentified markets are poe.watch's
        alone. Getting this backwards would be invisible: every price would
        still look plausible.
     2. The unit. poe.watch quotes chaos in `mean`, but has no Chaos Orb row
        and reports an Exalted Orb at 1, so the divine rate has to come from
        Divine Orb's own price and NOT from the per-row `divine` field, which
        implies a different rate.
     3. Base variants. A corrupted 21/20 gem and a 6-link are not what drops.
     4. Unidentified items. Their current listing floor and item-level market
        must survive, and veiled/unidentified boss lines must prefer them.
     5. Falling back. If poe.watch is down the run must still produce a
        snapshot rather than an empty one.

   Run: node scripts/test-poewatch.mjs
*/

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  adaptBeta, betaUrl, isWatchBaseVariant, normaliseExchange, normaliseRow,
  watchCategoryItems, watchPriceMap,
} from "../../poe1/sources/poewatch.mjs";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-watch-test-"));
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

/* The two candidate rates, deliberately far apart so a mix-up cannot pass.
   EXCHANGE is what mean/divine recovers on every row; LISTING is what the
   Divine Orb item row claims. Live, these really are ~222 and ~173. */
const EXCHANGE = 222;
const LISTING = 173;
const WATCH = {
  currency: [
    // Thin and lowConfidence, exactly as live — few people list divines for
    // chaos as an item, so this row must not set the rate.
    { id: 1, name: "Divine Orb", mean: LISTING, min: LISTING, max: 179.5, daily: 89, lowConfidence: true, divine: 0.76 },
    { id: 2, name: "Exalted Orb", mean: 1, min: 1, max: 1, daily: 40, lowConfidence: true, divine: 0 },
    { id: 3, name: "Deceptive Astrolabe", mean: 90, min: 88, max: 95, daily: 300, lowConfidence: false, divine: 0.39 },
    { id: 4, name: "Abrasive Catalyst", mean: 7, min: 7, max: 8, daily: 900, lowConfidence: false, divine: 0 },
    // poe.ninja prices this one far lower, and wins anyway — poe.watch's
    // figure does not survive at all, beyond a line in the hourly log.
    { id: 5, name: "Orb of Intention", mean: 300, min: 290, max: 310, daily: 500, lowConfidence: false, divine: 300 / EXCHANGE },
  ],
  scarab: [
    { id: 10, name: "Horned Scarab of Pandemonium", mean: 95, min: 90, max: 99, daily: 400, lowConfidence: false, divine: 95 / EXCHANGE },
    { id: 11, name: "Divination Scarab of Pilfering", mean: 18, min: 17, max: 20, daily: 250, lowConfidence: false, divine: 0.08 },
  ],
  flask: [
    { id: 20, name: "Cinderswallow Urn", mean: 120, min: 120, max: 120, daily: 6623, lowConfidence: false, divine: 0.54 },
    { id: 21, name: "Unidentified Cinderswallow Urn", mean: 1110, min: 840, max: 1175.75, daily: 992, lowConfidence: false, divine: 1110 / EXCHANGE },
  ],
  jewel: [
    { id: 22, name: "Watcher's Eye", mean: 1, min: 1, max: 4, daily: 100000, lowConfidence: false },
    { id: 23, name: "Unidentified Watcher's Eye 85", mean: 159, min: 120, max: 227, itemLevel: 85, daily: 5009, lowConfidence: false },
    { id: 24, name: "Unidentified Watcher's Eye 86+", mean: 495, min: 460, max: 600, itemLevel: 86, daily: 8259, lowConfidence: false },
    { id: 25, name: "Unidentified Thread of Hope", mean: 445, min: 300, max: 475, itemLevel: 86, daily: 42, lowConfidence: false },
    { id: 26, name: "Unidentified Thread of Hope", mean: 20, min: 13, max: 28, itemLevel: 87, daily: 511, lowConfidence: false },
    { id: 27, name: "Unidentified Forbidden Flame", mean: 2668, min: 2638, max: 2852, itemLevel: 86, daily: 4108, lowConfidence: false },
    { id: 28, name: "Unidentified Forbidden Flame", mean: 2445, min: 2400, max: 3327, itemLevel: 87, daily: 502, lowConfidence: false },
    { id: 29, name: "Unidentified Forbidden Flesh", mean: 2100, min: 1800, max: 2614, itemLevel: 86, daily: 5109, lowConfidence: false },
    { id: 34, name: "Unidentified Forbidden Flesh", mean: 2800, min: 2650, max: 3327, itemLevel: 87, daily: 291, lowConfidence: false },
  ],
  gem: [
    { id: 30, name: "Pacifism Support", mean: 1050, min: 1000, max: 1100, daily: 30, lowConfidence: false, gemLevel: 1, gemQuality: 0, gemIsCorrupted: false, divine: 1050 / EXCHANGE },
    { id: 31, name: "Pacifism Support", mean: 626600, min: 626600, max: 626600, daily: 4, lowConfidence: true, gemLevel: 21, gemQuality: 20, gemIsCorrupted: true, divine: 2823 },
    // A gem poe.watch only carries in levelled forms. A boss drops level 1, so
    // there is no price for what it drops — quoting the 20/20 would be wrong by
    // whatever the levelling is worth, which for a good gem is most of it.
    { id: 32, name: "Enhance Support", mean: 4000, min: 4000, max: 4000, daily: 60, lowConfidence: false, gemLevel: 3, gemQuality: 0, gemIsCorrupted: false, divine: 4000 / EXCHANGE },
    { id: 33, name: "Enhance Support", mean: 9000, min: 9000, max: 9000, daily: 12, lowConfidence: false, gemLevel: 4, gemQuality: 20, gemIsCorrupted: false, divine: 9000 / EXCHANGE },
  ],
  armour: [
    { id: 40, name: "Shaper's Touch", mean: 12, min: 12, max: 14, daily: 100, lowConfidence: false, linkCount: 0, divine: 0.05 },
    { id: 41, name: "Shaper's Touch", mean: 5100, min: 5100, max: 5100, daily: 3, lowConfidence: true, linkCount: 6, divine: 23 },
  ],
  fossil: [{ id: 50, name: "Hollow Fossil", mean: 13, min: 12, max: 14, daily: 200, lowConfidence: false, divine: 0.06 }],
  resonator: [{ id: 60, name: "Prime Chaotic Resonator", mean: 9.6, min: 9, max: 10, daily: 150, lowConfidence: false, divine: 0.04 }],
};

/* poe.ninja carries one name poe.watch does not, and disagrees on a name it
   does — so both directions of the precedence rule get exercised. */
const CORE = {
  primary: "chaos-orb", secondary: "divine-orb",
  items: [{ id: "chaos-orb", name: "Chaos Orb" }, { id: "divine-orb", name: "Divine Orb" }],
  rates: { "chaos-orb": 1, "divine-orb": LISTING },
};
const NINJA_EXCHANGE = {
  Currency: [["chaos-orb", 1], ["divine-orb", LISTING], ["orb-of-intention", 26.4], ["awakeners-orb", 210],
             ["deceptive-astrolabe", 88], ["abrasive-catalyst", 6]],
  Fragment: [["reverent-fragment", 79]],
  // Deliberately cheaper than poe.watch's figures for the same scarabs, so
  // which feed answered is never ambiguous.
  Scarab: [["horned-scarab-of-pandemonium", 80], ["divination-scarab-of-pilfering", 15]],
  Astrolabe: [["deceptive-astrolabe", 88]],
  Fossil: [["hollow-fossil", 11]],
  Resonator: [["prime-chaotic-resonator", 8]],
};

/* The exchange trades a subset of items and quotes a volume-weighted mean of
   real trades. Deliberately different from the listing means above, so which
   one won is never ambiguous. The `price` block is the shape the live API
   serves; the OpenAPI file documents an older one, hence the fallback path. */
const EXCHANGE_ROWS = [
  {
    id: 10, name: "Horned Scarab of Pandemonium", category: "scarab",
    price: { chaos: 111, divine: 111 / EXCHANGE, method: "volumeWeightedMean", lowConfidence: false },
    chaos: { value: 111, chaosValue: 111, divineValue: 111 / EXCHANGE, volume24H: 380000, change24H: 4.5, lowConfidence: false },
  },
  {
    id: 5, name: "Orb of Intention", category: "currency",
    price: { chaos: 340, divine: 340 / EXCHANGE, method: "volumeWeightedMean", lowConfidence: false },
    chaos: { value: 340, chaosValue: 340, divineValue: 340 / EXCHANGE, volume24H: 90000, change24H: -2, lowConfidence: false },
  },
  // Thin and untraded: must NOT override anything, or a dead pair silently
  // reprices an item the listing data knows better.
  {
    id: 99, name: "Abrasive Catalyst", category: "currency",
    price: { chaos: 9999, divine: 45, lowConfidence: true },
    chaos: { value: 9999, chaosValue: 9999, divineValue: 45, volume24H: 0, change24H: 0, lowConfidence: true },
  },
  // Older documented shape, no `price` block — the reader must still cope.
  {
    id: 11, name: "Divination Scarab of Pilfering", category: "scarab",
    chaos: { value: 25, chaosValue: 25, divineValue: 25 / EXCHANGE, volume24H: 5000, change24H: 1, lowConfidence: false },
    divine: { value: 25 / EXCHANGE, lowConfidence: false },
  },
];

/* How poe.watch renames categories between the query and the response. */
const DISPLAY_CATEGORY = {
  flask: "flasks", armour: "armours", weapon: "weapons", jewel: "jewels", gem: "gems",
  currency: "currency", scarab: "scarab", fossil: "fossil", resonator: "resonator",
};

let watchDown = process.env.WATCH_DOWN === "1";
let compactDown = false;
const hits = [];

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  hits.push(u.host + u.pathname);

  if (u.host === "api.poe.watch") {
    if (watchDown) return new Response("down", { status: 503 });
    if (u.pathname === "/leagues") return J([{ name: "Allflame", start_date: "2026-07-24T20:00:00Z" }]);
    if (u.pathname === "/status") return J({ changeID: "1-2-3-4-5", requestedStashes: 100, computedStashes: 99 });
    if (u.pathname === "/compact") {
      if (compactDown) return new Response("nope", { status: 500 });
      // One flat array, every row tagged with its category. Crucially the tag
      // is the DISPLAY name, not the query name — `flask` comes back `flasks`,
      // `currency` can come back `catalysts` — which is precisely what an
      // allow-list of query names silently threw away.
      const items = [];
      for (const [cat, rows] of Object.entries(WATCH)) {
        for (const r of rows) items.push({ ...r, category: DISPLAY_CATEGORY[cat] || cat });
      }
      return J({ items });
    }
    if (u.pathname === "/exchange/ratios") return J({ items: EXCHANGE_ROWS });
    if (u.pathname === "/get") {
      const cat = u.searchParams.get("category");
      return J(WATCH[cat] || []);
    }
    return NOPE();
  }

  const type = u.searchParams.get("type");
  if (u.pathname.startsWith("/api/data/")) return NOPE();
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: "2026-07-24T20:00:00Z" }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    const lines = NINJA_EXCHANGE[type];
    return J({ core: CORE, lines: (lines || []).map(([id, v]) => ({ id, primaryValue: v, sparkline: { data: [1, 2, 3] } })) });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/item/overview") return J({ lines: [] });
  if (u.pathname === "/poe1/api/economy/stash/current/currency/overview") {
    // The exchange knows this one only as the slug "awakeners-orb", which
    // loses the apostrophe; the stash currency list is where the real spelling
    // comes from. Keeping it here exercises the name dictionary as well as the
    // gap-fill, both of which still matter under poe.watch.
    return J({ lines: [{ currencyTypeName: "Awakener's Orb", chaosEquivalent: 999 }] });
  }
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
await import("../../poe1/fetch-data.mjs");

await (async () => {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(OUT_DIR, "index.json"), "utf8"); return; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error("snapshot did not finish within 120s");
    await new Promise((r) => setTimeout(r, 200));
  }
})();

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

const priced = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "prices.json"), "utf8"));
const P = priced.prices;

/* ---- the divine rate ----
   The rate is the currency exchange one, recovered from mean/divine on every
   row. Divine Orb's own item listing is thin and reads ~50c lower; taking it
   would misprice every divine figure on the site by a quarter. */
ok(near(priced.divineRate, EXCHANGE, 1),
   `rate must come from the exchange ratio (${EXCHANGE}), not the Divine Orb listing (${LISTING}): ${priced.divineRate}`);
ok(!near(priced.divineRate, LISTING, 5), "the thin Divine Orb listing must not set the rate");

/* ---- trust prior plus evidence-aware selection ---- */
ok(near(P["Orb of Intention"]?.c, 26.4),
   `poe.ninja must beat poe.watch where both know an item, even poe.watch's traded 340: ${P["Orb of Intention"]?.c}`);
// The disagreement is reported in the hourly log and nowhere else: poe.ninja
// is used either way, so there is no decision for the reader to make.
ok(P["Orb of Intention"]?.alt === undefined && P["Orb of Intention"]?.volatile === undefined,
   `feed comparison must not reach prices.json: ${JSON.stringify(P["Orb of Intention"])}`);
ok(P["Orb of Intention"]?.source === undefined, "a poe.ninja price carries no source badge");
ok(near(P["Horned Scarab of Pandemonium"]?.c, 111),
   `the deeper nearby poe.watch scarab market wins on evidence: ${P["Horned Scarab of Pandemonium"]?.c}`);
ok(P["Horned Scarab of Pandemonium"]?.source === "poe.watch",
   "an evidence-selected lower-trust source remains explicitly badged");
ok(near(P["Awakener's Orb"]?.c, 210),
   `poe.ninja prices what poe.watch lacks: ${P["Awakener's Orb"]?.c}`);
ok(P["Awakener's Orb"]?.c !== 999, "stash currency stays gap-fill only and must not outrank the exchange");
ok(near(P["Reverent Fragment"]?.c, 79), `ninja-only fragment survived: ${P["Reverent Fragment"]?.c}`);
// The half poe.ninja does not carry at all — this is what poe.watch is for.
ok(near(P["Cinderswallow Urn"]?.c, 120), `poe.watch fills what poe.ninja lacks: ${P["Cinderswallow Urn"]?.c}`);
ok(P["Cinderswallow Urn"]?.source === "poe.watch", "and says so, so the line can be badged");
ok(P["Unidentified Cinderswallow Urn"]?.source === "poe.watch", "the unidentified markets likewise");

/* ---- listing counts ride along on a poe.watch entry, so a thin price can be
        flagged. A poe.ninja entry carries no listing count to keep. ---- */
ok(P["Cinderswallow Urn"]?.daily === 6623, `daily listing count kept: ${JSON.stringify(P["Cinderswallow Urn"])}`);
ok(P["Exalted Orb"]?.thin === true, "a low-confidence poe.watch price is marked thin");
ok(P["Unidentified Cinderswallow Urn"]?.thin === undefined, "a liquid price is not marked thin");

/* ---- categories renamed between request and response ----
   Every one of these rows arrives under a plural or renamed category. An
   allow-list keyed on the query name dropped all of them, and because the
   remaining 2,600 names still looked like a healthy price map, nothing
   failed — the boss tab just quietly stopped pricing every unique in the
   game. This is the assertion that would have caught it. */
for (const [name, cat] of [
  ["Cinderswallow Urn", "flasks"],
  ["Unidentified Cinderswallow Urn", "flasks"],
  ["Shaper's Touch", "armours"],
  ["Pacifism Support", "gems"],
]) {
  ok(P[name]?.c > 0, `${name} arrives tagged "${cat}" and must still be priced: ${JSON.stringify(P[name])}`);
}

/* ---- base variants ----
   Bosses drop gems at level 1, zero quality, uncorrupted. That exact form is
   the only acceptable price for a gem; anything else is a gem someone levelled
   after it dropped. */
ok(near(P["Pacifism Support"]?.c, 1050),
   `the level-1 gem is the drop, not the corrupted 21/20: ${P["Pacifism Support"]?.c}`);
ok(P["Enhance Support"] === undefined,
   `a gem with no level-1 form must have NO price rather than borrowing a levelled one: ${JSON.stringify(P["Enhance Support"])}`);
ok(near(P["Shaper's Touch"]?.c, 12), `the unlinked item is the drop, not the 6L: ${P["Shaper's Touch"]?.c}`);

/* ---- unidentified ---- */
ok(near(P["Unidentified Cinderswallow Urn"]?.c, 840), "the unidentified item uses its current listing floor");
ok(near(P["Cinderswallow Urn"]?.c, 120), "and does not overwrite the identified one");
ok(near(P["Unidentified Watcher's Eye 85"]?.c, 120), "the Elder Watcher's Eye keeps its ilvl 85 market");
ok(near(P["Unidentified Watcher's Eye 86+"]?.c, 460), "the Uber Elder Watcher's Eye keeps its ilvl 86+ market");
ok(near(P["Unidentified Thread of Hope (ilvl 86)"]?.c, 300), "normal Sirus gets an ilvl 86 Thread of Hope price");
ok(near(P["Unidentified Thread of Hope (ilvl 87)"]?.c, 13), "Uber Sirus gets an ilvl 87 Thread of Hope price");
ok(near(P["Unidentified Forbidden Flame (ilvl 86)"]?.c, 2638), "normal Exarch gets an ilvl 86 Forbidden Flame price");
ok(near(P["Unidentified Forbidden Flame (ilvl 87)"]?.c, 2400), "Uber Exarch gets an ilvl 87 Forbidden Flame price");
ok(near(P["Unidentified Forbidden Flesh (ilvl 86)"]?.c, 1800), "normal Eater gets an ilvl 86 Forbidden Flesh price");
ok(near(P["Unidentified Forbidden Flesh (ilvl 87)"]?.c, 2650), "Uber Eater gets an ilvl 87 Forbidden Flesh price");
{
  const { makeResolver, isUnidentified } = await import("../../../src/games/poe1/features/bosses/bossProfit.js");
  const r = makeResolver(P);
  ok(near(r("Cinderswallow Urn", [], null, "Life", isUnidentified({ item: "Cinderswallow Urn", unidentified: true })).chaos, 840),
     "a veiled drop line resolves to the unidentified price");
  ok(near(r("Cinderswallow Urn", [], null, "Life", isUnidentified({ label: "Veiled Cinderswallow Urn (Life)" })).chaos, 840),
     "…and still does when the word is in the name rather than the flag");
  ok(near(r("Cinderswallow Urn", [], null, null, false).chaos, 120),
     "a plain line still gets the identified price");
  ok(near(r("Watcher's Eye", ["Unidentified Watcher's Eye 85"], null, null, true).chaos, 120),
     "an exact unidentified item-level alias wins before the 1c identified item");
}

/* ---- every tab ---- */
// The category tabs follow the same order: poe.ninja's exchange answers, so
// poe.watch is not consulted for them at all.
const scarabs = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), "utf8"));
ok(near(scarabs.items.find((i) => /Pandemonium/.test(i.name))?.chaosValue, 80),
   `scarab tab must read poe.ninja (80), not poe.watch: ${scarabs.items.find((i) => /Pandemonium/.test(i.name))?.chaosValue}`);
// The rate is a poe.watch figure regardless — poe.ninja's exchange does not
// publish a divine ratio, and the thin Divine Orb listing is not one.
ok(near(scarabs.divineRate, EXCHANGE, 1), `scarab tab divine rate: ${scarabs.divineRate}`);
for (const [file, name, value] of [
  ["astrolabes", "Deceptive Astrolabe", 88],
  ["catalysts", "Abrasive Catalyst", 6],
  ["fossils", "Hollow Fossil", 11],
  ["resonators", "Prime Chaotic Resonator", 8],
]) {
  const j = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", `${file}.json`), "utf8"));
  ok(near(j.items.find((i) => i.name === name)?.chaosValue, value), `${file} tab reads poe.ninja: ${JSON.stringify(j.items[0])}`);
}

/* A category regex must not reach across categories — /catalyst/i and
   /astrolabe/i both run over the currency rows, and only their own rows. */
{
  const cat = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "catalysts.json"), "utf8"));
  ok(!cat.items.some((i) => /Astrolabe|Orb/.test(i.name)), `catalyst tab pulled in neighbours: ${cat.items.map((i) => i.name).join(", ")}`);
}

/* ---- endpoints ---- */
ok(hits.some((h) => h === "api.poe.watch/leagues"), "poe.watch leagues must be consulted");
ok(hits.some((h) => h === "api.poe.watch/compact"), "/compact must be used");
ok(hits.some((h) => h === "api.poe.watch/exchange/ratios"), "/exchange/ratios must be used");
ok(hits.filter((h) => h === "api.poe.watch/get").length === 0,
   `/compact answered, so the 22 per-category calls must not fire: ${hits.filter((h) => h === "api.poe.watch/get").length} did`);

/* ---- poe.watch's own exchange beats poe.watch's own listings ----
   Checked against the module rather than the snapshot: poe.ninja outranks all
   of poe.watch now, so end to end none of these figures reach prices.json.
   The rule still decides every price poe.watch does supply — anything
   poe.ninja is missing or down for — so it stays covered here. */
{
  const rows = WATCH.scarab.concat(WATCH.currency).map(normaliseRow);
  const ex = EXCHANGE_ROWS.map(normaliseExchange).filter(Boolean);
  const w = watchPriceMap(rows, ex);
  ok(near(w["Horned Scarab of Pandemonium"]?.c, 111),
     `traded price (111) must beat the listing mean (95): ${w["Horned Scarab of Pandemonium"]?.c}`);
  ok(w["Horned Scarab of Pandemonium"]?.exchange === true, "and be marked as an exchange price");
  ok(w["Horned Scarab of Pandemonium"]?.volume24H === 380000, "with real 24h volume attached");
  ok(near(w["Orb of Intention"]?.c, 340), `exchange price beats the listing mean: ${w["Orb of Intention"]?.c}`);
  ok(near(w["Divination Scarab of Pilfering"]?.c, 25),
     `the older exchange shape without a price block must still be read: ${w["Divination Scarab of Pilfering"]?.c}`);
  ok(near(w["Abrasive Catalyst"]?.c, 7),
     `a low-confidence, zero-volume pair must NOT override the listing mean: ${w["Abrasive Catalyst"]?.c}`);

  // And a poe.watch-sourced category tab still takes the traded price and
  // seeds its movement badge from it.
  const cat = watchCategoryItems(rows.map((r) => ({ ...r, category: "scarab" })), /scarab/i, EXCHANGE, ["scarab"], ex);
  const row = cat.find((i) => /Pandemonium/.test(i.name));
  ok(near(row?.chaosValue, 111), `poe.watch category items use the traded price: ${row?.chaosValue}`);
  ok(row?.change24 === 4.5, `and seed the change badge from the exchange: ${row?.change24}`);
}

/* ---- /compact unavailable ----
   Checked at the module level rather than through another full snapshot: the
   question is only whether the per-category path takes over, and a whole extra
   run to answer it would double the suite's runtime. */
{
  compactDown = true;
  const before = hits.filter((h) => h === "api.poe.watch/get").length;
  const { fetchWatchLeague } = await import("../../poe1/sources/poewatch.mjs");
  const r = await fetchWatchLeague("Allflame", { delayMs: 0 });
  ok(r && r.source === "per-category", `with /compact down the per-category path must take over: ${r?.source}`);
  ok(hits.filter((h) => h === "api.poe.watch/get").length > before, "and it must actually issue those calls");
  ok(near(r?.prices?.["Horned Scarab of Pandemonium"]?.c, 111), "with the exchange still applied on top");
  ok(near(r?.rate, EXCHANGE, 1), `and the rate unchanged: ${r?.rate}`);
  compactDown = false;
}

/* ---- poe.watch down ----
   Re-runs the whole snapshot against a 503ing poe.watch. The point is not that
   it survives but that it degrades to exactly what the site had before: this
   is the difference between "prices look stale" and "the boss tab is empty". */
{
  watchDown = true;
  const DIR2 = await mkdtemp(path.join(tmpdir(), "sl-watch-down-"));
  process.env.DATA_OUT = DIR2;
  const fresh = await import(`../../poe1/fetch-data.mjs?down=${Date.now()}`);
  void fresh;
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { await readFile(path.join(DIR2, "index.json"), "utf8"); break; } catch { /* not yet */ }
    if (Date.now() > deadline) { ok(false, "fallback run did not finish"); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    const p2 = JSON.parse(await readFile(path.join(DIR2, "Allflame", "prices.json"), "utf8"));
    ok(near(p2.prices["Orb of Intention"]?.c, 26.4),
       `poe.ninja prices this either way: ${p2.prices["Orb of Intention"]?.c}`);
    ok(p2.prices["Orb of Intention"]?.source === undefined,
       "and with poe.watch down nothing is badged as coming from it");
    ok(near(p2.divineRate, LISTING, 1), `with poe.watch down the rate falls back to poe.ninja: ${p2.divineRate}`);
    ok(p2.prices["Unidentified Cinderswallow Urn"] === undefined,
       "and poe.watch-only items are simply absent, not zero-priced");
    const s2 = JSON.parse(await readFile(path.join(DIR2, "Allflame", "scarabs.json"), "utf8"));
    ok(s2.items.length > 0, "the scarab tab still has data from poe.ninja alone");
  } catch (e) {
    ok(false, `fallback run produced nothing usable: ${e.message}`);
  }
  await rm(DIR2, { recursive: true, force: true });
}

/* ---- dead listings must not price an item ---- */
{
  const row = (over) => normaliseRow({
    id: 1, name: "Unidentified Glorious Vanity", category: "jewels", frame: 3,
    mean: 0, min: 0, max: 0, daily: 0, lowConfidence: false, ...over,
  });
  const map = watchPriceMap([
    row({ mean: 2398.68, min: 2266.95, max: 2500, daily: 1 }),
    row({ mean: 63830325, min: 61506113, max: 63830325, daily: 0 }),
  ]);
  ok(map["Unidentified Glorious Vanity"].c === 2266.95,
     `a zero-trade ask must not price the item: got ${map["Unidentified Glorious Vanity"].c}`);
  ok(map["Unidentified Glorious Vanity"].hi === 2500,
     "and the untraded row must not stretch the range either");

  // Volume disqualifies a row only for being dear. An untraded row that
  // undercuts everything that moved is a listing you could still have bought,
  // and dropping it would only push the quote up.
  const cheapSilent = watchPriceMap([
    row({ mean: 2398.68, min: 2266.95, max: 2500, daily: 1 }),
    row({ mean: 900, min: 800, max: 1000, daily: 0 }),
  ]);
  ok(cheapSilent["Unidentified Glorious Vanity"].c === 800,
     `a cheap untraded row still prices the item: got ${cheapSilent["Unidentified Glorious Vanity"].c}`);

  // Nothing traded at all: a thin price still beats no price.
  const quiet = watchPriceMap([row({ mean: 900, min: 800, max: 1000, daily: 0 })]);
  ok(quiet["Unidentified Glorious Vanity"].c === 800, "an all-untraded name keeps its floor");

  // Two real markets under one name both survive; this is not an outlier filter.
  const both = watchPriceMap([
    row({ name: "Unidentified Forbidden Flame", mean: 5596.92, min: 5289.55, max: 5600, daily: 39 }),
    row({ name: "Unidentified Forbidden Flame", mean: 30383.28, min: 28714.7, max: 30400, daily: 5 }),
  ]);
  ok(both["Unidentified Forbidden Flame"].n === 2, "both traded rows are kept");
  ok(both["Unidentified Forbidden Flame"].hi === 30400, "including the dear one");
}

/* ---- corrupted rows are never the drop ---- */
{
  const base = (over) => normaliseRow({
    id: 1, name: "Cinderswallow Urn", category: "flasks", frame: 3,
    mean: 100, min: 90, max: 110, daily: 50, lowConfidence: false, ...over,
  });
  ok(isWatchBaseVariant(base({})) === true, "a plain unique row is the drop");
  ok(isWatchBaseVariant(base({ gemIsCorrupted: true })) === false,
     "a corrupted row is a different item — it can no longer be modified, and its price says so");
  ok(isWatchBaseVariant(base({ gemLevel: 1, gemQuality: 0, gemIsCorrupted: false })) === true,
     "a level 1, zero quality, uncorrupted gem is still the drop");
  ok(isWatchBaseVariant(base({ gemLevel: 1, gemQuality: 0, gemIsCorrupted: true })) === false,
     "a corrupted level 1 gem is not");

  // gemIsCorrupted is the only corruption flag ItemData carries, and the docs
  // scope it to gems, so a corrupted unique cannot be told apart at row level.
  // The unidentified-first rule is what keeps those out of a boss quote.
}

/* ---- beta active price ---- */
{
  ok(betaUrl(57995, "Allflame")
     === "https://poe.watch/detailed/57995/beta?league=Allflame&merchant=all&corrupted=any&scale=linear",
     `beta url: ${betaUrl(57995, "Allflame")}`);
  ok(betaUrl(1, "Hardcore Allflame").includes("league=Hardcore%20Allflame"), "league names are encoded");

  // The Untouched Soul, live: a 20c floor and a 50c mean against a 9c active
  // price. The active price is what is clearing, so it is the one to take.
  const live = adaptBeta({ betaPricing: {
    activePrice: 9, liveMean: 50, livePriceMedian: 120, liveConfidence: "medium",
    liveSampleCount: 396, liveLowConfidence: false,
    livePriceAsOf: "2026-08-09T20:06:57.764464Z", liveCalculatorVersion: "merchant-bands-v10",
  } });
  ok(live.c === 9, `active price ${live.c}`);
  ok(live.confidence === "medium" && live.samples === 396, "confidence and sample count ride along");

  // Anything without a usable price leaves the listing figure alone.
  ok(adaptBeta({ betaPricing: { activePrice: 0 } }) === null, "a zero active price is not a price");
  ok(adaptBeta({ betaPricing: {} }) === null && adaptBeta({}) === null && adaptBeta(null) === null,
     "a missing panel is not fatal");
}


console.log(`\nprice map: ${Object.keys(P).length} names, divine ${priced.divineRate}c`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
