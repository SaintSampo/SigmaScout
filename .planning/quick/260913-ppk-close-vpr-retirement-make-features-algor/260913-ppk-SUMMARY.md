---
phase: quick-260913-ppk
plan: 01
subsystem: docs
tags: [worker-operations, todo-closure, spr, live-folding]
status: complete
dependency_graph:
  requires: []
  provides: ["closed todo: vpr-retirement-make-features-algorithm-agnostic"]
  affects: ["docs/worker-operations.md", "apps/worker/wrangler.toml", "packages/harness/publishedAlgorithms.ts", "apps/web/src/components/ribbon/AlgorithmSelect.tsx"]
key_files:
  created: [".planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md"]
  modified: ["docs/worker-operations.md", "apps/worker/wrangler.toml", "packages/harness/publishedAlgorithms.ts", "apps/web/src/components/ribbon/AlgorithmSelect.tsx"]
  deleted: [".planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md"]
decisions:
  - "SPR stays the only algorithm that folds live, permanently (Jacob, 2026-09-13). OPR and EPA refresh only at republish."
completed: 2026-09-13
commits: [ee06b14d, 076d59fb]
---

# Quick Task 260913-ppk: close the algorithm-agnostic todo, SPR-only live folding is permanent

The pending todo `vpr-retirement-make-features-algorithm-agnostic` is closed. Its 09-13 note had
already recorded step 4 (retire VPR) as done and sections 2-3 (ranking points for every algorithm)
as superseded; the one open item was section 1, live updates for every algorithm. Jacob decided
(decision prompt, 2026-09-13) not to build it: SPR stays the only live-folding algorithm
permanently, OPR and EPA keep refreshing at republish. No Worker behavior change, no deploy, no D1
or R2 touch, `LIVE_ALGORITHM_IDS` stays `"spr"`, no follow-up todo.

## Why (recorded in the closed todo)

1. **CPU budget.** The Worker cannot sustain even SPR alone yet: the PRE-SEASON GATE and
   `rp-fold-exceeds-worker-cpu-budget` record 13 ms p50 / 28 ms p90 for a realistic mid-quals tick
   in Phase A alone against a 10 ms sustained budget. Re-checked at execution time; unchanged.
2. **The todo's rotation design was wrong about the cursor.** `event_cursor` is one row per event
   with no per-algorithm granularity, and the TBA ETag is shared the same way, so an algorithm left
   out of a tick's rotation would have that tick's matches skipped forever. 260822-wqt had already
   chosen a single-algorithm tier over per-algorithm cursors.
3. **Subrequests.** `estimateEventSubrequestCost(3, 6)` = 50 against ~41 usable.
4. **No live event** to measure a real fold against before the 2027 season.

The closure block also states the corrected premise for any reopening: a per-algorithm cursor plus
an ETag bypass while any algorithm lags, still behind the CPU gate.

## Commits

**Task 1, `ee06b14d`** `docs(260913-ppk): close the algorithm-agnostic todo, SPR stays the only live-folding algorithm`

```
40  0   .planning/todos/{pending => completed}/vpr-retirement-make-features-algorithm-agnostic.md
```

Frontmatter gains `resolved_date`/`resolved_by`; the RESOLVED block is appended; original body
untouched (0 deleted lines).

**Task 2, `076d59fb`** `docs(260913-ppk): SPR is the only live-folding algorithm in ops docs and comments`

```
1   1   apps/web/src/components/ribbon/AlgorithmSelect.tsx
2   2   apps/worker/wrangler.toml
8   1   docs/worker-operations.md
10  10  packages/harness/publishedAlgorithms.ts
```

- `docs/worker-operations.md`: "Live folding tier" gains a paragraph stating SPR-only is permanent,
  with the why and a pointer to the completed todo; the troubleshooting row names `spr`.
- `apps/worker/wrangler.toml`: two comment lines name SPR and the opr/epa/spr published set. The
  `LIVE_ALGORITHM_IDS = "spr"` line and every non-comment line are unchanged.
- `packages/harness/publishedAlgorithms.ts`: the stale "two capabilities leave with it, neither is
  replaced yet" paragraph now says ranking points and the simulation came back SPR-only
  (`094667e9`, `bcc929cb`) and points at the completed todo.
- `apps/web/src/components/ribbon/AlgorithmSelect.tsx`: freshness comment names SPR.
- `apps/worker/src/scheduled.ts` deliberately not edited (its comment is dated history).

## Verification

- Stale-claim gate over the commit, excluding `.planning`: empty. Re-run by the orchestrator over
  HEAD: empty.
- `wrangler.toml` non-comment diff: empty. `LIVE_ALGORITHM_IDS = "spr"` count: 1.
- `npx vitest run apps/worker/test/liveAlgorithmTier.test.ts packages/harness/manifests.test.ts packages/harness/browserSafeSchemas.test.ts`
  from the repo root: `Test Files 3 passed (3)`, `Tests 55 passed (55)` (read from output).

## Concurrency

Other sessions committed to `main` throughout (HEAD moved `bad2d52f` -> `334fff54` during planning,
`973355f6` -> `8c109d9e` before Task 1). Both commits were built in a private `GIT_INDEX_FILE`
seeded from HEAD and landed with a compare-and-swap `git update-ref`; neither CAS failed. No
foreign hunk was present on any touched path at staging time, so every blob came from the working
tree. The before/after status snapshots show no foreign staged or unstaged work absorbed, and
`git show --stat` of each commit lists only this task's paths.

## Deviations from Plan

None.

## Self-Check: PASSED
