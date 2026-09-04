/**
 * Pure module, no React import (08-04-PLAN.md Task 3) — the rank plot's
 * single geometry source, mirroring `apps/web/src/components/team/matchAxis.ts`'s
 * own "every derived position comes from one computed source" discipline
 * (`.claude/skills/sketch-findings-sigmascout/references/chart-craft.md`'s
 * "derive coupled geometry" lesson — a real shipped drift: `matchAxis.ts`'s
 * own `allianceMarkPositions()` doc comment records the sketch's red dot
 * sitting 4.5px above its band's centre, the blue 1.5px below, unnoticed
 * until inspected directly).
 *
 * COORDINATE CONVENTION, declared once here rather than per function: rank
 * `r`'s visual CENTRE is `x(r)`. Bars and the median tick are centred on
 * that point; the band's continuous edges are positioned by the same `x()`.
 * Sketch 005's own `plotHTML` left-aligned each histogram bar at `x(rank)`
 * and offset its median tick by half a slot, while positioning the band's
 * continuous edges through raw `x()` — so the band sat about half a rank
 * left of the bars it overlaid (measured 12.05px at a 39-team event, 6.03px
 * at the 78-team maximum, 235px at a two-team event). This file corrects
 * that by giving all three layers one convention. The correction does not
 * touch `continuousQuantile()` (simQuantile.ts) — only where the resulting
 * quantiles are POSITIONED. Visual confirmation of the corrected alignment
 * is 08-14's mock-before-build obligation (`chart-craft.md`'s "render it
 * and look at it" rule); this is carried in 08-04-PLAN.md's `must_haves` as
 * a `backstop`-marked truth so it has a named owner.
 */

import { PLOT_W as MATCH_PLOT_W } from "../components/team/matchAxis.js";

/**
 * Re-exported, never restated. UI-SPEC requires this value be reused
 * verbatim from `matchAxis.ts` — same visual language, same plot-cell width
 * across the app — and `matchAxis.ts`'s own doc comment already records
 * this exact treatment for `EventMatchTable.tsx` importing rather than
 * restating it. The `lib`-importing-from-`components` direction is
 * deliberate and safe: `matchAxis.ts` is a pure module whose only
 * cross-package import (`TeamSeasonArtifact`) is type-only and erased by
 * `verbatimModuleSyntax`.
 */
export const PLOT_W = MATCH_PLOT_W;

/**
 * Locked pixel values, deliberately off the 4px spacing scale — carried
 * from UI-SPEC's Spacing Scale exceptions, mirroring `matchAxis.ts`'s own
 * `MATCH_GEOMETRY` in tone and content.
 *
 * `HIST_BAR_MAX_H` leaves 4px of padding top and bottom within
 * `ROW_PLOT_H` (40 - 32 = 8, split evenly).
 *
 * `BAND_MIN_W` and `BAR_GAP` are the two values ported from the sketch's
 * own renderer rather than from UI-SPEC's locked-geometry list.
 * `BAND_MIN_W` is provably non-binding below roughly 94 teams — the
 * estimator's minimum band is 0.8 rank units (verified over 200,000
 * randomly generated histograms this session), which is 4.88px at the
 * 78-team maximum, and the tightest reachable case after clamping is
 * 2.44px, both above this 2px floor. It is carried anyway because it costs
 * one comparison and the alternative is a silent deviation from the
 * validated reference — this is a guard for rosters beyond the measured
 * range, not a live constraint at any event size this project has seen.
 *
 * `BAND_OPACITY` is the SAME NUMBER as the percentage inside
 * `--sim-band-overlay` in `apps/web/src/styles/theme.css`, coupled by an
 * assertion in this module's own `simAxis.test.ts`. It must never be
 * applied a second time as a CSS opacity on top of that token — doing so
 * would render the band at roughly 3.2% and make it invisible, the same
 * zero-width-band defect this plan exists to prevent, arriving by a second
 * route.
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
 * derive from. Accepts a CONTINUOUS rank and never snaps its input — the
 * values it positions (10th/90th percentile edges from `continuousQuantile()`)
 * are interpolated quantiles, not integers.
 *
 * The `teamCount <= 1` guard is written as a POSITIVE test (`teamCount > 1`)
 * rather than a negated one, so a `NaN` or absent team count takes the same
 * early-return branch as a genuinely degenerate roster instead of falling
 * through to a `NaN` result — this is the sketch's own `span <= 0` guard,
 * written NaN-safe. A `NaN` reaching a CSS length is silently DROPPED by
 * the browser, so the mark simply never paints — on an honesty-first
 * uncertainty display, an absent band reads as certainty, the worst
 * possible failure mode.
 */
