/* Where a price came from, and whether the feeds agree about it.

   Source precedence is GGG's completed trades, then poe.ninja, then poe.watch.
   The first two cover almost every name, so the interesting case on a line is
   the third: poe.ninja does not list this item at all and the number comes from
   the fallback. That is what the UI says.

   It is not a warning. poe.watch is a real feed and its unidentified markets
   are the only ones there are — the badge says the price is sourced differently
   from everything around it, which is worth knowing when a drop looks out of
   line with its neighbours.

   This module never changes a price. It used to: a poe.watch quote that
   disagreed badly with poe.ninja was swapped for poe.ninja's and badged
   `contested`. Both are gone. poe.ninja now wins outright wherever it answers,
   so the swap had nothing left to do and the badge fired on prices that were
   fine. */

/** Feeds this far apart are describing different things, not the same item
    with noise. 1.5 means the dearer quote is at least half again the cheaper
    one, which clears ordinary listing-churn between two feeds without
    swallowing the identified/unidentified gaps this exists to catch. */
export const VOLATILE_RATIO = 1.5;

/** Compare one item's price from two independent feeds.

    Returns null when either feed lacks the item: a gap is not a disagreement,
    and flagging it would tag most of the map. */
export function comparePrices(a, b, { ratio: threshold = VOLATILE_RATIO } = {}) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  const lo = Math.min(left, right);
  const hi = Math.max(left, right);
  const ratio = Math.round((hi / lo) * 100) / 100;
  return { lo, hi, ratio, volatile: ratio >= threshold };
}

/** What to tell the reader about where this price came from, or null when
    there is nothing worth saying.

    Only the fallback is called out. An entry carries `source` only when
    poe.watch supplied it; absence means GGG or poe.ninja, which is the
    unremarkable case and the overwhelming majority of the map. */
export function sourceNote(entry) {
  if (!entry || entry.source !== "poe.watch") return null;
  return "poe.ninja does not list this item, so the price comes from poe.watch. "
    + "Everything around it is poe.ninja's figure or a completed GGG trade.";
}

/** One line per disagreement, for the hourly log. Dearest gap first, because
    that is the one most likely to be moving an EV.

    Log only — none of this reaches the site. poe.ninja wins either way, so a
    disagreement no longer changes a number; it is a maintenance signal that one
    of the feeds has started pricing a different item state, which is the kind
    of thing that otherwise goes unnoticed for weeks.

    `pairs` is `[{ name, watch, ninja }]`, each figure the feed's own floor —
    the same statistic a boss line quotes. Comparing means would flag items over
    a number that never appears on screen. */
export function describeSpreads(pairs, { ratio = VOLATILE_RATIO, limit = 8 } = {}) {
  const flagged = (pairs || [])
    .map((p) => ({ ...p, seen: comparePrices(p.watch, p.ninja, { ratio }) }))
    .filter((p) => p.seen?.volatile)
    .sort((a, b) => b.seen.ratio - a.seen.ratio);
  if (!flagged.length) return [];
  const lines = flagged.slice(0, limit)
    .map((p) => `${p.name}: poe.watch ${p.watch}c vs poe.ninja ${p.ninja}c (${p.seen.ratio}x)`);
  if (flagged.length > limit) lines.push(`…and ${flagged.length - limit} more`);
  return lines;
}
