import { Button } from "@/components/ui/button";
import { SIMULATION_DRAWS } from "../../lib/simulationInputs.js";
import type { SimulationRunState } from "./useSimulationRun.js";

/**
 * D-07's run control (08-13-PLAN.md Task 2): four rendered states — idle,
 * running, complete, error — as a PURE function of props. Holds no React
 * state, runs no timer and constructs nothing; every stateful concern
 * (the Worker, the ticking timer, the run-id guard) lives in
 * `useSimulationRun.ts` (Task 1). This is what lets this component's own
 * test file install no `Worker` mock of any kind.
 *
 * `isResultCurrent` and `state.status === "complete"` are two SEPARATE
 * questions (PD-02/PD-03): a `state.status === "complete"` result whose
 * inputs have since changed (`isResultCurrent === false`) renders NO
 * completion line and a button reading `RUN_LABEL_IDLE`, not
 * `RUN_LABEL_RERUN` — the caller (`SimulationTab.tsx`) derives
 * `isResultCurrent` at render time from a signature comparison, never from
 * an effect, so this component never has to reconcile a stale result on
 * its own.
 */

/** Copywriting Contract, verbatim. */
export const RUN_LABEL_IDLE = "Run simulation";
/** Copywriting Contract's "relabels 'Re-run simulation' once a result exists" row, narrowed by PD-03 to "for the CURRENT selection". */
export const RUN_LABEL_RERUN = "Re-run simulation";
/** Copywriting Contract, verbatim. */
export const RUN_ERROR_BODY = "Simulation failed to run.";
export const RUN_RETRY_LABEL = "Retry";

/**
 * PD-04's recorded one-word deviation from the Copywriting Contract's
 * "Run control — complete" row, which reads "Simulated 1000 matches in
 * {elapsed}s". That is wrong under every reading: the run performs
 * `SIMULATION_DRAWS` DRAWS over however many qualification matches remain
 * (often 40, sometimes 135, never 1000), and the counter two lines above
 * this one in the same region already calls the same quantity "draws" —
 * shipping a completion line that contradicts the counter directly above
 * it, on a page whose premise is that its numbers are honest, is not a
 * defensible reading of the contract. `SIMULATION_DRAWS` (not a retyped
 * literal) is what the sentence and the counter both derive from, so they
 * can never drift apart from each other.
 */
export const RUN_COMPLETE_PREFIX = `Simulated ${SIMULATION_DRAWS} draws in`;

/**
 * PD-05: a run whose elapsed time rounds below one tenth of a second
 * renders a BOUND (`<0.1`) rather than a zero. `0.0` asserts the run took
 * no time, which is false; `<0.1` asserts only what one decimal place can
 * resolve, which is true. The threshold is on the raw millisecond value
 * (`ms < 100`), not on the rounded display string, so this never depends on
 * floating-point rounding at the boundary. The exact millisecond figure
 * survives unrounded in the completion element's `data-elapsed-ms`
 * attribute and in SC-2's SUMMARY line — only the DISPLAY is bounded.
 */
export function formatElapsedSeconds(ms: number): string {
  if (ms < 100) return "<0.1";
  return (ms / 1000).toFixed(1);
}

function formatCompletionSentence(elapsedMs: number): string {
  return `${RUN_COMPLETE_PREFIX} ${formatElapsedSeconds(elapsedMs)}s`;
}

/**
 * 8px, matching the app's existing `BAND_H = 8` "soft/thin bar" vocabulary
 * (`apps/web/src/components/team/matchAxis.ts`'s `MATCH_GEOMETRY.BAND_H`).
 * Declared here rather than imported (PD-15): a progress bar and a
 * prediction band are different visual elements that happen to share a
 * height today, and importing `BAND_H` would silently resize this bar the
 * next time the match plot's own geometry changes.
 */
export const PROGRESS_BAR_H_PX = 8;

export const RUN_CONTROL_TESTID = "run-control";

export interface RunControlProps {
  state: SimulationRunState;
  /** Whether `state`'s completed result (if any) still matches the CURRENT selection and artifact — a render-time comparison `SimulationTab.tsx` performs, never re-derived here (PD-02). */
  isResultCurrent: boolean;
  /** A start match is selected and the assembled inputs are non-empty. */
  canRun: boolean;
  onRun: () => void;
}

export function RunControl({ state, isResultCurrent, canRun, onRun }: RunControlProps) {
  if (state.status === "running") {
    const fraction = state.totalDraws > 0 ? state.completedDraws / state.totalDraws : 0;
    const counterText = `${state.completedDraws} / ${state.totalDraws} draws`;
    const timerText = `${formatElapsedSeconds(state.elapsedMs)}s elapsed`;
    return (
      <div data-testid={RUN_CONTROL_TESTID} className="flex flex-col gap-[var(--spacing-sm)]">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={state.totalDraws}
          aria-valuenow={state.completedDraws}
          aria-valuetext={counterText}
          className="w-full overflow-hidden rounded-full bg-[var(--color-border)]"
          style={{ height: `${PROGRESS_BAR_H_PX}px` }}
        >
          <div className="h-full bg-[var(--color-accent)]" style={{ width: `${fraction * 100}%` }} />
        </div>
        <p className="text-role-body text-muted-foreground">
          <span className="numeric-cell">{counterText}</span>
        </p>
        <p className="text-role-body text-muted-foreground">
          <span className="numeric-cell">{timerText}</span>
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div data-testid={RUN_CONTROL_TESTID} className="flex flex-col gap-[var(--spacing-sm)]" role="status">
        {/* PD-13: the thrown error's `name`/`message` never reach the DOM — this component has no prop that could carry them, and this line is the fixed Copywriting Contract string only. */}
        <p className="text-role-body text-destructive">{RUN_ERROR_BODY}</p>
        <Button type="button" variant="outline" onClick={onRun} className="tap-target w-fit border-destructive text-destructive">
          {RUN_RETRY_LABEL}
        </Button>
      </div>
    );
  }

  if (state.status === "complete" && isResultCurrent) {
    return (
      <div data-testid={RUN_CONTROL_TESTID} className="flex flex-col gap-[var(--spacing-sm)]" role="status">
        <p
          className="text-role-body text-[var(--color-text-primary)]"
          data-elapsed-ms={state.elapsedMs}
          data-compute-ms={state.computeMs}
          data-team-count={state.teamCount}
          data-remaining-matches={state.remainingMatches}
        >
          {formatCompletionSentence(state.elapsedMs)}
        </p>
        <Button type="button" variant="default" disabled={!canRun} onClick={onRun} className="tap-target w-fit">
          {RUN_LABEL_RERUN}
        </Button>
      </div>
    );
  }

  // Idle — covers `state.status === "idle"` and a SUPERSEDED
  // `state.status === "complete"` result (`isResultCurrent === false`, R5):
  // a result whose inputs have changed has no rendered form at all, per
  // PD-02/PD-03.
  const label = isResultCurrent ? RUN_LABEL_RERUN : RUN_LABEL_IDLE;
  return (
    <div data-testid={RUN_CONTROL_TESTID} className="flex flex-col gap-[var(--spacing-sm)]">
      <Button type="button" variant="default" disabled={!canRun} onClick={onRun} className="tap-target w-fit">
        {label}
      </Button>
    </div>
  );
}
