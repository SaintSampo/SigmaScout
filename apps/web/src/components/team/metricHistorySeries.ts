/**
 * Pure series derivation for the metric-history chart (06-05-PLAN.md Task 1).
 * No React import — testable without a DOM; `MetricHistoryChart.tsx` is the
 * one and only consumer of these exports.
 */
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { SIGMA_METRIC_KEY, usesSigmaScore } from "../../../../../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../../../../../packages/core/algorithms/types.js";

export interface MetricSeriesPoint {
  /** The row's ARRAY POSITION (1-indexed) in the team's own `metricHistory` array — see `buildMetricSeries`'s doc comment for what this deliberately does NOT use (D-12, 06-RESEARCH.md Pitfall 7). */
  x: number;
  value: number | undefined;
  /**
   * This team's Sigma Score AFTER this match (quick task 260913-m45), read
   * from the row's OWN `SIGMA_METRIC_KEY` entry — never the requested
   * metric's own `spread` field. `spread` is the algorithm's own confidence
   * in its rating and must never reach the screen (developer rule,
   * 2026-09-09); a series shape that no longer carries it cannot regress
   * onto the chart. `undefined` for a row with no published sigma (OPR, EPA,
   * or a not-yet-republished SPR row).
   */
  sigma: number | undefined;
  matchKey: string;
  eventKey: string;
}

export interface EventBand {
  eventKey: string;
  startX: number;
  endX: number;
  index: number;
}

/**
 * `x` is derived from array position, NEVER `row.matchIndex` — that field is
 * this team's position in the season-WIDE chronological stream, and plotting
 * it directly leaves large gaps for a team that played fewer matches than
 * the season's overall stream length (D-12). `rows` is never re-sorted:
 * `TeamSeasonArtifactSchema.metricHistory` is already this team's own rows
 * in this team's own chronological order. A row missing `metricKey` produces
 * a point with an `undefined` `value`, which the chart renders as a gap,
 * never a coerced zero. `sigma` is read from the row's own `SIGMA_METRIC_KEY`
 * entry, independent of `metricKey` — see `MetricSeriesPoint.sigma`'s own
 * doc comment.
 */
export function buildMetricSeries(rows: readonly MetricHistoryRow[], metricKey: string): MetricSeriesPoint[] {
  return rows.map((row, index) => {
    const metric = row.metrics[metricKey];
    return {
      x: index + 1,
      value: metric?.value,
      sigma: row.metrics[SIGMA_METRIC_KEY]?.value,
      matchKey: row.matchKey,
      eventKey: row.eventKey,
    };
  });
}

/**
 * Walks consecutive points and opens a new band wherever `eventKey`
 * changes. Each row already carries `eventKey` (`metricHistorySchema.ts`),
 * so no second lookup into `events[]` is needed for grouping — only for a
 * display name, which the caller (`MetricHistoryChart.tsx`) supplies via
 * `eventNameByKey`.
 */
export function detectEventBands(points: readonly MetricSeriesPoint[]): EventBand[] {
  const bands: EventBand[] = [];
  for (const point of points) {
    const last = bands[bands.length - 1];
    if (last !== undefined && last.eventKey === point.eventKey) {
      last.endX = point.x;
      continue;
    }
    bands.push({ eventKey: point.eventKey, startX: point.x, endX: point.x, index: bands.length });
  }
  return bands;
}

/**
 * Quick task 260913-m45: one point's Total ± Sigma band, one standard
 * deviation either side of Total. `null` means a GAP — never a zero-width
 * band — for a point missing either half, which is the honest rendering for
 * a row with no published sigma (OPR, EPA, a not-yet-republished SPR row) or
 * a row with no Total at all.
 */
export function sigmaBandFor(point: Pick<MetricSeriesPoint, "value" | "sigma">): [number, number] | null {
  if (point.value === undefined || point.sigma === undefined) return null;
  return [point.value - point.sigma, point.value + point.sigma];
}

/**
 * True only when `algorithmId` publishes Sigma Score AND at least one of
 * this team's Total-series points has a non-null band — i.e. the artifact
 * actually carries a published per-match sigma, not merely an algorithm that
 * is capable of one. False for OPR/EPA regardless of what the rows carry
 * (`spread` never gates a band — 2026-09-09), and false for SPR rows from
 * before the republish that added `sigma`. Gates the chart's Area, its
 * legend, and (via the Tab) the loading skeleton's spacer — one predicate,
 * three call sites, so they cannot disagree about whether a band is coming.
 *
 * React-free and Recharts-free, like every other export in this module, so
 * the eager `MetricHistoryTab` can call it without pulling Recharts into the
 * initial bundle (D-14) — only `MetricHistoryChart.tsx`, loaded via dynamic
 * `import()`, may import Recharts itself.
 */
export function drawsSigmaBand(rows: readonly MetricHistoryRow[], algorithmId: string): boolean {
  if (!usesSigmaScore(algorithmId)) return false;
  return buildMetricSeries(rows, TOTAL_METRIC_KEY).some((point) => sigmaBandFor(point) !== null);
}
