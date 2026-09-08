import { useMemo } from "react";
import { createJsonStore } from "../../../../shared/storage/jsonStore.js";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { BOSSES } from "../bosses/bossData.js";
import { computeBosses, fmtPrice, sanitizeSettings, summarizePriceCoverage } from "../bosses/bossProfit.js";
import { buildTabletFamilies, FAMILY_ORDER } from "../farms/tabletFarms.js";

const bossSettings = createJsonStore({ game: "poe2", feature: "boss-profit", version: 1 });

function sourceText(league, priceData, rateSummary) {
  if (!priceData) return "Loading PoE 2 market prices…";
  if (priceData === "missing") return `PoE 2 market snapshot unavailable · ${league}`;
  return `Prices via GGG trades + poe.ninja + PoE2Scout gap-fill · ${league} · updated ${new Date(priceData.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`;
}

function FeatureCard({ feature }) {
  return (
    <section className="p2ov-feature">
      <div className="p2ov-feature-top"><span>{feature.kind}</span><em>{feature.status}</em></div>
      <h3>{feature.title}</h3>
      <div className="p2ov-number"><strong className={feature.tone}>{feature.value}</strong><span>{feature.unit}</span></div>
      <p>{feature.note}</p>
      <div className="p2ov-feature-bottom">
        <div>{feature.flow.map((item) => <span key={item}>{item}</span>)}</div>
        <button type="button" onClick={feature.open}>{feature.openLabel}</button>
      </div>
    </section>
  );
}

