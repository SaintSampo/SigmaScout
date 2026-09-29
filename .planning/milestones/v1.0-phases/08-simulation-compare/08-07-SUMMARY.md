---
phase: 08-simulation-compare
plan: 07
subsystem: frontend
tags: [web-worker, vite, simulation, message-contract, jsdom-mock]

requires:
  - phase: 08-simulation-compare
    plan: 03
    provides: "packages/core/algorithms/simulation/rankSimulation.ts — simulateRanks, mulberry32, SimMatchInput/SimTeamBaseline/SimResult, InvalidPmfError/UnknownTeamKeyError (consumed unchanged, never re-decided)"
provides:
  - "apps/web/src/workers/simulationProtocol.ts — the message contract (SimulationRequest/Progress/Result/Error), five bounds/config constants, isSimulationRequest, runSimulationJob"
  - "apps/web/src/workers/simulation.worker.ts — the app's first Web Worker entry module"
  - "apps/web/src/workers/createSimulationWorker.ts — the single definition site of the worker URL and { type: \"module\" }, carrying the lifecycle contract 08-13 must obey"
  - "apps/web/src/test/mockWorker.ts — installMockWorker()/MockWorkerInstance, with failOnConstruct and throwing-script failure modes"
affects: [08-11 (simulationInputs.ts assembles SimMatchInput/SimTeamBaseline this protocol forwards unchanged), 08-13 (Run handler constructs via createSimulationWorker() and consumes this message contract), 08-14 (renders rankHistograms), 08-15 (S2 forced-failure evidence built on mockWorker.ts's two failure modes)]

actuals:
  tokens: 11500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Web Worker plumbing split into a plain, directly-testable module (simulationProtocol.ts) and a near-empty three-statement entry file (simulation.worker.ts), because jsdom implements no Worker API and the entry file is otherwise untestable by construction (RESEARCH Pitfall 1/PD-02)"
    - "Worker surface typed with small local interfaces instead of adding \"WebWorker\" to the shared tsconfig lib array, avoiding the DOM/WebWorker global-shape conflict (RESEARCH Pitfall 2)"
    - "Hand-rolled mock Worker (installMockWorker/MockWorkerInstance) installed per-test via save/restore, never global — following this repo's existing global.fetch mocking convention"
    - "new URL(...) kept INLINE inside new Worker(...) — the exact shape Vite's own docs require for worker detection"

key-files:
  created:
    - apps/web/src/workers/simulationProtocol.ts
    - apps/web/src/workers/simulation.worker.ts
    - apps/web/src/workers/createSimulationWorker.ts
    - apps/web/src/workers/simulationProtocol.test.ts
    - apps/web/src/test/mockWorker.ts
    - apps/web/src/test/mockWorker.test.ts
  modified: []

key-decisions:
  - "P7/P8/P9 (Task 3) passed on their first run rather than RED'ing, because Task 1's isSimulationRequest and runSimulationJob's try/catch translation were already written to Task 3's own exact spec up front — the plan's own action text explicitly permits this (\"extend ... only if the bounds are not already enforced as Task 1 specified\"). Investigated per the TDD fail-fast rule; confirmed non-vacuous (each sub-case traces through real rejection logic that would fail if the guard were removed)."
  - "Test 5's Int32Array clone assertion rewritten from toBeInstanceOf(Int32Array) to Object.prototype.toString.call(x) === \"[object Int32Array]\" — under this repo's jsdom test environment, the global structuredClone function reconstructs typed arrays using its OWN defining realm's Int32Array, which is a different object identity from the jsdom-realm Int32Array the test module sees, so instanceof fails across that boundary even though the clone is byte-for-byte correct."
  - "Test 6's URL assertion changed from an exact-suffix match to .toContain(\"simulation.worker.ts\") after observing Vite's own transform appends a `?worker_file&type=module` query suffix to the resolved URL even under this test's Vite/vite-node pipeline — genuine evidence Vite recognizes the worker-detection shape, not a defect to work around silently."

patterns-established:
  - "Worker message-contract plumbing lives in a plain, Vitest-callable module; the worker entry file itself stays untestable-by-design and is proven correct by grep gates (zero simulateRanks imports, exactly one runSimulationJob call) plus a build probe rather than by unit tests"

requirements-completed: []

coverage:
  - id: EVNT-07-transport
    description: "The Worker transport (message contract, chunked progress, error translation) that carries a 1000-draw rank-distribution simulation from 08-03's core to the page, with ordered progress messages ending at exactly 1000/1000"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/workers/simulationProtocol.test.ts — Tests 1-9 (14 cases total with mockWorker.test.ts's M1-M5)"
        status: pass
    human_judgment: false
  - id: D-07-worker-transport
    description: "1000 draws run in a browser Web Worker with live progress and total elapsed time on completion — the Vite bundling seam and message contract half"
    verification:
      - kind: unit
        ref: "simulationProtocol.test.ts Tests 1-2, 6 (progress contract + createSimulationWorker() round trip)"
        status: pass
      - kind: manual
        ref: "Build probe: dist/assets/simulation.worker-CbGWrOhu.js emitted with a temporary main.tsx call site, absent without one (quoted below)"
        status: pass
    human_judgment: false
duration: ~50min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 7: Simulation Web Worker (message contract, Vite seam, mock) Summary

**The app's first Web Worker: a plain, directly-testable message contract (`simulationProtocol.ts`) that chunks 08-03's `simulateRanks` into 20 ordered progress messages plus one result over the same rng stream a single call would use, a three-statement worker entry file typed without touching the shared TypeScript `lib` array, a single-definition-site Vite bundling factory, and a hand-rolled mock `Worker` — with the two failure modes 08-13 and 08-15 depend on — proven, not assumed, by a real round trip through a real mock `Worker` boundary and the real 08-03 core.**

## Baseline (recorded before Task 1)

```
npx vitest run --project=web
Test Files  55 passed (55)
     Tests  844 passed (844)
```

```
pnpm --filter web typecheck
$ tsc --noEmit -p tsconfig.json
EXIT: 0
```

```
ls apps/web/src
components  lib  main.tsx  routeTree.gen.ts  routes  stores  styles  test
```
No `workers` directory — the expected pre-state.

`packages/harness/payloadBudget.test.ts`'s two accepted RED assertions (WINDOWS.md ledger #11/#15) are in the `node` project, not `web`, and out of scope here — not touched by this plan.

## Observed RED (quoted, not claimed)

**Task 1, Test 1 — before `simulationProtocol.ts` existed:**

```
FAIL  |web| src/workers/simulationProtocol.test.ts [ apps/web/src/workers/simulationProtocol.test.ts ]
Error: Failed to resolve import "./simulationProtocol.js" from "apps/web/src/workers/simulationProtocol.test.ts". Does the file exist?
```

**Task 3, M4 — before `failOnConstruct` existed:**

```
FAIL  |web| src/test/mockWorker.test.ts > mockWorker — the double's own contract > M4: failOnConstruct throws from the constructor
AssertionError: expected function to throw an error, but it didn't
```

**Task 3, M5 — before the throwing-script catch existed (surfaced as an uncaught exception, not a normal assertion failure — exactly the "unhandled" shape a missing try/catch produces):**

```
FAIL  |web| src/test/mockWorker.test.ts > mockWorker — the double's own contract > M5: a throwing script surfaces on onerror
AssertionError: expected +0 to be 1
⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯
Error: simulated mid-run failure
    at apps/web/src/test/mockWorker.test.ts:74:20
```

**Task 3, P7/P8/P9 did NOT RED** — see "Deviations" below.

## Printed test counts per task

| After task | `simulationProtocol.test.ts` | `mockWorker.test.ts` | Skipped |
|---|---|---|---|
| Task 1 | 5 passed | (not yet created) | 0 |
| Task 2 | 6 passed | (not yet created) | 0 |
| Task 3 | 9 passed | 5 passed | 0 |

Progression: **5 → 6 → 9** for `simulationProtocol.test.ts`, plus **5** for `mockWorker.test.ts` — exactly as the plan's `<output>` instruction specifies. All counts read from printed Vitest output, never from an exit code, never wrapped in `timeout`.

## Test 4 — chunking equivalence (PD-01, load-bearing)

**Result: PASSED.** The chunked round trip's histograms (20 calls of `PROGRESS_CHUNK_DRAWS` draws sharing one `mulberry32` instance) were compared **entry-for-entry** — `Array.from(chunkedHistogram)` vs. `Array.from(directHistogram)` per team, not a summary statistic — against one direct `simulateRanks(matches, baselines, SIMULATION_DRAWS, mulberry32(DEFAULT_SIMULATION_SEED))` call over the same fixture and seed. No reseeding workaround was needed; the equivalence held on the first run.

## Test 5 — `structuredClone` under this jsdom environment

`typeof structuredClone` printed **`"function"`** — `cloneMessage()` takes the real-clone branch, not the pass-through fallback.

**One genuine finding surfaced here (documented as a key-decision above, not silently patched):** the assertion `expect(clonedHistogram).toBeInstanceOf(Int32Array)` failed even though the cloned values were byte-for-byte correct. Under this repo's jsdom test environment, Vitest runs the test module in a jsdom-created realm whose `Int32Array` constructor is a different object identity from the one the global `structuredClone` function reconstructs typed arrays with (that function's own defining realm) — `instanceof` fails across that boundary. Rewritten to `Object.prototype.toString.call(clonedHistogram) === "[object Int32Array]"`, which reads the internal class tag and survives the cross-realm boundary. Confirmed in isolation with a plain Node script (`structuredClone` of a `Map<string, Int32Array>` round-trips correctly outside jsdom) before concluding this was environment-specific, not a real clone defect.

## Build probe — quoted BOTH ways (PD-09)

**Before the probe (pre-existing `dist/`):**
```
ls apps/web/dist/assets | grep -i "simulation.worker"
NO simulation.worker asset present (expected pre-probe state)
```

**With a temporary, never-called `import { createSimulationWorker } from "./workers/createSimulationWorker.js"; console.log(typeof createSimulationWorker);` added to `main.tsx`, then `pnpm --filter web build`:**
```
dist/assets/simulation.worker-CbGWrOhu.js                    2.88 kB
```
Confirmed the `InvalidSimulationRequest` literal (survives minification) appears in that asset:
```
grep -l "InvalidSimulationRequest" apps/web/dist/assets/*.js
apps/web/dist/assets/simulation.worker-CbGWrOhu.js
```

**After reverting `main.tsx` completely and rebuilding:**
```
ls apps/web/dist/assets | grep -i simulation.worker
NO simulation.worker asset present after revert (expected)
```
`git status --porcelain apps/web/src/main.tsx` printed nothing — confirmed clean at task end.

## RESEARCH Pitfall 2 — held on the first attempt

`pnpm --filter web typecheck` exited **0** with `simulation.worker.ts` and `createSimulationWorker.ts` inside the same TypeScript program as every React component, on the very first run after writing both files. No compiler error, so option (a) (local interface typing, no `"WebWorker"` lib addition) was never revisited — the documented `tsconfig.worker.json`/project-references fallback was not needed. `apps/web/tsconfig.json` is byte-unchanged (`grep -c "WebWorker" apps/web/tsconfig.json` returns 0).

## Exported protocol surface, as built

```typescript
// apps/web/src/workers/simulationProtocol.ts
export const SIMULATION_DRAWS = 1000;
export const PROGRESS_CHUNK_DRAWS = 50;
export const MAX_SIMULATION_DRAWS = 10000;
export const MAX_SIMULATION_MATCHES = 500;
export const DEFAULT_SIMULATION_SEED = 20260830;
export const INVALID_REQUEST_ERROR_NAME = "InvalidSimulationRequest";

export interface SimulationRequest {
  readonly type: "run";
  readonly matches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  readonly draws: number;
  readonly seed: number;
}
export interface SimulationProgressMessage {
  readonly type: "progress";
  readonly completedDraws: number;
  readonly totalDraws: number;
}
export interface SimulationResultMessage {
  readonly type: "result";
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
  readonly draws: number;
  readonly computeMs: number; // draw-loop-only duration, NOT the user-facing figure (PD-05) — 08-13 owns that measurement
}
export interface SimulationErrorMessage {
  readonly type: "error";
  readonly name: string;
  readonly message: string;
}
export type SimulationOutboundMessage = SimulationProgressMessage | SimulationResultMessage | SimulationErrorMessage;

export function isSimulationRequest(value: unknown): value is SimulationRequest;
export function runSimulationJob(message: unknown, emit: (outbound: SimulationOutboundMessage) => void): void;

// apps/web/src/workers/createSimulationWorker.ts
export function createSimulationWorker(): Worker;
```

08-11, 08-13 and 08-14 all consume this surface as built here.

## Landed names of 08-03's two thrown error types

Confirmed against the landed `packages/core/algorithms/simulation/rankSimulation.ts`: **`UnknownTeamKeyError`** and **`InvalidPmfError`** — identical to the names this plan's `<context>` block already stated. No divergence to record. Test 3's P8 case asserts `only.name === "UnknownTeamKeyError"` against the real landed export, not a hardcoded guess disconnected from the source.

## Lifecycle rules restated for 08-13's executor

`createSimulationWorker()`'s doc comment (and this restatement, per the plan's explicit instruction) binds 08-13 to:

1. **Construct lazily**, inside the "Run simulation" click handler — never at module scope, never on mount (RESEARCH Pitfall 1: a component test that never clicks Run must never need a `Worker` mock).
2. **Call `.terminate()`** in a `useEffect` cleanup on unmount — the only cancellation mechanism this protocol offers (PD-06); there is no `cancel` message.
3. **Wrap construction in `try`/`catch`** — an unsupported browser throws synchronously from `new Worker(...)`, not by posting an `error` message. This is the construction half of UI-SPEC's S2 error state, and `mockWorker.ts`'s `failOnConstruct` mode exists specifically to make it testable.

## Nothing published, no dependency, no credential

- **No npm dependency was added.** `git diff --stat package.json pnpm-lock.yaml` empty across all three task commits. `@vitest/web-worker` was deliberately NOT installed (vitest-dev/vitest#7023); it appears in `mockWorker.ts` only as a comment naming why it is absent.
- **No config file was edited.** `git diff apps/web/tsconfig.json apps/web/vite.config.ts apps/web/vitest.config.ts apps/web/src/test/setup.ts` empty across the whole plan.
- **Nothing published, no R2 write, no network call.**
- **`.env` was never `Read`, `cat`'d, `echo`'d or interpolated.** No task in this plan had any reason to reach for a credential.
- **`git diff --stat packages/ scripts/ docs/`** is empty — this plan touched only `apps/web/src/workers/` and `apps/web/src/test/`.

## SC-2 — explicit limit, not glossed

**No test in this plan is evidence for SC-2's "runs in the browser without blocking the page."** `mockWorker.ts`'s installed script executes on the test's own thread; every green test here proves the MESSAGE CONTRACT (which messages arrive, in what order, surviving the real clone boundary) and nothing about whether a visitor's page stays interactive during a run. That measurement is 08-13's, on a real browser with a real Worker, recorded in its own SUMMARY.

## Task Commits

1. **Task 1 (TRACER): message contract, hand-rolled mock, real round trip** — `e0d46783`
2. **Task 2: the Vite seam — entry file, factory, build probe** — `16cfb9c6`
3. **Task 3: the two failure modes and the mock's own contract** — `a39c851e`

**Tracer feedback gate:** re-ran Task 1's `<verify>` (`npx vitest run apps/web/src/workers/simulationProtocol.test.ts`) immediately after committing — 5/5 green — before starting Task 2's expansion work. No `checkpoint:human-verify` was surfaced: this task's verification is 100% automated test output (no URL, no UI, nothing visual), matching 08-03's own precedent for the same reasoning.

## Files Created/Modified

- `apps/web/src/workers/simulationProtocol.ts` — message contract + `runSimulationJob` plumbing (194 lines)
- `apps/web/src/workers/simulation.worker.ts` — three-statement worker entry (53 lines)
- `apps/web/src/workers/createSimulationWorker.ts` — the single-definition-site factory (41 lines)
- `apps/web/src/workers/simulationProtocol.test.ts` — 9 cases (Tests 1-9, 384 lines)
- `apps/web/src/test/mockWorker.ts` — the hand-rolled mock `Worker`
- `apps/web/src/test/mockWorker.test.ts` — 5 cases (M1-M5)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 5's `toBeInstanceOf(Int32Array)` assertion failed across a genuine cross-realm boundary**
- **Found during:** Task 1, first verification run
- **Issue:** `structuredClone`'s reconstructed `Int32Array` fails `instanceof` against the jsdom test realm's own `Int32Array` constructor, even though the cloned values are correct.
- **Fix:** Rewrote the assertion to `Object.prototype.toString.call(x) === "[object Int32Array]"`, which reads the internal class tag rather than relying on constructor identity. Verified in isolation with a plain Node script that `structuredClone` of a `Map<string, Int32Array>` round-trips correctly outside jsdom, confirming this was environment-specific and not a real defect.
- **Files modified:** `apps/web/src/workers/simulationProtocol.test.ts`
- **Commit:** `e0d46783`

**2. [Rule 1 - Bug] Test 6's exact-suffix URL assertion failed against Vite's own query-suffixed resolved URL**
- **Found during:** Task 2, first verification run
- **Issue:** `new URL("./simulation.worker.ts", import.meta.url)` resolves under this test's Vite/vite-node pipeline to `.../simulation.worker.ts?worker_file&type=module`, not a bare path ending in `.ts`.
- **Fix:** Changed the assertion from `.toMatch(/simulation\.worker\.ts$/)` to `.toContain("simulation.worker.ts")` — this is stronger evidence, not weaker: it shows Vite genuinely recognized the worker-detection shape even inside the test transform.
- **Files modified:** `apps/web/src/workers/simulationProtocol.test.ts`
- **Commit:** `16cfb9c6`

### Investigated, not a bug (TDD fail-fast rule applied)

**3. Task 3's P7/P8/P9 passed on first run instead of RED'ing**
- **Found during:** Task 3, before extending `simulationProtocol.ts`
- **Why:** Task 1's `isSimulationRequest` and `runSimulationJob`'s `try`/`catch` translation were written to Task 3's own exact specification up front (the plan's Task 1 action text already required full validation and error-translation behavior), so no code change to `simulationProtocol.ts` was needed in Task 3 at all — only `mockWorker.ts`'s two new failure modes required new code (and both genuinely RED'd, quoted above).
- **Investigation:** Per the plan's TDD fail-fast rule, confirmed this was not a vacuous pass: traced each of P7's three payloads, P8's unknown-team-key throw, and P9's four out-of-bounds requests through `isSimulationRequest`'s actual branches and the `try`/`catch`'s actual translation path — each sub-case would fail if the corresponding guard were removed. The plan's own Task 3 action text anticipates exactly this ("extend ... only if the bounds are not already enforced as Task 1 specified"), so this is a documented finding, not a defect.
- **Files modified:** none (test-only additions)

