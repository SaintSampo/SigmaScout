/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). The browser side of the
 * timing run: price a whole district's events from as-of tuples and simulate
 * them, three ways.
 *
 *   Arm R  real qualification schedules, priced by the as-of pricer, one
 *          `simulateDistrictEvent` run per event at the site's draw count.
 *   Arm G  the offline district bake's method: 40 generated schedules x 100
 *          draws per event, each schedule priced by the as-of pricer, pooled.
 *   Arm B  today's rewound view: the same simulation as Arm R on inputs that
 *          are already priced (pricing untimed).
 *
 * BROWSER-SAFE BY CONSTRUCTION: imports only `packages/core/**`,
 * `packages/harness/generatedSchedules.ts`, `packages/harness/rounding.ts` and
 * this directory's `lookup.ts`/`format.ts`. `measureBrowser.ts` bundles it with
 * esbuild `platform: "browser"`, which is the gate.
 *
 * COPIED, not imported (their modules pull zod): `fnv1a32`, the seeded
 * shuffle, the synthetic `UpcomingMatch` and surrogate filtering from
 * `packages/harness/preSchedule.ts` (`buildScheduleMatches`, `toSimMatchInput`,
 * `buildPricedSyntheticSchedules`), and `DISTRICT_BAKE_DRAW_SALT`,
 * `DISTRICT_BAKE_SCHEDULE_COUNT`, `DISTRICT_BAKE_DRAWS_PER_SCHEDULE` from
 * `packages/harness/districtBake.ts`.
 */
import type { Prediction, UpcomingMatch } from "../../packages/core/algorithms/types.js";
import { mulberry32, type SimMatchInput, type SimTeamBaseline } from "../../packages/core/algorithms/simulation/rankSimulation.js";
import { simulateDistrictEvent, ZERO_AWARD_PROFILE, type DistrictAwardProfile, type DistrictLedgerEventInput, type DistrictLedgerResult } from "../../packages/core/districts/ledgerSimulation.js";
import type { DistrictTier } from "../../packages/core/districts/pointModel.js";
import { DEFAULT_RESTARTS, generateSchedule } from "../../packages/harness/generatedSchedules.js";
import { roundPmf } from "../../packages/harness/rounding.js";
import type { LeagueTuple, TeamTuple } from "./format.js";
import { buildAsOfPricer, type AsOfPricer } from "./lookup.js";

declare const performance: { now(): number };

/** `packages/harness/districtBake.ts` lines 72, 74 and 87. */
export const BAKE_SCHEDULE_COUNT = 40;
export const BAKE_DRAWS_PER_SCHEDULE = 100;
const BAKE_DRAW_SALT = 0x44_15_7c_a7;

/** One real qualification match as roster indexes: red, blue, red surrogates, blue surrogates, and its match number. */
export interface SpikeMatch {
  n: number;
  r: number[];
  b: number[];
  rs: number[];
  bs: number[];
}

export interface SpikeEvent {
  eventKey: string;
  eventType: number;
  week: number | null;
  tier: DistrictTier;
  /** Sorted; the index space for `teams` and every `SpikeMatch`. */
  roster: string[];
  /** The as-of tuple per roster team, parallel to `roster`. */
  teams: TeamTuple[];
  matchesPerTeam: number;
  schedule: SpikeMatch[];
}

export interface SpikePayload {
  season: number;
  algorithmVersion: string;
  vars: string[];
  league: LeagueTuple;
  /** The site's per-event draw count and fixed seed (`apps/web/src/workers/simulationProtocol.ts`). */
  draws: number;
  seed: number;
  district: SpikeEvent[];
  dcmp: SpikeEvent[];
}

export interface ArmResult {
  arm: "R" | "G" | "B";
  group: "district" | "dcmp";
  events: number;
  matchesPriced: number;
  schedulesGenerated: number;
  simulations: number;
  drawsTotal: number;
  /** Pricer rebuild plus `ratingsFor` and `predictFor`, summed over events. */
  buildMs: number;
  generateMs: number;
  priceMs: number;
  simulateMs: number;
  wallMs: number;
  /** Sum over every team and event of `sum(i * eventTotal[i])`: total points drawn. Equal across engines when the run is deterministic. */
  checksum: number;
  /** Sum of every rounded pmf entry times its index, over every priced match. */
  priceChecksum: number;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededShuffle(count: number, rng: () => number): number[] {
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = tmp;
  }
  return slots;
}

