/**
 * Pure module, no React import — the rank plot's single geometry source,
 * mirroring `apps/web/src/components/team/matchAxis.ts`'s own "every derived
 * position comes from one computed source" discipline.
 *
 * Coordinate convention, declared once here rather than per function: rank
 * `r`'s visual centre is `x(r)`. Bars and the median tick are centred on that
 * point; the band's continuous edges are positioned by the same `x()`. All
 * three layers must share one convention or the band drifts visibly off the
 * bars it overlays. The convention does not touch `continuousQuantile()`
 * (simQuantile.ts) — only where the resulting quantiles are positioned.
 */

import { PLOT_W as MATCH_PLOT_W } from "../components/team/matchAxis.js";

/**
 * Re-exported, never restated: same visual language, same plot-cell width
 * across the app. The `lib`-importing-from-`components` direction is
 * deliberate and safe: `matchAxis.ts` is a pure module whose only
 * cross-package import (`TeamSeasonArtifact`) is type-only and erased by
 * `verbatimModuleSyntax`.
 */
export const PLOT_W = MATCH_PLOT_W;

/**
 * Locked pixel values, deliberately off the 4px spacing scale, mirroring
 * `matchAxis.ts`'s own `MATCH_GEOMETRY` in tone and content.
 *
 * `HIST_BAR_MAX_H` leaves 4px of padding top and bottom within
 * `ROW_PLOT_H` (40 - 32 = 8, split evenly).
 *
 * `BAND_MIN_W` is provably non-binding at any real event size — the
 * estimator's minimum reachable band width stays above this 2px floor. It is
 * carried anyway as a guard for rosters beyond the measured range, not a
 * live constraint at any event size this project has seen.
 *
 * `BAND_OPACITY` is the same number as the percentage inside
 * `--sim-band-overlay` in `apps/web/src/styles/theme.css`, coupled by an
 * assertion in this module's own `simAxis.test.ts`. It must never be applied
 * a second time as a CSS opacity on top of that token — doing so would
 * render the band at roughly 3% and make it invisible.
 */
export const SIM_GEOMETRY = {
  ROW_PLOT_H: 40,
  HIST_BAR_MAX_H: 32,
  MEDIAN_TICK_W: 2,
  BAND_OPACITY: 0.18,
  BAND_MIN_W: 2,
  BAR_GAP: 1,
} as const;

/**
 * The single rank-to-pixel mapping every position on the rank plot must
 * derive from. Accepts a continuous rank and never snaps its input — the
 * values it positions (10th/90th percentile edges from `continuousQuantile()`)
 * are interpolated quantiles, not integers.
 *
 * The `teamCount <= 1` guard is written as a positive test (`teamCount > 1`)
 * rather than a negated one, so a `NaN` or absent team count takes the same
 * early-return branch as a genuinely degenerate roster instead of falling
 * through to a `NaN` result. A `NaN` reaching a CSS length is silently
 * dropped by the browser, so the mark simply never paints — on an
 * honesty-first uncertainty display, an absent band reads as certainty, the
 * worst possible failure mode.
 */
export function x(rank: number, teamCount: number, plotW: number = PLOT_W): number {
  if (!(teamCount > 1)) return 0;
  // A slot-centred (band) scale, not a point scale: rank r occupies exactly
  // the slot `[(r-1)/N, r/N] * PLOT_W` and its centre is the slot's centre,
  // so adjacent bars tile the axis without touching or overlapping and the
  // two end bars are full width and flush with the plot's edges. A point
  // scale (rank 1 at x=0, rank N at x=PLOT_W) would make the rank pitch
  // `PLOT_W/(N-1)` while a histogram slot is `PLOT_W/N`, overlapping bars at
  // both ends. This mapping also makes the band's own continuous domain
  // exact rather than clamped: a band edge legitimately ranges over
  // `[0.5, N+0.5]`, and `x(0.5)` is precisely 0 while `x(N+0.5)` is precisely
  // PLOT_W, so `rankBandExtent`'s clamps never actually engage under normal
  // input.
  return ((rank - 0.5) / teamCount) * plotW;
}

/**
 * The histogram slot width. `x()`'s denominator is the same team count,
 * `PLOT_W / N` — the same mapping, not two different values that happen to
 * look alike. What legitimately differs is the half-slot offset `x()`
 * applies (`rank - 0.5`, not `rank`): that offset centres a rank within its
 * slot rather than at the slot's leading edge, which is why `x()` and
 * `rankSlotWidth` read as two functions instead of one even though they
 * share a denominator.
 */
export function rankSlotWidth(teamCount: number, plotW: number = PLOT_W): number {
  if (!(teamCount >= 1)) return plotW;
  return plotW / teamCount;
}

/** A mark's pixel extent within the plot cell, both fields in pixels from the cell's left edge. */
export interface RankMarkExtent {
  left: number;
  width: number;
}

/**
 * The clamped 10th-90th percentile band. The clamp is a measured necessity,
 * not defensive habit: because a band edge legitimately ranges over
 * `[0.5, N+0.5]` while `x()` maps rank 1 to `0` and rank N to `PLOT_W`, raw
 * extents overflow the cell at real events, and a two-team event overflows
 * by half the plot width per side, which would paint over the Median column
 * beside this plot cell.
 *
 * Both edges are clamped into `[0, PLOT_W]` independently, the width is
 * taken as the larger of the clamped span and `SIM_GEOMETRY.BAND_MIN_W`
 * (never letting a fully-locked team's band vanish), and `left` is then
 * pulled back so `left + width` never exceeds `PLOT_W`.
 */
