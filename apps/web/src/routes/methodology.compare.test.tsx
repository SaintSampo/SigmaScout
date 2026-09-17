/**
 * The parity check: renders the REAL exported `Route` object from
 * `compare.tsx` against committed copies of the five real published
 * `v1/compare/{year}.json` artifacts, and proves the page is
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
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";
import { buildAccuracyRows, buildRowEmphasis, COMPARE_ACCURACY_SCROLL_TESTID } from "../components/compare/AccuracyTable.js";
import { compLevelSegmentTestId } from "../components/compare/CompLevelSwitcher.js";
import { HIGHLIGHT_NOTE, METHODOLOGY_NOTE_TESTID } from "../components/compare/MethodologyNote.js";
import { COMPARE_LEAD, COMPARE_LEAD_TESTID, COMPARE_PAGE_TITLE } from "../components/compare/compareCopy.js";
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
import { Route as CompareRouteImport } from "./methodology.compare.js";
/**
/**
 * Fixture provenance, and why this set is deliberately MIXED-GENERATION.
 *
 * 2022-2026 are frozen snapshots of one generation. They are NOT refreshed
 * on each republish, because several tests below pin hand-picked cases
 * against their exact figures — the 2023 elimination near-tie is described
 * in its own test name as "the tightest above-threshold case in the
 * corpus", and re-fetching would silently re-select which case that is,
 * turning a deliberate boundary test into whatever the newest data happens
 * to contain.
 *
 * 2016-2020 were added later, fetched from the live origin at a newer
 * generation. They carry no pinned figures — nothing below asserts a
 * specific number from them — so the generation skew costs nothing and is
 * preferable to the alternative of refreshing all ten and losing the
 * pinned cases above.
 */
import compare2016 from "./__fixtures__/compare-2016.json";
import compare2017 from "./__fixtures__/compare-2017.json";
import compare2018 from "./__fixtures__/compare-2018.json";
import compare2019 from "./__fixtures__/compare-2019.json";
import compare2020 from "./__fixtures__/compare-2020.json";
import compare2022 from "./__fixtures__/compare-2022.json";
import compare2023 from "./__fixtures__/compare-2023.json";
import compare2024 from "./__fixtures__/compare-2024.json";
import compare2025 from "./__fixtures__/compare-2025.json";
import compare2026 from "./__fixtures__/compare-2026.json";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

