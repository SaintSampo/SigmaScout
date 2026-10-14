/**
 * THE WEIGHTED PICK DRAFT REACHES EVERY RUN PATH (quick task 261014-ol6).
 *
 * One test per path that produces a displayed or published Locks number: the
 * Live job, a rewound stop's REAL run, a rewound stop's GENERATED bake, the
 * Champ Locks simulated DCMP bake, and the publisher's bake. Each is observed
 * by a pass-through spy on `simulateDistrictEvent`: the mock records the input
 * it was handed and forwards to the real function, so every importer (the
 * protocol, the as-of job, the bake) is observed and no output changes.
 *
 * Fixture helpers are copied from `districtAsOfJob.test.ts` rather than
 * exported from it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ inputs: [] as unknown[] }));

vi.mock("../../../../packages/core/districts/ledgerSimulation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../packages/core/districts/ledgerSimulation.js")>();
  return {
    ...actual,
    simulateDistrictEvent: vi.fn((...args: Parameters<typeof actual.simulateDistrictEvent>) => {
      recorded.inputs.push(args[0]);
      return actual.simulateDistrictEvent(...args);
    }),
  };
});

import { rpRuleModuleForSeason } from "../../../../packages/core/rankingPoints/rules.js";
import type { AsOfTeamTuple } from "../../../../packages/harness/asOfState.js";
import { buildAsOfPricer } from "../../../../packages/harness/asOfPricing.js";
import {
  bakeDistrictEvent,
  DISTRICT_BAKE_DRAWS_PER_SCHEDULE,
  DISTRICT_BAKE_SCHEDULE_COUNT,
} from "../../../../packages/harness/districtBake.js";
import type { DistrictLedgerEventInput } from "../../../../packages/core/districts/ledgerSimulation.js";
import type { DcmpAwardSlateInput } from "../../../../packages/core/districts/dcmpAwardSlate.js";
import { pickPositionPmfForSeason } from "../../../../packages/core/districts/pickDraft.js";
import type { UpcomingMatch } from "../../../../packages/core/algorithms/types.js";
import { spr } from "../../../../packages/core/algorithms/spr.js";
import { DistrictArtifactSchema, EventArtifactSchema } from "../../../../packages/harness/pageArtifacts.js";
import { buildDistrictEventSimulationInput } from "../components/districts/districtLedgerRows.js";
import {
  runDistrictSimulationJob,
  type DistrictAsOfBlock,
  type DistrictSimulationOutboundMessage,
} from "./districtSimulationProtocol.js";
import { runAsOfEvent } from "./districtAsOfJob.js";

const SEASON = 2026;
const SHIPPED = pickPositionPmfForSeason(SEASON);
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

function block(mode: "real" | "generated"): DistrictAsOfBlock {
  const common = {
    cutId: "2026wax@1772000000#3",
    mode,
    season: SEASON,
    vars: VARS,
    league: league(),
    teams: ROSTER.map((teamKey, n) => [teamKey, tuple(n)] as const),
  };
  return mode === "real"
    ? { ...common, rows: rows(8) }
    : { ...common, bake: { districtKey: "2026pnw", eventType: 1, week: 1, matchesPerTeam: 12, algorithmId: "spr", algorithmVersion: "9.0.0+rolling" } };
}

/** A request input with NO pmf, as `generatedRequest` builds one: the bake must set it itself. */
function bareInput(): DistrictLedgerEventInput {
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

/** A dcmp slate with no eligible team, the shape `ledgerSimulation.test.ts`'s NO_ELIGIBLE_DCMP_SLATE uses. */
const NO_ELIGIBLE_DCMP_SLATE: DcmpAwardSlateInput = {
  role: "single",
  expected: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judged: 12 },
  sources: { counts: "previousSeason", judged: "role" },
  eligibility: [],
};

/** A finished qualification event over `ROSTER`, for the builder. */
function eventArtifact() {
  const rpPmf = [0.25, 0.25, 0.25, 0.25];
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "9.0.0+rolling",
    eventKey: "2026wax",
    season: SEASON,
    matches: rows(4).map((row, i) => ({
      matchKey: row.matchKey,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: 1_760_000_000 + i * 600,
      redTeams: row.redTeams,
      blueTeams: row.blueTeams,
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 50,
      predictedBlueScore: 50,
      actualWinner: "red",
      actualRedScore: 60,
      actualBlueScore: 50,
      actualRedRp: 3,
      actualBlueRp: 1,
      redRpPmf: rpPmf,
      blueRpPmf: rpPmf,
    })),
    upcoming: [],
    teams: ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: 100 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 80 - ((i * 7) % 24) }, sigma: { value: 8 } },
    })),
  });
}

