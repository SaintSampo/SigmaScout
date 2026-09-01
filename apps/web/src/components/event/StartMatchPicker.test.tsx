import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import {
  START_MATCH_PICKER_HINT,
  START_MATCH_SLIDER_TESTID,
  START_MATCH_NUMBER_INPUT_TESTID,
  START_MATCH_PICKER_TESTID,
  START_MATCH_ROW_TESTID_PREFIX,
  START_MATCH_STATUS_PLAYED,
  START_MATCH_STATUS_UPCOMING,
  StartMatchPicker,
  simulationScopeText,
} from "./StartMatchPicker.js";
import { SIMULATION_DRAWS } from "../../lib/simulationInputs.js";
import { formatScheduledTime, matchLabel } from "../team/MatchTable.js";
import type { EventMatchRow } from "./eventMatchAxis.js";
import type { SimulationInputs } from "../../lib/simulationInputs.js";

/**
 * `StartMatchPicker`'s own coverage (08-11-PLAN.md Task 2) — row anatomy,
 * the three row states, selection/inert behavior, the hint-versus-scope
 * disclosure, all three rewind-caption verdict branches, and the
 * largest-reachable-schedule bounded-panel render.
 *
 * Fixtures are built directly as `EventMatchRow[]` — this component takes
 * rows, not an artifact, which keeps its own test free of the schema.
 */

function row(overrides: Partial<EventMatchRow> = {}): EventMatchRow {
  return {
    matchKey: "2024test_qm1",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc111", "frc222", "frc333"],
    blueTeams: ["frc444", "frc555", "frc666"],
    predictedWinner: "red",
    pRedWin: 0.6,
    predictedRedScore: 100,
    predictedBlueScore: 90,
    played: false,
    ...overrides,
  };
}

function baseInputs(overrides: Partial<SimulationInputs> = {}): SimulationInputs {
  return {
    startMatchKey: "2024test_qm1",
    isRewindStart: false,
    remainingMatches: [],
    baselines: [],
    excludedMatchKeys: [],
    incompleteBaselineTeamKeys: [],
    baselineSources: new Map(),
    ...overrides,
  };
}

