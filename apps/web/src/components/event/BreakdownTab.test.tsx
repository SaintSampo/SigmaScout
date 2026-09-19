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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { TOTAL_SIGMA_COLUMN_WIDTH_PX, totalColumnHeader } from "@/components/TotalSigmaValue";
import { makeEventArtifact as makeArtifact, mockNarrowViewport } from "@/test/helpers";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import { componentsInGroup } from "../../../../../packages/core/algorithms/breakdown/index.js";
import {
  BreakdownTab,
  BREAKDOWN_METRIC_COLUMN_WIDTH_PX,
  BREAKDOWN_TOTAL_COLUMN_WIDTH_PX,
  BreakdownTabSkeleton,
  buildBreakdownRows,
  metricLabel,
  NO_GROUPS_EXPANDED,
  sortBreakdownRows,
  visibleMetricKeys,
  groupCanExpand,
  type BreakdownRow,
} from "./BreakdownTab";

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

/**
 * A test-local stateful switcher: keeps `BreakdownTab` MOUNTED across an
 * algorithm change (the same `keepPreviousData` remount-free path
 * `routes/event.$eventKey.tsx` gives it in the real app), so the in-place
 * EPA-to-SPR switch test below exercises stale local state carrying over
 * rather than a fresh mount landing on defaults.
 */
function AlgorithmSwitcher({ artifact, season }: { artifact: EventArtifact; season: number }) {
  const [algorithmId, setAlgorithmId] = useState("epa");
  return (
    <>
      <button type="button" data-testid="switch-to-spr" onClick={() => setAlgorithmId("spr")}>
        Switch to SPR
      </button>
      <BreakdownTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </>
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
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
  } as unknown as EventArtifact;
}

/** A metrics record carrying every EPA declared key for `season` — the shape EPA's event artifacts publish. */
function fullEpaMetrics(season: number): ArtifactTeam["metrics"] {
  const record: ArtifactTeam["metrics"] = {};
  for (const key of metricKeysFor("epa", season)) {
    record[key] = { value: 10, spread: 1 };
  }
  return record;
}

function fullEpaMetrics2024(): ArtifactTeam["metrics"] {
  return fullEpaMetrics(2024);
}

/**
 * The season the toggle tests run on: every 2026 group has at least two
 * members, so every group expands. 2024 cannot serve (one member per group,
 * so no toggle renders at all) and 2025 is mixed (its endgame group has one).
 */
