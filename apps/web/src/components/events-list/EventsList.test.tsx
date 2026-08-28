/**
 * 05-07-PLAN.md Task 2's fixture-driven coverage: an offseason row renders
 * the badge and no week number; a fully null-location row renders em-dashes
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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders em-dashes for a fully null-location fixture and no literal null text", async () => {
    const events = makeRows([makeRow({ country: null, stateProv: null, districtKey: null })]);
    const { container } = render(
      <TestHarness>
        <EventsList status="success" events={events} {...BASE_PROPS} />
      </TestHarness>,
    );

    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)); // location cell + district cell
    expect(container.textContent).not.toMatch(/\bnull\b/i);
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

    const weekHeader = await screen.findByRole("button", { name: /Week/ });
    fireEvent.click(weekHeader);
    expect(onSortChange).toHaveBeenCalledWith("week");
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

    // districtKey is also null by default in `makeRow`, so the both-null
    // case renders TWO em-dash-titled cells (location + district) — assert
    // at least one rather than a single unique match.
    const bothNull = makeRows([makeRow({ eventKey: "2025d", stateProv: null, country: null })]);
    render(
      <TestHarness>
        <EventsList status="success" events={bothNull} {...BASE_PROPS} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getAllByTitle("—").length).toBeGreaterThanOrEqual(1));
  });
});
