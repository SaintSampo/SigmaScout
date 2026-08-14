/**
 * Leaf module for the breakdown package (D-02, D-19): types and constants
 * every per-season map (`2022.ts`...`2026.ts`) AND the dispatch table
 * (`index.ts`) both need, with no dependency running the other direction.
 *
 * Rule 1 fix (plan 02-03, discovered running `pnpm harness` for real):
 * every season file previously imported `ADJUST_COMPONENT`/
 * `FOULS_COMMITTED_COMPONENT` FROM `index.ts`, while `index.ts` imports
 * every season file — a circular import. `vitest`'s transform tolerated
 * it, but `tsx`'s real Node ESM loader does not: `index.ts`'s top-level
 * `export const ADJUST_COMPONENT = "adjust"` had not executed yet by the
 * time a circularly-loaded `2022.ts` tried to read it, throwing
 * `ReferenceError: Cannot access 'ADJUST_COMPONENT' before initialization`
 * the moment any real `pnpm harness` invocation touched a season with a
 * breakdown map (i.e. every season). Moving the shared types/constants
 * into this dependency-free leaf module and having BOTH sides import from
 * here (never from each other) removes the cycle entirely.
 */

/**
 * One season's parsed component values, keyed by canonical component name.
 * Every value finite (T-02-01) — a per-season `SeasonComponentMap.parse`
 * must throw rather than emit a non-finite value.
 */
export type ParsedComponents = Record<string, number>;

/**
 * The interface a per-season module implements: the canonical component
 * names it emits, and a pure parser from the raw TBA `score_breakdown`
 * object (shape `{ red: {...}, blue: {...} }`) to one alliance's
 * `ParsedComponents`. Some components (e.g. 2024's `foulsCommitted`, D-04)
 * are legitimately cross-alliance — `parse` receives the whole raw object,
 * not just `side`'s half, so a per-season map can read the opposing
 * alliance's fields when the canonical component's definition requires it.
 */
export interface SeasonComponentMap {
  readonly components: readonly string[];
  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents;
  /**
   * Raw TBA field names this season carries but never emits as a rating
   * component (e.g. 2022-2025's `foulCount`/`techFoulCount` count fields,
   * 2026's renamed `majorFoulCount`/`minorFoulCount`) — recorded for plan
   * 02-06's identifiability report, not read by any algorithm's update
   * path. Optional: 2024's map (plan 02-01) predates this convention.
   */
  readonly diagnosticKeys?: readonly string[];
}

/**
 * Canonical component name for a per-team "fouls committed" observation
 * (D-04): the points this alliance's fouls cost the OPPONENT, derived from
 * the opposing alliance's own `foulPoints` field. Every season module
 * spells this name through the constant, never as a bare string literal.
 */
export const FOULS_COMMITTED_COMPONENT = "foulsCommitted";

/**
 * Canonical component name for TBA's `adjustPoints` field (present, with
 * that exact key, in every season 2022-2026 sampled this phase). Every
 * season module spells this name through the constant, never as a bare
 * string literal.
 */
export const ADJUST_COMPONENT = "adjust";

/**
 * PROJECT INTENT (D-19): once the models are proven, the corpus is
 * recomputed starting from 2016 and 2016 becomes the cold-start season
 * instead of 2022. This constant is the one place that parameter lives —
 * no other module under `packages/core/algorithms` may hardcode 2022 as a
 * cold-start sentinel.
 */
export const COLD_START_SEASON = 2022;

/**
 * D-19: the one comparison point for "is this season the corpus's
 * cold-start season" — every other module (carryover, the harness season
 * loop) calls this rather than re-deriving `season === COLD_START_SEASON`
 * itself, so extending the corpus back to 2016 (PROJECT INTENT above) is a
 * one-constant edit, never a grep-and-replace across call sites.
 */
export function isColdStartSeason(season: number): boolean {
  return season === COLD_START_SEASON;
}
