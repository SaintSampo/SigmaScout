/**
 * Route-level coverage for `/team/$teamNumber` (06-01-PLAN.md Tasks 2/3).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/__root.test.tsx` does — `Route.update({...})` mirrors exactly what
 * the auto-generated `routeTree.gen.ts` does at `vite build`/`vite dev`
 * time, so the REAL exported `Route` object from `team.$teamNumber.tsx` is
 * under test, not a re-implementation of it. Depending on the app's own
 * `routeTree.gen.ts` here would make this test's pass/fail depend on
 * whichever build last touched the routes directory (`__root.test.tsx`'s own
 * documented reason for this pattern).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { Route as TeamRouteImport } from "./team.$teamNumber.js";

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [{ id: "sigma1", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }],
    }),
    { status: 200 },
  );
}

function teamArtifactResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithmId: "sigma1",
      algorithmVersion: "2.0.0+tuned-2026-08",
      teamKey: "frc1114",
      teamNumber: 1114,
      nickname: "Simbotics",
      season: 2024,
      seasonStats: { record: { wins: 35, losses: 28, ties: 0 }, metrics: { total: { value: 48.33, spread: 2.32 } } },
      events: [],
      metricHistory: [],
    }),
    { status: 200 },
  );
}

function renderTeamRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamRoute = TeamRouteImport.update({
    id: "/team/$teamNumber",
    path: "/team/$teamNumber",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("/team/$teamNumber route — invalid team number (06-01-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the invalid-team-number message and fires no team artifact fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve(manifestResponse()));
    global.fetch = fetchMock;

    renderTeamRoute("/team/notateam?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByText('"notateam" is not a valid team number.')).toBeDefined());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/v1/team/"))).toBe(false);
  });
});

describe("/team/$teamNumber route — tab shell (06-01-PLAN.md Task 2)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("?tab= absent defaults to the Overview panel", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})); // manifest never resolves — irrelevant to which panel is shown
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByTestId("overview-panel")).toBeDefined());
    expect(screen.queryByTestId("metric-history-panel")).toBeNull();
  });

  it("?tab=history renders the metric-history-panel placeholder", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1&tab=history");

    await waitFor(() => expect(screen.getByTestId("metric-history-panel")).toBeDefined());
  });

  it("both tab triggers are present and clickable before the artifact resolves (E8)", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toBeDefined());
    expect(screen.getByRole("tab", { name: "Metric History" })).toBeDefined();
  });
});

describe("/team/$teamNumber route — states (06-01-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("a mocked 500 artifact response renders the ErrorState with the team number substituted, plus Retry", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByText("Couldn't load team 1114 for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("a mocked 404 artifact response renders the D-19 year-mismatch empty state, not the generic error", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByText("Team 1114 didn't compete in 2024")).toBeDefined());
    expect(screen.queryByText("Couldn't load team 1114 for 2024.")).toBeNull();
  });

  it("the pending state renders at least two event-section skeleton cards and no progressbar", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {}); // team artifact never resolves
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getAllByTestId("event-section-skeleton").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a populated artifact renders the season header and record inside the Overview panel", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(teamArtifactResponse());
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=sigma1");

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Simbotics"));
    expect(screen.getByText("35-28-0")).toBeDefined();
  });
});
