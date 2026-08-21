/* Dataset integrity + EV maths for the boss profitability tab.
   Run: node scripts/test-boss.mjs */

import { BOSSES, SYNTHETIC, GROUP_ORDER } from "../../../src/games/poe1/features/bosses/bossData.js";
import { makeResolver, computeBoss, profitChance, sanitizeProfile, dropKey, bossItems, variantHint, matchVariant, isUnidentified, builtInProfiles, loadProfiles, profileSpeed, defaultProfile, RUN_FLOOR, PRESET_TTK } from "../../../src/games/poe1/features/bosses/bossProfit.js";

let fails = 0;
const eqv = (a, b, m) => ok(a === b, `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };
const near = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;

/* ---------------- dataset integrity ---------------- */
const ids = new Set();
for (const b of BOSSES) {
  ok(!ids.has(b.id), `duplicate boss id ${b.id}`); ids.add(b.id);
  ok(GROUP_ORDER.includes(b.group), `${b.id}: unknown content group ${b.group}`);
  ok(b.ttk > 0 && (b.overhead ?? 0) >= 0, `${b.id}: bad timing`);
  ok(Array.isArray(b.groups) && b.groups.length > 0, `${b.id}: no drop groups`);

  const gids = new Set();
  const keys = new Set();
  for (const g of b.groups) {
    ok(!gids.has(g.id), `${b.id}: duplicate group id ${g.id}`); gids.add(g.id);
    ok(["pool", "weighted", "independent"].includes(g.kind), `${b.id}/${g.id}: bad kind ${g.kind}`);
    ok(g.drops.length > 0, `${b.id}/${g.id}: empty group`);

    if (g.kind === "pool") {
      // A pool is one guaranteed drop, so its shares must partition it.
      const sum = g.drops.reduce((s, d) => s + (d.share ?? 0), 0);
      ok(sum >= 0.97 && sum <= 1.03, `${b.id}/${g.id}: shares sum to ${sum.toFixed(4)}, expected ~1`);
      ok((g.rolls ?? 1) > 0, `${b.id}/${g.id}: pool with rolls=${g.rolls}`);
      for (const d of g.drops) ok(d.share != null, `${b.id}/${g.id}/${d.item}: pool line needs share`);
    }
    if (g.kind === "weighted") {
      ok(g.base > 0 && g.base <= 1, `${b.id}/${g.id}: base ${g.base} out of range`);
      ok(g.drops.every((d) => d.weight > 0), `${b.id}/${g.id}: weights must be > 0`);
    }
    if (g.kind === "independent") {
      for (const d of g.drops) {
        ok(d.chance != null, `${b.id}/${g.id}/${d.item}: independent line needs chance`);
        ok(d.chance >= 0 && d.chance <= 1, `${b.id}/${g.id}/${d.item}: chance ${d.chance} out of range`);
      }
    }

    for (const d of g.drops) {
      // Overrides are keyed per line, so keys must be unique across the boss.
      const k = dropKey(d);
      ok(!keys.has(k), `${b.id}: duplicate drop key "${k}" — add an explicit key`);
      keys.add(k);
      if (d.item.startsWith("@")) ok(SYNTHETIC[d.item], `${b.id}: unknown synthetic ${d.item}`);
      // "Unid" is a UI badge, put on the line only when the price really came
      // from the unidentified market. A label must not claim it up front.
      ok(!/\bunid\b/i.test(d.label || ""),
         `${b.id}/${g.id}/${d.item}: label says Unid — set unidentified: true instead`);
      ok(!(d.aliases || []).some((a) => /^unidentified\b/i.test(a)) || isUnidentified(d),
         `${b.id}/${g.id}/${d.item}: has an unidentified alias but is not marked unidentified`);
    }
  }
  for (const e of (b.entry || [])) ok(typeof e.item === "string" && e.item, `${b.id}: bad entry line`);
}
const lineCount = BOSSES.reduce((s, b) => s + b.groups.reduce((t, g) => t + g.drops.length, 0), 0);
console.log(`dataset: ${BOSSES.length} bosses, ${BOSSES.reduce((s,b)=>s+b.groups.length,0)} groups, ${lineCount} drop lines`);
console.log(`  by source: ${["ledger","wiki","estimate"].map(r => `${r} ${BOSSES.filter(b=>b.rates===r).length}`).join(", ")}`);

/* ---------------- EV parity with the reference screenshots ----------------
   Same rates, same prices -> the EV column must match. */
function evOf(bossId, prices, key) {
  const c = computeBoss(BOSSES.find((b) => b.id === bossId), makeResolver(prices));
  return c.dropLines.find((l) => l.key === key);
}
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { c: v, lo: v, hi: v, n: 1 }]));

// Shaper: pool 56% x 11.0c = 6.16c; guaranteed 50% x 50.9c = 25.4c;
// additional 12% x 130c = 15.6c  (no quantity scaling on Shaper)
ok(near(evOf("shaper", P({ "Shaper's Touch": 11.0 }), "Shaper's Touch").value, 6.16), "shaper pool EV");
ok(near(evOf("shaper", P({ "Fragment of Shape": 50.9 }), "Fragment of Shape").value, 25.45), "shaper guaranteed EV");
ok(near(evOf("shaper", P({ "Shaper's Exalted Orb": 130 }), "Shaper's Exalted Orb").value, 15.6), "shaper additional EV");

// Eater: additional drops are quantity-scaled at 70% -> 0.15 * 32.9 * 1.7 = 8.38c
ok(near(evOf("eater", P({ "Exceptional Eldritch Ichor": 32.9 }), "Exceptional Eldritch Ichor").value, 8.3895, 0.01),
   "eater quantity-scaled EV");
// Uber Eater has no quantity multiplier -> 0.15 * 32.9 = 4.935c
ok(near(evOf("uber-eater", P({ "Exceptional Eldritch Ichor": 32.9 }), "Exceptional Eldritch Ichor").value, 4.935, 0.01),
   "uber eater unscaled EV");
// Black Star at 50% quantity -> 0.05 * 39.7 * 1.5 = 2.9775c
ok(near(evOf("black-star", P({ "Eldritch Orb of Annulment": 39.7 }), "Eldritch Orb of Annulment").value, 2.9775, 0.01),
   "black star quantity-scaled EV");
// Exarch at 70% -> 0.15 * 44.0 * 1.7 = 11.22c
ok(near(evOf("exarch", P({ "Exceptional Eldritch Ember": 44.0 }), "Exceptional Eldritch Ember").value, 11.22, 0.01),
   "exarch quantity-scaled EV");

// Uber Maven awakened gems: 2% base split by equal weights -> 0.02/3 each.
// At 178c/div, Enlighten at 47.0d = 8366c -> 55.8c, matching the reference.
const um = computeBoss(BOSSES.find((b) => b.id === "uber-maven"),
  makeResolver(P({ "Awakened Enlighten Support": 47.0 * 178 })));
const enl = um.dropLines.find((l) => l.key === "Awakened Enlighten Support");
ok(near(enl.pct, 1 / 3, 1e-9), `gem weight share ${enl.pct}`);
ok(near(enl.qty, 0.02 / 3, 1e-9), `gem expected qty ${enl.qty}`);
ok(near(enl.value, 55.8, 0.2), `gem EV ${enl.value.toFixed(2)} != ~55.8`);

// Catarina used to list Cinderswallow Urn three times, one per veiled mod.
// The market prices one unidentified urn, so it is one row now — see the
// merge assertions further down.
const cat = computeBoss(BOSSES.find((b) => b.id === "catarina"), makeResolver(P({ "Unidentified Cinderswallow Urn": 100 })));
const urns = cat.dropLines.filter((l) => l.item === "Cinderswallow Urn");
ok(urns.length === 1, `expected 1 urn row, got ${urns.length}`);
ok(near(urns.reduce((s, l) => s + l.value, 0), 30), "urn rows total 0.30 x 100c");

// T17 fragments are a multi-roll pool, not per-item chances: 2 rolls split
// evenly across the map's fragment types, and the roll count is what area
// quantity moves.
const zig = computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"),
  makeResolver(P({ "Devouring Fragment": 100, "Blazing Fragment": 100, "Ziggurat Map": 50 })));
const zigFrags = zig.groups.find((g) => g.id === "pool");
ok(zigFrags.rolls === 2, `ziggurat fragment rolls ${zigFrags.rolls} != 2`);
ok(near(zigFrags.subtotal, 200), `2 rolls x 100c should be 200c, got ${zigFrags.subtotal}`);
ok(near(zigFrags.lines[0].qty, 1), "even split of 2 rolls across 2 types = 1 each");
// raising the roll count for higher IIQ scales linearly
const zigHigh = computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"),
  makeResolver(P({ "Devouring Fragment": 100, "Blazing Fragment": 100, "Ziggurat Map": 50 })),
  { groups: { pool: { rolls: 3 } } });
ok(near(zigHigh.groups.find((g) => g.id === "pool").subtotal, 300), "3 rolls at 250%+ IIQ = 300c");
// Sanctuary splits across three types
const san = computeBoss(BOSSES.find((b) => b.id === "t17-sanctuary"),
  makeResolver(P({ "Lonely Fragment": 90, "Traumatic Fragment": 90, "Reverent Fragment": 90 })));
ok(near(san.groups.find((g) => g.id === "pool").subtotal, 180, 0.2), "3-type map still yields 2 fragments total");

// Name resolution has to survive poe.ninja's inconsistent labelling: the T17
// maps are grouped under "Nightmare Map" and the base type isn't always the
// display name. Exact match wins, then aliases, then a punctuation-insensitive
// match with and without a trailing "Map".
const zigEntry = (prices) => computeBoss(BOSSES.find((b) => b.id === "t17-ziggurat"), makeResolver(prices)).entryLines[0];
// poe.ninja prices the tier 17s as one "Nightmare Map" line
ok(near(zigEntry(P({ "Nightmare Map": 32 })).unit, 32), "nightmare map entry cost");
ok(zigEntry(P({ "Nightmare Map": 32 })).label === "Ziggurat Map", "entry keeps the real map name on screen");
// the per-map names stay as aliases in case they ever get listed separately
ok(near(zigEntry(P({ "Ziggurat Map": 941 })).unit, 941), "per-map alias still wins if listed");
ok(near(zigEntry(P({ "ziggurat map": 941 })).unit, 941), "case-insensitive fallback");
ok(zigEntry(P({ "Citadel Map": 941 })).found === false, "must not match a different map");
ok(near(computeBoss(BOSSES.find((b) => b.id === "maven"),
  makeResolver(P({ "The Maven's Writ": 8.52 }))).entryLines[0].unit, 8.52), "apostrophe name");

/* An unrated line is listed, badged and worth nothing — the alternative is
   inventing a rate for a drop the source only bounds, and a zero is at least
   visibly a zero. It must not read as a missing price either: the market knows
   the item, the drop table does not know the rate.

   Checked against a fixture rather than a real boss. Every line that used to
   be unrated has since been given a preliminary figure, so pinning this to a
   dataset entry would mean the mechanism silently stops being tested the next
   time one of those numbers is filled in. */
{
  for (const b of BOSSES) {
    for (const g of b.groups) {
      for (const d of g.drops.filter((x) => x.unrated)) {
        eqv(d.chance, 0, `${b.id}/${d.item}: an unrated line must carry chance 0, not a guess`);
      }
    }
  }
  const fixture = {
    id: "fixture", name: "Fixture", group: "Other", rates: "ledger", ttk: 60, overhead: 0, entry: [],
    groups: [{
      id: "additional", kind: "independent", label: "Additional drops", drops: [
        { item: "Auspicious Ambitions", chance: 0, unrated: true, unratedNote: "no published rate" },
        { item: "Divine Orb", chance: 0.5 },
      ],
    }],
  };
  const ex = computeBoss(fixture, makeResolver(P({ "Auspicious Ambitions": 5000, "Divine Orb": 100 })));
  const line = ex.dropLines.find((l) => l.item === "Auspicious Ambitions");
  ok(line, "an unrated line is still shown — it is a real drop");
  eqv(line.unrated, true, "and is flagged so the UI can say so");
  eqv(line.unratedNote, "no published rate", "with its own wording where the source gave one");
  eqv(line.value, 0, "and contributes nothing to the EV, however dear the item");
  eqv(ex.gross, 50, "the rest of the group is unaffected");
  // ...and it is not a price gap either. The market knows the item; the drop
  // table does not know the rate, which is a different complaint.
  eqv(computeBoss(fixture, makeResolver(P({ "Divine Orb": 100 }))).missingPrices, 0,
    "an unpriced unrated line must not be reported as a missing price");
}

/* `note` is the other half of that: a line with a real figure that still needs
   a word of explanation — a merged rate, a preliminary one. Unlike `unrated`
   it says nothing about whether the number counts, and it must reach the UI. */
{
  const cane = computeBoss(BOSSES.find((b) => b.id === "catarina"),
    makeResolver(P({ "Unidentified Cane of Kulemak": 100 })))
    .dropLines.find((l) => l.item === "Cane of Kulemak");
  ok(cane?.note, "a noted line carries its note through to the UI");
  eqv(cane.value, 18, "and the note does not change what the line is worth");
}

/* ---------------- built-in profiles ----------------
   Derived from BOSSES rather than a pasted table of times, so a default kill
   time that changes carries into the preset instead of quietly disagreeing
   with it. That is the property worth pinning. */
{
  const [blaster] = builtInProfiles();
  eqv(builtInProfiles().length, 1, "one shipped preset");
  eqv(blaster.name, "Blaster", "and it is named");
  for (const p of [blaster]) {
    eqv(p.builtIn, true, `${p.name}: marked, so it is never written to storage`);
    eqv(Object.keys(p.bosses).length, BOSSES.length, `${p.name}: covers every boss`);
    for (const b of BOSSES) {
      ok(p.bosses[b.id].overhead === undefined,
         `${p.name}/${b.id}: setup/travel is untouched — a faster build does not walk quicker`);
      ok(p.bosses[b.id].ttk >= (RUN_FLOOR[b.id] ?? 1),
         `${p.name}/${b.id}: no preset may claim a run below its floor`);
    }
  }
  // A preset is a fraction of the DEFAULT. Chaining a factor onto an
  // already-rounded set of times is what once left a 1/3 preset reading 3.1x —
  // a number that looks measured when it was chosen.
  for (const b of BOSSES) {
    eqv(blaster.bosses[b.id].ttk,
        PRESET_TTK.Blaster[b.id] ?? Math.max(RUN_FLOOR[b.id] ?? 0, Math.round(b.ttk / 2)),
        `${b.id}: blaster kill time`);
  }
  eqv(blaster.bosses["king-in-the-mists"].ttk, 30,
      "King in the Mists holds at its 30s floor rather than halving to 23");

  /* A mechanically-bound fight carries its own figure, and that figure is used
     as given — including where it is SLOWER than the scaled one. Both Shaper
     fights are three minutes for a blaster where the maths said two, because
     phases and dialogue do not care about your damage. */
  for (const id of ["shaper", "uber-shaper"]) {
    eqv(blaster.bosses[id].ttk, 180, `${id}: blaster is held at 3:00`);
    ok(blaster.bosses[id].ttk > Math.round(BOSSES.find((b) => b.id === id).ttk / 2),
       `${id}: the fixed figure is SLOWER than the scaled one and still wins`);
  }

  // The speed tag is what the picker shows, so it has to be the honest median
  // rather than something the floored boss drags around.
  eqv(profileSpeed(defaultProfile()), 1, "an unedited profile runs at default speed");
  eqv(profileSpeed(blaster), 2, "Blaster reads as a clean 2x");
  /* The tag is the preset's definition, so it has to land on the round number
     rather than near it. Whole-second rounding and the fixed fights put a few
     bosses either side; the median is what keeps the headline honest, so check
     most bosses really are exact. */
  for (const [p, div] of [[blaster, 2]]) {
    const exact = BOSSES.filter((b) => Math.abs(b.ttk / p.bosses[b.id].ttk - div) < 0.005).length;
    ok(exact > BOSSES.length * 0.7,
       `${p.name}: only ${exact}/${BOSSES.length} bosses hit ${div}x exactly — the tag would be a rounding artefact`);
  }

  // Half the kill time is twice the kills, which is the whole point. Measured
  // on a boss that scales — the Shapers carry a fixed figure now.
  const r = makeResolver(P({ "The Maven's Writ": 10 }));
  const maven = BOSSES.find((b) => b.id === "maven");
  ok(PRESET_TTK.Blaster[maven.id] === undefined, "maven is a scaled boss, so it can measure the rule");
  eqv(computeBoss(maven, r, blaster.bosses[maven.id]).runsPerHour,
      computeBoss(maven, r).runsPerHour * 2, "half the kill time doubles kills per hour");
  // The T17 maps keep their minute of setup, so their runs are not halved.
  const zig = BOSSES.find((b) => b.id === "t17-ziggurat");
  eqv(computeBoss(zig, r, blaster.bosses[zig.id]).runSeconds, Math.round(zig.ttk / 2) + zig.overhead,
      "a T17 run is half the kill time plus the whole overhead");

  // Storage is absent under node, so this is the corrupt/empty-storage path:
  // the preset must still be offered alongside the seeded Default.
  const list = loadProfiles();
  eqv(list.filter((p) => p.builtIn).length, 1, "the preset is offered on a fresh browser");
  ok(!list[0].builtIn, "and does not displace the editable Default as the first profile");
  // An imported blob must not be able to claim built-in status.
  ok(!sanitizeProfile({ name: "Blaster", builtIn: true }).builtIn,
     "importing cannot forge a built-in profile");
}

/* ---------------- engine behaviour ---------------- */
const prices = P({
  "Fragment of the Hydra": 10, "Fragment of the Phoenix": 10,
  "Fragment of the Chimera": 10, "Fragment of the Minotaur": 10,
  "Shaper's Touch": 100, "Voidwalker": 200, "Solstice Vigil": 300, "Dying Sun": 1000,
});
const r = makeResolver(prices);
const shaper = computeBoss(BOSSES.find((b) => b.id === "shaper"), r);
// .56*100 + .26*200 + .15*300 + .03*1000 = 56+52+45+30 = 183
ok(near(shaper.gross, 183), `shaper gross ${shaper.gross} != 183`);
ok(near(shaper.entryCost, 40), `shaper entry ${shaper.entryCost} != 40`);
ok(near(shaper.net, 143), `shaper net ${shaper.net}`);
ok(near(shaper.runsPerHour, 15), `shaper kph ${shaper.runsPerHour} != 15 (reference shows KPH 15)`);
ok(near(shaper.profitPerHour, 143 * 15), "shaper profit/hr");
console.log(`shaper: gross ${shaper.gross}c, entry ${shaper.entryCost}c, net ${shaper.net}c, ${shaper.runsPerHour} kph`);

/* `hi` must never move an EV: a "best roll" basis prices drops nobody gets —
   a corrupted 21/20 gem, the dearest stat roll. */
ok(near(computeBoss(BOSSES.find((b) => b.id === "shaper"),
     makeResolver({ ...prices, "Dying Sun": { c: prices["Dying Sun"].c, lo: prices["Dying Sun"].c, hi: 40000, n: 3 } })).gross, shaper.gross),
   "hi in the price map must not change gross");

/* `lo` is different, and deliberately so. A boss hands the item over unopened,
   so where no unidentified market exists the listing floor is the honest quote
   for a drop — the mean is pulled up by well-rolled copies nobody is giving
   you. 3% x (1000 - 1) off the Dying Sun line. */
const floored = computeBoss(BOSSES.find((b) => b.id === "shaper"),
  makeResolver({ ...prices, "Dying Sun": { c: 1000, lo: 1, hi: 40000, n: 3 } }));
ok(near(floored.gross, shaper.gross - 0.03 * 999), `floor-quoted gross ${floored.gross}`);
const floorLine = floored.dropLines.find((l) => l.item === "Dying Sun");
ok(floorLine.floorQuote === true, "and the line says it was quoted at the floor");
ok(!floorLine.unidQuote, "no unidentified market existed for it");

/* A drop line's own name still outranks its aliases. Only the generic
   unidentified name goes ahead of it — aliases on an ordinary line point at
   identified alternatives (the T17 maps' "Nightmare Map"), not at a better
   quote for this item. */
const aliased = computeBoss(
  { id: "a", name: "a", group: "Other", rates: "estimate", entry: [], ttk: 60, overhead: 0,
    groups: [{ id: "additional", kind: "independent", label: "x",
      drops: [{ item: "Exact Name", aliases: ["Other Name"], chance: 1 }] }] },
  makeResolver({ "Exact Name": { c: 100, lo: 100, hi: 100, n: 1 },
                 "Other Name": { c: 5, lo: 5, hi: 5, n: 1 } }));
ok(near(aliased.dropLines[0].unit, 100), `the item's own name must win over an alias: ${aliased.dropLines[0].unit}`);

/* An unidentified market wins over both, and is labelled rather than silently
   swapped in. */
const unid = computeBoss(BOSSES.find((b) => b.id === "shaper"),
  makeResolver({ ...prices, "Unidentified Dying Sun": { c: 60, lo: 55, hi: 900, n: 4 } }));
const unidLine = unid.dropLines.find((l) => l.item === "Dying Sun");
ok(near(unidLine.unit, 60), `unidentified quote ${unidLine.unit} != 60`);
ok(unidLine.unidQuote === true, "the line is flagged as an unidentified quote");
ok(!unidLine.floorQuote, "an unidentified price is already the drop — no flooring on top");

/* Entry costs are currency, which the GGG digest prices from completed trades —
   and price precedence already puts that first. A GGG figure is used exactly as
   traded. */
const traded = computeBoss(BOSSES.find((b) => b.id === "shaper"),
  makeResolver({ ...prices, "Fragment of the Hydra": { c: 10, lo: 1, hi: 40, n: 3, exchangeSource: "GGG" } }));
ok(near(traded.entryCost, shaper.entryCost), `a completed-trade entry price must be used as-is: ${traded.entryCost}`);

/* Only where GGG does not carry the name does a listing feed answer, and there
   the floor is what you can actually buy at rather than a mean of every ask. */
const listed = computeBoss(BOSSES.find((b) => b.id === "shaper"),
  makeResolver({ ...prices, "Fragment of the Hydra": { c: 10, lo: 1, hi: 40, n: 3 } }));
ok(near(listed.entryCost, shaper.entryCost - 9), `listed entry cost should use the floor: ${listed.entryCost}`);
ok(listed.entryLines.find((l) => l.item === "Fragment of the Hydra").floorQuote === true,
   "and the entry line says so");
const ov = computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver(prices, { priceOverrides: { "Dying Sun": 0 } }));
ok(near(ov.gross, 153), `price override gross ${ov.gross} != 153`);

