/**
 * 2025 (Reefscape) RP rule module (D-09, D-12). Manual citation: 2025 FRC
 * Game Manual §6.5.4, Table 6-2 (RESEARCH.md Code Examples, cross-checked
 * against corpus — `frcmanual.com/2025/game-details`'s base-tier structure
 * matched; the official manual PDF's specific tier-table page was not
 * independently re-fetched this session). Verification method: corpus
 * reconciliation (`reconciliation.test.ts`) against TBA's own recorded
 * `autoBonusAchieved`/`coralBonusAchieved`/`bargeBonusAchieved` flags.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `autoReef`/`teleopReef`'s per-node boolean grids (`botRow`/`midRow`/
 * `topRow` sub-objects) — only the pre-aggregated `tba_{level}Count` fields
 * and `trough` are read, `algaePoints`/`netAlgaeCount`/`wallAlgaeCount`
 * (algae scoring is not RP-relevant for any of the three bonuses below),
 * the per-robot `autoLineRobot1/2/3`/`endGameRobot1/2/3` fields are read
 * NARROWLY (Auto Bonus needs the per-robot leave flags; no roll-up field
 * ships an "all robots left" count directly) — this is the one deliberate
 * exception to Pitfall Sigma1-2/Assumption A1's per-robot-field avoidance
 * in this phase, forced by the rule itself needing per-robot leave state.
 *
 * Threshold comparison semantics are `>=` throughout.
 *
 * Per-level CORAL count is `autoReef.tba_{level}Count + teleopReef.tba_{level}Count`,
 * EXCEPT trough which has no `tba_*Count` field — its count is
 * `autoReef.trough + teleopReef.trough`. A single summed `coralCount >= N`
 * hypothesis produces ~40% mismatches (RESEARCH.md Anti-Patterns) and is
 * never used.
 *
 * Three measured, honestly-reported reconciliation gaps this session could
 * not resolve to 0 mismatches (documented with exact rates in
 * `reconciliation.test.ts`, never chased by widening a threshold or
 * special-casing an event):
 * - Auto Bonus: TBA's `autoLineRobot{1,2,3}` "No" cannot be distinguished
 *   between "robot did not leave" and "robot was never enabled" (the manual
 *   requires only ENABLED robots to leave) — a ~2% residual, evenly spread
 *   across which robot position is missing, consistent with this
 *   irreducible data-source ambiguity rather than a rule error.
 * - Coral Bonus: a ~3% residual persists at every tier even after the
 *   Championship-tier threshold was corpus-converged (see below).
 * - Barge Bonus: a ~4% residual, concentrated entirely at Regional/District
 *   (base tier) and ALWAYS a false negative (the >=14 rule never
 *   over-predicts: 0 false positives) — consistent with an unmodeled
 *   alternate achievement path this session could not identify from
 *   `score_breakdown_raw` alone.
 *
 * Coral Bonus's Championship-tier threshold was UNPINNED in RESEARCH.md
 * (Open Question 1) and has been corpus-converged this session: bracketing
 * candidate per-level thresholds at event_type=3 found 7 (not the base
 * tier's 5) minimizes the mismatch rate (72/2004, vs 257/2004 at the base
 * value) — District Championship (event_type 2/5) does NOT bump, matching
 * this phase's repeated "DC never bumps, only Championship does" finding
 * (2023 Sustainability, 2025 Barge). This converged value should still be
 * confirmed against the official manual's own Table 6-2 (plan's
 * human-check step).
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

const ReefSchema = z.object({
  trough: z.number().finite(),
  tba_botRowCount: z.number().finite(),
  tba_midRowCount: z.number().finite(),
  tba_topRowCount: z.number().finite(),
});

const SideSchema = z.object({
  autoLineRobot1: z.string(),
  autoLineRobot2: z.string(),
  autoLineRobot3: z.string(),
  autoCoralCount: z.number().finite(),
  autoReef: ReefSchema,
  teleopReef: ReefSchema,
  endGameBargePoints: z.number().finite(),
  coopertitionCriteriaMet: z.boolean(),
  autoBonusAchieved: z.boolean(),
  coralBonusAchieved: z.boolean(),
  bargeBonusAchieved: z.boolean(),
});

const Rp2025Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Per-level CORAL count threshold ("at least 5 on each level") when coopertition NOT relaxing the requirement. Championship value corpus-converged this session (see file header) — confirm against the manual. */
const CORAL_LEVEL_THRESHOLD_STRICT: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };

/** Per-level CORAL count threshold for the "at least 3 of 4 levels" relaxed coopertition path. */
const CORAL_LEVEL_THRESHOLD_COOP: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };

/** Number of reef levels (of 4) that must clear the per-level threshold when coopertition IS met. */
const CORAL_BONUS_COOP_LEVELS_REQUIRED = 3;

