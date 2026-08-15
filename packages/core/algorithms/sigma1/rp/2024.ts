/**
 * 2024 (Crescendo) RP rule module (D-09, D-12). Manual citation: 2024 FRC
 * Game Manual §6.5.6, Table 6-2 (RESEARCH.md Code Examples, cross-checked
 * against corpus — the official manual HTML was not independently
 * re-fetched this session; `frcmanual.com/2024/game-details`'s base-tier
 * values matched the corpus exactly). Verification method: corpus
 * reconciliation (`reconciliation.test.ts`) against TBA's own recorded
 * `melodyBonusAchieved`/`ensembleBonusAchieved` flags.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints`/`autoTotalNotePoints`/
 * `teleopTotalNotePoints` (roll-ups), `coopNotePlayed` (a different
 * coopertition signal than `coopertitionBonusAchieved`, not read here),
 * `micStageLeft`/`micStageRight`/`micCenterStage`/`trapStageLeft`/
 * `trapStageRight`/`trapCenterStage` (per-position sensor/trap detail, not
 * the RP-relevant totals), the per-robot `autoLineRobot1/2/3` fields
 * (Pitfall Sigma1-2/Assumption A1) — `endGameRobot1/2/3` IS read, narrowly,
 * to derive the on-stage robot count Ensemble Bonus needs (no roll-up field
 * ships that count directly).
 *
 * Threshold comparison semantics are `>=` throughout.
 *
 * 2024 is the ONE season that ships its own per-match thresholds as data
 * (`melodyBonusThresholdCoop`/`melodyBonusThresholdNonCoop`,
 * `ensembleBonusStagePointsThreshold`/`ensembleBonusOnStageRobotsThreshold`)
 * — read here into `thresholdVariables` under `diagnosticKeys` ONLY for
 * `reconciliation.test.ts`'s independent tier-table cross-check (assertion
 * 5). They are NOT used to compute `bonusFlags`: those fields exist only on
 * a COMPLETED match, so the prediction path (plan 03-03) cannot see them —
 * a rule that silently works only for finished matches is the exact
 * failure mode this whole plan exists to prevent. `bonusFlags` are computed
 * from `event_type` (knowable pre-match) via the hardcoded tier table below.
 *
 * Melody Bonus's coopertition reduction is NOT a uniform "-3": corpus
 * verification (`melodyBonusThresholdCoop` per event_type) shows base
 * 18->15 (-3), districtChampionship 21->18 (-3), championship 25->21 (-4).
 * The coop and non-coop tables are therefore independent `RpTieredThreshold`
 * data, not one table minus a constant. Verified 0/28282 mismatches full
 * season.
 *
 * Ensemble Bonus's on-stage-robot-count condition has a measured, honest
 * residual reconciliation gap (~7% of the sampled population, spread across
 * ~185 distinct events, not concentrated at any one event or tier) that
 * this session could not resolve to 0 mismatches from `score_breakdown_raw`
 * alone — see `reconciliation.test.ts`'s documented tolerance for the exact
 * measured rate and the investigation record. The literal manual rule ("the
 * alliance scores at least 10 STAGE points and at least 2 ROBOTS are
 * ONSTAGE") is implemented as stated; the residual is not chased by
 * special-casing events or loosening the threshold, per this plan's
 * prohibition on widening tolerances to force a fit.
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

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
  // Diagnostic-only (Task 3 cross-check, see file header) — present only on
  // a completed match, never read to compute bonusFlags.
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

/** Melody Bonus NOTES threshold when coopertition achieved (`melodyBonusThresholdCoop`, verified per event_type — NOT a uniform -3 from the non-coop table, see file header). */
const MELODY_BONUS_THRESHOLD_COOP: RpTieredThreshold = { base: 15, districtChampionship: 18, championship: 21 };

/** Ensemble Bonus stage-points threshold (`ensembleBonusStagePointsThreshold`, constant across every sampled event type). */
const ENSEMBLE_BONUS_STAGE_POINTS_THRESHOLD: RpTieredThreshold = { base: 10, districtChampionship: 10, championship: 10 };

/** Ensemble Bonus minimum on-stage robot count (`ensembleBonusOnStageRobotsThreshold`, constant across every sampled event type). */
const ENSEMBLE_BONUS_ON_STAGE_ROBOTS_THRESHOLD: RpTieredThreshold = { base: 2, districtChampionship: 2, championship: 2 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "noteCount", unit: "count" },
  { name: "endGameTotalStagePoints", unit: "points" },
  { name: "onStageRobotCount", unit: "count" },
];

const BONUS_NAMES = ["melodyBonus", "ensembleBonus"] as const;

export const rp2024: RpRuleModule = {
  season: 2024,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
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
    // Diagnostic-only, see file header — not used to compute bonusFlags.
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
};
