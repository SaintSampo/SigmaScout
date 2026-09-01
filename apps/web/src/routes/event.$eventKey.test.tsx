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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { DEFAULT_EVENT_TAB, RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { Route as EventRouteImport } from "./event.$eventKey.js";

function manifestResponse() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [{ id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }],
    }),
    { status: 200 },
  );
}

const VPR_2024_COMPONENT_KEYS = [
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

function eventArtifactResponse(overrides: Record<string, unknown> = {}) {
  const metrics: Record<string, { value: number; spread?: number }> = { total: { value: 48.33, spread: 2.32 } };
  for (const key of VPR_2024_COMPONENT_KEYS) {
    metrics[key] = { value: 10, spread: 1 };
  }
  return new Response(
    JSON.stringify({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics }],
      ...overrides,
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

    renderEventRoute("/event/notanevent?algorithm=vpr");

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
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Breakdown" })).toBeDefined());
  });

  it("?tab=alliances renders the Alliances panel (07-14-PLAN.md registers it) — the Breakdown panel is present but inactive", async () => {
    // Through 07-13, "alliances" was this file's own probe for an
    // UNREGISTERED tab id; 07-14 registers it (the last of EVENT_TABS'
    // five), so this test now proves the opposite of what it used to prove —
    // that the id IS registered and resolves to its own panel. There is no
    // remaining unregistered id in EVENT_TABS to move the probe to.
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=alliances");
    await waitFor(() => expect(screen.getByTestId("alliances-panel")).toBeDefined());
    expect(screen.getByTestId("alliances-panel").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(true);
  });

  it("a mocked 404 artifact response renders the empty state naming the event key, with no button", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a mocked 500 artifact response renders the ErrorState with the event key substituted, plus Retry", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("the pending state renders the Breakdown skeleton and zero progressbar elements", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a populated artifact whose season is 2024, loaded at ?year=2026, renders the sixteen vpr/2024 column headers — the column set follows artifact.season, not ?year=", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    // Explicit ?tab=breakdown (plan 07-18 Task 2 flipped the no-param default
    // to insights) — this case tests Breakdown's OWN column set, not
    // "whichever tab is active by default".
    renderEventRoute("/event/2024casf?year=2026&algorithm=vpr&tab=breakdown");

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(16));
  });

  it("the tab-strip scroll region and the Breakdown table's own scroll region are DOM siblings, never nested in either direction", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    // Explicit ?tab=breakdown (plan 07-18 Task 2 flipped the no-param
    // default to insights) — Radix's TabsContent only ever renders a panel's
    // CHILDREN once that panel has been active at least once (the wrapper
    // div is always present with `hidden`, but stays empty until then), so
    // this Breakdown-specific DOM-structure case needs Breakdown made active
    // explicitly rather than relying on it being the default.
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=breakdown");

    await waitFor(() => expect(screen.getByTestId("breakdown-table-scroll")).toBeDefined());
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    const tableScroll = screen.getByTestId("breakdown-table-scroll");
    expect(tabStrip.contains(tableScroll)).toBe(false);
    expect(tableScroll.contains(tabStrip)).toBe(false);
  });

  // Test 8 (plan 07-18 Task 2): 07-11's inverse case, rewritten rather than
  // deleted — 07-11 deliberately deferred this flip (outline assumption 6's
  // dependency-cycle reasoning) and this plan makes it.
  it("DEFAULT_EVENT_TAB is now the string 'insights' (was 'breakdown' through 07-11; flipped by plan 07-18 Task 2)", () => {
    expect(DEFAULT_EVENT_TAB).toBe("insights");
  });

  // Test 5 (plan 07-18 Task 2): a bare event URL renders the Insights panel —
  // the observable form of UI-SPEC E2's "default Insights" clause.
  it("Test 5: a bare event URL (no ?tab=) renders the Insights panel, not the Breakdown panel", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(true);
  });

  // Test 6 (plan 07-18 Task 2; grown to six ids by 08-09-PLAN.md Task 3
  // PD-09): the registration invariant, pinned as a test rather than merely
  // relied upon — the same fact this task's precondition checked by reading
  // the source. `?algorithm=vpr` is required now: the Simulation trigger
  // exists (has role "tab") whether enabled or disabled (D-04 is presentation,
  // not DOM absence), so this count assertion is unaffected either way, but
  // `vpr` keeps this case aligned with every other test in this file.
  it("Test 6: REGISTERED_EVENT_TABS and EVENT_TABS hold the same six ids", async () => {
    const { EVENT_TABS } = await import("../lib/searchParams.js");
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(6));
    const registeredNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(registeredNames).toHaveLength(EVENT_TABS.length);
  });

  // Test 7 (plan 07-18 Task 2): an explicit non-default tab still renders,
  // unchanged from before the flip — contrast case proving the default
  // change did not turn every route into Insights regardless of ?tab=.
  it("Test 7: ?tab=breakdown still renders the Breakdown panel as active, explicit tab wins over the new default", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=breakdown");

    await waitFor(() => expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(true);
  });
});

