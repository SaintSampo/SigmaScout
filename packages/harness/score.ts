/**
 * Aggregation by season, competition-level view, and provenance-aware
 * headline eligibility (D-1/D-2, quick task 260903-n2o — supersedes quick
 * task 260903-krp's ordering-only rule, which itself superseded
 * D-09/D-10/D-11's retired fixed tune/holdout split), with exclusion
 * accounting (this plan's must_haves: "MUST NOT silently narrow the scored
 * population"). This is the mechanism that makes headline eligibility
 * structural: a slice's `headlineEligible` flag requires that the season
 * have enough distinct priors in the corpus's own season set (never a
 * hardcoded year list, never remembered by an operator). No published
 * algorithm carries tuned hyperparameters, so no selected-on clause remains.
 */
import type { CompLevel } from "../core/algorithms/types.js";
import { scoreSet, type MatchOutcome, type ScoredPrediction } from "../core/scoring/brier.js";
import { calibrationBins, type CalibrationBin } from "../core/scoring/calibration.js";
import { isValidPRedWin } from "../core/scoring/predictionValidity.js";

/**
 * D-2 (quick task 260903-krp): the minimum number of DISTINCT seasons that
 * must precede a season, within the run's own season set, for that season to
 * carry a headline accuracy claim. Two, not one —
 * `rolling-origin-hyperparameter-tuning`'s D-4 ruled that a single-season
 * prior is too thin to carry a headline claim; that ruling is preserved here
 * with only its inputs changed, from a fixed 2022-2026 corpus to whatever
 * seasons the run actually declares.
 */
export const MIN_PRIOR_SEASONS_FOR_HEADLINE = 2;

/**
 * D-1 (quick task 260903-n2o): whether `season` is headline-eligible, given
 * the full set of seasons in play (`corpusSeasons`). It needs at least
 * `MIN_PRIOR_SEASONS_FOR_HEADLINE` DISTINCT seasons in `corpusSeasons`
 * strictly less than `season` — a duplicated prior season must not buy
 * eligibility, and no year literal appears in the rule.
 *
 * The selected-on clause (a season an optimizer was fitted on is never
 * eligible) went with the last tuned algorithm: opr, epa and spr all carry
 * fixed constants, so the clause could never fire.
 *
 * Throws when `season` is not present in `corpusSeasons`, so a typo'd year
 * gets no defensible-looking answer.
 */
export function isHeadlineEligible(season: number, corpusSeasons: readonly number[]): boolean {
  if (!corpusSeasons.includes(season)) {
    throw new Error(
      `isHeadlineEligible: season ${season} is not present in the declared corpusSeasons (${corpusSeasons.join(", ") || "none"}) — a caller must declare the full season set it is scoring against, never ask about an undeclared season.`
    );
  }
  const distinctPriors = new Set(corpusSeasons.filter((s) => s < season));
  return distinctPriors.size >= MIN_PRIOR_SEASONS_FOR_HEADLINE;
}

/**
 * D-2: the sentinel a caller passes to `AggregateScoresOptions.eligibility`
 * when it does not read `headlineEligible` at all — never a permissive empty
 * map. Forces every produced slice's `headlineEligible` to `false`, the
 * strictest possible answer, so a caller with no provenance to support an
 * eligibility claim never manufactures one by omission.
 */
export const ELIGIBILITY_NOT_CLAIMED = "eligibility-not-claimed" as const;

/**
 * D-2: how `aggregateScores` answers `headlineEligible`. `"from-corpus-seasons"`
 * applies `isHeadlineEligible` against `corpusSeasons`; the
 * `ELIGIBILITY_NOT_CLAIMED` sentinel forces every slice to `false`.
 */
export type HeadlineEligibility = "from-corpus-seasons" | typeof ELIGIBILITY_NOT_CLAIMED;

/** D-11: every season is reported three ways. */
export type CompLevelView = "qualification" | "elimination" | "combined";

const COMP_LEVEL_VIEWS: readonly CompLevelView[] = ["qualification", "elimination", "combined"];

function matchesView(compLevel: CompLevel, view: CompLevelView): boolean {
  if (view === "combined") return true;
  if (view === "qualification") return compLevel === "qm";
  return compLevel !== "qm"; // elimination: ef, qf, sf, f
}

