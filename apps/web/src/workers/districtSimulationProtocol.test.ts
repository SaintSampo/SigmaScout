/**
 * The district Worker protocol's own tests. This module is what jsdom can
 * reach — `districtSimulation.worker.ts` is close to untestable by
 * construction — so every branch, bound and loop is asserted here.
 *
 * Fixtures mirror `packages/core/districts/ledgerSimulation.test.ts`'s own
 * shape (baselines strictly decreasing by team number, ratings a deliberate
 * permutation of that order) so an expectation here is hand-derivable from the
 * same starting point the core's tests use.
 */
import { describe, expect, it } from "vitest";
import {
  INVALID_DISTRICT_CHANCE_REQUEST_ERROR_NAME,
  INVALID_DISTRICT_REQUEST_ERROR_NAME,
  MAX_DISTRICT_CHANCE_POINTS,
  MAX_DISTRICT_CHANCE_TEAMS,
  MAX_DISTRICT_SIMULATION_EVENTS,
  MAX_DISTRICT_SIMULATION_ROSTER,
  UNKNOWN_DISTRICT_ERROR_NAME,
  isDistrictAdvancementChanceRequest,
  isDistrictSimulationRequest,
  runDistrictAdvancementChanceJob,
  runDistrictSimulationJob,
  runDistrictWorkerJob,
  type DistrictAdvancementChanceOutboundMessage,
  type DistrictAdvancementChanceRequest,
  type DistrictAdvancementChanceResultMessage,
  type DistrictSimulationEventRequest,
  type DistrictSimulationOutboundMessage,
  type DistrictSimulationRequest,
  type DistrictSimulationResultMessage,
} from "./districtSimulationProtocol.js";
import { MAX_SIMULATION_DRAWS, MAX_SIMULATION_MATCHES } from "./simulationProtocol.js";
import { advancementChances, type AdvancementChanceTeam } from "../../../../packages/core/districts/advancementChance.js";
import {
  simulateDistrictEvent,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
} from "../../../../packages/core/districts/ledgerSimulation.js";
import type { AllianceMemberRating } from "../../../../packages/core/algorithms/simulation/allianceWinProbability.js";
import type { SimMatchInput, SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";

const SEASON = 2026;
const DRAWS = 24;
const SEED = 20260925;

function teamKey(n: number): string {
  return `frc${100 + n}`;
}

function baselinesFor(teamCount: number): SimTeamBaseline[] {
  const out: SimTeamBaseline[] = [];
  for (let i = 1; i <= teamCount; i++) out.push({ teamKey: teamKey(i), earnedRpSum: (teamCount + 1 - i) * 10, matchesPlayed: 10 });
  return out;
}

function ratingsFor(teamCount: number): Map<string, AllianceMemberRating> {
  const out = new Map<string, AllianceMemberRating>();
  for (let i = 1; i <= teamCount; i++) out.set(teamKey(i), { teamKey: teamKey(i), total: ((i * 7) % teamCount) + 1, sigma: 3 });
  return out;
}

function profilesFor(teamCount: number): Map<string, DistrictAwardProfile> {
  const out = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= teamCount; i++) out.set(teamKey(i), { bucket: "none", rookieState: "veteran" });
  return out;
}

function remainingMatches(): SimMatchInput[] {
  const pmf = [0.25, 0.35, 0.4];
  const out: SimMatchInput[] = [];
  for (let m = 0; m < 4; m++) {
    const base = m * 2;
    out.push({
      redTeamKeys: [teamKey(base + 1), teamKey(base + 2), teamKey(base + 3)],
      blueTeamKeys: [teamKey(base + 4), teamKey(base + 5), teamKey(base + 6)],
      redRpPmf: pmf,
      blueRpPmf: pmf,
    });
  }
  return out;
}

function inputFor(eventKey: string, teamCount = 24, overrides: Partial<DistrictLedgerEventInput> = {}): DistrictLedgerEventInput {
  return {
    eventKey,
    season: SEASON,
    tier: "district",
    fieldSize: teamCount,
    allianceCount: 8,
    remainingMatches: remainingMatches(),
    baselines: baselinesFor(teamCount),
    ratings: ratingsFor(teamCount),
    awardProfiles: profilesFor(teamCount),
    ...overrides,
  };
}