/** `toSimMatchInput` (preSchedule.ts): a surrogate plays and is priced, but earns no ranking credit. */
function toSimMatchInput(upcoming: UpcomingMatch, rp: readonly number[], bp: readonly number[]): SimMatchInput {
  return {
    redTeamKeys: upcoming.redTeams.filter((teamKey) => !upcoming.redSurrogates.includes(teamKey)),
    blueTeamKeys: upcoming.blueTeams.filter((teamKey) => !upcoming.blueSurrogates.includes(teamKey)),
    redRpPmf: rp,
    blueRpPmf: bp,
  };
}

function realMatches(event: SpikeEvent): UpcomingMatch[] {
  return event.schedule.map((m) => ({
    matchKey: `${event.eventKey}_qm${m.n}`,
    eventKey: event.eventKey,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: m.n,
    redTeams: m.r.map((i) => event.roster[i]!),
    blueTeams: m.b.map((i) => event.roster[i]!),
    redSurrogates: m.rs.map((i) => event.roster[i]!),
    blueSurrogates: m.bs.map((i) => event.roster[i]!),
    eventType: event.eventType,
    week: event.week,
  }));
}

/** Schedule `k`'s synthetic matches (preSchedule.ts `buildScheduleMatches`), and that schedule's shuffle seed. */
function syntheticSchedule(event: SpikeEvent, algorithmVersion: string, k: number): { seed: number; matches: UpcomingMatch[] } {
  const roster = event.roster;
  const structure = generateSchedule(roster.length, event.matchesPerTeam, mulberry32(fnv1a32(`generate|${roster.length}|${event.matchesPerTeam}|${k}`)), DEFAULT_RESTARTS);
  const seed = fnv1a32(`${event.eventKey}|${algorithmVersion}|shuffle|${k}`);
  const slots = seededShuffle(roster.length, mulberry32(seed));
  const matches = structure.map((structureMatch, matchIndex) => {
    const n = matchIndex + 1;
    const redTeams = structureMatch.red.map((slot) => roster[slots[slot]!]!);
    const blueTeams = structureMatch.blue.map((slot) => roster[slots[slot]!]!);
    return {
      matchKey: `${event.eventKey}_presim${k}_qm${n}`,
      eventKey: event.eventKey,
      compLevel: "qm" as const,
      setNumber: 1,
      matchNumber: n,
      redTeams,
      blueTeams,
      redSurrogates: redTeams.filter((_, position) => structureMatch.redSurrogate[position] === true),
      blueSurrogates: blueTeams.filter((_, position) => structureMatch.blueSurrogate[position] === true),
      eventType: event.eventType,
      week: event.week,
    } satisfies UpcomingMatch;
  });
  return { seed, matches };
}

interface Built {
  pricer: AsOfPricer;
  predict: (match: UpcomingMatch) => Prediction;
  base: Omit<DistrictLedgerEventInput, "remainingMatches">;
}

function buildEvent(payload: SpikePayload, event: SpikeEvent): Built {
  const teams = new Map<string, TeamTuple>();
  for (let i = 0; i < event.roster.length; i++) teams.set(event.roster[i]!, event.teams[i]!);
  const pricer = buildAsOfPricer({ season: payload.season, vars: payload.vars, league: payload.league, teams });
  const predict = pricer.predictFor(event.roster);
  if (predict === undefined) throw new Error(`browserRun: the roster gate refused ${event.eventKey} (${pricer.teamsWithoutSigmaFor(event.roster).join(",")})`);
  const awardProfiles = new Map<string, DistrictAwardProfile>();
  for (const teamKey of event.roster) awardProfiles.set(teamKey, ZERO_AWARD_PROFILE);
  const baselines: SimTeamBaseline[] = event.roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  return {
    pricer,
    predict,
    base: {
      eventKey: event.eventKey,
      season: payload.season,
      tier: event.tier,
      fieldSize: event.roster.length,
      allianceCount: 8,
      baselines,
      ratings: pricer.ratingsFor(event.roster),
      awardProfiles,
    },
  };
}

function priceMatches(predict: (match: UpcomingMatch) => Prediction, matches: readonly UpcomingMatch[], sink: { checksum: number }): SimMatchInput[] {
  const inputs: SimMatchInput[] = [];
  for (const match of matches) {
    const prediction = predict(match);
    if (prediction.redRpPmf === undefined || prediction.blueRpPmf === undefined) throw new Error(`browserRun: no ranking-point pmf for ${match.matchKey}`);
    const rp = roundPmf(prediction.redRpPmf);
    const bp = roundPmf(prediction.blueRpPmf);
    for (let i = 0; i < rp.length; i++) sink.checksum += i * (rp[i]! + bp[i]!);
    inputs.push(toSimMatchInput(match, rp, bp));
  }
  return inputs;
}

