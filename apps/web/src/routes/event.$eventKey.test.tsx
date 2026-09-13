/**
 * Route-level coverage for `/event/$eventKey` (07-01-PLAN.md Task 3).
 *
 * Builds a small, SELF-CONTAINED route tree the same way
 * `routes/team.$teamNumber.test.tsx` does — `Route.update({...})` mirrors
 * exactly what the auto-generated `routeTree.gen.ts` does at `vite
 * build`/`vite dev` time, so the REAL exported `Route` object from
 * `event.$eventKey.tsx` is under test, not a re-implementation of it.
 *
 * 260913-nvn Task 3a collapsed the per-tab 404/500/pending/panel/scroll-
 * sibling/click-preserves-search coverage that used to be copied five times
 * (once per registered tab) into `it.each(TAB_CASES)` below. `stubFetch`
 * replaces the nine repeated `global.fetch = vi.fn(...)` literals with one
 * shared mock, and a single file-level `afterEach` replaces the nine
 * per-describe `originalFetch`/`afterEach` blocks (they all captured and
 * restored the exact same `global.fetch` regardless of which describe they
 * lived in, so collapsing to one is behavior-preserving).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { DEFAULT_EVENT_TAB, RootSearchSchema } from "../lib/searchParams.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION } from "../../../../packages/harness/pageArtifacts.js";
import { componentsInGroup } from "../../../../packages/core/algorithms/breakdown/index.js";
import { Route as EventRouteImport } from "./event.$eventKey.js";

const EPA_MANIFEST_ENTRY = { id: "epa", version: "7.0.0+baseline", codeVersion: "7.0.0", paramSetName: "baseline" };

function manifestResponse(extraAlgorithms: readonly (typeof EPA_MANIFEST_ENTRY)[] = []) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-24T00:00:00.000Z",
      algorithms: [{ id: "spr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" }, ...extraAlgorithms],
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
      algorithmId: "spr",
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

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The one shared fetch stub every it.each case below drives. The manifest
 * URL always resolves through `manifestResponse()`; the event-artifact
 * request resolves per `resolved`: `"pending"` never resolves, a `number`
 * resolves a `Response` at that HTTP status, and a `() => Response` factory
 * resolves whatever it returns (almost always `eventArtifactResponse(...)`).
 */
function stubFetch(resolved: "pending" | number | (() => Response)): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("manifest")) return Promise.resolve(manifestResponse());
    if (resolved === "pending") return new Promise<Response>(() => {});
    if (typeof resolved === "number") return Promise.resolve(new Response(resolved === 404 ? "not found" : "boom", { status: resolved }));
    return Promise.resolve(resolved());
  });
}

const ELIMS_PLAYED_MATCH = {
  matchKey: "2024casf_qf1m1",
  compLevel: "qf",
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
};

interface TabCase {
  readonly tab: "breakdown" | "insights" | "quals" | "alliances" | "elims";
  readonly triggerName: string;
  readonly scrollTestId: string;
  readonly artifact: () => Response;
}

/** One case per registered tab whose 404/500/pending/panel/scroll-sibling/click-preserves-search behaviour is otherwise byte-identical (07-VALIDATION.md's Wave 0 tab suite). Simulation is excluded — its SPR-gating gets its own describe block below (260913-nvn Task 1). */
const TAB_CASES: readonly TabCase[] = [
  { tab: "breakdown", triggerName: "Breakdown", scrollTestId: "breakdown-table-scroll", artifact: () => eventArtifactResponse() },
  { tab: "insights", triggerName: "Insights", scrollTestId: "insights-table-scroll", artifact: () => eventArtifactResponse() },
  { tab: "quals", triggerName: "Qualifications", scrollTestId: "quals-table-scroll", artifact: () => eventArtifactResponse({ matches: [], upcoming: [] }) },
  {
    tab: "alliances",
    triggerName: "Alliances",
    scrollTestId: "alliances-table-scroll",
    artifact: () => eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }),
  },
  { tab: "elims", triggerName: "Playoffs", scrollTestId: "elims-table-scroll", artifact: () => eventArtifactResponse({ matches: [ELIMS_PLAYED_MATCH] }) },
];

