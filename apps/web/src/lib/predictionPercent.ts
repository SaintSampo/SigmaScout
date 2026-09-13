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