/** A district artifact listing no team: every roster team reads the zero award profile. */
function districtArtifact() {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 50,
    cmpSlots: 12,
    teams: [],
    insights: {
      teamCount: 0,
      eventCount: 8,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 80,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

/** The builder's Quals done input, optionally at a rewound REAL stop. */
function builtInput(asOfBaselines?: DistrictLedgerEventInput["baselines"]): DistrictLedgerEventInput {
  const built = buildDistrictEventSimulationInput({
    eventKey: "2026wax",
    season: SEASON,
    eventArtifact: eventArtifact(),
    districtArtifact: districtArtifact(),
    stage: { qual: true, alliance: false, elim: false, award: false },
    startMatchKey: null,
    ...(asOfBaselines === undefined ? {} : { asOfBaselines }),
  });
  if (!built.ok) throw new Error("expected an input");
  return built.input;
}

function expectEveryRecordedInputCarriesTheShippedPmf(expectedCalls?: number): void {
  if (expectedCalls !== undefined) expect(recorded.inputs).toHaveLength(expectedCalls);
  expect(recorded.inputs.length).toBeGreaterThan(0);
  for (const input of recorded.inputs) {
    expect((input as DistrictLedgerEventInput).pickPositionPmf).toEqual(SHIPPED);
  }
}

function collect(message: unknown, withAsOfRunner: boolean): DistrictSimulationOutboundMessage[] {
  const emitted: DistrictSimulationOutboundMessage[] = [];
  runDistrictSimulationJob(message, (outbound) => emitted.push(outbound), withAsOfRunner ? runAsOfEvent : undefined);
  return emitted;
}

describe("every Locks run path draws the season's weighted picks (quick task 261014-ol6)", () => {
  afterEach(() => {
    recorded.inputs.length = 0;
  });

  it("has a 2026 pmf to look for", () => {
    expect(SHIPPED).toBeDefined();
  });

  it("the Live job: a request built by the builder hands simulateDistrictEvent the season's pmf", () => {
    const emitted = collect({ type: "run", events: [{ eventKey: "2026wax", input: builtInput() }], draws: 40, seed: 7 }, false);
    const result = emitted.at(-1);
    expect(result?.type === "result" && result.events[0]!.status).toBe("ok");
    expectEveryRecordedInputCarriesTheShippedPmf(1);
  });

  it("as-of REAL: the runner hands simulateDistrictEvent the builder's pmf unchanged", () => {
    const asOfBaselines = ROSTER.map((teamKey, i) => ({ teamKey, earnedRpSum: 24 - i, matchesPlayed: 4 }));
    const entry = runAsOfEvent({ eventKey: "2026wax", input: builtInput(asOfBaselines), asOf: block("real") }, 40, 7);
    expect(entry.status).toBe("ok");
    expectEveryRecordedInputCarriesTheShippedPmf(1);
  });

  it("as-of GENERATED: a request with NO pmf still reaches every schedule with the season's pmf, because the bake sets it", () => {
    const entry = runAsOfEvent({ eventKey: "2026wax", input: bareInput(), asOf: block("generated") }, 40, 7);
    expect(entry.status).toBe("baked");
    if (entry.status !== "baked") return;
    // The as-of runner uses the bake's default schedule and draw counts: one simulation per schedule.
    expect(entry.draws).toBe(DISTRICT_BAKE_SCHEDULE_COUNT * DISTRICT_BAKE_DRAWS_PER_SCHEDULE);
    expectEveryRecordedInputCarriesTheShippedPmf(DISTRICT_BAKE_SCHEDULE_COUNT);
  }, 60_000);

  it("the Champ Locks simulated DCMP bake: the same at tier dcmp with a DCMP award slate", () => {
    const dcmp: DistrictLedgerEventInput = { ...bareInput(), tier: "dcmp", dcmpAwardSlate: NO_ELIGIBLE_DCMP_SLATE };
    const entry = runAsOfEvent({ eventKey: "2026wax", input: dcmp, asOf: block("generated") }, 40, 7);
    expect(entry.status).toBe("baked");
    for (const input of recorded.inputs) expect((input as DistrictLedgerEventInput).tier).toBe("dcmp");
    expectEveryRecordedInputCarriesTheShippedPmf(DISTRICT_BAKE_SCHEDULE_COUNT);
  }, 60_000);

  it("the publisher: bakeDistrictEvent called directly with the publisher's parameters sets the pmf on every schedule", () => {
    const pricer = buildAsOfPricer({ season: SEASON, vars: VARS, league: league(), teams: new Map(block("generated").teams) });
    const predict = pricer.predictFor(ROSTER);
    if (predict === undefined) throw new Error("expected the roster to price");
    const scheduleCount = 3;
    const outcome = bakeDistrictEvent({
      districtKey: "2026pnw",
      eventKey: "2026wax",
      season: SEASON,
      tier: "district",
      eventType: 1,
      week: 1,
      roster: ROSTER,
      allianceCount: 8,
      fieldSize: ROSTER.length,
      ratings: pricer.ratingsFor(ROSTER),
      awardProfiles: bareInput().awardProfiles,
      algorithmId: "spr",
      algorithmVersion: "9.0.0+rolling",
      matchesPerTeam: 12,
      predict,
      scheduleCount,
      drawsPerSchedule: 10,
    });
    expect(outcome.status).toBe("baked");
    expectEveryRecordedInputCarriesTheShippedPmf(scheduleCount);
  });
});
