/* Pure calculation layer for the boss profitability tab.
   No React in here so the maths stays testable on its own.

   A boss's drops are split into groups, because they don't all roll the
   same way:

     kind "pool"        one guaranteed drop picked from the group; each
                        line's `share` is its slice. Expected quantity =
                        share * rolls. (Both the "unique pool" and the
                        "guaranteed" fragment/astrolabe tables are this.)
     kind "weighted"    the group as a whole has a `base` chance to drop;
                        if it does, one line is picked by `weight`.
                        Expected quantity = base * weight / totalWeight.
     kind "independent" each line rolls on its own `chance`. If the group
                        is quantityScaled, chances are multiplied by
                        (1 + quantity/100) — area item quantity.

   Every rate, roll count and quantity is overridable per profile. */

import { BOSSES, SYNTHETIC } from "./bossData.js";

export const PROFILE_KEY = "sl.boss.profiles.v2";
export const ACTIVE_KEY = "sl.boss.activeProfile.v2";

/* A drop line's identity for override purposes. Distinct from `item`
   because a boss can list the same item twice as different variants
   (Catarina's three Cinderswallow Urns), and those need separate rows. */
export const dropKey = (d) => d.key || d.item;

/* Every item name a boss touches — its entry cost and every drop line.
   Price overrides are stored by item name and shared across bosses (a Divine
   Orb is a Divine Orb wherever it lands), so "reset this boss" needs this list
   to know which of them belong to the boss you are resetting. */
export function bossItems(boss) {
  const out = new Set();
  for (const e of (boss?.entry || [])) if (e.item) out.add(e.item);
  for (const g of (boss?.groups || [])) {
    for (const d of (g.drops || [])) if (d.item) {
      out.add(d.item);
      for (const item of (SYNTHETIC[d.item]?.items || [])) out.add(item);
    }
  }
  return out;
}

/* ---------- price resolution ---------- */

/* Item names have to match poe.ninja's exactly, and they don't always: the
   API's slugs lose apostrophes, and map base types get labelled inconsistently
   ("Ziggurat Map" vs "Ziggurat"). Rather than let a near-miss read as "no
   price", fall back to a punctuation- and case-insensitive match, and try the
   name with and without a trailing "Map". */
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/* ---------- roll variants ----------

   poe.ninja splits some uniques into roll variants and prices each one
   separately: a Cinderswallow Urn with the Life veiled mod is not worth what
   the Mana one is. The drop tables already know which is which — Catarina's
   pool lists "Veiled Cinderswallow Urn (Life)" as its own line with its own
   share — but the price lookup was by item NAME only, so all three lines got
   the same number and the interesting one was quoted at the boring one's price.

   A line names its variant either explicitly (variant: "Life") or in the
   parenthetical of its label, which the ledger tables already use. */
export function variantHint(d) {
  if (!d) return null;
  if (d.variant) return String(d.variant);
  const m = /\(([^)]+)\)\s*$/.exec(d.label || "");
  return m ? m[1].trim() : null;
}

/* poe.ninja's variant strings are not ours, so match in widening steps and
   stop at the first hit. Anything looser than this starts pricing the wrong
   item, which is worse than falling back to the base price. */
export function matchVariant(hint, variants) {
  if (!hint || !variants) return null;
  const names = Object.keys(variants);
  if (!names.length) return null;
  const h = normKey(hint);
  if (!h) return null;

  // 1. same string, ignoring case and punctuation
  for (const n of names) if (normKey(n) === h) return n;
  // 2. one is a prefix of the other ("ES" vs "ES/Eva", "Life" vs "Life Regen")
  for (const n of names) { const k = normKey(n); if (k.startsWith(h) || h.startsWith(k)) return n; }

  const tok = (x) => String(x).toLowerCase().match(/[a-z0-9]+/g) || [];
  const ht = tok(hint);
  // 3. every word of the hint appears in the variant
  for (const n of names) { const nt = tok(n); if (ht.length && ht.every((t) => nt.includes(t))) return n; }
  // 4. the hint is an abbreviation of the variant's words: "1P2S" -> "1 Prefix, 2 Suffix"
  for (const n of names) {
    const initials = tok(n).map((w) => (/^\d+$/.test(w) ? w : w[0])).join("");
    if (initials === h) return n;
  }
  return null;
}

