/* Regression test for the snapshot script's endpoint handling.

   Two things have bitten this script before:

   1. poe.ninja moves PoE 1 economy data between endpoint families. Fragments
      and astrolabes live under exchange/current/overview; reading them from
      anywhere else gives wrong numbers or nothing at all.
   2. The exchange endpoint quotes `primaryValue` in a *primary reference
      currency* that is not necessarily chaos. Guessing the conversion
      direction scales every bulk item by the chaos:primary ratio — which is
      exactly how Reverent Fragment ended up at 7.5c instead of 79c.
   3. Coverage. The docs enumerate exactly which `type` values the exchange
      accepts for PoE 1, and DivinationCard is one of them — omitting it there
      is why cards went unpriced. The stash currency overview covers the same
      goods the older way and is kept only to fill names the exchange misses.

   So this stub deliberately uses a NON-chaos primary (Exalted Orb, with chaos
   at 0.1 exalted), makes every legacy /api/data/* path 404, and runs the real
   script end to end. If the calibration regresses, the numbers below move.

   Run: node scripts/test-fetch-shapes.mjs
*/

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CATEGORIES } from "../../../src/games/poe1/catalogue/categories.js";

const OUT_DIR = await mkdtemp(path.join(tmpdir(), "sl-fetch-test-"));
const hits = [];
const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const NOPE = () => new Response("gone", { status: 404 });

