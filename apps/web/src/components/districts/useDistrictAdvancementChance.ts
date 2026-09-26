import { useEffect, useRef, useState } from "react";
import { createDistrictSimulationWorker } from "../../workers/createDistrictSimulationWorker.js";
import {
  DEFAULT_SIMULATION_SEED,
  SIMULATION_DRAWS,
  type DistrictAdvancementChanceRequest,
  type DistrictWorkerOutboundMessage,
} from "../../workers/districtSimulationProtocol.js";
import type { DistrictAdvancementChanceRun } from "./districtLedgerChances.js";

/**
 * The advancement chance's Worker lifecycle.
 *
 * A SECOND WORKER, not a second message to the first one. The per-event run's
 * Worker is terminated the moment its result arrives — that is
 * `useDistrictSimulationRun`'s own one-at-a-time contract, and it is the right
 * contract — and the chance's inputs do not exist until that result has been
 * convolved into grand totals on the main thread. Keeping the first Worker
 * alive to wait for them would hold an idle thread open for the whole time the
 * tab is on screen, which costs more than constructing a second one for the
 * few milliseconds this job takes.
 *
 * Everything else is the run hook's lifecycle verbatim, for the same reasons:
 * construct lazily INSIDE the effect (so a component test that never reaches a
 * chance never needs a `Worker` mock), wrap the construction in `try`/`catch`
 * (an unsupported browser throws synchronously from the constructor), terminate
 * on every terminal message, terminate again on unmount as a BACKSTOP, and keep
 * the monotonic run-id guard as defence in depth rather than as a substitute
 * for terminating.
 *
 * POST NOTHING WHEN THERE IS NOTHING TO RANK. An absent `run` constructs no
 * Worker and posts no message, so a finished district — where
 * `buildAdvancementChanceRun` refuses — keeps SC-5's promise exactly as it was
 * made: that tab, at that position, starts no thread at all.
 *
 * THE ERROR ARM CARRIES NO PAYLOAD. A chance that could not be computed prints
 * nothing, which is the same thing a pending one prints, so there is nothing a
 * `name` or a `message` could usefully say to a visitor and every reason not to
 * let one reach a screen.
 */

export interface DistrictAdvancementChanceIdleState {
  readonly status: "idle";
}

export interface DistrictAdvancementChanceRunningState {
  readonly status: "running";
}

export interface DistrictAdvancementChanceCompleteState {
  readonly status: "complete";
  /** The RAW run set, straight off the core: every points-competing team, before the verdicts narrow it. */
  readonly chanceByTeam: ReadonlyMap<string, number>;
  readonly draws: number;
  readonly lockSlots: number;
  readonly signature: string;
}

export interface DistrictAdvancementChanceErrorState {
  readonly status: "error";
}

export type DistrictAdvancementChanceState =
  | DistrictAdvancementChanceIdleState
  | DistrictAdvancementChanceRunningState
  | DistrictAdvancementChanceCompleteState
  | DistrictAdvancementChanceErrorState;

const IDLE_STATE: DistrictAdvancementChanceState = { status: "idle" };
const RUNNING_STATE: DistrictAdvancementChanceState = { status: "running" };
const ERROR_STATE: DistrictAdvancementChanceState = { status: "error" };

export function useDistrictAdvancementChance(run: DistrictAdvancementChanceRun | undefined): DistrictAdvancementChanceState {
  const [state, setState] = useState<DistrictAdvancementChanceState>(IDLE_STATE);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const signature = run?.signature;
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const current = runRef.current;

    if (workerRef.current !== null) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const runId = ++runIdRef.current;

    if (current === undefined) {
      setState(IDLE_STATE);
      return;
    }

    setState(RUNNING_STATE);

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
      const message = event.data as DistrictWorkerOutboundMessage;
      if (message.type === "chance-result") {
        terminate();
        setState({
          status: "complete",
          chanceByTeam: message.chanceByTeam,
          draws: message.draws,
          lockSlots: message.lockSlots,
          signature: current.signature,
        });
        return;
      }
      if (message.type === "error") {
        terminate();
        setState(ERROR_STATE);
      }
      // Anything else cannot arrive on this Worker: it was handed a `chance`
      // request, and the dispatcher answers one with a `chance-result` or an
      // `error` and nothing in between. Ignored rather than treated as a
      // failure, so a future message type cannot silently blank the line.
    };

    worker.onerror = (): void => {
      if (runIdRef.current !== runId) return;
      terminate();
      setState(ERROR_STATE);
    };

    const outbound: DistrictAdvancementChanceRequest = {
      type: "chance",
      inputs: current.inputs,
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