const EXPANDABLE_SEASON = 2026;
/** One real member of the expandable season's teleop group: the column the sort tests sort by, then hide. */
const TELEOP_MEMBER = componentsInGroup(EXPANDABLE_SEASON, "teleop")[0]!;
const COLLAPSED_EPA_HEADERS = ["teamNumber", "nickname", TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame", "foulsCommitted"];

/** The per-team metric set SPR's event artifacts publish: Total plus the three published phase columns. Sigma is omitted here — the describe below covers the Total split pill. */
function sprMetrics2024(): ArtifactTeam["metrics"] {
  return {
    [TOTAL_KEY]: { value: 10, spread: 1 },
    phaseAuto: { value: 10, spread: 1 },
    phaseTeleop: { value: 10, spread: 1 },
    phaseEndgame: { value: 10, spread: 1 },
  };
}

function renderBreakdown(artifact: EventArtifact, algorithmId = "spr", season = 2024) {
  return render(
    <TestHarness>
      <BreakdownTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </TestHarness>,
  );
}

/**
 * The DOM-ordered column ids of the LABEL row's header cells
 * (`breakdown-header-*` testids) — the stable way to read the column set now
 * that the grouped header also contains a toggle/spacer band row whose cells
 * carry no column identity.
 */
function headerIds(): string[] {
  return screen.getAllByTestId(/^breakdown-header-/).map((el) => (el.getAttribute("data-testid") as string).replace("breakdown-header-", ""));
}

describe("BreakdownTab — column set (collapsed default per sketch 009-A)", () => {
  it("spr/2024: Team #, Team Name, Total and the three phase columns only, with no group band row and no phase toggles, still sortable", async () => {
    const artifact = makeArtifact([team({ metrics: sprMetrics2024() })]);
    renderBreakdown(artifact, "spr", 2024);

    await waitFor(() => expect(screen.getAllByTestId(/^breakdown-header-/).length).toBeGreaterThan(0));
    expect(headerIds()).toEqual(["teamNumber", "nickname", TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame"]);
    // Same set through the exported derivation the columns are actually built from.
    expect(headerIds()).toEqual(["teamNumber", "nickname", ...visibleMetricKeys("spr", 2024, NO_GROUPS_EXPANDED)]);
    expect(screen.queryByTestId("breakdown-group-row")).toBeNull();
    expect(screen.queryAllByTestId(/^breakdown-group-toggle-/)).toHaveLength(0);
    expect(screen.queryByRole("columnheader", { name: "Rank" })).toBeNull();
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending");
    const phaseAutoHeader = screen.getByTestId("breakdown-header-phaseAuto");
    expect(within(phaseAutoHeader).getByRole("button")).toBeDefined();
    expect(phaseAutoHeader.getAttribute("aria-sort")).toBe("none");
    // Phase headers read through the sitewide label map — "Auto", never the raw "phaseAuto".
    expect(phaseAutoHeader.textContent).toContain(metricLabel("phaseAuto"));
  });

  it("epa/2026 lands collapsed: Team #, Team Name, Total, the three phase columns, then Fouls Committed, with one toggle per phase", async () => {
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics(EXPANDABLE_SEASON) })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", EXPANDABLE_SEASON);

    await waitFor(() => expect(screen.getAllByTestId(/^breakdown-header-/).length).toBeGreaterThan(0));
    expect(headerIds()).toEqual(COLLAPSED_EPA_HEADERS);
    expect(screen.getByTestId("breakdown-group-row")).toBeDefined();
    for (const groupId of ["auto", "teleop", "endgame"]) {
      expect(screen.getByTestId(`breakdown-group-toggle-${groupId}`).getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("epa/2024: every group has ONE member, so there is no band row and no toggle — expanding would swap a column for the identical number", async () => {
    for (const groupId of ["auto", "teleop", "endgame"] as const) expect(groupCanExpand(2024, groupId), groupId).toBe(false);
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics2024() })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", 2024);

    await waitFor(() => expect(screen.getAllByTestId(/^breakdown-header-/).length).toBeGreaterThan(0));
    expect(headerIds()).toEqual(COLLAPSED_EPA_HEADERS);
    expect(screen.queryByTestId("breakdown-group-row")).toBeNull();
    expect(screen.queryAllByTestId(/^breakdown-group-toggle-/)).toHaveLength(0);
    // The phase columns stay sortable without the band row.
    expect(screen.getByTestId("breakdown-header-phaseTeleop").getAttribute("aria-sort")).toBe("none");
  });

  it("epa/2025 is mixed: auto and teleop toggle, the one-member endgame group shows a plain label", async () => {
    expect(groupCanExpand(2025, "endgame")).toBe(false);
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics(2025) })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", 2025);

    await waitFor(() => expect(screen.getByTestId("breakdown-group-row")).toBeDefined());
    expect(screen.getByTestId("breakdown-group-toggle-auto")).toBeDefined();
    expect(screen.getByTestId("breakdown-group-toggle-teleop")).toBeDefined();
    expect(screen.queryByTestId("breakdown-group-toggle-endgame")).toBeNull();
    const label = screen.getByTestId("breakdown-group-label-endgame");
    expect(label.tagName).toBe("SPAN");
    expect(within(label.parentElement!).queryByRole("button")).toBeNull();
  });

  it("opr/2024: exactly Team #, Team Name, Total — no group row, no sort affordance; OPR is deliberately unchanged", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 20 } } })], { algorithmId: "opr" });
    renderBreakdown(artifact, "opr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Team #", "Team Name", "Total"]);
    expect(headers).toHaveLength(3);
    expect(screen.queryByTestId("breakdown-group-row")).toBeNull();
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBeNull();
  });

  it("clicking a phase toggle swaps that phase's column for its component columns in place; clicking again collapses it back", async () => {
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics(EXPANDABLE_SEASON) })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", EXPANDABLE_SEASON);

    const toggle = await screen.findByTestId("breakdown-group-toggle-teleop");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByTestId("breakdown-group-toggle-teleop").getAttribute("aria-expanded")).toBe("true"));
    expect(headerIds()).toEqual([
      "teamNumber",
      "nickname",
      TOTAL_KEY,
      "phaseAuto",
      // The group's own column gives way to its member columns, in the
      // group's declared order.
      ...componentsInGroup(EXPANDABLE_SEASON, "teleop"),
      "phaseEndgame",
      "foulsCommitted",
    ]);

    fireEvent.click(screen.getByTestId("breakdown-group-toggle-teleop"));
    await waitFor(() => expect(headerIds()).toEqual(COLLAPSED_EPA_HEADERS));
  });

  it("the visible column set is visibleMetricKeys' own order even when the fixture's metrics object literal declares keys in reverse order", async () => {
    const reversedMetrics: ArtifactTeam["metrics"] = {};
    for (const key of [...metricKeysFor("spr", 2024)].reverse()) {
      reversedMetrics[key] = { value: 5 };
    }
    const artifact = makeArtifact([team({ metrics: reversedMetrics })]);
    renderBreakdown(artifact, "spr", 2024);

    await waitFor(() => expect(screen.getAllByTestId(/^breakdown-header-/).length).toBeGreaterThan(0));
    expect(headerIds()).toEqual(["teamNumber", "nickname", ...visibleMetricKeys("spr", 2024, NO_GROUPS_EXPANDED)]);
  });
});

