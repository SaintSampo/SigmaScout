---
phase: 04-publish-live-update-pipeline
plan: 03
subsystem: infra
tags: [zod, d1, sql, cloudflare-worker, sigma1, opr, epa, publish-pipeline]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline (plan 04-01)
    provides: "the Cloudflare Bootstrap & Publish Tracer — pageArtifacts.ts's
      generation/computedAt preamble convention this plan's two manifests
      follow, and the recorded decision that applyPromotedOverrides'
      promoted-version resolution would ride in an offline-published
      manifest this plan builds"
provides:
  - "packages/harness/manifests.ts: LiveWindowsManifestSchema/isLiveAt (D-18's
    half-open live-window predicate, corpus-match-derived windows with a
    4-day inferred fallback) and AlgorithmsManifestSchema/buildAlgorithmsManifest
    (D-03's published-set schema, rejecting the four harness-only Sigma1
    link-mode ids by name, with the Sigma1 entry read from the same committed
    promoted-version file applyPromotedOverrides pins)"
  - "packages/harness/stateSnapshot.ts: serializeState/deserializeState (D-12's
    lossless offline-to-online state handoff, D-09's per-algorithm scope
    shape — event-scoped OPR rows keyed by event, Sigma1/EPA rows keyed by
    team) and emitSeedSql (D-12's bulk D1 seed emitter)"
  - "apps/worker/migrations/0001_algorithm_state.sql: the D1 schema
    (algorithm_state, event_cursor) a Worker will read per tick"
affects: [04-04-cron-worker-poll-and-fold, 04-05-cron-worker-scaffold,
  04-06-worker-read-path]

# Actuals (#2632)
actuals:
  tokens: 18800
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline-published manifest = the Worker's only source of a decision
      that must not have a second, independent rule (D-18 liveness, D-03
      algorithm identity) — the manifest builder re-runs the SAME resolution
      the harness/CLI already uses (warnIfNewerPromotedSigma1,
      applyPromotedOverrides' pinned path) rather than re-deriving it"
    - "State snapshot rows are scoped by what an algorithm actually
      accumulates (team | event | league), never forced into one assumed
      granularity — D-09's event-scoped OPR gets event rows, Sigma1/EPA get
      team rows, proven lossless via computePredictionStreamDigest over a
      continuation replay rather than a structural deep-equal"
    - "Every Map member serialized as a key-sorted array of pairs, every
      plain object canonicalized with sorted keys, before stringifying —
      what makes re-serializing an unchanged team produce byte-identical
      JSON (a Worker can skip a D1 write for a team that did not move)"
    - "D1 bulk-seed emission: DELETE-then-INSERT re-baseline guard, single
      terminal file write, batched INSERTs capped by both row count and
      character length — baselineFingerprint.ts's single-write discipline
      applied to a SQL import file instead of a JSON artifact"

key-files:
  created:
    - packages/harness/manifests.ts
    - packages/harness/manifests.test.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/stateSnapshot.test.ts
    - apps/worker/migrations/0001_algorithm_state.sql
  modified: []

key-decisions:
  - "D-18's LiveWindowEntry ships WITHOUT a `name` field, despite the plan's
    action text listing `{ eventKey, season, name, startMs, endMs, inferred
    }`. packages/corpus/schema.sql's events table has no name/nickname
    column at all (event_key, year, event_type, is_offseason, start_date
    only), and schema.sql is outside this plan's declared files_modified.
    Rule 3 (blocking issue, out of declared file scope to fix) — omitted the
    field rather than fabricate a value or edit a file owned by a different
    concern. A future plan that adds an event-name column can add `name` to
    this schema additively."
  - "serializeState/buildLiveWindowsManifest/buildAlgorithmsManifest all take
    an explicit { generation, computedAt } stamp parameter, not an implicit
    default. The plan's abbreviated signatures (serializeState(algorithmId,
    version, state), buildLiveWindowsManifest(db, { seasons, padMs })) don't
    literally show it, but D-04's stamp discipline ('never an implicit
    stamp — a wrong number with no way to explain itself is the failure this
    project's log already records') requires it, and pageArtifacts.ts's
    buildEventArtifact already establishes this exact pattern."
  - "serializeState/deserializeState dispatch on algorithmId (opr -> event
    scope, epa -> team scope, everything else -> Sigma1 shape) rather than
    exposing five separate per-link-mode functions — sigma1/
    sigma1-defaults/sigma1-seasonsd/sigma1-normalcdf/sigma1-adapt all share
    IDENTICAL Sigma1State shape (makeSigma1's prebuilt modules differ only
    in predict()'s link mode, never in what update() accumulates), so one
    dispatch branch correctly covers all five without duplicating logic."
  - "emitSeedSql's DEFAULT_MAX_STATEMENT_LENGTH (4,000,000 chars) is a
    conservative guess against 04-RESEARCH.md's documented ~7.5MB real
    failure point, not itself independently measured against a live
    wrangler d1 execute --file run — flagged for the plan that first runs
    this against production D1 to confirm or tighten."

requirements-completed: []
# DATA-04/DATA-05 intentionally NOT marked complete in REQUIREMENTS.md,
# matching this phase's own established precedent (STATE.md's repeated
# "intentionally NOT marked complete... also appears in a later plan's
# requirements list" pattern): both ids also appear in 04-05/04-06/04-07's
# frontmatter requirements, and this plan ships only the offline-published
# manifests + state-snapshot handoff + D1 schema — not the actual cron
# Worker that achieves DATA-04's ~1-3 min freshness or DATA-05's full
# measured-budget claim. See coverage: below for what THIS plan verifiably
# shipped toward each.

coverage:
  - id: D1
    description: "The Worker's liveness question has an offline-published,
      schema-validated answer: a half-open live-window manifest derived from
      each event's own match timestamps, with a documented inferred
      fallback for a zero-match event"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "packages/harness/manifests.test.ts#isLiveAt — half-open interval contract (D-18)"
        status: pass
      - kind: unit
        ref: "packages/harness/manifests.test.ts#buildLiveWindowsManifest — corpus-derived windows"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Worker's algorithm-identity question has an
      offline-published, schema-validated answer: exactly opr/epa/sigma1,
      with the four harness-only Sigma1 variants mechanically rejected and
      the Sigma1 entry's version proven to equal the committed promoted file"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "packages/harness/manifests.test.ts#AlgorithmsManifestSchema — D-03 harness-only rejection"
        status: pass
      - kind: unit
        ref: "packages/harness/manifests.test.ts#buildAlgorithmsManifest — D-03's published set"
        status: pass
    human_judgment: false
  - id: D3
    description: "The offline-to-online state handoff is lossless for all
      three shipped algorithms, proven by continuation-replay prediction
      digest equality (not a structural deep-equal), with D-09's
      per-algorithm scope shape (event-scoped OPR vs. team-scoped Sigma1/EPA)
      and D-13's partial-load property both verified"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#serializeState/deserializeState — round-trip losslessness (continuation-replay digest)"
        status: pass
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#deserializeState — partial load (D-13)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The D1 schema exists (algorithm_state, event_cursor) with
      algorithm_version deliberately excluded from the primary key, and can
      be filled from an offline snapshot via emitSeedSql's DELETE-then-INSERT
      bulk seed, split by both row count and statement length"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/harness/stateSnapshot.test.ts#emitSeedSql (8 tests)"
        status: pass
      - kind: other
        ref: "node -e migration-shape check (plan's Task 3 <verify> block) — 'D1 migration shape OK'"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 3: Live-Update Manifests & State Snapshot Summary

**Two offline-published manifests (D-18 live windows, D-03 algorithm identity) plus a lossless, digest-proven state snapshot serializer and D1 seed emitter — the three things standing between the offline pipeline and the Worker.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (all executed)
- **Files modified:** 5 (all created, none modified)

## Accomplishments

- Built `packages/harness/manifests.ts`'s **live-windows manifest** (D-18):
  `isLiveAt` is the single half-open `[startMs, endMs)` liveness predicate
  the offline builder and (eventually) the Worker will both read from;
  `buildLiveWindowsManifest` derives each event's window from its OWN match
  `sort_time` span (padded 1 hour each side, `LIVE_WINDOW_PAD_MS`), falling
  back to a `[start_date, +4 days)` window flagged `inferred: true` for an
  event with zero matches yet.
- Built the **algorithms manifest** (D-03): `AlgorithmsManifestSchema`
  mechanically rejects any of the four harness-only ids
  (`sigma1-defaults`/`sigma1-seasonsd`/`sigma1-normalcdf`/`sigma1-adapt`) by
  name; `buildAlgorithmsManifest` reads `opr`/`epa`'s `id`/`version` straight
  from the modules and reads the Sigma1 entry from the same committed
  promoted-version file `applyPromotedOverrides` pins (calling the same
  `warnIfNewerPromotedSigma1` staleness check first) — closing T-04-16 (the
  manifest and the harness's own promoted-version resolution can never name
  two different Sigma1 versions).
- Built `packages/harness/stateSnapshot.ts`'s **lossless state handoff**
  (D-12/D-13/D-09): `serializeState`/`deserializeState` convert each of the
  three shipped algorithms' in-memory state to/from a flat `StateRow[]`,
  scoped per D-09 (event-scoped OPR rows keyed by event, Sigma1/EPA rows
  keyed by team, one shared `league` row per algorithm). Every `Map` member
  is serialized as a key-sorted array of pairs and every plain object with
  sorted keys, so re-serializing an unchanged team produces byte-identical
  JSON. Losslessness is proven by `computePredictionStreamDigest` over a
  continuation replay (the same standard Phase 3 uses for run
  reproducibility) for all three algorithms, not a structural deep-equal —
  and a dedicated partial-load test proves a league row plus two team rows
  predicts identically to the full state for a match between exactly those
  two teams (D-13's per-team-granular-read requirement).
- Built `apps/worker/migrations/0001_algorithm_state.sql`: `algorithm_state`
  (primary key `(algorithm_id, scope_kind, scope_key)` — an indexed slice
  read, not a whole-league load; `algorithm_version` deliberately NOT in the
  key so a version bump overwrites in place instead of doubling the
  league's footprint against D1's 500MB ceiling) and `event_cursor`
  (`tba_etag`/`last_folded_match_key` — D-15/D-19/D-22's per-event cron
  bookkeeping, living in D1 rather than KV's 1,000-writes/day cap).
- Built `emitSeedSql`: turns `serializeState`'s rows into a `.sql` file
  `wrangler d1 execute --file` can import — a `DELETE FROM algorithm_state
  WHERE algorithm_id = '<id>'` re-baseline guard (D-12: the offline run is
  the authority, so a re-baseline overwrites rather than merges), batched
  `INSERT`s capped by both row count (default 500) and character length
  (default 4MB, well under D1's real ~7.5MB import failure point), single
  quotes doubled in every string field, and exactly one terminal file write.

## Task Commits

1. **Task 1: The two manifests — what is live, and what may be advanced** -
   `2afd5849` (feat)
2. **Task 2: A live-state snapshot that round-trips without losing anything** -
   `d64d1210` (feat)
3. **Task 3: The D1 table, and the bulk seed that fills it** - `a346aa9f`
   (feat)

## Files Created/Modified

- `packages/harness/manifests.ts` - `LiveWindowsManifestSchema`/`isLiveAt`/`buildLiveWindowsManifest`, `AlgorithmsManifestSchema`/`buildAlgorithmsManifest`/`PUBLISHED_ALGORITHM_IDS`
- `packages/harness/manifests.test.ts` - 16 tests covering the half-open boundary, corpus-derived + inferred windows, harness-only-id rejection, Sigma1 version agreement
- `packages/harness/stateSnapshot.ts` - `StateRowSchema`, `serializeState`/`deserializeState`, `emitSeedSql`
- `packages/harness/stateSnapshot.test.ts` - 19 tests: 3 continuation-replay digest round-trips, D-09 scope-shape assertions, stability, partial load, missing-league-row error, Map-size preservation, 8 `emitSeedSql` tests
- `apps/worker/migrations/0001_algorithm_state.sql` - `algorithm_state`/`event_cursor` D1 tables plus the scope index

## Decisions Made

- `LiveWindowEntry` ships without a `name` field — see Deviations below.
- `serializeState`/manifest builders take an explicit `{ generation,
  computedAt }` stamp parameter, matching `pageArtifacts.ts`'s
  `buildEventArtifact` convention rather than defaulting it implicitly.
- One dispatch branch (`opr` -> event scope, `epa` -> team scope, everything
  else -> Sigma1 shape) covers all three shipped algorithms plus Sigma1's
  four harness-only siblings, since they share identical `Sigma1State` shape.
- `packages/harness/manifests.ts` imports `warnIfNewerPromotedSigma1` from
  `cli.ts` (exported) but reimplements `PROMOTED_SIGMA1_VERSION_PATH`/
  `ALGORITHM_VERSIONS_DIR` locally (module-private in `cli.ts`) — the same
  small, deliberate duplication `cli.ts`'s own file header already
  documents for mirroring `promote.ts`'s private constant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, out-of-scope file] Dropped the `name` field from `LiveWindowEntry`**
- **Found during:** Task 1
- **Issue:** The plan's action text specifies each live-window entry as `{
  eventKey, season, name, startMs, endMs, inferred }`, but
  `packages/corpus/schema.sql`'s `events` table carries no name/nickname
  column at all (`event_key`, `year`, `event_type`, `is_offseason`,
  `start_date` only) — there is no data to source a `name` field from.
- **Fix:** Omitted `name` from `LiveWindowEntrySchema`/`LiveWindowEntry`,
  documented in `manifests.ts`'s inline comments. Adding an event-name
  column to the corpus schema is itself out of this plan's declared
  `files_modified` (`packages/corpus/schema.sql` belongs to a different
  concern and plan 04-02 is concurrently editing adjacent corpus files in
  this same wave). No acceptance criterion in the plan tests for a `name`
  field's presence, so nothing else in the plan's verification depends on it.
- **Files modified:** `packages/harness/manifests.ts`
- **Verification:** `manifests.test.ts`'s 16 tests all pass without a `name`
  assertion; `pnpm typecheck` is clean.
- **Committed in:** `2afd5849` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking/out-of-scope)
**Impact on plan:** No published field was silently fabricated; the manifest
still fully satisfies D-18's liveness requirement and every acceptance
criterion the plan actually tests. A future plan touching the corpus schema
can add `name` additively.

## Known Stubs

None — every shipped export is real, tested code; nothing here is a
placeholder awaiting a later plan.

## Issues Encountered

- **Fixture-only bug, not a code bug:** the first draft of
  `stateSnapshot.test.ts`'s round-trip fixture gave every match's
  `redScore`/`blueScore` an initial tied value (both `130` at the first
  match), which made `epa.ts`'s expanding-window `allianceScoreStats` fold
  its first observation pair as two identical values — zero variance —
  and the very next cold-start match's `margin / scale` degenerated to a
  real `0 / 0 = NaN`, correctly caught by `assertValidPRedWin`. Fixed by
  offsetting every match's scores so no match (including the first) is
  ever exactly tied — a fixture-construction fix, `epa.ts` itself is
  untouched. Confirmed the corpus's `buildSeasonStream` interleaves the two
  fixture events chronologically by `sort_time` (not "all of event A, then
  all of event B" as first assumed) while diagnosing this.

## User Setup Required

None — this plan touches no external services or credentials. `.env` was
never read.

## Next Phase Readiness

- `packages/harness/manifests.ts` and `packages/harness/stateSnapshot.ts`
  are both real, tested, importable modules — plan 04-04 (the cron Worker's
  poll-and-fold path) and plan 04-05 (cron Worker scaffold) can call
  `buildLiveWindowsManifest`/`buildAlgorithmsManifest` from the offline
  publish CLI and read the resulting manifests' JSON shape from the Worker
  side, and can seed/read `apps/worker/migrations/0001_algorithm_state.sql`'s
  tables via `serializeState`/`deserializeState`/`emitSeedSql`.
- Not yet built (explicitly out of this plan's scope): the publish CLI
  wiring that actually calls `buildLiveWindowsManifest`/
  `buildAlgorithmsManifest`/`emitSeedSql` and uploads/executes their output
  (R2 manifest upload, `wrangler d1 execute --file` invocation) — that is
  publish-pipeline integration work for a later plan in this phase.
- `emitSeedSql`'s `DEFAULT_MAX_STATEMENT_LENGTH` (4,000,000 chars) is a
  conservative guess against 04-RESEARCH.md's documented failure point, not
  independently measured against a live `wrangler d1 execute --file` run —
  worth confirming (or tightening) once a real seed is executed against
  production D1.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All five created files confirmed present on disk (`packages/harness/manifests.ts`,
`packages/harness/manifests.test.ts`, `packages/harness/stateSnapshot.ts`,
`packages/harness/stateSnapshot.test.ts`, `apps/worker/migrations/0001_algorithm_state.sql`).
All three task commits (`2afd5849`, `d64d1210`, `a346aa9f`) confirmed present
in `git log --oneline --all`.
