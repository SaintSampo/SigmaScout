---
phase: 07-event-pages
plan: 03
subsystem: database
tags: [zod, tba-api, ingest, sqlite, tdd]

requires:
  - phase: 07-event-pages
    provides: "event_alliances table and its typed accessors (upsertEventAlliance, selectEventAlliancesForSeason) from plan 07-02, which this plan's live ingest writes into"
provides:
  - "packages/ingest/schemas.ts — tbaAllianceEntrySchema/tbaAllianceResponseSchema, distinct from the module-private per-match tbaAllianceSchema, with the load-bearing top-level .nullable()"
  - "packages/ingest/alliances.ts — normalizeEventAlliances, a pure transform mirroring rankings.ts's null/empty/populated contract, with no I/O and no corpus import"
  - "packages/ingest/tbaClient.ts — fetchEventAlliances, and the client's capability inventory corrected from a stale 'eight' to the true eleven, naming which phase added each of the last three"
  - "packages/ingest/cli.ts — ingestSeasonAlliancesOnly / --alliances-only / pnpm ingest:alliances, mirroring ingestSeasonRankingsOnly's tri-state tally plus a notFoundCount so five counters sum to the season's event count"
  - "The real data/corpus.sqlite carries 3,919 event_alliances rows from a live 2022+2024 two-season ingest, proven idempotent by a --force re-run"
  - ".planning/phases/07-event-pages/COVERAGE.md — the TBA event-scoped capability matrix, reconciled against the shipped code and filled with real measured-cost figures"
affects: [07-05-full-corpus-live-run, 07-08-event-artifact-publisher, 07-14-alliances-tab]

actuals:
  tokens: 10650
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Third normalize.ts-family module (after media.ts, rankings.ts): alliances.ts is a pure transform with no I/O and no corpus import, one fixture-factory pair (allianceEntry/alliancesResponse) mirroring rankingEntry/rankingsResponse, and the same null-vs-empty-array-are-separate-cases discipline"
    - "A capability-inventory correction pattern for tbaClient.ts: module header, inline section comment, and a dedicated capability-surface test case must all state the same count and enumerate the same set, each new addition getting a parenthetical naming which phase added it — established because the count had already silently drifted twice (team-media, event-rankings) before this plan noticed"
    - "z.unknown() alone requires the KEY to be present in Zod v4 — an absent key is not the same as a present-but-unknown value. A schema field intended to tolerate genuine absence needs z.unknown().optional() explicitly, discovered live against real 2022 alliance objects with no status key at all"

key-files:
  created:
    - packages/ingest/alliances.ts
    - packages/ingest/alliances.test.ts
  modified:
    - packages/ingest/schemas.ts
    - packages/ingest/tbaClient.ts
    - packages/ingest/tbaClient.test.ts
    - packages/ingest/cli.ts
    - package.json
    - .planning/phases/07-event-pages/COVERAGE.md

key-decisions:
  - "status: z.unknown() widened to status: z.unknown().optional() (Rule 1 fix, discovered running the real 2022 live ingest) — several real 2022 alliance objects carry no status key at all, a shape RESEARCH.md's 40-event sample didn't observe; normalizeEventAlliances already treated a missing status as statusRaw: null so only the schema's required-vs-optional boundary needed to change"
  - "tbaClient.test.ts's capability-surface case was widened (beyond the plan's literal instruction to add only fetchEventAlliances) to also call fetchTeamMedia and fetchEventRankings, so a test case titled 'exposes exactly the eleven COVERAGE.md INTEGRATE capabilities' actually exercises all eleven rather than nine plus two separately-tested siblings — closing the exact test/code drift T-07-03-09 exists to prevent, rather than leaving a partial closure"
  - "COVERAGE.md's status row and note [6] were updated with a new 'status ABSENT entirely' table-two row and a reconciliation-pass paragraph, rather than silently editing the existing row's reason — the plan-time matrix genuinely didn't anticipate this shape and the divergence is reported, not smoothed over"
  - "The 2022 live run was executed three times (initial, then --force): the initial run mixed in 10 events served from ETags an unrelated earlier partial session had already cached, understating the true tri-state split; the --force re-run is the clean measurement COVERAGE.md's measured-cost section cites for 2022, and both runs' figures are recorded in the task commit message for provenance"

