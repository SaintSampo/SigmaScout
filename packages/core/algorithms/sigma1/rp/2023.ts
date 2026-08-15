/**
 * 2023 (Charged Up) RP rule module (D-09, D-12). Manual citation: official
 * 2023 FRC Game Manual §6.4.3, Table 6-2
 * (`firstfrc.blob.core.windows.net/frc2023/Manual/HTML/2023FRCGameManual.htm`,
 * RESEARCH.md Code Examples). Verification method: corpus reconciliation
 * (`reconciliation.test.ts`) against TBA's own recorded
 * `activationBonusAchieved`/`sustainabilityBonusAchieved` flags — verified
 * this phase at 0/27116 mismatches, full season, all event types
 * (RESEARCH.md).
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `autoCommunity`/`teleopCommunity` (per-node placement grids, structural
 * detail not a point/count value), `links` (structural array, use
 * `linkPoints` instead), `coopGamePieceCount` (not RP-relevant — the RP
 * coopertition gate is `coopertitionCriteriaMet`, a boolean), the
 * per-robot `autoChargeStationRobot1/2/3`/`endGameChargeStationRobot1/2/3`/
 * `mobilityRobot1/2/3` fields (Pitfall Sigma1-2/Assumption A1).
 *
 * Threshold comparison semantics are `>=` throughout (the manual states
 * every bonus as "at least N").
 *
 * The single most important tier fact in this phase (RESEARCH.md): District
 * Championship (event_type 2/5) does NOT get the Sustainability Bonus tier
 * bump — only Championship (event_type 3/4) does. Coopertition requires
 * BOTH alliances' `coopertitionCriteriaMet === true` (AND, never OR — an
 * OR-based check produced 609/6000 mismatches; the AND-based, tier-aware
 * check produced 0/27116), so `parse` reads both sides of the raw object.
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

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

/** Activation Bonus threshold: `totalChargeStationPoints >= 26`. Not tiered — 0/1000 mismatches (RESEARCH.md). */
const ACTIVATION_BONUS_THRESHOLD: RpTieredThreshold = { base: 26, districtChampionship: 26, championship: 26 };

/**
 * Sustainability Bonus threshold in LINKS (`linkPoints / 5`) when BOTH
 * alliances' coopertition criteria are NOT met. District Championship does
 * NOT bump (matches base): only Championship raises the threshold.
 */
const SUSTAINABILITY_THRESHOLD_NON_COOP: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 6 };

/** Sustainability Bonus threshold in LINKS when BOTH alliances' coopertition criteria ARE met. */
const SUSTAINABILITY_THRESHOLD_COOP: RpTieredThreshold = { base: 4, districtChampionship: 4, championship: 5 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "totalChargeStationPoints", unit: "points" },
  { name: "linkPoints", unit: "points" },
];

const BONUS_NAMES = ["activationBonus", "sustainabilityBonus"] as const;

export const rp2023: RpRuleModule = {
  season: 2023,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
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
    const links = own.linkPoints / 5;
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
   * `activationBonus` is fully computable from `totalChargeStationPoints`
   * alone. `sustainabilityBonus`'s real condition also gates on BOTH
   * alliances' `coopertitionCriteriaMet` (untracked, not a threshold
   * variable) — evaluated here assuming coopertition is NOT met, i.e. the
   * stricter `SUSTAINABILITY_THRESHOLD_NON_COOP` table, per
   * `RpRuleModule.predictThresholds`'s documented conservative-gate
   * convention (understates, never overstates, this bonus's probability).
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    const tier = eventTierFor(eventType);
    const totalChargeStationPoints = values.totalChargeStationPoints ?? 0;
    const linkPoints = values.linkPoints ?? 0;

    const activationBonus = totalChargeStationPoints >= ACTIVATION_BONUS_THRESHOLD[tier];
    const links = linkPoints / 5;
    const sustainabilityBonus = links >= SUSTAINABILITY_THRESHOLD_NON_COOP[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.activationBonus = activationBonus;
    bonusFlags.sustainabilityBonus = sustainabilityBonus;

    return { bonusFlags, totalRp: Number(activationBonus) + Number(sustainabilityBonus) };
  },
};
