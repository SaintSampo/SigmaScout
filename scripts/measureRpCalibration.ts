/**
 * Measures the SigmaScout RP layer's published bonus probabilities against
 * what actually happened.
 *
 * Per season it reports reliability per bonus (mean predicted vs observed,
 * Brier, a bucketed table), how often predictions below 0.05 or above 0.95 come
 * true (a too-narrow distribution is wrong more often than its confidence), and
 * observed P(A and B) against P(A)*P(B), the dependence the model's
 * independent thresholds drop (see `empiricalMoments.ts`'s simplifications).
 *
 * Walk-forward through the same `SigmaScoutLayer` the publisher runs, built
 * with the same two arguments (rule module and algorithm id); the id selects the
 * band-variance source, so omitting it silently scores from the wrong variance.
 *
 * `data/baselines/rp-calibration-2026-09.json` predates the closed-form engine;
 * a comparison against it measures the engine swap and must be labelled
 * cross-generation.
 *
 * `--attribution-out`'s reader half (schema and digest builder) is pure over
 * committed JSON, so its drift guard is independent of the scoring code.
 *
 * `--marginal-arm` scores a measurement-only second layer whose eligible
 * threshold variables declare `"negative-binomial"` instead of the season
 * module's family. It runs on whatever `--seasons` names.
 *
 * Usage:
 *   npx tsx scripts/measureRpCalibration.ts [--seasons 2024-2026] [--algorithm spr] [--emit-artifact <path>] [--marginal-arm]
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
import { emptyMarginalResolutionTally, pmfMean, type MarginalResolutionTally } from "../packages/core/rankingPoints/analyticPmf.js";
import { isBonusRpCompLevel } from "../packages/core/rankingPoints/constants.js";
import type { Prediction } from "../packages/core/algorithms/types.js";
import { isOfficialEventType } from "../packages/core/algorithms/eventTypes.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** One (match, alliance, bonus) prediction paired with what happened. */
export interface Observation {
  readonly predicted: number;
  readonly actual: boolean;
}

/** Exported so the slice guard is tested against the CLI's own parse. */
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
// The measurement-only negative-binomial arm
// ---------------------------------------------------------------------------
//
// No production surface: the arm is a variant rule module handed to a second
// `SigmaScoutLayer` with the publisher's two-argument construction. The arms
// multiply layers, never replays (one stream and one simulator run per season),
// and share the control path's `brier`/`rate`/`meanPredicted` helpers.

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
 * Every clause a predicate contains. The `never` default makes a new predicate
 * kind a compile error. `nestedSameVariable` is exactly a single-term clause
 * (interval enumeration calls `probAtLeast` on the fitted marginal);
 * `constant` has no clauses.
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
 * Derives the negative-binomial eligibility partition from
 * `ruleModule.bonusPredicates` at runtime, so it tracks the season modules.
 *
 * Negative binomial is not closed under scaled addition, so `analyticPmf.ts`'s
 * `familyForClauseSum` throws on an NB clause sum (a Gaussian fallback there
 * would make the measurement meaningless). A variable is eligible only if every
 * clause it appears in is a single unscaled term; any multi-term or divided
 * appearance poisons it, since a mixed clause also throws.
 *
 * A bonus can move when at least ONE of its clauses is a single unscaled term
 * over an eligible variable (2016 `capture` is partially reachable this way).
 * A `constant` predicate ties with control by construction.
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
 * Builds the NB arm's variant rule module: a spread copy with `marginalFamily`
 * flipped on eligible variables only; poisoned variables keep their production
 * family and the original is never mutated. The spread drops the prototype,
 * which is safe while no season module's `parse` or `evaluateBonuses` uses
 * `this`.
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
// The outcome-arm acceptance bar
// ---------------------------------------------------------------------------
//
// Applied mechanically, with no override. An arm is accepted only if its pooled
// total-RP RPS AND its pooled outcome Brier are both strictly lower than
// control's. Among accepted arms the lowest pooled RPS ships, then lower pooled
// Brier, then the fixed order WIN, TIE, WIN+TIE (never input order). A combined
// arm must be accepted on its own. When nothing is accepted, `control` ships.
export type ArmName = "control" | "win" | "tie" | "win+tie";