patterns-established:
  - "The z.unknown().optional() pattern for a TBA field whose PRESENCE (not just shape) is unreliable — the third such field this project has needed (after name's .nullish() for absent-vs-null-vs-empty and score_breakdown's plain z.unknown() for shape-only variance), now documented as its own case in schemas.ts's doc comments for a future TBA field with the same absence-not-just-variance problem"

requirements-completed: []

coverage:
  - id: D1
    description: "tbaAllianceResponseSchema parses all three live-observed TBA body shapes (populated array, empty array, bare null) without throwing, and the top-level .nullable() is load-bearing exactly as tbaEventRankingsResponseSchema's is"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/ingest/alliances.test.ts#tbaAllianceResponseSchema — parses a null body / parses an empty array / parses the real 2022roe response"
        status: pass
    human_judgment: false
  - id: D2
    description: "An alliance object with no name key at all parses and normalizes to name: null, never an empty string; name: null and name: '' both collapse to the same null"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/ingest/alliances.test.ts#normalizeEventAlliances — an alliance object with no name key at all normalizes to name: null / an absent name normalizes to null, not an empty string / name: null and name: '' both normalize to null"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 4-team alliance round-trips with picks.length === 4 and the 4th team key at picks[3]; no schema field, normalized field, or CLI identifier names a fourth-pick concept TBA's response does not have"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/ingest/alliances.test.ts#normalizeEventAlliances — a 4-pick alliance normalizes with picks.length === 4 and picks[3] equal to the 4th team key, matching 2022roe's real recorded values"
        status: pass
      - kind: other
        ref: "grep -icE '\\bbackup\\b' over non-comment lines of alliances.ts/schemas.ts/cli.ts prints 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "ingestSeasonAlliancesOnly reports five separate per-season counts (populatedCount/nullBodyCount/emptyAlliancesCount/cacheHitCount/notFoundCount) that sum exactly to the season's corpus event count"
    requirement: EVNT-05
    verification:
      - kind: integration
        ref: "live pnpm ingest:alliances --year 2022 --force console output: 244+25+19+0+0=288; --year 2024: 285+27+12+0+0=324 — both matching SELECT COUNT(*) FROM events WHERE year = ?"
        status: pass
    human_judgment: false
  - id: D5
    description: "allianceNumber is assigned as the 1-based index of the alliance object in TBA's own response array at normalize time, never parsed out of name, and never renumbered"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/ingest/alliances.test.ts#normalizeEventAlliances — a populated response of 5 alliance objects normalizes allianceNumber to [1,2,3,4,5] in the response's own order, proven by names that do NOT match their positions / never reorders or renumbers alliance objects"
        status: pass
    human_judgment: false
  - id: D6
    description: "Re-running the alliances ingest over an already-ingested season with --force writes the same row set — event_alliances row count unchanged before and after"
    requirement: EVNT-05
    verification:
      - kind: integration
        ref: "live corpus query: event_alliances row count for year 2022 = 1752 before and after `pnpm ingest:alliances --year 2022 --force`; whole-table count = 3919 before and after"
        status: pass
    human_judgment: false
  - id: D7
    description: "A drifted TBA payload (picks retyped to a string, picks empty, declines absent) throws at the parse boundary rather than being coerced"
    verification:
      - kind: unit
        ref: "packages/ingest/alliances.test.ts#tbaAllianceResponseSchema — three 'throws on a drifted payload' cases"
        status: pass
    human_judgment: false
  - id: D8
    description: "tbaClient.ts's module header, inline capability-section comment, and tbaClient.test.ts's capability-surface case all state the same currently-true count of eleven exposed TBA capabilities"
    verification:
      - kind: unit
        ref: "packages/ingest/tbaClient.test.ts#capability surface — exposes exactly the eleven COVERAGE.md INTEGRATE capabilities"
        status: pass
      - kind: other
        ref: "grep -c 'eight capabilities' packages/ingest/tbaClient.ts prints 0; grep -ci eleven prints 2"
        status: pass
    human_judgment: false
  - id: D9
    description: "packages/ingest/alliances.ts is a pure transform with no I/O and no corpus import"
    verification:
      - kind: other
        ref: "grep -cE '^import' packages/ingest/alliances.ts prints 1; grep for corpus|node:|better-sqlite3 over non-comment lines prints 0"
        status: pass
    human_judgment: false
  - id: D10
    description: ".planning/phases/07-event-pages/COVERAGE.md enumerates TBA v3's full event-scoped capability surface with INTEGRATE as the default and every OPT-OUT row carrying a non-empty one-line reason"
    verification:
      - kind: other
        ref: "awk OPT-OUT-reason gate over COVERAGE.md exits 0 (no undecided OPT-OUT row); 40 decision cells total, each exactly INTEGRATE or OPT-OUT"
        status: pass
    human_judgment: false
  - id: D11
    description: "The live two-season alliances ingest is provable only on a machine holding both the gitignored data/corpus.sqlite and a populated .env; CI has neither"
    verification: []
    human_judgment: true
    rationale: "Explicitly marked verification: backstop in the plan's must_haves — this is a machine/credential-availability fact, not a code assertion CI can check. The reproducible half (fixture-based alliances.test.ts) is D1-D9/D7 above."
  - id: D12
    description: "Whether TBA's alliance response shape holds across all ~1,581 corpus events (vs. RESEARCH.md's 40-event sample plus this plan's two full seasons) is proven only by 07-05's full pass"
    verification: []
    human_judgment: true
    rationale: "Explicitly marked verification: backstop — RESEARCH.md Assumption A3's sampling caveat, narrowed but not closed by this plan; 07-05 owns closing it. This plan's own Task 2 live run already surfaced one shape this caveat warned about (status sometimes absent), which is the live evidence the caveat is a real risk, not a formality."

