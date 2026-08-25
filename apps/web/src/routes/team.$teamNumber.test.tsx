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
import { Route as TeamRouteImport } from "./team.$teamNumber.js";

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
