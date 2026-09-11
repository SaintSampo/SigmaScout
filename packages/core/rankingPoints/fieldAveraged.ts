/**
 * The FIELD-AVERAGED pre-schedule predictor (plan 09-09 rung 1; D-16, D-17).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY IT IS THE SAME INSIGHT ONE LEVEL UP
 * ---------------------------------------------------------------------------
 *
 * Until now a pre-schedule rank band was produced by drawing 20 synthetic
 * qualification schedules from a licensed cheesy-arena template grid, pricing
 * every synthetic match in every one of them through the real RP path, and
 * baking a rank distribution over all 20. D-16 names what those 20 schedules
 * actually were: a MONTE CARLO APPROXIMATION OF AN EXPECTATION OVER SCHEDULE
 * RANDOMNESS — the same insight as the RP pmf (plan 09-04), one level up. If
 * schedule randomness is averaged away in the end, concrete schedules were
 * never the thing that was needed. What is needed is the DISTRIBUTION A RANDOM
 * SCHEDULE INDUCES, and that has a closed form.
 *
 * So: summarise the event's roster into field-level statistics — the mean AND
 * the variance of per-team contributions across that roster, which is what
 * carries both match-to-match noise and partner-quality spread — build each
 * team's field-averaged per-match pmf from its own belief plus those
 * statistics, and convolve `matchesPerTeam` copies of it for the season total.
 * No schedule is generated anywhere in this module.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NEW DESIGN, COMPOSED FROM NAMED BUILDING BLOCKS
 * ---------------------------------------------------------------------------
 *
 * 09-PATTERNS.md searched the tree for an analog to this math and recorded
 * "No Analog Found": the building blocks exist — `RpMomentsAccumulator`
 * (`empiricalMoments.ts`), `analyticPmf.ts`'s convolution machinery, and
 * `simulateRanks`' zero-baseline mode — but no single close analog does. This
 * module is therefore composed from those three, deliberately, rather than
 * copied from one file. Every formula below is written out in plan 09-09's
 * `## The rung-1 construction, specified` section, and the doc comments here
 * carry the three parts of it that are DECISIONS rather than algebra.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST CAVEATS — stated here because this is where they will be read
 * ---------------------------------------------------------------------------
 *
 * D-16 requires these to ship WITH the thing rather than living in a planning
 * document, so they are here, in the module a reader lands in:
 *
 *   1. The field-averaged form assumes a team's matches are NEAR-INDEPENDENT.
 *      In reality a team's partners differ each match, which is what makes the
 *      assumption reasonable, but the matches of one event are not literally
 *      independent draws.
 *
 *   2. It WASHES OUT COUPLING from teams that share specific matches — two
 *      teams scheduled against each other in a real schedule have correlated
 *      outcomes, and nothing here represents that. AND, IN THE SAME BREATH,
 *      THE 20-SCHEDULE APPROACH WASHED THAT SAME COUPLING OUT BY DESIGN: it
 *      averaged over 20 independent shuffles precisely so no particular
 *      pairing survived into the published band. This is a SHARED property of
 *      both forms, not a defect unique to this one, and stating the first
 *      without the second would misrepresent the comparison.
 *
 *   3. The COMPOSITION-INDUCED SPREAD is treated as GAUSSIAN — the same
 *      approximation class used elsewhere in this pipeline, and the one D-16
 *      explicitly names and accepts. The exact mixture over all C(n-1, 2)
 *      partner pairs crossed with all opposing triples is computable and is
 *      deliberately not computed: it is roughly 5.7 million `analyticRpPmf`
 *      calls per team on a 40-team roster.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS NOT
 * ---------------------------------------------------------------------------
 *
 * A browser-safe leaf: its whole runtime import graph is `analyticPmf.ts` and
 * the RP leaves that module already reaches. No Node built-in, no third-party
 * package, no `ml-matrix`. That claim is a MACHINE CHECK, not a sentence —
 * `packages/harness/browserSafeSchemas.test.ts` registers this file as a
 * scanned entry point, exactly as 09-03's `marginals.ts` and 09-04's
 * `analyticPmf.ts` are registered.
 *
 * It also draws no random number of its own. Every formula here is pure
 * arithmetic over pmfs; the only randomness anywhere in the rung-1 arm is
 * `simulateRanks`' own seeded stream, reached through the artifact's published
 * `seed`.
 */

