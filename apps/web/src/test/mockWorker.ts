/**
 * A hand-rolled double for the DOM `Worker` API.
 *
 * Hand-rolled because jsdom (this repo's Vitest test environment,
 * `apps/web/vitest.config.ts` -> `environment: "jsdom"`) implements no
 * `Worker` API at all (08-RESEARCH.md Pitfall 1), and the official
 * `@vitest/web-worker` package is deliberately NOT used here: it has an
 * open, documented jsdom-collision bug (vitest-dev/vitest#7023) where its
 * `postMessage` scope collides with jsdom's own `window.postMessage` —
 * exactly this repo's test environment. A ~15-line hand-rolled class
 * sidesteps the bug entirely and needs no new dependency
 * (08-RESEARCH.md's Don't-Hand-Roll row 3).
 *
 * WHAT THIS PROVES: which messages arrive, in what order, and that every
 * message survives the same `structuredClone` boundary a real browser
 * enforces on `postMessage` (see `cloneMessage()` below).
 *
 * WHAT THIS DOES NOT PROVE: that the job actually runs off the main thread.
 * The installed `script` runs on the CALLER's own thread — delivery is only
 * deferred by a microtask (`queueMicrotask`), never by a real thread hop. A
 * green test against this double is evidence about the MESSAGE CONTRACT
 * only; it is never evidence that a visitor's page stays responsive during
 * a run. That property (SC-2's "without blocking the page") is 08-13's to
 * measure, on a real browser with a real Worker.
 */

/** `(message, ctx) => void` — the job a `MockWorkerInstance` runs on `postMessage`, forwarding outbound messages via `ctx.post(...)`. */
export type MockWorkerScript = (message: unknown, ctx: { post(message: unknown): void }) => void;

export interface MockWorkerOptions {
  /** The job the installed mock `Worker` class runs on every `postMessage`. Omit to install a `Worker` that records traffic but never responds. */
  script?: MockWorkerScript;
  /**
   * When set, every `new Worker(...)` call while installed throws this
   * error from the constructor, before any instance state exists — the
   * construction half of UI-SPEC's S2 error state (an unsupported browser
   * throws synchronously from `new Worker(...)`, which is exactly why
   * `createSimulationWorker.ts`'s doc comment tells 08-13 to wrap
   * construction in `try`/`catch`). Exists for 08-13's Error-state test and
   * 08-15's forced-failure evidence — not unused test scaffolding.
   */
  failOnConstruct?: Error;
}

export interface MockWorkerHandle {
  /** Every `MockWorkerInstance` successfully constructed while this handle's class was installed, in construction order. */
  readonly instances: MockWorkerInstance[];
  /** Reassigns `globalThis.Worker` back to whatever it was immediately before `installMockWorker()` ran — including reassigning `undefined` when there was no prior value, following this repo's `const originalFetch = global.fetch` / `global.fetch = originalFetch` convention (`AlgorithmSelect.test.tsx`). */
  restore(): void;
}

/**
 * Routes every message through the same clone boundary a real browser's
 * `postMessage` enforces (`structuredClone`), so a payload that could not
 * actually cross a Worker boundary in a browser — most notably a function,
 * which is exactly the shape a request carrying an `rng` instead of a
 * numeric `seed` would have (`simulationProtocol.ts`'s PD-03) — fails HERE,
 * in the test suite, instead of only in a visitor's browser with a
 * `DataCloneError` nothing at compile time would have caught.
 *
 * Falls back to pass-through ONLY if `structuredClone` is unavailable in
 * the running environment. That fallback is a documented limitation, not a
 * silent one: a pass-through here would quietly hide exactly the class of
 * bug this double exists to catch. Callers that need to know which branch
 * ran can check `typeof structuredClone` themselves (Task 1 Test 5 does).
 */
function cloneMessage(message: unknown): unknown {
  if (typeof structuredClone === "function") {
    return structuredClone(message);
  }
  return message; // fallback: structuredClone unavailable in this environment — pass-through, not a re-implementation of cloning semantics.
}