/* Bosses like Catarina drop uniques VEILED and unidentified, and that is a
   different item economically: unidentified is a bet on the roll, identified
   is a known quantity. poe.watch prices both — "Unidentified Cinderswallow
   Urn" runs about nine times the identified urn — so a line that says it is
   veiled should look for that name before the plain one.

   A line says so with `unidentified: true`. The label is still read as well,
   for the lines whose name already carries it ("Veiled Cinderswallow Urn
   (Life)") — those keep the word because it is what the item is called, not a
   restatement of the flag. A source that doesn't carry the unidentified form
   simply misses and falls through to the plain name. */
export function isUnidentified(d) {
  if (!d) return false;
  if (d.unidentified === true) return true;
  return /\b(?:unid|unidentified|veiled)\b/i.test(`${d.label || ""} ${d.item || ""}`);
}

/* The same item under the spellings the sources actually use.

   "Map": poe.ninja labels map base types inconsistently, so try both.

   "Support": the exceptional support gems are listed WITHOUT the suffix on
   poe.watch — the gem the game calls "Void Shockwave Support" is filed as
   "Void Shockwave". That silently unpriced seven gems, and because they are
   only ever a couple of percent of a drop pool it looked like thin market
   data rather than a naming mismatch. Both directions are tried, since which
   spelling a source uses is not something to memorise per item. */
function candidates(item) {
  const out = [item];
  if (/ map$/i.test(item)) out.push(item.replace(/ map$/i, ""));
  else out.push(`${item} Map`);
  if (/ support$/i.test(item)) out.push(item.replace(/ support$/i, ""));
  else out.push(`${item} Support`);
  return out;
}

