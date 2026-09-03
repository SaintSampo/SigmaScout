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
 *   threshold-variable values, because the Monte Carlo joint draw in
 *   `rp/distribution.ts` samples threshold variables, never a full
 *   breakdown. So this bonus takes the CONSERVATIVE BRANCH and is always
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
import type { RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

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

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [{ name: "habClimbPoints", unit: "points" }];

/**
 * Complete Rocket carries no threshold variable (see file header's
 * asymmetry note): it is recomputed in `parse` from two booleans, not a
 * numeric threshold, so it has nothing to add to `THRESHOLD_VARIABLES`
 * above. `maxRp` still derives to `2 + 2 = 4` because `bonusNames.length`
 * counts it regardless of whether it tracks a threshold variable.
 */
const BONUS_NAMES = ["habDocking", "completeRocket"] as const;

export const rp2019: RpRuleModule = {
  season: 2019,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
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
   * is no numeric proxy available to the Monte Carlo joint draw. Always
   * `false` here, following 2025's `autoBonus` precedent (see file
   * header and `2025.ts`'s own `predictThresholds` doc comment for the
   * general conservative-branch contract).
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    const tier = eventTierFor(eventType);
    const habClimbPoints = values.habClimbPoints ?? 0;

    const habDocking = habClimbPoints >= HAB_DOCKING_THRESHOLD[tier];
    const completeRocket = false;

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.habDocking = habDocking;
    bonusFlags.completeRocket = completeRocket;

    return { bonusFlags, totalRp: Number(habDocking) + Number(completeRocket) };
  },
};
