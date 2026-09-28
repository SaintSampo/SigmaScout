import { tierFromCuts } from "../../../../packages/harness/tierCuts.js";
import type { Tier } from "./tiers";
import { TOTAL_KEY } from "./metricKeys";
import type { SeasonTierCuts } from "../../../../packages/harness/pageArtifacts.js";

/**
 * An alliance's COMBINED three-team total has no published percentile of
 * its own to tier against — a sum's rank is not a function of its parts'
 * ranks, so this module's output is always an ESTIMATE, never an exact
 * rank, and every caller must surface it to the reader as approximate
 * (`AlliancesTab.tsx`'s marker does this).
 *
 * Method: divide the combined 3-team value by 3 to get a per-team
 * equivalent, then classify that equivalent against the season `tierCuts`
 * Total entry through `tierFromCuts` — exactly the tier a single team with
 * that value would take in the same season pool the published percentiles
 * rank against. The divide-by-3 step is the only approximation left: an
 * alliance averaging X is treated as being as rare as one team at X.
 *
 * Quick task 260927-wnh replaced an interpolation over the event roster's
 * own published percentiles, which thinned as live folds stripped those
 * percentiles from folded teams and clamped at the event's own value range.
 * The cut rule depends on neither: it needs no roster at all, so it works
 * identically whether every team just folded or none has yet, and it never
 * caps an alliance below or above what the event's own teams happen to
 * publish.
 *
 * Absent `tierCuts`, or a `tierCuts` block with no Total entry, returns
 * `undefined` with no fallback. The artifact that lacks cuts in production
 * (the Worker's bootstrap write, which holds no season pool) carries no
 * published percentiles either, so a second method behind the same
 * disclosure sentence would make that sentence false for one of them.
 */

/**
 * Returns the season-pool tier a single team at `combinedValue / 3` would
 * take, via `tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3)`.
 * Returns `undefined` when there is no Total cut entry to classify
 * against — never a guess. Common is returned explicitly (not
 * `undefined`) so the hairline ring draws.
 */
export function estimateCombinedTier(combinedValue: number, tierCuts: SeasonTierCuts | undefined): Tier | undefined {
  return tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3);
}
