import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { ElimsTab, ElimsTabSkeleton } from "./ElimsTab.js";
import { QualsTab, QUALS_EMPTY_STATE_BODY } from "./QualsTab.js";
import type { EventMatch, EventUpcomingMatch } from "./eventMatchAxis.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * ElimsTab.test.tsx (07-13-PLAN.md) — 07-VALIDATION.md's Wave 0 EVNT-06 test
 * file. Task 1 covers filtering, ordering, the D-13 merge, the D-12 per-tab
 * domain, the bonus-RP negative and the tab's structure. Task 2 adds the
 * empty state, adjacency/boundary cases and the anti-drift comparison
 * against QualsTab. Fixtures are hand-written `EventArtifact`-shaped object
 * literals, mirroring `QualsTab.test.tsx`'s own factory pattern — never a
 * network response.
 */

function makePlayedMatch(overrides: Record<string, unknown> = {}): EventMatch {
  return {
    matchKey: "2022ilpe_qf1m1",
    compLevel: "qf",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 120,
    predictedBlueScore: 100,
    actualWinner: "red",
    actualRedScore: 130,
    actualBlueScore: 90,
    ...overrides,
  } as unknown as EventMatch;
}

function makeUpcomingMatch(overrides: Record<string, unknown> = {}): EventUpcomingMatch {
  return {
    matchKey: "2022ilpe_qf1m2",
    compLevel: "qf",
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.55,
    predictedRedScore: 115,
    predictedBlueScore: 105,
    ...overrides,
  } as unknown as EventUpcomingMatch;
}

function makeArtifact(overrides: Partial<EventArtifact> = {}): EventArtifact {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2022ilpe",
    season: 2022,
    name: "Peoria Regional",
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as unknown as EventArtifact;
}

afterEach(() => {
  cleanup();
});

