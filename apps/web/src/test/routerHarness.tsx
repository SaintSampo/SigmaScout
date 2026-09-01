/**
 * Shared router harness for component tests whose subject renders real
 * TanStack `Link`s (2026-09-01: roster numbers on the event match tables,
 * the team page's event-name heading). Derived from
 * `RankDistributionTable.test.tsx`'s 08-14 inline pattern with one
 * deliberate difference: that pattern creates a fresh router per render, so
 * the initial route match resolves ASYNCHRONOUSLY and every assertion needs
 * an `await waitFor(...)` first. Here ONE module-level router is created and
 * `load()`ed at import time (top-level await — vitest-supported), so a
 * ready-matched router mounts synchronously and existing sync
 * `screen.getBy*` call sites work unchanged as a drop-in.
 *
 * The subject under test rides a context the current route's component
 * reads, so each `renderWithRouter` call (and each wrapped `rerender`)
 * swaps the rendered children without touching router state. Tests within a
 * file run serially, and testing-library's cleanup unmounts between tests,
 * so the shared router never leaks children across tests.
 */
import { createContext, useContext, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function buildRouter() {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, component: RouteBody });
  const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
  const routeTree = rootRoute.addChildren([eventRoute, teamRoute]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/event/2024casf"] }) });
}

const sharedRouter = buildRouter();
await sharedRouter.load();

export function TestRouterHarness({ children }: { children: ReactNode }) {
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={sharedRouter} />
    </ChildrenContext.Provider>
  );
}

/** Drop-in `render` replacement wrapping the subject in `TestRouterHarness`. `rerender` re-wraps too, so existing `rerender(<Subject/>)` call sites keep working unchanged. */
export function renderWithRouter(ui: ReactNode): ReturnType<typeof render> {
  const result = render(<TestRouterHarness>{ui}</TestRouterHarness>);
  return {
    ...result,
    rerender: (next: ReactNode) => result.rerender(<TestRouterHarness>{next}</TestRouterHarness>),
  };
}