/** Reasons a candidate match is excluded from scoring entirely (never reaches `scoreSet`). */
export interface ExclusionCounts {
  /** D-06: excluded from scoring by default. */
  offseason: number;
  /** D-07: a surrogate's slot makes the prediction not attributable to a genuine rating. */
  surrogateAffected: number;
  /** No recorded outcome for this match. */
  missingResult: number;
  /**
   * D-06 / 01-REVIEW WR-05: a prediction whose `pRedWin` is non-finite or
   * outside the closed interval [0, 1] (`isValidPRedWin` from
   * `packages/core/scoring/predictionValidity.ts` — the SAME predicate
   * `assertValidPRedWin` uses at emission, so the two can never disagree
   * about what "valid" means). Excluded from `scoreSet`/`calibrationBins`
   * and counted here, rather than silently dropped or allowed to produce a
   * `NaN` Brier score. Bounded by `QUARANTINE_ABSOLUTE_LIMIT`/
   * `QUARANTINE_SHARE_LIMIT` below — see their doc comment for D-07's
   * rationale.
   */
  quarantined: number;
  /**
   * D-02 (quick task 260909-t5q): a match where all six robots are making
   * their corpus-global first appearance — no prior data exists for any of
   * them, so every algorithm predicts a forced tie (`pRedWin === 0.5`, see
   * `packages/core/scoring/coldStart.ts`) rather than a genuine call.
   * Deliberately DIVERGES from the D-Q3 no-call contract just above
   * (`brier.ts`'s header): D-Q3 counts an ordinary `pRedWin === 0.5`
   * prediction as a miss because the model HAD information and chose not to
   * use it to make a call; this bucket is keyed off the structural
   * `isColdStart` flag alone, never off the probability value, because here
   * there was no information available to call the match AT ALL. Excluded
   * from both `scoreSet` and `calibrationBins`, exactly like `offseason`/
   * `surrogateAffected`/`missingResult` above — counted, never silently
   * dropped.
   */
  coldStart: number;
}

/**
 * D-07: an unbounded quarantine could hollow out a season and produce a
 * Brier score that looks good precisely because the hard cases left — the
 * exact silent-narrowing failure this project exists to prevent (a
 * non-finite `pRedWin` usually means a team's state is already corrupt, so
 * one glitch can cascade across that team's remaining matches). Two bounds,
 * both required to trip the throw in `aggregateScores` below:
 *
 *   - `QUARANTINE_ABSOLUTE_LIMIT` tolerates a handful of genuine one-off
 *     anomalies without failing a whole season.
 *   - `QUARANTINE_SHARE_LIMIT` (applied only once `candidateCount` reaches
 *     `QUARANTINE_SHARE_MIN_POPULATION`) catches a cascade inside a small
 *     slice — an elimination-only view can be a few hundred matches, where
 *     the absolute limit alone would tolerate losing most of it. Below the
 *     population floor a single anomaly is not evidence of a cascade, so
 *     only the absolute limit governs.
 *
 * Measured malformed-prediction population as of this phase is 0, so no
 * currently-published figure is affected by these bounds existing.
 */
export const QUARANTINE_ABSOLUTE_LIMIT = 25;
/** See `QUARANTINE_ABSOLUTE_LIMIT`'s doc comment for the full D-07 rationale. */
export const QUARANTINE_SHARE_LIMIT = 0.005;
/** See `QUARANTINE_ABSOLUTE_LIMIT`'s doc comment for the full D-07 rationale. */
export const QUARANTINE_SHARE_MIN_POPULATION = 200;

/**
 * One prediction record as fed into aggregation. `actualWinner: null` means
 * no result is available yet (should not normally reach the harness, but
 * the exclusion accounting must not silently drop it if it does).
 *
 * D-24 additions: `algorithmId` identifies which algorithm produced this
 * prediction (D-20/D-22 — one harness run scores many algorithms over the
 * same match stream, so every prediction must be attributable back to its
 * algorithm). `predictedRedScore`/`predictedBlueScore` are the predicted
 * scores, kept rather than discarded after prediction — this is what lets a
 * published match row (`publish.ts`) show more than just win probability.
 */
