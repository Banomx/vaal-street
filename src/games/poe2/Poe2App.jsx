import { useEffect, useState } from "react";
import GameSwitcher from "../../shared/ui/GameSwitcher.jsx";
import { AppHeader, AppTabs } from "../../shared/ui/AppShell.jsx";
import BossProfit from "./features/bosses/BossProfit.jsx";
import Overview from "./features/overview/Overview.jsx";
import PopularFarms from "./features/farms/PopularFarms.jsx";
import PriceTracker from "./features/pricing/PriceTracker.jsx";
import CurrencyExchange from "./features/exchange/CurrencyExchange.jsx";
import { POE2_STATIC_BASE } from "./config.js";

function leagueSlug(name) {
  return String(name || "standard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rateNumber(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function marketRates(snapshot) {
  if (!snapshot || snapshot === "missing") return { chaosExalted: 0, divineExalted: 0, summary: "" };
  const chaosExalted = Number(snapshot.prices?.["Chaos Orb"]?.exalted) || 0;
  const divineExalted = Number(snapshot.divineExalted || snapshot.prices?.["Divine Orb"]?.exalted) || 0;
  const mirrorExalted = Number(snapshot.prices?.["Mirror of Kalandra"]?.exalted) || 0;
  const parts = [];
  if (chaosExalted > 0) parts.push(`1 Chaos ≈ ${rateNumber(chaosExalted)} Exalted`);
  if (divineExalted > 0) parts.push(`1 Divine ≈ ${rateNumber(divineExalted, 0)} Exalted`);
  if (chaosExalted > 0 && divineExalted > 0) parts.push(`1 Divine ≈ ${rateNumber(divineExalted / chaosExalted)} Chaos`);
  if (mirrorExalted > 0 && divineExalted > 0) parts.push(`1 Mirror ≈ ${rateNumber(mirrorExalted / divineExalted, 0)} Divine`);
  return { chaosExalted, divineExalted, summary: parts.join(" · ") };
}

async function readJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function singlePointHistory(snapshot) {
  if (!snapshot?.generatedAt) return null;
  return {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    league: snapshot.league,
    timestamps: [snapshot.generatedAt],
    divineExalted: [snapshot.divineExalted || null],
    series: Object.fromEntries(Object.entries(snapshot.prices || {}).map(([name, entry]) => [name, [entry.exalted || null]])),
  };
}

export default function Poe2App({ activeGame, onGameChange }) {
  const [leagues, setLeagues] = useState([]);
  const [league, setLeague] = useState("");
  const [prices, setPrices] = useState(null);
  const [priceHistory, setPriceHistory] = useState(null);
  const [exchangeMarkets, setExchangeMarkets] = useState(null);
  const [exchangeHistory, setExchangeHistory] = useState(null);
  const [currency, setCurrency] = useState("smart");
  const [tab, setTab] = useState("overview");
  const rates = marketRates(prices);

  useEffect(() => {
    let current = true;
    readJson(`${POE2_STATIC_BASE}/index.json`)
      .then((data) => {
        if (!current) return;
        const next = Array.isArray(data.leagues) ? data.leagues : [];
        setLeagues(next);
        setLeague((value) => value || next[0]?.name || "Standard");
      })
      .catch(() => {
        if (!current) return;
        setLeagues([{ name: "Standard", slug: "standard" }]);
        setLeague("Standard");
      });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!league) return;
    let current = true;
    setPrices(null);
    setPriceHistory(null);
    setExchangeMarkets(null);
    setExchangeHistory(null);
    const descriptor = leagues.find((item) => item.name === league);
    const slug = descriptor?.slug || leagueSlug(league);
    Promise.all([
      readJson(`${POE2_STATIC_BASE}/${encodeURIComponent(slug)}/prices.json`),
      readJson(`${POE2_STATIC_BASE}/${encodeURIComponent(slug)}/price-history.json`).catch(() => null),
      readJson(`${POE2_STATIC_BASE}/${encodeURIComponent(slug)}/exchange-markets.json`).catch(() => null),
      readJson(`${POE2_STATIC_BASE}/${encodeURIComponent(slug)}/exchange-history.json`).catch(() => null),
    ]).then(([data, history, exchange, exchangeTimeline]) => {
      if (!current) return;
      setPrices(data);
      setPriceHistory(history || singlePointHistory(data));
      setExchangeMarkets(exchange);
      setExchangeHistory(exchangeTimeline);
    }).catch(() => { if (current) setPrices("missing"); });
    return () => { current = false; };
  }, [league, leagues]);

  return (
    <div className="app-shell-page p2-root">
      <style>{css}</style>
      <AppHeader className="p2-head" brandClassName="p2-title" controlsClassName="p2-controls"
        subtitle="Path of Exile 2 market tools">
          <GameSwitcher activeGame={activeGame} onChange={onGameChange} />
          <label className="app-control p2-control">
            <span>League</span>
            <select value={league} onChange={(event) => setLeague(event.target.value)} aria-label="Path of Exile 2 league">
              {!leagues.length && <option>{league || "Loading..."}</option>}
              {leagues.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <div className="app-control p2-control">
            <span>Currency</span>
            <div className="app-segmented p2-segmented" aria-label="Display currency">
              {[['exalted', 'Exalted'], ['chaos', 'Chaos'], ['divine', 'Divine'], ['smart', 'Smart']].map(([value, label]) => (
                <button key={value} className={currency === value ? "on" : ""} onClick={() => setCurrency(value)}>{label}</button>
              ))}
            </div>
          </div>
      </AppHeader>
      <AppTabs className="p2-tabs">
        <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "farms" ? "on" : ""} onClick={() => setTab("farms")}>Popular farms</button>
        <button className={tab === "bosses" ? "on" : ""} onClick={() => setTab("bosses")}>Boss profit</button>
        <button className={tab === "exchange" ? "on" : ""} onClick={() => setTab("exchange")}>Exchange</button>
        <button className={tab === "prices" ? "on" : ""} onClick={() => setTab("prices")}>Price tracker</button>
      </AppTabs>
      {tab === "overview" && <Overview league={league || "Standard"} priceData={prices} exchange={exchangeMarkets} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary}
        onOpenTab={(next) => setTab(next)} />}
      {tab === "farms" && <PopularFarms league={league || "Standard"} priceData={prices} history={priceHistory} currency={currency}
        chaosExalted={rates.chaosExalted} divineExalted={rates.divineExalted} rateSummary={rates.summary} />}
      {tab === "bosses" && <BossProfit league={league || "Standard"} priceData={prices} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary} />}
      {tab === "exchange" && <CurrencyExchange league={league || "Standard"} priceData={prices} exchange={exchangeMarkets} history={exchangeHistory} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary} />}
      {tab === "prices" && <PriceTracker league={league || "Standard"} priceData={prices} history={priceHistory} currency={currency} rateSummary={rates.summary} />}
    </div>
  );
}

const css = `
@font-face { font-family:"Kei"; src:url("${import.meta.env.BASE_URL}fonts/keifont.ttf") format("truetype"); font-display:swap; }
* { box-sizing:border-box; }
body { margin:0; background:#090605; }
button,select,input { font-family:inherit; }
.p2-head { border-bottom-color:#632b17; background:linear-gradient(110deg,#0d0908,#25100b 72%,#0b0807); }
.p2-boss-page { margin-top:0; }
`;
