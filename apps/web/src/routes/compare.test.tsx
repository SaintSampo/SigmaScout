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
import {
  CALIBRATION_EXPLAINER,
  CALIBRATION_SECTION_TESTID,
  CALIBRATION_EMPTY_RANGE_TEXT,
  calibrationCardSentenceTestId,
  calibrationCardTestId,
  CALIBRATION_YEAR_SELECT_TESTID,
} from "../components/compare/CalibrationSection.js";
import { type CompareSlice } from "../components/compare/calibrationSeries.js";
import { buildCalibrationCard, cardHeadlineSentence } from "../components/compare/calibrationCards.js";
import { algorithmDisplayLabel } from "../components/ribbon/AlgorithmSelect.js";
import { coverageCellTestId, DATA_COVERAGE_SCROLL_TESTID, DATA_COVERAGE_SECTION_TESTID } from "../components/compare/DataCoverageTable.js";
import { COVERAGE_EXCLUSION_COLUMNS } from "../components/compare/coverageRows.js";
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

/**
 * Reads the rendered cell text for one (season, algorithm, metric) triple, by
 * locating the row whose first cell is that season and the fixed column
 * index PUBLISHED_ALGORITHM_IDS/D-08's column order implies. Scoped to the
 * accuracy table's OWN scroll region (`COMPARE_ACCURACY_SCROLL_TESTID`) —
 * 08-12's `DataCoverageTable` mounts a SECOND `<table>` on this same page, so
 * `screen.getByRole("table")` alone is no longer unambiguous.
 */
function readCellText(season: number, algorithmId: string, metric: "accuracy" | "brier"): string {
  const table = within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table");
  const rows = within(table).getAllByRole("row").slice(2); // skip the two header rows
  const row = rows.find((r) => within(r).getAllByRole("cell")[0]?.textContent === String(season));
  if (row === undefined) throw new Error(`no row found for season ${season}`);
  const algorithmIndex = PUBLISHED_ALGORITHM_IDS.indexOf(algorithmId as (typeof PUBLISHED_ALGORITHM_IDS)[number]);
  const cellIndex = 1 + algorithmIndex * 2 + (metric === "accuracy" ? 0 : 1);
  const cells = within(row).getAllByRole("cell");
  return cells[cellIndex]!.textContent ?? "";
}

/** Reads whether the rendered cell for one (season, algorithm, metric) triple carries the semibold emphasis class. Scoped to the accuracy table's own scroll region — see `readCellText`'s doc comment. */
function readCellIsBold(season: number, algorithmId: string, metric: "accuracy" | "brier"): boolean {
  const table = within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table");
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
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());

    expect(fetchCalls).toHaveLength(5);
    expect(fetchCalls.some((url) => url.includes("manifest"))).toBe(false);
  });

  for (const view of COMP_LEVEL_VIEWS) {
    for (const season of COMPARE_SEASONS) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        it(`${view} ${season} ${algorithmId}: rendered Brier and Winner Accuracy cells equal the committed fixture's own ${view}-view slice`, async () => {
          mockFetch();
          renderCompareRoute();
          await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());

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
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellIsBold(2023, "vpr", "accuracy")).toBe(true));
    expect(readCellIsBold(2023, "opr", "accuracy")).toBe(false);
    expect(readCellIsBold(2023, "epa", "accuracy")).toBe(false);
  });

  it("2022 elimination Winner Accuracy renders no bold at all, even though OPR leads — the withheld leader is not the site's own model", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());
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
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());

    const columnCountBefore = within(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).getAllByRole("row")[2]!.querySelectorAll('[role="cell"], td').length;
    expect(screen.getAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toHaveLength(1);

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    const columnCountAfter = within(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).getAllByRole("row")[2]!.querySelectorAll('[role="cell"], td').length;
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
    // 08-12 mounts a SECOND skeleton table (DataCoverageSectionSkeleton)
    // alongside AccuracyTableSkeleton, so "Year" now legitimately appears
    // twice — scoped to the accuracy table's own region to keep this
    // pre-existing assertion unambiguous.
    expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("columnheader", { name: "Year" })).toBeDefined();
  });
});

