import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SIMULATION_PRE_RUN_BODY, SIMULATION_PRE_RUN_TESTID, SimulationTab } from "./SimulationTab.js";
import { RUN_ERROR_BODY, RUN_LABEL_IDLE, RUN_RETRY_LABEL } from "./RunControl.js";
import { baseArtifact, BOTH_PMFS, upcomingQualRow } from "./simulationTestFixtures.js";
import { installMockWorker } from "../../test/mockWorker.js";
import type { MockWorkerScript } from "../../test/mockWorker.js";
import { runSimulationJob } from "../../workers/simulationProtocol.js";
import { RootSearchSchema, TeamSearchSchema } from "../../lib/searchParams.js";

/**
 * S2's forced-failure evidence (08-15-PLAN.md Task 3, UI-SPEC's `🧪 backstop`
 * error row on the run control). **What this file adds beyond 08-13's own
 * suite, and what it deliberately does not repeat:** `SimulationTab.test.tsx`'s
 * I2 already proves a construction failure renders the inline error plus
 * Retry with no progress bar; its I3 already proves a mid-run throw ends in
 * the same rendered error state with the rank-table position holding its
 * pre-run placeholder. This file does not re-author either claim in the same
 * shape — cases A and B below each combine ALL FOUR assertions UI-SPEC's row
 * names (inline error copy AND Retry AND no progress-bar element AND the
 * rank table staying in its pre-run placeholder rather than becoming a
 * partial table) as ONE claim per failure mode, which neither I2 nor I3
 * makes alone. Case C is this file's real contribution: RECOVERY, the half a
 * failure-only test cannot claim. Case D observes 08-07's Worker-lifecycle
 * rule at the consumer.
 *
 * Reuses 08-09's own event-artifact fixture builders (`baseArtifact`,
 * `upcomingQualRow`, `BOTH_PMFS`) — moved verbatim from `SimulationTab.test.tsx`
 * into `./simulationTestFixtures.js` (a plain source module, never a
 * `.test.ts` file: importing a `.test.tsx` file here would re-execute its
 * module-scope `describe(...)` registrations and its `vi.stubGlobal("Worker",
 * ...)` call as part of THIS file's own run) so both suites import the SAME
 * builders. Creating a second, independently-drifting simulation fixture
 * here is exactly what this plan's action text forbids.
 *
 * `installMockWorker`/`restore()` are called per-test via `try`/`finally`
 * (08-13's own established pattern, not a shared `beforeEach`) because each
 * case below needs a DIFFERENT failure mode installed — the isolation
 * contract (no test's mock survives into the next) is identical either way.
 */

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

/** Mirrors `SimulationTab.test.tsx`'s own `RouterTestHarness` — needed only by Case C, which reaches a completed result that mounts real router `Link`s (the rank table's Team #/Nickname columns). */
function RouterTestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([eventRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/event/2024test"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

/** The one artifact shape every case in this file needs: pmfs on `upcoming[]` only, so the default selection already picks a start match and every case can press Run with no picker click first — mirrors `SimulationTab.test.tsx`'s own I2/I3 fixture shape exactly. */
function failureFixtureArtifact() {
  return baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
}

/** Asserts the four-part claim UI-SPEC's S2 backstop row actually names, together — any one alone passes on a broken build. */
async function expectErrorStateWithNoPartialTable(): Promise<void> {
  await waitFor(() => expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined());
  const retry = screen.getByRole("button", { name: RUN_RETRY_LABEL });
  expect(retry).toBeDefined();
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
  expect(screen.queryAllByTestId("rank-distribution-row").length).toBe(0);
}

describe("S2 — forced Worker failure, driven through the assembled Simulation tab", () => {
  it("A: construction failure — inline error AND Retry AND no progress bar AND the rank table stays in its pre-run placeholder, together", async () => {
    const handle = installMockWorker({ failOnConstruct: new Error("no module workers here") });
    try {
      render(<SimulationTab artifact={failureFixtureArtifact()} algorithmId="vpr" season={2024} />);
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await expectErrorStateWithNoPartialTable();
    } finally {
      handle.restore();
    }
  });

  it("B: mid-run throw, after real progress — a failure path that only works from a cold start is not the failure path a visitor hits", async () => {
    const throwingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 50, totalDraws: 1000 });
      ctx.post({ type: "progress", completedDraws: 200, totalDraws: 1000 });
      throw new Error("simulated worker script crash");
    };
    const handle = installMockWorker({ script: throwingScript });
    try {
      render(<SimulationTab artifact={failureFixtureArtifact()} algorithmId="vpr" season={2024} />);
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await expectErrorStateWithNoPartialTable();
    } finally {
      handle.restore();
    }
  });

  it("C: recovery — after a mid-run throw, Retry against a healthy worker completes and populates the rank table (the half a failure-only test cannot claim)", async () => {
    const throwingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 50, totalDraws: 1000 });
      throw new Error("simulated worker script crash");
    };
    let handle = installMockWorker({ script: throwingScript });
    try {
      render(
        <RouterTestHarness>
          <SimulationTab artifact={failureFixtureArtifact()} algorithmId="vpr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_IDLE })).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await waitFor(() => expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined());

      // Swap the installed failure mode for a healthy one before pressing
      // Retry — `Retry`'s handler is the same `handleRun` the idle button
      // uses, so it constructs a brand-new Worker through whatever class is
      // installed at THAT moment.
      handle.restore();
      const realRunScript: MockWorkerScript = (message, ctx) => runSimulationJob(message, ctx.post);
      handle = installMockWorker({ script: realRunScript });

      fireEvent.click(screen.getByRole("button", { name: RUN_RETRY_LABEL }));
      await waitFor(() => expect(screen.getByTestId("rank-distribution-table-scroll")).toBeDefined());
      expect(screen.getAllByTestId("rank-distribution-row").length).toBeGreaterThan(0);
      expect(screen.queryByText(RUN_ERROR_BODY)).toBeNull();
    } finally {
      handle.restore();
    }
  });

  it("D: no leaked worker — after a failure and an unmount, terminate() was called on every constructed instance (08-07's lifecycle rule, observed at the consumer)", async () => {
    const throwingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 10, totalDraws: 1000 });
      throw new Error("simulated worker script crash");
    };
    const handle = installMockWorker({ script: throwingScript });
    try {
      const { unmount } = render(<SimulationTab artifact={failureFixtureArtifact()} algorithmId="vpr" season={2024} />);
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await waitFor(() => expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined());

      unmount();

      expect(handle.instances.length).toBeGreaterThan(0);
      expect(handle.instances.every((instance) => instance.terminated)).toBe(true);
    } finally {
      handle.restore();
    }
  });
});
