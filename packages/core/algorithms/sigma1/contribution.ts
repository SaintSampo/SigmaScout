/**
 * D-D3/D-D4(b) (quick task 260902-disp): the per-match INFERRED CONTRIBUTION
 * series behind every published `±`, accumulated online by Welford.
 *
 * A Node-free, dependency-free leaf in the same spirit as `consistency.ts`.
 * `sigma1/index.ts`'s `applyAllianceUpdate` folds; its `teamMetrics` reads.
 * Nothing else may.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE NUMBER IS
 * ---------------------------------------------------------------------------
 *
 * For a rating-eligible team `t` on an alliance of `n` rating-eligible
 * teammates, for component `c` of one match:
 *
 *     contribution(t, c) = mean_c^pre(t) + innovation_c / n
 *
 * where `mean_c^pre(t)` is that team's belief mean for `c` BEFORE
 * `updateAllianceSum` runs, and `innovation_c = observedSum_c - sum of the
 * teammates' pre-update means`. The TOTAL contribution is the sum over
 * components; a phase group's is the sum over that group's own components.
 *
 * It is an IDENTITY, not an attribution guess:
 *
 *     sum over teams of contribution(t, c)
 *       = sum of means + innovation_c
 *       = observedSum_c
 *
 * The teammates' contributions add up EXACTLY to what the alliance actually
 * put on the board. `sigma1.test.ts`'s "per-match contribution (D-D3)" block
 * pins that on both alliances, with a non-vacuity control.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CAVEAT — this number is MODEL-INFERRED, never measured
 * ---------------------------------------------------------------------------
 *
 * FRC records no individual robot's score. TBA publishes alliance totals and
 * alliance-level breakdowns only (this project's Assumption A1), so there is
 * no observed per-robot series anywhere to compare this against, and no way to
 * remove a partner's share from it.
 *
 * Because the split of the innovation is EQUAL across teammates — the same
 * split `applyAllianceUpdate`'s own R estimator (`max(0, innovation^2 - sumP)
 * / n`) and `breakdown/fallback.ts`'s `distributeResidual` already commit to,
 * so this module invents no second attribution rule — a team's series absorbs
 * its PARTNERS' variability as well as its own. That is unavoidable given the
 * observation model and it must never be papered over: every place this number
 * surfaces has to say it is inferred. It is still a far better answer to "how
 * reliable is this robot" than the filter's uncertainty about its own mean,
 * which is what the site published before D-D1 reversed it.
 *
 * ---------------------------------------------------------------------------
 * WELFORD, NOT (sum, sumSq)
 * ---------------------------------------------------------------------------
 *
 * The accumulator, not the raw series, lives in state — `stateSnapshot.ts`
 * serializes each team into one D1 row and throws `SeedRowTooLargeError` above
 * 90,000 bytes, and a 292-match team's 292x13 contribution matrix is ~84 KB on
 * top of an existing ~10 KB row. Three numbers per published metric key is
 * ~800 bytes per team instead.
 *
 * Given that the series is summarized rather than stored, HOW it is summarized
 * decides whether the published figure is real. A `(sum, sumSq)` pair loses
 * the answer to cancellation exactly where this feature is most interesting: a
 * steady robot scoring around 50 with a true spread near 0.5 gives
 * `sumSq ~ n * 2500` and a difference four orders of magnitude smaller, so the
 * published number would be noise in its last digits precisely for the teams
 * the feature exists to identify. Welford never forms that difference.
 * `contribution.test.ts` measures this rather than asserting it.
 *
 * ---------------------------------------------------------------------------
 * n - 1, AND THE DEGENERATE RULE IN FULL
 * ---------------------------------------------------------------------------
 *
 * `contributionSpread` is the SAMPLE standard deviation, `n - 1`. D-D4(b)'s
 * own words are "computed the way a human would compute it": `STDEV` in every
 * spreadsheet is the `n - 1` form, and it is the unbiased estimator of the
 * variance. A checker reproducing the number by hand gets the published
 * figure; with `n` they would not.
 *
 * The whole degenerate rule is one predicate:
 *
 *   - fewer than 2 folded values -> `undefined`, and `teamMetrics` OMITS the
 *     `spread` key entirely. Not because a one-match spread is embarrassing,
 *     but because a standard deviation over fewer than two points DOES NOT
 *     EXIST and `0 / 0` is not an answer.
 *   - 2 or more -> the plain sample standard deviation as computed, INCLUDING
 *     exactly `0` when a team's matches happen to match. That IS the sample
 *     standard deviation of `[50, 50]`, and a reader can see `matchCount`
 *     beside it.
 *
 * THERE IS NO FLOOR, NO MINIMUM-MATCH CONSTANT, NO SHRINKAGE AND NO LEAGUE
 * BLENDING ANYWHERE IN THIS MODULE, and none may be added. The user withdrew
 * the floor question deliberately (2026-09-02): "I really dont mind if the
 * model takes a few matches to make sense. humans reading the website will see
 * a team has only played a few matches, and will understand. I would rather
 * keep things simple." Adding a league-average blend back would reintroduce
 * D-D2 — the defect where roughly 40% of a 12-match team's displayed spread
 * was the AVERAGE robot rather than that robot — under a different name.
 * Adding a floor would publish a number no series produces, which is the exact
 * self-inconsistency D-D4(b) chose design (b) to avoid.
 */

/**
 * One metric key's running contribution series, summarized by Welford:
 * `count` folded values, their running `mean`, and `m2`, the running sum of
 * squared deviations from that mean.
 *
 * `count` is kept HERE rather than derived from `Sigma1TeamState.matchCount`
 * even though the two are equal for `TOTAL_METRIC_KEY` today. One number buys
 * a self-contained, independently testable value and removes an invariant a
 * future edit could quietly break — and the phase-group accumulators genuinely
 * CAN diverge from `matchCount`, since a group whose components are all absent
 * from `componentOrder` never folds at all.
 */
export interface ContributionAccumulator {
  readonly count: number;
  readonly mean: number;
  readonly m2: number;
}

export function emptyContributionAccumulator(): ContributionAccumulator {
  return { count: 0, mean: 0, m2: 0 };
}

/**
 * Textbook Welford. Returns a NEW accumulator; never mutates its input — the
 * same immutability contract every other Sigma1 state helper keeps, so a fold
 * can never retroactively change a state snapshot someone else is holding.
 */
export function foldContribution(acc: ContributionAccumulator, value: number): ContributionAccumulator {
  const count = acc.count + 1;
  const delta = value - acc.mean;
  const mean = acc.mean + delta / count;
  const m2 = acc.m2 + delta * (value - mean);
  return { count, mean, m2 };
}

/**
 * The published `±`: the sample (`n - 1`) standard deviation of this
 * accumulator's own series, or `undefined` when fewer than two values have
 * been folded. See this module's header for why `n - 1`, why `undefined`
 * rather than `0` below two points, and why an exact `0` at two identical
 * points is published as computed.
 */
export function contributionSpread(acc: ContributionAccumulator): number | undefined {
  if (acc.count < 2) return undefined;
  return Math.sqrt(acc.m2 / (acc.count - 1));
}
