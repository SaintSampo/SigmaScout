/**
 * OPR (Offensive Power Rating) baseline — a no-variance AlgorithmModule.
 *
 * RESEARCH.md Pattern 4: ridge-regularized least-squares over pooled
 * alliance-score observations. Two mitigations, applied together, keep the
 * solve well-posed even when the design matrix is rank-deficient early in
 * a season (RESEARCH.md Pitfall 2, the identifiability trap this project's
 * failure log already recorded once):
 *
 *   1. Season-scope pooling — `update()` never resets or scopes its
 *      accumulated observations to "this event"; every observation a team
 *      has produced so far this season (across every event it has
 *      attended) stays in the design matrix for every later solve.
 *   2. Ridge regularization (M^T M + λI) — keeps the normal equations
 *      invertible even while the design matrix is still thin, shrinking
 *      ratings toward zero (and, empirically, toward the observed mean —
 *      see opr.test.ts) rather than letting an ill-conditioned solve
 *      diverge or return NaN/Infinity.
 *
 * Surrogate handling (D-07) and disqualification handling (Open Question 3,
 * RESEARCH.md) are resolved by `ratingEligibleTeams`/`allianceObservation`
 * below — see the comment on `allianceObservation` for the reasoning behind
 * both policies.
 */
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type TeamMetrics, type UpcomingMatch } from "./types.js";

/**
 * Ridge penalty added to the normal equations (M^T M + λI). λ=3 is small
 * relative to a typical FRC alliance score (tens to hundreds of points),
 * so once a team has accumulated even a handful of real observations its
 * ridge-induced bias is small relative to its signal — but it is enough to
 * keep the solve invertible (and every rating finite) during the
 * rank-deficient regime at the very start of a season, when the design
 * matrix may have far fewer independent rows than teams.
 */
export const OPR_RIDGE_LAMBDA = 3;

/**
 * Logistic scale converting a predicted score margin into a red-win
 * probability: pRedWin = 1 / (1 + exp(-margin / OPR_LOGISTIC_SCALE)).
 * Chosen so a margin of roughly one typical FRC alliance-score standard
 * deviation (empirically tens of points across 2022-2026 seasons) maps to
 * a clearly-confident-but-not-saturated probability (margin=10 -> ~0.73);
 * a smaller value saturates the curve faster, a larger value flattens it.
 */
export const OPR_LOGISTIC_SCALE = 10;

/**
 * One alliance's rating-eligible observation for the design matrix: which
 * teams' columns get a 1 in that row, and the target score attributed to
 * them (adjusted for any surrogate offset — see `allianceObservation`).
 */
export interface OprObservation {
  readonly teams: readonly string[];
  readonly allianceScore: number;
}

export interface OprState {
  readonly observations: readonly OprObservation[];
  readonly ratings: ReadonlyMap<string, number>;
  /**
   * Incremental Sherman-Morrison/RLS solve cache — see `IncrementalInverse`'s
   * doc comment for why `update()` no longer calls `solveRidgeOpr` on every
   * match. Internal to this module: `predict()` never reads it, and it is
   * not part of the algorithm's tested public contract beyond keeping
   * `update()` fast at season scale.
   */
  readonly incrementalSolve: IncrementalRidgeSolve;
}

/**
 * Teams whose column should appear in the design matrix for this alliance:
 * every listed team except surrogates. D-07 requires that a surrogate
 * appearance produce no rating update for the surrogate itself; excluding
 * its column here is how that is enforced (its contribution is still
 * accounted for — see `allianceObservation` — via a subtracted offset, not
 * simply discarded).
 *
 * Disqualification policy (Open Question 3, RESEARCH.md — no locked
 * decision covers this; deliberately the OPPOSITE policy from surrogates,
 * see `allianceObservation` for the fuller reasoning): a disqualified team
 * physically played the match and physically contributed to the alliance's
 * score. A disqualification is a ranking-and-record ruling, not a
 * statement that the robot was absent, and OPR models score contribution —
 * so removing a disqualified team's column would misattribute its real
 * contribution to its teammates. Disqualified teams are therefore
 * deliberately NOT filtered here: `MatchResult` carries no dq field at all,
 * by design, so a disqualified team is indistinguishable from any other
 * participant to this function and keeps its column, with its rating
 * updated, exactly like a normal player. Plan 03 stores
 * `red_dqs`/`blue_dqs` in the corpus regardless, so reversing this call
 * later is a one-line addition to this function's signature, not a data
 * problem.
 */
