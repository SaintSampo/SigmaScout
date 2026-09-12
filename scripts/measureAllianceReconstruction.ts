/**
 * Measures how well each published algorithm reconstructs the alliance output
 * that ACTUALLY happened, walk-forward, broken out by event tier.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 *
 * On the published 2026 artifacts, aggregated over teams whose last official
 * event was a Championship division, `sum(BPR)/sum(OPR) = 1.128` while
 * `sum(EPA)/sum(OPR) = 0.968`. Two shipped models disagree by ~16% about
 * exactly the teams the front page ranks highest, and a ratio cannot say which
 * one is right — it has no outcome in it. Predictive reconstruction does: each
 * model already emits its own expected alliance output BEFORE the match is
 * played, and the match then says what the alliance actually scored.
 *
 * ---------------------------------------------------------------------------
 * THE HYPOTHESIS UNDER TEST — AND HOW IT CAN LOSE
 * ---------------------------------------------------------------------------
 *
 * Hypothesis: BPR's rank weighting (`w2`/`w3` in
 * `packages/core/algorithms/spr.ts`) reconstructs a STACKED alliance better
 * than OPR's and EPA's linear-sum assumption can, and Championship play is
 * where stacked alliances live.
 *
 * READ `viewOfMap`'s DOC COMMENT BEFORE READING THESE NUMBERS. Quick task
 * 260910-25c corrected the story there, and the correction changes what this
 * measurement means. The rank weights are renormalized to sum to 3 and the
 * LARGEST weight is matched to the LARGEST rating, so by Chebyshev's sum
 * inequality BPR's weighted sum is `>=` the plain sum for EVERY alliance, with
 * the gap growing as the alliance's ratings spread out:
 *
 *     (1.00, 1.00, 1.00) -> 3.000 vs 3.000 plain   (1.000x)
 *     (1.20, 1.00, 0.80) -> 3.136 vs 3.000 plain   (1.046x)
 *     (2.00, 1.00, 0.50) -> 4.023 vs 3.500 plain   (1.149x)
 *     (3.00, 0.60, 0.40) -> 4.936 vs 4.000 plain   (1.234x)
 *
 * BPR is therefore a SPREAD AMPLIFIER, not an anti-additivity discount — the
 * opposite of the mechanism the motivating framing assumes. That makes a
 * specific, checkable prediction: if the amplification is wrong, BPR's SIGNED
 * error at stacked fields should be POSITIVE. It should OVER-predict.
 *
 * REFUTATION CONDITION, pre-registered: the hypothesis is REFUTED when BPR's
 * MAE at `champsDivision`/`einstein` is HIGHER than EPA's and the paired
 * event-blocked percentile interval on `|err_bpr| - |err_epa|` EXCLUDES ZERO.
 * It is "indistinguishable" whenever that interval spans zero. The verdict
 * line below prints all three outcomes with equal fluency, on purpose.
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD BY CONSTRUCTION, AND WHY THE PREDICTION IS READ VERBATIM
 * ---------------------------------------------------------------------------
 *
 * `WalkForwardSimulator.runAll` calls `predict` strictly before `update`, so
 * `prediction.redScore` / `prediction.blueScore` ARE "this model's expected
 * alliance output from its team values as of before this match". They are read
 * VERBATIM. This script never reaches into `teamMetrics` and re-sums team
 * values, because a hand-rolled sum would force OPR's linear-sum assumption
 * onto BPR and test the exact opposite of the hypothesis:
 *
 *   - `spr.predict`   redScore = red.mu * unit, where `red.mu` is the
 *                     RANK-WEIGHTED sum from `viewOfMap`. Trained against the
 *                     CORRECTED target.
 *   - `opr.predict`   plain sum of the team's event-scoped rating. RAW points.
 *   - `epa.predict`   redOffensiveTotal + blue's predicted foulsCommitted —
 *                     deliberately adds the opponent's foul contribution, so it
 *                     targets RAW total.
 *
 * All three ride ONE shared stream in ONE `runAll` call, so any difference
 * between them is the model and not the data.
 *
 * ---------------------------------------------------------------------------
 * TWO TARGETS, NEVER RECONCILED
 * ---------------------------------------------------------------------------
 *
 * BPR's training target is `totalPoints - foulPoints - adjustPoints`, computed
 * here by importing `correctionsOf` from `spr.ts` — the SAME function BPR's
 * own `update` uses, so the measurement target cannot drift from the training
 * target. OPR and EPA target RAW total points. Every metric is therefore
 * reported against BOTH targets and the mismatch is printed as a named
 * finding. Nothing is normalized away: subtracting fouls out of OPR's or EPA's
 * prediction to "fix" the comparison would be inventing a model neither one is.
 *
 * ---------------------------------------------------------------------------
 * n IS NOT INDEPENDENT OBSERVATIONS
 * ---------------------------------------------------------------------------
 *
 * Two observations per match (red and blue) share a field, a game state, an
 * alliance-selection pool and a day's officiating crew, and matches inside one
 * event share all of that again. Every interval reported here is therefore an
 * EVENT-BLOCKED bootstrap, and `eventCount` is printed beside it — at
 * `einstein` that count is ~11 across all seasons, which is the honest
 * effective sample size and the reason that interval is wide.
 *
 * READ-ONLY. This script tunes nothing, fits nothing, and selects no parameter
 * against any season. BPR's 2023-2026 holdout stays sealed. It needs no
 * secrets and must never be run with `--env-file`.
 *
 * Usage:
 *   npx tsx scripts/measureAllianceReconstruction.ts [--seasons 2016-2019,2022-2026] [--algorithms opr,epa,spr]
 *   pnpm measure:alliance-reconstruction
 */

