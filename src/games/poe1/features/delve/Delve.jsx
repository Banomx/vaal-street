import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import {
  BIOMES, NODES, NODE_KINDS, TUNABLES, DEFAULTS, SOURCES, DELVE_BOSSES,
  RESONATOR_ORDER, RESONATOR_SOCKETS, COMMUNITY_DEPTH_GUIDE,
} from "./delveData.js";
import {
  makePriceOf, fossilRows, computeBiomes, computeDelveBosses, killDistribution,
  biomeValueSeries, clusterValueSeries, loadSettings, saveSettings, sanitizeSettings,
  SAMPLE_FIELDS, defaultSampleProfile, loadSampleProfiles, saveSampleProfiles,
  loadActiveSampleProfile, saveActiveSampleProfile, sanitizeSampleProfile,
  uniqueSampleName, sampleMetrics,
} from "./delve.js";
import { makeResolver } from "../bosses/bossProfit.js";
import { sourceNote } from "../pricing/priceCheck.js";
import PriceCell from "../pricing/PriceCell.jsx";
import PriceChart, { PctBadge, rateAt } from "../pricing/PriceChart.jsx";
import { unitForSeries } from "../pricing/money.js";
import { CHANGE_KEYS, CHANGE_WINDOW_OPTIONS, nearestRateWindow } from "../pricing/marketWindows.js";
import { POE1_SCHEMA_VERSIONS } from "../../config.js";
import { isUsable, loadDocument } from "../../../../shared/data/snapshot.js";

/* ================================================================
   DELVE
   What a delve level is worth, and where to point it.

   Three views, in the order you actually ask the questions:

     Fossils   what's a fossil worth and what moved. Same shape as the
               astrolabe/catalyst tabs — toolbar, one chart, one grid —
               because it is the same question about different items.
     Biomes    which exclusive fossil target do I want at this depth?
               Target value stays in currency. A clearly labelled community
               curve estimates special-vs-generic node value by depth; biome
               share and that estimate form the relative opportunity index.
               Opening one gives it the mechanic panel treatment: that node
               charted over the league, the biome's fossils beside it, and
               what every other node there pays.
     Bosses    a delve boss is a handful of kills a league, not a farm.
               So the tab leads with the spread of a SINGLE kill, and
               keeps the mean next to it rather than instead of it.

   The UI separates data-mined values, community estimates, creator observations,
   conservative fallbacks and personal samples. See delveData.js for the current
   working depth caps.
   ================================================================ */

