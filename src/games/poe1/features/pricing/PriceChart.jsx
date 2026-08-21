import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceDot, ReferenceArea,
} from "recharts";
import { fmtChaos, fmtDiv } from "./money.js";

/* ================================================================
   SHARED PRICE CHART
   ----------------------------------------------------------------
   One graph, several callers: the mechanic panel's set total, the
   category tabs (astrolabes, catalysts), the Delve fossil list, a
   biome's value over time, and a saved strategy's setup cost. They
   differ only in what the series means, so they differ only in props.

   Everything is fed in already scaled to one unit. A chart has one y
   axis, so mixing chaos and divine down it would make the line
   meaningless — the caller picks the unit for the whole series with
   unitForSeries() and hands over `cur`.

   Each row is:
     { day, value, chaos, rate, overlay? }
   `value` is plotted; `chaos` is the same point UNSCALED, because the
   divine-adjusted maths has to divide by the rate that applied on that
   day rather than today's; `rate` is chaos-per-divine on that day;
   `overlay` is the optional second series (one scarab against its set
   total, one fossil against its biome).
   ================================================================ */

export function fmtDay(d) { const n = Math.round(d * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); }

/* Whole-day hardpoints, always: domain snaps outward to full days (day 0,
   day 1, ...) and every hourly data point still plots at its true position. */
export function dayAxis(rows) {
  if (!rows || !rows.length) return { domain: [0, 1], ticks: [0, 1] };
  const min = Math.floor(rows[0].day);
  const max = Math.max(Math.ceil(rows[rows.length - 1].day), min + 1);
  const step = Math.max(1, Math.ceil((max - min) / 14)); // cap tick count on long leagues
  const ticks = [];
  for (let d = min; d <= max; d += step) ticks.push(d);
  return { domain: [min, max], ticks };
}

/* ---- divine-rate helpers ----
   The rate series shares its x axis with the price history, so "what did a
   divine cost on day d" is a nearest-point lookup. */
