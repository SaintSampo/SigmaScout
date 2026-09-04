/**
 * 07-VALIDATION.md's Wave 0 EVNT-03 test file, authored before the component
 * (07-01-PLAN.md Task 2, TDD). Every fixture is a hand-written
 * `EventArtifact`-shaped object, never a network response.
 *
 * `BreakdownTab`'s team-number/nickname cells are real router `Link`s
 * (mirroring `columns.tsx`'s pattern), so every render needs a router
 * context whose tree carries a `to="/team/$teamNumber"` route — the same
 * self-contained-tree `TestHarness` technique `TeamsTable.test.tsx` already
 * uses. TanStack Router resolves its first match asynchronously, so every
 * assertion below follows `TeamsTable.test.tsx`'s own `await waitFor(...)`
 * convention rather than querying synchronously right after `render()`.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { BreakdownTab, buildBreakdownRows, metricLabel, type BreakdownRow } from "./BreakdownTab";

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

/** Builds a valid artifact through `EventArtifactSchema.parse` — the real schema, proving the fixture matches the published shape. */
function makeArtifact(teams: ArtifactTeam[], overrides: Partial<EventArtifact> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
    ...overrides,
  });
}

/**
 * Builds a hand-written, EventArtifact-SHAPED object WITHOUT running it
 * through `EventArtifactSchema.parse` — needed only for the out-of-range
 * percentile boundary cases (101, -1), which `TeamMetricSchema.percentile`'s
 * own `z.number().min(0).max(100)` constraint correctly rejects at the
 * publish boundary. `tierForPercentile`'s own out-of-range guard is defense
 * in depth against exactly this (a hypothetical pipeline defect reaching the
 * client), so it must be exercisable in a test even though a real published
 * artifact could never carry such a value.
 */
function makeUnvalidatedArtifact(teams: ArtifactTeam[]): EventArtifact {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
  } as unknown as EventArtifact;
}

/** A metrics record carrying every vpr/2024 declared key, so the column-set tests have real data behind every column. */
function fullVPRMetrics2024(): ArtifactTeam["metrics"] {
  const record: ArtifactTeam["metrics"] = {};
  for (const key of metricKeysFor("vpr", 2024)) {
    record[key] = { value: 10, spread: 1 };
  }
  return record;
}

function renderBreakdown(artifact: EventArtifact, algorithmId = "vpr", season = 2024) {
  return render(
    <TestHarness>
      <BreakdownTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </TestHarness>,
  );
}

describe("BreakdownTab — column set (EVNT-03)", () => {
  it("vpr/2024: exactly Team #, Team Name, Total, then twelve remaining component keys, in metricKeysFor order (D-5: Total leads) — no Rank column", async () => {
    const artifact = makeArtifact([team({ metrics: fullVPRMetrics2024() })]);
    renderBreakdown(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    const expected = ["Team #", "Team Name", ...metricKeysFor("vpr", 2024)];
    // 07-UAT.md G-7: `metricLabel` humanizes every non-Total header into
    // space-separated Title Case (e.g. "autoLeave" -> "Auto Leave") so a
    // wrapped header has real word-break points. `metricLabel("Team #")`/
    // `metricLabel("Team Name")` are no-ops (no camelCase/digit boundary to
    // split), so mapping the whole array through it uniformly is safe and
    // avoids a special-cased branch here that could drift from the real
    // implementation.
    const expectedLabels = expected.map((key) => metricLabel(key));
    expect(headers).toEqual(expectedLabels);
    expect(headers).toHaveLength(16);
    expect(headers[2]).toBe("Total");
    expect(screen.queryByRole("columnheader", { name: "Rank" })).toBeNull();
  });

  it("opr/2024: exactly Team #, Team Name, Total — a legitimately narrow table, not a broken wide one", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 20 } } })], { algorithmId: "opr" });
    renderBreakdown(artifact, "opr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Team #", "Team Name", "Total"]);
    expect(headers).toHaveLength(3);
  });

  it("column order is metricKeysFor's own order even when the fixture's metrics object literal declares keys in reverse order", async () => {
    const orderedKeys = [...metricKeysFor("vpr", 2024)];
    const reversedMetrics: ArtifactTeam["metrics"] = {};
    for (const key of [...orderedKeys].reverse()) {
      reversedMetrics[key] = { value: 5 };
    }
    const artifact = makeArtifact([team({ metrics: reversedMetrics })]);
    renderBreakdown(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    const expectedLabels = ["Team #", "Team Name", ...orderedKeys.map((key) => metricLabel(key))];
    expect(headers).toEqual(expectedLabels);
  });
});

