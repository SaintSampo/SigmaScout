---
phase: quick-260904-5px
plan: 01
subsystem: prediction-models
tags: [epa, statbotics-parity, algorithm-versioning, ribbon-ui]
status: complete
dependency-graph:
  requires:
    - packages/core/algorithms/epa.ts (pre-existing D-01/D-08 divergences)
    - quick task 260904-4aa's scripts/epaVsStatbotics.ts / data/baselines/epa-vs-statbotics-2026-09.json
  provides:
    - "epa@5.0.0+baseline: no-foul total (D-01) + Statbotics elimination discount (D-05)"
    - "EPA_ELIM_WEIGHT exported constant"
    - "Version-gated ribbon label ('EPA Statbotics 5.0') on AlgorithmSelect.tsx"
  affects:
    - docs/models/epa-divergences.md (SS1 retired, SS2's third correction)
    - docs/models/epa-vs-statbotics.md (re-measured verdict)
    - .planning/todos/pending/republish-after-adjust-model-change.md (merged, not duplicated)
tech-stack:
  added: []
  patterns:
    - "Arithmetic-identity proof before a genuine re-measurement: Task 1's fouls change was verified byte-identical against the untouched baseline BEFORE Task 2's elimination change (which legitimately moves numbers) touched anything."
    - "Version-gated UI label reads the served manifest rather than hardcoding a name the site isn't serving yet — self-corrects when the deferred republish lands."
key-files:
  created: []
  modified:
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/algorithms/breakdown/groups.ts
    - scripts/epaVsStatbotics.ts
    - data/baselines/epa-vs-statbotics-2026-09.json
    - docs/models/epa-vs-statbotics.md
    - docs/models/epa-divergences.md
    - apps/web/src/components/ribbon/AlgorithmSelect.tsx
    - apps/web/src/components/ribbon/AlgorithmSelect.test.tsx
    - .planning/todos/pending/republish-after-adjust-model-change.md
decisions:
  - "D-01: EPA's published `total` excludes `foulsCommitted`, matching Statbotics' `epa.total_points`; `foulsCommitted` still published as its own entry; `carrySeason()`'s carryover input stays fouls-INCLUSIVE on purpose (asymmetry pinned by a dedicated test)."
  - "D-05: adopted BOTH halves of Statbotics' elimination discount — EPA_ELIM_WEIGHT (1/3) outer EWMA weight, and the per-team match counter not advancing on an elimination match — closing docs/models/epa-divergences.md SS1."
  - "Version bump path corrected mid-task: originally planned 2.0.0 -> 3.0.0 (both changes), but concurrent quick task 260904-6a1's independent adjust-pinning change landed in between and claimed 4.0.0 first. Final path: 2.0.0 -> 3.0.0 (fouls, this task) -> 4.0.0 (6a1's adjust change) -> 5.0.0 (elimination discount, this task). Stale bump comments describing the originally-planned 3.0.0-does-both path were corrected in place rather than left misleading a future reader."
  - "Ribbon label locked as 'EPA Statbotics 5.0' (not 3.0, updated mid-task once the final version was known), version-gated on the manifest's EPA entry starting with major 5."
  - "Task 3's republish todo was merged into 260904-6a1's existing republish-after-adjust-model-change.md rather than filing a competing todo, per explicit coordinator direction — the file now names all three version bumps, marks the EPA-vs-Statbotics item resolved, and adds the artifacts-before-manifest ordering hazard the original didn't cover."
metrics:
  duration: "~2.5 hours across two sessions (interrupted mid-execution by a file-collision checkpoint with two concurrent quick tasks, resumed once both landed)"
  completed: 2026-09-04
actuals:
  tokens: 42000
  tasks: 3
  commits: 3
---

# Quick Task 260904-5px: EPA no-foul total + Statbotics elimination discount Summary

EPA's published `total` now excludes `foulsCommitted` (matching Statbotics' `epa.total_points`),
and EPA adopts Statbotics' elimination-match discount (1/3 EWMA weight, non-advancing match
counter) — both landing under `epa@5.0.0+baseline`, with the ribbon now reading "EPA Statbotics
5.0" once R2 actually serves that version.

## What Was Built

