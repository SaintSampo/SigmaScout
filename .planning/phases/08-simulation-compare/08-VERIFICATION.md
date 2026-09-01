---
phase: 08-simulation-compare
verified: 2026-08-31T22:45:00Z
status: human_needed
score: 4/4 roadmap success criteria verified in code; 0 failed
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Bounded picker touch behavior — /event/2022oncmp?algorithm=vpr&tab=simulation, 134-row picker in a ~320px panel, on a real iPhone and a real Android"
    expected: "Page scrolls normally from outside the panel; the list scrolls internally while the page stays put from inside it; clean boundary behavior at the list's bottom (no jump, no rubber-band leak, no self-bounce); flick momentum doesn't fight tapping; a row two-thirds down selects cleanly on first tap."
    why_human: "Automated evidence is synthesized CDP touch input (Input.dispatchTouchEvent) in desktop Chromium wearing a phone viewport — explicitly not proof of real-hardware touch/momentum/rubber-band behavior (08-15-SUMMARY.md). Deliberately deferred to /gsd-verify-work per config.json's human_verify_mode: end-of-phase and an explicit user decision at the 08-15 checkpoint."
  - test: "78-row density and readability — /event/2023cur?algorithm=vpr&tab=simulation, first match, press Run, scroll all 78 rows on a real device"
    expected: "Each row reads as its own distribution; a two-humped (bimodal) row is either found or its absence is reported as a finding; sideways drag keeps the pinned Team#/Nickname columns opaque; no ± glyph appears anywhere in the band-label column."
    why_human: "Same synthesized-touch limitation as above; visual/density judgment on real glass, not measurable by CDP dispatch alone."
  - test: "Felt responsiveness during a run — press Run, immediately try to scroll the page while the progress bar fills, on a real device"
    expected: "The page keeps scrolling smoothly; no hitch, freeze, or stall while the Worker runs."
    why_human: "SC-2's 'without blocking the page' claim is architecturally true (Web Worker off main thread) and measured in desktop Chromium (08-13, 08-15), but felt responsiveness under real touch input during a live run has not been confirmed on real hardware."
  - test: "Six-tab strip at phone width — any event page, real device"
    expected: "Drag moves only the strip; Simulation is reachable at the right end; no label wraps to a second line; switching algorithm to OPR makes Simulation go visibly dead with no explanation (deliberate, D-04/Phase 7 D-17) and reads as intentional rather than broken."
    why_human: "Automated coverage (event-scroll-regions.spec.ts) proves this in CDP-emulated Chromium; real-device drag/inertia feel is unconfirmed."
  - test: "Compare page at phone width — /compare, real device"
    expected: "Accuracy table pans without moving the page; switching Combined/Qualification/Elimination causes no sideways jump; calibration chart axis labels are readable, series distinguishable, smallest dots still visible."
    why_human: "Same synthesized-touch limitation; visual legibility judgment on real glass."
---

# Phase 8: Simulation & Compare Verification Report

**Phase Goal:** The two headline differentiators ship — rank simulation from a chosen match, and a
public accuracy table that matches the harness exactly.

