import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState, ErrorState } from "./StateViews.js";

// No jest-dom matcher dependency in this workspace (05-01's fetch-boundary
// tests don't render components) — `getByText`/`getByRole` already throw
// when nothing matches, and `queryByText` returns `null` when absent, so
// plain vitest assertions are sufficient without adding a new dependency.

describe("EmptyState", () => {
  it("renders the canonical Events empty-state copy exactly (05-UI-SPEC.md Copywriting Contract)", () => {
    render(
      <EmptyState
        heading="No events match your filters"
        body="Try removing a filter, or check a different year."
      />
    );

    expect(screen.getByText("No events match your filters")).toBeDefined();
    expect(screen.getByText("Try removing a filter, or check a different year.")).toBeDefined();
  });

  it("renders the D-11 year-substituted Teams empty-state copy exactly", () => {
    render(<EmptyState heading="No teams for 2019" body="Try removing a filter, or check a different year." />);

    expect(screen.getByText("No teams for 2019")).toBeDefined();
  });

  it("omits the Clear filters action when no callback is supplied", () => {
    render(<EmptyState heading="No events match your filters" body="Try removing a filter, or check a different year." />);

    expect(screen.queryByText("Clear filters")).toBeNull();
  });

  it("renders Clear filters and fires the callback on click when supplied", () => {
    const onClearFilters = vi.fn();
    render(
      <EmptyState
        heading="No events match your filters"
        body="Try removing a filter, or check a different year."
        onClearFilters={onClearFilters}
      />
    );

    const clearButton = screen.getByText("Clear filters");
    expect(clearButton).toBeDefined();
    fireEvent.click(clearButton);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorState", () => {
  it("renders the canonical error copy exactly, interpolating resource and year", () => {
    render(<ErrorState resource="events" year={2026} onRetry={vi.fn()} />);

    expect(screen.getByText("Couldn't load events for 2026.")).toBeDefined();
    expect(screen.getByText("Check your connection and try again.")).toBeDefined();
  });

  it("interpolates a different resource identically", () => {
    render(<ErrorState resource="teams" year={2024} onRetry={vi.fn()} />);

    expect(screen.getByText("Couldn't load teams for 2024.")).toBeDefined();
  });

  it("renders a Retry button that fires the retry callback on click", () => {
    const onRetry = vi.fn();
    render(<ErrorState resource="events" year={2026} onRetry={onRetry} />);

    const retryButton = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