export function rankBandExtent(p10: number, p90: number, teamCount: number, plotW: number = PLOT_W): RankMarkExtent {
  const clampedLeft = Math.min(Math.max(x(p10, teamCount, plotW), 0), plotW);
  const clampedRight = Math.min(Math.max(x(p90, teamCount, plotW), 0), plotW);
  const span = clampedRight - clampedLeft;
  const width = Math.min(Math.max(span, SIM_GEOMETRY.BAND_MIN_W), plotW);
  const left = Math.min(clampedLeft, plotW - width);
  return { left, width };
}

/**
 * The median tick's left offset, centred on `x(median, teamCount)` per this
 * file's coordinate convention. The half-width is derived from
 * `SIM_GEOMETRY.MEDIAN_TICK_W` rather than written as a separate literal.
 * Clamped so the tick never leaves the plot box.
 */
export function medianTickLeft(median: number, teamCount: number, plotW: number = PLOT_W): number {
  const half = SIM_GEOMETRY.MEDIAN_TICK_W / 2;
  const raw = x(median, teamCount, plotW) - half;
  return Math.min(Math.max(raw, 0), plotW - SIM_GEOMETRY.MEDIAN_TICK_W);
}

/**
 * A histogram bar's pixel extent, centred on `x(rank, teamCount)` per this
 * file's coordinate convention. Width is `rankSlotWidth(teamCount)` minus
 * `SIM_GEOMETRY.BAR_GAP`, floored at `1`, so adjacent bars never touch. Bar
 * height is deliberately absent from this function: it derives from draw
 * counts, not from the axis, and is capped at `HIST_BAR_MAX_H`.
 */
export function histBarExtent(rank: number, teamCount: number, plotW: number = PLOT_W): RankMarkExtent {
  const width = Math.max(1, rankSlotWidth(teamCount, plotW) - SIM_GEOMETRY.BAR_GAP);
  const raw = x(rank, teamCount, plotW) - width / 2;
  // The clamp is a pure safety rail rather than a load-bearing correction:
  // under `x()`'s slot-centred mapping every in-range rank already lands
  // wholly inside `[0, PLOT_W]`, so this can only ever fire for a rank
  // outside `[1, teamCount]`, which no caller passes.
  const left = Math.min(Math.max(raw, 0), plotW - width);
  return { left, width };
}

/**
 * The rank axis's own tick selection, kept in this one file alongside `x()`
 * because tick positions come from the identical mapping every other mark on
 * this plot derives from. A tick label is at most three digits, roughly 20px
 * wide, so 28px leaves a real gap between adjacent labels rather than a
 * touching pair.
 */
export const RANK_TICK_MIN_GAP_PX = 28;

const RANK_TICK_STEP_LADDER = [1, 2, 5, 10, 20, 25, 50] as const;

/**
 * Chooses the smallest step from `RANK_TICK_STEP_LADDER` whose pixel pitch
 * — `x(1 + step, teamCount) - x(1, teamCount)` — is at least
 * `RANK_TICK_MIN_GAP_PX`, builds the candidate set (rank 1, every
 * `1 + k*step` lying strictly inside the field, and rank `teamCount`), then
 * walks the candidates in order keeping 1 and `teamCount` unconditionally
 * and dropping any interior candidate closer than the minimum gap to the
 * last kept one — finally dropping the last kept INTERIOR candidate if it
 * sits closer than the minimum gap to `teamCount`, so the trailing anchor
 * never collides with its nearest neighbour either. Returns a single tick
 * for a team count that is not greater than 1, matching `x()`'s own
 * degenerate-roster guard.
 */
export function rankAxisTicks(teamCount: number, plotW: number = PLOT_W): number[] {
  if (!(teamCount > 1)) return [1];

  let step: number = RANK_TICK_STEP_LADDER[RANK_TICK_STEP_LADDER.length - 1]!;
  for (const candidate of RANK_TICK_STEP_LADDER) {
    if (x(1 + candidate, teamCount, plotW) - x(1, teamCount, plotW) >= RANK_TICK_MIN_GAP_PX) {
      step = candidate;
      break;
    }
  }

  const candidates: number[] = [1];
  for (let rank = 1 + step; rank < teamCount; rank += step) candidates.push(rank);
  candidates.push(teamCount);

  const kept: number[] = [];
  for (const candidate of candidates) {
    if (candidate === 1 || candidate === teamCount) {
      kept.push(candidate);
      continue;
    }
    const last = kept[kept.length - 1]!;
    if (x(candidate, teamCount, plotW) - x(last, teamCount, plotW) >= RANK_TICK_MIN_GAP_PX) kept.push(candidate);
  }

  if (kept.length >= 2) {
    const lastInteriorIdx = kept.length - 2;
    const lastInterior = kept[lastInteriorIdx]!;
    const anchor = kept[kept.length - 1]!;
    if (lastInterior !== 1 && x(anchor, teamCount, plotW) - x(lastInterior, teamCount, plotW) < RANK_TICK_MIN_GAP_PX) {
      kept.splice(lastInteriorIdx, 1);
    }
  }

  return kept;
}
