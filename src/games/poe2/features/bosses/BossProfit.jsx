import { useEffect, useMemo, useState } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { createJsonStore } from "../../../../shared/storage/jsonStore.js";
import { BOSSES, GROUP_ORDER, GROUP_TONES } from "./bossData.js";
import { computeBosses, fmtPrice, sanitizeSettings, summarizePriceCoverage } from "./bossProfit.js";

const settingsStore = createJsonStore({ game: "poe2", feature: "boss-profit", version: 1 });

function RateInput({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((value * 100).toFixed(value * 100 < 1 ? 2 : 1));
  useEffect(() => setDraft((value * 100).toFixed(value * 100 < 1 ? 2 : 1)), [value]);
  if (!editing) {
    return (
      <button className="p2-rate" onClick={() => setEditing(true)} title="Click to set a manual drop rate">
        {(value * 100).toFixed(value * 100 < 1 ? 2 : 1)} <em>%</em>
      </button>
    );
  }
  return (
    <span className="p2-rate-input">
      <input autoFocus type="number" min="0" max="1000" step="0.1" value={draft}
        aria-label="Drop rate percent"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (!Number.isFinite(n) || n < 0) {
            setDraft((value * 100).toFixed(value * 100 < 1 ? 2 : 1));
            setEditing(false);
            return;
          }
          onCommit(n / 100);
          setEditing(false);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditing(false); }} />
      <em>%</em>
    </span>
  );
}

function fmtTime(seconds) {
  if (!(seconds > 0)) return "";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function parseTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!text.includes(":")) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  }
  const [minutes, seconds = "0"] = text.split(":");
  const total = Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function TimeInput({ value, onCommit }) {
  const [draft, setDraft] = useState(fmtTime(value));
  useEffect(() => setDraft(fmtTime(value)), [value]);
  return <input className="p2-time-input" type="text" inputMode="numeric" placeholder="m:ss" value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      if (!draft.trim()) { onCommit(null); return; }
      const next = parseTime(draft);
      if (next == null) { setDraft(fmtTime(value)); return; }
      setDraft(fmtTime(next));
      onCommit(next);
    }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function ProfileNameInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="p2-profile-name" value={draft} aria-label="TTK profile name"
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { const next = draft.trim(); if (next) onCommit(next); else setDraft(value); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function PriceEditor({ line, currency, divineExalted, chaosExalted, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(line.price.exalted || ""));
  useEffect(() => setDraft(String(line.price.exalted || "")), [line.price.exalted]);
  if (!editing) {
    return (
      <button className={`p2-price ${line.price.found ? "" : "missing"} ${line.price.manual ? "manual" : ""}`}
        onClick={() => setEditing(true)} title="Click to set a manual price in Exalted Orbs">
        {line.price.found ? fmtPrice(line.price.exalted, currency, divineExalted, chaosExalted) : "set price"}
        {line.price.manual && <small>manual</small>}
      </button>
    );
  }
  return (
    <span className="p2-price-edit">
      <input autoFocus type="number" min="0" step="0.1" value={draft} aria-label={`${line.item} price in Exalted Orbs`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const n = Number(draft);
          onCommit(Number.isFinite(n) && n > 0 ? n : null);
          setEditing(false);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditing(false); }} />
      <em>ex</em>
    </span>
  );
}

function GroupTags({ boss }) {
  return <span className="p2-group-tags">{[boss.group, ...(boss.groupTags || [])].map((tag) => (
    <span key={tag} className="p2-group" style={{ "--tone": GROUP_TONES[tag] }}>{tag}</span>
  ))}</span>;
}

function Money({ value, currency, divineExalted, chaosExalted, signed = false }) {
  if (value == null || !Number.isFinite(value)) return <span className="muted">unknown</span>;
  const text = fmtPrice(Math.abs(value), currency, divineExalted, chaosExalted);
  return <span className={value < 0 ? "loss" : value > 0 ? "gain" : ""}>{signed ? `${value >= 0 ? "+" : "−"}${text}` : text}</span>;
}