/* prices.json shape: { "Item Name": { c, lo, hi, n } } */
export function makeResolver(priceMap, { priceOverrides = {}, divineRate = 0 } = {}) {
  const synthCache = {};
  let normIndex = null;

  function lookupLoose(name) {
    if (!priceMap) return null;
    if (normIndex === null) {
      normIndex = {};
      for (const [n, e] of Object.entries(priceMap)) {
        const k = normKey(n);
        // on collision keep the shorter name — the plainer listing
        if (!normIndex[k] || n.length < normIndex[k].name.length) normIndex[k] = { name: n, entry: e };
      }
    }
    const hit = normIndex[normKey(name)];
    return hit ? hit.entry : null;
  }

  function synthetic(key) {
    if (synthCache[key] !== undefined) return synthCache[key];
    const spec = SYNTHETIC[key];
    if (!spec || !priceMap) return (synthCache[key] = null);
    const names = spec.items || Object.keys(priceMap).filter((name) => spec.match(name));
    const components = names.map((name) => ({
      name,
      chaos: Number(priceMap[name]?.c) || 0,
      found: Number(priceMap[name]?.c) > 0,
      entry: priceMap[name] || null,
    }));
    // A declared outcome list means exactly that list. Averaging three of four
    // would make a missing cheap or expensive Eye silently change the EV.
    if (!components.length || (spec.items && components.some((part) => !part.found))) {
      return (synthCache[key] = null);
    }
    const priced = components.filter((part) => part.found);
    const vals = priced.map((part) => part.chaos);
    if (!vals.length) return (synthCache[key] = null);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return (synthCache[key] = {
      c: mean, lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length,
      synthetic: true, components: priced,
    });
  }

  /* A declared price for something poe.ninja doesn't list. Quoted in divine
     where that's how it's traded, so it tracks the divine rate instead of
     going stale the moment chaos moves. */
  function fromFallback(fb) {
    if (!fb) return null;
    if (fb.chaos > 0) return fb.chaos;
    if (fb.divine > 0 && divineRate > 0) return fb.divine * divineRate;
    return null;
  }

  /* Days since a declared price was last checked, so the UI can say when one
     has gone stale instead of quietly presenting an old number as current. */
  function fallbackAge(fb, now = Date.now()) {
    const t = fb && fb.asOf ? Date.parse(fb.asOf) : NaN;
    return isFinite(t) ? Math.floor((now - t) / 86400000) : null;
  }

  function fallbackResult(fallback) {
    const chaos = fromFallback(fallback);
    if (chaos == null) return null;
    return {
      chaos, found: true, overridden: false, entry: null,
      fallback: true, fallbackAge: fallbackAge(fallback),
      fallbackUnit: fallback.chaos > 0 ? "chaos" : "divine",
    };
  }

  /* `asDrop` marks a line a boss hands you. A drop is unidentified when it
     lands, so the unidentified market is tried first for every drop, not only
     for lines the dataset declares as such.

     `asEntry` marks a line you buy to get in. Those are currency, which the GGG
     digest prices from completed trades — that is the figure to use, and price
     precedence already puts it first. Only when GGG does not carry the name at
     all does a listing feed answer, and there the floor is what you can
     actually buy at rather than a mean of every ask.

     Either way the rule below is the same: a listing-derived quote uses `min`,
     a completed-trade quote is left exactly as traded. */
  return function resolve(item, aliases = [], fallback = null, variant = null, unidentified = false,
                          { asDrop = false, asEntry = false } = {}) {
    // An override is always keyed on the name the dataset uses, so it wins
    // before any aliasing.
    if (priceOverrides[item] != null && isFinite(priceOverrides[item])) {
      return { chaos: Number(priceOverrides[item]), overridden: true, found: true, entry: null };
    }
    let entry = null;
    let identifiedFallback = false;
    let usedName = null;
    let unidQuote = false;
    if (item.startsWith("@")) {
      entry = synthetic(item);
    } else if (priceMap) {
      // A declared alias can name an exact unidentified item-level market, so
      // it goes before the generic unidentified name. A dated declared quote
      // then beats the identified item, which is only the final fallback when
      // neither unidentified market is available.
      const generic = `Unidentified ${item}`;
      const unidNames = unidentified ? [...aliases, generic] : [generic];
      const names = unidentified
        ? unidNames
        : asDrop ? [generic, item, ...aliases] : [item, ...aliases];
      for (const n of names) { if (priceMap[n]) { entry = priceMap[n]; usedName = n; break; } }
      if (!entry) {
        for (const n of names) {
          for (const c of candidates(n)) { entry = lookupLoose(c); if (entry) { usedName = n; break; } }
          if (entry) break;
        }
      }
      unidQuote = !!entry && unidNames.includes(usedName) && /^unidentified\b/i.test(usedName || "");
      if (!entry && unidentified) {
        const declared = fallbackResult(fallback);
        if (declared) return declared;
        entry = priceMap[item] || lookupLoose(item);
        identifiedFallback = !!entry;
      }
    }
    if (!entry) {
      const declared = fallbackResult(fallback);
      if (declared) return declared;
      return { chaos: 0, found: false, overridden: false, entry: null };
    }
    // A line that names its variant is priced on that variant, not on the
    // name-wide figure. No match means the hint is not one poe.ninja splits on
    // (or the strings drifted) — the base price is the honest answer then.
    if (variant && entry.v) {
      const hit = matchVariant(variant, entry.v);
      if (hit && entry.v[hit] > 0) {
        return { chaos: entry.v[hit], found: true, overridden: false, entry, variant: hit, identifiedFallback, unidQuote: unidQuote || undefined };
      }
    }
    /* Listing feeds quote a mean of what people are asking, and that mean is
       simply the wrong number here — not a caveat on the right one. For a drop
       it prices well-rolled copies nobody is handing you; for an entry cost it
       prices asks nobody has to accept. Either way the floor is the honest
       figure, so it is used unannotated: a badge would read as a warning about
       the price when the mean is what would have misled.

       GGG figures are completed trades and stay exactly as traded. A synthetic
       is already the average of a random outcome, and its `lo` is its cheapest
       member rather than a floor for the item you get. */
    let chaos = entry.c ?? 0;
    let floorQuote = false;
    const aggregate = item.startsWith("@") || !!entry.components;
    if ((asDrop || asEntry) && !unidQuote && !aggregate
        && entry.exchangeSource !== "GGG" && entry.lo > 0 && entry.lo < chaos) {
      chaos = entry.lo;
      floorQuote = true;
    }
    return {
      chaos, found: chaos > 0, overridden: false, entry, identifiedFallback,
      unidQuote: unidQuote || undefined,
      floorQuote: floorQuote || undefined,
      // Flag the case worth knowing about: the item HAS variants, this line
      // claimed one, and nothing matched.
      variantMissed: !!(variant && entry.v) || undefined,
      // The market has a name-wide quote but does not expose this variant.
      // Keeping the live shared quote is better than inventing a split, but
      // the UI should say that the two variants are not independently priced.
      variantUnavailable: !!(variant && !entry.v) || undefined,
    };
  };
}

