/**
 * Route-level coverage for `/districts` (quick task 260905-lic Task 3).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/event.$eventKey.test.tsx` does — `Route.update({...})` mirrors
 * exactly what the auto-generated `routeTree.gen.ts` does at `vite
 * build`/`vite dev` time, so the REAL exported `Route` object from
 * `districts.tsx` is under test, not a re-implementation of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { Route as DistrictsRouteImport } from "./districts.js";

function districtsIndexResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-05T00:00:00.000Z",
      year: 2026,
      districts: [
        { districtKey: "2026fnc", abbreviation: "fnc", displayName: "FIRST North Carolina", dcmpSlots: 54, cmpSlots: 19, teamCount: 90, eventCount: 7 },
        { districtKey: "2026fim", abbreviation: "fim", displayName: "FIRST Michigan", dcmpSlots: 80, cmpSlots: 25, teamCount: 200, eventCount: 12 },
      ],
    }),
    { status: 200 },
  );
}

function districtDetailResponse(districtKey: string) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-05T00:00:00.000Z",
      districtKey,
      year: 2026,
      abbreviation: "fnc",
      displayName: "FIRST North Carolina",
      dcmpSlots: 54,
      cmpSlots: 19,
      teams: [
        {
          teamKey: "frc4561",
          teamNumber: 4561,
          nickname: "The Fighting Pi",
          rank: 1,
          pointTotal: 350,
          rookieBonus: 0,
          adjustments: 0,
          eventPoints: [],
          remainingEvents: [],
          maxRemainingDistrict: 0,
          maxRemainingChamp: 0,
          districtLock: { status: "locked", pointsToLock: 0, threatCount: 0, cutLinePoints: 100 },
          champLock: { status: "locked", pointsToLock: 0, threatCount: 0, cutLinePoints: 200 },
        },
      ],
      insights: {
        teamCount: 1,
        eventCount: 7,
        dcmpCutLinePoints: 100,
        cmpCutLinePoints: 200,
        districtLockedCount: 1,
        districtEliminatedCount: 0,
        champLockedCount: 1,
        champEliminatedCount: 0,
      },
    }),
    { status: 200 },
  );
}

function renderDistrictsRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const districtsRoute = DistrictsRouteImport.update({
    id: "/districts",
    path: "/districts",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([districtsRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("/districts route", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("with no ?district= shows the district picker and an empty state, never a fabricated default", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/districts/")) return Promise.resolve(districtsIndexResponse());
      return new Promise<Response>(() => {}); // detail fetch must never fire
    });
    renderDistrictsRoute("/districts?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "District" })).toBeDefined());
    expect(screen.getByText("Pick a district")).toBeDefined();
  });

  it("selecting a district navigates and puts ?district= in the URL", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/districts/")) return Promise.resolve(districtsIndexResponse());
      if (url.includes("/v1/district/")) return Promise.resolve(districtDetailResponse("2026fnc"));
      return new Promise<Response>(() => {});
    });
    const router = renderDistrictsRoute("/districts?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "District" })).toBeDefined());
    const trigger = screen.getByRole("combobox", { name: "District" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: "FIRST NC" });
    fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
    fireEvent.click(option);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).district).toBe("2026fnc"));
  });

  it("?district=2026fnc&tab=champ-locks deep-links directly to the Champ Locks tab", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/districts/")) return Promise.resolve(districtsIndexResponse());
      if (url.includes("/v1/district/")) return Promise.resolve(districtDetailResponse("2026fnc"));
      return new Promise<Response>(() => {});
    });
    renderDistrictsRoute("/districts?algorithm=vpr&district=2026fnc&tab=champ-locks");

    await waitFor(() => expect(screen.getByTestId("champ-locks-panel")).toBeDefined());
    expect(screen.getByTestId("champ-locks-panel").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("district-insights-panel").hasAttribute("hidden")).toBe(true);
  });
});
