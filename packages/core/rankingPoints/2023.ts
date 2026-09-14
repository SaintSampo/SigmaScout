/**
 * 2023 (Charged Up) RP rule module. Source: 2023 FRC Game Manual §6.4.3, Table 6-2.
 * Verified by corpus reconciliation (`reconciliation.test.ts`) against TBA's
 * recorded `activationBonusAchieved`/`sustainabilityBonusAchieved` flags: 0/27116
 * mismatches, full season, all event types.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `autoCommunity`/`teleopCommunity` (per-node grids), `links` (structural array;
 * `linkPoints` is read instead), `coopGamePieceCount` (the RP gate is the
 * `coopertitionCriteriaMet` boolean), and the per-robot
 * `autoChargeStationRobot1/2/3`/`endGameChargeStationRobot1/2/3`/`mobilityRobot1/2/3` fields.
 *
 * Thresholds compare with `>=` (the manual states every bonus as "at least N").
 * District Championship does NOT get the Sustainability tier bump; only
 * Championship does. Coopertition requires BOTH alliances'
 * `coopertitionCriteriaMet` (AND, never OR: OR produced 609/6000 mismatches), so
 * `parse` reads both sides of the raw object.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

const SideSchema = z.object({
  totalChargeStationPoints: z.number().finite(),
  linkPoints: z.number().finite(),
  activationBonusAchieved: z.boolean(),
  sustainabilityBonusAchieved: z.boolean(),
  coopertitionCriteriaMet: z.boolean(),
});

const Rp2023Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Activation Bonus threshold: `totalChargeStationPoints >= 26`. Not tiered. */
const ACTIVATION_BONUS_THRESHOLD: RpTieredThreshold = { base: 26, districtChampionship: 26, championship: 26 };

/**
 * Sustainability Bonus threshold in LINKS (`linkPoints / 5`) when BOTH
 * alliances' coopertition criteria are NOT met. District Championship does
 * NOT bump (matches base): only Championship raises the threshold.
 */
const SUSTAINABILITY_THRESHOLD_NON_COOP: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 6 };

/** Sustainability Bonus threshold in LINKS when BOTH alliances' coopertition criteria ARE met. */
const SUSTAINABILITY_THRESHOLD_COOP: RpTieredThreshold = { base: 4, districtChampionship: 4, championship: 5 };

/**
 * Points per link. `linkPoints / LINK_POINTS_PER_LINK` is an exact integer across all
 * 27,116 corpus sides; `parse` and `BONUS_PREDICATES` share this one spelling.
 */
const LINK_POINTS_PER_LINK = 5;

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "totalChargeStationPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: Table 6-2: AUTO DOCKED 8 / ENGAGED 12 (1 ROBOT max); endgame PARK 2 / DOCKED 6 / ENGAGED 10 per robot; gcd 2.
    lattice: { step: 2, min: 0, max: 42 },
  },
  {
    name: "linkPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: Table 6-2: LINK 5; 3 ROWS of 9 NODES, so 9 links.
    lattice: { step: 5, min: 0, max: 45 },
  },
];

const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "singleThreshold",
    name: "activationBonus",
    variable: "totalChargeStationPoints",
    direction: "gte",
    threshold: ACTIVATION_BONUS_THRESHOLD,
  },
  {
    kind: "linearCombination",
    name: "sustainabilityBonus",
    terms: [{ variable: "linkPoints", divisor: LINK_POINTS_PER_LINK }],
    direction: "gte",
    threshold: SUSTAINABILITY_THRESHOLD_NON_COOP,
    untrackedGate: {
      signal: "coopertitionCriteriaMet (both alliances)",
      branch: "conservative",
      errorDirection: "understates",
      note:
        "Evaluated at the stricter non-coop threshold table because coopertition (BOTH alliances' coopertitionCriteriaMet) is not a tracked threshold variable. A pooled-season measurement recorded a meanRpUnderstatement of 0.105362 RP per alliance-match (understatedRate 10.5362%) — see docs/models/rp-verification.md's Conservative-Branch Understatement section.",
    },
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2023: RpRuleModule = {
  season: 2023,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2023Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.totalChargeStationPoints = own.totalChargeStationPoints;
    thresholdVariables.linkPoints = own.linkPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2023 ${side}`);

    const activationBonus = own.totalChargeStationPoints >= ACTIVATION_BONUS_THRESHOLD[tier];

    // Coopertition requires BOTH alliances' criteria met — AND, never OR.
    const bothCoopMet = own.coopertitionCriteriaMet && opponent.coopertitionCriteriaMet;
    const links = own.linkPoints / LINK_POINTS_PER_LINK;
    const sustainabilityThreshold = bothCoopMet ? SUSTAINABILITY_THRESHOLD_COOP[tier] : SUSTAINABILITY_THRESHOLD_NON_COOP[tier];
    const sustainabilityBonus = links >= sustainabilityThreshold;

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.activationBonus = activationBonus;
    bonusFlags.sustainabilityBonus = sustainabilityBonus;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.activationBonus = own.activationBonusAchieved;
    recordedBonusFlags.sustainabilityBonus = own.sustainabilityBonusAchieved;

    const totalRp = Number(activationBonus) + Number(sustainabilityBonus);

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
   * `sustainabilityBonus` also gates on BOTH alliances' untracked
   * `coopertitionCriteriaMet`, so it is evaluated at the stricter non-coop table
   * (the conservative-gate convention: understates, never overstates).
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