export default function BossProfit({ league, priceData, currency, chaosExalted, rateSummary }) {
  const [settings, setSettings] = useState(() => sanitizeSettings(settingsStore.load({})));
  const [selectedId, setSelectedId] = useState(BOSSES[0].id);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState("gross");
  const [profilesOpen, setProfilesOpen] = useState(false);

  useEffect(() => { settingsStore.save(settings); }, [settings]);

  const priceMap = priceData && priceData !== "missing" ? priceData.prices || {} : {};
  const divineExalted = priceData && priceData !== "missing" ? priceData.divineExalted || 0 : 0;
  const leaguePriceOverrides = useMemo(() => Object.fromEntries(Object.entries(settings.priceOverrides || {})
    .filter(([key]) => key.startsWith(`${league}:`))
    .map(([key, value]) => [key.slice(league.length + 1), value])), [league, settings.priceOverrides]);
  const rows = useMemo(() => computeBosses(BOSSES, priceMap, { ...settings, priceOverrides: leaguePriceOverrides }), [priceMap, settings, leaguePriceOverrides]);
  const activeProfile = settings.ttkProfiles.find((profile) => profile.id === settings.activeTtkProfileId) || null;
  const priceCoverage = useMemo(() => summarizePriceCoverage(rows), [rows]);
  const overrideCount = Object.keys(settings.rateOverrides).length + Object.keys(settings.priceOverrides).length;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (group !== "all" && row.boss.group !== group && !row.boss.groupTags?.includes(group)) return false;
      return !query || `${row.boss.name} ${row.boss.location} ${row.boss.group} ${(row.boss.groupTags || []).join(" ")}`.toLowerCase().includes(query);
    }).sort((a, b) => {
      if (sort === "name") return a.boss.name.localeCompare(b.boss.name);
      if (sort === "group") return GROUP_ORDER.indexOf(a.boss.group) - GROUP_ORDER.indexOf(b.boss.group) || b.gross - a.gross;
      if (sort === "gross") return b.gross - a.gross;
      if (sort === "hour") return (b.profitPerHour ?? -Infinity) - (a.profitPerHour ?? -Infinity);
      const av = a.net == null ? a.gross : a.net;
      const bv = b.net == null ? b.gross : b.net;
      return bv - av;
    });
  }, [rows, group, search, sort]);

  const selected = visible.find((row) => row.boss.id === selectedId) || visible[0] || rows[0];
  const listMetricLabel = sort === "hour" ? "Profit / hr" : sort === "gross" ? "Gross EV / kill" : "Net EV / kill";
  const listMetric = (row) => sort === "hour" ? row.profitPerHour : sort === "gross" ? row.gross : row.net;
  const maxListMetric = Math.max(1, ...visible.map((row) => Math.abs(listMetric(row) || 0)));

  const setRate = (key, value) => setSettings((current) => sanitizeSettings({
    ...current,
    rateOverrides: { ...current.rateOverrides, [key]: value },
  }));
  const setPrice = (item, value) => setSettings((current) => {
    const priceOverrides = { ...current.priceOverrides };
    const key = `${league}:${item}`;
    if (value == null) delete priceOverrides[key]; else priceOverrides[key] = value;
    return sanitizeSettings({ ...current, priceOverrides });
  });
  const clearOverrides = () => setSettings((current) => sanitizeSettings({
    ...current,
    rateOverrides: {},
    priceOverrides: {},
  }));
  const addProfile = () => setSettings((current) => {
    const taken = new Set(current.ttkProfiles.map((profile) => profile.name));
    let number = 1;
    while (taken.has(`My TTK ${number}`)) number++;
    const profile = { id: `ttk-${Date.now().toString(36)}`, name: `My TTK ${number}`, times: {} };
    setProfilesOpen(true);
    return sanitizeSettings({ ...current, ttkProfiles: [...current.ttkProfiles, profile], activeTtkProfileId: profile.id });
  });
  const updateProfile = (change) => setSettings((current) => sanitizeSettings({
    ...current,
    ttkProfiles: current.ttkProfiles.map((profile) => profile.id === current.activeTtkProfileId ? change(profile) : profile),
  }));
  const setTtk = (bossId, seconds) => updateProfile((profile) => {
    const times = { ...profile.times };
    if (seconds == null) delete times[bossId]; else times[bossId] = seconds;
    return { ...profile, times };
  });
  const deleteProfile = () => {
    setSort("gross");
    setProfilesOpen(false);
    setSettings((current) => sanitizeSettings({
      ...current,
      ttkProfiles: current.ttkProfiles.filter((profile) => profile.id !== current.activeTtkProfileId),
      activeTtkProfileId: null,
    }));
  };

  return (
    <main className="p2-boss-page">
      <style>{bossCss}</style>
      <SourceStrip className="p2-source-strip">
        {priceData === null ? "Loading PoE 2 prices…" : priceData === "missing"
          ? "No generated PoE 2 price snapshot is available yet. Drop tables remain available; EV uses manual prices only."
          : <>Prices via GGG trades + poe.ninja + PoE2Scout gap-fill · {league} · updated {new Date(priceData.generatedAt).toLocaleString()}{rateSummary ? ` · ${rateSummary}` : ""}</>}
      </SourceStrip>

      <section className="p2-override-bar">
        <span>{overrideCount ? `${overrideCount} manual override${overrideCount === 1 ? "" : "s"} active` : "Using market prices and source rates"}</span>
        <button onClick={clearOverrides} disabled={!overrideCount}
          title="Reset every manually edited drop rate and item price. Saved TTK profiles are kept.">Reset overrides</button>
      </section>

      {priceData !== null && <section className={`p2-price-coverage ${priceCoverage.missing.length ? "warning" : "complete"}`}>
        <div>
          <small>PRICE COVERAGE</small>
          <strong>{priceCoverage.missing.length
            ? `${priceCoverage.missing.length} of ${priceCoverage.total} boss-market items have no price`
            : `All ${priceCoverage.total} boss-market items are priced`}</strong>
          <p>{priceCoverage.missing.length
            ? "Missing items contribute zero to EV until a market source supplies them or you set a manual price in the drop table."
            : "Entry costs and drop EV use the generated market snapshot or your manual overrides."}</p>
        </div>
        {!!priceCoverage.missing.length && <details>
          <summary>Show missing items</summary>
          <ul>{priceCoverage.missing.map((item) => (
            <li key={`${item.item}:${item.variant}`}>
              <strong>{item.item}{item.variant ? ` (${item.variant})` : ""}</strong>
              <span>{item.kinds.join(" + ")} · {item.bosses.join(", ")}</span>
            </li>
          ))}</ul>
        </details>}
      </section>}

      <section className="p2-ttk-banner">
        <div>
          <small>TIME TO KILL</small>
          <strong>{activeProfile ? `${activeProfile.name} · ${Object.keys(activeProfile.times).length}/${BOSSES.length} times entered` : "No timing profile selected"}</strong>
          <p>{activeProfile ? "Profit/hour appears only for encounters with a time in this custom profile." : "No default times are assumed. Create a profile to add your own TTK values and unlock profit/hour."}</p>
        </div>
        <div className="p2-ttk-actions">
          {activeProfile && <button onClick={() => setProfilesOpen((open) => !open)}>{profilesOpen ? "Close times" : "Edit times"}</button>}
          <button onClick={addProfile}>+ New TTK profile</button>
        </div>
      </section>

      <section className="p2-boss-tools" aria-label="Boss profit filters">
        <input type="search" placeholder="Filter bosses…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label><span>TTK profile</span><select value={settings.activeTtkProfileId || ""} onChange={(event) => {
          const id = event.target.value || null;
          setSettings((current) => sanitizeSettings({ ...current, activeTtkProfileId: id }));
          if (!id && sort === "hour") setSort("gross");
        }}>
          <option value="">None — EV / kill only</option>
          {settings.ttkProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select></label>
        <label><span>Group</span><select value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="all">All encounters</option>
          {GROUP_ORDER.map((name) => <option key={name}>{name}</option>)}
        </select></label>
        <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="gross">Gross EV / kill</option><option value="net">Net EV / kill</option><option value="hour" disabled={!activeProfile}>Profit / hour</option>
          <option value="group">Group</option><option value="name">Name</option>
        </select></label>
      </section>

      {profilesOpen && activeProfile && <section className="p2-profile-editor">
        <header>
          <div><small>CUSTOM TTK PROFILE</small><ProfileNameInput value={activeProfile.name} onCommit={(name) => updateProfile((profile) => ({ ...profile, name }))} /></div>
          <button className="danger" onClick={deleteProfile}>Delete profile</button>
        </header>
        <p>Enter total seconds or m:ss for the kill. Empty encounters keep profit/hour unavailable; there are no fallback times.</p>
        <div className="p2-time-grid">{BOSSES.map((boss) => (
          <label key={boss.id}><span><strong>{boss.name}</strong><small>{boss.location}</small></span><TimeInput value={activeProfile.times[boss.id]} onCommit={(seconds) => setTtk(boss.id, seconds)} /></label>
        ))}</div>
      </section>}

      <section className="p2-boss-workspace">
        <aside className="p2-boss-sidebar" aria-label="Boss ranking">
          <div className="p2-boss-list-head"><span>Boss</span><span>{listMetricLabel}</span></div>
          <div className="p2-boss-rank-list">
            {visible.map((row) => {
              const metric = listMetric(row);
              const meterWidth = Math.min(100, (Math.abs(metric || 0) / maxListMetric) * 100);
              return (
                <button key={row.boss.id} className={`p2-boss-rank ${selected?.boss.id === row.boss.id ? "selected" : ""}`}
                  style={{ "--tone": GROUP_TONES[row.boss.group] }} onClick={() => setSelectedId(row.boss.id)}>
                  <span className="p2-boss-rank-main">
                    <span className="p2-boss-rank-name"><i />{row.boss.name}</span>
                    <span className="p2-boss-rank-meta">
                      <GroupTags boss={row.boss} />
                      <span>{row.ttkSeconds ? `${fmtTime(row.ttkSeconds)}/run` : "EV/kill"}{` · ${row.pricedCount}/${row.allLines.length} priced`}</span>
                    </span>
                    <span className="p2-boss-meter"><i className={(metric ?? 0) >= 0 ? "up" : "down"} style={{ width: `${meterWidth}%` }} /></span>
                  </span>
                  <span className={`p2-boss-rank-value ${(metric ?? 0) >= 0 ? "gain" : "loss"}`}>
                    {metric == null ? sort === "hour" ? "set TTK" : "unknown" : <Money value={metric} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} signed={sort !== "gross"} />}
                  </span>
                </button>
              );
            })}
            {!visible.length && <p className="p2-empty-result">No bosses match these filters.</p>}
          </div>
        </aside>

        <div className="p2-boss-main">
          {selected && <BossDetail row={selected} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} activeProfile={activeProfile}
            onTtk={setTtk} onRate={setRate} onPrice={setPrice} />}
        </div>
      </section>
    </main>
  );
}