/* chaos costs 0.1 exalted -> divisor 0.1 -> every quote is x10 to reach chaos */
const CHAOS_IN_PRIMARY = 0.1;
const CORE = {
  primary: "exalted-orb",
  secondary: "divine-orb",
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

/* Names for these come from the line id slug, not core.items — that path
   needs covering too, since it is how every fragment and scarab is named. */
const EXCHANGE_DATA = {
  // Same names as the stash currency overview but different numbers: the
  // direct-chaos source must win, and exchange-only names must still land.
  Currency: [["chaos-orb", CHAOS_IN_PRIMARY], ["divine-orb", 130], ["awakeners-orb", 21],
             ["orb-of-intention", 26.4], ["orb-of-remembrance", 6.3],
             // The gem tab prices its input and its orb out of these two.
             ["gemcutter-s-prism", 0.3], ["vaal-orb", 0.5]],
  Fragment: [["reverent-fragment", 7.9], ["lonely-fragment", 5.0], ["traumatic-fragment", 1.86],
             ["cosmic-fragment", 7.43], ["the-maven-s-writ", 0.852]],
  DivinationCard: [["a-fate-worse-than-death", 0.8]],
  Astrolabe: [["templar-astrolabe", 7.7], ["grasping-astrolabe", 8.63], ["fruiting-astrolabe", 14.7]],
  Scarab: [["divination-scarab-of-pilfering", 18.0], ["horned-scarab-of-pandemonium", 95.0]],
  Omen: [["omen-of-amelioration", 4.2]],
  // The Delve tab writes its own fossils.json/resonators.json AND leans on
  // these names being in the broad price map, so both paths are exercised.
  Fossil: [["hollow-fossil", 13.0], ["aberrant-fossil", 0.09], ["frigid-fossil", 0.11]],
  Resonator: [["prime-chaotic-resonator", 9.6], ["primitive-alchemical-resonator", 0.02]],
};

const STASH_ITEMS = {
  UniqueWeapon: [
    { id: 1, name: "Starforge", chaosValue: 4200, links: 0 },
    { id: 2, name: "Starforge", chaosValue: 5100, links: 6 },
  ],
  UniqueArmour: [
    { id: 4, name: "Shaper's Touch", chaosValue: 12, links: 0 },
    // Every listing is a roll variant, and they run three orders apart. A drop
    // is a random roll, so the floor is what a random one is worth — the median
    // (40) reads as if half of them hit the good bases.
    { id: 5, name: "Atziri's Splendour", chaosValue: 8, variant: "Armour" },
    { id: 6, name: "Atziri's Splendour", chaosValue: 40, variant: "Armour/ES" },
    { id: 7, name: "Atziri's Splendour", chaosValue: 900, variant: "ES/Eva" },
    // Catarina's pool names WHICH veiled roll each line is, so these have to
    // survive into prices.json individually — collapsing them to the floor is
    // what made a 900c veiled flask read as a 12c one.
    { id: 8, name: "Cinderswallow Urn", chaosValue: 12, variant: "Life" },
    { id: 9, name: "Cinderswallow Urn", chaosValue: 40, variant: "Mana" },
    { id: 10, name: "Cinderswallow Urn", chaosValue: 900, variant: "Energy Shield" },
  ],
  SkillGem: [
    { id: 11, name: "Awakened Spell Echo Support", chaosValue: 700, gemLevel: 1, gemQuality: 0, corrupted: false },
    { id: 12, name: "Awakened Spell Echo Support", chaosValue: 9000, gemLevel: 5, gemQuality: 20, corrupted: true },
    // The Pacifism case: bosses drop a level-1, 0% quality, uncorrupted gem.
    // The corrupted 21/20 copy is worth hundreds of times that and must never
    // reach hi, or "Best roll" quotes a drop nobody ever gets.
    { id: 13, name: "Pacifism Support", chaosValue: 1050, gemLevel: 1, gemQuality: 0, corrupted: false },
    { id: 14, name: "Pacifism Support", chaosValue: 626600, gemLevel: 21, gemQuality: 20, corrupted: true },
    /* A full levelling ladder for the gem tab: base, quality base, the target
       at the cap, and the corruption outcomes with their listing counts. The
       alternate-quality row must be dropped — a Divergent gem cannot be
       Gemcuttered out of a Superior one, so it is a different trade. */
    { id: 40, name: "Cyclone", variant: "1", chaosValue: 10, gemLevel: 1, gemQuality: 0, corrupted: false, listingCount: 400, sparkline: { data: [0, 2, 5] } },
    { id: 41, name: "Cyclone", variant: "1/20", chaosValue: 60, gemLevel: 1, gemQuality: 20, corrupted: false, listingCount: 120 },
    { id: 42, name: "Cyclone", variant: "20/20", chaosValue: 100, gemLevel: 20, gemQuality: 20, corrupted: false, listingCount: 90, sparkline: { data: [0, 4, 9] } },
    { id: 43, name: "Cyclone", variant: "21/20c", chaosValue: 1000, gemLevel: 21, gemQuality: 20, corrupted: true, listingCount: 12 },
    { id: 44, name: "Cyclone", variant: "20/20 Divergent", chaosValue: 5000, gemLevel: 20, gemQuality: 20, corrupted: false, listingCount: 3 },
    { id: 45, name: "Vaal Cyclone", variant: "20/20c", chaosValue: 200, gemLevel: 20, gemQuality: 20, corrupted: true, listingCount: 25 },
  ],
  // poe.ninja lists one "Nightmare Map" line for all five tier 17s
  Map: [{ id: 20, name: "Nightmare Map", chaosValue: 32 }],
  // Boss entry costs — these were unpriced because the type was never fetched
  Invitation: [
    { id: 30, name: "Polaric Invitation", chaosValue: 21.7 },
    { id: 31, name: "Writhing Invitation", chaosValue: 5 },
    { id: 32, name: "Incandescent Invitation", chaosValue: 103 },
    { id: 33, name: "Screaming Invitation", chaosValue: 106 },
  ],
};

/* poe.watch is the fallback, so what matters here is what it must NOT do.
   Every row below except the Watcher's Eye names an item poe.ninja also
   prices, at a deliberately different number: none of those numbers may reach
   prices.json. The unidentified market is poe.watch's alone — poe.ninja has no
   such rows — and it must survive, because the boss tab prices drops off it. */
const WATCH_ROWS = [
  { id: 900, category: "weapon", name: "Starforge", mean: 900, min: 900, max: 900, daily: 5, linkCount: 0 },
  { id: 901, category: "fragment", name: "Reverent Fragment", mean: 777, min: 777, max: 777, daily: 9 },
  { id: 902, category: "flask", name: "Cinderswallow Urn", mean: 777, min: 777, max: 777, daily: 3 },
  { id: 903, category: "scarab", name: "Divination Scarab of Pilfering", mean: 777, min: 777, max: 777, daily: 40 },
  { id: 904, category: "jewel", name: "Unidentified Watcher's Eye 86+", mean: 500, min: 480, max: 900, daily: 4 },
  { id: 905, category: "currency", name: "Divine Orb", mean: 1300, min: 1300, max: 1300, daily: 99 },
];

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const type = u.searchParams.get("type");
  if (u.hostname === "api.poe.watch") {
    if (u.pathname === "/leagues") return J([{ name: "Allflame" }]);
    if (u.pathname === "/compact") return J({ items: WATCH_ROWS });
    if (u.pathname === "/exchange/ratios") return J({ items: [] });
    if (u.pathname === "/status") return J({ changeID: "1", requestedStashes: 1, computedStashes: 1 });
    return NOPE();
  }
  if (u.hostname === "poe.watch") return NOPE();          // the active-price page
  hits.push(`${u.pathname}${type ? "?type=" + type : ""}`);
  if (u.pathname.startsWith("/api/data/")) return NOPE();                    // legacy is dead
  if (u.pathname === "/poe1/api/economy/leagues") return J([{ id: "Allflame", name: "Allflame", startAt: "2026-07-24T20:00:00Z" }]);
  if (u.pathname === "/poe1/api/data/index-state") return J({ economyLeagues: [], oldEconomyLeagues: [] });
  if (u.pathname === "/poe1/api/economy/exchange/current/overview") {
    return EXCHANGE_DATA[type] ? exchange(EXCHANGE_DATA[type]) : J({ core: CORE, lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/item/overview") {
    return STASH_ITEMS[type] ? J({ lines: STASH_ITEMS[type] }) : J({ lines: [] });
  }
  if (u.pathname === "/poe1/api/economy/stash/current/currency/overview") {
    // The site's Currency and Fragment tabs: full list, already in chaos.
    // Note Orb of Intention and the curio appear ONLY here, never in the
    // exchange — that is the case that used to go unpriced.
    // Same goods, priced the older way. 999 marks names the exchange also
    // carries — those must lose. Echo of Trauma and Curio of Potential appear
    // only here, so they must still land.
    if (type === "Fragment") return J({ lines: [
      { currencyTypeName: "Reverent Fragment", chaosEquivalent: 999 },
      { currencyTypeName: "Echo of Trauma", chaosEquivalent: 126 },
    ] });
    return J({ lines: [
      { currencyTypeName: "Chaos Orb", chaosEquivalent: 999 },
      { currencyTypeName: "Orb of Intention", chaosEquivalent: 999 },
      // Also the dictionary's only source of the real apostrophe spelling —
      // the exchange knows this one as the slug "awakeners-orb".
      { currencyTypeName: "Awakener's Orb", chaosEquivalent: 999 },
      { currencyTypeName: "Curio of Potential", chaosEquivalent: 8 },
    ] });
  }
  return NOPE();
};

process.env.DATA_OUT = OUT_DIR;
const fetchModule = await import("../../poe1/fetch-data.mjs");

/* fetch-data.mjs kicks off main() without awaiting it, so importing the
   module returns long before the snapshot is on disk. index.json is written
   last — poll for it. */
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
const near = (a, b, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

const priced = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "prices.json"), "utf8"));
const P = priced.prices;

