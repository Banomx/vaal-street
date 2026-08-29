import { useEffect, useState } from "react";
import GameSwitcher from "../../shared/ui/GameSwitcher.jsx";
import { AppHeader, AppTabs, SourceStrip } from "../../shared/ui/AppShell.jsx";
import SnapshotNotice from "../../shared/ui/SnapshotNotice.jsx";
import BossProfit from "./features/bosses/BossProfit.jsx";
import Overview from "./features/overview/Overview.jsx";
import PopularFarms from "./features/farms/PopularFarms.jsx";
import PriceTracker from "./features/pricing/PriceTracker.jsx";
import CurrencyExchange from "./features/exchange/CurrencyExchange.jsx";
import { POE2_LEAGUE_FILES, POE2_SCHEMA_VERSIONS, POE2_STATIC_BASE } from "./config.js";
import { isUsable, leagueFileUrl, loadDocument, summarize } from "../../shared/data/snapshot.js";

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

const SCHEMA = { supported: POE2_SCHEMA_VERSIONS };

/* Every league entry names its own files, so a rename in the generator does
   not need a matching change here; these are only the fallback for an index
   written before the map existed. */
function fileUrl(base, descriptor, key) {
  return leagueFileUrl(base, descriptor, key, POE2_LEAGUE_FILES);
}

export default function Poe2App({ activeGame, onGameChange }) {
  const [leagues, setLeagues] = useState([]);
  const [league, setLeague] = useState("");
  const [prices, setPrices] = useState(null);
  const [priceHistory, setPriceHistory] = useState(null);
  const [exchangeMarkets, setExchangeMarkets] = useState(null);
  const [exchangeHistory, setExchangeHistory] = useState(null);
  const [quality, setQuality] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [currency, setCurrency] = useState("smart");
  const [tab, setTab] = useState("overview");
  const rates = marketRates(prices);

  useEffect(() => {
    let current = true;
    (async () => {
      /* The index is the contract: it says which leagues exist and which files
         each one has. If it cannot be read there is nothing to fall back to —
         inventing a "Standard" league here just moves the failure one step
         later and makes it look like an empty league instead of a broken
         deployment. */
      const [index, report] = await Promise.all([
        loadDocument(`${POE2_STATIC_BASE}/index.json`, { ...SCHEMA, required: ["leagues"] }),
        loadDocument(`${POE2_STATIC_BASE}/quality.json`, SCHEMA),
      ]);
      if (!current) return;
      setQuality(isUsable(report) ? report.data : null);
      if (!isUsable(index) || !Array.isArray(index.data.leagues) || !index.data.leagues.length) {
        setLeagues([]);
        setPrices("missing");
        setVerdict(summarize({
          documents: { "The PoE 2 snapshot index": index },
          required: ["The PoE 2 snapshot index"],
          quality: isUsable(report) ? report.data : null,
          game: "PoE 2",
        }));
        return;
      }
      setLeagues(index.data.leagues);
      setLeague((value) => value || index.data.leagues[0]?.name || "Standard");
    })();
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!league || !leagues.length) return;
    const controller = new AbortController();
    let current = true;
    setPrices(null);
    setPriceHistory(null);
    setExchangeMarkets(null);
    setExchangeHistory(null);
    setVerdict(null);
    const descriptor = leagues.find((item) => item.name === league) || { name: league, slug: leagueSlug(league) };
    const load = (key, required) => {
      const url = fileUrl(POE2_STATIC_BASE, descriptor, key);
      if (!url) return Promise.resolve({ state: "missing", reason: "not listed in the index" });
      return loadDocument(url, { ...SCHEMA, required, signal: controller.signal });
    };
    Promise.all([
      load("prices", ["generatedAt", "prices"]),
      load("priceHistory", ["timestamps", "series"]),
      load("exchangeMarkets", ["generatedAt", "items"]),
      load("exchangeHistory", ["snapshots", "pairKeys"]),
    ]).then(([priceDoc, historyDoc, marketsDoc, timelineDoc]) => {
      if (!current) return;
      setPrices(isUsable(priceDoc) ? priceDoc.data : "missing");
      /* A snapshot with no stored history used to be turned into a one-point
         "history" here. That reads as a flat line on every chart and as a
         percentage move of zero, which is a claim about the market rather than
         an admission that nothing has been recorded yet. The features already
         handle a null history by saying so. */
      setPriceHistory(isUsable(historyDoc) ? historyDoc.data : null);
      setExchangeMarkets(isUsable(marketsDoc) ? marketsDoc.data : null);
      setExchangeHistory(isUsable(timelineDoc) ? timelineDoc.data : null);
      /* A price history that simply does not exist yet gets the dedicated
         "current snapshot only" banner below, which says more than a bullet
         would; listing it here as well says the same thing twice. A history
         that failed for any other reason still belongs in the verdict. */
      const documents = {
        "Prices for this league": priceDoc,
        "The currency exchange snapshot": marketsDoc,
        "Stored exchange history": timelineDoc,
      };
      if (historyDoc.state !== "missing") documents["Stored price history"] = historyDoc;
      setVerdict(summarize({
        documents,
        required: ["Prices for this league"],
        quality,
        generatedAt: isUsable(priceDoc) ? priceDoc.data.generatedAt : null,
        game: "PoE 2",
      }));
    });
    return () => { current = false; controller.abort(); };
  }, [league, leagues, quality]);

  /* Prices but no stored timeline is an ordinary state for a league in its
     first hours, and one the reader has to be told about explicitly — every
     "% change" on the page is blank for a reason. */
  const currentOnly = prices && prices !== "missing" && !priceHistory;

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
      <div className="p2-notices">
        <SnapshotNotice verdict={verdict} />
        {currentOnly && (
          <SourceStrip className="app-source-strip--spaced" tone="notice">
            <strong>Current snapshot only</strong>
            <ul><li>No hourly history has been stored for {league} yet, so this page shows the latest
              market state without any trend. Charts and percentage moves start with the second
              stored snapshot.</li></ul>
          </SourceStrip>
        )}
      </div>
      {tab === "overview" && <Overview league={league || "Standard"} priceData={prices} exchange={exchangeMarkets} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary}
        onOpenTab={(next) => setTab(next)} />}
      {tab === "farms" && <PopularFarms league={league || "Standard"} priceData={prices} history={priceHistory} currency={currency}
        chaosExalted={rates.chaosExalted} divineExalted={rates.divineExalted} rateSummary={rates.summary} />}
      {tab === "bosses" && <BossProfit league={league || "Standard"} priceData={prices} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary} />}
      {tab === "exchange" && <CurrencyExchange league={league || "Standard"} priceData={prices} exchange={exchangeMarkets} history={exchangeHistory} currency={currency} chaosExalted={rates.chaosExalted} rateSummary={rates.summary} />}
      {tab === "prices" && <PriceTracker league={league || "Standard"} priceData={prices} history={priceHistory} currency={currency} rateSummary={rates.summary} />}
      <footer className="p2-art-credit" aria-label="Artwork credit">
        Background artwork <strong>© Grinding Gear Games</strong>
      </footer>
    </div>
  );
}