describe("Filtering to the closed elimination set", () => {
  it("an artifact with 3 qm and 4 elimination played matches renders exactly 4 body rows, no qualification keys", () => {
    const matches = [
      makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qm2", compLevel: "qm", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qm3", compLevel: "qm", setNumber: 1, matchNumber: 3 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf2m1", compLevel: "sf", setNumber: 2, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(4);
    expect(screen.queryByTestId("match-row-qm1")).toBeNull();
    expect(screen.queryByTestId("match-row-qm2")).toBeNull();
    expect(screen.queryByTestId("match-row-qm3")).toBeNull();
  });

  it("a fixture carrying one row of EACH of the four elimination levels plus one qm row renders exactly 4 rows, all four levels present", () => {
    const matches = [
      makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "ef20m3", compLevel: "ef", setNumber: 20, matchNumber: 3 }),
      makePlayedMatch({ matchKey: "qf1m2", compLevel: "qf", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "sf13m1", compLevel: "sf", setNumber: 13, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m3", compLevel: "f", setNumber: 1, matchNumber: 3 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(4);
    for (const key of ["ef20m3", "qf1m2", "sf13m1", "f1m3"]) {
      expect(screen.getByTestId(`match-row-${key}`)).toBeDefined();
    }
  });

  it("the rendered round labels for the four-level fixture read Eighths 20-3, Quarterfinal 1-2, Semifinal 13-1 and Final 1-3", () => {
    const matches = [
      makePlayedMatch({ matchKey: "ef20m3", compLevel: "ef", setNumber: 20, matchNumber: 3 }),
      makePlayedMatch({ matchKey: "qf1m2", compLevel: "qf", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "sf13m1", compLevel: "sf", setNumber: 13, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m3", compLevel: "f", setNumber: 1, matchNumber: 3 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByText("Eighths 20-3")).toBeDefined();
    expect(screen.getByText("Quarterfinal 1-2")).toBeDefined();
    expect(screen.getByText("Semifinal 13-1")).toBeDefined();
    expect(screen.getByText("Final 1-3")).toBeDefined();
  });
});

describe("Ordering", () => {
  it("rows render in comp-level order: every ef before every qf, before every sf, before every f", () => {
    const matches = [
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "ef1m1", compLevel: "ef", setNumber: 1, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["match-row-ef1m1", "match-row-qf1m1", "match-row-sf1m1", "match-row-f1m1"]);
  });

  it("within one level, rows render in ascending set number then ascending match number", () => {
    const matches = [
      makePlayedMatch({ matchKey: "qf2m1", compLevel: "qf", setNumber: 2, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m2", compLevel: "qf", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf2m2", compLevel: "qf", setNumber: 2, matchNumber: 2 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["match-row-qf1m1", "match-row-qf1m2", "match-row-qf2m1", "match-row-qf2m2"]);
  });

  /**
   * The measured `2022ilpe` shape (07-13-PLAN.md `measured_ground_truth`):
   * played `qf1m1 qf2m1 qf3m1 qf4m1 qf1m2 qf2m2 qf3m2 qf4m2 qf3m3 sf1m1
   * sf2m1 sf1m2 sf2m2 f1m1 f1m2` and upcoming `qf2m3 qf4m3 sf2m3`, merging
   * to the 18-row sequence below with the three upcoming rows interleaved
   * at zero-based indices 4, 10 and 15.
   */
  function buildIlpeMatches(): EventMatch[] {
    return [
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf2m1", compLevel: "qf", setNumber: 2, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf3m1", compLevel: "qf", setNumber: 3, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf4m1", compLevel: "qf", setNumber: 4, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m2", compLevel: "qf", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qf2m2", compLevel: "qf", setNumber: 2, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qf3m2", compLevel: "qf", setNumber: 3, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qf4m2", compLevel: "qf", setNumber: 4, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qf3m3", compLevel: "qf", setNumber: 3, matchNumber: 3 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf2m1", compLevel: "sf", setNumber: 2, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf1m2", compLevel: "sf", setNumber: 1, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "sf2m2", compLevel: "sf", setNumber: 2, matchNumber: 2 }),
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m2", compLevel: "f", setNumber: 1, matchNumber: 2 }),
    ];
  }

  function buildIlpeUpcoming(): EventUpcomingMatch[] {
    return [
      makeUpcomingMatch({ matchKey: "qf2m3", compLevel: "qf", setNumber: 2, matchNumber: 3 }),
      makeUpcomingMatch({ matchKey: "qf4m3", compLevel: "qf", setNumber: 4, matchNumber: 3 }),
      makeUpcomingMatch({ matchKey: "sf2m3", compLevel: "sf", setNumber: 2, matchNumber: 3 }),
    ];
  }

  const ILPE_EXPECTED_ORDER = [
    "qf1m1", "qf1m2", "qf2m1", "qf2m2", "qf2m3", "qf3m1", "qf3m2", "qf3m3",
    "qf4m1", "qf4m2", "qf4m3", "sf1m1", "sf1m2", "sf2m1", "sf2m2", "sf2m3",
    "f1m1", "f1m2",
  ];

  it("the 2022ilpe shape renders exactly 18 rows in the full measured order, with upcoming rows interleaved at indices 4, 10 and 15", () => {
    const matches = buildIlpeMatches();
    const upcoming = buildIlpeUpcoming();
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/).map((r) => r.getAttribute("data-testid")!.replace("match-row-", ""));
    expect(rows).toHaveLength(18);
    expect(rows).toEqual(ILPE_EXPECTED_ORDER);
    expect(rows[4]).toBe("qf2m3");
    expect(rows[10]).toBe("qf4m3");
    expect(rows[15]).toBe("sf2m3");
  });

  it("the same 2022ilpe fixture with both input arrays shuffled produces an identical output sequence", () => {
    const matches = [...buildIlpeMatches()].reverse();
    const upcoming = [...buildIlpeUpcoming()].reverse();
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/).map((r) => r.getAttribute("data-testid")!.replace("match-row-", ""));
    expect(rows).toEqual(ILPE_EXPECTED_ORDER);
  });
});

describe("The D-13 merge and its non-mutation contract", () => {
  it("passes artifact.matches and artifact.upcoming to the merge without mutating either array's contents or order", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", setNumber: 1, matchNumber: 1 }), makePlayedMatch({ matchKey: "qf2m1", setNumber: 2, matchNumber: 1 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "qf3m1", setNumber: 3, matchNumber: 1 })];
    const matchesBefore = JSON.parse(JSON.stringify(matches));
    const upcomingBefore = JSON.parse(JSON.stringify(upcoming));

    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2022} />);

    expect(matches).toEqual(matchesBefore);
    expect(upcoming).toEqual(upcomingBefore);
  });

  it("a played row and an upcoming row sharing one match key collapse to exactly ONE rendered row, carrying the played row's actual scores", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", setNumber: 1, matchNumber: 1, actualRedScore: 130, actualBlueScore: 90 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "qf1m1", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId("actual-qf1m1-red").textContent).toContain("130");
  });
});

