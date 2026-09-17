/**
 * `/methodology/sigma` is a redirect to `/methodology/spr` (sketch 018 folded
 * the Sigma page into "What is SPR?"). The REAL exported `Route` objects of
 * both routes are under test.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { SPR_PAGE_TITLE } from "../components/methodology/sprContent.js";
import { Route as MethodologySigmaRouteImport } from "./methodology.sigma.js";
import { Route as MethodologySprRouteImport } from "./methodology.spr.js";

describe("/methodology/sigma", () => {
  it("redirects to /methodology/spr and renders the What is SPR? page", async () => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const sigmaRoute = MethodologySigmaRouteImport.update({
      id: "/methodology/sigma",
      path: "/methodology/sigma",
      getParentRoute: () => rootRoute,
    } as never);
    const sprRoute = MethodologySprRouteImport.update({
      id: "/methodology/spr",
      path: "/methodology/spr",
      getParentRoute: () => rootRoute,
    } as never);
    const routeTree = rootRoute.addChildren([sigmaRoute, sprRoute]);
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/sigma"] }) });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe("/methodology/spr"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: SPR_PAGE_TITLE })).toBeDefined());
  });
});
