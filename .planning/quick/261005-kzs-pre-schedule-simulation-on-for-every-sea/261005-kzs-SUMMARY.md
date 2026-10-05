---
phase: quick-261005-kzs
plan: 01
subsystem: publish-pipeline
tags: [presim, pre-schedule, publish, docs]
status: complete
requires: [presim-all-seasons-handoff steps 1 and 2]
provides: ["publish:seasons builds pre-schedule sidecars for every published season (2016 to 2020, 2022 to 2026)"]
affects: [pnpm publish:seasons, docs/simulation-architecture.md, docs/publish-budget.md]
key-files:
  modified:
    - package.json
    - packages/harness/publish.ts
    - apps/web/src/lib/api/preSchedule.ts
    - docs/simulation-architecture.md
    - docs/publish-budget.md
    - .planning/todos/pending/presim-all-seasons-handoff.md
decisions:
  - "Every season, in this release (Jacob, 2026-10-05), after the all-seasons dry run measured 9,822.6 s against about 31 minutes for 2026 only."
  - "DEFAULT_PRESCHEDULE_FROM_SEASON left at 2026: publish.test.ts does not assert the fallback's value; the drift tripwire only checks the script flag."
  - "Offseason events keep getting no sidecar (explicit gate, quick 261004-uyc)."
actuals:
  tasks: 3
  commits: 3
completed: 2026-10-05
---

# Quick 261005-kzs: Pre-schedule simulation on for every season

`pnpm publish:seasons` now passes `--presim-from-season 2016`, so the next real publish bakes presim
sidecars for every RP-eligible, non-offseason event in every published season, not only 2026.

## The measurement behind the decision

Dry run `reports/presim-allyears/dryrun-20261005.out.log`, 2026-10-05 01:12 to 03:56, code at
5e047e98, `--presim-from-season 2016 --dry-run --skip-state`:

- total 9,822.6 s (2 h 44 min); a 2026-only full publish is about 31 minutes
- EPA sidecars 3,982 s summed over seasons, SPR sidecars 5,046 s
- 3,336 sidecars, median 7,792 bytes, p95 19,125, max 42,582
- 108,661 objects and 4,192,395,808 bytes in the whole publish

The dry run shared the machine with a short scoped test run and three typechecks near its end, so
the 2026 season's seconds are rough.

## Commits

- 83dd1d59 feat: pre-schedule simulation sidecars for every season (presim-from-season 2016), `package.json` only
- d1e1f8d2 docs: pre-schedule coverage statements name the 2016 cutoff (publish.ts fallback comment, preSchedule.ts header, simulation-architecture section 3, publish-budget gated-by bullet)
- 211e2744 docs: handoff records the all-seasons dry run and steps 1 to 3 done; the file stays in todos/pending

## Verification (executor reported, orchestrator read the diff)

- Baseline vitest (publish.test.ts, publishLiveWindows.test.ts): 253 passed. After the flag flip: 253 passed, including the presim-flag drift tripwire.
- After the comment and doc edits (publish.test.ts, payloadBudget.test.ts): 252 passed.
- Root `tsc --noEmit` clean; web tsconfig 0 errors.
- PRESIM_SCHEDULE_COUNT still 1000; no algorithm version changed; the JSON budget block in publish-budget.md untouched.

## Deviations from plan

- The pre-edit typecheck baseline for Task 2 was not captured; every Task 2 edit is comment-only and the post-edit result is clean.
- One over-long comment line in preSchedule.ts was re-wrapped.
- The plan's awk checks on the publish-budget presim section were not run; the orchestrator read the diff instead.

## Still open

- Handoff step 4, the real publish, runs next from the main session as part of the combined release.
- Handoff step 5, recording the browser pricing result in two docs.
- The comment above `PRESIM_SCHEDULE_COUNT` still quotes a retired measurement (noted by the planner, out of scope here).
- The worker-thread sidecar build, the untried lever that would shorten the 2 h 44 min.
