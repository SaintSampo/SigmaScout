/**
 * Route-level coverage for `/methodology/epa-vs-statbotics` (quick task
 * 260908-n5o Task 3). Builds a small, self-contained route tree the same
 * way `methodology.compare.test.tsx`/`methodology.index.test.tsx` do — the
 * REAL exported `Route` object is under test, with `fetch` mocked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import {
  EPA_COMPARISON_AGREEMENT_TABLE_TESTID,
  EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID,
  EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID,
  EPA_COMPARISON_OFFSEASON_ARM_TABLE_TESTID,
} from "../components/methodology/EpaComparisonPage.js";
import { Route as EpaComparisonRouteImport } from "./methodology.epa-vs-statbotics.js";

const SEASONS = [2022, 2023, 2024, 2025, 2026];

function fixtureArtifact() {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-test",
    computedAt: "2026-09-08T00:00:00.000Z",
    measuredAt: "2026-09-08T00:00:00.000Z",
    epaVersion: "6.0.0+baseline",
    minMatches: 12,
    agreement: SEASONS.flatMap((season) => [
      { season, includeOffseason: true, joinedCount: 300, ordinaryLeastSquaresSlope: 0.9, pearson: 0.95, meanAbsoluteDifference: 3 },
      { season, includeOffseason: false, joinedCount: 280, ordinaryLeastSquaresSlope: 0.97, pearson: 0.99, meanAbsoluteDifference: 1.5 },
    ]),
    // Statbotics leads in exactly THREE of the five seasons (2022, 2023,
    // 2024) — 2025 and 2026 SigmaScout leads or ties. The summary sentence
    // must render "3", derived from these rows, never a hardcoded number.
    headToHead: [
      { season: 2022, ourWinnerAccuracy: 0.70, ourBrierScore: 0.20, scoredCount: 500, statboticsWinnerAccuracy: 0.78, statboticsBrierScore: 0.15, statboticsCapturedAt: "2026-09-04", statboticsFetched: true },
      { season: 2023, ourWinnerAccuracy: 0.71, ourBrierScore: 0.19, scoredCount: 500, statboticsWinnerAccuracy: 0.77, statboticsBrierScore: 0.16, statboticsCapturedAt: "2026-09-04", statboticsFetched: true },
      { season: 2024, ourWinnerAccuracy: 0.72, ourBrierScore: 0.18, scoredCount: 500, statboticsWinnerAccuracy: 0.76, statboticsBrierScore: 0.17, statboticsCapturedAt: "2026-09-04", statboticsFetched: true },
      { season: 2025, ourWinnerAccuracy: 0.75, ourBrierScore: 0.17, scoredCount: 500, statboticsWinnerAccuracy: 0.74, statboticsBrierScore: 0.18, statboticsCapturedAt: "2026-09-04", statboticsFetched: false },
      { season: 2026, ourWinnerAccuracy: 0.80, ourBrierScore: 0.14, scoredCount: 500, statboticsWinnerAccuracy: 0.79, statboticsBrierScore: 0.15, statboticsCapturedAt: "2026-09-04", statboticsFetched: true },
    ],
  };
}

function renderEpaComparisonRoute() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const epaComparisonRoute = EpaComparisonRouteImport.update({
    id: "/methodology/epa-vs-statbotics",
    path: "/methodology/epa-vs-statbotics",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([epaComparisonRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/epa-vs-statbotics"] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe("/methodology/epa-vs-statbotics route", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("renders the page title from first paint", async () => {
    global.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByText("Our EPA vs Statbotics' EPA")).toBeDefined());
  });

  it("renders a skeleton while the query is pending", async () => {
    global.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByTestId(EPA_COMPARISON_AGREEMENT_TABLE_TESTID)).toBeNull();
  });

  it("renders an error state with a retry affordance when the fetch rejects", async () => {
    global.fetch = (() => Promise.resolve(new Response("boom", { status: 500 }))) as unknown as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByText("Couldn't load EPA comparison data.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("renders the empty state, not the error state, on a 404", async () => {
    global.fetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByText("No published comparison data yet")).toBeDefined());
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  describe("populated", () => {
    function mockFetch() {
      global.fetch = (() => Promise.resolve(new Response(JSON.stringify(fixtureArtifact()), { status: 200 }))) as unknown as typeof fetch;
    }

    it("renders one agreement row per season", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      const table = await screen.findByTestId(EPA_COMPARISON_AGREEMENT_TABLE_TESTID);
      const rows = within(table).getAllByRole("row").slice(1); // skip header row
      expect(rows).toHaveLength(SEASONS.length);
    });

    it("renders both offseason arms paired per season in the offseason arm table", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      const table = await screen.findByTestId(EPA_COMPARISON_OFFSEASON_ARM_TABLE_TESTID);
      const rows = within(table).getAllByRole("row").slice(2); // skip two header rows
      expect(rows).toHaveLength(SEASONS.length);
      // The first data row (2022) carries six numeric cells beyond season —
      // slope in/out, pearson in/out, MAD in/out — proving both arms are
      // present in the SAME row, visually adjacent.
      const firstRowCells = within(rows[0]!).getAllByRole("cell");
      expect(firstRowCells).toHaveLength(7);
    });

    it("renders one head-to-head row per season", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      const table = await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const rows = within(table).getAllByRole("row").slice(2); // skip two header rows
      expect(rows).toHaveLength(SEASONS.length);
    });

    it("the head-to-head summary sentence's season count is derived from the fixture (3), never a hardcoded number", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const summary = screen.getByTestId(EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID);
      expect(summary.textContent).toContain("3 of 5");
    });

    it("renders every one of the four difference headings", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_AGREEMENT_TABLE_TESTID);
      expect(screen.getByText("Offseason matches")).toBeDefined();
      expect(screen.getByText("How win probability is scaled")).toBeDefined();
      expect(screen.getByText("How a match score is split into pieces")).toBeDefined();
      expect(screen.getByText("No per-year adjustments")).toBeDefined();
    });
  });
});