import { pathToFileURL } from "node:url";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { correctionsOf } from "../packages/core/algorithms/bpr.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { eventBlockedBootstrap, type EventBootstrapResult } from "../packages/harness/eventBootstrap.js";
// REUSE, not re-implementation: `equalCountBuckets` and `parseSeasons` are
// already exported and already unit-tested in `measureSwingSkill.ts`, and that
// module's own `isEntryPoint` guard means importing it opens no corpus. A second
// quantile bucketer here would be a second chance to drop rows at a boundary.
import { equalCountBuckets, parseSeasons } from "./measureSwingSkill.js";

export { parseSeasons };

const CORPUS_PATH = "data/corpus.sqlite";

/**
 * Every season the corpus can support this measurement on. 2020 is present but
 * truncated with no Championship at all; 2021 is absent entirely (the remote
 * season has no conventional 3v3 alliance matches to score). Both are omitted
 * by construction rather than filtered later.
 */
export const DEFAULT_SEASONS_SPEC = "2016-2019,2022-2026";

/** Event tiers this measurement distinguishes. `null` means replayed but never scored. */
export type Tier = "base" | "districtChampionship" | "champsDivision" | "einstein" | "festivalOfChampions";

/** The order tiers print in — ascending in "how stacked the field is". */
export const TIER_ORDER: readonly Tier[] = [
  "base",
  "districtChampionship",
  "champsDivision",
  "einstein",
  "festivalOfChampions",
];

/** One alliance's (prediction, outcome) pair for one match, for one algorithm. */
export interface Observation {
  readonly season: number;
  readonly eventKey: string;
  readonly matchKey: string;
  readonly eventType: number;
  readonly tier: Tier;
  readonly compLevel: string;
  readonly side: "red" | "blue";
  readonly algorithmId: string;
  /** `prediction.redScore`/`blueScore` VERBATIM — each model's own reconstruction. */
  readonly predicted: number;
  /** TBA's total points for this alliance, fouls included. OPR's and EPA's native target. */
  readonly actualRaw: number;
  /** `raw - foulPoints - adjustPoints` via `correctionsOf`. BPR's native target. */
  readonly actualCorrected: number;
  readonly rosterSize: number;
  /**
   * The STRENGTH CONTROL (REC-04). OPR's predicted output for the SAME side of
   * the SAME match — available because all three algorithms ride one `runAll`,
   * so this is a common yardstick every row can be sorted on without using the
   * outcome and without using the model being judged.
   *
   * Why it is the control that matters: Championship is stacked AND late in the
   * season AND smaller-field. Quintiles of `strengthRef` inside ORDINARY
   * regionals ask the hypothesis's real question with none of those confounds —
   * if BPR's behaviour on strong alliances already shows up at week-3 regionals,
   * the effect is about alliance strength, not about Championship, and the
   * Championship framing is simply the wrong frame.
   */
  readonly strengthRef: number;
}

/** The algorithm whose prediction supplies `Observation.strengthRef`. */
export const STRENGTH_REFERENCE_ALGORITHM = "opr";

// ───────────────────────────────── pure ─────────────────────────────────
// Everything below this divider is pure and unit-tested in
// measureAllianceReconstruction.test.ts.

/** Mean ABSOLUTE error. `NaN` on an empty list — an empty sample has no mean, and 0 would read as perfection. */
export function mae(errors: readonly number[]): number {
  if (errors.length === 0) return Number.NaN;
  let sum = 0;
  for (const e of errors) sum += Math.abs(e);
  return sum / errors.length;
}

/** Root mean squared error. `NaN` on an empty list. */
export function rmse(errors: readonly number[]): number {
  if (errors.length === 0) return Number.NaN;
  let sum = 0;
  for (const e of errors) sum += e * e;
  return Math.sqrt(sum / errors.length);
}

/**
 * Mean SIGNED error. Reported beside `mae` because the two answer different
 * questions: `mae` is magnitude, `signedMean` is DIRECTION. A model that misses
 * by +5 half the time and -5 the other half has `mae` 5 and `signedMean` 0 —
 * badly calibrated but unbiased. A model that misses by +5 every time has both
 * equal to 5 — systematically over-predicting. The spread-amplifier reading of
 * BPR predicts exactly the second shape at stacked fields, so this column is
 * the one that reading stands or falls on.
 */
