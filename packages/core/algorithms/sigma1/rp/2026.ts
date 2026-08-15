/**
 * 2026 (REBUILT) RP rule module — STUB (Task 1 of plan 03-02).
 * Registers the season's shape (threshold variables, bonus names, win/tie
 * RP) so `rules.ts`'s dispatch table typechecks; `parse` is filled in by
 * Task 2 with the real manual-cited implementation. Do not use `parse` from
 * this stub for anything — it throws.
 */
import type { RpParsedResult, RpRuleModule, RpThresholdVariable } from "./constants.js";

const THRESHOLD_VARIABLES: readonly RpThresholdVariable[] = [
  { name: "hubTotalCount", unit: "count" },
  { name: "totalTowerPoints", unit: "points" },
];

const BONUS_NAMES = ["energized", "supercharged", "traversal"] as const;

export const rp2026: RpRuleModule = {
  season: 2026,
  thresholdVariables: THRESHOLD_VARIABLES,
  bonusNames: BONUS_NAMES,
  maxRp: 3 + BONUS_NAMES.length,
  winRp: 3,
  tieRp: 1,
  parse(_rawBreakdownJson: unknown, _side: "red" | "blue", _eventType: number): RpParsedResult {
    throw new Error("rp2026.parse: not implemented (Task 1 stub — Task 2 fills this in)");
  },
};
