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
 * RUNNING THIS SCRIPT CHANGES NO SHIPPED DEFAULT AND NO MODEL PARAMETER
 * ---------------------------------------------------------------------------
 *
 * THIS WAS TRUE OF THE TASK THAT CREATED THIS FILE (quick task 260910-x09) AND
 * IS NO LONGER THE WHOLE STORY: quick task 260911-3kc ADOPTED one of the arms
 * into `packages/core/algorithms/epa.ts` as `epa@8.0.0+baseline` and then
 * DELETED the arm (see "The carryover arms are GONE" below). What remains true,
 * and is the invariant that matters, is that RUNNING this script still changes
 * no shipped default and no model parameter: every surviving arm is a wrapper
 * and the baseline is the shipped module by reference.
 *
 * Each arm is an `AlgorithmModule` WRAPPER built here, in `scripts/`, by spreading
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
 * THE ARMS — ALL OF THEM RIDE ONE SHARED STREAM PER SEASON
 * ---------------------------------------------------------------------------
 *
 * `WalkForwardSimulator.runAll` keys state by `algorithm.id` and drives every
 * supplied module over one chronological stream, handing each the identical
 * leak-proof match object. Every arm on one pass per season means any difference
 * between arms is provably the ARM and not the data.
 *
 *   epa                      none                    baseline, shipped, by reference
 *   epa-winprob-season-sd    winprob-scale           season-final SD — OUTCOME LEAKAGE, never shippable
 *   epa-winprob-fixed-sd     winprob-scale           EPA_FALLBACK_SCORE_SD denominator
 *
 * ### The carryover arms are GONE — `carryover-scale-anchor` is CLOSED
 *
 * `carryover.ts`'s `epaCarryover` derived one `{mean, sd}` pair from
 * `input.teamTotals` — the OUTGOING season — and used that SAME pair for BOTH
 * directions of the conversion, so every team entered a new season carrying
 * LAST season's point units. `02-CONTEXT.md` D-16 and `02-RESEARCH.md` record
 * Statbotics' `init.py` verbatim as converting into the NEW season's units, so
 * this was a port defect against the project's own recorded reference.
 *
 * IT SHIPS. Quick task 260911-3kc landed it as `epa@8.0.0+baseline`: the
 * correction is composed on top of `epaCarryover`, lazily, per team, on first
 * sight in the new season, by `epa.carrySeason`/`predict`/`update` reading
 * `packages/core/algorithms/epaCarryScale.ts`. THE BASELINE ARM ABOVE NOW *IS*
 * THE FIX.
 *
 * The three arms (`epa-carryover-fix` and its `-min250`/`-min500` threshold
 * challengers) are DELETED, and their absence is load-bearing rather than
 * tidy-up: every one of them WRAPPED the shipped module, so a wrapper over
 * 8.0.0 would apply the rescale a SECOND time and this harness would report a
 * double-apply as "the fix". Do not reintroduce one. The measurement they
 * produced — the pooled deltas, the 2019 concentration, the 2018 Brier
 * regression, the onset cost, and the threshold selection — is preserved as
 * data in `deviationRegister()`'s `carryover-scale-anchor` entry and in
 * `THRESHOLD_SELECTION_OUTCOME`.
 *
 * WHAT REMAINS DIVERGENT, so "closed" is not read as "identical": the rescale
 * ESTIMATES the incoming season's scale from that season's own folded alliance
 * scores and only once `EPA_CARRY_RESCALE_MIN_OBS` of them exist. A team first
 * seen before that forfeits its rescale permanently. Statbotics runs offline
 * and simply knows the scale. `approximation: "closest-walk-forward-legal"`.
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
import type { SeasonComponentMap } from "../packages/core/algorithms/breakdown/index.js";
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
export const WINPROB_SEASON_SD_ARM_ID = "epa-winprob-season-sd";
export const WINPROB_FIXED_SD_ARM_ID = "epa-winprob-fixed-sd";

