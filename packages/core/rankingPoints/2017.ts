/**
 * 2017 (FIRST STEAMWORKS) RP rule module. Both bonuses are exact and flat
 * across event tiers (measured 0 FP/FN at every tier, full official qual
 * population), so `reconciliation.test.ts` adds no tolerance entry for 2017
 * and a later mismatch is a rule error, not an occasion to add one.
 * `predictThresholds` is identical to `parse`'s rule logic — no boolean
 * input, no fallback, no conservative branch needed for either bonus.
 *
 * The obvious rotor rule, `autoRotorPoints + teleopRotorPoints >= 160`, is
 * wrong: an auto rotor and a teleop rotor are worth different point values,
 * so a point sum cannot recover a rotor count. Dividing each half by its
 * own per-rotor value first (60 auto, 40 teleop) is what makes the rule
 * exact. Fuel needs no such care — both halves share a unit and the summed
 * points are integral, so `>= 40` on the plain sum is correct.
 *
 * Deliberately never read: the roll-up totals, `tba_rpEarned`, per-robot and
 * touchpad string fields (positional correspondence to the teams array is
 * unverified), and the rotor-engaged booleans (the rule uses the point
 * fields and known per-rotor values instead). The two
 * `*RankingPointAchieved` booleans are read only as `recordedBonusFlags`,
 * TBA's own answer kept for comparison, never as an input to `bonusFlags`.
 *
 * Threshold comparisons are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields are ignored, not rejected — zod's default
 * "strip" mode drops them without erroring. Deliberately not `.passthrough()`.
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
 * Per-rotor point values, used to convert each rotor point field back into a
 * rotor count. Not thresholds. Confirmed by the observed value sets:
 * `autoRotorPoints` in {0, 60, 120}, `teleopRotorPoints` in
 * {0, 40, 80, 120, 160}. Dividing each half by its own value, rather than
 * summing the points, is what makes the rule exact — see the file header.
 */
const AUTO_ROTOR_POINTS_PER_ROTOR = 60;
const TELEOP_ROTOR_POINTS_PER_ROTOR = 40;

/** The recomputed rotor COUNT (0..4) from the two rotor point fields. */
function rotorCount(autoRotorPoints: number, teleopRotorPoints: number): number {
  return autoRotorPoints / AUTO_ROTOR_POINTS_PER_ROTOR + teleopRotorPoints / TELEOP_ROTOR_POINTS_PER_ROTOR;
}

// 2026-09-14, quick task 260914-01x: every variable below declares "lattice",
// shipped by the committed bonus-arm bar (data/baselines/rp-bonus-arms-2026-09.json,
// ship: lattice+meanShift). Any other family named above is history.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "autoFuelPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: no fuel cap.
    lattice: { step: 1, min: 0 },
  },
  {
    name: "teleopFuelPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: no fuel cap.
    lattice: { step: 1, min: 0 },
  },
  // Point values, not counts — converted to a rotor count with the
  // per-rotor divisors above; TBA's 2017 breakdown has no count field.
  {
    name: "autoRotorPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: 60 per rotor turning at end of AUTO; AUTO gears (three preloads plus the reserve) finish rotors 1 and 2 only.
    lattice: { step: 60, min: 0, max: 120 },
  },
  {
    name: "teleopRotorPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: 40 per rotor, 4 rotors, counted apart from AUTO rotors.
    lattice: { step: 40, min: 0, max: 160 },
  },
];

/**
 * Both bonuses are `linearCombination`: `kPa` sums the two fuel fields with
 * no divisor (same point unit); `rotor` sums the two rotor fields divided by
 * their own per-rotor point values (`RpLinearTerm.divisor`) — see the file
 * header for why a plain point sum is wrong for rotor.
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
   * Identical to `parse`'s rule logic — both bonuses are exact and fully
   * reachable from the four tracked threshold variables, so no fallback or
   * conservative branch is needed. Delegates to the shared declarative
   * evaluator; see `BONUS_PREDICATES` above.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
