---
quick_id: 260920-lny
phase: quick
plan: "01"
subsystem: worker
tags: [cloudflare-workers, d1, r2, tba-api, manifest, cron]
key-files:
  created: []
  modified:
    - packages/harness/manifests.ts
    - packages/harness/manifestSchemas.ts
    - packages/harness/manifests.test.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/scheduled.test.ts
    - docs/worker-operations.md
completed: 2026-09-20
status: complete
---

# 260920-lny: offseason events with live results are not picked up (Chezy Champs 2026)

**Code complete and tested. Nothing is live yet: the Worker deploy and the republish are owed,
in that order.**

## Root cause

The Worker only polls events that have a window in `v1/manifest/live-windows.json`. The offline
builder gave a window only to events whose matches were already in the corpus at publish time.
The live manifest (generation `0eca6b08`, built 2026-09-19T16:48:47Z) holds 0 windows. The first
`2026cc` match timestamp is 2026-09-19T16:50:31Z. TBA had no schedule for the event before it
began, so the pre-publish ingest found nothing, and nothing republishes automatically. The
builder's header assumed TBA posts schedules well before an event runs. That is false for
offseason play. All 40 remaining 2026 offseason events in the corpus hold 0 matches and would
have missed the same way.

## What changed

- `buildLiveWindowsManifest` emits a calendar PROBE window for a zero-match event:
  `[start_date 00:00 UTC - 12 h, + 4 days)`, marked `inferred: true`. The closed-window retention
  rule applies to probe entries unchanged. An unparseable `start_date` yields no entry. An event
  with matches is unchanged. The corpus has no end date and TBA's is not ingested, hence the
  fixed span.
- `inferred: true` is now a two-sided contract, documented on the schema: probe-only, never
  foldable on the window alone. No schema version bump.
- The tick gained `runProbes`, placed after the nothing-live early exit and BEFORE the
  algorithms-manifest read, `buildAlgorithmModules` and the tick-meta read. A probe costs one
  cursor read plus one ETag-conditional TBA request. A 304 or an empty match array ends the
  probe. A non-empty array promotes the event onto the normal live path in the same tick.
- `eventPreflight` was extracted from `processEvent`, so a promoted event reuses the probe's
  poll: one TBA request per tick, never two.
- Probes are capped at 6 per tick and rotated by `floor(nowMs / 60000)`, not by
  `meta.rotationOffset`, because reading tick meta is a D1 round trip the probe path exists to
  avoid. At the cap a probe-only tick spends 13 subrequests.
- `TickResult` gained `eventsProbed` and `eventsPromoted`.
- `docs/worker-operations.md`: the "Before an event" section describes the probe contract, its
  cost, the new tail fields, and what a probe does not fix.

## Outage guard

Outage cause B (`.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`) was two phantom
`inferred: true` windows keeping the tick on the ~38 ms live path. Two tests pin the guard: a
probe-only tick with TBA returning 304, and one returning `[]`, record zero D1 batches, zero R2
puts, no algorithms-manifest read and no `buildAlgorithmModules` call.

## No published number changes

Discovery and tick control flow only. No algorithm code, no tuned parameter, nothing that feeds a
prediction. No opr/epa/spr version bump.

## Commits

1. `92667bdb` feat: builder publishes a calendar probe window for zero-match events
2. `825e6bad` feat: the tick probes a probe window and only promotes once matches exist
3. `e60bc250` docs: correct the operator contract for zero-match event discovery

## Verification

- Executor: `npx vitest run apps/worker packages/harness`, 61 files, 1485 tests, all pass.
- Orchestrator rerun: `scheduled.test.ts`, `manifests.test.ts`, `liveWindows.test.ts`, 106 pass.
  Root `tsc --noEmit` and the worker tsconfig typecheck both print nothing.
- NOT verified: anything live. No probe tick has run on the platform, and probe cpuTime is
  unmeasured.

## Deviations

Three pre-existing tests in `manifests.test.ts` asserted the premise this task reverses (zero
matches yields no window, the builder never emits `inferred: true`). They were rewritten to the
new contract, with a comment pointing at the new probe block. No other pre-existing test changed.

## Owed after execution (main context or Jacob)

1. **Deploy the Worker FIRST.** `npx wrangler deploy` from a clean tree. The deployed Worker
   treats any `inferred: true` entry as foldable, which is cause B. It must be replaced before a
   manifest carrying probe entries exists.
2. **Then republish.** `pnpm publish:seasons`. Only this rebuilds the live-windows manifest.
   Commit the budget doc the run rewrites.
3. **Watch one tick.** `wrangler tail`, stopped by PID. Expect `eventsProbed` above zero,
   `eventsPromoted` zero, `ok:true`. Judge CPU within-run against a control arm.
4. **Decide on the CPU gate.** `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` is
   open (about 13 ms p50 Phase A against a 10 ms budget), and the live fold path has never been
   observed in production. This task does not change that cost. It does make the first real
   promotion arrive.
5. **Follow-up, out of scope.** An event promoted without ever being published offline renders
   degraded. `maintainedStateBlock` never bootstraps a state block, so upcoming matches stay
   unpriced. It has no name, week, TBA rank or record, and no events-list row. Folding itself
   works: `mergeEventArtifact` bootstraps a schema-valid artifact and D1 resumes from the league
   row.
6. **Known limit.** With more than 6 probe windows open, a running probe-window event is reached
   on a rotation, so its results can lag a tick or two. Ingest plus republish turns it into a
   measured window and removes the lag.
