import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PROGRESS_BAR_H_PX,
  RUN_COMPLETE_PREFIX,
  RUN_CONTROL_TESTID,
  RUN_ERROR_BODY,
  RUN_LABEL_UPDATE,
  RUN_RETRY_LABEL,
  RunControl,
  formatElapsedSeconds,
} from "./RunControl.js";
import { SIMULATION_DRAWS } from "../../lib/simulationInputs.js";
import type { SimulationRunState } from "./useSimulationRun.js";

/**
 * `RunControl.tsx`'s own coverage (08-13-PLAN.md Task 2, R1-R9). No `Worker`
 * mock is installed anywhere in this file — not even a hand-rolled one —
 * which is the proof that the component is a pure function of props: every
 * stateful concern lives in `useSimulationRun.ts` (Task 1), asserted
 * separately.
 */

const idleState: SimulationRunState = { status: "idle" };
const runningState: SimulationRunState = { status: "running", completedDraws: 350, totalDraws: SIMULATION_DRAWS, elapsedMs: 4200 };
const completeState: SimulationRunState = {
  status: "complete",
  result: { rankHistograms: new Map(), draws: SIMULATION_DRAWS },
  elapsedMs: 2837,
  computeMs: 12.5,
  signature: "sig-1",
  teamCount: 6,
  remainingMatches: 3,
};
const errorState: SimulationRunState = { status: "error" };

describe("RunControl", () => {
  it("R1: idle, nothing selected — the button reads RUN_LABEL_UPDATE, is disabled, carries tap-target, and no progressbar exists", () => {
    render(<RunControl state={idleState} isResultCurrent={false} canRun={false} onRun={vi.fn()} />);
    const button = screen.getByRole("button", { name: RUN_LABEL_UPDATE }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toMatch(/\btap-target\b/);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("R2: idle, a start match selected — the same button is enabled", () => {
    render(<RunControl state={idleState} isResultCurrent={false} canRun={true} onRun={vi.fn()} />);
    const button = screen.getByRole("button", { name: RUN_LABEL_UPDATE }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("R3: running — one determinate progressbar at PROGRESS_BAR_H_PX, the counter, the timer, and no update button", () => {
    render(<RunControl state={runningState} isResultCurrent={false} canRun={false} onRun={vi.fn()} />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    const bar = bars[0]!;
    expect(bar.getAttribute("aria-valuenow")).toBe("350");
    expect(bar.getAttribute("aria-valuemax")).toBe(String(SIMULATION_DRAWS));
    expect((bar as HTMLElement).style.height).toBe(`${PROGRESS_BAR_H_PX}px`);
    expect(screen.getByText("350 / 1000 draws")).toBeDefined();
    expect(screen.getByText(/s elapsed$/)).toBeDefined();
    expect(screen.queryByRole("button", { name: RUN_LABEL_UPDATE })).toBeNull();
  });

  it("R4: complete — the whole sentence, the four measurement attributes, no progressbar, and the UPDATE label", () => {
    render(<RunControl state={completeState} isResultCurrent={true} canRun={true} onRun={vi.fn()} />);
    const sentence = screen.getByText("Simulated 1000 draws in 2.8s");
    expect(sentence.getAttribute("data-elapsed-ms")).toBe("2837");
    expect(sentence.getAttribute("data-compute-ms")).toBe("12.5");
    expect(sentence.getAttribute("data-team-count")).toBe("6");
    expect(sentence.getAttribute("data-remaining-matches")).toBe("3");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();
  });

  it("R5: complete but superseded — no completion line at all; the button reads RUN_LABEL_UPDATE in every state (C-03)", () => {
    render(<RunControl state={completeState} isResultCurrent={false} canRun={true} onRun={vi.fn()} />);
    expect(screen.queryByText(/Simulated \d+ draws in/)).toBeNull();
    // Before C-03 this pair asserted "the IDLE label, not the RERUN label".
    // With one label for every state, the surviving distinction between a
    // current and a superseded result is the completion line above — which
    // is exactly what the first assertion pins. Asserting the label is
    // present here is what proves the button is still offered (a superseded
    // result must remain re-runnable), and there is deliberately no second
    // label whose absence could be asserted.
    expect(screen.getByRole("button", { name: RUN_LABEL_UPDATE })).toBeDefined();
  });

  it("R6: error — the fixed copy, a tap-target Retry control, no progressbar, and Retry invokes onRun exactly once", () => {
    const onRun = vi.fn();
    render(<RunControl state={errorState} isResultCurrent={false} canRun={true} onRun={onRun} />);
    expect(screen.getByText(RUN_ERROR_BODY)).toBeDefined();
    const retry = screen.getByRole("button", { name: RUN_RETRY_LABEL });
    expect(retry.className).toMatch(/\btap-target\b/);
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(retry);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("R7: formatElapsedSeconds — the sub-tenth-of-a-second bound, asserted directly and through the rendered sentence", () => {
    expect(formatElapsedSeconds(2837)).toBe("2.8");
    expect(formatElapsedSeconds(49)).toBe("<0.1");
    expect(formatElapsedSeconds(95)).toBe("<0.1");
    expect(formatElapsedSeconds(100)).toBe("0.1");
    expect(formatElapsedSeconds(0)).toBe("<0.1");

    const boundState: SimulationRunState = { ...completeState, elapsedMs: 49 };
    render(<RunControl state={boundState} isResultCurrent={true} canRun={true} onRun={vi.fn()} />);
    expect(screen.getByText(`${RUN_COMPLETE_PREFIX} <0.1s`)).toBeDefined();
  });

  it("R8: no internals reach the DOM — the error region carries no error name or message from any source", () => {
    render(<RunControl state={errorState} isResultCurrent={false} canRun={true} onRun={vi.fn()} />);
    const region = screen.getByTestId(RUN_CONTROL_TESTID);
    expect(region.textContent).not.toMatch(/Error|TypeError|stack|undefined/);
  });

  it("R9: the counter and the bar cannot disagree — aria-valuenow always equals the integer printed in the counter text", () => {
    for (const completedDraws of [0, 350, 1000]) {
      const state: SimulationRunState = { status: "running", completedDraws, totalDraws: SIMULATION_DRAWS, elapsedMs: 1000 };
      const { unmount } = render(<RunControl state={state} isResultCurrent={false} canRun={false} onRun={vi.fn()} />);
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe(String(completedDraws));
      expect(screen.getByText(`${completedDraws} / ${SIMULATION_DRAWS} draws`)).toBeDefined();
      unmount();
    }
  });
});
