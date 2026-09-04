/**
 * The season list the year dropdown renders (Task 1, 05-05-PLAN.md; widened
 * to the gapped seven-season corpus by quick task 260904-nt4).
 * `FIRST_SEASON`/`CURRENT_SEASON` are the two bounds; `SEASONS` is built from
 * them (with `EXCLUDED_SEASONS` filtered out) rather than hand-maintained as
 * a literal array, so a season the algorithms' own registry
 * (`packages/core/algorithms/breakdown/index.ts`'s `SEASON_COMPONENT_MAPS`)
 * does not know about cannot silently appear in the year dropdown —
 * `metricKeys.test.ts`'s `describe("SEASONS")` asserts every element of
 * `SEASONS` resolves through `componentMapForSeason` without throwing, AND
 * that every element of `EXCLUDED_SEASONS` THROWS through it — the exclusion
 * tracks the algorithms' own season registry rather than being an arbitrary
 * hole.
 *
 * The corpus (and this site) covers seven seasons: 2019, 2020, 2022, 2023,
 * 2024, 2025, 2026. **2021 is a PERMANENT exclusion, not a deferral or a gap
 * awaiting backfill.** 2021 was the at-home/remote season with no
 * conventional 3v3 alliance matches, so there is nothing for a match
 * predictor to ingest or score — recorded user decision, 2026-09-03
 * (`.planning/todos/completed/extend-corpus-2019-2020.md`). Never write a
 * comment, test, or doc line that frames 2021 as "not yet ingested".
 *
 * This file still never imports from `packages/core/` — the registry
 * agreement above is enforced by the test, not by an import. `FIRST_SEASON`
 * and `CURRENT_SEASON` remain UI facts (the oldest/newest season this site's
 * pages can render) kept independent of the algorithms' own replay range on
 * purpose; the two could diverge without this file needing to change.
 */

/** The oldest season this site's pages can render — the corpus's earliest ingested season (PROJECT.md). */
export const FIRST_SEASON = 2019;

/** The newest season this site's pages can render — the 2026 season is complete (PROJECT.md, "The 2026 season is complete"). */
export const CURRENT_SEASON = 2026;

/**
 * Seasons that fall within `[FIRST_SEASON, CURRENT_SEASON]` but are
 * permanently excluded from the corpus. 2021 (the at-home/remote season) has
 * no registered component map and never will — see the file header above.
 */
export const EXCLUDED_SEASONS: readonly number[] = [2021];

/**
 * Descending: `CURRENT_SEASON` first (the year dropdown's default selection,
 * per 05-UI-SPEC.md's "Year dropdown" populated row), `FIRST_SEASON` last,
 * with every `EXCLUDED_SEASONS` member filtered out.
 */
export const SEASONS: readonly number[] = Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, index) => CURRENT_SEASON - index).filter(
  (season) => !EXCLUDED_SEASONS.includes(season)
);
