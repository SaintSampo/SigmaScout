/**
 * The within-window detrended mid-rank percentile behind a published
 * per-robot consistency metric (SPR's `sigma` entry: value, percentile,
 * tier). Each eligible team's raw percentile is the mid-rank percentile of
 * its own OLS-detrended figure among the detrended figures of the teams in
 * its own rating window, so the tier answers "unusually consistent for a
 * robot of this rating" at every rating, not only in the interior.
 *
 * Replaces the difference-residual scheme (actual figure minus the window's
 * median figure), which normalized the LEVEL of the figure but not its
 * SPREAD, and the figure's spread grows with rating. Measured 2026-09-17
 * against live spr@4.0.0+baseline (n=3699 teams): published Legendary share
 * ran 1.9 percent in the bottom decile against 11.4 percent in decile 7, and
 * the top decile published 76.5 percent Common against a target 50 percent;
 * a clean recompute of that same old scheme (no measurement error involved)
 * still ran 1.1 to 20.8 percent Legendary across the deciles. Ranking a
 * team's OWN mid-rank position within its window fixes this by
 * construction: a mid-rank percentile is uniform across any window
 * regardless of that window's spread, which the difference residual never
 * was.
 *
 * Detrend, not raw rank: an interior window still has a real slope of
 * figure against rating across itself, so ranking the raw residual (figure
 * minus an OLS line fit over that one window) rather than the raw figure
 * keeps a window's OWN internal trend from dominating every rank inside it.
 * Ranking the residual, rather than publishing the fitted line, is what
 * makes the fit safe: a rank is invariant to a shift common to the whole
 * window, so one wild outlier moves the intercept without moving anybody's
 * rank but its own.
 *
 * Rating axis: the last-OFFICIAL-match Total (`officialMetricsByTeam`),
 * falling back to the season-final Total (`seasonFinalMetricsByTeam`) only
 * for a team with no official match at all, reusing `publish.ts`'s
 * `seasonStatsMetricsForTeam` precedent for that exact population rather
 * than inventing a second fallback rule. This is the Total the Teams page
 * actually prints beside the tier; ranking against a Total nobody can see
 * was the bug (32 of 62 sampled top-decile teams had played offseason,
 * median final-to-official Total ratio 0.72). The published Sigma VALUE
 * stays season-final (`layerForAlgo.sigmaScoreByTeam()`), so an
 * offseason-playing team's Sigma reflects matches its axis Total does not --
 * a pairing asymmetry recorded here, not hidden. An official-scoped Sigma
 * value would need a last-official Sigma snapshot taken during the layer
 * walk; that snapshot is not built by this module.
 *
 * Edge rule: the window for the team at sorted index `i` is symmetric about
 * `i` whenever the achievable half width reaches `SIGMA_WINDOW_MIN_HALF_WIDTH`;
 * a symmetric window is what lets a window's own linear trend cancel around
 * the team being ranked, which is exactly why the OLD clamped window was
 * biased -- the top 92 teams shared ONE clamped window and 64 to 78 of them
 * read Common. Below that floor a symmetric window is impossible, so the
 * smallest floor-sized window (11 teams) is taken and clipped inward
 * one-sidedly; the OLS detrend above is what keeps that one-sided window
 * from punishing the single highest-rated team in it, which is what lets
 * frc254 (Total 400, no offseason play) reach a tier other than Common.
 * Residual artifact, stated rather than glossed over: the top 5 and bottom 5
 * teams by rating still sit in a window that is not centred on them --
 * detrending removes the trend bias but not the asymmetry of which
 * neighbours they are compared against. That is 10 of about 3699 teams
 * against today's 184.
 */
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { goodnessPercentile, metricDirection } from "./metricDirection.js";
import { percentileRanks } from "./percentiles.js";

/**
 * The floor below which a symmetric window is impossible. Arithmetic, not a
 * second scheme: a window of `2 * 5 + 1 = 11` is the smallest whose best
 * member can clear the Legendary cut (`0.5 / 11 * 100 = 4.5`, inverted to
 * 95.5, above 95). A window of 9 tops out at 94.4 and could never publish
 * Legendary.
 */
export const SIGMA_WINDOW_MIN_HALF_WIDTH = 5;

/** Arithmetic mean of a value list. */
function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * The `[start, end)` slice of the sorted-by-rating pool (`n` teams total)
 * that team `i` is ranked inside. Symmetric about `i`
 * (`start = i - halfWidth`, `end = i + halfWidth + 1`) whenever
 * `halfWidth = min(halfWindow, i, n - 1 - i)` reaches
 * `SIGMA_WINDOW_MIN_HALF_WIDTH`. Below that floor a symmetric window would
 * be narrower than the floor allows, so the floor-sized window
 * (`min(n, 2 * SIGMA_WINDOW_MIN_HALF_WIDTH + 1)` = 11 teams, or the whole
 * pool if smaller) is taken instead and clipped inward -- shifted, not
 * shrunk, so it still contains `i` -- one-sidedly toward whichever edge `i`
 * is near. Exported so the edge rule is directly testable without a pool.
 */
export function sigmaWindowIndices(n: number, i: number, halfWindow: number): { start: number; end: number } {
  const halfWidth = Math.min(halfWindow, i, n - 1 - i);
  if (halfWidth >= SIGMA_WINDOW_MIN_HALF_WIDTH) {
    return { start: i - halfWidth, end: i + halfWidth + 1 };
  }
  const floorSize = Math.min(n, 2 * SIGMA_WINDOW_MIN_HALF_WIDTH + 1);
  let start = i - SIGMA_WINDOW_MIN_HALF_WIDTH;
  let end = start + floorSize; // exclusive
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > n) {
    start -= end - n;
    end = n;
  }
  start = Math.max(0, start);
  return { start, end };
}