export function rateAt(series, day) {
  if (!series || !series.length) return null;
  let best = series[0];
  for (const p of series) if (Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
  return best.rate;
}

/* Change measured in divine instead of chaos: what's left after the chaos
   drift between the two ends of the window is taken out. */
export function realPct(v1, r1, v2, r2) {
  if (!(v1 > 0) || !(v2 > 0) || !(r1 > 0) || !(r2 > 0)) return null;
  return ((v2 / r2) / (v1 / r1) - 1) * 100;
}

export function fmtRate(v) { return v >= 1000 ? `${(v / 1000).toFixed(2)}k` : Math.round(v).toString(); }

export function PctBadge({ v, real }) {
  if (v == null || !isFinite(v)) return <span className="st-pct flat">—</span>;
  const cls = v > 0.5 ? "up" : v < -0.5 ? "down" : "flat";
  const arrow = v > 0.5 ? "▲" : v < -0.5 ? "▼" : "•";
  return (
    <span className={`st-pct ${cls}${real ? " real" : ""}`}
      title={real ? "Divine-adjusted: the move after chaos drift is taken out" : undefined}>
      {arrow} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/* The list-sized version of the same idea: no axes, no tooltip, just the
   shape of the last few points so a table row shows direction at a glance.
   Recharts is too heavy to instantiate once per row, so this is plain SVG.
   Tone follows the net move, and a flat/short series renders as a dash rather
   than a straight line pretending to be data. */
export function Sparkline({ values = [], width = 62, height = 20, tone = null, title }) {
  const pts = (values || []).filter((v) => typeof v === "number" && isFinite(v));
  if (pts.length < 2) return <span className="st-spark-none" title={title}>—</span>;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || 1;
  const stepX = width / (pts.length - 1);
  const y = (v) => height - 1.5 - ((v - lo) / span) * (height - 3);
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const colour = tone || (pts[pts.length - 1] >= pts[0] ? "#8fd47f" : "#d47f7f");
  return (
    <svg className="st-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role="img" aria-label={title} preserveAspectRatio="none">
      <title>{title}</title>
      <path d={area} fill={colour} fillOpacity="0.14" />
      <path d={line} fill="none" stroke={colour} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

let gradSeq = 0;

export function PriceChart({
  rows = [],
  cur = "chaos",
  label,
  seriesName = "value",
  overlayName = null,
  overlayTone = "#7fb4d4",
  axisLabel = "league day",
  height = 220,
  dragSel, setDragSel,
  realMode = false, rateReady = false, rateHistory = null,
  empty = "History builds up with each data refresh — check back after a couple of runs.",
  extra = null,
}) {
  const unit = cur === "chaos" ? "c" : "div";
  const f = (v) => (cur === "chaos" ? fmtChaos(v) : fmtDiv(v));
  // Recharts resolves gradients by DOM id, so two charts on one page sharing
  // an id makes the second one paint with the first one's fill.
  const gradId = useMemo(() => `stFill${++gradSeq}`, []);
  const showRate = realMode && rateReady;

  const extremes = useMemo(() => {
    if (rows.length < 2) return null;
    let hi = rows[0], lo = rows[0];
    for (const r of rows) { if (r.value > hi.value) hi = r; if (r.value < lo.value) lo = r; }
    return { hi, lo };
  }, [rows]);

  const axis = useMemo(() => dayAxis(rows), [rows]);

  const range = (() => {
    if (!dragSel || dragSel.active || rows.length < 2) return null;
    if (Math.abs(dragSel.end - dragSel.start) <= 0.01) return null;
    const a = Math.min(dragSel.start, dragSel.end), b = Math.max(dragSel.start, dragSel.end);
    const at = (d) => rows.reduce((best, p) => (Math.abs(p.day - d) < Math.abs(best.day - d) ? p : best), rows[0]);
    const p1 = at(a), p2 = at(b);
    return {
      p1, p2,
      pct: p1.value > 0 ? (p2.value / p1.value - 1) * 100 : null,
      rpct: showRate ? realPct(p1.chaos, p1.rate, p2.chaos, p2.rate) : null,
    };
  })();

  return (
    <div className="st-chart">
      <div className="st-chart-label">
        {label}
        {showRate && <span className="st-rate-key"> · <i className="st-rate-swatch" />chaos per divine</span>}
        {extra}
        <span className="st-drag-hint"> · drag on the graph to measure a range</span>
      </div>
      {range && (
        <div className="st-range">
          Day {fmtDay(range.p1.day)} → Day {fmtDay(range.p2.day)}: {f(range.p1.value)}{unit} → {f(range.p2.value)}{unit}
          {" "}<PctBadge v={range.pct} />
          {range.rpct != null && <span className="st-range-real"> · real <PctBadge v={range.rpct} real /></span>}
          <button className="st-range-clear" onClick={() => setDragSel && setDragSel(null)} aria-label="Clear selection">✕</button>
        </div>
      )}
      {rows.length > 1 ? (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 18, right: 18, bottom: 4, left: 0 }}
            style={{ userSelect: "none" }}
            onMouseDown={(e) => { if (setDragSel && e && e.activeLabel != null) setDragSel({ start: e.activeLabel, end: e.activeLabel, active: true }); }}
            onMouseMove={(e) => { if (setDragSel && e && e.activeLabel != null) setDragSel((sel) => (sel && sel.active ? { ...sel, end: e.activeLabel } : sel)); }}
            onMouseUp={() => setDragSel && setDragSel((sel) => (sel ? { ...sel, active: false } : sel))}
            onMouseLeave={() => setDragSel && setDragSel((sel) => (sel && sel.active ? { ...sel, active: false } : sel))}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4f19" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#ef4f19" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#3a332a" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="day" type="number" domain={axis.domain} ticks={axis.ticks}
              tick={{ fill: "#8d8371", fontSize: 11 }} stroke="#4a4234" tickFormatter={fmtDay}
              label={{ value: axisLabel, position: "insideBottomRight", fill: "#6f6656", fontSize: 11, dy: 2 }} />
            <YAxis tick={{ fill: "#8d8371", fontSize: 11 }} stroke="#4a4234" width={52} tickFormatter={f} />
            {showRate && (
              <YAxis yAxisId="rate" orientation="right" width={46} stroke="#4a4234"
                tick={{ fill: "#7f9fb8", fontSize: 11 }} tickFormatter={fmtRate} domain={["auto", "auto"]} />
            )}
            <Tooltip
              contentStyle={{ background: "#17100d", border: "1px solid #65351f", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "#c9bfa8" }} itemStyle={{ color: "#e5d9b8" }}
              formatter={(v, n) => (n === "rate"
                ? [`${fmtRate(v)}c`, "1 divine"]
                : [`${f(v)} ${unit}`, n === "overlay" ? overlayName : seriesName])}
              labelFormatter={(d) => `Day ${fmtDay(d)}`} />
            {dragSel && dragSel.start !== dragSel.end && (
              <ReferenceArea x1={Math.min(dragSel.start, dragSel.end)} x2={Math.max(dragSel.start, dragSel.end)}
                fill="#ef4f19" fillOpacity={0.13} stroke="#ef4f19" strokeOpacity={0.4} />
            )}
            <Area type="monotone" dataKey="value" name="value" stroke="#ff6a24" strokeWidth={2}
              fill={`url(#${gradId})`} isAnimationActive={false} />
            {overlayName && (
              <Line type="monotone" dataKey="overlay" name="overlay" stroke={overlayTone} strokeWidth={1.8}
                dot={false} connectNulls isAnimationActive={false} />
            )}
            {showRate && (
              <Line yAxisId="rate" type="monotone" dataKey="rate" name="rate" stroke="#6f97b3" strokeWidth={1.5}
                strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            )}
            {extremes && <ReferenceDot x={extremes.hi.day} y={extremes.hi.value} r={4} fill="#8fd47f" stroke="#1b150c"
              label={{ value: `High ${f(extremes.hi.value)}${unit} · d${fmtDay(extremes.hi.day)}`, fill: "#8fd47f", fontSize: 11, position: "top" }} />}
            {extremes && <ReferenceDot x={extremes.lo.day} y={extremes.lo.value} r={4} fill="#d47f7f" stroke="#1b150c"
              label={{ value: `Low ${f(extremes.lo.value)}${unit} · d${fmtDay(extremes.lo.day)}`, fill: "#d47f7f", fontSize: 11, position: "bottom" }} />}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="st-chart-empty" style={{ height }}>{empty}</div>
      )}
    </div>
  );
}

export default PriceChart;
