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
 * That is exactly what this module sorts by.
 *
 * A match has ONE outcome. Drawing red's and blue's total RP as two fully
 * INDEPENDENT inversions of `redRpPmf`/`blueRpPmf` — the module's original
 * design — lets both alliances receive the winning alliance's ranking
 * points in a single draw, a state the sport cannot produce. D-15 (plan
 * 09-07) fixes this without touching the Monte Carlo itself (D-15 keeps it,
 * developer-confirmed: rank has no tractable closed form and the draw
 * captures for free the coupling where teammates on an alliance receive the
 * SAME draw): draw the match's outcome ONCE from a shared three-entry
 * distribution (red win / tie / blue win), then each alliance's BONUS RP
 * independently from its own bonus-only marginal, then add the
 * deterministic-given-outcome win/tie RP on top. This is approach (b) of
 * 09-RESEARCH.md's assumption A3 — chosen over (a), a genuinely joint
 * red/blue total-RP pmf, because the bonus-only marginal 09-04 already
 * exports separately is exactly what (b) needs and (a) would require
 * reconstructing a joint distribution this project has no measured form
 * for.
 *
 * A `SimMatchInput` with no `outcome` still takes the ORIGINAL two
 * independent-draw path, unchanged, reproducing today's histograms exactly
 * under the same seed — the path every artifact published before 09-10's
 * republish takes, and Tests 1-14 (below) are its regression oracle.
 */

/**
 * Deterministic PRNG (Mulberry32), copied verbatim a THIRD time — the
 * existing two copies are `packages/harness/identifiability.ts` and
 * `packages/core/rankingPoints/distribution.ts`, both citing the
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

/**
 * Raised by `simulateRanks`'s up-front validation pass (PD-04) when a
 * match's pmf is empty or contains a non-finite entry. This is
 * defense-in-depth against an input that never went through the
 * publish-boundary schema (`isValidPmf`, `packages/harness/pageArtifacts.ts`)
 * — that schema is the primary gate and owns the sum-to-1 tolerance; this
 * error type deliberately does NOT re-check that tolerance, since
 * duplicating a numeric tolerance in two places is how two tolerances drift
 * apart.
 */
export class InvalidPmfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPmfError";
  }
}

/**
 * Raised by `simulateRanks`'s up-front validation pass (PD-03) when a match
 * names a team key absent from `baselines`. Thrown rather than silently
 * dropped: a dropped team's matches would simply vanish from the
 * accumulation, producing a complete, plausible-looking, WRONG rank
 * distribution — the failure mode a site whose premise is honest numbers
 * cannot absorb. Constructing an on-the-fly baseline entry for a team that
 * appears in a match but not on the roster (RESEARCH assumption A2) is
 * 08-11's job, not this module's.
 */
export class UnknownTeamKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTeamKeyError";
  }
}