// per-boss overrides: timing, rates, quantity
const tuned = computeBoss(BOSSES.find((b) => b.id === "shaper"), r,
  { ttk: 30, overhead: 30, drops: { "Dying Sun": { share: 0.5 } }, groups: { pool: { rolls: 2 } } });
ok(tuned.runSeconds === 60 && near(tuned.runsPerHour, 60), "tuned timing");
ok(near(tuned.gross, (0.56 * 100 + 0.26 * 200 + 0.15 * 300 + 0.5 * 1000) * 2 + 0), `tuned pool gross ${tuned.gross}`);
const qUp = computeBoss(BOSSES.find((b) => b.id === "eater"), makeResolver(P({ "Exceptional Eldritch Ichor": 100 })), { quantity: 0 });
ok(near(qUp.gross, 15), `quantity 0 should give 0.15*100 = 15, got ${qUp.gross}`);

// synthetic aggregates still work (nothing uses them today)
const rSyn = makeResolver(P({ "Awakened Fork Support": 40, "Awakened Spell Echo Support": 60, "Awakened Empower Support": 3000 }));
ok(near(rSyn("@awakened-common").chaos, 50), "@awakened-common mean");
ok(near(rSyn("@awakened-exceptional").chaos, 3000), "@awakened-exceptional mean");
ok(rSyn("@nope").found === false, "unknown synthetic resolves to not-found");

