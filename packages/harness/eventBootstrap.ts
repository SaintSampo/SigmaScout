/**
 * D-T6's event-blocked bootstrap (quick task 260901-trz), as ONE tested,
 * exported helper so no call site rolls its own resampler.
 *
 * Why blocking by event and not by match. Matches inside one event share
 * teams, a field, a game state and a day's officiating. Resampling MATCHES
 * independently pretends those are independent draws and therefore
 * understates every interval it produces. Measured on the tune pool (47,851
 * matches across 561 events, D-T6): match-level bootstrap SE **0.000896**,
 * event-blocked SE **0.001219** — the naive figure is 40% too small. An
 * acceptance bar built on the naive number would accept candidates that are
 * indistinguishable from resampling noise, which is exactly the failure this
 * project's log records once already.
 *
 * Deliberately lives in `packages/harness`, not `packages/core` — this is a
 * TUNING/EVALUATION concern, and `packages/core` must stay free of anything
 * that is not Worker-importable prediction logic (the same argument
 * `searchSpace.ts`'s own header makes for search bounds).
 *
 * ## The generic `statistic` parameter IS the design
 *
 * The same resampler produces two DIFFERENT standard errors, and the
 * distinction decides whether an acceptance rule is honest:
 *
 *   - **LEVEL SE** — `statistic = mean Brier of one model`. This is the
 *     0.001219 figure D-T6 quotes and the one to attach to a published
 *     interval around a single model's score.
 *   - **PAIRED-DIFFERENCE SE** — `statistic = mean of per-match
 *     (candidateBrier - incumbentBrier)`, both models scored on the SAME
 *     resampled events. This is what D-T7's acceptance bar actually governs:
 *     the bar is on a DIFFERENCE, so the paired SE is the faithful quantity.
 *     It is materially TIGHTER than either side's level SE, because the two
 *     models see the same matches and the shared match-difficulty variance
 *     cancels inside the difference before the resampling ever happens.
 *
 * Using a level SE where a paired SE belongs sets the bar far too high and
 * rejects real improvements; using a paired SE where a level SE belongs
 * publishes an interval that is too narrow. Both remain computable here on
 * purpose, and D-T7's rule takes the PAIRED one.
 */

/** The minimum a unit must carry for this module to block it: the event it belongs to. Any richer per-match record (a scored prediction, a paired Brier difference) structurally satisfies this. */
export interface EventBlockedUnit {
  readonly eventKey: string;
}

/** A resampled interval, reported with enough context that a reader can tell what was actually resampled. */
export interface EventBootstrapResult {
  /** `statistic` applied ONCE to the full, unresampled `units` — the value the standard error below is an uncertainty about. */
  readonly pointEstimate: number;
  /** Sample standard deviation of the resampled statistics — the event-blocked standard error. */
  readonly standardError: number;
  readonly resamples: number;
  /** Number of DISTINCT event blocks (the effective sample size, not `matchCount`). */
  readonly eventCount: number;
  readonly matchCount: number;
  readonly seed: number;
  /** The 2.5/97.5 percentiles of the resampled statistics — the percentile interval, reported alongside the SE rather than instead of it. */
  readonly percentile: { readonly lower: number; readonly upper: number };
}

/**
 * 2000 resamples. At B resamples the Monte Carlo error on the reported
 * STANDARD ERROR is roughly `1 / sqrt(2B)` of that standard error — about
 * 1.6% here. The quantity this helper exists to keep apart is the ~36% gap
 * between the event-blocked and match-level figures (0.001219 vs 0.000896,
 * D-T6), so 1.6% is an order of magnitude below the smallest difference that
 * has to be readable. More resamples would buy resolution nothing consumes;
 * fewer would put the resampler's own noise within sight of the effect.
 */
export const DEFAULT_EVENT_BOOTSTRAP_RESAMPLES = 2000;

/**
 * Default seed 42, matching `DEFAULT_SIGMA1_PARAMS.rpMonteCarloSeed`'s own
 * default — one arbitrary-but-fixed seed across the project rather than a
 * second arbitrary constant to remember.
 */
export const DEFAULT_EVENT_BOOTSTRAP_SEED = 42;

export interface EventBootstrapOptions {
  readonly resamples?: number;
  readonly seed?: number;
}

