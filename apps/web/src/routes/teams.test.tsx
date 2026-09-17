/**
 * Route-level coverage for `/teams`'s bubble-chart toggle (Task 3,
 * 260909-tom-PLAN.md). Follows `routes/districts.test.tsx`'s pattern
 * exactly: a self-contained route tree built with `Route.update({...})`
 * (mirroring what the auto-generated `routeTree.gen.ts` does at build time),
 * a `QueryClientProvider`, and `global.fetch` stubbed with URL-matched
 * `Response` objects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { applyYearChange, RootSearchSchema, TeamSearchSchema, type TeamsSearch } from "../lib/searchParams.js";
import { Route as TeamsRouteImport } from "./teams.js";

/** The algorithms manifest — `useAlgorithmVersion`'s own gate on the artifact fetch firing at all. */
function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-09T00:00:00.000Z",
      algorithms: [
        { id: "spr", version: "2.0.0+tuned-2026-09", codeVersion: "2.0.0", paramSetName: "tuned-2026-09" },
        { id: "opr", version: "1.0.0+default", codeVersion: "1.0.0", paramSetName: "default" },
      ],
    }),
    { status: 200 },
  );
}

/**
 * The teams-table artifact. Four rows, per the plan's own fixture spec:
 * frc1 and frc2 both carry a Total and a published `sigma` metric entry, in
 * different countries; frc3 carries a Total and a published tier but NO
 * `sigma`; frc4 carries a
 * Total whose metric has NO `tier`.
 */
function teamsArtifactResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-09T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "2.0.0+tuned-2026-09",
      season: 2026,
      teams: [
        {
          teamKey: "frc1",
          teamNumber: 1,
          nickname: "USA Rare",
          eventCount: 3,
          matchCount: 30,
          record: { wins: 20, losses: 10, ties: 0 },
          // Sigma Score rides the published `sigma` metric entry. The old
          // top-level per-team field is no longer published (260913-g66).
          metrics: { total: { value: 50, tier: "rare" }, sigma: { value: 3.5 } },
          country: "USA",
        },
        {
          teamKey: "frc2",
          teamNumber: 2,
          nickname: "Canada Epic",
          eventCount: 2,
          matchCount: 20,
          record: { wins: 12, losses: 8, ties: 0 },
          metrics: { total: { value: 20, tier: "epic" }, sigma: { value: 1.2 } },
          country: "Canada",
        },
        {
          teamKey: "frc3",
          teamNumber: 3,
          nickname: "USA Legendary No Sigma",
          eventCount: 1,
          matchCount: 1,
          record: { wins: 1, losses: 0, ties: 0 },
          metrics: { total: { value: 80, tier: "legendary" } },
          // No `sigma` entry -- this algorithm/team publishes no consistency figure.
          country: "USA",
        },
        {
          teamKey: "frc4",
          teamNumber: 4,
          nickname: "USA Untiered",
          eventCount: 1,
          matchCount: 10,
          record: { wins: 5, losses: 5, ties: 0 },
          metrics: { total: { value: 10 }, sigma: { value: 0.5 } }, // No tier -> neutral.
          country: "USA",
        },
      ],
    }),
    { status: 200 },
  );
}

/**
 * Quick task 260913-g66: the same four teams as an OPR artifact publishes
 * them. Sigma Score is published for SPR only, so no row carries a `sigma`
 * metric entry at all.
 */
async function oprTeamsArtifactResponse(): Promise<Response> {
  const artifact = (await teamsArtifactResponse().json()) as {
    algorithmId: string;
    algorithmVersion: string;
    teams: { metrics: Record<string, unknown> }[];
  };
  artifact.algorithmId = "opr";
  artifact.algorithmVersion = "1.0.0+default";
  for (const team of artifact.teams) delete team.metrics.sigma;
  return new Response(JSON.stringify(artifact), { status: 200 });
}

function stubFetch(algorithmId: "spr" | "opr" = "spr") {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest")) return Promise.resolve(manifestResponse());
    if (url.includes("/v1/teams/")) return algorithmId === "opr" ? oprTeamsArtifactResponse() : Promise.resolve(teamsArtifactResponse());
    return new Promise<Response>(() => {});
  });
}

function renderTeamsRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamsRoute = TeamsRouteImport.update({
    id: "/teams",
    path: "/teams",
    getParentRoute: () => rootRoute,
  } as never);
  // Quick task 260909-v5v: a stub `/team/$teamNumber` child route so a
  // navigation fired by a bubble-chart click lands somewhere rather than
  // nowhere. Carries the REAL `TeamSearchSchema` (not a loose stand-in) so
  // the search object the route actually navigates with is validated by the
  // same schema the real page uses — a stub with a looser schema would let a
  // wrong search shape pass silently.
  const teamRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/team/$teamNumber",
    validateSearch: TeamSearchSchema,
    component: () => <div data-testid="team-page-stub" />,
  });
  const routeTree = rootRoute.addChildren([teamsRoute, teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, container };
}

