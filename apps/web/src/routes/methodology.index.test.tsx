/**
 * Route-level coverage for `/methodology`'s hub index (quick task 260905-phf
 * Task 1). Builds a small, self-contained route tree the same way
 * `districts.test.tsx`/`methodology.compare.test.tsx` do — the REAL exported
 * `Route` object from `methodology.index.tsx` is under test.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { METHODOLOGY_CARDS } from "../components/methodology/methodologyCardData.js";
import { Route as MethodologyIndexRouteImport } from "./methodology.index.js";

async function renderMethodologyIndex() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologyIndexRoute = MethodologyIndexRouteImport.update({
    id: "/methodology/",
    path: "/methodology/",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologyIndexRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology hub index", () => {
  it("renders the Methodology heading", async () => {
    await renderMethodologyIndex();
    expect(screen.getByRole("heading", { name: "Methodology" })).toBeDefined();
  });

  // Iterates the exported constant — never a hand-typed second copy of the
  // titles, per this task's own instruction.
  for (const card of METHODOLOGY_CARDS) {
    it(`renders a "${card.title}" card linking to ${card.to}`, async () => {
      await renderMethodologyIndex();
      const link = screen.getByRole("link", { name: new RegExp(card.title) });
      const href = link.getAttribute("href") ?? "";
      // Compare the pathname only — `preserveSearch` carries the router's
      // default-filled search params (year/algorithm) through, so the
      // rendered href legitimately has a query string appended.
      expect(href.split("?")[0]).toBe(card.to);
    });
  }

  it("renders exactly as many cards as METHODOLOGY_CARDS describes", async () => {
    await renderMethodologyIndex();
    expect(screen.getAllByRole("link")).toHaveLength(METHODOLOGY_CARDS.length);
  });
});
