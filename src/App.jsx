import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceDot, ReferenceArea, ResponsiveContainer,
} from "recharts";
import PriceChart, { PctBadge, dayAxis, fmtDay, fmtRate, rateAt, realPct } from "./PriceChart.jsx";
import Overview from "./Overview.jsx";
import BossProfit from "./BossProfit.jsx";
import Delve from "./Delve.jsx";
import { SMART_DIV_AT, fmtChaos, fmtDiv, fmtPrice, unitFor, unitForSeries } from "./money.js";
import { CHANGE_KEYS, CHANGE_WINDOW_OPTIONS, nearestRateWindow, weightedChange } from "./marketWindows.js";
import { TAB_CATEGORIES } from "./categories.js";
import {
  FARM_STRATEGY_COUNT_LIMIT, computeFarmStrategy, defaultFarmStrategy,
  loadFarmStrategies, makeFarmStrategyId, sanitizeFarmStrategy, saveFarmStrategies,
} from "./farmStrategy.js";

/* ================================================================
   POE 1 SCARAB PRICE TRACKER
   - Tries live poe.ninja data on load (works when self-hosted).
   - Falls back to a deterministic demo snapshot inside Claude,
     where outbound requests to poe.ninja are blocked.
   Live endpoints used when reachable:
     GET /poe1/api/data/index-state                   -> league list
     GET /api/data/itemoverview?league=X&type=Scarab  -> prices
     GET /api/data/currencyoverview?league=X&type=Currency -> divine rate
     GET /api/data/itemhistory?league=X&type=Scarab&itemId=N -> history
   ================================================================ */

/* Proxy path first (vite dev server / nginx rewrites /ninja -> poe.ninja,
   dodging CORS), direct URLs as fallback. poe.ninja moved PoE 1 endpoints
   under /poe1/ — the old /api/data paths are kept as a last resort. */
const API_BASES = [
  "/ninja/poe1/api/data",
  "https://poe.ninja/poe1/api/data",
  "/ninja/api/data",
  "https://poe.ninja/api/data",
];
const DEMO_LEAGUE_DAYS = 92;
const DEMO_DIVINE_RATE = 185;

