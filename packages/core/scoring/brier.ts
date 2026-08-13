/**
 * Brier score and winner accuracy (EVAL-02). Standard proper-scoring-rule
 * formulas — see RESEARCH.md's "Brier score, winner accuracy, calibration
 * binning" code example.
 */

export interface ScoredPrediction {
  /** Predicted probability the red alliance wins, in [0, 1]. */
  pRedWin: number;
  /** Whether the red alliance actually won. */
  redWon: boolean;
}

/** Mean squared error between predicted probability and observed outcome (0 = perfect). */
export function brierScore(predictions: readonly ScoredPrediction[]): number {
  if (predictions.length === 0) return NaN;
  const sq = predictions.map((p) => (p.pRedWin - (p.redWon ? 1 : 0)) ** 2);
  return sq.reduce((a, b) => a + b, 0) / sq.length;
}

/** Fraction of predictions where the >=0.5 side matched the actual winner. */
export function winnerAccuracy(predictions: readonly ScoredPrediction[]): number {
  if (predictions.length === 0) return NaN;
  const correct = predictions.filter((p) => (p.pRedWin >= 0.5) === p.redWon).length;
  return correct / predictions.length;
}