export function x(rank: number, teamCount: number, plotW: number = PLOT_W): number {
  if (!(teamCount > 1)) return 0;
  // 2026-09-01 (user report: "leftmost and rightmost boxes are squished").
  // This is a SLOT-CENTRED (band) scale, not the point scale it used to be.
  //
  // The old mapping was `((rank - 1) / (teamCount - 1)) * PLOT_W`, which put
  // rank 1 at x=0 and rank N at x=PLOT_W. That made the rank PITCH
  // `PLOT_W/(N-1)` while a histogram SLOT is `PLOT_W/N`, so a bar centred on
  // rank 1 hung half a slot off the left edge, got clamped back inside, and
  // then OVERLAPPED its neighbour — measured 6.53px of overlap at a 27-team
  // event and 4.07px at 40 teams, at BOTH ends. Because `--sim-hist-bar` is
  // 55% translucent, that overlap painted darker and read as a narrow
  // half-bar sitting beside a normal one: the reported squish.
  //
  // Under this mapping rank r occupies exactly the slot
  // `[(r-1)/N, r/N] * PLOT_W` and its centre is the slot's centre, so
  // adjacent bars tile the axis without touching or overlapping and the two
  // end bars are full width and flush with the plot's edges. It also makes
  // the band's own continuous domain exact rather than clamped: a band edge
  // legitimately ranges over `[0.5, N+0.5]`, and `x(0.5)` is now precisely 0
  // while `x(N+0.5)` is precisely PLOT_W, so the measured -10.58px/+480.70px
  // overflows the clamps in `rankBandExtent` existed to absorb are gone at
  // the source.
  return ((rank - 0.5) / teamCount) * plotW;
}

/**
 * The histogram slot width. IN-04 (260902-post-phase08-ungoverned-ui/REVIEW.md):
 * this comment used to claim the denominator here is "deliberately the team
 * count itself, while `x()`'s denominator is one less" — a PRE-fix
 * description. The 2026-09-01 slot-centred fix documented on `x()` above
 * changed `x()` to divide by the team count too, so today BOTH denominators
 * are the team count, `PLOT_W / N` — they are not two different values that
 * happen to look alike, they are the SAME mapping. What still legitimately
 * differs is the half-slot offset `x()` applies (`rank - 0.5`, not `rank`):
 * that offset is what centres a rank WITHIN its slot rather than at the
 * slot's leading edge, which is why `x()` and `rankSlotWidth` read as two
 * functions instead of one even though they share a denominator. See `x()`'s
 * own comment above for the fix and its measured before/after evidence.
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
 * The clamped 10th-90th percentile band. The clamp is a MEASURED
 * necessity, not defensive habit: because a band edge legitimately ranges
 * over `[0.5, N+0.5]` while `x()` maps rank 1 to `0` and rank N to
 * `PLOT_W`, raw extents overflow the cell at real events — measured this
 * session, the leftmost raw band edge is -4.94px at 2023nhgrs, -4.55px at
 * 2025flta and -10.58px at 2022ispr, and the rightmost is 474.88px,
 * 474.59px and 480.70px against a 470px plot. At a two-team event the
 * overflow is 235px per side, which would paint over the Median column
 * beside this plot cell.
 *
 * Both edges are clamped into `[0, PLOT_W]` independently, the width is
 * taken as the larger of the clamped span and `SIM_GEOMETRY.BAND_MIN_W`
 * (never letting a fully-locked team's band vanish), and `left` is then
 * pulled back so `left + width` never exceeds `PLOT_W` — the same
 * two-argument min/max clamping style throughout, never a rounding call.
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
 * `SIM_GEOMETRY.MEDIAN_TICK_W` rather than written as a separate literal —
 * this is the precise coupling `chart-craft.md` names, and the sketch's own
 * hard-coded tick offset (`+ slotW/2`) is what it warns against. Clamped so
 * the tick never leaves the plot box.
 */
export function medianTickLeft(median: number, teamCount: number, plotW: number = PLOT_W): number {
  const half = SIM_GEOMETRY.MEDIAN_TICK_W / 2;
  const raw = x(median, teamCount, plotW) - half;
  return Math.min(Math.max(raw, 0), plotW - SIM_GEOMETRY.MEDIAN_TICK_W);
}

/**
 * A histogram bar's pixel extent, centred on `x(rank, teamCount)` per this
 * file's coordinate convention. Width is `rankSlotWidth(teamCount)` minus
 * `SIM_GEOMETRY.BAR_GAP`, floored at `1`, so adjacent bars never touch.
 * Bar HEIGHT is deliberately absent from this function: it derives from
 * draw counts, not from the axis, is capped at `HIST_BAR_MAX_H`, and is
 * 08-14's job to compute.
 */
export function histBarExtent(rank: number, teamCount: number, plotW: number = PLOT_W): RankMarkExtent {
  const width = Math.max(1, rankSlotWidth(teamCount, plotW) - SIM_GEOMETRY.BAR_GAP);
  const raw = x(rank, teamCount, plotW) - width / 2;
  // The clamp is now a pure safety rail rather than a load-bearing
  // correction: under `x()`'s slot-centred mapping every in-range rank
  // already lands wholly inside `[0, PLOT_W]`, so this can only ever fire
  // for a rank outside `[1, teamCount]`, which no caller passes.
  const left = Math.min(Math.max(raw, 0), plotW - width);
  return { left, width };
}

/**
 * 08-14-PLAN.md Task 3: the rank axis's own tick selection, kept in this one
 * file alongside `x()` because tick positions come from the identical
 * mapping every other mark on this plot derives from. A tick label is at
 * most three digits at Label 12/600, roughly 20px wide, so 28px leaves a
 * real gap between adjacent labels rather than a touching pair —
 * `chart-craft.md`'s render-it-and-look-at-it rule expressed as a
 * computable property, since sketch 003's own value labels collided in all
 * three real matches it was tested on because the collision was never
 * computed.
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
