---
phase: 07-event-pages
plan: 05
subsystem: database
tags: [tba-api, ingest, sqlite, corpus-census, live-data]

requires:
  - phase: 07-event-pages
    provides: "packages/ingest/cli.ts's ingestSeasonRankingsOnly (D-18.6, plan 07-04) and ingestSeasonAlliancesOnly (D-18.7, plan 07-03), which this plan's ten live invocations run unmodified"
provides:
  - "The real data/corpus.sqlite's event_rankings table force-refreshed across all five seasons (2022-2026): zero NULL record_wins/record_losses/record_ties/ranking_score corpus-wide, 47,695 rows, 1,322 distinct populated events"
  - "The real data/corpus.sqlite's event_alliances table populated for all five seasons: 10,290 rows, 1,355 distinct events with rows, the first-ever corpus-wide measurement of this table"
  - "packages/ingest/corpusCensus.test.ts — a standing corpus-wide census gate (29 cases across two describe blocks) proving both tables' state, gated on data/corpus.sqlite's presence, no network call, a permanent regression guard for a write path cli.ts makes untestable by import"
  - ".planning/phases/07-event-pages/COVERAGE.md — a new 'Measured cost — the real full-corpus 2022-2026 pass' section covering both endpoints' real per-season figures, request counts and ingest_runs-sourced wall clock, plus 2024's rankings null-body/empty-rankings split measured for the first time (closing 06.1-04 COVERAGE.md note [3])"
affects: [07-08-event-artifact-publisher, 07-10-real-subset-publish, 07-11-insights-tab, 07-14-alliances-tab]

actuals:
  tokens: 7750
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A corpus-wide census test file (corpusCensus.test.ts) as the standing proof for a CLI write path cli.ts's top-level main() call makes untestable by import — same CORPUS_AVAILABLE/existsSync gate convention as rankingsLive.test.ts, but asserting facts about the WHOLE corpus (every season, every row) rather than one response or one event"
    - "An --allow-empty commit as the honest representation of a task whose deliverable is entirely gitignored external state (the live-ingested corpus) with no tracked-file diff of its own, used when a prior task's commit already carried the shared test file both tasks specify against"

key-files:
  created:
    - packages/ingest/corpusCensus.test.ts
  modified:
    - .planning/phases/07-event-pages/COVERAGE.md
    - .planning/WINDOWS.md

key-decisions:
  - "Both corpusCensus.test.ts describe blocks (event_rankings and event_alliances) were authored together in Task 1's single commit, written before either live run began, rather than split one-block-per-task — applying the plan's own 'write the census file first, run the ingest second' discipline once to the whole file. Task 2's commit therefore carries no packages/ingest/ diff of its own; it is an --allow-empty commit whose message records the five live alliances invocations and their post-run corpus proof"
  - "Task 2's commit uses --allow-empty rather than a manufactured/padded diff — the honest reflection of a task whose real deliverable (the live-ingested corpus) is entirely gitignored external state with no tracked file to change"
  - "A pre-existing 07-02 test (packages/corpus/integrity.test.ts:314) asserts an event_rankings row can still be found with all four D-18.6 columns simultaneously NULL — an assertion this plan's own mandated full-corpus backfill permanently falsifies by design (zero NULL rows corpus-wide is D-18.6's designed end state). Left unfixed rather than edited, since every task's and the whole plan's own verification requires packages/corpus/'s diff stay empty; logged to .planning/WINDOWS.md ledger entry #12 instead, for a future plan to update the stale assertion"

patterns-established:
  - "For a plan whose deliverable is corpus state rather than code, verification runs INSIDE the executor (fresh read-only queries, ingest_runs-sourced wall clock) rather than being deferred to CI, which cannot reach the gitignored corpus at all — corpusCensus.test.ts is what makes this plan's claims re-checkable on any future machine holding the same corpus"

requirements-completed: []

