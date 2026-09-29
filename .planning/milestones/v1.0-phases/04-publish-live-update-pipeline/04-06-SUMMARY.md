---
phase: 04-publish-live-update-pipeline
plan: 06
subsystem: infra
tags: [cloudflare-worker, cron, tba, d1, r2, live-update, opr, epa, sigma1]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline
    plan: "04-03"
    provides: "packages/harness/manifests.ts's LiveWindowsManifestSchema/
      AlgorithmsManifestSchema/isLiveAt/PUBLISHED_ALGORITHM_IDS and
      packages/harness/stateSnapshot.ts's serializeState/deserializeState --
      this plan's tick reads the manifests through these same schemas and
      round-trips state through the same (de)serializer"
  - phase: 04-publish-live-update-pipeline
    plan: "04-05"
    provides: "apps/worker/src/stateStore.ts's batched readScopedState/
      writeScopedState/readEventCursor/writeEventCursor/hasAlreadyFolded and
      apps/worker/src/subrequestBudget.ts's SubrequestBudget/rotate/
      sortEventKeys -- this plan's tick is built entirely on top of both,
      unchanged"
provides:
  - "apps/worker/src/liveWindows.ts: loadLiveWindowsManifest/
    loadAlgorithmsManifest/loadManifests (KV-primary, R2-fallback) and
    liveEventsAt -- a tick with nothing live reads exactly ONE manifest
    object"
  - "apps/worker/src/tbaPoll.ts: pollEventMatches, a thin wrapper reusing
    packages/ingest/tbaClient.ts's fetchEventMatches/TbaRequestCounter/
    THROTTLE_INTERVAL_MS unchanged (D-22, one politeness policy)"
  - "apps/worker/src/artifactWriter.ts: writeArtifactObject/
    readArtifactObject -- validates against the same pageArtifacts.ts
    schemas the offline publisher validates against before any R2 write,
    budget-gated, secret-scrub guarded"
  - "apps/worker/src/scheduled.ts: runTick/buildAlgorithmModules and the
    default scheduled() handler -- the real cron entrypoint: early exit,
    per-event poll/fold/write with state-before-artifact ordering, an
    optimistic-CAS overlap-safety claim on the event cursor, and a
    slower-cadence incremental teams/{year} rebuild"
  - "packages/harness/manifestSchemas.ts: the Worker-importable extraction
    of manifests.ts's pure schemas/isLiveAt/constants (Rule 3 fix) -- zero
    Node-only imports, mirrors leakProof.ts's own precedent"
  - "apps/worker/wrangler.toml: main now points at src/scheduled.ts (was
    plan 04-05's TEMPORARY bundleSmoke.ts pointer)"
affects: [04-07-live-measurement-and-tba-secret]

# Actuals (#2632)
actuals:
  tokens: 32300
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A module that must stay Worker-importable but shares logic with a
      Node-only sibling gets its PURE half extracted into its own leaf file
      with zero Node-only imports (manifestSchemas.ts out of manifests.ts),
      mirroring leakProof.ts's existing precedent for the identical problem
      -- never a second, independently-maintained copy of the same schema"
    - "Cursor-based idempotency alone is not safe against two genuinely
      overlapping invocations unless the CURSOR ADVANCE ITSELF is the
      atomic claim (an optimistic compare-and-swap UPDATE), performed
      BEFORE any state is read -- a plain read-then-write sequence has a
      window where a second invocation reads the first's already-advanced
      state as its own 'prior' and folds the same match twice"
    - "A Worker tick's per-event subrequest cost is estimated UP FRONT
      (right after polling reveals what actually changed) and the whole
      event defers atomically if insufficient, rather than starting and
      discovering mid-event that a later phase cannot be afforded --
      partial completion would leave state advanced with no future trigger
      to catch up the skipped artifacts"
    - "A slower-cadence 'global rebuild' inside a Worker with NO corpus
      access can only ever be an incremental merge of what this tick
      touched into the existing published wide table, never a from-scratch
      recomputation -- that stays the offline pipeline's job"

