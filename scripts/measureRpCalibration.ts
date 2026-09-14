/**
 * Measures the SigmaScout RP layer's published bonus probabilities against
 * what actually happened.
 *
 * `packages/core/rankingPoints/empiricalMoments.ts` documents three deliberate
 * simplifications — a DIAGONAL covariance block, a ZERO score cross-covariance,
 * and variance about each team's own mean — and states their expected
 * consequence in advance:
 *
 *   > All three make the predicted distribution NARROWER and less correlated
 *   > than reality. The published effect is bonus probabilities pulled toward
 *   > the extremes.
 *
 * That is a falsifiable claim with a stated direction, and this script is what
 * checks it rather than leaving it as an assertion in a header. It reports
 * three things per season:
 *
 *   1. RELIABILITY per bonus — mean predicted probability against observed
 *      frequency, plus a Brier score and a bucketed reliability table. This is
 *      the ordinary "is it calibrated" question.
 *
 *   2. THE EXTREMES CLAIM — what fraction of predictions land below 0.05 or
 *      above 0.95, and what actually happened in those buckets. If the
 *      distribution really is too narrow, confident predictions should be
 *      WRONG more often than their confidence implies.
 *
 *   3. THE CORRELATION CLAIM, which is the one the diagonal block is actually
 *      about. The model draws thresholds independently, so its implied joint is
 *      the product of its marginals. Reality need not be: an alliance good at
 *      one threshold is probably good at the other. Comparing observed
 *      P(A and B) against observed P(A)*P(B) measures the real dependence the
 *      model is throwing away, and its sign says which way the simplification
 *      errs.
 *
 * Walk-forward throughout, driven through the SAME `SigmaScoutLayer` the
 * publisher runs, so these are the published numbers and not a re-derivation
 * that could disagree with them.
 *
 * ---------------------------------------------------------------------------
 * SAME-SCORER FIX (2026-09-11, phase 09 plan 09-01 Task 1 Step 1, D-11)
 * ---------------------------------------------------------------------------
 *
 * This script used to construct its `SigmaScoutLayer` with ONE constructor
 * argument (the rule module only), while the publisher
 * (`packages/harness/publish.ts`) always constructs it with TWO (the rule
 * module AND the algorithm id). The second argument is the ONLY thing that
 * selects `SigmaScoreAccumulator` over the retired per-robot consistency
 * accumulator (`sigmaScoutLayer.ts`'s `usesSigmaScore` check —
 * `SIGMA_SCORE_ALGORITHM_IDS` is `{bpr}`, this script's own default
 * `--algorithm`), so every bpr bonus probability this script reported BEFORE
 * this fix was computed from the retired accumulator's band variance while every
 * published bpr row is computed from Sigma-derived band variance — the exact
 * defect class recorded in STATE row 110 (two publish paths fed the retired
 * accumulator and Sigma to the ranking-point filler and produced 0.46525 against 0.47 for the
 * same event). Fixed by passing the resolved algorithm id as the layer's
 * second constructor argument, so this script is now provably the same scorer
 * the publisher runs, for every algorithm — the whole premise of D-11's
 * same-scorer mitigation.
 *
 * `.planning/todos/pending/ranking-points-audit.md` F2's recorded 0.1507 /
 * 0.3109 predates this fix and is NOT the number 09-01-SUMMARY.md freezes —
 * see that summary's before/after table for the corrected figures.
 *
 * ---------------------------------------------------------------------------
 * THE ATTRIBUTION RUN THIS SCRIPT ONCE DROVE (2026-09-11, plan 09-06)
 * ---------------------------------------------------------------------------
 *
 * This script briefly grew an `--arms` flag that scored eight alternative RP
 * formulations side by side off one replay per season. The pre-committed
 * per-bonus bar accepted none of them, the branches were deleted, and the flag
 * went with them — there is one model again, so there is nothing to select
 * between.
 *
 * What remains of that work: `--attribution-out`'s READER half below (the
 * record's schema and its digest builder), which is pure over the committed
 * JSON and deliberately references nothing that was deleted, so
 * `data/baselines/rp-attribution-2026-09.json` and
 * `docs/models/rp-attribution.md` keep their drift guard now that the code
 * which produced them is gone.
 *
 * CROSS-GENERATION WARNING, still live: 09-01's frozen
 * `data/baselines/rp-calibration-2026-09.json` was captured BEFORE 09-04
 * replaced the 4,000-draw Monte Carlo with the closed form. Any comparison
 * against that file measures the engine swap, not a modelling change, and must
 * be labelled cross-generation wherever it is reported.
 *
 * ---------------------------------------------------------------------------
 * `--marginal-arm` (2026-09-12, quick task 260912-2uz)
 * ---------------------------------------------------------------------------
 *
 * A measurement-only second arm whose ELIGIBLE threshold variables declare
 * `"negative-binomial"`, re-testing plan 09-06's refusal of that family now
 * that quick task 260911-w7k has removed the hardcode that made 24 of 30
 * cells incapable of responding to it. It is NOT the deleted `--arms`
 * registry: there is one production model and no selectable surface — the arm
 * is a variant rule module handed to a second `SigmaScoutLayer`, and every
 * season module still declares `"gaussian"`. See the block above
 * `assertMarginalArmSliceAllowed` for the full design and for why the
 * 2023-2026 reporting slice is refused by construction.
 *
 * Usage:
 *   npx tsx scripts/measureRpCalibration.ts [--seasons 2024-2026] [--algorithm bpr] [--emit-artifact <path>] [--marginal-arm]
 */

import { statSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import {
  RP_RULE_MODULES,
  type BonusPredicate,
  type RpRuleModule,
  type RpThresholdClause,
} from "../packages/core/rankingPoints/rules.js";
import { actualBonusFlagsForSeason } from "../packages/harness/publish.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import {
  loadRpCalibrationMeasurement,
  RP_CALIBRATION_MEASUREMENT_PATH,
  RpCalibrationMeasurementSchema,
  toIntegerRpOrNull,
  type RpCalibrationRecord,
} from "../packages/harness/publish.js";
import { emptyMarginalResolutionTally, pmfMean } from "../packages/core/rankingPoints/analyticPmf.js";
import { isBonusRpCompLevel } from "../packages/core/rankingPoints/constants.js";
import type { Prediction } from "../packages/core/algorithms/types.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** One (match, alliance, bonus) prediction paired with what happened. */
export interface Observation {
  readonly predicted: number;
  readonly actual: boolean;
}

/**
 * Exported so the slice guard can be tested against the SAME parse the CLI
 * performs — a guard tested against a hand-built array would not prove that a
 * spec like `2016-2026` reaches it with the forbidden seasons still present.
 */
export function parseSeasons(spec: string): number[] {
  const seasons: number[] = [];
  for (const part of spec.split(",")) {
    const range = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && Number.isFinite(range[0]!) && Number.isFinite(range[1]!)) {
      for (let s = range[0]!; s <= range[1]!; s++) seasons.push(s);
    } else if (Number.isFinite(range[0]!)) {
      seasons.push(range[0]!);
    }
  }
  return seasons;
}

function brier(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  let sum = 0;
  for (const o of observations) {
    const diff = o.predicted - (o.actual ? 1 : 0);
    sum += diff * diff;
  }
  return sum / observations.length;
}

function rate(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  return observations.filter((o) => o.actual).length / observations.length;
}

function meanPredicted(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  return observations.reduce((sum, o) => sum + o.predicted, 0) / observations.length;
}

// ---------------------------------------------------------------------------
// THE MEASUREMENT-ONLY NEGATIVE-BINOMIAL ARM (2026-09-12, quick task
// 260912-2uz)
// ---------------------------------------------------------------------------
//
// `--marginal-arm` scores a second arm whose threshold variables declare
// `"negative-binomial"` instead of `"gaussian"`, to RE-TEST plan 09-06's
// recorded refusal of that family. That refusal is in doubt for a structural
// reason, not a numerical one: `clauseProbability` used to refit a clause's
// combined moments as a hardcoded Gaussian, so 24 of 30 cells could not have
// responded to a family change while still reporting as ties. Quick task
// 260911-w7k removed the hardcode; quick task 260912-2uz restored the family.
// This is what finally asks the question on cells capable of answering it.
//
// THREE PROPERTIES THIS SEAM IS BUILT AROUND, each of which has a recorded
// failure behind it:
//
//   1. NO PRODUCTION SURFACE. The arm is a VARIANT RULE MODULE built here and
//      handed to a second `SigmaScoutLayer` — same class, same two-argument
//      construction as the publisher. Plan 09-06 deliberately deleted
//      `RpLayerConfig` and everything that selected between model branches;
//      nothing here reintroduces a selectable surface, and every season
//      module in the tree still declares `"gaussian"`.
//
//   2. ONE REPLAY, ONE SCORER. The arms multiply LAYERS, never replays: one
//      `buildSeasonStream` and one `WalkForwardSimulator.runAll` per season,
//      folded through both layers, and scored by the SAME
//      `brier`/`rate`/`meanPredicted` helpers the control path uses. See this
//      file's SAME-SCORER FIX header — a scorer mismatch manufactured a
//      phantom ~0.003 regression on this exact question once already, and the
//      two-argument construction is what prevents its band-variance half.
//
//   3. THE REPORTING SLICE IS UNSPENDABLE. See
//      `assertMarginalArmSliceAllowed` below.

/**
 * The first season of the RESERVED REPORTING SLICE. 2023-2026 was already
 * spent once on this exact question, on 2026-09-11, and Jacob's recorded
 * decision of 2026-09-12 forbids spending it again — a second use would
 * further weaken it as an honest check on anything later.
 */
export const RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON = 2023;

/**
 * Refuses the negative-binomial arm on any season at or above
 * `RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON`.
 *
 * READS THE PARSED SEASON LIST, NOT THE RULE-MODULE-FILTERED ONE, AND IS
 * CALLED BEFORE THE CORPUS IS OPENED. Both are deliberate. A wide spec like
 * `--seasons 2016-2026` must be REFUSED rather than silently trimmed to the
 * allowed part: silent trimming would let someone believe they had asked for
 * the reporting slice and got it, and would make "did this run touch 2023?" a
 * question about this function's internals rather than about the command that
 * was typed. Refusing before the corpus opens means the prohibited run cannot
 * even begin to produce a figure.
 *
 * This is a structural guard, not a warning, a default or a documentation
 * note, and it has NO override flag by design. The prohibition is the point:
 * a selection-slice result cannot promote anything on its own — that is what
 * the slice split is for — so no result, however promising, authorises
 * reaching for the reporting slice to confirm it. That is a fresh decision for
 * Jacob to make with the selection-slice magnitude in hand.
 */
export function assertMarginalArmSliceAllowed(parsedSeasons: readonly number[]): void {
  const forbidden = parsedSeasons.filter((s) => s >= RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON);
  if (forbidden.length === 0) return;
  throw new Error(
    `--marginal-arm refuses season(s) ${forbidden.join(", ")}: the ${RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON}-2026 reporting slice was already spent on this question on 2026-09-11, and the recorded decision of 2026-09-12 forbids spending it again. ` +
      `This arm runs on the SELECTION SLICE only — 2016-2020 plus 2022. A spec that merely spans the reporting slice is refused rather than trimmed, so that asking for it is never quietly answered with something else. There is no override flag, deliberately.`
  );
}

/** Why a threshold variable cannot carry a negative-binomial declaration. */
export interface PoisonedVariable {
  readonly name: string;
  readonly reason: string;
}

/** Whether a bonus can respond to the family swap at all, and why not when it cannot. */
export interface BonusReach {
  readonly name: string;
  readonly canMove: boolean;
  readonly reason: string;
}

/** The runtime-derived partition for one season. */
export interface MarginalArmEligibility {
  readonly eligible: readonly string[];
  readonly poisoned: readonly PoisonedVariable[];
  readonly bonusReach: readonly BonusReach[];
}