describe("Per-tab domain (D-12)", () => {
  it("axis tick labels span the merged rows' full extent, including an upcoming row's high predicted score", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", predictedRedScore: 100, predictedBlueScore: 100, actualRedScore: 100, actualBlueScore: 100 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "qf1m2", predictedRedScore: 900, predictedBlueScore: 880 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2022} />);
    const ticks = screen.getAllByTestId("axis-tick").map((t) => Number(t.textContent));
    expect(Math.max(...ticks)).toBeGreaterThan(880);
  });

  it("rendering ElimsTab and QualsTab against one artifact with disjoint qual/elim score ranges produces DIFFERENT tick labels", () => {
    // Modelled on the measured 2025mnmi shape: quals ~[28, 196], elims ~[91, 225].
    const artifact = makeArtifact({
      matches: [
        makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1, predictedRedScore: 28, predictedBlueScore: 40, actualRedScore: 28, actualBlueScore: 40 }),
        makePlayedMatch({ matchKey: "qm2", compLevel: "qm", setNumber: 1, matchNumber: 2, predictedRedScore: 196, predictedBlueScore: 180, actualRedScore: 196, actualBlueScore: 180 }),
        makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1, predictedRedScore: 91, predictedBlueScore: 100, actualRedScore: 91, actualBlueScore: 100 }),
        makePlayedMatch({ matchKey: "sf1m2", compLevel: "sf", setNumber: 1, matchNumber: 2, predictedRedScore: 225, predictedBlueScore: 210, actualRedScore: 225, actualBlueScore: 210 }),
      ],
    });
    const { unmount } = renderWithRouter(<QualsTab artifact={artifact} algorithmId="vpr" season={2025} />);
    const qualsTicks = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    unmount();

    renderWithRouter(<ElimsTab artifact={artifact} algorithmId="vpr" season={2025} />);
    const elimsTicks = screen.getAllByTestId("axis-tick").map((t) => t.textContent);

    expect(elimsTicks).not.toEqual(qualsTicks);
  });

  it("two renders of the same artifact produce identical tick labels", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1" })];
    const artifact = makeArtifact({ matches });
    const { unmount } = renderWithRouter(<ElimsTab artifact={artifact} algorithmId="vpr" season={2022} />);
    const ticksA = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    unmount();
    renderWithRouter(<ElimsTab artifact={artifact} algorithmId="vpr" season={2022} />);
    const ticksB = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    expect(ticksB).toEqual(ticksA);
  });
});

describe("Bonus-RP dots — the tab's defining negative", () => {
  it("every dot on every elimination row renders data-state of unknown, across all four elimination levels", () => {
    const matches = [
      makePlayedMatch({ matchKey: "ef1m1", compLevel: "ef", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, season: 2024 })} algorithmId="vpr" season={2024} />);
    const dots = document.querySelectorAll('[data-testid^="bonus-dot-"]');
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
    }
  });

  it("each dot carries the accessible label ending 'not awarded outside qualification matches', not merely data-state=unknown", () => {
    const matches = [
      makePlayedMatch({ matchKey: "ef1m1", compLevel: "ef", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, season: 2024 })} algorithmId="vpr" season={2024} />);
    const dots = document.querySelectorAll('[data-testid^="bonus-dot-"]');
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.getAttribute("aria-label")).toMatch(/not awarded outside qualification matches$/);
    }
  });

  it("a 2024 elimination row renders two dots per alliance and a 2025 one renders three, driven by bonusRpForSeason", () => {
    const matches2024 = [makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 })];
    const { unmount } = renderWithRouter(<ElimsTab artifact={makeArtifact({ matches: matches2024, season: 2024 })} algorithmId="vpr" season={2024} />);
    const predictedRedGroup2024 = screen.getByTestId("bonus-rp-predicted-sf1m1-red");
    expect(predictedRedGroup2024.querySelectorAll('[data-testid^="bonus-dot-"]')).toHaveLength(2);
    unmount();

    const matches2025 = [makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches: matches2025, season: 2025 })} algorithmId="vpr" season={2025} />);
    const predictedRedGroup2025 = screen.getByTestId("bonus-rp-predicted-sf1m1-red");
    expect(predictedRedGroup2025.querySelectorAll('[data-testid^="bonus-dot-"]')).toHaveLength(3);
  });
});

