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
import { EventFilters, weekFilterLabel } from "./EventFilters";
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

  /**
   * WR-01 (review 260902). `2026isde1`/`2026isde2`/`2026iscmp` carry raw weeks
   * 16/17/18 in the published 2026 events artifact — see
   * `filterModel.test.ts`'s own pinned fixture for the verification. The blind
   * `week + 1` turned those into the dropdown's last three options, "Week 17",
   * "Week 18" and "Week 19". There is no week 17 of an FRC season.
   */
  describe("out-of-band TBA week values (WR-01)", () => {
    const ISRAEL_EVENTS = makeRows([
      makeRow({ eventKey: "2026isde1", eventType: 1, week: 16, country: "Israel", districtKey: "isr" }),
      makeRow({ eventKey: "2026isde2", eventType: 1, week: 17, country: "Israel", districtKey: "isr" }),
      makeRow({ eventKey: "2026iscmp", eventType: 2, week: 18, country: "Israel", districtKey: "isr" }),
    ]);

    it("never labels an out-of-band week as a season week, even reached directly from a hand-edited URL", () => {
      // `?week=16` is schema-valid (any integer is), so the active-filter chip
      // can reach this function with a raw out-of-band value that
      // `filterOptions` would never have offered.
      for (const raw of [16, 17, 18]) {
        expect(weekFilterLabel(raw)).toBe("Other");
      }
      expect(weekFilterLabel("other")).toBe("Other");
      // The in-band 1-indexing is untouched.
      expect(weekFilterLabel(0)).toBe("Week 1");
      expect(weekFilterLabel(7)).toBe("Week 8");
    });

    it("the Week dropdown ends with Other, not with three nonsense season weeks", () => {
      render(<EventFilters events={[...FIXTURE_EVENTS, ...ISRAEL_EVENTS]} filters={EMPTY_FILTERS} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);

      const weekTrigger = screen.getByRole("combobox", { name: "Week" });
      fireEvent.pointerDown(weekTrigger, { button: 0, pointerId: 1 });
      fireEvent.click(weekTrigger);

      for (const nonsense of ["Week 17", "Week 18", "Week 19"]) {
        expect(screen.queryByRole("option", { name: nonsense })).toBeNull();
      }
      expect(screen.getByRole("option", { name: "Other" })).toBeDefined();
    });

    it("selecting Other reports the 'other' token, not a coerced NaN week", () => {
      const onFiltersChange = vi.fn();
      render(<EventFilters events={[...FIXTURE_EVENTS, ...ISRAEL_EVENTS]} filters={EMPTY_FILTERS} onFiltersChange={onFiltersChange} onClearFilters={vi.fn()} />);

      const weekTrigger = screen.getByRole("combobox", { name: "Week" });
      fireEvent.pointerDown(weekTrigger, { button: 0, pointerId: 1 });
      fireEvent.click(weekTrigger);
      const option = screen.getByRole("option", { name: "Other" });
      fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
      fireEvent.click(option);

      expect(onFiltersChange).toHaveBeenCalledWith({ week: "other" });
    });

    it("the active-filter chip reads Other rather than a season week that does not exist", () => {
      // Both the "other" token and a raw out-of-band week reaching the chip
      // straight off the URL must read the same honest label.
      for (const week of ["other", 16] as const) {
        const { container, unmount } = render(<EventFilters events={[...FIXTURE_EVENTS, ...ISRAEL_EVENTS]} filters={{ week }} onFiltersChange={vi.fn()} onClearFilters={vi.fn()} />);
        // Scoped by the chip's own `title` affordance — the Select trigger
        // shows the same text, so a bare text query is ambiguous here.
        const chip = container.querySelector('[title="Other"]');
        expect(chip?.textContent).toBe("Other");
        expect(container.textContent).not.toMatch(/Week 1[789]/);
        unmount();
      }
    });
  });
});
