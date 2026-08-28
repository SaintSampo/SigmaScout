/**
 * Route-level coverage for `/event/$eventKey` (07-01-PLAN.md Task 3).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/team.$teamNumber.test.tsx` does — `Route.update({...})` mirrors
 * exactly what the auto-generated `routeTree.gen.ts` does at `vite
 * build`/`vite dev` time, so the REAL exported `Route` object from
 * `event.$eventKey.tsx` is under test, not a re-implementation of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { Route as EventRouteImport } from "./event.$eventKey.js";

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [{ id: "sigma1", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }],
    }),
    { status: 200 },
  );
}

const SIGMA1_2024_COMPONENT_KEYS = [
  "autoLeave",
  "autoAmpNote",
  "autoSpeakerNote",
  "teleopAmpNote",
  "teleopSpeakerNote",
  "teleopSpeakerNoteAmplified",
  "endGameOnStage",
  "endGamePark",
  "endGameHarmony",
  "endGameNoteInTrap",
  "endGameSpotLightBonus",
  "adjust",
  "foulsCommitted",
];

function eventArtifactResponse() {
  const metrics: Record<string, { value: number; spread?: number }> = { total: { value: 48.33, spread: 2.32 } };
  for (const key of SIGMA1_2024_COMPONENT_KEYS) {
    metrics[key] = { value: 10, spread: 1 };
  }
  return new Response(
    JSON.stringify({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithmId: "sigma1",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics }],
    }),
    { status: 200 },
  );
}

function renderEventRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const eventRoute = EventRouteImport.update({
    id: "/event/$eventKey",
    path: "/event/$eventKey",
    getParentRoute: () => rootRoute,
  } as never);
  const routeTree = rootRoute.addChildren([eventRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("/event/$eventKey route — invalid event key (07-01-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the invalid-event-key message and fires no event artifact fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve(manifestResponse()));
    global.fetch = fetchMock;

    renderEventRoute("/event/notanevent?algorithm=sigma1");

    await waitFor(() => expect(screen.getByText('"notanevent" is not a valid event key.')).toBeDefined());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/v1/event/"))).toBe(false);
  });
});

describe("/event/$eventKey route — tab strip and states (07-01-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("the Breakdown tab trigger renders from first paint, before any artifact data exists (strip gates content, not its own existence)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {}); // artifact never resolves
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Breakdown" })).toBeDefined());
  });

  it("?tab=quals (unregistered) resolves to the Breakdown panel, same as ?tab=breakdown", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1&tab=quals");
    await waitFor(() => expect(screen.getByTestId("breakdown-panel")).toBeDefined());

    cleanup();
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1&tab=breakdown");
    await waitFor(() => expect(screen.getByTestId("breakdown-panel")).toBeDefined());
  });

  it("a mocked 404 artifact response renders the empty state naming the event key, with no button", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a mocked 500 artifact response renders the ErrorState with the event key substituted, plus Retry", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("the pending state renders the Breakdown skeleton and zero progressbar elements", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1");

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a populated artifact whose season is 2024, loaded at ?year=2026, renders the sixteen sigma1/2024 column headers — the column set follows artifact.season, not ?year=", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?year=2026&algorithm=sigma1");

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(16));
  });

  it("the tab-strip scroll region and the Breakdown table's own scroll region are DOM siblings, never nested in either direction", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=sigma1");

    await waitFor(() => expect(screen.getByTestId("breakdown-table-scroll")).toBeDefined());
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    const tableScroll = screen.getByTestId("breakdown-table-scroll");
    expect(tabStrip.contains(tableScroll)).toBe(false);
    expect(tableScroll.contains(tabStrip)).toBe(false);
  });
});
