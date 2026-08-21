/* ================================================================
   DROP TABLE AUDIT — every boss drop, against what poe.watch prices

   The boss tab hides drop lines nothing can price, so the site is already
   honest without this script. What it does not do on its own is tell you
   WHICH lines are being hidden, or why, or whether a line is missing because
   the item genuinely isn't traded or because the name in bossData.js drifted
   from the name poe.watch uses. That distinction is the whole point here:
   one is nothing to fix, the other is a one-word edit.

   Run it against a live league:
     npm run audit-drops:poe1                     # current league
     node scripts/poe1/tools/audit-drops.mjs "Allflame" # a specific one
     node scripts/poe1/tools/audit-drops.mjs --json     # machine-readable

   For every unresolved name it also asks poe.watch's own search what it does
   have under that word, which is usually enough to see the fix immediately —
   "Cane of Kulemak (1P2S)" against a search that returns three Cane of Kulemak
   rows differing only by link count tells you the split was never real.
   ================================================================ */

import { BOSSES } from "../../../src/games/poe1/features/bosses/bossData.js";
import { makeResolver, computeBoss, variantHint, isUnidentified, dropKey } from "../../../src/games/poe1/features/bosses/bossProfit.js";
import { watchLeagues, matchWatchLeague, fetchWatchLeague, watchJson } from "../sources/poewatch.mjs";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const wantLeague = argv.find((a) => !a.startsWith("--")) || null;
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

const leagues = await watchLeagues();
if (!leagues.length) {
  console.error("poe.watch is unreachable — cannot audit against nothing.");
  process.exit(1);
}
const league = wantLeague ? matchWatchLeague(wantLeague, leagues) : leagues[0].name;
if (!league) {
  console.error(`No poe.watch league matches "${wantLeague}". Known: ${leagues.map((l) => l.name).join(", ")}`);
  process.exit(1);
}

say(`Auditing ${BOSSES.length} bosses against poe.watch · ${league}\n`);
const watch = await fetchWatchLeague(league);
if (!watch) { console.error("poe.watch returned nothing for that league."); process.exit(1); }
say(`poe.watch: ${Object.keys(watch.prices).length} priced names, ${watch.exchange.length} traded pairs, 1 divine = ${Math.round(watch.rate)}c\n`);

/* Resolve exactly the way the site does, so this cannot disagree with what
   the tab actually shows. poe.ninja is left out on purpose — the question
   being asked is what poe.watch alone covers. */
const resolve = makeResolver(watch.prices, { divineRate: watch.rate });

const missing = [];   // { boss, label, item, key, share, where }
const priced = [];
for (const boss of BOSSES) {
  const c = computeBoss(boss, resolve);
  for (const l of c.entryLines) {
    (l.found ? priced : missing).push({ boss: boss.name, label: l.item, item: l.item, key: l.item, where: "entry", share: null });
  }
  for (const g of boss.groups || []) {
    for (const d of g.drops || []) {
      const p = resolve(d.item, d.aliases, d.fallback, variantHint(d), isUnidentified(d));
      const rec = {
        boss: boss.name, bossId: boss.id, label: d.label || d.item, item: d.item,
        key: dropKey(d), where: g.id,
        share: d.share ?? d.chance ?? d.weight ?? null,
        declared: !!p.fallback,
      };
      (p.found ? priced : missing).push(rec);
    }
  }
}

/* Ask poe.watch what it DOES have under the distinctive word of each missing
   name. Grouped by item first so a name used by five bosses is searched once. */
const byItem = new Map();
for (const m of missing) {
  if (m.declared) continue;
  if (!byItem.has(m.item)) byItem.set(m.item, []);
  byItem.get(m.item).push(m);
}

/* Search the FULL name, not a keyword from it. A keyword search caps its
   results and can bury the exact match, which turns "this is in the API and
   we failed to read it" into "this looks absent" — the most expensive kind of
   wrong answer here, because it invites deleting a real drop. */
const suggestions = {};
const exactHit = {};
const terms = [...byItem.keys()];
for (const [i, item] of terms.entries()) {
  try {
    const rows = await watchJson(`/search?league=${encodeURIComponent(league)}&q=${encodeURIComponent(item)}`);
    const names = [...new Set((rows || []).map((r) => r.name))];
    exactHit[item] = names.includes(item) || names.includes(`Unidentified ${item}`);
    suggestions[item] = names.slice(0, 8);
  } catch {
    suggestions[item] = null;
    exactHit[item] = false;
  }
  if (!JSON_OUT && (i + 1) % 20 === 0) say(`  …searched ${i + 1}/${terms.length}`);
  await new Promise((r) => setTimeout(r, 120));
}