/**
 * Each eligible team's RAW, direction-unaware within-window mid-rank
 * percentile: the mid-rank percentile of its own OLS-detrended figure among
 * the detrended figures of the teams in `sigmaWindowIndices`'s window for
 * its sorted position. Eligible means present in both `valueByTeam` and
 * `ratingByTeam`, matching the eligibility rule `sigmaMetricByTeam` has
 * always used.
 *
 * Cost: one sort of the window's residuals per team, `O(n * w log w)` --
 * roughly 5 million comparisons at the real pool size (about 3699 teams,
 * window width about 185), paid once per `(algorithm, season)`. Do not
 * micro-optimize this into a shared sorted structure; clarity and exact
 * reuse of `percentileRanks` matter more here than the constant factor.
 */
export function sigmaWindowRankByTeam(
  valueByTeam: ReadonlyMap<string, number>,
  ratingByTeam: ReadonlyMap<string, number>,
  teamKeys: readonly string[]
): Map<string, number> {
  const eligible = teamKeys.filter((teamKey) => valueByTeam.has(teamKey) && ratingByTeam.has(teamKey));
  // Tie break on teamKey is required, not cosmetic: window membership at
  // equal ratings decides percentiles, and a publish run must reproduce
  // byte for byte.
  const sortedByRating = [...eligible].sort((a, b) => {
    const diff = ratingByTeam.get(a)! - ratingByTeam.get(b)!;
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  const n = sortedByRating.length;
  const result = new Map<string, number>();
  if (n === 0) return result;

  const windowSize = Math.min(n, Math.max(25, Math.round(n / 20)));
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    const { start, end } = sigmaWindowIndices(n, i, halfWindow);
    const windowKeys = sortedByRating.slice(start, end);
    const windowRatings = windowKeys.map((teamKey) => ratingByTeam.get(teamKey)!);
    const windowValues = windowKeys.map((teamKey) => valueByTeam.get(teamKey)!);

    // OLS detrend over the window (see the file header): ranking residuals
    // rather than publishing the fitted value is what makes the fit safe,
    // since a rank is invariant to a shift common to the whole window.
    const xbar = mean(windowRatings);
    const ybar = mean(windowValues);
    let sxx = 0;
    let sxy = 0;
    for (let k = 0; k < windowRatings.length; k++) {
      const dx = windowRatings[k]! - xbar;
      sxx += dx * dx;
      sxy += dx * (windowValues[k]! - ybar);
    }
    // sxx === 0 means every rating in the window is identical: slope 0,
    // which ranks the raw values. Never divide by it.
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const residuals = windowValues.map((value, k) => value - (ybar + slope * (windowRatings[k]! - xbar)));

    const windowPercentiles = percentileRanks(residuals);
    // The window always contains i (sigmaWindowIndices shifts, never
    // shrinks, the floor-sized window to keep it in bounds), so this is a
    // safe, non-negative offset.
    const ownOffset = i - start;
    result.set(sortedByRating[i]!, windowPercentiles[ownOffset]!);
  }
  return result;
}

/** One team's published consistency entry — the RAW figure and the inverted residual percentile. No other keys. */
export interface SigmaMetricEntry {
  value: number;
  percentile: number;
}

/**
 * Computes a published consistency metric for every eligible team in
 * `teamKeys`, ONCE per `(algorithm, season)` — callers feed this same result
 * to both the teams row and the team-season artifact so the two cannot
 * disagree. A team missing either a figure or a rating gets no entry, never
 * a coerced zero. The pool is exactly `teamKeys`, never
 * `Object.keys(metricsByTeam)`. Nothing is rounded here: `buildTeamsArtifact`
 * / `buildTeamSeasonArtifact` own the single rounding boundary.
 */
export function sigmaMetricByTeam(params: {
  valueByTeam: ReadonlyMap<string, number>;
  /** The rating axis, primary: last-official-match Totals. See the file header's D-2. */
  officialMetricsByTeam: TeamMetrics;
  /** The rating axis, fallback: season-final Totals, used only for a team absent from `officialMetricsByTeam`. */
  seasonFinalMetricsByTeam: TeamMetrics;
  teamKeys: readonly string[];
  /** Which metric key's declared direction to apply. Required, no default. */
  metricKey: string;
}): Record<string, SigmaMetricEntry> {
  const { valueByTeam, officialMetricsByTeam, seasonFinalMetricsByTeam, teamKeys, metricKey } = params;

  const ratingByTeam = new Map<string, number>();
  for (const teamKey of teamKeys) {
    const officialTotal = officialMetricsByTeam[teamKey]?.[TOTAL_METRIC_KEY]?.value;
    const total = officialTotal ?? seasonFinalMetricsByTeam[teamKey]?.[TOTAL_METRIC_KEY]?.value;
    if (total !== undefined) ratingByTeam.set(teamKey, total);
  }

  const eligible = teamKeys.filter((teamKey) => valueByTeam.has(teamKey) && ratingByTeam.has(teamKey));
  const result: Record<string, SigmaMetricEntry> = {};
  if (eligible.length === 0) return result;

  const rawPercentiles = sigmaWindowRankByTeam(valueByTeam, ratingByTeam, eligible);

  // Strict accessor: an unknown key means the registry lost its own entry,
  // a defect worth crashing on rather than degrading past.
  const direction = metricDirection(metricKey);

  for (const teamKey of eligible) {
    result[teamKey] = {
      value: valueByTeam.get(teamKey)!,
      percentile: goodnessPercentile(rawPercentiles.get(teamKey)!, direction),
    };
  }
  return result;
}
