import { useMemo } from "react";
import { createJsonStore } from "../../../../shared/storage/jsonStore.js";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { BOSSES } from "../bosses/bossData.js";
import { computeBosses, fmtPrice, sanitizeSettings, summarizePriceCoverage } from "../bosses/bossProfit.js";
import SpotlightBoard from "../../../../shared/ui/SpotlightBoard.jsx";
import { buildFarmHighlights } from "./overviewHighlights.js";
import { assessExchangeMarket, buildExchangeOverview, buildExchangeRows, buildUnusualActivity, filterExchangeRowsByTurnover } from "../exchange/exchangeDesk.js";

const bossSettings = createJsonStore({ game: "poe2", feature: "boss-profit", version: 1 });

function sourceText(league, priceData, rateSummary) {
  if (!priceData) return "Loading PoE 2 market prices…";
  if (priceData === "missing") return `PoE 2 market snapshot unavailable · ${league}`;
  return `Prices via GGG trades + poe.ninja + PoE2Scout gap-fill · ${league} · updated ${new Date(priceData.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`;
}

export default function Overview({ league, priceData, exchange, history, exchangeHistory, currency, chaosExalted, rateSummary, onOpenTab }) {
  const divineExalted = priceData && priceData !== "missing" ? priceData.divineExalted || 0 : 0;
  const summary = useMemo(() => {
    if (!priceData || priceData === "missing") return null;
    const settings = sanitizeSettings(bossSettings.load({}));
    const overrides = Object.fromEntries(Object.entries(settings.priceOverrides || {})
      .filter(([key]) => key.startsWith(`${league}:`))
      .map(([key, value]) => [key.slice(league.length + 1), value]));
    const rows = computeBosses(BOSSES, priceData.prices || {}, { ...settings, priceOverrides: overrides });
    const ranked = rows.filter((row) => row.net != null && Number.isFinite(row.net))
      .sort((a, b) => b.net - a.net);
    return {
      best: ranked[0] || null,
      shortlist: ranked.slice(0, 3),
      coverage: summarizePriceCoverage(rows),
      profile: settings.ttkProfiles.find((profile) => profile.id === settings.activeTtkProfileId) || null,
    };
  }, [league, priceData]);

  const markets = priceData && priceData !== "missing" ? priceData.prices || {} : {};
  const farms = useMemo(() => buildFarmHighlights(markets, history), [priceData, history]);
  const exchangeRows = useMemo(() => filterExchangeRowsByTurnover(buildExchangeRows(exchange, priceData), 1000, { minItemVolume: 10 }), [exchange, priceData]);
  const exchangeSummary = useMemo(() => buildExchangeOverview(exchangeRows, exchangeHistory, { minTurnoverExalted: 1000, limit: 3 }), [exchangeRows, exchangeHistory]);
  const activity = useMemo(() => buildUnusualActivity(exchangeHistory), [exchangeHistory]);
  const price = (value) => fmtPrice(value, currency, divineExalted, chaosExalted);
  const number = (value, digits = 1) => Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const pct = (value) => `${value > 0 ? "+" : ""}${number(value * 100)}%`;
  const tone = (value) => value > 0 ? "gain" : value < 0 ? "loss" : "";
  const marketTarget = (row) => ({ name: row.name, itemId: row.itemId });
  const activityOld = activity.latestAt != null && Date.now() - activity.latestAt > 3 * 3600e3;
  const categories = [
    {
      id: "boss", title: "Boss profit", ranking: "Top 3 by estimated net per kill", unit: "Estimated net per kill", action: "Inspect the encounter",
      emptyNote: "No boss has enough entry pricing for a ranked estimate.", open: () => onOpenTab("bosses"),
      rows: (summary?.shortlist || []).map((row) => ({ id: row.boss.id, title: row.boss.name, value: price(row.net), tone: tone(row.net),
        unit: "Estimated drop value after entry cost", evidence: `${summary.profile?.name || "No custom timing"} · review drop assumptions in Boss profit.`,
        warning: row.missing?.length ? "Incomplete drop pricing" : null,
        open: () => onOpenTab("bosses", row.boss.id) })),
    },
    {
      id: "activity", title: "Unusual activity", ranking: "Top 3 by volume / preceding-hour median", unit: "Completed units vs usual volume", action: "Inspect market history",
      emptyTitle: "No qualifying volume surge", emptyNote: "Needs at least six prior hours, 10 units and a 2× volume increase.", open: () => onOpenTab("activity"),
      rows: activity.rows.slice(0, 3).map((row) => ({ id: row.itemId, title: row.name, value: `${number(row.multiple)}×`,
        unit: "Latest completed hour / prior-hour median", evidence: `${number(row.units, 0)} units vs ${number(row.baseline, 0)} median · ${row.samples} baseline hours. Volume is not a buy signal.`,
        warning: activityOld ? "Historical snapshot" : row.baseline < 10 ? "Small baseline" : null,
        open: () => onOpenTab("prices", marketTarget(row)) })),
    },
    {
      id: "movers", title: "Market movers", ranking: "Top 3 by absolute 24h move · liquid exchange markets", unit: "24h movement in Exalted", action: "Inspect price history",
      emptyTitle: "Building comparable history", emptyNote: "A full, recent 24h window is required; thin markets do not rank.", open: () => onOpenTab("prices"),
      rows: exchangeSummary.movers.map((row) => ({ id: row.itemId, title: row.name, value: pct(row.change), tone: tone(row.change),
        unit: "24h price movement · Exalted basis", evidence: `${row.historyPoints} observed prices · ${number(row.itemVolume, 0)} units/h · movement is not profit.`,
        warning: assessExchangeMarket(row).level === "low" ? "Limited route evidence" : null,
        open: () => onOpenTab("prices", marketTarget(row)) })),
    },
    {
      id: "pressure", title: "Farming pressure", ranking: "Top 3 output / entry relative moves · 24h", unit: "Output basket relative to tablet entry", action: "Inspect Popular farms",
      emptyNote: "Needs a priced tablet and overlapping histories for at least three output markets.", open: () => onOpenTab("farms"),
      rows: farms.pressure.map((row) => ({ id: row.id, title: row.label, value: pct(row.spread), tone: tone(row.spread),
        unit: "Output / entry relative price movement", evidence: `${row.evidence.label} · ${row.index.included.length}/${row.members} output markets. This is not profit per map.`,
        warning: row.limited ? "Limited basket evidence" : null,
        open: () => onOpenTab("farms", row.id) })),
    },
    {
      id: "flow", title: "Farming market flow", ranking: "Top 3 by output-market traded value / hour", unit: "Completed output-market value / hour", action: "Inspect the farming markets",
      emptyNote: "No mechanic has observed completed output flow in this snapshot.", open: () => onOpenTab("farms"),
      rows: farms.flow.map((row) => ({ id: row.id, title: row.label, value: price(row.flow),
        unit: "Completed output-market value / hour", evidence: `${row.members} curated output markets · traded value is market activity, not farming yield.`,
        open: () => onOpenTab("farms", row.id) })),
    },
    {
      id: "liquidity", title: "Currency Exchange", ranking: "Top 3 by completed traded value / hour", unit: "Completed traded value / hour", action: "Inspect the exchange market",
      emptyNote: "No exchange route meets 1,000 Exalted per leg and 10 units per hour.", open: () => onOpenTab("exchange"),
      rows: exchangeSummary.liquidity.map((row) => ({ id: row.itemId, title: row.name, value: price(row.turnoverExalted),
        unit: "Completed traded value / hour", evidence: `${number(row.itemVolume, 0)} units/h · ${row.quoteRoute} · ${assessExchangeMarket(row).label}. Past trades are not executable orders.`,
        warning: assessExchangeMarket(row).level === "low" ? "Limited route evidence" : null,
        open: () => onOpenTab("exchange", marketTarget(row)) })),
    },
    {
      id: "references", title: "Currency references", references: true, ranking: "Three currency references · not ranked", unit: "Snapshot currency value", action: "Open the price tracker",
      emptyNote: "Waiting for actual currency quotes.", open: () => onOpenTab("prices"),
      rows: ["Divine Orb", "Chaos Orb", "Exalted Orb"].flatMap((name) => {
        const value = Number(markets[name]?.exalted);
        return value > 0 ? [{ id: name, title: name, value: price(value), unit: "Snapshot currency value",
          evidence: `${markets[name]?.source || "Normalized snapshot"} · conversion uses your selected currency.`,
          open: () => onOpenTab("prices", { name }) }] : [];
      }),
    },
  ];
  return <main className="market-overview p2ov-main">
    <div className="overview-heading p2ov-head"><div className="p2ov-kicker">Path of Exile 2 · market desk</div>
      <h2>Market overview</h2><p>Three categories in focus, with the next highlights and their top three below.</p></div>
    <div className="overview-provenance"><SourceStrip>{sourceText(league, priceData, rateSummary)}</SourceStrip></div>
    <SpotlightBoard key={league} categories={categories} />
    <details className="overview-health"><summary>Price coverage and assumptions{summary ? ` · ${summary.coverage.priced}/${summary.coverage.total} boss-market items priced` : ""}</summary>
      <p>Boss estimates use saved settings. Profit/hour requires a custom timing profile. Farming pressure compares prices, not returns per map.</p>
      <p>Exchange highlights use at least 1,000 Exalted per leg and 10 units per hour. Missing prices and history remain unknown.</p>
      <button type="button" onClick={() => onOpenTab("bosses")}>Review boss price coverage →</button>
    </details>
  </main>;
}
