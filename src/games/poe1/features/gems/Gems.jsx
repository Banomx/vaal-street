import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import {
  CORRUPT, GCP_NAME, VAAL_ORB_NAME, XP_FAMILIES, XP_PER_QUALITY,
  buildGems, computeGem, levellingTime, loadSettings, saveSettings, sanitizeSettings, tierLabel,
} from "./gems.js";
import PriceCell from "../pricing/PriceCell.jsx";
import PriceChart, { PctBadge, Sparkline, rateAt, realPct } from "../pricing/PriceChart.jsx";
import { unitForSeries } from "../pricing/money.js";
import { nearestHistoryWindow } from "../pricing/marketWindows.js";
import { POE1_SCHEMA_VERSIONS, requiredFields } from "../../config.js";
import { isUsable, loadDocument } from "../../../../shared/data/snapshot.js";

/* ================================================================
   GEM LEVELLING
   What a gem is worth once you have levelled it, and whether a Vaal
   Orb on top is worth the risk.

   The list ranks every gem poe.ninja prices by the profit on one
   cycle: buy at level 1, level to the cap, then take the better of
   selling it or corrupting it. Opening a row gives it the mechanic
   panel treatment — profit charted across the league on the left,
   the corruption outcome table on the right.

   Listing counts are shown next to every price and are the reason
   this tab exists in the shape it does: a 21/20 quoted off two asks
   is a number, not a market, and the profit built on it does not
   clear. See this feature's gems.js for the corruption weights.
   ================================================================ */

const SORTS = [
  ["perHour", "Profit per hour"],
  ["profit", "Profit"],
  ["roi", "Return on what you spend"],
  ["target", "Levelled price"],
  ["listings", "Listings"],
  ["name", "Name"],
];

const PATHS = [
  ["best", "Best route"],
  ["level", "Just level it"],
  ["vaal", "Level, then vaal"],
];

