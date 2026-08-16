/**
 * D-10/D-11/D-16: the seeded, correlated joint Monte Carlo draw that turns
 * one match's `AllianceRpMoments` (both alliances, `rp/state.ts`'s
 * `predictAllianceRpMoments`) into a full discrete RP pmf for each
 * alliance.
 *
 * D-11's correlation claim made concrete: ONE set of draws produces the
 * alliance's score, the opponent's score, and its threshold variables
 * TOGETHER, from a single joint Gaussian over
 * `[redScore, blueScore, redVar_1..T, blueVar_1..T]`. WITHIN an alliance,
 * the score/threshold cross-covariance block comes from
 * `AllianceRpMoments.scoreCrossCovariance` (D-11's whole point — that
 * correlation is READ FROM THE DATA via `rp/state.ts`'s `rpCrossCovariance`
 * fold, never asserted). ACROSS alliances every cross block is exactly
 * zero: red and blue never share a rating-eligible team by construction
 * (TBA's alliance assignment), so under D-06's independent-teams
 * assumption (already the foundation the whole Sigma1 model rests on) red's
 * score/threshold-variable draws and blue's are independent of each other.
 * Stated here explicitly rather than left for a reader to infer from a zero
 * block.
 *
 * D-16 (bitwise reproducibility): every draw is seeded per MATCH, from
 * `params.rpMonteCarloSeed` combined with an FNV-1a hash of `matchKey`
 * (`fnv1a32` below) — never from a running stream position. This is
 * load-bearing, not hygiene: seeding from stream position would make a
 * match's pmf depend on how many matches preceded it in a given replay,
 * breaking plan 03-01's bounded-slice digest (`digest.test.ts`) the moment
 * this module's output entered the prediction stream. JavaScript's built-in
 * non-seedable PRNG global never appears anywhere in this file — every
 * random value traces back to `mulberry32`.
 *
 * Style: hand-rolled primitives (Mulberry32 PRNG, Box-Muller transform,
 * FNV-1a hash), each cited to its well-known source, matching
 * `packages/harness/identifiability.ts`'s established "cite, don't
 * rederive" discipline for this project (RESEARCH.md's Don't-Hand-Roll
 * table: these ARE the recommended hand-rolled primitives, unlike matrix
 * inversion, which genuinely should not be hand-rolled — `ml-matrix`'s
 * `CholeskyDecomposition` handles that half).
 */
import { CholeskyDecomposition, Matrix } from "ml-matrix";
import type { CompLevel } from "../../types.js";
import type { RpRuleModule } from "./constants.js";
import type { AllianceRpMoments } from "./state.js";
import type { Sigma1Params } from "../params.js";

/**
 * Deterministic PRNG (Mulberry32), copied verbatim from
 * `packages/harness/identifiability.ts`'s own `mulberry32` (cited there to
 * the same source) — same seed always produces the same draw sequence, so
 * this module's output is reproducible across runs and across a match's
 * position in a replay stream, not a fresh random draw each time.
 */
export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform (Box, G. E. P. & Muller, M. E., "A Note on the
 * Generation of Random Normal Deviates", Annals of Mathematical Statistics,
 * 1958): converts two independent U(0,1) draws into two independent N(0,1)
 * draws via `r = sqrt(-2 ln(u1))`, `theta = 2*pi*u2`,
 * `(r*cos(theta), r*sin(theta))`. `u1` must be strictly positive (`ln(0)`
 * is `-Infinity`) — `drawStandardNormals` below guards this at the call
 * site rather than here, matching `linkFunctions.ts`'s convention of
 * documenting a degenerate branch at the point it is actually handled.
 */
