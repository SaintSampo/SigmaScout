---
phase: 08-simulation-compare
plan: 15
subsystem: testing
tags: [playwright, vitest, e2e, worker, touch-scroll, backstop-verification, sigmascout]

requires:
  - phase: 08-simulation-compare
    provides: "08-09's six-trigger tab shell, 08-11's start-match picker, 08-13's RunControl/Worker lifecycle, 08-14's rank-distribution table, 08-01/08-06's AccuracyTable/CompLevelSwitcher, 08-10's CalibrationSection — every surface this plan's specs measure"
provides:
  - "Named, runnable, real-browser evidence for all six of this phase's verification: backstop markers (S0, S1, S2, S3, C1, C3), run against real published R2 bytes through the local preview proxy"
  - "apps/web/e2e/support/scrollRegions.ts and apps/web/e2e/support/simulation.ts — reusable e2e helpers/drivers for any future tab or scroll-region spec"
  - "apps/web/src/components/event/SimulationTab.failure.test.tsx — the app's first Worker-failure/recovery test suite"
  - "A blocking real-device checkpoint, deliberately deferred to /gsd-verify-work per explicit user decision, with the full five-area check list preserved"
affects: ["verify-work", "ship"]

actuals:
  tokens: 20500
  tasks: 4
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Shared e2e support modules (scrollRegions.ts, simulation.ts) with no .spec. segment so they are never collected as tests themselves, mirroring touchDrag.ts's precedent"
    - "Worker-failure test suites import a shared plain (non-.test) fixture module rather than re-authoring fixtures, avoiding the two-independently-drifting-fixtures failure mode"
    - "Real-device sign-off recorded as an explicit PENDING coverage item routed to /gsd-verify-work's end-of-phase UAT pass, rather than silently absorbed into a green plan"

key-files:
  created:
    - apps/web/e2e/support/scrollRegions.ts
    - apps/web/e2e/support/simulation.ts
    - apps/web/e2e/simulation-tab.spec.ts
    - apps/web/e2e/compare-narrow-legibility.spec.ts
    - apps/web/src/components/event/SimulationTab.failure.test.tsx
    - apps/web/src/components/event/simulationTestFixtures.ts
  modified:
    - apps/web/e2e/event-scroll-regions.spec.ts
    - apps/web/playwright.config.ts
    - .planning/phases/08-simulation-compare/deferred-items.md

key-decisions:
  - "PD-01 applied as written: S1's target moved UP from 2024wvrox (135 rows, offseason, 0 pmfs) to 2022oncmp (134 rows, RP-eligible, 67 teams), with 2024wvrox shipped as a control asserting SIMULATION_UNAVAILABLE_HEADING and 0 picker rows"
  - "Real-device sign-off (Task 4) deliberately deferred to /gsd-verify-work by explicit user decision at the checkpoint, per config.json's human_verify_mode: end-of-phase — not performed and not waived"
  - "08-14's RankDistributionTable.tsx typecheck regression (algorithm search param omitted on two Link calls) was routed back to 08-14 during this plan's execution and fixed there (da26713f), not fixed inline here, preserving this plan's own no-production-edit acceptance criterion"
  - "AccuracyTable.tsx's redundant outer overflow-x-auto wrapper (the real scroller is shadcn's inner [data-slot=table-container]) left unfixed per this plan's third prohibition against weakening/working around a sibling plan's surface; C1 evidence targets the real scrolling element directly and is logged as a still-open deferred item"

patterns-established:
  - "assertOverflowsY as the vertical-axis sibling to assertOverflows, for the first bounded-VERTICAL-inner-scroller case in this app"
  - "A backstop marker is discharged only by a case that measures an exact equality (78, 134, 135, 6, 0) against real bytes — never a lower-bound or a restated claim"

requirements-completed: [EVNT-07, COMP-01, EVAL-05]

