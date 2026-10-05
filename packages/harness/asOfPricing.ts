/**
 * AS-OF PRICING (quick task 261005-5g0): rebuild the model from the tuples
 * `resolveAsOf` returns and price from it, exactly as the offline oracle
 * `scripts/districtPricingState.ts` `buildDistrictPricingState` prices at the
 * same instant.
 *
 * WHAT IS REBUILT. `SprState` (the team map and the league's `logTau`/`scale`),
 * `SigmaScoreAccumulator.fromBeliefs`, `RpMomentsAccumulator.fromBeliefs` with
 * the RP cold prior's population, and `RpMeanShiftAccumulator.fromState`, all
 * through the resume paths the live Worker already uses.
 *
 * WHAT IS MIRRORED, statement for statement: the oracle's `rookieRatings`
 * (`candidateRosterRatings`), `ratingsFor`, `teamsWithoutSigmaFor` and
 * `predictFor` (`makeRankingPointFiller` over the rookie rule's Sigma map, its
 * all-or-nothing roster gate included). `predict` additionally returns the
 * outcome decomposition (`matchOutcomePmf`, the outcome RP vectors and the
 * bonus pmfs) that `upcomingPricing.ts` builds from the SAME `analyticRpPmf`
 * result. Those are extra keys only: `pRedWin`, the scores and the two RP pmfs
 * are the oracle's own numbers, which `asOfOracle.test.ts` and
 * `scripts/verifyAsOfOracle.ts` compare with `Object.is`.
 *
 * DEMO ROBOTS. SPR prices every demo key as the one pseudo team. A raw demo
 * key's tuple carries no SPR part, so the pseudo team's tuple (which
 * `resolveAsOf` adds whenever a demo key is asked for) is what sets that state.
 *
 * BROWSER SAFE: no Node built-in, never `publish.ts`, `replay.ts`,
 * `sigmaScoutLayer.ts` or `packages/corpus`. `browserSafeSchemas.test.ts`
 * walks its graph.
 */