export interface HarnessPredictionInput {
  matchKey: string;
  season: number;
  /**
   * D-T6 (quick task 260901-trz): the event this match belongs to, carried so
   * downstream consumers can BLOCK on it — matches inside one event share
   * teams, a field and a game state, so every interval and comparison this
   * project makes resamples whole events rather than individual matches
   * (`eventBootstrap.ts`; the match-level figure understates by 40%).
   *
   * `aggregateScores` below does NOT read this field, deliberately: it is
   * carried FOR downstream blocking, not consumed here, so a reader should
   * not go looking for a use inside this module. It is a required field
   * rather than an optional one because every producer already has
   * `r.match.eventKey` in hand (`replay.ts`'s `PredictionRecord`), and an
   * optional field would let a new call site silently degrade a blocked
   * bootstrap into a match-level one.
   *
   * Deriving this by splitting `matchKey` on `_` would work today and would
   * make the harness depend on a TBA key-naming convention it otherwise never
   * relies on — hence a real field, populated at the source.
   */
  eventKey: string;
  compLevel: CompLevel;
  algorithmId: string;
  pRedWin: number;
  predictedRedScore: number;
  predictedBlueScore: number;
  actualWinner: MatchOutcome | null;
  isOffseason: boolean;
  isSurrogateAffected: boolean;
  /**
   * D-01/D-02 (quick task 260909-t5q): true iff `packages/harness/replay.ts`'s
   * `WalkForwardSimulator` stamped this prediction's record as cold start —
   * the SINGLE source of truth every producer below reads rather than
   * re-deriving. REQUIRED, not optional with a `false` default: an optional
   * field would let a producer silently opt out of the unification D-01
   * exists to guarantee, and the typechecker would never catch it.
   */
  isColdStart: boolean;
}

export interface ScoreSlice {
  /** D-20/D-21: identifies which algorithm this slice's metrics belong to. */
  algorithmId: string;
  season: number;
  /**
   * D-2/D-3: whether this season has at least `MIN_PRIOR_SEASONS_FOR_HEADLINE`
   * distinct prior seasons within the run's own declared season set — the
   * single honest flag; the retired `seasonLabel` tune/holdout vocabulary is
   * deleted rather than kept as an alias. Meaningful at slice level, rather
   * than constant across a whole run, because `aggregateScores` also scores
   * selection-only seasons (e.g. 2019, 2020) that the tuner needs and
   * Compare never displays.
   */
  headlineEligible: boolean;
  compLevelView: CompLevelView;
  brierScore: number | null;
  winnerAccuracy: number | null;
  /** The Brier population for this slice (includes ties and no-calls). */
  scoredCount: number;
  tieCount: number;
  noCallCount: number;
  exclusionCounts: ExclusionCounts;
  /** `scoredCount + sum(exclusionCounts)` — every candidate match considered for this slice. */
  candidateCount: number;
  calibrationBins: CalibrationBin[];
}

/**
 * D-02 (quick task 260909-t5q): exported so `score.test.ts` can pin the
 * exact key set with a single `toEqual` against a literal — a future sixth
 * exclusion key added here without a matching test update fails loudly
 * rather than being silently skipped by a test that iterates a key list.
 */
export const EMPTY_EXCLUSIONS: ExclusionCounts = {
  offseason: 0,
  surrogateAffected: 0,
  missingResult: 0,
  quarantined: 0,
  coldStart: 0,
};

/**
 * `aggregateScores`' options. `corpusSeasons` is REQUIRED, with no default
 * and no fallback: `aggregateScores` cannot safely derive the season set
 * from `predictions` alone — a caller that already narrowed `predictions` to
 * one season (e.g. `publish.ts`'s per-season loop) would silently make
 * every slice ineligible under a self-derived rule, and every test would
 * still pass. Callers whose own scope is narrower than the run's full season
 * set (e.g. `promote.ts`'s bounded single-season slice) must say so
 * explicitly via this field, never by omission.
 *
 * `eligibility` (D-2, quick task 260903-n2o) is REQUIRED for the same
 * reason: a caller that does not read `headlineEligible` must say so with the
 * `ELIGIBILITY_NOT_CLAIMED` sentinel, the strictest answer, rather than
 * manufacturing eligibility by omission.
 */
export interface AggregateScoresOptions {
  /** The full set of seasons this run has in play — see the interface doc comment above. */
  readonly corpusSeasons: readonly number[];
  /** Whether slices claim headline eligibility at all — see the interface doc comment above. */
  readonly eligibility: HeadlineEligibility;
  readonly binCount?: number;
}

/**
 * Produces one slice per algorithm per season per competition-level view
 * (D-11: quals-only, elims-only, and combined; D-20/D-22: grouped by
 * `algorithmId` first, so one harness run scoring many algorithms over the
 * same shared stream still produces per-algorithm slices rather than
 * conflating them). Per D-06 offseason matches are excluded by default and
 * counted as such; D-07-affected predictions and missing results are
 * excluded the same explicit way. Every exclusion is counted, never
 * silently dropped.
 */