export default function Overview({ league, priceData, exchange, currency, chaosExalted, rateSummary, onOpenTab }) {
  const divineExalted = priceData && priceData !== "missing" ? priceData.divineExalted || 0 : 0;
  const summary = useMemo(() => {
    if (!priceData || priceData === "missing") return null;
    const settings = sanitizeSettings(bossSettings.load({}));
    const overrides = Object.fromEntries(Object.entries(settings.priceOverrides || {})
      .filter(([key]) => key.startsWith(`${league}:`))
      .map(([key, value]) => [key.slice(league.length + 1), value]));
    const rows = computeBosses(BOSSES, priceData.prices || {}, { ...settings, priceOverrides: overrides });
    const ranked = rows.filter((row) => row.net != null && Number.isFinite(row.net))
      .sort((a, b) => b.net - a.net);
    return {
      best: ranked[0] || null,
      shortlist: ranked.slice(0, 3),
      coverage: summarizePriceCoverage(rows),
      profile: settings.ttkProfiles.find((profile) => profile.id === settings.activeTtkProfileId) || null,
    };
  }, [league, priceData]);

  const best = summary?.best;
  const feature = {
    kind: "Highest estimated boss net",
    status: best ? `${best.boss.group} · snapshot estimate` : priceData ? "Waiting for complete pricing" : "Loading market data",
    title: best ? best.boss.name : "Price a Path of Exile 2 boss encounter",
    value: best ? fmtPrice(best.net, currency, divineExalted, chaosExalted) : "—",
    tone: best?.net > 0 ? "gain" : best?.net < 0 ? "loss" : "",
    unit: "estimated net per kill",
    note: "Estimated drop value after entry cost. Review the drop assumptions before choosing an encounter.",
    flow: ["Encounter entry", "Drop-pool EV", summary?.profile ? `TTK: ${summary.profile.name}` : "Optional custom TTK"],
    openLabel: "Open Boss profit",
    open: () => onOpenTab("bosses", best?.boss.id),
  };
  const coverage = summary?.coverage;
  const trackedMarkets = priceData && priceData !== "missing" ? Object.keys(priceData.prices || {}).length : 0;
  const families = priceData && priceData !== "missing" ? buildTabletFamilies(priceData.prices || {}) : [];
  const pricedFamilies = families.filter(family => family.baseline?.entry?.exalted > 0);
  const cheapest = [...pricedFamilies].sort((a, b) => a.baseline.entry.exalted - b.baseline.entry.exalted)[0];
  const available = Boolean(priceData && priceData !== "missing");
  const emptyLabel = priceData === "missing" ? "Snapshot unavailable" : available ? "No data in snapshot" : "Loading…";
  const exchangePairs = exchange?.pairs?.length || 0;

  return (
    <main className="p2ov-main market-overview">
      <style>{css}</style>
      <SourceStrip className="p2ov-source">{sourceText(league, priceData, rateSummary)}</SourceStrip>

      <header className="p2ov-head overview-heading">
        <div className="p2ov-kicker">Path of Exile 2 · market desk</div>
        <h2>Market overview</h2>
        <p>Compare boss returns, follow tablet prices, and find your next market to watch.</p>
      </header>

      <section className="overview-stats" aria-label="Market at a glance">
        <button className="overview-stat" onClick={() => onOpenTab("prices")}><span>Tracked markets</span><strong>{available ? trackedMarkets.toLocaleString() : "—"}</strong><small>Search prices and stored history</small></button>
        <button className="overview-stat" onClick={() => onOpenTab("farms")}><span>Tablet price coverage</span><strong>{available ? pricedFamilies.length : "—"}<em>{available ? " / " + FAMILY_ORDER.length : ""}</em></strong><small>Normal-tablet entry quotes</small></button>
        <button className="overview-stat" onClick={() => onOpenTab("exchange")}><span>Completed exchange pairs</span><strong>{exchange ? exchangePairs.toLocaleString() : "—"}</strong><small>{exchange ? "From the stored trade snapshot" : "Waiting for exchange data"}</small></button>
      </section>
      <div className="p2ov-briefing">
        <FeatureCard feature={feature} />
        <aside className="p2ov-signal" aria-label="Boss shortlist">
          <header><h3>Boss shortlist</h3><p>Ranked by estimated net per kill</p></header>
          {summary?.shortlist.map((row, index) => <button type="button" key={row.boss.id} onClick={() => onOpenTab("bosses", row.boss.id)}>
            <span>0{index + 1} · {row.boss.group}</span><strong>{row.boss.name}</strong>
            <em className={row.net > 0 ? "gain" : row.net < 0 ? "loss" : ""}>{fmtPrice(row.net, currency, divineExalted, chaosExalted)}</em>
          </button>)}
          {!summary?.shortlist.length && <p className="p2ov-shortlist-empty">{emptyLabel}. Boss estimates appear once entry prices are available.</p>}
        </aside>
      </div>

      <h3 className="p2ov-section-title">Choose your next move</h3>
      <div className="p2ov-desks">
        <section className="p2ov-desk">
          <header><h3>Compare farming mechanics</h3><em>Popular farms</em></header>
          <p>Compare tablet entry costs with each mechanic's output basket and market movement.</p>
          <dl>
            <div><dt>Priced tablet families</dt><dd>{available ? pricedFamilies.length + "/" + FAMILY_ORDER.length : "—"}</dd></div>
            <div><dt>Lowest tablet entry</dt><dd>{cheapest?.label || emptyLabel}</dd></div>
            <div><dt>Normal tablet price</dt><dd>{cheapest ? fmtPrice(cheapest.baseline.entry.exalted, currency, divineExalted, chaosExalted) : "—"}</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("farms")}>Explore Popular farms →</button>
        </section>
        <section className="p2ov-desk">
          <header><h3>Follow a market</h3><em>Price tracker</em></header>
          <p>Open the stored league timeline for any item in the normalized PoE 2 market catalogue.</p>
          <dl>
            <div><dt>Tracked markets</dt><dd>{available ? trackedMarkets : "—"}</dd></div>
            <div><dt>Recent resolution</dt><dd>Hourly for 7 days</dd></div>
            <div><dt>Retention</dt><dd>Up to 430 days</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("prices")}>Open Price tracker</button>
        </section>
        <section className="p2ov-desk">
          <header><h3>Read completed exchange flow</h3><em>Currency Exchange</em></header>
          <p>Rank real cleared volume, inspect the hour’s traded range, compare poe.ninja quotes, and review liquid two-leg routes.</p>
          <dl>
            <div><dt>Completed pairs</dt><dd>{exchange ? exchangePairs : "Unavailable"}</dd></div>
            <div><dt>Resolution</dt><dd>Official hourly digest</dd></div>
            <div><dt>Thin-route guard</dt><dd>10 Exalted per leg</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("exchange")}>Open Currency Exchange</button>
        </section>
      </div>

      <section className="p2ov-attention" aria-label="PoE 2 data quality">
        <button type="button" onClick={feature.open}>
          <span>Price coverage</span>
          <strong>{coverage ? `${coverage.priced}/${coverage.total} boss-market items priced` : "Checking boss price coverage"}</strong>
          <small>{coverage?.missing.length ? `${coverage.missing.length} items currently need a market quote.` : "Every configured challenge-league item contributes when pricing is available."}</small>
        </button>
        <div><span>Timing</span><strong>No hidden default TTK</strong><small>Profit/hour appears only after you create or select a custom timing profile.</small></div>
        <button type="button" onClick={() => onOpenTab("prices")}><span>Price history</span><strong>Follow a market over time</strong><small>Browse item prices and compare their movement across the available snapshots.</small></button>
      </section>
    </main>
  );
}

