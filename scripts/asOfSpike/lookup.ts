/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). Rebuilds the as-of state of
 * a team and of the league at a stream position from the captured INDEX and
 * LOG objects, and prices from that state exactly as
 * `scripts/districtPricingState.ts`'s closures do.
 *
 * BROWSER-SAFE BY CONSTRUCTION: imports only `packages/core/**`,
 * `packages/harness/sigmaScore.ts`, `packages/harness/sigmaCarry.ts` and this
 * directory's `format.ts`. Never a Node built-in, `publish.ts`,
 * `preSchedule.ts` or `pageArtifacts.ts`. `measureBrowser.ts` bundles it with
 * esbuild `platform: "browser"`, which is the gate.
 */
import { spr, type SprState, type SprTeamState } from "../../packages/core/algorithms/spr.js";
import { remapDemoTeams } from "../../packages/core/algorithms/demoTeams.js";
import { TOTAL_METRIC_KEY, type Prediction, type UpcomingMatch } from "../../packages/core/algorithms/types.js";
import type { AllianceMemberRating } from "../../packages/core/algorithms/simulation/allianceWinProbability.js";
import { isRpEligibleEventType, type RpRuleModule } from "../../packages/core/rankingPoints/constants.js";
import { RpMomentsAccumulator, type RpPopulationState, type RpTeamBeliefs, type RpVariableBelief } from "../../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "../../packages/core/rankingPoints/meanShift.js";
import { rpRuleModuleForSeason } from "../../packages/core/rankingPoints/rules.js";
import { analyticRpPmf } from "../../packages/core/rankingPoints/analyticPmf.js";
import { allianceSigmaBandVariance, SigmaScoreAccumulator, type SigmaBelief } from "../../packages/harness/sigmaScore.js";
import { candidateRosterRatings, candidateSigmaMap, type CandidateRosterRating } from "../../packages/harness/sigmaCarry.js";
import { atOrBefore, isSeasonStartCut, UNSEEN_TEAM, type Cut, type EventIndex, type EventLog, type IndexTeamEntry, type LeagueTuple, type SeasonStart, type SeasonTails, type TeamTuple } from "./format.js";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Where the captured objects come from. Synchronous here; a browser would resolve the same reads from fetched objects. */
export interface AsOfSource {
  getIndex(eventKey: string): EventIndex;
  getLog(eventKey: string): EventLog;
  readonly tails: SeasonTails;
  readonly start: SeasonStart;
}

/** How one team's tuple was resolved, for the report. */
export interface ResolveTrace {
  /** `x`: after its last match at `eventKey`; `s`: before its first match there; `log`: a log row there; `unseen`: nothing anywhere. */
  kind: "x" | "s" | "log" | "unseen";
  eventKey: string | null;
  matchKey?: string;
  /** Events hopped to through `p`, in order. */
  hops: string[];
}

export interface ResolvedTeam {
  tuple: TeamTuple;
  trace: ResolveTrace;
}

/** The team's last row at `eventKey` at or before the cut, read from the log. */
function lastLogRowAtOrBefore(log: EventLog, teamKey: string, cut: Cut): { tuple: TeamTuple; matchKey: string } | undefined {
  for (let i = log.rows.length - 1; i >= 0; i--) {
    const row = log.rows[i]!;
    if (!atOrBefore(row.t, log.eventKey, cut, i)) continue;
    for (const [key, tuple] of row.tm) if (key === teamKey) return { tuple, matchKey: row.k };
  }
  return undefined;
}

/**
 * One team's tuple at `cut`, walking back from `startEventKey` (the earliest
 * event the caller knows the team plays after the cut, else the team's season
 * tail).
 *
 * At each event: if the team's first match there is at or before the cut, the
 * answer is `x` when its last match there is too, else its last log row at or
 * before the cut. Otherwise the answer is `s` when it has no previous event or
 * its previous match is at or before the cut, else hop to the previous event.
 */
export function resolveTeamStateAt(teamKey: string, cut: Cut, startEventKey: string | undefined, source: AsOfSource): ResolvedTeam {
  const hops: string[] = [];
  const first: string | undefined = startEventKey ?? source.tails[teamKey];
  if (first === undefined) return { tuple: UNSEEN_TEAM, trace: { kind: "unseen", eventKey: null, hops } };
  let current: string = first;

  for (let guard = 0; guard < 64; guard++) {
    const entry: IndexTeamEntry | undefined = source.getIndex(current).teams[teamKey];
    if (entry === undefined) throw new Error(`asOf lookup: ${teamKey} has no entry in ${current}'s index`);

    if (current === cut.eventKey) {
      // The cut's own event. A time strictly on one side of the cut row's decides it; anything else reads the log.
      if (entry.l < cut.t) return { tuple: entry.x, trace: { kind: "x", eventKey: current, hops } };
      if (entry.f <= cut.t) {
        const found = lastLogRowAtOrBefore(source.getLog(current), teamKey, cut);
        if (found !== undefined) return { tuple: found.tuple, trace: { kind: "log", eventKey: current, matchKey: found.matchKey, hops } };
      }
    } else if (atOrBefore(entry.f, current, cut)) {
      if (atOrBefore(entry.l, current, cut)) return { tuple: entry.x, trace: { kind: "x", eventKey: current, hops } };
      const found = lastLogRowAtOrBefore(source.getLog(current), teamKey, cut);
      if (found === undefined) throw new Error(`asOf lookup: ${teamKey} at ${current} has a first match at or before the cut but no log row there`);
      return { tuple: found.tuple, trace: { kind: "log", eventKey: current, matchKey: found.matchKey, hops } };
    }

    // The team's first match here is after the cut.
    if (entry.p === null || atOrBefore(entry.p[1], entry.p[0], cut)) return { tuple: entry.s, trace: { kind: "s", eventKey: current, hops } };
    current = entry.p[0];
    hops.push(current);
  }
  throw new Error(`asOf lookup: ${teamKey} did not resolve within 64 hops`);
}

