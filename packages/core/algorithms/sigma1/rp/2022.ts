/**
 * 2022 (Rapid React) RP rule module (D-09, D-12). Manual citation: official
 * 2022 FRC Game Manual §6.4.1, Table 6-1
 * (`firstfrc.blob.core.windows.net/frc2022/Manual/HTML/2022FRCGameManual.htm`,
 * RESEARCH.md Code Examples). Verification method: corpus reconciliation
 * (`reconciliation.test.ts`) against TBA's own recorded
 * `cargoBonusRankingPoint`/`hangarBonusRankingPoint` flags in
 * `score_breakdown_raw`, for every played, non-offseason `qm` match with a
 * breakdown.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `autoCargoLower*`/`autoCargoUpper*`/`teleopCargo*` (per-goal breakdown
 * detail, not the RP-relevant totals), `endgameRobot1/2/3`/`taxiRobot1/2/3`
 * (per-robot fields — Pitfall Sigma1-2/Assumption A1, same discipline
 * `breakdown/2022.ts` already applies).
 *
 * Threshold comparison semantics are `>=` throughout (the manual states
 * every bonus as "at least N").
 *
 * Known data artifact (Pitfall 5, RESEARCH.md): a small, non-tiered
 * mismatch rate in Cargo Bonus reconciliation, concentrated at Regional/
 * District events (event_type 0/1), mismatches running in both directions
 * — inconsistent with a threshold error, consistent with a small number of
 * anomalous events (2022azfl, 2022txwac and others). Documented and
 * tolerated in `reconciliation.test.ts`, never chased by changing this
 * rule.
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`,
 * `autoCargoLower*`, `autoCargoUpper*`, `teleopCargo*`, `endgameRobot1/2/3`,
 * `taxiRobot1/2/3`, `rp`, etc.) are ignored, not rejected — zod's default
 * "strip" mode drops them without erroring. Deliberately NOT
 * `.passthrough()`/`.loose()`, matching `breakdown/2022.ts`'s discipline.
 */
const SideSchema = z.object({
  matchCargoTotal: z.number().finite(),
  autoCargoTotal: z.number().finite(),
  endgamePoints: z.number().finite(),
  cargoBonusRankingPoint: z.boolean(),
  hangarBonusRankingPoint: z.boolean(),
  quintetAchieved: z.boolean(),
});

const Rp2022Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Quintet condition: `autoCargoTotal >= 5` reduces the Cargo Bonus threshold. Not tiered (same value at every event tier — manual Table 6-1 states one flat number). */
const QUINTET_AUTO_CARGO_THRESHOLD: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 5 };

/** Cargo Bonus threshold when quintet NOT achieved: `matchCargoTotal >= 20`. Not tiered — 0 mismatches observed at event_type 2/3/5/100 (RESEARCH.md). */
const CARGO_BONUS_THRESHOLD_NON_QUINTET: RpTieredThreshold = { base: 20, districtChampionship: 20, championship: 20 };

/** Cargo Bonus threshold when quintet achieved: `matchCargoTotal >= 18`. Not tiered. */
const CARGO_BONUS_THRESHOLD_QUINTET: RpTieredThreshold = { base: 18, districtChampionship: 18, championship: 18 };

/** Hangar Bonus threshold: `endgamePoints >= 16`. Not tiered — 0/1000 mismatches (RESEARCH.md). */
const HANGAR_BONUS_THRESHOLD: RpTieredThreshold = { base: 16, districtChampionship: 16, championship: 16 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "matchCargoTotal", unit: "count" },
  { name: "autoCargoTotal", unit: "count" },
  { name: "endgamePoints", unit: "points" },
];

const BONUS_NAMES = ["cargoBonus", "hangarBonus"] as const;

export const rp2022: RpRuleModule = {
  season: 2022,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2022Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.matchCargoTotal = own.matchCargoTotal;
    thresholdVariables.autoCargoTotal = own.autoCargoTotal;
    thresholdVariables.endgamePoints = own.endgamePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2022 ${side}`);

    const quintetAchieved = own.autoCargoTotal >= QUINTET_AUTO_CARGO_THRESHOLD[tier];
    const cargoThreshold = quintetAchieved ? CARGO_BONUS_THRESHOLD_QUINTET[tier] : CARGO_BONUS_THRESHOLD_NON_QUINTET[tier];
    const cargoBonus = own.matchCargoTotal >= cargoThreshold;
    const hangarBonus = own.endgamePoints >= HANGAR_BONUS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.cargoBonus = cargoBonus;
    bonusFlags.hangarBonus = hangarBonus;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.cargoBonus = own.cargoBonusRankingPoint;
    recordedBonusFlags.hangarBonus = own.hangarBonusRankingPoint;

    const totalRp = Number(cargoBonus) + Number(hangarBonus);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },
};
