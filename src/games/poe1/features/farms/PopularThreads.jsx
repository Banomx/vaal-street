import { useEffect, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { fmtPrice } from "../pricing/money.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { threadPriceRows } from "./threadMovers.js";
import "./popularThreads.css";

export default function PopularThreads({ priceUrl, currency, window, setWindow, stale }) {
  const [snapshot, setSnapshot] = useState(null);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    loadDocument(priceUrl, { supported: POE1_SCHEMA_VERSIONS, required: requiredFields("threads") }).then((result) => {
      if (!cancelled) setSnapshot(isUsable(result) ? result.data : "missing");
    });
    return () => { cancelled = true; };
  }, [priceUrl]);
  const rows = threadPriceRows(snapshot?.items, window);
  const quoted = rows.filter((item) => item.price !== null).length;
  const measured = rows.filter((item) => item.movement !== null).length;
  const visible = rows.filter((item) => filter === "all" || (item.movement !== null && (filter === "rising" ? item.movement > 0 : item.movement < 0)))
    .sort((a, b) => filter === "falling" ? a.movement - b.movement : 0);
  const historical = stale || freshness(snapshot?.generatedAt).level !== "fresh";
  const rate = snapshot?.divineRate;
  return <section className="popular-threads" aria-label="Thread price movers">
    <header>
      <div><h2>Thread prices</h2><p>All ten mechanic Threads, with rising prices first. Changes are measured in Chaos. A higher entry cost doesn’t tell you what the mechanic pays out.</p></div>
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
    <ol className="popular-threads-list" aria-label="Thread prices and movement">
      {visible.map((item) => <li key={item.id}>
        <strong>{item.name}</strong>
        <span>{item.price === null ? "Awaiting quote" : fmtPrice(item.price, rate > 0 ? currency : "chaos", rate)}</span>
        <b className={item.movement < 0 ? "falling" : item.movement > 0 ? "rising" : "unmeasured"}>{item.movement === null ? "No comparison" : `${item.movement > 0 ? "+" : ""}${item.movement.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</b>
      </li>)}
    </ol>
    {!visible.length && <p>No Threads {filter === "rising" ? "rose" : "fell"} over the selected {window} window.</p>}
    {quoted > 0 && !measured && <p>Current prices are shown above. Waiting for comparable {window} history; missing comparisons are not treated as zero movement.</p>}
  </section>;
}
