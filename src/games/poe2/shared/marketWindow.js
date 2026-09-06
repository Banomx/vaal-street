// Coverage describes observed samples; it does not infer a league's launch time.
export function windowEvidence(points = [], rangeHours = null, latestAt = null) {
  const times = points.map((point) => Number(point.at)).filter(Number.isFinite).sort((a, b) => a - b);
  const hours = times.length > 1 ? (times.at(-1) - times[0]) / 3600e3 : 0;
  const stale = times.length > 0 && Number.isFinite(latestAt) && latestAt - times.at(-1) > 2 * 3600e3;
  const partial = !!rangeHours && hours + Math.min(1, rangeHours * .1) < rangeHours;
  const label = times.length < 2 ? `${times.length} sample${times.length === 1 ? "" : "s"} · building history`
    : `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h observed · ${times.length} samples${partial ? " · partial window" : ""}${stale ? " · last trade is older" : ""}`;
  return { hours, samples: times.length, partial, stale, label };
}
