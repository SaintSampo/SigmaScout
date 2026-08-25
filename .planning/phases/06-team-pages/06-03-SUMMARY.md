---
phase: 06-team-pages
plan: 03
subsystem: database
tags: [sqlite, better-sqlite3, tba-api, zod, ingest-pipeline, etag-caching]

requires:
  - phase: 01-data-pipeline-evaluation-harness
    provides: packages/corpus (SQLite corpus, schema.sql, openCorpus, ETag http_cache table), packages/ingest (tbaFetch, TbaClientContext, tbaEventListSchema/tbaMatchListSchema patterns)
provides:
  - team_media corpus table (additive, keyed by team_key+year) holding a resolved robot-photo URL or an honest null per team-year
  - upsertTeamMedia/selectTeamMediaForYear/selectTeamKeysForYear corpus accessors
  - fetchTeamMedia TBA client call and tbaMediaSchema/tbaMediaListSchema
  - pickRobotPhotoUrl photo-type allowlist picker (packages/ingest/media.ts)
  - --media-only / ingestSeasonMediaOnly CLI pass and the ingest:media root script
  - a real, measured, filled team_media table for 2022-2026 (17,229 real team-year rows, 7,364 with a resolved photo)
affects: [06-04-publisher-team-artifact-fields]

actuals:
  tokens: 8308
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Photo-type allowlist filtered BEFORE reading direct_url, then preferred-else-first tie-break, for a heterogeneous TBA type-discriminated array"
    - "Season-summary logging that re-reads true stored state from the corpus after the loop, rather than trusting an in-memory tally that a resumed/interrupted run can under-report"

key-files:
  created:
    - packages/ingest/media.ts
    - packages/ingest/media.test.ts
  modified:
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - packages/ingest/tbaClient.ts
    - packages/ingest/tbaClient.test.ts
    - packages/ingest/schemas.ts
    - packages/ingest/cli.ts
    - package.json
    - .planning/phases/06-team-pages/COVERAGE.md

key-decisions:
  - "A 404 on a team key TBA doesn't recognize (a genuine placeholder/non-team key found live in the corpus) is treated as 'no media,' logged and skipped, not a run-aborting error — the shared tbaFetch throw-on-non-OK behavior is otherwise unchanged for every other TBA endpoint"
  - "Photo-rate is measured per-season by re-reading team_media from the corpus after each season's loop, not accumulated from resolvedCount in memory, so an interrupted-then-resumed season reports its true resolved rate"
  - "2025/2026's below-40% overall photo rate is real season variance (driven by a growing high-numbered/rookie-team cohort with less TBA media coverage), not a picker defect — verified by cohort breakdown and live spot-checks against TBA, documented rather than treated as a failed gate"

requirements-completed: [TEAM-02]

