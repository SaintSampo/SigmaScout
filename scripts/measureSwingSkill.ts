/**
 * Measures the SHIPPED Swing Factor estimator's actual predictive skill.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 *
 * `swingFactor.ts`'s header quotes `r ~= 0.59`, and that number is a CEILING,
 * not an achievement: it is the best correlation ANY estimator of that shape
 * could reach against a team's next-match deviation, swept over 275,172
 * team-matches. It was measured against the PRE-CENTRING, about-zero estimator
 * (`sigma1/swing.ts`, quick task 260903-750).
 *
 * Everything that defines today's estimator landed afterwards: centring on the
 * team's own running mean, the below-two-observations rule, the demo and
 * full-DQ-zero exemptions, and the collapse onto West's incremental form. Until
 * this script, nobody had measured how close the shipped estimator gets to that
 * ceiling, and `scripts/` held no harness that could.
 *
 * Swing is load-bearing for TWO surfaces — the team tile/column and every match
 * band on the site, since `*SwingBandVariance` is the only band source now — so
 * this was a published number with no evaluation harness, which is the failure
 * this project's log names as its original sin.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT, AND WHY IT IS WALK-FORWARD BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * A `SwingFactorAccumulator` is driven by hand so the estimate can be READ
 * BEFORE each match is folded — the same predict-before-update discipline
 * `SigmaScoutLayer.foldPlayed` uses. For one team in one match:
 *
 *     dev        = (actualAllianceScore - predictedAllianceScore) / rosterSize
 *     runningMean = belief.mean          // recency-weighted over matches 1..N-1
 *     centredDev  = dev - runningMean    // what Swing actually claims to predict
 *     swing       = swingFor(team)       // also matches 1..N-1 only
 *
 * `centredDev` is the target rather than `dev` because centring is the whole
 * point of the estimator: a model that misses a team by a CONSTANT has produced
 * no evidence of swing, and scoring against uncentred `dev` would grade Swing on
 * a bias it deliberately refuses to model. Both are reported anyway, because the
 * difference between them IS the bias, and that is worth seeing.
 *
 * OBSERVATION GATING MIRRORS THE ESTIMATOR EXACTLY. The same
 * `isFullyDemoAlliance` / `isFullyDqZeroScoreAlliance` predicates `foldMatch`
 * applies are applied to RECORDING too. Scoring the estimator on rows it was
 * never allowed to learn from would be measuring a different estimator.
 *
 * ---------------------------------------------------------------------------
 * WHY A BASELINE AND A REFERENCE, NOT JUST A CORRELATION
 * ---------------------------------------------------------------------------
 *
 * A correlation says the estimator ranks teams in roughly the right order. It
 * does NOT say the estimator beats a single constant, and "better than one
 * number for the whole population" is the bar a per-team quantity has to clear
 * to justify existing. A correlation also cannot be computed for a constant
 * (its variance is zero), so the comparison needs a proper scoring rule.
 *
 * Gaussian negative log-likelihood of `centredDev` under `sigma = swing / SCALE`
 * is that rule. It punishes over- and under-confidence both, and a constant can
 * compete in it. Three estimators are scored on identical rows:
 *
 *   1. SHIPPED           sigma = swing / SWING_FACTOR_SCALE
 *   2. POPULATION BASELINE  sigma = walk-forward pooled RMS of every centred
 *      deviation seen so far. One number, no per-team information. The
 *      "better than nothing" bar.
 *   3. PER-TEAM HINDSIGHT REFERENCE  sigma = that team's own FULL-SEASON RMS
 *      centred deviation. It USES THE FUTURE, so it is not a candidate — but it
 *      is NOT an upper bound either, and that surprised this script's author.
 *      The baseline sigma varies across the season while this reference is one
 *      constant per team, so neither model class contains the other and the
 *      reference measurably LOSES to the baseline for EPA and BPR. Where that
 *      happens it says the remaining signal lives in season-phase variation
 *      more than in per-team variation.
 *
 * Usage:
 *   npx tsx scripts/measureSwingSkill.ts [--seasons 2024-2026] [--algorithms opr,epa,bpr] [--include-offseason]
 *   pnpm measure:swing-skill
 */

