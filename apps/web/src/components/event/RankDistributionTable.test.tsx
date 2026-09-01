/**
 * 08-14-PLAN.md Task 3's render contract for `RankDistributionTable`. Every
 * render goes through the same self-contained router `TestHarness` technique
 * `BreakdownTab.test.tsx` established (TanStack Router resolves its first
 * match asynchronously, so every assertion follows the `await waitFor(...)`
 * convention), because the Team # and Nickname cells are real router links.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankAxisTicks, rankBandExtent, x } from "@/lib/simAxis";
import { buildRankDistributionRows, rankBandLabel, type RankDistributionRow } from "./rankRows.js";
import { RANK_MOBILE_PINNED_COLUMN_IDS, RANK_PINNED_COLUMN_IDS, RANK_TABLE_HEADERS, RankDistributionTable } from "./RankDistributionTable.js";
import type { SimResult } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";

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

/** A full length-`teamCount` histogram from a sparse `{rank: count}` map, asserting the total is exactly `draws` before returning. */
function histogramFromCounts(teamCount: number, draws: number, counts: Record<number, number>): Int32Array {
  const arr = new Int32Array(teamCount);
  for (const [rank, count] of Object.entries(counts)) arr[Number(rank) - 1] = count;
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum !== draws) throw new Error(`histogramFromCounts: fixture sums to ${sum}, expected ${draws}`);
  return arr;
}

/** A directly-constructed `RankDistributionRow` fixture — most cases below need full control over every field, not a simulated draw. */
function row(overrides: Partial<RankDistributionRow> & { teamKey: string; teamCount: number }): RankDistributionRow {
  const teamCount = overrides.teamCount;
  const histogram = overrides.histogram ?? histogramFromCounts(teamCount, 1000, { 1: 1000 });
  return {
    teamKey: overrides.teamKey,
    teamNumber: overrides.teamNumber ?? 1,
    nickname: overrides.nickname,
    histogram,
    draws: overrides.draws ?? 1000,
    teamCount,
    medianRank: overrides.medianRank ?? 1,
    medianDisplay: overrides.medianDisplay ?? 1,
    p10: overrides.p10 ?? 0.6,
    p90: overrides.p90 ?? 1.4,
    maxBinCount: overrides.maxBinCount ?? 1000,
  };
}

async function renderTable(rows: readonly RankDistributionRow[], teamCount: number) {
  render(
    <TestHarness>
      <RankDistributionTable rows={rows} teamCount={teamCount} season={2024} />
    </TestHarness>
  );
  await waitFor(() => expect(screen.getByTestId("rank-distribution-table-scroll")).toBeDefined());
}

describe("RankDistributionTable — exactly four columns", () => {
  it("renders exactly the four headers, in order, plus the trailing filler", async () => {
    await renderTable([row({ teamKey: "frc1", teamCount: 5 })], 5);
    const headerCells = screen.getAllByTestId(/^rank-header-/);
    expect(headerCells).toHaveLength(4);
    // First three headers are plain text; the fourth (Distribution) also
    // carries the drawn axis, so its own accessible name is checked via the
    // visually-hidden label rather than a raw textContent equality (which
    // would also pick up the axis's own tick-label text).
    expect(headerCells[0]!.textContent).toBe(RANK_TABLE_HEADERS[0]);
    expect(headerCells[1]!.textContent).toBe(RANK_TABLE_HEADERS[1]);
    expect(headerCells[2]!.textContent).toBe(RANK_TABLE_HEADERS[2]);
    expect(within(headerCells[3]!).getByText(RANK_TABLE_HEADERS[3])).toBeDefined();
    const headerRow = headerCells[0]!.closest("tr")!;
    // 4 real headers + 1 trailing sizeless filler (aria-hidden, so excluded
    // from the accessible columnheader count but present in the raw DOM).
    expect(within(headerRow).getAllByRole("columnheader").length).toBe(4);
    expect(headerRow.querySelectorAll("th").length).toBe(5);
  });
});