/** Preference order for an exact RPS-and-Brier tie between accepted arms; `control` is never a candidate. */
const ARM_TIE_BREAK_ORDER: readonly ArmName[] = ["win", "tie", "win+tie"];

/** One arm's figures pooled over every observation on the selection slice; the bar never reads per-season figures. */
export interface ArmPooledFigures {
  readonly arm: ArmName;
  readonly totalRpCount: number;
  readonly totalRpRps: number;
  readonly outcomeCount: number;
  readonly outcomeBrier: number;
}

/** One arm's verdict and signed deltas (arm minus control; negative is better). Control's own verdict is always `accepted: false`. */
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
 * Applies the outcome-arm bar. `pooled` must contain exactly one `"control"`
 * entry. Throws when an arm's `totalRpCount` or `outcomeCount` differs from
 * control's (the comparison is then void), or when any figure is non-finite (a
 * NaN would read as an honest rejection).
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
// The bonus-arm acceptance bar
// ---------------------------------------------------------------------------
//
// Applied mechanically, with no override. An arm is accepted only if its pooled
// bonus Brier AND its pooled total-RP RPS are both strictly lower than
// control's, pooled over the selection slice (2016-2020 plus 2022). Among
// accepted arms the lowest pooled RPS ships, then lower pooled bonus Brier,
// then the fixed order lattice, meanShift, lattice+meanShift. A combined arm
// must be accepted on its own. When nothing is accepted, `control` ships.
export type BonusArmName = "control" | "lattice" | "meanShift" | "lattice+meanShift";

/** Tie-break order between accepted arms that tie exactly on RPS and bonus Brier. `control` is never a candidate. */
const BONUS_ARM_TIE_BREAK_ORDER: readonly BonusArmName[] = ["lattice", "meanShift", "lattice+meanShift"];

/** One arm's pooled figures over the whole selection slice: every (alliance, bonus) observation and every total-RP observation. */
export interface BonusArmPooledFigures {
  readonly arm: BonusArmName;
  readonly bonusCount: number;
  readonly bonusBrier: number;
  readonly totalRpCount: number;
  readonly totalRpRps: number;
}

/** One arm's verdict and signed deltas (arm minus control; negative is better). Control's own verdict is always `accepted: false`. */
export interface BonusArmVerdict {
  readonly arm: BonusArmName;
  readonly accepted: boolean;
  readonly bonusBrierDelta: number;
  readonly rpsDelta: number;
}

export interface RpBonusArmBarResult {
  readonly verdicts: readonly BonusArmVerdict[];
  readonly ship: BonusArmName;
}

/**
 * Applies the bonus-arm bar. `pooled` must contain a `"control"`
 * entry. Throws when control is missing, when any figure is non-finite (a NaN
 * would read as an honest rejection), or when an arm's `bonusCount` or
 * `totalRpCount` differs from control's (the comparison is then void).
 */
export function applyRpBonusArmBar(pooled: readonly BonusArmPooledFigures[]): RpBonusArmBarResult {
  const control = pooled.find((p) => p.arm === "control");
  if (control === undefined) {
    throw new Error(`applyRpBonusArmBar: no "control" entry in the supplied pooled figures — the bar has nothing to compare against`);
  }
  for (const p of pooled) {
    if (!Number.isFinite(p.bonusBrier) || !Number.isFinite(p.totalRpRps)) {
      throw new Error(`applyRpBonusArmBar: arm "${p.arm}" has a non-finite figure (bonusBrier=${p.bonusBrier}, totalRpRps=${p.totalRpRps}) — refusing to judge it`);
    }
    if (p.arm === "control") continue;
    if (p.bonusCount !== control.bonusCount || p.totalRpCount !== control.totalRpCount) {
      throw new Error(
        `applyRpBonusArmBar: arm "${p.arm}" scored bonusCount=${p.bonusCount}/totalRpCount=${p.totalRpCount} against control's bonusCount=${control.bonusCount}/totalRpCount=${control.totalRpCount} — the arms must see the identical observation set, so this comparison is void`
      );
    }
  }

  const verdicts: BonusArmVerdict[] = pooled.map((p) => {
    if (p.arm === "control") return { arm: p.arm, accepted: false, bonusBrierDelta: 0, rpsDelta: 0 };
    const bonusBrierDelta = p.bonusBrier - control.bonusBrier;
    const rpsDelta = p.totalRpRps - control.totalRpRps;
    const accepted = p.bonusBrier < control.bonusBrier && p.totalRpRps < control.totalRpRps;
    return { arm: p.arm, accepted, bonusBrierDelta, rpsDelta };
  });

  const accepted = verdicts.filter((v) => v.accepted);
  let ship: BonusArmName = "control";
  if (accepted.length > 0) {
    const byArm = new Map(pooled.map((p) => [p.arm, p]));
    const sorted = [...accepted].sort((a, b) => {
      const figA = byArm.get(a.arm)!;
      const figB = byArm.get(b.arm)!;
      if (figA.totalRpRps !== figB.totalRpRps) return figA.totalRpRps - figB.totalRpRps;
      if (figA.bonusBrier !== figB.bonusBrier) return figA.bonusBrier - figB.bonusBrier;
      return BONUS_ARM_TIE_BREAK_ORDER.indexOf(a.arm) - BONUS_ARM_TIE_BREAK_ORDER.indexOf(b.arm);
    });
    ship = sorted[0]!.arm;
  }

  return { verdicts, ship };
}