// The headline bug: a fragment quoted at 7.9 in a primary worth 10 chaos is
// 79c, not 7.9c and not 0.79c.
// The exchange is the source of record for everything fungible, converted
// through the chaos calibration.
ok(near(P["Reverent Fragment"]?.c, 79), `Reverent Fragment ${P["Reverent Fragment"]?.c} != 79`);
ok(near(P["Lonely Fragment"]?.c, 50), `Lonely Fragment ${P["Lonely Fragment"]?.c} != 50`);
ok(near(P["Traumatic Fragment"]?.c, 18.6), `Traumatic Fragment ${P["Traumatic Fragment"]?.c} != 18.6`);
ok(near(P["Cosmic Fragment"]?.c, 74.3), `Cosmic Fragment ${P["Cosmic Fragment"]?.c} != 74.3`);
ok(near(P["The Maven's Writ"]?.c, 8.52), `The Maven's Writ ${P["The Maven's Writ"]?.c} != 8.52`);
ok(near(P["Awakener's Orb"]?.c, 210), `Awakener's Orb ${P["Awakener's Orb"]?.c} != 210`);
ok(near(P["Divine Orb"]?.c, 1300), `Divine Orb ${P["Divine Orb"]?.c} != 1300`);
ok(near(P["Orb of Intention"]?.c, 264), `Orb of Intention ${P["Orb of Intention"]?.c} != 264`);
ok(near(P["Orb of Remembrance"]?.c, 63), `Orb of Remembrance ${P["Orb of Remembrance"]?.c} != 63`);

// DivinationCard is a documented exchange type — leaving it out is what made
// cards read as unpriced.
ok(near(P["A Fate Worse Than Death"]?.c, 8), `div card ${P["A Fate Worse Than Death"]?.c} != 8`);

