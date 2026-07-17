// Site data builder: produces the browsable artifacts (team pages, event list,
// match records) for one season.
//
//   npm run site -- 2026
//
// The key detail: as the Kalman filter streams matches in time order, the state
// right before folding match k in IS "everything known just before match k" — so
// the prediction we capture there is exactly the pre-match prediction a played
// match should display. (Unplayed matches, once live data flows, would instead
// show the current best prediction — same snapshot shape.)

import {
  fetchSeasonMatches,
  componentsFor,
  fetchEvents,
  fetchTeamNames,
} from "./fetch";
import type { ObservedMatch } from "./fetch";
import { estimatePriors } from "./priors";
import { KalmanModel, type KalmanConfig } from "./kalman";
import { normalizeSeason, buildTeamPriors, MIN_GP } from "./carryover";
import { buildEventFiles } from "./event-data";
import { probAGreaterThanB } from "../src/core/stats";
import type {
  ComponentId,
  MatchRecord,
  Season,
  SeasonTeamsIndex,
  TeamEventSummary,
  TeamIndexEntry,
  TeamSeasonData,
} from "../src/core/types";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on real env */
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "public", "data");
const ALPHA = 0.01;
const RHO = 0.6;
const KAPPA = 0;
const BUILT_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];
const COMP_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

async function writeJson(relPath: string, data: unknown) {
  const full = resolve(DATA_DIR, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data));
}

/** Carryover z-map from the most recent already-built season before `season`. */
async function loadCarry(season: Season): Promise<Map<number, number>> {
  const prev = BUILT_SEASONS.filter((s) => s < season).pop();
  if (prev === undefined) return new Map();
  try {
    const raw = await readFile(resolve(DATA_DIR, `seasons/${prev}.json`), "utf8");
    return normalizeSeason(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

const is3v3 = (m: ObservedMatch) =>
  m.redTeams.length === 3 && m.blueTeams.length === 3;

function sortMatches(a: MatchRecord, b: MatchRecord): number {
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  const c = (COMP_ORDER[a.compLevel] ?? 9) - (COMP_ORDER[b.compLevel] ?? 9);
  if (c !== 0) return c;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  return a.matchNumber - b.matchNumber;
}

async function main() {
  const season = (Number(process.argv[2]) || 2026) as Season;
  const components = componentsFor(season);
  console.log(`Building site data for ${season}…`);

  const [matches, events, names] = await Promise.all([
    fetchSeasonMatches(season),
    fetchEvents(season),
    fetchTeamNames(),
  ]);
  const eventByKey = new Map(events.map((e) => [e.key, e]));
  console.log(`  ${matches.length} matches, ${events.length} events`);

  // Fit the season, seeded with cross-season carryover.
  const priors = estimatePriors(matches, components);
  const carry = await loadCarry(season);
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

  // Per-team residual accumulator for the consistency metric: how far each
  // team's alliance landed from its (earned-score) prediction, match to match.
  const resid = new Map<number, { n: number; sum: number; sum2: number }>();
  const addResidual = (team: number, r: number) => {
    const a = resid.get(team) ?? { n: 0, sum: 0, sum2: 0 };
    a.n++;
    a.sum += r;
    a.sum2 += r * r;
    resid.set(team, a);
  };

  // Walk-forward: predict each match from current state, THEN fold it in.
  const records: MatchRecord[] = [];
  for (const m of matches) {
    if (!is3v3(m)) continue;
    model.advanceMatch(m);
    const red = model.predictAlliance(m.redTeams);
    const blue = model.predictAlliance(m.blueTeams);

    // Residual = earned (foul-excluded) actual minus predicted, on the model's
    // scale. Fouls are external noise, so we measure consistency of the team's
    // own play, not foul luck.
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
      // Official scores (include fouls) — these decide the actual winner.
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
  const stateByTeam = new Map(state.teams.map((t) => [t.team, t]));

  // Tolerance = SD of a team's per-match residuals in points: how far their
  // alliance's earned score lands from prediction, match to match (± points).
  // It naturally scales with how much a team scores — a 400-point team swings
  // more in absolute points than a 20-point team, and that's expected. Fewer
  // than MIN_GP matches is too noisy to report.
  const tolerance = new Map<number, number>();
  for (const [team, a] of resid) {
    if (a.n < MIN_GP) continue;
    const mean = a.sum / a.n;
    const sd = Math.sqrt(Math.max(a.sum2 / a.n - mean * mean, 0));
    tolerance.set(team, Math.round(sd * 10) / 10);
  }

  // Group matches by participating team (denormalized for one-fetch team pages).
  const perTeam = new Map<number, MatchRecord[]>();
  for (const r of records) {
    for (const t of [...r.red, ...r.blue]) {
      let list = perTeam.get(t);
      if (!list) perTeam.set(t, (list = []));
      list.push(r);
    }
  }

  // Fresh dir so deleted/renamed teams don't linger.
  const teamsDir = `teams/${season}`;
  await rm(resolve(DATA_DIR, teamsDir), { recursive: true, force: true });

  const index: TeamIndexEntry[] = [];
  for (const [team, teamMatches] of perTeam) {
    teamMatches.sort(sortMatches);
    const st = stateByTeam.get(team);
    if (!st) continue;

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

    const teamEvents: TeamEventSummary[] = [...eventAgg.entries()]
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

    const overall = components.reduce((s, c) => s + st.components[c].mean, 0);
    const data: TeamSeasonData = {
      team,
      season,
      name: names.get(team),
      components: st.components,
      overall: Math.round(overall * 10) / 10,
      normalizedRating: st.normalizedRating,
      tolerance: tolerance.get(team),
      componentIds: components,
      matchesPlayed: st.matchesPlayed,
      wins,
      losses,
      ties,
      events: teamEvents,
      matches: teamMatches,
    };
    await writeJson(`${teamsDir}/${team}.json`, data);

    index.push({
      team,
      name: names.get(team),
      overall: data.overall,
      normalizedRating: st.normalizedRating,
      tolerance: tolerance.get(team),
      matchesPlayed: st.matchesPlayed,
      wins,
      losses,
      ties,
    });
  }

  index.sort((a, b) => b.overall - a.overall);
  const teamsIndex: SeasonTeamsIndex = { season, teams: index };
  await writeJson(`teams/${season}/index.json`, teamsIndex);
  await writeJson(`events/${season}.json`, events);

  console.log(
    `  wrote ${index.length} team files + index + ${events.length} events for ${season}.`,
  );

  // Season-wide walk-forward prediction accuracy (winner called correctly),
  // shown on event pages for context.
  let correct = 0;
  let total = 0;
  for (const r of records) {
    if (r.redActual === undefined || r.blueActual === undefined) continue;
    if (r.redActual === r.blueActual) continue;
    if (r.prediction.redWinProb > 0.5 === r.redActual > r.blueActual) correct++;
    total++;
  }
  const seasonAccuracy = total ? (correct / total) * 100 : 0;
  console.log(`  season prediction accuracy: ${seasonAccuracy.toFixed(1)}% (${correct}/${total})`);

  // Per-event pages: reuse this fit's match predictions + ratings.
  await buildEventFiles(season, records, state, events, names, DATA_DIR, seasonAccuracy);
}

main().catch((e) => {
  console.error("\nSite-data build failed:\n" + (e?.message ?? e));
  process.exit(1);
});