const FIXTURES_BY_YEAR: Record<number, typeof compare2022> = {
  2016: compare2016 as unknown as typeof compare2022,
  2017: compare2017 as unknown as typeof compare2022,
  2018: compare2018 as unknown as typeof compare2022,
  2019: compare2019 as unknown as typeof compare2022,
  2020: compare2020 as unknown as typeof compare2022,
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
    id: "/methodology/compare",
    path: "/methodology/compare",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([compareRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/methodology/compare"] }) });
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
 * index `PUBLISHED_ALGORITHM_IDS`'s column order implies. Scoped to the
 * accuracy table's OWN scroll region (`COMPARE_ACCURACY_SCROLL_TESTID`), so
 * a second table added to this page later cannot make the lookup ambiguous.
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
  // Emphasis is a pill element, not a font weight.
  return cells[cellIndex]!.querySelector("[data-emphasis]") !== null;
}

describe("/compare route — fixture parity across all three compLevel views (real fixtures, 3 views x 10 seasons x 3 algorithms = 90)", () => {
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
        throw new Error(`unexpected fetch URL in parity test: ${url}`);
      }
      const year = Number(match[1]);
      const body = FIXTURES_BY_YEAR[year];
      if (body === undefined) {
        throw new Error(`no committed fixture for year ${year}`);
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  }

  it("issues exactly ten artifact requests, one per season, and NO manifest request", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());

    expect(fetchCalls).toHaveLength(10);
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

describe("/compare route — naive-divergence lock (real fixtures, 3 views x 10 seasons x 2 metrics = 60 decisions)", () => {
  it("the computed rule (buildAccuracyRows + buildRowEmphasis) and an inline naive max/min strawman disagree on exactly eleven of sixty emphasis decisions, each named individually", () => {
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

    expect(decisions).toHaveLength(60);

    const diverged = decisions.filter((d) => !sameLeaderSet(d.computed, d.naive));

    // Measured against the ten committed real fixtures. The naive leader is
    // NOT always spr: two of the eleven divergences have epa as the naive
    // leader (SPR trails EPA by 0.03pp in 2016 combined and qualification,
    // inside the near-tie threshold). What stays invariant is the
    // DIRECTION, asserted at the bottom of this test -- the real rule only
    // ever withholds emphasis.
    expect(diverged).toHaveLength(11);
    expect(diverged.every((d) => d.metric === "accuracy")).toBe(true);
    expect(diverged.every((d) => d.naive.length === 1)).toBe(true);
    expect(diverged.filter((d) => d.naive[0] === "epa")).toHaveLength(2);
    expect(diverged.filter((d) => d.naive[0] === "spr")).toHaveLength(9);

    // Five of the eleven sit in elimination play, where the samples are
    // smallest and near-ties therefore most common.
    const eliminationDivergences = diverged.filter((d) => d.view === "elimination");
    expect(eliminationDivergences).toHaveLength(5);

    function decisionFor(view: CompareCompLevelView, season: number, metric: "brier" | "accuracy") {
      const found = diverged.find((d) => d.view === view && d.season === season && d.metric === metric);
      if (found === undefined) throw new Error(`expected a divergence at ${view} ${season} ${metric}`);
      return found;
    }

    // Named individually, so a failure states which case moved.
    decisionFor("combined", 2016, "accuracy");
    decisionFor("combined", 2017, "accuracy");
    decisionFor("combined", 2023, "accuracy");
    decisionFor("qualification", 2016, "accuracy");
    decisionFor("qualification", 2017, "accuracy");
    decisionFor("qualification", 2023, "accuracy");
    decisionFor("elimination", 2016, "accuracy");
    decisionFor("elimination", 2017, "accuracy");
    decisionFor("elimination", 2020, "accuracy");
    decisionFor("elimination", 2022, "accuracy");
    decisionFor("elimination", 2023, "accuracy");

    // Every divergence is the real rule WITHHOLDING emphasis the naive
    // strawman would have applied — never the reverse. That direction is the
    // point of the lock: the near-tie rule can only ever decline to call a
    // winner, never invent one.
    for (const d of diverged) {
      expect(d.computed).toHaveLength(0);
      expect(d.naive.length).toBeGreaterThan(0);
    }
  });
});

describe("/compare route — named real-data regression cases (elimination view)", () => {
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

  it("2023 elimination Winner Accuracy renders no bold at all — SPR leads but inside the near-tie threshold", async () => {
    // SPR leads 2023 elimination accuracy, but by less than the near-tie
    // threshold, so the rule withholds emphasis from EVERY cell rather than
    // bolding just the leader. Asserting the whole row is unbolded is the
    // stronger claim, and it is the same case the divergence lock above
    // names as `elimination 2023 accuracy`.
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellIsBold(2023, "spr", "accuracy")).toBe(false));
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(readCellIsBold(2023, algorithmId, "accuracy"), `${algorithmId} must not be bold`).toBe(false);
    }
  });

  it("2022 elimination Winner Accuracy renders no bold at all, even though OPR leads — the withheld leader is not the site's own model", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined());
    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "opr", "accuracy")).not.toBe(""));
    expect(readCellIsBold(2022, "opr", "accuracy")).toBe(false);
    expect(readCellIsBold(2022, "epa", "accuracy")).toBe(false);
    expect(readCellIsBold(2022, "spr", "accuracy")).toBe(false);
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
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

    const columnCountAfter = within(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).getAllByRole("row")[2]!.querySelectorAll('[role="cell"], td').length;
    expect(columnCountAfter).toBe(columnCountBefore);
    expect(screen.getAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toHaveLength(1);
  });
});

describe("/compare route — MethodologyNote", () => {
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

  it("the note renders the highlight sentence and is unchanged by switching the view", async () => {
    mockFetch();
    renderCompareRoute();
    // NOTE: `screen.getByRole("table")` alone is satisfied by
    // `AccuracyTableSkeleton`'s own `<Table>` too — the populated branch
    // (where MethodologyNote mounts) isn't proven until a REAL cell's text
    // has landed, matching every other test in this file's established
    // double-wait discipline.
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

    expect(screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent).toBe(HIGHLIGHT_NOTE);

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("elimination")));
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).toBe(FIXTURES_BY_YEAR[2022]!.slices.find((s) => s.algorithmId === "spr" && s.compLevelView === "elimination")!.brierScore!.toFixed(4)));

    expect(screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent).toBe(HIGHLIGHT_NOTE);
  });

  it("the note block is a DOM sibling of the accuracy table's scroll region, not a descendant of it", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

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

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: COMPARE_PAGE_TITLE })).toBeDefined());
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("columnheader", { name: "Year" })).toBeDefined();
  });
});

