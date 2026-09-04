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
 *
 * Order (D-5, 2026-09-04 quick task 260904-5zg): TOTAL_KEY leads, followed
 * by the season's components in their own declared order — deliberately,
 * not incidentally. This one array is the column order for the Teams
 * table's components view, the event Breakdown tab and Breakdown's
 * skeleton (all three consume this array's order directly), so leading
 * with Total here lands the "Total sits immediately right of the
 * team-name column" requirement in all three places from one change.
 */
export function metricKeysFor(algorithmId: string, season: number): readonly string[] {
  if (algorithmId === "opr") {
    return [TOTAL_KEY];
  }
  const { components } = componentMapForSeason(season);
  return [TOTAL_KEY, ...components];
}

/**
 * Phase-group metric keys (`phaseAuto`/`phaseTeleop`/`phaseEndgame`) in the
 * canonical Auto → Teleop → Endgame order — the grouped Teams-table view's
 * column keys (2026-09-01 redesign, decision T1).
 */
export const GROUP_METRIC_KEYS: readonly string[] = COMPONENT_GROUP_IDS.map((id) => COMPONENT_GROUP_METRIC_KEYS[id]);

/**
 * Whether the TEAMS-LIST artifact for this algorithm PUBLISHES the
 * phase-group metrics as first-class entries (their own spread and/or
 * percentile, not just a value). Verified against the live 2026 artifacts
 * (2026-09-01): VPR publishes all three groups per row with a spread. As of
 * quick task 260904-7id (D-1), the pipeline also publishes EPA's three
 * group metrics — `epa.ts`'s `teamMetrics()` now emits `phaseAuto`/
 * `phaseTeleop`/`phaseEndgame` as value-only entries, and the existing
 * percentile/tier pass (generic over metric names) attaches a season-wide
 * percentile/tier to them with no pipeline change. OPR still does not
 * publish groups — it has no components to group at all. Derived from the
 * algorithm id, never from inspecting fetched rows — the same column-set
 * discipline `metricKeysFor` states above.
 *
 * Split from `hasGroupedTeamsView` (2026-09-04, quick task 260904-5zg,
 * D-2): this predicate answers "does the pipeline publish the group", which
 * used to be a narrower question than "can the grouped view show real
 * values" back when only VPR published groups and EPA's grouped view relied
 * entirely on `lib/metricGroups.ts`'s `withDerivedGroupMetrics` to derive an
 * honest, value-only group entry client-side. That narrower-vs-broader gap
 * has closed for EPA as of 260904-7id — a published EPA group entry now
 * wins over the derived one at `withDerivedGroupMetrics`'s own
 * published-wins merge — but `withDerivedGroupMetrics` still matters as the
 * STALE-ARTIFACT fallback: a browser holding a cached pre-republish EPA
 * artifact has no published group entry to read yet, and must render an
 * honest, tier-less value rather than nothing (see that module's own header
 * for the full picture). Surfaces that need to know whether a cell is
 * PUBLISHED (and therefore may carry a spread/tier) rather than DERIVED
 * (value only) read this function; surfaces that only need to know whether
 * the grouped view has anything real to show read `hasGroupedTeamsView`
 * below.
 */
export function publishesGroupMetrics(algorithmId: string): boolean {
  return algorithmId === "vpr" || algorithmId === "epa";
}

/**
 * Whether the grouped Teams-table view can render REAL values (published or
 * exactly derived) for this algorithm — true for every algorithm that has
 * components to group, false only for OPR, which publishes Total alone and
 * has nothing to group.
 *
 * Widened (2026-09-04, quick task 260904-5zg, D-2) from "publishes the
 * group metrics" (VPR only) to this broader question, now that
 * `lib/metricGroups.ts`'s `withDerivedGroupMetrics` can produce an honest,
 * value-only group entry for EPA from its published components. See
 * `publishesGroupMetrics` above for the narrower "did the pipeline publish
 * this" question this function no longer answers.
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
