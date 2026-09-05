/**
 * `/compare` redirect coverage (quick task 260905-phf Task 1). Builds a
 * small, self-contained route tree — the REAL exported `Route` object from
 * `compare.tsx` under test, plus a stub `/methodology/compare` target route,
 * matching this repo's established `Route.update({...})` route-test pattern
 * (`methodology.compare.test.tsx`, `districts.test.tsx`).
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { Route as CompareRedirectRouteImport } from "./compare.js";

function renderCompareRedirect(initialPath: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const compareRedirectRoute = CompareRedirectRouteImport.update({
    id: "/compare",
    path: "/compare",
    getParentRoute: () => rootRoute,
  } as never);
  const methodologyCompareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/methodology/compare",
    component: () => <div>Methodology Compare page</div>,
  });
  const routeTree = rootRoute.addChildren([compareRedirectRoute, methodologyCompareRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("/compare redirect", () => {
  it("redirects to /methodology/compare", async () => {
    const router = renderCompareRedirect("/compare");
    await waitFor(() => expect(screen.getByText("Methodology Compare page")).toBeDefined());
    expect(router.state.location.pathname).toBe("/methodology/compare");
  });

  it("carries the current search params through unchanged", async () => {
    const router = renderCompareRedirect("/compare?year=2024&algorithm=vpr");
    await waitFor(() => expect(screen.getByText("Methodology Compare page")).toBeDefined());
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2024);
    expect(search.algorithm).toBe("vpr");
  });

  it("replaces the history entry rather than pushing — a browser Back from the moved page does not bounce through /compare again", async () => {
    const router = renderCompareRedirect("/compare");
    await waitFor(() => expect(screen.getByText("Methodology Compare page")).toBeDefined());
    expect(router.history.length).toBe(1);
  });
});
