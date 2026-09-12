import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import {
  hasSimulatableRankInputs,
  SIMULATION_EMPTY_STATE_BODY,
  SIMULATION_EMPTY_STATE_HEADING,
  SIMULATION_PRE_RUN_BODY,
  SIMULATION_PRE_RUN_TESTID,
  SIMULATION_STACK_TESTID,
  SIMULATION_UNAVAILABLE_BODY,
  SIMULATION_UNAVAILABLE_HEADING,
  SimulationTab,
  SimulationTabSkeleton,
} from "./SimulationTab.js";
import {
  PRE_SCHEDULE_STOP_LABEL,
  START_MATCH_PICKER_HINT,
  START_MATCH_PICKER_TESTID,
  START_MATCH_PRE_SCHEDULE_TESTID,
  START_MATCH_ROW_TESTID_PREFIX,
  START_MATCH_NUMBER_INPUT_TESTID,
  START_MATCH_SLIDER_TESTID,
} from "./StartMatchPicker.js";
import { RUN_ERROR_BODY, RUN_LABEL_UPDATE, RUN_RETRY_LABEL } from "./RunControl.js";
import { installMockWorker } from "../../test/mockWorker.js";
import type { MockWorkerScript } from "../../test/mockWorker.js";
import { runSimulationJob } from "../../workers/simulationProtocol.js";
import { RootSearchSchema, TeamSearchSchema } from "../../lib/searchParams.js";
import { baseArtifact, BOTH_PMFS, playedQualRow, preScheduleArtifact, upcomingQualRow } from "./simulationTestFixtures.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * 08-14-PLAN.md Task 3: I1/I7 below are the only two pre-existing cases that
 * drive a real run to completion, so they are the only two that now mount
 * `RankDistributionTable` (Team #/Nickname router `Link`s) — every other
 * case in this file stays exactly as 08-09/08-11/08-13 left it and needs no
 * router context, since it never reaches a completed result. This harness
 * mirrors `BreakdownTab.test.tsx`'s own self-contained-tree technique,
 * scoped to only the two call sites that need it.
 */
const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

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

/**
 * 08-11-PLAN.md Task 3 installs a global `Worker` constructor spy BEFORE any
 * test in this file runs (never inside an individual test), so "no Web
 * Worker is ever constructed" is checked across the WHOLE file's run, not
 * just the cases that mention it explicitly.
 */
const workerConstructorSpy = vi.fn();
class SpyWorker {
  constructor(...args: unknown[]) {
    workerConstructorSpy(...args);
  }
}
vi.stubGlobal("Worker", SpyWorker);

/**
 * SimulationTab's own coverage (08-09-PLAN.md Task 2) — the three-state panel
 * shell, the pmf-presence predicate `hasSimulatableRankInputs` tested
 * directly against every artifact shape the `<behavior>` block names, and the
 * two prohibition guards (no algorithm-naming copy, no Worker construction).
 *
 * `baseArtifact`/`playedQualRow`/`upcomingQualRow`/`BOTH_PMFS` — every
 * fixture this file uses is a HAND-WRITTEN `EventArtifact`-shaped object
 * literal, imported from `./simulationTestFixtures.js` (08-15-PLAN.md Task 3
 * moved them there verbatim so `SimulationTab.failure.test.tsx` can import
 * the SAME builders rather than authoring a second, independently-drifting
 * fixture). `packages/harness/pageArtifacts.ts` is read-only here — this
 * file never imports its schema, only its inferred `EventArtifact` type.
 */

describe("hasSimulatableRankInputs", () => {
  it("is false for zero matches at all", () => {
    expect(hasSimulatableRankInputs(baseArtifact())).toBe(false);
  });

  it("is false when qm rows exist but carry no pmf anywhere (the 08-05-measured offseason case)", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    expect(hasSimulatableRankInputs(artifact)).toBe(false);
  });

  it("is true when pmfs exist on upcoming[] only", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    expect(hasSimulatableRankInputs(artifact)).toBe(true);
  });

  it("is true when pmfs exist on matches[] only", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    expect(hasSimulatableRankInputs(artifact)).toBe(true);
  });

  it("is false when only one side of the pmf pair is present (a one-sided distribution cannot produce a match outcome)", () => {
    const artifact = baseArtifact({ matches: [playedQualRow({ redRpPmf: [0.5, 0.5] })] });
    expect(hasSimulatableRankInputs(artifact)).toBe(false);
  });

  it("is false when the only pmf-bearing row is a playoff row (compLevel sf), not a qm row", () => {
    const artifact = baseArtifact({
      matches: [
        playedQualRow(),
        playedQualRow({ matchKey: "2024test_sf1m1", compLevel: "sf" as const, ...BOTH_PMFS }),
      ],
    });
    expect(hasSimulatableRankInputs(artifact)).toBe(false);
  });

  it("is true (class, not completeness — PD-06) when SOME qm rows carry both pmfs and others carry none; per-row completeness after a chosen start match is 08-11's question, not this predicate's", () => {
    const artifact = baseArtifact({
      matches: [
        playedQualRow(BOTH_PMFS),
        playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 }),
      ],
    });
    expect(hasSimulatableRankInputs(artifact)).toBe(true);
  });
});

