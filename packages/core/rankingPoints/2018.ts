/**
 * 2018 (FIRST POWER UP) RP rule module. Both bonuses are exact and flat across event
 * tiers (0 mismatches at every tier, full official qual population); 2018 has no
 * `KNOWN_TOLERANCES` entry.
 *
 * `faceTheBoss` is fully numeric and identical in `parse` and `predictThresholds`.
 * `autoQuest`'s exact rule needs the `autoSwitchAtZero` boolean, which the
 * prediction path cannot reach, so `predictThresholds` falls back to
 * `autoSwitchOwnershipSec >= 1`. That fallback slightly OVER-fires (0 false
 * negatives, ~0.19% false positives at base tier), a deliberate departure from the
 * conservative convention: understating a bonus with a ~62% base rate is a far
 * larger error. The seconds are integral, so the floor is `>= 1`.
 *
 * Offseason events are excluded: 2018's offseason `autoQuest` disagreement is
 * 11.19% against 0.000% on official data.
 *
 * Deliberately never read: the roll-up totals, the numeric `rp` roll-up, the
 * per-robot string fields (positional correspondence is unverified), the
 * `tba_gameData` randomization string, and the vault detail fields.
 *
 * Threshold comparisons are `>=` throughout.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/** Only the fields this module reads; zod's default strip mode drops the rest (deliberately not `.passthrough()`). */
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

/** Auto Quest's auto-run-points half: `autoRunPoints >= 15`. Not tiered — flatness measured. */
const AUTO_RUN_THRESHOLD: RpTieredThreshold = { base: 15, districtChampionship: 15, championship: 15 };

/** Face The Boss threshold: `endgamePoints >= 90`. Not tiered — flatness measured. */
const FACE_THE_BOSS_THRESHOLD: RpTieredThreshold = { base: 90, districtChampionship: 90, championship: 90 };

/** `predictThresholds`-only fallback floor for Auto Quest's boolean half; `parse` reads the exact `autoSwitchAtZero` boolean instead. */
const AUTO_SWITCH_SECONDS_FALLBACK_FLOOR: RpTieredThreshold = { base: 1, districtChampionship: 1, championship: 1 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "autoRunPoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: AUTO-RUN 5 per robot, 3 robots.
    lattice: { step: 5, min: 0, max: 15 },
  },
  // `count`, not `points`: ownership seconds are a raw quantity.
  {
    name: "autoSwitchOwnershipSec",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: AUTO lasts 15 s, recorded in whole seconds.
    lattice: { step: 1, min: 0, max: 15 },
  },
  {
    name: "endgamePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: PARK 5, CLIMB 30 per robot (LEVITATE credits one climb), 3 robots.
    lattice: { step: 5, min: 0, max: 90 },
  },
];

/** `autoQuest` declares the numeric fallback clauses with an `"overstates"` gate (see file header). */
const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "conjunctionDistinct",
    name: "autoQuest",
    clauses: [
      { terms: [{ variable: "autoRunPoints" }], direction: "gte", threshold: AUTO_RUN_THRESHOLD },
      { terms: [{ variable: "autoSwitchOwnershipSec" }], direction: "gte", threshold: AUTO_SWITCH_SECONDS_FALLBACK_FLOOR },
    ],
    untrackedGate: {
      signal: "autoSwitchAtZero",
      branch: "numeric-proxy",
      errorDirection: "overstates",
      note:
        "The numeric fallback (autoRunPoints >= 15 && autoSwitchOwnershipSec >= 1) over-fires relative to the exact autoSwitchAtZero boolean parse() reads: 99.813%/99.648%/99.594% agreement at base/districtChampionship/championship, 0 false negatives at every tier, 43/9/11 false positives — the one deliberate departure in this codebase from the usual conservative-branch convention (see file header). pnpm rp:conservative-branch measures this as a pooled-season overstatedRate of 0.2225%, the only nonzero overstatedRate anywhere in the RP layer.",
    },
  },
  {
    kind: "singleThreshold",
    name: "faceTheBoss",
    variable: "endgamePoints",
    direction: "gte",
    threshold: FACE_THE_BOSS_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2018: RpRuleModule = {
  season: 2018,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
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

    // Exact rule: auto-run points at or above threshold AND the recorded
    // auto-switch-at-zero boolean. `predictThresholds` cannot reach this boolean.
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

  /** `autoQuest` uses the measured numeric fallback (see file header); `faceTheBoss` is identical to `parse`. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