function eventRequest(eventKey: string, overrides: Partial<DistrictLedgerEventInput> = {}): DistrictSimulationEventRequest {
  return { eventKey, input: inputFor(eventKey, 24, overrides) };
}

function requestFor(events: readonly DistrictSimulationEventRequest[]): DistrictSimulationRequest {
  return { type: "run", events, draws: DRAWS, seed: SEED };
}

function collect(message: unknown): DistrictSimulationOutboundMessage[] {
  const emitted: DistrictSimulationOutboundMessage[] = [];
  runDistrictSimulationJob(message, (outbound) => emitted.push(outbound));
  return emitted;
}

function resultOf(emitted: readonly DistrictSimulationOutboundMessage[]): DistrictSimulationResultMessage {
  const results = emitted.filter((m): m is DistrictSimulationResultMessage => m.type === "result");
  expect(results).toHaveLength(1);
  return results[0]!;
}

/** Deep scan for any function value — the shape a structured clone cannot carry. */
function containsFunction(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return false;
  if (value instanceof Map) {
    for (const [k, v] of value) if (containsFunction(k, seen) || containsFunction(v, seen)) return true;
    return false;
  }
  if (Array.isArray(value)) return value.some((entry) => containsFunction(entry, seen));
  return Object.values(value as Record<string, unknown>).some((entry) => containsFunction(entry, seen));
}

