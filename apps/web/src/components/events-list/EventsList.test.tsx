/**
 * 05-07-PLAN.md Task 2's fixture-driven coverage: an offseason row renders
 * the badge and no week number; a fully null-location row renders em-dashes
 * and no literal "null" text; the four states render correctly; a long
 * event name is not truncated in the source string, only in the layout.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { EventsList } from "./EventsList";
import type { EventRow } from "./filterModel";

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
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2025,
    events,
  }).events;
}

const noop = () => {};

describe("EventsList", () => {
  it("renders the Offseason badge and no week number for a null-week fixture", () => {
    const events = makeRows([makeRow({ isOffseason: true, week: null })]);
    render(<EventsList status="success" events={events} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    expect(screen.getByText("Offseason")).toBeDefined();
    expect(screen.queryByText("2")).toBeNull();
  });

  it("renders em-dashes for a fully null-location fixture and no literal null text", () => {
    const events = makeRows([makeRow({ country: null, stateProv: null, districtKey: null })]);
    const { container } = render(
      <EventsList status="success" events={events} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />
    );

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2); // location cell + district cell
    expect(container.textContent).not.toMatch(/\bnull\b/i);
  });

  it("renders the empty-state copy for a zero-length list", () => {
    render(<EventsList status="success" events={[]} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    expect(screen.getByText("No events match your filters")).toBeDefined();
  });

  it("renders an inline Clear filters action in the empty state only when a filter is active", () => {
    const onClearFilters = vi.fn();
    render(<EventsList status="success" events={[]} year={2025} hasActiveFilter={true} onClearFilters={onClearFilters} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    const clearButton = screen.getByText("Clear filters");
    fireEvent.click(clearButton);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("renders one ordinary row with no special layout for a single-event list", () => {
    const events = makeRows([makeRow()]);
    render(<EventsList status="success" events={events} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    expect(screen.getAllByRole("row")).toHaveLength(2); // header row + one data row
  });

  it("renders skeleton rows together with real column headers while loading", () => {
    render(<EventsList status="pending" events={[]} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    expect(screen.getByText("Event")).toBeDefined();
    expect(screen.getByText("Week")).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("renders the contract's error copy and invokes Retry", () => {
    const onRetry = vi.fn();
    render(<EventsList status="error" events={[]} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={onRetry} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    expect(screen.getByText("Couldn't load events for 2025.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps a long event name intact in the source string, truncating only via layout", () => {
    const longName = "The Extremely Long Sponsor-Heavy Regional Championship Presented By A Very Long Company Name";
    const events = makeRows([makeRow({ name: longName })]);
    render(<EventsList status="success" events={events} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={noop} />);

    const cell = screen.getByTitle(longName);
    expect(cell.textContent).toBe(longName);
    expect(cell.className).toMatch(/truncate/);
  });

  it("clicking a sortable header reports the clicked column key", () => {
    const onSortChange = vi.fn();
    const events = makeRows([makeRow()]);
    render(<EventsList status="success" events={events} year={2025} hasActiveFilter={false} onClearFilters={noop} onRetry={noop} sortKey="startDate" sortDir="asc" onSortChange={onSortChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Week/ }));
    expect(onSortChange).toHaveBeenCalledWith("week");
  });
});
