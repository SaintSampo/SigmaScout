/**
 * The field-averaged pre-schedule predictor: the expectation over schedule
 * randomness in closed form. The event's roster is summarised into field
 * statistics (mean and variance of per-team contributions, carrying both
 * match noise and partner-quality spread), each team's field-averaged
 * per-match pmf is built from its own belief plus those statistics, and
 * `matchesPerTeam` copies are convolved for the season total. No schedule is
 * generated.
 *
 * Caveats:
 *   1. A team's matches are treated as near-independent.
 *   2. Coupling between teams that share specific matches is washed out.
 *   3. Partner-composition spread is treated as Gaussian; the exact mixture
 *      would cost roughly 5.7 million `analyticRpPmf` calls per team on a
 *      40-team roster.
 *
 * A browser-safe leaf (`browserSafeSchemas.test.ts` scans it) that draws no
 * random numbers of its own.
 */

import { analyticRpPmf, convolvePmf } from "./analyticPmf.js";
import type { RpRuleModule } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";
import type { SimMatchInput, SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";

/** Teams on one FRC alliance. `(ALLIANCE_SIZE - 1)` below means team `t`'s unknown partners. */
export const ALLIANCE_SIZE = 3;

/**
 * One team's own contribution to its event's field, in
 * `ruleModule.thresholdVariables` order. Sources: `buildFieldContributions`
 * in `packages/harness/preSchedule.ts`.
 */
export interface FieldTeamContribution {
  readonly teamKey: string;
  /** This team's OWN per-variable mean belief — a one-team `momentsFor` call's `meanVector`. */
  readonly variableMeans: readonly number[];
  /** This team's OWN per-variable variance — the same call's `varianceBlock` diagonal. */
  readonly variableVariances: readonly number[];
  /** The algorithm's own per-team total (`TOTAL_METRIC_KEY`). */
  readonly scoreMean: number;
  /** The team's Sigma Score squared, matching `allianceSigmaBandVariance`'s per-team term. */
  readonly bandVariance: number;
}

/**
 * The event's roster summarised into field-level statistics. Per event, never
 * season-wide: against the season's average opponent, a strong field's teams
 * would look better than against the opponents they will actually face.
 */
export interface FieldStatistics {
  /** Threshold-variable names in `ruleModule.thresholdVariables` order — every array here is indexed against this order. */
  readonly variableNames: readonly string[];
  /** The roster size the statistics were computed over. */
  readonly teamCount: number;
  readonly meanOfVariableMeans: readonly number[];
  readonly meanOfVariableVariances: readonly number[];
  /** Population variance (divide by `n`) of per-team means: the partner-quality spread. */
  readonly varianceOfVariableMeans: readonly number[];
  readonly meanOfScoreMeans: number;
  /** Population variance of per-team score means: the score-side partner-quality spread. */
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

/** Thrown by `seasonTotalPmf` when asked to fold a non-positive number of matches. */
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
 * Population variance (divide by `n`, not `n - 1`): the array is the whole
 * field, not a sample, and `n - 1` would silently widen every band.
 */
function populationVarianceOf(values: readonly number[]): number {
  const mean = meanOf(values);
  let total = 0;
  for (const value of values) total += (value - mean) ** 2;
  return total / values.length;
}

/**
 * Summarises one event's roster into its field statistics. A team with no
 * observations contributes zeros rather than being skipped: it is part of the
 * field, and dropping it would shift the means up and narrow every band.
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
 * Team `t`'s hypothetical average qualification match: `t` plus two average
 * partners, against three average opponents.
 *
 * The leading `ALLIANCE_SIZE *` on every variance row is `momentsFor`'s
 * even-split undo (`roster.length² / contributing`, which is `ALLIANCE_SIZE`
 * on a full alliance), applied to the whole `(own + partners)` sum. A one-team
 * `momentsFor` call has scale factor exactly `1`, so it returns the team's own
 * belief unmodified.
 *
 * The score half assumes additive contributions, so the mean score
 * difference is `scoreMean_t − meanOfScoreMeans` and any per-season additive
 * constant drops out.
 *
 * The block is strictly diagonal and the cross-covariance zero, as
 * `analyticRpPmf` requires.
 *
 * `meanShift` is the season's walk-forward RP mean shift, one alliance-level
 * amount per variable, added once to each alliance's mean vector because it
 * corrects an alliance total. The caller passes it only when the whole event
 * roster is fully warm (`fieldMeanShiftVector` in `preSchedule.ts`).
 */
export function fieldAveragedAllianceMoments(
  contribution: FieldTeamContribution,
  stats: FieldStatistics,
  meanShift?: readonly number[]
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

    if (meanShift === undefined) {
      ownMeanVector.push(ownMean + (A - 1) * fieldMean);
      opponentMeanVector.push(A * fieldMean);
    } else {
      const shift = meanShift[v] ?? 0;
      ownMeanVector.push(ownMean + (A - 1) * fieldMean + shift);
      opponentMeanVector.push(A * fieldMean + shift);
    }
    ownVariances.push(A * (ownVariance + (A - 1) * fieldVariance) + (A - 1) * spread);

    opponentVariances.push(A * (A * fieldVariance) + A * spread);
  }

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
 * One team's field-averaged per-match total-RP pmf, from the same
 * `analyticRpPmf` every real match runs. Team `t` is always the positional
 * "red" side.
 */
export function fieldAveragedMatchPmf(
  contribution: FieldTeamContribution,
  stats: FieldStatistics,
  ruleModule: RpRuleModule,
  eventType: number,
  meanShift?: readonly number[]
): readonly number[] {
  const { own, opponent } = fieldAveragedAllianceMoments(contribution, stats, meanShift);
  // No `pRedWin`: a hypothetical match has no `Prediction`, so the score-draw limit applies.
  return analyticRpPmf({
    red: own,
    blue: opponent,
    ruleModule,
    eventType,
    compLevel: "qm",
  }).redPmf;
}

/**
 * One team's whole-season total-RP pmf: the `matchesPerTeam`-fold convolution
 * of its per-match pmf. A non-positive `matchesPerTeam` throws rather than
 * returning `[1]`, which would publish a well-formed, wrong band for every team.
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
 * The one place the solo-row simulation input shape is constructed, so
 * callers cannot drift into different bands from the same bytes.
 *
 * `simulateRanks` ranks by average RP per match played, so one row per team
 * carrying its whole-season total makes the average the season total. The
 * empty `blueTeamKeys` and `[1]` `blueRpPmf` cost one wasted rng draw. No
 * `outcome` sub-object: a solo row has no opposing alliance to couple to.
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
  // Zero baselines: before schedule release nobody has played.
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const matches: SimMatchInput[] = roster.map((teamKey, i) => ({
    redTeamKeys: [teamKey],
    blueTeamKeys: [],
    redRpPmf: seasonTotalPmf(perTeamPmf[i]!, matchesPerTeam),
    blueRpPmf: [1],
  }));
  return { matches, baselines };
}