coverage:
  - id: D1
    description: "S3 backstop — 78-team, 130-remaining-match rank table at 2023cur (corpus max), single shared axis, measured 6.03px slot pitch matching simAxis.ts's own cited figure, worst-case elapsed ~180-230ms"
    requirement: "EVNT-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/simulation-tab.spec.ts (S3 describe) — npx playwright test e2e/simulation-tab.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D2
    description: "S1 backstop — 134-row bounded picker at 2022oncmp with genuine internal vertical scroll (no page trap, no chain-out in either direction), plus the 2024wvrox offseason control (135 rows, 0 pmfs, unavailable state, 0 picker rows)"
    requirement: "EVNT-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/simulation-tab.spec.ts (S1 + control describes) — npx playwright test e2e/simulation-tab.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D3
    description: "S0 backstop — six-trigger tab strip: exact count/order, single-line-box labels (getClientRects), no clipped trigger, Simulation reachable after a full-right scroll"
    requirement: "EVNT-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/event-scroll-regions.spec.ts (E2 describe) — npx playwright test e2e/event-scroll-regions.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D4
    description: "Simulation tab joins the shared five-tab structural block as a sixth member (mutual no-nesting, no-page-pan, no-intermediate-scroller, vertical drag) behind a real run"
    requirement: "EVNT-07"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/event-scroll-regions.spec.ts (shared structural block, simulation tab) — npx playwright test e2e/event-scroll-regions.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D5
    description: "S2 backstop — both Worker failure modes (construction failure, mid-run throw) driven through the assembled tab, each asserting inline error + Retry + no progress bar + unpopulated table, plus recovery (healthy retry populates the table) and no-leaked-worker on unmount"
    requirement: "EVAL-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.failure.test.tsx — npx vitest run src/components/event/SimulationTab.failure.test.tsx"
        status: pass
    human_judgment: false
  - id: D6
    description: "C1 backstop — Compare accuracy table pans within its own scroll region at 390px; scrollWidth and header-cell count identical across Combined/Qualification/Elimination compLevel views"
    requirement: "COMP-01"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/compare-narrow-legibility.spec.ts (C1 describe) — npx playwright test e2e/compare-narrow-legibility.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D7
    description: "C3 backstop — calibration chart legend/axis-label legibility and sparse-bin radius scaling (non-zero, non-uniform, monotonic with bin count) at 390px, plain-language sentence demoted-in-font-size beneath the chart"
    requirement: "COMP-01"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/compare-narrow-legibility.spec.ts (C3 describe) — npx playwright test e2e/compare-narrow-legibility.spec.ts --project=local-phone-390"
        status: pass
    human_judgment: false
  - id: D8
    description: "Real-device sign-off across five areas (bounded picker, 78-row density, felt responsiveness during a run, six-tab strip, Compare page) on an actual iPhone and an actual Android"
    verification: []
    human_judgment: true
    rationale: "No synthesized CDP touch input in a desktop Chromium can stand in for real-hardware touch arbitration (06-RESEARCH.md Pitfall 6; touch-scroll.spec.ts's own header admission since Phase 5). This plan's blocking checkpoint reached this exact gate; by explicit user decision the sign-off is deferred to /gsd-verify-work's end-of-phase UAT pass (config.json human_verify_mode: end-of-phase) rather than performed or waived here."

duration: ~55min
completed: 2026-08-31
status: complete
---

# Phase 08 Plan 15: Backstop Evidence and Real-Device Checkpoint Summary

**All six of Phase 8's `verification: backstop` markers (S0, S1, S2, S3, C1, C3) now carry named, runnable, real-browser evidence against real published R2 bytes; the seventh item — real-device touch sign-off — is deliberately deferred to `/gsd-verify-work` by explicit user decision, not performed and not waived.**

## Performance