// ---------------------------------------------------------------------------
// The outcome-arm comparison's reader half: the algorithm guard, the
// bar and the record schema, for reuse by any future re-measurement. The test
// re-applies the bar to `data/baselines/rp-outcome-arms-2026-09.json`.
// ---------------------------------------------------------------------------

/** Requires exactly `["spr"]`: `matchOutcomePmf` exists only for SPR, so any other list would silently measure zero observations. */
export function assertOutcomeArmAlgorithmAllowed(algorithmIds: readonly string[]): void {
  if (algorithmIds.length === 1 && algorithmIds[0] === "spr") return;
  throw new Error(
    `--outcome-arms requires the resolved algorithm list to be exactly ["spr"], got [${algorithmIds.join(", ")}] — pass --algorithm spr explicitly`
  );
}

const RpOutcomeArmNameSchema = z.enum(["control", "win", "tie", "win+tie"]);

/** Mirrors the plain TS type `TotalRpSummary`. */
const RpOutcomeArmTotalSchema = z.object({
  count: z.number().int().nonnegative(),
  rankedProbabilityScore: z.number().finite(),
  meanPredictedRp: z.number().finite(),
  meanActualRp: z.number().finite(),
  excludedNullActual: z.number().int().nonnegative(),
  excludedOutOfSupport: z.number().int().nonnegative(),
});

/** Mirrors the plain TS type `OutcomeSummary`. */
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

/** Per-arm gap figures, descriptive only, never a gate. */
const RpOutcomeArmF6GapSchema = z.object({
  arm: RpOutcomeArmNameSchema,
  n: z.number().int().nonnegative(),
  medianAbsDiff: z.number().finite(),
  p90AbsDiff: z.number().finite(),
  maxAbsDiff: z.number().finite(),
  favouriteDisagreements: z.number().int().nonnegative(),
});

/** The committed outcome-arm record: figures pooled and per-season; `ship` is `applyRpOutcomeArmBar`'s stored choice. */
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

// ---------------------------------------------------------------------------
// The bonus-arm comparison's reader half: `applyRpBonusArmBar` (above), the
// algorithm guard and `RpBonusArmRecordSchema`, for reuse by any future re-measurement.
// Lattice marginals and the walk-forward mean shift are the model's
// unconditional behavior; the test re-applies the bar to
// `data/baselines/rp-bonus-arms-2026-09.json`.
// ---------------------------------------------------------------------------

/** Every bonus arm in measurement order. */
export const BONUS_ARM_NAMES: readonly BonusArmName[] = ["control", "lattice", "meanShift", "lattice+meanShift"];

/** Requires the resolved algorithm list to be exactly `["spr"]`, the only algorithm with ranking-point odds. */
export function assertBonusArmAlgorithmAllowed(algorithmIds: readonly string[]): void {
  if (algorithmIds.length === 1 && algorithmIds[0] === "spr") return;
  throw new Error(`a bonus-arm measurement requires the resolved algorithm list to be exactly ["spr"], got [${algorithmIds.join(", ")}] — pass --algorithm spr explicitly`);
}

