---
phase: 01-data-foundation-evaluation-harness
plan: 06
subsystem: evaluation-harness
tags: [walk-forward, cross-event-interleaving, recursive-least-squares, sherman-morrison, opr, vitest]

# Dependency graph
requires:
  - phase: 01-data-foundation-evaluation-harness (Plans 03-05)
    provides: Full 2022-2026 corpus with a deterministic chronological total order, season-pooled ridge OPR, and the scoring/artifact/report layer this plan connects and runs for real
provides:
  - "buildSeasonStream (packages/harness/replay.ts) — the single chronological match list for a whole season across every event in it, cross-event interleaved, delegating ordering entirely to selectMatchesChronological"
  - "openCorpusReadOnly (packages/corpus/db.ts) — a corpus handle whose writes fail at the SQLite layer itself (T-01-13)"
  - "Widened packages/harness/cli.ts: --season/--seasons (read-only corpus path, no network) alongside the existing --event (TBA-fetching) mode; --out defaults to reports/; --include-offseason"
  - "A mathematically-exact incremental Sherman-Morrison/RLS solve in packages/core/algorithms/opr.ts, replacing update()'s O(n^3)-per-match dense SVD — the fix that makes a full-season replay computationally tractable at all"
  - "A real, reproducible 2022-2026 OPR report (reports/full/) — Phase 1's core value proposition demonstrated on the actual corpus, not asserted"
affects: ["02", "08"]

# Actuals (#2632)
actuals:
  tokens: 10000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Recursive Least Squares (Sherman-Morrison rank-1 update) as the standing pattern for any future algorithm that needs season-pooled state at national scale — the same problem Sigma1's Kalman-filter family (Phase 2+) will face; this plan's opr.ts comment and benchmark data are the reference point"
    - "Season-mode CLI paths (--season/--seasons) always open the corpus read-only; only the legacy --event path (which fetches from TBA and writes) opens it read-write — a structural split between 'scoring reads' and 'ingestion writes' inside one CLI"

key-files:
  created:
    - packages/harness/replay.season.test.ts
  modified:
    - packages/harness/replay.ts
    - packages/harness/cli.ts
    - packages/corpus/db.ts
    - packages/core/algorithms/opr.ts
    - packages/core/algorithms/opr.test.ts
    - .gitignore

key-decisions:
  - "openCorpusReadOnly added to packages/corpus/db.ts (outside this plan's declared files_modified) — a Rule 3 blocking fix: Task 1's own acceptance criteria require a corpus handle whose writes fail at the SQLite layer, and no such capability existed. Mirrors better-sqlite3's native readonly mode rather than an application-level guard, so the guarantee is a runtime fact, not a convention."
  - "OPR's update() rewritten from a from-scratch dense O(n^3) SVD solve per match to a mathematically-exact incremental Sherman-Morrison/RLS solve, O(n^2) per match (packages/core/algorithms/opr.ts, opr.test.ts — outside this plan's declared files_modified). Discovered as a hard blocker: benchmarked at real season scale (~3,700 teams, ~15,000-18,000 matches/season) the original approach needed an estimated 16 CPU-days per season. The fix is exact, not an approximation — solveRidgeOpr itself is untouched and is what a new equivalence test in opr.test.ts checks the incremental path against on every prefix of observations. See Deviations below for the full justification and benchmark numbers."
  - "The plan's own automated idempotency-check script (in <verify>) has a path bug: it strips a.runTimestamp, but the artifact schema (fixed by Plan 05) nests it at a.provenance.runTimestamp. The literal script always reports non-determinism regardless of the harness's real behavior. Verified the actual acceptance criterion by hand with the corrected path — the two runs' artifacts are byte-identical once provenance.runTimestamp is stripped. See Deviations."
  - "reports/ (the harness's default --out directory) added to .gitignore — was previously untracked-but-not-ignored, violating the failure log's 'keep generated artifacts out of git' rule."