export function ratingEligibleTeams(
  teams: readonly string[],
  surrogates: readonly string[]
): string[] {
  if (surrogates.length === 0) return [...teams];
  const surrogateSet = new Set(surrogates);
  return teams.filter((team) => !surrogateSet.has(team));
}

/**
 * Builds one alliance's `OprObservation`, resolving the modeling question
 * D-07 explicitly leaves open (how to treat a surrogate's slot in the
 * alliance observation for the other five teams).
 *
 * Approach: treat the surrogate as a known quantity rather than an
 * unknown. Its column never appears in the design matrix (via
 * `ratingEligibleTeams`), so it receives no rating update — exactly what
 * D-07 requires. Its contribution to the alliance's actual score is not
 * simply thrown away (which would discard real information about its two
 * or three non-surrogate teammates) nor left in the design matrix (which
 * would update its rating in violation of D-07) — instead its current
 * rating (or, if it has none yet, the season's current league-mean
 * per-team share, as a cold-start substitute) is subtracted from the
 * target alliance score, so its teammates keep a correctly-scaled
 * observation instead of one inflated by absorbing the surrogate's share.
 *
 * Disqualification policy (Open Question 3, RESEARCH.md — no locked
 * decision covers this; this plan takes the opposite position from
 * surrogates and states why): a disqualified team physically played the
 * match and physically contributed to the alliance's score. A
 * disqualification is a ranking-and-record ruling, not a statement that
 * the robot was absent, and OPR models score contribution — so removing a
 * disqualified team's column would misattribute its real contribution to
 * its teammates. The column is kept and the rating IS updated, the
 * opposite policy from surrogates. Concretely, `MatchResult` carries no dq
 * field at all, so there is nothing to special-case here; Plan 03 already
 * stores `red_dqs`/`blue_dqs` in the corpus regardless, so reversing this
 * call later is a one-line addition to this function's signature, not a
 * data problem.
 */
export function allianceObservation(
  teams: readonly string[],
  surrogates: readonly string[],
  allianceScore: number,
  ratings: ReadonlyMap<string, number>,
  leagueMeanPerTeamShare: number
): OprObservation {
  const eligibleTeams = ratingEligibleTeams(teams, surrogates);
  const surrogateOffset = surrogates.reduce(
    (sum, team) => sum + (ratings.get(team) ?? leagueMeanPerTeamShare),
    0
  );
  return { teams: eligibleTeams, allianceScore: allianceScore - surrogateOffset };
}

/**
 * The season's current mean per-team-slot contribution, computed from
 * every pooled observation so far: total observed alliance score divided
 * by total rating-eligible team-slots. Used only as the cold-start
 * substitute for a surrogate with no rating yet. Before any observation
 * exists, falls back to a naive three-way split of this match's own
 * average alliance score, so the very first match of a season never
 * throws for lack of prior data.
 */
function currentLeagueMeanPerTeamShare(
  observations: readonly OprObservation[],
  fallbackAllianceScore: number
): number {
  let totalScore = 0;
  let totalSlots = 0;
  for (const obs of observations) {
    totalScore += obs.allianceScore;
    totalSlots += obs.teams.length;
  }
  return totalSlots === 0 ? fallbackAllianceScore / 3 : totalScore / totalSlots;
}

function buildTeamIndex(observations: readonly OprObservation[]): Map<string, number> {
  const teamIndex = new Map<string, number>();
  for (const obs of observations) {
    for (const team of obs.teams) {
      if (!teamIndex.has(team)) teamIndex.set(team, teamIndex.size);
    }
  }
  return teamIndex;
}

