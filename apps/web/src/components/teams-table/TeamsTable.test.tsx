import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { PINNED_COLUMN_IDS } from "./columns";
import { TeamsTable } from "./TeamsTable";
import type { TeamRow } from "./rowModel";

/**
 * `columns.tsx`'s team-number/nickname cells are real router `Link`s now
 * (06-05-PLAN.md Task 3), so every `TeamsTable` render needs a router
 * context whose tree carries a `to="/team/$teamNumber"` route — same
 * self-contained-tree technique `TeamStates.test.tsx`/`routes/team.$teamNumber.test.tsx`
 * already use. Unlike those files' simpler `renderWithRouter`, two tests
 * here call testing-library's `rerender` with NEW `TeamsTable` props — a
 * route's own `component` closure captures whatever `children` it was given
 * at `createRoute()` time forever, so a plain closure would not pick up a
 * rerender's new props. `ChildrenContext` is read by the matched route's
 * body on every render instead, so `rerender(<TestHarness>{...}</TestHarness>)`
 * updates what's shown without rebuilding the router itself.
 */
const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const teamsRoute = createRoute({ path: "/teams", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([teamsRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/teams"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

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
  it("renders the declared column set for the given algorithm/season, and switching algorithm changes it", async () => {
    const { rerender } = render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`)).toBeDefined());
    expect(screen.queryByTestId("teams-header-hubShift1")).toBeNull();

    rerender(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row({ metrics: { [TOTAL_KEY]: { value: 50 }, hubShift1: { value: 4 } } })]}
          algorithmId="vpr"
          season={2026}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("teams-header-hubShift1")).toBeDefined());
  });

  it("renders an em-dash for a fixture row missing a declared component, while the column header remains", async () => {
    render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row({ metrics: { [TOTAL_KEY]: { value: 50 } } })]}
          algorithmId="vpr"
          season={2026}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("teams-header-hubShift1")).toBeDefined());
    expect(screen.getByTestId("teams-cell-hubShift1").textContent).toBe("");
  });

  it("exposes exactly the three declared pinned column ids, and no others", async () => {
    render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    expect(PINNED_COLUMN_IDS).toEqual(["rank", "teamNumber", "nickname"]);
    await waitFor(() => expect(screen.getByTestId(`teams-header-${PINNED_COLUMN_IDS[0]}`)).toBeDefined());
    for (const id of PINNED_COLUMN_IDS) {
      expect(screen.getByTestId(`teams-header-${id}`).getAttribute("data-pinned")).toBe("true");
      expect(screen.getByTestId(`teams-cell-${id}`).getAttribute("data-pinned")).toBe("true");
    }
    expect(screen.getByTestId(`teams-cell-${TOTAL_KEY}`).getAttribute("data-pinned")).toBe("false");
    expect(screen.getByTestId("teams-cell-record").getAttribute("data-pinned")).toBe("false");
  });

  it("every pinned cell's inline style carries a background declaration (opaque token)", async () => {
    render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId(`teams-cell-${PINNED_COLUMN_IDS[0]}`)).toBeDefined());
    for (const id of PINNED_COLUMN_IDS) {
      const cell = screen.getByTestId(`teams-cell-${id}`) as HTMLElement;
      expect(cell.style.background).not.toBe("");
    }
  });

  it("clicking a sortable header fires onSortChange, and the exposed aria-sort attribute changes with the active sort", async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={onSortChange}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("descending"));

    fireEvent.click(screen.getByRole("button", { name: /total/i }));
    expect(onSortChange).toHaveBeenCalledWith(TOTAL_KEY);

    rerender(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="asc"
          onSortChange={onSortChange}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`).getAttribute("aria-sort")).toBe("ascending"));
  });

  it("does not mark the non-sortable pinned/record columns with an aria-sort attribute at all", async () => {
    render(
      <TestHarness>
        <TeamsTable
          status="success"
          rows={[row()]}
          algorithmId="opr"
          season={2024}
          view="components"
          sortKey={TOTAL_KEY}
          sortDirection="desc"
          onSortChange={noop}
          onRetry={noop}
        />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId("teams-header-nickname")).toBeDefined());
    expect(screen.getByTestId("teams-header-nickname").getAttribute("aria-sort")).toBeNull();
    expect(screen.getByTestId("teams-header-record").getAttribute("aria-sort")).toBeNull();
  });

  it("renders skeleton rows alongside the real column headers in the loading status", async () => {
    render(
      <TestHarness>
        <TeamsTable status="loading" rows={[]} algorithmId="opr" season={2024} view="components" sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByTestId(`teams-header-${TOTAL_KEY}`)).toBeDefined());
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("renders the contract's empty-state heading with the year substituted", async () => {
    render(
      <TestHarness>
        <TeamsTable status="empty" rows={[]} algorithmId="opr" season={2022} view="components" sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByText("No teams for 2022")).toBeDefined());
  });

  it("renders the contract's error copy, and Retry invokes the callback", async () => {
    const onRetry = vi.fn();
    render(
      <TestHarness>
        <TeamsTable status="error" rows={[]} algorithmId="opr" season={2024} view="components" sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={onRetry} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getByText("Couldn't load teams for 2024.")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a single-row fixture as an ordinary one-row table with no special-cased layout", async () => {
    render(
      <TestHarness>
        <TeamsTable status="success" rows={[row()]} algorithmId="opr" season={2024} view="components" sortKey={TOTAL_KEY} sortDirection="desc" onSortChange={noop} onRetry={noop} />
      </TestHarness>,
    );
    await waitFor(() => expect(screen.getAllByTestId("teams-row")).toHaveLength(1));
  });
});