// Invitations are the entry cost for four bosses and live under the stash
// item overview, which the type list used to omit entirely.
for (const [n, v] of [["Polaric Invitation", 21.7], ["Writhing Invitation", 5],
                      ["Incandescent Invitation", 103], ["Screaming Invitation", 106]]) {
  ok(near(P[n]?.c, v), `${n} ${P[n]?.c} != ${v}`);
}

// Stash currency only fills gaps; it must never overwrite the exchange.
ok(near(P["Curio of Potential"]?.c, 8), `Curio of Potential ${P["Curio of Potential"]?.c} != 8 (gap-fill failed)`);
ok(near(P["Echo of Trauma"]?.c, 126), `Echo of Trauma ${P["Echo of Trauma"]?.c} != 126 (gap-fill failed)`);
const sentinels = Object.entries(P).filter(([, v]) => v.c === 999).map(([k]) => k);
ok(sentinels.length === 0, `stash currency overwrote exchange prices for: ${sentinels.join(", ")}`);

// Astrolabes must be in the price map at all — they were absent entirely.
ok(near(P["Templar Astrolabe"]?.c, 77), `Templar Astrolabe ${P["Templar Astrolabe"]?.c} != 77`);
ok(near(P["Fruiting Astrolabe"]?.c, 147), `Fruiting Astrolabe ${P["Fruiting Astrolabe"]?.c} != 147`);

// Fossils and resonators feed the Delve tab; a name that stops resolving
// takes a biome average down with it silently.
ok(near(P["Hollow Fossil"]?.c, 130), `Hollow Fossil ${P["Hollow Fossil"]?.c} != 130`);
ok(near(P["Prime Chaotic Resonator"]?.c, 96), `Prime Chaotic Resonator ${P["Prime Chaotic Resonator"]?.c} != 96`);

// chaos is the unit, so it must price at exactly 1
ok(near(P["Chaos Orb"]?.c, 1), `Chaos Orb ${P["Chaos Orb"]?.c} != 1`);
ok(near(P["Divine Orb"]?.c, 1300), `Divine Orb ${P["Divine Orb"]?.c} != 1300`);
ok(near(P["Awakener's Orb"]?.c, 210), `Awakener's Orb ${P["Awakener's Orb"]?.c} != 210`);
ok(near(P["Omen of Amelioration"]?.c, 42), `Omen ${P["Omen of Amelioration"]?.c} != 42`);

// stash items are already chaos and must NOT be divided
ok(near(P["Starforge"]?.c, 4200), `Starforge ${JSON.stringify(P["Starforge"])}`);

/* c / lo / hi must all describe the item as it DROPS. A corrupted 21/20 gem
   and a 6-linked unique are post-drop states, so they belong to none of the
   three — otherwise "Best roll" quotes a price the boss cannot pay out. */
for (const [n, v] of [["Pacifism Support", 1050], ["Awakened Spell Echo Support", 700], ["Starforge", 4200]]) {
  const p = P[n] || {};
  ok(near(p.lo, v) && near(p.c, v) && near(p.hi, v),
     `${n} should be ${v} on all three bases, got ${JSON.stringify(p)}`);
}
// ...but a unique whose listings are all genuine roll variants keeps its spread.
ok(near(P["Atziri's Splendour"]?.lo, 8) && near(P["Atziri's Splendour"]?.hi, 900),
   `roll-variant spread lost: ${JSON.stringify(P["Atziri's Splendour"])}`);
ok(near(P["Awakened Spell Echo Support"]?.c, 700), `gem base variant ${P["Awakened Spell Echo Support"]?.c}`);
/* ---- roll variants survive into the snapshot ---- */
{
  const cs = P["Cinderswallow Urn"] || {};
  ok(cs.v && Object.keys(cs.v).length === 3, `variant map missing: ${JSON.stringify(cs)}`);
  ok(near(cs.v?.Life, 12) && near(cs.v?.Mana, 40) && near(cs.v?.["Energy Shield"], 900),
     `variant prices wrong: ${JSON.stringify(cs.v)}`);
  ok(near(cs.c, 12), `name-wide price is still the floor: ${cs.c}`);
  // One variant is just the base price wearing a hat — not worth the bytes.
  ok(P["Shaper's Touch"]?.v === undefined, "single-listing item must not carry a variant map");
  ok(P["Starforge"]?.v === undefined, "links are not roll variants");
}

