---
phase: 10-district-points-ledger
plan: 05
subsystem: infra
tags: [cloudflare-workers, cron, tba-api, etag, r2, d1, district-points, zod, vitest]

requires:
  - phase: 10
    provides: "10-03's applyDistrictRankings / applyDistrictEventState / DistrictMergeError, DistrictEventStateSchema on both district row schemas, DistrictRankingsPayloadSchema, and LiveWindowEntrySchema.districtKey"
  - phase: 09
    provides: "packages/core/districts/locks.ts's verdict pipeline, reached only through 10-03's recomputeDistrictVerdicts"
  - phase: 04
    provides: "apps/worker's tick (scheduled.ts, tbaPoll.ts, artifactWriter.ts, stateStore.ts, liveWindows.ts, subrequestCounter.ts) and packages/harness/stateBaseline.ts's reserved-key contract"
provides:
  - "apps/worker/src/districtRefresh.ts — runDistrictRefresh (never throws), liveDistrictsOf, DISTRICT_KEY_PATTERN, DistrictRefreshResult: the live half of SC-1"
  - "apps/worker/src/districtEventState.ts — deriveMatchDerivedEventState / MatchDerivedEventState, the four match-derived state facts, pure"
  - "apps/worker/src/tbaPoll.ts — pollDistrictRankings, pollEventAwards, TbaConditionalBody, TbaDistrictRankingsPollError, TbaEventAwardsPollError"
  - "apps/worker/src/artifactWriter.ts — writeDistrictArtifactObject (returns serialized bytes) and DistrictArtifactSecretLeakError"
  - "packages/harness/stateBaseline.ts — DISTRICT_RANKINGS_KEY_PREFIX/districtRankingsCursorKey, EVENT_AWARDS_KEY_PREFIX/eventAwardsCursorKey, isReservedEventCursorKey widened to both"
  - "TickResult.districtsConsidered / districtsRefreshed / districtsUnchanged / districtsFailed — four required fields, so every return site carries them and the tick's one JSON log line reports them"
affects: [10-06, 10-07, 10-08, 10-09]

actuals:
  tokens: 27270
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A tick pass extracted into its own module with a NEVER-THROWS contract, because it is called upstream of writeTickMeta and an escaping throw would cost the tick its rotation offset"
    - "Write-or-skip by serialization comparison against a candidate built with the existing artifact's own stamp held constant — the clock is excluded from the content comparison"
    - "ETag cursors written LAST, only after the put that earns the right to stop asking"

key-files:
  created:
    - apps/worker/src/districtRefresh.ts
    - apps/worker/src/districtEventState.ts
    - apps/worker/test/scheduled.district.test.ts
    - apps/worker/test/districtEventState.test.ts
  modified:
    - apps/worker/src/scheduled.ts
    - apps/worker/src/tbaPoll.ts
    - apps/worker/src/artifactWriter.ts
    - packages/harness/stateBaseline.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/seedSql.test.ts
    - apps/worker/test/tbaPoll.test.ts
    - apps/worker/test/artifactWriter.test.ts

key-decisions:
  - "The district pass runs after runGlobalRebuild and before writeTickMeta, and is deliberately unreachable from both of runTick's earlier returns"
  - "A district's liveness is narrowed to the windows the tick ACTUALLY processed (foldable plus promoted), which excludes a probe window that never promoted"
  - "qualMatchesTotal is null, never 0, when no qm row exists — an unpublished schedule is unknown length, not a complete-but-empty event"
  - "awardsPosted is NOT a field of deriveMatchDerivedEventState: a match list cannot answer it, and a placeholder would be a guess"
  - "A published awardsPosted:true skips the awards request forever — awards do not un-post, so a monotone fact is asked once"
  - "An event key the artifact carries NO row for is dropped from the eventState map rather than handed to applyDistrictEventState, whose refusal exists to catch a genuine caller bug"
  - "writeDistrictArtifactObject keeps its own DistrictArtifactSecretLeakError rather than widening ArtifactSecretLeakError's PageKind parameter, which was narrowed back on purpose"

