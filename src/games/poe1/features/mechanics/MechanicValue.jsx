import { useEffect, useMemo, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { createJsonStore } from "../../../../shared/storage/jsonStore.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { fmtPrice } from "../pricing/money.js";
import { MECHANICS, rankMechanics, valueMechanic } from "./mechanicValue.js";
import "./mechanics.css";

const store = createJsonStore({ game: "poe1", feature: "mechanic-samples" });
const number = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export default function MechanicValue({ league, priceUrl, currency, stale }) {
  const [snapshot, setSnapshot] = useState(null);
  const [sort, setSort] = useState("flow");
  const [samples, setSamples] = useState(() => store.load({})[league] || {});
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    loadDocument(priceUrl, { supported: POE1_SCHEMA_VERSIONS, required: requiredFields("prices") }).then((result) => {
      if (!cancelled) setSnapshot(isUsable(result) ? result.data : "missing");
    });
    return () => { cancelled = true; };
  }, [priceUrl]);

  const rows = useMemo(() => rankMechanics(MECHANICS.map((mechanic) =>
    valueMechanic(mechanic, snapshot, samples[mechanic.id])), sort), [snapshot, samples, sort]);
  const historical = stale || freshness(snapshot?.generatedAt).level !== "fresh";
  const rate = snapshot?.divineRate;
  const money = (value) => value === null ? "—" : fmtPrice(value, rate > 0 ? currency : "chaos", rate);
  const update = (id, patch) => setDrafts((current) => ({
    ...current, [id]: { ...(current[id] || samples[id]), ...patch },
  }));
  const save = (id) => {
    if (!drafts[id]) return;
    const next = { ...samples, [id]: drafts[id] };
    setSamples(next);
    store.save({ ...store.load({}), [league]: next });
    setDrafts((current) => {
      const pending = { ...current };
      delete pending[id];
      return pending;
    });
  };

  return <main className="mechanic-value">
    <header className="overview-heading mechanic-value-heading">
      <div className="ov-kicker">Path of Exile 1 · experimental</div>
      <h2>Mechanic value</h2>
      <p>Compare selected reward markets, or log your own runs to see which mechanic paid better at snapshot prices.</p>
    </header>
    <SourceStrip>
      {snapshot === "missing" ? "No price snapshot for this league."
        : !snapshot ? "Loading reward prices…"
        : <><b>{historical ? "Historical snapshot" : "Price snapshot"}</b> · {league} · {new Date(snapshot.generatedAt).toLocaleString()}
          {snapshot.priceSource ? ` · ${snapshot.priceSource}` : ""}
          {Number.isFinite(Date.parse(snapshot.gggHour)) ? ` · Trades: ${new Date(snapshot.gggHour).toLocaleString()}` : ""}</>}
    </SourceStrip>
    <div className="mechanic-value-controls">
      <div className="app-segmented" role="group" aria-label="Rank mechanics by">
        <button type="button" className={sort === "flow" ? "on" : ""} aria-pressed={sort === "flow"} onClick={() => setSort("flow")}>Traded value</button>
        <button type="button" className={sort === "netPerHour" ? "on" : ""} aria-pressed={sort === "netPerHour"} onClick={() => setSort("netPerHour")}>My sample net / hour</button>
      </div>
      <p>{sort === "flow"
        ? "Shows completed trades for the tracked drops in one GGG digest. Coverage varies; turnover does not measure how much drops per run."
        : "Compares only completed samples. Use similar map difficulty and include the same kinds of costs and time for each mechanic."}</p>
    </div>
    <div className="mechanic-value-list">
      {rows.map((row) => {
        const sample = drafts[row.id] || samples[row.id] || {};
        return <details key={row.id} className="mechanic-value-card">
          <summary>
            <strong>{row.name}</strong>
            <span>Traded value <b>{row.flow === null ? "—" : `${number.format(row.flow)} c/h`}</b><small>{row.flowCoverage}/{row.drops.length} drops with trades</small></span>
            <span>Sample net / hour <b>{money(row.netPerHour)}</b><small>{row.netPerHour === null ? "No complete sample" : `${row.runs} runs · ${row.runs < 10 ? "small sample" : `${row.minutes} min`}`}</small></span>
          </summary>
          <form className="mechanic-value-details" onSubmit={(event) => { event.preventDefault(); save(row.id); }}>
            <p>Enter totals for this sample, including zero for tracked drops you didn’t find. Count only rewards from this mechanic.</p>
            <div className="mechanic-value-inputs">
              {[["runs", "Runs", "1"], ["minutes", "Total minutes", "any"], ["cost", "Total cost (chaos)", "any"]].map(([key, label, step]) =>
                <label key={key}>{label}<input type="number" min="0" step={step} value={sample[key] ?? ""} onChange={(event) => update(row.id, { [key]: event.target.value })} /></label>)}
            </div>
            <div className="mechanic-value-drops">
              {row.drops.map((drop) => <label key={drop.name}>
                <span>{drop.name}<small>{drop.price === null ? "No usable quote" : `${money(drop.price)} each${drop.carried ? " · older quote, excluded from samples" : ""}`}</small></span>
                <input aria-label={`Total ${drop.name} found`} type="number" min="0" step="1" placeholder="Count" value={sample.counts?.[drop.name] ?? ""}
                  onChange={(event) => update(row.id, { counts: { ...sample.counts, [drop.name]: event.target.value } })} />
              </label>)}
            </div>
            <p>{row.netPerRun !== null
              ? <>Tracked net per run: <strong>{money(row.netPerRun)}</strong> · based on your recorded counts and costs.</>
              : "A sample needs runs, time, total cost and a count for each tracked drop. A positive count with a missing or older quote leaves the sample unranked."}</p>
            <button type="submit" disabled={!drafts[row.id]}>Save sample</button>
          </form>
        </details>;
      })}
    </div>
    <p className="mechanic-value-note">The baskets cover selected rewards only. Sample totals omit untracked loot and do not guarantee a sale. The 3.30 drop tables are still being verified; a listed market does not confirm that the item still drops from that mechanic.</p>
  </main>;
}