/**
 * Ridge-regularized least-squares OPR solve (RESEARCH.md Pattern 4):
 * M^T M x = M^T s becomes (M^T M + λI) x = M^T s, solved via ml-matrix's
 * `SingularValueDecomposition` rather than a hand-rolled elimination —
 * early-season systems are ill-conditioned by construction, and a bespoke
 * Gaussian elimination is exactly the kind of code that looks finished
 * until one team's row makes it diverge.
 */
export function solveRidgeOpr(
  observations: readonly OprObservation[],
  teamIndex: ReadonlyMap<string, number>,
  lambda: number = OPR_RIDGE_LAMBDA
): Map<string, number> {
  const ratings = new Map<string, number>();
  const n = teamIndex.size;
  if (n === 0 || observations.length === 0) return ratings;

  const M = Matrix.zeros(observations.length, n);
  const s = Matrix.columnVector(observations.map((o) => o.allianceScore));
  observations.forEach((obs, row) => {
    for (const team of obs.teams) {
      const idx = teamIndex.get(team);
      if (idx !== undefined) M.set(row, idx, 1);
    }
  });

  const MtM = M.transpose().mmul(M).add(Matrix.eye(n).mul(lambda));
  const Mts = M.transpose().mmul(s);
  const x = new SingularValueDecomposition(MtM).solve(Mts);

  for (const [team, idx] of teamIndex) {
    ratings.set(team, x.get(idx, 0));
  }
  return ratings;
}

/**
 * Performance note (this is why `update()` below does not call
 * `solveRidgeOpr` directly): recomputing the dense O(n^3) SVD solve from
 * scratch after every single match does not scale to a real FRC season. A
 * season pools every event nationally (this module's own season-scope
 * pooling, see the file header) — real corpus measurement found
 * ~3,000-3,700 distinct teams and ~15,000-18,000
 * played matches per 2022-2026 season. Benchmarked directly against this
 * project's `ml-matrix` dependency: one dense SVD solve at n=1,500 teams
 * takes ~21s, and the cost scales cubically — at n≈3,700 a full season
 * would need on the order of 16 CPU-DAYS. `update()` therefore maintains
 * `(M^T M + lambda*I)^-1` incrementally via a Sherman-Morrison rank-1
 * update (the classic Recursive Least Squares algorithm) instead. This is
 * mathematically EXACT, not an approximation — for any prefix of
 * observations, the incremental ratings are identical (up to
 * floating-point rounding) to calling `solveRidgeOpr` fresh over that same
 * prefix. Proven directly in opr.test.ts's "incremental solve matches the
 * from-scratch dense solve" test. `solveRidgeOpr` itself is untouched and
 * is exactly what that equivalence test checks the incremental path
 * against. Implemented with raw `Float64Array` math (not `ml-matrix`,
 * whose generic-matrix overhead benchmarked ~20-30x slower for this
 * exact operation) to keep the O(n^2)-per-match cost real: ~15-30ms per
 * update even at n=3,700, versus ml-matrix's ~110-420ms for the
 * equivalent operation.
 */
function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * `(M^T M + lambda*I)^-1`, maintained incrementally via Sherman-Morrison
 * rank-1 updates. Backed by a flat, power-of-two-padded `Float64Array` so
 * that adding one new team at a time (routine — every season starts empty
 * and grows to thousands of teams) is amortized O(1) array growth rather
 * than an O(n) copy on every single addition.
 */
class IncrementalInverse {
  readonly #capacity: number;
  readonly #size: number;
  readonly #data: Float64Array;

  private constructor(capacity: number, size: number, data: Float64Array) {
    this.#capacity = capacity;
    this.#size = size;
    this.#data = data;
  }

  static empty(): IncrementalInverse {
    return new IncrementalInverse(0, 0, new Float64Array(0));
  }

