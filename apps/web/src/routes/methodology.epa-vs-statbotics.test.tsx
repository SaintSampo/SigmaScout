/**
 * Route-level coverage for `/methodology/epa-vs-statbotics` (quick task
 * 260912-tib, a from-scratch rewrite of the page body). Builds a small,
 * self-contained route tree the same way `methodology.compare.test.tsx`/
 * `methodology.index.test.tsx` do — the REAL exported `Route` object is
 * under test, with `fetch` mocked.
 *
 * The title test below uses the HAND-TYPED literal title, not the exported
 * constant, so a title change fails loudly even though the route itself
 * renders the constant.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import {
  EPA_COMPARISON_DIFFERENCE_CARDS_TESTID,
  EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID,
  EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID,
  EPA_COMPARISON_PROVENANCE_TESTID,
  EPA_COMPARISON_SAME_LIST_TESTID,
  epaDifferenceCardTestId,
} from "../components/methodology/EpaComparisonPage.js";
import { EPA_DIFFERENCE_CARD_IDS, EPA_SAME_ITEMS } from "../components/methodology/epaComparisonContent.js";
import { Route as EpaComparisonRouteImport } from "./methodology.epa-vs-statbotics.js";

const SEASONS = [2022, 2023, 2024, 2025, 2026];
const FIXTURE_EPA_VERSION = "10.0.0+baseline";

function fixtureArtifact() {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-test",
    computedAt: "2026-09-08T00:00:00.000Z",
    measuredAt: "2026-09-08T00:00:00.000Z",
    epaVersion: FIXTURE_EPA_VERSION,
    minMatches: 12,
    // EpaComparisonArtifactSchema still requires an `agreement` array even
    // though this page deliberately does not render it (quick task 260912-tib).
    agreement: SEASONS.map((season) => ({
      season,
      basis: "last-official-match" as const,
      joinedCount: 300,
      ordinaryLeastSquaresSlope: 0.98,
      pearson: 0.99,
      meanAbsoluteDifference: 1.8,
    })),
    // Statbotics leads in exactly THREE of the five seasons (2022, 2023,
    // 2024) — 2025 and 2026 SigmaScout leads or ties. The summary sentence
    // must render "3 of 5", derived from these rows, never a hardcoded number.
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

  it("renders the shared list and the difference cards while pending, with a skeleton and no head-to-head table", async () => {
    global.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByTestId(EPA_COMPARISON_SAME_LIST_TESTID)).toBeDefined());
    expect(screen.getByTestId(EPA_COMPARISON_DIFFERENCE_CARDS_TESTID)).toBeDefined();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID)).toBeNull();
  });

  it("renders the shared list and difference cards, plus an error state with a retry affordance, when the fetch rejects", async () => {
    global.fetch = (() => Promise.resolve(new Response("boom", { status: 500 }))) as unknown as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByText("Couldn't load EPA comparison data.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.getByTestId(EPA_COMPARISON_SAME_LIST_TESTID)).toBeDefined();
    expect(screen.getByTestId(EPA_COMPARISON_DIFFERENCE_CARDS_TESTID)).toBeDefined();
  });

  it("renders the shared list and difference cards, plus the empty state (not the error state), on a 404", async () => {
    global.fetch = (() => Promise.resolve(new Response("not found", { status: 404 }))) as unknown as typeof fetch;
    renderEpaComparisonRoute();
    await waitFor(() => expect(screen.getByText("No published comparison data yet")).toBeDefined());
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getByTestId(EPA_COMPARISON_SAME_LIST_TESTID)).toBeDefined();
    expect(screen.getByTestId(EPA_COMPARISON_DIFFERENCE_CARDS_TESTID)).toBeDefined();
  });

  describe("populated", () => {
    function mockFetch() {
      global.fetch = (() => Promise.resolve(new Response(JSON.stringify(fixtureArtifact()), { status: 200 }))) as unknown as typeof fetch;
    }

    it("renders one head-to-head body row per season", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      const table = await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const rows = within(table).getAllByRole("row").slice(2); // skip two header rows
      expect(rows).toHaveLength(SEASONS.length);
    });

    it("the head-to-head summary sentence's season count is derived from the fixture (3 of 5), never a hardcoded number", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const summary = screen.getByTestId(EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID);
      expect(summary.textContent).toContain("3 of 5");
    });

    it("the provenance line contains the fixture's epaVersion", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const provenance = screen.getByTestId(EPA_COMPARISON_PROVENANCE_TESTID);
      expect(provenance.textContent).toContain(FIXTURE_EPA_VERSION);
    });

    it("renders the rendered article testids inside the cards container, in DOM order, matching the content module's card ids", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const container = screen.getByTestId(EPA_COMPARISON_DIFFERENCE_CARDS_TESTID);
      const articles = within(container).getAllByRole("article");
      const renderedTestIds = articles.map((article) => article.getAttribute("data-testid"));
      const expectedTestIds = EPA_DIFFERENCE_CARD_IDS.map((id) => epaDifferenceCardTestId(id));
      expect(renderedTestIds).toEqual(expectedTestIds);
    });

    it("renders the shared list items' text equal to the content module's items, in order", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const list = screen.getByTestId(EPA_COMPARISON_SAME_LIST_TESTID);
      const items = within(list).getAllByRole("listitem");
      expect(items.map((item) => item.textContent)).toEqual(EPA_SAME_ITEMS.map((item) => item.text));
    });

    it("each rendered card contains the exact texts Statbotics and SigmaScout", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const container = screen.getByTestId(EPA_COMPARISON_DIFFERENCE_CARDS_TESTID);
      const articles = within(container).getAllByRole("article");
      for (const article of articles) {
        expect(within(article).getByText("Statbotics")).toBeDefined();
        expect(within(article).getByText("SigmaScout")).toBeDefined();
      }
    });

    it("renders no agreement table and no agreement/slope/pearson text anywhere on the page", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      expect(screen.queryByTestId("epa-comparison-agreement-table")).toBeNull();
      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toMatch(/agreement/i);
      expect(bodyText).not.toMatch(/\bslope\b/i);
      expect(bodyText).not.toMatch(/pearson/i);
    });

    it("the whole rendered page carries no em dash and no en dash", async () => {
      mockFetch();
      renderEpaComparisonRoute();
      await screen.findByTestId(EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID);
      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toContain("—");
      expect(bodyText).not.toContain("–");
    });
  });
});