export function signedMean(errors: readonly number[]): number {
  if (errors.length === 0) return Number.NaN;
  let sum = 0;
  for (const e of errors) sum += e;
  return sum / errors.length;
}

/**
 * TBA event type -> the tier this measurement scores it in, or `null` for a
 * type that is REPLAYED (so state keeps warming) but never SCORED.
 *
 * Deliberately NOT `EVENT_TYPE_TIERS` from `packages/core/rankingPoints/
 * constants.ts`: that map collapses 3 and 4 into one `championship` tier, and
 * separating Championship divisions from Einstein is the entire point here —
 * Einstein is the most stacked field in the sport and is only ~1-2 events per
 * season, so folding it into 1,100 division matches would hide it completely.
 *
 * Throws on an unregistered type rather than defaulting, mirroring
 * `eventTierFor`'s refuse-to-default stance: a silently-defaulted bucket is the
 * failure mode `UpcomingMatch.eventType`'s own doc comment warns against.
 */
export function tierOf(eventType: number): Tier | null {
  switch (eventType) {
    case 0: // Regional
    case 1: // District
      return "base";
    case 2: // District Championship
    case 5: // District Championship Division
      return "districtChampionship";
    case 3: // Championship Division
      return "champsDivision";
    case 4: // Championship Finals (Einstein)
      return "einstein";
    case 6: // Festival of Champions
      return "festivalOfChampions";
    case 99: // Offseason
    case 100: // Preseason Week 0
      return null;
    default:
      throw new Error(
        `tierOf: unregistered TBA event_type ${eventType} — refusing to default it into a bucket. ` +
          `Register it here explicitly (see packages/core/algorithms/types.ts UpcomingMatch.eventType).`
      );
  }
}

/**
 * BPR's corrected scoring target for both alliances of one match:
 * `raw - foulPoints - adjustPoints`.
 *
 * A THIN WRAPPER over `correctionsOf`, imported from `spr.ts`, never a second
 * transcription of that arithmetic — the whole point is that this measurement
 * and BPR's `update` read the identical function, so the target cannot drift.
 * `correctionsOf` returns all-zero corrections for a `null` or malformed
 * breakdown, so those matches fall back to the raw score unchanged rather than
 * throwing or leaving the population.
 */
export function correctedOutputs(
  scoreBreakdownRaw: string | null,
  redScore: number,
  blueScore: number
): { readonly red: number; readonly blue: number } {
  const c = correctionsOf(scoreBreakdownRaw);
  return {
    red: redScore - c.redFoul - c.redAdjust,
    blue: blueScore - c.blueFoul - c.blueAdjust,
  };
}

/** Why an observation (or a whole match) left the scored population. Counted, never silently dropped. */
export type ExclusionReason =
  | "notScoredTier"
  | "surrogateAffected"
  | "coldStart"
  | "fullyDemoAlliance"
  | "dqZeroedSide"
  | "nonFiniteValue";

export type ExclusionCensus = Record<ExclusionReason, number>;

export function emptyCensus(): ExclusionCensus {
  return {
    notScoredTier: 0,
    surrogateAffected: 0,
    coldStart: 0,
    fullyDemoAlliance: 0,
    dqZeroedSide: 0,
    nonFiniteValue: 0,
  };
}

/**
 * The MATCH-level exclusion rules, in the order the repo defines them.
 *
 * Surrogate: `redSurrogates.length > 0 || blueSurrogates.length > 0` — the
 * harness's D-07 rule, the same predicate `packages/spr/data.ts`'s
 * `isSurrogateAffected` applies (restated over the two arrays rather than
 * imported, because that function's parameter is a `BprMatch` and this script
 * holds a `MatchResult`). A surrogate match leaves the SCOREBOARD, never the
 * state stream: it is still replayed, it is just not graded.
 *
 * Cold start: `record.coldStart === true`, the stamp `runAll` sets (D-01/D-02).
 * Nothing re-derives that predicate — this reads the stamp, like every other
 * consumer in the pipeline.
 *
 * Returns the reason so the caller can census it, or `null` to keep the match.
 */
export function matchExclusion(
  match: {
    readonly redSurrogates: readonly string[];
    readonly blueSurrogates: readonly string[];
    readonly redTeams: readonly string[];
    readonly blueTeams: readonly string[];
  },
  coldStart: boolean
): ExclusionReason | null {
  if (coldStart) return "coldStart";
  if (match.redSurrogates.length > 0 || match.blueSurrogates.length > 0) return "surrogateAffected";
  if (isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams)) return "fullyDemoAlliance";
  return null;
}

/**
 * The SIDE-level exclusion rules. Applied per alliance, so a DQ-zeroed red side
 * leaves the population while its healthy blue opposite stays — dropping the
 * whole match there would discard a perfectly good observation.
 */
