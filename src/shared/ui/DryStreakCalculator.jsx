import { useState } from "react";
import { dryStreak } from "./dryStreak.js";

export default function DryStreakCalculator({ targets = [], entryCost, formatMoney, costUnit }) {
  const [target, setTarget] = useState("");
  const [customChance, setCustomChance] = useState("");
  const [attempts, setAttempts] = useState("20");
  const [success, setSuccess] = useState("100");
  const [cost, setCost] = useState("");
  const selected = targets.find(row => row.id === target);
  const chance = selected ? selected.chance : customChance === "" ? NaN : Number(customChance) / 100;
  const result = dryStreak(chance, attempts === "" ? NaN : Number(attempts), success === "" ? NaN : Number(success) / 100);
  const enteredCost = cost === "" ? entryCost : Number(cost);
  const fullCost = Number.isFinite(enteredCost) && enteredCost >= 0 ? enteredCost : null;
  const percent = value => value > 0 && value < .0001 ? "<0.01%" : value < 1 && value > .9999 ? ">99.99%" : (value * 100).toFixed(2) + "%";
  const budget = n => fullCost == null || n == null ? "Unknown" : Number.isFinite(fullCost * n) ? formatMoney(fullCost * n) : "Too large";
  return <section className="dry-streak" aria-label="Dry-streak calculator">
    <header><h3>How long could a dry streak last?</h3><p>Plan for the chance of getting none of your target drop.</p></header>
    <div className="dry-streak-controls">
      <label>Target drop<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Custom chance</option>{targets.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
      <label>Drop chance per successful kill (%)<input type="number" min="0" max="100" step="any" value={selected ? Number((selected.chance * 100).toFixed(6)) : customChance} readOnly={!!selected} placeholder="Enter a chance" onChange={e => setCustomChance(e.target.value)} /></label>
      <label>Attempts<input type="number" min="0" max="1000000" step="1" value={attempts} onChange={e => setAttempts(e.target.value)} /></label>
      <label>Successful attempts (%)<input type="number" min="0" max="100" step="any" value={success} onChange={e => setSuccess(e.target.value)} /></label>
      <label>Full cost / attempt ({costUnit})<input type="number" min="0" step="any" value={cost} placeholder={entryCost == null ? "Unknown — enter a cost" : String(Number(entryCost.toFixed(2)))} onChange={e => setCost(e.target.value)} /></label>
    </div>
    <p>{selected ? "Uses the current boss model, including edited rates. Estimates remain estimates." : "Enter the probability of at least one target drop per successful kill, not its average quantity."} For complex or quantity-scaled pools, use a custom chance.</p>
    {result ? <>
      <div className="dry-streak-stats"><div><span>No target drop</span><strong>{percent(result.dry)}</strong></div><div><span>At least one target</span><strong>{percent(result.hit)}</strong></div><div><span>Entry budget for {attempts} attempts</span><strong>{budget(Number(attempts))}</strong></div></div>
      <div className="dry-streak-milestones">{result.milestones.map(row => <div key={row.confidence}><strong>{row.confidence * 100}% chance of at least one</strong><span>{row.attempts == null ? "Unreachable at this chance" : row.attempts.toLocaleString() + " attempts"}</span><span>{budget(row.attempts)} entry budget</span></div>)}</div>
    </> : <p role="status">Enter a chance from 0–100%, a success rate from 0–100%, and a whole number of attempts.</p>}
    <p>{fullCost == null ? "Entry budget is unknown until you supply a full cost or all entry prices are available. " : "Budget is total entry spending, with no loot proceeds deducted. "}Every attempt is assumed to consume its full entry cost. For encounters without a fixed entry item, enter your own access cost. Independent attempts with unchanged odds are assumed; past misses do not make the next drop more likely. No attempt count guarantees a drop below 100% odds.</p>
  </section>;
}
