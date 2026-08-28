import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Pure module, no React import (06-08-PLAN.md Task 1) — the per-team-season
 * shared score axis, the locked pixel geometry constants, and the two
 * derivations (axis domain, RP moments) the match rows need. Every value
 * a `<MatchTable>` row positions comes from this file, never a hand-tuned
 * literal — see `MATCH_GEOMETRY`'s own doc comment and
 * `.claude/skills/sketch-findings-sigmascout/references/chart-craft.md`'s
 * "derive coupled geometry" lesson (a real shipped drift: the sketch's red
 * dot sat 4.5px above its band's centre, the blue 1.5px below, unnoticed
 * until inspected directly).
 */

export type TeamSeasonEvent = TeamSeasonArtifact["events"][number];
export type TeamSeasonMatch = TeamSeasonEvent["matches"][number];

/**
 * Locked pixel values, NOT derived from the 4px spacing scale — carried from
 * `uncertainty-display.md`/`chart-craft.md` and `06-UI-SPEC.md`'s Spacing
 * Scale exceptions.
 *
 * `Y_RED`/`Y_BLUE` are the two alliances' band-top offsets within one match
 * row. They are set so each alliance's band sits on the SAME BASELINE as that
 * alliance's team-number line in the Match column: red band centre 27 and
 * blue band centre 49, measured from the plot's top, against roster line
 * centres measured at 27.1 and 49.1 in the rendered row. A reader can then
 * track straight across from "4587 118 4328" to the red band.
 *
 * REVISED 2026-08-26, deliberately, from the sketch-003 values (PLOT_H 44,
 * Y_RED 12, Y_BLUE 24). That draft put the alliance centres 12px apart to buy
 * a ~4x proximity ratio against the ~47px between-match gap, because
 * `chart-craft.md`'s "grouping is proximity" finding showed a dot landing far
 * from its partner horizontally would otherwise pair with the wrong row. The
 * text lines are 22px apart, so 12px could never align with them — the two
 * constraints are mutually exclusive and one had to give.
 *
 * What changed since that finding, and why the weaker ratio (~2.1x) is
 * acceptable now:
 *  1. The zebra tint per match row exists (06-09). `chart-craft.md` names it
 *     itself: "A zebra tint on alternate rows reinforces the block." It did
 *     not exist when sketch 003 was drawn, so proximity was carrying the
 *     grouping alone.
 *  2. Baseline alignment is a STRONGER pairing cue than proximity, not a
 *     weaker one: the band now shares a horizontal baseline with its own
 *     roster text, so the pairing is readable by row position rather than
 *     inferred from spacing.
 * If a future change removes the zebra tint, this trade collapses and the
 * proximity ratio has to be re-argued — do not treat these as free values.
 */
export const MATCH_GEOMETRY = {
  BAND_H: 8,
  DOT_H: 12,
  TICK_H: 14,
  PLOT_H: 60,
  Y_RED: 23,
  Y_BLUE: 45,
} as const;

export interface AllianceMarkPositions {
  /** The single computed source every other position derives from. */
  centre: number;
  bandTop: number;
  tickTop: number;
  dotTop: number;
}

/**
 * The band, tick and dot tops for ONE alliance — every one of them derived
 * from a single `centre`, never an independently hand-tuned value. This is
 * the exact coupling `chart-craft.md` names as the fix for the sketch's
 * drifted dots: two numbers that must agree and are maintained separately
 * WILL drift.
 */
export function allianceMarkPositions(yBand: number): AllianceMarkPositions {
  const centre = yBand + MATCH_GEOMETRY.BAND_H / 2;
  return {
    centre,
    bandTop: centre - MATCH_GEOMETRY.BAND_H / 2,
    tickTop: centre - MATCH_GEOMETRY.TICK_H / 2,
    dotTop: centre - MATCH_GEOMETRY.DOT_H / 2,
  };
}

export interface AxisDomain {
  min: number;
  max: number;
}

/**
 * The plot's own fixed pixel width (07-12-PLAN.md Task 1, promoted from a
 * `MatchTable.tsx`-private literal) — not one of `MATCH_GEOMETRY`'s locked
 * constants (those are heights/offsets), but a real, deliberate ~470px per
 * `06-CONTEXT.md` D-10's own framing ("the plot needs ~470px against a
 * ~390px phone" — the reason this table needs its own horizontal scroll
 * region at all). Deliberately NOT grouped into `MATCH_GEOMETRY`, which is
 * heights/offsets only; this is the plot's horizontal extent, a different
 * axis of geometry entirely, and merging the two groups for no gain would
 * contradict this very comment. `EventMatchTable.tsx` imports this same
 * constant rather than restating it (07-12's D-12/D-13 event-scoped table).
 */
export const PLOT_W = 470;

