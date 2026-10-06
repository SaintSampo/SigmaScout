/**
 * ONE points-axis histogram, as the verdict drawer draws it (sketch 025 variant
 * A, quick task 261006-lxp): a responsive SVG at a fixed 560 unit width, scaled
 * to its container by CSS.
 *
 * PAINT ORDER, back to front: the hatched cutoff zone, the likely band, the
 * bars, the median tick, the axis labels and hairline, then the dashed cutoff
 * and its label, then the cap label. A tick or a cutoff is never buried under a
 * bar.
 *
 * EVERY X POSITION COMES FROM `districtHistGeometry.ts`, the single adapter over
 * the shipped rank-plot geometry, with `VERDICT_PLOT_W` passed as the plot width;
 * every vertical number comes from its `VERDICT_GEOMETRY`. This file names the
 * shared geometry module nowhere: reaching past the adapter is exactly the bug
 * the adapter exists to prevent, and a comment-stripped grep proves it.
 *
 * THE BARS TOUCH. A wide axis is binned to about 95 bars so each one is wide
 * enough to see, and each bin is one crisp bar with no gap. Heights are
 * normalised to THIS PLOT's own tallest bin, so equal heights in two plots do
 * NOT mean equal draw counts: the band and the tiles carry concentration, the
 * bars carry SHAPE. The band, the tick and the percentiles come from the
 * unbinned counts, so binning moves nothing printed.
 *
 * ONE SCALE PER COLUMN. The axis maximum is passed in by the caller from
 * `maxEventPoints(season, tier)` and is never a numeric literal here.
 *
 * NO COLOUR IS WRITTEN HERE. Every fill and stroke comes from a CSS class in
 * theme.css's verdict block.
 */
import { useId } from "react";
import { DISTRICT_LEDGER_VERDICT_LEGEND } from "./districtLedgerCopy.js";
import {
  SIM_GEOMETRY,
  VERDICT_GEOMETRY,
  VERDICT_PLOT_W,
  pointBinExtent,
  pointBinSize,
  pointMedianTickLeft,
  pointVerdictAxisTicks,
  pointVerdictBandExtent,
  pointX,
} from "./districtHistGeometry.js";

export interface DistrictPointHistogramProps {
  /** Index is the point value; `denominator` is what the array sums to. */
  readonly counts: ArrayLike<number>;
  readonly denominator: number;
  /** The axis ceiling: always `maxEventPoints`-derived, fixed per column. */
  readonly maxPoints: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /**
   * The cutoff on the grand total plot: a dashed line with its own label, and,
   * where the stat line prints a likely range, the hatched zone that range
   * spans. Absent where there is no cutoff to draw, and never a line at zero.
   */
  readonly cutoff?: { readonly position: number; readonly label: string; readonly zone?: { readonly p10: number; readonly p90: number } };
  /** The label at the top right of a Qualification chart, naming its cap. */
  readonly capLabel?: string;
  /** The plot's accessible name, kept visually hidden beside it. */
  readonly label: string;
  readonly testId?: string;
}

