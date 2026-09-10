/**
 * Route-level coverage for `/teams`'s bubble-chart toggle (Task 3,
 * 260909-tom-PLAN.md). Follows `routes/districts.test.tsx`'s pattern
 * exactly: a self-contained route tree built with `Route.update({...})`
 * (mirroring what the auto-generated `routeTree.gen.ts` does at build time),
 * a `QueryClientProvider`, and `global.fetch` stubbed with URL-matched
 * `Response` objects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { applyYearChange, RootSearchSchema, type TeamsSearch } from "../lib/searchParams.js";
import { Route as TeamsRouteImport } from "./teams.js";

/** The algorithms manifest — `useAlgorithmVersion`'s own gate on the artifact fetch firing at all. */
function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-09T00:00:00.000Z",
      algorithms: [{ id: "bpr", version: "2.0.0+tuned-2026-09", codeVersion: "2.0.0", paramSetName: "tuned-2026-09" }],
    }),
    { status: 200 },
  );
}

/**
 * The teams-table artifact. Four rows, per the plan's own fixture spec:
 * frc1 and frc2 both carry a Total and a `swingFactor` (the WIRE field name
 * `buildTeamRows` renames to `swingScore`), in different countries; frc3
 * carries a Total and a published tier but NO `swingFactor`; frc4 carries a
 * Total whose metric has NO `tier`.
 */
function teamsArtifactResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-09T00:00:00.000Z",
      algorithmId: "bpr",
      algorithmVersion: "2.0.0+tuned-2026-09",
      season: 2026,
      teams: [
        {
          teamKey: "frc1",
          teamNumber: 1,
          nickname: "USA Rare",
          eventCount: 3,
          matchCount: 30,
          record: { wins: 20, losses: 10, ties: 0 },
          metrics: { total: { value: 50, tier: "rare" } },
          swingFactor: 3.5,
          country: "USA",
        },
        {
          teamKey: "frc2",
          teamNumber: 2,
          nickname: "Canada Epic",
          eventCount: 2,
          matchCount: 20,
          record: { wins: 12, losses: 8, ties: 0 },
          metrics: { total: { value: 20, tier: "epic" } },
          swingFactor: 1.2,
          country: "Canada",
        },
        {
          teamKey: "frc3",
          teamNumber: 3,
          nickname: "USA Legendary No Swing",
          eventCount: 1,
          matchCount: 1,
          record: { wins: 1, losses: 0, ties: 0 },
          metrics: { total: { value: 80, tier: "legendary" } },
          // No swingFactor -- fewer than two played matches.
          country: "USA",
        },
        {
          teamKey: "frc4",
          teamNumber: 4,
          nickname: "USA Untiered",
          eventCount: 1,
          matchCount: 10,
          record: { wins: 5, losses: 5, ties: 0 },
          metrics: { total: { value: 10 } }, // No tier -> neutral.
          swingFactor: 0.5,
          country: "USA",
        },
      ],
    }),
    { status: 200 },
  );
}

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest")) return Promise.resolve(manifestResponse());
    if (url.includes("/v1/teams/")) return Promise.resolve(teamsArtifactResponse());
    return new Promise<Response>(() => {});
  });
}

function renderTeamsRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamsRoute = TeamsRouteImport.update({
    id: "/teams",
    path: "/teams",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([teamsRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, container };
}

/** Counts every `M` command across every `[data-tone]` path's `d` attribute — the plotted-dot count. */
function countDots(container: HTMLElement): number {
  return Array.from(container.querySelectorAll("[data-tone]")).reduce((sum, el) => {
    const d = el.getAttribute("d") ?? "";
    return sum + (d.match(/M/g) ?? []).length;
  }, 0);
}

describe("/teams route bubble-chart toggle", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("with no ?chart= param, renders the table and not the chart", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=bpr");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
  });

  it("arriving at /teams?chart=bubble renders the chart and not the table, with no click needed", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=bpr&chart=bubble");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    expect(screen.queryByTestId("teams-table-scroll")).toBeNull();
  });

  it("?chart= carrying an unrecognised value resolves to the table", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=bpr&chart=pie");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
  });

  it("clicking the toggle writes chart=bubble into the URL and swaps to the chart; clicking again restores the table", async () => {
    global.fetch = stubFetch();
    const { router } = renderTeamsRoute("/teams?algorithm=bpr");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    const toggle = screen.getByRole("button", { name: "Bubble chart" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).chart).toBe("bubble"));
    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    expect(screen.queryByTestId("teams-table-scroll")).toBeNull();
    const pressedToggle = screen.getByRole("button", { name: "Bubble chart" });
    expect(pressedToggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(pressedToggle);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).chart).toBeUndefined());
    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
    expect(screen.getByRole("button", { name: "Bubble chart" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("with a region filter active, the plotted dot count equals the filtered rows that have both a Total and a Swing Score (D-03)", async () => {
    global.fetch = stubFetch();
    const { container } = renderTeamsRoute("/teams?algorithm=bpr&chart=bubble&country=USA");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    // Filtered to country=USA: frc1, frc3, frc4 (frc2 is Canada). Of those,
    // frc3 has no swingFactor and is omitted -- exactly frc1 and frc4 plot.
    await waitFor(() => expect(countDots(container)).toBe(2));
  });

  it("applyYearChange preserves the chart param across a year change", () => {
    const current: TeamsSearch = {
      year: 2026,
      algorithm: "bpr",
      sort: undefined,
      sortDir: "desc",
      cols: undefined,
      country: undefined,
      state: undefined,
      district: undefined,
      chart: "bubble",
    };
    const next = applyYearChange(current, 2025);
    expect(next.chart).toBe("bubble");
  });
});
