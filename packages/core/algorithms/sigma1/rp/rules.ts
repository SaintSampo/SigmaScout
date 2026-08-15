/**
 * Season -> RP rule module dispatch table (D-09, D-12, D-19). Adding a new
 * season is a new entry in `RP_RULE_MODULES` below and a new `{year}.ts`
 * file — never a branch here, the identical discipline
 * `breakdown/index.ts`'s file header documents for the score-component
 * dispatch table. Extending back to 2016 (D-19, deferred) is data entry:
 * a new import plus a new record entry.
 *
 * Shared types/constants (`RpRuleModule`, `RpParsedResult`,
 * `RpThresholdVariable`, `RpTieredThreshold`, `EventTier`,
 * `EVENT_TYPE_TIERS`, `eventTierFor`, `assertFiniteThresholdVariables`,
 * `ELIMINATION_RP_TOTAL`) live in `./constants.js`, a dependency-free leaf
 * module, and are re-exported here for call-site convenience — exactly as
 * `breakdown/index.ts` re-exports `breakdown/constants.ts`. This module
 * (the dispatch table) imports every season file, and every season file
 * imports the shared leaf from `constants.js` — never from this file — so
 * the dependency graph stays acyclic (see `constants.ts`'s file header for
 * the circular-import bug this exact split already fixed once in
 * `breakdown/`).
 */
export {
  ELIMINATION_RP_TOTAL,
  EVENT_TYPE_TIERS,
  assertFiniteThresholdVariables,
  eventTierFor,
  type EventTier,
  type RpParsedResult,
  type RpRuleModule,
  type RpThresholdVariable,
  type RpTieredThreshold,
} from "./constants.js";
import type { RpRuleModule } from "./constants.js";

// Registered seasons (D-19: adding one is data entry — a new import plus a
// new record entry — never a branch in this dispatch function).
import { rp2022 } from "./2022.js";
import { rp2023 } from "./2023.js";
import { rp2024 } from "./2024.js";
import { rp2025 } from "./2025.js";
import { rp2026 } from "./2026.js";

export const RP_RULE_MODULES: Readonly<Record<number, RpRuleModule>> = {
  2022: rp2022,
  2023: rp2023,
  2024: rp2024,
  2025: rp2025,
  2026: rp2026,
};

/**
 * Sorted, readonly tuple of every registered season — the single source of
 * `rules.test.ts`'s `describe.each`/`reconciliation.test.ts`'s
 * `describe.each` iteration, so registering a new season automatically
 * extends both test suites without a second edit.
 */
export const RP_REGISTERED_SEASONS = Object.keys(RP_RULE_MODULES)
  .map(Number)
  .sort((a, b) => a - b) as readonly number[];

/**
 * Looks up the RP rule module for `season`. Throws for an unmapped season
 * rather than defaulting — the identical `componentMapForSeason` discipline
 * (`breakdown/index.ts`) — an unregistered season has no defensible RP rule
 * set to fall back to.
 */
export function rpRuleModuleForSeason(season: number): RpRuleModule {
  const module = RP_RULE_MODULES[season];
  if (!module) {
    throw new Error(
      `rpRuleModuleForSeason: no RP rule module registered for season ${season} (registered: ${Object.keys(RP_RULE_MODULES).join(", ")})`
    );
  }
  return module;
}
