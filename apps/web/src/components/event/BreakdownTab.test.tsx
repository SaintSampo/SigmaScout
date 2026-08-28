/**
 * 07-VALIDATION.md's Wave 0 EVNT-03 test file, authored before the component
 * (07-01-PLAN.md Task 2, TDD). Every fixture is a hand-written
 * `EventArtifact`-shaped object, never a network response.
 *
 * `BreakdownTab`'s team-number/nickname cells are real router `Link`s
 * (mirroring `columns.tsx`'s pattern), so every render needs a router
 * context whose tree carries a `to="/team/$teamNumber"` route — the same
 * self-contained-tree `TestHarness` technique `TeamsTable.test.tsx` already
 * uses.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { BreakdownTab, buildBreakdownRows, type BreakdownRow } from "./BreakdownTab";

type ArtifactTeam = EventArtifact["teams"][number];

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([eventRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/event/2024casf"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

function team(overrides: Partial<ArtifactTeam> = {}): ArtifactTeam {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    metrics: { [TOTAL_KEY]: { value: 48.33, spread: 2.32 } },
    ...overrides,
  };
}

function makeArtifact(teams: ArtifactTeam[], overrides: Partial<EventArtifact> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
    ...overrides,
  });
}

/** A metrics record carrying every sigma1/2024 declared key, so the column-set tests have real data behind every column. */
function fullSigma1Metrics2024(): ArtifactTeam["metrics"] {
  const record: ArtifactTeam["metrics"] = {};
  for (const key of metricKeysFor("sigma1", 2024)) {
    record[key] = { value: 10, spread: 1 };
  }
  return record;
}

function renderBreakdown(artifact: EventArtifact, algorithmId = "sigma1", season = 2024) {
  return render(
    <TestHarness>
      <BreakdownTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </TestHarness>,
  );
}

describe("BreakdownTab — column set (EVNT-03)", () => {
  it("sigma1/2024: exactly Team #, Nickname, thirteen component keys, and Total, in metricKeysFor order — no Rank column", () => {
    const artifact = makeArtifact([team({ metrics: fullSigma1Metrics2024() })]);
    renderBreakdown(artifact, "sigma1", 2024);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    const expected = ["Team #", "Nickname", ...metricKeysFor("sigma1", 2024)];
    // metricLabel maps TOTAL_KEY -> "Total"; every other key renders as itself.
    const expectedLabels = expected.map((key) => (key === TOTAL_KEY ? "Total" : key));
    expect(headers).toEqual(expectedLabels);
    expect(headers).toHaveLength(16);
    expect(screen.queryByRole("columnheader", { name: "Rank" })).toBeNull();
  });

  it("opr/2024: exactly Team #, Nickname, Total — a legitimately narrow table, not a broken wide one", () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 20 } } })], { algorithmId: "opr" });
    renderBreakdown(artifact, "opr", 2024);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Team #", "Nickname", "Total"]);
    expect(headers).toHaveLength(3);
  });

  it("column order is metricKeysFor's own order even when the fixture's metrics object literal declares keys in reverse order", () => {
    const orderedKeys = [...metricKeysFor("sigma1", 2024)];
    const reversedMetrics: ArtifactTeam["metrics"] = {};
    for (const key of [...orderedKeys].reverse()) {
      reversedMetrics[key] = { value: 5 };
    }
    const artifact = makeArtifact([team({ metrics: reversedMetrics })]);
    renderBreakdown(artifact, "sigma1", 2024);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    const expectedLabels = ["Team #", "Nickname", ...orderedKeys.map((key) => (key === TOTAL_KEY ? "Total" : key))];
    expect(headers).toEqual(expectedLabels);
  });
});

describe("BreakdownTab — partial data (EVNT-03)", () => {
  it("a team missing one declared component key renders an em-dash in that cell; the column header for that key stays present", () => {
    const metrics = fullSigma1Metrics2024();
    delete metrics.adjust;
    const artifact = makeArtifact([team({ metrics })]);
    renderBreakdown(artifact, "sigma1", 2024);

    expect(screen.getByTestId("breakdown-header-adjust")).toBeDefined();
    expect(screen.getByTestId("breakdown-cell-adjust").textContent).toBe("—");
  });

  it("a metric published with a value and no spread renders the bare value with no plus-minus suffix", () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 42.5 } } })]);
    renderBreakdown(artifact, "opr", 2024);

    const cell = screen.getByTestId(`breakdown-cell-${TOTAL_KEY}`);
    expect(cell.textContent).toBe("42.50");
    expect(cell.textContent).not.toContain("±");
  });
});

describe("BreakdownTab — tier boundaries (EVNT-03 boundary)", () => {
  function renderWithPercentile(percentile: number | undefined) {
    const metrics: ArtifactTeam["metrics"] = { [TOTAL_KEY]: { value: 10, ...(percentile === undefined ? {} : { percentile }) } };
    const artifact = makeArtifact([team({ metrics })]);
    renderBreakdown(artifact, "opr", 2024);
    return screen.getByTestId(`breakdown-cell-${TOTAL_KEY}`);
  }

  it("percentile 95 renders the legendary tier class", () => {
    expect(renderWithPercentile(95).className).toContain("metric-tier--legendary");
  });

  it("percentile 94.9 renders the epic tier class", () => {
    expect(renderWithPercentile(94.9).className).toContain("metric-tier--epic");
  });

  it("percentile 75 renders the epic tier class", () => {
    expect(renderWithPercentile(75).className).toContain("metric-tier--epic");
  });

  it("percentile 74.9 renders the rare tier class", () => {
    expect(renderWithPercentile(74.9).className).toContain("metric-tier--rare");
  });

  it("percentile 50 renders the rare tier class", () => {
    expect(renderWithPercentile(50).className).toContain("metric-tier--rare");
  });

  it("percentile 49.9 renders no metric-tier class at all", () => {
    expect(renderWithPercentile(49.9).className).not.toContain("metric-tier");
  });

  it("percentile 100 renders the legendary tier class", () => {
    expect(renderWithPercentile(100).className).toContain("metric-tier--legendary");
  });

  it("percentile 101 renders no metric-tier class (out of range)", () => {
    expect(renderWithPercentile(101).className).not.toContain("metric-tier");
  });

  it("percentile -1 renders no metric-tier class (out of range)", () => {
    expect(renderWithPercentile(-1).className).not.toContain("metric-tier");
  });

  it("a metric with no percentile key renders no metric-tier class — the state every team in the live 2024casf artifact is in today", () => {
    expect(renderWithPercentile(undefined).className).not.toContain("metric-tier");
  });
});

