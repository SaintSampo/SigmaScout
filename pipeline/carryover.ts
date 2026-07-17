// Cross-season carryover — the top of the hierarchy.
//
// Ratings live in per-game point units (a 2019 "40" and a 2024 "54" aren't
// comparable), so we can't carry raw means across seasons. Instead we normalize
// each team's end-of-season overall rating to a season-agnostic z-score, then
// de-normalize a REGRESSED version of it (rho * z) into the next season's point
// scale to seed that team's prior. Rookies have no z, so they fall back to the
// league prior with full uncertainty — exactly the rookie-vs-returning-powerhouse
// distinction we want.

import type { ComponentId, SeasonStateFile } from "../src/core/types";
import type { Priors } from "./priors";
import type { TeamPrior } from "./kalman";

/** Teams need at least this many matches to be placed reliably on the z-scale. */
export const MIN_GP = 12;

/** Residual prior variance for a returning team never drops below this fraction
 *  of the rookie prior variance (a year passed — real change is possible). */
const RETURN_VAR_FLOOR = 0.25;

const overallOf = (state: SeasonStateFile, comps: ComponentId[], t: SeasonStateFile["teams"][number]) =>
  comps.reduce((s, c) => s + t.components[c].mean, 0);

/**
 * Annotate each team with its normalized rating (z-score of overall within the
 * season, over established teams) and return the z-map to carry forward. Mutates
 * `state.teams[i].normalizedRating`.
 */
export function normalizeSeason(
  state: SeasonStateFile,
  minGp = MIN_GP,
): Map<number, number> {
  const comps = state.model.components;
  const established = state.teams.filter((t) => t.matchesPlayed >= minGp);
  const overalls = established.map((t) => overallOf(state, comps, t));
  const mean = overalls.reduce((s, v) => s + v, 0) / Math.max(overalls.length, 1);
  const variance =
    overalls.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
    Math.max(overalls.length, 1);
  const sd = Math.sqrt(variance) || 1;

  const z = new Map<number, number>();
  for (const t of state.teams) {
    if (t.matchesPlayed >= minGp) {
      const zi = (overallOf(state, comps, t) - mean) / sd;
      t.normalizedRating = Math.round(zi * 1000) / 1000;
      z.set(t.team, zi);
    }
  }
  return z;
}

/**
 * Turn last season's z-map into per-team priors for the NEXT season, scaled into
 * that season's point units via its league mean/sd (from a ridge-OPR fit).
 * @param rho  carryover strength in [0,1]; 0 = no carryover (flat league prior).
 */
export function buildTeamPriors(
  prevZ: Map<number, number>,
  nextPriors: Priors,
  components: ComponentId[],
  rho: number,
): Map<number, TeamPrior> {
  const out = new Map<number, TeamPrior>();
  if (rho <= 0 || prevZ.size === 0) return out;

  // League overall mean/sd for the upcoming season (components ~independent).
  const muNext = components.reduce((s, c) => s + nextPriors.priorMean[c], 0);
  const sdNext = Math.sqrt(
    components.reduce((s, c) => s + nextPriors.priorVariance[c], 0),
  );
  if (muNext <= 0) return out; // degenerate; skip carryover

  const varFactor = Math.max(RETURN_VAR_FLOOR, 1 - rho * rho);

  for (const [team, z] of prevZ) {
    const priorOverall = muNext + rho * z * sdNext;
    const mean: Record<ComponentId, number> = {};
    const variance: Record<ComponentId, number> = {};
    for (const c of components) {
      // Keep the league-average component split; scale its level by the team's
      // carried strength. (Components aren't semantically stable across games,
      // so we carry overall strength, not per-component shape.)
      const frac = nextPriors.priorMean[c] / muNext;
      mean[c] = priorOverall * frac;
      variance[c] = nextPriors.priorVariance[c] * varFactor;
    }
    out.set(team, { mean, variance });
  }
  return out;
}