describe("runDistrictSimulationJob", () => {
  it("emits progress then exactly one result, in that order, with nothing after it", () => {
    const emitted = collect(requestFor([eventRequest("2026waone")]));
    expect(emitted.map((m) => m.type)).toEqual(["progress", "result"]);
  });

  it("forwards the core's per-event histograms unreshaped — equal to a direct simulateDistrictEvent call under the same seed", () => {
    const request = requestFor([eventRequest("2026waone")]);
    const direct = simulateDistrictEvent(request.events[0]!.input, DRAWS, SEED);
    const result = resultOf(collect(request));
    const entry = result.events[0]!;
    expect(entry.status).toBe("ok");
    if (entry.status !== "ok") throw new Error("unreachable");
    expect(entry.result.qualPoints).toEqual(direct.qualPoints);
    expect(entry.result.selectionPoints).toEqual(direct.selectionPoints);
    expect(entry.result.elimPoints).toEqual(direct.elimPoints);
    expect(entry.result.awardPoints).toEqual(direct.awardPoints);
    expect(entry.result.eventTotal).toEqual(direct.eventTotal);
    expect(entry.result.draws).toBe(direct.draws);
  });

  it("forwards the selection ROUTES and the fixed-ranking flag, and they survive a structured clone intact", () => {
    // The routes cross this boundary UNRESHAPED, like every other field of the
    // core's result, so the only thing this boundary can get wrong is carrying a
    // value a structured clone drops. `undefined` inside a plain object is
    // cloneable; a `Map` of them is; so the assertion is equality AFTER a clone,
    // not merely that the clone did not throw (quick task 260925-w4y).
    const request = requestFor([eventRequest("2026waone")]);
    const direct = simulateDistrictEvent(request.events[0]!.input, DRAWS, SEED);
    const entry = resultOf(collect(request)).events[0]!;
    if (entry.status !== "ok") throw new Error("unreachable");
    expect(entry.result.selectionRoutes).toEqual(direct.selectionRoutes);
    expect(entry.result.rankingFixed).toBe(direct.rankingFixed);

    const cloned = structuredClone(entry.result);
    expect(cloned.selectionRoutes).toEqual(direct.selectionRoutes);
    expect(cloned.rankingFixed).toBe(direct.rankingFixed);
    // The `undefined` alliance number of a route no draw took is the one field
    // whose survival is worth asserting by hand: a clone that dropped the key
    // rather than its value would still compare equal under `toEqual`.
    const routes = cloned.selectionRoutes.get(teamKey(1))!;
    const backup = routes.bySlot[3]!;
    expect(Object.keys(backup).sort()).toEqual([
      "allianceNumber",
      "draws",
      "maxPoints",
      "minPoints",
      "possibleMaxPoints",
      "possibleMinPoints",
    ]);
    expect(backup.draws).toBe(0);
    expect(backup.allianceNumber).toBeUndefined();
  });

  it("emits one progress message per event, cumulative, with the total set once", () => {
    const emitted = collect(requestFor([eventRequest("2026waone"), eventRequest("2026watwo")]));
    const progress = emitted.filter((m) => m.type === "progress");
    expect(progress).toEqual([
      { type: "progress", completedEvents: 1, totalEvents: 2 },
      { type: "progress", completedEvents: 2, totalEvents: 2 },
    ]);
  });

  it("isolates a per-event failure: one unavailable entry, one histogram entry, zero terminal errors", () => {
    // Team 1 carries no published SPR pair, so `simulateDistrictEvent` raises
    // `UnratedTeamError` for THIS event before any draw runs.
    const unratedRatings = ratingsFor(24);
    unratedRatings.set(teamKey(1), { teamKey: teamKey(1), total: undefined, sigma: undefined });
    const emitted = collect(
      requestFor([eventRequest("2026wabad", { ratings: unratedRatings }), eventRequest("2026wagood")])
    );
    expect(emitted.filter((m) => m.type === "error")).toHaveLength(0);
    const result = resultOf(emitted);
    expect(result.events).toHaveLength(2);
    const bad = result.events[0]!;
    const good = result.events[1]!;
    expect(bad.status).toBe("unavailable");
    if (bad.status !== "unavailable") throw new Error("unreachable");
    expect(bad.eventKey).toBe("2026wabad");
    expect(bad.name).toBe("UnratedTeamError");
    expect(good.status).toBe("ok");
    if (good.status !== "ok") throw new Error("unreachable");
    expect(good.result.qualPoints.size).toBe(24);
  });

  it("translates a non-Error throw into an unavailable entry with the fallback name rather than crashing the loop", () => {
    // `maxEventPoints` throws for an unregistered season; to reach the
    // non-`Error` branch the core has to throw something that is not an
    // `Error`, which only a poisoned input can produce. A getter on the input
    // object throws a bare string when the core reads `season`.
    const poisoned = { ...inputFor("2026wapoison") } as Record<string, unknown>;
    Object.defineProperty(poisoned, "season", {
      get() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "not an Error instance";
      },
      enumerable: true,
    });
    const emitted = collect(
      requestFor([
        { eventKey: "2026wapoison", input: poisoned as unknown as DistrictLedgerEventInput },
        eventRequest("2026wagood"),
      ])
    );
    expect(emitted.filter((m) => m.type === "error")).toHaveLength(0);
    const result = resultOf(emitted);
    const poisonEntry = result.events[0]!;
    expect(poisonEntry.status).toBe("unavailable");
    if (poisonEntry.status !== "unavailable") throw new Error("unreachable");
    expect(poisonEntry.name).toBe(UNKNOWN_DISTRICT_ERROR_NAME);
    expect(result.events[1]!.status).toBe("ok");
  });

  it("survives structuredClone in both directions and carries no function anywhere", () => {
    const request = requestFor([eventRequest("2026waone")]);
    expect(() => structuredClone(request)).not.toThrow();
    expect(containsFunction(request)).toBe(false);
    const result = resultOf(collect(request));
    expect(() => structuredClone(result)).not.toThrow();
    expect(containsFunction(result)).toBe(false);
  });
});

