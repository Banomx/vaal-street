import { useEffect, useRef, useState } from "react";
import { initialSpotlights, promoteSpotlight, reconcileSpotlights } from "./spotlightRotation.js";
import "./spotlight-board.css";

const INTERVAL_SECONDS = 7;
const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Data, ranking rules, formatting and destinations belong to each game.
export default function SpotlightBoard({ categories }) {
  const identity = categories.map((category) => category.id).join("|");
  const [layout, setLayout] = useState(() => initialSpotlights(categories.map((category) => category.id)));
  const [running, setRunning] = useState(() => !prefersReducedMotion());
  const [remaining, setRemaining] = useState(INTERVAL_SECONDS);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const board = useRef(null);
  const current = reconcileSpotlights(layout, categories.map((category) => category.id));
  const locked = current.shown.length > 0 && current.shown.every((id) => current.pinned.includes(id));
  const canRotate = current.queue.length > 0 && !locked;

  useEffect(() => {
    setLayout((state) => reconcileSpotlights(state, identity.split("|").filter(Boolean)));
    setRemaining(INTERVAL_SECONDS);
  }, [identity]);

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (board.current) observer.observe(board.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running || hovered || focused || !visible || !canRotate) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [running, hovered, focused, visible, canRotate]);

  useEffect(() => {
    if (remaining !== 0 || !running || hovered || focused || !visible || !canRotate) return;
    setLayout((state) => promoteSpotlight(state));
    setRemaining(INTERVAL_SECONDS);
  }, [remaining, running, hovered, focused, visible, canRotate]);

  const advance = (id, manual = false) => {
    setLayout((state) => promoteSpotlight(reconcileSpotlights(state, categories.map((category) => category.id)), id));
    setRemaining(INTERVAL_SECONDS);
    if (manual) setRunning(false);
  };
  const togglePin = (id) => {
    setLayout((state) => ({ ...state, pinned: state.pinned.includes(id)
      ? state.pinned.filter((item) => item !== id) : [...state.pinned, id] }));
    setRemaining(INTERVAL_SECONDS);
  };
  const inspect = (category, row) => {
    setLayout((state) => ({ ...state, selected: { ...state.selected, [category.id]: row.id } }));
    setRunning(false);
  };
  const byId = new Map(categories.map((category) => [category.id, category]));
  const timerLabel = !canRotate ? locked ? "All panels pinned" : "All categories shown"
    : !running ? "Rotation paused" : hovered || focused ? "Paused while reading" : `Next in ${remaining}s`;

  return <section className="spotlight-board" ref={board} aria-label="Rotating category highlights">
    <div className="spotlight-toolbar">
      <h3>In the spotlight</h3>
      <div><span className="spotlight-timer">{timerLabel}</span>
        <button type="button" aria-pressed={running} onClick={() => { setRunning((value) => !value); setRemaining(INTERVAL_SECONDS); }}>{running ? "Pause" : "Auto rotate"}</button>
        <button type="button" disabled={!canRotate} onClick={() => advance()}>Next highlight →</button>
      </div>
    </div>
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className="spotlight-featured">
        {current.shown.map((id) => {
          const category = byId.get(id);
          const rows = category.rows.slice(0, 3);
          const selected = rows.find((row) => row.id === current.selected[id]) || rows[0];
          const pinned = current.pinned.includes(id);
          return <article className={`spotlight-card${pinned ? " spotlight-card--pinned" : ""}`} key={id} aria-label={`${category.title} top three`}>
            <header><span>{category.title}</span><button type="button" aria-pressed={pinned} aria-label={`${pinned ? "Unpin" : "Pin"} ${category.title}`} onClick={() => togglePin(id)}>{pinned ? "Pinned" : "Pin"}</button></header>
            <h4>{selected?.title || category.emptyTitle || "No ranked entries yet"}</h4>
            <strong className={`spotlight-value ${selected?.tone || ""}`}>{selected?.value ?? "—"}</strong>
            <div className="spotlight-unit">{selected?.unit || category.unit}</div>
            <div className="spotlight-evidence">{selected?.evidence || category.emptyNote || "Waiting for usable snapshot data."}</div>
            <p className="spotlight-ranking-label">{category.ranking}</p>
            <ol className="spotlight-ranking" aria-label={category.ranking}>
              {rows.map((row, index) => <li key={row.id}><button type="button" aria-pressed={row.id === selected?.id} onClick={() => inspect(category, row)}>
                <span className="spotlight-rank">{category.references ? "·" : index + 1}</span>
                <span>{row.title}{row.warning && <small>{row.warning}</small>}</span><strong>{row.value}</strong>
              </button></li>)}
              {!rows.length && <li className="spotlight-empty">{category.emptyNote || "No eligible entries in this snapshot."}</li>}
            </ol>
            <button type="button" className="spotlight-open" onClick={() => { setRunning(false); (selected?.open || category.open)?.(); }}>{category.action || "Open full tool"} <span aria-hidden="true">→</span></button>
          </article>;
        })}
      </div>
      {current.queue.length > 0 && <>
        <div className="spotlight-queue-heading"><h4>Next in rotation</h4><span>Click a category to bring it up</span></div>
        <div className="spotlight-queue">
          {current.queue.map((id, position) => {
            const category = byId.get(id);
            return <button type="button" key={id} disabled={locked} onClick={() => advance(id, true)} aria-label={`Bring ${category.title} and its top three forward`}>
              <span className="spotlight-category">{category.title}</span>
              <span className="spotlight-mini-list">{category.rows.slice(0, 3).map((row, index) => <span key={row.id}>
                <span>{category.references ? "" : `${index + 1}. `}{row.title}{row.warning && <small>{row.warning}</small>}</span><strong>{row.value}</strong>
              </span>)}{!category.rows.length && <span>{category.emptyTitle || "No ranked entries yet"}</span>}</span>
              <span className="spotlight-queue-footer">{category.rows.length ? `${Math.min(3, category.rows.length)} ${category.references ? "references" : "ranked"}` : "Waiting for data"}<span>{position === 0 ? "Up next" : `Then ${position + 1}`} ↑</span></span>
            </button>;
          })}
        </div>
      </>}
    </div>
    <p className="spotlight-help">One category changes at a time. Pin a panel to keep it here. Selecting a ranked item pauses rotation for inspection.</p>
  </section>;
}
