/**
 * THE JOINT DRAW, END TO END (quick task 261014-qv2).
 *
 * A Live event at Quals done goes through the shipped assembly, the Worker's
 * run job, the decoder, the row builder and the chance builder, and the chance
 * request goes through the Worker's chance job: every team at that event must
 * then read its points from ONE shared run per advancement run. Then the
 * builder's own fallback, inertness and convolution behaviours.
 *
 * Fixture helpers follow `districtPickDraftPaths.test.ts` and
 * `districtLedgerChances.test.ts`, copied rather than exported from them.
 */
import { describe, expect, it } from "vitest";
import { advancementChances } from "../../../../../packages/core/districts/advancementChance.js";
import { convolveDistrictGrandTotal, type DistrictLedgerResult } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import {
  runDistrictAdvancementChanceJob,
  runDistrictSimulationJob,
  type DistrictAdvancementChanceOutboundMessage,
  type DistrictSimulationOutboundMessage,
} from "../../workers/districtSimulationProtocol.js";
import { assembleLiveDistrictEvents } from "./districtRunAssembly.js";
import {
  buildDistrictLedgerRows,
  distributionsFromResult,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import { buildAdvancementChanceRun } from "./districtLedgerChances.js";

type DistrictTeam = DistrictArtifact["teams"][number];

const SEASON = 2026;
const EVENT = "2026wax";
const SIDECAR_EVENT = "2026wbb";
const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(100 + i)}`);
const CEILINGS = maxEventPoints(SEASON, "district");
const EVENT_MAX = CEILINGS.qual + CEILINGS.alliance + CEILINGS.elim + CEILINGS.award;
const QUALS_DONE: DistrictStageFinality = { qual: true, alliance: false, elim: false, award: false };
const QUALS_DONE_STATE: DistrictEventState = { qualMatchesPlayed: 4, qualMatchesTotal: 4, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
const UNSTARTED: DistrictEventState = { qualMatchesPlayed: 0, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false };
const FINISHED: DistrictEventState = { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true };

function qualRows() {
  return Array.from({ length: 4 }, (_unused, n) => ({
    matchKey: `${EVENT}_qm${String(n + 1)}`,
    redTeams: [ROSTER[n * 6]!, ROSTER[n * 6 + 1]!, ROSTER[n * 6 + 2]!],
    blueTeams: [ROSTER[n * 6 + 3]!, ROSTER[n * 6 + 4]!, ROSTER[n * 6 + 5]!],
  }));
}

/** A finished qualification event over `ROSTER`. */
function eventArtifact() {
  const rpPmf = [0.25, 0.25, 0.25, 0.25];
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "9.0.0+rolling",
    eventKey: EVENT,
    season: SEASON,
    matches: qualRows().map((row, i) => ({
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

function team(teamKey: string, overrides: Partial<DistrictTeam> = {}): DistrictTeam {
  return {
    teamKey,
    teamNumber: Number(teamKey.replace("frc", "")),
    nickname: `Nickname ${teamKey}`,
    rank: 1,
    pointTotal: 0,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    awardProfile: { bucket: "none", rookie: false },
    districtLock: { status: "contending", pointsToLock: 0, threatCount: 0, cutLinePoints: null, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 0, threatCount: 0, cutLinePoints: null, allocationNote: null },
    ...overrides,
  };
}

function ahead(eventKey: string, state: DistrictEventState) {
  return { eventKey, eventName: `Event ${eventKey}`, week: 1, tier: "district" as const, maxPoints: EVENT_MAX, state };
}

function played(eventKey: string, total: number) {
  return { eventKey, eventName: `Event ${eventKey}`, week: 0, tier: "district" as const, qual: total, alliance: 0, elim: 0, award: 0, total, state: FINISHED };
}

/**
 * Every roster team is at the in progress event. Each has a finished earlier
 * event, and the first four also have an unstarted later event priced from a
 * sidecar shaped distribution.
 */
function districtArtifact(): DistrictArtifact {
  const teams = ROSTER.map((teamKey, i) =>
    team(teamKey, {
      pointTotal: 10 + i,
      eventPoints: [played("2026wa0", 10 + i)],
      remainingEvents: [ahead(EVENT, QUALS_DONE_STATE), ...(i < 4 ? [ahead(SIDECAR_EVENT, UNSTARTED)] : [])],
      maxRemainingDistrict: EVENT_MAX * (i < 4 ? 2 : 1),
    })
  );
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 10,
    cmpSlots: 4,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 3,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

function flat(hi: number): DistrictPointDistribution {
  const counts = new Float64Array(hi + 1);
  for (let i = 0; i <= hi; i++) counts[i] = 1 / (hi + 1);
  return { counts, denominator: 1 };
}

/** A published sidecar's decoded shape: pmfs only, no per run record. */
function sidecarFor(eventKey: string, teamKeys: readonly string[]): DistrictEventDistributions {
  const byTeam = new Map<string, Record<DistrictCellKind, DistrictPointDistribution | undefined>>();
  for (const teamKey of teamKeys) {
    byTeam.set(teamKey, {
      qual: flat(CEILINGS.qual),
      alliance: flat(CEILINGS.alliance),
      elim: flat(CEILINGS.elim),
      award: flat(CEILINGS.award),
      eventTotal: flat(EVENT_MAX),
      grandTotal: undefined,
    });
  }
  return { eventKey, byTeam };
}

/** The Live run through the shipped assembly and the Worker's run job. */
function liveResult(artifact: DistrictArtifact): DistrictLedgerResult {
  const assembled = assembleLiveDistrictEvents({
    artifact,
    activeKeys: [EVENT],
    eventArtifacts: new Map([[EVENT, eventArtifact()]]),
    stageByEvent: new Map([[EVENT, QUALS_DONE]]),
  });
  expect(assembled.events).toHaveLength(1);
  expect(assembled.events[0]!.input.recordEventTotalByRun).toBe(true);
  const emitted: DistrictSimulationOutboundMessage[] = [];
  runDistrictSimulationJob({ type: "run", events: assembled.events, draws: 300, seed: 7 }, (message) => emitted.push(message));
  const last = emitted.at(-1);
  if (last?.type !== "result" || last.events[0]!.status !== "ok") throw new Error("expected an ok run");
  return last.events[0]!.result;
}

function tabAt(distributions: ReadonlyMap<string, DistrictEventDistributions>) {
  const artifact = districtArtifact();
  const rows = buildDistrictLedgerRows({ artifact, distributions, stageByEvent: new Map([[EVENT, QUALS_DONE]]) });
  const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
  return { artifact, teams: rows.teams, statuses };
}

describe("the joint draw end to end: a Live in progress event (quick task 261014-qv2)", () => {
  const result = liveResult(districtArtifact());
  const live = distributionsFromResult(result);
  const distributions = new Map<string, DistrictEventDistributions>([
    [EVENT, live],
    [SIDECAR_EVENT, sidecarFor(SIDECAR_EVENT, ROSTER.slice(0, 4))],
  ]);
  const tab = tabAt(distributions);

  it("the decoded event carries the run's per run record", () => {
    expect(live.eventTotalByRun).toBe(result.eventTotalByRun);
    expect(live.eventTotalByRun!.teamKeys).toEqual(ROSTER);
  });

  it("the in progress event is drawn jointly, read by every team, and the Worker's chance job equals a direct core call", () => {
    const run = buildAdvancementChanceRun({ ...tab, runSignature: "sig", positionId: "now", distributions })!;
    expect(run).toBeDefined();
    expect(run.inputs.jointEvents?.map((event) => event.eventKey)).toEqual([EVENT]);
    expect(run.inputs.jointEvents![0]!.totals).toBe(result.eventTotalByRun!.totals);
    for (const entry of run.inputs.teams) expect(entry.jointEventKeys).toEqual([EVENT]);
    expect(run.independentEventKeys).toEqual([SIDECAR_EVENT]);

    const emitted: DistrictAdvancementChanceOutboundMessage[] = [];
    runDistrictAdvancementChanceJob({ type: "chance", inputs: run.inputs, draws: 400, seed: 11 }, (message) => emitted.push(message));
    const message = emitted.at(-1);
    if (message?.type !== "chance-result") throw new Error(`expected a chance result, got ${JSON.stringify(message)}`);
    const direct = advancementChances(run.inputs, 400, 11);
    expect(message.chanceByTeam).toEqual(direct.chanceByTeam);
    expect(message.cutoffByRun).toEqual(direct.cutoffByRun);

    // Conservation: every run reads one whole run of the event, so the joint
    // points summed over the pool are that run's event total summed over the roster.
    const record = result.eventTotalByRun!;
    let observed = 0;
    advancementChances(run.inputs, 400, 11, (o) => {
      observed += 1;
      const index = o.eventIndices[0]!;
      let rowSum = 0;
      for (let j = 0; j < record.teamKeys.length; j++) rowSum += record.totals[index * record.teamKeys.length + j]!;
      let jointSum = 0;
      for (let i = 0; i < o.jointPoints.length; i++) jointSum += o.jointPoints[i]!;
      expect(jointSum).toBe(rowSum);
    });
    expect(observed).toBe(400);
  });

  it("a team's rest convolved with its joint event's marginal is its grand total cell", () => {
    const run = buildAdvancementChanceRun({ ...tab, runSignature: "sig", positionId: "now", distributions })!;
    for (const teamKey of [ROSTER[0]!, ROSTER[10]!]) {
      const entry = run.inputs.teams.find((candidate) => candidate.teamKey === teamKey)!;
      const row = tab.teams.find((candidate) => candidate.teamKey === teamKey)!;
      if (row.grandTotal.kind !== "open") throw new Error("expected an open grand total");
      const eventRow = row.rows.find((candidate) => candidate.eventKey === EVENT)!;
      if (eventRow.eventTotal.kind !== "open") throw new Error("expected an open event total");
      const rebuilt = convolveDistrictGrandTotal(
        [{ counts: entry.counts, denominator: entry.denominator }, eventRow.eventTotal.distribution],
        0,
        0
      );
      const cell = row.grandTotal.distribution.counts;
      const length = Math.max(rebuilt.length, cell.length);
      for (let value = 0; value < length; value++) {
        expect(Math.abs((rebuilt[value] ?? 0) - (cell[value] ?? 0))).toBeLessThan(1e-12);
      }
    }
  });

  it("without the map, the run is exactly the independent one", () => {
    const run = buildAdvancementChanceRun({ ...tab, runSignature: "sig", positionId: "now" })!;
    expect(run.inputs.jointEvents).toBeUndefined();
    expect("jointEvents" in run.inputs).toBe(false);
    expect("independentEventKeys" in run).toBe(false);
    for (const entry of run.inputs.teams) expect(entry.jointEventKeys).toBeUndefined();
  });

  it("a map whose open events carry no per run record changes nothing but naming them", () => {
    const sidecarOnly = new Map<string, DistrictEventDistributions>([
      [EVENT, sidecarFor(EVENT, ROSTER)],
      [SIDECAR_EVENT, sidecarFor(SIDECAR_EVENT, ROSTER.slice(0, 4))],
    ]);
    const sidecarTab = tabAt(sidecarOnly);
    const without = buildAdvancementChanceRun({ ...sidecarTab, runSignature: "sig", positionId: "now" })!;
    const withMap = buildAdvancementChanceRun({ ...sidecarTab, runSignature: "sig", positionId: "now", distributions: sidecarOnly })!;
    expect(withMap.inputs).toEqual(without.inputs);
    expect(withMap.signature).toBe(without.signature);
    expect(withMap.excludedTeams).toEqual(without.excludedTeams);
    expect(withMap.independentEventKeys).toEqual([EVENT, SIDECAR_EVENT]);
  });

  it("a district with every event finished refuses with and without the map", () => {
    const artifact = DistrictArtifactSchema.parse({
      ...districtArtifact(),
      teams: ROSTER.map((teamKey, i) => team(teamKey, { pointTotal: 10 + i, eventPoints: [played("2026wa0", 10 + i)] })),
    });
    const rows = buildDistrictLedgerRows({ artifact, distributions: new Map() });
    const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
    const base = { artifact, teams: rows.teams, statuses, runSignature: "sig", positionId: "now" };
    expect(buildAdvancementChanceRun(base)).toBeUndefined();
    expect(buildAdvancementChanceRun({ ...base, distributions })).toBeUndefined();
  });
});
