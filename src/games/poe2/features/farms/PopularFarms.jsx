import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { fmtPrice } from "../bosses/bossProfit.js";
import { buildTabletFamilies, sortTabletRows, tabletFamilyTimeline } from "./tabletFarms.js";
import { windowEvidence } from "../../shared/marketWindow.js";
import { curatedCoverage, EXPEDITION_ENTRY_NOTE, FAMILY_LABELS, FAMILY_ORDER, FLOOR_NOTE, hasOutputPool, mechanicPools, NEUTRAL_NOTE, TONES, DEFERRED } from "./mechanics.js";
import { farmSignal, liquidity, poolContributions, poolFlow, poolMovers, topOfPool, WEIGHT_MODES } from "./farmIndex.js";

const RANGES = [
  [1, "1h"], [2, "2h"], [4, "4h"], [8, "8h"], [12, "12h"],
  [24, "24h"], [48, "48h"], [72, "3d"], [168, "7d"], [336, "14d"], [720, "30d"], [null, "All"],
];

function number(value, digits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${number(value * 100, digits)}%`;
}

/* Percentage points of the index move, not a percentage of the market itself. */
function points(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const pp = value * 100;
  /* Anything this small rounds to zero, and a signed "-0pp" reads as a real
     move in the wrong direction. */
  if (Math.abs(pp) < .005) return "0pp";
  return `${pp > 0 ? "+" : ""}${number(pp, Math.abs(pp) >= 10 ? 1 : 2)}pp`;
}

function tone(value) {
  return value > 0 ? "gain" : value < 0 ? "loss" : "";
}

function tick(value, rangeHours) {
  const date = new Date(value);
  return rangeHours && rangeHours <= 168
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceText(league, priceData, history, rateSummary) {
  if (!priceData) return "Loading PoE 2 tablet prices…";
  if (priceData === "missing") return `PoE 2 tablet prices unavailable · ${league}`;
  const count = history?.timestamps?.length || 0;
  return `Tablet and mechanic markets · ${league} · ${count} ${count === 1 ? "snapshot" : "snapshots"} · updated ${new Date(priceData.generatedAt).toLocaleString()}${rateSummary ? ` · ${rateSummary}` : ""}`;
}

function sourceLabel(entry) {
  if (entry?.source === "poe.ninja stash") return "poe.ninja listings";
  if (entry?.source === "GGG completed trades") return "GGG trades";
  return entry?.source || "Unknown source";
}

function flowLabel(value) {
  if (!(value > 0)) return "No flow data";
  if (value >= 1e6) return `${number(value / 1e6, 1)}M ex/h`;
  if (value >= 1e3) return `${number(value / 1e3, 0)}k ex/h`;
  return `${number(value, 0)} ex/h`;
}

/* Cost and return are different quantities in different units, so they share an
   axis only after both are rebased to their own first point. The chart is about
   whether they are diverging, not about what either one is worth. */
function mergeSeries(entryPoints, indexPoints) {
  const byTime = new Map();
  const base = entryPoints[0]?.value;
  for (const point of entryPoints) {
    if (!(base > 0)) break;
    byTime.set(point.at, { at: point.at, entry: (point.value / base) * 100 });
  }
  for (const point of indexPoints) {
    byTime.set(point.at, { ...(byTime.get(point.at) || { at: point.at }), ret: point.value });
  }
  return [...byTime.values()].sort((left, right) => left.at - right.at);
}

/* Contribution first, because that is the ranking and it adds up to the index
   move on the card. The percentage stays beside it so a big relative swing on a
   cheap market is still legible — it just no longer decides the order. */
function MoverRow({ row, currency, divineExalted, chaosExalted }) {
  return <li>
    <span title={row.name}>{row.name}</span>
    <b>{fmtPrice(Number(row.entry.exalted) || 0, currency, divineExalted, chaosExalted)}</b>
    <em className={tone(row.contribution)} title="Share of the index move this market is responsible for">{points(row.contribution)}</em>
    <i className={tone(row.change)}>{pct(row.change, 0)}</i>
  </li>;
}

function TopRow({ row, currency, divineExalted, chaosExalted }) {
  return <li>
    <span title={row.name}>{row.name}</span>
    <b>{fmtPrice(Number(row.entry.exalted) || 0, currency, divineExalted, chaosExalted)}</b>
    <em className={row.market.tone} title={row.market.label}>{row.market.count ? `${number(row.market.count, 0)} ${row.market.unit}` : row.market.label}</em>
    <i className={tone(row.change)}>{pct(row.change, 0)}</i>
  </li>;
}

const POOL_COLUMNS = [
  ["name", "Market", (row) => row.name],
  ["price", "Price", (row) => Number(row.entry.exalted) || 0],
  ["volume", "Liquidity", (row) => row.market.count],
  ["weight", "Weight", (row) => row.weight],
  ["change", "Change", (row) => (row.change == null ? -Infinity : row.change)],
  ["contribution", "Contribution", (row) => (row.contribution == null ? -Infinity : row.contribution)],
];

/* The whole pool, because the shortlists above are a summary and a summary is
   what hid Omen of Chance in the first place. Every market the mechanic has is
   reachable here, including the ones too thin to headline a mover list. */
function PoolTable({ rows, currency, divineExalted, chaosExalted }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState({ key: "price", desc: true });
  const sorted = useMemo(() => {
    const read = POOL_COLUMNS.find(([key]) => key === sort.key)?.[2] || (() => 0);
    return [...rows].sort((left, right) => {
      const a = read(left);
      const b = read(right);
      const order = typeof a === "string" ? a.localeCompare(b) : a - b;
      return sort.desc ? -order : order;
    });
  }, [rows, sort]);

  if (!rows.length) return null;
  return <div className="p2pf-pool">
    <button type="button" className="p2pf-pool-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Hide" : `Show all ${rows.length}`} pool market{rows.length === 1 ? "" : "s"}
    </button>
    {open && <div className="p2pf-pool-scroll">
      <table className="p2pf-pool-table">
        <thead><tr>{POOL_COLUMNS.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
          <button type="button" onClick={() => setSort((value) => ({ key, desc: value.key === key ? !value.desc : true }))}>
            {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
          </button>
        </th>)}</tr></thead>
        <tbody>
          {sorted.map((row) => <tr key={row.name}>
            <td title={`${row.name} · ${sourceLabel(row.entry)}${row.entry.variant ? ` · ${row.entry.variant}` : ""}`}>{row.name}</td>
            <td>{fmtPrice(Number(row.entry.exalted) || 0, currency, divineExalted, chaosExalted)}</td>
            <td className={row.market.tone}>{row.market.count ? `${number(row.market.count, 0)} ${row.market.unit}` : row.market.label}</td>
            <td>{row.weight > 0 ? `${number(row.weight * 100, 1)}%` : "—"}</td>
            <td className={tone(row.change)}>{pct(row.change, 0)}</td>
            <td className={tone(row.contribution)}>{points(row.contribution)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </div>;
}

function ChaseTile({ name, entry, reason, currency, divineExalted, chaosExalted }) {
  const market = liquidity(entry);
  return <li className="p2pf-chase-tile">
    <span title={`${name} · ${reason} · ${sourceLabel(entry)}${entry.variant ? ` · ${entry.variant}` : ""}`}>{name}</span>
    <b>{fmtPrice(Number(entry.exalted), currency, divineExalted, chaosExalted)}</b>
    <em className={market.tone}>{market.count ? `${number(market.count, 0)} ${market.unit}` : market.label}</em>
    <small className="p2pf-chase-origin">{reason} · {sourceLabel(entry)}{entry.variant ? ` · ${entry.variant}` : ""}</small>
  </li>;
}

function UniqueTabletTile({ name, entry, baselineValue, currency, divineExalted, chaosExalted }) {
  const value = Number(entry.exalted) || 0;
  const ratio = baselineValue > 0 ? value / baselineValue : null;
  const difference = baselineValue > 0 ? value - baselineValue : null;
  const market = liquidity(entry);
  const fill = ratio == null ? 0 : Math.min(100, ratio * 25);
  return <article className="p2pf-unique-tile">
    <div className="p2pf-unique-main">
      <div className="p2pf-unique-title"><strong title={name}>{name}</strong><b>{fmtPrice(value, currency, divineExalted, chaosExalted)}</b></div>
      <div className="p2pf-unique-meta"><span>{sourceLabel(entry)}</span><span className={market.tone}>{market.count ? `${number(market.count, 0)} ${market.unit}` : market.label}</span></div>
      <div className="p2pf-relative" title="The marker is the Normal-tablet baseline; the fill shows this unique tablet relative to it.">
        <i style={{ width: `${fill}%` }} /><b />
      </div>
      <div className="p2pf-unique-delta">
        <span>{ratio == null ? "No Normal baseline" : `${number(ratio, ratio < 1 ? 2 : 1)}× Normal baseline`}</span>
        <em className={tone(difference)}>{difference == null ? "Comparison pending" : `${difference >= 0 ? "+" : "−"}${fmtPrice(Math.abs(difference), currency, divineExalted, chaosExalted)}`}</em>
      </div>
    </div>
  </article>;
}

export default function PopularFarms({ league, priceData, history, currency, chaosExalted, divineExalted, rateSummary }) {
  const markets = priceData && priceData !== "missing" ? priceData.prices || {} : {};
  const families = useMemo(() => buildTabletFamilies(markets), [markets]);
  const pools = useMemo(() => mechanicPools(markets), [markets]);
  const coverage = useMemo(() => curatedCoverage(markets), [markets]);
  const [rangeHours, setRangeHours] = useState(24);
  const [divineAdjusted, setDivineAdjusted] = useState(false);
  const [sortMode, setSortMode] = useState("spread");
  const [weightMode, setWeightMode] = useState("supply");

  /* A mechanic is worth a card whenever either half of it exists. Driving the
     list from tablet families alone hid Expedition entirely: this league prices
     no Expedition Tablet, yet its markets clear more than any other mechanic's.
     An absent tablet is an unknown entry cost, not an absent farm. */
  const rows = useMemo(() => {
    const byFamily = new Map(families.map((family) => [family.id, family]));
    const ids = [...new Set([...FAMILY_ORDER, ...byFamily.keys()])]
      .filter((id) => byFamily.has(id) || (pools[id]?.members.length > 0) || (pools[id]?.chase.length > 0));
    return ids.map((id) => {
      const family = byFamily.get(id) || {
        id, label: FAMILY_LABELS[id] || id, baseline: null, baselineName: null, uniques: [],
      };
      const entry = family.baseline
        ? { name: family.baselineName, item: family.baseline.entry, kind: "tablet", label: family.baselineName, unit: null }
        : { name: null, item: null, kind: "tablet", label: id === "expedition" ? "Expedition Tablet" : null, unit: null };
      const timeline = family.baselineName
        ? tabletFamilyTimeline(history, family, { currency: divineAdjusted ? "divine" : "exalted", rangeHours, divineAdjusted })
        : { points: [], change: null, unit: "Exalted", canDivineAdjust: false };
      const last = timeline.points[timeline.points.length - 1];
      const pool = pools[id] || null;
      /* One walk of the pool's histories feeds the index, the movers, the
         top-of-pool list and the full table, so opening the table costs
         nothing extra. */
      const contributions = pool ? poolContributions(history, pool.members, {
        mode: weightMode, rangeHours, divineAdjusted,
        entryName: timeline.points.length >= 2 ? entry.name : null,
      }) : null;
      const index = contributions?.index || null;
      const movers = contributions ? poolMovers(contributions.rows) : null;
      const top = contributions ? topOfPool(contributions.rows) : [];
      /* A difference of two percentages stops meaning anything once either one
         is large — a tablet up 486% against a basket down 6% is not "-492%".
         The ratio says what was actually asked: how the return moved relative
         to the entry cost over the same window. */
      const entryChange = index?.entryChange ?? null;
      const spread = index?.change != null && entryChange != null && entryChange > -1
        ? (1 + index.change) / (1 + entryChange) - 1
        : null;
      const evidence = windowEvidence(index?.points || [], rangeHours, Date.parse(history?.timestamps?.at(-1)));
      const limited = evidence.samples < 4 || evidence.partial || evidence.stale || index?.equalFallback || index?.concentration.heavy;
      return {
        ...family,
        entry,
        timeline,
        pool,
        index,
        movers,
        top,
        rows: contributions?.rows || [],
        spread,
        entryChange: pool ? entryChange : timeline.change,
        evidence,
        limited,
        flow: pool ? poolFlow(pool.members) : 0,
        baselineValue: Number(entry.item?.exalted || last?.exalted) || 0,
      };
    });
  }, [currency, divineAdjusted, families, history, markets, pools, rangeHours, weightMode]);

  const sorted = useMemo(() => (sortMode === "spread"
    ? [...rows].sort((left, right) => (right.spread ?? -Infinity) - (left.spread ?? -Infinity))
    : sortMode === "flow"
      ? [...rows].sort((left, right) => right.flow - left.flow)
      : sortTabletRows(rows, sortMode)), [rows, sortMode]);

  const canAdjust = rows.some((row) => row.timeline.canDivineAdjust);
  const pricedEntries = rows.filter((row) => Number(row.entry.item?.exalted) > 0);
  const pricedTablets = pricedEntries.filter((row) => row.entry.kind === "tablet").length;
  const pricedAlternates = pricedEntries.length - pricedTablets;
  const spreads = rows.filter((row) => row.spread != null && !row.limited);
  const bestSpread = [...spreads].sort((left, right) => right.spread - left.spread)[0];
  const deepestFlow = [...rows].sort((left, right) => right.flow - left.flow)[0];

  useEffect(() => {
    if (!canAdjust) setDivineAdjusted(false);
  }, [canAdjust]);

  return <main className="p2pf-main">
    <style>{css}</style>
    <SourceStrip>{sourceText(league, priceData, history, rateSummary)}</SourceStrip>
    <header className="p2pf-head">
      <div>
        <span>Entry market against mechanic return</span><h2>Popular farms</h2>
        <p>Compare how access costs moved against each mechanic's tradeable output basket. This is a market-pressure view, not profit per map: spread shows return versus entry, trade flow shows sellability, and each full pool lists what was counted.</p>
      </div>
      <div className="p2pf-tools">
        <div className="p2pf-tool"><span>Sort</span><div className="app-segmented p2pf-sort" aria-label="Mechanic sort">
          {[["spread", "Spread"], ["flow", "Trade flow"], ["value", "Entry cost"], ["name", "Name"]].map(([value, label]) => <button key={value} aria-pressed={sortMode === value} className={sortMode === value ? "on" : ""} onClick={() => setSortMode(value)}>{label}</button>)}
        </div></div>
        <div className="p2pf-tool"><span>Weights</span><div className="app-segmented p2pf-sort" aria-label="Basket weighting">
          {WEIGHT_MODES.map(([value, label]) => <button key={value} aria-pressed={weightMode === value} className={weightMode === value ? "on" : ""} onClick={() => setWeightMode(value)}>{label}</button>)}
        </div></div>
        <div className="p2pf-tool"><span>Window</span>
        <div className="app-segmented p2pf-ranges" aria-label="Change window">
          {RANGES.map(([hours, label]) => <button key={label} aria-pressed={rangeHours === hours} className={rangeHours === hours ? "on" : ""} onClick={() => setRangeHours(hours)}>{label}</button>)}
        </div></div>
        <label className={`p2pf-adjust ${!canAdjust ? "disabled" : ""}`} title={canAdjust ? "Measure movement after accounting for Divine-to-Exalted drift" : "Two snapshots with Divine rates are required"}>
          <input type="checkbox" checked={divineAdjusted} disabled={!canAdjust} onChange={(event) => setDivineAdjusted(event.target.checked)} />
          <span>Divine-adjusted</span>
        </label>
      </div>
    </header>

    <SourceStrip className="app-source-strip--spaced" tone="notice">
      <strong>What these numbers are, and are not</strong>
      <ul>
        <li>{FLOOR_NOTE}</li>
        <li>Basket weights come from traded supply, not from drop rates. No drop rate is used anywhere on this page.</li>
        <li>Mechanic baskets use GGG and RePoE metadata. Curated boss and chase rewards are kept separate from basket markets, regardless of liquidity. This is a market index, not a predicted loot haul.</li>
        {coverage.missing.length > 0 && <li>
          {coverage.missing.length} curated market {coverage.missing.length === 1 ? "name has" : "names have"} no quote in this league
          {" — "}{coverage.missing.slice(0, 6).map((item) => item.name).join(", ")}
          {coverage.missing.length > 6 ? ` and ${coverage.missing.length - 6} more` : ""}. Missing prices are unknown, never zero.
          <details><summary>Show all missing reward quotes</summary>{coverage.missing.map((item) => <div key={`${item.mechanic}-${item.name}`}>{FAMILY_LABELS[item.mechanic]} · {item.name}</div>)}</details>
        </li>}
      </ul>
    </SourceStrip>

    {!!rows.length && <section className="p2pf-summary" aria-label="Mechanic summary">
      <div><span>Return vs entry · broader evidence</span><strong>{bestSpread?.label || "Evidence still limited"}</strong><em className={tone(bestSpread?.spread)}>{pct(bestSpread?.spread)}</em></div>
      <div><span>Deepest cleared trade</span><strong>{deepestFlow?.flow > 0 ? deepestFlow.label : "No cleared trade"}</strong><em>{flowLabel(deepestFlow?.flow)}</em></div>
      <div><span>Entry coverage</span><strong>{pricedEntries.length}/{rows.length} farms priced</strong><em>{pricedTablets} tablet{pricedTablets === 1 ? "" : "s"}{pricedAlternates ? ` · ${pricedAlternates} alternate` : ""}</em></div>
      <div><span>Curated coverage</span><strong>{coverage.matched}/{coverage.total} markets priced</strong><em>Unquoted markets stay outside baskets</em></div>
    </section>}

    {!rows.length && <section className="p2pf-empty">No tablet markets are present in this snapshot yet.</section>}
    <section className="p2pf-grid">
      {sorted.map((row, index) => {
        const move = row.entryChange;
        const market = liquidity(row.entry.item);
        const signal = farmSignal(row.spread);
        const entryPoints = row.index?.entryChange != null
          ? row.index.points.map((point) => ({ at: point.at, value: point.entryValue })) : row.pool ? [] : row.timeline.points;
        const chart = mergeSeries(entryPoints, row.index?.points || []);
        const heavy = row.index?.concentration?.heavy && row.pool?.members.length;
        const topWeight = row.index?.dominant;
        return <article className="p2pf-card" key={row.id} style={{ "--tone": TONES[row.id] || "#bd6846" }}>
          <header>
            <div><span className="p2pf-rank">{index + 1}</span><h3>{row.label}</h3><em>{row.entry.name || row.entry.label || `No ${row.entry.kind} quote in this league`}</em></div>
            <div className={`p2pf-verdict ${signal.tone}`}><span>{row.limited ? "Limited evidence" : "Market signal"}</span><strong>{signal.label}</strong></div>
          </header>
          <section className="p2pf-decision" aria-label={`${row.label} market decision`}>
            <div>
              <span>Tablet entry</span>
              <strong>{row.baselineValue > 0 ? fmtPrice(row.baselineValue, currency, divineExalted, chaosExalted) : "Unknown"}</strong>
              <small className={tone(move)}>{move == null ? (row.entry.name ? "Building entry history" : "No entry quote") : `${pct(move)} in this window`}</small>
            </div>
            <div>
              <span>Output basket</span>
              <strong className={tone(row.index?.change)}>{pct(row.index?.change)}</strong>
              <small>{row.index?.change == null ? "Needs output history" : `${row.index.included.length}/${row.pool.members.length} markets included`}</small>
            </div>
            <div>
              <span>Return vs entry</span>
              <strong className={tone(row.spread)}>{pct(row.spread)}</strong>
              <small>{signal.detail}</small>
            </div>
            <div>
              <span>Observed output flow</span>
              <strong>{flowLabel(row.flow)}</strong>
              <small>{row.flow > 0 ? "Observed hourly turnover · not your yield" : "No unit-volume evidence"}</small>
            </div>
          </section>
          <div className="p2pf-badges">
            {row.entry.item
              ? <>
                <span title={row.entry.unit || undefined}>{"Normal tablet baseline"}</span>
                <span>{sourceLabel(row.entry.item)}</span>
                <span className={market.tone}>{market.count ? `${number(market.count, 0)} ${market.unit}` : market.label}</span>
              </>
              : <span className="unknown">{`no ${row.entry.kind} quote`}</span>}
            {hasOutputPool(row.id) && row.pool
              ? <>
                <span className={row.index?.included.length === row.pool.members.length ? "active" : "limited"}
                  title="Markets with stored history included in the return index">
                  {row.index?.included.length || 0}/{row.pool.members.length} histories
                </span>
                {heavy && topWeight && <span className="limited" title="Share of the basket's starting value; a single market can dominate the headline.">{`${topWeight[0]} · ${number(topWeight[1] * 100, 0)}% of basket value`}</span>}
              </>
              : <span className="unknown">no attributable output pool</span>}
          </div>
          {row.pool && <p className={`p2pf-evidence ${row.limited ? "limited" : "active"}`}>
            {row.evidence.label} · {divineAdjusted ? "Divine-adjusted" : "Exalted-based"} movement
            {row.index?.equalFallback ? " · equal weights: no unit volume available" : ""}
            {row.index?.estimatedSamples > 0 ? ` · ${row.index.estimatedSamples} samples use nearby quotes (within 2h)` : ""}
          </p>}
          <div className="p2pf-chart">
            {chart.length ? <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chart} margin={{ top: 12, right: 12, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="#35231c" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="#bca7a4" fontSize={12} minTickGap={28} tickFormatter={(value) => tick(value, rangeHours)} />
                <YAxis stroke="#bca7a4" fontSize={12} width={38} domain={["auto", "auto"]} tickFormatter={(value) => number(value, 0)} />
                <Tooltip contentStyle={{ background: "#160e0b", border: "1px solid #63351f", color: "#ead8cf" }}
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value, key) => [`${number(value, 1)}`, key === "entry" ? "Entry cost" : "Return index"]} />
                <Line type="monotone" dataKey="entry" stroke="#8d7a70" strokeWidth={1.6} strokeDasharray="4 3" dot={false} connectNulls={false} animationDuration={800} />
                <Line type="monotone" dataKey="ret" stroke={TONES[row.id] || "#bd6846"} strokeWidth={2.2} dot={false} connectNulls={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer> : <div className="p2pf-chart-empty">{row.entry.name ? `The graph starts when ${row.entry.name} receives stored prices.` : "No stored prices for this mechanic yet."}</div>}
          </div>
          {hasOutputPool(row.id) && row.index?.reason && <p className="p2pf-note">No return index: {row.index.reason}.</p>}
          {!hasOutputPool(row.id) && <p className="p2pf-note">{NEUTRAL_NOTE}</p>}
          {row.pool && <details className="p2pf-basket-notes"><summary>Basket details & exclusions{row.index?.excluded?.length > 0 ? ` · ${row.index.excluded.length} markets excluded` : ""}</summary>
            {row.id === "expedition" && <p>{EXPEDITION_ENTRY_NOTE}</p>}
            {DEFERRED[row.id] && <p>{DEFERRED[row.id]}</p>}
            {row.index?.excluded?.length > 0 && <p>No usable history or weight in this mode: {row.index.excluded.join(", ")}.</p>}
            {row.pool.unpriced.length > 0 && <p>Missing or invalid price: {row.pool.unpriced.join(", ")}.</p>}
            {row.pool.caveat && <p>{row.pool.caveat}</p>}
          </details>}
          <footer>
            {row.top.length > 0 && <div className="p2pf-movers">
              <span>Highest-priced markets</span>
              <ul>
                {row.top.slice(0, 3).map((item) => <TopRow key={item.name} row={item} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
              </ul>
            </div>}
            {row.movers && (row.movers.up.length > 0 || row.movers.down.length > 0) && <div className="p2pf-movers">
              <span>Leading index movers</span>
              <ul>
                {row.movers.up.slice(0, 3).map((mover) => <MoverRow key={mover.name} row={mover} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
                {row.movers.down.slice(0, 3).map((mover) => <MoverRow key={mover.name} row={mover} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
              </ul>
            </div>}
            {row.pool?.chase.length > 0 && <details className="p2pf-rewards">
              <summary><span>Boss & chase rewards <b>{row.pool.chase.length}</b></span><small>Outside the index</small></summary>
              <p>Indicative quotes: rolls and jewel passives affect the sale price. These rewards never contribute to the index.</p>
              <div className="p2pf-movers"><ul>{row.pool.chase.map((item) => <ChaseTile key={item.name} {...item} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}</ul></div>
            </details>}
            {row.uniques.length > 0 && <details className="p2pf-unique-details"><summary>Compare unique tablets <span>{row.uniques.length}</span></summary><div className="p2pf-uniques">{row.uniques.map(({ name, entry }) => <UniqueTabletTile key={name} name={name} entry={entry} baselineValue={row.baselineValue} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}</div></details>}
          </footer>
          <PoolTable rows={row.rows} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />
        </article>;
      })}
    </section>
  </main>;
}

const css = `
.p2pf-rewards{grid-column:1/-1;border:1px solid #4c2928;border-radius:8px;background:#150e0e;overflow:hidden}.p2pf-rewards summary{padding:14px 16px;cursor:pointer;color:#f3e9e7;font-size:14px;font-weight:600}.p2pf-rewards summary small{float:right;font-size:12.5px;font-weight:400;color:#d8c5c4}.p2pf-rewards summary b{margin-left:6px;padding:2px 7px;border-radius:5px;background:#422020}.p2pf-rewards>p{padding:0 16px;color:#d8c5c4;font-size:12.5px;line-height:1.5}.p2pf-rewards>.p2pf-movers{padding:0 16px 16px}.p2pf-rewards .p2pf-movers ul{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.p2pf-rewards li.p2pf-chase-tile{padding:12px;border:1px solid #392525;border-radius:6px;background:#100c0c}.p2pf-basket-notes{margin:12px 20px 0;font-size:12.5px;color:#dbc9c7;line-height:1.6}.p2pf-basket-notes summary{cursor:pointer;color:#f0dfdd}.p2pf-basket-notes p{margin:8px 0}.p2pf-card footer>.p2pf-unique-details{grid-column:1/-1;border-top:1px solid #392525}.p2pf-card footer>.p2pf-movers>ul>li{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:8px 0;border-bottom:1px solid #302020}.p2pf-card footer>.p2pf-movers>ul>li>em{text-align:left}.p2pf-card footer>.p2pf-movers>ul>li>span{font-weight:600}

.p2pf-movers li.p2pf-chase-tile{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 8px}.p2pf-movers li.p2pf-chase-tile>span{grid-column:1/-1;white-space:normal;overflow:visible;font-weight:600}.p2pf-movers li.p2pf-chase-tile>b{text-align:left}.p2pf-movers li.p2pf-chase-tile>em{white-space:normal;text-align:right}
.p2pf-movers li .p2pf-chase-origin{grid-column:1/-1;white-space:normal;color:#d8c5c4;font-size:12.5px;line-height:1.5;padding-bottom:5px}
.p2pf-evidence{margin:0 16px 9px;padding:7px 9px;border:1px solid #442221;border-radius:5px;color:#e2e2e0;font-size:12.5px;line-height:1.5}.p2pf-evidence.limited{border-color:#70312f;color:#d98c89}.p2pf-evidence.active{border-color:#36553b;color:#e2e2e0}
.p2pf-main{container:farm-layout / inline-size;display:grid;gap:14px}.p2pf-head{display:grid;gap:22px;padding:20px 22px;border:1px solid #3e201f;border-radius:8px;background:linear-gradient(105deg,#170e0d,#0d0908)}.p2pf-head>div:first-child>span,.p2pf-tool>span{color:#e2e2e0;font-size:12.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2pf-head h2{margin:4px 0;color:#e2e2e0;font-size:27px}.p2pf-head p{max-width:700px;margin:0;color:#e2e2e0;font-size:13.5px}.p2pf-tools{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-top:16px;border-top:1px solid #392120}.p2pf-tool{display:grid;gap:5px}.p2pf-ranges button,.p2pf-sort button{padding:6px 10px}.p2pf-adjust{display:flex;align-items:center;gap:7px;padding-bottom:6px;color:#e2e2e0;font-size:12.5px;white-space:nowrap;cursor:pointer}.p2pf-adjust input{accent-color:#a43431}.p2pf-adjust.disabled{opacity:.45;cursor:not-allowed}.p2pf-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));overflow:hidden;border:1px solid #3d2120;border-radius:8px;background:#100b09}.p2pf-summary>div{display:grid;grid-template-columns:1fr;gap:4px 12px;padding:12px 16px;border-right:1px solid #301a1a}.p2pf-summary>div:last-child{border-right:0}.p2pf-summary span{grid-column:1/-1;color:#e2e2e0;font-size:12.5px;letter-spacing:.12em;text-transform:uppercase}.p2pf-summary strong{color:#e2e2e0;font-size:22px;letter-spacing:-.03em}.p2pf-summary em{color:#e2e2e0;font-size:12.5px;font-style:normal;text-align:left}.p2pf-summary em.gain{color:#e2e2e0}.p2pf-summary em.loss{color:#e2e2e0}.p2pf-grid{display:grid;grid-template-columns:1fr;gap:12px}.p2pf-card{container:farm-card / inline-size;align-self:start;min-width:0;overflow:hidden;border:1px solid #452120;border-top:2px solid var(--tone);border-radius:8px;background:linear-gradient(150deg,rgba(255,255,255,.015),transparent 45%),#110c0a}.p2pf-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:15px 16px 7px}.p2pf-card>header>div:first-child{display:grid;grid-template-columns:auto 1fr;column-gap:8px}.p2pf-rank{grid-row:1/3;align-self:center;color:#e2e2e0;font-size:12.5px}.p2pf-card h3{margin:0;color:#e2e2e0;font-size:19px}.p2pf-card header em{color:#e2e2e0;font-size:12.5px;font-style:normal}.p2pf-value{display:grid;text-align:right}.p2pf-value strong{color:#e2e2e0;font-size:17px}.p2pf-value span{font-size:12.5px}.gain{color:#e2e2e0}.loss{color:#e2e2e0}.p2pf-badges{display:flex;flex-wrap:wrap;gap:5px;padding:0 16px 5px}.p2pf-badges span{padding:3px 6px;border:1px solid #3c2322;border-radius:999px;background:#170e0d;color:#e2e2e0;font-size:12.5px}.p2pf-badges .thin{border-color:#7b322f;color:#e2e2e0}.p2pf-badges .limited{border-color:#762d2a;color:#db8684}.p2pf-badges .active,.p2pf-badges .deep{border-color:#355c3a;color:#e2e2e0}.p2pf-badges .gain{border-color:#355c3a;color:#e2e2e0}.p2pf-badges .loss{border-color:#7b382d;color:#e2e2e0}.p2pf-chart{height:180px;margin:0 6px}.p2pf-chart-empty{display:grid;height:140px;padding:12px;place-items:center;text-align:center;color:#e2e2e0;font-size:12.5px}.p2pf-note{margin:0;padding:6px 16px 0;color:#e2e2e0;font-size:12.5px;line-height:1.45}.p2pf-card footer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;padding:16px 20px;margin-top:9px;border-top:1px solid #301a1a;color:#e2e2e0;font-size:12.5px}.p2pf-movers{display:grid;align-content:start;gap:5px;min-width:0}.p2pf-movers>span,.p2pf-uniques>span{color:#e2e2e0;font-size:12.5px;letter-spacing:.11em;text-transform:uppercase}.p2pf-movers ul{display:grid;gap:3px;margin:0;padding:0;list-style:none}.p2pf-movers li{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:baseline}.p2pf-movers li i{font-style:normal;font-size:12.5px;text-align:right;min-width:34px;color:#e2e2e0}.p2pf-movers li i.gain{color:#e2e2e0}.p2pf-movers li i.loss{color:#e2e2e0}.p2pf-movers li span{overflow-wrap:anywhere;white-space:normal;color:#e2e2e0;font-size:12.5px}.p2pf-movers li b{color:#e2e2e0;font-size:12.5px;font-weight:600}.p2pf-movers li em{font-style:normal;font-size:12.5px;text-align:right}.p2pf-movers li em.thin{color:#e2e2e0}.p2pf-movers li em.limited{color:#db8684}.p2pf-movers li em.active{color:#e2e2e0}.p2pf-movers li em.unknown{color:#e2e2e0}.p2pf-uniques{display:grid;gap:7px;min-width:0}.p2pf-unique-tile{padding:8px;border:1px solid #351f1f;border-radius:6px;background:linear-gradient(120deg,#170e0d,#100b09)}.p2pf-unique-main{display:grid;gap:4px;min-width:0}.p2pf-unique-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.p2pf-unique-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e2e0;font-size:12.5px}.p2pf-unique-title b{flex-shrink:0;color:#e2e2e0;font-size:12.5px;font-weight:600}.p2pf-unique-meta,.p2pf-unique-delta{display:flex;justify-content:space-between;gap:8px}.p2pf-unique-meta span{color:#e2e2e0;font-size:12.5px}.p2pf-unique-meta .thin{color:#e2e2e0}.p2pf-unique-meta .limited{color:#db8684}.p2pf-unique-meta .active,.p2pf-unique-meta .deep{color:#e2e2e0}.p2pf-relative{position:relative;height:5px;overflow:hidden;border-radius:999px;background:#2a1717}.p2pf-relative i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--tone),#e06a66)}.p2pf-relative b{position:absolute;top:-2px;bottom:-2px;left:25%;width:1px;background:#f0cccb;opacity:.7}.p2pf-unique-delta span,.p2pf-unique-delta em{font-size:12.5px}.p2pf-unique-delta span{color:#e2e2e0}.p2pf-unique-delta em{font-style:normal;text-align:right}.p2pf-pool{padding:0 16px 14px}.p2pf-pool-toggle{width:100%;padding:6px 9px;border:1px solid #3c2322;border-radius:5px;background:#170e0d;color:#e2e2e0;font:inherit;font-size:12.5px;cursor:pointer}.p2pf-pool-toggle:hover{border-color:#7b2927;color:#e2e2e0}.p2pf-pool-scroll{max-height:320px;overflow:auto;margin-top:8px;border:1px solid #301a1a;border-radius:6px}.p2pf-pool-table{width:100%;border-collapse:collapse;font-size:12.5px}.p2pf-pool-table th{position:sticky;top:0;z-index:1;padding:0;background:#170e0d;text-align:right}.p2pf-pool-table th:first-child{text-align:left}.p2pf-pool-table th button{width:100%;padding:6px 8px;border:0;border-bottom:1px solid #3c2322;background:transparent;color:#e2e2e0;font:inherit;font-size:12.5px;letter-spacing:.09em;text-transform:uppercase;text-align:inherit;cursor:pointer}.p2pf-pool-table th button:hover{color:#e2e2e0}.p2pf-pool-table td{padding:4px 8px;border-bottom:1px solid #241313;color:#e2e2e0;text-align:right;white-space:nowrap}.p2pf-pool-table td:first-child{max-width:190px;overflow:hidden;text-overflow:ellipsis;text-align:left}.p2pf-pool-table tbody tr:last-child td{border-bottom:0}.p2pf-pool-table tbody tr:hover td{background:#170e0d}.p2pf-pool-table .thin{color:#e2e2e0}.p2pf-pool-table .limited{color:#db8684}.p2pf-pool-table .active{color:#e2e2e0}.p2pf-pool-table .gain{color:#e2e2e0}.p2pf-pool-table .loss{color:#e2e2e0}.p2pf-ranges{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px}.p2pf-unique-details summary{padding:10px 0;color:#e2e2e0;font-size:12.5px;cursor:pointer}.p2pf-unique-details summary span{margin-left:6px;padding:2px 6px;border-radius:5px;background:#391c1b}.p2pf-unique-details[open] summary{margin-bottom:8px}.p2pf-empty{padding:40px;border:1px solid #3e201f;border-radius:8px;text-align:center;color:#e2e2e0}@media(max-width:1100px){.p2pf-head{align-items:flex-start;flex-direction:column}.p2pf-tools{width:100%;flex-wrap:wrap}}@media(max-width:720px){.p2pf-summary{grid-template-columns:1fr}.p2pf-summary>div{border-right:0;border-bottom:1px solid #301a1a}.p2pf-summary>div:last-child{border-bottom:0}}@media(max-width:520px){.p2pf-grid{grid-template-columns:1fr}.p2pf-tools{align-items:flex-start;flex-direction:column}}
.p2pf-summary{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(max-width:520px){.p2pf-tool{max-width:100%}.p2pf-ranges{flex-wrap:wrap;overflow:visible;border:0;gap:4px}.p2pf-ranges button{border:1px solid #652321;border-radius:4px}}
@media(max-width:1350px) and (min-width:721px){.p2pf-head{align-items:flex-start;flex-direction:column}.p2pf-head p{max-width:850px}.p2pf-tools{width:100%;flex-wrap:wrap}.p2pf-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.p2pf-summary>div:nth-child(2){border-right:0}.p2pf-summary>div:nth-child(-n+2){border-bottom:1px solid #301a1a}}
.p2pf-card>header{padding-bottom:10px}.p2pf-verdict{display:grid;text-align:right}.p2pf-verdict span{color:#e2e2e0;font-size:12.5px;letter-spacing:.1em;text-transform:uppercase}.p2pf-verdict strong{font-size:12.5px}.p2pf-verdict.gain strong{color:#e2e2e0}.p2pf-verdict.loss strong{color:#e2e2e0}.p2pf-verdict.flat strong{color:#db8684}.p2pf-decision{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0 16px 9px;overflow:hidden;border:1px solid #412423;border-radius:7px;background:#0d0908}.p2pf-decision>div{display:grid;align-content:start;min-width:0;gap:3px;padding:10px 11px;border-right:1px solid #351e1d}.p2pf-decision>div:last-child{border-right:0}.p2pf-decision span{color:#e2e2e0;font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.p2pf-decision strong{overflow:hidden;color:#e2e2e0;font-size:16px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.p2pf-decision small{color:#e2e2e0;font-size:12.5px;line-height:1.45}.p2pf-decision strong.gain,.p2pf-decision small.gain{color:#e2e2e0}.p2pf-decision strong.loss,.p2pf-decision small.loss{color:#e2e2e0}@media(max-width:720px){.p2pf-summary{grid-template-columns:1fr}.p2pf-summary>div{border-right:0;border-bottom:1px solid #301a1a}.p2pf-summary>div:last-child{border-bottom:0}.p2pf-grid{grid-template-columns:1fr}}@media(max-width:620px){.p2pf-card footer{grid-template-columns:1fr}.p2pf-rewards .p2pf-movers ul{grid-template-columns:1fr}.p2pf-rewards summary small{float:none;display:block;margin-top:6px}.p2pf-decision{grid-template-columns:repeat(2,minmax(0,1fr))}.p2pf-decision>div:nth-child(2){border-right:0}.p2pf-decision>div:nth-child(-n+2){border-bottom:1px solid #351e1d}}
/* Use available content width, so collapsing the sidebar can reveal a column. */
@container farm-layout (min-width: 820px) { .p2pf-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@container farm-layout (min-width: 1320px) { .p2pf-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@container farm-card (max-width: 560px) {
  .p2pf-decision { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .p2pf-decision>div:nth-child(2) { border-right: 0; }
  .p2pf-decision>div:nth-child(-n+2) { border-bottom: 1px solid #351e1d; }
  .p2pf-card footer { grid-template-columns: 1fr; }
  .p2pf-rewards .p2pf-movers ul { grid-template-columns: 1fr; }
  .p2pf-rewards summary small { float:none;display:block;margin-top:6px; }
}
`;
