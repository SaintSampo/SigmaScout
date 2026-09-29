---
phase: 07-event-pages
plan: 04
subsystem: database
tags: [zod, tba-api, ingest, sqlite, tdd]

requires:
  - phase: 07-event-pages
    provides: "event_rankings' four D-18.6 columns (record_wins/record_losses/record_ties/ranking_score) from plan 07-02, which this plan's widened ingest fills"
provides:
  - "packages/ingest/rankings.ts — RANKING_SCORE_SORT_ORDER_NAME/RANKING_SCORE_SORT_ORDER_INDEX/RankingScoreSortOrderError, and normalizeEventRankings(response, eventKey) widened to guard TBA's ranking-score vocabulary before reading it, and to return TBA's own record/ranking-score fields"
  - "packages/ingest/schemas.ts — tbaEventRankingSchema's doc comment corrected to describe what is actually read (record + sort_orders[0]), no Zod expression changed"
  - "packages/ingest/rankingsLive.test.ts — a bounded (<=7 requests), corpus-gated + TBA_API_KEY-gated live-TBA integration test proving the sort-order guard's premise for 2022-2026 plus two live-observed empty-array events, and a second corpus-only describe block proving the real forced 2022 ingest wrote correct record/ranking-score values"
  - "packages/ingest/cli.ts — ingestSeasonRankingsOnly persists TBA's record and ranking score into the four columns 07-02 created, counts null ranking scores, documents the --force backfill requirement, and lets sort-order drift abort the season uncaught"
  - "The real data/corpus.sqlite's 2022 event_rankings rows now carry non-NULL record/ranking-score values (236/288 populated events), proven by a corpus-gated regression guard"
affects: [07-05-full-corpus-live-run, 07-08-event-artifact-publisher, 07-11-insights-tab]

actuals:
  tokens: 10620
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "The sort-order-vocabulary guard: a dedicated error class (RankingScoreSortOrderError) plus two exported constants (name, index) live in the SAME function as the read they protect, so no future caller can read a positional TBA array without the assertion that licenses it — the direct application of 06.1-08's lesson that a rule expressed as two independent literals can drift apart"
    - "A live-TBA regression test asserts against a string literal written in the test file, never against the production module's own exported constant for the same value — otherwise a future rename of the constant would make the live assertion pass vacuously on the exact day it exists to catch a real TBA vocabulary change"
    - "A corpus-only describe block inside a live-TBA test file, gated on a DIFFERENT boolean than the network-gated blocks above it in the same file, proving a CLI's write path that cannot be imported (cli.ts calls main() at top level) by querying the corpus it actually wrote"

key-files:
  created:
    - packages/ingest/rankingsLive.test.ts
  modified:
    - packages/ingest/rankings.ts
    - packages/ingest/rankings.test.ts
    - packages/ingest/schemas.ts
    - packages/ingest/cli.ts

key-decisions:
  - "Task 1's RED/GREEN split used the same git-stash-the-implementation technique 07-02 established (rather than literal test-then-code authoring order), confirmed by running the extended rankings.test.ts against the stashed original rankings.ts (11/24 cases failed for the expected reasons) before restoring the implementation for GREEN"
  - "Task 2's new live test file was committed as a single test(...) commit, not RED/GREEN-split — it is a new file exercising already-shipped Task 1 production code against live TBA, so there is no implementation half to stash; RED/GREEN applies naturally to Task 1's normalize function and Task 3's cli.ts write path, not to this file's role as pure live-data evidence"
  - "Task 3's corpus-backed describe block WAS written and confirmed failing first (4/5 cases failed against the pre-ingest corpus, where all four D-18.6 columns were NULL for every 2022 row) before running the real forced ingest and confirming GREEN — genuine TDD against the real corpus, not a fixture"
  - "Observed answer to the plan's stated open question: a bare pnpm vitest run / pnpm test, in a fresh shell with no exported TBA_API_KEY, reports the TBA_API_KEY-gated block as a named skip (1 skipped), not a run and not a failure — this repo's node Vitest project does NOT load .env into process.env on its own; only the documented `set -a; . ./.env; set +a` invocation runs the live block"