describe("/compare route — Calibration section (sketch 006-C cards, 2026-09-01 rebuild, D-10 parity)", () => {
  afterEach(() => cleanup());

  const calibrationFetchCalls: string[] = [];

  function mockFetch() {
    calibrationFetchCalls.length = 0;
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      calibrationFetchCalls.push(url);
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      if (body === undefined) throw new Error(`unexpected fetch URL: ${url}`);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  function calibrationSliceFor(year: number, algorithmId: string, compLevelView: string): CompareSlice {
    const fixture = FIXTURES_BY_YEAR[year]!;
    const slice = fixture.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === compLevelView) as
      | CompareSlice
      | undefined;
    if (slice === undefined) throw new Error(`fixture for ${year} carries no ${compLevelView} slice for ${algorithmId}`);
    return slice;
  }

  /** The fixture-recomputed headline sentence for one card — the SAME pure model the component renders through, per D-10. */
  function expectedSentence(year: number, algorithmId: "opr" | "epa" | "vpr", view: string): string {
    const card = buildCalibrationCard(calibrationSliceFor(year, algorithmId, view));
    if (card.headline === null) throw new Error("fixture unexpectedly has no valid bins");
    return cardHeadlineSentence(algorithmDisplayLabel(algorithmId), card.headline);
  }

  it("default render: ALL THREE cards carry their own fixture-recomputed 2026 combined-view headline sentence", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      await waitFor(() =>
        expect(screen.getByTestId(calibrationCardSentenceTestId(algorithmId)).textContent).toContain(
          expectedSentence(2026, algorithmId, "combined"),
        ),
      );
    }
  });

  it("switching the page compLevelView to Qualification re-derives every card from the qualification slices", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("qualification")));

    await waitFor(() =>
      expect(screen.getByTestId(calibrationCardSentenceTestId("opr")).textContent).toContain(expectedSentence(2026, "opr", "qualification")),
    );
  });

  it("changing the year Select to 2024 re-derives the cards from the 2024 artifact with zero additional fetches", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));
    await waitFor(() => expect(screen.getByTestId(calibrationCardSentenceTestId("vpr")).textContent).not.toBe(""));
    const fetchCallCountBefore = calibrationFetchCalls.length;

    fireEvent.click(screen.getByTestId(CALIBRATION_YEAR_SELECT_TESTID));
    fireEvent.click(await screen.findByRole("option", { name: "2024" }));

    await waitFor(() =>
      expect(screen.getByTestId(calibrationCardSentenceTestId("vpr")).textContent).toContain(expectedSentence(2024, "vpr", "combined")),
    );
    expect(calibrationFetchCalls.length).toBe(fetchCallCountBefore);
  });

  it("every published bin renders as a row — populated rows as \"predicted → actual\" with counts, empty bins as the verbatim empty-range sentence, never hidden", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    const slice = calibrationSliceFor(2026, "vpr", "combined");
    const card = buildCalibrationCard(slice);
    const cardEl = await screen.findByTestId(calibrationCardTestId("vpr"));
    const emptyCount = card.rows.filter((r) => r.point === null).length;
    expect(within(cardEl).queryAllByText(CALIBRATION_EMPTY_RANGE_TEXT)).toHaveLength(emptyCount);
    // Ten published bins, ten rows — the sparse-honesty rule made structural.
    for (const row of card.rows) {
      expect(within(cardEl).getByText(row.rangeLabel)).toBeDefined();
    }
  });

  it("renders the corrected orientation explainer; the inverted form does not appear", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    expect(screen.getByText(CALIBRATION_EXPLAINER)).toBeDefined();
    expect(CALIBRATION_EXPLAINER).toContain("below the zero line means the algorithm was more confident");
    expect(CALIBRATION_EXPLAINER).not.toContain("above the zero line means the algorithm was more confident");
  });
});

/**
 * 08-12-PLAN.md Task 3: the Data coverage per year section, mounted last on
 * the page. Every expected value below is an expression over the imported
 * fixture, computed the SAME way `DataCoverageTable.tsx`'s own
 * `collapseSharedCount`/`renderSharedCount` collapse a shared field — never a
 * hand-typed second copy of a coverage figure.
 */
