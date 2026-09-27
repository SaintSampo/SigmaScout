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
  buildChampAwardDraws,
  champFieldChances,
  champRangeState,
  districtFieldMembershipChances,
  hypotheticalDcmpEstimates,
  reconcileChampAdvancementChances,
  type ChampRangeStateInputs,
} from "./champLedgerChances.js";
import { CHAMP_CUTOFF_TUNING_GRID } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
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

// ---------------------------------------------------------------------------
// Quick task 260927-6bf: the simulated line's pure halves
// ---------------------------------------------------------------------------

describe("champFieldChances", () => {
  const statuses = districtStatusesOf({ frcLocked: "locked", frcOut: "lockedOut", frcIn: "inRange", frcBubble: "outOfRange", frcUnknown: "capacityUnknown" });

  it("reads the settled district tier as a settled tie: In range 1, Out of range 0", () => {
    const chances = champFieldChances(statuses, undefined, true);
    expect(chances.get("frcIn")).toBe(1);
    expect(chances.get("frcBubble")).toBe(0);
    expect(chances.get("frcLocked")).toBe(1);
    expect(chances.get("frcOut")).toBe(0);
    expect(chances.has("frcUnknown")).toBe(false);
  });

  it("reads the marginal where the district run returned one", () => {
    const chances = champFieldChances(statuses, new Map([["frcIn", 0.8], ["frcBubble", 0.3]]), false);
    expect(chances.get("frcIn")).toBe(0.8);
    expect(chances.get("frcBubble")).toBe(0.3);
  });

  it("leaves In range and Out of range ABSENT while the district run is in flight", () => {
    const chances = champFieldChances(statuses, undefined, false);
    expect(chances.has("frcIn")).toBe(false);
    expect(chances.has("frcBubble")).toBe(false);
    expect(chances.get("frcLocked")).toBe(1);
  });
});

describe("hypotheticalDcmpEstimates", () => {
  const districtTeams = [
    { teamKey: "frc1", projection: 120 },
    { teamKey: "frc2", projection: 80 },
    { teamKey: "frc3", projection: 40 },
  ];

  it("is ready with one estimate per team, a stronger field rank priced higher", () => {
    const result = hypotheticalDcmpEstimates({ season: 2026, districtTeams, fieldChanceFor: () => 1, spreadScale: 1 });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect([...result.byTeam.keys()].sort()).toEqual(["frc1", "frc2", "frc3"]);
    const mean = (key: string): number => {
      const { counts, denominator } = result.byTeam.get(key)!.distribution;
      let sum = 0;
      for (let i = 0; i < counts.length; i++) sum += i * counts[i]!;
      return sum / denominator;
    };
    expect(mean("frc1")).toBeGreaterThan(mean("frc3"));
    expect(result.byTeam.get("frc1")!.winChance).toBeGreaterThan(result.byTeam.get("frc3")!.winChance);
  });

  it("is noTable, a TERMINAL answer, for a season with no earlier history (2016)", () => {
    expect(hypotheticalDcmpEstimates({ season: 2016, districtTeams, fieldChanceFor: () => 1, spreadScale: 1 }).kind).toBe("noTable");
  });

  it("is awaitingFieldChances, a TRANSIENT answer, while an open team lacks a chance", () => {
    const result = hypotheticalDcmpEstimates({ season: 2026, districtTeams, fieldChanceFor: (key) => (key === "frc2" ? undefined : 1), spreadScale: 1 });
    expect(result.kind).toBe("awaitingFieldChances");
  });
});

