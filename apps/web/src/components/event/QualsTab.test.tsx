import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { afterEach } from "vitest";
import { QualsTab, QUALS_EMPTY_STATE_BODY } from "./QualsTab.js";
import type { EventMatch, EventUpcomingMatch } from "./eventMatchAxis.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * QualsTab.test.tsx (07-12-PLAN.md Task 3) — the D-13 merge, the D-12
 * per-tab domain, the empty state and the sibling-scroll-region structure,
 * as consumed through the actual `QualsTab` component. Fixtures are
 * hand-written `EventArtifact`-shaped objects.
 */

function makePlayedMatch(overrides: Record<string, unknown> = {}): EventMatch {
  return {
    matchKey: "2024casj_qm1",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 250,
    predictedBlueScore: 220,
    actualWinner: "red",
    actualRedScore: 260,
    actualBlueScore: 200,
    ...overrides,
  } as unknown as EventMatch;
}

function makeUpcomingMatch(overrides: Record<string, unknown> = {}): EventUpcomingMatch {
  return {
    matchKey: "2024casj_qm2",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc118"],
    blueTeams: ["frc254"],
    predictedWinner: "red",
    pRedWin: 0.55,
    predictedRedScore: 240,
    predictedBlueScore: 230,
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
    eventKey: "2024casj",
    season: 2024,
    name: "Sacramento Regional",
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as unknown as EventArtifact;
}

afterEach(() => {
  cleanup();
});

describe("Filtering and merging", () => {
  it("an artifact with 3 qm and 4 elim played matches renders exactly 3 body rows, none with elimination match keys", () => {
    const matches = [
      makePlayedMatch({ matchKey: "qm1", compLevel: "qm", matchNumber: 1 }),
      makePlayedMatch({ matchKey: "qm2", compLevel: "qm", matchNumber: 2 }),
      makePlayedMatch({ matchKey: "qm3", compLevel: "qm", matchNumber: 3 }),
      makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "sf2m1", compLevel: "sf", setNumber: 2, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m1", compLevel: "f", setNumber: 1, matchNumber: 1 }),
      makePlayedMatch({ matchKey: "f1m2", compLevel: "f", setNumber: 1, matchNumber: 2 }),
    ];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2024} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(3);
    expect(screen.queryByTestId("match-row-sf1m1")).toBeNull();
  });

  it("2 played + 2 upcoming qm renders 4 rows in merged matchNumber order, interleaved", () => {
    const matches = [makePlayedMatch({ matchKey: "p1", matchNumber: 1 }), makePlayedMatch({ matchKey: "p3", matchNumber: 3 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "u2", matchNumber: 2 }), makeUpcomingMatch({ matchKey: "u4", matchNumber: 4 })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2024} />);
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["match-row-p1", "match-row-u2", "match-row-p3", "match-row-u4"]);
  });

  it("passes matches/upcoming to the merge without mutating either array's contents or order", () => {
    const matches = [makePlayedMatch({ matchKey: "p1", matchNumber: 1 }), makePlayedMatch({ matchKey: "p2", matchNumber: 2 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "u3", matchNumber: 3 })];
    const matchesBefore = JSON.parse(JSON.stringify(matches));
    const upcomingBefore = JSON.parse(JSON.stringify(upcoming));

    renderWithRouter(<QualsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2024} />);

    expect(matches).toEqual(matchesBefore);
    expect(upcoming).toEqual(upcomingBefore);
  });
});