function BossDetail({ row, currency, divineExalted, chaosExalted, activeProfile, onTtk, onRate, onPrice }) {
  const { boss } = row;
  return (
    <section className="p2-boss-detail">
      <header>
        <div><GroupTags boss={boss} /><h2>{boss.name}</h2><p>{boss.location} · {boss.rateSummary}</p></div>
        <a href={boss.sourceUrl} target="_blank" rel="noreferrer">Open drop source ↗</a>
      </header>
      <div className="p2-ev-cards">
        <div><small>ENTRY COST</small><strong>{row.entryLines.length ? row.entryUnknown ? "incomplete" : <Money value={row.entryCost} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} /> : "not charged"}</strong><p>{boss.entryNote || (row.entryLines.length ? "tradeable encounter items" : "no fixed entry item")}</p></div>
        <div><small>GROSS EV / KILL</small><strong><Money value={row.gross} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} /></strong><p>priced drops before entry</p></div>
        <div><small>NET EV / KILL</small><strong><Money value={row.net} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} signed /></strong><p>{row.net == null ? "waiting for every entry price" : "gross EV minus entry"}</p></div>
        <div><small>PROFIT / HOUR</small><strong>{row.ttkSeconds ? <Money value={row.profitPerHour} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} signed /> : "set TTK"}</strong><p>{row.ttkSeconds ? `${fmtTime(row.ttkSeconds)} per kill in the active profile` : "no default timing assumption"}</p></div>
      </div>

      <div className="p2-detail-timing">
        {activeProfile ? <>
          <label>Kill time <TimeInput value={row.ttkSeconds} onCommit={(seconds) => onTtk(boss.id, seconds)} /></label>
          <span>{row.ttkSeconds ? `${fmtTime(row.ttkSeconds)} per run · ${(3600 / row.ttkSeconds).toFixed(1)} kills/hr` : `Add a time to ${activeProfile.name} to calculate profit/hour.`}</span>
        </> : <span>Select or create a custom TTK profile above to add a kill time. No default time is assumed.</span>}
      </div>

      {!!row.entryLines.length && <div className="p2-entry-lines"><strong>Encounter entry</strong>{row.entryLines.map((line) => (
        <span key={line.item}>{line.qty}× {line.item} <em>{line.price.found ? fmtPrice(line.value, currency, divineExalted, chaosExalted) : "unpriced"}</em></span>
      ))}</div>}

      {row.allLines.some((line) => line.gamble) && <div className="p2-gamble-note">
        <strong>Gamble pricing</strong>
        <span>Megalomaniac uses poe.ninja&apos;s normal market quote as a conservative floor. Strong notable combinations can sell for many Divines, so the displayed EV is likely below the true long-run value.</span>
      </div>}

      <div className="p2-drop-grid">{row.groups.map((group) => (
        <section className="p2-drop-group" key={group.id}>
          <header><div><h3>{group.label}</h3>{group.normalized && <p>Observed/estimated weights total {(group.rateTotal * 100).toFixed(1)}%; normalized to one guaranteed outcome for EV.</p>}</div><strong><Money value={group.subtotal} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} /></strong></header>
          <div className="p2-drop-table-wrap"><table className="p2-drop-table">
            <thead><tr><th>Drop</th><th className="right">Chance / qty</th><th className="right">Market price</th><th className="right">Adds to EV</th></tr></thead>
            <tbody>{group.lines.map((line) => (
              <tr key={line.key}>
                <td>
                  <strong>{line.label || line.item}</strong>
                  {line.note && !line.gamble && <span className="p2-info" title={line.note}>i</span>}
                  {line.gamble && <span className="p2-gamble" title={line.note}>Gamble</span>}
                  {line.rarity && <small className="p2-rarity">{line.rarity}</small>}
                  {line.priceProxy && <small className="p2-price-proxy">priced as {line.priceProxy}</small>}
                </td>
                <td className="right">{group.kind === "fixed"
                  ? `${line.quantity.toFixed(line.quantity % 1 ? 1 : 0)}×`
                  : <RateInput value={line.rawRate} onCommit={(value) => onRate(line.key, value)} />}</td>
                <td className="right"><PriceEditor line={line} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} onCommit={(value) => onPrice(line.item, value)} /></td>
                <td className="right"><Money value={line.value} currency={currency} divineExalted={divineExalted} chaosExalted={chaosExalted} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}</div>
      <p className="p2-model-note">EV is probability × current market price. Guaranteed pools are normalized to exactly one outcome; additional drops keep their independent rates. Profit/hour is shown only when the selected custom profile has a TTK for this encounter.</p>
    </section>
  );
}

const bossCss = `
.p2-boss-page { display:grid; gap:14px; }
.p2-override-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:39px; color:#9d8980; font-size:12.5px; }.p2-override-bar button { padding:7px 12px; border:1px solid #65351f; border-radius:5px; background:#17100d; color:#b99d91; font:inherit; font-size:12.5px; cursor:pointer; }.p2-override-bar button:hover:not(:disabled) { color:#f0e4de; border-color:#bd461d; }.p2-override-bar button:disabled { opacity:.42; cursor:default; }
.p2-price-coverage { display:grid; gap:10px; padding:15px 17px; border:1px solid #3c5335; border-radius:7px; background:linear-gradient(100deg,#111a0e,#100d0b); }.p2-price-coverage>div{display:grid;gap:3px}.p2-price-coverage small{color:#76ad6f;font-size:11px;letter-spacing:.14em}.p2-price-coverage strong{color:#d8e5cf;font-size:15.5px}.p2-price-coverage p{margin:0;color:#96a58d;font-size:13.5px;line-height:1.45}.p2-price-coverage.warning{border-color:#6d3e22;background:linear-gradient(100deg,#24130d,#130e0c)}.p2-price-coverage.warning small{color:#f07b3e}.p2-price-coverage.warning strong{color:#f1dfd5}.p2-price-coverage.warning p{color:#b49a8f}.p2-price-coverage details{border-top:1px solid #4b3024;padding-top:8px}.p2-price-coverage summary{width:max-content;color:#dda17f;font-size:12.5px;cursor:pointer}.p2-price-coverage ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:5px 12px;margin:10px 0 0;padding:0;list-style:none}.p2-price-coverage li{display:grid;gap:2px;padding:7px 9px;border:1px solid #3d291f;border-radius:5px;background:#120d0b}.p2-price-coverage li strong{color:#d8c2b7;font-size:12.5px}.p2-price-coverage li span{color:#8f796f;font-size:11px;line-height:1.35}
.p2-boss-detail > header a { flex:0 0 auto; padding:8px 11px; border:1px solid #754326; border-radius:5px; background:#20140f; color:#d6b4a2; font:inherit; font-size:12.5px; cursor:pointer; text-decoration:none; }
.p2-ttk-banner { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:15px 17px; border:1px solid #3d3d27; border-radius:7px; background:linear-gradient(100deg,#17160d,#100d0b); }.p2-ttk-banner>div:first-child{display:grid;gap:3px}.p2-ttk-banner small,.p2-profile-editor small{color:#b1a35c;font-size:11px;letter-spacing:.14em}.p2-ttk-banner strong{color:#e4dcc2;font-size:15.5px}.p2-ttk-banner p{margin:0;color:#a39b7c;font-size:13.5px}.p2-ttk-actions{display:flex;gap:7px}.p2-ttk-actions button,.p2-profile-editor button{padding:9px 11px;border:1px solid #615a2e;border-radius:5px;background:#1b190d;color:#d4ca92;font:inherit;font-size:13px;cursor:pointer}
.p2-boss-tools { display:flex; flex-wrap:wrap; align-items:end; gap:12px; padding:14px; border:1px solid #33241d; border-radius:7px; background:#100c0a; }
.p2-boss-tools > input { min-width:240px; flex:1; }.p2-boss-tools input,.p2-boss-tools select { min-height:38px; padding:7px 10px; border:1px solid #59331f; border-radius:5px; background:#0c0908; color:#e2d1c7; font:inherit; font-size:13.5px; }
.p2-boss-tools label { display:grid; gap:5px; color:#9f887c; font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
.p2-profile-editor{padding:16px;border:1px solid #50492b;border-radius:7px;background:#0e0d08}.p2-profile-editor>header{display:flex;align-items:end;justify-content:space-between;gap:12px}.p2-profile-editor>header>div{display:grid;gap:5px}.p2-profile-name{min-width:240px;padding:8px 10px;border:1px solid #615a2e;border-radius:5px;background:#090906;color:#ebe1b2;font:inherit;font-size:16px}.p2-profile-editor button.danger{border-color:#753a2b;color:#dc8268;background:#22110d}.p2-profile-editor>p{margin:11px 0;color:#9b9274;font-size:13px}.p2-time-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.p2-time-grid label{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:1px solid #2e2c1b;border-radius:5px;background:#131209}.p2-time-grid label>span{min-width:0}.p2-time-grid strong,.p2-time-grid small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.p2-time-grid strong{color:#c8bea0;font-size:13px}.p2-time-grid small{margin-top:2px;color:#837b62;font-size:11px;letter-spacing:0}.p2-time-input{width:64px;padding:6px;border:1px solid #635c2f;border-radius:4px;background:#090906;color:#e5dcae;font:inherit;font-size:13px;text-align:center}
.p2-boss-workspace { display:grid; grid-template-columns:minmax(320px,380px) minmax(0,1fr); gap:14px; align-items:start; }
.p2-boss-sidebar { overflow:hidden; border:1px solid #3e281e; border-radius:8px; background:#120d0b; }
.p2-boss-list-head { display:flex; justify-content:space-between; gap:12px; padding:10px 13px; border-bottom:1px solid #3a251c; color:#88756c; font-size:10.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; }
.p2-boss-rank-list { max-height:76vh; overflow-y:auto; scrollbar-color:#6d4937 #160f0c; }
.p2-boss-rank { display:flex; align-items:center; gap:10px; width:100%; padding:11px 13px; border:0; border-bottom:1px solid #2d1d17; background:transparent; color:#cdb9af; font:inherit; text-align:left; cursor:pointer; }
.p2-boss-rank:hover { background:#1d120e; }.p2-boss-rank.selected { background:#32170c; box-shadow:inset 3px 0 #e56632; }.p2-boss-rank:focus-visible { outline:2px solid #ff6a24; outline-offset:-2px; }
.p2-boss-rank-main { flex:1; min-width:0; }.p2-boss-rank-name { display:flex; align-items:center; gap:7px; overflow:hidden; color:#eee1da; font-size:15px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }.p2-boss-rank-name i { width:8px; height:8px; flex:0 0 auto; border-radius:50%; background:var(--tone); }
.p2-boss-rank-meta { display:flex; flex-wrap:wrap; align-items:center; gap:5px 7px; margin:4px 0 6px 15px; color:#99877e; font-size:12px; line-height:1.45; }.p2-boss-rank-meta em { padding:1px 4px; border:1px solid #754326; border-radius:3px; color:#df8b61; font-size:10.5px; font-style:normal; }
.p2-boss-meter { display:block; height:5px; margin-left:15px; overflow:hidden; border-radius:999px; background:#281a14; }.p2-boss-meter i { display:block; height:100%; border-radius:999px; }.p2-boss-meter i.up { background:linear-gradient(90deg,#4e7a45,#8fd47f); }.p2-boss-meter i.down { background:linear-gradient(90deg,#7a4545,#d47f7f); }
.p2-boss-rank-value { flex:0 0 auto; color:#a5d48f; font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }.p2-boss-rank-value.loss { color:#d47f7f; }
.p2-boss-main { min-width:0; }.right { text-align:right!important; }.strong { font-weight:700; }
.p2-group-tags { display:inline-flex; flex-wrap:wrap; gap:4px; }.p2-group { display:inline-flex; padding:3px 7px; border:1px solid color-mix(in srgb,var(--tone) 60%,#241812); border-radius:999px; background:color-mix(in srgb,var(--tone) 14%,#110c09); color:var(--tone); font-size:10px; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
.p2-ok { color:#6eaa73; }.muted { color:#806f68!important; }.gain { color:#79bd72; }.loss { color:#e16f62; }
.p2-boss-detail { padding:0 0 16px; border:1px solid #4b2d20; border-radius:8px; background:#0e0a08; }.p2-boss-detail > header { display:flex; align-items:start; justify-content:space-between; gap:15px; padding:15px 17px; border-bottom:1px solid #35241d; }.p2-boss-detail h2 { margin:8px 0 2px; color:#f2dfd5; font-size:24px; font-weight:600; }.p2-boss-detail header p { margin:0; color:#9b867c; font-size:13.5px; }
.p2-ev-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; padding:15px 17px 5px; }.p2-ev-cards > div { min-height:94px; padding:12px 13px; border:1px solid #35241c; border-radius:6px; background:#15100d; }.p2-ev-cards small { color:#8a766c; font-size:10.5px; letter-spacing:.11em; }.p2-ev-cards strong { display:block; margin:5px 0 3px; color:#e9d7cc; font-size:21px; }.p2-ev-cards p { margin:0; color:#917c72; font-size:12.5px; line-height:1.35; }
.p2-detail-timing { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:11px 17px 9px; color:#9d8980; font-size:13.5px; }.p2-detail-timing label { display:flex; align-items:center; gap:8px; color:#c0a89d; }.p2-detail-timing span { color:#8f7b72; }
.p2-entry-lines { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin:0 17px 4px; color:#a48d82; font-size:13.5px; }.p2-entry-lines > strong { color:#cdb4a8; margin-right:4px; }.p2-entry-lines span { padding:6px 8px; border:1px solid #37251d; border-radius:5px; }.p2-entry-lines em { color:#d09169; font-style:normal; }
.p2-gamble-note { display:flex; align-items:flex-start; gap:9px; margin:8px 17px 0; padding:9px 11px; border:1px solid #5d4826; border-radius:5px; background:#171309; color:#a89874; font-size:12.5px; line-height:1.45; }.p2-gamble-note strong{flex:0 0 auto;color:#dfbd63}.p2-gamble{display:inline-flex;margin-left:6px;padding:2px 5px;border:1px solid #80682d;border-radius:4px;background:#241e0b;color:#e4bf50;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;vertical-align:2px;cursor:help}
.p2-drop-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr)); gap:12px; padding:11px 17px 0; align-items:start; }.p2-drop-group { min-width:0; overflow:hidden; border:1px solid #35241d; border-radius:7px; }.p2-drop-group > header { display:flex; justify-content:space-between; gap:12px; padding:12px 14px; background:#17110e; }.p2-drop-group h3 { margin:0; color:#d9c1b5; font-size:15.5px; }.p2-drop-group header p { margin:3px 0 0; color:#a07e6d; font-size:12px; line-height:1.4; }.p2-drop-group > header > strong { color:#d99a6a; font-size:14px; white-space:nowrap; }
.p2-drop-table-wrap { min-width:0; overflow:hidden; }.p2-drop-table { width:100%; min-width:0; border-collapse:collapse; table-layout:fixed; font-size:13.5px; }.p2-drop-table th { padding:9px 8px; color:#817067; font-size:10px; line-height:1.25; letter-spacing:.08em; text-align:left; text-transform:uppercase; white-space:normal; }.p2-drop-table td { min-width:0; padding:9px 8px; border-top:1px solid #271b16; color:#c7aea2; overflow-wrap:anywhere; }.p2-drop-table th:nth-child(1){width:40%}.p2-drop-table th:nth-child(2){width:20%}.p2-drop-table th:nth-child(3){width:20%}.p2-drop-table th:nth-child(4){width:20%}.p2-drop-table td:first-child strong { color:#e7d2c8; }.p2-drop-table td:first-child small { color:#967c70; font-size:12px; }.p2-rarity,.p2-price-proxy { display:block; }.p2-info { display:inline-grid; width:16px; height:16px; margin-left:5px; place-items:center; border:1px solid #6e4b3d; border-radius:50%; color:#bc876e; font-size:10.5px; line-height:1; vertical-align:2px; cursor:help; }
.p2-rate-input,.p2-price-edit { display:inline-flex; max-width:100%; align-items:center; justify-content:flex-end; gap:3px; }.p2-rate-input input,.p2-price-edit input { width:min(62px,calc(100% - 14px)); min-width:42px; padding:4px 5px; border:1px solid #7d4023; border-radius:4px; background:#0d0907; color:#f2c1a7; font:inherit; text-align:right; }.p2-rate-input em,.p2-price-edit em,.p2-rate em { color:#8b7165; font-style:normal; }.p2-rate,.p2-price { display:inline-grid; max-width:100%; justify-items:end; padding:0; border:0; background:none; color:#d6a37c; font:inherit; overflow-wrap:anywhere; cursor:pointer; }.p2-rate { display:inline-flex; gap:3px; }.p2-rate:hover,.p2-price:hover { color:#f0c3a6; text-decoration:underline dotted; }.p2-price.missing { color:#b96748; text-decoration:underline dotted; }.p2-price.manual { color:#77b780; }.p2-price small { color:#709173; font-size:9px; }
.p2-model-note { margin:15px 17px 0; color:#8f7a70; font-size:13px; line-height:1.55; }.p2-empty-result { padding:25px 12px; color:#8d766c; font-size:13.5px; text-align:center; }
@media(max-width:1120px){.p2-boss-workspace{grid-template-columns:320px minmax(0,1fr)}.p2-time-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.p2-ev-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.p2-drop-grid{grid-template-columns:1fr}}
@media(max-width:900px){.p2-boss-workspace{grid-template-columns:1fr}.p2-boss-rank-list{max-height:360px}.p2-ttk-banner{align-items:flex-start;flex-direction:column}.p2-time-grid{grid-template-columns:1fr}}
@media(max-width:520px){.p2-boss-detail>header,.p2-profile-editor>header{align-items:stretch;flex-direction:column}.p2-ev-cards{grid-template-columns:1fr}.p2-drop-grid{padding-inline:10px}.p2-boss-tools>*{width:100%}.p2-ttk-actions{flex-wrap:wrap}}
`;
