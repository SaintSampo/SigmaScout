/**
 * 2022 (Rapid React) RP rule module. Source: 2022 FRC Game Manual §6.4.1, Table 6-1.
 * Verified by corpus reconciliation (`reconciliation.test.ts`) against TBA's
 * recorded `cargoBonusRankingPoint`/`hangarBonusRankingPoint` flags, for every
 * played, non-offseason `qm` match with a breakdown.
 *
 * Deliberately never read: `autoPoints`/`teleopPoints` (roll-ups),
 * `autoCargoLower*`/`autoCargoUpper*`/`teleopCargo*` (per-goal detail), and the
 * per-robot `endgameRobot1/2/3`/`taxiRobot1/2/3` fields.
 *
 * Thresholds compare with `>=` (the manual states every bonus as "at least N").
 *
 * Known data artifact: a small Cargo Bonus mismatch rate at Regional/District
 * events, running in both directions (so not a threshold error) and concentrated
 * in a few anomalous events (2022azfl, 2022txwac and others). Tolerated in
 * `reconciliation.test.ts`, never chased by changing this rule.
 */
import { z } from "zod";
import type { BonusPredicate, RpParsedResult, RpRuleModule, RpThresholdPrediction, RpThresholdVariable, RpTieredThreshold } from "./constants.js";
import { assertFiniteThresholdVariables, evaluateBonusPredicates, eventTierFor } from "./constants.js";

/** Only the fields this module reads; zod's default strip mode drops the rest without erroring (deliberately not `.passthrough()`/`.loose()`). */
const SideSchema = z.object({
  matchCargoTotal: z.number().finite(),
  autoCargoTotal: z.number().finite(),
  endgamePoints: z.number().finite(),
  cargoBonusRankingPoint: z.boolean(),
  hangarBonusRankingPoint: z.boolean(),
  quintetAchieved: z.boolean(),
});

const Rp2022Schema = z.object({
  red: SideSchema,
  blue: SideSchema,
});

/** Quintet condition: `autoCargoTotal >= 5` reduces the Cargo Bonus threshold. Not tiered (manual Table 6-1 states one flat number). */
const QUINTET_AUTO_CARGO_THRESHOLD: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 5 };

/** Cargo Bonus threshold when quintet NOT achieved: `matchCargoTotal >= 20`. Not tiered. */
const CARGO_BONUS_THRESHOLD_NON_QUINTET: RpTieredThreshold = { base: 20, districtChampionship: 20, championship: 20 };

/** Cargo Bonus threshold when quintet achieved: `matchCargoTotal >= 18`. Not tiered. */
const CARGO_BONUS_THRESHOLD_QUINTET: RpTieredThreshold = { base: 18, districtChampionship: 18, championship: 18 };

/** Hangar Bonus threshold: `endgamePoints >= 16`. Not tiered. */
const HANGAR_BONUS_THRESHOLD: RpTieredThreshold = { base: 16, districtChampionship: 16, championship: 16 };

// Every variable declares "lattice"; the shipping evidence is data/baselines/rp-bonus-arms-2026-09.json.
const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  {
    name: "matchCargoTotal",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: no cargo cap.
    lattice: { step: 1, min: 0 },
  },
  {
    name: "autoCargoTotal",
    unit: "count",
    marginalFamily: "lattice",
    // Rule: no AUTO cargo cap (human players may score too).
    lattice: { step: 1, min: 0 },
  },
  {
    name: "endgamePoints",
    unit: "points",
    marginalFamily: "lattice",
    // Rule: LOW 4 / MID 6 / HIGH 10 / TRAVERSAL 15 per robot, gcd 1.
    lattice: { step: 1, min: 0, max: 45 },
  },
];

const BONUS_PREDICATES: readonly BonusPredicate[] = [
  {
    kind: "dataDependentMixture",
    name: "cargoBonus",
    selector: { terms: [{ variable: "autoCargoTotal" }], direction: "gte", threshold: QUINTET_AUTO_CARGO_THRESHOLD },
    whenSelectorTrue: { terms: [{ variable: "matchCargoTotal" }], direction: "gte", threshold: CARGO_BONUS_THRESHOLD_QUINTET },
    whenSelectorFalse: { terms: [{ variable: "matchCargoTotal" }], direction: "gte", threshold: CARGO_BONUS_THRESHOLD_NON_QUINTET },
  },
  {
    kind: "singleThreshold",
    name: "hangarBonus",
    variable: "endgamePoints",
    direction: "gte",
    threshold: HANGAR_BONUS_THRESHOLD,
  },
];

const BONUS_NAMES = BONUS_PREDICATES.map((p) => p.name);

export const rp2022: RpRuleModule = {
  season: 2022,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  bonusPredicates: BONUS_PREDICATES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,

  parse(rawBreakdownJson: unknown, side: "red" | "blue", eventType: number): RpParsedResult {
    const parsed = Rp2022Schema.parse(rawBreakdownJson);
    const own = parsed[side];
    const tier = eventTierFor(eventType);

    const thresholdVariables: Record<string, number> = Object.create(null) as Record<string, number>;
    thresholdVariables.matchCargoTotal = own.matchCargoTotal;
    thresholdVariables.autoCargoTotal = own.autoCargoTotal;
    thresholdVariables.endgamePoints = own.endgamePoints;
    assertFiniteThresholdVariables(thresholdVariables, `rp2022 ${side}`);

    const quintetAchieved = own.autoCargoTotal >= QUINTET_AUTO_CARGO_THRESHOLD[tier];
    const cargoThreshold = quintetAchieved ? CARGO_BONUS_THRESHOLD_QUINTET[tier] : CARGO_BONUS_THRESHOLD_NON_QUINTET[tier];
    const cargoBonus = own.matchCargoTotal >= cargoThreshold;
    const hangarBonus = own.endgamePoints >= HANGAR_BONUS_THRESHOLD[tier];

    const bonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    bonusFlags.cargoBonus = cargoBonus;
    bonusFlags.hangarBonus = hangarBonus;

    const recordedBonusFlags: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    recordedBonusFlags.cargoBonus = own.cargoBonusRankingPoint;
    recordedBonusFlags.hangarBonus = own.hangarBonusRankingPoint;

    const totalRp = Number(cargoBonus) + Number(hangarBonus);

    return {
      thresholdVariables,
      bonusFlags,
      recordedBonusFlags,
      winRp: 2,
      tieRp: 1,
      totalRp,
    };
  },

  /** Fully computable from tracked threshold variables; no untracked alliance-level gate. */
  predictThresholds(values: Readonly<Record<string, number>>, eventType: number): RpThresholdPrediction {
    return evaluateBonusPredicates(BONUS_PREDICATES, values, eventType);
  },
};