import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { SwingFactorAccumulator, SWING_FACTOR_SCALE } from "../packages/harness/swingFactor.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";

const CORPUS_PATH = "data/corpus.sqlite";

/**
 * The ceiling `swingFactor.ts` quotes. Reproduced here as a REFERENCE LINE to
 * print beside the achieved figures, never as a threshold anything passes or
 * fails: it was swept against a different (pre-centring) estimator, so it is
 * context, not a gate.
 */
const CEILING_R = 0.59;

/** The coverage a "one standard deviation" claim implies. */
const GAUSSIAN_1SIGMA_COVERAGE = 0.683;

/**
 * One team's paired (estimate, outcome) for one match. Every field is as-of
 * BEFORE the match was folded, except the deviations, which are the match's own
 * outcome — that is the whole pairing.
 */
interface Observation {
  readonly teamKey: string;
  /**
   * The season this row came from. Carried solely so POOLED correlations can be
   * standardized within season — see `standardizeWithinGroups` for why pooling
   * raw values across seasons inflates a correlation rather than strengthening
   * the evidence.
   */
  readonly season: number;
  /** The published Swing Factor as of matches 1..N-1. */
  readonly swing: number;
  /** This match's even-split deviation, minus the team's running mean. */
  readonly centredDev: number;
  /** This match's even-split deviation, uncentred. */
  readonly dev: number;
  /** The population-constant baseline's sigma as of this row (walk-forward). */
  readonly baselineSigma: number;
}

// ───────────────────────────── pure statistics ─────────────────────────────
// Everything below this line is pure and unit-tested in measureSwingSkill.test.ts.

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function rms(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / values.length);
}

/** Pearson correlation. `NaN` when either side has zero variance — honest absence, not 0. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return Number.NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return Number.NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Average ranks, ties sharing their mean rank. Split out from `spearman` so the
 * tie handling is directly testable — a naive ordinal rank silently biases
 * Spearman whenever many rows share a value, and Swing Factor has an exact-zero
 * population (a model that misses a team by a constant) that does exactly that.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const sharedRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = sharedRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Z-scores `values` within each group of `groups`, returning one flat array.
 *
 * THIS EXISTS BECAUSE POOLING BROKE A CORRELATION, MEASURED.
 *
 * FRC seasons have wildly different score scales. Pooling raw rows across them
 * makes both swing and |deviation| carry a shared per-season scale factor, and a
 * correlation then picks that up as if it were per-team skill. Measured on
 * 2024-2026: BPR's per-season correlations are 0.079 / 0.073 / 0.264, but the
 * naive pooled figure is 0.517 — and the mismatched-pairing control rises to
 * 0.315 in lockstep, which is exactly how the inflation announced itself. The
 * pooled number was almost entirely between-season scale, not skill.
 *
 * Standardizing within season removes that shared factor and leaves the
 * within-season signal, which is the thing being measured. For a SINGLE group
 * this is an affine transform and Pearson is affine-invariant, so single-season
 * results are bit-unchanged by routing through it — no special-casing needed.
 *
 * A group whose values have zero variance contributes zeros (not NaN), so one
 * degenerate season cannot poison the whole pooled figure.
 */
