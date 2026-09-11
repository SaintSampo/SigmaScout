/**
 * 2017 (FIRST STEAMWORKS) RP rule module (D-09, D-12). Both bonuses measured
 * EXACT at ALL THREE event tiers — MEASURED, not assumed — using
 * `EVENT_TYPE_TIERS` (0/1/100 = base, 2/5 = districtChampionship, 3/4 =
 * championship), full official qual population:
 *
 * | rule | base (n=20,240) | districtChampionship (n=2,446) | championship (n=2,700) |
 * |---|---|---|---|
 * | `kPa = autoFuelPoints + teleopFuelPoints >= 40` | 100.000% 0FP 0FN | 100.000% 0FP 0FN | 100.000% 0FP 0FN |
 * | `rotor = autoRotorPoints / 60 + teleopRotorPoints / 40 >= 4` | 100.000% 0FP 0FN | 100.000% 0FP 0FN | 100.000% 0FP 0FN |
 *
 * Both thresholds are FLAT across tiers as a MEASURED fact, which is why
 * both threshold triples below state the same number three times rather
 * than tiering. **2017 adds NO `KNOWN_TOLERANCES` entry to
 * `reconciliation.test.ts`** — 0 false positives and 0 false negatives at
 * every tier for both bonuses, so the absence of an entry is a measured
 * result, not an oversight, and any mismatch appearing later is a rule
 * error rather than an occasion to add a tolerance.
 *
 * **Inert until a publish lands.** `FIRST_SEASON` in
 * `apps/web/src/lib/seasons.ts` is still 2019 and no 2017 artifacts exist in
 * R2, so registering this module makes 2017 computable by the harness and
 * the corpus suites — it does NOT make 2017 visible on the site.
 *
 * **`predictThresholds` is IDENTICAL to `parse`'s rule logic.** No boolean
 * input, no numeric fallback, no conservative branch, no asymmetry of any
 * kind — the two code paths evaluate the same two inequalities over the same
 * four variables. **2017 is the first season in this project where both
 * bonuses are simultaneously EXACT and FULLY REACHABLE from
 * `predictThresholds`**: 2018 is exact but needs a numeric fallback for
 * `autoQuest`'s `autoSwitchAtZero` boolean half (the Monte Carlo joint draw
 * in `rp/distribution.ts` samples threshold variables, never a raw
 * breakdown), and 2019 needs the hard-coded-false conservative branch for
 * `completeRocket`. Neither compromise is needed here, and none is
 * introduced for symmetry's sake.
 *
 * **THE REJECTED RULE, recorded by name with its numbers.**
 * `autoRotorPoints + teleopRotorPoints >= 160` is the obvious rotor rule and
 * it is **WRONG**: it produces **14 false positives** (8 base / 2
 * districtChampionship / 4 championship), every single one at
 * `autoRotorPoints = 120, teleopRotorPoints = 40`. That side ran TWO auto
 * rotors at 60 points each plus ONE teleop rotor at 40 — 160 points, but
 * only **THREE** rotors, not four. An auto rotor and a teleop rotor are
 * worth different amounts, so a point SUM cannot recover a rotor COUNT;
 * dividing each half by its OWN per-rotor value first is exactly what makes
 * the shipped rule exact. Observed values confirm the divisors:
 * `autoRotorPoints` takes only {0, 60, 120} and `teleopRotorPoints` only
 * {0, 40, 80, 120, 160}, so both quotients are whole rotor counts and their
 * sum is a rotor count in 0..4.
 *
 * Fuel is the opposite case and needs no such care: `kPa` is scored by
 * POINTS, both halves are in the same unit, and the summed fuel points are
 * integral across the population (**0 non-integral in 25,386 sides**), so
 * the plain sum is the right quantity and `>= 40` is an exact boundary.
 *
 * Deliberately never read: the three total-shaped roll-up fields
 * (`autoPoints`, `teleopPoints`, `totalPoints`), `tba_rpEarned`, the
 * per-robot string fields `robot1Auto`/`robot2Auto`/`robot3Auto` and
 * `touchpadFar`/`touchpadMiddle`/`touchpadNear` (Pitfall Sigma1-2 /
 * Assumption A1 — positional correspondence to `red_teams`/`blue_teams`
 * array order is unverified), the `rotor1Auto`/`rotor2Auto` booleans, and
 * the `rotor1Engaged`..`rotor4Engaged` booleans. The rotor rule is computed
 * from the two rotor POINT fields and their known per-rotor values rather
 * than by counting those engaged booleans, so the booleans are genuinely
 * unread rather than an alternative path left dangling. The two
 * `*RankingPointAchieved` booleans ARE read, but only as
 * `recordedBonusFlags` — TBA's own answer, kept alongside the recomputed
 * one so `reconciliation.test.ts` is a comparison rather than a restatement
 * (D-12), never as an input to `bonusFlags`.
 *
 * Threshold comparison semantics are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `autoMobilityPoints`, `teleopTakeoffPoints`, `kPaBonusPoints`,
 * `rotorBonusPoints`, `autoFuelHigh`/`autoFuelLow`/`teleopFuelHigh`/
 * `teleopFuelLow`, `robot1Auto`/`robot2Auto`/`robot3Auto`,
 * `touchpadFar`/`touchpadMiddle`/`touchpadNear`, `rotor1Auto`/`rotor2Auto`,
 * `rotor1Engaged`..`rotor4Engaged`, `tba_rpEarned`, `rp`, etc.) are ignored,
 * not rejected — zod's default "strip" mode drops them without erroring.
 * Deliberately NOT `.passthrough()`/`.loose()`, matching
 * `breakdown/2017.ts`'s discipline.
 */
