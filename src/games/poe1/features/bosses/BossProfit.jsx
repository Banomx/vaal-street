import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { SourceStrip } from "../../../../shared/ui/AppShell.jsx";
import { POE1_SCHEMA_VERSIONS } from "../../config.js";
import { isUsable, loadDocument } from "../../../../shared/data/snapshot.js";
import { sourceNote } from "../pricing/priceCheck.js";
import PriceCell, { NumInput } from "../pricing/PriceCell.jsx";
import { BOSSES, GROUP_ORDER, GROUP_TONES } from "./bossData.js";
import {
  makeResolver, computeBoss, profitChance, loadProfiles, saveProfiles, loadActive, saveActive,
  defaultProfile, sanitizeProfile, uniqueName, bossItems, profileSpeed,
} from "./bossProfit.js";

/* ================================================================
   BOSS PROFITABILITY
   Expected value per kill from the drop groups, minus what it costs to
   open the fight, over how long a run takes you.

   Two views: the ranked boss list, and a manager for TTK profiles where
   every boss's kill time is editable in one grid.
   ================================================================ */

/* Prices are always the typical listing — the median across whatever poe.ninja
   lists for the base item. There used to be Cheapest / Best roll toggles on top
   of that, but neither described a drop you can actually get: "best roll" meant
   the corrupted 21/20 gem or the dearest stat roll of a unique, and a boss
   hands you a random one. A single honest number beats three, two of which
   flatter the EV. The listing spread is still shown on each price as a tooltip.
   The snapshot keeps lo/hi for that. */

const RATE_BADGE = {
  ledger: null,
  wiki: { text: "wiki", title: "Rates from poewiki, not the ledger drop tables" },
  estimate: { text: "est", title: "Rates are a placeholder — nothing published" },
};

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* "4:00" -> 240, "90" -> 90. Anything unparseable returns null so the
   caller can put the old value back rather than writing NaN. */
function parseTime(text) {
  const t = String(text).trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m), ss = Number(s || 0);
    if (!isFinite(mm) || !isFinite(ss)) return null;
    return Math.max(0, Math.round(mm * 60 + ss));
  }
  const n = Number(t);
  return isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function pctText(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 0.1) return `${(v * 100).toFixed(0)}%`;
  if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
  if (v > 0) return `${(v * 100).toFixed(2)}%`;
  return "—";
}

