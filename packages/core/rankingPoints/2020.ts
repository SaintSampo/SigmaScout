/**
 * 2020 (Infinite Recharge) RP rule module. Threshold derived from data via
 * corpus reconciliation against TBA's own recorded flag, not cited from a
 * manual.
 *
 * Shield Operational Bonus: `endgamePoints >= 65`, 100% agreement measured
 * over the corpus. 2020 was cancelled by COVID-19 before any District
 * Championship or Championship event was played, so the corpus has no data
 * at those tiers — the uniform 65/65/65 triple's higher tiers are an
 * extrapolation, never independently confirmed, and never will be for this
 * season.
 *
 * The rule is derived from data rather than the control-panel mechanic's
 * manual reading because the intuitive rule (key on `stage2Activated`)
 * scores below always-guessing-false: that flag is only weakly related to
 * the real RP. Shield Operational is an endgame bonus (robots hanging on the
 * generator switch), and the endgame point total is the correct signal.
 *
 * Deliberately never read: the roll-up totals, per-robot fields (positional
 * correspondence is unverified), per-goal breakdown detail, and endgame
 * informational fields not part of the measured rule.
 *
 * Threshold comparisons are `>=` throughout.
 *
 * Shield Energized (`shieldEnergizedRankingPoint`) is not modelled — it
 * fired 0 times in this corpus, so there is no positive example to derive a
 * rule from; see `bonusNames`/`diagnosticKeys` below for how it is excluded
 * rather than folded in as an always-false bonus.
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
  endgamePoints: z.number().finite(),
  shieldOperationalRankingPoint: z.boolean(),
});

const Rp2020Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/**
 * Shield Operational Bonus threshold: `endgamePoints >= 65`. Base tier is
 * measured; districtChampionship and championship are an extrapolation —
 * see file header's tier caveat.
 */
const SHIELD_OPERATIONAL_THRESHOLD: RpTieredThreshold = { base: 65, districtChampionship: 65, championship: 65 };

// Gaussian marginal; see constants.ts's `MarginalFamily` doc for the
// evidence-class framework.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "endgamePoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
];

/**
 * Shield Energized is deliberately absent — it fired 0 times in this
 * corpus, so there is nothing to derive a rule from. Keeping it out of
 * `bonusNames` means it also gets no threshold variable and no entry in
 * `recordedBonusFlags` below, since a recorded flag with no recomputed twin
 * would break the paired shape `reconciliation.test.ts` relies on. `maxRp`
 * derives to `2 + 1 = 3`, never a hand-written literal.
 */
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

  /** Fully computable from the one tracked threshold variable alone — no untracked gate. Delegates to the shared declarative evaluator; see `BONUS_PREDICATES` above. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
