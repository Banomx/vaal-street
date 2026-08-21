import { useMemo } from "react";
import { createJsonStore } from "../../../../shared/storage/jsonStore.js";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { BOSSES } from "../bosses/bossData.js";
import { computeBosses, fmtPrice, sanitizeSettings, summarizePriceCoverage } from "../bosses/bossProfit.js";
import { buildTabletFamilies } from "../farms/tabletFarms.js";

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
      coverage: summarizePriceCoverage(rows),
      profile: settings.ttkProfiles.find((profile) => profile.id === settings.activeTtkProfileId) || null,
    };
  }, [league, priceData]);

  const best = summary?.best;
  const feature = {
    kind: "Boss profit",
    status: best ? `${best.boss.group} · live EV` : priceData ? "Waiting for complete pricing" : "Loading market data",
    title: best ? `${best.boss.name} currently leads by estimated net per kill` : "Price a Path of Exile 2 boss encounter",
    value: best ? fmtPrice(best.net, currency, divineExalted, chaosExalted) : "—",
    tone: best?.net > 0 ? "gain" : best?.net < 0 ? "loss" : "",
    unit: "estimated net per kill",
    note: "Entry costs, editable drop chances, market prices and optional custom TTK profiles stay in the full Boss profit workspace.",
    flow: ["Encounter entry", "Drop-pool EV", summary?.profile ? `TTK: ${summary.profile.name}` : "Optional custom TTK"],
    openLabel: "Open Boss profit",
    open: () => onOpenTab("bosses", best?.boss.id),
  };
  const coverage = summary?.coverage;
  const trackedMarkets = priceData && priceData !== "missing" ? Object.keys(priceData.prices || {}).length : 0;
  const tabletFamilies = priceData && priceData !== "missing" ? buildTabletFamilies(priceData.prices || {}).length : 0;
  const exchangePairs = exchange?.pairs?.length || 0;

  return (
    <main className="p2ov-main">
      <style>{css}</style>
      <SourceStrip className="p2ov-source">{sourceText(league, priceData, rateSummary)}</SourceStrip>

      <header className="p2ov-head">
        <div className="p2ov-kicker">Across Path of Exile 2</div>
        <h2>The daily briefing</h2>
        <p>Current tools and market signals in one place. More desks will appear here as new PoE 2 tabs are added.</p>
      </header>

      <div className="p2ov-briefing">
        <FeatureCard feature={feature} />
        <aside className="p2ov-signal" aria-label="Available PoE 2 features">
          <button type="button" onClick={feature.open}>
            <span>Available now</span><strong>Boss profit</strong>
            <em>{best ? fmtPrice(best.net, currency, divineExalted, chaosExalted) : "Loading…"}</em>
          </button>
          <button type="button" onClick={() => onOpenTab("farms")}>
            <span>Available now</span><strong>Popular farms</strong>
            <em>{tabletFamilies ? `${tabletFamilies} tablet families` : "Loading…"}</em>
          </button>
          <button type="button" onClick={() => onOpenTab("prices")}>
            <span>Available now</span><strong>Price tracker</strong>
            <em>{trackedMarkets ? `${trackedMarkets} markets` : "Loading…"}</em>
          </button>
          <button type="button" onClick={() => onOpenTab("exchange")}>
            <span>Available now</span><strong>Currency Exchange</strong>
            <em>{exchangePairs ? `${exchangePairs} pairs` : "Next snapshot"}</em>
          </button>
        </aside>
      </div>

      <h3 className="p2ov-section-title">Decision desks</h3>
      <div className="p2ov-desks">
        <section className="p2ov-desk">
          <header><h3>Price a boss kill</h3><em>Boss profit</em></header>
          <p>Compare encounter entry against weighted drop value before adding your own kill time.</p>
          <dl>
            <div><dt>Current leader</dt><dd>{best?.boss.name || "Loading…"}</dd></div>
            <div><dt>Estimated net</dt><dd>{best ? fmtPrice(best.net, currency, divineExalted, chaosExalted) : "—"}</dd></div>
            <div><dt>TTK profile</dt><dd>{summary?.profile?.name || "None — EV / kill only"}</dd></div>
          </dl>
          <button type="button" onClick={feature.open}>Open Boss profit</button>
        </section>
        <section className="p2ov-desk">
          <header><h3>Follow a market</h3><em>Price tracker</em></header>
          <p>Open the stored league timeline for any item in the normalized PoE 2 market catalogue.</p>
          <dl>
            <div><dt>Tracked markets</dt><dd>{trackedMarkets || "Loading…"}</dd></div>
            <div><dt>Recent resolution</dt><dd>Hourly for 7 days</dd></div>
            <div><dt>Retention</dt><dd>Up to 430 days</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("prices")}>Open Price tracker</button>
        </section>
        <section className="p2ov-desk">
          <header><h3>Read completed exchange flow</h3><em>Currency Exchange</em></header>
          <p>Rank real cleared volume, inspect the hour’s traded range, compare poe.ninja quotes, and review liquid two-leg routes.</p>
          <dl>
            <div><dt>Completed pairs</dt><dd>{exchangePairs || "Starts next fetch"}</dd></div>
            <div><dt>Resolution</dt><dd>Official hourly digest</dd></div>
            <div><dt>Thin-route guard</dt><dd>10 Exalted per leg</dd></div>
          </dl>
          <button type="button" onClick={() => onOpenTab("exchange")}>Open Currency Exchange</button>
        </section>
      </div>

      <section className="p2ov-attention" aria-label="PoE 2 data quality and roadmap">
        <button type="button" onClick={feature.open}>
          <span>Price coverage</span>
          <strong>{coverage ? `${coverage.priced}/${coverage.total} boss-market items priced` : "Checking boss price coverage"}</strong>
          <small>{coverage?.missing.length ? `${coverage.missing.length} items currently need a market quote.` : "Every configured challenge-league item contributes when pricing is available."}</small>
        </button>
        <div><span>Timing</span><strong>No hidden default TTK</strong><small>Profit/hour appears only after you create or select a custom timing profile.</small></div>
        <button type="button" onClick={() => onOpenTab("prices")}><span>Market storage</span><strong>Reusable normalized snapshots</strong><small>Current source metadata and bounded timelines are available to future PoE 2 features.</small></button>
      </section>
    </main>
  );
}

