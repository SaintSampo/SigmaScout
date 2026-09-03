/**
 * Aggregation by season, competition-level view, and origin-based headline
 * eligibility (D-2, quick task 260903-krp — supersedes D-09/D-10/D-11's
 * retired fixed tune/holdout split), with exclusion accounting (this plan's
 * must_haves: "MUST NOT silently narrow the scored population"). This is the
 * mechanism that makes headline eligibility structural: a slice's
 * `headlineEligible` flag is derived from the run's own season set — never
 * from a hardcoded year list and never remembered by an operator — so a
 * season with too few priors cannot be marked headline-eligible by mistake.
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
 * D-2/D-3: whether `season` is headline-eligible, given the full set of
 * seasons the run has in play (`corpusSeasons`). Counts DISTINCT seasons in
 * `corpusSeasons` strictly less than `season` and compares against
 * `MIN_PRIOR_SEASONS_FOR_HEADLINE` — a duplicated prior season in the input
 * must not buy eligibility. No year literal appears here: a hardcoded set
 * would be the retired guard wearing a new name, exactly the failure D-2
 * exists to prevent.
 *
 * D-3's payoff: on the 2019/2020-backfilled seven-season corpus (2019, 2020,
 * 2022-2026) this rule yields five headline-eligible seasons (2022-2026),
 * where the retired fixed split gave two (2025-2026 only) — and six once
 * 2027 plays. `rolling-origin-hyperparameter-tuning`'s D-4 verdict that
 * "2023 is not headline-eligible" is SUPERSEDED here — not because this rule
 * changed, but because the corpus it was evaluated against did: against a
 * 2022-2026-only corpus 2023 had a single prior (2022); with 2019/2020
 * backfilled it has three (2019, 2020, 2022).
 */
export function isHeadlineEligible(season: number, corpusSeasons: readonly number[]): boolean {
  const distinctPriors = new Set(corpusSeasons.filter((s) => s < season));
  return distinctPriors.size >= MIN_PRIOR_SEASONS_FOR_HEADLINE;
}

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
 * scores, kept rather than discarded after prediction — this is what lets
 * a later sidecar (plan 02-05's `predictions.ts`) and this plan's own
 * head-to-head report show more than just win probability.
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

const EMPTY_EXCLUSIONS: ExclusionCounts = { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 };

/**
 * `aggregateScores`' options. `corpusSeasons` is REQUIRED, with no default
 * and no fallback: `aggregateScores` cannot safely derive the season set
 * from `predictions` alone — a caller that already narrowed `predictions` to
 * one season (e.g. `publish.ts`'s per-season loop) would silently make
 * every slice ineligible under a self-derived rule, and every test would
 * still pass. Callers whose own scope is narrower than the run's full season
 * set (e.g. `promote.ts`'s bounded single-season slice) must say so
 * explicitly via this field, never by omission.
 */
export interface AggregateScoresOptions {
  /** The full set of seasons this run has in play — see the interface doc comment above. */
  readonly corpusSeasons: readonly number[];
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
  const { corpusSeasons, binCount } = options;
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
          headlineEligible: isHeadlineEligible(season, corpusSeasons),
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
