import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { DistrictsSearchSchema, RootSearchSchema, TeamsSearchSchema } from "@/lib/searchParams";
import { Ribbon } from "./Ribbon.js";

/**
 * Regression guard: the ribbon's nav links carry only the site-wide params
 * (year, algorithm). Selecting a district on the Locks page used to leak
 * `?district=` into the Teams page's same-named district filter on the next
 * Teams click. Same minimal route-tree approach as `Ribbon.test.tsx`.
 */
function buildTestRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    validateSearch: RootSearchSchema,
    component: () => (
      <div>
        <Ribbon />
        <Outlet />
      </div>
    ),
  });
  const teamsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/teams", validateSearch: TeamsSearchSchema, component: () => <div>Teams page</div> });
  const eventsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/events", component: () => <div>Events page</div> });
  const methodologyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/methodology", component: () => <div>Methodology page</div> });
  const districtsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/districts", validateSearch: DistrictsSearchSchema, component: () => <div>Districts page</div> });
  const routeTree = rootRoute.addChildren([teamsRoute, eventsRoute, methodologyRoute, districtsRoute]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

async function renderRibbonAt(initialPath: string) {
  const router = buildTestRouter(initialPath);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(router.state.status).toBe("idle"));
  return router;
}

describe("Ribbon nav links — search params", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("Locks -> Teams keeps year and algorithm but drops the Locks page's district and tab", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const router = await renderRibbonAt("/districts?year=2024&algorithm=epa&district=2024fnc&tab=champ-locks");

    fireEvent.click(screen.getByRole("link", { name: "Teams" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2024);
    expect(search.algorithm).toBe("epa");
    expect(search.district).toBeUndefined();
    expect(search.tab).toBeUndefined();
  });

  it("Teams -> Locks drops the Teams filters and sort, so no district is pre-selected", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const router = await renderRibbonAt("/teams?year=2024&algorithm=spr&district=2024fnc&country=USA&sort=total&sortDir=asc");

    fireEvent.click(screen.getByRole("link", { name: "Locks" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/districts"));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2024);
    expect(search.algorithm).toBe("spr");
    expect(search.district).toBeUndefined();
    expect(search.country).toBeUndefined();
    expect(search.sort).toBeUndefined();
  });
});
