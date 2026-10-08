---
phase: quick-261007-mxf
plan: 01
subsystem: web / districts (Champ Locks tab)
tags: [champ-locks, dcmp, as-of-rewind, web-worker, hide-rule, methodology]
status: complete
requires:
  - 261005-5g0 as-of rewind (planAsOfEvent GENERATED mode, runAsOfEvent)
  - 261007-4qr pending convention
  - 260927-6bf field rank estimate (kept for Now)
provides:
  - useSimulatedDcmpBake (second Worker request, one generated DCMP over the Locked plus In range field)
  - assembleSimulatedDcmpBake and simulatedDcmpBakeView (districtRunAssembly.ts)
  - dcmpSimulatedField, simulatedDcmpState, champRangeState simulatedDcmp arm (champLedgerChances.ts)
  - outOfRange cell kind, simulatedDcmp option, champTeamHiddenAtDcmp (champLedgerRows.ts)
  - CHAMP_LEDGER_OUT_OF_RANGE_CELL and CHAMP_LEDGER_OUT_OF_RANGE_LINE
affects:
  - Champ Locks tab at every rewound stop before a DCMP starts, at a DCMP's Schedule stop, and at Now after a DCMP starts
tech-stack:
  added: []
  patterns:
    - a second useDistrictSimulationRun instance for a request whose roster depends on the first run's output
    - structural param types in districtRunAssembly.ts so the node typecheck never pulls React or the DOM Worker
key-files:
  created:
    - apps/web/src/components/districts/useSimulatedDcmpBake.ts
    - .planning/todos/pending/champ-locks-now-dcmp-bake.md (written, NOT committed: left for the orchestrator)
  modified:
    - apps/web/src/components/districts/asOfRewind.ts
    - apps/web/src/components/districts/useAsOfRewind.ts
    - apps/web/src/components/districts/districtRunAssembly.ts
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerChances.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/districts/asOfRewind.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts
    - apps/web/src/components/districts/champLedgerChances.test.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
decisions:
  - "The DCMP bake is a SECOND Worker request posted only after the district line settles; the main per event run keeps skipping the unstarted championship, so its requests and signature are unchanged"
  - "A Declined status is treated like Locked out by dcmpSimulatedField (never arises at a rewound stop, where the championship field overlay is not applied)"
  - "districtRunAssembly.ts takes structural types for the as-of view and the run state instead of importing them from the hook modules, because scripts/asOfRewindWeb.test.ts pulls the module into the root node typecheck"
  - "The todo file under .planning/ was written but not committed, per the orchestrator's rule that .planning files are committed by the orchestrator"
metrics:
  duration: ~45 min
  completed: 2026-10-07
actuals:
  tokens: 21500
  tasks: 3
  commits: 3
---

# Quick Task 261007-mxf: Champ Locks hide rule and the Locked plus In range DCMP bake Summary

At rewound stops before any District Championship starts, the Champ Locks tab now bakes the DCMP once in the Web Worker over the teams the District Locks tab shows as Locked, Prequalified or In range, at the stop's as-of state. That bake is a second request, so the main run is untouched. Teams outside that field read "out of range" or the em dash, with a labelled district only total that never suppresses the champ run. Once the DCMP is the selected event, teams with no dcmp-tier row leave the table but are still counted.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 24c11689 | feat(261007-mxf): bake the DCMP over the Locked and In range field at rewound stops |
| 2 | 27fc0b54 | feat(261007-mxf): hide teams not registered at the DCMP once it is the selected event |
| 3 | b5792441 | docs(261007-mxf): methodology for the rewound DCMP simulation, module headers, Now position todo |

## What was built