export function aggregateScores(
  predictions: readonly HarnessPredictionInput[],
  options: AggregateScoresOptions
): ScoreSlice[] {
  const { corpusSeasons, eligibility, binCount } = options;
  const algorithmIds = Array.from(new Set(predictions.map((p) => p.algorithmId))).sort();
  const seasons = Array.from(new Set(predictions.map((p) => p.season))).sort((a, b) => a - b);

  // A caller scoring a season it did not declare is narrowing the population
  // the headline-eligibility rule is measured against — that must be loud,
  // not silent (Finding 1: a self-derived rule would pass every test while
  // being wrong).
  const corpusSeasonSet = new Set(corpusSeasons);
  const undeclaredSeasons = seasons.filter((s) => !corpusSeasonSet.has(s));
  if (undeclaredSeasons.length > 0) {
    throw new Error(
      `aggregateScores: predictions include season(s) ${undeclaredSeasons.join(", ")} not present in the declared ` +
        `corpusSeasons (${[...corpusSeasonSet].sort((a, b) => a - b).join(", ") || "none"}) — a caller must declare ` +
        `the full season set it is scoring against, never narrow it silently.`
    );
  }

  const slices: ScoreSlice[] = [];

  for (const algorithmId of algorithmIds) {
    const algorithmPredictions = predictions.filter((p) => p.algorithmId === algorithmId);

    for (const season of seasons) {
      const seasonPredictions = algorithmPredictions.filter((p) => p.season === season);
      if (seasonPredictions.length === 0) continue;

      for (const view of COMP_LEVEL_VIEWS) {
        const candidates = seasonPredictions.filter((p) => matchesView(p.compLevel, view));
        const exclusionCounts: ExclusionCounts = { ...EMPTY_EXCLUSIONS };
        const scorable: ScoredPrediction[] = [];

        for (const candidate of candidates) {
          if (candidate.isOffseason) {
            exclusionCounts.offseason += 1;
            continue;
          }
          if (candidate.isSurrogateAffected) {
            exclusionCounts.surrogateAffected += 1;
            continue;
          }
          // D-02: placed AFTER surrogate and BEFORE missing-result, so every
          // existing exclusion's attribution stays byte-identical — a
          // candidate that is ALSO offseason or surrogate-affected is
          // attributed to that earlier branch, never double-counted here.
          // This is what makes a future republish's delta a pure transfer
          // out of scoredCount into this one bucket (Task 3's census).
          if (candidate.isColdStart) {
            exclusionCounts.coldStart += 1;
            continue;
          }
          if (candidate.actualWinner === null) {
            exclusionCounts.missingResult += 1;
            continue;
          }
          if (!isValidPRedWin(candidate.pRedWin)) {
            exclusionCounts.quarantined += 1;
            continue;
          }
          scorable.push({ pRedWin: candidate.pRedWin, actualWinner: candidate.actualWinner });
        }

        // D-07: bounded quarantine — a hollowed-out population must never
        // silently publish a flatteringly small Brier score. Never caught;
        // the run is meant to fail here rather than continue.
        const candidateCount = candidates.length;
        const quarantinedCount = exclusionCounts.quarantined;
        const exceedsAbsoluteLimit = quarantinedCount >= QUARANTINE_ABSOLUTE_LIMIT;
        const exceedsShareLimit =
          candidateCount >= QUARANTINE_SHARE_MIN_POPULATION &&
          quarantinedCount / candidateCount > QUARANTINE_SHARE_LIMIT;
        if (exceedsAbsoluteLimit || exceedsShareLimit) {
          const boundCrossed = exceedsAbsoluteLimit ? "QUARANTINE_ABSOLUTE_LIMIT" : "QUARANTINE_SHARE_LIMIT";
          throw new Error(
            `score: algorithm "${algorithmId}" season ${season} (${view}) quarantined ${quarantinedCount} of ${candidateCount} candidates, crossing ${boundCrossed} — refusing to publish a Brier score computed on a materially narrowed population (D-07)`
          );
        }

        const result = scoreSet(scorable);
        slices.push({
          algorithmId,
          season,
          headlineEligible: eligibility === ELIGIBILITY_NOT_CLAIMED ? false : isHeadlineEligible(season, corpusSeasons),
          compLevelView: view,
          brierScore: result.brierScore,
          winnerAccuracy: result.winnerAccuracy,
          scoredCount: result.count,
          tieCount: result.tieCount,
          noCallCount: result.noCallCount,
          exclusionCounts,
          candidateCount: candidates.length,
          calibrationBins: calibrationBins(scorable, binCount),
        });
      }
    }
  }

  return slices;
}
