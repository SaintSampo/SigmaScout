---
phase: 08-simulation-compare
plan: 13
subsystem: ui
tags: [react, web-worker, simulation, run-control, e2e, playwright]

requires:
  - phase: 08-simulation-compare
    plan: "07"
    provides: "apps/web/src/workers/{simulationProtocol,createSimulationWorker,simulation.worker}.ts — the message contract, the lazy-construction factory and its lifecycle contract, and apps/web/src/test/mockWorker.ts's installMockWorker/failOnConstruct/throwing-script failure modes"
  - phase: 08-simulation-compare
    plan: "11"
    provides: "apps/web/src/components/event/StartMatchPicker.tsx (the picker, the reserved disabled prop) and apps/web/src/lib/simulationInputs.ts (buildSimulationInputs, SIMULATION_DRAWS) — the selection and assembled inputs this plan consumes unreshaped"
provides:
  - "apps/web/src/components/event/useSimulationRun.ts — the run state machine: lazy Worker construction inside start(), one Worker at a time (terminated on every terminal message/new run/unmount), a monotonic run-id guard, and the main-thread elapsed measurement from Run press to result arrival"
  - "apps/web/src/components/event/RunControl.tsx — D-07's four rendered states (idle/running/complete/error) as a pure function of props, formatElapsedSeconds's sub-tenth-of-a-second bound, and the four SC-2 measurement data-* attributes"
  - "SimulationTab.tsx now derives simulationSignature at render time (PD-02), wires useSimulationRun() into RunControl, and freezes the picker while running"
  - "apps/web/src/test/mockWorker.ts's MockWorkerInstance now exposes a public `terminated` getter"
  - "apps/web/e2e/simulation-run.spec.ts — SC-2's committed real-browser measurement spec on the local-desktop project"
  - "apps/web/dist/assets/simulation.worker-*.js is now a permanent build output (08-07's PD-09 deferred seam proof, cashed)"
affects: ["08-14 (the rank-distribution table reads the gated SimResult exposed by SimulationTab's isResultCurrent, performing no freshness check of its own)", "08-15 (S2's forced-failure evidence is already built here via mockWorker's failOnConstruct/throwing-script modes)"]

actuals:
  tokens: 17464
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "The run state and the Worker live in a hook (useSimulationRun), never in the button's own component — RunControl.tsx is a pure function of props, provable with no Worker mock anywhere in its test file"
    - "Staleness prevented by a render-time signature comparison (simulationSignature), never an effect — a completed result whose inputs changed has no rendered form at all rather than a one-frame flash before correction"
    - "A monotonically increasing run id, checked in every Worker message handler, as defence in depth over terminate() — redundant by specification, kept because a message already dispatched into the task queue is not provably preventable in every real engine"
    - "MockWorkerInstance.terminated (a new public getter) — the pattern for asserting a lifecycle side-effect the mock previously only tracked privately"

key-files:
  created:
    - apps/web/src/components/event/useSimulationRun.ts
    - apps/web/src/components/event/useSimulationRun.test.ts
    - apps/web/src/components/event/RunControl.tsx
    - apps/web/src/components/event/RunControl.test.tsx
    - apps/web/e2e/simulation-run.spec.ts
  modified:
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
    - apps/web/src/test/mockWorker.ts
    - apps/web/playwright.config.ts

key-decisions:
  - "PD-01 through PD-15 applied exactly as specified — see 'Deviations from Plan' for the two genuine additions beyond the plan's literal text (mockWorker.ts's terminated getter; H3's test-authored stepped script)."
  - "Measurement event: 2023cur (2023 Sacramento Regional) — 78 teams (the corpus's measured maximum roster), 130 played qualification rows, all 130 confirmed live to carry both redRpPmf/blueRpPmf. Chosen over 2022oncmp (134 rows but only 67 teams) because the plan's own text names '78 teams' as the maximum-roster benchmark, and 08-11-SUMMARY.md independently named 2023cur as this phase's other largest-roster real target."
  - "formatElapsedSeconds's bound threshold is on the raw millisecond value (ms < 100), not on the rounded display string — avoids a toFixed(1) floating-point edge case at the exact 95ms/100ms boundary the plan's own R7 table specifies."