const MarginalResolutionTallySchema = z.object({
  negativeBinomial: z.number().int().nonnegative(),
  gaussian: z.number().int().nonnegative(),
  degenerate: z.number().int().nonnegative(),
  lattice: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
});

const BonusArmNameSchema = z.enum(["control", "lattice", "meanShift", "lattice+meanShift"]);

const BonusArmCellSchema = z.object({
  season: z.number().int(),
  bonus: z.string().min(1),
  cellClass: z.enum(["multi-variable", "single-variable", "constant"]),
  n: z.number().int().nonnegative(),
  observed: z.number().finite(),
  meanPredicted: z.number().finite(),
  brier: z.number().finite(),
  /** (arm mean - control mean) / (observed - control mean). Null for control, or when control's mean already equals observed. */
  gapClosedShare: z.number().finite().nullable(),
});

const BonusArmMeanShiftSeasonSchema = z.object({
  /** Scored total-RP alliance-sides (qualification, pmf present). */
  scoredSides: z.number().int().nonnegative(),
  /** Of those, sides whose roster was fully warm AND had at least one variable at the warmup count, both read before the fold. */
  shiftedSides: z.number().int().nonnegative(),
  variables: z.record(
    z.string(),
    z.object({
      finalCount: z.number().int().nonnegative(),
      finalMeanResidual: z.number().finite().nullable(),
      /** The first match after whose fold this variable's count reached the warmup, or null when it never did. */
      activatedAfterMatch: z.string().nullable(),
    })
  ),
});

const BonusArmSeasonSchema = z.object({
  season: z.number().int(),
  bonusCount: z.number().int().nonnegative(),
  bonusBrier: z.number().finite().nullable(),
  meanPredictedBonus: z.number().finite().nullable(),
  observedBonusRate: z.number().finite().nullable(),
  totalRp: RpOutcomeArmTotalSchema.optional(),
  marginalResolution: MarginalResolutionTallySchema,
  meanShift: BonusArmMeanShiftSeasonSchema.optional(),
});

const BonusArmPoolSchema = z.object({
  n: z.number().int().nonnegative(),
  observed: z.number().finite().nullable(),
  meanPredicted: z.number().finite().nullable(),
  brier: z.number().finite().nullable(),
  gapClosedShare: z.number().finite().nullable(),
});

const BonusArmRecordArmSchema = z.object({
  arm: BonusArmNameSchema,
  /** Exactly `BonusArmPooledFigures`: what the bar reads. */
  pooled: z.object({
    arm: BonusArmNameSchema,
    bonusCount: z.number().int().nonnegative(),
    bonusBrier: z.number().finite(),
    totalRpCount: z.number().int().nonnegative(),
    totalRpRps: z.number().finite(),
  }),
  meanPredictedBonus: z.number().finite(),
  observedBonusRate: z.number().finite(),
  totalRp: RpOutcomeArmTotalSchema,
  multiVariablePool: BonusArmPoolSchema,
  singleVariablePool: BonusArmPoolSchema,
  perSeason: z.array(BonusArmSeasonSchema),
  perCell: z.array(BonusArmCellSchema),
});

/** The committed bonus-arm record's shape. `ship` is the bar's own choice over `arms[].pooled`, stored, and re-derived by a test. */
export const RpBonusArmRecordSchema = z.object({
  measuredAt: z.string().min(1),
  command: z.string().min(1),
  corpusIdentity: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    mtime: z.string().min(1),
  }),
  /** HEAD and `git status --short -- packages scripts`, read at the start and the end of the run, so a foreign mid-run change is visible. */
  tree: z.object({
    headAtStart: z.string().min(1),
    statusAtStart: z.string(),
    headAtEnd: z.string().min(1),
    statusAtEnd: z.string(),
  }),
  algorithmVersions: z.record(z.string(), z.string()),
  seasons: z.array(z.number().int()),
  arms: z.array(BonusArmRecordArmSchema),
  rotorCheck: z.array(
    z.object({
      arm: BonusArmNameSchema,
      n: z.number().int().nonnegative(),
      observed: z.number().finite(),
      meanPredicted: z.number().finite(),
      brier: z.number().finite(),
      overshoot: z.boolean(),
    })
  ),
  marginalResolution: z.record(z.string(), MarginalResolutionTallySchema),
  barVerdicts: z.array(
    z.object({
      arm: BonusArmNameSchema,
      accepted: z.boolean(),
      bonusBrierDelta: z.number().finite(),
      rpsDelta: z.number().finite(),
    })
  ),
  ship: BonusArmNameSchema,
});
export type RpBonusArmRecord = z.infer<typeof RpBonusArmRecordSchema>;