const pct = (v) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%`);

/* Levelling times run from six minutes to over an hour, so neither raw
   minutes nor hours reads well across the whole list. */
const fmtMinutes = (m) => {
  if (m == null || !isFinite(m)) return "—";
  if (m < 90) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(Math.round(m - h * 60)).padStart(2, "0")}m`;
};
const fmtXp = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${Math.round(n / 1e6)}M`);

/* Where a default needs its provenance attached to it. A number someone else
   measured is only usable if you can see what they measured it on, and that
   does not fit on a toolbar. */
const XP_RATE_NOTE = "Default is 134.3M in 13 minutes — one full timed Simulacrum run, character level 100, gem at 0% quality. A slower farm or a lower character means a lower number here.";
/* Six gems, and only six. Every other gem's quality does something else
   entirely, so raising this box does not shorten their levelling time by a
   second — worth saying on the control rather than only in the panel. */
const XP_QUALITY_NOTE = "Only Empower, Enhance, Enlighten and their Awakened versions level faster with quality — their quality reads \"This Gem gains (5-100)% increased Experience\", i.e. 5% per point. Every other gem's quality does something else and this box does not touch its levelling time. This is the quality the gem carries WHILE levelling, not what you sell it at: 20 from prisms plus 10 from a matching socket colour.";

function InfoDot({ text }) {
  return <span className="gm-info" tabIndex={0} role="note" aria-label={text} title={text}>i</span>;
}

/* `live` commits on every keystroke instead of on blur. Worth it only where
   something next to the box restates the value in other terms — the quality
   field, which reads out as an experience percentage — because there the whole
   point is watching the second number follow the first. */
function NumInput({ value, onCommit, step = 1, min = 0, width = 62, suffix, title, live = false }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => { setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="gm-num" title={title}>
      <input type="number" step={step} min={min} value={draft} style={{ width }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!live) return;
          const n = Number(e.target.value);
          if (e.target.value !== "" && isFinite(n) && n >= min) onCommit(n);
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === "" || !isFinite(n)) { setDraft(String(value ?? "")); return; }
          onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

function historyMove(points, window, rateHistory, adjusted) {
  const match = nearestHistoryWindow(points, window);
  if (!match || !(match.reference.value > 0) || !(match.last.value > 0)) return null;
  if (!adjusted) return (match.last.value / match.reference.value - 1) * 100;
  return realPct(
    match.reference.value, rateAt(rateHistory, match.reference.day),
    match.last.value, rateAt(rateHistory, match.last.day),
  );
}

export default function Gems({
  league, staticBase, currency, divineRate, fmtPrice, fmtChaos, unitFor,
  changeWindow, realMode, rateReady, rateHistory = [],
}) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [sortBy, setSortBy] = useState("perHour");
  const [sortDir, setSortDir] = useState("desc");
  const [pathFilter, setPathFilter] = useState("best");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(null);          // gem name whose panel is open
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [dragSel, setDragSel] = useState(null);
  const [gemData, setGemData] = useState(null);    // gems.json | "missing"
  const [hist, setHist] = useState({});            // name -> [{day, value}]
  const [prices, setPrices] = useState(null);      // prices.json map | "missing"

  useEffect(() => { saveSettings(settings); }, [settings]);
  const patch = useCallback((p) => setSettings((s) => sanitizeSettings({ ...s, ...p })), []);

  useEffect(() => {
    if (!staticBase) return undefined; // no league folder yet
    let cancelled = false;
    /* Same revalidation rule as the other generated files: the URL does not
       change between hourly deployments. A file that fails its schema contract
       is treated as absent here rather than rendered — Poe1App validates the
       same tree and is the one that explains why on screen. */
    const grab = async (file, set, options) => {
      const doc = await loadDocument(`${staticBase}/${file}`, { supported: POE1_SCHEMA_VERSIONS, ...options });
      if (!cancelled) set(isUsable(doc) ? doc.data : "missing");
    };
    setGemData(null); setHist({}); setPrices(null); setOpen(null);
    grab("gems.json", setGemData, { required: requiredFields("gems") });
    grab("gems-history.json", (j) => { if (j !== "missing") setHist(j); }, { versioned: false });
    grab("prices.json", (j) => setPrices(j === "missing" ? "missing" : (j.prices || {})), { required: requiredFields("prices") });
    return () => { cancelled = true; };
  }, [staticBase]);

  const snapshot = gemData && gemData !== "missing" ? gemData : null;
  const rate = snapshot?.divineRate || divineRate;
  const money = useCallback((c) => fmtPrice(c, currency, rate), [fmtPrice, currency, rate]);

  /* The snapshot records the two currency prices it used, so a chart point and
     the row above it were computed against the same market. prices.json is the
     live fallback when a snapshot predates gems.json carrying them. */
  const priceMap = prices && prices !== "missing" ? prices : null;
  const gcp = snapshot?.gcp || priceMap?.[GCP_NAME]?.c || 0;
  const vaalOrb = snapshot?.vaalOrb || priceMap?.[VAAL_ORB_NAME]?.c || 0;

  const { gems, byName } = useMemo(() => buildGems(snapshot?.gems || []), [snapshot]);

  const rows = useMemo(() => gems.map((g) => computeGem(g, {
    gcp, vaalOrb, byName,
    vaalSlot: settings.vaalSlot,
    overrides: settings.priceOverrides || {},
    xpPerMinute: settings.xpPerMinute,
    xpQuality: settings.xpQuality,
    xpTotals: settings.xpTotals || {},
  })), [gems, byName, gcp, vaalOrb, settings.vaalSlot, settings.priceOverrides,
        settings.xpPerMinute, settings.xpQuality, settings.xpTotals]);

  const thin = useCallback((r) => r.listingFloor != null && r.listingFloor < settings.thinListings, [settings.thinListings]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = rows.filter((r) => !r.unpriced);
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    if (settings.minTargetPrice > 0) out = out.filter((r) => r.target.chaos >= settings.minTargetPrice);
    if (settings.hideThin) out = out.filter((r) => !thin(r));
    if (pathFilter !== "best") out = out.filter((r) => (pathFilter === "vaal" ? r.vaalProfit != null : r.levelProfit != null));
    const value = (r) => {
      const profit = pathFilter === "level" ? r.levelProfit : pathFilter === "vaal" ? r.vaalProfit : r.profit;
      switch (sortBy) {
        case "perHour": return r.profitPerHour ?? -Infinity;
        case "roi": return r.roi ?? -Infinity;
        case "target": return r.target.chaos;
        case "listings": return r.listingFloor ?? -Infinity;
        case "name": return r.name;
        default: return profit ?? -Infinity;
      }
    };
    const dir = sortDir === "desc" ? -1 : 1;
    return [...out].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }, [rows, filter, settings.minTargetPrice, settings.hideThin, thin, pathFilter, sortBy, sortDir]);

  const adjustedMoves = realMode && rateReady;
  const changes = useMemo(() => {
    const out = {};
    for (const [name, points] of Object.entries(hist)) {
      out[name] = historyMove(points, changeWindow, rateHistory, adjustedMoves);
    }
    return out;
  }, [hist, changeWindow, rateHistory, adjustedMoves]);

  const openRow = visible.find((r) => r.name === open) || rows.find((r) => r.name === open) || null;

  const setPriceOverride = useCallback((item, chaos) => {
    setSettings((s) => {
      const po = { ...(s.priceOverrides || {}) };
      if (chaos == null) delete po[item];
      else po[item] = chaos;
      return sanitizeSettings({ ...s, priceOverrides: po });
    });
  }, []);

  const reset = () => setSettings(sanitizeSettings({}));

  /* Used by the Assumptions table so each family shows what its current
     numbers actually work out to, rather than only the raw experience total. */
  const xpFor = useCallback((family) => levellingTime(family.cap, {
    isSupport: family.support === true,
    xpPerMinute: settings.xpPerMinute, xpQuality: settings.xpQuality, xpTotals: settings.xpTotals || {},
  }), [settings.xpPerMinute, settings.xpQuality, settings.xpTotals]);

  const series = useMemo(() => {
    if (!openRow) return [];
    const points = hist[openRow.name] || [];
    return points.map((p) => ({
      day: p.day, value: p.value, chaos: p.value, rate: rateAt(rateHistory, p.day),
    }));
  }, [openRow, hist, rateHistory]);
  const seriesUnit = unitForSeries(series.map((r) => r.chaos), currency, rate);
  const seriesScaled = useMemo(
    () => (seriesUnit === "chaos" ? series : series.map((r) => ({ ...r, value: r.value / rate }))),
    [series, seriesUnit, rate],
  );

  if (gemData === "missing") {
    return (
      <section className="gm-wrap">
        <div className="st-banner">
          No gem snapshot for {league} yet. This tab needs <code>gems.json</code>, which the data workflow
          writes alongside the scarab and price data — it appears after the next refresh.
        </div>
      </section>
    );
  }
  if (!snapshot) return <section className="gm-wrap"><div className="st-banner st-quiet">Loading gem prices…</div></section>;

  return (
    <section className="gm-wrap">
      <div className="st-banner st-quiet">
        Prices via {snapshot.priceSource || "poe.ninja"} · {league}
        {snapshot.generatedAt ? ` · updated ${new Date(snapshot.generatedAt).toLocaleString()}` : ""}
        {" · "}1 Divine ≈ {Math.round(rate)} Chaos
        {gcp > 0 && <> · 1 {GCP_NAME} {fmtChaos(gcp)}c</>}
        {vaalOrb > 0 && <> · 1 {VAAL_ORB_NAME} {fmtChaos(vaalOrb)}c</>}
      </div>

      {/* ---------- bar ---------- */}
      <div className="gm-bar">
        <input className="gm-search" type="search" placeholder="Filter gems…"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="gm-seg" role="group" aria-label="Which path to rank by">
          {PATHS.map(([key, label]) => (
            <button key={key} className={pathFilter === key ? "on" : ""} onClick={() => setPathFilter(key)}>{label}</button>
          ))}
        </div>
        <label className="gm-field">
          <span>Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button className="gm-dir" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          title="Reverse the sort">{sortDir === "desc" ? "↓" : "↑"}</button>
        <label className="gm-field" title="A market with fewer listings than this is called thin. poe.ninja quotes a listing floor, so a handful of asks can be one optimistic seller.">
          <span>Thin below</span>
          <NumInput value={settings.thinListings} step={5} onCommit={(n) => patch({ thinListings: n })} suffix="listings" />
        </label>
        <label className="gm-check">
          <input type="checkbox" checked={settings.hideThin} onChange={(e) => patch({ hideThin: e.target.checked })} />
          Hide thin markets
        </label>
        {/* The two inputs behind "profit per hour". They live on the bar rather
            than only in Assumptions because they are the numbers most likely to
            be wrong for someone else's farm, and a panel nobody opens is the
            same as no setting at all. */}
        <label className="gm-field">
          <span>Gem xp</span>
          <NumInput value={Math.round(settings.xpPerMinute / 1e6 * 10) / 10} step={0.5} width={58}
            suffix="M/min" onCommit={(n) => patch({ xpPerMinute: n * 1e6 })} />
          <InfoDot text={XP_RATE_NOTE} />
        </label>
        <label className="gm-field">
          <span>Levelling quality</span>
          <NumInput value={settings.xpQuality} step={5} width={46} suffix="%" live
            onCommit={(n) => patch({ xpQuality: n })} />
          <InfoDot text={XP_QUALITY_NOTE} />
          <em title="Applied to Empower, Enhance, Enlighten and their Awakened versions only">
            +{settings.xpQuality * XP_PER_QUALITY}% xp
          </em>
        </label>
        <div className="gm-bar-actions">
          <button className="gm-assume-btn" onClick={() => setShowAssumptions((v) => !v)}>
            {showAssumptions ? "Hide assumptions" : "Assumptions"}
          </button>
          <button className="gm-reset" onClick={reset}>Reset settings</button>
        </div>
      </div>

      {showAssumptions && (
        <section className="gm-assume">
          <h3>What the numbers assume</h3>
          <p>
            One cycle is: buy the gem at level 1, level it to {"its cap"}, then either sell it or spend a{" "}
            {VAAL_ORB_NAME} on it. Levelling itself costs nothing but time, which is not priced here —
            this is profit per gem, never profit per hour.
          </p>
          <ul>
            <li>
              <strong>Input cost</strong> is the cheaper of buying the quality gem at level 1 outright, or
              buying it bare and spending {"the prisms"} yourself at {gcp > 0 ? `${fmtChaos(gcp)}c` : "the current"} each.
              The row says which one won.
            </li>
            <li>
              <strong>Corruption</strong> follows the published weights: 1/4 no effect, 1/4 level ±1,
              1/4 quality ±1–10 capped at {CORRUPT.qualityMax}%, 1/4 the gem becomes its Vaal version.
              So +1 level is 1/8, and a 20% gem that rolls quality upward lands on {CORRUPT.qualityMax}%
              eight times in ten.
            </li>
            <li>
              <strong>Gems with no Vaal version</strong> — every support, the Awakened gems, Empower,
              Enhance and Enlighten — have nothing to transform into.
              <label className="gm-check gm-inline">
                <input type="radio" name="gm-vaal-slot" checked={settings.vaalSlot === "none"}
                  onChange={() => patch({ vaalSlot: "none" })} />
                that quarter does nothing
              </label>
              <label className="gm-check gm-inline">
                <input type="radio" name="gm-vaal-slot" checked={settings.vaalSlot === "redistribute"}
                  onChange={() => patch({ vaalSlot: "redistribute" })} />
                only three effects, 1/3 each
              </label>
              <em>
                The first keeps +1 level at the documented 1/8 and is the default; the second reads
                “each possible effect” strictly and puts it at 1/6. The wiki does not settle it.
              </em>
            </li>
            <li>
              <strong>Prices poe.ninja does not list</strong> — a corrupted 20/14, say — fall back to the
              nearest cheaper listed variant at the same level, and the row is badged <em className="gm-badge">approx</em>.
              That is most of the quality-down band, which is why its value is a floor rather than a quote.
            </li>
            <li>
              <strong>Alternate quality</strong> (Anomalous, Divergent, Phantasmal) is excluded. You cannot
              Gemcutter a Superior gem into one, so it is a different trade with a different input.
            </li>
            <li>
              <strong>Profit per hour</strong> divides the profit by how long the gem occupies a socket.
              That is per <strong>gem slot</strong> — run six in a six-link and the real figure is six times this,
              but every row scales the same way so the order does not change.
              <div className="gm-xp">
                <em className="note">
                  Both inputs are on the toolbar above. <b>Gem xp</b> is your own rate — the default,{" "}
                  <b>134.3M in 13 minutes</b>, is one full timed Simulacrum run on a level 100 character with
                  the gem at 0% quality, so a slower farm or a lower character wants a lower number.{" "}
                  <b>Levelling quality</b> is what the gem carries while it levels rather than what you sell
                  it at — currently {settings.xpQuality}%, worth {settings.xpQuality * XP_PER_QUALITY}%
                  increased experience, and <b>only</b> to Empower, Enhance, Enlighten and their Awakened
                  versions (the two rows badged below). Those six are the gems whose quality reads “This Gem
                  gains (5-100)% increased Experience”; on every other gem quality does something else and
                  this box changes nothing.
                </em>
              </div>
              <table className="gm-xp-table">
                <thead>
                  <tr><th>Gem</th><th className="r">Levels to</th><th className="r">Total experience</th><th className="r">Time each</th></tr>
                </thead>
                <tbody>
                  {XP_FAMILIES.map((f) => {
                    const t = xpFor(f);
                    return (
                      <tr key={f.key}>
                        <td>
                          {f.label}
                          {f.qualityXp && <em className="gm-badge" title={`Quality on these gems reads "This Gem gains (5-100)% increased Experience" — ${XP_PER_QUALITY}% per point`}>quality xp</em>}
                          {f.unconfirmed && <em className="gm-badge warn" title="poewiki's figure, not checked against the game">unconfirmed</em>}
                        </td>
                        <td className="r num">{f.cap}</td>
                        <td className="r num">
                          <NumInput value={(settings.xpTotals || {})[f.key] || f.xp} step={1e6} width={112}
                            onCommit={(n) => patch({ xpTotals: { ...(settings.xpTotals || {}), [f.key]: n } })} />
                        </td>
                        <td className="r num">{fmtMinutes(t?.minutes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <em>
                Totals are cumulative experience from level 1. A gem picks its row by level cap, plus
                whether its name ends in “Support” — the two cap-20 curves differ. No gem-name list.
              </em>
            </li>
            <li>
              <strong>The profit curve</strong> is what the model saw at each hourly snapshot under these
              defaults. Overrides and the setting above move today's row, not the history.
            </li>
          </ul>
        </section>
      )}

      {!visible.length && (
        <div className="st-cat-note">
          No gem matches the current filters{settings.hideThin ? " — thin markets are hidden" : ""}.
        </div>
      )}

      {!!visible.length && (
        <>
        <p className="gm-legend">
          One cycle: <strong>buy the gem at level 1</strong> → level it to its cap → then either
          <strong> sell it as it is</strong> or <strong>put a {VAAL_ORB_NAME} on it</strong>.
          {" "}<em>If you hit +1 level</em> is what the jackpot alone sells for — you get it one time in eight.
          {" "}<em>Worth after vaaling</em> is what an orb is worth on average once the bricks are counted in
          too, so that is the number to compare against selling it levelled. Profit takes whichever of the
          two routes pays more, and the tag under each gem says which one won.
        </p>
        <div className="gm-table-wrap">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Gem</th>
                <th className="r">Buy it at<i>level 1</i></th>
                <th className="r">Sell it levelled<i>no corruption</i></th>
                <th className="r">If you hit +1 level<i>1 roll in 8</i></th>
                <th className="r">Worth after vaaling<i>average of every outcome</i></th>
                <th className="r">Profit<i>best route</i></th>
                <th className="r">Profit per hour<i>of levelling time</i></th>
                <th className="r">Return<i>on what you spend</i></th>
                <th className="r">Listings<i>thinnest market</i></th>
                <th className="r">Change<i>{changeWindow}{adjustedMoves ? " · divine-adjusted" : ""}</i></th>
                <th className="r">Trend</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const profit = pathFilter === "level" ? r.levelProfit : pathFilter === "vaal" ? r.vaalProfit : r.profit;
                const spark = (hist[r.name] || []).slice(-14).map((p) => p.value);
                const fallbackSpark = spark.length < 3 ? (r.spark || []) : null;
                const isOpen = open === r.name;
                return (
                  <Fragment key={r.name}>
                    <tr className={`gm-row${isOpen ? " on" : ""}${thin(r) ? " thin" : ""}`}
                      onClick={() => setOpen(isOpen ? null : r.name)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : r.name); } }}>
                      <td>
                        <span className="gm-name">{r.name}</span>
                        <small>
                          {/* Both routes are badged, not just the vaal one: with only
                              "vaal it" on the page, a row with no badge could mean
                              either "sell it" or "the route filter is not on best". */}
                          {r.path === "vaal" && pathFilter === "best" && <em className="gm-badge vaal" title="The vaal average beats selling it uncorrupted">vaal it</em>}
                          {r.path === "level" && pathFilter === "best" && <em className="gm-badge level" title="Selling it levelled beats the vaal average — no orb, no bricks">level &amp; sell</em>}
                          {r.approx && <em className="gm-badge" title="A price carrying this row is substituted from a nearby variant poe.ninja does list">approx</em>}
                          {thin(r) && <em className="gm-badge warn" title={`Fewer than ${settings.thinListings} listings on a market this profit depends on`}>thin</em>}
                        </small>
                      </td>
                      <td className="r num">
                        {r.input.chaos > 0 ? money(r.input.chaos) : "—"}
                        <small>{r.input.label || "not listed"}</small>
                      </td>
                      <td className="r num">
                        {r.target.chaos > 0 ? money(r.target.chaos) : "—"}
                        <small>{tierLabel(r.maxLevel, r.maxQuality)}</small>
                      </td>
                      <td className="r num">
                        {r.levelUp?.chaos > 0 ? money(r.levelUp.chaos) : "—"}
                        <small>{tierLabel(r.maxLevel + 1, r.maxQuality)} corrupted</small>
                      </td>
                      <td className="r num"
                        title={`Every corruption outcome weighted by its chance, jackpot and bricks together — not the +1 price. Compare it against the ${money(r.target.chaos)} the plain ${tierLabel(r.maxLevel, r.maxQuality)} sells for.`}>
                        {r.corruptEV > 0 ? money(r.corruptEV) : "—"}
                        <small>{r.brickChance == null ? "" : `${pct(r.brickChance)} roll below ${tierLabel(r.maxLevel, r.maxQuality)}`}</small>
                      </td>
                      <td className={`r num ${profit > 0 ? "pos" : profit < 0 ? "neg" : ""}`}>
                        {profit == null ? "—" : `${profit > 0 ? "+" : ""}${money(profit)}`}
                        <small>{r.path === "vaal" ? "level, then vaal" : "level, then sell"}</small>
                      </td>
                      <td className={`r num ${r.profitPerHour > 0 ? "pos" : r.profitPerHour < 0 ? "neg" : ""}`}
                        title={r.xp ? `${fmtXp(r.xp.total)} xp to reach ${tierLabel(r.maxLevel, r.maxQuality)}${r.xp.bonus ? `, ${Math.round(r.xp.bonus * 100)}% increased by quality` : ""}` : undefined}>
                        {r.profitPerHour == null ? "—" : `${r.profitPerHour > 0 ? "+" : ""}${money(r.profitPerHour)}`}
                        <small>{fmtMinutes(r.xp?.minutes)} per gem</small>
                      </td>
                      <td className="r num">{r.roi == null ? "—" : pct(r.roi)}</td>
                      <td className="r num">{r.listingFloor == null ? "—" : r.listingFloor}</td>
                      <td className="r gm-change-cell">
                        <PctBadge v={changes[r.name]} real={adjustedMoves && changes[r.name] != null} />
                      </td>
                      <td className="r gm-spark-cell">
                        {spark.length >= 3
                          ? <Sparkline values={spark} title={`${r.name}: profit over the last ${spark.length} snapshots`} />
                          : <Sparkline values={fallbackSpark} tone="#8d8371"
                              title={`${r.name}: poe.ninja's 7-day price trend — profit history starts after a few refreshes`} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="gm-panel-row">
                        <td colSpan={11}>
                          <GemPanel row={r} series={seriesScaled} seriesUnit={seriesUnit} money={money}
                            currency={currency} rate={rate} fmtChaos={fmtChaos} unitFor={unitFor}
                            dragSel={dragSel} setDragSel={setDragSel}
                            thinAt={settings.thinListings} onSetPrice={setPriceOverride}
                            overrides={settings.priceOverrides || {}} vaalOrb={vaalOrb}
                            change={changes[r.name]} changeWindow={changeWindow}
                            realMode={adjustedMoves} rateReady={rateReady} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

