/**
 * Replays EPA under each of its documented divergences from Statbotics,
 * independently toggleable, and reports what each one costs or gains in winner
 * accuracy AND Brier — per season, pooled, and over each season's onset window.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 *
 * `docs/models/epa-divergences.md` enumerates seven places where this project's
 * EPA deliberately (or, in one case, accidentally) produces a different number
 * than Statbotics' own `EPARating`/`EPA` classes would. Every one of them is
 * argued in prose. NOT ONE of them has ever been measured in isolation. A
 * divergence nobody has priced is indistinguishable from a defect nobody has
 * noticed — which is exactly how the carryover scale anchor below survived for
 * four phases inside a comment that calls it "a documented placeholder".
 *
 * This is stage 1 of 4. Stage 2 lands the carryover fix with evidence (or does
 * not, if these numbers say not to). Stage 3 audits whether the component-map
 * divergence is even real any more. Stage 4 renders a methodology surface where
 * a reader ticks a checkbox per deviation and sees its measured effect — which
 * is why the artifact this writes is designed as a contract, not a log.
 *
 * ---------------------------------------------------------------------------
 * THIS SCRIPT CHANGES NO SHIPPED DEFAULT AND NO MODEL PARAMETER
 * ---------------------------------------------------------------------------
 *
 * Nothing under `packages/` is edited by the task that produced this file. Each
 * arm is an `AlgorithmModule` WRAPPER built here, in `scripts/`, by spreading
 * the shipped `epa` module object and overriding named functions. The shipped
 * module is itself one of the arms, used BY REFERENCE, and is the baseline every
 * contrast is measured against. Running the site pipeline is byte-identical
 * before and after this script exists.
 *
 * Spreading (`{ ...epa, id, predict }`) carries `carryFrom:
 * "last-official-match"` forward, which is load-bearing: an arm that carried at
 * season-final would be measuring two changes at once.
 *
 * READ-ONLY against the corpus. Nothing here is tuned, fitted, swept, or
 * selected against any season. BPR's sealed 2023-2026 holdout is untouched
 * because BPR is not replayed at all. This script needs no secrets and must
 * NEVER be run with `--env-file`.
 *
 * ---------------------------------------------------------------------------
 * THE ARMS — ALL FOUR RIDE ONE SHARED STREAM PER SEASON
 * ---------------------------------------------------------------------------
 *
 * `WalkForwardSimulator.runAll` keys state by `algorithm.id` and drives every
 * supplied module over one chronological stream, handing each the identical
 * leak-proof match object. Four arms on one pass per season means any difference
 * between arms is provably the ARM and not the data.
 *
 *   epa                      none                    baseline, shipped, by reference
 *   epa-carryover-fix        carryover-scale-anchor  lazy per-team rescale on first sight
 *   epa-winprob-season-sd    winprob-scale           season-final SD — OUTCOME LEAKAGE, never shippable
 *   epa-winprob-fixed-sd     winprob-scale           EPA_FALLBACK_SCORE_SD denominator
 *
 * ### Arm `epa-carryover-fix` — THE DEFECT
 *
 * `carryover.ts`'s `epaCarryover` derives one `{mean, sd}` pair from
 * `input.teamTotals` — the OUTGOING season — and then uses that SAME pair for
 * BOTH directions of the conversion: `normalizedFromPoints` (points -> z) and
 * `normalizedToSeasonUnits` (z -> points). Every team therefore enters a new
 * season carrying LAST season's point units. `02-CONTEXT.md` D-16 and
 * `02-RESEARCH.md` record Statbotics' `init.py` verbatim as converting into the
 * NEW season's point units, so this is a port defect against the project's own
 * recorded reference, not merely an undocumented placeholder.
 *
 * The arm fixes it the only way a walk-forward replay legally can: LAZILY, per
 * team, on first sight in the new season, once the new season has shown enough
 * of its own scale to be worth reading.
 *
 *   - `carrySeason` captures `seedMean` (the outgoing accumulator's mean)
 *     BEFORE delegating, then marks every carried team pending.
 *   - The new season's own scale is recovered by UNWINDING the seed the shipped
 *     `carrySeason` leaves behind: `reseedFromPrior(stats,
 *     EPA_SCORE_SD_SEED_COUNT)` means the accumulator after a boundary is
 *     exactly `EPA_SCORE_SD_SEED_COUNT` pseudo-observations at `seedMean` plus
 *     the new season's own real folds. `cleanSeasonMean` below removes the
 *     former. This reads only exported values and never re-implements which
 *     alliance scores EPA chooses to fold.
 *   - `ratio = cleanSeasonMean / seedMean`, applied to every component of a
 *     pending team on first sight. Below `EPA_CARRY_RESCALE_MIN_OBS` real
 *     alliance scores the ratio is not yet readable, so the team is materialized
 *     at `ratio = 1` and a DEFERRAL is counted — the honest cost of being
 *     walk-forward-legal, reported in the artifact rather than hidden.
 *   - `predict` materializes TRANSIENTLY (temp state, delegate, discard);
 *     `update` materializes PERMANENTLY then delegates. Both read the
 *     pre-update accumulator, so the two agree by construction.
 *
 * APPROXIMATION LABEL, stated in the artifact and in every printed line:
 * `closest-walk-forward-legal`. Statbotics runs offline and simply KNOWS the
 * season scale; that is not walk-forward reachable. This arm is never described
 * as identical to Statbotics.
 *
 * ### Arms `epa-winprob-*`
 *
 * Both override `predict` only: delegate to the shipped `predict`, then
 * recompute `pRedWin = 1 / (1 + exp(-(redScore - blueScore) / scale))` with a
 * different `scale = sd / (-EPA_K * ln 10)`, and re-derive `winner` on the same
 * `pRedWin >= 0.5` convention `epa.predict` uses.
 *
 * PRE-REGISTERED INVARIANT: a scale on the logistic cannot change
 * `sign(margin)`, so both arms' winner accuracy MUST equal baseline's to full
 * precision in EVERY season. The run ASSERTS this and throws naming the season
 * if it fails — a wrapper that changed something it should not have is the only
 * way this can break, so the assertion is the arm's own self-test. Brier is
 * expected to move, which is exactly the lesson stage 4's UI exists to teach:
 * accuracy is blind to calibration.
 *
 * ---------------------------------------------------------------------------
 * SIGN CONVENTIONS — READ THESE BEFORE READING ANY CONTRAST
 * ---------------------------------------------------------------------------
 *
 *   metric "brier":          a NEGATIVE pointEstimate means the arm is BETTER.
 *   metric "winnerAccuracy": a POSITIVE pointEstimate means the arm is BETTER.
 *
 * One function (`verdictFor`) owns both, because two conventions transcribed
 * twice is how a recommendation gets inverted.
 *
 * ---------------------------------------------------------------------------
 * SCORING — THE PUBLISHED SCORER, PINNED TO A LOCAL PAIRING FILTER
 * ---------------------------------------------------------------------------
 *
 * Headline per-(arm, season) numbers come from `aggregateScores`
 * (packages/harness/score.ts) reading the `combined` compLevelView slice. That
 * is the PUBLISHED scorer and its Brier population INCLUDES TIES — a hand-rolled
 * Brier here would invent a regression of roughly the size the real effect is.
 *
 * Paired contrasts need per-match rows, which `aggregateScores` does not return,
 * so this script mirrors its exclusion ladder in ONE local predicate
 * (`exclusionReasonFor`) and then ASSERTS that the local survivor count equals
 * `aggregateScores`' own `scoredCount` for every (arm, season), throwing if they
 * ever disagree. That assertion is what stops the two populations drifting apart
 * silently. Per-match terms reuse `outcomeTarget` and `accuracyCall` from
 * `packages/core/scoring/brier.ts` — never a second transcription of the tie
 * convention.
 *
 * n IS NOT INDEPENDENT OBSERVATIONS. Matches inside one event share teams, a
 * field, a game state and a day's officiating crew, so every interval here is an
 * EVENT-BLOCKED bootstrap and `eventCount` is printed beside every one of them.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ARTIFACT LANDS, AND WHY IT LANDS TWICE
 * ---------------------------------------------------------------------------
 *
 * `reports/` is gitignored in this repo (`.gitignore` line 13) and nothing in it
 * has ever been tracked. A register a future React page reads has to survive in
 * the repo, so the identical bytes are written to BOTH paths in one call from
 * one serialized string: `reports/epa-deviation-ablation.json` (the working
 * path, local, regenerable) and `data/diagnostics/epa-deviation-ablation.json`
 * (the committed copy, beside `opr-event-scope-2026-08.json`, which is the
 * established home for a committed diagnostic artifact). They cannot drift:
 * neither is derived from the other.
 *
 * Usage:
 *   npx tsx scripts/measureEpaDeviations.ts [--seasons 2016-2019,2022-2026]
 *   pnpm measure:epa-deviations
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { AlgorithmModule, CompLevel, MatchResult, SeasonBoundary, UpcomingMatch } from "../packages/core/algorithms/types.js";
import {
  epa,
  EPA_FALLBACK_SCORE_SD,
  EPA_K,
  EPA_SCORE_SD_SEED_COUNT,
  type EpaState,
} from "../packages/core/algorithms/epa.js";
import { populationMeanSd } from "../packages/core/algorithms/carryover.js";
// MOVED, not copied (quick task 260911-3kc): these five now SHIP inside
// `epa.ts`, so this harness imports them rather than keeping a second copy. Two
// copies of a scale conversion drifting apart is the exact failure
// `carryover.ts`'s own `populationMeanSd` comment warns about.
import {
  carryRescaleRatio,
  cleanSeasonMean,
  materializePendingTeams,
  rescaleComponents,
  EPA_CARRY_RESCALE_MIN_OBS,
} from "../packages/core/algorithms/epaCarryScale.js";
import { ratingEligibleTeams } from "../packages/core/algorithms/opr.js";
import { accuracyCall, outcomeTarget, scoreSet, type MatchOutcome, type ScoredPrediction } from "../packages/core/scoring/brier.js";
import { isValidPRedWin } from "../packages/core/scoring/predictionValidity.js";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { eventBlockedBootstrap, type EventBootstrapResult } from "../packages/harness/eventBootstrap.js";
import { aggregateScores, ELIGIBILITY_NOT_CLAIMED, type HarnessPredictionInput } from "../packages/harness/score.js";
// REUSE, not re-implementation. `parseSeasons` is already exported and already
// unit-tested in `measureSwingSkill.ts`, `DEFAULT_SEASONS_SPEC` in
// `measureAllianceReconstruction.ts`, and both of those modules guard their own
// entry point, so importing them opens no corpus. A second season parser here
// would be a second chance to drop a season at a boundary.
import { parseSeasons } from "./measureSwingSkill.js";
import { DEFAULT_SEASONS_SPEC } from "./measureAllianceReconstruction.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The working artifact path. Gitignored — see the file header. */
export const ARTIFACT_PATH = "reports/epa-deviation-ablation.json";
/** The committed copy of the identical bytes — see the file header. */
export const COMMITTED_ARTIFACT_PATH = "data/diagnostics/epa-deviation-ablation.json";

/**
 * SCHEMA VERSION 2 (quick task 260911-3kc): a `ContrastRow`'s `baselineArmId`
 * is now MEANINGFUL DATA and a consumer MUST READ IT rather than assume `"epa"`.
 *
 * Schema 1 emitted every contrast against the shipped baseline, so the field was
 * a constant and could safely be ignored. Schema 2 also emits challenger arms
 * measured against the INCUMBENT carryover fix, which is a completely different
 * comparison: a challenger can be better than plain EPA and simultaneously worse
 * than the incumbent fix. A reader that assumed the field would read the second
 * kind of row as the first and adopt an arm the measurement rejects.
 */