coverage:
  - id: D1
    description: "team_media corpus table (additive CREATE TABLE IF NOT EXISTS) plus upsertTeamMedia/selectTeamMediaForYear/selectTeamKeysForYear accessors, including the null-imageUrl 'checked, none found' case"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts — 'team_media — corpus table and accessors (plan 06-03 Task 1)' (7 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetchTeamMedia TBA client call and tbaMediaSchema/tbaMediaListSchema modeling TBA's Media_Base loosely (type as a plain string)"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "packages/ingest/tbaClient.test.ts — 'fetchTeamMedia issues /team/{key}/media/{year} and forwards a cached ETag as a conditional request header (plan 06-03 Task 2)'"
        status: pass
    human_judgment: false
  - id: D3
    description: "pickRobotPhotoUrl: PHOTO_MEDIA_TYPES allowlist applied before direct_url is read, https:// scheme required, preferred-else-first tie-break, avatar/social/video types never selected"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "packages/ingest/media.test.ts — pickRobotPhotoUrl (9 cases: preferred selection, first-survivor fallback, avatar+youtube-channel-only returns null, missing direct_url skipped, unknown future type ignored, non-https skipped, empty array, avatar never selected in a mixed array, cdphotothread/instagram-image selectable)"
        status: pass
    human_judgment: false
  - id: D4
    description: "--media-only CLI pass (ingestSeasonMediaOnly) run for real against data/corpus.sqlite across 2022-2026, with measured request count, cache hits, wall clock, and per-season photo rate recorded"
    requirement: TEAM-02
    verification:
      - kind: integration
        ref: "real `tsx --env-file=.env packages/ingest/cli.ts --media-only --year <Y>` runs, one per season 2022-2026, foreground; SQL assertions below"
        status: pass
      - kind: other
        ref: "SQL: SELECT year, count(*), sum(image_url IS NOT NULL) FROM team_media GROUP BY year — 5 seasons, min 3062 rows/season, 0 non-https image_url rows, 0 avatar media_type rows"
        status: pass
    human_judgment: false

duration: ~2h (code) + ~1h wall clock across foreground ingest calls (multi-hour environment gap between sub-steps excluded — see Performance)
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 3: Team Media Ingest Summary

**Pipeline resolves and stores a real, measured robot-photo answer for 17,229 team-years (2022-2026) via a new `team_media` corpus table, a type-allowlist picker, and a `--media-only` ingest pass — 42.7% resolved a photo, 0 client-side TBA key surface.**

## Performance

- **Tasks:** 3/3 completed
- **Files modified:** 9 (2 new, 7 modified) plus 1 out-of-scope-but-authorized doc correction (COVERAGE.md)
- **Commits:** 4 (`ff51898a`, `310b482b`, `685c2676`, `b2a850b7`)
- **Wall clock — code (Tasks 1-2):** roughly 45 min of read/write/test iteration.
- **Wall clock — real ingest (Task 3):** measured foreground command durations sum to **~50 minutes** across all invocations (first pass across 5 seasons + 2 corroborating second-pass seasons + one retried season). The full session's calendar span additionally includes a multi-hour idle gap between the 2025 and 2026 first-pass commands (an environment-level pause between the coordinator's intervention and the retry, not active execution time) — excluded from the duration figure above per the instruction to report real measured work, not idle wall clock.

## Accomplishments

- `team_media` table added to `packages/corpus/schema.sql` (`CREATE TABLE IF NOT EXISTS`, additive) with `upsertTeamMedia`/`selectTeamMediaForYear`/`selectTeamKeysForYear` in `packages/corpus/db.ts` — a photoless team's row round-trips with `image_url IS NULL`, a real stored answer, not an absent row.
- `fetchTeamMedia` added to `packages/ingest/tbaClient.ts` mirroring `fetchTeamDetail`'s exact shape; `tbaMediaSchema`/`tbaMediaListSchema` added to `packages/ingest/schemas.ts` modeling `type` as a plain string so an unknown future TBA media type degrades to "not allowlisted" rather than aborting a parse (T-06-11).
- `packages/ingest/media.ts` — `pickRobotPhotoUrl` filters to `PHOTO_MEDIA_TYPES = ["imgur", "cdphotothread", "instagram-image"]` **before** reading `direct_url`, requires a non-empty `https://` URL, then applies preferred-else-first. An `avatar` entry's inline base64 payload can never reach an `<img src>` (threat T-06-04) — verified directly: `mediaType` is never `"avatar"` across all 17,229 real stored rows.
- `--media-only` CLI flag and `ingestSeasonMediaOnly` wired into `packages/ingest/cli.ts`, plus the root `ingest:media` script — the TBA key reaches the process only via `tsx --env-file=.env`, the established pattern.
- **A real ingest run filled `team_media` for every team-year 2022-2026**: 17,229 rows, 7,364 (42.75%) with a resolved photo. Zero rows with a non-`https://` `image_url`. Zero rows with `media_type = 'avatar'`. `ingest_runs` records each season's run as `completed = 1`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The team_media corpus table and its accessors** — `ff51898a` (feat)
2. **Task 2: The TBA media call and the photo-type allowlist picker** — `310b482b` (feat)
3. **Task 3: The --media-only ingest pass, run for real across 2022-2026** — `685c2676` (feat, cli.ts wiring) + `b2a850b7` (fix, a real bug found running the actual command — see Deviations)

