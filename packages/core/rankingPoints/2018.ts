/**
 * 2018 (FIRST POWER UP) RP rule module (D-09, D-12). Both bonuses measured
 * EXACT at ALL THREE event tiers — MEASURED, not assumed — using
 * `EVENT_TYPE_TIERS` (0/1/100 = base, 2/5 = districtChampionship, 3/4 =
 * championship), full official qual population:
 *
 * | rule | base (n=23,042) | districtChampionship (n=2,558) | championship (n=2,712) |
 * |---|---|---|---|
 * | `autoQuest = autoRunPoints >= 15 && autoSwitchAtZero` | 100.000% 0FP 0FN | 100.000% 0FP 0FN | 100.000% 0FP 0FN |
 * | `faceTheBoss = endgamePoints >= 90` | 100.000% 0FP 0FN | 100.000% 0FP 0FN | 100.000% 0FP 0FN |
 *
 * Both thresholds are FLAT across tiers as a MEASURED fact, which is why
 * both threshold triples below are uniform rather than tiered. **2018 is
 * the cleanest RP season in the project — it adds NO `KNOWN_TOLERANCES`
 * entry to `reconciliation.test.ts`.**
 *
 * **The `parse` / `predictThresholds` asymmetry (D-4).** `faceTheBoss` is
 * fully numeric and identical in both. `autoQuest`'s exact rule needs
 * `autoSwitchAtZero`, a BOOLEAN the Monte Carlo joint draw in
 * `rp/distribution.ts` cannot reach — that draw samples threshold
 * variables, never a raw breakdown.
 *
 * **The honest direction of the fallback's error, and why it is still
 * right.** Unlike 2019's `completeRocket` — which has no numeric fallback
 * at all and takes the hard-coded-false conservative branch (see 2019.ts
 * and `RpRuleModule.predictThresholds`'s own doc comment, which names that
 * conservative-branch convention) — 2018 has a good numeric fallback:
 * `autoRunPoints >= 15 && autoSwitchOwnershipSec >= 1`. Measured agreement:
 * **99.813% / 99.648% / 99.594%** at base/districtChampionship/championship,
 * with **0 FALSE NEGATIVES AT EVERY TIER** (43 / 9 / 11 false positives).
 * That means it very slightly OVER-fires — the OPPOSITE direction from the
 * conservative-branch convention `constants.ts`'s `predictThresholds` doc
 * comment describes for a bonus with no exact numeric fallback. This is a
 * deliberate departure, stated plainly rather than left to look like an
 * oversight: the conservative branch would understate a bonus whose BASE
 * achievement rate is ~62% entirely (always predicting it `false`), against
 * a measured over-fire of roughly 0.19% of sides at base tier (43/23,042).
 * Overstating a ~62%-base-rate bonus by ~0.19% of sides is a far smaller
 * error than understating it by its entire ~62% base rate, so the fallback
 * — not the conservative branch — is the right trade here.
 *
 * **`autoSwitchOwnershipSec` is integral** across the full official qual
 * population (0/28,312 non-integral values, measured directly against the
 * corpus, 2026-09-07), so the fallback floor uses `>= 1` — the house `>=`
 * convention — rather than the `> 0` form. For an integer-valued field the
 * two are equivalent; this preserves the codebase's uniform `>=` semantics
 * rather than introducing a one-off `>` operator.
 *
 * **The superseded figure.** The 96.429% / 116-false-negative `autoQuest`
 * number recorded in
 * `.planning/todos/pending/extend-corpus-2018-2017-2016.md` is SUPERSEDED
 * and must not be carried forward: it came from an 18-event sample that
 * included `2018cc` (Chezy Champs), an OFFSEASON event. Offseason
 * disagreement for the same exact rule is **11.19% (370/3,308)** against
 * **0.000%** on official data — a clean demonstration of why every RP
 * measurement in this project excludes the offseason population.
 *
 * Deliberately never read: the three total-shaped roll-up fields
 * (`autoPoints`, `teleopPoints`, `totalPoints`), the numeric `rp` roll-up,
 * the auto and endgame per-robot string fields `autoRobot1/2/3`/
 * `endgameRobot1/2/3` (Pitfall Sigma1-2 / Assumption A1), the
 * `tba_gameData` field-randomization string, and the vault detail fields
 * (`vault*Played`/`vault*Total`).
 *
 * Threshold comparison semantics are `>=` throughout.
 */
