/**
 * 05-07-PLAN.md Task 2's fixture-driven coverage: an offseason row renders
 * the badge and no week number; a fully null-location row renders blanks
 * and no literal "null" text; the four states render correctly; a long
 * event name is not truncated in the source string, only in the layout.
 *
 * 07-15-PLAN.md Task 2 makes the event-name cell a router `Link` — every
 * render now needs a router context whose tree carries a
 * `to="/event/$eventKey"` route, the same `ChildrenContext`/`RouteBody`/
 * `TestHarness` technique `teams-table/TeamsTable.test.tsx` already built for
 * exactly this situation, narrowed to `/events` and `/event/$eventKey`.
 * TanStack Router resolves its initial match asynchronously even against a
 * memory history, so every test's first assertion goes through `waitFor` —
 * matching `TeamsTable.test.tsx`'s own established pattern — before any
 * synchronous follow-up assertion against the now-settled DOM.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { DEFAULT_EVENT_TAB, EventSearchSchema, EventsSearchSchema, RootSearchSchema } from "@/lib/searchParams";
import { EventsList } from "./EventsList";
import type { EventRow } from "./filterModel";

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const eventsRoute = createRoute({ path: "/events", getParentRoute: () => rootRoute, validateSearch: EventsSearchSchema, component: RouteBody });
    const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, validateSearch: EventSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([eventsRoute, eventRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/events"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

function makeRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    eventKey: "2025alhu",
    name: "Rocket City Regional",
    eventType: 0,
    isOffseason: false,
    startDate: "2025-03-12",
    week: 2,
    teamCount: 44,
    matchCount: 96,
    playedMatchCount: 96,
    country: "USA",
    stateProv: "AL",
    districtKey: null,
    ...overrides,
  };
}

function makeRows(events: EventsArtifact["events"]): EventRow[] {
  return EventsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2025,
    events,
  }).events;
}

const noop = () => {};

/** Every fixed prop `EventsList` needs besides `events`, threaded once. */
const BASE_PROPS = {
  year: 2025,
  algorithm: "vpr" as const,
  hasActiveFilter: false,
  onClearFilters: noop,
  onRetry: noop,
  sortKey: "startDate" as const,
  sortDir: "asc" as const,
  onSortChange: noop,
};

