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
import { buildColumns, PINNED_COLUMN_IDS, sortableColumnIds } from "./columns";
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
    const columns = buildColumns("vpr", 2024);
    const rankColumn = columns[0] as { header: unknown };
    expect(rankColumn.header).toBe(`${algorithmDisplayLabel("vpr")} Rank`);
  });

  it("Test 2: opr, epa and vpr each produce a distinct leading header, all ending in the same trailing word", () => {
    const headers = (["opr", "epa", "vpr"] as const).map((algorithmId) => (buildColumns(algorithmId, 2024)[0] as { header: string }).header);
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