import { spr, type SprState, type SprTeamState } from "../core/algorithms/spr.js";
import { remapDemoTeams } from "../core/algorithms/demoTeams.js";
import { TOTAL_METRIC_KEY, type Prediction, type UpcomingMatch } from "../core/algorithms/types.js";
import type { AllianceMemberRating } from "../core/algorithms/simulation/allianceWinProbability.js";
import type { SimMatchInput, SimMatchOutcomeInput } from "../core/algorithms/simulation/rankSimulation.js";
import { isRpEligibleEventType, type RpRuleModule } from "../core/rankingPoints/constants.js";
import { RpMomentsAccumulator, type RpPopulationState, type RpTeamBeliefs, type RpVariableBelief } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "../core/rankingPoints/meanShift.js";
import { rpRuleModuleForSeason } from "../core/rankingPoints/rules.js";
import { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import { allianceSigmaBandVariance, SigmaScoreAccumulator, type SigmaBelief } from "./sigmaScore.js";
import { candidateRosterRatings, candidateSigmaMap, type CandidateRosterRating } from "./sigmaCarry.js";
import { roundPmf } from "./rounding.js";
import { asOfLeagueLength, type AsOfLeagueTuple, type AsOfTeamTuple } from "./asOfState.js";

export interface AsOfPricerInput {
  readonly season: number;
  /** The as-of objects' `vars`: must equal the season rule module's threshold variable names, in order. */
  readonly vars: readonly string[];
  readonly league: AsOfLeagueTuple;
  /** Every tuple the caller resolved: roster teams, plus the demo pseudo team when a roster holds a demo key. */
  readonly teams: ReadonlyMap<string, AsOfTeamTuple>;
  /** The season's RP rules; `rpRuleModuleForSeason(season)` when omitted. */
  readonly ruleModule?: RpRuleModule;
}

export interface AsOfPricer {
  readonly ruleModule: RpRuleModule;
  readonly sprState: SprState;
  /** The oracle's `ratingsFor` with the Sigma carry on: the rookie rule's total and Sigma per roster team. */
  ratingsFor(roster: readonly string[]): Map<string, AllianceMemberRating>;
  /** The roster teams the all-or-nothing RP gate refuses on. */
  teamsWithoutSigma(roster: readonly string[]): string[];
  /** One match priced from the as-of state, with the outcome decomposition when the RP fill applies. No roster gate: check `teamsWithoutSigma` first. */
  predict(match: UpcomingMatch): Prediction;
  /** The oracle's `predictFor`: `undefined` when the roster gate refuses, else `predict`. */
  predictFor(roster: readonly string[]): ((match: UpcomingMatch) => Prediction) | undefined;
}

export class AsOfPricerError extends Error {
  constructor(message: string) {
    super(`buildAsOfPricer: ${message}`);
    this.name = "AsOfPricerError";
  }
}

/** Rebuilds SPR state, the Sigma accumulator, the RP accumulator and the mean shift from tuples alone. */
export function buildAsOfPricer(input: AsOfPricerInput): AsOfPricer {
  const ruleModule = input.ruleModule ?? rpRuleModuleForSeason(input.season);
  const ruleVars = ruleModule.thresholdVariables.map((v) => v.name);
  if (ruleVars.length !== input.vars.length || ruleVars.some((name, v) => name !== input.vars[v])) {
    throw new AsOfPricerError(`vars [${input.vars.join(", ")}] are not season ${input.season}'s threshold variables [${ruleVars.join(", ")}]`);
  }
  const V = input.vars.length;
  const L = input.league;
  if (L.length !== asOfLeagueLength(V)) throw new AsOfPricerError(`league tuple has ${L.length} entries, expected ${asOfLeagueLength(V)}`);

  const sprTeams = new Map<string, SprTeamState>();
  const sigmaBeliefs = new Map<string, SigmaBelief>();
  const rpBeliefs = new Map<string, RpTeamBeliefs>();
  for (const [teamKey, tuple] of input.teams) {
    const [s, g, b] = tuple;
    // A demo key's tuple has no SPR part; the pseudo team's maps onto itself, which is where SPR holds every demo robot.
    if (s !== null) sprTeams.set(remapDemoTeams([teamKey])[0]!, { muL: s[0], pL: s[1], muS: s[2], pS: s[3] });
    if (g !== null) sigmaBeliefs.set(teamKey, { meanWeight: g[0], mean: g[1], varWeight: g[2], sumSquares: g[3], talent: g[4] });
    if (b !== null) {
      const byVariable: Record<string, RpVariableBelief> = {};
      for (let v = 0; v < V; v++) {
        const part = b[v];
        if (part !== null && part !== undefined) byVariable[input.vars[v]!] = { weight: part[0], weightSquares: part[1], mean: part[2], m2: part[3] };
      }
      rpBeliefs.set(teamKey, byVariable);
    }
  }
  const state: SprState = { ...spr.initState([]), season: input.season, teams: sprTeams, logTau: L[0]!, scale: L[1]! };

  const sigma = SigmaScoreAccumulator.fromBeliefs(sigmaBeliefs, { sumSquares: L[2]!, talentSquares: L[3]!, count: L[4]! });

  const populationVariables: Record<string, { n: number; mean: number; m2: number }> = {};
  const shiftVariables: Record<string, { count: number; sum: number }> = {};
  for (let v = 0; v < V; v++) {
    populationVariables[input.vars[v]!] = { n: L[5 + 3 * v]!, mean: L[6 + 3 * v]!, m2: L[7 + 3 * v]! };
    shiftVariables[input.vars[v]!] = { count: L[5 + 3 * V + 2 * v]!, sum: L[6 + 3 * V + 2 * v]! };
  }
  const population: RpPopulationState = { season: input.season, variables: populationVariables };
  const meanShiftState: RpMeanShiftState = { season: input.season, variables: shiftVariables };
  // The RP cold-team prior is on in production (SPR 9.0.0), so the population is always passed.
  const accumulator = RpMomentsAccumulator.fromBeliefs(ruleModule, rpBeliefs, { population });
  // Rebuilt through the resume path, as the oracle rebuilds it on every `predictFor`; `apply` never mutates it.
  const meanShift = RpMeanShiftAccumulator.fromState(ruleModule, meanShiftState);

  // `layer.sigmaScoreByTeam()`: exactly the teams that HOLD a belief.
  const sigmaByTeam = sigma.scoreByTeam();

  /** The oracle's `rookieRatings`, statement for statement. */
  const rookieRatings = (roster: readonly string[]): ReadonlyMap<string, CandidateRosterRating> => {
    const metrics = spr.teamMetrics(state, [...roster]);
    const totalByTeam = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) totalByTeam.set(teamKey, total);
    }
    return candidateRosterRatings({
      roster,
      totalByTeam,
      unseenTotal: spr.unseenTeamMetrics?.(state)?.[TOTAL_METRIC_KEY]?.value,
      sigmaByTeam,
      priorSigmaAtTalent: (talent) => sigma.priorSigmaAtTalent(talent),
    });
  };

  /** `makeRankingPointFiller`'s closure over the rookie rule's map for the match's own teams, plus the decomposition `upcomingPricing.ts` builds. */
  const predict = (match: UpcomingMatch): Prediction => {
    const prediction = spr.predict(state, match);
    if (prediction.redRpPmf !== undefined) return prediction;
    if (!isRpEligibleEventType(match.eventType)) return prediction;
    const sigmaMap = candidateSigmaMap(rookieRatings([...match.redTeams, ...match.blueTeams]));
    const red = allianceSigmaBandVariance(match.redTeams, sigmaMap);
    const blue = allianceSigmaBandVariance(match.blueTeams, sigmaMap);
    if (red === undefined || blue === undefined) return prediction;
    const redMoments = accumulator.momentsFor(match.redTeams, prediction.redScore, red);
    const blueMoments = accumulator.momentsFor(match.blueTeams, prediction.blueScore, blue);
    const pmf = analyticRpPmf({
      red: meanShift.apply(redMoments, rosterIsFullyWarm(accumulator, match.redTeams)),
      blue: meanShift.apply(blueMoments, rosterIsFullyWarm(accumulator, match.blueTeams)),
      ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      pRedWin: prediction.pRedWin,
    });
    const decomposition: Partial<Prediction> =
      pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
        ? {
            matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
            redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
            blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
            redBonusRpPmf: pmf.redBonusPmf,
            blueBonusRpPmf: pmf.blueBonusPmf,
          }
        : {};
    return {
      ...prediction,
      redRpPmf: pmf.redPmf,
      blueRpPmf: pmf.bluePmf,
      ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
      ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
      ...decomposition,
    };
  };

  const teamsWithoutSigma = (roster: readonly string[]): string[] => {
    const map = candidateSigmaMap(rookieRatings(roster));
    return roster.filter((teamKey) => !map.has(teamKey));
  };

  return {
    ruleModule,
    sprState: state,
    ratingsFor(roster) {
      const ratings = new Map<string, AllianceMemberRating>();
      for (const [teamKey, rating] of rookieRatings(roster)) ratings.set(teamKey, { teamKey, total: rating.total, sigma: rating.sigma });
      return ratings;
    },
    teamsWithoutSigma,
    predict,
    predictFor(roster) {
      if (teamsWithoutSigma(roster).length > 0) return undefined;
      return predict;
    },
  };
}