## Full `--project=web` verification

```
npx vitest run --project=web
Test Files  57 passed (57)
     Tests  858 passed (858)
```

Baseline was 55 files / 844 tests; this plan added exactly 2 files and 14 tests (5 `mockWorker.test.ts` + 9 `simulationProtocol.test.ts`), zero new failures.

`pnpm --filter web typecheck` exits **0** with both new worker files inside the program.

## Next Phase Readiness

- 08-11's `simulationInputs.ts` builds `SimMatchInput[]`/`SimTeamBaseline[]` exactly as this protocol forwards them, untouched — no reshaping happens between assembly and the draw loop.
- 08-13's Run handler constructs via `createSimulationWorker()` (lazily, in the click handler), posts a `SimulationRequest` with `seed: DEFAULT_SIMULATION_SEED` and `draws: SIMULATION_DRAWS`, and owns SC-2's representative measured runtime — this plan's tests are not evidence for the "without blocking the page" half of that claim.
- 08-14 reads `SimulationResultMessage.rankHistograms` directly into `continuousQuantile(dist, p, draws)` — no conversion needed, the shape is already `dist`-compatible.
- 08-15's S2 forced-failure evidence is built on `mockWorker.ts`'s `failOnConstruct` and throwing-script modes, both asserted here (M4/M5), not assumed.

## Self-Check: PASSED

All 6 created files confirmed present on disk (`apps/web/src/workers/simulationProtocol.ts`, `simulation.worker.ts`, `createSimulationWorker.ts`, `simulationProtocol.test.ts`, `apps/web/src/test/mockWorker.ts`, `mockWorker.test.ts`). All 3 task commits (`e0d46783`, `16cfb9c6`, `a39c851e`) confirmed in `git log --oneline`.