describe("Unplayed and absent-variance rows", () => {
  it("an unplayed elimination row renders both alliance bands and ticks and NO actual dot for either alliance; Actual and Call cells render an em-dash", () => {
    const upcoming = [makeUpcomingMatch({ matchKey: "qf1m2", redScoreVarianceOwn: 25, blueScoreVarianceOwn: 16 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ upcoming })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("alliance-mark-qf1m2-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m2-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m2-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m2-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-qf1m2-red-dot")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-qf1m2-blue-dot")).toBeNull();
    expect(screen.getByTestId("actual-qf1m2").textContent).toContain("—");
    expect(screen.getByTestId("call-qf1m2").textContent).toContain("—");
  });

  it("a row carrying neither variance field renders both ticks and no band for either alliance and does not throw", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", redScoreVarianceOwn: undefined, blueScoreVarianceOwn: undefined })];
    expect(() => renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />)).not.toThrow();
    expect(screen.getByTestId("alliance-mark-qf1m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-tick")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-qf1m1-red-band")).toBeNull();
    expect(screen.queryByTestId("alliance-mark-qf1m1-blue-band")).toBeNull();
  });

  it("a row carrying only the red variance field renders a red band and no blue band", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", redScoreVarianceOwn: 25, blueScoreVarianceOwn: undefined })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("alliance-mark-qf1m1-red-band")).toBeDefined();
    expect(screen.queryByTestId("alliance-mark-qf1m1-blue-band")).toBeNull();
  });
});

describe("Structure", () => {
  it("the scroll region carries a data-testid of elims-table-scroll", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1" })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("elims-table-scroll")).toBeDefined();
  });

  it("ElimsTabSkeleton renders skeleton rows and exposes zero elements with role progressbar", () => {
    renderWithRouter(<ElimsTabSkeleton />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("Empty state (EVNT-06 empty, UI-SPEC E6 empty)", () => {
  it("an artifact whose matches are all qualification rows and whose upcoming is empty (the 2025srsd shape) renders EmptyState with the event's name, the Copywriting Contract body, and no table/axis-header/scroll-region", () => {
    const matches = [makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming: [], name: "Sioux Falls Regional" })} algorithmId="vpr" season={2025} />);
    expect(screen.getByText("No matches found for Sioux Falls Regional")).toBeDefined();
    expect(screen.getByText(QUALS_EMPTY_STATE_BODY)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("axis-ticks")).toBeNull();
    expect(screen.queryByTestId("elims-table-scroll")).toBeNull();
  });

  it("the empty-state body is byte-identical to QualsTab's exported constant, compared by import rather than retyped", () => {
    const matches = [makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming: [] })} algorithmId="vpr" season={2025} />);
    expect(screen.getByText(QUALS_EMPTY_STATE_BODY)).toBeDefined();
  });

  it("the empty state renders no button element at all", () => {
    const matches = [makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming: [] })} algorithmId="vpr" season={2025} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an artifact carrying no name field falls back to the event key in the heading", () => {
    const matches = [makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches, upcoming: [], name: undefined, eventKey: "2025srsd" })} algorithmId="vpr" season={2025} />);
    expect(screen.getByText("No matches found for 2025srsd")).toBeDefined();
  });

  it("an artifact whose matches are empty but whose upcoming carries 3 elimination rows renders the FULL table with 3 rows, not the empty state", () => {
    const upcoming = [
      makeUpcomingMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makeUpcomingMatch({ matchKey: "qf2m1", compLevel: "qf", setNumber: 2, matchNumber: 1 }),
      makeUpcomingMatch({ matchKey: "qf3m1", compLevel: "qf", setNumber: 3, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches: [], upcoming })} algorithmId="vpr" season={2022} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(3);
    expect(screen.queryByText(/No matches found/)).toBeNull();
  });
});