describe("buildChampAwardDraws", () => {
  const rookie = { bucket: "none" as const, rookie: true };
  const veteran = { bucket: "threeOrMore" as const, rookie: false };
  function awardArtifact(dcmpAwardsPosted: boolean): DistrictArtifact {
    return artifactOf([
      team({
        teamKey: "frc1",
        awardProfile: veteran,
        eventPoints: [
          eventPoints({ eventKey: "2026wabon", week: 0 }),
          eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", state: state({ awardsPosted: dcmpAwardsPosted }) }),
        ],
        qualifyingAwards: [
          { eventKey: "2026wabon", awardType: 0, label: "Impact", awardOnly: false },
          // A DCMP tier award: must NEVER become a candidate.
          { eventKey: "2026pncmp", awardType: 9, label: "EI", awardOnly: false },
        ],
      }),
      team({
        teamKey: "frc2",
        awardProfile: rookie,
        eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0 })],
        qualifyingAwards: [{ eventKey: "2026wabon", awardType: 10, label: "RAS", awardOnly: true }],
      }),
      team({
        teamKey: "frc3",
        awardProfile: veteran,
        remainingEvents: [{ eventKey: "2026wasno", eventName: "Sno", week: 2, tier: "district", maxPoints: 83, state: state({ awardsPosted: false, playoffsDone: false, alliancesPicked: false, qualMatchesPlayed: 0 }) }],
        qualifyingAwards: [],
      }),
    ]);
  }

  it("lists district winners of each award as candidates and never a dcmp tier award", () => {
    const draws = buildChampAwardDraws({ artifact: awardArtifact(false), setting: CHAMP_CUTOFF_TUNING_GRID[0]! });
    expect(draws.map((draw) => draw.awardType)).toEqual([0, 9, 10]);
    expect(draws[0]!.candidates.map((c) => c.teamKey)).toEqual(["frc1"]);
    expect(draws[1]!.candidates).toEqual([]);
    expect(draws[2]!.candidates).toEqual([{ teamKey: "frc2", weight: 1 }]);
  });

  it("adds each district event whose award stage is open as a pending event, with eligibility applied", () => {
    const draws = buildChampAwardDraws({ artifact: awardArtifact(false), setting: CHAMP_CUTOFF_TUNING_GRID[0]! });
    const pendingRas = draws[2]!.pendingEvents;
    expect(pendingRas.map((event) => event.eventKey)).toEqual(["2026wasno"]);
    // frc3 is a veteran: ineligible for Rookie All Star, eligible for Engineering Inspiration.
    expect(pendingRas[0]!.entrants).toEqual([{ teamKey: "frc3", weight: 0 }]);
    expect(draws[1]!.pendingEvents[0]!.entrants).toEqual([{ teamKey: "frc3", weight: 1 }]);
  });

  it("reads a rewound stage: an award stage not final at the position is no candidate yet", () => {
    const stageByEvent = new Map<string, DistrictStageFinality>([
      ["2026wabon", { ...ALL_FINAL, award: false }],
      ["2026pncmp", ALL_OPEN],
      ["2026wasno", ALL_OPEN],
    ]);
    const draws = buildChampAwardDraws({ artifact: awardArtifact(true), stageByEvent, setting: CHAMP_CUTOFF_TUNING_GRID[0]! });
    expect(draws[0]!.candidates).toEqual([]);
    expect(draws[0]!.pendingEvents.map((event) => event.eventKey)).toEqual(["2026wabon", "2026wasno"]);
  });

  it("returns [] once the DCMP awards stage is final at the position", () => {
    expect(buildChampAwardDraws({ artifact: awardArtifact(true), setting: CHAMP_CUTOFF_TUNING_GRID[0]! })).toEqual([]);
  });

  it("reads a team with NO award profile as the zero profile: a veteran with no decorations (Jacob, 2026-09-27)", () => {
    const unprofiled = artifactOf([
      team({
        teamKey: "frc4",
        eventPoints: [eventPoints({ eventKey: "2026wabon", week: 0 })],
        qualifyingAwards: [{ eventKey: "2026wabon", awardType: 0, label: "Impact", awardOnly: false }],
      }),
      team({
        teamKey: "frc5",
        remainingEvents: [{ eventKey: "2026wasno", eventName: "Sno", week: 2, tier: "district", maxPoints: 83, state: state({ awardsPosted: false, playoffsDone: false, alliancesPicked: false, qualMatchesPlayed: 0 }) }],
        qualifyingAwards: [],
      }),
    ]);
    expect(unprofiled.teams.every((entry) => entry.awardProfile === undefined)).toBe(true);
    const uniform = buildChampAwardDraws({ artifact: unprofiled, setting: CHAMP_CUTOFF_TUNING_GRID[0]! });
    // Never a Rookie All Star entrant; weight 1 for Impact and EI under uniform.
    expect(uniform[2]!.pendingEvents[0]!.entrants).toEqual([{ teamKey: "frc5", weight: 0 }]);
    expect(uniform[1]!.pendingEvents[0]!.entrants).toEqual([{ teamKey: "frc5", weight: 1 }]);
    expect(uniform[0]!.candidates).toEqual([{ teamKey: "frc4", weight: 1 }]);
    // Under decoration it weighs as the none bucket veteran, which is below
    // the three or more bucket veteran the base rate table ranks highest.
    const decoration = CHAMP_CUTOFF_TUNING_GRID.find((setting) => setting.weighting === "decoration")!;
    const none = buildChampAwardDraws({ artifact: unprofiled, setting: decoration })[0]!.candidates[0]!.weight;
    const decorated = buildChampAwardDraws({ artifact: awardArtifact(false), setting: decoration })[0]!.candidates[0]!.weight;
    expect(none).toBeGreaterThan(0);
    expect(none).toBeLessThan(decorated);
  });

  it("weights by the award base rate under decoration", () => {
    const decoration = CHAMP_CUTOFF_TUNING_GRID.find((setting) => setting.weighting === "decoration")!;
    const draws = buildChampAwardDraws({ artifact: awardArtifact(false), setting: decoration });
    const weight = draws[0]!.candidates[0]!.weight;
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1);
  });
});