**Task 1 (D-01, committed `215b0c34`):** `epa.ts`'s `teamMetrics()` sums every component except
`FOULS_COMMITTED_COMPONENT` into `total`; `foulsCommitted` is still published as its own per-team
entry. `predict()` and `carrySeason()` are untouched — `carrySeason()`'s carryover input stays
fouls-INCLUSIVE, a deliberate asymmetry pinned by a new test (`epa.carrySeason — D-01` describe
block). `scripts/epaVsStatbotics.ts`'s `ourTeamValuesFromState` now reads `total` directly instead
of subtracting `foulsCommitted` itself, since the metric now does that subtraction internally.

**Identity proof (the load-bearing verification signal):** with only the fouls change in place,
`npx tsx scripts/epaVsStatbotics.ts --check` passed against the SAME committed baseline file,
verified byte-identical via `git diff --exit-code data/baselines/epa-vs-statbotics-2026-09.json`
(clean). This proves moving the subtraction from the script into the metric double-subtracts
nothing — the fouls change is a pure arithmetic identity on the compared quantity.

**Task 2 (D-05, committed `f0c7af48`):** `update()` now derives `result.compLevel !== "qm"` once
and threads it into both `applyComponentUpdate` calls. Inside that function, an elimination
observation blends at the new `EPA_ELIM_WEIGHT` (1/3) instead of full weight, and the per-team
match counter is left untouched instead of incrementing — so `epaPercentFunc`'s decaying
learning-rate schedule advances on qualification matches only. Pinned by hand-computed constants
(40/3 for an elim vs. 20 for the identical qual observation, not a bare inequality), plus cases for
comp-level coverage (`ef`/`qf`/`sf`/`f` all treated identically; only `qm` is a qualification
match) and that both alliance scores still fold into `allianceScoreStats` for an elimination match.

Both baselines were then re-measured: `data/baselines/epa-vs-statbotics-2026-09.json` under
`epa@5.0.0+baseline`, same half-width formula (no half-width needed to grow), and
`docs/models/epa-vs-statbotics.md`'s accuracy/Brier table now shows `2.0.0` (BEFORE) alongside
`5.0.0` (AFTER).

**Task 3 (D-03, committed `b845a58b`):** `AlgorithmSelect.tsx`'s `useAlgorithmOptions` gives EPA
the full name `"EPA Statbotics 5.0"` ONLY when the manifest's resolved `epa` version starts with
major `5` — otherwise it keeps today's `${baseLabel} ${entry.version}` branch, so the label never
claims a version R2 isn't actually serving yet. `algorithmDisplayLabel("epa")` still returns the
short `"EPA"` everywhere else (table headers, Insights notice, Breakdown caption, podium).
`docs/models/epa-divergences.md` §1 is retired with a dated closure note (historical text intact);
§2 records this task's third correction (fouls exclusion narrows D-04, doesn't withdraw it); the
intro quotes the re-measured slope range.

## Headline Measured Figures (2.0.0 -> 5.0.0)

**Per-team comparison, min-matches(≥12) arm** (slope toward 1.0 = tighter agreement with
Statbotics):

| Season | Old slope (2.0.0) | New slope (5.0.0) | Direction |
|--------|-------------------:|--------------------:|-----------|
| 2022 | 0.875 | 0.886 | tighter (+0.011) |
| 2023 | 0.845 | 0.842 | looser (-0.003) |
| 2024 | 0.818 | 0.818 | flat (+0.0004) |
| 2025 | 0.861 | 0.853 | looser (-0.009) |
| 2026 | 0.941 | 0.961 | tighter (+0.021) |

Mixed: 3 seasons tighter or flat, 2 slightly looser — small movements (≤0.02), reported honestly
rather than framed as a clean win.

**Win-probability accuracy/Brier, 2022-2026 combined slice:**

| Season | Statbotics acc | EPA acc (2.0.0) | EPA acc (5.0.0) | Statbotics Brier | EPA Brier (2.0.0) | EPA Brier (5.0.0) |
|--------|----------------:|-------------------:|-------------------:|-------------------:|----------------------:|----------------------:|
| 2022 | 0.7815 | 0.7581 | 0.7602 | 0.1502 | 0.1615 | 0.1609 |
| 2023 | 0.7647 | 0.7612 | 0.7608 | 0.1608 | 0.1641 | 0.1643 |
| 2024 | 0.7627 | 0.7356 | 0.7338 | 0.1620 | 0.1870 | 0.1874 |
| 2025 | 0.7839 | 0.7739 | 0.7742 | 0.1537 | 0.1593 | 0.1599 |
| 2026 | 0.7978 | 0.7953 | 0.7942 | 0.1483 | 0.1430 | 0.1434 |

