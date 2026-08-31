/**
 * D-10's parity check (SC-4, EVAL-05, 08-01-PLAN.md Task 3): renders the
 * REAL exported `Route` object from `compare.tsx` against committed copies
 * of the five real published `v1/compare/{year}.json` artifacts, and proves
 * the page is faithful to those artifacts — every expected value below is
 * an expression computed from the imported fixture at run time, never a
 * hand-typed second copy that could silently drift from it.
 *
 * What this does NOT prove: that the published artifact itself matches what
 * the offline harness produced (artifact-versus-harness fidelity). If that
 * wider coverage is ever wanted, the existing pattern to copy is
 * `apps/web/e2e/event-live-artifact.spec.ts`'s live-origin Playwright fetch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { COMPARE_SEASONS } from "../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../packages/harness/publishedAlgorithms.js";
import { Route as CompareRouteImport } from "./compare.js";
import compare2022 from "./__fixtures__/compare-2022.json";
import compare2023 from "./__fixtures__/compare-2023.json";
import compare2024 from "./__fixtures__/compare-2024.json";
import compare2025 from "./__fixtures__/compare-2025.json";
import compare2026 from "./__fixtures__/compare-2026.json";

const FIXTURES_BY_YEAR: Record<number, typeof compare2022> = {
  2022: compare2022,
  2023: compare2023,
  2024: compare2024,
  2025: compare2025,
  2026: compare2026,
};

function renderCompareRoute() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const compareRoute = CompareRouteImport.update({
    id: "/compare",
    path: "/compare",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([compareRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/compare"] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Reads the rendered cell text for one (season, algorithm, metric) triple, by locating the row whose first cell is that season and the fixed column index PUBLISHED_ALGORITHM_IDS/D-08's column order implies. */
function readCellText(season: number, algorithmId: string, metric: "accuracy" | "brier"): string {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row").slice(2); // skip the two header rows
  const row = rows.find((r) => within(r).getAllByRole("cell")[0]?.textContent === String(season));
  if (row === undefined) throw new Error(`no row found for season ${season}`);
  const algorithmIndex = PUBLISHED_ALGORITHM_IDS.indexOf(algorithmId as (typeof PUBLISHED_ALGORITHM_IDS)[number]);
  const cellIndex = 1 + algorithmIndex * 2 + (metric === "accuracy" ? 0 : 1);
  const cells = within(row).getAllByRole("cell");
  return cells[cellIndex]!.textContent ?? "";
}

describe("/compare route — D-10 parity (real fixtures, all fifteen season x algorithm pairs)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  const fetchCalls: string[] = [];

  function mockFetch() {
    fetchCalls.length = 0;
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      if (match === null) {
        throw new Error(`unexpected fetch URL in D-10 parity test: ${url}`);
      }
      const year = Number(match[1]);
      const body = FIXTURES_BY_YEAR[year];
      if (body === undefined) {
        throw new Error(`no committed fixture for year ${year}`);
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  it("issues exactly five artifact requests, one per season, and NO manifest request", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());

    expect(fetchCalls).toHaveLength(5);
    expect(fetchCalls.some((url) => url.includes("manifest"))).toBe(false);
  });

  for (const season of COMPARE_SEASONS) {
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      it(`${season} ${algorithmId}: rendered Brier and Winner Accuracy cells equal the committed fixture's own combined-view slice`, async () => {
        mockFetch();
        renderCompareRoute();
        await waitFor(() => expect(screen.getByRole("table")).toBeDefined());

        const fixture = FIXTURES_BY_YEAR[season]!;
        const slice = fixture.slices.find(
          (s) => s.algorithmId === algorithmId && s.season === season && s.compLevelView === "combined",
        );
        if (slice === undefined) throw new Error(`fixture for ${season} carries no combined slice for ${algorithmId}`);

        const expectedBrierText = slice.brierScore === null ? "—" : slice.brierScore.toFixed(4);
        const expectedAccuracyText = slice.winnerAccuracy === null ? "—" : `${(slice.winnerAccuracy * 100).toFixed(1)}%`;

        await waitFor(() => expect(readCellText(season, algorithmId, "brier")).toBe(expectedBrierText));
        expect(readCellText(season, algorithmId, "accuracy")).toBe(expectedAccuracyText);
      });
    }
  }
});

describe("/compare route — page states", () => {
  afterEach(() => {
    cleanup();
  });

  it("one year returning 404 renders the empty state, with no Retry control", async () => {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/compare/2022.json")) return Promise.resolve(new Response("not found", { status: 404 }));
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: 200 }));
    }) as typeof fetch;

    renderCompareRoute();

    await waitFor(() => expect(screen.getByText("No published comparison data yet")).toBeDefined());
    // 08-06 (Task 2): the compLevel switcher renders "ABOVE every state
    // branch, alongside the title and gated on nothing" — its three
    // segments are `Button`s and are legitimately present even in the empty
    // state, so "no Retry control" is now asserted by name rather than by
    // absence of any button at all.
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("one year returning 500 renders the Compare error line with a working Retry", async () => {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/compare/2023.json")) return Promise.resolve(new Response("boom", { status: 500 }));
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: 200 }));
    }) as typeof fetch;

    renderCompareRoute();

    await waitFor(() => expect(screen.getByText("Couldn't load comparison data.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("while one year's response is still in flight, the skeleton renders beneath the real header row with the page title already visible", async () => {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/compare/2026.json")) return new Promise<Response>(() => {});
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: 200 }));
    }) as typeof fetch;

    renderCompareRoute();

    await waitFor(() => expect(screen.getByText("Compare")).toBeDefined());
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.getByRole("columnheader", { name: "Year" })).toBeDefined();
  });
});