/* ---------- per-boss maths ---------- */

/* settings: {
     ttk, overhead, quantity,
     groups: { [groupId]: { rolls, base } },
     drops:  { [dropKey]: { share | chance | weight } },
     entry:  { [item]: qty },
   } */
export function computeBoss(boss, resolve, settings = {}) {
  const ttk = num(settings.ttk, boss.ttk);
  const overhead = num(settings.overhead, boss.overhead ?? 0);
  const quantity = num(settings.quantity, boss.quantity ?? 0);
  const dropOv = settings.drops || {};
  const entryOv = settings.entry || {};
  const groupOv = settings.groups || {};
  const qMul = 1 + quantity / 100;

  const entryLines = (boss.entry || []).map((e) => {
    const qty = num(entryOv[e.item], e.qty ?? 1);
    const p = resolve(e.item, e.aliases, e.fallback, null, false, { asEntry: true });
    return { ...e, qty, unit: p.chaos, total: p.chaos * qty, found: p.found, overridden: p.overridden,
      fallback: p.fallback, fallbackAge: p.fallbackAge, floorQuote: p.floorQuote };
  });
  const entryCost = entryLines.reduce((s, l) => s + l.total, 0);
  const entryUnknown = entryLines.some((l) => !l.found && l.qty > 0);

  const groups = (boss.groups || []).map((g) => {
    const gset = groupOv[g.id] || {};
    const rolls = num(gset.rolls, g.rolls ?? 1);
    const base = num(gset.base, g.base ?? 0);
    const rateOf = (d) => {
      const ov = dropOv[dropKey(d)] || {};
      if (g.kind === "weighted") return num(ov.weight, d.weight ?? 0);
      if (g.kind === "pool") return num(ov.share, d.share ?? 0);
      return num(ov.chance, d.chance ?? 0);
    };
    const totalWeight = g.kind === "weighted" ? g.drops.reduce((s, d) => s + rateOf(d), 0) : 0;
    const scaled = g.kind === "independent" && g.quantityScaled;

    const lines = g.drops.map((d) => {
      const rate = rateOf(d);
      let qty, pct;
      if (g.kind === "weighted") {
        pct = totalWeight ? rate / totalWeight : 0;
        qty = base * pct;
      } else if (g.kind === "pool") {
        pct = rate;
        qty = rate * rolls;
      } else {
        pct = rate;
        qty = rate * (scaled ? qMul : 1);
      }
      const p = resolve(d.item, d.aliases, d.fallback, variantHint(d), isUnidentified(d), { asDrop: true });
      const label = d.label || (d.item.startsWith("@") ? SYNTHETIC[d.item]?.label : null) || d.item;
      return {
        key: dropKey(d), item: d.item, label, rate, pct, qty,
        unit: p.chaos, value: p.chaos * qty,
        found: p.found, overridden: p.overridden, priceEntry: p.entry, fallback: p.fallback, fallbackAge: p.fallbackAge,
        variant: p.variant, variantMissed: p.variantMissed, variantUnavailable: p.variantUnavailable,
        identifiedFallback: p.identifiedFallback,
        unidQuote: p.unidQuote, floorQuote: p.floorQuote,
        unrated: d.unrated || undefined, unratedNote: d.unratedNote || undefined,
        note: d.note || undefined,
        kind: g.kind, groupId: g.id,
      };
    });
    if (g.displayOrder !== "source") lines.sort((a, b) => b.value - a.value);

    /* A line the market cannot price is not shown. It contributed nothing to
       the EV anyway — an unpriced drop is worth 0 — so hiding it changes what
       you read, not what you earn.
       Its share is deliberately NOT redistributed over the survivors. Doing
       that would assert the boss always hands you one of the remaining items,
       which inflates every EV by exactly the share that was removed. The
       honest reading is "this pool has a hole in it", and the size of the hole
       is reported so it can be seen rather than guessed at. */
    const shown = lines.filter((l) => l.found || l.qty <= 0);
    const hidden = lines.filter((l) => !(l.found || l.qty <= 0));

    return {
      ...g, rolls, base, totalWeight, scaled,
      lines: shown,
      hiddenLines: hidden,
      // Only pools have a share that sums to one, so only there is a missing
      // fraction meaningful. Independent drops each stand alone.
      hiddenShare: g.kind === "pool" ? hidden.reduce((s, l) => s + l.pct, 0) : 0,
      subtotal: shown.reduce((s, l) => s + l.value, 0),
    };
  });

  const dropLines = groups.flatMap((g) => g.lines);
  const hiddenLines = groups.flatMap((g) => g.hiddenLines);
  const hiddenShare = Math.min(1, groups.reduce((s, g) => s + g.hiddenShare, 0));
  const gross = groups.reduce((s, g) => s + g.subtotal, 0);
  const missingPrices = hiddenLines.length;
  const net = gross - entryCost;
  const runSeconds = Math.max(1, ttk + overhead);
  const runsPerHour = 3600 / runSeconds;

  return {
    boss, ttk, overhead, quantity, runSeconds, runsPerHour,
    entryLines, entryCost, entryUnknown,
    groups, dropLines, hiddenLines, hiddenShare, gross, net,
    profitPerHour: net * runsPerHour,
    grossPerHour: gross * runsPerHour,
    missingPrices,
  };
}

