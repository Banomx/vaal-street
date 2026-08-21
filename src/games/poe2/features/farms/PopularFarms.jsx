import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { buildTabletFamilies, sortTabletRows, tabletFamilyTimeline } from "./tabletFarms.js";

const RANGES = [[24, "24h"], [168, "7d"], [720, "30d"], [null, "All"]];
const TONES = { atlas: "#d19a52", bossing: "#c46c52", breach: "#9b72db", ritual: "#a66bba", delirium: "#7892bb", abyss: "#6a8f61", expedition: "#5ea97d", vaal: "#c46c52" };

function number(value, digits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function price(value, currency, divineExalted, chaosExalted) {
  const exalted = Number(value);
  if (!(exalted > 0)) return "—";
  if (currency === "divine" || (currency === "smart" && divineExalted > 0 && exalted >= divineExalted * .5)) return `${number(exalted / divineExalted)} div`;
  if (currency === "chaos" && chaosExalted > 0) return `${number(exalted / chaosExalted)}c`;
  return `${number(exalted, exalted >= 100 ? 0 : 2)} ex`;
}

function tick(value, rangeHours) {
  const date = new Date(value);
  return rangeHours && rangeHours <= 168
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceText(league, priceData, history, rateSummary) {
  if (!priceData) return "Loading PoE 2 tablet prices…";
  if (priceData === "missing") return `PoE 2 tablet prices unavailable · ${league}`;
  const count = history?.timestamps?.length || 0;
  return `Tablet prices · ${league} · ${count} ${count === 1 ? "snapshot" : "snapshots"} · updated ${new Date(priceData.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`;
}

function liquidity(entry) {
  const count = Number(entry?.listingCount || entry?.volume1H) || 0;
  if (!count) return { count: 0, label: "Liquidity unknown", tone: "unknown" };
  if (count < 100) return { count, label: "Thin market", tone: "thin" };
  if (count < 1000) return { count, label: "Limited listings", tone: "limited" };
  if (count < 5000) return { count, label: "Active market", tone: "active" };
  return { count, label: "Deep market", tone: "deep" };
}

function sourceLabel(entry) {
  if (entry?.source === "poe.ninja stash") return "poe.ninja";
  return entry?.source || "No live source";
}

function UniqueTabletTile({ name, entry, baselineValue, currency, divineExalted, chaosExalted }) {
  const value = Number(entry.exalted) || 0;
  const ratio = baselineValue > 0 ? value / baselineValue : null;
  const difference = baselineValue > 0 ? value - baselineValue : null;
  const market = liquidity(entry);
  const fill = ratio == null ? 0 : Math.min(100, ratio * 25);
  return <article className="p2pf-unique-tile">
    <div className="p2pf-unique-main">
      <div className="p2pf-unique-title"><strong title={name}>{name}</strong><b>{price(value, currency, divineExalted, chaosExalted)}</b></div>
      <div className="p2pf-unique-meta"><span>{sourceLabel(entry)}</span><span className={market.tone}>{market.count ? `${number(market.count, 0)} listings` : market.label}</span></div>
      <div className="p2pf-relative" title="The marker is the Normal-tablet baseline; the fill shows this unique tablet relative to it.">
        <i style={{ width: `${fill}%` }} /><b />
      </div>
      <div className="p2pf-unique-delta">
        <span>{ratio == null ? "No Normal baseline" : `${number(ratio, 1)}× Normal baseline`}</span>
        <em className={difference > 0 ? "gain" : difference < 0 ? "loss" : ""}>{difference == null ? "Comparison pending" : `${difference >= 0 ? "+" : "−"}${price(Math.abs(difference), currency, divineExalted, chaosExalted)}`}</em>
      </div>
    </div>
  </article>;
}

export default function PopularFarms({ league, priceData, history, currency, chaosExalted, divineExalted, rateSummary }) {
  const markets = priceData && priceData !== "missing" ? priceData.prices || {} : {};
  const families = useMemo(() => buildTabletFamilies(markets), [markets]);
  const [rangeHours, setRangeHours] = useState(168);
  const [divineAdjusted, setDivineAdjusted] = useState(false);
  const [sortMode, setSortMode] = useState("value");
  const rows = useMemo(() => sortTabletRows(families.map((family) => {
    const timeline = tabletFamilyTimeline(history, family, {
      currency: divineAdjusted ? "divine" : currency,
      rangeHours,
      divineAdjusted,
    });
    const last = timeline.points[timeline.points.length - 1];
    return { ...family, timeline, baselineValue: Number(family.baseline?.entry?.exalted || last?.exalted) || 0 };
  }), sortMode), [currency, divineAdjusted, families, history, rangeHours, sortMode]);
  const canAdjust = rows.some((row) => row.timeline.canDivineAdjust);
  const pricedRows = rows.filter((row) => row.baselineValue > 0);
  const highest = [...pricedRows].sort((left, right) => right.baselineValue - left.baselineValue)[0];
  const hottest = [...pricedRows].filter((row) => row.timeline.change != null)
    .sort((left, right) => right.timeline.change - left.timeline.change)[0];
  const uniqueCount = rows.reduce((sum, row) => sum + row.uniques.length, 0);

  useEffect(() => {
    if (!canAdjust) setDivineAdjusted(false);
  }, [canAdjust]);

  return <main className="p2pf-main">
    <style>{css}</style>
    <SourceStrip>{sourceText(league, priceData, history, rateSummary)}</SourceStrip>
    <header className="p2pf-head">
      <div><span>Tablet market movement</span><h2>Popular farms</h2><p>Default tablet prices are the baseline for each league mechanic. Unique tablets stay visible as context without replacing that baseline.</p></div>
      <div className="p2pf-tools">
        <div className="p2pf-tool"><span>Sort</span><div className="app-segmented p2pf-sort" aria-label="Tablet family sort">
          {[["value", "Value"], ["movement", "Movement"], ["name", "Name"]].map(([value, label]) => <button key={value} aria-pressed={sortMode === value} className={sortMode === value ? "on" : ""} onClick={() => setSortMode(value)}>{label}</button>)}
        </div></div>
        <div className="p2pf-tool"><span>Window</span>
        <div className="app-segmented p2pf-ranges" aria-label="Tablet price change window">
          {RANGES.map(([hours, label]) => <button key={label} aria-pressed={rangeHours === hours} className={rangeHours === hours ? "on" : ""} onClick={() => setRangeHours(hours)}>{label}</button>)}
        </div></div>
        <label className={`p2pf-adjust ${!canAdjust ? "disabled" : ""}`} title={canAdjust ? "Measure tablet movement after accounting for Divine-to-Exalted drift" : "Two snapshots with Divine rates are required"}>
          <input type="checkbox" checked={divineAdjusted} disabled={!canAdjust} onChange={(event) => setDivineAdjusted(event.target.checked)} />
          <span>Divine-adjusted</span>
        </label>
      </div>
    </header>

    {!!rows.length && <section className="p2pf-summary" aria-label="Tablet market summary">
      <div><span>Highest default tablet</span><strong>{highest?.label || "—"}</strong><em>{highest ? price(highest.baselineValue, currency, divineExalted, chaosExalted) : "No quote"}</em></div>
      <div><span>Strongest move</span><strong>{hottest?.label || "Building history"}</strong><em className={hottest?.timeline.change > 0 ? "gain" : hottest?.timeline.change < 0 ? "loss" : ""}>{hottest?.timeline.change == null ? "—" : `${hottest.timeline.change >= 0 ? "+" : ""}${number(hottest.timeline.change * 100, 1)}%`}</em></div>
      <div><span>Baseline coverage</span><strong>{pricedRows.length}/{rows.length} Normal tablets</strong><em>{uniqueCount} unique tablets tracked separately</em></div>
    </section>}

    {!rows.length && <section className="p2pf-empty">No tablet markets are present in this snapshot yet.</section>}
    <section className="p2pf-grid">
      {rows.map((row, index) => {
        const move = row.timeline.change;
        const baselineValue = row.baselineValue;
        const market = liquidity(row.baseline?.entry);
        return <article className="p2pf-card" key={row.id} style={{ "--tone": TONES[row.id] || "#bd6846" }}>
          <header>
            <div><span className="p2pf-rank">{index + 1}</span><h3>{row.label}</h3><em>{row.baselineName}</em></div>
            <div className="p2pf-value"><strong>{price(baselineValue, currency, divineExalted, chaosExalted)}</strong><span className={move > 0 ? "gain" : move < 0 ? "loss" : ""}>{move == null ? "Building history" : `${move >= 0 ? "+" : ""}${number(move * 100, 1)}%`}</span></div>
          </header>
          <div className="p2pf-badges">
            <span>Normal baseline</span><span>{sourceLabel(row.baseline?.entry)}</span><span className={market.tone}>{market.count ? `${number(market.count, 0)} listings · ` : ""}{market.label}</span>
          </div>
          <div className="p2pf-chart">
            {row.timeline.points.length ? <ResponsiveContainer width="100%" height={130}>
              <LineChart data={row.timeline.points} margin={{ top: 12, right: 12, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="#35231c" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="#6f5d55" fontSize={10} minTickGap={28} tickFormatter={(value) => tick(value, rangeHours)} />
                <YAxis stroke="#6f5d55" fontSize={10} width={45} domain={["auto", "auto"]} tickFormatter={(value) => number(value, value < 10 ? 2 : 0)} />
                <Tooltip contentStyle={{ background: "#160e0b", border: "1px solid #63351f", color: "#ead8cf" }} labelFormatter={(value) => new Date(value).toLocaleString()} formatter={(value) => [`${number(value)} ${row.timeline.unit}`, row.baselineName]} />
                <Line type="monotone" dataKey="value" stroke={TONES[row.id] || "#bd6846"} strokeWidth={2} dot={row.timeline.points.length < 12} connectNulls={false} animationDuration={1000} />
              </LineChart>
            </ResponsiveContainer> : <div className="p2pf-chart-empty">The baseline graph starts when {row.baselineName} receives stored prices.</div>}
          </div>
          <footer>
            <div className="p2pf-baseline-note"><span>Baseline status</span><strong>{row.baseline ? "Live Normal-tablet quote" : "Waiting for a Normal-tablet quote"}</strong><em>{row.timeline.points.length} stored point{row.timeline.points.length === 1 ? "" : "s"} in this window</em></div>
            {row.uniques.length > 0 && <div className="p2pf-uniques"><span>Unique tablets · {row.uniques.length}</span>{row.uniques.map(({ name, entry }) => <UniqueTabletTile key={name} name={name} entry={entry} baselineValue={baselineValue} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}</div>}
          </footer>
        </article>;
      })}
    </section>
  </main>;
}

const css = `
.p2pf-main{display:grid;gap:14px}.p2pf-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:20px 22px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2pf-head>div:first-child>span,.p2pf-tool>span{color:#bd6846;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2pf-head h2{margin:4px 0;color:#f0ded5;font-size:27px}.p2pf-head p{max-width:700px;margin:0;color:#9c867c;font-size:13.5px}.p2pf-tools{display:flex;align-items:flex-end;gap:12px;flex-shrink:0}.p2pf-tool{display:grid;gap:5px}.p2pf-ranges button,.p2pf-sort button{padding:6px 10px}.p2pf-adjust{display:flex;align-items:center;gap:7px;padding-bottom:6px;color:#c7ada1;font-size:12px;white-space:nowrap;cursor:pointer}.p2pf-adjust input{accent-color:#a44e2d}.p2pf-adjust.disabled{opacity:.45;cursor:not-allowed}.p2pf-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;border:1px solid #3d281f;border-radius:8px;background:#100b09}.p2pf-summary>div{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:12px 16px;border-right:1px solid #302019}.p2pf-summary>div:last-child{border-right:0}.p2pf-summary span{grid-column:1/-1;color:#9b6b56;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}.p2pf-summary strong{color:#ddc8be;font-size:14px}.p2pf-summary em{color:#ad9185;font-size:12px;font-style:normal;text-align:right}.p2pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:12px}.p2pf-card{min-width:0;overflow:hidden;border:1px solid #45291f;border-top:2px solid var(--tone);border-radius:8px;background:linear-gradient(150deg,rgba(255,255,255,.015),transparent 45%),#110c0a}.p2pf-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:15px 16px 7px}.p2pf-card>header>div:first-child{display:grid;grid-template-columns:auto 1fr;column-gap:8px}.p2pf-rank{grid-row:1/3;align-self:center;color:#756159;font-size:12px}.p2pf-card h3{margin:0;color:#ead7ce;font-size:19px}.p2pf-card header em{color:#8e776d;font-size:11.5px;font-style:normal}.p2pf-value{display:grid;text-align:right}.p2pf-value strong{color:#f0d8cb;font-size:17px}.p2pf-value span{font-size:11px}.p2pf-badges{display:flex;flex-wrap:wrap;gap:5px;padding:0 16px 5px}.p2pf-badges span{padding:3px 6px;border:1px solid #3c2921;border-radius:999px;background:#17100d;color:#987f74;font-size:9.5px}.p2pf-badges .thin{border-color:#7b382d;color:#e18272}.p2pf-badges .limited{border-color:#765428;color:#d2a563}.p2pf-badges .active,.p2pf-badges .deep{border-color:#355c3a;color:#7fbd82}.p2pf-chart{height:130px;margin:0 6px}.p2pf-chart-empty{display:grid;height:130px;padding:12px;place-items:center;text-align:center;color:#75645c;font-size:12px}.p2pf-card footer{display:grid;grid-template-columns:minmax(130px,.55fr) minmax(270px,1.45fr);gap:16px;padding:11px 16px 14px;border-top:1px solid #302019;color:#806d64;font-size:10.5px}.p2pf-baseline-note{display:grid;align-content:start;gap:3px}.p2pf-baseline-note>span,.p2pf-uniques>span{color:#9b6b56;font-size:9px;letter-spacing:.11em;text-transform:uppercase}.p2pf-baseline-note strong{color:#bda49a;font-size:11px}.p2pf-baseline-note em{color:#75645c;font-style:normal}.p2pf-uniques{display:grid;gap:7px}.p2pf-unique-tile{padding:8px;border:1px solid #35251e;border-radius:6px;background:linear-gradient(120deg,#17100d,#100b09)}.p2pf-unique-main{display:grid;gap:4px;min-width:0}.p2pf-unique-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.p2pf-unique-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbc5ba;font-size:11.5px}.p2pf-unique-title b{flex-shrink:0;color:#efc5b3;font-size:11.5px;font-weight:600}.p2pf-unique-meta,.p2pf-unique-delta{display:flex;justify-content:space-between;gap:8px}.p2pf-unique-meta span{color:#75645c;font-size:9px}.p2pf-unique-meta .thin{color:#e18272}.p2pf-unique-meta .limited{color:#d2a563}.p2pf-unique-meta .active,.p2pf-unique-meta .deep{color:#7fbd82}.p2pf-relative{position:relative;height:5px;overflow:hidden;border-radius:999px;background:#2a1c16}.p2pf-relative i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--tone),#e08a62)}.p2pf-relative b{position:absolute;top:-2px;bottom:-2px;left:25%;width:1px;background:#f0d7ca;opacity:.7}.p2pf-unique-delta span,.p2pf-unique-delta em{font-size:9.5px}.p2pf-unique-delta span{color:#9d8175}.p2pf-unique-delta em{font-style:normal;text-align:right}.p2pf-empty{padding:40px;border:1px solid #3e281e;border-radius:8px;text-align:center;color:#806d64}@media(max-width:1100px){.p2pf-head{align-items:flex-start;flex-direction:column}.p2pf-tools{width:100%;flex-wrap:wrap}}@media(max-width:720px){.p2pf-summary{grid-template-columns:1fr}.p2pf-summary>div{border-right:0;border-bottom:1px solid #302019}.p2pf-summary>div:last-child{border-bottom:0}}@media(max-width:520px){.p2pf-grid{grid-template-columns:1fr}.p2pf-tools{align-items:flex-start;flex-direction:column}.p2pf-card footer{grid-template-columns:1fr}}
`;