describe("visibleMetricKeys: three shapes (unit)", () => {
  it("spr returns Total plus the three phase columns regardless of expansion state or season", () => {
    const fourKeys = [TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame"];
    expect(visibleMetricKeys("spr", 2024, { auto: true, teleop: true, endgame: true })).toEqual(fourKeys);
    expect(visibleMetricKeys("spr", 2026, { auto: true, teleop: true, endgame: true })).toEqual(fourKeys);
    expect(visibleMetricKeys("spr", 2026, NO_GROUPS_EXPANDED)).toEqual(fourKeys);
  });

  it("opr returns Total alone", () => {
    expect(visibleMetricKeys("opr", 2024, { auto: true, teleop: true, endgame: true })).toEqual([TOTAL_KEY]);
  });

  it("epa collapsed returns Total, the three phase columns, then Fouls Committed", () => {
    expect(visibleMetricKeys("epa", 2024, NO_GROUPS_EXPANDED)).toEqual([TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame", "foulsCommitted"]);
  });
});

describe("BreakdownTab — partial data", () => {
  it("a team missing one declared component key renders a blank cell once its group is expanded; the column header for that key stays present", async () => {
    const missing = componentsInGroup(EXPANDABLE_SEASON, "endgame")[0]!;
    const metrics = fullEpaMetrics(EXPANDABLE_SEASON);
    delete metrics[missing];
    const artifact = makeArtifact([team({ metrics })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", EXPANDABLE_SEASON);

    fireEvent.click(await screen.findByTestId("breakdown-group-toggle-endgame"));
    await waitFor(() => expect(screen.getByTestId(`breakdown-header-${missing}`)).toBeDefined());
    expect(screen.getByTestId(`breakdown-cell-${missing}`).textContent).toBe("");
  });

  it("a metric published with a value and no spread renders the bare value with no plus-minus suffix", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 42.5 } } })]);
    renderBreakdown(artifact, "opr", 2024);

    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    expect(cell.textContent).toBe("42.50");
    expect(cell.textContent).not.toContain("±");
  });
});

