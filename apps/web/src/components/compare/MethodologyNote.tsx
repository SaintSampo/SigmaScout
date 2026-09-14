import { formatBrierDisplay } from "../../lib/compareTie.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The near-tie caption and the methodology note, as one always-visible
 * muted block beneath the accuracy table — never a tooltip, never behind a
 * disclosure toggle.
 *
 * Every figure this module prints is DERIVED from the same fetched
 * artifacts the table renders: nothing here is transcribed.
 * `buildMethodologyFigures` reads only the premier algorithm's
 * COMBINED-view slice per season — re-slicing to the elimination view could
 * make the best-season clause false against the committed data.
 *
 * This module deliberately makes no claim about which seasons an
 * algorithm's hyperparameters were tuned on: the fetched Compare artifact
 * carries no record of any algorithm's selected-on set, and neither
 * `seasonLabel` nor `headlineEligible` is an acceptable substitute for that
 * claim (a `false` `headlineEligible` conflates "too few prior seasons"
 * with "the optimizer saw this season"). Saying less is preferred to saying
 * something false. `AccuracyTable.tsx` reads neither field either, and this
 * note must never be mounted inside it.
 */

export const METHODOLOGY_NOTE_TESTID = "compare-methodology-note";

/** The Copywriting Contract's D-11 near-tie caption, verbatim — including its em dash. Never reworded (Decision 6). */
export const NEAR_TIE_CAPTION =
  "Where two algorithms' scores are this close, the published data can't tell us which is really better. The threshold below is a judgement call, not a statistical test.";

/**
 * Explains the cold-start rule in plain language, in the site's established
 * register. Unlike `NEAR_TIE_CAPTION` (a fixed caption) and
 * `buildMethodologySentence`'s Brier list (a DERIVED figure), this is a
 * STATIC RULE — it transcribes no number and needs no republish to stay
 * accurate, so it renders unconditionally rather than gated on
 * `figures?.complete`.
 */
export const COLD_START_EXPLANATION =
  "When every robot in a match is playing its first-ever match, there's nothing to predict from. All three algorithms call it an even matchup, and the match is left out of the accuracy and Brier figures above rather than counted as a wrong guess.";

/**
 * The algorithm this note's Brier list and best-season clause describe —
 * SigmaScout's premier algorithm (Sigma Power Rating). Named for its ROLE
 * rather than hardcoded at each use, so the note follows the premier
 * algorithm instead of having to be rewritten around it.
 */
const PREMIER_ALGORITHM_ID = "spr";

interface SeasonBrier {
  readonly season: number;
  readonly text: string;
}

interface MethodologyFiguresBase {
  /** The seasons that yielded a premier-algorithm combined-view slice, ascending — the displayed set. */
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
 * For each season in `COMPARE_SEASONS` ascending, selects the premier
 * algorithm's own combined-view slice from that season's fetched artifact —
 * never another algorithm's, never another view's. Returns the COMPLETE form only when
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
      (candidate) => candidate.algorithmId === PREMIER_ALGORITHM_ID && candidate.season === season && candidate.compLevelView === "combined",
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

/** One clause per displayed season's Brier score, ascending by season. */
function buildBrierListSentence(seasonBriers: readonly SeasonBrier[]): string {
  const parts = seasonBriers.map((b) => `${b.season} ${b.text}`).join(", ");
  return `Brier by season: ${parts}.`;
}

/**
 * The methodology sentence — see this module's header comment for why it
 * makes no selection claim. Only ever called on the COMPLETE form: the
 * Brier list and the best-season clause both rest on a claim over all five
 * seasons and must not render from fewer, so the incomplete form has
 * nothing left to say here.
 */
function buildMethodologySentence(figures: MethodologyFiguresComplete): string {
  const brierList = buildBrierListSentence(figures.seasonBriers);
  const seasonCountWord = numberWord(figures.seasons.length);
  const bestClause = `${figures.bestSeason} is SPR's single best season of the ${seasonCountWord}.`;

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
      <p className="text-role-body text-[var(--color-text-muted)]">{COLD_START_EXPLANATION}</p>
      {figures?.complete === true && (
        <p className="text-role-body text-[var(--color-text-muted)]">{buildMethodologySentence(figures)}</p>
      )}
    </div>
  );
}
