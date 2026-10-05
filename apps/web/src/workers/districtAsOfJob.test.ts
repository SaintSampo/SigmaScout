/**
 * The district Worker's AS-OF path (quick task 261005-5g0): the request
 * guard's as-of block, the job's per event progress entries and runner
 * injection, and the runner's REAL and GENERATED arms.
 */
import { describe, expect, it } from "vitest";
import { rpRuleModuleForSeason } from "../../../../packages/core/rankingPoints/rules.js";
import { asOfLeagueLength, type AsOfTeamTuple } from "../../../../packages/harness/asOfState.js";
import { buildAsOfPricer, priceRowsForSimulation } from "../../../../packages/harness/asOfPricing.js";
import { simulateDistrictEvent, type DistrictLedgerEventInput } from "../../../../packages/core/districts/ledgerSimulation.js";
import type { UpcomingMatch } from "../../../../packages/core/algorithms/types.js";
import { spr } from "../../../../packages/core/algorithms/spr.js";
import {
  MAX_AS_OF_TEAMS,
  asOfLeagueTupleLength,
  isDistrictSimulationRequest,
  runDistrictSimulationJob,
  type DistrictAsOfBlock,
  type DistrictAsOfEventRequest,
  type DistrictSimulationEventRequest,
  type DistrictSimulationOutboundMessage,
  type DistrictSimulationRequest,
} from "./districtSimulationProtocol.js";
import { AS_OF_BAKE_SKIPPED_ERROR_NAME, prepareAsOfRealInput, runAsOfEvent } from "./districtAsOfJob.js";

