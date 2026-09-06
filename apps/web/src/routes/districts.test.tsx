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

/** Revision R3: the algorithms manifest — `useAlgorithmVersion`'s own gate on the Insights/Breakdown tabs' teams-artifact join. */
function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-05T00:00:00.000Z",
      algorithms: [{ id: "vpr", version: "2.0.0+tuned-2026-09", codeVersion: "2.0.0", paramSetName: "tuned-2026-09" }],
    }),
    { status: 200 },
  );
}

/** Revision R3: the selected algorithm's teams-table artifact — the Insights/Breakdown tabs' join source (`districtMetricsJoin.tsx`). Carries exactly the `frc4561` roster team `districtDetailResponse` also names, plus one team (`frc9999`) the district roster does NOT carry, proving a teams-artifact-only row is simply never rendered on this district-scoped roster. */
function teamsArtifactResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-05T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-09",
      season: 2026,
      teams: [
        {
          teamKey: "frc4561",
          teamNumber: 4561,
          nickname: "The Fighting Pi",
          eventCount: 3,
          matchCount: 30,
          record: { wins: 20, losses: 10, ties: 0 },
          metrics: { total: { value: 48.33, spread: 2.32, tier: "epic" } },
        },
        {
          teamKey: "frc9999",
          teamNumber: 9999,
          nickname: "Not In This District",
          eventCount: 1,
          matchCount: 10,
          record: { wins: 5, losses: 5, ties: 0 },
          metrics: { total: { value: 10, tier: "rare" } },
        },
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
          qualifyingAwards: [],
          districtLock: { status: "locked", pointsToLock: 0, threatCount: 0, cutLinePoints: 100, allocationNote: null },
          champLock: { status: "locked", pointsToLock: 0, threatCount: 0, cutLinePoints: 200, allocationNote: null },
        },
        // Present in the district roster, absent from `teamsArtifactResponse`
        // — revision R3's join-miss case: every metric cell must render an
        // honest em-dash, never dropped from the table.
        {
          teamKey: "frc4562",
          teamNumber: 4562,
          nickname: "No Algorithm Data Yet",
          rank: 2,
          pointTotal: 200,
          rookieBonus: 0,
          adjustments: 0,
          eventPoints: [],
          remainingEvents: [],
          maxRemainingDistrict: 0,
          maxRemainingChamp: 0,
          qualifyingAwards: [],
          districtLock: { status: "contending", pointsToLock: 10, threatCount: 1, cutLinePoints: 100, allocationNote: null },
          champLock: { status: "contending", pointsToLock: 10, threatCount: 1, cutLinePoints: 200, allocationNote: null },
        },
      ],
      insights: {
        teamCount: 2,
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

  it("revision R3: the Insights tab joins the district roster against the selected algorithm's teams artifact, columns tier-boxed, in district-points rank order", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/teams/")) return Promise.resolve(teamsArtifactResponse());
      if (url.includes("/v1/districts/")) return Promise.resolve(districtsIndexResponse());
      if (url.includes("/v1/district/")) return Promise.resolve(districtDetailResponse("2026fnc"));
      return new Promise<Response>(() => {});
    });
    renderDistrictsRoute("/districts?algorithm=vpr&district=2026fnc");

    // Never the old district-points summary tiles/top-N table this tab used
    // to render — revision R3 replaces that content outright. This exact
    // label only ever appeared in the OLD Insights summary tiles (never on
    // the Locks tabs, which use differently-worded lock/eliminated copy), so
    // its absence proves the summary tiles are gone rather than merely
    // hidden by the tab strip.
    await waitFor(() => expect(screen.getByTestId("district-insights-table-scroll")).toBeDefined());
    expect(screen.queryByText("District: locked / eliminated")).toBeNull();

    expect(screen.getByText("District Points")).toBeDefined();
    expect(screen.getByText("District Rank")).toBeDefined();

    const rows = await screen.findAllByTestId("district-insights-row");
    // District-points rank order (frc4561 rank 1, frc4562 rank 2) — never
    // re-derived from the joined algorithm metrics, which own no rank here.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-team-number")).toBe("4561");
    expect(rows[1]?.getAttribute("data-team-number")).toBe("4562");

    // frc4561 (rank 1, rendered first): found in the teams artifact — a
    // real, tier-boxed Total cell. frc4562 (rank 2) renders its own Total
    // cell as the em-dash the next test asserts on directly.
    const totalCells = await screen.findAllByTestId("district-insights-cell-total");
    expect(totalCells[0]?.textContent).toContain("48.33");
    expect(totalCells[0]?.querySelector(".metric-tier--epic")).not.toBeNull();
  });

  it("revision R3: a district-roster team absent from the teams artifact renders every metric cell as an honest em-dash, never dropped from the table", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/teams/")) return Promise.resolve(teamsArtifactResponse());
      if (url.includes("/v1/districts/")) return Promise.resolve(districtsIndexResponse());
      if (url.includes("/v1/district/")) return Promise.resolve(districtDetailResponse("2026fnc"));
      return new Promise<Response>(() => {});
    });
    renderDistrictsRoute("/districts?algorithm=vpr&district=2026fnc");

    const rows = await screen.findAllByTestId("district-insights-row");
    const missingRow = rows.find((row) => row.getAttribute("data-team-number") === "4562");
    expect(missingRow).toBeDefined();
    const totalCell = missingRow!.querySelector('[data-testid="district-insights-cell-total"]');
    expect(totalCell?.textContent).toBe("—");
  });
});
