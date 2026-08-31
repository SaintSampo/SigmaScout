import { useCallback, useEffect, useRef, useState } from "react";
import { createSimulationWorker } from "../../workers/createSimulationWorker.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../../workers/simulationProtocol.js";
import type { SimulationOutboundMessage, SimulationRequest } from "../../workers/simulationProtocol.js";
import type { SimMatchInput, SimResult, SimTeamBaseline } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";

/**
 * The run state machine and Worker lifecycle for D-07's run control
 * (08-13-PLAN.md Task 1): live progress during a run, and the total elapsed
 * time the visitor actually waited through on completion. `RunControl.tsx`
 * (Task 2) is a pure function of the `state` this hook returns — every
 * stateful concern (construction, termination, timing, the run-id guard)
 * lives here so that component stays testable with no `Worker` present at
 * all.
 *
 * One-Worker-at-a-time lifecycle, in three lines: `start()` terminates any
 * live Worker before constructing a new one; every terminal message
 * (`result` or `error`) terminates the Worker that sent it, so the common
 * path leaves nothing alive; the unmount cleanup terminates whatever
 * remains, as a backstop rather than the primary mechanism (PD-09).
 */

/** The elapsed timer's tick cadence — one order finer than the one-decimal display (`RunControl.tsx`'s `formatElapsedSeconds`). */
export const SIMULATION_TICK_INTERVAL_MS = 100;

export type SimulationRunStatus = "idle" | "running" | "complete" | "error";

export interface SimulationRunIdleState {
  readonly status: "idle";
}

export interface SimulationRunRunningState {
  readonly status: "running";
  readonly completedDraws: number;
  readonly totalDraws: number;
  readonly elapsedMs: number;
}

export interface SimulationRunCompleteState {
  readonly status: "complete";
  readonly result: SimResult;
  /**
   * The user-facing figure (PD-07, 08-07's PD-05): measured on the MAIN
   * thread, from the instant `start()` runs to the instant the `result`
   * message arrives. This spans Worker construction, the structured-clone
   * transfer of the request, the draw loop, and the transfer back — the
   * interval the visitor actually waited through. `computeMs` below is the
   * draw loop alone and must never become a second user-facing number.
   */
  readonly elapsedMs: number;
  readonly computeMs: number;
  readonly signature: string;
  readonly teamCount: number;
  readonly remainingMatches: number;
}

export interface SimulationRunErrorState {
  /**
   * No payload field of any kind (PD-13): a thrown error's `name`/`message`
   * are logged nowhere and rendered nowhere. Giving this state a field for
   * them is how they would eventually reach a screen.
   */
  readonly status: "error";
}

export type SimulationRunState =
  | SimulationRunIdleState
  | SimulationRunRunningState
  | SimulationRunCompleteState
  | SimulationRunErrorState;

/** One run's assembled inputs, forwarded unreshaped (08-11's decision and 08-07's guard — a second opinion here would be a second place for the two to drift), plus the signature `SimulationTab.tsx` derives (PD-02). */
export interface SimulationRunRequest {
  readonly matches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  readonly signature: string;
}

const IDLE_STATE: SimulationRunState = { status: "idle" };
const ERROR_STATE: SimulationRunState = { status: "error" };

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function useSimulationRun(): {
  state: SimulationRunState;
  start: (request: SimulationRunRequest) => void;
  reset: () => void;
} {
  const [state, setState] = useState<SimulationRunState>(IDLE_STATE);

  const workerRef = useRef<Worker | null>(null);
  /**
   * A monotonically increasing run id, captured by every handler at
   * construction time and compared against the current value before acting
   * (PD-10). Redundant with `terminate()` by specification — a real Worker
   * must deliver nothing after `terminate()` — and kept as defence in depth
   * because a message already dispatched into the task queue when
   * `terminate()` runs is not something this component can prove is
   * impossible in every real engine. This guard must never become a
   * substitute for terminating: `terminateWorker` below is called on every
   * exit path regardless of what this counter reads.
   */
  const runIdRef = useRef(0);
  const startTimestampRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = useCallback((): void => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const terminateWorker = useCallback((): void => {
    if (workerRef.current !== null) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (request: SimulationRunRequest): void => {
      // One Worker at a time (PD-09): terminate and clear whatever is live
      // before constructing a new one.
      terminateWorker();
      stopTicking();

      const runId = ++runIdRef.current;
      startTimestampRef.current = nowMs();
      setState({ status: "running", completedDraws: 0, totalDraws: SIMULATION_DRAWS, elapsedMs: 0 });

      intervalRef.current = setInterval(() => {
        if (runIdRef.current !== runId) return;
        setState((previous) =>
          previous.status === "running" ? { ...previous, elapsedMs: nowMs() - startTimestampRef.current } : previous
        );
      }, SIMULATION_TICK_INTERVAL_MS);

      // The construction call happens HERE, inside the handler — never at
      // module scope, never in an effect, never on mount. An unsupported
      // browser throws synchronously from `new Worker(...)`; this is the
      // construction half of UI-SPEC's S2 error state.
      let worker: Worker;
      try {
        worker = createSimulationWorker();
      } catch {
        stopTicking();
        setState(ERROR_STATE);
        return;
      }
      workerRef.current = worker;

      const enterErrorState = (): void => {
        if (runIdRef.current !== runId) return;
        stopTicking();
        terminateWorker();
        setState(ERROR_STATE);
      };

      worker.onmessage = (event: MessageEvent): void => {
        if (runIdRef.current !== runId) return;
        const message = event.data as SimulationOutboundMessage;
        if (message.type === "progress") {
          setState({
            status: "running",
            completedDraws: message.completedDraws,
            totalDraws: message.totalDraws,
            elapsedMs: nowMs() - startTimestampRef.current,
          });
          return;
        }
        if (message.type === "result") {
          const elapsedMs = nowMs() - startTimestampRef.current;
          stopTicking();
          terminateWorker();
          setState({
            status: "complete",
            result: { rankHistograms: message.rankHistograms, draws: message.draws },
            elapsedMs,
            computeMs: message.computeMs,
            signature: request.signature,
            teamCount: request.baselines.length,
            remainingMatches: request.matches.length,
          });
          return;
        }
        // message.type === "error"
        enterErrorState();
      };

      // The mid-run half of UI-SPEC's S2 error state: the Worker SCRIPT
      // itself throwing (not a throw `runSimulationJob` already caught and
      // translated into an `error` message above).
      worker.onerror = (): void => enterErrorState();

      const outboundRequest: SimulationRequest = {
        type: "run",
        matches: request.matches,
        baselines: request.baselines,
        draws: SIMULATION_DRAWS,
        seed: DEFAULT_SIMULATION_SEED,
      };
      worker.postMessage(outboundRequest);
    },
    [stopTicking, terminateWorker]
  );

  /**
   * Exists for the unmount path and for a caller abandoning a run in
   * progress. PD-02's render-time signature comparison means the normal
   * selection-change path never needs this — do not wire it to a
   * `useEffect` on the selection, which would reintroduce the
   * after-the-frame correction PD-02 deliberately rejects.
   */
  const reset = useCallback((): void => {
    runIdRef.current++;
    stopTicking();
    terminateWorker();
    setState(IDLE_STATE);
  }, [stopTicking, terminateWorker]);

  // Backstop, not the primary mechanism (PD-09 already terminates on every
  // terminal message): terminates whatever is still live on unmount.
  useEffect(() => {
    return () => {
      runIdRef.current++;
      stopTicking();
      terminateWorker();
    };
  }, [stopTicking, terminateWorker]);

  return { state, start, reset };
}
