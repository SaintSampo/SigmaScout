/**
 * Leaf module for the breakdown package: types and constants every
 * per-season map and the dispatch table (`index.ts`) both need, with no
 * dependency running the other direction.
 *
 * Every season file previously imported these constants FROM `index.ts`,
 * while `index.ts` imports every season file — a circular import that
 * `vitest`'s transform tolerated but a real Node ESM loader (`tsx`) does
 * not: a circularly-loaded season module could read a constant before
 * `index.ts`'s top-level declaration had executed. Moving the shared
 * types/constants into this dependency-free leaf module, with both sides
 * importing from here instead of each other, removes the cycle entirely.
 */

/**
 * One season's parsed component values, keyed by canonical component name.
 * Every value finite — a per-season `SeasonComponentMap.parse` must throw
 * rather than emit a non-finite value.
 */
export type ParsedComponents = Record<string, number>;

/**
 * The interface a per-season module implements: the canonical component
 * names it emits, and a pure parser from the raw TBA `score_breakdown`
 * object to one alliance's `ParsedComponents`. Some components (e.g.
 * 2024's `foulsCommitted`) are legitimately cross-alliance — `parse`
 * receives the whole raw object, not just `side`'s half, so a per-season
 * map can read the opposing alliance's fields when needed.
 */
export interface SeasonComponentMap {
  readonly components: readonly string[];
  parse(rawBreakdownJson: unknown, side: "red" | "blue"): ParsedComponents;
  /**
   * Raw TBA field names this season carries but never emits as a rating
   * component, not read by any algorithm's update path. Optional: 2024's
   * map predates this convention.
   */
  readonly diagnosticKeys?: readonly string[];
}

/**
 * Canonical component name for a per-team "fouls committed" observation:
 * the points this alliance's fouls cost the opponent, derived from the
 * opposing alliance's own `foulPoints` field. Every season module spells
 * this name through the constant, never as a bare string literal.
 */
export const FOULS_COMMITTED_COMPONENT = "foulsCommitted";

/**
 * Canonical component name for TBA's `adjustPoints` field. Every season
 * module spells this name through the constant, never as a bare string literal.
 */
export const ADJUST_COMPONENT = "adjust";

/**
 * Throws loudly rather than letting a non-finite component value silently
 * reach a Kalman/EWMA update. The per-season Zod parse boundary is the
 * first finite-value gate, but a value that survives parsing can still be
 * produced by `fallback.ts`'s `distributeResidual` degenerate branch and
 * bypass that gate entirely. `epa.ts` calls this immediately before
 * folding an observed component vector into its own state, so a single
 * non-finite value throws here instead of propagating NaN/Infinity through
 * every subsequent update for the rest of a team's season. Hoisted here (a
 * dependency-free leaf) rather than duplicated in each module, so the
 * copies cannot drift.
 */
export function assertFiniteComponents(observed: ParsedComponents, context: string): void {
  for (const [name, value] of Object.entries(observed)) {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite value ${value} for component "${name}" (${context}) — refusing to fold into algorithm state`);
    }
  }
}