describe("isDistrictSimulationRequest rejections", () => {
  const base = requestFor([eventRequest("2026waone")]);

  const rejections: ReadonlyArray<readonly [string, unknown]> = [
    ["a wrong type discriminant", { ...base, type: "go" }],
    ["a missing event array", { ...base, events: undefined }],
    ["an empty event array", { ...base, events: [] }],
    [
      "an event array above the ceiling",
      { ...base, events: Array.from({ length: MAX_DISTRICT_SIMULATION_EVENTS + 1 }, (_unused, i) => eventRequest(`2026wa${String(i)}`)) },
    ],
    ["a non-integer draw count", { ...base, draws: 10.5 }],
    ["a draw count below one", { ...base, draws: 0 }],
    ["a draw count above the ceiling", { ...base, draws: MAX_SIMULATION_DRAWS + 1 }],
    ["a non-finite seed", { ...base, seed: Number.NaN }],
    [
      "a per-event match list above the ceiling",
      {
        ...base,
        events: [
          {
            eventKey: "2026waone",
            input: { ...inputFor("2026waone"), remainingMatches: Array.from({ length: MAX_SIMULATION_MATCHES + 1 }, () => remainingMatches()[0]!) },
          },
        ],
      },
    ],
    [
      "an empty per-event baseline list",
      { ...base, events: [{ eventKey: "2026waone", input: { ...inputFor("2026waone"), baselines: [] } }] },
    ],
    [
      "a per-event baseline list above the roster ceiling",
      {
        ...base,
        events: [
          {
            eventKey: "2026waone",
            input: { ...inputFor("2026waone"), baselines: baselinesFor(MAX_DISTRICT_SIMULATION_ROSTER + 1) },
          },
        ],
      },
    ],
    ["a missing event key", { ...base, events: [{ input: inputFor("2026waone") }] }],
    ["a non-object payload", 7],
    ["a null payload", null],
  ];

  for (const [label, payload] of rejections) {
    it(`rejects ${label} with exactly one error message and no result`, () => {
      expect(isDistrictSimulationRequest(payload)).toBe(false);
      const emitted = collect(payload);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ type: "error", name: INVALID_DISTRICT_REQUEST_ERROR_NAME });
      expect(emitted.filter((m) => m.type === "result")).toHaveLength(0);
    });
  }

  it("accepts the well-formed base request", () => {
    expect(isDistrictSimulationRequest(base)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The advancement chance (quick task 260925-rpj)
// ---------------------------------------------------------------------------

/** A point mass at `value`, in the one distribution representation. */
function chanceMass(key: string, value: number): AdvancementChanceTeam {
  const counts = new Float64Array(value + 1);
  counts[value] = 1;
  return { teamKey: key, counts, denominator: 1 };
}

function chanceRequest(teams: readonly AdvancementChanceTeam[], slots: number): DistrictAdvancementChanceRequest {
  return {
    type: "chance",
    inputs: { teams, slots, awardQualified: [], prequalified: [], reservedSlots: 0 },
    draws: DRAWS,
    seed: SEED,
  };
}

function collectChance(message: unknown): DistrictAdvancementChanceOutboundMessage[] {
  const emitted: DistrictAdvancementChanceOutboundMessage[] = [];
  runDistrictAdvancementChanceJob(message, (outbound) => emitted.push(outbound));
  return emitted;
}

const CHANCE_TEAMS = [chanceMass("frc1", 90), chanceMass("frc2", 60), chanceMass("frc3", 30)];

describe("runDistrictAdvancementChanceJob", () => {
  it("emits exactly one chance-result and nothing else", () => {
    const emitted = collectChance(chanceRequest(CHANCE_TEAMS, 2));
    expect(emitted.map((m) => m.type)).toEqual(["chance-result"]);
  });

  it("forwards the core's own map unreshaped — equal to a direct advancementChances call under the same seed", () => {
    const request = chanceRequest(CHANCE_TEAMS, 2);
    const emitted = collectChance(request);
    const result = emitted[0] as DistrictAdvancementChanceResultMessage;
    const direct = advancementChances(request.inputs, DRAWS, SEED);
    expect([...result.chanceByTeam.entries()]).toEqual([...direct.chanceByTeam.entries()]);
    expect(result.lockSlots).toBe(direct.lockSlots);
    expect(result.draws).toBe(DRAWS);
  });

  it("carries no function anywhere in the result, and survives a structured clone", () => {
    const result = collectChance(chanceRequest(CHANCE_TEAMS, 2))[0]!;
    expect(containsFunction(result)).toBe(false);
    const cloned = structuredClone(result) as DistrictAdvancementChanceResultMessage;
    expect([...cloned.chanceByTeam.entries()]).toEqual([...(result as DistrictAdvancementChanceResultMessage).chanceByTeam.entries()]);
  });

  it("translates a CORE refusal into one error message, under the core's own error name", () => {
    const duplicated = chanceRequest([chanceMass("frc1", 10), chanceMass("frc1", 20)], 1);
    const emitted = collectChance(duplicated);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "error", name: "AdvancementChanceInputError" });
  });

  const chanceRejections: readonly [string, unknown][] = [
    ["a payload with the wrong type tag", { ...chanceRequest(CHANCE_TEAMS, 2), type: "run" }],
    ["a draw count above the ceiling", { ...chanceRequest(CHANCE_TEAMS, 2), draws: MAX_SIMULATION_DRAWS + 1 }],
    ["a non-integer draw count", { ...chanceRequest(CHANCE_TEAMS, 2), draws: 1.5 }],
    ["a non-finite seed", { ...chanceRequest(CHANCE_TEAMS, 2), seed: Number.POSITIVE_INFINITY }],
    ["an empty team list", chanceRequest([], 2)],
    [
      "a roster above the team ceiling",
      chanceRequest(Array.from({ length: MAX_DISTRICT_CHANCE_TEAMS + 1 }, (_unused, i) => chanceMass(`frc${String(i)}`, 10)), 2),
    ],
    [
      "a grand total array above the points ceiling",
      chanceRequest([{ teamKey: "frc1", counts: new Float64Array(MAX_DISTRICT_CHANCE_POINTS + 1), denominator: 1 }], 2),
    ],
    ["a missing qualifier array", { type: "chance", inputs: { teams: CHANCE_TEAMS, slots: 2, prequalified: [], reservedSlots: 0 }, draws: DRAWS, seed: SEED }],
    ["a non-object payload", 7],
    ["a null payload", null],
  ];

  for (const [label, payload] of chanceRejections) {
    it(`rejects ${label} with exactly one error message and no chance-result`, () => {
      expect(isDistrictAdvancementChanceRequest(payload)).toBe(false);
      const emitted = collectChance(payload);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ type: "error", name: INVALID_DISTRICT_CHANCE_REQUEST_ERROR_NAME });
    });
  }

  it("accepts the well-formed chance request", () => {
    expect(isDistrictAdvancementChanceRequest(chanceRequest(CHANCE_TEAMS, 2))).toBe(true);
  });
});

