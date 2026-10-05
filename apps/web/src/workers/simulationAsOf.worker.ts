/**
 * The Simulation tab's AS-OF Web Worker entry (quick task 261005-5g0): an SPR
 * rewind priced from the model as it stood just before the start match, then
 * simulated (`simulationAsOfJob.ts`).
 *
 * A SECOND ENTRY rather than a branch in `simulation.worker.ts`, so the default
 * simulation Worker chunk stays exactly what it was: the pricer loads only when
 * a visitor runs an SPR rewind. Everything else in `simulation.worker.ts`'s
 * header applies verbatim: three statements, a locally typed `self`, no
 * arithmetic here, cancellation by `terminate()`.
 */
import { runSimulationAsOfJob } from "./simulationAsOfJob.js";
import type { SimulationOutboundMessage } from "./simulationProtocol.js";

/** The tiny slice of `DedicatedWorkerGlobalScope` this file uses, typed locally (see `simulation.worker.ts`, fact 1). */
interface SimulationAsOfWorkerScope {
  postMessage(message: SimulationOutboundMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const scope = self as unknown as SimulationAsOfWorkerScope;

scope.onmessage = (event) => {
  runSimulationAsOfJob(event.data, (message) => {
    scope.postMessage(message);
  });
};