function GemPanel({
  row, series, seriesUnit, money, currency, rate, fmtChaos, unitFor,
  dragSel, setDragSel, thinAt, onSetPrice, overrides, vaalOrb,
  change, changeWindow, realMode, rateReady,
}) {
  const cap = tierLabel(row.maxLevel, row.maxQuality);
  /* What the gem literally is after each roll, and what happened to it. The
     first is the thing you list on the trade site; the second is the rule it
     came from. Neither on its own reads clearly. */
  const resultTier = (o) => {
    if (o.vaal) return o.label;
    if (!o.parts) return `${tierLabel(o.level, o.quality)} corrupted`;
    const qs = o.parts.map((p) => p.quality).sort((a, b) => a - b);
    const lo = qs[0], hi = qs[qs.length - 1];
    const band = lo === hi ? `${lo}%` : `${lo}–${hi}%`;
    return row.maxQuality > 0
      ? `${o.level}/${band.replace("%", "")} corrupted`
      : `level ${o.level}, ${band} quality, corrupted`;
  };
  const resultRule = {
    same: "no change",
    levelUp: "+1 level",
    levelDown: "−1 level",
    qualityUp: "quality rolled up",
    qualityDown: "quality rolled down",
    vaal: "becomes the Vaal gem",
  };
  return (
    <div className="gm-panel">
      <div className="gm-panel-main">
        <PriceChart
          rows={series}
          cur={seriesUnit}
          label={<>Profit per gem · {row.name}</>}
          seriesName="profit"
          axisLabel="league day"
          height={200}
          dragSel={dragSel} setDragSel={setDragSel}
          realMode={realMode} rateReady={rateReady}
          extra={<span> · {changeWindow} <PctBadge v={change} real={realMode && change != null} /></span>}
          empty="The profit curve builds up with each data refresh — check back after a couple of runs."
        />
        <p className="gm-panel-note">
          The curve is the profit this model saw at each snapshot under the default assumptions. Your
          overrides and the Vaal-slot setting move the figures below, not the history.
        </p>

        <div className="gm-stats">
          <div className="gm-stat">
            <span>What it costs you</span>
            <strong>{row.input.chaos > 0 ? money(row.input.chaos) : "—"}</strong>
            <em>{row.input.label || "nothing listed at level 1"}</em>
          </div>
          <div className="gm-stat">
            <span>Level it, sell it</span>
            <strong className={row.levelProfit > 0 ? "pos" : row.levelProfit < 0 ? "neg" : ""}>
              {row.levelProfit == null ? "—" : `${row.levelProfit > 0 ? "+" : ""}${money(row.levelProfit)}`}
            </strong>
            <em>sells at {row.target.chaos > 0 ? money(row.target.chaos) : "—"} as {cap}</em>
          </div>
          <div className="gm-stat">
            <span>Level it, then vaal it</span>
            <strong className={row.vaalProfit > 0 ? "pos" : row.vaalProfit < 0 ? "neg" : ""}>
              {row.vaalProfit == null ? "—" : `${row.vaalProfit > 0 ? "+" : ""}${money(row.vaalProfit)}`}
            </strong>
            <em>{money(row.corruptEV)} average − {money(row.input.chaos)} gem − {money(vaalOrb)} orb</em>
          </div>
          <div className="gm-stat">
            <span>Time to level it</span>
            <strong>{fmtMinutes(row.xp?.minutes)}</strong>
            <em>
              {row.xp
                ? <>{fmtXp(row.xp.total)} xp{row.xp.bonus ? `, ${Math.round(row.xp.bonus * 100)}% increased by quality` : ""}</>
                : "no experience baseline for this level cap"}
            </em>
          </div>
          <div className="gm-stat">
            <span>Chance you end up worse off</span>
            <strong className={row.brickChance > 0.5 ? "neg" : ""}>{pct(row.brickChance)}</strong>
            <em>corruptions worth less than the {cap} you already had</em>
          </div>
        </div>

        {!!row.input.options.length && (
          <div className="gm-inputs">
            <span>{row.input.options.length > 1 ? "Two ways to buy it" : "How you buy it"}</span>
            {row.input.options.map((o) => (
              <em key={o.kind} className={o.kind === row.input.kind ? "on" : ""}>
                {o.label} · {money(o.chaos)}
                {o.listings != null && <b> · {o.listings} listed</b>}
              </em>
            ))}
            <span className="gm-inputs-set">
              using <PriceCell item={row.input.item} chaos={row.input.chaos} overridden={row.input.overridden}
                entry={null} onSet={onSetPrice} money={money} />
            </span>
          </div>
        )}
      </div>

      <div className="gm-panel-side">
        <h4>What one {VAAL_ORB_NAME} on the {cap} can turn it into</h4>
        <table className="gm-outcomes">
          <thead>
            <tr>
              <th>You end up with</th><th className="r">Chance</th><th className="r">Sells for</th>
              <th className="r">Listed</th><th className="r">Adds to average</th>
            </tr>
          </thead>
          <tbody>
            {row.outcomes.map((o) => (
              <tr key={o.key} className={o.chaos > 0 ? "" : "unpriced"}>
                <td>
                  {resultTier(o)}
                  {!o.exact && <em className="gm-badge" title="poe.ninja lists no market for this exact variant, so the price is substituted from the nearest one it does">approx</em>}
                  <small>{resultRule[o.key]}</small>
                </td>
                <td className="r num">{pct(o.p)}</td>
                <td className="r num">
                  {o.item
                    ? <PriceCell item={o.item} chaos={o.chaos} overridden={!!o.overridden}
                        entry={o.listings != null ? { n: o.listings, thin: o.listings < thinAt } : null}
                        onSet={onSetPrice} money={money} />
                    : (o.chaos > 0 ? money(o.chaos) : "—")}
                </td>
                <td className={`r num${o.listings != null && o.listings < thinAt ? " warn" : ""}`}>
                  {o.listings == null ? "—" : o.listings}
                </td>
                <td className="r num ev">{money(o.p * o.chaos)}</td>
              </tr>
            ))}
            <tr className="gm-outcome-total">
              <td>Vaal average<small>what one orb is worth on average</small></td>
              <td className="r num">100%</td><td /><td />
              <td className="r num ev">{money(row.corruptEV)}</td>
            </tr>
          </tbody>
        </table>
        <p className="gm-panel-note">
          Click any price to correct it. A row covering a range of quality rolls is an average over the
          nearest variants poe.ninja does list, not a market of its own, so those cannot be overridden.
        </p>
      </div>
    </div>
  );
}
