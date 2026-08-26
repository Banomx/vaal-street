/* PoE 1 cross-source quote selection. Source trust is the starting point;
   evidence retained by the adapters decides whether a particular observation
   deserves to replace the one already selected. */

const SOURCE_TRUST = { ggg: 40, ninja: 30, ninjaStashCurrency: 26, watch: 20, legacy: 10 };

export function poe1QuoteScore(entry, source = "legacy", now = Date.now()) {
  if (!entry || !(Number(entry.c ?? entry.chaosValue) > 0)) return -Infinity;
  let score = SOURCE_TRUST[source] || 0;
  const volume = Number(entry.volume1H ?? entry.volume24H ?? entry.vol ?? entry.daily);
  const listings = Number(entry.lc ?? entry.cnt ?? entry.n);
  if (volume > 0) score += Math.min(24, Math.log10(1 + volume) * 5);
  if (listings > 0) score += Math.min(12, Math.log10(1 + listings) * 4);
  const low = Number(entry.lo);
  const high = Number(entry.hi);
  if (low > 0 && high >= low) {
    const spread = high / low;
    if (spread > 10) score -= 30;
    else if (spread > 3) score -= 15;
  }
  if (entry.thin || entry.lowConfidence) score -= 10;
  let ageHours = Number(entry.staleHours);
  if (!Number.isFinite(ageHours)) {
    const observed = Date.parse(entry.observedAt || entry.marketHour || entry.asOf || "");
    ageHours = Number.isFinite(observed) ? Math.max(0, (now - observed) / 3600e3) : 0;
  }
  if (ageHours > 48) score -= 50;
  else if (ageHours > 24) score -= 25;
  else if (ageHours > 6) score -= 8;
  return score;
}

export function poe1StateCompatible(left, right) {
  for (const key of ["cor", "lk", "gl", "gq"]) {
    if (left?.[key] != null && right?.[key] != null && left[key] !== right[key]) return false;
  }
  return true;
}