coverage:
  - id: D1
    description: "Every one of the five rankings season invocations carries --force, verified by cacheHitCount reading 0 in every season's own summary line"
    requirement: EVNT-02
    verification:
      - kind: integration
        ref: "live pnpm ingest:rankings --year {2022..2026} --force console output — all five seasons report 0 cache hits this run"
        status: pass
    human_judgment: false
  - id: D2
    description: "After the forced five-season pass, zero rows in event_rankings carry a NULL record_wins, record_losses or record_ties, and zero carry a negative value in any of the three"
    requirement: EVNT-02
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_rankings — zero rows carry a NULL record_wins... / zero rows carry a negative value..."
        status: pass
    human_judgment: false
  - id: D3
    description: "The corpus-wide count of events with no event_rankings row at all lands in the 150-400 band around 06.1-04's measured 259 — measured: exactly 259"
    requirement: EVNT-02
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_rankings — the count of corpus events with no event_rankings row at all is greater than 150 / less than 400"
        status: pass
    human_judgment: false
  - id: D4
    description: "For each of the five rankings seasons, the run's event-level closed sum (populated + null-body + empty-rankings + cache-hits + 404-skips) equals SELECT COUNT(*) FROM events WHERE year = ? exactly"
    requirement: EVNT-02
    verification:
      - kind: other
        ref: "manual reconciliation in Task 1's commit message against each season's tee'd log and a fresh corpus query — all five seasons close exactly (288, 309, 324, 350, 310)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The forced re-ingest refreshes rows in place and never duplicates or deletes — event_rankings row count after the pass is greater than or equal to 06.1-04's measured 47,695"
    requirement: EVNT-02
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_rankings — event_rankings holds at least 47695 rows total — measured: exactly 47,695 (unchanged, row set already existed)"
        status: pass
    human_judgment: false
  - id: D6
    description: "2025bc, 2026wvrox and 2022ispr each exist as rows in events and each carry exactly zero event_alliances rows after the full pass"
    requirement: EVNT-05
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_alliances — {eventKey} exists in events and carries exactly zero event_alliances rows (all 3 keys)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every event with any event_alliances row has a contiguous alliance_number sequence: MIN=1, MAX=COUNT"
    requirement: EVNT-05
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_alliances — every event with at least one event_alliances row has a contiguous alliance_number sequence — measured: 0 offenders"
        status: pass
    human_judgment: false
  - id: D8
    description: "07-03's 2022 and 2024 alliance rows survive this pass untouched — the maximum fetched_at across all 2022/2024 rows is strictly less than the minimum fetched_at across 2023/2025/2026 rows"
    requirement: EVNT-05
    verification:
      - kind: integration
        ref: "packages/ingest/corpusCensus.test.ts#event_alliances — the maximum fetched_at across 2022 and 2024 event_alliances rows is strictly less than the minimum fetched_at across 2023, 2025 and 2026 rows"
        status: pass
    human_judgment: false
  - id: D9
    description: "The five season invocations are mutually independent and order-free — each reads/writes only its own season's rows"
    requirement: EVNT-02
    verification: []
    human_judgment: true
    rationale: "Explicitly marked verification: backstop in the plan's must_haves — a structural property of ingestSeasonRankingsOnly/ingestSeasonAlliancesOnly's SQL scoping, re-derived by inspection of packages/ingest/cli.ts (read_first, unchanged by this plan) rather than asserted by a new test."
  - id: D10
    description: "2024's rankings null-body/empty-rankings split, unmeasured since 06.1-04, is measured for the first time by this plan's forced pass"
    verification:
      - kind: other
        ref: "packages/ingest/corpusCensus.test.ts + COVERAGE.md's new section — 2024: 0 null-body, 44 empty-rankings, recorded and cross-referenced to 06.1-04 note [3]"
        status: pass
    human_judgment: false
  - id: D11
    description: "This plan's own claims are provable only on the machine holding the gitignored data/corpus.sqlite; corpusCensus.test.ts skips with an explicit message naming that path everywhere else"
    verification: []
    human_judgment: true
    rationale: "Explicitly marked verification: backstop in the plan's must_haves — a machine/credential-availability fact, not a code assertion CI can check. Verified by inspection: both describe blocks' CORPUS_AVAILABLE early-return names data/corpus.sqlite literally in their it.skip message."

duration: ~25min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 5: The Full-Corpus 2022-2026 Rankings and Alliances Ingest, and Its Census Summary

**All 1,581 corpus events across five seasons now carry real TBA-sourced `event_rankings` record/ranking-score data (D-18.6, force-refreshed, zero NULL columns, 47,695 rows) and `event_alliances` rows for every season including three newly-fetched ones (D-18.7, 10,290 rows, 1,355 distinct events) — proven not by either live run's own console tally but by a new standing corpus-wide census (`corpusCensus.test.ts`, 29 cases) that reads the corpus fresh after the fact, closing 06.1-04's unmeasured 2024 rankings split along the way.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-28T00:17:00Z (approx.)
- **Completed:** 2026-08-28T00:39:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 declared + 1 reported deviation)

## Accomplishments

