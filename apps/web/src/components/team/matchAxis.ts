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
 * Locked pixel values, NOT derived from the 4px spacing scale — carried
 * verbatim from `uncertainty-display.md`/`chart-craft.md` and
 * `06-UI-SPEC.md`'s Spacing Scale exceptions. `Y_RED`/`Y_BLUE` are the two
 * alliances' band-top offsets within one 44px-tall match row: 12px apart
 * (between alliance centres, within a match) against a measured ~47px gap
 * between matches — the ~4x proximity ratio `chart-craft.md` found necessary
 * before the pairing read correctly. Do not re-derive any of these.
 */
export const MATCH_GEOMETRY = {
  BAND_H: 8,
  DOT_H: 12,
  TICK_H: 14,
  PLOT_H: 44,
  Y_RED: 12,
  Y_BLUE: 24,
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

/** Fallback domain for a team-season with literally zero matches in scope — never reached once any event section renders (E7's "empty — dismissed" row), kept only so this function is total. */
const EMPTY_DOMAIN: AxisDomain = { min: 0, max: 1 };

/** A tick count that reads as "a few labelled ticks", not a dense ruler. */
const DEFAULT_TICK_COUNT = 4;

/** Proportional padding so a mark sitting at the extreme of the range is never clipped against the plot's own edge. */
const DOMAIN_PADDING_RATIO = 0.05;
/** A floor on the padding above, so a tight-range fixture (or a single repeated score) still gets visible breathing room instead of a near-zero pad. */
const MIN_DOMAIN_PADDING = 10;

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

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return EMPTY_DOMAIN;
  }

  const range = max - min;
  const padding = Math.max(range * DOMAIN_PADDING_RATIO, MIN_DOMAIN_PADDING);
  return { min: min - padding, max: max + padding };
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
