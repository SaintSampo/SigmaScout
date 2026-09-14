/**
 * Season -> RP rule module dispatch table. Adding a season is a new `{year}.ts`
 * file plus an entry in `RP_RULE_MODULES`, never a branch here.
 *
 * Shared types and constants live in the dependency-free leaf `./constants.js` and
 * are re-exported here for convenience. Season files import that leaf, never this
 * file, so the dependency graph stays acyclic.
 */
export {
  ELIMINATION_RP_TOTAL,
  EVENT_TYPE_TIERS,
  assertFiniteThresholdVariables,
  eventTierFor,
  evaluateBonusPredicates,
  resolveRpThreshold,
  type BonusPredicate,
  type EventTier,
  type MarginalFamily,
  type RpLinearTerm,
  type RpParsedResult,
  type RpPredicateThreshold,
  type RpRuleModule,
  type RpThresholdClause,
  type RpThresholdVariable,
  type RpTieredThreshold,
  type RpUntrackedGate,
} from "./constants.js";
import type { RpRuleModule } from "./constants.js";

import { rp2016 } from "./2016.js";
import { rp2017 } from "./2017.js";
import { rp2018 } from "./2018.js";
import { rp2019 } from "./2019.js";
import { rp2020 } from "./2020.js";
import { rp2022 } from "./2022.js";
import { rp2023 } from "./2023.js";
import { rp2024 } from "./2024.js";
import { rp2025 } from "./2025.js";
import { rp2026 } from "./2026.js";

export const RP_RULE_MODULES: Readonly<Record<number, RpRuleModule>> = {
  2016: rp2016,
  2017: rp2017,
  2018: rp2018,
  2019: rp2019,
  2020: rp2020,
  2022: rp2022,
  2023: rp2023,
  2024: rp2024,
  2025: rp2025,
  2026: rp2026,
};

/** Every registered season, sorted; `rules.test.ts` and `reconciliation.test.ts` iterate it, so a new season extends both suites. */
export const RP_REGISTERED_SEASONS = Object.keys(RP_RULE_MODULES)
  .map(Number)
  .sort((a, b) => a - b) as readonly number[];

/** Throws for an unmapped season rather than defaulting: an unregistered season has no defensible RP rule set to fall back to. */
export function rpRuleModuleForSeason(season: number): RpRuleModule {
  const module = RP_RULE_MODULES[season];
  if (!module) {
    throw new Error(
      `rpRuleModuleForSeason: no RP rule module registered for season ${season} (registered: ${Object.keys(RP_RULE_MODULES).join(", ")})`
    );
  }
  return module;
}