describe("/compare route — Data coverage per year (08-12, COMP-01, D-09, D-10 parity)", () => {
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

  type FixtureSlice = (typeof compare2022)["slices"][number];

  /** The three algorithms' own slices for one (season, view) pair, in `PUBLISHED_ALGORITHM_IDS` order — the same selection `buildCoverageRows` performs. */
  function slicesFor(season: number, view: CompareCompLevelView): { algorithmId: (typeof PUBLISHED_ALGORITHM_IDS)[number]; slice: FixtureSlice }[] {
    const fixture = FIXTURES_BY_YEAR[season]!;
    return PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
      const slice = fixture.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === view);
      if (slice === undefined) throw new Error(`fixture for ${season} carries no ${view} slice for ${algorithmId}`);
      return { algorithmId, slice };
    });
  }

  /** Mirrors `collapseSharedCount` + the component's `renderSharedCount`: a single number when all three agree, a labelled triple otherwise. */
  function expectedSharedText(entries: readonly { algorithmId: (typeof PUBLISHED_ALGORITHM_IDS)[number]; slice: FixtureSlice }[], reader: (slice: FixtureSlice) => number): string {
    const values = entries.map((e) => ({ algorithmId: e.algorithmId, value: reader(e.slice) }));
    const allEqual = values.every((v) => v.value === values[0]!.value);
    if (allEqual) return String(values[0]!.value);
    return PUBLISHED_ALGORITHM_IDS.filter((id) => values.some((v) => v.algorithmId === id))
      .map((id) => `${algorithmDisplayLabel(id)} ${values.find((v) => v.algorithmId === id)!.value}`)
      .join(", ");
  }

  async function selectView(view: CompareCompLevelView) {
    if (view === "combined") return;
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId(view)));
    const expectedText = FIXTURES_BY_YEAR[2022]!.slices.find((s) => s.algorithmId === "vpr" && s.compLevelView === view)!.brierScore!.toFixed(4);
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).toBe(expectedText));
  }

  for (const view of COMP_LEVEL_VIEWS) {
    for (const season of COMPARE_SEASONS) {
      it(`${view} ${season}: all eleven coverage leaf cells equal the committed fixture's own ${view}-view slice`, async () => {
        mockFetch();
        renderCompareRoute();
        await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));
        await selectView(view);

        const entries = slicesFor(season, view);

        await waitFor(() =>
          expect(screen.getByTestId(coverageCellTestId(season, "candidateCount")).textContent).toBe(
            expectedSharedText(entries, (s) => s.candidateCount),
          ),
        );
        expect(screen.getByTestId(coverageCellTestId(season, "scoredCount")).textContent).toBe(expectedSharedText(entries, (s) => s.scoredCount));
        expect(screen.getByTestId(coverageCellTestId(season, "tieCount")).textContent).toBe(expectedSharedText(entries, (s) => s.tieCount));
        for (const column of COVERAGE_EXCLUSION_COLUMNS) {
          expect(screen.getByTestId(coverageCellTestId(season, column.key)).textContent).toBe(
            expectedSharedText(entries, (s) => s.exclusionCounts[column.key]),
          );
        }
        for (const { algorithmId, slice } of entries) {
          expect(screen.getByTestId(coverageCellTestId(season, `noCall:${algorithmId}`)).textContent).toBe(String(slice.noCallCount));
        }
      });
    }
  }

  it("the three algorithms agree on all seven collapsible coverage fields in all fifteen (view, season) groups — measured 15 of 15, so every rendered shared cell IS a single number, never a labelled triple", () => {
    let checkedGroups = 0;
    for (const view of COMP_LEVEL_VIEWS) {
      for (const season of COMPARE_SEASONS) {
        const entries = slicesFor(season, view);
        const readers: ((s: FixtureSlice) => number)[] = [
          (s) => s.candidateCount,
          (s) => s.scoredCount,
          (s) => s.tieCount,
          ...COVERAGE_EXCLUSION_COLUMNS.map((column) => (s: FixtureSlice) => s.exclusionCounts[column.key]),
        ];
        for (const reader of readers) {
          const values = entries.map((e) => reader(e.slice));
          expect(new Set(values).size, `${view} ${season}`).toBe(1);
        }
        checkedGroups += 1;
      }
    }
    expect(checkedGroups).toBe(15);
  });

  it("published zeros render the digit zero, never the em-dash — derived from the fixture rather than hardcoded coordinates (COMP-01 empty)", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));

    let assertedAtLeastOneZero = false;

    for (const view of COMP_LEVEL_VIEWS) {
      await selectView(view);
      for (const season of COMPARE_SEASONS) {
        const entries = slicesFor(season, view);

        for (const column of COVERAGE_EXCLUSION_COLUMNS) {
          const values = entries.map((e) => e.slice.exclusionCounts[column.key]);
          if (values.every((v) => v === 0)) {
            const text = screen.getByTestId(coverageCellTestId(season, column.key)).textContent;
            expect(text, `${view} ${season} ${column.key}`).toBe(String(values[0]));
            assertedAtLeastOneZero = true;
          }
        }
        for (const { algorithmId, slice } of entries) {
          if (slice.noCallCount === 0) {
            const text = screen.getByTestId(coverageCellTestId(season, `noCall:${algorithmId}`)).textContent;
            expect(text, `${view} ${season} noCall:${algorithmId}`).toBe(String(slice.noCallCount));
            assertedAtLeastOneZero = true;
          }
        }
      }
    }

    // A structural guard on the guard itself: if the published data ever
    // stopped carrying any zero at all, this whole case would vacuously
    // pass without exercising the branch it exists to check.
    expect(assertedAtLeastOneZero).toBe(true);
  });
});