describe("/event/$eventKey route — invalid event key (07-01-PLAN.md Task 1)", () => {
  it("renders the invalid-event-key message and fires no event artifact fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.resolve(manifestResponse()));
    global.fetch = fetchMock;

    renderEventRoute("/event/notanevent?algorithm=spr");

    await waitFor(() => expect(screen.getByText('"notanevent" is not a valid event key.')).toBeDefined());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/v1/event/"))).toBe(false);
  });
});

describe("/event/$eventKey route — per-tab 404/500/pending/panel/scroll-sibling/click-preserves-search (07-VALIDATION.md Wave 0, collapsed by 260913-nvn Task 3a)", () => {
  it.each(TAB_CASES)("$tab: a mocked 404 artifact response renders the empty state naming the event key, with no button", async ({ tab }) => {
    stubFetch(404);
    renderEventRoute(`/event/2024casf?algorithm=spr&tab=${tab}`);

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(TAB_CASES)("$tab: a mocked 500 artifact response renders the ErrorState with the event key substituted, plus Retry", async ({ tab }) => {
    stubFetch(500);
    renderEventRoute(`/event/2024casf?algorithm=spr&tab=${tab}`);

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  // Breakdown and Insights render `[data-slot="skeleton"]` without a
  // `-table-scroll` testid in their pending state; Quals/Alliances/Elims
  // (all built on `EventMatchTableSkeleton`) render both. Waiting on the
  // skeleton slot rather than `scrollTestId` covers every case without
  // weakening either original assertion (both are still true where the
  // testid also renders — see the DOM-siblings case below for that check).
  it.each(TAB_CASES)("$tab: the pending state renders at least one skeleton and zero progressbar elements", async ({ tab }) => {
    stubFetch("pending");
    renderEventRoute(`/event/2024casf?algorithm=spr&tab=${tab}`);

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it.each(TAB_CASES)("$tab: the resolved artifact renders the $tab panel visible, with a different registered panel hidden", async ({ tab, artifact }) => {
    stubFetch(artifact);
    renderEventRoute(`/event/2024casf?algorithm=spr&tab=${tab}`);

    await waitFor(() => expect(screen.getByTestId(`${tab}-panel`).hasAttribute("hidden")).toBe(false));
    const otherTab = tab === "breakdown" ? "insights" : "breakdown";
    expect(screen.getByTestId(`${otherTab}-panel`).hasAttribute("hidden")).toBe(true);
  });

  it.each(TAB_CASES)(
    "$tab: the tab-strip scroll region and the $tab table's own scroll region are DOM siblings, never nested in either direction",
    async ({ tab, scrollTestId, artifact }) => {
      stubFetch(artifact);
      renderEventRoute(`/event/2024casf?algorithm=spr&tab=${tab}`);

      await waitFor(() => expect(screen.getByTestId(scrollTestId)).toBeDefined());
      const tabStrip = screen.getByTestId("event-tab-strip-scroll");
      const tableScroll = screen.getByTestId(scrollTestId);
      expect(tabStrip.contains(tableScroll)).toBe(false);
      expect(tableScroll.contains(tabStrip)).toBe(false);
    },
  );

  it.each(TAB_CASES)("$tab: clicking the trigger navigates to ?tab=$tab while preserving the existing year and algorithm search params", async ({ tab, triggerName, artifact }) => {
    stubFetch(artifact);
    const startTab = tab === "breakdown" ? "insights" : "breakdown";
    const router = renderEventRoute(`/event/2024casf?algorithm=spr&year=2024&tab=${startTab}`);

    const trigger = await screen.findByRole("tab", { name: triggerName });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    // Radix's `TabsTrigger` activates on `onMouseDown` (not `onClick`) —
    // `fireEvent.mouseDown` is the event that actually drives its
    // `onValueChange`, matching the primary-button, no-ctrl-key branch its
    // own source checks (`event.button === 0`).
    fireEvent.mouseDown(trigger, { button: 0 });

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.tab).toBe(tab);
      expect(search.algorithm).toBe("spr");
      expect(search.year).toBe(2024);
    });
  });
});

describe("/event/$eventKey route — tab strip and states (07-01-PLAN.md Task 3)", () => {
  // Merges the four duplicated "six tabs in order from first paint" tests
  // (07-11's Insights describe, 07-13's Elims describe, the Elims-fifth
  // test, and the Breakdown first-paint test) into one (260913-nvn Task 3a).
  it("exactly six tabs exist, named Insights, Breakdown, Qualifications, Alliances, Playoffs and Simulation IN THAT ORDER, before any artifact data resolves (08-09-PLAN.md registers Simulation, the last of EVENT_TABS)", async () => {
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(6));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Insights", "Breakdown", "Qualifications", "Alliances", "Playoffs", "Simulation"]);
  });

  it("spr: the Breakdown tab renders Team #, Team Name, Total and the three phase columns only, with no Fouls Committed column and no phase toggles (quick task 260913-mgn)", async () => {
    stubFetch(() => eventArtifactResponse());
    // Explicit ?tab=breakdown (plan 07-18 Task 2 flipped the no-param default
    // to insights) — this case tests Breakdown's OWN column set, not
    // "whichever tab is active by default".
    renderEventRoute("/event/2024casf?year=2026&algorithm=spr&tab=breakdown");

    await waitFor(() => expect(screen.getAllByTestId(/^breakdown-header-/)).toHaveLength(6));
    expect(screen.getAllByTestId(/^breakdown-header-/).map((el) => el.getAttribute("data-testid"))).toEqual(
      ["teamNumber", "nickname", "total", "phaseAuto", "phaseTeleop", "phaseEndgame"].map((id) => `breakdown-header-${id}`),
    );
    expect(screen.queryByTestId("breakdown-group-row")).toBeNull();
  });

  it("epa: a populated artifact whose season is 2024, loaded at ?year=2026, expands Auto into the 2024 auto components (sketch 009-A drill-down, 260905-3rq) — the column set follows artifact.season, not ?year=", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest")) return Promise.resolve(manifestResponse([EPA_MANIFEST_ENTRY]));
      return Promise.resolve(eventArtifactResponse({ algorithmId: EPA_MANIFEST_ENTRY.id, algorithmVersion: EPA_MANIFEST_ENTRY.version }));
    });
    renderEventRoute("/event/2024casf?year=2026&algorithm=epa&tab=breakdown");

    const headerIds = () => screen.getAllByTestId(/^breakdown-header-/).map((el) => el.getAttribute("data-testid")?.replace("breakdown-header-", ""));
    // Collapsed: Team #, Team Name, Total, the three phase columns, Fouls Committed.
    await waitFor(() => expect(headerIds()).toEqual(["teamNumber", "nickname", "total", "phaseAuto", "phaseTeleop", "phaseEndgame", "foulsCommitted"]));
    // Expanded: the Auto phase column is replaced in place by the 2024 auto components.
    fireEvent.click(screen.getByTestId("breakdown-group-toggle-auto"));
    await waitFor(() =>
      expect(headerIds()).toEqual(["teamNumber", "nickname", "total", ...componentsInGroup(2024, "auto"), "phaseTeleop", "phaseEndgame", "foulsCommitted"]),
    );
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
    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(true);
  });

  // Test 6 (plan 07-18 Task 2; grown to six ids by 08-09-PLAN.md Task 3
  // PD-09): the registration invariant, pinned as a test rather than merely
  // relied upon — the same fact this task's precondition checked by reading
  // the source. `?algorithm=spr` is required now: the Simulation trigger
  // exists (has role "tab") whether enabled or disabled (D-04 is presentation,
  // not DOM absence), so this count assertion is unaffected either way.
  it("Test 6: REGISTERED_EVENT_TABS and EVENT_TABS hold the same six ids", async () => {
    const { EVENT_TABS } = await import("../lib/searchParams.js");
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr");
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(6));
    const registeredNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(registeredNames).toHaveLength(EVENT_TABS.length);
  });

  // Test 7 (plan 07-18 Task 2): an explicit non-default tab still renders,
  // unchanged from before the flip — contrast case proving the default
  // change did not turn every route into Insights regardless of ?tab=.
  it("Test 7: ?tab=breakdown still renders the Breakdown panel as active, explicit tab wins over the new default", async () => {
    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr&tab=breakdown");

    await waitFor(() => expect(screen.getByTestId("breakdown-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(true);
  });
});

describe("/event/$eventKey route — the Insights tab registered (07-11-PLAN.md Task 3)", () => {
  it("?tab=insights in the pending state renders the Insights skeleton and zero progressbar elements; ?tab=breakdown in the same state still renders the Breakdown skeleton", async () => {
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr&tab=insights");

    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0));
    expect(screen.queryByRole("progressbar")).toBeNull();
    // Quick task 260913-jkp: under spr (a Sigma-enabled algorithm) the
    // Insights skeleton's Total header already reads "Total ± Sigma"
    // (`InsightsTabSkeleton`'s own `totalColumnHeader` call) — this route
    // test slipped through 260913-jkp's own per-file test updates because it
    // renders through the whole route rather than `InsightsTab` directly.
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Rank",
      "Team #",
      "Team Name",
      "Record",
      "RP",
      "Total ± Sigma",
      "Auto",
      "Teleop",
      "Endgame",
    ]);
  });

  it("?tab=insights with a populated ranked artifact renders the nine Insights headers and no fallback banner; with an unranked artifact it renders the banner", async () => {
    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr&tab=insights");
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
    renderEventRoute("/event/2024casf?algorithm=spr&tab=insights");
    await waitFor(() => expect(screen.getByTestId("insights-fallback-banner")).toBeDefined());
  });
});