**Task 1 (tracer).**
- `planAsOfEvent` takes an optional `rosterOverride` (GENERATED branch only, sorted and de-duplicated). `loadAsOfRewind` passes `candidate.roster`.
- The tab attaches every district team to `dcmpEventKeys[0]`, so the same as-of load resolves every team at the cut.
- `useAsOfRewind` appends one roster-size segment at the END of its query key, so `FINGERPRINT_KEY_INDEX` stays 5.
- `districtRunAssembly.ts` factors the GENERATED request into `generatedRequest`. A roster that is empty or longer than `MAX_DISTRICT_SIMULATION_ROSTER` now reads unavailable instead of failing the whole Worker request.
- New exports there: `assembleSimulatedDcmpBake` and `simulatedDcmpBakeView`.
- `useSimulatedDcmpBake` posts the one generated event through its own `useDistrictSimulationRun`.
- `buildChampLedgerRows` takes `simulatedDcmp` with `{ field, bake }`, and `buildDcmpRow` has five cases. Case 3 is new: em dash, out of range, pending, not available, or four baked open cells plus an open Subtotal, with the win chance from the Playoffs mass at the winner value.
- In the grand total, `districtOnly` is split into `unpriced` (the only case that joins `teamsWithDistrictOnlyGrandTotal`) and `outsideSimulatedField`.
- `dcmpSimulatedField` and `simulatedDcmpState` are new, and `champRangeState` gains a `simulatedDcmp` arm.
- In the tab:
  - `districtShown` is computed on the District Locks tab's own recipe.
  - The champ run signature is null until the bake is ready, then carries `#<bake signature>`.
  - The progress bar falls back to indeterminate while the bake is pending.
  - `ChampCell` renders `out-of-range`.
  - `SourceCell` prints "outside the simulated field".

**Task 2.**
- `champTeamHiddenAtDcmp(team, dcmpSelected)` is true only when the DCMP is selected and the team's DCMP row has no source.
- In the tab, `startedDcmpEventKeys` now also counts a DCMP at its own Schedule stop (`asOfScheduleStopEventKey(search.at)`).
- `visibleTeams` drops hidden teams before the search and the status filter. `rows.teams` is untouched, so the chips, the champ run, the cutoff and the gaps still count those teams.

**Task 3.** Methodology copy, module header prose in five files, and the Now position todo.

## Final methodology wording (apps/web/src/components/methodology/districtLedgerContent.ts, section how-district-points-work; Jacob may edit it there)

1. "The Champ Locks tab predicts each team's finish in the race for the district's FIRST Championship slots, adding the District Championship's own four categories to the district season total. Only the grand total folds in the chance of being there."
2. "At a rewound point before the District Championship starts, the championship is simulated with a field made of the teams that are Locked or In range at that point. A team outside that field reads out of range in the championship row, and its grand total counts district points only."
3. "On the live view, until the championship field is set, a team's championship points are estimated from how teams at the same place in past championship fields scored, using only seasons before the one shown, and the four championship categories read not yet priced. Once the District Championship has started, its own prediction is used and teams not registered at it are left out of the table. A season with no earlier season to learn from shows the district season alone until the field is set."

The text is the plan's proposal, verbatim.

## Test and typecheck results (counts read from the output, all from the repo root)

- Task 1 pure set (asOfRewind, useDistrictLedgerData.asOf, useAsOfRewind, champLedgerChances, champLedgerRows, districtLedgerCopy, scripts/asOfRewindWeb): 7 files, 216 tests passed.
- Task 1, ChampLocksLedger.test.tsx: 28 passed. The ~858 drawer test and every Now test passed unedited, and the ~905 test was rewritten.
- Task 2, champLedgerRows.test.ts plus ChampLocksLedger.test.tsx: 2 files, 96 passed (ChampLocksLedger now 30).
- Task 3, methodology folder plus methodology.district-points route test plus districtLedgerCopy: 7 files, 144 passed.
- All of apps/web/src/components/districts plus scripts/asOfRewindWeb.test.ts: 29 files, 823 passed.
- Full repo `npx vitest run`: 344 files, 7981 passed, 1 skipped (that skip predates this task).
- Typechecks were clean after every task: `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json`.

The Schedule stop component test uses the real alias (`at=2026pncmp:schedule` with both event artifacts served), not the pure fallback. It discriminates: with the `|| key === scheduleStopEventKey` change removed it fails, and with the change it passes.

## Deviations from Plan

**1. [Rule 3 - Blocking] Structural types in districtRunAssembly.ts.**
- **Found during:** Task 1.
- **Issue:** Importing `AsOfRewindView` and `DistrictSimulationRunState` as types from the hook modules pulled React and the DOM `Worker` into the root `tsc -p .` program. `scripts/asOfRewindWeb.test.ts` imports `districtRunAssembly.ts`, and the root program failed with 9 errors.
- **Fix:** `SimulatedDcmpBakeViewParams` declares the two inputs structurally, and only as far as the view reads them. The hooks' real types are assignable to it.
- **Files:** districtRunAssembly.ts. **Commit:** 24c11689.

