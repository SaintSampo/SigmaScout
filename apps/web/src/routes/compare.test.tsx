/**
 * D-10's parity check (SC-4, EVAL-05, 08-01-PLAN.md Task 3; grown to all
 * three compLevel views by 08-06-PLAN.md Task 3): renders the REAL exported
 * `Route` object from `compare.tsx` against committed copies of the five
 * real published `v1/compare/{year}.json` artifacts, and proves the page is
 * faithful to those artifacts — every expected value below is an
 * expression computed from the imported fixture at run time, never a
 * hand-typed second copy that could silently drift from it.
 *
 * What this does NOT prove: that the published artifact itself matches what
 * the offline harness produced (artifact-versus-harness fidelity). If that
 * wider coverage is ever wanted, the existing pattern to copy is
 * `apps/web/e2e/event-live-artifact.spec.ts`'s live-origin Playwright fetch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../packages/harness/publishedAlgorithms.js";
import { buildAccuracyRows, buildRowEmphasis, COMPARE_ACCURACY_SCROLL_TESTID } from "../components/compare/AccuracyTable.js";
import { compLevelSegmentTestId } from "../components/compare/CompLevelSwitcher.js";
import { METHODOLOGY_NOTE_TESTID, buildMethodologyFigures } from "../components/compare/MethodologyNote.js";
import { Route as CompareRouteImport } from "./compare.js";
import compare2022 from "./__fixtures__/compare-2022.json";
import compare2023 from "./__fixtures__/compare-2023.json";
import compare2024 from "./__fixtures__/compare-2024.json";
import compare2025 from "./__fixtures__/compare-2025.json";
import compare2026 from "./__fixtures__/compare-2026.json";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

const FIXTURES_BY_YEAR: Record<number, typeof compare2022> = {
  2022: compare2022,
  2023: compare2023,
  2024: compare2024,
  2025: compare2025,
  2026: compare2026,
};

const COMP_LEVEL_VIEWS: readonly CompareCompLevelView[] = ["combined", "qualification", "elimination"];

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

/** Reads whether the rendered cell for one (season, algorithm, metric) triple carries the semibold emphasis class. */
function readCellIsBold(season: number, algorithmId: string, metric: "accuracy" | "brier"): boolean {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row").slice(2);
  const row = rows.find((r) => within(r).getAllByRole("cell")[0]?.textContent === String(season));
  if (row === undefined) throw new Error(`no row found for season ${season}`);
  const algorithmIndex = PUBLISHED_ALGORITHM_IDS.indexOf(algorithmId as (typeof PUBLISHED_ALGORITHM_IDS)[number]);
  const cellIndex = 1 + algorithmIndex * 2 + (metric === "accuracy" ? 0 : 1);
  const cells = within(row).getAllByRole("cell");
  return /font-semibold/.test(cells[cellIndex]!.className);
}

describe("/compare route — D-10 parity across all three compLevel views (real fixtures, 3 views x 5 seasons x 3 algorithms = 45)", () => {
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

  for (const view of COMP_LEVEL_VIEWS) {
    for (const season of COMPARE_SEASONS) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        it(`${view} ${season} ${algorithmId}: rendered Brier and Winner Accuracy cells equal the committed fixture's own ${view}-view slice`, async () => {
          mockFetch();
          renderCompareRoute();
          await waitFor(() => expect(screen.getByRole("table")).toBeDefined());

          if (view !== "combined") {
            fireEvent.click(screen.getByTestId(compLevelSegmentTestId(view)));
          }

          const fixture = FIXTURES_BY_YEAR[season]!;
          const slice = fixture.slices.find(
            (s) => s.algorithmId === algorithmId && s.season === season && s.compLevelView === view,
          );
          if (slice === undefined) throw new Error(`fixture for ${season} carries no ${view} slice for ${algorithmId}`);

          const expectedBrierText = slice.brierScore === null ? "—" : slice.brierScore.toFixed(4);
          const expectedAccuracyText = slice.winnerAccuracy === null ? "—" : `${(slice.winnerAccuracy * 100).toFixed(1)}%`;

          await waitFor(() => expect(readCellText(season, algorithmId, "brier")).toBe(expectedBrierText));
          expect(readCellText(season, algorithmId, "accuracy")).toBe(expectedAccuracyText);
        });
      }
    }
  }
});

