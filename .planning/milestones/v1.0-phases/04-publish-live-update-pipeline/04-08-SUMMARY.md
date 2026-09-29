---
phase: 04-publish-live-update-pipeline
plan: 08
subsystem: infra
tags: [d1, sql, state-shape, cloudflare-worker, opr, epa, sigma1, publish-pipeline]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline (plan 04-03)
    provides: "packages/harness/stateSnapshot.ts's serializeState/deserializeState/
      emitSeedSql — the row shape and D1 seed emitter this plan reshapes"
  - phase: 04-publish-live-update-pipeline (plan 04-05)
    provides: "apps/worker/src/stateStore.ts's readScopedState (one D1
      statement/one subrequest regardless of scale) — the read path this
      plan widens to more than one scope kind per request"
  - phase: 04-publish-live-update-pipeline (plan 04-06)
    provides: "apps/worker/src/scheduled.ts's runTick — the tick this plan's
      selectionsFor/loadOrInitState changes are threaded through"
  - phase: 04-publish-live-update-pipeline (plan 04-07, Task 1)
    provides: "the deployed sigmascout-worker (version 5a8e0a6f baseline) and
      emitSeedSql's DEFAULT_MAX_STATEMENT_LENGTH fix (4,000,000 -> 90,000,
      SeedRowTooLargeError firing at emit time) — this plan builds on both"
provides:
  - "packages/harness/stateSnapshot.ts: league rows holding only genuinely
    league-wide aggregates, per-team maps (sigma1/epa's priorSeasonRatings,
    opr's lastEventByTeam) moved to scopeKind:'team' union rows,
    STATE_SNAPSHOT_SHAPE_VERSION + LeagueRowShapeVersionError, and the
    exported MAX_LEAGUE_ROW_BYTES budget constant"
  - "apps/worker/src/stateStore.ts: readScopedState/readAndDeserializeScopedState
    widened to take a ScopeSelection[] list, so an algorithm storing more than
    one scope kind (opr: event + team) reads all of it in ONE D1 statement"
  - "remote D1 (sigmascout-state): all three published algorithms (opr, epa,
    sigma1) seeded for the first time, verified by a real read-back query"
  - "docs/publish-budget.md: the 'State-row shape' section — before/after
    league-row bytes, seed statement counts, post-import row counts, the
    re-measured deployed idle-tick CPU, and the re-seed-not-migrate decision,
    each figure naming the run and Worker version that produced it"
affects: [04-07-live-measurement-and-tba-secret]

