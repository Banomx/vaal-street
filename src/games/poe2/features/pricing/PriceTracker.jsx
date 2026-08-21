import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import MarketBrowser from "../../shared/MarketBrowser.jsx";
import { marketCategory, marketSubcategory, MARKET_CATEGORIES, MARKET_SUBCATEGORIES } from "./marketCategories.js";
import { buildPriceTimeline } from "./priceTimeline.js";

const RANGES = [
  [24, "24h"],
  [168, "7d"],
  [720, "30d"],
  [null, "All"],
];

function number(value, digits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function timelineTick(value, rangeHours) {
  const date = new Date(value);
  if (rangeHours && rangeHours <= 168) {
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceText(league, priceData, history, rateSummary) {
  if (!priceData) return "Loading the current PoE 2 market catalogue…";
  if (priceData === "missing") return `PoE 2 market snapshot unavailable · ${league}`;
  const count = history?.timestamps?.length || 0;
  return `Stored PoE 2 market timeline · ${league} · ${count} ${count === 1 ? "snapshot" : "snapshots"} · updated ${new Date(priceData.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`;
}

export default function PriceTracker({ league, priceData, history, currency, rateSummary }) {
  const markets = useMemo(() => priceData && priceData !== "missing" ? priceData.prices || {} : {}, [priceData]);
  const names = useMemo(() => [...new Set([
    ...Object.keys(markets),
    ...Object.keys(history?.series || {}),
  ])].sort((a, b) => a.localeCompare(b)), [history, markets]);
  const [item, setItem] = useState("");
  const [rangeHours, setRangeHours] = useState(null);
  const [divineAdjusted, setDivineAdjusted] = useState(false);

  useEffect(() => {
    if (!names.length) setItem("");
  }, [names]);

  const timeline = useMemo(() => buildPriceTimeline(history, item, { currency, rangeHours }), [currency, history, item, rangeHours]);
  const current = markets[item];
  const currentCategoryId = marketCategory(item, current);
  const currentCategory = MARKET_CATEGORIES.find(([id]) => id === currentCategoryId)?.[1] || "Other";
  const currentSubcategoryId = marketSubcategory(currentCategoryId, item, current);
  const currentSubcategory = MARKET_SUBCATEGORIES[currentCategoryId]?.find(([id]) => id === currentSubcategoryId)?.[1];
  const last = timeline.points[timeline.points.length - 1];
  const change = divineAdjusted ? timeline.divineAdjustedChange : timeline.change;

  useEffect(() => {
    if (!timeline.canDivineAdjust) setDivineAdjusted(false);
  }, [timeline.canDivineAdjust]);

  return (
    <main className="p2pt-main">
      <style>{css}</style>
      <SourceStrip>{sourceText(league, priceData, history, rateSummary)}</SourceStrip>
      <header className="p2pt-head">
        <div><span>PoE 2 market history</span><h2>Price tracker</h2><p>Every hourly market snapshot is retained as a compact timeline for charts and future tools.</p></div>
      </header>

      <div className="p2pt-workspace">
        <MarketBrowser names={names} entries={markets} selectedName={item} onSelect={setItem} sticky />

        <section className="p2pt-card">
        <div className="p2pt-card-head">
          <div><span>Selected market</span><h3>{item || "No priced items available"}</h3>
            {current && <p>{currentCategory}{currentSubcategory ? ` · ${currentSubcategory}` : ""} · {current.source}{current.listingCount ? ` · ${number(current.listingCount, 0)} listings` : ""}{current.volume1H ? ` · ${number(current.volume1H, 0)} traded in source hour` : ""}</p>}
          </div>
          <div className="p2pt-stats">
            <div><span>Latest</span><strong>{last ? `${number(last.value)} ${timeline.unit}` : "—"}</strong></div>
            <div><span>{divineAdjusted ? "Divine-adjusted move" : "Selected move"}</span><strong className={change > 0 ? "gain" : change < 0 ? "loss" : ""}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${number(change * 100, 1)}%`}</strong></div>
          </div>
        </div>
        <div className="p2pt-chart-tools">
          <div className="p2pt-ranges" aria-label="Price timeline range">
            {RANGES.map(([hours, label]) => <button key={label} className={rangeHours === hours ? "on" : ""} onClick={() => setRangeHours(hours)}>{label}</button>)}
          </div>
          <label className={`p2pt-adjust ${!timeline.canDivineAdjust ? "disabled" : ""}`} title={timeline.canDivineAdjust ? "Measure the item's move after accounting for the Divine-to-Exalted rate at both ends" : "Two snapshots with Divine rates are required"}>
            <input type="checkbox" checked={divineAdjusted} disabled={!timeline.canDivineAdjust} onChange={(event) => setDivineAdjusted(event.target.checked)} />
            <span>Divine-adjusted</span>
          </label>
        </div>
        <div className="p2pt-chart">
          {timeline.points.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeline.points} margin={{ top: 14, right: 20, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#35231c" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="#806b62" fontSize={11}
                  tickFormatter={(value) => timelineTick(value, rangeHours)} />
                <YAxis stroke="#806b62" fontSize={11} width={58} tickFormatter={(value) => number(value, value < 10 ? 2 : 0)} domain={["auto", "auto"]} />
                {divineAdjusted && <YAxis yAxisId="rate" orientation="right" stroke="#8f7eaf" fontSize={11} width={58} tickFormatter={(value) => number(value, 0)} domain={["auto", "auto"]} />}
                <Tooltip contentStyle={{ background: "#160e0b", border: "1px solid #63351f", color: "#ead8cf" }}
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value, name) => name === "Divine rate" ? [`${number(value)} Exalted / Divine`, name] : [`${number(value)} ${timeline.unit}`, item]} />
                <Line type="monotone" dataKey="value" stroke="#e36f3f" strokeWidth={2} dot={timeline.points.length < 40} activeDot={{ r: 4 }} connectNulls={false} />
                {divineAdjusted && <Line yAxisId="rate" type="monotone" dataKey="rate" name="Divine rate" stroke="#8f7eaf" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />}
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="p2pt-empty">{history ? "This item has no stored points in the selected range." : "Price history starts with the next market snapshot."}</div>}
        </div>
        <footer>{timeline.points.length < 2 ? "A trend appears after a second stored snapshot." : `${timeline.points.length} stored points shown.`} {divineAdjusted ? "The move compares Exalted price / Divine rate at both ends; the dashed line is Exalted per Divine. " : ""}The latest 7 days stay hourly; older history uses one point per UTC day.</footer>
        </section>
      </div>
    </main>
  );
}

const css = `
.p2pt-main{display:grid;gap:14px}.p2pt-head{padding:20px 22px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2pt-head>div>span,.p2pt-card-head>div>span,.p2pt-stats span{color:#bd6846;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2pt-head h2{margin:4px 0;color:#f0ded5;font-size:27px}.p2pt-head p{margin:0;color:#9c867c;font-size:13.5px}.p2pt-workspace{display:grid;grid-template-columns:minmax(340px,400px) minmax(0,1fr);gap:14px;align-items:start}.p2pt-card{display:grid;gap:12px;min-width:0;padding:20px;border:1px solid #4a2b20;border-radius:8px;background:#110c0a}.p2pt-card-head{display:flex;justify-content:space-between;gap:20px}.p2pt-card h3{margin:4px 0;color:#ead5cb;font-size:21px}.p2pt-card-head p{margin:0;color:#8e776d;font-size:12px}.p2pt-stats{display:flex;gap:24px;text-align:right}.p2pt-stats div{display:grid;align-content:start;gap:5px}.p2pt-stats strong{color:#e9d7ce;font-size:18px}.p2pt-ranges{display:flex;gap:5px}.p2pt-ranges button{padding:6px 10px;border:1px solid #45291f;border-radius:4px;background:#160e0b;color:#9c8277;cursor:pointer}.p2pt-ranges button.on{border-color:#a44e2d;background:#2a140d;color:#efb59d}.p2pt-chart{min-height:300px;border-top:1px solid #302019;border-bottom:1px solid #302019}.p2pt-empty{display:grid;min-height:300px;place-items:center;color:#806d64;font-size:13px}.p2pt-card footer{color:#806d64;font-size:11.5px}.gain{color:#79bd72!important}.loss{color:#dc716c!important}@media(max-width:1100px){.p2pt-card-head{align-items:stretch;flex-direction:column}.p2pt-stats{justify-content:space-between;text-align:left}}@media(max-width:780px){.p2pt-workspace{grid-template-columns:1fr}.p2pt-workspace>.p2mb-browser.sticky{position:static}}@media(max-width:500px){.p2pt-stats{gap:12px}}
.p2pt-chart-tools{display:flex;align-items:center;justify-content:space-between;gap:12px}.p2pt-adjust{display:flex;align-items:center;gap:7px;color:#c7ada1;font-size:12px;cursor:pointer}.p2pt-adjust input{accent-color:#a44e2d}.p2pt-adjust.disabled{opacity:.45;cursor:not-allowed}@media(max-width:500px){.p2pt-chart-tools{align-items:flex-start;flex-direction:column}}
`;
