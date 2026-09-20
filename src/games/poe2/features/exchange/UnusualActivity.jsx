import { useMemo, useState } from "react";
import { buildUnusualActivity } from "./exchangeDesk.js";
import { formatPriceTimestamp } from "../pricing/priceTimeline.js";
import "./market-signals.css";

const number = (value, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
export default function UnusualActivity({ history, league, onOpenMarket }) {
  const [multiple, setMultiple] = useState(2);
  const [minimum, setMinimum] = useState(10);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const report = useMemo(() => buildUnusualActivity(history, { minimumMultiple: multiple, minimumUnits: minimum }), [history, multiple, minimum]);
  const rows = report.rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase().trim()));
  const stale = report.latestAt != null && Date.now() - report.latestAt > 3 * 3600e3;
  return <main className="p2-signals">
    <header><span>Completed market activity · {league}</span><h2>Unusual activity</h2>
      <p>Spot volume surges against each item's own recent trading. Price movement shows whether the surge accompanied a rise or fall.</p></header>
    <div className="p2-signal-controls">
      <label>Search items<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} placeholder="Item name" /></label>
      <label>Volume multiple<select value={multiple} onChange={(event) => { setMultiple(Number(event.target.value)); setLimit(20); }}><option value={1.5}>At least 1.5×</option><option value={2}>At least 2×</option><option value={3}>At least 3×</option><option value={5}>At least 5×</option></select></label>
      <label>Minimum units / hour<input type="number" min="10" step="10" value={minimum} onChange={(event) => { setMinimum(Math.max(10, Number(event.target.value) || 10)); setLimit(20); }} /></label>
    </div>
    <div className="p2-signal-summary"><strong>{rows.length} matching signals</strong><span>{report.evaluated} items evaluated · {report.insufficient} {report.insufficient === 1 ? "item needs" : "items need"} more history</span><span>Observed hour: {formatPriceTimestamp(report.latestAt)}</span></div>
    {stale && <p className="p2-signal-warning" role="status">This snapshot is older than 3 hours. These are historical signals, not current activity.</p>}
    <p className="p2-signal-note">Latest completed hour versus the median of up to 24 preceding hours; at least 6 observed baseline hours required. Units are summed across the item's traded pairs. Missing hours are excluded, never counted as zero. Price change compares same-route Exalted prices against their recent median.</p>
    {!rows.length ? <div className="p2-signal-empty">{report.evaluated ? "No items meet these filters. Try a lower volume multiple or minimum units." : "Not enough hourly exchange history yet. Signals appear after an item has six baseline hours and a newer observation."}</div> :
      <div className="p2-signal-table"><table><thead><tr><th>Item</th><th>Volume surge</th><th>Latest units / h</th><th>Typical units / h</th><th>Price vs typical</th><th>Baseline</th><th>Explore</th></tr></thead><tbody>{rows.slice(0, limit).map((row) => <tr key={row.itemId}>
        <td><strong>{row.name}</strong>{row.baseline < 10 && <small>Low unit baseline · interpret cautiously</small>}</td><td><strong>{number(row.multiple)}×</strong></td><td>{number(row.units, 0)}</td><td>{number(row.baseline, 0)}</td>
        <td>{row.priceChange == null ? "No price comparison" : (row.priceChange >= 0 ? "+" : "") + number(row.priceChange * 100) + "%"}<small>{row.priceChange == null ? "Volume-only signal" : Math.abs(row.priceChange) < .05 ? "Price relatively stable" : row.priceChange > 0 ? "Volume surge + rising price" : "Volume surge + falling price"}</small></td>
        <td>{row.samples} / 24 hours</td><td><button type="button" onClick={() => onOpenMarket("prices", row)}>Chart & watch</button><button type="button" onClick={() => onOpenMarket("exchange", row)}>Routes</button></td>
      </tr>)}</tbody></table></div>}
    {rows.length > limit && <button type="button" onClick={() => setLimit(limit + 20)}>Show 20 more</button>}
  </main>;
}