const css = `
@font-face { font-family:"Kei"; src:url("${import.meta.env.BASE_URL}fonts/keifont.ttf") format("truetype"); font-display:swap; }
* { box-sizing:border-box; }
body { margin:0; background:#090605; }
button,select,input { font-family:inherit; }
.p2-root {
  position:relative;
  isolation:isolate;
  background-color:#090605;
  background-image:
    linear-gradient(180deg,rgba(9,6,5,.3) 0,rgba(9,6,5,.76) 54vh,#090605 108vh),
    url("${import.meta.env.BASE_URL}assets/poe2-ardura-caravan.jpg");
  background-position:center top;
  background-repeat:no-repeat;
  background-size:100% 110vh,cover;
  background-attachment:fixed;
}
.p2-head {
  border-bottom-color:#632b17;
  background:linear-gradient(110deg,rgba(13,9,8,.88),rgba(37,16,11,.76) 72%,rgba(11,8,7,.9));
  box-shadow:0 18px 44px rgba(0,0,0,.24);
  backdrop-filter:blur(3px);
}
.p2-tabs { background:rgba(16,10,8,.88); backdrop-filter:blur(3px); }
.p2-notices { margin:0 auto; max-width:1180px; padding:0 18px; }
.p2-notices:empty { display:none; }
.p2-boss-page { margin-top:0; }
.p2-art-credit {
  max-width:1180px;
  margin:28px auto -20px;
  padding:13px 18px 0;
  border-top:1px solid rgba(150,86,61,.28);
  color:#79655d;
  font-size:10px;
  letter-spacing:.08em;
  text-align:right;
  text-transform:uppercase;
}
.p2-art-credit strong { color:#a88d81; font-weight:500; }
@media (max-width:720px) {
  .p2-root { background-position:58% top; background-size:100% 100vh,auto 100vh; }
  .p2-art-credit { text-align:center; }
}
`;