/** The league tuple at `cut`: the season's `L0` before any row, else the `L` of the cut's own row. */
export function leagueAt(cut: Cut, source: AsOfSource): LeagueTuple {
  if (isSeasonStartCut(cut)) return source.start.L0;
  const index = source.getIndex(cut.eventKey);
  if (cut.rowIndex === index.n - 1) return index.le.L;
  const row = source.getLog(cut.eventKey).rows[cut.rowIndex];
  if (row === undefined) throw new Error(`asOf lookup: cut row ${cut.rowIndex} is outside ${cut.eventKey}'s log`);
  return row.L;
}

// ---------------------------------------------------------------------------
// Pricer
// ---------------------------------------------------------------------------

export interface AsOfPricerInput {
  readonly season: number;
  readonly vars: readonly string[];
  readonly league: LeagueTuple;
  readonly teams: ReadonlyMap<string, TeamTuple>;
}

export interface AsOfPricer {
  readonly ruleModule: RpRuleModule;
  readonly sprState: SprState;
  /** `buildDistrictPricingState`'s `ratingsFor`, carry on. */
  ratingsFor(roster: readonly string[]): Map<string, AllianceMemberRating>;
  /** `buildDistrictPricingState`'s `predictFor`: `undefined` when the all-or-nothing roster gate refuses. */
  predictFor(roster: readonly string[]): ((match: UpcomingMatch) => Prediction) | undefined;
  /** The roster teams the gate refuses on. */
  teamsWithoutSigmaFor(roster: readonly string[]): string[];
}

/** Rebuilds SPR state, the Sigma accumulator, the RP accumulator and the mean shift from tuples alone. */
export function buildAsOfPricer(input: AsOfPricerInput): AsOfPricer {
  const ruleModule = rpRuleModuleForSeason(input.season);
  const V = input.vars.length;
  const L = input.league;
  if (L.length !== 5 + 5 * V) throw new Error(`asOf pricer: league tuple has ${L.length} entries, expected ${5 + 5 * V}`);

  const sprTeams = new Map<string, SprTeamState>();
  const sigmaBeliefs = new Map<string, SigmaBelief>();
  const rpBeliefs = new Map<string, RpTeamBeliefs>();
  for (const [teamKey, tuple] of input.teams) {
    const [s, g, b] = tuple;
    // SPR holds a demo robot or placeholder slot under the one shared pseudo key; `teamMetrics` reads the raw key and finds none.
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
  // The RP cold-team prior is on in production, so the third argument is always passed.
  const accumulator = RpMomentsAccumulator.fromBeliefs(ruleModule, rpBeliefs, { population });

  // `layer.sigmaScoreByTeam()`: exactly the teams that HOLD a belief.
  const sigmaByTeam = sigma.scoreByTeam();

  /** `buildDistrictPricingState`'s `rookieRatings`, statement for statement. */
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

  return {
    ruleModule,
    sprState: state,
    ratingsFor(roster) {
      const ratings = new Map<string, AllianceMemberRating>();
      for (const [teamKey, rating] of rookieRatings(roster)) ratings.set(teamKey, { teamKey, total: rating.total, sigma: rating.sigma });
      return ratings;
    },
    teamsWithoutSigmaFor(roster) {
      const map = candidateSigmaMap(rookieRatings(roster));
      return roster.filter((teamKey) => !map.has(teamKey));
    },
    predictFor(roster) {
      // `makeRankingPointFiller`, statement for statement, over the rookie rule's map and a mean shift
      // rebuilt through the resume path (as `predictFor` rebuilds it on every call).
      const sigmaMap = candidateSigmaMap(rookieRatings(roster));
      const meanShift = RpMeanShiftAccumulator.fromState(ruleModule, meanShiftState);
      if (roster.some((teamKey) => !sigmaMap.has(teamKey))) return undefined;
      return (match: UpcomingMatch): Prediction => {
        const prediction = spr.predict(state, match);
        if (prediction.redRpPmf !== undefined) return prediction;
        if (!isRpEligibleEventType(match.eventType)) return prediction;
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
        return {
          ...prediction,
          redRpPmf: pmf.redPmf,
          blueRpPmf: pmf.bluePmf,
          ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
          ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        };
      };
    },
  };
}