/**
 * Print/emit order. Baseline first, so every table reads as "against this".
 *
 * THE CARRYOVER ARMS ARE GONE, AND THEIR ABSENCE IS LOAD-BEARING (quick task
 * 260911-3kc). They WRAPPED the shipped `epa` module; `epa@8.0.0+baseline` now
 * contains the fix itself, so a surviving wrapper would apply the rescale a
 * SECOND time and this harness would measure a double-apply while reporting it
 * as the fix. The measurement they produced is preserved as data in
 * `deviationRegister()`'s `carryover-scale-anchor` entry — the arm is deleted,
 * the evidence is not.
 */
export const ARM_IDS = [BASELINE_ARM_ID, WINPROB_SEASON_SD_ARM_ID, WINPROB_FIXED_SD_ARM_ID] as const;

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

/**
 * THE DECISION, FROZEN AS DATA (quick task 260911-3kc).
 *
 * These numbers were produced by running `selectThreshold` — a pure function
 * over the challenger-vs-incumbent contrasts — against the nine-season run of
 * 2026-09-11, BEFORE the fix shipped. Both that function and the arms it read
 * are now deleted: the shipped `epa` module contains the fix, so an arm that
 * wrapped it would apply the rescale twice and a re-run could not reproduce
 * this decision even in principle.
 *
 * It is preserved HERE, verbatim, because the alternative is deleting the
 * record of how a shipped constant was chosen along with the code that chose
 * it. The rule and the candidate set above were written down before any of
 * these numbers existed; this is what they produced.
 */