ok(makeResolver(P({ "Zorath's Eye of the Inevitable": 1300 }))("@zorath-eyes").found === false,
   "the retired Eye synthetic must not resolve to anything");

// With no price map at all every line is unpriced, so every line is hidden
// and nothing is left claiming to be worth something.
const blind = computeBoss(BOSSES.find((b) => b.id === "shaper"), makeResolver({}));
ok(blind.gross === 0, `blind gross ${blind.gross}`);
ok(blind.dropLines.length === 0, `nothing should be shown when nothing is priced: ${blind.dropLines.length}`);
ok(blind.missingPrices === blind.hiddenLines.length && blind.hiddenLines.length > 0,
   `blind hidden ${blind.hiddenLines.length}`);
ok(blind.entryUnknown === true, "blind entryUnknown");
// A chance:0 line — an item that's documented as dropping but has no published
// rate — must survive into the table so it can be edited, without polluting the
// missing-price count.
const zeroBoss = { id: "z", name: "z", group: "Other", rates: "estimate", entry: [], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x",
    drops: [{ item: "Voidwalker", chance: 0.5 }, { item: "Unpriced Mystery", chance: 0 }] }] };
const zc = computeBoss(zeroBoss, r);
const zeroLine = zc.dropLines.find((l) => l.item === "Unpriced Mystery");
ok(zeroLine && zeroLine.qty === 0 && zeroLine.value === 0, "chance:0 line present and contributes nothing");
ok(zc.missingPrices === 0, `chance:0 line must not count as a missing price (got ${zc.missingPrices})`);

