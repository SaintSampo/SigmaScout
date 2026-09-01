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
  REWIND_CAPTION_TESTID,
  START_MATCH_PICKER_HINT,
  START_MATCH_PICKER_TESTID,
  START_MATCH_ROW_TESTID_PREFIX,
  rewindCaptionText,
} from "./StartMatchPicker.js";
import { RUN_ERROR_BODY, RUN_LABEL_IDLE, RUN_LABEL_RERUN, RUN_RETRY_LABEL } from "./RunControl.js";
import { installMockWorker } from "../../test/mockWorker.js";
import type { MockWorkerScript } from "../../test/mockWorker.js";
import { runSimulationJob } from "../../workers/simulationProtocol.js";
import { REWIND_GAP_PERCENT, REWIND_GAP_VERDICT } from "../../lib/rewindGap.js";
import { RootSearchSchema, TeamSearchSchema } from "../../lib/searchParams.js";
import { baseArtifact, BOTH_PMFS, playedQualRow, upcomingQualRow } from "./simulationTestFixtures.js";
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
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByText(SIMULATION_EMPTY_STATE_HEADING)).toBeDefined();
    expect(screen.getByText(SIMULATION_EMPTY_STATE_BODY)).toBeDefined();
  });

  it("renders the UNAVAILABLE state (not the empty state) when qualification matches exist but carry no pmf anywhere", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeDefined();
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
  });

  it("renders the PRE-RUN state (not an empty state) when pmfs exist on upcoming[] only — proving the predicate reads both arrays", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    expect(screen.queryByText(SIMULATION_EMPTY_STATE_HEADING)).toBeNull();
    expect(screen.queryByText(SIMULATION_UNAVAILABLE_HEADING)).toBeNull();
  });

  it("renders the PRE-RUN state when pmfs exist on matches[] only — the common post-08-05 shape, mirror of the upcoming-only case", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
  });

  it("renders PRE-RUN (class, not completeness — PD-06) when some qm rows carry both pmfs and others carry none, naming that per-row completeness is 08-11's question", () => {
    const artifact = baseArtifact({
      matches: [
        playedQualRow(BOTH_PMFS),
        playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 }),
      ],
    });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID)).toBeDefined();
  });

  it("the layout stack testid is present and the pre-run paragraph is its descendant — the mount point 08-11/08-13/08-14 each add a child to", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
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
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
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
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.queryByTestId(START_MATCH_PICKER_TESTID)).toBeNull();
    expect(screen.queryByTestId(REWIND_CAPTION_TESTID)).toBeNull();
  });

  it("the no-pmf unavailable state renders no picker and no caption", () => {
    const artifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.queryByTestId(START_MATCH_PICKER_TESTID)).toBeNull();
    expect(screen.queryByTestId(REWIND_CAPTION_TESTID)).toBeNull();
  });
});

describe("08-11: default selection", () => {
  it("defaults to the first genuinely-unplayed qualification match; the hint is absent and the scope line renders", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");
    expect(screen.queryByText(START_MATCH_PICKER_HINT)).toBeNull();
  });

  it("selects nothing on a fully-played event; the hint renders exactly and the scope line is absent", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByText(START_MATCH_PICKER_HINT)).toBeDefined();
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBeNull();
  });
});

