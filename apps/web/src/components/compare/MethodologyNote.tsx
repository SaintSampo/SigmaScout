import { formatBrierDisplay } from "../../lib/compareTie.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * D-11's near-tie caption and D-08's methodology note (08-06-PLAN.md Task 3)
 * as one always-visible muted block beneath the accuracy table — never a
 * tooltip, never behind a disclosure toggle.
 *
 * Every figure this module prints is DERIVED from the same fetched
 * artifacts the table renders (Decision 4): nothing here is transcribed.
 * `buildMethodologyFigures` reads only VPR's COMBINED-view slice per season
 * (Decision 5 — this note's claim and SC-3's verdict are both measured on
 * the combined view; re-slicing to the elimination view would make the
 * note's own best-season clause false against the committed data, since
 * VPR's 2022 elimination Brier is lower than its 2026 one).
 *
 * Quick task 260903-n2o (D-5) removed this module's selection-claim
 * paragraph entirely — the sentence quick task 260903-krp installed here
 * asserted that every displayed season's hyperparameters were chosen using
 * only seasons before it. The shipped `provenance.tuneSeasons` names 2022,
 * 2023 and 2024 as seasons the optimizer WAS fitted on, so that sentence was
 * false for three of the five displayed seasons. It is not replaced with a
 * corrected version: the fetched Compare artifact carries no record of any
 * algorithm's selected-on set, so a replacement sentence cannot be derived
 * from it. `headlineEligible` is NOT an acceptable substitute source for
 * that claim — a `false` there conflates "too few prior seasons" with "the
 * optimizer saw this season," and this module deliberately reads neither
 * `seasonLabel` nor `headlineEligible` (unchanged from the instruction
 * below). Per D-5, saying less is preferred to saying something false.
 *
 * This module now reads NEITHER `seasonLabel` NOR `headlineEligible` — the
 * inverse of this module's prior instruction to read `seasonLabel`. Every
 * season `COMPARE_SEASONS` selects is, by construction, an origin season the
 * Compare page displays, so there is nothing left for either field to
 * distinguish here. `AccuracyTable.tsx` continues to read neither field
 * either, and this note must never be mounted inside it.
 */

export const METHODOLOGY_NOTE_TESTID = "compare-methodology-note";

/** The Copywriting Contract's D-11 near-tie caption, verbatim — including its em dash. Never reworded (Decision 6). */
export const NEAR_TIE_CAPTION =
  "Where two algorithms' scores are this close, the published data can't tell us which is really better. The threshold below is a judgement call, not a statistical test.";

const VPR_ALGORITHM_ID = "vpr";

interface SeasonBrier {
  readonly season: number;
  readonly text: string;
}

interface MethodologyFiguresBase {
  /** The seasons that yielded a VPR combined-view slice, ascending — the displayed set, per Decision 5. */
  readonly seasons: readonly number[];
}

export interface MethodologyFiguresIncomplete extends MethodologyFiguresBase {
  readonly complete: false;
}

export interface MethodologyFiguresComplete extends MethodologyFiguresBase {
  readonly complete: true;
  readonly seasonBriers: readonly SeasonBrier[];
  readonly bestSeason: number;
  readonly bestBrierText: string;
}

export type MethodologyFigures = MethodologyFiguresComplete | MethodologyFiguresIncomplete;

/**
 * Four shapes, per UI-SPEC's methodology-note prose:
 *  - one season: the bare year
 *  - two seasons: joined by the word "and"
 *  - three-or-more CONTIGUOUS seasons: an en-dashed range
 *  - three-or-more NON-contiguous seasons: comma-separated, "and" before the last
 */
export function formatSeasonList(seasons: readonly number[]): string {
  const sorted = [...seasons].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return String(sorted[0]);
  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]}`;

  const isContiguous = sorted.every((season, index) => index === 0 || season === sorted[index - 1]! + 1);
  if (isContiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;

  const allButLast = sorted.slice(0, -1).join(", ");
  return `${allButLast} and ${sorted[sorted.length - 1]}`;
}

/**
 * For each season in `COMPARE_SEASONS` ascending, selects VPR's own
 * combined-view slice from that season's fetched artifact — never another
 * algorithm's, never another view's. Returns the COMPLETE form only when
 * every one of the five seasons yielded a slice carrying a non-null Brier;
 * otherwise the INCOMPLETE form (the season list alone, built from whatever
 * seasons are present); with no slice at all, returns `undefined` — a claim
 * resting on all five seasons must not be made from fewer.
 */
export function buildMethodologyFigures(
  artifactsByYear: ReadonlyMap<number, CompareArtifact>,
): MethodologyFigures | undefined {
  const entries: { season: number; brierScore: number | null }[] = [];
  for (const season of COMPARE_SEASONS) {
    const artifact = artifactsByYear.get(season);
    const slice = artifact?.slices.find(
      (candidate) => candidate.algorithmId === VPR_ALGORITHM_ID && candidate.season === season && candidate.compLevelView === "combined",
    );
    if (slice !== undefined) {
      entries.push({ season, brierScore: slice.brierScore });
    }
  }

  if (entries.length === 0) return undefined;

  const seasons = entries.map((e) => e.season);

  const complete = entries.length === COMPARE_SEASONS.length && entries.every((e) => e.brierScore !== null);
  if (!complete) {
    return { complete: false, seasons };
  }

  const withBrier = entries as { season: number; brierScore: number }[];
  const seasonBriers = withBrier.map((e) => ({ season: e.season, text: formatBrierDisplay(e.brierScore) }));
  const best = withBrier.reduce((min, e) => (e.brierScore < min.brierScore ? e : min));

  return {
    complete: true,
    seasons,
    seasonBriers,
    bestSeason: best.season,
    bestBrierText: formatBrierDisplay(best.brierScore),
  };
}

const SMALL_NUMBER_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** Spells out a small count in words — the "of the five" count is DERIVED from `COMPARE_SEASONS.length`, never a written numeral. */
function numberWord(n: number): string {
  return SMALL_NUMBER_WORDS[n] ?? String(n);
}

/** One clause per displayed season's Brier score, in the same ascending order `formatSeasonList` uses. */
function buildBrierListSentence(seasonBriers: readonly SeasonBrier[]): string {
  const parts = seasonBriers.map((b) => `${b.season} ${b.text}`).join(", ");
  return `Brier by season: ${parts}.`;
}

/**
 * The D-08 methodology sentence, minus the retired selection claim (D-5,
 * quick task 260903-n2o — see this module's header comment for why). Only
 * ever called on the COMPLETE form: the Brier list and the best-season
 * clause both rest on a claim over all five seasons and must not render
 * from fewer, so the incomplete form now has nothing left to say here.
 */
function buildMethodologySentence(figures: MethodologyFiguresComplete): string {
  const brierList = buildBrierListSentence(figures.seasonBriers);
  const seasonCountWord = numberWord(figures.seasons.length);
  const bestClause = `${figures.bestSeason} is VPR's single best season of the ${seasonCountWord}.`;

  return `${brierList} ${bestClause}`;
}

export interface MethodologyNoteProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
}

export function MethodologyNote({ artifactsByYear }: MethodologyNoteProps) {
  const figures = buildMethodologyFigures(artifactsByYear);
  return (
    <div data-testid={METHODOLOGY_NOTE_TESTID} className="flex flex-col gap-[var(--spacing-xs)]">
      <p className="text-role-body text-[var(--color-text-muted)]">{NEAR_TIE_CAPTION}</p>
      {figures?.complete === true && (
        <p className="text-role-body text-[var(--color-text-muted)]">{buildMethodologySentence(figures)}</p>
      )}
    </div>
  );
}
