/**
 * 2016 (FIRST STRONGHOLD) RP rule module, measured against the full official qual
 * population. 2016 has no `event_type` 5; every type it presents is mapped, so
 * `eventTierFor` never throws here. Both thresholds are flat across tiers as a
 * measured fact.
 *
 * **BREACH is FOUR of five, not all five.** `breach` is true when at least 4 of the
 * five defense positions were crossed at least twice each. The "all five" reading
 * produces 12,248 false negatives; four-of-five separates the corpus perfectly.
 *
 * **The 2016 naming trap.** `position2`..`position5` are defense-name STRINGS;
 * `position1crossings`..`position5crossings` are the NUMBERS this rule reads (there
 * is no `position1` string: the low bar is fixed in position 1). Reading the string
 * by mistake is rejected loudly by the `z.number().finite()` schema.
 *
 * **CAPTURE reads the OPPONENT's tower.** `capture` is true when the tower this
 * alliance attacked is at zero strength AND all three of its robots are on it:
 *
 *     attackedTowerEndStrength <= 0 AND (teleopChallengePoints / 5 + teleopScalePoints / 15) >= 3
 *
 * `towerEndStrength` on a side is that side's OWN tower, so `parse` fills the
 * own-alliance variable `attackedTowerEndStrength` from the opponent side. The
 * own-side reading produces hundreds of false positives and thousands of false
 * negatives. Residual: one false positive in 22,158 sides (`2016melew_qm24` red),
 * tolerated by a single `KNOWN_TOLERANCES` entry at `eventTypes: [1]`.
 *
 * **Unit conversions.** `teleopChallengePoints` is observed in {0, 5, 10, 15} and
 * `teleopScalePoints` in {0, 15, 30, 45}, so dividing by 5 and 15 yields exact robot
 * counts; `towerEndStrength` is integral, so `<= 0` is an exact boundary. The tower
 * half of `capture` is the only `<=` comparison, because strength counts down.
 *
 * In `predictThresholds`, a missing `attackedTowerEndStrength` defaults to 0 and
 * makes the tower half true, but the robot-count conjunct still yields
 * `capture = false` for empty `values`.
 *
 * Deliberately never read: the roll-ups and point fields (`breakdown/2016.ts` owns
 * those), `tba_rpEarned`, the boulder counts, the per-robot `robot*Auto` and
 * `towerFace*` fields (positional correspondence to team order is unverified), and
 * the defense-name strings. `teleopDefensesBreached`/`teleopTowerCaptured` are read
 * only as `recordedBonusFlags`, never as inputs.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/** Only the fields this module reads; zod's default strip mode drops the rest (deliberately not `.passthrough()`/`.loose()`). */
const SideSchema = z.object({
  position1crossings: z.number().finite(),
  position2crossings: z.number().finite(),
  position3crossings: z.number().finite(),
  position4crossings: z.number().finite(),
  position5crossings: z.number().finite(),
  teleopChallengePoints: z.number().finite(),
  teleopScalePoints: z.number().finite(),
  /** THIS side's own tower, the one the opponent attacked; `capture` reads the opposing side's copy. */
  towerEndStrength: z.number().finite(),
  teleopDefensesBreached: z.boolean(),
  teleopTowerCaptured: z.boolean(),
});

const Rp2016Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Every defense position TBA reports a crossings count for. Position 1 is the fixed low bar. */
const DEFENSE_POSITIONS = [1, 2, 3, 4, 5] as const;

/** Part of the definition of "damaged", not the bonus threshold (which counts damaged defenses), so a plain constant. */
const CROSSINGS_FOR_DAMAGED_DEFENSE = 2;

/** Breach threshold: FOUR of the five defenses damaged, not all five. */
const BREACH_DAMAGED_DEFENSE_THRESHOLD: RpTieredThreshold = { base: 4, districtChampionship: 4, championship: 4 };

/** Capture's tower half: attacked tower at or below zero strength, compared with `<=`. */
const CAPTURED_TOWER_END_STRENGTH_THRESHOLD: RpTieredThreshold = { base: 0, districtChampionship: 0, championship: 0 };

/** Capture's robot half: all three robots on the tower. */
const CAPTURE_ROBOT_COUNT_THRESHOLD: RpTieredThreshold = { base: 3, districtChampionship: 3, championship: 3 };

/** Per-robot point values that convert each tower POINT field back into a whole robot count (unit conversions, not thresholds). */
const CHALLENGE_POINTS_PER_ROBOT = 5;
const SCALE_POINTS_PER_ROBOT = 15;

/** The recomputed count (0..5) of defenses crossed at least twice. */
function damagedDefenseCount(crossings: readonly number[]): number {
  return crossings.filter((c) => c >= CROSSINGS_FOR_DAMAGED_DEFENSE).length;
}