patterns-established:
  - "A Worker-owning React hook returns { state, start, reset } with all mutable Worker/timer/run-id bookkeeping in refs and only the discriminated-union state in React state — the shape any future Worker-backed UI in this app should copy."

requirements-completed: [EVNT-07]

coverage:
  - id: D1
    description: "Pressing Run with a start match selected constructs exactly one Worker, posts exactly one request, and reaches a completion line — proven end to end through the real 08-07 protocol"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H2, H4"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#I1: one press, one full round trip, one completion line"
        status: pass
    human_judgment: false
  - id: D2
    description: "The progress bar is determinate, 8px, and advances from the Worker's own completedDraws in twenty steps to exactly 1000, with the counter and the bar deriving from the same field"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H3"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/RunControl.test.tsx#R3, R9"
        status: pass
    human_judgment: false
  - id: D3
    description: "The elapsed timer ticks during the run and the completion line states the total, measured on the main thread from the Run press to result arrival"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H11, H12"
        status: pass
    human_judgment: false
  - id: D4
    description: "Nothing partial is ever rendered — no state variant can carry a partial result, and the rank-table position holds its pre-run placeholder for the whole run"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H3"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#I5: the placeholder holds for the whole run"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both Worker failure shapes (construction and mid-run) render the inline error line plus Retry, with no progress bar present and no error internals in the DOM — UI-SPEC S2's backstop row, evidenced"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H5, H6a, H6b"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#I2, I3"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/RunControl.test.tsx#R6, R8"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Worker is constructed only inside the Run handler, terminated on every terminal message/new run/unmount, and a component test that never presses Run installs no mock at all"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/useSimulationRun.test.ts#H1, H7, H8, H9, H10, H13"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#I6: pressing nothing constructs nothing"
        status: pass
    human_judgment: false
  - id: D7
    description: "Changing the start match removes the completion line and the result in the same frame, by a render-time comparison rather than an effect"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#I7"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/RunControl.test.tsx#R5"
        status: pass
    human_judgment: false
  - id: D8
    description: "pnpm --filter web build emits a simulation.worker-*.js asset with no temporary edit anywhere — 08-07's deferred permanent seam proof, cashed"
    requirement: EVNT-07
    verification:
      - kind: other
        ref: "pnpm --filter web build output (quoted in this SUMMARY) + git status --porcelain apps/web/src/main.tsx (empty)"
        status: pass
    human_judgment: false
  - id: D9
    description: "SC-2's representative measured runtime is captured with event key, season, roster size, remaining-match count, elapsed ms, compute ms, the rendered completion sentence, browser name/version, OS, and an explicit statement of its limits"
    requirement: EVNT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/simulation-run.spec.ts — printed measurement quoted in this SUMMARY's SC-2 block"
        status: pass
    human_judgment: false

duration: ~2h
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 13: Run Control (Worker lifecycle, progress, elapsed timing) Summary

**A `useSimulationRun` hook owning lazy Worker construction, one-Worker-at-a-time termination, a monotonic run-id guard and main-thread elapsed timing; `RunControl.tsx` rendering D-07's four states (idle/running/complete/error) as a pure function of props with an 8px determinate bar and a sub-tenth-of-a-second display bound; and a committed Playwright spec measuring a real 78-team, 130-match simulation (97ms elapsed, 21.3ms compute) against real published R2 bytes — SC-2's only durable "recorded" evidence.**

## Baseline (recorded before Task 1)

```
npx vitest run --project=web
Test Files  66 passed (66)
     Tests  1041 passed (1041)
```

```
pnpm --filter web typecheck
$ tsc --noEmit -p tsconfig.json
EXIT: 0
```

