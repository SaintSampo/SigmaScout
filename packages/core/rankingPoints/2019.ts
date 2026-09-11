/**
 * 2019 (Destination: Deep Space) RP rule module (D-09, D-12). Thresholds
 * DERIVED from data, not cited from a manual. Verification method: corpus
 * reconciliation (`reconciliation.test.ts`) against TBA's own recorded
 * `habDockingRankingPoint`/`completeRocketRankingPoint` flags, full
 * population (29,858 alliance-sides, 2026-09-03 measurement). Field
 * inventory: `docs/data/tba-field-recon-2019-2020.md`. Threshold sweeps,
 * rocket-rule comparison and rate tables:
 * `docs/data/tba-rp-thresholds-2019-2020.md`, `docs/data/tba-rocket-rp-2019.md`,
 * `docs/data/tba-rp-rates-2019-2020.md`.
 *
 * This module carries TWO bonuses, each with its own measured profile.
 *
 * **HAB Docking Bonus**: `habClimbPoints >= 15`. **100.00% agreement at
 * ALL THREE event tiers** — MEASURED, not assumed: 0 mismatches over
 * 29,858 sides (base n=24,340; districtChampionship n=2,802; championship
 * n=2,716). The flatness across tiers is a measured fact, which is why the
 * threshold triple below is uniform rather than tiered.
 *
 * **Complete Rocket Bonus**: recomputed as
 * `completedRocketNear || completedRocketFar` — 98.19% agreement overall;
 * **0.00% FALSE POSITIVES at every event tier**; 1.81% false negatives
 * (measured ceiling 3.8292% at event_type 3). It under-fires and never
 * over-fires — the conservative direction this codebase already prefers
 * for a residual reconciliation gap. `reconciliation.test.ts`'s
 * `KNOWN_TOLERANCES` carries the one tolerance entry this bonus needs,
 * derived from this measurement, never guessed.
 *
 * **CRITICAL asymmetry for the Complete Rocket Bonus — `parse` and
 * `predictThresholds` differ:**
 *
 * - `parse` recomputes it as the logical OR of `completedRocketNear` and
 *   `completedRocketFar`, both booleans present in the raw breakdown and
 *   available at parse time.
 * - `predictThresholds` CANNOT reach them: it receives only numeric
 *   threshold-variable values, because `analyticPmf.ts`'s closed form
 *   (plan 09-04) fits marginals from threshold variables, never a full
 *   breakdown (this used to read "the Monte Carlo joint draw in
 *   `rp/distribution.ts` samples threshold variables", a module this repo
 *   no longer has). So this bonus takes the CONSERVATIVE BRANCH and is always
 *   `false` there, following 2025's `autoBonus` precedent (see
 *   `2025.ts`), which `RpRuleModule.predictThresholds`'s own doc comment
 *   already names as the established pattern for a bonus with no
 *   threshold-variable-only fallback. The measured understatement here is
 *   ~0.0654 RP per alliance-match — roughly TEN TIMES SMALLER than the
 *   0.625464 already shipped for 2025's `autoBonus` — so this choice reads
 *   as precedent-following, not a shortcut.
 * - The bonus therefore contributes NO entry to `thresholdVariables`; the
 *   single tracked variable for this season is `habClimbPoints`.
 *
 * Rejected: a joint `hatchPanelPoints`/`cargoPoints` threshold variant for
 * Complete Rocket. Its best form scored 94.49% — worse than the boolean
 * OR — and introduced 0.51% FALSE POSITIVES, violating this project's
 * never-overstate direction. Not used.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups —
 * `autoPoints` is numerically identical to `sandStormBonusPoints`, see
 * `breakdown/2019.ts`'s header for why that identity is a hazard, not a
 * convenience), `endgameRobot1/2/3`/`habLineRobot1/2/3`/
 * `preMatchLevelRobot1/2/3` (per-robot fields — Pitfall Sigma1-2/
 * Assumption A1), the per-bay `bay1`..`bay8`/`preMatchBay*`/
 * `*RocketFar`/`*RocketNear` detail fields (the rejected joint-threshold
 * variant above already showed this level of detail does not help).
 *
 * Threshold comparison semantics are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `bay1`..`bay8`, `preMatchBay*`, per-bay `*RocketFar`/`*RocketNear`,
 * `endgameRobot1/2/3`, `habLineRobot1/2/3`, `preMatchLevelRobot1/2/3`,
 * `rp`, etc.) are ignored, not rejected — zod's default "strip" mode drops
 * them without erroring. Deliberately NOT `.passthrough()`/`.loose()`,
 * matching `breakdown/2019.ts`'s discipline.
 */