function totalPoints(result: DistrictLedgerResult): number {
  let total = 0;
  for (const histogram of result.eventTotal.values()) for (let i = 0; i < histogram.length; i++) total += i * histogram[i]!;
  return total;
}

function emptyResult(arm: ArmResult["arm"], group: ArmResult["group"], events: number): ArmResult {
  return { arm, group, events, matchesPriced: 0, schedulesGenerated: 0, simulations: 0, drawsTotal: 0, buildMs: 0, generateMs: 0, priceMs: 0, simulateMs: 0, wallMs: 0, checksum: 0, priceChecksum: 0 };
}

/** Arm R, or Arm B when `pricingTimed` is false (the identical work, with only the simulation on the clock). */
export function runRealSchedules(payload: SpikePayload, group: "district" | "dcmp", pricingTimed: boolean): ArmResult {
  const events = payload[group];
  const out = emptyResult(pricingTimed ? "R" : "B", group, events.length);
  const sink = { checksum: 0 };
  const start = performance.now();
  let untimed = 0;
  for (const event of events) {
    const b0 = performance.now();
    const built = buildEvent(payload, event);
    const matches = realMatches(event);
    const b1 = performance.now();
    const remainingMatches = priceMatches(built.predict, matches, sink);
    const p1 = performance.now();
    const result = simulateDistrictEvent({ ...built.base, remainingMatches }, payload.draws, payload.seed);
    const s1 = performance.now();
    out.matchesPriced += matches.length;
    out.simulations += 1;
    out.drawsTotal += payload.draws;
    out.checksum += totalPoints(result);
    if (pricingTimed) {
      out.buildMs += b1 - b0;
      out.priceMs += p1 - b1;
    } else {
      untimed += p1 - b0;
    }
    out.simulateMs += s1 - p1;
  }
  out.wallMs = performance.now() - start - untimed;
  out.priceChecksum = sink.checksum;
  return out;
}

/** Arm G: per event, generate all schedules, then price them all, then simulate them all, each phase timed once per event. */
export function runGeneratedSchedules(payload: SpikePayload, group: "district" | "dcmp"): ArmResult {
  const events = payload[group];
  const out = emptyResult("G", group, events.length);
  const sink = { checksum: 0 };
  const start = performance.now();
  for (const event of events) {
    const b0 = performance.now();
    const built = buildEvent(payload, event);
    const g0 = performance.now();
    const schedules: { seed: number; matches: UpcomingMatch[] }[] = [];
    for (let k = 0; k < BAKE_SCHEDULE_COUNT; k++) schedules.push(syntheticSchedule(event, payload.algorithmVersion, k));
    const g1 = performance.now();
    const priced: SimMatchInput[][] = [];
    for (const schedule of schedules) {
      priced.push(priceMatches(built.predict, schedule.matches, sink));
      out.matchesPriced += schedule.matches.length;
    }
    const p1 = performance.now();
    // Pooled exactly as `bakeDistrictEvent` pools: one accumulator per team, summed entry by entry.
    const pooled = new Map<string, Float64Array>();
    for (let k = 0; k < BAKE_SCHEDULE_COUNT; k++) {
      const seed = (schedules[k]!.seed ^ BAKE_DRAW_SALT) >>> 0;
      const result = simulateDistrictEvent({ ...built.base, remainingMatches: priced[k]! }, BAKE_DRAWS_PER_SCHEDULE, seed);
      for (const [teamKey, histogram] of result.eventTotal) {
        let into = pooled.get(teamKey);
        if (into === undefined) pooled.set(teamKey, (into = new Float64Array(histogram.length)));
        for (let i = 0; i < histogram.length; i++) into[i]! += histogram[i]!;
      }
      out.checksum += totalPoints(result);
    }
    const s1 = performance.now();
    out.schedulesGenerated += BAKE_SCHEDULE_COUNT;
    out.simulations += BAKE_SCHEDULE_COUNT;
    out.drawsTotal += BAKE_SCHEDULE_COUNT * BAKE_DRAWS_PER_SCHEDULE;
    out.buildMs += g0 - b0;
    out.generateMs += g1 - g0;
    out.priceMs += p1 - g1;
    out.simulateMs += s1 - p1;
  }
  out.wallMs = performance.now() - start;
  out.priceChecksum = sink.checksum;
  return out;
}

/** One arm for one group; the driver calls this once per fresh page. */
export function runArm(payload: SpikePayload, arm: "R" | "G" | "B", group: "district" | "dcmp"): ArmResult {
  if (arm === "G") return runGeneratedSchedules(payload, group);
  return runRealSchedules(payload, group, arm === "R");
}