```
pnpm --filter web build
... (no simulation.worker asset in the printed list)
```

`ls apps/web/dist/assets | grep -i "simulation.worker"` printed nothing — confirmed absent at baseline, matching 08-07's own note that its build probe was reverted (temporary, no permanent call site existed yet).

## Post-plan numbers

```
npx vitest run --project=web
Test Files  68 passed (68)
     Tests  1071 passed (1071)
```

Baseline was 66 files / 1041 tests; this plan added exactly 2 test files (`useSimulationRun.test.ts`, `RunControl.test.tsx`) and 30 tests (14 + 9 + 7 appended to `SimulationTab.test.tsx`), zero new failures, zero pre-existing test changed status.

`pnpm --filter web typecheck` exits **0** with all four new/modified files inside the program.

## Observed RED (quoted, not claimed)

**Task 1, before `useSimulationRun.ts` existed** (all 14 cases in `useSimulationRun.test.ts` failed identically at import resolution — quoting H2's failure as representative):

```
FAIL  |web| src/components/event/useSimulationRun.test.ts [ apps/web/src/components/event/useSimulationRun.test.ts ]
Error: Failed to resolve import "./useSimulationRun.js" from "apps/web/src/components/event/useSimulationRun.test.ts". Does the file exist?
```

**Task 2, before `RunControl.tsx` existed** (all 9 cases in `RunControl.test.tsx`, including R3, failed identically):

```
FAIL  |web| src/components/event/RunControl.test.tsx [ apps/web/src/components/event/RunControl.test.tsx ]
Error: Failed to resolve import "./RunControl.js" from "apps/web/src/components/event/RunControl.test.tsx". Does the file exist?
```

**Task 2, `SimulationTab.test.tsx` (I2 and all other appended cases) before `RunControl.tsx` existed** — `SimulationTab.tsx` already imported it in the same edit pass, so the whole suite failed at the same import boundary:

```
FAIL  |web| src/components/event/SimulationTab.test.tsx [ apps/web/src/components/event/SimulationTab.test.tsx ]
Error: Failed to resolve import "./RunControl.js" from "apps/web/src/components/event/SimulationTab.test.tsx". Does the file exist?
```

Both RED captures were produced retroactively (moving the not-yet-committed implementation file aside, re-running, then restoring it) since the implementation and its test were written together in this session — the same "prove the RED, don't just claim it" discipline 08-07-SUMMARY.md's own precedent uses.

## H3's no-streaming claim — evidenced, not asserted

`useSimulationRun.test.ts`'s H3 uses a test-authored script (three progress messages separated by real macrotask boundaries, driven deterministically with `vi.advanceTimersByTimeAsync`) rather than the real synchronous `runSimulationJob` round trip. The real round trip's 20+1 messages all fire within ONE microtask (the mock's own documented delivery model), which React 18's automatic batching collapses into a single final render — meaning a passive observer would never see an intermediate `running` state at all through that path, not because none occurred, but because the render layer coalesced them. H3's test-authored script sidesteps that batching artifact to make the intermediate states OBSERVABLE, and confirms: `completedDraws` took the value `PROGRESS_CHUNK_DRAWS` (50) at least once, strictly increased across observed states, and **no observed running state ever carried a `result` field of any shape** — the no-streaming prohibition asserted structurally at the state level.

## Exported protocol surface, as built

```typescript
// apps/web/src/components/event/useSimulationRun.ts
export const SIMULATION_TICK_INTERVAL_MS = 100;
export type SimulationRunStatus = "idle" | "running" | "complete" | "error";
export type SimulationRunState = SimulationRunIdleState | SimulationRunRunningState | SimulationRunCompleteState | SimulationRunErrorState;
export interface SimulationRunRequest { matches, baselines, signature }
export function useSimulationRun(): { state, start, reset };

// apps/web/src/components/event/RunControl.tsx
export const RUN_LABEL_IDLE = "Run simulation";
export const RUN_LABEL_RERUN = "Re-run simulation";
export const RUN_ERROR_BODY = "Simulation failed to run.";
export const RUN_RETRY_LABEL = "Retry";
export const RUN_COMPLETE_PREFIX = "Simulated 1000 draws in";
export const PROGRESS_BAR_H_PX = 8;
export const RUN_CONTROL_TESTID = "run-control";
export function formatElapsedSeconds(ms: number): string;
export function RunControl(props: RunControlProps): JSX.Element;
```

`grep -c "createSimulationWorker" apps/web/src/components/event/useSimulationRun.ts` returns **2** — one in the doc comment restating the lifecycle contract, one in the actual `try { worker = createSimulationWorker(); }` call inside the `start` callback (confirmed by reading the function: the call sits directly inside `start`, never at module scope, never in the unconditional `useEffect`).

## Build probe — quoted both ways (08-07's PD-09, cashed)

**Before this plan** (baseline, `ls`-confirmed absent — see above).

**After Task 2's mount:**
```
dist/assets/simulation.worker-CbGWrOhu.js                    2.88 kB
```
Same content hash (`CbGWrOhu`) as 08-07's own temporary probe — confirming byte-identical worker output, now reached through a permanent call site (`useSimulationRun.ts`'s `start()`), not a reverted `main.tsx` edit. `git status --porcelain apps/web/src/main.tsx` prints nothing. `grep -l "InvalidSimulationRequest" apps/web/dist/assets/*.js` finds it inside `simulation.worker-CbGWrOhu.js`, confirming the real protocol module is bundled into the emitted worker chunk.

## PD-04's recorded copy deviation

UI-SPEC's Copywriting Contract row (`## Copywriting Contract`, "Run control — complete") reads:

> "Simulated 1000 matches in {elapsed}s"

Shipped instead: **"Simulated 1000 draws in {elapsed}s"** — one word changed. The run performs `SIMULATION_DRAWS` Monte Carlo DRAWS over however many qualification matches remain (2023cur: 130; other events measured elsewhere in this phase: often 40, sometimes 135, never 1000), and the counter directly above the completion line in the same region (`"{completed} / 1000 draws"`) already calls the identical quantity "draws". Shipping a completion line that contradicts the counter two lines above it, on a page whose entire premise is honest uncertainty, is not a defensible reading of the contract — recorded here as PD-04 specifies, not smuggled.

## SC-2 measurement block (Task 3's ten required fields)

| Field | Value |
|---|---|
| Event key | `2023cur` (2023 Sacramento Regional) |
| Season | 2023 |
| Roster size (`data-team-count`) | 78 (the corpus's measured maximum roster) |
| Remaining matches (`data-remaining-matches`) | 130 (every played qualification row at this fully-played event, starting from `2023cur_qm1`) |
| Elapsed ms (`data-elapsed-ms`, main-thread, Run press → result arrival) | **97** |
| Compute ms (`data-compute-ms`, draw loop alone) | **21.299999952316284** |
| Rendered completion sentence | `Simulated 1000 draws in <0.1s` |
| Browser | Chromium 151.0.7922.34 |
| OS | win32 |
| Limits | **This is a single representative measurement on one machine and is NOT a performance guarantee or a regression bound.** D-07's accepted consequence is precisely that this number cannot serve either purpose — runtime varies by visitor hardware, and no test anywhere in this plan (or the whole phase) asserts a runtime threshold. |

The 97ms/21.3ms split is the construction-plus-transfer-versus-compute distinction 08-07's PD-05 exists to make visible: ~76ms was Worker construction, request transfer and result transfer; ~21ms was the actual 1000-draw loop over 78 teams and 130 matches. Both figures comfortably clear 08-03's own measured core worst case (17.59ms for 78 teams / 135 matches / 1000 draws) — consistent, since `computeMs` measures the same core.

`data-compute-ms` (21.3) ≤ `data-elapsed-ms` (97): confirmed.

The Playwright run reported exactly **1 test executed, 1 passed** — not "no tests found", confirming the `local-desktop` project's widened `testMatch` regex took effect.

## Differences from what 08-07/08-11 landed vs. what this plan assumed

None in the exported surface itself — `createSimulationWorker`, `SIMULATION_DRAWS`/`PROGRESS_CHUNK_DRAWS`/`DEFAULT_SIMULATION_SEED`, the three message types, and `installMockWorker`'s `failOnConstruct`/throwing-script modes all matched this plan's `<context>` block exactly, confirmed by the precondition greps before Task 1/Task 2 began.

**One genuine addition beyond the plan's literal text, both anticipated by its own acceptance criteria:**

1. **`mockWorker.ts`'s `MockWorkerInstance.terminate()` did not previously expose whether it had been called** — `#terminated` was a private field with no public read surface. Task 1's acceptance criteria explicitly anticipated this ("If the landed mock does not record `terminate()` calls, add that recording to the mock rather than weakening the assertion"). Added a read-only public `terminated` getter; H9/H10 assert against it. No existing test's behavior changed — `mockWorker.test.ts`'s 5 cases still pass unmodified.

## Task Commits

1. **Task 1 (RED): `useSimulationRun.test.ts`** — `f980a1c7` (test)
2. **Task 1 (GREEN): `useSimulationRun.ts` + `mockWorker.ts`'s `terminated` getter** — `09de4296` (feat)
3. **Task 2 (RED): `RunControl.test.tsx` + `SimulationTab.test.tsx` extension** — `22def4d5` (test)
4. **Task 2 (GREEN): `RunControl.tsx` + `SimulationTab.tsx` wiring** — `30ae12eb` (feat)
5. **Task 3: `simulation-run.spec.ts` + `playwright.config.ts` widening** — `d303a7bf` (test)

## Files Created/Modified

- `apps/web/src/components/event/useSimulationRun.ts` — the run state machine and Worker lifecycle (232 lines)
- `apps/web/src/components/event/useSimulationRun.test.ts` — 14 cases (H1-H13, H6 split into H6a/H6b)
- `apps/web/src/components/event/RunControl.tsx` — the four-state pure-function component (157 lines)
- `apps/web/src/components/event/RunControl.test.tsx` — 9 cases (R1-R9)
- `apps/web/src/components/event/SimulationTab.tsx` — wires `useSimulationRun`/`RunControl`, derives `simulationSignature`
- `apps/web/src/components/event/SimulationTab.test.tsx` — 7 new cases (I1-I7) appended before the file's own "still no Worker" whole-file spy assertion
- `apps/web/src/test/mockWorker.ts` — one added public `terminated` getter
- `apps/web/e2e/simulation-run.spec.ts` — SC-2's real-browser measurement spec
- `apps/web/playwright.config.ts` — `local-desktop`'s `testMatch` widened by one spec name

## Decisions Made

See `key-decisions` in frontmatter. The measurement event (2023cur) required a live confirmation fetch against `https://data.sigmascout.org/v1/event/2023cur/vpr@2.1.0+tuned-2026-08.json` before the spec was written — status 200, 78 teams, 130/130 played qm rows carrying both pmfs, confirming 08-05-SUMMARY.md's ledger rather than assuming it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `expect(...).toBeDisabled()`/`.toBeEnabled()` are not available — this repo has no `@testing-library/jest-dom` matcher extension installed**
- **Found during:** Task 2, first `RunControl.test.tsx` run
- **Issue:** `Invalid Chai property: toBeDisabled` / `toBeEnabled` — this repo's Vitest setup (`src/test/setup.ts`) never extends Chai's `expect` with jest-dom matchers, unlike some other testing-library-based repos.
- **Fix:** Rewrote both assertions to read `(button as HTMLButtonElement).disabled` directly.
- **Files modified:** `apps/web/src/components/event/RunControl.test.tsx`
- **Commit:** `22def4d5`

**2. [Rule 1 - Bug] H3's original real-round-trip design never observed an intermediate `running` state**
- **Found during:** Task 1, first `useSimulationRun.test.ts` run
- **Issue:** The mock's own documented delivery model posts all progress + result messages synchronously within one microtask; React 18's automatic batching collapses all of that microtask's `setState` calls into a single final commit, so a passive `waitFor`-based observer only ever sees the terminal `complete` state.
- **Fix:** Rewrote H3 with a test-authored script posting three progress messages across real macrotask boundaries, driven deterministically with fake timers (`vi.advanceTimersByTimeAsync`) rather than racing a real-time `waitFor` poll interval.
- **Files modified:** `apps/web/src/components/event/useSimulationRun.test.ts`
- **Commit:** `f980a1c7`

**3. [Rule 1 - Bug] H12's fake-clock semantics — the fake `performance.now()` jumps to the advanced target atomically for every timer fired in one `advanceTimersByTime` call, not incrementally per-callback**
- **Found during:** Task 1, first `useSimulationRun.test.ts` run
- **Issue:** The test originally expected a mid-tick value (200ms) after advancing by 250ms in one call; the observed value was 250ms (the advance's own target), since every `setInterval` callback due within that window reads the SAME final clock value.
- **Fix:** Restructured into two separate `advanceTimersByTime` calls (220ms, producing the observed tick; then 40 more, moving the clock past the tick without firing another callback) so the final microtask-flushed result lands strictly between the last observed tick and the next tick boundary, as H12 specifies.
- **Files modified:** `apps/web/src/components/event/useSimulationRun.test.ts`
- **Commit:** `f980a1c7`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs in the test's own first draft, found and fixed before commit; no production code was affected by any of the three).
**Impact on plan:** None on scope. `mockWorker.ts`'s `terminated` getter (recorded above under "Differences from what 08-07/08-11 landed") is the only change outside this plan's own new files, and it was explicitly anticipated by Task 1's acceptance criteria.

## Issues Encountered

`npx playwright` failed to resolve on this machine's Git Bash shell (`'playwright' is not recognized`) — the workspace-hoisted `.bin/playwright` shim is a POSIX script `node` cannot execute directly on Windows. Resolved by invoking through `pnpm exec playwright` instead, which resolves the correct platform shim. Not a plan deviation — a local invocation detail, noted per this project's `MEMORY.md` precedent of recording environment quirks rather than let them look like regressions.

## User Setup Required

None — no external service configuration required. `.env` was never `Read`, `cat`'d, `echo`'d or interpolated at any point. Task 3's Playwright run reads `VITE_ARTIFACT_ORIGIN` from `playwright.config.ts`'s own committed `webServer.env` block, which carries no secret.

## Next Phase Readiness

- **Routed to 08-14:** `SimulationTab.tsx` exposes `runState`/`isResultCurrent` (the completed `SimResult`, gated) at the rank-table mount position, with a comment naming 08-14 as the consumer and stating the freshness gate (PD-02) has already been applied — 08-14 performs no freshness check of its own.
- **Routed to 08-15:** UI-SPEC S2's error backstop row is already evidenced twice over (`useSimulationRun.test.ts`'s H5/H6a/H6b and `SimulationTab.test.tsx`'s I2/I3) — 08-15 can cite this plan's tests directly rather than re-proving the forced-failure modes.
- **Explicit confirmations:** no new npm dependency (`git diff --stat package.json pnpm-lock.yaml` empty across all three tasks), no config file touched beyond `playwright.config.ts`'s single widened regex, no `--color-*`/`--accent`/`--alliance-*`/`--tier-*` token value changed, no published field, no schema change, no R2 write. `event.$eventKey.test.tsx`'s zero-progressbar assertions pass unmodified (`git diff --stat` empty). `.env` was never read, printed, copied or interpolated at any point.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*

## Self-Check: PASSED
