---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: prediction-models-epa-sigma1
status: executing
stopped_at: Completed 02-05-PLAN.md
last_updated: "2026-08-14T06:33:24.685Z"
last_activity: 2026-08-13
last_activity_desc: Phase 02 execution resumed (wave continue)
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 12
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-12)

**Core value:** Predictions that are *measurably* better than Statbotics — proven by walk-forward, Brier-scored backtests — delivered on pages that load fast.
**Current focus:** Phase 02 — prediction-models-epa-sigma1

## Current Position

Phase: 02 (prediction-models-epa-sigma1) — EXECUTING
Plan: 5 of 6
Status: Ready to execute
Last activity: 2026-08-13 — Phase 02 execution resumed (wave continue)

Progress: [█████████░] 92%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 22min | 3 tasks | 9 files |
| Phase 01 P02 | 15min | 2 tasks | 14 files |
| Phase 01 P03 | 23min | 3 tasks | 11 files |
| Phase 01 P04 | 12min | 2 tasks | 4 files |
| Phase 01 P05 | 40min | 3 tasks | 12 files |
| Phase 01 P06 | 3h04m | 2 tasks | 7 files |
| Phase 02 P02 | 25min | 3 tasks | 9 files |
| Phase 02 P03 | 80min | 3 tasks | 17 files |
| Phase 02 P04 | 40min | 3 tasks | 10 files |
| Phase 02 P05 | 95min | 3 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Measurement before models — ingestion + walk-forward harness + OPR baseline all land in Phase 1, before any Sigma1 work (failure log: no harness existed).
- [Roadmap]: Predict-before-update is enforced structurally (shared pure-function core), verified by a test that outcome leakage fails rather than returns data.
- [Roadmap]: No standalone polish phase — mobile, deep links, and load performance are success criteria inside the page-building phases.
- [Roadmap]: EVAL-05 lands in Phase 8 with the Compare page, so "site numbers equal harness numbers" is verifiable end-to-end rather than on paper.
- [Phase ?]: Renamed pre-existing .env key TBA_AUTH_KEY -> TBA_API_KEY to match every downstream Phase 1 plan's env var contract
- [Phase ?]: TBA's computed per-match RP field is named 'rp' (not the 2016/2017-era 'tba_rpEarned') in all sampled 2022-2026 seasons -- Plan 03 can normalize RP as a direct field read
- [Phase ?]: Statbotics /v3/year/{year} endpoint consistently 500s -- D-04's reference row will use a dated manual constant instead of a live fetch
- [Phase ?]: Diff-on-upsert replay detection lives in packages/corpus/db.ts (not normalize.ts) since only the corpus layer sees a match's previously-stored score-bearing fields — TBA exposes no replay flag (RESEARCH.md Pitfall 1); the detector must compare against prior corpus state, which normalize.ts cannot see
- [Phase ?]: packages/corpus/schema.sql scoped to events/matches/http_cache only (no teams table) for this tracer, matching the plan's explicit must_haves.artifacts list — RESEARCH.md's broader sketch included a teams table, but the plan's narrower explicit list is authoritative; can be added later without migration pain
- [Phase ?]: detectReplay lives in normalize.ts as a pure sticky diff over score-bearing fields; db.ts's upsertMatch is the sole caller (reads the prior row via selectExistingMatch first) so no caller can bypass the check
- [Phase ?]: teams-list pagination (fetchAllTeams) is deliberately un-conditional — a 304's bodyless response can't signal the terminal empty page, and teams-list is cheap relative to the match-payload volume ETag caching is meant to bound
- [Phase ?]: Local dev corpus (data/corpus.sqlite, gitignored) predated this plan's new tables/columns and was deleted and rebuilt rather than migrated -- disposable by design, no ALTER-based migration path exists yet
- [Phase ?]: D-07's surrogate-slot question resolved: a surrogate's column is excluded from OPR's design matrix, its current rating (or league-mean per-team share if ) is subtracted from its alliance's target score, and non-surrogate teammates keep a correctly-scaled observation
- [Phase ?]: Disqualification policy (Open Question 3, no locked decision): opposite of surrogates -- a dq'd team's column and rating update are kept, since MatchResult carries no dq field and OPR models physical score contribution, not ranking rulings
- [Phase ?]: cli.ts rewired to score.ts/artifact.ts/statbotics.ts/report.ts's new module boundaries (blocking fix, single-event scope preserved for Plan 06 to widen) — Task 1/3's required export changes broke cli.ts's typecheck; fixing it matches exactly what Plan 06's read_first already expects to find
- [Phase ?]: Statbotics fallback per-season accuracy constants are unverified best-available estimates, logged as an open stub in WINDOWS.md — Statbotics /v3/year/{year} reproducibly 500s (reconfirmed live 2026-08-13) and their blog renders numbers client-side from the same broken API — no way to source verified values from this offline pipeline
- [Phase ?]: Fixed O(n^3)-per-match OPR solve (Plan 04) to O(n^2) incremental Sherman-Morrison/RLS after benchmarking real corpus scale (~3,700 teams/season) showed the original approach would need ~16 CPU-days/season — Task 2's own acceptance criteria required the real pnpm harness --seasons 2022-2026 command to complete; the fix is mathematically exact, proven by a new equivalence test against the untouched solveRidgeOpr
- [Phase ?]: reports/ (harness default --out) added to .gitignore — Generated artifact was untracked-but-not-ignored, against the failure log's keep-generated-artifacts-out-of-git rule
- [Phase ?]: Offseason events excluded from breakdown-map reconciliation samples — self-reported score_breakdown for offseason events is not guaranteed to match the official schema (found live: missing adjustPoints entirely); matches selectMatchesChronological's existing excludeOffseason discipline
- [Phase ?]: ALGO-03 (Sigma1) deliberately NOT marked complete in REQUIREMENTS.md despite appearing in plan 02-02's frontmatter requirements list — no Sigma1 code exists yet; only ALGO-02 reflects what plan 02-02 actually shipped
- [Phase ?]: carryover.ts owns EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION (moved from epa.ts) -- the only acyclic import direction since epa.carrySeason needs carryover.ts's epaCarryover
- [Phase ?]: epaCarryover sources the normalized<->points conversion scale from the outgoing season's own per-team point-total mean/sd, since the incoming season has no observations yet at a boundary -- documented approximation
- [Phase ?]: The head-to-head table replaces (not duplicates) the per-algorithm score table -- one home per Brier/accuracy figure, never two groupings that could drift
- [Phase ?]: SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io reproducibly 500s, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead
- [Phase ?]: Fixed a pre-existing (02-02) circular import between breakdown/index.ts and every season file, discovered running the real pnpm harness command Task 2 required -- extracted shared constants into new breakdown/constants.ts leaf module
- [Phase ?]: D-04's opposing-alliance foulsCommitted attribution implemented explicitly in Sigma1's predict() -- each side's own foulsCommitted entry represents points ITS fouls cost the OPPONENT
- [Phase ?]: Sigma1 cold-start mean/consistency seed from a live league-wide running ExpandingStats per component rather than a fixed placeholder constant alone
- [Phase ?]: Sigma1's carrySeason reuses carryover.ts's epaCarryover unchanged -- posterior variance re-inflates to the cold-start prior at a season boundary, consistency carries forward decayed by SIGMA1_CONSISTENCY_CARRY_DECAY (D-17)
- [Phase ?]: T-02-01's second finite-value gate added in sigma1/index.ts update() -- a value surviving the per-season Zod parse boundary can still be produced non-finite by distributeResidual's degenerate branch
- [Phase ?]: Prediction/metric-history sidecars open with fs 'w' (truncate) not 'a' (append) -- a fresh replay produces a fresh sidecar per season, never a mix of two runs' lines
- [Phase ?]: redComponents/blueComponents required on PersistedPredictionRecord but validly {} for OPR (no components in its Prediction type) -- D-24's full-vector shape is a schema capability, not a per-algorithm mandate
- [Phase ?]: replay.ts needed zero code changes for D-28 -- 02-01's onMatchComplete hook already fired after update() with post-update state; only test coverage was missing
- [Phase ?]: cli.ts ALGORITHMS registry now carries 5 entries (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf) -- D-12's three link modes scored side by side in one real 2024 run, verified: identical predicted scores, distinct win probabilities

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Clean-slate mandate: no pre-v3 code, models, or tuned values may be consulted or ported (REBUILD_SPEC.md). Only the failure log carries over.
- Cloudflare free-tier 10 ms Worker CPU is the load-bearing constraint; Sigma1's per-match update cost must be measured early (Phase 2) so Phase 4's incremental path is feasible.
- Per-season RP rules for 2022–2026 must be verified against official game manuals in Phase 3 — generic parsing will not work.
- REQUIREMENTS.md originally stated 34 v1 requirements; the actual count is 38. Corrected in the traceability section.
- epa.ts's predict() may attribute foulsCommitted to the wrong side's score (sums a team's own learned foulsCommitted into its own score rather than the opponent's) -- unverified impact, logged to WINDOWS.md entry 3, not fixed by plan 02-04

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-14T06:33:24.672Z
Stopped at: Completed 02-05-PLAN.md
Resume file: None