/**
 * 08-12-PLAN.md Task 3: the page's completed four-section pending and error
 * branches, and the coverage section's layout position.
 */
describe("/compare route — four-section pending and error branches (08-12, UI-SPEC C4)", () => {
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

  it("pending: title and switcher render, all four section skeletons render, and none of the populated-only sections' content appears", async () => {
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
    expect(screen.getByRole("group", { name: "Match type" })).toBeDefined();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));

    // All four section skeletons render — the accuracy table's own and
    // Task 2's DataCoverageSectionSkeleton both mount a real `<table>`.
    expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined();
    expect(within(screen.getByTestId(DATA_COVERAGE_SCROLL_TESTID)).getByRole("table")).toBeDefined();

    // None of the populated-only sections' own content renders: the
    // methodology note and calibration section mount ONLY in the populated
    // branch (no skeleton sibling of their own, Decision 7), and the
    // coverage table's skeleton carries no real coverage CELL (only
    // placeholder pulses, no `coverage-cell-*` test id).
    expect(screen.queryByTestId(METHODOLOGY_NOTE_TESTID)).toBeNull();
    expect(screen.queryByTestId(CALIBRATION_SECTION_TESTID)).toBeNull();
    expect(document.querySelector('[data-testid^="data-coverage-cell-"]')).toBeNull();
  });

  it("error: exactly one error line and one Retry control render, and none of the four sections' own test ids appear anywhere in the tree", async () => {
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
    expect(screen.getAllByRole("button", { name: /retry/i })).toHaveLength(1);

    expect(screen.queryByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toBeNull();
    expect(screen.queryByTestId(METHODOLOGY_NOTE_TESTID)).toBeNull();
    expect(screen.queryByTestId(CALIBRATION_SECTION_TESTID)).toBeNull();
    expect(screen.queryByTestId(DATA_COVERAGE_SECTION_TESTID)).toBeNull();
  });

  it("the coverage section is a DOM sibling of the calibration section and the last of the four sections, matching UI-SPEC's layout order", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "vpr", "brier")).not.toBe(""));
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SECTION_TESTID)).toBeDefined());

    const calibration = screen.getByTestId(CALIBRATION_SECTION_TESTID);
    const coverage = screen.getByTestId(DATA_COVERAGE_SECTION_TESTID);

    expect(calibration.parentElement).toBe(coverage.parentElement);
    const siblings = Array.from(calibration.parentElement!.children);
    expect(siblings.indexOf(coverage)).toBe(siblings.length - 1);
    expect(siblings.indexOf(coverage)).toBeGreaterThan(siblings.indexOf(calibration));
  });
});
