/**
 * The field-averaged pre-schedule predictor.
 *
 * A pre-schedule rank band used to be produced by drawing 20 synthetic
 * qualification schedules from a template grid, pricing every synthetic
 * match through the real RP path, and baking a rank distribution over all
 * 20. Those 20 schedules were a Monte Carlo approximation of an expectation
 * over schedule randomness, the same insight as the RP pmf itself, one
 * level up — and that expectation has a closed form. So: summarise the
 * event's roster into field-level statistics (mean and variance of
 * per-team contributions, carrying both match-to-match noise and
 * partner-quality spread), build each team's field-averaged per-match pmf
 * from its own belief plus those statistics, and convolve `matchesPerTeam`
 * copies for the season total. No schedule is generated anywhere in this module.
 *
 * Composed from three existing building blocks — `RpMomentsAccumulator`
 * (`empiricalMoments.ts`), `analyticPmf.ts`'s convolution machinery, and
 * `simulateRanks`' zero-baseline mode — rather than copied from one file.
 *
 * Honest caveats:
 *   1. Assumes a team's matches are near-independent — a team's partners
 *      differ each match, which makes the assumption reasonable, but the
 *      matches of one event are not literally independent draws.
 *   2. Washes out coupling from teams that share specific matches (two
 *      teams scheduled against each other have correlated outcomes that
 *      nothing here represents) — but the 20-schedule approach washed the
 *      same coupling out by design, averaging over independent shuffles so
 *      no particular pairing survived. A shared property of both forms,
 *      not a defect unique to this one.
 *   3. The composition-induced spread is treated as Gaussian, the same
 *      approximation class used elsewhere in this pipeline. The exact
 *      mixture over every partner/opponent combination is computable and
 *      deliberately not computed: roughly 5.7 million `analyticRpPmf`
 *      calls per team on a 40-team roster.
 *
 * A browser-safe leaf: its whole runtime import graph is `analyticPmf.ts`
 * and the RP leaves that module already reaches — no Node built-in, no
 * third-party package. Machine-checked: `browserSafeSchemas.test.ts`
 * registers this file as a scanned entry point. It also draws no random
 * number of its own; the only randomness anywhere in this arm is
 * `simulateRanks`' own seeded stream.
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
 * One team's own contribution to its event's field, indexed against
 * `ruleModule.thresholdVariables` order. Every field here is read from the
 * instant the existing baked path already read it from — see
 * `packages/harness/preSchedule.ts`'s `buildFieldContributions` for the
 * four sources.
 */
export interface FieldTeamContribution {
  readonly teamKey: string;
  /** This team's OWN per-variable mean belief — a one-team `momentsFor` call's `meanVector`. */
  readonly variableMeans: readonly number[];
  /** This team's OWN per-variable variance — the same call's `varianceBlock` diagonal. */
  readonly variableVariances: readonly number[];
  /** The algorithm's own per-team total (`TOTAL_METRIC_KEY`). */
  readonly scoreMean: number;
  /** The team's consistency figure SQUARED — Sigma Score for SPR; algorithms without one publish no ranking points. Matches `allianceSigmaBandVariance`'s per-team term exactly. */
  readonly bandVariance: number;
}