export function sideExclusion(side: {
  readonly teams: readonly string[];
  readonly dqs: readonly string[];
  readonly actual: number;
  readonly predicted: number;
}): ExclusionReason | null {
  if (side.teams.length === 0) return "nonFiniteValue";
  if (isFullyDqZeroScoreAlliance(side.teams, side.dqs, side.actual)) return "dqZeroedSide";
  if (!Number.isFinite(side.actual) || !Number.isFinite(side.predicted)) return "nonFiniteValue";
  return null;
}

/** Which target a metric is computed against. */
export type Target = "corrected" | "raw";

/**
 * Per-observation signed error, `predicted - actual`. POSITIVE MEANS THE MODEL
 * OVER-PREDICTED the alliance — the sign convention the spread-amplifier
 * prediction is stated in.
 */
export function errorsOf(observations: readonly Observation[], target: Target): number[] {
  return observations.map((o) => o.predicted - (target === "corrected" ? o.actualCorrected : o.actualRaw));
}

export interface TierStats {
  readonly n: number;
  readonly mae: number;
  readonly rmse: number;
  readonly signed: number;
  /** Printed beside the errors so a reader can size a signed error against the scoreboard it lives on. */
  readonly meanPredicted: number;
  readonly meanActual: number;
}

export function statsFor(observations: readonly Observation[], target: Target): TierStats {
  const errors = errorsOf(observations, target);
  const actuals = observations.map((o) => (target === "corrected" ? o.actualCorrected : o.actualRaw));
  return {
    n: errors.length,
    mae: mae(errors),
    rmse: rmse(errors),
    signed: signedMean(errors),
    meanPredicted: signedMean(observations.map((o) => o.predicted)),
    meanActual: signedMean(actuals),
  };
}

/**
 * The identity of ONE alliance in ONE match — the join key every paired
 * comparison uses. Deliberately includes `side`: pairing on `matchKey` alone
 * would silently compare BPR's red reconstruction against EPA's blue one.
 */
export function sideKey(matchKey: string, side: "red" | "blue"): string {
  return `${matchKey}|${side}`;
}

/** One paired unit for the event-blocked bootstrap: a difference, and the event block it belongs to. */
export interface PairedDiffUnit {
  readonly eventKey: string;
  readonly matchKey: string;
  readonly side: "red" | "blue";
  /** `|err_a| - |err_b|`. NEGATIVE means `a` was closer — `a` is the better reconstruction. */
  readonly diff: number;
}

/**
 * Per-observation paired difference in ABSOLUTE error, `|err_a| - |err_b|`,
 * with both models scored on the IDENTICAL observation.
 *
 * Pairs strictly on `(matchKey, side)` and DROPS any observation without a
 * counterpart in the other model. It never zero-fills a missing counterpart: a
 * zero-filled row asserts "the two models tied here", which dilutes the
 * contrast toward zero and would make a real difference look smaller than it
 * is, in exactly the direction that manufactures a false "indistinguishable".
 *
 * Pairing is also what makes the interval tight enough to be worth computing:
 * both models see the same match, so the shared match-difficulty variance
 * cancels inside the difference before the resampling ever happens (see
 * `eventBootstrap.ts`'s header on level SE vs paired SE).
 */
export function pairedAbsErrorDiffs(
  a: readonly Observation[],
  b: readonly Observation[],
  target: Target
): PairedDiffUnit[] {
  const absErrorOf = (o: Observation): number =>
    Math.abs(o.predicted - (target === "corrected" ? o.actualCorrected : o.actualRaw));
  const bByKey = new Map<string, Observation>();
  for (const o of b) bByKey.set(sideKey(o.matchKey, o.side), o);
  const units: PairedDiffUnit[] = [];
  for (const o of a) {
    const counterpart = bByKey.get(sideKey(o.matchKey, o.side));
    if (counterpart === undefined) continue; // dropped, never zero-filled
    units.push({
      eventKey: o.eventKey,
      matchKey: o.matchKey,
      side: o.side,
      diff: absErrorOf(o) - absErrorOf(counterpart),
    });
  }
  return units;
}

/** Mean paired difference — the statistic the event-blocked bootstrap resamples. */
export function meanDiff(units: readonly PairedDiffUnit[]): number {
  if (units.length === 0) return Number.NaN;
  let sum = 0;
  for (const u of units) sum += u.diff;
  return sum / units.length;
}

/**
 * The three pre-registered outcomes, in the caller's own words. Written so
 * "REFUTED" is exactly as reachable as "SUPPORTED" — the hypothesis is on
 * trial here, not on display.
 */
export type VerdictKind = "supported" | "indistinguishable" | "refuted" | "unmeasurable";

/**
 * `lower`/`upper` are the 2.5/97.5 percentiles of the resampled mean of
 * `|err_subject| - |err_reference|`. An interval that spans zero means the
 * sample cannot tell the two apart at this many EVENT blocks, and that is
 * reported as such rather than resolved by the point estimate's sign.
 */
