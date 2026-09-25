/**
 * The rank-distribution Monte Carlo core. This module computes, for a set
 * of remaining qualification matches and a set of per-team baselines, a
 * per-team distribution over finishing rank after `draws` simulated
 * completions of the event.
 *
 * A browser-safe leaf module: zero runtime imports, no DOM, no Node
 * built-in. Its four-argument form has exactly two callers — a browser Web
 * Worker (the live case) and a Node rewind-gap control-run script — and
 * both are untouched by the optional fifth parameter added for phase 10.
 * Having one implementation is what makes the measured
 * rewind-overconfidence figure describe the same math the visitor's browser
 * actually runs.
 *
 * THE OPTIONAL `onDraw` HOOK (phase 10, the district points ledger). The
 * returned histograms are per-rank DRAW COUNTS and carry no correlation:
 * nothing in them says "this team finished first on the same draw that team
 * finished eighth". The district ledger needs exactly that, because a
 * team's qualification points, alliance-selection points and playoff points
 * are all functions of one simulated event's finishing order and must be
 * summed within a single draw, not joined across aggregates. The per-draw
 * order already exists inside the draw loop and is discarded; `onDraw`
 * hands it out at the one point where it is complete. The hook consumes no
 * randomness and changes no output — the pre-existing tests are the oracle
 * for that, and the new ones assert it directly.
 *
 * Ranking Score, FRC's own ranking statistic (the value this pipeline
 * stores as `EventTeamSchema.rp`), is average total RP per match played.
 * That is exactly what this module sorts by.
 *
 * A match has one outcome. Drawing red's and blue's total RP as two fully
 * independent inversions of `redRpPmf`/`blueRpPmf` lets both alliances
 * receive the winning alliance's ranking points in a single draw, a state
 * the sport cannot produce. The coupled-draw decomposition fixes this
 * without touching the Monte Carlo itself: draw the match's outcome once
 * from a shared three-entry distribution (red win / tie / blue win), then
 * each alliance's bonus RP independently from its own bonus-only marginal,
 * then add the deterministic-given-outcome win/tie RP on top.
 *
 * A `SimMatchInput` with no `outcome` still takes the original two
 * independent-draw path, unchanged, reproducing today's histograms exactly
 * under the same seed, and Tests 1-14 (below) are its regression oracle.
 */

/**
 * Deterministic PRNG (Mulberry32), reimplemented here rather than imported
 * from a module with a heavier dependency graph — a real dependency should
 * never be dragged into the browser bundle for a 10-line PRNG. This copy
 * is the one `scripts/rpPredictThresholdsGolden.ts` imports from. Every
 * random value in this module traces back to this function.
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
 * floating-point-residue guard, unreachable in exact arithmetic — the real
 * guarantee that `pmf` is non-empty and sums to 1 is the publish-boundary
 * schema (`isValidPmf`), which this function does not re-implement. The
 * loop's bound is `pmf`'s own length, so no input shape can hang the caller.
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

/**
 * Raised by `simulateRanks`'s up-front validation pass when a match's pmf
 * is empty or contains a non-finite entry. Defense-in-depth against an
 * input that never went through the publish-boundary schema (`isValidPmf`)
 * — that schema owns the sum-to-1 tolerance; this error type deliberately
 * does not re-check it, since duplicating a numeric tolerance in two
 * places is how two tolerances drift apart.
 */
export class InvalidPmfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPmfError";
  }
}

/**
 * Raised by `simulateRanks`'s up-front validation pass when a match names a
 * team key absent from `baselines`. Thrown rather than silently dropped: a
 * dropped team's matches would simply vanish from the accumulation,
 * producing a complete, plausible-looking, wrong rank distribution.
 * Constructing an on-the-fly baseline entry for a team that appears in a
 * match but not on the roster is the caller's job, not this module's.
 */
export class UnknownTeamKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTeamKeyError";
  }
}

