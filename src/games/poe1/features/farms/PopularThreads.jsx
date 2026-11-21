import { useEffect, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { fmtPrice } from "../pricing/money.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { threadPriceRows, threadTimeline } from "./threadMovers.js";
import "./popularThreads.css";

function ThreadTimeline({ history, name }) {
  const { points, segments, start, end } = threadTimeline(history, name);
  if (points.length < 2) return <span className="thread-timeline-empty">{
    history === null ? "Loading history…" : history === "missing" ? "History unavailable" : "Not enough 48h history"
  }</span>;
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  const x = (point) => 4 + (point.t - start) / (end - start) * 312;
  const y = (point) => high === low ? 16 : 27 - (point.value - low) / (high - low) * 22;
  const colour = points.at(-1).value > points[0].value ? "#a5d4a0"
    : points.at(-1).value < points[0].value ? "#ffaaa2" : "#d4c5ba";
  const quote = (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}c`;
  const title = `${name}: 48h price history in Chaos, ending ${new Date(end).toLocaleString()}. ${points.length} observations; ${quote(points[0].value)} → ${quote(points.at(-1).value)}. Range ${quote(low)}–${quote(high)}. Gaps mean missing observations.`;
  return <svg className="thread-timeline" viewBox="0 0 320 32" preserveAspectRatio="none"
    role="img" tabIndex={0} aria-label={title}>
    <title>{title}</title>
    <path className="thread-timeline-guide" d="M4,16 H316" />
    {segments.map((segment) => <path key={segment[0].t}
      d={segment.map((point, index) => `${index ? "L" : "M"}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(" ")}
      fill="none" stroke={colour} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />)}
    {points.map((point) => <g key={point.t}>
      <circle cx={x(point)} cy={y(point)} r="1.4" fill={colour} />
      <circle cx={x(point)} cy={y(point)} r="5" fill="transparent">
        <title>{new Date(point.t).toLocaleString()} · {quote(point.value)}</title>
      </circle>
    </g>)}
  </svg>;
}

export default function PopularThreads({ priceUrl, historyUrl, currency, window, setWindow, stale }) {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState(null);
  const [filter, setFilter] = useState("all");
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
    <p className="thread-timeline-caption">48h price history · Chaos · ending at the latest recorded snapshot. Hover a point for its time and price; gaps show missing observations.</p>
    <ol className="popular-threads-list" aria-label="Thread prices and movement">
      {visible.map((item) => <li key={item.id}>
        <strong>{item.name}</strong>
        <div className="thread-timeline-wrap"><ThreadTimeline history={history} name={item.name} /></div>
        <span className="thread-current-price">{item.price === null ? "Awaiting quote" : fmtPrice(item.price, rate > 0 ? currency : "chaos", rate)}</span>
        <b className={`thread-price-move ${item.movement < 0 ? "falling" : item.movement > 0 ? "rising" : "unmeasured"}`}>{item.movement === null ? "No comparison" : `${item.movement > 0 ? "+" : ""}${item.movement.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</b>
      </li>)}
    </ol>
    {!visible.length && <p>No Threads {filter === "rising" ? "rose" : "fell"} over the selected {window} window.</p>}
    {quoted > 0 && !measured && <p>Current prices are shown above. Waiting for comparable {window} history; missing comparisons are not treated as zero movement.</p>}
  </section>;
}
