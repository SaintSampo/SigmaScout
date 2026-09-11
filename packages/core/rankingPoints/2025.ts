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
 * (Open Question 1) and was corpus-converged in plan 03-02: bracketing
 * candidate per-level thresholds at event_type=3 found 7 (not the base
 * tier's 5) minimizes the mismatch rate (72/2004, vs 257/2004 at the base
 * value) — District Championship (event_type 2/5) does NOT bump, matching
 * this phase's repeated "DC never bumps, only Championship does" finding
 * (2023 Sustainability, 2025 Barge). CONFIRMED against the official manual
 * (2026-08-18): a human read the 2025 FRC Game Manual §6.5.4, Table 6-2 and
 * reported the Championship-tier per-reef-level count as 7, matching the
 * shipped/corpus-converged value exactly — see
 * `docs/models/sigma1-rp-verification.md`'s `## Threshold Provenance`. The
 * corpus-convergence evidence above is kept as corroborating evidence, not
 * the sole basis, now that it has an independent manual confirmation.
 *
 * The Coral Bonus coopertition gate was fixed in plan 03-08 (authorized
 * deviation) to require BOTH alliances' `coopertitionCriteriaMet` — see
 * `parse()`'s comment on `bothCoopMet` below and
 * `docs/models/sigma1-rp-verification.md` for the measured effect.
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

/** Per-level CORAL count threshold ("at least 5 on each level") when coopertition NOT relaxing the requirement. Championship value corpus-converged in plan 03-02, manual-confirmed 2026-08-18 against 2025 FRC Game Manual §6.5.4, Table 6-2 (see file header). */
const CORAL_LEVEL_THRESHOLD_STRICT: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };

/** Per-level CORAL count threshold for the "at least 3 of 4 levels" relaxed coopertition path. WR-02 (03-REVIEW.md): deliberately DERIVED from `CORAL_LEVEL_THRESHOLD_STRICT`, not an independent literal — the coopertition relaxation changes how MANY of the four reef levels must clear the threshold (3-of-4 vs 4-of-4), never the per-level count itself. Same table by rule, not by coincidence; a future threshold correction to one is now guaranteed to move both. */
const CORAL_LEVEL_THRESHOLD_COOP: RpTieredThreshold = CORAL_LEVEL_THRESHOLD_STRICT;

/** Number of reef levels (of 4) that must clear the per-level threshold when coopertition IS met. */
const CORAL_BONUS_COOP_LEVELS_REQUIRED = 3;

/** Barge Bonus `endGameBargePoints` threshold. District Championship does NOT bump — only Championship does (verified: DC-tier mismatch rate is minimized at the base value, not the championship value). */
const BARGE_BONUS_THRESHOLD: RpTieredThreshold = { base: 14, districtChampionship: 14, championship: 16 };

/** How many of the three recorded robots must leave the starting line for the Auto Bonus. */
const AUTO_LINE_ROBOTS_REQUIRED = 3;

/** Minimum CORAL scored in auto for the Auto Bonus. */
const AUTO_CORAL_REQUIRED = 1;

// 09-05 Task 3 (D-01): all seven variables below flip to "negative-binomial"
// — MEASURED evidence class (09-RESEARCH.md's broader corpus probe). See
// constants.ts's `MarginalFamily` doc comment for the evidence-class
// framework.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "trough",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
  {
    name: "botRow",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
  {
    name: "midRow",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
  {
    name: "topRow",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
  {
    name: "endGameBargePoints",
    unit: "points",
    marginalFamily: "negative-binomial",
  },
  // Added 2026-09-09 so `autoBonus` can be PREDICTED at all. Before this it
  // was hardcoded `false` in `predictThresholds` below, honestly documented as
  // the limit of what the tracked variables could express — but measured over
  // 25,978 alliance-observations it happens 65.94% of the time, which made
  // that hardcoded `false` the second-worst prediction in the whole RP layer
  // (Brier 0.6594, worse than predicting 0.5 for everything). It was a missing
  // input, not a modelling approximation, so the input is now tracked.
  {
    name: "autoLineCount",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
  {
    name: "autoCoralCount",
    unit: "count",
    marginalFamily: "negative-binomial",
  },
];

/**
 * D-02, D-07, Pitfall 4: `autoBonus` is `conjunctionDistinct` over two
 * DISTINCT, both-tracked counts (`autoLineCount`, `autoCoralCount`) — NO
 * `untrackedGate`: both variables have been tracked since 2026-09-09 (see
 * `THRESHOLD_VARIABLES` comment above). `coralBonus` is `countOfIndicators`
 * over the four reef levels at the STRICT (non-coop) per-level threshold,
 * `required: 4` (all four — `indicators.length`), carrying an
 * `RpUntrackedGate` for the untracked both-alliances
 * `coopertitionCriteriaMet` signal. `bargeBonus` is `singleThreshold`.
 */
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
        "Evaluated at the strict all-4-levels count because coopertitionCriteriaMet is not a tracked threshold variable; the coop branch would require only CORAL_BONUS_COOP_LEVELS_REQUIRED (3) of the four. pnpm rp:conservative-branch measures a pooled-season meanRpUnderstatement of 0.095405 RP per alliance-match (understatedRate 9.5405%) — see docs/models/sigma1-rp-verification.md's Conservative-Branch Understatement section.",
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
    // The two Auto Bonus inputs, as COUNTS so the predictive branch can reason
    // about them the same way it reasons about reef levels. `autoLineCount` is
    // the number of the three recorded robots that left, which is exactly what
    // the "all robots leave" condition is counting.
    const autoLineCount = [own.autoLineRobot1, own.autoLineRobot2, own.autoLineRobot3].filter((v) => v !== "No").length;
    thresholdVariables.autoLineCount = autoLineCount;
    thresholdVariables.autoCoralCount = own.autoCoralCount;
    assertFiniteThresholdVariables(thresholdVariables, `rp2025 ${side}`);

    // Auto Bonus: all (recorded) robots leave AND >=1 CORAL scored in auto.
    // Expressed through the same two counts the predictive branch reads, so
    // the observed and predicted definitions cannot drift apart.
    const autoBonus = autoLineCount >= AUTO_LINE_ROBOTS_REQUIRED && own.autoCoralCount >= AUTO_CORAL_REQUIRED;

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
   * convention.
   *
   * `autoBonus` USED TO BE hardcoded `false` here, on the reasoning that it
   * depends on per-robot leave flags a count-unit state cannot represent.
   * Measured 2026-09-09, that cost far more than the honesty was worth: the
   * bonus happens 65.94% of the time, so always-false scored a Brier of 0.6594
   * over 25,978 observations — worse than predicting 0.5 for everything, and
   * the second-worst number in the RP layer. It is now evaluated from two
   * tracked counts, which express the condition exactly: "all three recorded
   * robots left" IS a count reaching 3.
   *
   * The remaining approximation is honest and much smaller: a count drawn from
   * a continuous distribution and cut at its own ceiling still understates how
   * often all three robots leave, because "3 of 3" is a discrete outcome at the
   * top of the range rather than a tail event.
   *
   * Delegates to the shared declarative evaluator (D-02, D-07); see
   * `BONUS_PREDICATES` above.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