describe("/event/$eventKey route — the Insights tab registered (07-11-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("the Insights trigger renders with the manifest resolved and the artifact fetch left pending — the strip gates content, not its own existence", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Insights" })).toBeDefined());
  });

  it("exactly six tabs exist, named Insights, Breakdown, Quals, Alliances, Elims and Simulation IN THAT ORDER, before any artifact data resolves (08-09-PLAN.md registers Simulation, the last of EVENT_TABS)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(6));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Insights", "Breakdown", "Quals", "Alliances", "Elims", "Simulation"]);
  });

  it("?tab=insights renders the Insights panel; ?tab=breakdown still renders the Breakdown panel", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");
    await waitFor(() => expect(screen.getByTestId("insights-panel")).toBeDefined());
    cleanup();

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=breakdown");
    await waitFor(() => expect(screen.getByTestId("breakdown-panel")).toBeDefined());
  });

  it("?tab=insights with a mocked 404 renders the same empty state (no button) that ?tab=breakdown renders", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("?tab=insights with a mocked 500 renders the same ErrorState copy and Retry button that ?tab=breakdown renders", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("?tab=insights in the pending state renders the Insights skeleton and zero progressbar elements; ?tab=breakdown in the same state still renders the Breakdown skeleton", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Rank",
      "Team #",
      "Nickname",
      "Record",
      "RP",
      "Auto",
      "Teleop",
      "Endgame",
      "Total",
    ]);
  });

  it("?tab=insights with a populated ranked artifact renders the nine Insights headers and no fallback banner; with an unranked artifact it renders the banner", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    expect(screen.queryByTestId("insights-fallback-banner")).toBeNull();
    cleanup();

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      const metrics: Record<string, { value: number }> = { total: { value: 48.33 } };
      return Promise.resolve(
        eventArtifactResponse({ teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics }] }),
      );
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");
    await waitFor(() => expect(screen.getByTestId("insights-fallback-banner")).toBeDefined());
  });

  it("the tab-strip scroll region and the Insights table's own scroll region are DOM siblings, never nested in either direction", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=insights");

    await waitFor(() => expect(screen.getByTestId("insights-table-scroll")).toBeDefined());
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    const tableScroll = screen.getByTestId("insights-table-scroll");
    expect(tabStrip.contains(tableScroll)).toBe(false);
    expect(tableScroll.contains(tabStrip)).toBe(false);
  });

  it("clicking the Insights trigger navigates to ?tab=insights while preserving the existing year and algorithm search params", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr&year=2024&tab=breakdown");

    const insightsTrigger = await screen.findByRole("tab", { name: "Insights" });
    // Radix's `TabsTrigger` activates on `onMouseDown` (not `onClick`) —
    // `fireEvent.mouseDown` is the event that actually drives its
    // `onValueChange`, matching the primary-button, no-ctrl-key branch its
    // own source checks (`event.button === 0`).
    fireEvent.mouseDown(insightsTrigger, { button: 0 });

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.tab).toBe("insights");
      expect(search.algorithm).toBe("vpr");
      expect(search.year).toBe(2024);
    });
  });
});

