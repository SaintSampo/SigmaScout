/**
 * The Champ Locks tab's two chance halves.
 *
 * Synthetic artifacts parsed through the REAL `DistrictArtifactSchema`. No
 * corpus, no network, no Worker: both functions under test are pure, which is
 * the whole reason they live outside the component.
 */
import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact, type DistrictEventState } from "../../../../../packages/harness/pageArtifacts.js";
import { buildChampLedgerRows, type ChampLedgerTeam } from "./champLedgerRows.js";
import { computeChampLedgerStatuses, type ChampLedgerStatusModel } from "./champLedgerStatus.js";
import {
  buildChampAdvancementChanceRun,
  districtFieldMembershipChances,
  reconcileChampAdvancementChances,
} from "./champLedgerChances.js";
import type { DistrictLedgerStatusModel, DistrictLedgerStatusState } from "./districtLedgerStatus.js";
import type { DistrictEventDistributions, DistrictPointDistribution, DistrictStageFinality } from "./districtLedgerRows.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type EventPoints = DistrictTeam["eventPoints"][number];

const SEASON = 2026;
const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

// ---------------------------------------------------------------------------
// districtFieldMembershipChances
// ---------------------------------------------------------------------------

/** A district status model carrying nothing but the verdict words, which is all this widening reads. */
function districtStatusesOf(statuses: Record<string, DistrictLedgerStatusState>): DistrictLedgerStatusModel {
  return {
    byTeam: new Map(
      Object.entries(statuses).map(([teamKey, status]) => [
        teamKey,
        { teamKey, status, byAward: false, verdict: "contending" as const, lockedBy: null },
      ])
    ),
    counts: { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 },
    verdictCensus: { locked: 0, lockedAward: 0, prequalified: 0, eliminated: 0, contending: 0, unknown: 0 },
    projectionCutLine: null,
    awardQualified: [],
    prequalified: [],
    reservedSlots: 0,
    pooledRemainingPoints: 0,
  };
}