/**
 * The event's roster summarised into field-level statistics.
 *
 * Recomputed per event, never season-wide: a roster is 20-100 teams, the
 * publish pipeline already iterates per event so recomputing costs
 * nothing, and a season-wide average would degrade an unusually strong or
 * weak field in exactly the direction that makes its rank bands wrong — a
 * strong field's teams would each look better against the season's average
 * opponent than against the opponents they will actually face.
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
 * Population variance (divide by `n`, not `n - 1`) of a numeric array. This
 * is the whole field, not a sample drawn from a larger one: every team that
 * will play this event is in the array, so there is no wider population to
 * estimate and Bessel's correction has no referent. Dividing by `n - 1`
 * here would inflate the partner-spread term and widen every band, and
 * nothing downstream can tell a too-wide band from a correct one — pinned
 * by a test that asserts the population value, not the sample value.
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
 * `varianceOfVariableMeans` and `varianceOfScoreMeans` are the
 * partner-quality spread — the term a single-composition probe would miss
 * entirely, producing bands that are too narrow.
 *
 * A team with no folded observations contributes zeros rather than being
 * skipped: a cold team really is part of the field, and dropping it would
 * shift `meanOfVariableMeans` upward and silently narrow every band in the event.
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
 * Team `t`'s hypothetical average qualification match, as two
 * `AllianceRpMoments`: `t` plus two average partners, against three average
 * opponents.
 *
 * The leading `ALLIANCE_SIZE *` on every variance row is not a fudge
 * factor — it is `momentsFor`'s own even-split undo, reproduced rather
 * than invented. `empiricalMoments.ts` folds each team's belief from
 * `allianceValue / rosterSize`, so a team's belief variance estimates the
 * whole alliance's variance divided by `rosterSize²`; `momentsFor`
 * corrects for that by scaling the summed per-team variances by
 * `roster.length² / contributing`, which on a full alliance reduces to
 * `ALLIANCE_SIZE × Σ Var(belief)`. The field-averaged form substitutes the
 * field mean for the `ALLIANCE_SIZE - 1` unknown partners inside that same
 * expression rather than around it, which is why the factor multiplies the
 * whole `(own + partners)` sum and not just the partner half.
 *
 * Stated once so nobody re-derives it at the call site: with
 * `roster.length === 1` and one contributing belief, `momentsFor`'s scale
 * factor is exactly `1`, so a one-team `momentsFor` call returns the
 * team's own belief unmodified — which is what makes a per-team
 * contribution recoverable from the existing accumulator with no new
 * accessor.
 *
 * The composition-spread terms — `(ALLIANCE_SIZE - 1) *
 * varianceOfVariableMeans`, `ALLIANCE_SIZE * varianceOfVariableMeans` and
 * their score counterparts — treat the partner draw as Gaussian, the same
 * approximation class used elsewhere in this pipeline (see this module's
 * header for the exact-mixture alternative and its cost).
 *
 * The score half rests on an additive-contribution assumption: under
 * `allianceScore = Σ member totals + C`, the mean score difference for
 * team `t`'s field-averaged match is
 *
 *   (scoreMean_t + (A-1)·meanOfScoreMeans + C) − (A·meanOfScoreMeans + C)
 *     = scoreMean_t − meanOfScoreMeans
 *
 * so a team wins more than half its matches exactly when it is above field
 * average, and any per-season additive constant drops out. Measured
 * directly (the residual's mean/sd/max on a real event) rather than
 * asserted.
 *
 * `analyticRpPmf` asserts on entry that every cross-covariance and
 * off-diagonal variance entry is `0`, throwing otherwise — the closed form
 * is exact only when the joint is diagonal. This function builds a
 * strictly diagonal block and an all-zero cross-covariance, so that
 * assertion passes by construction.
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
 * One team's field-averaged per-match total-RP pmf, length
 * `ruleModule.maxRp + 1`. Calls `analyticRpPmf` — the same function every
 * real match runs — with `compLevel: "qm"`, and returns `redPmf` (team
 * `t`'s alliance is always the "red" side of its own hypothetical match;
 * the labels are positional here and carry no meaning). This keeps the
 * simulation's structural guarantee that no pricing math lives in the
 * sidecar builder.
 */
export function fieldAveragedMatchPmf(
  contribution: FieldTeamContribution,
  stats: FieldStatistics,
  ruleModule: RpRuleModule,
  eventType: number
): readonly number[] {
  const { own, opponent } = fieldAveragedAllianceMoments(contribution, stats);
  // No `pRedWin` passed: this prices a hypothetical field-averaged match
  // with no real `Prediction` to read a win probability from, so it keeps
  // `analyticRpPmf`'s score-draw fallback — the correct limit for a team's
  // own average opponent, not a discrepancy with the shipped win arm.
  return analyticRpPmf({
    red: own,
    blue: opponent,
    ruleModule,
    eventType,
    compLevel: "qm",
  }).redPmf;
}

/**
 * One team's whole-season total-RP pmf: `matchesPerTeam`-fold `convolvePmf`
 * of its field-averaged per-match pmf, starting from `[1]` (the point mass
 * at zero RP, the identity for convolution). Exact given the
 * near-independence assumption this module's header names as caveat 1.
 * Result length is `matchesPerTeam * (perMatchPmf.length - 1) + 1`.
 *
 * A non-positive `matchesPerTeam` throws rather than returning `[1]`: a
 * zero-fold convolution is a confident point mass at zero ranking points
 * for every team, which publishes as a perfectly well-formed artifact in
 * which every band is identical and wrong.
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
 * The one place the solo-row simulation input shape is constructed.
 *
 * Three consumers call this and no other: the offline sidecar builder
 * (`packages/harness/preSchedule.ts`), the measurement script's arm
 * (`scripts/measureFieldAveragedRanks.ts`), and the browser's first-paint
 * decoder (`apps/web/src/lib/preScheduleResult.ts`). Having one
 * construction is what stops those three drifting into computing
 * different bands from the same published bytes.
 *
 * A solo row is the right shape, not a hack: `simulateRanks` ranks by
 * average RP per match played, so giving each team one row carrying its
 * whole-season total makes every team's `matchesPlayed` exactly `1`, and
 * the average is the season total — the same ordering the baked arm
 * produced. The lexicographic `teamKey` tie-break is untouched, so seeded
 * reproducibility is unchanged. The empty `blueTeamKeys` and `[1]`
 * `blueRpPmf` keep `simulateRanks` untouched at the cost of one wasted rng
 * draw, cheaper than emitting `matchesPerTeam` rows per team.
 *
 * No `outcome` sub-object, deliberately: `SimMatchInput`'s optional
 * `outcome` lets a match's outcome be drawn once and shared by both
 * alliances, but a solo row has no opposing alliance for that coupling to
 * couple to, so the row takes the legacy two-draw path — correct, not a
 * forgotten field.
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
  // season-total pmfs alone.
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const matches: SimMatchInput[] = roster.map((teamKey, i) => ({
    redTeamKeys: [teamKey],
    blueTeamKeys: [],
    redRpPmf: seasonTotalPmf(perTeamPmf[i]!, matchesPerTeam),
    blueRpPmf: [1],
  }));
  return { matches, baselines };
}
