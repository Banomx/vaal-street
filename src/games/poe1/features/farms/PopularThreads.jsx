import { useEffect, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { fmtPrice } from "../pricing/money.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { threadMovers } from "./threadMovers.js";
import "./popularThreads.css";

export default function PopularThreads({ priceUrl, currency, window, setWindow, stale }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    loadDocument(priceUrl, { supported: POE1_SCHEMA_VERSIONS, required: requiredFields("threads") }).then((result) => {
      if (!cancelled) setSnapshot(isUsable(result) ? result.data : "missing");
    });
    return () => { cancelled = true; };
  }, [priceUrl]);
  const { quoted, measured, rising } = threadMovers(snapshot?.items, window);
  const historical = stale || freshness(snapshot?.generatedAt).level !== "fresh";
  const rate = snapshot?.divineRate;
  return <section className="popular-threads" aria-label="Thread price movers">
    <header>
      <div><h2>Rising Threads</h2><p>Biggest increases in Thread prices measured in Chaos. A higher entry cost doesn’t tell you what the mechanic pays out.</p></div>
      <div className="app-segmented" role="group" aria-label="Thread price window">
        {CHANGE_WINDOW_OPTIONS.map((option) => <button type="button" key={option} className={option === window ? "on" : ""}
          aria-pressed={option === window} onClick={() => setWindow(option)}>{option}</button>)}
      </div>
    </header>
    <SourceStrip>{snapshot === null ? "Loading Thread prices…"
      : !quoted ? "No Thread quotes in this league’s available snapshots yet."
      : <>{historical ? "Historical snapshot" : "Thread snapshot"} · {new Date(snapshot.generatedAt).toLocaleString()}
        {snapshot.priceSource && ` · ${snapshot.priceSource}`} · {measured}/{quoted} priced Threads with a comparable {window} observation</>}</SourceStrip>
    {rising.length > 0 ? <ol className="popular-threads-list">
      {rising.map((item) => <li key={item.key || item.name}>
        <strong>{item.name}</strong>
        <span>{fmtPrice(item.chaosValue, rate > 0 ? currency : "chaos", rate)}</span>
        <b>+{item.movement.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</b>
      </li>)}
    </ol> : quoted > 0 && <p>{measured ? `No Threads rose over the selected ${window} window.` : `Waiting for comparable ${window} price history. First quotes don’t count as gains.`}</p>}
  </section>;
}
