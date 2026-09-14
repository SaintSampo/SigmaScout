/**
 * 2019 (Destination: Deep Space) RP rule module. Thresholds derived from
 * data via corpus reconciliation against TBA's own recorded flags
 * (`reconciliation.test.ts`), not cited from the game manual.
 *
 * HAB Docking Bonus: `habClimbPoints >= 15`, 100% agreement at every event
 * tier, so the threshold is uniform rather than tiered.
 *
 * Complete Rocket Bonus: recomputed as `completedRocketNear ||
 * completedRocketFar`, 98.19% agreement overall, 0% false positives at
 * every tier (a small false-negative rate is `reconciliation.test.ts`'s one
 * `KNOWN_TOLERANCES` entry for this bonus). A rejected joint
 * `hatchPanelPoints`/`cargoPoints` threshold variant scored worse and
 * introduced false positives, violating this project's never-overstate
 * direction.
 *
 * `parse` and `predictThresholds` differ for Complete Rocket: `parse` reads
 * the two booleans directly, but `predictThresholds` receives only numeric
 * threshold-variable values and cannot reach them, so it takes the
 * conservative branch and is always `false` there (see `BONUS_PREDICATES`
 * below), following 2025's `autoBonus` precedent. The bonus contributes no
 * entry to `thresholdVariables`; the single tracked variable is
 * `habClimbPoints`.
 *
 * Deliberately never read: the roll-up totals (`autoPoints` is numerically
 * identical to `sandStormBonusPoints`, a hazard not a convenience — see
 * `breakdown/2019.ts`'s header), the per-robot fields (positional
 * correspondence is unverified), and the per-bay detail fields (the
 * rejected joint-threshold variant above already showed this level of
 * detail does not help).
 *
 * Threshold comparisons are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields are ignored, not rejected — zod's default
 * "strip" mode drops them without erroring. Deliberately not `.passthrough()`.
 */
const SideSchema = z.object({
  habClimbPoints: z.number().finite(),
  completedRocketNear: z.boolean(),
  completedRocketFar: z.boolean(),
  habDockingRankingPoint: z.boolean(),
  completeRocketRankingPoint: z.boolean(),
});

const Rp2019Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** HAB Docking Bonus threshold: `habClimbPoints >= 15`. Not tiered — flatness measured. */
const HAB_DOCKING_THRESHOLD: RpTieredThreshold = { base: 15, districtChampionship: 15, championship: 15 };

// Gaussian marginal; see constants.ts's `MarginalFamily` doc for the
// evidence-class framework.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "habClimbPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
];

/**
 * Complete Rocket carries no threshold variable (see file header): it is
 * recomputed in `parse` from two booleans, not a numeric threshold. `maxRp`
 * still derives to `2 + 2 = 4` because `bonusNames.length` counts it
 * regardless of whether it tracks a threshold variable.
 *
 * `habDocking` is `singleThreshold`. `completeRocket` is declared
 * `constant`, `value: false` — no threshold-variable-only fallback exists
 * at all, so there is nothing to gate with an `RpUntrackedGate`; the
 * `reason` field carries that justification instead.
 */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "singleThreshold",
    name: "habDocking",
    variable: "habClimbPoints",
    direction: "gte",
    threshold: HAB_DOCKING_THRESHOLD,
  },
  {
    kind: "constant",
    name: "completeRocket",
    value: false,
    reason:
      "F12: no threshold-variable-only fallback exists for completedRocketNear || completedRocketFar (both booleans, unreachable from predictThresholds). Predicted 0.0000 against an observed ~5.15% (pnpm rp:conservative-branch measures a pooled-season understatedRate of 4.7324%). Deferred out of Phase 9 deliberately — see 09-CONTEXT.md's deferred list.",
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2019: RpRuleModule = {
  season: 2019,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2019Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.habClimbPoints = own.habClimbPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2019 ${side}`);

    const habDocking = own.habClimbPoints >= HAB_DOCKING_THRESHOLD[tier];
    // Recomputed from booleans present at parse time; `predictThresholds`
    // below cannot reach these fields.
    const completeRocket = own.completedRocketNear || own.completedRocketFar;

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.habDocking = habDocking;
    bonusFlags.completeRocket = completeRocket;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.habDocking = own.habDockingRankingPoint;
    recordedBonusFlags.completeRocket = own.completeRocketRankingPoint;

    const totalRp = Number(habDocking) + Number(completeRocket);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },

  /**
   * `habDocking` is fully computable from `habClimbPoints` alone.
   * `completeRocket` depends entirely on the two rocket booleans, which
   * this season tracks no numeric fallback for, so it is always `false`
   * here (declared `constant`, see `BONUS_PREDICATES` above), following
   * 2025's `autoBonus` precedent. Delegates to the shared declarative
   * evaluator.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
