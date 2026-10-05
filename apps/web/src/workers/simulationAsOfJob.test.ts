/**
 * The Simulation tab's AS-OF Worker path (quick task 261005-5g0, Part 4): the
 * request guard, the pricing step, and that the run simulates exactly the rows
 * priced from the block's state through the unchanged `runSimulationJob`.
 */
import { describe, expect, it } from "vitest";
import { rpRuleModuleForSeason } from "../../../../packages/core/rankingPoints/rules.js";
import type { AsOfTeamTuple } from "../../../../packages/harness/asOfState.js";
import { buildAsOfPricer, priceRowsForSimulation } from "../../../../packages/harness/asOfPricing.js";
import type { UpcomingMatch } from "../../../../packages/core/algorithms/types.js";
import type { SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { spr } from "../../../../packages/core/algorithms/spr.js";
import { INVALID_REQUEST_ERROR_NAME, runSimulationJob, type SimulationOutboundMessage, type SimulationResultMessage } from "./simulationProtocol.js";
import {
  isSimulationAsOfRequest,
  MAX_SIMULATION_AS_OF_TEAMS,
  priceSimulationAsOfRows,
  runSimulationAsOfJob,
  type SimulationAsOfBlock,
  type SimulationAsOfRequest,
} from "./simulationAsOfJob.js";

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

function block(): SimulationAsOfBlock {
  return { season: SEASON, vars: VARS, league: league(), teams: ROSTER.map((teamKey, n) => [teamKey, tuple(n)] as const), rows: rows(12) };
}

function baselines(): SimTeamBaseline[] {
  return ROSTER.map((teamKey, n) => ({ teamKey, earnedRpSum: n % 5, matchesPlayed: 2 }));
}

function request(overrides: Partial<SimulationAsOfRequest> = {}): SimulationAsOfRequest {
  return { type: "runAsOf", asOf: block(), baselines: baselines(), draws: 120, seed: 20261005, ...overrides };
}

function collect(message: unknown, job: (message: unknown, emit: (outbound: SimulationOutboundMessage) => void) => void): SimulationOutboundMessage[] {
  const out: SimulationOutboundMessage[] = [];
  job(message, (outbound) => out.push(outbound));
  return out;
}

describe("the as-of request guard", () => {
  it("accepts a well formed request and survives the structured clone boundary", () => {
    expect(isSimulationAsOfRequest(request())).toBe(true);
    expect(isSimulationAsOfRequest(structuredClone(request()))).toBe(true);
  });

  it.each<[string, (r: SimulationAsOfRequest) => unknown]>([
    ["the default run's type", (r) => ({ ...r, type: "run" })],
    ["no block", (r) => ({ ...r, asOf: undefined })],
    ["a league tuple of the wrong length", (r) => ({ ...r, asOf: { ...r.asOf, league: r.asOf.league.slice(1) } })],
    ["a non finite league entry", (r) => ({ ...r, asOf: { ...r.asOf, league: [Number.NaN, ...r.asOf.league.slice(1)] } })],
    ["a mis-sized team tuple", (r) => ({ ...r, asOf: { ...r.asOf, teams: [["frc1", [[1, 2, 3], null, null]]] } })],
    ["too many tuples", (r) => ({ ...r, asOf: { ...r.asOf, teams: Array.from({ length: MAX_SIMULATION_AS_OF_TEAMS + 1 }, (_unused, i) => [`frc${String(i)}`, tuple(i)]) } })],
    ["no rows array", (r) => ({ ...r, asOf: { ...r.asOf, rows: undefined } })],
    ["a playoff row", (r) => ({ ...r, asOf: { ...r.asOf, rows: [{ ...r.asOf.rows[0]!, compLevel: "sf" }] } })],
    ["too many rows", (r) => ({ ...r, asOf: { ...r.asOf, rows: Array.from({ length: 501 }, () => r.asOf.rows[0]!) } })],
  ])("rejects %s", (_name, mutate) => {
    expect(isSimulationAsOfRequest(mutate(request()))).toBe(false);
    const out = collect(mutate(request()), runSimulationAsOfJob);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", name: INVALID_REQUEST_ERROR_NAME });
  });
});

describe("runSimulationAsOfJob", () => {
  it("prices every row from the block's state, exactly as the pricer prices it, and rounds as a stored row is", () => {
    const b = block();
    const pricer = buildAsOfPricer({ season: SEASON, vars: VARS, league: league(), teams: new Map(b.teams) });
    expect(priceSimulationAsOfRows(b)).toEqual(priceRowsForSimulation(pricer, b.rows));
    const priced = priceSimulationAsOfRows(b);
    // Not vacuous: every row priced, each with a real pmf pair and the outcome decomposition.
    expect(priced.matches).toHaveLength(12);
    expect(priced.excludedMatchKeys).toEqual([]);
    expect(priced.matches.every((m) => m.redRpPmf.length > 1 && m.outcome !== undefined)).toBe(true);
  });

  it("simulates exactly the priced rows: the same progress and histograms runSimulationJob gives over them, plus the as-of fields on the result", () => {
    const r = request();
    const asOf = collect(r, runSimulationAsOfJob);
    const direct = collect({ type: "run", matches: priceSimulationAsOfRows(r.asOf).matches, baselines: r.baselines, draws: r.draws, seed: r.seed }, runSimulationJob);
    expect(asOf.map((m) => m.type)).toEqual(direct.map((m) => m.type));
    const asOfResult = asOf.at(-1) as SimulationResultMessage;
    const directResult = direct.at(-1) as SimulationResultMessage;
    expect(asOfResult.rankHistograms).toEqual(directResult.rankHistograms);
    expect(asOfResult.draws).toBe(120);
    expect(asOfResult.simulatedMatches).toBe(12);
    expect(asOfResult.excludedMatchKeys).toEqual([]);
    // The default job's own result carries neither field.
    expect(directResult.simulatedMatches).toBeUndefined();
    expect(directResult.excludedMatchKeys).toBeUndefined();
  });

  it("a row that prices to no ranking point distribution is excluded and named, never given a fabricated distribution", () => {
    const b = block();
    // TBA event type 6 has no ranking point tier, so `predict` returns no RP pmf for that row.
    const withIneligible: SimulationAsOfBlock = { ...b, rows: b.rows.map((row, n) => (n === 3 ? { ...row, eventType: 6 } : row)) };
    const priced = priceSimulationAsOfRows(withIneligible);
    expect(priced.excludedMatchKeys).toEqual(["2026wax_qm4"]);
    const result = collect(request({ asOf: withIneligible }), runSimulationAsOfJob).at(-1) as SimulationResultMessage;
    expect(result.type).toBe("result");
    expect(result.excludedMatchKeys).toEqual(["2026wax_qm4"]);
    expect(result.simulatedMatches).toBe(11);
  });

  it("a pricer refusal (vars that are not the season's) ends the run with exactly one error", () => {
    const b = block();
    const out = collect(request({ asOf: { ...b, vars: [...b.vars].reverse() } }), runSimulationAsOfJob);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", name: "AsOfPricerError" });
  });
});