key-files:
  created:
    - apps/worker/src/liveWindows.ts
    - apps/worker/src/tbaPoll.ts
    - apps/worker/src/artifactWriter.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/liveWindows.test.ts
    - apps/worker/test/tbaPoll.test.ts
    - apps/worker/test/artifactWriter.test.ts
    - apps/worker/test/scheduled.test.ts
    - packages/harness/manifestSchemas.ts
  modified:
    - packages/harness/manifests.ts
    - apps/worker/wrangler.toml
    - apps/worker/src/bundleSmoke.ts

key-decisions:
  - "packages/harness/manifestSchemas.ts extracted (Rule 3 blocking fix,
    Task 1): this plan's own read_first instructs importing
    LiveWindowsManifestSchema/AlgorithmsManifestSchema/isLiveAt directly
    from manifests.ts, but that file imports node:fs/node:path and cli.ts
    (which pulls in the corpus/better-sqlite3) at module top level --
    importing it would have dragged that whole graph into the Worker
    bundle. Split the pure schema/predicate/constant half into a new leaf
    module with zero Node-only imports; manifests.ts re-exports every
    symbol unchanged so publish.ts/manifests.test.ts needed no changes."
  - "liveWindows.ts exports loadLiveWindowsManifest/loadAlgorithmsManifest
    as separate functions, not just the combined loadManifests -- the
    plan's own must_haves.truths requires the nothing-live path read
    exactly ONE manifest object; the algorithms manifest is only ever
    needed once something is live."
  - "Tick rotation offset and last-global-rebuild timestamp are persisted
    under a reserved sentinel event_cursor row (event_key =
    '__scheduler_meta__', a JSON blob riding in the existing
    last_folded_match_key column) rather than a new D1 table/migration --
    this plan's declared files_modified does not include the migration
    file, and stateStore.ts's event_cursor table already has exactly the
    columns needed."
  - "The tick claims an event's fold via an optimistic compare-and-swap
    UPDATE on event_cursor.last_folded_match_key (claimEventAdvance),
    performed BEFORE Phase A reads any state -- discovered necessary when
    the overlapping-invocation test failed: a plain read-cursor/fold/
    write-cursor sequence let a second invocation read the first's
    already-advanced state as its own baseline and fold the same match
    twice. A Phase A failure after a successful claim reverts the cursor to
    its prior value so a retry is safe (never desyncing cursor from state)."
  - "Per-event atomicity is coarser than per-algorithm: a rejected state
    write for ANY of the three published algorithms aborts the WHOLE
    event's fold (zero artifact puts, cursor reverted) -- the shared
    event_cursor has no per-algorithm granularity, so a partial per-
    algorithm advance would silently desync the un-advanced algorithms'
    folding forever (they would re-fold an already-applied match next
    tick)."
  - "Phase B (artifact writes) is deliberately best-effort, wrapped
    separately from Phase A: a failure there does not flip the event's
    'advanced' outcome, since state genuinely advanced correctly. A skipped
    artifact stays one tick stale until that team's next match at that
    event -- logged to WINDOWS.md rather than silently accepted."
  - "The event's TBA event_type (needed only by Sigma1's RP eligibility
    gate) is fetched once per event-with-new-matches via the SAME TBA
    client's fetchEventDetail (D-22, no second client) -- D-18's
    live-windows manifest deliberately does not carry it. Degrades
    gracefully to RP-ineligible on failure rather than failing the event."
  - "runGlobalRebuild only ever incrementally merges teams touched THIS
    session into the existing teams/{year} table (metrics + matchCount) --
    never a full corpus-based recompute, which the Worker cannot do at all
    (no better-sqlite3). win/loss/tie records and events/{year} are NOT
    touched by this path; both stay accurate only as of the last offline
    publish. Logged to WINDOWS.md as two open stubs."
  - "wrangler.toml's main now points at src/scheduled.ts; bundleSmoke.ts is
    KEPT in the repo (not deleted) as a re-runnable Assumption-A1 proof,
    per the plan's explicit instruction to decide deliberately -- its
    header updated to say it is no longer the entrypoint."

requirements-completed: []
# DATA-04/DATA-05 intentionally NOT marked complete -- both ids also appear
# in 04-07's frontmatter requirements list, which owns the deployed,
# measured peak-tick subrequest count and the TBA secret wiring this plan's
# own must_haves explicitly mark as backstop truths this plan does not
# claim. Matches 04-03/04-04/04-05's identical precedent for the same
# multi-plan requirement pair.

