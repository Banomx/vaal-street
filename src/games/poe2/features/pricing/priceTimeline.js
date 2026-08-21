function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildPriceTimeline(history, item, { currency = "smart", rangeHours = null } = {}) {
  const timestamps = Array.isArray(history?.timestamps) ? history.timestamps : [];
  const values = Array.isArray(history?.series?.[item]) ? history.series[item] : [];
  const rates = Array.isArray(history?.divineExalted) ? history.divineExalted : [];
  const chaosRates = Array.isArray(history?.series?.["Chaos Orb"]) ? history.series["Chaos Orb"] : [];
  const samples = timestamps.map((timestamp, index) => ({
    timestamp,
    at: Date.parse(timestamp),
    exalted: finite(values[index]),
    rate: finite(rates[index]),
    chaosRate: finite(chaosRates[index]),
  })).filter((point) => Number.isFinite(point.at) && point.exalted != null);
  const latest = samples[samples.length - 1];
  const useDivine = currency === "divine"
    || (currency === "smart" && latest?.rate && latest.exalted >= latest.rate * .5);
  const useChaos = currency === "chaos";
  const cutoff = rangeHours && latest ? latest.at - rangeHours * 60 * 60 * 1000 : -Infinity;
  const points = samples.filter((point) => point.at >= cutoff && (!useDivine || point.rate) && (!useChaos || point.chaosRate))
    .map((point) => ({
      ...point,
      value: useDivine ? point.exalted / point.rate : useChaos ? point.exalted / point.chaosRate : point.exalted,
    }));
  const first = points[0];
  const last = points[points.length - 1];
  const canDivineAdjust = points.length >= 2 && first.rate != null && last.rate != null;
  return {
    points,
    unit: useDivine ? "Divine" : useChaos ? "Chaos" : "Exalted",
    change: points.length >= 2 && first.value > 0 ? last.value / first.value - 1 : null,
    divineAdjustedChange: canDivineAdjust ? (last.exalted / last.rate) / (first.exalted / first.rate) - 1 : null,
    canDivineAdjust,
  };
}
