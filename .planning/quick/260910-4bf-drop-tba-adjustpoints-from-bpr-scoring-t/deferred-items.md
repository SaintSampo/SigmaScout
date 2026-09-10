# Deferred items — quick task 260910-4bf

> **RESOLVED 2026-09-10, same night, commit 095424c9 (a different session).**
> Both items below were fixed within the hour: the gbr 2026 exact-count pin
> became a seal-time FLOOR (`toBeGreaterThanOrEqual(20297)` — the corpus is
> live and offseason ingest grows it continuously), and the digest slice
> fixture was re-extracted through its own designed remedy
> (`fixtures/extract-digest-slice.ts`; every committed DIGEST reproduces
> untouched, per that test's prohibition). Both files 23/23 green. The
> analysis below stands as the accurate record of what was found.

Found during the Task 3 full-suite run (`npx vitest run` from repo root). Both
are pre-existing, unrelated to this task's scoring-target change, and are
out of scope per the executor's scope-boundary rule (only auto-fix issues
directly caused by the current task's changes). Not fixed.

## 1. VPR digest fixture staleness (`packages/harness/digest.test.ts`)

5 failing assertions, all of the shape "corpus-derived and fixture-derived
slice match lists are identical (fixture is not stale, T-03-17)", for:
`vpr@11.0.0+rolling-2026-09e.json`, `...09f.json`, `...09g.json`,
`...tracer-check.json`, `...tuned-2026-08.json`.

This test compares a committed extracted fixture against a fresh read of
`data/corpus.sqlite` for VPR promoted-version reproducibility. Nothing in
this task touches VPR, `packages/harness/digest.ts`, corpus extraction, or
score_breakdown serialization — the failure is data drift between the
committed fixture and the live corpus (which is mutated by the ongoing 2026
season / other concurrent work), not a code regression from this task.

## 2. GBR seal row-count pin (`packages/gbr/seal.test.ts`)

1 failing assertion: `loadSeason(2026, { breakSeal: true }) does not throw,
and returns 20,297 rows` — the corpus now returns a different row count for
2026. GBR is shelved (see project memory `project_gbr_first_result.md`) and
this task never touches `packages/gbr/`. Same root cause as above: the
corpus has grown since the fixture/pin was set.

## Scope confirmation

Both failures were checked against this task's diff (`packages/bpr/data.ts`,
`packages/core/algorithms/bpr.ts`, `packages/bpr/equivalence.ts`,
`packages/bpr/evaluate.test.ts`, `packages/bpr/model.test.ts`,
`packages/core/algorithms/bpr.test.ts`, `packages/bpr/scoringTarget.test.ts`)
and neither failing test imports or exercises any of those files. All of
this task's own suites (`scoringTarget.test.ts`, `evaluate.test.ts`,
`bpr.test.ts`) pass. The rest of the ~4,352-test root run passes
(4342 passed / 4 skipped / 6 failed, all 6 in the two files above).