export const THRESHOLD_SELECTION_OUTCOME: {
  readonly selected: number;
  readonly selectedArmId: string;
  readonly reason: string;
  readonly evaluations: readonly ThresholdEvaluation[];
} = {
  selected: 250,
  selectedArmId: "epa-carryover-fix-min250",
  reason:
    "TIE-BREAK — 2 challengers passed, taking the SMALLER threshold. epa-carryover-fix-min250: PRIMARY met " +
    "(pooled onset Brier BETTER vs epa-carryover-fix) and neither guard fired. NOT INDEPENDENTLY CONFIRMED: the " +
    "margin over the plain minObs=100 fix was selected on the same nine seasons it was measured on.",
  evaluations: [
    {
      armId: "epa-carryover-fix-min250",
      minObs: 250,
      passed: true,
      clause: "PRIMARY met (pooled onset Brier BETTER vs epa-carryover-fix) and neither guard fired",
      onsetBrier: -0.00203,
      onsetBrierInterval: { lower: -0.00339, upper: -0.00068 },
      seasonAccuracyVerdict: "indistinguishable",
      seasonBrierVerdict: "better",
    },
    {
      armId: "epa-carryover-fix-min500",
      minObs: 500,
      passed: true,
      clause: "PRIMARY met (pooled onset Brier BETTER vs epa-carryover-fix) and neither guard fired",
      onsetBrier: -0.00179,
      onsetBrierInterval: { lower: -0.0035, upper: -0.00007 },
      seasonAccuracyVerdict: "indistinguishable",
      seasonBrierVerdict: "indistinguishable",
    },
  ],
};

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
  /** `null` where the measurement is POOLED across seasons rather than scoped to one. */
  readonly season: number | null;
  readonly population: string;
  /** `"accuracy-and-brier"` where the record carries BOTH metrics rather than one. */
  readonly metric: ContrastMetric | "accuracy-and-brier";
  readonly values: readonly { readonly label: string; readonly value: number }[];
  readonly note: string;
  /** Set only on `carryover-scale-anchor`: how the shipped deferral threshold was chosen. */
  readonly thresholdSelection?: typeof THRESHOLD_SELECTION_OUTCOME;
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
      title: "Season-boundary carry converted into the OUTGOING season's point units",
      class: "rating-mechanics",
      // CLOSED at epa@8.0.0+baseline (quick task 260911-3kc, 2026-09-11). There
      // is no live divergence left to toggle, so this is no longer an arm — and
      // it MUST NOT become one again: the arms wrapped the shipped module, so a
      // wrapper over 8.0.0 would apply the rescale twice.
      status: "closed",
      shippable: true,
      predictionAffecting: true,
      docSection: "§8 (docs/models/epa-divergences.md)",
      summary:
        "carryover.ts's epaCarryover derived one {mean, sd} pair from the OUTGOING season's teamTotals and used it " +
        "for BOTH normalizedFromPoints and normalizedToSeasonUnits, so every team entered a new season carrying " +
        "last season's point units. 02-CONTEXT.md D-16 and 02-RESEARCH.md record Statbotics' init.py converting " +
        "into the NEW season's units — a port defect against the project's own recorded reference. ADOPTED as the " +
        "shipped default at epa@8.0.0+baseline: epaCarryover is unchanged and the correction is composed on top, " +
        "lazily, per team, on first sight (packages/core/algorithms/epaCarryScale.ts).",
      reason: null,
      // NARROWED, not eliminated. The rescale is still an ESTIMATE of the
      // incoming season's scale from its own folded scores, and a team first
      // seen before EPA_CARRY_RESCALE_MIN_OBS of them exist forfeits it.
      approximation: "closest-walk-forward-legal",
      armIds: [],
      priorMeasurement: {
        provenance: "prior-measurement",
        source:
          "quick task 260910-x09 (the fix as an arm) and quick task 260911-3kc (the shipped threshold), " +
          "nine seasons 2016-2019 + 2022-2026, 147,221 scored matches, 1,653 event blocks, paired and " +
          "event-blocked against the then-shipped epa@7.0.0+baseline",
        season: null,
        population: "pooled across nine seasons; the published scorer (aggregateScores), ties counted in Brier",
        metric: "accuracy-and-brier",
        values: [
          { label: "pooled winner accuracy delta vs un-fixed EPA", value: 0.01059 },
          { label: "pooled winner accuracy 95% lower", value: 0.00846 },
          { label: "pooled winner accuracy 95% upper", value: 0.01285 },
          { label: "pooled Brier delta vs un-fixed EPA", value: -0.00521 },
          { label: "pooled Brier 95% lower", value: -0.00638 },
          { label: "pooled Brier 95% upper", value: -0.00412 },
          { label: "2019 winner accuracy delta (the whole effect)", value: 0.07943 },
          { label: "2019 Brier delta", value: -0.04234 },
          { label: "2018 Brier delta — WORSE, interval excludes zero", value: 0.00052 },
          { label: "2018 Brier 95% lower", value: 0.0003 },
          { label: "2018 Brier 95% upper", value: 0.00075 },
          { label: "pooled ONSET Brier delta — WORSE at the boundary itself", value: 0.00184 },
          { label: "pooled ONSET Brier 95% lower", value: 0.00005 },
          { label: "pooled ONSET Brier 95% upper", value: 0.00365 },
        ],
        note:
          "THE POOLED GAIN IS 2019 AVERAGED ACROSS NINE SEASONS, not a broad improvement. 2018 -> 2019 is the one " +
          "boundary where the point scale collapses ~5x (291.84 -> 55.41), and it is the one season that moves; " +
          "every other season sits inside ±0.5pp. That concentration is the pre-registered mechanism test PASSING " +
          "— a uniform effect would have REFUTED the mechanism. Stated with its costs: 2018's Brier is " +
          "definitively worse, and the ONSET window (the first 500 scorable matches after each boundary) is " +
          "definitively worse too, because a live per-season scale estimate is noisy before it has observed much. " +
          "The fix pays that back many times over across the season it affects.",
        thresholdSelection: THRESHOLD_SELECTION_OUTCOME,
      },
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
      title: "This project's own per-season component maps, and Statbotics has no partition to compare them to",
      class: "rating-mechanics",
      // WAS `unmeasurable-in-this-harness`, with the absent parameter on
      // update()/carrySeason() as its blocker. That seam EXISTS as of b62c3655:
      // epa.update/epa.carrySeason take an optional component map and
      // `componentMapArm` below builds an arm on it. The blocker moved, it did
      // not close — there is no Statbotics partition to point the arm AT.
      status: "unmeasurable-no-reference",
      shippable: null,
      predictionAffecting: true,
      docSection: "§6",
      summary:
        "breakdown/{2016..2026}.ts are independently derived per-season component maps with their own granularity " +
        "choices. 2024's was re-measured and coarsened to phase groups by quick task 260910-5ym. BOTH SIDES RATE A " +
        "PER-TEAM VECTOR and sum it across the alliance (reference section 3: predict_match sums an 18-entry vector " +
        "component-wise). What differs is which entries the predicted score READS: one (no_foul_points) in most " +
        "seasons, seven in 2018 and 2023, plus three of the OPPONENT's in 2018, and 2018 and 2023 read them " +
        "non-linearly through min() caps and zero_sigmoid terms. That is a difference of DEGREE inside a shared " +
        "structure. Corrected by quick task 260911-j2w; this field previously asserted a difference of kind.",
      reason:
        "THE MISSING SEAM NOW EXISTS — commit b62c3655 (quick task 260911-gfe) added an optional component-map " +
        "parameter to epa.update() and epa.carrySeason(), inert at its default and proven so by a replay test, and " +
        "componentMapArm() in this file builds an arm on it. The blocker MOVED rather than closed. Statbotics' " +
        "all_keys[year] is a rated-quantity LIST, not an additive partition — it carries no_foul_points beside the " +
        "auto/teleop/endgame keys it is the sum of, its comp_0..comp_9 are sub-elements WITHIN those phases, and in " +
        "2022 and 2026 endgame_points appears twice. So no season is partition-constructible and an arm cannot be " +
        "built by picking a non-overlapping subset of those keys: that would measure this project's own " +
        "construction while labelling it Statbotics', exactly the mislabelling corrected in priorMeasurement below. " +
        "UPDATED 2026-09-11 (quick task 260911-j2w): what HAS changed is that a concrete per-season target now " +
        "exists. docs/models/statbotics-breakdown-reference.md sections 15, 17 and 18 give, per season, the entry " +
        "set, the cleaning layer and the exact entries get_score_from_breakdown reads. An arm reproducing that is " +
        "now buildable, and 2018 and 2023 would need a non-linear score read rather than a component sum. Choosing " +
        "to register one is a separate decision, staged in docs/models/epa-statbotics-gap.md, so ARM_IDS and status " +
        "are deliberately unchanged here.",
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
          // RELABELLED 2026-09-11 (quick task 260911-gfe). This was "Statbotics'
          // comp partition". No such partition exists (see `reason` above): the
          // arm behind this number is a four-way grouping THIS PROJECT
          // assembled out of comp_* NAMES in experiments/260910-4x0/granularity.ts.
          // The measurement is real; only the attribution was wrong.
          {
            label: "a four-way grouping THIS PROJECT assembled from comp_* names (NOT Statbotics' own)",
            value: 0.7461,
          },
          { label: "phase groups auto/teleop/endgame (the shipped 2024 map)", value: 0.752 },
          // The one arm that IS faithful to Statbotics for 2024: its
          // get_score_from_breakdown branch rates exactly this quantity. The
          // gap to the shipped 0.7520 is what copying Statbotics would cost.
          { label: "a single no-foul total — Statbotics' ACTUAL 2024 target", value: 0.7403 },
        ],
        note:
          "The curve TURNS OVER — a single total is worse than three groups, so 'fewer components is better' is not " +
          "the lesson. And Statbotics does not predict from a comp partition at all: get_score_from_breakdown's " +
          "2024 branch is score = breakdown['no_foul_points'], and its comp_0..comp_9 keys OVERLAP " +
          "(speaker_points re-counts notes already inside auto_note_points/teleop_note_points), so they are " +
          "display/RP quantities rather than an additive partition. THE 2024 ANSWER, stated as a cost rather than " +
          "as a gap: rating what Statbotics actually rates scores 0.7403 where the shipped phase-group map scores " +
          "0.7520, so faithfulness here would cost about 1.2 percentage points of winner accuracy. These four " +
          "figures come from a scratch scorer (experiments/260910-4x0) and are comparable to EACH OTHER only — " +
          "never difference one of them against a published figure, which counts ties.",
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
  readonly season: number;
  readonly fromSeason: number;
  /** The outgoing season's alliance-score mean — the units every carried rating is expressed in. */
  readonly seedMean: number;
  /** The incoming season's OWN alliance-score mean at season end, seed unwound. */
  readonly cleanSeasonMean: number | null;
  /** `cleanSeasonMean / seedMean` at season end. THIS is the magnitude of the defect for this boundary. */
  readonly ratio: number | null;
  readonly carriedTeams: number;
  /**
   * Carried teams never seen again in the incoming season — carried, never
   * materialized, never scored. Read off the SHIPPED state's own
   * `carryPending` at season end.
   *
   * NOT REPORTED HERE, deliberately: a rescaled-vs-deferred split. The arms
   * that produced those counters are gone, and `EpaState` keeps no diagnostic
   * counters — adding them would put measurement bookkeeping into every
   * published row. The split as it was measured lives in the deviation
   * register's `priorMeasurement`.
   */
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
    /** Carried teams never seen again in the season they were carried into, summed over boundaries. */
    readonly neverSeenTeams: number;
    /** Teams carried across a boundary, summed over boundaries. */
    readonly carriedTeams: number;
    /**
     * The threshold decision as LITERAL DATA: the candidate set, the rule and
     * the tie-break are constants that existed before the corpus was ever
     * opened, and `selected`/`reason`/`evaluations` are the FROZEN record of
     * what they produced (`THRESHOLD_SELECTION_OUTCOME`). This run does not
     * re-decide — the arms that could have are deleted — so a reader can check
     * that the rule was not reverse-engineered from its answer.
     */
    readonly thresholdSelection: {
      readonly candidates: readonly number[];
      readonly rule: string;
      readonly tieBreak: string;
      readonly default: number;
      readonly selected: number;
      readonly selectedArmId: string;
      readonly reason: string;
      readonly shippedConstant: number;
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
  readonly neverSeenTeams: number;
  readonly carriedTeams: number;
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
      neverSeenTeams: input.neverSeenTeams,
      carriedTeams: input.carriedTeams,
      thresholdSelection: {
        candidates: [...THRESHOLD_CANDIDATES],
        rule: THRESHOLD_SELECTION_RULE,
        tieBreak: THRESHOLD_TIE_BREAK,
        default: THRESHOLD_DEFAULT,
        selected: THRESHOLD_SELECTION_OUTCOME.selected,
        selectedArmId: THRESHOLD_SELECTION_OUTCOME.selectedArmId,
        reason: THRESHOLD_SELECTION_OUTCOME.reason,
        // The number the model ACTUALLY runs at, emitted beside the recorded
        // decision so a consumer can see them agree rather than assume it.
        shippedConstant: EPA_CARRY_RESCALE_MIN_OBS,
        evaluations: THRESHOLD_SELECTION_OUTCOME.evaluations,
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
        // Covers TWO shapes, and each entry's own `reason` says which: the
        // reference form was never recorded here and would have to be re-fetched
        // (the 2018 sigmoid), or the object it would be compared against turns
        // out not to exist at all (component-map, quick task 260911-gfe).
        // Neither is a harness limitation.
        "unmeasurable-no-reference":
          "there is no reference form to reproduce: either it was never recorded here, or the object it would be " +
          "compared against does not exist — see `reason`",
      },
    },
    census: { ...input.census },
  };
}

