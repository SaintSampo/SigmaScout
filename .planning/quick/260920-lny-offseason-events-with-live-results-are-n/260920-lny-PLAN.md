---
quick_id: 260920-lny
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: false
requirements: [D-01-probe-discovery, D-02-outage-guard, D-03-bounded-probes]
files_modified:
  - packages/harness/manifests.ts
  - packages/harness/manifestSchemas.ts
  - packages/harness/manifests.test.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/scheduled.test.ts
  - docs/worker-operations.md
estimate:
  tokens: 120000
  raw_tokens: 80000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "A tick whose only live windows are probe windows loads no algorithms manifest, builds no algorithm modules, issues no D1 batch and writes no R2 object (outage cause B, pinned by test)."
    - "A zero-match event whose calendar window is open gets exactly one probe entry in the live-windows manifest; an event with matches is unchanged."
    - "A probe that sees a non-empty match list promotes that event onto the existing live path in the same tick, with no second TBA request and no double-counted subrequest."
    - "Probes per tick are bounded and rotated, so an offseason weekend cannot spend the subrequest budget on discovery."
  artifacts:
    - packages/harness/manifests.ts
    - apps/worker/src/scheduled.ts
    - docs/worker-operations.md
  key_links:
    - "`inferred: true` in the published manifest means PROBE-ONLY in the Worker — the one marker both sides read."
    - "The probe's own poll result is handed to `processEvent` as its preflight, so promotion costs nothing extra."
---

# 260920-lny: offseason events with live results are not picked up

## The rule

An event whose TBA match schedule only appears once it starts must still be picked up live, with no
manual ingest plus republish. Chezy Champs 2026 (`2026cc`, type 99) published 86 real matches whose
first `sort_time` was two minutes *after* the last manifest publish; the corpus had zero matches for
it at build time, so it got no window, so the tick never looked at it. Forty more 2026 offseason
events are queued to fail the same way.

Discovery mechanism is LOCKED (`260920-lny-CONTEXT.md`, Jacob 2026-09-20): a cheap Worker probe. The
offline builder publishes a calendar window for a zero-match event, marked probe-only. On a probe
window the tick makes ONE ETag-conditional TBA matches request and exits. It enters the full live
path only once matches exist.

## Verified in the code before writing these tasks

The constraint was to establish, before scoping, whether the Worker can fold an event that has no
offline-published per-event artifact and no state block. It can, degraded. Five findings, each read
out of the source rather than assumed:

1. **A missing artifact is already a supported case.** `readExistingEvent`
   (`apps/worker/src/scheduled.ts:412`) returns `{ artifact: undefined }` for an absent R2 object, and
   `mergeEventArtifact` (`apps/worker/src/artifactMerge.ts:348`) "Bootstraps a schema-valid (but
   degraded ...) artifact when `existing` is `undefined`". A touched team with no published row is
   appended in a bootstrap shape (`artifactMerge.ts:445`).
2. **The bootstrap passes the write-side schema.** `EventArtifactSchema`
   (`packages/harness/pageArtifacts.ts:1633`) declares `name`, `startDate`, `location` and `week` as
   `.optional()`, so a body with none of them survives `writeArtifactObject`'s `schema.parse`. There
   is no permanent-failure trap here.
3. **D1 state cold-starts cleanly.** `loadOrInitState` (`scheduled.ts:295`) falls back to
   `algorithm.initState(...)` only when no league row exists, and `readScopedState`
   (`apps/worker/src/stateStore.ts:95`) always ORs in `scope_kind = 'league'` for that algorithm. A
   seeded season resumes normally; teams that played the 2026 season already carry rows.
4. **The gap is the `state` block, and it is a degradation, not a failure.** `maintainedStateBlock`
   (`artifactMerge.ts:226`) returns nothing when the existing artifact has none and logs
   `event-state-block-missing`; `docs/worker-operations.md` states the Worker never bootstraps a block
   from D1. So a never-published event will show played matches with predictions, and its UPCOMING
   matches will be unpriced in the browser until an offline republish seeds a block. Its
   `name`/`startDate`/`week` stay absent, its `teams` rows carry `nickname: ""` and no TBA rank or
   record, and the events LIST artifact is offline-only (`writeArtifactWithBootstrapRetry`'s own note:
   only `"event"` reaches it), so the event is reachable by URL but not by browsing.
5. **`end_date` does not exist to lean on.** `packages/corpus/schema.sql`'s `events` table has
   `start_date` only, and TBA's `end_date` is not ingested anywhere. Adding it is a schema migration
   plus an `--events-only` refetch plus a republish — out of scope for a task with no network. The
   probe window therefore uses a fixed span.

