/**
 * Pure, network-free, corpus-free statistics for quick task 260904-4aa
 * (SC-2: "EPA runs walk-forward at any point in a season, and spot-checked
 * teams land within a documented tolerance of published Statbotics
 * numbers"). This module holds the arithmetic only — no `fetch`, no
 * `node:fs`, no corpus import — so every function here is testable with
 * hand-computed synthetic fixtures and no network access or 460MB SQLite
 * file. `scripts/epaVsStatbotics.ts` is the impure driver that gathers real
 * `ours`/`theirs` series (via a walk-forward replay and a live Statbotics
 * fetch, respectively) and calls into this module to score them.
 *
 * `isDemoTeamKey`/`DEMO_PSEUDO_TEAM_KEY` (`core/algorithms/demoTeams.js`)
 * and `mulberry32` (`core/algorithms/simulation/rankSimulation.js`) are both
 * dependency-free leaves under `packages/core/` — importing them does not
 * pull in the corpus, `node:fs`, or anything that fetches, so this module's
 * "pure" contract holds.
 */
import { isDemoTeamKey, DEMO_PSEUDO_TEAM_KEY } from "../core/algorithms/demoTeams.js";
import { mulberry32 } from "../core/algorithms/simulation/rankSimulation.js";

export class EmptyJoinError extends Error {
  constructor(reason: string) {
    super(`compareSeason: ${reason}`);
    this.name = "EmptyJoinError";
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function assertPaired(a: readonly number[], b: readonly number[], fnName: string): void {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`${fnName}: both series must be equal-length and non-empty (got ${a.length} and ${b.length})`);
  }
}

/**
 * Ordinary-least-squares slope regressing `ours` (dependent, y) on `theirs`
 * (independent, x): `ours ≈ intercept + slope * theirs`. This direction —
 * not the reverse — is the one `epa.ts`'s file header already cites ("OLS
 * slope vs Statbotics 0.489 -> 0.841"): a slope below 1 means our values are
 * compressed relative to Statbotics' own scale, which is exactly what that
 * header's six documented deliberate divergences predict. Fixture: given
 * `theirs = 2 * ours + 3`, solving for `ours` yields
 * `ours = 0.5 * theirs - 1.5`, so this function returns `0.5` on that input
 * — the coefficient of `theirs`, not of `ours`.
 */
export function ordinaryLeastSquaresSlope(ours: readonly number[], theirs: readonly number[]): number {
  assertPaired(ours, theirs, "ordinaryLeastSquaresSlope");
  const meanOurs = mean(ours);
  const meanTheirs = mean(theirs);
  let covariance = 0;
  let varianceTheirs = 0;
  for (let i = 0; i < ours.length; i++) {
    const dx = theirs[i]! - meanTheirs;
    const dy = ours[i]! - meanOurs;
    covariance += dx * dy;
    varianceTheirs += dx * dx;
  }
  return covariance / varianceTheirs;
}

/** Pearson correlation coefficient. Symmetric in its two arguments — direction does not matter here, unlike `ordinaryLeastSquaresSlope`. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  assertPaired(xs, ys, "pearson");
  const meanX = mean(xs);
  const meanY = mean(ys);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  return numerator / Math.sqrt(denomX * denomY);
}

/** `mean(|ours[i] - theirs[i]|)`, in the same point units as both series. */
export function meanAbsoluteDifference(ours: readonly number[], theirs: readonly number[]): number {
  assertPaired(ours, theirs, "meanAbsoluteDifference");
  let total = 0;
  for (let i = 0; i < ours.length; i++) total += Math.abs(ours[i]! - theirs[i]!);
  return total / ours.length;
}

