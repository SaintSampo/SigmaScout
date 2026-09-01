/**
 * The declared metric-key set for an (algorithm, season) pair (Task 1,
 * 05-05-PLAN.md) — the primary representation this plan's assumption-delta
 * block promotes over "the algorithm's columns" alone, because the valid key
 * set is season-dependent as well as algorithm-dependent (05-RESEARCH.md
 * Pattern 3).
 *
 * Keys are derived from the algorithm and season only, never from
 * inspecting a fetched row — 05-UI-SPEC.md's "Column-set derivation" note: a
 * row missing a declared component renders an em-dash, the column itself
 * never disappears.
 *
 * `componentMapForSeason` is imported via a relative deep path with an
 * explicit `.js` extension, matching this repo's established convention
 * (05-PATTERNS.md — no `@sigmascout/*` workspace alias exists anywhere).
 * `packages/core/algorithms/breakdown/index.ts` is verified Node-free
 * (`packages/harness/browserSafeSchemas.test.ts`'s third entry point, this
 * same task), so importing it here does not drag a Node built-in into the
 * browser bundle.
 */
import { componentMapForSeason, COMPONENT_GROUP_IDS, COMPONENT_GROUP_METRIC_KEYS } from "../../../../packages/core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../../../../packages/core/algorithms/types.js";

/** Re-exported, never re-declared as a literal — the one key every algorithm guarantees (`packages/core/algorithms/types.ts`'s `TOTAL_METRIC_KEY`). */
export const TOTAL_KEY = TOTAL_METRIC_KEY;

/**
 * OPR publishes only `TOTAL_KEY` (`packages/core/algorithms/opr.ts`'s
 * `teamMetrics`, verified 05-RESEARCH.md Pattern 3). EPA and VPR both
 * derive their per-season component keys from the SAME
 * `componentMapForSeason(season).components` array — for a fixed year they
 * always expose an identical column-key set, which is the shared-source
 * fact `resolveSortKey.ts`'s algorithm-switch fallback relies on never
 * needing to fire between EPA and VPR at a fixed year.
 *
 * `componentMapForSeason` throws for an unmapped season rather than
 * returning a default — that throw propagates here unguarded: an unmapped
 * season has no defensible column set, matching `seasons.ts`'s `SEASONS`
 * registration guarantee (every listed season resolves without throwing).
 */
export function metricKeysFor(algorithmId: string, season: number): readonly string[] {
  if (algorithmId === "opr") {
    return [TOTAL_KEY];
  }
  const { components } = componentMapForSeason(season);
  return [...components, TOTAL_KEY];
}

/**
 * Phase-group metric keys (`phaseAuto`/`phaseTeleop`/`phaseEndgame`) in the
 * canonical Auto → Teleop → Endgame order — the grouped Teams-table view's
 * column keys (2026-09-01 redesign, decision T1).
 */
export const GROUP_METRIC_KEYS: readonly string[] = COMPONENT_GROUP_IDS.map((id) => COMPONENT_GROUP_METRIC_KEYS[id]);

/**
 * Whether the TEAMS-LIST artifact for this algorithm carries the phase-group
 * metrics, i.e. whether the grouped Teams-table view can render real values.
 * Verified against the live 2026 artifacts (2026-09-01): VPR publishes all
 * three groups per row; EPA publishes components only (it has no spreads, so
 * honest group spreads are pipeline work, not client work); OPR publishes
 * only Total. Derived from the algorithm id, never from inspecting fetched
 * rows — the same column-set discipline `metricKeysFor` states above.
 */
export function hasGroupedTeamsView(algorithmId: string): boolean {
  return algorithmId === "vpr";
}

/**
 * Every metric key a Teams-page `sort` URL param may validly name for this
 * (algorithm, season) pair, across BOTH table views — used by the
 * year-change sort resolution so a grouped-view sort like `phaseAuto`
 * survives a year switch instead of silently resetting to Total.
 */
export function teamsSortKeyUniverse(algorithmId: string, season: number): readonly string[] {
  const keys = metricKeysFor(algorithmId, season);
  return hasGroupedTeamsView(algorithmId) ? [...keys, ...GROUP_METRIC_KEYS] : keys;
}