**Scope decision from that.** Ship the probe and the promotion seam, both provably safe and testable
offline. Do NOT try to close the cold-start display gaps in this task; item 4 is named in the summary
as the remaining follow-up, and the operational answer stays "republish to get a state block and a
list row", exactly as `docs/worker-operations.md` already prescribes.

## The design

**Marker: reuse `inferred`.** `LiveWindowEntrySchema` already carries it, so no schema version bump
and no shape change for manifests already in the wild. Its meaning becomes a contract rather than a
note: `inferred: true` is PROBE-ONLY, and the Worker must prove matches exist before the full live
path. This is retro-safe — the outage-era manifests carrying 200 `inferred: true` entries would now
land on the cheap path, which is strictly safer than what they did in August 2026.

**Window span.** `[start_date 00:00 UTC − 12 h, start_date 00:00 UTC + 4 days)`. The 4 days matches
the historical constant and covers a championship; the 12 h lead covers an event whose local morning
start falls on the previous UTC day (UTC+11 at 08:00 local is 21:00 Z the day before). Rule 2 of the
builder (drop a window already closed at build time) applies unchanged, which is what keeps historical
zero-match events out of the artifact.

**Where the cheap exit goes.** `runTick` currently pays three things after `liveEvents.length !== 0`
and before any event work: the algorithms manifest read, `buildAlgorithmModules`, and the tick-meta
read. That is the expensive prefix cause B triggered. The probe pass runs BEFORE all three, and a tick
with no foldable window and no promotion returns without reaching any of them.

**Promotion costs nothing extra.** `processEvent`'s first two calls are exactly the probe's two calls
(cursor read, conditional poll). Extract them as `eventPreflight`, let the probe own them, and hand the
result to `processEvent` as an optional preflight. A promoted event therefore issues ONE TBA request
per tick, not two, and the subrequest accounting stays exact.

**Bounded.** Probes are rotated by a clock-derived offset (`floor(nowMs / 60_000)`, one step per cron
minute) and capped. The rotation offset is deliberately NOT `meta.rotationOffset`: reading tick meta
costs a D1 round trip the probe-only path exists to avoid, and a clock offset is deterministic under
`deps.nowMs` in tests.

