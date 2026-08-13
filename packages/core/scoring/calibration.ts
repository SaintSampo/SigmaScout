/**
 * Reliability-diagram binning (EVAL-03, D-03). Ten equal-width bins by
 * default — see 01-05-PLAN.md's "Flagged assumptions" note: this fixes the
 * boundary-assignment and empty-bin contracts by test, it does not settle
 * whether ten is the right count for FRC's probability distribution.
 */
import { outcomeTarget, type MatchOutcome } from "./brier.js";

export interface CalibrationPrediction {
  /** Predicted probability the red alliance wins, in the closed interval [0, 1]. */
  pRedWin: number;
  actualWinner: MatchOutcome;
}

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  /** `null` when the bin has no predictions — never a fabricated 0 or a non-serializable sentinel. */
  meanPredicted: number | null;
  observedFrequency: number | null;
  count: number;
}

const DEFAULT_BIN_COUNT = 10;

/**
 * Bins predictions by predicted probability into `binCount` equal-width
 * bins covering [0, 1].
 *
 * Boundary rule: a probability is assigned to bin `floor(pRedWin * binCount)`,
 * clamped to `binCount - 1`. A probability lying exactly on a bin boundary
 * (e.g. 0.3 with binCount=10) therefore lands in the *upper* of the two
 * adjacent bins (floor(0.3*10)=3 -> the [0.3, 0.4) bin), and 1.0 lands in
 * the final bin rather than overflowing to a nonexistent index.
 */
export function calibrationBins(
  predictions: readonly CalibrationPrediction[],
  binCount: number = DEFAULT_BIN_COUNT
): CalibrationBin[] {
  if (!Number.isInteger(binCount) || binCount <= 0) {
    throw new Error(`calibrationBins: binCount must be a positive integer, got ${binCount}`);
  }

  const accumulators = Array.from({ length: binCount }, () => ({
    predictedSum: 0,
    outcomeSum: 0,
    count: 0,
  }));

  for (const prediction of predictions) {
    const idx = Math.min(binCount - 1, Math.floor(prediction.pRedWin * binCount));
    const bin = accumulators[idx]!;
    bin.predictedSum += prediction.pRedWin;
    bin.outcomeSum += outcomeTarget(prediction.actualWinner);
    bin.count += 1;
  }

  return accumulators.map((bin, i) => ({
    binStart: i / binCount,
    binEnd: (i + 1) / binCount,
    meanPredicted: bin.count > 0 ? bin.predictedSum / bin.count : null,
    observedFrequency: bin.count > 0 ? bin.outcomeSum / bin.count : null,
    count: bin.count,
  }));
}