duration: ~20min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 3: The Alliances TBA Ingest and Its Capability Matrix Summary

**`tbaAllianceResponseSchema`/`normalizeEventAlliances`/`ingestSeasonAlliancesOnly` (D-18.7): a new `/event/{key}/alliances` TBA ingest proven live against real 2022 and 2024 seasons (3,919 rows, 244/25/19 and 285/27/12 tri-state split), including a live-discovered schema fix (`status` can be entirely absent) that RESEARCH.md's 40-event sample never surfaced.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-27T22:21:00Z (approx.)
- **Completed:** 2026-08-27T22:36:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- `tbaAllianceEntrySchema`/`tbaAllianceResponseSchema` added to `schemas.ts`, distinct from the module-private per-match `tbaAllianceSchema`, with `name` `.nullish()` (no default), `picks.min(1)`, `status: z.unknown().optional()`, `declines` required, and a load-bearing top-level `.nullable()` — every choice doc-commented with its reason
- `normalizeEventAlliances` shipped in a new `alliances.ts`, a pure transform (no I/O, no corpus import) mirroring `rankings.ts`'s null/empty/populated contract: `allianceNumber` from TBA's own response-array position, `name` collapsing `undefined`/`null`/`""` to one `null`, `picks`/`declines` passed through verbatim with `picks[3]` as the 4th team and no invented field, `statusRaw` as `JSON.stringify(status)` or `null`
- `fetchEventAlliances` added to `tbaClient.ts`; the client's stated capability inventory corrected from a stale "eight" (already wrong by two before this plan touched it — team-media and event-rankings were both added without updating it) to the true eleven, with the module header, inline comment, and capability-surface test all now agreeing and each new addition parenthetically naming its adding phase
- `ingestSeasonAlliancesOnly`/`--alliances-only`/`pnpm ingest:alliances` mirror `ingestSeasonRankingsOnly`'s shape with two stated, deliberate divergences (no unknown-team guard since `event_alliances.picks` has no team-key FK; a `notFoundCount` so five counters close the invariant against the season's event count)
- Two full seasons (2022, 2024) ingested live against real TBA: 3,919 `event_alliances` rows total, `2022roe` alliance 1's `picks` exactly `["frc3310","frc67","frc4451","frc3539"]` matching RESEARCH.md's recorded live values, `2022ispr` at 0 rows (null-body case), `2024wvrox` with 10 `name IS NULL` rows and 0 `name = ''` rows, zero rows anywhere with an empty or null `picks`, and idempotence proven by a `--force` re-run leaving row counts unchanged (1752 for 2022, 3919 whole-table, before and after)
- `.planning/phases/07-event-pages/COVERAGE.md` reconciled against the shipped code in both directions (no divergence in table one; one real divergence found and reported in table two — `status` can be entirely absent, not just variable in shape) and its measured-cost placeholder replaced with real per-season figures, request counts, and wall-clock timing read from `ingest_runs`