describe("SimulationTab", () => {
  it("renders the canonical empty state (exact Copywriting Contract strings) for zero qualification matches; a playoff row present does not count as a qualification match", () => {
    const sfRow = { ...playedQualRow({ matchKey: "2024test_sf1m1" }), compLevel: "sf" as const };
    const artifact = baseArtifact({ matches: [sfRow as EventArtifact["matches"][number]] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByText(SIMULATION_EMPTY_STATE_HEADING)).toBeDefined();
    expect(screen.getByText(SIMULATION_EMPTY_STATE_BODY)).toBeDefined();
  });

  it("renders the UNAVAILABLE state (not the empty state) when qualification matches exist but carry no pmf anywhere", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeDefined();
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
  });

  it("renders the PRE-RUN state (not an empty state) when pmfs exist on upcoming[] only — proving the predicate reads both arrays", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
  });

  it("renders the PRE-RUN state when pmfs exist on matches[] only — the common post-08-05 shape, mirror of the upcoming-only case", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
  });

  it("renders PRE-RUN (class, not completeness — PD-06) when some qm rows carry both pmfs and others carry none, naming that per-row completeness is 08-11's question", () => {
    const artifact = baseArtifact({
      matches: [
        playedQualRow(BOTH_PMFS),
        playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 }),
      ],
    });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
  });

  it("the layout stack testid is present and the pre-run paragraph is its descendant — the mount point 08-11/08-13/08-14 each add a child to", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    const stack = screen.getByTestId(SIMULATION_STACK_TESTID);
    const preRun = screen.getByTestId(SIMULATION_PRE_RUN_TESTID);
    expect(stack.contains(preRun)).toBe(true);
  });

  it("the unavailable copy names no algorithm and no control (D-04's no-explanation rule prohibition guard)", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="opr" season={2024} />);
    const text = screen.getByText(SIMULATION_UNAVAILABLE_HEADING).parentElement?.textContent ?? "";
    expect(text).not.toMatch(/\b(vpr|opr|epa)\b/i);
    expect(text).not.toMatch(/\b(algorithm|dropdown|switch)\b/i);
  });
});

