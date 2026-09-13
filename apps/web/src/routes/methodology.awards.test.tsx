/**
 * Route level coverage for `/methodology/awards` (quick task 260912-tm8).
 * Builds a small, self contained route tree the same way
 * `methodology.sigma.test.tsx` does, so the REAL exported `Route` object from
 * `methodology.awards.tsx` is under test.
 *
 * The rendered DOM dash gate is kept even though this page has no figures, so
 * every word on it lives in `awardsContent.ts`: it is the check that still
 * holds if someone later adds a label, a caption or a table in JSX.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { AWARDS_LEAD, AWARDS_PAGE_TITLE, AWARDS_SECTIONS } from "../components/methodology/awardsContent.js";
import { Route as MethodologyAwardsRouteImport } from "./methodology.awards.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

async function renderMethodologyAwards() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologyAwardsRoute = MethodologyAwardsRouteImport.update({
    id: "/methodology/awards",
    path: "/methodology/awards",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologyAwardsRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/awards"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology/awards", () => {
  it("renders an h1 carrying the page title", async () => {
    await renderMethodologyAwards();
    expect(screen.getByRole("heading", { level: 1, name: AWARDS_PAGE_TITLE })).toBeDefined();
  });

  it("renders the lead paragraph", async () => {
    await renderMethodologyAwards();
    expect(document.body.textContent ?? "").toContain(AWARDS_LEAD);
  });

  // Iterates the exported constant; the id set itself is pinned by equality in
  // `awardsContent.test.ts`, which is what stops a silently added section here.
  it("renders a level 2 heading and every paragraph for every section", async () => {
    await renderMethodologyAwards();
    const bodyText = document.body.textContent ?? "";
    for (const section of AWARDS_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeDefined();
      for (const paragraph of section.paragraphs) {
        expect(bodyText, `${section.id} paragraph missing from the page`).toContain(paragraph);
      }
    }
  });

  it("gives each section an anchor id so a reader can link straight to it", async () => {
    await renderMethodologyAwards();
    for (const section of AWARDS_SECTIONS) {
      expect(document.getElementById(section.id), `no element with id ${section.id}`).not.toBeNull();
    }
  });

  it("renders no hyphen minus, en dash or em dash anywhere in the page text", async () => {
    await renderMethodologyAwards();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toContain(HYPHEN_MINUS);
    expect(bodyText).not.toContain(EN_DASH);
    expect(bodyText).not.toContain(EM_DASH);
  });
});