## Tasks

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: the offline builder publishes a calendar probe window for a zero-match event</name>
  <files>packages/harness/manifests.ts, packages/harness/manifestSchemas.ts, packages/harness/manifests.test.ts</files>
  <behavior>
    - A zero-match event whose calendar window is still open yields exactly one entry, `inferred: true`,
      `startMs` = midnight UTC of `start_date` minus the lead, `endMs` = that midnight plus the span.
    - Regression fixture named for the failure: an event with `start_date` 2026-09-19 and zero matches
      is live at 2026-09-19T16:50:31Z, the first `2026cc` match time.
    - A zero-match event whose probe window already closed at build time is dropped — retention rule 2
      applies to probe entries exactly as to measured ones.
    - An event WITH matches is unchanged: one `inferred: false` entry derived from its own `sort_time`
      span and `LIVE_WINDOW_PAD_MS`. No probe entry is added alongside it.
    - An event whose `start_date` does not parse yields no entry at all rather than a NaN interval
      (`loadLiveEventsAt` would otherwise refuse the whole manifest with `LiveWindowShapeError`).
  </behavior>
  <action>
    Write the failing cases into `packages/harness/manifests.test.ts` first, in a new describe block
    beside the existing retention block, then implement.

    In `packages/harness/manifests.ts`: add `PROBE_WINDOW_LEAD_MS` (12 h) and `PROBE_WINDOW_SPAN_MS`
    (4 days) as named exported constants. Add `e.start_date AS start_date` to the existing
    `EventWindowRow` query and interface. In the zero-match branch that currently `continue`s, derive
    midnight UTC from the `YYYY-MM-DD` `start_date` with `Date.parse`, skip the row when the parse is
    not finite, and push `{ eventKey, season, startMs: midnight - PROBE_WINDOW_LEAD_MS, endMs: midnight
    + PROBE_WINDOW_SPAN_MS, inferred: true }`. Leave the measured branch, `LIVE_WINDOW_PAD_MS` and
    retention rule 2 untouched — rule 2 must run over probe entries too, so place the emit above the
    existing `endMs <= nowMs` check or repeat the check for this branch.

    Rewrite the `buildLiveWindowsManifest` header. Its current rule 1 asserts that TBA publishes match
    schedules well before an event runs; that premise is false for offseason play and this task is why.
    Replace it with the corrected rule, in this repo's dense WHY voice, citing quick task 260920-lny and
    `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md` cause B: a calendar entry is published
    again, but it is marked probe-only and the Worker answers liveness with one conditional TBA request
    before it will do anything expensive, so the condition that killed the isolate in August 2026 cannot
    recur. Keep rule 2's text as it stands.

    In `packages/harness/manifestSchemas.ts`, extend the `inferred` field's doc comment on
    `LiveWindowEntrySchema` to state the contract both sides now read: a `true` entry is probe-only and
    a reader must prove matches exist before entering the live path. Field type and
    `MANIFEST_SCHEMA_VERSION` are unchanged.

    Do not filter probe entries by `event_type`. Preseason Week 0 events still render predicted pages;
    the predict-versus-fold asymmetry belongs to `foldsIntoRatings`
    (`packages/core/algorithms/eventTypes.ts`) and must not be duplicated into discovery.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/manifests.test.ts</automated>
  </verify>
  <done>New probe cases pass, every pre-existing case in that file still passes, and the header no longer asserts that TBA publishes schedules ahead of an event.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: the tick probes a probe window and only promotes once matches exist</name>
  <files>apps/worker/src/scheduled.ts, apps/worker/test/scheduled.test.ts</files>
  <behavior>
    - OUTAGE GUARD, written first: a tick whose only live window is a probe window, with TBA returning
      304, records zero `d1-batch` and zero `r2-put` entries in the shared log, never reads
      `ALGORITHMS_MANIFEST_KEY`, and never calls the injected `buildAlgorithmModules`. Same assertions
      for TBA returning an empty match array.
    - Reported as probed, not considered: `eventsConsidered` stays 0 and `eventsProbed` is 1.
    - Promotion: the same probe window with TBA returning one played match takes the normal live path —
      state written, exactly one artifact put — and `tbaRequests` is 1 for that event, proving the poll
      was not repeated.
    - A tick with one foldable window and one probe window still folds the foldable event.
    - Bound: with more open probe windows than the cap, one tick probes at most the cap, and two ticks
      one cron minute apart cover a different (rotated) slice.
  </behavior>
  <action>
    Add the tests to `apps/worker/test/scheduled.test.ts`, which already owns the D1/R2/KV fakes, the
    `sharedLog` with `d1-batch` and `r2-put` entries, and the `buildAlgorithmModules` injection point.
    Its `liveWindowsManifest` helper hardcodes `inferred: false` on every window — widen it to pass a
    supplied `inferred` through, defaulting to `false` so existing call sites are untouched. Write the
    guard cases red before implementing.

    In `apps/worker/src/scheduled.ts`:

    Extract the two preflight calls at the top of `processEvent` (the `readEventCursor` and the
    `pollEventMatches`, with their `budget.tryConsume` guards) into `eventPreflight(env, budget, tbaCtx,
    eventKey)` returning the cursor and poll result, or a deferral. Give `processEvent` an optional
    trailing preflight parameter: when supplied it consumes no budget and skips both calls, because the
    probe already paid for them.

    Add `MAX_PROBES_PER_TICK` (6), `PROBE_SUBREQUEST_COST` (2, the cursor read plus the conditional
    poll) and `PROBE_ROTATION_PERIOD_MS` (60000, one cron minute) as named exported constants, each
    with a comment giving the arithmetic: at the cap a probe-only tick spends 1 + 2 x 6 = 13 of the
    ~41 usable subrequests, and nine concurrently-open offseason windows are fully covered in two ticks.

    Add `runProbes`, called from `runTick` immediately after the `liveEvents.length === 0` early exit
    and BEFORE `loadAlgorithmsManifest`, `buildAlgorithmModules` and `readTickMeta`. It takes the
    entries whose `inferred` is true, orders them with the existing `rotate(sortEventKeys(...),
    Math.floor(nowMs / PROBE_ROTATION_PERIOD_MS))`, takes at most the cap, and for each calls
    `eventPreflight`. A `not-modified` result ends that probe. An `ok` result whose raw match array is
    empty writes the cursor's ETag back when it changed and the budget allows, then ends that probe —
    read `.length` off the raw array and do not run `tbaMatchListSchema` here, so an idle probe parses
    nothing. An `ok` result with a non-empty array promotes: keep the window and its preflight. A throw
    is confined to that probe, warned as a JSON line carrying the event key and message only (never a
    key, never a header, per this repo's standing log rule), and counted as failed.

    Split `liveEvents` into foldable entries and probe entries. When no foldable entry is live and
    nothing was promoted, return immediately after the probe pass with the counts. Otherwise proceed
    exactly as today, with `orderedEventKeys` built from the foldable keys plus the promoted keys, and
    each promoted event's preflight passed through to `processEvent`.

    Add `eventsProbed` and `eventsPromoted` to `TickResult` so the tail line distinguishes a healthy
    discovery tick from a stalled one; a throwing probe is counted in the existing `eventsFailed` and
    the field comment should say so. Update the `TICK_FIXED_SUBREQUEST_COST` comment to note that a
    probe-only tick never pays the algorithms-manifest or tick-meta reads that constant describes.

    Comment the guard where it lives: the probe pass sits above the algorithms manifest read
    deliberately, and moving it below would restore exactly the condition
    `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md` cause B describes. Leave
    `loadLiveEventsAt`'s prefilter and the `liveEvents.length === 0` early exit alone.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/scheduled.test.ts</automated>
  </verify>
  <done>The two guard cases and the promotion case pass, every pre-existing case in the file still passes, and the probe pass is positioned above the algorithms-manifest read in `runTick`.</done>
</task>

<task type="auto">
  <name>Task 3: correct the operator contract and run the full check</name>
  <files>docs/worker-operations.md</files>
  <action>
    Rewrite the section "Before an event: ingest it, or it will not live-fold". Its operative sentence
    — that the ingest plus republish cycle is sufficient because TBA publishes match schedules days
    before an event runs — is the same false premise as the builder header, and `2026cc` is the
    counter-example: 86 matches whose first `sort_time` was two minutes after the last manifest publish.

    Keep the outage history and the warning against a blind window; both are still true and are the
    reason the probe is shaped the way it is. State the new contract: a zero-match event gets a
    calendar probe window; the tick answers liveness for it with one conditional TBA request and stops;
    it enters the live path only once TBA actually returns matches. Give the per-tick cost (1 plus 2
    per probe, capped, rotated one step per cron minute) and the two new tail fields, `eventsProbed`
    and `eventsPromoted`, with the reading: probed above zero and promoted zero is a healthy idle
    weekend, promoted above zero is an event that has started.

    Say plainly what a probe does NOT fix, so nobody reads it as a substitute for publishing: an event
    that was never published offline has no SPR `state` block, so its upcoming matches cannot be priced
    in the browser (the existing `event-state-block-missing` bullet below already covers the symptom);
    it has no `name`, `startDate` or `week`; its `teams` rows carry no TBA rank or record; and it does
    not appear in the events list, which only the offline publish writes. Ingest plus republish stays
    the way to make an event a first-class page — the probe only makes results appear without it.
    Update the `eventsConsidered: 0` row of the troubleshooting table to point at `eventsProbed` first.

    Then run the full check below and fix anything it surfaces. Judge every command by its printed
    output, never by its exit code alone, and never run a vitest invocation through `timeout` or
    `pnpm`.
  </action>
  <verify>
    <automated>npx vitest run apps/worker packages/harness && npx tsc --noEmit && npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
  </verify>
  <done>The doc no longer claims schedules arrive ahead of an event, names the probe's cost and its limits, and both typechecks plus both test suites are green by their printed output.</done>
</task>

</tasks>

## Execution notes

- Worktrees are disabled: this runs on the main checkout. Another session may be working in it, so
  stage by explicit path and check `git status` after each commit (`git mv` and stray edits have
  silently absorbed foreign changes here before).
- One commit per task, in order. No published number changes in this task — it alters discovery and
  a manifest shape, nothing that feeds a prediction — so no algorithm version bumps, and the summary
  must say so explicitly.
- Never read, echo or interpolate `.env`. No task here needs a credential.
- The executor has no network. Do not attempt a publish, a deploy, a `wrangler tail` or a live fetch.

## Owed after execution (orchestrator / Jacob, from the main context)

1. **Republish** — `pnpm publish:seasons`. The probe windows only exist once
   `v1/manifest/live-windows.json` is rebuilt; nothing else writes it. Commit the budget doc the run
   rewrites. Verify the new manifest's window count and how many are live right now with the one-liner
   already in `docs/worker-operations.md`.
2. **Deploy the Worker** — `npx wrangler deploy` from a clean tree (`pnpm --filter worker deploy` hits
   pnpm's built-in and deploys nothing). Order matters: deploy the Worker BEFORE the republish, so the
   first manifest carrying probe entries is read by a Worker that knows what they mean. An old Worker
   reading a probe entry would treat it as foldable, which is cause B.
3. **Watch one tick** — `wrangler tail`, stopped by PID. Expect `eventsProbed` above zero, `eventsPromoted`
   zero and `ok:true` while nothing is running. Judge CPU within-run against a control arm, never as an
   absolute number.
4. **Decide on the CPU gate first.** `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` is
   open and says a realistic mid-event tick costs ~13 ms p50 / ~28 ms p90 in Phase A alone against a
   10 ms budget. This task does not change that path's cost, and it must not be read as closing that
   todo — but it does make the first real promotion arrive, and the live path has never been observed
   in production (`STATE.md` Session Continuity, 2026-09-19). Jacob decides whether to republish before
   or after that gate is addressed.
5. **Follow-up, not in scope here:** a promoted event that was never published offline renders degraded
   — no state block, so no upcoming-match pricing; no event name, week or list row. Record it as a
   named follow-up rather than discovering it during an event.
