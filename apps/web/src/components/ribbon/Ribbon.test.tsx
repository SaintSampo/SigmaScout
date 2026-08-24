import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamsSearchSchema } from "@/lib/searchParams";
import { Ribbon } from "./Ribbon.js";

/**
 * A real, minimal, self-contained route tree — NOT the app's own
 * `routeTree.gen.ts` (see `__root.test.tsx`'s identical reasoning: that file
 * is regenerated at build time and is not guaranteed to reflect this
 * plan's routes when `vitest run` executes before `vite build`). Mounts the
 * real `Ribbon` at the root layout, exactly as `routes/__root.tsx` does, so
 * the active-link behaviour under test is real TanStack Router `Link`
 * matching, not a mock.
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
  const compareRoute = createRoute({ getParentRoute: () => rootRoute, path: "/compare", component: () => <div>Compare page</div> });
  const routeTree = rootRoute.addChildren([teamsRoute, eventsRoute, compareRoute]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderRibbonAt(initialPath: string) {
  const router = buildTestRouter(initialPath);
  const queryClient = makeQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(router.state.status).toBe("idle"));
  return { router, ...utils };
}

describe("Ribbon", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders with NO query client data resolved, proving it is not fetch-gated — the algorithms manifest fetch never resolves during this test", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})); // never resolves
    await renderRibbonAt("/teams?year=2024&algorithm=sigma1");

    // Renders immediately even though the manifest fetch is permanently
    // pending — proving the ribbon itself is never gated on that fetch.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.textContent)).toEqual(["Teams", "Events", "Compare"]);
  });

  it("all three links render in the fixed order Teams, Events, Compare (desktop)", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    await renderRibbonAt("/events?year=2024&algorithm=sigma1");

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Teams", "Events", "Compare"]);
  });

  it("that order is UNCHANGED when the mobile breakpoint hook reports true — the responsive treatment reflows, it never reorders", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: true, // simulates a phone-width viewport
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;

    try {
      await renderRibbonAt("/compare?year=2024&algorithm=sigma1");
      const links = screen.getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["Teams", "Events", "Compare"]);
    } finally {
      window.matchMedia = original;
    }
  });

  it("the link matching the CURRENT route carries the active indicator and the others do not", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    await renderRibbonAt("/teams?year=2024&algorithm=sigma1");

    const links = screen.getAllByRole("link");
    const teamsLink = links.find((link) => link.textContent === "Teams");
    const eventsLink = links.find((link) => link.textContent === "Events");
    const compareLink = links.find((link) => link.textContent === "Compare");

    expect(teamsLink?.getAttribute("data-status")).toBe("active");
    expect(eventsLink?.getAttribute("data-status")).not.toBe("active");
    expect(compareLink?.getAttribute("data-status")).not.toBe("active");
  });

  it("the icon-only search trigger exposes an accessible name and a 44px minimum tap-target class", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    await renderRibbonAt("/teams?year=2024&algorithm=sigma1");

    const trigger = screen.getByRole("button", { name: "Open search" });
    expect(trigger.className).toContain("tap-target");
  });

  it("selecting the already-selected YEAR performs no navigation (YearSelect's NAV-02 adjacency edge)", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { router } = await renderRibbonAt("/teams?year=2024&algorithm=sigma1&sort=hubShift1&sortDir=asc");
    const navigateSpy = vi.spyOn(router, "navigate");

    const yearTrigger = screen.getByRole("combobox", { name: "Year" });
    fireEvent.pointerDown(yearTrigger, { button: 0, pointerId: 1 });
    fireEvent.click(yearTrigger);
    const currentYearOption = await screen.findByRole("option", { name: "2024" });
    fireEvent.pointerUp(currentYearOption, { button: 0, pointerId: 1 });
    fireEvent.click(currentYearOption);

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("selecting a DIFFERENT year does navigate and preserves sort/sortDir (D-11) — contrast case proving the reselect guard above is not vacuously true", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const { router } = await renderRibbonAt("/teams?year=2024&algorithm=sigma1&sort=hubShift1&sortDir=asc");

    const yearTrigger = screen.getByRole("combobox", { name: "Year" });
    fireEvent.pointerDown(yearTrigger, { button: 0, pointerId: 1 });
    fireEvent.click(yearTrigger);
    const otherYearOption = await screen.findByRole("option", { name: "2022" });
    fireEvent.pointerUp(otherYearOption, { button: 0, pointerId: 1 });
    fireEvent.click(otherYearOption);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).year).toBe(2022));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.sortDir).toBe("asc"); // preserved
    // "hubShift1" is 2026-only (see resolveSortKey.test.ts's identical case)
    // — at 2022 it falls back to the total key rather than staying stale.
    expect(search.sort).toBe("total");
  });
});
