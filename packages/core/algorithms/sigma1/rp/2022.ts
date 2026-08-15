/**
 * 2022 (Rapid React) RP rule module — STUB (Task 1 of plan 03-02).
 * Registers the season's shape (threshold variables, bonus names, win/tie
 * RP) so `rules.ts`'s dispatch table typechecks; `parse` is filled in by
 * Task 2 with the real manual-cited implementation. Do not use `parse` from
 * this stub for anything — it throws.
 */
import type { RpParsedResult, RpRuleModule, RpThresholdVariable } from "./constants.js";

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "matchCargoTotal", unit: "count" },
  { name: "autoCargoTotal", unit: "count" },
  { name: "endgamePoints", unit: "points" },
];

const BONUS_NAMES = ["cargoBonus", "hangarBonus"] as const;

export const rp2022: RpRuleModule = {
  season: 2022,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 2 + BONUS_NAMES.length,
  winRp: 2,
  tieRp: 1,
  parse(_rawBreakdownJson: unknown, _side: "red" | "blue", _eventType: number): RpParsedResult {
    throw new Error("rp2022.parse: not implemented (Task 1 stub — Task 2 fills this in)");
  },
};