- `packages/ingest/corpusCensus.test.ts` created: a corpus-gated (no network call, `data/corpus.sqlite`-only), permanent census gate with 29 cases across two describe blocks (`event_rankings` — 17 cases, `event_alliances` — 12 cases), the standing proof for `cli.ts`'s write path since that module's top-level `main()` call makes it untestable by import.
- All five rankings seasons force-refreshed live against real TBA (`pnpm ingest:rankings --year {2022..2026} --force`): 1,586 requests, 0 cache hits in every season (confirming `--force` reached `parseCliOptions` on all five), every season's event-level closed sum exact. Zero rows anywhere carry a NULL or negative record column; 47,305 of 47,695 rows carry `record_wins > 0`. 2024's null-body/empty-rankings split (0/44) measured for the first time, closing 06.1-04 COVERAGE.md note [3].
- All five alliances seasons ingested live (`pnpm ingest:alliances --year {2022..2026}`, no `--force` — 2022/2024 correctly read as 288/324 all-cache-hits against 07-03's already-fetched rows, 2023/2025/2026 fetched fresh): 10,290 total rows, 1,355 distinct events. `2025bc`/`2026wvrox`/`2022ispr` each hold exactly zero rows (D-17's absent case, proven reachable from real data). Zero non-contiguous `alliance_number` sequences. `picks` length histogram: 10 rows at length 2, 8,353 at length 3, 1,927 at length 4 — ten sub-three-pick alliances (`2022vabrb`, `2024vabrb`) flagged to 07-14's D-16 rule. 07-03's 2022/2024 rows proven untouched by `fetched_at` ordering.
- `.planning/phases/07-event-pages/COVERAGE.md` gained a full "Measured cost — the real full-corpus 2022-2026 pass" section: per-season tables for both endpoints sourced from `ingest_runs` and the tee'd logs, a corpus-state subsection reconciled against 06.1-04's 47,695/1,322/259 baseline (all three landed exactly on the baseline), and budget guidance including the standing `--force`-on-resume warning. 07-03's own closing handoff paragraph updated from a prediction to the realized outcome.

## Task Commits

1. **Task 1: The forced five-season rankings re-ingest, and the corpus-wide rankings census that proves it** - `4bd83419` (test — both describe blocks authored together; see Decisions)
2. **Task 2: The full-corpus alliances ingest, and the corpus-wide alliances census that proves it** - `d30bbbf8` (test — `--allow-empty`; see Decisions)
3. **Task 3: Reconcile the measured cost into COVERAGE.md** - `4757b10f` (docs)

## Files Created/Modified

