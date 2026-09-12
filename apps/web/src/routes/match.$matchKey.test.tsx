/**
 * Route-level coverage for `/match/$matchKey` (260909-tiq-PLAN.md Task 1).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/event.$eventKey.test.tsx` does — `Route.update({...})` mirrors
 * exactly what the auto-generated `routeTree.gen.ts` does at `vite
 * build`/`vite dev` time, so the REAL exported `Route` object from
 * `match.$matchKey.tsx` is under test, not a re-implementation of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { Route as MatchRouteImport } from "./match.$matchKey.js";

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

function eventArtifactResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      name: "San Francisco Regional",
      matches: [],
      upcoming: [],
      teams: [],
      ...overrides,
    }),
    { status: 200 },
  );
}

const PLAYED_MATCH = {
  matchKey: "2024casf_qm1",
  compLevel: "qm",
  setNumber: 1,
  matchNumber: 1,
  redTeams: ["frc254"],
  blueTeams: ["frc118"],
  predictedWinner: "red",
  pRedWin: 0.6,
  predictedRedScore: 120,
  predictedBlueScore: 100,
  actualWinner: "red",
  actualRedScore: 130,
  actualBlueScore: 90,
  video: "dQw4w9WgXcQ",
};

const UPCOMING_MATCH = {
  matchKey: "2024casf_qm2",
  compLevel: "qm",
  setNumber: 2,
  matchNumber: 2,
  redTeams: ["frc254"],
  blueTeams: ["frc118"],
  predictedWinner: "red",
  pRedWin: 0.55,
  predictedRedScore: 110,
  predictedBlueScore: 90,
};

function renderMatchRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const matchRoute = MatchRouteImport.update({
    id: "/match/$matchKey",
    path: "/match/$matchKey",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([matchRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("/match/$matchKey route — invalid match key (260909-tiq-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the invalid-match-key message and fires no event artifact fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve(manifestResponse()));
    global.fetch = fetchMock;

    renderMatchRoute("/match/notamatchkey?algorithm=spr");

    await waitFor(() => expect(screen.getByText('"notamatchkey" is not a valid match key.')).toBeDefined());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/v1/event/"))).toBe(false);
  });
});

describe("/match/$matchKey route — states (260909-tiq-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("a mocked 404 artifact response renders the empty state naming the event key, with no button", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderMatchRoute("/match/2024casf_qm1?algorithm=spr");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a mocked 500 artifact response renders the ErrorState with the match key substituted, the SEASON DERIVED FROM THE MATCH KEY (2024), plus Retry — even with a mismatched ?year=2026", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderMatchRoute("/match/2024casf_qm1?algorithm=spr&year=2026");

    await waitFor(() => expect(screen.getByText("Couldn't load match 2024casf_qm1 for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("the pending state renders the skeleton and zero progressbar elements", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderMatchRoute("/match/2024casf_qm1?algorithm=spr");

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a match key that parses but is absent from the artifact renders the not-published EmptyState", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ matches: [PLAYED_MATCH] }));
    });
    renderMatchRoute("/match/2024casf_qm999?algorithm=spr");

    await waitFor(() => expect(screen.getByText("No match 2024casf_qm999 published for this event")).toBeDefined());
  });

  it("a populated PLAYED match renders the label, the single table row, and the video trigger", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ matches: [PLAYED_MATCH] }));
    });
    renderMatchRoute("/match/2024casf_qm1?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("match-row-2024casf_qm1")).toBeDefined());
    // "Qual 1" renders twice by design — once in the heading, once in the
    // single-row table's own Match column (`matchLabel(row)` in both places).
    expect(screen.getAllByText("Qual 1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("match-video-trigger-2024casf_qm1")).toBeDefined();
    // Played: actual score renders.
    expect(screen.getByTestId("actual-2024casf_qm1-red")).toBeDefined();
  });

  it("a populated UPCOMING match renders with no video trigger and no actual score", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ upcoming: [UPCOMING_MATCH] }));
    });
    renderMatchRoute("/match/2024casf_qm2?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("match-row-2024casf_qm2")).toBeDefined());
    expect(screen.getAllByText("Qual 2").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("match-video-trigger-2024casf_qm2")).toBeNull();
    // Unplayed rows show no actual-score testid at all (EventMatchTable only
    // renders the scheduled-time span for an unplayed row).
    expect(screen.queryByTestId("actual-2024casf_qm2-red")).toBeNull();
  });
});

describe("/match/$matchKey route — the six roster team artifacts (260909-tiq-PLAN.md Task 2)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches the team artifact for every resolved roster key, and the match row/table paint BEFORE any of those six fetches resolve", async () => {
    const teamFetchUrls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("/v1/team/")) {
        teamFetchUrls.push(url);
        return new Promise<Response>(() => {}); // never resolves
      }
      return Promise.resolve(eventArtifactResponse({ matches: [PLAYED_MATCH] }));
    });
    renderMatchRoute("/match/2024casf_qm1?algorithm=spr");

    // The heading/table paint from the event artifact alone, with the six
    // team-artifact fetches left permanently pending.
    await waitFor(() => expect(screen.getByTestId("match-row-2024casf_qm1")).toBeDefined());
    expect(screen.getByTestId("match-table-scroll")).toBeDefined();

    await waitFor(() => expect(teamFetchUrls.filter((url) => url.includes("/v1/team/frc254/")).length).toBeGreaterThan(0));
    expect(teamFetchUrls.some((url) => url.includes("/v1/team/frc118/"))).toBe(true);

    // Each robot card renders its own pending skeleton rather than a blank —
    // a pending fetch is not an absence.
    await waitFor(() => expect(screen.getByTestId("robot-card-frc254")).toBeDefined());
    expect(screen.getByTestId("robot-card-frc254").querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