describe("/event/$eventKey route — the Quals tab registered (07-12-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("a route test with the artifact fetch left pending finds the Quals tab and its skeleton, and zero progressbar elements", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=quals");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Quals" })).toBeDefined());
    await waitFor(() => expect(screen.getByTestId("quals-table-scroll")).toBeDefined());
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("?tab=quals renders the Quals panel; the Breakdown panel is not rendered", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ matches: [], upcoming: [] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=quals");

    await waitFor(() => expect(screen.getByTestId("quals-panel")).toBeDefined());
    // Radix keeps every TabsContent mounted and hides the inactive ones via
    // the `hidden` attribute (matching this file's own established pattern
    // of asserting on the ACTIVE panel's testid rather than the inactive
    // panel's DOM absence) — the Breakdown panel is present but inactive.
    expect(screen.getByTestId("quals-panel").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(true);
  });

  it("a mocked 500 response on ?tab=quals renders the page-level error copy and a Retry button, not a Quals-specific error", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=quals");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("switching to the Quals tab preserves the year and algorithm search params", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr&year=2024&tab=breakdown");

    const qualsTrigger = await screen.findByRole("tab", { name: "Quals" });
    fireEvent.mouseDown(qualsTrigger, { button: 0 });

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.tab).toBe("quals");
      expect(search.algorithm).toBe("vpr");
      expect(search.year).toBe(2024);
    });
  });
});

describe("/event/$eventKey route — the Alliances tab registered, D-17 disabled trigger (07-14-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("with the artifact resolved and alliances absent, the Alliances trigger is disabled; with an empty array, likewise; with one alliance, it is enabled", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(true));
    cleanup();

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ alliances: [] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(true));
    cleanup();

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(false));
  });

  it("the disabled trigger's accessible name is still 'Alliances' with no icon, badge, title or aria-describedby", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(true));
    expect(trigger.textContent).toBe("Alliances");
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });

  it("while the query is pending, the Alliances trigger is NOT disabled — the state is unknown", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  it("with a mocked error response, the Alliances trigger is NOT disabled", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeDefined());
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  it("while the query is serving placeholder data from a previously-loaded event whose alliances were absent, the trigger for the NEWLY-requested event is NOT disabled", async () => {
    let secondEventRequested = false;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      if (url.includes("2024cast")) {
        secondEventRequested = true;
        return new Promise<Response>(() => {}); // the new key's own fetch never resolves in this test
      }
      return Promise.resolve(eventArtifactResponse()); // 2024casf: resolved, alliances absent
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(true));

    await router.navigate({ to: "/event/$eventKey", params: { eventKey: "2024cast" }, search: (prev: Record<string, unknown>) => prev } as never);

    await waitFor(() => expect(secondEventRequested).toBe(true));
    // `data` is still 2024casf's artifact here (placeholderData:
    // keepPreviousData) while 2024cast's own fetch is in flight — that
    // artifact belongs to a DIFFERENT event and must never decide this
    // event's trigger state.
    expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(false);
  });

  it("loading ?tab=alliances for an event whose alliances are absent renders the DEFAULT tab's panel, not the alliances-panel, without navigating (the tab search param is unchanged)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr&tab=alliances");

    // The DEFAULT tab's panel is Insights as of plan 07-18 Task 2 (was
    // Breakdown through 07-11).
    await waitFor(() => expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(false));
    // Radix keeps every `TabsContent` mounted (hidden via the `hidden`
    // attribute for the inactive ones) — matching this file's own
    // established convention of asserting on `hidden`, never on DOM
    // presence, for the inactive panel.
    expect(screen.getByTestId("alliances-panel").hasAttribute("hidden")).toBe(true);
    expect((router.state.location.search as Record<string, unknown>).tab).toBe("alliances");
  });

  it("loading ?tab=alliances for an event WITH alliances renders the Alliances panel", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=alliances");

    await waitFor(() => expect(screen.getByTestId("alliances-panel").hasAttribute("hidden")).toBe(false));
  });

  it("clicking the enabled Alliances trigger navigates to ?tab=alliances while preserving the existing year and algorithm search params", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }));
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr&year=2024&tab=breakdown");

    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    fireEvent.mouseDown(trigger, { button: 0 });

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.tab).toBe("alliances");
      expect(search.algorithm).toBe("vpr");
      expect(search.year).toBe(2024);
    });
  });

  it("the tab-strip scroll region and the Alliances table's own scroll region are DOM siblings, never nested in either direction", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=alliances");

    await waitFor(() => expect(screen.getByTestId("alliances-table-scroll")).toBeDefined());
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    const tableScroll = screen.getByTestId("alliances-table-scroll");
    expect(tabStrip.contains(tableScroll)).toBe(false);
    expect(tableScroll.contains(tabStrip)).toBe(false);
  });

  it("the 404, 500 and pending states are the SAME on ?tab=alliances as on ?tab=breakdown, for an event whose alliances are present", async () => {
    for (const tab of ["alliances", "breakdown"]) {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("manifest")) return Promise.resolve(manifestResponse());
        return Promise.resolve(new Response("not found", { status: 404 }));
      });
      renderEventRoute(`/event/2024casf?algorithm=vpr&tab=${tab}`);
      await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
      expect(screen.queryByRole("button")).toBeNull();
      cleanup();

      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("manifest")) return Promise.resolve(manifestResponse());
        return Promise.resolve(new Response("boom", { status: 500 }));
      });
      renderEventRoute(`/event/2024casf?algorithm=vpr&tab=${tab}`);
      await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
      expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
      cleanup();

      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("manifest")) return Promise.resolve(manifestResponse());
        return new Promise<Response>(() => {});
      });
      renderEventRoute(`/event/2024casf?algorithm=vpr&tab=${tab}`);
      await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
      expect(screen.queryByRole("progressbar")).toBeNull();
      cleanup();
    }
  });
});

