import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import MarketBrowser from "../../shared/MarketBrowser.jsx";
import { assessExchangeRoute, buildExchangeOverview, buildExchangeRouteTimeline, buildExchangeRows, CHAOS_ID, DIVINE_ID, EXALTED_ID, estimateExchangeExecution, filterExchangeRowsByTurnover } from "./exchangeDesk.js";

const RANGES = [[24, "24h"], [168, "7d"], [720, "30d"], [null, "All"]];
const ROUTE_PAGE_SIZE = 10;
const MARKET_PAGE_SIZE = 20;
const CORE_ROUTE_IDS = [EXALTED_ID, CHAOS_ID, DIVINE_ID];

function number(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function percent(value) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${number(value * 100, 1)}%`;
}

function unsignedPercent(value) {
  return value == null ? "—" : `${number(value * 100, 1)}%`;
}

function tick(value, rangeHours) {
  const date = new Date(value);
  return rangeHours && rangeHours <= 168
    ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function displayMode(currency, price, divineRate) {
  if (currency === "chaos") return "Chaos";
  return currency === "divine" || (currency === "smart" && divineRate > 0 && price >= divineRate * .5) ? "Divine" : "Exalted";
}

function displayPrice(value, unit, divineRate, chaosRate) {
  if (!(value > 0)) return "—";
  if (unit === "Divine" && divineRate > 0) return `${number(value / divineRate)} div`;
  if (unit === "Chaos" && chaosRate > 0) return `${number(value / chaosRate)} chaos`;
  return `${number(value)} ex`;
}

function duration(value) {
  if (value == null) return "—";
  if (value < 1) return `${number(value * 60, 0)} min`;
  if (value < 24) return `${number(value, 1)} hr`;
  return `${number(value / 24, 1)} days`;
}

export default function CurrencyExchange({ league, priceData, exchange, history, currency, chaosExalted, rateSummary }) {
  const rows = useMemo(() => buildExchangeRows(exchange, priceData), [exchange, priceData]);
  const overview = useMemo(() => buildExchangeOverview(rows, history), [history, rows]);
  const detailRef = useRef(null);
  const workbenchRef = useRef(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("routes");
  const [minimum, setMinimum] = useState(1000);
  const [minimumUnits, setMinimumUnits] = useState(10);
  const [rangeHours, setRangeHours] = useState(168);
  const [divineAdjusted, setDivineAdjusted] = useState(false);
  const [plannedUnits, setPlannedUnits] = useState(1);
  const [participation, setParticipation] = useState(.1);
  const [tradeSide, setTradeSide] = useState("sell");
  const [routeMinimum, setRouteMinimum] = useState(1000);
  const [routeMinimumUnits, setRouteMinimumUnits] = useState(10);
  const [visibleRouteCount, setVisibleRouteCount] = useState(ROUTE_PAGE_SIZE);
  const [visibleMarketCount, setVisibleMarketCount] = useState(MARKET_PAGE_SIZE);
  const [comparisonRouteId, setComparisonRouteId] = useState("");
  const [pickerCollapsed, setPickerCollapsed] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = filterExchangeRowsByTurnover(rows, minimum, { minItemVolume: minimumUnits })
      .filter((row) => !needle || row.name.toLowerCase().includes(needle));
    const compare = sort === "volume" ? (a, b) => b.itemVolume - a.itemVolume
      : sort === "spread" ? (a, b) => Math.abs(b.quoteGap || 0) - Math.abs(a.quoteGap || 0)
        : sort === "range" ? (a, b) => b.rangePercent - a.rangePercent
          : sort === "move" ? (a, b) => Math.abs(overview.movementByItem[b.itemId]?.change || 0) - Math.abs(overview.movementByItem[a.itemId]?.change || 0)
            : sort === "routes" ? (a, b) => b.routeGap - a.routeGap
          : (a, b) => b.turnoverExalted - a.turnoverExalted;
    return [...filtered].sort(compare);
  }, [minimum, minimumUnits, overview.movementByItem, query, rows, sort]);
  const shownMarkets = visible.slice(0, visibleMarketCount);
  const remainingMarkets = visible.length - shownMarkets.length;

  useEffect(() => {
    if (!rows.length) { setSelectedId(""); return; }
    setSelectedId((current) => rows.some((row) => row.itemId === current)
      ? current : (rows.find((row) => row.itemId !== DIVINE_ID) || rows[0]).itemId);
  }, [rows]);

  const selected = rows.find((row) => row.itemId === selectedId) || null;
  const sortedRoutes = useMemo(() => [...(selected?.routeOptions || [])]
    .sort((left, right) => tradeSide === "buy" ? left.priceExalted - right.priceExalted : right.priceExalted - left.priceExalted), [selected, tradeSide]);
  const viableRoutes = useMemo(() => sortedRoutes.filter((route) => route.limitingTurnoverExalted >= routeMinimum && route.itemVolume >= routeMinimumUnits), [routeMinimum, routeMinimumUnits, sortedRoutes]);
  const recommendedRoute = viableRoutes[0] || null;
  const availableRoutes = useMemo(() => {
    const included = new Set(viableRoutes.map((route) => route.quoteId));
    CORE_ROUTE_IDS.forEach((quoteId) => {
      if (sortedRoutes.some((route) => route.quoteId === quoteId)) included.add(quoteId);
    });
    return sortedRoutes.filter((route) => included.has(route.quoteId));
  }, [sortedRoutes, viableRoutes]);
  const shownRoutes = useMemo(() => {
    const included = new Set(availableRoutes.slice(0, visibleRouteCount).map((route) => route.quoteId));
    CORE_ROUTE_IDS.forEach((quoteId) => {
      if (availableRoutes.some((route) => route.quoteId === quoteId)) included.add(quoteId);
    });
    for (let index = availableRoutes.length - 1; included.size > visibleRouteCount && index >= 0; index -= 1) {
      const route = availableRoutes[index];
      if (!CORE_ROUTE_IDS.includes(route.quoteId) && route.quoteId !== recommendedRoute?.quoteId) included.delete(route.quoteId);
    }
    return availableRoutes.filter((route) => included.has(route.quoteId));
  }, [availableRoutes, recommendedRoute, visibleRouteCount]);
  const remainingRoutes = availableRoutes.length - shownRoutes.length;
  const comparisonRoute = availableRoutes.find((route) => route.quoteId === comparisonRouteId) || null;
  const directExaltedRoute = selected?.routeOptions?.find((route) => route.quoteId === EXALTED_ID) || null;
  const viableRoutePrices = viableRoutes.map((route) => route.priceExalted).filter((value) => value > 0);
  const viableRouteGap = viableRoutePrices.length > 1
    ? Math.max(...viableRoutePrices) / Math.min(...viableRoutePrices) - 1 : 0;
  const confidence = useMemo(() => assessExchangeRoute(recommendedRoute, {
    minTurnoverExalted: routeMinimum,
    minItemVolume: routeMinimumUnits,
    routeGap: viableRouteGap,
  }), [recommendedRoute, routeMinimum, routeMinimumUnits, viableRouteGap]);
  const execution = useMemo(() => estimateExchangeExecution(recommendedRoute, plannedUnits, { participation }), [participation, plannedUnits, recommendedRoute]);
  const comparisonExecution = useMemo(() => estimateExchangeExecution(comparisonRoute, plannedUnits, { participation }), [comparisonRoute, participation, plannedUnits]);
  const comparisonDifference = comparisonRoute && recommendedRoute ? comparisonRoute.priceExalted / recommendedRoute.priceExalted - 1 : null;
  const comparisonBetter = comparisonDifference != null && (tradeSide === "buy" ? comparisonDifference < -.0005 : comparisonDifference > .0005);
  const comparisonWorse = comparisonDifference != null && (tradeSide === "buy" ? comparisonDifference > .0005 : comparisonDifference < -.0005);
  const routeImprovement = recommendedRoute && directExaltedRoute ? (tradeSide === "buy"
    ? 1 - recommendedRoute.priceExalted / directExaltedRoute.priceExalted
    : recommendedRoute.priceExalted / directExaltedRoute.priceExalted - 1) : null;
  const routeLeaders = useMemo(() => filterExchangeRowsByTurnover(rows, routeMinimum, { minItemVolume: routeMinimumUnits })
    .filter((row) => row.routeCount > 1 && row.routeGap > .005)
    .sort((left, right) => right.routeGap - left.routeGap).slice(0, 8), [routeMinimum, routeMinimumUnits, rows]);
  const marketNames = useMemo(() => rows.map((row) => row.name).sort((left, right) => left.localeCompare(right)), [rows]);
  const marketEntries = useMemo(() => Object.fromEntries(rows.map((row) => [row.name, {
    itemClass: row.type,
    type: row.type,
    metadataPath: row.itemId,
    tags: exchange?.items?.[row.itemId]?.tags || [],
  }])), [exchange, rows]);
  const rowByName = useMemo(() => new Map(rows.map((row) => [row.name, row])), [rows]);
  const preferredMarket = rows.find((row) => row.itemId !== DIVINE_ID)?.name || rows[0]?.name;
  const trackedRoute = comparisonRoute || recommendedRoute;
  const timeline = useMemo(() => buildExchangeRouteTimeline(history, selectedId, trackedRoute?.quoteId, { rangeHours }), [history, rangeHours, selectedId, trackedRoute?.quoteId]);
  const divineRate = priceData && priceData !== "missing" ? priceData.divineExalted || 0 : 0;
  const unit = displayMode(currency, trackedRoute?.priceExalted || selected?.priceExalted || 0, divineRate);
  const chartPoints = timeline.points.map((point) => ({
    ...point,
    shownPrice: unit === "Divine" ? (point.divineExalted ? point.price / point.divineExalted : null) : unit === "Chaos" ? (point.chaosExalted ? point.price / point.chaosExalted : null) : point.price,
    shownLow: unit === "Divine" ? (point.divineExalted ? point.low / point.divineExalted : null) : unit === "Chaos" ? (point.chaosExalted ? point.low / point.chaosExalted : null) : point.low,
    shownHigh: unit === "Divine" ? (point.divineExalted ? point.high / point.divineExalted : null) : unit === "Chaos" ? (point.chaosExalted ? point.high / point.chaosExalted : null) : point.high,
  }));
  const move = divineAdjusted ? timeline.divineAdjustedChange : timeline.change;

  function inspectMarket(itemId) {
    setSelectedId(itemId);
    setPickerCollapsed(true);
    requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function selectFromBrowser(itemId) {
    setSelectedId(itemId);
    if (window.matchMedia?.("(max-width: 780px)").matches) {
      setPickerCollapsed(true);
      requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  useEffect(() => {
    if (!timeline.canDivineAdjust) setDivineAdjusted(false);
  }, [timeline.canDivineAdjust]);

  useEffect(() => {
    setVisibleRouteCount(ROUTE_PAGE_SIZE);
  }, [routeMinimum, routeMinimumUnits, selectedId, tradeSide]);

  useEffect(() => {
    setVisibleMarketCount(MARKET_PAGE_SIZE);
  }, [minimum, minimumUnits, query, rows, sort]);

  useEffect(() => {
    setComparisonRouteId("");
  }, [selectedId]);

  useEffect(() => {
    setComparisonRouteId((current) => current && availableRoutes.some((route) => route.quoteId === current) ? current : "");
  }, [availableRoutes]);

  return (
    <main className="p2ex-main">
      <style>{css}</style>
      <SourceStrip>{exchange
        ? `GGG completed Currency Exchange trades · ${league} · market hour ${new Date(exchange.marketHour || exchange.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`
        : `Completed PoE 2 Currency Exchange data is not available yet · ${league}`}</SourceStrip>

      <header className="p2ex-head">
        <div><span>Official completed trades</span><h2>Exchange route finder</h2><p>Compare observed Exalted, Divine, Chaos, and alternate quote routes with explicit depth and confidence checks. Results describe the completed market hour—not live offers.</p></div>
        <div className="p2ex-kpis">
          <div><span>Exchange markets</span><strong>{rows.length || "—"}</strong></div>
          <div><span>Cleared turnover</span><strong>{rows.length ? `${number(overview.totalTurnoverExalted, 0)} ex/h` : "—"}</strong></div>
          <div><span>Multi-route items</span><strong>{rows.filter((row) => row.routeCount > 1).length || "—"}</strong></div>
          <div><span>Stored points</span><strong>{overview.historySnapshots || "Building"}</strong></div>
        </div>
      </header>

      {!exchange ? <section className="p2ex-empty">The next scheduled market fetch will create the full-pair snapshot and start its history.</section> : <>
        <div className="p2ex-route-workspace">
        <section className={`p2ex-market-picker ${pickerCollapsed ? "collapsed" : ""}`}>
          <div className="p2ex-market-picker-toggle"><span>Selected market</span><strong>{selected?.name || "Select an item"}</strong><button type="button" onClick={() => setPickerCollapsed((value) => !value)}>{pickerCollapsed ? "Change item" : "Hide picker"}</button></div>
          <div className="p2ex-market-picker-body"><MarketBrowser names={marketNames} entries={marketEntries} selectedName={selected?.name || ""} preferredName={preferredMarket}
            onSelect={(name) => selectFromBrowser(rowByName.get(name)?.itemId || "")} /></div>
        </section>
        <section className="p2ex-router" ref={workbenchRef}>
          <header className="p2ex-router-head">
            <div><span>Observed route comparison</span><h2>{selected?.name || "Select an item"}</h2><p>Compare same-hour completed averages after normalizing each quote currency through Exalted. These are historical route signals, not live offers.</p></div>
            <div className="p2ex-side-switch" aria-label="Trade direction"><button type="button" className={tradeSide === "buy" ? "on" : ""} onClick={() => setTradeSide("buy")}>I want to buy</button><button type="button" className={tradeSide === "sell" ? "on" : ""} onClick={() => setTradeSide("sell")}>I want to sell</button></div>
          </header>
          <div className="p2ex-router-controls">
            <label><span>Units</span><input type="number" min="1" step="1" value={plannedUnits} onChange={(event) => setPlannedUnits(Math.max(1, Number(event.target.value) || 1))} /><small>Starts at one item · enter a bulk amount when needed</small></label>
            <label><span>Minimum hourly route turnover</span><input type="number" min="0" step="100" list="p2ex-turnover-presets" value={routeMinimum} onChange={(event) => setRouteMinimum(Math.max(0, Number(event.target.value) || 0))} /><small>Exalted/hour · custom value allowed</small><datalist id="p2ex-turnover-presets"><option value="500" /><option value="1000" /><option value="2500" /><option value="5000" /><option value="10000" /><option value="25000" /><option value="50000" /></datalist></label>
            <label><span>Minimum hourly units</span><input type="number" min="0" step="1" list="p2ex-unit-presets" value={routeMinimumUnits} onChange={(event) => setRouteMinimumUnits(Math.max(0, Number(event.target.value) || 0))} /><small>Completed units/hour · protects against one-sale markets</small><datalist id="p2ex-unit-presets"><option value="1" /><option value="5" /><option value="10" /><option value="25" /><option value="50" /><option value="100" /></datalist></label>
            <label><span>Expected accessible hourly flow</span><input type="number" min="0.1" max="100" step="0.1" list="p2ex-flow-presets" value={Number((participation * 100).toFixed(2))} onChange={(event) => setParticipation(Math.min(1, Math.max(.001, (Number(event.target.value) || .1) / 100)))} /><small>Percent of completed flow · custom value allowed</small><datalist id="p2ex-flow-presets"><option value="1" /><option value="5" /><option value="10" /><option value="25" /><option value="50" /><option value="75" /><option value="90" /><option value="100" /></datalist></label>
          </div>
          {recommendedRoute ? <>
            <div className="p2ex-recommendation">
              <div><span>Best observed route</span><strong>{tradeSide === "buy" ? "Pay" : "Receive"} {number(recommendedRoute.rateQuotePerItem * plannedUnits)} {recommendedRoute.quoteName}</strong><small>{number(recommendedRoute.rateQuotePerItem)} per item · {number(execution.completedValue, 0)} Exalted equivalent</small><em className={`p2ex-confidence ${confidence.level}`}>{confidence.label} · {confidence.reasons.join(" · ")}</em></div>
              <dl><div><dt>Versus direct Exalted</dt><dd className={routeImprovement > 0 ? "gain" : ""}>{routeImprovement == null ? "No direct pair" : routeImprovement > .0005 ? `${percent(routeImprovement)} observed edge` : "Same observed route"}</dd></div><div><dt>Estimated clear time</dt><dd>{duration(execution.hoursToClear)}</dd></div><div><dt>Observed value range</dt><dd>{number(execution.lowValue, 0)}–{number(execution.highValue, 0)} ex</dd></div></dl>
            </div>
            {comparisonRoute && <div className="p2ex-recommendation p2ex-comparison">
              <div><span>Selected comparison route</span><strong>{tradeSide === "buy" ? "Pay" : "Receive"} {number(comparisonRoute.rateQuotePerItem * plannedUnits)} {comparisonRoute.quoteName}</strong><small>{number(comparisonRoute.rateQuotePerItem)} per item · {number(comparisonExecution.completedValue, 0)} Exalted equivalent{comparisonRoute.limitingTurnoverExalted < routeMinimum ? " · below turnover floor" : ""}</small></div>
              <dl><div><dt>Versus best observed</dt><dd className={comparisonBetter ? "gain" : comparisonWorse ? "loss" : ""}>{Math.abs(comparisonDifference) <= .0005 ? "Same route" : tradeSide === "buy" ? `${unsignedPercent(Math.abs(comparisonDifference))} ${comparisonDifference < 0 ? "cheaper" : "more expensive"}` : `${unsignedPercent(Math.abs(comparisonDifference))} ${comparisonDifference > 0 ? "higher return" : "lower return"}`}</dd></div><div><dt>Estimated clear time</dt><dd>{duration(comparisonExecution.hoursToClear)}</dd></div><div><dt>Observed value range</dt><dd>{number(comparisonExecution.lowValue, 0)}–{number(comparisonExecution.highValue, 0)} ex</dd></div></dl>
              <button type="button" className="p2ex-comparison-clear" onClick={() => setComparisonRouteId("")}>Clear comparison</button>
            </div>}
            <div className="p2ex-route-legend"><span>Pinned comparisons</span><p>Exalted, Chaos, and Divine remain visible when completed evidence exists. Selecting a row also switches the history chart to that route.</p></div>
            <div className="p2ex-route-layout">
              <div className="p2ex-route-table p2ex-table-wrap"><table><thead><tr><th>{tradeSide === "buy" ? "Pay with" : "Receive"}</th><th>Rate per item</th><th>Total for {number(plannedUnits, 0)}</th><th>Exalted equivalent</th><th>Completed range</th><th>Route depth</th></tr></thead><tbody>{shownRoutes.map((route) => { const recommended = route.quoteId === recommendedRoute.quoteId; const core = CORE_ROUTE_IDS.includes(route.quoteId); const comparing = route.quoteId === comparisonRouteId; return <tr key={route.quoteId} className={`${recommended ? "recommended" : ""} ${core ? "core" : ""} ${comparing ? "comparison" : ""}`}><td><button type="button" className="p2ex-route-pick" aria-pressed={comparing} title={`Compare ${route.quoteName} with the best observed route`} onClick={() => setComparisonRouteId((current) => current === route.quoteId ? "" : route.quoteId)}><span className="p2ex-route-name"><strong>{route.quoteName}</strong>{core && <em>Pinned</em>}</span><small>{recommended ? core ? "Best observed · Always shown" : "Best observed" : core ? `${route.routeLabel} · Always shown` : route.routeLabel}</small></button></td><td>{number(route.rateQuotePerItem)} {route.quoteName}</td><td>{number(route.rateQuotePerItem * plannedUnits)} {route.quoteName}</td><td>{number(route.priceExalted)} ex/item</td><td>{number(route.lowExalted)}–{number(route.highExalted)} ex<small>{unsignedPercent(route.rangePercent)} spread</small></td><td>{number(route.itemVolume, 0)} units/h<small>{number(route.limitingTurnoverExalted, 0)} ex/h limiting</small></td></tr>; })}</tbody></table>{remainingRoutes > 0 && <button type="button" className="p2ex-route-more" onClick={() => setVisibleRouteCount((count) => count + ROUTE_PAGE_SIZE)}>View {Math.min(ROUTE_PAGE_SIZE, remainingRoutes)} more <span>· {remainingRoutes} remaining</span></button>}</div>
            </div>
            <p className="p2ex-router-note"><strong>Not a live arbitrage quote.</strong> Routes compare same-hour completed means, and their legs may have cleared at different moments. Both legs must pass the selected turnover and unit floors; wide ranges and extreme disagreement reduce confidence.</p>
            <aside className="p2ex-route-leaders"><span>Largest observed route disagreements</span><p>Outliers worth checking manually—not guaranteed opportunities—after applying both depth floors.</p>{routeLeaders.length ? routeLeaders.map((row) => <button type="button" key={row.itemId} onClick={() => inspectMarket(row.itemId)}><span><strong>{row.name}</strong><small>{row.routeCount} eligible routes · {number(row.itemVolume, 0)} units/h</small></span><b>{unsignedPercent(row.routeGap)}</b></button>) : <div>No qualifying multi-route differences.</div>}</aside>
          </> : <div className="p2ex-no-rows">No route for this item passes both the selected turnover and unit floors.</div>}
        </section>
        </div>

        <section className="p2ex-chart-card" ref={detailRef}>
          <div className="p2ex-chart-head">
            <div><span>{comparisonRoute ? "Comparison route history" : "Best observed route history"}</span><h3>{selected?.name || "Select a market"}</h3><p>{trackedRoute ? `${trackedRoute.routeLabel} · ${number(trackedRoute.itemVolume, 0)} units/h · ${number(trackedRoute.limitingTurnoverExalted, 0)} ex/h limiting turnover` : "Select an eligible route above to chart its stored completed-trade history."}</p></div>
            <div className="p2ex-move"><span>{divineAdjusted ? "Divine-adjusted move" : "Selected move"}</span><strong className={move > 0 ? "gain" : move < 0 ? "loss" : ""}>{percent(move)}</strong></div>
          </div>
          <div className="p2ex-tools">
            <div className="p2ex-ranges">{RANGES.map(([hours, label]) => <button key={label} className={rangeHours === hours ? "on" : ""} onClick={() => setRangeHours(hours)}>{label}</button>)}</div>
            <label className={!timeline.canDivineAdjust ? "disabled" : ""} title={timeline.canDivineAdjust ? "Compare price / Divine rate at both ends" : "Two priced endpoints with Divine rates are required"}><input type="checkbox" checked={divineAdjusted} disabled={!timeline.canDivineAdjust} onChange={(event) => setDivineAdjusted(event.target.checked)} /> Divine-adjusted</label>
          </div>
          <div className="p2ex-chart">
            {chartPoints.length ? <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartPoints} margin={{ top: 12, right: divineAdjusted ? 14 : 4, bottom: 4, left: 2 }}>
                <CartesianGrid stroke="#35231c" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="#806b62" fontSize={11} tickFormatter={(value) => tick(value, rangeHours)} />
                <YAxis stroke="#806b62" fontSize={11} width={62} domain={["auto", "auto"]} tickFormatter={(value) => number(value, value < 10 ? 2 : 0)} />
                {divineAdjusted && <YAxis yAxisId="divine" orientation="right" stroke="#8f7eaf" fontSize={11} width={58} domain={["auto", "auto"]} tickFormatter={(value) => number(value, 0)} />}
                <Tooltip contentStyle={{ background: "#160e0b", border: "1px solid #63351f", color: "#ead8cf" }} labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value, name) => name === "Divine rate" ? [`${number(value)} ex / div`, name] : [`${number(value)} ${unit === "Divine" ? "div" : unit === "Chaos" ? "chaos" : "ex"}`, name]} />
                <Line dataKey="shownLow" name="Traded low" stroke="#76513f" strokeWidth={1} dot={false} animationDuration={1000} />
                <Line dataKey="shownHigh" name="Traded high" stroke="#76513f" strokeWidth={1} dot={false} animationDuration={1000} />
                <Line dataKey="shownPrice" name="Completed mean" stroke="#e36f3f" strokeWidth={2.2} dot={chartPoints.length < 30} animationDuration={1000} />
                {divineAdjusted && <Line yAxisId="divine" dataKey="divineExalted" name="Divine rate" stroke="#8f7eaf" strokeDasharray="5 4" strokeWidth={1.5} dot={false} animationDuration={1000} />}
              </LineChart>
            </ResponsiveContainer> : <div className="p2ex-chart-empty">This exact route’s history starts when both completed legs are stored in the same market hour.</div>}
          </div>
        </section>

        <section className="p2ex-market-card">
          <header className="p2ex-scanner-head"><div><span>Route opportunity scanner</span><h3>Compare qualified exchange markets</h3><p>Rank completed-route disagreements after applying turnover and unit-volume safeguards. Large gaps are investigation signals, not promised profit.</p></div><strong>{visible.length} qualified</strong></header>
          <div className="p2ex-filters">
            <label><span>Find market</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all exchange items" /></label>
            <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="routes">Largest observed route gap</option><option value="turnover">Exalted turnover</option><option value="volume">Units cleared</option><option value="move">Largest 24h move</option><option value="spread">Largest poe.ninja gap</option><option value="range">Widest traded range</option></select></label>
            <label><span>Minimum route turnover</span><select value={minimum} onChange={(event) => setMinimum(Number(event.target.value))}><option value="0">Any completed route</option><option value="100">100 Exalted / route</option><option value="500">500 Exalted / route</option><option value="1000">1,000 Exalted / route</option><option value="5000">5,000 Exalted / route</option><option value="10000">10,000 Exalted / route</option></select></label>
            <label><span>Minimum units cleared</span><select value={minimumUnits} onChange={(event) => setMinimumUnits(Number(event.target.value))}><option value="0">Any completed units</option><option value="1">1 unit / hour</option><option value="5">5 units / hour</option><option value="10">10 units / hour</option><option value="25">25 units / hour</option><option value="50">50 units / hour</option><option value="100">100 units / hour</option></select></label>
          </div>
          <div className="p2ex-table-wrap"><table><thead><tr><th>Market</th><th>Lowest observed buy</th><th>Highest observed sell</th><th>Observed gap</th><th>24h move</th><th>Completed range</th><th>Depth / hour</th></tr></thead><tbody>
            {shownMarkets.map((row) => { const rowConfidence = assessExchangeRoute(row.bestBuy, { minTurnoverExalted: minimum, minItemVolume: minimumUnits, routeGap: row.routeGap }); return <tr key={row.itemId} className={row.itemId === selectedId ? "selected" : ""} onClick={() => inspectMarket(row.itemId)}>
              <td><strong>{row.name}</strong><small>{row.type || "Currency Exchange item"} · {row.routeCount} eligible quote {row.routeCount === 1 ? "currency" : "currencies"}{row.totalRouteCount > row.routeCount ? ` of ${row.totalRouteCount} total` : ""}</small></td>
              <td><strong>{row.bestBuy.quoteName}</strong><small>{number(row.bestBuy.priceExalted)} ex/item · {number(row.bestBuy.limitingTurnoverExalted, 0)} ex/h</small></td>
              <td><strong>{row.bestSell.quoteName}</strong><small>{number(row.bestSell.priceExalted)} ex/item · {number(row.bestSell.limitingTurnoverExalted, 0)} ex/h</small></td>
              <td className={`p2ex-gap ${rowConfidence.level}`}>{row.routeCount > 1 ? unsignedPercent(row.routeGap) : "—"}<small>{rowConfidence.label}</small></td>
              <td className={overview.movementByItem[row.itemId]?.change > 0 ? "gain" : overview.movementByItem[row.itemId]?.change < 0 ? "loss" : ""}>{percent(overview.movementByItem[row.itemId]?.change)}<small>Div {percent(overview.movementByItem[row.itemId]?.divineAdjustedChange)}</small></td>
              <td>{displayPrice(row.lowExalted, unit, divineRate, chaosExalted)}–{displayPrice(row.highExalted, unit, divineRate, chaosExalted)}</td>
              <td>{number(row.itemVolume, 0)} units/h<small>{number(row.turnoverExalted, 0)} ex/h</small></td>
            </tr>; })}
          </tbody></table>{!visible.length && <div className="p2ex-no-rows">No completed exchange markets match these filters.</div>}{remainingMarkets > 0 && <button type="button" className="p2ex-route-more" onClick={() => setVisibleMarketCount((count) => count + MARKET_PAGE_SIZE)}>Show {Math.min(MARKET_PAGE_SIZE, remainingMarkets)} more markets <span>· {remainingMarkets} remaining</span></button>}</div>
        </section>

      </>}
    </main>
  );
}

const css = `
.p2ex-main{display:grid;gap:14px}.p2ex-head{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:20px 22px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2ex-head>div:first-child>span,.p2ex-chart-head span,.p2ex-routes header span,.p2ex-filters span,.p2ex-move span{color:#bd6846;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2ex-head h2{margin:4px 0;color:#f0ded5;font-size:27px}.p2ex-head p{max-width:690px;margin:0;color:#9c867c;font-size:13px}.p2ex-kpis{display:grid;grid-template-columns:repeat(2,minmax(110px,1fr));gap:8px}.p2ex-kpis div{display:grid;gap:3px;padding:9px 11px;border:1px solid #3e281e;border-radius:5px;background:#100b09}.p2ex-kpis span{color:#846f66;font-size:9.5px;text-transform:uppercase}.p2ex-kpis strong{color:#e1ccc2;font-size:16px}.p2ex-chart-card,.p2ex-market-card,.p2ex-routes{display:grid;gap:12px;padding:18px;border:1px solid #452b20;border-radius:8px;background:#110c0a}.p2ex-chart-head{display:flex;justify-content:space-between;gap:18px}.p2ex-chart-head h3,.p2ex-routes h3{margin:4px 0;color:#ead5cb;font-size:20px}.p2ex-chart-head p,.p2ex-routes header p{margin:0;color:#8e776d;font-size:12px}.p2ex-move{display:grid;align-content:start;gap:4px;text-align:right}.p2ex-move strong{font-size:20px}.p2ex-tools{display:flex;align-items:center;justify-content:space-between;gap:12px}.p2ex-ranges{display:flex;gap:5px}.p2ex-ranges button{padding:6px 10px;border:1px solid #45291f;border-radius:4px;background:#160e0b;color:#9c8277;cursor:pointer}.p2ex-ranges button.on{border-color:#a44e2d;background:#2a140d;color:#efb59d}.p2ex-tools label{color:#c7ada1;font-size:12px;cursor:pointer}.p2ex-tools label.disabled{opacity:.45;cursor:not-allowed}.p2ex-tools input{accent-color:#a44e2d}.p2ex-chart{min-height:280px;border-top:1px solid #302019;border-bottom:1px solid #302019}.p2ex-chart-empty,.p2ex-empty{display:grid;min-height:240px;place-items:center;color:#806d64;font-size:13px}.p2ex-filters{display:grid;grid-template-columns:minmax(180px,1fr) 190px 190px;gap:8px}.p2ex-filters label{display:grid;gap:5px}.p2ex-filters input,.p2ex-filters select{min-width:0;padding:8px;border:1px solid #513022;border-radius:5px;background:#110b09;color:#e1ccc2}.p2ex-table-wrap{overflow:auto;border:1px solid #302019;border-radius:5px}.p2ex-table-wrap table{width:100%;border-collapse:collapse;white-space:nowrap}.p2ex-table-wrap th{padding:8px 10px;background:#160f0c;color:#8f786e;font-size:10px;letter-spacing:.08em;text-align:right;text-transform:uppercase}.p2ex-table-wrap th:first-child,.p2ex-table-wrap td:first-child{text-align:left}.p2ex-table-wrap td{padding:9px 10px;border-top:1px solid #2b1d17;color:#d5beb3;font-size:12px;text-align:right}.p2ex-table-wrap tbody tr{cursor:pointer}.p2ex-table-wrap tbody tr:hover,.p2ex-table-wrap tbody tr.selected{background:#21130e}.p2ex-table-wrap td strong{display:block;color:#e5d1c7}.p2ex-table-wrap td small{display:block;margin-top:2px;color:#78675f;font-size:10px}.p2ex-routes header{display:flex;align-items:end;justify-content:space-between;gap:18px}.p2ex-routes header p{max-width:620px;text-align:right}.p2ex-no-rows{padding:24px;color:#806d64;font-size:12px;text-align:center}.gain{color:#79bd72!important}.loss{color:#dc716c!important}@media(max-width:980px){.p2ex-head{align-items:stretch;flex-direction:column}.p2ex-kpis{grid-template-columns:repeat(4,1fr)}.p2ex-filters{grid-template-columns:1fr 1fr}.p2ex-filters label:first-child{grid-column:1/-1}}@media(max-width:680px){.p2ex-kpis{grid-template-columns:1fr 1fr}.p2ex-chart-head,.p2ex-routes header{align-items:stretch;flex-direction:column}.p2ex-move,.p2ex-routes header p{text-align:left}.p2ex-tools{align-items:flex-start;flex-direction:column}.p2ex-filters{grid-template-columns:1fr}.p2ex-filters label:first-child{grid-column:auto}}
.p2ex-overview{display:grid;gap:12px;padding:18px;border:1px solid #5b3020;border-radius:8px;background:radial-gradient(circle at 88% 0,#2c150e 0,transparent 30%),#100b09}.p2ex-overview-head{display:flex;align-items:end;justify-content:space-between;gap:22px}.p2ex-overview-head>div>span,.p2ex-signal-panel header>span{color:#d56e44;font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.p2ex-overview-head h2{margin:4px 0;color:#f0ded5;font-size:23px}.p2ex-overview-head p{max-width:720px;margin:0;color:#9c867c;font-size:12.5px}.p2ex-overview-head dl{display:flex;gap:18px;margin:0}.p2ex-overview-head dl div{display:grid;gap:3px;text-align:right}.p2ex-overview-head dt{color:#806c63;font-size:9px;text-transform:uppercase}.p2ex-overview-head dd{margin:0;color:#e0c9be;font-size:15px;font-weight:700}.p2ex-signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.p2ex-signal-panel{min-width:0;overflow:hidden;border:1px solid #3c281f;border-radius:7px;background:#120d0b}.p2ex-signal-panel header{display:grid;gap:3px;padding:13px 14px;border-bottom:1px solid #302019}.p2ex-signal-panel h3{margin:0;color:#e5d1c7;font-size:16px}.p2ex-signal-panel header p{margin:0;color:#826e65;font-size:10.5px;line-height:1.35}.p2ex-signal-list{display:grid}.p2ex-signal-list button{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:8px;padding:9px 11px;border:0;border-bottom:1px solid #281b16;background:transparent;color:inherit;text-align:left;cursor:pointer}.p2ex-signal-list button:last-child{border-bottom:0}.p2ex-signal-list button:hover{background:#21130e}.p2ex-signal-list button>em{color:#765b4e;font-size:10px;font-style:normal}.p2ex-signal-list button>span{display:grid;min-width:0;gap:2px}.p2ex-signal-list strong{overflow:hidden;color:#dbc5ba;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.p2ex-signal-list small{overflow:hidden;color:#78665e;font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}.p2ex-signal-list b{color:#d9b6a5;font-size:12px;white-space:nowrap}.p2ex-signal-empty{padding:20px 14px;color:#78665e;font-size:11px;text-align:center}@media(max-width:900px){.p2ex-overview-head{align-items:stretch;flex-direction:column}.p2ex-overview-head dl{justify-content:space-between}.p2ex-overview-head dl div{text-align:left}}@media(max-width:680px){.p2ex-signal-grid{grid-template-columns:1fr}.p2ex-overview-head dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}}
.p2ex-workbench{display:grid;gap:14px;padding:18px;border:1px solid #654029;border-radius:8px;background:linear-gradient(120deg,#17100c,#100b09)}.p2ex-workbench-head{display:flex;align-items:end;justify-content:space-between;gap:20px}.p2ex-workbench-head>div:first-child>span,.p2ex-planner-controls label>span,.p2ex-planner-controls legend,.p2ex-flow span,.p2ex-brief-grid span{color:#bd6846;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.p2ex-workbench h2{margin:4px 0;color:#f0ded5;font-size:22px}.p2ex-workbench-head p{max-width:760px;margin:0;color:#927d73;font-size:12px}.p2ex-flow{display:grid;flex:0 0 auto;gap:4px;padding:10px 12px;border:1px solid #493126;border-radius:6px;background:#100b09;text-align:right}.p2ex-flow strong{color:#d9beb1;font-size:13px}.p2ex-flow.fits{border-color:#365a39}.p2ex-flow.fits strong{color:#79bd72}.p2ex-flow.large{border-color:#6a3830}.p2ex-flow.large strong{color:#dc716c}.p2ex-planner-controls{display:flex;align-items:end;gap:10px}.p2ex-planner-controls label{display:grid;gap:5px}.p2ex-planner-controls input{width:160px;padding:8px;border:1px solid #633b29;border-radius:5px;background:#0f0a08;color:#ead5cb}.p2ex-planner-controls fieldset{display:flex;gap:5px;margin:0;padding:0;border:0}.p2ex-planner-controls legend{margin-bottom:5px}.p2ex-planner-controls button{padding:8px 11px;border:1px solid #493026;border-radius:5px;background:#130d0a;color:#9e867b;cursor:pointer}.p2ex-planner-controls button.on{border-color:#a55332;background:#2a160f;color:#efb59d}.p2ex-brief-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.p2ex-brief-grid article{display:grid;min-width:0;gap:4px;padding:11px 12px;border:1px solid #38271f;border-radius:6px;background:#100b09}.p2ex-brief-grid strong{overflow:hidden;color:#e3cec3;font-size:17px;text-overflow:ellipsis;white-space:nowrap}.p2ex-brief-grid small{overflow:hidden;color:#7f6b62;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.p2ex-planner-note{margin:0;color:#76645c;font-size:10.5px}@media(max-width:800px){.p2ex-workbench-head{align-items:stretch;flex-direction:column}.p2ex-flow{text-align:left}.p2ex-brief-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.p2ex-planner-controls{align-items:stretch;flex-direction:column}.p2ex-planner-controls input{box-sizing:border-box;width:100%}.p2ex-planner-controls fieldset{display:grid;grid-template-columns:repeat(4,1fr)}.p2ex-brief-grid{grid-template-columns:1fr}}
.p2ex-route-workspace{display:grid;grid-template-columns:minmax(340px,400px) minmax(0,1fr);align-items:start;gap:14px}.p2ex-router{display:grid;min-width:0;gap:14px;padding:20px;border:1px solid #6d3a25;border-radius:8px;background:radial-gradient(circle at 90% 0,#2d160f 0,transparent 30%),#100b09}.p2ex-router-head{display:flex;align-items:end;justify-content:space-between;gap:20px}.p2ex-router-head>div:first-child>span,.p2ex-router-controls span,.p2ex-recommendation>div>span,.p2ex-route-leaders>span{color:#d56e44;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2ex-router-head h2{margin:4px 0;color:#f0ded5;font-size:25px}.p2ex-router-head p{max-width:760px;margin:0;color:#9c867c;font-size:12.5px}.p2ex-side-switch{display:flex;flex:0 0 auto;padding:3px;border:1px solid #513022;border-radius:6px;background:#0e0907}.p2ex-side-switch button{padding:8px 12px;border:0;border-radius:4px;background:transparent;color:#927970;cursor:pointer}.p2ex-side-switch button.on{background:#7b321e;color:#ffe0d2}.p2ex-router-controls{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr));gap:8px}.p2ex-router-controls label{display:grid;align-content:start;gap:5px}.p2ex-router-controls label>small{color:#79685f;font-size:9px}.p2ex-router-controls input,.p2ex-router-controls select{box-sizing:border-box;width:100%;min-width:0;padding:9px;border:1px solid #553224;border-radius:5px;background:#100a08;color:#e4cec3}.p2ex-recommendation{position:relative;display:grid;grid-template-columns:minmax(260px,1fr) 1.3fr;gap:16px;padding:15px;border:1px solid #41603e;border-radius:7px;background:linear-gradient(100deg,#142017,#100c09)}.p2ex-recommendation>div{display:grid;align-content:center;gap:4px}.p2ex-recommendation>div>strong{color:#93d08b;font-size:22px}.p2ex-recommendation small{color:#8a796f;font-size:11px}.p2ex-recommendation dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0}.p2ex-recommendation dl div{display:grid;align-content:center;gap:4px;padding:9px 10px;border-left:1px solid #30402e}.p2ex-recommendation dt{color:#7f7168;font-size:9px;text-transform:uppercase}.p2ex-recommendation dd{margin:0;color:#dfc9be;font-size:14px;font-weight:700}.p2ex-comparison{padding-right:122px;border-color:#79503a;background:linear-gradient(100deg,#21150f,#100c09)}.p2ex-comparison>div>strong{color:#e2ad8e}.p2ex-comparison-clear{position:absolute;top:10px;right:10px;padding:6px 8px;border:1px solid #5b3929;border-radius:4px;background:#160e0b;color:#9d7f71;cursor:pointer;font-size:9px}.p2ex-comparison-clear:hover{border-color:#9b5437;color:#efb59d}.p2ex-route-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:10px}.p2ex-route-table tr.recommended{background:#152016}.p2ex-route-table tr.recommended td:first-child strong{color:#91c98b}.p2ex-route-table tr.comparison{box-shadow:inset 3px 0 #c87951;background:#26150f}.p2ex-route-pick{display:grid;width:100%;min-width:0;gap:2px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}.p2ex-route-pick:hover strong{color:#efb59d}.p2ex-route-more{display:block;width:100%;padding:11px;border:0;border-top:1px solid #3a281f;background:#160f0c;color:#d99b80;cursor:pointer;font-size:11px;font-weight:700;text-align:center}.p2ex-route-more:hover{background:#21140f;color:#efb59d}.p2ex-route-more span{color:#806d64;font-weight:400}.p2ex-route-leaders{display:grid;align-content:start;overflow:hidden;border:1px solid #3a281f;border-radius:6px;background:#110c0a}.p2ex-route-leaders>span,.p2ex-route-leaders>p{padding:0 12px}.p2ex-route-leaders>span{padding-top:12px}.p2ex-route-leaders>p{margin:4px 0 9px;color:#806d64;font-size:10px}.p2ex-route-leaders>button{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border:0;border-top:1px solid #2b1d17;background:transparent;color:inherit;text-align:left;cursor:pointer}.p2ex-route-leaders>button:hover{background:#20130e}.p2ex-route-leaders>button>span{display:grid;min-width:0;gap:2px}.p2ex-route-leaders strong{overflow:hidden;color:#dbc5ba;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.p2ex-route-leaders small{color:#76645c;font-size:9px}.p2ex-route-leaders b{color:#e3a486;font-size:11px}.p2ex-router-note{margin:0;color:#77665e;font-size:10.5px}@media(max-width:980px){.p2ex-router-controls{grid-template-columns:1fr 1fr}.p2ex-route-layout{grid-template-columns:1fr}.p2ex-route-leaders{grid-template-columns:repeat(2,minmax(0,1fr))}.p2ex-route-leaders>span,.p2ex-route-leaders>p{grid-column:1/-1}}@media(max-width:780px){.p2ex-route-workspace{grid-template-columns:1fr}.p2ex-route-workspace>.p2mb-browser.sticky{position:static}}@media(max-width:720px){.p2ex-router-head{align-items:stretch;flex-direction:column}.p2ex-side-switch{align-self:flex-start}.p2ex-router-controls{grid-template-columns:1fr}.p2ex-recommendation{grid-template-columns:1fr}.p2ex-comparison{padding-right:15px;padding-top:48px}.p2ex-recommendation dl{grid-template-columns:1fr}.p2ex-recommendation dl div{border-top:1px solid #30402e;border-left:0}.p2ex-route-leaders{grid-template-columns:1fr}.p2ex-route-leaders>span,.p2ex-route-leaders>p{grid-column:auto}}
.p2ex-route-legend{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #493025;border-radius:5px;background:#140e0b}
.p2ex-route-legend>span{flex:0 0 auto;padding:3px 6px;border:1px solid #9a5034;border-radius:3px;background:#2b160f;color:#efad90;font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.p2ex-route-legend p{margin:0;color:#8f786e;font-size:10px}
.p2ex-route-layout{grid-template-columns:minmax(0,1fr)}
.p2ex-route-name{display:flex;align-items:center;gap:7px;min-width:0}
.p2ex-route-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p2ex-route-name em{flex:0 0 auto;padding:2px 5px;border:1px solid #8d4b34;border-radius:3px;background:#2a160f;color:#e69c7d;font-size:7.5px;font-style:normal;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.p2ex-route-table tr.core:not(.recommended):not(.comparison){box-shadow:inset 2px 0 #74402d}
.p2ex-route-leaders{grid-template-columns:repeat(2,minmax(0,1fr))}
.p2ex-route-leaders>span,.p2ex-route-leaders>p{grid-column:1/-1}
@media(max-width:720px){.p2ex-route-leaders{grid-template-columns:1fr}.p2ex-route-leaders>span,.p2ex-route-leaders>p{grid-column:auto}}
.p2ex-market-picker{position:sticky;top:12px;min-width:0}.p2ex-market-picker-toggle{display:none}.p2ex-market-picker-body>.p2mb-browser{width:100%}.p2ex-router-controls{grid-template-columns:repeat(4,minmax(120px,1fr))}.p2ex-confidence{display:block;width:max-content;max-width:100%;margin-top:4px;padding:4px 7px;border:1px solid #3d503a;border-radius:4px;color:#91c98b;font-size:9px;font-style:normal;line-height:1.3}.p2ex-confidence.medium{border-color:#6b522d;color:#d0a565}.p2ex-confidence.low{border-color:#71372f;color:#de756b}.p2ex-router-note strong{color:#d2a563}.p2ex-scanner-head{display:flex;align-items:end;justify-content:space-between;gap:18px}.p2ex-scanner-head>div>span{color:#d56e44;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2ex-scanner-head h3{margin:4px 0;color:#ead5cb;font-size:20px}.p2ex-scanner-head p{max-width:760px;margin:0;color:#8e776d;font-size:11px}.p2ex-scanner-head>strong{flex:0 0 auto;color:#d9b6a5;font-size:13px}.p2ex-filters{grid-template-columns:minmax(180px,1fr) repeat(3,minmax(150px,190px))}.p2ex-gap.high{color:#79bd72}.p2ex-gap.medium{color:#d2a563}.p2ex-gap.low{color:#dc716c}.p2ex-gap small{font-weight:400}.p2ex-table-wrap th:last-child,.p2ex-table-wrap td:last-child{padding-right:14px}
@media(max-width:1100px){.p2ex-router-controls,.p2ex-filters{grid-template-columns:1fr 1fr}.p2ex-filters label:first-child{grid-column:1/-1}}
@media(max-width:780px){.p2ex-market-picker{position:static}.p2ex-market-picker.collapsed{position:sticky;top:0;z-index:5}.p2ex-market-picker-toggle{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px 12px;padding:11px 12px;border:1px solid #4a2b20;border-radius:7px;background:rgba(17,12,10,.96);box-shadow:0 9px 24px #0008;backdrop-filter:blur(4px)}.p2ex-market-picker-toggle span{color:#9b6b56;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase}.p2ex-market-picker-toggle strong{overflow:hidden;color:#dfc9be;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.p2ex-market-picker-toggle button{grid-column:2;grid-row:1/3;padding:7px 9px;border:1px solid #633b29;border-radius:4px;background:#21130e;color:#d99b80;cursor:pointer}.p2ex-market-picker-body{margin-top:7px}.p2ex-market-picker.collapsed .p2ex-market-picker-body{display:none}.p2ex-router{scroll-margin-top:62px}}
@media(max-width:680px){.p2ex-router-controls,.p2ex-filters{grid-template-columns:1fr}.p2ex-filters label:first-child{grid-column:auto}.p2ex-scanner-head{align-items:flex-start;flex-direction:column}.p2ex-scanner-head>strong{align-self:flex-start}}
`;
