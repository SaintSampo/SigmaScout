// Model training. First real model: ridge-regularized component OPR. Given
// time-stamped observed matches, it fits per-team, per-component contributions
// and packages them into the SeasonStateFile the site consumes.
//
// This is the honest baseline. The Kalman/hierarchical filter (time-varying
// skill, gap-aware learning rate, walk-forward-fit hyperparameters) replaces the
// internals here later WITHOUT changing this function's signature or output.

import type {
  ComponentId,
  HyperParameters,
  Season,
  SeasonStateFile,
  TeamState,
} from "../src/core/types";
import type { ObservedMatch } from "./fetch";
import { solveRidgeOPR, fitRmse, type AllianceRow } from "./opr";

export interface TrainOptions {
  /** Scoring components to fit (season-specific), in display order. */
  components: ComponentId[];
  /** Ridge strength. Untuned for now; the state-space upgrade fits this. */
  lambda?: number;
}

export function buildSeasonModel(
  season: Season,
  matches: ObservedMatch[],
  options: TrainOptions,
): SeasonStateFile {
  const { components } = options;
  const lambda = options.lambda ?? 1.0;

  // 1. Index every team that appears.
  const teamIndex = new Map<number, number>();
  const teamList: number[] = [];
  const indexOf = (team: number): number => {
    let idx = teamIndex.get(team);
    if (idx === undefined) {
      idx = teamList.length;
      teamIndex.set(team, idx);
      teamList.push(team);
    }
    return idx;
  };

  const matchesPlayed = new Map<number, number>();
  const lastPlayed = new Map<number, string>();
  const bump = (team: number, at: string) => {
    matchesPlayed.set(team, (matchesPlayed.get(team) ?? 0) + 1);
    const prev = lastPlayed.get(team);
    if (!prev || at > prev) lastPlayed.set(team, at);
  };

  // 2. Build alliance rows once (team indices are shared across components).
  interface RowMeta {
    teams: [number, number, number];
    red: ObservedMatch["redByComponent"];
    blue: ObservedMatch["blueByComponent"];
    which: "red" | "blue";
  }
  const meta: RowMeta[] = [];
  for (const m of matches) {
    if (m.redTeams.length !== 3 || m.blueTeams.length !== 3) continue; // skip surrogates/oddities
    const red = m.redTeams.map(indexOf) as [number, number, number];
    const blue = m.blueTeams.map(indexOf) as [number, number, number];
    meta.push({ teams: red, red: m.redByComponent, blue: m.blueByComponent, which: "red" });
    meta.push({ teams: blue, red: m.redByComponent, blue: m.blueByComponent, which: "blue" });
    for (const t of m.redTeams) bump(t, m.playedAt);
    for (const t of m.blueTeams) bump(t, m.playedAt);
  }

  const n = teamList.length;
  const perComponent: Record<ComponentId, Float64Array> = {};
  const residualVariance: Record<ComponentId, number> = {};

  // 3. Solve ridge OPR per component.
  for (const component of components) {
    const rows: AllianceRow[] = meta.map((r) => ({
      teams: r.teams,
      score: (r.which === "red" ? r.red : r.blue)[component] ?? 0,
    }));

    // League prior: an average alliance's component score, split three ways.
    const meanAlliance =
      rows.reduce((s, r) => s + r.score, 0) / Math.max(rows.length, 1);
    const p0 = meanAlliance / 3;
    const prior = new Float64Array(n).fill(p0);

    const x = solveRidgeOPR(n, rows, lambda, prior);
    perComponent[component] = x;

    // Per-alliance irreducible residual variance = fit MSE (contention, refs, luck).
    const rmse = fitRmse(rows, x);
    residualVariance[component] = rmse * rmse;
  }

  // 4. Assemble per-team state. Team uncertainty is a baseline heuristic: it
  //    shrinks with matches played (the Kalman upgrade will produce this
  //    posterior variance properly).
  const teams: TeamState[] = teamList.map((team, idx) => {
    const gp = matchesPlayed.get(team) ?? 0;
    const comps: TeamState["components"] = {};
    for (const component of components) {
      const mean = perComponent[component][idx];
      const variance = residualVariance[component] / Math.max(gp, 1);
      comps[component] = { mean, variance };
    }
    return {
      team,
      components: comps,
      matchesPlayed: gp,
      lastUpdated: lastPlayed.get(team) ?? `${season}-01-01T00:00:00.000Z`,
    };
  });

  teams.sort((a, b) => a.team - b.team);

  const hyper: HyperParameters = baselineHyper(components, perComponent, teamList.length);

  return {
    model: { season, components, residualVariance, hyper },
    teams,
  };
}

/**
 * Placeholder hyperparameters for the baseline. processNoise/eventGapInflation
 * are unused by OPR (no time dynamics yet) but kept in the schema so the
 * state-space upgrade is a drop-in. priorMean/priorVariance are derived from the
 * fitted distribution so unseen teams get a sensible fallback.
 */
function baselineHyper(
  components: ComponentId[],
  perComponent: Record<ComponentId, Float64Array>,
  _n: number,
): HyperParameters {
  const processNoise: Record<ComponentId, number> = {};
  const priorVariance: Record<ComponentId, number> = {};
  const priorMean: Record<ComponentId, number> = {};
  for (const c of components) {
    const x = perComponent[c];
    const mean = x.reduce((s, v) => s + v, 0) / Math.max(x.length, 1);
    let varSum = 0;
    for (const v of x) varSum += (v - mean) * (v - mean);
    const variance = varSum / Math.max(x.length, 1);
    priorMean[c] = mean;
    priorVariance[c] = variance;
    processNoise[c] = variance * 0.02; // token; refit later
  }
  return { processNoise, priorVariance, priorMean, eventGapInflation: 3.0 };
}
