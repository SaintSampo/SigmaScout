/**
 * The season list the year dropdown renders. `FIRST_SEASON`/`CURRENT_SEASON`
 * are the two bounds; `SEASONS` is built from them (with `EXCLUDED_SEASONS`
 * filtered out) rather than hand-maintained as a literal array, so a season
 * the algorithms' own registry (`packages/core/algorithms/breakdown/index.ts`'s
 * `SEASON_COMPONENT_MAPS`) does not know about cannot silently appear in the
 * year dropdown — `metricKeys.test.ts`'s `describe("SEASONS")` asserts every
 * element of `SEASONS` EITHER resolves through `componentMapForSeason` without
 * throwing OR is a roster-only season (`packages/harness/rosterOnlySeason.ts`:
 * newer than every registered game season), that `DEFAULT_SEASON` is never
 * roster-only, AND that every element of `EXCLUDED_SEASONS` THROWS through
 * `componentMapForSeason` — the exclusion tracks the algorithms' own season
 * registry rather than being an arbitrary hole.
 *
 * The corpus (and this site) covers TEN game seasons: 2016, 2017, 2018, 2019,
 * 2020, 2022, 2023, 2024, 2025, 2026. Once revealed, 2027 is listed as a
 * ROSTER-ONLY season: its events and rosters only, because its game rules
 * arrive in January 2027 (quick task 261024-lfa). A new season publishes to
 * R2 and is verified against the live origin BEFORE `CURRENT_SEASON` moves
 * to cover it — publish-then-reveal, in that order. `CURRENT_SEASON` is the
 * one line that moves; `DEFAULT_SEASON` stays on a season with results. The
 * 2019/2020 rollout once shipped a year dropdown ahead of its artifacts and
 * every page 404'd; that ordering is the standing rule, not a one-off
 * precaution.
 *
 * **2021 is a PERMANENT exclusion, not a deferral or a gap
 * awaiting backfill.** 2021 was the at-home/remote season with no
 * conventional 3v3 alliance matches, so there is nothing for a match
 * predictor to ingest or score. Never write a comment, test, or doc line
 * that frames 2021 as "not yet ingested".
 *
 * This file still never imports from `packages/core/` — the registry
 * agreement above is enforced by the test, not by an import. `FIRST_SEASON`
 * and `CURRENT_SEASON` remain UI facts (the oldest/newest season this site's
 * pages can render) kept independent of the algorithms' own replay range on
 * purpose; the two could diverge without this file needing to change.
 */

/** The oldest season this site's pages can render — the corpus's earliest ingested season (PROJECT.md). */
export const FIRST_SEASON = 2016;

/**
 * The newest season the year dropdown lists. Publish-then-reveal: it stays
 * 2026 until the 2027 roster publish is verified on the live origin, then
 * this one line moves to 2027 (a roster-only season: events and rosters, no
 * game yet). It is NOT the season pages open on; that is `DEFAULT_SEASON`.
 */
export const CURRENT_SEASON = 2026;

/**
 * The season every page opens on and the URL fallback for a missing or
 * unknown `?year=`. Kept apart from `CURRENT_SEASON` (the newest season the
 * dropdown lists) so a season can be listed for its events and rosters
 * before its game is out while the site still opens on a season with
 * results. Never a roster-only season (`metricKeys.test.ts` asserts it).
 */
export const DEFAULT_SEASON = 2026;

/**
 * Seasons that fall within `[FIRST_SEASON, CURRENT_SEASON]` but are
 * permanently excluded from the corpus. 2021 (the at-home/remote season) has
 * no registered component map and never will — see the file header above.
 */
export const EXCLUDED_SEASONS: readonly number[] = [2021];

/**
 * Descending: `CURRENT_SEASON` first (the newest listed season, which may be
 * roster-only), `FIRST_SEASON` last, with every `EXCLUDED_SEASONS` member
 * filtered out. The dropdown's default selection is `DEFAULT_SEASON`, not
 * the first entry.
 */
export const SEASONS: readonly number[] = Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, index) => CURRENT_SEASON - index).filter(
  (season) => !EXCLUDED_SEASONS.includes(season)
);