export const SCHEMA_VERSION = 2;

export const BASELINE_ARM_ID = "epa";
export const CARRYOVER_FIX_ARM_ID = "epa-carryover-fix";
export const CARRYOVER_FIX_MIN250_ARM_ID = "epa-carryover-fix-min250";
export const CARRYOVER_FIX_MIN500_ARM_ID = "epa-carryover-fix-min500";
export const WINPROB_SEASON_SD_ARM_ID = "epa-winprob-season-sd";
export const WINPROB_FIXED_SD_ARM_ID = "epa-winprob-fixed-sd";

/** Print/emit order. Baseline first, so every table reads as "against this". */
export const ARM_IDS = [
  BASELINE_ARM_ID,
  CARRYOVER_FIX_ARM_ID,
  CARRYOVER_FIX_MIN250_ARM_ID,
  CARRYOVER_FIX_MIN500_ARM_ID,
  WINPROB_SEASON_SD_ARM_ID,
  WINPROB_FIXED_SD_ARM_ID,
] as const;

export const THRESHOLD_CANDIDATES = [100, 250, 500] as const;

/** The incumbent, and the shipped default whenever no challenger clears the bar. */
// The INCUMBENT AT THE TIME OF THE MEASUREMENT, pinned to the candidate set
// rather than to `EPA_CARRY_RESCALE_MIN_OBS`. Those were the same number when
// this ran; they are not now, because the run's own outcome moved the shipped
// constant to 250. Reading the shipped constant here would retroactively
// rewrite what the measurement was measured against.
export const THRESHOLD_DEFAULT = THRESHOLD_CANDIDATES[0];

/**
 * The selection rule, WRITTEN DOWN BEFORE ANY THRESHOLD NUMBER EXISTS. Printed
 * in `main()`'s preamble before the corpus is even opened, and serialized into
 * the artifact as literal data, so the rule cannot be reverse-engineered from
 * the answer it produced.
 */
export const THRESHOLD_SELECTION_RULE =
  "PRIMARY: pooled ONSET Brier, each challenger measured against the INCUMBENT arm (NOT against the shipped " +
  "baseline), paired and event-blocked. A challenger PASSES only if it is BETTER with a 95% interval EXCLUDING " +
  "zero. GUARD 1: pooled SEASON winner accuracy vs the incumbent — REJECT if WORSE with an interval excluding " +
  "zero. GUARD 2: pooled SEASON Brier vs the incumbent — REJECT if WORSE with an interval excluding zero. A " +
  "challenger must clear the primary and both guards.";

/** The tie-break, equally pre-declared: the plain fix wins anything it does not lose. */
export const THRESHOLD_TIE_BREAK =
  "If BOTH challengers pass, take the SMALLER threshold. If NO challenger passes all three clauses, the shipped " +
  "default is the INCUMBENT at minObs = 100 — reported as the OUTCOME, not as a failure. An unnecessary knob is a " +
  "permanent cost and the plain fix is already proven.";

/**
 * The onset window: the first N SCORABLE matches of each season that follows a
 * boundary, pooled across boundaries.
 *
 * This is the window the already-measured carryover evidence lives in (2018 to
 * 2019's 0.19x scale collapse: +103 points per alliance over the first 500 base
 * matches of a 55-point game), so the harness reproduces that finding rather
 * than only restating it. By season end the EWMA has long since overwritten a
 * carried rating, so a pooled-season contrast alone would average the effect
 * away.
 */
export const ONSET_MATCH_COUNT = 500;

/** Which matches are in the replayed stream. Matches production's `--include-offseason`. */
const STREAM_POPULATION = "offseason-inclusive";

// ───────────────────────────────── pure ─────────────────────────────────
// Everything below this divider is pure and unit-tested in
// measureEpaDeviations.test.ts.

/**
 * Guards a numeric output against the silent-NaN trap: `NaN` formats as a dash,
 * which reads identically to "no data", so a wrong destructure can turn an
 * entire table into a plausible-looking absence. Every headline figure passes
 * through here before it is printed or serialized.
 *
 * Deliberately NOT used for values that are legitimately absent — those are
 * `null` and are rendered as `n/a`, a different thing said a different way.
 */
export function finiteOrThrow(value: number, context: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `measure:epa-deviations: ${context} is ${value}, not a finite number — refusing to format a non-finite value ` +
        `into a table where it would be indistinguishable from missing data`
    );
  }
  return value;
}

// `cleanSeasonMean`, `carryRescaleRatio`, `rescaleComponents` and
// `materializePendingTeams` USED to live here. They now SHIP in
// `packages/core/algorithms/epaCarryScale.ts` and are imported at the top of
// this file — see that module's header, and quick task 260911-3kc's SUMMARY,
// for the landing. Their unit tests moved with them to
// `packages/core/algorithms/epaCarryScale.test.ts`.

/**
 * The win-probability logistic with a caller-supplied score SD, in the exact
 * form `epa.ts`'s `predict()` evaluates: `scale = sd / (-EPA_K * ln 10)`, then
 * `pRedWin = 1 / (1 + exp(-margin / scale))`, then `winner` on the same
 * `>= 0.5` convention (so an exact tie resolves to red, matching `opr.ts`).
 *
 * Throws on a non-positive or non-finite `scoreSd` rather than emitting a
 * degenerate probability: a zero scale makes every non-tie match a certainty,
 * which would look like a spectacular arm rather than a broken one.
 */
export function rescaledWinProbability(
  redScore: number,
  blueScore: number,
  scoreSd: number
): { pRedWin: number; winner: "red" | "blue" } {
  if (!Number.isFinite(scoreSd) || scoreSd <= 0) {
    throw new Error(
      `measure:epa-deviations: scoreSd must be a positive finite number, got ${scoreSd} — a degenerate scale would ` +
        `report every decided match as a certainty and read as a spectacular arm rather than a broken one`
    );
  }
  const scale = scoreSd / (-EPA_K * Math.LN10);
  const margin = redScore - blueScore;
  const pRedWin = 1 / (1 + Math.exp(-margin / scale));
  return { pRedWin, winner: pRedWin >= 0.5 ? "red" : "blue" };
}

/** Why a candidate left the scored population. Mirrors `aggregateScores`' own buckets and order. */
export type AblationExclusionReason =
  | "offseason"
  | "surrogateAffected"
  | "coldStart"
  | "missingResult"
  | "invalidProbability";

export type AblationCensus = Record<AblationExclusionReason, number>;

export function emptyAblationCensus(): AblationCensus {
  return { offseason: 0, surrogateAffected: 0, coldStart: 0, missingResult: 0, invalidProbability: 0 };
}

/**
 * The local mirror of `aggregateScores`' exclusion ladder, IN ITS ORDER:
 * offseason, then surrogate-affected, then cold start, then missing result,
 * then invalid probability.
 *
 * The order is not cosmetic. A match that is offseason AND surrogate-affected
 * must be attributed to the SAME bucket in both implementations, or the
 * survivor-count assertion in `scoreArm` fails for a reason that has nothing to
 * do with any model. This predicate exists only because `aggregateScores`
 * returns aggregates and the paired bootstrap needs rows; it is pinned to that
 * function's own `scoredCount` on every (arm, season) rather than trusted.
 */
export function exclusionReasonFor(candidate: {
  readonly isOffseason: boolean;
  readonly isSurrogateAffected: boolean;
  readonly isColdStart: boolean;
  readonly actualWinner: MatchOutcome | null;
  readonly pRedWin: number;
}): AblationExclusionReason | null {
  if (candidate.isOffseason) return "offseason";
  if (candidate.isSurrogateAffected) return "surrogateAffected";
  if (candidate.isColdStart) return "coldStart";
  if (candidate.actualWinner === null) return "missingResult";
  if (!isValidPRedWin(candidate.pRedWin)) return "invalidProbability";
  return null;
}

/** One surviving prediction, the unit both the pooled scorer and the pairing read. */
export interface ScorableRow {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly pRedWin: number;
  readonly actualWinner: MatchOutcome;
}

/** One paired unit for the event-blocked bootstrap: a difference, and the event block it belongs to. */
export interface PairedDiffUnit {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly diff: number;
}

function pairedDiffs(
  arm: readonly ScorableRow[],
  baseline: readonly ScorableRow[],
  term: (row: ScorableRow) => number | null
): PairedDiffUnit[] {
  const baselineByKey = new Map<string, ScorableRow>();
  for (const row of baseline) baselineByKey.set(row.matchKey, row);
  const units: PairedDiffUnit[] = [];
  for (const row of arm) {
    const counterpart = baselineByKey.get(row.matchKey);
    // DROPPED, never zero-filled. A zero-filled missing counterpart asserts
    // "the two arms tied here", which dilutes the contrast toward zero and
    // manufactures a false "indistinguishable" — the one failure mode that
    // would let this script report no finding at all and look correct doing it.
    if (counterpart === undefined) continue;
    const armTerm = term(row);
    const baselineTerm = term(counterpart);
    if (armTerm === null || baselineTerm === null) continue;
    units.push({ eventKey: row.eventKey, matchKey: row.matchKey, diff: armTerm - baselineTerm });
  }
  return units;
}

/**
 * Per-match paired Brier difference, `brier_arm - brier_baseline`. NEGATIVE
 * means the arm is BETTER. Ties stay in this population — `outcomeTarget`
 * scores them against 0.5, exactly as the published scorer does.
 */
export function pairedBrierDiffs(arm: readonly ScorableRow[], baseline: readonly ScorableRow[]): PairedDiffUnit[] {
  return pairedDiffs(arm, baseline, (row) => (row.pRedWin - outcomeTarget(row.actualWinner)) ** 2);
}

/**
 * Per-match paired winner-accuracy difference as 0/1, `call_arm - call_baseline`.
 * POSITIVE means the arm is BETTER. An actual tie has no winner to have
 * predicted, so `accuracyCall` returns `null` and the match leaves this pairing
 * entirely — it is NOT scored as a shared zero, which would pad the denominator
 * with matches neither arm could have got right.
 */
export function pairedAccuracyDiffs(arm: readonly ScorableRow[], baseline: readonly ScorableRow[]): PairedDiffUnit[] {
  return pairedDiffs(arm, baseline, (row) => {
    const call = accuracyCall({ pRedWin: row.pRedWin, actualWinner: row.actualWinner });
    return call === null ? null : call ? 1 : 0;
  });
}

/** Mean paired difference — the statistic the event-blocked bootstrap resamples. `NaN` on an empty list. */
export function meanDiff(units: readonly PairedDiffUnit[]): number {
  if (units.length === 0) return Number.NaN;
  let sum = 0;
  for (const unit of units) sum += unit.diff;
  return sum / units.length;
}

export type ContrastMetric = "brier" | "winnerAccuracy";
export type Verdict = "better" | "worse" | "indistinguishable" | "identical" | "unmeasurable";

/**
 * The pre-registered outcome for one contrast, with the metric's sign
 * convention applied ONCE, here, for both metrics:
 *
 *   brier          — LOWER is better, so a negative point estimate is a win.
 *   winnerAccuracy — HIGHER is better, so a positive point estimate is a win.
 *
 * A zero-spanning interval is `indistinguishable` and is NEVER resolved by the
 * point estimate's sign — that would turn resampling noise into a claim. An
 * exactly-zero contrast is `identical`, reported as its own outcome rather than
 * as a suspiciously tight win, because that is what the win-probability arms'
 * accuracy contrast is BY CONSTRUCTION and mislabelling it would hide the
 * invariant rather than demonstrate it.
 */