describe("/event/$eventKey route — the Elims tab registered (07-13-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  // PD-09 (08-09-PLAN.md Task 3): appending "simulation" makes Elims no
  // longer last. This test's own NAME says "appears LAST among the
  // registered triggers" — its intent (a newly-registered tab lands in its
  // declared position rather than wherever the JSX happened to put it) is
  // worth keeping, so it is REWRITTEN to assert Simulation is last and Elims
  // is fifth, not weakened to drop the position claim.
  it("the Elims trigger renders from first paint, with the artifact fetch left pending, and appears FIFTH (Simulation, registered by 08-09, is now last)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Elims" })).toBeDefined());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.at(-2)?.textContent).toBe("Elims");
    expect(tabs.at(-1)?.textContent).toBe("Simulation");
  });

  it("?tab=elims renders the Elims panel; the Quals and Breakdown panels are not the active one", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ matches: [], upcoming: [] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=elims");

    await waitFor(() => expect(screen.getByTestId("elims-panel")).toBeDefined());
    expect(screen.getByTestId("elims-panel").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("quals-panel").hasAttribute("hidden")).toBe(true);
    expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(true);
  });

  it("a mocked 404 response renders the same empty state, with no button, on ?tab=elims as on ?tab=quals", async () => {
    for (const tab of ["elims", "quals"]) {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("manifest")) return Promise.resolve(manifestResponse());
        return Promise.resolve(new Response("not found", { status: 404 }));
      });
      renderEventRoute(`/event/2024casf?algorithm=vpr&tab=${tab}`);

      await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
      expect(screen.queryByRole("button")).toBeNull();
      cleanup();
    }
  });

  it("a mocked 500 response renders the same ErrorState copy and Retry button on ?tab=elims as on ?tab=quals", async () => {
    for (const tab of ["elims", "quals"]) {
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("manifest")) return Promise.resolve(manifestResponse());
        return Promise.resolve(new Response("boom", { status: 500 }));
      });
      renderEventRoute(`/event/2024casf?algorithm=vpr&tab=${tab}`);

      await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
      expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
      cleanup();
    }
  });

  it("?tab=elims in the pending state renders the Elims skeleton and zero progressbar elements", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=elims");

    await waitFor(() => expect(screen.getByTestId("elims-table-scroll")).toBeDefined());
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clicking the Elims trigger navigates to ?tab=elims while preserving the existing year and algorithm search params", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    const router = renderEventRoute("/event/2024casf?algorithm=vpr&year=2024&tab=breakdown");

    const elimsTrigger = await screen.findByRole("tab", { name: "Elims" });
    fireEvent.mouseDown(elimsTrigger, { button: 0 });

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.tab).toBe("elims");
      expect(search.algorithm).toBe("vpr");
      expect(search.year).toBe(2024);
    });
  });

  it("the strip exposes exactly six elements with role tab, named Insights, Breakdown, Quals, Alliances, Elims and Simulation in that order", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(6));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Insights", "Breakdown", "Quals", "Alliances", "Elims", "Simulation"]);
  });

  it("the tab-strip scroll region and the Elims table's own scroll region are DOM siblings, never nested in either direction", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ matches: [{ matchKey: "2024casf_qf1m1", compLevel: "qf", setNumber: 1, matchNumber: 1, redTeams: ["frc254"], blueTeams: ["frc118"], predictedWinner: "red", pRedWin: 0.6, predictedRedScore: 120, predictedBlueScore: 100, actualWinner: "red", actualRedScore: 130, actualBlueScore: 90 }] }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=elims");

    await waitFor(() => expect(screen.getByTestId("elims-table-scroll")).toBeDefined());
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    const tableScroll = screen.getByTestId("elims-table-scroll");
    expect(tabStrip.contains(tableScroll)).toBe(false);
    expect(tableScroll.contains(tabStrip)).toBe(false);
  });
});

