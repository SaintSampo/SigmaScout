import { useEffect, useRef, useState } from "react";
import { createDistrictSimulationWorker } from "../../workers/createDistrictSimulationWorker.js";
import {
  DEFAULT_SIMULATION_SEED,
  SIMULATION_DRAWS,
  type DistrictSimulationEventRequest,
  type DistrictSimulationOutboundMessage,
  type DistrictSimulationRequest,
  type DistrictSimulationResultMessage,
} from "../../workers/districtSimulationProtocol.js";

/**
 * The district ledger's run state machine and Worker lifecycle.
 *
 * Mirrors `apps/web/src/components/event/useSimulationRun.ts`'s one-Worker-
 * at-a-time lifecycle in three lines: a new run terminates any live Worker
 * before constructing one; every terminal message (`result` or `error`)
 * terminates the Worker that sent it, so the common path leaves nothing alive;
 * the unmount cleanup terminates whatever remains, as a BACKSTOP rather than
 * the primary mechanism. The monotonic run-id guard is kept with its own
 * framing intact — redundant with `terminate()` by specification, defence in
 * depth, and never a substitute for terminating.
 *
 * TWO DELIBERATE DIVERGENCES from the event-page hook, each recorded here:
 *
 * 1. THERE IS NO RUN BUTTON ON THIS TAB. The run starts from an effect keyed on
 *    a request SIGNATURE the caller computes, because the district page
 *    simulates whatever is currently live and whatever the slider currently
 *    asks for, with no visitor gesture in between.
 * 2. The error arm still carries NO PAYLOAD FIELD OF ANY KIND. A per-event
 *    failure is part of the RESULT, not the error state; the error state stays
 *    payload-free so a thrown error's `name`/`message` can never reach a
 *    screen.
 *
 * SC-5 LIVES HERE, NOT IN THE COMPONENT: when the request carries zero events
 * no `Worker` is constructed and no message is posted at all. Putting the guard
 * in the hook means a future second caller structurally cannot reintroduce the
 * empty run.
 */

export interface DistrictSimulationRunIdleState {
  readonly status: "idle";
}

export interface DistrictSimulationRunRunningState {
  readonly status: "running";
  readonly completedEvents: number;
  readonly totalEvents: number;
}

export interface DistrictSimulationRunCompleteState {
  readonly status: "complete";
  readonly events: DistrictSimulationResultMessage["events"];
  readonly draws: number;
  readonly signature: string;
}

export interface DistrictSimulationRunErrorState {
  readonly status: "error";
}

export type DistrictSimulationRunState =
  | DistrictSimulationRunIdleState
  | DistrictSimulationRunRunningState
  | DistrictSimulationRunCompleteState
  | DistrictSimulationRunErrorState;

/** One run's assembled events, forwarded UNRESHAPED, plus the signature the effect keys on. */
export interface DistrictSimulationRunRequest {
  readonly events: readonly DistrictSimulationEventRequest[];
  readonly signature: string;
}

const IDLE_STATE: DistrictSimulationRunState = { status: "idle" };
const ERROR_STATE: DistrictSimulationRunState = { status: "error" };

export function useDistrictSimulationRun(request: DistrictSimulationRunRequest): DistrictSimulationRunState {
  const [state, setState] = useState<DistrictSimulationRunState>(IDLE_STATE);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const { signature } = request;
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    const current = requestRef.current;

    // One Worker at a time: terminate and clear whatever is live before
    // constructing a new one.
    if (workerRef.current !== null) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const runId = ++runIdRef.current;

    // POST NOTHING WHEN THERE IS NOTHING TO SIMULATE (SC-5). No construction,
    // no message, no cost — however long the page stays open.
    if (current.events.length === 0) {
      setState(IDLE_STATE);
      return;
    }

    setState({ status: "running", completedEvents: 0, totalEvents: current.events.length });

    // The construction call happens HERE, inside the effect that needs it —
    // never at module scope and never on mount. An unsupported browser throws
    // synchronously from `new Worker(...)`.
    let worker: Worker;
    try {
      worker = createDistrictSimulationWorker();
    } catch {
      setState(ERROR_STATE);
      return;
    }
    workerRef.current = worker;

    const terminate = (): void => {
      if (workerRef.current !== null) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };

    worker.onmessage = (event: MessageEvent): void => {
      if (runIdRef.current !== runId) return;
      const message = event.data as DistrictSimulationOutboundMessage;
      if (message.type === "progress") {
        setState({ status: "running", completedEvents: message.completedEvents, totalEvents: message.totalEvents });
        return;
      }
      if (message.type === "result") {
        terminate();
        setState({ status: "complete", events: message.events, draws: message.draws, signature: current.signature });
        return;
      }
      // message.type === "error" — a MALFORMED REQUEST and nothing else.
      terminate();
      setState(ERROR_STATE);
    };

    // The mid-run path where the Worker SCRIPT itself throws, rather than a
    // throw the job function already caught and translated.
    worker.onerror = (): void => {
      if (runIdRef.current !== runId) return;
      terminate();
      setState(ERROR_STATE);
    };

    const outbound: DistrictSimulationRequest = {
      type: "run",
      events: current.events,
      draws: SIMULATION_DRAWS,
      seed: DEFAULT_SIMULATION_SEED,
    };
    worker.postMessage(outbound);

    return () => {
      runIdRef.current++;
      terminate();
    };
  }, [signature]);

  return state;
}
