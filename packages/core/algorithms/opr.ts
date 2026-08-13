/**
 * OPR (Offensive Power Rating) baseline — a no-variance AlgorithmModule.
 *
 * RESEARCH.md Pattern 4: ridge-regularized least-squares over pooled
 * alliance-score observations. Pooling season-to-date observations (rather
 * than solving per-event) and adding a ridge penalty keeps the normal-
 * equation solve well-posed even when the design matrix is rank-deficient
 * early in an event — ratings shrink toward the mean in that regime, which
 * is correct cold-start behavior, not a defect.
 *
 * Season-scope pooling across events, surrogate exclusion (D-07), and
 * solver tuning are Plan 04's expansion — this tracer pools whatever
 * observations `update()` has been fed so far (one event's worth, for now)
 * and produces real, non-placeholder ratings.
 */
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { AlgorithmModule, MatchResult, Prediction, UpcomingMatch } from "./types.js";

const RIDGE_LAMBDA = 3;
/**
 * Logistic scale constant converting a predicted score margin into a win
 * probability: pRedWin = 1 / (1 + exp(-margin / LOGISTIC_SCALE)). Larger
 * values flatten the curve (less confident for a given margin); documented
 * here as the single source of truth for this tracer's calibration.
 */
const LOGISTIC_SCALE = 10;

interface AllianceObservation {
  teams: string[];
  allianceScore: number;
}

export interface OprState {
  observations: readonly AllianceObservation[];
  ratings: ReadonlyMap<string, number>;
}

function solveRidgeOpr(
  observations: readonly AllianceObservation[],
  teams: readonly string[],
  lambda = RIDGE_LAMBDA
): Map<string, number> {
  const ratings = new Map<string, number>();
  const teamIndex = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
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

function logisticWinProbability(scoreMargin: number): number {
  return 1 / (1 + Math.exp(-scoreMargin / LOGISTIC_SCALE));
}

export const opr: AlgorithmModule<OprState> = {
  id: "opr",
  version: "1.0.0",

  initState(): OprState {
    return { observations: [], ratings: new Map() };
  },

  predict(state: OprState, match: UpcomingMatch): Prediction {
    const redScore = match.redTeams.reduce((sum, team) => sum + (state.ratings.get(team) ?? 0), 0);
    const blueScore = match.blueTeams.reduce((sum, team) => sum + (state.ratings.get(team) ?? 0), 0);
    const pRedWin = logisticWinProbability(redScore - blueScore);
    return {
      winner: pRedWin >= 0.5 ? "red" : "blue",
      pRedWin,
      redScore,
      blueScore,
    };
  },

  update(state: OprState, result: MatchResult): OprState {
    const observations = [
      ...state.observations,
      { teams: result.redTeams, allianceScore: result.redScore },
      { teams: result.blueTeams, allianceScore: result.blueScore },
    ];
    const teams = Array.from(new Set(observations.flatMap((o) => o.teams)));
    const ratings = solveRidgeOpr(observations, teams);
    return { observations, ratings };
  },
};