/* The declared-fallback mechanism, exercised on a synthetic boss.

   No real drop line uses it any more: every price the dataset once hardcoded
   is now carried by poe.watch, and a hardcoded number that never fires is just
   a stale figure waiting to be wrong. The machinery stays because a source can
   drop an item mid-league, but the moment real data uses it again it should be
   deliberate — hence a fixture rather than a live boss. */
const fbBoss = (fallback) => ({
  id: "fb", name: "fb", group: "Other", rates: "ledger", entry: [], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "Orb of Dominance", chance: 1, fallback }] }],
});
const domLine = (prices, opts) => {
  const c = computeBoss(fbBoss({ divine: 3.7, asOf: "2026-08-03" }), makeResolver(prices, opts));
  return [...c.dropLines, ...c.hiddenLines].find((l) => l.item === "Orb of Dominance");
};
const fb = domLine(P({}), { divineRate: 200 });
ok(fb.found && fb.fallback === true, "fallback should price the line and be flagged");
ok(near(fb.unit, 740), `3.7 divine at 200c/div should be 740c, got ${fb.unit}`);
ok(near(domLine(P({}), { divineRate: 100 }).unit, 370), "fallback tracks the divine rate");
// a real listing always beats the declared number
const real = domLine(P({ "Orb of Dominance": 12 }), { divineRate: 200 });
ok(near(real.unit, 12) && !real.fallback, `a live price must win, got ${real.unit}`);
// A divine-denominated fallback needs a rate to convert against. Without one
// it cannot be priced, so the line is hidden rather than shown at zero.
{
  const noRate = computeBoss(fbBoss({ divine: 3.7 }), makeResolver(P({}), { divineRate: 0 }));
  ok(!noRate.dropLines.some((l) => l.item === "Orb of Dominance"), "no divine rate means no fallback price, so no row");
  ok(noRate.hiddenLines.some((l) => l.item === "Orb of Dominance"), "and it shows up as hidden");
}
// declared prices carry their age so the UI can flag a stale one
ok(fb.fallbackAge != null && fb.fallbackAge >= 0, `fallback should report its age, got ${fb.fallbackAge}`);