describe("SimulationTabSkeleton", () => {
  it("renders placeholder blocks and no empty/unavailable/pre-run text — a skeleton asserts nothing about the data", () => {
    render(<SimulationTabSkeleton />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
    expect(screen.queryByTestId(SIMULATION_PRE_RUN_TESTID)).toBeNull();
  });
});

/**
 * 08-11-PLAN.md Task 3's own coverage — the picker/caption mount, the
 * default-selection rule, PD-06's resolve-against-current-rows behaviour,
 * PD-07's compute-once default, and PD-08's rewind-predicate-not-played-flag
 * case.
 */
describe("08-11: the start-match picker mounts in the layout stack's first position", () => {
  it("the picker's testid is a descendant of the layout stack and precedes the pre-run paragraph in document order", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    const stack = screen.getByTestId(SIMULATION_STACK_TESTID);
    const picker = screen.getByTestId(START_MATCH_PICKER_TESTID);
    const preRun = screen.getByTestId(SIMULATION_PRE_RUN_TESTID);
    expect(stack.contains(picker)).toBe(true);
    // DOCUMENT_POSITION_FOLLOWING on preRun (relative to picker) means picker comes first.
    expect(picker.compareDocumentPosition(preRun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("08-11: the other two branches render no picker and no caption", () => {
  it("the zero-qm empty state renders no picker and no caption", () => {
    const sfRow = { ...playedQualRow({ matchKey: "2024test_sf1m1" }), compLevel: "sf" as const };
    const artifact = baseArtifact({ matches: [sfRow as EventArtifact["matches"][number]] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.queryByTestId(START_MATCH_PICKER_TESTID)).toBeNull();
  });

  it("the no-pmf unavailable state renders no picker and no caption", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.queryByTestId(START_MATCH_PICKER_TESTID)).toBeNull();
  });
});

describe("08-11: default selection", () => {
  it("defaults to the first genuinely-unplayed qualification match; the hint is absent and the scope line renders", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");
    expect(screen.queryByText(START_MATCH_PICKER_HINT)).toBeNull();
  });

  it("selects the FIRST match on a fully-played event (2026-09-01), so a finished event opens ready to run rather than on an empty picker", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    // A real selection means the SCOPE line, not the pre-selection hint.
    expect(screen.queryByText(START_MATCH_PICKER_HINT)).toBeNull();
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");
  });
});

describe("08-11: selection survives a refetch (PD-06)", () => {
  it("keeps the same selected matchKey when a refetch moves the match from upcoming[] to matches[]", () => {
    const artifact1 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({ matches: [playedQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    rerender(<SimulationTab artifact={artifact2} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");
  });

  it("a selected key that disappears from a refetched artifact resolves to no selection, never a neighbouring row", () => {
    const artifact1 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm99", matchNumber: 99 })] });
    rerender(<SimulationTab artifact={artifact2} algorithmId="spr" season={2024} />);
    expect(screen.getByText(START_MATCH_PICKER_HINT)).toBeDefined();
    expect(screen.queryByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeNull();
  });

  it("the default is not re-applied after a refetch (PD-07): a user-chosen row stays selected even after the original default row becomes played", () => {
    const artifact1 = baseArtifact({
      upcoming: [
        upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 }),
        upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2 }),
      ],
    });
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    // The picker is a slider plus a typed match number (2026-09-01), so a
    // deliberate user choice is made by typing the match number.
    fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: "2" } });
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({
      matches: [playedQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    rerender(<SimulationTab artifact={artifact2} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");
  });
});

/**
 * 08-13-PLAN.md Task 2's integration cases (I1-I7). Every test here installs
 * its OWN `installMockWorker()` for the duration of the test and restores it
 * before the test ends — `installMockWorker`'s temporary substitution of
 * `globalThis.Worker` with `InstalledMockWorker` is a DIFFERENT class from
 * the module-scope `SpyWorker` this file stubs at the top, so real
 * construction through these tests never touches `workerConstructorSpy` —
 * the final "08-11: still no Worker" block below still covers this file's
 * cases (it runs LAST, in declaration order, and this describe block is
 * declared before it).
 */
describe("08-13: the run control", () => {
  it("I1: one press, one full round trip, one completion line — exactly one Worker constructed, exactly one request posted", async () => {
    const realRunScript: MockWorkerScript = (message, ctx) => runSimulationJob(message, ctx.post);
    const handle = installMockWorker({ script: realRunScript });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(
        <RouterTestHarness>
          <SimulationTab artifact={artifact} algorithmId="spr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByTestId(START_MATCH_PICKER_TESTID)).toBeDefined());

      fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`));
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

      await waitFor(() => expect(screen.getByText(/^Simulated \d+ draws in/)).toBeDefined());
      expect(handle.instances).toHaveLength(1);
      expect(handle.instances[0]!.received).toHaveLength(1);
      expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();
    } finally {
      handle.restore();
    }
  });

  it("I2: UI-SPEC S2, construction half — failOnConstruct renders the inline error + Retry, with no progressbar at any point", async () => {
    const handle = installMockWorker({ failOnConstruct: new Error("no module workers here") });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

      await waitFor(() => expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined());
      expect(screen.getByRole("button", { name: RUN_RETRY_LABEL })).toBeDefined();
      expect(screen.queryByRole("progressbar")).toBeNull();
    } finally {
      handle.restore();
    }
  });

  it("I3: UI-SPEC S2, mid-run half — a throwing script ends in the same rendered error state, and the rank-table position still shows the pre-run placeholder", async () => {
    const throwingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 1, totalDraws: 1000 });
      throw new Error("simulated worker script crash");
    };
    const handle = installMockWorker({ script: throwingScript });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

      await waitFor(() => expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined());
      expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    } finally {
      handle.restore();
    }
  });

  it("I4: the picker goes inert during the run — a click on a different picker row does not change the selection", async () => {
    const neverResolvingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 50, totalDraws: 1000 });
      // Never posts a result — the run stays "running" for the duration of this test.
    };
    const handle = installMockWorker({ script: neverResolvingScript });
    try {
      const artifact = baseArtifact({
        upcoming: [
          upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2, sortTime: 100 }),
          upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm3", matchNumber: 3, sortTime: 200 }),
        ],
      });
      render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));
      await waitFor(() => expect(screen.getByRole("progressbar")).toBeDefined());

      // Attempt to change the start match mid-run through the picker's own
      // control; the inert picker must swallow it.
      fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: "3" } });

      // The selection did not move: qm2 is still the one match the picker
      // shows, and qm3 never became the shown match.
      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");
      expect(screen.queryByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm3`)).toBeNull();
    } finally {
      handle.restore();
    }
  });

  it("I5: the placeholder holds for the whole run — still rendered once progress has arrived and before the result lands", async () => {
    const neverResolvingScript: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 50, totalDraws: 1000 });
    };
    const handle = installMockWorker({ script: neverResolvingScript });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));
      await waitFor(() => expect(screen.getByRole("progressbar")).toBeDefined());

      expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    } finally {
      handle.restore();
    }
  });

  it("I6: pressing nothing constructs nothing — no Worker mock installed for this test, no error thrown, no progressbar", () => {
    const callsBefore = workerConstructorSpy.mock.calls.length;
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    expect(() => render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />)).not.toThrow();
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID)).toBeDefined();
    expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    // RESEARCH Pitfall 1's lazy-construction rule, enforced: rendering alone
    // (picker present, Run button present, never clicked) constructs no
    // Worker of any kind — not even through the module-scope spy.
    expect(workerConstructorSpy.mock.calls.length).toBe(callsBefore);
  });

  it("I7: changing the start match after a completed run clears the completion line in the same frame (PD-02, render-time comparison)", async () => {
    const realRunScript: MockWorkerScript = (message, ctx) => runSimulationJob(message, ctx.post);
    const handle = installMockWorker({ script: realRunScript });
    try {
      const artifact = baseArtifact({
        upcoming: [
          upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2, sortTime: 100 }),
          upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm3", matchNumber: 3, sortTime: 200 }),
        ],
      });
      render(
        <RouterTestHarness>
          <SimulationTab artifact={artifact} algorithmId="spr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));
      await waitFor(() => expect(screen.getByText(/^Simulated \d+ draws in/)).toBeDefined());
      expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();

      fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: "3" } });

      expect(screen.queryByText(/^Simulated \d+ draws in/)).toBeNull();
      expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();
      expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    } finally {
      handle.restore();
    }
  });
});

