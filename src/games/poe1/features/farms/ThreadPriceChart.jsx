import { useEffect, useId, useMemo, useRef, useState } from "react";
import { threadChartCursor, threadTimeline } from "./threadMovers.js";

const quote = (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}c`;
const timeLabel = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateLabel = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function ThreadPriceChart({ history, name, window, compact = false, expanded, onInspect }) {
  const timeline = useMemo(() => threadTimeline(history, name, window), [history, name, window]);
  const [selection, setSelection] = useState(null);
  const [keyboard, setKeyboard] = useState(false);
  const tooltipId = useId();
  const helpId = useId();
  const { points, segments, gaps, start, end } = timeline;
  const surfaceRef = useRef(null);
  const [width, setWidth] = useState(640);
  const hasPoints = points.length > 0;
  useEffect(() => {
    if (!surfaceRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(surfaceRef.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!points.length) return <span className="thread-timeline-empty">{
    history === null ? "Loading history…" : history === "missing" ? "History unavailable" : `No ${window} observations`
  }</span>;

  const height = compact ? 32 : 210;
  const left = compact ? 6 : 58, right = compact ? 6 : 18;
  const top = compact ? 5 : 16, bottom = compact ? 5 : 32;
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  const padding = high === low ? Math.max(high * 0.05, 0.001) : (high - low) * 0.12;
  const min = Math.max(0, low - padding), max = high + padding;
  const x = (t) => left + (t - start) / (end - start) * (width - left - right);
  const y = (value) => height - bottom - (value - min) / (max - min) * (height - top - bottom);
  const colour = points.at(-1).value > points[0].value ? "#a5d4a0"
    : points.at(-1).value < points[0].value ? "#ffaaa2" : "#d4c5ba";
  const selectedPoint = selection?.point;
  const selectedX = selectedPoint ? x(selectedPoint.t)
    : selection?.gap ? x((selection.gap.start + selection.gap.end) / 2) : width / 2;
  const summary = `${name}, ${window} price history in Chaos. ${points.length} recorded prices. Range ${quote(low)} to ${quote(high)}.`;
  const ticks = width < 420 ? [start, end] : [start, (start + end) / 2, end];
  const axisQuote = (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: high < 1 ? 3 : 2 })}c`;
  const selectionText = selection?.gap
    ? `Missing snapshots · ${dateLabel(selection.gap.start)} – ${dateLabel(selection.gap.end)}. No recorded prices in this interval.`
    : selectedPoint ? `${quote(selectedPoint.value)} · ${dateLabel(selectedPoint.t)}` : "";
  const inspectPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * width - left) / (width - left - right)));
    setKeyboard(false);
    setSelection(threadChartCursor(timeline, start + position * (end - start)));
  };
  const inspectKey = (event) => {
    if (event.key === "Escape") { setSelection(null); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = selection?.index ?? points.length - 1;
    const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
    setKeyboard(true);
    setSelection({ point: points[index], index });
  };
  const Surface = compact ? "button" : "div";
  return <div className={`thread-chart ${compact ? "thread-chart--compact" : "thread-chart--detail"}`}>
    <Surface ref={surfaceRef} type={compact ? "button" : undefined} className="thread-chart-surface"
      role={compact ? undefined : "group"} tabIndex={0}
      aria-label={compact ? `Inspect ${name} · ${window} price history` : summary}
      aria-expanded={compact ? expanded : undefined}
      aria-describedby={`${helpId}${selection ? ` ${tooltipId}` : ""}`}
      onClick={compact ? onInspect : undefined}
      onPointerMove={inspectPointer} onPointerDown={inspectPointer}
      onPointerLeave={(event) => { if (event.pointerType === "mouse" && !keyboard) setSelection(null); }}
      onFocus={(event) => {
        if (!event.currentTarget.matches(":focus-visible")) return;
        setKeyboard(true);
        setSelection({ point: points.at(-1), index: points.length - 1 });
      }}
      onBlur={() => setSelection(null)} onKeyDown={inspectKey}>
      <svg className="thread-timeline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <title>{summary}</title>
        {(compact ? [(min + max) / 2] : [min, (min + max) / 2, max]).map((value) => <g key={value}>
          <path className="thread-timeline-guide" d={`M${left},${y(value)} H${width - right}`} />
          {!compact && <text className="thread-chart-axis" x={left - 9} y={y(value) + 4} textAnchor="end">{axisQuote(value)}</text>}
        </g>)}
        {gaps.map((gap) => <rect key={gap.start} className="thread-chart-gap"
          x={x(gap.start)} y={top} width={Math.max(0, x(gap.end) - x(gap.start))} height={height - top - bottom} />)}
        {segments.map((segment) => <path key={segment[0].t}
          d={segment.map((point, index) => `${index ? "L" : "M"}${x(point.t).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ")}
          fill="none" stroke={colour} strokeWidth={compact ? "1.7" : "2"} vectorEffect="non-scaling-stroke" />)}
        {points.map((point) => <circle key={point.t} cx={x(point.t)} cy={y(point.value)} r={compact ? "1.4" : "2.6"} fill={colour} />)}
        {selection && <path className="thread-chart-crosshair" d={`M${selectedX},${top} V${height - bottom}`} />}
        {selectedPoint && <circle className="thread-chart-selected" cx={selectedX} cy={y(selectedPoint.value)} r={compact ? "3" : "4"} fill={colour} />}
        {!compact && ticks.map((t, index) => <text key={t} className="thread-chart-axis"
          x={x(t)} y={height - 8} textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}>{parseInt(window, 10) >= 24 ? dateLabel(t) : timeLabel(t)}</text>)}
      </svg>
    </Surface>
    <span id={helpId} className="thread-chart-sr">Hover or drag to inspect prices. Left and right arrow keys step through observations. {compact && "Press Enter to expand."}</span>
    {selection && <div id={tooltipId} role="tooltip" aria-live={keyboard ? "polite" : "off"}
      className={`thread-chart-tooltip${selection.gap ? " thread-chart-tooltip--gap" : ""}`}
      style={{ left: `${Math.max(25, Math.min(75, selectedX / width * 100))}%` }}>
      {selectionText}
    </div>}
    {!compact && <div className="thread-chart-meta">
      <span><strong>{points.length}</strong> recorded prices</span>
      <span>Low <strong>{quote(low)}</strong> · High <strong>{quote(high)}</strong></span>
      <span>{dateLabel(start)} – {dateLabel(end)}</span>
      {points.length === 1 && <span>One observation; trend unavailable.</span>}
      {gaps.length > 0 && <span><i className="thread-chart-gap-key" /> Shaded areas have no snapshots</span>}
    </div>}
  </div>;
}