/* And the dataset itself must stay free of them: a hardcoded price that the
   market already covers is a wrong number waiting to surface. */
{
  const hard = [];
  for (const b of BOSSES) {
    for (const e of (b.entry || [])) if (e.fallback) hard.push(`${b.name} entry ${e.item}`);
    for (const g of b.groups) for (const d of g.drops) if (d.fallback) hard.push(`${b.name} ${d.item}`);
  }
  ok(hard.length === 0, `bossData.js should carry no hand-set prices, found: ${hard.join(", ")}`);
}

{
  const shaper = BOSSES.find((boss) => boss.id === "shaper");
  const pool = shaper.groups.find((group) => group.id === "pool");
  const shares = Object.fromEntries(pool.drops.map((drop) => [drop.item, drop.share]));
  ok(shaper.rates === "wiki", "regular Shaper's current pool is sourced from the wiki estimate");
  eqv(shares["Shaper's Touch"], 0.56, "Shaper's Touch uses the current 56% estimate");
  eqv(shares.Voidwalker, 0.26, "Voidwalker uses the current 26% estimate");
  eqv(shares["Solstice Vigil"], 0.15, "Solstice Vigil uses the current 15% estimate");
  eqv(shares["Dying Sun"], 0.03, "Dying Sun uses the current 3% estimate");
}

const undated = computeBoss(
  { id: "u", name: "u", group: "Other", rates: "ledger", entry: [], ttk: 60, overhead: 0,
    groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "Nope", chance: 1, fallback: { chaos: 5 } }] }] },
  makeResolver(P({}), { divineRate: 200 })).dropLines[0];
ok(undated.fallback && undated.fallbackAge === null, "an undated fallback still prices, with no age");

/* ---------------- exceptional support gems ----------------
   Transcribed from poewiki's "Exceptional support gems" tables. These gems are
   drop-restricted to named bosses, so the mapping is checkable both ways: every
   gem must appear on each boss that drops it, and no boss may claim one it
   doesn't. Gems restricted to content we don't list (Legion generals, the
   Zealot's/Arkhon's Vaults, Vruun, Ghorr, K'tash, Beidat, Zorath, Velka,
   Kosis) are deliberately absent. */
const GEM_SOURCES = {
  "Awakened Empower Support": ["uber-maven"],
  "Awakened Enhance Support": ["uber-maven"],
  "Awakened Enlighten Support": ["uber-maven"],
  "Eclipse Support": ["uber-maven"],
  "Invert the Rules Support": ["maven", "uber-maven"],
  "Void Shockwave Support": ["uber-elder", "uber-uber-elder"],
  "Eldritch Blasphemy Support": ["elder"],
  "Voidstorm Support": ["shaper", "uber-shaper"],
  "Annihilation Support": ["sirus", "uber-sirus"],
  "Overheat Support": ["exarch", "uber-exarch"],
  "Gluttony Support": ["eater", "uber-eater"],
  "Greater Spell Echo Support": ["uber-atziri"],
  "Vaal Sacrifice Support": ["uber-atziri"],
  "Foulgrasp Support": ["esh-tul"],
  // The game and poe.ninja call this one Hiveborn Support; only poe.watch
  // files it as Summon Hiveborn, which the line carries as an alias.
  "Hiveborn Support": ["esh-tul"],
  "Hextoad Support": ["king-in-the-mists"],
  "Hexpass Support": ["king-in-the-mists"],
  "Greater Kinetic Instability Support": ["cortex", "uber-cortex"],
  "Congregation Support": ["incarnation-dread", "uber-incarnation-dread"],
  "Frostmage Support": ["incarnation-neglect", "uber-incarnation-neglect"],
  "Greater Devour Support": ["incarnation-fear", "uber-incarnation-fear"],
  "Pacifism Support": ["oshabi"],
  "Greater Unleash Support": ["oshabi"],
  "Communion Support": ["catarina", "t17-ziggurat"],
  "Cast on Ward Break Support": ["t17-citadel"],
  "Unholy Trinity Support": ["t17-abomination"],
  "Overloaded Intensity Support": ["t17-fortress"],
  "Scornful Herald Support": ["t17-sanctuary"],
};
const itemsOf = new Map(BOSSES.map((b) => [b.id, new Set(b.groups.flatMap((g) => g.drops.map((d) => d.item)))]));
for (const [gem, sources] of Object.entries(GEM_SOURCES)) {
  for (const id of sources) {
    ok(itemsOf.has(id), `${gem}: unknown boss id ${id}`);
    ok(itemsOf.get(id)?.has(gem), `${id} should drop ${gem} — poewiki restricts it to ${sources.join(" + ")}`);
  }
}
for (const b of BOSSES) {
  for (const g of b.groups) for (const d of g.drops) {
    if (!/ Support$/.test(d.item)) continue;
    const src = GEM_SOURCES[d.item];
    ok(src, `${b.id}: ${d.item} isn't in the exceptional gem list — check the name`);
    ok(!src || src.includes(b.id), `${b.id} claims ${d.item}, but poewiki restricts it to ${src?.join(" + ")}`);
  }
}
console.log(`exceptional gems: ${Object.keys(GEM_SOURCES).length} mapped across ${new Set(Object.values(GEM_SOURCES).flat()).size} bosses`);