/** The one tally merge, so a new counter cannot be dropped by a hand-written copy. */
function mergeMarginalResolutionTally(into: MarginalResolutionTally, from: MarginalResolutionTally): void {
  into.negativeBinomial += from.negativeBinomial;
  into.gaussian += from.gaussian;
  into.degenerate += from.degenerate;
  into.lattice += from.lattice;
  into.fallbacks += from.fallbacks;
}

function formatTally(t: MarginalResolutionTally): string {
  return `negativeBinomial=${t.negativeBinomial}  gaussian=${t.gaussian}  degenerate=${t.degenerate}  lattice=${t.lattice}  (fallbacks counted separately: ${t.fallbacks})`;
}

/** One shared bucket definition. The final edge is `1.0000001` so a prediction of exactly `1.0` lands in the last bucket. */
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
// The total-RP and outcome scorers
// ---------------------------------------------------------------------------
//
// Unlike per-bonus scoring, these see the win/tie half: `rankedProbabilityScore`
// grades `redRpPmf`/`blueRpPmf` against the actual alliance RP, and
// `outcomeBrier` grades `matchOutcomePmf` against `match.winner`. Both are pure.

/**
 * `RPS = (1/maxRp) * sum_{k=0}^{maxRp-1} (cdf(k) - [actual <= k])^2`, with
 * `maxRp = pmf.length - 1`, bounded `[0, 1]` (0 is a perfect point mass). The
 * normalisation keeps 2025-2026 (`maxRp` 6) comparable with `maxRp` 4 seasons.
 * `actual` must be an in-support integer; the summary builders exclude the rest.
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
 * Three-outcome Brier of `[pRedWin, pTie, pBlueWin]` against a one-hot winner;
 * 0 is perfect, 2 is worst. Not comparable to the site's binary win Brier.
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

/** One alliance-side's predicted RP-total pmf and actual RP (`null` when not derivable). */
export interface TotalRpObservation {
  readonly pmf: readonly number[];
  readonly actual: number | null;
}

export interface MatchOutcomeObservation {
  readonly pmf3: readonly number[];
  readonly winner: "red" | "blue" | "tie";
}

/** Mirrors `RpCalibrationTotalSchema` (publish.ts). */
export type TotalRpSummary = NonNullable<RpCalibrationRecord["totalRp"]>;

/** Mirrors `RpCalibrationOutcomeSchema` (publish.ts). */
export type OutcomeSummary = NonNullable<RpCalibrationRecord["outcome"]>;

/**
 * The total-RP block, or `undefined` when nothing scored (never a coerced zero).
 * A `null` actual counts in `excludedNullActual`; a non-integer or
 * out-of-`[0, maxRp]` actual (offseason RP such as Oregon BunnyBots) counts in
 * `excludedOutOfSupport`. Neither enters `count` or the means.
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

/** The outcome block, or `undefined` when nothing scored; every observation already has a winner, so nothing is excluded. */
export function buildOutcomeSummary(observations: readonly MatchOutcomeObservation[]): OutcomeSummary | undefined {
  if (observations.length === 0) return undefined;
  const brierScore = observations.reduce((sum, o) => sum + outcomeBrier(o.pmf3, o.winner), 0) / observations.length;
  const meanPredictedTie = observations.reduce((sum, o) => sum + o.pmf3[1]!, 0) / observations.length;
  const observedTieRate = observations.filter((o) => o.winner === "tie").length / observations.length;
  return { count: observations.length, brierScore, meanPredictedTie, observedTieRate };
}