describe("BreakdownTab — tier key row and model-estimates caption (D-11)", () => {
  it("TierKeyRow renders exactly once, and the caption renders exactly once naming the selected algorithm and the per-alliance framing", () => {
    const artifact = makeArtifact([team()]);
    renderBreakdown(artifact, "sigma1", 2024);

    expect(screen.getAllByTestId("tier-key-row")).toHaveLength(1);
    const captions = screen.getAllByText(/per alliance, not per team/);
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toContain("Sigma1");
  });
});

describe("BreakdownTab — empty and zero-one-many (EVNT-03 empty)", () => {
  it("an empty teams array renders the EmptyState and no table element", () => {
    const artifact = makeArtifact([]);
    renderBreakdown(artifact);

    expect(screen.getByText("No teams for 2024casf")).toBeDefined();
    expect(document.querySelector("table")).toBeNull();
  });

  it("a one-team artifact renders the same header row and exactly one body row, same table path as a many-team artifact", () => {
    const oneTeamArtifact = makeArtifact([team({ metrics: fullSigma1Metrics2024() })]);
    const { unmount } = renderBreakdown(oneTeamArtifact, "sigma1", 2024);
    const oneTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(screen.getAllByTestId("breakdown-row")).toHaveLength(1);
    unmount();

    const manyTeams = Array.from({ length: 43 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, nickname: `Team ${index + 1}`, metrics: fullSigma1Metrics2024() }),
    );
    const manyTeamsArtifact = makeArtifact(manyTeams);
    renderBreakdown(manyTeamsArtifact, "sigma1", 2024);
    const manyTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(manyTeamHeaders).toEqual(oneTeamHeaders);
    expect(screen.getAllByTestId("breakdown-row")).toHaveLength(43);
  });
});

describe("BreakdownTab — long text (EVNT-03/UI-SPEC E4 long-text)", () => {
  it("a 60-character nickname renders in full inside the cell's title attribute and carries a truncation class", () => {
    const longNickname = "A".repeat(60);
    const artifact = makeArtifact([team({ nickname: longNickname })]);
    renderBreakdown(artifact);

    const cell = screen.getByTestId("breakdown-cell-nickname");
    expect(cell.className).toContain("truncate");
    const link = within(cell).getByTitle(longNickname);
    expect(link.textContent).toBe(longNickname);
  });
});

describe("BreakdownTab — pinning (UI-SPEC E4 overflow, structural half)", () => {
  it("Team # and Nickname header and body cells carry data-pinned=true; every metric column carries data-pinned=false", () => {
    const artifact = makeArtifact([team({ metrics: fullSigma1Metrics2024() })]);
    renderBreakdown(artifact, "sigma1", 2024);

    expect(screen.getByTestId("breakdown-header-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-header-nickname").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-cell-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-cell-nickname").getAttribute("data-pinned")).toBe("true");

    for (const key of metricKeysFor("sigma1", 2024)) {
      expect(screen.getByTestId(`breakdown-header-${key}`).getAttribute("data-pinned")).toBe("false");
      expect(screen.getByTestId(`breakdown-cell-${key}`).getAttribute("data-pinned")).toBe("false");
    }
  });
});

describe("buildBreakdownRows — ordering and tie-break (EVNT-03 ordering/adjacency), independent of rendering", () => {
  it("orders by total descending", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, nickname: "Low", metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, nickname: "High", metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Mid", metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "sigma1");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 3, 1]);
  });

  it("breaks an exact total tie by ascending team number", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, nickname: "Nine", metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { [TOTAL_KEY]: { value: 15 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "sigma1");
    expect(rows.map((row) => row.teamNumber)).toEqual([3, 9]);
  });

  it("returns the same order regardless of the input teams array's own order (deterministic, pure)", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 40 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const rowsA = buildBreakdownRows(makeArtifact(teamsA), "sigma1");
    const rowsB = buildBreakdownRows(makeArtifact(teamsB), "sigma1");
    expect(rowsA.map((row) => row.teamNumber)).toEqual(rowsB.map((row) => row.teamNumber));
    expect(rowsA.map((row) => row.teamNumber)).toEqual([5, 3, 9]);
  });

  it("a row missing the total key sorts last regardless of direction", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: {} }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: -50 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "sigma1");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 1]);
  });

  it("falls back to the team key's digits and a Team {number} nickname when teamNumber/nickname are absent", () => {
    const artifact = makeArtifact([{ teamKey: "frc42", metrics: { [TOTAL_KEY]: { value: 10 } } }]);
    const row = buildBreakdownRows(artifact, "sigma1")[0] as BreakdownRow;
    expect(row.teamNumber).toBe(42);
    expect(row.nickname).toBe("Team 42");
  });
});
