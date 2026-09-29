---
phase: 01-data-foundation-evaluation-harness
plan: 03
subsystem: data-pipeline
tags: [tba-api, better-sqlite3, zod, vitest, sqlite]

# Dependency graph
requires:
  - phase: 01-data-foundation-evaluation-harness (Plan 02)
    provides: Tracer's single-event corpus schema, TBA client, normalize.ts, and the AlgorithmModule/harness contract this plan expands into a full backfill
provides:
  - "Full 2022-2026 corpus: teams, events, matches populated and re-verified idempotent (1699 requests first run, 1585/1699 304s on repeat, zero match payloads re-downloaded)"
  - "Deterministic chronological read: selectMatchesChronological is a proven total order (event_key, comp-level play order, set_number, match_number tie-break) with eventKey/year/excludeOffseason filter options"
  - "Single-writer corpus lock (PID-stamped, stale-lock reclaim) — a second concurrent writer fails fast instead of interleaving writes"
  - "TbaRequestCounter + throttled tbaFetch — every ingest run's request/304 volume is measured and persisted to ingest_runs"
  - "detectReplay — pure, sticky diff-on-upsert synthesizing D-08's replay flag (TBA exposes no such field)"
  - "packages/ingest/cli.ts (`pnpm ingest --years|--year|--event [--force]`) — the backfill entry point"
affects: ["01-04", "01-05", "01-06"]

# Actuals (#2632)
actuals:
  tokens: 14500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "detectReplay lives in packages/ingest/normalize.ts as a pure function (existing row, incoming row) -> {replayed, replayDetectedAt}; packages/corpus/db.ts's upsertMatch is the sole caller, reading the prior row via selectExistingMatch first — a caller cannot bypass the check by upserting directly"
    - "Single-writer file lock: a PID-stamped `<corpus-path>.lock` sidecar file; a lock whose owning PID is no longer alive is treated as stale and reclaimed automatically, so an interrupted run can always resume"
    - "teams-list pagination is deliberately un-conditional (no ETag) — a 304's bodyless response can't signal the terminal empty page; cheap relative to the match-payload volume conditional caching is meant to bound"
    - "ingest_runs is written incrementally (start, after each season, at completion) so an interrupted process leaves an accurate, identifiable partial record rather than an all-or-nothing write"

key-files:
  created:
    - packages/corpus/db.test.ts
    - packages/ingest/tbaClient.test.ts
    - packages/ingest/normalize.test.ts
    - packages/ingest/cli.ts
  modified:
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/ingest/tbaClient.ts
    - packages/ingest/normalize.ts
    - packages/ingest/schemas.ts
    - packages/harness/cli.ts
    - package.json

key-decisions:
  - "Task 1's db.ts commit kept the tracer's inline replay diff (not yet calling a not-yet-existent detectReplay) so each task's commit compiles and passes its own <verify> independently; Task 3 then added the pure detectReplay in normalize.ts and refactored upsertMatch to delegate to it, removing the duplicated inline logic — preserves atomic, self-consistent per-task commits per the plan's stated task/file boundaries."
  - "teams-list pagination (fetchAllTeams) never sends If-None-Match: a cached 304 response carries no body, so pagination termination can't be determined from a cache hit alone. Always fetching it fresh is cheap (~9-23 pages/year) relative to the actual request-volume driver (event-matches, ~300+/year), which does use full ETag conditional caching."
  - "The local dev corpus (data/corpus.sqlite, gitignored) predated this plan's schema additions (teams, ingest_runs, replay_detected_at) and was deleted and rebuilt from scratch rather than migrated — CREATE TABLE IF NOT EXISTS is idempotent for new tables but not for new columns on existing ones, and no ALTER-based migration exists yet (out of this plan's scope). The corpus is disposable/regenerable by design (D-05's raw-payload storage means nothing is lost by refetching)."
  - "--event mode (single-event ingestion, matching the harness CLI's existing pattern) does not call fetchAllTeams for that event's season — team_number/nickname only come from the bulk --years/--year path. This mirrors COVERAGE.md's own reasoning against redundant per-entity fetches."

