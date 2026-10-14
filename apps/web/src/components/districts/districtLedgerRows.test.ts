/**
 * The District Locks tab's pure assembly layer.
 *
 * Synthetic fixtures parsed through the REAL `DistrictArtifactSchema`, so every
 * one of them matches the published shape. No corpus, no network, so CI runs
 * every test in this file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DistrictArtifactSchema,
  DistrictPreSimArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { POINT_CELL_CHANCE_FORM_THRESHOLD, pointQuantile } from "../../../../../packages/core/districts/pointSummary.js";
import type { AllianceBracketMilestone } from "../../../../../packages/core/districts/bracket.js";
import type {
  DistrictLedgerResult,
  DistrictSelectionRouteObservation,
  DistrictSelectionRoutes,
} from "../../../../../packages/core/districts/ledgerSimulation.js";
import { simulateDistrictEvent } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { pickPositionPmfForSeason } from "../../../../../packages/core/districts/pickDraft.js";
import {
  ZERO_AWARD_PROFILE,
  allDistrictTierEventKeys,
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  dcmpBracketFactsAtPosition,
  dcmpBracketFactsFor,
  dcmpBracketMilestonesByTeam,
  decodeDistrictPointPmf,
  deriveLiveStage,
  deriveStageFromState,
  districtCellId,
  districtEventContributions,
  districtTierEvents,
  distributionsFromPreSim,
  distributionsFromResult,
  filterDistrictLedgerTeams,
  inProgressDistrictEventKeys,
  liveStageByEvent,
  openPlayoffBounds,
  playedBracketMatchesFor,
  pointMassDistribution,
  rowCountedPoints,
  securedBeyondPosted,
  securedElimByTeamFor,
  securedElimEntry,
  settledElimBounds,
  settledPlayoffPoints,
  teamNotPickedAtPosition,
  type BracketSourceEvent,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import { openCellLines } from "./LedgerParts.js";

type DistrictTeam = DistrictArtifact["teams"][number];
type EventPoints = DistrictTeam["eventPoints"][number];
type RemainingEvent = DistrictTeam["remainingEvents"][number];

const SEASON = 2026;

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

function remainingEvent(overrides: Partial<RemainingEvent> & { eventKey: string }): RemainingEvent {
  return {
    eventName: `Event ${overrides.eventKey}`,
    week: 3,
    tier: "district",
    maxPoints: 83,
    ...overrides,
  };
}

function team(overrides: Partial<DistrictTeam> & { teamKey: string }): DistrictTeam {
  return {
    teamNumber: Number(overrides.teamKey.replace("frc", "")),
    nickname: `Nickname ${overrides.teamKey}`,
    rank: 1,
    pointTotal: 23,
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
      eventCount: 8,
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

const NO_DISTRIBUTIONS: ReadonlyMap<string, DistrictEventDistributions> = new Map();

describe("districtTierEvents", () => {
  it("drops a dcmp-tier eventPoints row and keeps every district-tier one", () => {
    const subject = team({
      teamKey: "frc4131",
      eventPoints: [
        eventPoints({ eventKey: "2026wabon", week: 0 }),
        eventPoints({ eventKey: "2026wasam", week: 2 }),
        eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp" }),
      ],
    });
    const rows = districtTierEvents(subject);
    expect(rows.map((row) => row.eventKey)).toEqual(["2026wabon", "2026wasam"]);
    expect(rows.some((row) => row.eventKey === "2026pncmp")).toBe(false);
  });

  it("returns one row per district-tier event, for one, two, three and four events", () => {
    for (const count of [1, 2, 3, 4]) {
      const subject = team({
        teamKey: "frc1",
        eventPoints: Array.from({ length: count }, (_unused, i) => eventPoints({ eventKey: `2026wa${String(i)}`, week: i })),
      });
      expect(districtTierEvents(subject)).toHaveLength(count);
    }
  });

  it("orders by week ascending with a null week last and the event name as the tie-break", () => {
    const subject = team({
      teamKey: "frc1",
      eventPoints: [
        eventPoints({ eventKey: "d", week: null, eventName: "Zulu" }),
        eventPoints({ eventKey: "c", week: 2, eventName: "Bravo" }),
        eventPoints({ eventKey: "b", week: 2, eventName: "Alpha" }),
        eventPoints({ eventKey: "a", week: 0, eventName: "Charlie" }),
      ],
    });
    expect(districtTierEvents(subject).map((row) => row.eventKey)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("deriveStageFromState", () => {
  it("reads all four facts from the state block and nothing else", () => {
    // Each single fact override sets its LATER facts false too, so the
    // assertion still isolates that fact under quick task 261007-jvz's
    // cascade (a later fact closes every earlier category).
    expect(deriveStageFromState(state({ qualMatchesPlayed: 60, qualMatchesTotal: 60 })).final.qual).toBe(true);
    expect(deriveStageFromState(state({ qualMatchesPlayed: 30, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false })).final.qual).toBe(false);
    expect(deriveStageFromState(state({ alliancesPicked: false, playoffsDone: false, awardsPosted: false })).final.alliance).toBe(false);
    expect(deriveStageFromState(state({ playoffsDone: false, awardsPosted: false })).final.elim).toBe(false);
    expect(deriveStageFromState(state({ awardsPosted: false })).final.award).toBe(false);
  });

  it("cascades: a curtailed schedule reads qualification final once a later stage closes (2023nhgrs, 52 of 78)", () => {
    const derived = deriveStageFromState(state({ qualMatchesPlayed: 52, qualMatchesTotal: 78 }));
    expect(derived.final).toEqual({ qual: true, alliance: true, elim: true, award: true });
    expect(derived.finished).toBe(true);
  });

  it("leaves qualification OPEN for a null qualMatchesTotal rather than guessing it finished", () => {
    const derived = deriveStageFromState(state({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false }));
    expect(derived.final.qual).toBe(false);
    expect(derived.finished).toBe(false);
  });

  it("leaves all four open and flags the row state-unknown when the artifact carries no state block", () => {
    const derived = deriveStageFromState(undefined);
    expect(derived.stateKnown).toBe(false);
    expect(derived.final).toEqual({ qual: false, alliance: false, elim: false, award: false });
    expect(derived.started).toBe(false);
    expect(derived.finished).toBe(false);
  });
});

describe("inProgressDistrictEventKeys", () => {
  it("returns exactly the started-and-unfinished district-tier events", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        eventPoints: [
          eventPoints({ eventKey: "2026wadone", week: 0, state: state() }),
          eventPoints({ eventKey: "2026walive", week: 2, state: state({ qualMatchesPlayed: 20, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) }),
        ],
        remainingEvents: [
          remainingEvent({ eventKey: "2026wasoon", week: 4, state: state({ qualMatchesPlayed: 0, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false }) }),
        ],
      }),
    ]);
    expect(inProgressDistrictEventKeys(artifact)).toEqual(["2026walive"]);
    expect(allDistrictTierEventKeys(artifact)).toEqual(["2026wadone", "2026walive", "2026wasoon"]);
  });
});

describe("decodeDistrictPointPmf", () => {
  it("decodes the offset encoding to a dense array whose index is the point value, with a denominator of 1", () => {
    const decoded = decodeDistrictPointPmf({ o: 3, p: [0.25, 0.5, 0.25] });
    expect(decoded.denominator).toBe(1);
    expect(decoded.counts.length).toBe(3 + 3);
    expect([...(decoded.counts as Float64Array)]).toEqual([0, 0, 0, 0.25, 0.5, 0.25]);
  });

  it("gives every distribution the SAME interface, with no offset field anywhere on it", () => {
    const baked: DistrictPointDistribution = decodeDistrictPointPmf({ o: 2, p: [1] });
    const simulated: DistrictPointDistribution = { counts: Int32Array.from([0, 0, 1000]), denominator: 1000 };
    for (const distribution of [baked, simulated]) {
      expect(Object.keys(distribution).sort()).toEqual(["counts", "denominator"]);
      expect("o" in distribution).toBe(false);
      expect("offset" in distribution).toBe(false);
    }
  });

  it("decodes a whole sidecar into roster-keyed rows", () => {
    const pmf = { o: 0, p: [0.5, 0.5] };
    const sidecar = DistrictPreSimArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      districtKey: "2026pnw",
      eventKey: "2026wasoon",
      year: SEASON,
      roster: ["frc1", "frc2"],
      rows: [{ t: 1, qual: pmf, alliance: pmf, elim: pmf, award: pmf, total: pmf }],
    });
    const decoded = distributionsFromPreSim(sidecar);
    expect(decoded.eventKey).toBe("2026wasoon");
    expect([...decoded.byTeam.keys()]).toEqual(["frc2"]);
    expect(decoded.byTeam.get("frc2")?.qual?.denominator).toBe(1);
  });
});

describe("pointMassDistribution", () => {
  it("puts all the mass at the integer point value", () => {
    const mass = pointMassDistribution(12);
    expect(mass.counts.length).toBe(13);
    expect(mass.counts[12]).toBe(1);
    expect(mass.denominator).toBe(1);
  });
});

describe("buildDistrictLedgerRows", () => {
  it("prints the artifact's own earned integer in a final cell even when a simulated histogram for the same cell disagrees", () => {
    const artifact = artifactOf([
      team({ teamKey: "frc1", pointTotal: 23, eventPoints: [eventPoints({ eventKey: "2026wabon", qual: 11, total: 24 })] }),
    ]);
    // A histogram whose median is nowhere near 11 for the SAME event and category.
    const counts = new Int32Array(23);
    counts[22] = 100;
    const distributions = new Map<string, DistrictEventDistributions>([
      ["2026wabon", { eventKey: "2026wabon", byTeam: new Map([["frc1", { qual: { counts, denominator: 100 }, alliance: undefined, elim: undefined, award: undefined, eventTotal: undefined, grandTotal: undefined }]]) }],
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions });
    const qualCell = built.teams[0]!.rows[0]!.cells[0]!;
    expect(qualCell.kind).toBe("final");
    if (qualCell.kind !== "final") throw new Error("unreachable");
    expect(qualCell.earned).toBe(11);
    expect(qualCell.id).toBe(districtCellId("2026wabon", "qual"));
  });

  it("reports a team's row count as its district-tier event count and spans the grand total over it", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc4131",
        pointTotal: 100,
        eventPoints: [
          eventPoints({ eventKey: "2026wabon", week: 0, total: 30 }),
          eventPoints({ eventKey: "2026wasam", week: 2, total: 40 }),
          eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", total: 30 }),
        ],
      }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams[0]!.rowCount).toBe(2);
    expect(built.teams[0]!.earnedDistrictTotal).toBe(70);
  });

  it("gives a fully finished team a grand total that is its DISTRICT-tier earned total, excluding dcmp-tier points", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc4131",
        pointTotal: 105,
        rookieBonus: 5,
        adjustments: 0,
        eventPoints: [
          eventPoints({ eventKey: "2026wabon", week: 0, total: 30 }),
          eventPoints({ eventKey: "2026wasam", week: 2, total: 40 }),
          eventPoints({ eventKey: "2026pncmp", week: 5, tier: "dcmp", total: 30 }),
        ],
      }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    const grand = built.teams[0]!.grandTotal;
    expect(grand.kind).toBe("final");
    if (grand.kind !== "final") throw new Error("unreachable");
    // 30 + 40 district-tier, plus the rookie bonus; the 30 dcmp-tier points are excluded.
    expect(grand.earned).toBe(75);
    expect(built.teams[0]!.projection).toBe(75);
  });

  it("renders an open cell as unavailable when the tab holds no distribution for it, rather than blank", () => {
    const openState = state({ qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    const artifact = artifactOf([
      team({ teamKey: "frc1", eventPoints: [eventPoints({ eventKey: "2026walive", state: openState })] }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams[0]!.rows[0]!.cells.map((cell) => cell.kind)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable"]);
    expect(built.teams[0]!.grandTotal.kind).toBe("unavailable");
  });

  it("uses every histogram length from maxEventPoints rather than a literal", () => {
    const ceilings = maxEventPoints(SEASON, "district");
    const openState = state({ qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    const artifact = artifactOf([team({ teamKey: "frc1", eventPoints: [eventPoints({ eventKey: "2026walive", state: openState })] })]);
    const counts = new Int32Array(ceilings.qual + 1);
    counts[5] = 100;
    const byTeam = new Map([
      ["frc1", { qual: { counts, denominator: 100 }, alliance: undefined, elim: undefined, award: undefined, eventTotal: undefined, grandTotal: undefined }],
    ]);
    const built = buildDistrictLedgerRows({
      artifact,
      distributions: new Map([["2026walive", { eventKey: "2026walive", byTeam }]]),
    });
    const qual = built.teams[0]!.rows[0]!.cells[0]!;
    expect(qual.kind).toBe("open");
    if (qual.kind !== "open") throw new Error("unreachable");
    expect(qual.ceiling).toBe(ceilings.qual);
  });

  it("sorts descending by the projection, so a lower-earned team with a higher median sorts above", () => {
    const openState = state({ qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    // frc2 has earned less but its open event total is a near-certain 60.
    const artifact = artifactOf([
      team({ teamKey: "frc1", pointTotal: 40, eventPoints: [eventPoints({ eventKey: "2026wadone", total: 40, qual: 20, alliance: 10, elim: 10, award: 0 })] }),
      team({ teamKey: "frc2", pointTotal: 10, eventPoints: [eventPoints({ eventKey: "2026walive", total: 10, state: openState })] }),
    ]);
    const eventTotalCounts = new Int32Array(61);
    eventTotalCounts[60] = 100;
    const built = buildDistrictLedgerRows({
      artifact,
      distributions: new Map([
        [
          "2026walive",
          {
            eventKey: "2026walive",
            byTeam: new Map([
              ["frc2", { qual: undefined, alliance: undefined, elim: undefined, award: undefined, eventTotal: { counts: eventTotalCounts, denominator: 100 }, grandTotal: undefined }],
            ]),
          },
        ],
      ]),
    });
    expect(built.teams.map((entry) => entry.teamKey)).toEqual(["frc2", "frc1"]);
    expect(built.teams[0]!.position).toBe(1);
    expect(built.teams[1]!.position).toBe(2);
  });

  it("breaks a projection tie by the earned total and then by team number", () => {
    const artifact = artifactOf([
      team({ teamKey: "frc30", pointTotal: 40, eventPoints: [eventPoints({ eventKey: "a", total: 40 })] }),
      team({ teamKey: "frc10", pointTotal: 40, eventPoints: [eventPoints({ eventKey: "a", total: 40 })] }),
      team({ teamKey: "frc20", pointTotal: 40, eventPoints: [eventPoints({ eventKey: "a", total: 40 })] }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams.map((entry) => entry.teamNumber)).toEqual([10, 20, 30]);
  });

  it("prints the earned total AT THE POSITION when rewound, and the published totals at now (finding 4)", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: 70,
        eventPoints: [
          eventPoints({ eventKey: "a", qual: 20, alliance: 10, elim: 10, award: 5, total: 45 }),
          eventPoints({ eventKey: "b", qual: 12, alliance: 6, elim: 7, award: 0, total: 25 }),
        ],
      }),
    ]);
    const now = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(now.teams[0]!.earnedAtPosition).toBe(70);
    expect(now.teams[0]!.earnedDistrictTotal).toBe(70);
    const rewound = buildDistrictLedgerRows({
      artifact,
      distributions: NO_DISTRIBUTIONS,
      stageByEvent: new Map<string, DistrictStageFinality>([
        ["a", { qual: true, alliance: true, elim: true, award: true }],
        ["b", { qual: true, alliance: false, elim: false, award: false }],
      ]),
    });
    // Event a is final (its published 45); event b has only its 12 qual points.
    expect(rewound.teams[0]!.earnedAtPosition).toBe(57);
    expect(rewound.teams[0]!.earnedDistrictTotal).toBe(70);
    // No distributions, so the grand total is unavailable and the projection
    // falls back to the earned total AT THE POSITION, never the 13 points of
    // event b earned later.
    expect(rewound.teams[0]!.grandTotal.kind).toBe("unavailable");
    expect(rewound.teams[0]!.projection).toBe(57);
    expect(now.teams[0]!.projection).toBe(70);
    const seasonStart = buildDistrictLedgerRows({
      artifact,
      distributions: NO_DISTRIBUTIONS,
      stageByEvent: new Map<string, DistrictStageFinality>([
        ["a", { qual: false, alliance: false, elim: false, award: false }],
        ["b", { qual: false, alliance: false, elim: false, award: false }],
      ]),
    });
    expect(seasonStart.teams[0]!.earnedAtPosition).toBe(0);
    expect(seasonStart.teams[0]!.projection).toBe(0);
  });

  it("discloses a team with no awardProfile rather than absorbing it", () => {
    const artifact = artifactOf([team({ teamKey: "frc1", eventPoints: [eventPoints({ eventKey: "a" })] })]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.gaps.teamsWithoutAwardProfile).toEqual(["frc1"]);
  });
});

describe("filterDistrictLedgerTeams and the stat line", () => {
  const artifact = artifactOf([
    team({ teamKey: "frc4131", pointTotal: 70, eventPoints: [eventPoints({ eventKey: "a", total: 70 })] }),
    team({ teamKey: "frc492", pointTotal: 41, eventPoints: [eventPoints({ eventKey: "a", total: 41 })] }),
  ]);
  const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });

  it("keeps every row of a team whose number starts with the query, and none of the others", () => {
    expect(filterDistrictLedgerTeams(built.teams, "41").map((entry) => entry.teamKey)).toEqual(["frc4131"]);
    expect(filterDistrictLedgerTeams(built.teams, "9")).toHaveLength(0);
    expect(filterDistrictLedgerTeams(built.teams, "")).toHaveLength(2);
  });

  // The two stat line tests that lived here are GONE with the function they
  // covered: the slot th highest unnarrowed earned district total is no longer
  // printed anywhere (quick task 260926-37q), and `predictedCutoff.test.ts`
  // covers the cutoff that replaced it.
});

// ---------------------------------------------------------------------------
// The two cell forms, the threshold, and the grand total
// ---------------------------------------------------------------------------

const OPEN_STATE = state({ qualMatchesPlayed: 4, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
const DENOM = 1000;

/** A lumpy distribution: `atZero` draws at 0 and the rest split evenly over 1..`support`. */
function lumpy(atZero: number, support: number): DistrictPointDistribution {
  const counts = new Int32Array(support + 1);
  counts[0] = atZero;
  const rest = DENOM - atZero;
  const each = Math.floor(rest / support);
  for (let i = 1; i <= support; i++) counts[i] = each;
  counts[support] = each + (rest - each * support);
  return { counts, denominator: DENOM };
}

function openArtifactWith(byTeam: Partial<Record<"qual" | "alliance" | "elim" | "award" | "eventTotal", DistrictPointDistribution>>) {
  const artifact = artifactOf([
    team({
      teamKey: "frc1",
      pointTotal: 0,
      remainingEvents: [remainingEvent({ eventKey: "2026walive", week: 1, state: OPEN_STATE })],
      maxRemainingDistrict: 83,
    }),
  ]);
  const distributions = new Map<string, DistrictEventDistributions>([
    [
      "2026walive",
      {
        eventKey: "2026walive",
        byTeam: new Map([
          [
            "frc1",
            {
              qual: byTeam.qual,
              alliance: byTeam.alliance,
              elim: byTeam.elim,
              award: byTeam.award,
              eventTotal: byTeam.eventTotal,
              grandTotal: undefined,
            },
          ],
        ]),
      },
    ],
  ]);
  return buildDistrictLedgerRows({ artifact, distributions });
}

describe("the two blue-cell forms", () => {
  const lumpyDistribution = lumpy(600, 16);

  it("selects the form per CATEGORY, not per cell", () => {
    const built = openArtifactWith({
      qual: lumpyDistribution,
      alliance: lumpyDistribution,
      elim: lumpyDistribution,
      award: lumpyDistribution,
      eventTotal: lumpyDistribution,
    });
    const row = built.teams[0]!.rows[0]!;
    const forms = row.cells.map((cell) => (cell.kind === "open" ? cell.summary.form : cell.kind));
    // Qualification takes the median form even though its fixture is lumpy;
    // the three lumpy categories take the chance form.
    expect(forms).toEqual(["median", "chance", "chance", "chance"]);
    expect(row.eventTotal.kind === "open" ? row.eventTotal.summary.form : "").toBe("median");
    const grand = built.teams[0]!.grandTotal;
    expect(grand.kind === "open" ? grand.summary.form : "").toBe("median");
  });

  it("falls a lumpy category back to the median form at 10-04's exported threshold, and keeps the chance form just below it", () => {
    const atZeroAtThreshold = Math.round((1 - POINT_CELL_CHANCE_FORM_THRESHOLD) * DENOM);
    const atThreshold = openArtifactWith({ alliance: lumpy(atZeroAtThreshold, 16) }).teams[0]!.rows[0]!.cells[1]!;
    const justBelow = openArtifactWith({ alliance: lumpy(atZeroAtThreshold + 1, 16) }).teams[0]!.rows[0]!.cells[1]!;
    expect(atThreshold.kind === "open" ? atThreshold.summary.form : "").toBe("median");
    expect(justBelow.kind === "open" ? justBelow.summary.form : "").toBe("chance");
  });

  it("prints a zero chance with NO conditional median when all the mass sits at zero — an absence, never a printed zero", () => {
    const allZero: DistrictPointDistribution = { counts: Int32Array.from([DENOM, 0, 0]), denominator: DENOM };
    const cell = openArtifactWith({ elim: allZero }).teams[0]!.rows[0]!.cells[2]!;
    expect(cell.kind).toBe("open");
    if (cell.kind !== "open" || cell.summary.form !== "chance") throw new Error("unreachable");
    expect(cell.summary.chance).toBe(0);
    expect(cell.summary.conditionalMedian).toBeUndefined();
  });
});