export function standardizeWithinGroups(values: readonly number[], groups: readonly number[]): number[] {
  if (values.length !== groups.length) return [];
  const byGroup = new Map<number, number[]>();
  for (let i = 0; i < values.length; i++) {
    const bucket = byGroup.get(groups[i]!);
    if (bucket === undefined) byGroup.set(groups[i]!, [values[i]!]);
    else bucket.push(values[i]!);
  }
  const stats = new Map<number, { mu: number; sd: number }>();
  for (const [group, groupValues] of byGroup) {
    const mu = mean(groupValues);
    let sumSquares = 0;
    for (const v of groupValues) sumSquares += (v - mu) * (v - mu);
    stats.set(group, { mu, sd: Math.sqrt(sumSquares / groupValues.length) });
  }
  return values.map((v, i) => {
    const { mu, sd } = stats.get(groups[i]!)!;
    return sd > 0 ? (v - mu) / sd : 0;
  });
}

/** Spearman rank correlation, tie-corrected via `averageRanks`. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return Number.NaN;
  return pearson(averageRanks(xs), averageRanks(ys));
}

/**
 * Per-row Gaussian negative log-likelihood. A non-positive sigma is a defect in
 * the caller, not a row to skip, so it throws rather than coercing — a coerced
 * sigma would quietly make a broken estimator look competitive.
 */
export function gaussianNllRows(outcomes: readonly number[], sigmas: readonly number[]): number[] {
  if (outcomes.length !== sigmas.length) return [];
  const half = 0.5 * Math.log(2 * Math.PI);
  const rows: number[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const sigma = sigmas[i]!;
    if (!(sigma > 0) || !Number.isFinite(sigma)) {
      throw new Error(`gaussianNll: sigma must be finite and positive, got ${sigma} at index ${i}`);
    }
    const z = outcomes[i]! / sigma;
    rows.push(half + Math.log(sigma) + 0.5 * z * z);
  }
  return rows;
}

/**
 * Mean Gaussian negative log-likelihood of each outcome under its own sigma.
 * Lower is better.
 */
export function gaussianNll(outcomes: readonly number[], sigmas: readonly number[]): number {
  if (outcomes.length !== sigmas.length || outcomes.length === 0) return Number.NaN;
  return mean(gaussianNllRows(outcomes, sigmas));
}

/**
 * Median of a value list. Reported alongside every mean NLL because a log score
 * is unbounded above: a handful of rows where the estimator was confidently
 * wrong can dominate a mean and make the headline describe the tail rather than
 * the bulk. Swing Factor has exactly such a tail — an exact-or-near-zero swing
 * is reachable (a model that misses a team by a constant), and it is lethal
 * under a log score. Both numbers are printed so a reader can see which is
 * driving the verdict.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Splits rows into `count` equal-population buckets by `key`, ascending.
 *
 * Equal-population rather than equal-width deliberately: Swing Factor is
 * right-skewed across a season's teams, so equal-width buckets would leave the
 * top ones nearly empty and report calibration from a handful of rows.
 */
export function equalCountBuckets<T>(rows: readonly T[], key: (row: T) => number, count: number): T[][] {
  if (rows.length === 0 || count < 1) return [];
  const sorted = [...rows].sort((a, b) => key(a) - key(b));
  const buckets: T[][] = [];
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * sorted.length) / count);
    const end = Math.floor(((b + 1) * sorted.length) / count);
    if (end > start) buckets.push(sorted.slice(start, end));
  }
  return buckets;
}

/** Fraction of rows whose outcome magnitude falls inside its own predicted band. */
export function coverage(outcomes: readonly number[], bands: readonly number[]): number {
  if (outcomes.length !== bands.length || outcomes.length === 0) return Number.NaN;
  let inside = 0;
  for (let i = 0; i < outcomes.length; i++) {
    if (Math.abs(outcomes[i]!) <= bands[i]!) inside++;
  }
  return inside / outcomes.length;
}

// ───────────────────────────── CLI plumbing ─────────────────────────────

export function parseSeasons(spec: string): number[] {
  const seasons = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && Number.isFinite(range[0]!) && Number.isFinite(range[1]!)) {
      for (let s = range[0]!; s <= range[1]!; s++) seasons.add(s);
    } else if (Number.isFinite(range[0]!)) {
      seasons.add(range[0]!);
    }
  }
  return [...seasons].sort((a, b) => a - b);
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

