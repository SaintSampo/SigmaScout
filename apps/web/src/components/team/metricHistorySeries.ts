/**
 * Pure series derivation for the metric-history chart. No React import —
 * testable without a DOM; `MetricHistoryChart.tsx` is the one and only
 * consumer of these exports.
 */
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { SIGMA_METRIC_KEY, usesSigmaScore } from "../../../../../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../../../../../packages/core/algorithms/types.js";

/**
 * The chart's legend row and the Tab's skeleton spacer both read this ONE
 * constant, so the two heights cannot drift apart — the skeleton exists
 * specifically so the chart's eventual legend causes no layout shift when
 * the lazy chunk lands, and that guarantee only holds if both sides share
 * one number rather than two independently hand-tuned ones.
 */
export const METRIC_HISTORY_LEGEND_HEIGHT_PX = 24;

export interface MetricSeriesPoint {
  /** The row's ARRAY POSITION (1-indexed) in the team's own `metricHistory` array — see `buildMetricSeries`'s doc comment for what this deliberately does NOT use. */
  x: number;
  value: number | undefined;
  /**
   * This team's Sigma Score AFTER this match, read from the row's OWN
   * `SIGMA_METRIC_KEY` entry — never the requested metric's own `spread`
   * field. `spread` is the algorithm's own confidence in its rating and
   * must never reach the screen; a series shape that no longer carries it
   * cannot regress onto the chart. `undefined` for a row with no published
   * sigma (OPR, EPA, or a not-yet-republished SPR row).
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
 * the season's overall stream length. `rows` is never re-sorted:
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
 * One point's Total ± Sigma band, one standard deviation either side of
 * Total. `null` means a GAP — never a zero-width band — for a point missing
 * either half, which is the honest rendering for a row with no published
 * sigma (OPR, EPA, a not-yet-republished SPR row) or a row with no Total at
 * all.
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
 * (`spread` never gates a band), and false for SPR rows from before the
 * republish that added `sigma`. Gates the chart's Area, its legend, and (via
 * the Tab) the loading skeleton's spacer — one predicate, three call sites,
 * so they cannot disagree about whether a band is coming.
 *
 * React-free and Recharts-free, like every other export in this module, so
 * the eager `MetricHistoryTab` can call it without pulling Recharts into the
 * initial bundle — only `MetricHistoryChart.tsx`, loaded via dynamic
 * `import()`, may import Recharts itself.
 */
export function drawsSigmaBand(rows: readonly MetricHistoryRow[], algorithmId: string): boolean {
  if (!usesSigmaScore(algorithmId)) return false;
  return buildMetricSeries(rows, TOTAL_METRIC_KEY).some((point) => sigmaBandFor(point) !== null);
}

/** Roughly how many intervals the Y axis aims for before rounding the step. */
const Y_AXIS_TARGET_INTERVALS = 4;

/**
 * The Y axis's rendered domain and its tick ladder, from the raw
 * `[min, max]` the chart has already zero-extended and padded.
 *
 * Recharts anchors a fixed domain's ticks at the domain's own minimum. While
 * that minimum was always 0 or a negative Total, the labels came out round.
 * The Sigma band's lower edge is an arbitrary number, so a band dipping below
 * zero anchored every label to it: -18.71, 131.29, 281.29 on a live look
 * check. The fix rounds both bounds OUTWARD to a multiple of one nice step
 * (1, 2 or 5 times a power of ten) and hands Recharts that exact ladder, so
 * zero is always a tick and the domain never narrows. Each bound moves by
 * less than one step.
 *
 * Pure, so the chart and its tests share one implementation. Tick values are
 * cleaned to 12 significant digits (no `0.6000000000000001`) and normalized
 * so a bound that rounds to zero is `0`, never `-0`.
 */
export function niceYAxis(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  const raw = (max - min) / Y_AXIS_TARGET_INTERVALS;
  let step = 1;
  if (raw > 0) {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / magnitude;
    step = (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * magnitude;
  }
  const clean = (value: number): number => Number(value.toPrecision(12)) + 0;
  const lo = clean(Math.floor(min / step) * step);
  const hi = clean(Math.ceil(max / step) * step);
  const count = Math.round((hi - lo) / step);
  const ticks: number[] = [];
  for (let k = 0; k <= count; k++) ticks.push(clean(lo + k * step));
  return { domain: [lo, hi], ticks };
}
