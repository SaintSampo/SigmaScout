---
phase: 07-event-pages
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, corpus, migration, tdd]

requires:
  - phase: 06.1-match-and-event-data-enrichment
    provides: "event_rankings table (plan 06.1-01) and its EVENT_LOCATION_COLUMNS/hasEventLocationColumns additive-migration precedent (plan 05-02) that this plan's event_alliances table and event_rankings widening both follow"
provides:
  - "packages/corpus/schema.sql — event_alliances table (event_key, alliance_number, name, picks, declines, status_raw, fetched_at) and event_rankings widened with record_wins/record_losses/record_ties/ranking_score"
  - "packages/corpus/db.ts — CorpusEventAlliance, EventAllianceSelection, upsertEventAlliance, selectEventAlliancesForSeason; EVENT_RANKING_RECORD_COLUMNS, hasEventRankingRecordColumns, and openCorpus's new additive migration step; CorpusEventRanking widened with recordWins/recordLosses/recordTies/rankingScore"
  - "The real data/corpus.sqlite is migrated in place (47,695 event_rankings rows preserved exactly) and packages/corpus/integrity.test.ts carries a repeatable corpus-gated regression guard proving it"
affects: [07-03-alliances-ingest, 07-04-rankings-ingest-extension, 07-05-full-corpus-live-run, 07-08-event-artifact-publisher, 07-11-insights-tab, 07-14-alliances-tab]

actuals:
  tokens: 10600
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Additive ALTER TABLE ADD COLUMN migration, second instance: EVENT_RANKING_RECORD_COLUMNS/hasEventRankingRecordColumns mirrors EVENT_LOCATION_COLUMNS/hasEventLocationColumns exactly (module-private [name, sqlType][] tuple array, PRAGMA table_info existence check, per-column idempotent loop inside openCorpus, unreachable-in-practice post-loop guard) — the second proof this is a reusable, scoped exception, not a one-off"
    - "CREATE TABLE IF NOT EXISTS for a brand-new corpus table with zero-row-means-absent semantics (event_alliances) — third instance of the team_media/event_rankings precedent"
    - "TDD RED verified by temporarily `git stash push -- <impl files>` (keeping only the new test file staged), confirming the exact failure mode (missing export / missing column), then `git stash pop` to restore the implementation for GREEN — used because both tasks' implementation and tests land in the same pre-existing files, so a literal test-then-code authoring order isn't directly observable via git history alone"

key-files:
  created: []
  modified:
    - packages/corpus/schema.sql
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - packages/corpus/integrity.test.ts

key-decisions:
  - "Each TDD task's schema.sql/db.ts edits were held back from the RED commit and applied only in the GREEN commit, even though both tasks touch the same three files — RED commits contain only db.test.ts, confirmed to fail via a temporary git stash of the implementation files rather than by literal commit-order alone"
  - "event_rankings' four new columns are optional (recordWins?, recordLosses?, etc.) on CorpusEventRanking, not required — verified live that packages/ingest/cli.ts's existing upsertEventRanking call site and packages/harness/publish.ts's two selectEventRankingsForSeason read sites both compile unchanged (git diff --stat empty for both), exactly as the plan required three waves before 07-04 widens the ingest"
  - "The pre-existing packages/harness/eventRank.tracer.test.ts transiently broke between Task 2's commit and Task 3's commit (openCorpusReadOnly never runs migrations, only write-mode openCorpus does) — an expected, plan-anticipated state, not a deviation, resolved by Task 3's real-corpus write-mode open"

patterns-established:
  - "A second corpus table (event_alliances) with no team-key foreign key on its picks array, matching matches.red_teams's precedent, because TBA's synthetic second-robot team keys have no /team/{key} record (06.1-01's live-verified FOREIGN KEY failure) — future TBA per-team-array ingests should check this precedent before adding a REFERENCES teams(team_key) constraint"

requirements-completed: [EVNT-02, EVNT-05]