/**
 * Every clause a predicate contains, as a flat list paired with a label.
 * Exhaustive over `BonusPredicate`'s seven kinds — the `default` arm is a
 * `never` check, so an eighth predicate kind fails to COMPILE here rather than
 * being silently skipped and quietly widening the arm's reach.
 *
 * `singleThreshold` contributes one implicit single-term clause over its own
 * variable. `nestedSameVariable` contributes the same shape, and that is not
 * an approximation: nested thresholds route through interval enumeration,
 * which calls `probAtLeast` on the fitted marginal directly and therefore
 * honours the declared family exactly as a single-term clause does.
 * `constant` contributes NO clauses — it reads no variable at all.
 */
function clausesOf(predicate: BonusPredicate): readonly RpThresholdClause[] {
  switch (predicate.kind) {
    case "singleThreshold":
    case "nestedSameVariable":
      return [{ terms: [{ variable: predicate.variable }], direction: predicate.direction, threshold: predicate.threshold }];
    case "linearCombination":
      return [{ terms: predicate.terms, direction: predicate.direction, threshold: predicate.threshold }];
    case "conjunctionDistinct":
      return predicate.clauses;
    case "countOfIndicators":
      return predicate.indicators;
    case "dataDependentMixture":
      return [predicate.selector, predicate.whenSelectorTrue, predicate.whenSelectorFalse];
    case "constant":
      return [];
    default: {
      const exhaustive: never = predicate;
      throw new Error(`measureRpCalibration: unhandled BonusPredicate kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** True when a clause is a single term with no divisor (or divisor exactly 1). */
function isSingleUnscaled(clause: RpThresholdClause): boolean {
  return clause.terms.length === 1 && (clause.terms[0]!.divisor ?? 1) === 1;
}

/**
 * DERIVES the negative-binomial eligibility partition from
 * `ruleModule.bonusPredicates` at runtime. Never hardcoded from a table: the
 * season modules are the truth, and a derivation that tracks them cannot drift
 * from them the way a pasted table would.
 *
 * THE RULE IS MATH-FORCED, not a policy choice. Negative binomial is NOT
 * closed under scaled addition — a sum of independent NBs is NB only when
 * every `p` matches, and `X / divisor` is not even integer-supported — so
 * `analyticPmf.ts`'s `familyForClauseSum` THROWS on an NB clause sum rather
 * than inventing a closure or falling back to a Gaussian. (That fallback is
 * the exact hardcode whose removal made this re-test possible; reintroducing
 * it would make the measurement meaningless a second time.)
 *
 * So a variable is ELIGIBLE only if EVERY clause it appears in is a single
 * unscaled term. A variable appearing in ANY multi-term clause or ANY
 * divisor-bearing term is POISONED and keeps declaring `"gaussian"` —
 * INCLUDING when it also appears alone in some other clause, because a MIXED
 * clause throws on `familyForClauseSum`'s distinct-families check instead.
 *
 * A bonus CAN MOVE when AT LEAST ONE of its clauses is a single unscaled term
 * over an eligible variable — not when ALL of them are. That distinction was
 * got wrong first and CAUGHT BY THE MEASUREMENT, which is worth recording:
 * this function originally required every clause to honour the declaration,
 * and the in-flight consistency check then reported 2016 `capture` as an
 * "unreachable" cell whose Brier had nonetheless moved. It had. `capture` is a
 * `conjunctionDistinct` whose FIRST clause is `attackedTowerEndStrength <= T`
 * — a single unscaled term over an eligible variable, which honours the
 * declared family through `clauseProbability`'s single-term reuse path — while
 * its SECOND clause is a scaled sum that derives Gaussian. A bonus made of a
 * reachable clause AND a blocked one is PARTIALLY reachable, and counting it
 * as unreachable would have understated the arm's reach and buried a real
 * movement in the category that is supposed to tie by construction.
 *
 * A `constant` predicate has no clauses at all and is inert by construction —
 * it ties with control as a structural fact about the predicate, which is
 * never evidence about the family.
 */
export function deriveMarginalArmEligibility(ruleModule: RpRuleModule): MarginalArmEligibility {
  const poisonReasonByVariable = new Map<string, string>();

  for (const predicate of ruleModule.bonusPredicates) {
    for (const clause of clausesOf(predicate)) {
      const single = isSingleUnscaled(clause);
      for (const term of clause.terms) {
        if (single) continue;
        if (poisonReasonByVariable.has(term.variable)) continue;
        const divisor = term.divisor ?? 1;
        poisonReasonByVariable.set(
          term.variable,
          clause.terms.length > 1
            ? `appears in a ${clause.terms.length}-term clause of bonus "${predicate.name}" (a scaled sum, and negative binomial is not closed under scaled addition)`
            : `appears with divisor ${divisor} in bonus "${predicate.name}" (a divided term is not integer-supported)`
        );
      }
    }
  }

  // Declared variables that no predicate reads are eligible vacuously; they
  // are also unreachable, so the distinction never shows up in a figure.
  const eligible = ruleModule.thresholdVariables.map((v) => v.name).filter((name) => !poisonReasonByVariable.has(name));
  const poisoned = ruleModule.thresholdVariables
    .map((v) => v.name)
    .filter((name) => poisonReasonByVariable.has(name))
    .map((name) => ({ name, reason: poisonReasonByVariable.get(name)! }));

  const eligibleSet = new Set(eligible);
  const bonusReach = ruleModule.bonusPredicates.map((predicate): BonusReach => {
    if (predicate.kind === "constant") {
      return {
        name: predicate.name,
        canMove: false,
        reason: `constant ${String(predicate.value)} predicate — structurally inert, reads no threshold variable at all`,
      };
    }
    const clauses = clausesOf(predicate);
    const honours = (clause: RpThresholdClause): boolean => isSingleUnscaled(clause) && eligibleSet.has(clause.terms[0]!.variable);
    const honouring = clauses.filter(honours);
    const blocked = clauses.filter((clause) => !honours(clause));

    if (honouring.length === 0) {
      return {
        name: predicate.name,
        canMove: false,
        reason: `${predicate.kind}, no clause honours a declared family — every clause is a scaled sum or reads a poisoned variable, so all of them keep declaring gaussian`,
      };
    }
    if (blocked.length === 0) {
      return { name: predicate.name, canMove: true, reason: `${predicate.kind}, every clause a single unscaled term over an eligible variable` };
    }
    return {
      name: predicate.name,
      canMove: true,
      reason:
        `${predicate.kind}, PARTIALLY reachable — ${honouring.length} of ${clauses.length} clauses honour the declared family ` +
        `(over {${honouring.map((c) => c.terms[0]!.variable).join(", ")}}), while {${blocked.flatMap((c) => c.terms.map((t) => t.variable)).join(", ")}} stay gaussian as scaled sums or poisoned variables`,
    };
  });

  return { eligible, poisoned, bonusReach };
}

/**
 * Builds the NB arm's VARIANT RULE MODULE by spreading the real one and
 * flipping `marginalFamily` on the ELIGIBLE variables only. The original
 * module is never mutated, and every poisoned variable keeps declaring
 * `"gaussian"`.
 *
 * An object spread drops the prototype, which is safe here because no season
 * module's `parse` or `evaluateBonuses` uses `this` — re-verified against HEAD
 * on 2026-09-12 by grepping every registered season module (the only `this`
 * occurrences are inside prose comments). If that ever changes, clone
 * differently rather than abandoning this seam: the seam is what keeps the arm
 * out of production.
 */
export function ruleModuleWithMarginalArm(ruleModule: RpRuleModule, eligible: readonly string[]): RpRuleModule {
  const eligibleSet = new Set(eligible);
  return {
    ...ruleModule,
    thresholdVariables: ruleModule.thresholdVariables.map((v) => ({
      ...v,
      marginalFamily: eligibleSet.has(v.name) ? ("negative-binomial" as const) : v.marginalFamily,
    })),
  };
}

// ---------------------------------------------------------------------------
// THE OUTCOME-ARM ACCEPTANCE BAR (2026-09-13, quick task 260913-qyn)
// ---------------------------------------------------------------------------
//
// PRE-COMMITTED BEFORE ANY ARM FIGURE EXISTS. `applyRpOutcomeArmBar` lands in
// git history strictly before the WIN/TIE/WIN+TIE outcome-half arms it judges
// can produce a single number — the same discipline plan 09-06's per-bonus
// bar and quick task 260912-2uz's marginal-arm slice guard both follow, so
// that no accept/reject line here can ever be read as fitted to a result that
// was already in hand.
//
// APPLIED MECHANICALLY, WITH NO OVERRIDE. An arm is accepted if and only if
// its pooled total-RP RPS AND its pooled outcome Brier are BOTH strictly
// lower than control's — no tolerance, no "close enough", no partial credit
// for improving one score while tying or losing on the other. Among accepted
// arms, the one with the lowest pooled RPS ships; an exact RPS tie between two
// accepted arms breaks on lower pooled Brier, and a further tie breaks on the
// fixed preference order WIN, TIE, WIN+TIE (never on measurement order or
// insertion order, which would make the ship choice depend on how the caller
// happened to list its arms). WIN+TIE ships only when WIN+TIE is ITSELF
// accepted by the same two-sided rule as any other arm — a combined arm that
// improves RPS but not Brier (or vice versa) is rejected exactly like a
// single-fix arm would be, never granted credit for the pieces it is built
// from. When nothing is accepted, `control` ships, which is this codebase's
// existing "when nothing clears the bar, change nothing" convention (D-06 of
// plan 09-06).
export type ArmName = "control" | "win" | "tie" | "win+tie";

/** Preference order for breaking an exact RPS-and-Brier tie between two accepted arms. `control` never appears here — it is never itself a candidate to ship over an accepted arm. */
const ARM_TIE_BREAK_ORDER: readonly ArmName[] = ["win", "tie", "win+tie"];

/**
 * One arm's pooled figures on the selection slice — pooled across every
 * season and every scored (match, alliance) or (match) observation, NEVER
 * per-season. The bar is deliberately blind to per-season figures: those are
 * reported alongside the verdict for a human reader, but the accept/reject
 * decision itself is a single pooled comparison per arm, so a mixed
 * per-season result (better on some seasons, worse on others) cannot be
 * gamed into acceptance by how the seasons happen to be weighted.
 */
export interface ArmPooledFigures {
  readonly arm: ArmName;
  readonly totalRpCount: number;
  readonly totalRpRps: number;
  readonly outcomeCount: number;
  readonly outcomeBrier: number;
}

/** One arm's accept/reject verdict against control, plus its signed deltas (arm minus control; negative is an improvement in both scores). `control`'s own verdict is always `accepted: false` — control cannot accept itself. */
export interface ArmVerdict {
  readonly arm: ArmName;
  readonly accepted: boolean;
  readonly rpsDelta: number;
  readonly brierDelta: number;
}

/** The bar's full output: every arm's verdict, and the mechanical ship choice. */
export interface RpOutcomeArmBarResult {
  readonly verdicts: readonly ArmVerdict[];
  readonly ship: ArmName;
}

/**
 * Applies the pre-committed outcome-arm bar to one set of pooled figures.
 * `pooled` must contain exactly one `"control"` entry; every other entry is
 * judged against it.
 *
 * THROWS, rather than silently comparing, when an arm's `totalRpCount` or
 * `outcomeCount` differs from control's — the two arms must have scored the
 * IDENTICAL observation set (the same discipline `assertBonusHalfIdentical`
 * enforces for the bonus half at Task 2), so a count mismatch means the
 * comparison itself is void, not that one arm happened to do better on a
 * smaller sample. THROWS on a non-finite `totalRpRps` or `outcomeBrier` on
 * any arm (control included) rather than letting a `NaN` propagate into an
 * accept decision that would silently evaluate to `false` on every
 * comparison — a `NaN` compared with `<` is never `true`, which would make a
 * broken measurement look identical to an honestly-rejected arm.
 */
export function applyRpOutcomeArmBar(pooled: readonly ArmPooledFigures[]): RpOutcomeArmBarResult {
  const control = pooled.find((p) => p.arm === "control");
  if (control === undefined) {
    throw new Error(`applyRpOutcomeArmBar: no "control" entry in the supplied pooled figures — the bar has nothing to compare against`);
  }
  for (const p of pooled) {
    if (!Number.isFinite(p.totalRpRps) || !Number.isFinite(p.outcomeBrier)) {
      throw new Error(`applyRpOutcomeArmBar: arm "${p.arm}" has a non-finite figure (totalRpRps=${p.totalRpRps}, outcomeBrier=${p.outcomeBrier}) — refusing to judge it`);
    }
    if (p.arm === "control") continue;
    if (p.totalRpCount !== control.totalRpCount || p.outcomeCount !== control.outcomeCount) {
      throw new Error(
        `applyRpOutcomeArmBar: arm "${p.arm}" scored totalRpCount=${p.totalRpCount}/outcomeCount=${p.outcomeCount} against control's totalRpCount=${control.totalRpCount}/outcomeCount=${control.outcomeCount} — the two arms must see the identical observation set, so this comparison is void`
      );
    }
  }

  const verdicts: ArmVerdict[] = pooled.map((p) => {
    if (p.arm === "control") return { arm: p.arm, accepted: false, rpsDelta: 0, brierDelta: 0 };
    const rpsDelta = p.totalRpRps - control.totalRpRps;
    const brierDelta = p.outcomeBrier - control.outcomeBrier;
    const accepted = p.totalRpRps < control.totalRpRps && p.outcomeBrier < control.outcomeBrier;
    return { arm: p.arm, accepted, rpsDelta, brierDelta };
  });

  const accepted = verdicts.filter((v) => v.accepted);
  let ship: ArmName = "control";
  if (accepted.length > 0) {
    const byArm = new Map(pooled.map((p) => [p.arm, p]));
    const sorted = [...accepted].sort((a, b) => {
      const figA = byArm.get(a.arm)!;
      const figB = byArm.get(b.arm)!;
      if (figA.totalRpRps !== figB.totalRpRps) return figA.totalRpRps - figB.totalRpRps;
      if (figA.outcomeBrier !== figB.outcomeBrier) return figA.outcomeBrier - figB.outcomeBrier;
      return ARM_TIE_BREAK_ORDER.indexOf(a.arm) - ARM_TIE_BREAK_ORDER.indexOf(b.arm);
    });
    ship = sorted[0]!.arm;
  }

  return { verdicts, ship };
}