/** Barge Bonus `endGameBargePoints` threshold. District Championship does NOT bump — only Championship does (verified: DC-tier mismatch rate is minimized at the base value, not the championship value). */
const BARGE_BONUS_THRESHOLD: RpTieredThreshold = { base: 14, districtChampionship: 14, championship: 16 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "trough", unit: "count" },
  { name: "botRow", unit: "count" },
  { name: "midRow", unit: "count" },
  { name: "topRow", unit: "count" },
  { name: "endGameBargePoints", unit: "points" },
];

const BONUS_NAMES = ["autoBonus", "coralBonus", "bargeBonus"] as const;

export const rp2025: RpRuleModule = {
  season: 2025,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 3 + BONUS_NAMES.length,
  winRp: 3,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2025Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;
    const tier = eventTierFor(eventType);

    const trough = own.autoReef.trough + own.teleopReef.trough;
    const botRow = own.autoReef.tba_botRowCount + own.teleopReef.tba_botRowCount;
    const midRow = own.autoReef.tba_midRowCount + own.teleopReef.tba_midRowCount;
    const topRow = own.autoReef.tba_topRowCount + own.teleopReef.tba_topRowCount;

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.trough = trough;
    thresholdVariables.botRow = botRow;
    thresholdVariables.midRow = midRow;
    thresholdVariables.topRow = topRow;
    thresholdVariables.endGameBargePoints = own.endGameBargePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2025 ${side}`);

    // Auto Bonus: all (recorded) robots leave AND >=1 CORAL scored in auto.
    const allRobotsLeft = own.autoLineRobot1 !== "No" && own.autoLineRobot2 !== "No" && own.autoLineRobot3 !== "No";
    const autoBonus = allRobotsLeft && own.autoCoralCount >= 1;

    // Coral Bonus: >=N on each of 4 levels, relaxed to >=N on >=3 of 4 when coopertition met.
    // Coopertition requires BOTH alliances' criteria met — AND, never OR (same
    // fix as 2023's sustainabilityBonus, see 2023.ts). `own.coopertitionCriteriaMet`
    // alone gates only THIS alliance's half of a pair condition; the corpus-measured
    // effect of that bug (72/2004 -> 5/2004 mismatches at championship tier, all
    // false positives) is recorded in docs/models/sigma1-rp-verification.md.
    const levels = [trough, botRow, midRow, topRow];
    const strictCount = levels.filter((v) => v >= CORAL_LEVEL_THRESHOLD_STRICT[tier]).length;
    const coopCount = levels.filter((v) => v >= CORAL_LEVEL_THRESHOLD_COOP[tier]).length;
    const bothCoopMet = own.coopertitionCriteriaMet && opponent.coopertitionCriteriaMet;
    const coralBonus = bothCoopMet ? coopCount >= CORAL_BONUS_COOP_LEVELS_REQUIRED : strictCount === levels.length;

    // Barge Bonus: endGameBargePoints >= tiered threshold.
    const bargeBonus = own.endGameBargePoints >= BARGE_BONUS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.autoBonus = autoBonus;
    bonusFlags.coralBonus = coralBonus;
    bonusFlags.bargeBonus = bargeBonus;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.autoBonus = own.autoBonusAchieved;
    recordedBonusFlags.coralBonus = own.coralBonusAchieved;
    recordedBonusFlags.bargeBonus = own.bargeBonusAchieved;

    const totalRp = Number(autoBonus) + Number(coralBonus) + Number(bargeBonus);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 3,
      tieRp: 1,
      totalRp,
    };
  },

  /**
   * `bargeBonus` is fully computable from `endGameBargePoints` alone.
   * `coralBonus`'s real condition also gates on `own.coopertitionCriteriaMet`
   * (untracked) — evaluated here at the STRICT (non-coop, all-4-levels)
   * path, per `RpRuleModule.predictThresholds`'s conservative-gate
   * convention. `autoBonus` depends ENTIRELY on fields this season tracks
   * no Kalman state for at all (`autoLineRobot1/2/3`'s per-robot leave
   * flags, `autoCoralCount`) — there is no threshold-variable-only fallback
   * for it, so it is always `false` here, the single, honestly-documented
   * exception to "evaluate what the tracked variables allow": this is not a
   * silently wrong prediction, it is the stated limit of what a count-unit
   * Kalman state (D-09) can represent for a per-robot binary condition.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    const tier = eventTierFor(eventType);
    const trough = values.trough ?? 0;
    const botRow = values.botRow ?? 0;
    const midRow = values.midRow ?? 0;
    const topRow = values.topRow ?? 0;
    const endGameBargePoints = values.endGameBargePoints ?? 0;

    const autoBonus = false;
    const levels = [trough, botRow, midRow, topRow];
    const coralBonus = levels.every((v) => v >= CORAL_LEVEL_THRESHOLD_STRICT[tier]);
    const bargeBonus = endGameBargePoints >= BARGE_BONUS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.autoBonus = autoBonus;
    bonusFlags.coralBonus = coralBonus;
    bonusFlags.bargeBonus = bargeBonus;

    return { bonusFlags, totalRp: Number(autoBonus) + Number(coralBonus) + Number(bargeBonus) };
  },
};
