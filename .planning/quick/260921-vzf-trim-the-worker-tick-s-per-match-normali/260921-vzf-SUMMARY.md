---
phase: quick
plan: 01
subsystem: worker
tags: [worker-tick, cpu-budget, normalize, probe-arm, output-identical]
status: complete
completed: 2026-09-21
commits: [0fdef5fd, 2e938c3d, df4e36f0]
key-files:
  created:
    - apps/worker/src/matchSplit.ts
    - apps/worker/test/matchSplit.test.ts
  modified:
    - packages/ingest/normalize.ts
    - packages/ingest/normalize.test.ts
    - apps/worker/src/stateStore.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/src/artifactMerge.ts
    - apps/worker/src/stateProbe.ts
    - apps/worker/test/stateProbe.test.ts
    - docs/worker-operations.md
    - .planning/todos/pending/tick-normalizes-every-match-every-tick.md
    - .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
---

# Quick Task 260921-vzf: Trim the tick's per-match normalization

Second task from the 2026-09-21 tick inventory (see 260921-q2s). On every tick where TBA returns a
200, `processEvent` ran the full `normalizeMatch` over every match at the event, which
`JSON.stringify`s every `score_breakdown`, including matches folded hours earlier. Only matches past
the cursor and the upcoming schedule rows are used downstream.

## What shipped

- `packages/ingest/normalize.ts`: `matchOrderFacts` returns the ordering fields (key, comp level,
  set and match number, sort time, played) from raw scalars and the two scores only. The
  equivalence `normalizeMatch(m).winner !== null` iff `isPlayed(m)` that the split rests on has its
  own test.
- `apps/worker/src/stateStore.ts`: `foldedCutoffIndex` finds the cursor anchor once.
  `hasAlreadyFolded` is redefined on it, ending the two `indexOf` scans per played match (O(n²)).
- `apps/worker/src/matchSplit.ts`: `splitEventMatches` orders on the cheap facts, then runs
  `normalizeMatch` only on played matches after the cutoff and projects unplayed ones onto the six
  schedule fields. `splitEventMatchesNormalizeAll` keeps the old behaviour with no production caller;
  it is both the identity oracle in tests and the probe's baseline arm.
- `scheduled.ts`: one call replaces the normalize-sort-filter block. Phase B's `stillUpcoming` type
  narrows to `ScheduledMatchFacts[]`, so the compiler proves nothing downstream reads a trimmed
  field. No call site needed one.
- Probe arm `normalize=all|trim` in `stateProbe.ts`, routed before discovery with no D1 access,
  synthesizing a size-matched list (2,880 bytes per played match, 194 KB at 100 matches), reporting
  counters and an `identityFingerprint` so a live pass self-verifies identity. Unrecognized arm
  values are refused, not defaulted.
- The bar is pre-registered in the normalize todo as a within-run arm difference
  (`perTick = (mean all - mean trim) / rounds`), never an absolute cpuTime. WORKED at
  `perTick >= 1.5 ms` with a CI excluding zero; DID NOT WORK below 0.5 ms or CI including zero, in
  which case the change is kept anyway on its non-CPU merits and the line is closed.

## Zod parse not narrowed

`score_breakdown` is already `z.unknown()`, so the parse never walked the breakdown; every other
field it validates is read by the fold, the sort or a published row. Written into the todo so it is
not reopened.

## Verification (by printed output)

- `npx vitest run apps/worker` from repo root: 20 files, 468 tests passed (442 before the probe arm).
- Repo root full suite: 264 files, 5945 passed, 1 pre-existing skip.
- `matchSplit.test.ts`: 30 passed; `normalize.test.ts`: 54 passed; `stateProbe.test.ts`: 169 passed.
- `tsc --noEmit` in apps/worker, at root, and for apps/web: all clean.
- `scheduled.rowParity`, `scheduled.rp`, `scheduled.replay` pass unmodified.
- `git diff --stat 6258e5d6..HEAD -- packages/core apps/web` is empty. No version bump, no republish.

## Deviations

1. `cd apps/worker && npx vitest run` fails at startup on this repo (root `vitest.config.ts`
   `projects` resolve against cwd). Pre-existing; substituted `npx vitest run apps/worker` from the
   root. Worth its own quick task.
2. `buildEventScheduledRow` in `artifactMerge.ts` was exported so the identity test can assert
   upcoming rows through it. No behaviour change.
3. The executor used `git stash` once to prove deviation 1 was pre-existing; the other session's
   `stash@{0}` and working tree were verified intact.
4. `hasAlreadyFolded` keeps its null-cursor short-circuit ahead of the presence check; folding it
   into `foldedCutoffIndex` would have turned a `false` into a throw for a key absent from the list.

## Measurement

Not run by the executor (no network). Run from the main context; see the todo for the rig, the
gates and the verdict split. Result recorded in the todo when taken.
