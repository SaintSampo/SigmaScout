/**
 * Phase 8's rank-distribution Monte Carlo core (EVNT-07). This module
 * computes, for a set of remaining qualification matches and a set of
 * per-team baselines, a per-team distribution over finishing rank after
 * `draws` simulated completions of the event.
 *
 * A browser-safe leaf module: zero runtime imports, no DOM, no Node
 * built-in. It has exactly TWO callers — 08-07's browser Web Worker (the
 * live/2027 case) and 08-08's Node `measureRewindGap.ts` control-run script
 * (the D-02 rewind-honesty measurement). Having ONE implementation is what
 * makes 08-08's measured rewind-overconfidence figure describe the same
 * math the visitor's browser actually runs — a second, hand-synced copy
 * would silently turn that figure into a comparison between two
 * implementations instead of two prediction sets.
 *
 * Ranking Score, FRC's own ranking statistic (`sort_orders[0]`, the value
 * this pipeline stores as `EventTeamSchema.rp`,
 * `packages/harness/pageArtifacts.ts`'s own doc comment: "TBA's Ranking
 * Score... a per-match AVERAGE"), is average total RP per match played.
 * That is exactly what this module sorts by — no separate win/loss model,
 * no separately-drawn winner: `redRpPmf`/`blueRpPmf` are already
 * distributions over an alliance's TOTAL RP for a match (win/tie RP and
 * bonus RP already folded into the domain, see `drawCategorical`'s call
 * site in `simulateRanks` below), so drawing one value per alliance per
 * match and dividing the running sum by matches played reproduces Ranking
 * Score directly.
 */

/**
 * Deterministic PRNG (Mulberry32), copied verbatim a THIRD time — the
 * existing two copies are `packages/harness/identifiability.ts` and
 * `packages/core/algorithms/sigma1/rp/distribution.ts`, both citing the
 * same source and both documenting this as the established convention for
 * this primitive (`rp/distribution.ts`'s own file header: "cite, don't
 * rederive"). Not imported from `rp/distribution.ts` because that module
 * pulls in `ml-matrix` at module scope for its Cholesky decomposition —
 * importing it here would drag a real dependency into the browser bundle
 * for a 10-line PRNG (PD-06). Every random value in this module traces
 * back to this function; the platform's built-in non-seedable random
 * source never appears anywhere in this file.
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
 * Cumulative-sum inversion over a discrete pmf: draw `u` once from `rng`,
 * walk the array accumulating, and return the first index where the
 * running total exceeds `u`. The `pmf.length - 1` fallback is a
 * floating-point-residue guard, unreachable in exact arithmetic, and is
 * defense-in-depth ONLY — the real guarantee that `pmf` is non-empty and
 * sums to 1 within tolerance is the publish-boundary refinement
 * (`isValidPmf`, `packages/harness/pageArtifacts.ts`), which this function
 * does not re-implement. The loop's bound is `pmf`'s own length: there is
 * no retry and no unbounded loop, so no input shape can hang the caller.
 */
export function drawCategorical(pmf: readonly number[], rng: () => number): number {
  const u = rng();
  let cumulative = 0;
  for (let i = 0; i < pmf.length; i++) {
    cumulative += pmf[i]!;
    if (u < cumulative) return i;
  }
  return pmf.length - 1;
}

/** One remaining qualification match's simulation input: the two alliances' team keys and their RP-total pmfs (already fold in win/tie/bonus RP — see this file's header). */
export interface SimMatchInput {
  readonly redTeamKeys: readonly string[];
  readonly blueTeamKeys: readonly string[];
  readonly redRpPmf: readonly number[];
  readonly blueRpPmf: readonly number[];
}

/** One team's starting state going into the simulation. */
export interface SimTeamBaseline {
  readonly teamKey: string;
  /**
   * A TOTAL, not a per-match average. Stated first because this is the
   * single highest-consequence unit ambiguity a caller of this module can
   * get wrong (PD-02): `EventTeamSchema.rp` (`pageArtifacts.ts`'s own doc
   * comment) is TBA's Ranking Score, itself a per-match AVERAGE — a caller
   * starting from it must multiply by `matchesPlayed` before passing the
   * result here. Passing the average unconverted mis-ranks the entire
   * field by a factor of `matchesPlayed`, and no test on either side of
   * this boundary would catch it alone.
   */
  readonly earnedRpSum: number;
  readonly matchesPlayed: number;
}

/** The complete output of one `simulateRanks` call. */
export interface SimResult {
  /**
   * `teamKey` -> a length-`teamCount` `Int32Array` of per-rank DRAW COUNTS
   * (never a probability), indexed `rank - 1` (index 0 is rank 1). This is
   * exactly the `dist` argument 08-04's `continuousQuantile(dist, p,
   * draws)` expects unconverted. `Map` and `Int32Array` are both
   * structured-cloneable, so 08-07's Worker can `postMessage` a `SimResult`
   * as-is with no conversion step.
   */
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
  readonly draws: number;
}

/**
 * Computes a per-team rank-distribution histogram over `draws` simulated
 * completions of `remainingMatches`, starting each team from `baselines`.
 */
export function simulateRanks(
  remainingMatches: readonly SimMatchInput[],
  baselines: readonly SimTeamBaseline[],
  draws: number,
  rng: () => number
): SimResult {
  const teamCount = baselines.length;
  const teamIndex = new Map<string, number>(baselines.map((baseline, i) => [baseline.teamKey, i]));
  const rankHistograms = new Map<string, Int32Array>(baselines.map((baseline) => [baseline.teamKey, new Int32Array(teamCount)]));

  // Accumulators allocated ONCE, outside the draw loop, and reset in place
  // at the top of each draw -- following `rp/distribution.ts`'s own Monte
  // Carlo loop shape (typed arrays, no per-draw allocation).
  const rpSum = new Float64Array(teamCount);
  const matchesPlayed = new Int32Array(teamCount);
  const order = new Array<number>(teamCount);

  function compareByAvgRpDesc(a: number, b: number): number {
    const avgA = rpSum[a]! / matchesPlayed[a]!;
    const avgB = rpSum[b]! / matchesPlayed[b]!;
    if (avgA !== avgB) return avgB - avgA;
    const keyA = baselines[a]!.teamKey;
    const keyB = baselines[b]!.teamKey;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  }

  for (let draw = 0; draw < draws; draw++) {
    for (let i = 0; i < teamCount; i++) {
      rpSum[i] = baselines[i]!.earnedRpSum;
      matchesPlayed[i] = baselines[i]!.matchesPlayed;
    }

    for (const match of remainingMatches) {
      const redRp = drawCategorical(match.redRpPmf, rng);
      const blueRp = drawCategorical(match.blueRpPmf, rng);
      for (const teamKey of match.redTeamKeys) {
        const i = teamIndex.get(teamKey)!;
        rpSum[i]! += redRp;
        matchesPlayed[i]! += 1;
      }
      for (const teamKey of match.blueTeamKeys) {
        const i = teamIndex.get(teamKey)!;
        rpSum[i]! += blueRp;
        matchesPlayed[i]! += 1;
      }
    }

    for (let i = 0; i < teamCount; i++) order[i] = i;
    order.sort(compareByAvgRpDesc);
    for (let rank = 0; rank < teamCount; rank++) {
      const teamI = order[rank]!;
      rankHistograms.get(baselines[teamI]!.teamKey)![rank]! += 1;
    }
  }

  return { rankHistograms, draws };
}