/**
 * The coupled-draw decomposition for one match. This module assigns no
 * meaning to any index — it never learns which entry of `outcomePmf` is a
 * "win". The index order is pinned by this shape's producers, in exactly
 * one place: `EventMatchSchema.matchOutcomePmf`'s doc comment.
 *
 * - `outcomePmf`: a distribution over mutually exclusive match outcomes.
 *   Three entries at every configuration (red win / tie / blue win).
 * - `redOutcomeRp` / `blueOutcomeRp`: index-aligned to `outcomePmf`, each
 *   alliance's ranking points under that outcome.
 * - `redBonusRpPmf` / `blueBonusRpPmf`: each alliance's own distribution
 *   over its bonus ranking points only, drawn independently of each other
 *   — red and blue share no team, so nothing couples their bonus draws.
 */
export interface SimMatchOutcomeInput {
  readonly outcomePmf: readonly number[];
  readonly redOutcomeRp: readonly number[];
  readonly blueOutcomeRp: readonly number[];
  readonly redBonusRpPmf: readonly number[];
  readonly blueBonusRpPmf: readonly number[];
}

/**
 * One remaining qualification match's simulation input: the two alliances'
 * team keys and their RP-total pmfs (already fold in win/tie/bonus RP — see
 * this file's header).
 *
 * `outcome` is optional and, when present, is what this match's draw is
 * actually built from. A single optional object rather than five optional
 * scalars is deliberate: it makes all-present-or-all-absent a compile-time
 * property instead of a runtime check. Absent means this match takes the
 * original two-independent-draw path over `redRpPmf`/`blueRpPmf`.
 */
export interface SimMatchInput {
  readonly redTeamKeys: readonly string[];
  readonly blueTeamKeys: readonly string[];
  readonly redRpPmf: readonly number[];
  readonly blueRpPmf: readonly number[];
  readonly outcome?: SimMatchOutcomeInput;
}

/** One team's starting state going into the simulation. */
export interface SimTeamBaseline {
  readonly teamKey: string;
  /**
   * A total, not a per-match average. `EventTeamSchema.rp` is TBA's
   * Ranking Score, itself a per-match average — a caller starting from it
   * must multiply by `matchesPlayed` before passing the result here.
   * Passing the average unconverted mis-ranks the entire field by a
   * factor of `matchesPlayed`.
   */
  readonly earnedRpSum: number;
  readonly matchesPlayed: number;
}

/**
 * Called once per draw, immediately after that draw's histogram entry has
 * been recorded, with the draw's complete finishing order.
 *
 * `order`'s entry at index `rank` is the index into `baselines` of the team
 * that finished at rank `rank + 1`. It is a permutation of every baseline
 * index on every draw: no index repeated, none missing.
 *
 * THE ARRAY IS THE FUNCTION'S OWN INTERNAL BUFFER, REUSED AND OVERWRITTEN
 * ON THE NEXT DRAW. A hook that needs to keep it must copy it. This is the
 * one way a caller can get a wrong answer from a correct hook, so it is
 * stated here rather than left to be discovered — a hook that pushes
 * `order` into an array will end up with `draws` references to the same
 * buffer, all holding the last draw's order.
 *
 * A hook consumes no randomness: `rng` is not passed to it, and the draw
 * loop's rng call sequence is identical with and without one. A hook that
 * throws propagates to the caller rather than being swallowed.
 */
export type SimDrawHook = (order: readonly number[], baselines: readonly SimTeamBaseline[]) => void;

/** The complete output of one `simulateRanks` call. */
export interface SimResult {
  /**
   * `teamKey` -> a length-`teamCount` `Int32Array` of per-rank draw counts
   * (never a probability), indexed `rank - 1` (index 0 is rank 1). This is
   * exactly the `dist` argument `continuousQuantile(dist, p, draws)`
   * expects unconverted. `Map` and `Int32Array` are both
   * structured-cloneable, so a Web Worker can `postMessage` a `SimResult`
   * as-is with no conversion step.
   */
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
  readonly draws: number;
}