/* ---------- chance of coming out ahead ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Expected value alone hides the shape of the distribution: a boss can be
   +EV entirely on the back of a 1% drop and still lose you money four
   nights out of five. This simulates `runs` kills `trials` times and
   reports how often the total lands in the black. Seeded, so the number
   doesn't flicker as you type. */
export function profitChance(computed, runs = 10, trials = 4000, seed = 0x5ca4ab) {
  const rnd = mulberry32(seed);
  const cost = computed.entryCost;
  // Pre-flatten to plain arrays; this is the hot loop.
  const pools = [], weighted = [], indep = [];
  for (const g of computed.groups) {
    const priced = g.lines.map((l) => ({ p: l.rate, v: l.unit }));
    if (g.kind === "pool") pools.push({ rolls: g.rolls, lines: priced });
    else if (g.kind === "weighted") weighted.push({ base: g.base, total: g.totalWeight, lines: priced });
    else indep.push({ mul: g.scaled ? 1 + computed.quantity / 100 : 1, lines: priced });
  }
  if (!pools.length && !weighted.length && !indep.length) return null;

  const drawFrom = (lines, total) => {
    let x = rnd() * total;
    for (const l of lines) { x -= l.p; if (x <= 0) return l.v; }
    return 0;
  };

  let wins = 0;
  for (let t = 0; t < trials; t++) {
    let total = 0;
    for (let r = 0; r < runs; r++) {
      total -= cost;
      for (const g of pools) {
        const sum = g.lines.reduce((s, l) => s + l.p, 0);
        if (sum <= 0) continue;
        let n = Math.floor(g.rolls);
        if (rnd() < g.rolls - n) n++;
        for (let i = 0; i < n; i++) total += drawFrom(g.lines, sum);
      }
      for (const g of weighted) {
        if (g.total > 0 && rnd() < g.base) total += drawFrom(g.lines, g.total);
      }
      for (const g of indep) {
        for (const l of g.lines) {
          let p = l.p * g.mul;
          while (p >= 1) { total += l.v; p -= 1; }   // >100% means guaranteed plus a remainder
          if (p > 0 && rnd() < p) total += l.v;
        }
      }
    }
    if (total > 0) wins++;
  }
  return wins / trials;
}

