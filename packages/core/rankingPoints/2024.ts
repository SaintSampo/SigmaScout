/**
 * 2024 (Crescendo) RP rule module. Source: 2024 FRC Game Manual §6.5.6, Table 6-2.
 * Verified by corpus reconciliation (`reconciliation.test.ts`) against TBA's
 * recorded `melodyBonusAchieved`/`ensembleBonusAchieved` flags.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints`/`autoTotalNotePoints`/
 * `teleopTotalNotePoints` (roll-ups), `coopNotePlayed` (a different signal from
 * `coopertitionBonusAchieved`), the per-position `mic*`/`trap*` fields, and the
 * per-robot `autoLineRobot1/2/3` fields. `endGameRobot1/2/3` IS read, to derive the
 * on-stage robot count Ensemble Bonus needs (no roll-up field ships it).
 *
 * Thresholds compare with `>=`.
 *
 * 2024 is the one season whose breakdown ships its own thresholds
 * (`melodyBonusThreshold*`, `ensembleBonus*Threshold`). They are read under
 * `diagnosticKeys` only, for `reconciliation.test.ts`'s tier-table cross-check, and
 * never used for `bonusFlags`: they exist only on completed matches, so the
 * prediction path cannot see them. `bonusFlags` use the pre-match `event_type`
 * tier tables below.
 *
 * Melody's coopertition reduction is not a uniform -3 (championship is 25->21), so
 * the coop and non-coop tables are independent data. Verified 0/28282 mismatches.
 *
 * Ensemble Bonus has a ~7% residual spread across ~185 events (tolerance in
 * `reconciliation.test.ts`). The literal manual rule (at least 10 STAGE points and
 * at least 2 ROBOTS ONSTAGE) is implemented as stated; the residual is not chased by
 * special-casing events or loosening the threshold.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

const ON_STAGE_STATES = new Set(["StageLeft", "StageRight", "CenterStage"]);

const SideSchema = z.object({
  autoAmpNoteCount: z.number().finite(),
  autoSpeakerNoteCount: z.number().finite(),
  teleopAmpNoteCount: z.number().finite(),
  teleopSpeakerNoteCount: z.number().finite(),
  teleopSpeakerNoteAmplifiedCount: z.number().finite(),
  endGameTotalStagePoints: z.number().finite(),
  endGameRobot1: z.string(),
  endGameRobot2: z.string(),
  endGameRobot3: z.string(),
  coopertitionBonusAchieved: z.boolean(),
  melodyBonusAchieved: z.boolean(),
  ensembleBonusAchieved: z.boolean(),
  // Diagnostic-only (see file header): present only on a completed match, never used for bonusFlags.
  melodyBonusThresholdCoop: z.number().finite(),
  melodyBonusThresholdNonCoop: z.number().finite(),
  ensembleBonusStagePointsThreshold: z.number().finite(),
  ensembleBonusOnStageRobotsThreshold: z.number().finite(),
});

const Rp2024Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Melody Bonus NOTES threshold when coopertition NOT achieved (`melodyBonusThresholdNonCoop`, verified per event_type). */
const MELODY_BONUS_THRESHOLD_NON_COOP: RpTieredThreshold = { base: 18, districtChampionship: 21, championship: 25 };

/** Melody Bonus NOTES threshold when coopertition achieved (`melodyBonusThresholdCoop`, verified per event_type; not a uniform -3 from the non-coop table). */
const MELODY_BONUS_THRESHOLD_COOP: RpTieredThreshold = { base: 15, districtChampionship: 18, championship: 21 };

/** Ensemble Bonus stage-points threshold (`ensembleBonusStagePointsThreshold`, constant across every sampled event type). */
const ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD: RpTieredThreshold = { base: 10, districtChampionship: 10, championship: 10 };