// ───────────────────────────── the measurement ─────────────────────────────

/**
 * One season's observations for one algorithm, walk-forward.
 *
 * The accumulator here is the SAME class the publisher and the live Worker run,
 * not a re-implementation — a second copy of the estimator would measure
 * something the site does not ship, which is the exact drift this whole audit is
 * about.
 */
function measureSeason(
  season: number,
  records: readonly { match: Parameters<SwingFactorAccumulator["foldMatch"]>[0]; prediction: { redScore: number; blueScore: number } }[]
): Observation[] {
  const accumulator = new SwingFactorAccumulator();
  const observations: Observation[] = [];

  // The population-constant baseline, accumulated walk-forward so it never sees
  // a deviation before the shipped estimator does. Squares and count only — a
  // running RMS, deliberately NOT decayed: the baseline's whole job is to carry
  // no per-team and no recency information, so that the shipped estimator's
  // margin over it is attributable to exactly those two things.
  let baselineSumSquares = 0;
  let baselineCount = 0;

  for (const { match, prediction } of records) {
    // Gate the RECORDING with the identical rules `foldMatch` gates the FOLD
    // with, so the measured population is the learned population.
    const demoMatch = isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams);

    if (!demoMatch) {
      const sides = [
        { teams: match.redTeams, actual: match.redScore, dqs: match.redDqs, predicted: prediction.redScore },
        { teams: match.blueTeams, actual: match.blueScore, dqs: match.blueDqs, predicted: prediction.blueScore },
      ] as const;

      for (const side of sides) {
        if (side.teams.length === 0) continue;
        if (isFullyDqZeroScoreAlliance(side.teams, side.dqs, side.actual)) continue;
        if (!Number.isFinite(side.actual) || !Number.isFinite(side.predicted)) continue;

        const dev = (side.actual - side.predicted) / side.teams.length;

        for (const teamKey of side.teams) {
          const swing = accumulator.swingFor(teamKey);
          if (swing === undefined) continue; // fewer than two prior observations
          if (!(swing > 0)) continue; // an exact-zero band cannot be scored by NLL
          const runningMean = accumulator.beliefFor(teamKey)?.mean ?? 0;
          const centredDev = dev - runningMean;

          // A baseline sigma of 0 cannot score anything, so rows arriving before
          // the baseline has any history are skipped for EVERY estimator rather
          // than scored by some and not others — the comparison is only fair on
          // an identical row set.
          const baselineSigma = baselineCount > 0 ? Math.sqrt(baselineSumSquares / baselineCount) : 0;
          if (baselineSigma > 0) {
            observations.push({ teamKey, season, swing, centredDev, dev, baselineSigma });
          }

          // The baseline learns from this row AFTER it was used to score it.
          //
          // It accumulates CENTRED deviations, not raw ones, because centredDev
          // is what every estimator here is scored against and a baseline must
          // estimate the spread of the SAME quantity. Accumulating raw `dev`
          // instead (as an earlier draft did) inflates the baseline's sigma by
          // the model's bias variance and quietly hands it a different, wider
          // target than the one it is graded on.
          baselineSumSquares += centredDev * centredDev;
          baselineCount += 1;
        }
      }
    }

    accumulator.foldMatch(match, prediction);
  }

  return observations;
}

/** Each team's full-season RMS centred deviation — the hindsight oracle's sigma. */
function oracleSigmaByTeam(observations: readonly Observation[]): Map<string, number> {
  const sums = new Map<string, { sumSquares: number; count: number }>();
  for (const o of observations) {
    const entry = sums.get(o.teamKey) ?? { sumSquares: 0, count: 0 };
    entry.sumSquares += o.centredDev * o.centredDev;
    entry.count += 1;
    sums.set(o.teamKey, entry);
  }
  const sigmas = new Map<string, number>();
  for (const [teamKey, { sumSquares, count }] of sums) {
    const sigma = Math.sqrt(sumSquares / count);
    if (sigma > 0) sigmas.set(teamKey, sigma);
  }
  return sigmas;
}