/* A line kept alive by a hand-set fallback in bossData.js resolves — it has a
   price — so it lands in `priced`, not in `missing`. Filtering `missing` for
   them could never match anything, which made "390 of 390 resolve" read as
   "390 from the market" when some of those numbers may be hardcoded and
   ageing. They are a different thing from a live price and are counted apart. */
const declared = priced.filter((m) => m.declared);
const fromMarket = priced.length - declared.length;
const real = missing.slice();

if (JSON_OUT) {
  console.log(JSON.stringify({ league, pricedCount: priced.length, missing: real, declared, suggestions, exactHit }, null, 2));
  process.exit(0);
}

const total = priced.length + missing.length;
console.log(`\n${fromMarket} of ${total} drop/entry lines are priced by poe.watch.`);
if (declared.length) console.log(`${declared.length} more are priced only by a hand-set fallback in bossData.js — a number that does not move with the market.`);
if (missing.length) console.log(`${missing.length} have no price at all and are hidden.`);
if (declared.length) {
  console.log(`\n${"-".repeat(70)}`);
  console.log(`HAND-SET PRICES (${declared.length}) — poe.watch has no listing under this name,`);
  console.log(`so the value comes from a number written into bossData.js and will drift`);
  console.log(`as the league runs. Worth re-checking, or removing if the market now covers it.`);
  console.log(`${"-".repeat(70)}\n`);
  for (const d of declared) console.log(`  ${String(d.boss).slice(0, 29).padEnd(30)}${d.label}`);
}

if (!real.length) {
  console.log(declared.length
    ? "\nNothing hidden. Every drop line shows, though the hand-set ones above are not market data."
    : "\nNothing hidden, nothing hand-set. Every drop line is priced by the live market.");
  process.exit(0);
}

/* Three outcomes, and they need very different responses, so they are
   printed apart rather than as one undifferentiated list. */
const bug = [], renamed = [], absent = [];
for (const [item, rows] of byItem) {
  const s = suggestions[item];
  const rec = { item, rows, s };
  if (exactHit[item]) bug.push(rec);
  else if (s && s.length) renamed.push(rec);
  else absent.push(rec);
}
const where = (rows) => rows.map((r) => `${r.boss}${r.share != null ? ` ${Math.round(r.share * 100)}%` : ""}`).join(", ");

/* Every hidden LINE, spelled out. The counts alone were ambiguous — 7 items
   across 10 lines reads as a discrepancy unless both numbers are shown — and
   the point of this list is that each row can be checked by hand against
   poe.watch without trusting anything above it. */
console.log(`\n${"=".repeat(70)}`);
console.log(`HIDDEN ON THE SITE: ${real.length} line(s) across ${byItem.size} item(s)`);
console.log(`${"=".repeat(70)}\n`);
console.log(`  ${"boss".padEnd(30)}${"shown as".padEnd(34)}rate   looked up as`);
for (const r of real) {
  const rate = r.share == null ? "" : `${(r.share * 100).toFixed(r.share < 0.01 ? 1 : 0)}%`;
  console.log(`  ${String(r.boss).slice(0, 29).padEnd(30)}${String(r.label).slice(0, 33).padEnd(34)}${rate.padStart(5)}   ${r.label === r.item ? "" : r.item}`);
}
console.log(`\n  Check any of these yourself: https://poe.watch/search?league=${encodeURIComponent(league)}&q=<name>`);
console.log(`\n${"-".repeat(70)}`);
console.log(`WHY EACH ONE IS MISSING`);
console.log(`${"-".repeat(70)}\n`);

if (bug.length) {
  console.log(`!! ${bug.length} of them ARE on poe.watch under exactly that name.`);
  console.log(`   That is a reading bug in this project, not missing market data — do not`);
  console.log(`   delete these. Report them.\n`);
  for (const b of bug) console.log(`  ${b.item}\n      on: ${where(b.rows)}`);
  console.log("");
}
if (renamed.length) {
  console.log(`${renamed.length} name(s) poe.watch does not know, but it has something close.`);
  console.log(`Where it is plainly the same item, fix the name in src/games/poe1/features/bosses/bossData.js.\n`);
  for (const r of renamed) {
    console.log(`  ${r.item}`);
    console.log(`      on: ${where(r.rows)}`);
    console.log(`      poe.watch: ${r.s.join(" | ")}`);
  }
  console.log("");
}
if (absent.length) {
  console.log(`${absent.length} name(s) poe.watch has nothing for at all — not traded, nothing to fix.`);
  console.log(`These stay hidden and that is the correct outcome.\n`);
  for (const a of absent) console.log(`  ${a.item}  (${where(a.rows)})`);
}
