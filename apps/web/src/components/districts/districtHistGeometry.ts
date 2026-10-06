/**
 * THE ONE ADAPTER between a POINTS axis and `apps/web/src/lib/simAxis.ts`, the
 * shipped rank-plot geometry source.
 *
 * It holds exactly two ideas: a points histogram over `0..m` has `m + 1` bins,
 * and point value `v` is slot `v + 1`. Every position the district drawer
 * paints comes from `simAxis.ts` THROUGH THIS FILE — bar extents, band extent,
 * median tick, axis ticks, plot width and `SIM_GEOMETRY`. There is no second
 * geometry source and no hand-tuned pixel anywhere in the drawer.
 *
 * WHY THE SUBSTITUTION IS EXACT RATHER THAN APPROXIMATE, measured rather than
 * assumed: `simAxis`'s `x(rank, teamCount, plotW)` is
 * `((rank - 0.5) / teamCount) * plotW` — a SLOT-CENTRED scale, not a point
 * scale. Substituting `v + 1` for the rank and `m + 1` for the team count
 * reproduces that convention exactly, including the `[0.5, N + 0.5]`
 * continuous band-edge domain whose clamps `rankBandExtent`'s own comments
 * prove never engage under normal input. A points axis therefore inherits the
 * slot-centred tiling — adjacent bars neither touch nor overlap, and the two
 * end bars sit flush inside the plot box — for free.
 *
 * THE `+ 1` LIVES HERE AND NOWHERE ELSE. A caller passing a raw point value
 * straight into `simAxis` is the bug this module exists to prevent, and
 * `DistrictPointHistogram.tsx` names `simAxis` nowhere at all.
 */
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankAxisTicks, rankBandExtent, rankSlotWidth, x, type RankMarkExtent } from "../../lib/simAxis.js";

/**
 * Re-exported, never restated: no pixel value in the district drawer is typed
 * a second time.
 *
 * `SIM_GEOMETRY.BAND_OPACITY` carries its own warning forward unchanged — it is
 * the same number as the percentage inside `--sim-band-overlay` in
 * `theme.css`, and applying it a SECOND time as a CSS opacity renders the band
 * at roughly 3% and makes it invisible.
 */
export { PLOT_W, SIM_GEOMETRY };
export type { RankMarkExtent };

/** A points histogram over `0..maxPoints` occupies this many slots. */
export function pointSlots(maxPoints: number): number {
  return Math.max(1, Math.round(maxPoints) + 1);
}

/** Point value `v`'s visual centre — `simAxis.x` with the two substitutions applied. */
export function pointX(value: number, maxPoints: number, plotW: number = PLOT_W): number {
  return x(value + 1, pointSlots(maxPoints), plotW);
}

/**
 * The continuous 10th-to-90th band on a points axis.
 *
 * A POINT-MASS DISTRIBUTION STILL DRAWS A VISIBLE BAND: the floor is
 * `SIM_GEOMETRY.BAND_MIN_W`, reached through `rankBandExtent` rather than
 * reimplemented. That is sketch 005's first measured defect — an invisible mark
 * on an honesty-first uncertainty display reads as certainty, the worst
 * possible failure mode.
 */
export function pointBandExtent(p10: number, p90: number, maxPoints: number, plotW: number = PLOT_W): RankMarkExtent {
  return rankBandExtent(p10 + 1, p90 + 1, pointSlots(maxPoints), plotW);
}

/** The median tick's left offset on a points axis. */
export function pointMedianTickLeft(median: number, maxPoints: number, plotW: number = PLOT_W): number {
  return medianTickLeft(median + 1, pointSlots(maxPoints), plotW);
}

/** One histogram bar's pixel extent on a points axis. */
export function pointBarExtent(value: number, maxPoints: number, plotW: number = PLOT_W): RankMarkExtent {
  return histBarExtent(value + 1, pointSlots(maxPoints), plotW);
}

/** The points axis's own tick VALUES, chosen by the shipped rank-tick ladder and mapped back off the slot axis. */
export function pointAxisTicks(maxPoints: number, plotW: number = PLOT_W): number[] {
  return rankAxisTicks(pointSlots(maxPoints), plotW).map((rank) => rank - 1);
}