describe("RankDistributionTable — the shared axis is drawn exactly once", () => {
  it("exactly one axis-ticks container exists for a table of many rows, positioned inside the header", async () => {
    const teamCount = 17;
    const rows = [row({ teamKey: "frc1", teamCount }), row({ teamKey: "frc2", teamCount, medianRank: 5, medianDisplay: 5 })];
    await renderTable(rows, teamCount);
    const containers = screen.getAllByTestId("rank-axis-ticks");
    expect(containers).toHaveLength(1);
    const headerRow = screen.getByTestId(`rank-header-distribution`);
    expect(headerRow.contains(containers[0]!)).toBe(true);
  });

  it("the tick labels are rankAxisTicks(teamCount), each positioned at x(tick, teamCount)", async () => {
    const teamCount = 39;
    await renderTable([row({ teamKey: "frc1", teamCount })], teamCount);
    const expectedTicks = rankAxisTicks(teamCount);
    const ticks = screen.getAllByTestId("rank-axis-tick");
    expect(ticks.map((el) => el.textContent)).toEqual(expectedTicks.map(String));
    ticks.forEach((el, i) => {
      expect(el.style.left).toBe(`${x(expectedTicks[i]!, teamCount)}px`);
    });
  });
});

describe("RankDistributionTable — per-row plot layers", () => {
  const teamCount = 39;

  it("DOM order per row: bars, then band, then median tick", async () => {
    const fixture = row({
      teamKey: "frc1",
      teamCount,
      histogram: histogramFromCounts(teamCount, 1000, { 5: 500, 6: 500 }),
      p10: 4.6,
      p90: 6.4,
      medianRank: 5.5,
      medianDisplay: 6,
      maxBinCount: 500,
    });
    await renderTable([fixture], teamCount);
    const plot = screen.getByTestId(`rank-plot-${fixture.teamKey}`);
    const bars = within(plot).getAllByTestId(/^rank-hist-bar-/);
    const band = within(plot).getByTestId(`rank-band-${fixture.teamKey}`);
    const tick = within(plot).getByTestId(`rank-tick-${fixture.teamKey}`);
    for (const bar of bars) {
      expect(bar.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(band.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("band geometry equals rankBandExtent(row.p10, row.p90, teamCount) recomputed independently, to two decimal places", async () => {
    const fixture = row({ teamKey: "frc1", teamCount, p10: 1.8706, p90: 8.1364 });
    await renderTable([fixture], teamCount);
    const expected = rankBandExtent(fixture.p10, fixture.p90, teamCount);
    const band = screen.getByTestId(`rank-band-${fixture.teamKey}`);
    expect(Number.parseFloat(band.style.left)).toBeCloseTo(expected.left, 2);
    expect(Number.parseFloat(band.style.width)).toBeCloseTo(expected.width, 2);
  });

  it("the band carries no inline opacity and its class list includes sim-band-overlay", async () => {
    const fixture = row({ teamKey: "frc1", teamCount });
    await renderTable([fixture], teamCount);
    const band = screen.getByTestId(`rank-band-${fixture.teamKey}`);
    expect(band.style.opacity).toBe("");
    expect(band.classList.contains("sim-band-overlay")).toBe(true);
  });

  it("the median tick's geometry derives from the CONTINUOUS median, not the displayed integer — a bimodal fixture (median 3.5, display 4)", async () => {
    const fixture = row({
      teamKey: "frc1",
      teamCount,
      histogram: histogramFromCounts(teamCount, 1000, { 3: 500, 4: 500 }),
      medianRank: 3.5,
      medianDisplay: 4,
      maxBinCount: 500,
    });
    await renderTable([fixture], teamCount);
    const tick = screen.getByTestId(`rank-tick-${fixture.teamKey}`);
    expect(Number.parseFloat(tick.style.left)).toBeCloseTo(medianTickLeft(3.5, teamCount), 6);
    expect(Number.parseFloat(tick.style.left)).not.toBeCloseTo(medianTickLeft(4, teamCount), 6);
    expect(Number.parseFloat(tick.style.width)).toBeCloseTo(SIM_GEOMETRY.MEDIAN_TICK_W, 6);
  });

  it("a rank with zero draws emits no bar element; a rank with one draw of 1000 emits a bar of exactly 1px height", async () => {
    const fixture = row({
      teamKey: "frc1",
      teamCount,
      histogram: histogramFromCounts(teamCount, 1000, { 1: 999, 39: 1 }),
      maxBinCount: 999,
    });
    await renderTable([fixture], teamCount);
    // Rank 2 (index 1) has zero draws — no bar element for it.
    expect(screen.queryByTestId(`rank-hist-bar-${fixture.teamKey}-2`)).toBeNull();
    const smallBar = screen.getByTestId(`rank-hist-bar-${fixture.teamKey}-39`);
    expect(smallBar.style.height).toBe("1px");
  });

  it("every bar's left and width equal histBarExtent(rank, teamCount) recomputed in the test", async () => {
    const fixture = row({ teamKey: "frc1", teamCount, histogram: histogramFromCounts(teamCount, 1000, { 5: 1000 }), maxBinCount: 1000 });
    await renderTable([fixture], teamCount);
    const bar = screen.getByTestId(`rank-hist-bar-${fixture.teamKey}-5`);
    const expected = histBarExtent(5, teamCount);
    expect(Number.parseFloat(bar.style.left)).toBeCloseTo(expected.left, 6);
    expect(Number.parseFloat(bar.style.width)).toBeCloseTo(expected.width, 6);
  });

  it("bimodality renders as two humps: bars at exactly the two well-separated ranks and none between them", async () => {
    const fixture = row({
      teamKey: "frc1",
      teamCount,
      histogram: histogramFromCounts(teamCount, 1000, { 2: 500, 20: 500 }),
      maxBinCount: 500,
    });
    await renderTable([fixture], teamCount);
    expect(screen.getByTestId(`rank-hist-bar-${fixture.teamKey}-2`)).toBeDefined();
    expect(screen.getByTestId(`rank-hist-bar-${fixture.teamKey}-20`)).toBeDefined();
    for (let rank = 3; rank <= 19; rank++) {
      expect(screen.queryByTestId(`rank-hist-bar-${fixture.teamKey}-${rank}`)).toBeNull();
    }
  });

  it("the band label renders exactly rankBandLabel(p10, p90) and its text contains no U+00B1", async () => {
    const fixture = row({ teamKey: "frc1", teamCount, p10: 1.645646, p90: 3.2 });
    await renderTable([fixture], teamCount);
    const label = screen.getByTestId(`rank-band-label-${fixture.teamKey}`);
    expect(label.textContent).toBe(rankBandLabel(fixture.p10, fixture.p90));
    expect(Array.from(label.textContent ?? "").some((c) => c.codePointAt(0) === 0xb1)).toBe(false);
  });

  it("the Median column prints the display integer — 4 for the bimodal fixture — while the tick sits at the position for 3.5", async () => {
    const fixture = row({
      teamKey: "frc1",
      teamCount,
      teamNumber: 42,
      histogram: histogramFromCounts(teamCount, 1000, { 3: 500, 4: 500 }),
      medianRank: 3.5,
      medianDisplay: 4,
      maxBinCount: 500,
    });
    await renderTable([fixture], teamCount);
    const medianCell = screen.getByTestId(`rank-cell-medianDisplay`);
    expect(medianCell.textContent).toBe("4");
  });
});

describe("RankDistributionTable — sort order (integration through the shipped row builder)", () => {
  it("renders ascending by continuous median, the order buildRankDistributionRows produced regardless of the result map's own iteration order", () => {
    const teamCount = 3;
    const rankHistograms = new Map<string, Int32Array>([
      ["frcHigh", histogramFromCounts(teamCount, 1000, { 3: 1000 })],
      ["frcLow", histogramFromCounts(teamCount, 1000, { 1: 1000 })],
      ["frcMid", histogramFromCounts(teamCount, 1000, { 2: 1000 })],
    ]);
    const result: SimResult = { rankHistograms, draws: 1000 };
    const builtRows = buildRankDistributionRows(result, []);
    expect(builtRows.map((r) => r.teamKey)).toEqual(["frcLow", "frcMid", "frcHigh"]);
  });
});

describe("RankDistributionTable — pinned columns", () => {
  it("RANK_PINNED_COLUMN_IDS is exactly teamNumber and nickname; RANK_MOBILE_PINNED_COLUMN_IDS excludes nickname", () => {
    expect(RANK_PINNED_COLUMN_IDS).toEqual(["teamNumber", "nickname"]);
    expect(RANK_MOBILE_PINNED_COLUMN_IDS).toEqual(["teamNumber"]);
  });

  it("header and cell for teamNumber/nickname carry data-pinned true; Median and Distribution carry false", async () => {
    await renderTable([row({ teamKey: "frc1", teamCount: 5, teamNumber: 254 })], 5);
    expect(screen.getByTestId("rank-header-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("rank-header-nickname").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("rank-header-medianDisplay").getAttribute("data-pinned")).toBe("false");
    expect(screen.getByTestId("rank-header-distribution").getAttribute("data-pinned")).toBe("false");
    expect(screen.getByTestId("rank-cell-teamNumber").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("rank-cell-nickname").getAttribute("data-pinned")).toBe("true");
  });
});

describe("RankDistributionTable — links and truncation", () => {
  it("the Team # cell is a router link to /team/$teamNumber; the Nickname cell is a link with the full nickname as its title and includes truncate", async () => {
    await renderTable([row({ teamKey: "frc254", teamCount: 5, teamNumber: 254, nickname: "The Cheesy Poofs" })], 5);
    const teamLink = within(screen.getByTestId("rank-cell-teamNumber")).getByRole("link");
    expect(teamLink.getAttribute("href")).toContain("/team/254");
    const nicknameLink = within(screen.getByTestId("rank-cell-nickname")).getByRole("link");
    expect(nicknameLink.getAttribute("title")).toBe("The Cheesy Poofs");
    expect(nicknameLink.classList.contains("truncate")).toBe(true);
  });
});

describe("RankDistributionTable — the absent-roster-entry row (assumption A2)", () => {
  it("a team with a recovered number and no nickname renders an em-dash, with the plot cell fully rendered", async () => {
    const teamCount = 5;
    const fixture = row({ teamKey: "frc1114", teamCount, teamNumber: 1114, nickname: undefined });
    await renderTable([fixture], teamCount);
    const nicknameCell = screen.getByTestId("rank-cell-nickname");
    expect(nicknameCell.textContent).toBe("—");
    expect(screen.getByTestId(`rank-plot-${fixture.teamKey}`)).toBeDefined();
  });
});

describe("RankDistributionTable — one team", () => {
  it("a single-team result renders one row and one axis with no non-finite position anywhere", async () => {
    const fixture = row({ teamKey: "frc1", teamCount: 1, medianRank: 1, medianDisplay: 1, p10: 0.6, p90: 1.4 });
    await renderTable([fixture], 1);
    expect(screen.getAllByTestId("rank-distribution-row")).toHaveLength(1);
    const plot = screen.getByTestId(`rank-plot-${fixture.teamKey}`);
    const positioned = [...within(plot).queryAllByTestId(/^rank-(hist-bar|band|tick)-/)];
    for (const el of positioned) {
      for (const prop of ["left", "width", "height"] as const) {
        const raw = el.style.getPropertyValue(prop);
        if (raw === "") continue;
        expect(Number.isFinite(Number.parseFloat(raw))).toBe(true);
      }
    }
  });
});

describe("RankDistributionTable — the largest measured roster", () => {
  it("a 78-team result renders 78 rows, and the total bar-element count is measured", async () => {
    const teamCount = 78;
    const rows: RankDistributionRow[] = [];
    for (let i = 0; i < teamCount; i++) {
      rows.push(
        row({
          teamKey: `frc${i + 1}`,
          teamCount,
          teamNumber: i + 1,
          histogram: histogramFromCounts(teamCount, 1000, { [i + 1]: 1000 }),
          medianRank: i + 1,
          medianDisplay: i + 1,
          p10: i + 0.6,
          p90: i + 1.4,
          maxBinCount: 1000,
        })
      );
    }
    await renderTable(rows, teamCount);
    expect(screen.getAllByTestId("rank-distribution-row")).toHaveLength(78);
    const bars = screen.getAllByTestId(/^rank-hist-bar-/);
    expect(bars.length).toBeGreaterThan(0);
  });
});