// ---------------------------------------------------------------------------
// THE OUTCOME-ARM COMPARISON — `--outcome-arms` (2026-09-13, quick task
// 260913-qyn Task 1 Step 4). Guards and the reader/writer schema land here,
// pre-committed alongside the bar; Task 2 is the ONLY caller permitted to
// invoke this seam with `--outcome-arms` set.
// ---------------------------------------------------------------------------

/**
 * The first season of the RESERVED REPORTING SLICE for the outcome-arm
 * comparison — the same 2023 boundary `RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON`
 * uses, on its OWN axis: this guard governs `--outcome-arms`, not
 * `--marginal-arm`, and the two measurement seams are refused in
 * combination (see `main()`'s guard) so a run can never spend both
 * reservations' worth of reporting-slice protection in one pass.
 */
export const RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON = 2023;

/** The selection slice `--outcome-arms` runs on — 2016-2020 plus 2022, named in `assertOutcomeArmSliceAllowed`'s own error message. */
export const RP_OUTCOME_ARM_SELECTION_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022];

/**
 * Refuses any season at or above `RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON` for
 * the outcome-arm comparison. READS THE PARSED SEASON LIST, BEFORE
 * `openCorpusReadOnly` — a wide spec like `--seasons 2016-2026` is REFUSED
 * rather than silently trimmed, and there is no override flag, for the same
 * reasons `assertMarginalArmSliceAllowed` gives for its own axis.
 */
export function assertOutcomeArmSliceAllowed(parsedSeasons: readonly number[]): void {
  const forbidden = parsedSeasons.filter((s) => s >= RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON);
  if (forbidden.length === 0) return;
  throw new Error(
    `--outcome-arms refuses season(s) ${forbidden.join(", ")}: this comparison runs on the SELECTION SLICE only — ${RP_OUTCOME_ARM_SELECTION_SEASONS.join(", ")} — never the ${RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON}-2026 reporting slice. A spec that merely spans the reporting slice is refused rather than trimmed, so that asking for it is never quietly answered with something else. There is no override flag, deliberately.`
  );
}

/**
 * Requires the resolved algorithm list to be EXACTLY `["spr"]` — the
 * outcome half (`matchOutcomePmf`) exists only for the one algorithm
 * `SigmaScoutLayer` publishes ranking points for, so any other resolved list
 * (including the empty default of every published algorithm) would silently
 * measure zero observations rather than failing loudly.
 */
export function assertOutcomeArmAlgorithmAllowed(algorithmIds: readonly string[]): void {
  if (algorithmIds.length === 1 && algorithmIds[0] === "spr") return;
  throw new Error(
    `--outcome-arms requires the resolved algorithm list to be exactly ["spr"], got [${algorithmIds.join(", ")}] — pass --algorithm spr explicitly`
  );
}

/** The four bonus-half fields that must be bitwise identical across every outcome arm. */
const BONUS_HALF_FIELDS = ["redBonusRpPmf", "blueBonusRpPmf", "redBonusRp", "blueBonusRp"] as const;

/**
 * Throws on any presence or elementwise `===` mismatch of the four
 * bonus-half fields between `control` and `arm` for the SAME folded match —
 * the outcome arms (`win`, `tie`, `win+tie`) may move ONLY the outcome half
 * (`matchOutcomePmf`/`redOutcomeRp`/`blueOutcomeRp`), never the bonus half.
 * A mismatch here means the seam is wrong and the whole comparison is void,
 * so it throws by match key and field rather than reporting a number nobody
 * can trust.
 */
export function assertBonusHalfIdentical(control: Prediction, arm: Prediction, matchKey: string, armName: string): void {
  for (const field of BONUS_HALF_FIELDS) {
    const c = control[field];
    const a = arm[field];
    const cPresent = c !== undefined;
    const aPresent = a !== undefined;
    if (cPresent !== aPresent) {
      throw new Error(
        `assertBonusHalfIdentical: match ${matchKey} arm "${armName}" field "${field}" presence differs from control (control ${cPresent ? "present" : "absent"}, arm ${aPresent ? "present" : "absent"})`
      );
    }
    if (!cPresent || c === undefined || a === undefined) continue;
    if (c.length !== a.length) {
      throw new Error(`assertBonusHalfIdentical: match ${matchKey} arm "${armName}" field "${field}" length differs from control (${c.length} vs ${a.length})`);
    }
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== a[i]) {
        throw new Error(
          `assertBonusHalfIdentical: match ${matchKey} arm "${armName}" field "${field}"[${i}] = ${a[i]} !== control's ${c[i]} — the bonus half must be bitwise === across every arm`
        );
      }
    }
  }
}

const RpOutcomeArmNameSchema = z.enum(["control", "win", "tie", "win+tie"]);

/** Structurally identical to `TotalRpSummary` — a standalone zod schema because `TotalRpSummary` is a plain TS type, not a schema. */
const RpOutcomeArmTotalSchema = z.object({
  count: z.number().int().nonnegative(),
  rankedProbabilityScore: z.number().finite(),
  meanPredictedRp: z.number().finite(),
  meanActualRp: z.number().finite(),
  excludedNullActual: z.number().int().nonnegative(),
  excludedOutOfSupport: z.number().int().nonnegative(),
});

/** Structurally identical to `OutcomeSummary` — see `RpOutcomeArmTotalSchema`'s own comment. */
const RpOutcomeArmOutcomeSchema = z.object({
  count: z.number().int().nonnegative(),
  brierScore: z.number().finite(),
  meanPredictedTie: z.number().finite(),
  observedTieRate: z.number().finite(),
});

const RpOutcomeArmSeasonFiguresSchema = z.object({
  season: z.number().int(),
  totalRp: RpOutcomeArmTotalSchema.optional(),
  outcome: RpOutcomeArmOutcomeSchema.optional(),
});

const RpOutcomeArmPooledFiguresRecordSchema = z.object({
  arm: RpOutcomeArmNameSchema,
  totalRp: RpOutcomeArmTotalSchema.optional(),
  outcome: RpOutcomeArmOutcomeSchema.optional(),
  perSeason: z.array(RpOutcomeArmSeasonFiguresSchema),
});

const RpOutcomeArmVerdictSchema = z.object({
  arm: RpOutcomeArmNameSchema,
  accepted: z.boolean(),
  rpsDelta: z.number().finite(),
  brierDelta: z.number().finite(),
});

/** F6, per arm — descriptive only, never a gate (see the console report of the same name). */
const RpOutcomeArmF6GapSchema = z.object({
  arm: RpOutcomeArmNameSchema,
  n: z.number().int().nonnegative(),
  medianAbsDiff: z.number().finite(),
  p90AbsDiff: z.number().finite(),
  maxAbsDiff: z.number().finite(),
  favouriteDisagreements: z.number().int().nonnegative(),
});

/**
 * `--emit-outcome-arms`'s committed record shape (Task 1 Step 4). Every
 * figure is pooled AND per-season, so a reader can audit the bar's own
 * pooled-comparison decision against the per-season detail without
 * re-running the replay. `ship` is `applyRpOutcomeArmBar`'s own mechanical
 * choice over the pooled figures, stored rather than re-derived, so a
 * reader of the committed record never has to re-run the bar to know what
 * it decided.
 */
export const RpOutcomeArmRecordSchema = z.object({
  measuredAt: z.string().min(1),
  command: z.string().min(1),
  corpusIdentity: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    mtime: z.string().min(1),
  }),
  algorithmVersions: z.record(z.string(), z.string()),
  seasons: z.array(z.number().int()),
  arms: z.array(RpOutcomeArmPooledFiguresRecordSchema),
  f6Gap: z.array(RpOutcomeArmF6GapSchema),
  barVerdicts: z.array(RpOutcomeArmVerdictSchema),
  ship: RpOutcomeArmNameSchema,
});
export type RpOutcomeArmRecord = z.infer<typeof RpOutcomeArmRecordSchema>;

/**
 * Exported (promoted from the module-local `BUCKET_EDGES`) so the artifact
 * emitter (`buildRpCalibrationRecord` below) and any future consumer share
 * ONE bucket definition rather than a second hand-copied literal. The final
 * edge is `1.0000001`, not `1`, so a prediction of exactly `1.0` lands in the
 * last bucket instead of falling off the end — unchanged from the original
 * `BUCKET_EDGES`.
 */
export const RP_RELIABILITY_BUCKET_EDGES = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001];