/**
 * Builds one (season, algorithm) publishable calibration record with the same
 * `brier`/`rate`/`meanPredicted` helpers as the console report. A bonus with no
 * observations, and a total-RP or outcome block with none, is omitted rather
 * than emitted with `NaN`.
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

  // No `reliabilityBins` on the wire: they pushed an artifact over its byte
  // budget and nothing reads them; the buckets are console-only.
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
// THE COMMITTED ATTRIBUTION RECORD
// ---------------------------------------------------------------------------

/** The committed record's home. */
export const RP_ATTRIBUTION_PATH = "data/baselines/rp-attribution-2026-09.json";

/**
 * The dot threshold the frozen attribution record was scored against. The
 * live display rule is now three categorical tiers with no single threshold —
 * unlikely under one third, toss-up from one third to two thirds inclusive,
 * likely above two thirds — so this describes the record only;
 * `apps/web/src/lib/bonusRp.test.ts` pins the literal 0.5.
 */
export const RP_DOT_THRESHOLD_DEFAULT = 0.5;

/**
 * The shipped RP-layer combination in words, written into the measurement
 * header (zero wire bytes; `buildCompareArtifact` never attaches the header).
 * The frozen `-09b` and `-09d` calibration baselines pin older literals.
 */
export const SHIPPED_RP_LAYER_LABEL =
  "winSource=algorithm-pRedWin, tieModel=discrete-integer-margin, marginal=lattice, meanShift=fully-warm-walk-forward";

/** One scored cell under one arm. Figures are `null`, never `NaN`, when `count` is 0, so "no data" stays distinguishable. */
export interface RpAttributionCell {
  readonly arm: string;
  readonly algorithmId: string;
  readonly season: number;
  readonly bonusName: string;
  readonly count: number;
  readonly meanPredicted: number | null;
  readonly observedFrequency: number | null;
  readonly brierScore: number | null;
  /** The share of this cell's alliance-sides whose predicted probability reaches the dot threshold. */
  readonly dotEligibleShare: number | null;
}

/** One bonus's movement between the frozen pre-engine-swap file and the `control` arm. */
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

/** Descriptive population figures per arm on the reporting slice; not gates. */
export interface RpOutcomeCoherence {
  readonly arm: string;
  readonly n: number;
  /** Mean |pmf-implied pRedWin - published pRedWin|; zero by construction under the `win` arm. */
  readonly meanAbsPRedWinDiff: number | null;
  /** Mean predicted tie probability (measured base rate 1206/110362). */
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
 * Arm and ship configs are plain string maps, never a layer-config type, so the
 * committed record and its drift guard stand on their own without the code
 * that produced them.
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
 * The machine-readable block `docs/models/rp-attribution.md` carries; its sync
 * test deep-equals it against this function over the committed record, so prose
 * edited without regenerating the block fails. Pure over the committed JSON.
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
  // The record's arm-naming convention: accepted fields joined in this fixed
  // order, or "control" for none. Frozen with the record.
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
  // Absent --algorithm resolves to every published algorithm; it accepts a comma-separated list.
  const algorithmIdsCsv = args.indexOf("--algorithm") === -1 ? undefined : args[args.indexOf("--algorithm") + 1]!;
  const emitArtifactPath = args.indexOf("--emit-artifact") === -1 ? undefined : args[args.indexOf("--emit-artifact") + 1];
  const marginalArm = args.includes("--marginal-arm");

  const parsedSeasons = parseSeasons(seasonsSpec);

