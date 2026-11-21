import { useEffect, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { fmtPrice } from "../pricing/money.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { threadPriceRows } from "./threadMovers.js";
import ThreadPriceChart from "./ThreadPriceChart.jsx";
import "./popularThreads.css";

export default function PopularThreads({ priceUrl, historyUrl, currency, window, setWindow, stale }) {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState(null);
  const [filter, setFilter] = useState("all");
  const [openThread, setOpenThread] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    loadDocument(priceUrl, { supported: POE1_SCHEMA_VERSIONS, required: requiredFields("threads") }).then((result) => {
      if (!cancelled) setSnapshot(isUsable(result) ? result.data : "missing");
    });
    return () => { cancelled = true; };
  }, [priceUrl]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setHistory(null);
    loadDocument(historyUrl, { supported: POE1_SCHEMA_VERSIONS, required: ["points"], signal: controller.signal }).then((result) => {
      if (!cancelled) setHistory(isUsable(result) && Array.isArray(result.data.points) ? result.data : "missing");
    });
    return () => { cancelled = true; controller.abort(); };
  }, [historyUrl]);
  const rows = threadPriceRows(snapshot?.items, window);
  const quoted = rows.filter((item) => item.price !== null).length;
  const measured = rows.filter((item) => item.movement !== null).length;
  const visible = rows.filter((item) => filter === "all" || (item.movement !== null && (filter === "rising" ? item.movement > 0 : item.movement < 0)));
  const historical = stale || freshness(snapshot?.generatedAt).level !== "fresh";
  const rate = snapshot?.divineRate;
  return <section className="popular-threads" aria-label="Thread price movers">
    <header>
      <div><h2>Thread prices</h2><p>Highest price first. Changes are measured in Chaos. A higher entry cost doesn’t tell you what the mechanic pays out.</p></div>
      <div className="app-segmented" role="group" aria-label="Thread price window">
        {CHANGE_WINDOW_OPTIONS.map((option) => <button type="button" key={option} className={option === window ? "on" : ""}
          aria-pressed={option === window} onClick={() => setWindow(option)}>{option}</button>)}
      </div>
    </header>
    <SourceStrip>{snapshot === null ? "Loading Thread prices…"
      : !quoted ? "No Thread quotes in this league’s available snapshots yet."
      : <>{historical ? "Historical snapshot" : "Thread snapshot"} · {new Date(snapshot.generatedAt).toLocaleString()}
        {snapshot.priceSource && ` · ${snapshot.priceSource}`} · {measured}/{quoted} priced Threads with a comparable {window} observation</>}</SourceStrip>
    <div className="app-segmented" role="group" aria-label="Filter Thread prices">
      {[["all", "All Threads"], ["rising", "Rising"], ["falling", "Falling"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? "on" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    <p className="thread-timeline-caption">{window} price history · Chaos · hover or drag to inspect. Select a graph to expand it. Shaded areas have no snapshots.</p>
    <ol className="popular-threads-list" aria-label="Thread prices and movement">
      {visible.map((item) => <li key={item.id}>
        <strong>{item.name}</strong>
        <div className="thread-timeline-wrap"><ThreadPriceChart key={window} history={history} name={item.name} window={window}
          compact expanded={openThread === item.name} onInspect={() => setOpenThread(openThread === item.name ? null : item.name)} /></div>
        <span className="thread-current-price">{item.price === null ? "Awaiting quote" : fmtPrice(item.price, rate > 0 ? currency : "chaos", rate)}</span>
        <b className={`thread-price-move ${item.movement < 0 ? "falling" : item.movement > 0 ? "rising" : "unmeasured"}`}>{item.movement === null ? "No comparison" : `${item.movement > 0 ? "+" : ""}${item.movement.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</b>
        {openThread === item.name && <div className="thread-history-panel">
          <header><strong>{item.name} · {window} price history</strong>
            <button type="button" onClick={(event) => {
              event.currentTarget.closest("li").querySelector(".thread-chart--compact .thread-chart-surface")?.focus();
              setOpenThread(null);
            }} aria-label={`Close ${item.name} price history`}>Close</button>
          </header>
          <ThreadPriceChart key={window} history={history} name={item.name} window={window} />
        </div>}
      </li>)}
    </ol>
    {!visible.length && <p>No Threads {filter === "rising" ? "rose" : "fell"} over the selected {window} window.</p>}
    {quoted > 0 && !measured && <p>Current prices are shown above. Waiting for comparable {window} history; missing comparisons are not treated as zero movement.</p>}
  </section>;
}