function reliabilityTable(observations: readonly Observation[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < RP_RELIABILITY_BUCKET_EDGES.length - 1; i++) {
    const lo = RP_RELIABILITY_BUCKET_EDGES[i]!;
    const hi = RP_RELIABILITY_BUCKET_EDGES[i + 1]!;
    const inBucket = observations.filter((o) => o.predicted >= lo && o.predicted < hi);
    if (inBucket.length === 0) continue;
    const predicted = meanPredicted(inBucket);
    const observed = rate(inBucket);
    const gap = observed - predicted;
    const flag = Math.abs(gap) > 0.05 ? (gap > 0 ? "  <- under-predicts" : "  <- over-predicts") : "";
    lines.push(
      `      [${lo.toFixed(2)},${hi >= 1 ? "1.00" : hi.toFixed(2)})  n=${String(inBucket.length).padStart(6)}  ` +
        `predicted=${predicted.toFixed(4)}  observed=${observed.toFixed(4)}  gap=${gap >= 0 ? "+" : ""}${gap.toFixed(4)}${flag}`
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// THE TOTAL-RP AND OUTCOME SCORERS (2026-09-13, quick task 260913-qyn)
// ---------------------------------------------------------------------------
//
// The 09-06 bar scored bonuses only, so it was blind to F6 (win source) and
// F7 (tie model) — 30 of 30 cells tied and both fixes were reverted. These
// two scorers can SEE the win/tie half: `rankedProbabilityScore` grades
// `redRpPmf`/`blueRpPmf` (a distribution over the RP TOTAL) against the
// actual alliance RP, and `outcomeBrier` grades `matchOutcomePmf` (the
// win/tie/loss split) against `match.winner`. Both are PURE and read no
// state, so they are exercised directly against hand-picked pmfs in
// `measureRpCalibration.test.ts` before ever touching a real replay.

/**
 * The ranked probability score of one discrete RP pmf against the actual
 * integer RP earned: `RPS = (1/maxRp) * sum_{k=0}^{maxRp-1} (cdf(k) - [actual <= k])^2`,
 * with `maxRp = pmf.length - 1`. Bounded `[0, 1]`; 0 is a perfect point-mass
 * prediction, 1 is the worst possible (a point mass at the opposite end of
 * the support from the actual). Every selection-slice season has `maxRp` 4,
 * so this normalisation cannot bias an arm comparison run on that slice; it
 * keeps 2025-2026 (`maxRp` 6) comparable on the published card.
 *
 * `actual` must already be validated as an in-support integer — callers
 * route a null or out-of-support actual through the summary builders below,
 * which exclude it before this function ever sees it, rather than this
 * function silently coercing an invalid input.
 */
export function rankedProbabilityScore(pmf: readonly number[], actual: number): number {
  const maxRp = pmf.length - 1;
  let cdf = 0;
  let sum = 0;
  for (let k = 0; k < maxRp; k++) {
    cdf += pmf[k]!;
    const indicator = actual <= k ? 1 : 0;
    const diff = cdf - indicator;
    sum += diff * diff;
  }
  return sum / maxRp;
}

/**
 * The three-outcome Brier score of `matchOutcomePmf`
 * (`[pRedWin, pTie, pBlueWin]`) against `match.winner`: the sum of the three
 * squared errors against a one-hot actual vector. 0 is perfect, 2 is worst.
 * NOT comparable to the site's binary win Brier — a caller or renderer must
 * never place the two side by side as if they were the same quantity.
 */
export function outcomeBrier(pmf3: readonly number[], winner: "red" | "blue" | "tie"): number {
  const actual = winner === "red" ? [1, 0, 0] : winner === "tie" ? [0, 1, 0] : [0, 0, 1];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const diff = pmf3[i]! - actual[i]!;
    sum += diff * diff;
  }
  return sum;
}

/** One alliance-side's total-RP observation: its predicted RP-total pmf, and the actual integer RP earned (or `null` when not derivable — D-02's convention). */
export interface TotalRpObservation {
  readonly pmf: readonly number[];
  readonly actual: number | null;
}

/** One match's outcome observation: the predicted win/tie/loss split, and what actually happened. */
export interface MatchOutcomeObservation {
  readonly pmf3: readonly number[];
  readonly winner: "red" | "blue" | "tie";
}

/** The RP scorecard's total-RP block — see `RpCalibrationTotalSchema` (publish.ts) for the wire shape this mirrors. */
export type TotalRpSummary = NonNullable<RpCalibrationRecord["totalRp"]>;

/** The RP scorecard's outcome block — see `RpCalibrationOutcomeSchema` (publish.ts) for the wire shape this mirrors. */
export type OutcomeSummary = NonNullable<RpCalibrationRecord["outcome"]>;

/**
 * Builds the total-RP block from one (season, algorithm)'s raw alliance-side
 * observations, or `undefined` when zero observations SCORED (the same
 * absence discipline `bonuses` already uses — never a coerced zero).
 *
 * An observation with a `null` actual increments `excludedNullActual`; an
 * observation whose actual is a non-integer or falls outside `[0, pmf.length
 * - 1]` increments `excludedOutOfSupport` (an offseason event's non-standard
 * RP, e.g. Oregon BunnyBots — the same population `toIntegerRpOrNull`
 * degrades to `null` for a non-integer, but a corpus-legal integer can still
 * exceed a season's own `maxRp`). Neither excluded observation enters
 * `count` or either mean.
 */
export function buildTotalRpSummary(observations: readonly TotalRpObservation[]): TotalRpSummary | undefined {
  let excludedNullActual = 0;
  let excludedOutOfSupport = 0;
  const scored: { pmf: readonly number[]; actual: number }[] = [];

  for (const o of observations) {
    if (o.actual === null) {
      excludedNullActual++;
      continue;
    }
    const maxRp = o.pmf.length - 1;
    if (!Number.isInteger(o.actual) || o.actual < 0 || o.actual > maxRp) {
      excludedOutOfSupport++;
      continue;
    }
    scored.push({ pmf: o.pmf, actual: o.actual });
  }

  if (scored.length === 0) return undefined;

  const rankedProbabilityScoreMean = scored.reduce((sum, o) => sum + rankedProbabilityScore(o.pmf, o.actual), 0) / scored.length;
  const meanPredictedRp = scored.reduce((sum, o) => sum + pmfMean(o.pmf), 0) / scored.length;
  const meanActualRp = scored.reduce((sum, o) => sum + o.actual, 0) / scored.length;

  return {
    count: scored.length,
    rankedProbabilityScore: rankedProbabilityScoreMean,
    meanPredictedRp,
    meanActualRp,
    excludedNullActual,
    excludedOutOfSupport,
  };
}

/**
 * Builds the outcome block from one (season, algorithm)'s raw match-outcome
 * observations, or `undefined` when zero observations scored — every
 * observation here already carries a non-null `match.winner`, so there is no
 * exclusion count to track (unlike `buildTotalRpSummary`, whose actual can be
 * null or out of support).
 */
export function buildOutcomeSummary(observations: readonly MatchOutcomeObservation[]): OutcomeSummary | undefined {
  if (observations.length === 0) return undefined;
  const brierScore = observations.reduce((sum, o) => sum + outcomeBrier(o.pmf3, o.winner), 0) / observations.length;
  const meanPredictedTie = observations.reduce((sum, o) => sum + o.pmf3[1]!, 0) / observations.length;
  const observedTieRate = observations.filter((o) => o.winner === "tie").length / observations.length;
  return { count: observations.length, brierScore, meanPredictedTie, observedTieRate };
}

/**
 * Pure: builds one (season, algorithm) publishable calibration record from
 * this season's bonus names and the per-bonus observations folded during the
 * walk-forward loop. Built from the SAME `brier`/`rate`/`meanPredicted`
 * helpers the console report above already uses — never a parallel
 * computation (D-11's "one scorer" requirement extends to this emitter, not
 * just to the console path).
 *
 * A bonus with zero observations is OMITTED from `bonuses` rather than
 * emitted with `NaN` figures (T-09-04) — the same "absence, not a coerced
 * zero" discipline the wire schema documents. `reliabilityBins` pools EVERY
 * bonus's observations for this (season, algorithm) into one set of buckets,
 * mirroring the console report's own pooled-per-season framing; an empty
 * bucket gets `null` figures and `count: 0`, never a divide-by-zero NaN.
 *
 * `outcomeObservations` (2026-09-13, quick task 260913-qyn) is an OPTIONAL
 * third argument carrying the raw total-RP and outcome observations folded
 * during the SAME walk-forward loop; each block is added to the returned
 * record only when `buildTotalRpSummary`/`buildOutcomeSummary` returns a
 * defined summary (i.e. its count is above 0) — the same absence discipline
 * `bonuses` already uses. Omitting the argument entirely (every pre-260913-qyn
 * caller) produces a record with neither key, byte-identical to before this
 * task.
 */
export function buildRpCalibrationRecord(
  bonusNames: readonly string[],
  perBonusObservations: readonly (readonly Observation[])[],
  outcomeObservations?: {
    readonly totalRp?: readonly TotalRpObservation[];
    readonly outcome?: readonly MatchOutcomeObservation[];
  }
): RpCalibrationRecord {
  const bonuses: RpCalibrationRecord["bonuses"][number][] = [];
  const pooled: Observation[] = [];

  for (let i = 0; i < bonusNames.length; i++) {
    const observations = perBonusObservations[i] ?? [];
    pooled.push(...observations);
    if (observations.length === 0) continue;
    bonuses.push({
      name: bonusNames[i]!,
      count: observations.length,
      meanPredicted: meanPredicted(observations),
      observedFrequency: rate(observations),
      brierScore: brier(observations),
    });
  }

  // Task 2 Step 5 (2026-09-11): the wire record used to also carry a
  // `reliabilityBins` array here, pooled the same way `reliabilityTable`
  // below buckets for the console. Real measured bytes showed attaching it
  // to every 2016 qualification slice (three algorithms' worth) pushed
  // `compare-2016.json` to 21,260 bytes against the committed 20,000-byte
  // `budgetMaxBytes` — dropped per this plan's pre-committed remedy (shrink
  // the block, never raise the budget), since nothing on the Compare page
  // ever read it. `RP_RELIABILITY_BUCKET_EDGES` remains exported and used
  // by `reliabilityTable` below for the console report, which is unaffected.
  const totalRp = outcomeObservations?.totalRp !== undefined ? buildTotalRpSummary(outcomeObservations.totalRp) : undefined;
  const outcome = outcomeObservations?.outcome !== undefined ? buildOutcomeSummary(outcomeObservations.outcome) : undefined;

  return {
    scoredCount: pooled.length,
    bonuses,
    ...(totalRp !== undefined ? { totalRp } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
  };
}

// ---------------------------------------------------------------------------
// THE COMMITTED ATTRIBUTION RECORD (09-06 Task 2)
// ---------------------------------------------------------------------------

/** The committed record's home. */
export const RP_ATTRIBUTION_PATH = "data/baselines/rp-attribution-2026-09.json";

/**
 * F10's dot threshold, DUPLICATED here as a default rather than imported.
 * `apps/web/src/lib/bonusRp.ts` is the publisher of
 * `PREDICTED_BONUS_THRESHOLD`, and an offline measurement script importing
 * from the web app would couple the pipeline to the client bundle for one
 * float. The two are kept honest by an EQUALITY PIN on the web side
 * (`apps/web/src/lib/bonusRp.test.ts` asserts the committed record's
 * `dotThreshold` equals the constant), so a change to either fails loudly
 * instead of letting the measurement drift off the constant it describes.
 *
 * THE THRESHOLD ITSELF IS NOT CHANGED BY THIS PLAN. F10's display half was
 * offered and not taken up; only its UPSTREAM cause is in scope.
 */
export const RP_DOT_THRESHOLD_DEFAULT = 0.5;

/**
 * D-05 AFTER D-06: the shipped combination, in words, once the config object
 * that described it no longer exists. Rendered exactly as the deleted label
 * function rendered it, so the string in a measurement emitted today is
 * comparable with one emitted before the collapse.
 *
 * Written into the measurement's own header by the emitter below and read by
 * nothing. It costs zero wire bytes: `buildCompareArtifact` attaches per-slice
 * calibration records, never the measurement header — which matters, because
 * 09-01 measured the `compare` page kind at 14,088 bytes against a
 * 20,000-byte ceiling and this plan must not spend that headroom.
 */
export const SHIPPED_RP_LAYER_LABEL = "winSource=score-draw, tieModel=continuous-equality, marginal=gaussian";

/**
 * One scored cell under one arm, plus F10's dot-eligible share.
 *
 * The three figures are `null` — never `NaN` — when `count` is 0. A
 * non-finite number in a committed measurement formats downstream as a dash
 * and reads identically to "no data" (T-09-06-08); a `null` says which it is.
 */
export interface RpAttributionCell {
  readonly arm: string;
  readonly algorithmId: string;
  readonly season: number;
  readonly bonusName: string;
  readonly count: number;
  readonly meanPredicted: number | null;
  readonly observedFrequency: number | null;
  readonly brierScore: number | null;
  /** F10 UPSTREAM: the share of this cell's alliance-sides whose predicted probability reaches the dot threshold. */
  readonly dotEligibleShare: number | null;
}

/** One bonus's movement between 09-01's frozen pre-engine-swap file and the `control` arm at HEAD. */
export interface RpCrossGenerationCell {
  readonly algorithmId: string;
  readonly season: number;
  readonly bonusName: string;
  readonly frozenMeanPredicted: number;
  readonly controlMeanPredicted: number | null;
  readonly frozenBrier: number;
  readonly controlBrier: number | null;
  readonly observedFrequency: number | null;
}

/** F6 and F7's descriptive population figures, per arm, on the reporting slice. NEITHER IS A GATE. */
export interface RpOutcomeCoherence {
  readonly arm: string;
  readonly n: number;
  /** F6: mean |pmf-implied pRedWin - published pRedWin|. Zero BY CONSTRUCTION under the `win` arm. */
  readonly meanAbsPRedWinDiff: number | null;
  /** F7: mean predicted tie probability, against the audit's measured base rate of 1206/110362. */
  readonly meanPredictedTie: number | null;
}

const RpAttributionCellSchema = z.object({
  arm: z.string().min(1),
  algorithmId: z.string().min(1),
  season: z.number().int(),
  bonusName: z.string().min(1),
  count: z.number().int().nonnegative(),
  meanPredicted: z.number().finite().nullable(),
  observedFrequency: z.number().finite().nullable(),
  brierScore: z.number().finite().nullable(),
  dotEligibleShare: z.number().finite().nullable(),
});

const RpArmVerdictSchema = z.object({
  arm: z.string().min(1),
  scored: z.number().int().nonnegative(),
  improved: z.number().int().nonnegative(),
  regressed: z.number().int().nonnegative(),
  tied: z.number().int().nonnegative(),
  meetsBar: z.boolean(),
});

/**
 * THE RECORD'S SCHEMA DELIBERATELY REFERENCES NO LAYER-CONFIG TYPE.
 *
 * Every arm's configuration is stored as a PLAIN MAP OF FIELD NAME TO MEMBER
 * STRING (`z.record(z.string(), z.string())`), and so is the decision's ship
 * config. This is not tidiness. D-06 deletes that type at the end of this
 * plan, and a record schema, a digest builder or a document sync test typed
 * against it would die with it — taking the committed measurement's drift
 * guard down at exactly the moment the code that produced the measurement
 * stops existing. A measurement that outlives its generating code is how this
 * project already carries its other measured rejections, and it only works if
 * the record stands on its own.
 */
export const RpAttributionRecordSchema = z.object({
  measuredAt: z.string().min(1),
  command: z.string().min(1),
  corpusIdentity: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    mtime: z.string().min(1),
  }),
  offseasonIncluded: z.boolean(),
  algorithmVersions: z.record(z.string(), z.string()),
  armConfigs: z.record(z.string(), z.record(z.string(), z.string())),
  dotThreshold: z.number().finite(),
  selectionSlice: z.object({ seasons: z.array(z.number().int()), cells: z.array(RpAttributionCellSchema) }),
  reportingSlice: z.object({ seasons: z.array(z.number().int()), cells: z.array(RpAttributionCellSchema) }),
  marginalResolution: z.record(
    z.string(),
    z.object({
      negativeBinomial: z.number().int().nonnegative(),
      gaussian: z.number().int().nonnegative(),
      degenerate: z.number().int().nonnegative(),
      fallbacks: z.number().int().nonnegative(),
    })
  ),
  armVerdicts: z.array(RpArmVerdictSchema),
  decision: z.object({
    shipConfig: z.record(z.string(), z.string()),
    acceptedFields: z.array(z.string()),
    revertedFields: z.array(z.string()),
    path: z.array(z.string()),
  }),
  crossGeneration: z.array(
    z.object({
      algorithmId: z.string().min(1),
      season: z.number().int(),
      bonusName: z.string().min(1),
      frozenMeanPredicted: z.number().finite(),
      controlMeanPredicted: z.number().finite().nullable(),
      frozenBrier: z.number().finite(),
      controlBrier: z.number().finite().nullable(),
      observedFrequency: z.number().finite().nullable(),
    })
  ),
  outcomeCoherence: z.array(
    z.object({
      arm: z.string().min(1),
      n: z.number().int().nonnegative(),
      meanAbsPRedWinDiff: z.number().finite().nullable(),
      meanPredictedTie: z.number().finite().nullable(),
    })
  ),
});
export type RpAttributionRecord = z.infer<typeof RpAttributionRecordSchema>;

/**
 * THE WRITER HALF IS GONE, THE READER HALF REMAINS (plan 09-06 Task 4).
 *
 * `buildRpAttributionRecord` built the committed record by applying D-09's bar
 * to eight measured arms. The bar, the arms and the config surface they
 * selected between were all deleted once the bar refused every one of them, so
 * the builder has no subject and went with them.
 *
 * Everything below this point is PURE OVER THE COMMITTED JSON and references
 * nothing that was deleted. That is what lets
 * `data/baselines/rp-attribution-2026-09.json` and its document keep a working
 * drift guard after the code that produced them stopped existing — the record
 * was deliberately schema'd against plain strings rather than against the
 * layer-config type for exactly this moment.
 */

/**
 * The machine-readable block `docs/models/rp-attribution.md` carries, and that
 * its sync test deep-equals against this function applied to the committed
 * record. A figure edited in the prose without regenerating the block fails
 * that test — this project's own failure log carries "the README described a
 * model that had been deleted", and this is the test class that prevents it.
 *
 * PURE OVER THE COMMITTED JSON. It references no layer-config type, so it
 * survives D-06's collapse along with the record and the document.
 */
export function buildRpAttributionDigest(record: RpAttributionRecord): unknown {
  const pooled = (arm: string, cells: readonly RpAttributionCell[]): { n: number; meanPredicted: number | null; observedFrequency: number | null } => {
    const mine = cells.filter((c) => c.arm === arm && c.count > 0);
    const n = mine.reduce((sum, c) => sum + c.count, 0);
    if (n === 0) return { n: 0, meanPredicted: null, observedFrequency: null };
    return {
      n,
      meanPredicted: mine.reduce((sum, c) => sum + c.meanPredicted! * c.count, 0) / n,
      observedFrequency: mine.reduce((sum, c) => sum + c.observedFrequency! * c.count, 0) / n,
    };
  };
  // The arm-naming convention the measurement used: accepted fields joined in
  // this fixed order, or "control" for none. Inlined here rather than imported
  // because the registry that owned it is deleted — and frozen, because the
  // committed record it reads is frozen.
  const ARM_FIELD_ORDER = ["win", "tie", "marginal"];
  const accepted = ARM_FIELD_ORDER.filter((f) => record.decision.acceptedFields.includes(f));
  const shipped = accepted.length === 0 ? "control" : accepted.join("+");
  const autoBonus2025 = (arm: string): RpAttributionCell | undefined =>
    record.reportingSlice.cells.find((c) => c.arm === arm && c.season === 2025 && c.bonusName === "autoBonus" && c.algorithmId === "bpr");

  return {
    measuredAt: record.measuredAt,
    command: record.command,
    corpusIdentity: record.corpusIdentity,
    arms: Object.keys(record.armConfigs),
    armConfigs: record.armConfigs,
    dotThreshold: record.dotThreshold,
    selectionSeasons: record.selectionSlice.seasons,
    reportingSeasons: record.reportingSlice.seasons,
    reportingCellCount: record.reportingSlice.cells.length,
    selectionCellCount: record.selectionSlice.cells.length,
    armVerdicts: record.armVerdicts,
    decision: record.decision,
    shippedArm: shipped,
    marginalResolution: record.marginalResolution,
    pooledReporting: {
      control: pooled("control", record.reportingSlice.cells),
      shipped: pooled(shipped, record.reportingSlice.cells),
      fullChange: pooled("win+tie+marginal", record.reportingSlice.cells),
    },
    f10AutoBonus2025Bpr: {
      control: autoBonus2025("control")?.dotEligibleShare ?? null,
      shipped: autoBonus2025(shipped)?.dotEligibleShare ?? null,
      observedFrequency: autoBonus2025("control")?.observedFrequency ?? null,
    },
    outcomeCoherence: record.outcomeCoherence,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = args[args.indexOf("--seasons") + 1] ?? "2023-2026";
  // Task 2 widening (D-09): absent --algorithm resolves to EVERY published
  // algorithm — `resolvePublishAlgorithms(undefined)`'s own documented
  // default. `--algorithm` accepts a comma-separated list.
  const algorithmIdsCsv = args.indexOf("--algorithm") === -1 ? undefined : args[args.indexOf("--algorithm") + 1]!;
  const emitArtifactPath = args.indexOf("--emit-artifact") === -1 ? undefined : args[args.indexOf("--emit-artifact") + 1];
  const marginalArm = args.includes("--marginal-arm");
  // Task 1 Step 4 (260913-qyn): `--outcome-arms` scores WIN/TIE/WIN+TIE
  // against control from one replay per season, folded through
  // `SigmaScoutLayer`'s measurement-only third constructor argument.
  const outcomeArms = args.includes("--outcome-arms");
  const emitOutcomeArmsPath = args.indexOf("--emit-outcome-arms") === -1 ? undefined : args[args.indexOf("--emit-outcome-arms") + 1];

  // THE SLICE GUARD COMES FIRST, and it reads the PARSED list — before the
  // rule-module filter, before `openCorpusReadOnly`, before any replay. See
  // `assertMarginalArmSliceAllowed`/`assertOutcomeArmSliceAllowed` for why a
  // wide spec is refused rather than trimmed, and why there is no override.
  const parsedSeasons = parseSeasons(seasonsSpec);
  if (marginalArm) assertMarginalArmSliceAllowed(parsedSeasons);
  if (outcomeArms) {
    if (marginalArm) {
      throw new Error(`--outcome-arms cannot be combined with --marginal-arm — the two measurement seams must never run in the same pass`);
    }
    assertOutcomeArmSliceAllowed(parsedSeasons);
  }

  const seasons = parsedSeasons.filter((s) => RP_RULE_MODULES[s] !== undefined);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);
  if (algorithms.length === 0) throw new Error(`no algorithms resolved from "${algorithmIdsCsv ?? "(default)"}"`);
  if (outcomeArms) assertOutcomeArmAlgorithmAllowed(algorithms.map((a) => a.id));

  console.log(`RP calibration — algorithms [${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}], seasons ${seasons.join(", ")}`);
  console.log(`Walk-forward through the same SigmaScoutLayer the publisher runs.\n`);
  if (marginalArm) {
    console.log(`NEGATIVE-BINOMIAL ARM ACTIVE (quick task 260912-2uz) — control and NB layers folded from ONE replay per season,`);
    console.log(`scored by the SAME brier/rate/meanPredicted helpers. Selection slice only; ${RP_MARGINAL_ARM_FORBIDDEN_FROM_SEASON}-2026 is refused by construction.\n`);
  }
  if (outcomeArms) {
    console.log(`OUTCOME-ARM COMPARISON ACTIVE (quick task 260913-qyn) — control, WIN, TIE and WIN+TIE folded from ONE replay per season,`);
    console.log(`scored by the SAME rankedProbabilityScore/outcomeBrier helpers. Selection slice only; ${RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON}-2026 is refused by construction.\n`);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    // Pooled PER ALGORITHM across seasons, for that algorithm's own headline
    // claims — mixing algorithms into one pooled figure would average away
    // exactly the per-algorithm comparison D-09/D-11 need.
    const allMarginalByAlgo = new Map<string, Observation[]>(algorithms.map((a) => [a.id, []]));
    const allPairsByAlgo = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>(algorithms.map((a) => [a.id, []]));
    const emittedRecords: { season: number; algorithmId: string; calibration: RpCalibrationRecord }[] = [];
    // F6 GAP (2026-09-13, quick task 260913-qyn) — descriptive only, NEVER a
    // gate: |matchOutcomePmf[0] - pRedWin| pooled across every season, per
    // algorithm, so the console can report how much the control arm's
    // score-draw win probability disagrees with the algorithm's own
    // published pRedWin (the audit's F6 question) without that figure
    // deciding anything.
    const f6DiffsByAlgo = new Map<string, number[]>(algorithms.map((a) => [a.id, []]));
    const f6FavouriteDisagreementsByAlgo = new Map<string, number>(algorithms.map((a) => [a.id, 0]));
    const f6TotalByAlgo = new Map<string, number>(algorithms.map((a) => [a.id, 0]));
    const marginalTally = emptyMarginalResolutionTally();
    // The NB arm's own running tally, kept on its own axis so the control
    // arm's resolution counts are never contaminated by it.
    const armTally = emptyMarginalResolutionTally();
    /** One reachable/unreachable cell of the NB arm's result, accumulated across seasons for the closing report. */
    const armCells: {
      season: number;
      algorithmId: string;
      bonus: string;
      canMove: boolean;
      reason: string;
      n: number;
      controlBrier: number;
      armBrier: number;
    }[] = [];

    // Outcome-arm accumulators (260913-qyn Task 1 Step 4) — pooled across
    // every season AND per-season, keyed by `ArmName`. Populated only when
    // `outcomeArms` is set (algorithms is exactly `["spr"]` by the guard
    // above); otherwise every map stays empty and costs nothing.
    const OUTCOME_ARM_NAMES: readonly ArmName[] = ["control", "win", "tie", "win+tie"];
    const outcomeArmPooledTotalRp = new Map<ArmName, TotalRpObservation[]>(OUTCOME_ARM_NAMES.map((a) => [a, []]));
    const outcomeArmPooledOutcome = new Map<ArmName, MatchOutcomeObservation[]>(OUTCOME_ARM_NAMES.map((a) => [a, []]));
    const outcomeArmSeasonFigures = new Map<ArmName, { season: number; totalRp?: TotalRpSummary; outcome?: OutcomeSummary }[]>(
      OUTCOME_ARM_NAMES.map((a) => [a, []])
    );
    const outcomeArmF6Diffs = new Map<ArmName, number[]>(OUTCOME_ARM_NAMES.map((a) => [a, []]));
    const outcomeArmF6Favourite = new Map<ArmName, number>(OUTCOME_ARM_NAMES.map((a) => [a, 0]));
    const outcomeArmF6Total = new Map<ArmName, number>(OUTCOME_ARM_NAMES.map((a) => [a, 0]));

    for (const season of seasons) {
      const ruleModule = RP_RULE_MODULES[season]!;
      // Built ONCE per season and shared across every algorithm — the
      // publisher's own `Map<string, SigmaScoutLayer>` shape (`publish.ts`'s
      // season loop), folded from one shared record list, so a
      // multi-algorithm pass costs one replay instead of one per algorithm.
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
      const records = new WalkForwardSimulator(stream).runAll(algorithms, teams);
      const actualFlags = actualBonusFlagsForSeason(stream, season);

      // SAME-SCORER FIX (see header): the second constructor argument selects
      // the Sigma band variance exactly the way the publisher's own layer
      // construction does (publish.ts's season loop) — without it this script
      // silently scored a different band than the one it published.
      const layers = new Map(algorithms.map((a) => [a.id, new SigmaScoutLayer(ruleModule, a.id)]));
      const perBonusByAlgo = new Map<string, Observation[][]>(algorithms.map((a) => [a.id, ruleModule.bonusNames.map(() => [])]));
      const pairsByAlgo = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>(algorithms.map((a) => [a.id, []]));
      // Total-RP / outcome observations (260913-qyn), reset per season —
      // population is EVERY played bonus-RP-eligible match whose folded
      // prediction carries a pmf, NOT gated on actualBonusFlagsForSeason
      // (design point 5: the bonus loop's own `continue` below must not skip
      // these scorers).
      const totalRpByAlgo = new Map<string, TotalRpObservation[]>(algorithms.map((a) => [a.id, []]));
      const outcomeByAlgo = new Map<string, MatchOutcomeObservation[]>(algorithms.map((a) => [a.id, []]));

      // THE NB ARM MULTIPLIES LAYERS, NEVER REPLAYS. `records` above is the
      // one and only walk-forward pass for this season; the arm folds the SAME
      // records through a second layer per algorithm, built from the variant
      // rule module and constructed with the SAME two arguments the control
      // layer and the publisher use.
      const eligibility = marginalArm ? deriveMarginalArmEligibility(ruleModule) : undefined;
      const armRuleModule = eligibility === undefined ? undefined : ruleModuleWithMarginalArm(ruleModule, eligibility.eligible);
      const armLayers =
        armRuleModule === undefined ? undefined : new Map(algorithms.map((a) => [a.id, new SigmaScoutLayer(armRuleModule, a.id)]));
      const armPerBonusByAlgo =
        armRuleModule === undefined
          ? undefined
          : new Map<string, Observation[][]>(algorithms.map((a) => [a.id, ruleModule.bonusNames.map(() => [])]));

      // THE OUTCOME-ARM LAYERS MULTIPLY LAYERS, NEVER REPLAYS — same
      // discipline as the NB arm above. `records` is the one and only
      // walk-forward pass for this season; WIN/TIE/WIN+TIE each fold the
      // SAME records through their own `SigmaScoutLayer`, constructed with
      // the SAME (ruleModule, "spr") the control layer uses plus the
      // measurement-only third argument. Guarded so these three layers exist
      // only when `--outcome-arms` is set (algorithms is exactly `["spr"]`).
      const outcomeArmLayers = outcomeArms
        ? {
            win: new SigmaScoutLayer(ruleModule, "spr", { win: true }),
            tie: new SigmaScoutLayer(ruleModule, "spr", { tie: true }),
            "win+tie": new SigmaScoutLayer(ruleModule, "spr", { win: true, tie: true }),
          }
        : undefined;
      const seasonOutcomeArmTotalRp = outcomeArms
        ? new Map<ArmName, TotalRpObservation[]>(OUTCOME_ARM_NAMES.map((a) => [a, []]))
        : undefined;
      const seasonOutcomeArmOutcome = outcomeArms
        ? new Map<ArmName, MatchOutcomeObservation[]>(OUTCOME_ARM_NAMES.map((a) => [a, []]))
        : undefined;

      for (const r of records) {
        const layer = layers.get(r.algorithmId)!;
        const enriched = layer.foldPlayed(r.match, r.prediction);
        const armEnriched = armLayers === undefined ? undefined : armLayers.get(r.algorithmId)!.foldPlayed(r.match, r.prediction);

        // TOTAL-RP AND OUTCOME SCORING (260913-qyn design point 5) — runs
        // BEFORE the bonus-flag `continue` below, on purpose: this
        // population is every played bonus-RP-eligible match whose folded
        // prediction carries a pmf, never gated on
        // `actualBonusFlagsForSeason`'s own per-match derivability.
        if (isBonusRpCompLevel(r.match.compLevel)) {
          const pred = enriched.prediction;
          if (pred.redRpPmf !== undefined && pred.blueRpPmf !== undefined) {
            const totalRpObs = totalRpByAlgo.get(r.algorithmId)!;
            totalRpObs.push({ pmf: pred.redRpPmf, actual: toIntegerRpOrNull(r.match.redRpEarned) });
            totalRpObs.push({ pmf: pred.blueRpPmf, actual: toIntegerRpOrNull(r.match.blueRpEarned) });
          }
          if (pred.matchOutcomePmf !== undefined) {
            outcomeByAlgo.get(r.algorithmId)!.push({ pmf3: pred.matchOutcomePmf, winner: r.match.winner });

            // F6 GAP — descriptive only, NOT a gate (see the pooled
            // declaration's own comment above).
            const diff = Math.abs(pred.matchOutcomePmf[0]! - pred.pRedWin);
            f6DiffsByAlgo.get(r.algorithmId)!.push(diff);
            const pmfFavoursRed = pred.matchOutcomePmf[0]! > 0.5;
            const pRedWinFavoursRed = pred.pRedWin > 0.5;
            f6TotalByAlgo.set(r.algorithmId, (f6TotalByAlgo.get(r.algorithmId) ?? 0) + 1);
            if (pmfFavoursRed !== pRedWinFavoursRed) {
              f6FavouriteDisagreementsByAlgo.set(r.algorithmId, (f6FavouriteDisagreementsByAlgo.get(r.algorithmId) ?? 0) + 1);
            }
          }
        }

        // OUTCOME-ARM SCORING (260913-qyn Task 1 Step 4) — WIN, TIE and
        // WIN+TIE folded from the SAME record `enriched` above already
        // folded through control, so all four arms see the identical
        // (match, prediction) pair. `assertBonusHalfIdentical` runs on EVERY
        // folded record, before any observation is scored — a mismatch
        // voids the whole comparison and must surface immediately, at the
        // match that caused it, never averaged away by later matches.
        if (outcomeArmLayers !== undefined && isBonusRpCompLevel(r.match.compLevel)) {
          const controlPred = enriched.prediction;
          const winPred = outcomeArmLayers.win.foldPlayed(r.match, r.prediction).prediction;
          const tiePred = outcomeArmLayers.tie.foldPlayed(r.match, r.prediction).prediction;
          const winTiePred = outcomeArmLayers["win+tie"].foldPlayed(r.match, r.prediction).prediction;

          assertBonusHalfIdentical(controlPred, winPred, r.match.matchKey, "win");
          assertBonusHalfIdentical(controlPred, tiePred, r.match.matchKey, "tie");
          assertBonusHalfIdentical(controlPred, winTiePred, r.match.matchKey, "win+tie");

          const predByArm: Record<ArmName, Prediction> = { control: controlPred, win: winPred, tie: tiePred, "win+tie": winTiePred };
          for (const armName of OUTCOME_ARM_NAMES) {
            const pred = predByArm[armName];
            if (pred.redRpPmf !== undefined && pred.blueRpPmf !== undefined) {
              const obs = seasonOutcomeArmTotalRp!.get(armName)!;
              obs.push({ pmf: pred.redRpPmf, actual: toIntegerRpOrNull(r.match.redRpEarned) });
              obs.push({ pmf: pred.blueRpPmf, actual: toIntegerRpOrNull(r.match.blueRpEarned) });
            }
            if (pred.matchOutcomePmf !== undefined) {
              seasonOutcomeArmOutcome!.get(armName)!.push({ pmf3: pred.matchOutcomePmf, winner: r.match.winner });
              const diff = Math.abs(pred.matchOutcomePmf[0]! - pred.pRedWin);
              outcomeArmF6Diffs.get(armName)!.push(diff);
              outcomeArmF6Total.set(armName, (outcomeArmF6Total.get(armName) ?? 0) + 1);
              const pmfFavoursRedArm = pred.matchOutcomePmf[0]! > 0.5;
              const pRedWinFavoursRedArm = pred.pRedWin > 0.5;
              if (pmfFavoursRedArm !== pRedWinFavoursRedArm) {
                outcomeArmF6Favourite.set(armName, (outcomeArmF6Favourite.get(armName) ?? 0) + 1);
              }
            }
          }
        }

        const actual = actualFlags.get(r.match.matchKey);
        if (actual === undefined || actual === null) continue;

        const perBonus = perBonusByAlgo.get(r.algorithmId)!;
        const armPerBonus = armPerBonusByAlgo?.get(r.algorithmId);
        const pairs = pairsByAlgo.get(r.algorithmId)!;
        const allMarginal = allMarginalByAlgo.get(r.algorithmId)!;

        for (const side of ["red", "blue"] as const) {
          const predictedBonuses = side === "red" ? enriched.prediction.redBonusRp : enriched.prediction.blueBonusRp;
          const actualBonuses = side === "red" ? actual.red : actual.blue;
          if (predictedBonuses === undefined) continue;
          if (predictedBonuses.length !== actualBonuses.length) continue;

          for (let i = 0; i < predictedBonuses.length; i++) {
            const observation = { predicted: predictedBonuses[i]!, actual: actualBonuses[i]! };
            perBonus[i]!.push(observation);
            allMarginal.push(observation);
          }
          // The correlation claim needs the FIRST TWO bonuses of a season
          // together on the same alliance — the pair the diagonal block claims
          // are independent.
          if (predictedBonuses.length >= 2) {
            pairs.push({ p1: predictedBonuses[0]!, p2: predictedBonuses[1]!, a1: actualBonuses[0]!, a2: actualBonuses[1]! });
          }

          // The arm's observations are gated by the CONTROL arm's own
          // conditions above, so the two arms provably see the same
          // (match, alliance, bonus) triples — the identical-observation-set
          // requirement, enforced by construction and then asserted per bonus
          // after the season.
          if (armPerBonus !== undefined && armEnriched !== undefined) {
            const armPredicted = side === "red" ? armEnriched.prediction.redBonusRp : armEnriched.prediction.blueBonusRp;
            if (armPredicted !== undefined && armPredicted.length === actualBonuses.length) {
              for (let i = 0; i < armPredicted.length; i++) {
                armPerBonus[i]!.push({ predicted: armPredicted[i]!, actual: actualBonuses[i]! });
              }
            }
          }
        }
      }

      // Outcome-arm season finalization (260913-qyn Task 1 Step 4): assert
      // every arm's counts equal control's for THIS season (a divergence
      // would mean an arm folded a different set of matches than control —
      // the identical-observation-set requirement, checked per season
      // before pooling), build this season's per-arm summaries, print them,
      // and fold the raw observations into the pooled accumulators.
      if (outcomeArms && seasonOutcomeArmTotalRp !== undefined && seasonOutcomeArmOutcome !== undefined) {
        const controlTotalRpCount = seasonOutcomeArmTotalRp.get("control")!.length;
        const controlOutcomeCount = seasonOutcomeArmOutcome.get("control")!.length;
        for (const armName of OUTCOME_ARM_NAMES) {
          const totalRpCount = seasonOutcomeArmTotalRp.get(armName)!.length;
          const outcomeCount = seasonOutcomeArmOutcome.get(armName)!.length;
          if (totalRpCount !== controlTotalRpCount || outcomeCount !== controlOutcomeCount) {
            throw new Error(
              `--outcome-arms: season ${season} arm "${armName}" scored totalRpCount=${totalRpCount}/outcomeCount=${outcomeCount} against control's totalRpCount=${controlTotalRpCount}/outcomeCount=${controlOutcomeCount} — the two arms must see the identical observation set, so this comparison is void`
            );
          }

          const totalRpSummary = buildTotalRpSummary(seasonOutcomeArmTotalRp.get(armName)!);
          const outcomeSummary = buildOutcomeSummary(seasonOutcomeArmOutcome.get(armName)!);
          outcomeArmSeasonFigures.get(armName)!.push({
            season,
            ...(totalRpSummary !== undefined ? { totalRp: totalRpSummary } : {}),
            ...(outcomeSummary !== undefined ? { outcome: outcomeSummary } : {}),
          });

          outcomeArmPooledTotalRp.get(armName)!.push(...seasonOutcomeArmTotalRp.get(armName)!);
          outcomeArmPooledOutcome.get(armName)!.push(...seasonOutcomeArmOutcome.get(armName)!);

          if (totalRpSummary !== undefined || outcomeSummary !== undefined) {
            console.log(
              `── ${season} OUTCOME ARM [${armName}] ── ` +
                `totalRp: n=${totalRpSummary?.count ?? 0} rps=${totalRpSummary?.rankedProbabilityScore.toFixed(6) ?? "—"}  ` +
                `outcome: n=${outcomeSummary?.count ?? 0} brier=${outcomeSummary?.brierScore.toFixed(6) ?? "—"}`
            );
          }
        }
        console.log("");
      }

      for (const algorithm of algorithms) {
        const perBonus = perBonusByAlgo.get(algorithm.id)!;
        const pairs = pairsByAlgo.get(algorithm.id)!;
        allPairsByAlgo.get(algorithm.id)!.push(...pairs);
        emittedRecords.push({
          season,
          algorithmId: algorithm.id,
          calibration: buildRpCalibrationRecord(ruleModule.bonusNames, perBonus, {
            totalRp: totalRpByAlgo.get(algorithm.id),
            outcome: outcomeByAlgo.get(algorithm.id),
          }),
        });

        // The fallback ladder's running diagnostic: how often a fit resolved to
        // something other than what its variable declared. Read from
        // `FittedMarginal.resolved`, never `.declared`, with fallbacks on a
        // separate axis.
        const layerTally = layers.get(algorithm.id)!.rpMarginalResolutionTally;
        marginalTally.negativeBinomial += layerTally.negativeBinomial;
        marginalTally.gaussian += layerTally.gaussian;
        marginalTally.degenerate += layerTally.degenerate;
        marginalTally.fallbacks += layerTally.fallbacks;

        if (armLayers !== undefined && armPerBonusByAlgo !== undefined && eligibility !== undefined) {
          const armLayerTally = armLayers.get(algorithm.id)!.rpMarginalResolutionTally;
          armTally.negativeBinomial += armLayerTally.negativeBinomial;
          armTally.gaussian += armLayerTally.gaussian;
          armTally.degenerate += armLayerTally.degenerate;
          armTally.fallbacks += armLayerTally.fallbacks;

          const armPerBonus = armPerBonusByAlgo.get(algorithm.id)!;
          const reachByBonus = new Map(eligibility.bonusReach.map((b) => [b.name, b]));
          for (const [i, name] of ruleModule.bonusNames.entries()) {
            const controlObservations = perBonus[i]!;
            const armObservations = armPerBonus[i]!;
            // THE IDENTICAL-OBSERVATION-SET ASSERTION, in flight. The layer's
            // eligibility gates run before any family branch, so the counts
            // cannot legitimately differ; an inequality means the seam is
            // wrong and the whole comparison is void, so it throws rather than
            // reporting a number nobody can trust.
            if (controlObservations.length !== armObservations.length) {
              throw new Error(
                `--marginal-arm: season ${season} [${algorithm.id}] bonus "${name}" scored ${controlObservations.length} control observations against ${armObservations.length} arm observations — the two arms must see the identical observation set, so this comparison is void`
              );
            }
            if (controlObservations.length === 0) continue;
            const reach = reachByBonus.get(name);
            armCells.push({
              season,
              algorithmId: algorithm.id,
              bonus: name,
              canMove: reach?.canMove ?? false,
              reason: reach?.reason ?? "no predicate found for this bonus name",
              n: controlObservations.length,
              controlBrier: brier(controlObservations),
              armBrier: brier(armObservations),
            });
          }

          console.log(`── ${season} [${algorithm.id}] NB ARM PARTITION (derived at runtime from bonusPredicates) ──`);
          console.log(`   eligible variables (declare negative-binomial): ${eligibility.eligible.length > 0 ? eligibility.eligible.join(", ") : "(none)"}`);
          for (const p of eligibility.poisoned) console.log(`   POISONED ${p.name}: ${p.reason}`);
          for (const b of eligibility.bonusReach) console.log(`   ${b.canMove ? "CAN MOVE  " : "cannot move"} ${b.name}: ${b.reason}`);
          console.log("");
        }

        const total = perBonus.reduce((sum, b) => sum + b.length, 0);
        console.log(`── ${season} [${algorithm.id}] ── ${total} (alliance, bonus) observations`);
        if (total === 0) {
          console.log(`   no scored bonus observations this season\n`);
          continue;
        }

        for (const [i, name] of ruleModule.bonusNames.entries()) {
          const observations = perBonus[i]!;
          if (observations.length === 0) continue;
          console.log(
            `   ${name}: n=${observations.length}  mean predicted=${meanPredicted(observations).toFixed(4)}  ` +
              `observed=${rate(observations).toFixed(4)}  Brier=${brier(observations).toFixed(4)}`
          );
          for (const line of reliabilityTable(observations)) console.log(line);
        }

        if (pairs.length > 0) {
          const [n1, n2] = [ruleModule.bonusNames[0]!, ruleModule.bonusNames[1]!];
          const both = pairs.filter((p) => p.a1 && p.a2).length / pairs.length;
          const rateA = pairs.filter((p) => p.a1).length / pairs.length;
          const rateB = pairs.filter((p) => p.a2).length / pairs.length;
          const independentJoint = rateA * rateB;
          const modelJoint = pairs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / pairs.length;
          console.log(
            `   JOINT (${n1} AND ${n2}): observed=${both.toFixed(4)}  ` +
              `if independent=${independentJoint.toFixed(4)}  model implies=${modelJoint.toFixed(4)}  ` +
              `real dependence=${both - independentJoint >= 0 ? "+" : ""}${(both - independentJoint).toFixed(4)}`
          );
        }
        console.log("");
      }
    }

    // ---- Pooled headline claims, ONE PER ALGORITHM ----
    for (const algorithm of algorithms) {
      const allMarginal = allMarginalByAlgo.get(algorithm.id)!;
      const allPairs = allPairsByAlgo.get(algorithm.id)!;
      if (allMarginal.length === 0) continue;

      console.log(`═══ POOLED [${algorithm.id}] ═══`);
      console.log(`${allMarginal.length} (alliance, bonus) observations across ${seasons.length} season(s)\n`);

      console.log(`OVERALL: mean predicted=${meanPredicted(allMarginal).toFixed(4)}  observed=${rate(allMarginal).toFixed(4)}  Brier=${brier(allMarginal).toFixed(4)}`);

      const confident = allMarginal.filter((o) => o.predicted < 0.05 || o.predicted > 0.95);
      const lowConfident = allMarginal.filter((o) => o.predicted < 0.05);
      const highConfident = allMarginal.filter((o) => o.predicted > 0.95);
      console.log(
        `\nTHE EXTREMES CLAIM — ${((confident.length / allMarginal.length) * 100).toFixed(1)}% of predictions are below 0.05 or above 0.95`
      );
      if (lowConfident.length > 0) {
        console.log(
          `   predicted <0.05: n=${lowConfident.length}  mean predicted=${meanPredicted(lowConfident).toFixed(4)}  ` +
            `ACTUALLY happened ${(rate(lowConfident) * 100).toFixed(2)}% of the time`
        );
      }
      if (highConfident.length > 0) {
        console.log(
          `   predicted >0.95: n=${highConfident.length}  mean predicted=${meanPredicted(highConfident).toFixed(4)}  ` +
            `ACTUALLY happened ${(rate(highConfident) * 100).toFixed(2)}% of the time`
        );
      }

      if (allPairs.length > 0) {
        const both = allPairs.filter((p) => p.a1 && p.a2).length / allPairs.length;
        const rateA = allPairs.filter((p) => p.a1).length / allPairs.length;
        const rateB = allPairs.filter((p) => p.a2).length / allPairs.length;
        const independentJoint = rateA * rateB;
        const modelJoint = allPairs.reduce((sum, p) => sum + p.p1 * p.p2, 0) / allPairs.length;
        console.log(`\nTHE CORRELATION CLAIM — n=${allPairs.length} alliance-matches carrying two bonuses`);
        console.log(`   observed P(both)                     = ${both.toFixed(4)}`);
        console.log(`   P(A)*P(B), i.e. if truly independent = ${independentJoint.toFixed(4)}`);
        console.log(`   the model's own implied P(both)      = ${modelJoint.toFixed(4)}`);
        const dependence = both - independentJoint;
        console.log(
          `   REAL dependence the diagonal block discards = ${dependence >= 0 ? "+" : ""}${dependence.toFixed(4)} ` +
            `(${dependence > 0 ? "POSITIVE — the two go together more often than independence predicts, as the header expected" : "NEGATIVE — the two go together LESS often than independence predicts, opposite to what the header expected"})`
        );
      }
      console.log("");
    }

    console.log(`═══ MARGINAL RESOLUTION (FittedMarginal.resolved, never .declared) ═══`);
    console.log(
      `   control arm: negativeBinomial=${marginalTally.negativeBinomial}  gaussian=${marginalTally.gaussian}  degenerate=${marginalTally.degenerate}  ` +
        `(fallbacks counted separately: ${marginalTally.fallbacks})\n`
    );

    if (marginalArm) {
      const armTotal = armTally.negativeBinomial + armTally.gaussian + armTally.degenerate;
      const nbFraction = armTotal === 0 ? Number.NaN : armTally.negativeBinomial / armTotal;
      console.log(
        `   NB arm:      negativeBinomial=${armTally.negativeBinomial}  gaussian=${armTally.gaussian}  degenerate=${armTally.degenerate}  ` +
          `(fallbacks counted separately: ${armTally.fallbacks})`
      );
      console.log(
        `   NB RESOLUTION FRACTION: ${(nbFraction * 100).toFixed(2)}% of the NB arm's ${armTotal} fits genuinely resolved to negative binomial.`
      );
      console.log(
        `   A run where most fits fell back (non-positive mean, or variance <= mean) is a result about the FIT'S APPLICABILITY, not a verdict on the family.\n`
      );

      // ---- THE THREE CATEGORIES, NEVER POOLED ----
      //
      // Pooling structurally-inert ties with live cells is what made plan
      // 09-06's verdict worthless: 24 of 30 cells could not have moved, and
      // their ties were reported as evidence the family does not help.
      const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : "—");
      const reachable = armCells.filter((c) => c.canMove);
      const unreachable = armCells.filter((c) => !c.canMove);
      const moved = reachable.filter((c) => Math.abs(c.armBrier - c.controlBrier) > 1e-12);
      const fallbackTies = reachable.filter((c) => Math.abs(c.armBrier - c.controlBrier) <= 1e-12);

      console.log(`═══ NEGATIVE-BINOMIAL ARM — THREE CATEGORIES, REPORTED SEPARATELY ═══`);
      console.log(`\n1. REACHABLE CELLS (${reachable.length} of ${armCells.length}) — the partition says these CAN respond to the family swap.`);
      console.log(`   The gain or loss is evaluated on these cells and only these.`);
      for (const c of reachable) {
        const delta = c.armBrier - c.controlBrier;
        const verdict = Math.abs(delta) <= 1e-12 ? "TIED" : delta < 0 ? "IMPROVED" : "REGRESSED";
        console.log(
          `   ${c.season} [${c.algorithmId}] ${c.bonus}: n=${c.n}  control=${fmt(c.controlBrier)}  nb=${fmt(c.armBrier)}  ` +
            `delta=${delta >= 0 ? "+" : ""}${fmt(delta)}  ${verdict}`
        );
      }
      const improved = reachable.filter((c) => c.armBrier < c.controlBrier - 1e-12).length;
      const regressed = reachable.filter((c) => c.armBrier > c.controlBrier + 1e-12).length;
      console.log(`   -> ${improved} improved / ${regressed} regressed / ${reachable.length - improved - regressed} tied, over ${reachable.length} reachable cells.`);

      console.log(`\n2. STRUCTURALLY UNREACHABLE CELLS (${unreachable.length} of ${armCells.length}) — these TIE WITH CONTROL BY CONSTRUCTION.`);
      console.log(`   That is a structural fact about the predicate, and is NEVER evidence about the family.`);
      for (const c of unreachable) {
        const identical = Math.abs(c.armBrier - c.controlBrier) <= 1e-12;
        console.log(
          `   ${c.season} [${c.algorithmId}] ${c.bonus}: n=${c.n}  brier=${fmt(c.controlBrier)}  ` +
            `${identical ? "identical to control, as predicted" : `UNEXPECTEDLY DIFFERS (${fmt(c.armBrier)}) — investigate, the partition may be wrong`}  — ${c.reason}`
        );
      }

      console.log(`\n3. FALLBACK TIES — reachable cells whose Brier did not move at all (${fallbackTies.length} of ${reachable.length} reachable).`);
      console.log(`   Read these together with the NB RESOLUTION FRACTION above: a reachable cell that tied because its fit fell`);
      console.log(`   back to Gaussian is a statement about the fit's applicability to that variable, not about the family.`);
      for (const c of fallbackTies) {
        console.log(`   ${c.season} [${c.algorithmId}] ${c.bonus}: n=${c.n}  brier=${fmt(c.controlBrier)}  no movement`);
      }
      console.log(`   Reachable cells that DID move: ${moved.length}.\n`);
    }

    // ---- F6 GAP (260913-qyn) — descriptive only, NEVER a gate. Reports how
    // much the control arm's score-draw win probability (matchOutcomePmf[0])
    // disagrees with the algorithm's own published pRedWin, pooled across
    // every season for that algorithm.
    for (const algorithm of algorithms) {
      const diffs = f6DiffsByAlgo.get(algorithm.id) ?? [];
      if (diffs.length === 0) continue;
      const sorted = [...diffs].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
      const max = sorted[sorted.length - 1]!;
      const disagreements = f6FavouriteDisagreementsByAlgo.get(algorithm.id) ?? 0;
      const total = f6TotalByAlgo.get(algorithm.id) ?? 0;
      console.log(`═══ F6 GAP (descriptive only, NOT a gate) [${algorithm.id}] ═══`);
      console.log(
        `n=${diffs.length}  median|diff|=${median.toFixed(6)}  p90=${p90.toFixed(6)}  max=${max.toFixed(6)}  ` +
          `favourite disagreements=${disagreements}/${total}\n`
      );
    }

    // ---- Grand-pooled headline, across EVERY algorithm AND season — the
    // single figure 09-01-SUMMARY.md sets beside ranking-points-audit.md
    // F2's recorded 0.1507 / 0.3109. Computed directly from the emitted
    // records so it matches whatever byte the measurement file itself
    // carries, never a separate re-derivation.
    const grandPooled = emittedRecords.flatMap((r) =>
      r.calibration.bonuses.map((b) => ({ p: b.meanPredicted, o: b.observedFrequency, n: b.count }))
    );
    if (grandPooled.length > 0) {
      const totalN = grandPooled.reduce((sum, g) => sum + g.n, 0);
      const grandMeanPredicted = grandPooled.reduce((sum, g) => sum + g.p * g.n, 0) / totalN;
      const grandObserved = grandPooled.reduce((sum, g) => sum + g.o * g.n, 0) / totalN;
      console.log(`═══ GRAND POOLED (every algorithm, every season) ═══`);
      console.log(`n=${totalN}  mean predicted=${grandMeanPredicted.toFixed(4)}  observed=${grandObserved.toFixed(4)}`);
    }

    // ---- OUTCOME-ARM BAR APPLICATION (260913-qyn Task 1 Step 4) — applied
    // MECHANICALLY over the pooled figures, no override, exactly the rule
    // `applyRpOutcomeArmBar` implements. Task 1 NEVER runs this with
    // `--outcome-arms` set against real data — this wiring exists so Task 2
    // is the first and only caller to produce a real arm figure.
    if (outcomeArms) {
      const pooledFigures: ArmPooledFigures[] = OUTCOME_ARM_NAMES.map((armName) => {
        const totalRpSummary = buildTotalRpSummary(outcomeArmPooledTotalRp.get(armName)!);
        const outcomeSummary = buildOutcomeSummary(outcomeArmPooledOutcome.get(armName)!);
        return {
          arm: armName,
          totalRpCount: totalRpSummary?.count ?? 0,
          totalRpRps: totalRpSummary?.rankedProbabilityScore ?? Number.NaN,
          outcomeCount: outcomeSummary?.count ?? 0,
          outcomeBrier: outcomeSummary?.brierScore ?? Number.NaN,
        };
      });
      const barResult = applyRpOutcomeArmBar(pooledFigures);

      console.log(`═══ OUTCOME-ARM BAR VERDICT (260913-qyn, applied mechanically) ═══`);
      for (const verdict of barResult.verdicts) {
        console.log(
          `   ${verdict.arm}: ${verdict.arm === "control" ? "(baseline)" : verdict.accepted ? "ACCEPTED" : "rejected"}  ` +
            `rpsDelta=${verdict.rpsDelta >= 0 ? "+" : ""}${verdict.rpsDelta.toFixed(6)}  ` +
            `brierDelta=${verdict.brierDelta >= 0 ? "+" : ""}${verdict.brierDelta.toFixed(6)}`
        );
      }
      console.log(`   SHIP: ${barResult.ship}\n`);

      if (emitOutcomeArmsPath !== undefined) {
        const stat = statSync(CORPUS_PATH);
        const armsRecord = OUTCOME_ARM_NAMES.map((armName) => ({
          arm: armName,
          totalRp: buildTotalRpSummary(outcomeArmPooledTotalRp.get(armName)!),
          outcome: buildOutcomeSummary(outcomeArmPooledOutcome.get(armName)!),
          perSeason: outcomeArmSeasonFigures.get(armName)!,
        }));
        const f6Gap = OUTCOME_ARM_NAMES.map((armName) => {
          const diffs = outcomeArmF6Diffs.get(armName)!;
          const sorted = [...diffs].sort((a, b) => a - b);
          const n = sorted.length;
          const median = n === 0 ? 0 : sorted[Math.floor((n - 1) / 2)]!;
          const p90 = n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(n * 0.9))]!;
          const max = n === 0 ? 0 : sorted[n - 1]!;
          return {
            arm: armName,
            n,
            medianAbsDiff: median,
            p90AbsDiff: p90,
            maxAbsDiff: max,
            favouriteDisagreements: outcomeArmF6Favourite.get(armName) ?? 0,
          };
        });

        const candidate = {
          measuredAt: new Date().toISOString(),
          command: `npx tsx scripts/measureRpCalibration.ts ${args.join(" ")}`,
          corpusIdentity: { path: CORPUS_PATH, sizeBytes: stat.size, mtime: stat.mtime.toISOString() },
          algorithmVersions: Object.fromEntries(algorithms.map((a) => [a.id, a.version])),
          seasons,
          arms: armsRecord,
          f6Gap,
          barVerdicts: barResult.verdicts,
          ship: barResult.ship,
        };
        const parsed = RpOutcomeArmRecordSchema.parse(candidate);
        writeFileSync(emitOutcomeArmsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        console.log(`wrote ${emitOutcomeArmsPath}`);
      }
    }

    if (emitArtifactPath !== undefined) {
      const candidate = {
        measuredAt: new Date().toISOString(),
        command: `npx tsx scripts/measureRpCalibration.ts ${args.join(" ")}`,
        corpusIdentity: CORPUS_PATH,
        // The stream above is built with `includeOffseason: true` and this
        // task does not change that — the number's population is recorded
        // here rather than quietly altered.
        offseasonIncluded: true,
        algorithmVersions: Object.fromEntries(algorithms.map((a) => [a.id, a.version])),
        // D-05 after D-06: the shipped combination has no config object left
        // to describe it, so it is recorded as a LABEL in the measurement's own
        // header. Written by this emitter, read by nothing, and costing ZERO
        // wire bytes — `buildCompareArtifact` attaches per-slice calibration
        // records and never the measurement's header. That is how D-05's
        // self-describing requirement is answered once D-06 has deleted the
        // thing it was describing.
        rpLayer: SHIPPED_RP_LAYER_LABEL,
        records: emittedRecords,
      };
      const parsed = RpCalibrationMeasurementSchema.parse(candidate);
      writeFileSync(emitArtifactPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      console.log(`\nwrote ${emitArtifactPath}`);
    }
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without the harness
// trying to open a corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:rp-calibration failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
