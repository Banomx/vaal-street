import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { fmtPrice } from "../bosses/bossProfit.js";
import { buildTabletFamilies, sortTabletRows, tabletFamilyTimeline } from "./tabletFarms.js";
import { buildPriceTimeline } from "../pricing/priceTimeline.js";
import { curatedCoverage, ENTRY_DUAL_ROLE, FAMILY_LABELS, FAMILY_ORDER, FLOOR_NOTE, hasOutputPool, mechanicPools, NEUTRAL_NOTE, resolveEntry, TONES, DEFERRED } from "./mechanics.js";
import { buildBasketIndex, liquidity, poolFlow, poolMovers, WEIGHT_MODES } from "./farmIndex.js";

const RANGES = [[24, "24h"], [168, "7d"], [720, "30d"], [null, "All"]];

function number(value, digits = 2) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${number(value * 100, digits)}%`;
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
  if (entry?.source === "poe.ninja stash") return "poe.ninja";
  if (entry?.source === "GGG completed trades") return "GGG trades";
  return entry?.source || "No live source";
}

function flowLabel(value) {
  if (!(value > 0)) return "No cleared trade";
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

function MoverRow({ row, currency, divineExalted, chaosExalted }) {
  return <li>
    <span title={row.name}>{row.name}</span>
    <b>{fmtPrice(Number(row.entry.exalted) || 0, currency, divineExalted, chaosExalted)}</b>
    <em className={tone(row.change)}>{pct(row.change)}</em>
  </li>;
}

function ChaseTile({ name, entry, currency, divineExalted, chaosExalted }) {
  const market = liquidity(entry);
  return <li>
    <span title={name}>{name}</span>
    <b>{fmtPrice(Number(entry.exalted) || 0, currency, divineExalted, chaosExalted)}</b>
    <em className={market.tone}>{market.count ? `${number(market.count, 0)} ${market.unit}` : market.label}</em>
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
  const [rangeHours, setRangeHours] = useState(168);
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
      .filter((id) => byFamily.has(id) || (pools[id]?.members.length > 0));
    return ids.map((id) => {
      const family = byFamily.get(id) || {
        id, label: FAMILY_LABELS[id] || id, baseline: null, baselineName: null, uniques: [],
      };
      /* Most mechanics are entered through a tablet; Expedition is entered
         through a logbook. `tabletFamilyTimeline` carries the
         `tabletBaselineVersion` compatibility logic that only makes sense for a
         Normal precursor tablet, so a non-tablet entry reads its series
         straight from the aligned timeline instead. */
      const declared = resolveEntry(id, markets);
      const entry = declared?.entry
        ? { name: declared.name, item: declared.entry, kind: declared.kind, label: declared.label, unit: declared.unit }
        : family.baseline
          ? { name: family.baselineName, item: family.baseline.entry, kind: "tablet", label: family.baselineName, unit: null }
          : { name: null, item: null, kind: declared ? declared.kind : "tablet", label: declared?.label || null, unit: null };
      const timeline = entry.kind === "tablet"
        ? (family.baselineName
          ? tabletFamilyTimeline(history, family, { currency: divineAdjusted ? "divine" : currency, rangeHours, divineAdjusted })
          : { points: [], change: null, unit: "Exalted", canDivineAdjust: false })
        : entry.name
          ? (() => {
            const line = buildPriceTimeline(history, entry.name, { currency: divineAdjusted ? "divine" : currency, rangeHours });
            return { ...line, change: divineAdjusted ? line.divineAdjustedChange : line.change };
          })()
          : { points: [], change: null, unit: "Exalted", canDivineAdjust: false };
      const last = timeline.points[timeline.points.length - 1];
      const pool = pools[id] || null;
      const index = pool ? buildBasketIndex(history, pool.members, { mode: weightMode, rangeHours, divineAdjusted }) : null;
      const movers = pool ? poolMovers(history, pool.members, { rangeHours, divineAdjusted }) : null;
      /* A difference of two percentages stops meaning anything once either one
         is large — a tablet up 486% against a basket down 6% is not "-492%".
         The ratio says what was actually asked: how the return moved relative
         to the entry cost over the same window. */
      const spread = index?.change != null && timeline.change != null && timeline.change > -1
        ? (1 + index.change) / (1 + timeline.change) - 1
        : null;
      return {
        ...family,
        entry,
        timeline,
        pool,
        index,
        movers,
        spread,
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
  const priced = families.filter((family) => Number(family.baseline?.entry?.exalted) > 0);
  const spreads = rows.filter((row) => row.spread != null);
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
        <span>Tablet cost against mechanic return</span><h2>Popular farms</h2>
        <p>Each mechanic pairs its Normal-tablet entry cost with a fixed-weight index of the markets that mechanic actually supplies. Both lines are rebased, so the card shows whether return is outpacing entry — not what a map yields.</p>
      </div>
      <div className="p2pf-tools">
        <div className="p2pf-tool"><span>Sort</span><div className="app-segmented p2pf-sort" aria-label="Mechanic sort">
          {[["spread", "Spread"], ["flow", "Flow"], ["value", "Entry"], ["name", "Name"]].map(([value, label]) => <button key={value} aria-pressed={sortMode === value} className={sortMode === value ? "on" : ""} onClick={() => setSortMode(value)}>{label}</button>)}
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
        {coverage.missing.length > 0 && <li>
          {coverage.missing.length} curated market {coverage.missing.length === 1 ? "name has" : "names have"} no quote in this league
          {" — "}{coverage.missing.slice(0, 6).map((item) => item.name).join(", ")}
          {coverage.missing.length > 6 ? ` and ${coverage.missing.length - 6} more` : ""}. Those markets sit outside every basket rather than counting as zero.
        </li>}
      </ul>
    </SourceStrip>

    {!!rows.length && <section className="p2pf-summary" aria-label="Mechanic summary">
      <div><span>Strongest spread</span><strong>{bestSpread?.label || "Building history"}</strong><em className={tone(bestSpread?.spread)}>{pct(bestSpread?.spread)}</em></div>
      <div><span>Deepest cleared trade</span><strong>{deepestFlow?.flow > 0 ? deepestFlow.label : "No cleared trade"}</strong><em>{flowLabel(deepestFlow?.flow)}</em></div>
      <div><span>Baseline coverage</span><strong>{priced.length}/{families.length} Normal tablets</strong><em>{coverage.matched}/{coverage.total} curated markets priced</em></div>
    </section>}

    {!rows.length && <section className="p2pf-empty">No tablet markets are present in this snapshot yet.</section>}
    <section className="p2pf-grid">
      {sorted.map((row, index) => {
        const move = row.timeline.change;
        const market = liquidity(row.entry.item);
        const chart = mergeSeries(row.timeline.points, row.index?.points || []);
        const heavy = row.index?.concentration?.heavy && row.pool?.members.length;
        const topWeight = row.index ? [...row.index.weights.entries()].sort((left, right) => right[1] - left[1])[0] : null;
        return <article className="p2pf-card" key={row.id} style={{ "--tone": TONES[row.id] || "#bd6846" }}>
          <header>
            <div><span className="p2pf-rank">{index + 1}</span><h3>{row.label}</h3><em>{row.entry.name || `No ${row.entry.kind} quote in this league`}</em></div>
            <div className="p2pf-value">
              <strong>{row.baselineValue > 0 ? fmtPrice(row.baselineValue, currency, divineExalted, chaosExalted) : "—"}</strong>
              <span className={tone(move)}>{move == null ? (row.entry.name ? "Building history" : "Entry cost unknown") : `entry ${pct(move)}`}</span>
              {row.index?.change != null && <span className={tone(row.index.change)}>{`return ${pct(row.index.change)}`}</span>}
            </div>
          </header>
          <div className="p2pf-badges">
            {row.entry.item
              ? <>
                <span title={row.entry.unit || undefined}>{row.entry.kind === "logbook" ? "Logbook entry" : "Normal baseline"}</span>
                <span>{sourceLabel(row.entry.item)}</span>
                <span className={market.tone}>{market.count ? `${number(market.count, 0)} ${market.unit}` : market.label}</span>
              </>
              : <span className="unknown">{`no ${row.entry.kind} quote`}</span>}
            {hasOutputPool(row.id)
              ? <>
                <span>{row.pool.members.length} pool markets</span>
                <span className={row.flow > 0 ? "active" : "unknown"}>{flowLabel(row.flow)}</span>
                {row.spread != null && <span className={tone(row.spread)}>spread {pct(row.spread)}</span>}
                {heavy && <span className="limited" title={`${topWeight[0]} holds ${number(topWeight[1] * 100, 0)}% of the basket weight.`}>{`concentrated · ${number(topWeight[1] * 100, 0)}%`}</span>}
              </>
              : <span className="unknown">no attributable output pool</span>}
          </div>
          <div className="p2pf-chart">
            {chart.length ? <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chart} margin={{ top: 12, right: 12, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="#35231c" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="#6f5d55" fontSize={10} minTickGap={28} tickFormatter={(value) => tick(value, rangeHours)} />
                <YAxis stroke="#6f5d55" fontSize={10} width={38} domain={["auto", "auto"]} tickFormatter={(value) => number(value, 0)} />
                <Tooltip contentStyle={{ background: "#160e0b", border: "1px solid #63351f", color: "#ead8cf" }}
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value, key) => [`${number(value, 1)}`, key === "entry" ? "Entry cost" : "Return index"]} />
                <Line type="monotone" dataKey="entry" stroke="#8d7a70" strokeWidth={1.6} strokeDasharray="4 3" dot={false} connectNulls={false} animationDuration={800} />
                <Line type="monotone" dataKey="ret" stroke={TONES[row.id] || "#bd6846"} strokeWidth={2.2} dot={false} connectNulls={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer> : <div className="p2pf-chart-empty">{row.entry.name ? `The graph starts when ${row.entry.name} receives stored prices.` : "No stored prices for this mechanic yet."}</div>}
          </div>
          {row.entry.kind === "logbook" && row.entry.item && <p className="p2pf-note">{ENTRY_DUAL_ROLE}</p>}
          {hasOutputPool(row.id) && row.index?.reason && <p className="p2pf-note">No return index: {row.index.reason}.</p>}
          {!hasOutputPool(row.id) && <p className="p2pf-note">{NEUTRAL_NOTE}</p>}
          {DEFERRED[row.id] && <p className="p2pf-note">{DEFERRED[row.id]}</p>}
          {row.index?.excluded?.length > 0 && <p className="p2pf-note">Outside the index — no stored history yet: {row.index.excluded.join(", ")}.</p>}
          {row.pool?.caveat && <p className="p2pf-note">{row.pool.caveat}</p>}
          <footer>
            {row.movers && (row.movers.up.length > 0 || row.movers.down.length > 0) && <div className="p2pf-movers">
              <span>Pool movers</span>
              <ul>
                {row.movers.up.map((mover) => <MoverRow key={mover.name} row={mover} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
                {row.movers.down.map((mover) => <MoverRow key={mover.name} row={mover} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
              </ul>
            </div>}
            {row.pool?.chase.length > 0 && <div className="p2pf-movers">
              <span>Chase items · outside the index</span>
              <ul>
                {row.pool.chase.slice(0, 6).map(({ name, entry }) => <ChaseTile key={name} name={name} entry={entry} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}
              </ul>
            </div>}
            {row.uniques.length > 0 && <div className="p2pf-uniques"><span>Unique tablets · {row.uniques.length}</span>{row.uniques.map(({ name, entry }) => <UniqueTabletTile key={name} name={name} entry={entry} baselineValue={row.baselineValue} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} />)}</div>}
          </footer>
        </article>;
      })}
    </section>
  </main>;
}

const css = `
.p2pf-main{display:grid;gap:14px}.p2pf-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:20px 22px;border:1px solid #3e281e;border-radius:8px;background:linear-gradient(105deg,#17100d,#0d0908)}.p2pf-head>div:first-child>span,.p2pf-tool>span{color:#bd6846;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.p2pf-head h2{margin:4px 0;color:#f0ded5;font-size:27px}.p2pf-head p{max-width:700px;margin:0;color:#9c867c;font-size:13.5px}.p2pf-tools{display:flex;align-items:flex-end;gap:12px;flex-shrink:0;flex-wrap:wrap}.p2pf-tool{display:grid;gap:5px}.p2pf-ranges button,.p2pf-sort button{padding:6px 10px}.p2pf-adjust{display:flex;align-items:center;gap:7px;padding-bottom:6px;color:#c7ada1;font-size:12px;white-space:nowrap;cursor:pointer}.p2pf-adjust input{accent-color:#a44e2d}.p2pf-adjust.disabled{opacity:.45;cursor:not-allowed}.p2pf-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;border:1px solid #3d281f;border-radius:8px;background:#100b09}.p2pf-summary>div{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:12px 16px;border-right:1px solid #302019}.p2pf-summary>div:last-child{border-right:0}.p2pf-summary span{grid-column:1/-1;color:#9b6b56;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}.p2pf-summary strong{color:#ddc8be;font-size:14px}.p2pf-summary em{color:#ad9185;font-size:12px;font-style:normal;text-align:right}.p2pf-summary em.gain{color:#79bd72}.p2pf-summary em.loss{color:#d9705c}.p2pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:12px}.p2pf-card{min-width:0;overflow:hidden;border:1px solid #45291f;border-top:2px solid var(--tone);border-radius:8px;background:linear-gradient(150deg,rgba(255,255,255,.015),transparent 45%),#110c0a}.p2pf-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:15px 16px 7px}.p2pf-card>header>div:first-child{display:grid;grid-template-columns:auto 1fr;column-gap:8px}.p2pf-rank{grid-row:1/3;align-self:center;color:#756159;font-size:12px}.p2pf-card h3{margin:0;color:#ead7ce;font-size:19px}.p2pf-card header em{color:#8e776d;font-size:11.5px;font-style:normal}.p2pf-value{display:grid;text-align:right}.p2pf-value strong{color:#f0d8cb;font-size:17px}.p2pf-value span{font-size:11px}.gain{color:#79bd72}.loss{color:#d9705c}.p2pf-badges{display:flex;flex-wrap:wrap;gap:5px;padding:0 16px 5px}.p2pf-badges span{padding:3px 6px;border:1px solid #3c2921;border-radius:999px;background:#17100d;color:#987f74;font-size:9.5px}.p2pf-badges .thin{border-color:#7b382d;color:#e18272}.p2pf-badges .limited{border-color:#765428;color:#d2a563}.p2pf-badges .active,.p2pf-badges .deep{border-color:#355c3a;color:#7fbd82}.p2pf-badges .gain{border-color:#355c3a;color:#7fbd82}.p2pf-badges .loss{border-color:#7b382d;color:#e18272}.p2pf-chart{height:140px;margin:0 6px}.p2pf-chart-empty{display:grid;height:140px;padding:12px;place-items:center;text-align:center;color:#75645c;font-size:12px}.p2pf-note{margin:0;padding:6px 16px 0;color:#7d6b62;font-size:10.5px;line-height:1.45}.p2pf-card footer{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;padding:11px 16px 14px;margin-top:9px;border-top:1px solid #302019;color:#806d64;font-size:10.5px}.p2pf-movers{display:grid;align-content:start;gap:5px;min-width:0}.p2pf-movers>span,.p2pf-uniques>span{color:#9b6b56;font-size:9px;letter-spacing:.11em;text-transform:uppercase}.p2pf-movers ul{display:grid;gap:3px;margin:0;padding:0;list-style:none}.p2pf-movers li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:baseline}.p2pf-movers li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bda49a;font-size:10.5px}.p2pf-movers li b{color:#d8bfb3;font-size:10.5px;font-weight:600}.p2pf-movers li em{font-style:normal;font-size:10px;text-align:right}.p2pf-movers li em.thin{color:#e18272}.p2pf-movers li em.limited{color:#d2a563}.p2pf-movers li em.active{color:#7fbd82}.p2pf-movers li em.unknown{color:#75645c}.p2pf-uniques{display:grid;gap:7px;min-width:0}.p2pf-unique-tile{padding:8px;border:1px solid #35251e;border-radius:6px;background:linear-gradient(120deg,#17100d,#100b09)}.p2pf-unique-main{display:grid;gap:4px;min-width:0}.p2pf-unique-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.p2pf-unique-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbc5ba;font-size:11.5px}.p2pf-unique-title b{flex-shrink:0;color:#efc5b3;font-size:11.5px;font-weight:600}.p2pf-unique-meta,.p2pf-unique-delta{display:flex;justify-content:space-between;gap:8px}.p2pf-unique-meta span{color:#75645c;font-size:9px}.p2pf-unique-meta .thin{color:#e18272}.p2pf-unique-meta .limited{color:#d2a563}.p2pf-unique-meta .active,.p2pf-unique-meta .deep{color:#7fbd82}.p2pf-relative{position:relative;height:5px;overflow:hidden;border-radius:999px;background:#2a1c16}.p2pf-relative i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--tone),#e08a62)}.p2pf-relative b{position:absolute;top:-2px;bottom:-2px;left:25%;width:1px;background:#f0d7ca;opacity:.7}.p2pf-unique-delta span,.p2pf-unique-delta em{font-size:9.5px}.p2pf-unique-delta span{color:#9d8175}.p2pf-unique-delta em{font-style:normal;text-align:right}.p2pf-empty{padding:40px;border:1px solid #3e281e;border-radius:8px;text-align:center;color:#806d64}@media(max-width:1100px){.p2pf-head{align-items:flex-start;flex-direction:column}.p2pf-tools{width:100%;flex-wrap:wrap}}@media(max-width:720px){.p2pf-summary{grid-template-columns:1fr}.p2pf-summary>div{border-right:0;border-bottom:1px solid #302019}.p2pf-summary>div:last-child{border-bottom:0}}@media(max-width:520px){.p2pf-grid{grid-template-columns:1fr}.p2pf-tools{align-items:flex-start;flex-direction:column}}
`;
