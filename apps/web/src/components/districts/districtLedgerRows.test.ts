/**
 * The Road to District Champs tab's pure assembly layer.
 *
 * Synthetic fixtures parsed through the REAL `DistrictArtifactSchema`, so every
 * one of them matches the published shape. No corpus, no network, so CI runs
 * every test in this file.
 */
import { describe, expect, it } from "vitest";
import {
  DistrictArtifactSchema,
  DistrictPreSimArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
} from "../../../../../packages/harness/pageArtifacts.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { POINT_CELL_CHANCE_FORM_THRESHOLD } from "../../../../../packages/core/districts/pointSummary.js";
import type { AllianceBracketMilestone } from "../../../../../packages/core/districts/bracket.js";
import type {
  DistrictLedgerResult,
  DistrictSelectionRouteObservation,
  DistrictSelectionRoutes,
} from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  DISTRICT_CATEGORIES,
  allDistrictTierEventKeys,
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  decodeDistrictPointPmf,
  deriveStageFromState,
  districtCellId,
  districtEventContributions,
  districtLedgerStatLine,
  districtTierEvents,
  distributionsFromPreSim,
  distributionsFromResult,
  filterDistrictLedgerTeams,
  inProgressDistrictEventKeys,
  playedBracketMatchesFor,
  pointMassDistribution,
  type DistrictEventDistributions,
  type DistrictPointDistribution,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";

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
    expect(deriveStageFromState(state({ qualMatchesPlayed: 60, qualMatchesTotal: 60 })).final.qual).toBe(true);
    expect(deriveStageFromState(state({ qualMatchesPlayed: 30, qualMatchesTotal: 60 })).final.qual).toBe(false);
    expect(deriveStageFromState(state({ alliancesPicked: false })).final.alliance).toBe(false);
    expect(deriveStageFromState(state({ playoffsDone: false })).final.elim).toBe(false);
    expect(deriveStageFromState(state({ awardsPosted: false })).final.award).toBe(false);
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

  it("reports today's line as the slot-th highest earned district-tier total, and the cell counts", () => {
    const line = districtLedgerStatLine(built.teams, 1);
    expect(line.todaysLineFloor).toBe(70);
    expect(line.totalCells).toBe(2 * DISTRICT_CATEGORIES.length);
    expect(line.openCells).toBe(0);
  });

  it("reports today's line as ABSENT for a null dcmpSlots rather than as a guessed zero", () => {
    expect(districtLedgerStatLine(built.teams, null).todaysLineFloor).toBeNull();
  });
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

  it("forwards priorJudgedAwards onto the award profile, and leaves it absent when the artifact carries none", () => {
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

    function buildAt(options: { conditionOnPlayedElims?: boolean; stage?: DistrictStageFinality }) {
      const built = buildDistrictEventSimulationInput({
        eventKey: "2026waplay",
        season: SEASON,
        eventArtifact: playoffArtifact(played),
        districtArtifact,
        stage: options.stage ?? { qual: true, alliance: true, elim: false, award: false },
        startMatchKey: null,
        ...(options.conditionOnPlayedElims === undefined ? {} : { conditionOnPlayedElims: options.conditionOnPlayedElims }),
      });
      if (!built.ok) throw new Error("expected an input");
      return built;
    }

    it("passes the played rows at the live position", () => {
      expect(buildAt({ conditionOnPlayedElims: true }).input.playedElimMatches).toEqual([
        { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      ]);
    });

    it("passes NONE at a rewound position, where the playoff step is all-or-nothing", () => {
      expect(buildAt({ conditionOnPlayedElims: false }).input.playedElimMatches).toBeUndefined();
      // And an absent flag reads as false rather than as the live position.
      expect(buildAt({}).input.playedElimMatches).toBeUndefined();
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

  it("carries NO milestone for an event with no bracket progress, so the cell prints the shipped top-four chance", () => {
    expect(cellFor(undefined).playoffMilestone).toBeUndefined();
    expect(cellFor({ kind: "alive" }).playoffMilestone).toBeUndefined();
  });

  it("asks about the FINALIST once a top-four finish is secured, at this event's own finalist point value", () => {
    const milestone = cellFor({ kind: "topFour" }).playoffMilestone!;
    expect(milestone.kind).toBe("finalist");
    if (milestone.kind !== "finalist") throw new Error("unreachable");
    // 20 draws at or above the finalist's 20 points, out of 100.
    expect(milestone.chance).toBeCloseTo(0.2, 12);
    expect(milestone.conditionalMedian).toBeGreaterThan(19.5);
  });

  it("asks about the WINNER once the alliance is in the final", () => {
    const milestone = cellFor({ kind: "finals" }).playoffMilestone!;
    expect(milestone.kind).toBe("winner");
    if (milestone.kind !== "winner") throw new Error("unreachable");
    // 5 draws at the winner's 30 points, out of 100.
    expect(milestone.chance).toBeCloseTo(0.05, 12);
    expect(milestone.conditionalMedian).toBeCloseTo(30, 10);
  });

  it("carries the PLACEMENT and its own point value once the bracket has decided, with no chance left to print", () => {
    const milestone = cellFor({ kind: "decided", placement: 4 }).playoffMilestone!;
    expect(milestone).toEqual({ kind: "placed", placement: 4, points: 7 });
    expect(cellFor({ kind: "decided", placement: 1 }).playoffMilestone).toEqual({ kind: "placed", placement: 1, points: 30 });
    expect(cellFor({ kind: "decided", placement: 6 }).playoffMilestone).toEqual({ kind: "placed", placement: 6, points: 0 });
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
    rankingFixed: boolean | undefined,
    distribution: DistrictPointDistribution = lumpy(300, 16)
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
                elim: undefined,
                award: undefined,
                eventTotal: undefined,
                grandTotal: undefined,
              },
            ],
          ]),
          ...(routes === undefined ? {} : { selectionRoutesByTeam: new Map([["frc1", routes]]) }),
          ...(rankingFixed === undefined ? {} : { rankingFixed }),
        },
      ],
    ]);
    return buildDistrictLedgerRows({ artifact, distributions });
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
    expect(cell.selection!.rankingFixed).toBe(false);
    expect(cell.selection!.routes.bySlot[0]!.draws).toBe(200);
    expect(built.gaps.eventsWithUnknownSelectionRoutes).toEqual([]);
  });

  it("forwards a FIXED ranking as fixed", () => {
    const built = builtWith(routesFor(1000, 0, 0), true);
    const cell = built.teams[0]!.rows[0]!.cells[1]!;
    if (cell.kind !== "open") throw new Error("unreachable");
    expect(cell.selection!.rankingFixed).toBe(true);
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

  it("puts NO route view on any other category's cell", () => {
    const built = builtWith(routesFor(200, 100, 700), false);
    const cells = built.teams[0]!.rows[0]!.cells;
    for (const [index, cell] of cells.entries()) {
      if (cell.kind !== "open") continue;
      if (index === 1) continue;
      expect(cell.selection, `cell ${String(index)} carries a route view`).toBeUndefined();
    }
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

  it("forwards the run's routes and its fixed-ranking flag unreshaped", () => {
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
    expect(shaped.rankingFixed).toBe(true);
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
    expect(decoded.rankingFixed).toBeUndefined();
  });
});