patterns-established:
  - "A precondition assertion (parsed !== null && rankings.length > 0) written as its own visible expect() line immediately before a live-TBA test asserts anything about response contents — makes the non-vacuity of a live assertion checkable by reading the test, not implied by the sample choice"

requirements-completed: []

coverage:
  - id: D1
    description: "normalizeEventRankings(response, eventKey) asserts sort_order_info[0].name against RANKING_SCORE_SORT_ORDER_NAME before reading rankingScore from that position; a mismatch (including an empty sort_order_info) throws RankingScoreSortOrderError naming the event key and the observed name (or its explicit absence), and is never caught inside rankings.ts"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "packages/ingest/rankings.test.ts#normalizeEventRankings > D-18.6 sort-order guard (all 4 cases)"
        status: pass
      - kind: integration
        ref: "packages/ingest/rankingsLive.test.ts#rankingsLive — the D-18.6 guard's premise against real TBA responses > season 2022-2026 cases (5) — live run, sort_order_info[0].name asserted against a literal for each real season"
        status: pass
    human_judgment: false
  - id: D2
    description: "The guard is unreachable for a null response and for an empty rankings array (even one carrying a drifted sort_order_info) — both still return [] and never throw, since there is nothing to store"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "packages/ingest/rankings.test.ts#normalizeEventRankings — normalizes a null response... / a response with an empty rankings array AND a drifted sort_order_info still returns [] and does not throw"
        status: pass
    human_judgment: false
  - id: D3
    description: "NormalizedEventRanking carries TBA's record (recordWins/recordLosses/recordTies) verbatim and a rankingScore: number | null, with both the null-sort_orders and absent-element cases resolving to SQL NULL (never 0, never undefined) and a genuine 0 staying distinguishable from null"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "packages/ingest/rankings.test.ts#normalizeEventRankings > D-18.6 record and ranking-score fields (all 5 cases)"
        status: pass
      - kind: integration
        ref: "packages/ingest/rankingsLive.test.ts#rankingsLive... > record fields non-negative-integer + non-integral-rankingScore + recordWins-passthrough cases (3) — proven against real 2022-2026 data"
        status: pass
    human_judgment: false
  - id: D4
    description: "packages/ingest/schemas.ts's tbaEventRankingSchema doc comment describes what the pipeline now actually reads (record + sort_orders[0]), naming normalizeEventRankings as the single consumer, with no Zod expression in the file changed"
    verification:
      - kind: other
        ref: "git diff -U0 packages/ingest/schemas.ts — every added/removed line begins with `+ *`/`- *`/`+/**`/`-/**`, confirmed by direct read"
        status: pass
    human_judgment: false
  - id: D5
    description: "packages/ingest/rankingsLive.test.ts proves the guard's premise against live TBA for seasons 2022-2026 plus 2025cmptx/2022ispr, asserting a literal (never the exported constant) so a constant rename cannot make the live check vacuous, exercising the real normalizeEventRankings path, and bounding its own request count at <=7 (T-07-04-04)"
    requirement: EVNT-02
    verification:
      - kind: integration
        ref: "packages/ingest/rankingsLive.test.ts#rankingsLive — the D-18.6 guard's premise against real TBA responses (10 cases) — live run via set -a; . ./.env; set +a; pnpm vitest run, all RUN not skipped, 1.3-1.5s"
        status: pass
    human_judgment: false
  - id: D6
    description: "ingestSeasonRankingsOnly writes recordWins/recordLosses/recordTies/rankingScore into the four event_rankings columns 07-02 created, verbatim from the normalized TBA record; counts null ranking scores (nullRankingScoreCount); documents that --force is required to backfill columns onto an already-ingested season; and lets RankingScoreSortOrderError propagate uncaught, aborting the season"
    requirement: EVNT-02
    verification:
      - kind: other
        ref: "grep -vE non-comment packages/ingest/cli.ts | grep -c 'recordWins: ranking.recordWins' = 1; grep -c 'RankingScoreSortOrderError' = 0; grep -c 'nullRankingScoreCount' = 3"
        status: pass
    human_judgment: false
  - id: D7
    description: "Season 2022 is force-ingested live and proven by fresh read-only corpus queries: at least 200 populated events with a non-NULL ranking_score (measured: 236), zero NULL record columns, zero negative record values, at least 1000 rows with record_wins > 0, at least one non-integral ranking_score, and the row count unchanged-or-greater than the pre-run baseline (7,890)"
    verification:
      - kind: integration
        ref: "packages/ingest/rankingsLive.test.ts#event_rankings — record and ranking score after a forced ingest (plan 07-04 Task 3) (5 cases) — RED against the pre-ingest corpus (4/5 failed), GREEN after pnpm ingest:rankings --year 2022 --force"
        status: pass
    human_judgment: false
  - id: D8
    description: "07-02's T-07-02-06 accept-disposition premise (the sole upsertEventRanking caller always supplies all four D-18.6 fields) is re-derived against the post-07-03 tree, not inherited — exactly one call site exists, in cli.ts, and it now supplies all four"
    verification:
      - kind: other
        ref: "grep -rc 'upsertEventRanking(' packages/ingest/ — exactly 1 match, in cli.ts"
        status: pass
    human_judgment: false
  - id: D9
    description: "The whole-plan diff touches exactly the five declared files (packages/ingest/rankings.ts, rankings.test.ts, rankingsLive.test.ts, schemas.ts, cli.ts) and packages/corpus/ is untouched"
    verification:
      - kind: other
        ref: "git diff --stat 92003664 HEAD — 5 files in packages/ingest/, 0 in packages/corpus/"
        status: pass
    human_judgment: false
  - id: D10
    description: "Whether a bare pnpm test (no exported TBA_API_KEY) runs or skips the live-TBA block was determined by observation, not assumed — a backstop truth"
    verification: []
    human_judgment: true
    rationale: "Explicitly filed as a must_haves backstop in the plan — a fact about Vitest's own env-loading behavior in this repo, not a code assertion. Observed directly: a bare pnpm vitest run in a fresh shell reports the block as a named skip (1 skipped), never a silent pass and never a run without the key."
  - id: D11
    description: "The forced 2022 re-ingest's effect is provable only on the machine holding the gitignored ~359 MB data/corpus.sqlite — a backstop truth CI cannot prove and does not silently pass"
    verification: []
    human_judgment: true
    rationale: "Explicitly filed as a must_haves backstop in the plan. This machine's corpus-gated describe block proved it directly (RED before the ingest, GREEN after); a CI machine with no corpus reports the file's top-level CORPUS_AVAILABLE skip instead, which is the intended behavior, not a gap."

