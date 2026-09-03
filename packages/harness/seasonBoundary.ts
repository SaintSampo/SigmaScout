import type { SeasonBoundary } from "../core/algorithms/types.js";

/**
 * The one shared, unit-tested constructor of a production `SeasonBoundary`.
 *
 * Before quick task 260903-3bv this construction existed as THREE independent
 * inline copies (`cli.ts`, `tune.ts`, `publish.ts`), each writing
 * `fromSeason: season - 1` rather than reading the actual preceding element
 * of the `seasons` array. That hardcoding was harmless while
 * `SeasonBoundary.fromSeason` had zero read sites anywhere in production code
 * (verified 2026-09-03) — nothing downstream could notice it was a nominal
 * label rather than an observed season. Quick task 260903-3bv's `carrySeason`
 * (`packages/core/algorithms/sigma1/index.ts`) became the FIRST production
 * reader of `fromSeason`, computing `gap = toSeason - fromSeason` from it —
 * which turns three independent inline copies into three independent chances
 * to silently pin `gap` at one year forever, even once a non-contiguous
 * corpus (e.g. `extend-corpus-2019-2020`'s permanently-excluded 2021) makes
 * that false. Centralizing the construction here means there is exactly one
 * place left that can get it wrong, and it is covered by
 * `seasonBoundary.test.ts`.
 *
 * `cli.ts`'s own 02-REVIEW IN-01 comment anticipated exactly this: "correct
 * ... if a non-contiguous `seasons` array ever reaches this loop and a future
 * `carrySeason` starts consuming `fromSeason`." This function is that future,
 * carried forward to all three call sites rather than just the one that
 * already had the reasoning written down.
 *
 * `fromSeason` is the ACTUAL previous element of `seasons` when one exists
 * (`index > 0`), never a `season - 1` computation — so a non-contiguous
 * corpus (`[2019, 2020, 2022, ...]`) correctly reports a two-year gap at the
 * `2020 -> 2022` boundary instead of silently reporting one. Index 0 has no
 * predecessor to read: `season - 1` is kept there as a nominal label, which
 * is safe precisely because `isColdStart` will be `true` for that season and
 * `carrySeason` returns before ever computing a gap from a cold-start
 * boundary.
 */
export function seasonBoundaryFor(seasons: readonly number[], index: number, coldStartSeason: number): SeasonBoundary {
  const season = seasons[index]!;
  return {
    fromSeason: index > 0 ? seasons[index - 1]! : season - 1,
    toSeason: season,
    isColdStart: season === coldStartSeason,
  };
}