const SEASON = 2026;
const VARS = rpRuleModuleForSeason(SEASON).thresholdVariables.map((v) => v.name);
const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(100 + i)}`);

function league(): number[] {
  const init = spr.initState([]);
  const out = [init.logTau, init.scale, 40_000, 360_000, 800];
  for (const _name of VARS) out.push(800, 20, 800 * 36);
  for (const _name of VARS) out.push(0, 0);
  return out;
}

function tuple(n: number): AsOfTeamTuple {
  return [[20 + (n % 9), 40, 0, 5], [6, 0, 6, 400, 20 + (n % 9)], null];
}

function rows(count: number): UpcomingMatch[] {
  return Array.from({ length: count }, (_unused, n) => ({
    matchKey: `2026wax_qm${String(n + 1)}`,
    eventKey: "2026wax",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: n + 1,
    redTeams: [ROSTER[(n * 6) % 24]!, ROSTER[(n * 6 + 1) % 24]!, ROSTER[(n * 6 + 2) % 24]!],
    blueTeams: [ROSTER[(n * 6 + 3) % 24]!, ROSTER[(n * 6 + 4) % 24]!, ROSTER[(n * 6 + 5) % 24]!],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 1,
    week: 1,
  }));
}

function block(mode: "real" | "generated", teamCount = 24): DistrictAsOfBlock {
  const common = {
    cutId: "2026wax@1772000000#3",
    mode,
    season: SEASON,
    vars: VARS,
    league: league(),
    teams: ROSTER.slice(0, teamCount).map((teamKey, n) => [teamKey, tuple(n)] as const),
  };
  return mode === "real"
    ? { ...common, rows: rows(8) }
    : { ...common, bake: { districtKey: "2026pnw", eventType: 1, week: 1, matchesPerTeam: 12, algorithmId: "spr", algorithmVersion: "9.0.0+rolling" } };
}

function input(): DistrictLedgerEventInput {
  return {
    eventKey: "2026wax",
    season: SEASON,
    tier: "district",
    fieldSize: 24,
    allianceCount: 8,
    remainingMatches: [],
    baselines: ROSTER.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 })),
    ratings: new Map(),
    awardProfiles: new Map(ROSTER.map((teamKey) => [teamKey, { bucket: "none", rookieState: "veteran" }] as const)),
  };
}

function request(events: DistrictSimulationEventRequest[], draws = 40): DistrictSimulationRequest {
  return { type: "run", events, draws, seed: 20261005 };
}

describe("the as-of block in the request guard", () => {
  it("accepts a REAL block and a GENERATED block", () => {
    expect(isDistrictSimulationRequest(request([{ eventKey: "2026wax", input: input(), asOf: block("real") }]))).toBe(true);
    expect(isDistrictSimulationRequest(request([{ eventKey: "2026wax", input: input(), asOf: block("generated") }]))).toBe(true);
  });

  it("restates the league length exactly", () => {
    for (let v = 0; v <= 8; v++) expect(asOfLeagueTupleLength(v)).toBe(asOfLeagueLength(v));
  });

  const refused: [string, (b: DistrictAsOfBlock) => unknown][] = [
    ["an unknown mode", (b) => ({ ...b, mode: "rewound" })],
    ["a league of the wrong length", (b) => ({ ...b, league: [...b.league, 0] })],
    ["a non finite league entry", (b) => ({ ...b, league: b.league.map((value, i) => (i === 0 ? Number.NaN : value)) })],
    ["a tuple with a short SPR part", (b) => ({ ...b, teams: [["frc100", [[1, 2, 3], null, null]]] })],
    ["a tuple with more RP parts than vars", (b) => ({ ...b, teams: [["frc100", [null, null, VARS.map(() => null).concat([null])]]] })],
    ["too many tuples", (b) => ({ ...b, teams: Array.from({ length: MAX_AS_OF_TEAMS + 1 }, (_unused, i) => [`frc${String(i)}`, tuple(i)]) })],
    ["an empty cut id", (b) => ({ ...b, cutId: "" })],
    ["a REAL block with no rows", (b) => ({ ...b, rows: undefined })],
    ["a REAL block carrying bake parameters", (b) => ({ ...b, bake: block("generated").bake })],
    ["a row that is not a qualification match", (b) => ({ ...b, rows: [{ ...rows(1)[0]!, compLevel: "sf" }] })],
    ["a row with five robots on an alliance", (b) => ({ ...b, rows: [{ ...rows(1)[0]!, redTeams: ["a", "b", "c", "d", "e"] }] })],
  ];
  for (const [label, mutate] of refused) {
    it(`refuses ${label}`, () => {
      const event = { eventKey: "2026wax", input: input(), asOf: mutate(block("real")) as DistrictAsOfBlock };
      expect(isDistrictSimulationRequest(request([event]))).toBe(false);
    });
  }

  it("refuses a GENERATED block with no bake, rows, or a matches per team the generator never takes", () => {
    const generated = block("generated");
    for (const bad of [{ ...generated, bake: undefined }, { ...generated, rows: rows(1) }, { ...generated, bake: { ...generated.bake!, matchesPerTeam: 15 } }]) {
      expect(isDistrictSimulationRequest(request([{ eventKey: "2026wax", input: input(), asOf: bad }]))).toBe(false);
    }
  });
});

describe("the as-of runner", () => {
  it("REAL: prices the rows from the block's state, rates the roster with the same pricer, and simulates exactly that input", () => {
    const event: DistrictAsOfEventRequest = { eventKey: "2026wax", input: input(), asOf: block("real") };
    const prepared = prepareAsOfRealInput(event);
    const pricer = buildAsOfPricer({ season: SEASON, vars: VARS, league: league(), teams: new Map(event.asOf.teams) });
    expect(prepared.input.remainingMatches).toEqual(priceRowsForSimulation(pricer, rows(8)).matches);
    expect(prepared.input.ratings).toEqual(pricer.ratingsFor(ROSTER));
    expect(prepared.input.baselines).toEqual(event.input.baselines);
    const entry = runAsOfEvent(event, 40, 7);
    expect(entry.status).toBe("ok");
    expect(entry.status === "ok" && entry.result).toEqual(simulateDistrictEvent(prepared.input, 40, 7));
  });

  it("GENERATED: bakes over generated schedules and returns the roster and rows a sidecar carries", () => {
    const entry = runAsOfEvent({ eventKey: "2026wax", input: input(), asOf: block("generated") }, 40, 7);
    expect(entry.status).toBe("baked");
    if (entry.status !== "baked") return;
    expect(entry.roster).toEqual([...ROSTER].sort());
    expect(entry.rows).toHaveLength(24);
    expect(entry.draws).toBe(4000);
  }, 30_000);

  it("GENERATED: a bake the event cannot have (a roster too small for eight alliances) is a named unavailable entry, isolated by the job", () => {
    const small = { ...input(), fieldSize: 20, baselines: input().baselines.slice(0, 20) };
    const messages: DistrictSimulationOutboundMessage[] = [];
    runDistrictSimulationJob(request([{ eventKey: "2026wax", input: small, asOf: block("generated", 20) }]), (m) => messages.push(m), runAsOfEvent);
    const result = messages.at(-1);
    expect(result?.type).toBe("result");
    if (result?.type !== "result") return;
    expect(result.events[0]).toMatchObject({ status: "unavailable", name: AS_OF_BAKE_SKIPPED_ERROR_NAME });
  });
});

describe("the job's as-of path", () => {
  it("carries each as-of event's entry on its progress message, so a rewound stop fills in event by event", () => {
    const messages: DistrictSimulationOutboundMessage[] = [];
    runDistrictSimulationJob(request([{ eventKey: "2026wax", input: input(), asOf: block("real") }]), (m) => messages.push(m), runAsOfEvent);
    const progress = messages.filter((m) => m.type === "progress");
    expect(progress).toHaveLength(1);
    expect(progress[0]!.type === "progress" && progress[0]!.entry?.status).toBe("ok");
  });

  it("never carries an entry on a Live event's progress message", () => {
    const live = { eventKey: "2026wax", input: { ...input(), ratings: new Map(ROSTER.map((teamKey) => [teamKey, { teamKey, total: 50, sigma: 5 }] as const)) } };
    const messages: DistrictSimulationOutboundMessage[] = [];
    runDistrictSimulationJob(request([live]), (m) => messages.push(m));
    const progress = messages.find((m) => m.type === "progress");
    expect(progress).toEqual({ type: "progress", completedEvents: 1, totalEvents: 1 });
  });

  it("reads an as-of event unavailable in a Worker with no as-of runner, never simulating it from stored inputs", () => {
    const messages: DistrictSimulationOutboundMessage[] = [];
    runDistrictSimulationJob(request([{ eventKey: "2026wax", input: input(), asOf: block("real") }]), (m) => messages.push(m));
    const result = messages.at(-1);
    expect(result?.type === "result" && result.events[0]).toMatchObject({ status: "unavailable", name: "AsOfRunnerMissingError" });
  });
});