describe("the grand total convolution", () => {
  function rowFor(distribution: DistrictPointDistribution) {
    return { qual: undefined, alliance: undefined, elim: undefined, award: undefined, eventTotal: distribution, grandTotal: undefined };
  }

  function twoOpenEvents(a: DistrictPointDistribution, b: DistrictPointDistribution, rookieBonus = 0) {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: rookieBonus,
        rookieBonus,
        remainingEvents: [
          remainingEvent({ eventKey: "eventa", week: 0, state: OPEN_STATE }),
          remainingEvent({ eventKey: "eventb", week: 1, state: OPEN_STATE }),
        ],
        maxRemainingDistrict: 166,
      }),
    ]);
    return buildDistrictLedgerRows({
      artifact,
      distributions: new Map<string, DistrictEventDistributions>([
        ["eventa", { eventKey: "eventa", byTeam: new Map([["frc1", rowFor(a)]]) }],
        ["eventb", { eventKey: "eventb", byTeam: new Map([["frc1", rowFor(b)]]) }],
      ]),
    });
  }

  it("convolves two event totals entry for entry, against a hand-computed answer", () => {
    // Event A: half at 0, half at 2. Event B: half at 0, half at 3.
    const a: DistrictPointDistribution = { counts: Float64Array.from([0.5, 0, 0.5]), denominator: 1 };
    const b: DistrictPointDistribution = { counts: Float64Array.from([0.5, 0, 0, 0.5]), denominator: 1 };
    const grand = twoOpenEvents(a, b).teams[0]!.grandTotal;
    expect(grand.kind).toBe("open");
    if (grand.kind !== "open") throw new Error("unreachable");
    expect([...(grand.distribution.counts as Float64Array)]).toEqual([0.25, 0, 0.25, 0.25, 0, 0.25]);
  });

  it("shifts the whole convolution by the rookie bonus", () => {
    const point: DistrictPointDistribution = { counts: Float64Array.from([0, 1]), denominator: 1 };
    const grand = twoOpenEvents(point, point, 5).teams[0]!.grandTotal;
    if (grand.kind !== "open") throw new Error("unreachable");
    // 1 + 1 + a rookie bonus of 5 is a point mass at 7.
    expect(grand.distribution.counts.length).toBe(8);
    expect(grand.distribution.counts[7]).toBe(1);
  });

  it("gives the one-event and three-event cases a support that is the arithmetic sum of the parts", () => {
    const partSupport = 4;
    const part: DistrictPointDistribution = { counts: new Float64Array(partSupport + 1).fill(1 / (partSupport + 1)), denominator: 1 };
    for (const count of [1, 3]) {
      const artifact = artifactOf([
        team({
          teamKey: "frc1",
          pointTotal: 0,
          remainingEvents: Array.from({ length: count }, (_unused, i) => remainingEvent({ eventKey: `event${String(i)}`, week: i, state: OPEN_STATE })),
          maxRemainingDistrict: 83 * count,
        }),
      ]);
      const distributions = new Map<string, DistrictEventDistributions>(
        Array.from({ length: count }, (_unused, i) => [
          `event${String(i)}`,
          { eventKey: `event${String(i)}`, byTeam: new Map([["frc1", rowFor(part)]]) },
        ])
      );
      const grand = buildDistrictLedgerRows({ artifact, distributions }).teams[0]!.grandTotal;
      if (grand.kind !== "open") throw new Error("unreachable");
      expect(grand.distribution.counts.length - 1).toBe(partSupport * count);
    }
  });
});

// ---------------------------------------------------------------------------
// WR-09: a refusal attributable to ONE team costs that team, not the table
// ---------------------------------------------------------------------------

describe("a team whose row build refuses degrades alone (WR-09)", () => {
  /**
   * A negative combined shift is what `convolveDistrictGrandTotal` refuses:
   * `rookieBonus + adjustments` below zero has never been observed in the
   * corpus, so clamping it would fabricate a value. The whole point of this
   * suite is that the refusal reaches ONE row rather than the renderer.
   */
  const bad = () =>
    team({
      teamKey: "frc9999",
      pointTotal: 20,
      adjustments: -5,
      eventPoints: [eventPoints({ eventKey: "2026wabon", total: 20 })],
    });

  it("renders that team's grand total as unavailable rather than throwing for the whole table", () => {
    const artifact = artifactOf([bad()]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams).toHaveLength(1);
    expect(built.teams[0]!.grandTotal.kind).toBe("unavailable");
  });

  it("names the team in the disclosed gaps rather than absorbing the refusal", () => {
    const artifact = artifactOf([bad()]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.gaps.teamsWithUnavailableGrandTotal).toEqual(["frc9999"]);
  });

  it("leaves every other team's rows intact, grand total included", () => {
    const artifact = artifactOf([
      bad(),
      team({ teamKey: "frc1", pointTotal: 30, eventPoints: [eventPoints({ eventKey: "2026wabon", total: 30 })] }),
      team({ teamKey: "frc2", pointTotal: 10, eventPoints: [eventPoints({ eventKey: "2026wabon", total: 10 })] }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams).toHaveLength(3);
    const good = built.teams.filter((entry) => entry.teamKey !== "frc9999");
    expect(good.map((entry) => entry.teamKey).sort()).toEqual(["frc1", "frc2"]);
    for (const entry of good) expect(entry.grandTotal.kind).toBe("final");
    expect(built.gaps.teamsWithUnavailableGrandTotal).toEqual(["frc9999"]);
  });

  it("keeps the degraded team's own rows and earned points, losing only the predicted numbers", () => {
    const artifact = artifactOf([bad()]);
    const degraded = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS }).teams[0]!;
    expect(degraded.rowCount).toBe(1);
    expect(degraded.rows[0]!.eventKey).toBe("2026wabon");
    expect(degraded.earnedDistrictTotal).toBe(20);
    expect(degraded.rows[0]!.earned?.total).toBe(20);
    expect(degraded.rows[0]!.cells.every((cell) => cell.kind === "unavailable")).toBe(true);
    expect(degraded.rows[0]!.eventTotal.kind).toBe("unavailable");
    // 20 earned, no rookie bonus, minus the 5 adjustment the convolution refused.
    expect(degraded.projection).toBe(15);
  });

  it("does NOT degrade per team for an unregistered season — that refusal belongs to the whole table and reaches the tab's boundary", () => {
    const artifact = artifactOf([team({ teamKey: "frc1", pointTotal: 20, eventPoints: [eventPoints({ eventKey: "1999wabon", total: 20 })] })], { year: 1999 });
    expect(() => buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS })).toThrow();
  });
});