## Files Created/Modified

- `packages/corpus/schema.sql` — `team_media` table, additive `CREATE TABLE IF NOT EXISTS`
- `packages/corpus/db.ts` — `upsertTeamMedia`, `selectTeamMediaForYear`, `selectTeamKeysForYear`, `CorpusTeamMedia` type
- `packages/corpus/db.test.ts` — 7 new cases: pre-existing-corpus migration, insert/read, upsert-overwrite, null round trip, `selectTeamKeysForYear` union/dedup, offseason exclusion
- `packages/ingest/tbaClient.ts` — `fetchTeamMedia`
- `packages/ingest/tbaClient.test.ts` — 1 new case (path + conditional-request header)
- `packages/ingest/schemas.ts` — `tbaMediaSchema`, `tbaMediaListSchema`
- `packages/ingest/media.ts` (new) — `PHOTO_MEDIA_TYPES`, `pickRobotPhotoUrl`
- `packages/ingest/media.test.ts` (new) — 9 cases from real-shaped fixtures
- `packages/ingest/cli.ts` — `--media-only` flag, `CliOptions.mediaOnly`, `ingestSeasonMediaOnly`, `main()` branch wiring, 404-tolerance + accurate season-summary fix
- `package.json` — `ingest:media` script
- `.planning/phases/06-team-pages/COVERAGE.md` — cost paragraph corrected with real measured figures (plan action text explicitly required this correction "if the observed figure differs materially")

## Decisions Made

- A 404 from TBA's media endpoint against a team key with no corpus `teams` row is treated as "no media for this team-year" and the season continues — this is a genuine "nothing to fetch" answer for a placeholder/non-existent key, not TBA schema drift, so it must not abort the run the way a real schema-shape failure should.
- The per-season summary now re-reads `team_media`'s true stored state via `selectTeamMediaForYear` rather than trusting an in-memory `resolvedCount` — a resumed/interrupted season's in-memory tally only reflects that invocation's fresh fetches, silently omitting rows already resolved by an earlier partial attempt.
- 2025/2026's overall photo rate (38.5%, 37.7%) falling just under the plan's 40-95% band was investigated per the plan's own acceptance-criteria instruction, not dismissed: a cohort breakdown (team number `< 9000` vs `>= 9000`) shows every season's established-team cohort sits at 40.2-53.1%, consistently within band; it is specifically the high-numbered/rookie cohort (9 teams in 2022 growing to 942 in 2026) — which has genuinely less TBA-uploaded media, confirmed by live spot-checks against TBA for `frc100`/`frc10000`/`frc118`/`frc254`/`frc9999` — that pulls the recent two seasons' blended average under 40%. This is real, explainable season demographic variance, not a picker defect. See "Investigation: below-band photo rates" below for the full evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ingestSeasonMediaOnly` aborted the entire season on a single 404 from a placeholder team key**
- **Found during:** Task 3, running the real `pnpm ingest:media --years 2022-2026`-equivalent commands
- **Issue:** `2024mdsev_qm73`/`2024mdsev_qm74` (an unresolved playoff-bracket match pair) have every alliance slot recorded as team key `"frc0"` — a placeholder with no corresponding row in the corpus `teams` table. `fetchTeamMedia` against `/team/frc0/media/2024` returns HTTP 404; the shared `tbaFetch` throws hard on any non-200/304 status, which propagated up and aborted the whole 2024 season mid-run (and later, a second unrelated key `frc9969` hit the same case).
- **Fix:** `ingestSeasonMediaOnly` now wraps the per-team `fetchTeamMedia` call in a try/catch, matches `HTTP 404` in the thrown error message specifically, counts and logs the skip, and continues to the next team key. Every other error (network failure, 500, schema-parse failure) still rethrows unchanged — this is scoped narrowly to "team key TBA has never heard of," not a general error-swallowing change.
- **Files modified:** `packages/ingest/cli.ts`
- **Verification:** Re-ran season 2024 to completion (3477 real rows, 0 further 404-related aborts across all 5 seasons — only 2 total 404s hit, both confirmed genuine placeholder keys via direct corpus inspection).
- **Committed in:** `b2a850b7`