/**
 * 08-14-PLAN.md Task 3's own three integration cases — extending 08-09's and
 * 08-13's coverage, per that task's own instruction, with the rank-table
 * position now filled.
 */
describe("08-14: the rank-distribution table mounts behind a completed result", () => {
  const RANK_TABLE_SCROLL_TESTID = "rank-distribution-table-scroll";

  it("with no completed run result, the rank-table position still renders 08-09's pre-run paragraph and no rank table is in the document", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    expect(screen.queryByTestId(RANK_TABLE_SCROLL_TESTID)).toBeNull();
  });

  it("with a completed result, the rank table renders in the rank-table position and the pre-run paragraph is gone", async () => {
    const realRunScript: MockWorkerScript = (message, ctx) => runSimulationJob(message, ctx.post);
    const handle = installMockWorker({ script: realRunScript });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(
        <RouterTestHarness>
          <SimulationTab artifact={artifact} algorithmId="spr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));
      await waitFor(() => expect(screen.getByTestId(RANK_TABLE_SCROLL_TESTID)).toBeDefined());

      expect(screen.getAllByTestId("rank-distribution-row").length).toBeGreaterThan(0);
      expect(screen.queryByTestId(SIMULATION_PRE_RUN_TESTID)).toBeNull();
    } finally {
      handle.restore();
    }
  });

  it("the zero-qm empty state and the no-pmf unavailable state still render with no rank table present — this task did not move either branch", () => {
    const sfRow = { ...playedQualRow({ matchKey: "2024test_sf1m1" }), compLevel: "sf" as const };
    const emptyArtifact = baseArtifact({ matches: [sfRow as EventArtifact["matches"][number]] });
    const { unmount } = render(<SimulationTab artifact={emptyArtifact} algorithmId="spr" season={2024} />);
    expect(screen.getByText(SIMULATION_EMPTY_STATE_HEADING)).toBeDefined();
    expect(screen.queryByTestId(RANK_TABLE_SCROLL_TESTID)).toBeNull();
    unmount();

    const unavailableArtifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={unavailableArtifact} algorithmId="spr" season={2024} />);
    expect(screen.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeDefined();
    expect(screen.queryByTestId(RANK_TABLE_SCROLL_TESTID)).toBeNull();
  });
});

