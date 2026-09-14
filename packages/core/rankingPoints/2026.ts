/**
 * 2026 (REBUILT) RP rule module. Source: 2026 FRC Game Manual §6.5.3, Tables 6-4/6-5.
 * Verified by corpus reconciliation (`reconciliation.test.ts`) against TBA's
 * recorded `energizedAchieved`/`superchargedAchieved`/`traversalAchieved` flags.
 *
 * Deliberately never read: `hubScore.totalPoints` (numerically equal to
 * `hubScore.totalCount` in sampled data, but a point total, not the raw count the
 * Energized/Supercharged thresholds gate on), every other `hubScore.*Count`/`uncounted`
 * field, `totalAutoPoints`/`totalTeleopPoints` (roll-ups), `penalties` (string), and
 * the per-robot `autoTowerRobot1/2/3`/`endGameTowerRobot1/2/3` fields.
 *
 * Thresholds compare with `>=`. The Energized and Supercharged tier values are
 * manual-confirmed and match exact corpus boundaries at every tier.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

const HubScoreSchema = z.object({
  totalCount: z.number().finite(),
});

const SideSchema = z.object({
  autoTowerPoints: z.number().finite(),
  endGameTowerPoints: z.number().finite(),
  hubScore: HubScoreSchema,
  energizedAchieved: z.boolean(),
  superchargedAchieved: z.boolean(),
  traversalAchieved: z.boolean(),
});

const Rp2026Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Energized threshold on `hubScore.totalCount` (raw fuel count, never `.totalPoints`). */
const ENERGIZED_THRESHOLD: RpTieredThreshold = { base: 100, districtChampionship: 240, championship: 360 };

/** Supercharged threshold on `hubScore.totalCount`. District Championship does not bump, unlike Energized. */
const SUPERCHARGED_THRESHOLD: RpTieredThreshold = { base: 360, districtChampionship: 360, championship: 500 };

/** Traversal threshold on `totalTowerPoints` (`autoTowerPoints + endGameTowerPoints`). Not tiered: 0 mismatches at every event type. */
const TRAVERSAL_THRESHOLD: RpTieredThreshold = { base: 50, districtChampionship: 50, championship: 50 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "hubTotalCount",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: manual sets no FUEL cap.
    lattice: { step: 1, min: 0 },
  },
  {
    name: "totalTowerPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: Table 6-4: AUTO LEVEL 1 15 (2 ROBOTS max); TELEOP LEVEL 1/2/3 10/20/30 per robot: 2 x 15 + 3 x 30.
    lattice: { step: 5, min: 0, max: 120 },
  },
];

/**
 * `energized` and `supercharged` threshold the same variable and
 * `SUPERCHARGED_THRESHOLD[tier] >= ENERGIZED_THRESHOLD[tier]` at every tier, so
 * supercharged implies energized: the joint is an interval probability
 * (`P(both) = P(supercharged)`), never a product of independents.
 */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "nestedSameVariable",
    name: "energized",
    variable: "hubTotalCount",
    direction: "gte",
    threshold: ENERGIZED_THRESHOLD,
    nestedWith: ["supercharged"],
  },
  {
    kind: "nestedSameVariable",
    name: "supercharged",
    variable: "hubTotalCount",
    direction: "gte",
    threshold: SUPERCHARGED_THRESHOLD,
    nestedWith: ["energized"],
  },
  {
    kind: "singleThreshold",
    name: "traversal",
    variable: "totalTowerPoints",
    direction: "gte",
    threshold: TRAVERSAL_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2026: RpRuleModule = {
  season: 2026,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 3 + BONUS_NAMES.length,
  winRp: 3,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2026Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const totalTowerPoints = own.autoTowerPoints + own.endGameTowerPoints;

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.hubTotalCount = own.hubScore.totalCount;
    thresholdVariables.totalTowerPoints = totalTowerPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2026 ${side}`);

    const energized = own.hubScore.totalCount >= ENERGIZED_THRESHOLD[tier];
    const supercharged = own.hubScore.totalCount >= SUPERCHARGED_THRESHOLD[tier];
    const traversal = totalTowerPoints >= TRAVERSAL_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.energized = energized;
    bonusFlags.supercharged = supercharged;
    bonusFlags.traversal = traversal;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.energized = own.energizedAchieved;
    recordedBonusFlags.supercharged = own.superchargedAchieved;
    recordedBonusFlags.traversal = own.traversalAchieved;

    const totalRp = Number(energized) + Number(supercharged) + Number(traversal);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 3,
      tieRp: 1,
      totalRp,
    };
  },

  /** Fully computable from tracked threshold variables; no untracked alliance-level gate. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
