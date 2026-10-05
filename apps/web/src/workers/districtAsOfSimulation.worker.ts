/**
 * The REWOUND Locks stops' Web Worker entry (quick task 261005-5g0): the
 * district Worker's own entry plus the as-of event runner, which prices or bakes
 * every event from the model as it stood at the stop.
 *
 * A SECOND ENTRY rather than a second branch in `districtSimulation.worker.ts`,
 * so the Live Worker chunk stays exactly what it was: the pricer, the bake and
 * the schedule generator load only when a visitor rewinds. Everything else in
 * `districtSimulation.worker.ts`'s header applies verbatim: three statements, a
 * locally typed `self`, no arithmetic here, cancellation by `terminate()`.
 */
import { runDistrictWorkerJob } from "./districtSimulationProtocol.js";
import type { DistrictWorkerOutboundMessage } from "./districtSimulationProtocol.js";
import { runAsOfEvent } from "./districtAsOfJob.js";

/** The tiny slice of `DedicatedWorkerGlobalScope` this file uses, typed locally (see `districtSimulation.worker.ts`, fact 1). */
interface DistrictAsOfWorkerScope {
  postMessage(message: DistrictWorkerOutboundMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const scope = self as unknown as DistrictAsOfWorkerScope;

scope.onmessage = (event) => {
  runDistrictWorkerJob(
    event.data,
    (message) => {
      scope.postMessage(message);
    },
    runAsOfEvent
  );
};
