/**
 * Brier score and winner accuracy (EVAL-02), with the boundary contracts
 * D-09/D-10/D-11 and this plan's must_haves require made explicit rather
 * than inherited from whatever a comparison operator happens to do:
 *
 *   - A predicted probability of exactly 0.5 expresses no preference against
 *     a match that HAD a winner. It enters the winner-accuracy denominator
 *     and is always counted incorrect (D-Q3): a model that declines to call
 *     a decided match has failed to predict it. It is still counted as an
 *     explicit "no-call" so the abstention rate stays visible separately
 *     from the miss rate.
 *   - An actual tie has no winner to have predicted. It is excluded from
 *     winner accuracy, but IS scored in Brier against an outcome of 0.5 —
 *     the honest target for a result halfway between the two labels — and
 *     counted as an explicit "tie".
 *   - An empty set returns `null` metrics, never `0` (a real, terrible
 *     score) and never `NaN` (which does not survive `JSON.stringify`).
 *
 * Why the no-call rule changed (D-Q3, quick task 260901-is2). The retired
 * contract excluded a 0.5 prediction from the denominator on the grounds
 * that "counting it either way would inject an arbitrary bias into the
 * headline metric". That reasoning was backwards in practice, for two
 * reasons:
 *
 *   1. It is the USER's decision that abstention is failure. A predictor
 *      that answers "I don't know" has not predicted the match, and the
 *      headline accuracy is a claim about how often the model is right
 *      about matches — not about how often it is right when it deigns to
 *      answer.
 *   2. It was a live comparison defect, not a neutral convention. OPR
 *      declines roughly 7% of every season (1,012–1,305 matches; its
 *      event-scoped, quals-only design matrix has no rank at the start of
 *      each event, so the predicted margin is exactly 0 and `0/scale === 0`
 *      for any scale). VPR and EPA abstain on ≈0 matches after 2022. The
 *      old denominator therefore scored OPR on a strictly EASIER
 *      population — every match it found hardest was silently deleted from
 *      its own denominator — which made every OPR-vs-VPR accuracy
 *      comparison invalid. Counting a no-call as a miss puts all three
 *      algorithms on the same population.
 *
 * Brier scoring is deliberately UNCHANGED by that decision: a 0.5
 * prediction against a decided match already scores 0.25, which is the
 * honest squared error for an abstention and needs no special case.
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
  /**
   * Fraction of non-tie predictions whose favored side matched the actual winner.
   * A `pRedWin === 0.5` no-call is IN this denominator and never in the numerator
   * (D-Q3). `null` iff the denominator is 0, which now happens only for a set of
   * ties (or an empty set).
   */
  winnerAccuracy: number | null;
  /** Total predictions scored — the Brier population, including ties and no-calls. */
  count: number;
  /** Predictions whose actual result was a tie. Excluded from winner accuracy. */
  tieCount: number;
  /**
   * Predictions with `pRedWin === 0.5` — no preference expressed. Reported so the
   * abstention rate stays visible, but NOT excluded from winner accuracy: against a
   * decided match a no-call is counted as a miss (D-Q3).
   */
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

    // D-Q3: every non-tie prediction is in the denominator, including a no-call.
    if (!isTie) {
      accuracyDenominator += 1;
      // Only a STRICT preference can be credited, so a 0.5 no-call falls through
      // both branches and is counted incorrect. Writing it this way — rather than
      // as a `> 0.5 ? "red" : "blue"` collapse — keeps the abstention from being
      // silently credited to whichever side the operator happens to round toward.
      const favoredWinner: "red" | "blue" | null =
        prediction.pRedWin > 0.5 ? "red" : prediction.pRedWin < 0.5 ? "blue" : null;
      if (favoredWinner !== null && favoredWinner === prediction.actualWinner) {
        accuracyCorrect += 1;
      }
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
