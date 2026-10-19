import { useEffect, useMemo, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { computeAll, loadActive, loadProfiles, makeResolver } from "../bosses/bossProfit.js";
import {
  computeBiomes, loadSettings, makePriceOf, loadSampleProfiles,
  loadActiveSampleProfile, sampleMetrics,
} from "../delve/delve.js";
import {
  GCP_NAME, VAAL_ORB_NAME, computeGems, loadSettings as loadGemSettings,
} from "../gems/gems.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { POE1_SCHEMA_VERSIONS } from "../../config.js";
import { isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { TREND_DEPTH, pickTrend } from "./overviewTrends.js";
import SpotlightBoard from "../../../../shared/ui/SpotlightBoard.jsx";

const CATEGORY_FILES = [
  ["catalysts", "Catalysts"],
  ["astrolabes", "Astrolabes"],
];
function pct(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function sourceLabel(source) {
  if (!source) return "Snapshot data";
  if (typeof source === "string") return `Prices via ${source}`;
  const names = Object.entries(source)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name === "ggg" ? "GGG exchange" : name);
  return names.length ? `Prices via ${names.join(" + ")}` : "Snapshot data";
}

export default function Overview({
  league,
  staticBase,
  currency,
  divineRate,
  mirrorDivine,
  fmtPrice,
  movers,
  customFarms,
  activeKey,
  changeKey,
  changeWindow,
  setChangeWindow,
  mode,
  dataSource,
  staticInfo,
  onOpenTab,
}) {
  const [snapshots, setSnapshots] = useState(null);
  const [direction, setDirection] = useState("up");

  useEffect(() => {
    if (!staticBase) { setSnapshots(null); return undefined; }
    let cancelled = false;
    setSnapshots(null);
    /* Every desk on this page is a summary of a file someone else renders in
       full, so a document that fails its schema contract is dropped rather
       than summarised — a headline number from a file the app could not read
       is the worst of both. */
    const read = async (file) => {
      const doc = await loadDocument(`${staticBase}/${file}`, { supported: POE1_SCHEMA_VERSIONS });
      return isUsable(doc) ? doc.data : null;
    };
    Promise.all([
      read("prices.json"),
      read("fossils.json"),
      read("resonators.json"),
      read("catalysts.json"),
      read("astrolabes.json"),
      read("gems.json"),
    ]).then(([prices, fossils, resonators, catalysts, astrolabes, gems]) => {
      if (!cancelled) setSnapshots({ prices, fossils, resonators, catalysts, astrolabes, gems });
    });
    return () => { cancelled = true; };
  }, [staticBase]);

  const profile = useMemo(() => {
    const profiles = loadProfiles();
    const active = loadActive(profiles);
    return profiles.find((item) => item.name === active) || profiles[0];
  }, []);
  const delveSettings = useMemo(() => loadSettings(), []);
  const gemSettings = useMemo(() => loadGemSettings(), []);
  const delveSample = useMemo(() => {
    const profiles = loadSampleProfiles();
    const active = loadActiveSampleProfile(profiles);
    const selected = profiles.find((item) => item.name === active) || profiles[0];
    return sampleMetrics(selected);
  }, []);

  const bossSummary = useMemo(() => {
    const priceMap = snapshots?.prices?.prices;
    if (!priceMap) return null;
    const resolve = makeResolver(priceMap, {
      priceOverrides: profile?.priceOverrides || {},
      divineRate,
    });
    const rows = computeAll(resolve, profile);
    const gaps = rows.flatMap((row) => row.hiddenLines.map((line) => ({
      boss: row.boss,
      line,
    })));
    return {
      rows: rows.filter((row) => !row.entryUnknown && Number.isFinite(row.net)),
      missing: gaps.length,
      firstGap: gaps[0] || null,
    };
  }, [snapshots, profile, divineRate]);

  const delveTargets = useMemo(() => {
    const priceMap = snapshots?.prices?.prices || null;
    const categoryItems = [
      ...(snapshots?.fossils?.items || []),
      ...(snapshots?.resonators?.items || []),
    ];
    if (!priceMap && !categoryItems.length) return [];
    const categoryMap = {};
    for (const item of categoryItems) {
      if (item.chaosValue > 0) categoryMap[item.name] = { c: item.chaosValue, n: 1 };
    }
    const rate = snapshots?.fossils?.divineRate || divineRate;
    const priceOf = makePriceOf([categoryMap, priceMap], {
      overrides: delveSettings.priceOverrides || {},
      divineRate: rate,
    });
    const modelSettings = { ...delveSettings, ...delveSample.quantities };
    return computeBiomes(priceOf, modelSettings, delveSample).targets
      .filter((row) => row.opportunityIndex > 0);
  }, [snapshots, delveSettings, delveSample, divineRate]);

  /* Same model the Gem levelling tab runs, on the same saved settings, so the
     briefing cannot quote a number the tab disagrees with. Thin markets are
     dropped here whatever the setting says: a headline is the wrong place to
     lead with a profit resting on three listings. */
  const gemRows = useMemo(() => {
    const snapshot = snapshots?.gems;
    if (!snapshot?.gems?.length) return [];
    const priceMap = snapshots?.prices?.prices || null;
    return computeGems(snapshot.gems, {
      gcp: snapshot.gcp || priceMap?.[GCP_NAME]?.c || 0,
      vaalOrb: snapshot.vaalOrb || priceMap?.[VAAL_ORB_NAME]?.c || 0,
      vaalSlot: gemSettings.vaalSlot,
      overrides: gemSettings.priceOverrides || {},
      xpPerMinute: gemSettings.xpPerMinute,
      xpQuality: gemSettings.xpQuality,
      xpTotals: gemSettings.xpTotals || {},
    }).filter((row) => !row.unpriced
      && Number.isFinite(row.profitPerHour)
      && !(row.listingFloor != null && row.listingFloor < gemSettings.thinListings));
  }, [snapshots, gemSettings]);

  const categoryRows = useMemo(() => {
    if (!snapshots) return [];
    const candidates = [];
    for (const [key, label] of CATEGORY_FILES) {
      for (const item of snapshots[key]?.items || []) {
        const change = item[changeKey];
        if (Number.isFinite(change)) candidates.push({ ...item, change, label, tab: key });
      }
    }
    return candidates;
  }, [snapshots, changeKey]);

  const strategyRows = useMemo(
    () => (customFarms || []).filter((strategy) => strategy.hasItems),
    [customFarms],
  );

  // Movement lists are sign-filtered; modelled levels use a simple top three.
  const pools = useMemo(() => {
    const byChange = (rows, valueOf) => ({
      up: pickTrend(rows, valueOf, "up"),
      down: pickTrend(rows, valueOf, "down"),
    });
    const byLevel = (rows, valueOf) => ({
      up: pickTrend(rows, valueOf, "up", { signed: false }),
      down: pickTrend(rows, valueOf, "down", { signed: false }),
    });
    return {
      farms: {
        up: movers.rising.slice(0, TREND_DEPTH),
        down: movers.falling.slice(0, TREND_DEPTH),
      },
      boss: byLevel(bossSummary?.rows, (row) => row.net),
      delve: byLevel(delveTargets, (row) => row.opportunityIndex),
      gems: byLevel(gemRows, (row) => row.profitPerHour),
      market: byChange(categoryRows, (row) => row.change),
    };
  }, [movers, strategyRows, bossSummary, delveTargets, gemRows, categoryRows]);

  const realSuffix = activeKey.endsWith("R") ? " · Divine-adjusted" : "";
  const price = (value) => fmtPrice(value, currency, divineRate);
  const movement = (value) => value > 0 ? "gain" : value < 0 ? "loss" : "";
  const categories = [
    {
      id: "farms", title: "Popular farms", ranking: `Top 3 ${direction === "up" ? "rising" : "falling"} mechanics · ${changeWindow}${realSuffix}`,
      unit: `${changeWindow} mechanic-total movement`, action: "Inspect Popular farms",
      emptyTitle: snapshots === null ? "Loading market movement" : "No measured mechanic moves",
      emptyNote: "A move needs an older comparable snapshot. Price movement is not farming profit.",
      open: () => onOpenTab("farms"),
      rows: pools.farms[direction].map((row) => ({ id: row.name, title: row.name, value: pct(row[activeKey]),
        tone: movement(row[activeKey]), unit: `${changeWindow}${realSuffix} mechanic-total movement`,
        evidence: "Scarab cost movement, not a farming profit estimate.",
        open: () => onOpenTab("prices", { group: row.name }) })),
    },
    {
      id: "boss", title: "Boss profit", ranking: "Top 3 by estimated net per kill", unit: "Estimated net per kill", action: "Inspect the encounter",
      emptyNote: "No boss has enough entry pricing for a ranked estimate.", open: () => onOpenTab("bosses"),
      rows: pools.boss.up.map((row) => ({ id: row.boss.id, title: row.boss.name, value: price(row.net),
        tone: movement(row.net), unit: "Estimated drop value after entry cost",
        evidence: `${profile?.name || "Default"} settings · ${row.hiddenLines.length ? `${row.hiddenLines.length} unpriced drop lines` : "All drop lines priced"}`,
        warning: row.hiddenLines.length ? "Incomplete drop pricing" : null,
        open: () => onOpenTab("bosses", row.boss.id) })),
    },
    {
      id: "gems", title: "Gem levelling", ranking: "Top 3 by modelled profit / hour / socket", unit: "Modelled profit / hour / socket", action: "Review gem inputs",
      emptyNote: "No eligible gem has usable pricing and sufficient listing depth.", open: () => onOpenTab("gems"),
      rows: pools.gems.up.map((row) => ({ id: row.name, title: row.name, value: price(row.profitPerHour),
        tone: movement(row.profitPerHour), unit: "Modelled profit / hour / socket",
        warning: row.approx ? "Includes estimated gem quotes" : null,
        evidence: `Your saved levelling inputs · ${Math.round(row.xp?.minutes || 0)} min to level · ${row.path === "vaal" ? "then corrupt" : "then sell"}`,
        open: () => onOpenTab("gems") })),
    },
    {
      id: "market", title: "Market movers", ranking: `Top 3 ${direction === "up" ? "rising" : "falling"} Catalysts / Astrolabes · ${changeWindow}`,
      unit: `${changeWindow} price movement`, action: "Inspect price history",
      emptyNote: "No measured move in these categories for the selected window.", open: () => onOpenTab("catalysts"),
      rows: pools.market[direction].map((row) => ({ id: `${row.tab}:${row.name}`, title: row.name, value: pct(row.change),
        tone: movement(row.change), unit: `${changeWindow} price movement · ${row.label}`,
        evidence: "Observed item-price movement. Inspect the full price path before drawing conclusions.",
        open: () => onOpenTab(row.tab, { name: row.name }) })),
    },
    {
      id: "delve", title: "Delve · experimental", ranking: "Top 3 by saved-depth opportunity index", unit: "Community Depth EV", action: "Inspect the Delve model",
      emptyNote: "No priced target is available for your saved depth and sample.", open: () => onOpenTab("delve"),
      rows: pools.delve.up.map((row) => ({ id: row.biome.id || row.biome.name, title: row.biome.name,
        value: price(row.depthAdjustedRange.median), unit: `Community Depth EV · depth ${delveSettings.depth}`,
        evidence: `${Math.round(row.opportunityIndex)}/100 opportunity · ${row.exclusive?.fossil || "fossil routing"} · saved sample`,
        warning: "Experimental model", open: () => onOpenTab("delve") })),
    },
    {
      id: "watcher", title: "Strat Watcher", ranking: "Top 3 saved setups by current cost", unit: "Current setup cost", action: "Open Strat Watcher",
      emptyTitle: "No fully priced saved setups", emptyNote: "Save a setup with all items priced to compare its cost and measured movement.",
      open: () => onOpenTab("watcher"),
      rows: [...strategyRows].filter((row) => !row.missing?.length && row.members?.length && Number.isFinite(row.total)).sort((a, b) => b.total - a.total).slice(0, 3)
        .map((row) => ({ id: row.id || row.name, title: row.name, value: price(row.total), unit: "Current setup cost, not profit",
          evidence: `${row.scarabs.length}/5 scarabs${row.astrolabe ? " + Astrolabe" : ""} · ${changeWindow}${realSuffix}: ${pct(row[activeKey])}`,
          open: () => onOpenTab("watcher", { id: row.id }) })),
    },
  ];
  const updatedAt = staticInfo?.generatedAt || snapshots?.prices?.generatedAt;
  const status = mode === "connecting" ? "Loading market data" : mode === "demo" ? "Demo snapshot"
    : mode === "unavailable" ? "No market data" : sourceLabel(snapshots?.prices?.priceSource || staticInfo?.priceSource);
  const showRates = mode !== "unavailable" && mode !== "connecting";

  return <main className="ov-main market-overview">
    <div className="ov-head overview-heading">
      <div><div className="ov-kicker">Path of Exile 1 · market desk</div><h2>Market overview</h2>
        <p>Highlights from your tools, with each category’s top three at hand.</p></div>
      <div className="app-segmented" aria-label="Movement window">
        {CHANGE_WINDOW_OPTIONS.map((window) => <button type="button" key={window} className={changeWindow === window ? "on" : ""}
          aria-pressed={changeWindow === window} onClick={() => setChangeWindow(window)}>{window}</button>)}
      </div>
    </div>
    <div className="overview-provenance"><SourceStrip>
      <b>{status}</b>{league ? ` · ${league}` : ""}{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ""}
      {showRates && divineRate > 0 ? ` · 1 Divine ≈ ${Math.round(divineRate)} Chaos` : ""}
    </SourceStrip></div>
    <div className="app-segmented overview-movement-direction" aria-label="Movement rankings">
      <button type="button" aria-pressed={direction === "up"} className={direction === "up" ? "on" : ""} onClick={() => setDirection("up")}>Rising markets</button>
      <button type="button" aria-pressed={direction === "down"} className={direction === "down" ? "on" : ""} onClick={() => setDirection("down")}>Falling markets</button>
    </div>
    <SpotlightBoard key={league} categories={categories} />
    <details className="overview-health"><summary>Price coverage and assumptions{bossSummary ? ` · ${bossSummary.missing} missing boss drop quotes` : ""}</summary>
      <p>Boss and gem figures use your saved settings. Delve remains experimental. Market movement and setup cost are not farming profit.</p>
      {bossSummary?.firstGap && <button type="button" onClick={() => onOpenTab("bosses", bossSummary.firstGap.boss.id)}>Review the first missing boss quote →</button>}
    </details>
  </main>;
}
