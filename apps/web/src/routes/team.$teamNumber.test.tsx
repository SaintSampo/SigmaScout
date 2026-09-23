/**
 * Route-level coverage for `/team/$teamNumber` (06-01-PLAN.md Tasks 2/3).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/__root.test.tsx` does — `Route.update({...})` mirrors exactly what
 * the auto-generated `routeTree.gen.ts` does at `vite build`/`vite dev`
 * time, so the REAL exported `Route` object from `team.$teamNumber.tsx` is
 * under test, not a re-implementation of it. Depending on the app's own
 * `routeTree.gen.ts` here would make this test's pass/fail depend on
 * whichever build last touched the routes directory (`__root.test.tsx`'s own
 * documented reason for this pattern).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { Route as TeamRouteImport } from "./team.$teamNumber.js";

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [{ id: "spr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }],
    }),
    { status: 200 },
  );
}

function teamArtifactResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      teamKey: "frc1114",
      teamNumber: 1114,
      nickname: "Simbotics",
      season: 2024,
      seasonStats: { record: { wins: 35, losses: 28, ties: 0 }, metrics: { total: { value: 48.33, spread: 2.32 } } },
      events: [],
      metricHistory: [],
    }),
    { status: 200 },
  );
}

function renderTeamRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamRoute = TeamRouteImport.update({
    id: "/team/$teamNumber",
    path: "/team/$teamNumber",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("/team/$teamNumber route — invalid team number", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the invalid-team-number message and fires no team artifact fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve(manifestResponse()));
    global.fetch = fetchMock;

    renderTeamRoute("/team/notateam?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByText('"notateam" is not a valid team number.')).toBeDefined());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/v1/team/"))).toBe(false);
  });
});

describe("/team/$teamNumber route — tab shell", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("?tab= absent defaults to the Overview panel", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {})); // manifest never resolves — irrelevant to which panel is shown
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("overview-panel")).toBeDefined());
    expect(screen.queryByTestId("metric-history-panel")).toBeNull();
  });

  it("?tab=history renders the metric-history-panel placeholder", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    renderTeamRoute("/team/1114?year=2024&algorithm=spr&tab=history");

    await waitFor(() => expect(screen.getByTestId("metric-history-panel")).toBeDefined());
  });

  it("both tab triggers are present and clickable before the artifact resolves (E8)", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toBeDefined());
    expect(screen.getByRole("tab", { name: "Metric History" })).toBeDefined();
  });
});

describe("/team/$teamNumber route — states", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("a mocked 500 artifact response renders the ErrorState with the team number substituted, plus Retry", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByText("Couldn't load team 1114 for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("a mocked 404 artifact response renders the year-mismatch empty state, not the generic error", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByText("Team 1114 didn't compete in 2024")).toBeDefined());
    expect(screen.queryByText("Couldn't load team 1114 for 2024.")).toBeNull();
  });

  it("the pending state renders at least two event-section skeleton cards and no progressbar", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {}); // team artifact never resolves
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getAllByTestId("event-section-skeleton").length).toBeGreaterThanOrEqual(2));
    // 06-07-PLAN.md Task 2: the route's pending branch renders
    // `SeasonHeaderSkeleton`, not the retired `TeamHeaderSkeleton`.
    expect(screen.getByTestId("season-header-skeleton")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a populated artifact renders the season header and record inside the Overview panel", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(teamArtifactResponse());
    });
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Simbotics"));
    expect(screen.getByText("35-28-0")).toBeDefined();
  });
});

/**
 * THE OVERLAY IS GONE (quick task 260923-3w7), and this describe is what
 * replaced its five cases.
 *
 * What stood here: a robot page that fetched each live EVENT's artifact, priced
 * its schedule-only upcoming rows in the browser from a `state` block, read its
 * per-match metrics out of an ephemeral `live` block, and discovered events its
 * own published file had never heard of through a live-windows manifest plus a
 * per-event roster object. Every one of those inputs existed because the tick
 * wrote no team artifact (260915-isq, 260917-jr4, 260918-16t, 260921-5qw), and
 * 260923-3w6 put the tick's own priced upcoming rows and per-team writes back.
 *
 * So the claim worth pinning is now a NEGATIVE one, and it is the whole point of
 * the change: this page reads one file. A published row's price comes from the
 * artifact it is in.
 */