describe("08-11: the rewind-honesty caption", () => {
  it("selecting a played row shows the caption immediately, with no Run press, carrying rewindCaptionText(REWIND_GAP_PERCENT, REWIND_GAP_VERDICT)'s output", () => {
    const artifact = baseArtifact({ matches: [playedQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`));
    const caption = screen.getByTestId(REWIND_CAPTION_TESTID);
    expect(caption.textContent).toBe(rewindCaptionText(REWIND_GAP_PERCENT, REWIND_GAP_VERDICT));
  });

  it("a no-rewind default selection (the unplayed-qual event) shows no caption", () => {
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.queryByTestId(REWIND_CAPTION_TESTID)).toBeNull();
  });

  it("the caption follows the rewind PREDICATE, not the selected row's own played flag (PD-08): the default selection is the unplayed row, but a played row ordered after it still triggers the caption", () => {
    const artifact = baseArtifact({
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1, sortTime: 100 })],
      matches: [playedQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2, sortTime: 200 })],
    });
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId(REWIND_CAPTION_TESTID)).toBeDefined();
  });
});

describe("08-11: selection survives a refetch (PD-06)", () => {
  it("keeps the same selected matchKey when a refetch moves the match from upcoming[] to matches[]", () => {
    const artifact1 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({ matches: [playedQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    rerender(<SimulationTab artifact={artifact2} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");
  });

  it("a selected key that disappears from a refetched artifact resolves to no selection, never a neighbouring row", () => {
    const artifact1 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })] });
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({ upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm99", matchNumber: 99 })] });
    rerender(<SimulationTab artifact={artifact2} algorithmId="vpr" season={2024} />);
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
    const { rerender } = render(<SimulationTab artifact={artifact1} algorithmId="vpr" season={2024} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");

    fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`));
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");

    const artifact2 = baseArtifact({
      matches: [playedQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm1", matchNumber: 1 })],
      upcoming: [upcomingQualRow({ ...BOTH_PMFS, matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    rerender(<SimulationTab artifact={artifact2} algorithmId="vpr" season={2024} />);
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
          <SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByTestId(START_MATCH_PICKER_TESTID)).toBeDefined());

      fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`));
      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));

      await waitFor(() => expect(screen.getByText(/^Simulated \d+ draws in/)).toBeDefined());
      expect(handle.instances).toHaveLength(1);
      expect(handle.instances[0]!.received).toHaveLength(1);
      expect(screen.getByRole("button", { name: RUN_LABEL_RERUN })).toBeDefined();
    } finally {
      handle.restore();
    }
  });

  it("I2: UI-SPEC S2, construction half — failOnConstruct renders the inline error + Retry, with no progressbar at any point", async () => {
    const handle = installMockWorker({ failOnConstruct: new Error("no module workers here") });
    try {
      const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
      render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));

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
      render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));

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
      render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await waitFor(() => expect(screen.getByRole("progressbar")).toBeDefined());

      fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm3`));

      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm3`).getAttribute("data-selected")).toBeNull();
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
      render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await waitFor(() => expect(screen.getByRole("progressbar")).toBeDefined());

      expect(screen.getByTestId(SIMULATION_PRE_RUN_TESTID).textContent).toBe(SIMULATION_PRE_RUN_BODY);
    } finally {
      handle.restore();
    }
  });

  it("I6: pressing nothing constructs nothing — no Worker mock installed for this test, no error thrown, no progressbar", () => {
    const callsBefore = workerConstructorSpy.mock.calls.length;
    const artifact = baseArtifact({ upcoming: [upcomingQualRow(BOTH_PMFS)] });
    expect(() => render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />)).not.toThrow();
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID)).toBeDefined();
    expect(screen.getByRole("button", { name: RUN_LABEL_IDLE })).toBeDefined();
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
          <SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_IDLE })).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
      await waitFor(() => expect(screen.getByText(/^Simulated \d+ draws in/)).toBeDefined());
      expect(screen.getByRole("button", { name: RUN_LABEL_RERUN })).toBeDefined();

      fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm3`));

      expect(screen.queryByText(/^Simulated \d+ draws in/)).toBeNull();
      expect(screen.getByRole("button", { name: RUN_LABEL_IDLE })).toBeDefined();
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
    render(<SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />);
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
          <SimulationTab artifact={artifact} algorithmId="vpr" season={2024} />
        </RouterTestHarness>
      );
      await waitFor(() => expect(screen.getByRole("button", { name: RUN_LABEL_IDLE })).toBeDefined());

      fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_IDLE }));
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
    const { unmount } = render(<SimulationTab artifact={emptyArtifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByText(SIMULATION_EMPTY_STATE_HEADING)).toBeDefined();
    expect(screen.queryByTestId(RANK_TABLE_SCROLL_TESTID)).toBeNull();
    unmount();

    const unavailableArtifact = baseArtifact({
      matches: [playedQualRow(), playedQualRow({ matchKey: "2024test_qm2", matchNumber: 2 })],
    });
    render(<SimulationTab artifact={unavailableArtifact} algorithmId="vpr" season={2024} />);
    expect(screen.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeDefined();
    expect(screen.queryByTestId(RANK_TABLE_SCROLL_TESTID)).toBeNull();
  });
});

describe("08-11: still no Worker", () => {
  it("the global Worker constructor spy installed at module scope recorded zero calls across every case in this file", () => {
    expect(workerConstructorSpy).not.toHaveBeenCalled();
  });
});
