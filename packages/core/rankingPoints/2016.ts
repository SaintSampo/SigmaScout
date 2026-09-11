/**
 * 2016 (FIRST STRONGHOLD) RP rule module (D-09, D-12). Both bonuses measured
 * against the full official qual population using `EVENT_TYPE_TIERS` (0/1/100
 * = base, 2/5 = districtChampionship, 3/4 = championship). Note 2016 has
 * **no `event_type` 5** at all; every type it does present is mapped, so
 * `eventTierFor` never throws on this season.
 *
 * | rule | base (n=18,354) | districtChampionship (n=1,804) | championship (n=2,000) |
 * |---|---|---|---|
 * | `breach` | 100.000% 0FP 0FN | 100.000% 0FP 0FN | 100.000% 0FP 0FN |
 * | `capture` | **1 FP** 0FN | 0FP 0FN | 0FP 0FN |
 *
 * Both thresholds are FLAT across tiers as a MEASURED fact, which is why
 * every threshold triple below states the same number three times rather
 * than tiering.
 *
 * **Inert until a publish lands.** `FIRST_SEASON` in
 * `apps/web/src/lib/seasons.ts` is still 2019 and no 2016 artifacts exist in
 * R2, so registering this module makes 2016 computable by the harness and
 * the corpus suites — it does NOT make 2016 visible on the site.
 *
 * ---
 *
 * **BREACH — the rule is FOUR of five, not all five.**
 * `breach` is true when **at least 4** of the five defense positions were
 * crossed **at least twice** each. The intuitive reading — "all FIVE
 * defenses damaged" — is WRONG and fails loudly: it produces **12,248 false
 * negatives**. The four-of-five rule was established by MEASUREMENT against
 * the corpus, not by reading the game manual, and it separates the
 * population PERFECTLY with no overlap band whatsoever: a damaged-defense
 * count of 0/1/2/3 is ALWAYS false (6,651 sides) and a count of 4/5 is
 * ALWAYS true (15,507 sides). Fully numeric, so `predictThresholds`
 * reproduces it exactly.
 *
 * **The 2016 naming trap applies here and this module is where it bites.**
 * `position2`/`position3`/`position4`/`position5` are **STRINGS** (the
 * defense NAMES — "A_ChevalDeFrise", "B_Ramparts", ...) while
 * `position1crossings`..`position5crossings` are the **NUMBERS** this rule
 * reads. There is deliberately no `position1` string: the low bar sits in
 * position 1 every match and is not chosen, so TBA ships a crossings count
 * for it but no name. Reading `position2` where `position2crossings` was
 * meant yields a string, which the `z.number().finite()` schema below
 * rejects LOUDLY rather than coercing to 0.
 *
 * ---
 *
 * **CAPTURE — reads the OPPONENT's tower, exposed as an own-alliance
 * variable.**
 * `capture` is true when the tower this alliance ATTACKED has been reduced
 * to zero strength AND all three of its robots are on that tower:
 *
 *     attackedTowerEndStrength <= 0 AND (teleopChallengePoints / 5 + teleopScalePoints / 15) >= 3
 *
 * **`towerEndStrength` on a side is THAT SIDE'S OWN tower** — the one the
 * OPPONENT spends the match attacking — so this rule must read the
 * **opponent** side's field. `parse` therefore populates an own-alliance
 * threshold variable named **`attackedTowerEndStrength`** from
 * `parsed[opponentSide].towerEndStrength`.
 *
 * **This creates NO asymmetry.** The value is genuinely a measure of THIS
 * alliance's own offensive output — their boulders are what knocked that
 * tower down — it merely happens to be recorded on the other side of TBA's
 * payload. The breakdown modules already set this exact precedent by
 * deriving `foulsCommitted` from the opponent side (D-04). Once populated,
 * `predictThresholds` reads `attackedTowerEndStrength` as an ordinary
 * own-alliance variable and needs no opponent access of its own.
 *
 * **THE THREE REJECTED VARIANTS, recorded by name with their numbers:**
 *  - own-side `towerEndStrength <= 0 && robots >= 3` — **212 FP / 1,304
 *    FN**. This is the WRONG-TOWER error, and it is the one a careless
 *    reading produces. It is recorded here specifically because it looks
 *    right.
 *  - `towerEndStrength <= 0` alone — **1,886 FP / 1,183 FN**.
 *  - `robots >= 3` alone — **4,558 FP / 0 FN**.
 *
 * **The shipped rule's measured residual: ONE false positive in 22,158
 * sides, and ZERO false negatives at every tier.** The single exception is
 * `2016melew_qm24` red — attacked tower at strength -2, all three robots up,
 * and TBA nonetheless records not-captured. Per `event_type`: 0/8,732 (type
 * 0), **1/9,590 = 0.01043% (type 1)**, 0/1,804 (type 2), 0/2,000 (type 3),
 * 0/32 (type 100). `reconciliation.test.ts` carries exactly ONE
 * `KNOWN_TOLERANCES` entry for this — `capture` at `eventTypes: [1]` only —
 * so every other tier stays bound to exactly 0 by the ABSENCE of an entry.
 * **`breach` gets no entry at all.**
 *
 * ---
 *
 * **Unit conversions.** `teleopChallengePoints` is observed in {0, 5, 10,
 * 15} and `teleopScalePoints` in {0, 15, 30, 45}, so dividing by 5 and 15
 * respectively yields an exact robot count of 0..3 in each and their sum is
 * the number of robots on the tower. `towerEndStrength` is observed in
 * -13..12 and is fully integral (0 non-integral sides), so `<= 0` is an
 * exact boundary rather than a float comparison.
 *
 * **Comparison semantics are `>=` throughout EXCEPT the tower half of
 * `capture`, which is `<=`** — the only inverted comparison in this module,
 * and inverted because tower strength COUNTS DOWN as it is attacked. Said
 * explicitly so a reader does not assume the module-wide `>=` convention
 * every other season file states.
 *
 * **The `?? 0` default in `predictThresholds`.** Following the house
 * convention, every variable is read as `values.X ?? 0`. For
 * `attackedTowerEndStrength` that default makes the tower half TRUE (`0 <=
 * 0`), which is worth naming rather than leaving as a silent edge: it is
 * gated by the robot-count conjunct, which needs real data to clear, so an
 * empty `values` object still yields `capture = false`. It is also not
 * reachable on the live path — `rp/distribution.ts` always supplies every
 * tracked threshold variable. The house `?? 0` convention is kept
 * deliberately; a different default is NOT invented here for this one
 * variable.
 *
 * Deliberately never read: the roll-ups `autoPoints`/`teleopPoints`/
 * `totalPoints`, the scored `autoReachPoints`/`autoCrossingPoints`/
 * `autoBoulderPoints`/`teleopCrossingPoints`/`teleopBoulderPoints` and the
 * playoff-only `breachPoints`/`capturePoints` (all of which belong to
 * `breakdown/2016.ts`), `tba_rpEarned`, the raw boulder counts
 * `autoBouldersLow`/`autoBouldersHigh`/`teleopBouldersLow`/
 * `teleopBouldersHigh`, the per-robot `robot1Auto`/`robot2Auto`/`robot3Auto`
 * and `towerFaceA`/`towerFaceB`/`towerFaceC` fields (Pitfall Sigma1-2 /
 * Assumption A1 — positional correspondence to `red_teams`/`blue_teams`
 * array order is unverified), and the `position2`..`position5` defense-name
 * strings. The robot count is recomputed from the two tower POINT fields
 * and their known per-robot values rather than by counting the
 * `towerFace*` strings, so those are genuinely unread rather than an
 * alternative path left dangling. The `teleopDefensesBreached` and
 * `teleopTowerCaptured` booleans ARE read, but only as `recordedBonusFlags`
 * — TBA's own answer, kept alongside the recomputed one so
 * `reconciliation.test.ts` is a comparison rather than a restatement (D-12),
 * never as an input to `bonusFlags`.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/**
 * Only the subset of TBA's `score_breakdown.{side}` object this module
 * reads. Unknown extra fields (`autoPoints`, `teleopPoints`, `totalPoints`,
 * `autoReachPoints`, `autoCrossingPoints`, `autoBoulderPoints`,
 * `teleopCrossingPoints`, `teleopBoulderPoints`, `breachPoints`,
 * `capturePoints`, `adjustPoints`, `foulPoints`, `foulCount`,
 * `techFoulCount`, `autoBouldersLow`/`autoBouldersHigh`/
 * `teleopBouldersLow`/`teleopBouldersHigh`, the `position2`..`position5`
 * defense-NAME strings, `robot1Auto`/`robot2Auto`/`robot3Auto`,
 * `towerFaceA`/`towerFaceB`/`towerFaceC`, `tba_rpEarned`, `rp`, etc.) are
 * ignored, not rejected — zod's default "strip" mode drops them without
 * erroring. Deliberately NOT `.passthrough()`/`.loose()`, matching
 * `breakdown/2016.ts`'s discipline.
 *
 * Note the `*crossings` fields are the NUMBERS; the bare `position{i}` keys
 * are defense-name STRINGS and are deliberately absent from this schema.
 * See "the 2016 naming trap" in the file header.
 */