requirements-completed: [DATA-01, DATA-02]

coverage:
  - id: D1
    description: "Corpus schema covers teams/events/matches/http_cache/ingest_runs with every DATA-02 quirk column, and selectMatchesChronological is a proven deterministic total order (sort_time, then event_key, comp-level play order, set_number, match_number) with eventKey/year/excludeOffseason filters"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts (7 tests) — total-order tie-break, upsert idempotency, offseason exclusion, single-writer lock (throws + reopen-after-close), upsertTeam idempotency, recordIngestRun/findIncompleteIngestRuns"
        status: pass
    human_judgment: false
  - id: D2
    description: "TBA client hardened for a full backfill: TbaRequestCounter tallies 200/304 separately, a named-constant throttle is enforced inside tbaFetch (no call site can bypass it), and the client exposes helpers for exactly the eight COVERAGE.md INTEGRATE capabilities and none marked OPT-OUT"
    requirement: DATA-01
    verification:
      - kind: unit
        ref: "packages/ingest/tbaClient.test.ts (9 tests) — If-None-Match header, 304 cache-hit shape, ETag persistence on 200, 500 throws with path+status, counter tallies, throttle timing, capability-surface enumeration, teams pagination"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every TBA data quirk DATA-02 names is an explicit, queryable flag: surrogates, disqualifications, replays (sticky diff-on-upsert via detectReplay), missing score breakdowns (never zero-defaulted), offseason events (event_type 99), unplayed matches (NULL not 0), ties, and RP awards read from the recon-observed 'rp' field"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "packages/ingest/normalize.test.ts (12 tests) — one test per behavior named in Task 3's <behavior> block"
        status: pass
    human_judgment: false
  - id: D4
    description: "`pnpm ingest --years 2022-2026` populates the corpus with teams, events, and matches for all five seasons, and a second consecutive run downloads no match payload (all event/match endpoints return 304)"
    requirement: DATA-01
    verification:
      - kind: other
        ref: "Real run against TBA: first run 1699 requests (1 cache hit from a pre-existing tracer-fetched event, 1698 fresh); second run 1699 requests, 1585 cache hits (304), only 114 fresh — all 114 accounted for by teams-list pagination pages + the status check, both deliberately un-conditional; zero event/match 200s in the second run's log. Corpus verified populated for all 5 seasons (18215-23884 matches/year), 4655 teams, non-empty surrogate and dq examples found by direct query."
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 3: Full 2022-2026 Ingestion — Corpus Total Order, Hardened TBA Client, Quirk Flags Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**Corpus schema completed with teams/ingest_runs/replay provenance and a proven deterministic chronological total order; TBA client hardened with throttling, per-run request counting, and the full eight-capability surface; every DATA-02 quirk (surrogates, dqs, replays, missing breakdowns, offseason) synthesized as an explicit flag and unit-tested; a real backfill populated all five 2022-2026 seasons (108,772 matches, 4,655 teams, 1,580 events) and a repeat run proved conditional-request savings — 1,585 of 1,699 requests came back 304 with zero match payloads re-downloaded.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-13T04:26:00Z
- **Completed:** 2026-08-13T04:49:00Z
- **Tasks:** 3
- **Files modified:** 11 (4 new + 7 modified)