export function computeAll(resolve, profile) {
  return BOSSES.map((b) => computeBoss(b, resolve, (profile && profile.bosses && profile.bosses[b.id]) || {}));
}

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) && v !== "" && v != null ? n : fallback;
}

/* ---------- profiles ---------- */

export function defaultProfile(name = "Default") {
  return { name, bosses: {}, priceOverrides: {}, createdAt: null };
}

/* Built-in profiles: offered alongside whatever the user has made, never
   written back to storage, so they cannot be lost or drift.

   They are DERIVED from BOSSES rather than a copied table of times. A default
   kill time that changes in bossData carries into them on the next load; a
   pasted table would have gone stale silently, which is the same failure mode
   as the hand-set prices this dataset dropped.

     Blaster      half the published kill time — 2x kill speed.

   A preset is written as the fraction of the default it represents, so the
   speed the picker shows is its definition rather than something that falls
   out of a chain of factors and needs checking. Adding one is a line in
   builtInProfiles plus, where a fight is not damage-bound, an entry in
   PRESET_TTK.

   Setup/travel is never touched: a faster build does not walk to the map
   device any quicker, so the five T17 maps keep their full overhead and their
   runs are not halved. */

/* Times that damage cannot buy back. King in the Mists is thirty seconds of
   arena whatever you are playing, so it is a floor on every preset rather than
   a number one preset overrides — otherwise each new, faster preset would
   quietly claim an impossible run. */
export const RUN_FLOOR = { "king-in-the-mists": 30 };

/* Fights whose length is set by their mechanics rather than by your damage.
   Scaling them with the rest overstates how fast they can go, so a preset
   names its own figure. Keyed by preset rather than folded into RUN_FLOOR
   because these are not floors: two presets can disagree about the number, and
   a fixed figure wins even where it is SLOWER than the scaled one. Both Shaper
   fights are the case in point — phases, portals and dialogue you cannot shoot
   through, so a blaster is at three minutes where the maths said two. */
export const PRESET_TTK = {
  "Blaster": { "shaper": 180, "uber-shaper": 180 },
};

function preset(name, seconds) {
  const fixed = PRESET_TTK[name] || {};
  const bosses = {};
  for (const b of BOSSES) {
    const ttk = fixed[b.id] ?? Math.round(seconds(b));
    bosses[b.id] = { ttk: Math.max(RUN_FLOOR[b.id] ?? 0, ttk) };
  }
  return { ...defaultProfile(name), builtIn: true, bosses };
}

export function builtInProfiles() {
  return [preset("Blaster", (b) => b.ttk / 2)];
}

/* How fast a profile is, as a multiple of the default kill speed — the number
   the cards and the picker show, so "which of these is quicker" is answerable
   without opening anything.

   Median, not mean: a floored boss (King in the Mists) and a rounded short one
   (Eater at 45s) both sit off the profile's real multiplier, and averaging lets
   them drag a clean 2x to something that reads like a measurement. */
export function profileSpeed(profile) {
  const ratios = BOSSES
    .map((b) => b.ttk / (Number(profile?.bosses?.[b.id]?.ttk) || b.ttk))
    .filter((r) => isFinite(r) && r > 0)
    .sort((x, y) => x - y);
  if (!ratios.length) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(median * 10) / 10;
}