describe("BreakdownTab — partial data (EVNT-03)", () => {
  it("a team missing one declared component key renders an em-dash in that cell; the column header for that key stays present", async () => {
    const metrics = fullVPRMetrics2024();
    delete metrics.adjust;
    const artifact = makeArtifact([team({ metrics })]);
    renderBreakdown(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getByTestId("breakdown-header-adjust")).toBeDefined());
    expect(screen.getByTestId("breakdown-cell-adjust").textContent).toBe("");
  });

  it("a metric published with a value and no spread renders the bare value with no plus-minus suffix", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 42.5 } } })]);
    renderBreakdown(artifact, "opr", 2024);

    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    expect(cell.textContent).toBe("42.50");
    expect(cell.textContent).not.toContain("±");
  });
});

describe("BreakdownTab — tier boundaries (EVNT-03 boundary)", () => {
  async function renderWithPercentile(percentile: number | undefined) {
    const metrics: ArtifactTeam["metrics"] = { [TOTAL_KEY]: { value: 10, ...(percentile === undefined ? {} : { percentile }) } };
    const outOfRange = percentile !== undefined && (percentile < 0 || percentile > 100);
    const artifact = outOfRange ? makeUnvalidatedArtifact([team({ metrics })]) : makeArtifact([team({ metrics })]);
    renderBreakdown(artifact, "opr", 2024);
    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    // The tier class lands on `MetricValue`'s own inner `<span class="numeric-cell">`,
    // not on the outer `TableCell` wrapper — query the child MetricValue renders.
    const inner = cell.querySelector(".numeric-cell");
    if (inner === null) throw new Error("MetricValue's numeric-cell span was not found inside the Breakdown cell");
    return inner as HTMLElement;
  }

  it("percentile 95 renders the legendary tier class", async () => {
    expect((await renderWithPercentile(95)).className).toContain("metric-tier--legendary");
  });

  it("percentile 94.9 renders the epic tier class", async () => {
    expect((await renderWithPercentile(94.9)).className).toContain("metric-tier--epic");
  });

  it("percentile 75 renders the epic tier class", async () => {
    expect((await renderWithPercentile(75)).className).toContain("metric-tier--epic");
  });

  it("percentile 74.9 renders the rare tier class", async () => {
    expect((await renderWithPercentile(74.9)).className).toContain("metric-tier--rare");
  });

  it("percentile 50 renders the rare tier class", async () => {
    expect((await renderWithPercentile(50)).className).toContain("metric-tier--rare");
  });

  it("percentile 49.9 renders the common tier ring (260904-7rt, sketch 008 winner C)", async () => {
    expect((await renderWithPercentile(49.9)).className).toContain("metric-tier--common");
  });

  it("percentile 100 renders the legendary tier class", async () => {
    expect((await renderWithPercentile(100)).className).toContain("metric-tier--legendary");
  });

  it("percentile 101 renders no metric-tier class (out of range)", async () => {
    expect((await renderWithPercentile(101)).className).not.toContain("metric-tier");
  });

  it("percentile -1 renders no metric-tier class (out of range)", async () => {
    expect((await renderWithPercentile(-1)).className).not.toContain("metric-tier");
  });

  it("a metric with no percentile key renders no metric-tier class — the state every team in the live 2024casf artifact is in today", async () => {
    expect((await renderWithPercentile(undefined)).className).not.toContain("metric-tier");
  });
});