## Accomplishments
- `packages/corpus/schema.sql` + `db.ts`: added `teams`, `ingest_runs` tables and a `replay_detected_at` column; `selectMatchesChronological` now breaks `sort_time` ties deterministically (event_key, comp-level play order, set_number, match_number) and accepts `eventKey`/`year`/`excludeOffseason` filters; a PID-stamped single-writer lock (with stale-lock reclaim for crashed processes) makes a second concurrent writer fail fast instead of corrupting the corpus
- `packages/ingest/tbaClient.ts`: `TbaRequestCounter` (200/304 tallies), a named-constant 100ms throttle enforced inside `tbaFetch` itself, and typed helpers for exactly the eight COVERAGE.md INTEGRATE capabilities (status, teams-list w/ pagination, team-detail, events-list, event-detail, event-teams, event-matches, match-detail) — none marked OPT-OUT
- `packages/ingest/normalize.ts`: `detectReplay`, a pure, sticky diff over score-bearing fields that synthesizes D-08's replay flag (TBA exposes no such field per RESEARCH.md Pitfall 1); wired as the sole path through `db.ts`'s `upsertMatch` so no caller can bypass it
- `packages/ingest/normalize.test.ts`: 12 tests, one per DATA-02 quirk behavior (surrogates, dqs, replay set/unchanged/first-time-not-a-replay/sticky, offseason event_type flag, missing breakdown, unplayed match, tie, RP field)
- `packages/ingest/cli.ts`: `pnpm ingest --years 2022-2026 | --year 2024 | --event 2024casj [--force]` — checks TBA's datafeed status once and aborts if it's down, ingests per-season teams and events then per-event matches, records `ingest_runs` provenance incrementally
- Ran the real backfill twice against 2022-2026: first run 1699 requests populated all five seasons; second run reported 1585/1699 cache hits (304), with the remaining 114 fresh requests fully accounted for by the deliberately un-conditional teams-list pagination and the status check — zero event or match payloads were re-downloaded

## Task Commits

Each task was committed atomically:

1. **Task 1: Complete the corpus schema and give the chronological read a total order** - `3e2321bb` (feat)
2. **Task 2: Harden the TBA client for a full backfill — caching, throttling, counting, resumability** - `7e7d9797` (feat)
3. **Task 3: Make every TBA data quirk an explicit flag, and backfill 2022-2026** - `7b0f9f2d` (test)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/corpus/schema.sql` - Added `teams`, `ingest_runs` tables; `replay_detected_at` column
- `packages/corpus/db.ts` - `upsertTeam`, `recordIngestRun`, `findIncompleteIngestRuns`, `selectExistingMatch`; `selectMatchesChronological` total order + filters; single-writer lock; `upsertMatch` delegates to `detectReplay`
- `packages/corpus/db.test.ts` - Total-order, idempotency, offseason-exclusion, lock, team/run tests
- `packages/ingest/tbaClient.ts` - `TbaRequestCounter`, `THROTTLE_INTERVAL_MS`, eight capability helpers, `fetchAllTeams` pagination
- `packages/ingest/tbaClient.test.ts` - Conditional-request, throttle, counter, capability-surface tests
- `packages/ingest/normalize.ts` - `detectReplay` (pure sticky diff)
- `packages/ingest/normalize.test.ts` - One test per DATA-02 quirk behavior
- `packages/ingest/schemas.ts` - `tbaStatusSchema`, `tbaTeamSchema`/`tbaTeamListSchema`, `tbaEventListSchema`
- `packages/ingest/cli.ts` - Backfill CLI (`--years`/`--year`/`--event`/`--force`)
- `packages/harness/cli.ts` - Updated to `selectMatchesChronological`'s new options-object signature
- `package.json` - `ingest` script now runs via `tsx --env-file=.env`

## Decisions Made
- Task 1's `db.ts` commit deliberately kept the tracer's inline replay diff rather than importing a `detectReplay` that Task 3 hadn't added yet, so each task's commit compiles and passes its own `<verify>` independently — Task 3 then introduced the pure function and refactored `upsertMatch` to call it, removing the duplicated inline logic
- `fetchAllTeams` never sends `If-None-Match`: a cached 304's bodyless response can't signal the terminal empty page for pagination, and teams-list is cheap (~9-23 pages/year) relative to the actual request-volume driver (event-matches)
- The local dev corpus predated this plan's new columns/tables and was deleted and rebuilt from scratch rather than migrated — it's a gitignored, disposable artifact by design (D-05's raw-payload storage means nothing is lost by refetching), and no `ALTER TABLE` migration path exists yet (out of scope)
- `--event` single-event mode does not fetch that event's season team roster (matching COVERAGE.md's own anti-redundant-fetch reasoning) — team metadata comes from the bulk `--years`/`--year` path only

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/harness/cli.ts` call site broken by `selectMatchesChronological`'s new options-object signature**
- **Found during:** Task 1, `pnpm typecheck` after changing `selectMatchesChronological(db, eventKey: string)` to `selectMatchesChronological(db, options: ChronologicalQueryOptions)`
- **Issue:** The interface change mandated by Task 1's acceptance criteria (accept `eventKey`/`year`/`excludeOffseason` filters) broke the harness CLI's existing single-string call
- **Fix:** Updated the one call site to `selectMatchesChronological(db, { eventKey })`
- **Files modified:** `packages/harness/cli.ts`
- **Verification:** `pnpm typecheck` passes; `pnpm harness --event 2024casj --algorithm opr` re-run end-to-end, still works (304s on both requests)
- **Committed in:** `3e2321bb` (Task 1 commit)

