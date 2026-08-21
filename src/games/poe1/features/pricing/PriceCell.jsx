/* The editable price cell, shared by the Boss and Delve drop tables.

   Both tables answer the same question — what is this drop worth — off the
   same resolver and the same `priceOverrides` map, so they get the same cell
   rather than each rendering its own idea of a price. It lived in
   BossProfit.jsx until Delve's boss table needed it too.

   The `bp-` class names come with it deliberately: the point is that the two
   tables look identical, not that each tab styles a price its own way. */

import { useState, useEffect, useRef } from "react";

export function NumInput({ value, onCommit, step = 1, min = 0, width = 66, suffix, title }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value ?? "")); }, [value]);
  return (
    <span className="bp-num" title={title}>
      <input
        type="number" step={step} min={min} value={draft} style={{ width }}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          const n = Number(e.target.value);
          if (e.target.value === "" || !isFinite(n)) { setDraft(String(value ?? "")); return; }
          onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

/* Click a price to override it; the ↺ puts the market price back. */
export default function PriceCell({ item, chaos, overridden, entry, onSet, money }) {
  const [editing, setEditing] = useState(false);
  /* How much to trust the number. poe.ninja gives none of this; poe.watch says
     whether a price came from real exchange trades or from listed asks, and
     how much moved. An exchange price with volume behind it is worth far more
     than a listing mean over three optimistic asks. */
  const spread = entry && (entry.exchange || entry.daily > 0 || entry.n > 1)
    ? [
        entry.exchange
          ? entry.exchangeSource === "GGG"
            ? `GGG exchange · ${Math.round(entry.volume1H || 0).toLocaleString()} traded ${entry.staleHours ? `${entry.staleHours}h before the latest snapshot` : "in the completed hour"}`
            : `exchange · ${Math.round(entry.volume24H || 0).toLocaleString()} traded in 24h`
          : entry.daily > 0 ? `${entry.daily.toLocaleString()} listings/day` : `${entry.n} listings`,
        entry.hi > entry.lo
          ? entry.exchangeSource === "GGG"
            ? `${Math.round(entry.lo)}–${Math.round(entry.hi)}c hourly ratio range`
            : `${Math.round(entry.lo)}–${Math.round(entry.hi)}c listed`
          : null,
        entry.thin ? "thin market — treat with care" : null,
        entry.staleHours ? "thin market — using its most recent completed trade hour" : null,
      ].filter(Boolean).join(" · ")
    : null;
  if (editing) {
    return <NumInput value={Math.round(chaos * 100) / 100} step={0.1} width={78} suffix="c"
      onCommit={(v) => { onSet(item, v); setEditing(false); }} />;
  }
  return (
    <span className="bp-price">
      <button className={`bp-price-btn ${overridden ? "ov" : ""}`} title={spread || "Click to override this price"}
        onClick={() => setEditing(true)}>
        {chaos > 0 ? money(chaos) : "—"}
      </button>
      {overridden && <button className="bp-price-reset" title="Use the market price again" onClick={() => onSet(item, null)}>↺</button>}
    </span>
  );
}
