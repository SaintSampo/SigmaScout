/**
 * Brier score and winner accuracy (EVAL-02), with the boundary contracts
 * D-09/D-10/D-11 and this plan's must_haves require made explicit rather
 * than inherited from whatever a comparison operator happens to do:
 *
 *   - A predicted probability of exactly 0.5 expresses no preference. It is
 *     excluded from the winner-accuracy denominator (counting it either way
 *     would inject an arbitrary bias into the headline metric) and counted
 *     as an explicit "no-call".
 *   - An actual tie has no winner to have predicted. It is excluded from
 *     winner accuracy for the same reason, but IS scored in Brier against
 *     an outcome of 0.5 — the honest target for a result halfway between
 *     the two labels — and counted as an explicit "tie".
 *   - An empty set returns `null` metrics, never `0` (a real, terrible
 *     score) and never `NaN` (which does not survive `JSON.stringify`).
 */

export type MatchOutcome = "red" | "blue" | "tie";

export interface ScoredPrediction {
  /** Predicted probability the red alliance wins, in the closed interval [0, 1]. */
  pRedWin: number;
  actualWinner: MatchOutcome;
}

export interface ScoreSetResult {
  /** Mean squared error against the outcome target (0 = perfect). `null` iff `count === 0`. */
  brierScore: number | null;
  /** Fraction of non-tie, non-no-call predictions whose favored side matched the actual winner. `null` iff the denominator is 0. */
  winnerAccuracy: number | null;
  /** Total predictions scored — the Brier population, including ties and no-calls. */
  count: number;
  /** Predictions whose actual result was a tie. */
  tieCount: number;
  /** Predictions with `pRedWin === 0.5` — no preference expressed. */
  noCallCount: number;
}

/** The Brier-score target for an outcome: 1 for a red win, 0 for a blue win, 0.5 for a tie. */
export function outcomeTarget(actualWinner: MatchOutcome): number {
  if (actualWinner === "red") return 1;
  if (actualWinner === "blue") return 0;
  return 0.5;
}

const EMPTY_RESULT: ScoreSetResult = {
  brierScore: null,
  winnerAccuracy: null,
  count: 0,
  tieCount: 0,
  noCallCount: 0,
};

/** Scores a set of predictions, returning Brier score, winner accuracy, and the counts that qualify them. */
export function scoreSet(predictions: readonly ScoredPrediction[]): ScoreSetResult {
  const count = predictions.length;
  if (count === 0) return EMPTY_RESULT;

  let squaredErrorSum = 0;
  let tieCount = 0;
  let noCallCount = 0;
  let accuracyCorrect = 0;
  let accuracyDenominator = 0;

  for (const prediction of predictions) {
    const target = outcomeTarget(prediction.actualWinner);
    squaredErrorSum += (prediction.pRedWin - target) ** 2;

    const isTie = prediction.actualWinner === "tie";
    const isNoCall = prediction.pRedWin === 0.5;
    if (isTie) tieCount += 1;
    if (isNoCall) noCallCount += 1;

    if (!isTie && !isNoCall) {
      accuracyDenominator += 1;
      const favoredWinner: "red" | "blue" = prediction.pRedWin > 0.5 ? "red" : "blue";
      if (favoredWinner === prediction.actualWinner) accuracyCorrect += 1;
    }
  }

  return {
    brierScore: squaredErrorSum / count,
    winnerAccuracy: accuracyDenominator > 0 ? accuracyCorrect / accuracyDenominator : null,
    count,
    tieCount,
    noCallCount,
  };
}