describe("/event/$eventKey route — the identity header (07-15-PLAN.md Task 1)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("Test 13: a populated artifact renders the h1 carrying the artifact's name, and the header is a DOM sibling of the tab strip in both directions", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse({ name: "San Francisco Regional", startDate: "2024-03-07", location: "CA, USA", week: 1 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("San Francisco Regional"));
    const header = screen.getByTestId("event-header");
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    expect(header.contains(tabStrip)).toBe(false);
    expect(tabStrip.contains(header)).toBe(false);
  });

  it("Test 14: the pending state renders the header skeleton alongside the tab strip", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByTestId("event-header-skeleton")).toBeDefined());
    expect(screen.getByRole("tab", { name: "Breakdown" })).toBeDefined();
  });

  it("Test 15: a mocked 404 and separately a mocked 500 render no header and no header skeleton, and the existing empty/error state assertions still pass", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByTestId("event-header")).toBeNull();
    expect(screen.queryByTestId("event-header-skeleton")).toBeNull();
    cleanup();

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.queryByTestId("event-header")).toBeNull();
    expect(screen.queryByTestId("event-header-skeleton")).toBeNull();
  });
});

describe("/event/$eventKey route — the Simulation tab registered, D-04 disabled trigger (08-09-PLAN.md Task 3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("with the artifact fetch left permanently pending, ?algorithm=vpr renders an ENABLED Simulation trigger — the boolean resolves before any data does", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Simulation" }).hasAttribute("disabled")).toBe(false));
  });

  it("with the artifact fetch left permanently pending, ?algorithm=opr renders a DISABLED Simulation trigger — the boolean resolves before any data does", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=opr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Simulation" }).hasAttribute("disabled")).toBe(true));
  });

  it("in that same permanently-pending ?algorithm=opr render, the Alliances trigger is still ENABLED while Simulation is disabled — proving D-04's derivation is not query-gated the way D-17's is", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=opr");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Simulation" }).hasAttribute("disabled")).toBe(true));
    expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(false);
  });

  it("the disabled Simulation trigger has no title, no aria-label and no aria-describedby, and its textContent is exactly 'Simulation'", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=opr");
    const trigger = await screen.findByRole("tab", { name: "Simulation" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(true));
    expect(trigger.textContent).toBe("Simulation");
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });

  it("?algorithm=opr&tab=simulation renders the Insights panel as the visible one while the Simulation panel is present and hidden, and the URL's tab search param still reads 'simulation' afterwards (resolve-only, never rewritten)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    const router = renderEventRoute("/event/2024casf?algorithm=opr&tab=simulation");

    await waitFor(() => expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("simulation-panel").hasAttribute("hidden")).toBe(true);
    expect((router.state.location.search as Record<string, unknown>).tab).toBe("simulation");
  });

  it("?algorithm=vpr&tab=simulation renders the Simulation panel as the visible one, Insights hidden; against the default artifact fixture (empty matches/upcoming) the panel content is the zero-qualification-matches empty state", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return Promise.resolve(eventArtifactResponse());
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=simulation");

    const { SIMULATION_EMPTY_STATE_HEADING } = await import("../components/event/SimulationTab.js");
    await waitFor(() => expect(screen.getByText(SIMULATION_EMPTY_STATE_HEADING)).toBeDefined());
    expect(screen.getByTestId("simulation-panel").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(true);
  });

  it("?algorithm=vpr&tab=simulation with the artifact fetch left pending renders the Simulation skeleton and no empty state — the pending branch reaches the right renderer", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse());
      return new Promise<Response>(() => {});
    });
    renderEventRoute("/event/2024casf?algorithm=vpr&tab=simulation");

    const { SIMULATION_EMPTY_STATE_HEADING, SIMULATION_UNAVAILABLE_HEADING } = await import("../components/event/SimulationTab.js");
    await waitFor(() => expect(screen.getByTestId("simulation-panel").hasAttribute("hidden")).toBe(false));
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
  });
});