/** Sample standard deviation (Bessel-corrected, `n - 1` denominator). Returns `undefined` for fewer than 2 observations — a spread over 0 or 1 points is not a measurement. */
export function sampleStandardDeviation(values: readonly number[]): number | undefined {
  if (values.length < 2) return undefined;
  const m = mean(values);
  const sumSquares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

/** One team's own comparable value (our side), before joining. */
export interface OurTeamValue {
  readonly teamKey: string;
  readonly value: number;
}

/** One team's Statbotics-side row, before joining. */
export interface TheirTeamRow {
  readonly teamKey: string;
  readonly value: number;
  /** Statbotics `record.count` — this team's played-match count, used for `joinTeams`' `minMatches` filter. */
  readonly matchCount: number;
}

/** One team surviving the join — both sides' comparable values, side by side. */
export interface TeamPair {
  readonly teamKey: string;
  readonly ours: number;
  readonly theirs: number;
  readonly theirMatchCount: number;
}

export interface JoinResult {
  /** Count on our side after demo-key exclusion, before the join — a coverage figure, not the joined count. */
  readonly ourCount: number;
  /** Count on Statbotics' side after demo-key exclusion and any `minMatches` filter, before the join. */
  readonly theirCount: number;
  readonly joinedCount: number;
  readonly pairs: readonly TeamPair[];
}

function isComparableTeamKey(teamKey: string): boolean {
  return !isDemoTeamKey(teamKey) && teamKey !== DEMO_PSEUDO_TEAM_KEY;
}

/**
 * Inner-joins `ours` and `theirs` on `teamKey`. Drops demo keys (raw
 * `frc9970`-`frc9999` and the shared pseudo key `demo-pseudo-unregistered`)
 * from BOTH sides before the join runs, and drops any key present on only
 * one side. `minMatches`, when supplied, additionally requires a team's
 * Statbotics `matchCount` to meet the threshold to survive — applied to
 * `theirs` before the join, since `matchCount` is a Statbotics-side field.
 */
export function joinTeams(ours: readonly OurTeamValue[], theirs: readonly TheirTeamRow[], minMatches?: number): JoinResult {
  const ourFiltered = ours.filter((o) => isComparableTeamKey(o.teamKey));
  const theirFiltered = theirs
    .filter((t) => isComparableTeamKey(t.teamKey))
    .filter((t) => minMatches === undefined || t.matchCount >= minMatches);

  const ourByKey = new Map(ourFiltered.map((o) => [o.teamKey, o.value]));
  const pairs: TeamPair[] = [];
  for (const their of theirFiltered) {
    const ourValue = ourByKey.get(their.teamKey);
    if (ourValue === undefined) continue;
    pairs.push({ teamKey: their.teamKey, ours: ourValue, theirs: their.value, theirMatchCount: their.matchCount });
  }

  return {
    ourCount: ourFiltered.length,
    theirCount: theirFiltered.length,
    joinedCount: pairs.length,
    pairs,
  };
}

export interface CompareSeasonOptions {
  readonly minMatches?: number;
}

export interface SeasonComparison {
  readonly season: number;
  readonly minMatches?: number;
  readonly ourCount: number;
  readonly theirCount: number;
  readonly joinedCount: number;
  readonly ordinaryLeastSquaresSlope: number;
  readonly pearson: number;
  readonly meanAbsoluteDifference: number;
  readonly ourStandardDeviation: number | undefined;
  readonly theirStandardDeviation: number | undefined;
  readonly pairs: readonly TeamPair[];
}

/**
 * Composes `joinTeams` + the four statistics above into one result object
 * for a season. Throws `EmptyJoinError` on an empty join rather than
 * returning vacuous perfect agreement (an OLS slope / Pearson over zero
 * pairs is undefined, not "1.0").
 */
export function compareSeason(
  season: number,
  ours: readonly OurTeamValue[],
  theirs: readonly TheirTeamRow[],
  options: CompareSeasonOptions = {}
): SeasonComparison {
  const join = joinTeams(ours, theirs, options.minMatches);
  if (join.joinedCount === 0) {
    throw new EmptyJoinError(
      `season ${season} joined zero teams (minMatches=${options.minMatches ?? "none"}, ourCount=${join.ourCount}, theirCount=${join.theirCount})`
    );
  }
  const ourValues = join.pairs.map((p) => p.ours);
  const theirValues = join.pairs.map((p) => p.theirs);
  return {
    season,
    minMatches: options.minMatches,
    ourCount: join.ourCount,
    theirCount: join.theirCount,
    joinedCount: join.joinedCount,
    ordinaryLeastSquaresSlope: ordinaryLeastSquaresSlope(ourValues, theirValues),
    pearson: pearson(ourValues, theirValues),
    meanAbsoluteDifference: meanAbsoluteDifference(ourValues, theirValues),
    ourStandardDeviation: sampleStandardDeviation(ourValues),
    theirStandardDeviation: sampleStandardDeviation(theirValues),
    pairs: join.pairs,
  };
}

export interface ToleranceBand {
  readonly min: number;
  readonly max: number;
}

export interface ToleranceViolation {
  readonly statistic: string;
  readonly value: number;
  readonly band: ToleranceBand;
}

/**
 * Returns the list of statistics in `measured` that fall outside their
 * `bands` entry (inclusive bounds), and an empty list when every supplied
 * statistic is inside its band. A band naming a statistic absent from
 * `measured` is itself reported as a violation (value `NaN`) rather than
 * silently skipped — a missing measurement is not the same as an in-range one.
 */
export function checkAgainstTolerance(
  measured: Readonly<Record<string, number>>,
  bands: Readonly<Record<string, ToleranceBand>>
): ToleranceViolation[] {
  const violations: ToleranceViolation[] = [];
  for (const [statistic, band] of Object.entries(bands)) {
    const value = measured[statistic];
    if (value === undefined) {
      violations.push({ statistic, value: Number.NaN, band });
      continue;
    }
    if (value < band.min || value > band.max) {
      violations.push({ statistic, value, band });
    }
  }
  return violations;
}

export interface SpotCheckOptions {
  readonly seed: number;
  readonly topCount?: number;
  readonly sampleCount?: number;
}

/**
 * SC-2's "spot-checked teams" — the top `topCount` (default 15) teams by
 * Statbotics value, plus a deterministic sample of `sampleCount` (default
 * 15) more drawn from the remainder via a fixed-seed Fisher-Yates shuffle
 * (`mulberry32`, the same PRNG `scripts/measureRewindGap.ts` already uses),
 * so re-running this script prints the identical named rows every time.
 */
export function selectSpotCheckTeams(pairs: readonly TeamPair[], options: SpotCheckOptions): TeamPair[] {
  const topCount = options.topCount ?? 15;
  const sampleCount = options.sampleCount ?? 15;

  const sortedByTheirs = [...pairs].sort((a, b) => b.theirs - a.theirs);
  const top = sortedByTheirs.slice(0, topCount);
  const topKeys = new Set(top.map((p) => p.teamKey));
  const remaining = pairs.filter((p) => !topKeys.has(p.teamKey));

  const rng = mulberry32(options.seed);
  const shuffled = [...remaining];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  return [...top, ...shuffled.slice(0, sampleCount)];
}
