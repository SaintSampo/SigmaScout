/**
 * 05-07-PLAN.md Task 3's own listed test coverage: a control change writes
 * the expected filter patch; clearing invokes the clear callback; the
 * trigger badge/accessible-name reflect the active count; a dimension with
 * no distinct values renders disabled; the two layouts render their own
 * distinguishing element.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { EventFilters } from "./EventFilters";
import { useFilterSheetStore } from "@/stores/filterSheet";
import type { EventFilters as EventFiltersModel, EventRow } from "./filterModel";

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

const FIXTURE_EVENTS = makeRows([
  makeRow({ eventKey: "2025alhu", week: 2, country: "USA", stateProv: "AL", districtKey: null }),
  makeRow({ eventKey: "2025mimil", week: 3, country: "USA", stateProv: "MI", districtKey: "fim" }),
]);

function setMobile(isMobile: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: isMobile,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

const EMPTY_FILTERS: EventFiltersModel = {};

describe("EventFilters", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    useFilterSheetStore.setState({ isOpen: false });
    setMobile(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("renders the inline control row on desktop", () => {
    render(<EventFilters events={FIXTURE_EVENTS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    expect(screen.getByTestId("desktop-filter-row")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Open filters/ })).toBeNull();
  });

  it("renders the sheet trigger (with an Apply filters action inside) on a phone", () => {
    setMobile(true);
    render(<EventFilters events={FIXTURE_EVENTS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Open filters" })).toBeDefined();
    expect(screen.queryByTestId("desktop-filter-row")).toBeNull();
  });

  it("a change to the Week control reports the expected filter patch (desktop, applies immediately)", () => {
    const onFiltersChange = vi.fn();
    render(<EventFilters events={FIXTURE_EVENTS} filters={EMPTY_FILTERS} onFiltersChange={onFiltersChange} onClearFilters={vi.fn()} />);

    const weekTrigger = screen.getByRole("combobox", { name: "Week" });
    fireEvent.pointerDown(weekTrigger, { button: 0, pointerId: 1 });
    fireEvent.click(weekTrigger);
    const weekOption = screen.getByRole("option", { name: "Week 4" }); // stored week 3 displays 1-indexed; the patch below stays the RAW stored value
    fireEvent.pointerUp(weekOption, { button: 0, pointerId: 1 });
    fireEvent.click(weekOption);

    expect(onFiltersChange).toHaveBeenCalledWith({ week: 3 });
  });

  it("clicking Clear filters invokes the clear callback (desktop)", () => {
    const onClearFilters = vi.fn();
    render(<EventFilters events={FIXTURE_EVENTS} filters={{ week: 3 }} onFiltersChange={vi.fn()} onClearFilters={onClearFilters} />);

    fireEvent.click(screen.getByText("Clear filters"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("renders no badge on the mobile trigger at zero active filters", () => {
    setMobile(true);
    render(<EventFilters events={FIXTURE_EVENTS} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Open filters" });
    expect(trigger.textContent).toBe("Filters");
  });

  it("renders a numeric badge on the mobile trigger and folds the count into the accessible name at two active filters", () => {
    setMobile(true);
    render(<EventFilters events={FIXTURE_EVENTS} filters={{ week: 3, country: "USA" }} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Open filters, 2 active" });
    expect(trigger.textContent).toContain("2");
  });

  it("a dimension with no distinct values renders disabled rather than absent, with its label still visible", () => {
    render(<EventFilters events={[]} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

    const districtTrigger = screen.getByRole("combobox", { name: "District" });
    expect(districtTrigger.hasAttribute("disabled")).toBe(true);
    expect(districtTrigger).toBeDefined(); // still rendered, not omitted
  });
});
