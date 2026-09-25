/**
 * ONE points-axis histogram: the band first, then the bars, then the median
 * tick last — `RankDistributionTable.tsx`'s own three-layer paint order, so a
 * tick is never buried under a bar.
 *
 * EVERY POSITION COMES FROM `districtHistGeometry.ts`, the single adapter over
 * the shipped rank-plot geometry. This file names the shared geometry module
 * nowhere: reaching past the adapter is exactly the bug the adapter exists to
 * prevent, and a comment-stripped grep proves it.
 *
 * Bar heights come from the shipped `histBarHeight`, normalised to THIS PLOT's
 * own modal count, and its stated accepted cost carries over unchanged: equal
 * bar heights in two different plots do NOT mean equal draw counts. The band
 * and the printed percentile range carry concentration; the bars carry SHAPE.
 *
 * ONE SCALE PER COLUMN, shared down the column. The axis maximum is passed in
 * by the caller from `maxEventPoints(season, tier)` and is never a numeric
 * literal here. Per-row scales were rejected by the user on sight and the
 * skill reference states the rule outright.
 */
import { histBarHeight } from "../event/rankRows.js";
import {
  PLOT_W,
  SIM_GEOMETRY,
  pointAxisTicks,
  pointBandExtent,
  pointBarExtent,
  pointMedianTickLeft,
  pointX,
} from "./districtHistGeometry.js";

export interface DistrictPointHistogramProps {
  /** Index is the point value; `denominator` is what the array sums to. */
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
  /** The axis ceiling — always `maxEventPoints`-derived, fixed per column. */
  readonly maxPoints: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /** Today's line on the grand total plot: a dashed rule with its own label. Absent when the capacity is unpublished — no line is drawn at zero. */
  readonly markedPosition?: number;
  readonly markedLabel?: string;
  /** The plot's accessible name, kept visually hidden beside it as `RankAxisHeader` does. */
  readonly label: string;
  readonly testId?: string;
}

export function DistrictPointHistogram({
  counts,
  denominator,
  maxPoints,
  p10,
  p50,
  p90,
  markedPosition,
  markedLabel,
  label,
  testId,
}: DistrictPointHistogramProps) {
  const band = pointBandExtent(p10, p90, maxPoints);
  const tickLeft = pointMedianTickLeft(p50, maxPoints);
  const upper = Math.min(counts.length - 1, Math.round(maxPoints));

  let modal = 0;
  for (let value = 0; value <= upper; value++) {
    const count = counts[value] ?? 0;
    if (count > modal) modal = count;
  }

  const bars: { value: number; left: number; width: number; height: number }[] = [];
  for (let value = 0; value <= upper; value++) {
    const count = counts[value] ?? 0;
    if (count <= 0) continue;
    const extent = pointBarExtent(value, maxPoints);
    bars.push({ value, left: extent.left, width: extent.width, height: histBarHeight(count, modal) });
  }

  const ticks = pointAxisTicks(maxPoints);

  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]" data-testid={testId}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="relative"
        style={{ width: `${String(PLOT_W)}px`, height: `${String(SIM_GEOMETRY.ROW_PLOT_H)}px` }}
        data-plot-max={maxPoints}
        data-denominator={denominator}
      >
        {/* Layer 1: the band. `--sim-band-overlay` already carries
            SIM_GEOMETRY.BAND_OPACITY as its own percentage — never apply it a
            second time as a CSS opacity. */}
        <div
          data-testid="district-hist-band"
          className="absolute inset-y-0 bg-[var(--sim-band-overlay)]"
          style={{ left: `${String(band.left)}px`, width: `${String(band.width)}px` }}
        />
        {/* Layer 2: the bars. */}
        {bars.map((bar) => (
          <div
            key={bar.value}
            data-testid="district-hist-bar"
            className="absolute bottom-0 bg-[var(--sim-hist-bar)]"
            style={{ left: `${String(bar.left)}px`, width: `${String(bar.width)}px`, height: `${String(bar.height)}px` }}
          />
        ))}
        {/* Layer 3: the median tick, painted last. */}
        <div
          data-testid="district-hist-median-tick"
          className="absolute inset-y-0 bg-[var(--sim-median-tick)]"
          style={{ left: `${String(tickLeft)}px`, width: `${String(SIM_GEOMETRY.MEDIAN_TICK_W)}px` }}
        />
        {markedPosition !== undefined && (
          <div
            data-testid="district-hist-marked-line"
            className="absolute inset-y-0 border-l border-dashed border-[var(--color-text-primary)]"
            style={{ left: `${String(pointX(markedPosition, maxPoints))}px` }}
          />
        )}
      </div>
      <div aria-hidden="true" className="relative" style={{ width: `${String(PLOT_W)}px`, height: "14px" }}>
        {ticks.map((tick) => (
          <span
            key={tick}
            data-testid="district-hist-tick"
            className="absolute text-[10px] text-[var(--color-text-muted)]"
            style={{ left: `${String(pointX(tick, maxPoints))}px`, transform: "translateX(-50%)" }}
          >
            {tick}
          </span>
        ))}
      </div>
      {markedLabel !== undefined && <span className="text-[var(--color-text-muted)]">{markedLabel}</span>}
    </div>
  );
}
