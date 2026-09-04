/**
 * Pure calibration bin-validity model behind the Compare page's Calibration
 * section (originally 08-10-PLAN.md Task 2). `validCalibrationPoints` is the
 * one thing this module does: turn a slice's raw `calibrationBins` into the
 * subset that carries a usable measurement. `calibrationCards.ts` is its
 * only real consumer (`validCalibrationPoints`, `CalibrationPoint`,
 * `CompareSlice`) — the per-algorithm plain-language card model the compare
 * page actually renders; `compare.test.tsx` also imports `CompareSlice` for
 * its own fixture typing.
 *
 * WR-07 (260902-post-phase08-ungoverned-ui/REVIEW.md): this file used to
 * also carry headline-point selection, a sentence-string formatter, shared
 * count statistics, a point-radius function, and a merged-chart-row builder
 * — all of it built for a three-series reliability-diagram chart component
 * that was deleted in commit `f8518805` when the user's 2026-09-01
 * checkpoint replaced it with the plain-language card variant
 * `calibrationCards.ts` now implements. None of those exports had
 * any consumer left (verified by grepping `apps/`, `packages/` and
 * `scripts/` for every one of their names — the only hits were inside this
 * module and its own test file). They, and the `PublishedAlgorithmId`/
 * `PUBLISHED_ALGORITHM_IDS` imports they alone needed, are deleted rather
 * than left as unreachable exports documenting a chart the code no longer
 * has.
 *
 * A zero-count bin's `meanPredicted`/`observedFrequency` are genuinely NULL
 * in the published data — six of the 450 published bins are in this state,
 * all EPA elimination bins in 2022, 2023 and 2024. `validCalibrationPoints`
 * drops such a bin from its output rather than plotting it at a coerced
 * value: substituting a number for an absent measurement would assert a
 * fact the published data does not carry.
 */
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/** One `CompareSliceSchema`'s `calibrationBins[number]` element — the raw published shape this module reads and never re-exports. */
export type CompareCalibrationBin = CompareArtifact["slices"][number]["calibrationBins"][number];

/** One `CompareArtifact`'s `slices[number]` element — a single algorithm/season/compLevel slice. */
export type CompareSlice = CompareArtifact["slices"][number];

/**
 * One bin that survived validation: `count > 0` and both `meanPredicted` and
 * `observedFrequency` are non-null. `gap` is SIGNED (`meanPredicted -
 * observedFrequency`) so a caller can tell overconfidence (positive) from
 * over-caution (negative) without re-deriving the difference.
 */
export interface CalibrationPoint {
  readonly binStart: number;
  readonly binEnd: number;
  readonly meanPredicted: number;
  readonly observedFrequency: number;
  readonly count: number;
  readonly gap: number;
}

/**
 * Keeps a bin only when it carries at least one match AND both figures are
 * present. A bin with matches is NEVER hidden for being sparse — the
 * shrunken-radius encoding downstream is what keeps that honest, not a
 * filter here. A bin with zero matches is dropped rather than coerced: its
 * `meanPredicted`/`observedFrequency` genuinely have nothing to report.
 */
export function validCalibrationPoints(slice: Pick<CompareSlice, "calibrationBins">): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const bin of slice.calibrationBins) {
    if (bin.count <= 0 || bin.meanPredicted === null || bin.observedFrequency === null) continue;
    points.push({
      binStart: bin.binStart,
      binEnd: bin.binEnd,
      meanPredicted: bin.meanPredicted,
      observedFrequency: bin.observedFrequency,
      count: bin.count,
      gap: bin.meanPredicted - bin.observedFrequency,
    });
  }
  return points;
}

/** Rendered when no algorithm/year/compLevel selection yields a usable point — no chart mounts alongside this sentence. */
export const NO_USABLE_BINS_SENTENCE = "Not enough matches to show a calibration result for this selection.";
