// The season fit, extracted so the full build (site-data) and the incremental
// updater share ONE implementation — they must never diverge.
//
// The fit itself is cheap: streaming a season of matches through the Kalman
// filter is sub-second in memory. The expensive parts of a rebuild are network
// (per-event TBA calls) and writing thousands of files — which is exactly what
// the incremental updater avoids.

import type {
  ComponentId,
  MatchRecord,
  Season,
  SeasonStateFile,
  TeamEventSummary,
  TeamIndexEntry,
  TeamSeasonData,
  EventInfo,
} from "../src/core/types";
import type { ObservedMatch } from "./fetch";
import { estimatePriors } from "./priors";
import { KalmanModel, type KalmanConfig } from "./kalman";
import { normalizeSeason, buildTeamPriors, MIN_GP } from "./carryover";
import { probAGreaterThanB } from "../src/core/stats";

/** Tuned global hyperparameters (see README / eval harness). */
export const ALPHA = 0.01;
export const KAPPA = 0;
export const RHO = 0.6;

const COMP_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
export function sortMatches(a: MatchRecord, b: MatchRecord): number {
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  const c = (COMP_ORDER[a.compLevel] ?? 9) - (COMP_ORDER[b.compLevel] ?? 9);
  if (c !== 0) return c;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  return a.matchNumber - b.matchNumber;
}

const is3v3 = (m: ObservedMatch) =>
  m.redTeams.length === 3 && m.blueTeams.length === 3;

export interface SeasonFit {
  state: SeasonStateFile;
  /** Played matches with their pre-match prediction snapshots. */
  records: MatchRecord[];
  /** Per-team match-to-match tolerance (± points). */
  tolerance: Map<number, number>;
  /** Walk-forward winner accuracy over the whole season (%). */
  seasonAccuracy: number;
}

/** Run the full walk-forward fit over a season's played matches. */
export function fitSeason(
  season: Season,
  matches: ObservedMatch[],
  components: ComponentId[],
  carry: Map<number, number>,
): SeasonFit {
  const priors = estimatePriors(matches, components);
  const teamPriors = buildTeamPriors(carry, priors, components, RHO);
  const processNoise: Record<ComponentId, number> = {};
  for (const c of components) processNoise[c] = ALPHA * priors.measurementNoise[c];
  const cfg: KalmanConfig = {
    components,
    priorMean: priors.priorMean,
    priorVariance: priors.priorVariance,
    measurementNoise: priors.measurementNoise,
    processNoise,
    eventGapInflation: 3.0,
    adaptStrength: KAPPA,
    adaptDecay: 0.7,
    teamPriors,
  };
  const model = new KalmanModel(cfg);

  const resid = new Map<number, { n: number; sum: number; sum2: number }>();
  const addResidual = (team: number, r: number) => {
    const a = resid.get(team) ?? { n: 0, sum: 0, sum2: 0 };
    a.n++;
    a.sum += r;
    a.sum2 += r * r;
    resid.set(team, a);
  };

  const records: MatchRecord[] = [];
  for (const m of matches) {
    if (!is3v3(m)) continue;
    model.advanceMatch(m);
    const red = model.predictAlliance(m.redTeams);
    const blue = model.predictAlliance(m.blueTeams);

    const earnedRed = components.reduce((s, c) => s + (m.redByComponent[c] ?? 0), 0);
    const earnedBlue = components.reduce((s, c) => s + (m.blueByComponent[c] ?? 0), 0);
    for (const t of m.redTeams) addResidual(t, earnedRed - red.mean);
    for (const t of m.blueTeams) addResidual(t, earnedBlue - blue.mean);

    records.push({
      key: m.key,
      event: m.eventKey,
      compLevel: m.compLevel,
      setNumber: m.setNumber,
      matchNumber: m.matchNumber,
      time: m.playedAt,
      red: m.redTeams,
      blue: m.blueTeams,
      played: true,
      redActual: m.redScore,
      blueActual: m.blueScore,
      redRp: m.redRp,
      blueRp: m.blueRp,
      prediction: {
        redWinProb: probAGreaterThanB(red.mean, red.variance, blue.mean, blue.variance),
        redScore: Math.round(red.mean * 10) / 10,
        blueScore: Math.round(blue.mean * 10) / 10,
      },
    });
    model.observeMatch(m);
  }

  const state = model.toStateFile(season);
  normalizeSeason(state); // annotate normalizedRating

  const tolerance = new Map<number, number>();
  for (const [team, a] of resid) {
    if (a.n < MIN_GP) continue;
    const mean = a.sum / a.n;
    const sd = Math.sqrt(Math.max(a.sum2 / a.n - mean * mean, 0));
    tolerance.set(team, Math.round(sd * 10) / 10);
  }

  let correct = 0;
  let total = 0;
  for (const r of records) {
    if (r.redActual === undefined || r.blueActual === undefined) continue;
    if (r.redActual === r.blueActual) continue;
    if (r.prediction.redWinProb > 0.5 === r.redActual > r.blueActual) correct++;
    total++;
  }

  return {
    state,
    records,
    tolerance,
    seasonAccuracy: total ? (correct / total) * 100 : 0,
  };
}

