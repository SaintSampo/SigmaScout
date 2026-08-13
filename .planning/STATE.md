---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 01
current_phase_name: data-foundation-evaluation-harness
status: executing
stopped_at: Completed 01-04-PLAN.md
last_updated: "2026-08-13T05:04:11.481Z"
last_activity: 2026-08-12
last_activity_desc: Phase 01 execution started
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 6
  completed_plans: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-12)

**Core value:** Predictions that are *measurably* better than Statbotics — proven by walk-forward, Brier-scored backtests — delivered on pages that load fast.
**Current focus:** Phase 01 — data-foundation-evaluation-harness

## Current Position

Phase: 01 (data-foundation-evaluation-harness) — EXECUTING
Plan: 5 of 6
Status: Ready to execute
Last activity: 2026-08-12 — Phase 01 execution started

Progress: [███████░░░] 67%

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

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Clean-slate mandate: no pre-v3 code, models, or tuned values may be consulted or ported (REBUILD_SPEC.md). Only the failure log carries over.
- Cloudflare free-tier 10 ms Worker CPU is the load-bearing constraint; Sigma1's per-match update cost must be measured early (Phase 2) so Phase 4's incremental path is feasible.
- Per-season RP rules for 2022–2026 must be verified against official game manuals in Phase 3 — generic parsing will not work.
- REQUIREMENTS.md originally stated 34 v1 requirements; the actual count is 38. Corrected in the traceability section.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-13T05:04:03.162Z
Stopped at: Completed 01-04-PLAN.md
Resume file: None
