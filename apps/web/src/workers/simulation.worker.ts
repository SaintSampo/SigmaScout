/**
 * The app's first Web Worker entry module. Deliberately three statements:
 * obtain a locally-typed `self` scope, assign `onmessage`, forward into
 * `runSimulationJob`. No arithmetic, no draw loop, no import of
 * `simulateRanks` — all of that lives in `simulationProtocol.ts` (PD-02).
 *
 * Three facts a later reader needs, none obvious from the code alone:
 *
 * 1. `"WebWorker"` is DELIBERATELY ABSENT from `apps/web/tsconfig.json`'s
 *    shared `lib` array (RESEARCH.md Pitfall 2). `lib` is a single
 *    project-wide TypeScript setting, and `DOM` (already present, needed by
 *    every React component) and `WebWorker` declare CONFLICTING global
 *    shapes for the same names (`self`, `postMessage`, ...) — adding both
 *    produces duplicate-identifier errors across the whole program. This
 *    file instead types its own tiny `self` surface locally
 *    (`SimulationWorkerScope` below), which is the documented option (a)
 *    default. If that local typing ever genuinely fails to compile, the
 *    documented fallback is a SEPARATE worker-scoped `tsconfig.worker.json`
 *    under TypeScript project references, kept OUT of this repo's existing
 *    `tsc --noEmit -p tsconfig.json` command — a decision to record, not to
 *    make silently.
 *
 * 2. This file must stay free of arithmetic. jsdom (this repo's Vitest test
 *    environment) implements no `Worker` API at all, so NOTHING in this
 *    file is reachable by this repo's test suite (PD-02) — every branch,
 *    every bound check and the whole progress loop live in
 *    `simulationProtocol.ts` instead, where plain Vitest can call them
 *    directly. `grep` proves this file imports no `simulateRanks` and
 *    calls `runSimulationJob` exactly once.
 *
 * 3. Cancellation is `terminate()`, never a protocol message (PD-06): the
 *    draw loop inside `runSimulationJob` runs synchronously and does not
 *    return to this worker's own message queue until it has already
 *    finished, so a `cancel` message posted mid-run could never be read.
 *    `createSimulationWorker.ts` documents the `terminate()`-on-unmount
 *    contract 08-13's Run handler must obey.
 */
import { runSimulationJob } from "./simulationProtocol.js";
import type { SimulationOutboundMessage } from "./simulationProtocol.js";

/** The tiny slice of `DedicatedWorkerGlobalScope` this file actually uses — deliberately not the ambient `WebWorker` lib type (see file header, fact 1). */
interface SimulationWorkerScope {
  postMessage(message: SimulationOutboundMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const scope = self as unknown as SimulationWorkerScope;

scope.onmessage = (event) => {
  runSimulationJob(event.data, (message) => {
    scope.postMessage(message);
  });
};
