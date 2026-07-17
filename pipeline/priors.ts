// Estimate measurement noise (R) and cold-start priors from one ridge-OPR fit.
// Shared by the evaluator and the builder so both use identical seeding.

import type { ObservedMatch } from "./fetch";
import { solveRidgeOPR, fitRmse, type AllianceRow } from "./opr";
import type { ComponentId } from "../src/core/types";

export interface Priors {
  priorMean: Record<ComponentId, number>;
  priorVariance: Record<ComponentId, number>;
  /** Irreducible per-alliance residual variance per component (= Kalman R). */
  measurementNoise: Record<ComponentId, number>;
}

export function estimatePriors(
  matches: ObservedMatch[],
  components: ComponentId[],
): Priors {
  const teamIndex = new Map<number, number>();
  const idx = (t: number) =>
    teamIndex.get(t) ?? (teamIndex.set(t, teamIndex.size), teamIndex.size - 1);
  const rowsMeta = matches
    .filter((m) => m.redTeams.length === 3 && m.blueTeams.length === 3)
    .flatMap((m) => [
      { teams: m.redTeams.map(idx) as [number, number, number], by: m.redByComponent },
      { teams: m.blueTeams.map(idx) as [number, number, number], by: m.blueByComponent },
    ]);
  const n = teamIndex.size;

  const priorMean: Record<ComponentId, number> = {};
  const priorVariance: Record<ComponentId, number> = {};
  const measurementNoise: Record<ComponentId, number> = {};

  for (const c of components) {
    const rows: AllianceRow[] = rowsMeta.map((r) => ({
      teams: r.teams,
      score: r.by[c] ?? 0,
    }));
    const leagueMean = rows.reduce((s, r) => s + r.score, 0) / rows.length / 3;
    const prior = new Float64Array(n).fill(leagueMean);
    const x = solveRidgeOPR(n, rows, 1.0, prior);
    const rmse = fitRmse(rows, x);

    const mean = x.reduce((s, v) => s + v, 0) / n;
    let varSum = 0;
    for (const v of x) varSum += (v - mean) * (v - mean);

    priorMean[c] = mean;
    priorVariance[c] = varSum / n;
    measurementNoise[c] = rmse * rmse;
  }
  return { priorMean, priorVariance, measurementNoise };
}
