/**
 * Pure series derivation for the metric-history chart (06-05-PLAN.md Task 1).
 * No React import — testable without a DOM; `MetricHistoryChart.tsx` is the
 * one and only consumer of these two exports.
 */
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

export interface MetricSeriesPoint {
  /** The row's ARRAY POSITION (1-indexed) in the team's own `metricHistory` array — see `buildMetricSeries`'s doc comment for what this deliberately does NOT use (D-12, 06-RESEARCH.md Pitfall 7). */
  x: number;
  value: number | undefined;
  spread: number | undefined;
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
 * a point with an `undefined` `value` (and `spread`), which the chart
 * renders as a gap, never a coerced zero.
 */
export function buildMetricSeries(rows: readonly MetricHistoryRow[], metricKey: string): MetricSeriesPoint[] {
  return rows.map((row, index) => {
    const metric = row.metrics[metricKey];
    return {
      x: index + 1,
      value: metric?.value,
      spread: metric?.spread,
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