const SideSchema = z.object({
  habClimbPoints: z.number().finite(),
  completedRocketNear: z.boolean(),
  completedRocketFar: z.boolean(),
  habDockingRankingPoint: z.boolean(),
  completeRocketRankingPoint: z.boolean(),
});

const Rp2019Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** HAB Docking Bonus threshold: `habClimbPoints >= 15`. Not tiered — flatness MEASURED (0 mismatches at every tier over 29,858 sides), not assumed. */
const HAB_DOCKING_THRESHOLD: RpTieredThreshold = { base: 15, districtChampionship: 15, championship: 15 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "habClimbPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
];

/**
 * Complete Rocket carries no threshold variable (see file header's
 * asymmetry note): it is recomputed in `parse` from two booleans, not a
 * numeric threshold, so it has nothing to add to `THRESHOLD_VARIABLES`
 * above. `maxRp` still derives to `2 + 2 = 4` because `bonusNames.length`
 * counts it regardless of whether it tracks a threshold variable.
 *
 * D-02, D-07: `habDocking` is `singleThreshold`. `completeRocket` is
 * declared `constant`, `value: false` — F12, out of scope for Phase 9. It
 * has no threshold-variable-only fallback at all (see file header), so
 * there is nothing to gate with an `RpUntrackedGate`; the `reason` field is
 * where a `constant` predicate carries that justification instead. Measured
 * (`pnpm rp:conservative-branch`): a pooled-season understatedRate of
 * 4.7324%, predicted 0.0000 against an observed ~5.15% (F12) — declared
 * here, not fixed, per this plan's explicit out-of-scope list.
 */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "singleThreshold",
    name: "habDocking",
    variable: "habClimbPoints",
    direction: "gte",
    threshold: HAB_DOCKING_THRESHOLD,
  },
  {
    kind: "constant",
    name: "completeRocket",
    value: false,
    reason:
      "F12: no threshold-variable-only fallback exists for completedRocketNear || completedRocketFar (both booleans, unreachable from predictThresholds). Predicted 0.0000 against an observed ~5.15% (pnpm rp:conservative-branch measures a pooled-season understatedRate of 4.7324%). Deferred out of Phase 9 deliberately — see 09-CONTEXT.md's deferred list.",
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2019: RpRuleModule = {
  season: 2019,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2019Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.habClimbPoints = own.habClimbPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2019 ${side}`);

    const habDocking = own.habClimbPoints >= HAB_DOCKING_THRESHOLD[tier];
    // Recomputed from booleans present at parse time — see file header's
    // asymmetry note. `predictThresholds` below cannot reach these fields.
    const completeRocket = own.completedRocketNear || own.completedRocketFar;

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.habDocking = habDocking;
    bonusFlags.completeRocket = completeRocket;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.habDocking = own.habDockingRankingPoint;
    recordedBonusFlags.completeRocket = own.completeRocketRankingPoint;

    const totalRp = Number(habDocking) + Number(completeRocket);

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
   * `habDocking` is fully computable from `habClimbPoints` alone.
   * `completeRocket` depends ENTIRELY on the two per-alliance rocket
   * booleans (`completedRocketNear`/`completedRocketFar`), which this
   * season tracks no threshold-variable-only fallback for at all — there
   * is no numeric proxy available to `analyticPmf.ts`'s closed form (plan
   * 09-04 — this used to read "the Monte Carlo joint draw", a module this
   * repo no longer has). Always `false` here (declared `constant`, see `BONUS_PREDICATES` above),
   * following 2025's `autoBonus` precedent (see file header and
   * `2025.ts`'s own `predictThresholds` doc comment for the general
   * conservative-branch contract). Delegates to the shared declarative
   * evaluator (D-02, D-07).
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
