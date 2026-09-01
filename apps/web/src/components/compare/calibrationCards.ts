/**
 * Sketch 006 variant C's pure card model (2026-09-01 rebuild — the user's
 * checkpoint correction: what shipped from 08-10 was ONE sentence over a
 * demoted three-series reliability diagram, but the variant the user picked
 * is per-algorithm PLAIN-LANGUAGE CARDS — a headline sentence, a
 * bin-by-bin list of readable rows, and a small deviation-bars chart per
 * card. This module is that card's math, ported from the sketch's own
 * reference implementation (`sources/006-calibration-curve/index.html`)
 * rather than re-derived: `validBins`, the nearest-70% headline pick,
 * `SPARSE_N = 30`, `niceCeil(max |deviation|, 0.05)` as the shared
 * mini-chart scale.
 *
 * Reuses `calibrationSeries.ts`'s `validCalibrationPoints` (count > 0, both
 * fields non-null) as the one validity rule — never a second filter.
 */
import { validCalibrationPoints, type CalibrationPoint } from "./calibrationSeries.js";
import type { CompareSlice } from "./calibrationSeries.js";

/** The sketch's own absolute floor below which a bin is tagged "small sample" everywhere it appears. */
export const SPARSE_N = 30;

/** The sketch's headline anchor: the bin whose meanPredicted sits closest to 70% — a confidence readers recognize. */
export const HEADLINE_ANCHOR = 0.7;

export interface CalibrationCardRow {
  /** e.g. "70–80%". */
  readonly rangeLabel: string;
  /** Null for a bin no matches landed in — rendered as the empty-range sentence, never hidden (sparse honesty). */
  readonly point: CalibrationPoint | null;
}

export interface CalibrationCardModel {
  /** The nearest-70% valid bin, or null when the slice has no valid bins at all. */
  readonly headline: CalibrationPoint | null;
  /** One row per published bin, in artifact order, empties included. */
  readonly rows: readonly CalibrationCardRow[];
  /** This card's own max |observed − predicted| across valid bins (0 when none). */
  readonly maxAbsDeviation: number;
}

/** `85.3`-style percent formatting, matching the sketch's `fmtPct(x, d)`. */
export function fmtPct(x: number, decimals = 0): string {
  return (x * 100).toFixed(decimals);
}

/** The sketch's `niceCeil`: the smallest multiple of `step` at or above `v`, floored at one `step`. */
export function niceCeil(v: number, step: number): number {
  return Math.max(step, Math.ceil(v / step) * step);
}

function rangeLabel(binStart: number, binEnd: number): string {
  return `${Math.round(binStart * 100)}–${Math.round(binEnd * 100)}%`;
}

/** Builds one algorithm's card model from its slice. */
export function buildCalibrationCard(slice: Pick<CompareSlice, "calibrationBins">): CalibrationCardModel {
  const valid = validCalibrationPoints(slice);
  const byKey = new Map(valid.map((p) => [`${p.binStart}`, p]));

  const headline =
    valid.length === 0
      ? null
      : [...valid].sort((a, b) => Math.abs(a.meanPredicted - HEADLINE_ANCHOR) - Math.abs(b.meanPredicted - HEADLINE_ANCHOR))[0]!;

  const rows: CalibrationCardRow[] = slice.calibrationBins.map((bin) => ({
    rangeLabel: rangeLabel(bin.binStart, bin.binEnd),
    point: byKey.get(`${bin.binStart}`) ?? null,
  }));

  const maxAbsDeviation = valid.reduce((m, p) => Math.max(m, Math.abs(p.observedFrequency - p.meanPredicted)), 0);

  return { headline, rows, maxAbsDeviation };
}

/** The sketch's headline sentence, verbatim in shape. */
export function cardHeadlineSentence(algorithmLabel: string, headline: CalibrationPoint): string {
  return `When ${algorithmLabel} put red’s win chance at about ${fmtPct(headline.meanPredicted)}%, red actually won ${fmtPct(headline.observedFrequency)}% of the time, across ${headline.count.toLocaleString("en-US")} matches.`;
}
