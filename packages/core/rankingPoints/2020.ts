/**
 * 2020 (Infinite Recharge) RP rule module. The threshold is derived by corpus
 * reconciliation against TBA's recorded flag, not cited from a manual.
 *
 * Shield Operational Bonus: `endgamePoints >= 65`, 100% agreement. 2020 was
 * cancelled before any District Championship or Championship event, so the higher
 * tiers of the uniform triple are an unconfirmable extrapolation.
 *
 * The intuitive rule (key on `stage2Activated`) scores below always-false: that flag
 * is only weakly related to the RP. Shield Operational is an endgame bonus, and the
 * endgame point total is the correct signal.
 *
 * Deliberately never read: the roll-up totals, per-robot fields (positional
 * correspondence is unverified), per-goal detail, and endgame informational fields.
 *
 * Threshold comparisons are `>=` throughout.
 *
 * Shield Energized (`shieldEnergizedRankingPoint`) is not modelled: it fired 0 times
 * in this corpus, so there is no positive example to derive a rule from.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/** Only the fields this module reads; zod's default strip mode drops the rest (deliberately not `.passthrough()`). */
const SideSchema = z.object({
  endgamePoints: z.number().finite(),
  shieldOperationalRankingPoint: z.boolean(),
});

const Rp2020Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Shield Operational Bonus threshold. Base tier is measured; the higher tiers are an extrapolation (see file header). */
const SHIELD_OPERATIONAL_THRESHOLD: RpTieredThreshold = { base: 65, districtChampionship: 65, championship: 65 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "endgamePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: PARK 5, HANG 25 per robot, LEVEL 15 once.
    lattice: { step: 5, min: 0, max: 90 },
  },
];

/** Shield Energized stays out of `bonusNames`, so it has no threshold variable and no `recordedBonusFlags` entry (a recorded flag with no recomputed twin would break reconciliation's paired shape). */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "singleThreshold",
    name: "shieldOperational",
    variable: "endgamePoints",
    direction: "gte",
    threshold: SHIELD_OPERATIONAL_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2020: RpRuleModule = {
  season: 2020,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  // Diagnostic-only: shieldEnergized (un-modelled, see file header) and the
  // control-panel stage-activation fields whose weak RP correlation is why
  // this rule uses endgamePoints instead. None feeds bonusFlags or thresholdVariables.
  diagnosticKeys: ["shieldEnergizedRankingPoint", "stage2Activated", "stage3Activated"],

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2020Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.endgamePoints = own.endgamePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2020 ${side}`);

    const shieldOperational = own.endgamePoints >= SHIELD_OPERATIONAL_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.shieldOperational = shieldOperational;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.shieldOperational = own.shieldOperationalRankingPoint;

    const totalRp = Number(shieldOperational);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },

  /** Fully computable from the one tracked threshold variable; no untracked gate. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