/**
 * The mock `Worker` instance. Mirrors the real `Worker` API's shape closely
 * enough that code written against `globalThis.Worker` cannot tell the
 * difference at the type level: `postMessage`, `onmessage`, `onerror`,
 * `terminate()`. `received`/`posted` exist for tests to assert on traffic
 * this double did not deliver anywhere externally observable (e.g. proving
 * ordering or clone fidelity without relying on timing races).
 */
export class MockWorkerInstance {
  readonly url: string | URL;
  readonly options: WorkerOptions | undefined;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; error?: unknown }) => void) | null = null;
  /** Every message this instance received via `postMessage`, post-clone, in arrival order. */
  readonly received: unknown[] = [];
  /** Every message this instance's script posted back via `ctx.post`, post-clone, in delivery order. */
  readonly posted: unknown[] = [];

  #terminated = false;
  #script: MockWorkerScript | undefined;

  constructor(url: string | URL, options: WorkerOptions | undefined, script: MockWorkerScript | undefined) {
    this.url = url;
    this.options = options;
    this.#script = script;
  }

  /**
   * Delivery is asynchronous in both directions: a real Worker never
   * delivers synchronously, and a double that did would let a consumer's
   * test pass on an ordering a real browser would not reproduce. The
   * inbound message is cloned and recorded immediately (matching a real
   * `postMessage` call's own synchronous clone-and-enqueue semantics), but
   * the installed `script` does not run until a later microtask.
   *
   * A throw from `script` is caught and dispatched to `onerror` — the
   * mid-run half of UI-SPEC's S2 error state, and the shape 08-15's
   * forced-failure evidence is built on. This double does not "catch and
   * continue" the way `runSimulationJob`'s own `try`/`catch` translates a
   * thrown error into one `error` message and stops: this is a SEPARATE
   * boundary, modeling what happens if the worker SCRIPT ITSELF throws
   * (e.g. a bug in the entry file, not a throw `runSimulationJob` already
   * caught and translated).
   */
  postMessage(message: unknown): void {
    if (this.#terminated) return;
    const cloned = cloneMessage(message);
    this.received.push(cloned);
    const script = this.#script;
    if (!script) return;
    queueMicrotask(() => {
      if (this.#terminated) return;
      try {
        script(cloned, {
          post: (outbound: unknown) => {
            if (this.#terminated) return;
            const clonedOutbound = cloneMessage(outbound);
            this.posted.push(clonedOutbound);
            this.onmessage?.({ data: clonedOutbound });
          },
        });
      } catch (error) {
        if (this.#terminated) return;
        this.onerror?.({
          message: error instanceof Error ? error.message : String(error),
          error,
        });
      }
    });
  }

  /**
   * The ONLY cancellation mechanism this protocol offers
   * (`simulationProtocol.ts`'s PD-06: a `cancel` message could never be
   * read mid-run, since the real draw loop is synchronous and does not
   * return to its own message queue until it has already finished).
   * Delivers nothing further in either direction after this call, modeling
   * a real terminated Worker's semantics.
   */
  terminate(): void {
    this.#terminated = true;
  }
}

/**
 * Installs a mock `Worker` class on `globalThis.Worker` for the duration of
 * a test. Every `new Worker(...)` call while installed constructs a
 * `MockWorkerInstance` running `options.script`; every such instance is
 * recorded on the returned handle's `instances` array.
 */
export function installMockWorker(options: MockWorkerOptions = {}): MockWorkerHandle {
  const globalRef = globalThis as { Worker?: unknown };
  const previousWorker = globalRef.Worker;
  const instances: MockWorkerInstance[] = [];

  class InstalledMockWorker extends MockWorkerInstance {
    constructor(url: string | URL, workerOptions?: WorkerOptions) {
      if (options.failOnConstruct) {
        // Legal to throw before `super()` as long as `this` is never
        // referenced beforehand: no instance exists yet, matching a real
        // unsupported browser's `new Worker(...)` throw.
        throw options.failOnConstruct;
      }
      super(url, workerOptions, options.script);
      instances.push(this);
    }
  }

  globalRef.Worker = InstalledMockWorker;

  return {
    instances,
    restore(): void {
      globalRef.Worker = previousWorker;
    },
  };
}