/** The recomputed count (0..3) of this alliance's robots on the attacked tower. */
function towerRobotCount(teleopChallengePoints: number, teleopScalePoints: number): number {
  return teleopChallengePoints / CHALLENGE_POINTS_PER_ROBOT + teleopScalePoints / SCALE_POINTS_PER_ROBOT;
}

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  // Crossing counts per defense position — raw counts, not point values.
  {
    name: "position1crossings",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: a DEFENSE is damaged at 2 crossings and further crossings do not count.
    lattice: { step: 1, min: 0, max: 2 },
  },
  {
    name: "position2crossings",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: a DEFENSE is damaged at 2 crossings and further crossings do not count.
    lattice: { step: 1, min: 0, max: 2 },
  },
  {
    name: "position3crossings",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: a DEFENSE is damaged at 2 crossings and further crossings do not count.
    lattice: { step: 1, min: 0, max: 2 },
  },
  {
    name: "position4crossings",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: a DEFENSE is damaged at 2 crossings and further crossings do not count.
    lattice: { step: 1, min: 0, max: 2 },
  },
  {
    name: "position5crossings",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: a DEFENSE is damaged at 2 crossings and further crossings do not count.
    lattice: { step: 1, min: 0, max: 2 },
  },
  // The opponent side's `towerEndStrength`, exposed as an own-alliance variable (see "CAPTURE" in the file header).
  {
    name: "attackedTowerEndStrength",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: strength counts down one per boulder with no floor, and its start is tier-dependent, so no bound is declared.
    lattice: { step: 1 },
  },
  // Point values, converted to a robot count by the per-robot divisors: TBA's 2016 breakdown has no tower-robot-count field.
  {
    name: "teleopChallengePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: CHALLENGE 5 per robot, 3 robots.
    lattice: { step: 5, min: 0, max: 15 },
  },
  {
    name: "teleopScalePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: SCALE 15 per robot, 3 robots.
    lattice: { step: 15, min: 0, max: 45 },
  },
];

/** `capture`'s robot-half terms sum in the same order as `towerRobotCount` (float addition is not associative). */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "countOfIndicators",
    name: "breach",
    indicators: DEFENSE_POSITIONS.map((i) => ({
      terms: [{ variable: `position${i}crossings` }],
      direction: "gte" as const,
      threshold: CROSSINGS_FOR_DAMAGED_DEFENSE,
    })),
    required: BREACH_DAMAGED_DEFENSE_THRESHOLD,
  },
  {
    kind: "conjunctionDistinct",
    name: "capture",
    clauses: [
      { terms: [{ variable: "attackedTowerEndStrength" }], direction: "lte", threshold: CAPTURED_TOWER_END_STRENGTH_THRESHOLD },
      {
        terms: [
          { variable: "teleopChallengePoints", divisor: CHALLENGE_POINTS_PER_ROBOT },
          { variable: "teleopScalePoints", divisor: SCALE_POINTS_PER_ROBOT },
        ],
        direction: "gte",
        threshold: CAPTURE_ROBOT_COUNT_THRESHOLD,
      },
    ],
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2016: RpRuleModule = {
  season: 2016,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2016Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const opponent = side === "red" ? parsed.blue : parsed.red;
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.position1crossings = own.position1crossings;
    thresholdVariables.position2crossings = own.position2crossings;
    thresholdVariables.position3crossings = own.position3crossings;
    thresholdVariables.position4crossings = own.position4crossings;
    thresholdVariables.position5crossings = own.position5crossings;
    // The tower this alliance attacked is the opponent's own tower.
    thresholdVariables.attackedTowerEndStrength = opponent.towerEndStrength;
    thresholdVariables.teleopChallengePoints = own.teleopChallengePoints;
    thresholdVariables.teleopScalePoints = own.teleopScalePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2016 ${side}`);

    const crossings = DEFENSE_POSITIONS.map((i) => thresholdVariables[`position${i}crossings`]!);
    const breach = damagedDefenseCount(crossings) >= BREACH_DAMAGED_DEFENSE_THRESHOLD[tier];
    const capture =
      opponent.towerEndStrength <= CAPTURED_TOWER_END_STRENGTH_THRESHOLD[tier] &&
      towerRobotCount(own.teleopChallengePoints, own.teleopScalePoints) >= CAPTURE_ROBOT_COUNT_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.breach = breach;
    bonusFlags.capture = capture;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.breach = own.teleopDefensesBreached;
    recordedBonusFlags.capture = own.teleopTowerCaptured;

    const totalRp = Number(breach) + Number(capture);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },

  /** Both bonuses are fully reachable from the tracked threshold variables: no fallback or conservative branch. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
