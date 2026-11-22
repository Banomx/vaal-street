import { useEffect, useMemo, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { freshness, isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { POE1_SCHEMA_VERSIONS } from "../../config.js";
import { CHANGE_WINDOW_OPTIONS } from "../pricing/marketWindows.js";
import { fmtPrice } from "../pricing/money.js";
import { TimePriceChart } from "../pricing/PriceChart.jsx";
import { KINGSMARCH_PORTS, KINGSMARCH_SOURCES } from "./ports.js";
import { kingsmarchSnapshot, portTimeline, rankPorts, valuePort } from "./kingsmarch.js";
import "./kingsmarch.css";

export default function Kingsmarch({ league, files, currency, window, setWindow, stale }) {
  const [documents, setDocuments] = useState({});
  const [selectedId, setSelectedId] = useState("tattoo-str");
  const [itemName, setItemName] = useState(null);
  const { prices, tattoos, runegrafts, tattoosSelfhistory, runegraftsSelfhistory } = files;
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setDocuments({});
    for (const [key, url, required] of [
      ["prices", prices, ["generatedAt", "prices"]],
      ["tattoos", tattoos, ["generatedAt", "items"]],
      ["runegrafts", runegrafts, ["generatedAt", "items"]],
      ["tattoosHistory", tattoosSelfhistory, ["points"]],
      ["runegraftsHistory", runegraftsSelfhistory, ["points"]],
    ]) {
      loadDocument(url, { supported: POE1_SCHEMA_VERSIONS, required, signal: controller.signal }).then((result) => {
        if (!cancelled) setDocuments((current) => ({ ...current, [key]: isUsable(result) ? result.data : "missing" }));
      });
    }
    return () => { cancelled = true; controller.abort(); };
  }, [prices, tattoos, runegrafts, tattoosSelfhistory, runegraftsSelfhistory]);
  const snapshotFor = (kind) => kingsmarchSnapshot(documents, kind);
  const ports = useMemo(() => KINGSMARCH_PORTS.map((port) => valuePort(port, kingsmarchSnapshot(documents, port.kind))), [documents]);
  const tattooPorts = rankPorts(ports.filter((port) => port.kind === "tattoos"));
  const runePorts = rankPorts(ports.filter((port) => port.kind === "runegrafts"));
  const selected = ports.find((port) => port.id === selectedId) || tattooPorts[0];
  const snapshot = snapshotFor(selected.kind);
  const historical = stale || freshness(snapshot?.generatedAt).level !== "fresh";
  const money = (value, source = snapshot) => value === null ? "—" : fmtPrice(value, source?.divineRate > 0 ? currency : "chaos", source?.divineRate);
  const history = documents[`${selected.kind}History`];
  const timeline = useMemo(() => portTimeline(history, selected, window, itemName), [history, selected, window, itemName]);
  const selectPort = (port) => { setSelectedId(port.id); setItemName(null); };
  return <section className="kingsmarch" aria-label="Kingsmarch port values">
    <header className="overview-heading">
      <div className="ov-kicker">Path of Exile 1 · shipping rewards</div>
      <h2>Kingsmarch</h2>
      <p>Compare the average market price of a tattoo or runegraft from each port’s item pool.</p>
    </header>
    <SourceStrip>{!snapshot ? "Loading Kingsmarch prices…"
      : snapshot === "missing" ? "No price snapshot available for this league."
        : <>{historical ? "Historical snapshot" : "Price snapshot"} · {league} · {new Date(snapshot.generatedAt).toLocaleString()} · {snapshot.priceSource || "Stored market prices"}</>}</SourceStrip>
    <p className="kingsmarch-method">Equal-weight average per item, including rare rewards. Drop odds and shipment quantities are unknown, so this is a price comparison, not expected shipment profit. Missing or older quotes are excluded and partial averages are marked.</p>
    {[[tattooPorts, "Tattoos", "Includes the three Journey tattoos"], [runePorts, "Runegrafts", "Fortress, Gemcraft and Angler are shared by all three ports"]].map(([group, title, note]) =>
      <section key={title} aria-label={title}>
        <div className="kingsmarch-group-heading"><h3>{title}</h3><span>{note}</span></div>
        <div className="kingsmarch-ports">{group.map((port) => <button type="button" key={port.id}
          className={`kingsmarch-port kingsmarch-port--${port.attribute.toLowerCase()}${selected.id === port.id ? " on" : ""}`}
          aria-pressed={selected.id === port.id} onClick={() => selectPort(port)}>
          <span className="kingsmarch-port-label">{port.attribute} {port.kind} <span>{port.port}</span></span>
          <strong>{money(port.average, snapshotFor(port.kind))}</strong>
          <span>{port.complete ? "Average item price" : "Partial average"} · {port.quoted}/{port.items.length} priced</span>
        </button>)}</div>
      </section>)}
    <section className="kingsmarch-detail" aria-label={`${selected.port} reward details`}>
      <header>
        <div><h3>{selected.port} · {selected.attribute} {selected.kind}</h3><p>Average {money(selected.average)} · Median {money(selected.median)} · {selected.quoted}/{selected.items.length} usable prices</p></div>
        <div className="app-segmented" role="group" aria-label="Kingsmarch price window">
          {CHANGE_WINDOW_OPTIONS.map((option) => <button key={option} type="button" className={option === window ? "on" : ""}
            aria-pressed={option === window} onClick={() => setWindow(option)}>{option}</button>)}
        </div>
      </header>
      <label className="kingsmarch-chart-choice">Price history
        <select value={itemName || ""} onChange={(event) => setItemName(event.target.value || null)} aria-label="Kingsmarch price history">
          <option value="">Port average · complete pool</option>
          {selected.items.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </label>
      <p className="kingsmarch-chart-label">{itemName || "Equal-weight port average"} · {window} · Chaos</p>
      <TimePriceChart timeline={timeline} label={`${selected.port}: ${itemName || "average item price"}`}
        empty={history === undefined ? "Loading recorded prices…" : "No complete observations in this window yet. History grows with hourly market snapshots."} />
      <div className="kingsmarch-items" role="group" aria-label={`${selected.port} eligible items`}>
        {selected.items.map((item) => <button type="button" key={item.name} aria-pressed={itemName === item.name}
          className={itemName === item.name ? "on" : ""} onClick={() => setItemName(item.name)}>
          <span>{item.name}{item.carried && <small>Older quote · excluded from average</small>}</span>
          <strong>{item.price === null ? "Awaiting quote" : money(item.price)}</strong>
        </button>)}
      </div>
    </section>
    <p className="kingsmarch-sources">Reward pools: {KINGSMARCH_SOURCES.map((url, index) => <span key={url}>{index > 0 && " · "}<a href={url} target="_blank" rel="noreferrer">{["Kingsmarch", "Tattoos", "Runegrafts"][index]}</a></span>)} · Reviewed 22 Nov 2026.</p>
  </section>;
}