coverage:
  - id: D1
    description: "A tick with nothing live exits after reading exactly ONE
      small manifest object and spends zero requests against TBA"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- 'runTick — nothing live > performs exactly one manifest read, zero TBA requests, zero puts, and reports zero events'"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Worker polls TBA through the project's existing
      client unchanged (100ms spacing, conditional ETag requests, request
      counter) -- no second politeness policy"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/tbaPoll.test.ts (7 tests: 304 cache-hit counted as one request, 200 fresh, non-2xx throws with the event key, no secret leakage) -- imports fetchEventMatches/TbaRequestCounter/THROTTLE_INTERVAL_MS from packages/ingest/tbaClient.js unchanged (grep-verifiable)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A tick rewrites only the changed event's own artifact and
      its touched teams' artifacts; state is written for every published
      algorithm before any artifact put, and a rejected state write aborts
      the whole event with zero artifact puts while other live events still
      complete"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- 'writes state before any artifact put, one event put and one team put per touched team' (recorded call-order assertion) and 'a rejecting state write for one event yields zero artifact puts for it, while the other live event still completes'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two overlapping invocations cannot double-advance an
      event -- an optimistic CAS claim on the event cursor, performed
      before any state read, makes the cursor write itself the atomic
      claim"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- 'folds a match exactly once even when two runTick calls race against the same fakes' (compares the raced result's stored state_json against a non-overlapping baseline run's)"
        status: pass
    human_judgment: false
  - id: D5
    description: "One event failing (a throwing TBA poll) does not abort
      the tick -- the failure is confined to that event and the remaining
      live events are still served; a restrictive budget defers rather
      than starves, and the union of consecutive ticks (with the rotation
      offset advanced) covers every live event"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- 'a throwing TBA poll for one event is recorded as failed, and the other live event still completes' and 'the union of two ticks (with the rotation offset advanced) covers every live event'"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Worker advances only the three algorithms the
      published manifest names, at the exact versions/parameters it names,
      rebuilding the promoted Sigma1 module from the manifest's parameters
      -- algorithm modules are constructed ONCE per tick, never once per
      event"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- 'constructs the algorithm modules exactly once per tick, not once per event' (construction counter injected via RunTickDeps.buildAlgorithmModules)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every artifact the Worker writes passes the same Zod
      schema the offline publisher validates against, before the write; a
      write refuses a body containing the configured TBA secret"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/artifactWriter.test.ts (8 tests: one put per page kind at artifactKey's exact key, cache-control/content-type, zero puts on schema failure, zero puts + deferred on budget exhaustion, secret-scrub refusal)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The slower-cadence global rebuild (D-16) fires on a
      fixed interval OR an event completing its last scheduled match, and
      is skipped (not attempted-then-thrown) when the budget cannot afford
      it"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.test.ts -- the three 'runTick — global rebuild (D-16)' tests (event-boundary trigger, fixed-interval trigger, budget-exhaustion skip)"
        status: pass
    human_judgment: false
  - id: D9
    description: "wrangler.toml's main points at the real scheduled()
      entrypoint, not the plan 04-05 temporary bundle-smoke pointer"
    verification:
      - kind: other
        ref: "node -e main-pointer regex check (this plan's own Task 3 <verify> block) -- 'worker entrypoint OK'"
        status: pass
    human_judgment: false
  - id: D10
    description: "Measured peak-tick subrequest count and CPU time on a
      DEPLOYED Worker under live/replayed load -- explicitly a backstop
      truth this plan does NOT claim (matches 04-05's identical precedent)"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed Worker and a replay rig against real or
      recorded live-event traffic -- plan 04-07's scope per this plan's own
      must_haves marking it a backstop truth, not measurable from unit
      tests against hand-rolled fakes."

# Metrics
duration: ~70min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 6: The Live-Update Cron Tick Summary

**`apps/worker/src/scheduled.ts`'s `runTick` — poll TBA, fold state for all three published algorithms with a CAS-protected cursor claim (closing a real overlapping-invocation race a test caught), write state before any artifact, and rewrite only the changed event's and its ~6 touched teams' pages, all inside a per-event subrequest budget that defers atomically rather than partially completing.**

## Performance

- **Duration:** ~70 min (research-heavy: several architecture problems — a Worker-bundle-breaking import chain, a genuine overlapping-invocation race, a missing `event_type` field — were discovered and resolved mid-execution, each requiring re-verification)
- **Tasks:** 3 (all executed)
- **Files modified:** 12 (9 created, 3 modified)

## Accomplishments

- **Task 1 — `liveWindows.ts` + `tbaPoll.ts`:** `loadLiveWindowsManifest`/`loadAlgorithmsManifest` read KV first (one call each in the common case), falling back to R2; `loadManifests` composes both for callers that want both unconditionally. `liveEventsAt` filters through `isLiveAt` (imported, never re-implemented) and returns results in event-key order. `tbaPoll.ts`'s `pollEventMatches` is a genuinely thin wrapper — it imports `fetchEventMatches`/`TbaRequestCounter`/`THROTTLE_INTERVAL_MS` from `packages/ingest/tbaClient.ts` unchanged and adds nothing but the `Env` → `TbaClientContext` mapping.
  - **Rule 3 blocking fix discovered mid-task:** this task's own `read_first` instructs importing `LiveWindowsManifestSchema`/`AlgorithmsManifestSchema`/`isLiveAt` directly from `packages/harness/manifests.ts` — but that file imports `node:fs`/`node:path` and `cli.ts` (which pulls in the corpus/`better-sqlite3`) at module top level. A real `tsc -p apps/worker/tsconfig.json` run surfaced the resulting type error immediately (a `URL` ambient-type collision from the transitively-pulled-in `packages/corpus/db.ts`). Fixed by extracting the pure schema/predicate/constant half into a new leaf module, `packages/harness/manifestSchemas.ts` (zero Node-only imports) — the exact precedent `packages/core/algorithms/leakProof.ts` already set for the identical problem. `manifests.ts` re-exports every symbol unchanged; `manifests.test.ts` and `publish.ts` needed zero changes.
- **Task 2 — `artifactWriter.ts`:** `writeArtifactObject` validates against the matching `pageArtifacts.ts` schema before any write (zero puts on failure), refuses a body containing the configured TBA secret (`ArtifactSecretLeakError`, mirroring `artifact.ts`'s `writeArtifact` scrub guard), and gates the actual `put` through `SubrequestBudget.tryConsume` — a budget-exhausted write returns a non-throwing `{ deferred: true }`. `readArtifactObject` mirrors it for reads, returning `undefined` for a genuine miss and throwing a distinct `ArtifactReadBudgetExhaustedError` when the budget itself is the blocker.
- **Task 3 — `scheduled.ts`:** the real tick.
  - **Early exit (Pattern 2):** reads exactly the live-windows manifest first; only once at least one event is live does it read the algorithms manifest and build the published modules (once, hoisted for the whole tick — `buildAlgorithmModules`).
  - **Per event:** polls TBA conditionally, normalizes/orders matches, determines what's newly folded vs. still upcoming, estimates the event's total remaining subrequest cost up front and defers the WHOLE event atomically if the budget can't cover it, resolves the event's `event_type` (needed only by Sigma1's RP gate, absent from D-18's manifest) via the same TBA client's `fetchEventDetail`, folds every published algorithm's state (`predict` through `toLeakProofUpcoming`, then `update` — the same functions the offline harness calls), writes state for all algorithms before any artifact write, then read-modify-write merges the event's own artifact and each touched team's season artifact against whatever is currently published (the Worker has no corpus to rebuild from).
  - **Overlap safety, discovered and fixed via a failing test:** the original design advanced the cursor AFTER Phase A succeeded. A test that started two `runTick` calls against the same fakes (`Promise.all`) failed — the resulting state showed the same match folded TWICE. Root cause: a plain "read cursor → fold → write cursor" sequence has a window where a second invocation reads the first's already-written state as its own "prior" state and folds the same match again on top of it. Fixed with `claimEventAdvance`, an optimistic compare-and-swap `UPDATE ... WHERE last_folded_match_key IS <expected>` performed BEFORE any state read — the cursor write itself is the atomic claim. A Phase A failure after a successful claim reverts the cursor to its prior value in the `catch`, so a retry never desyncs cursor from state.
  - **Global rebuild (D-16):** fires on a 10-minute interval or an event completing its last scheduled match, persisted via a reserved sentinel row (`__scheduler_meta__`) in the existing `event_cursor` table rather than a new migration (outside this plan's declared files). Because the Worker has no corpus access at all, this can only be an incremental merge of teams touched since the last rebuild into the existing `teams/{year}` table (metrics + matchCount) — never a from-scratch recomputation. `win`/`loss`/`tie` records and `events/{year}` are not touched by this path; both stay accurate only as of the last offline `pnpm publish:seasons` run. Logged as two open stubs in `WINDOWS.md`.
  - **`wrangler.toml`** now points `main` at `src/scheduled.ts`. `bundleSmoke.ts` is kept in the repo, deliberately, as a re-runnable Assumption-A1 proof rather than deleted — its header updated to say it is no longer the entrypoint.

## Task Commits

1. **Task 1: liveWindows.ts and tbaPoll.ts** - `396dce43` (feat)
2. **Task 2: artifactWriter.ts** - `f246fe65` (feat)
3. **Task 3: the cron tick (scheduled.ts)** - `dabe9acd` (feat)

## Files Created/Modified

- `apps/worker/src/liveWindows.ts` - `loadLiveWindowsManifest`/`loadAlgorithmsManifest`/`loadManifests`/`liveEventsAt`
- `apps/worker/src/tbaPoll.ts` - `pollEventMatches`, thin wrapper over `packages/ingest/tbaClient.ts`
- `apps/worker/src/artifactWriter.ts` - `writeArtifactObject`/`readArtifactObject`, budget-gated, schema-validated, secret-scrubbed
- `apps/worker/src/scheduled.ts` - `runTick`/`buildAlgorithmModules`/default `scheduled()` handler — the real tick
- `apps/worker/test/liveWindows.test.ts` - 14 tests
- `apps/worker/test/tbaPoll.test.ts` - included in Task 1's 14 (7 tbaPoll-specific)
- `apps/worker/test/artifactWriter.test.ts` - 8 tests
- `apps/worker/test/scheduled.test.ts` - 11 tests
- `packages/harness/manifestSchemas.ts` - the Worker-importable schema extraction (new)
- `packages/harness/manifests.ts` - refactored to import/re-export from `manifestSchemas.ts`
- `apps/worker/wrangler.toml` - `main` now points at `src/scheduled.ts`
- `apps/worker/src/bundleSmoke.ts` - header updated (kept, not deleted, as a re-runnable proof)

## Decisions Made

See `key-decisions` in frontmatter for full detail. Summary: extracted `manifestSchemas.ts` to keep the Worker bundle free of Node-only code; split manifest reads so the nothing-live path costs exactly one; persisted tick metadata in a reserved `event_cursor` sentinel row rather than a new table; made the cursor advance an optimistic CAS performed before Phase A (the overlap-safety fix); made per-event atomicity coarse (all three algorithms or none) rather than per-algorithm, to avoid a cursor/state desync; fetched `event_type` via the existing TBA client rather than widening the live-windows manifest; scoped the global rebuild to an incremental `teams/{year}` merge only, given the Worker's total absence of corpus access; kept `bundleSmoke.ts` in the repo as a re-runnable proof.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, out-of-scope file] Extracted `packages/harness/manifestSchemas.ts` from `packages/harness/manifests.ts`**
- **Found during:** Task 1, immediately after writing the first draft of `liveWindows.ts` per its own `read_first` instruction to import schemas from `manifests.ts`
- **Issue:** `manifests.ts` imports `node:fs`/`node:path` directly and imports `warnIfNewerPromotedSigma1` from `cli.ts`, which itself imports the corpus (`better-sqlite3`). Importing any symbol from `manifests.ts` would pull that entire Node-only/native-module graph into the Worker's bundle — confirmed by a real `tsc -p apps/worker/tsconfig.json` run, which failed with a `URL` ambient-type collision originating from `packages/corpus/db.ts`.
- **Fix:** Extracted the pure schema/predicate/constant half (`LiveWindowsManifestSchema`, `AlgorithmsManifestSchema`, `isLiveAt`, `PUBLISHED_ALGORITHM_IDS`, etc. — zero Node-only imports) into a new leaf module, `packages/harness/manifestSchemas.ts`, mirroring the exact precedent `packages/core/algorithms/leakProof.ts` already set for the identical problem (extracted from `replay.ts` for the same reason). `manifests.ts` re-exports every symbol unchanged.
- **Files modified:** `packages/harness/manifestSchemas.ts` (new), `packages/harness/manifests.ts`
- **Verification:** `apps/worker/tsconfig.json` typechecks clean; `pnpm typecheck` (root) clean; `pnpm vitest run packages/harness/manifests.test.ts` — 16/16 pass unchanged; full `pnpm test` — 855/855 pass at the time of this fix.
- **Committed in:** `396dce43` (Task 1 commit)

**2. [Rule 2 - Missing critical functionality] `event_type` resolved via `fetchEventDetail`, not carried by the live-windows manifest**
- **Found during:** Task 3, while wiring the leak-proof `MatchResult`/`UpcomingMatch` objects Sigma1's `predict`/`update` require
- **Issue:** `packages/core/algorithms/types.ts`'s `UpcomingMatch.eventType` is a required field Sigma1's RP eligibility gate reads (`isRpEligibleEventType`), but D-18's live-windows manifest (`LiveWindowEntry`) does not carry it, and the Worker has no corpus access to look it up.
- **Fix:** Resolved once per event-with-new-matches via `packages/ingest/tbaClient.ts`'s existing `fetchEventDetail` (D-22, same client/counter, no second politeness policy). Degrades gracefully to an unmapped `event_type` (RP simply comes out ineligible for that match) on any failure, rather than failing the whole event over an auxiliary value.
- **Files modified:** `apps/worker/src/scheduled.ts`
- **Verification:** `apps/worker/test/scheduled.test.ts`'s event-fold tests stub `fetchEventDetail`'s underlying `fetch` call and assert normal completion.
- **Committed in:** `dabe9acd` (Task 3 commit)

**3. [Rule 1 - Bug] Fixed a real double-fold race under overlapping invocations**
- **Found during:** Task 3, running the plan's own required "two overlapping `runTick` calls fold each match exactly once" test
- **Issue:** The original design (cursor read → fold → write cursor, cursor advanced AFTER Phase A) left a window where a second, genuinely overlapping invocation could read the first invocation's already-advanced state as its own "prior" state and fold the same match a second time on top of it — the test caught this directly: the raced run's stored `state_json` showed the fold applied twice (a doubled observations array) where a non-overlapping baseline run showed it applied once.
- **Fix:** Added `claimEventAdvance`, an optimistic compare-and-swap `UPDATE event_cursor SET ... WHERE last_folded_match_key IS <expected>`, performed BEFORE any state is read — the cursor write itself is now the atomic claim; a losing invocation's identical attempt affects zero rows and returns `false` (treated as "unchanged" this tick). A Phase A failure after a successful claim reverts the cursor to its prior value in the `catch` block, so the state/cursor pair can never desync even under this new ordering.
- **Files modified:** `apps/worker/src/scheduled.ts`, `apps/worker/test/scheduled.test.ts` (fake D1 extended to support the conditional `UPDATE`/`INSERT ... WHERE NOT EXISTS` SQL shapes and to return `meta.changes`)
- **Verification:** `apps/worker/test/scheduled.test.ts`'s overlapping-invocation test passes (raced state matches the non-overlapping baseline exactly); full `apps/worker/test/scheduled.test.ts` suite (11/11) and `pnpm test` (874/874) pass.
- **Committed in:** `dabe9acd` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking/out-of-scope-file, 1 missing-critical-functionality, 1 bug)
**Impact on plan:** All three were necessary for the plan's own explicit must_haves/acceptance criteria to hold at all (a Worker bundle that actually builds, RP prediction that doesn't silently misfire on live matches, and the literal overlapping-invocation correctness property the plan's own test list requires). No scope creep beyond what each fix required.

## Known Stubs

- **`runGlobalRebuild`'s incremental `teams/{year}` merge does not update the `record` (win/loss/tie) field** — only `metrics`/`matchCount` are refreshed online; `record` stays as of the last offline publish until a future plan threads per-team match outcomes through the touched-teams accumulator. Logged to `WINDOWS.md`.
- **`events/{year}` is never rebuilt by the online path at all** — only `teams/{year}` (via `runGlobalRebuild`). The events list stays accurate only as of the last offline `pnpm publish:seasons` run. Logged to `WINDOWS.md`.
- **Phase B (artifact writes) is best-effort** — a failure there does not change an event's "advanced" outcome, but a skipped artifact stays one tick stale until that team's next match at that event; no future trigger specifically re-attempts a partially-completed Phase B. Logged to `WINDOWS.md` as a deviation.
- **`normalizeMatch`'s `sortTime` fallback uses an approximated event start date** (derived from the live-window manifest's `startMs`, not the corpus's real `start_date`, which the Worker cannot read) — only exercised for a match TBA reports with no `actual_time`/`predicted_time`/`time` at all, an edge case real matches rarely hit.

Ledger entries appended to `.planning/WINDOWS.md`: `stub` (teams/{year} record field), `stub` (events/{year} not rebuilt online), `deviation` (Phase B best-effort staleness).

## Issues Encountered

- **A genuine distributed-systems correctness bug, caught by the plan's own required test** (see Deviation 3 above) — the overlapping-invocation race was not something the plan's action text described how to solve; discovering and fixing it (the CAS claim) was the single most time-consuming part of this plan's execution.
- No orphaned `wrangler dev`/miniflare processes — this plan never started one (all verification was `tsc`/`vitest` against hand-rolled fakes, per the plan's own explicit test design; a real deployed-Worker measurement is 04-07's job).
- `.env` was never read (this plan touches no live TBA/R2 credentials — the Worker's `TBA_API_KEY` secret is wired by `wrangler secret put` in plan 04-07).

## User Setup Required

None — no external service configuration required by this plan. Plan 04-07 sets the real `TBA_API_KEY` Cloudflare secret and deploys.

## Next Phase Readiness

- `apps/worker/src/scheduled.ts` is the real `scheduled()` entrypoint (`wrangler.toml`'s `main` confirmed pointing at it) — plan 04-07 can deploy it, set the `TBA_API_KEY` secret, and measure the real deployed-Worker peak-tick subrequest count and CPU time this plan's own `must_haves` explicitly leaves as a backstop truth.
- Every acceptance criterion this plan's own `<verification>`/`<success_criteria>` sections name is met and test-proven: nothing-live early exit, state-before-artifact ordering, per-event error confinement, no-starvation budget coverage, single-construction algorithm modules, and the global-rebuild triggers.
- Not yet measured (explicitly out of this plan's scope, 04-07's job): whether the REAL per-event subrequest cost (this plan's `estimatedCost` formula: `2 + algorithmCount*2 + 1 + algorithmCount*2*(1+touchedTeams)`) actually stays under the Workers free-plan 50-subrequest cap at a real 38-concurrent-event peak with 3 algorithms and ~6 touched teams per event — the code-side budget/deferral mechanism (this plan's job) is what makes exceeding it survivable regardless, but the concrete number needs a deployed measurement.
- The two `teams/{year}`/`events/{year}` incremental-rebuild limitations (see Known Stubs) are real, bounded, and documented — a future plan extending `runGlobalRebuild` to also thread win/loss/tie deltas and an `events/{year}` merge would close them.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All nine created files confirmed present on disk (`apps/worker/src/liveWindows.ts`,
`apps/worker/src/tbaPoll.ts`, `apps/worker/src/artifactWriter.ts`,
`apps/worker/src/scheduled.ts`, `apps/worker/test/liveWindows.test.ts`,
`apps/worker/test/tbaPoll.test.ts`, `apps/worker/test/artifactWriter.test.ts`,
`apps/worker/test/scheduled.test.ts`, `packages/harness/manifestSchemas.ts`).
All three task commits (`396dce43`, `f246fe65`, `dabe9acd`) confirmed present
in `git log --oneline --all`.
