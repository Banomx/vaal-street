/* Find which poe.ninja endpoint carries a given item.

   Usage:
     node scripts/poe1/tools/probe-price.mjs "Orb of Dominance"
     node scripts/poe1/tools/probe-price.mjs "Orb of Dominance" --league Allflame
     node scripts/poe1/tools/probe-price.mjs --counts  # just the per-endpoint totals

   The snapshot script has to decide up front which endpoint serves what, and
   poe.ninja's docs have been wrong about that more than once. This asks every
   family x type combination directly and reports where a name actually lives,
   so a missing price becomes a fact rather than a guess. It writes nothing. */

const NINJA = "https://poe.ninja";
const HEADERS = { "User-Agent": "scarab-ledger-probe/1.0 (github.com/Banomx/scarab-ledger)" };
const DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const args = process.argv.slice(2);
const countsOnly = args.includes("--counts");
const leagueArg = args.includes("--league") ? args[args.indexOf("--league") + 1] : null;
const needle = args.filter((a) => !a.startsWith("--") && a !== leagueArg)[0] || null;
if (!needle && !countsOnly) {
  console.error('Usage: node scripts/poe1/tools/probe-price.mjs "Item Name" [--league Allflame] [--counts]');
  process.exit(1);
}

async function tryJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { __status: res.status };
    return await res.json();
  } catch (e) { return { __error: String(e).slice(0, 60) }; }
}

/* Every type any poe.ninja page has been observed to use, thrown at every
   family. Wrong combinations just 404, which is the point. */
const TYPES = [
  "Currency", "Fragment", "Scarab", "Astrolabe", "Omen", "Tattoo", "AllflameEmber",
  "Runegraft", "DjinnCoin", "DivinationCard", "Artifact", "Oil", "DeliriumOrb",
  "Fossil", "Resonator", "Essence", "Catalyst", "Invitation", "Incubator", "Vial",
  "Memory", "Beast", "Coffin", "Tincture", "UniqueRelic", "Map", "UniqueMap",
  "BlightedMap", "BlightRavagedMap", "UniqueWeapon", "UniqueArmour",
  "UniqueAccessory", "UniqueFlask", "UniqueJewel", "SkillGem", "BaseType",
];
const FAMILIES = [
  { key: "exchange", url: (l, t) => `${NINJA}/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(l)}&type=${t}` },
  { key: "stash-item", url: (l, t) => `${NINJA}/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(l)}&type=${t}` },
  { key: "stash-currency", url: (l, t) => `${NINJA}/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(l)}&type=${t}` },
  { key: "legacy-currency", url: (l, t) => `${NINJA}/api/data/currencyoverview?league=${encodeURIComponent(l)}&type=${t}` },
  { key: "legacy-item", url: (l, t) => `${NINJA}/api/data/itemoverview?league=${encodeURIComponent(l)}&type=${t}` },
];

const SMALL = new Set(["of", "the", "a", "and", "in"]);
function slugToName(slug) {
  if (typeof slug !== "string") return null;
  const out = [];
  for (const [i, w] of slug.split("-").entries()) {
    if (w === "s" && out.length) { out[out.length - 1] += "'s"; continue; }
    out.push(i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ");
}

/* Pull {name, value} out of whichever shape came back. */
function rows(j) {
  if (!j || j.__status || j.__error || !Array.isArray(j.lines)) return null;
  const byId = {};
  for (const it of (j.core?.items || [])) {
    if (it.id != null) byId[it.id] = it.name;
    if (it.itemId != null) byId[it.itemId] = it.name;
  }
  return j.lines.map((l) => {
    const id = l.id ?? l.itemId;
    return {
      name: l.name || l.currencyTypeName || byId[id] || slugToName(id),
      value: l.chaosValue ?? l.chaosEquivalent ?? l.primaryValue ?? null,
      raw: l.chaosValue != null || l.chaosEquivalent != null ? "chaos" : "primary",
    };
  }).filter((r) => r.name);
}

const leagues = leagueArg ? [leagueArg] : await (async () => {
  const j = await tryJson(`${NINJA}/poe1/api/economy/leagues`);
  return Array.isArray(j) && j.length ? [j[0].id || j[0].name] : ["Standard"];
})();
const league = leagues[0];
console.log(`league: ${league}${needle ? `   looking for: "${needle}"` : ""}\n`);

const want = needle ? norm(needle) : null;
const found = [];
for (const fam of FAMILIES) {
  const answered = [];
  for (const t of TYPES) {
    const j = await tryJson(fam.url(league, t));
    await sleep(DELAY_MS);
    const r = rows(j);
    if (!r || !r.length) continue;
    answered.push(`${t}:${r.length}`);
    if (want) {
      for (const line of r) {
        if (norm(line.name) === want) found.push({ fam: fam.key, type: t, ...line });
      }
    }
  }
  console.log(`${fam.key.padEnd(16)} ${answered.length ? answered.join(" ") : "(nothing answered)"}`);
}

if (want) {
  console.log("");
  if (found.length) {
    for (const f of found) {
      console.log(`FOUND  ${f.name}  in ${f.fam} type=${f.type}  value=${f.value} (${f.raw})`);
    }
  } else {
    console.log(`NOT FOUND: "${needle}" is not returned by any family/type combination for ${league}.`);
  }
}
