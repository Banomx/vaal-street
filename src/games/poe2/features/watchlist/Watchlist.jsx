import { useMemo, useState } from "react";
import { evaluateWatch, sanitizeWatchlist, watchlistStore, WATCHLIST_LIMIT } from "./watchlist.js";
import { formatPriceTimestamp } from "../pricing/priceTimeline.js";
import "./watchlist.css";

const number = (value) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function Watchlist({ league, item, priceData, onSelect }) {
  const store = useMemo(() => watchlistStore(league), [league]);
  const [entries, setEntries] = useState(() => sanitizeWatchlist(store.load([])));
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const watched = entries.some((entry) => entry.name === item);
  const hits = entries.filter((entry) => evaluateWatch(entry, priceData).reached).length;
  function save(next) {
    const clean = sanitizeWatchlist(next);
    setEntries(clean);
    store.save(clean);
    setError(JSON.stringify(store.load(null)) === JSON.stringify(clean) ? "" : "Browser storage is unavailable. Changes last only for this visit.");
  }
  function add() {
    if (!item || watched || entries.length >= WATCHLIST_LIMIT) return;
    save([...entries, { name: item, unit: "exalted", direction: "below", target: null }]);
    setExpanded(true);
  }
  function patch(name, values) { save(entries.map((entry) => entry.name === name ? { ...entry, ...values } : entry)); }
  return <section className="p2-watch" aria-label="Watchlist">
    <header><div><h3>Watchlist <small>{entries.length} / {WATCHLIST_LIMIT}</small></h3>
      <p>{league} · {hits ? hits + " target" + (hits === 1 ? "" : "s") + " met" : "Save items and set price targets"}</p></div>
      <div className="p2-watch-actions"><button type="button" disabled={!item || watched || entries.length >= WATCHLIST_LIMIT} onClick={add}>{watched ? "Item watched" : "Watch selected item"}</button>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide watchlist" : "Show watchlist"}</button></div></header>
    {error && <p role="alert">{error}</p>}
    {expanded && <>
      <p>Saved in this browser for this league. Targets use the currency you choose here, independent of the chart currency. Checked against the loaded snapshot; no background notifications. Quotes older than 3 hours cannot trigger targets.</p>
      {!entries.length && <p>Choose an item below, then select “Watch selected item”.</p>}
      <div className="p2-watch-list">{entries.map((entry) => {
        const result = evaluateWatch(entry, priceData);
        return <article key={entry.name} className={result.reached ? "target-met" : ""}>
          <button type="button" className="p2-watch-item" onClick={() => onSelect(entry.name)}>{entry.name}</button>
          <div><strong>{number(result.value)} {entry.unit}</strong><small title={formatPriceTimestamp(result.at)}>{result.state}</small></div>
          <label><span>When price is</span><select aria-label={"Target direction for " + entry.name} value={entry.direction} onChange={(event) => patch(entry.name, { direction: event.target.value })}><option value="below">At or below</option><option value="above">At or above</option></select></label>
          <label><span>Target</span><input aria-label={"Target price for " + entry.name} type="number" min="0.000001" step="any" placeholder="Optional" key={entry.unit + ":" + entry.target} defaultValue={entry.target ?? ""} onBlur={(event) => { if (event.target.value === "" || event.target.validity.valid) patch(entry.name, { target: event.target.value }); else event.target.reportValidity(); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
          <label><span>Currency</span><select aria-label={"Target currency for " + entry.name} value={entry.unit} onChange={(event) => patch(entry.name, { unit: event.target.value, target: null })}><option value="exalted">Exalted</option><option value="chaos">Chaos</option><option value="divine">Divine</option></select></label>
          <button type="button" aria-label={"Remove " + entry.name + " from watchlist"} onClick={() => save(entries.filter((saved) => saved.name !== entry.name))}>Remove</button>
        </article>;
      })}</div>
    </>}
  </section>;
}