/* ---------------- chance of profit ---------------- */
// A guaranteed, always-profitable boss must read ~100%; a boss whose value
// sits entirely in a rare drop must read well under it despite being +EV.
const sureThing = { id: "sure", name: "sure", group: "Other", rates: "ledger", entry: [{ item: "cheap" }], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "always", chance: 1 }] }] };
const lottery = { id: "lotto", name: "lotto", group: "Other", rates: "ledger", entry: [{ item: "cheap" }], ttk: 60, overhead: 0,
  groups: [{ id: "additional", kind: "independent", label: "x", drops: [{ item: "jackpot", chance: 0.01 }] }] };
const rc = makeResolver(P({ cheap: 10, always: 50, jackpot: 5000 }));
const cSure = profitChance(computeBoss(sureThing, rc), 10, 3000);
const cLotto = profitChance(computeBoss(lottery, rc), 10, 3000);
ok(cSure === 1, `guaranteed-profit boss should be 1.0, got ${cSure}`);
ok(cLotto > 0.05 && cLotto < 0.75, `lottery boss should be uncertain, got ${cLotto}`);
ok(computeBoss(lottery, rc).net > 0, "lottery boss is +EV despite low win rate");
ok(profitChance(computeBoss(lottery, rc), 10, 3000) === cLotto, "profitChance must be deterministic");
// More runs pull a +EV boss toward certainty — that's the whole point of
// letting the run count be configured.
const lottoComputed = computeBoss(lottery, rc);
const c1 = profitChance(lottoComputed, 1, 3000);
const c50 = profitChance(lottoComputed, 50, 3000);
ok(c50 > c1, `50 runs (${c50}) should be safer than 1 run (${c1}) for a +EV boss`);
ok(c1 >= 0 && c50 <= 1, "chance stays a probability");
console.log(`profit chance: guaranteed ${(cSure*100).toFixed(0)}%, lottery ${(cLotto*100).toFixed(0)}% over 10 runs -> ${(c1*100).toFixed(0)}% over 1, ${(c50*100).toFixed(0)}% over 50`);

/* ---------------- profile sanitising ---------------- */
const dirty = sanitizeProfile({
  name: "  X  ",
  bosses: {
    shaper: {
      ttk: "abc", overhead: 45, quantity: 30,
      groups: { pool: { rolls: 2, base: "no" }, junk: "str" },
      drops: { "Dying Sun": { share: "x", chance: 0.5 }, bad: 7 },
      entry: { a: "nope", b: 3 },
    },
    broken: "str",
  },
  priceOverrides: { A: -5, B: 12, C: "no" },
  evil: () => {},
}, "fallback");
ok(dirty.name === "X", "name trimmed");
ok(dirty.bosses.shaper.ttk === undefined && dirty.bosses.shaper.overhead === 45 && dirty.bosses.shaper.quantity === 30, "numeric filter");
ok(dirty.bosses.shaper.groups.pool.rolls === 2 && dirty.bosses.shaper.groups.pool.base === undefined, "group filter");
ok(dirty.bosses.shaper.groups.junk === undefined, "non-object group dropped");
ok(dirty.bosses.shaper.drops["Dying Sun"].chance === 0.5 && dirty.bosses.shaper.drops["Dying Sun"].share === undefined, "drop filter");
ok(dirty.bosses.shaper.drops.bad === undefined, "non-object drop dropped");
ok(dirty.bosses.shaper.entry.b === 3 && dirty.bosses.shaper.entry.a === undefined, "entry filter");
ok(dirty.bosses.broken === undefined, "non-object boss dropped");
ok(dirty.priceOverrides.B === 12 && dirty.priceOverrides.A === undefined && dirty.priceOverrides.C === undefined, "price override filter");
ok(dirty.evil === undefined, "unknown keys dropped");
ok(sanitizeProfile(null, "fallback").name === "fallback", "null profile falls back");

/* ---------------- every boss computes cleanly ---------------- */
for (const b of BOSSES) {
  const c = computeBoss(b, r);
  ok(isFinite(c.profitPerHour) && isFinite(c.gross) && isFinite(c.net), `${b.id}: non-finite result`);
  // Lines nothing can price are hidden rather than shown at zero, so shown +
  // hidden has to account for every line in the data.
  ok(c.dropLines.length + c.hiddenLines.length === b.groups.reduce((s, g) => s + g.drops.length, 0),
     `${b.id}: lost a line — ${c.dropLines.length} shown + ${c.hiddenLines.length} hidden`);
}

/* ---------------- reset scope ----------------
   "Reset this boss" clears p.bosses[id] AND the price overrides for that
   boss's items. Price overrides are keyed by item name, not by boss, so the
   button needs bossItems() to know which of them are its own; without that it
   cleared the kill time and left every edited price behind, which read as the
   button doing nothing. */
for (const b of BOSSES) {
  const items = bossItems(b);
  const expect = new Set([
    ...(b.entry || []).map((e) => e.item),
    ...b.groups.flatMap((g) => g.drops.map((d) => d.item)),
  ].filter(Boolean));
  ok(items.size === expect.size && [...expect].every((i) => items.has(i)),
     `${b.id}: bossItems missed ${[...expect].filter((i) => !items.has(i)).join(", ") || "nothing, but sizes differ"}`);
  ok(items.size > 0, `${b.id}: no items at all`);
}
ok(bossItems(undefined).size === 0, "bossItems(undefined) must not throw");
ok(bossItems({}).size === 0, "bossItems({}) must not throw");

/* The entry cost is an override target too — resetting a boss whose only edit
   was its entry price has to clear that, or the button is a no-op again. */
{
  const withEntry = BOSSES.find((b) => (b.entry || []).length);
  ok(withEntry && bossItems(withEntry).has(withEntry.entry[0].item),
     "entry-cost items must be in the reset scope");
}

console.log(`reset scope: ${BOSSES.length} bosses, ${new Set(BOSSES.flatMap((b) => [...bossItems(b)])).size} distinct items`);