**2. [Scope] The todo file is not committed.**
- The plan puts `.planning/todos/pending/champ-locks-now-dcmp-bake.md` in Commit C. The orchestrator's constraint forbids committing `.planning/` files.
- The file is written and left untracked for the orchestrator to commit.

**3. Schedule stop test wait condition.**
- The first wait accepted any open or pending DCMP cell. It passed in the instant before the stop's run landed, while the row still read the estimate (the 261007-4qr pending window the plan names).
- The test now waits for ROSTER[0]'s `dcmp-row:qual` to read open, which is the REAL plan priced as a fact.
- **Commit:** 27fc0b54.

**4. Declined counts as Locked out in dcmpSimulatedField.**
- The plan's rules name only the district statuses. `declined` only comes from the championship field overlay at Live after a DCMP starts, which never coexists with the bake.
- It is mapped to the Locked out set, the em dash, for safety. It is documented in the function's doc.

## TDD Gate Compliance

The plan marks Tasks 1 and 2 as `tdd="true"`, but each task's commit was specified as a single code plus tests commit (Commits A and B). So there are no separate `test(...)` RED commits. RED was observed in two places:
- **Task 1:** the shipped ~905 component test failed against the new code ("expected 0 not-yet-priced, got 13") before it was rewritten for the bake.
- **Task 2:** the two finished-district tests failed exactly as the plan predicted before they were updated. The Schedule stop test was shown to fail with the Task 2 change reverted.

## Known Stubs

None. Every new reading is wired to real data: the bake, the field and the as-of load.

## Threat model

- **T-mxf-01, mitigated:** a roster longer than `MAX_DISTRICT_SIMULATION_ROSTER`, or an empty one, reads unavailable before posting, in both `assembleSimulatedDcmpBake` and the shared `generatedRequest`. Both cases are pinned by tests.
- **T-mxf-02, mitigated:** the field comes from the stop's shown verdicts and the tuples from the stop's own as-of load. The real DCMP roster is never read at a rewound stop before the championship starts. A champLedgerRows test supplies a priced real roster and an estimate beside the bake, and asserts that neither reaches a row.

## Known limits (recorded in the todo)

1. A district whose championship is not on the artifact yet (the live season before registrations) keeps the estimate at rewound stops, because there is no event key to plan the bake under.
2. A divisioned championship (FIM) or a two-championship district (2026 California) is simulated as ONE eight alliance event over the whole field. Alliance and playoff points therefore come from one bracket. A per division simulation needs a division assignment rule.

## Needs human verification

Not run here: it needs a browser and a dev server with network access. Steps, on a local preview (project memory "Local visual verification recipe"):

1. Kill any stale :4173 listener. Build and preview with `VITE_ARTIFACT_ORIGIN` pointed at the local preview per the recipe, and confirm the server by content.
2. Open the Districts page for 2026 Michigan, Champ Locks tab, and pick a week 2 stop in the milestone picker (`?at=` a week 2 event's stop).
3. Expect:
   - In-field teams (Locked, Prequalified, In range) show four numeric DCMP cells and an open DCMP Subtotal.
   - Out of range teams read "out of range" in all five DCMP cells, with "outside the simulated field" under the row label and "district only" under the grand total.
   - Locked out teams read the em dash and "not in the field".
   - The stat line prints a simulated cutoff with its likely range.
4. Time from picking the stop to a settled table. Compare with the 3.7 to 8.0 s that 261005-5g0 measured; the bake adds one generated event.
5. Pick the Michigan DCMP's Schedule stop and confirm that teams not registered at the DCMP are absent while the status chip counts still include them.
6. At Now (any district before its DCMP), confirm the shipped reading is unchanged: "not yet priced" category cells and an estimated Subtotal.

## Self-Check: PASSED

- FOUND: apps/web/src/components/districts/useSimulatedDcmpBake.ts
- FOUND: .planning/todos/pending/champ-locks-now-dcmp-bake.md
- FOUND commits: 24c11689, 27fc0b54, b5792441 (git log --oneline -4)
