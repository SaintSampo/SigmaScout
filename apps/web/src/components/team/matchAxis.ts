import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Pure module, no React import — the per-team-season shared score axis, the
 * locked pixel geometry constants, and the two derivations (axis domain, RP
 * moments) the match rows need. Every value a `<MatchTable>` row positions
 * comes from this file, never a hand-tuned literal — see `MATCH_GEOMETRY`'s
 * own doc comment and the sketch-findings skill's "derive coupled geometry"
 * lesson.
 */

type PublishedTeamSeasonEvent = TeamSeasonArtifact["events"][number];
type PublishedTeamSeasonMatch = PublishedTeamSeasonEvent["matches"][number];
type PredictionKey = "predictedWinner" | "pRedWin" | "predictedRedScore" | "predictedBlueScore";

/**
 * The team page's DISPLAY match row: the published row with its four
 * prediction fields optional. Every published row carries all four; only an
 * upcoming match the browser could not price (a schedule-only row from the
 * live event artifact, overlaid by `teamUpcomingOverlay.ts`, 260915-m4j)
 * carries none. Read them through `teamRowPrediction`.
 */
export type TeamSeasonMatch = Omit<PublishedTeamSeasonMatch, PredictionKey> & Partial<Pick<PublishedTeamSeasonMatch, PredictionKey>>;
/** The team page's display event: the published event with display match rows. */
export type TeamSeasonEvent = Omit<PublishedTeamSeasonEvent, "matches"> & { matches: TeamSeasonMatch[] };

/** The four prediction fields of a team row when all four are present, else `undefined`. Presence, never truthiness: a probability or a score can be 0. */
export function teamRowPrediction(
  match: Pick<TeamSeasonMatch, PredictionKey>
): { predictedWinner: "red" | "blue"; pRedWin: number; predictedRedScore: number; predictedBlueScore: number } | undefined {
  if (match.predictedWinner === undefined || match.pRedWin === undefined || match.predictedRedScore === undefined || match.predictedBlueScore === undefined) {
    return undefined;
  }
  return { predictedWinner: match.predictedWinner, pRedWin: match.pRedWin, predictedRedScore: match.predictedRedScore, predictedBlueScore: match.predictedBlueScore };
}

/**
 * Locked pixel values, NOT derived from the 4px spacing scale — carried from
 * the sketch-findings skill's uncertainty-display and chart-craft notes.
 *
 * `Y_RED`/`Y_BLUE` are the two alliances' band-top offsets within one match
 * row, set so each alliance's band sits on the SAME BASELINE as that
 * alliance's team-number line in the Match column (red band centre 27, blue
 * band centre 49, measured from the plot's top) — a reader can then track
 * straight across from "4587 118 4328" to the red band.
 *
 * This baseline-alignment pairing relies on the per-match-row zebra tint for
 * grouping (rather than tight alliance-centre proximity alone). If a future
 * change removes the zebra tint, this trade collapses and the geometry has
 * to be re-argued — do not treat these as free values.
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
 * The plot's own fixed pixel width — not one of `MATCH_GEOMETRY`'s locked
 * constants (those are heights/offsets), but a real, deliberate ~470px
 * against a ~390px phone, which is why this table needs its own horizontal
 * scroll region at all. `EventMatchTable.tsx` imports this same constant
 * rather than restating it.
 */
export const PLOT_W = 470;

/** Fallback domain for a team-season with literally zero matches in scope — never reached once any event section renders, kept only so this function is total. */
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
 * This does NOT zero-anchor the axis — a team whose lowest padded extent is
 * 70 still gets a domain starting at 70. It only prevents the axis from
 * running below what a score can be.
 */
const DOMAIN_FLOOR = 0;

/**
 * The padding-and-floor policy shared by every axis-domain function in this
 * app — the team-season domain above and `eventMatchAxis.ts`'s
 * `computeEventAxisDomain`. What genuinely differs between the two callers
 * is only how extents are gathered from differently-shaped rows; the 5%
 * proportional pad, the 10-unit minimum pad and the zero floor are one
 * policy in one place, so an event axis can never pad differently from a
 * team axis. Returns `EMPTY_DOMAIN` when the raw extent is not finite (the
 * zero-matches / zero-rows case).
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
 * match, played AND scheduled, computed across the whole season so the axis
 * is stable once the schedule is known rather than creeping as results land.
 * Includes each alliance's predicted score band extents (predicted score
 * plus and minus one standard deviation, from that alliance's published
 * Match Band variance, the same `redMatchBandVariance`/`blueMatchBandVariance`
 * `MatchTable` draws, so a drawn band never runs past the axis) and the
 * actual scores where present. SPR only: OPR and EPA rows carry no band and
 * contribute only their point predictions and actual scores. Never computed
 * per event or per row — a per-row domain makes every row readable alone
 * and incomparable to its neighbours.
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
      // An unpriced row contributes no predicted score and no band.
      const prediction = teamRowPrediction(match);
      if (prediction !== undefined) {
        consider(prediction.predictedRedScore);
        consider(prediction.predictedBlueScore);

        const redSd = match.redMatchBandVariance !== undefined ? Math.sqrt(Math.max(0, match.redMatchBandVariance)) : 0;
        const blueSd = match.blueMatchBandVariance !== undefined ? Math.sqrt(Math.max(0, match.blueMatchBandVariance)) : 0;
        consider(prediction.predictedRedScore - redSd);
        consider(prediction.predictedRedScore + redSd);
        consider(prediction.predictedBlueScore - blueSd);
        consider(prediction.predictedBlueScore + blueSd);
      }

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
 * since the domain itself is zoomed to the data. Endpoints included so the
 * axis's own extremes are always labelled.
 */
export function axisTicks(domain: AxisDomain, tickCount: number = DEFAULT_TICK_COUNT): number[] {
  if (domain.max === domain.min) return [Math.round(domain.min)];
  const step = (domain.max - domain.min) / (tickCount - 1);
  return Array.from({ length: tickCount }, (_, index) => Math.round(domain.min + step * index));
}
