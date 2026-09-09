export function dryStreak(chance, attempts, success = 1) {
  if (![chance, attempts, success].every(Number.isFinite) || chance < 0 || chance > 1 || success < 0 || success > 1 || attempts < 0 || !Number.isInteger(attempts)) return null;
  const p = chance * success;
  const logMiss = p === 1 ? -Infinity : Math.log1p(-p);
  const dry = attempts === 0 ? 1 : Math.exp(attempts * logMiss);
  return { dry, hit: 1 - dry, milestones: [.5, .9, .95].map(confidence => ({ confidence, attempts: p === 0 ? null : p === 1 ? 1 : Math.ceil(Math.log1p(-confidence) / logMiss) })) };
}