patterns-established:
  - "Before declaring a season-pooled, per-match-recomputed algorithm production-ready, benchmark it at real corpus scale (thousands of teams, tens of thousands of matches), not just synthetic fixtures and a single-event smoke test — Plan 04's tests were correct but scale-blind, and this is exactly the class of problem Phase 1's harness exists to catch before it reaches a report."

requirements-completed: [EVAL-01, EVAL-02, EVAL-04]

coverage:
  - id: D1
    description: "buildSeasonStream (packages/harness/replay.ts) returns one chronological match list for a whole season across every event in it — concurrent events interleave by time rather than replay-one-event-then-the-next, the stream is a stable total order, the whole-season predict-before-update sequence holds across event boundaries, a team's state at its second event reflects its first, offseason matches are excluded by default and included only with an explicit option, two replays are deterministic, an empty season returns an empty list without throwing, and the corpus handle used is read-only (a write through it fails at the SQLite layer)"
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "packages/harness/replay.season.test.ts (8 tests) — interleaving, total-order stability, whole-season predict-before-update, cross-event state carryover, offseason exclusion/inclusion, replay determinism, empty-season, read-only-handle"
        status: pass
    human_judgment: false
  - id: D2
    description: "packages/harness/cli.ts widened to --season/--seasons (a read-only corpus path, no network access) alongside the existing --event mode; --out defaults to reports/; --include-offseason controls whether offseason matches are replayed (scoring still always excludes them per D-06); a per-season progress line prints replayed/scorable/excluded counts as each season runs"
    requirement: EVAL-01
    verification:
      - kind: other
        ref: "Real command: pnpm harness --seasons 2022-2026 --algorithm opr --out reports/full — printed one progress line per season (2022: 14677 matches/74 excluded, 2023: 16353/63, 2024: 17029/71, 2025: 17877/62, 2026: 18403/66), exited 0, wrote reports/full/artifact.json and reports/full/report.html"
        status: pass
    human_judgment: false
  - id: D3
    description: "The harness run is reproducible: two consecutive pnpm harness --seasons 2022-2026 --algorithm opr runs over the unchanged corpus produce artifacts identical in every field once provenance.runTimestamp is removed — verified directly (not via the plan's own <verify> script, which has a path bug; see Deviations) — and the artifact carries score slices for all five 2022-2026 seasons with only 2025 and 2026 marked headlineEligible"
    requirement: EVAL-04
    verification:
      - kind: other
        ref: "Real command: two full runs (reports/full, reports/rerun), each ~80 minutes wall-clock; node -e comparison stripping provenance.runTimestamp shows JSON.stringify(full) === JSON.stringify(rerun); a second check confirms all five seasons present and no season before 2025 is headlineEligible"
        status: pass
    human_judgment: false
  - id: D4
    description: "OPR's update() replaced with a mathematically-exact incremental Sherman-Morrison/RLS solve (O(n^2) per match) instead of a from-scratch dense SVD (O(n^3) per match) — the fix that makes a full-season replay computationally tractable at all. Exactness (not an approximation) is proven by a new equivalence test comparing the incremental path's ratings against the untouched solveRidgeOpr solved fresh over the same accumulated observations."
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — 'opr.update — incremental solve matches solveRidgeOpr's from-scratch batch solve' (new test); all 15 pre-existing opr.test.ts tests still pass unchanged"
        status: pass
      - kind: other
        ref: "Real full-corpus run completed in 78m20s (first run) / 82m22s (rerun) at real season scale (up to ~3,700 teams, ~18,400 matches in one season) — versus a benchmarked ~16 CPU-days/season estimate for the original dense-SVD-per-match approach"
        status: pass
    human_judgment: false
  - id: D5
    description: "The rendered report (reports/full/report.html) reads as a scoreboard against Statbotics for the real, full 2022-2026 corpus: score table with qual/elim/combined columns for all five seasons, a clearly-labelled Statbotics reference row per season, 2025/2026 visually distinguished as the only headline-eligible (holdout) rows, a calibration reliability diagram with the perfect-calibration diagonal per season, and exclusion/tie/no-call counts shown next to each score"
    requirement: EVAL-01
    verification: []
    human_judgment: true
    rationale: "Visual/interpretive quality of the rendered HTML (does the report actually read clearly, are holdout rows and badges legible, does the disclosure register as adequate to a human) cannot be asserted by a unit test. Structural population was confirmed programmatically (score-table/statbotics-table/holdout-row/badge-headline/cal-diagonal all present, 5 calibration figures — one per season — no src/href/script anywhere in the self-contained HTML), but the plan's own human-check step requires a human to open the file in a browser and confirm the five stated points. Per workflow.human_verify_mode=end-of-phase, this is harvested into the phase-level UAT rather than pausing mid-plan."