describe("row anatomy", () => {
  it("shows the SELECTED match's label and every red/blue team number; the slider spans the whole schedule (2026-09-01: one summary, not one row per match)", () => {
    const rows = [row({ matchKey: "2024test_qm1", matchNumber: 1 }), row({ matchKey: "2024test_qm2", matchNumber: 2, played: true })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm2" onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);

    const selected = rows[1]!;
    const el = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}${selected.matchKey}`);
    expect(el.textContent).toContain(matchLabel(selected));
    for (const teamKey of [...selected.redTeams, ...selected.blueTeams]) {
      expect(el.textContent).toContain(teamKey.replace("frc", ""));
    }
    // The unselected match is reachable through the slider's range rather
    // than rendered as its own row.
    expect(screen.queryByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeNull();
    const slider = screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement;
    expect(slider.min).toBe("1");
    expect(slider.max).toBe(String(rows.length));
    expect(slider.value).toBe("2");
  });

  it("renders no nickname-shaped content — team numbers only, never a team name", () => {
    const rows = [row({ redTeams: ["frc111"], blueTeams: ["frc222"] })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    const el = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);
    expect(el.textContent).toContain("111");
    expect(el.textContent).toContain("222");
    expect(el.textContent).not.toContain("frc");
  });
});

describe("status labels", () => {
  it("a played row renders START_MATCH_STATUS_PLAYED", () => {
    const rows = [row({ played: true })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(START_MATCH_STATUS_PLAYED);
  });

  it("an unplayed row renders START_MATCH_STATUS_UPCOMING", () => {
    const rows = [row({ played: false })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(START_MATCH_STATUS_UPCOMING);
  });
});

describe("the absent-sortTime partial case (S1 partial)", () => {
  it("a row with no sortTime renders NO time text at all — blank, never an em-dash placeholder (2026-09-01)", () => {
    const rows = [row({ sortTime: undefined })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    const rowEl = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);
    expect(rowEl.textContent).not.toContain("—");
    // The row itself still renders its identity and status, so this proves a
    // MISSING time rather than a missing row.
    expect(rowEl.textContent).toContain("Qual 1");
  });

  it("a row with sortTime renders exactly formatScheduledTime(row.sortTime)'s output, computed by calling the imported function", () => {
    const sortTime = 1735689600;
    const rows = [row({ sortTime })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(formatScheduledTime(sortTime));
  });
});

describe("selection", () => {
  it("dragging the slider reports the matchKey at that POSITION exactly once", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1" }), row({ matchKey: "2024test_qm2", matchNumber: 2 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={onSelect} inputs={null} startMatchNumber={null} disabled={false} />);
    fireEvent.change(screen.getByTestId(START_MATCH_SLIDER_TESTID), { target: { value: "2" } });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("2024test_qm2");
  });

  it("typing a match NUMBER reports the row carrying that number, not the row at that position", () => {
    const onSelect = vi.fn();
    // A schedule with a gap: match numbers 1 and 7, so position and number
    // disagree. Typing 7 must reach qm7, never the row that happens to sit
    // seventh (there isn't one).
    const rows = [row({ matchKey: "2024test_qm1", matchNumber: 1 }), row({ matchKey: "2024test_qm7", matchNumber: 7 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={onSelect} inputs={null} startMatchNumber={null} disabled={false} />);
    fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: "7" } });
    expect(onSelect).toHaveBeenCalledWith("2024test_qm7");
  });

  it("typing a match number that does not exist reports nothing at all, leaving the current selection alone", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1", matchNumber: 1 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={onSelect} inputs={null} startMatchNumber={null} disabled={false} />);
    fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: "999" } });
    expect(onSelect).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeDefined();
  });

  it("with nothing selected the picker still shows the FIRST match, so the summary is never blank", () => {
    const rows = [row({ matchKey: "2024test_qm1" }), row({ matchKey: "2024test_qm2", matchNumber: 2 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeDefined();
  });
});

describe("inert while disabled (PD-09)", () => {
  it("with disabled set, both controls are disabled, the panel carries the inert attribute, and the selected match stays readable", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1" }), row({ matchKey: "2024test_qm2", matchNumber: 2 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={onSelect} inputs={null} startMatchNumber={null} disabled={true} />);
    const rowEl = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);

    expect((screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID).hasAttribute("inert")).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(0);
    // PD-09's readability half: the reader can still see which match a
    // running simulation started from.
    expect(rowEl.textContent).toContain(matchLabel(row({ matchKey: "2024test_qm1" })));
  });
});

describe("reaching any match without scrolling (2026-09-01)", () => {
  it("the slider's range covers the whole schedule, so the last match of a 134-match event is one gesture away", () => {
    const rows = Array.from({ length: 134 }, (_, index) => row({ matchKey: `2022oncmp_qm${index + 1}`, matchNumber: index + 1, played: true }));
    const onSelect = vi.fn();
    render(<StartMatchPicker rows={rows} selectedMatchKey={rows[0]!.matchKey} onSelect={onSelect} inputs={null} startMatchNumber={null} disabled={false} />);

    const slider = screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement;
    expect(slider.max).toBe("134");
    fireEvent.change(slider, { target: { value: "134" } });
    expect(onSelect).toHaveBeenCalledWith("2022oncmp_qm134");
  });
});

describe("hint versus scope line", () => {
  it("with no selection, the hint renders with START_MATCH_PICKER_HINT's exact string and the scope line is absent", () => {
    const rows = [row()];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByText(START_MATCH_PICKER_HINT)).toBeDefined();
  });

  it("with a selection, the hint is absent and the scope line renders simulationScopeText's output for the given inputs", () => {
    const rows = [row()];
    const inputs = baseInputs({ remainingMatches: [{ redTeamKeys: ["frc111"], blueTeamKeys: ["frc444"], redRpPmf: [1], blueRpPmf: [1] }] });
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={() => {}} inputs={inputs} startMatchNumber={1} disabled={false} />);
    expect(screen.queryByText(START_MATCH_PICKER_HINT)).toBeNull();
    expect(screen.getByText(simulationScopeText(inputs, 1))).toBeDefined();
  });
});

describe("the hint and the draw count cannot drift (PD-10)", () => {
  it("START_MATCH_PICKER_HINT contains String(SIMULATION_DRAWS)", () => {
    expect(START_MATCH_PICKER_HINT).toContain(String(SIMULATION_DRAWS));
  });
});

describe("simulationScopeText discloses both counts", () => {
  it("names the start match and says plainly that it is itself simulated, with the draw count and no disclosures", () => {
    const inputs = baseInputs({
      remainingMatches: [{ redTeamKeys: ["frc111"], blueTeamKeys: ["frc444"], redRpPmf: [1], blueRpPmf: [1] }],
    });
    const text = simulationScopeText(inputs, 1);
    // The user-authored wording (2026-09-01), pinned verbatim: the old
    // "from Qual 1 onward" left the inclusive/exclusive boundary ambiguous.
    expect(text).toBe(`Simulating qualification match 1 and every Qual after it ${SIMULATION_DRAWS} times.`);
    expect(text).not.toContain("carry no predicted");
    expect(text).not.toContain("have an earlier match");
  });

  it("names whichever match is selected, not always the first", () => {
    expect(simulationScopeText(baseInputs(), 47)).toContain("qualification match 47 and every Qual after it");
  });

  it("with one excluded match, additionally names that count", () => {
    const inputs = baseInputs({ excludedMatchKeys: ["2024test_qm5"] });
    const text = simulationScopeText(inputs, 1);
    expect(text).toContain("1 further qualification match(es) carry no predicted ranking-point distribution");
  });

  it("with two incomplete-baseline teams, additionally names that count", () => {
    const inputs = baseInputs({ incompleteBaselineTeamKeys: ["frc111", "frc222"] });
    const text = simulationScopeText(inputs, 1);
    expect(text).toContain("2 team(s) have an earlier match with no recorded ranking points");
  });
});

describe("the largest reachable schedule stays a fixed footprint (S1 overflow)", () => {
  it("2022oncmp's measured 134 played qualification rows — the largest RP-eligible qualification schedule, not 2024wvrox (offseason, publishes no distributions) — render as ONE summary, so the picker's height no longer grows with the schedule", () => {
    const rows = Array.from({ length: 134 }, (_, i) => row({ matchKey: `2022oncmp_qm${i + 1}`, matchNumber: i + 1, played: true }));
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    // Exactly one match summary exists no matter how long the schedule is.
    expect(screen.getAllByTestId(/^start-match-row-/)).toHaveLength(1);
    expect((screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement).max).toBe("134");
  });
});

describe("one-row and empty lists (S1 zero-one-many)", () => {
  it("a single-row list renders that one match, with a slider whose range is a single position", () => {
    const rows = [row()];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`)).toBeDefined();
    const slider = screen.getByTestId(START_MATCH_SLIDER_TESTID) as HTMLInputElement;
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("1");
  });

  it("an empty list renders no summary, no controls and no crash", () => {
    render(<StartMatchPicker rows={[]} selectedMatchKey={null} onSelect={() => {}} inputs={null} startMatchNumber={null} disabled={false} />);
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID).children.length).toBe(0);
    expect(screen.queryByTestId(START_MATCH_SLIDER_TESTID)).toBeNull();
  });
});

describe("the two contract strings are shipped verbatim", () => {
  it("START_MATCH_PICKER_HINT, START_MATCH_STATUS_PLAYED and START_MATCH_STATUS_UPCOMING match 08-UI-SPEC.md's Copywriting Contract rows exactly", () => {
    expect(START_MATCH_PICKER_HINT).toBe(`Pick a match to simulate from. Matches after it are simulated ${SIMULATION_DRAWS}×.`);
    expect(START_MATCH_STATUS_PLAYED).toBe("Played");
    expect(START_MATCH_STATUS_UPCOMING).toBe("Upcoming");
  });
});
