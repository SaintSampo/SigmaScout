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
 * is safe by construction — `isColdStart` is `true` at index 0, always, not
 * as a coincidence that depends on a caller passing the right value. (See
 * the cold-start rationale below.)
 *
 * ## Cold start is positional, not a remembered value (D-1)
 *
 * `isColdStart` used to be `season === coldStartSeason`, matched against a
 * module constant (a hardcoded year, 2022) that every caller had to pass
 * unchanged. That made the corpus's first season a fact someone had to
 * *remember*, and it went stale silently the moment `extend-corpus-2019-2020`
 * moved the corpus start to 2019: a `[2019, 2020, 2022]` tuning replay kept
 * marking **2022** cold, discarding the state carried from the two prior
 * seasons, while 2019 — the season that actually has no predecessor —
 * reported `isColdStart: false`. The first element of a replay range has no
 * predecessor to carry from, which is the actual definition of a cold start,
 * so matching a remembered value was never the right test. `index === 0` is
 * that definition made literal, and it cannot go stale the way a constant
 * can, because there is no second fact for it to disagree with.
 *
 * `coldStartSeason` survives as an optional third argument, but its purpose
 * is now narrow and deliberate (D-4): it forces a season that is NOT at
 * index 0 to start cold, discarding carry, as a diagnostic override. It is
 * NOT the mechanism for extending the corpus backward — the positional
 * default handles that with no flag at all.
 */
export function seasonBoundaryFor(seasons: readonly number[], index: number, coldStartSeason?: number): SeasonBoundary {
  const season = seasons[index]!;
  return {
    fromSeason: index > 0 ? seasons[index - 1]! : season - 1,
    toSeason: season,
    isColdStart: coldStartSeason === undefined ? index === 0 : season === coldStartSeason,
  };
}