/** Ensemble Bonus minimum on-stage robot count (`ensembleBonusOnStageRobotsThreshold`, constant across every sampled event type). */
const ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD: RpTieredThreshold = { base: 2, districtChampionship: 2, championship: 2 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "noteCount",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: no NOTE cap.
    lattice: { step: 1, min: 0 },
  },
  {
    name: "endGameTotalStagePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: Table 6-2: ONSTAGE 3 (4 SPOTLIT), HARMONY 2 per extra ROBOT, TRAP 5 x 3: 12 + 4 + 15.
    lattice: { step: 1, min: 0, max: 31 },
  },
  {
    name: "onStageRobotCount",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: 3 robots.
    lattice: { step: 1, min: 0, max: 3 },
  },
];

const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "singleThreshold",
    name: "melodyBonus",
    variable: "noteCount",
    direction: "gte",
    threshold: MELODY_BONUS_THRESHOLD_NON_COOP,
    untrackedGate: {
      signal: "coopertitionBonusAchieved",
      branch: "conservative",
      errorDirection: "understates",
      note:
        "Evaluated at the stricter non-coop notes table because coopertitionBonusAchieved is not a tracked threshold variable. pnpm rp:conservative-branch measures a pooled-season meanRpUnderstatement of 0.123188 RP per alliance-match (understatedRate 12.3188%) — see docs/models/sigma1-rp-verification.md's Conservative-Branch Understatement section.",
    },
  },
  {
    kind: "conjunctionDistinct",
    name: "ensembleBonus",
    clauses: [
      { terms: [{ variable: "endGameTotalStagePoints" }], direction: "gte", threshold: ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD },
      { terms: [{ variable: "onStageRobotCount" }], direction: "gte", threshold: ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD },
    ],
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2024: RpRuleModule = {
  season: 2024,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,
  diagnosticKeys: [
    "melodyBonusThresholdCoop",
    "melodyBonusThresholdNonCoop",
    "ensembleBonusStagePointsThreshold",
    "ensembleBonusOnStageRobotsThreshold",
  ],

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2024Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const noteCount =
      own.autoAmpNoteCount + own.autoSpeakerNoteCount + own.teleopAmpNoteCount + own.teleopSpeakerNoteCount + own.teleopSpeakerNoteAmplifiedCount;
    const onStageRobotCount = [own.endGameRobot1, own.endGameRobot2, own.endGameRobot3].filter((v) => ON_STAGE_STATES.has(v)).length;

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.noteCount = noteCount;
    thresholdVariables.endGameTotalStagePoints = own.endGameTotalStagePoints;
    thresholdVariables.onStageRobotCount = onStageRobotCount;
    // Diagnostic-only (see file header): not used to compute bonusFlags.
    thresholdVariables.melodyBonusThresholdCoop = own.melodyBonusThresholdCoop;
    thresholdVariables.melodyBonusThresholdNonCoop = own.melodyBonusThresholdNonCoop;
    thresholdVariables.ensembleBonusStagePointsThreshold = own.ensembleBonusStagePointsThreshold;
    thresholdVariables.ensembleBonusOnStageRobotsThreshold = own.ensembleBonusOnStageRobotsThreshold;
    assertFiniteThresholdVariables(thresholdVariables, `rp2024 ${side}`);

    const melodyThreshold = own.coopertitionBonusAchieved ? MELODY_BONUS_THRESHOLD_COOP[tier] : MELODY_BONUS_THRESHOLD_NON_COOP[tier];
    const melodyBonus = noteCount >= melodyThreshold;
    const ensembleBonus =
      own.endGameTotalStagePoints >= ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD[tier] &&
      onStageRobotCount >= ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.melodyBonus = melodyBonus;
    bonusFlags.ensembleBonus = ensembleBonus;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.melodyBonus = own.melodyBonusAchieved;
    recordedBonusFlags.ensembleBonus = own.ensembleBonusAchieved;

    const totalRp = Number(melodyBonus) + Number(ensembleBonus);

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
   * `melodyBonus` also gates on the untracked `coopertitionBonusAchieved`, so it is
   * evaluated at the stricter non-coop table (the conservative-gate convention of
   * `RpRuleModule.predictThresholds`).
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
