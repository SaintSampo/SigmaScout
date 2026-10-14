---
phase: quick-261014-j4i
plan: 01
subsystem: champ-locks
tags: [champ-locks, as-of, dcmp-bake, live-position]
requirements: [champ-locks-now-dcmp-bake]
status: complete
key-files:
  created: []
  modified:
    - apps/web/src/components/districts/asOfRewind.ts
    - apps/web/src/components/districts/useAsOfRewind.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts (comments only)
    - apps/web/src/components/districts/champLedgerChances.ts (comments only)
    - apps/web/src/components/districts/useSimulatedDcmpBake.ts (comments only)
    - .planning/todos/completed/champ-locks-now-dcmp-bake.md (moved from pending)
actuals:
  tasks: 3
  commits: 3
---

# Quick Task 261014-j4i: Champ Locks bakes the DCMP at Now

At Now, before a District Championship starts, the Champ Locks tab now bakes the championship over the Locked plus In range field, the same as a rewound stop does. The as-of state comes from a championship only load cut at the latest fold any district team has played. The Live district events are untouched.

Worked on branch `quick/261014-j4i` in the sibling worktree `../SigmaScout-j4i`, because the concurrent task 261014-i8i held uncommitted edits to the same files in the shared checkout.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 156fed59 | feat(quick-261014-j4i): bake the DCMP at Now from a championship only as-of load |
| 2 | 9eb559da | feat(quick-261014-j4i): a registered team with no priced championship row reads the Now bake |
| 3 | fe8c1caa | docs(quick-261014-j4i): methodology and module notes for the Now championship bake |

## What was built

- **asOfRewind.ts:** new `asOfLatestTailCut(season, teamKeys)` and `asOfNowChampionshipApplies(...)`. With `cutAtLatestTailOf`, `loadAsOfRewind` cuts at the latest season tail among the listed teams and skips `resolveStopCut`. The default path is unchanged.
- **useAsOfRewind.ts:** the `cutAtLatestTailOf` option. In that mode the anchor key segment is the constant `latest-tail:<n>`, so a live refetch moves only the fingerprint and the shipped placeholder keeps the plan standing.
- **ChampLocksLedger.tsx:** a second `useAsOfRewind` call, `nowChampionshipAsOf`, for the first championship only, enabled at Now when a championship key exists, none has started and the season is priceable. `dcmpAsOf = atNow ? nowChampionshipAsOf : asOf` feeds the bake. `useDistrictLedgerData` still receives the rewound `asOf`, which is undefined at Now.
- **champLedgerRows.ts:** a team registered at the championship whose own row is not priced reads the bake when the bake holds a record for it or is pending. Otherwise it keeps the estimate, so a registered team never reads "out of range" or the em dash. Case order in `buildDcmpRow` is unchanged.
- **Methodology and comments:** two paragraphs rewritten; module notes updated.

## Why the Now load needs its own cut (planning finding)

At Now the tab fetches only the events in progress. The Now rail therefore holds no anchor for any finished event, and `resolveStopCut` at `nowIndex` walks back to season start whenever no district event is live. A test pins that. The latest season tail among the district's teams is each team's own latest state.

## Test and typecheck results (read from the output)

- Executor, full `npx vitest run` from the worktree root: 352 files passed, 11 skipped; 8751 tests passed, 143 skipped, 0 failed.
- Orchestrator re-run, districts plus methodology plus `scripts/asOfRewindWeb.test.ts`: 34 files passed, 1 skipped; 1290 tests passed, 3 skipped, 0 failed.
- `tsc --noEmit` for `-p .`, `-p apps/web/tsconfig.json` and `-p apps/web/tsconfig.e2e.json`: clean (orchestrator re-run).
- `git diff ae078839` over ledgerSimulation.ts, hypotheticalDcmp.ts, measureChampCutoff.ts, districtRunAssembly.ts, districtAsOfJob.ts and useDistrictLedgerData.ts: empty.
- RED was seen before GREEN for every new behavior test. Test 3 was proven RED by temporarily restoring the pre Task 2 champLedgerRows.ts.
- The Live per event Worker request at Now is deep equal with and without the Now load, and carries no as-of block (ChampLocksLedger.test.tsx Test 2).

## What the reader sees each minute during a live district event

When the live event's artifact changes, the Live per event run re-runs exactly as before, and the district cells and chips read pending until the district line settles. The simulated field depends on that line, so the DCMP cells of every team not Locked out read pending for the same window. The bake then re-posts (one DCMP sized generated event, a few seconds) and the champ run lands. The Now championship load keeps its previous plan standing across the refresh, so it adds no pending window of its own. Between event weeks the load and the bake run once per page load.

## Not visible on the live site yet

Every 2026 championship has started and 2027 is not in `AS_OF_PRICEABLE_SEASONS`, so the change is inert on published data until the 2027 registration window. The component tests are the evidence; no visual check was possible.

## Where the estimate and "not yet priced" survive at Now

- A district whose championship is on no row of the artifact (todo known limit 1, still open). No as-of object is fetched there; a test pins it.
- A season the as-of pricer cannot price.
- A registered team outside the simulated field whose own championship row is not published.

Both known limits in the todo (no championship key; a divisioned or two championship district simulated as one event) are still open.

## Deviations from Plan

1. **Methodology live view paragraph reworded to three sentences.** The plan's verbatim text had four, and the shipped voice test caps paragraphs at three. Every required phrase is kept, the opening and position are unchanged, and the new test pins the final wording. The first sentence runs long; Jacob may want to edit it.
2. **Generated route tree.** The fresh worktree lacked the gitignored `apps/web/src/routeTree.gen.ts`, so the web typecheck failed on routes. The executor generated it with a local `vite build` to a scratch outDir. Nothing committed.
3. Two extra comment only touches: the `CHAMP_LEDGER_OUT_OF_RANGE_LINE` doc and the champ run signature comment in ChampLocksLedger.tsx.

No existing assertion was edited or loosened.

## Merge with 261014-i8i

`git merge-tree` against main at 27b453de: clean. A three way `git merge-file` of ChampLocksLedger.tsx, useSimulatedDcmpBake.ts and champLedgerRows.test.ts against i8i's uncommitted working copies: zero conflicts. The only code line this branch changes at the bake call is `asOf,` to `asOf: dcmpAsOf,`; i8i adds `stageByEvent` three lines below it. At Now that `stageByEvent` is the Now stage map, which is the right input for i8i's award slate.

The merge cannot run while i8i's edits are uncommitted in the shared checkout (git refuses to overwrite local changes). The STATE.md quick task row is left for merge time, so the branch does not conflict with rows other sessions append meanwhile.

## Self-Check: PASSED

- Commits 156fed59, 9eb559da and fe8c1caa are on `quick/261014-j4i`.
- The shared checkout was never written to.