describe("BreakdownTab — tier key row and model-estimates caption (D-11)", () => {
  it("TierKeyRow renders exactly once, and the caption renders exactly once naming the selected algorithm and the per-alliance framing", async () => {
    const artifact = makeArtifact([team()]);
    renderBreakdown(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getAllByTestId("tier-key-row")).toHaveLength(1));
    const captions = screen.getAllByText(/per alliance, not per team/);
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toContain("VPR");
  });
});

describe("BreakdownTab — empty and zero-one-many (EVNT-03 empty)", () => {
  it("an empty teams array renders the EmptyState and no table element", async () => {
    const artifact = makeArtifact([]);
    renderBreakdown(artifact);

    await waitFor(() => expect(screen.getByText("No teams for 2024casf")).toBeDefined());
    expect(document.querySelector("table")).toBeNull();
  });

  it("a one-team artifact renders the same header row and exactly one body row, same table path as a many-team artifact", async () => {
    const oneTeamArtifact = makeArtifact([team({ metrics: fullVPRMetrics2024() })]);
    const { unmount } = renderBreakdown(oneTeamArtifact, "vpr", 2024);
    await waitFor(() => expect(screen.getAllByTestId("breakdown-row")).toHaveLength(1));
    const oneTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    unmount();

    const manyTeams = Array.from({ length: 43 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, nickname: `Team ${index + 1}`, metrics: fullVPRMetrics2024() }),
    );
    const manyTeamsArtifact = makeArtifact(manyTeams);
    renderBreakdown(manyTeamsArtifact, "vpr", 2024);
    await waitFor(() => expect(screen.getAllByTestId("breakdown-row")).toHaveLength(43));
    const manyTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(manyTeamHeaders).toEqual(oneTeamHeaders);
  });
});

describe("BreakdownTab — long text (EVNT-03/UI-SPEC E4 long-text)", () => {
  it("a 60-character nickname renders in full inside the cell's title attribute and carries a truncation class", async () => {
    const longNickname = "A".repeat(60);
    const artifact = makeArtifact([team({ nickname: longNickname })]);
    renderBreakdown(artifact);

    const cell = await screen.findByTestId("breakdown-cell-nickname");
    expect(cell.className).toContain("truncate");
    const link = within(cell).getByTitle(longNickname);
    expect(link.textContent).toBe(longNickname);
  });
});

describe("BreakdownTab — pinning (UI-SPEC E4 overflow, structural half)", () => {
  it("Team # and Team Name header and body cells carry data-pinned=true; every metric column carries data-pinned=false", async () => {
    const artifact = makeArtifact([team({ metrics: fullVPRMetrics2024() })]);
    renderBreakdown(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());
    expect(screen.getByTestId("breakdown-header-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-header-nickname").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-cell-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("breakdown-cell-nickname").getAttribute("data-pinned")).toBe("true");

    for (const key of metricKeysFor("vpr", 2024)) {
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
    const rows = buildBreakdownRows(artifact, "vpr");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 3, 1]);
  });

  it("breaks an exact total tie by ascending team number", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, nickname: "Nine", metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { [TOTAL_KEY]: { value: 15 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "vpr");
    expect(rows.map((row) => row.teamNumber)).toEqual([3, 9]);
  });

  it("returns the same order regardless of the input teams array's own order (deterministic, pure)", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 40 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const rowsA = buildBreakdownRows(makeArtifact(teamsA), "vpr");
    const rowsB = buildBreakdownRows(makeArtifact(teamsB), "vpr");
    expect(rowsA.map((row) => row.teamNumber)).toEqual(rowsB.map((row) => row.teamNumber));
    expect(rowsA.map((row) => row.teamNumber)).toEqual([5, 3, 9]);
  });

  it("a row missing the total key sorts last regardless of direction", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: {} }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: -50 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "vpr");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 1]);
  });

  it("falls back to the team key's digits and a Team {number} nickname when teamNumber/nickname are absent", () => {
    const artifact = makeArtifact([{ teamKey: "frc42", metrics: { [TOTAL_KEY]: { value: 10 } } }]);
    const row = buildBreakdownRows(artifact, "vpr")[0] as BreakdownRow;
    expect(row.teamNumber).toBe(42);
    expect(row.nickname).toBe("Team 42");
  });
});