describe("BreakdownTab — tier boundaries", () => {
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

  it("percentile 49.9 renders the common tier ring (sketch 008 winner C)", async () => {
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

describe("BreakdownTab — tier key row and model-estimates caption", () => {
  it("TierKeyRow renders exactly once, and the caption renders exactly once naming the selected algorithm and the per-alliance framing", async () => {
    const artifact = makeArtifact([team()]);
    renderBreakdown(artifact, "spr", 2024);

    await waitFor(() => expect(screen.getAllByTestId("tier-key-row")).toHaveLength(1));
    const captions = screen.getAllByText(/per alliance, not per team/);
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toContain("SPR");
  });

  // The key row's own Common swatch must draw the same ring every Common
  // cell in the table draws, or the key and the cells it explains could
  // disagree.
  it("TierKeyRow's Common swatch carries the common tier ring, same as every other band", async () => {
    const artifact = makeArtifact([team()]);
    renderBreakdown(artifact, "spr", 2024);

    const keyRow = await screen.findByTestId("tier-key-row");
    expect(keyRow.querySelector(".metric-tier--common")).not.toBeNull();
    expect(keyRow.querySelector(".metric-tier--rare")).not.toBeNull();
    expect(keyRow.querySelector(".metric-tier--epic")).not.toBeNull();
    expect(keyRow.querySelector(".metric-tier--legendary")).not.toBeNull();
  });
});

describe("BreakdownTab — empty and zero-one-many", () => {
  it("an empty teams array renders the EmptyState and no table element", async () => {
    const artifact = makeArtifact([]);
    renderBreakdown(artifact);

    await waitFor(() => expect(screen.getByText("No teams for 2024casf")).toBeDefined());
    expect(document.querySelector("table")).toBeNull();
  });

  it("a one-team artifact renders the same header row and exactly one body row, same table path as a many-team artifact", async () => {
    const oneTeamArtifact = makeArtifact([team({ metrics: fullEpaMetrics2024() })]);
    const { unmount } = renderBreakdown(oneTeamArtifact, "spr", 2024);
    await waitFor(() => expect(screen.getAllByTestId("breakdown-row")).toHaveLength(1));
    const oneTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    unmount();

    const manyTeams = Array.from({ length: 43 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, nickname: `Team ${index + 1}`, metrics: fullEpaMetrics2024() }),
    );
    const manyTeamsArtifact = makeArtifact(manyTeams);
    renderBreakdown(manyTeamsArtifact, "spr", 2024);
    await waitFor(() => expect(screen.getAllByTestId("breakdown-row")).toHaveLength(43));
    const manyTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(manyTeamHeaders).toEqual(oneTeamHeaders);
  });
});

describe("BreakdownTab — long text", () => {
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

describe("BreakdownTab — no sticky columns", () => {
  function assertNoStickyColumns() {
    const region = screen.getByTestId("breakdown-table-scroll");
    const cells = within(region).getByRole("table").querySelectorAll("th, td");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect((cell as HTMLElement).style.position).not.toBe("sticky");
      expect((cell as HTMLElement).style.left).toBe("");
      expect(cell.getAttribute("data-pinned")).toBeNull();
    }

    expect(screen.getByTestId("breakdown-header-teamNumber").getAttribute("aria-sort")).toBeNull();
    expect(screen.getByTestId("breakdown-header-nickname").getAttribute("aria-sort")).toBeNull();
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).not.toBeNull();
  }

  it("wide layout: no sticky column anywhere, including the group-band row's leading spacer cells", async () => {
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics2024() })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", 2024);
    await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());
    assertNoStickyColumns();
  });

  it("narrow layout: no sticky column anywhere, including the group-band row's leading spacer cells", async () => {
    const restoreMatchMedia = mockNarrowViewport();
    try {
      const artifact = makeArtifact([team({ metrics: fullEpaMetrics2024() })], { algorithmId: "epa" });
      renderBreakdown(artifact, "epa", 2024);
      await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());
      assertNoStickyColumns();
    } finally {
      restoreMatchMedia();
    }
  });
});