describe("EventsList", () => {
  it("renders the Offseason badge and no week number for a null-week fixture", async () => {
    const events = makeRows([makeRow({ isOffseason: true, week: null })]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getByText("Offseason")).toBeDefined());
    expect(screen.queryByText("2")).toBeNull();
  });

  it("renders BLANK location and district cells for a fully null-location fixture, with no em-dash and no literal null text", async () => {
    const events = makeRows([makeRow({ country: null, stateProv: null, districtKey: null })]);
    const { container } = render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    // 2026-09-01: an absent fact renders as an EMPTY cell, never an em-dash.
    // Indexed off the one data row's own cells (COLUMNS order: Event, Type,
    // Date, Location, District, Teams, Matches) so the assertion proves both
    // cells still EXIST and are blank, rather than merely proving a glyph is
    // missing from the page.
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[3]!.textContent).toBe("");
    expect(cells[4]!.textContent).toBe("");
    expect(container.textContent).not.toContain("—");
    expect(container.textContent).not.toMatch(/\bnull\b/i);
  });

  /**
   * WR-01 (review 260902): `2026isde1`, `2026isde2` and `2026iscmp` carry raw
   * weeks 16/17/18 in the published 2026 events artifact. The Type chip's
   * blind `week + 1` labelled these real, official, 208-played-match district
   * events "Week 17", "Week 18" and "Week 19" — the only visible type label
   * their rows carried. See `filterModel.test.ts` for the pinned fixture and
   * its verification against the live artifact.
   */
  it("renders no invented season week on the Type chip for an out-of-band TBA week", async () => {
    const events = makeRows([
      makeRow({ eventKey: "2026isde1", name: "ISR District Event #1", eventType: 1, week: 16, districtKey: "isr" }),
      makeRow({ eventKey: "2026isde2", name: "ISR District Event #2", eventType: 1, week: 17, districtKey: "isr" }),
      makeRow({ eventKey: "2026iscmp", name: "FIRST Israel District Championship", eventType: 2, week: 18, districtKey: "isr" }),
    ]);
    const { container } = render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(4));
    for (const nonsense of ["Week 17", "Week 18", "Week 19"]) {
      expect(container.textContent).not.toContain(nonsense);
    }
    expect(screen.getAllByText("Other")).toHaveLength(3);
  });

  it("still renders the 1-indexed season week on the Type chip for an in-band week", async () => {
    const events = makeRows([makeRow({ week: 3 })]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getByText("Week 4")).toBeDefined());
  });

  it("renders the empty-state copy for a zero-length list", async () => {
    render(
      <TestHarness>
        <EventsList status="success" events={[]} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getByText("No events match your filters")).toBeDefined());
  });

  it("renders an inline Clear filters action in the empty state only when a filter is active", async () => {
    const onClearFilters = vi.fn();
    render(
      <TestHarness>
        <EventsList status="success" events={[]} {...BASE_PROPS} hasActiveFilter={true} onClearFilters={onClearFilters} />
      </TestHarness>,
    );

    const clearButton = await screen.findByText("Clear filters");
    fireEvent.click(clearButton);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("renders one ordinary row with no special layout for a single-event list", async () => {
    const events = makeRows([makeRow()]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2)); // header row + one data row
  });

  it("renders skeleton rows together with real column headers while loading", async () => {
    render(
      <TestHarness>
        <EventsList status="pending" events={[]} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getByText("Event")).toBeDefined());
    // WR-04 (260902-post-phase08-ungoverned-ui/REVIEW.md): the column's label
    // now names the axis it sorts (week), not the Type chip cell it heads.
    expect(screen.getByText("Week")).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("renders the contract's error copy and invokes Retry", async () => {
    const onRetry = vi.fn();
    render(
      <TestHarness>
        <EventsList status="error" events={[]} {...BASE_PROPS} onRetry={onRetry} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getByText("Couldn't load events for 2025.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps a long event name intact in the source string, truncating only via layout", async () => {
    const longName = "The Extremely Long Sponsor-Heavy Regional Championship Presented By A Very Long Company Name";
    const events = makeRows([makeRow({ name: longName })]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    const link = await screen.findByRole("link", { name: longName });
    expect(link.getAttribute("title")).toBe(longName);
    expect(link.textContent).toBe(longName);
  });

  it("clicking a sortable header reports the clicked column key", async () => {
    const onSortChange = vi.fn();
    const events = makeRows([makeRow()]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} onSortChange={onSortChange} />
      </TestHarness>,
    );

    // WR-04: the header's label changed to "Week"; the sort key it reports
    // stays "week" — this test's onSortChange expectation was already
    // correct and does not change.
    const weekHeader = await screen.findByRole("button", { name: /Week/ });
    fireEvent.click(weekHeader);
    expect(onSortChange).toHaveBeenCalledWith("week");
  });

  // ---------------------------------------------------------------------
  // 260902-rax Task 2 — the sort buttons' hit area was ~40x14 to ~59x14,
  // well under the project's own 44x44 `.tap-target` convention
  // (theme.css:395). The fix adds an invisible, full-cell overlay button
  // purely to widen the CLICKABLE area; the original visible button is
  // untouched (so column auto-width and the visible header stay
  // pixel-identical — verified live against the running dev server, not
  // in this jsdom suite, which has no real layout engine to measure
  // against).
  // ---------------------------------------------------------------------
  it("each sortable header cell carries exactly one ACCESSIBLE button, plus a hidden pointer-only overlay that fires the same onSortChange", async () => {
    const onSortChange = vi.fn();
    const events = makeRows([makeRow()]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} onSortChange={onSortChange} />
      </TestHarness>,
    );

    // WR-04: this header's accessible name changed from "Type" to "Week".
    const typeHeader = (await screen.findByRole("columnheader", { name: /Week/ })) as HTMLElement;
    const buttonsInCell = within(typeHeader).getAllByRole("button", { hidden: true });
    // Exactly two <button> elements exist in the DOM (visible + overlay)...
    expect(buttonsInCell).toHaveLength(2);
    // ...but only ONE is exposed to the accessibility tree/tab order.
    const accessibleButtons = within(typeHeader).getAllByRole("button");
    expect(accessibleButtons).toHaveLength(1);
    expect(accessibleButtons[0]!.textContent).toBe("Week");

    const overlay = buttonsInCell.find((button) => button !== accessibleButtons[0]);
    expect(overlay).toBeDefined();
    expect(overlay!.getAttribute("aria-hidden")).toBe("true");
    expect(overlay!.getAttribute("tabindex")).toBe("-1");

    // The hidden overlay is a real, functioning click target for the same
    // column — not decoration.
    fireEvent.click(overlay!);
    expect(onSortChange).toHaveBeenCalledWith("week");
  });

  it("a non-sortable header (Location) is unchanged — no button, hidden or otherwise", async () => {
    const events = makeRows([makeRow()]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );
    const locationHeader = await screen.findByText("Location");
    expect(within(locationHeader.closest("th")!).queryAllByRole("button", { hidden: true })).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 07-15-PLAN.md Task 2 — the row link that makes /event/{eventKey} reachable
  // -------------------------------------------------------------------------

  it("Test 1: the row links to /event/{eventKey}, carrying the threaded year, algorithm and DEFAULT_EVENT_TAB", async () => {
    const events = makeRows([makeRow({ eventKey: "2025alhu", name: "Rocket City Regional" })]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} year={2025} algorithm="vpr" />
      </TestHarness>,
    );

    const link = await screen.findByRole("link", { name: "Rocket City Regional" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/event/2025alhu");
    expect(href).toContain("year=2025");
    expect(href).toContain("algorithm=vpr");
    expect(href).toContain(`tab=${DEFAULT_EVENT_TAB}`);
  });

  it("Test 2: the link is the name cell, not the row — every other cell exposes no link", async () => {
    const events = makeRows([makeRow()]);
    render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
  });

  it("Test 3: the location cell delegates to composeEventLocation's own four cases, proven by behaviour not by import", async () => {
    const both = makeRows([makeRow({ eventKey: "2025a", stateProv: "CA", country: "USA" })]);
    const { unmount: unmountBoth } = render(
      <TestHarness>
        <EventsList status="success" events={both} {...BASE_PROPS} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTitle("CA, USA")).toBeDefined());
    unmountBoth();

    const nullState = makeRows([makeRow({ eventKey: "2025b", stateProv: null, country: "USA" })]);
    const { unmount: unmountNullState } = render(
      <TestHarness>
        <EventsList status="success" events={nullState} {...BASE_PROPS} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTitle("USA")).toBeDefined());
    unmountNullState();

    const nullCountry = makeRows([makeRow({ eventKey: "2025c", stateProv: "CA", country: null })]);
    const { unmount: unmountNullCountry } = render(
      <TestHarness>
        <EventsList status="success" events={nullCountry} {...BASE_PROPS} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTitle("CA")).toBeDefined());
    unmountNullCountry();

    // Fourth case: both null, so `composeEventLocation` returns null and the
    // cell renders BLANK (2026-09-01 — no em-dash placeholders anywhere).
    // Asserted on the Location cell itself (COLUMNS index 3), which proves
    // the cell survives while its text is empty.
    const bothNull = makeRows([makeRow({ eventKey: "2025d", stateProv: null, country: null })]);
    render(
      <TestHarness>
        <EventsList status="success" events={bothNull} {...BASE_PROPS} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const locationCell = within(screen.getAllByRole("row")[1]!).getAllByRole("cell")[3]!;
    expect(locationCell.textContent).toBe("");
  });
});