**2. [Rule 1 - Bug] Season-summary photo-rate log line under-reported on a resumed run**
- **Found during:** Task 3, same real-run session — the 2024 season's printed "resolved photos" percentage (11.9%) was implausibly low next to 2022/2023's real rates (40.1%/46.8%) after a resume.
- **Issue:** `resolvedCount` only incremented inside the `freshCount` branch (a 200 response), never for a 304 cache hit — so after an interrupted-then-resumed season, rows resolved by an earlier partial attempt (now served as 304s) were invisible to the printed rate, though correctly present in the corpus itself.
- **Fix:** The season summary now calls `selectTeamMediaForYear(db, year)` after the loop and computes the true resolved count over every stored row for that season, regardless of which invocation wrote it.
- **Files modified:** `packages/ingest/cli.ts`
- **Verification:** Cross-checked the corrected log line's rate against a direct SQL query for every season (2022: 40.1%, 2023: 46.8%, 2024: 51.1%, 2025: 38.5%, 2026: 37.7% — log line and SQL agree exactly).
- **Committed in:** `b2a850b7`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs discovered running the real command the plan required).
**Impact on plan:** Both fixes were necessary for the real run to complete and for the SUMMARY's measured figures to be accurate; no scope creep. `COVERAGE.md`'s cost paragraph was also corrected per the plan's own explicit instruction to do so if the observed figure differs materially — not a deviation, a plan-required follow-through.

## Investigation: below-band photo rates (2025: 38.5%, 2026: 37.7%)

The plan's acceptance criteria set a 40-95% expected band (from a 20-team sample, 15/20 = 75%, measured against 2024 only) and required investigation before writing the SUMMARY if a season fell outside it. Two seasons did. Investigation, not dismissal:

| Year | Overall rate | Team # < 9000 (established) | Team # >= 9000 (recent/rookie) | Cohort size (>=9000) |
|------|--------------|------------------------------|----------------------------------|------------------------|
| 2022 | 40.1% | 40.2% | 0.0% | 9 |
| 2023 | 46.8% | 47.4% | 39.5% | 258 |
| 2024 | 51.1% | 53.1% | 40.1% | 539 |
| 2025 | 38.5% | 42.1% | 25.6% | 808 |
| 2026 | 37.7% | 43.2% | 21.9% | 942 |

The established-team cohort sits at 40.2-53.1% in **every** season — always within or above the plan's band. The high-numbered/rookie cohort has grown from 9 to 942 teams over 2022-2026 (FRC's real rookie growth), and that cohort consistently has less TBA-tracked media (0-40.1%). The two recent seasons' blended averages dip under 40% purely because the low-coverage cohort is now a much larger share of the total pool — a demographic shift, not a regression in picker correctness.

Confirmed directly against live TBA data for 5 sample teams (`frc100`, `frc10000`, `frc118`, `frc254`, `frc9999`, 2025 season): `frc100` genuinely has only an `avatar` entry (correctly resolves to no photo), `frc10000`/`frc9999` genuinely have zero media entries at all (correctly resolves to no photo), `frc118`/`frc254` genuinely have a `preferred: true` `imgur` entry (correctly resolved and matches the stored row).