// ───────────────────────────── the arms ─────────────────────────────

// `carryoverFixArm`, `CarryoverFixState`, `ratioForState` and
// `eligibleTeamsOf` USED to live here (quick task 260910-x09, extended by
// 260911-3kc). They are DELETED, and the deletion is the point: every one of
// them wrapped the shipped `epa` module, and `epa@8.0.0+baseline` now contains
// the rescale itself. A surviving wrapper would apply it a SECOND time and this
// harness would report a double-apply as "the fix". The pure helpers they used
// ship in `packages/core/algorithms/epaCarryScale.ts`; the measurement they
// produced is preserved in `deviationRegister()`'s `carryover-scale-anchor`
// entry and in `THRESHOLD_SELECTION_OUTCOME`.

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

/**
 * A component-map arm: the shipped module with `update` and `carrySeason`
 * wrapped so each forwards an OVERRIDE component map (quick task 260911-gfe,
 * built on the seam commit b62c3655).
 *
 * `mapForSeason` returns `undefined` for any season the arm is not live for,
 * and that season then runs the shipped map — so one arm can be live for one
 * season and inert for the other eight, which is the only shape a per-season
 * partition question could ever take.
 *
 * TWO SEASONS, NOT ONE. `update` is handed the map for the MATCH'S OWN season;
 * `carrySeason` is handed the map for the INCOMING season (`boundary.toSeason`).
 * Passing one where the other belongs would express carried ratings in the
 * wrong season's units and the arm would measure that mistake instead of the
 * map.
 *
 * The spread is over the CONCRETE `epa` import, never an `AlgorithmModule`-typed
 * reference: `AlgorithmModule`'s declared `update`/`carrySeason` take two
 * parameters, so an annotated reference would make the third one invisible and
 * the override would silently never take effect. `epa.ts` declares its export
 * with `satisfies` for exactly this reason.
 *
 * NO ARM IS REGISTERED IN `ARM_IDS` TODAY, deliberately. See
 * `docs/models/statbotics-breakdown-reference.md` §8: no season has a faithful
 * Statbotics partition to toggle against. The machinery is here, unit-tested,
 * so the day a season does have one the arm is a one-line addition rather than
 * a re-derivation of the whole question.
 */
