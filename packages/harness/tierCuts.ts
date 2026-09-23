/**
 * The rarity-tier evaluator that reproduces a published percentile-derived
 * tier from three published CUT POINTS alone — no percentile, no season
 * pool, no network request. This is the one place the cut-point evaluation
 * rule is stated; `packages/harness/percentiles.ts`'s `buildTierCutsFromPools`
 * builds the cuts this file evaluates, and `apps/web/src/lib/tiers.ts`'s
 * resolver is this file's only client-side caller.
 *
 * BROWSER-SAFE BY CONSTRUCTION: this module may import `roundMetric` from
 * `./rounding.js` and TYPES ONLY from `./pageArtifacts.js`, and nothing
 * else. It must never gain a runtime dependency on `zod`, on
 * `./metricDirection.js`, or on anything under
 * `packages/core/algorithms/breakdown/` — all three exist only to BUILD the
 * cuts (a publish-time, Node-side concern), never to evaluate them, and the
 * client bundle has no use for any of them. The `import type` below is
 * erased entirely under `verbatimModuleSyntax`, so `pageArtifacts.ts`'s own
 * `zod` dependency never reaches this file's compiled output.
 *
 * WHY ROUNDING THE QUERY MAKES THIS EXACT: a published tier is
 * `publishedTierForPercentile(goodnessPercentileAgainstPools(pool, name,
 * value))`. Unrolled: `roundMetric` is monotone non-decreasing;
 * `percentileAgainstSortedPool` is non-decreasing in its (rounded) query;
 * `goodnessPercentile` is either the identity or `100 - p` (still monotone,
 * just decreasing); and `publishedTierForPercentile` is non-decreasing in
 * `p` (cuts at 50/75/95, each half-open on the low side, Legendary closed at
 * 100). The composition of monotone functions is monotone, so the published
 * tier is a MONOTONE STEP FUNCTION of the rounded value, with at most three
 * steps — which is exactly what three boundary values can reproduce exactly,
 * provided the same rounding is applied to the query here that the
 * reference applies to ITS query. Rounding only the cuts (and comparing
 * against an unrounded input) would misclassify a value that rounds onto a
 * cut from the wrong side.
 */
import { roundMetric } from "./rounding.js";
import type { SeasonTierCutEntry } from "./pageArtifacts.js";

/**
 * The four rarity tiers, in ascending order. Declared HERE, not in
 * `apps/web/src/lib/tiers.ts`, so the evaluator and the client never carry
 * two independently-drifting copies of the literal union — `tiers.ts`
 * re-exports this type rather than restating it.
 */
export type Tier = "common" | "rare" | "epic" | "legendary";

/**
 * Reproduces `publishedTierForPercentile(goodnessPercentileAgainstPools(
 * pool, name, value))` exactly, from `entry.cuts` alone.
 *
 * `entry.cuts` is `[rare, epic, legendary]`: the smallest `roundMetric`-
 * precision value at which the tier reaches that band, for a
 * higher-is-better metric. The rule is `tier(v) >= T` iff `roundMetric(v) >=
 * cuts[T]`, evaluated from Legendary down so the first matching band wins;
 * falls through to `"common"` when none match — there is no separate
 * "common cut", because Common is everything below the Rare cut.
 *
 * `entry.lower === true` (an OPTIONAL marker; see `SeasonTierCutEntrySchema`
 * in `pageArtifacts.ts` for why the wire format carries it rather than the
 * client deriving direction) flips both the comparison to `<=` AND the
 * array's own sense: `cuts` is DESCENDING for a lower-is-better metric, so
 * `cuts[2]` (Legendary) is the smallest, hardest-to-reach value and
 * `cuts[0]` (Rare) is the largest, easiest one.
 *
 * Returns `undefined` when either argument is absent: no cuts were
 * published for this metric name, or there is no value to classify. Both
 * are honest "no tier" outcomes, never a guess.
 */
export function tierFromCuts(entry: SeasonTierCutEntry | undefined, value: number | undefined): Tier | undefined {
  if (entry === undefined || value === undefined) return undefined;
  const rounded = roundMetric(value);
  const [rare, epic, legendary] = entry.cuts;
  if (entry.lower === true) {
    if (rounded <= legendary) return "legendary";
    if (rounded <= epic) return "epic";
    if (rounded <= rare) return "rare";
    return "common";
  }
  if (rounded >= legendary) return "legendary";
  if (rounded >= epic) return "epic";
  if (rounded >= rare) return "rare";
  return "common";
}
