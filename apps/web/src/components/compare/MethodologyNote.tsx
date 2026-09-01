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
 * The fixed evidential clause ("if the fixed split were flattering VPR,
 * holdout years would score visibly worse than tune years — they don't")
 * is the one piece that stays AUTHORED rather than derived, and it is
 * GUARDED rather than trusted: `MethodologyNote.test.tsx`'s evidential-clause
 * guard asserts this claim still holds against the five committed real
 * fixtures, so a re-measurement that inverted it fails the suite instead of
 * shipping a sentence the data no longer supports.
 *
 * This module DOES read `seasonLabel` — that is correct and D-08 says so
 * explicitly: the tune/holdout disclosure belongs in PROSE, and only in
 * prose. `AccuracyTable.tsx` continues to read neither `seasonLabel` nor
 * `headlineEligible`, and this note must never be mounted inside it.
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
  readonly tuneSeasons: readonly number[];
  readonly holdoutSeasons: readonly number[];
}

export interface MethodologyFiguresIncomplete extends MethodologyFiguresBase {
  readonly complete: false;
}

export interface MethodologyFiguresComplete extends MethodologyFiguresBase {
  readonly complete: true;
  readonly tuneBriers: readonly SeasonBrier[];
  readonly holdoutBriers: readonly SeasonBrier[];
  readonly bestSeason: number;
  readonly bestSeasonLabel: "tune" | "holdout";
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
 * algorithm's, never another view's. Partitions whatever seasons yielded a
 * slice by that slice's OWN `seasonLabel`. Returns the COMPLETE form only
 * when every one of the five seasons yielded a slice carrying a non-null
 * Brier; otherwise the INCOMPLETE form (season lists alone, built from
 * whatever labels are present); with no labelled slice at all, returns
 * `undefined` — a claim resting on all five seasons must not be made from
 * fewer.
 */
export function buildMethodologyFigures(
  artifactsByYear: ReadonlyMap<number, CompareArtifact>,
): MethodologyFigures | undefined {
  const entries: { season: number; seasonLabel: "tune" | "holdout"; brierScore: number | null }[] = [];
  for (const season of COMPARE_SEASONS) {
    const artifact = artifactsByYear.get(season);
    const slice = artifact?.slices.find(
      (candidate) => candidate.algorithmId === VPR_ALGORITHM_ID && candidate.season === season && candidate.compLevelView === "combined",
    );
    if (slice !== undefined) {
      entries.push({ season, seasonLabel: slice.seasonLabel, brierScore: slice.brierScore });
    }
  }

  if (entries.length === 0) return undefined;

  const tuneSeasons = entries.filter((e) => e.seasonLabel === "tune").map((e) => e.season);
  const holdoutSeasons = entries.filter((e) => e.seasonLabel === "holdout").map((e) => e.season);

  const complete = entries.length === COMPARE_SEASONS.length && entries.every((e) => e.brierScore !== null);
  if (!complete) {
    return { complete: false, tuneSeasons, holdoutSeasons };
  }

  const withBrier = entries as { season: number; seasonLabel: "tune" | "holdout"; brierScore: number }[];
  const tuneBriers = withBrier
    .filter((e) => e.seasonLabel === "tune")
    .map((e) => ({ season: e.season, text: formatBrierDisplay(e.brierScore) }));
  const holdoutBriers = withBrier
    .filter((e) => e.seasonLabel === "holdout")
    .map((e) => ({ season: e.season, text: formatBrierDisplay(e.brierScore) }));

  const best = withBrier.reduce((min, e) => (e.brierScore < min.brierScore ? e : min));

  return {
    complete: true,
    tuneSeasons,
    holdoutSeasons,
    tuneBriers,
    holdoutBriers,
    bestSeason: best.season,
    bestSeasonLabel: best.seasonLabel,
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

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildSplitDisclosureSentence(figures: MethodologyFigures): string {
  const tuneList = formatSeasonList(figures.tuneSeasons);
  const holdoutList = formatSeasonList(figures.holdoutSeasons);
  const holdoutVerb = pluralize(figures.holdoutSeasons.length, "is", "are");
  const holdoutNoun = pluralize(figures.holdoutSeasons.length, "season", "seasons");
  return `VPR's hyperparameters were tuned only on ${tuneList} ('tune' seasons); ${holdoutList} ${holdoutVerb} true holdout ${holdoutNoun} the tuning process never saw.`;
}

/**
 * The full D-08 methodology sentence. In the incomplete form, only the
 * split-disclosure sentence renders — the evidential clause, the figures
 * and the best-season clause all rest on a claim over all five seasons and
 * must not render from fewer.
 */
function buildMethodologySentence(figures: MethodologyFigures): string {
  const disclosure = buildSplitDisclosureSentence(figures);
  if (!figures.complete) return disclosure;

  const tuneBrierText = figures.tuneBriers.map((b) => b.text).join(" / ");
  const holdoutBrierText = figures.holdoutBriers.map((b) => b.text).join(" / ");
  const bestSeasonNoun = figures.bestSeasonLabel;
  const seasonCountWord = numberWord(COMPARE_SEASONS.length);

  const evidential =
    "If the fixed split were flattering VPR, holdout years would score visibly worse than tune years, and they don't.";
  const bestClause = `${figures.bestSeason}, a ${bestSeasonNoun} year, is VPR's single best season of the ${seasonCountWord}.`;

  return `${disclosure} ${evidential} Tune-season Brier: ${tuneBrierText}. Holdout-season Brier: ${holdoutBrierText}. ${bestClause}`;
}

export interface MethodologyNoteProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
}

export function MethodologyNote({ artifactsByYear }: MethodologyNoteProps) {
  const figures = buildMethodologyFigures(artifactsByYear);
  return (
    <div data-testid={METHODOLOGY_NOTE_TESTID} className="flex flex-col gap-[var(--spacing-xs)]">
      <p className="text-role-body text-[var(--color-text-muted)]">{NEAR_TIE_CAPTION}</p>
      {figures !== undefined && (
        <p className="text-role-body text-[var(--color-text-muted)]">{buildMethodologySentence(figures)}</p>
      )}
    </div>
  );
}