describe("the position number", () => {
  it("is the team's index in the sorted order plus one, and the status projection reads that same array", () => {
    const artifact = artifactOf([
      team({ teamKey: "frc3", pointTotal: 10, eventPoints: [eventPoints({ eventKey: "a", total: 10 })] }),
      team({ teamKey: "frc1", pointTotal: 30, eventPoints: [eventPoints({ eventKey: "a", total: 30 })] }),
      team({ teamKey: "frc2", pointTotal: 20, eventPoints: [eventPoints({ eventKey: "a", total: 20 })] }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(built.teams.map((entry) => entry.teamKey)).toEqual(["frc1", "frc2", "frc3"]);
    built.teams.forEach((entry, index) => {
      expect(entry.position).toBe(index + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// A rewound position goes through the SAME code path as "now"
// ---------------------------------------------------------------------------

describe("the rows at a rewound position", () => {
  const artifact = artifactOf([
    team({ teamKey: "frc1", pointTotal: 24, eventPoints: [eventPoints({ eventKey: "2026wadone", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })] }),
  ]);
  const reopened = new Map<string, DistrictStageFinality>([["2026wadone", { qual: true, alliance: false, elim: false, award: false }]]);
  const counts = new Int32Array(17);
  counts[9] = 100;
  const distributions = new Map<string, DistrictEventDistributions>([
    [
      "2026wadone",
      {
        eventKey: "2026wadone",
        byTeam: new Map([
          [
            "frc1",
            {
              qual: undefined,
              alliance: { counts, denominator: 100 },
              elim: { counts, denominator: 100 },
              award: { counts, denominator: 100 },
              eventTotal: { counts, denominator: 100 },
              grandTotal: undefined,
            },
          ],
        ]),
      },
    ],
  ]);

  it("produces a FINAL cell at now and an OPEN cell at the rewound position, for the same event and category", () => {
    const now = buildDistrictLedgerRows({ artifact, distributions });
    const back = buildDistrictLedgerRows({ artifact, distributions, stageByEvent: reopened });
    expect(now.teams[0]!.rows[0]!.cells[1]!.kind).toBe("final");
    expect(back.teams[0]!.rows[0]!.cells[1]!.kind).toBe("open");
    // Qualification is decided at that step, so it stays grey on both sides.
    expect(back.teams[0]!.rows[0]!.cells[0]!.kind).toBe("final");
  });

  it("leaves a reopened cell UNAVAILABLE rather than blank when the event's distributions could not be got", () => {
    const back = buildDistrictLedgerRows({
      artifact,
      distributions: NO_DISTRIBUTIONS,
      stageByEvent: reopened,
      gaps: { missingEventArtifacts: ["2026wadone"] },
    });
    expect(back.teams[0]!.rows[0]!.cells[1]!.kind).toBe("unavailable");
    expect(back.gaps.missingEventArtifacts).toEqual(["2026wadone"]);
  });

  it("carries the artifact's own earned row so the status module can subtract a reopened category's points", () => {
    const back = buildDistrictLedgerRows({ artifact, distributions, stageByEvent: reopened });
    const row = back.teams[0]!.rows[0]!;
    expect(row.earned?.alliance).toBe(6);
    expect(row.earned?.total).toBe(24);
  });
});

describe("the per-event simulation input at three positions", () => {
  const districtArtifact = artifactOf([
    team({
      teamKey: "frc1",
      pointTotal: 24,
      eventPoints: [eventPoints({ eventKey: "2026wadone", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })],
      awardProfile: { bucket: "none", rookie: false },
    }),
  ]);

  const roster = Array.from({ length: 6 }, (_unused, i) => `frc${String(100 + i)}`);
  const pmf = [0.25, 0.25, 0.25, 0.25];
  const eventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: "2026wadone",
    season: SEASON,
    matches: Array.from({ length: 4 }, (_unused, i) => ({
      matchKey: `2026wadone_qm${String(i + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: 1_760_000_000 + i * 600,
      redTeams: roster.slice(0, 3),
      blueTeams: roster.slice(3, 6),
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 50,
      predictedBlueScore: 50,
      actualWinner: "red",
      actualRedScore: 60,
      actualBlueScore: 50,
      actualRedRp: 3,
      actualBlueRp: 1,
      redRpPmf: pmf,
      blueRpPmf: pmf,
    })),
    upcoming: [],
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 100 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 60 - i }, sigma: { value: 8 } },
    })),
    alliances: [{ allianceNumber: 1, picks: roster.slice(0, 3) }, { allianceNumber: 2, picks: roster.slice(3, 6) }],
  });

  function inputAt(stage: DistrictStageFinality, startMatchKey: string | null) {
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wadone",
      season: SEASON,
      eventArtifact,
      districtArtifact,
      stage,
      startMatchKey,
    });
    if (!built.ok) throw new Error("expected an input");
    return built.input;
  }

  it("mid-quals: every stage open, remaining matches from the start key, and NO known-stage member supplied", () => {
    const input = inputAt({ qual: false, alliance: false, elim: false, award: false }, "2026wadone_qm3");
    expect(input.remainingMatches).toHaveLength(2);
    expect(input.knownAlliances).toBeUndefined();
    expect(input.knownElimPoints).toBeUndefined();
    expect(input.knownAwardPoints).toBeUndefined();
  });

  it("quals-done: ZERO remaining matches with no flag of any kind, and still no known-stage member", () => {
    const input = inputAt({ qual: true, alliance: false, elim: false, award: false }, null);
    expect(input.remainingMatches).toEqual([]);
    expect(Object.keys(input)).not.toContain("qualsFinished");
    expect(input.knownAlliances).toBeUndefined();
    expect(input.baselines).toHaveLength(roster.length);
  });

  it("awards-posted: the known POINT members are supplied from the artifacts' own published values", () => {
    const input = inputAt({ qual: true, alliance: true, elim: true, award: true }, null);
    expect(input.knownElimPoints).toBeDefined();
    expect(input.knownAwardPoints).toBeDefined();
    expect(input.knownElimPoints?.get("frc1")).toBe(6);
    expect(input.knownAwardPoints?.get("frc1")).toBe(0);
  });

  it("awards-posted: this fixture's TWO-alliance list is not final, so it is dropped rather than priced as a two-alliance bracket", () => {
    // This fixture publishes two alliances, which is what selection-in-progress
    // looks like on the wire at a regular district event. Handing it on as
    // `allianceCount: 2` routed elimination points through
    // `divisionedDcmpPlayoffPmf`, a table scoped to the sixteen divisioned
    // district championship PARENTS and to nothing else.
    const input = inputAt({ qual: true, alliance: true, elim: true, award: true }, null);
    expect(input.knownAlliances).toBeUndefined();
    expect(input.allianceCount).toBe(8);
  });

  it("forwards priorJudgedAwards and priorImpactWins onto the award profile, and leaves each absent when the artifact carries none", () => {
    type WireAwardProfile = NonNullable<DistrictTeam["awardProfile"]>;
    const rosterTeam = (awardProfile: WireAwardProfile) =>
      artifactOf([
        team({
          teamKey: roster[0]!,
          pointTotal: 24,
          eventPoints: [eventPoints({ eventKey: "2026wadone", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })],
          awardProfile,
        }),
      ]);
    const profileFrom = (awardProfile: WireAwardProfile) => {
      const built = buildDistrictEventSimulationInput({
        eventKey: "2026wadone",
        season: SEASON,
        eventArtifact,
        districtArtifact: rosterTeam(awardProfile),
        stage: { qual: false, alliance: false, elim: false, award: false },
        startMatchKey: "2026wadone_qm1",
      });
      if (!built.ok) throw new Error("expected an input");
      return built.input.awardProfiles.get(roster[0]!);
    };

    expect(profileFrom({ bucket: "threeOrMore", rookie: false, priorJudgedAwards: 6, priorImpactWins: 2 })).toEqual({
      bucket: "three-or-more",
      rookieState: "veteran",
      priorJudgedAwards: 6,
      priorImpactWins: 2,
    });

    // An artifact published between 10-06 and 260929-imp carries the judged
    // count and no Impact count. The Impact count stays absent, so the draw
    // takes the base-rate path rather than the older one-number ordering.
    expect(profileFrom({ bucket: "threeOrMore", rookie: false, priorJudgedAwards: 6 })).toEqual({
      bucket: "three-or-more",
      rookieState: "veteran",
      priorJudgedAwards: 6,
    });

    // An artifact published before the field existed carries no count, and the
    // profile carries none either. Defaulting it to 0 here would sort that team
    // to the bottom of its field and price it at the ordering's tail.
    expect(profileFrom({ bucket: "none", rookie: false })).toEqual({ bucket: "none", rookieState: "veteran" });
  });

  it("reports the field size as a disclosed fallback, because the event artifact publishes none", () => {
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wadone",
      season: SEASON,
      eventArtifact,
      districtArtifact,
      stage: { qual: false, alliance: false, elim: false, award: false },
      startMatchKey: "2026wadone_qm1",
    });
    if (!built.ok) throw new Error("expected an input");
    expect(built.fieldSizeFellBack).toBe(true);
    expect(built.input.fieldSize).toBe(built.input.baselines.length);
  });

  it("a teams[] row on no qualification row (a playoff-only demo robot) is outside the field, finished and mid-event (quick task 261006-2t0)", () => {
    const demo = { teamKey: "frc9999", teamNumber: 9999, nickname: "Off-Season Demo Team 9999", metrics: {} };
    const withDemo = { ...eventArtifact, teams: [...eventArtifact.teams, demo] };
    for (const startMatchKey of [null, "2026wadone_qm3"]) {
      const built = buildDistrictEventSimulationInput({
        eventKey: "2026wadone",
        season: SEASON,
        eventArtifact: withDemo,
        districtArtifact,
        stage: { qual: false, alliance: false, elim: false, award: false },
        startMatchKey,
      });
      if (!built.ok) throw new Error("expected an input");
      expect(built.input.baselines.some((baseline) => baseline.teamKey === "frc9999"), String(startMatchKey)).toBe(false);
      expect(built.input.fieldSize, String(startMatchKey)).toBe(roster.length);
    }
  });
});

describe("a published alliance list is used only when it is FINAL (WR-07)", () => {
  // 24 teams, so an eight-alliance list of three-team alliances is expressible
  // and the roster can genuinely fill it — the shape every regular district
  // event since 2023 ends selection in.
  const roster = Array.from({ length: 24 }, (_unused, i) => `frc${String(200 + i)}`);
  const pmf = [0.25, 0.25, 0.25, 0.25];

  const districtArtifact = artifactOf(
    roster.map((teamKey) =>
      team({
        teamKey,
        pointTotal: 24,
        eventPoints: [eventPoints({ eventKey: "2026wapartial", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })],
        awardProfile: { bucket: "none", rookie: false },
      })
    )
  );

  /** Eight three-team alliances drawn off the top of the roster: a FINISHED selection. */
  function finalAlliances(): { allianceNumber: number; picks: string[] }[] {
    return Array.from({ length: 8 }, (_unused, n) => ({
      allianceNumber: n + 1,
      picks: roster.slice(n * 3, n * 3 + 3),
    }));
  }

  function artifactWithAlliances(alliances: { allianceNumber: number; picks: string[] }[] | undefined) {
    return EventArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "7.0.0+rolling",
      eventKey: "2026wapartial",
      season: SEASON,
      matches: Array.from({ length: 4 }, (_unused, i) => ({
        matchKey: `2026wapartial_qm${String(i + 1)}`,
        compLevel: "qm",
        setNumber: 1,
        matchNumber: i + 1,
        sortTime: 1_760_000_000 + i * 600,
        // Four rows that between them seat all 24 roster teams: a team on no
        // qualification row is outside the simulated field (quick task 261006-2t0).
        redTeams: roster.slice(i * 6, i * 6 + 3),
        blueTeams: roster.slice(i * 6 + 3, i * 6 + 6),
        predictedWinner: "red",
        pRedWin: 0.5,
        predictedRedScore: 50,
        predictedBlueScore: 50,
        actualWinner: "red",
        actualRedScore: 60,
        actualBlueScore: 50,
        actualRedRp: 3,
        actualBlueRp: 1,
        redRpPmf: pmf,
        blueRpPmf: pmf,
      })),
      upcoming: [],
      teams: roster.map((teamKey, i) => ({
        teamKey,
        teamNumber: 200 + i,
        rank: i + 1,
        record: { wins: 2, losses: 2, ties: 0 },
        rp: 2,
        metrics: { total: { value: 80 - i }, sigma: { value: 8 } },
      })),
      ...(alliances === undefined ? {} : { alliances }),
    });
  }

  function buildWith(alliances: { allianceNumber: number; picks: string[] }[] | undefined) {
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wapartial",
      season: SEASON,
      eventArtifact: artifactWithAlliances(alliances),
      districtArtifact,
      stage: { qual: true, alliance: true, elim: false, award: false },
      startMatchKey: null,
    });
    if (!built.ok) throw new Error("expected an input");
    return built;
  }

  it("gives a team with NO award profile the zero profile, so its event still simulates (Jacob, 2026-09-27)", () => {
    // Two shapes of one gap: roster[0] is on the district artifact with no
    // profile, and roster[20] to roster[23] are guests the district artifact
    // does not list at all (2026orore's frc3669). Before this rule either one
    // refused the whole event with `MissingAwardProfileError`.
    const unprofiled = artifactOf(
      roster.slice(0, 20).map((teamKey, index) =>
        team({
          teamKey,
          pointTotal: 24,
          eventPoints: [eventPoints({ eventKey: "2026wapartial", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })],
          ...(index === 0 ? {} : { awardProfile: { bucket: "oneOrTwo" as const, rookie: false } }),
        })
      )
    );
    expect(unprofiled.teams[0]!.awardProfile).toBeUndefined();
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wapartial",
      season: SEASON,
      eventArtifact: artifactWithAlliances(finalAlliances()),
      districtArtifact: unprofiled,
      stage: { qual: true, alliance: true, elim: false, award: false },
      startMatchKey: null,
    });
    if (!built.ok) throw new Error("expected an input");
    expect(ZERO_AWARD_PROFILE).toEqual({ bucket: "none", rookieState: "veteran", priorJudgedAwards: 0, priorImpactWins: 0 });
    for (const teamKey of [roster[0]!, ...roster.slice(20)]) expect(built.input.awardProfiles.get(teamKey)).toEqual(ZERO_AWARD_PROFILE);
    // A PUBLISHED profile passes through unchanged, not zeroed.
    expect(built.input.awardProfiles.get(roster[1]!)).toEqual({ bucket: "one-or-two", rookieState: "veteran" });
    // The awards stage is OPEN here, which is exactly where the refusal lived.
    const result = simulateDistrictEvent(built.input, 200, 7);
    expect([...result.awardPoints.keys()].sort()).toEqual([...roster].sort());
  });

  it("a FINAL eight-alliance list is used as published, and discloses no gap", () => {
    const built = buildWith(finalAlliances());
    expect(built.input.knownAlliances).toHaveLength(8);
    expect(built.input.allianceCount).toBe(8);
    expect(built.allianceListIsPartial).toBe(false);
  });

  it("a FOUR-alliance list at a regular district event is dropped, never priced as a four-alliance bracket", () => {
    // Four alliances is the divisioned-DCMP fallback table's own population.
    // Routing a regular district event into it would price elimination points
    // from base values that event's bracket cannot produce.
    const built = buildWith(finalAlliances().slice(0, 4));
    expect(built.input.knownAlliances).toBeUndefined();
    expect(built.input.allianceCount).toBe(8);
    expect(built.allianceListIsPartial).toBe(true);
  });

  it("a TWO-alliance list is dropped for the same reason", () => {
    const built = buildWith(finalAlliances().slice(0, 2));
    expect(built.input.knownAlliances).toBeUndefined();
    expect(built.input.allianceCount).toBe(8);
    expect(built.allianceListIsPartial).toBe(true);
  });

  it("eight alliances holding only their captains is selection IN PROGRESS, and is dropped too", () => {
    // `validateSuppliedAlliances` accepts this list — every number 1 through 8
    // is present and no pick list is empty — so the count check alone would let
    // `allianceWinProbability` be asked to price one-robot alliances.
    const captainsOnly = finalAlliances().map((alliance) => ({
      allianceNumber: alliance.allianceNumber,
      picks: alliance.picks.slice(0, 1),
    }));
    const built = buildWith(captainsOnly);
    expect(built.input.knownAlliances).toBeUndefined();
    expect(built.allianceListIsPartial).toBe(true);
  });

  it("an alliance holding a BACKUP robot is still final at four picks", () => {
    const withBackup = finalAlliances();
    withBackup[0] = { allianceNumber: 1, picks: [...withBackup[0]!.picks, roster[23]!] };
    const built = buildWith(withBackup);
    expect(built.input.knownAlliances).toHaveLength(8);
    expect(built.allianceListIsPartial).toBe(false);
  });

  it("no published list at all is not a PARTIAL list, so the gap stays honest", () => {
    const built = buildWith(undefined);
    expect(built.input.knownAlliances).toBeUndefined();
    expect(built.input.allianceCount).toBe(8);
    expect(built.allianceListIsPartial).toBe(false);
  });

  it("a partial list before the alliance stage closes is not disclosed, because it was never going to be used", () => {
    const partial = finalAlliances().slice(0, 4);
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wapartial",
      season: SEASON,
      eventArtifact: artifactWithAlliances(partial),
      districtArtifact,
      stage: { qual: true, alliance: false, elim: false, award: false },
      startMatchKey: null,
    });
    if (!built.ok) throw new Error("expected an input");
    expect(built.allianceListIsPartial).toBe(false);
    expect(built.input.knownAlliances).toBeUndefined();
    expect(built.input.allianceCount).toBe(8);
  });

  it("the dropped list rides into the rows builder's disclosed gaps rather than being absorbed", () => {
    const rows = buildDistrictLedgerRows({
      artifact: districtArtifact,
      distributions: new Map<string, DistrictEventDistributions>(),
      gaps: { eventsWithPartialAllianceList: ["2026wapartial"] },
    });
    expect(rows.gaps.eventsWithPartialAllianceList).toEqual(["2026wapartial"]);
  });

  it("a DECIDED alliance's playoff distribution is already a point mass at its placement's points, so the grey cell agrees with it (261008-26o)", () => {
    // Through Round 4 with the better seed winning every set: alliance 4 loses
    // sf12 and is out at fourth (7 points), alliance 8 loses sf5 and is out at
    // seventh (0); alliance 1 is in the final and alliances 2 and 3 meet in sf13.
    const throughRoundFour = [
      [1, 1],
      [2, 4],
      [3, 2],
      [4, 3],
      [5, 5],
      [6, 6],
      [7, 1],
      [8, 2],
      [9, 4],
      [10, 3],
      [11, 1],
      [12, 3],
    ].map(([setNumber, winningAllianceNumber]) => ({ compLevel: "sf", setNumber: setNumber!, matchNumber: 1, winningAllianceNumber: winningAllianceNumber! }));
    const built = buildWith(finalAlliances());
    const draws = 300;
    const result = simulateDistrictEvent({ ...built.input, playedElimMatches: throughRoundFour }, draws, 11);
    const membersOf = (allianceNumber: number) => finalAlliances()[allianceNumber - 1]!.picks;

    for (const [allianceNumber, placement, points] of [
      [4, 4, 7],
      [8, 7, 0],
    ] as const) {
      for (const teamKey of membersOf(allianceNumber)) {
        expect(result.playoffMilestones.get(teamKey), teamKey).toEqual({ kind: "decided", placement });
        const histogram = result.elimPoints.get(teamKey)!;
        // Every draw lands on the one value: a point mass.
        expect(histogram[points], teamKey).toBe(draws);
      }
    }
    // An alliance still in the bracket is NOT a point mass.
    const finalist = result.elimPoints.get(membersOf(1)[0]!)!;
    expect(finalist[30]! + finalist[20]!).toBe(draws);
    expect(finalist[30]).toBeLessThan(draws);

    // At Now, mid playoffs: the decided teams' Playoffs cells are grey at the
    // same value, and the finalist's stays open.
    const live = artifactOf(
      roster.map((teamKey) =>
        team({
          teamKey,
          pointTotal: 18,
          eventPoints: [
            eventPoints({
              eventKey: "2026wapartial",
              qual: 12,
              alliance: 6,
              elim: 0,
              award: 0,
              total: 18,
              state: state({ playoffsDone: false, awardsPosted: false }),
            }),
          ],
          awardProfile: { bucket: "none", rookie: false },
        })
      )
    );
    const rows = buildDistrictLedgerRows({ artifact: live, distributions: new Map([["2026wapartial", distributionsFromResult(result)]]) });
    const elimOf = (teamKey: string) => {
      const row = rows.teams.find((entry) => entry.teamKey === teamKey)!.rows[0]!;
      return { cell: row.cells.find((entry) => entry.cell === "elim")!, settledElim: row.settledElim };
    };
    for (const teamKey of membersOf(4)) {
      const { cell, settledElim } = elimOf(teamKey);
      // Not exact and above zero: the cell reads "up to 7" (quick task 261010-66y, D6).
      expect(cell).toMatchObject({ kind: "final", earned: 7, upTo: true });
      expect(settledElim).toEqual({ points: 7, exact: false, ceiling: 7 });
    }
    for (const teamKey of membersOf(8)) {
      expect(elimOf(teamKey).settledElim).toEqual({ points: 0, exact: false, ceiling: 0 });
      // A decided placement that pays nothing prints a plain 0, never "up to 0".
      expect("upTo" in elimOf(teamKey).cell).toBe(false);
    }
    expect(elimOf(membersOf(1)[0]!).cell.kind).toBe("open");
    expect(elimOf(membersOf(1)[0]!).settledElim).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The played bracket, and the Playoffs cell's milestone (quick task 260925-uf8)
// ---------------------------------------------------------------------------

describe("playedBracketMatchesFor — colour onto alliance number", () => {
  const roster = Array.from({ length: 24 }, (_unused, i) => `frc${String(300 + i)}`);
  const eightAlliances = Array.from({ length: 8 }, (_unused, n) => ({
    allianceNumber: n + 1,
    picks: roster.slice(n * 3, n * 3 + 3),
  }));
  const rosterOf = (allianceNumber: number): string[] => eightAlliances[allianceNumber - 1]!.picks;

  /** One elimination row between two alliance numbers, with `actualWinner` naming a side. */
  function elimRow(options: {
    compLevel: "sf" | "f";
    setNumber: number;
    matchNumber: number;
    red: readonly string[];
    blue: readonly string[];
    actualWinner: "red" | "blue" | "tie";
  }): Record<string, unknown> {
    // A row in `matches[]` is a PLAYED row and the schema refuses one without
    // all three actual fields; a genuinely unplayed elimination row lives in
    // `upcoming[]` instead, which is the case the last test below covers.
    const played = { actualWinner: options.actualWinner, actualRedScore: 100, actualBlueScore: 90, actualRedRp: 0, actualBlueRp: 0 };
    return {
      matchKey: `2026waplay_${options.compLevel}${String(options.setNumber)}m${String(options.matchNumber)}`,
      compLevel: options.compLevel,
      setNumber: options.setNumber,
      matchNumber: options.matchNumber,
      sortTime: 1_770_000_000,
      redTeams: [...options.red],
      blueTeams: [...options.blue],
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 100,
      predictedBlueScore: 100,
      redRpPmf: [1],
      blueRpPmf: [1],
      ...played,
    };
  }

  function playoffArtifact(
    elimRows: readonly Record<string, unknown>[],
    overrides: { alliances?: unknown; upcoming?: readonly Record<string, unknown>[] } = {}
  ) {
    return EventArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "7.0.0+rolling",
      eventKey: "2026waplay",
      season: SEASON,
      matches: [...elimRows],
      upcoming: [...(overrides.upcoming ?? [])],
      teams: roster.map((teamKey, i) => ({
        teamKey,
        teamNumber: 300 + i,
        rank: i + 1,
        record: { wins: 2, losses: 2, ties: 0 },
        rp: 2,
        metrics: { total: { value: 90 - i }, sigma: { value: 8 } },
      })),
      // `in` rather than `??`, so a test can pass `undefined` to mean "publish no
      // alliances at all" instead of falling back to the eight.
      ...("alliances" in overrides ? { alliances: overrides.alliances } : { alliances: eightAlliances }),
    });
  }

  it("resolves each side to the alliance its teams sit on, and names the winner by alliance number", () => {
    const artifact = playoffArtifact([
      elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
      elimRow({ compLevel: "sf", setNumber: 2, matchNumber: 1, red: rosterOf(4), blue: rosterOf(5), actualWinner: "blue" }),
    ]);
    expect(playedBracketMatchesFor(artifact).matches).toEqual([
      { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      { compLevel: "sf", setNumber: 2, matchNumber: 1, winningAllianceNumber: 5 },
    ]);
  });

  it("resolves a side that fields a BACKUP ROBOT, which is only three of an alliance's four picks", () => {
    const withBackup = eightAlliances.map((alliance) =>
      alliance.allianceNumber === 1 ? { ...alliance, picks: [...alliance.picks, "frc999"] } : alliance
    );
    const artifact = playoffArtifact(
      [
        // The backup plays in place of the captain, so the field shows two of the
        // original picks plus the backup.
        elimRow({
          compLevel: "sf",
          setNumber: 1,
          matchNumber: 1,
          red: [rosterOf(1)[1]!, rosterOf(1)[2]!, "frc999"],
          blue: rosterOf(8),
          actualWinner: "red",
        }),
      ],
      { alliances: withBackup }
    );
    expect(playedBracketMatchesFor(artifact).matches).toEqual([
      { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
    ]);
  });

  it("DISCLOSES a row whose side spans two alliances rather than guessing which one it was", () => {
    const artifact = playoffArtifact([
      elimRow({
        compLevel: "sf",
        setNumber: 1,
        matchNumber: 1,
        red: [rosterOf(1)[0]!, rosterOf(2)[0]!, rosterOf(3)[0]!],
        blue: rosterOf(8),
        actualWinner: "red",
      }),
    ]);
    const result = playedBracketMatchesFor(artifact);
    expect(result.matches).toEqual([]);
    expect(result.unresolvedMatchKeys).toEqual(["2026waplay_sf1m1"]);
  });

  it("skips a TIE, which an elimination bracket cannot route, without calling it a gap", () => {
    const artifact = playoffArtifact([
      elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "tie" }),
    ]);
    const result = playedBracketMatchesFor(artifact);
    expect(result.matches).toEqual([]);
    expect(result.unresolvedMatchKeys).toEqual([]);
  });

  it("hands over a tied set's REPLAY row, and that row decides the set (quick task 261009-tx8, B4)", () => {
    // sf5 is the loser of sf1 (alliance 8) against the loser of sf2 (alliance
    // 4), and its loser is placed SEVENTH. Match 1 of it was a tie; the replay,
    // match 2, went to alliance 8.
    const artifact = playoffArtifact([
      elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
      elimRow({ compLevel: "sf", setNumber: 2, matchNumber: 1, red: rosterOf(4), blue: rosterOf(5), actualWinner: "blue" }),
      elimRow({ compLevel: "sf", setNumber: 5, matchNumber: 1, red: rosterOf(8), blue: rosterOf(4), actualWinner: "tie" }),
      elimRow({ compLevel: "sf", setNumber: 5, matchNumber: 2, red: rosterOf(8), blue: rosterOf(4), actualWinner: "red" }),
    ]);
    const result = playedBracketMatchesFor(artifact);
    expect(result.unresolvedMatchKeys).toEqual([]);
    expect(result.matches).toEqual([
      { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      { compLevel: "sf", setNumber: 2, matchNumber: 1, winningAllianceNumber: 5 },
      { compLevel: "sf", setNumber: 5, matchNumber: 2, winningAllianceNumber: 8 },
    ]);
    const milestones = dcmpBracketMilestonesByTeam(eightAlliances, result.matches);
    for (const pick of rosterOf(4)) expect(milestones.get(pick), pick).toEqual({ kind: "decided", placement: 7 });
    // The set's winner plays on, and the tie alone decided nothing.
    for (const pick of rosterOf(8)) expect(milestones.get(pick), pick).toEqual({ kind: "alive" });
    const tieOnly = dcmpBracketMilestonesByTeam(eightAlliances, result.matches.slice(0, 2));
    for (const pick of rosterOf(4)) expect(tieOnly.get(pick), pick).toEqual({ kind: "alive" });
  });

  it("never reads a SCHEDULED elimination row, which lives in upcoming rather than matches", () => {
    const artifact = playoffArtifact([], {
      upcoming: [
        {
          matchKey: "2026waplay_sf1m1",
          compLevel: "sf",
          setNumber: 1,
          matchNumber: 1,
          sortTime: 1_770_000_000,
          redTeams: rosterOf(1),
          blueTeams: rosterOf(8),
          predictedWinner: "red",
          pRedWin: 0.5,
          predictedRedScore: 100,
          predictedBlueScore: 100,
        },
      ],
    });
    expect(playedBracketMatchesFor(artifact)).toEqual({ matches: [], unresolvedMatchKeys: [] });
  });

  it("returns nothing at all for an event with no published alliances", () => {
    const artifact = playoffArtifact(
      [elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" })],
      { alliances: undefined }
    );
    expect(playedBracketMatchesFor(artifact)).toEqual({ matches: [], unresolvedMatchKeys: [] });
  });

  describe("a backup seen on the field that no pick list names (quick task 261010-66y, D4 and reading R13)", () => {
    const BACKUP = "frc999";
    /** Two listed picks of the alliance and the unlisted backup, as the field shows a side. */
    const sideWithBackup = (allianceNumber: number, backup = BACKUP): string[] => [...rosterOf(allianceNumber).slice(0, 2), backup];

    it("reports a team on a played side that is in no pick list as a field backup of that side's alliance, and the matches are what they were", () => {
      const artifact = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: sideWithBackup(1), blue: rosterOf(8), actualWinner: "red" }),
      ]);
      const result = playedBracketMatchesFor(artifact);
      expect(result.matches).toEqual([{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 }]);
      expect(result.unresolvedMatchKeys).toEqual([]);
      expect(result.fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 1 }]);
    });

    it("reads the blue side too, and a TIE is a played row: the backup was on the field", () => {
      const artifact = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: sideWithBackup(8), actualWinner: "tie" }),
      ]);
      const result = playedBracketMatchesFor(artifact);
      expect(result.matches).toEqual([]);
      expect(result.fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 8 }]);
    });

    it("reports none from a row with no result, a row outside onlyMatchKeys, or a row it could not resolve", () => {
      // No result: structural, since the schema refuses such a row in matches[].
      const unplayed = {
        alliances: eightAlliances,
        matches: [{ matchKey: "2026waplay_sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1, redTeams: sideWithBackup(1), blueTeams: rosterOf(8) }],
      };
      expect(playedBracketMatchesFor(unplayed)).toEqual({ matches: [], unresolvedMatchKeys: [] });
      expect("fieldBackups" in playedBracketMatchesFor(unplayed)).toBe(false);

      const artifact = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
        elimRow({ compLevel: "sf", setNumber: 2, matchNumber: 1, red: sideWithBackup(4), blue: rosterOf(5), actualWinner: "blue" }),
      ]);
      const cut = playedBracketMatchesFor(artifact, new Set(["2026waplay_sf1m1"]));
      expect(cut.matches).toHaveLength(1);
      expect("fieldBackups" in cut).toBe(false);
      expect(playedBracketMatchesFor(artifact, new Set(["2026waplay_sf1m1", "2026waplay_sf2m1"])).fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 4 }]);

      // The blue side spans two alliances, so the whole row is disclosed and nothing on it is read.
      const spanning = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: sideWithBackup(1), blue: [rosterOf(7)[0]!, rosterOf(8)[0]!, rosterOf(8)[1]!], actualWinner: "red" }),
      ]);
      const unresolved = playedBracketMatchesFor(spanning);
      expect(unresolved.unresolvedMatchKeys).toEqual(["2026waplay_sf1m1"]);
      expect("fieldBackups" in unresolved).toBe(false);
    });

    it("reports a team seen in two rows once, and a team seen for two alliances once per alliance", () => {
      const twice = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: sideWithBackup(1), blue: rosterOf(8), actualWinner: "red" }),
        elimRow({ compLevel: "sf", setNumber: 7, matchNumber: 1, red: sideWithBackup(1), blue: rosterOf(4), actualWinner: "red" }),
      ]);
      expect(playedBracketMatchesFor(twice).fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 1 }]);
      const two = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: sideWithBackup(1), blue: rosterOf(8), actualWinner: "red" }),
        elimRow({ compLevel: "sf", setNumber: 2, matchNumber: 1, red: sideWithBackup(4), blue: rosterOf(5), actualWinner: "red" }),
      ]);
      expect(playedBracketMatchesFor(two).fieldBackups).toEqual([
        { teamKey: BACKUP, allianceNumber: 1 },
        { teamKey: BACKUP, allianceNumber: 4 },
      ]);
    });

    it("a row with every team listed reports none: the result carries no fieldBackups key at all", () => {
      const artifact = playoffArtifact([
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
      ]);
      const result = playedBracketMatchesFor(artifact);
      expect(result).toEqual({ matches: [{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 }], unresolvedMatchKeys: [] });
      expect("fieldBackups" in result).toBe(false);
    });
  });

  describe("the input it feeds", () => {
    const districtArtifact = artifactOf(
      roster.map((teamKey) =>
        team({
          teamKey,
          pointTotal: 0,
          eventPoints: [eventPoints({ eventKey: "2026waplay", qual: 0, alliance: 0, elim: 0, award: 0, total: 0 })],
          awardProfile: { bucket: "none", rookie: false },
        })
      )
    );
    const played = [
      elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
    ];

    function buildAt(options: {
      conditionOnPlayedElims?: boolean;
      stage?: DistrictStageFinality;
      rows?: readonly Record<string, unknown>[];
      asOfPlayedElimMatchKeys?: readonly string[];
      pointsFinal?: DistrictStageFinality;
    }) {
      const built = buildDistrictEventSimulationInput({
        eventKey: "2026waplay",
        season: SEASON,
        eventArtifact: playoffArtifact(options.rows ?? played),
        districtArtifact,
        stage: options.stage ?? { qual: true, alliance: true, elim: false, award: false },
        startMatchKey: null,
        ...(options.conditionOnPlayedElims === undefined ? {} : { conditionOnPlayedElims: options.conditionOnPlayedElims }),
        ...(options.asOfPlayedElimMatchKeys === undefined ? {} : { asOfPlayedElimMatchKeys: options.asOfPlayedElimMatchKeys }),
        ...(options.pointsFinal === undefined ? {} : { pointsFinal: options.pointsFinal }),
      });
      if (!built.ok) throw new Error("expected an input");
      return built;
    }

    describe("pointsFinal: the run reads the field, and takes TBA's numbers only once they are final (quick task 261009-vp9)", () => {
      const NOTHING: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };
      const QUALS: DistrictStageFinality = { qual: true, alliance: false, elim: false, award: false };
      const UNDER_WAY: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
      const DONE: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: false };
      const POSTED: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
      const SF1 = { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 };

      it("without pointsFinal the input is the one built with pointsFinal equal to the stage, for every stage, live and rewound", () => {
        for (const stage of [NOTHING, QUALS, UNDER_WAY, DONE, POSTED]) {
          for (const conditionOnPlayedElims of [true, false]) {
            expect(buildAt({ stage, conditionOnPlayedElims }), JSON.stringify(stage)).toEqual(buildAt({ stage, conditionOnPlayedElims, pointsFinal: stage }));
          }
          expect(buildAt({ stage, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"] })).toEqual(buildAt({ stage, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"], pointsFinal: stage }));
        }
      });

      it("the field says the playoffs are done and the playoff number is not final: the known alliances, NO knownElimPoints, and every played bracket row", () => {
        const built = buildAt({ stage: DONE, conditionOnPlayedElims: true, pointsFinal: UNDER_WAY });
        expect(built.input.knownAlliances).toHaveLength(8);
        expect(built.input.knownElimPoints).toBeUndefined();
        expect(built.input.playedElimMatches).toEqual([SF1]);
      });

      it("once the playoff number is final: knownElimPoints and no played rows, as before", () => {
        const built = buildAt({ stage: DONE, conditionOnPlayedElims: true, pointsFinal: DONE });
        expect(built.input.knownAlliances).toHaveLength(8);
        expect(built.input.knownElimPoints).toBeDefined();
        expect(built.input.playedElimMatches).toBeUndefined();
      });

      it("the field says the playoffs are under way and NO number is final (no alliance points on any row): the known alliances and the played rows are both in the input, and the alliance points arriving change neither", () => {
        const lagging = buildAt({ stage: UNDER_WAY, conditionOnPlayedElims: true, pointsFinal: NOTHING });
        expect(lagging.input.knownAlliances).toHaveLength(8);
        expect(lagging.input.allianceCount).toBe(8);
        expect(lagging.input.playedElimMatches).toEqual([SF1]);
        expect(lagging.input.knownElimPoints).toBeUndefined();
        expect(lagging.allianceListIsPartial).toBe(false);
        expect(lagging).toEqual(buildAt({ stage: UNDER_WAY, conditionOnPlayedElims: true, pointsFinal: UNDER_WAY }));
      });

      it("a rewound stop reads its own as-of rows the same way while the playoff number is not final", () => {
        const built = buildAt({ stage: DONE, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"], pointsFinal: UNDER_WAY });
        expect(built.input.knownElimPoints).toBeUndefined();
        expect(built.input.playedElimMatches).toEqual([SF1]);
      });

      it("the award points are known only where pointsFinal.award", () => {
        expect(buildAt({ stage: POSTED, pointsFinal: DONE }).input.knownAwardPoints).toBeUndefined();
        expect(buildAt({ stage: POSTED, pointsFinal: POSTED }).input.knownAwardPoints).toBeDefined();
        // And never from pointsFinal alone where the field has not got there:
        // pointsFinal is the stricter reading, so this cannot happen in the
        // app, and the builder follows pointsFinal for TBA's numbers.
        expect(buildAt({ stage: POSTED }).input.knownAwardPoints).toBeDefined();
      });
    });

    it("passes the played rows at the live position", () => {
      expect(buildAt({ conditionOnPlayedElims: true }).input.playedElimMatches).toEqual([
        { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      ]);
    });

    it("passes NONE at a rewound position that names no as-of playoff rows", () => {
      expect(buildAt({ conditionOnPlayedElims: false }).input.playedElimMatches).toBeUndefined();
      // And an absent flag reads as false rather than as the live position.
      expect(buildAt({}).input.playedElimMatches).toBeUndefined();
    });

    describe("a rewound round stop's as-of rows (261007-3g2)", () => {
      const roundOne = [
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: rosterOf(1), blue: rosterOf(8), actualWinner: "red" }),
        elimRow({ compLevel: "sf", setNumber: 2, matchNumber: 1, red: rosterOf(4), blue: rosterOf(5), actualWinner: "blue" }),
      ];

      it("passes only the listed keys' played rows", () => {
        expect(buildAt({ rows: roundOne, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"] }).input.playedElimMatches).toEqual([
          { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
        ]);
        expect(buildAt({ rows: roundOne, asOfPlayedElimMatchKeys: [] }).input.playedElimMatches).toBeUndefined();
      });

      it("still passes none while the alliances are open or once the playoffs are final", () => {
        const keys = ["2026waplay_sf1m1", "2026waplay_sf2m1"];
        expect(buildAt({ rows: roundOne, asOfPlayedElimMatchKeys: keys, stage: { qual: true, alliance: false, elim: false, award: false } }).input.playedElimMatches).toBeUndefined();
        expect(buildAt({ rows: roundOne, asOfPlayedElimMatchKeys: keys, stage: { qual: true, alliance: true, elim: true, award: false } }).input.playedElimMatches).toBeUndefined();
      });

      it("leaves the live flag reading every played row", () => {
        expect(buildAt({ rows: roundOne, conditionOnPlayedElims: true, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"] }).input.playedElimMatches).toHaveLength(2);
      });

      it("discloses a LISTED row it cannot resolve to one alliance, and ignores an unlisted one", () => {
        const spanning = elimRow({ compLevel: "sf", setNumber: 3, matchNumber: 1, red: [rosterOf(2)[0]!, rosterOf(3)[0]!, rosterOf(4)[0]!], blue: rosterOf(7), actualWinner: "red" });
        const rows = [...roundOne, spanning];
        expect(buildAt({ rows, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1", "2026waplay_sf3m1"] }).unresolvedElimMatchKeys).toEqual(["2026waplay_sf3m1"]);
        expect(buildAt({ rows, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"] }).unresolvedElimMatchKeys).toEqual([]);
      });
    });

    it("carries the field backups of the rows it read beside the unresolved keys, and the run's own input never names one (quick task 261010-66y, R13)", () => {
      const BACKUP = "frc999";
      const rows = [
        elimRow({ compLevel: "sf", setNumber: 1, matchNumber: 1, red: [...rosterOf(1).slice(0, 2), BACKUP], blue: rosterOf(8), actualWinner: "red" }),
      ];
      const live = buildAt({ rows, conditionOnPlayedElims: true });
      expect(live.fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 1 }]);
      // The run's input, its alliances and so its milestones are what they are with the backup listed nowhere.
      expect(live.input).toEqual(buildAt({ conditionOnPlayedElims: true }).input);
      expect(JSON.stringify(live.input.knownAlliances)).not.toContain(BACKUP);
      // A rewound stop reads only the rows at or before its cut.
      expect(buildAt({ rows, asOfPlayedElimMatchKeys: ["2026waplay_sf1m1"] }).fieldBackups).toEqual([{ teamKey: BACKUP, allianceNumber: 1 }]);
      expect(buildAt({ rows, asOfPlayedElimMatchKeys: [] }).fieldBackups).toEqual([]);
      // And where the builder reads no played row at all it reports none.
      expect(buildAt({ rows }).fieldBackups).toEqual([]);
      expect(buildAt({ rows, conditionOnPlayedElims: true, stage: { qual: true, alliance: true, elim: true, award: false } }).fieldBackups).toEqual([]);
      expect(buildAt({ conditionOnPlayedElims: true }).fieldBackups).toEqual([]);
    });

    it("passes NONE once the playoff stage is final, which has its own known-points input", () => {
      const built = buildAt({ conditionOnPlayedElims: true, stage: { qual: true, alliance: true, elim: true, award: false } });
      expect(built.input.playedElimMatches).toBeUndefined();
      expect(built.input.knownElimPoints).toBeDefined();
    });

    it("passes NONE before alliance selection is final, because a bracket cannot be read against rosters still being picked", () => {
      expect(
        buildAt({ conditionOnPlayedElims: true, stage: { qual: true, alliance: false, elim: false, award: false } }).input
          .playedElimMatches
      ).toBeUndefined();
    });
  });
});

describe("districtEventContributions", () => {
  it("returns one row per district-tier event, in the table's own row order, with the earned total and the open percentiles", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: 47,
        eventPoints: [
          eventPoints({ eventKey: "2026wadone", week: 0, qual: 12, alliance: 6, elim: 6, award: 0, total: 24 }),
          eventPoints({
            eventKey: "2026walive",
            week: 2,
            qual: 10,
            alliance: 6,
            elim: 7,
            award: 0,
            total: 23,
            state: state({ playoffsDone: false, awardsPosted: false }),
          }),
        ],
      }),
    ]);
    const counts = new Float64Array(84);
    counts[30] = 50;
    counts[40] = 50;
    const distributions = new Map<string, DistrictEventDistributions>([
      [
        "2026walive",
        {
          eventKey: "2026walive",
          byTeam: new Map([
            [
              "frc1",
              {
                qual: undefined,
                alliance: undefined,
                elim: { counts, denominator: 100 },
                award: { counts, denominator: 100 },
                eventTotal: { counts, denominator: 100 },
                grandTotal: undefined,
              },
            ],
          ]),
        },
      ],
    ]);
    const rows = buildDistrictLedgerRows({ artifact, distributions });
    const contributions = districtEventContributions(rows.teams[0]!);
    expect(contributions.map((entry) => entry.eventKey)).toEqual(["2026wadone", "2026walive"]);
    // The FINISHED event is settled: its earned total is exact and there is no
    // open distribution at all.
    expect(contributions[0]!.earned).toBe(24);
    expect(contributions[0]!.open).toBeUndefined();
    // The OPEN one carries the very percentiles the grand-total convolution
    // consumed.
    expect(contributions[1]!.earned).toBe(23);
    expect(contributions[1]!.open?.p50).toBeGreaterThan(29);
    expect(contributions[1]!.open?.p50).toBeLessThan(41);
  });

  it("reports an absent earned total as undefined rather than as a zero", () => {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: 0,
        eventPoints: [],
        remainingEvents: [remainingEvent({ eventKey: "2026wasoon", week: 4 })],
      }),
    ]);
    const rows = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    const contributions = districtEventContributions(rows.teams[0]!);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]!.earned).toBeUndefined();
  });
});

describe("settledPlayoffPoints (quick task 261008-26o)", () => {
  const OPEN_PLAYOFFS: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const base = { season: SEASON, tier: "district" as const, final: OPEN_PLAYOFFS, elimFinalAtNow: false, earned: undefined };

  it("settles a DECIDED placement at that placement's district tier points while the playoffs are open at Now", () => {
    // Off the placement table, so an upper bound: TBA prorates a team that sat
    // out part of the playoffs.
    expect(settledPlayoffPoints({ ...base, milestone: { kind: "decided", placement: 4 } })).toEqual({ points: 7, exact: false, ceiling: 7 });
    expect(settledPlayoffPoints({ ...base, milestone: { kind: "decided", placement: 1 } })).toEqual({ points: 30, exact: false, ceiling: 30 });
    expect(settledPlayoffPoints({ ...base, milestone: { kind: "decided", placement: 6 } })).toEqual({ points: 0, exact: false, ceiling: 0 });
  });

  it("applies the dcmp tier's own weight", () => {
    expect(settledPlayoffPoints({ ...base, tier: "dcmp", milestone: { kind: "decided", placement: 3 } })).toEqual({ points: 39, exact: false, ceiling: 39 });
  });

  it("reads the artifact's own elim where the playoffs are final at Now and TBA has a row", () => {
    expect(settledPlayoffPoints({ ...base, elimFinalAtNow: true, earned: { elim: 11 }, milestone: { kind: "decided", placement: 4 } })).toEqual({
      points: 11,
      exact: true,
      ceiling: 0,
    });
    // Final at Now with NO row falls back to the placement's points.
    expect(settledPlayoffPoints({ ...base, elimFinalAtNow: true, milestone: { kind: "decided", placement: 4 } })).toEqual({ points: 7, exact: false, ceiling: 7 });
    // A row while the playoffs are still open at Now is TBA's partial number,
    // not the settled one.
    expect(settledPlayoffPoints({ ...base, earned: { elim: 0 }, milestone: { kind: "decided", placement: 4 } })).toEqual({ points: 7, exact: false, ceiling: 7 });
  });

  it("settles nothing for an alliance still in the bracket, or with no bracket progress", () => {
    for (const milestone of [{ kind: "finals" }, { kind: "topFour" }, { kind: "alive" }, undefined] as const) {
      expect(settledPlayoffPoints({ ...base, milestone }), String(milestone?.kind)).toBeUndefined();
    }
  });

  it("puts an EXACT value in the floor and a placement table value in the ceiling only (settledElimBounds)", () => {
    expect(settledElimBounds({ points: 13, exact: true, ceiling: 0 })).toEqual({ floor: 13, ceiling: 0 });
    // 2026pncmp: frc3663 sat on the fourth place alliance, worth 21, and was
    // paid 12. A placement table value is the most a team can be paid.
    expect(settledElimBounds({ points: 21, exact: false, ceiling: 21 })).toEqual({ floor: 0, ceiling: 21 });
  });

  it("D7 (quick task 261009-2tr): a decided second place prints 60 at a 2026 DCMP but its ceiling is the 75 a losing finalist can be paid", () => {
    expect(settledPlayoffPoints({ ...base, tier: "dcmp", milestone: { kind: "decided", placement: 2 } })).toEqual({ points: 60, exact: false, ceiling: 75 });
    expect(settledPlayoffPoints({ ...base, milestone: { kind: "decided", placement: 2 } })).toEqual({ points: 20, exact: false, ceiling: 25 });
    // The lock math reads the ceiling, never the printed points.
    expect(settledElimBounds({ points: 60, exact: false, ceiling: 75 })).toEqual({ floor: 0, ceiling: 75 });
    // An exact value is unchanged: it joins the floor and adds no ceiling.
    expect(settledElimBounds({ points: 13, exact: true, ceiling: 0 })).toEqual({ floor: 13, ceiling: 0 });
  });

  it("settles nothing once the position's playoffs are final, where the shipped final cell already prints TBA's number", () => {
    expect(
      settledPlayoffPoints({ ...base, final: { ...OPEN_PLAYOFFS, elim: true }, milestone: { kind: "decided", placement: 4 } })
    ).toBeUndefined();
  });
});

describe("the Playoffs cell's milestone", () => {
  const eventKey = "2026wamile";
  const districtArtifact = artifactOf([
    team({
      teamKey: "frc1",
      pointTotal: 0,
      eventPoints: [eventPoints({ eventKey, qual: 0, alliance: 0, elim: 0, award: 0, total: 0 })],
      awardProfile: { bucket: "none", rookie: false },
    }),
  ]);

  /** A playoff-points distribution over the district-tier placement values: 40 at nothing, 20 at fourth, 20 at third, 15 at finalist, 5 at winner. */
  function elimDistribution(): DistrictPointDistribution {
    const counts = new Float64Array(maxEventPoints(SEASON, "district").elim + 1);
    counts[0] = 40;
    counts[7] = 20;
    counts[13] = 20;
    counts[20] = 15;
    counts[30] = 5;
    return { counts, denominator: 100 };
  }

  function cellFor(milestone: AllianceBracketMilestone | undefined) {
    const record = {
      qual: undefined,
      alliance: undefined,
      elim: elimDistribution(),
      award: undefined,
      eventTotal: undefined,
      grandTotal: undefined,
    };
    const distributions = new Map<string, DistrictEventDistributions>([
      [
        eventKey,
        {
          eventKey,
          byTeam: new Map([["frc1", record]]),
          ...(milestone === undefined ? {} : { playoffMilestoneByTeam: new Map([["frc1", milestone]]) }),
        },
      ],
    ]);
    const rows = buildDistrictLedgerRows({
      artifact: districtArtifact,
      distributions,
      stageByEvent: new Map([[eventKey, { qual: true, alliance: true, elim: false, award: true }]]),
    });
    const cell = rows.teams[0]!.rows[0]!.cells.find((entry) => entry.cell === "elim")!;
    if (cell.kind !== "open") throw new Error("expected an open playoff cell");
    return cell;
  }

  it("carries NO milestone for an event with no bracket progress or an alliance still alive, so no finish is ruled out", () => {
    expect(cellFor(undefined).playoffMilestone).toBeUndefined();
    expect(cellFor({ kind: "alive" }).playoffMilestone).toBeUndefined();
  });

  it("rules fifth to eighth out once a top four finish is secured", () => {
    expect(cellFor({ kind: "topFour" }).playoffMilestone).toEqual({ kind: "finalist" });
  });

  it("rules third and fourth out as well once the alliance is in the final", () => {
    expect(cellFor({ kind: "finals" }).playoffMilestone).toEqual({ kind: "winner" });
  });

  /**
   * One team's row once its alliance's bracket placement is DECIDED (quick
   * task 261008-26o). `live` puts the event at Now with its playoffs and
   * awards still open, so the settled value is derived from the placement;
   * otherwise the artifact's state block is finished and the position is a
   * rewound stop that reopens the playoffs, so the value is TBA's own `elim`.
   */
  function settledRowFor(
    milestone: AllianceBracketMilestone,
    options: { readonly live: boolean; readonly artifactElim?: number; readonly tier?: "district" | "dcmp" }
  ) {
    const elim = options.artifactElim ?? 0;
    const tier = options.tier ?? "district";
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: elim,
        eventPoints: [
          eventPoints({
            eventKey,
            tier,
            qual: 0,
            alliance: 0,
            elim,
            award: 0,
            total: elim,
            state: options.live ? state({ playoffsDone: false, awardsPosted: false }) : state(),
          }),
        ],
        awardProfile: { bucket: "none", rookie: false },
      }),
    ]);
    const record = { qual: undefined, alliance: undefined, elim: elimDistribution(), award: undefined, eventTotal: undefined, grandTotal: undefined };
    const rows = buildDistrictLedgerRows({
      artifact,
      ...(tier === "district" ? {} : { tier }),
      distributions: new Map<string, DistrictEventDistributions>([
        [eventKey, { eventKey, byTeam: new Map([["frc1", record]]), playoffMilestoneByTeam: new Map([["frc1", milestone]]) }],
      ]),
      ...(options.live ? {} : { stageByEvent: new Map([[eventKey, { qual: true, alliance: true, elim: false, award: false }]]) }),
    });
    return rows.teams[0]!.rows[0]!;
  }

  it("settles a DECIDED placement as a grey Playoffs cell at that placement's own points while the event's playoffs are open at Now", () => {
    for (const [placement, points] of [
      [4, 7],
      [1, 30],
      [6, 0],
    ] as const) {
      const row = settledRowFor({ kind: "decided", placement }, { live: true });
      const cell = row.cells.find((entry) => entry.cell === "elim")!;
      // R16 (quick task 261010-66y): a value that is not exact and above zero carries `upTo`; at zero the cell
      // carries no such key and deep equals the cell it always was.
      expect(cell, `placement ${String(placement)}`).toEqual({ id: districtCellId(eventKey, "elim"), cell: "elim", kind: "final", earned: points, ...(points > 0 ? { upTo: true } : {}) });
      expect("upTo" in cell, `placement ${String(placement)}`).toBe(points > 0);
      expect(row.settledElim, `placement ${String(placement)}`).toEqual({ points, exact: false, ceiling: points });
      // The event's OWN stage is untouched: its playoffs are still open.
      expect(row.stage.final.elim).toBe(false);
      expect(row.stage.final.award).toBe(false);
      // The event total stays open, because the awards are.
      expect(row.eventTotal.kind).not.toBe("final");
    }
  });

  it("prints TBA's own elim at a rewound stop over an event whose playoffs are final at Now", () => {
    // 11 is not on the placement table: the grey number is the artifact's,
    // never a value derived beside it, wherever TBA has published one.
    const row = settledRowFor({ kind: "decided", placement: 3 }, { live: false, artifactElim: 11 });
    const cell = row.cells.find((entry) => entry.cell === "elim")!;
    expect(cell).toEqual({ id: districtCellId(eventKey, "elim"), cell: "elim", kind: "final", earned: 11 });
    // An exact value is TBA's own number: no `upTo` key at all (quick task 261010-66y, R16).
    expect("upTo" in cell).toBe(false);
    expect(row.settledElim).toEqual({ points: 11, exact: true, ceiling: 0 });
    expect(row.stage.final.elim).toBe(false);
  });

  it("D7 (quick task 261009-2tr): a decided second place at a DCMP live at Now prints 60 and carries a ceiling of 75", () => {
    const row = settledRowFor({ kind: "decided", placement: 2 }, { live: true, tier: "dcmp" });
    const cell = row.cells.find((entry) => entry.cell === "elim")!;
    // The cell prints the placement table's 60 behind "up to" (quick task 261010-66y, R16): N is the value the
    // cell printed before, never the lock math's 75.
    expect(cell).toEqual({ id: districtCellId(eventKey, "elim"), cell: "elim", kind: "final", earned: 60, upTo: true });
    expect(row.settledElim).toEqual({ points: 60, exact: false, ceiling: 75 });
    expect(settledElimBounds(row.settledElim!)).toEqual({ floor: 0, ceiling: 75 });
  });

  it("leaves a row with no decided placement WITHOUT a settledElim key, so it deep equals the shipped row", () => {
    const row = settledRowFor({ kind: "finals" }, { live: true });
    expect("settledElim" in row).toBe(false);
    expect(row.cells.find((entry) => entry.cell === "elim")!.kind).toBe("open");
    // And no cell of a row without a settled value carries `upTo`, its totals included (quick task 261010-66y, R16).
    expect(JSON.stringify(row)).not.toContain("upTo");
  });

  it("puts a milestone on the PLAYOFFS cell only — the other three categories are untouched", () => {
    const rows = buildDistrictLedgerRows({
      artifact: districtArtifact,
      distributions: new Map<string, DistrictEventDistributions>([
        [
          eventKey,
          {
            eventKey,
            byTeam: new Map([
              [
                "frc1",
                {
                  qual: elimDistribution(),
                  alliance: elimDistribution(),
                  elim: elimDistribution(),
                  award: elimDistribution(),
                  eventTotal: undefined,
                  grandTotal: undefined,
                },
              ],
            ]),
            playoffMilestoneByTeam: new Map<string, AllianceBracketMilestone>([["frc1", { kind: "finals" }]]),
          },
        ],
      ]),
      stageByEvent: new Map([[eventKey, { qual: false, alliance: false, elim: false, award: false }]]),
    });
    for (const cell of rows.teams[0]!.rows[0]!.cells) {
      if (cell.kind !== "open") continue;
      if (cell.cell === "elim") expect(cell.playoffMilestone).toBeDefined();
      else expect(cell.playoffMilestone, cell.cell).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The selection ROUTE VIEW (quick task 260925-w4y)
// ---------------------------------------------------------------------------

describe("the alliance selection cell's route view", () => {
  /** One route observation, defaulting to a route no draw took. */
  function slot(overrides: Partial<DistrictSelectionRouteObservation> = {}): DistrictSelectionRouteObservation {
    return {
      draws: 0,
      minPoints: undefined,
      maxPoints: undefined,
      allianceNumber: undefined,
      possibleMinPoints: 9,
      possibleMaxPoints: 16,
      ...overrides,
    };
  }

  /** A four-slot route set: a captain in `captainDraws` of the runs and a second pick in the rest. */
  function routesFor(captainDraws: number, secondPickDraws: number, notSelectedDraws: number): DistrictSelectionRoutes {
    return {
      bySlot: [
        slot({ draws: captainDraws, minPoints: 12, maxPoints: 16, allianceNumber: captainDraws > 0 ? 1 : undefined }),
        slot(),
        slot({ draws: secondPickDraws, minPoints: 2, maxPoints: 8, possibleMinPoints: 1, possibleMaxPoints: 8 }),
        slot({ possibleMinPoints: 0, possibleMaxPoints: 0 }),
      ],
      notSelectedDraws,
    };
  }

  function builtWith(
    routes: DistrictSelectionRoutes | undefined,
    draftFixed: boolean | undefined,
    distribution: DistrictPointDistribution = lumpy(300, 16),
    options: { readonly elim?: DistrictPointDistribution; readonly stage?: DistrictStageFinality; readonly fieldStage?: DistrictStageFinality } = {}
  ) {
    const artifact = artifactOf([
      team({
        teamKey: "frc1",
        pointTotal: 0,
        remainingEvents: [remainingEvent({ eventKey: "2026walive", week: 1, state: OPEN_STATE })],
        maxRemainingDistrict: 83,
      }),
    ]);
    const distributions = new Map<string, DistrictEventDistributions>([
      [
        "2026walive",
        {
          eventKey: "2026walive",
          byTeam: new Map([
            [
              "frc1",
              {
                qual: undefined,
                alliance: distribution,
                elim: options.elim,
                award: undefined,
                eventTotal: undefined,
                grandTotal: undefined,
              },
            ],
          ]),
          ...(routes === undefined ? {} : { selectionRoutesByTeam: new Map([["frc1", routes]]) }),
          ...(draftFixed === undefined ? {} : { draftFixed }),
        },
      ],
    ]);
    return buildDistrictLedgerRows({
      artifact,
      distributions,
      ...(options.stage === undefined ? {} : { stageByEvent: new Map([["2026walive", options.stage]]) }),
      ...(options.fieldStage === undefined ? {} : { fieldStageByEvent: new Map([["2026walive", options.fieldStage]]) }),
    });
  }

  it("carries the routes onto the open Alliance selection cell, with the DISTRIBUTION's own denominator", () => {
    const built = builtWith(routesFor(200, 100, 700), false);
    const cell = built.teams[0]!.rows[0]!.cells[1]!;
    expect(cell.kind).toBe("open");
    if (cell.kind !== "open") throw new Error("unreachable");
    expect(cell.selection).toBeDefined();
    // The one agreement that matters: the route counts and the histogram are
    // shares of the SAME runs, so the list cannot disagree with the headline.
    expect(cell.selection!.denominator).toBe(cell.distribution.denominator);
    expect(cell.selection!.draftFixed).toBe(false);
    expect(cell.selection!.routes.bySlot[0]!.draws).toBe(200);
    expect(built.gaps.eventsWithUnknownSelectionRoutes).toEqual([]);
  });

  it("forwards a FIXED draft as fixed", () => {
    const built = builtWith(routesFor(1000, 0, 0), true);
    const cell = built.teams[0]!.rows[0]!.cells[1]!;
    if (cell.kind !== "open") throw new Error("unreachable");
    expect(cell.selection!.draftFixed).toBe(true);
  });

  it("leaves the cell's routes ABSENT and names the event when the run reported none", () => {
    // The baked path: pmfs and nothing else. The cell keeps the shipped wording
    // and the absence is disclosed rather than inferred from the words.
    const built = builtWith(undefined, undefined);
    const cell = built.teams[0]!.rows[0]!.cells[1]!;
    if (cell.kind !== "open") throw new Error("unreachable");
    expect(cell.selection).toBeUndefined();
    expect(built.gaps.eventsWithUnknownSelectionRoutes).toEqual(["2026walive"]);
  });

  it("names the event when the routes are there but the fixed-ranking flag is not, rather than guessing one", () => {
    const built = builtWith(routesFor(200, 100, 700), undefined);
    const cell = built.teams[0]!.rows[0]!.cells[1]!;
    if (cell.kind !== "open") throw new Error("unreachable");
    expect(cell.selection).toBeUndefined();
    expect(built.gaps.eventsWithUnknownSelectionRoutes).toEqual(["2026walive"]);
  });

  describe("not picked (261008-3il)", () => {
    const NOBODY_TOOK_IT = (): DistrictSelectionRoutes => ({ bySlot: [slot(), slot(), slot(), slot()], notSelectedDraws: 1000 });
    const SELECTION_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const SELECTION_OPEN: DistrictStageFinality = { qual: true, alliance: false, elim: false, award: false };
    const ELIM = lumpy(970, 30);

    it("holds only with selection final, a fixed draft, reported routes and no draw in any slot", () => {
      expect(teamNotPickedAtPosition(NOBODY_TOOK_IT(), true, true)).toBe(true);
      // Selection not final at the position, or the draft not a fact.
      expect(teamNotPickedAtPosition(NOBODY_TOOK_IT(), true, false)).toBe(false);
      expect(teamNotPickedAtPosition(NOBODY_TOOK_IT(), false, true)).toBe(false);
      expect(teamNotPickedAtPosition(NOBODY_TOOK_IT(), undefined, true)).toBe(false);
      // A baked event reports no routes.
      expect(teamNotPickedAtPosition(undefined, true, true)).toBe(false);
      // A backup slot draw is a team on an alliance.
      expect(teamNotPickedAtPosition({ bySlot: [slot(), slot(), slot(), slot({ draws: 1000 })], notSelectedDraws: 0 }, true, true)).toBe(false);
      expect(teamNotPickedAtPosition({ bySlot: [slot(), slot(), slot(), slot({ draws: 1 })], notSelectedDraws: 999 }, true, true)).toBe(false);
      // Any pick slot draw at all.
      expect(teamNotPickedAtPosition(routesFor(0, 1, 999), true, true)).toBe(false);
    });

    it("never holds while the draft is drawn, whatever the routes say (261014-ol6)", () => {
      // A team left out of every one of 1,000 DRAWN drafts is still a chance:
      // the flag needs the alliances supplied, not merely a fixed ranking.
      expect(teamNotPickedAtPosition(NOBODY_TOOK_IT(), false, true)).toBe(false);
      expect(teamNotPickedAtPosition({ bySlot: [slot(), slot(), slot(), slot()], notSelectedDraws: 1 }, false, true)).toBe(false);
      const built = builtWith(NOBODY_TOOK_IT(), false, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_FINAL });
      const elim = built.teams[0]!.rows[0]!.cells[2]!;
      expect("notPicked" in elim).toBe(false);
    });

    it("flags the open Playoffs cell of a team on no alliance once selection is final, and keeps it open", () => {
      const built = builtWith(NOBODY_TOOK_IT(), true, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_FINAL });
      const elim = built.teams[0]!.rows[0]!.cells[2]!;
      expect(elim.cell).toBe("elim");
      expect(elim.kind).toBe("open");
      if (elim.kind !== "open") throw new Error("unreachable");
      expect(elim.notPicked).toBe(true);
    });

    it("at a rewound stop the note reads the FIELD where one is supplied: the number open, the field final (quick task 261009-vp9)", () => {
      // The stop's Alliance selection NUMBER is not final (its points are not
      // in), and the field says selection is over there.
      const built = builtWith(NOBODY_TOOK_IT(), true, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_OPEN, fieldStage: SELECTION_FINAL });
      const row = built.teams[0]!.rows[0]!;
      expect(row.stage.final.alliance).toBe(false);
      expect(row.cells[1]!.kind).toBe("open");
      const elim = row.cells[2]!;
      expect(elim.kind).toBe("open");
      if (elim.kind !== "open") throw new Error("unreachable");
      expect(elim.notPicked).toBe(true);

      // The field map wins over the number map in the other direction too.
      const fieldOpen = builtWith(NOBODY_TOOK_IT(), true, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_FINAL, fieldStage: SELECTION_OPEN });
      expect("notPicked" in fieldOpen.teams[0]!.rows[0]!.cells[2]!).toBe(false);
    });

    it("carries no notPicked key while selection is open, or where the run reported no routes", () => {
      for (const built of [
        builtWith(NOBODY_TOOK_IT(), true, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_OPEN }),
        builtWith(undefined, undefined, lumpy(1000, 16), { elim: ELIM, stage: SELECTION_FINAL }),
      ]) {
        const elim = built.teams[0]!.rows[0]!.cells[2]!;
        expect(elim.kind).toBe("open");
        expect("notPicked" in elim).toBe(false);
      }
    });
  });

  it("puts a route view only on the Alliance selection and Playoffs cells, and on no other category's cell (261014-jfx)", () => {
    const built = builtWith(routesFor(200, 100, 700), false, lumpy(300, 16), { elim: lumpy(970, 30) });
    const cells = built.teams[0]!.rows[0]!.cells;
    for (const cell of cells) {
      if (cell.kind !== "open") continue;
      if (cell.cell === "alliance" || cell.cell === "elim") expect(cell.selection, cell.cell).toBeDefined();
      else expect(cell.selection, `${cell.cell} carries a route view`).toBeUndefined();
    }
  });

  describe("the open Playoffs cell's route view (261014-jfx)", () => {
    const ELIM = lumpy(970, 30);
    const elimOf = (built: ReturnType<typeof builtWith>) => {
      const cell = built.teams[0]!.rows[0]!.cells.find((candidate) => candidate.cell === "elim")!;
      if (cell.kind !== "open") throw new Error("the Playoffs cell is not open");
      return cell;
    };

    it("carries the run's own not selected count and the Playoffs distribution's own denominator", () => {
      const cell = elimOf(builtWith(routesFor(200, 100, 700), false, lumpy(300, 16), { elim: ELIM }));
      expect(cell.selection).toBeDefined();
      expect(cell.selection!.routes.notSelectedDraws).toBe(700);
      expect(cell.selection!.denominator).toBe(cell.distribution.denominator);
      expect(cell.selection!.draftFixed).toBe(false);
    });

    it("leaves the Alliance selection cell as it was, and does not name the event in the gaps on the Playoffs cell's account", () => {
      const built = builtWith(routesFor(200, 100, 700), false, lumpy(300, 16), { elim: ELIM });
      expect(built.gaps.eventsWithUnknownSelectionRoutes).toEqual([]);
      const alliance = built.teams[0]!.rows[0]!.cells[1]!;
      if (alliance.kind !== "open") throw new Error("unreachable");
      expect(alliance.selection!.denominator).toBe(alliance.distribution.denominator);
    });

    it("is absent where the run reported no routes, or no fixed ranking flag", () => {
      expect(elimOf(builtWith(undefined, undefined, lumpy(300, 16), { elim: ELIM })).selection).toBeUndefined();
      expect(elimOf(builtWith(routesFor(200, 100, 700), undefined, lumpy(300, 16), { elim: ELIM })).selection).toBeUndefined();
    });

    it("rides on the not picked flagged cell too, and the flag stays", () => {
      const nobody: DistrictSelectionRoutes = { bySlot: [slot(), slot(), slot(), slot()], notSelectedDraws: 1000 };
      const final: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
      const cell = elimOf(builtWith(nobody, true, lumpy(1000, 16), { elim: ELIM, stage: final }));
      expect(cell.notPicked).toBe(true);
      expect(cell.selection!.routes.notSelectedDraws).toBe(1000);
    });
  });
});

// ---------------------------------------------------------------------------
// THE PLAYOFFS CELL'S ROUTE VIEW, proven against the real simulation (quick task
// 261014-jfx). A 40 team roster, so 16 teams are left on no alliance.
// ---------------------------------------------------------------------------

describe("the Playoffs cell tells not picked from fifth to eighth with the run's own routes (261014-jfx)", () => {
  const EVENT = "2026wabig";
  const ROSTER = Array.from({ length: 40 }, (_unused, i) => `frc${String(2001 + i)}`);
  const RP_PMF = [0.2, 0.3, 0.3, 0.2];
  const bigState = state({ qualMatchesPlayed: 3, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
  const OPEN_STAGE: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

  function qualRow(m: number, played: boolean) {
    const at = (offset: number): string => ROSTER[(m * 6 + offset) % ROSTER.length]!;
    const base = {
      matchKey: `${EVENT}_qm${String(m + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: m + 1,
      sortTime: 1_760_000_000 + m * 600,
      redTeams: [at(0), at(1), at(2)],
      blueTeams: [at(3), at(4), at(5)],
      predictedWinner: "red",
      pRedWin: 0.55,
      predictedRedScore: 90,
      predictedBlueScore: 85,
      redRpPmf: RP_PMF,
      blueRpPmf: RP_PMF,
    };
    return played ? { ...base, actualWinner: "red", actualRedScore: 95, actualBlueScore: 80, actualRedRp: 3, actualBlueRp: 1 } : base;
  }

  const artifact = artifactOf(
    ROSTER.map((teamKey) =>
      team({ teamKey, pointTotal: 0, remainingEvents: [remainingEvent({ eventKey: EVENT, week: 2, state: bigState })] })
    ),
    { dcmpSlots: 12 }
  );
  const eventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: EVENT,
    season: SEASON,
    matches: Array.from({ length: 20 }, (_unused, m) => qualRow(m, true)),
    upcoming: Array.from({ length: 60 }, (_unused, m) => qualRow(m + 20, false)),
    teams: ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: Number(teamKey.replace("frc", "")),
      rank: i + 1,
      record: { wins: 2, losses: 1, ties: 0 },
      rp: 2 + (40 - i) / 40,
      // Metric totals fall steeply down the roster, so the weakest teams are rarely drafted.
      metrics: { total: { value: 20 + (40 - i) * 3 }, sigma: { value: 8 } },
    })),
  });
  const built = buildDistrictEventSimulationInput({
    eventKey: EVENT,
    season: SEASON,
    eventArtifact,
    districtArtifact: artifact,
    stage: OPEN_STAGE,
    startMatchKey: `${EVENT}_qm21`,
  });
  if (!built.ok) throw new Error("fixture: the 40 team event input did not build");
  const DRAWS = 200;

  // The simulation's own observer seam: in every draw, a roster team on no
  // alliance must have been paid nothing in the playoffs.
  const baselineKeys = built.input.baselines.map((baseline) => baseline.teamKey);
  let unpickedTeamDraws = 0;
  let violations = 0;
  const result = simulateDistrictEvent(built.input, DRAWS, 29, (observation) => {
    const onAnAlliance = new Set(observation.alliances.flat());
    baselineKeys.forEach((teamKey, index) => {
      if (onAnAlliance.has(teamKey)) return;
      unpickedTeamDraws++;
      if ((observation.elim[index] ?? 0) !== 0) violations++;
    });
  });
  const distributions = distributionsFromResult(result);
  const rows = buildDistrictLedgerRows({ artifact, distributions: new Map([[EVENT, distributions]]) });
  const PRICING = { season: SEASON, tier: "district", isRookie: false } as const;

  it("pays no playoff points to a team on no alliance, draw by draw, over a positive number of such draws", () => {
    expect(unpickedTeamDraws).toBeGreaterThan(0);
    expect(violations).toBe(0);
  });

  it("carries the run's own not selected count on every Playoffs cell, never above that team's zero point mass", () => {
    let seen = 0;
    for (const entry of rows.teams) {
      const cell = entry.rows[0]!.cells.find((candidate) => candidate.cell === "elim")!;
      expect(cell.kind, entry.teamKey).toBe("open");
      if (cell.kind !== "open") continue;
      const routes = result.selectionRoutes.get(entry.teamKey)!;
      expect(cell.selection!.routes.notSelectedDraws, entry.teamKey).toBe(routes.notSelectedDraws);
      expect(cell.selection!.denominator, entry.teamKey).toBe(cell.distribution.denominator);
      expect(routes.notSelectedDraws, entry.teamKey).toBeLessThanOrEqual(cell.distribution.counts[0] ?? 0);
      seen += routes.notSelectedDraws;
    }
    expect(seen).toBe(unpickedTeamDraws);
  });

  it("prints not picked over the share on an alliance for the team left off most often, and only past half of the runs", () => {
    let leastPicked: { teamKey: string; notSelected: number } | undefined;
    for (const [teamKey, routes] of result.selectionRoutes) {
      if (leastPicked === undefined || routes.notSelectedDraws > leastPicked.notSelected) leastPicked = { teamKey, notSelected: routes.notSelectedDraws };
    }
    expect(leastPicked!.notSelected).toBeGreaterThan(DRAWS / 2);
    const printed = new Set<string>();
    for (const entry of rows.teams) {
      const cell = entry.rows[0]!.cells.find((candidate) => candidate.cell === "elim")!;
      if (cell.kind !== "open") continue;
      const lines = openCellLines(cell, PRICING);
      const notSelected = cell.selection!.routes.notSelectedDraws;
      if (lines.bold === "~not picked") {
        printed.add(entry.teamKey);
        expect(notSelected / DRAWS, entry.teamKey).toBeGreaterThan(0.5);
        expect(lines.small, entry.teamKey).toMatch(/^\d+% on an alliance$/);
      } else {
        expect(notSelected / DRAWS, entry.teamKey).toBeLessThanOrEqual(0.5);
      }
    }
    expect(printed.has(leastPicked!.teamKey)).toBe(true);
    const cell = rows.teams.find((entry) => entry.teamKey === leastPicked!.teamKey)!.rows[0]!.cells.find((candidate) => candidate.cell === "elim")!;
    if (cell.kind !== "open") throw new Error("unreachable");
    const runs = Math.round((100 * leastPicked!.notSelected) / DRAWS);
    expect(openCellLines(cell, PRICING).small).toBe(`${String(100 - runs)}% on an alliance`);
  });
});

describe("distributionsFromResult and the routes", () => {
  /** A result object with empty histograms — this test is about the RESHAPING, not the math. */
  function resultWith(routes: ReadonlyMap<string, DistrictSelectionRoutes>, rankingFixed: boolean): DistrictLedgerResult {
    return {
      eventKey: "2026walive",
      draws: 1000,
      qualPoints: new Map(),
      selectionPoints: new Map(),
      elimPoints: new Map(),
      awardPoints: new Map(),
      eventTotal: new Map(),
      awardSources: new Map(),
      awardOrdering: "applied",
      playoffMilestones: new Map(),
      selectionRoutes: routes,
      rankingFixed,
    };
  }

  it("forwards the run's routes unreshaped, and a fixed ranking with no drawn picks as a fixed draft", () => {
    const routes: DistrictSelectionRoutes = {
      bySlot: [
        { draws: 4, minPoints: 16, maxPoints: 16, allianceNumber: 1, possibleMinPoints: 9, possibleMaxPoints: 16 },
        { draws: 0, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 9, possibleMaxPoints: 16 },
        { draws: 0, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 1, possibleMaxPoints: 8 },
        { draws: 0, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 0, possibleMaxPoints: 0 },
      ],
      notSelectedDraws: 0,
    };
    const byTeam = new Map([["frc1", routes]]);
    const shaped = distributionsFromResult(resultWith(byTeam, true));
    expect(shaped.selectionRoutesByTeam).toBe(byTeam);
    expect(shaped.draftFixed).toBe(true);
  });

  it("gives a BAKED sidecar neither, because a sidecar carries pmfs and nothing else", () => {
    const pmf = { o: 0, p: [0.5, 0.5] };
    const sidecar = DistrictPreSimArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      districtKey: "2026pnw",
      eventKey: "2026wasoon",
      year: SEASON,
      roster: ["frc1"],
      rows: [{ t: 0, qual: pmf, alliance: pmf, elim: pmf, award: pmf, total: pmf }],
    });
    const decoded = distributionsFromPreSim(sidecar);
    expect(decoded.selectionRoutesByTeam).toBeUndefined();
    expect(decoded.draftFixed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A registered no show at a started district event (quick task 260927-vmb)
// ---------------------------------------------------------------------------

describe("a registered team missing from a started event's schedule is priced from awards alone", () => {
  const EVENT = "2026wastart";
  const NO_SHOW = "frc2635";
  const ELSEWHERE = "frc3000";
  const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(1001 + i)}`);
  const RP_PMF = [0.2, 0.3, 0.3, 0.2];
  const startedState = state({ qualMatchesPlayed: 4, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

  function registered(teamKey: string, eventState: DistrictEventState, eventKey = EVENT): DistrictTeam {
    return team({
      teamKey,
      pointTotal: 0,
      remainingEvents: [remainingEvent({ eventKey, week: 2, state: eventState })],
    });
  }

  function districtArtifact(eventState: DistrictEventState, extra: DistrictTeam[]): DistrictArtifact {
    return artifactOf([...ROSTER.map((teamKey) => registered(teamKey, eventState)), registered(ELSEWHERE, eventState, "2026waother"), ...extra], {
      dcmpSlots: 12,
    });
  }

  function qualRow(m: number, played: boolean) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    const base = {
      matchKey: `${EVENT}_qm${String(m + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: m + 1,
      sortTime: 1_760_000_000 + m * 600,
      redTeams: red,
      blueTeams: blue,
      predictedWinner: "red",
      pRedWin: 0.55,
      predictedRedScore: 90,
      predictedBlueScore: 85,
      redRpPmf: RP_PMF,
      blueRpPmf: RP_PMF,
    };
    return played ? { ...base, actualWinner: "red", actualRedScore: 95, actualBlueScore: 80, actualRedRp: 3, actualBlueRp: 1 } : base;
  }

  function eventArtifactWith(scheduled: boolean) {
    return EventArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "7.0.0+rolling",
      eventKey: EVENT,
      season: SEASON,
      matches: scheduled ? Array.from({ length: 4 }, (_unused, m) => qualRow(m, true)) : [],
      upcoming: scheduled ? Array.from({ length: 8 }, (_unused, m) => qualRow(m + 4, false)) : [],
      teams: ROSTER.map((teamKey, i) => ({
        teamKey,
        teamNumber: Number(teamKey.replace("frc", "")),
        rank: i + 1,
        record: { wins: 2, losses: 2, ties: 0 },
        rp: 2 + (24 - i) / 24,
        metrics: { total: { value: 60 + (24 - i) }, sigma: { value: 8 } },
      })),
    });
  }

  const OPEN_STAGE: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };
  const artifact = districtArtifact(startedState, [registered(NO_SHOW, startedState)]);
  const eventArtifact = eventArtifactWith(true);
  const built = buildDistrictEventSimulationInput({
    eventKey: EVENT,
    season: SEASON,
    eventArtifact,
    districtArtifact: artifact,
    stage: OPEN_STAGE,
    startMatchKey: `${EVENT}_qm5`,
  });
  if (!built.ok) throw new Error("fixture: the event input did not build");
  const draws = 200;
  const result = simulateDistrictEvent(built.input, draws, 13);
  const rows = buildDistrictLedgerRows({ artifact, distributions: new Map([[EVENT, distributionsFromResult(result)]]) });
  const noShow = rows.teams.find((entry) => entry.teamKey === NO_SHOW)!;
  const rosterTeam = rows.teams.find((entry) => entry.teamKey === ROSTER[0])!;

  it("puts only the registered team on no qualification row in the award only list, never a team registered elsewhere", () => {
    expect(built.input.awardOnlyTeams).toEqual([NO_SHOW]);
    expect(built.input.awardOnlyTeams).not.toContain(ELSEWHERE);
  });

  it("reads three grey zeros, an open Awards cell equal to the run's award draw, and an event total equal to the award mass", () => {
    const row = noShow.rows[0]!;
    for (const category of ["qual", "alliance", "elim"] as const) {
      const cell = row.cells.find((entry) => entry.cell === category)!;
      expect(cell.kind, category).toBe("final");
      if (cell.kind === "final") expect(cell.earned, category).toBe(0);
    }
    const award = row.cells.find((entry) => entry.cell === "award")!;
    expect(award.kind).toBe("open");
    if (award.kind !== "open") return;
    const awardCounts = result.awardPoints.get(NO_SHOW)!;
    expect(Array.from(award.distribution.counts)).toEqual([...awardCounts]);

    expect(row.eventTotal.kind).toBe("open");
    if (row.eventTotal.kind !== "open") return;
    const total = row.eventTotal.distribution;
    for (let points = 0; points < Math.max(total.counts.length, awardCounts.length); points++) {
      expect((total.counts[points] ?? 0) / total.denominator, `points ${String(points)}`).toBeCloseTo((awardCounts[points] ?? 0) / draws, 12);
    }
  });

  it("gives an open grand total whose projection is its median, and keeps the event's own stage on the row", () => {
    expect(noShow.hasOpenCategory).toBe(true);
    expect(noShow.grandTotal.kind).toBe("open");
    if (noShow.grandTotal.kind !== "open") return;
    expect(noShow.projection).toBe(pointQuantile(noShow.grandTotal.distribution.counts, 0.5, 1));
    expect(noShow.rows[0]!.stage).toEqual(rosterTeam.rows[0]!.stage);
  });

  it("reads In range or Out of range from the award only projection, never capacity unknown", () => {
    const statuses = computeDistrictLedgerStatuses({ artifact, teams: rows.teams });
    const status = statuses.byTeam.get(NO_SHOW)!.status;
    expect(statuses.projectionCutLine).not.toBeNull();
    expect(status).not.toBe("capacityUnknown");
    expect(status).toBe(noShow.projection >= statuses.projectionCutLine! ? "inRange" : "outOfRange");
  });

  it("reads a posted award as final and the three on field cells as grey zeros", () => {
    const postedState = state({ qualMatchesPlayed: 4, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: true });
    const postedNoShow = team({
      teamKey: NO_SHOW,
      pointTotal: 8,
      eventPoints: [eventPoints({ eventKey: EVENT, week: 2, qual: 0, alliance: 0, elim: 0, award: 8, total: 8, state: postedState })],
    });
    const postedArtifact = districtArtifact(postedState, [postedNoShow]);
    const stage = deriveStageFromState(postedState).final;
    const posted = buildDistrictEventSimulationInput({
      eventKey: EVENT,
      season: SEASON,
      eventArtifact,
      districtArtifact: postedArtifact,
      stage,
      startMatchKey: null,
    });
    if (!posted.ok) throw new Error("fixture: the posted input did not build");
    expect(posted.input.awardOnlyTeams).toEqual([NO_SHOW]);
    const postedResult = simulateDistrictEvent(posted.input, 50, 5);
    expect(postedResult.awardPoints.get(NO_SHOW)![8]).toBe(50);
    const postedRows = buildDistrictLedgerRows({
      artifact: postedArtifact,
      distributions: new Map([[EVENT, distributionsFromResult(postedResult)]]),
    });
    const row = postedRows.teams.find((entry) => entry.teamKey === NO_SHOW)!.rows[0]!;
    const byCell = new Map(row.cells.map((cell) => [cell.cell, cell] as const));
    expect(byCell.get("award")).toMatchObject({ kind: "final", earned: 8 });
    for (const category of ["qual", "alliance", "elim"] as const) expect(byCell.get(category)).toMatchObject({ kind: "final", earned: 0 });
    expect(row.eventTotal).toMatchObject({ kind: "final", earned: 8 });
  });

  it("derives no award only list before the schedule posts, or when every registered team is scheduled", () => {
    const unscheduled = buildDistrictEventSimulationInput({
      eventKey: EVENT,
      season: SEASON,
      eventArtifact: eventArtifactWith(false),
      districtArtifact: artifact,
      stage: OPEN_STAGE,
      startMatchKey: null,
    });
    expect(unscheduled.ok).toBe(true);
    if (unscheduled.ok) expect("awardOnlyTeams" in unscheduled.input).toBe(false);

    const everyoneScheduled = buildDistrictEventSimulationInput({
      eventKey: EVENT,
      season: SEASON,
      eventArtifact,
      districtArtifact: districtArtifact(startedState, []),
      stage: OPEN_STAGE,
      startMatchKey: `${EVENT}_qm5`,
    });
    expect(everyoneScheduled.ok).toBe(true);
    if (everyoneScheduled.ok) expect("awardOnlyTeams" in everyoneScheduled.input).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LOADING CELLS READ PENDING (todo locks-loading-cells-read-not-available,
// quick task 261007-4qr): while the tab is still loading or its run has not
// landed, an open cell with no distribution yet is the unavailable variant
// with `pending: true`, never a new kind.
// ---------------------------------------------------------------------------

describe("buildDistrictLedgerRows — distributionsPending (261007-4qr)", () => {
  const openState = state({ qualMatchesPlayed: 10, qualMatchesTotal: 60, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
  const pendingCell = (cell: { readonly kind: string }): boolean => cell.kind === "unavailable" && "pending" in cell && cell.pending === true;
  const plainCell = (cell: { readonly kind: string }): boolean => cell.kind === "unavailable" && !("pending" in cell);

  function liveArtifact(eventKeys: readonly string[]) {
    return artifactOf([team({ teamKey: "frc1", eventPoints: eventKeys.map((eventKey) => eventPoints({ eventKey, state: openState })) })]);
  }

  it("marks a pending event's open cells, its event total and the grand total as pending", () => {
    const built = buildDistrictLedgerRows({ artifact: liveArtifact(["2026walive"]), distributions: NO_DISTRIBUTIONS, distributionsPending: true });
    const subject = built.teams[0]!;
    expect(subject.rows[0]!.cells.every(pendingCell)).toBe(true);
    expect(pendingCell(subject.rows[0]!.eventTotal)).toBe(true);
    expect(pendingCell(subject.grandTotal)).toBe(true);
  });

  it("keeps an event the run refused plain unavailable while pending, with no pending key at all", () => {
    const built = buildDistrictLedgerRows({
      artifact: liveArtifact(["2026walive"]),
      distributions: NO_DISTRIBUTIONS,
      distributionsPending: true,
      unavailableEvents: [{ eventKey: "2026walive", name: "UnratedTeamError" }],
    });
    const subject = built.teams[0]!;
    expect(subject.rows[0]!.cells.every(plainCell)).toBe(true);
    expect(plainCell(subject.rows[0]!.eventTotal)).toBe(true);
    expect(plainCell(subject.grandTotal)).toBe(true);
  });

  it("returns exactly today's output when the flag is absent or false", () => {
    const artifact = liveArtifact(["2026walive"]);
    const today = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS });
    expect(buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, distributionsPending: false })).toEqual(today);
    expect(today.teams[0]!.rows[0]!.cells.every(plainCell)).toBe(true);
    // An existing fixture with an open distribution in hand: unchanged with the flag set, because nothing is missing.
    const counts = new Int32Array(maxEventPoints(SEASON, "district").qual + 1);
    counts[5] = 100;
    const byTeam = new Map([["frc1", { qual: { counts, denominator: 100 }, alliance: undefined, elim: undefined, award: undefined, eventTotal: undefined, grandTotal: undefined }]]);
    const distributions = new Map([["2026walive", { eventKey: "2026walive", byTeam }]]);
    const withDistribution = buildDistrictLedgerRows({ artifact, distributions });
    expect(buildDistrictLedgerRows({ artifact, distributions, distributionsPending: false })).toEqual(withDistribution);
  });

  it("leaves a FINAL category with no earned row plain unavailable while pending", () => {
    const artifact = artifactOf([
      team({ teamKey: "frc1", pointTotal: 0, remainingEvents: [remainingEvent({ eventKey: "2026walive", week: 1 })], maxRemainingDistrict: 83 }),
    ]);
    const built = buildDistrictLedgerRows({
      artifact,
      distributions: NO_DISTRIBUTIONS,
      distributionsPending: true,
      stageByEvent: new Map([["2026walive", { qual: true, alliance: false, elim: false, award: false }]]),
    });
    const cells = built.teams[0]!.rows[0]!.cells;
    expect(plainCell(cells[0]!)).toBe(true);
    expect(cells.slice(1).every(pendingCell)).toBe(true);
  });

  it("gives the grand total the plain form when one missing event total is pending and another was refused", () => {
    const built = buildDistrictLedgerRows({
      artifact: liveArtifact(["2026walive", "2026warefused"]),
      distributions: NO_DISTRIBUTIONS,
      distributionsPending: true,
      unavailableEvents: [{ eventKey: "2026warefused", name: "UnratedTeamError" }],
    });
    const subject = built.teams[0]!;
    const byKey = new Map(subject.rows.map((row) => [row.eventKey, row] as const));
    expect(pendingCell(byKey.get("2026walive")!.eventTotal)).toBe(true);
    expect(plainCell(byKey.get("2026warefused")!.eventTotal)).toBe(true);
    expect(plainCell(subject.grandTotal)).toBe(true);
  });

  it("keeps a per-team refusal (the degraded team) plain unavailable while pending", () => {
    // A negative rookie bonus plus adjustments makes the grand-total
    // convolution refuse (WR-09's own trigger), which degrades the team to
    // plain cells. The flag is set; the degraded team must not read it.
    const artifact = artifactOf([
      team({ teamKey: "frc1", pointTotal: 20, adjustments: -5, eventPoints: [eventPoints({ eventKey: "2026wabon", total: 20 })] }),
    ]);
    const built = buildDistrictLedgerRows({ artifact, distributions: NO_DISTRIBUTIONS, distributionsPending: true });
    const subject = built.teams[0]!;
    expect(built.gaps.teamsWithUnavailableGrandTotal).toEqual(["frc1"]);
    for (const row of subject.rows) {
      expect(row.cells.every(plainCell)).toBe(true);
      expect(plainCell(row.eventTotal)).toBe(true);
    }
    expect(plainCell(subject.grandTotal)).toBe(true);
  });
});

describe("dcmpBracketFactsFor roles and dcmpBracketFactsAtPosition (quick task 261009-kt3, reading R12)", () => {
  const eight = Array.from({ length: 8 }, (_, index) => ({ allianceNumber: index + 1, picks: [`a${index}x`, `a${index}y`, `a${index}z`] }));
  const four = eight.slice(0, 4);
  const DIVISION_STAGE: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: true };
  const base = { eventKey: "2026micmp1", season: 2026, tier: "dcmp" as const, alliances: eight, playedMatches: [], unresolvedMatchCount: 0 };

  it("the championship role (or none) keeps today's gates; the division role accepts Awards final", () => {
    expect(dcmpBracketFactsFor({ ...base, stage: DIVISION_STAGE })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, stage: DIVISION_STAGE, role: "championship" })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...base, stage: DIVISION_STAGE, role: "division" })).toBeDefined();
    expect(dcmpBracketFactsFor({ ...base, stage: { ...DIVISION_STAGE, qual: false }, role: "division" })).toBeUndefined();
  });

  it("the finals role needs Alliance selection final and exactly the expected 2 or 4 alliances, numbered 1 to n, no qualification", () => {
    const finalsStage: DistrictStageFinality = { qual: false, alliance: true, elim: false, award: false };
    const finals = { ...base, eventKey: "2026micmp", stage: finalsStage, role: "finals" as const };
    expect(dcmpBracketFactsFor({ ...finals, alliances: four, expectedAllianceCount: 4 })).toBeDefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: four.slice(0, 2), expectedAllianceCount: 2 })).toBeDefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: eight, expectedAllianceCount: 4 })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: eight, expectedAllianceCount: 8 })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: four.slice(0, 3), expectedAllianceCount: 4 })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: four, expectedAllianceCount: 4, unresolvedMatchCount: 1 })).toBeUndefined();
    expect(dcmpBracketFactsFor({ ...finals, alliances: four, stage: { ...finalsStage, alliance: false }, expectedAllianceCount: 4 })).toBeUndefined();
  });

  it("reads the request's rows while the Playoffs are open, every played row once they are final, and none without a request", () => {
    const artifact = {
      alliances: eight,
      matches: [
        { matchKey: "2026micmp1_sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1, redTeams: ["a0x", "a0y", "a0z"], blueTeams: ["a7x", "a7y", "a7z"], actualWinner: "red" as const },
        { matchKey: "2026micmp1_sf2m1", compLevel: "sf", setNumber: 2, matchNumber: 1, redTeams: ["a3x", "a3y", "a3z"], blueTeams: ["a4x", "a4y", "a4z"], actualWinner: "blue" as const },
      ],
    };
    const requestRows = [{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 }];
    const open: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const at = (stage: DistrictStageFinality, request?: { playedElimMatches: typeof requestRows; unresolvedMatchCount: number }) =>
      dcmpBracketFactsAtPosition({ eventKey: "2026micmp1", season: 2026, role: "division", stage, eventArtifact: artifact, ...(request === undefined ? {} : { request }) });
    expect(at(open, { playedElimMatches: requestRows, unresolvedMatchCount: 0 })?.playedMatches).toEqual(requestRows);
    expect(at({ ...open, elim: true }, { playedElimMatches: requestRows, unresolvedMatchCount: 0 })?.playedMatches).toHaveLength(2);
    expect(at(open)?.playedMatches).toEqual([]);
    expect(at(open)?.alliances).toHaveLength(8);
    expect(at(open, { playedElimMatches: requestRows, unresolvedMatchCount: 1 })).toBeUndefined();
    expect(at({ ...open, alliance: false })).toBeUndefined();
  });
});