describe("champRangeState — ONE state for the chips and the line", () => {
  const COMPLETE_LINE = Float64Array.from({ length: 10 }, (_unused, i) => 150 + i);
  function inputs(overrides: Partial<ChampRangeStateInputs> = {}): ChampRangeStateInputs {
    return {
      dcmpAwardsFinal: false,
      cmpSlots: 21,
      perEventRunSignature: "sig",
      districtRun: { built: true, status: "complete", current: true },
      estimates: "ready",
      unpricedInTeams: 0,
      champRun: { built: true, status: "complete", current: true, excludedTeams: [], cutoffByRun: COMPLETE_LINE, draws: 10 },
      ...overrides,
    };
  }

  it("walks pending, then simulated, over a scripted sequence of run states", () => {
    const sequence: ChampRangeStateInputs[] = [
      inputs({ perEventRunSignature: null }),
      inputs({ districtRun: { built: true, status: "idle" } }),
      inputs({ districtRun: { built: true, status: "running" } }),
      inputs({ districtRun: { built: true, status: "complete", current: false } }),
      inputs({ champRun: { built: true, status: "idle" } }),
      inputs({ champRun: { built: true, status: "running" } }),
      inputs({ champRun: { built: true, status: "complete", current: false } }),
      inputs(),
    ];
    const kinds = sequence.map((step) => champRangeState(step).kind);
    expect(kinds).toEqual(["pending", "pending", "pending", "pending", "pending", "pending", "pending", "simulated"]);
    const last = champRangeState(inputs());
    expect(last).toMatchObject({ kind: "simulated" });
    if (last.kind === "simulated") expect(last.likely.p10).toBeLessThan(last.likely.p90);
  });

  it("reaches every named noCall reason, and never a rank rule outside settled", () => {
    const reasons = [
      champRangeState(inputs({ districtRun: { built: true, status: "error" } })),
      champRangeState(inputs({ estimates: "noTable" })),
      champRangeState(inputs({ districtRun: { built: false, status: "idle" }, estimates: "awaitingFieldChances" })),
      champRangeState(inputs({ unpricedInTeams: 1 })),
      champRangeState(inputs({ champRun: { built: false, status: "idle" } })),
      champRangeState(inputs({ champRun: { built: true, status: "error" } })),
      champRangeState(inputs({ champRun: { built: true, status: "complete", current: true, excludedTeams: ["frc1"], cutoffByRun: COMPLETE_LINE, draws: 10 } })),
      champRangeState(inputs({ champRun: { built: true, status: "complete", current: true, excludedTeams: [], draws: 10 } })),
    ];
    expect(reasons.map((state) => (state.kind === "noCall" ? state.reason : state.kind))).toEqual([
      "workerError",
      "noHistoryTable",
      "noFieldChance",
      "unpricedDcmp",
      "runRefused",
      "workerError",
      "teamsExcluded",
      "noLine",
    ]);
  });

  it("is settled once the DCMP awards are final or the capacity is unpublished, whatever else is in flight", () => {
    expect(champRangeState(inputs({ dcmpAwardsFinal: true, perEventRunSignature: null })).kind).toBe("settled");
    expect(champRangeState(inputs({ cmpSlots: null, champRun: { built: false, status: "error" } })).kind).toBe("settled");
  });

  it("reads a FAILED per event run as a terminal workerError, never pending forever", () => {
    expect(champRangeState(inputs({ perEventRunSignature: null, perEventRunFailed: true }))).toEqual({ kind: "noCall", reason: "workerError" });
    // The DCMP awards being final still wins: nothing is drawn any more.
    expect(champRangeState(inputs({ dcmpAwardsFinal: true, perEventRunFailed: true })).kind).toBe("settled");
  });

  it("maps every transient input to pending, never noCall", () => {
    for (const step of [
      inputs({ perEventRunSignature: null, estimates: "noTable" }),
      inputs({ districtRun: { built: true, status: "running" }, estimates: "awaitingFieldChances" }),
      inputs({ champRun: { built: true, status: "running" } }),
    ]) {
      expect(champRangeState(step).kind).toBe("pending");
    }
  });
});