/** A pattern id React can hand to `url(#...)`: `useId` output with every character outside [A-Za-z0-9_-] removed. */
function hatchPatternId(raw: string): string {
  return `district-ledger-hatch-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export function DistrictPointHistogram({ counts, denominator, maxPoints, p10, p50, p90, cutoff, capLabel, label, testId }: DistrictPointHistogramProps) {
  const patternId = hatchPatternId(useId());
  const g = VERDICT_GEOMETRY;
  const marked = cutoff !== undefined || capLabel !== undefined;
  const top = marked ? g.TOP_MARKED : g.TOP_PLAIN;
  const height = top + g.PLOT_H + g.AXIS_H + g.BOTTOM_PAD;
  const baseline = top + g.PLOT_H;

  // The bins: each start value's mass is the sum of its values, clamped at the
  // array's end and at the axis ceiling.
  const last = Math.min(counts.length - 1, Math.round(maxPoints));
  const binSize = pointBinSize(maxPoints);
  const bins: { from: number; to: number; mass: number }[] = [];
  for (let from = 0; from <= last; from += binSize) {
    const to = Math.min(from + binSize - 1, last);
    let mass = 0;
    for (let value = from; value <= to; value++) mass += counts[value] ?? 0;
    bins.push({ from, to, mass });
  }
  let modal = 0;
  for (const bin of bins) if (bin.mass > modal) modal = bin.mass;

  const band = pointVerdictBandExtent(p10, p90, maxPoints, VERDICT_PLOT_W);
  const zone = cutoff?.zone === undefined ? undefined : pointVerdictBandExtent(cutoff.zone.p10, cutoff.zone.p90, maxPoints, VERDICT_PLOT_W);
  const tickLeft = pointMedianTickLeft(p50, maxPoints, VERDICT_PLOT_W);
  const ticks = pointVerdictAxisTicks(maxPoints);
  const cutoffX = cutoff === undefined ? undefined : pointX(cutoff.position, maxPoints, VERDICT_PLOT_W);
  const labelAtEnd = cutoffX !== undefined && cutoffX > VERDICT_PLOT_W - g.LABEL_EDGE;

  return (
    <div data-testid={testId}>
      <span className="sr-only">{label}</span>
      <svg
        aria-hidden="true"
        className="district-ledger-verdict-hist__svg"
        viewBox={`0 0 ${String(VERDICT_PLOT_W)} ${String(height)}`}
        data-plot-max={maxPoints}
        data-denominator={denominator}
      >
        {zone !== undefined && (
          <>
            <defs>
              <pattern id={patternId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
                <rect width="1" height="4" className="district-ledger-verdict-hist__hatch" />
              </pattern>
            </defs>
            <rect data-testid="district-hist-cutoff-zone" x={zone.left} y={top} width={zone.width} height={g.PLOT_H} fill={`url(#${patternId})`} />
          </>
        )}
        <rect data-testid="district-hist-band" className="district-ledger-verdict-hist__band" x={band.left} y={top} width={band.width} height={g.PLOT_H} />
        {modal > 0 &&
          bins.map((bin) => {
            const barHeight = (bin.mass / modal) * g.BAR_MAX_H;
            if (barHeight < 0.5) return null;
            const extent = pointBinExtent(bin.from, bin.to, maxPoints, VERDICT_PLOT_W);
            return (
              <rect
                key={bin.from}
                data-testid="district-hist-bar"
                className="district-ledger-verdict-hist__bar"
                x={extent.left}
                y={baseline - barHeight}
                width={extent.width}
                height={barHeight}
                shapeRendering="crispEdges"
              />
            );
          })}
        <rect
          data-testid="district-hist-median-tick"
          className="district-ledger-verdict-hist__tick"
          x={tickLeft}
          y={top}
          width={SIM_GEOMETRY.MEDIAN_TICK_W}
          height={g.PLOT_H}
        />
        {ticks.map((tick) => (
          <text
            key={tick}
            data-testid="district-hist-tick"
            className="district-ledger-verdict-hist__tick-label"
            x={pointX(tick, maxPoints, VERDICT_PLOT_W)}
            y={baseline + g.TICK_LABEL_DROP}
            textAnchor={tick === 0 ? "start" : "middle"}
          >
            {tick}
          </text>
        ))}
        <line className="district-ledger-verdict-hist__axis" x1={0} x2={VERDICT_PLOT_W} y1={baseline + 0.5} y2={baseline + 0.5} />
        {cutoff !== undefined && cutoffX !== undefined && (
          <>
            <line
              data-testid="district-hist-marked-line"
              className="district-ledger-verdict-hist__cutoff"
              x1={cutoffX}
              x2={cutoffX}
              y1={top - g.LINE_RISE}
              y2={baseline}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              data-testid="district-hist-cutoff-label"
              className="district-ledger-verdict-hist__cutoff-label"
              x={labelAtEnd ? cutoffX - g.LABEL_GAP : cutoffX + g.LABEL_GAP}
              y={top - g.LABEL_RISE}
              textAnchor={labelAtEnd ? "end" : "start"}
            >
              {cutoff.label}
            </text>
          </>
        )}
        {capLabel !== undefined && (
          <text
            data-testid="district-hist-cap"
            className="district-ledger-verdict-hist__cap"
            x={pointX(maxPoints, maxPoints, VERDICT_PLOT_W)}
            y={top - g.LABEL_RISE}
            textAnchor="end"
          >
            {capLabel}
          </text>
        )}
      </svg>
      <div data-testid="district-hist-legend" className="district-ledger-verdict-legend">
        <span>
          <i aria-hidden="true" className="district-ledger-verdict-legend__swatch district-ledger-verdict-legend__swatch--bars" />
          {DISTRICT_LEDGER_VERDICT_LEGEND.bars}
        </span>
        <span>
          <i aria-hidden="true" className="district-ledger-verdict-legend__swatch district-ledger-verdict-legend__swatch--band" />
          {DISTRICT_LEDGER_VERDICT_LEGEND.band}
        </span>
        <span>
          <i aria-hidden="true" className="district-ledger-verdict-legend__swatch district-ledger-verdict-legend__swatch--tick" />
          {DISTRICT_LEDGER_VERDICT_LEGEND.tick}
        </span>
        {cutoff !== undefined && (
          <span>
            <i aria-hidden="true" className="district-ledger-verdict-legend__swatch district-ledger-verdict-legend__swatch--cut" />
            {DISTRICT_LEDGER_VERDICT_LEGEND.cutoff}
          </span>
        )}
        {zone !== undefined && (
          <span>
            <i aria-hidden="true" className="district-ledger-verdict-legend__swatch district-ledger-verdict-legend__swatch--zone" />
            {DISTRICT_LEDGER_VERDICT_LEGEND.zone}
          </span>
        )}
      </div>
    </div>
  );
}