describe("a field observed backup in the DCMP bracket facts (quick task 261010-66y, D4 and reading R13)", () => {
  const eight = Array.from({ length: 8 }, (_, index) => ({ allianceNumber: index + 1, picks: [`b${index}x`, `b${index}y`, `b${index}z`] }));
  const STAGE: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
  const base = { eventKey: "2026pncmp", season: 2026, tier: "dcmp" as const, stage: STAGE, alliances: eight, playedMatches: [], unresolvedMatchCount: 0 };

  it("appends the backup to the end of its alliance's picks and changes nothing else", () => {
    const listed = dcmpBracketFactsFor(base)!;
    const withBackup = dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "bk", allianceNumber: 3 }] })!;
    expect(withBackup.alliances[2]!.picks).toEqual(["b2x", "b2y", "b2z", "bk"]);
    expect({ ...withBackup, alliances: withBackup.alliances.map((alliance) => (alliance.allianceNumber === 3 ? { ...alliance, picks: alliance.picks.slice(0, 3) } : alliance)) }).toEqual(listed);
    // The caller's own lists are never written to.
    expect(eight[2]!.picks).toEqual(["b2x", "b2y", "b2z"]);
  });

  it("with no backup, an empty list or the option absent the facts are today's", () => {
    const listed = dcmpBracketFactsFor(base)!;
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [] })).toEqual(listed);
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: undefined })).toEqual(listed);
  });

  it("a backup the alliance already lists is a listed pick: nothing is appended", () => {
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "b2z", allianceNumber: 3 }] })).toEqual(dcmpBracketFactsFor(base));
  });

  it("refuses the facts where the field contradicts the pick lists: two backups on one alliance, a fifth pick, a team named for two alliances, an alliance not in the list", () => {
    // Two on one alliance.
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "bk", allianceNumber: 3 }, { teamKey: "bk2", allianceNumber: 3 }] })).toBeUndefined();
    // A fifth pick: the alliance already lists its fourth.
    const withFourth = eight.map((alliance) => (alliance.allianceNumber === 3 ? { ...alliance, picks: [...alliance.picks, "b2w"] } : alliance));
    expect(dcmpBracketFactsFor({ ...base, alliances: withFourth })).toBeDefined();
    expect(dcmpBracketFactsFor({ ...base, alliances: withFourth, fieldBackups: [{ teamKey: "bk", allianceNumber: 3 }] })).toBeUndefined();
    // One team seen for two alliances.
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "bk", allianceNumber: 3 }, { teamKey: "bk", allianceNumber: 4 }] })).toBeUndefined();
    // A team another alliance lists.
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "b0x", allianceNumber: 3 }] })).toBeUndefined();
    // An alliance that is not in the list.
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "bk", allianceNumber: 9 }] })).toBeUndefined();
    // One backup on each of two alliances is fine.
    expect(dcmpBracketFactsFor({ ...base, fieldBackups: [{ teamKey: "bk", allianceNumber: 3 }, { teamKey: "bk2", allianceNumber: 4 }] })).toBeDefined();
  });

  it("dcmpBracketFactsAtPosition reads its own field backups once the Playoffs are final at the position, and the request's while they are open", () => {
    const artifact = {
      alliances: eight,
      matches: [
        { matchKey: "2026micmp1_sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1, redTeams: ["b0x", "b0y", "bk"], blueTeams: ["b7x", "b7y", "b7z"], actualWinner: "red" as const },
      ],
    };
    const requestRows = [{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 }];
    const open: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const at = (stage: DistrictStageFinality, request?: { playedElimMatches: typeof requestRows; unresolvedMatchCount: number; fieldBackups?: readonly { teamKey: string; allianceNumber: number }[] }) =>
      dcmpBracketFactsAtPosition({ eventKey: "2026micmp1", season: 2026, role: "division", stage, eventArtifact: artifact, ...(request === undefined ? {} : { request }) });
    const picksOf = (facts: ReturnType<typeof at>, allianceNumber: number) => facts!.alliances.find((alliance) => alliance.allianceNumber === allianceNumber)!.picks;

    // Playoffs final at the position: every played row of the artifact, and so its own backups, whatever the request says.
    const final = at({ ...open, elim: true }, { playedElimMatches: requestRows, unresolvedMatchCount: 0, fieldBackups: [{ teamKey: "other", allianceNumber: 2 }] });
    expect(picksOf(final, 1)).toEqual(["b0x", "b0y", "b0z", "bk"]);
    expect(picksOf(final, 2)).toEqual(["b1x", "b1y", "b1z"]);
    expect(picksOf(at({ ...open, elim: true }), 1)).toEqual(["b0x", "b0y", "b0z", "bk"]);

    // Playoffs open: the request's rows and the request's backups, and nothing read off the artifact's own rows.
    const fromRequest = at(open, { playedElimMatches: requestRows, unresolvedMatchCount: 0, fieldBackups: [{ teamKey: "other", allianceNumber: 2 }] });
    expect(picksOf(fromRequest, 1)).toEqual(["b0x", "b0y", "b0z"]);
    expect(picksOf(fromRequest, 2)).toEqual(["b1x", "b1y", "b1z", "other"]);
    expect(picksOf(at(open, { playedElimMatches: requestRows, unresolvedMatchCount: 0 }), 1)).toEqual(["b0x", "b0y", "b0z"]);
    expect(picksOf(at(open), 1)).toEqual(["b0x", "b0y", "b0z"]);
  });
});