const SideSchema = z.object({
  position1crossings: z.number().finite(),
  position2crossings: z.number().finite(),
  position3crossings: z.number().finite(),
  position4crossings: z.number().finite(),
  position5crossings: z.number().finite(),
  teleopChallengePoints: z.number().finite(),
  teleopScalePoints: z.number().finite(),
  /**
   * THIS side's OWN tower — the one the OPPONENT attacked. `capture` reads
   * the opposing side's copy of this field; see "CAPTURE" in the file
   * header.
   */
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

/**
 * A defense counts as DAMAGED at 2 crossings. This is part of the
 * definition of "damaged" rather than the bonus's own threshold — the
 * bonus threshold is the COUNT of damaged defenses below — so it is a plain
 * named constant, in the same spirit as 2017's per-rotor point values.
 */
const CROSSINGS_FOR_DAMAGED_DEFENSE = 2;

/**
 * Breach threshold: **FOUR** of the five defenses damaged, not all five.
 * Not tiered — flatness MEASURED (0 FP / 0 FN at every tier), not assumed.
 * The all-five reading produces 12,248 false negatives; see the file header.
 */
const BREACH_DAMAGED_DEFENSE_THRESHOLD: RpTieredThreshold = { base: 4, districtChampionship: 4, championship: 4 };

/**
 * Capture's tower half: the ATTACKED tower must be at or below zero
 * strength. Compared with `<=`, the only inverted comparison in this module
 * — tower strength counts DOWN as the tower is attacked. Not tiered —
 * flatness MEASURED, not assumed.
 */
const CAPTURED_TOWER_END_STRENGTH_THRESHOLD: RpTieredThreshold = { base: 0, districtChampionship: 0, championship: 0 };

/**
 * Capture's robot half: all three robots on the tower. Not tiered —
 * flatness MEASURED, not assumed.
 */
const CAPTURE_ROBOT_COUNT_THRESHOLD: RpTieredThreshold = { base: 3, districtChampionship: 3, championship: 3 };

/**
 * Per-robot point values, used to convert each tower POINT field back into a
 * robot COUNT. These are unit conversions, not thresholds, so they are not
 * `RpTieredThreshold`s. Confirmed by the observed value sets:
 * `teleopChallengePoints` in {0, 5, 10, 15} and `teleopScalePoints` in
 * {0, 15, 30, 45}, so both quotients are whole robot counts in 0..3 and
 * their sum is the number of robots on the tower.
 */
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

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  // Crossing counts per defense position — raw counts, not point values.
  {
    name: "position1crossings",
    unit: "count",
    marginalFamily: "gaussian",
  },
  {
    name: "position2crossings",
    unit: "count",
    marginalFamily: "gaussian",
  },
  {
    name: "position3crossings",
    unit: "count",
    marginalFamily: "gaussian",
  },
  {
    name: "position4crossings",
    unit: "count",
    marginalFamily: "gaussian",
  },
  {
    name: "position5crossings",
    unit: "count",
    marginalFamily: "gaussian",
  },
  // The OPPONENT side's `towerEndStrength`, exposed as an own-alliance
  // variable because it measures THIS alliance's offensive output against
  // the tower it attacked. See "CAPTURE" in the file header.
  {
    name: "attackedTowerEndStrength",
    unit: "count",
    marginalFamily: "gaussian",
  },
  // Point values, not counts — the rule converts them to a robot count with
  // the per-robot divisors above rather than reading a count field, because
  // TBA's 2016 breakdown carries no tower-robot-count field at all.
  {
    name: "teleopChallengePoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
  {
    name: "teleopScalePoints",
    unit: "points",
    marginalFamily: "gaussian",
  },
];

/**
 * D-02, D-07: `breach` is `countOfIndicators` — five indicator clauses
 * (`position{1..5}crossings` each `>= CROSSINGS_FOR_DAMAGED_DEFENSE`, a
 * plain definitional constant, not itself a tiered threshold), `required`
 * the tiered `BREACH_DAMAGED_DEFENSE_THRESHOLD` (4 of 5, not all 5 — see
 * file header). `capture` is `conjunctionDistinct`: the tower half is the
 * project's only `"lte"` clause (`attackedTowerEndStrength <=
 * CAPTURED_TOWER_END_STRENGTH_THRESHOLD`), the robot half is a two-term
 * `RpLinearTerm` divisor combination (`teleopChallengePoints /
 * CHALLENGE_POINTS_PER_ROBOT + teleopScalePoints / SCALE_POINTS_PER_ROBOT
 * >= CAPTURE_ROBOT_COUNT_THRESHOLD`) — both terms summed left to right,
 * matching `towerRobotCount`'s own addition order exactly (float addition
 * is not associative). Neither bonus gates on an untracked signal.
 */
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
    // The tower THIS alliance attacked is the OPPONENT's own tower — the
    // same opponent-sourced derivation `breakdown/2016.ts` uses for
    // `foulsCommitted` (D-04). Exposed under an own-alliance name so
    // `predictThresholds` reads it as an ordinary tracked variable.
    thresholdVariables.attackedTowerEndStrength = opponent.towerEndStrength;
    thresholdVariables.teleopChallengePoints = own.teleopChallengePoints;
    thresholdVariables.teleopScalePoints = own.teleopScalePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2016 ${side}`);

    // Both rules are fully numeric — no boolean input, so
    // `predictThresholds` below reproduces these lines verbatim.
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

  /**
   * Identical to `parse`'s rule logic — both bonuses are fully reachable
   * from the eight tracked threshold variables, so there is no fallback, no
   * conservative branch and no asymmetry here. `attackedTowerEndStrength`
   * is read as an ordinary own-alliance variable; `parse` already resolved
   * the opponent-side lookup when it populated it.
   *
   * Note the `?? 0` default on `attackedTowerEndStrength` satisfies the
   * tower half (`0 <= 0`) — see the file header for why that is safe (the
   * robot-count conjunct still gates it, and `rp/distribution.ts` always
   * supplies every tracked variable on the live path). Delegates to the
   * shared declarative evaluator (D-02, D-07); see `BONUS_PREDICATES`
   * above.
   */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
