/**
 * Brier score and winner accuracy, with the boundary contracts made explicit
 * rather than inherited from whatever a comparison operator happens to do:
 *
 *   - A predicted probability of exactly 0.5 expresses no preference against
 *     a match that HAD a winner. It enters the winner-accuracy denominator
 *     and is always counted incorrect: a model that declines to call a
 *     decided match has failed to predict it. It is still counted as an
 *     explicit "no-call" so the abstention rate stays visible separately
 *     from the miss rate.
 *   - An actual tie has no winner to have predicted. It is excluded from
 *     winner accuracy, but IS scored in Brier against an outcome of 0.5 —
 *     the honest target for a result halfway between the two labels — and
 *     counted as an explicit "tie".
 *   - An empty set returns `null` metrics, never `0` (a real, terrible
 *     score) and never `NaN` (which does not survive `JSON.stringify`).
 *
 * A no-call is counted as a miss, not excluded from the denominator: it is
 * the USER's decision that abstention is failure, and excluding it would
 * score any event-scoped algorithm (whose predicted margin is exactly 0 at
 * the start of every event, before that event has a rank) on a strictly
 * EASIER population than an algorithm that always states a preference —
 * every match it found hardest silently deleted from its own denominator,
 * invalidating any cross-algorithm accuracy comparison.
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
   * A `pRedWin === 0.5` no-call is IN this denominator and never in the numerator.
   * `null` iff the denominator is 0, which happens only for a set of ties (or an
   * empty set).
   */
  winnerAccuracy: number | null;
  /** Total predictions scored — the Brier population, including ties and no-calls. */
  count: number;
  /** Predictions whose actual result was a tie. Excluded from winner accuracy. */
  tieCount: number;
  /**
   * Predictions with `pRedWin === 0.5` — no preference expressed. Reported so the
   * abstention rate stays visible, but NOT excluded from winner accuracy: against a
   * decided match a no-call is counted as a miss.
   */
  noCallCount: number;
}

/** The Brier-score target for an outcome: 1 for a red win, 0 for a blue win, 0.5 for a tie. */
export function outcomeTarget(actualWinner: MatchOutcome): number {
  if (actualWinner === "red") return 1;
  if (actualWinner === "blue") return 0;
  return 0.5;
}

/**
 * The winner-accuracy correctness rule for ONE prediction, extracted so
 * every caller shares the EXACT SAME rule and cannot drift apart.
 *
 *   - Returns `null` for a prediction excluded from the accuracy denominator
 *     ENTIRELY: an actual tie has no winner to have predicted.
 *   - Returns `true` for a correct STRICT call.
 *   - Returns `false` otherwise, including a `pRedWin === 0.5` no-call: an
 *     abstention against a decided match is counted as a miss, never
 *     silently credited to whichever side an operator rounds toward.
 */
export function accuracyCall(prediction: ScoredPrediction): boolean | null {
  if (prediction.actualWinner === "tie") return null;
  // Only a STRICT preference can be credited, so a 0.5 no-call falls through
  // both branches and returns `false` — see this function's own doc comment.
  const favoredWinner: "red" | "blue" | null =
    prediction.pRedWin > 0.5 ? "red" : prediction.pRedWin < 0.5 ? "blue" : null;
  return favoredWinner !== null && favoredWinner === prediction.actualWinner;
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

    // Every non-tie prediction is in the denominator, including a no-call.
    // `accuracyCall` returns `null` for exactly the excluded (tied) case.
    const call = accuracyCall(prediction);
    if (call !== null) {
      accuracyDenominator += 1;
      if (call) accuracyCorrect += 1;
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