/**
 * Deterministic PRNG (Mulberry32), the same construction
 * `packages/harness/identifiability.ts`'s `mulberry32`,
 * `packages/harness/tune.ts`'s private copy, and
 * `packages/core/algorithms/sigma1/rp/distribution.ts`'s copy all use, cited
 * there to the same source. Copied rather than imported: `identifiability.ts`
 * is a standalone diagnostic script whose module body does real work on
 * import, and `rp/distribution.ts` is Worker-path prediction code — reaching
 * into either from here for four lines would create an import edge this
 * module has no other reason to have. The duplication is deliberate and is
 * the same one `rp/state.ts`'s header already documents accepting for
 * `rpTeammateGains`.
 */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample (n-1 denominator) standard deviation — the bootstrap SE is the sample SD of the resampled statistics, not the population SD. */
function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sumSquares = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

/**
 * Linear-interpolated percentile of an ALREADY-SORTED ascending array. The
 * plain nearest-rank alternative would quantize the reported interval to
 * 1/2000 of the resample distribution, which is visible at the third
 * significant figure of a 0.0012-scale standard error.
 */
function percentileOfSorted(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const position = fraction * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex]!;
  const weight = position - lowerIndex;
  return sorted[lowerIndex]! * (1 - weight) + sorted[upperIndex]! * weight;
}

/**
 * Resamples EVENT BLOCKS with replacement and applies `statistic` to each
 * resampled pool.
 *
 * Blocks are formed by grouping `units` on `eventKey` in FIRST-APPEARANCE
 * order (never a sort, and never a `Set` iteration whose order is incidental)
 * — so a caller replaying a chronological stream gets blocks in chronological
 * first-touch order, and two runs over the same stream draw the identical
 * blocks for the identical seed. Each of the `resamples` iterations draws
 * `eventCount` blocks with replacement and concatenates their member units;
 * `statistic` sees a pool of the same expected size as the original, made of
 * whole events.
 *
 * Throws for fewer than 2 distinct event blocks. A bootstrap over ONE block
 * resamples that same block every time, so every resampled statistic is
 * identical and the reported standard error is exactly 0 — a false claim of
 * perfect certainty, which is worse than no measurement at all. This is a
 * refusal to measure, not a defensive guard.
 */
export function eventBlockedBootstrap<T extends EventBlockedUnit>(
  units: readonly T[],
  statistic: (sample: readonly T[]) => number,
  options: EventBootstrapOptions = {}
): EventBootstrapResult {
  const resamples = options.resamples ?? DEFAULT_EVENT_BOOTSTRAP_RESAMPLES;
  const seed = options.seed ?? DEFAULT_EVENT_BOOTSTRAP_SEED;
  if (!Number.isInteger(resamples) || resamples < 2) {
    throw new Error(`eventBlockedBootstrap: resamples must be an integer >= 2, got ${resamples}`);
  }

  // First-appearance grouping. `Map` preserves insertion order by spec, so
  // this is a guarantee rather than an implementation detail.
  const blocksByEvent = new Map<string, T[]>();
  for (const unit of units) {
    const existing = blocksByEvent.get(unit.eventKey);
    if (existing) existing.push(unit);
    else blocksByEvent.set(unit.eventKey, [unit]);
  }

  const blocks = [...blocksByEvent.values()];
  const eventCount = blocks.length;
  if (eventCount < 2) {
    throw new Error(
      `eventBlockedBootstrap: needs at least 2 distinct event blocks to report a standard error, got ${eventCount} — ` +
        `a bootstrap over a single block reports an SE of exactly 0, which is a false claim of certainty rather than a measurement`
    );
  }

  const pointEstimate = statistic(units);

  const rng = mulberry32(seed);
  const resampled: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const pool: T[] = [];
    for (let b = 0; b < eventCount; b++) {
      const index = Math.floor(rng() * eventCount);
      // `rng()` is [0, 1), so `index` is already in range; the clamp guards
      // only the exact-1.0 case a future PRNG substitution could introduce.
      const block = blocks[index < eventCount ? index : eventCount - 1]!;
      for (const unit of block) pool.push(unit);
    }
    resampled.push(statistic(pool));
  }

  const sorted = [...resampled].sort((a, b) => a - b);

  return {
    pointEstimate,
    standardError: sampleStandardDeviation(resampled),
    resamples,
    eventCount,
    matchCount: units.length,
    seed,
    percentile: { lower: percentileOfSorted(sorted, 0.025), upper: percentileOfSorted(sorted, 0.975) },
  };
}
