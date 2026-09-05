/**
 * Route-level coverage for `/methodology/vpr` (quick task 260905-phf Task 2).
 * Builds a small, self-contained route tree the same way
 * `methodology.index.test.tsx`/`methodology.compare.test.tsx` do — the REAL
 * exported `Route` object from `methodology.vpr.tsx` is under test.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { VPR_GUIDE_SECTIONS } from "../components/methodology/vprGuideContent.js";
import { Route as MethodologyVprRouteImport } from "./methodology.vpr.js";

async function renderMethodologyVpr() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const methodologyVprRoute = MethodologyVprRouteImport.update({
    id: "/methodology/vpr",
    path: "/methodology/vpr",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([methodologyVprRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/vpr"] }) });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/methodology/vpr — Intro to VPR", () => {
  it("renders an h1 reading 'Intro to VPR'", async () => {
    await renderMethodologyVpr();
    expect(screen.getByRole("heading", { level: 1, name: "Intro to VPR" })).toBeDefined();
  });

  // Iterates the exported constant — never a hand-typed second copy of the
  // titles, per this task's own instruction.
  for (const section of VPR_GUIDE_SECTIONS) {
    it(`renders a heading for section "${section.title}"`, async () => {
      await renderMethodologyVpr();
      expect(screen.getByRole("heading", { level: 2, name: section.title })).toBeDefined();
    });
  }

  it("every section descriptor carries at least one paragraph of body prose — an emptied section would fail this, not just render a bare heading", () => {
    for (const section of VPR_GUIDE_SECTIONS) {
      expect(section.paragraphs.length, `section "${section.title}" has no paragraphs`).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length, `section "${section.title}" has an empty paragraph`).toBeGreaterThan(0);
      }
    }
  });

  it("renders a link whose href ends with the accuracy-comparison route", async () => {
    await renderMethodologyVpr();
    const link = screen.getByRole("link", { name: /accuracy comparison/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.split("?")[0]?.endsWith("/methodology/compare")).toBe(true);
  });

  it("states no numeric accuracy figure of its own — no Brier-shaped decimal, no percentage sign anywhere in the rendered prose", async () => {
    await renderMethodologyVpr();
    const bodyText = document.body.textContent ?? "";
    // A Brier score reads like "0.1234" (leading-zero decimal, 4 places).
    expect(bodyText).not.toMatch(/\b0\.\d{3,4}\b/);
    expect(bodyText).not.toContain("%");
  });

  it("makes no better-than claim against OPR or EPA", async () => {
    await renderMethodologyVpr();
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    expect(bodyText).not.toMatch(/better than|outperforms|beats (opr|epa)/);
  });
});
