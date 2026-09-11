/**
 * Route-level coverage for `/methodology/spr` (quick task 260910-vof).
 * Builds a small, self-contained route tree the same way
 * `methodology.sigma.test.tsx` does — the REAL exported `Route` object from
 * `methodology.spr.tsx` is under test.
 *
 * This page carries no dash ban (see `sprContent.ts`'s own header), so unlike
 * `methodology.sigma.test.tsx` this file has no rendered-DOM dash gate.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { SPR_LEAD, SPR_PAGE_TITLE, SPR_SECTIONS } from "../components/methodology/sprContent.js";
import { Route as MethodologySprRouteImport } from "./methodology.spr.js";

async function renderMethodologySpr() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologySprRoute = MethodologySprRouteImport.update({
    id: "/methodology/spr",
    path: "/methodology/spr",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologySprRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/spr"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology/spr", () => {
  it("renders an h1 carrying the page title", async () => {
    await renderMethodologySpr();
    expect(screen.getByRole("heading", { level: 1, name: SPR_PAGE_TITLE })).toBeDefined();
  });

  it("renders the lead paragraph", async () => {
    await renderMethodologySpr();
    expect(document.body.textContent ?? "").toContain(SPR_LEAD);
  });

  // Iterates the exported constant — never a hand-typed second copy. The id
  // set itself is pinned by equality in `sprContent.test.ts`.
  it("renders a level 2 heading and every paragraph for every section", async () => {
    await renderMethodologySpr();
    const bodyText = document.body.textContent ?? "";
    for (const section of SPR_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeDefined();
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(bodyText, `section "${section.id}" paragraph ${index} is not rendered`).toContain(paragraph);
      }
    }
  });

  it("never states the retired sealed-holdout figure or the retired display label in rendered text", async () => {
    await renderMethodologySpr();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText, "rendered text states the retired holdout figure").not.toContain("78.05");
    expect(bodyText, "rendered text renders the retired display label").not.toContain("BPR");
  });

  it("links to /methodology/compare for the measured accuracy numbers", async () => {
    await renderMethodologySpr();
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("/methodology/compare") ?? false);
    expect(links.length, "no link to /methodology/compare is rendered").toBeGreaterThan(0);
  });

  it("links to /methodology/sigma to disambiguate SPR from Sigma Score", async () => {
    await renderMethodologySpr();
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("/methodology/sigma") ?? false);
    expect(links.length, "no link to /methodology/sigma is rendered").toBeGreaterThan(0);
  });
});