/**
 * Quick task 260905-tll Task 6 — the pre-schedule stop (C-01/C-02/C-03).
 *
 * Every case here asserts against `workerConstructorSpy`, which this file
 * installs at module scope: the whole premise of the baked path is that it
 * performs NO client compute, and a Worker construction is the observable
 * proof that it did. The final "still no Worker" case at the bottom of this
 * file covers these cases too.
 */
describe("260905-tll: the baked pre-schedule result", () => {
  const RANK_TABLE_SCROLL_TESTID = "rank-distribution-table-scroll";
  const TWO_TEAM_ROSTER = [
    { teamKey: "frc1", teamNumber: 1, metrics: {} },
    { teamKey: "frc2", teamNumber: 2, metrics: {} },
  ] as unknown as EventArtifact["teams"];

  it("C-01: renders the rank table with no run started and no Worker constructed", async () => {
    const artifact = baseArtifact({
      teams: TWO_TEAM_ROSTER,
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
    });
    render(
      <RouterTestHarness>
        <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={preScheduleArtifact()} />
      </RouterTestHarness>
    );

    await waitFor(() => expect(screen.getByTestId(RANK_TABLE_SCROLL_TESTID)).toBeDefined());
    expect(screen.queryByTestId(SIMULATION_PRE_RUN_TESTID)).toBeNull();
    expect(screen.getByTestId(START_MATCH_PRE_SCHEDULE_TESTID)).toBeDefined();
    expect(screen.getByText(PRE_SCHEDULE_STOP_LABEL)).toBeDefined();
    expect(workerConstructorSpy).not.toHaveBeenCalled();
  });

  it("C-15: a SCHEDULELESS event — zero qual rows, no pmfs — renders the stack and the baked table, not either empty state", async () => {
    const artifact = baseArtifact({ teams: TWO_TEAM_ROSTER });
    render(
      <RouterTestHarness>
        <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={preScheduleArtifact()} />
      </RouterTestHarness>
    );

    await waitFor(() => expect(screen.getByTestId(SIMULATION_STACK_TESTID)).toBeDefined());
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
    expect(screen.getByTestId(RANK_TABLE_SCROLL_TESTID)).toBeDefined();
    expect(workerConstructorSpy).not.toHaveBeenCalled();
  });

  it("260912-2ur: the pre-schedule disclosure renders the sidecar's REAL scheduleCount, not the `?? 0` fall-through", async () => {
    const artifact = baseArtifact({ teams: TWO_TEAM_ROSTER });
    render(
      <RouterTestHarness>
        <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={preScheduleArtifact()} />
      </RouterTestHarness>
    );

    await waitFor(() => expect(screen.getByTestId(START_MATCH_PRE_SCHEDULE_TESTID)).toBeDefined());
    // Defensive: the scheduleless fixture already defaults to the
    // pre-schedule stop (C-01/C-15), but click it if a future change ever
    // stops defaulting it, so this test does not silently start reading the
    // wrong disclosure line.
    if (screen.getByTestId(START_MATCH_PRE_SCHEDULE_TESTID).getAttribute("data-selected") !== "true") {
      fireEvent.click(screen.getByTestId(START_MATCH_PRE_SCHEDULE_TESTID));
    }

    const expectedCount = preScheduleArtifact().scheduleCount;
    // Vacuity guard: if `PublishedPreScheduleArtifactSchema` or the client
    // ever regressed to reading a missing count as `?? 0`, this fixture's
    // real 17 would still make that regression pass an assertion that only
    // checked "not null" — asserting the real number, and that it is not 0,
    // is what actually catches the fall-through named in this test's title.
    expect(expectedCount).toBe(17);
    expect(expectedCount).not.toBe(0);
    const disclosure = screen.getByTestId("start-match-scope");
    expect(disclosure.textContent).toContain(`across ${expectedCount} randomly generated schedules`);
    expect(disclosure.textContent).toContain("100 draws in total");
  });

  it("an offseason-shaped event with NO sidecar still renders the unavailable state — the widened guard did not swallow it", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} />);

    expect(screen.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeDefined();
  });

  it("CR-01: while the sidecar is in flight on a QUALIFICATION-LESS event, the skeleton renders — never an empty state, never a control-less picker", () => {
    const artifact = baseArtifact({ teams: TWO_TEAM_ROSTER });
    render(
      <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} preScheduleIsPending={true} />
    );

    // Not the empty state (the arriving sidecar could contradict it)...
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
    // ...and not the stack either: with no rows and no baked result the
    // picker would render no slider, no number input and no stop.
    expect(screen.queryByTestId(START_MATCH_SLIDER_TESTID)).toBeNull();
    expect(screen.queryByTestId(START_MATCH_PRE_SCHEDULE_TESTID)).toBeNull();
    expect(screen.queryByRole("button", { name: RUN_LABEL_UPDATE })).toBeNull();
  });

  it("CR-01: while the sidecar is in flight on an OFFSEASON-shaped event, no enabled run button is offered over inputs the unavailable state exists to refuse", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(
      <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} preScheduleIsPending={true} />
    );

    expect(screen.queryByRole("button", { name: RUN_LABEL_UPDATE })).toBeNull();
    // Once the fetch resolves to "no sidecar", the honest state appears.
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
  });

  it("CR-01: a pending sidecar does NOT delay an event that clears both guards — its stack renders immediately", () => {
    const artifact = baseArtifact({
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
    });
    render(
      <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} preScheduleIsPending={true} />
    );

    expect(screen.getByTestId(SIMULATION_STACK_TESTID)).toBeDefined();
    expect(screen.getByTestId(START_MATCH_SLIDER_TESTID)).toBeDefined();
  });

  it("CR-02: a sidecar landing MID-RUN cannot hijack the run — the selection is committed when the button is pressed", async () => {
    // Installs its own mock Worker for the duration, exactly as I1-I7 do:
    // this case genuinely drives a run, and `installMockWorker` substitutes
    // a DIFFERENT class from this file's module-scope `SpyWorker`, so the
    // "still no Worker" invariant below stays intact.
    const handle = installMockWorker({ script: (message, ctx) => runSimulationJob(message, ctx.post) });
    try {
      const artifact = baseArtifact({
        teams: TWO_TEAM_ROSTER,
        upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
      });
      // The reader never touches the picker: the match selection is
      // DERIVED, which is exactly the state that used to be re-evaluated
      // out from under a running simulation when the sidecar resolved.
      const { rerender } = render(
        <RouterTestHarness>
          <SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} preScheduleIsPending={true} />
        </RouterTestHarness>
      );

      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

      // The sidecar resolves while that run is in flight.
      rerender(
        <RouterTestHarness>
          <SimulationTab
            artifact={artifact}
            algorithmId="spr"
            season={2024}
            preSchedule={preScheduleArtifact()}
            preScheduleIsPending={false}
          />
        </RouterTestHarness>
      );

      // The picker must NOT have jumped to the pre-schedule stop, and the
      // baked table must not have displaced the run's own result.
      expect(screen.queryByTestId(START_MATCH_PRE_SCHEDULE_TESTID)).toBeNull();
      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeDefined();
    } finally {
      handle.restore();
    }
  });

  it("with NO sidecar the picker keeps its pre-existing range — position 0 is out of reach and no stop renders", () => {
    const artifact = baseArtifact({
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="spr" season={2024} preSchedule={null} />);

    expect(screen.queryByTestId(START_MATCH_PRE_SCHEDULE_TESTID)).toBeNull();
    expect((screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement).min).toBe("1");
  });
});

describe("08-11: still no Worker", () => {
  it("the global Worker constructor spy installed at module scope recorded zero calls across every case in this file", () => {
    expect(workerConstructorSpy).not.toHaveBeenCalled();
  });
});