duration: ~20min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 4: The Sort-Order Guard and Widened Rankings Ingest Summary

**D-18.6: `normalizeEventRankings` now asserts TBA's `sort_order_info[0].name === "Ranking Score"` before reading a ranking-score value from that position (throwing `RankingScoreSortOrderError` on drift), persists TBA's own record/ranking-score into the four `event_rankings` columns 07-02 created, and both the guard's premise and the real write path are proven live — 40-plus-event RESEARCH.md finding re-confirmed against 5 fresh 2022-2026 live requests, and season 2022 force-ingested with 236/288 events now carrying a non-NULL ranking score.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-27T23:07:49-04:00 (prior commit)
- **Completed:** 2026-08-27T23:21:11-04:00
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `RANKING_SCORE_SORT_ORDER_NAME`/`RANKING_SCORE_SORT_ORDER_INDEX`/`RankingScoreSortOrderError` exported from `rankings.ts`; `normalizeEventRankings(response, eventKey)` guards position 0 of `sort_order_info` before reading `rankingScore` from that position, throwing a named, uncaught error on any mismatch (including an empty `sort_order_info`) while the null-body/empty-rankings early return stays unchanged and strictly first — the guard is unreachable when there is nothing to store
- `NormalizedEventRanking` widened with `recordWins`/`recordLosses`/`recordTies` (TBA's own record, passed through verbatim — never a match-derived tally) and `rankingScore: number | null` (`?? null` converts both the null-array and absent-element cases to SQL NULL, precision from `sort_order_info` never applied); `schemas.ts`'s `tbaEventRankingSchema` doc comment rewritten to match (comment-only diff, confirmed by reading `git diff -U0`)
- `packages/ingest/rankingsLive.test.ts` created: a corpus-gated + `TBA_API_KEY`-gated block fetches exactly the 5 corpus-resolved highest-match-count events (2022-2026) plus 2 live-observed empty-array events (`2025cmptx`, `2022ispr`) — 7 requests total, bounded by an asserted `counter.total <= 7` — and proves the guard's premise, record pass-through, and non-integral ranking-score against real TBA data, asserting the sort-order name against a literal never the exported constant; a second, corpus-only block proves the real forced-ingest write path
- `ingestSeasonRankingsOnly` now writes all four D-18.6 columns verbatim from the normalized record, counts null ranking scores, documents the `--force` backfill requirement (measured precedent: 06.1-04's all-324-304s re-run), and re-derives 07-02's T-07-02-06 accept premise against the post-07-03 tree (still exactly one caller)
- Season 2022 force-ingested live against real TBA (`pnpm ingest:rankings --year 2022 --force`): 288 events, 236 populated / 0 null-body / 52 empty-rankings / 0 cache hits (expected — `--force` bypasses the cache) / 48 rows skipped for an unregistered team key / 0 rows with a null ranking score, proven by fresh read-only corpus queries (236 populated events with non-NULL `ranking_score`, 0 NULL/negative record values, 1000+ rows with `record_wins > 0`, at least one non-integral `ranking_score`)

## Task Commits

Each task was committed atomically (Task 1 is TDD, so it has two commits: test → feat):

1. **Task 1: The sort-order guard and the widened normalize (D-18.6)** - `00c9146b` (test, RED) then `5fa500af` (feat, GREEN)
2. **Task 2: Prove the guard's premise against live TBA, bounded and repeatable** - `043ad9be` (test — live evidence against already-shipped Task 1 code, no separate implementation half to split)
3. **Task 3: Persist record and ranking score through the season ingest, and prove it against the real corpus** - `d993d603` (feat — includes the corpus-backed test block written and confirmed RED before the live ingest ran)

**Plan metadata:** (this commit — docs: complete 07-04 plan)

## Files Created/Modified
- `packages/ingest/rankings.ts` - `RANKING_SCORE_SORT_ORDER_NAME`/`_INDEX`/`RankingScoreSortOrderError`; `normalizeEventRankings(response, eventKey)` widened with the guard and record/ranking-score fields
- `packages/ingest/rankings.test.ts` - 12 new cases (24 total, up from 12) pinning the guard and the widened fields offline
- `packages/ingest/rankingsLive.test.ts` - new: two describe blocks — live-TBA proof (7 requests, 10 cases) and corpus-only proof of the forced 2022 ingest (5 cases)
- `packages/ingest/schemas.ts` - `tbaEventRankingSchema`'s doc comment corrected (comment-only diff)
- `packages/ingest/cli.ts` - `ingestSeasonRankingsOnly` widened to persist all four D-18.6 fields, count null ranking scores, and document `--force`; one-line `eventKey` thread from Task 1; usage header updated

## Decisions Made
- Task 1's RED/GREEN split reused 07-02's git-stash-the-implementation technique: the extended `rankings.test.ts` was run against the temporarily stashed original `rankings.ts`, confirming 11/24 cases failed for the expected reasons (missing exports, one-argument signature, undefined record/rankingScore fields) before restoring the implementation for GREEN
- Task 2's live test file is a single `test(...)` commit rather than RED/GREEN-split — it is new evidence exercising already-shipped Task 1 production code against live TBA, with no implementation half to stash
- Task 3's corpus-backed describe block genuinely followed TDD against the real corpus: written and run first against the pre-ingest state (4/5 cases failed — every 2022 row's four D-18.6 columns were still NULL from 07-02's migration), then the real forced ingest ran, then the same block passed unchanged
- Observed (not assumed) answer to the plan's stated open question: a bare `pnpm vitest run` / `pnpm test`, in a fresh shell with no exported `TBA_API_KEY`, reports the `TBA_API_KEY`-gated block as one named skip — this repo's `node` Vitest project does not load `.env` into `process.env` on its own; only the documented `set -a; . ./.env; set +a` invocation runs the live block. Recorded per the plan's design (no code change follows from the answer either way).

## Deviations from Plan

None — plan executed exactly as written. No Rule 1–4 auto-fixes were needed; every acceptance criterion in the plan's three tasks passed on the implementation as designed. The live 2022 ingest's 0 null-ranking-score count and 236/288 populated-event count both matched RESEARCH.md's live-sampled expectations rather than surfacing a new drift.

## Issues Encountered

None. The forced ingest's console output showed five stale "a prior run never completed" notices (from unrelated earlier partial sessions predating this plan) — expected, harmless, and resolved automatically by the run's own cached-ETag-continuation logic; it does not affect this plan's `--force` run, which bypasses the ETag cache entirely.

The pre-existing, out-of-scope `packages/harness/payloadBudget.test.ts` failure (WINDOWS.md ledger #11, `teams/{year}` payload ceiling) remains open and unaffected by this plan — confirmed unchanged before and after (1 failed / 1566→1571 passed across this plan's three commits, delta fully accounted for by this plan's own new test cases).

## User Setup Required

None - no external service configuration required. `.env`'s existing `TBA_API_KEY` was used exactly as every other `pnpm ingest*` script already uses it, via `tsx --env-file=.env` — never read, echoed, or interpolated by this plan's own code or commands.

## Next Phase Readiness
- `event_rankings`' four D-18.6 columns are now genuinely fillable end-to-end (guard + persistence + live proof), ready for 07-05's full `--years 2022-2026 --force` pass to backfill the remaining four seasons
- `RANKING_SCORE_SORT_ORDER_NAME`/`_INDEX`/`RankingScoreSortOrderError` are the reusable pattern for any future TBA positional-array read whose vocabulary genuinely varies by season but whose position is asserted stable — a second worked example alongside `hasEventRankingRecordColumns`' additive-migration pattern from 07-02
- `packages/ingest/rankingsLive.test.ts` is a standing regression guard: its live block re-proves the guard's premise on every `set -a; . ./.env; set +a; pnpm vitest run` invocation, and its corpus-only block re-proves the write path stays intact on every `pnpm test` run with the corpus present
- 07-08's `buildEventArtifact` (event artifact publisher) can now read real, non-NULL `record`/`ranking_score` values for 2022 via `selectEventRankingsForSeason` (07-02); the remaining four seasons await 07-05
- `EVNT-02` intentionally left Pending in REQUIREMENTS.md — this plan ships only the ingest-level half of the guard/record/ranking-score contract; the rendered Insights tab that fulfills the requirement text is 07-11's, matching the established 07-02/07-03/07-06/07-07 precedent

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All 5 modified/created files confirmed present on disk; all 4 task commits (`00c9146b`, `5fa500af`, `043ad9be`, `d993d603`) confirmed present in `git log`.