/** Counts every `M` command across every `[data-tone]` path's `d` attribute — the plotted-dot count. */
function countDots(container: HTMLElement): number {
  return Array.from(container.querySelectorAll("[data-tone]")).reduce((sum, el) => {
    const d = el.getAttribute("d") ?? "";
    return sum + (d.match(/M/g) ?? []).length;
  }, 0);
}

/** `<test_strategy>` step 2 — left/top at zero, width equal to the svg's own width attribute, so client coordinates ARE svg coordinates. */
function stubRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 880, // BUBBLE_CHART.fallbackWidth
      height: 420, // BUBBLE_CHART.height
      right: 880,
      bottom: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Reads the first `M{cx},{cy}` pair out of a given tone path's `d`
 * attribute — the ATTRIBUTE THE COMPONENT ACTUALLY DREW, rather than
 * recomputing the projection in the test.
 */
function dotCoords(container: HTMLElement, tone: string): { x: number; y: number } {
  const el = container.querySelector(`[data-tone="${tone}"]`);
  const d = el?.getAttribute("d") ?? "";
  const match = /M([\d.-]+),([\d.-]+)/.exec(d);
  if (!match) throw new Error(`no M command found for tone "${tone}"`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("/teams route bubble-chart toggle", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("with no ?chart= param, renders the table and not the chart", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
  });

  it("arriving at /teams?chart=bubble renders the chart and not the table, with no click needed", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=spr&chart=bubble");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    expect(screen.queryByTestId("teams-table-scroll")).toBeNull();
  });

  it("?chart= carrying an unrecognised value resolves to the table", async () => {
    global.fetch = stubFetch();
    renderTeamsRoute("/teams?algorithm=spr&chart=pie");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
  });

  it("clicking the toggle writes chart=bubble into the URL and swaps to the chart; clicking again restores the table", async () => {
    global.fetch = stubFetch();
    const { router } = renderTeamsRoute("/teams?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    const toggle = screen.getByRole("button", { name: "Bubble chart" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).chart).toBe("bubble"));
    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    expect(screen.queryByTestId("teams-table-scroll")).toBeNull();
    const pressedToggle = screen.getByRole("button", { name: "Bubble chart" });
    expect(pressedToggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(pressedToggle);

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).chart).toBeUndefined());
    await waitFor(() => expect(screen.getByTestId("teams-table-scroll")).toBeDefined());
    expect(screen.queryByTestId("teams-bubble-chart")).toBeNull();
    expect(screen.getByRole("button", { name: "Bubble chart" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("with a region filter active, the plotted dot count equals the filtered rows that have both a Total and a Sigma Score", async () => {
    global.fetch = stubFetch();
    const { container } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&country=USA");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    // Filtered to country=USA: frc1, frc3, frc4 (frc2 is Canada). Of those,
    // frc3 has no `sigma` entry and is omitted -- exactly frc1 and frc4 plot.
    await waitFor(() => expect(countDots(container)).toBe(2));
  });

  it("under OPR the toggle still renders, and the chart shows the plain no-Sigma state with no axis", async () => {
    global.fetch = stubFetch("opr");
    const { container } = renderTeamsRoute("/teams?algorithm=opr&chart=bubble");

    await waitFor(() => expect(screen.getByTestId("bubble-chart-no-sigma")).toBeDefined());
    expect(screen.getByRole("button", { name: "Bubble chart" })).toBeDefined();
    const chart = screen.getByTestId("teams-bubble-chart");
    expect(chart.querySelector("svg")).toBeNull();
    expect(countDots(container)).toBe(0);
    expect(chart.textContent ?? "").toContain("Sigma Score is published for SPR only");
  });

  it("applyYearChange preserves the chart param across a year change", () => {
    const current: TeamsSearch = {
      year: 2026,
      algorithm: "spr",
      sort: undefined,
      sortDir: "desc",
      cols: undefined,
      country: undefined,
      state: undefined,
      district: undefined,
      chart: "bubble",
    };
    const next = applyYearChange(current, 2025);
    expect(next.chart).toBe("bubble");
  });

  it("clicking a plotted dot navigates to that team's page path, carrying the same year, algorithm and tab the table's team links carry", async () => {
    global.fetch = stubFetch();
    const { router, container } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&country=USA");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    await waitFor(() => expect(countDots(container)).toBe(2));

    // Scoped to the chart's own container: the page also renders decorative
    // `<svg>` icons (e.g. the country/state select triggers' chevrons), and
    // `container.querySelector("svg")` unscoped would grab whichever of
    // those happens to come first in DOM order.
    const chart = screen.getByTestId("teams-bubble-chart");
    const svg = chart.querySelector("svg")!;
    stubRect(svg);
    // frc1 (tier "rare", team number 1) -- the country=USA fixture's plotted rare dot.
    const { x, y } = dotCoords(chart as HTMLElement, "rare");
    fireEvent.click(svg, { clientX: x, clientY: y });

    await waitFor(() => expect(router.state.location.pathname).toBe("/team/1"));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2026);
    expect(search.algorithm).toBe("spr");
    expect(search.tab).toBe("overview");
  });

  it("clicking empty plot area on the chart leaves the location unchanged", async () => {
    global.fetch = stubFetch();
    const { router, container } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&country=USA");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    await waitFor(() => expect(countDots(container)).toBe(2));

    const chart = screen.getByTestId("teams-bubble-chart");
    const svg = chart.querySelector("svg")!;
    stubRect(svg);
    // The plot's top-left corner plus a couple of pixels -- no fixture point occupies this position.
    fireEvent.click(svg, { clientX: 2, clientY: 2 });

    expect(router.state.location.pathname).toBe("/teams");
  });
});

describe("/teams route bubble-chart colour toggle", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("clicking the Sigma segment writes tint=sigma into the location search while year, algorithm, sort, sortDir, country and chart each keep their prior value", async () => {
    global.fetch = stubFetch();
    const { router } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&country=USA&sort=total&sortDir=asc");

    await waitFor(() => expect(screen.getByTestId("bubble-chart-color-by")).toBeDefined());
    fireEvent.click(screen.getByTestId("bubble-chart-color-by-sigma"));

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).tint).toBe("sigma"));
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2026);
    expect(search.algorithm).toBe("spr");
    expect(search.sort).toBe("total");
    expect(search.sortDir).toBe("asc");
    expect(search.country).toBe("USA");
    expect(search.chart).toBe("bubble");
  });

  it("clicking the Total segment clears tint back to undefined while that same field set is preserved", async () => {
    global.fetch = stubFetch();
    const { router } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&country=USA&sort=total&sortDir=asc&tint=sigma");

    await waitFor(() => expect(screen.getByTestId("bubble-chart-color-by")).toBeDefined());
    fireEvent.click(screen.getByTestId("bubble-chart-color-by-total"));

    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).tint).toBeUndefined());
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.year).toBe(2026);
    expect(search.algorithm).toBe("spr");
    expect(search.sort).toBe("total");
    expect(search.sortDir).toBe("asc");
    expect(search.country).toBe("USA");
    expect(search.chart).toBe("bubble");
  });

  it("arriving at /teams?algorithm=spr&chart=bubble&tint=sigma colours by Sigma with no click", async () => {
    global.fetch = stubFetch();
    const { container } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble&tint=sigma");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    // Against the route fixture, every plotted row's sigma entry carries no
    // tier, so all three plotted rows (frc1, frc2, frc4 -- frc3 has no sigma
    // entry) are Common: exactly one [data-tone] path, "neutral", holding
    // three dots, and no rare or epic path at all.
    const chart = screen.getByTestId("teams-bubble-chart");
    await waitFor(() => expect(countDots(container)).toBe(3));
    const tonePaths = chart.querySelectorAll("[data-tone]");
    expect(tonePaths).toHaveLength(1);
    expect(tonePaths[0]!.getAttribute("data-tone")).toBe("neutral");
  });

  it("the same URL with tint absent yields the Total-tier grouping instead", async () => {
    global.fetch = stubFetch();
    const { container } = renderTeamsRoute("/teams?algorithm=spr&chart=bubble");

    await waitFor(() => expect(screen.getByTestId("teams-bubble-chart")).toBeDefined());
    const chart = screen.getByTestId("teams-bubble-chart");
    await waitFor(() => expect(countDots(container)).toBe(3));
    const tones = Array.from(chart.querySelectorAll("[data-tone]"))
      .map((el) => el.getAttribute("data-tone"))
      .sort();
    expect(tones).toEqual(["epic", "neutral", "rare"]);
  });

  it("applyYearChange preserves tint across a year change", () => {
    const current: TeamsSearch = {
      year: 2026,
      algorithm: "spr",
      sort: undefined,
      sortDir: "desc",
      cols: undefined,
      country: undefined,
      state: undefined,
      district: undefined,
      chart: "bubble",
      tint: "sigma",
    };
    const next = applyYearChange(current, 2025);
    expect(next.tint).toBe("sigma");
  });
});