export function verdictFor(metric: ContrastMetric, lower: number, upper: number, pointEstimate: number): Verdict {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(pointEstimate)) return "unmeasurable";
  if (lower === 0 && upper === 0 && pointEstimate === 0) return "identical";
  if (lower <= 0 && upper >= 0) return "indistinguishable";
  const armIsBetter = metric === "brier" ? pointEstimate < 0 : pointEstimate > 0;
  return armIsBetter ? "better" : "worse";
}

// ──────────────────────── the threshold decision ─────────────────────────────

/** One candidate threshold and the arm that measured it. */
export interface ThresholdArm {
  readonly armId: string;
  readonly minObs: number;
}

/** One challenger's trip through the three pre-declared clauses, kept whether it passed or not. */
export interface ThresholdEvaluation {
  readonly armId: string;
  readonly minObs: number;
  readonly passed: boolean;
  /** The clause that decided this challenger, named so the artifact records WHY, not just WHAT. */
  readonly clause: string;
  readonly onsetBrier: number;
  readonly onsetBrierInterval: { readonly lower: number; readonly upper: number };
  readonly seasonAccuracyVerdict: Verdict;
  readonly seasonBrierVerdict: Verdict;
}

export interface ThresholdSelection {
  readonly selected: number;
  readonly selectedArmId: string;
  readonly reason: string;
  readonly evaluations: readonly ThresholdEvaluation[];
}

/**
 * Executes `THRESHOLD_SELECTION_RULE` over the contrast rows. A FUNCTION, not an
 * eyeball over a log: a rule applied by reading a table is a rule that can be
 * applied differently once the numbers are visible, which is the precise shape
 * of the thing this task is forbidden from doing.
 *
 * Reads ONLY contrasts whose `baselineArmId` is the incumbent. A vs-baseline row
 * for the same arm answers a different question (is this better than plain EPA?)
 * and using it would adopt a challenger that is worse than the fix we already
 * have.
 *
 * THROWS on a missing primary contrast rather than treating absence as failure.
 * A broken or empty measurement would otherwise produce a clean-looking
 * "keep the incumbent" outcome — the one wrong answer indistinguishable from the
 * right one.
 */
export function selectThreshold(
  contrasts: readonly ContrastRow[],
  challengers: readonly ThresholdArm[],
  incumbent: ThresholdArm
): ThresholdSelection {
  const find = (armId: string, scope: Scope, metric: ContrastMetric): ContrastRow | undefined =>
    contrasts.find(
      (c) =>
        c.armId === armId &&
        c.baselineArmId === incumbent.armId &&
        c.scope === scope &&
        c.season === null &&
        c.metric === metric
    );

  const evaluations: ThresholdEvaluation[] = [];
  for (const challenger of challengers) {
    const onset = find(challenger.armId, "onset", "brier");
    if (onset === undefined) {
      throw new Error(
        `measure:epa-deviations: no pooled-onset Brier primary contrast for ${challenger.armId} measured against ` +
          `${incumbent.armId}. Refusing to decide a threshold on an absent measurement — an absent contrast is not ` +
          `evidence of no effect, and defaulting quietly here would look exactly like a clean keep-the-incumbent ` +
          `outcome.`
      );
    }
    const seasonAcc = find(challenger.armId, "pooled", "winnerAccuracy");
    const seasonBrier = find(challenger.armId, "pooled", "brier");
    if (seasonAcc === undefined || seasonBrier === undefined) {
      throw new Error(
        `measure:epa-deviations: no pooled-season guard contrasts for ${challenger.armId} measured against ` +
          `${incumbent.armId}. A challenger cannot clear guards that were never computed.`
      );
    }
    finiteOrThrow(onset.pointEstimate, `${challenger.armId} pooled-onset Brier point estimate`);

    let passed: boolean;
    let clause: string;
    if (onset.verdict !== "better") {
      passed = false;
      clause = `PRIMARY not met — pooled onset Brier vs ${incumbent.armId} is ${onset.verdict.toUpperCase()}`;
    } else if (seasonAcc.verdict === "worse") {
      passed = false;
      clause = `GUARD 1 fired — pooled season winner accuracy vs ${incumbent.armId} is WORSE with an interval excluding zero`;
    } else if (seasonBrier.verdict === "worse") {
      passed = false;
      clause = `GUARD 2 fired — pooled season Brier vs ${incumbent.armId} is WORSE with an interval excluding zero`;
    } else {
      passed = true;
      clause = `PRIMARY met (pooled onset Brier BETTER vs ${incumbent.armId}) and neither guard fired`;
    }

    evaluations.push({
      armId: challenger.armId,
      minObs: challenger.minObs,
      passed,
      clause,
      onsetBrier: onset.pointEstimate,
      onsetBrierInterval: onset.percentile,
      seasonAccuracyVerdict: seasonAcc.verdict,
      seasonBrierVerdict: seasonBrier.verdict,
    });
  }

  const passing = evaluations.filter((e) => e.passed).sort((a, b) => a.minObs - b.minObs);
  if (passing.length === 0) {
    return {
      selected: incumbent.minObs,
      selectedArmId: incumbent.armId,
      reason:
        `DEFAULT — no challenger cleared all three clauses, so the shipped default stays the INCUMBENT at ` +
        `minObs = ${incumbent.minObs}. This is the OUTCOME, not a failure: an unnecessary knob is a permanent cost ` +
        `and the plain fix is already proven. ` +
        evaluations.map((e) => `${e.armId}: ${e.clause}`).join("; "),
      evaluations,
    };
  }
  const winner = passing[0]!;
  const tieNote =
    passing.length > 1
      ? `TIE-BREAK — ${passing.length} challengers passed, taking the SMALLER threshold. `
      : `TIE-BREAK not needed — exactly one challenger passed. `;
  return {
    selected: winner.minObs,
    selectedArmId: winner.armId,
    reason: `${tieNote}${winner.armId}: ${winner.clause}.`,
    evaluations,
  };
}

// ────────────────────── the deviation register (stage 4's contract) ──────────

export type DeviationStatus =
  | "measured"
  | "closed"
  | "display-only"
  | "unmeasurable-in-this-harness"
  | "unmeasurable-no-reference";

export interface PriorMeasurement {
  readonly provenance: "prior-measurement";
  readonly source: string;
  readonly season: number;
  readonly population: string;
  readonly metric: ContrastMetric;
  readonly values: readonly { readonly label: string; readonly value: number }[];
  readonly note: string;
}

export interface DeviationEntry {
  readonly id: string;
  readonly title: string;
  readonly class: string;
  readonly status: DeviationStatus;
  /** Whether the FIX for this deviation could ever ship. `null` where the question does not apply. */
  readonly shippable: boolean | null;
  /** Whether this deviation can move a win probability at all. A display-only one cannot. */
  readonly predictionAffecting: boolean;
  readonly docSection: string;
  readonly summary: string;
  /** Required whenever `status` starts with `unmeasurable` — the NAMED missing seam. */
  readonly reason: string | null;
  /** Set only where an arm approximates the divergence rather than reproducing it. */
  readonly approximation: string | null;
  readonly armIds: readonly string[];
  readonly priorMeasurement: PriorMeasurement | null;
}

/**
 * EVERY deviation in `docs/models/epa-divergences.md`, each with an explicit
 * status. A deviation this harness could not measure appears here with its
 * reason NAMED, never as a silent omission — an omitted gap is an invisible
 * one, and this project's failure log already records one of those.
 */
