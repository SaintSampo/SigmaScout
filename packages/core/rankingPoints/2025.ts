/**
 * 2025 (Reefscape) RP rule module. Source: 2025 FRC Game Manual §6.5.4, Table 6-2.
 * Verified by corpus reconciliation (`reconciliation.test.ts`) against TBA's
 * recorded `autoBonusAchieved`/`coralBonusAchieved`/`bargeBonusAchieved` flags.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups), the per-node
 * reef grids (only the pre-aggregated `tba_{level}Count` fields and `trough` are
 * read), and algae fields (not RP-relevant). The per-robot `autoLineRobot1/2/3`
 * fields are read because the Auto Bonus needs per-robot leave state and no
 * roll-up field ships it.
 *
 * Thresholds compare with `>=`. Per-level CORAL count is
 * `autoReef.tba_{level}Count + teleopReef.tba_{level}Count`, except trough (no
 * `tba_*Count` field): `autoReef.trough + teleopReef.trough`. A single summed
 * `coralCount >= N` produces ~40% mismatches and is never used.
 *
 * Known reconciliation residuals (rates in `reconciliation.test.ts`; never chased
 * by widening a threshold or special-casing an event):
 * - Auto Bonus ~2%: TBA's "No" cannot distinguish "did not leave" from "never
 *   enabled" (the manual requires only enabled robots to leave).
 * - Coral Bonus ~3% at every tier.
 * - Barge Bonus ~4%, base tier only and always a false negative, consistent with
 *   an unmodeled alternate achievement path.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

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

/** Per-level CORAL count ("at least 5 on each level") when coopertition is not met. The Championship 7 is manual-confirmed and corpus-converged; District Championship does not bump. */
const CORAL_LEVEL_THRESHOLD_STRICT: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };

/** Derived from the strict table by rule: coopertition relaxes how many of the four levels must clear (3 of 4), never the per-level count. */
const CORAL_LEVEL_THRESHOLD_COOP: RpTieredThreshold = CORAL_LEVEL_THRESHOLD_STRICT;

/** Number of reef levels (of 4) that must clear the per-level threshold when coopertition IS met. */
const CORAL_BONUS_COOP_LEVELS_REQUIRED = 3;

/** Barge Bonus `endGameBargePoints` threshold. Only Championship bumps: the DC-tier mismatch rate is minimized at the base value. */
const BARGE_BONUS_THRESHOLD: RpTieredThreshold = { base: 14, districtChampionship: 14, championship: 16 };

/** How many of the three recorded robots must leave the starting line for the Auto Bonus. */
const AUTO_LINE_ROBOTS_REQUIRED = 3;

/** Minimum CORAL scored in auto for the Auto Bonus. */
const AUTO_CORAL_REQUIRED = 1;

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "trough",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: manual sets no L1 limit.
    lattice: { step: 1, min: 0 },
  },
  {
    name: "botRow",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: 12 BRANCHES per level.
    lattice: { step: 1, min: 0, max: 12 },
  },
  {
    name: "midRow",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: 12 BRANCHES per level.
    lattice: { step: 1, min: 0, max: 12 },
  },
  {
    name: "topRow",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: 12 BRANCHES per level.
    lattice: { step: 1, min: 0, max: 12 },
  },
  {
    name: "endGameBargePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: Table 6-2: PARK 2 / SHALLOW 6 / DEEP 12 per robot.
    lattice: { step: 2, min: 0, max: 36 },
  },
  // Tracked so `autoBonus` can be predicted; it occurs in about 66% of alliance-matches.
  {
    name: "autoLineCount",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: 3 robots.
    lattice: { step: 1, min: 0, max: 3 },
  },
  {
    name: "autoCoralCount",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: no AUTO coral limit.
    lattice: { step: 1, min: 0 },
  },
];

const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "conjunctionDistinct",
    name: "autoBonus",
    clauses: [
      { terms: [{ variable: "autoLineCount" }], direction: "gte", threshold: AUTO_LINE_ROBOTS_REQUIRED },
      { terms: [{ variable: "autoCoralCount" }], direction: "gte", threshold: AUTO_CORAL_REQUIRED },
    ],
  },
  {
    kind: "countOfIndicators",
    name: "coralBonus",
    indicators: (["trough", "botRow", "midRow", "topRow"] as const).map((variable) => ({
      terms: [{ variable }],
      direction: "gte" as const,
      threshold: CORAL_LEVEL_THRESHOLD_STRICT,
    })),
    required: 4,
    untrackedGate: {
      signal: "coopertitionCriteriaMet (both alliances)",
      branch: "conservative",
      errorDirection: "understates",
      note:
        "Evaluated at the strict all-4-levels count because coopertitionCriteriaMet is not a tracked threshold variable; the coop branch would require only CORAL_BONUS_COOP_LEVELS_REQUIRED (3) of the four. A pooled-season measurement recorded a meanRpUnderstatement of 0.095405 RP per alliance-match (understatedRate 9.5405%) — see docs/models/rp-verification.md's Conservative-Branch Understatement section.",
    },
  },
  {
    kind: "singleThreshold",
    name: "bargeBonus",
    variable: "endGameBargePoints",
    direction: "gte",
    threshold: BARGE_BONUS_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2025: RpRuleModule = {
  season: 2025,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
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
    // Auto Bonus inputs as counts, so the predictive branch reads them like reef levels.
    const autoLineCount = [own.autoLineRobot1, own.autoLineRobot2, own.autoLineRobot3].filter((v) => v !== "No").length;
    thresholdVariables.autoLineCount = autoLineCount;
    thresholdVariables.autoCoralCount = own.autoCoralCount;
    assertFiniteThresholdVariables(thresholdVariables, `rp2025 ${side}`);

    // Auto Bonus: all recorded robots leave AND >=1 CORAL in auto, through the same
    // counts the predictive branch reads so the two definitions cannot drift apart.
    const autoBonus = autoLineCount >= AUTO_LINE_ROBOTS_REQUIRED && own.autoCoralCount >= AUTO_CORAL_REQUIRED;

    // Coral Bonus: >=N on each of 4 levels, relaxed to >=N on >=3 of 4 when coopertition met.
    // Coopertition requires BOTH alliances' criteria (AND, never OR, as in 2023.ts);
    // `own.coopertitionCriteriaMet` alone is only this alliance's half of the pair condition.
    const levels = [trough, botRow, midRow, topRow];
    const strictCount = levels.filter((v) => v >= CORAL_LEVEL_THRESHOLD_STRICT[tier]).length;
    const coopCount = levels.filter((v) => v >= CORAL_LEVEL_THRESHOLD_COOP[tier]).length;
    const bothCoopMet = own.coopertitionCriteriaMet && opponent.coopertitionCriteriaMet;
    const coralBonus = bothCoopMet ? coopCount >= CORAL_BONUS_COOP_LEVELS_REQUIRED : strictCount === levels.length;

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
   * `coralBonus` also gates on the untracked `coopertitionCriteriaMet`, so it is
   * evaluated at the strict all-4-levels path (the conservative-gate convention of
   * `RpRuleModule.predictThresholds`). `autoBonus` is exact over two tracked counts:
   * "all three recorded robots left" is a count reaching 3.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