patterns-established:
  - "Two-sided reserved-key registration: a new event_cursor key shape is declared in packages/harness/stateBaseline.ts (one file, whole set) and proved by an emitCursorSeedSql refusal case in the same plan"
  - "Static import assertion with a non-vacuity check, inside the consuming test file, for a Worker module that must stay free of the corpus"

requirements-completed: [SC-1]

coverage:
  - id: D1
    description: "A live district whose member event's window carries its districtKey gets one conditional /district/{key}/rankings request per tick, and a 200 whose rankings moved republishes v1/district/{key}.json through applyDistrictRankings with the locks.ts verdicts recomputed"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#republishes the district artifact with recomputed verdicts after a changed rankings response"
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#writes the rankings ETag under the reserved cursor key, and sends If-None-Match only on the second tick"
        status: pass
      - kind: unit
        ref: "apps/worker/test/tbaPoll.test.ts#pollDistrictRankings / pollEventAwards (10-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The four per-event state facts are derived from the already-fetched match list, above the newlyFolded early return, with honest-null and false-by-default answers when the evidence is absent"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/districtEventState.test.ts#deriveMatchDerivedEventState"
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#records alliancesPicked even when the poll folded NO new match"
        status: pass
    human_judgment: false
  - id: D3
    description: "awardsPosted costs at most one conditional /event/{key}/awards request per live event per tick, only once playoffs are done, and none once it is published true"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#runTick — the awards fetch"
        status: pass
    human_judgment: false
  - id: D4
    description: "A tick in which nothing about a district moved writes nothing for it, and a 304 with no observation costs zero R2 reads"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#writes NOTHING when a 304 rankings poll meets a state observation equal to the published state"
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#performs ZERO v1/district/ R2 reads when a 304 rankings poll meets no observation at all"
        status: pass
    human_judgment: false
  - id: D5
    description: "One bad district costs one warn line and one failed count — never another district's refresh, never the rotation offset; a published district can be neither blanked nor invented"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#runDistrictRefresh — one bad district never stops the tick"
        status: pass
      - kind: unit
        ref: "apps/worker/test/artifactWriter.test.ts#writeDistrictArtifactObject"
        status: pass
    human_judgment: false
  - id: D6
    description: "A pre-phase-10 live-windows manifest makes the pass a no-op, and both new Worker modules are provably free of the corpus, better-sqlite3, node: built-ins and the rank simulation"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#runDistrictRefresh — the pre-republish manifest and the key guard"
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.district.test.ts#the two new Worker modules are provably free of the corpus and the simulation"
        status: pass
    human_judgment: false
  - id: D7
    description: "The two new reserved event_cursor key shapes are registered once and refused by emitCursorSeedSql, so a D1 seed cannot clobber a rankings or awards ETag"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "packages/harness/seedSql.test.ts#emitCursorSeedSql — reserved-key refusal"
        status: pass
    human_judgment: false
  - id: D8
    description: "The live district pass behaves correctly against the real TBA API and real R2 during an actual event weekend"
    verification: []
    human_judgment: true
    rationale: "Every test here mocks fetch, R2 and D1; executor subagents have no network and nothing in this plan deploys. Only a real live event weekend after 10-09's deploy and republish can confirm end-to-end behaviour against production."

duration: 25 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 05: The Live District Pass Summary

**The cron tick now learns which districts are live from the manifest it already reads, asks TBA what moved with one conditional request per district, and republishes the district artifact it reads back from R2 — with no corpus, no simulation, and no way to blank or invent a published district.**

## Performance