function reportBlock(label: string, observations: readonly Observation[], matchCount: number): void {
  console.log(`── ${label} ── ${observations.length} team-match observations from ${matchCount} matches`);
  if (observations.length < 2) {
    console.log(`   too few observations to report\n`);
    return;
  }

  // Every correlation below runs on WITHIN-SEASON STANDARDIZED values. For a
  // single-season block that is an affine transform and changes nothing; for a
  // pooled block it removes the between-season scale factor that would otherwise
  // masquerade as skill (measured — see `standardizeWithinGroups`).
  const seasonsOf = observations.map((o) => o.season);
  const swingsZ = standardizeWithinGroups(
    observations.map((o) => o.swing),
    seasonsOf
  );
  const absCentredZ = standardizeWithinGroups(
    observations.map((o) => Math.abs(o.centredDev)),
    seasonsOf
  );
  const absRawZ = standardizeWithinGroups(
    observations.map((o) => Math.abs(o.dev)),
    seasonsOf
  );
  const signedZ = standardizeWithinGroups(
    observations.map((o) => o.centredDev),
    seasonsOf
  );
  const seasonSpan = new Set(seasonsOf).size;

  // 1. SKILL
  console.log(`   SKILL (reference ceiling r ~= ${CEILING_R.toFixed(2)}, swept on the PRE-CENTRING estimator)`);
  if (seasonSpan > 1) {
    console.log(`      (correlations standardized WITHIN each of the ${seasonSpan} seasons — raw pooling inflates them)`);
  }
  console.log(`      Pearson  swing vs |centred dev| = ${pearson(swingsZ, absCentredZ).toFixed(4)}   <- the headline`);
  console.log(`      Spearman swing vs |centred dev| = ${spearman(swingsZ, absCentredZ).toFixed(4)}`);
  console.log(`      Pearson  swing vs |raw dev|     = ${pearson(swingsZ, absRawZ).toFixed(4)}   (uncentred, includes model bias)`);
  // THE PAIRING CONTROL — a deterministic mismatched pairing.
  //
  // The obvious control ("swing should not correlate with SIGNED deviation,
  // because a spread cannot predict direction") was tried and is WRONG here, and
  // the reason is itself a finding: the model's bias varies monotonically with
  // swing (see the BIAS column in the calibration table below), so swing vs
  // signed deviation is legitimately non-zero and says nothing about whether the
  // walk-forward pairing is sound.
  //
  // This control instead re-pairs each swing with a DIFFERENT row's outcome at a
  // fixed large stride, preserving both marginal distributions exactly while
  // destroying the row-level correspondence. A sound harness shows a real
  // correlation far above this floor; if the two are comparable, the measured
  // "skill" is an artifact of the distributions rather than of the pairing.
  // Deterministic (no RNG) so the number is reproducible run to run.
  const stride = 10007 % Math.max(1, absCentredZ.length);
  const mismatched = absCentredZ.map((_, i) => absCentredZ[(i + stride) % absCentredZ.length]!);
  const mismatchedR = pearson(swingsZ, mismatched);
  console.log(
    `      PAIRING CONTROL (swing vs a mismatched row's |centred dev|) = ${mismatchedR.toFixed(4)}   ` +
      `<- must be far BELOW the headline`
  );
  const headlineR = pearson(swingsZ, absCentredZ);
  if (Number.isFinite(headlineR) && Number.isFinite(mismatchedR) && Math.abs(headlineR) <= Math.abs(mismatchedR) * 2) {
    console.log(`      ^^ WARNING: the headline is not clearly above the mismatched floor — do not trust this run.`);
  }
  console.log(
    `      Pearson  swing vs SIGNED centred dev = ${pearson(swingsZ, signedZ).toFixed(4)}   ` +
      `(the bias gradient, NOT a control — see the BIAS column below)`
  );

  // 2. CALIBRATION BY DECILE
  console.log(`   CALIBRATION by swing decile`);
  console.log(`      decile        n   mean swing   RMS centred dev     ratio   coverage       BIAS`);
  for (const [i, bucket] of equalCountBuckets(observations, (o) => o.swing, 10).entries()) {
    const bucketSwing = mean(bucket.map((o) => o.swing));
    const bucketRms = rms(bucket.map((o) => o.centredDev));
    const ratio = bucketRms > 0 ? bucketSwing / bucketRms : Number.NaN;
    const cov = coverage(
      bucket.map((o) => o.centredDev),
      bucket.map((o) => o.swing)
    );
    // BIAS is the mean SIGNED RAW deviation in this bucket — the model's own
    // systematic miss for teams at this swing level. It belongs in this table
    // rather than in a footnote because a monotone trend down this column means
    // the model's bias is a FUNCTION of swing, which is a statement about the
    // ALGORITHM, not about the Swing estimator being measured here.
    const bias = mean(bucket.map((o) => o.dev));
    console.log(
      `      ${String(i + 1).padStart(6)}  ${String(bucket.length).padStart(7)}   ` +
        `${bucketSwing.toFixed(2).padStart(10)}   ${bucketRms.toFixed(2).padStart(15)}   ` +
        `${ratio.toFixed(3).padStart(7)}   ${(cov * 100).toFixed(1).padStart(7)}%   ` +
        `${(bias >= 0 ? "+" : "") + bias.toFixed(2)}`.padStart(11)
    );
  }
  console.log(
    `      A FLAT ratio column means the estimator ranks teams correctly. A ratio near ${SWING_FACTOR_SCALE} means the SCALE is right.`
  );
  console.log(
    `      A RISING ratio column is the no-shrinkage signature: low-swing teams under-estimated, high-swing over-estimated.`
  );
  console.log(`      A trending BIAS column is a property of the ALGORITHM, not of Swing — the model's miss depends on swing level.`);

  // 3. COVERAGE AGAINST THE SIGMA CLAIM
  //
  // RAW POINTS, never the standardized arrays above. Coverage compares a
  // deviation in points against a band in points; feeding it z-scores compares a
  // point value to a unit-variance score and produces a meaningless sub-1%
  // figure. (Measured while building this: the refactor that introduced
  // standardization briefly did exactly that and turned 88% coverage into 0.25%.)
  const pooledCoverage = coverage(
    observations.map((o) => o.centredDev),
    observations.map((o) => o.swing)
  );
  const pooledRms = rms(observations.map((o) => o.centredDev));
  const meanSwing = mean(observations.map((o) => o.swing));
  console.log(`   COVERAGE vs the "one standard deviation" claim`);
  console.log(
    `      P(|centred dev| <= swing) = ${(pooledCoverage * 100).toFixed(2)}%   ` +
      `vs ${(GAUSSIAN_1SIGMA_COVERAGE * 100).toFixed(1)}% implied by a 1-sigma label ` +
      `(${pooledCoverage > GAUSSIAN_1SIGMA_COVERAGE ? "CONSERVATIVE — the band is too wide" : "OPTIMISTIC — the band is too tight"})`
  );
  console.log(`      mean swing = ${meanSwing.toFixed(2)}   pooled RMS centred dev = ${pooledRms.toFixed(2)}`);

  // The scale that would make the band a textbook 1 sigma: rescale so the
  // band's coverage lands at 68.3%. Solved empirically off the observed
  // |centred dev| / (swing / SCALE) distribution rather than assuming a
  // Gaussian, because the residual distribution is measurably peakier than one.
  const zs = observations.map((o) => Math.abs(o.centredDev) / (o.swing / SWING_FACTOR_SCALE)).sort((a, b) => a - b);
  const quantileIndex = Math.min(zs.length - 1, Math.max(0, Math.floor(GAUSSIAN_1SIGMA_COVERAGE * zs.length)));
  console.log(
    `      the scale that WOULD deliver ${(GAUSSIAN_1SIGMA_COVERAGE * 100).toFixed(1)}% coverage = ${zs[quantileIndex]!.toFixed(3)}   ` +
      `(shipped scale is ${SWING_FACTOR_SCALE})`
  );
  console.log(
    `      NOTE: this is the PER-TEAM centred-deviation reading. It is a DIFFERENT quantity from the`
  );
  console.log(
    `      alliance match-band coverage swingFactor.ts's header quotes (1.68 / 1.71 / 1.13) — do not conflate them.`
  );

  // 4. BASELINE AND ORACLE BRACKET
  const centred = observations.map((o) => o.centredDev);
  const oracleSigmas = oracleSigmaByTeam(observations);
  // Every estimator is scored on the IDENTICAL row set. The oracle drops rows
  // for teams whose full-season centred deviations were all exactly zero (sigma
  // 0 cannot be scored), so that restriction is applied to all three rather than
  // letting each estimator choose its own favourable subset.
  const scorable = observations.filter((o) => oracleSigmas.has(o.teamKey));
  const shippedRows = gaussianNllRows(
    scorable.map((o) => o.centredDev),
    scorable.map((o) => o.swing / SWING_FACTOR_SCALE)
  );
  const baselineRows = gaussianNllRows(
    scorable.map((o) => o.centredDev),
    scorable.map((o) => o.baselineSigma)
  );
  const oracleRows = gaussianNllRows(
    scorable.map((o) => o.centredDev),
    scorable.map((o) => oracleSigmas.get(o.teamKey)!)
  );

  console.log(`   BASELINE BRACKET (Gaussian NLL of centred dev, LOWER is better, n=${scorable.length})`);
  console.log(`                                        mean      median`);
  console.log(
    `      population-constant baseline = ${mean(baselineRows).toFixed(4).padStart(9)}   ${median(baselineRows).toFixed(4).padStart(9)}   (one number, no per-team information)`
  );
  console.log(
    `      SHIPPED Swing Factor         = ${mean(shippedRows).toFixed(4).padStart(9)}   ${median(shippedRows).toFixed(4).padStart(9)}`
  );
  console.log(
    `      per-team hindsight REFERENCE = ${mean(oracleRows).toFixed(4).padStart(9)}   ${median(oracleRows).toFixed(4).padStart(9)}   (USES THE FUTURE — a reference point, NOT an upper bound)`
  );

  for (const [label, shipped, baseline, oracle] of [
    ["mean  ", mean(shippedRows), mean(baselineRows), mean(oracleRows)],
    ["median", median(shippedRows), median(baselineRows), median(oracleRows)],
  ] as const) {
    const skill = baseline - shipped;
    const gap = baseline - oracle;
    // "Fraction of the gap closed" is only meaningful when the reference
    // actually beats the baseline. It frequently does NOT — see the note below —
    // and printing a percentage against a negative gap produced readings like
    // "-97.4%" and "237.5%" in an earlier draft, which are noise dressed as
    // precision.
    const closed = gap > 0 ? `   closes ${((skill / gap) * 100).toFixed(1)}% of the baseline->reference gap` : "";
    console.log(
      `      ${label} skill vs baseline = ${skill >= 0 ? "+" : ""}${skill.toFixed(4)} nats ` +
        `(${skill > 0 ? "BEATS a single constant" : "does NOT beat a single constant"})${closed}`
    );
  }
  if (mean(oracleRows) > mean(baselineRows)) {
    console.log(
      `      NOTE: the hindsight reference LOSES to the baseline here, which is not a contradiction. The`
    );
    console.log(
      `      baseline sigma varies over the season (walk-forward, it adapts as the model warms up); the`
    );
    console.log(
      `      reference is ONE constant per team for the whole season. Neither class contains the other, so`
    );
    console.log(
      `      per-team hindsight is not an upper bound — and that time variation mattering MORE than per-team`
    );
    console.log(`      variation is itself a finding about where the remaining signal actually lives.`);
  }

  // THE TAIL, reported explicitly because the mean above is unbounded and this
  // is what drives it. A log score punishes a confidently-narrow band that is
  // then badly missed, and Swing Factor can produce a near-zero band from two
  // near-identical deviations. That is a real defect of the shipped estimator —
  // precisely the one shrinkage toward a population prior would remove — but a
  // reader must be able to see whether the verdict rests on this tail or on the
  // bulk, which is why the median sits beside the mean above.
  const tail = scorable.filter((o) => o.swing < 1);
  if (tail.length > 0) {
    const tailNll = gaussianNllRows(
      tail.map((o) => o.centredDev),
      tail.map((o) => o.swing / SWING_FACTOR_SCALE)
    );
    console.log(
      `      TAIL: ${tail.length} rows (${((tail.length / scorable.length) * 100).toFixed(3)}%) carry a swing below 1 point; ` +
        `their mean NLL is ${mean(tailNll).toFixed(1)} and they contribute ` +
        `${(((mean(tailNll) * tail.length) / (mean(shippedRows) * scorable.length)) * 100).toFixed(1)}% of the total`
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = flagValue(args, "--seasons") ?? "2024-2026";
  const algorithmsSpec = flagValue(args, "--algorithms");
  const includeOffseason = args.includes("--include-offseason");
  const seasons = parseSeasons(seasonsSpec);
  const algorithms = resolvePublishAlgorithms(algorithmsSpec);

  console.log(`SWING FACTOR SKILL — the harness audit finding F1 said did not exist.`);
  console.log(`algorithms: ${algorithms.map((a) => `${a.id}@${a.version}`).join(", ")}`);
  console.log(`seasons:    ${seasons.join(", ")}   offseason ${includeOffseason ? "INCLUDED" : "excluded"}`);
  console.log(`scale:      SWING_FACTOR_SCALE = ${SWING_FACTOR_SCALE}`);
  console.log(``);
  console.log(`Walk-forward: every estimate is read BEFORE its match is folded, through the SAME`);
  console.log(`SwingFactorAccumulator the publisher and the live Worker run.`);
  console.log(``);
  console.log(`n IS TEAM-MATCHES, NOT INDEPENDENT OBSERVATIONS. Even-split hands all three teammates`);
  console.log(`the identical deviation, so one match contributes up to 6 rows sharing 2 values. Treat`);
  console.log(`confidence intervals computed from these counts as roughly sqrt(3) too tight.`);
  console.log(``);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const coldStartIndex = corpusColdStartIndex(db);

    for (const algorithm of algorithms) {
      console.log(`═══ ${algorithm.id}@${algorithm.version} ═══\n`);
      const pooled: Observation[] = [];
      let pooledMatches = 0;

      for (const season of seasons) {
        const stream = buildSeasonStream(db, season, { includeOffseason });
        if (stream.length === 0) {
          console.log(`── ${season} ── no matches in corpus\n`);
          continue;
        }
        const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
        const records = new WalkForwardSimulator(stream, coldStartIndex).runAll([algorithm], teams);
        const observations = measureSeason(season, records);
        reportBlock(`${season}`, observations, stream.length);
        pooled.push(...observations);
        pooledMatches += stream.length;
      }

      if (seasons.length > 1) {
        console.log(`─── ${algorithm.id} POOLED ───`);
        reportBlock(`${algorithm.id} all seasons`, pooled, pooledMatches);
      }
    }
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without the harness
// trying to open a corpus. Same idiom as `verifySubsetPublish.ts`.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:swing-skill failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
