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

/**
 * The lazy pricer chunk, stubbed for the live-overlay describe below only
 * (every other test's artifacts carry no state block, so pricing never
 * runs). It stands in for `priceUpcomingFromState`, whose exact parity is
 * proven in `eventPricing.parity.test.ts`; here it proves the wiring: fetch,
 * resolve, overlay, render.
 */
vi.mock("../lib/eventPricing.lazy.js", () => ({
  priceArtifactUpcoming: async (artifact: { upcoming: Array<Record<string, unknown>>; season: number; eventKey: string; algorithmId: string; algorithmVersion: string }) => {
    const upcoming = artifact.upcoming.map((row): Record<string, unknown> => ({ ...row, predictedWinner: "red", pRedWin: 0.91, predictedRedScore: 77, predictedBlueScore: 33, redMatchBandVariance: 49 }));
    const upcomingTeamRows = Object.fromEntries(
      upcoming.map((row) => [
        String(row.matchKey),
        { ...row, season: artifact.season, eventKey: artifact.eventKey, algorithmId: artifact.algorithmId, algorithmVersion: artifact.algorithmVersion },
      ]),
    );
    return { upcoming, upcomingTeamRows };
  },
}));

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

describe("/team/$teamNumber route — live event overlay (260915-m4j)", () => {
  const originalFetch = global.fetch;
  const NOW = Date.parse("2024-03-09T18:00:00.000Z");
  const EVENT_URL = "https://data.sigmascout.org/v1/event/2024casf/spr@2.0.0+tuned-2026-08.json";

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const roster = { redTeams: ["frc1114", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] };

  function teamArtifactWithEvent(sortTime: number, startDate: string) {
    const stale = {
      matchKey: "2024casf_qm9",
      season: 2024,
      eventKey: "2024casf",
      compLevel: "qm",
      algorithmId: "spr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      predictedWinner: "red",
      pRedWin: 0.55,
      predictedRedScore: 50,
      predictedBlueScore: 45,
      setNumber: 1,
      matchNumber: 9,
      sortTime,
      ...roster,
    };
    return new Response(
      JSON.stringify({
        schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
        generation: "gen-1",
        computedAt: "2024-03-08T00:00:00.000Z",
        algorithmId: "spr",
        algorithmVersion: "2.0.0+tuned-2026-08",
        teamKey: "frc1114",
        teamNumber: 1114,
        nickname: "Simbotics",
        season: 2024,
        seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 48.33, spread: 2.32 } } },
        events: [{ eventKey: "2024casf", eventName: "San Francisco Regional", startDate, matches: [stale] }],
        metricHistory: [],
      }),
      { status: 200 },
    );
  }

  function eventArtifactResponse() {
    return new Response(
      JSON.stringify({
        schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
        generation: "tick-1",
        computedAt: "2024-03-09T17:59:00.000Z",
        algorithmId: "spr",
        algorithmVersion: "2.0.0+tuned-2026-08",
        eventKey: "2024casf",
        season: 2024,
        matches: [],
        eventType: 0,
        // The Worker's shape: schedule-only upcoming rows priced in the browser from the block.
        upcoming: [{ matchKey: "2024casf_qm9", compLevel: "qm", setNumber: 1, matchNumber: 9, sortTime: NOW + 600_000, ...roster }],
        teams: [],
        state: {
          algorithmId: "spr",
          algorithmVersion: "2.0.0+tuned-2026-08",
          snapshotShapeVersion: 1,
          rows: [{ algorithmId: "spr", algorithmVersion: "2.0.0+tuned-2026-08", scopeKind: "league", scopeKey: "league", stateJson: "{}", generation: "tick-1", computedAt: "2024-03-09T17:59:00.000Z" }],
        },
      }),
      { status: 200 },
    );
  }

  it("a team with an unplayed match within 7 days fetches that event's artifact at its real URL and renders its prices", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/event/")) return Promise.resolve(eventArtifactResponse());
      return Promise.resolve(teamArtifactWithEvent(NOW + 600_000, "2024-03-07"));
    });
    global.fetch = fetchMock;
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("confidence-2024casf_qm9").textContent).toContain("91%"));
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(EVENT_URL);
    expect(screen.getAllByTestId("match-row-2024casf_qm9")).toHaveLength(1);
    expect(screen.getByTestId("predicted-score-2024casf_qm9-red").textContent).toContain("77");
  });

  /**
   * THE OVERLAY CLIFF, INVERTED ON PURPOSE (quick task 260917-jr4, D-05
   * unsound part 1). This test used to assert the OPPOSITE: a long-finished
   * event fetched no event artifact, and the page rendered the team
   * artifact's own published 55% row.
   *
   * That was correct only while the live Worker rewrote team artifacts every
   * tick — the published row would already carry the result. The Worker now
   * writes none, so gating the fetch on `eventScheduleIsCurrent` would leave a
   * FINISHED event rendering as unplayed from the moment its 7-day window
   * closed until the next offline republish. `teamEventNeedsLivePricing` no
   * longer consults the schedule at all; it asks only whether an unplayed
   * published row exists.
   *
   * What it costs is asserted rather than assumed: exactly one extra
   * CDN-cached event fetch, and `shouldPollEventArtifact` still refuses to
   * POLL a dead event (`liveEvent.test.ts` pins that half).
   */
  it("a team whose events are all long finished STILL fetches the event artifact, so a finished event never renders as unplayed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-15T12:00:00.000Z"));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/event/")) return Promise.resolve(eventArtifactResponse());
      return Promise.resolve(teamArtifactWithEvent(NOW + 600_000, "2024-03-07"));
    });
    global.fetch = fetchMock;
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    // 91% is the EVENT artifact's price; 55% is the team artifact's published
    // one. Asserting the former is what proves the overlay ran at all.
    await waitFor(() => expect(screen.getByTestId("confidence-2024casf_qm9").textContent).toContain("91%"));
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(EVENT_URL);
  });

  it("makes exactly ONE artifact fetch per live event — the live rows cost no second request (260918-16t)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/event/")) return Promise.resolve(eventArtifactResponse());
      return Promise.resolve(teamArtifactWithEvent(NOW + 600_000, "2024-03-07"));
    });
    global.fetch = fetchMock;
    renderTeamRoute("/team/1114?year=2024&algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("confidence-2024casf_qm9").textContent).toContain("91%"));

    // Until 260918-16t this page issued a SECOND fetch per live event, for an
    // ephemeral metric object under its own R2 prefix. It does not any more:
    // the per-match metrics ride the event artifact it was already fetching.
    // Asserted as "every artifact URL touching this event is the event
    // artifact", so a reintroduced second fetcher fails here by URL.
    const eventUrls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("2024casf"));
    expect(eventUrls.length).toBeGreaterThan(0);
    expect(new Set(eventUrls)).toEqual(new Set([EVENT_URL]));
  });
});