const css = `
.p2ov-signal header{padding:18px;border-bottom:1px solid #39271f}.p2ov-signal header h3{margin:0;font-size:15px}.p2ov-signal header p,.p2ov-shortlist-empty{margin:5px 0 0;color:#c8b9b0;font-size:12px}.p2ov-signal em.gain{color:#92ca8d}.p2ov-signal em.loss{color:#eaaea3}.p2ov-signal button:hover{background:#281810}.p2ov-shortlist-empty{padding:18px;}
.p2ov-main{display:grid;gap:14px}.p2ov-source{margin:0}.p2ov-head{padding:22px 24px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2ov-kicker{color:#f0ac93;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.p2ov-head h2{margin:5px 0 4px;color:#f0ded5;font-size:27px}.p2ov-head p{margin:0;color:#c7bab5;font-size:14px}
.p2ov-briefing{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.7fr);gap:14px}.p2ov-feature{display:grid;gap:11px;min-height:285px;padding:20px;border:1px solid #5a3020;border-radius:8px;background:radial-gradient(circle at 85% 5%,#35170d 0,transparent 38%),#120d0b}.p2ov-feature-top{display:flex;justify-content:space-between;gap:12px;color:#e6b099;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2ov-feature-top em{color:#c5bab5;font-style:normal}.p2ov-feature h3{max-width:720px;margin:5px 0 0;color:#f0ded5;font-size:24px;line-height:1.15}.p2ov-number{display:flex;align-items:baseline;gap:9px}.p2ov-number strong{font-size:34px}.p2ov-number span{color:#c7bab5;font-size:13px}.p2ov-feature>p{max-width:780px;margin:0;color:#c9b9b2;font-size:14px;line-height:1.55}.p2ov-feature-bottom{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-top:auto}.p2ov-feature-bottom>div{display:flex;flex-wrap:wrap;gap:6px}.p2ov-feature-bottom span{padding:5px 8px;border:1px solid #3d291f;border-radius:4px;color:#c9b9b1;font-size:11.5px}.p2ov-feature button,.p2ov-desk button{padding:9px 12px;border:1px solid #7b3e24;border-radius:5px;background:#20120d;color:#e4b49e;font:inherit;font-size:13px;cursor:pointer}
.p2ov-signal{display:grid;align-content:start;overflow:hidden;border:1px solid #3e281e;border-radius:8px;background:#110c0a}.p2ov-signal>*{display:grid;gap:5px;padding:17px;border:0;border-bottom:1px solid #312119;background:transparent;text-align:left}.p2ov-signal button{color:inherit;font:inherit;cursor:pointer}.p2ov-signal span{color:#c7bab4;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase}.p2ov-signal strong{color:#e4d1c7;font-size:16px}.p2ov-signal em{color:#d9c4ba;font-size:18px;font-style:normal;font-weight:700}.p2ov-signal small{color:#c5bab4;font-size:12px}
.p2ov-section-title{margin:8px 0 0;color:#d7beb2;font-size:17px}.p2ov-desks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}.p2ov-desk{display:grid;gap:12px;padding:17px;border:1px solid #3b281f;border-radius:7px;background:#120d0b}.p2ov-desk header{display:flex;align-items:start;justify-content:space-between;gap:10px}.p2ov-desk h3{margin:0;color:#e7d4ca;font-size:18px}.p2ov-desk header em{color:#e2b19c;font-size:10.5px;font-style:normal;letter-spacing:.1em;text-transform:uppercase}.p2ov-desk>p{margin:0;color:#c7bab3;font-size:13.5px;line-height:1.45}.p2ov-desk dl{display:grid;gap:7px;margin:0}.p2ov-desk dl div{display:flex;justify-content:space-between;gap:16px;padding-top:7px;border-top:1px solid #2b1d17}.p2ov-desk dt{color:#c4bab5;font-size:12px}.p2ov-desk dd{margin:0;color:#d9c1b5;font-size:12.5px;text-align:right}.p2ov-desk button{width:max-content}
.p2ov-attention{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;border:1px solid #39271f;border-radius:7px;background:#0f0b09}.p2ov-attention>*{display:grid;gap:4px;min-width:0;padding:14px;border:0;border-right:1px solid #302019;background:transparent;text-align:left}.p2ov-attention>*:last-child{border-right:0}.p2ov-attention button{font:inherit;cursor:pointer}.p2ov-attention span{color:#d2b7ab;font-size:10px;letter-spacing:.12em;text-transform:uppercase}.p2ov-attention strong{color:#d9c4ba;font-size:13.5px}.p2ov-attention small{color:#c4bab5;font-size:11.5px;line-height:1.4}
@media(max-width:900px){.p2ov-briefing{grid-template-columns:1fr}.p2ov-attention{grid-template-columns:1fr}.p2ov-attention>*{border-right:0;border-bottom:1px solid #302019}.p2ov-attention>*:last-child{border-bottom:0}}@media(max-width:560px){.p2ov-head{padding:18px}.p2ov-feature{padding:17px}.p2ov-feature-bottom{align-items:stretch;flex-direction:column}.p2ov-feature-bottom button{width:100%}}

.p2ov-feature,.p2ov-desk,.p2ov-signal{border-radius:12px;box-shadow:inset 0 1px #ffffff08}
.p2ov-desk{display:flex;flex-direction:column;gap:14px;padding:22px;background:linear-gradient(145deg,#1b130e,#110d0a)}
.p2ov-desk header{flex-direction:column-reverse;gap:7px}.p2ov-desk h3{font-size:19px}.p2ov-desk>p{color:#c9b9ae;line-height:1.55}
.p2ov-desk>button{margin-top:auto;width:100%;text-align:left;padding:11px 14px;border-radius:7px;background:#2b1c13;color:#f0c6a5}
.p2ov-desk>button:hover,.p2ov-feature button:hover{background:#432b1b;border-color:#b8784e}
.p2ov-number{flex-wrap:wrap}.p2ov-number strong{font-weight:650;letter-spacing:-.04em;font-size:42px}
.p2ov-feature-top{flex-wrap:wrap}.p2ov-signal button{border-left:2px solid transparent}.p2ov-signal button:hover{border-left-color:#dc9764}
`;