- **Duration:** 25 min
- **Tasks:** 3 (1 tracer, 2 TDD)
- **Files changed:** 12 (exactly the plan's `files_modified`, nothing else)
- **Commits:** 4

## Accomplishments

### Where the pass is called, and the two returns it cannot be reached from

`runDistrictRefresh` is called inside `runTick` **after the event loop and after `runGlobalRebuild`, and before `writeTickMeta`**. Placement facts, recorded at the call site:

- **After the event loop**, because Task 2's state facts are collected inside `processEvent` from the match list the loop already fetched.
- **Before `writeTickMeta`**, and `runDistrictRefresh` never throws, so a failing district can cost neither an event's fold nor the tick's rotation offset.
- **Deliberately unreachable from two earlier returns.** (1) The cheap-idle return, `foldableWindows.length === 0 && probeResult.promoted.size === 0`: a district's points cannot move while no member event has played a single match, which is CONTEXT's own rationale for deriving district liveness from member-event liveness. (2) The `stateGenerationMismatch` return: a mismatch suspends every live write until the seed lands, districts included. Both carry `...NO_DISTRICT_REFRESH` (four zeros), as does the `liveEvents.length === 0` return.
- **Deliberate narrowing.** CONTEXT says a district is live when "any member event has a live window"; the pass is handed `[...foldableWindows, ...promotedWindows]` — the windows the tick actually processed. A probe window that never promoted is excluded, because `runProbes`'s header calls the cheap-idle ordering load-bearing and spending a district's TBA request on an event with no proven match would spend against exactly that.

### The four state facts, and the honest answer when the evidence is absent

`deriveMatchDerivedEventState(matches)` in `apps/worker/src/districtEventState.ts` — pure, no I/O, no clock — derives exactly four fields:

| Fact | Rule | Absent-evidence answer |
|---|---|---|
| `qualMatchesPlayed` | count of `comp_level === "qm"` rows for which `isPlayed` (imported from `packages/ingest/normalize.ts`, never rewritten) is true | `0` — no row played is genuinely zero played |
| `qualMatchesTotal` | count of `qm` rows; playoff rows never inflate it | **`null`, never `0`** — TBA publishes the schedule as matches, so no `qm` row means unknown length; a `0` would render as a complete-but-empty event |
| `alliancesPicked` | some NON-qual row carries a non-empty `team_keys` on **both** alliances | `false`. A bracket row with an empty side is a placeholder, not a selection, and does not flip it |
| `playoffsDone` | at least one non-qual row exists **and** every non-qual row is played **and** some `f` row's `winning_alliance` is `"red"` or `"blue"` | `false`. A tied finals awaiting its replay is played-but-undecided; an event with no playoff rows has an **absent** playoff, not a completed one |

`awardsPosted` is deliberately **not** a fifth field of this module: a match list cannot answer it, and a placeholder would be a guess.

The derivation is placed in `processEvent` immediately after `tbaMatchListSchema.parse` and **above** the `newlyFolded.length === 0` early return, gated on `window.districtKey` being a non-empty string. The gate keeps every non-district event's behaviour byte-identical and keeps the derivation off the hot path. The placement is what makes "alliances were picked but no match was played" a recorded observation rather than a missed one — pinned by a test that asserts `eventsAdvanced === 0` and `alliancesPicked === true` in the same tick.

### The awards fetch, as a condition

`awardsPosted` for a live member event resolves in this order:

1. **The published state already says `true`** → no request, ever again. Awards do not un-post, so a monotone fact is asked once.
2. **Otherwise, the resolved `playoffsDone` is `true`** (this tick's observation, or the published state's when this tick's match poll returned 304) → one conditional `pollEventAwards` using the ETag read from the pass's single `readEventCursors` call. A 200 parsed through `tbaEventAwardsResponseSchema` with a non-null, non-empty array means `true`; an empty or null array means `false`; a **304 means `false`** — unchanged since the last time it was seen empty, because a non-empty result publishes `true` and never asks again.
3. **`playoffsDone` is `false`** → `awardsPosted` is `false` and **no request is made at all**.

Every composed five-field block is validated through `DistrictEventStateSchema` before it enters the map, so an impossible state (played exceeding a non-null total) fails there rather than inside the writer.

### RECORDED FRESHNESS LIMIT (for 10-08's runbook)

**A district's awards that post after every member event's live window has CLOSED are not picked up until the next offline republish.** A window is padded one hour past the last observed match (`LIVE_WINDOW_PAD_MS`, `packages/harness/manifestSchemas.ts`); an award ceremony later that night falls outside it, so the tick never asks. This is a consequence of the window definition, not a defect in the pass. It is stated in `apps/worker/src/districtRefresh.ts`'s module header and belongs in `docs/worker-operations.md`.

### The write-or-skip rule, and its asymmetry

The candidate is built with the **existing artifact's own `generation` and `computedAt` held constant** — `applyDistrictRankings` with the `eventState` map when the rankings poll was `"ok"`, `applyDistrictEventState` when it was `"not-modified"`. Then `JSON.stringify(candidate)` is compared with `JSON.stringify(existing)`. Equal means nothing moved: no put, `districtsUnchanged++`. Different means re-stamp with the tick's own `stamp` and write.

**The asymmetry, stated in the code:** a false "changed" costs one extra R2 write; a false "unchanged" is *impossible*, because both sides are outputs of the same `DistrictArtifactSchema.parse` and therefore share a key order, so equal serializations imply equal content.

Two further cost rules: the rankings poll comes **first**, before any R2 read, so a 304 with no member-event observation costs one conditional TBA request and **zero** R2 reads; and ETag cursors are written **last**, only after the put that earns the right to stop asking — caching an ETag before a put that then rejects would hand the next tick a 304 and leave the stale artifact in place forever.

### The failure modes injected, and what survived each

Two live districts, the first (`2026aaa`, sorted first) failing. Each of the five modes asserts: the second district (`2026pnw`) was still refreshed **with its own put**; `districtsFailed === 1` and `districtsRefreshed === 1`; `runTick` **resolved** rather than rejecting; and the tick-meta **rotation cursor was still written**.

| Failure mode | Injected as | Additional assertion |
|---|---|---|
| Rankings poll throws | a 500 from the TBA stub | — |
| Unparseable rankings body | a non-array payload failing `DistrictRankingsPayloadSchema` | — |
| Empty rankings array | `[]`, producing the real `DistrictMergeError` from 10-03 | **zero puts** for the failing district — a published district is never blanked |
| Missing district artifact in R2 | the artifact not seeded | zero puts, and a `district-artifact-missing` warn whose JSON keys are exactly `msg`, `districtKey`, `key` — the Worker never CREATES a district artifact |
| Rejected R2 put | the fake rejecting puts at that district's key | — |

Also pinned: no warn line in any of the five modes contains the configured TBA key value, `X-TBA-Auth-Key` or `If-None-Match`; a live window whose `districtKey` is **absent** and one whose `districtKey` is **null** each produce zero district TBA requests, zero `v1/district/` gets and zero puts (the pre-republish manifest, which is the state R2 is actually in between 10-09's deploy and its republish); a `districtKey` failing `DISTRICT_KEY_PATTERN` (`/^\d{4}[a-z0-9]+$/`) is skipped with a `district-key-rejected` warn, counted failed, and never reaches a URL.

### Provably free of the corpus

A static import scan inside `scheduled.district.test.ts` (using `browserSafeSchemas.test.ts`'s own `IMPORT_LINE_RE`) proves neither `districtRefresh.ts` nor `districtEventState.ts` has an import specifier matching `packages/corpus`, `better-sqlite3`, `node:` or `algorithms/simulation`, with a non-vacuity check that the scan read at least one import line in each file. The Worker never simulates and never calls `buildDistrictArtifact`.

## New tick counters and cursor keys (10-09 seeds and watches these)

**Four new `TickResult` fields**, all required (so `tsc` forces every return site to carry them) and all reported in the tick's one JSON log line:

- `districtsConsidered` — districts with at least one live member event this tick. **Zero against any manifest published before phase 10.**
- `districtsRefreshed` — districts whose artifact this tick republished.
- `districtsUnchanged` — one conditional TBA request and no write.
- `districtsFailed` — threw, was refused, or found no published artifact.

**Two new reserved `event_cursor` key shapes**, both holding an ETag in `tba_etag`, both registered in `packages/harness/stateBaseline.ts` and both covered by `isReservedEventCursorKey`:

- `__district_rankings__:{districtKey}` — via `districtRankingsCursorKey(districtKey)`
- `__event_awards__:{eventKey}` — via `eventAwardsCursorKey(eventKey)`

`emitCursorSeedSql` throws `ReservedEventCursorKeyError` for either shape, proved by two new cases in `packages/harness/seedSql.test.ts`. **No D1 seed step is owed before 10-09's deploy:** these rows are written by the tick itself and are meant to be absent until it runs. Nothing in this plan changes the seed's contents, the migration, or `algorithm_state`.

**New log lines an operator can filter on:** `district-refreshed` (`districtKey`, `bytes`, `teams`), `district-refresh-failed` (`districtKey`, `error`), `district-artifact-missing` (`districtKey`, `key`), `district-key-rejected` (`districtKey`).

## Per-tick cost, per live district

One D1 read for the whole pass (one `readEventCursors` over every rankings key and every live member event's awards key, one subrequest regardless of count); then per district: one conditional TBA rankings request, at most one R2 get, at most one R2 put, at most one conditional TBA awards request per live member event whose playoffs just finished and whose awards are not already published, and one D1 cursor write per changed ETag. Everything is counted on the tick's `SubrequestCounter` before the call, so `subrequestsUsed` stays an exact witness.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ReturnType<typeof vi.spyOn>` left `mock.calls` implicitly `any[]`**
- **Found during:** Task 3, at the plan-level verification step
- **Issue:** `npx tsc --noEmit -p apps/worker/tsconfig.json` reported `TS7006: Parameter 'call' implicitly has an 'any' type` in `scheduled.district.test.ts`. The **root** `tsc --noEmit` reported clean over it — the same class of gap the project memory records as "root tsc misses apps/web", here missing an `apps/worker` test file.
- **Fix:** Introduced a narrow local `WarnSpy` interface (`{ mock: { calls: readonly (readonly unknown[])[] } }`) exposing only the shape the assertions read.
- **Files modified:** `apps/worker/test/scheduled.district.test.ts`
- **Verification:** all three tsconfigs clean; the file's 30 tests still pass.
- **Commit:** `ecad4581`

**2. [Rule 2 - Missing critical] A second `pageArtifacts.ts` comment this plan also made false**
- **Found during:** Task 3
- **Issue:** The plan named one stale clause to fix (the `PageKind` bypass's "neither live-written by the Worker ... nor part of a per-season replay"). While editing that section, a second doc comment in the same districts block — the schema-version note's "District artifacts are refreshed only by an offline, infrequent manual publish ..., so that window is narrow" — was found to be made false by exactly the same change. Leaving it is precisely the failure the project's own log names (a README describing a deleted model).
- **Fix:** Rewrote that sentence to state the true reason the `max-age=60` staleness risk stays accepted (the window is bounded by the object's own `max-age`, regardless of how often it is rewritten) and to name `districtRefresh.ts` and the change that made the old wording false.
- **Files modified:** `packages/harness/pageArtifacts.ts` (comment lines only)
- **Verification:** `git diff packages/harness/pageArtifacts.ts` shows comment lines only; `PAGE_ARTIFACT_SCHEMA_VERSION` grep still returns 1; `npx vitest run packages/harness` green.
- **Commit:** `862baada`

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical). **Impact:** none on behaviour — one test-file type annotation and one comment correction. No production code path changed by either.

### Notes on the TDD cycles

Task 2's pure-derivation tests were genuinely RED (module absent), then GREEN. Task 2's eight tick-driven tests were RED (8 failed / 6 passed on the first run), then GREEN. **Task 3's isolation tests passed on their first run**: the per-district `try`/`catch` boundary and the `DISTRICT_KEY_PATTERN` skip were already built into Task 1's pass, so no hardening was needed. The plan's instruction ("if any case passes only because of where a `try` happens to sit, move the boundary rather than the test") was checked by reading the pass end to end — every per-district step (pattern check, poll, parse, read, merge, write, cursor write) is inside that district's own `try`, and the only pass-level work before the loop is `liveDistrictsOf` (pure) and one `readEventCursors` call.

## Issues Encountered

None.

## Authentication Gates

None — nothing in this plan touches the network. Every TBA, R2 and D1 call in every test goes through an injected fake.

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run apps/worker` | 21 files, 326 tests, green |
| `npx vitest run packages/harness` | 45 files, 1145 tests, green |
| `npx vitest run` (repo root) | **268 files, 6023 passed, 1 skipped** — no flake this run |
| `npx tsc --noEmit` | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `npx tsc --noEmit -p apps/worker/tsconfig.json` | clean |
| `git diff --name-only` since `bfeb2fe0` | exactly the 12 files in `files_modified` |

**Nothing moved that must not move:**

- `grep -c "^export const PAGE_ARTIFACT_SCHEMA_VERSION = 1;" packages/harness/pageArtifacts.ts` → **1**, unchanged.
- `grep -c "^export const MANIFEST_SCHEMA_VERSION = 1;" packages/harness/manifestSchemas.ts` → **1**, unchanged.
- **`apps/worker/wrangler.toml` is unmodified** — this plan adds no binding, no var and no trigger, so 10-09's `npx wrangler deploy` needs no config change.
- `ArtifactSecretLeakError`'s constructor parameter is still typed `PageKind` (`grep -c "class ArtifactSecretLeakError extends Error"` → 1); `PageKind`, `SCHEMA_BY_PAGE` and every schema are untouched.
- Every pre-existing Worker test file is untouched apart from `tbaPoll.test.ts` and `artifactWriter.test.ts`, both additive — no fixture was edited, because a manifest carrying no `districtKey` makes the pass a no-op.

## Known Stubs

None.

## Threat Flags

None. Every threat in the plan's register is mitigated and pinned by a committed test: T-10-05-01 (the writer's secret refusal), T-10-05-02 (warn-line contents), T-10-05-03 (schema validation at every boundary), T-10-05-04 (never blanked, never invented), T-10-05-05 (key-pattern validation before URL or R2 key), T-10-05-06 (the pass cannot starve the tick), T-10-05-07 (four typed counts), T-10-05-08 (both new reserved keys refused by the seed emitter). T-10-05-SC is `accept`: this plan installs no package.

## Handoffs

- **10-06 (publisher):** derives the same five `DistrictEventState` fields from the corpus instead of from a match list. `deriveMatchDerivedEventState`'s module header is the statement of what each fact means and what its absent-evidence answer is; the two producers must agree on it. 10-06 also owns the `DISTRICT_DETAIL_MAX_BYTES` ceiling assertion — `writeDistrictArtifactObject` deliberately returns bytes and asserts no ceiling, because `publishBudget.ts` imports `node:path` and pulling it into the Worker's bundle graph is the accident `wrangler.toml`'s `nodejs_compat` comment records.
- **10-07 (web):** reads the `state` block this pass writes to decide grey versus blue, and polls the district artifact on the 60 s floor these writes feed (the put carries `public, max-age=60`).
- **10-08 (docs):** `docs/worker-operations.md` gains the district pass in its tick description, the four new counters and the four new log lines in its "Watching it" section, and **the recorded freshness limit above**.
- **10-09 (operator):** no new binding, var or trigger, so `npx wrangler deploy` needs no config change, and **no D1 seed pass is owed** — the two new cursor rows are written by the tick itself. The deploy must still precede the republish, because the newly deployed Worker reads the pre-republish artifact and manifest at least once (every field 10-03 added is optional for exactly that reason). After the deploy, watch `districtsConsidered` — it stays 0 until the republish ships a manifest carrying `districtKey`, which is the correct answer for a manifest that carries no district information.

## Next Phase Readiness

Ready for 10-06.

## Self-Check: PASSED

- `apps/worker/src/districtRefresh.ts` — FOUND
- `apps/worker/src/districtEventState.ts` — FOUND
- `apps/worker/test/scheduled.district.test.ts` — FOUND
- `apps/worker/test/districtEventState.test.ts` — FOUND
- Commits `e26517f5`, `f1f4dd24`, `862baada`, `ecad4581` — all present in `git log`
- All task `<acceptance_criteria>` re-run and passing; all plan-level `<verification>` steps re-run and recorded above.