export interface AsOfSimulationRows {
  /** One entry per priced row, in input order. */
  readonly matches: SimMatchInput[];
  /** Rows that came back with no RP pmf pair (an RP-ineligible event type, or an alliance with no Sigma): never given a fabricated distribution. */
  readonly excludedMatchKeys: string[];
}

/**
 * Prices `rows` for the rank simulation and rounds each the way a published
 * upcoming row is rounded (`publishedRows.ts`: `roundPmf` on every pmf, the
 * outcome RP vectors untouched), so a simulation over as-of rows draws from
 * exactly the precision it would draw from a stored row. `outcome` is
 * attached only when the whole decomposition exists, as
 * `apps/web/src/lib/simulationInputs.ts` attaches it.
 */
export function priceRowsForSimulation(pricer: Pick<AsOfPricer, "predict">, rows: readonly UpcomingMatch[]): AsOfSimulationRows {
  const matches: SimMatchInput[] = [];
  const excludedMatchKeys: string[] = [];
  for (const row of rows) {
    const prediction = pricer.predict(row);
    const redPmf = prediction.redRpPmf;
    const bluePmf = prediction.blueRpPmf;
    if (redPmf === undefined || redPmf.length === 0 || bluePmf === undefined || bluePmf.length === 0) {
      excludedMatchKeys.push(row.matchKey);
      continue;
    }
    const outcome: SimMatchOutcomeInput | undefined =
      prediction.matchOutcomePmf !== undefined &&
      prediction.redOutcomeRp !== undefined &&
      prediction.blueOutcomeRp !== undefined &&
      prediction.redBonusRpPmf !== undefined &&
      prediction.blueBonusRpPmf !== undefined
        ? {
            outcomePmf: roundPmf(prediction.matchOutcomePmf),
            redOutcomeRp: [...prediction.redOutcomeRp],
            blueOutcomeRp: [...prediction.blueOutcomeRp],
            redBonusRpPmf: roundPmf(prediction.redBonusRpPmf),
            blueBonusRpPmf: roundPmf(prediction.blueBonusRpPmf),
          }
        : undefined;
    matches.push({
      redTeamKeys: row.redTeams,
      blueTeamKeys: row.blueTeams,
      redRpPmf: roundPmf(redPmf),
      blueRpPmf: roundPmf(bluePmf),
      ...(outcome !== undefined ? { outcome } : {}),
    });
  }
  return { matches, excludedMatchKeys };
}
