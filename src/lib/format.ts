/**
 * Format a probability as a percentage, never claiming certainty.
 *
 * Clamped to 1%–99%: a model should not display 0% or 100%, since nothing it
 * predicts is truly impossible or guaranteed (a dead robot, a fluke penalty, or
 * a simulation that merely never sampled an outcome in N runs).
 */
export function formatProbability(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const pct = Math.round(p * 100);
  return `${Math.min(99, Math.max(1, pct))}%`;
}
