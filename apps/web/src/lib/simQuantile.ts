/**
 * Verbatim port of sketch 005's `continuousQuantile()`, from
 * `.claude/skills/sketch-findings-sigmascout/sources/005-rank-distribution/index.html:149-162`.
 *
 * The estimator is R's default type-7 quantile estimator applied to binned
 * data: rank `r`'s probability mass is treated as occupying the interval
 * `[r-0.5, r+0.5)`, spread uniformly inside it, which makes the empirical CDF
 * piecewise-linear and the returned quantile continuous rather than snapping
 * to whichever integer rank the target percentile happens to land on.
 *
 * The return is bounded between `0.5` and `dist.length + 0.5` by
 * construction: the first non-empty bin's own returned value is at least
 * `(i + 1) - 0.5` with `i >= 0`, and the terminal fallback `dist.length + 0.5`
 * is reached only when the accumulated mass never meets the target.
 *
 * This function MUST NOT be reimplemented. Sketch 005 measured and fixed
 * three real defects in this exact math against real published data —
 * integer snapping rendered a locked team's band as zero-width and
 * invisible (`1-1`), and rendered two teams with genuinely different
 * distributions as an identical band (`2-3`) — and a fresh implementation
 * risks reintroducing them. See
 * `.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md`.
 *
 * A returned edge is one end of a percentile range and is NEVER a standard
 * deviation — Phase 7 D-01 reserves the `±` glyph for exactly one standard
 * deviation of full predictive variance, so no caller may label a value this
 * function returns with that glyph.
 *
 * `dist` is typed `ArrayLike<number>` rather than `readonly number[]`
 * deliberately: 08-03's per-team rank accumulator (`SimResult.rankHistograms`
 * values) is an `Int32Array`, and `ArrayLike` lets both it and a plain array
 * fixture pass through this function with no copy and no conversion at the
 * call site. `dist[i]` is the DRAW COUNT for rank `i + 1` — not a
 * probability.
 *
 * @param dist  Per-rank draw counts, index `i` holding the count for rank `i + 1`.
 * @param p     The target percentile in `[0, 1]` (e.g. `0.1` for the 10th percentile).
 * @param draws The total number of draws `dist` was accumulated over.
 * @returns     A continuous rank position bounded within `[0.5, dist.length + 0.5]`.
 */
export function continuousQuantile(dist: ArrayLike<number>, p: number, draws: number): number {
  const target = p * draws;
  let cum = 0;
  for (let i = 0; i < dist.length; i++) {
    // `noUncheckedIndexedAccess` makes this read `number | undefined`. An
    // explicit `undefined` check takes the same skip branch as a zero count,
    // rather than defaulting via `?? 0` or asserting via `as number` — this
    // repo has a standing rule against substituting a zero for an absent
    // value (07-08's T-07-08-13), and writing that substitution here would
    // put the forbidden shape into a file where a later reader cannot tell
    // "genuinely zero" and "absent" apart, even though the index is
    // provably in range for every real caller.
    const m = dist[i];
    if (m === undefined || m === 0) continue;
    if (cum + m >= target) {
      const frac = (target - cum) / m;
      return i + 1 - 0.5 + frac;
    }
    cum += m;
  }
  return dist.length + 0.5;
}