const SideSchema = z.object({
  autoFuelPoints: z.number().finite(),
  teleopFuelPoints: z.number().finite(),
  autoRotorPoints: z.number().finite(),
  teleopRotorPoints: z.number().finite(),
  kPaRankingPointAchieved: z.boolean(),
  rotorRankingPointAchieved: z.boolean(),
});

const Rp2017Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/**
 * kPa threshold: `autoFuelPoints + teleopFuelPoints >= 40`. Not tiered —
 * flatness MEASURED (0 FP / 0 FN at every tier), not assumed.
 */
const KPA_FUEL_POINTS_THRESHOLD: RpTieredThreshold = { base: 40, districtChampionship: 40, championship: 40 };

/**
 * Rotor threshold: four rotors. Not tiered — flatness MEASURED (0 FP / 0 FN
 * at every tier), not assumed.
 */
const ROTOR_COUNT_THRESHOLD: RpTieredThreshold = { base: 4, districtChampionship: 4, championship: 4 };

/**
 * Per-rotor point values, used to convert each rotor POINT field back into a
 * rotor COUNT. These are unit conversions, not thresholds, so they are not
 * `RpTieredThreshold`s. Confirmed by the observed value sets:
 * `autoRotorPoints` in {0, 60, 120} and `teleopRotorPoints` in
 * {0, 40, 80, 120, 160}. Dividing each half by its own value — rather than
 * summing the points — is what makes the rule exact; see "THE REJECTED
 * RULE" in the file header.
 */
const AUTO_ROTOR_POINTS_PER_ROTOR = 60;
const TELEOP_ROTOR_POINTS_PER_ROTOR = 40;

/** The recomputed rotor COUNT (0..4) from the two rotor point fields. */
function rotorCount(autoRotorPoints: number, teleopRotorPoints: number): number {
  return autoRotorPoints / AUTO_ROTOR_POINTS_PER_ROTOR + teleopRotorPoints / TELEOP_ROTOR_POINTS_PER_ROTOR;
}

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "autoFuelPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
  {
    name: "teleopFuelPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
  // Point values, not counts — the rule converts them to a rotor count with
  // the per-rotor divisors above rather than reading a count field, because
  // TBA's 2017 breakdown carries no rotor-count field at all.
  {
    name: "autoRotorPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
  {
    name: "teleopRotorPoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
];

/**
 * D-02, D-07: both bonuses are `linearCombination` — `kPa` sums
 * `autoFuelPoints`/`teleopFuelPoints` with no divisor (both already in the
 * same point unit); `rotor` sums `autoRotorPoints`/`teleopRotorPoints`
 * divided by their own per-rotor point values (`RpLinearTerm.divisor`,
 * never a multiplier — see "THE REJECTED RULE" in the file header for why
 * a plain point sum is wrong here). Neither bonus gates on an untracked
 * signal — 2017 is exact and fully reachable for both, per the file
 * header.
 */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "linearCombination",
    name: "kPa",
    terms: [{ variable: "autoFuelPoints" }, { variable: "teleopFuelPoints" }],
    direction: "gte",
    threshold: KPA_FUEL_POINTS_THRESHOLD,
  },
  {
    kind: "linearCombination",
    name: "rotor",
    terms: [
      { variable: "autoRotorPoints", divisor: AUTO_ROTOR_POINTS_PER_ROTOR },
      { variable: "teleopRotorPoints", divisor: TELEOP_ROTOR_POINTS_PER_ROTOR },
    ],
    direction: "gte",
    threshold: ROTOR_COUNT_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2017: RpRuleModule = {
  season: 2017,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2017Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.autoFuelPoints = own.autoFuelPoints;
    thresholdVariables.teleopFuelPoints = own.teleopFuelPoints;
    thresholdVariables.autoRotorPoints = own.autoRotorPoints;
    thresholdVariables.teleopRotorPoints = own.teleopRotorPoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2017 ${side}`);

    // Both rules are exact and fully numeric — no boolean input, so
    // `predictThresholds` below reproduces these two lines verbatim.
    const kPa = own.autoFuelPoints + own.teleopFuelPoints >= KPA_FUEL_POINTS_THRESHOLD[tier];
    const rotor = rotorCount(own.autoRotorPoints, own.teleopRotorPoints) >= ROTOR_COUNT_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.kPa = kPa;
    bonusFlags.rotor = rotor;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.kPa = own.kPaRankingPointAchieved;
    recordedBonusFlags.rotor = own.rotorRankingPointAchieved;

    const totalRp = Number(kPa) + Number(rotor);

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
   * Identical to `parse`'s rule logic — both bonuses are exact AND fully
   * reachable from the four tracked threshold variables, so there is no
   * fallback, no conservative branch and no asymmetry here. See the file
   * header: 2017 is the first season in this project for which that is true
   * of every one of its bonuses. Delegates to the shared declarative
   * evaluator (D-02, D-07); see `BONUS_PREDICATES` above.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