describe("buildChampAdvancementChanceRun — champ mode", () => {
  it("posts the shipped run byte for byte when no award draws are supplied", () => {
    const built = build({});
    const run = runOf(built)!;
    expect(run.inputs.awardDraws).toBeUndefined();
    expect(run.inputs.teams.every((t) => t.dcmp === undefined)).toBe(true);
  });

  it("posts split district and DCMP parts plus the draw spec when award draws are supplied, and the signature moves with them", () => {
    const built = build({});
    const awardDraws = [{ awardType: 0, countWeights: [0, 1], candidates: [{ teamKey: "frc20", weight: 1 }], pendingEvents: [] }];
    const champ = buildChampAdvancementChanceRun({
      artifact: built.artifact,
      teams: built.teams,
      statuses: built.statuses,
      runSignature: "run-1",
      positionId: "now",
      dcmpEventKey: "2026pncmp",
      fieldChanceByTeam: built.fieldChanceByTeam,
      awardDraws,
    })!;
    expect(champ.inputs.awardDraws).toEqual(awardDraws);
    const first = champ.inputs.teams[0]!;
    expect(first.dcmp).toBeDefined();
    expect(first.dcmp!.fieldChance).toBe(0.5);
    expect(champ.excludedTeams).toEqual([]);
    expect(champ.signature).not.toBe(runOf(built)!.signature);
    const other = buildChampAdvancementChanceRun({
      artifact: built.artifact,
      teams: built.teams,
      statuses: built.statuses,
      runSignature: "run-1",
      positionId: "now",
      dcmpEventKey: "2026pncmp",
      fieldChanceByTeam: built.fieldChanceByTeam,
      awardDraws: [{ ...awardDraws[0]!, countWeights: [0.5, 0.5] }],
    })!;
    expect(other.signature).not.toBe(champ.signature);
  });
});
