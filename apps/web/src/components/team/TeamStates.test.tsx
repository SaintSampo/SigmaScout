import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { RootSearchSchema, TeamSearchSchema } from "../../lib/searchParams.js";
import { NoEventDataState, YearMismatchEmptyState } from "./TeamStates.js";

/**
 * `YearMismatchEmptyState`'s active-year chips are real router `Link`s, so
 * rendering it needs a router context whose tree carries a route matching
 * `to="/team/$teamNumber"` — same self-contained-tree technique
 * `routes/team.$teamNumber.test.tsx` uses (mirrors `routeTree.gen.ts`'s own
 * `Route.update()`/`addChildren()` shape). The router resolves its initial
 * match asynchronously even for a synchronous component, so every assertion
 * below waits for the first render to land rather than asserting
 * immediately after `render()`.
 */
function renderWithRouter(children: ReactNode, initialEntry = "/team/1114?year=2024&algorithm=sigma1") {
  const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
  const teamRoute = createRoute({
    path: "/team/$teamNumber",
    getParentRoute: () => rootRoute,
    validateSearch: TeamSearchSchema,
    component: () => <>{children}</>,
  });
  const routeTree = rootRoute.addChildren([teamRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
  render(<RouterProvider router={router} />);
}

describe("YearMismatchEmptyState (D-19)", () => {
  it("renders exactly two year link chips whose href contains /team/1114 and the respective year", async () => {
    renderWithRouter(<YearMismatchEmptyState teamNumber={1114} nickname="Simbotics" year={2025} activeYears={[2023, 2024]} />);

    await waitFor(() => expect(screen.getByText("Simbotics didn't compete in 2025")).toBeDefined());
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toContain("/team/1114");
    expect(links[0]?.getAttribute("href")).toContain("2023");
    expect(links[1]?.getAttribute("href")).toContain("/team/1114");
    expect(links[1]?.getAttribute("href")).toContain("2024");
  });

  it("renders the heading with activeYears undefined, and omits the chip row entirely (no dangling label)", async () => {
    renderWithRouter(<YearMismatchEmptyState teamNumber={1114} nickname="Simbotics" year={2025} activeYears={undefined} />);

    await waitFor(() => expect(screen.getByText("Simbotics didn't compete in 2025")).toBeDefined());
    expect(screen.queryByText(/active seasons/)).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders the heading with activeYears as an empty array, and omits the chip row entirely", async () => {
    renderWithRouter(<YearMismatchEmptyState teamNumber={1114} nickname="Simbotics" year={2025} activeYears={[]} />);

    await waitFor(() => expect(screen.getByText("Simbotics didn't compete in 2025")).toBeDefined());
    expect(screen.queryByText(/active seasons/)).toBeNull();
  });

  it("renders one chip for a single active year, with the same body wording as the many-year case", async () => {
    renderWithRouter(<YearMismatchEmptyState teamNumber={1114} nickname="Simbotics" year={2025} activeYears={[2024]} />);

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    const links = screen.getAllByRole("link");
    expect(links[0]?.getAttribute("href")).toContain("/team/1114");
    expect(links[0]?.getAttribute("href")).toContain("2024");
    expect(screen.getByText(/This team's active seasons:/)).toBeDefined();
  });

  it("falls back to 'Team {teamNumber}' when nickname is empty", async () => {
    renderWithRouter(<YearMismatchEmptyState teamNumber={1114} nickname="" year={2025} activeYears={undefined} />);

    await waitFor(() => expect(screen.getByText("Team 1114 didn't compete in 2025")).toBeDefined());
  });
});

describe("NoEventDataState (E5 empty)", () => {
  it("renders the heading and body, and no button element", async () => {
    renderWithRouter(<NoEventDataState teamNumber={1114} nickname="Simbotics" year={2025} />);

    await waitFor(() => expect(screen.getByText("No event data for Simbotics in 2025 yet.")).toBeDefined());
    expect(screen.getByText("This usually means results haven't published yet. Check back shortly.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to 'Team {teamNumber}' when nickname is empty", async () => {
    renderWithRouter(<NoEventDataState teamNumber={1114} nickname="" year={2025} />);

    await waitFor(() => expect(screen.getByText("No event data for Team 1114 in 2025 yet.")).toBeDefined());
  });
});
