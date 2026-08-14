/**
 * Aggregation by season, competition-level view, and tune/holdout label
 * (D-09, D-10, D-11), with exclusion accounting (this plan's must_haves:
 * "MUST NOT silently narrow the scored population"). This is the mechanism
 * that makes D-09's tune/holdout discipline structural: a slice's
 * `headlineEligible` flag is derived from its season, not remembered by an
 * operator, so a tune-season figure cannot be marked headline-eligible.
 */
import type { CompLevel } from "../core/algorithms/types.js";
import { scoreSet, type MatchOutcome, type ScoredPrediction } from "../core/scoring/brier.js";
import { calibrationBins, type CalibrationBin } from "../core/scoring/calibration.js";

export type SeasonLabel = "tune" | "holdout";

/** D-09's fixed split: the optimizer may only ever see these seasons. */
export const TUNE_SEASONS = [2022, 2023, 2024] as const;
/** D-09's fixed split: headline accuracy claims come exclusively from these seasons. */
export const HOLDOUT_SEASONS = [2025, 2026] as const;

/**
 * Labels a season tune or holdout per D-09's fixed split. Throws for a
 * season outside 2022-2026 rather than silently defaulting — an
 * unrecognized season has no defensible label to assign.
 */
export function seasonSplit(season: number): SeasonLabel {
  if ((HOLDOUT_SEASONS as readonly number[]).includes(season)) return "holdout";
  if ((TUNE_SEASONS as readonly number[]).includes(season)) return "tune";
  throw new Error(`seasonSplit: season ${season} is outside the covered range (2022-2026)`);
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
}

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
  seasonLabel: SeasonLabel;
  /** Only holdout-season slices are headline-eligible — this is D-09's discipline made structural. */
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

const EMPTY_EXCLUSIONS: ExclusionCounts = { offseason: 0, surrogateAffected: 0, missingResult: 0 };

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
  binCount?: number
): ScoreSlice[] {
  const algorithmIds = Array.from(new Set(predictions.map((p) => p.algorithmId))).sort();
  const seasons = Array.from(new Set(predictions.map((p) => p.season))).sort((a, b) => a - b);
  const slices: ScoreSlice[] = [];

  for (const algorithmId of algorithmIds) {
    const algorithmPredictions = predictions.filter((p) => p.algorithmId === algorithmId);

    for (const season of seasons) {
      const seasonPredictions = algorithmPredictions.filter((p) => p.season === season);
      if (seasonPredictions.length === 0) continue;
      const label = seasonSplit(season);

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
          scorable.push({ pRedWin: candidate.pRedWin, actualWinner: candidate.actualWinner });
        }

        const result = scoreSet(scorable);
        slices.push({
          algorithmId,
          season,
          seasonLabel: label,
          headlineEligible: label === "holdout",
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
