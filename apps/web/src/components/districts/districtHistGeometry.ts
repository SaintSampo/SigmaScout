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
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankAxisTicks, rankBandExtent, x, type RankMarkExtent } from "../../lib/simAxis.js";

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