describe("BreakdownTab — derived phase fallback (stale cache shape)", () => {
  it("a row with components but no published phase entries renders an honest value-only phase cell: summed value, no ±, no tier box", async () => {
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics2024() })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", 2024);

    const cell = await screen.findByTestId("breakdown-cell-phaseAuto");
    // 2024's `auto` group holds the single collapsed `auto` component, at
    // 10 in the fixture.
    expect(cell.textContent).toBe("10.00");
    expect(cell.querySelector(".metric-tier")).toBeNull();
  });

  it("a published phase entry wins over the derived sum and keeps its tier, and never renders its spread", async () => {
    const metrics = fullEpaMetrics2024();
    metrics.phaseAuto = { value: 28.5, spread: 2.1, percentile: 80 };
    const artifact = makeArtifact([team({ metrics })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", 2024);

    const cell = await screen.findByTestId("breakdown-cell-phaseAuto");
    expect(cell.textContent).toContain("28.50");
    expect(cell.textContent).not.toContain("±");
    expect(cell.querySelector(".metric-tier--epic")).not.toBeNull();
  });
});

describe("BreakdownTab — sorting (sketch 009-B folded in)", () => {
  function rowNumbers(): number[] {
    return screen.getAllByTestId("breakdown-row").map((el) => Number(el.getAttribute("data-team-number")));
  }

  function makeSortableArtifact() {
    return makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, nickname: "One", metrics: { [TOTAL_KEY]: { value: 30 }, phaseAuto: { value: 5 } } }),
      team({ teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: { [TOTAL_KEY]: { value: 20 }, phaseAuto: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { [TOTAL_KEY]: { value: 10 }, phaseAuto: { value: 10 } } }),
    ]);
  }

  it("lands sorted by Total descending, with aria-sort=descending on the Total header", async () => {
    renderBreakdown(makeSortableArtifact(), "spr", 2024);
    await waitFor(() => expect(rowNumbers()).toEqual([1, 2, 3]));
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending");
  });

  it("clicking another metric header sorts by it descending; clicking it again flips to ascending", async () => {
    renderBreakdown(makeSortableArtifact(), "spr", 2024);
    const header = await screen.findByTestId("breakdown-header-phaseAuto");
    fireEvent.click(within(header).getByRole("button"));

    await waitFor(() => expect(rowNumbers()).toEqual([2, 3, 1]));
    expect(screen.getByTestId("breakdown-header-phaseAuto").getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(within(screen.getByTestId("breakdown-header-phaseAuto")).getByRole("button"));
    await waitFor(() => expect(rowNumbers()).toEqual([1, 3, 2]));
    expect(screen.getByTestId("breakdown-header-phaseAuto").getAttribute("aria-sort")).toBe("ascending");
  });

  it("collapsing the group that owns the active sort key resets the sort to Total descending", async () => {
    const artifact = makeArtifact(
      [
        team({ teamKey: "frc1", teamNumber: 1, nickname: "One", metrics: { [TOTAL_KEY]: { value: 30 }, [TELEOP_MEMBER]: { value: 1 } } }),
        team({ teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: { [TOTAL_KEY]: { value: 20 }, [TELEOP_MEMBER]: { value: 9 } } }),
      ],
      { algorithmId: "epa" },
    );
    renderBreakdown(artifact, "epa", EXPANDABLE_SEASON);

    fireEvent.click(await screen.findByTestId("breakdown-group-toggle-teleop"));
    const header = await screen.findByTestId(`breakdown-header-${TELEOP_MEMBER}`);
    fireEvent.click(within(header).getByRole("button"));
    await waitFor(() => expect(rowNumbers()).toEqual([2, 1]));

    fireEvent.click(screen.getByTestId("breakdown-group-toggle-teleop"));
    await waitFor(() => expect(rowNumbers()).toEqual([1, 2]));
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending");
  });
});