/**
 * Computes a per-team rank-distribution histogram over `draws` simulated
 * completions of `remainingMatches`, starting each team from `baselines`.
 *
 * This function simulates every row it is handed, in the order given, and
 * owns no row-selection rule of its own: which rows reach it, and from
 * which point onward, is entirely `simulationInputs.ts`'s decision, made
 * against artifact fields this module never sees.
 *
 * Zero remaining matches is a valid input, not an error case: this is the
 * fully-played event, the common case across the corpus, and every team
 * simply keeps its baseline average, ranked identically in all `draws` draws.
 *
 * Before the draw loop runs, this function walks `remainingMatches` once to
 * validate each pmf (non-empty, every entry finite — not the sum-to-1
 * tolerance, which is the publish-boundary schema's own contract) and to
 * resolve every team key against `baselines`, raising
 * `InvalidPmfError`/`UnknownTeamKeyError` immediately rather than producing
 * a wrong-but-plausible result. This costs O(matches) once, rather than
 * O(draws x matches) if repeated inside the hot loop.
 *
 * `onDraw` is optional and positional, after `rng`, deliberately: that is
 * the minimal non-breaking shape, so both existing four-argument call sites
 * keep compiling untouched and the measured rewind-overconfidence figure
 * keeps describing the same math. See `SimDrawHook` for its contract —
 * in particular that the array it receives is reused between draws.
 */
