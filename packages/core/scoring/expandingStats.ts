/**
 * Expanding-window (Welford) mean/variance (RESEARCH.md Pitfall EPA-1,
 * Code Examples). This is the walk-forward-safe replacement for a
 * season-final `score_sd` constant: `standardDeviation()` after folding the
 * first k observations can never be changed by folding observation k+1..n —
 * it is leak-proof by construction, since it only ever incorporates
 * observations already passed to `foldObservation`, never observations from
 * later in the stream.
 *
 * Boundary contracts this module makes explicit:
 *
 *   - `standardDeviation` is mathematically undefined for `count < 2` (a
 *     single observation has no variance to report). Rather than returning
 *     `0` (a false claim of perfect certainty) or `NaN` (which does not
 *     survive `JSON.stringify` and silently poisons downstream arithmetic),
 *     the caller supplies a `fallback` — e.g. a documented prior or the
 *     prior season's final value at season start (ties into D-16's
 *     carryover machinery).
 *   - `foldObservation` never mutates its input; it returns a new
 *     `ExpandingStats`, matching this project's immutable-state-update
 *     discipline (see `opr.ts`'s file header).
 *   - Pure functions only, no classes, no imports outside this module — the
 *     same shape as `brier.ts`/`calibration.ts`.
 */

export interface ExpandingStats {
  readonly count: number;
  readonly mean: number;
  /** Sum of squared deviations from the running mean (Welford's M2). */
  readonly m2: number;
}

const EMPTY_STATS: ExpandingStats = { count: 0, mean: 0, m2: 0 };

export function emptyExpandingStats(): ExpandingStats {
  return EMPTY_STATS;
}

/** Folds one new observation into `stats` via Welford's online algorithm. Does not mutate `stats`. */
export function foldObservation(stats: ExpandingStats, x: number): ExpandingStats {
  const count = stats.count + 1;
  const delta = x - stats.mean;
  const mean = stats.mean + delta / count;
  const delta2 = x - mean;
  const m2 = stats.m2 + delta * delta2;
  return { count, mean, m2 };
}

/**
 * Population standard deviation of every observation folded so far. Returns
 * `fallback` when `count < 2` (see file header) rather than `0` or `NaN`.
 */
export function standardDeviation(stats: ExpandingStats, fallback: number): number {
  if (stats.count < 2) return fallback;
  return Math.sqrt(stats.m2 / stats.count);
}

/**
 * Restarts an accumulator at a new regime boundary, keeping the old regime's
 * mean/SD as a PRIOR of `pseudoCount` observations rather than carrying its
 * real observation count forward.
 *
 * This exists because carrying `stats` across such a boundary unchanged is
 * not a "seed" at all — a seed is supposed to fade as the new regime's own
 * data arrives, and it cannot fade while the old regime's observation count
 * comes with it. Quick task 260910-4x0 measured what that costs: EPA's
 * win-probability denominator had pooled every alliance score since 2016, so
 * by 2024 the season's own 44,198 observations were 15.7% of a 282,192-strong
 * accumulator and could never outvote it. The denominator read 106.4 where
 * 2024's own scale was 27.2, flattening the logistic ~3.9x and pushing 88.7%
 * of that season's predictions into [0.4, 0.6].
 *
 * `pseudoCount` is the seed's strength in observations. After the new regime
 * has folded roughly `pseudoCount` of its own, its data dominates. Below 2
 * observations there is no prior SD to carry (`standardDeviation`'s own
 * contract), so the input is returned untouched and the caller's `fallback`
 * keeps applying.
 */
export function reseedFromPrior(stats: ExpandingStats, pseudoCount: number): ExpandingStats {
  if (stats.count < 2 || pseudoCount < 2) return stats;
  const variance = stats.m2 / stats.count;
  // m2 is recovered from the target variance at the pseudo-count, so
  // `standardDeviation` reads back exactly the prior regime's SD while the
  // count — the thing that decides how fast new data wins — is reset.
  return { count: pseudoCount, mean: stats.mean, m2: variance * pseudoCount };
}