/* Controlled number input that lets you clear the field while typing. */
/* Same idea, but m:ss — kill times read far better that way. */
function TimeInput({ value, onCommit, width = 58, title, custom }) {
  const [draft, setDraft] = useState(fmtTime(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(fmtTime(value)); }, [value]);
  return (
    <input
      className={`bp-time ${custom ? "custom" : ""}`} type="text" inputMode="numeric"
      value={draft} style={{ width }} title={title}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        focused.current = false;
        const n = parseTime(e.target.value);
        if (n == null) { setDraft(fmtTime(value)); return; }
        setDraft(fmtTime(n));
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

/* unitFor resolves the "smart" currency to chaos or divine for one value;
   for the fixed modes it just hands the mode back. */
export default function BossProfit({ league, staticBase, currency, divineRate, mirrorDivine, fmtPrice, fmtChaos, fmtDiv,
                                     unitFor = (chaos, cur) => cur, initialBoss = null }) {
  const [priceMap, setPriceMap] = useState(null);   // null = loading, "missing" = no snapshot
  const [generatedAt, setGeneratedAt] = useState(null);
  // Which price sources actually answered on the day this snapshot was taken.
  const [priceSource, setPriceSource] = useState(null);
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const [activeName, setActiveName] = useState(() => loadActive(loadProfiles()));
  const [view, setView] = useState("bosses");       // bosses | profiles
  const [editingProfile, setEditingProfile] = useState(null);
  const [selected, setSelected] = useState(() =>
    BOSSES.some((boss) => boss.id === initialBoss) ? initialBoss : BOSSES[0].id);
  const [sortKey, setSortKey] = useState("profitPerHour");
  const [runs, setRuns] = useState(10);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [uberFilter, setUberFilter] = useState("all");

  const profile = profiles.find((p) => p.name === activeName) || profiles[0];

  useEffect(() => { saveProfiles(profiles); }, [profiles]);
  useEffect(() => { saveActive(activeName); }, [activeName]);

  /* ---- prices ---- */
  useEffect(() => {
    if (!staticBase) return undefined; // no league folder yet
    let cancelled = false;
    setPriceMap(null);
    (async () => {
      /* Boss expected values are built from these prices, so a file that fails
         its schema contract is refused rather than half-read: a resolver
         missing half its names quietly turns a loss into a profit. */
      const doc = await loadDocument(`${staticBase}/prices.json`, { supported: POE1_SCHEMA_VERSIONS, required: ["prices"] });
      if (cancelled) return;
      if (!isUsable(doc)) { setPriceMap("missing"); return; }
      setPriceMap(doc.data.prices || {});
      setGeneratedAt(doc.data.generatedAt || null);
      setPriceSource(doc.data.priceSource || null);
    })();
    return () => { cancelled = true; };
  }, [staticBase]);

  const resolve = useMemo(
    () => makeResolver(priceMap && priceMap !== "missing" ? priceMap : null, {
      priceOverrides: profile?.priceOverrides || {},
      divineRate,
    }),
    [priceMap, profile, divineRate]
  );

  const rows = useMemo(
    () => BOSSES.map((b) => computeBoss(b, resolve, (profile?.bosses || {})[b.id] || {})),
    [resolve, profile]
  );

  /* Variance matters as much as EV — a boss can be +EV entirely on a 1% drop
     and still lose money most nights. Simulated for every boss so the list can
     be ranked by it, at a lower trial count to stay responsive; the open boss
     is re-run at full precision below. */
  const safety = useMemo(() => {
    const out = {};
    for (const r of rows) out[r.boss.id] = r.gross > 0 ? profitChance(r, runs, 1200) : null;
    return out;
  }, [rows, runs]);

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== "all") list = list.filter((r) => r.boss.group === groupFilter);
    if (uberFilter !== "all") list = list.filter((r) => !!r.boss.uber === (uberFilter === "uber"));
    return list.slice().sort((a, b) => {
      if (sortKey === "safety") {
        // Certainty first, then size of the win — a coin-flip boss that pays
        // more is still the better of two equally safe ones.
        const sa = safety[a.boss.id] ?? -1, sb = safety[b.boss.id] ?? -1;
        return sb - sa || b.profitPerHour - a.profitPerHour;
      }
      if (sortKey === "name") return a.boss.name.localeCompare(b.boss.name);
      if (sortKey === "group") {
        const d = GROUP_ORDER.indexOf(a.boss.group) - GROUP_ORDER.indexOf(b.boss.group);
        return d || b.profitPerHour - a.profitPerHour;
      }
      return b[sortKey] - a[sortKey];
    });
  }, [rows, sortKey, groupFilter, uberFilter, safety]);

  const maxProfit = Math.max(1, ...rows.map((r) => Math.abs(r.profitPerHour)));

  const current = rows.find((r) => r.boss.id === selected) || rows[0];

  /* Does the open boss actually have anything to reset? A button that looks
     live but does nothing is indistinguishable from a broken one, so it goes
     disabled when there is no override to clear. */
  const bossDirty = useMemo(() => {
    if (!current) return false;
    if (Object.keys((profile?.bosses || {})[current.boss.id] || {}).length) return true;
    const po = profile?.priceOverrides || {};
    for (const item of bossItems(current.boss)) if (po[item] != null) return true;
    return false;
  }, [current, profile]);
  const chance = useMemo(
    () => (current && current.gross > 0 ? profitChance(current, runs, 6000) : null),
    [current, runs]
  );

  /* ---- profile mutation ----
     A built-in profile is a fixed reference, so the first edit forks it into
     an editable copy instead of being swallowed. Every number on this page is
     an input, and an input that silently does nothing reads as a bug — the
     alternative, letting the edit through, would quietly redefine the preset
     for the next person who selects it. */
  const mutateNamed = useCallback((name, fn) => {
    setProfiles((ps) => {
      const target = ps.find((p) => p.name === name);
      if (!target) return ps;
      if (!target.builtIn) return ps.map((p) => (p.name === name ? fn({ ...p }) : p));
      const copy = fn({ ...target, builtIn: false, name: uniqueName(ps, `${name} (edited)`) });
      setActiveName(copy.name);
      // If the edit came from the profile's own times grid, follow it to the
      // copy — otherwise the grid would snap back to the preset's numbers.
      setEditingProfile((cur) => (cur === name ? copy.name : cur));
      return [...ps, copy];
    });
  }, []);
  const mutate = useCallback((fn) => mutateNamed(activeName, fn), [mutateNamed, activeName]);

  const setBossFieldIn = useCallback((profName, bossId, field, value) => {
    mutateNamed(profName, (p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      if (value == null) delete b[field]; else b[field] = value;
      p.bosses = { ...p.bosses, [bossId]: b };
      if (!Object.keys(b).length) delete p.bosses[bossId];
      return p;
    });
  }, [mutateNamed]);

  const setBossField = useCallback((bossId, field, value) =>
    setBossFieldIn(activeName, bossId, field, value), [setBossFieldIn, activeName]);

  const setGroupField = useCallback((bossId, groupId, field, value) => {
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.groups = { ...(b.groups || {}), [groupId]: { ...((b.groups || {})[groupId] || {}), [field]: value } };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setDropRate = useCallback((bossId, key, kind, value) => {
    const field = kind === "pool" ? "share" : kind === "weighted" ? "weight" : "chance";
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.drops = { ...(b.drops || {}), [key]: { [field]: value } };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setEntryQty = useCallback((bossId, item, qty) => {
    mutate((p) => {
      const b = { ...(p.bosses[bossId] || {}) };
      b.entry = { ...(b.entry || {}), [item]: qty };
      p.bosses = { ...p.bosses, [bossId]: b };
      return p;
    });
  }, [mutate]);

  const setPriceOverride = useCallback((item, chaos) => {
    mutate((p) => {
      p.priceOverrides = { ...p.priceOverrides };
      if (chaos == null) delete p.priceOverrides[item];
      else p.priceOverrides[item] = chaos;
      return p;
    });
  }, [mutate]);

  /* "Reset this boss" has to clear BOTH kinds of override, or it looks broken:
     kill times and drop rates live under p.bosses[id], but edited prices live
     in p.priceOverrides keyed by item name, because a price belongs to an item
     rather than to a boss. Clearing only the first left every price edit in
     place, which is what made the button read as a no-op.
     Prices being shared is deliberate and it cuts both ways: correcting Divine
     Orb once fixes it on every boss that drops one, and resetting any of those
     bosses puts it back to the market price everywhere. */
  const resetBoss = useCallback((bossId) => {
    const items = bossItems(BOSSES.find((b) => b.id === bossId));
    mutate((p) => {
      const next = { ...p.bosses };
      delete next[bossId];
      const po = { ...p.priceOverrides };
      for (const item of items) delete po[item];
      p.bosses = next;
      p.priceOverrides = po;
      return p;
    });
  }, [mutate]);

  const resetAll = useCallback(() => mutate((p) => ({ ...p, bosses: {}, priceOverrides: {} })), [mutate]);

  /* ---- profile management ---- */
  const addProfile = (seed) => {
    const name = uniqueName(profiles, seed ? `${seed.name} copy` : "New profile");
    const p = seed ? { ...sanitizeProfile(seed), name } : defaultProfile(name);
    setProfiles((ps) => [...ps, p]);
    setEditingProfile(name);
    return name;
  };
  const renameProfile = (from, to) => {
    const clean = (to || "").trim();
    if (!clean || clean === from) return;
    const name = uniqueName(profiles.filter((p) => p.name !== from), clean);
    setProfiles((ps) => ps.map((p) => (p.name === from ? { ...p, name } : p)));
    if (activeName === from) setActiveName(name);
    if (editingProfile === from) setEditingProfile(name);
  };
  const deleteProfile = (name) => {
    setProfiles((ps) => {
      if (ps.length <= 1) return [defaultProfile("Default")];
      const next = ps.filter((p) => p.name !== name);
      if (activeName === name) setActiveName(next[0].name);
      return next;
    });
    if (editingProfile === name) setEditingProfile(null);
  };
  const exportProfile = async (p) => {
    const text = JSON.stringify(p, null, 2);
    setImportText(text); setImportOpen(true);
    try { await navigator.clipboard.writeText(text); setImportMsg("Copied to clipboard."); }
    catch { setImportMsg("Copy this JSON."); }
  };
  const doImport = () => {
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch { setImportMsg("That isn't valid JSON."); return; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = [];
    for (const [i, raw] of list.entries()) {
      const c = sanitizeProfile(raw, `Imported ${i + 1}`);
      c.name = uniqueName([...profiles, ...cleaned], c.name);
      cleaned.push(c);
    }
    setProfiles((ps) => [...ps, ...cleaned]);
    setActiveName(cleaned[0].name);
    setImportOpen(false); setImportText(""); setImportMsg("");
    setView("profiles");
  };

  const money = (chaos) => fmtPrice(chaos, currency, divineRate);
  // Under Smart the unit is per value, so it has to be resolved inside, not
  // hoisted: a 40c entry cost and a 12 divine payout sit in the same row.
  const signed = (chaos) => {
    const u = unitFor(chaos, currency, divineRate);
    const v = u === "chaos" ? chaos : chaos / divineRate;
    const f = u === "chaos" ? fmtChaos : fmtDiv;
    return `${v < 0 ? "−" : ""}${f(Math.abs(v))}${u === "chaos" ? "c" : "div"}`;
  };

  const groupsPresent = useMemo(() => GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)), []);
  const ttkOf = (p, b) => (p.bosses?.[b.id]?.ttk ?? b.ttk) + (p.bosses?.[b.id]?.overhead ?? b.overhead ?? 0);
  const profileStats = (p) => {
    const times = BOSSES.map((b) => ttkOf(p, b));
    const customised = BOSSES.filter((b) => p.bosses?.[b.id]?.ttk != null || p.bosses?.[b.id]?.overhead != null).length;
    return { avg: times.reduce((s, v) => s + v, 0) / (times.length || 1), customised, speed: profileSpeed(p) };
  };
  /* The one number that answers "how fast is this profile" — shown wherever a
     profile is chosen, so the answer never needs the times grid. */
  const speedTag = (p) => `${profileSpeed(p)}x`;

  return (
    <section className="bp-wrap">
      {priceMap === null && <SourceStrip className="app-source-strip--spaced st-banner st-quiet">Loading prices…</SourceStrip>}
      {priceMap === "missing" && (
        <SourceStrip className="app-source-strip--spaced st-banner" tone="alert">
          No price snapshot for {league} yet. Boss values need <code>prices.json</code>, which the
          data workflow writes alongside the scarab data — it appears after the next refresh.
          You can still edit drop rates and times; prices will fill in.
        </SourceStrip>
      )}
      {priceMap && priceMap !== "missing" && (
        <SourceStrip className="app-source-strip--spaced st-banner st-quiet">
          Prices via {priceSource || "GGG Currency Exchange, poe.watch and poe.ninja"} · {league}
          {generatedAt ? ` · updated ${new Date(generatedAt).toLocaleString()}` : ""}
          {" · "}1 Divine ≈ {Math.round(divineRate)} Chaos
          {mirrorDivine > 0 && <> · 1 Mirror ≈ {Math.round(mirrorDivine).toLocaleString()} Divine</>}
        </SourceStrip>
      )}

      <div className="bp-views">
        <button className={view === "bosses" ? "on" : ""} onClick={() => setView("bosses")}>Bosses</button>
        <button className={view === "profiles" ? "on" : ""} onClick={() => setView("profiles")}>TTK profiles</button>
        <span className="bp-views-active">Using <strong>{profile?.name}</strong></span>
        <button className="bp-reset" onClick={resetAll} title="Clear every override in the active profile">Reset overrides</button>
      </div>

      {importOpen && (
        <div className="bp-import">
          <div className="bp-import-head">
            <strong>Profile JSON</strong>
            <button className="st-close" onClick={() => setImportOpen(false)}>Close</button>
          </div>
          <textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportMsg(""); }}
            spellCheck="false" placeholder='{"name":"My TTK","bosses":{"maven":{"ttk":180}}}' />
          {importMsg && <div className="bp-import-err">{importMsg}</div>}
          <button className="bp-import-go" onClick={doImport}>Import as new profile</button>
        </div>
      )}

      {/* ================= TTK profile manager ================= */}
      {view === "profiles" && (
        <div className="bp-manage">
          <div className="bp-manage-head">
            <h3>Manage TTK profiles</h3>
            <button className="bp-primary" onClick={() => addProfile(null)}>+ New profile</button>
            <button onClick={() => { setImportOpen(true); setImportText(""); setImportMsg(""); }}>Import</button>
          </div>

          {profiles.map((p) => {
            const stats = profileStats(p);
            const editing = editingProfile === p.name;
            return (
              <div className={`bp-prof ${editing ? "editing" : ""} ${activeName === p.name ? "active" : ""}`} key={p.name}>
                <div className="bp-prof-head">
                  {editing && !p.builtIn
                    ? <input className="bp-prof-name" defaultValue={p.name} aria-label="Profile name"
                        onBlur={(e) => renameProfile(p.name, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                    : <strong className="bp-prof-title">
                        {p.name}
                        <em className="bp-prof-speed" title={`Kill times are ${stats.speed}x the default speed, boss for boss (median). Setup and travel are not included.`}>
                          {speedTag(p)}
                        </em>
                        {p.builtIn && <em className="bp-prof-preset">preset</em>}
                        {activeName === p.name && <em>in use</em>}
                      </strong>}
                  <span className="bp-prof-meta">
                    {BOSSES.length} bosses · avg {fmtTime(stats.avg)}
                    {stats.customised ? ` · ${stats.customised} customised` : " · all default"}
                  </span>
                  <span className="bp-prof-btns">
                    <button onClick={() => setEditingProfile(editing ? null : p.name)}>{editing ? "Done" : p.builtIn ? "View times" : "Edit times"}</button>
                    <button onClick={() => exportProfile(p)}>Export</button>
                    <button onClick={() => addProfile(p)}>Duplicate</button>
                    {activeName !== p.name && <button onClick={() => { setActiveName(p.name); setView("bosses"); }}>Use</button>}
                    {!p.builtIn && <button className="bp-danger" onClick={() => deleteProfile(p.name)}>Delete</button>}
                  </span>
                </div>

                {editing && (
                  <>
                    <div className="bp-prof-hint">
                      {p.builtIn
                        ? <>Built into the site and not editable — about {stats.speed}x the default kill
                          speed. A few fights are set by their mechanics rather than your damage and carry
                          their own figure: both Shapers, and King in the Mists at a flat 0:30 whatever the
                          build, since that run is mostly arena. Setup/travel is untouched too, so the tier
                          17 maps keep their full minute. <strong>Duplicate</strong> it to get a copy you can
                          change, or just start editing and one is made for you.</>
                        : <>Kill time per boss, as <code>m:ss</code> (plain numbers are read as seconds). Highlighted
                          fields differ from the default. Setup/travel time stays on the boss page.</>}
                    </div>
                    <div className="bp-prof-grid">
                      {GROUP_ORDER.filter((g) => BOSSES.some((b) => b.group === g)).map((g) => (
                        <div className="bp-prof-section" key={g}>
                          <div className="bp-prof-section-head" style={{ "--tone": GROUP_TONES[g] }}>{g}</div>
                          {BOSSES.filter((b) => b.group === g).map((b) => {
                            const custom = p.bosses?.[b.id]?.ttk != null;
                            return (
                              <label className="bp-prof-cell" key={b.id}>
                                <span>{b.name}</span>
                                <TimeInput
                                  value={p.bosses?.[b.id]?.ttk ?? b.ttk}
                                  custom={custom}
                                  title={custom ? `Default is ${fmtTime(b.ttk)} — clear to nothing to restore` : "Default"}
                                  onCommit={(v) => setBossFieldIn(p.name, b.id, "ttk", v === b.ttk ? null : v)} />
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="bp-prof-foot">
                      <button onClick={() => mutateNamed(p.name, (pp) => {
                        const next = {};
                        for (const [id, s] of Object.entries(pp.bosses)) {
                          const { ttk, overhead, ...rest } = s;
                          if (Object.keys(rest).length) next[id] = rest;
                        }
                        return { ...pp, bosses: next };
                      })}>Reset all times to default</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ================= ranked bosses ================= */}
      {view === "bosses" && (
        <>
          <div className="bp-bar">
            <label className="app-control st-ctl">
              <span>TTK profile</span>
              <select value={activeName} onChange={(e) => setActiveName(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name} · {speedTag(p)} kill speed</option>
                ))}
              </select>
            </label>
            <div className="app-control st-ctl">
              <span>Variant</span>
              <div className="app-segmented st-seg">
                <button className={uberFilter === "all" ? "on" : ""} onClick={() => setUberFilter("all")}>All</button>
                <button className={uberFilter === "normal" ? "on" : ""} onClick={() => setUberFilter("normal")}>Normal</button>
                <button className={uberFilter === "uber" ? "on" : ""} onClick={() => setUberFilter("uber")}>Uber</button>
              </div>
            </div>
            <label className="app-control st-ctl">
              <span>Content</span>
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="all">All</option>
                {groupsPresent.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="app-control st-ctl" title="How many consecutive runs the profit chance is simulated over">
              <span>Runs simulated</span>
              <NumInput value={runs} min={1} width={54}
                onCommit={(v) => setRuns(Math.max(1, Math.min(500, Math.round(v))))} />
            </label>
            <label className="app-control st-ctl">
              <span>Sort by</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                <option value="profitPerHour">Profit / hour</option>
                <option value="safety">Safest (chance of profit)</option>
                <option value="net">Profit / kill</option>
                <option value="gross">Drop value / kill</option>
                <option value="entryCost">Entry cost</option>
                <option value="group">Content</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          <div className="bp-body">
            <div className="bp-list">
              <div className="bp-list-head"><span>Boss</span><span>Profit / hr</span></div>
              {visible.map((r) => {
                const tone = GROUP_TONES[r.boss.group] || "#c9a24b";
                const w = Math.min(100, (Math.abs(r.profitPerHour) / maxProfit) * 100);
                const badge = RATE_BADGE[r.boss.rates];
                return (
                  <button key={r.boss.id}
                    className={`bp-item ${selected === r.boss.id ? "on" : ""}`}
                    style={{ "--tone": tone }}
                    onClick={() => setSelected(r.boss.id)}>
                    <span className="bp-item-main">
                      <span className="bp-item-name">
                        <i className="bp-dot" />{r.boss.name}
                        {badge && <em className="bp-flag" title={badge.title}>{badge.text}</em>}
                        {r.missingPrices > 0 && <em className="bp-flag warn"
                          title={`${r.missingPrices} drop(s) are not priced by poe.watch or poe.ninja and are not shown${
                            r.hiddenShare > 0 ? ` — they account for ${Math.round(r.hiddenShare * 100)}% of this boss's pool, so the real EV is higher than shown` : ""}`}>?</em>}
                      </span>
                      <span className="bp-item-meta">
                        {r.boss.group}
                        {safety[r.boss.id] != null && (
                          <em className={`bp-safe ${safety[r.boss.id] >= 0.5 ? "ok" : "risk"}`}
                            title={`Simulated: ${Math.round(safety[r.boss.id] * 100)}% of ${runs}-run stretches finish in profit`}>
                            {Math.round(safety[r.boss.id] * 100)}% safe
                          </em>
                        )}
                        {" · "}{fmtTime(r.runSeconds)}/run · {r.runsPerHour.toFixed(1)}/hr
                      </span>
                      <span className="bp-meter"><i className={r.profitPerHour >= 0 ? "up" : "down"} style={{ width: `${w}%` }} /></span>
                    </span>
                    <span className={`bp-item-val ${r.profitPerHour >= 0 ? "pos" : "neg"}`}>{signed(r.profitPerHour)}</span>
                  </button>
                );
              })}
              {!visible.length && <div className="st-cat-note">Nothing matches those filters.</div>}
            </div>

            {current && (
              <div className="bp-detail">
                <div className="bp-detail-head" style={{ "--tone": GROUP_TONES[current.boss.group] || "#c9a24b" }}>
                  <div>
                    <h3>{current.boss.name}</h3>
                    <div className="bp-detail-sub">
                      {current.boss.group}
                      {current.boss.uber ? " · uber" : ""}
                      {current.boss.rates === "ledger" ? " · ledger drop tables"
                        : current.boss.rates === "wiki" ? " · rates from poewiki"
                        : " · rates are a placeholder"}
                    </div>
                  </div>
                  <button className="st-close" onClick={() => resetBoss(current.boss.id)} disabled={!bossDirty}
                    title={bossDirty
                      ? "Clear this boss's kill time, drop-rate and price edits. Prices are shared, so any other boss dropping the same item goes back to the market price too."
                      : "Nothing overridden on this boss"}>Reset this boss</button>
                </div>

                {current.boss.note && <p className="bp-note">{current.boss.note}</p>}

                <div className="bp-stats">
                  <Stat label="Entry" value={current.entryCost ? money(current.entryCost) : "free"} />
                  <Stat label="EV / kill" value={signed(current.net)} tone={current.net >= 0 ? "pos" : "neg"} />
                  <Stat label="Profit / hour" value={signed(current.profitPerHour)} tone={current.profitPerHour >= 0 ? "pos" : "neg"} big />
                  <Stat label={`Profit in ${runs} runs`}
                    value={chance == null ? "—" : `${Math.round(chance * 100)}%`}
                    tone={chance == null ? null : chance >= 0.5 ? "pos" : "warn"}
                    title={`Simulated over ${runs} consecutive runs: how often the total finishes in the black. EV alone hides the variance.`} />
                </div>

                <div className="bp-timing">
                  <label>Kill time
                    <TimeInput value={current.ttk} title="m:ss" custom={(profile?.bosses || {})[current.boss.id]?.ttk != null}
                      onCommit={(v) => setBossField(current.boss.id, "ttk", v === current.boss.ttk ? null : v)} />
                  </label>
                  <label>Setup / travel
                    <TimeInput value={current.overhead} title="m:ss"
                      custom={(profile?.bosses || {})[current.boss.id]?.overhead != null}
                      onCommit={(v) => setBossField(current.boss.id, "overhead", v === (current.boss.overhead ?? 0) ? null : v)} />
                  </label>
                  {current.groups.some((g) => g.scaled) && (
                    <label title="Area item quantity — multiplies the quantity-scaled additional drops">
                      Quantity <NumInput value={current.quantity} suffix="%" width={54} onCommit={(v) => setBossField(current.boss.id, "quantity", v)} />
                    </label>
                  )}
                  <span className="bp-timing-out">{fmtTime(current.runSeconds)} per run · {current.runsPerHour.toFixed(1)} kph</span>
                </div>

                {current.entryLines.length > 0 && (
                  <div className="bp-entry">
                    <span className="bp-entry-lbl">Entry</span>
                    {current.entryLines.map((l) => (
                      <span key={l.item} className={`bp-entry-item ${!l.found ? "unknown" : ""}`}
                        title={l.label && l.label !== l.item ? `Priced as: ${l.item}` : undefined}>
                        {l.label || l.item}
                        <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden} onSet={setPriceOverride} money={money} />
                        {l.qty !== 1 && (
                          <NumInput value={l.qty} width={40} title="Quantity" onCommit={(v) => setEntryQty(current.boss.id, l.item, v)} />
                        )}
                        {l.fallback && <FallbackFlag age={l.fallbackAge} />}
                        {!l.found && <em className="bp-flag warn" title="Neither poe.watch nor poe.ninja prices this — the entry cost is understated">no price</em>}
                      </span>
                    ))}
                    <span className="bp-entry-total">= {money(current.entryCost)}</span>
                  </div>
                )}

                <div className="bp-groups">
                  {current.groups.map((g) => (
                    <div className="bp-group" key={g.id}>
                      <div className="bp-group-head">
                        <span className="bp-group-title">
                          {g.label}
                          {g.kind === "pool" && <em>({g.rolls === 1 ? "1" : g.rolls} of {g.lines.length})</em>}
                          {g.kind === "independent" && <em>{g.scaled ? "(independent · quantity)" : "(independent)"}</em>}
                        </span>
                        <span className="bp-group-ctl">
                          {g.kind === "pool" && (
                            <NumInput value={g.rolls} step={0.5} width={42} suffix="rolls"
                              title="How many drops this group yields per kill — fractional is fine"
                              onCommit={(v) => setGroupField(current.boss.id, g.id, "rolls", v)} />
                          )}
                          {g.kind === "weighted" && (
                            <NumInput value={round4(g.base * 100)} step={0.5} width={46} suffix="% base"
                              title="Chance this group drops anything at all"
                              onCommit={(v) => setGroupField(current.boss.id, g.id, "base", v / 100)} />
                          )}
                          <span className="bp-group-sub">{money(g.subtotal)}</span>
                        </span>
                      </div>
                      {g.hiddenLines.length > 0 && (
                        <div className="bp-hidden-note">
                          {g.hiddenLines.length} drop{g.hiddenLines.length > 1 ? "s" : ""} not shown — no market price
                          {g.hiddenShare > 0 && ` · ${Math.round(g.hiddenShare * 100)}% of this pool`}
                          <em title="Their share is not redistributed over the drops that are shown: doing that would claim the boss always hands you one of these instead, which would inflate the EV. So this group's value is a floor.">
                            {g.hiddenLines.map((l) => l.label).join(", ")}
                          </em>
                        </div>
                      )}
                      <div className="bp-table">
                        <div className="bp-tr bp-th">
                          <span>Item</span><span>{g.kind === "weighted" ? "Weight" : "Rate"}</span><span>Value</span><span>EV</span>
                        </div>
                        {g.lines.map((l) => (
                          <div key={l.key} className={`bp-tr ${!l.found && l.qty > 0 ? "unknown" : ""}`}>
                            <span className="bp-cell-name" title={l.item !== l.label ? `Priced as: ${l.item}` : undefined}>
                              {l.label}
                              {l.fallback && <FallbackFlag age={l.fallbackAge} />}
                              {l.variant && <em className="bp-flag" title={`Priced on poe.ninja's "${l.variant}" roll variant, not the name-wide figure`}>{l.variant}</em>}
                              {l.variantMissed && <em className="bp-flag warn" title="This line names a roll variant, but nothing on poe.ninja matched it — showing the name-wide price, which may be well off">variant?</em>}
                              {l.unidQuote && <em className="bp-flag" title="Priced on the unidentified market — the item as this boss hands it over, not an identified copy.">Unid</em>}
                              {l.note && (
                                <em className="bp-flag bp-flag-note" title={l.note} aria-label={l.note}>&#9432;</em>
                              )}
                              {l.unrated && (
                                <em className="bp-flag warn" title={l.unratedNote || "This drop is real but no rate is published for it, so it contributes nothing until you put a figure in."}>
                                  unrated
                                </em>
                              )}
                              {sourceNote(l.priceEntry) && (
                                <em className="bp-flag" title={sourceNote(l.priceEntry)}>poe.watch</em>
                              )}
                              {!l.found && l.qty > 0 && <em className="bp-flag warn" title="Not priced by either source — set one manually">no price</em>}
                            </span>
                            <span className="bp-cell-rate">
                              <NumInput
                                value={g.kind === "weighted" ? l.rate : round4(l.rate * 100)}
                                step={g.kind === "weighted" ? 1 : 0.5} width={g.kind === "weighted" ? 40 : 46}
                                suffix={g.kind === "weighted" ? undefined : "%"}
                                onCommit={(v) => setDropRate(current.boss.id, l.key, g.kind, g.kind === "weighted" ? v : v / 100)} />
                              {g.kind === "weighted" && <em>{pctText(l.pct)}</em>}
                            </span>
                            <span className="bp-cell-price">
                              <PriceCell item={l.item} chaos={l.unit} overridden={l.overridden} entry={l.priceEntry}
                                onSet={setPriceOverride} money={money} />
                            </span>
                            <span className="bp-cell-val">{money(l.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="bp-foot">
                  Expected value is an average over many kills, not what one kill pays. Every rate, time and
                  price here is editable and saved to this browser under the selected profile.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* A declared price, and how long since anyone checked it. */
function FallbackFlag({ age }) {
  const stale = age != null && age >= 30;
  return (
    <em className={`bp-flag ${stale ? "warn" : ""}`}
      title={`Neither price source lists this, so the value is declared in bossData.js${
        age != null ? ` — last checked ${age} day${age === 1 ? "" : "s"} ago` : ""}${
        stale ? ". Worth re-checking." : ""}`}>
      set{stale ? ` ${age}d` : ""}
    </em>
  );
}

function Stat({ label, value, tone, big, title }) {
  return (
    <div className={`bp-stat ${big ? "big" : ""}`} title={title}>
      <div className="bp-stat-lbl">{label}</div>
      <div className={`bp-stat-val ${tone || ""}`}>{value}</div>
    </div>
  );
}

function round4(v) { return Math.round(v * 10000) / 10000; }
