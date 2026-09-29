---
phase: 04-publish-live-update-pipeline
plan: 05
subsystem: infra
tags: [cloudflare-worker, d1, wrangler, subrequest-budget, ml-matrix, workers-types]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline (plan 04-03)
    provides: "apps/worker/migrations/0001_algorithm_state.sql (algorithm_state/
      event_cursor D1 tables) and packages/harness/stateSnapshot.ts's
      serializeState/deserializeState/StateRowSchema — this plan's stateStore.ts
      reads and writes exactly the row shape that serializer produces"
  - phase: 04-publish-live-update-pipeline (plan 04-01)
    provides: "apps/worker/package.json (wrangler + @cloudflare/workers-types
      installed), the sigmascout-artifacts R2 bucket, and
      packages/core/isomorphic.test.ts's Worker-importability guarantee for
      packages/core"
provides:
  - "apps/worker/wrangler.toml: sigmascout-worker, every-minute cron (D-17),
    DB/ARTIFACTS/MANIFEST bindings against real Cloudflare resources
    (sigmascout-state D1 database, MANIFEST KV namespace, sigmascout-artifacts
    R2 bucket), nodejs_compat flag, no secret assignment"
  - "apps/worker/src/env.ts: the typed Env binding surface (DB/ARTIFACTS/
    MANIFEST/TBA_API_KEY) every future Worker module reads off"
  - "apps/worker/src/bundleSmoke.ts: proves 04-RESEARCH.md Assumption A1 --
    ml-matrix (SVD via opr.ts, Cholesky via sigma1/rp/distribution.ts) bundles
    and EXECUTES inside the real Workers runtime, not just under Node/Vitest"
  - "apps/worker/src/stateStore.ts: readScopedState/writeScopedState (one D1
    statement/one batch() call regardless of scale), readAndDeserializeScopedState,
    selectChangedRows (write-volume dedup), readEventCursor/writeEventCursor,
    hasAlreadyFolded (D-15/D-19's idempotency anchor)"
  - "apps/worker/src/subrequestBudget.ts: SubrequestBudget (defers via
    tryConsume rather than throwing), rotate/sortEventKeys (D-15's
    no-starvation rotation over a deterministic total order)"
  - "apps/worker/tsconfig.json: a Worker-scoped TS project (types:
    [@cloudflare/workers-types, node]) isolated from the rest of the
    Node-based monorepo's root tsconfig"
affects: [04-06-worker-read-path, 04-07-live-measurement-and-tba-secret]