describe("/event/$eventKey route — the Alliances tab registered, D-17 disabled trigger (07-14-PLAN.md Task 3)", () => {
  it("with the artifact resolved and alliances absent, the Alliances trigger is disabled; with an empty array, likewise; with one alliance, it is enabled", async () => {
    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(true));
    cleanup();

    stubFetch(() => eventArtifactResponse({ alliances: [] }));
    renderEventRoute("/event/2024casf?algorithm=spr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(true));
    cleanup();

    stubFetch(() => eventArtifactResponse({ alliances: [{ allianceNumber: 1, picks: ["frc254"] }] }));
    renderEventRoute("/event/2024casf?algorithm=spr");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Alliances" }).hasAttribute("disabled")).toBe(false));
  });

  it("the disabled trigger's accessible name is still 'Alliances' with no icon, badge, title or aria-describedby", async () => {
    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr");
    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(true));
    expect(trigger.textContent).toBe("Alliances");
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });

  it("while the query is pending, the Alliances trigger is NOT disabled — the state is unknown", async () => {
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr");
    const trigger = await screen.findByRole("tab", { name: "Alliances" });
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  it("with a mocked error response, the Alliances trigger is NOT disabled", async () => {
    stubFetch(500);
    renderEventRoute("/event/2024casf?algorithm=spr");
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
    const router = renderEventRoute("/event/2024casf?algorithm=spr");

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
    stubFetch(() => eventArtifactResponse());
    const router = renderEventRoute("/event/2024casf?algorithm=spr&tab=alliances");

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
});

describe("/event/$eventKey route — the identity header (07-15-PLAN.md Task 1)", () => {
  it("Test 13: a populated artifact renders the h1 carrying the artifact's name, and the header is a DOM sibling of the tab strip in both directions", async () => {
    stubFetch(() => eventArtifactResponse({ name: "San Francisco Regional", startDate: "2024-03-07", location: "CA, USA", week: 1 }));
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("San Francisco Regional"));
    const header = screen.getByTestId("event-header");
    const tabStrip = screen.getByTestId("event-tab-strip-scroll");
    expect(header.contains(tabStrip)).toBe(false);
    expect(tabStrip.contains(header)).toBe(false);
  });

  it("Test 14: the pending state renders the header skeleton alongside the tab strip", async () => {
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getByTestId("event-header-skeleton")).toBeDefined());
    expect(screen.getByRole("tab", { name: "Breakdown" })).toBeDefined();
  });

  it("Test 15: a mocked 404 and separately a mocked 500 render no header and no header skeleton, and the existing empty/error state assertions still pass", async () => {
    stubFetch(404);
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getByText("No published results for 2024casf yet")).toBeDefined());
    expect(screen.queryByTestId("event-header")).toBeNull();
    expect(screen.queryByTestId("event-header-skeleton")).toBeNull();
    cleanup();

    stubFetch(500);
    renderEventRoute("/event/2024casf?algorithm=spr");

    await waitFor(() => expect(screen.getByText("Couldn't load event 2024casf for 2024.")).toBeDefined());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.queryByTestId("event-header")).toBeNull();
    expect(screen.queryByTestId("event-header-skeleton")).toBeNull();
  });
});