- **Duration:** ~55 min (across the checkpointed session and this closing pass)
- **Started:** 2026-08-31T21:18:39Z (first task commit)
- **Completed:** 2026-08-31 (this closing pass)
- **Tasks:** 3 of 4 executed (Task 4's real-device gate resolved by deferral, not by an on-device run)
- **Files modified:** 10 (6 created, 4 modified, including this plan's own deferred-items.md)

## Backstop Reconciliation: 6 == 6

| Marker | Owning plan | Evidence | Where |
|---|---|---|---|
| S0 | 08-09 | Six-trigger strip: exact count/order, single-line-box labels, no clipping, reachable after full-right scroll | `event-scroll-regions.spec.ts` (E2) |
| S1 | 08-11 | 134-row bounded picker at `2022oncmp`, both no-trap directions, plus `2024wvrox` control (135 rows, 0 pmfs, 0 picker rows) | `simulation-tab.spec.ts` |
| S2 | 08-13 | Both Worker failure modes + recovery + no-leaked-worker, driven through the assembled tab | `SimulationTab.failure.test.tsx` |
| S3 | 08-14 | 78-team/130-match rank table at `2023cur`, measured 6.03px slot pitch, printed elapsed ms | `simulation-tab.spec.ts` |
| C1 | 08-01/08-06 | Accuracy table pans in region; identical `scrollWidth`/header count across 3 compLevel views | `compare-narrow-legibility.spec.ts` |
| C3 | 08-10 | Legend/axis-label legibility, sparse-bin radius scaling, sentence-over-chart font demotion | `compare-narrow-legibility.spec.ts` |

Six markers, six named cases, zero silently dropped. The reconciliation is `6 == 6`.

## Measured Figures

- **S3 (`2023cur`, 78 teams, 130 remaining `qm` matches):** measured slot pitch **6.03px**, matching `simAxis.ts`'s own cited `PLOT_W / teamCount` figure exactly. Worst-case elapsed **~180–230ms** across repeated runs at both the 1440x900 (desktop) and 390x844 (phone) viewports — well under the generous PD-06 ceiling. This complements 08-13's representative-runtime SUMMARY capture (a typical event) rather than duplicating it; this is the largest event that exists.
- **S1 (`2022oncmp`, 134 picker rows):** panel `clientHeight` genuinely bounded at 320px; internal vertical scroll proven in BOTH no-trap directions (a drag inside the picker advances the picker's own `scrollTop` while the document's stays put; a drag outside advances the document's while the picker's stays put); computed `overscroll-behavior-y: contain` printed (not asserted, per PD-07's routing of felt-responsiveness judgments to the human checkpoint).
- **S1 control (`2024wvrox`, 135 rows, 0 pmfs):** renders 08-09's `SIMULATION_UNAVAILABLE_HEADING` verbatim, exactly 0 picker rows — confirms PD-01's retarget mechanism (TBA event type 99 deliberately absent from `EVENT_TYPE_TIERS`, so `sigma1` emits no pmf, so 08-09's `hasSimulatableRankInputs` predicate returns false) is live, not merely argued.
- **`event-scroll-regions.spec.ts`:** grew from **31 → 38 tests** (5 from the sixth `simulation` tab joining the shared five-test structural block, plus the new label-wrap/clipping/reachability measurements in E2). 38/38 passing after this plan's own extraction and additions.
- **`SimulationTab.test.tsx` (08-13's own suite):** unchanged at **37 tests** — the shared-fixture extraction into `simulationTestFixtures.ts` was behavior-preserving; this plan added a sibling file rather than editing 08-13's owned file.
- **Full web suite:** 1140/1140 passing. **Repo-wide:** 2646/2649 — the 3 non-passing are the 2 pre-existing accepted `payloadBudget.test.ts` failures (WINDOWS.md ledger #11/#15, unrelated to this plan) plus 1 skipped.

## PD-01's Retarget, Stated Plainly

The plan outline named `2024wvrox` (135 qualification rows, the corpus's raw maximum row count) as S1's target. Measurement corrected that: `2024wvrox` is TBA `event_type` 99 with `is_offseason: 1`, and `sigma1/index.ts` gates `redRpPmf`/`blueRpPmf` production on `isRpEligibleEventType`, whose `EVENT_TYPE_TIERS` table deliberately omits 99. That event therefore publishes no pmf on any row, and 08-09's `hasSimulatableRankInputs` renders the unavailable heading instead of a picker — the picker literally cannot render there. The real target became `2022oncmp` at 134 rows (RP-eligible, 67 teams) — one row short of the raw maximum, but the actual maximum the picker can ever be handed. The retarget moved UP (30 teams → 67 teams, a target that exists), not to something more convenient, and is held honest by shipping `2024wvrox` as a control in the same spec file asserting 0 picker rows.

## PD-04: Deployed-Origin Lifecycle

`event-scroll-regions.spec.ts` also runs on the `pixel-10` and `phone-390` deployed-origin projects against `https://sigmascout.org`. Its six-trigger E2 assertions are **expected to be red there** until Phase 8 reaches `main` and `.github/workflows/deploy.yml` publishes — this is the repo's own established convention for a spec committed ahead of its deploy (`table-layout-quality.spec.ts`'s header states the identical lifecycle), not a defect. This plan's own green run is the local one (`local-phone-390`, `local-desktop`), reading real published R2 bytes through `vite.config.ts`'s `preview.proxy['/v1']`. A post-merge red on `pixel-10`/`phone-390` for this spec should be read as expected, not as a regression, until deploy catches up.

## Task Commits

Each task was committed atomically (per the checkpointed prior session — verified present in `git log`):

1. **Task 1: The first real-browser pass through the whole Simulation stack, and S3's 78-team evidence at `2023cur`** — `e713e00b` (test)
2. **Task 2: S1's 134-row picker at `2022oncmp` with its offseason control, and S0's six-trigger strip** — `12eaa9f6` (test)
3. **Task 3: S2's forced Worker failure with recovery, and C1 and C3 at 390px** — `1a73baf9` (test)
4. **Task 4: Real-device sign-off** — resolved by deferral (see below), no code commit; this SUMMARY and the plan-metadata commit close the plan.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following)

## Files Created/Modified

- `apps/web/e2e/support/scrollRegions.ts` — `assertNoIntermediateScroller`, `assertOverflows`, `assertOverflowsY` (new), `assertNoPagePan`, `visibleMidpoint`, extracted verbatim from `event-scroll-regions.spec.ts` plus one new vertical-axis sibling
- `apps/web/e2e/support/simulation.ts` — `openSimulationTab`, `selectStartMatch`, `runSimulation`, `SIMULATION_TEST_IDS`, the one shared driver for a completed simulation run
- `apps/web/e2e/simulation-tab.spec.ts` — S3's 78-team evidence at `2023cur`, S1's 134-row picker evidence at `2022oncmp`, and the `2024wvrox` control
- `apps/web/e2e/compare-narrow-legibility.spec.ts` — C1's pan/re-render evidence and C3's legend/axis-label/sparse-bin evidence at 390px
- `apps/web/e2e/event-scroll-regions.spec.ts` — E2 grown to six triggers with wrap/clipping/reachability measurements; `simulation` joins the shared structural block
- `apps/web/playwright.config.ts` — `testMatch` widened for the two new local-origin specs
- `apps/web/src/components/event/SimulationTab.failure.test.tsx` — S2's four Worker-failure/recovery/no-leak cases
- `apps/web/src/components/event/simulationTestFixtures.ts` — shared fixture module extracted from 08-13's `SimulationTab.test.tsx` so no second, independently-drifting fixture was created
- `.planning/phases/08-simulation-compare/deferred-items.md` — logged (and, for item 1, resolved) two out-of-scope discoveries; see below

## Decisions Made

- PD-01 through PD-07 applied exactly as written in the plan (see plan frontmatter/body for each — the retarget, the shared-block joining, the helper extraction, the deployed-origin lifecycle, the bounded one-testid allowance (not needed — zero production components were modified), the printed-not-tightly-bounded performance ceiling, and the routing of felt-responsiveness to the human checkpoint).
- Real-device sign-off deliberately deferred to `/gsd-verify-work` by explicit user decision at the checkpoint (see "Checkpoint Resolution" below) rather than performed now or silently waived.

## Deviations from Plan

### Auto-fixed / Routed Issues

**1. [Routed to 08-14, now RESOLVED] `RankDistributionTable.tsx` typecheck regression**
- **Found during:** Task 1, running this plan's own required `npx tsc --noEmit -p tsconfig.json` pass.
- **Issue:** Both Team #/Nickname `Link` calls in `RankDistributionTable.tsx` (08-14) omitted the `algorithm` search param `TeamSearchSchema` requires. Confirmed pre-existing (not caused by 08-15) via `git stash` against the unmodified `HEAD` at `b9b00e68`.
- **Fix:** Routed back to 08-14 (not fixed inline here — `RankDistributionTable.tsx` is not in 08-15's declared `files_modified`, and this plan's own acceptance criteria require zero modified production components or exactly one PD-05 testid addition). 08-14 fixed it in `da26713f`, threading the real `algorithmId` through props, matching `InsightsTab`/`BreakdownTab`'s existing cast pattern. `08-14-SUMMARY.md` (`cc6760ec`) records the durable scope-trap lesson.
- **Durable lesson, stated plainly:** the repo-root `pnpm typecheck` runs `tsc --noEmit` at the root and does **NOT** cover `apps/web`, which has its own tsconfig and typecheck script. A green root typecheck is **not** evidence that the web app typechecks. The authoritative command for web code is `pnpm --filter web typecheck`. This hid a real regression across three consecutive wave gates. Orchestrator independently re-verified after the fix: web typecheck exit 0, root typecheck exit 0.
- **Files modified:** `apps/web/src/components/event/RankDistributionTable.tsx` (by 08-14, not by this plan)
- **Committed in:** `da26713f` (08-14's own commit)

**2. [Remains open] `AccuracyTable.tsx`'s redundant scroll wrapper**
- **Found during:** Task 3, running this plan's own required C1 evidence.
- **Issue:** `AccuracyTable.tsx` (08-01/08-06) wraps shadcn's `<Table>` primitive — which already renders its own `[data-slot="table-container"]` div carrying `overflow-x-auto` — inside a SECOND, outer `overflow-x-auto` div carrying `data-testid="compare-accuracy-scroll"`. The outer, testid'd div never itself overflows (measured live: `scrollWidth === clientWidth === 342`); the inner shadcn-provided div is the real scroll boundary (measured: `scrollWidth: 929` against the same `342` `clientWidth`, and a real CDP touch drag advances the inner div's `scrollLeft` to `287`). Every other table-scroll region in this app (Insights, Breakdown, Quals, Alliances, Elims, the rank-distribution table) builds its own scroll-region div directly around a raw `<table>`, so their testid'd `*-table-scroll` divs ARE the literal scroller; `AccuracyTable.tsx` is the one exception.
- **User-facing impact:** none observed — a real touch/drag gesture naturally lands on whichever element actually has overflow, so the table still visibly pans under a real finger. The defect is purely that the testid does not identify the literal scrolling element.
- **Why not fixed here:** `AccuracyTable.tsx` is not in 08-15's declared `files_modified` (it is 08-01/08-06's file), and this plan's own third prohibition forbids weakening or working around a sibling plan's surface to make this plan's own evidence pass. C1's evidence was produced by correctly targeting the REAL scrolling element (`[data-slot="table-container"]`, scoped inside `compare-accuracy-scroll`) — the same overflow/no-pan/no-intermediate-scroller claims, against the DOM node that actually implements them, not a weaker assertion.
- **Recommended follow-up:** logged in `deferred-items.md`, remains open. Either remove `AccuracyTable.tsx`'s own redundant wrapper and move the testid onto shadcn's rendered container, or move the testid directly onto `[data-slot="table-container"]`.
- **Files modified:** none (deliberately left as-is)
- **Status:** open, tracked in `.planning/phases/08-simulation-compare/deferred-items.md`

---

**Total deviations:** 2 routed/logged (1 resolved by the routed-to plan, 1 remains open by design per this plan's own prohibition against fixing a sibling's surface to pass its own evidence).
**Impact on plan:** Neither required weakening any of this plan's own assertions; both are named honestly rather than smoothed over.

## Issues Encountered

None beyond the two items above.

## Checkpoint Resolution: Real-Device Sign-Off Deferred

**Task 4 was a blocking `checkpoint:human-verify` requiring an actual iPhone and an actual Android.** This plan's own acceptance criteria required the SUMMARY to record all five real-device verdicts in the human's own words, naming the device/OS for each. **That did not happen.**

**User decision:** defer real-device sign-off to `/gsd-verify-work`. The project's `config.json` sets `human_verify_mode: "end-of-phase"`, built for exactly this. The user chose to seal 08-15 now on the automated evidence above plus this explicit outstanding-item record, let phase verification run, and have the five device checks persisted as UAT items for `/gsd-verify-work` to walk.

**One sentence required by this plan's own acceptance criteria, regardless of the deferral:** the automated gesture evidence in this plan is synthesized CDP touch input (`Input.dispatchTouchEvent`) dispatched into a desktop Chromium wearing a phone viewport, and is **not** proof of real-hardware touch behavior.

`apps/web/test-results/` screenshots from the automated runs are an aid for the human's later pass — never the answer.

### The five checks — status: PENDING, preserved in full for `/gsd-verify-work`

1. **Bounded picker.** `/event/2022oncmp?algorithm=vpr&tab=simulation` — 134 rows in a ~320px panel. Check: page scrolls normally from outside the panel; the list scrolls and the page stays put from inside; boundary behavior at the list's bottom is clean (no jump, no leaking rubber-band, no self-bounce); flick momentum doesn't fight tapping; a row two-thirds down selects cleanly on first tap.
2. **78-row density.** `/event/2023cur?algorithm=vpr&tab=simulation`, first match, Run, scroll all 78 rows. Check: each row still reads as its own distribution (compare against `/team/118?year=2024&algorithm=vpr`); find a two-humped row (report if none found — that is itself a finding); sideways drag keeps pinned Team#/Nickname columns opaque; no `±` glyph appears in the band-label column.
3. **Felt responsiveness during a run.** Press Run, immediately try to scroll the page while the progress bar fills. Check: page keeps scrolling; report any hitch/freeze/stall with device and event.
4. **Six-tab strip.** Any event page at phone width. Check: drag moves only the strip; `Simulation` is reachable at the right end; no label wraps to a second line; switching algorithm to OPR makes Simulation go dead with no explanation (deliberate, D-04/Phase 7 D-17) — confirm it reads as intentional, not broken.
5. **Compare page.** `/compare` at phone width. Check: accuracy table pans without moving the page; switching Combined/Qualification/Elimination causes no sideways jump; calibration chart axis labels are readable, series distinguishable, smallest dots still visible.

**How to reach a real device (unchanged from the plan):** from `apps/web`, `pnpm build && pnpm preview`, open `http://localhost:4173` from a phone on the same LAN (use the LAN address, not `localhost`) — or, once merged to `main` and deployed, use `https://sigmascout.org`. Do not substitute desktop device-emulation mode; that is exactly what the automated evidence already covers.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 8 (simulation-compare) is functionally and structurally complete: all 15 plans executed, all six phase-authored `verification: backstop` markers have named runnable evidence, and the automated suite is fully green (1140/1140 web, 2646/2649 repo-wide with 2 pre-existing accepted exceptions unrelated to this phase). **The one outstanding item blocking a full close-out is the deferred five-area real-device sign-off**, which `/gsd-verify-work`'s end-of-phase UAT pass must walk before the milestone can be considered fully verified. One further open (non-blocking) item — `AccuracyTable.tsx`'s redundant scroll wrapper — is logged in `deferred-items.md` for a future small fix.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
