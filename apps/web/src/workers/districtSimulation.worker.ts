/**
 * The district ledger's Web Worker entry module. Deliberately three
 * statements, exactly like `simulation.worker.ts`: obtain a locally-typed
 * `self` scope, assign `onmessage`, forward into the protocol module's job
 * function. No arithmetic, no event loop, no import of any core module.
 *
 * Three facts a later reader needs, none obvious from the code alone:
 *
 * 1. `"WebWorker"` is DELIBERATELY ABSENT from `apps/web/tsconfig.json`'s
 *    shared `lib` array. `lib` is a single project-wide TypeScript setting,
 *    and `DOM` (already present, needed by every React component) and
 *    `WebWorker` declare CONFLICTING global shapes for the same names
 *    (`self`, `postMessage`, ...), so adding both produces
 *    duplicate-identifier errors across the whole program. This file types
 *    its own tiny `self` surface locally instead, exactly as
 *    `simulation.worker.ts` does. Widening the shared `lib` to "fix" this
 *    file is the change that must not be made.
 *
 * 2. This file must stay free of arithmetic. jsdom implements no `Worker` API
 *    at all, so NOTHING in this file is reachable by this repo's test suite —
 *    every branch, every bound check and the whole event loop live in
 *    `districtSimulationProtocol.ts` instead, where plain Vitest calls them
 *    directly. A comment-stripped `grep` proves this file names no core
 *    entry point and forwards into the protocol exactly once.
 *
 * 3. Cancellation is `terminate()`, never a protocol message: the event loop
 *    inside the job function runs synchronously and does not return to this
 *    worker's own message queue until it has already finished, so a `cancel`
 *    message posted mid-run could never be read.
 */
import { runDistrictWorkerJob } from "./districtSimulationProtocol.js";
import type { DistrictWorkerOutboundMessage } from "./districtSimulationProtocol.js";

/** The tiny slice of `DedicatedWorkerGlobalScope` this file actually uses — deliberately not the ambient `WebWorker` lib type (see file header, fact 1). */
interface DistrictSimulationWorkerScope {
  postMessage(message: DistrictWorkerOutboundMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const scope = self as unknown as DistrictSimulationWorkerScope;

scope.onmessage = (event) => {
  runDistrictWorkerJob(event.data, (message) => {
    scope.postMessage(message);
  });
};