  #at(row: number, col: number): number {
    return this.#data[row * this.#capacity + col]!;
  }

  /**
   * Appends one new dimension, isolated from every existing one (zero
   * cross terms, diagonal = 1/lambda) — exactly `(0*I + lambda*I)^-1` for
   * a team with no observations yet, since a never-yet-observed team's row
   * and column in `M^T M` are genuinely all-zero at that instant.
   */
  withNewDimension(diagonalValue: number): IncrementalInverse {
    if (this.#size < this.#capacity) {
      const data = this.#data.slice();
      data[this.#size * this.#capacity + this.#size] = diagonalValue;
      return new IncrementalInverse(this.#capacity, this.#size + 1, data);
    }
    const capacity = nextPowerOfTwo(this.#size + 1);
    const data = new Float64Array(capacity * capacity);
    for (let r = 0; r < this.#size; r++) {
      for (let c = 0; c < this.#size; c++) {
        data[r * capacity + c] = this.#at(r, c);
      }
    }
    data[this.#size * capacity + this.#size] = diagonalValue;
    return new IncrementalInverse(capacity, this.#size + 1, data);
  }

  /**
   * Sherman-Morrison rank-1 update for a new observation row whose nonzero
   * entries are exactly at `indices` (every OPR design-matrix row is a 0/1
   * indicator over its rating-eligible teams, coefficient always 1).
   * Returns the updated inverse plus `pu` (the OLD inverse times this row
   * vector) and `denom`, so the caller can update the ratings vector in
   * O(n) without a second O(n^2) pass.
   */
  rank1Update(indices: readonly number[]): { next: IncrementalInverse; pu: Float64Array; denom: number } {
    const n = this.#size;
    const capacity = this.#capacity;
    const pu = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let sum = 0;
      for (const c of indices) sum += this.#at(r, c);
      pu[r] = sum;
    }
    let uPu = 0;
    for (const c of indices) uPu += pu[c]!;
    const denom = 1 + uPu;

    const data = this.#data.slice();
    for (let r = 0; r < n; r++) {
      const factor = pu[r]! / denom;
      if (factor === 0) continue;
      const base = r * capacity;
      for (let c = 0; c < n; c++) {
        data[base + c] = data[base + c]! - factor * pu[c]!;
      }
    }
    return { next: new IncrementalInverse(capacity, n, data), pu, denom };
  }
}

export interface IncrementalRidgeSolve {
  readonly teamIndex: ReadonlyMap<string, number>;
  readonly inverse: IncrementalInverse;
  readonly ratingsVector: Float64Array;
}

function emptyIncrementalSolve(): IncrementalRidgeSolve {
  return { teamIndex: new Map(), inverse: IncrementalInverse.empty(), ratingsVector: new Float64Array(0) };
}

function ratingsVectorToMap(teamIndex: ReadonlyMap<string, number>, vector: Float64Array): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const [team, idx] of teamIndex) ratings.set(team, vector[idx]!);
  return ratings;
}

/**
 * Applies one alliance observation to the incremental solve (classic RLS:
 * gain `k = Pu / denom`, then `x += k * (y - u^T x)`, `P -= outer(k, Pu)`),
 * returning the new solve state and a ratings `Map` for every team known
 * so far — the same shape `solveRidgeOpr` returns, computed incrementally
 * instead of by a fresh SVD.
 */
function applyObservation(
  solve: IncrementalRidgeSolve,
  observation: OprObservation,
  lambda: number
): { solve: IncrementalRidgeSolve; ratings: Map<string, number> } {
  let teamIndex = solve.teamIndex;
  let inverse = solve.inverse;
  let ratingsVector = solve.ratingsVector;

  for (const team of observation.teams) {
    if (!teamIndex.has(team)) {
      const next = new Map(teamIndex);
      next.set(team, next.size);
      teamIndex = next;
      inverse = inverse.withNewDimension(1 / lambda);
      const grown = new Float64Array(ratingsVector.length + 1);
      grown.set(ratingsVector);
      ratingsVector = grown;
    }
  }

  const indices = observation.teams.map((team) => teamIndex.get(team)!);

  if (indices.length === 0) {
    // Nothing to attribute (e.g. an alliance whose every team was a
    // surrogate) — a genuine no-op, matching solveRidgeOpr's behavior for
    // an all-zero design-matrix row.
    return {
      solve: { teamIndex, inverse, ratingsVector },
      ratings: ratingsVectorToMap(teamIndex, ratingsVector),
    };
  }

  const { next: nextInverse, pu, denom } = inverse.rank1Update(indices);

  let uX = 0;
  for (const idx of indices) uX += ratingsVector[idx]!;
  const residual = observation.allianceScore - uX;

  const nextRatingsVector = ratingsVector.slice();
  for (let r = 0; r < nextRatingsVector.length; r++) {
    nextRatingsVector[r] = nextRatingsVector[r]! + (pu[r]! / denom) * residual;
  }

  return {
    solve: { teamIndex, inverse: nextInverse, ratingsVector: nextRatingsVector },
    ratings: ratingsVectorToMap(teamIndex, nextRatingsVector),
  };
}

function logisticWinProbability(scoreMargin: number, scale: number = OPR_LOGISTIC_SCALE): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  // D-13 (plan 03-03, Rule 1 fix): `buildArtifact` (packages/harness/artifact.ts)
  // now REQUIRES every algorithm's `version` to carry the
  // `{codeVersion}+{paramSetName}` shape, throwing otherwise — a real
  // `pnpm harness --algorithm opr` run would break at artifact-build time
  // without this. OPR has no separate tuned parameter set (D-04: frozen,
  // not searched), so "baseline" is the honest, single named set.
  version: "2.0.0+baseline",

  initState(): OprState {
    return { observations: [], ratings: new Map(), incrementalSolve: emptyIncrementalSolve() };
  },

  predict(state: OprState, match: UpcomingMatch): Prediction {
    const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
    const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);
    const redScore = redTeams.reduce((sum, team) => sum + (state.ratings.get(team) ?? 0), 0);
    const blueScore = blueTeams.reduce((sum, team) => sum + (state.ratings.get(team) ?? 0), 0);
    const pRedWin = logisticWinProbability(redScore - blueScore);
    return {
      winner: pRedWin >= 0.5 ? "red" : "blue",
      pRedWin,
      redScore,
      blueScore,
    };
  },

  update(state: OprState, result: MatchResult): OprState {
    const fallbackAllianceScore = (result.redScore + result.blueScore) / 2;
    const meanShare = currentLeagueMeanPerTeamShare(state.observations, fallbackAllianceScore);

    const redObservation = allianceObservation(
      result.redTeams,
      result.redSurrogates,
      result.redScore,
      state.ratings,
      meanShare
    );
    const blueObservation = allianceObservation(
      result.blueTeams,
      result.blueSurrogates,
      result.blueScore,
      state.ratings,
      meanShare
    );

    const afterRed = applyObservation(state.incrementalSolve, redObservation, OPR_RIDGE_LAMBDA);
    const afterBlue = applyObservation(afterRed.solve, blueObservation, OPR_RIDGE_LAMBDA);

    const observations = [...state.observations, redObservation, blueObservation];
    return { observations, ratings: afterBlue.ratings, incrementalSolve: afterBlue.solve };
  },

  /**
   * D-27: OPR is the no-variance baseline — one unnamed value per team
   * (`TOTAL_METRIC_KEY`), no `spread`. When `teams` is omitted, every team
   * with a rating is returned.
   */
  teamMetrics(state: OprState, teams?: readonly string[]): TeamMetrics {
    const requestedTeams = teams ?? [...state.ratings.keys()];
    const result: TeamMetrics = {};
    for (const team of requestedTeams) {
      const rating = state.ratings.get(team);
      if (rating === undefined) continue;
      result[team] = { [TOTAL_METRIC_KEY]: { value: rating } };
    }
    return result;
  },
};