/* ---------------- roll variants ----------------
   poe.ninja prices a Cinderswallow Urn per veiled mod, and Catarina's pool
   names which one each line is. Pricing all three off the name-wide figure put
   the valuable roll at the cheap roll's price. */
eqv(variantHint({ label: "Veiled Cinderswallow Urn (Life)" }), "Life", "hint read from the label parenthetical");
eqv(variantHint({ variant: "ES", label: "whatever (Life)" }), "ES", "explicit variant beats the label");
eqv(variantHint({ label: "Starforge" }), null, "no parenthetical, no hint");
eqv(variantHint({ label: "Veiled Cane of Kulemak (1P2S)" }), "1P2S", "abbreviated roll names survive");
eqv(variantHint(null), null, "null line must not throw");

{
  const V = { "Life": 12, "Mana": 40, "Energy Shield": 900, "1 Prefix, 2 Suffix": 30 };
  eqv(matchVariant("Life", V), "Life", "exact match");
  eqv(matchVariant("life", V), "Life", "case-insensitive");
  eqv(matchVariant("ES", V), "Energy Shield", "initials expand");
  eqv(matchVariant("1P2S", V), "1 Prefix, 2 Suffix", "digits survive the initialism");
  eqv(matchVariant("Nonsense", V), null, "no match is null, never a guess");
  eqv(matchVariant("Life", null), null, "no variant map is null");
  eqv(matchVariant(null, V), null, "no hint is null");
}

/* End to end through the resolver: same item name, three lines, three prices. */
{
  const pm = { "Cinderswallow Urn": { c: 12, lo: 12, hi: 900, n: 3, v: { "Life": 12, "Mana": 40, "Energy Shield": 900 } } };
  const rv = makeResolver(pm);
  eqv(rv("Cinderswallow Urn", [], null, "ES").chaos, 900, "ES line prices on the ES variant");
  eqv(rv("Cinderswallow Urn", [], null, "Life").chaos, 12, "Life line prices on the Life variant");
  eqv(rv("Cinderswallow Urn", [], null, null).chaos, 12, "no hint falls back to the name-wide price");
  const miss = rv("Cinderswallow Urn", [], null, "Fire Damage");
  eqv(miss.chaos, 12, "an unmatched hint falls back rather than guessing");
  ok(miss.variantMissed === true, "an unmatched hint is flagged so it shows up in the log and the UI");
  const shared = makeResolver({ "Hale Negator": { c: 4 } })("Hale Negator", [], null, "2 socket");
  eqv(shared.chaos, 4, "a missing variant split keeps the live name-wide quote");
  ok(shared.variantUnavailable === true, "an unavailable market split is exposed to the UI");
  // An override still wins: it is keyed on the item and beats every variant.
  eqv(makeResolver(pm, { priceOverrides: { "Cinderswallow Urn": 5 } })("Cinderswallow Urn", [], null, "ES").chaos, 5,
      "a manual override beats the variant price");
}

/* ---------------- unpriced drops are hidden, not zeroed ----------------
   The brief was blunt: if poe.watch cannot price it, it should not be on the
   page. Hiding is safe because an unpriced line was already worth 0 — what
   must NOT happen is the freed share being handed to the survivors, which
   would silently inflate every EV by exactly the share removed. */
{
  const catarina = BOSSES.find((b) => b.id === "catarina");
  const full = { "Unidentified Cinderswallow Urn": { c: 1000 }, "Spinehail": { c: 5 },
                 "Cane of Kulemak": { c: 10 }, "The Devouring Diadem": { c: 20 },
                 "Bitterbind Point": { c: 30 }, "The Queen's Hunger": { c: 40 } };
  // Price her extras too, so the only variable under test is the pool.
  for (const d of catarina.groups.flatMap((g) => g.drops)) if (!full[d.item]) full[d.item] = { c: 1 };

  const poolOf = (c) => c.groups.find((g) => g.kind === "pool");
  const whole = computeBoss(catarina, makeResolver(full));
  ok(poolOf(whole).hiddenLines.length === 0, `everything priced should hide nothing: ${poolOf(whole).hiddenLines.length}`);

  // Drop the 30% urn from the market and the pool loses exactly its value.
  // Both names have to go: the veiled line asks for the unidentified item
  // first and falls through to the plain one, so leaving either would price it.
  const without = { ...full };
  delete without["Unidentified Cinderswallow Urn"];
  delete without["Cinderswallow Urn"];
  const partial = computeBoss(catarina, makeResolver(without));
  ok(poolOf(partial).hiddenLines.length === 1, `the unpriced line is hidden: ${poolOf(partial).hiddenLines.length}`);
  ok(!partial.dropLines.some((l) => /Cinderswallow/.test(l.label)), "and is gone from the shown lines");
  eqv(Math.round(partial.hiddenShare * 100), 30, "its share is reported, not silently dropped");
  eqv(Math.round(whole.gross - partial.gross), 300, "gross falls by exactly the missing line's value");
  ok(partial.gross < whole.gross, "shares must NOT be redistributed — that would inflate the EV");
}

/* ---------------- unidentified item-level markets ----------------
   poe.watch separates several unopened boss uniques by item level. The exact
   alias declared by the boss must win before both the generic unidentified
   row and the identified item. */
{
  const pm = {
    "Watcher's Eye": { c: 1 }, "Unidentified Watcher's Eye": { c: 50 },
    "Unidentified Watcher's Eye 85": { c: 120 }, "Unidentified Watcher's Eye 86+": { c: 500 },
    "Thread of Hope": { c: 2 }, "Unidentified Thread of Hope": { c: 40 },
    "Unidentified Thread of Hope (ilvl 86)": { c: 300 }, "Unidentified Thread of Hope (ilvl 87)": { c: 13 },
    "Forbidden Flame": { c: 3 }, "Unidentified Forbidden Flame": { c: 100 },
    "Unidentified Forbidden Flame (ilvl 86)": { c: 2600 }, "Unidentified Forbidden Flame (ilvl 87)": { c: 2400 },
    "Forbidden Flesh": { c: 4 }, "Unidentified Forbidden Flesh": { c: 110 },
    "Unidentified Forbidden Flesh (ilvl 86)": { c: 1800 }, "Unidentified Forbidden Flesh (ilvl 87)": { c: 2650 },
  };
  const expected = [
    ["elder", "Watcher's Eye", 120], ["uber-elder", "Watcher's Eye", 500],
    ["uber-uber-elder", "Watcher's Eye", 500], ["sirus", "Thread of Hope", 300],
    ["uber-sirus", "Thread of Hope", 13], ["exarch", "Forbidden Flame", 2600],
    ["uber-exarch", "Forbidden Flame", 2400], ["eater", "Forbidden Flesh", 1800],
    ["uber-eater", "Forbidden Flesh", 2650],
  ];
  for (const [bossId, item, price] of expected) {
    const computed = computeBoss(BOSSES.find((b) => b.id === bossId), makeResolver(pm));
    const line = computed.dropLines.find((drop) => drop.item === item);
    eqv(line?.unit, price, `${bossId} uses the exact unidentified ${item} market`);
  }

  const declaredUnid = makeResolver({ "Aul's Uprising": { c: 10 } })(
    "Aul's Uprising", [], { chaos: 50, asOf: "2026-08-07" }, null, true);
  eqv(declaredUnid.chaos, 50, "a dated unidentified quote beats the identified item floor");
  ok(declaredUnid.fallback === true, "the manual unidentified quote remains visibly declared");

  const identifiedFloor = makeResolver({ "Aul's Uprising": { c: 10 } })(
    "Aul's Uprising", [], null, null, true);
  eqv(identifiedFloor.chaos, 10, "identified value remains the last fallback without an unid quote");
  ok(identifiedFloor.identifiedFallback === true, "identified fallback is exposed to the UI");
}