export function simulateRanks(
  remainingMatches: readonly SimMatchInput[],
  baselines: readonly SimTeamBaseline[],
  draws: number,
  rng: () => number,
  onDraw?: SimDrawHook
): SimResult {
  const teamCount = baselines.length;
  const teamIndex = new Map<string, number>(baselines.map((baseline, i) => [baseline.teamKey, i]));
  const rankHistograms = new Map<string, Int32Array>(baselines.map((baseline) => [baseline.teamKey, new Int32Array(teamCount)]));

  function resolveTeamIndices(teamKeys: readonly string[], matchPosition: number): number[] {
    return teamKeys.map((teamKey) => {
      const index = teamIndex.get(teamKey);
      if (index === undefined) {
        throw new UnknownTeamKeyError(
          `simulateRanks: match at position ${matchPosition} names team "${teamKey}", which is absent from baselines`
        );
      }
      return index;
    });
  }

  function assertValidPmf(pmf: readonly number[], matchPosition: number, fieldName: string): void {
    if (pmf.length === 0) {
      throw new InvalidPmfError(`simulateRanks: match at position ${matchPosition} carries an empty ${fieldName}`);
    }
    for (const value of pmf) {
      if (!Number.isFinite(value)) {
        throw new InvalidPmfError(
          `simulateRanks: match at position ${matchPosition} carries a non-finite ${fieldName} entry (${value})`
        );
      }
    }
  }

  /** Every entry of an outcome-RP vector must be finite — an `undefined`/`NaN` entry would otherwise reach `rpSum` and produce a comparator ordering that is neither stable nor meaningful. */
  function assertFiniteVector(vector: readonly number[], matchPosition: number, fieldName: string): void {
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new InvalidPmfError(
          `simulateRanks: match at position ${matchPosition} carries a non-finite ${fieldName} entry (${value})`
        );
      }
    }
  }

  /** An outcome-RP vector shorter than `outcomePmf` yields `undefined` at the drawn index; `undefined + number` is `NaN`. */
  function assertOutcomeVectorLength(vector: readonly number[], expectedLength: number, matchPosition: number, fieldName: string): void {
    if (vector.length !== expectedLength) {
      throw new InvalidPmfError(
        `simulateRanks: match at position ${matchPosition} carries a ${fieldName} of length ${vector.length}, expected ${expectedLength} (outcomePmf's own length)`
      );
    }
  }

  const resolvedMatches = remainingMatches.map((match, matchPosition) => {
    assertValidPmf(match.redRpPmf, matchPosition, "redRpPmf");
    assertValidPmf(match.blueRpPmf, matchPosition, "blueRpPmf");
    if (match.outcome !== undefined) {
      const { outcomePmf, redOutcomeRp, blueOutcomeRp, redBonusRpPmf, blueBonusRpPmf } = match.outcome;
      assertValidPmf(outcomePmf, matchPosition, "outcomePmf");
      assertValidPmf(redBonusRpPmf, matchPosition, "redBonusRpPmf");
      assertValidPmf(blueBonusRpPmf, matchPosition, "blueBonusRpPmf");
      assertFiniteVector(redOutcomeRp, matchPosition, "redOutcomeRp");
      assertFiniteVector(blueOutcomeRp, matchPosition, "blueOutcomeRp");
      assertOutcomeVectorLength(redOutcomeRp, outcomePmf.length, matchPosition, "redOutcomeRp");
      assertOutcomeVectorLength(blueOutcomeRp, outcomePmf.length, matchPosition, "blueOutcomeRp");
    }
    return {
      redIndices: resolveTeamIndices(match.redTeamKeys, matchPosition),
      blueIndices: resolveTeamIndices(match.blueTeamKeys, matchPosition),
      redRpPmf: match.redRpPmf,
      blueRpPmf: match.blueRpPmf,
      outcome: match.outcome,
    };
  });

  // Accumulators allocated once, outside the draw loop, and reset in place
  // at the top of each draw (typed arrays, no per-draw allocation).
  const rpSum = new Float64Array(teamCount);
  const matchesPlayed = new Int32Array(teamCount);
  const order = new Array<number>(teamCount);

  /**
   * Orders two team indices by running average RP descending (FRC's
   * Ranking Score), with a lexicographic comparison on `teamKey` as the
   * only secondary term, which exists solely so a fixed seed reproduces
   * the same output run to run. TBA's own season-specific tiebreakers are
   * discarded at ingest, so no data exists in this pipeline to back a real
   * secondary ordering — the resulting order among teams tied on average
   * RP says nothing about how a real event's official tie-break would
   * separate them.
   *
   * A team with zero matches played after a draw ranks with an average of
   * `0`, never `NaN`: `0/0` would be `NaN`, and `NaN` in a comparator
   * produces an ordering that is neither stable nor meaningful. `0` is
   * also the honest value — it is what TBA's own rankings page shows for
   * a team that has played nothing.
   */
  function compareByAvgRpDesc(a: number, b: number): number {
    const avgA = matchesPlayed[a]! > 0 ? rpSum[a]! / matchesPlayed[a]! : 0;
    const avgB = matchesPlayed[b]! > 0 ? rpSum[b]! / matchesPlayed[b]! : 0;
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

    for (const match of resolvedMatches) {
      let redRp: number;
      let blueRp: number;
      if (match.outcome !== undefined) {
        // Draw order is outcome, then red bonus, then blue bonus — pinned
        // here because the order defines the rng stream; changing it later
        // silently changes every seeded output.
        const outcomeIndex = drawCategorical(match.outcome.outcomePmf, rng);
        const redBonusRp = drawCategorical(match.outcome.redBonusRpPmf, rng);
        const blueBonusRp = drawCategorical(match.outcome.blueBonusRpPmf, rng);
        redRp = match.outcome.redOutcomeRp[outcomeIndex]! + redBonusRp;
        blueRp = match.outcome.blueOutcomeRp[outcomeIndex]! + blueBonusRp;
      } else {
        // The original two-independent-draw path: reproduces today's
        // histograms exactly under the same seed. This is the path a
        // published artifact predating the decomposition takes, and Tests
        // 1-14 are its regression oracle.
        redRp = drawCategorical(match.redRpPmf, rng);
        blueRp = drawCategorical(match.blueRpPmf, rng);
      }
      for (const i of match.redIndices) {
        rpSum[i]! += redRp;
        matchesPlayed[i]! += 1;
      }
      for (const i of match.blueIndices) {
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
    // AFTER the histogram entry is recorded, so no hook can perturb it, and
    // outside the rng path entirely, so the draw loop's random sequence is
    // identical with and without a hook.
    if (onDraw !== undefined) onDraw(order, baselines);
  }

  return { rankHistograms, draws };
}