export function loadProfiles() {
  const built = builtInProfiles();
  const reserved = new Set(built.map((p) => p.name));
  let stored = [];
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) stored = parsed.map((p) => sanitizeProfile(p));
  } catch { /* corrupt storage — start fresh */ }
  // A saved profile that happens to share a built-in's name is renamed rather
  // than dropped. It is the user's work — someone who imported this exact
  // profile by hand before it shipped should not have it deleted underneath
  // them just because the name now collides.
  const kept = [];
  for (const p of stored) {
    if (reserved.has(p.name)) p.name = uniqueName([...kept, ...built], p.name);
    kept.push(p);
  }
  return [...(kept.length ? kept : [defaultProfile()]), ...built];
}

export function saveProfiles(profiles) {
  // Built-ins are code, not storage. Persisting them would freeze a copy that
  // then ignores every later change to the defaults it is derived from.
  const own = (profiles || []).filter((p) => !p.builtIn);
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(own)); } catch { /* quota / private mode */ }
}

export function loadActive(profiles) {
  try {
    const n = localStorage.getItem(ACTIVE_KEY);
    if (n && profiles.some((p) => p.name === n)) return n;
  } catch { /* ignore */ }
  return profiles[0]?.name || "Default";
}

export function saveActive(name) {
  try { localStorage.setItem(ACTIVE_KEY, name); } catch { /* ignore */ }
}

/* Accepts anything shaped roughly right; drops the rest. Import is a
   user-pasted blob, so never trust its shape. */
export function sanitizeProfile(p, fallbackName = "Imported") {
  // Note this never sets `builtIn`: an imported blob cannot claim to be one.
  const out = defaultProfile(typeof p?.name === "string" && p.name.trim() ? p.name.trim() : fallbackName);
  if (p && typeof p === "object") {
    if (p.bosses && typeof p.bosses === "object") {
      for (const [id, s] of Object.entries(p.bosses)) {
        if (!s || typeof s !== "object") continue;
        const clean = {};
        for (const k of ["ttk", "overhead", "quantity"]) {
          if (isFinite(Number(s[k])) && s[k] !== null && s[k] !== "") clean[k] = Number(s[k]);
        }
        if (s.groups && typeof s.groups === "object") {
          clean.groups = {};
          for (const [gid, g] of Object.entries(s.groups)) {
            if (!g || typeof g !== "object") continue;
            const cg = {};
            for (const k of ["rolls", "base"]) if (isFinite(Number(g[k])) && g[k] !== null && g[k] !== "") cg[k] = Number(g[k]);
            if (Object.keys(cg).length) clean.groups[gid] = cg;
          }
          if (!Object.keys(clean.groups).length) delete clean.groups;
        }
        if (s.drops && typeof s.drops === "object") {
          clean.drops = {};
          for (const [k, d] of Object.entries(s.drops)) {
            if (!d || typeof d !== "object") continue;
            const cd = {};
            for (const f of ["share", "chance", "weight"]) {
              if (isFinite(Number(d[f])) && d[f] !== null && d[f] !== "") cd[f] = Number(d[f]);
            }
            if (Object.keys(cd).length) clean.drops[k] = cd;
          }
          if (!Object.keys(clean.drops).length) delete clean.drops;
        }
        if (s.entry && typeof s.entry === "object") {
          clean.entry = {};
          for (const [item, q] of Object.entries(s.entry)) if (isFinite(Number(q))) clean.entry[item] = Number(q);
          if (!Object.keys(clean.entry).length) delete clean.entry;
        }
        if (Object.keys(clean).length) out.bosses[id] = clean;
      }
    }
    if (p.priceOverrides && typeof p.priceOverrides === "object") {
      for (const [item, v] of Object.entries(p.priceOverrides)) {
        if (isFinite(Number(v)) && Number(v) >= 0) out.priceOverrides[item] = Number(v);
      }
    }
  }
  return out;
}

export function uniqueName(profiles, base) {
  if (!profiles.some((p) => p.name === base)) return base;
  let i = 2;
  while (profiles.some((p) => p.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}
