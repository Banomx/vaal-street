import { useMemo } from "react";
import { TimePriceChart } from "../pricing/PriceChart.jsx";
import { threadTimeline } from "./threadMovers.js";

export default function ThreadPriceChart({ history, name, window, compact = false, expanded, onInspect }) {
  const timeline = useMemo(() => threadTimeline(history, name, window), [history, name, window]);
  const empty = history === null ? "Loading history…" : history === "missing" ? "History unavailable" : `No ${window} observations`;
  const label = `${name}, ${window} price history in Chaos`;
  const chart = <TimePriceChart timeline={timeline} label={label} compact={compact} empty={empty} />;
  return <div className={`thread-chart ${compact ? "thread-chart--compact" : "thread-chart--detail"}`}>
    {compact && timeline.points.length ? <div className="thread-chart-surface" role="button" tabIndex={0}
      aria-label={`Inspect ${name} · ${window} price history`} aria-expanded={expanded}
      onClick={onInspect} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onInspect(); }
      }}>{chart}</div> : chart}
  </div>;
}