import { analyticRpPmf, convolvePmf } from "./analyticPmf.js";
import type { RpRuleModule } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";
import type { SimMatchInput, SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";

/**
 * The number of teams on one FRC alliance. Named once here rather than spelled
 * as a bare `3` in five formulas below — every `(ALLIANCE_SIZE - 1)` in this
 * file is "team `t`'s unknown partners" and every bare `ALLIANCE_SIZE` is "a
 * whole alliance", and a reader should be able to tell those two apart without
 * counting.
 */
export const ALLIANCE_SIZE = 3;

/**
 * ONE team's own contribution to its event's field, indexed against
 * `ruleModule.thresholdVariables` order.
 *
 * Every field here is read from the instant the existing baked path already
 * read it from — see `packages/harness/preSchedule.ts`'s
 * `buildFieldContributions` for the four sources and their provenance.
 */
export interface FieldTeamContribution {
  readonly teamKey: string;
  /** This team's OWN per-variable mean belief — a one-team `momentsFor` call's `meanVector`. */
  readonly variableMeans: readonly number[];
  /** This team's OWN per-variable variance — the same call's `varianceBlock` diagonal. */
  readonly variableVariances: readonly number[];
  /** The algorithm's own per-team total (`TOTAL_METRIC_KEY`). */
  readonly scoreMean: number;
  /** The team's consistency figure SQUARED — Sigma Score for BPR, Swing Factor otherwise. Matches `allianceSwingBandVariance`'s per-team term exactly. */
  readonly bandVariance: number;
}

/**
 * The event's roster summarised into field-level statistics.
 *
 * RECOMPUTED PER EVENT, NEVER SEASON-WIDE (09-RESEARCH.md Open Question 2).
 * The reasoning is load-bearing rather than a preference: a roster is 20-100
 * teams, the publish pipeline already iterates per event so recomputing costs
 * nothing, and a season-wide average would degrade an unusually strong or
 * unusually weak field in exactly the direction that makes its rank bands
 * wrong — a strong field's teams would each look better against the season's
 * average opponent than against the opponents they will actually face.
 */
export interface FieldStatistics {
  /** Threshold-variable names in `ruleModule.thresholdVariables` order — every array here is indexed against this order. */
  readonly variableNames: readonly string[];
  /** The roster size the statistics were computed over. */
  readonly teamCount: number;
  readonly meanOfVariableMeans: readonly number[];
  readonly meanOfVariableVariances: readonly number[];
  /** POPULATION variance (divide by `n`) of per-team means — the PARTNER-QUALITY SPREAD. See `fieldStatistics`' doc comment. */
  readonly varianceOfVariableMeans: readonly number[];
  readonly meanOfScoreMeans: number;
  /** POPULATION variance of per-team score means — the score-side partner-quality spread. */
  readonly varianceOfScoreMeans: number;
  readonly meanOfBandVariances: number;
}

/** Both alliances of team `t`'s hypothetical average qualification match. */
export interface FieldAveragedAlliancePair {
  /** Team `t`'s own alliance: `t` plus `ALLIANCE_SIZE - 1` average partners. */
  readonly own: AllianceRpMoments;
  /** The opposing alliance: `ALLIANCE_SIZE` average teams. */
  readonly opponent: AllianceRpMoments;
}

/** Thrown by `seasonTotalPmf` when asked to fold a non-positive number of matches — see its doc comment. */
export class InvalidMatchesPerTeamError extends Error {
  constructor(matchesPerTeam: number) {
    super(
      `seasonTotalPmf: matchesPerTeam must be a positive integer, got ${matchesPerTeam} — an event with no matches has no season total, and silently returning a point mass at zero RP would publish a confident wrong answer for every team`
    );
    this.name = "InvalidMatchesPerTeamError";
  }
}

/** Population mean of a numeric array. Callers guarantee non-empty. */
function meanOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * POPULATION variance (divide by `n`, NOT `n - 1`) of a numeric array.
 *
 * This is the whole field, not a sample drawn from a larger one: every team
 * that will play this event is in the array, so there is no wider population
 * to estimate and Bessel's correction has no referent. Dividing by `n - 1`
 * here would inflate the partner-spread term and WIDEN EVERY BAND in the
 * sample — and nothing downstream can tell a too-wide band from a correct one,
 * which is why this choice is pinned by a test that asserts the population
 * value AND asserts the sample value is not produced (T-09-09-04).
 */
function populationVarianceOf(values: readonly number[]): number {
  const mean = meanOf(values);
  let total = 0;
  for (const value of values) total += (value - mean) ** 2;
  return total / values.length;
}

/**
 * Summarises one event's roster into its field statistics.
 *
 * `varianceOfVariableMeans` and `varianceOfScoreMeans` are THE
 * PARTNER-QUALITY SPREAD. They are what D-16 means by "capturing both
 * match-to-match noise and partner-quality spread", and they are the term a
 * single-composition probe would miss entirely — omitting them produces bands
 * that are TOO NARROW, which is the specific failure mode this construction
 * exists to avoid.
 *
 * A team with no folded observations contributes zeros rather than being
 * skipped. That is deliberate: a cold team really is part of the field, and
 * dropping it would shift `meanOfVariableMeans` upward and silently narrow
 * every band in the event.
 */
export function fieldStatistics(
  contributions: readonly FieldTeamContribution[],
  variableNames: readonly string[]
): FieldStatistics {
  if (contributions.length === 0) {
    throw new Error("fieldStatistics: an empty roster has no field statistics — the caller must skip the event instead");
  }
  const perVariable = variableNames.map((_, v) => ({
    means: contributions.map((c) => c.variableMeans[v] ?? 0),
    variances: contributions.map((c) => c.variableVariances[v] ?? 0),
  }));
  const scoreMeans = contributions.map((c) => c.scoreMean);
  const bandVariances = contributions.map((c) => c.bandVariance);

  return {
    variableNames: [...variableNames],
    teamCount: contributions.length,
    meanOfVariableMeans: perVariable.map((p) => meanOf(p.means)),
    meanOfVariableVariances: perVariable.map((p) => meanOf(p.variances)),
    varianceOfVariableMeans: perVariable.map((p) => populationVarianceOf(p.means)),
    meanOfScoreMeans: meanOf(scoreMeans),
    varianceOfScoreMeans: populationVarianceOf(scoreMeans),
    meanOfBandVariances: meanOf(bandVariances),
  };
}

/**
 * Team `t`'s hypothetical AVERAGE qualification match, as two
 * `AllianceRpMoments`: `t` plus two average partners, against three average
 * opponents.
 *
 * ---------------------------------------------------------------------------
 * THE LEADING `ALLIANCE_SIZE *` ON EVERY VARIANCE ROW IS NOT A FUDGE FACTOR
 * ---------------------------------------------------------------------------
 *
 * It is `momentsFor`'s OWN EVEN-SPLIT UNDO, reproduced rather than invented.
 * `empiricalMoments.ts` folds each team's belief from `allianceValue /
 * rosterSize`, so a team's belief variance estimates the WHOLE ALLIANCE's
 * variance divided by `rosterSize²`; `momentsFor` corrects for that by scaling
 * the summed per-team variances by `roster.length² / contributing`, which on a
 * full alliance reduces to `ALLIANCE_SIZE × Σ Var(belief)`. The field-averaged
 * form substitutes the FIELD MEAN for the `ALLIANCE_SIZE - 1` unknown partners
 * INSIDE that same expression rather than around it — which is why the factor
 * multiplies the whole `(own + partners)` sum and not just the partner half.
 *
 * ---------------------------------------------------------------------------
 * WHY A ONE-TEAM `momentsFor` CALL RETURNS THE TEAM'S OWN BELIEF
 * ---------------------------------------------------------------------------
 *
 * Stated here once so nobody re-derives it at the call site: with
 * `roster.length === 1` and one contributing belief, `momentsFor`'s scale
 * factor `roster.length² / contributing` is exactly `1`. The returned variance
 * IS `varianceOf(belief)` and the returned mean IS `belief.mean`. That single
 * fact is what makes a per-team contribution recoverable from the existing
 * accumulator with no new accessor and no second implementation of the belief
 * read.
 *
 * ---------------------------------------------------------------------------
 * THE COMPOSITION-SPREAD TERMS ARE GAUSSIAN, DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * `(ALLIANCE_SIZE - 1) * varianceOfVariableMeans`, `ALLIANCE_SIZE *
 * varianceOfVariableMeans` and their score counterparts treat the partner draw
 * as Gaussian. D-16 names this as the approximation class and accepts it
 * explicitly: "The composition-induced spread would be treated as Gaussian,
 * the same approximation class used elsewhere." See this module's header for
 * the exact-mixture alternative and its cost.
 *
 * ---------------------------------------------------------------------------
 * THE SCORE HALF RESTS ON AN ADDITIVE-CONTRIBUTION ASSUMPTION (A-FA1)
 * ---------------------------------------------------------------------------
 *
 * Under `allianceScore = Σ member totals + C`, the mean score DIFFERENCE for
 * team `t`'s field-averaged match is
 *
 *   (scoreMean_t + (A-1)·meanOfScoreMeans + C) − (A·meanOfScoreMeans + C)
 *     = scoreMean_t − meanOfScoreMeans
 *
 * so a team wins more than half its matches exactly when it is above field
 * average, and any per-season additive constant DROPS OUT. This is plan
 * 09-09's PLANNER ASSUMPTION A-FA1, and it is MEASURED in that plan's Task 1
 * (the residual's mean/sd/max on a real event) rather than asserted here.
 *
 * ---------------------------------------------------------------------------
 * THE INDEPENDENCE PRECONDITION IS CONSUMED, NEVER WEAKENED
 * ---------------------------------------------------------------------------
 *
 * `analyticRpPmf` asserts on entry that every `scoreCrossCovariance[i]` is `0`
 * and every off-diagonal `varianceBlock[i][j]` is `0`, throwing naming the
 * violating index otherwise — the closed form is exact only when the joint is
 * diagonal. This function builds a STRICTLY DIAGONAL block and an ALL-ZERO
 * cross-covariance, so that assertion passes by construction rather than by
 * luck.
 */
export function fieldAveragedAllianceMoments(
  contribution: FieldTeamContribution,
  stats: FieldStatistics
): FieldAveragedAlliancePair {
  const A = ALLIANCE_SIZE;
  const names = stats.variableNames;

  const ownMeanVector: number[] = [];
  const ownVariances: number[] = [];
  const opponentMeanVector: number[] = [];
  const opponentVariances: number[] = [];

  for (let v = 0; v < names.length; v++) {
    const ownMean = contribution.variableMeans[v] ?? 0;
    const ownVariance = contribution.variableVariances[v] ?? 0;
    const fieldMean = stats.meanOfVariableMeans[v] ?? 0;
    const fieldVariance = stats.meanOfVariableVariances[v] ?? 0;
    const spread = stats.varianceOfVariableMeans[v] ?? 0;

    ownMeanVector.push(ownMean + (A - 1) * fieldMean);
    ownVariances.push(A * (ownVariance + (A - 1) * fieldVariance) + (A - 1) * spread);

    opponentMeanVector.push(A * fieldMean);
    opponentVariances.push(A * (A * fieldVariance) + A * spread);
  }

  // Diagonal by construction — see the independence-precondition paragraph in
  // this function's doc comment. An off-diagonal entry here would make the
  // closed form silently inexact; `analyticRpPmf` throws on one instead.
  const diagonalBlock = (variances: readonly number[]): number[][] =>
    names.map((_, i) => names.map((__, j) => (i === j ? variances[i] ?? 0 : 0)));
  const zeroCross = (): number[] => names.map(() => 0);

  return {
    own: {
      variableNames: [...names],
      meanVector: ownMeanVector,
      varianceBlock: diagonalBlock(ownVariances),
      scoreMean: contribution.scoreMean + (A - 1) * stats.meanOfScoreMeans,
      scoreVariance: contribution.bandVariance + (A - 1) * stats.meanOfBandVariances + (A - 1) * stats.varianceOfScoreMeans,
      scoreCrossCovariance: zeroCross(),
    },
    opponent: {
      variableNames: [...names],
      meanVector: opponentMeanVector,
      varianceBlock: diagonalBlock(opponentVariances),
      scoreMean: A * stats.meanOfScoreMeans,
      scoreVariance: A * stats.meanOfBandVariances + A * stats.varianceOfScoreMeans,
      scoreCrossCovariance: zeroCross(),
    },
  };
}

/**
 * ONE team's field-averaged PER-MATCH total-RP pmf, length
 * `ruleModule.maxRp + 1`.
 *
 * Calls `analyticRpPmf` — THE SAME FUNCTION EVERY REAL MATCH RUNS — with
 * `compLevel: "qm"`, and returns `redPmf` (team `t`'s alliance is always the
 * "red" side of its own hypothetical match; the labels are positional here and
 * carry no meaning). This is what keeps the simulation audit's C-04 structural
 * guarantee — "no pricing math lives in the sidecar builder" — TRUE after the
 * rewrite rather than merely re-promised: the guarantee's mechanism changed
 * (from calling back into a caller-bound `predict` to calling the shared
 * closed form directly) and the guarantee itself did not.
 */
export function fieldAveragedMatchPmf(
  contribution: FieldTeamContribution,
  stats: FieldStatistics,
  ruleModule: RpRuleModule,
  eventType: number
): readonly number[] {
  const { own, opponent } = fieldAveragedAllianceMoments(contribution, stats);
  return analyticRpPmf({
    red: own,
    blue: opponent,
    ruleModule,
    eventType,
    compLevel: "qm",
  }).redPmf;
}

/**
 * One team's WHOLE-SEASON total-RP pmf: `matchesPerTeam`-fold `convolvePmf`
 * of its field-averaged per-match pmf, starting from `[1]` (the point mass at
 * zero RP, the identity for convolution).
 *
 * This is D-16's "exact convolution of N copies of its field-averaged
 * per-match pmf", and it is exact GIVEN the near-independence assumption this
 * module's header names as caveat 1. Result length is
 * `matchesPerTeam * (perMatchPmf.length - 1) + 1`.
 *
 * A non-positive `matchesPerTeam` THROWS rather than returning `[1]`: a
 * zero-fold convolution is a confident point mass at zero ranking points for
 * every team, which publishes as a perfectly well-formed artifact in which
 * every band is identical and wrong (T-09-09-10).
 */
export function seasonTotalPmf(perMatchPmf: readonly number[], matchesPerTeam: number): readonly number[] {
  if (!Number.isInteger(matchesPerTeam) || matchesPerTeam <= 0) {
    throw new InvalidMatchesPerTeamError(matchesPerTeam);
  }
  let total: readonly number[] = [1];
  for (let i = 0; i < matchesPerTeam; i++) {
    total = convolvePmf(total, perMatchPmf);
  }
  return total;
}

/**
 * The ONE place the rung-1 solo-row simulation input shape is constructed.
 *
 * Three consumers call this and no other: the offline sidecar builder
 * (`packages/harness/preSchedule.ts`), the measurement script's rung-1 arm
 * (`scripts/measureFieldAveragedRanks.ts`), and the browser's first-paint
 * decoder (`apps/web/src/lib/preScheduleResult.ts`). Having ONE construction
 * is what stops those three drifting into computing different bands from the
 * same published bytes.
 *
 * ---------------------------------------------------------------------------
 * WHY A SOLO ROW IS THE RIGHT SHAPE AND NOT A HACK
 * ---------------------------------------------------------------------------
 *
 * `simulateRanks` ranks by AVERAGE RP PER MATCH PLAYED (its own header: FRC's
 * Ranking Score). Giving each team ONE row carrying its whole-season total
 * makes every team's `matchesPlayed` exactly `1`, so the average IS the season
 * total and the ordering is identical to ranking by total — which is also what
 * the baked arm produced, since every team there ended with the same
 * `matchesPerTeam` credited matches (surrogates play an extra match but are
 * excluded from the team-key lists, so they earn no extra credit). The
 * lexicographic `teamKey` tie-break is untouched, so seeded reproducibility is
 * unchanged.
 *
 * The empty `blueTeamKeys` accumulates nothing and the `[1]` `blueRpPmf` is a
 * valid single-outcome distribution consuming one rng value. That is the cost
 * of keeping `simulateRanks` UNTOUCHED, and it is cheaper than the alternative
 * of emitting `matchesPerTeam` rows per team — distributionally identical, and
 * `matchesPerTeam` times more draws.
 *
 * ---------------------------------------------------------------------------
 * NO `outcome` SUB-OBJECT, DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * 09-07 (D-15) gave `SimMatchInput` an optional `outcome` sub-object so a
 * match's outcome is drawn ONCE and shared by both alliances. A solo row has
 * NO OPPOSING ALLIANCE for that coupling to couple to, so there is nothing for
 * a match-outcome draw to decide — the row takes the legacy two-draw path and
 * that is correct, not a regression. Said here rather than left for a reader
 * to wonder whether the field was forgotten.
 */
export function fieldAveragedRankInputs(
  roster: readonly string[],
  perTeamPmf: readonly (readonly number[])[],
  matchesPerTeam: number
): { matches: SimMatchInput[]; baselines: SimTeamBaseline[] } {
  if (roster.length !== perTeamPmf.length) {
    throw new Error(
      `fieldAveragedRankInputs: roster has ${roster.length} teams but perTeamPmf has ${perTeamPmf.length} entries — the two share one index space`
    );
  }
  // Zero-for-everyone baselines: nobody has played, which is exactly what
  // "before schedule release" means. The whole distribution comes from the
  // season-total pmfs alone — the same construction the baked path used.
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const matches: SimMatchInput[] = roster.map((teamKey, i) => ({
    redTeamKeys: [teamKey],
    blueTeamKeys: [],
    redRpPmf: seasonTotalPmf(perTeamPmf[i]!, matchesPerTeam),
    blueRpPmf: [1],
  }));
  return { matches, baselines };
}