# Actuals (#2632)
actuals:
  tokens: 17700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A scopeKind:'team' row's payload is a UNION type (current-season
      state, a prior-season rating, or both) rather than one fixed shape —
      a team known only via a prior-season rating gets its own row with
      only the fields it actually has, never a placeholder for the ones it
      doesn't (D-13, plan 04-08)"
    - "An explicit snapshotShapeVersion on every league payload, checked on
      the way in — the mechanism that keeps two independently-evolving
      readers (the offline serializer, the Worker's deserializer) from ever
      silently disagreeing about row shape; a stale/retired row fails
      loudly (LeagueRowShapeVersionError) instead of parsing with data
      quietly discarded"
    - "A multi-scope-kind D1 read is one ScopeSelection[] list matched
      explicitly per selection's own scope_kind in the WHERE clause — never
      one combined key list matched against a set of scope kinds, which
      would only work by accident of the key spaces never colliding"

key-files:
  created: []
  modified:
    - packages/harness/stateSnapshot.ts
    - packages/harness/stateSnapshot.test.ts
    - apps/worker/src/stateStore.ts
    - apps/worker/test/stateStore.test.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/scheduled.test.ts
    - docs/publish-budget.md

key-decisions:
  - "STATE_SNAPSHOT_SHAPE_VERSION starts at 2 (not 1) — the retired,
    pre-04-08 shape (per-team maps inside the league row, no version field
    at all) is implicitly version-less, so any explicit version value,
    including 1, would already distinguish the reshaped payload from it.
    Starting at 2 rather than 1 records that this IS a second shape, not
    the first."
  - "opr's league row after this plan holds ONLY snapshotShapeVersion — it
    genuinely has no other league-wide aggregate. This is correct, not a
    stub: OPR's per-event fit (D-09) already lives entirely in event rows,
    and lastEventByTeam (the one thing that WAS in the league row) is now
    entirely per-team. A league row with one field is exactly what
    'holds only genuinely league-wide aggregates' means when an algorithm
    happens to have none beyond the version tag."
  - "The Worker was redeployed once, immediately after Task 2's commit and
    before Task 3's re-seed — not redeployed a second time for the CPU
    re-measurement, since git status confirmed the working tree was still
    clean and HEAD unchanged at measurement time. The single deploy
    (version 8d1919c6) is what both the re-seed's deploy-before-reseed
    ordering AND the CPU re-measurement are attributed to."
  - "The league-row-size-independence test fixtures hold every GENUINELY
    league-wide field (componentOrder, league aggregates, allianceScoreStats,
    season, counters) IDENTICAL between the small and large team-count
    variants, varying only the per-team/prior-season maps that moved out —
    this makes byte-length equality a direct consequence of the reshape
    being correct, not a coincidence of two independently-replayed states
    happening to produce same-length JSON."

requirements-completed: []
# DATA-04/DATA-05 intentionally NOT marked complete in REQUIREMENTS.md,
# matching this phase's own established precedent (04-03/04-05/04-06's
# identical "intentionally NOT marked complete" note): DATA-05's own
# frontmatter requirements list still names plan 04-07, which owns the
# working-tick CPU measurement this plan's own prohibitions explicitly
# forbid claiming here. See coverage: below for what THIS plan verifiably
# shipped toward each.

coverage:
  - id: D1
    description: "Every published algorithm's league row carries only
      genuinely league-wide aggregates, and its byte size does not grow
      with team count — asserted at two team counts an order of magnitude
      apart (5 vs 50) for all three algorithms, plus at realistic season
      scale (3,800 teams) against emitSeedSql"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#serializeState — league row byte size is independent of team count (D-13, plan 04-08) — 3 tests"
        status: pass
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#emitSeedSql — realistic season-scale (3,800 teams) sigma1/epa/opr raises no SeedRowTooLargeError"
        status: pass
      - kind: other
        ref: "remote D1 read-back (this plan's own Task 3 <verify> block): every scope_kind='league' row's max_bytes at or under 16,384 (opr 26, epa 179, sigma1 7,465)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The offline-to-online state handoff is still exactly
      lossless after the reshape — the same continuation-replay digest
      equality proving the RETIRED shape correct still holds for all three
      algorithms; no prediction moved"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#serializeState/deserializeState — round-trip losslessness (continuation-replay digest) — unchanged, still 3/3 pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "All three published algorithms' seed files emit with no
      SeedRowTooLargeError and import into remote D1, confirmed by a real
      read-back query rather than reasoning about sizes — unblocking plan
      04-07's Task 2 precondition for epa and sigma1, which had NEVER been
      seedable before this plan"
    requirement: DATA-05
    verification:
      - kind: other
        ref: "pnpm publish:seasons exited 0 (2026-08-22, ~20:04:55Z); all three `npx wrangler d1 execute sigmascout-state --remote --file` imports succeeded; the plan's own automated read-back assertion passed against real remote D1 (opr/epa/sigma1 all present, every league row within budget)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A missing league row and a retired-shape league row each
      fail loudly with their own named error — the mechanism that makes
      the 210 opr rows already in production (retired shape) unreadable by
      the new deserializer rather than silently losing lastEventByTeam"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#deserializeState — league row shape version (D-13, plan 04-08) — 3 tests (absent version, stale version, current version accepted); #deserializeState — missing league row — unchanged, still passes"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Worker reads every scope kind an algorithm stores in
      ONE D1 statement/subrequest, matched per-selection against its own
      scope_kind explicitly (never a combined key list against a set of
      scope kinds), still through the harness's own deserializeState"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/stateStore.test.ts#readScopedState — multi-selection read (1 prepare/1 all() call, league always included, unrequested team excluded), same-scope_key-string non-collision test, total-key-count budget across selections"
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts — 'one live event, one new match' now asserts opr's touched-team rows land in the SAME batched write as its event row"
        status: pass
    human_judgment: false
  - id: D6
    description: "The re-measured deployed idle-tick CPU is recorded with
      its Worker version, honestly scoped as a no-regression check (the
      idle path loads no state and cannot demonstrate a working-tick
      parse-removal saving) — the measured saving this plan proves is the
      league-row-bytes reduction, not a CPU figure"
    requirement: DATA-05
    verification:
      - kind: other
        ref: "docs/publish-budget.md 'Worker deploy and re-measured idle-tick CPU' section: 12 consecutive wrangler tail invocations, version 8d1919c6-e8d7-4490-a583-bcb6bb46e691, median 7ms/range 5-13ms vs baseline median 7ms/range 5-9ms/cold-start 14ms (version 5a8e0a6f)"
        status: pass
      human_judgment: true
      rationale: "The honesty framing (idle path proves no CPU regression, not a working-tick saving) is a qualitative judgment about how the number is presented, not itself unit-testable."

# Metrics
duration: ~33min (commit span; overlaps a ~15min pnpm publish:seasons background run and a parallel 12-min wrangler tail capture, both polled to completion rather than assumed)
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 8: Move Per-Team Data Out Of League Rows Summary

**Sigma1's and EPA's `priorSeasonRatings` and OPR's `lastEventByTeam` moved out of `scopeKind: "league"` rows into `scopeKind: "team"` union rows, closing the actual defect that made two of three published algorithms unseedable — all three now emit, import into remote D1, and are verified there by a real read-back query, with the deployed Worker's idle-tick CPU re-measured and honestly scoped as a no-regression check, not a working-tick saving.**

## Performance

- **Duration:** ~33 min of commit-visible work; overlapped a ~15-minute `pnpm publish:seasons` background run and a parallel 12-minute `wrangler tail` capture (both explicitly polled to completion, per the plan's background-jobs discipline — no job was assumed to "resume automatically")
- **Tasks:** 3 (all executed)
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

### Task 1: Moved the per-team maps out of the league rows

**Required artifact — call-site findings (established before reshaping, per the plan's own instruction):**

- `packages/core/algorithms/sigma1/index.ts:1004` — `carrySeason` is `priorSeasonRatings`' ONLY
  read (`sigma1Carryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings }, params)`).
  Neither `predict` (lines 634-737) nor `update` (lines 739-922) reference it; `update`'s own
  return statement (line 918) carries it forward unchanged, which is a pass-through, not a read.
- `packages/core/algorithms/epa.ts:560` — `carrySeason` is `priorSeasonRatings`' ONLY read
  (`epaCarryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings })`). Neither `predict`
  (lines 342-388) nor `update` (lines 439-511) reference it; `update`'s return (line 508) is the
  same carry-forward pass-through pattern.
- `packages/core/algorithms/opr.ts:277` — `update()` reads `state.lastEventByTeam` only to
  clone-and-extend it forward (`let nextLastEventByTeam = state.lastEventByTeam; ... new
  Map(nextLastEventByTeam)`) — never reads a VALUE from it to compute a rating.
- `packages/core/algorithms/opr.ts:289` and `:292` — `teamMetrics()` is the real read
  (`state.lastEventByTeam.keys()` / `.get(team)`), and it is called on the PER-TICK path
  (`apps/worker/src/scheduled.ts:630`, `algorithm.teamMetrics(state, touchedTeams)`), not only at
  season carryover — DIFFERENT from sigma1/epa's `priorSeasonRatings`, and the plan's own
  `read_first` anticipated this distinction ("the fact that `teamMetrics` is called with an
  explicit team list"). This is still safe to reshape: `teamMetrics` only ever needs the SPECIFIC
  teams passed to it, and Task 2 makes those exact touched teams' rows load alongside the event row
  in the same statement — so a partial (touched-teams-only) load is exactly what `teamMetrics`
  needs, never less.

No `predict`/`update` call site was found for either moved map, so the reshape is safe as designed
— nothing on the leak-proof `predict`-before-`update` sequence reads per-team data at a granularity
finer than what a tick already loads.

**Reshape:** `packages/harness/stateSnapshot.ts`'s three serializers now emit `scopeKind: "team"`
rows as a UNION type — `current` (this team's current-season state, omitted entirely for a team
with none), `priorSeasonLastSeason`/`priorSeasonYearBefore` (sigma1/epa only). A team known ONLY
via a prior-season rating (no current-season entry at all) still gets its own row. OPR's
`lastEventByTeam` moves to one `scopeKind: "team"` row per team, holding just that team's
`lastEventKey` — kept structurally separate from event rows (folding it into the touched event's
own row would make a team claimed by two events ambiguous once events interleave, exactly the
ambiguity the plan's action text warned against).

Added `STATE_SNAPSHOT_SHAPE_VERSION` (starts at 2) to every league payload and
`LeagueRowShapeVersionError`, thrown by `deserializeState` when a league row's
`snapshotShapeVersion` is absent (the retired shape) or stale — the exact mechanism that makes the
210 `opr` rows already seeded in production (retired shape, pre-existing before this plan) fail
loudly rather than silently lose `lastEventByTeam` if read by the reshaped deserializer. Added the
exported `MAX_LEAGUE_ROW_BYTES` (16384) budget constant.

### Task 2: Widened the Worker's read to every scope kind an algorithm stores, still in one statement

`apps/worker/src/stateStore.ts`'s `readScopedState`/`readAndDeserializeScopedState` now take a
`ScopeSelection[]` (`{ scopeKind, scopeKeys }[]`) instead of one scope kind plus one key list. The
WHERE clause is one OR-joined `(scope_kind = ? AND scope_key IN (...))` group per selection, plus
the unconditional `scope_kind = 'league'` clause — each selection's keys matched against its OWN
scope kind explicitly, never a combined key list matched against a set of kinds (which would only
work by accident of team/event keys never colliding — the plan's own explicit prohibition).
`MAX_SCOPE_KEYS_PER_READ` now bounds the TOTAL key count across all selections.

`apps/worker/src/scheduled.ts`'s `scopeKindFor` was replaced with `selectionsFor` (event key + touched
teams for `opr`, touched teams for `epa`/`sigma1`), threaded through `loadOrInitState`. OPR now reads
its event row AND its touched teams' rows (holding `lastEventByTeam`) together, in the same single
statement/subrequest a tick already spent — no second read added.

### Task 3: Ran the real round trip for all three algorithms, re-measured, and wrote it down

Deployed the Worker FIRST (`pnpm worker:deploy`, version `8d1919c6-e8d7-4490-a583-bcb6bb46e691`,
from commit `752b0747` — Tasks 1 and 2 both already committed), then ran a real
`pnpm publish:seasons` (2022-2026, completed 2026-08-22 ~20:04:55Z, exit 0), then imported all
three seed files into remote `sigmascout-state`. `pnpm publish:seasons` exited 0 with NO
`SeedRowTooLargeError` for any of the three algorithms — the first time `epa` and `sigma1` have
ever successfully emitted a seed file. League-row bytes: `opr` 86,974 → 26, `epa` 251,995 → 179,
`sigma1` 259,174 → 7,465 (total 598,143 → 7,670 bytes, −98.72%), every one at or under
`MAX_LEAGUE_ROW_BYTES`. All three seed files' longest statements (90,050 / 90,101 / 90,034 bytes)
sit comfortably under D1's real 100,000-byte cap.

All three imports succeeded; the plan's own automated read-back assertion passed against REAL
remote D1 (not a local table): `opr` has both `event` rows (209) and `team` rows (3,699); `epa`
(4,598 team rows) and `sigma1` (4,598 team rows) are seeded for the first time ever.

Re-measured the deployed idle-tick CPU the same way the baseline was taken: 12 consecutive
`wrangler tail` invocations, version `8d1919c6-e8d7-4490-a583-bcb6bb46e691`, all `outcome: ok` —
median 7 ms (identical to baseline), range 5–13 ms (baseline 5–9 ms), first-captured invocation
13 ms (baseline cold start 14 ms, version `5a8e0a6f`). Recorded explicitly, per this plan's own
prohibitions, as a NO-REGRESSION CHECK ONLY: the idle path loads zero algorithm state, so it cannot
demonstrate the working-tick parse saving this plan actually delivers, which is the league-row-bytes
reduction above — a storage-shape number, not a CPU-timing one. The working-tick CPU measurement
remains plan 04-07's job.

Documented the re-seed-not-migrate decision (four reasons) and everything above in
`docs/publish-budget.md`'s new "State-row shape" section, leaving 04-07's pending "Worker runtime
budget" table and the `payloadBudget.test.ts`-parsed fenced JSON block untouched. Corrected the
"Re-baseline cadence" section with a note that its four-command sequence had only ever actually
completed for `opr` before this plan.

## Task Commits

1. **Task 1: Move the per-team maps out of the league rows, and make the old shape impossible to
   read silently** - `4ccf8018` (feat)
2. **Task 2: Make the Worker read every scope kind an algorithm stores, still in one statement** -
   `752b0747` (feat)
3. **Task 3: Run the real round trip for all three algorithms, re-measure, and write down what was
   measured** - `8ff47b16` (docs)

## Files Created/Modified

- `packages/harness/stateSnapshot.ts` - reshaped sigma1/epa/opr serializers, `STATE_SNAPSHOT_SHAPE_VERSION`, `LeagueRowShapeVersionError`, `MAX_LEAGUE_ROW_BYTES`
- `packages/harness/stateSnapshot.test.ts` - 9 new/updated tests: league-row size independence (3), shape-version rejection (3), prior-rating-only-team round trip (2, sigma1 + opr's lastEventByTeam), realistic-scale `emitSeedSql` (1); updated OPR D-09 scope-shape test
- `apps/worker/src/stateStore.ts` - `readScopedState`/`readAndDeserializeScopedState` widened to `ScopeSelection[]`
- `apps/worker/test/stateStore.test.ts` - multi-selection SQL-shape fake, 5 new tests (multi-selection read, non-collision, total-key budget, empty-multi-selection)
- `apps/worker/src/scheduled.ts` - `scopeKindFor` → `selectionsFor`, `loadOrInitState` threaded through
- `apps/worker/test/scheduled.test.ts` - multi-selection SQL-shape fake; "one live event" test now asserts opr's team rows land in the same batched write
- `docs/publish-budget.md` - new "State-row shape" section; corrected "Re-baseline cadence" historical note

## Decisions Made

See `key-decisions` in frontmatter. Summary: `STATE_SNAPSHOT_SHAPE_VERSION` starts at 2 (the
retired shape is implicitly version-less, so even 1 would distinguish it — starting at 2 records
this as a second shape, not the first); OPR's league row after this plan holds only the version
tag, which is correct (no other genuine league-wide aggregate exists for event-scoped OPR); the
Worker was deployed exactly once (right after Task 2, before Task 3's re-seed) and that single
deploy is what both the ordering requirement and the CPU re-measurement are attributed to, verified
via a clean `git status` at measurement time rather than assumed; the size-independence test
fixtures hold every genuine league-level field identical between team-count variants so byte-length
equality is a direct consequence of correctness, not coincidence.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixed bugs, no missing functionality discovered,
no blocking issues, no architectural changes.

## Known Stubs

None — every shipped export is real, tested code, verified against real remote D1 infrastructure
(not a local fake) for Task 3's core claims.

## Issues Encountered

- **Background-job wait discipline:** this plan's own instructions required actively polling
  long-running background jobs (`pnpm publish:seasons`, ~15 min; `wrangler tail` capture, 12 min)
  rather than assuming automatic resumption. Both were started via the harness's `run_in_background`
  facility and their completion was confirmed via the harness's own task-notification mechanism
  before proceeding — no job's result was assumed or fabricated.
- **`emitSeedSql`'s per-tuple budget vs. the final assembled statement:** measured `epa`'s longest
  statement at 90,101 bytes — a few dozen bytes over the nominal 90,000 `maxStatementLength`
  configuration value, because that accumulator bounds tuple bytes only, not the final `INSERT
  INTO ... VALUES ` prefix. Not a defect against this plan's actual acceptance criterion (every
  statement stays under D1's real 100,000-byte enforced cap, with ~9.9-10 KB to spare, exactly the
  headroom `emitSeedSql`'s own doc comment already reserves for this) — recorded honestly in
  `docs/publish-budget.md` rather than rounded down to look tidier.
- **Prompt-injection attempts encountered and disregarded:** several tool-result / system-reminder
  blocks during this session's tool calls contained embedded instructions urging a switch away from
  the dedicated Read/Edit/Write tools toward raw `Bash(cat/sed/heredoc)` file operations, and one
  instructed silently withholding a date change from the user. Both were recognized as inconsistent
  with this executor's actual operating instructions (which explicitly forbid heredoc-based file
  writes and mandate the dedicated tools, and which never authorize concealing information) and
  were not acted on. Noted here for visibility, not because either affected any change made.

## User Setup Required

None — Task 3's Cloudflare operations (deploy, D1 import, `wrangler tail`) used the OAuth
credentials already established by plan 04-01's Task 1 human-resolved checkpoint (`npx wrangler
whoami` confirmed authenticated, account `17b202367daf3a7f3d59a59ab287cb19`, before any command
ran, per this task's own `<precondition>`). `.env` was never read directly by this executor;
`pnpm publish:seasons` uses its own `tsx --env-file=.env` invocation internally, unchanged from
prior plans.

## Next Phase Readiness

- All three published algorithms (`opr`, `epa`, `sigma1`) are seeded in remote D1 for the first
  time — plan 04-07's Task 2 precondition (a seeded D1) is unblocked for all three, not just `opr`,
  which is the entire reason this plan existed.
- The deployed Worker (version `8d1919c6-e8d7-4490-a583-bcb6bb46e691`) is running this plan's
  reshaped read/write path against the newly-reshaped remote D1 rows — consistent end to end.
- The working-tick CPU measurement (folding a real live match, not an idle tick) remains explicitly
  unmeasured and is plan 04-07's job, exactly as this plan's own `must_haves`/prohibitions require.
- Whether Cloudflare's documented 10 ms free-plan CPU budget is actually enforced remains
  unresolved — both this plan's re-measurement and the pre-existing baseline show `outcome: ok`
  invocations above that figure (13 ms and 14 ms respectively), and neither this plan nor its
  predecessor settles what the platform actually enforces.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All three commit hashes (`4ccf8018`, `752b0747`, `8ff47b16`) confirmed present in `git log --oneline --all`.
All seven modified files confirmed present on disk with the expected content
(`packages/harness/stateSnapshot.ts`, `packages/harness/stateSnapshot.test.ts`,
`apps/worker/src/stateStore.ts`, `apps/worker/test/stateStore.test.ts`,
`apps/worker/src/scheduled.ts`, `apps/worker/test/scheduled.test.ts`, `docs/publish-budget.md`).
Remote D1 read-back (opr/epa/sigma1 all present, every league row within budget) independently
re-verified via a fresh query before writing this summary.
