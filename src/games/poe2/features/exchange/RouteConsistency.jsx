import { useMemo } from "react";
import { buildRouteConsistency, EXALTED_ID } from "./exchangeDesk.js";
import { formatPriceTimestamp } from "../pricing/priceTimeline.js";
import "./market-signals.css";

export default function RouteConsistency({ history, itemId, route, side, minItemVolume, minTurnoverExalted }) {
  const result = useMemo(() => buildRouteConsistency(history, itemId, route?.quoteId, { side, minItemVolume, minTurnoverExalted }), [history, itemId, route?.quoteId, side, minItemVolume, minTurnoverExalted]);
  if (route?.quoteId === EXALTED_ID) return <section className="p2-consistency" aria-label="Route consistency"><h3>Route consistency · Direct Exalted</h3><p>This is the comparison baseline. Select an alternate route in the table to see how often it beat direct Exalted over the last 24 hours.</p></section>;
  return <section className="p2-consistency" aria-label="Route consistency">
    <header><h3>Route consistency{route ? " · " + route.quoteName : ""}</h3><span>Last 24 hours of history · {side === "buy" ? "Buying" : "Selling"}</span></header>
    <div className="p2-consistency-stats">
      <div><span>Beat direct Exalted</span><strong>{result.score == null ? "Building evidence" : Math.round(result.score * 100) + "%"}</strong><small>{result.wins} of {result.samples} comparable hours</small></div>
      <div><span>Typical observed edge</span><strong>{result.medianEdge == null ? "—" : (result.medianEdge >= 0 ? "+" : "") + (result.medianEdge * 100).toFixed(1) + "%"}</strong><small>Median across comparable hours</small></div>
      <div><span>Current winning streak</span><strong>{result.streak}h</strong><small>Missing hours break the streak</small></div>
    </div>
    {result.reason && <p>{result.reason}</p>}
    <p>Counts hours with at least a 1% advantage over direct Exalted. Both routes must meet the selected depth floors. {result.wideRanges > 0 ? result.wideRanges + " comparable hours had ranges wider than 50%; a persistent edge can still be unreliable. " : ""}Historical averages do not guarantee an executable trade.</p>
    <small>Window ends {formatPriceTimestamp(result.latestAt)}{result.latestAt != null && Date.now() - result.latestAt > 3 * 3600e3 ? " · Stale history" : ""}</small>
  </section>;
}