export function verdictFor(lower: number, upper: number, pointEstimate: number): VerdictKind {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(pointEstimate)) return "unmeasurable";
  if (lower <= 0 && upper >= 0) return "indistinguishable";
  return pointEstimate < 0 ? "supported" : "refuted";
}

/**
 * Assigns each `(matchKey, side)` in `observations` to one of `count`
 * equal-population buckets of `strengthRef`, ascending.
 *
 * Deduplicated to match-sides FIRST, then bucketed: every algorithm scores the
 * identical match-side with the identical `strengthRef`, so bucketing the raw
 * observation list would weight each match-side once per algorithm and let a
 * row that one model dropped shift another model's bucket edges.
 */
export function strengthBucketIndex(observations: readonly Observation[], count: number): Map<string, number> {
  const bySide = new Map<string, number>();
  for (const o of observations) bySide.set(sideKey(o.matchKey, o.side), o.strengthRef);
  const rows = [...bySide].map(([key, strengthRef]) => ({ key, strengthRef }));
  const assignment = new Map<string, number>();
  for (const [index, bucket] of equalCountBuckets(rows, (r) => r.strengthRef, count).entries()) {
    for (const row of bucket) assignment.set(row.key, index);
  }
  return assignment;
}

/** Groups observations by `(algorithmId, tier)`. */
export function groupByAlgorithmAndTier(observations: readonly Observation[]): Map<string, Map<Tier, Observation[]>> {
  const out = new Map<string, Map<Tier, Observation[]>>();
  for (const o of observations) {
    let byTier = out.get(o.algorithmId);
    if (byTier === undefined) {
      byTier = new Map<Tier, Observation[]>();
      out.set(o.algorithmId, byTier);
    }
    const bucket = byTier.get(o.tier);
    if (bucket === undefined) byTier.set(o.tier, [o]);
    else bucket.push(o);
  }
  return out;
}

// ───────────────────────────── the measurement ─────────────────────────────

function formatStat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function signedStat(value: number): string {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(3)}` : "—";
}

function printTierTable(observations: readonly Observation[], algorithmIds: readonly string[], target: Target): void {
  const grouped = groupByAlgorithmAndTier(observations);
  console.log(
    `   algorithm  tier                          n        MAE       RMSE     SIGNED   mean pred    mean act`
  );
  for (const algorithmId of algorithmIds) {
    const byTier = grouped.get(algorithmId);
    for (const tier of TIER_ORDER) {
      const rows = byTier?.get(tier);
      if (rows === undefined || rows.length === 0) continue;
      const s = statsFor(rows, target);
      console.log(
        `   ${algorithmId.padEnd(9)}  ${tier.padEnd(22)}  ${String(s.n).padStart(7)}  ` +
          `${formatStat(s.mae).padStart(9)}  ${formatStat(s.rmse).padStart(9)}  ` +
          `${signedStat(s.signed).padStart(9)}  ${formatStat(s.meanPredicted).padStart(10)}  ` +
          `${formatStat(s.meanActual).padStart(10)}`
      );
    }
  }
}

function printCensus(census: ExclusionCensus, replayedRecords: number): void {
  console.log(`   EXCLUSION CENSUS (match-algorithm records replayed: ${replayedRecords})`);
  for (const [reason, count] of Object.entries(census)) {
    console.log(`      ${reason.padEnd(20)} ${String(count).padStart(9)}`);
  }
  console.log(
    `      Every row above left the SCOREBOARD only. Nothing left the STATE STREAM: every replayed match`
  );
  console.log(`      still taught every algorithm, so a narrowed population never becomes a warmer model.`);
}

/**
 * The comparability finding REC-03 requires be surfaced rather than normalized
 * away. Printed above every table so it cannot be read as a footnote.
 */
function printNativeTargetNote(): void {
  console.log(`   NATIVE TARGET — WHICH TARGET EACH MODEL ACTUALLY TRAINS ON`);
  console.log(`      opr: RAW total points (fouls included)`);
  console.log(`      epa: RAW total points (it deliberately ADDS the opponent's predicted foulsCommitted)`);
  console.log(`      spr: CORRECTED points (raw - foulPoints - adjustPoints, via correctionsOf)`);
  console.log(
    `      THIS IS A REAL COMPARABILITY FINDING, NOT A NUISANCE. Against the CORRECTED target, OPR's and`
  );
  console.log(
    `      EPA's signed error carries the mean foul load as a FLOOR — they are predicting a quantity that`
  );
  console.log(
    `      includes fouls and being graded on one that does not, so their negative signed error there is`
  );
  console.log(
    `      partly arithmetic, not model bias. Against the RAW target the handicap runs the other way, and`
  );
  console.log(
    `      BPR's signed error carries the foul load as a NEGATIVE floor. Both tables are printed for all`
  );
  console.log(
    `      three models and neither is "corrected"; subtracting fouls out of OPR's or EPA's prediction to`
  );
  console.log(`      reconcile them would be inventing a model that neither one is.`);
}