describe("districtFieldMembershipChances", () => {
  const statuses = districtStatusesOf({
    frcLocked: "locked",
    frcPrequalified: "prequalified",
    frcOut: "lockedOut",
    frcIn: "inRange",
    frcBubble: "outOfRange",
    frcUnranked: "inRange",
    frcUnknown: "capacityUnknown",
  });
  const raw = new Map([
    // Deliberately WRONG for the three settled teams, to prove the verdict wins.
    ["frcLocked", 0.93],
    ["frcPrequalified", 0.4],
    ["frcOut", 0.07],
    ["frcIn", 0.82],
    ["frcBubble", 0.31],
    ["frcUnknown", 0.5],
  ]);
  const chances = districtFieldMembershipChances(raw, statuses);

  it("reads exactly 1 for a locked or prequalified team, whatever the raw run said", () => {
    expect(chances.get("frcLocked")).toBe(1);
    expect(chances.get("frcPrequalified")).toBe(1);
  });

  it("reads exactly 0 for a locked out team, whatever the raw run said", () => {
    expect(chances.get("frcOut")).toBe(0);
  });

  it("passes the marginal through for In range and Out of range", () => {
    expect(chances.get("frcIn")).toBe(0.82);
    expect(chances.get("frcBubble")).toBe(0.31);
  });

  it("leaves a team the run did not rank ABSENT, which reads as undefined and never as zero", () => {
    expect(chances.has("frcUnranked")).toBe(false);
    expect(chances.get("frcUnranked")).toBeUndefined();
  });

  it("leaves a team with an unpublished capacity absent rather than guessing", () => {
    expect(chances.has("frcUnknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildChampAdvancementChanceRun
// ---------------------------------------------------------------------------

function state(overrides: Partial<DistrictEventState> = {}): DistrictEventState {
  return { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true, ...overrides };
}

function eventPoints(overrides: Partial<EventPoints> & { eventKey: string }): EventPoints {
  return {
    eventName: `Event ${overrides.eventKey}`,
    week: 1,
    tier: "district",
    qual: 10,
    alliance: 6,
    elim: 7,
    award: 0,
    total: 23,
    state: state(),
    ...overrides,
  };
}

function team(overrides: Partial<DistrictTeam> & { teamKey: string }): DistrictTeam {
  return {
    teamNumber: Number(overrides.teamKey.replace("frc", "")),
    nickname: `Nickname ${overrides.teamKey}`,
    rank: 1,
    pointTotal: 60,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    ...overrides,
  };
}

function artifactOf(teams: DistrictTeam[], overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
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
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 2,
      dcmpCutLinePoints: 40,
      cmpCutLinePoints: 80,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
    ...overrides,
  });
}

function uniform(points: number, draws = 100): DistrictPointDistribution {
  const counts = new Float64Array(points + 1);
  for (let i = 0; i <= points; i++) counts[i] = draws / (points + 1);
  return { counts, denominator: draws };
}

function dcmpDistributions(eventKey: string, teamKeys: readonly string[]): ReadonlyMap<string, DistrictEventDistributions> {
  const byTeam = new Map<string, Readonly<Record<string, DistrictPointDistribution | undefined>>>();
  for (const teamKey of teamKeys) {
    byTeam.set(teamKey, {
      qual: uniform(20),
      alliance: uniform(10),
      elim: uniform(20),
      award: uniform(10),
      eventTotal: uniform(60),
      grandTotal: undefined,
    });
  }
  return new Map([[eventKey, { eventKey, byTeam } as DistrictEventDistributions]]);
}

/** Twenty teams with a finished district season and an OPEN District Championship — the shape the second run exists for. */
function bubbleArtifact(overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  const teams = Array.from({ length: 20 }, (_unused, i) =>
    team({
      teamKey: `frc${String(i + 1)}`,
      pointTotal: 100 - i,
      eventPoints: [
        eventPoints({ eventKey: "2026wabon", week: 0, qual: 100 - i, alliance: 0, elim: 0, award: 0, total: 100 - i }),
        eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", qual: 0, alliance: 0, elim: 0, award: 0, total: 0 }),
      ],
    })
  );
  return artifactOf(teams, overrides);
}

interface Built {
  readonly artifact: DistrictArtifact;
  readonly teams: readonly ChampLedgerTeam[];
  readonly statuses: ChampLedgerStatusModel;
  readonly fieldChanceByTeam: ReadonlyMap<string, number>;
}

function build(options: {
  artifact?: DistrictArtifact;
  stages?: ReadonlyMap<string, DistrictStageFinality>;
  dcmpStarted?: boolean;
  chance?: number;
}): Built {
  const artifact = options.artifact ?? bubbleArtifact();
  const teamKeys = artifact.teams.map((t) => t.teamKey);
  const fieldChanceByTeam = new Map(teamKeys.map((key) => [key, options.chance ?? 0.5] as const));
  const rows = buildChampLedgerRows({
    artifact,
    distributions: dcmpDistributions("2026pncmp", teamKeys),
    stageByEvent:
      options.stages ??
      new Map([
        ["2026wabon", ALL_FINAL],
        ["2026pncmp", ALL_OPEN],
      ]),
    dcmpStarted: options.dcmpStarted ?? false,
    fieldChanceByTeam,
  });
  return {
    artifact,
    teams: rows.teams,
    statuses: computeChampLedgerStatuses({ artifact, teams: rows.teams }),
    fieldChanceByTeam,
  };
}

function runOf(built: Built, overrides: { runSignature?: string | null; positionId?: string; dcmpEventKey?: string | undefined } = {}) {
  return buildChampAdvancementChanceRun({
    artifact: built.artifact,
    teams: built.teams,
    statuses: built.statuses,
    runSignature: overrides.runSignature === undefined ? "run-1" : overrides.runSignature,
    positionId: overrides.positionId ?? "now",
    dcmpEventKey: "dcmpEventKey" in overrides ? overrides.dcmpEventKey : "2026pncmp",
    fieldChanceByTeam: built.fieldChanceByTeam,
  });
}

describe("buildChampAdvancementChanceRun", () => {
  it("ranks the champ grand totals against cmpSlots, not dcmpSlots, and reserves nothing", () => {
    const run = runOf(build({}));
    expect(run).toBeDefined();
    expect(run!.inputs.slots).toBe(12);
    expect(run!.inputs.slots).not.toBe(50);
    expect(run!.inputs.reservedSlots).toBe(0);
    expect(run!.inputs.teams).toHaveLength(20);
    expect(run!.excludedTeams).toEqual([]);
  });

  it("refuses an unpublished championship capacity", () => {
    expect(runOf(build({ artifact: bubbleArtifact({ cmpSlots: null }) }))).toBeUndefined();
  });

  it("refuses while the per-event run is still in flight", () => {
    expect(runOf(build({}), { runSignature: null })).toBeUndefined();
  });

  it("refuses a field with nothing open left in it", () => {
    const settled = build({
      stages: new Map([
        ["2026wabon", ALL_FINAL],
        ["2026pncmp", ALL_FINAL],
      ]),
      dcmpStarted: true,
    });
    expect(settled.teams.every((t) => !t.hasOpenCategory)).toBe(true);
    expect(runOf(settled)).toBeUndefined();
  });

  it("is stable: the same inputs produce the same signature", () => {
    expect(runOf(build({ chance: 0.4 }))!.signature).toBe(runOf(build({ chance: 0.4 }))!.signature);
  });

  it("MOVES when the field chance moves, which nothing else in the composition can see", () => {
    const before = runOf(build({ chance: 0.4 }))!;
    const after = runOf(build({ chance: 0.6 }))!;
    expect(after.signature).not.toBe(before.signature);
    // Every grand-total LENGTH is unchanged, which is exactly why a fold over
    // the shapes alone would have gone stale.
    const shapes = (run: typeof before): string => run.inputs.teams.map((t) => String(t.counts.length)).join(",");
    expect(shapes(after)).toBe(shapes(before));
  });

  it("MOVES when the dcmp event key changes", () => {
    const built = build({});
    expect(runOf(built, { dcmpEventKey: "2026oncmp" })!.signature).not.toBe(runOf(built)!.signature);
    expect(runOf(built, { dcmpEventKey: undefined })!.signature).not.toBe(runOf(built)!.signature);
  });

  it("MOVES when the rewind position moves", () => {
    const built = build({});
    expect(runOf(built, { positionId: "2026pncmp:qualsDone" })!.signature).not.toBe(runOf(built)!.signature);
  });
});

// ---------------------------------------------------------------------------
// reconcileChampAdvancementChances
// ---------------------------------------------------------------------------

function champStatusesOf(statuses: Record<string, DistrictLedgerStatusState>): ChampLedgerStatusModel {
  return {
    byTeam: new Map(
      Object.entries(statuses).map(([teamKey, status]) => [
        teamKey,
        { teamKey, status, byAward: false, awardKind: null, verdict: "contending" as const, lockedBy: null, poolRank: null },
      ])
    ),
    counts: { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 },
    verdictCensus: { locked: 0, lockedAward: 0, prequalified: 0, eliminated: 0, contending: 0, unknown: 0 },
    floorCutLine: null,
    awardQualified: [],
    prequalified: [],
    reservedSlots: 0,
    pointsSlots: 0,
  };
}

describe("reconcileChampAdvancementChances", () => {
  it("prints a chance under In range and Out of range alone", () => {
    const model = reconcileChampAdvancementChances(
      new Map([
        ["frcIn", 0.7],
        ["frcOut", 0.2],
        ["frcLocked", 1],
        ["frcLockedOut", 0],
        ["frcPrequalified", 1],
      ]),
      champStatusesOf({
        frcIn: "inRange",
        frcOut: "outOfRange",
        frcLocked: "locked",
        frcLockedOut: "lockedOut",
        frcPrequalified: "prequalified",
      })
    );
    expect([...model.byTeam.keys()].sort()).toEqual(["frcIn", "frcOut"]);
    expect(model.gaps).toEqual([]);
  });

  it("counts a disagreement with a guarantee and never prints it", () => {
    const model = reconcileChampAdvancementChances(
      new Map([
        ["frcLocked", 0.93],
        ["frcLockedOut", 0.04],
      ]),
      champStatusesOf({ frcLocked: "locked", frcLockedOut: "lockedOut" })
    );
    expect(model.byTeam.size).toBe(0);
    expect(model.gaps).toEqual(["frcLocked", "frcLockedOut"]);
  });
});