/* Catarina's pool is one line per tradeable item. poe.watch carries a single
   unidentified urn and a single cane, so the drop table's split lines are
   summed, not dropped. */
{
  const catarina = BOSSES.find((b) => b.id === "catarina");
  const pool = catarina.groups.find((g) => g.kind === "pool");
  const names = pool.drops.map((d) => d.item);
  eqv(names.length, new Set(names).size, "no item may appear twice in one pool");
  ok(Math.abs(pool.drops.reduce((s, d) => s + d.share, 0) - 1) < 1e-9,
     `pool shares must still total 1: ${pool.drops.reduce((s, d) => s + d.share, 0)}`);
  eqv(pool.drops.find((d) => d.item === "Cinderswallow Urn").share, 0.30,
      "the urn lines merged into one at their combined share");
  const cane = pool.drops.find((d) => d.item === "Cane of Kulemak");
  eqv(cane.share, 0.18, "and the 3-mod and 4-mod canes likewise (0.17 + 0.01)");
  /* A merged line has to say so on the row. Nothing else on the page hints
     that two published rates went into one number, and a reader checking this
     against the drop table would otherwise find 18% where it says 17%. */
  ok(/\b17\b/.test(cane.note || "") && /\b1\b/.test(cane.note || ""),
     "the merged cane names both published rates in its note");
  // Every drop here is veiled; the flag says so rather than the label.
  for (const d of pool.drops) {
    eqv(d.unidentified, true, `${d.item}: Catarina's pool is veiled, so the line must be marked`);
    ok(!/veiled/i.test(d.label || ""),
       `${d.item}: "veiled" on every label said nothing — the flag carries it now`);
  }
}

/* ---------------- name spellings between sources ----------------
   poe.watch files the exceptional support gems WITHOUT the suffix the game
   uses: "Void Shockwave Support" is "Void Shockwave" there. Seven gems went
   unpriced on that alone, and at 2% of a pool each it read as thin market
   data rather than a naming mismatch — which is why it survived a full audit
   pass before anyone noticed. */
{
  const pm = { "Void Shockwave": { c: 900 }, "Enlighten Support": { c: 200 }, "Ziggurat": { c: 40 } };
  const r = makeResolver(pm);
  eqv(r("Void Shockwave Support").chaos, 900, "a gem named with Support finds the version without it");
  eqv(r("Enlighten Support").chaos, 200, "and one that really is named Support still works");
  eqv(r("Void Shockwave").chaos, 900, "as does the bare name");
  eqv(r("Ziggurat Map").chaos, 40, "the same both-ways rule still covers map base types");
  eqv(r("Nothing Support").chaos, 0, "a name neither spelling can find stays unpriced");
}

/* Three gems poe.watch files under a name no suffix rule can reach — the
   game and the market simply disagree about what they are called. The game's
   name is what the page shows; the market's name is the alias that gets
   looked up when the game's name finds nothing. */
{
  const watchNames = { "Summon Hiveborn": { c: 30 }, "Bursting Toad": { c: 45 }, "Kinetic Flux": { c: 60 } };
  const r = makeResolver(watchNames);
  const lineFor = (bossId, re) => {
    const c = computeBoss(BOSSES.find((b) => b.id === bossId), r);
    return [...c.dropLines, ...c.hiddenLines].find((l) => re.test(l.item));
  };
  const hive = lineFor("esh-tul", /Hiveborn/);
  eqv(hive?.unit, 30, "Hiveborn Support resolves through its Summon Hiveborn alias");
  eqv(hive?.label, "Hiveborn Support", "and keeps the in-game name on the page");
  /* The line used to be named for poe.watch's spelling, which meant the name
     poe.ninja and the game actually use found nothing — and poe.ninja is the
     primary source now, so Esh-Tul simply lost the gem. */
  {
    const ninja = makeResolver({ "Hiveborn Support": { c: 25 } });
    const c = computeBoss(BOSSES.find((b) => b.id === "esh-tul"), ninja);
    const line = [...c.dropLines, ...c.hiddenLines].find((l) => /Hiveborn/.test(l.item));
    eqv(line?.unit, 25, "and poe.ninja's spelling — the game's own — resolves too");
  }
  const toad = lineFor("king-in-the-mists", /Hextoad/);
  eqv(toad?.unit, 45, "Hextoad Support resolves through its Bursting Toad alias");
  eqv(toad?.label, "Hextoad Support", "and keeps the in-game name on the page");
  const flux = lineFor("uber-cortex", /Kinetic Instability/);
  eqv(flux?.unit, 60, "Greater Kinetic Instability Support resolves through Kinetic Flux");
  eqv(flux?.label, "Greater Kinetic Instability Support", "and keeps the in-game name");
}

/* Every gem the drop tables reference must resolve under one spelling or the
   other, given a price map that uses poe.watch's convention. */
{
  const gems = new Set();
  for (const b of BOSSES) for (const g of b.groups) for (const d of g.drops) {
    if (/ support$/i.test(d.item)) gems.add(d.item);
  }
  const watchStyle = {};
  for (const g of gems) watchStyle[g.replace(/ support$/i, "")] = { c: 100 };
  const r = makeResolver(watchStyle);
  const unresolved = [...gems].filter((g) => !r(g).found);
  ok(unresolved.length === 0, `support gems that would not resolve: ${unresolved.join(", ")}`);
  ok(gems.size > 0, "there should be support gems in the dataset to check");
}

console.log(fails ? `\n${fails} FAILURES` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