export function boxMullerPair(u1: number, u2: number): [number, number] {
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * FNV-1a 32-bit hash (Fowler/Noll/Vo — public-domain, well-known
 * non-cryptographic hash; FNV offset basis `0x811c9dc5`, prime
 * `0x01000193`) over a string's UTF-16 code units. Combined with
 * `params.rpMonteCarloSeed` (`seedForMatch` below) to give each match its
 * OWN deterministic seed (D-16) — per-match seeding, not a hash used for
 * any security purpose.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seedForMatch(baseSeed: number, matchKey: string): number {
  return (baseSeed ^ fnv1a32(matchKey)) >>> 0;
}

/** Mean, derived from a discrete pmf at read time — D-10: the pmf is the ONE stored representation, mean/SD are never stored alongside it. */
export function pmfMean(pmf: readonly number[]): number {
  let mean = 0;
  for (let i = 0; i < pmf.length; i++) mean += i * pmf[i]!;
  return mean;
}

/** Standard deviation, derived from a discrete pmf at read time (see `pmfMean`). Floored at 0 to absorb floating-point noise that could otherwise produce a tiny negative variance. */
export function pmfStandardDeviation(pmf: readonly number[]): number {
  const mean = pmfMean(pmf);
  let variance = 0;
  for (let i = 0; i < pmf.length; i++) variance += pmf[i]! * (i - mean) ** 2;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Escalating diagonal ridges tried, in order, if Cholesky decomposition
 * finds the raw joint covariance matrix not positive definite — the same
 * numerical-stability instinct `covariance.ts`'s `SIGMA1_COV_SHRINKAGE`
 * documents (a rank-deficient early-season residual history, or a
 * degenerate all-surrogate alliance with genuinely zero variance in every
 * dimension, is a legitimate, expected state, not a bug).
 *
 * [Rule 1 fix, plan 03-05] The original single 1e-6 retry (matching
 * `covariance.ts`'s own ridge magnitude) is kept as the FIRST escalation
 * step, so every match that already reproduced with it stays bitwise
 * unchanged (D-16) — but a single fixed value is not always enough:
 * `promote.ts`'s bounded-slice replay always starts EVERY team's RP state
 * from a genuinely fresh cold start (no prior-match history to carry in,
 * unlike a full multi-season harness run), and an EWMA-tracked cross-
 * covariance (`rp/state.ts`'s `rpCrossCovariance`) folded from only one or
 * two observations can be large enough, RELATIVE to the Kalman-derived
 * score variance it is paired with, that 1e-6 alone cannot restore positive
 * definiteness — discovered running this plan's own real
 * `pnpm promote --slice-events 3` against the live corpus. Escalating
 * geometrically (rather than raising the single constant) keeps every
 * ALREADY-succeeding match's draws untouched while still rescuing a
 * genuinely near-singular one: adding `ridge * I` to any real symmetric
 * matrix raises every eigenvalue by exactly `ridge`, so a large enough
 * ridge always restores positive-definiteness — this is a numerical-
 * stability ladder, not a modeling hyperparameter (unlike `Sigma1Params`'s
 * tunable fields, `tune.ts` never searches this).
 */
const CHOLESKY_RIDGES = [1e-6, 1e-4, 1e-2, 1, 10, 100] as const;

export interface RpPmfInput {
  readonly red: AllianceRpMoments;
  readonly blue: AllianceRpMoments;
  readonly ruleModule: RpRuleModule;
  readonly eventType: number;
  readonly matchKey: string;
  readonly compLevel: CompLevel;
  readonly params: Sigma1Params;
}

export interface RpPmfResult {
  readonly redPmf: readonly number[];
  readonly bluePmf: readonly number[];
}

/** `P(RP=0)=1` — the degenerate single-value pmf for a non-qualification match (Pitfall 3, `ELIMINATION_RP_TOTAL`) or for `params.rpMonteCarloDraws === 0` before any bonus RP is added, though the latter returns `[]` instead (see `rpPmfForMatch`). */
function degenerateZeroPmf(): readonly number[] {
  return [1];
}

interface JointModel {
  /** Length N = 2 + 2T: [redScore, blueScore, ...redThresholdVars, ...blueThresholdVars]. */
  readonly mean: readonly number[];
  /** Cholesky lower-triangular factor of the (possibly ridge-corrected) N x N joint covariance. */
  readonly lower: Matrix;
  readonly variableCount: number;
}

/**
 * Assembles the joint mean vector and covariance matrix over
 * `[redScore, blueScore, redVar_1..T, blueVar_1..T]` (see file header for
 * the cross-alliance-independence reasoning) and decomposes it via
 * `ml-matrix`'s `CholeskyDecomposition`. If the raw matrix is not positive
 * definite, retries with each of `CHOLESKY_RIDGES` in turn, added to every
 * diagonal entry, stopping at the first that succeeds; if EVERY escalation
 * is still not positive definite, throws naming the match key — never
 * silently falls back to an independent draw, which would quietly discard
 * exactly the correlation D-11 exists to capture.
 */
function buildJointModel(red: AllianceRpMoments, blue: AllianceRpMoments, matchKey: string): JointModel {
  const T = red.variableNames.length;
  const N = 2 + 2 * T;
  const mean = [red.scoreMean, blue.scoreMean, ...red.meanVector, ...blue.meanVector];

  function buildCovArray(ridge: number): number[][] {
    const cov: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    cov[0]![0] = red.scoreVariance + ridge;
    cov[1]![1] = blue.scoreVariance + ridge;
    // cov[0][1]/cov[1][0] stay 0 — independent alliances (file header).
    for (let i = 0; i < T; i++) {
      const redIdx = 2 + i;
      const blueIdx = 2 + T + i;
      cov[0]![redIdx] = red.scoreCrossCovariance[i]!;
      cov[redIdx]![0] = red.scoreCrossCovariance[i]!;
      cov[1]![blueIdx] = blue.scoreCrossCovariance[i]!;
      cov[blueIdx]![1] = blue.scoreCrossCovariance[i]!;
      // cov[0][blueIdx], cov[1][redIdx] stay 0 — cross-alliance zero block.
      for (let j = 0; j < T; j++) {
        cov[2 + i]![2 + j] = red.varianceBlock[i]?.[j] ?? 0;
        cov[2 + T + i]![2 + T + j] = blue.varianceBlock[i]?.[j] ?? 0;
      }
      cov[redIdx]![redIdx] = (cov[redIdx]![redIdx] ?? 0) + ridge;
      cov[blueIdx]![blueIdx] = (cov[blueIdx]![blueIdx] ?? 0) + ridge;
    }
    return cov;
  }

  let chol = new CholeskyDecomposition(new Matrix(buildCovArray(0)));
  if (!chol.isPositiveDefinite()) {
    let succeeded = false;
    for (const ridge of CHOLESKY_RIDGES) {
      chol = new CholeskyDecomposition(new Matrix(buildCovArray(ridge)));
      if (chol.isPositiveDefinite()) {
        succeeded = true;
        break;
      }
    }
    if (!succeeded) {
      throw new Error(
        `rpPmfForMatch: joint covariance matrix for match ${matchKey} is not positive definite even after escalating ridges up to ${CHOLESKY_RIDGES[CHOLESKY_RIDGES.length - 1]}`
      );
    }
  }

  return { mean, lower: chol.lowerTriangularMatrix, variableCount: T };
}

/** N independent N(0,1) draws via `boxMullerPair`, consuming pairs from `rng` (an odd N discards the second value of its final pair — a documented, harmless one-draw waste, not a correctness issue). */
function drawStandardNormals(n: number, rng: () => number): number[] {
  const z = new Array(n);
  let i = 0;
  while (i < n) {
    // mulberry32's range is [0, 1) and only emits exactly 0 for one specific
    // internal state; guard it anyway so `Math.log(0)` (-Infinity) can never
    // reach `boxMullerPair`.
    const u1 = rng() || Number.MIN_VALUE;
    const u2 = rng();
    const [z1, z2] = boxMullerPair(u1, u2);
    z[i] = z1;
    i++;
    if (i < n) {
      z[i] = z2;
      i++;
    }
  }
  return z;
}

/** One joint draw: `mean + L * z` for the Cholesky lower-triangular factor `L` and a standard-normal vector `z`. */
function drawJoint(model: JointModel, rng: () => number): number[] {
  const n = model.mean.length;
  const z = drawStandardNormals(n, rng);
  const draw = new Array(n);
  for (let r = 0; r < n; r++) {
    let sum = model.mean[r]!;
    for (let c = 0; c <= r; c++) {
      sum += model.lower.get(r, c) * z[c]!;
    }
    draw[r] = sum;
  }
  return draw;
}

/** Builds a `{name: value}` record from a slice of one draw, in `variableNames` order. */
function valuesFromDraw(draw: readonly number[], offset: number, variableNames: readonly string[]): Record<string, number> {
  const values: Record<string, number> = {};
  variableNames.forEach((name, i) => {
    values[name] = draw[offset + i]!;
  });
  return values;
}

/**
 * D-10/D-11/D-16: the full discrete RP pmf for both alliances of one
 * qualification match, from ONE set of correlated, per-match-seeded draws.
 * See file header for the joint-model construction and seeding contract.
 */
export function rpPmfForMatch(input: RpPmfInput): RpPmfResult {
  const { red, blue, ruleModule, eventType, matchKey, compLevel, params } = input;

  // 1. Non-qualification short-circuit (Pitfall 3, ELIMINATION_RP_TOTAL):
  // both alliances get the degenerate P(RP=0)=1 pmf, no draws, no cost.
  if (compLevel !== "qm") {
    return { redPmf: degenerateZeroPmf(), bluePmf: degenerateZeroPmf() };
  }

  // 2. Zero-draws short-circuit: lets plan 03-05's hyperparameter search run
  // at full speed (the search objective is Brier on win probability, which
  // never reads the pmf) without biasing pRedWin/redScore/blueScore — that
  // independence is asserted by `distribution.test.ts`, not just claimed.
  if (params.rpMonteCarloDraws === 0) {
    return { redPmf: [], bluePmf: [] };
  }

  const model = buildJointModel(red, blue, matchKey);
  const rng = mulberry32(seedForMatch(params.rpMonteCarloSeed, matchKey));

  const redBuckets = new Array(ruleModule.maxRp + 1).fill(0);
  const blueBuckets = new Array(ruleModule.maxRp + 1).fill(0);

  for (let draw = 0; draw < params.rpMonteCarloDraws; draw++) {
    const sample = drawJoint(model, rng);
    const redScore = sample[0]!;
    const blueScore = sample[1]!;
    const redValues = valuesFromDraw(sample, 2, red.variableNames);
    const blueValues = valuesFromDraw(sample, 2 + model.variableCount, blue.variableNames);

    const redPrediction = ruleModule.predictThresholds(redValues, eventType);
    const bluePrediction = ruleModule.predictThresholds(blueValues, eventType);

    const redWon = redScore > blueScore;
    const blueWon = blueScore > redScore;
    const tied = !redWon && !blueWon;

    const redOutcomeRp = redWon ? ruleModule.winRp : tied ? ruleModule.tieRp : 0;
    const blueOutcomeRp = blueWon ? ruleModule.winRp : tied ? ruleModule.tieRp : 0;

    const redTotalRp = Math.min(ruleModule.maxRp, redOutcomeRp + redPrediction.totalRp);
    const blueTotalRp = Math.min(ruleModule.maxRp, blueOutcomeRp + bluePrediction.totalRp);

    redBuckets[redTotalRp]! += 1;
    blueBuckets[blueTotalRp]! += 1;
  }

  const redPmf = redBuckets.map((count) => count / params.rpMonteCarloDraws);
  const bluePmf = blueBuckets.map((count) => count / params.rpMonteCarloDraws);

  return { redPmf, bluePmf };
}