describe("/compare route — Calibration section (sketch 006-C cards, fixture parity)", () => {
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

  /** The fixture-recomputed headline sentence for one card — the SAME pure model the component renders through. */
  function expectedSentence(year: number, algorithmId: PublishedAlgorithmId, view: string): string {
    const card = buildCalibrationCard(calibrationSliceFor(year, algorithmId, view));
    if (card.headline === null) throw new Error("fixture unexpectedly has no valid bins");
    return cardHeadlineSentence(algorithmDisplayLabel(algorithmId), card.headline);
  }

  it("default render: EVERY card carries its own fixture-recomputed 2026 combined-view headline sentence", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

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
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

    fireEvent.click(screen.getByTestId(compLevelSegmentTestId("qualification")));

    await waitFor(() =>
      expect(screen.getByTestId(calibrationCardSentenceTestId("opr")).textContent).toContain(expectedSentence(2026, "opr", "qualification")),
    );
  });

  it("changing the year Select to 2024 re-derives the cards from the 2024 artifact with zero additional fetches", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));
    await waitFor(() => expect(screen.getByTestId(calibrationCardSentenceTestId("spr")).textContent).not.toBe(""));
    const fetchCallCountBefore = calibrationFetchCalls.length;

    fireEvent.click(screen.getByTestId(CALIBRATION_YEAR_SELECT_TESTID));
    fireEvent.click(await screen.findByRole("option", { name: "2024" }));

    await waitFor(() =>
      expect(screen.getByTestId(calibrationCardSentenceTestId("spr")).textContent).toContain(expectedSentence(2024, "spr", "combined")),
    );
    expect(calibrationFetchCalls.length).toBe(fetchCallCountBefore);
  });

  it("every published bin renders as a row — populated rows as \"predicted → actual\" with counts, empty bins as the verbatim empty-range sentence, never hidden", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

    const slice = calibrationSliceFor(2026, "spr", "combined");
    const card = buildCalibrationCard(slice);
    const cardEl = await screen.findByTestId(calibrationCardTestId("spr"));
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
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));

    expect(screen.getByText(CALIBRATION_EXPLAINER)).toBeDefined();
    expect(CALIBRATION_EXPLAINER).toContain("below the line means too confident");
    expect(CALIBRATION_EXPLAINER).not.toContain("above the line means too confident");
    expect(CALIBRATION_EXPLAINER).toContain("above means too cautious");
  });
});

/**
 * The page's pending and error branches across its three sections (accuracy
 * table, note, calibration), the static lead, and the absence of the retired
 * data coverage section (removed 2026-09-17, sketch 017).
 */
describe("/compare route — lead, pending and error branches", () => {
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

  it("pending: title, lead and switcher render, the section skeletons render, and none of the populated-only sections' content appears", async () => {
    global.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/compare/2026.json")) return new Promise<Response>(() => {});
      const match = /\/v1\/compare\/(\d+)\.json$/.exec(url);
      const year = match ? Number(match[1]) : undefined;
      const body = year !== undefined ? FIXTURES_BY_YEAR[year] : undefined;
      return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status: 200 }));
    }) as typeof fetch;

    renderCompareRoute();

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: COMPARE_PAGE_TITLE })).toBeDefined());
    expect(screen.getByTestId(COMPARE_LEAD_TESTID).textContent).toBe(COMPARE_LEAD);
    expect(screen.getByRole("group", { name: "Match type" })).toBeDefined();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));

    expect(within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).getByRole("table")).toBeDefined();

    // The methodology note and calibration section mount ONLY in the
    // populated branch.
    expect(screen.queryByTestId(METHODOLOGY_NOTE_TESTID)).toBeNull();
    expect(screen.queryByTestId(CALIBRATION_SECTION_TESTID)).toBeNull();
  });

  it("error: the lead still renders, exactly one error line and one Retry control render, and no section's own test id appears", async () => {
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
    expect(screen.getByTestId(COMPARE_LEAD_TESTID).textContent).toBe(COMPARE_LEAD);

    expect(screen.queryByTestId(COMPARE_ACCURACY_SCROLL_TESTID)).toBeNull();
    expect(screen.queryByTestId(METHODOLOGY_NOTE_TESTID)).toBeNull();
    expect(screen.queryByTestId(CALIBRATION_SECTION_TESTID)).toBeNull();
  });

  it("populated: the calibration section is the last section, exactly one table renders, and no data coverage section exists", async () => {
    mockFetch();
    renderCompareRoute();
    await waitFor(() => expect(readCellText(2022, "spr", "brier")).not.toBe(""));
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SECTION_TESTID)).toBeDefined());

    const calibration = screen.getByTestId(CALIBRATION_SECTION_TESTID);
    const siblings = Array.from(calibration.parentElement!.children);
    expect(siblings.indexOf(calibration)).toBe(siblings.length - 1);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(document.querySelector('[data-testid^="compare-data-coverage"]')).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/data coverage/i);
  });

  it("the lead and the note carry no hyphen minus, en dash or em dash", () => {
    for (const text of [COMPARE_PAGE_TITLE, COMPARE_LEAD, HIGHLIGHT_NOTE, CALIBRATION_EXPLAINER]) {
      expect(text).not.toMatch(/[-\u2013\u2014]/);
    }
  });
});