import { z } from "zod";
import type { RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `autoOwnershipPoints`, `teleopOwnershipPoints`, `rp`, `autoRobot1/2/3`,
 * `endgameRobot1/2/3`, `tba_gameData`, `vault*Played`/`vault*Total`, etc.)
 * are ignored, not rejected — zod's default "strip" mode drops them without
 * erroring. Deliberately NOT `.passthrough()`/`.loose()`, matching
 * `breakdown/2018.ts`'s discipline.
 */
const SideSchema = z.object({
  autoRunPoints: z.number().finite(),
  autoSwitchOwnershipSec: z.number().finite(),
  endgamePoints: z.number().finite(),
  autoSwitchAtZero: z.boolean(),
  autoQuestRankingPoint: z.boolean(),
  faceTheBossRankingPoint: z.boolean(),
});

const Rp2018Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Auto Quest's auto-run-points half: `autoRunPoints >= 15`. Not tiered — flatness MEASURED (0 mismatches at every tier). */
const AUTO_RUN_THRESHOLD: RpTieredThreshold = { base: 15, districtChampionship: 15, championship: 15 };

/** Face The Boss threshold: `endgamePoints >= 90`. Not tiered — flatness MEASURED (0 mismatches at every tier). */
const FACE_THE_BOSS_THRESHOLD: RpTieredThreshold = { base: 90, districtChampionship: 90, championship: 90 };

/**
 * The `predictThresholds`-only numeric fallback floor for Auto Quest's
 * boolean half (D-4): `autoSwitchOwnershipSec >= 1`, uniform across tiers.
 * `parse` never uses this — it reads the exact `autoSwitchAtZero` boolean.
 */
const AUTO_SWITCH_SECONDS_FALLBACK_FLOOR: RpTieredThreshold = { base: 1, districtChampionship: 1, championship: 1 };

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "autoRunPoints", unit: "points" },
  // The enum carries no time unit; `count` is correct here because the
  // discipline this field exists for is "never read a points roll-up where
  // a raw quantity is wanted" (constants.ts's own file header) — ownership
  // seconds are the raw quantity, not a derived point value.
  { name: "autoSwitchOwnershipSec", unit: "count" },
  { name: "endgamePoints", unit: "points" },
];

const BONUS_NAMES = ["autoQuest", "faceTheBoss"] as const;

export const rp2018: RpRuleModule = {
  season: 2018,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2018Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.autoRunPoints = own.autoRunPoints;
    thresholdVariables.autoSwitchOwnershipSec = own.autoSwitchOwnershipSec;
    thresholdVariables.endgamePoints = own.endgamePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2018 ${side}`);

    // Exact rule (D-3): auto-run points at or above threshold AND the
    // recorded auto-switch-at-zero boolean. `predictThresholds` below
    // cannot reach this boolean.
    const autoQuest = own.autoRunPoints >= AUTO_RUN_THRESHOLD[tier] && own.autoSwitchAtZero;
    const faceTheBoss = own.endgamePoints >= FACE_THE_BOSS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.autoQuest = autoQuest;
    bonusFlags.faceTheBoss = faceTheBoss;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.autoQuest = own.autoQuestRankingPoint;
    recordedBonusFlags.faceTheBoss = own.faceTheBossRankingPoint;

    const totalRp = Number(autoQuest) + Number(faceTheBoss);

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
   * `faceTheBoss` is fully numeric and identical to `parse`.
   * `autoQuest` uses the measured numeric fallback (D-4, see file header):
   * auto-run points at or above threshold AND auto-switch seconds at or
   * above the fallback floor — 0 false negatives at every tier, a small,
   * honestly-stated over-fire, the opposite direction from this codebase's
   * usual conservative-branch convention and a deliberate departure from
   * it, justified in the file header.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    const tier = eventTierFor(eventType);
    const autoRunPoints = values.autoRunPoints ?? 0;
    const autoSwitchOwnershipSec = values.autoSwitchOwnershipSec ?? 0;
    const endgamePoints = values.endgamePoints ?? 0;

    const autoQuest = autoRunPoints >= AUTO_RUN_THRESHOLD[tier] && autoSwitchOwnershipSec >= AUTO_SWITCH_SECONDS_FALLBACK_FLOOR[tier];
    const faceTheBoss = endgamePoints >= FACE_THE_BOSS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.autoQuest = autoQuest;
    bonusFlags.faceTheBoss = faceTheBoss;

    return { bonusFlags, totalRp: Number(autoQuest) + Number(faceTheBoss) };
  },
};