duration: 3h04m
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 6: Full 2022-2026 Season Replay, Cross-Event Interleaving, and the Real Report Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**Every event of every 2022-2026 season replayed as one cross-event-interleaved, walk-forward, read-only-corpus stream through OPR, with a discovered-and-fixed O(n^3)-to-O(n^2) algorithm rewrite that made replaying a real ~18,000-match/~3,700-team season computationally possible at all, and a reproducible real report proving Phase 1's core value proposition on the actual corpus (78m20s full run, byte-identical on rerun).**

## Performance

- **Duration:** 3h04m (includes two real ~80-minute full-corpus harness runs)
- **Started:** 2026-08-13T16:16:30Z (approximate, continuation from Plan 05's completion)
- **Completed:** 2026-08-13T19:20:17Z
- **Tasks:** 2
- **Files modified:** 7 (1 new + 6 modified)

## Accomplishments
- `packages/harness/replay.ts`'s `buildSeasonStream` returns one chronological match list for a whole season across every event in it, delegating ordering entirely to `selectMatchesChronological` — proven to interleave two concurrent events by time rather than replaying one to completion before the next, to be a stable total order across repeated builds, to hold the whole-season predict-before-update invariant across event boundaries, to carry a team's state from its first event into its second, to exclude offseason matches by default and include them only with an explicit option, to be deterministic across repeated replays, and to return an empty list (not throw) for an empty season
- `packages/corpus/db.ts`'s new `openCorpusReadOnly` opens the corpus with no write lock and no schema (re-)application; a write attempted through the handle fails at the SQLite layer itself (T-01-13) — proven by a direct test, not asserted by comment
- `packages/harness/cli.ts` widened with `--season`/`--seasons` (a read-only corpus path — no network access at all) alongside the existing `--event` mode; `--out` now defaults to `reports/`; `--include-offseason` controls whether offseason matches are replayed (scoring still always excludes them per D-06); each season prints a progress line with replayed/scorable/excluded counts as it completes
- **Discovered and fixed a severe performance blocker in `packages/core/algorithms/opr.ts`**: `update()` recomputed a dense O(n^3) SVD solve from scratch after every single match. Benchmarked directly against this project's real corpus scale (~3,000-3,700 distinct teams, ~15,000-18,000 played matches per season) and this project's own `ml-matrix` dependency: one solve at n=1,500 took ~21s, and cost scales cubically — a full season at n≈3,700 would need on the order of **16 CPU-days**. Replaced with a mathematically exact incremental Sherman-Morrison/Recursive-Least-Squares solve (O(n^2) per match, raw `Float64Array` math — ~15-30ms per update even at n=3,700, benchmarked ~20-30x faster than the equivalent `ml-matrix` operation), verified against the untouched `solveRidgeOpr` via a new equivalence test. This is what makes a real full-season replay possible at all.
- Ran the harness for real, twice, across the whole 2022-2026 corpus: `pnpm harness --seasons 2022-2026 --algorithm opr --out reports/full` (78m20s) and `--out reports/rerun` (82m22s). The two artifacts are byte-identical once `provenance.runTimestamp` is stripped, covering score slices for all five seasons with only 2025 and 2026 marked `headlineEligible` — Phase 1 success criteria 3 and 5 demonstrated on the real corpus, not asserted.
- 2026 (holdout) combined-view result: Brier score 0.1773, winner accuracy 78.25% (18,337 scored, 45 ties, 330 no-calls, 66 excluded for surrogate involvement) — a real, honestly-measured number against the actual corpus, ready to be compared against the Statbotics reference row.
- `reports/` (the harness's default output directory) added to `.gitignore` — a generated artifact that was previously untracked-but-not-ignored, against the failure log's explicit "keep generated artifacts out of git" rule.

## Task Commits

Each task was committed atomically:

1. **Task 1: Season-spanning replay with cross-event interleaving, stable order and idempotency** - `9951d286` (feat)
2. **Task 2: Run the harness across 2022-2026 and produce the report** - `a9e33391` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/harness/replay.ts` - `buildSeasonStream`, `SeasonStreamOptions`; `WalkForwardSimulator`'s doc comment extended to describe season-scope usage (no behavior change — it already worked for any chronological list)
- `packages/harness/replay.season.test.ts` - Cross-event interleaving, total-order stability, whole-season predict-before-update, state carryover, offseason exclusion/inclusion, replay determinism, empty-season, read-only-handle tests (8 tests)
- `packages/corpus/db.ts` - `openCorpusReadOnly`
- `packages/harness/cli.ts` - `--season`/`--seasons`/`--include-offseason` flags, `runSeason`/`runSeasons`/`runSeasonsMode`/`runEventMode`; `--out` default changed to `reports/`
- `packages/core/algorithms/opr.ts` - `IncrementalInverse`, `IncrementalRidgeSolve`, `applyObservation`, `emptyIncrementalSolve`, `ratingsVectorToMap`; `OprState` gained an internal `incrementalSolve` field; `update()` rewritten to use the incremental solve instead of calling `solveRidgeOpr` per match (`solveRidgeOpr` itself untouched)
- `packages/core/algorithms/opr.test.ts` - New equivalence test proving the incremental path matches `solveRidgeOpr`'s from-scratch batch solve
- `.gitignore` - Added `reports/`

## Decisions Made
See `key-decisions` in frontmatter for full rationale. Summary:
- `openCorpusReadOnly` added to `db.ts` (outside declared scope) — a Rule 3 blocking fix native `better-sqlite3` readonly mode makes a runtime guarantee, not a convention
- OPR's `update()` rewritten to an incremental Sherman-Morrison/RLS solve (outside declared scope) — a Rule 3 blocking fix without which Task 2's own acceptance criteria (the real command completing) could not be satisfied; mathematically exact, proven by a new equivalence test, and by the real full run itself completing and matching expected structure
- The plan's own `<verify>` idempotency script has a path bug (`a.runTimestamp` vs. the real `a.provenance.runTimestamp`); verified the actual acceptance criterion by hand with the corrected path
- `reports/` added to `.gitignore` — a Rule 2 fix (missing critical: generated artifacts must not enter git per the failure log)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `openCorpusReadOnly` to `packages/corpus/db.ts`**
- **Found during:** Task 1, while implementing `buildSeasonStream`'s read-only-handle acceptance criterion
- **Issue:** No capability existed to open the corpus without acquiring the single-writer lock and applying the schema — Task 1's own acceptance criteria require a handle whose writes fail at the SQLite layer, not just a convention
- **Fix:** Added `openCorpusReadOnly(path)`, using `better-sqlite3`'s native `readonly: true, fileMustExist: true` mode — a write through this handle fails as a genuine SQLite-layer error
- **Files modified:** `packages/corpus/db.ts`
- **Verification:** `replay.season.test.ts`'s "the replay's corpus handle is read-only" test directly asserts a write through the handle throws
- **Committed in:** `9951d286` (Task 1 commit)

**2. [Rule 3 - Blocking] Rewrote `packages/core/algorithms/opr.ts`'s `update()` from a dense O(n^3) SVD solve to an incremental O(n^2) Sherman-Morrison/RLS solve**
- **Found during:** Task 2, before attempting the real full-corpus run — benchmarked the existing `update()`'s per-match cost against real corpus scale before committing to running it, rather than after
- **Issue:** `update()` (from Plan 04) rebuilt the full design matrix and ran `ml-matrix`'s dense `SingularValueDecomposition` from scratch on every single match. Benchmarked directly: one solve at n=1,500 teams takes ~21s, scaling cubically. This project's real 2022-2026 corpus has ~3,000-3,700 distinct teams and ~15,000-18,000 played matches per season (measured directly against `data/corpus.sqlite`). Extrapolating the measured cubic scaling to n≈3,700 across a full season's ~18,000 matches gives an estimated **~16 CPU-days per season** — Task 2's own acceptance criterion (`pnpm harness --seasons 2022-2026 --algorithm opr` exits 0) is not satisfiable at this cost, and this was invisible in Plan 04's own testing because that plan only exercised small synthetic fixtures (8 teams) and a single-event smoke test (~100 matches, ~40 teams).
- **Fix:** Replaced the per-match full re-solve with a mathematically exact incremental solve maintaining `(M^T M + lambda*I)^-1` via Sherman-Morrison rank-1 updates (the classic Recursive Least Squares algorithm) — O(n^2) per match instead of O(n^3), implemented with raw `Float64Array` arithmetic (benchmarked ~20-30x faster than the equivalent `ml-matrix` operation for this specific update). This is NOT an approximation: for any prefix of observations, the incremental solve's ratings are identical (up to floating-point rounding) to calling the original, completely untouched `solveRidgeOpr` fresh over that same prefix — proven by a new test in `opr.test.ts`. `OprState` gained a new internal `incrementalSolve` field; the previously-tested `observations`/`ratings` fields are unchanged in shape and behavior, so all 15 pre-existing `opr.test.ts` tests pass unmodified.
- **Files modified:** `packages/core/algorithms/opr.ts`, `packages/core/algorithms/opr.test.ts`
- **Verification:** New equivalence test passes; all 15 pre-existing `opr.test.ts` tests pass unchanged; full suite 116/116 green; `pnpm typecheck` clean; the real full 2022-2026 run completed in 78m20s (first run) and 82m22s (rerun) — proof at real scale, not just benchmark extrapolation
- **Committed in:** `a9e33391` (Task 2 commit)
- **Flagged for review:** this is a substantial change to a previously-completed, separately-planned module (Plan 04), made autonomously under this plan's Rule 3 justification because Task 2's stated deliverable was not achievable without it. The math and equivalence proof are solid, but given the scope, a maintainer may want to specifically review `packages/core/algorithms/opr.ts`'s new `IncrementalInverse`/`applyObservation` machinery.

**3. [Rule 2 - Missing Critical] Added `reports/` to `.gitignore`**
- **Found during:** Task 2, after the first real run wrote `reports/full/`
- **Issue:** The harness's default output directory (`reports/`, this plan's own new default) was untracked but not gitignored — a generated artifact that would otherwise get accidentally `git add`ed, against the failure log's explicit "keep generated artifacts out of git" rule
- **Fix:** Added `reports/` to `.gitignore`
- **Files modified:** `.gitignore`
- **Verification:** `git status --short` no longer lists `reports/` as untracked after the real runs
- **Committed in:** `a9e33391` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking-issue fixes — one small capability addition, one substantial algorithm-performance rewrite flagged above for review — and 1 Rule 2 missing-critical fix). No Rule 4 architectural STOP was raised: the OPR rewrite was judged a Rule 3 blocking fix (Task 2's stated deliverable was literally unachievable without it, in a reasonable timeframe) rather than an architectural decision, because it changes only *how* the existing, unchanged ridge-regression contract is computed — same inputs, same outputs (proven by a new equivalence test), same `predict`/`update` public behavior — not *what* OPR computes or how the harness/CLI is structured.
**Impact on plan:** All three fixes were necessary for this plan's own stated acceptance criteria to be satisfiable at all. No scope creep beyond what was required to make the plan's explicitly-required real full-corpus run actually complete.

## Issues Encountered
- The plan's own `<verify>` automated idempotency-check script has a path bug: it does `delete a.runTimestamp`, but the artifact schema (established in Plan 05) nests the run timestamp at `a.provenance.runTimestamp`, not the top level. The literal script as written would report "not idempotent" on every run regardless of the harness's actual behavior, because it never strips the real timestamp field. Worked around by verifying the actual acceptance criterion directly with the corrected field path: `JSON.stringify` of both artifacts, with `provenance.runTimestamp` deleted from each, are identical. This is a plan-authoring bug, not a code defect — PLAN.md itself was not edited (per convention, plans are historical record); this SUMMARY documents the discrepancy and the corrected verification performed instead.
- The two required real full-corpus harness runs took ~78 and ~82 minutes of wall-clock time each (even after the O(n^3)-to-O(n^2) fix), for a combined ~160 minutes of this plan's total duration. This is expected at real season scale and is not itself a defect — see the OPR performance-fix deviation above for the "why."

## User Setup Required

None - no external service configuration required beyond the existing `.env` (unchanged from prior plans; the `--season`/`--seasons` path does not use TBA at all).

## Next Phase Readiness
- Phase 1's evaluation harness is now demonstrably complete on the real 2022-2026 corpus: `reports/full/artifact.json` and `reports/full/report.html` exist, cover all five seasons, mark only 2025/2026 headline-eligible, and were proven reproducible by a second identical run
- Phase 2 (algorithm work — EPA reimplementation, then Sigma1) inherits a working, real-scale-proven harness AND a concrete, benchmarked lesson: any season-pooled, per-match-recomputed algorithm must be checked against real corpus scale (thousands of teams, tens of thousands of matches) before being considered production-ready, not just small synthetic fixtures. The Recursive-Least-Squares pattern this plan introduced in `opr.ts` is directly reusable guidance for Sigma1's Kalman-filter family, which will face the identical "state grows over a whole season, must stay fast per match" problem by design.
- Open item carried forward from Plan 05 (unrelated to this plan's work): `STATBOTICS_REFERENCE_FALLBACK`'s five per-season values remain unverified best-available estimates — see `.planning/WINDOWS.md` entry #1.
- `packages/core/algorithms/opr.ts`'s incremental-solve rewrite is flagged above for a maintainer's specific review, given its scope and that it touches a previously-completed plan's module — the math is proven equivalent and the real run completed successfully, but this is exactly the kind of change worth a second pair of eyes before Phase 2 builds further on top of `opr.ts`'s patterns.
- No blockers identified for Phase 2.

---
*Phase: 01-data-foundation-evaluation-harness*
*Completed: 2026-08-13*

## Self-Check: PASSED

All 7 files confirmed present on disk (`replay.ts`, `replay.season.test.ts`, `cli.ts`, `db.ts`, `opr.ts`, `opr.test.ts`, `.gitignore`). Both task commit hashes (`9951d286`, `a9e33391`) confirmed present in `git log`. Full test suite (`pnpm vitest run`) passes 116/116 across 12 files; `pnpm typecheck` passes with zero errors. Real full-corpus run verified end-to-end: `reports/full/artifact.json` and `reports/full/report.html` both exist and are non-empty, cover all five 2022-2026 seasons, only 2025/2026 marked `headlineEligible`, and a second identical run (`reports/rerun/`) produced a byte-identical artifact once `provenance.runTimestamp` is stripped.