describe("Per-tab domain (D-12)", () => {
  it("axis tick labels span the merged rows' full extent, including an upcoming row's high score", () => {
    const matches = [makePlayedMatch({ matchKey: "p1", predictedRedScore: 100, predictedBlueScore: 100, actualRedScore: 100, actualBlueScore: 100 })];
    const upcoming = [makeUpcomingMatch({ matchKey: "u1", predictedRedScore: 900, predictedBlueScore: 880 })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches, upcoming })} algorithmId="vpr" season={2024} />);
    const ticks = screen.getAllByTestId("axis-tick").map((t) => Number(t.textContent));
    expect(Math.max(...ticks)).toBeGreaterThan(880);
  });

  it("two renders of the same artifact produce identical tick labels", () => {
    const matches = [makePlayedMatch({ matchKey: "p1" })];
    const artifact = makeArtifact({ matches });
    const { unmount } = renderWithRouter(<QualsTab artifact={artifact} algorithmId="vpr" season={2024} />);
    const ticksA = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    unmount();
    renderWithRouter(<QualsTab artifact={artifact} algorithmId="vpr" season={2024} />);
    const ticksB = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    expect(ticksB).toEqual(ticksA);
  });

  it("a second QualsTab from an artifact with much higher scores produces DIFFERENT tick labels", () => {
    const lowArtifact = makeArtifact({ matches: [makePlayedMatch({ matchKey: "p1", predictedRedScore: 100, predictedBlueScore: 100, actualRedScore: 100, actualBlueScore: 100 })] });
    const { unmount } = renderWithRouter(<QualsTab artifact={lowArtifact} algorithmId="vpr" season={2024} />);
    const ticksLow = screen.getAllByTestId("axis-tick").map((t) => t.textContent);
    unmount();

    const highArtifact = makeArtifact({ matches: [makePlayedMatch({ matchKey: "p1", predictedRedScore: 900, predictedBlueScore: 900, actualRedScore: 900, actualBlueScore: 900 })] });
    renderWithRouter(<QualsTab artifact={highArtifact} algorithmId="vpr" season={2024} />);
    const ticksHigh = screen.getAllByTestId("axis-tick").map((t) => t.textContent);

    expect(ticksHigh).not.toEqual(ticksLow);
  });
});

describe("Empty state (EVNT-04 empty, UI-SPEC E5 empty)", () => {
  it("the Einstein shape (matches all sf/f, upcoming empty) renders EmptyState with the event's name, and no table/axis header", () => {
    const matches = [makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf", setNumber: 1, matchNumber: 1 })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches, name: "Championship Finals" })} algorithmId="vpr" season={2024} />);
    expect(screen.getByText("No matches found for Championship Finals")).toBeDefined();
    expect(screen.getByText(QUALS_EMPTY_STATE_BODY)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("axis-ticks")).toBeNull();
  });

  it("the empty state renders no button element at all", () => {
    const matches = [makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf" })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2024} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an artifact with no name field falls back to the event key in the heading", () => {
    const matches = [makePlayedMatch({ matchKey: "sf1m1", compLevel: "sf" })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches, name: undefined, eventKey: "2024casj" })} algorithmId="vpr" season={2024} />);
    expect(screen.getByText("No matches found for 2024casj")).toBeDefined();
  });

  it("the 2025srsd shape (empty matches, 3 upcoming quals) renders the FULL table with 3 rows, not the empty state", () => {
    const upcoming = [1, 2, 3].map((n) => makeUpcomingMatch({ matchKey: `u${n}`, matchNumber: n }));
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches: [], upcoming })} algorithmId="vpr" season={2024} />);
    expect(screen.getAllByTestId(/^match-row-/)).toHaveLength(3);
    expect(screen.queryByText(/No matches found/)).toBeNull();
  });
});

describe("Scroll-region siblinghood (structural half)", () => {
  // 07-UAT.md G-4: this assertion used to pin `touch-pan-x`, which is the
  // defect itself — `touch-action: pan-x` permits ONLY horizontal panning,
  // so a vertical touch gesture starting on this element was never handed to
  // the page's own scroller (a real phone reported "hard to scroll up and
  // down... have to do it very precisely"). Updated to assert `touch-pan-xy`
  // (a custom utility, `apps/web/src/styles/theme.css`, for
  // `touch-action: pan-x pan-y pinch-zoom`), which restores vertical page
  // scroll and pinch-zoom while `overscroll-x-contain` — unchanged, asserted
  // below — keeps horizontal panning trapped inside this scroller.
  it("quals-table-scroll carries overflow-x-auto, touch-pan-xy, overscroll-x-contain and min-w-0", () => {
    const matches = [makePlayedMatch({ matchKey: "p1" })];
    renderWithRouter(<QualsTab artifact={makeArtifact({ matches })} algorithmId="vpr" season={2024} />);
    const scroll = screen.getByTestId("quals-table-scroll");
    for (const cls of ["overflow-x-auto", "touch-pan-xy", "overscroll-x-contain", "min-w-0"]) {
      expect(scroll.className).toContain(cls);
    }
  });
});