/** Fallback domain for a team-season with literally zero matches in scope — never reached once any event section renders (E7's "empty — dismissed" row), kept only so this function is total. */
const EMPTY_DOMAIN: AxisDomain = { min: 0, max: 1 };

/** A tick count that reads as "a few labelled ticks", not a dense ruler. */
const DEFAULT_TICK_COUNT = 4;

/** Proportional padding so a mark sitting at the extreme of the range is never clipped against the plot's own edge. */
const DOMAIN_PADDING_RATIO = 0.05;
/** A floor on the padding above, so a tight-range fixture (or a single repeated score) still gets visible breathing room instead of a near-zero pad. */
const MIN_DOMAIN_PADDING = 10;

/**
 * The domain's hard floor. An FRC alliance score cannot be negative, so the
 * padding below `min` must never carry the axis past zero — a tick reading
 * "-14" labels a region of the plot that no mark can ever occupy, and it
 * costs real plot width to draw. Clamping here (rather than at the tick
 * layer) keeps `scaleToPlot` and `axisTicks` honest: they map the domain
 * they are given, and the domain itself is now always physically reachable.
 * Note this does NOT zero-anchor the axis — a team whose lowest padded
 * extent is 70 still gets a domain starting at 70, per D-06's zoomed axis.
 * It only prevents the axis from running below what a score can be.
 */
const DOMAIN_FLOOR = 0;

/**
 * The padding-and-floor policy (07-12-PLAN.md Task 1, extracted from
 * `computeAxisDomain`'s own tail) shared by every axis-domain function in
 * this app — the team-season domain above and `eventMatchAxis.ts`'s
 * `computeEventAxisDomain`. What genuinely differs between the two callers
 * is only how extents are gathered from differently-shaped rows; the 5%
 * proportional pad, the 10-unit minimum pad and the zero floor are one
 * policy in one place, so an event axis can never pad differently from a
 * team axis. Returns `EMPTY_DOMAIN` when the raw extent is not finite (the
 * zero-matches / zero-rows case), matching `computeAxisDomain`'s pre-existing
 * behaviour exactly.
 */
export function padAxisDomain(min: number, max: number): AxisDomain {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return EMPTY_DOMAIN;
  }

  const range = max - min;
  const padding = Math.max(range * DOMAIN_PADDING_RATIO, MIN_DOMAIN_PADDING);
  return { min: Math.max(DOMAIN_FLOOR, min - padding), max: max + padding };
}

/**
 * The shared score domain for the WHOLE team-season — every event, every
 * match, played AND scheduled (D-06's implementation note: computed across
 * the whole season so the axis is stable once the schedule is known, rather
 * than creeping as results land). Includes each alliance's predicted score
 * band extents (predicted score plus and minus one standard deviation, from
 * that alliance's own predicted-score variance when published) and the
 * actual scores where present. Never computed per event or per row — the
 * sketch's first two drafts did that and every row was readable alone and
 * incomparable to its neighbours.
 */
export function computeAxisDomain(events: readonly TeamSeasonEvent[]): AxisDomain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  const consider = (value: number): void => {
    if (value < min) min = value;
    if (value > max) max = value;
  };

  for (const event of events) {
    for (const match of event.matches) {
      consider(match.predictedRedScore);
      consider(match.predictedBlueScore);

      const redSd = match.redScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, match.redScoreVarianceOwn)) : 0;
      const blueSd = match.blueScoreVarianceOwn !== undefined ? Math.sqrt(Math.max(0, match.blueScoreVarianceOwn)) : 0;
      consider(match.predictedRedScore - redSd);
      consider(match.predictedRedScore + redSd);
      consider(match.predictedBlueScore - blueSd);
      consider(match.predictedBlueScore + blueSd);

      if (match.actualRedScore !== undefined) consider(match.actualRedScore);
      if (match.actualBlueScore !== undefined) consider(match.actualBlueScore);
    }
  }

  return padAxisDomain(min, max);
}

/** The single value-to-x mapping every mark and tick position goes through. */
export function scaleToPlot(value: number, domain: AxisDomain, plotWidth: number): number {
  const range = domain.max - domain.min;
  if (range === 0) return plotWidth / 2;
  return ((value - domain.min) / range) * plotWidth;
}

/**
 * A small set of labelled ticks spanning the domain — never zero-anchored,
 * since the domain itself is zoomed to the data (D-06). Endpoints included
 * so the axis's own extremes are always labelled.
 */
export function axisTicks(domain: AxisDomain, tickCount: number = DEFAULT_TICK_COUNT): number[] {
  if (domain.max === domain.min) return [Math.round(domain.min)];
  const step = (domain.max - domain.min) / (tickCount - 1);
  return Array.from({ length: tickCount }, (_, index) => Math.round(domain.min + step * index));
}