ok(near(P["Atziri's Splendour"]?.c, 8),
   `a roll-variant unique must quote its floor, not the median: ${JSON.stringify(P["Atziri's Splendour"])}`);
// The rule is specific to items whose listings are ALL roll variants. Where a
// base listing exists it still wins outright, floor or not.
ok(near(P["Starforge"]?.c, 4200), `base listing must win over the 6L: ${JSON.stringify(P["Starforge"])}`);
ok(near(P["Nightmare Map"]?.c, 32), `T17 map entry cost ${P["Nightmare Map"]?.c}`);

/* ---- source precedence: poe.ninja over poe.watch ---- */
// Every one of these is priced by both feeds. poe.watch's 777s and its 900c
// Starforge must lose outright — GGG first, then poe.ninja, then poe.watch.
const wsentinels = Object.entries(P).filter(([, v]) => v.c === 777).map(([k]) => k);
ok(wsentinels.length === 0, `poe.watch overwrote poe.ninja for: ${wsentinels.join(", ")}`);
ok(near(P["Starforge"]?.c, 4200), `poe.ninja must win Starforge, got ${P["Starforge"]?.c}`);
// The disagreement is a log line, not payload. Every name carrying `alt` and
// `spread` only inflated the file the browser downloads for no decision.
ok(P["Starforge"]?.alt === undefined && P["Starforge"]?.spread === undefined,
   `feed comparison must not reach prices.json: ${JSON.stringify(P["Starforge"])}`);
ok(P["Starforge"]?.volatile === undefined && P["Starforge"]?.contested === undefined,
   "and no price is flagged or rewritten after the fact");
// poe.watch still fills what poe.ninja does not carry — the unidentified
// markets are its alone, and the boss tab prices drops off them.
// Quoted at the floor, not the mean: an unidentified unique is an unopened
// gamble and 480 is what one costs today.
ok(near(P["Unidentified Watcher's Eye 86+"]?.c, 480),
   `poe.watch-only name lost: ${JSON.stringify(P["Unidentified Watcher's Eye 86+"])}`);
ok(P["Unidentified Watcher's Eye 86+"]?.wid === 904,
   "a poe.watch-won entry keeps its id, which is what the active-price pass looks up");
ok(P["Starforge"]?.wid === undefined,
   "a poe.ninja-won entry has no poe.watch id, so the active price never overrides it");
// The line says where it came from. `source` marks only the exception, so a
// poe.ninja price carries nothing.
ok(P["Unidentified Watcher's Eye 86+"]?.source === "poe.watch", "a fallback price is labelled");
ok(P["Starforge"]?.source === undefined, "a poe.ninja price is the norm and is not");
// Roll variants are poe.ninja's and are no longer grafted onto a poe.watch entry.
ok(near(P["Cinderswallow Urn"]?.c, 12) && Object.keys(P["Cinderswallow Urn"]?.v || {}).length === 3,
   `variant map must survive poe.watch knowing the name: ${JSON.stringify(P["Cinderswallow Urn"])}`);

// the scarab tab shares the calibration, so it must survive a non-chaos primary too
const scarabs = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "scarabs.json"), "utf8"));
const pilfering = scarabs.items.find((i) => /Pilfering/i.test(i.name));
ok(near(pilfering?.chaosValue, 180), `Divination Scarab of Pilfering ${pilfering?.chaosValue} != 180`);
ok(near(scarabs.divineRate, 1300, 1), `scarab divineRate ${scarabs.divineRate} != 1300`);

const astro = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "astrolabes.json"), "utf8"));
ok(near(astro.items.find((i) => /Templar/.test(i.name))?.chaosValue, 77), "astrolabe tab conversion");

/* The gem tab is fed by one request that keeps every variant. What matters
   here is that the variants survive individually with their listing counts,
   that alternate quality does not, and that the two currency prices the model
   spends came out of the same snapshot. */
