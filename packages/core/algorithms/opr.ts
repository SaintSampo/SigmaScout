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
import type { AlgorithmModule, MatchResult, Prediction, UpcomingMatch } from "./types.js";

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
}

/**
 * Teams whose column should appear in the design matrix for this alliance:
 * every listed team except surrogates. D-07 requires that a surrogate
 * appearance produce no rating update for the surrogate itself; excluding
 * its column here is how that is enforced (its contribution is still
 * accounted for — see `allianceObservation` — via a subtracted offset, not
 * simply discarded).
 *
 * Disqualified teams are deliberately NOT filtered here — see the
 * disqualification-policy comment on `allianceObservation`. `MatchResult`
 * carries no dq field at all, by design, so a disqualified team is
 * indistinguishable from any other participant to this function and keeps
 * its column exactly like a normal player.
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

function logisticWinProbability(scoreMargin: number, scale: number = OPR_LOGISTIC_SCALE): number {
  return 1 / (1 + Math.exp(-scoreMargin / scale));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  version: "2.0.0",

  initState(): OprState {
    return { observations: [], ratings: new Map() };
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

    const observations = [...state.observations, redObservation, blueObservation];
    const teamIndex = buildTeamIndex(observations);
    const ratings = solveRidgeOpr(observations, teamIndex, OPR_RIDGE_LAMBDA);
    return { observations, ratings };
  },
};