# Actuals (#2632)
actuals:
  tokens: 13200
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "apps/worker gets its OWN tsconfig.json (types: workers-types + node),
      not folded into the root program -- isolates the Worker's Cloudflare
      ambient globals from the rest of the Node-based monorepo rather than
      risking a global type collision by adding apps/** to the shared root
      tsconfig"
    - "A pure computation module (subrequestBudget.ts) never takes a
      D1Database/env parameter -- persistence of what it computes (the
      rotation offset) is explicitly the CALLER's job, documented in the
      module header rather than half-implemented here"
    - "writeScopedState is dumb-and-pure (writes exactly what it's given,
      batched); selectChangedRows is a separate, explicit filtering step a
      caller applies first -- keeps the D1 transaction-semantics module
      simple and the write-volume optimization independently testable"
    - "compatibility_flags = [\"nodejs_compat\"] verified necessary and
      sufficient by a REAL wrangler dev --local request, not inferred from
      documentation -- the same build-verification discipline
      bundleSmoke.ts uses for Assumption A1, applied to a second real
      bundling risk this plan discovered while wiring Task 2's own
      key_link"

key-files:
  created:
    - apps/worker/wrangler.toml
    - apps/worker/tsconfig.json
    - apps/worker/src/env.ts
    - apps/worker/src/bundleSmoke.ts
    - apps/worker/src/stateStore.ts
    - apps/worker/src/subrequestBudget.ts
    - apps/worker/test/stateStore.test.ts
    - apps/worker/test/subrequestBudget.test.ts
  modified:
    - apps/worker/package.json
    - vitest.config.ts
    - .gitignore

key-decisions:
  - "compatibility_flags = [\"nodejs_compat\"] added to wrangler.toml after
    discovering (via a real wrangler dev --local request against a probe
    Worker, not assumed) that packages/harness/stateSnapshot.ts's
    module-top-level node:fs/node:path imports (used only by its
    Node-only emitSeedSql export, never by the Worker) get pulled into the
    bundle graph the moment stateStore.ts imports deserializeState from the
    same file -- ESM imports are file-scoped, not export-scoped. It
    resolved and executed cleanly even before the flag was added (this
    compatibility_date apparently defaults it on already); the flag makes
    that explicit and future-proof rather than relying on an implicit
    platform default."
  - "apps/worker/tsconfig.json (new file, not in the plan's literal
    files_modified list) added under the wave_coordination note's blanket
    'everything under apps/worker/' grant -- without it, root pnpm
    typecheck silently never checked any apps/worker file at all (apps/**
    is not in root tsconfig.json's include array, and that array was left
    untouched since editing it risked a global ambient-type collision
    between @cloudflare/workers-types and the rest of the Node-based
    repo, and effectively required touching root package.json's typecheck
    script to matter, which is 04-04's file this wave). apps/worker's own
    program is verified directly via `tsc --noEmit -p apps/worker/tsconfig.json`
    (documented below, not run by the root `pnpm typecheck` command)."
  - "stateStore.ts exports readAndDeserializeScopedState in addition to the
    plan's literal export list -- a thin readScopedState + deserializeState
    composition, giving 04-06's scheduled.ts a ready-to-use in-memory
    algorithm state directly, and giving the required 'imports
    deserializeState' acceptance criterion a genuine call site rather than
    an unused import."
  - "selectChangedRows exported as its own function (not folded into
    writeScopedState) -- writeScopedState stays a simple 'write exactly
    what you're given, batched' primitive; the write-volume dedup
    (stateSnapshot.ts's stable serializer making an unchanged team
    byte-identical) is a separate, independently testable filtering step
    a caller applies first."
  - "subrequestBudget.ts takes no D1Database parameter anywhere -- the
    rotation offset's PERSISTENCE (D1's event_cursor, never KV per
    T-04-33) is documented in the module header as a decision for
    whichever plan wires this into the real scheduled() handler (04-06),
    not implemented here, since stateStore.ts is outside this task's
    declared file scope."

requirements-completed: []
# DATA-04/DATA-05 intentionally NOT marked complete in REQUIREMENTS.md,
# matching plan 04-01's and 04-03's own established precedent: both ids
# also appear in 04-06's and 04-07's frontmatter requirements lists. This
# plan ships the Worker skeleton + batched state store + subrequest budget
# -- the load-bearing infrastructure DATA-04/DATA-05 depend on -- but not
# the actual live-update read/fold/publish path (04-06) or the deployed,
# measured peak-tick subrequest count (04-07's backstop truth). See
# coverage: below for what THIS plan verifiably shipped toward each.

coverage:
  - id: D1
    description: "The Worker project exists, builds, and deploys against a
      real Cloudflare D1 database that actually HAS the algorithm_state and
      event_cursor tables -- proven by a live sqlite_master query against
      the remote database, not inferred from a green build (a green build
      passes whether or not the migration ran, since types come from the
      bindings config, not the live database)"
    requirement: DATA-05
    verification:
      - kind: manual_procedural
        ref: "wrangler d1 execute sigmascout-state --remote --command \"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\" -- returned algorithm_state and event_cursor (plus d1_migrations/_cf_KV/sqlite_sequence), see Accomplishments below for the full output"
        status: pass
    human_judgment: false
  - id: D2
    description: "04-RESEARCH.md Assumption A1 (ml-matrix bundles cleanly
      into a Workers build) is answered with evidence: bundleSmoke.ts
      imports and actually EXECUTES the real opr (SVD) and sigma1 RP
      distribution (Cholesky) code from packages/core inside the real
      Workers runtime under wrangler dev --local, returning HTTP 200 with
      finite predicted probabilities and a positive pmf length"
    requirement: DATA-05
    verification:
      - kind: manual_procedural
        ref: "curl http://127.0.0.1:8811/ against a real wrangler dev --local server -- HTTP 200, {\"ok\":true,\"opr\":{\"initialPredictedProbability\":0.5,\"predictedProbabilityAfterUpdate\":0.924...},\"rpDistribution\":{\"redPmfLength\":7,\"bluePmfLength\":7,\"redPmfSum\":1,\"bluePmfSum\":1}}"
        status: pass
    human_judgment: false
  - id: D3
    description: "Reading/writing algorithm state for an arbitrary number of
      teams costs exactly one D1 statement / one batch() call each,
      regardless of scale, and a failed batch write is unambiguously
      all-or-nothing -- never a partial application"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/stateStore.test.ts -- '1 prepare / 1 all() call at 21 keys', '1 batch() call at 21 rows', 'empty array -> 0 calls', 'rejecting batch surfaces as rejection with no rows applied'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Folding the same match twice is a genuine no-op: identical
      state_json the second pass, zero writes issued -- via
      hasAlreadyFolded's event-order idempotency anchor plus
      selectChangedRows' byte-identical-state dedup"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "apps/worker/test/stateStore.test.ts -- 'advancing an event twice... issues zero writes the second pass', hasAlreadyFolded's ordering/never-folded/absent-key tests"
        status: pass
    human_judgment: false
  - id: D5
    description: "The subrequest budget is enforced in code before the
      platform enforces it: at one below the usable budget the next unit
      succeeds, at the boundary it fails WITHOUT incrementing (deferred to
      the next tick), and the cap is never exceeded by an attempt-then-throw"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/subrequestBudget.test.ts -- boundary triple test, 'remaining never negative over 100 over-budget attempts'"
        status: pass
    human_judgment: false
  - id: D6
    description: "Under a per-tick cap that admits only some of a live event
      list, rotating the start offset by the number processed visits every
      event within ceil(n/k) ticks; a fixed (non-rotating) offset
      provably never reaches events past the cap -- the no-starvation
      property AND its counterfactual, both asserted"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "apps/worker/test/subrequestBudget.test.ts -- '40 events / 6-per-tick cap / visited within ceil(40/6)=7 ticks' and its pinned-offset-0 counterfactual"
        status: pass
    human_judgment: false
  - id: D7
    description: "Measured peak-tick subrequest count on the DEPLOYED Worker
      stays under the free plan's 50-per-invocation limit -- explicitly a
      backstop truth this plan does NOT claim; the code-side budget
      (D5/D6 above) is what this plan proves, the deployed measurement is
      04-07's job"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed Worker under replayed live-event load
      (04-07's scope, per this plan's own must_haves marking it
      'verification: backstop') -- not measurable from this plan's
      wrangler dev --local smoke test alone."

# Metrics
duration: ~30min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 5: Cron Worker Scaffold — D1 State Store & Subrequest Budget Summary

**A deployable sigmascout-worker with real D1 tables, a proven ml-matrix-in-Workers bundle, a two-subrequest-per-tick batched D1 state store, and a subrequest budget that defers instead of throwing.**

## Performance

- **Duration:** ~30 min (commit-timestamp span; first-to-last of the three task commits)
- **Tasks:** 3 (all executed)
- **Files modified:** 11 (8 created, 3 modified)

## Accomplishments

- **Task 1 — Worker skeleton + real D1 tables + proven bundle:**
  - Created the real Cloudflare resources this plan needed: D1 database
    `sigmascout-state` (id `8c1cee63-0567-4faa-ad74-a7721728a956`) and KV
    namespace `MANIFEST` (id `f051554d9d60407097959b92aca51109`).
  - Applied `apps/worker/migrations/0001_algorithm_state.sql` both `--local`
    and `--remote`, and confirmed the tables actually exist with a live
    query (not inferred from a green build):
    ```
    npx wrangler d1 execute sigmascout-state --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    -> _cf_KV, algorithm_state, d1_migrations, event_cursor, sqlite_sequence
    ```
  - Wrote `apps/worker/wrangler.toml`: `sigmascout-worker`, `main` temporarily
    pointing at `src/bundleSmoke.ts` (commented, plan 04-06 must switch it),
    `compatibility_date = "2026-08-22"`, `[triggers] crons = ["* * * * *"]`
    (D-17, every minute year-round), `DB`/`ARTIFACTS`/`MANIFEST` bindings, no
    secret value assigned anywhere in the file.
  - **Assumption A1 HELD, with evidence:** `apps/worker/src/bundleSmoke.ts`
    imports the real `opr` module (SVD via `ml-matrix`'s
    `SingularValueDecomposition`) and the real Sigma1 RP distribution module
    (Cholesky via `ml-matrix`'s `CholeskyDecomposition`) from `packages/core`,
    builds a tiny hand-built two-alliance fixture, and actually calls
    `opr.initState`/`opr.predict`/`opr.update` and `rpPmfForMatch`. A real
    `wrangler dev --local` request returned HTTP 200 with
    `{"ok":true,"opr":{"initialPredictedProbability":0.5,"predictedProbabilityAfterUpdate":0.9241418199787563,"redScoreAfterUpdate":120,"blueScoreAfterUpdate":95.00000000000001},"rpDistribution":{"redPmfLength":7,"bluePmfLength":7,"redPmfSum":1,"bluePmfSum":1}}`.
    `wrangler deploy --dry-run` reports **766.20 KiB / gzip 116.21 KiB** —
    comfortably under Workers' free-plan script-size limits.
  - Fixed the test-discovery gap: `vitest.config.ts`'s `include` now covers
    `apps/**/*.test.ts`. Added `test`/`typecheck`/`dev`/`deploy` scripts to
    `apps/worker/package.json`.
- **Task 2 — Batched D1 state store:** `apps/worker/src/stateStore.ts`
  exports `readScopedState`/`writeScopedState` (one D1 statement / one
  `batch()` call regardless of key/row count, proven at 21 keys/rows),
  `readAndDeserializeScopedState` (composes `readScopedState` with
  `packages/harness/stateSnapshot.ts`'s `deserializeState` — the SAME
  deserializer the offline pipeline's own losslessness tests already prove
  correct), `selectChangedRows` (drops a write for a byte-identical
  `state_json`, against D1's 100,000-rows-written/day free allowance),
  `readEventCursor`/`writeEventCursor` (full round-trip over
  `tba_etag`/`last_folded_match_key`/`last_polled_at`/`last_advanced_at`),
  and `hasAlreadyFolded` (D-15/D-19's idempotency anchor over the event's own
  match order, not a timestamp comparison). 13 tests against a hand-rolled
  fake `D1Database` (call-count + SQL-shape assertions).
- **Task 3 — Subrequest budget + no-starvation rotation:**
  `apps/worker/src/subrequestBudget.ts` exports `SubrequestBudget`
  (`SUBREQUEST_CAP = 50`, `SUBREQUEST_RESERVE = 4`; `tryConsume` returns
  `false` at the boundary rather than throwing — D-15's whole point;
  `consume` throws only for the tick's own fixed costs), `rotate` (a pure
  permutation starting at `offset % length`), and `sortEventKeys` (a
  deterministic total order, matching `packages/corpus/db.ts`'s
  `selectMatchesChronological` tie-breaking precedent). 14 tests, including
  a no-starvation property (40 events, 6-per-tick cap, every event visited
  within `ceil(40/6)=7` ticks) paired with its own counterfactual (a pinned
  offset of 0 never reaches events past index 6) — the test file itself
  records why rotation is required, not just that it works.

## Task Commits

1. **Task 1: A Worker that builds, binds, and provably runs the real prediction code — and a D1 database with tables in it** - `bd615eec` (feat)
2. **Task 2: A state store that costs two subrequests no matter how many teams a tick touches** - `d8d41577` (feat)
3. **Task 3: A subrequest budget that defers instead of throwing, and an order that cannot starve an event** - `62e21bf7` (feat)

## Files Created/Modified

- `apps/worker/wrangler.toml` - Worker config: cron trigger, D1/R2/KV bindings, `nodejs_compat` flag
- `apps/worker/tsconfig.json` - Worker-scoped TS project (`types: [@cloudflare/workers-types, node]`)
- `apps/worker/src/env.ts` - typed `Env` binding surface
- `apps/worker/src/bundleSmoke.ts` - temporary entry point proving Assumption A1
- `apps/worker/src/stateStore.ts` - batched D1 reads/writes, event cursor, idempotency
- `apps/worker/src/subrequestBudget.ts` - budget class, rotation, deterministic ordering
- `apps/worker/test/stateStore.test.ts` - 13 tests against a fake D1Database
- `apps/worker/test/subrequestBudget.test.ts` - 14 tests including no-starvation + counterfactual
- `apps/worker/package.json` - `test`/`typecheck`/`dev`/`deploy` scripts
- `vitest.config.ts` - `apps/**/*.test.ts` added to test discovery
- `.gitignore` - `apps/worker/.wrangler/` (local dev D1/KV/R2 emulation state)

## Decisions Made

See `key-decisions` in frontmatter for full detail. Summary: `nodejs_compat`
added to `wrangler.toml` after empirically discovering (via a real
`wrangler dev --local` request) that `stateStore.ts`'s required
`deserializeState` import pulls `stateSnapshot.ts`'s Node-only `node:fs`
import into the bundle graph; `apps/worker/tsconfig.json` created as a
Worker-scoped TS project rather than widening the shared root tsconfig;
`readAndDeserializeScopedState`/`selectChangedRows` added as explicit,
independently-testable compositions beyond the plan's literal export list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] `compatibility_flags = ["nodejs_compat"]` added to `wrangler.toml`**
- **Found during:** Task 2, wiring `stateStore.ts`'s required `deserializeState` import (the plan's own `key_links`)
- **Issue:** `packages/harness/stateSnapshot.ts` also exports `emitSeedSql`, an offline-only helper importing `node:fs`/`node:path` at module top level. Since ESM imports are file-scoped, that import line is pulled into the Worker's bundle graph the moment anything imports `deserializeState` from the same file — even though the Worker never calls `emitSeedSql`.
- **Fix:** Verified empirically (a real `wrangler dev --local` request against a throwaway probe Worker returned HTTP 200 before any flag was added — this compatibility_date apparently already defaults it) and then made it explicit/future-proof by adding `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml`, with the reasoning recorded inline.
- **Files modified:** `apps/worker/wrangler.toml`
- **Verification:** Re-ran the `wrangler dev --local` bundle smoke request after adding the flag — identical output, no regression; `wrangler deploy --dry-run` bundle size unchanged (766.20 KiB / gzip 116.21 KiB, since `bundleSmoke.ts` itself doesn't import `stateStore.ts`).
- **Committed in:** `d8d41577` (Task 2 commit)

**2. [Rule 2 — Missing critical functionality] `apps/worker/tsconfig.json` created (new file, not in the plan's literal `files_modified` list)**
- **Found during:** Task 1, immediately after writing `env.ts`
- **Issue:** Root `tsconfig.json`'s `include` array does not cover `apps/**`, so `pnpm typecheck` (the root, single-script command the plan's own `<verify>` blocks invoke) would silently never type-check any file this plan creates — a strict-TypeScript project (per CLAUDE.md) with an untyped Worker package is a real correctness gap, not a hypothetical one.
- **Fix:** Created `apps/worker/tsconfig.json` (`types: ["@cloudflare/workers-types", "node"]`, own `include`) as a project isolated from the shared root program — avoids risking a global ambient-type collision from adding `apps/**` directly to the root tsconfig, and avoids needing to touch root `package.json` (out of scope this wave, owned by plan 04-04) to wire a recursive `pnpm typecheck`. Authorized under `wave_coordination`'s explicit "everything under `apps/worker/`" grant.
- **Files modified:** `apps/worker/tsconfig.json` (new)
- **Verification:** `tsc --noEmit -p apps/worker/tsconfig.json` run directly after every task — clean throughout. **Known limitation, stated plainly:** root `pnpm typecheck` still does NOT recurse into `apps/worker` (root `tsconfig.json`/`package.json` both left untouched, per file-scope and wave boundaries) — a future plan (04-04 owns root `package.json` this wave) should wire a recursive typecheck script.
- **Committed in:** `bd615eec` (Task 1 commit)

**3. [Rule 3 — Blocking, out-of-scope file] `.gitignore` extended with `apps/worker/.wrangler/`**
- **Found during:** Task 1, after `wrangler dev`/`wrangler d1 migrations apply --local` generated local emulation state under `apps/worker/.wrangler/`
- **Issue:** This is machine-local, generated runtime state (D1/KV/R2 local emulation), not source of truth — leaving it untracked-but-not-ignored violates the standing "never leave generated files untracked" rule, and `.gitignore` is outside this plan's declared `files_modified`.
- **Fix:** Added a `.wrangler/` entry to the root `.gitignore` (a small, additive, cross-cutting hygiene change unclaimed by either wave partner's declared file list).
- **Files modified:** `.gitignore`
- **Verification:** `git status --short` confirmed `apps/worker/.wrangler/` no longer appears as untracked after the change.
- **Committed in:** `bd615eec` (Task 1 commit)

**4. [Rule 1 — Bug] Fixed null-byte corruption in `stateStore.ts`**
- **Found during:** Task 2, self-check after writing the file (`grep` reported "binary file matches" instead of a normal text match)
- **Issue:** The initial `Write` tool call for `stateStore.ts` produced two literal NUL bytes (`0x00`) in place of two intended plain-space characters inside `rowIdentity`'s template literal (`\`${row.algorithmId} ${row.scopeKind} ${row.scopeKey}\``) — a tool-transport artifact, not something present in the authored content. This made the file register as binary to `grep`/`git diff` and risked silently-broken map-key comparisons.
- **Fix:** Direct byte-level patch (`latin1`-safe split/join, verified this does not disturb the file's existing UTF-8 multi-byte characters such as em-dashes) replacing both NUL bytes with an explicit `::` separator string.
- **Files modified:** `apps/worker/src/stateStore.ts`
- **Verification:** Confirmed zero NUL bytes remain via a byte-scan; confirmed em-dash count unchanged (20, before and after); re-ran `stateStore.test.ts` (13/13 pass) and `tsc --noEmit -p apps/worker/tsconfig.json` (clean) after the fix.
- **Committed in:** `d8d41577` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (2 missing-critical-functionality, 1 blocking/out-of-scope, 1 bug)
**Impact on plan:** All four were necessary for correctness (a Worker bundle that actually loads, a Worker package that is actually type-checked, no untracked generated files, no binary corruption in committed source) or repo hygiene. No scope creep, no architectural changes, no unresolved deviations.

## Known Stubs

None — every shipped export is real, tested code. `bundleSmoke.ts` is
explicitly and deliberately temporary (documented in its own header and in
`wrangler.toml`'s `main` comment), not a stub: plan 04-06 replaces it with
`src/scheduled.ts`, the same "documented temporary artifact, not a silent
placeholder" pattern this project already uses elsewhere.

## Issues Encountered

- **Orphaned `wrangler dev` background processes across tool-call
  boundaries:** each `Bash` tool call runs in a fresh shell (per this
  environment's own stated behavior — cwd persists, shell state does not),
  so a `wrangler dev &` background job started in one call could not be
  `kill`ed by `%1` in a later call, leaving several orphaned `node.exe`
  processes bound to test ports. Resolved by finding the actual owning PIDs
  via `netstat -ano` and `taskkill`ing them directly, then switching to the
  `Bash` tool's `run_in_background` parameter (which persists correctly)
  for the final verification run. No code or config change resulted from
  this — pure tooling/environment friction.

## User Setup Required

None — Task 1's Cloudflare resource creation (D1 database, KV namespace,
migration apply) used the OAuth token already established by plan 04-01's
Task 1 human-resolved checkpoint (`npx wrangler whoami` confirmed
authenticated before any command ran, per this task's own `<precondition>`).
`.env` was never read; no live TBA credential was needed for this plan (the
TBA secret itself is plan 04-07's job, per `wrangler secret put`).

## Next Phase Readiness

- `apps/worker` is a real, deployable Worker package with real D1
  infrastructure behind it — plan 04-06 (the Worker read path / real
  `scheduled()` orchestration) can import `stateStore.ts`/
  `subrequestBudget.ts` directly and switch `wrangler.toml`'s `main` from
  `src/bundleSmoke.ts` to `src/scheduled.ts`.
- The rotation offset's PERSISTENCE (D1's `event_cursor`, a reserved key or
  dedicated one-row table — the concrete shape is left to whichever plan
  wires `rotate`/`SubrequestBudget` into the real tick) is explicitly NOT
  implemented here — `subrequestBudget.ts` is deliberately pure with no
  `D1Database` parameter. Plan 04-06 needs to pick and implement the
  concrete persistence shape.
- The measured peak-tick subrequest count on a DEPLOYED Worker (this plan's
  own `must_haves` backstop truth) is explicitly NOT claimed by this plan —
  04-07's job, once a real `scheduled()` handler and replay rig exist.
- Root `pnpm typecheck` does not yet recurse into `apps/worker` (see
  Deviation #2's known limitation) — worth wiring once root `package.json`
  is back in an unclaimed wave.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All eight created files confirmed present on disk (`apps/worker/wrangler.toml`,
`apps/worker/tsconfig.json`, `apps/worker/src/env.ts`,
`apps/worker/src/bundleSmoke.ts`, `apps/worker/src/stateStore.ts`,
`apps/worker/src/subrequestBudget.ts`, `apps/worker/test/stateStore.test.ts`,
`apps/worker/test/subrequestBudget.test.ts`). All four commits (`bd615eec`,
`d8d41577`, `62e21bf7`, `f613c6e9`) confirmed present in `git log --oneline --all`.
