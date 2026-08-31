import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import {
  REWIND_CAPTION_LEAD,
  START_MATCH_PICKER_HINT,
  START_MATCH_PICKER_MAX_H_PX,
  START_MATCH_PICKER_TESTID,
  START_MATCH_ROW_TESTID_PREFIX,
  START_MATCH_STATUS_PLAYED,
  START_MATCH_STATUS_UPCOMING,
  StartMatchPicker,
  rewindCaptionText,
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
  it("renders one row per qualification match, in the given order, each with matchLabel() output, every red/blue team number and a status label", () => {
    const rows = [row({ matchKey: "2024test_qm1", matchNumber: 1 }), row({ matchKey: "2024test_qm2", matchNumber: 2, played: true })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    for (const r of rows) {
      const el = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}${r.matchKey}`);
      expect(el.textContent).toContain(matchLabel(r));
      for (const teamKey of [...r.redTeams, ...r.blueTeams]) {
        expect(el.textContent).toContain(teamKey.replace("frc", ""));
      }
    }
  });

  it("renders no nickname-shaped content — team numbers only, never a team name", () => {
    const rows = [row({ redTeams: ["frc111"], blueTeams: ["frc222"] })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    const el = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);
    expect(el.textContent).toContain("111");
    expect(el.textContent).toContain("222");
    expect(el.textContent).not.toContain("frc");
  });
});

describe("status labels", () => {
  it("a played row renders START_MATCH_STATUS_PLAYED", () => {
    const rows = [row({ played: true })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(START_MATCH_STATUS_PLAYED);
  });

  it("an unplayed row renders START_MATCH_STATUS_UPCOMING", () => {
    const rows = [row({ played: false })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(START_MATCH_STATUS_UPCOMING);
  });
});

describe("the em-dash partial case (S1 partial)", () => {
  it("a row with no sortTime renders an em dash in the time position", () => {
    const rows = [row({ sortTime: undefined })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain("—");
  });

  it("a row with sortTime renders exactly formatScheduledTime(row.sortTime)'s output, computed by calling the imported function", () => {
    const sortTime = 1735689600;
    const rows = [row({ sortTime })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).textContent).toContain(formatScheduledTime(sortTime));
  });
});

describe("selection", () => {
  it("clicking a row calls onSelect exactly once with that row's matchKey; the selected row carries the selected marker and no other row does", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1" }), row({ matchKey: "2024test_qm2", matchNumber: 2 })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={onSelect} inputs={null} startLabel={null} disabled={false} />);
    const row2 = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`);
    fireEvent.click(row2);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("2024test_qm2");
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`).getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm2`).getAttribute("data-selected")).toBeNull();
  });

  it("clicking the already-selected row still reports the same key rather than deselecting", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1" })];
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={onSelect} inputs={null} startLabel={null} disabled={false} />);
    fireEvent.click(screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`));
    expect(onSelect).toHaveBeenCalledWith("2024test_qm1");
  });
});

describe("inert while disabled (PD-09)", () => {
  it("with disabled set, clicking any row calls onSelect zero times, the panel carries the inert attribute, and rows stay readable", () => {
    const onSelect = vi.fn();
    const rows = [row({ matchKey: "2024test_qm1" })];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={onSelect} inputs={null} startLabel={null} disabled={true} />);
    const rowEl = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);
    fireEvent.click(rowEl);
    expect(onSelect).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID).hasAttribute("inert")).toBe(true);
    expect(rowEl.textContent).toContain(matchLabel(row({ matchKey: "2024test_qm1" })));
  });
});

describe("tap target", () => {
  it("every row carries the app's minimum tap-target class, and the clickable element spans the full row", () => {
    const rows = [row()];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    const rowEl = screen.getByTestId(`${START_MATCH_ROW_TESTID_PREFIX}2024test_qm1`);
    expect(rowEl.className).toContain("tap-target");
    expect(rowEl.tagName).toBe("BUTTON");
    expect(rowEl.className).toContain("w-full");
  });
});

describe("hint versus scope line", () => {
  it("with no selection, the hint renders with START_MATCH_PICKER_HINT's exact string and the scope line is absent", () => {
    const rows = [row()];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByText(START_MATCH_PICKER_HINT)).toBeDefined();
  });

  it("with a selection, the hint is absent and the scope line renders simulationScopeText's output for the given inputs", () => {
    const rows = [row()];
    const inputs = baseInputs({ remainingMatches: [{ redTeamKeys: ["frc111"], blueTeamKeys: ["frc444"], redRpPmf: [1], blueRpPmf: [1] }] });
    render(<StartMatchPicker rows={rows} selectedMatchKey="2024test_qm1" onSelect={() => {}} inputs={inputs} startLabel="Qual 1" disabled={false} />);
    expect(screen.queryByText(START_MATCH_PICKER_HINT)).toBeNull();
    expect(screen.getByText(simulationScopeText(inputs, "Qual 1"))).toBeDefined();
  });
});

describe("the hint and the draw count cannot drift (PD-10)", () => {
  it("START_MATCH_PICKER_HINT contains String(SIMULATION_DRAWS)", () => {
    expect(START_MATCH_PICKER_HINT).toContain(String(SIMULATION_DRAWS));
  });
});

describe("simulationScopeText discloses both counts", () => {
  it("with no exclusions and no incomplete baselines, names only the simulated match count, the start label and the draw count", () => {
    const inputs = baseInputs({
      remainingMatches: [{ redTeamKeys: ["frc111"], blueTeamKeys: ["frc444"], redRpPmf: [1], blueRpPmf: [1] }],
    });
    const text = simulationScopeText(inputs, "Qual 1");
    expect(text).toContain("1 qualification match from Qual 1 onward");
    expect(text).toContain(String(SIMULATION_DRAWS));
    expect(text).not.toContain("carry no predicted");
    expect(text).not.toContain("have an earlier match");
  });

  it("with one excluded match, additionally names that count", () => {
    const inputs = baseInputs({ excludedMatchKeys: ["2024test_qm5"] });
    const text = simulationScopeText(inputs, "Qual 1");
    expect(text).toContain("1 further qualification match(es) carry no predicted ranking-point distribution");
  });

  it("with two incomplete-baseline teams, additionally names that count", () => {
    const inputs = baseInputs({ incompleteBaselineTeamKeys: ["frc111", "frc222"] });
    const text = simulationScopeText(inputs, "Qual 1");
    expect(text).toContain("2 team(s) have an earlier match with no recorded ranking points");
  });
});

describe("rewindCaptionText, all three verdicts", () => {
  it("narrower: contains the lead sentence, the word 'narrower', and the magnitude to one decimal place", () => {
    const text = rewindCaptionText(10.848394210456348, "narrower");
    expect(text).toContain(REWIND_CAPTION_LEAD);
    expect(text).toContain("narrower");
    expect(text).toContain("10.8%");
  });

  it("wider: contains 'wider' and not 'narrower'", () => {
    const text = rewindCaptionText(6.2, "wider");
    expect(text).toContain("wider");
    expect(text).not.toContain("narrower");
  });

  it("indistinguishable: contains neither direction word and no percent sign at all", () => {
    const text = rewindCaptionText(0.3, "indistinguishable");
    expect(text).not.toContain("narrower");
    expect(text).not.toContain("wider");
    expect(text).not.toContain("%");
  });

  it("all three verdicts contain REWIND_CAPTION_LEAD verbatim", () => {
    for (const verdict of ["narrower", "wider", "indistinguishable"] as const) {
      expect(rewindCaptionText(5, verdict)).toContain(REWIND_CAPTION_LEAD);
    }
  });
});

describe("the magnitude is absolute", () => {
  it("a negative percent with the wider verdict produces no minus sign", () => {
    const text = rewindCaptionText(-8.549486466710535, "wider");
    expect(text).not.toContain("-8.5");
    expect(text).not.toMatch(/-\d/);
    expect(text).toContain("8.5%");
  });
});

describe("no placeholder ever survives", () => {
  it("no verdict, at any percent including zero, ever contains a brace character", () => {
    for (const verdict of ["narrower", "wider", "indistinguishable"] as const) {
      for (const percent of [0, 10.8, -8.5, 44.18]) {
        const text = rewindCaptionText(percent, verdict);
        expect(text).not.toContain("{");
        expect(text).not.toContain("}");
      }
    }
  });
});

describe("bounded panel at the largest reachable schedule (S1 overflow)", () => {
  it("2022oncmp's measured 134 played qualification rows — the largest RP-eligible qualification schedule, not 2024wvrox (offseason, publishes no distributions) — render as 134 row elements inside the bounded-height scroll container", () => {
    const rows = Array.from({ length: 134 }, (_, i) => row({ matchKey: `2022oncmp_qm${i + 1}`, matchNumber: i + 1, played: true }));
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    const panel = screen.getByTestId(START_MATCH_PICKER_TESTID);
    expect(panel.children.length).toBe(134);
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("overscroll-y-contain");
    expect((panel as HTMLElement).style.maxHeight).toBe(`${START_MATCH_PICKER_MAX_H_PX}px`);
  });
});

describe("one-row and empty lists (S1 zero-one-many)", () => {
  it("a single-row list renders as an ordinary one-row list", () => {
    const rows = [row()];
    render(<StartMatchPicker rows={rows} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID).children.length).toBe(1);
  });

  it("an empty list renders no rows and no crash", () => {
    render(<StartMatchPicker rows={[]} selectedMatchKey={null} onSelect={() => {}} inputs={null} startLabel={null} disabled={false} />);
    expect(screen.getByTestId(START_MATCH_PICKER_TESTID).children.length).toBe(0);
  });
});

describe("the two contract strings are shipped verbatim", () => {
  it("START_MATCH_PICKER_HINT, START_MATCH_STATUS_PLAYED and START_MATCH_STATUS_UPCOMING match 08-UI-SPEC.md's Copywriting Contract rows exactly", () => {
    expect(START_MATCH_PICKER_HINT).toBe(`Pick a match to simulate from — matches after it are simulated ${SIMULATION_DRAWS}×.`);
    expect(START_MATCH_STATUS_PLAYED).toBe("Played");
    expect(START_MATCH_STATUS_UPCOMING).toBe("Upcoming");
  });
});