**2. [Rule 3 - Blocking] `pnpm ingest` script did not load `.env`, so `TBA_API_KEY` was never in `process.env`**
- **Found during:** Task 3, first `pnpm ingest --years 2022-2026` attempt
- **Issue:** `package.json`'s `ingest` script was `tsx packages/ingest/cli.ts` (no `--env-file`) — the same gap Plan 02's SUMMARY documented and fixed for the `harness` script, not yet applied to `ingest`
- **Fix:** Changed the script to `tsx --env-file=.env packages/ingest/cli.ts`
- **Files modified:** `package.json`
- **Verification:** `pnpm ingest --event 2024casj` ran successfully, reading the key from `.env`
- **Committed in:** `7b0f9f2d` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking-issue fixes — one a cascading interface-change call-site update, one a repeat of Plan 02's env-file gap). No Rule 4 architectural changes were needed.
**Impact on plan:** Both fixes were necessary for the plan's own stated acceptance criteria to be satisfiable at all (Task 1's filter options; Task 3's real backfill run needing the API key). No scope creep — no plan file was edited, no new artifacts were added beyond what the plan specified.

## Issues Encountered
- The pre-existing local `data/corpus.sqlite` (from Plan 02's tracer, gitignored) predated this plan's schema additions and had to be deleted and rebuilt from scratch (`no such column: replay_detected_at` on first `--force` run against it) — expected consequence of additive-only `CREATE TABLE IF NOT EXISTS` DDL with no migration path; documented as a Decision above, not a defect. The full backfill was re-run from the clean corpus and both verification runs (first + repeat) are against that rebuilt corpus.

## User Setup Required

None - no external service configuration required beyond the existing `.env` (already present from Plan 01/02).

## Next Phase Readiness
- The full 2022-2026 corpus is populated, quirk-flagged, and provenance-tracked — Plan 04 (OPR season-scope expansion, D-07 surrogate exclusion) and Plan 05/06 (harness expansion, EPA, report) can read directly from `data/corpus.sqlite` without re-ingesting
- `detectReplay` and the single-writer lock are proven by both unit tests and the real two-run backfill (zero replays detected in the actual 2022-2026 dataset, which is expected and does not indicate a gap — the detector's correctness is established by `normalize.test.ts`'s direct fixture tests)
- Disqualification data (`red_dqs`/`blue_dqs`) is captured per Plan 03's carried-forward Open Question 3, but no ratings-impact policy is decided — that remains Plan 04's job
- No blockers identified for Plan 04

---
*Phase: 01-data-foundation-evaluation-harness*
*Completed: 2026-08-13*

## Self-Check: PASSED

All 11 files confirmed present on disk (schema.sql, db.ts, db.test.ts, tbaClient.ts, tbaClient.test.ts, normalize.ts, normalize.test.ts, schemas.ts, cli.ts, harness/cli.ts, package.json). All three task commit hashes (`3e2321bb`, `7e7d9797`, `7b0f9f2d`) confirmed present in `git log`. Full test suite (`pnpm vitest run`) passes 40/40 across 4 files; `pnpm typecheck` passes with zero errors.