async function ninjaFetch(path, opts) {
  let lastErr;
  for (const base of API_BASES) {
    try {
      const res = await fetch(base + path, opts);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${base}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("poe.ninja unreachable");
}

/* Pre-built JSON snapshots (written by scripts/fetch-data.mjs, deployed by
   the GitHub Actions workflow). Tried before the live API — this is what
   makes static hosting like GitHub Pages work without a CORS proxy. */
const STATIC_BASE = `${import.meta.env.BASE_URL}data`;

/* ---------------- scarab catalogue (from the stash tab) -------- */

const GROUPS = {
  Breach: ["Breach Scarab of the Hive", "Breach Scarab of the Dreamer", "Breach Scarab of Instability", "Breach Scarab of the Marshal", "Breach Scarab of the Incensed Swarm", "Breach Scarab of Resonant Cascade"],
  Kalguuran: ["Kalguuran Scarab", "Kalguuran Scarab of Guarded Riches", "Kalguuran Scarab of Refinement", "Kalguuran Scarab of Enriching"],
  Cartography: ["Cartography Scarab of Escalation", "Cartography Scarab of Risk", "Cartography Scarab of the Multitude", "Cartography Scarab of Corruption", "Cartography Scarab of Singularity"],
  Titanic: ["Titanic Scarab", "Titanic Scarab of Treasures", "Titanic Scarab of Legend"],
  Bestiary: ["Bestiary Scarab", "Bestiary Scarab of Duplicating", "Bestiary Scarab of the Herd", "Bestiary Scarab of the Shadowed Crow"],
  Influence: ["Influencing Scarab of the Shaper", "Influencing Scarab of the Elder", "Influencing Scarab of Interference", "Influencing Scarab of Hordes"],
  Sulphite: ["Sulphite Scarab", "Sulphite Scarab of Greed", "Sulphite Scarab of Fumes"],
  Divination: ["Divination Scarab of The Cloister", "Divination Scarab of Pilfering", "Divination Scarab of Plenty"],
  Torment: ["Torment Scarab", "Torment Scarab of Peculiarity", "Torment Scarab of Release", "Torment Scarab of Possession"],
  Ambush: ["Ambush Scarab", "Ambush Scarab of Hidden Compartments", "Ambush Scarab of Potency", "Ambush Scarab of Containment", "Ambush Scarab of Discernment"],
  Expedition: ["Expedition Scarab", "Expedition Scarab of Runefinding", "Expedition Scarab of Verisium Powder", "Expedition Scarab of Archaeology", "Expedition Scarab of Infusion"],
  Legion: ["Legion Scarab", "Legion Scarab of Officers", "Legion Scarab of Treasures", "Legion Scarab of The Sekhema", "Legion Scarab of Eternal Conflict"],
  Abyss: ["Abyss Scarab", "Abyss Scarab of Multitudes", "Abyss Scarab of Edifice", "Abyss Scarab of Descending", "Abyss Scarab of Profound Depth"],
  Anarchy: ["Anarchy Scarab", "Anarchy Scarab of Gigantification", "Anarchy Scarab of Partnership", "Anarchy Scarab of the Exceptional"],
  Essence: ["Essence Scarab", "Essence Scarab of Ascent", "Essence Scarab of Calcification", "Essence Scarab of Stability", "Essence Scarab of Adaptation"],
  Domination: ["Domination Scarab", "Domination Scarab of Apparitions", "Domination Scarab of Evolution", "Domination Scarab of Terrors"],
  Ritual: ["Ritual Scarab of Selectiveness", "Ritual Scarab of Wisps", "Ritual Scarab of Abundance", "Ritual Scarab of Corpses"],
  Harvest: ["Harvest Scarab", "Harvest Scarab of Cornucopia", "Harvest Scarab of Doubling"],
  Incursion: ["Incursion Scarab", "Incursion Scarab of Invasion", "Incursion Scarab of Timelines", "Incursion Scarab of Champions"],
  Betrayal: ["Betrayal Scarab", "Betrayal Scarab of the Allflame", "Betrayal Scarab of Unbreaking", "Betrayal Scarab of Reinforcements"],
  Beyond: ["Beyond Scarab", "Beyond Scarab of Corruption", "Beyond Scarab of Haemophilia", "Beyond Scarab of the Invasion", "Beyond Scarab of Resurgence"],
  Ultimatum: ["Ultimatum Scarab", "Ultimatum Scarab of Bribing", "Ultimatum Scarab of Dueling", "Ultimatum Scarab of Catalysing", "Ultimatum Scarab of Inscription"],
  Delirium: ["Delirium Scarab", "Delirium Scarab of Mania", "Delirium Scarab of Paranoia", "Delirium Scarab of Neuroses", "Delirium Scarab of Delusions"],
  Blight: ["Blight Scarab", "Blight Scarab of Bounty", "Blight Scarab of the Blightheart", "Blight Scarab of Blooming", "Blight Scarab of Invigoration"],
  Horned: ["Horned Scarab of Bloodlines", "Horned Scarab of Nemeses", "Horned Scarab of Preservation", "Horned Scarab of Awakening", "Horned Scarab of Tradition", "Horned Scarab of Glittering", "Horned Scarab of Pandemonium"],
  Universal: ["Scarab of Monstrous Lineage", "Scarab of Adversaries", "Scarab of Divinity", "Scarab of Hunted Traitors", "Scarab of Stability", "Scarab of Wisps", "Scarab of the Sinistral", "Scarab of the Dextral", "Scarab of Radiant Storms"],
};

/* Search terms are ANDed, so "breach hive" and "hive breach" both find the
   same scarab and word order doesn't matter. */
function searchTerms(q) {
  return (q || "").toLowerCase().split(/\s+/).filter(Boolean);
}
function matchesAll(name, terms) {
  const n = name.toLowerCase();
  return terms.every((t) => n.includes(t));
}
/* "Breach Scarab of the Hive" -> "the Hive"; base scarabs keep their full name. */
function shortScarab(name) {
  return name.replace(/^.*Scarab( of)? ?/, "").trim() || name;
}

/* Assign any scarab name (incl. ones poe.ninja adds later) to a group. */
function groupForName(name) {
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(name)) return g;
  if (/^Horned Scarab/.test(name)) return "Horned";
  if (/^Scarab of/.test(name)) return "Universal";
  if (/^Influencing Scarab/.test(name)) return "Influence";
  const m = name.match(/^(\w+) Scarab/);
  return m ? m[1] : "Universal";
}

/* ---------------- demo snapshot (deterministic) ---------------- */

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_PRICE_OVERRIDES = {
  "Horned Scarab of Pandemonium": 950, "Horned Scarab of Awakening": 700, "Horned Scarab of Bloodlines": 320,
  "Horned Scarab of Tradition": 260, "Horned Scarab of Nemeses": 180, "Horned Scarab of Glittering": 140,
  "Horned Scarab of Preservation": 90,
  "Divination Scarab of The Cloister": 180, "Divination Scarab of Plenty": 25,
  "Breach Scarab of the Dreamer": 120, "Breach Scarab of Resonant Cascade": 35, "Breach Scarab of the Incensed Swarm": 15,
  "Harvest Scarab of Doubling": 150, "Harvest Scarab of Cornucopia": 30, "Harvest Scarab": 12,
  "Bestiary Scarab of Duplicating": 110, "Bestiary Scarab of the Shadowed Crow": 18,
  "Titanic Scarab of Legend": 95, "Titanic Scarab of Treasures": 30,
  "Scarab of Divinity": 90, "Scarab of Monstrous Lineage": 40, "Scarab of Radiant Storms": 25,
  "Domination Scarab of Terrors": 70, "Delirium Scarab of Delusions": 60, "Legion Scarab of Eternal Conflict": 55,
  "Ultimatum Scarab of Catalysing": 45, "Beyond Scarab of Resurgence": 40, "Essence Scarab of Adaptation": 35,
  "Cartography Scarab of Risk": 30, "Delirium Scarab of Neuroses": 30, "Ritual Scarab of Abundance": 30,
  "Kalguuran Scarab of Enriching": 25, "Ultimatum Scarab of Inscription": 25, "Beyond Scarab of Haemophilia": 25,
  "Cartography Scarab of Singularity": 20, "Legion Scarab of The Sekhema": 20, "Ritual Scarab of Corpses": 20,
  "Expedition Scarab of Verisium Powder": 18, "Ultimatum Scarab of Bribing": 15,
  "Cartography Scarab of Corruption": 12, "Kalguuran Scarab of Refinement": 12, "Delirium Scarab of Paranoia": 12,
  "Domination Scarab of Evolution": 12, "Essence Scarab of Stability": 10,
};

function demoBasePrice(name) {
  if (DEMO_PRICE_OVERRIDES[name] != null) return DEMO_PRICE_OVERRIDES[name];
  const r = mulberry32(hashStr(name))();
  return Math.round((0.5 + r * 8) * 10) / 10; // 0.5c – 8.5c filler tier
}

/* Full-league price curve with visible highs/lows: drift + one event
   spike + end-of-league selloff, all seeded by the scarab name. */
function demoHistory(name, base) {
  const rnd = mulberry32(hashStr(name + "|hist"));
  const start = base * (0.45 + rnd() * 0.5);
  const drift = (rnd() - 0.35) * 0.012;
  const spikeDay = 10 + Math.floor(rnd() * 60);
  const spikeMag = 1.25 + rnd() * 1.1;
  const spikeLen = 4 + Math.floor(rnd() * 6);
  const pts = [];
  let noise = 0;
  for (let d = 0; d <= DEMO_LEAGUE_DAYS; d++) {
    noise = noise * 0.82 + (rnd() - 0.5) * 0.09;
    let v = start * (1 + drift * d) * (1 + noise);
    const sd = d - spikeDay;
    if (sd >= 0 && sd < spikeLen) v *= 1 + (spikeMag - 1) * Math.sin((sd / spikeLen) * Math.PI);
    if (d > DEMO_LEAGUE_DAYS - 15) v *= 1 - 0.4 * ((d - (DEMO_LEAGUE_DAYS - 15)) / 15);
    // pull the curve toward "today's" snapshot price near the end
    const w = d / DEMO_LEAGUE_DAYS;
    v = v * (1 - w * 0.35) + base * (w * 0.35);
    pts.push({ day: d, value: Math.max(0.2, Math.round(v * 10) / 10) });
  }
  return pts;
}

/* Chaos deflates over a league — the demo curve climbs to DEMO_DIVINE_RATE so
   the divine-adjusted toggle has something to show without live data. */
function demoRateHistory() {
  const rnd = mulberry32(hashStr("divine|rate"));
  const start = DEMO_DIVINE_RATE * 0.42;
  const pts = [];
  let noise = 0;
  for (let d = 0; d <= DEMO_LEAGUE_DAYS; d++) {
    noise = noise * 0.9 + (rnd() - 0.5) * 0.02;
    const w = d / DEMO_LEAGUE_DAYS;
    const v = (start + (DEMO_DIVINE_RATE - start) * Math.pow(w, 0.75)) * (1 + noise);
    pts.push({ day: d, rate: Math.round(v) });
  }
  pts[pts.length - 1].rate = DEMO_DIVINE_RATE;
  return pts;
}

function buildDemoData() {
  const items = [];
  const rateHistory = demoRateHistory();
  const rAt = (i) => rateHistory[Math.max(0, rateHistory.length + i)].rate;
  const [r0, r1, r2] = [rAt(-1), rAt(-2), rAt(-3)];
  let id = 1;
  for (const [group, names] of Object.entries(GROUPS)) {
    for (const name of names) {
      const chaos = demoBasePrice(name);
      const h = demoHistory(name, chaos);
      const last = h[h.length - 1].value, d1 = h[h.length - 2].value, d2 = h[h.length - 3].value;
      items.push({
        id: id++, name, group, chaosValue: chaos, divineValue: chaos / DEMO_DIVINE_RATE,
        change24: (last / d1 - 1) * 100, change48: (last / d2 - 1) * 100,
        change24R: ((last / r0) / (d1 / r1) - 1) * 100, change48R: ((last / r0) / (d2 / r2) - 1) * 100,
      });
    }
  }
  return { items, rateHistory };
}

/* ---------------- shared helpers ------------------------------- */

/* fmtDay / dayAxis / rateAt / realPct / fmtRate / PctBadge live in
   PriceChart.jsx — they are the chart's vocabulary and three tabs share it. */

function ScarabIcon({ size = 22, tone = "#ef4f19" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <ellipse cx="12" cy="13.5" rx="6.4" ry="7.2" fill={tone} opacity="0.9" />
      <ellipse cx="12" cy="13.5" rx="6.4" ry="7.2" fill="none" stroke="#1b150c" strokeWidth="1.1" />
      <line x1="12" y1="6.5" x2="12" y2="20.6" stroke="#1b150c" strokeWidth="1.1" />
      <path d="M6 10 Q12 12.6 18 10" fill="none" stroke="#1b150c" strokeWidth="1.1" />
      <circle cx="12" cy="4.6" r="2.1" fill={tone} stroke="#1b150c" strokeWidth="1.1" />
      <path d="M9.6 3.4 L7.4 1.6 M14.4 3.4 L16.6 1.6" stroke={tone} strokeWidth="1.3" fill="none" />
      <path d="M6.2 9 L3.4 7.4 M6 14 L3 14 M6.6 18 L4 19.8 M17.8 9 L20.6 7.4 M18 14 L21 14 M17.4 18 L20 19.8" stroke={tone} strokeWidth="1.2" />
    </svg>
  );
}

function StrategySlotPicker({ index, value, items, kind = "scarab", open, query, onOpen, onQuery, onSelect }) {
  const selected = items.find((item) => item.name === value);
  const label = kind === "astrolabe" ? "Astrolabe" : "Scarab";
  const terms = searchTerms(query);
  const choices = items
    .filter((item) => matchesAll(item.name, terms))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80);
  const tone = selected ? (GROUP_TONES[selected.group] || "#ef4f19") : "#6b4a3b";
  const icon = (item, size) => kind === "astrolabe"
    ? <CategoryIcon name={item.name} shape="ring" size={size} />
    : <ScarabIcon size={size} tone={GROUP_TONES[item.group] || tone} />;
  return (
    <div className={`st-strat-picker${index > 2 ? " edge" : ""}`}>
      <button type="button" className={`st-strat-slot${selected ? " filled" : ""}`}
        title={selected?.name || `Choose ${label.toLowerCase()}${kind === "scarab" ? ` ${index + 1}` : ""}`}
        aria-expanded={open} onClick={onOpen}>
        {selected ? icon(selected, 21) : <span>+</span>}
        <b>{selected ? (kind === "scarab" ? shortScarab(selected.name) : selected.name) : `${label}${kind === "scarab" ? ` ${index + 1}` : ""}`}</b>
      </button>
      {open && (
        <div className="st-strat-menu">
          <input autoFocus type="search" value={query} onChange={(event) => onQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}s`} aria-label={`Search for ${label.toLowerCase()}`} />
          {value && <button type="button" className="st-strat-clear" onClick={() => onSelect("")}>Clear slot</button>}
          <div className="st-strat-results" role="listbox">
            {choices.map((item) => (
              <button type="button" role="option" aria-selected={item.name === value}
                key={item.name} title={item.name} onClick={() => onSelect(item.name)}>
                {icon(item, 17)}
                <span>{item.name}</span><em>{fmtChaos(item.chaosValue)}c</em>
              </button>
            ))}
            {!choices.length && <small>No {label.toLowerCase()} matches that search.</small>}
          </div>
        </div>
      )}
    </div>
  );
}


/* ---------------- extra price-check categories (Astrolabes, Catalysts) ---- */

/* Tabs that render their own control strip instead of the shared one, and
   so also opt out of the shared connection banners. */
const OWN_BAR = { overview: true, bosses: true, delve: true };

/* Which families get their own tab, and how to fetch them live. Defined in
   src/categories.js so the snapshot script and the app cannot disagree. */
const CATEGORY_TABS = TAB_CATEGORIES;

const SMALL_WORDS = new Set(["of", "the", "a", "and", "in"]);
function slugToName(slug) {
  if (!slug || typeof slug !== "string") return null;
  // poe.ninja slugs turn apostrophes into separators, so a lone "s" segment
  // is a possessive: "the-maven-s-writ" -> "The Maven's Writ".
  const out = [];
  for (const [i, w] of slug.split("-").entries()) {
    if (w === "s" && out.length) { out[out.length - 1] += "'s"; continue; }
    out.push((i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ");
}

const EXCHANGE_BASES = ["/ninja/poe1/api/economy", "https://poe.ninja/poe1/api/economy"];
async function exchangeFetch(path) {
  let lastErr;
  for (const base of EXCHANGE_BASES) {
    try {
      const res = await fetch(base + path);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("unreachable");
}

/* Same adaptation the snapshot script uses, for live/dev mode. */
function adaptExchangeLite(j, nameRe) {
  const core = j.core || {};
  const coreItems = core.items || [];
  const byId = {};
  for (const it of coreItems) { if (it.id != null) byId[it.id] = it; if (it.itemId != null) byId[it.itemId] = it; }
  const findId = (n) => { for (const it of coreItems) if ((it.name || "").toLowerCase() === n) return it.id ?? it.itemId; return null; };
  const chaosId = findId("chaos orb"), divineId = findId("divine orb");
  const rates = core.rates || {};
  const rChaos = core.primary === chaosId ? (rates[chaosId] ?? 1) : rates[chaosId];
  const raw = (j.lines || [])
    .map((l) => ({ line: l, name: (byId[l.id] || byId[l.itemId] || {}).name || l.name || slugToName(l.id ?? l.itemId) }))
    .filter((x) => x.name && nameRe.test(x.name));
  if (!raw.length) return { items: [] };
  const mult = (!rChaos || rChaos === 1) ? 1 : rChaos;
  let divineRate = null;
  if (rChaos != null && rates[divineId]) {
    for (const c of [rChaos / rates[divineId], rates[divineId] / rChaos]) if (c >= 20 && c <= 20000) { divineRate = c; break; }
  }
  const items = raw.map(({ line, name }) => {
    const sp = (((line.sparkline || line.sparkLine) || {}).data || []).filter((v) => v != null);
    const last = sp.length ? sp[sp.length - 1] : 0;
    const p24 = sp.length > 1 ? sp[sp.length - 2] : last;
    const p48 = sp.length > 2 ? sp[sp.length - 3] : p24;
    const chaos = Math.max(0, (line.primaryValue ?? 0) * mult);
    return {
      id: line.id ?? name, name,
      chaosValue: Math.round(chaos * 100) / 100,
      divineValue: divineRate ? chaos / divineRate : 0,
      change24: last - p24, change48: last - p48,
    };
  });
  return { items, divineRate: divineRate ?? undefined };
}

function CategoryIcon({ name, shape, size = 20 }) {
  const tone = `hsl(${hashStr(name) % 360} 42% 62%)`;
  if (shape === "ring") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke={tone} strokeWidth="2.4" />
        <circle cx="12" cy="12" r="4" fill="none" stroke={tone} strokeWidth="1.3" />
        <line x1="12" y1="2.5" x2="12" y2="7" stroke={tone} strokeWidth="1.3" />
        <line x1="12" y1="12" x2="16.5" y2="8.5" stroke={tone} strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 2.5 L19 9 L12 21.5 L5 9 Z" fill={tone} opacity="0.85" stroke="#1b150c" strokeWidth="1.1" />
      <path d="M5 9 L19 9 M12 2.5 L9 9 L12 21.5 M12 2.5 L15 9 L12 21.5" fill="none" stroke="#1b150c" strokeWidth="0.9" />
    </svg>
  );
}

const GROUP_TONES = {
  Breach: "#b06ad4", Legion: "#8f6ad4", Delirium: "#9fb6c9", Blight: "#9fc96a", Harvest: "#5fc9b0",
  Abyss: "#7fd46a", Beyond: "#d46a6a", Betrayal: "#d4a06a", Incursion: "#6ad4c3", Ultimatum: "#d46a94",
  Essence: "#6a9fd4", Ritual: "#d46a6a", Domination: "#d4d16a", Anarchy: "#d48c6a", Expedition: "#6ad48c",
  Ambush: "#c9c46a", Torment: "#8c8f96", Divination: "#6ac3d4", Sulphite: "#d4c46a", Influence: "#8f9fd4",
  Bestiary: "#c96a3f", Titanic: "#d4886a", Cartography: "#6a8cd4", Kalguuran: "#d4b06a",
  Horned: "#e05f5f", Universal: "#b8b3a6", Breachstone: "#b06ad4",
};

/* ================================================================ */

export default function ScarabTracker() {
  const [mode, setMode] = useState("connecting");        // connecting | live | demo
  const [leagues, setLeagues] = useState([]);
  const [league, setLeague] = useState("");
  const [items, setItems] = useState([]);                 // {id,name,group,chaosValue,divineValue}
  const [divineRate, setDivineRate] = useState(DEMO_DIVINE_RATE);
  const [currency, setCurrency] = useState("smart");      // chaos | divine | smart
  const [sortDir, setSortDir] = useState("desc");         // desc | asc
  const [showUniversal, setShowUniversal] = useState(true);
  const [showHorned, setShowHorned] = useState(true);
  const [chgWindow, setChgWindow] = useState("24h");      // 24h | 48h
  const [tab, setTab] = useState("overview");             // overview | farms | watcher | prices | astrolabes | catalysts | bosses | delve
  const [bossTarget, setBossTarget] = useState(null);      // boss opened from an Overview signal
  const [openGroup, setOpenGroup] = useState(null);
  const [focusScarab, setFocusScarab] = useState(null);
  const [histories, setHistories] = useState({});         // name -> [{day,value}]
  const [histLoading, setHistLoading] = useState(false);
  const [dataSource, setDataSource] = useState(null);     // "static" | "api" | null
  const staticSlugsRef = useRef({});                      // league name -> folder slug
  const [staticInfo, setStaticInfo] = useState(null);     // { generatedAt }
  const staticHistFetched = useRef(new Set());            // leagues whose history.json was loaded
  const [catData, setCatData] = useState({});             // tab key -> {items, divineRate, generatedAt} | "missing"
  const [catHist, setCatHist] = useState({});             // tab key -> {name: [{day,value}]}
  const [catSelected, setCatSelected] = useState({});     // tab key -> selected item name
  const [catFilter, setCatFilter] = useState({});         // tab key -> filter text
  const [scarabFilter, setScarabFilter] = useState("");   // search box on the Scarabs tab
  const [dragSel, setDragSel] = useState(null);           // {start, end, active} in day units
  const [rateHistory, setRateHistory] = useState([]);     // [{day, rate}] chaos per divine
  const [realMode, setRealMode] = useState(false);        // read every % in divine terms
  const [farmStrategies, setFarmStrategies] = useState(() => loadFarmStrategies());
  const [farmDraft, setFarmDraft] = useState(() => defaultFarmStrategy());
  const [showFarmEditor, setShowFarmEditor] = useState(false);
  const [farmPicker, setFarmPicker] = useState(null);
  const [farmQuery, setFarmQuery] = useState("");
  const savedStrategyNeedsAstrolabes = farmStrategies.some((strategy) => !!strategy.astrolabe);

  /* ---- static snapshots (GitHub Pages etc.) ---- */
  const loadStaticLeague = useCallback(async (name, slugsArg) => {
    const slugs = slugsArg || staticSlugsRef.current;
    const slug = slugs[name];
    if (!slug) throw new Error("unknown league in snapshot index");
    const res = await fetch(`${STATIC_BASE}/${slug}/scarabs.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error("snapshot missing");
    const j = await res.json();
    setItems((j.items || []).map((it) => ({ ...it, group: groupForName(it.name) })));
    setDivineRate(j.divineRate || DEMO_DIVINE_RATE);
    setStaticInfo({ generatedAt: j.generatedAt, historySource: j.historySource, historyAxis: j.historyAxis, priceSource: j.priceSource });
    setRateHistory(Array.isArray(j.rateHistory) ? j.rateHistory : []);
    setMode("live"); setDataSource("static");
    staticHistFetched.current.delete(name);
    setHistories({}); setOpenGroup(null); setFocusScarab(null);
    setCatData({}); setCatHist({}); setCatSelected({}); setDragSel(null);
  }, []);

  /* ---- data loading: try live, fall back to demo ---- */
  const loadLeague = useCallback(async (lg) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const scarabRes = await ninjaFetch(`/itemoverview?league=${encodeURIComponent(lg)}&type=Scarab`, { signal: ctl.signal });
      const scarabJson = await scarabRes.json();
      let rate = DEMO_DIVINE_RATE;
      try {
        const curRes = await ninjaFetch(`/currencyoverview?league=${encodeURIComponent(lg)}&type=Currency`, { signal: ctl.signal });
        const curJson = await curRes.json();
        const div = (curJson.lines || []).find((l) => l.currencyTypeName === "Divine Orb");
        if (div?.chaosEquivalent) rate = div.chaosEquivalent;
      } catch { /* keep fallback rate */ }
      const mapped = (scarabJson.lines || []).map((l) => {
        // sparkline.data = cumulative % change vs 7 days ago, one point per day
        const sp = ((l.sparkline && l.sparkline.data) || []).filter((v) => v != null);
        const last = sp.length ? sp[sp.length - 1] : 0;
        const p24 = sp.length > 1 ? sp[sp.length - 2] : last;
        const p48 = sp.length > 2 ? sp[sp.length - 3] : p24;
        return {
          id: l.id, name: l.name, group: groupForName(l.name),
          chaosValue: l.chaosValue ?? 0,
          divineValue: l.divineValue ?? (l.chaosValue ?? 0) / rate,
          change24: last - p24, change48: last - p48,
          icon: l.icon,
        };
      });
      if (!mapped.length) throw new Error("empty");
      // The live API has no accumulated rate curve — that only exists in our
      // own snapshots, so the divine-adjusted toggle stays unavailable here.
      setRateHistory([]);
      setItems(mapped); setDivineRate(rate); setMode("live"); setDataSource("api");
      setHistories({}); setOpenGroup(null); setFocusScarab(null);
      setCatData({}); setCatHist({}); setCatSelected({}); setDragSel(null);
    } finally { clearTimeout(t); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) pre-built snapshots (GitHub Pages / any static host)
      try {
        const res = await fetch(`${STATIC_BASE}/index.json`, { cache: "no-cache" });
        if (res.ok) {
          const idx = await res.json();
          const lgs = idx.leagues || [];
          if (lgs.length) {
            if (cancelled) return;
            const slugs = {};
            for (const l of lgs) slugs[l.name] = l.slug;
            staticSlugsRef.current = slugs;
            setLeagues(lgs.map((l) => ({ name: l.name, group: l.group || "current" })));
            setLeague(lgs[0].name);
            await loadStaticLeague(lgs[0].name, slugs);
            return;
          }
        }
      } catch { /* fall through to live API */ }
      // 2) live poe.ninja API (dev proxy or direct)
      try {
        let res;
        try { res = await ninjaFetch(`/index-state`); }
        catch { res = await ninjaFetch(`/getindexstate`); }
        const idx = await res.json();
        const cur = (idx.economyLeagues || []).map((l) => ({ name: l.name, group: "current" }));
        const prev = (idx.oldEconomyLeagues || []).map((l) => ({ name: l.name, group: "previous" }));
        const lgs = [...cur, ...prev];
        if (cancelled) return;
        const first = cur[0]?.name || "Standard";
        setLeagues(lgs.length ? lgs : [{ name: "Standard", group: "current" }]);
        setLeague(first);
        await loadLeague(first);
      } catch {
        if (cancelled) return;
        const demo = buildDemoData();
        setItems(demo.items);
        setRateHistory(demo.rateHistory);
        setLeagues([{ name: "Demo snapshot", group: "current" }]);
        setLeague("Demo snapshot");
        setMode("demo");
      }
    })();
    return () => { cancelled = true; };
  }, [loadLeague, loadStaticLeague]);

  /* ---- histories for the open group (lazy) ---- */
  useEffect(() => {
    if (!openGroup) return;
    const members = items.filter((i) => i.group === openGroup);
    const missing = members.filter((m) => !histories[m.name]);
    if (!missing.length) return;

    if (mode === "demo") {
      const add = {};
      for (const m of missing) add[m.name] = demoHistory(m.name, m.chaosValue);
      setHistories((h) => ({ ...h, ...add }));
      return;
    }
    if (dataSource === "static") {
      if (staticHistFetched.current.has(league)) return; // file already merged; anything missing has no data
      staticHistFetched.current.add(league);
      let cancelled = false;
      setHistLoading(true);
      (async () => {
        try {
          const slug = staticSlugsRef.current[league];
          const res = await fetch(`${STATIC_BASE}/${slug}/history.json`, { cache: "no-cache" });
          if (res.ok) {
            const all = await res.json();
            if (!cancelled) setHistories((h) => ({ ...all, ...h }));
          }
        } catch { /* group panel will show "no history" */ }
        if (!cancelled) setHistLoading(false);
      })();
      return () => { cancelled = true; };
    }
    if (mode !== "live") return;
    let cancelled = false;
    setHistLoading(true);
    (async () => {
      const add = {};
      for (const m of missing) {
        try {
          const res = await ninjaFetch(`/itemhistory?league=${encodeURIComponent(league)}&type=Scarab&itemId=${m.id}`);
          const arr = await res.json();
          if (!Array.isArray(arr) || !arr.length) continue;
          // API returns [{count, value, daysAgo}] — normalise to league days ascending
          const maxAgo = Math.max(...arr.map((p) => p.daysAgo), 0);
          add[m.name] = arr
            .slice().sort((a, b) => b.daysAgo - a.daysAgo)
            .map((p) => ({ day: maxAgo - p.daysAgo, value: p.value }));
        } catch { /* keep going */ }
      }
      if (!cancelled) { setHistories((h) => ({ ...h, ...add })); setHistLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [openGroup, items, mode, league, histories, dataSource]);

  /* ---- category tab data (Astrolabes / Catalysts) ---- */
  useEffect(() => {
    const categoryKey = CATEGORY_TABS[tab]
      ? tab
      : (showFarmEditor || savedStrategyNeedsAstrolabes) ? "astrolabes" : null;
    const cat = CATEGORY_TABS[categoryKey];
    if (!cat || catData[categoryKey] !== undefined) return;
    let cancelled = false;
    (async () => {
      if (dataSource === "static") {
        try {
          const slug = staticSlugsRef.current[league];
          // Fetch data + history together, commit together: setting catData
          // first re-runs this effect and cancels the in-flight history fetch.
          const [res, hres] = await Promise.all([
            fetch(`${STATIC_BASE}/${slug}/${categoryKey}.json`, { cache: "no-cache" }),
            fetch(`${STATIC_BASE}/${slug}/${categoryKey}-history.json`, { cache: "no-cache" }).catch(() => null),
          ]);
          if (res.ok) {
            const j = await res.json();
            let h = null;
            if (hres && hres.ok) { try { h = await hres.json(); } catch { /* no history yet */ } }
            if (cancelled) return;
            if (h) setCatHist((d) => ({ ...d, [categoryKey]: h }));
            setCatData((d) => ({ ...d, [categoryKey]: j }));
            return;
          }
        } catch { /* fall through */ }
      }
      if (mode === "live" || mode === "connecting") {
        try {
          const res = await exchangeFetch(`/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(cat.type)}`);
          const adapted = adaptExchangeLite(await res.json(), cat.re);
          if (adapted.items.length && !cancelled) {
            setCatData((d) => ({ ...d, [categoryKey]: { items: adapted.items, divineRate: adapted.divineRate } }));
            return;
          }
        } catch { /* fall through */ }
      }
      if (!cancelled) setCatData((d) => ({ ...d, [categoryKey]: "missing" }));
    })();
    return () => { cancelled = true; };
  }, [tab, league, dataSource, mode, catData, showFarmEditor, savedStrategyNeedsAstrolabes]);

  /* ---- derived ---- */
  const groups = useMemo(() => {
    const byGroup = {};
    for (const it of items) { if (!byGroup[it.group]) byGroup[it.group] = []; byGroup[it.group].push(it); }
    let arr = Object.entries(byGroup).map(([name, members]) => {
      const changes = {};
      for (const key of Object.values(CHANGE_KEYS)) {
        changes[key] = weightedChange(members, key);
        changes[`${key}R`] = weightedChange(members, `${key}R`);
      }
      return {
        name, members: members.slice().sort((a, b) => b.chaosValue - a.chaosValue),
        total: members.reduce((s, m) => s + m.chaosValue, 0),
        ...changes,
      };
    });
    if (!showUniversal) arr = arr.filter((g) => g.name !== "Universal");
    if (!showHorned) arr = arr.filter((g) => g.name !== "Horned");
    arr.sort((a, b) => (sortDir === "desc" ? b.total - a.total : a.total - b.total));
    return arr;
  }, [items, sortDir, showUniversal, showHorned]);

  const openGroupData = openGroup ? groups.find((g) => g.name === openGroup) : null;

  /* Search on the Scarabs tab. The grid is mechanics, not scarabs, so a query
     keeps a mechanic when the mechanic itself matches OR any of its scarabs do,
     and the card reports which ones hit. `groups` stays unfiltered on purpose —
     Popular farms reads it and shouldn't follow the search box. */
  const scarabTerms = useMemo(() => searchTerms(scarabFilter), [scarabFilter]);
  const visibleGroups = useMemo(() => {
    const ranked = groups.map((g, i) => ({ ...g, rank: sortDir === "desc" ? i + 1 : groups.length - i }));
    if (!scarabTerms.length) return ranked.map((g) => ({ ...g, matches: [] }));
    return ranked
      .map((g) => {
        const matches = g.members.filter((m) => matchesAll(m.name, scarabTerms)).map((m) => m.name);
        const groupHit = matchesAll(`${g.name} scarabs`, scarabTerms);
        return (groupHit || matches.length) ? { ...g, matches } : null;
      })
      .filter(Boolean);
  }, [groups, scarabTerms, sortDir]);

  const chart = useMemo(() => {
    if (!openGroupData) return { rows: [], cur: currency === "smart" ? "chaos" : currency };
    const memberHists = openGroupData.members.map((m) => histories[m.name]).filter((h) => h && h.length);
    if (!memberHists.length) return { rows: [], cur: currency === "smart" ? "chaos" : currency };
    // Self-history uses fractional days (multiple snapshots per day), so build
    // one row per distinct day value instead of iterating integer days.
    const daySet = new Set();
    for (const h of memberHists) for (const p of h) daySet.add(p.day);
    const days = [...daySet].sort((a, b) => a - b);
    // Build in chaos first: under Smart the unit depends on how big the series
    // gets, which isn't known until every point exists.
    const raw = days.map((d) => {
      let total = 0, focus = null;
      for (const m of openGroupData.members) {
        const h = histories[m.name];
        if (!h || !h.length) continue;
        const pt = h.find((p) => p.day === d) ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]);
        total += pt.value;
        if (focusScarab === m.name) focus = pt.value;
      }
      return { day: d, chaosTotal: total, chaosFocus: focus, rate: rateAt(rateHistory, d) };
    });
    const cur = unitForSeries(raw.map((r) => r.chaosTotal), currency, divineRate);
    const div = cur === "divine" ? divineRate : 1;
    // `chaos` stays unscaled: the real-% maths has to divide by the rate that
    // applied on that day, not by today's.
    const rows = raw.map((r) => ({
      day: r.day, chaos: r.chaosTotal, rate: r.rate,
      value: Math.round((r.chaosTotal / div) * 100) / 100,
      overlay: r.chaosFocus == null ? null : Math.round((r.chaosFocus / div) * 100) / 100,
    }));
    return { rows, cur };
  }, [openGroupData, histories, currency, divineRate, focusScarab, rateHistory]);

  const chartData = chart.rows;
  const chartCur = chart.cur;                       // the panel graph's single unit
  const chartUnit = chartCur === "chaos" ? "c" : "div";

  // Axis wording: ninja history is aligned to league days; our own snapshots
  // count from the first run.
  const scarabAxisLabel = (dataSource === "static" && staticInfo?.historyAxis)
    ? staticInfo.historyAxis
    : (dataSource === "static" && staticInfo?.historySource === "self")
      ? "days since first snapshot" : "league day";

  /* high/low markers are computed inside PriceChart */

  const chgKey = CHANGE_KEYS[chgWindow] || "change24";

  /* ---- divine-adjusted view ----
     Two things can be missing independently: the rate curve for the chart, and
     the per-item divine-denominated change windows (older snapshots were
     written without a rate, so their windows can't be converted). The toggle
     turns on whatever is actually there. */
  const catRateHistory = (CATEGORY_TABS[tab] && catData[tab] && catData[tab] !== "missing" && Array.isArray(catData[tab].rateHistory))
    ? catData[tab].rateHistory : null;
  const activeRateHistory = (catRateHistory && catRateHistory.length > 1) ? catRateHistory : rateHistory;
  const rateReady = activeRateHistory.length > 1;
  const realKey = `${chgKey}R`;
  const badgeSource = CATEGORY_TABS[tab] && catData[tab] && catData[tab] !== "missing" ? catData[tab].items : items;
  const realBadges = realMode && (badgeSource || []).some((i) => i[realKey] != null && isFinite(i[realKey]));
  const activeKey = realBadges ? realKey : chgKey;
  const chgBadge = (o) => {
    const useReal = realBadges && o[realKey] != null && isFinite(o[realKey]);
    return <PctBadge v={useReal ? o[realKey] : o[chgKey]} real={useReal} />;
  };

  /* Headline drift for the banner: what a divine did over the same window the
     % badges are using. This is the number that explains the rest. */
  const rateDrift = useMemo(() => {
    if (!rateReady) return null;
    const window = nearestRateWindow(activeRateHistory, chgWindow);
    return window ? { pct: window.pct, now: window.last.rate } : null;
  }, [activeRateHistory, rateReady, chgWindow]);

  const movers = useMemo(() => {
    const rising = groups.filter((g) => isFinite(g[activeKey]) && g[activeKey] > 0.5).sort((a, b) => b[activeKey] - a[activeKey]).slice(0, 8);
    const falling = groups.filter((g) => isFinite(g[activeKey]) && g[activeKey] < -0.5).sort((a, b) => a[activeKey] - b[activeKey]).slice(0, 8);
    const maxAbs = Math.max(1, ...rising.map((g) => Math.abs(g[activeKey])), ...falling.map((g) => Math.abs(g[activeKey])));
    const pool = groups.flatMap((g) => g.members);
    const topScarabs = pool
      .filter((m) => m.chaosValue >= 1 && isFinite(m[activeKey]))
      .sort((a, b) => Math.abs(b[activeKey]) - Math.abs(a[activeKey]))
      .slice(0, 12);
    return { rising, falling, maxAbs, topScarabs };
  }, [groups, activeKey]);

  const strategyAstrolabes = useMemo(
    () => catData.astrolabes && catData.astrolabes !== "missing" ? catData.astrolabes.items || [] : [],
    [catData.astrolabes],
  );
  const customFarms = useMemo(
    () => farmStrategies.map((strategy) => computeFarmStrategy(strategy, items, strategyAstrolabes)),
    [farmStrategies, items, strategyAstrolabes],
  );
  const farmDirection = (farm) => {
    const change = farm[activeKey];
    return Number.isFinite(change)
      ? change > 0 ? "more expensive" : change < 0 ? "cheaper" : "unchanged"
      : "history building";
  };
  const openFarmEditor = (strategy = null) => {
    const next = strategy || { ...defaultFarmStrategy(), id: makeFarmStrategyId(), name: `Farming strat ${farmStrategies.length + 1}` };
    setFarmDraft({ ...next, scarabs: [...next.scarabs] });
    setFarmPicker(null); setFarmQuery(""); setShowFarmEditor(true);
  };
  const saveFarmDraft = () => {
    const clean = sanitizeFarmStrategy(farmDraft);
    if (!clean.id) clean.id = makeFarmStrategyId();
    const exists = farmStrategies.some((strategy) => strategy.id === clean.id);
    const next = exists
      ? farmStrategies.map((strategy) => strategy.id === clean.id ? clean : strategy)
      : [...farmStrategies, clean].slice(0, FARM_STRATEGY_COUNT_LIMIT);
    setFarmStrategies(saveFarmStrategies(next));
    setShowFarmEditor(false); setFarmPicker(null); setFarmQuery("");
  };
  const deleteFarmStrategy = (id) => {
    setFarmStrategies((current) => saveFarmStrategies(current.filter((strategy) => strategy.id !== id)));
    if (farmDraft.id === id) setShowFarmEditor(false);
  };

  /* ---- render ---- */
  return (
    <div className="st-root">
      <style>{css}</style>

      <header className="st-head">
        <div className="st-title-block">
          <h1><span>Vaal</span> Street</h1>
          <p className="st-sub">Path of Exile · farming profits and market prices</p>
        </div>
        <div className="st-controls">
          <label className="st-ctl">
            <span>League</span>
            <select value={league} disabled={mode !== "live"} onChange={(e) => { const v = e.target.value; setLeague(v); (dataSource === "static" ? loadStaticLeague(v) : loadLeague(v)).catch(() => {}); }}>
              {["current", "previous"].map((g) => {
                const opts = leagues.filter((l) => (l.group || "current") === g);
                if (!opts.length) return null;
                return (
                  <optgroup key={g} label={g === "current" ? "Current leagues" : "Previous leagues"}>
                    {opts.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <div className="st-ctl">
            <span>Currency</span>
            <div className="st-seg">
              <button className={currency === "chaos" ? "on" : ""} onClick={() => setCurrency("chaos")}>Chaos</button>
              <button className={currency === "divine" ? "on" : ""} onClick={() => setCurrency("divine")}>Divine</button>
              <button className={currency === "smart" ? "on" : ""} onClick={() => setCurrency("smart")}
                title={`Chaos below ${SMART_DIV_AT} divine, divine above it — each value in whichever unit reads cleanly`}>Smart</button>
            </div>
          </div>
        </div>
      </header>

      <nav className="st-tabs" aria-label="Views">
        <button className={tab === "overview" ? "on" : ""} onClick={() => { setTab("overview"); setDragSel(null); }}>Overview</button>
        <button className={tab === "farms" ? "on" : ""} onClick={() => { setTab("farms"); setDragSel(null); }}>Popular farms</button>
        <button className={tab === "watcher" ? "on" : ""} onClick={() => { setTab("watcher"); setDragSel(null); }}>Strat Watcher</button>
        <button className={tab === "prices" ? "on" : ""} onClick={() => { setTab("prices"); setDragSel(null); }}>Scarabs</button>
        <button className={tab === "astrolabes" ? "on" : ""} onClick={() => { setTab("astrolabes"); setDragSel(null); }}>Astrolabes</button>
        <button className={tab === "catalysts" ? "on" : ""} onClick={() => { setTab("catalysts"); setDragSel(null); }}>Catalysts</button>
        <button className={tab === "bosses" ? "on" : ""}
          onClick={() => {
            setTab("bosses"); setBossTarget(null); setDragSel(null);
            // Boss values run to thousands of chaos, so chaos is the wrong unit
            // here and entering the tab switches away from it. Smart already
            // quotes the big numbers in divine, so leave that choice alone.
            setCurrency((c) => (c === "chaos" ? "divine" : c));
          }}>Boss profit</button>
        <button className={tab === "delve" ? "on" : ""} onClick={() => { setTab("delve"); setDragSel(null); }}>
          Delve <em className="st-tab-exp">EXP</em>
        </button>
      </nav>

      {mode === "demo" && (
        <div className="st-banner">
          Demo snapshot — poe.ninja isn't reachable right now, so prices and history are generated
          sample data. Check your connection or the /ninja proxy config; the page switches to live
          data automatically once poe.ninja responds (reload to retry).
        </div>
      )}
      {mode === "connecting" && !OWN_BAR[tab] && <div className="st-banner st-quiet">Connecting to poe.ninja…</div>}
      {mode === "live" && !OWN_BAR[tab] && (
        <div className="st-banner st-quiet">
          {dataSource === "static"
            ? `${staticInfo?.priceSource ? `Prices via ${staticInfo.priceSource}` : "Snapshot data"} · ${league} · updated ${staticInfo?.generatedAt ? new Date(staticInfo.generatedAt).toLocaleString() : "recently"}`
            : `Live data · ${league}`} · 1 Divine ≈ {Math.round(divineRate)} Chaos
          {realMode && rateReady && rateDrift && (
            <span className="st-banner-real">
              {" "}· divine {rateDrift.pct >= 0 ? "+" : "−"}{Math.abs(rateDrift.pct).toFixed(1)}% in {chgWindow}
              {realBadges
                ? ", so every % below is divine-adjusted"
                : " — the % badges here predate the stored rate, so they stay in chaos"}
            </span>
          )}
        </div>
      )}

      {/* ---------- per-tab toolbar ----------
          Only the controls that actually change the view in front of you.
          The boss and delve tabs bring their own bars, so they're excluded. */}
      {!OWN_BAR[tab] && (() => {
        const isCat = !!CATEGORY_TABS[tab];
        const showSort = tab === "prices" || isCat;
        const showChange = true;                      // every non-boss tab shows % badges
        const showChecks = tab === "prices" || tab === "farms";
        return (
          <div className="st-tools">
            {showSort && (
              <div className="st-ctl">
                <span>{isCat ? "Sort by price" : "Sort by set value"}</span>
                <div className="st-seg">
                  <button className={sortDir === "desc" ? "on" : ""} onClick={() => setSortDir("desc")}>High → Low</button>
                  <button className={sortDir === "asc" ? "on" : ""} onClick={() => setSortDir("asc")}>Low → High</button>
                </div>
              </div>
            )}
            {showChange && (
              <div className="st-ctl">
                <span>Price change</span>
                <div className="st-seg">
                  {CHANGE_WINDOW_OPTIONS.map((w) => (
                    <button key={w} className={chgWindow === w ? "on" : ""} onClick={() => setChgWindow(w)}>{w}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="st-ctl st-checks">
              <span>Divine drift</span>
              <div className="st-checks-row">
                <label className={`st-check ${rateReady ? "" : "st-check-off"}`}
                  title={rateReady
                    ? "Price everything in divine instead of chaos: a scarab only counts as up if it beat the divine rate."
                    : "Needs at least two snapshots with a stored divine rate — it builds up over the next few data refreshes."}>
                  <input type="checkbox" checked={realMode && rateReady} disabled={!rateReady}
                    onChange={(e) => setRealMode(e.target.checked)} />
                  <span>Divine-adjusted</span>
                </label>
              </div>
            </div>
            {isCat && (
              <label className="st-ctl">
                <span>Filter</span>
                <input
                  className="st-tool-filter"
                  type="text"
                  placeholder={`Filter ${CATEGORY_TABS[tab].label.toLowerCase()}`}
                  value={catFilter[tab] || ""}
                  onChange={(e) => setCatFilter((f) => ({ ...f, [tab]: e.target.value }))}
                />
              </label>
            )}
            {tab === "prices" && (
              <label className="st-ctl">
                <span>Search</span>
                <div className="st-tool-search">
                  <input
                    className="st-tool-filter"
                    type="text"
                    placeholder="Scarab or mechanic"
                    value={scarabFilter}
                    onChange={(e) => setScarabFilter(e.target.value)}
                  />
                  {scarabFilter && (
                    <button type="button" className="st-tool-clear" aria-label="Clear search"
                      onClick={() => setScarabFilter("")}>✕</button>
                  )}
                </div>
              </label>
            )}
            {showChecks && (
              <div className="st-ctl st-checks">
                <span>Include</span>
                <div className="st-checks-row">
                  <label className="st-check">
                    <input type="checkbox" checked={showUniversal} onChange={(e) => setShowUniversal(e.target.checked)} />
                    <span>Universal</span>
                  </label>
                  <label className="st-check">
                    <input type="checkbox" checked={showHorned} onChange={(e) => setShowHorned(e.target.checked)} />
                    <span>Horned</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ---------- overview ---------- */}
      {tab === "overview" && (
        <Overview
          league={league}
          staticBase={staticSlugsRef.current[league] ? `${STATIC_BASE}/${staticSlugsRef.current[league]}` : STATIC_BASE}
          currency={currency}
          divineRate={divineRate}
          fmtPrice={fmtPrice}
          movers={movers}
          customFarms={customFarms}
          activeKey={activeKey}
          changeKey={chgKey}
          changeWindow={chgWindow}
          setChangeWindow={setChgWindow}
          mode={mode}
          dataSource={dataSource}
          staticInfo={staticInfo}
          onOpenTab={(nextTab, bossId = null) => {
            setTab(nextTab); setDragSel(null);
            if (nextTab === "bosses") {
              setBossTarget(bossId);
              setCurrency((current) => current === "chaos" ? "divine" : current);
            }
          }}
        />
      )}

      {/* ---------- expanded mechanic panel ---------- */}
      {tab === "prices" && openGroupData && (
        <section className="st-panel">
          <div className="st-panel-head">
            <div className="st-panel-title">
              <ScarabIcon size={26} tone={GROUP_TONES[openGroupData.name] || "#ef4f19"} />
              <h2>{openGroupData.name} scarabs</h2>
              <span className="st-panel-total">
                Set total {fmtPrice(openGroupData.total, currency, divineRate)}
              </span>
              {(openGroupData.name === "Universal" || openGroupData.name === "Horned") && (
                <em className="st-tag st-tag-panel">not tied to a mechanic</em>
              )}
            </div>
            <button className="st-close" onClick={() => { setOpenGroup(null); setFocusScarab(null); setDragSel(null); }}>Close</button>
          </div>

          <div className="st-panel-body">
            <PriceChart
              rows={chartData}
              cur={chartCur}
              height={260}
              axisLabel={scarabAxisLabel}
              label={focusScarab ? <>Set total <em>and</em> {focusScarab}</> : "Set total across the league"}
              extra={histLoading ? <span className="st-loading"> · loading history…</span> : null}
              seriesName="Set total"
              overlayName={focusScarab}
              overlayTone={GROUP_TONES[openGroupData.name] || "#7fb4d4"}
              dragSel={dragSel} setDragSel={setDragSel}
              realMode={realMode} rateReady={rateReady}
              empty={histLoading ? "Loading price history…" : "No history available."}
            />

            <div className="st-breakdown">
              <div className="st-breakdown-head">
                <span>Scarab</span><span>Price</span>
              </div>
              {openGroupData.members.map((m) => (
                <button key={m.name}
                  className={`st-row ${focusScarab === m.name ? "focused" : ""} ${scarabTerms.length && matchesAll(m.name, scarabTerms) ? "hit" : ""}`}
                  onClick={() => setFocusScarab(focusScarab === m.name ? null : m.name)}
                  title="Show this scarab on the chart">
                  <span className="st-row-name">
                    <ScarabIcon size={18} tone={GROUP_TONES[openGroupData.name] || "#ef4f19"} />
                    {m.name}
                  </span>
                  <span className="st-row-price">{chgBadge(m)} {fmtPrice(m.chaosValue, currency, divineRate)}</span>
                </button>
              ))}
              <div className="st-breakdown-hint">Tap a scarab to overlay it on the graph.</div>
            </div>
          </div>
        </section>
      )}


      {/* ---------- category price-check tabs (Astrolabes / Catalysts) ---------- */}
      {CATEGORY_TABS[tab] && (() => {
        const cat = CATEGORY_TABS[tab];
        const cd = catData[tab];
        if (cd === undefined) return <div className="st-cat-note">Loading {cat.label.toLowerCase()}…</div>;
        if (cd === "missing") return (
          <div className="st-cat-note">
            No {cat.label.toLowerCase()} data for {league} yet. It appears after the next data
            refresh; previous leagues may not have any.
          </div>
        );
        const rate = cd.divineRate || divineRate;
        const q = (catFilter[tab] || "").toLowerCase();
        let list = cd.items.slice().sort((a, b) => (sortDir === "desc" ? b.chaosValue - a.chaosValue : a.chaosValue - b.chaosValue));
        if (q) list = list.filter((m) => m.name.toLowerCase().includes(q));
        const selName = (catSelected[tab] && list.some((m) => m.name === catSelected[tab])) ? catSelected[tab] : list[0]?.name;
        const series = ((catHist[tab] || {})[selName] || []);
        const catCur = unitForSeries(series.map((p) => p.value), currency, rate);
        const catUnit = catCur === "chaos" ? "c" : "div";
        const div = catCur === "divine" ? rate : 1;
        const rows = series.map((p) => ({
          day: p.day, value: Math.round((p.value / div) * 100) / 100,
          chaos: p.value, rate: rateAt(activeRateHistory, p.day),
        }));
        return (
          <section className="st-cat-wrap">
            <PriceChart
              rows={rows}
              cur={catCur}
              axisLabel={cd.historySource === "ninja" ? "league day" : "days since first snapshot"}
              label={selName ? <>Price history: <em>{selName}</em></> : "Select an item"}
              seriesName={selName}
              dragSel={dragSel} setDragSel={setDragSel}
              realMode={realMode} rateReady={rateReady}
            />
            <div className="st-cat-grid">
              {list.map((m) => (
                <button key={m.name}
                  className={`st-row ${selName === m.name ? "focused" : ""}`}
                  onClick={() => { setCatSelected((c) => ({ ...c, [tab]: m.name })); setDragSel(null); }}
                  title="Show price history">
                  <span className="st-row-name"><CategoryIcon name={m.name} shape={cat.shape} />{m.name}</span>
                  <span className="st-row-price">{chgBadge(m)} {fmtPrice(m.chaosValue, currency, rate)}</span>
                </button>
              ))}
              {!list.length && <div className="st-cat-note">Nothing matches that filter.</div>}
            </div>
          </section>
        );
      })()}

      {/* ---------- delve ---------- */}
      {tab === "delve" && (
        <Delve
          league={league}
          staticBase={staticSlugsRef.current[league] ? `${STATIC_BASE}/${staticSlugsRef.current[league]}` : STATIC_BASE}
          currency={currency}
          divineRate={divineRate}
          fmtPrice={fmtPrice}
          fmtChaos={fmtChaos}
          unitFor={unitFor}
        />
      )}

      {/* ---------- boss profitability ---------- */}
      {tab === "bosses" && (
        <BossProfit
          league={league}
          staticBase={staticSlugsRef.current[league] ? `${STATIC_BASE}/${staticSlugsRef.current[league]}` : STATIC_BASE}
          currency={currency}
          divineRate={divineRate}
          fmtPrice={fmtPrice}
          fmtChaos={fmtChaos}
          fmtDiv={fmtDiv}
          unitFor={unitFor}
          initialBoss={bossTarget}
        />
      )}

      {/* ---------- mechanic grid ---------- */}
      {tab === "prices" && !visibleGroups.length && (
        <div className="st-cat-note">No scarab or mechanic matches “{scarabFilter}”.</div>
      )}

      {tab === "prices" && !!visibleGroups.length && (
      <main className="st-grid">
        {visibleGroups.map((g) => {
          const tone = GROUP_TONES[g.name] || "#ef4f19";
          const top = g.members[0];
          return (
            <button key={g.name}
              className={`st-card ${openGroup === g.name ? "open" : ""}`}
              style={{ "--tone": tone }}
              onClick={() => {
                const opening = openGroup !== g.name;
                setOpenGroup(opening ? g.name : null);
                // One search hit in this mechanic? Put it straight on the graph.
                setFocusScarab(opening && g.matches.length === 1 ? g.matches[0] : null);
                setDragSel(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>
              <div className="st-card-rank">{g.rank}</div>
              <div className="st-card-main">
                <div className="st-card-name">
                  <ScarabIcon size={20} tone={tone} />
                  <span>{g.name}</span>
                </div>
                <div className="st-card-meta">{g.members.length} scarabs · top: {top ? shortScarab(top.name) : "—"}</div>
                {g.matches.length > 0 && (
                  <div className="st-card-hits">
                    {g.matches.length} match{g.matches.length > 1 ? "es" : ""} · {g.matches.map(shortScarab).join(", ")}
                  </div>
                )}
              </div>
              <div className="st-card-total">
                <div className="st-card-total-num">{chgBadge(g)} {fmtPrice(g.total, currency, divineRate)}</div>
                <div className="st-card-total-lbl">full set · {chgWindow}</div>
              </div>
            </button>
          );
        })}
      </main>
      )}

      {/* ---------- popular farms tab ---------- */}
      {tab === "farms" && (
        <section className="st-farms">
          <p className="st-farms-intro">
            Scarab prices react fast when the player base changes farming strategies. Rising set
            prices mean players are buying in — a strat is getting popular. Falling prices mean the
            market is being flooded or a strat is dying off. Based on the last {chgWindow}
            {mode === "demo" ? " (sample data in this preview)" : ""}.
            {realBadges && " Divine-adjusted: a mechanic only counts as heating up if it outran the divine rate."}
          </p>
          {realMode && rateReady && (
            <div className="st-chart st-rate-strip">
              <div className="st-chart-label">
                Chaos per divine · <em>{fmtRate(activeRateHistory[activeRateHistory.length - 1].rate)}c</em>
                {rateDrift && <> · {rateDrift.pct >= 0 ? "+" : "−"}{Math.abs(rateDrift.pct).toFixed(1)}% in {chgWindow}</>}
                <span className="st-drag-hint"> · chaos deflates when this line climbs</span>
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={activeRateHistory} margin={{ top: 10, right: 18, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#3e281e" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="day" type="number" domain={dayAxis(activeRateHistory).domain} ticks={dayAxis(activeRateHistory).ticks}
                    tick={{ fill: "#9c877e", fontSize: 11 }} stroke="#4d3021" tickFormatter={fmtDay} />
                  <YAxis tick={{ fill: "#7f9fb8", fontSize: 11 }} stroke="#4d3021" width={52}
                    tickFormatter={fmtRate} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#17100d", border: "1px solid #65351f", borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: "#c9bfa8" }} itemStyle={{ color: "#e7dcd6" }}
                    formatter={(v) => [`${fmtRate(v)}c`, "1 divine"]}
                    labelFormatter={(d) => `Day ${fmtDay(d)}`} />
                  <Line type="monotone" dataKey="rate" stroke="#6f97b3" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="st-farms-cols">
            <div className="st-farms-col">
              <h3 className="st-farms-h up-h">Heating up</h3>
              {movers.rising.length === 0 && <div className="st-farms-empty">No mechanic is climbing right now.</div>}
              {movers.rising.map((g) => (
                <button key={g.name} className="st-mover" onClick={() => { setTab("prices"); setOpenGroup(g.name); setFocusScarab(null); }}>
                  <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[g.name] || "#ef4f19"} />{g.name}</span>
                  <span className="st-mover-bar"><i className="up" style={{ width: `${Math.min(100, (Math.abs(g[chgKey]) / movers.maxAbs) * 100)}%` }} /></span>
                  {chgBadge(g)}
                </button>
              ))}
            </div>
            <div className="st-farms-col">
              <h3 className="st-farms-h down-h">Cooling off</h3>
              {movers.falling.length === 0 && <div className="st-farms-empty">No mechanic is dropping right now.</div>}
              {movers.falling.map((g) => (
                <button key={g.name} className="st-mover" onClick={() => { setTab("prices"); setOpenGroup(g.name); setFocusScarab(null); }}>
                  <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[g.name] || "#ef4f19"} />{g.name}</span>
                  <span className="st-mover-bar"><i className="down" style={{ width: `${Math.min(100, (Math.abs(g[chgKey]) / movers.maxAbs) * 100)}%` }} /></span>
                  {chgBadge(g)}
                </button>
              ))}
            </div>
          </div>
          <h3 className="st-farms-h">Biggest single-scarab moves ({chgWindow})</h3>
          <div className="st-farms-scarabs">
            {movers.topScarabs.map((m) => (
              <button key={m.name} className="st-mover st-mover-scarab" onClick={() => { setTab("prices"); setOpenGroup(m.group); setFocusScarab(m.name); }}>
                <span className="st-mover-name"><ScarabIcon size={16} tone={GROUP_TONES[m.group] || "#ef4f19"} />{m.name}</span>
                <span className="st-mover-price">{fmtPrice(m.chaosValue, currency, divineRate)}</span>
                {chgBadge(m)}
              </button>
            ))}
          </div>
          <p className="st-farms-note">Tap anything to jump to its price breakdown and league graph.</p>
        </section>
      )}

      {/* ---------- saved strategy watcher ---------- */}
      {tab === "watcher" && (
        <section className="st-watcher">
          <div className="st-watcher-head">
            <div>
              <span className="ov-kicker">Saved setups</span>
              <h2>Strat Watcher</h2>
              <p>Track the combined cost of up to ten farming strategies across the selected market window.</p>
            </div>
            <div className="st-watcher-create">
              <span>{farmStrategies.length}/{FARM_STRATEGY_COUNT_LIMIT} saved</span>
              <button type="button" className="st-farm-open" disabled={farmStrategies.length >= FARM_STRATEGY_COUNT_LIMIT}
                onClick={() => openFarmEditor()}>New strategy</button>
            </div>
          </div>

          {showFarmEditor && (
            <section className="st-strat-editor" aria-label="Custom farming strategy">
              <header>
                <div><span>Custom farming strat</span><strong>Choose up to five scarabs and one Astrolabe</strong></div>
                <label>Strategy name<input value={farmDraft.name} maxLength={48}
                  onChange={(event) => setFarmDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
              </header>
              <div className="st-strat-slots">
                {Array.from({ length: 5 }, (_, index) => (
                  <StrategySlotPicker key={index} index={index} value={farmDraft.scarabs[index] || ""} items={items}
                    open={farmPicker === index} query={farmPicker === index ? farmQuery : ""}
                    onOpen={() => { setFarmPicker((current) => current === index ? null : index); setFarmQuery(""); }}
                    onQuery={setFarmQuery}
                    onSelect={(name) => {
                      setFarmDraft((draft) => {
                        const scarabs = Array.from({ length: 5 }, (_, slot) => draft.scarabs[slot] || "");
                        scarabs[index] = name;
                        return { ...draft, scarabs };
                      });
                      setFarmPicker(null); setFarmQuery("");
                    }} />
                ))}
                <StrategySlotPicker index={5} kind="astrolabe" value={farmDraft.astrolabe || ""} items={strategyAstrolabes}
                  open={farmPicker === 5} query={farmPicker === 5 ? farmQuery : ""}
                  onOpen={() => { setFarmPicker((current) => current === 5 ? null : 5); setFarmQuery(""); }}
                  onQuery={setFarmQuery}
                  onSelect={(name) => {
                    setFarmDraft((draft) => ({ ...draft, astrolabe: name }));
                    setFarmPicker(null); setFarmQuery("");
                  }} />
              </div>
              <footer>
                <span>{farmDraft.scarabs.filter(Boolean).length}/5 scarabs{farmDraft.astrolabe ? " + Astrolabe" : ""}. Duplicate scarabs are allowed.</span>
                <div>
                  <button type="button" className="quiet" onClick={() => { setShowFarmEditor(false); setFarmPicker(null); }}>Cancel</button>
                  <button type="button" onClick={saveFarmDraft} disabled={!farmDraft.scarabs.some(Boolean) && !farmDraft.astrolabe}>Save strategy</button>
                </div>
              </footer>
            </section>
          )}

          {!customFarms.length && !showFarmEditor && (
            <div className="st-watcher-empty">No saved strategies yet. Add one to start watching its full setup cost.</div>
          )}
          <div className="st-watcher-list">
            {customFarms.map((farm) => (
              <section className="st-strat-saved" key={farm.id}>
                <div className="st-strat-saved-title"><span>Farming strat</span><strong>{farm.name}</strong></div>
                <div className="st-strat-icons">
                  {farm.scarabs.map((name, index) => {
                    const item = items.find((candidate) => candidate.name === name);
                    return <span key={`${name}-${index}`} tabIndex="0" aria-label={name} data-name={name}
                      className={`st-strat-icon${item ? "" : " missing"}`}>
                      <ScarabIcon size={22} tone={GROUP_TONES[item?.group] || "#6b4a3b"} />
                    </span>;
                  })}
                  {farm.astrolabe && (
                    <span tabIndex="0" aria-label={farm.astrolabe} data-name={farm.astrolabe}
                      className={`st-strat-icon astrolabe${farm.astrolabeItem ? "" : " missing"}`}>
                      <CategoryIcon name={farm.astrolabe} shape="ring" size={22} />
                    </span>
                  )}
                </div>
                <div className="st-strat-total"><span>Current cost</span><strong>{fmtPrice(farm.total, currency, divineRate)}</strong></div>
                <div className="st-strat-move"><span>{chgWindow}{activeKey.endsWith("R") ? " divine-adjusted" : ""}</span>
                  <strong><PctBadge v={farm[activeKey]} real={activeKey.endsWith("R")} /><em>{farmDirection(farm)}</em></strong></div>
                <div className="st-strat-actions">
                  <button type="button" onClick={() => openFarmEditor(farm)}>Edit</button>
                  <button type="button" className="danger" onClick={() => {
                    if (window.confirm(`Delete ${farm.name}?`)) deleteFarmStrategy(farm.id);
                  }}>Delete</button>
                </div>
                {!!farm.missing.length && <small>{farm.missing.length} saved item price{farm.missing.length === 1 ? " is" : "s are"} currently unavailable.</small>}
              </section>
            ))}
          </div>
        </section>
      )}

      <footer className="st-foot">
        Exchange prices via <a href="https://www.pathofexile.com/developer/docs/reference#currencyexchange" target="_blank" rel="noopener noreferrer">GGG</a>
        {" · fallbacks via "}<a href="https://poe.watch" target="_blank" rel="noopener noreferrer">poe.watch</a>
        {" and "}<a href="https://poe.ninja" target="_blank" rel="noopener noreferrer">poe.ninja</a>
        {" · Searing Exarch artwork © Grinding Gear Games · "}This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
      </footer>
    </div>
  );
}

/* ---------------- styles ---------------- */
const css = `
/* Kei Font (KeiFont) — Apache License 2.0. Drop the TTF at public/fonts/keifont.ttf;
   until it's there, the page silently falls back to the serif stack. */
@font-face {
  font-family: "Kei";
  src: url("fonts/keifont.ttf") format("truetype");
  font-display: swap;
}
.st-root {
  min-height: 100vh;
  overflow-x: hidden;
  background:
    radial-gradient(1000px 480px at 62% -120px, rgba(122, 42, 19, 0.35) 0%, transparent 70%),
    #0a0706;
  color: #e7d9d2;
  font-family: "Kei", Georgia, 'Palatino Linotype', 'Times New Roman', serif;
  padding: 22px clamp(12px, 4vw, 44px) 40px;
}
.st-head {
  display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between;
  min-height: 104px; padding: 20px; border: 1px solid #35231b; border-bottom-color: #5c2816;
  border-radius: 6px 6px 0 0;
  background:
    linear-gradient(90deg, rgba(9, 5, 4, .97) 0%, rgba(14, 7, 5, .90) 43%, rgba(25, 8, 4, .68) 73%, rgba(9, 5, 4, .92) 100%),
    url("${import.meta.env.BASE_URL}assets/searing-exarch-header.jpg") center 30% / cover no-repeat;
}
.st-title-block { padding-left: 13px; border-left: 3px solid #ef4f19; }
.st-title-block h1 {
  margin: 0; font-size: clamp(23px, 4vw, 31px); font-weight: 500; letter-spacing: 0.16em;
  color: #f1e4dc; text-transform: uppercase;
  text-shadow: 0 1px 0 #000, 0 0 24px rgba(239,79,25,0.24);
}
.st-title-block h1 span { color: #ff5b1f; }
.st-sub { margin: 3px 0 0; font-size: 12px; color: #c0a196; letter-spacing: 0.055em; }
.st-controls { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
.st-ctl { display: flex; flex-direction: column; gap: 5px; font-size: 11px; }
.st-ctl > span { color: #9c877e; text-transform: uppercase; letter-spacing: 0.14em; }
.st-ctl select {
  background: #17100d; color: #e7d9d2; border: 1px solid #65351f; border-radius: 5px;
  padding: 7px 10px; font-family: inherit; font-size: 13px;
}
.st-ctl select:disabled { opacity: 0.55; }
.st-seg { display: flex; border: 1px solid #65351f; border-radius: 5px; overflow: hidden; }
.st-seg button {
  background: #17100d; color: #a98d82; border: none; padding: 7px 12px; cursor: pointer;
  font-family: inherit; font-size: 13px; border-right: 1px solid #3e281e;
}
.st-seg button:last-child { border-right: none; }
.st-seg button.on { background: #7a2a13; color: #fff0e6; }
.st-seg button:focus-visible, .st-ctl select:focus-visible, .st-card:focus-visible, .st-row:focus-visible, .st-close:focus-visible {
  outline: 2px solid #ff6a24; outline-offset: 2px;
}
.st-check { display: flex; flex-direction: row; align-items: center; gap: 7px; cursor: pointer; }
.st-check input { accent-color: #ef4f19; width: 15px; height: 15px; }
.st-check span { text-transform: none; letter-spacing: 0.02em; font-size: 13px; color: #c6aaa0; }
.st-check-off { cursor: not-allowed; opacity: 0.45; }
/* Per-tab control strip: same shell as the boss tab's toolbar so the two
   read as one pattern rather than two. */
.st-tools {
  display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: flex-end;
  border: 1px solid #3e281e; border-radius: 8px; background: #120d0b;
  padding: 12px 14px; margin: 0 0 14px;
}
.st-checks-row { display: flex; align-items: center; gap: 14px; height: 33px; }
.st-tool-filter {
  background: #17100d; color: #e7d9d2; border: 1px solid #65351f; border-radius: 5px;
  padding: 7px 10px; font-family: inherit; font-size: 13px; width: min(240px, 46vw);
}
.st-tool-filter::placeholder { color: #74625b; }
.st-tool-search { position: relative; display: inline-flex; }
.st-tool-search .st-tool-filter { padding-right: 26px; }
.st-tool-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: #9c877e; cursor: pointer;
  font-family: inherit; font-size: 12px; line-height: 1; padding: 4px 5px; border-radius: 4px;
}
.st-tool-clear:hover { color: #f0e4de; }
.st-tool-filter:focus-visible, .st-check input:focus-visible { outline: 2px solid #ff6a24; outline-offset: 1px; }
.st-banner {
  border: 1px solid #7a361b; background: #2a130b; color: #e6a078; font-size: 13px;
  padding: 9px 14px; border-radius: 6px; margin: 6px 0 16px; line-height: 1.45;
}
.st-banner.st-quiet { background: #1d1912; border-color: #3e281e; color: #9c877e; }
.st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
.st-card {
  display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer;
  background: linear-gradient(180deg, #1a100c 0%, #100b09 100%);
  border: 1px solid #4d3021; border-radius: 7px; padding: 12px 14px;
  color: inherit; font-family: inherit;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5);
  transition: border-color 120ms ease, transform 120ms ease;
}
.st-card:hover { border-color: var(--tone); transform: translateY(-1px); }
.st-card.open { border-color: var(--tone); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.5), 0 0 14px -6px var(--tone); }
@media (prefers-reduced-motion: reduce) { .st-card, .st-card:hover { transition: none; transform: none; } }
.st-card-rank { font-size: 12px; color: #74625b; min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
.st-card-main { flex: 1; min-width: 0; }
.st-card-name { display: flex; align-items: center; gap: 8px; font-size: 16px; color: #f0e4de; letter-spacing: 0.03em; }
.st-tag { font-size: 10.5px; color: #9c877e; font-style: italic; }
.st-tag-panel { font-size: 12.5px; white-space: nowrap; }
.st-card-meta { font-size: 11.5px; color: #9c877e; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Match list can be long — let it run to two lines before it gets clipped. */
.st-card-hits {
  font-size: 11.5px; color: #ff6a24; margin-top: 3px; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.st-card-total { text-align: right; }
.st-card-total-num { font-size: 17px; color: #f4dfd3; font-variant-numeric: tabular-nums; }
.st-card-total-lbl { font-size: 10px; color: #74625b; text-transform: uppercase; letter-spacing: 0.12em; }
.st-panel {
  border: 1px solid #7a361b; border-radius: 8px; background: #120d0b; margin-bottom: 16px;
  box-shadow: 0 8px 30px -18px #000;
}
.st-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #3e281e; flex-wrap: wrap; }
.st-panel-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.st-panel-title h2 { margin: 0; font-size: 19px; color: #f0e4de; letter-spacing: 0.06em; text-transform: capitalize; }
.st-panel-total { font-size: 13.5px; color: #c6aaa0; border: 1px solid #65351f; border-radius: 999px; padding: 3px 11px; font-variant-numeric: tabular-nums; }
.st-close {
  background: none; border: 1px solid #65351f; color: #a98d82; border-radius: 5px;
  padding: 5px 12px; cursor: pointer; font-family: inherit; font-size: 12.5px;
}
.st-close:hover { color: #f0e4de; border-color: #bd461d; }
.st-close:disabled { opacity: 0.42; cursor: default; }
.st-close:disabled:hover { color: #a98d82; border-color: #65351f; }
.st-panel-body { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 0; }
@media (max-width: 860px) { .st-panel-body { grid-template-columns: 1fr; } }
.st-chart { padding: 12px 8px 8px 4px; min-width: 0; }
.st-chart-label { font-size: 12px; color: #9c877e; padding: 0 0 6px 14px; }
.st-chart-label em { color: #c6aaa0; }
.st-drag-hint { color: #6e5a50; }
.st-rate-key { color: #6f97b3; }
.st-rate-swatch {
  display: inline-block; width: 14px; height: 0; margin-right: 5px; vertical-align: middle;
  border-top: 2px dashed #6f97b3;
}
.st-range-real { color: #9c877e; }
.st-rate-strip { padding-bottom: 4px; margin-bottom: 6px; border-bottom: 1px solid #2a241b; }
.st-banner-real { color: #8fb2c9; }
.st-range {
  display: inline-flex; align-items: center; gap: 8px; margin: 2px 0 6px 14px;
  border: 1px solid #7a361b; background: #2a130b; color: #e0d0a0;
  font-size: 12.5px; padding: 4px 10px; border-radius: 999px; font-variant-numeric: tabular-nums;
}
.st-range .st-pct { margin-right: 0; }
.st-range-clear {
  background: none; border: none; color: #9c877e; cursor: pointer; font-size: 12px;
  padding: 0 2px; font-family: inherit;
}
.st-range-clear:hover { color: #f0e4de; }
.st-loading { color: #74625b; }
.st-chart-empty { height: 260px; display: grid; place-items: center; color: #74625b; font-size: 13px; }
.st-breakdown { border-left: 1px solid #3e281e; max-height: 340px; overflow-y: auto; }
@media (max-width: 860px) { .st-breakdown { border-left: none; border-top: 1px solid #3e281e; } }
.st-breakdown-head {
  display: flex; justify-content: space-between; padding: 9px 14px; font-size: 10.5px;
  color: #74625b; text-transform: uppercase; letter-spacing: 0.14em;
  position: sticky; top: 0; background: #120d0b; border-bottom: 1px solid #2f1f18;
}
.st-row {
  display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%;
  background: none; border: none; border-bottom: 1px solid #281a14; padding: 8px 14px;
  color: #d7c8c1; font-family: inherit; font-size: 13.5px; cursor: pointer; text-align: left;
}
.st-row:hover { background: #1d120e; }
.st-row.focused { background: #32170c; color: #f4dfd3; }
.st-row.hit { box-shadow: inset 2px 0 0 #ff6a24; }
.st-row-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.st-row-price { font-variant-numeric: tabular-nums; color: #efcdbd; white-space: nowrap; }
.st-breakdown-hint { padding: 8px 14px 12px; font-size: 11px; color: #74625b; }
.st-foot { margin-top: 26px; font-size: 11.5px; color: #74625b; text-align: center; letter-spacing: 0.03em; }
.st-foot a { color: #a78678; text-decoration: none; border-bottom: 1px dotted #74625b; }
.st-foot a:hover { color: #e6a078; border-bottom-color: #e6a078; }
.st-foot a:focus-visible { outline: 2px solid #ff6a24; outline-offset: 2px; }
.bp-hidden-note {
  font-size: 11.5px; color: #9c877e; padding: 6px 12px 2px; line-height: 1.5;
  border-top: 1px dashed #3e281e;
}
.bp-hidden-note em { display: block; color: #74625b; font-style: italic; cursor: help; }
.st-pct { font-size: 11px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; margin-right: 6px; white-space: nowrap; }
.st-pct.up { color: #8fd47f; }
.st-pct.down { color: #d47f7f; }
.st-pct.flat { color: #74625b; }
/* A divine-adjusted figure is a different measurement, not a different value —
   the marker keeps it from being read as the chaos change. */
.st-pct.real::after {
  content: "div"; font-size: 8px; vertical-align: super; margin-left: 2px;
  color: #6f97b3; letter-spacing: 0.04em;
}
.st-tabs {
  display: flex; gap: 2px; padding: 0 12px; border: 1px solid #35231b; border-top: none;
  border-bottom-color: #3b2419; margin: 0 0 12px; background: #100a08;
  overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.st-tabs::-webkit-scrollbar { display: none; }
.st-tabs button {
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
  color: #a48e84; font-family: inherit; font-size: 15px; font-weight: 500; letter-spacing: 0.045em;
  text-transform: none; padding: 13px 12px 12px;
  white-space: nowrap; flex: 0 0 auto;
}
.st-tabs button.on { color: #ff6828; border-bottom-color: #ef4f19; }
.st-tabs button:hover { color: #c6aaa0; }
.st-tabs button:focus-visible { outline: 2px solid #ff6a24; outline-offset: -2px; }
.st-tab-exp {
  display: inline-block; margin-left: 4px; padding: 1px 3px; border: 1px solid #7a5c33;
  border-radius: 3px; color: #d9a86a; font-size: 8.5px; font-style: normal;
  line-height: 1; letter-spacing: 0.08em; vertical-align: 1px;
}
.st-farms-intro { max-width: 720px; font-size: 13.5px; line-height: 1.55; color: #b49c91; margin: 2px 0 18px; }
.st-farm-open, .st-strat-editor button, .st-strat-saved > button, .st-strat-actions button {
  flex: 0 0 auto; padding: 7px 11px; color: #f0d8cb; background: #35160d; border: 1px solid #8d3518;
  border-radius: 5px; cursor: pointer; font: inherit; font-size: 12.5px;
}
.st-farm-open:hover, .st-strat-editor button:hover, .st-strat-saved > button:hover, .st-strat-actions button:hover { border-color: #ef5b24; background: #491c0e; }
.st-farm-open:disabled { cursor: not-allowed; opacity: .45; }
.st-watcher-head { display: flex; justify-content: space-between; gap: 20px; align-items: end; margin: 2px 0 14px; }
.st-watcher-head h2 { margin: 3px 0; color: #f0e3dc; font-size: 24px; font-weight: 500; }
.st-watcher-head p { margin: 0; color: #a78f84; font-size: 13.5px; }
.st-watcher-create { display: flex; gap: 10px; align-items: center; }
.st-watcher-create > span { color: #9c877e; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.st-watcher-empty { padding: 26px 14px; color: #8f786f; background: #100c0a; border: 1px dashed #4d3021; border-radius: 6px; text-align: center; }
.st-watcher-list { display: grid; gap: 8px; }
.st-strat-editor {
  margin: 0 0 16px; padding: 12px; background: #120d0b; border: 1px solid #6f321e; border-radius: 7px;
  box-shadow: inset 3px 0 #c94a1e;
}
.st-strat-editor > header { display: flex; justify-content: space-between; gap: 18px; align-items: end; margin-bottom: 11px; }
.st-strat-editor header > div { display: grid; gap: 2px; }
.st-strat-editor header span, .st-strat-saved-title span, .st-strat-total span, .st-strat-move span {
  color: #9c877e; font-size: 10px; letter-spacing: .11em; text-transform: uppercase;
}
.st-strat-editor header strong, .st-strat-saved-title strong { color: #eadbd4; font-size: 15px; font-weight: 500; }
.st-strat-editor label { display: grid; gap: 4px; color: #9c877e; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
.st-strat-editor input {
  min-width: 210px; padding: 7px 9px; color: #eadbd4; background: #0d0907; border: 1px solid #563021;
  border-radius: 4px; font: inherit; font-size: 12.5px;
}
.st-strat-slots { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; }
.st-strat-picker { position: relative; min-width: 0; }
.st-strat-slot {
  display: flex; align-items: center; gap: 7px; width: 100%; min-height: 43px; padding: 7px 8px;
  color: #9c877e; background: #0d0907; border: 1px dashed #523326; border-radius: 5px;
  cursor: pointer; font: inherit; text-align: left;
}
.st-strat-slot.filled { color: #eadbd4; border-style: solid; }
.st-strat-slot b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
.st-strat-menu {
  position: absolute; z-index: 30; top: calc(100% + 5px); left: 0; width: min(360px, 85vw); padding: 7px;
  background: #17100d; border: 1px solid #8d3518; border-radius: 6px; box-shadow: 0 12px 32px #000c;
}
.st-strat-picker.edge .st-strat-menu { left: auto; right: 0; }
.st-strat-menu > input { width: 100%; min-width: 0; margin-bottom: 6px; }
.st-strat-editor .st-strat-clear { width: 100%; margin-bottom: 5px; padding: 5px 7px; color: #bfa297; background: #21140f; border-color: #4d3021; text-align: left; }
.st-strat-results { max-height: 240px; overflow-y: auto; }
.st-strat-results button {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: center; width: 100%;
  padding: 6px 7px; color: #d8c8c0; background: transparent; border: 0; border-radius: 3px; text-align: left;
}
.st-strat-results button:hover, .st-strat-results button[aria-selected="true"] { background: #30150e; }
.st-strat-results button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; font-size: 12px; letter-spacing: 0; text-transform: none; }
.st-strat-results button em { color: #c9967e; font-size: 11px; font-style: normal; }
.st-strat-results small { display: block; padding: 9px; color: #8d776e; }
.st-strat-editor > footer { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 10px; }
.st-strat-editor footer > span { color: #8f786f; font-size: 11.5px; }
.st-strat-editor footer > div { display: flex; gap: 6px; }
.st-strat-editor button.quiet { color: #a98f84; background: transparent; border-color: #4d3021; }
.st-strat-editor button:disabled { cursor: not-allowed; opacity: .45; }
.st-strat-saved {
  display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(150px, 1fr) auto auto auto;
  gap: 12px; align-items: center; margin: 0 0 17px; padding: 10px 12px; background: linear-gradient(90deg, #1b0e0a, #100b09);
  border: 1px solid #573022; border-left: 3px solid #ef5b24; border-radius: 6px;
}
.st-strat-saved-title, .st-strat-total, .st-strat-move { display: grid; gap: 2px; }
.st-strat-total strong, .st-strat-move strong { color: #f0d8cb; font-size: 14px; font-weight: 500; }
.st-strat-move strong { display: flex; gap: 5px; align-items: center; }
.st-strat-move strong em { color: #ab8f83; font-size: 10.5px; font-style: normal; white-space: nowrap; }
.st-strat-move .st-pct { margin: 0; }
.st-strat-actions { display: flex; gap: 5px; }
.st-strat-actions button { padding: 6px 8px; }
.st-strat-actions button.danger { color: #d99483; background: #21100d; border-color: #683025; }
.st-strat-icons { display: flex; gap: 4px; }
.st-strat-icon {
  position: relative; display: grid; place-items: center; width: 32px; height: 32px;
  background: #0c0806; border: 1px solid #3f291f; border-radius: 4px;
}
.st-strat-icon.astrolabe { margin-left: 4px; border-color: #7b5730; }
.st-strat-icon.missing { opacity: .45; }
.st-strat-icon::after {
  content: attr(data-name); position: absolute; z-index: 40; left: 50%; bottom: calc(100% + 7px);
  transform: translate(-50%, 3px); width: max-content; max-width: min(320px, 80vw); padding: 5px 7px;
  color: #f0e1da; background: #1a100d; border: 1px solid #7a3923; border-radius: 4px;
  box-shadow: 0 6px 18px #000b; font-size: 11.5px; line-height: 1.25; white-space: normal;
  opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 80ms ease, transform 80ms ease;
}
.st-strat-icon:hover::after, .st-strat-icon:focus-visible::after {
  opacity: 1; visibility: visible; transform: translate(-50%, 0);
}
.st-strat-icon:focus-visible { outline: 2px solid #ff6a24; outline-offset: 2px; }
.st-strat-saved > small { grid-column: 1 / -1; color: #d39b73; font-size: 11px; }
.st-farms-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 24px; }
@media (max-width: 760px) {
  .st-farms-cols { grid-template-columns: 1fr; }
  .st-watcher-head, .st-strat-editor > header, .st-strat-editor > footer { align-items: stretch; flex-direction: column; }
  .st-farm-open { align-self: flex-end; }
  .st-strat-slots { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .st-strat-editor header input { width: 100%; min-width: 0; }
  .st-strat-saved { grid-template-columns: minmax(0, 1fr) auto auto; }
  .st-strat-icons { grid-column: 1 / -1; grid-row: 2; }
  .st-strat-editor footer > div { flex-wrap: wrap; justify-content: flex-end; }
}
.st-farms-h { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: #9c877e; margin: 0 0 8px; }
.st-farms-h.up-h { color: #8fd47f; }
.st-farms-h.down-h { color: #d47f7f; }
.st-farms-empty { font-size: 13px; color: #74625b; padding: 8px 2px; }
.st-mover {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, 130px) auto; align-items: center;
  gap: 10px; width: 100%; background: #120d0b; border: 1px solid #2f1f18; border-radius: 6px;
  padding: 8px 12px; margin-bottom: 6px; cursor: pointer; color: #d7c8c1;
  font-family: inherit; font-size: 13.5px; text-align: left;
}
.st-mover:hover { border-color: #65351f; }
.st-mover:focus-visible { outline: 2px solid #ff6a24; outline-offset: 2px; }
.st-mover-name { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-mover-bar { height: 7px; background: #281a14; border-radius: 999px; overflow: hidden; }
.st-mover-bar i { display: block; height: 100%; border-radius: 999px; }
.st-mover-bar i.up { background: linear-gradient(90deg, #4e7a45, #8fd47f); }
.st-mover-bar i.down { background: linear-gradient(90deg, #7a4545, #d47f7f); }
.st-mover .st-pct { margin-right: 0; }
.st-farms-scarabs { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 12px; }
.st-mover-scarab { grid-template-columns: minmax(0, 1fr) auto auto; margin-bottom: 0; }
.st-mover-price { font-variant-numeric: tabular-nums; color: #efcdbd; white-space: nowrap; font-size: 12.5px; }
.st-farms-note { font-size: 11.5px; color: #74625b; margin-top: 14px; }
.st-cat-wrap { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; padding-bottom: 10px; }
.st-cat-note { padding: 22px 16px; color: #9c877e; font-size: 13.5px; }
.st-cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0 14px; padding: 6px 6px 0; }

/* ---------------- overview ---------------- */
.ov-main { color: #e7dcd6; width: 100%; }
.ov-status {
  display: flex; flex-wrap: wrap; gap: 5px 14px; margin-bottom: 10px; padding: 7px 10px;
  color: #a08a80; background: #0e0907; border: 1px solid #342017; border-radius: 3px;
  font-size: 12.5px;
}
.ov-status b { color: #d8bcae; font-weight: 500; }
.ov-head {
  display: flex; justify-content: space-between; gap: 18px; align-items: end; margin-bottom: 10px;
}
.ov-kicker { color: #f15b21; font-size: 11px; font-weight: 500; letter-spacing: .13em; text-transform: uppercase; }
.ov-head h2 { margin: 3px 0 2px; color: #f0e3dc; font-size: 24px; font-weight: 500; }
.ov-head p { margin: 0; color: #9f8e86; font-size: 13.5px; }
.ov-signal:focus-visible, .ov-feature button:focus-visible,
.ov-desk button:focus-visible, .ov-attention button:focus-visible { outline: 2px solid #ff6a24; outline-offset: 2px; }
.ov-briefing { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, .75fr); gap: 8px; }
.ov-feature {
  min-height: 190px; padding: 14px; border: 1px solid #66301e; border-left: 3px solid #f05a24;
  border-radius: 6px; background: radial-gradient(circle at 88% 22%, rgba(241,80,25,.14), transparent 26%), linear-gradient(125deg, #1b0e0a, #100b09 68%);
}
.ov-feature-top { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.ov-feature-top em {
  color: #d5a28e; border: 1px solid #6c3927; border-radius: 3px; padding: 2px 5px;
  font-size: 10px; font-style: normal; letter-spacing: .07em; text-transform: uppercase;
}
.ov-feature h3 { max-width: 760px; margin: 12px 0 4px; color: #f7e7df; font-size: 27px; font-weight: 500; line-height: 1.15; }
.ov-feature-number { display: flex; flex-wrap: wrap; gap: 7px; align-items: baseline; }
.ov-feature-number strong { color: #efcdbd; font-size: 20px; font-weight: 500; }
.ov-feature-number strong.up { color: #69bfa1; }
.ov-feature-number strong.down { color: #d47f7f; }
.ov-feature-number span { color: #9d8379; font-size: 12px; }
.ov-feature > p { max-width: 760px; margin: 8px 0; color: #b49a90; font-size: 13px; line-height: 1.45; }
.ov-feature-bottom { display: flex; justify-content: space-between; gap: 10px; align-items: end; }
.ov-feature-flow { display: flex; flex-wrap: wrap; gap: 5px; }
.ov-feature-flow span { padding: 3px 6px; color: #a98f84; background: #120d0b; border: 1px solid #40271e; font-size: 11.5px; }
.ov-feature button, .ov-desk button {
  flex: 0 0 auto; padding: 5px 8px; color: #e6a078; background: #17100d; border: 1px solid #65351f;
  border-radius: 4px; cursor: pointer; font: inherit; font-size: 12.5px;
}
.ov-feature button:hover, .ov-desk button:hover { color: #f4dfd3; border-color: #bd461d; }
.ov-signal-list { display: grid; gap: 4px; }
.ov-signal {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 9px; align-items: center;
  width: 100%; min-height: 44px; padding: 7px 9px; color: inherit; background: #120e0c;
  border: 1px solid #3d281f; border-radius: 4px; font: inherit; text-align: left; cursor: pointer;
}
.ov-signal:hover, .ov-signal.on { border-color: #a94320; background: #1a100d; }
.ov-signal .ov-kind { grid-column: 1; }
.ov-signal > strong { grid-column: 1; color: #e8d8d1; font-size: 13px; font-weight: 500; line-height: 1.3; }
.ov-kind { color: #ef5b24; font-size: 10.5px; font-weight: 500; letter-spacing: .09em; text-transform: uppercase; }
.ov-value { grid-column: 2; grid-row: 1 / 3; color: #dbccc4; font-size: 14px; font-weight: 500; text-align: right; white-space: nowrap; }
.ov-value.up { color: #69bfa1; }
.ov-value.down { color: #d47f7f; }
/* The downward panel keeps the upward panel's layout. Only the accent colour
   separates the two, so the eye can compare the same positions on both. */
.ov-head-down { margin-top: 14px; }
.ov-head-down .ov-kicker { color: #d4694a; }
.ov-down .ov-feature {
  border-left-color: #c2503a;
  background: radial-gradient(circle at 88% 22%, rgba(212,127,127,.15), transparent 26%), linear-gradient(125deg, #1b0e0a, #100b09 68%);
}
.ov-section-title {
  margin: 13px 0 6px; padding: 0; color: #9e8176; border: 0;
  font-size: 11px; font-weight: 500; letter-spacing: .13em; text-transform: uppercase;
}
.ov-desks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.ov-desk { min-width: 0; padding: 10px; color: #d7c8c1; background: #120e0c; border: 1px solid #3e281f; border-radius: 5px; }
.ov-desk header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.ov-desk h3 { margin: 0; color: #eadbd4; font-size: 15px; font-weight: 500; }
.ov-desk header em { color: #d65c2d; font-size: 9.5px; font-style: normal; letter-spacing: .08em; text-transform: uppercase; }
.ov-desk > p { margin: 4px 0 7px; color: #9d857b; font-size: 12px; line-height: 1.4; }
.ov-desk dl { margin: 0; border-top: 1px solid #34231c; }
.ov-desk dl div {
  display: flex; justify-content: space-between; gap: 10px; padding: 5px 0;
  border-bottom: 1px solid #281c17; font-size: 12.5px;
}
.ov-desk dt { color: #9f877d; }
.ov-desk dd { margin: 0; color: #e6d7d0; font-weight: 500; text-align: right; }
.ov-desk > button { margin-top: 7px; }
.ov-attention {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 8px;
  border: 1px solid #3e281f; background: #0f0c0a;
}
.ov-attention > div, .ov-attention > button {
  display: block; min-width: 0; padding: 7px 10px; color: inherit; background: transparent;
  border: 0; border-right: 1px solid #3a261e; font: inherit; text-align: left;
}
.ov-attention > :last-child { border-right: 0; }
.ov-attention > button { cursor: pointer; }
.ov-attention > button:hover { background: #1a100d; }
.ov-attention span { color: #d35a2c; font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; }
.ov-attention strong { display: block; margin: 3px 0; color: #d9c8c0; font-size: 12.5px; font-weight: 500; }
.ov-attention small { display: block; color: #8f786f; font-size: 11.5px; line-height: 1.4; }
@media (max-width: 720px) {
  .st-head { align-items: flex-start; flex-direction: column; }
  .st-controls { width: 100%; justify-content: space-between; }
}
@media (max-width: 680px) {
  .ov-head { align-items: flex-start; flex-direction: column; }
  .ov-briefing, .ov-desks, .ov-attention { grid-template-columns: 1fr; }
  .ov-signal-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ov-attention > div, .ov-attention > button { border-right: 0; border-bottom: 1px solid #3a261e; }
  .ov-attention > :last-child { border-bottom: 0; }
}
@media (max-width: 480px) {
  .st-controls { align-items: stretch; flex-direction: column; }
  .st-ctl select { width: 100%; }
  .ov-signal-list { grid-template-columns: 1fr; }
  .ov-feature h3 { font-size: 23px; }
  .ov-feature-bottom { align-items: flex-start; flex-direction: column; }
  .st-strat-saved { grid-template-columns: minmax(0, 1fr) auto; }
  .st-strat-saved-title { grid-column: 1; grid-row: 1; }
  .st-strat-saved > button { grid-column: 2; grid-row: 1; }
  .st-strat-actions { grid-column: 2; grid-row: 1; }
  .st-strat-icons { grid-column: 1 / -1; grid-row: 2; }
}

/* ---------------- boss profitability ---------------- */
.bp-wrap { display: block; }
.bp-bar {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end;
  border: 1px solid #3e281e; border-radius: 8px; background: #120d0b;
  padding: 12px 14px; margin-bottom: 14px;
}
.bp-btns { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 1px; }
.bp-btns button, .bp-reset, .bp-import-go {
  background: #17100d; color: #a98d82; border: 1px solid #65351f; border-radius: 5px;
  padding: 7px 11px; cursor: pointer; font-family: inherit; font-size: 12.5px;
}
.bp-btns button:hover, .bp-reset:hover, .bp-import-go:hover { color: #f0e4de; border-color: #bd461d; }
.bp-reset { margin-left: auto; }
.bp-import { border: 1px solid #7a361b; border-radius: 8px; background: #120d0b; padding: 12px 14px; margin-bottom: 14px; }
.bp-import-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #f0e4de; font-size: 14px; }
.bp-import textarea {
  width: 100%; min-height: 150px; box-sizing: border-box; resize: vertical;
  background: #0a0706; color: #e7d9d2; border: 1px solid #65351f; border-radius: 5px;
  padding: 9px 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5;
}
.bp-import-err { color: #e6a078; font-size: 12.5px; margin: 7px 0; }
.bp-import-go { margin-top: 8px; }
.bp-body { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 1040px) { .bp-body { grid-template-columns: 1fr; } }
.bp-list { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; overflow: hidden; max-height: 78vh; overflow-y: auto; }
.bp-list-head {
  display: flex; justify-content: space-between; padding: 9px 14px; font-size: 10.5px;
  color: #74625b; text-transform: uppercase; letter-spacing: 0.14em; border-bottom: 1px solid #2f1f18;
  position: sticky; top: 0; background: #120d0b; z-index: 1;
}
.bp-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; border-bottom: 1px solid #281a14; padding: 9px 14px;
  color: #d7c8c1; font-family: inherit; font-size: 13.5px;
}
.bp-item:hover { background: #1d120e; }
.bp-item.on { background: #32170c; }
.bp-item:focus-visible { outline: 2px solid #ff6a24; outline-offset: -2px; }
.bp-item-main { flex: 1; min-width: 0; }
.bp-item-name { display: flex; align-items: center; gap: 7px; color: #e7dcd6; }
.bp-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tone); flex-shrink: 0; }
.bp-item-meta { display: block; font-size: 11px; color: #8e7e76; margin: 2px 0 5px 15px; line-height: 1.5; }
.bp-safe { font-style: normal; margin: 0 2px 0 6px; padding: 0 4px; border-radius: 3px; font-size: 10.5px; white-space: nowrap; }
.bp-safe.ok { color: #a5d48f; background: rgba(79, 122, 69, 0.22); }
.bp-safe.risk { color: #d9a86a; background: rgba(122, 92, 51, 0.22); }
.bp-meter { display: block; height: 5px; background: #281a14; border-radius: 999px; overflow: hidden; margin-left: 15px; }
.bp-meter i { display: block; height: 100%; border-radius: 999px; }
.bp-meter i.up { background: linear-gradient(90deg, #4e7a45, #8fd47f); }
.bp-meter i.down { background: linear-gradient(90deg, #7a4545, #d47f7f); }
.bp-item-val { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 14px; }
.bp-item-val.pos { color: #a5d48f; }
.bp-item-val.neg { color: #d47f7f; }
.bp-flag {
  font-size: 9.5px; font-style: normal; text-transform: uppercase; letter-spacing: 0.08em;
  border: 1px solid #65351f; border-radius: 3px; padding: 1px 4px; color: #9c877e; flex-shrink: 0;
}
.bp-flag.warn { border-color: #7a5c33; color: #d9a86a; }
.bp-detail { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; padding: 0 0 14px; min-width: 0; }
.bp-detail-head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  padding: 13px 16px; border-bottom: 1px solid #2f1f18; border-left: 3px solid var(--tone);
}
.bp-detail-head h3 { margin: 0; font-size: 19px; color: #f0e4de; letter-spacing: 0.04em; }
.bp-detail-sub { font-size: 11.5px; color: #8e7e76; margin-top: 3px; }
.bp-note { margin: 12px 16px 0; font-size: 12.5px; color: #b49c91; line-height: 1.5; border-left: 2px solid #4d3021; padding-left: 10px; }
.bp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; padding: 14px 16px 4px; }
.bp-stat { border: 1px solid #2f1f18; border-radius: 6px; background: #17100d; padding: 9px 12px; }
.bp-stat-lbl { font-size: 10px; color: #74625b; text-transform: uppercase; letter-spacing: 0.12em; }
.bp-stat-val { font-size: 17px; color: #efcdbd; font-variant-numeric: tabular-nums; margin-top: 3px; }
.bp-stat.big .bp-stat-val { font-size: 21px; }
.bp-stat-val.pos { color: #a5d48f; }
.bp-stat-val.neg { color: #d47f7f; }
.bp-stat-val.warn { color: #e6a078; }
.bp-timing { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 12px 16px 6px; font-size: 12.5px; color: #a98d82; }
.bp-timing label { display: flex; align-items: center; gap: 7px; }
.bp-timing-out { color: #8e7e76; font-variant-numeric: tabular-nums; }
.bp-entry {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px;
  margin: 4px 16px 2px; padding: 9px 12px; border: 1px solid #2f1f18; border-radius: 6px; background: #17100d;
  font-size: 12.5px;
}
.bp-entry-lbl { font-size: 10px; color: #74625b; text-transform: uppercase; letter-spacing: 0.12em; }
.bp-entry-item { display: inline-flex; align-items: center; gap: 5px; color: #d7c8c1; }
.bp-entry-item.unknown { color: #d9a86a; }
.bp-entry-total { margin-left: auto; color: #efcdbd; font-variant-numeric: tabular-nums; }
.bp-num { display: inline-flex; align-items: center; gap: 4px; }
.bp-num input {
  background: #0a0706; color: #e7dcd6; border: 1px solid #4d3021; border-radius: 4px;
  padding: 4px 6px; font-family: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums;
}
.bp-num input:focus-visible { outline: 2px solid #ff6a24; outline-offset: 0; }
.bp-num em { font-style: normal; color: #74625b; font-size: 11px; }
.bp-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 12px; padding: 10px 16px 0; align-items: start; }
.bp-group { border: 1px solid #2f1f18; border-radius: 6px; background: #1a160f; min-width: 0; }
.bp-group-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
  padding: 9px 12px; border-bottom: 1px solid #2f1f18;
}
.bp-group-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #a98d82; }
.bp-group-title em { font-style: normal; text-transform: none; letter-spacing: 0.02em; color: #74625b; margin-left: 6px; font-size: 11px; }
.bp-group-sub { font-size: 12.5px; color: #8fd47f; font-variant-numeric: tabular-nums; }
.bp-group-ctl { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
.bp-group-ctl .bp-num input { padding: 2px 4px; font-size: 11.5px; }
.bp-group-ctl .bp-num em { font-size: 10px; }
.bp-table { padding: 0 4px 4px; }
.bp-tr {
  display: grid; grid-template-columns: minmax(0, 1fr) 74px 66px 56px; gap: 6px; align-items: center;
  padding: 5px 7px; border-bottom: 1px solid #221d16; font-size: 12.5px;
}
.bp-tr > span { min-width: 0; }
.bp-tr:last-child { border-bottom: none; }
.bp-th { font-size: 9.5px; color: #74625b; text-transform: uppercase; letter-spacing: 0.1em; border-bottom-color: #332c22; }
.bp-tr.unknown { background: #241d13; }
.bp-cell-name { display: flex; align-items: center; flex-wrap: wrap; gap: 3px 6px; color: #d7c8c1; line-height: 1.3; }
.bp-cell-rate { display: flex; align-items: center; gap: 5px; }
.bp-cell-rate em { font-size: 10.5px; color: #8e7e76; font-style: italic; white-space: nowrap; }
.bp-cell-val { text-align: right; font-variant-numeric: tabular-nums; color: #8fd47f; white-space: nowrap; overflow: hidden; }
.bp-price { display: inline-flex; align-items: center; gap: 3px; }
.bp-price-btn {
  background: none; border: 1px dashed transparent; color: #d9b06a; cursor: pointer;
  font-family: inherit; font-size: 12px; font-variant-numeric: tabular-nums; padding: 2px 4px; border-radius: 4px;
}
.bp-price-btn:hover { border-color: #65351f; color: #f0e4de; }
.bp-price-btn.ov { color: #ff6a24; border-color: #65351f; border-style: solid; }
.bp-price-reset { background: none; border: none; color: #74625b; cursor: pointer; font-size: 12px; padding: 0 2px; }
.bp-price-reset:hover { color: #f0e4de; }
.bp-foot { margin: 14px 16px 0; font-size: 11.5px; color: #74625b; line-height: 1.55; }
.bp-views {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px;
  border-bottom: 1px solid #3e281e; padding-bottom: 10px;
}
.bp-views > button {
  background: #17100d; color: #a98d82; border: 1px solid #65351f; border-radius: 5px;
  padding: 7px 14px; cursor: pointer; font-family: inherit; font-size: 13px;
}
.bp-views > button.on { background: #7a2a13; color: #fff0e6; border-color: #bd461d; }
.bp-views > button:hover { color: #f0e4de; }
.bp-views-active { font-size: 12px; color: #8e7e76; margin-left: 6px; }
.bp-views-active strong { color: #c6aaa0; font-weight: normal; }
.bp-views .bp-reset { margin-left: auto; }
.bp-manage { display: block; }
.bp-manage-head { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; }
.bp-manage-head h3 { margin: 0 6px 0 0; font-size: 17px; color: #f0e4de; letter-spacing: 0.04em; }
.bp-manage-head button, .bp-prof-btns button, .bp-prof-foot button {
  background: #17100d; color: #a98d82; border: 1px solid #65351f; border-radius: 5px;
  padding: 6px 12px; cursor: pointer; font-family: inherit; font-size: 12.5px;
}
.bp-manage-head button:hover, .bp-prof-btns button:hover, .bp-prof-foot button:hover { color: #f0e4de; border-color: #bd461d; }
.bp-primary { background: #7a2a13 !important; color: #fff0e6 !important; border-color: #bd461d !important; }
.bp-danger:hover { color: #d47f7f !important; border-color: #7a4545 !important; }
.bp-prof { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; margin-bottom: 10px; }
.bp-prof.active { border-color: #7a361b; }
.bp-prof.editing { border-color: #bd461d; }
.bp-prof-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; }
.bp-prof-title { font-size: 15px; color: #f0e4de; font-weight: normal; display: inline-flex; align-items: center; gap: 8px; }
.bp-prof-title em {
  font-style: normal; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em;
  color: #8fd47f; border: 1px solid #4e7a45; border-radius: 3px; padding: 1px 5px;
}
.bp-prof-name {
  background: #0a0706; color: #f0e4de; border: 1px solid #65351f; border-radius: 5px;
  padding: 6px 10px; font-family: inherit; font-size: 14px; width: min(240px, 50vw);
}
.bp-prof-meta { font-size: 12px; color: #8e7e76; }
.bp-prof-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.bp-prof-hint { padding: 0 14px 10px; font-size: 12px; color: #9c877e; line-height: 1.5; }
.bp-prof-hint code { color: #c6aaa0; }
.bp-prof-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px; padding: 0 14px 4px; align-items: start;
}
.bp-prof-section { border: 1px solid #2f1f18; border-radius: 6px; background: #1a160f; overflow: hidden; }
.bp-prof-section-head {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #a98d82;
  padding: 7px 10px; border-bottom: 1px solid #2f1f18; border-left: 3px solid var(--tone);
}
.bp-prof-cell {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 10px; font-size: 12.5px; color: #d7c8c1; border-bottom: 1px solid #221d16;
}
.bp-prof-cell:last-child { border-bottom: none; }
.bp-prof-cell > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-prof-foot { padding: 10px 14px 14px; }
.bp-time {
  background: #0a0706; color: #e7dcd6; border: 1px solid #4d3021; border-radius: 4px;
  padding: 4px 6px; font-family: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums;
  text-align: center; flex-shrink: 0;
}
.bp-time:focus-visible { outline: 2px solid #ff6a24; outline-offset: 0; }
.bp-time.custom { border-color: #bd461d; color: #f4dfd3; background: #241d13; }
.bp-timing label { gap: 7px; }

/* ---------------- delve ---------------- */
.dl-wrap { display: block; }
.dl-bar {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
  border: 1px solid #3e281e; border-radius: 8px; background: #120d0b;
  padding: 12px 14px; margin-bottom: 14px;
}
.dl-field { display: flex; flex-direction: column; gap: 5px; }
.dl-field > span {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.12em; color: #74625b;
}
.dl-num input {
  background: #0a0706; color: #e7dcd6; border: 1px solid #4d3021; border-radius: 4px;
  padding: 5px 6px; font-family: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.dl-num input:focus-visible { outline: 2px solid #ff6a24; outline-offset: 0; }
.dl-num em { font-style: normal; font-size: 11.5px; color: #9c877e; margin-left: 4px; }
.dl-presets { display: flex; gap: 5px; }
.dl-presets button, .dl-assume-btn, .dl-money-btn, .dl-reset, .dl-views button {
  background: #17100d; color: #a98d82; border: 1px solid #65351f; border-radius: 5px;
  padding: 6px 10px; cursor: pointer; font-family: inherit; font-size: 12.5px;
}
.dl-presets button { display: flex; flex-direction: column; align-items: center; line-height: 1.15; min-width: 66px; }
.dl-presets button em { font-style: normal; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.65; margin-top: 2px; }
.dl-presets button.on { background: #7a2a13; color: #fff0e6; border-color: #bd461d; }
.dl-presets button:hover, .dl-assume-btn:hover, .dl-money-btn:hover, .dl-reset:hover { color: #f0e4de; border-color: #bd461d; }
.dl-money-btn { display: inline-flex; align-items: center; gap: 7px; }
.dl-money-btn span { color: #e65822; font-size: 15px; line-height: 1; }
.dl-money-btn.on { background: #32170c; color: #f0e4de; border-color: #bd461d; }
.dl-profile-field select {
  min-width: 145px; background: #0a0706; color: #e7dcd6; border: 1px solid #4d3021;
  border-radius: 4px; padding: 5px 7px; font: inherit; font-size: 12.5px;
}
.dl-headline { margin-left: auto; text-align: right; line-height: 1.35; }
.dl-headline strong { display: block; font-size: 19px; color: #f4dfd3; font-variant-numeric: tabular-nums; }
.dl-headline em { font-style: normal; font-size: 11.5px; color: #9c877e; }
.dl-bar-actions { display: flex; align-items: center; gap: 6px; }
.dl-money-guide {
  border: 1px solid #7a361b; border-left: 3px solid #e65822; border-radius: 8px;
  background: linear-gradient(120deg, #160c09, #120d0b 58%); padding: 15px;
  margin: -2px 0 14px;
}
.dl-money-head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 13px; }
.dl-money-head > div > span {
  display: flex; align-items: center; gap: 7px; color: #8e7e76; font-size: 10.5px;
  text-transform: uppercase; letter-spacing: 0.08em;
}
.dl-money-head .dl-src { margin-left: 0; }
.dl-money-head h3 { margin: 7px 0 4px; color: #f4dfd3; font-size: 18px; }
.dl-money-head p { margin: 0; color: #a98d82; font-size: 12.5px; line-height: 1.55; max-width: 82ch; }
.dl-money-head > a {
  flex: 0 0 auto; color: #e6a078; border: 1px solid #65351f; border-radius: 5px;
  padding: 7px 9px; text-decoration: none; font-size: 11.5px;
}
.dl-money-head > a:hover { color: #f4dfd3; border-color: #bd461d; }
.dl-money-grid { display: grid; grid-template-columns: repeat(4, minmax(190px, 1fr)); gap: 8px; }
.dl-money-grid article {
  border: 1px solid #3e281e; border-radius: 6px; background: #0f0a08; padding: 10px;
  display: flex; flex-direction: column; min-width: 0;
}
.dl-money-grid article > span, .dl-money-context span {
  color: #e65822; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em;
}
.dl-money-grid h4 { margin: 5px 0; color: #e7dcd6; font-size: 12.5px; line-height: 1.35; }
.dl-money-grid p { margin: 0 0 8px; color: #9c877e; font-size: 11px; line-height: 1.5; }
.dl-money-grid a { color: #d9a86a; font-size: 10.5px; text-decoration: none; margin-top: auto; }
.dl-money-grid a:hover, .dl-money-source a:hover { color: #f4dfd3; }
.dl-money-context {
  display: grid; grid-template-columns: 0.8fr 1.5fr 1fr; gap: 8px; margin-top: 8px;
}
.dl-money-context > div { border-left: 2px solid #65351f; padding: 4px 10px; min-width: 0; }
.dl-money-context strong { display: block; color: #d7c8c1; font-size: 12px; line-height: 1.4; margin: 4px 0; }
.dl-money-context p { margin: 0; color: #8e7e76; font-size: 10.5px; line-height: 1.5; }
.dl-money-source { margin: 12px 0 0; color: #74625b; font-size: 10.5px; line-height: 1.5; }
.dl-money-source a { color: #a98d82; }
.dl-assume {
  border: 1px solid #7a361b; border-radius: 8px; background: #120d0b;
  padding: 12px 14px; margin-bottom: 14px;
}
.dl-assume-layout {
  display: grid; grid-template-columns: minmax(330px, 0.8fr) minmax(520px, 1.2fr);
  gap: 18px; align-items: start;
}
.dl-assume-values, .dl-assume-samples { min-width: 0; }
.dl-assume-samples {
  border-left: 1px solid #3e281e; padding-left: 18px; min-height: 150px;
}
.dl-assume-samples.open { min-height: 0; }
.dl-samples-open {
  display: flex; flex-direction: column; align-items: flex-start; gap: 5px; width: 100%;
  border: 1px solid #65351f; border-radius: 7px; background: #17100d; color: #d7c8c1;
  padding: 14px; cursor: pointer; text-align: left; font: inherit;
}
.dl-samples-open:hover { border-color: #bd461d; background: #1d130f; }
.dl-samples-open span { color: #f0e4de; font-size: 16px; font-weight: 600; }
.dl-samples-open strong { color: #e6a078; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.dl-samples-open em { color: #8e7e76; font-size: 11.5px; font-style: normal; }
.dl-assume-lead { margin: 0 0 12px; font-size: 12.5px; color: #a98d82; line-height: 1.6; max-width: 78ch; }
.dl-assume-group { margin-bottom: 12px; }
.dl-assume-group h4 {
  margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #74625b;
}
.dl-assume-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  max-width: 460px; padding: 4px 0; font-size: 13px; color: #d7c8c1;
}
.dl-assume-note { margin: 6px 0 0; font-size: 12px; color: #9c877e; line-height: 1.55; max-width: 70ch; }
.dl-assume-row > strong { color: #f4dfd3; font-size: 13px; font-variant-numeric: tabular-nums; }
.dl-depth-guide {
  border-left: 2px solid #65351f; padding: 3px 0 3px 9px; margin: 8px 0;
}
.dl-depth-guide strong { display: block; color: #d7c8c1; font-size: 12px; margin-bottom: 3px; }
.dl-depth-guide span { display: block; color: #8e7e76; font-size: 11px; line-height: 1.5; }
.dl-source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 7px; margin-top: 4px; }
.dl-source-grid a {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 6px; align-items: center;
  border: 1px solid #3e281e; border-radius: 5px; background: #17100d; padding: 8px 9px;
  color: #d7c8c1; text-decoration: none;
}
.dl-source-grid a:hover { border-color: #7a361b; }
.dl-source-grid a .dl-src { grid-row: 1 / 3; margin-left: 0; }
.dl-source-grid a strong { font-size: 12px; }
.dl-source-grid a span { font-size: 10.5px; color: #8e7e76; line-height: 1.35; }
.dl-views { display: flex; gap: 6px; margin-bottom: 14px; overflow-x: auto; padding-bottom: 2px; }
.dl-views button { flex: 0 0 auto; }
.dl-views button.on { background: #7a2a13; color: #fff0e6; border-color: #bd461d; }
.dl-subbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
.dl-hint { font-size: 12px; color: #9c877e; line-height: 1.55; max-width: 72ch; }
.dl-lead { font-size: 13px; color: #a98d82; line-height: 1.6; max-width: 78ch; margin: 0 0 14px; }
.dl-h { margin: 22px 0 8px; font-size: 13px; color: #f0e4de; font-weight: 600; }
.dl-note { font-size: 12px; color: #9c877e; line-height: 1.6; max-width: 78ch; margin: 8px 0 0; }
.dl-note.warn { color: #d9a86a; }
.dl-flag {
  font-size: 9.5px; font-style: normal; text-transform: uppercase; letter-spacing: 0.08em;
  border: 1px solid #65351f; border-radius: 3px; padding: 1px 4px; color: #9c877e;
  margin-left: 6px; white-space: nowrap;
}
.dl-flag.warn { border-color: #7a5c33; color: #d9a86a; }

/* biome cards */
.dl-biomes { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; align-items: start; }
.dl-biome {
  border: 1px solid #3e281e; border-radius: 8px; background: #120d0b;
  border-left: 3px solid var(--tone); padding: 0 0 10px; overflow: hidden;
}
.dl-biome.dead { opacity: 0.5; }
/* Not a biome — dashed edge so the stash reads as the odd card in the grid. */
.dl-stash { border-style: dashed; border-left-style: solid; }
.dl-stash .dl-biome-head { cursor: default; }
.dl-stash .dl-biome-head:hover { background: none; }
.dl-biome.open { border-color: #7a361b; }
.dl-biome-head {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; padding: 11px 13px 8px; color: #e7dcd6; font-family: inherit; font-size: 14.5px;
}
.dl-biome-head:hover { background: #1d120e; }
.dl-biome-head:focus-visible { outline: 2px solid #ff6a24; outline-offset: -2px; }
.dl-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--tone); flex-shrink: 0; }
.dl-biome-name { flex: 1; min-width: 0; display: flex; align-items: center; }
.dl-biome-val { font-variant-numeric: tabular-nums; color: #f4dfd3; white-space: nowrap; font-size: 15px; }
.dl-biome-val em { font-style: normal; font-size: 10.5px; color: #9c877e; margin-left: 4px; }
.dl-share { padding: 0 13px 8px; }
.dl-share i {
  display: block; height: 4px; border-radius: 999px;
  background: linear-gradient(90deg, var(--tone), #f4dfd3); min-width: 2px; margin-bottom: 4px;
}
.dl-share span { font-size: 11px; color: #8e7e76; }
.dl-excl { padding: 0 13px 6px; font-size: 12.5px; color: #a98d82; line-height: 1.55; }
.dl-excl strong { color: #e7d9d2; font-weight: 600; }
.dl-excl b { color: #efcdbd; font-weight: 600; }
.dl-node-data { display: block; margin-top: 3px; font-style: normal; color: #74625b; font-size: 10.5px; }
.dl-personal-range { padding: 0 13px 2px; color: #d9a86a; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dl-community-range { padding: 0 13px 3px; color: #c9a78f; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dl-community-range .dl-src { margin-left: 0; margin-right: 5px; }
.dl-biome-body { padding: 4px 13px 0; border-top: 1px solid #2f1f18; margin-top: 6px; }
.dl-biome-body h5 {
  margin: 12px 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #74625b;
}
.dl-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 5px; }
.dl-chips li {
  border: 1px solid #3e281e; border-radius: 4px; padding: 3px 7px;
  font-size: 11.5px; color: #a98d82; background: #17100d;
}
.dl-chips li.unpriced { opacity: 0.5; }
.dl-chips li b { color: #efcdbd; font-weight: 600; margin-left: 5px; font-variant-numeric: tabular-nums; }
.dl-parts { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.dl-parts td { padding: 3px 0; color: #a98d82; }
.dl-parts td:last-child { text-align: right; color: #e7d9d2; font-variant-numeric: tabular-nums; }
.dl-parts-total td { border-top: 1px solid #2f1f18; padding-top: 6px; color: #f0e4de; font-weight: 600; }

/* tables */
.dl-table-wrap { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; overflow-x: auto; }
.dl-table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 13px; }
.dl-table th {
  text-align: left; padding: 9px 13px; font-size: 10px; font-weight: 400;
  text-transform: uppercase; letter-spacing: 0.12em; color: #74625b; border-bottom: 1px solid #2f1f18;
}
.dl-table th.r, .dl-table td.r { text-align: right; }
.dl-table td { padding: 7px 13px; color: #d7c8c1; border-bottom: 1px solid #221d16; }
.dl-table tr:last-child td { border-bottom: none; }
.dl-table td.num { font-variant-numeric: tabular-nums; color: #efcdbd; white-space: nowrap; }
.dl-table tr.unpriced td { opacity: 0.55; }
.dl-table tr.dl-sep td {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #74625b;
  background: #17100d; padding: 6px 13px;
}
.dl-where { color: #9c877e; font-size: 12px; }

.dl-wall-card {
  display: grid; grid-template-columns: minmax(240px, 1fr) minmax(280px, 1.4fr); gap: 18px;
  margin-top: 14px; border: 1px solid #7a361b; border-left: 3px solid #bd461d;
  border-radius: 8px; background: linear-gradient(120deg, #160c09, #120d0b); padding: 14px;
}
.dl-wall-card h4 { margin: 4px 0 6px; color: #f0e4de; font-size: 15px; }
.dl-wall-card p { margin: 0; color: #a98d82; font-size: 12px; line-height: 1.55; }
.dl-wall-values { display: grid; gap: 6px; }
.dl-wall-values > span {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 7px 9px;
  border: 1px solid #3e281e; border-radius: 5px; background: #0f0a08;
}
.dl-wall-values strong { color: #d7c8c1; font-size: 12px; }
.dl-wall-values b { color: #efcdbd; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dl-wall-values em { grid-column: 1 / -1; color: #74625b; font-size: 10.5px; font-style: normal; }

/* bosses */
.dl-bosses { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
.dl-boss { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; padding: 0 13px 12px; }
.dl-boss.open { border-color: #7a361b; grid-column: 1 / -1; }
.dl-boss-head {
  display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; padding: 12px 0 4px; color: #e7dcd6; font-family: inherit; font-size: 15px;
}
.dl-boss-head:focus-visible { outline: 2px solid #ff6a24; outline-offset: -2px; }
.dl-boss-name { flex: 1; min-width: 0; }
.dl-boss-val {
  display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
  font-variant-numeric: tabular-nums; color: #f4dfd3; white-space: nowrap;
}
.dl-boss-val > span { display: flex; align-items: baseline; }
.dl-boss-val b { font-size: 14px; font-weight: 600; }
.dl-boss-val em { font-style: normal; font-size: 10.5px; color: #9c877e; margin-left: 5px; }
.dl-boss-val small { color: #d9a86a; font-size: 10px; }
.dl-boss-meta { font-size: 11.5px; color: #8e7e76; margin-bottom: 10px; line-height: 1.5; }
.dl-boss-estimate {
  display: grid; grid-template-columns: minmax(280px, 0.85fr) minmax(440px, 1.6fr); gap: 16px;
  border: 1px solid #7a361b; border-left: 3px solid #e65822; border-radius: 8px;
  background: linear-gradient(120deg, #1b0d09, #120d0b 58%); padding: 13px 14px; margin-bottom: 12px;
}
.dl-boss-estimate header > span {
  color: #8e7e76; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
}
.dl-boss-estimate header .dl-src { margin-left: 0; margin-right: 6px; }
.dl-boss-estimate h3 { margin: 7px 0 4px; color: #f4dfd3; font-size: 17px; }
.dl-boss-estimate header p { margin: 0; color: #a98d82; font-size: 11.5px; line-height: 1.5; }
.dl-boss-estimate-grid { display: grid; grid-template-columns: repeat(3, minmax(125px, 1fr)); gap: 7px; }
.dl-boss-estimate-grid article {
  display: flex; flex-direction: column; justify-content: center; min-width: 0;
  border: 1px solid #3e281e; border-radius: 6px; background: #0f0a08; padding: 9px 10px;
}
.dl-boss-estimate-grid span { color: #8e7e76; font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; }
.dl-boss-estimate-grid strong { color: #f4dfd3; font-size: 18px; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
.dl-boss-estimate-grid em { color: #d9a86a; font-size: 10.5px; font-style: normal; line-height: 1.35; }
.dl-community-boss {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 12px;
  margin: 0 0 10px; padding: 8px 9px; border: 1px solid #65351f; border-left: 3px solid #bd461d; border-radius: 4px;
  background: #1a0f0b; color: #b89c91; font-size: 11px; font-variant-numeric: tabular-nums;
}
.dl-community-boss strong { color: #f1bd8d; font-size: 12.5px; font-weight: 600; }
.dl-spread { position: relative; height: 10px; background: #281a14; border-radius: 999px; margin-bottom: 6px; }
.dl-spread i.band { position: absolute; top: 0; height: 100%; border-radius: 999px; background: #7a2a13; min-width: 2px; }
.dl-spread i.med { position: absolute; top: -2px; width: 2px; height: 14px; background: #f4dfd3; border-radius: 1px; }
.dl-spread i.mean { position: absolute; top: -2px; width: 2px; height: 14px; background: #6fb4c9; border-radius: 1px; }
.dl-spread-key { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: #8e7e76; font-variant-numeric: tabular-nums; }
.dl-spread-key .med { color: #f4dfd3; }
.dl-spread-key .mean { color: #6fb4c9; }
.dl-boss-body { margin-top: 12px; border-top: 1px solid #2f1f18; padding-top: 4px; }
.dl-boss-body .dl-table { font-size: 12.5px; }
.dl-boss-body .dl-table td, .dl-boss-body .dl-table th { padding-left: 0; padding-right: 0; }
.dl-drop-toggle {
  display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none;
  color: #d7c8c1; cursor: pointer; font: inherit; text-align: left;
}
.dl-drop-toggle:hover { color: #f4dfd3; }
.dl-drop-toggle:focus-visible { outline: 1px solid #ff6a24; outline-offset: 3px; }
.dl-drop-toggle > span:last-child { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 7px; }
.dl-drop-toggle small { color: #9c877e; font-size: 10px; font-variant-numeric: tabular-nums; }
.dl-variant-count {
  color: #e6a078; border: 1px solid #65351f; border-radius: 3px; padding: 1px 4px;
  font-size: 9px; font-style: normal; text-transform: uppercase; letter-spacing: 0.06em;
}
.dl-drop-chevron { color: #e65822; width: 9px; font-size: 11px; }
.dl-table tr.dl-variant-row td { padding: 8px 10px 10px; background: #0e0a08; border-bottom-color: #3e281e; }
.dl-variant-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 5px 18px; }
.dl-variant-grid span { display: flex; justify-content: space-between; gap: 12px; color: #9c877e; }
.dl-variant-grid strong { color: #d7c8c1; font-weight: 500; }
.dl-variant-grid b { color: #efcdbd; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dl-variant-row p { margin: 8px 0 0; color: #74625b; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.dl-variant-row p strong { color: #e6a078; font-weight: 600; }

/* Delve sample profiles */
.dl-sample-title { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 12px; }
.dl-sample-title h3 { margin: 0 0 5px; color: #f0e4de; font-size: 17px; }
.dl-sample-title p { margin: 0; color: #a98d82; max-width: 78ch; font-size: 12.5px; line-height: 1.55; }
.dl-sample-title-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.dl-sample-new, .dl-sample-actions button {
  background: #17100d; color: #c6aaa0; border: 1px solid #65351f; border-radius: 5px;
  padding: 6px 9px; cursor: pointer; font: inherit; font-size: 11.5px; white-space: nowrap;
}
.dl-sample-new:hover, .dl-sample-actions button:hover { color: #f0e4de; border-color: #bd461d; }
.dl-sample-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.dl-assume-samples .dl-sample-grid { grid-template-columns: 1fr; }
.dl-sample-card { border: 1px solid #3e281e; border-radius: 8px; background: #120d0b; overflow: hidden; }
.dl-sample-card.active { border-color: #bd461d; box-shadow: inset 0 0 0 1px #4d2415; }
.dl-sample-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 11px 13px 8px; border-bottom: 1px solid #2f1f18; }
.dl-sample-card-head h4 { margin: 0; color: #e7dcd6; font-size: 14.5px; }
.dl-sample-card-head span { color: #74625b; font-size: 10.5px; }
.dl-sample-name { background: #0a0706; color: #e7dcd6; border: 1px solid #7a361b; border-radius: 4px; padding: 4px 6px; font: inherit; }
.dl-sample-yields { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid #2f1f18; }
.dl-sample-yields > span { padding: 9px 10px; border-right: 1px solid #2f1f18; }
.dl-sample-yields > span:last-child { border-right: none; }
.dl-sample-yields small, .dl-sample-yields strong { display: block; }
.dl-sample-yields small { min-height: 28px; color: #8e7e76; font-size: 9.5px; line-height: 1.35; }
.dl-sample-yields strong { color: #f4dfd3; font-size: 18px; font-variant-numeric: tabular-nums; margin: 2px 0 4px; }
.dl-sample-yields .dl-src { margin-left: 0; }
.dl-sample-summary { padding: 9px 13px; color: #9c877e; font-size: 11.5px; line-height: 1.45; }
.dl-sample-summary strong { color: #d7c8c1; }
.dl-sample-editor { border-top: 1px solid #2f1f18; padding: 9px 13px; }
.dl-sample-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.dl-sample-fields .dl-assume-row { max-width: none; }
.dl-sample-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 9px 13px 12px; border-top: 1px solid #2f1f18; }
.dl-sample-actions > strong { color: #e6a078; font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em; margin-right: auto; }
.dl-sample-actions button.danger { color: #d99584; border-color: #713329; }

.dl-panel-detail { padding: 4px 14px 14px; }
.dl-panel-detail h5 {
  margin: 14px 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #74625b;
}
.dl-panel-detail .dl-excl { padding: 0 0 4px; }
.dl-grid-plain .st-row { cursor: default; }
.st-row-static { display: flex; align-items: center; justify-content: space-between; }

.dl-apply {
  background: #32170c; color: #e6a078; border: 1px solid #7a361b; border-radius: 3px;
  font-family: inherit; font-size: 10px; padding: 1px 5px; margin-left: 6px; cursor: pointer;
  text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap;
}
.dl-apply:hover { color: #f4dfd3; border-color: #bd461d; }

.dl-implied {
  font-style: normal; font-size: 11px; color: #74625b; margin-left: 8px; white-space: nowrap;
}
.dl-assume-row > span { display: flex; align-items: baseline; }

.dl-define {
  border: 1px solid #3e281e; border-left: 3px solid #7a361b; border-radius: 6px;
  background: #120d0b; padding: 9px 13px; margin: 0 0 14px;
  font-size: 12.5px; color: #a98d82; line-height: 1.65; max-width: 100ch;
}
.dl-define strong { color: #e7d9d2; font-weight: 600; }
.dl-inline-link {
  background: none; border: none; padding: 0; font: inherit; color: #ff6a24;
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.dl-inline-link:hover { color: #f4dfd3; }

.dl-sub-head {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px 8px; margin-top: 4px; border-top: 1px solid #2f1f18;
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #a98d82;
}
.dl-sub-head em {
  font-style: normal; font-size: 11px; text-transform: none; letter-spacing: 0.02em; color: #74625b;
}

.dl-mode-summary {
  display: grid; grid-template-columns: auto minmax(180px, auto) minmax(280px, 1fr); gap: 7px 14px; align-items: center;
  border: 1px solid #3e281e; border-radius: 6px; background: #120d0b; padding: 9px 11px; margin-bottom: 12px;
}
.dl-mode-summary.estimate {
  border-color: #7a361b; border-left: 3px solid #e65822;
  background: linear-gradient(100deg, #1b0d09, #120d0b 58%);
}
.dl-mode-kicker { color: #8e7e76; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
.dl-mode-kicker .dl-src { margin-left: 0; margin-right: 6px; }
.dl-mode-summary > strong { color: #f4dfd3; font-size: 13px; }
.dl-mode-summary p { margin: 0; color: #a98d82; font-size: 11.5px; line-height: 1.45; }
.dl-biome-val em { display: block; text-align: right; margin-left: 0; }

.dl-src {
  font-style: normal; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em;
  border: 1px solid #65351f; border-radius: 3px; padding: 1px 4px; margin-left: 7px; color: #9c877e;
}
.dl-src.ok { border-color: #4f7a45; color: #a5d48f; }
.dl-src.warn { border-color: #7a5c33; color: #d9a86a; }
.dl-src.personal { border-color: #9f3e1e; color: #f0a078; }

.st-seg button.dim { opacity: 0.45; }
.st-seg button.dim.on { opacity: 0.75; }
.st-seg button:disabled { opacity: 0.42; cursor: not-allowed; }

@media (max-width: 720px) {
  .dl-headline { width: 100%; margin-left: 0; text-align: left; }
  .dl-bar-actions { flex-wrap: wrap; }
  .dl-money-head { flex-direction: column; gap: 10px; }
  .dl-money-grid, .dl-money-context { grid-template-columns: 1fr; }
  .dl-mode-summary { grid-template-columns: 1fr; gap: 4px; }
  .dl-mode-kicker { white-space: normal; }
  .dl-boss-estimate { grid-template-columns: 1fr; }
  .dl-boss-estimate-grid { grid-template-columns: 1fr; }
  .dl-assume-layout { grid-template-columns: 1fr; }
  .dl-assume-samples { border-left: 0; border-top: 1px solid #3e281e; padding: 14px 0 0; }
  .dl-wall-card { grid-template-columns: 1fr; }
  .dl-sample-grid { grid-template-columns: 1fr; }
  .dl-sample-fields { grid-template-columns: 1fr; }
  .dl-sample-title { flex-direction: column; }
}
@media (min-width: 721px) and (max-width: 1120px) {
  .dl-money-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
  .dl-money-context { grid-template-columns: 1fr; }
  .dl-boss-estimate { grid-template-columns: 1fr; }
  .dl-assume-layout { grid-template-columns: 1fr; }
  .dl-assume-samples { border-left: 0; border-top: 1px solid #3e281e; padding: 14px 0 0; }
}
`;