// ---------------------------------------------------------------------------
// The verdict drawer's chart (sketch 025 variant A, quick task 261006-lxp)
//
// One responsive SVG at a fixed 560 unit width: binned bars that TOUCH, a band,
// a median tick, an optional dashed cutoff with a hatched likely zone, and an
// axis. Every x position still comes through this file, with `plotW` passed as
// `VERDICT_PLOT_W`; nothing below re-derives what `simAxis` already provides.
// ---------------------------------------------------------------------------

/** The verdict chart's own width, in SVG units. The sketch's `W`. */
export const VERDICT_PLOT_W = 560;

/**
 * Every vertical number the verdict chart draws with, and the few horizontal
 * ones that are not axis positions. Each is the sketch's own: `PLOT_H` is its
 * `H`, `AXIS_H` its `ax`, `BAR_MAX_H` its `H - 2`, `BIN_TARGET` the bin count it
 * aims for, and the label numbers are its own offsets.
 */
export const VERDICT_GEOMETRY = {
  PLOT_H: 84,
  AXIS_H: 16,
  BOTTOM_PAD: 4,
  TOP_MARKED: 20,
  TOP_PLAIN: 6,
  BAR_MAX_H: 82,
  BAND_MIN_W: 3,
  BIN_TARGET: 95,
  LABEL_GAP: 5,
  LABEL_EDGE: 80,
  LABEL_RISE: 7,
  LINE_RISE: 2,
  TICK_LABEL_DROP: 13,
} as const;

/**
 * How many point values one bar covers. A 426 slot axis at 560 units is 1.3
 * units a bar, which reads as dust; binning to about 95 bars keeps each one
 * wide enough for the eye to resolve.
 */
export function pointBinSize(maxPoints: number): number {
  return Math.max(1, Math.ceil(pointSlots(maxPoints) / VERDICT_GEOMETRY.BIN_TARGET));
}

/**
 * ONE touching bar spanning point values `from` to `to`: from `from`'s slot
 * left edge to `to`'s slot right edge, with NO gap, unlike `pointBarExtent`.
 * Adjacent bins therefore tile the axis edge to edge.
 */
export function pointBinExtent(from: number, to: number, maxPoints: number, plotW: number = PLOT_W): RankMarkExtent {
  const slots = pointSlots(maxPoints);
  const half = rankSlotWidth(slots, plotW) / 2;
  const left = x(from + 1, slots, plotW) - half;
  const right = x(to + 1, slots, plotW) + half;
  return { left, width: right - left };
}

/**
 * The verdict chart's band, and its hatched cutoff zone: `pointBandExtent`,
 * widened about its centre to `VERDICT_GEOMETRY.BAND_MIN_W` when narrower and
 * clamped into `[0, plotW]`.
 *
 * NO HALF SLOT SHIFT on either edge: the percentiles already sit on slot edge
 * positions, so the adapter maps them exactly.
 */
export function pointVerdictBandExtent(p10: number, p90: number, maxPoints: number, plotW: number = PLOT_W): RankMarkExtent {
  const base = pointBandExtent(p10, p90, maxPoints, plotW);
  if (base.width >= VERDICT_GEOMETRY.BAND_MIN_W) return base;
  const width = Math.min(VERDICT_GEOMETRY.BAND_MIN_W, plotW);
  const centre = base.left + base.width / 2;
  const left = Math.min(Math.max(centre - width / 2, 0), plotW - width);
  return { left, width };
}

/** The verdict chart's axis tick values: 0 and every step up to the ceiling, on the sketch's 100, 50, 20, 10 ladder. */
export function pointVerdictAxisTicks(maxPoints: number): number[] {
  const step = maxPoints > 300 ? 100 : maxPoints > 100 ? 50 : maxPoints > 40 ? 20 : 10;
  const ticks: number[] = [];
  for (let value = 0; value <= maxPoints; value += step) ticks.push(value);
  return ticks;
}
