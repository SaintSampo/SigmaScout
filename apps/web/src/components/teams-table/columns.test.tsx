/**
 * Render coverage for the team-number/nickname link cells added by
 * 06-05-PLAN.md Task 3 (E11) — `buildColumns` itself has no unit-level
 * output worth asserting beyond what `TeamsTable.test.tsx` already covers
 * structurally; this file is specifically about the two cells' new anchors.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { TeamsTable } from "./TeamsTable";
import {
  buildColumns,
  METRIC_COLUMN_WIDTH_PX,
  METRIC_COLUMN_WIDTH_SPREADLESS_PX,
  metricColumnWidth,
  MOBILE_PINNED_COLUMN_IDS,
  PINNED_COLUMN_IDS,
  rankColumnAccessibleLabel,
  RANK_COLUMN_WIDTH_NARROW_PX,
  TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX,
  sortableColumnIds,
} from "./columns";
import type { TeamRow } from "./rowModel";

// Same jsdom layout-engine workaround as TeamsTable.test.tsx — see that
// file's own comment for why this is needed for any virtualized row to
// render at all under jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 640 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 960 });
});

function renderWithRouter(children: ReactNode, initialEntry = "/teams") {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamsRoute = createRoute({ path: "/teams", getParentRoute: () => rootRoute, component: () => <>{children}</> });
  const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
  const routeTree = rootRoute.addChildren([teamsRoute, teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  render(<RouterProvider router={router} />);
}

function row(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    record: { wins: 7, losses: 3, ties: 0 },
    winRate: 0.7,
    metrics: { [TOTAL_KEY]: { value: 50, spread: 2 } },
    rank: 1,
    ...overrides,
  };
}

const noop = () => {};

describe("teams-table columns — team-number/nickname links (E11)", () => {
  it("both the team-number and nickname cells render an anchor whose href contains /team/ and the row's team number", async () => {
    renderWithRouter(
      <TeamsTable
        status="success"
        rows={[row({ teamNumber: 254, nickname: "The Cheesy Poofs" })]}
        algorithmId="vpr"
        season={2024}
        view="components"
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(2));
    const links = screen.getAllByRole("link");
    const teamNumberLink = links.find((link) => link.textContent === "254");
    const nicknameLink = links.find((link) => link.textContent === "The Cheesy Poofs");

    expect(teamNumberLink?.getAttribute("href")).toContain("/team/");
    expect(teamNumberLink?.getAttribute("href")).toContain("254");
    expect(nicknameLink?.getAttribute("href")).toContain("/team/");
    expect(nicknameLink?.getAttribute("href")).toContain("254");
  });

  it("the nickname cell's anchor still carries the full nickname in a title attribute and the max-w-full truncation class", async () => {
    const longNickname = "A Very Long Sponsor-Heavy Team Nickname That Should Truncate Visually";
    renderWithRouter(
      <TeamsTable
        status="success"
        rows={[row({ teamNumber: 1114, nickname: longNickname })]}
        algorithmId="vpr"
        season={2024}
        view="components"
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );

    await waitFor(() => expect(screen.getByText(longNickname)).toBeDefined());
    const nicknameLink = screen.getByText(longNickname);
    expect(nicknameLink.getAttribute("title")).toBe(longNickname);
    expect(nicknameLink.className).toContain("max-w-full");
  });

  it("carries the current year and algorithm as search params on both links", async () => {
    renderWithRouter(
      <TeamsTable
        status="success"
        rows={[row({ teamNumber: 1114, nickname: "Simbotics" })]}
        algorithmId="epa"
        season={2023}
        view="components"
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(2));
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href).toContain("year=2023");
      expect(href).toContain("algorithm=epa");
    }
  });
});

describe("buildColumns — D-20's per-algorithm rank header", () => {
  it("Test 1: the leading column header names the selected algorithm, read from algorithmDisplayLabel, never a string literal", () => {
    const columns = buildColumns("vpr", 2024, false);
    const rankColumn = columns[0] as { header: unknown };
    expect(rankColumn.header).toBe(`${algorithmDisplayLabel("vpr")} Rank`);
  });

  it("Test 2: opr, epa and vpr each produce a distinct leading header, all ending in the same trailing word", () => {
    const headers = (["opr", "epa", "vpr"] as const).map((algorithmId) => (buildColumns(algorithmId, 2024, false)[0] as { header: string }).header);
    expect(new Set(headers).size).toBe(3);
    for (const header of headers) {
      expect(header.endsWith("Rank")).toBe(true);
    }
  });

  it("Test 3: nothing else moved — PINNED_COLUMN_IDS still leads with rank, and the rank id is not sortable", () => {
    expect(PINNED_COLUMN_IDS).toEqual(["rank", "teamNumber", "nickname"]);
    expect(sortableColumnIds("vpr", 2024)).not.toContain("rank");
  });
});

// ---------------------------------------------------------------------------
// 07-UAT.md G-2 — narrow-viewport column-size derivation
// ---------------------------------------------------------------------------

describe("buildColumns — G-2's isNarrow column-size switch", () => {
  it("wide (isNarrow=false): rank/teamNumber sizes are UNCHANGED at 96/88 — the wide layout never regresses", () => {
    const columns = buildColumns("vpr", 2024, false) as { id?: string; size: number }[];
    const rank = columns[0]!;
    const teamNumber = columns[1]!;
    expect(rank.size).toBe(96);
    expect(teamNumber.size).toBe(88);
  });

  it("narrow (isNarrow=true): rank/teamNumber shrink to the shared, real-geometry-derived narrow constants", () => {
    const columns = buildColumns("vpr", 2024, true) as { id?: string; size: number }[];
    const rank = columns[0]!;
    const teamNumber = columns[1]!;
    expect(rank.size).toBe(RANK_COLUMN_WIDTH_NARROW_PX);
    expect(teamNumber.size).toBe(TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX);
  });

  it("MOBILE_PINNED_COLUMN_IDS is PINNED_COLUMN_IDS minus nickname, never an independently-typed literal", () => {
    expect(MOBILE_PINNED_COLUMN_IDS).toEqual(["rank", "teamNumber"]);
    expect(PINNED_COLUMN_IDS).toContain("nickname");
    expect(MOBILE_PINNED_COLUMN_IDS).not.toContain("nickname");
  });
});

// ---------------------------------------------------------------------------
// 260902-rax Task 1 — the G-2/D-20 resolution: narrow mode shows the bare
// "Rank" (not the truncated-away half of "VPR Rank"), while the algorithm's
// provenance moves to `rankColumnAccessibleLabel` for `TeamsTable.tsx` to
// hang off the `<th>` as its accessible name. The full render-level
// (visible-text vs accessible-name) assertion lives in `TeamsTable.test.tsx`,
// which can observe the `aria-label`/`title` that only that component adds —
// these tests cover the two pieces `buildColumns`/`columns.tsx` themselves
// own: the VISIBLE header string, and the exported label helper.
// ---------------------------------------------------------------------------
describe("buildColumns — 260902-rax's narrow-mode rank header text", () => {
  it("narrow (isNarrow=true): the VISIBLE header is the bare literal 'Rank', not the algorithm-prefixed string", () => {
    const columns = buildColumns("vpr", 2026, true) as { header: unknown }[];
    expect(columns[0]!.header).toBe("Rank");
  });

  it("wide (isNarrow=false): the VISIBLE header is UNCHANGED — still the full algorithm-derived string", () => {
    const columns = buildColumns("vpr", 2026, false) as { header: unknown }[];
    expect(columns[0]!.header).toBe(`${algorithmDisplayLabel("vpr")} Rank`);
  });

  it("rankColumnAccessibleLabel is the same derivation buildColumns uses for the wide-mode header — one function, not a second hand-typed copy", () => {
    expect(rankColumnAccessibleLabel("vpr")).toBe(`${algorithmDisplayLabel("vpr")} Rank`);
    expect(rankColumnAccessibleLabel("opr")).toBe(`${algorithmDisplayLabel("opr")} Rank`);
    // Distinct algorithms still produce distinct accessible names — D-20's
    // provenance guarantee survives the narrow-mode split.
    expect(rankColumnAccessibleLabel("vpr")).not.toBe(rankColumnAccessibleLabel("opr"));
  });
});

// ---------------------------------------------------------------------------
// D-1 (260904-5zg) — metric column width varies by algorithm at/above the
// breakpoint, so a later edit cannot silently collapse it back to one number.
// ---------------------------------------------------------------------------
describe("metricColumnWidth — D-1 spread-carrying vs spread-less", () => {
  it("VPR (spread-carrying) keeps the original, measured-safe 120px width", () => {
    expect(metricColumnWidth("vpr")).toBe(METRIC_COLUMN_WIDTH_PX);
    expect(metricColumnWidth("vpr")).toBe(120);
  });

  it("EPA and OPR (spread-less) get the smaller, measured width — strictly less than VPR's", () => {
    expect(metricColumnWidth("epa")).toBe(METRIC_COLUMN_WIDTH_SPREADLESS_PX);
    expect(metricColumnWidth("opr")).toBe(METRIC_COLUMN_WIDTH_SPREADLESS_PX);
    expect(metricColumnWidth("epa")).toBeLessThan(metricColumnWidth("vpr"));
  });

  it("buildColumns applies metricColumnWidth at/above the breakpoint, and the pre-existing literal 120 unchanged below it (G-2/G-11)", () => {
    const wideEpa = buildColumns("epa", 2026, false) as { id?: string; size: number }[];
    const wideVpr = buildColumns("vpr", 2026, false) as { id?: string; size: number }[];
    const epaTotal = wideEpa.find((c) => c.id === "total")!;
    const vprTotal = wideVpr.find((c) => c.id === "total")!;
    expect(epaTotal.size).toBe(METRIC_COLUMN_WIDTH_SPREADLESS_PX);
    expect(vprTotal.size).toBe(METRIC_COLUMN_WIDTH_PX);

    const narrowEpa = buildColumns("epa", 2026, true) as { id?: string; size: number }[];
    const narrowTotal = narrowEpa.find((c) => c.id === "total")!;
    expect(narrowTotal.size).toBe(120);
  });
});