- `packages/ingest/corpusCensus.test.ts` - new, 29 cases, created (Task 1's commit); unchanged afterward
- `.planning/phases/07-event-pages/COVERAGE.md` - new measured-cost section for this plan; 07-03's closing handoff paragraph updated in place; capability matrix untouched
- `.planning/WINDOWS.md` - one new ledger entry (#12) recording the `integrity.test.ts` deviation below — a reported, not declared, file (see Deviations)

## Decisions Made

- **Both `corpusCensus.test.ts` describe blocks were authored together in Task 1's single commit.** The plan's own instruction ("write the census file first, run the ingest second") was applied once to the whole file rather than split per task, since both blocks share the same `CORPUS_AVAILABLE`/`SEASONS` scaffolding and writing them together let both be verified RED (against the pre-pass corpus) before either live run began. Task 2's own commit therefore carries no `packages/ingest/` diff.
- **Task 2's commit is `--allow-empty`.** Its real deliverable — the five live alliances invocations and the corpus rows they wrote — is entirely gitignored external state with no tracked file of its own to change (the shared test file was already committed in Task 1). An `--allow-empty` commit with a message carrying the full evidence record is the honest representation of that reality rather than padding an unrelated file to manufacture a diff.
- **A discovered pre-existing test conflict was reported, not fixed.** `packages/corpus/integrity.test.ts:314` (07-02) asserts an `event_rankings` row can still be found with all four D-18.6 columns simultaneously NULL. This plan's own mandated forced backfill (D-18.6's designed end state: zero NULL record columns corpus-wide) permanently falsifies that assertion — there is no longer any such row anywhere in the corpus, by design. Every task's and the whole plan's own verification explicitly requires `packages/corpus/`'s diff stay empty, so the stale assertion was left unfixed and logged to `.planning/WINDOWS.md` ledger entry #12 instead, for a future plan (with `packages/corpus/` in its declared scope) to update it.

## Deviations from Plan

### Reported, not auto-fixed

**1. [Discovered, reported per scope conflict] `packages/corpus/integrity.test.ts`'s stale nullRows assertion**
- **Found during:** the final `pnpm test` run after Task 3
- **Issue:** `integrity.test.ts`'s "the migration did not corrupt columns it did not touch" case queries for an `event_rankings` row with `record_wins`/`record_losses`/`record_ties`/`ranking_score` all `IS NULL` and asserts it is found. After this plan's forced full-corpus backfill, zero such rows exist anywhere in the corpus — the assertion is now permanently unsatisfiable, by the exact design of D-18.6.
- **Why not auto-fixed:** This plan's own acceptance criteria and whole-plan `<verification>` section both explicitly require `git diff --stat packages/corpus/` to be empty for every task and for the plan as a whole. Editing `integrity.test.ts` would violate that hard, repeated, load-bearing constraint even though the failure is directly caused by this plan's own intended behavior.
- **Action taken:** Logged to `.planning/WINDOWS.md` ledger entry #12 (kind: deviation) with the exact file/line and mechanism, for a future plan (with `packages/corpus/` in scope) to update the stale assertion — e.g. by making it conditional on a NULL row still existing, or by testing the migration's default-value behavior against a synthetic corpus rather than the live one.
- **Files modified:** `.planning/WINDOWS.md` only (ledger entry)
- **Not modified:** `packages/corpus/integrity.test.ts` (out of scope)

**2. [Reported per the plan's own "any other file in the diff" instruction] `.planning/WINDOWS.md` is a third file in the plan's diff**
- The plan's `<verification>` states the whole-plan diff touches exactly two files (`corpusCensus.test.ts`, `COVERAGE.md`) and that "any other file in the diff is a scope deviation to report." `.planning/WINDOWS.md` is that third file, added solely to record deviation #1 above per the executor's standing broken-windows-ledger instructions. No corpus, ingest, harness, or app source file was touched.

---

**Total deviations:** 2 (both reported per explicit instruction, neither auto-fixed against a conflicting hard constraint)
**Impact on plan:** No impact on this plan's own acceptance criteria, all of which concern `corpusCensus.test.ts` and `COVERAGE.md` specifically and pass. The `integrity.test.ts` failure is a genuine, honestly-reported regression in the broader `pnpm test` suite, caused by this plan's correct intended behavior, deferred to a future plan with the right scope to fix it.

## Issues Encountered

`pnpm test`'s full suite shows 2 failing test files after this plan: the pre-existing, unrelated `packages/harness/payloadBudget.test.ts` (`teams/{year}` payload ceiling, WINDOWS.md ledger #11, unchanged by this plan — confirmed present before this plan's first commit too) and the newly-surfaced `packages/corpus/integrity.test.ts` failure documented above (WINDOWS.md ledger #12). 1,632 tests pass, 1 skipped (the `TBA_API_KEY`-gated live block in `rankingsLive.test.ts`, expected in a shell with no exported key per 07-04's documented observation).

## User Setup Required

None — no external service configuration required. `.env`'s existing `TBA_API_KEY` was used exactly as every other `pnpm ingest*` script already uses it, via `tsx --env-file=.env`, never read, echoed, or interpolated by this plan's own commands. A pre-commit `grep -qF` sweep of every staged diff and commit message against the key's value reported a match count of 0 at every commit.

## Next Phase Readiness

- `event_rankings` and `event_alliances` are now fully populated across all five seasons (2022-2026), ready for 07-08's `buildEventArtifact` to read real values for every season rather than only 2022/2024
- 07-10's real subset publish now has genuine `record`/`rankingScore`/alliance data to publish for every season, not just the two 07-03/07-04 force-fetched
- `packages/ingest/corpusCensus.test.ts` stands as a permanent regression guard: any future ingest run (or accidental partial re-run without `--force`) that regresses either table's coverage will fail this file's cases on the next `pnpm test`
- The ten sub-three-pick alliances (`2022vabrb`, `2024vabrb`) are a real, measured input 07-14 must account for in D-16's first-three-picks-sum rule — recorded in `COVERAGE.md`'s alliances subsection, not assumed away
- `.planning/WINDOWS.md` ledger entry #12 is open, naming `packages/corpus/integrity.test.ts:314` as needing an updated assertion; a future plan touching `packages/corpus/` should close it
- EVNT-02/EVNT-05 remain intentionally Pending in REQUIREMENTS.md — this plan ships only the corpus-data half; the rendered Insights/Alliances tabs that fulfill the requirement text are 07-11's and 07-14's, matching the established 07-02/07-03/07-04 precedent

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

`packages/ingest/corpusCensus.test.ts` confirmed present on disk (29 passing cases). All three task commits (`4bd83419`, `d30bbbf8`, `4757b10f`) confirmed present in `git log`. `.planning/phases/07-event-pages/COVERAGE.md`'s new section and `.planning/WINDOWS.md` ledger entry #12 confirmed present on disk.
