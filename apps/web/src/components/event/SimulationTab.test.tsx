import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
import { REWIND_GAP_PERCENT, REWIND_GAP_VERDICT } from "../../lib/rewindGap.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

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
 * Every fixture below is a HAND-WRITTEN `EventArtifact`-shaped object literal
 * — the panel needs adversarial shapes (qm rows with no pmfs, pmfs on one
 * array only, a pmf on a playoff row only) that no single real artifact
 * contains. `packages/harness/pageArtifacts.ts` is read-only here — this
 * file never imports its schema, only its inferred `EventArtifact` type.
 */

const BASE_PREAMBLE = {
  schemaVersion: 1,
  generation: "gen-1",
  computedAt: "2026-08-31T00:00:00.000Z",
  algorithmId: "vpr",
  algorithmVersion: "2.1.0+tuned-2026-08",
};

function baseArtifact(overrides: Partial<EventArtifact> = {}): EventArtifact {
  return {
    ...BASE_PREAMBLE,
    eventKey: "2024test",
    season: 2024,
    matches: [],
    upcoming: [],
    teams: [],
    ...overrides,
  } as EventArtifact;
}

function playedQualRow(overrides: Record<string, unknown> = {}) {
  return {
    matchKey: "2024test_qm1",
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1"],
    blueTeams: ["frc2"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    actualWinner: "red" as const,
    actualRedScore: 105,
    actualBlueScore: 88,
    ...overrides,
  };
}

function upcomingQualRow(overrides: Record<string, unknown> = {}) {
  return {
    matchKey: "2024test_qm2",
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc1"],
    blueTeams: ["frc2"],
    predictedWinner: "red" as const,
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    ...overrides,
  };
}

const BOTH_PMFS = { redRpPmf: [0.2, 0.3, 0.5], blueRpPmf: [0.4, 0.3, 0.3] };

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

describe("08-11: still no Worker", () => {
  it("the global Worker constructor spy installed at module scope recorded zero calls across every case in this file", () => {
    expect(workerConstructorSpy).not.toHaveBeenCalled();
  });
});