describe("sortBreakdownRows — the three rowModel rules generalized to any key (unit)", () => {
  const rows: BreakdownRow[] = [
    { teamKey: "frc1", teamNumber: 1, nickname: "One", metrics: { hubAuto: { value: 5 } } },
    { teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: {} },
    { teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { hubAuto: { value: 9 } } },
  ];

  it("a row missing the sorted key sorts last in BOTH directions", () => {
    expect(sortBreakdownRows(rows, { key: "hubAuto", dir: "desc" }).map((row) => row.teamNumber)).toEqual([3, 1, 2]);
    expect(sortBreakdownRows(rows, { key: "hubAuto", dir: "asc" }).map((row) => row.teamNumber)).toEqual([1, 3, 2]);
  });

  it("exact ties break by ascending team number, and the input array is never mutated", () => {
    const tied: BreakdownRow[] = [
      { teamKey: "frc9", teamNumber: 9, nickname: "Nine", metrics: { hubAuto: { value: 5 } } },
      { teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { hubAuto: { value: 5 } } },
    ];
    const sorted = sortBreakdownRows(tied, { key: "hubAuto", dir: "desc" });
    expect(sorted.map((row) => row.teamNumber)).toEqual([3, 9]);
    expect(tied.map((row) => row.teamNumber)).toEqual([9, 3]);
  });
});

describe("buildBreakdownRows — ordering and tie-break, independent of rendering", () => {
  it("orders by total descending", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, nickname: "Low", metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, nickname: "High", metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Mid", metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "spr");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 3, 1]);
  });

  it("breaks an exact total tie by ascending team number", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, nickname: "Nine", metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Three", metrics: { [TOTAL_KEY]: { value: 15 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "spr");
    expect(rows.map((row) => row.teamNumber)).toEqual([3, 9]);
  });

  it("returns the same order regardless of the input teams array's own order (deterministic, pure)", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 40 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const rowsA = buildBreakdownRows(makeArtifact(teamsA), "spr");
    const rowsB = buildBreakdownRows(makeArtifact(teamsB), "spr");
    expect(rowsA.map((row) => row.teamNumber)).toEqual(rowsB.map((row) => row.teamNumber));
    expect(rowsA.map((row) => row.teamNumber)).toEqual([5, 3, 9]);
  });

  it("a row missing the total key sorts last regardless of direction", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: {} }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: -50 } } }),
    ]);
    const rows = buildBreakdownRows(artifact, "spr");
    expect(rows.map((row) => row.teamNumber)).toEqual([2, 1]);
  });

  it("falls back to the team key's digits and a Team {number} nickname when teamNumber/nickname are absent", () => {
    const artifact = makeArtifact([{ teamKey: "frc42", metrics: { [TOTAL_KEY]: { value: 10 } } }]);
    const row = buildBreakdownRows(artifact, "spr")[0] as BreakdownRow;
    expect(row.teamNumber).toBe(42);
    expect(row.nickname).toBe("Team 42");
  });
});