/** The paired contrast for one (subject, reference) pair inside one tier. */
interface PairedReport {
  readonly tier: Tier;
  readonly subject: string;
  readonly reference: string;
  readonly target: Target;
  readonly result: EventBootstrapResult | null;
  readonly failure: string | null;
}

function pairedReport(
  tier: Tier,
  subject: string,
  reference: string,
  target: Target,
  subjectRows: readonly Observation[],
  referenceRows: readonly Observation[]
): PairedReport {
  const units = pairedAbsErrorDiffs(subjectRows, referenceRows, target);
  if (units.length === 0) {
    return { tier, subject, reference, target, result: null, failure: "no paired observations" };
  }
  try {
    return {
      tier,
      subject,
      reference,
      target,
      result: eventBlockedBootstrap(units, meanDiff),
      failure: null,
    };
  } catch {
    // `eventBlockedBootstrap` refuses below 2 event blocks — a single-block
    // bootstrap reports an SE of exactly 0, a false claim of certainty. Caught
    // and reported rather than allowed to kill a nine-season run.
    return { tier, subject, reference, target, result: null, failure: "too few event blocks to bootstrap" };
  }
}

function printPairedReport(report: PairedReport): void {
  const label = `   ${report.tier.padEnd(22)} ${report.subject} vs ${report.reference} (${report.target})`;
  if (report.result === null) {
    console.log(`${label}: ${report.failure}`);
    return;
  }
  const r = report.result;
  console.log(
    `${label}\n` +
      `      mean(|err_${report.subject}| - |err_${report.reference}|) = ${signedStat(r.pointEstimate)} points   ` +
      `SE ${r.standardError.toFixed(3)}   ` +
      `95% [${signedStat(r.percentile.lower)}, ${signedStat(r.percentile.upper)}]   ` +
      `eventCount ${r.eventCount}   n ${r.matchCount}`
  );
}

interface StreamRecord {
  readonly match: MatchResult;
  readonly algorithmId: string;
  readonly prediction: { readonly redScore: number; readonly blueScore: number };
  readonly coldStart?: true;
}