coverage:
  - id: D1
    description: "event_alliances table and typed accessors round-trip alliance_number, name, and picks (in TBA's own seed order) identically, including 3-pick and 4-pick alliances with no separate backup field or column"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_alliances — corpus table and accessors (plan 07-02 Task 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An event with no upserted alliances is absent from selectEventAlliancesForSeason's returned map entirely (no key, never a zero-row placeholder) — matches EVNT-05's empty probe storage half; a null TBA body and an empty array both resolve to zero stored rows"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_alliances — corpus table and accessors (plan 07-02 Task 1) > an event for which nothing was ever upserted is absent from the returned map entirely"
        status: pass
    human_judgment: false
  - id: D3
    description: "selectEventAlliancesForSeason returns each event's alliances in ascending alliance_number through an explicit ORDER BY, never relying on SQLite's row order — EVNT-05's ordering probe, storage half"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_alliances — corpus table and accessors (plan 07-02 Task 1) > returns alliances ascending by alliance_number even when inserted in descending/shuffled order"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two upsertEventAlliance calls for the same (event_key, alliance_number) merge into one row with the second call's values; the same alliance_number under a different event_key stays a separate row — EVNT-05's adjacency probe, storage half"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_alliances — corpus table and accessors (plan 07-02 Task 1) > two upserts ... / the same alliance_number under a second event_key leaves two rows, not merged"
        status: pass
    human_judgment: false
  - id: D5
    description: "event_rankings' four new columns (record_wins/record_losses/record_ties/ranking_score) read back as SQL NULL when never fetched — never 0, never a fabricated 0-0-0 record — and a real ranking_score of exactly 0 is distinguishable from null; storage half of EVNT-02's empty probe"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_rankings — record and ranking-score columns (plan 07-02 Task 2)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A fresh corpus built from schema.sql and a legacy corpus migrated in place by openCorpus end with the identical PRAGMA table_info(event_rankings) column-name set (9 columns), and a legacy corpus with seeded rows preserves every row's rank/total_teams/fetched_at and its row count exactly"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#event_rankings — record and ranking-score columns (plan 07-02 Task 2) > a legacy event_rankings table gains all four columns... / a fresh corpus and a legacy-migrated corpus end with identical..."
        status: pass
    human_judgment: false
  - id: D7
    description: "The real, populated, gitignored ~359 MB data/corpus.sqlite is migrated in place with its event_rankings row count unchanged (measured: 47,695 before and after) and its rank>=1/totalTeams>=1 invariant still holding — the plan's backstop truth, provable only on a machine holding the real corpus"
    verification:
      - kind: integration
        ref: "packages/corpus/integrity.test.ts#event_alliances / event_rankings migration against the real corpus (plan 07-02 Task 3) — both cases ran (not skipped), before=47695 after=47695"
        status: pass
    human_judgment: false
  - id: D8
    description: "No column in this plan's diff stores a self-computed value under a TBA-provenance column name (T-07-02-03/T-07-02-04) — every new column is either TBA's own field or SQL NULL"
    verification:
      - kind: other
        ref: "grep -vE '^\\s*(\\*|//|/\\*)' packages/corpus/db.ts | grep -cE 'DROP TABLE|DELETE FROM|INSERT INTO event_rankings *SELECT|RENAME TO' prints 0; grep -c 'ALTER TABLE event_rankings ADD COLUMN' prints 1"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 2: Corpus Storage for Alliances and Ranking Records Summary

**`event_alliances` table plus a second additive-nullable-column migration (`record_wins`/`record_losses`/`record_ties`/`ranking_score` on `event_rankings`), proven safe against the real 359 MB corpus with row-count-preserved before/after equality (47,695 = 47,695).**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-28T01:16:00Z
- **Completed:** 2026-08-28T01:47:55Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `event_alliances` exists in `schema.sql` (D-18.7) with `event_key`, `alliance_number`, `name`, `picks`, `declines`, `status_raw`, `fetched_at` and a `(event_key, alliance_number)` primary key, doc-commented in `event_rankings`'s own convention, and `CorpusEventAlliance`/`EventAllianceSelection`/`upsertEventAlliance`/`selectEventAlliancesForSeason` are exported from `db.ts` with an explicit `ORDER BY` for seed order
- `event_rankings` carries four new nullable columns (D-18.6) — `record_wins`/`record_losses`/`record_ties` (TBA's own `record` object) and `ranking_score` (TBA's `sort_orders[0]`) — in both the inline DDL and a new `EVENT_RANKING_RECORD_COLUMNS`/`hasEventRankingRecordColumns` `ALTER TABLE ADD COLUMN` migration step inside `openCorpus`, mirroring `EVENT_LOCATION_COLUMNS`/`hasEventLocationColumns` exactly
- The real, populated `data/corpus.sqlite` was migrated in place for the first time: `event_rankings` row count unchanged (47,695 → 47,695, verified by a live test run against the actual file), `event_alliances` now exists (0 rows, expected — 07-05 populates it), and a new corpus-gated regression guard in `integrity.test.ts` will keep re-proving this on every future `pnpm test` run
- `packages/ingest/cli.ts` and `packages/harness/publish.ts` compile untouched (`git diff --stat` empty for both) — the four new `CorpusEventRanking` fields are genuinely optional, so 07-03/07-04 start from a green tree exactly as the plan required

## Task Commits

Each task was committed atomically (TDD tasks have two commits: test → feat):

1. **Task 1: The `event_alliances` table and its typed accessors (D-18.7)** - `496cb617` (test, RED) then `ecdc51a6` (feat, GREEN)
2. **Task 2: Four additive nullable columns on `event_rankings`, and the migration that lands them (D-18.6)** - `38bd60dd` (test, RED) then `a3fdd969` (feat, GREEN)
3. **Task 3: Prove the migration against the real 359 MB corpus, as a repeatable guard** - `0df668e6` (test)

**Plan metadata:** (this commit — docs: complete 07-02 plan)

## Files Created/Modified
- `packages/corpus/schema.sql` - `event_alliances` table; `event_rankings` widened with `record_wins`/`record_losses`/`record_ties`/`ranking_score`
- `packages/corpus/db.ts` - `CorpusEventAlliance`, `EventAllianceSelection`, `upsertEventAlliance`, `selectEventAlliancesForSeason`; `EVENT_RANKING_RECORD_COLUMNS`, `hasEventRankingRecordColumns`, `openCorpus`'s new migration step; `CorpusEventRanking`/`upsertEventRanking`/`selectEventRankingsForSeason` widened
- `packages/corpus/db.test.ts` - 17 new cases across two `describe` blocks (`event_alliances — corpus table and accessors`, `event_rankings — record and ranking-score columns`)
- `packages/corpus/integrity.test.ts` - a new corpus-gated `describe` block with two cases proving the real-corpus migration and its non-destructiveness

## Decisions Made
- RED commits for both TDD tasks contain only `db.test.ts`; the implementation (`schema.sql`/`db.ts`) was temporarily `git stash`ed to confirm each new test actually fails for the right reason (missing export / missing table / missing column) before being restored for the GREEN commit — necessary because both tasks' tests and implementation land in the same pre-existing files, so ordinary git history alone wouldn't demonstrate RED
- `event_rankings`' four new fields are optional on `CorpusEventRanking` (not required) — confirmed live by reading `packages/ingest/cli.ts`'s `ingestSeasonRankingsOnly` call site and `packages/harness/publish.ts`'s two `selectEventRankingsForSeason` read sites before editing, then verifying both files' `git diff --stat` stayed empty after the change
- `packages/harness/eventRank.tracer.test.ts` (a pre-existing plan-06.1-01 test that reads the real corpus read-only) failed transiently after Task 2's commit — `openCorpusReadOnly` never applies migrations, only write-mode `openCorpus` does, and Task 2 alone doesn't touch the real file. This was the expected, plan-anticipated sequencing (documented in Task 2's own commit message) and resolved itself once Task 3's write-mode `openCorpus` call migrated the real corpus

## Deviations from Plan

None — plan executed exactly as written. No Rule 1–4 auto-fixes were needed; every acceptance criterion in the plan's three tasks passed on the implementation as designed.

## Issues Encountered
- Between Task 2's GREEN commit and Task 3's commit, `pnpm test`'s full suite showed one additional failing test file (`packages/harness/eventRank.tracer.test.ts`, `SqliteError: no such column: er.record_wins`) beyond the pre-existing, out-of-scope `payloadBudget.test.ts` failure. This was a correctly-anticipated transient state — `openCorpusReadOnly` (used by that test) never runs `openCorpus`'s migrations, so it read the real, not-yet-migrated corpus against the now-widened `selectEventRankingsForSeason` SELECT. Task 3's real-corpus write-mode `openCorpus` call resolved it; a post-Task-3 `pnpm test` run confirmed the file passes again (1497 passed, only the pre-existing `payloadBudget.test.ts` failure remains).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `event_alliances` and `event_rankings`'s four new columns are ready for 07-03 (alliances ingest) and 07-04 (rankings ingest extension) to write into, and for 07-08 (event artifact publisher) to read from
- The real corpus is migrated and will be populated by 07-03/07-04/07-05's ingest passes; `integrity.test.ts`'s new corpus-gated block is a permanent regression guard that must keep passing after those passes (it deliberately does not assert `event_alliances` is empty)
- `hasEventRankingRecordColumns` follows the exact same shape as `hasEventLocationColumns`, so any future additive-nullable-column need on another table has two worked examples to copy, not one
- Pre-existing `packages/harness/payloadBudget.test.ts` failure (`teams/{year}` payload ceiling, WINDOWS.md ledger #11) remains open and out of this plan's scope — unaffected by this plan's changes, confirmed unchanged before and after

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All modified files confirmed present on disk; all task commits (`496cb617`, `ecdc51a6`, `38bd60dd`, `a3fdd969`, `0df668e6`) confirmed present in `git log`.