Movement is small and mixed (accuracy improved in 2022/2025, degraded slightly in 2023/2024/2026;
Brier improved only in 2022). Standing verdict unchanged: Statbotics' own model still beats our EPA
on both metrics in 4 of 5 seasons; EPA still wins on Brier in 2026.

## Deviations from Plan

### Auto-fixed / Adapted Issues

**1. [Environmental — resolved via coordinator checkpoint] Version bump path changed from the
planned 2.0.0 → 3.0.0 (both fouls + elim under one string) to 2.0.0 → 3.0.0 → 4.0.0 → 5.0.0.**
- **Found during:** Task 2, after resuming from a mid-execution checkpoint.
- **Cause:** Two other concurrent quick tasks were actively committing to this same repo during
  execution. `260904-6a1` landed an independent adjust-pinning correction to `epa.ts` and bumped
  the version to `4.0.0+baseline` in the window between this task's Task 1 (which shipped
  `3.0.0+baseline`) and Task 2 (which was going to reuse that string for the elimination change).
- **Resolution:** Per explicit coordinator/user decision, Task 2 bumped to `5.0.0+baseline`
  instead of reusing `3.0.0`. The stale bump comment Task 1 had written (claiming the elimination
  change would land under `3.0.0+baseline`) was corrected in place with a dated note rather than
  left misleading a future reader — this repo's own named failure mode.
- **Files modified:** `packages/core/algorithms/epa.ts` (version-bump comment block).
- **Commits:** `f0c7af48`.

**2. [Coordinator decision] Ribbon label locked as "EPA Statbotics 5.0", not the plan's originally
stated "EPA Statbotics 3.0".**
- **Reason:** Consequence of deviation 1 — the user chose to have the label track the real final
  version string rather than the number originally planned before the concurrent-session collision.
- **Files modified:** `apps/web/src/components/ribbon/AlgorithmSelect.tsx`,
  `AlgorithmSelect.test.tsx`.
- **Commit:** `b845a58b`.

**3. [Coordinator decision] Task 3's republish todo merged into an existing file instead of
creating `.planning/todos/pending/republish-epa-3-0-no-foul-totals.md` as originally planned.**
- **Reason:** Quick task `260904-6a1` had already filed
  `.planning/todos/pending/republish-after-adjust-model-change.md` covering a republish this task's
  own changes also needed. Per explicit coordinator direction, that file was extended (all three
  version bumps named, the EPA-vs-Statbotics re-measurement item marked resolved, the
  artifacts-before-manifest ordering hazard and the now-stale-predictions note added) rather than
  filing a second, competing todo.
- **Files modified:** `.planning/todos/pending/republish-after-adjust-model-change.md`.
- **Commit:** `b845a58b`.

**4. [Rule-4-adjacent, resolved via checkpoint] Mid-execution halt for a file-collision hazard —
not a code deviation, but worth recording.** While executing Task 1, two OTHER concurrent quick
tasks (`260904-5zg` touching `AlgorithmSelect.tsx`/`metricKeys.ts`/table components, and
`260904-6a1` actively, uncommittedly rewriting the exact `epa.ts` function this plan's Task 2
needed to edit) were discovered live in the shared working tree. Execution halted and returned a
checkpoint rather than risk a last-write-wins race against another session's in-progress,
uncommitted work. The coordinator resolved it by waiting for both sessions to commit
(`603400c3`/`beb5da41`/`b3c610c6` for 6a1; `be01f04b`/`23d1cbaa`/`2c418e83` for 5zg), then directed
resumption with the updated version-bump/label decisions above.

No other deviations. Every task's own `<verify>` command list ran and passed (substituting the
merged-todo file path for Task 3's literally-named target, per the coordinator's explicit
direction).

## Known Stubs

None.

## Self-Check: PASSED

- All ten files in this task's `files_modified` list exist on disk (verified via direct file
  checks).
- All three task commits (`215b0c34`, `f0c7af48`, `b845a58b`) verified present in `git log`.
- `packages/core/algorithms/epa.ts` ships `version: "5.0.0+baseline"` (verified via grep).
- `npx tsc --noEmit` and `npx vitest run` both clean at final state (174 test files, 3116 passed,
  4 pre-existing skipped, 0 failed).