describe("/team/$teamNumber route — one artifact, no overlay (260923-3w7)", () => {
  const originalFetch = global.fetch;
  const NOW = Date.parse("2024-03-09T18:00:00.000Z");

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const roster = { redTeams: ["frc1114", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] };

  /** A team artifact mid-event: one played row and one still-upcoming row the TICK priced. */
  function teamArtifactWithEvent(sortTime: number, startDate: string) {
    const row = (overrides: Record<string, unknown>) => ({
      season: 2024,
      eventKey: "2024casf",
      compLevel: "qm",
      algorithmId: "spr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      setNumber: 1,
      ...roster,
      ...overrides,
    });
    return new Response(
      JSON.stringify({
        schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
        generation: "tick-1",
        computedAt: "2024-03-09T17:59:00.000Z",
        algorithmId: "spr",
        algorithmVersion: "2.0.0+tuned-2026-08",
        teamKey: "frc1114",
        teamNumber: 1114,
        nickname: "Simbotics",
        season: 2024,
        seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 48.33, spread: 2.32 } } },
        events: [
          {
            eventKey: "2024casf",
            eventName: "San Francisco Regional",
            startDate,
            matches: [
              row({ matchKey: "2024casf_qm8", matchNumber: 8, sortTime: sortTime - 600_000, predictedWinner: "red", pRedWin: 0.55, predictedRedScore: 50, predictedBlueScore: 45, actualWinner: "red", actualRedScore: 61, actualBlueScore: 40 }),
              row({ matchKey: "2024casf_qm9", matchNumber: 9, sortTime, predictedWinner: "red", pRedWin: 0.91, predictedRedScore: 77, predictedBlueScore: 33 }),
            ],
          },
        ],
        metricHistory: [],
      }),
      { status: 200 },
    );
  }

  /** Every URL fetched, in order — the assertion surface for "one file". */
  function renderWithFetchLog(): string[] {
    const urls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(teamArtifactWithEvent(NOW + 600_000, "2024-03-07"));
    }) as unknown as typeof global.fetch;
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");
    return urls;
  }

  it("renders the team artifact's own priced upcoming row and fetches NO event artifact", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const urls = renderWithFetchLog();

    await waitFor(() => expect(screen.getByTestId("confidence-2024casf_qm9").textContent).toContain("91%"));
    expect(screen.getAllByTestId("match-row-2024casf_qm9")).toHaveLength(1);
    expect(screen.getByTestId("predicted-score-2024casf_qm9-red").textContent).toContain("77");
    expect(urls.filter((url) => url.includes("/v1/event/"))).toEqual([]);
  });

  it("the played row's result comes from the same file, with no second fetch to recover it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const urls = renderWithFetchLog();

    await waitFor(() => expect(screen.getByTestId("actual-2024casf_qm8").textContent).toContain("61"));
    expect(urls.filter((url) => url.includes("/v1/event/"))).toEqual([]);
  });

  it("reads NO live-windows manifest and NO live roster: an event the tick promoted is in this artifact's own events list", async () => {
    // 260921-5qw's discovery pair existed because the tick wrote no team file,
    // so a promoted event could not appear in one. `mergeTeamSeasonArtifact`
    // creates the event's entry on the tick that folds the team's first match
    // there, which is the same instant discovery used to fire.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const urls = renderWithFetchLog();

    await waitFor(() => expect(screen.getByTestId("event-section-2024casf")).toBeDefined());
    expect(urls.filter((url) => url.includes("live-windows"))).toEqual([]);
    expect(urls.filter((url) => url.includes("live-roster"))).toEqual([]);
  });

  it("fetches exactly two distinct artifacts: this team's file and the events/{year} file the official snapshot needs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const urls = renderWithFetchLog();

    await waitFor(() => expect(screen.getByTestId("event-section-2024casf")).toBeDefined());
    const artifacts = [...new Set(urls.filter((url) => !url.includes("manifest")))];
    expect(artifacts).toHaveLength(2);
    expect(artifacts.some((url) => url.includes("/v1/team/frc1114/2024/"))).toBe(true);
    expect(artifacts.some((url) => url.includes("/v1/events/2024/"))).toBe(true);
  });
});