const gemFile = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "gems.json"), "utf8"));
const cyclone = gemFile.gems.find((g) => g.name === "Cyclone");
ok(!!cyclone, "Cyclone must be in gems.json");
const gv = (l, q, c) => cyclone?.variants.find((v) => v.l === l && v.q === q && !!v.c === c);
ok(near(gv(20, 20, false)?.v, 100) && gv(20, 20, false)?.n === 90, `20/20 kept with its listing count: ${JSON.stringify(gv(20, 20, false))}`);
ok(near(gv(21, 20, true)?.v, 1000) && gv(21, 20, true)?.n === 12, `21/20c kept with its listing count: ${JSON.stringify(gv(21, 20, true))}`);
ok(near(gv(1, 20, false)?.v, 60), "the 1/20 input must survive as its own variant");
ok(cyclone?.variants.length === 4, `alternate quality must be dropped, got ${cyclone?.variants.length} variants`);
ok(!!gemFile.gems.find((g) => g.name === "Vaal Cyclone"), "the Vaal version has to be priceable as an outcome");
ok(near(gemFile.gcp, 3) && near(gemFile.vaalOrb, 5), `gem snapshot records its currency prices: gcp ${gemFile.gcp}, vaal ${gemFile.vaalOrb}`);
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/item/overview?type=SkillGem"), "gems come from the stash item overview");

/* A push deploys code only and mirrors the live data forward, file by file,
   from LEAGUE_FILES. Anything a run writes but that list omits is deleted by
   the next code deploy — the gem files were, which wiped the tab and restarted
   its history on every push. Nothing else pins the two together, so this does. */
const written = (await readdir(path.join(OUT_DIR, "Allflame"))).sort();
const mirrored = new Set(fetchModule.LEAGUE_FILES);
const dropped = written.filter((f) => !mirrored.has(f));
ok(!dropped.length, `these files are written but not mirrored on a code deploy, so a push deletes them: ${dropped.join(", ")}`);

/* Cyclone's profit under the fixture prices. Input is the 1/20 at 60 against
   10 + 20 prisms at 3 = 70. Nothing corrupted is listed at level 20, so the
   no-change roll and both quality bands fall back to the uncorrupted 20/20 at
   100, and the level 19 roll is unpriced entirely:
     0.25*100 + 0.125*1000 + 0.125*0 + 0.125*100 + 0.125*100 + 0.25*200 = 225
   225 - 60 - 5 = 160. */
const gemHist = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "gems-selfhistory.json"), "utf8"));
ok(gemHist.points?.length === 1, `one gem history point per run, got ${gemHist.points?.length}`);
ok(near(gemHist.points?.[0]?.values?.["Cyclone"], 160, 0.5), `stored Cyclone profit ${gemHist.points?.[0]?.values?.["Cyclone"]}`);

// and the documented endpoints are the ones actually used
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Fragment"), "fragments come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=DivinationCard"), "divination cards come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Astrolabe"), "astrolabes come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Fossil"), "fossils come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Resonator"), "resonators come from the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/currency/overview?type=Currency"), "stash currency is still consulted for gap-fill");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/item/overview?type=Invitation"), "invitations must be fetched");
// A type that answers from its documented family should not also be retried
// against the other one — the cross-check is a fallback, not a second request.
ok(!hits.includes("/poe1/api/economy/exchange/current/overview?type=Invitation"),
   "Invitation answered from stash, so it should not have been retried on the exchange");
ok(hits.some((h) => h === "/poe1/api/economy/exchange/current/overview?type=Astrolabe"), "astrolabes must be fetched");
ok(hits.some((h) => h === "/poe1/api/economy/stash/current/item/overview?type=UniqueWeapon"), "uniques must come from the stash endpoint");

// Catalogue drift is recorded for every tracked family, not just the ones
// with their own tab. With no previous deployment to compare against, every
// family reports `first` rather than claiming its whole contents are new.
const catalogue = JSON.parse(await readFile(path.join(OUT_DIR, "Allflame", "catalogue.json"), "utf8"));
const tracked = catalogue.categories.map((c) => c.key).sort();
const known = new Set(CATEGORIES.map((c) => c.key));
ok(tracked.every((key) => known.has(key)), `catalogue tracked an unknown family: ${tracked.join(",")}`);
// A family the feeds served must be tracked; one they served nothing for is
// already reported as missing data and has no catalogue to diff.
for (const key of ["scarabs", "astrolabes", "fossils", "resonators"]) {
  ok(tracked.includes(key), `${key} missing from the catalogue report`);
}
ok(catalogue.categories.every((c) => c.first && !c.added.length && !c.breaking.length),
   "a first run reports no drift rather than inventing it");
ok(catalogue.categories.find((c) => c.key === "scarabs")?.count > 0, "scarab catalogue counted");

console.log(`\nprice map: ${Object.keys(P).length} names, chaos=${P["Chaos Orb"]?.c}, divine=${P["Divine Orb"]?.c}c`);
await rm(OUT_DIR, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