**Conclusion:** the picker is correct; the plan's 40-95% band was calibrated from too small and too season-specific a sample to hold as a blanket expectation across a growing, demographically shifting 5-season team pool. Recorded here rather than silently treated as a passing gate.

## Real measured ingest figures (Task 3)

- **Distinct (team, year) pairs requested:** 17,231 — matches the pre-run projection (`17,231`) to within the 2 genuine placeholder-key 404s (`frc0`, `frc9969`), which are not stored as rows.
- **Rows stored:** 17,229 (2022: 3,062 · 2023: 3,290 · 2024: 3,477 · 2025: 3,691 · 2026: 3,709)
- **Rows with a resolved photo:** 7,364 total (42.75%) — 2022: 1,228 (40.1%) · 2023: 1,540 (46.8%) · 2024: 1,776 (51.1%) · 2025: 1,420 (38.5%) · 2026: 1,400 (37.7%)
- **First-pass wall clock, precisely-timed seasons:** 2025 (3,691 fresh requests) = 7.2 min (~117 ms/request); 2026 (3,710 fresh requests) = 13.4 min (~217 ms/request). 2024 required two attempts due to the 404 bug above (5.1 min + 6.8 min = 11.9 min for 3,479 team-key attempts). 2022+2023 (6,352 requests) completed inside the original background invocation in an estimated ~11 min (imprecise — see "Deviation from the coordinator's redo instructions" below).
- **Total first-pass wall clock across all 5 seasons:** approximately **44 minutes** — about 1.5x the pre-run ~28.7-minute projection. The projection assumed the 100ms throttle floor with zero added network latency; real per-request time measured 118-217ms depending on live conditions. `COVERAGE.md` corrected accordingly.
- **Second-pass (cache-hit) proof, two seasons re-run in full:** 2022 — 0 fresh / 3,062 cache hits (vs. first pass's 3,062 fresh / 0 cache hits); 2026 — 0 fresh / 3,709 cache hits (vs. first pass's 3,710 fresh / 0 cache hits). ETag caching is engaged and effective; request count and throttle wait are unchanged by caching (as documented), only bandwidth is saved.
- **`ingest_runs` bookkeeping:** every season's run recorded `completed = 1` after finishing; the two aborted attempts (crashed on the frc0 bug, and one lost to an environment restart) remain recorded with `completed = 0`, correctly identifiable as interrupted per the existing `findIncompleteIngestRuns` mechanism — no special handling was needed.

## Note on execution path (background-task reliability)

The coordinator flagged that an earlier background-launched ingest run (`run_in_background: true`) appeared to have never executed, based on an 80-byte log file and no live process found via `ps`. Direct investigation at the time of the report found this was **not accurate for this specific run**: `tasklist` (native Windows) showed the `node.exe` process genuinely alive and the corpus WAL file's mtime was actively advancing at the moment of the check — the process was real and had already completed 2022 and 2023 (6,352 real rows) before crashing on the `frc0` bug once it reached 2024. That partial progress was kept (SQLite commits are durable per-write); nothing was redone for 2022/2023. All subsequent runs (2024 onward, plus both second-pass corroboration runs) were executed exactly as the coordinator's redo instructions specified: one season at a time, foreground, blocking, with an explicit 600000ms timeout per call, no `run_in_background`.

## Issues Encountered

None beyond the two Rule-1 bugs documented above, both found running the real command and both fixed before the run was trusted.

## User Setup Required

None — no external service configuration required. `TBA_API_KEY` was already present in `.env` (Phase 1 setup), confirmed present with a length-only check, never printed.

## Next Phase Readiness

`team_media` is filled for every team-year in 2022-2026 and ready for plan 06-04's publisher pass to read via `selectTeamMediaForYear` and bake `robotImageUrl` into the published team artifact. No publisher wiring or schema field was added in this plan, matching the plan's stated scope split with 06-02/06-04.
