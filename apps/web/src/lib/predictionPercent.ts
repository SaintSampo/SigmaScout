/**
 * A probability as the whole-number percentage a prediction displays.
 *
 * No prediction ever renders as certain. The model can emit a probability
 * that rounds to 100% (or 0%), but a match or bonus that has not happened yet
 * is never a sure thing, so the displayed figure is clamped to 1–99%. This is
 * display formatting only: the published probability is untouched, and
 * Brier/calibration scoring keeps using the raw value.
 */
export const MAX_PREDICTION_PERCENT = 99;
export const MIN_PREDICTION_PERCENT = 1;

export function predictionPercent(probability: number): number {
  return Math.min(MAX_PREDICTION_PERCENT, Math.max(MIN_PREDICTION_PERCENT, Math.round(probability * 100)));
}

/**
 * The predicted winner's win probability as a match's displayed confidence.
 *
 * A match row always names a predicted winner, so a confidence of 50% would
 * contradict the pick beside it. A close match that rounds to 50% displays as
 * 51% instead. The one exception is a true coin flip: when the algorithm knows
 * nothing about either alliance the probability is exactly 0.5, and that
 * displays honestly as 50%. Display formatting only, same as the 1–99% clamp
 * above; bonus odds keep using predictionPercent, where 50% is a real toss-up.
 */
export const MIN_MATCH_CONFIDENCE_PERCENT = 51;

export function matchConfidencePercent(confidence: number): number {
  if (confidence === 0.5) return 50;
  return Math.max(MIN_MATCH_CONFIDENCE_PERCENT, predictionPercent(confidence));
}