export function componentMapArm(
  id: string,
  mapForSeason: (season: number) => SeasonComponentMap | undefined
): AlgorithmModule<EpaState> {
  return {
    ...epa,
    id,
    version: `${epa.version.split("+")[0]}+${id}`,
    update(state: EpaState, result: MatchResult) {
      return epa.update(state, result, mapForSeason(armSeasonFor(state, result)));
    },
    carrySeason(state: EpaState, boundary: SeasonBoundary) {
      return epa.carrySeason(state, boundary, mapForSeason(boundary.toSeason));
    },
  };
}

/**
 * The season an `epa` update will resolve for this match — `state.season` when
 * it is set, otherwise the event key's leading year, which is exactly
 * `epa.ts`'s own `deriveSeasonFromEventKey` rule.
 *
 * Mirrored rather than imported because that helper is module-private. Getting
 * it wrong would hand the override map for the WRONG season to `update`, which
 * would not throw anywhere: the arm would simply parse a season's breakdown
 * with another season's map and report the resulting damage as the effect of
 * the component map. Thrown loudly instead.
 */
function armSeasonFor(state: EpaState, result: MatchResult): number {
  if (state.season !== null) return state.season;
  const season = Number.parseInt(result.eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(
      `measure:epa-deviations: componentMapArm could not derive a season from event key "${result.eventKey}"`
    );
  }
  return season;
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
  console.log(`is not replayed at all. The carryover fix is no longer an arm — it SHIPS, inside the baseline above.`);
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
  console.log(`THE CARRYOVER DEVIATION IS CLOSED (quick task 260911-3kc). Its three arms are gone, and their absence`);
  console.log(`is load-bearing: they WRAPPED the shipped module, so a wrapper over epa@8.0.0 would apply the rescale a`);
  console.log(`SECOND time and this harness would report a double-apply as the fix. The measurement is preserved as`);
  console.log(`data in the artifact's deviation register, not deleted with the arm.`);
  console.log(`   deferral threshold SHIPPED at minObs = ${THRESHOLD_SELECTION_OUTCOME.selected}, chosen from the pre-declared candidate set ${THRESHOLD_CANDIDATES.join(", ")}`);
  console.log(`   by a rule fixed before any of its numbers existed (incumbent/default was ${THRESHOLD_DEFAULT}):`);
  console.log(`   rule:      ${THRESHOLD_SELECTION_RULE}`);
  console.log(`   tie-break: ${THRESHOLD_TIE_BREAK}`);
  console.log(`   outcome:   ${THRESHOLD_SELECTION_OUTCOME.reason}`);
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
      // The SHIPPED module's state immediately after the boundary. `epa@8.0.0`
      // carries `carrySeedMean`/`carryPending` itself, so the per-boundary scale
      // diagnostic below reads the real shipped state rather than an arm's
      // bookkeeping — the arms are gone, the diagnostic is not.
      let epaStateAtBoundary: EpaState | undefined;
      if (!boundary.isColdStart) {
        const carried = new Map<string, unknown>();
        for (const algorithm of algorithms) {
          const priorState = liveStates.get(algorithm.id);
          if (algorithm.carrySeason && priorState !== undefined) {
            const next = algorithm.carrySeason(priorState, boundary);
            carried.set(algorithm.id, next);
            if (algorithm.id === BASELINE_ARM_ID) epaStateAtBoundary = next as EpaState;
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

      // ── the boundary's scale ratio, read off the SHIPPED module's own state ─
      const finalEpaState = records.finalStates.get(BASELINE_ARM_ID) as EpaState | undefined;
      if (!boundary.isColdStart && epaStateAtBoundary !== undefined && finalEpaState !== undefined) {
        const seedMean = epaStateAtBoundary.carrySeedMean;
        const clean = cleanSeasonMean(
          finalEpaState.allianceScoreStats,
          seedMean,
          EPA_SCORE_SD_SEED_COUNT,
          EPA_CARRY_RESCALE_MIN_OBS
        );
        const { ratio, deferred } = carryRescaleRatio(clean, seedMean);
        carryScale.push({
          season,
          fromSeason: boundary.fromSeason,
          seedMean,
          cleanSeasonMean: clean,
          ratio: deferred ? null : ratio,
          carriedTeams: epaStateAtBoundary.carryPending.size,
          neverSeen: finalEpaState.carryPending.size,
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
    console.log(`   Read off the SHIPPED epa@8.0.0 state's own carrySeedMean/carryPending — this is what production does.`);
    console.log(
      `   season   from     seedMean   seasonMean     ratio    carried   neverSeen`
    );
    for (const row of carryScale) {
      console.log(
        `   ${String(row.season).padStart(6)}  ${String(row.fromSeason).padStart(5)}  ` +
          `${finiteOrThrow(row.seedMean, `${row.season} seedMean`).toFixed(2).padStart(11)}  ` +
          `${(row.cleanSeasonMean === null ? "n/a" : row.cleanSeasonMean.toFixed(2)).padStart(11)}  ` +
          `${(row.ratio === null ? "n/a" : row.ratio.toFixed(4)).padStart(8)}  ${String(row.carriedTeams).padStart(9)}  ` +
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

    // ── the carryover verdict, now a REPRODUCTION statement, not a contrast ──
    console.log(`══ VERDICTS — pre-registered ══`);
    console.log(
      `   carryover scale anchor: CLOSED. The ${BASELINE_ARM_ID} baseline above IS the fix (epa@8.0.0+baseline), so there`
    );
    console.log(
      `   is no contrast to report — the rows above ARE the fixed model's rows. What they must equal is the winning`
    );
    console.log(
      `   arm's rows from the PRE-LANDING run, to 6 decimal places; that reproduction gate is quick task 260911-3kc's`
    );
    console.log(`   task 3 and is checked against the pre-landing artifact, not here.`);
    console.log(
      `   The fix remains an APPROXIMATION (closest-walk-forward-legal), never identical to Statbotics: Statbotics`
    );
    console.log(`   runs offline and simply knows the season scale, which no walk-forward replay can.`);
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

    // ── THRESHOLD SELECTION — the record, not a re-decision ────────────────
    // The arms that produced these numbers are gone (see ARM_IDS). What is
    // printed is the frozen record of how the SHIPPED threshold was chosen, so
    // a reader of this run's log still sees the rule, the candidates and the
    // clause rather than a bare constant.
    console.log(`══ THRESHOLD SELECTION — FROZEN RECORD (this run did not re-decide) ══`);
    console.log(`   candidate set: ${THRESHOLD_CANDIDATES.join(", ")}   (declared before the corpus was ever opened)`);
    console.log(`   incumbent / default at the time: minObs = ${THRESHOLD_DEFAULT}`);
    for (const evaluation of THRESHOLD_SELECTION_OUTCOME.evaluations) {
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
      `   SHIPPED: minObs = ${finiteOrThrow(THRESHOLD_SELECTION_OUTCOME.selected, "shipped threshold")} (${THRESHOLD_SELECTION_OUTCOME.selectedArmId})`
    );
    console.log(`   ${THRESHOLD_SELECTION_OUTCOME.reason}`);
    if (THRESHOLD_SELECTION_OUTCOME.selected !== THRESHOLD_DEFAULT) {
      console.log(
        `   A CHALLENGER WAS ADOPTED. Its marginal gain over the plain fix was selected on THE SAME NINE SEASONS it`
      );
      console.log(
        `   was measured on, with no held-out confirmation, so that margin is NOT independently validated — only the`
      );
      console.log(`   plain fix itself is. Say so wherever this threshold is quoted.`);
    }
    if (EPA_CARRY_RESCALE_MIN_OBS !== THRESHOLD_SELECTION_OUTCOME.selected) {
      throw new Error(
        `measure:epa-deviations: the SHIPPED EPA_CARRY_RESCALE_MIN_OBS is ${EPA_CARRY_RESCALE_MIN_OBS} but the frozen ` +
          `selection record says ${THRESHOLD_SELECTION_OUTCOME.selected}. One of them moved without the other. ` +
          `Refusing to print a decision record that does not describe the shipped constant.`
      );
    }
    console.log(``);

    // ── NAMED SECONDARIES — 2019 is where the carryover effect lives ────────
    console.log(`── NAMED SECONDARIES ──`);
    {
      const onset2019 = rows.find((r) => r.armId === BASELINE_ARM_ID && r.scope === "onset" && r.season === 2019);
      const season2019 = rows.find((r) => r.armId === BASELINE_ARM_ID && r.scope === "season" && r.season === 2019);
      console.log(
        `   ${BASELINE_ARM_ID.padEnd(26)} 2019 onset BRIER ${formatMetric(onset2019?.brier ?? null).padStart(9)}   ` +
          `2019 season ACC ${formatMetric(season2019?.winnerAccuracy ?? null).padStart(9)}`
      );
      console.log(
        `   These are the FIXED model's 2019 figures. The un-fixed comparison is in the deviation register's`
      );
      console.log(`   priorMeasurement, because the arm that produced it no longer exists.`);
    }
    console.log(``);

    const artifact = buildArtifact({
      seasons,
      corpusPath: CORPUS_PATH,
      streamPopulation: STREAM_POPULATION,
      rows,
      contrasts,
      census,
      carryScale,
      neverSeenTeams: carryScale.reduce((sum, r) => sum + r.neverSeen, 0),
      carriedTeams: carryScale.reduce((sum, r) => sum + r.carriedTeams, 0),
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
