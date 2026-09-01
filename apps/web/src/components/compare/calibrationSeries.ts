/**
 * Pure calibration model behind the Compare page's Calibration section
 * (08-10-PLAN.md Task 2) — bin validity, headline selection, the sentence
 * string, the shared count statistics and the one radius function all live
 * here, mirroring `metricHistorySeries.ts`'s split: no UI-framework import,
 * testable without a renderer. `CalibrationChart.tsx` and
 * `CalibrationSection.tsx` (Tasks 3 and 4) are the only consumers; neither
 * computes any calibration arithmetic of its own.
 *
 * A zero-count bin's `meanPredicted`/`observedFrequency` are genuinely NULL
 * in the published data — six of the 450 published bins are in this state,
 * all EPA elimination bins in 2022, 2023 and 2024. Every function below
 * drops such a bin from its output rather than plotting it at a coerced
 * value: substituting a number for an absent measurement would assert a
 * fact the published data does not carry.
 *
 * `PUBLISHED_ALGORITHM_IDS` is the series order used everywhere below —
 * never a fetched artifact's own `algorithms` array order, which would let
 * a republish silently reorder the page.
 */
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
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

/** One published algorithm id mapped to its own valid points for one selected year/compLevel — the shape every consumer that needs "all three series at once" takes. */
export type AlgorithmPoints = Readonly<Record<PublishedAlgorithmId, readonly CalibrationPoint[]>>;

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

/**
 * The point with the largest `|gap|`. Ties broken first by the HIGHER
 * `count` (so a one-match fluke never wins the headline over a well-
 * populated bin), then by the LOWER `binStart` for full determinism. Neither
 * tie rule is exercised by any of the five published artifacts — verified
 * this session, every slice's valid bins carry distinct absolute gaps — so
 * both are determinism contracts proven only on constructed points in
 * `calibrationSeries.test.ts`, not evidence the case has been observed.
 */
export function selectHeadlinePoint(points: readonly CalibrationPoint[]): CalibrationPoint | undefined {
  if (points.length === 0) return undefined;
  return points.reduce((best, point) => {
    const bestAbsGap = Math.abs(best.gap);
    const pointAbsGap = Math.abs(point.gap);
    if (pointAbsGap !== bestAbsGap) return pointAbsGap > bestAbsGap ? point : best;
    if (point.count !== best.count) return point.count > best.count ? point : best;
    return point.binStart < best.binStart ? point : best;
  });
}

/** Rendered when no algorithm/year/compLevel selection yields a usable point — no chart mounts alongside this sentence (Task 4). */
export const NO_USABLE_BINS_SENTENCE = "Not enough matches to show a calibration result for this selection.";

/**
 * The Copywriting Contract's calibration-sentence template, filled from one
 * point's own fields: percentages at one decimal place, the count with
 * thousands separators. This is the ONLY place that template is rendered —
 * `CalibrationSection.tsx` never re-templates it inline.
 */
export function formatCalibrationSentence(algorithmLabel: string, point: CalibrationPoint): string {
  const predictedPct = (point.meanPredicted * 100).toFixed(1);
  const observedPct = (point.observedFrequency * 100).toFixed(1);
  const countText = point.count.toLocaleString("en-US");
  return `${algorithmLabel} predicted ${predictedPct}%, and it was right ${observedPct}% of the time across ${countText} matches.`;
}

export interface CountStats {
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

/**
 * `{ min, median, max }` over EVERY point's `count` across all three
 * algorithms currently rendered — the single source both the dot radii and
 * the size-key swatches read (`chart-craft.md`'s "derive coupled geometry"
 * rule), so the marks and the key can never drift apart. `undefined` with no
 * points at all, so no caller can divide by zero.
 */
export function countStats(pointsByAlgorithm: AlgorithmPoints): CountStats | undefined {
  const counts: number[] = [];
  for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
    for (const point of pointsByAlgorithm[algorithmId]) counts.push(point.count);
  }
  if (counts.length === 0) return undefined;
  counts.sort((a, b) => a - b);
  return {
    min: counts[0]!,
    max: counts[counts.length - 1]!,
    median: counts[Math.floor(counts.length / 2)]!,
  };
}

/** A one-match bin's shrunken (but never zero) marker radius. */
export const MIN_POINT_R = 3.5;
/** The radius a bin at `maxCount` renders at. */
export const MAX_POINT_R = 16;

/**
 * `sizeScale`, ported from sketch 006's own reference implementation
 * verbatim in shape: the square root keeps a mark's AREA — not its radius —
 * tracking `count` linearly, the perceptually correct encoding for a
 * quantity carried by size. Non-decreasing in `count`, equals `MAX_POINT_R`
 * exactly at `count === maxCount`, and never below `MIN_POINT_R` (never
 * zero, never hidden) for any `count` of 1 or more.
 */
export function calibrationPointRadius(count: number, maxCount: number): number {
  const t = Math.sqrt(count) / Math.sqrt(maxCount);
  return MIN_POINT_R + t * (MAX_POINT_R - MIN_POINT_R);
}

export interface CalibrationChartCell {
  readonly y: number;
  readonly count: number;
  readonly radius: number;
  /**
   * The ORIGINAL point this cell was derived from (08-REVIEW WR-02): the
   * dot renderer reads the point off its own cell rather than through a
   * float-keyed lookup (`meanPredicted * 100`), which could theoretically
   * collide across two different bins and misattribute a hover/click.
   */
  readonly point: CalibrationPoint;
}

/**
 * One merged, x-ascending chart row: `x` in percentage points (0-100), and
 * exactly one of the three algorithm keys carrying a non-null cell — the
 * other two are `null`. Consumed by `CalibrationChart.tsx`'s single
 * top-level `data` array with `connectNulls` on each `<Line>` (Decision 5).
 */
export type CalibrationChartRow = { readonly x: number } & Readonly<Record<PublishedAlgorithmId, CalibrationChartCell | null>>;

/**
 * Merges all three algorithms' valid points into one x-ascending array.
 *
 * `x` is `meanPredicted * 100`, NEVER the nominal bin midpoint
 * `(binStart + binEnd) / 2` — the calibration SENTENCE above the chart
 * prints `meanPredicted`, so plotting a mark anywhere else would put the
 * sentence and the mark it describes at different places on the same axis,
 * exactly the split-source coupling `chart-craft.md` forbids.
 *
 * Every cell's radius reads the SAME `countStats(pointsByAlgorithm).max`
 * that the caller's size key also reads, so the marks and the key can never
 * disagree about what a given size means.
 */
export function buildCalibrationRows(pointsByAlgorithm: AlgorithmPoints): CalibrationChartRow[] {
  const stats = countStats(pointsByAlgorithm);
  const maxCount = stats?.max ?? 0;

  const entries: { x: number; algorithmId: PublishedAlgorithmId; cell: CalibrationChartCell }[] = [];
  for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
    for (const point of pointsByAlgorithm[algorithmId]) {
      entries.push({
        x: point.meanPredicted * 100,
        algorithmId,
        cell: {
          y: point.observedFrequency * 100,
          count: point.count,
          radius: calibrationPointRadius(point.count, maxCount),
          point,
        },
      });
    }
  }
  entries.sort((a, b) => a.x - b.x);

  return entries.map((entry) => {
    const cells: Record<PublishedAlgorithmId, CalibrationChartCell | null> = { opr: null, epa: null, vpr: null };
    cells[entry.algorithmId] = entry.cell;
    return { x: entry.x, ...cells };
  });
}