// ---------------------------------------------------------------------------
// Quick task 261009-vp9: a category's NUMBER is final only once its points are
// in. The rows read the number. One decision reads the field.
// ---------------------------------------------------------------------------

describe("the live stage: a row's category is final only once its points are in (quick task 261009-vp9)", () => {
  const EVENT = "2026walag";
  /** The field says alliances are picked. Nothing later. */
  const PICKED = state({ alliancesPicked: true, playoffsDone: false, awardsPosted: false });
  /** The field says the playoffs are done. Awards not posted. */
  const PLAYED_OUT = state({ alliancesPicked: true, playoffsDone: true, awardsPosted: false });

  function rowAt(points: { qual: number; alliance: number; elim: number }, rowState: DistrictEventState) {
    return eventPoints({ eventKey: EVENT, ...points, award: 0, total: points.qual + points.alliance + points.elim, state: rowState });
  }

  /** Two teams at one live event. The second team's row is where the proving points land, or do not. */
  function twoTeams(rowState: DistrictEventState, other: { alliance: number; elim: number }, own: { alliance: number; elim: number } = { alliance: 0, elim: 0 }): DistrictArtifact {
    return artifactOf([
      team({ teamKey: "frc1", pointTotal: 18 + own.alliance + own.elim, eventPoints: [rowAt({ qual: 18, ...own }, rowState)] }),
      team({ teamKey: "frc2", pointTotal: 14 + other.alliance + other.elim, eventPoints: [rowAt({ qual: 14, ...other }, rowState)] }),
    ]);
  }

  const rowOf = (artifact: DistrictArtifact, teamKey: string, distributions: ReadonlyMap<string, DistrictEventDistributions> = NO_DISTRIBUTIONS) =>
    buildDistrictLedgerRows({ artifact, distributions }).teams.find((entry) => entry.teamKey === teamKey)!.rows[0]!;

  it("deriveLiveStage keeps stateKnown and started from the state, takes final from the rule, and is finished only when all four are final", () => {
    const nothing = { alliancePoints: false, winnerPlayoffPoints: false, finalsEvent: false };
    const everything = { alliancePoints: true, winnerPlayoffPoints: true, finalsEvent: false };
    expect(deriveLiveStage(undefined, everything)).toEqual({ final: { qual: false, alliance: false, elim: false, award: false }, stateKnown: false, started: false, finished: false });
    expect(deriveLiveStage(PLAYED_OUT, nothing)).toEqual({ final: { qual: false, alliance: false, elim: false, award: false }, stateKnown: true, started: true, finished: false });
    expect(deriveLiveStage(PLAYED_OUT, everything).final).toEqual({ qual: true, alliance: true, elim: true, award: false });
    expect(deriveLiveStage(state(), nothing)).toEqual({ final: { qual: true, alliance: true, elim: true, award: true }, stateKnown: true, started: true, finished: true });
    // An absent presence reads as nothing proven.
    expect(deriveLiveStage(PICKED, undefined).final).toEqual({ qual: false, alliance: false, elim: false, award: false });
    // The state's own reading is unchanged: the field says selection is over.
    expect(deriveStageFromState(PICKED).final).toEqual({ qual: true, alliance: true, elim: false, award: false });
  });

  it("at Now, alliances picked with no alliance points on any row: Qualification and Alliance selection are open and neither cell is final", () => {
    const row = rowOf(twoTeams(PICKED, { alliance: 0, elim: 0 }), "frc1");
    expect(row.stage.final).toEqual({ qual: false, alliance: false, elim: false, award: false });
    expect(row.stage.finished).toBe(false);
    expect(row.cells[0]!.kind).not.toBe("final");
    expect(row.cells[1]!.kind).not.toBe("final");
  });

  it("at Now, alliance points on ANOTHER team's row at that event close both, and the cells print the artifact's numbers", () => {
    const row = rowOf(twoTeams(PICKED, { alliance: 9, elim: 0 }), "frc1");
    expect(row.stage.final).toEqual({ qual: true, alliance: true, elim: false, award: false });
    expect(row.cells[0]).toMatchObject({ kind: "final", earned: 18 });
    expect(row.cells[1]).toMatchObject({ kind: "final", earned: 0 });
  });

  it("at Now, playoffs done with no row at the winner's value: the Playoffs cell is not final; with one on another team's row it prints the artifact's number", () => {
    const lagging = rowOf(twoTeams(PLAYED_OUT, { alliance: 9, elim: 0 }, { alliance: 5, elim: 7 }), "frc1");
    expect(lagging.stage.final).toEqual({ qual: true, alliance: true, elim: false, award: false });
    expect(lagging.cells[2]!.kind).not.toBe("final");

    const landed = rowOf(twoTeams(PLAYED_OUT, { alliance: 9, elim: 30 }, { alliance: 5, elim: 7 }), "frc1");
    expect(landed.stage.final).toEqual({ qual: true, alliance: true, elim: true, award: false });
    expect(landed.cells[2]).toMatchObject({ kind: "final", earned: 7 });
  });

  it("at Now with no alliance points on any row, a team on no alliance still carries the not picked note on its open Playoffs cell: selection is over on the field", () => {
    const slot = (draws: number): DistrictSelectionRouteObservation => ({ draws, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 0, possibleMaxPoints: 16 });
    const nobodyTookIt: DistrictSelectionRoutes = { bySlot: [slot(0), slot(0), slot(0), slot(0)], notSelectedDraws: 1000 };
    const histogram = (support: number): DistrictPointDistribution => {
      const counts = new Int32Array(support + 1);
      counts[0] = 970;
      counts[support] = 30;
      return { counts, denominator: 1000 };
    };
    const distributions = new Map<string, DistrictEventDistributions>([
      [
        EVENT,
        {
          eventKey: EVENT,
          byTeam: new Map([["frc1", { qual: histogram(22), alliance: histogram(16), elim: histogram(30), award: undefined, eventTotal: undefined, grandTotal: undefined }]]),
          selectionRoutesByTeam: new Map([["frc1", nobodyTookIt]]),
          draftFixed: true,
        },
      ],
    ]);
    const row = rowOf(twoTeams(PICKED, { alliance: 0, elim: 0 }), "frc1", distributions);
    // The number reading: Alliance selection is open, and its cell is an open cell.
    expect(row.stage.final.alliance).toBe(false);
    expect(row.cells[1]!.kind).toBe("open");
    // The field reading: selection is over, so the note is carried.
    const elim = row.cells[2]!;
    expect(elim.kind).toBe("open");
    if (elim.kind !== "open") throw new Error("unreachable");
    expect(elim.notPicked).toBe(true);
  });

  it("a decided placement where the playoffs are done by state and the playoff points are not in is settled as NOT exact, never at the row's stale number", () => {
    // frc1's row still carries last tick's 0 playoff points. Its alliance
    // finished second: 20 printed, 25 the most that place can pay.
    const artifact = twoTeams(PLAYED_OUT, { alliance: 9, elim: 0 }, { alliance: 5, elim: 0 });
    const decided = new Map<string, DistrictEventDistributions>([
      [EVENT, { eventKey: EVENT, byTeam: new Map(), playoffMilestoneByTeam: new Map([["frc1", { kind: "decided" as const, placement: 2 }]]) }],
    ]);
    const atNow = rowOf(artifact, "frc1", decided);
    expect(atNow.settledElim).toEqual({ points: 20, exact: false, ceiling: 25 });
    expect(atNow.cells[2]).toMatchObject({ kind: "final", earned: 20, upTo: true });

    // The same at a rewound stop whose playoffs are open: the row's number is
    // not final at Now, so the stop cannot read it as TBA's settled value.
    const OPEN_PLAYOFFS: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const rewound = buildDistrictLedgerRows({ artifact, distributions: decided, stageByEvent: new Map([[EVENT, OPEN_PLAYOFFS]]) }).teams.find((entry) => entry.teamKey === "frc1")!.rows[0]!;
    expect(rewound.settledElim).toEqual({ points: 20, exact: false, ceiling: 25 });
    expect(rewound.cells[2]).toMatchObject({ kind: "final", earned: 20, upTo: true });

    // Once a row at the winner's value is in, the same rewound stop reads TBA's own number as exact.
    const landed = twoTeams(PLAYED_OUT, { alliance: 9, elim: 30 }, { alliance: 5, elim: 20 });
    const exact = buildDistrictLedgerRows({ artifact: landed, distributions: decided, stageByEvent: new Map([[EVENT, OPEN_PLAYOFFS]]) }).teams.find((entry) => entry.teamKey === "frc1")!.rows[0]!;
    expect(exact.settledElim).toEqual({ points: 20, exact: true, ceiling: 0 });
    expect(exact.cells[2]).toEqual({ id: districtCellId(EVENT, "elim"), cell: "elim", kind: "final", earned: 20 });
    expect("upTo" in exact.cells[2]!).toBe(false);
  });

  describe("on the committed 2026 PNW fixture with a finished state on every row", () => {
    /** Walks up from the working directory, because jsdom gives `import.meta.url` an http URL. */
    function repoFile(relative: string): string {
      let dir = resolve(process.cwd());
      for (;;) {
        const candidate = join(dir, relative);
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`could not find ${relative} above ${process.cwd()}`);
        dir = parent;
      }
    }
    const file: DistrictArtifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(repoFile("data/fixtures/phase10/district-2026pnw.json"), "utf8")));
    const finished: DistrictArtifact = DistrictArtifactSchema.parse({
      ...file,
      teams: file.teams.map((entry) => ({ ...entry, eventPoints: entry.eventPoints.map((row) => ({ ...row, state: state() })) })),
    });

    it("liveStageByEvent equals the state's own reading for every event", () => {
      const live = liveStageByEvent(finished, ["district", "dcmp"]);
      expect(live.size).toBeGreaterThanOrEqual(9);
      for (const source of finished.teams) {
        for (const row of source.eventPoints) expect({ eventKey: row.eventKey, final: live.get(row.eventKey) }).toEqual({ eventKey: row.eventKey, final: deriveStageFromState(row.state).final });
      }
      // The tier argument selects the events: the district tier alone leaves the championship out.
      expect(liveStageByEvent(finished, ["district"]).has("2026pncmp")).toBe(false);
      expect(liveStageByEvent(finished, ["district"]).size).toBe(8);
    });

    it("a rewound call builds the rows the supplied stage says, whatever the rows' points prove", () => {
      // Every category final at the stop: exactly the rows built at Now.
      const nowMap = new Map<string, DistrictStageFinality>();
      for (const source of finished.teams) for (const entry of districtTierEvents(source)) nowMap.set(entry.eventKey, deriveStageFromState(entry.state).final);
      const atNow = buildDistrictLedgerRows({ artifact: finished, distributions: NO_DISTRIBUTIONS });
      const allFinal = buildDistrictLedgerRows({ artifact: finished, distributions: NO_DISTRIBUTIONS, stageByEvent: nowMap });
      expect(allFinal).toEqual(atNow);

      // One event reopened at the stop: its rows read the supplied stage, and
      // its final categories still print the artifact's own numbers.
      const reopened = new Map(nowMap);
      reopened.set("2026orore", { qual: true, alliance: true, elim: false, award: false });
      const back = buildDistrictLedgerRows({ artifact: finished, distributions: NO_DISTRIBUTIONS, stageByEvent: reopened });
      let checked = 0;
      for (const built of back.teams) {
        for (const row of built.rows) {
          if (row.eventKey !== "2026orore") {
            expect(row.stage.final).toEqual({ qual: true, alliance: true, elim: true, award: true });
            continue;
          }
          checked++;
          expect(row.stage.final).toEqual({ qual: true, alliance: true, elim: false, award: false });
          expect(row.cells[0]).toMatchObject({ kind: "final", earned: row.earned!.qual });
          expect(row.cells[1]).toMatchObject({ kind: "final", earned: row.earned!.alliance });
          expect(row.cells[2]!.kind).not.toBe("final");
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// The secured playoff minimum on the rows (quick task 261012-mw2)
// ---------------------------------------------------------------------------

describe("the secured playoff minimum on the rows (quick task 261012-mw2)", () => {
  // EVERY EXPECTED CREDIT BELOW IS WORKED BY HAND from TBA's pay rule as
  // `packages/core/districts/securedPlayoffPoints.ts` states it for 2024 on:
  // an alliance's table points (sf7 and sf8 pay 13, sf9, sf10, sf11 and sf13
  // pay 7, sf12 pays 6, sf1 to sf6 pay 0) times the semifinal wins the robot
  // was on the field for, over the semifinal wins of its alliance, rounded up,
  // and then times the tier weight (1 at a district event, 3 at a championship).
  const EVENT = "2026wasec";
  const picksOf = (allianceNumber: number): string[] => [`frc${String(allianceNumber)}01`, `frc${String(allianceNumber)}02`, `frc${String(allianceNumber)}03`];
  /** Eight alliances of three. Alliance 1 also lists a fourth pick, frc104: the listed backup of the sat out test. */
  const ALLIANCES = Array.from({ length: 8 }, (_unused, i) => ({ allianceNumber: i + 1, picks: i === 0 ? [...picksOf(1), "frc104"] : picksOf(i + 1) }));
  type SourceMatch = BracketSourceEvent["matches"][number];

  function playoffRow(
    setNumber: number,
    red: readonly string[],
    blue: readonly string[],
    actualWinner: "red" | "blue" | "tie" | undefined,
    options: { readonly compLevel?: string; readonly matchNumber?: number } = {}
  ): SourceMatch {
    const compLevel = options.compLevel ?? "sf";
    const matchNumber = options.matchNumber ?? 1;
    return {
      matchKey: `${EVENT}_${compLevel}${String(setNumber)}m${String(matchNumber)}`,
      compLevel,
      setNumber,
      matchNumber,
      redTeams: [...red],
      blueTeams: [...blue],
      ...(actualWinner === undefined ? {} : { actualWinner }),
    };
  }
  /** `null` publishes no alliance list at all (an explicit `undefined` would fall back to the default). */
  const eventOf = (matches: readonly SourceMatch[], alliances: NonNullable<BracketSourceEvent["alliances"]> | null = ALLIANCES): BracketSourceEvent => ({ ...(alliances === null ? {} : { alliances }), matches });

  // Round 1, red winning every set: 1 beats 8, 4 beats 5, 2 beats 7, 3 beats 6.
  const ROUND_ONE: readonly SourceMatch[] = [
    playoffRow(1, picksOf(1), picksOf(8), "red"),
    playoffRow(2, picksOf(4), picksOf(5), "red"),
    playoffRow(3, picksOf(2), picksOf(7), "red"),
    playoffRow(4, picksOf(3), picksOf(6), "red"),
  ];
  // The lower half of Round 2: sf5 is the losers of sf1 and sf2 (8 against 5), sf6 the losers of sf3 and sf4 (7 against 6).
  const LOWER_ROUND_TWO: readonly SourceMatch[] = [playoffRow(5, picksOf(8), picksOf(5), "blue"), playoffRow(6, picksOf(7), picksOf(6), "blue")];
  // sf7 is the winners of sf1 and sf2: alliance 1 against alliance 4.
  const UPPER_SEVEN = playoffRow(7, picksOf(1), picksOf(4), "red");
  const THROUGH_SEVEN: readonly SourceMatch[] = [...ROUND_ONE, ...LOWER_ROUND_TWO, UPPER_SEVEN];
  const asObject = (map: ReadonlyMap<string, number>): Record<string, number> => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));

  describe("openPlayoffBounds, the one rule of an open Playoffs category", () => {
    const WHOLE = 30;
    it("reads an exact settled value as the larger of it and the secured minimum, with no ceiling", () => {
      const exact = { points: 21, exact: true, ceiling: 0 };
      expect(openPlayoffBounds({ settledElim: exact }, WHOLE)).toEqual({ floor: 21, ceiling: 0 });
      expect(openPlayoffBounds({ settledElim: exact, securedElim: 13 }, WHOLE)).toEqual({ floor: 21, ceiling: 0 });
      expect(openPlayoffBounds({ settledElim: exact, securedElim: 21 }, WHOLE)).toEqual({ floor: 21, ceiling: 0 });
      // THE LARGER OF THE TWO: a secured minimum above the number counts, and still nothing is left open.
      expect(openPlayoffBounds({ settledElim: exact, securedElim: 39 }, WHOLE)).toEqual({ floor: 39, ceiling: 0 });
      // With no secured minimum it is the settled rule of before this task.
      expect(openPlayoffBounds({ settledElim: exact }, WHOLE)).toEqual(settledElimBounds(exact));
    });

    it("under a settled value that is not exact, reads the secured minimum and the rest of the placement's ceiling", () => {
      // A decided second place at a district event: 20 printed, 25 the most that place can pay.
      const second = { points: 20, exact: false, ceiling: 25 };
      expect(openPlayoffBounds({ settledElim: second, securedElim: 20 }, WHOLE)).toEqual({ floor: 20, ceiling: 5 });
      expect(openPlayoffBounds({ settledElim: second, securedElim: 14 }, WHOLE)).toEqual({ floor: 14, ceiling: 11 });
      // With no secured minimum it is the settled rule of before this task: nothing in the floor.
      expect(openPlayoffBounds({ settledElim: second }, WHOLE)).toEqual({ floor: 0, ceiling: 25 });
      expect(openPlayoffBounds({ settledElim: second }, WHOLE)).toEqual(settledElimBounds(second));
    });

    it("with no settled value, reads the secured minimum and the rest of the whole ceiling", () => {
      expect(openPlayoffBounds({ securedElim: 13 }, WHOLE)).toEqual({ floor: 13, ceiling: 17 });
      expect(openPlayoffBounds({ securedElim: 20 }, WHOLE)).toEqual({ floor: 20, ceiling: 10 });
      expect(openPlayoffBounds({ securedElim: 30 }, WHOLE)).toEqual({ floor: 30, ceiling: 0 });
    });

    it("clamps a secured minimum above the most to the most, and reads none, zero or a negative one as floor 0", () => {
      expect(openPlayoffBounds({ securedElim: 45 }, WHOLE)).toEqual({ floor: 30, ceiling: 0 });
      // Above a decided placement's ceiling: clamped to that ceiling, never to the whole one.
      expect(openPlayoffBounds({ settledElim: { points: 13, exact: false, ceiling: 13 }, securedElim: 20 }, WHOLE)).toEqual({ floor: 13, ceiling: 0 });
      expect(openPlayoffBounds({}, WHOLE)).toEqual({ floor: 0, ceiling: 30 });
      expect(openPlayoffBounds({ securedElim: undefined, settledElim: undefined }, WHOLE)).toEqual({ floor: 0, ceiling: 30 });
      expect(openPlayoffBounds({ securedElim: 0 }, WHOLE)).toEqual({ floor: 0, ceiling: 30 });
      expect(openPlayoffBounds({ securedElim: -4 }, WHOLE)).toEqual({ floor: 0, ceiling: 30 });
    });

    it("never moves the most: in every open case floor plus ceiling is what the category could pay before this task", () => {
      const settledCases = [undefined, { points: 20, exact: false, ceiling: 25 }, { points: 7, exact: false, ceiling: 7 }, { points: 0, exact: false, ceiling: 0 }];
      let checked = 0;
      for (const settledElim of settledCases) {
        const most = settledElim === undefined ? WHOLE : settledElim.ceiling;
        for (const securedElim of [undefined, -3, 0, 1, 7, 13, 14, 20, 25, 30, 31, 90]) {
          const bounds = openPlayoffBounds({ settledElim, securedElim }, WHOLE);
          expect(bounds.floor + bounds.ceiling, `${JSON.stringify(settledElim)} with ${String(securedElim)}`).toBe(most);
          expect(bounds.floor).toBeGreaterThanOrEqual(0);
          expect(bounds.ceiling).toBeGreaterThanOrEqual(0);
          checked += 1;
        }
      }
      expect(checked).toBe(48);
    });
  });

  describe("securedBeyondPosted, what a final Playoffs category counts beyond TBA's number", () => {
    it("reads 0 where TBA's number is at or above the secured minimum", () => {
      expect(securedBeyondPosted({ earned: { elim: 30 }, securedElim: 20 })).toBe(0);
      expect(securedBeyondPosted({ earned: { elim: 20 }, securedElim: 20 })).toBe(0);
    });
    it("reads the difference where the number is lower, and the whole secured minimum where TBA has no row", () => {
      expect(securedBeyondPosted({ earned: { elim: 7 }, securedElim: 20 })).toBe(13);
      expect(securedBeyondPosted({ earned: { elim: 0 }, securedElim: 20 })).toBe(20);
      expect(securedBeyondPosted({ earned: undefined, securedElim: 20 })).toBe(20);
      expect(securedBeyondPosted({ securedElim: 20 })).toBe(20);
    });
    it("reads 0 where no secured minimum is supplied", () => {
      expect(securedBeyondPosted({ earned: { elim: 20 } })).toBe(0);
      expect(securedBeyondPosted({ earned: { elim: 0 }, securedElim: undefined })).toBe(0);
      expect(securedBeyondPosted({})).toBe(0);
    });
  });

  describe("securedElimByTeamFor, the tab's reader", () => {
    it("credits nobody after Round 1, or after the lower half of Round 2: sf1 to sf6 pay nothing", () => {
      expect(securedElimByTeamFor(eventOf(ROUND_ONE), SEASON, "district").size).toBe(0);
      expect(securedElimByTeamFor(eventOf([...ROUND_ONE, ...LOWER_ROUND_TWO]), SEASON, "district").size).toBe(0);
      expect(securedElimEntry(eventOf(ROUND_ONE), SEASON, "district")).toEqual({});
    });

    it("credits the three robots on the field for a sf7 win, and nobody else", () => {
      // Alliance 1 holds 0 (sf1) plus 13 (sf7) = 13 table points over 2 semifinal wins. Each of its three robots was
      // on the field for both: 13 x 2 / 2 = 13. Winning nothing more is its least future (20 x 2 / 3 rounds up to 14).
      expect(asObject(securedElimByTeamFor(eventOf(THROUGH_SEVEN), SEASON, "district"))).toEqual({ frc101: 13, frc102: 13, frc103: 13 });
      // The championship tier: the same 13, times the weight 3.
      expect(asObject(securedElimByTeamFor(eventOf(THROUGH_SEVEN), SEASON, "dcmp"))).toEqual({ frc101: 39, frc102: 39, frc103: 39 });
      // Alliances 5 and 6 won a set that pays 0 and alliance 4 lost sf7: none of them is in the map.
      const entry = securedElimEntry(eventOf(THROUGH_SEVEN), SEASON, "district");
      expect(asObject(entry.securedElimByTeam!)).toEqual({ frc101: 13, frc102: 13, frc103: 13 });
    });

    it("credits a listed robot that sat the win out with its smaller share, rounded up before the weight", () => {
      // sf7 won with the listed fourth pick frc104 in for frc103. Alliance 1: 13 table points, 2 semifinal wins.
      //   frc101 and frc102, both wins:      13 x 2 / 2 = 13
      //   frc103, sf1 only, and frc104, sf7 only: 13 x 1 / 2 = 6.5, rounded up to 7
      // The least future of a robot with one win is still 7: with a third alliance win the points are 20, and
      // 20 x 1 / 3 = 6.67 rounds up to 7.
      const rows = [...ROUND_ONE, ...LOWER_ROUND_TWO, playoffRow(7, ["frc101", "frc102", "frc104"], picksOf(4), "red")];
      expect(asObject(securedElimByTeamFor(eventOf(rows), SEASON, "district"))).toEqual({ frc101: 13, frc102: 13, frc103: 7, frc104: 7 });
      // At the championship tier the rounding comes BEFORE the weight: 7 x 3 = 21, never 6.5 x 3 = 19.5 rounded to 20.
      expect(asObject(securedElimByTeamFor(eventOf(rows), SEASON, "dcmp"))).toEqual({ frc101: 39, frc102: 39, frc103: 21, frc104: 21 });
    });

    it("credits nobody a list does not name: a backup on no pick list keeps its whole open cell", () => {
      // frc999 is on the field for the sf7 win and on no list. frc103 sat that win out: 13 x 1 / 2 rounds up to 7.
      const rows = [...ROUND_ONE, ...LOWER_ROUND_TWO, playoffRow(7, ["frc101", "frc102", "frc999"], picksOf(4), "red")];
      const secured = securedElimByTeamFor(eventOf(rows), SEASON, "district");
      expect(asObject(secured)).toEqual({ frc101: 13, frc102: 13, frc103: 7 });
      expect(secured.has("frc999")).toBe(false);
    });

    it("reads a tie and an unplayed row as nothing, and the replay of a tied set as the set's one decisive row", () => {
      const tied = [...ROUND_ONE, ...LOWER_ROUND_TWO, playoffRow(7, picksOf(1), picksOf(4), "tie"), playoffRow(8, picksOf(2), picksOf(3), undefined)];
      expect(securedElimByTeamFor(eventOf(tied), SEASON, "district").size).toBe(0);
      const replayed = [...tied, playoffRow(7, picksOf(1), picksOf(4), "red", { matchNumber: 2 })];
      expect(asObject(securedElimByTeamFor(eventOf(replayed), SEASON, "district"))).toEqual({ frc101: 13, frc102: 13, frc103: 13 });
    });

    it("reads nothing after the cut of onlyMatchKeys, and credits nobody where the cut leaves a row without the rows before it", () => {
      const event = eventOf(THROUGH_SEVEN);
      const keysOf = (rows: readonly SourceMatch[]): Set<string> => new Set(rows.map((row) => row.matchKey));
      // The stop before sf7: the win is not read.
      expect(securedElimByTeamFor(event, SEASON, "district", keysOf([...ROUND_ONE, ...LOWER_ROUND_TWO])).size).toBe(0);
      expect(securedElimByTeamFor(event, SEASON, "district", new Set()).size).toBe(0);
      // Every key: the same reading as no cut at all.
      expect(securedElimByTeamFor(event, SEASON, "district", keysOf(THROUGH_SEVEN))).toEqual(securedElimByTeamFor(event, SEASON, "district"));
      // sf7 inside the cut and sf1 outside it: sf7's own participants are undecided, so the whole event credits nobody.
      expect(securedElimByTeamFor(event, SEASON, "district", keysOf(THROUGH_SEVEN.filter((row) => row.setNumber !== 1))).size).toBe(0);
    });

    it("ignores a qualification row, whatever its winner", () => {
      const withQual = [playoffRow(12, picksOf(1), picksOf(2), "blue", { compLevel: "qm" }), ...THROUGH_SEVEN];
      expect(securedElimByTeamFor(eventOf(withQual), SEASON, "district")).toEqual(securedElimByTeamFor(eventOf(THROUGH_SEVEN), SEASON, "district"));
    });

    it("returns an empty map, for the whole event, wherever the bracket cannot be read whole", () => {
      const empty = (event: BracketSourceEvent, season = SEASON, label = ""): void => {
        expect(securedElimByTeamFor(event, season, "district").size, label).toBe(0);
        expect(securedElimEntry(event, season, "district"), label).toEqual({});
      };
      // The control: the same rows with the eight alliances as published credit alliance 1.
      expect(securedElimByTeamFor(eventOf(THROUGH_SEVEN), SEASON, "district").size).toBe(3);
      empty(eventOf(THROUGH_SEVEN, null), SEASON, "no published alliances");
      empty(eventOf(THROUGH_SEVEN, ALLIANCES.slice(0, 7)), SEASON, "seven alliances");
      empty(eventOf(THROUGH_SEVEN, ALLIANCES.map((alliance) => (alliance.allianceNumber === 8 ? { ...alliance, picks: alliance.picks.slice(0, 2) } : alliance))), SEASON, "an alliance of two picks");
      empty(eventOf(THROUGH_SEVEN, ALLIANCES.map((alliance) => (alliance.allianceNumber === 8 ? { ...alliance, picks: [...alliance.picks, "frc101"] } : alliance))), SEASON, "a team on two lists");
      // sf8 decided with a side no list names: alliance 1's credit does not stand beside a row the tab cannot map.
      empty(eventOf([...THROUGH_SEVEN, playoffRow(8, ["frc901", "frc902", "frc903"], picksOf(3), "blue")]), SEASON, "a decisive row with a side on no alliance");
      // sf8 decided with a side that spans alliances 2 and 3.
      empty(eventOf([...THROUGH_SEVEN, playoffRow(8, ["frc201", "frc202", "frc301"], picksOf(3), "red")]), SEASON, "a decisive row with a side on two alliances");
      // Both sides of a decisive row on ONE alliance.
      empty(eventOf([...THROUGH_SEVEN, playoffRow(8, ["frc201", "frc202"], ["frc203"], "red")]), SEASON, "a decisive row whose two sides are one alliance");
      empty(eventOf(THROUGH_SEVEN), 2022, "a season with no declared pay rule");
      empty(eventOf(THROUGH_SEVEN), 2027, "a season not registered yet");
    });
  });

  describe("the row, its Playoffs cell and the header", () => {
    const OPEN_PLAYOFFS: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
    /** The playoffs under way on the field at Now: alliances picked, nothing later. */
    const UNDER_WAY = state({ alliancesPicked: true, playoffsDone: false, awardsPosted: false });

    function elimDistribution(): DistrictPointDistribution {
      const counts = new Float64Array(maxEventPoints(SEASON, "district").elim + 1);
      counts[13] = 60;
      counts[20] = 30;
      counts[30] = 10;
      return { counts, denominator: 100 };
    }

    interface BuiltOptions {
      /** The artifact's own playoff and award points on the row. Qualification is 18 and Alliance selection 9 throughout. */
      readonly elim: number;
      readonly award?: number;
      readonly rowState?: DistrictEventState;
      /** The stage at a REWOUND position, or absent for Now. */
      readonly stage?: DistrictStageFinality;
      /** frc1's value in `securedElimByTeam`, or absent for an entry with no such map at all. */
      readonly secured?: number;
      readonly milestone?: AllianceBracketMilestone;
      readonly extra?: Partial<DistrictEventDistributions>;
    }

    function built(options: BuiltOptions) {
      const award = options.award ?? 5;
      const total = 18 + 9 + options.elim + award;
      const artifact = artifactOf([
        team({
          teamKey: "frc1",
          pointTotal: total,
          eventPoints: [eventPoints({ eventKey: EVENT, qual: 18, alliance: 9, elim: options.elim, award, total, state: options.rowState ?? state() })],
          awardProfile: { bucket: "none", rookie: false },
        }),
      ]);
      const record = { qual: undefined, alliance: undefined, elim: elimDistribution(), award: undefined, eventTotal: undefined, grandTotal: undefined };
      const entry: DistrictEventDistributions = {
        eventKey: EVENT,
        byTeam: new Map([["frc1", record]]),
        ...(options.milestone === undefined ? {} : { playoffMilestoneByTeam: new Map([["frc1", options.milestone]]) }),
        ...(options.secured === undefined ? {} : { securedElimByTeam: new Map([["frc1", options.secured]]) }),
        ...options.extra,
      };
      const rows = buildDistrictLedgerRows({
        artifact,
        distributions: new Map([[EVENT, entry]]),
        ...(options.stage === undefined ? {} : { stageByEvent: new Map([[EVENT, options.stage]]) }),
      });
      const ledgerTeam = rows.teams[0]!;
      const row = ledgerTeam.rows[0]!;
      return { team: ledgerTeam, row, elimCell: row.cells[2]! };
    }

    it("a row carries securedElim wherever one is supplied, open or final, and its open Playoffs cell carries securedAtLeast", () => {
      const open = built({ elim: 20, stage: OPEN_PLAYOFFS, secured: 13 });
      expect(open.row.securedElim).toBe(13);
      expect(open.elimCell.kind).toBe("open");
      if (open.elimCell.kind !== "open") throw new Error("unreachable");
      expect(open.elimCell.cell).toBe("elim");
      expect(open.elimCell.securedAtLeast).toBe(13);
      // No other cell of the row carries it.
      for (const cell of open.row.cells) if (cell.cell !== "elim") expect("securedAtLeast" in cell, cell.cell).toBe(false);

      // FINAL at a rewound stop and FINAL at Now: the row still carries it, and the grey cell prints TBA's number alone.
      for (const final of [built({ elim: 20, stage: ALL_FINAL, secured: 13 }), built({ elim: 20, secured: 13 })]) {
        expect(final.row.stage.final.elim).toBe(true);
        expect(final.row.securedElim).toBe(13);
        expect(final.elimCell).toEqual({ id: districtCellId(EVENT, "elim"), cell: "elim", kind: "final", earned: 20 });
        expect("securedAtLeast" in final.elimCell).toBe(false);
      }
    });

    it("a team priced from awards alone never carries one, and its header does not move", () => {
      const awardOnly = { awardOnlyTeams: new Set(["frc1"]) };
      const without = built({ elim: 0, stage: OPEN_PLAYOFFS, extra: awardOnly });
      const supplied = built({ elim: 0, stage: OPEN_PLAYOFFS, secured: 13, extra: awardOnly });
      expect("securedElim" in supplied.row).toBe(false);
      expect(JSON.stringify(supplied.row)).not.toContain("securedAtLeast");
      expect(supplied.team).toEqual(without.team);
      // Qualification 18 and Alliance selection 9 are final at the stop, and nothing of the Playoffs is counted.
      expect(supplied.team.earnedAtPosition).toBe(27);
    });

    it("a grey Playoffs cell never carries securedAtLeast: a knocked out team's cell is what it was", () => {
      // Third place decided on the field with the playoffs still open at Now: 13 printed behind up to, not exact.
      const without = built({ elim: 0, award: 0, rowState: UNDER_WAY, milestone: { kind: "decided", placement: 3 } });
      const supplied = built({ elim: 0, award: 0, rowState: UNDER_WAY, milestone: { kind: "decided", placement: 3 }, secured: 13 });
      expect(supplied.row.settledElim).toEqual({ points: 13, exact: false, ceiling: 13 });
      expect(supplied.elimCell).toEqual({ id: districtCellId(EVENT, "elim"), cell: "elim", kind: "final", earned: 13, upTo: true });
      expect(supplied.elimCell).toEqual(without.elimCell);
      expect("securedAtLeast" in supplied.elimCell).toBe(false);
      expect(supplied.row.securedElim).toBe(13);
    });

    it("a not picked cell never carries securedAtLeast", () => {
      const slot = (draws: number): DistrictSelectionRouteObservation => ({ draws, minPoints: undefined, maxPoints: undefined, allianceNumber: undefined, possibleMinPoints: 0, possibleMaxPoints: 16 });
      const nobodyTookIt: DistrictSelectionRoutes = { bySlot: [slot(0), slot(0), slot(0), slot(0)], notSelectedDraws: 1000 };
      const notPicked = { selectionRoutesByTeam: new Map([["frc1", nobodyTookIt]]), draftFixed: true };
      const supplied = built({ elim: 0, stage: OPEN_PLAYOFFS, secured: 13, extra: notPicked });
      expect(supplied.elimCell.kind).toBe("open");
      if (supplied.elimCell.kind !== "open") throw new Error("unreachable");
      expect(supplied.elimCell.notPicked).toBe(true);
      expect("securedAtLeast" in supplied.elimCell).toBe(false);
      // The reader never credits a team no list names (the reader's own tests above), so this pairing is built by hand.
    });

    it("the header at a REWOUND stop is the final categories plus the Playoffs bound's floor", () => {
      // Qualification 18 and Alliance selection 9 are final at the stop: 27. The row's own 20 and 5 landed later.
      expect(built({ elim: 20, stage: OPEN_PLAYOFFS }).team.earnedAtPosition).toBe(27);
      // With 13 secured the floor of the open category is 13: 27 + 13.
      expect(built({ elim: 20, stage: OPEN_PLAYOFFS, secured: 13 }).team.earnedAtPosition).toBe(40);
      // A finalist in the Finals row with 20 secured: 27 + 20.
      expect(built({ elim: 20, stage: OPEN_PLAYOFFS, secured: 20, milestone: { kind: "finals" } }).team.earnedAtPosition).toBe(47);
    });

    it("a knocked out team's exact settled value is in the header, as the larger of it and the secured minimum", () => {
      // Third place decided at a stop over a finished event: the settled value is TBA's own 13, exact.
      const third = { kind: "decided", placement: 3 } as const;
      const settled = built({ elim: 13, stage: OPEN_PLAYOFFS, milestone: third });
      expect(settled.row.settledElim).toEqual({ points: 13, exact: true, ceiling: 0 });
      // 27 + 13. Before this task the header left the 13 out and read 27 while the lock math counted 40.
      expect(settled.team.earnedAtPosition).toBe(40);
      // A secured minimum at or below TBA's number changes nothing.
      expect(built({ elim: 13, stage: OPEN_PLAYOFFS, milestone: third, secured: 13 }).team.earnedAtPosition).toBe(40);
      expect(built({ elim: 13, stage: OPEN_PLAYOFFS, milestone: third, secured: 7 }).team.earnedAtPosition).toBe(40);
      // THE LARGER OF THE TWO: a robot that sat a win out was paid 7 of its alliance's 13 while the rows say 13 is
      // secured. No such pair is in the corpus; the rule is that the larger one is counted: 27 + 13.
      const satOut = built({ elim: 7, stage: OPEN_PLAYOFFS, milestone: third, secured: 13 });
      expect(satOut.row.settledElim).toEqual({ points: 7, exact: true, ceiling: 0 });
      expect(satOut.team.earnedAtPosition).toBe(40);
    });

    it("under a settled value that is not exact the header counts the secured minimum and nothing of the placement table", () => {
      // Second place decided on the field, the playoff points not in: 20 printed behind up to, 25 the most.
      const second = { kind: "decided", placement: 2 } as const;
      const without = built({ elim: 0, award: 0, rowState: UNDER_WAY, stage: OPEN_PLAYOFFS, milestone: second });
      expect(without.row.settledElim).toEqual({ points: 20, exact: false, ceiling: 25 });
      expect(without.team.earnedAtPosition).toBe(27);
      // 20 secured from the rows: 27 + 20.
      expect(built({ elim: 0, award: 0, rowState: UNDER_WAY, stage: OPEN_PLAYOFFS, milestone: second, secured: 20 }).team.earnedAtPosition).toBe(47);
      // A robot that sat one of three wins out has 14 secured (20 x 2 / 3 rounded up): 27 + 14.
      expect(built({ elim: 0, award: 0, rowState: UNDER_WAY, stage: OPEN_PLAYOFFS, milestone: second, secured: 14 }).team.earnedAtPosition).toBe(41);
    });

    it("at NOW with the category open the header adds only what the floor counts beyond the number TBA has posted", () => {
      // Nothing posted for the playoffs yet: the published total is 27, and 13 is secured. 27 + 13.
      expect(built({ elim: 0, award: 0, rowState: UNDER_WAY, secured: 13 }).team.earnedAtPosition).toBe(40);
      expect(built({ elim: 0, award: 0, rowState: UNDER_WAY }).team.earnedAtPosition).toBe(27);
      // TBA has posted an interim 7 (published total 34) and 13 is secured: 34 + (13 - 7), the same points never twice.
      expect(built({ elim: 7, award: 0, rowState: UNDER_WAY, secured: 13 }).team.earnedAtPosition).toBe(40);
      // TBA has posted 20, above the 13 secured: the published total 47 alone. The header never falls below it.
      expect(built({ elim: 20, award: 0, rowState: UNDER_WAY, secured: 13 }).team.earnedAtPosition).toBe(47);
    });

    it("with the category FINAL the header adds only what the secured minimum holds beyond TBA's number, at Now and rewound alike", () => {
      for (const stage of [ALL_FINAL, undefined]) {
        const at = stage === undefined ? "Now" : "rewound";
        // TBA's 20 is at or above the 13 secured: the row's own total, 18 + 9 + 20 + 5.
        expect(built({ elim: 20, ...(stage === undefined ? {} : { stage }), secured: 13 }).team.earnedAtPosition, at).toBe(52);
        expect(built({ elim: 20, ...(stage === undefined ? {} : { stage }) }).team.earnedAtPosition, at).toBe(52);
        // A number that reads final and is older than the rows: 7 posted, 13 secured. 18 + 9 + 7 + 5 = 39, plus 6.
        expect(built({ elim: 7, ...(stage === undefined ? {} : { stage }), secured: 13 }).team.earnedAtPosition, at).toBe(45);
        expect(built({ elim: 7, ...(stage === undefined ? {} : { stage }) }).team.earnedAtPosition, at).toBe(39);
      }
    });

    it("rowCountedPoints is the final categories plus the Playoffs floor, and equals the header wherever the header is the floor", () => {
      // Open and rewound: 18 + 9 final, and the bound's floor.
      const open = built({ elim: 20, stage: OPEN_PLAYOFFS, secured: 13 });
      expect(rowCountedPoints(open.row)).toBe(40);
      expect(rowCountedPoints(open.row)).toBe(open.team.earnedAtPosition);
      expect(rowCountedPoints(built({ elim: 20, stage: OPEN_PLAYOFFS }).row)).toBe(27);
      // Open with an exact settled value: the larger of it and the secured minimum.
      const settled = built({ elim: 13, stage: OPEN_PLAYOFFS, milestone: { kind: "decided", placement: 3 } });
      expect(rowCountedPoints(settled.row)).toBe(40);
      expect(rowCountedPoints(settled.row)).toBe(settled.team.earnedAtPosition);
      // Open with a settled value that is not exact: the secured minimum alone.
      const second = built({ elim: 0, award: 0, rowState: UNDER_WAY, stage: OPEN_PLAYOFFS, milestone: { kind: "decided", placement: 2 }, secured: 14 });
      expect(rowCountedPoints(second.row)).toBe(41);
      expect(rowCountedPoints(second.row)).toBe(second.team.earnedAtPosition);
      // Final: all four categories, and what the secured minimum holds beyond TBA's number.
      for (const stage of [ALL_FINAL, undefined]) {
        const exact = built({ elim: 20, ...(stage === undefined ? {} : { stage }), secured: 13 });
        expect(rowCountedPoints(exact.row)).toBe(52);
        const older = built({ elim: 7, ...(stage === undefined ? {} : { stage }), secured: 13 });
        expect(rowCountedPoints(older.row)).toBe(45);
        expect(rowCountedPoints(older.row)).toBe(older.team.earnedAtPosition);
      }
      // A row TBA has no numbers for counts nothing beyond the Playoffs floor.
      const noNumbers = { stage: { final: OPEN_PLAYOFFS, stateKnown: true, started: true, finished: false }, earned: undefined };
      expect(rowCountedPoints(noNumbers)).toBe(0);
      expect(rowCountedPoints({ ...noNumbers, securedElim: 13 })).toBe(13);
      expect(rowCountedPoints({ ...noNumbers, stage: { ...noNumbers.stage, final: ALL_FINAL }, securedElim: 13 })).toBe(13);
    });

    it("at NOW with the category open, what a row counts is never above the header, which is the published total there", () => {
      // TBA has posted 20 with 13 secured: the header is the published 47 and the lock math counts 18 + 9 + 13.
      const posted = built({ elim: 20, award: 0, rowState: UNDER_WAY, secured: 13 });
      expect(posted.row.stage.final).toEqual({ qual: true, alliance: true, elim: false, award: false });
      expect(rowCountedPoints(posted.row)).toBe(40);
      expect(posted.team.earnedAtPosition).toBe(47);
    });

    it("with no secured minimum supplied a row and its cells deep equal what they were", () => {
      for (const options of [
        { elim: 20, stage: OPEN_PLAYOFFS },
        { elim: 20, stage: ALL_FINAL },
        { elim: 20 },
        { elim: 0, award: 0, rowState: UNDER_WAY },
        { elim: 20, stage: OPEN_PLAYOFFS, milestone: { kind: "finals" } as const },
      ] satisfies BuiltOptions[]) {
        const without = built(options);
        expect(JSON.stringify(without.team)).not.toContain("secured");
        // A map that holds nothing for the team, a zero and a negative value are all no credit.
        expect(built({ ...options, extra: { securedElimByTeam: new Map() } }).team).toEqual(without.team);
        expect(built({ ...options, extra: { securedElimByTeam: new Map([["frc2", 13]]) } }).team).toEqual(without.team);
        expect(built({ ...options, secured: 0 }).team).toEqual(without.team);
        expect(built({ ...options, secured: -5 }).team).toEqual(without.team);
      }
    });
  });
});

describe("the builder sets the season's weighted pick draft at every stage (quick task 261014-ol6)", () => {
  const roster = Array.from({ length: 24 }, (_unused, i) => `frc${String(400 + i)}`);
  const rpPmf = [0.25, 0.25, 0.25, 0.25];
  const SHIPPED = pickPositionPmfForSeason(SEASON);

  const districtArtifact = artifactOf(
    roster.map((teamKey) =>
      team({
        teamKey,
        pointTotal: 24,
        eventPoints: [eventPoints({ eventKey: "2026wapick", qual: 12, alliance: 6, elim: 6, award: 0, total: 24 })],
        awardProfile: { bucket: "none", rookie: false },
      })
    )
  );

  /** Eight three-team alliances off the top of the roster: a FINISHED selection. */
  const announced = Array.from({ length: 8 }, (_unused, n) => ({ allianceNumber: n + 1, picks: roster.slice(n * 3, n * 3 + 3) }));

  const eventArtifact = EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "7.0.0+rolling",
    eventKey: "2026wapick",
    season: SEASON,
    matches: Array.from({ length: 4 }, (_unused, i) => ({
      matchKey: `2026wapick_qm${String(i + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: i + 1,
      sortTime: 1_760_000_000 + i * 600,
      redTeams: roster.slice(i * 6, i * 6 + 3),
      blueTeams: roster.slice(i * 6 + 3, i * 6 + 6),
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
    teams: roster.map((teamKey, i) => ({
      teamKey,
      teamNumber: 400 + i,
      rank: i + 1,
      record: { wins: 2, losses: 2, ties: 0 },
      rp: 2,
      metrics: { total: { value: 80 - ((i * 7) % 24) }, sigma: { value: 8 } },
    })),
    alliances: announced,
  });

  function build(options: Partial<Parameters<typeof buildDistrictEventSimulationInput>[0]>) {
    const built = buildDistrictEventSimulationInput({
      eventKey: "2026wapick",
      season: SEASON,
      eventArtifact,
      districtArtifact,
      stage: { qual: false, alliance: false, elim: false, award: false },
      startMatchKey: null,
      ...options,
    });
    if (!built.ok) throw new Error("expected an input");
    return built.input;
  }

  it("the season has a pmf at all, so every case below checks a real value", () => {
    expect(SHIPPED).toBeDefined();
  });

  it("mid quals", () => {
    const input = build({ startMatchKey: "2026wapick_qm3" });
    expect(input.remainingMatches.length).toBeGreaterThan(0);
    expect(input.pickPositionPmf).toEqual(SHIPPED);
  });

  it("Quals done", () => {
    const input = build({ stage: { qual: true, alliance: false, elim: false, award: false } });
    expect(input.remainingMatches).toEqual([]);
    expect(input.knownAlliances).toBeUndefined();
    expect(input.pickPositionPmf).toEqual(SHIPPED);
  });

  it("with announced alliances", () => {
    const input = build({ stage: { qual: true, alliance: true, elim: false, award: false } });
    expect(input.knownAlliances).toHaveLength(8);
    expect(input.pickPositionPmf).toEqual(SHIPPED);
  });

  it("with asOfBaselines, a rewound REAL stop", () => {
    const asOfBaselines = roster.map((teamKey, i) => ({ teamKey, earnedRpSum: 24 - i, matchesPlayed: 4 }));
    const input = build({ stage: { qual: true, alliance: false, elim: false, award: false }, asOfBaselines });
    expect(input.baselines).toBe(asOfBaselines);
    expect(input.pickPositionPmf).toEqual(SHIPPED);
  });

  it("at the dcmp tier", () => {
    const input = build({
      tier: "dcmp",
      dcmpAwardSlate: {
        role: "single",
        expected: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judged: 12 },
        sources: { counts: "previousSeason", judged: "role" },
        eligibility: [],
      },
    });
    expect(input.tier).toBe("dcmp");
    expect(input.pickPositionPmf).toEqual(SHIPPED);
  });

  it("distributionsFromResult: the draft is FIXED for a run with announced alliances", () => {
    const input = build({ stage: { qual: true, alliance: true, elim: false, award: false } });
    expect(distributionsFromResult(simulateDistrictEvent(input, 200, 11)).draftFixed).toBe(true);
  });

  it("distributionsFromResult: the draft is NOT fixed for a Quals done run with the shipped pmf", () => {
    const input = build({ stage: { qual: true, alliance: false, elim: false, award: false } });
    const result = simulateDistrictEvent(input, 200, 11);
    expect(result.rankingFixed).toBe(true);
    expect(result.randomDraft).toBe(true);
    expect(distributionsFromResult(result).draftFixed).toBe(false);
  });

  it("distributionsFromResult: the draft is NOT fixed while matches remain", () => {
    const input = build({ startMatchKey: "2026wapick_qm3" });
    const result = simulateDistrictEvent(input, 200, 11);
    expect(result.rankingFixed).toBe(false);
    expect(distributionsFromResult(result).draftFixed).toBe(false);
  });

  it("changes no output where the draft does not run: the announced alliance run equals the run without the pmf", () => {
    const input = build({ stage: { qual: true, alliance: true, elim: false, award: false } });
    const { pickPositionPmf, ...withoutPmf } = input;
    expect(pickPositionPmf).toBeDefined();
    expect(simulateDistrictEvent(input, 200, 11)).toEqual(simulateDistrictEvent(withoutPmf, 200, 11));
  });
});