  const seasons = parsedSeasons.filter((s) => RP_RULE_MODULES[s] !== undefined);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);
  if (algorithms.length === 0) throw new Error(`no algorithms resolved from "${algorithmIdsCsv ?? "(default)"}"`);

  console.log(`RP calibration — algorithms [${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}], seasons ${seasons.join(", ")}`);
  console.log(`Walk-forward through the same SigmaScoutLayer the publisher runs.\n`);
  if (marginalArm) {
    console.log(`NEGATIVE-BINOMIAL ARM ACTIVE — control and NB layers folded from ONE replay per season,`);
    console.log(`scored by the SAME brier/rate/meanPredicted helpers.\n`);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    // Pooled per algorithm across seasons; mixing algorithms would average away the comparison.
    const allMarginalByAlgo = new Map<string, Observation[]>(algorithms.map((a) => [a.id, []]));
    const allPairsByAlgo = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>(algorithms.map((a) => [a.id, []]));
    const emittedRecords: { season: number; algorithmId: string; calibration: RpCalibrationRecord }[] = [];
    // Descriptive only, never a gate: |matchOutcomePmf[0] - pRedWin| per
    // algorithm, the score-draw win probability against the published pRedWin.
    const f6DiffsByAlgo = new Map<string, number[]>(algorithms.map((a) => [a.id, []]));
    const f6FavouriteDisagreementsByAlgo = new Map<string, number>(algorithms.map((a) => [a.id, 0]));
    const f6TotalByAlgo = new Map<string, number>(algorithms.map((a) => [a.id, 0]));
    const marginalTally = emptyMarginalResolutionTally();
    // Kept apart so the control arm's resolution counts are never contaminated.
    const armTally = emptyMarginalResolutionTally();
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

    for (const season of seasons) {
      const ruleModule = RP_RULE_MODULES[season]!;
      // One replay per season shared across every algorithm, as in publish.ts's season loop.
      const stream = buildSeasonStream(db, season, { includeOffseason: true });
      const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
      const records = new WalkForwardSimulator(stream).runAll(algorithms, teams);
      const actualFlags = actualBonusFlagsForSeason(stream, season);

      // The algorithm id selects the Sigma band variance, exactly as the publisher's layers do.
      const layers = new Map(algorithms.map((a) => [a.id, new SigmaScoutLayer(ruleModule, a.id)]));
      const perBonusByAlgo = new Map<string, Observation[][]>(algorithms.map((a) => [a.id, ruleModule.bonusNames.map(() => [])]));
      const pairsByAlgo = new Map<string, { p1: number; p2: number; a1: boolean; a2: boolean }[]>(algorithms.map((a) => [a.id, []]));
      // Total-RP and outcome observations, per season.
      const totalRpByAlgo = new Map<string, TotalRpObservation[]>(algorithms.map((a) => [a.id, []]));
      const outcomeByAlgo = new Map<string, MatchOutcomeObservation[]>(algorithms.map((a) => [a.id, []]));

      // The NB arm folds the same `records` through a second, variant-module
      // layer per algorithm; it never replays.
      const eligibility = marginalArm ? deriveMarginalArmEligibility(ruleModule) : undefined;
      const armRuleModule = eligibility === undefined ? undefined : ruleModuleWithMarginalArm(ruleModule, eligibility.eligible);
      const armLayers =
        armRuleModule === undefined ? undefined : new Map(algorithms.map((a) => [a.id, new SigmaScoutLayer(armRuleModule, a.id)]));
      const armPerBonusByAlgo =
        armRuleModule === undefined
          ? undefined
          : new Map<string, Observation[][]>(algorithms.map((a) => [a.id, ruleModule.bonusNames.map(() => [])]));

      for (const r of records) {
        const layer = layers.get(r.algorithmId)!;
        const enriched = layer.foldPlayed(r.match, r.prediction);
        const armEnriched = armLayers === undefined ? undefined : armLayers.get(r.algorithmId)!.foldPlayed(r.match, r.prediction);

        // OFFICIAL PLAY ONLY is scored (quick task 260919-368). The layers above
        // have already been handed the match, and decide for themselves whether
        // it folds; what stops here is the SCORECARD. Offseason never reached it
        // (no pmf: type 99 is not RP-eligible), but preseason Week 0 is
        // RP-eligible and was scored until now, against the rule that unofficial
        // play feeds no published accuracy.
        if (!isOfficialEventType(r.match.eventType)) continue;

        // Runs before the bonus-flag `continue` below: this population is every
        // played bonus-RP-eligible match with a pmf, not gated on bonus flags.
        if (isBonusRpCompLevel(r.match.compLevel)) {
          const pred = enriched.prediction;
          if (pred.redRpPmf !== undefined && pred.blueRpPmf !== undefined) {
            const totalRpObs = totalRpByAlgo.get(r.algorithmId)!;
            totalRpObs.push({ pmf: pred.redRpPmf, actual: toIntegerRpOrNull(r.match.redRpEarned) });
            totalRpObs.push({ pmf: pred.blueRpPmf, actual: toIntegerRpOrNull(r.match.blueRpEarned) });
          }
          if (pred.matchOutcomePmf !== undefined) {
            outcomeByAlgo.get(r.algorithmId)!.push({ pmf3: pred.matchOutcomePmf, winner: r.match.winner });

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
          // The correlation claim uses the season's first two bonuses on the same alliance.
          if (predictedBonuses.length >= 2) {
            pairs.push({ p1: predictedBonuses[0]!, p2: predictedBonuses[1]!, a1: actualBonuses[0]!, a2: actualBonuses[1]! });
          }

          // Gated by the control arm's conditions above, so both arms see the
          // same observations; asserted per bonus after the season.
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

        // How often a fit resolved to something other than its declared family
        // (`FittedMarginal.resolved`, never `.declared`).
        const layerTally = layers.get(algorithm.id)!.rpMarginalResolutionTally;
        mergeMarginalResolutionTally(marginalTally, layerTally);

        if (armLayers !== undefined && armPerBonusByAlgo !== undefined && eligibility !== undefined) {
          const armLayerTally = armLayers.get(algorithm.id)!.rpMarginalResolutionTally;
          mergeMarginalResolutionTally(armTally, armLayerTally);

          const armPerBonus = armPerBonusByAlgo.get(algorithm.id)!;
          const reachByBonus = new Map(eligibility.bonusReach.map((b) => [b.name, b]));
          for (const [i, name] of ruleModule.bonusNames.entries()) {
            const controlObservations = perBonus[i]!;
            const armObservations = armPerBonus[i]!;
            // Eligibility gates run before any family branch, so differing
            // counts mean the seam is wrong and the comparison is void.
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
      `   control arm: ${formatTally(marginalTally)}\n`
    );

    if (marginalArm) {
      const armTotal = armTally.negativeBinomial + armTally.gaussian + armTally.degenerate + armTally.lattice;
      const nbFraction = armTotal === 0 ? Number.NaN : armTally.negativeBinomial / armTotal;
      console.log(`   NB arm:      ${formatTally(armTally)}`);
      console.log(
        `   NB RESOLUTION FRACTION: ${(nbFraction * 100).toFixed(2)}% of the NB arm's ${armTotal} fits genuinely resolved to negative binomial.`
      );
      console.log(
        `   A run where most fits fell back (non-positive mean, or variance <= mean) is a result about the FIT'S APPLICABILITY, not a verdict on the family.\n`
      );

      // ---- Three categories, never pooled: structurally inert ties must not
      // read as evidence the family does not help. ----
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

    // ---- The pmf-vs-pRedWin gap, descriptive only, never a gate. ----
    for (const algorithm of algorithms) {
      const diffs = f6DiffsByAlgo.get(algorithm.id) ?? [];
      if (diffs.length === 0) continue;
      const sorted = [...diffs].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
      const max = sorted[sorted.length - 1]!;
      const disagreements = f6FavouriteDisagreementsByAlgo.get(algorithm.id) ?? 0;
      const total = f6TotalByAlgo.get(algorithm.id) ?? 0;
      console.log(`═══ PMF-VS-PREDWIN GAP (descriptive only, NOT a gate) [${algorithm.id}] ═══`);
      console.log(
        `n=${diffs.length}  median|diff|=${median.toFixed(6)}  p90=${p90.toFixed(6)}  max=${max.toFixed(6)}  ` +
          `favourite disagreements=${disagreements}/${total}\n`
      );
    }

    // ---- Grand-pooled headline over every algorithm and season, computed from
    // the emitted records so it matches the measurement file. ----
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

    if (emitArtifactPath !== undefined) {
      const candidate = {
        measuredAt: new Date().toISOString(),
        command: `npx tsx scripts/measureRpCalibration.ts ${args.join(" ")}`,
        corpusIdentity: CORPUS_PATH,
        // The stream is built with `includeOffseason: true`; the population is recorded.
        offseasonIncluded: true,
        algorithmVersions: Object.fromEntries(algorithms.map((a) => [a.id, a.version])),
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

// Only auto-run `main()` as the entry point, so tests can import the helpers without a corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:rp-calibration failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
