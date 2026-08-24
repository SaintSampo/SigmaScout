import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { PINNED_COLUMN_IDS } from "./columns";
import { TeamsTable } from "./TeamsTable";
import type { TeamRow } from "./rowModel";

// No jest-dom matcher dependency in this workspace (StateViews.test.tsx's own
// precedent) — plain vitest assertions plus `getAttribute()` are sufficient
// without adding a new dependency.

// jsdom has no real layout engine: `offsetWidth`/`offsetHeight` are always 0,
// which is exactly what TanStack Virtual's synchronous initial-rect
// measurement reads (`getRect()` in @tanstack/virtual-core, not
// `getBoundingClientRect`) — a zero scroll-container height means zero
// virtual rows compute as "in range," hiding every row a real browser would
// render. A fixed non-zero offset size is what a real layout engine would
// report for this test's small fixtures.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 640 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 960 });
});

/** A minimal, valid `TeamRow` fixture (Task 1's output shape), overridable per test. */
function row(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    record: { wins: 7, losses: 3, ties: 0 },
    winRate: 0.7,
    metrics: { [TOTAL_KEY]: { value: 50, spread: 2 } },
    rank: 1,
    ...overrides,
  };
}

const noop = () => {};

describe("TeamsTable", () => {
  it("renders the declared column set for the given algorithm/season, and switching algorithm changes it", () => {
    const { rerender } = render(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`)).toBeDefined();
    expect(screen.queryByTestId("teams-header-hubShift1")).toBeNull();

    rerender(
      <TeamsTable
        status="success"
        rows={[row({ metrics: { [TOTAL_KEY]: { value: 50 }, hubShift1: { value: 4 } } })]}
        algorithmId="sigma1"
        season={2026}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("teams-header-hubShift1")).toBeDefined();
  });

  it("renders an em-dash for a fixture row missing a declared component, while the column header remains", () => {
    render(
      <TeamsTable
        status="success"
        rows={[row({ metrics: { [TOTAL_KEY]: { value: 50 } } })]}
        algorithmId="sigma1"
        season={2026}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("teams-header-hubShift1")).toBeDefined();
    expect(screen.getByTestId("teams-cell-hubShift1").textContent).toBe("—");
  });

  it("exposes exactly the three declared pinned column ids, and no others", () => {
    render(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    expect(PINNED_COLUMN_IDS).toEqual(["rank", "teamNumber", "nickname"]);
    for (const id of PINNED_COLUMN_IDS) {
      expect(screen.getByTestId(`teams-header-${id}`).getAttribute("data-pinned")).toBe("true");
      expect(screen.getByTestId(`teams-cell-${id}`).getAttribute("data-pinned")).toBe("true");
    }
    expect(screen.getByTestId(`teams-cell-${TOTAL_KEY}`).getAttribute("data-pinned")).toBe("false");
    expect(screen.getByTestId("teams-cell-record").getAttribute("data-pinned")).toBe("false");
  });

  it("every pinned cell's inline style carries a background declaration (opaque token)", () => {
    render(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    for (const id of PINNED_COLUMN_IDS) {
      const cell = screen.getByTestId(`teams-cell-${id}`) as HTMLElement;
      expect(cell.style.background).not.toBe("");
    }
  });

  it("clicking a sortable header fires onSortChange, and the exposed aria-sort attribute changes with the active sort", () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={onSortChange}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByRole("button", { name: /total/i }));
    expect(onSortChange).toHaveBeenCalledWith(TOTAL_KEY);

    rerender(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="asc"
        onSortChange={onSortChange}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("ascending");
  });

  it("does not mark the non-sortable pinned/record columns with an aria-sort attribute at all", () => {
    render(
      <TeamsTable
        status="success"
        rows={[row()]}
        algorithmId="opr"
        season={2024}
        sortKey={TOTAL_KEY}
        sortDirection="desc"
        onSortChange={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("teams-header-nickname").getAttribute("aria-sort")).toBeNull();
    expect(screen.getByTestId("teams-header-record").getAttribute("aria-sort")).toBeNull();
  });

  it("renders skeleton rows alongside the real column headers in the loading status", () => {
    render(
      <TeamsTable status="loading" rows={[]} algorithmId="opr" season={2024} sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />,
    );
    expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`)).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("renders the contract's empty-state heading with the year substituted", () => {
    render(
      <TeamsTable status="empty" rows={[]} algorithmId="opr" season={2022} sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />,
    );
    expect(screen.getByText("No teams for 2022")).toBeDefined();
  });

  it("renders the contract's error copy, and Retry invokes the callback", () => {
    const onRetry = vi.fn();
    render(
      <TeamsTable status="error" rows={[]} algorithmId="opr" season={2024} sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={onRetry} />,
    );
    expect(screen.getByText("Couldn't load teams for 2024.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a single-row fixture as an ordinary one-row table with no special-cased layout", () => {
    render(
      <TeamsTable status="success" rows={[row()]} algorithmId="opr" season={2024} sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />,
    );
    expect(screen.getAllByTestId("teams-row")).toHaveLength(1);
  });
});
