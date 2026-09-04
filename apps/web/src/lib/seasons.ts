/**
 * The season list the year dropdown renders (Task 1, 05-05-PLAN.md).
 * `FIRST_SEASON`/`CURRENT_SEASON` are the two bounds; `SEASONS` is built from
 * them rather than hand-maintained as a literal array, so a season the
 * algorithms' own registry (`packages/core/algorithms/breakdown/index.ts`'s
 * `SEASON_COMPONENT_MAPS`) does not know about cannot silently appear in the
 * year dropdown — `seasons.test.ts` asserts every element of `SEASONS`
 * resolves through `componentMapForSeason` without throwing, catching a
 * `CURRENT_SEASON` bump that outran the registry (or vice versa).
 *
 * `FIRST_SEASON` happens to be 2022, the same year the algorithms' replay
 * range currently starts (and therefore currently cold-starts, positionally
 * — see `packages/harness/seasonBoundary.ts`, quick task 260904-cs1). It is
 * not derived from that fact and never imports from `packages/core/`: this
 * value is a UI fact — the oldest season this phase's pages can render — and
 * is kept independent of the algorithms' replay range on purpose. The two
 * could diverge (e.g. the algorithms' corpus extending back further than
 * the pages are ready to render) without this file needing to change.
 */

/** The oldest season this phase's pages can render — the corpus's modern-era boundary (PROJECT.md). */
export const FIRST_SEASON = 2022;

/** The newest season this phase's pages can render — the 2026 season is complete (PROJECT.md, "The 2026 season is complete"). */
export const CURRENT_SEASON = 2026;

/**
 * Descending: `CURRENT_SEASON` first (the year dropdown's default selection,
 * per 05-UI-SPEC.md's "Year dropdown" populated row), `FIRST_SEASON` last.
 */
export const SEASONS: readonly number[] = Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, index) => CURRENT_SEASON - index);