const STASH_ID = "smugglers-stash";
const WALLS_ID = "fractured-walls";
const pctText = (raw) => {
  const v = Math.round(raw * 1e6) / 1e6;
  return v >= 0.1 ? `${(v * 100).toFixed(0)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : v > 0 ? "<0.1%" : "—";
};

const BIOME_NAME = Object.fromEntries(BIOMES.map((b) => [b.id, b.name]));
const BIOME_TONE = Object.fromEntries(BIOMES.map((b) => [b.id, b.tone]));

/* A fossil reads as a shard: hexagonal, tinted by the biome it comes from,
   with a brighter core for the six that only drop from their own node. */
function FossilIcon({ tone = "#c9a24b", exclusive = false, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 2.6 L19.6 7 L19.6 17 L12 21.4 L4.4 17 L4.4 7 Z"
        fill={tone} fillOpacity={exclusive ? 0.9 : 0.55} stroke="#1b150c" strokeWidth="1.1" />
      <path d="M12 7 L15.8 9.2 L15.8 14.8 L12 17 L8.2 14.8 L8.2 9.2 Z"
        fill={exclusive ? "#f0dfa8" : "#1b150c"} fillOpacity={exclusive ? 0.75 : 0.25} />
    </svg>
  );
}

function ResonatorIcon({ sockets = 1, size = 20 }) {
  const pts = [[12, 6.4], [16.4, 12], [12, 17.6], [7.6, 12]];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="16" height="16" rx="3" fill="#3a332a" stroke="#6b5730" strokeWidth="1.1" />
      {pts.slice(0, sockets).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="#c9a24b" stroke="#1b150c" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

/* Controlled number input that lets you clear the field while typing.
   Same behaviour as the boss tab's, kept local so neither tab can break
   the other by tweaking it. */
function NumInput({ value, onCommit, step = 1, min = 0, width = 62, suffix, title }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="dl-num" title={title}>
      <input
        type="number" step={step} min={min} value={draft} style={{ width }}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          const n = Number(e.target.value);
          if (e.target.value === "" || !isFinite(n)) { setDraft(String(value ?? "")); return; }
          onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

const DEPTH_PRESETS = [
  { depth: 300, label: "sideways" },
  { depth: 600, label: "boss cap" },
  { depth: 1500, label: "fossil cap" },
];
const VIEWS = [
  ["fossils", "Fossils & resonators"],
  ["biomes", "Biome targets"],
  ["bosses", "Bosses"],
];

const MONEY_GUIDE_VIDEO = "https://www.youtube.com/watch?v=tA-V2IhRJdA";
const MONEY_GUIDE_TIPS = [
  {
    label: "Route first",
    title: "Pay up to four travel nodes for premium targets",
    body: "Prioritise Hollow or Faceted fossil encounters and the Vaal boss. Duddybrainzz was willing to spend four travel nodes to reach them.",
    time: 50,
  },
  {
    label: "Also take",
    title: "Aul, generic fossils and Fractured Fossil nodes",
    body: "These were the other detours called worth taking. Use the live cards below to decide which fossil target is actually paying today.",
    time: 50,
  },
  {
    label: "Sulphite loop",
    title: "Touch sulphite and leave the map",
    body: "The example used a few 8-mod Jungle Valley maps with one Sulphite Scarab, ran only to the sulphite deposits, then left. Four sacrifice fragments are optional.",
    time: 125,
  },
  {
    label: "Market check",
    title: "Treat carries and fracture crafts as extra profit",
    body: "Check demand for Aul Bloodline carries and the current margin on fracturing +2 socketed minion boots or gloves onto Leviathan bases before committing currency.",
    time: 80,
  },
];

const moneyGuideUrl = (seconds) => `${MONEY_GUIDE_VIDEO}&t=${seconds}s`;

export default function Delve({ league, staticBase, currency, divineRate, mirrorDivine, fmtPrice, fmtChaos, unitFor }) {
  const [view, setView] = useState("fossils");
  const [settings, setSettings] = useState(() => loadSettings());
  const initialSamples = useRef(null);
  if (!initialSamples.current) {
    const profiles = loadSampleProfiles();
    initialSamples.current = { profiles, active: loadActiveSampleProfile(profiles) };
  }
  const [sampleProfiles, setSampleProfiles] = useState(initialSamples.current.profiles);
  const [activeSampleName, setActiveSampleName] = useState(initialSamples.current.active);
  const [editingSample, setEditingSample] = useState(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [showMoneyGuide, setShowMoneyGuide] = useState(false);
  const [openBiome, setOpenBiome] = useState(null);
  const [openBoss, setOpenBoss] = useState(null);
  const [openBossDrop, setOpenBossDrop] = useState(null);
  const [rankBy, setRankBy] = useState("depth"); // target | depth | opportunity | sample
  const [sortDir, setSortDir] = useState("desc");
  const [chgWindow, setChgWindow] = useState("24h");
  const [filter, setFilter] = useState("");
  const [selFossil, setSelFossil] = useState(null);     // charted on the Fossils view
  const [focusFossil, setFocusFossil] = useState(null); // overlaid on a biome's curve
  const [dragSel, setDragSel] = useState(null);
  const [realMode, setRealMode] = useState(false);      // read every % in divine terms
  const [fossilData, setFossilData] = useState(null);   // {items, generatedAt} | "missing"
  const [resoData, setResoData] = useState(null);
  const [hist, setHist] = useState({});                 // name -> [{day, value}]
  const [priceMap, setPriceMap] = useState(null);       // prices.json | "missing"
  const [generatedAt, setGeneratedAt] = useState(null);
  // Which price sources actually answered when this snapshot was taken.
  const [priceSource, setPriceSource] = useState(null);

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveSampleProfiles(sampleProfiles); }, [sampleProfiles]);
  useEffect(() => { saveActiveSampleProfile(activeSampleName); }, [activeSampleName]);

  const patch = useCallback((p) => setSettings((s) => sanitizeSettings({ ...s, ...p })), []);
  const activeSampleProfile = sampleProfiles.find((p) => p.name === activeSampleName) || sampleProfiles[0];
  const sample = useMemo(() => sampleMetrics(activeSampleProfile), [activeSampleProfile]);
  const modelSettings = useMemo(() => ({ ...settings, ...sample.quantities }), [settings, sample]);

  useEffect(() => {
    if (rankBy === "sample" && !sample.hasTimedSample) setRankBy("depth");
  }, [rankBy, sample.hasTimedSample]);

  /* ---- data ----
     Four snapshots, all optional in different ways:
       fossils.json / resonators.json    price + trend for the two lists
       *-history.json                    the curves
       prices.json                       the broad name->price map the boss
                                         EV needs. Fossils are in it too, so
                                         it doubles as the fallback for a
                                         snapshot taken before this feature
                                         started writing fossils.json. */
  useEffect(() => {
    if (!staticBase) return undefined; // no league folder yet
    let cancelled = false;
    /* Generated market files keep the same URL between hourly deployments.
       Revalidate them so an old browser cache cannot freeze boss medians, and
       check each one against the schema this build reads — an unreadable file
       is treated as absent rather than rendered from whatever came back. */
    const grab = async (file, set, options) => {
      const doc = await loadDocument(`${staticBase}/${file}`, { supported: POE1_SCHEMA_VERSIONS, ...options });
      if (!cancelled) set(isUsable(doc) ? doc.data : "missing");
    };
    setFossilData(null); setResoData(null); setPriceMap(null); setHist({});
    grab("fossils.json", (j) => { setFossilData(j); if (j !== "missing" && j.generatedAt) setGeneratedAt(j.generatedAt); }, { required: ["items"] });
    grab("resonators.json", setResoData, { required: ["items"] });
    grab("fossils-history.json", (j) => { if (j !== "missing") setHist((h) => ({ ...h, ...j })); }, { versioned: false });
    grab("resonators-history.json", (j) => { if (j !== "missing") setHist((h) => ({ ...h, ...j })); }, { versioned: false });
    grab("prices.json", (j) => {
      if (j === "missing") { setPriceMap("missing"); return; }
      setPriceMap(j.prices || {});
      setPriceSource(j.priceSource || null);
      setGeneratedAt((g) => g || j.generatedAt || null);
    }, { required: ["prices"] });
    return () => { cancelled = true; };
  }, [staticBase]);

  const fossilItems = fossilData && fossilData !== "missing" ? fossilData.items || [] : [];
  const resoItems = resoData && resoData !== "missing" ? resoData.items || [] : [];
  const rate = (fossilData && fossilData !== "missing" && fossilData.divineRate) || divineRate;
  const axisLabel = (fossilData && fossilData !== "missing" && fossilData.historyAxis) || "days since first snapshot";

  /* Divine-adjusted needs two things, and they go missing independently:
     the rate CURVE (for the dashed line and the drag readout) and the
     per-item change*R fields (for the badges).

     And the second one arrives ONE WINDOW AT A TIME, which is the part that
     bit. A change*R for a 24h window needs a snapshot from 24h ago that
     stored the divine rate. Fossils are a new category, so their self-history
     starts at zero and grows: at seven hours old the data carries change4R
     and nothing longer, while change24 still shows up because that one comes
     from poe.ninja's own sparkline rather than our history.

     Treating "has R data" as one global flag therefore made the toggle look
     broken on the default 24h window — it had R data, just not for that
     window. Readiness is per window now, and the UI says which. */
  const rateHistory = useMemo(() => {
    const fromFossils = fossilData && fossilData !== "missing" ? fossilData.rateHistory : null;
    const fromReso = resoData && resoData !== "missing" ? resoData.rateHistory : null;
    return (Array.isArray(fromFossils) && fromFossils.length ? fromFossils : fromReso) || [];
  }, [fossilData, resoData]);
  const rateReady = rateHistory.length > 1;

  const realWindows = useMemo(() => {
    const items = [...fossilItems, ...resoItems];
    const out = new Set();
    for (const [w, key] of Object.entries(CHANGE_KEYS)) {
      if (items.some((it) => isFinite(it[`${key}R`]))) out.add(w);
    }
    return out;
  }, [fossilData, resoData]);
  const realBadges = realWindows.size > 0;
  const useReal = realMode && rateReady;
  const realHere = useReal && realWindows.has(chgWindow);

  /* How far back the stored rate actually goes — the ceiling on which
     windows can ever be divine-adjusted, and the number that explains why
     the long ones are missing. */
  const historyHours = rateHistory.length > 1
    ? (rateHistory[rateHistory.length - 1].day - rateHistory[0].day) * 24
    : 0;

  /* Ticking the box on a window with no R data would do visibly nothing,
     which is exactly the bug. Move to the longest window that does have it. */
  useEffect(() => {
    if (!useReal || !realBadges || realWindows.has(chgWindow)) return;
    const best = [...realWindows].sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
    if (best) setChgWindow(best);
  }, [useReal, realBadges, realWindows, chgWindow]);

  const trendBy = useMemo(() => {
    const m = {};
    for (const it of [...fossilItems, ...resoItems]) m[it.name] = it;
    return m;
  }, [fossilData, resoData]);

  /* fossils.json carries trend data; prices.json does not. Prefer the first
     for anything it knows and let the second fill the rest, so a league whose
     snapshot predates fossils.json still gets numbers. */
  const priceOf = useMemo(() => {
    const fromCategory = {};
    for (const it of [...fossilItems, ...resoItems]) if (it.chaosValue > 0) fromCategory[it.name] = { c: it.chaosValue, n: 1 };
    const map = priceMap && priceMap !== "missing" ? priceMap : null;
    return makePriceOf([fromCategory, map], { overrides: settings.priceOverrides || {}, divineRate: rate });
  }, [fossilData, resoData, priceMap, settings.priceOverrides, rate]);

  const havePrices = (fossilItems.length > 0) || (priceMap && priceMap !== "missing");

  /* The boss engine wants prices.json's { name: {c,lo,hi,n} } shape. */
  const resolve = useMemo(
    () => makeResolver(priceMap && priceMap !== "missing" ? priceMap : null, {
      priceOverrides: settings.priceOverrides || {}, divineRate: rate,
    }),
    [priceMap, settings.priceOverrides, rate]
  );

  /* Same override map the Boss tab writes, keyed by item name and read by the
     resolver above, so a price corrected in one place is corrected everywhere
     it appears. Passing null clears it and the market price comes back. */
  const setPriceOverride = useCallback((item, chaos) => {
    setSettings((s) => {
      const po = { ...(s.priceOverrides || {}) };
      if (chaos == null) delete po[item];
      else po[item] = chaos;
      return sanitizeSettings({ ...s, priceOverrides: po });
    });
  }, []);

  const bosses = useMemo(() => computeDelveBosses(resolve, settings), [resolve, settings]);
  const dists = useMemo(() => {
    const out = {};
    for (const b of bosses) out[b.delve.id] = killDistribution(b, 4000);
    return out;
  }, [bosses]);

  const biomes = useMemo(() => computeBiomes(priceOf, modelSettings, sample), [priceOf, modelSettings, sample]);
  const fossils = useMemo(() => fossilRows(priceOf), [priceOf]);
  const activeBossChances = bosses.filter((boss) => boss.available).map((boss) => boss.encounterChance);
  const specialChanceNow = Math.max(0, ...biomes.targets.map((row) => row.specialChance));
  const bossChanceLow = activeBossChances.length ? Math.min(...activeBossChances) : 0;
  const bossChanceHigh = activeBossChances.length ? Math.max(...activeBossChances) : 0;

  /* The two cluster nodes ride in the same grid as the biomes and open the same
     panel; only their copy differs, so they are described once here. */
  const extraCards = [
    {
      id: STASH_ID,
      label: NODE_KINDS.stash.label,
      tone: NODE_KINDS.stash.tone,
      node: biomes.stash,
      lead: "Chests",
      poolWord: "generic fossils",
      shareText: `${pctText(biomes.stash.share)} of fossil nodes`,
      shareTitle: `${pctText(biomes.stash.share)} of fossil nodes at depth ${settings.depth} — a stash turns up in any biome`,
      headTitle: "Median outcome of one stash across the generic pool.",
      perHour: sample.stashPerHour,
      detail: <>{biomes.stash.poolNames.length} fossils in pool · the six biome targets and the wall-only fossils are excluded</>,
      panelNote: `Any fossil except the six biome targets and the wall-only ones — the ${biomes.stash.poolNames.length} below, drawn from the whole mine rather than the biome you are in.`,
    },
    {
      id: WALLS_ID,
      label: NODE_KINDS.wall.label,
      tone: NODE_KINDS.wall.tone,
      node: biomes.walls,
      lead: "A wall",
      poolWord: "wall-locked fossils",
      shareText: `${pctText(biomes.walls.share)} of nodes travelled to`,
      shareTitle: "Working estimate of how often a fractured wall turns up on the way to a node. Not a fossil node, so this does not compete with the special/stash split.",
      headTitle: "Median outcome of one fractured wall.",
      perHour: 0,
      detail: <>{biomes.walls.poolNames.length} fossils in pool · walls are the only source of these</>,
      panelNote: `The ${biomes.walls.poolNames.length} fossils below are the ones no other node drops. A wall is not a fossil node — it turns up in the darkness on the way to one — so its share is per node travelled to. Drop count preliminary.`,
    },
  ];
  /* Cluster nodes are ranked with the biomes rather than pinned to the end of
     the grid: they are things you steer towards in the same way. */
  const ranked = useMemo(() => {
    const value = (row) => rankBy === "target"
      ? row.headline
      : rankBy === "depth"
        ? row.depthAdjustedRange.median
      : rankBy === "sample"
        ? row.personalRange?.median || 0
        : row.opportunityIndex;
    const extraValue = (card) => rankBy === "opportunity"
      ? card.node.opportunityIndex
      : rankBy === "sample"
        ? card.perHour * card.node.range.median
        : card.node.range.median;
    const cards = [
      ...biomes.targets.map((row) => ({ kind: "biome", key: row.biome.id, row, sort: value(row) })),
      ...extraCards.map((card) => ({ kind: "extra", key: card.id, card, sort: extraValue(card) })),
    ];
    cards.sort((a, b) => b.sort - a.sort);
    return cards;
  }, [biomes, rankBy, sample, extraCards]);



  /* What the divine itself did over the same window the badges use. Without
     this the toggle is a black box: you see every fossil turn red and cannot
     tell whether fossils fell or the divine ran away from them. */
  const rateDrift = useMemo(() => {
    if (!rateReady) return null;
    const window = nearestRateWindow(rateHistory, chgWindow);
    return window ? { pct: window.pct, now: window.last.rate } : null;
  }, [rateHistory, rateReady, chgWindow]);

  const money = (c) => (c > 0 ? fmtPrice(c, currency, rate) : "—");
  const observedMoney = (c) => (Number.isFinite(c) && c >= 0 ? fmtPrice(c, currency, rate) : "—");
  const pricedMoney = (c, found) => (found ? observedMoney(c) : "—");
  // Node counts are whole numbers from the guide baseline but fractional once
  // a profile averages its own observations, so trailing zeros are trimmed.
  const qtyText = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)).toString() : "—");
  const chgKey = CHANGE_KEYS[chgWindow] || "change24";
  const chgOf = (name) => {
    const it = trendBy[name];
    if (!it) return undefined;
    return realHere ? it[`${chgKey}R`] : it[chgKey];
  };

  const reset = () => setSettings(sanitizeSettings(DEFAULTS));

  /* ---- fossils view: list + chart ---- */
  const fossilList = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = fossils.filter((f) => f.found || !havePrices);
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    return list.sort((a, b) => (sortDir === "desc" ? b.chaos - a.chaos : a.chaos - b.chaos));
  }, [fossils, filter, sortDir, havePrices]);

  /* Resonators share the chart but not the grid: one graph, two lists, and
     sorting or filtering one never reorders the other. */
  const resoList = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = resoItems.filter((it) => !q || it.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => (sortDir === "desc" ? b.chaosValue - a.chaosValue : a.chaosValue - b.chaosValue));
  }, [resoItems, filter, sortDir]);

  const selectable = useMemo(
    () => new Set([...fossilList.map((f) => f.name), ...resoList.map((r) => r.name)]),
    [fossilList, resoList]
  );
  const selName = (selFossil && selectable.has(selFossil)) ? selFossil : fossilList[0]?.name || resoList[0]?.name;
  const fossilChart = useMemo(() => {
    const s = hist[selName] || [];
    const cur = unitForSeries(s.map((p) => p.value), currency, rate);
    const div = cur === "divine" ? rate : 1;
    return {
      cur,
      rows: s.map((p) => ({
        day: p.day, chaos: p.value, rate: rateAt(rateHistory, p.day),
        value: Math.round((p.value / div) * 100) / 100,
      })),
    };
  }, [hist, selName, currency, rate, rateHistory]);

  /* ---- biome panel ---- */
  const openRow = openBiome ? biomes.rows.find((r) => r.biome.id === openBiome) : null;
  const openExtra = extraCards.find((card) => card.id === openBiome) || null;
  const extraChart = useMemo(() => {
    if (!openExtra) return { rows: [], cur: "chaos" };
    const base = clusterValueSeries(openExtra.node, hist, modelSettings);
    const cur = unitForSeries(base.map((p) => p.value), currency, rate);
    const div = cur === "divine" ? rate : 1;
    const overlay = focusFossil ? (hist[focusFossil] || []) : null;
    const at = (h, d) => (h.find((p) => p.day === d)
      ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]));
    return {
      cur,
      rows: base.map((p) => ({
        day: p.day, chaos: p.value, rate: rateAt(rateHistory, p.day),
        value: Math.round((p.value / div) * 100) / 100,
        overlay: overlay && overlay.length ? Math.round((at(overlay, p.day).value / div) * 100) / 100 : null,
      })),
    };
  }, [openExtra, hist, modelSettings, currency, rate, focusFossil, rateHistory]);

  /* A cluster node renders as one of the ranked cards, in the same shape as a
     biome. It has no biome share and no depth ramp of its own; what varies is
     how often you run into one. */
  const renderExtra = (card) => {
    const open = openBiome === card.id;
    const perHour = rankBy === "sample" ? card.perHour : 0;
    return (
      <article key={card.id} className={`dl-biome dl-stash${open ? " open" : ""}`} style={{ "--tone": card.tone }}>
        <button className="dl-biome-head"
          onClick={() => { setOpenBiome(open ? null : card.id); setFocusFossil(null); setDragSel(null); }}
          aria-expanded={open}>
          <span className="dl-dot" />
          <span className="dl-biome-name">{card.label}</span>
          <span className="dl-biome-val"
            title={rankBy === "opportunity"
              ? `Relative score from ${card.shareText} and ${pricedMoney(card.node.range.median, card.node.found)} a node. Not chaos per Delve.`
              : rankBy === "sample" && perHour > 0
                ? `${qtyText(perHour)} an hour at ${activeSampleName}'s observed pace, median pool outcome.`
                : card.headTitle}>
            {rankBy === "opportunity"
              ? (card.node.found ? card.node.opportunityIndex.toFixed(0) : "—")
              : rankBy === "sample"
                ? observedMoney(perHour * card.node.range.median)
                : pricedMoney(card.node.range.median, card.node.found)}
            <em>{rankBy === "opportunity" ? "/100 opportunity" : rankBy === "sample" ? "/h, median" : rankBy === "depth" ? "/node EV" : "/target"}</em>
          </span>
        </button>

        <div className="dl-share" title={card.shareTitle}>
          <i style={{ width: `${Math.min(100, card.node.share * 100)}%` }} />
          <span>{card.shareText}</span>
        </div>

        <div className="dl-excl">
          <strong>{card.lead}</strong> → {qtyText(card.node.qtyLow)}–{qtyText(card.node.qtyHigh)}× {card.poolWord}
          {card.node.found
            ? <> = <b>{observedMoney(card.node.range.low)}</b>–<b>{observedMoney(card.node.range.high)}</b> a node</>
            : <em className="dl-flag warn">no price</em>}
          <em className="dl-node-data">{card.detail}</em>
        </div>

        <div className="dl-community-range">
          <em className="dl-src ok">estimate</em>
          {qtyText(card.node.qtyLow)}–{qtyText(card.node.qtyHigh)} fossils → {pricedMoney(card.node.range.median, card.node.found)} median per node
          {card.node.poolCoverage < 1 && <em className="dl-flag warn">partial prices</em>}
        </div>
      </article>
    );
  };

  const biomeChart = useMemo(() => {
    if (!openRow) return { rows: [], cur: "chaos" };
    const base = biomeValueSeries(openRow.biome, hist, modelSettings);
    const cur = unitForSeries(base.map((p) => p.value), currency, rate);
    const div = cur === "divine" ? rate : 1;
    const overlay = focusFossil ? (hist[focusFossil] || []) : null;
    const at = (h, d) => (h.find((p) => p.day === d)
      ?? h.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), h[0]));
    return {
      cur,
      rows: base.map((p) => ({
        day: p.day, chaos: p.value, rate: rateAt(rateHistory, p.day),
        value: Math.round((p.value / div) * 100) / 100,
        overlay: overlay && overlay.length ? Math.round((at(overlay, p.day).value / div) * 100) / 100 : null,
      })),
    };
  }, [openRow, hist, modelSettings, currency, rate, focusFossil, rateHistory]);

  const updateSample = (name, fn) => {
    setSampleProfiles((profiles) => profiles.map((p) => {
      if (p.name !== name || p.builtIn) return p;
      return sanitizeSampleProfile(fn({ ...p, observations: { ...p.observations } }), p.name);
    }));
  };

  const addSampleProfile = (seed = null) => {
    const name = uniqueSampleName(sampleProfiles, seed ? `${seed.name} copy` : "My sample");
    const profile = seed && !seed.builtIn
      ? { ...sanitizeSampleProfile(seed), name }
      : { ...defaultSampleProfile(name, false), sampleDepth: settings.depth };
    setSampleProfiles((profiles) => [...profiles, profile]);
    setActiveSampleName(name);
    setEditingSample(name);
    setShowAssumptions(true);
    setShowSamples(true);
  };

  const renameSampleProfile = (from, next) => {
    const clean = next.trim();
    if (!clean) return;
    const name = uniqueSampleName(sampleProfiles.filter((p) => p.name !== from), clean);
    setSampleProfiles((profiles) => profiles.map((p) => p.name === from && !p.builtIn ? { ...p, name } : p));
    if (activeSampleName === from) setActiveSampleName(name);
    if (editingSample === from) setEditingSample(name);
  };

  const deleteSampleProfile = (name) => {
    const profile = sampleProfiles.find((p) => p.name === name);
    if (!profile || profile.builtIn) return;
    setSampleProfiles((profiles) => profiles.filter((p) => p.name !== name));
    if (activeSampleName === name) setActiveSampleName("Guide baseline");
    if (editingSample === name) setEditingSample(null);
  };

  const wallFossils = fossils.filter((f) => f.wall);
  const samplePanel = (
    <>
      <div className="dl-sample-title">
        <div>
          <h3>My Delve samples</h3>
          <p>
            Log encounters and fossil totals from one farming session. Personal observations replace guide
            quantities category by category; minutes unlock an hourly projection.
          </p>
        </div>
        <div className="dl-sample-title-actions">
          <button className="dl-sample-new" onClick={() => setShowSamples(false)}>Hide</button>
          <button className="dl-sample-new" onClick={() => addSampleProfile()}>+ New profile</button>
        </div>
      </div>

      <div className="dl-sample-grid">
        {sampleProfiles.map((profile) => {
          const metrics = sampleMetrics(profile);
          const editing = editingSample === profile.name && !profile.builtIn;
          const active = profile.name === activeSampleName;
          return (
            <article key={profile.name} className={`dl-sample-card${active ? " active" : ""}`}>
              <div className="dl-sample-card-head">
                <div>
                  {editing
                    ? <input className="dl-sample-name" defaultValue={profile.name}
                        aria-label="Sample profile name"
                        onBlur={(e) => renameSampleProfile(profile.name, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                    : <h4>{profile.name}</h4>}
                  <span>{profile.builtIn
                    ? "built-in guide quantities"
                    : metrics.hasObservations
                      ? `observed around depth ${metrics.sampleDepth}`
                      : `sample depth ${metrics.sampleDepth}`}</span>
                </div>
                <em className={`dl-src ${profile.builtIn ? "ok" : "personal"}`}>{profile.builtIn ? "guide" : "custom"}</em>
              </div>

              <div className="dl-sample-yields">
                {TUNABLES.map((field) => (
                  <span key={field.key}>
                    <small>{field.label.replace("Fossils per ", "").replace("Special fossils per ", "Special / ")}</small>
                    <strong>{metrics.quantities[field.key].toFixed(2).replace(/\.00$/, "")}</strong>
                    <em className={`dl-src ${SOURCES[metrics.quantitySources[field.key]]?.tone || ""}`}>
                      {SOURCES[metrics.quantitySources[field.key]]?.tag}
                    </em>
                  </span>
                ))}
              </div>

              <div className="dl-sample-summary">
                {metrics.hasTimedSample
                  ? <><strong>{metrics.totalEncounters}</strong> fossil encounters in <strong>{metrics.observations.minutes}</strong> minutes
                      {metrics.exclusiveShare != null && <> · <strong>{Math.round(metrics.exclusiveShare * 100)}%</strong> were exclusive nodes</>}</>
                  : "No timed encounter rate. The profile cannot produce an hourly figure yet."}
              </div>

              {editing && (
                <div className="dl-sample-editor">
                  <label className="dl-assume-row">
                    <span>Sample depth</span>
                    <NumInput value={profile.sampleDepth} step={10} min={1}
                      onCommit={(n) => updateSample(profile.name, (p) => ({ ...p, sampleDepth: n }))} />
                  </label>
                  <div className="dl-sample-fields">
                    {SAMPLE_FIELDS.map((field) => (
                      <label key={field.key} className="dl-assume-row">
                        <span>{field.label}</span>
                        <NumInput value={profile.observations[field.key]} step={field.step} min={0}
                          onCommit={(n) => updateSample(profile.name, (p) => ({
                            ...p,
                            observations: { ...p.observations, [field.key]: n },
                          }))} />
                      </label>
                    ))}
                  </div>
                  {!!metrics.warnings.length && <p className="dl-note warn">{metrics.warnings.join(" · ")}</p>}
                </div>
              )}

              <div className="dl-sample-actions">
                {!active && <button onClick={() => setActiveSampleName(profile.name)}>Use profile</button>}
                {active && <strong>Active</strong>}
                {!profile.builtIn && <button onClick={() => setEditingSample(editing ? null : profile.name)}>{editing ? "Done" : "Edit sample"}</button>}
                <button onClick={() => addSampleProfile(profile)}>Duplicate</button>
                {!profile.builtIn && editing && (
                  <button onClick={() => updateSample(profile.name, (p) => ({
                    ...defaultSampleProfile(p.name, false), sampleDepth: p.sampleDepth,
                  }))}>Clear observations</button>
                )}
                {!profile.builtIn && <button className="danger" onClick={() => deleteSampleProfile(profile.name)}>Delete</button>}
              </div>
            </article>
          );
        })}
      </div>

      <p className="dl-note">
        A timed projection assumes the encounter pace from that session continues in the selected biome.
        It is personal evidence, not a claimed global Delve spawn rate.
      </p>
    </>
  );

  return (
    <section className="dl-wrap">
      {!havePrices && (
        <SourceStrip className="app-source-strip--spaced st-banner" tone="alert">
          No price snapshot for {league} yet. Fossil and boss values need <code>fossils.json</code> or{" "}
          <code>prices.json</code>, which the data workflow writes alongside the scarab data — they appear
          after the next refresh. Biome structure, depth thresholds and drop rates are shown regardless.
        </SourceStrip>
      )}
      {havePrices && (
        <SourceStrip className="app-source-strip--spaced st-banner st-quiet dl-price-banner">
          Prices via {priceSource || "GGG Currency Exchange, poe.watch and poe.ninja"} · {league}
          {generatedAt ? ` · updated ${new Date(generatedAt).toLocaleString()}` : ""}
          {" · "}1 Divine ≈ {Math.round(rate)} Chaos
          {mirrorDivine > 0 && <> · 1 Mirror ≈ {Math.round(mirrorDivine).toLocaleString()} Divine</>}
          {fossilData === "missing" && priceMap && priceMap !== "missing" ? " · fossil trends appear after the next refresh" : ""}
          {useReal && (
            <span className="st-banner-real">
              {rateDrift && <>{" "}· divine {rateDrift.pct >= 0 ? "+" : "−"}{Math.abs(rateDrift.pct).toFixed(1)}% in {chgWindow}</>}
              {!realBadges
                ? " — no divine-adjusted figures yet. The fossil categories are new, so their history starts at zero; the first one appears about an hour after the second snapshot."
                : realWindows.has(chgWindow)
                  ? ", so every % here is divine-adjusted"
                  : ` — but not for ${chgWindow}: that needs a stored rate from ${chgWindow} ago and the history is only ${Math.round(historyHours)}h old.`}
              {realBadges && realWindows.size < 5 && (
                <> · adjusted windows so far: {[...realWindows].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).join(", ")} — the rest fill in as snapshots accumulate.</>
              )}
            </span>
          )}
        </SourceStrip>
      )}

      {/* ---------- bar ---------- */}
      <div className="dl-bar">
        <label className="dl-field">
          <span>Depth</span>
          <NumInput value={settings.depth} step={10} min={1} width={82}
            onCommit={(n) => patch({ depth: n })} title="Biome spawn weights, and which bosses exist, both key off depth" />
        </label>
        <div className="dl-presets">
          {DEPTH_PRESETS.map((preset) => (
            <button key={preset.depth} className={settings.depth === preset.depth ? "on" : ""}
              title={`Depth ${preset.depth}: ${preset.label}`}
              onClick={() => patch({ depth: preset.depth })}>
              {preset.depth}<em>{preset.label}</em>
            </button>
          ))}
        </div>
        <label className="dl-field dl-profile-field">
          <span>Sample profile</span>
          <select value={activeSampleName} onChange={(e) => setActiveSampleName(e.target.value)}>
            {sampleProfiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        <div className="dl-headline" title="The active profile supplies fossil quantities and, when timed observations exist, your personal encounter pace.">
          <strong>{activeSampleName}</strong>
          <em>{sample.hasTimedSample
            ? `${sample.totalEncounters} encounters in ${sample.observations.minutes} minutes`
            : Object.values(sample.quantitySources).includes("personal")
              ? "sample quantities · no timed encounter rate"
              : "guide quantities · no timed encounter rate"}</em>
        </div>
        <div className="dl-bar-actions">
          <button className="dl-assume-btn" onClick={() => setShowAssumptions((v) => !v)}>
            {showAssumptions ? "Hide assumptions" : "Assumptions"}
          </button>
          <button className={`dl-money-btn${showMoneyGuide ? " on" : ""}`}
            aria-expanded={showMoneyGuide} aria-controls="dl-money-guide"
            onClick={() => setShowMoneyGuide((v) => !v)}>
            How to make money <span aria-hidden="true">{showMoneyGuide ? "−" : "+"}</span>
          </button>
          <button className="dl-reset" onClick={reset}>Reset settings</button>
        </div>
      </div>

      {showMoneyGuide && (
        <section id="dl-money-guide" className="dl-money-guide">
          <header className="dl-money-head">
            <div>
              <span><em className="dl-src warn">3.28 guide</em> creator observations, not a guaranteed rate</span>
              <h3>What to path toward</h3>
              <p>
                Practical notes from Duddybrainzz's depth-5000 profit test. Live target prices still come from
                the calculator below; the historical run is context for the route, not an input to your EV.
              </p>
            </div>
            <a href={MONEY_GUIDE_VIDEO} target="_blank" rel="noreferrer">Watch the full video</a>
          </header>

          <div className="dl-money-grid">
            {MONEY_GUIDE_TIPS.map((tip) => (
              <article key={tip.title}>
                <span>{tip.label}</span>
                <h4>{tip.title}</h4>
                <p>{tip.body}</p>
                <a href={moneyGuideUrl(tip.time)} target="_blank" rel="noreferrer">
                  See it at {Math.floor(tip.time / 60)}:{String(tip.time % 60).padStart(2, "0")}
                </a>
              </article>
            ))}
          </div>

          <div className="dl-money-context">
            <div>
              <span>Depth rule</span>
              <strong>Reward scaling stopped at 1500 in the test</strong>
              <p>Past the cap, go deeper for the challenge or path sideways for efficient targets; do not expect the reward scaling itself to keep rising.</p>
            </div>
            <div>
              <span>3.28 case study - six hours, depth 4900 to 5250</span>
              <strong>12 Vaal bosses / 3 Doryani maps / 300k azurite</strong>
              <p>
                The creator reported 187 divines total, or 31 div/hour: 63d raw Delve loot, 96d from three maps,
                20d net from the minion-boot fracture and 8d from other rares. Those old prices are not reused here.
              </p>
            </div>
            <div>
              <span>Expectation</span>
              <strong>Consistent and relaxed, but depth is the investment</strong>
              <p>The creator described less reliance on lucky spikes than Breach, while noting that reaching a worthwhile depth costs time and build investment.</p>
            </div>
          </div>

          <p className="dl-money-source">
            Source: <a href={moneyGuideUrl(200)} target="_blank" rel="noreferrer">Duddybrainzz, "Deep Delve Profitability - 3.28 PoE Mirage League"</a>,
            published 23 April 2026. Sulphite setup and the optional sacrifice fragments come from the video description.
          </p>
        </section>
      )}

      {showAssumptions && (
        <div className="dl-assume">
          <div className="dl-assume-layout">
            <div className="dl-assume-values">
              <p className="dl-assume-lead">
                Biome shares and encounter tiers come from current data-mined tables. Node quantities use the
                active profile: personal averages replace the guide fallbacks one category at a time.
              </p>
              <div className="dl-assume-group">
                <h4>Active yields</h4>
                {TUNABLES.map((t) => (
                  <div key={t.key} className="dl-assume-row" title={t.help}>
                    <span>{t.label}<em className={`dl-src ${SOURCES[sample.quantitySources[t.key]]?.tone || ""}`}>
                      {SOURCES[sample.quantitySources[t.key]]?.tag}
                    </em></span>
                    <strong>{sample.quantities[t.key].toFixed(2).replace(/\.00$/, "")}</strong>
                  </div>
                ))}
                <p className="dl-assume-note">
                  <button className="dl-inline-link" onClick={() => setShowSamples(true)}>My samples</button> records
                  your own node quantities and pace. The Guide baseline invents no node frequency or hourly rate.
                </p>
              </div>
              <div className="dl-assume-group">
                <h4>Depth guidance</h4>
                <div className="dl-depth-guide">
                  <strong>{settings.depth >= COMMUNITY_DEPTH_GUIDE.specialNode.capDepth ? "Special-node cap reached" : "Special-node chance still scaling"}</strong>
                  <span>
                    Active community estimate: {pctText(specialChanceNow)} of fossil nodes are the biome's special
                    node at depth {settings.depth}; the remaining {pctText(1 - specialChanceNow)} are Smuggler's Stashes.
                    The working curve rises linearly from each node's unlock depth to
                    {" "}{Math.round(COMMUNITY_DEPTH_GUIDE.specialNode.capChance * 100)}% at depth {COMMUNITY_DEPTH_GUIDE.specialNode.capDepth},
                    so stashes fall to {Math.round((1 - COMMUNITY_DEPTH_GUIDE.specialNode.capChance) * 100)}% there.
                    Biome cards use it for Depth EV and Opportunity.
                  </span>
                </div>
                <div className="dl-depth-guide">
                  <strong>City biome share is depth-adjusted exactly</strong>
                  <span>
                    Current data-mined weights reach full strength at depth 63 for Vaal Outpost, 135 for Abyssal City
                    and 200 for Primeval Ruins. Those ramps already change the city share shown on each boss card.
                  </span>
                </div>
                <div className="dl-depth-guide">
                  <strong>{settings.depth >= COMMUNITY_DEPTH_GUIDE.bossInCity.capDepth ? "Guide boss-cap depth reached" : "Boss encounter chance still scaling"}</strong>
                  <span>
                    Active community estimate: {bossChanceLow === bossChanceHigh ? pctText(bossChanceHigh) : `${pctText(bossChanceLow)}–${pctText(bossChanceHigh)}`}
                    {" "}per eligible city node at depth {settings.depth}. The working curve rises linearly from each
                    boss's minimum depth to {Math.round(COMMUNITY_DEPTH_GUIDE.bossInCity.capChance * 100)}% at depth {COMMUNITY_DEPTH_GUIDE.bossInCity.capDepth}.
                    Boss cards show the resulting boss-value component per city node.
                  </span>
                </div>
              </div>
              <div className="dl-assume-group">
                <h4>Fractured walls</h4>
                <label className="st-check">
                  <input type="checkbox" checked={settings.openWalls !== false}
                    onChange={(e) => patch({ openWalls: e.target.checked })} />
                  <span>Count wall-locked fossils in biome pools</span>
                </label>
                <p className="dl-assume-note">
                  Wall-locking is per biome, not per fossil: Fundamental sits behind a wall in Magma Fissure
                  but lies loose in Sulphur Vents, so turning this off removes it from Magma's pool only. It
                  never changes the exclusive fossil target, and it never changes a Smuggler's Stash — anything
                  a wall can hand you belongs to the Fractured Walls pool instead, whichever way this is set.
                </p>
              </div>
            </div>
            <section className={`dl-assume-samples${showSamples ? " open" : ""}`}>
              {showSamples ? samplePanel : (
                <button className="dl-samples-open" onClick={() => setShowSamples(true)}>
                  <span>My samples</span>
                  <strong>{sampleProfiles.length - 1} custom profile{sampleProfiles.length === 2 ? "" : "s"}</strong>
                  <em>Open the observation tracker</em>
                </button>
              )}
            </section>
          </div>
          <div className="dl-source-grid">
            <a href="https://poedb.tw/us/DelveBiomes" target="_blank" rel="noreferrer">
              <em className="dl-src ok">data</em><strong>PoEDB</strong><span>biome shares, tiers, weights and minimum depths</span>
            </a>
            <a href="https://www.pathofexile.com/forum/view-thread/3913392" target="_blank" rel="noreferrer">
              <em className="dl-src ok">official</em><strong>GGG 3.28</strong><span>more fossils off-path and behind fractured walls</span>
            </a>
            <a href="https://youtu.be/2gS1FE-nQJ8" target="_blank" rel="noreferrer">
              <em className="dl-src ok">guide</em><strong>Jorgen 3.28</strong><span>target quantities, routes and current method</span>
            </a>
            <a href="https://youtu.be/nC_En939Ing?t=2853" target="_blank" rel="noreferrer">
              <em className="dl-src ok">guide</em><strong>Conner Converse</strong><span>deep reward behaviour and the 1500 cap observation</span>
            </a>
          </div>
        </div>
      )}

      {/* The tab used to quote biomes "per delve", which multiplied every
          figure by a node frequency nobody publishes and I had guessed 3x
          too high. The unit is one NODE now: price x count, both checkable.
          Said out loud, because a unit you have to infer is the bug. */}
      <p className="dl-define">
        <strong>Depth EV</strong> estimates one fossil node at the selected depth — the biome's special node, or a Smuggler's Stash. <strong>Target value</strong> prices
        the exclusive fossil encounter by itself, while <strong>Opportunity</strong> combines biome share with Depth EV. Absolute hourly profit only appears as
        <strong> your observed pace</strong> after a custom sample contains timed observations.
      </p>

      <div className="dl-views">
        {VIEWS.map(([k, label]) => (
          <button key={k} className={view === k ? "on" : ""}
            onClick={() => {
              setView(k);
              if (k === "biomes") setRankBy("depth");
              setDragSel(null);
            }}>{label}</button>
        ))}
      </div>

      {/* ================= FOSSILS ================= */}
      {view === "fossils" && (
        <>
          <div className="st-tools">
            <div className="app-control st-ctl">
              <span>Sort by price</span>
              <div className="app-segmented st-seg">
                <button className={sortDir === "desc" ? "on" : ""} onClick={() => setSortDir("desc")}>High → Low</button>
                <button className={sortDir === "asc" ? "on" : ""} onClick={() => setSortDir("asc")}>Low → High</button>
              </div>
            </div>
            <div className="app-control st-ctl">
              <span>Price change</span>
              <div className="app-segmented st-seg">
                {CHANGE_WINDOW_OPTIONS.map((w) => {
                  const noReal = useReal && realBadges && !realWindows.has(w);
                  return (
                    <button key={w} className={`${chgWindow === w ? "on" : ""}${noReal ? " dim" : ""}`}
                      title={noReal
                        ? `No divine-adjusted figure for ${w} yet — that needs a stored rate from ${w} ago and the fossil history is ${Math.round(historyHours)}h old.`
                        : undefined}
                      onClick={() => setChgWindow(w)}>{w}</button>
                  );
                })}
              </div>
            </div>
            <div className="app-control st-ctl st-checks">
              <span>Divine drift</span>
              <div className="st-checks-row">
                <label className={`st-check ${rateReady ? "" : "st-check-off"}`}
                  title={rateReady
                    ? "Price everything in divine instead of chaos: a fossil only counts as up if it beat the divine rate."
                    : "Needs at least two snapshots with a stored divine rate — it builds up over the next few data refreshes."}>
                  <input type="checkbox" checked={useReal} disabled={!rateReady}
                    onChange={(e) => setRealMode(e.target.checked)} />
                  <span>Divine-adjusted</span>
                </label>
              </div>
            </div>
            <label className="app-control st-ctl">
              <span>Filter</span>
              <input className="st-tool-filter" type="text" placeholder="Filter fossils & resonators"
                value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>

          <section className="st-cat-wrap">
            <PriceChart
              rows={fossilChart.rows}
              cur={fossilChart.cur}
              height={fossilChart.rows.length > 1 ? 220 : 64}
              axisLabel={axisLabel}
              label={selName ? <>Price history: <em>{selName}</em></> : "Select a fossil"}
              seriesName={selName}
              dragSel={dragSel} setDragSel={setDragSel}
              realMode={realMode} rateReady={rateReady}
            />
            <div className="st-cat-grid">
              {fossilList.map((f) => (
                <button key={f.name}
                  className={`st-row ${selName === f.name ? "focused" : ""}`}
                  onClick={() => { setSelFossil(f.name); setDragSel(null); }}
                  title={f.exclusive ? `${f.exclusive.node} · ${BIOME_NAME[f.exclusive.biome]}` : f.biomes.map((b) => BIOME_NAME[b]).join(", ")}>
                  <span className="st-row-name">
                    <FossilIcon tone={BIOME_TONE[f.biomes[0]] || "#c9a24b"} exclusive={!!f.exclusive} />
                    {f.name}
                    {f.exclusive && <em className="dl-flag">node</em>}
                    {f.wall && <em className="dl-flag" title="Behind a fractured wall">wall</em>}
                  </span>
                  <span className="st-row-price"><PctBadge v={chgOf(f.name)} real={realHere} /> {money(f.chaos)}</span>
                </button>
              ))}
              {!fossilList.length && <div className="st-cat-note">No fossil matches that filter.</div>}
            </div>

            <div className="dl-sub-head">
              Resonators
              <em>same graph, own list — sorting these never reorders the fossils</em>
            </div>
            {resoList.length ? (
              <div className="st-cat-grid">
                {resoList.map((it) => {
                  const tier = RESONATOR_ORDER.find((t) => it.name.startsWith(t));
                  return (
                    <button key={it.name}
                      className={`st-row ${selName === it.name ? "focused" : ""}`}
                      onClick={() => { setSelFossil(it.name); setDragSel(null); }}
                      title="Show price history">
                      <span className="st-row-name">
                        <ResonatorIcon sockets={tier ? RESONATOR_SOCKETS[tier] : 1} />
                        {it.name.replace(/ Resonator$/, "")}
                        {tier && <em className="dl-flag" title={`${RESONATOR_SOCKETS[tier]} sockets`}>{RESONATOR_SOCKETS[tier]}s</em>}
                      </span>
                      <span className="st-row-price"><PctBadge v={chgOf(it.name)} real={realHere} /> {money(it.chaosValue)}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="st-cat-note">
                {resoItems.length
                  ? "No resonator matches that filter."
                  : <>No resonator snapshot yet — <code>resonators.json</code> appears after the next data refresh.</>}
              </div>
            )}
          </section>

          <h4 className="dl-h">Node value scenarios</h4>
          <p className="dl-note">
            Exclusive targets use the active profile's observed or guide quantity. A stash shows the cheapest,
            median and dearest <em>priced</em> pool outcomes because its fossil distribution is not published;
            an equal-weight average would be false precision. Missing-price coverage is shown beside each row.
          </p>
          <div className="dl-table-wrap">
            <table className="dl-table">
              <thead><tr><th>Node</th><th>Biome</th><th className="r">Low</th><th className="r">Median</th><th className="r">High</th></tr></thead>
              <tbody>
                {NODES.filter((n) => n.kind === "exclusive").map((n) => {
                  const row = biomes.rows.find((r) => r.biome.id === n.biome);
                  return (
                    <tr key={n.id}>
                      <td>{n.name}<em className="dl-flag">{n.fossil.replace(/ Fossil$/, "")}</em></td>
                      <td>{BIOME_NAME[n.biome]}</td>
                      <td className="r num" colSpan={3}>{pricedMoney(row?.exclusive?.nodeValue, row?.exclusive?.found)}</td>
                    </tr>
                  );
                })}
                {/* One row, not one per biome: a fossil node is either the
                    biome's special node or a stash, and the stash pool is
                    mine-wide rather than the biome you happen to stand in. */}
                <tr className="dl-sep"><td colSpan={5}>Smuggler's Stash, one pool for the whole mine</td></tr>
                <tr>
                  <td>Smuggler's Stash<em className="dl-flag">{biomes.stash.qtyLow}–{biomes.stash.qtyHigh}× pool</em></td>
                  <td>
                    Any biome
                    {biomes.stash.poolCoverage < 1 && (
                      <em className="dl-flag warn">
                        {biomes.stash.poolPrices.filter((p) => p.found).length}/{biomes.stash.poolNames.length} priced
                      </em>
                    )}
                  </td>
                  <td className="r num">{pricedMoney(biomes.stash.range.low, biomes.stash.found)}</td>
                  <td className="r num">{pricedMoney(biomes.stash.range.median, biomes.stash.found)}</td>
                  <td className="r num">{pricedMoney(biomes.stash.range.high, biomes.stash.found)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <section className="dl-wall-card">
            <div>
              <span className="ov-kind">3.28 route change</span>
              <h4>Darkness and fractured walls matter more</h4>
              <p>
                GGG greatly increased fossil frequency behind fractured walls and off the main path. The game
                still exposes no route-length rate, so these stay as live per-drop targets rather than a made-up
                amount per Delve.
              </p>
            </div>
            <div className="dl-wall-values">
              {wallFossils.map((f) => (
                <span key={f.name}><strong>{f.name}</strong><b>{money(f.chaos)}</b><em>{f.biomes.map((id) => BIOME_NAME[id]).join(" · ")}</em></span>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ================= BIOMES ================= */}
      {view === "biomes" && (
        <>
          <div className="dl-subbar">
            <div className="app-segmented st-seg">
              <button className={rankBy === "depth" ? "on" : ""} onClick={() => setRankBy("depth")}
                title="Community-estimated value of one fossil node at this depth: the biome's special node, or a Smuggler's Stash">Depth EV</button>
              <button className={rankBy === "target" ? "on" : ""} onClick={() => setRankBy("target")}
                title="Live value of one exclusive fossil encounter">Target value</button>
              <button className={rankBy === "opportunity" ? "on" : ""} onClick={() => setRankBy("opportunity")}
                title="Relative score from biome share and community depth-adjusted node value">Opportunity</button>
              <button className={rankBy === "sample" ? "on" : ""} disabled={!sample.hasTimedSample}
                onClick={() => sample.hasTimedSample && setRankBy("sample")}
                title={sample.hasTimedSample ? "Low/median/high projection at your observed encounter pace" : "Add timed observations in My samples first"}>
                My pace
              </button>
            </div>
            {biomes.anyInterpolated && (
              <span className="dl-hint">
                Depth {settings.depth} sits inside at least one biome's weight ramp. The documented endpoints
                do not include the non-linear middle curve, so those shares are eased between the two and are approximate.
              </span>
            )}
          </div>

          <div className={`dl-mode-summary${rankBy === "depth" ? " estimate" : ""}`}>
            {rankBy === "depth" && (
              <>
                <span className="dl-mode-kicker"><em className="dl-src warn">community estimate</em> active depth {settings.depth}</span>
                <strong>Expected value of one fossil node</strong>
                <p>Each biome blends its live special-target value with the Smuggler's Stash pool using that biome's estimated special-node chance. This is the practical value to compare when choosing a fossil route.</p>
              </>
            )}
            {rankBy === "target" && (
              <>
                <span className="dl-mode-kicker">live target price</span>
                <strong>Value of one exclusive fossil encounter</strong>
                <p>The active profile supplies the fossil quantity. No spawn frequency is included.</p>
              </>
            )}
            {rankBy === "opportunity" && (
              <>
                <span className="dl-mode-kicker">relative route score</span>
                <strong>Biome share × community Depth EV</strong>
                <p>Normalised so today's leader is 100. This is not chaos per Delve.</p>
              </>
            )}
            {rankBy === "sample" && (
              <>
                <span className="dl-mode-kicker">personal projection</span>
                <strong>{activeSampleName}'s observed encounter pace</strong>
                <p>Low–high priced-pool outcomes from your timed sample, not a global rate.</p>
              </>
            )}
          </div>

          {!activeSampleProfile.builtIn && sample.sampleDepth !== settings.depth && (
            <div className="st-banner st-quiet">
              {activeSampleName} was recorded at depth {sample.sampleDepth}; you are viewing depth {settings.depth}.
              Quantities remain useful, but encounter pace may not transfer between depths.
            </div>
          )}

          {/* expanded biome — same shape as the mechanic panel on Scarabs */}
          {openRow && (
            <section className="st-panel">
              <div className="st-panel-head">
                <div className="st-panel-title">
                  <FossilIcon size={26} tone={openRow.biome.tone} exclusive />
                  <h2>{openRow.biome.name}</h2>
                  <span className="st-panel-total" title={`One ${openRow.headlineLabel} at the active profile's quantity.`}>
                    {pricedMoney(openRow.headline, openRow.exclusive?.found)} · {openRow.headlineLabel}
                  </span>
                  <span className="st-panel-total" title="Community depth-adjusted median value of one fossil node">
                    {pricedMoney(openRow.depthAdjustedRange.median, openRow.depthAdjustedFound)} · depth EV
                  </span>
                  <span className="st-panel-total">{pctText(openRow.share)} of the mine</span>
                  <span className="st-panel-total">
                    {openRow.depthAdjustedFound ? openRow.opportunityIndex.toFixed(0) : "—"}/100 opportunity
                  </span>
                </div>
                <button className="st-close" onClick={() => { setOpenBiome(null); setFocusFossil(null); setDragSel(null); }}>Close</button>
              </div>

              <div className="st-panel-body">
                <div>
                  <PriceChart
                    rows={biomeChart.rows}
                    cur={biomeChart.cur}
                    height={biomeChart.rows.length > 1 ? 260 : 64}
                    axisLabel={axisLabel}
                    label={focusFossil ? <><>{openRow.headlineLabel}</> <em>and</em> {focusFossil}</> : `${openRow.headlineLabel} across the league`}
                    seriesName={openRow.headlineLabel}
                    overlayName={focusFossil}
                    overlayTone={openRow.biome.tone}
                    dragSel={dragSel} setDragSel={setDragSel}
                    empty="History builds up with each data refresh — check back after a couple of runs."
                  />
                  <div className="dl-panel-detail">
                    {openRow.exclusive && (
                      <p className="dl-excl">
                        <strong>{openRow.exclusive.node}</strong> → {qtyText(sample.quantities.exclusiveQty)}× {openRow.exclusive.fossil}
                        <em className={`dl-src ${SOURCES[sample.quantitySources.exclusiveQty]?.tone || ""}`}>
                          {SOURCES[sample.quantitySources.exclusiveQty]?.tag}
                        </em>
                        {openRow.exclusive.found
                          ? <> @ {money(openRow.exclusive.chaos)} = <b>{observedMoney(openRow.exclusive.nodeValue)}</b> a node</>
                          : <em className="dl-flag warn">no price</em>}
                      </p>
                    )}
                    <h5>What each node here pays</h5>
                    <table className="dl-parts">
                      <tbody>
                        {openRow.exclusive && (
                          <tr className="dl-parts-total">
                            <td>{openRow.exclusive.node} <em className="dl-implied">{qtyText(sample.quantities.exclusiveQty)}× {openRow.exclusive.fossil.replace(/ Fossil$/, "")}</em></td>
                            <td>{pricedMoney(openRow.exclusive.nodeValue, openRow.exclusive.found)}</td>
                          </tr>
                        )}
                        {openRow.exclusive && (
                          <tr className="dl-parts-total">
                            <td>Community Depth EV <em className="dl-implied">{pctText(openRow.specialChance)} chance of {openRow.exclusive?.node} in the {openRow.biome.name} biome, the other {pctText(1 - openRow.specialChance)} a Smuggler's Stash</em></td>
                            <td>{pricedMoney(openRow.depthAdjustedRange.low, openRow.depthAdjustedFound)}–{pricedMoney(openRow.depthAdjustedRange.high, openRow.depthAdjustedFound)} <em className="dl-implied">median {pricedMoney(openRow.depthAdjustedRange.median, openRow.depthAdjustedFound)}</em></td>
                          </tr>
                        )}
                        {openRow.exclusive?.found && openRow.personalRange && (
                          <tr className="dl-parts-total">
                            <td>At your observed pace <em className="dl-implied">all fossil encounter types</em></td>
                            <td>{observedMoney(openRow.personalRange.low)}–{observedMoney(openRow.personalRange.high)}/h</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {!!openRow.biome.themed.length && (
                      <>
                        <h5>Other nodes here</h5>
                        <p className="dl-note">{openRow.biome.themed.join(" · ")}</p>
                      </>
                    )}
                    <p className="dl-note">
                      Tier {openRow.exclusive?.tier}, encounter weight {openRow.exclusive?.weight}, minimum depth {openRow.exclusive?.minDepth}. Spawn weight {openRow.biome.weight.lo.weight} at depth ≤{openRow.biome.weight.lo.depth},{" "}
                      {openRow.biome.weight.hi.weight} at depth ≥{openRow.biome.weight.hi.depth}.
                      {openRow.biome.note ? ` ${openRow.biome.note}` : ""}
                    </p>
                  </div>
                </div>

                <div className="st-breakdown">
                  <div className="st-breakdown-scroll">
                    <div className="st-breakdown-head"><span>Fossil</span><span>Price</span></div>
                    {openRow.exclusive && (
                      <button className={`st-row ${focusFossil === openRow.exclusive.fossil ? "focused" : ""}`}
                        onClick={() => setFocusFossil(focusFossil === openRow.exclusive.fossil ? null : openRow.exclusive.fossil)}
                        title="Show this fossil on the chart">
                        <span className="st-row-name">
                          <FossilIcon size={18} tone={openRow.biome.tone} exclusive />
                          {openRow.exclusive.fossil}<em className="dl-flag">node</em>
                        </span>
                        <span className="st-row-price"><PctBadge v={chgOf(openRow.exclusive.fossil)} real={realHere} /> {money(openRow.exclusive.chaos)}</span>
                      </button>
                    )}
                    {/* The named node drops its own fossil and nothing else. The
                        biome's wider fossil list belongs to the stash and wall
                        pools, which have their own cards. */}
                    <div className="st-breakdown-hint">
                      {openRow.exclusive?.node} drops this fossil and no other · tap it to overlay it on the graph.
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {openExtra && (
            <section className="st-panel">
              <div className="st-panel-head">
                <div className="st-panel-title">
                  <FossilIcon size={26} tone={openExtra.tone} />
                  <h2>{openExtra.label}</h2>
                  <span className="st-panel-total" title="Mean cluster at the median priced pool outcome.">
                    {pricedMoney(openExtra.node.range.median, openExtra.node.found)} · median node
                  </span>
                  <span className="st-panel-total" title={openExtra.shareTitle}>{openExtra.shareText}</span>
                  <span className="st-panel-total">
                    {openExtra.node.found ? openExtra.node.opportunityIndex.toFixed(0) : "—"}/100 opportunity
                  </span>
                </div>
                <button className="st-close" onClick={() => { setOpenBiome(null); setFocusFossil(null); setDragSel(null); }}>Close</button>
              </div>

              <div className="st-panel-body">
                <div>
                  <PriceChart
                    rows={extraChart.rows}
                    cur={extraChart.cur}
                    height={extraChart.rows.length > 1 ? 260 : 64}
                    axisLabel={axisLabel}
                    label={focusFossil ? <><>{openExtra.label}</> <em>and</em> {focusFossil}</> : `${openExtra.label} across the league`}
                    seriesName={openExtra.label}
                    overlayName={focusFossil}
                    overlayTone={openExtra.tone}
                    dragSel={dragSel} setDragSel={setDragSel}
                    empty="History builds up with each data refresh — check back after a couple of runs."
                  />
                  <div className="dl-panel-detail">
                    <p className="dl-excl">
                      <strong>{openExtra.lead}</strong> → {qtyText(openExtra.node.qtyLow)}–{qtyText(openExtra.node.qtyHigh)}× {openExtra.poolWord}
                      <em className={`dl-src ${SOURCES.observed.tone}`}>{SOURCES.observed.tag}</em>
                      {openExtra.node.found
                        ? <> = <b>{observedMoney(openExtra.node.range.low)}</b>–<b>{observedMoney(openExtra.node.range.high)}</b> a node</>
                        : <em className="dl-flag warn">no price</em>}
                    </p>
                    <h5>What one pays</h5>
                    <table className="dl-parts">
                      <tbody>
                        <tr>
                          <td>Cheapest cluster <em className="dl-implied">{qtyText(openExtra.node.qtyLow)}× the cheapest priced fossil</em></td>
                          <td>{pricedMoney(openExtra.node.range.low, openExtra.node.found)}</td>
                        </tr>
                        <tr>
                          <td>Dearest cluster <em className="dl-implied">{qtyText(openExtra.node.qtyHigh)}× the dearest priced fossil</em></td>
                          <td>{pricedMoney(openExtra.node.range.high, openExtra.node.found)}</td>
                        </tr>
                        <tr className="dl-parts-total">
                          <td>Median scenario <em className="dl-implied">mean cluster at the median fossil</em></td>
                          <td>{pricedMoney(openExtra.node.range.median, openExtra.node.found)}</td>
                        </tr>
                        {openExtra.perHour > 0 && (
                          <tr className="dl-parts-total">
                            <td>At your observed pace <em className="dl-implied">{qtyText(openExtra.perHour)} an hour</em></td>
                            <td>{observedMoney(openExtra.perHour * openExtra.node.range.low)}–{observedMoney(openExtra.perHour * openExtra.node.range.high)}/h</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <p className="dl-note">
                      {openExtra.panelNote} No published odds between them, so the range is the cheapest and
                      dearest priced outcome, not an average.
                      {openExtra.node.poolCoverage < 1 && ` ${Math.round((1 - openExtra.node.poolCoverage) * 100)}% of the pool has no price, so the range only covers priced fossils.`}
                    </p>
                  </div>
                </div>

                <div className="st-breakdown">
                  <div className="st-breakdown-scroll">
                    <div className="st-breakdown-head"><span>Fossil</span><span>Price</span></div>
                    {openExtra.node.poolPrices.map((p) => (
                      <button key={p.name} className={`st-row ${focusFossil === p.name ? "focused" : ""}`}
                        onClick={() => setFocusFossil(focusFossil === p.name ? null : p.name)}
                        title="Show this fossil on the chart">
                        <span className="st-row-name">
                          <FossilIcon size={18} tone={openExtra.tone} />
                          {p.name}
                        </span>
                        <span className="st-row-price"><PctBadge v={chgOf(p.name)} real={realHere} /> {money(p.chaos)}</span>
                      </button>
                    ))}
                    <div className="st-breakdown-hint">
                      Priced-pool range {pricedMoney(openExtra.node.poolRange.low, openExtra.node.poolCoverage > 0)}–{pricedMoney(openExtra.node.poolRange.high, openExtra.node.poolCoverage > 0)} · median {pricedMoney(openExtra.node.poolRange.median, openExtra.node.poolCoverage > 0)} · one node rolls {qtyText(openExtra.node.qtyLow)}–{qtyText(openExtra.node.qtyHigh)} of these · tap a fossil to overlay it.
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="dl-biomes">
            {ranked.map((card) => {
              if (card.kind === "extra") return renderExtra(card.card);
              const r = card.row;
              const b = r.biome;
              const dead = !r.exclusive?.available;
              const headline = rankBy === "sample"
                ? r.personalRange?.median || 0
                : rankBy === "target"
                  ? r.headline
                  : rankBy === "depth"
                    ? r.depthAdjustedRange.median
                  : r.opportunityIndex;
              return (
                <article key={card.key} className={`dl-biome${dead ? " dead" : ""}${openBiome === b.id ? " open" : ""}`} style={{ "--tone": b.tone }}>
                  <button className="dl-biome-head"
                    onClick={() => { setOpenBiome(openBiome === b.id ? null : b.id); setFocusFossil(null); setDragSel(null); }}
                    aria-expanded={openBiome === b.id}>
                    <span className="dl-dot" />
                    <span className="dl-biome-name">
                      {b.name}
                      {dead && <em className="dl-flag warn">not at this depth</em>}
                    </span>
                    <span className="dl-biome-val"
                      title={rankBy === "opportunity"
                        ? `Relative score from ${pctText(r.share)} biome share and ${pricedMoney(r.depthAdjustedRange.median, r.depthAdjustedFound)} community Depth EV. Not currency per Delve.`
                        : rankBy === "sample"
                          ? `Median pool scenario at ${activeSampleName}'s observed encounter pace.`
                          : rankBy === "depth"
                            ? `${pctText(r.specialChance)} special-node estimate; otherwise a Smuggler's Stash.`
                          : `One ${r.headlineLabel}; no encounter frequency included.`}>
                      {rankBy === "opportunity"
                        ? (r.depthAdjustedFound ? headline.toFixed(0) : "—")
                        : rankBy === "sample"
                          ? observedMoney(headline)
                          : rankBy === "depth"
                            ? pricedMoney(headline, r.depthAdjustedFound)
                          : pricedMoney(headline, r.exclusive?.found)}
                      <em>{rankBy === "opportunity" ? "/100 opportunity" : rankBy === "sample" ? "/h, median" : rankBy === "depth" ? "/node EV" : "/target"}</em>
                    </span>
                  </button>

                  <div className="dl-share" title={`Spawn weight ${Math.round(r.weight)} — ${pctText(r.share)} of the mine at depth ${settings.depth}`}>
                    {!dead && <i style={{ width: `${Math.min(100, r.share * 100 * 3)}%` }} />}
                    <span>
                      {dead
                        ? `Target unavailable at depth ${settings.depth}`
                        : `${pctText(r.share)} of the mine${!r.exact ? " (approx)" : ""}`}
                    </span>
                  </div>

                  {r.exclusive && (
                    <div className="dl-excl">
                      <strong>{r.exclusive.node}</strong> → {qtyText(sample.quantities.exclusiveQty)}× {r.exclusive.fossil}
                      {r.exclusive.found
                        ? <> @ {money(r.exclusive.chaos)} = <b>{observedMoney(r.exclusive.nodeValue)}</b> a node</>
                        : <em className="dl-flag warn">no price</em>}
                      <em className="dl-node-data">tier {r.exclusive.tier} · weight {r.exclusive.weight} · depth {r.exclusive.minDepth}+</em>
                    </div>
                  )}
                  {r.exclusive && (
                    <div className="dl-community-range">
                      <em className="dl-src ok">estimate</em>
                      {pctText(r.specialChance)} special → {pricedMoney(r.depthAdjustedRange.median, r.depthAdjustedFound)} median per fossil node
                      {biomes.stash.poolCoverage < 1 && <em className="dl-flag warn">partial prices</em>}
                    </div>
                  )}
                  {r.exclusive?.found && r.personalRange && (
                    <div className="dl-personal-range">
                      My pace: {observedMoney(r.personalRange.low)}–{observedMoney(r.personalRange.high)}/h
                      {biomes.stash.poolCoverage < 1 && <em className="dl-flag warn">partial prices</em>}
                    </div>
                  )}
                </article>
              );
            })}

          </div>
        </>
      )}

      {/* ================= BOSSES ================= */}
      {view === "bosses" && (
        <>
          {/* Routing advice, not a calculation — a boss node with no road to it
             is not unreachable, and the tell is cheap to check. */}
          <p className="dl-fyi">
            <em className="dl-src">fyi</em>
            <span>
              <strong>Boss with no road attached?</strong> Watch out for nodes around the boss that have only
              2 or 3 connected roads. Those are the only ones that can hide a fractured wall that would unlock
              the path to the boss.
            </span>
          </p>
          <section className="dl-boss-estimate">
            <header>
              <span>
                <em className="dl-src warn">community estimate</em> current depth {settings.depth}
                {generatedAt ? ` · prices updated ${new Date(generatedAt).toLocaleString()}` : ""}
              </span>
              <h3>Expected boss loot when a city node appears</h3>
              <p>
                This is the useful city decision: boss encounter chance × current boss drop-table EV. It is a
                long-run boss-only average for an eligible visible city node, not a guaranteed payout. Normal city rewards are not included.
              </p>
            </header>
            <div className="dl-boss-estimate-grid">
              {bosses.map((b) => (
                <article key={`city-${b.delve.id}`}>
                  <span>{b.biome.name}</span>
                  <strong>{b.available ? money(b.bossComponentPerCityNode) : "Unavailable"}</strong>
                  <em>{b.available
                    ? `${pctText(b.encounterChance)} boss chance · ${b.delve.name}`
                    : `${b.delve.name} unlocks at depth ${b.delve.minDepth}`}</em>
                </article>
              ))}
            </div>
          </section>
          <p className="dl-lead">
            The cards below separate a typical single kill from the rare-drop-inflated mean and expose every editable drop rate.
          </p>
          <div className="dl-bosses">
            {bosses.map((b) => {
              const d = dists[b.delve.id];
              const open = openBoss === b.delve.id;
              const top = Math.max(d.p90, d.mean, 1);
              return (
                <article key={b.delve.id} className={`dl-boss${open ? " open" : ""}`}>
                  <button className="dl-boss-head" onClick={() => {
                    setOpenBoss(open ? null : b.delve.id);
                    setOpenBossDrop(null);
                  }} aria-expanded={open}>
                    <span className="dl-boss-name">
                      {b.delve.name}
                      {!b.available && <em className="dl-flag warn">needs depth {b.delve.minDepth}</em>}
                    </span>
                    <span className="dl-boss-val"
                      title={generatedAt ? `Recalculated from the ${new Date(generatedAt).toLocaleString()} price snapshot` : "Recalculated from the active price snapshot"}>
                      <span><b>{money(d.median)}</b><em>current median</em></span>
                      <small>{money(b.gross)} expected / kill</small>
                    </span>
                  </button>
                  <div className="dl-boss-meta">
                    {b.biome.name} · {b.delve.node} · depth {b.delve.minDepth}+
                    {" · "}{pctText(b.share)} of the mine is this city biome at depth {settings.depth}
                  </div>
                  <div className="dl-community-boss">
                    <span><em className="dl-src warn">community estimate</em> {pctText(b.encounterChance)} boss chance when this eligible city node appears</span>
                    <strong>{b.available ? `${money(b.bossComponentPerCityNode)} expected boss loot` : "unavailable at this depth"}</strong>
                  </div>

                  <div className="dl-spread" title="10th to 90th percentile of one kill, with the median marked and the mean as a line">
                    <i className="band" style={{ left: `${(d.p10 / top) * 100}%`, width: `${((d.p90 - d.p10) / top) * 100}%` }} />
                    <i className="med" style={{ left: `${(d.median / top) * 100}%` }} />
                    <i className="mean" style={{ left: `${(d.mean / top) * 100}%` }} />
                  </div>
                  <div className="dl-spread-key">
                    <span>p10 {d.p10 > 0 ? money(d.p10) : "nothing"}</span>
                    <span className="med">median {money(d.median)}</span>
                    <span>p90 {money(d.p90)}</span>
                    <span className="mean">mean {money(d.mean)}</span>
                  </div>
                  {d.mean > d.median * 1.35 && (
                    <p className="dl-note warn">
                      The mean is {Math.round((d.mean / Math.max(d.median, 0.01) - 1) * 100)}% above the median —
                      it is carried by the rare line. Half your kills come in under {money(d.median)}
                      {d.blank > 0.02 && `, and ${Math.round(d.blank * 100)}% drop nothing off this table at all`}.
                    </p>
                  )}

                  {open && (
                    <div className="dl-boss-body">
                      <table className="dl-table">
                        <thead><tr><th>Drop</th><th className="r">Chance</th><th className="r">Price</th><th className="r">EV</th></tr></thead>
                        <tbody>
                          {b.dropLines.map((l) => {
                            const src = b.delve.groups.flatMap((group) => group.drops)
                              .find((x) => (x.key || x.item) === l.key) || {};
                            const variants = l.priceEntry?.components || [];
                            const breakdownKey = `${b.delve.id}:${l.key}`;
                            const breakdownOpen = variants.length > 0 && openBossDrop === breakdownKey;
                            return (
                              <Fragment key={l.key}>
                              <tr className={l.found ? "" : "unpriced"}>
                                <td>
                                  {variants.length ? (
                                    <button className="dl-drop-toggle"
                                      onClick={() => setOpenBossDrop(breakdownOpen ? null : breakdownKey)}
                                      aria-expanded={breakdownOpen}>
                                      <span className="dl-drop-chevron" aria-hidden="true">{breakdownOpen ? "▾" : "▸"}</span>
                                      <span>
                                        {l.label}
                                        <em className="dl-variant-count">{variants.length} variants</em>
                                        <small>{fmtChaos(l.unit)}c average</small>
                                      </span>
                                    </button>
                                  ) : l.label}
                                  {src.unrated && (
                                    <em className="dl-flag warn" title={src.estimateNote || "No published rate; using an editable 3% default."}>
                                      3% default
                                    </em>
                                  )}
                                  {src.preliminary && <em className="dl-flag" title={src.preliminaryNote || "Preliminary estimate"}>prelim</em>}
                                  {l.variantUnavailable && (
                                    <em className="dl-flag" title="The live aggregate feeds do not split this socket variant, so this line uses the shared name-wide market quote.">
                                      shared quote
                                    </em>
                                  )}
                                  {l.identifiedFallback && (
                                    <em className="dl-flag warn" title="No unidentified listing is available from the automated feeds, so this is the identified-item floor.">
                                      identified floor
                                    </em>
                                  )}
                                  {l.unidQuote && <em className="dl-flag" title="Priced on the unidentified market — the item as this boss hands it over, not an identified copy.">Unid</em>}
                                  {sourceNote(l.priceEntry) && (
                                    <em className="dl-flag" title={sourceNote(l.priceEntry)}>poe.watch</em>
                                  )}
                                  {l.fallback && (
                                    <em className={`dl-flag ${l.fallbackAge != null && l.fallbackAge >= 30 ? "warn" : ""}`}
                                      title={`The automated feeds do not list this exact market. This price was checked manually${l.fallbackAge != null ? ` ${l.fallbackAge} day${l.fallbackAge === 1 ? "" : "s"} ago` : ""}.`}>
                                      set{l.fallbackAge != null && l.fallbackAge >= 30 ? ` ${l.fallbackAge}d` : ""}
                                    </em>
                                  )}
                                </td>
                                <td className="r">
                                  <NumInput value={Math.round(l.rate * 1000) / 10} step={1} width={54} suffix="%"
                                    onCommit={(n) => setSettings((s) => sanitizeSettings({
                                      ...s,
                                      bosses: {
                                        ...(s.bosses || {}),
                                        [b.delve.id]: {
                                          ...((s.bosses || {})[b.delve.id] || {}),
                                          drops: {
                                            ...(((s.bosses || {})[b.delve.id] || {}).drops || {}),
                                            [l.key]: { [l.kind === "pool" ? "share" : "chance"]: n / 100 },
                                          },
                                        },
                                      },
                                    }))} />
                                </td>
                                <td className="r">
                                  <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden}
                                    entry={l.priceEntry} onSet={setPriceOverride} money={money} />
                                </td>
                                <td className="r num ev">{l.found ? money(l.value) : "—"}</td>
                              </tr>
                              {breakdownOpen && (
                                <tr className="dl-variant-row">
                                  <td colSpan={4}>
                                    <div className="dl-variant-grid">
                                      {variants.map((part) => (
                                        <span key={part.name}>
                                          <strong>{part.name}</strong>
                                          <b>{fmtChaos(part.chaos)}c</b>
                                        </span>
                                      ))}
                                    </div>
                                    <p>
                                      ({variants.map((part) => `${fmtChaos(part.chaos)}c`).join(" + ")}) ÷ {variants.length}
                                      {" = "}<strong>{fmtChaos(l.unit)}c average</strong>
                                    </p>
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                          <tr className="dl-parts-total"><td colSpan={3}>Expected per kill</td><td className="r num ev">{money(b.gross)}</td></tr>
                        </tbody>
                      </table>
                      <p className="dl-note">
                        Rates: poewiki, {b.delve.sample}. The normal unique pool totals 100%; cards and fragments
                        roll separately, so one kill can still hand you several items. Prices use the same
                        GGG-first resolver as Boss profit, with poe.watch and poe.ninja filling unsupported markets.
                        {b.delve.groups.some((group) => group.drops.some((drop) => drop.unrated)) && " Drops without a published rate use an editable 3% default and are marked in the table."}
                        {b.missingPrices > 0 && ` ${b.missingPrices} line${b.missingPrices > 1 ? "s have" : " has"} no supported market price and contribute nothing.`}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