describe("runDistrictWorkerJob", () => {
  it("routes a run request to the simulation job", () => {
    const emitted: unknown[] = [];
    runDistrictWorkerJob(requestFor([eventRequest("2026waone")]), (outbound) => emitted.push(outbound));
    expect((emitted.at(-1) as { type: string }).type).toBe("result");
  });

  it("routes a chance request to the chance job", () => {
    const emitted: unknown[] = [];
    runDistrictWorkerJob(chanceRequest(CHANCE_TEAMS, 2), (outbound) => emitted.push(outbound));
    expect(emitted.map((m) => (m as { type: string }).type)).toEqual(["chance-result"]);
  });

  it("refuses a MALFORMED chance request under the chance error name, never the run's", () => {
    const emitted: unknown[] = [];
    runDistrictWorkerJob({ type: "chance" }, (outbound) => emitted.push(outbound));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "error", name: INVALID_DISTRICT_CHANCE_REQUEST_ERROR_NAME });
  });

  it("refuses anything else under the run error name", () => {
    const emitted: unknown[] = [];
    runDistrictWorkerJob({ type: "nonsense" }, (outbound) => emitted.push(outbound));
    expect(emitted[0]).toMatchObject({ type: "error", name: INVALID_DISTRICT_REQUEST_ERROR_NAME });
  });
});