/** Group played match records by participating team. */
export function groupByTeam(records: MatchRecord[]): Map<number, MatchRecord[]> {
  const perTeam = new Map<number, MatchRecord[]>();
  for (const r of records) {
    for (const t of [...r.red, ...r.blue]) {
      let list = perTeam.get(t);
      if (!list) perTeam.set(t, (list = []));
      list.push(r);
    }
  }
  return perTeam;
}

/** Build one team's page data + directory row from the fit. */
export function buildTeamData(
  season: Season,
  team: number,
  teamMatches: MatchRecord[],
  fit: SeasonFit,
  components: ComponentId[],
  names: Map<number, string>,
  eventByKey: Map<string, EventInfo>,
): { data: TeamSeasonData; index: TeamIndexEntry } | null {
  const st = fit.state.teams.find((t) => t.team === team);
  if (!st) return null;
  teamMatches.sort(sortMatches);

  let wins = 0,
    losses = 0,
    ties = 0;
  const eventAgg = new Map<string, { w: number; l: number; t: number }>();
  for (const r of teamMatches) {
    const onRed = r.red.includes(team);
    const my = onRed ? r.redActual! : r.blueActual!;
    const opp = onRed ? r.blueActual! : r.redActual!;
    const agg = eventAgg.get(r.event) ?? { w: 0, l: 0, t: 0 };
    if (my > opp) (wins++, agg.w++);
    else if (my < opp) (losses++, agg.l++);
    else (ties++, agg.t++);
    eventAgg.set(r.event, agg);
  }

  const events: TeamEventSummary[] = [...eventAgg.entries()]
    .map(([ek, agg]) => {
      const ev = eventByKey.get(ek);
      return {
        event: ek,
        name: ev?.name ?? ek,
        week: ev?.week,
        wins: agg.w,
        losses: agg.l,
        ties: agg.t,
      };
    })
    .sort((a, b) => (a.week ?? 99) - (b.week ?? 99));

  const overall = Math.round(components.reduce((s, c) => s + st.components[c].mean, 0) * 10) / 10;
  const tolerance = fit.tolerance.get(team);
  return {
    data: {
      team,
      season,
      name: names.get(team),
      components: st.components,
      overall,
      normalizedRating: st.normalizedRating,
      tolerance,
      componentIds: components,
      matchesPlayed: st.matchesPlayed,
      wins,
      losses,
      ties,
      events,
      matches: teamMatches,
    },
    index: {
      team,
      name: names.get(team),
      overall,
      normalizedRating: st.normalizedRating,
      tolerance,
      matchesPlayed: st.matchesPlayed,
      wins,
      losses,
      ties,
    },
  };
}