describe("Adjacency (EVNT-06 adjacency)", () => {
  it("two rows sharing an identical (compLevel, setNumber, matchNumber) triple but differing in match key both appear, in match-key order — they separate, not merge or drop", () => {
    const matches = [
      makePlayedMatch({ matchKey: "2022ilpe_qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "2022gacar_qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(["match-row-2022gacar_qf1m1", "match-row-2022ilpe_qf1m1"]);
  });

  it("two alliance bands whose predicted intervals exactly touch both render, each keeping its own colour and its own tick", () => {
    // Red predicted 100 ± 10 (band [90,110]); blue predicted 130 ± 20 (band [110,150]) — touching at 110.
    const matches = [
      makePlayedMatch({
        matchKey: "qf1m1",
        predictedRedScore: 100,
        redScoreVarianceOwn: 100,
        predictedBlueScore: 130,
        blueScoreVarianceOwn: 400,
      }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("alliance-mark-qf1m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-tick")).toBeDefined();
  });

  it("two alliance bands whose predicted intervals exactly COINCIDE both render, with two ticks", () => {
    const matches = [
      makePlayedMatch({
        matchKey: "qf1m1",
        predictedRedScore: 100,
        redScoreVarianceOwn: 100,
        predictedBlueScore: 100,
        blueScoreVarianceOwn: 100,
      }),
    ];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("alliance-mark-qf1m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-tick")).toBeDefined();
  });

  it("a row whose variance fields are both exactly 0 still renders both ticks and both bands — a zero-width band is a real state, not an absent one", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", redScoreVarianceOwn: 0, blueScoreVarianceOwn: 0 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getByTestId("alliance-mark-qf1m1-red-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-tick")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-red-band")).toBeDefined();
    expect(screen.getByTestId("alliance-mark-qf1m1-blue-band")).toBeDefined();
  });
});

describe("Boundary and single-row (EVNT-06 empty, UI-SPEC E6 zero-one-many)", () => {
  it("a one-row elimination slate renders a one-row table with a non-zero-range axis", () => {
    const matches = [makePlayedMatch({ matchKey: "qf1m1", predictedRedScore: 100, predictedBlueScore: 100, actualRedScore: 100, actualBlueScore: 100 })];
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2022} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(1);
    const ticks = screen.getAllByTestId("axis-tick").map((t) => Number(t.textContent));
    expect(Math.max(...ticks)).toBeGreaterThan(Math.min(...ticks));
  });

  it("a 60-row fixture modelled on 2022mirr (ef sets 1-20, three matches each, all unplayed) renders exactly 60 body rows in set-then-match order, bands and ticks but no dots, and round labels reading Eighths {set}-{match}", () => {
    const upcoming: EventUpcomingMatch[] = [];
    for (let set = 1; set <= 20; set++) {
      for (let match = 1; match <= 3; match++) {
        upcoming.push(makeUpcomingMatch({ matchKey: `ef${set}m${match}`, compLevel: "ef", setNumber: set, matchNumber: match }));
      }
    }
    renderWithRouter(<ElimsTab artifact={makeArtifact({ matches: [], upcoming })} algorithmId="vpr" season={2022} />);
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows).toHaveLength(60);
    expect(screen.getByText("Eighths 1-1")).toBeDefined();
    expect(screen.getByText("Eighths 20-3")).toBeDefined();
    expect(document.querySelectorAll('[data-testid$="-dot"]')).toHaveLength(0);
  });
});

describe("Anti-drift against the sibling tab", () => {
  it("rendering ElimsTab and QualsTab against the same artifact, the two scroll elements' class strings are IDENTICAL", () => {
    const matches = [
      makePlayedMatch({ matchKey: "qm1", compLevel: "qm", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1 }),
    ];
    const artifact = makeArtifact({ matches });
    const { unmount } = renderWithRouter(<QualsTab artifact={artifact} algorithmId="vpr" season={2022} />);
    const qualsClass = screen.getByTestId("quals-table-scroll").className;
    unmount();

    renderWithRouter(<ElimsTab artifact={artifact} algorithmId="vpr" season={2022} />);
    const elimsClass = screen.getByTestId("elims-table-scroll").className;

    expect(elimsClass).toBe(qualsClass);
  });
});