describe("/compare route — D-11 naive-divergence lock (real fixtures, 3 views x 5 seasons x 2 metrics = 30 decisions)", () => {
  it("the computed rule (buildAccuracyRows + buildRowEmphasis) and an inline naive max/min strawman disagree on exactly four of thirty emphasis decisions, all in the elimination view, each named individually", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of COMPARE_SEASONS) {
      artifactsByYear.set(season, FIXTURES_BY_YEAR[season] as unknown as CompareArtifact);
    }

    function sameLeaderSet(a: readonly string[], b: readonly string[]): boolean {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((value, index) => value === sortedB[index]);
    }

    interface Decision {
      readonly view: CompareCompLevelView;
      readonly season: number;
      readonly metric: "brier" | "accuracy";
      readonly computed: readonly string[];
      readonly naive: readonly string[];
    }
    const decisions: Decision[] = [];

    for (const view of COMP_LEVEL_VIEWS) {
      const rows = buildAccuracyRows(artifactsByYear, view);
      for (const row of rows) {
        const emphasis = buildRowEmphasis(row);

        // The naive strawman is implemented INLINE, here, deliberately — it
        // is the thing this lock rules out, not a second copy of the real
        // rule. It simply takes the minimum Brier / maximum accuracy over
        // the row's comparable cells, with no tie test and no exact-equality
        // handling.
        const brierEntries = PUBLISHED_ALGORITHM_IDS.map((id) => ({ id, value: row.cells[id].brierScore })).filter(
          (e): e is { id: (typeof PUBLISHED_ALGORITHM_IDS)[number]; value: number } => e.value !== null,
        );
        const accuracyEntries = PUBLISHED_ALGORITHM_IDS.map((id) => ({ id, value: row.cells[id].winnerAccuracy })).filter(
          (e): e is { id: (typeof PUBLISHED_ALGORITHM_IDS)[number]; value: number } => e.value !== null,
        );
        const naiveBrierLeaders =
          brierEntries.length === 0 ? [] : [brierEntries.reduce((min, e) => (e.value < min.value ? e : min)).id];
        const naiveAccuracyLeaders =
          accuracyEntries.length === 0 ? [] : [accuracyEntries.reduce((max, e) => (e.value > max.value ? e : max)).id];

        decisions.push({ view, season: row.season, metric: "brier", computed: emphasis.brierLeaders, naive: naiveBrierLeaders });
        decisions.push({
          view,
          season: row.season,
          metric: "accuracy",
          computed: emphasis.winnerAccuracyLeaders,
          naive: naiveAccuracyLeaders,
        });
      }
    }

    expect(decisions).toHaveLength(30);

    const diverged = decisions.filter((d) => !sameLeaderSet(d.computed, d.naive));

    // Measured against the five committed real fixtures at planning time
    // (08-CONTEXT.md D-11): exactly four divergences, all in the
    // elimination view. If the committed bytes have moved since, this
    // asserts whatever the fixtures actually produce (08-06-PLAN.md
    // Flagged Planner Assumption 1) — any discrepancy from the four named
    // below is recorded in this plan's SUMMARY, not silently forced.
    expect(diverged.every((d) => d.view === "elimination")).toBe(true);
    expect(diverged).toHaveLength(4);

    function decisionFor(season: number, metric: "brier" | "accuracy") {
      const found = diverged.find((d) => d.season === season && d.metric === metric);
      if (found === undefined) throw new Error(`expected a divergence at elimination ${season} ${metric}`);
      return found;
    }

    // Named individually, so a failure states which case moved.
    decisionFor(2022, "brier");
    decisionFor(2022, "accuracy");
    decisionFor(2024, "accuracy");
    decisionFor(2025, "accuracy");
  });
});

describe("/compare route — D-11 named real-data regression cases (elimination view)", () => {
  afterEach(() => cleanup());

  function mockFetch() {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      if (body === undefined) throw new Error(`unexpected fetch URL: ${url}`);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  it("2023 elimination Winner Accuracy renders VPR bold — the tightest above-threshold case in the corpus", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellIsBold(2023, "vpr", "accuracy")).toBe(true));
    expect(readCellIsBold(2023, "opr", "accuracy")).toBe(false);
    expect(readCellIsBold(2023, "epa", "accuracy")).toBe(false);
  });

  it("2022 elimination Winner Accuracy renders no bold at all, even though OPR leads — the withheld leader is not the site's own model", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "opr", "accuracy")).not.toBe(""));
    expect(readCellIsBold(2022, "opr", "accuracy")).toBe(false);
    expect(readCellIsBold(2022, "epa", "accuracy")).toBe(false);
    expect(readCellIsBold(2022, "vpr", "accuracy")).toBe(false);
  });
});

describe("/compare route — switching view re-renders structurally (C1 overflow backstop, structural half)", () => {
  afterEach(() => cleanup());

  function mockFetch() {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      if (body === undefined) throw new Error(`unexpected fetch URL: ${url}`);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  it("switching the compLevel view changes cell contents/emphasis only — never the column count, never a second scroll region", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(screen.getByRole("table")).toBeDefined());

    const columnCountBefore = within(screen.getByRole("table")).getAllByRole("row")[2]!.querySelectorAll('[role="cell"], td').length;
    expect(screen.getAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toHaveLength(1);

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    const columnCountAfter = within(screen.getByRole("table")).getAllByRole("row")[2]!.querySelectorAll('[role="cell"], td').length;
    expect(columnCountAfter).toBe(columnCountBefore);
    expect(screen.getAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toHaveLength(1);
  });
});

describe("/compare route — MethodologyNote (D-08, D-11)", () => {
  afterEach(() => cleanup());

  function mockFetch() {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      if (body === undefined) throw new Error(`unexpected fetch URL: ${url}`);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  it("the note's derived figures appear in the rendered page and are unchanged by switching the view (Decision 5 — pinned to combined)", async () => {
    mockFetch();
    renderCompareRoute();
    // NOTE: `screen.getByRole("table")` alone is satisfied by
    // `AccuracyTableSkeleton`'s own `<Table>` too — the populated branch
    // (where MethodologyNote mounts) isn't proven until a REAL cell's text
    // has landed, matching every other test in this file's established
    // double-wait discipline.
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of COMPARE_SEASONS) artifactsByYear.set(season, FIXTURES_BY_YEAR[season] as unknown as CompareArtifact);
    const figures = buildMethodologyFigures(artifactsByYear);
    if (figures?.complete !== true) throw new Error("expected complete figures against the real fixtures");

    const textBefore = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";
    expect(textBefore).toContain(String(figures.bestSeason));
    for (const brier of figures.tuneBriers) expect(textBefore).toContain(brier.text);

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).toBe(FIXTURES_BY_YEAR[2022]!.slices.find((s) => s.algorithmId === "vpr" && s.compLevelView === "elimination")!.brierScore!.toFixed(4)));

    const textAfter = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";
    expect(textAfter).toBe(textBefore);
  });

  it("the note block is a DOM sibling of the accuracy table's scroll region, not a descendant of it", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    const scrollRegion = screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    expect(scrollRegion.contains(note)).toBe(false);
    expect(note.contains(scrollRegion)).toBe(false);
  });
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