describe("BreakdownTab — Total renders the split pill under Sigma-enabled algorithms", () => {
  it("spr with a published sigma entry: the Total header reads 'Total ± Sigma', and the Total cell renders the pill", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 60.5, percentile: 90 }, [SIGMA_METRIC_KEY]: { value: 8.42, percentile: 97 } } })]);
    renderBreakdown(artifact, "spr", 2024);

    await waitFor(() => expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`)).toBeDefined());
    // Total is the DEFAULT sort column (`DEFAULT_BREAKDOWN_SORT`), so its
    // header button also renders the active sort's accent arrow glyph —
    // `toContain`, not `toBe`, the same way this file's other header-text
    // assertions (e.g. "Auto" on `phaseAuto`) already read.
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).textContent).toContain(totalColumnHeader("spr"));
    expect(totalColumnHeader("spr")).toBe("Total ± Sigma");

    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    const pill = cell.querySelector('[data-testid="total-sigma-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain("60.50");
    expect(pill?.textContent).toContain("±8.42");
    expect(pill?.querySelector(".metric-tier--legendary")).not.toBeNull();

    // Component columns stay single tier-boxed values, never a pill.
    expect(screen.queryByTestId("breakdown-cell-phaseAuto")?.querySelector('[data-testid="total-sigma-pill"]')).toBeFalsy();
  });

  it("spr with no sigma entry for this team: the Total cell renders one plain tier-boxed value, no pill", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 60.5, percentile: 90 } } })]);
    renderBreakdown(artifact, "spr", 2024);

    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    expect(cell.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
    expect(cell.textContent).toContain("60.50");
  });

  it("opr: the Total header stays 'Total' and the Total cell never renders a pill, sigma entry or not", async () => {
    const artifact = makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 42.5 } } })], { algorithmId: "opr" });
    renderBreakdown(artifact, "opr", 2024);

    // opr is not grouped (`hasGroupedTeamsView`), so Total is not a sort
    // button and carries no accent arrow — an exact match is correct here.
    await waitFor(() => expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).textContent).toBe("Total"));
    const cell = await screen.findByTestId(`breakdown-cell-${TOTAL_KEY}`);
    expect(cell.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
    expect(cell.textContent).toBe("42.50");
  });

  it("sorting by Total gives the same row order whether or not the artifact carries a sigma entry", () => {
    const withSigma = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 }, [SIGMA_METRIC_KEY]: { value: 3 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 }, [SIGMA_METRIC_KEY]: { value: 5 } } }),
    ]);
    const withoutSigma = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 } } }),
    ]);
    expect(buildBreakdownRows(withSigma, "spr").map((row) => row.teamNumber)).toEqual(
      buildBreakdownRows(withoutSigma, "spr").map((row) => row.teamNumber),
    );
  });
});

describe("BreakdownTab: clean SPR table", () => {
  function rowTeamNumbers(): number[] {
    return screen.getAllByTestId("breakdown-row").map((el) => Number(el.getAttribute("data-team-number")));
  }

  it("spr desktop geometry: label row leads, six header cells, no spacer cells, table width equals the six column widths summed", async () => {
    const artifact = makeArtifact([team({ metrics: sprMetrics2024() })]);
    renderBreakdown(artifact, "spr", 2024);
    await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());

    const theadRows = document.querySelectorAll("thead tr");
    expect(theadRows[0]?.querySelector("th")?.getAttribute("data-testid")).toBe("breakdown-header-teamNumber");

    const headerCells = document.querySelectorAll("thead th");
    expect(headerCells.length).toBe(6);

    const totalHeader = screen.getByTestId(`breakdown-header-${TOTAL_KEY}`);
    expect(totalHeader.style.width).toBe(`${TOTAL_SIGMA_COLUMN_WIDTH_PX}px`);
    for (const key of ["phaseAuto", "phaseTeleop", "phaseEndgame"]) {
      expect(screen.getByTestId(`breakdown-header-${key}`).style.width).toBe(`${BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px`);
    }

    const table = document.querySelector("table");
    if (table === null) throw new Error("no table element rendered");
    const summedWidth = [...headerCells].reduce((sum, cell) => sum + Number.parseFloat((cell as HTMLElement).style.width), 0);
    expect(table.style.width).toBe(`${summedWidth}px`);
    expect(table.style.width).toBe(`${88 + 220 + TOTAL_SIGMA_COLUMN_WIDTH_PX + 3 * BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px`);
  });

  it("desktop header labels share one box: Team # and Team Name sit in the same 44px centered box the sort buttons use, so every label in the row lines up (spr and epa); opr has no sort buttons and keeps bare labels", async () => {
    // With SPR's band row gone the label row is the table's top edge, and
    // the bare, top-aligned identity labels sat about 14px above the sort
    // buttons' centered text.
    const boxClasses = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/).filter((c) => c === "tap-target" || c === "inline-flex" || c === "items-center");
    for (const [algorithmId, metrics] of [
      ["spr", sprMetrics2024()],
      ["epa", fullEpaMetrics2024()],
    ] as const) {
      const { unmount } = renderBreakdown(makeArtifact([team({ metrics })], { algorithmId }), algorithmId, 2024);
      await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());
      const sortBoxClasses = boxClasses(within(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`)).getByRole("button"));
      expect(sortBoxClasses).toEqual(["tap-target", "inline-flex", "items-center"]);
      for (const id of ["teamNumber", "nickname"]) {
        const header = screen.getByTestId(`breakdown-header-${id}`);
        expect(within(header).queryByRole("button")).toBeNull();
        expect(boxClasses(header.firstElementChild)).toEqual(sortBoxClasses);
      }
      unmount();
    }

    renderBreakdown(makeArtifact([team({ metrics: { [TOTAL_KEY]: { value: 20 } } })], { algorithmId: "opr" }), "opr", 2024);
    await waitFor(() => expect(screen.getByTestId("breakdown-header-teamNumber")).toBeDefined());
    expect(screen.getByTestId("breakdown-header-teamNumber").firstElementChild).toBeNull();
  });

  it("epa desktop geometry regression pin: the group-band row leads, and the declared width still spans Total plus the three phases plus Fouls Committed", async () => {
    const artifact = makeArtifact([team({ metrics: fullEpaMetrics(EXPANDABLE_SEASON) })], { algorithmId: "epa" });
    renderBreakdown(artifact, "epa", EXPANDABLE_SEASON);
    await waitFor(() => expect(screen.getByTestId("breakdown-group-row")).toBeDefined());

    const theadRows = document.querySelectorAll("thead tr");
    expect(theadRows[0]?.getAttribute("data-testid")).toBe("breakdown-group-row");

    const table = document.querySelector("table");
    if (table === null) throw new Error("no table element rendered");
    expect(table.style.width).toBe(`${88 + 220 + BREAKDOWN_TOTAL_COLUMN_WIDTH_PX + 4 * BREAKDOWN_METRIC_COLUMN_WIDTH_PX}px`);
  });

  it("an in-place EPA-to-SPR switch never leaves the table sorted by a column SPR no longer shows", async () => {
    const artifact = makeArtifact(
      [
        team({ teamKey: "frc1", teamNumber: 1, nickname: "One", metrics: { [TOTAL_KEY]: { value: 30 }, [TELEOP_MEMBER]: { value: 1 } } }),
        team({ teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: { [TOTAL_KEY]: { value: 20 }, [TELEOP_MEMBER]: { value: 9 } } }),
      ],
      { algorithmId: "epa" },
    );

    render(
      <TestHarness>
        <AlgorithmSwitcher artifact={artifact} season={EXPANDABLE_SEASON} />
      </TestHarness>,
    );

    fireEvent.click(await screen.findByTestId("breakdown-group-toggle-teleop"));
    const teleopHeader = await screen.findByTestId(`breakdown-header-${TELEOP_MEMBER}`);
    fireEvent.click(within(teleopHeader).getByRole("button"));
    await waitFor(() => expect(rowTeamNumbers()).toEqual([2, 1]));

    fireEvent.click(screen.getByTestId("switch-to-spr"));

    await waitFor(() => expect(headerIds()).toEqual(["teamNumber", "nickname", TOTAL_KEY, "phaseAuto", "phaseTeleop", "phaseEndgame"]));
    expect(screen.queryByTestId("breakdown-group-row")).toBeNull();
    expect(rowTeamNumbers()).toEqual([1, 2]);
    expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(within(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`)).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId(`breakdown-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("ascending"));
  });

  it("spr skeleton headers match the populated SPR table's headers", async () => {
    render(<BreakdownTabSkeleton algorithmId="spr" season={2024} />);
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Team #", "Team Name", totalColumnHeader("spr"), metricLabel("phaseAuto"), metricLabel("phaseTeleop"), metricLabel("phaseEndgame")]);
  });

  it("epa skeleton headers match the populated EPA table's headers", async () => {
    render(<BreakdownTabSkeleton algorithmId="epa" season={2024} />);
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual([
      "Team #",
      "Team Name",
      totalColumnHeader("epa"),
      metricLabel("phaseAuto"),
      metricLabel("phaseTeleop"),
      metricLabel("phaseEndgame"),
      metricLabel("foulsCommitted"),
    ]);
  });
});