**Verified:** 2026-08-31
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | On an event's Simulation tab a user picks a start match, and the remaining qualification matches are simulated 1000× from predicted winners, confidence, and RP ± variance, producing a predicted rank distribution per team | ✓ VERIFIED | `SimulationTab.tsx` wires `StartMatchPicker` → `buildSimulationInputs` (`simulationInputs.ts`) → `useSimulationRun` → Worker → `simulateRanks` (`rankSimulation.ts`, `packages/core/algorithms/simulation/`), which draws one RP value per alliance per match from `redRpPmf`/`blueRpPmf` for exactly `draws` (1000, `SIMULATION_DRAWS`) iterations, ranks by average RP (Ranking Score), and returns a per-team rank histogram summing to `draws`. `RankDistributionTable.tsx` renders median + drawn 10th–90th band + per-row histogram per D-05. 6-tab event page wiring confirmed live (`event.$eventKey.tsx`, `EVENT_TABS` six-id tuple in `searchParams.ts`). 76/76 unit tests pass across `rankSimulation.test.ts`/`simQuantile.test.ts`/`simAxis.test.ts`/`rewindGap.test.ts`; 128/128 across `SimulationTab`, `useSimulationRun`, `RunControl`, `StartMatchPicker`, `simulationInputs`, `simulationProtocol` test files (independently re-run this session). |
| SC-2 | The simulation runs in the browser from precomputed inputs without blocking the page, with its runtime measured and recorded | ✓ VERIFIED | Draw loop runs inside a genuine Web Worker (`apps/web/src/workers/simulation.worker.ts`, `createSimulationWorker.ts`) — confirmed the entry file imports no arithmetic and `createSimulationWorker()` is the sole `new Worker(...)` call site. `pnpm --filter web build` independently re-confirmed this session to emit `apps/web/dist/assets/simulation.worker-CbGWrOhu.js` as a real, separate chunk. Runtime is measured and recorded exactly as D-07 designed (no committed benchmark file, by deliberate accepted tradeoff): a real-browser Playwright spec (`e2e/simulation-run.spec.ts`) against real published R2 bytes, whose result was captured in `08-13-SUMMARY.md` — Chromium 151.0.7922.34, `2023cur` (78 teams, 130 matches), 97ms elapsed / 21.3ms compute — and a second, worst-case-roster measurement in `08-15-SUMMARY.md` (~180–230ms at `2023cur`'s 78-team/130-match case across both desktop and phone viewports). |
| SC-3 | The Compare page shows winner accuracy and Brier score for every algorithm for every year 2022–2026 | ✓ VERIFIED | `compare.tsx` fetches all five `v1/compare/{year}.json` artifacts via `COMPARE_SEASONS` (module constant, ignores URL params per D-08/NAV-02 exception) and renders `AccuracyTable.tsx`, which walks `COMPARE_SEASONS` × `PUBLISHED_ALGORITHM_IDS` and prints `winnerAccuracy`/`brierScore` per cell straight from the parsed artifact (`buildAccuracyRows`), with no re-derivation. Confirmed live: `compare.tsx`/`AccuracyTable.tsx` render one uniform 5-row × 3-algorithm table, D-08's no-tiering rule intact (no tune/holdout string anywhere in the render path). |
| SC-4 | The numbers rendered on the Compare page are identical to the versioned artifact the offline harness produced for that algorithm version — verified by an automated check, not by eye | ✓ VERIFIED | `apps/web/src/routes/compare.test.tsx` is a genuine parity proof (D-10): renders the real exported `Route` against five committed copies of the real published artifacts (`__fixtures__/compare-{2022..2026}.json`, generation `1c11cdd8` matching the 08-05 republish ledger), and every expected value is computed from the fixture at test-run time (`slice.brierScore.toFixed(4)`, `(slice.winnerAccuracy * 100).toFixed(1) + "%"`) rather than hand-typed — covering all 3 views × 5 seasons × 3 algorithms = 45 cases. Independently re-ran this session: **80/80 tests pass** in this one file. |

**Score:** 4/4 roadmap success criteria verified in code and by passing automated tests. 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/algorithms/simulation/rankSimulation.ts` | Browser-safe 1000-draw Monte Carlo core | ✓ VERIFIED | Zero runtime imports; sums draws to `draws`, throws named errors on malformed input; deterministic under a fixed seed. Read in full, wired into both callers (Worker, `measureRewindGap.ts`). |
| `apps/web/src/workers/{simulation.worker,createSimulationWorker,simulationProtocol}.ts` | Vite-bundled Web Worker running the draw loop off the main thread | ✓ VERIFIED | Worker entry is 3 statements, no arithmetic; `createSimulationWorker()` sole construction site; build independently confirmed to emit a real chunk. |
| `apps/web/src/lib/{simQuantile,simAxis,simulationInputs,rewindGap}.ts` | Interpolated-quantile band math, shared axis geometry, D-12 baseline assembly, rewind-gap caption data | ✓ VERIFIED | All present, all imported by consumers, all covered by passing unit tests. |
| `apps/web/src/components/event/{SimulationTab,StartMatchPicker,RunControl,useSimulationRun,RankDistributionTable,rankRows}.tsx` | The Simulation tab's full render stack | ✓ VERIFIED | Read in full; correctly implements D-01/D-04/D-05/D-06/D-07/D-13/D-14; wired into `event.$eventKey.tsx`'s six-tab strip. |
| `apps/web/src/routes/compare.tsx` + `apps/web/src/components/compare/*` | The real Compare page (accuracy table, near-tie emphasis, methodology note, calibration, data coverage) | ✓ VERIFIED | Read in full; D-08/D-09/D-10/D-11 all implemented and covered by the 80-test parity/emphasis suite. |
| `packages/harness/pageArtifacts.ts` `EventMatchSchema` (`redRpPmf`/`blueRpPmf`/`actualRedRp`/`actualBlueRp`) | Published-contract fields backing the simulation and D-12 baselines | ✓ VERIFIED | Fields present with the documented three-state (`absent`/`null`/`integer`) contract; identical pmf refine pair reused across four schemas. |
| Production R2 republish (D-03/D-12) | Real published bytes carrying the four new fields | ✓ VERIFIED | `docs/publish-budget.md`'s committed ledger records the 2026-08-31 run (generation `e2d220d9-...`, 56,776 PUTs, event maxBytes 342,405 ≤ 350,000 ceiling with 7,595B margin); `08-05-SUMMARY.md`'s `verifySubsetPublish.ts` output shows both the positive (VPR pmf presence) and negative (OPR/EPA absence, offseason absence) cases proven against live fetched bytes, plus the D-12 fallback case (`2024auwarp`, zero teams carrying `rp`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `SimulationTab.tsx` | `useSimulationRun.ts` → Worker → `rankSimulation.ts` | `handleRun` → `startRun` → `createSimulationWorker()` → `postMessage` | ✓ WIRED | Confirmed by passing `SimulationTab.test.tsx`/`useSimulationRun.test.ts`/`simulationProtocol.test.ts` and by the e2e spec's real completion with populated `data-elapsed-ms`. |
| `compare.tsx` | `v1/compare/{year}.json` (R2 origin) | `compareQueryOptions` / `artifactUrl()` | ✓ WIRED | 5 fetches, 0 manifest requests, confirmed by `compare.test.tsx`'s own fetch-count assertion. |
| `AccuracyTable.tsx` cell values | Committed fixture / live artifact | `buildAccuracyRows` → direct field read, no re-derivation | ✓ WIRED | 45/45 parity cases pass, each value computed from the fixture at test-run time. |
| `EventMatchSchema.redRpPmf` (publisher) | `SimTeamBaseline`/`SimMatchInput` (simulation input) | `simulationInputs.ts` `buildSimulationInputs` | ✓ WIRED | Confirmed via `simulationInputs.test.ts` and the live `2023cur`/`2024auwarp` cases documented in 08-05/08-11 SUMMARYs. |

### Behavioral Spot-Checks / Test Runs (this session)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Compare parity suite | `npx vitest run apps/web/src/routes/compare.test.tsx` | 80/80 passed | ✓ PASS |
| Simulation core + math unit suites | `npx vitest run rankSimulation.test.ts simQuantile.test.ts simAxis.test.ts rewindGap.test.ts` | 76/76 passed | ✓ PASS |
| Simulation UI/run/worker-protocol suites | `npx vitest run SimulationTab.test.tsx SimulationTab.failure.test.tsx useSimulationRun.test.ts RunControl.test.tsx StartMatchPicker.test.tsx simulationInputs.test.ts simulationProtocol.test.ts` | 128/128 passed | ✓ PASS |
| Publish-budget gate | `npx vitest run packages/harness/payloadBudget.test.ts` | 9/11 passed; the event-page-specific ceiling test (08-05's own gate) passes; the 2 failures are the pre-existing, pre-dating-phase, accepted `teams`/`team` ledger #11/#15 failures, confirmed by name and message to match the documented baseline | ✓ PASS (no regression) |
| Debt-marker scan | grep for `TBD`/`FIXME`/`XXX` across every file this phase's 15 plans declare in `files_modified` | 0 hits | ✓ PASS |
| Build emits worker chunk | `find apps/web/dist -iname "simulation*"` | `apps/web/dist/assets/simulation.worker-CbGWrOhu.js` present | ✓ PASS |
| e2e specs wired, none skipped | grep for `.skip`/`.fixme`/`.only` in `simulation-tab.spec.ts`, `simulation-run.spec.ts`, `compare-narrow-legibility.spec.ts`, `event-scroll-regions.spec.ts`, `SimulationTab.failure.test.tsx`; grep `playwright.config.ts` `testMatch` | 0 hits; all four e2e specs appear in at least one project's `testMatch` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| EVNT-07 | 08-02,03,04,07,08,09,11,13,14,15 | Simulation tab: pick start match, 1000× simulation, rank distribution per team | ✓ SATISFIED | See SC-1/SC-2 evidence above. |
| COMP-01 | 08-01,06,09,10,12,15 | Winner accuracy + Brier score per algorithm per year | ✓ SATISFIED | See SC-3 evidence above. |
| EVAL-05 | 08-01,02,05,06,08,12,15 | Harness results published as a versioned artifact; Compare page shows the same numbers | ✓ SATISFIED | See SC-4 evidence above. |

No orphaned requirements found — `REQUIREMENTS.md`'s traceability table marks all three `Phase 8 / Complete`, matching what every plan in this phase declares.

### Anti-Patterns Found

None. Zero `TBD`/`FIXME`/`XXX` markers across every file this phase's plans declare as modified. No stub `return null`/hardcoded-empty-data patterns found in any of the surfaces read in full during this verification (`SimulationTab.tsx`, `RankDistributionTable.tsx`, `rankSimulation.ts`, `AccuracyTable.tsx`, `compare.tsx`, the Worker trio).

### Known, Deliberately Non-Blocking Item

`AccuracyTable.tsx`'s outer `overflow-x-auto` wrapper is redundant — the real scroller is shadcn's inner `[data-slot="table-container"]` div, so the `compare-accuracy-scroll` testid does not identify the literal scrolling element. User-facing impact confirmed none (a real touch/drag lands on whichever element actually has overflow). This is logged in `deferred-items.md`, does not affect SC-3 or SC-4, and does not block this verification.

## Human Verification Required

**Five real-device touch/feel checks are deliberately PENDING**, per an explicit user decision recorded in `08-15-SUMMARY.md` and consistent with this project's `config.json` `human_verify_mode: "end-of-phase"` setting. All automated gesture evidence in this phase (bounded-picker scroll, six-tab drag, Compare-table pan) is synthesized CDP touch input (`Input.dispatchTouchEvent`) dispatched into desktop Chromium wearing a phone viewport — explicitly documented by the executor as real-browser but *not* real-hardware evidence. None of the five items contradicts or casts doubt on any of the four ROADMAP success criteria (all four are independently proven by code + passing automated tests above); they are the felt/tactile layer the automated suite cannot reach. See the `human_verification` list in this report's frontmatter for the full test/expected/why-human detail on each of the five (bounded picker, 78-row density, felt responsiveness during a run, six-tab strip, Compare page pan) — reproduced verbatim from `08-15-SUMMARY.md`'s "five checks" list so nothing is lost in translation.

## Gaps Summary

No gaps. All four ROADMAP success criteria are independently verified against real code, real published production bytes, and passing automated tests (284 relevant unit/component tests re-run directly during this verification, all passing; the two pre-existing `payloadBudget.test.ts` failures are confirmed unrelated to this phase). The phase is withheld from a `passed` verdict only because five real-device human-verification items remain deliberately open, per explicit project process — not because any implementation is missing, stubbed, or unwired.

---

*Verified: 2026-08-31*
*Verifier: Claude (gsd-verifier)*
