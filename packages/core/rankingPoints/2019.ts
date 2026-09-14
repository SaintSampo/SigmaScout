/**
 * 2019 (Destination: Deep Space) RP rule module. Thresholds are derived by corpus
 * reconciliation against TBA's recorded flags (`reconciliation.test.ts`), not cited
 * from the game manual.
 *
 * HAB Docking Bonus: `habClimbPoints >= 15`, 100% agreement at every tier.
 *
 * Complete Rocket Bonus: `completedRocketNear || completedRocketFar`, 98.19%
 * agreement with 0% false positives at every tier (the false-negative rate is its
 * `KNOWN_TOLERANCES` entry). A joint `hatchPanelPoints`/`cargoPoints` threshold
 * scored worse and introduced false positives, so it is not used.
 *
 * `predictThresholds` receives only numeric values and cannot reach the rocket
 * booleans, so Complete Rocket is always `false` there and tracks no threshold
 * variable; the single tracked variable is `habClimbPoints`.
 *
 * Deliberately never read: the roll-up totals (`autoPoints` equals
 * `sandStormBonusPoints`, a hazard; see `breakdown/2019.ts`), the per-robot fields
 * (positional correspondence is unverified), and the per-bay detail fields.
 *
 * Threshold comparisons are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/** Only the fields this module reads; zod's default strip mode drops the rest (deliberately not `.passthrough()`). */
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

/** HAB Docking Bonus threshold: `habClimbPoints >= 15`. Not tiered (measured). */
const HAB_DOCKING_THRESHOLD: RpTieredThreshold = { base: 15, districtChampionship: 15, championship: 15 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "habClimbPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: HAB climb 3/6/12 per robot, 3 robots.
    lattice: { step: 3, min: 0, max: 36 },
  },
];

/** `completeRocket` is declared `constant` false (no numeric fallback exists, so no gate); `bonusNames.length` still counts it toward `maxRp`. */
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

  /** `completeRocket` depends entirely on the rocket booleans, so it is always `false` here. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