const css = `
.p2ov-main{display:grid;gap:14px}.p2ov-source{margin:0}.p2ov-head{padding:22px 24px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2ov-kicker{color:#e36838;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.p2ov-head h2{margin:5px 0 4px;color:#f0ded5;font-size:27px}.p2ov-head p{margin:0;color:#9c867c;font-size:14px}
.p2ov-briefing{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.7fr);gap:14px}.p2ov-feature{display:grid;gap:11px;min-height:285px;padding:20px;border:1px solid #5a3020;border-radius:8px;background:radial-gradient(circle at 85% 5%,#35170d 0,transparent 38%),#120d0b}.p2ov-feature-top{display:flex;justify-content:space-between;gap:12px;color:#d06b40;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2ov-feature-top em{color:#8d776d;font-style:normal}.p2ov-feature h3{max-width:720px;margin:5px 0 0;color:#f0ded5;font-size:24px;line-height:1.15}.p2ov-number{display:flex;align-items:baseline;gap:9px}.p2ov-number strong{font-size:34px}.p2ov-number span{color:#9c867c;font-size:13px}.p2ov-feature>p{max-width:780px;margin:0;color:#ad968b;font-size:14px;line-height:1.55}.p2ov-feature-bottom{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-top:auto}.p2ov-feature-bottom>div{display:flex;flex-wrap:wrap;gap:6px}.p2ov-feature-bottom span{padding:5px 8px;border:1px solid #3d291f;border-radius:4px;color:#a98f82;font-size:11.5px}.p2ov-feature button,.p2ov-desk button{padding:9px 12px;border:1px solid #7b3e24;border-radius:5px;background:#20120d;color:#e4b49e;font:inherit;font-size:13px;cursor:pointer}
.p2ov-signal{display:grid;align-content:start;overflow:hidden;border:1px solid #3e281e;border-radius:8px;background:#110c0a}.p2ov-signal>*{display:grid;gap:5px;padding:17px;border:0;border-bottom:1px solid #312119;background:transparent;text-align:left}.p2ov-signal button{color:inherit;font:inherit;cursor:pointer}.p2ov-signal span{color:#947b70;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase}.p2ov-signal strong{color:#e4d1c7;font-size:16px}.p2ov-signal em{color:#79bd72;font-size:18px;font-style:normal;font-weight:700}.p2ov-signal small{color:#8f796f;font-size:12px}
.p2ov-section-title{margin:8px 0 0;color:#d7beb2;font-size:17px}.p2ov-desks{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.p2ov-desk{display:grid;gap:12px;padding:17px;border:1px solid #3b281f;border-radius:7px;background:#120d0b}.p2ov-desk header{display:flex;align-items:start;justify-content:space-between;gap:10px}.p2ov-desk h3{margin:0;color:#e7d4ca;font-size:18px}.p2ov-desk header em{color:#c96d47;font-size:10.5px;font-style:normal;letter-spacing:.1em;text-transform:uppercase}.p2ov-desk>p{margin:0;color:#9f887d;font-size:13.5px;line-height:1.45}.p2ov-desk dl{display:grid;gap:7px;margin:0}.p2ov-desk dl div{display:flex;justify-content:space-between;gap:16px;padding-top:7px;border-top:1px solid #2b1d17}.p2ov-desk dt{color:#88736a;font-size:12px}.p2ov-desk dd{margin:0;color:#d9c1b5;font-size:12.5px;text-align:right}.p2ov-desk button{width:max-content}
.p2ov-attention{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;border:1px solid #39271f;border-radius:7px;background:#0f0b09}.p2ov-attention>*{display:grid;gap:4px;min-width:0;padding:14px;border:0;border-right:1px solid #302019;background:transparent;text-align:left}.p2ov-attention>*:last-child{border-right:0}.p2ov-attention button{font:inherit;cursor:pointer}.p2ov-attention span{color:#a36e55;font-size:10px;letter-spacing:.12em;text-transform:uppercase}.p2ov-attention strong{color:#d9c4ba;font-size:13.5px}.p2ov-attention small{color:#846f66;font-size:11.5px;line-height:1.4}
@media(max-width:900px){.p2ov-briefing{grid-template-columns:1fr}.p2ov-attention{grid-template-columns:1fr}.p2ov-attention>*{border-right:0;border-bottom:1px solid #302019}.p2ov-attention>*:last-child{border-bottom:0}}@media(max-width:560px){.p2ov-head{padding:18px}.p2ov-feature{padding:17px}.p2ov-feature-bottom{align-items:stretch;flex-direction:column}.p2ov-feature-bottom button{width:100%}}
`;