/**
 * The coupled-draw decomposition for one match (D-15, plan 09-07). This
 * module assigns NO MEANING to any index — it never learns which entry of
 * `outcomePmf` is a "win" — the same refusal this file already makes about
 * row selection. The index order is pinned by this shape's PRODUCERS, in
 * exactly one place: `EventMatchSchema.matchOutcomePmf`'s doc comment
 * (`packages/harness/pageArtifacts.ts`). This interface only documents what
 * each array IS, never what a given index MEANS.
 *
 * - `outcomePmf`: a distribution over mutually exclusive match outcomes.
 *   Three entries at every configuration (red win / tie / blue win); the
 *   tie entry is ~0 until D-14's discrete score-margin tie model is
 *   selected, so the shape never changes when the model does.
 * - `redOutcomeRp` / `blueOutcomeRp`: index-aligned to `outcomePmf`, each
 *   alliance's ranking points under that outcome.
 * - `redBonusRpPmf` / `blueBonusRpPmf`: each alliance's own distribution
 *   over its BONUS ranking points only, drawn INDEPENDENTLY of each other —
 *   red and blue share no team, so nothing couples their bonus draws.
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
 * `outcome` (D-15, plan 09-07) is OPTIONAL and, when present, is what this
 * match's draw is actually built from — see `SimMatchOutcomeInput`'s own
 * doc comment. A single optional OBJECT rather than five optional scalars
 * is deliberate: it makes all-present-or-all-absent a compile-time property
 * instead of a runtime check. Absent means this match takes the ORIGINAL
 * two-independent-draw path over `redRpPmf`/`blueRpPmf` — the path every
 * artifact published before 09-10's republish takes.
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
 *
 * This function simulates every row it is handed, in the order given, and
 * owns no row-selection rule of its own (D-13): which `compLevel === "qm"`
 * rows reach it — and from which point onward, whether that is the live
 * unplayed case or a rewind into an already-played match — is entirely
 * 08-11's `simulationInputs.ts` decision, made against artifact fields
 * (competition level, played/unplayed status) this module never sees. The
 * corpus-level exclusion categories (offseason, surrogate-affected,
 * quarantined) are not representable on the event artifact this module's
 * caller reads from, so a filter here would assert a distinction the data
 * does not carry.
 *
 * Zero remaining matches is a VALID input, not an error case: this is the
 * fully-played event, the common case across the corpus (only 41 of 1,353
 * events have any unplayed qualification match at all), and every team
 * simply keeps its baseline average, ranked identically in all `draws`
 * draws.
 *
 * Before the draw loop runs, this function walks `remainingMatches` ONCE
 * (PD-04) to validate each pmf (non-empty, every entry finite — NOT the
 * sum-to-1 tolerance, which is the publish-boundary schema's own contract,
 * `isValidPmf`) and to resolve every team key against `baselines` (PD-03),
 * raising `InvalidPmfError`/`UnknownTeamKeyError` immediately rather than
 * producing a wrong-but-plausible result. This costs O(matches) once,
 * rather than O(draws x matches) if repeated inside the hot loop.
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

  /** Every entry of an outcome-RP vector must be finite (D-15, plan 09-07) — an `undefined`/`NaN` entry would otherwise reach `rpSum` and produce a comparator ordering that is neither stable nor meaningful. */
  function assertFiniteVector(vector: readonly number[], matchPosition: number, fieldName: string): void {
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new InvalidPmfError(
          `simulateRanks: match at position ${matchPosition} carries a non-finite ${fieldName} entry (${value})`
        );
      }
    }
  }

  /** An outcome-RP vector shorter than `outcomePmf` yields `undefined` at the drawn index; `undefined + number` is `NaN` (D-15, plan 09-07). */
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

  // Accumulators allocated ONCE, outside the draw loop, and reset in place
  // at the top of each draw -- following `rp/distribution.ts`'s own Monte
  // Carlo loop shape (typed arrays, no per-draw allocation).
  const rpSum = new Float64Array(teamCount);
  const matchesPlayed = new Int32Array(teamCount);
  const order = new Array<number>(teamCount);

  /**
   * Orders two team indices by running average RP descending (FRC's
   * Ranking Score), with a lexicographic comparison on `teamKey` as the
   * only secondary term. That secondary term exists SOLELY so a fixed seed
   * reproduces the same output run to run (D-14) — it carries no other
   * meaning. `sort_orders[0]`, "Ranking Score", is the only sort order this
   * pipeline ever ingests (`packages/ingest/rankings.ts`,
   * `packages/corpus/schema.sql`); TBA's own season-specific tiebreakers
   * (`sort_orders[1..]`) are read at ingest and discarded, so no data
   * exists anywhere in this pipeline to back a real secondary ordering. The
   * resulting order among teams tied on average RP therefore says nothing
   * about how a real event's official tie-break would separate them —
   * stated here as the positive fact this module rests on, not as a list of
   * claims it declines to make.
   *
   * A team with zero matches played after a draw (`matchesPlayed[i] === 0`)
   * ranks with an average of `0`, never `NaN` (PD-05): `0/0` would be
   * `NaN`, and `NaN` in a comparator produces an ordering that is neither
   * stable nor meaningful. `0` is also the honest value — it is what TBA's
   * own rankings page shows for a team that has played nothing.
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
        // Draw order is OUTCOME, then RED bonus, then BLUE bonus — pinned
        // here because the order defines the rng stream; changing it later
        // silently changes every seeded output (D-15, plan 09-07).
        const outcomeIndex = drawCategorical(match.outcome.outcomePmf, rng);
        const redBonusRp = drawCategorical(match.outcome.redBonusRpPmf, rng);
        const blueBonusRp = drawCategorical(match.outcome.blueBonusRpPmf, rng);
        redRp = match.outcome.redOutcomeRp[outcomeIndex]! + redBonusRp;
        blueRp = match.outcome.blueOutcomeRp[outcomeIndex]! + blueBonusRp;
      } else {
        // The ORIGINAL two-independent-draw path (pre-09-07): reproduces
        // today's histograms exactly under the same seed. This is the path
        // a published artifact predating the decomposition takes, and
        // Tests 1-14 are its regression oracle.
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
  }

  return { rankHistograms, draws };
}