describe("/event/$eventKey route — the Simulation tab, SPR-gated (D-04, 260913-nvn)", () => {
  // 260913-nvn: `isSimulationDisabled` is `!usesSigmaScore(algorithm)`, so the
  // trigger is enabled for SPR and disabled for OPR/EPA — the boolean still
  // resolves before any data does.
  it("with the artifact fetch left permanently pending, the Simulation trigger is enabled for spr and disabled for epa and opr", async () => {
    for (const [algorithm, expectedDisabled] of [
      ["spr", false],
      ["epa", true],
      ["opr", true],
    ] as const) {
      stubFetch("pending");
      renderEventRoute(`/event/2024casf?algorithm=${algorithm}`);
      await waitFor(() => expect(screen.getByRole("tab", { name: "Simulation" }).hasAttribute("disabled")).toBe(expectedDisabled));
      cleanup();
    }
  });

  it("the enabled spr trigger has no title, no aria-label and no aria-describedby, and its textContent is exactly 'Simulation'; for opr the wrapper span's title is the SPR-only sentence", async () => {
    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=spr");
    const trigger = await screen.findByRole("tab", { name: "Simulation" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    expect(trigger.textContent).toBe("Simulation");
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
    cleanup();

    stubFetch("pending");
    renderEventRoute("/event/2024casf?algorithm=opr");
    const oprTrigger = await screen.findByRole("tab", { name: "Simulation" });
    await waitFor(() => expect(oprTrigger.hasAttribute("disabled")).toBe(true));
    expect(oprTrigger.parentElement?.getAttribute("title")).toBe("Simulation is only available on SPR. Switch the algorithm selector to SPR.");
  });

  it("?algorithm=opr&tab=simulation shows the Insights panel while the URL's tab search param still reads 'simulation' (resolve-only, never rewritten); ?algorithm=spr&tab=simulation shows the Simulation panel", async () => {
    stubFetch(() => eventArtifactResponse());
    const oprRouter = renderEventRoute("/event/2024casf?algorithm=opr&tab=simulation");

    await waitFor(() => expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("simulation-panel").hasAttribute("hidden")).toBe(true);
    expect((oprRouter.state.location.search as Record<string, unknown>).tab).toBe("simulation");
    cleanup();

    stubFetch(() => eventArtifactResponse());
    renderEventRoute("/event/2024casf?algorithm=spr&tab=simulation");

    await waitFor(() => expect(screen.getByTestId("simulation-panel").hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("insights-panel").hasAttribute("hidden")).toBe(true);
  });
});
