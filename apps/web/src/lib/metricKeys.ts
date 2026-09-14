/**
 * The declared metric-key set for an (algorithm, season) pair — the valid
 * key set is season-dependent as well as algorithm-dependent.
 *
 * Keys are derived from the algorithm and season only, never from
 * inspecting a fetched row: a row missing a declared component renders an
 * em-dash, the column itself never disappears.
 *
 * `componentMapForSeason` is imported via a relative deep path with an
 * explicit `.js` extension, matching this repo's established convention —
 * no `@sigmascout/*` workspace alias exists anywhere.
 * `packages/core/algorithms/breakdown/index.ts` is verified Node-free
 * (`packages/harness/browserSafeSchemas.test.ts`'s own entry point), so
 * importing it here does not drag a Node built-in into the browser bundle.
 */
import { ADJUST_COMPONENT, componentMapForSeason, COMPONENT_GROUP_IDS, COMPONENT_GROUP_METRIC_KEYS } from "../../../../packages/core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../../../../packages/core/algorithms/types.js";

/** Re-exported, never re-declared as a literal — the one key every algorithm guarantees (`packages/core/algorithms/types.ts`'s `TOTAL_METRIC_KEY`). */
export const TOTAL_KEY = TOTAL_METRIC_KEY;

/**
 * Keys derive from algorithm plus season, never from a fetched row. OPR
 * publishes only `TOTAL_KEY`. `componentMapForSeason` throws for an
 * unmapped season rather than returning a default — that throw propagates
 * here unguarded: an unmapped season has no defensible column set.
 *
 * TOTAL_KEY leads, followed by the season's components in their own
 * declared order — deliberately, not incidentally. This one array is the
 * column order for the Teams table's components view, the event Breakdown
 * tab and Breakdown's skeleton, so leading with Total here lands the "Total
 * sits immediately right of the team-name column" requirement in all three
 * places from one change.
 *
 * `ADJUST_COMPONENT` is filtered out here: it is TBA's manual scorekeeper
 * correction, not a team-skill signal, so no table shows it as a column.
 * This is a PRESENTATION filter only — the component stays in the season
 * maps, the pipeline, and published artifacts (rows still carry an
 * `adjust` entry; it simply has no column to land in).
 */
export function metricKeysFor(algorithmId: string, season: number): readonly string[] {
  if (algorithmId === "opr") {
    return [TOTAL_KEY];
  }
  const { components } = componentMapForSeason(season);
  return [TOTAL_KEY, ...components.filter((key) => key !== ADJUST_COMPONENT)];
}

/**
 * Phase-group metric keys (`phaseAuto`/`phaseTeleop`/`phaseEndgame`) in the
 * canonical Auto → Teleop → Endgame order — the grouped Teams-table view's
 * column keys.
 */
export const GROUP_METRIC_KEYS: readonly string[] = COMPONENT_GROUP_IDS.map((id) => COMPONENT_GROUP_METRIC_KEYS[id]);

/**
 * Whether this algorithm's EVENT artifacts publish per-team component
 * metrics (the season components, including `foulsCommitted`) that the
 * event Breakdown tab can expand a phase into. True for EPA; false for SPR,
 * whose phase components are display-only and whose event artifacts publish
 * exactly `total`, `phaseAuto`, `phaseTeleop` and `phaseEndgame` (plus
 * sigma), so expansion there would reveal only empty columns; false for
 * OPR, which publishes Total alone. Derived from the algorithm id, never
 * from inspecting fetched rows — the same column-set discipline
 * `metricKeysFor` states above.
 *
 * Distinct from `hasGroupedTeamsView` below, which still answers whether
 * the phase columns and sort buttons show at all. Consumed by the event
 * Breakdown tab only — the Teams list components view does not read it.
 */
export function publishesComponentMetrics(algorithmId: string): boolean {
  return algorithmId === "epa";
}

/**
 * Whether the grouped Teams-table view can render REAL values (published or
 * exactly derived) for this algorithm — true for every algorithm that has
 * components to group, false only for OPR, which publishes Total alone and
 * has nothing to group. `lib/metricGroups.ts`'s `withDerivedGroupMetrics`
 * can produce an honest, value-only group entry for an algorithm from its
 * published components even when the groups are not published directly.
 */
export function hasGroupedTeamsView(algorithmId: string): boolean {
  return algorithmId !== "opr";
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