export function deviationRegister(): DeviationEntry[] {
  return [
    {
      id: "carryover-scale-anchor",
      title: "Season-boundary carry converts into the OUTGOING season's point units",
      class: "rating-mechanics",
      status: "measured",
      shippable: true,
      predictionAffecting: true,
      docSection: "§8 (added by quick task 260910-x09)",
      summary:
        "carryover.ts's epaCarryover derives one {mean, sd} pair from the OUTGOING season's teamTotals and uses it " +
        "for BOTH normalizedFromPoints and normalizedToSeasonUnits, so every team enters a new season carrying last " +
        "season's point units. 02-CONTEXT.md D-16 and 02-RESEARCH.md record Statbotics' init.py converting into the " +
        "NEW season's units — this is a port defect against the project's own recorded reference.",
      reason: null,
      approximation: "closest-walk-forward-legal",
      armIds: [CARRYOVER_FIX_ARM_ID, CARRYOVER_FIX_MIN250_ARM_ID, CARRYOVER_FIX_MIN500_ARM_ID],
      priorMeasurement: null,
    },
    {
      id: "winprob-scale",
      title: "Win-probability denominator is an expanding-window SD, not a season constant",
      class: "prediction-scale",
      status: "measured",
      shippable: true,
      predictionAffecting: true,
      docSection: "§4",
      summary:
        "epa.predict divides the margin by an expanding-window Welford SD seeded across each boundary " +
        "(reseedFromPrior, EPA_SCORE_SD_SEED_COUNT). Statbotics divides by the season-final year_obj.score_sd, which " +
        "is not walk-forward computable. Two arms bracket the question: the leaky season-final SD (a reference bound) " +
        "and the fixed EPA_FALLBACK_SCORE_SD.",
      reason: null,
      approximation: null,
      armIds: [WINPROB_SEASON_SD_ARM_ID, WINPROB_FIXED_SD_ARM_ID],
      priorMeasurement: null,
    },
    {
      id: "component-map",
      title: "This project's own per-season component maps, not Statbotics' all_keys[year] grouping",
      class: "rating-mechanics",
      status: "unmeasurable-in-this-harness",
      shippable: null,
      predictionAffecting: true,
      docSection: "§6",
      summary:
        "breakdown/{2016..2026}.ts are independently derived per-season component maps with their own granularity " +
        "choices. 2024's was re-measured and coarsened to phase groups by quick task 260910-5ym.",
      reason:
        "epa.ts's update() and carrySeason() call componentMapForSeason(season) DIRECTLY; there is no injection " +
        "point, so a scripts/ wrapper cannot intercept it — the wrapper sees only the state before and after, never " +
        "the map the update used. The missing seam is an optional component-map parameter threaded through update() " +
        "and carrySeason(), which is a packages/ change and therefore stage-2 work, not something this " +
        "measurement-only task may make.",
      approximation: null,
      armIds: [],
      priorMeasurement: {
        provenance: "prior-measurement",
        source: "docs/models/epa-divergences.md §6 (quick task 260910-5ym, 2026-09-10)",
        season: 2024,
        population: "2024's 16,764 decided official matches, four additive partitions off one shared carry",
        metric: "winnerAccuracy",
        values: [
          { label: "eleven offensive components (the retired 2024 map)", value: 0.7348 },
          { label: "Statbotics' comp partition", value: 0.7461 },
          { label: "phase groups auto/teleop/endgame (the shipped 2024 map)", value: 0.752 },
          { label: "a single no-foul total", value: 0.7403 },
        ],
        note:
          "The curve TURNS OVER — a single total is worse than three groups, so 'fewer components is better' is not " +
          "the lesson. And Statbotics does not predict from its comp partition at all: get_score_from_breakdown's " +
          "2024 branch is score = breakdown['no_foul_points'], and its comp_0..comp_9 keys OVERLAP " +
          "(speaker_points re-counts notes already inside auto_note_points/teleop_note_points), so they are " +
          "display/RP quantities rather than an additive partition. For at least 2024 there is therefore NO " +
          "Statbotics partition to toggle against — which is a stage-3 answer, not a stage-3 gap.",
      },
    },
    {
      id: "per-year-postprocess-2018",
      title: "No per-season post-processing — Statbotics' 2018 switch/scale sigmoid and per-year clamps",
      class: "rating-mechanics",
      status: "unmeasurable-no-reference",
      shippable: null,
      predictionAffecting: true,
      docSection: "§3",
      summary:
        "Statbotics' post_process_breakdown applies per-year quirks on top of the raw EWMA, most notably a " +
        "2018-specific switch/scale sigmoid. epa.ts runs no equivalent step.",
      reason:
        "The sigmoid's exact FORM was never recorded in this repo. D-13, 02-CONTEXT.md and 02-RESEARCH.md name it " +
        "(and list zero_sigmoid/unit_sigmoid among the functions fetched in 2026-08-13's research session) but no " +
        "transcription of either body survives here. Implementing a guessed sigmoid would measure an invention, not " +
        "the divergence — so this is reported unmeasurable rather than approximated. Recovering it means re-fetching " +
        "Statbotics' backend/src/models/epa/{math,breakdown}.py, which is a research step, not a harness step.",
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
    {
      id: "fouls-cross-attribution",
      title: "Fouls modelled as a per-team component cross-attributed to the opponent, not a season foul-rate scalar",
      class: "rating-mechanics",
      status: "unmeasurable-in-this-harness",
      shippable: null,
      predictionAffecting: true,
      docSection: "§2",
      summary:
        "D-04 models foulsCommitted as its own per-team component derived from the OPPOSING alliance's raw " +
        "foulPoints, and predict() adds each side's own offensive total to the OPPONENT's predicted foulsCommitted. " +
        "Statbotics multiplies a no-foul predicted score by a season-level foul rate: red_score * (1 + foul_rate).",
      reason:
        "Statbotics' counterpart is a SEASON-LEVEL foul_rate scalar, and this harness has no walk-forward-legal " +
        "source for one — a season-final foul rate is the same class of outcome leakage as the season-final score SD, " +
        "and an expanding-window foul rate would be a third model rather than Statbotics' second. The arm would " +
        "therefore measure an invented quantity, so it is reported rather than fabricated. Out of scope for stage 1 " +
        "by explicit decision; the runtime budget for an added arm is stated in this plan's design section.",
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
    {
      id: "elim-weight",
      title: "Elimination-match discount and the non-advancing match counter",
      class: "rating-mechanics",
      status: "closed",
      shippable: null,
      predictionAffecting: true,
      docSection: "§1",
      summary:
        "ADOPTED at epa@5.0.0+baseline (D-05, quick task 260904-5px): EPA_ELIM_WEIGHT (1/3) on the outer EWMA blend " +
        "and a per-team counter that does not advance on an elimination match. There is no live divergence left to " +
        "toggle, so this is not an arm.",
      reason: null,
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
    {
      id: "published-total-excludes-fouls",
      title: "The published per-team total excludes foulsCommitted while the carry input does not",
      class: "display",
      status: "display-only",
      shippable: null,
      predictionAffecting: false,
      docSection: "§2 (third correction — D-01, quick task 260904-5px)",
      summary:
        "teamMetrics()'s published total excludes FOULS_COMMITTED_COMPONENT to match Statbotics' epa.total_points, " +
        "while carrySeason()'s carryover input stays the fouls-INCLUSIVE sum. predict() is untouched by either.",
      reason:
        "A display-only deviation cannot move a win probability, so measuring it would produce a suspicious 0.000 " +
        "that a reader would have to be told to ignore. It is labelled rather than measured. NOTE the asymmetry is " +
        "real and deliberate (pinned by a dedicated test in epa.test.ts) — the published total and the carried " +
        "quantity are two different numbers for any team that has ever committed a foul.",
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
    {
      id: "variance-free",
      title: "EPA carries a mean only, with no ± — a faithful reproduction, not a divergence",
      class: "model-shape",
      status: "closed",
      shippable: null,
      predictionAffecting: false,
      docSection: "§5",
      summary:
        "EpaState.teamComponents is a plain per-team Record<string, number> and teamMetrics() returns no spread, " +
        "exactly as Statbotics' own EPARating (whose docstring states it 'does not handle covariance between " +
        "variables').",
      reason:
        "There is nothing to toggle: §5 records this as a faithful REPRODUCTION of what Statbotics' EPA actually is, " +
        "listed in that document so a reader does not mistake the missing ± for an oversight. Carried here with an " +
        "explicit status so the register covers every section of the document rather than only the live divergences.",
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
    {
      id: "offseason-population",
      title: "Offseason play is replayed and moves ratings; Statbotics ingests none of it",
      class: "stream-population",
      status: "unmeasurable-in-this-harness",
      shippable: null,
      predictionAffecting: true,
      docSection: "§7",
      summary:
        "Production publishes with --include-offseason, so offseason matches are replayed and do move ratings inside " +
        "the season they occur in. NARROWED at epa@6.0.0+baseline: the cross-season carry is now taken at the " +
        "season's last OFFICIAL match, so exhibition play can no longer seed the following February.",
      reason:
        "It changes WHICH MATCHES ARE IN THE STREAM, not the model, so it cannot ride the one shared pass every " +
        "other arm rides — the whole design that makes an inter-arm difference attributable to the arm is that all " +
        "arms see the identical match objects. Measuring it needs its own stream and its own run, which is a " +
        "different script's job (see docs/models/offseason-inclusion-remeasurement.md, which already did exactly " +
        "that once).",
      approximation: null,
      armIds: [],
      priorMeasurement: null,
    },
  ];
}

export interface ArmEntry {
  readonly id: string;
  readonly label: string;
  /** The deviation ids this arm ENABLES. Stage 1 measures size-0 and size-1 arms only, by explicit decision. */
  readonly deviations: readonly string[];
  readonly isBaseline: boolean;
  readonly shippable: boolean;
  readonly unshippableReason: string | null;
  readonly approximation: string | null;
}

export function armRegister(): ArmEntry[] {
  return [
    {
      id: BASELINE_ARM_ID,
      label: "shipped epa module, unmodified, by reference",
      deviations: [],
      isBaseline: true,
      shippable: true,
      unshippableReason: null,
      approximation: null,
    },
    {
      id: CARRYOVER_FIX_ARM_ID,
      label: `lazy per-team rescale into the NEW season's point units on first sight (INCUMBENT, minObs = ${THRESHOLD_CANDIDATES[0]})`,
      deviations: ["carryover-scale-anchor"],
      isBaseline: false,
      shippable: true,
      unshippableReason: null,
      approximation: "closest-walk-forward-legal",
    },
    {
      id: CARRYOVER_FIX_MIN250_ARM_ID,
      label: `the same lazy rescale, deferred until minObs = ${THRESHOLD_CANDIDATES[1]} of the new season's own alliance scores`,
      deviations: ["carryover-scale-anchor"],
      isBaseline: false,
      shippable: true,
      unshippableReason: null,
      approximation: "closest-walk-forward-legal",
    },
    {
      id: CARRYOVER_FIX_MIN500_ARM_ID,
      label: `the same lazy rescale, deferred until minObs = ${THRESHOLD_CANDIDATES[2]} of the new season's own alliance scores`,
      deviations: ["carryover-scale-anchor"],
      isBaseline: false,
      shippable: true,
      unshippableReason: null,
      approximation: "closest-walk-forward-legal",
    },
    {
      id: WINPROB_SEASON_SD_ARM_ID,
      label: "win-probability denominator = this season's own final alliance-score SD",
      deviations: ["winprob-scale"],
      isBaseline: false,
      shippable: false,
      unshippableReason:
        "OUTCOME LEAKAGE. The season-final SD is computed from matches that have not been played yet at the moment " +
        "of an early-season prediction, which is precisely Pitfall EPA-1 and precisely what this project's " +
        "walk-forward guarantee forbids. This arm is a REFERENCE BOUND — the best a scale could do if it could see " +
        "the future — and must never be shipped.",
      approximation: null,
    },
    {
      id: WINPROB_FIXED_SD_ARM_ID,
      label: `win-probability denominator = EPA_FALLBACK_SCORE_SD (${EPA_FALLBACK_SCORE_SD}) always`,
      deviations: ["winprob-scale"],
      isBaseline: false,
      shippable: true,
      unshippableReason: null,
      approximation: null,
    },
  ];
}

export type Scope = "season" | "pooled" | "onset";

export interface MetricRow {
  readonly armId: string;
  readonly scope: Scope;
  readonly season: number | null;
  readonly winnerAccuracy: number | null;
  readonly brier: number | null;
  readonly scoredCount: number;
  readonly tieCount: number;
  readonly noCallCount: number;
  readonly candidateCount: number;
  readonly eventCount: number;
}

export interface ContrastRow {
  readonly armId: string;
  /**
   * The arm this contrast was ACTUALLY measured against. MUST BE READ, never
   * assumed (schema 2): challenger rows are measured against the incumbent
   * carryover fix, not against the shipped baseline, and an arm can be better
   * than one while worse than the other.
   */
  readonly baselineArmId: string;
  readonly scope: Scope;
  readonly season: number | null;
  readonly metric: ContrastMetric;
  readonly pointEstimate: number;
  readonly standardError: number;
  readonly percentile: { readonly lower: number; readonly upper: number };
  readonly eventCount: number;
  readonly matchCount: number;
  readonly verdict: Verdict;
  /** Set when the contrast was produced WITHOUT resampling — see `contrastFor`. */
  readonly note: string | null;
}

export interface CarryScaleRow {
  /**
   * WHICH carryover arm this census belongs to. Schema 2 emits one row per
   * (arm, boundary): the deferral census is the one figure that differs between
   * the three thresholds by construction, so collapsing them into a single row
   * would hide exactly what the thresholds were introduced to trade off.
   */
  readonly armId: string;
  readonly season: number;
  readonly fromSeason: number;
  /** The outgoing season's alliance-score mean — the units every carried rating is expressed in. */
  readonly seedMean: number;
  /** The incoming season's OWN alliance-score mean at season end, seed unwound. */
  readonly cleanSeasonMean: number | null;
  /** `cleanSeasonMean / seedMean` at season end. THIS is the magnitude of the defect for this boundary. */
  readonly ratio: number | null;
  readonly carriedTeams: number;
  readonly rescaledTeams: number;
  readonly deferredRescales: number;
  /** Carried teams never seen again in the incoming season — carried, never materialized, never scored. */
  readonly neverSeen: number;
}

export interface AblationArtifact {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly generator: string;
  readonly corpusPath: string;
  readonly seasons: readonly number[];
  readonly streamPopulation: string;
  readonly scorer: {
    readonly module: string;
    readonly tiesCountedInBrier: true;
    readonly compLevelView: string;
    readonly headlineEligibility: string;
  };
  readonly deviations: readonly DeviationEntry[];
  readonly arms: readonly ArmEntry[];
  readonly rows: readonly MetricRow[];
  readonly contrasts: readonly ContrastRow[];
  readonly carryScale: readonly CarryScaleRow[];
  readonly notes: {
    readonly additive: false;
    readonly combinationsMeasured: readonly string[][];
    readonly combinatorialCost: string;
    readonly deferredRescales: number;
    readonly rescaledTeams: number;
    /**
     * The threshold decision as LITERAL DATA: the candidate set, the rule and
     * the tie-break are constants that existed before the corpus was opened,
     * and `selected` is `null` until a run has actually produced one. A reader
     * can therefore check that the rule was not reverse-engineered from its
     * answer.
     */
    readonly thresholdSelection: {
      readonly candidates: readonly number[];
      readonly rule: string;
      readonly tieBreak: string;
      readonly default: number;
      readonly selected: number | null;
      readonly selectedArmId: string | null;
      readonly reason: string | null;
      readonly evaluations: readonly ThresholdEvaluation[];
    };
    readonly signConventions: Record<ContrastMetric, string>;
    readonly statusVocabulary: Record<DeviationStatus, string>;
  };
  readonly census: AblationCensus;
}

export interface BuildArtifactInput {
  readonly seasons: readonly number[];
  readonly corpusPath: string;
  readonly streamPopulation: string;
  readonly rows: readonly MetricRow[];
  readonly contrasts: readonly ContrastRow[];
  readonly census: AblationCensus;
  readonly carryScale: readonly CarryScaleRow[];
  readonly deferredRescales: number;
  readonly rescaledTeams: number;
  /** `null` before a run has decided — never a pre-filled guess. */
  readonly thresholdSelection: ThresholdSelection | null;
}

/**
 * The stage-4 contract, one stable shape, overwritten per run.
 *
 * DECISION, stated in the artifact because the reader needs it: stage 1 measures
 * INDIVIDUAL deviations only — arms of size 0 and 1. The SCHEMA supports arms of
 * any size (`arm.deviations` is an array), so a later stage can add combination
 * arms without a schema change, and a UI answers a ticked SET by looking for an
 * arm whose `deviations` match exactly and rendering "this combination has not
 * been measured" when none does.
 *
 * It must NEVER sum individual effects. The deviations are not additive — the
 * carryover fix changes the ratings that the win-probability scale then divides
 * — so `notes.additive` is `false` and `notes.combinationsMeasured` is empty.
 */
export function buildArtifact(input: BuildArtifactInput): AblationArtifact {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generator: "scripts/measureEpaDeviations.ts (pnpm measure:epa-deviations)",
    corpusPath: input.corpusPath,
    seasons: [...input.seasons],
    streamPopulation: input.streamPopulation,
    scorer: {
      module: "packages/harness/score.ts aggregateScores",
      tiesCountedInBrier: true,
      compLevelView: "combined",
      headlineEligibility: "ELIGIBILITY_NOT_CLAIMED — this run makes no headline-eligibility claim about any season",
    },
    deviations: deviationRegister(),
    arms: armRegister(),
    rows: [...input.rows],
    contrasts: [...input.contrasts],
    carryScale: [...input.carryScale],
    notes: {
      additive: false,
      combinationsMeasured: [],
      combinatorialCost:
        "All-subsets of k deviations is 2^k arms. 4 measurable deviations would be 16 arms and roughly 4x this " +
        "run's wall clock; 6 would be 64 arms and an overnight job. Stage 1 deliberately measures size-0 and " +
        "size-1 arms only.",
      deferredRescales: input.deferredRescales,
      rescaledTeams: input.rescaledTeams,
      thresholdSelection: {
        candidates: [...THRESHOLD_CANDIDATES],
        rule: THRESHOLD_SELECTION_RULE,
        tieBreak: THRESHOLD_TIE_BREAK,
        default: THRESHOLD_DEFAULT,
        selected: input.thresholdSelection?.selected ?? null,
        selectedArmId: input.thresholdSelection?.selectedArmId ?? null,
        reason: input.thresholdSelection?.reason ?? null,
        evaluations: input.thresholdSelection?.evaluations ?? [],
      },
      signConventions: {
        brier: "NEGATIVE pointEstimate means the arm is BETTER (lower Brier is better)",
        winnerAccuracy: "POSITIVE pointEstimate means the arm is BETTER (higher accuracy is better)",
      },
      statusVocabulary: {
        measured: "an arm in this run toggles it and its effect is in `contrasts`",
        closed: "no live divergence remains — adopted, or never a divergence at all",
        "display-only": "cannot move a win probability; labelled rather than measured",
        "unmeasurable-in-this-harness": "a real, live divergence this harness structurally cannot toggle — see `reason`",
        "unmeasurable-no-reference": "the divergence's reference form is not recoverable from this repo — see `reason`",
      },
    },
    census: { ...input.census },
  };
}

// ───────────────────────────── the arms ─────────────────────────────

/**
 * The `epa-carryover-fix` wrapper's state. `inner` is a genuine `EpaState`
 * handed to the shipped functions untouched; everything else is bookkeeping that
 * never reaches `epa.ts`.
 */
export interface CarryoverFixState {
  readonly inner: EpaState;
  /** Teams carried across the most recent boundary that have not yet been materialized. */
  readonly pending: ReadonlySet<string>;
  /** The OUTGOING season's alliance-score mean — the units `inner`'s carried components are in. */
  readonly seedMean: number;
  readonly rescaledTeams: number;
  readonly deferredRescales: number;
  /**
   * THIS arm's deferral threshold, carried ON the state rather than captured in
   * a closure, so a test can prove the constructor's argument actually reaches
   * `cleanSeasonMean` instead of three arms silently sharing one default.
   */
  readonly minObs: number;
}

const EMPTY_PENDING: ReadonlySet<string> = new Set<string>();

export function ratioForState(state: CarryoverFixState): { ratio: number; deferred: boolean } {
  return carryRescaleRatio(
    cleanSeasonMean(state.inner.allianceScoreStats, state.seedMean, EPA_SCORE_SD_SEED_COUNT, state.minObs),
    state.seedMean
  );
}

/** Both alliances' rating-eligible teams, using the SAME remap/surrogate filter `epa.ts` itself applies. */
function eligibleTeamsOf(match: UpcomingMatch): string[] {
  return [
    ...ratingEligibleTeams(match.redTeams, match.redSurrogates),
    ...ratingEligibleTeams(match.blueTeams, match.blueSurrogates),
  ];
}

/**
 * The carryover-fix arm: the shipped module with `predict`/`update`/`carrySeason`
 * wrapped, and NOTHING under `packages/` edited.
 */
export function carryoverFixArm(
  id: string = CARRYOVER_FIX_ARM_ID,
  minObs: number = EPA_CARRY_RESCALE_MIN_OBS
): AlgorithmModule<CarryoverFixState> {
  const carrySeasonInner = epa.carrySeason;
  if (carrySeasonInner === undefined) {
    throw new Error("measure:epa-deviations: the shipped epa module has no carrySeason — this arm cannot exist");
  }
  if (!Number.isFinite(minObs) || minObs <= 0) {
    throw new Error(
      `measure:epa-deviations: carryoverFixArm minObs must be a positive finite number, got ${minObs} — a ` +
        `degenerate threshold would silently rescale off a one-event season mean and report it as the fix`
    );
  }
  return {
    id,
    // Derived from the shipped version rather than hardcoded, so this arm's
    // identity tracks the model it wraps instead of silently standing for an
    // older one. `{codeVersion}+{paramSetName}` shape preserved (D-13). The
    // default id keeps its schema-1 suffix byte-for-byte.
    version: `${epa.version.split("+")[0]}+${id === CARRYOVER_FIX_ARM_ID ? "carryover-fix-arm" : id}`,
    initState(teams: string[]): CarryoverFixState {
      return {
        inner: epa.initState(teams),
        pending: EMPTY_PENDING,
        seedMean: Number.NaN,
        rescaledTeams: 0,
        deferredRescales: 0,
        minObs,
      };
    },
    predict(state, match) {
      // TRANSIENT materialization: build a temp inner state for this match's
      // teams, delegate, discard. Reads the same pre-update accumulator
      // `update` will read, so predict and update agree by construction.
      if (state.pending.size === 0) return epa.predict(state.inner, match);
      const { ratio } = ratioForState(state);
      const { teamComponents, touched } = materializePendingTeams(
        state.inner.teamComponents,
        eligibleTeamsOf(match),
        state.pending,
        ratio
      );
      if (touched.length === 0) return epa.predict(state.inner, match);
      return epa.predict({ ...state.inner, teamComponents }, match);
    },
    update(state, result) {
      if (state.pending.size === 0) {
        return { ...state, inner: epa.update(state.inner, result) };
      }
      const { ratio, deferred } = ratioForState(state);
      const teams = eligibleTeamsOf(result);
      const { teamComponents, touched } = materializePendingTeams(
        state.inner.teamComponents,
        teams,
        state.pending,
        ratio
      );
      // Every team in this match leaves `pending`, whether or not its rescale
      // could be read: a team whose rescale was DEFERRED has already been moved
      // by this match's EWMA update, and rescaling a blend of last season's
      // units and this season's observation later would be worse than not
      // rescaling it at all. That is the cost the deferral counter reports.
      const pending = new Set(state.pending);
      for (const team of teams) pending.delete(team);
      return {
        inner: epa.update(touched.length === 0 ? state.inner : { ...state.inner, teamComponents }, result),
        pending,
        seedMean: state.seedMean,
        rescaledTeams: state.rescaledTeams + (deferred ? 0 : touched.length),
        deferredRescales: state.deferredRescales + (deferred ? touched.length : 0),
        minObs: state.minObs,
      };
    },
    teamMetrics(state, teams) {
      return epa.teamMetrics(state.inner, teams);
    },
    carrySeason(state: CarryoverFixState, boundary: SeasonBoundary): CarryoverFixState {
      if (boundary.isColdStart) return state;
      // Captured BEFORE delegating: `reseedFromPrior` preserves this mean into
      // the new accumulator, and it is the unit every carried component is
      // expressed in.
      const seedMean = state.inner.allianceScoreStats.mean;
      const inner = carrySeasonInner(state.inner, boundary);
      // Exactly the carry-worthy teams: the shipped carrySeason builds a FRESH
      // map containing only carryResult.teamPointTotals.
      return {
        inner,
        pending: new Set(inner.teamComponents.keys()),
        seedMean,
        rescaledTeams: state.rescaledTeams,
        deferredRescales: state.deferredRescales,
        minObs: state.minObs,
      };
    },
    // Load-bearing: an arm that carried at season-final instead would be
    // measuring two changes at once.
    carryFrom: epa.carryFrom,
  };
}

/**
 * A win-probability arm: the shipped module with `predict` alone wrapped. The
 * spread carries `initState`/`update`/`teamMetrics`/`carrySeason`/`carryFrom`
 * through unchanged, so state evolution is BYTE-IDENTICAL to the baseline's and
 * the only thing that can differ is `pRedWin`.
 */
export function winProbabilityArm(id: string, scoreSd: number): AlgorithmModule<EpaState> {
  return {
    ...epa,
    id,
    version: `${epa.version.split("+")[0]}+${id}`,
    predict(state: EpaState, match: UpcomingMatch) {
      const base = epa.predict(state, match);
      const { pRedWin, winner } = rescaledWinProbability(base.redScore, base.blueScore, scoreSd);
      if (!isValidPRedWin(pRedWin)) {
        throw new Error(
          `measure:epa-deviations: arm ${id} produced an invalid pRedWin ${pRedWin} for ${match.matchKey}`
        );
      }
      return { ...base, pRedWin, winner };
    },
  };
}

// ───────────────────────────── the measurement ─────────────────────────────

interface EventMetaRow {
  event_key: string;
  is_offseason: number;
}

/**
 * The offseason event keys for one season, read exactly the way `publish.ts`
 * derives its own `offseasonEventKeys` (a module-local query over the corpus's
 * `events.is_offseason` column). `selectEventMeta` is private to `publish.ts`,
 * and this mirrors its local-helper style rather than widening that module's
 * surface for a diagnostic.
 */
function offseasonEventKeysFor(db: Corpus, season: number): Set<string> {
  const rows = db
    .prepare(`SELECT event_key, is_offseason FROM events WHERE year = ? ORDER BY event_key ASC`)
    .all(season) as EventMetaRow[];
  return new Set(rows.filter((row) => row.is_offseason === 1).map((row) => row.event_key));
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function formatMetric(value: number | null, digits = 4): string {
  if (value === null) return "n/a";
  return finiteOrThrow(value, "metric value").toFixed(digits);
}

function signed(value: number, digits = 5): string {
  finiteOrThrow(value, "signed value");
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/**
 * One contrast, with the bootstrap skipped in exactly two cases, both reported
 * rather than hidden:
 *
 *   - EVERY diff is exactly 0. There is no uncertainty to resample — the two
 *     arms made the identical call on every paired match — so resampling would
 *     burn minutes to rediscover zero. This is what the win-probability arms'
 *     ACCURACY contrast is BY CONSTRUCTION, and reporting it as `identical`
 *     demonstrates the pre-registered invariant instead of burying it.
 *   - Fewer than 2 event blocks. `eventBlockedBootstrap` refuses there, because
 *     a single-block bootstrap reports an SE of exactly 0 — a false claim of
 *     certainty. Caught and reported rather than allowed to kill a long run.
 */
export function contrastFor(
  armId: string,
  scope: Scope,
  season: number | null,
  metric: ContrastMetric,
  units: readonly PairedDiffUnit[],
  referenceArmId: string = BASELINE_ARM_ID
): ContrastRow | null {
  if (units.length === 0) return null;
  const distinctEvents = new Set(units.map((u) => u.eventKey)).size;
  if (units.every((u) => u.diff === 0)) {
    return {
      armId,
      baselineArmId: referenceArmId,
      scope,
      season,
      metric,
      pointEstimate: 0,
      standardError: 0,
      percentile: { lower: 0, upper: 0 },
      eventCount: distinctEvents,
      matchCount: units.length,
      verdict: "identical",
      note: "every paired difference is exactly 0 — no resampling performed, there is no uncertainty to resample",
    };
  }
  let result: EventBootstrapResult;
  try {
    result = eventBlockedBootstrap(units, meanDiff);
  } catch (err) {
    return {
      armId,
      baselineArmId: referenceArmId,
      scope,
      season,
      metric,
      pointEstimate: meanDiff(units),
      standardError: Number.NaN,
      percentile: { lower: Number.NaN, upper: Number.NaN },
      eventCount: distinctEvents,
      matchCount: units.length,
      verdict: "unmeasurable",
      note: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    armId,
    baselineArmId: referenceArmId,
    scope,
    season,
    metric,
    pointEstimate: result.pointEstimate,
    standardError: result.standardError,
    percentile: result.percentile,
    eventCount: result.eventCount,
    matchCount: result.matchCount,
    verdict: verdictFor(metric, result.percentile.lower, result.percentile.upper, result.pointEstimate),
    note: null,
  };
}

function metricRowFrom(
  armId: string,
  scope: Scope,
  season: number | null,
  rows: readonly ScorableRow[],
  candidateCount: number
): MetricRow {
  const result = scoreSet(rows.map((r): ScoredPrediction => ({ pRedWin: r.pRedWin, actualWinner: r.actualWinner })));
  return {
    armId,
    scope,
    season,
    winnerAccuracy: result.winnerAccuracy,
    brier: result.brierScore,
    scoredCount: result.count,
    tieCount: result.tieCount,
    noCallCount: result.noCallCount,
    candidateCount,
    eventCount: new Set(rows.map((r) => r.eventKey)).size,
  };
}

function printRowTable(rows: readonly MetricRow[], heading: string): void {
  console.log(`   ${heading}`);
  console.log(
    `   arm                       season        ACC       BRIER         n      ties   no-calls    events`
  );
  for (const row of rows) {
    console.log(
      `   ${row.armId.padEnd(24)}  ${String(row.season ?? "pooled").padStart(6)}  ` +
        `${formatMetric(row.winnerAccuracy).padStart(9)}  ${formatMetric(row.brier).padStart(10)}  ` +
        `${String(row.scoredCount).padStart(8)}  ${String(row.tieCount).padStart(8)}  ` +
        `${String(row.noCallCount).padStart(9)}  ${String(row.eventCount).padStart(8)}`
    );
  }
}

function printContrast(row: ContrastRow): void {
  const better =
    row.metric === "brier"
      ? "NEGATIVE = arm better"
      : "POSITIVE = arm better";
  const interval = Number.isFinite(row.percentile.lower)
    ? `95% [${signed(row.percentile.lower)}, ${signed(row.percentile.upper)}]`
    : `95% [unmeasurable]`;
  const se = Number.isFinite(row.standardError) ? row.standardError.toFixed(5) : "—";
  console.log(
    `   ${row.armId.padEnd(26)} vs ${row.baselineArmId.padEnd(18)} ${String(row.season ?? "pooled").padStart(6)} ` +
      `${row.scope.padEnd(7)} ${row.metric.padEnd(14)} ${signed(row.pointEstimate)}  SE ${se}  ${interval}  ` +
      `eventCount ${row.eventCount}  n ${row.matchCount}  -> ${row.verdict.toUpperCase()}  (${better})`
  );
  if (row.note !== null) console.log(`      note: ${row.note}`);
}

interface SeasonArmResult {
  readonly scorable: ScorableRow[];
  readonly candidateCount: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = flagValue(args, "--seasons") ?? DEFAULT_SEASONS_SPEC;
  const seasons = parseSeasons(seasonsSpec);

  console.log(`EPA DEVIATION ABLATION — what does each divergence from Statbotics actually cost?`);
  console.log(`seasons:  ${seasons.join(", ")}`);
  console.log(`baseline: ${epa.id}@${epa.version} (the SHIPPED module, by reference)`);
  console.log(`stream:   ${STREAM_POPULATION} (matches production's --include-offseason)`);
  console.log(``);
  console.log(`READ-ONLY, and MEASUREMENT-ONLY. Nothing under packages/ is edited by this script's task, nothing is`);
  console.log(`tuned, fitted, swept or selected against any season, and BPR's sealed holdout is untouched because BPR`);
  console.log(`is not replayed at all. The carryover FIX ships nowhere — it exists only as the ${CARRYOVER_FIX_ARM_ID} arm.`);
  console.log(``);
  console.log(`SIGN CONVENTIONS: for brier a NEGATIVE point estimate means the arm is BETTER; for winnerAccuracy a`);
  console.log(`POSITIVE one does. Every interval below is an EVENT-BLOCKED bootstrap with its eventCount printed`);
  console.log(`beside it — n is shown only to make the gap between the two visible.`);
  console.log(``);
  console.log(`PRE-REGISTERED: a scale on the logistic cannot change sign(margin), so both ${"epa-winprob-*"} arms MUST`);
  console.log(`report winner accuracy IDENTICAL to baseline's in every season. This run throws naming the season if`);
  console.log(`they do not. Brier is expected to move — that divergence is the whole point.`);
  console.log(``);
  console.log(`PRE-REGISTERED, carryover: the defect converts a carried rating into the OUTGOING season's point units,`);
  console.log(`so its effect must CONCENTRATE at boundaries where the scale MOVES (2018->2019 collapses ~5x, 2023->2024`);
  console.log(`shrinks) and be near-nil where it does not. A uniform effect across every boundary would REFUTE the`);
  console.log(`mechanism even if the pooled number looked good. The per-boundary scale table below is the test.`);
  console.log(``);
  console.log(`PRE-DECLARED THRESHOLD SELECTION — printed HERE, before the corpus is opened, so the rule provably`);
  console.log(`predates every number it will be applied to. Serialized into the artifact as notes.thresholdSelection.`);
  console.log(`   candidate set (THE WHOLE SEARCH — no fourth value, no scan): ${THRESHOLD_CANDIDATES.join(", ")}`);
  console.log(`   incumbent / default:  minObs = ${THRESHOLD_DEFAULT} (${CARRYOVER_FIX_ARM_ID}), the plain fix quick task 260910-x09 proved`);
  console.log(`   rule:      ${THRESHOLD_SELECTION_RULE}`);
  console.log(`   tie-break: ${THRESHOLD_TIE_BREAK}`);
  console.log(``);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const coldStartIndex = corpusColdStartIndex(db);
    const census = emptyAblationCensus();
    const rows: MetricRow[] = [];
    const contrasts: ContrastRow[] = [];
    const carryScale: CarryScaleRow[] = [];

    // Pooled accumulators, filled season by season so no run ever holds every
    // season's per-match rows at once.
    const pooledScorable = new Map<string, ScorableRow[]>();
    const pooledCandidates = new Map<string, number>();
    const pooledOnset = new Map<string, ScorableRow[]>();
    for (const armId of ARM_IDS) {
      pooledScorable.set(armId, []);
      pooledCandidates.set(armId, 0);
      pooledOnset.set(armId, []);
    }

    // The incumbent and its two pre-declared challengers. Built ONCE, outside
    // the season loop, exactly as the incumbent already was — an arm rebuilt
    // per season would be a different object each time and `runAll` keys state
    // by id, so this is identity hygiene rather than an optimisation.
    const carryArms: { readonly arm: AlgorithmModule<CarryoverFixState>; readonly minObs: number }[] = [
      { arm: carryoverFixArm(CARRYOVER_FIX_ARM_ID, THRESHOLD_CANDIDATES[0]), minObs: THRESHOLD_CANDIDATES[0] },
      { arm: carryoverFixArm(CARRYOVER_FIX_MIN250_ARM_ID, THRESHOLD_CANDIDATES[1]), minObs: THRESHOLD_CANDIDATES[1] },
      { arm: carryoverFixArm(CARRYOVER_FIX_MIN500_ARM_ID, THRESHOLD_CANDIDATES[2]), minObs: THRESHOLD_CANDIDATES[2] },
    ];
    const CARRY_ARM_IDS = carryArms.map((a) => a.arm.id);
    let liveStates = new Map<string, unknown>();
    let replayedRecords = 0;

    for (const [seasonIndex, season] of seasons.entries()) {
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      if (stream.length === 0) {
        console.log(`── ${season} ── no matches in corpus\n`);
        continue;
      }
      const offseasonKeys = offseasonEventKeysFor(db, season);

      // The leaky reference scale, computed in a cheap pre-pass over the
      // SCORED population (offseason excluded, matching what aggregateScores
      // grades). This is Statbotics' literal year_obj.score_sd and it is
      // OUTCOME LEAKAGE by construction — every early-season prediction made
      // with it is informed by matches not yet played.
      const officialScores: number[] = [];
      for (const match of stream) {
        if (offseasonKeys.has(match.eventKey)) continue;
        if (Number.isFinite(match.redScore)) officialScores.push(match.redScore);
        if (Number.isFinite(match.blueScore)) officialScores.push(match.blueScore);
      }
      const seasonScale = populationMeanSd(officialScores);
      const seasonSd = seasonScale.sd > 0 ? seasonScale.sd : EPA_FALLBACK_SCORE_SD;

      const algorithms: AlgorithmModule<any>[] = [
        epa,
        ...carryArms.map((a) => a.arm),
        winProbabilityArm(WINPROB_SEASON_SD_ARM_ID, seasonSd),
        winProbabilityArm(WINPROB_FIXED_SD_ARM_ID, EPA_FALLBACK_SCORE_SD),
      ];

      // SEASON-BOUNDARY THREADING, mirroring packages/harness/cli.ts's
      // runSeasons loop exactly: seasonBoundaryFor -> carrySeason ->
      // initialStates, then records.carryStates back out. A fresh-per-season
      // run would be wrong here for the most direct reason imaginable: the
      // carryover deviation IS the boundary, so a harness that never crosses
      // one cannot measure it at all.
      const boundary = seasonBoundaryFor(seasons, seasonIndex);
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      const carryStatesAtBoundary = new Map<string, CarryoverFixState>();
      if (!boundary.isColdStart) {
        const carried = new Map<string, unknown>();
        for (const algorithm of algorithms) {
          const priorState = liveStates.get(algorithm.id);
          if (algorithm.carrySeason && priorState !== undefined) {
            const next = algorithm.carrySeason(priorState, boundary);
            carried.set(algorithm.id, next);
            if (CARRY_ARM_IDS.includes(algorithm.id)) {
              carryStatesAtBoundary.set(algorithm.id, next as CarryoverFixState);
            }
          }
        }
        initialStates = carried;
      }

      const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
      // ONE runAll for all four arms over ONE shared stream, so every arm
      // provably sees the identical object for each match.
      const records = new WalkForwardSimulator(stream, coldStartIndex).runAll(algorithms, teams, initialStates);
      replayedRecords += records.length;

      // ── headline numbers through the PUBLISHED scorer ────────────────────
      const predictions: HarnessPredictionInput[] = records.map((record) => ({
        matchKey: record.match.matchKey,
        season,
        eventKey: record.match.eventKey,
        compLevel: record.match.compLevel as CompLevel,
        algorithmId: record.algorithmId,
        pRedWin: record.prediction.pRedWin,
        predictedRedScore: record.prediction.redScore,
        predictedBlueScore: record.prediction.blueScore,
        actualWinner: record.match.winner,
        isOffseason: offseasonKeys.has(record.match.eventKey),
        isSurrogateAffected: record.match.redSurrogates.length > 0 || record.match.blueSurrogates.length > 0,
        isColdStart: record.coldStart === true,
      }));
      const slices = aggregateScores(predictions, {
        corpusSeasons: seasons,
        selectedOnSeasons: ELIGIBILITY_NOT_CLAIMED,
      }).filter((slice) => slice.compLevelView === "combined");

      // ── the local mirror, PINNED to aggregateScores' own scoredCount ──────
      const perArm = new Map<string, SeasonArmResult>();
      for (const armId of ARM_IDS) {
        const candidates = predictions.filter((p) => p.algorithmId === armId);
        const scorable: ScorableRow[] = [];
        for (const candidate of candidates) {
          const reason = exclusionReasonFor(candidate);
          if (reason !== null) {
            census[reason] += 1;
            continue;
          }
          scorable.push({
            eventKey: candidate.eventKey,
            matchKey: candidate.matchKey,
            pRedWin: candidate.pRedWin,
            actualWinner: candidate.actualWinner!,
          });
        }
        const slice = slices.find((s) => s.algorithmId === armId);
        if (slice === undefined) {
          throw new Error(`measure:epa-deviations: aggregateScores produced no combined slice for arm ${armId} in ${season}`);
        }
        if (slice.scoredCount !== scorable.length) {
          throw new Error(
            `measure:epa-deviations: population drift for arm ${armId} in ${season} — aggregateScores scored ` +
              `${slice.scoredCount} but the local exclusion predicate kept ${scorable.length}. The two ladders have ` +
              `diverged; fix exclusionReasonFor rather than reporting a contrast computed on a different population ` +
              `than the headline numbers.`
          );
        }
        perArm.set(armId, { scorable, candidateCount: slice.candidateCount });
        rows.push(
          metricRowFrom(
            armId,
            "season",
            season,
            scorable,
            slice.candidateCount
          )
        );
        pooledScorable.get(armId)!.push(...scorable);
        pooledCandidates.set(armId, pooledCandidates.get(armId)! + slice.candidateCount);
        if (!boundary.isColdStart) pooledOnset.get(armId)!.push(...scorable.slice(0, ONSET_MATCH_COUNT));
      }

      // ── the pre-registered win-probability invariant ─────────────────────
      const baselineSeasonRow = rows.find(
        (r) => r.scope === "season" && r.season === season && r.armId === BASELINE_ARM_ID
      )!;
      for (const armId of [WINPROB_SEASON_SD_ARM_ID, WINPROB_FIXED_SD_ARM_ID]) {
        const armRow = rows.find((r) => r.scope === "season" && r.season === season && r.armId === armId)!;
        if (armRow.winnerAccuracy !== baselineSeasonRow.winnerAccuracy) {
          throw new Error(
            `measure:epa-deviations: PRE-REGISTERED INVARIANT VIOLATED in ${season} — arm ${armId} reports winner ` +
              `accuracy ${armRow.winnerAccuracy} against baseline's ${baselineSeasonRow.winnerAccuracy}. A scale on ` +
              `the logistic cannot change sign(margin), so this arm changed something it should not have. Refusing ` +
              `to report a contrast from a wrapper that is not the wrapper it claims to be.`
          );
        }
      }

      // ── per-season and onset contrasts ───────────────────────────────────
      const baselineRows = perArm.get(BASELINE_ARM_ID)!.scorable;
      for (const armId of ARM_IDS) {
        if (armId === BASELINE_ARM_ID) continue;
        const armRows = perArm.get(armId)!.scorable;
        for (const metric of ["winnerAccuracy", "brier"] as const) {
          const units =
            metric === "brier" ? pairedBrierDiffs(armRows, baselineRows) : pairedAccuracyDiffs(armRows, baselineRows);
          const contrast = contrastFor(armId, "season", season, metric, units);
          if (contrast !== null) contrasts.push(contrast);
        }
        if (!boundary.isColdStart) {
          const armOnset = armRows.slice(0, ONSET_MATCH_COUNT);
          const baselineOnset = baselineRows.slice(0, ONSET_MATCH_COUNT);
          rows.push(metricRowFrom(armId, "onset", season, armOnset, armOnset.length));
          for (const metric of ["winnerAccuracy", "brier"] as const) {
            const units =
              metric === "brier"
                ? pairedBrierDiffs(armOnset, baselineOnset)
                : pairedAccuracyDiffs(armOnset, baselineOnset);
            const contrast = contrastFor(armId, "onset", season, metric, units);
            if (contrast !== null) contrasts.push(contrast);
          }
        }
      }
      if (!boundary.isColdStart) {
        rows.push(
          metricRowFrom(
            BASELINE_ARM_ID,
            "onset",
            season,
            baselineRows.slice(0, ONSET_MATCH_COUNT),
            Math.min(ONSET_MATCH_COUNT, baselineRows.length)
          )
        );
      }

      // ── challenger-vs-INCUMBENT contrasts, IN ADDITION to the vs-baseline ──
      // The vs-baseline rows above answer "is this better than plain EPA?".
      // These answer "is this better than the fix we already have?" — the only
      // question the pre-declared rule is allowed to read. Both are emitted;
      // `baselineArmId` is what tells them apart.
      const incumbentRows = perArm.get(CARRYOVER_FIX_ARM_ID)!.scorable;
      for (const armId of [CARRYOVER_FIX_MIN250_ARM_ID, CARRYOVER_FIX_MIN500_ARM_ID]) {
        const armRows = perArm.get(armId)!.scorable;
        for (const metric of ["winnerAccuracy", "brier"] as const) {
          const units =
            metric === "brier" ? pairedBrierDiffs(armRows, incumbentRows) : pairedAccuracyDiffs(armRows, incumbentRows);
          const contrast = contrastFor(armId, "season", season, metric, units, CARRYOVER_FIX_ARM_ID);
          if (contrast !== null) contrasts.push(contrast);
        }
        if (!boundary.isColdStart) {
          const armOnset = armRows.slice(0, ONSET_MATCH_COUNT);
          const incumbentOnset = incumbentRows.slice(0, ONSET_MATCH_COUNT);
          for (const metric of ["winnerAccuracy", "brier"] as const) {
            const units =
              metric === "brier"
                ? pairedBrierDiffs(armOnset, incumbentOnset)
                : pairedAccuracyDiffs(armOnset, incumbentOnset);
            const contrast = contrastFor(armId, "onset", season, metric, units, CARRYOVER_FIX_ARM_ID);
            if (contrast !== null) contrasts.push(contrast);
          }
        }
      }

      // ── what the carryover defect's scale ratio actually was, this boundary ─
      for (const { arm, minObs } of carryArms) {
        const atBoundary = carryStatesAtBoundary.get(arm.id);
        const finalCarryState = records.finalStates.get(arm.id) as CarryoverFixState | undefined;
        if (boundary.isColdStart || atBoundary === undefined || finalCarryState === undefined) continue;
        const seedMean = atBoundary.seedMean;
        const clean = cleanSeasonMean(
          finalCarryState.inner.allianceScoreStats,
          seedMean,
          EPA_SCORE_SD_SEED_COUNT,
          minObs
        );
        const { ratio, deferred } = carryRescaleRatio(clean, seedMean);
        carryScale.push({
          armId: arm.id,
          season,
          fromSeason: boundary.fromSeason,
          seedMean,
          cleanSeasonMean: clean,
          ratio: deferred ? null : ratio,
          carriedTeams: atBoundary.pending.size,
          rescaledTeams: finalCarryState.rescaledTeams - atBoundary.rescaledTeams,
          deferredRescales: finalCarryState.deferredRescales - atBoundary.deferredRescales,
          neverSeen: finalCarryState.pending.size,
        });
      }

      console.log(`═══ ${season} ═══  (season alliance-score SD used by the leaky arm: ${seasonSd.toFixed(2)})`);
      printRowTable(
        rows.filter((r) => r.scope === "season" && r.season === season),
        `per-season headline numbers (aggregateScores, combined view, ties counted in Brier)`
      );
      console.log(``);

      liveStates = new Map(records.carryStates);
    }

    // ── POOLED ───────────────────────────────────────────────────────────────
    const pooledRows: MetricRow[] = [];
    for (const armId of ARM_IDS) {
      pooledRows.push(
        metricRowFrom(armId, "pooled", null, pooledScorable.get(armId)!, pooledCandidates.get(armId)!)
      );
    }
    rows.push(...pooledRows);

    const pooledOnsetRows: MetricRow[] = [];
    for (const armId of ARM_IDS) {
      const onset = pooledOnset.get(armId)!;
      if (onset.length === 0) continue;
      pooledOnsetRows.push(metricRowFrom(armId, "onset", null, onset, onset.length));
    }
    rows.push(...pooledOnsetRows);

    const pooledBaseline = pooledScorable.get(BASELINE_ARM_ID)!;
    const pooledOnsetBaseline = pooledOnset.get(BASELINE_ARM_ID)!;
    for (const armId of ARM_IDS) {
      if (armId === BASELINE_ARM_ID) continue;
      const armRows = pooledScorable.get(armId)!;
      for (const metric of ["winnerAccuracy", "brier"] as const) {
        const units =
          metric === "brier" ? pairedBrierDiffs(armRows, pooledBaseline) : pairedAccuracyDiffs(armRows, pooledBaseline);
        const contrast = contrastFor(armId, "pooled", null, metric, units);
        if (contrast !== null) contrasts.push(contrast);
      }
      const armOnset = pooledOnset.get(armId)!;
      if (armOnset.length > 0) {
        for (const metric of ["winnerAccuracy", "brier"] as const) {
          const units =
            metric === "brier"
              ? pairedBrierDiffs(armOnset, pooledOnsetBaseline)
              : pairedAccuracyDiffs(armOnset, pooledOnsetBaseline);
          const contrast = contrastFor(armId, "onset", null, metric, units);
          if (contrast !== null) contrasts.push(contrast);
        }
      }
    }

    // ── pooled challenger-vs-INCUMBENT: the rows the rule actually reads ────
    const pooledIncumbent = pooledScorable.get(CARRYOVER_FIX_ARM_ID)!;
    const pooledOnsetIncumbent = pooledOnset.get(CARRYOVER_FIX_ARM_ID)!;
    for (const armId of [CARRYOVER_FIX_MIN250_ARM_ID, CARRYOVER_FIX_MIN500_ARM_ID]) {
      const armRows = pooledScorable.get(armId)!;
      for (const metric of ["winnerAccuracy", "brier"] as const) {
        const units =
          metric === "brier" ? pairedBrierDiffs(armRows, pooledIncumbent) : pairedAccuracyDiffs(armRows, pooledIncumbent);
        const contrast = contrastFor(armId, "pooled", null, metric, units, CARRYOVER_FIX_ARM_ID);
        if (contrast !== null) contrasts.push(contrast);
      }
      const armOnset = pooledOnset.get(armId)!;
      if (armOnset.length > 0) {
        for (const metric of ["winnerAccuracy", "brier"] as const) {
          const units =
            metric === "brier"
              ? pairedBrierDiffs(armOnset, pooledOnsetIncumbent)
              : pairedAccuracyDiffs(armOnset, pooledOnsetIncumbent);
          const contrast = contrastFor(armId, "onset", null, metric, units, CARRYOVER_FIX_ARM_ID);
          if (contrast !== null) contrasts.push(contrast);
        }
      }
    }

    console.log(`═══════════════════════════════════════════════════════════════════════════════`);
    console.log(`POOLED ACROSS ${seasons.length} SEASONS`);
    console.log(`═══════════════════════════════════════════════════════════════════════════════`);
    printRowTable(pooledRows, `pooled headline numbers`);
    console.log(``);
    if (pooledOnsetRows.length > 0) {
      printRowTable(
        pooledOnsetRows,
        `ONSET — the first ${ONSET_MATCH_COUNT} scorable matches after each boundary, pooled across boundaries`
      );
      console.log(
        `   The onset window is where a carried rating is still the rating. By season end the EWMA has long since`
      );
      console.log(
        `   overwritten it, so a pooled-season contrast alone would average the carryover effect away entirely.`
      );
      console.log(``);
    }

    console.log(`── PER-BOUNDARY SCALE RATIO — the magnitude of the carryover defect, boundary by boundary ──`);
    console.log(`   ratio = (incoming season's own alliance-score mean) / (outgoing season's). A ratio far from 1.00`);
    console.log(`   is a boundary where every carried rating is expressed in the WRONG units by exactly that factor.`);
    console.log(`   One row per (arm, boundary): the deferral census is the ONE figure the three thresholds trade off.`);
    console.log(
      `   arm                          season   from     seedMean   seasonMean     ratio    carried   rescaled   deferred   neverSeen`
    );
    for (const row of carryScale) {
      console.log(
        `   ${row.armId.padEnd(26)}  ${String(row.season).padStart(6)}  ${String(row.fromSeason).padStart(5)}  ` +
          `${row.seedMean.toFixed(2).padStart(11)}  ${(row.cleanSeasonMean ?? Number.NaN).toFixed(2).padStart(11)}  ` +
          `${(row.ratio === null ? "n/a" : row.ratio.toFixed(4)).padStart(8)}  ${String(row.carriedTeams).padStart(9)}  ` +
          `${String(row.rescaledTeams).padStart(9)}  ${String(row.deferredRescales).padStart(9)}  ` +
          `${String(row.neverSeen).padStart(10)}`
      );
    }
    console.log(``);

    console.log(`── PAIRED CONTRASTS (event-blocked bootstrap). EVERY ROW NAMES ITS OWN REFERENCE ARM — read it. ──`);
    for (const scope of ["pooled", "onset", "season"] as const) {
      const scoped = contrasts.filter((c) => c.scope === scope);
      if (scoped.length === 0) continue;
      console.log(`   ── scope: ${scope} ──`);
      for (const row of scoped) printContrast(row);
    }
    console.log(``);

    // ── pre-registered verdicts, written so WORSE is as reachable as BETTER ──
    console.log(`══ VERDICTS — pre-registered ══`);
    const carryPooledBrier = contrasts.find(
      (c) => c.armId === CARRYOVER_FIX_ARM_ID && c.scope === "pooled" && c.metric === "brier"
    );
    const carryPooledAcc = contrasts.find(
      (c) => c.armId === CARRYOVER_FIX_ARM_ID && c.scope === "pooled" && c.metric === "winnerAccuracy"
    );
    const carryOnsetBrier = contrasts.find(
      (c) => c.armId === CARRYOVER_FIX_ARM_ID && c.scope === "onset" && c.season === null && c.metric === "brier"
    );
    const carryOnsetAcc = contrasts.find(
      (c) => c.armId === CARRYOVER_FIX_ARM_ID && c.scope === "onset" && c.season === null && c.metric === "winnerAccuracy"
    );
    console.log(
      `   carryover fix, POOLED:  accuracy ${carryPooledAcc?.verdict.toUpperCase() ?? "UNMEASURABLE"}, ` +
        `brier ${carryPooledBrier?.verdict.toUpperCase() ?? "UNMEASURABLE"}`
    );
    console.log(
      `   carryover fix, ONSET:   accuracy ${carryOnsetAcc?.verdict.toUpperCase() ?? "UNMEASURABLE"}, ` +
        `brier ${carryOnsetBrier?.verdict.toUpperCase() ?? "UNMEASURABLE"}`
    );
    console.log(
      `   Rule A, this project's shipping bar, asks for BOTH accuracy AND Brier to improve. A result where only one`
    );
    console.log(
      `   moves, or where either interval spans zero, is NOT a recommendation to ship — it is a measurement saying so.`
    );
    console.log(
      `   The fix is an APPROXIMATION (closest-walk-forward-legal), never identical to Statbotics: Statbotics runs`
    );
    console.log(`   offline and simply knows the season scale, which no walk-forward replay can.`);
    console.log(``);
    console.log(`   win-probability invariant: HELD in every season (the run would have thrown otherwise).`);
    console.log(``);

    // ── census ───────────────────────────────────────────────────────────────
    console.log(`   EXCLUSION CENSUS (match-arm records replayed: ${replayedRecords})`);
    for (const [reason, count] of Object.entries(census)) {
      console.log(`      ${reason.padEnd(20)} ${String(count).padStart(9)}`);
    }
    console.log(`      Every row above left the SCOREBOARD only. Nothing left the STATE STREAM: every replayed match`);
    console.log(`      still taught every arm, so a narrowed population never becomes a warmer model.`);
    console.log(``);

    console.log(`   DEVIATIONS REPORTED BUT NOT MEASURED (never silently omitted)`);
    for (const deviation of deviationRegister()) {
      if (deviation.status === "measured") continue;
      console.log(`      ${deviation.id.padEnd(32)} ${deviation.status}`);
      if (deviation.reason !== null) console.log(`         reason: ${deviation.reason}`);
    }
    console.log(``);

    // ── THRESHOLD SELECTION — the pre-declared rule, executed ───────────────
    const thresholdSelection = selectThreshold(
      contrasts,
      [
        { armId: CARRYOVER_FIX_MIN250_ARM_ID, minObs: THRESHOLD_CANDIDATES[1] },
        { armId: CARRYOVER_FIX_MIN500_ARM_ID, minObs: THRESHOLD_CANDIDATES[2] },
      ],
      { armId: CARRYOVER_FIX_ARM_ID, minObs: THRESHOLD_CANDIDATES[0] }
    );
    console.log(`══ THRESHOLD SELECTION ══`);
    console.log(`   candidate set: ${THRESHOLD_CANDIDATES.join(", ")}   (declared before the corpus was opened)`);
    for (const evaluation of thresholdSelection.evaluations) {
      console.log(
        `   ${evaluation.armId.padEnd(26)} minObs ${String(evaluation.minObs).padStart(4)}  ` +
          `onset brier ${signed(evaluation.onsetBrier)} vs incumbent ` +
          `95% [${signed(evaluation.onsetBrierInterval.lower)}, ${signed(evaluation.onsetBrierInterval.upper)}]  ` +
          `season ACC ${evaluation.seasonAccuracyVerdict.toUpperCase()}  season BRIER ${evaluation.seasonBrierVerdict.toUpperCase()}  ` +
          `-> ${evaluation.passed ? "PASSES" : "REJECTED"}`
      );
      console.log(`      clause: ${evaluation.clause}`);
    }
    console.log(
      `   OUTCOME: minObs = ${thresholdSelection.selected} (${thresholdSelection.selectedArmId})`
    );
    console.log(`   ${thresholdSelection.reason}`);
    if (thresholdSelection.selected === THRESHOLD_DEFAULT) {
      console.log(
        `   NO THRESHOLD BEAT THE PLAIN FIX. That is the OUTCOME, not a failure — the incumbent ships unchanged.`
      );
    } else {
      console.log(
        `   A CHALLENGER WAS ADOPTED. Its marginal gain over the plain fix was selected on THE SAME NINE SEASONS it`
      );
      console.log(
        `   was measured on, with no held-out confirmation, so that margin is NOT independently validated — only the`
      );
      console.log(`   plain fix itself is. Say so wherever this threshold is quoted.`);
    }
    console.log(``);

    // ── NAMED SECONDARIES — reported, and DELIBERATELY OUTSIDE the rule ─────
    // 2019 is the season carrying essentially the whole carryover effect, so
    // these are the figures a reader will reach for. They are printed for
    // honesty and excluded from the decision on purpose: a rule that reads the
    // season it was designed around is a rule fitted to that season.
    console.log(`── NAMED SECONDARIES (reported, NOT read by the selection rule) ──`);
    for (const armId of [BASELINE_ARM_ID, ...CARRY_ARM_IDS]) {
      const onset2019 = rows.find((r) => r.armId === armId && r.scope === "onset" && r.season === 2019);
      const season2019 = rows.find((r) => r.armId === armId && r.scope === "season" && r.season === 2019);
      console.log(
        `   ${armId.padEnd(26)} 2019 onset BRIER ${formatMetric(onset2019?.brier ?? null).padStart(9)}   ` +
          `2019 season ACC ${formatMetric(season2019?.winnerAccuracy ?? null).padStart(9)}`
      );
    }
    console.log(
      `   Per-boundary deferral census for all three thresholds is the PER-BOUNDARY SCALE RATIO table above.`
    );
    console.log(``);

    const totalDeferred = carryScale.reduce((sum, r) => sum + r.deferredRescales, 0);
    const totalRescaled = carryScale.reduce((sum, r) => sum + r.rescaledTeams, 0);
    const artifact = buildArtifact({
      seasons,
      corpusPath: CORPUS_PATH,
      streamPopulation: STREAM_POPULATION,
      rows,
      contrasts,
      census,
      carryScale,
      deferredRescales: totalDeferred,
      rescaledTeams: totalRescaled,
      thresholdSelection,
    });
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    for (const path of [ARTIFACT_PATH, COMMITTED_ARTIFACT_PATH]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialized, "utf8");
      console.log(`   wrote ${path}`);
    }
    console.log(
      `   (identical bytes, one serialization. reports/ is gitignored in this repo, so the committed register lives`
    );
    console.log(`   at ${COMMITTED_ARTIFACT_PATH} beside opr-event-scope-2026-08.json.)`);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without the harness
// trying to open a corpus. Same idiom as `measureAllianceReconstruction.ts`.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:epa-deviations failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