## Task Commits

Each task was committed atomically (Task 1 is TDD, so it has two commits: test → feat):

1. **Task 1: The alliances parse boundary — schema, fetch helper, normalize rule, and the Wave 0 test file** - `17411029` (test, RED) then `665e7327` (feat, GREEN)
2. **Task 2: `ingestSeasonAlliancesOnly`, its closed five-count tally, and a live two-season proof** - `46b15f03` (feat — includes the Rule 1 schema fix found running this task's own live command)
3. **Task 3: Reconcile the TBA event-scoped capability matrix against the shipped code, and fill its measured cost** - `0cf27926` (docs)

**Plan metadata:** (this commit — docs: complete 07-03 plan)

## Files Created/Modified
- `packages/ingest/alliances.ts` - `NormalizedEventAlliance`/`normalizeEventAlliances`, new
- `packages/ingest/alliances.test.ts` - 34 cases across a schema describe block and a `normalizeEventAlliances` describe block, new
- `packages/ingest/schemas.ts` - `tbaAllianceEntrySchema`/`tbaAllianceResponseSchema` appended after the rankings block
- `packages/ingest/tbaClient.ts` - `fetchEventAlliances` added after `fetchEventRankings`; capability inventory corrected to eleven
- `packages/ingest/tbaClient.test.ts` - capability-surface case widened to eleven helpers and eleven paths; new ETag-forwarding case for `fetchEventAlliances`
- `packages/ingest/cli.ts` - `ingestSeasonAlliancesOnly`, `--alliances-only`, `CliOptions.alliancesOnly`, and `main()`'s new dispatch branch
- `package.json` - `ingest:alliances` script added, copying `ingest:rankings`'s form
- `.planning/phases/07-event-pages/COVERAGE.md` - reconciled against shipped code (one new `status` ABSENT row + note [6] addendum), measured-cost section filled from real `ingest_runs` figures

## Decisions Made
- `status: z.unknown()` widened to `status: z.unknown().optional()` — a Rule 1 bug fix discovered running the real `pnpm ingest:alliances --year 2022` command against real TBA data. Several 2022 alliance objects carry no `status` key at all (Zod v4 treats `z.unknown()` alone as requiring the key present — an absent key is not the same as a present-but-unknown value), a shape RESEARCH.md's 40-event sample never observed. `normalizeEventAlliances` already treated a missing `status` as `statusRaw: null`, so only the schema's required-vs-optional boundary needed to change. Verified with a new schema test case; both live seasons re-ran clean after the fix.
- `tbaClient.test.ts`'s capability-surface case was widened beyond the plan's literal instruction (which asked only to add `fetchEventAlliances`) to also call `fetchTeamMedia` and `fetchEventRankings` — a test titled "exposes exactly the eleven COVERAGE.md INTEGRATE capabilities" now actually exercises all eleven, rather than nine plus two separately-tested siblings. This closes the exact test/code drift T-07-03-09 names as the threat this plan mitigates, rather than leaving a partial closure that would itself become the next stale-count bug.
- COVERAGE.md's `status` row and note [6] were updated (one new table-two row, one addendum paragraph) rather than silently edited into agreement — the plan-time matrix genuinely didn't anticipate the absent-`status` shape, and the divergence is reported with the specific row and the specific code symbol (`tbaAllianceEntrySchema.status`), per the task's own reconciliation-pass instructions.
- The 2022 live ingest ran three times: the initial `pnpm ingest:alliances --year 2022` mixed in 10 events served from ETags an earlier, unrelated partial session had already cached (visible in the run's own "a prior run never completed" notices), understating the true tri-state split (238/23/17 vs the clean 244/25/19). A `--force` re-run produced the clean, full-fresh measurement, which COVERAGE.md's measured-cost section cites for 2022; both figures are recorded in Task 2's commit message for provenance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tbaAllianceEntrySchema.status` widened from `z.unknown()` to `z.unknown().optional()`**
- **Found during:** Task 2, running the real `pnpm ingest:alliances --year 2022` command against live TBA data
- **Issue:** Several real 2022 alliance objects carry no `status` key at all; Zod v4's `z.unknown()` alone requires the key present, so the parse threw `invalid_type: expected nonoptional, received undefined` and aborted the run
- **Fix:** Added `.optional()` to the `status` field, updated the doc comment to record the live discovery and cite it as RESEARCH.md Assumption A3's named risk materializing inside this plan's own run
- **Files modified:** `packages/ingest/schemas.ts`, `packages/ingest/alliances.test.ts` (new schema test case)
- **Verification:** Both live seasons re-ran clean after the fix (2022: 289 requests, all parsed; 2024: 325 requests, all parsed); `pnpm vitest run packages/ingest/alliances.test.ts` passed with the new case (34/34)
- **Committed in:** `46b15f03` (part of Task 2's commit)

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Necessary for correctness — without it, Task 2's own live-run acceptance criteria could not have been satisfied at all. No scope creep: the fix stayed inside `schemas.ts`'s existing field definition and `alliances.test.ts`'s existing describe block, no new files, no architectural change.

## Issues Encountered
None beyond the deviation documented above. The pre-existing, out-of-scope `packages/harness/payloadBudget.test.ts` failure (WINDOWS.md ledger #11, `teams/{year}` payload ceiling) remains open and unaffected by this plan — confirmed unchanged before and after (1 failed / 1526+1 passed across both runs, delta accounted for entirely by this plan's own new test case).

## User Setup Required

None - no external service configuration required. `.env`'s existing `TBA_API_KEY` was used exactly as every other `pnpm ingest*` script already uses it.

## Next Phase Readiness
- `event_alliances` now holds 3,919 real rows across 2022 and 2024 (612 events, 529 populated / 52 null-body / 31 empty-alliances), ready for 07-08's `buildEventArtifact` to read via 07-02's `selectEventAlliancesForSeason`
- 07-05's full 2022-2026 pass will see 2022 and 2024 as ETag cache hits; COVERAGE.md's measured-cost section is the authoritative record of those two seasons' split (244/25/19 and 285/27/12), and 07-05 may cite it or re-fetch with `--force`
- The remaining three seasons (2023, 2025, 2026 — 969 events) are budgeted in COVERAGE.md at roughly 1.6-3.1 minutes for 07-05's alliances-specific pass, based on this plan's own measured 190.4 ms/request rate
- The `status: z.unknown().optional()` fix and its underlying discovery (status can be entirely absent, not just variable in shape) is recorded in COVERAGE.md note [6] so a future full-corpus pass or a future consumer of `status_raw` starts from the corrected shape, not the plan-time assumption
- `.planning/phases/07-event-pages/COVERAGE.md`'s note [7] records RESEARCH.md Assumption A3 as an open scope caveat owned by 07-05, with this plan's own live discovery (D12 above) as direct evidence the caveat is a real, not theoretical, risk

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All 8 modified/created files confirmed present on disk; all 4 task commits (`17411029`, `665e7327`, `46b15f03`, `0cf27926`) confirmed present in `git log`.