/** Turns one season's shared-stream records into scored observations, censusing every exclusion. */
function observationsForSeason(
  season: number,
  records: readonly StreamRecord[],
  census: ExclusionCensus
): Observation[] {
  // Pass 1: the strength yardstick. OPR's own prediction for each match-side,
  // harvested from the SAME shared run, so `strengthRef` is available to every
  // algorithm's rows without any second replay and without using the outcome.
  const strengthByKey = new Map<string, number>();
  for (const record of records) {
    if (record.algorithmId !== STRENGTH_REFERENCE_ALGORITHM) continue;
    strengthByKey.set(sideKey(record.match.matchKey, "red"), record.prediction.redScore);
    strengthByKey.set(sideKey(record.match.matchKey, "blue"), record.prediction.blueScore);
  }

  const observations: Observation[] = [];
  for (const record of records) {
    const { match } = record;
    const tier = tierOf(match.eventType);
    if (tier === null) {
      census.notScoredTier += 1;
      continue;
    }
    const matchReason = matchExclusion(match, record.coldStart === true);
    if (matchReason !== null) {
      census[matchReason] += 1;
      continue;
    }
    const corrected = correctedOutputs(match.scoreBreakdownRaw, match.redScore, match.blueScore);
    const sides = [
      {
        side: "red" as const,
        teams: match.redTeams,
        dqs: match.redDqs,
        actual: match.redScore,
        actualCorrected: corrected.red,
        predicted: record.prediction.redScore,
      },
      {
        side: "blue" as const,
        teams: match.blueTeams,
        dqs: match.blueDqs,
        actual: match.blueScore,
        actualCorrected: corrected.blue,
        predicted: record.prediction.blueScore,
      },
    ];
    for (const s of sides) {
      const sideReason = sideExclusion(s);
      if (sideReason !== null) {
        census[sideReason] += 1;
        continue;
      }
      observations.push({
        season,
        eventKey: match.eventKey,
        matchKey: match.matchKey,
        eventType: match.eventType,
        tier,
        compLevel: match.compLevel,
        side: s.side,
        algorithmId: record.algorithmId,
        predicted: s.predicted,
        actualRaw: s.actual,
        actualCorrected: s.actualCorrected,
        rosterSize: s.teams.length,
        strengthRef: strengthByKey.get(sideKey(match.matchKey, s.side)) ?? Number.NaN,
      });
    }
  }
  return observations;
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

/** The base-tier strength control (REC-04): Championship's question, asked without Championship. */
function printStrengthQuintiles(
  observations: readonly Observation[],
  algorithmIds: readonly string[],
  target: Target,
  quintiles: number
): void {
  const base = observations.filter((o) => o.tier === "base" && Number.isFinite(o.strengthRef));
  if (base.length === 0) {
    console.log(`   no base-tier observations to bucket`);
    return;
  }
  const assignment = strengthBucketIndex(base, quintiles);
  const byAlgorithmAndBucket = new Map<string, Observation[][]>();
  for (const algorithmId of algorithmIds) {
    byAlgorithmAndBucket.set(
      algorithmId,
      Array.from({ length: quintiles }, () => [] as Observation[])
    );
  }
  for (const o of base) {
    const bucket = assignment.get(sideKey(o.matchKey, o.side));
    if (bucket === undefined) continue;
    byAlgorithmAndBucket.get(o.algorithmId)?.[bucket]?.push(o);
  }

  console.log(`   quintile  mean OPR strength  algorithm        n        MAE     SIGNED`);
  for (let q = 0; q < quintiles; q++) {
    const reference = byAlgorithmAndBucket.get(algorithmIds[0]!)?.[q] ?? [];
    const meanStrength = signedMean(reference.map((o) => o.strengthRef));
    for (const algorithmId of algorithmIds) {
      const rows = byAlgorithmAndBucket.get(algorithmId)?.[q] ?? [];
      if (rows.length === 0) continue;
      const s = statsFor(rows, target);
      console.log(
        `   ${String(q + 1).padStart(8)}  ${formatStat(meanStrength).padStart(17)}  ` +
          `${algorithmId.padEnd(9)}  ${String(s.n).padStart(7)}  ${formatStat(s.mae).padStart(9)}  ` +
          `${signedStat(s.signed).padStart(9)}`
      );
    }
  }
}

function describeVerdict(kind: VerdictKind, subject: string, reference: string): string {
  switch (kind) {
    case "supported":
      return `SUPPORTED — ${subject} reconstructs this tier CLOSER than ${reference}, and the interval excludes zero`;
    case "refuted":
      return `REFUTED — ${subject} reconstructs this tier WORSE than ${reference}, and the interval excludes zero`;
    case "indistinguishable":
      return `INDISTINGUISHABLE at this sample size — the paired interval spans zero`;
    case "unmeasurable":
      return `UNMEASURABLE — no usable interval for this tier`;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = flagValue(args, "--seasons") ?? DEFAULT_SEASONS_SPEC;
  const algorithmsSpec = flagValue(args, "--algorithms");
  const seasons = parseSeasons(seasonsSpec);
  const algorithms = resolvePublishAlgorithms(algorithmsSpec);
  const algorithmIds = algorithms.map((a) => a.id);
  const quintiles = 5;

  console.log(`ALLIANCE RECONSTRUCTION — which model rebuilds the alliance that actually played?`);
  console.log(`algorithms: ${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}`);
  console.log(`seasons:    ${seasons.join(", ")}`);
  console.log(``);
  console.log(`READ-ONLY. Nothing here is tuned, fitted, swept or selected against any season.`);
  console.log(``);
  console.log(`n IS NOT INDEPENDENT OBSERVATIONS. One match contributes up to 2 rows (red and blue) that`);
  console.log(`share a field, a game state and an officiating crew, and matches inside one event share all`);
  console.log(`of that again. That is why every interval below is an EVENT-BLOCKED bootstrap reporting its`);
  console.log(`own eventCount — treat any interval derived from n instead as far too tight.`);
  console.log(``);
  printNativeTargetNote();
  console.log(``);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const coldStartIndex = corpusColdStartIndex(db);
    const census = emptyCensus();
    const pooled: Observation[] = [];
    let replayedRecords = 0;

    // SEASON-BOUNDARY THREADING, mirroring `packages/harness/cli.ts`'s
    // `runSeasons` loop exactly: `seasonBoundaryFor` -> `carrySeason` ->
    // `initialStates`, then `records.carryStates` back out.
    //
    // WHY A FRESH-PER-SEASON RUN WOULD BE WRONG HERE, specifically. The control
    // bucket is mostly week-1-to-week-6 regional matches; the Championship
    // bucket is, by definition, the end of the season. Starting every season
    // cold would handicap the EARLY matches — which is nearly all of the
    // control — and hand Championship an advantage that is really just a warmer
    // model. That would manufacture the very effect this script exists to test.
    let liveStates = new Map<string, unknown>();

    for (const [seasonIndex, season] of seasons.entries()) {
      const stream = buildSeasonStream(db, season);
      if (stream.length === 0) {
        console.log(`── ${season} ── no matches in corpus\n`);
        continue;
      }
      const boundary = seasonBoundaryFor(seasons, seasonIndex);
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      if (!boundary.isColdStart) {
        const carried = new Map<string, unknown>();
        for (const algorithm of algorithms) {
          const priorState = liveStates.get(algorithm.id);
          if (algorithm.carrySeason && priorState !== undefined) {
            carried.set(algorithm.id, algorithm.carrySeason(priorState, boundary));
          }
        }
        initialStates = carried;
      }

      const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
      // ONE runAll for all three algorithms over ONE shared stream (D-22), so
      // every model provably sees the identical object for each match.
      const records = new WalkForwardSimulator(stream, coldStartIndex).runAll(algorithms, teams, initialStates);
      replayedRecords += records.length;
      const observations = observationsForSeason(season, records, census);

      console.log(`═══ ${season} — corrected target ═══`);
      printTierTable(observations, algorithmIds, "corrected");
      console.log(`═══ ${season} — raw target ═══`);
      printTierTable(observations, algorithmIds, "raw");
      console.log(``);

      pooled.push(...observations);
      liveStates = new Map(records.carryStates);
    }

    console.log(`═══════════════════════════════════════════════════════════════════════════════`);
    console.log(`POOLED ACROSS ${seasons.length} SEASONS`);
    console.log(`═══════════════════════════════════════════════════════════════════════════════`);
    console.log(`   ── corrected target (raw - foulPoints - adjustPoints) — BPR's native target ──`);
    printTierTable(pooled, algorithmIds, "corrected");
    console.log(`   ── raw target (TBA total points) — OPR's and EPA's native target ──`);
    printTierTable(pooled, algorithmIds, "raw");
    console.log(``);

    console.log(`── TIER CONTROLS ──`);
    console.log(`   base                 = regional + district. The headline CONTROL.`);
    console.log(`   districtChampionship = the WARM control: late-season, but far less stacked than Champs.`);
    console.log(`   champsDivision       = stacked AND late-season AND small-field.`);
    console.log(`   einstein             = the most stacked field in the sport, ~1-2 events per season.`);
    console.log(
      `   If an advantage appears at champsDivision but NOT at districtChampionship, the stacking story`
    );
    console.log(`   survives the lateness confound. If it appears at districtChampionship too, it does not.`);
    console.log(``);

    console.log(`── STRENGTH CONTROL — base tier ONLY, quintiles of OPR's own predicted alliance output ──`);
    console.log(`   Championship's question asked with no Championship in it: if the effect is already`);
    console.log(`   visible on the top strength quintile of ordinary regionals, it is about alliance`);
    console.log(`   STRENGTH, not about Championship, and the Championship framing is the wrong frame.`);
    console.log(`   (corrected target)`);
    printStrengthQuintiles(pooled, algorithmIds, "corrected", quintiles);
    console.log(`   (raw target)`);
    printStrengthQuintiles(pooled, algorithmIds, "raw", quintiles);
    console.log(``);

    // ── PAIRED CONTRASTS, event-blocked ──────────────────────────────────────
    const grouped = groupByAlgorithmAndTier(pooled);
    const subject = "spr";
    const references = algorithmIds.filter((id) => id !== subject);
    const verdictLines: string[] = [];

    console.log(`── PAIRED CONTRAST (event-blocked bootstrap, pooled across seasons) ──`);
    console.log(`   NEGATIVE mean(|err_bpr| - |err_other|) means BPR is CLOSER. eventCount is the honest`);
    console.log(`   effective sample size; n is shown beside it only to make that gap visible.`);
    for (const target of ["corrected", "raw"] as const) {
      for (const reference of references) {
        for (const tier of TIER_ORDER) {
          const subjectRows = grouped.get(subject)?.get(tier) ?? [];
          const referenceRows = grouped.get(reference)?.get(tier) ?? [];
          if (subjectRows.length === 0 || referenceRows.length === 0) continue;
          const report = pairedReport(tier, subject, reference, target, subjectRows, referenceRows);
          printPairedReport(report);
          if (reference === "epa" && target === "corrected") {
            const kind =
              report.result === null
                ? "unmeasurable"
                : verdictFor(report.result.percentile.lower, report.result.percentile.upper, report.result.pointEstimate);
            const subjectStats = statsFor(subjectRows, target);
            const referenceStats = statsFor(referenceRows, target);
            verdictLines.push(
              `   ${tier.padEnd(22)} ${describeVerdict(kind, subject, reference)}\n` +
                `      MAE spr ${formatStat(subjectStats.mae)} vs epa ${formatStat(referenceStats.mae)};  ` +
                `SIGNED spr ${signedStat(subjectStats.signed)} vs epa ${signedStat(referenceStats.signed)}  ` +
                `(positive = OVER-prediction, which is what the spread-amplifier reading predicts)`
            );
          }
        }
      }
    }
    console.log(``);

    console.log(`══ VERDICT — pre-registered, spr vs epa on the corrected target ══`);
    console.log(
      `   Hypothesis: BPR's rank weighting reconstructs a STACKED alliance better than a linear sum can.`
    );
    for (const line of verdictLines) console.log(line);
    console.log(``);

    printCensus(census, replayedRecords);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without the harness
// trying to open a corpus. Same idiom as `measureSwingSkill.ts`.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:alliance-reconstruction failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
