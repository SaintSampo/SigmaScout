---
phase: quick-261019-ooj
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: ["quick-261019-ooj"]
files_modified:
  - apps/worker/src/scheduled.ts
  - apps/worker/src/tickLog.ts
  - apps/worker/test/scheduled.test.ts
  - apps/worker/test/scheduled.district.test.ts
  - apps/worker/src/tbaWebhook.ts
  - apps/worker/src/env.ts
  - apps/worker/wrangler.toml
  - apps/worker/test/tbaWebhook.test.ts
  - docs/worker-operations.md

estimate:
  tokens: 65000
  raw_tokens: 130000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A POST to /tba-webhook with a valid X-TBA-HMAC and message_type match_score, schedule_updated or alliance_selection answers 200 {\"accepted\":true} BEFORE the tick finishes, and runs runTick once with { onlyEventKeys: [event_key], trigger: \"webhook\" } inside ctx.waitUntil"
    - "A request with a missing or wrong X-TBA-HMAC answers 401 and runs no tick; no log line ever carries the request body, the X-TBA-HMAC value or the secret"
    - "With TBA_WEBHOOK_SECRET unset or empty the endpoint answers 503 and writes one tba-webhook-secret-missing warn line"
    - "verification logs its verification key and answers 200; ping answers 200; every other message type answers 200 and is ignored; none of them runs a tick"
    - "A one-event tick folds only the named event, drops the 24 hour recently-ended district watch, and never writes the tick meta row; a key with no live window costs one manifest read and zero TBA requests"
    - "The cron tick's behaviour and its msg:tick log line are unchanged (no trigger field on a cron line)"
    - "docs/worker-operations.md tells the operator, in order, how to set the secret, deploy, register the webhook, enter the verification key, subscribe to the firehose and watch it work, with the TBA API cache caveat and the 30 s waitUntil caveat stated plainly"
  artifacts:
    - path: "apps/worker/src/tbaWebhook.ts"
      provides: "TBA_WEBHOOK_PATH and handleTbaWebhook(request, env, ctx, deps)"
      exports: ["TBA_WEBHOOK_PATH", "handleTbaWebhook"]
    - path: "apps/worker/src/tickLog.ts"
      provides: "reportTick: the one msg:tick log line both the cron and the webhook path emit"
      exports: ["reportTick"]
    - path: "apps/worker/test/tbaWebhook.test.ts"
      provides: "Handler tests signed with node:crypto createHmac, independent of the handler's WebCrypto code"
    - path: "apps/worker/src/env.ts"
      provides: "readonly TBA_WEBHOOK_SECRET?: string"
      contains: "TBA_WEBHOOK_SECRET"
    - path: "apps/worker/wrangler.toml"
      provides: "workers_dev = true as a top-level key above [vars]"
      contains: "workers_dev = true"
  key_links:
    - from: "apps/worker/src/scheduled.ts default export"
      to: "handleTbaWebhook"
      via: "fetch(request, env, ctx) calls handleTbaWebhook(request, env, ctx, { runTick })"
      pattern: "handleTbaWebhook\\(request, env, ctx, \\{ runTick"
    - from: "apps/worker/src/tbaWebhook.ts"
      to: "runTick"
      via: "deps.runTick only; scheduled.ts is imported with import type, so there is no import cycle"
      pattern: "onlyEventKeys: \\[eventKey\\]"
    - from: "runTickCore"
      to: "tickWindows.live / tickWindows.recentlyEnded"
      via: "filtered to onlyEventKeys immediately after loadTickWindowsAt, before districtWatchWindows, the idle exit and any lease code"
      pattern: "onlyEventKeys"
    - from: "runTickCore tail"
      to: "writeTickMeta"
      via: "skipped when deps.onlyEventKeys is set"
      pattern: "writeTickMeta\\(env.DB"
---

<objective>
Push instead of poll. Add a Worker `fetch` handler at `/tba-webhook` that accepts TBA webhooks, checks the HMAC, answers 200 at once, and runs the existing tick for the one event the webhook names inside `ctx.waitUntil`. `runTick` learns to run for a named subset of live events without touching the cron's rotation offset.

Purpose: since 2026-10-18 the tick span median is 4 s, but TBA `post_result_time` to the page's `published_at` is median 122 s, p90 200 s. The cron polls once a minute and TBA serves `/matches` from a cache of up to 61 s, so polling cannot get under that. A webhook arrives when TBA has the change.

Output: `apps/worker/src/tbaWebhook.ts`, `apps/worker/src/tickLog.ts`, the `onlyEventKeys`/`trigger` deps on `runTick`, the `TBA_WEBHOOK_SECRET` binding, `workers_dev = true`, tests for both layers, and an operator runbook section. No deploy, no secret put, no push: the orchestrator does those.

The design is settled by the orchestrator (TBA protocol read from TBA's source: `webhook_request.py` and the notification classes). Do not reopen it. The task split (runTick seam, then handler, then docs) is fixed by the orchestrator, so this plan is not tracer-led; the end-to-end wiring is proven in Task 2 by a test that drives the real default export's `fetch`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/worker/src/env.ts
@apps/worker/wrangler.toml

Anchors (line numbers as of commit 1d182e74; quick task 261019-oim lands before this executes and will shift them, so grep for the names, not the numbers):
- `apps/worker/src/scheduled.ts`: `writeTickMeta` def line 276, `readTickState` line 249 (tick meta lives in `event_cursor` under `TICK_META_EVENT_KEY` = `"__scheduler_meta__"`, defined at `packages/harness/stateBaseline.ts:47`, with `{"rotationOffset":N}` in `last_folded_match_key`); `RunTickDeps` line 2291; `TickResult` line 2299; `runTick` line 2360; `runTickCore` line 2375; `loadTickWindowsAt` call and `liveEvents` line 2397-2398; `districtWatchWindows` line 2401; the idle exit `if (liveEvents.length === 0)` line 2458; `newMeta` + `subrequests.spend(1)` + `writeTickMeta` lines 2693-2697; the default export lines 2716-2745.
- `apps/worker/src/env.ts:21-22` (`TBA_API_KEY` doc comment style).
- `apps/worker/wrangler.toml`: `compatibility_flags` line 23, `[vars]` line 31.
- `apps/worker/test/scheduled.test.ts`: `FakeD1Database` line 83 (`eventCursors` map, rows `{event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at}`), `FakeR2Bucket` line 224, `makeEnv` line 262, `makeTbaFetchStub` line 345, `NOW_MS` line 390, `twoMatchEventRecord` line 398, `makeManifests` line 410, the compact two-event fixture in "constructs the algorithm modules exactly once per tick" line 746, the two-event fold test line 633.
- `apps/worker/test/scheduled.district.test.ts`: `NO_DISTRICT_WORK` line 1943; the describe "the two cadences, with nothing live and one district window that ended ten minutes ago" with its local `quietDistrict(clockMs)` helper and the "minute 12:05 with nothing changed" case line 1990 (proves a full tick at 12:05 makes a district request).
- `apps/worker/test/tbaPoll.test.ts:1-40` (style of a small handler-level test file, `makeEnv` with `as Env`).
- `docs/worker-operations.md`: "Deploying" line 23 (the Worker is already at `https://sigmascout-worker.jrw4561.workers.dev`, line 12), "Secrets" line 63, "Events are processed concurrently inside a tick (quick task 261018-3ju)" line 1490, "The ingest log" line 1522, "Watching it" line 1682, "When something is wrong" line 1744.

TBA webhook protocol (settled; implement exactly):
- POST, `Content-Type: application/json; charset=utf-8`, `X-TBA-Version: 1`, `X-TBA-HMAC` = lowercase hex HMAC-SHA256 (key = secret as UTF-8, message = the raw request body bytes as sent). `X-TBA-Checksum` is a deprecated SHA-1: ignore it.
- Body `{"message_type": "<type>", "message_data": {...}}`. Acted on: `match_score` (data has `event_key`, `match_key`, `event_name`, `match`, optional `team_key`), `schedule_updated` (`event_key`, `event_name`, optional `first_match_time`), `alliance_selection` (`event_key`, `event_name`, `event`, optional `team_key`). `verification` data `verification_key`. `ping` data `title`, `desc`. Other types (`upcoming_match`, `starting_comp_level`, `awards_posted`, `media_posted`, `district_points_updated`, `final_results`, `broadcast`, `match_video`, `event_match_video`) are ignored.
- TBA waits at most 10 s; a non-200 or a timeout can get the webhook deleted. Answer at once; do the work in `ctx.waitUntil`.
- Cloudflare (verified 2026-10-19 at developers.cloudflare.com/workers/runtime-apis/context/): `ctx.waitUntil()` extends execution for up to 30 s after the response is sent; promises not settled by then are cancelled and the runtime logs "waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled." The cron's `scheduled()` path does not have this 30 s cap.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: runTick runs for one named event (onlyEventKeys, trigger) and the tick log line becomes a shared helper</name>
  <files>apps/worker/src/scheduled.ts, apps/worker/src/tickLog.ts, apps/worker/test/scheduled.test.ts, apps/worker/test/scheduled.district.test.ts</files>
  <read_first>
    - apps/worker/src/scheduled.ts: grep -n for RunTickDeps, runTickCore, loadTickWindowsAt, districtWatchWindows, "liveEvents.length === 0", acquireEventLeases, eventsSkippedInFlight, newMeta, writeTickMeta, "export default". Read those regions only (the file is 2,745 lines).
    - The quick task 261019-oim lease code AS IT EXISTS NOW (git log --oneline -8; grep -n acquireEventLeases and eventsSkippedInFlight in apps/worker/src). Do not assume the line numbers in this plan. If the lease code is absent, proceed and say so in the summary.
    - apps/worker/test/scheduled.test.ts lines 83-130, 224-430, 633-655, 746-780.
    - apps/worker/test/scheduled.district.test.ts lines 1943-2010.
  </read_first>
  <behavior>
    - Two live windows 2026aaaa and 2026bbbb, both with a new played match; tick meta row pre-seeded with rotationOffset 1. runTick with onlyEventKeys ["2026aaaa"] and trigger "webhook": eventsAdvanced 1; the 2026aaaa cursor's last_folded_match_key is "2026aaaa_qm1"; no event_cursor key contains "2026bbbb"; no R2 put key contains "2026bbbb"; an event artifact put for 2026aaaa exists; no fetch URL contains "2026bbbb"; the "__scheduler_meta__" row deep-equals the seeded row.
    - Control in the same test: a following full tick (no onlyEventKeys, nowMs + 60 s) folds 2026bbbb and DOES rewrite the "__scheduler_meta__" row (its last_advanced_at changes), so the previous assertion has teeth.
    - Same two live windows, onlyEventKeys ["2026zzzz"]: fetch never called, r2.getCallCount 1, r2.putCallCount 0, result matches { eventsConsidered: 0, eventsAdvanced: 0, tbaRequests: 0, districtsConsidered: 0 }, and one console.log line parses to { msg: "webhook-event-not-live", eventKey: "2026zzzz", trigger: "webhook" }.
    - District file, inside the "two cadences" describe: quietDistrict(clockAt(12, 5)) then runTick(h.env, { nowMs: clockAt(12, 5), onlyEventKeys: [LIVE_EVENT], trigger: "webhook" }): zero TBA requests and NO_DISTRICT_WORK (the existing 12:05 case is the control proving a full tick asks the district).
    - reportTick with no extras: logs exactly one console.log JSON line whose keys are msg, ok, durationMs followed by the result's keys, with no trigger key, and resolves. reportTick on a rejected run: one console.error line { msg: "tick", ok: false, durationMs, error: message } and the returned promise rejects with the same error.
  </behavior>
  <action>
    In apps/worker/src/scheduled.ts:

    1. `RunTickDeps` (~line 2291) gains two optional readonly fields, each with a doc comment. `onlyEventKeys?: readonly string[]` restricts the tick to those events, for a webhook-triggered tick (quick task 261019-ooj). `trigger?: "cron" | "webhook"` (default "cron") says who started the tick. Branch only on `onlyEventKeys !== undefined`. `trigger` is recorded on the tick's own diagnostic lines and is never a switch.

    2. In `runTickCore`, immediately after `const tickWindows = await loadTickWindowsAt(...)` (~line 2397), derive the two lists every later line reads. When `deps.onlyEventKeys` is set, `liveEvents` is `tickWindows.live` filtered to a Set of those keys, and the recently-ended list is the empty array. Otherwise both are exactly what they are today. `districtWatchWindows` (~line 2401) must use the derived recently-ended list, so a one-event tick's district pass only sees the named event's own district. After this block, nothing in `runTickCore` may read `tickWindows.live` or `tickWindows.recentlyEnded` directly. The filter MUST sit above the `liveEvents.length === 0` idle exit and above the 261019-oim lease code (`acquireEventLeases`, which runs right after that exit), so the lease only ever sees the filtered windows. Do not change the lease code itself. For each key in `onlyEventKeys` with no window in `tickWindows.live`, write one `console.log(JSON.stringify({ msg: "webhook-event-not-live", eventKey, trigger }))`, where trigger is `deps.trigger ?? "cron"`. Such a tick then takes the existing idle return unchanged: one manifest read, zero TBA requests, because the recently-ended list is empty.

    3. At the tail of `runTickCore` (~lines 2693-2697), compute `newMeta`, call `subrequests.spend(1)` and call `writeTickMeta` ONLY when `deps.onlyEventKeys === undefined`. Add a comment: the rotation offset belongs to the cron, and a one-event tick would reset it to 0 because `orderedEventKeys.length` would be 1. Leave every other return path and every counter as it is. If 261019-oim added its own end-of-tick lease release, keep it for one-event ticks too.

    4. Create apps/worker/src/tickLog.ts with a header comment. It exports `reportTick(run: Promise<TickResult>, startedMs: number, extra: Readonly<Record<string, string>> = {}, now: () => number = Date.now): Promise<void>`, which is the `.then(onOk, onErr)` body that `scheduled()` has today (~lines 2723-2743), moved verbatim. On success: `console.log(JSON.stringify({ msg: "tick", ok: true, durationMs, ...extra, ...result }))`. On failure: `console.error(JSON.stringify({ msg: "tick", ok: false, durationMs, ...extra, error }))`, where error is the message or `String(error)`, then rethrow. It imports `TickResult` from ./scheduled.js with one single-line `import type` statement only, so it adds no value import cycle.

    5. Make `scheduled()` call `ctx.waitUntil(reportTick(runTick(env), startedMs))` with no extras, so the cron's tick line is byte-for-byte what it is today and carries no trigger field. Keep the default export's existing doc comment.

    Tests (write the behaviour cases first, run them red, then implement):
    - In apps/worker/test/scheduled.test.ts add a describe "runTick — one-event webhook tick (quick task 261019-ooj)" with the first two behaviour cases. Copy the two-window fixture from the test at ~line 633 (both events carry a new match, `twoMatchEventRecord`). Seed the meta row with `d1.eventCursors.set(TICK_META_EVENT_KEY, ...)`, where `TICK_META_EVENT_KEY` is imported from `../../../packages/harness/stateBaseline.js` (the same shape `writeTickMeta` writes: `last_folded_match_key` holding `JSON.stringify({ rotationOffset: 1 })` and a fixed `last_advanced_at`). Keep a structuredClone of it to compare against. For the not-live case, spy on console.log and find the line by parsing each call's first argument as JSON.
    - Add a describe "reportTick — the shared tick log line (quick task 261019-ooj)" with the two reportTick cases. Use a stub `TickResult`-shaped object; a cast is fine.
    - In apps/worker/test/scheduled.district.test.ts, add the district case INSIDE the existing "the two cadences, with nothing live and one district window that ended ten minutes ago" describe, so it reuses that describe's `quietDistrict`.
    - Do not change any existing test's expectations.
  </action>
  <verify>
    <automated>npx vitest run apps/worker</automated>
    <automated>npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>grep -n "tickWindows\.\(live\|recentlyEnded\)" apps/worker/src/scheduled.ts</automated>
    Expected: every hit printed by the grep is inside the derivation block directly after `loadTickWindowsAt`.
  </verify>
  <done>All apps/worker tests pass, including the four new cases and the reportTick pair. Both typechecks are clean, and every type error was triaged, not dismissed as pre-existing. A one-event tick folds only its event, never writes "__scheduler_meta__", and drops the recently-ended district watch. A not-live key costs one manifest read and zero TBA requests. The cron tick's log line is unchanged. Committed as one commit, staged by path: `feat(worker): run a tick for one named event, for TBA webhooks (quick 261019-ooj)`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: the /tba-webhook fetch handler, its binding, workers_dev, the default export, and its tests</name>
  <files>apps/worker/src/tbaWebhook.ts, apps/worker/src/env.ts, apps/worker/wrangler.toml, apps/worker/src/scheduled.ts, apps/worker/test/tbaWebhook.test.ts</files>
  <read_first>
    - apps/worker/src/tickLog.ts and the RunTickDeps / TickResult / default export regions of apps/worker/src/scheduled.ts (as left by Task 1)
    - apps/worker/src/env.ts (whole file, 53 lines)
    - apps/worker/wrangler.toml lines 1-35
    - apps/worker/test/tbaPoll.test.ts lines 1-40
  </read_first>
  <behavior>
    Sign helper in the test uses node:crypto createHmac("sha256", SECRET).update(body).digest("hex"), so the expectation is independent of the handler's WebCrypto code. SECRET is a dummy string such as "test-webhook-secret-not-real". The fake ExecutionContext collects the promises passed to waitUntil. The injected runTick is a vi.fn.
    - POST to /other → 404. GET /tba-webhook → 405 with header Allow: POST.
    - Env without TBA_WEBHOOK_SECRET, or with "" → 503, exactly one console.warn line { msg: "tba-webhook-secret-missing" }, runTick not called.
    - Wrong X-TBA-HMAC → 401. Missing X-TBA-HMAC → 401. Both write a warn { msg: "tba-webhook-rejected", reason: "hmac" } and runTick is not called.
    - A body over TBA_WEBHOOK_MAX_BODY_BYTES (1 MiB) → 413, warn reason "size", runTick not called.
    - Signed ping → 200, runTick not called. Signed verification with verification_key "abc123" → 200, one console.log line { msg: "tba-webhook-verification", verificationKey: "abc123" }, runTick not called.
    - Signed match_score for 2026test → 200 with JSON body { accepted: true }; runTick called once with (env, { onlyEventKeys: ["2026test"], trigger: "webhook" }); exactly one waitUntil promise; one log line { msg: "tba-webhook-accepted", messageType: "match_score", eventKey: "2026test" }. After the promise settles there is a msg:"tick" ok:true line carrying trigger "webhook" and eventKey "2026test".
    - The handler responds before the tick finishes: runTick returns a deferred promise that is still pending when the handler resolves 200, and is released afterwards.
    - schedule_updated and alliance_selection: same as match_score (a parameterised it.each is fine).
    - Signed upcoming_match → 200, log { msg: "tba-webhook-ignored", messageType: "upcoming_match" }, runTick not called.
    - Signed body that is not JSON → 400. Signed JSON without message_type → 400. Signed match_score whose event_key is "frc254" or "2026TEST" or missing → 400. runTick is not called in any of these.
    - A runTick that rejects with new Error("boom"): the handler still resolves 200; the collected waitUntil promise rejects; a console.error line with msg "tick", ok false and error "boom" is logged.
    - No log line from any case contains SECRET or a sent X-TBA-HMAC value. Join every console.log, warn and error call's arguments and assert joined.includes(value) is false (a boolean, so a failure never prints the value).
    - Wiring through the real default export (`import worker from "../src/scheduled.js"`): worker.fetch on /nope → 404, and a signed ping to /tba-webhook → 200. Neither starts a tick, so no TBA or D1 fake is needed.
  </behavior>
  <action>
    1. apps/worker/src/env.ts: add `readonly TBA_WEBHOOK_SECRET?: string;`. Give it a doc comment in the style of `TBA_API_KEY` (line 21): the shared secret TBA signs each webhook body with (X-TBA-HMAC); set with `wrangler secret put TBA_WEBHOOK_SECRET`, never assigned in the tracked wrangler.toml. Explain it is optional because an unset secret must be a reachable, typed branch: the handler answers 503 rather than accepting unsigned requests. Update the interface's header comment, which today lists only `TBA_API_KEY` as a secret.

    2. apps/worker/wrangler.toml: add `workers_dev = true` as a TOP-LEVEL key, placed after `compatibility_flags` (line 23) and ABOVE `[vars]` (line 31). TOML assigns any key written after a table header to that table, so below `[vars]` it would silently become a plain var. Comment it: the Worker now also has a fetch entry; the TBA webhook URL is this Worker's workers.dev URL plus `/tba-webhook` (`wrangler deploy` prints the exact hostname, expected `sigmascout-worker.jrw4561.workers.dev`); there are no routes and no custom domain. Also add one line to the file's header comment noting the fetch entry (quick task 261019-ooj).

    3. Create apps/worker/src/tbaWebhook.ts with a header comment covering the protocol, the 10 s rule, why the work runs in `waitUntil`, and Cloudflare's 30 s waitUntil cap. Import from ./scheduled.js with ONE single-line `import type` statement ONLY: `RunTickDeps` and `TickResult`. This is what keeps the module cycle-free, since scheduled.ts imports this module by value. It may import `reportTick` from ./tickLog.js and `z` from "zod" (zod 4.4.3 is a root dependency and already in the Worker bundle through packages/ingest/schemas.ts). Exports:
       - `TBA_WEBHOOK_PATH = "/tba-webhook"`
       - `TBA_WEBHOOK_MAX_BODY_BYTES = 1_048_576`
       - `TBA_EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/`
       - `interface TbaWebhookDeps { readonly runTick: (env: Env, deps?: RunTickDeps) => Promise<TickResult>; readonly now?: () => number }`. `runTick` is REQUIRED here, per the orchestrator's cycle resolution: the module cannot default it without a value import.
       - `async function handleTbaWebhook(request: Request, env: Env, ctx: ExecutionContext, deps: TbaWebhookDeps): Promise<Response>`

       The handler runs these checks in order, returning on the first that applies:
       (a) `new URL(request.url).pathname !== TBA_WEBHOOK_PATH` → 404.
       (b) Method not POST → 405 with `Allow: POST`.
       (c) `env.TBA_WEBHOOK_SECRET` undefined or "" → 503 plus one `console.warn` of `{msg:"tba-webhook-secret-missing"}`.
       (d) If a Content-Length header parses above the cap → 413 before reading the body. Otherwise read the body ONCE with `request.arrayBuffer()`; over the cap → 413. Both log a warn `{msg:"tba-webhook-rejected", reason:"size"}`.
       (e) HMAC over those exact bytes with WebCrypto: `crypto.subtle.importKey("raw", TextEncoder-encoded secret, {name:"HMAC", hash:"SHA-256"}, false, ["sign"])`, then `crypto.subtle.sign("HMAC", key, bytes)`, then lowercase hex. Compare it to the `X-TBA-HMAC` header (trimmed, lowercased) in constant time: TextEncoder both strings; unequal length rejects; otherwise XOR-accumulate every byte pair and accept only when the accumulator is 0. Use no early exit and no `===` on the strings. Missing or mismatched → 401 plus a warn `{msg:"tba-webhook-rejected", reason:"hmac"}`. Do not use `crypto.subtle.timingSafeEqual`: it is Workers-only and the tests run in Node.
       (f) Decode the bytes with TextDecoder and JSON.parse inside try/catch. Validate the envelope with zod `{ message_type: z.string(), message_data: z.unknown().optional() }`. A failure → 400 plus a warn `{msg:"tba-webhook-rejected", reason:"malformed"}`.
       (g) Switch on message_type:
          - `verification`: validate `message_data` as `{ verification_key: z.string().min(1) }` (400 reason "malformed" on failure). Then `console.log` `{msg:"tba-webhook-verification", verificationKey}` and return 200. The key is not a secret: the operator reads it from `wrangler tail` and types it into the logged-in TBA account page.
          - `ping`: log `{msg:"tba-webhook-ping"}`, return 200.
          - `match_score`, `schedule_updated`, `alliance_selection`: validate `message_data` as `{ event_key: z.string().regex(TBA_EVENT_KEY_PATTERN) }` (400 with reason "event_key" on failure). Log `{msg:"tba-webhook-accepted", messageType, eventKey}`. Call `ctx.waitUntil(reportTick(deps.runTick(env, { onlyEventKeys: [eventKey], trigger: "webhook" }), startedMs, { trigger: "webhook", eventKey }, now))`, where `startedMs` is `now()` taken at handler entry. Return 200 with JSON body `{"accepted":true}` and `Content-Type: application/json`. Do not await the tick.
          - Any other type: log `{msg:"tba-webhook-ignored", messageType}`, return 200.

       Every non-accepted 200 returns the JSON body `{"accepted":false}`. No log line or response body may ever include the request body, the `X-TBA-HMAC` value, the computed digest or the secret. Error responses carry a short fixed text, never an echo of the input. The handler never throws: a rejecting `runTick` surfaces only through the waitUntil promise, which `reportTick` logs and rethrows.

    4. apps/worker/src/scheduled.ts: value-import `handleTbaWebhook` from ./tbaWebhook.js. Add `fetch(request, env, ctx)` to the default export, returning `handleTbaWebhook(request, env, ctx, { runTick })`. Keep `satisfies ExportedHandler<Env>`. Extend the default export's doc comment by one sentence: the fetch entry serves TBA webhooks only and logs a `tba-webhook-*` line plus, for an accepted webhook, a tick line carrying `trigger:"webhook"`.

    5. Write apps/worker/test/tbaWebhook.test.ts with the behaviour cases above (red first, then implement). Use a `makeEnv(secret?: string)` in the tbaPoll.test.ts style. Build `Request`s with an explicit `Content-Type: application/json; charset=utf-8`. Restore mocks in an `afterEach`. Mirror the header comment style of tbaPoll.test.ts.
  </action>
  <verify>
    <automated>npx vitest run apps/worker</automated>
    <automated>npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>! (grep -n 'from "./scheduled.js"' apps/worker/src/tbaWebhook.ts apps/worker/src/tickLog.ts | grep -v 'import type')</automated>
    <automated>awk '/^\[vars\]/{v=NR} /^workers_dev = true/{w=NR} END{exit !(w>0 && w<v)}' apps/worker/wrangler.toml</automated>
    Expected: the first command exits 0 because every `./scheduled.js` import in the two modules is a single-line `import type` statement. The second exits 0 because `workers_dev = true` sits above `[vars]`.
    <automated>npx vitest run scripts/secrets-boundary.test.ts apps/worker/test/liveAlgorithmTier.test.ts</automated>
  </verify>
  <done>Every handler case passes. The default export wiring test passes. All apps/worker tests are green, and secrets-boundary and liveAlgorithmTier still pass after the wrangler.toml edit. Both typechecks are clean with every error triaged. tbaWebhook.ts and tickLog.ts reference scheduled.ts through `import type` only. Committed as one commit, staged by path: `feat(worker): accept TBA webhooks at /tba-webhook and re-poll the named event at once (quick 261019-ooj)`.</done>
</task>

<task type="auto">
  <name>Task 3: operator runbook for TBA webhooks in docs/worker-operations.md</name>
  <files>docs/worker-operations.md</files>
  <read_first>
    - docs/worker-operations.md lines 1-95 (intro, Deploying, Secrets), 1490-1525 (the 3ju section, and the 261019-oim section after it if it has landed: grep -n "261019-oim"), 1682-1762 (Watching it, When something is wrong)
    - apps/worker/src/tbaWebhook.ts and the onlyEventKeys block in apps/worker/src/scheduled.ts as committed by Tasks 1-2, so every log name and status code in the doc matches the code exactly
    - The 261019-oim lease code (grep -n acquireEventLeases apps/worker/src), so the lease paragraph states what the lease actually covers
  </read_first>
  <action>
    Write in plain, short sentences. Do not hand-wave anything.

    1. Intro (line ~12): after the "Deployed at" line, add one sentence. Since 2026-10-19 the Worker also answers TBA webhooks at `https://sigmascout-worker.jrw4561.workers.dev/tba-webhook` (see the new section).

    2. "Deploying": note that the deploy output now also prints the workers.dev URL, because `workers_dev = true` is set. The `fetch` entry is the webhook handler. There are no routes.

    3. "Secrets": add `TBA_WEBHOOK_SECRET` beside `TBA_API_KEY`, in the section's existing no-render style. Generate it straight into the gitignored .env without printing it: append `TBA_WEBHOOK_SECRET=` plus the output of `openssl rand -hex 32`, using printf and `>>`. Set it on the Worker with the same grep/cut/tr pattern the section already uses for `TBA_API_KEY`, piped through `printf '%s' "$S" | npx wrangler secret put TBA_WEBHOOK_SECRET`, then `unset S`. Copy it for the TBA form without printing it by piping the same extraction (with `tr -d '\r\n'`) into `clip` on Windows Git Bash, or `pbcopy` on macOS. Never echo it, and never paste it anywhere but the TBA webhook form. Rotating it means updating both sides: the Worker secret and the TBA webhook entry. Until both match, every webhook is a 401.

    4. New section "## Push instead of poll: TBA webhooks (quick task 261019-ooj, 2026-10-19)". Place it after the 261019-oim section if one exists, otherwise directly after "Events are processed concurrently inside a tick (quick task 261018-3ju, 2026-10-18)". Subsections or bullets, in this order:
       - Why. Tick span median 4 s, but TBA `post_result_time` to `published_at` is median 122 s, p90 200 s. The cron polls once a minute and TBA's API serves `/matches` from a cache of up to 61 s, so polling cannot close that gap. A webhook arrives when TBA has the change.
       - The protocol in brief. POST with `X-TBA-HMAC` (hex HMAC-SHA256 of the raw body with the shared secret); `X-TBA-Checksum` is ignored. The three message types acted on: `match_score`, `schedule_updated`, `alliance_selection`. `verification` and `ping` are answered; everything else is answered 200 and ignored. TBA waits at most 10 s and can delete a webhook that answers non-200 or times out. So the handler answers at once and runs the work in `ctx.waitUntil`.
       - Status codes, as a table: 200 accepted, 200 not acted on, 401 bad or missing HMAC, 400 malformed or bad event key, 405 not POST, 404 wrong path, 413 over 1 MiB, 503 secret not set.
       - The one-event tick. `runTick(env, { onlyEventKeys: [eventKey], trigger: "webhook" })` filters the live windows to that event before anything else reads them. It drops the 24 hour recently-ended district watch for that tick. It never writes the tick meta row, because the rotation offset belongs to the cron. A key with no live window logs `webhook-event-not-live` and costs one manifest read and no TBA request. With the firehose this is the common case for events outside a live window.
       - Running beside the cron. State what the 261019-oim lease does as it exists in the code: whichever tick leases the event first processes it, the other skips it and counts it in `eventsSkippedInFlight`, and the next cron poll picks up any change within a minute. Then state plainly whether that lease also keeps two invocations that fold DIFFERENT events from writing each algorithm's league row at the same time. The per-tick state lock from 261018-3ju works only inside one invocation. If the lease does not cover this, say so in one sentence and name it as an open follow-up. Do not claim it is safe.
       - Registration steps for the operator, numbered, in this order. (1) Set the secret (see "Secrets"). (2) `npx wrangler deploy` from apps/worker, and note the workers.dev hostname it prints. (3) On https://www.thebluealliance.com/account, add a webhook with URL `https://<that hostname>/tba-webhook` and the same secret. (4) TBA posts a `verification` message. Read the key from `npx wrangler tail sigmascout-worker --format json` (the `tba-webhook-verification` line, field `verificationKey`) and enter it on the account page. (5) On the account's myTBA page, Subscriptions tab, choose "Subscribe to all events this year" (the firehose). If the form offers notification types, pick at least match score, schedule updated and alliance selection. Use a separate TBA account not linked to a phone, because every notification also goes to the account's phones. The subscription lasts one season, so redo it every January. (6) See it work: during a live event, `tba-webhook-accepted` and then a `tick` line with `trigger:"webhook"` and the same `eventKey`.
       - Caveats, each stated plainly:
         (a) A webhook tick can still hit TBA's API cache and see nothing new. It then does nothing (304 or unchanged), and the next cron poll catches up. So the gain must be measured from `ingest_log` with `pnpm live:report <eventKey>` after the next live event, not assumed. Add a line "After: _measured on the next live window, see the quick task SUMMARY_", matching the 3ju section.
         (b) Cloudflare cancels `waitUntil` work 30 s after the response and logs "waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled." The cron path has no such cap. A webhook tick cancelled after its cursor claim and before its state write leaves that match out of live state until a re-baseline. One cancelled between the state write and the artifact writes leaves the artifacts stale until the event's next match. Watch `durationMs` on `trigger:"webhook"` tick lines and that Cloudflare message.
         (c) Each folding webhook tick also runs the touched-teams rebuild. Folding ticks become one per posted result rather than at most one per minute.

    5. "Watching it": the line "Every invocation emits exactly one structured line" is no longer true for fetch invocations. Reword it. A cron invocation emits one `tick` line, which has no `trigger` field. A webhook invocation emits one `tba-webhook-*` line at once and, when accepted, a `tick` line with `trigger:"webhook"` and `eventKey` when its tick ends. Add a table of the new lines: `tba-webhook-accepted`, `tba-webhook-ignored`, `tba-webhook-ping`, `tba-webhook-verification`, `tba-webhook-rejected` (with `reason`: hmac, size, malformed, event_key), `tba-webhook-secret-missing`, `webhook-event-not-live`. Give each its meaning and its level (log or warn), matching the code.

    6. "When something is wrong": add three rows.
       - Every webhook answered 401: the secret differs between the Worker and the TBA entry. Re-set both from .env.
       - 503 with `tba-webhook-secret-missing`: the secret is not set on the deployed Worker.
       - Cron ticks fine during a live event but no `tba-webhook-` lines at all: TBA may have deleted the webhook after non-200 answers, or the firehose subscription lapsed. Check the TBA account page and re-add.

    No secret values or key fragments anywhere in the doc. Write placeholders only, such as <that hostname>.
  </action>
  <verify>
    <automated>grep -c "^## Push instead of poll: TBA webhooks (quick task 261019-ooj" docs/worker-operations.md</automated>
    <automated>grep -c "TBA_WEBHOOK_SECRET" docs/worker-operations.md</automated>
    <automated>for s in tba-webhook-accepted tba-webhook-verification tba-webhook-rejected tba-webhook-secret-missing webhook-event-not-live 'trigger:"webhook"' waitUntil "Subscribe to all events this year" "live:report"; do printf '%s ' "$s"; grep -c -- "$s" docs/worker-operations.md; done</automated>
    Expected: the heading count is exactly 1, `TBA_WEBHOOK_SECRET` appears at least 3 times, and every string in the loop counts at least 1.
  </verify>
  <done>docs/worker-operations.md carries the secret steps, the new section with the why, the protocol, the status table, the one-event tick, the lease interplay as the code actually behaves, the six registration steps and the three caveats. It also carries the reworded "Watching it" with the new log-line table and three new trouble rows. Every log name and status code matches the committed code. Committed as one commit: `docs(worker): runbook for TBA webhooks, push instead of poll (quick 261019-ooj)`.</done>
</task>

<amendments>
## Orchestrator amendments (2026-10-19, after the plan was written; these override the task text above where they differ)

A1. The 30 s `waitUntil` cap (T-ooj-06) is MITIGATED, not accepted. Quick task 261019-oim (executed before this task; read its code: `grep -n "deadlineMs\|FoldLeaseTimeoutError\|acquireFoldLease\|TickLocks" apps/worker/src/scheduled.ts apps/worker/src/eventLease.ts`) added `RunTickDeps.deadlineMs` (a real-clock instant, default `Date.now() + 60_000`), `RunTickDeps.leaseClock`, `TickLocks.clock`/`TickLocks.deadlineMs`, and a cross-invocation FOLD LEASE (`#fold` row in `event_lease`, waited for with 250 ms polling until `deadlineMs`, then `FoldLeaseTimeoutError`, which the existing Phase A catch turns into a reverted claim and a `failed` event). This task adds, in Task 1:
   - In `processEvent`, immediately BEFORE `counter.spend(1); const claimed = await claimEventAdvance(...)`: `if (locks.clock() >= locks.deadlineMs) { console.log(JSON.stringify({ msg: "tick-deadline-skip", eventKey })); return { status: "unchanged" }; }`. Returning there writes no poll etag (the etag is written only on the other branches), so the next cron poll re-reads the same list and folds. Test in `scheduled.test.ts`: `runTick(env, { nowMs: NOW_MS, deadlineMs: Date.now() - 1 })` over one live event with new matches: `eventsAdvanced 0`, `eventsConsidered 0`, no `event_cursor` row for the event, no `algorithm_state` row, one `tick-deadline-skip` line, and a following tick with the default deadline folds it.
   - In Task 2, the handler passes `deadlineMs: startedMs + WEBHOOK_TICK_DEADLINE_MS` with `export const WEBHOOK_TICK_DEADLINE_MS = 20_000` in `tbaWebhook.ts` (comment: Cloudflare cancels `waitUntil` work 30 s after the response; the fold lease wait and the claim both stop at 20 s, so a Phase A section never starts with less than 10 s left; one-event ticks take about 4 s). The handler test asserts `runTick` was called with `{ onlyEventKeys: ["2026test"], trigger: "webhook", deadlineMs: <the injected now() at entry> + 20_000 }`.
   - Task 3 docs: the 30 s caveat becomes "mitigated: the webhook tick stops taking new fold sections 20 s after the response (`tick-deadline-skip`, or `FoldLeaseTimeoutError` when the fold lease is held by a cron tick), and a cron tick folds the same matches within a minute. A Phase A section that has already started finishes well inside the remaining 10 s. Watch `durationMs` on `trigger:"webhook"` tick lines and Cloudflare's cancellation message." Update the STRIDE row T-ooj-06 to "mitigate".

A2. The league row race (T-ooj-07) is CLOSED by the fold lease from 261019-oim, not open. Task 3's "Running beside the cron" paragraph says: whichever tick leases the EVENT first processes it and the other skips it (`eventsSkippedInFlight`); and when a webhook tick and a cron tick fold DIFFERENT events at once, each Phase A section waits for the D1 fold lease, so each algorithm's league row is read and rewritten by one invocation at a time, exactly as inside one tick. Name the remaining read-merge-write without a cross-invocation lock: a shared team page and the `teams/{year}` feed when one team is at two live events at once (rare). Update the STRIDE row T-ooj-07 to "mitigate" and say the executor must verify the lease code is present (if it is NOT present at execution time, stop and report; do not proceed on the assumption).

A3. The summary text the executor returns must state: the `deadlineMs` value the handler passes, the pre-claim check's location, and the fold lease interplay as read from the code.
</amendments>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Internet → `/tba-webhook` | Anyone can POST to the public workers.dev URL. Only a body carrying a valid HMAC under the shared secret is trusted. |
| TBA payload → `runTick` | Only `event_key` crosses, after a regex check. The tick then fetches its own data from TBA's API as it always has; nothing else in the webhook body is used. |
| Worker → logs (`wrangler tail`, Observability) | Log lines are readable by anyone with dashboard access. They must never carry the secret, the body or the HMAC value. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ooj-01 | Spoofing | `handleTbaWebhook` | high | mitigate | HMAC-SHA256 over the raw body bytes with `TBA_WEBHOOK_SECRET`, compared in constant time (XOR accumulator, length check first). Missing or wrong → 401, no tick. Tested with an independent node:crypto signer. |
| T-ooj-02 | Information disclosure | `tbaWebhook.ts` logs and responses | high | mitigate | Never log or echo the body, the `X-TBA-HMAC` value, the digest or the secret; error responses are fixed text. A test asserts, by boolean only, that no log line contains the secret or any sent HMAC. The docs generate and copy the secret without rendering it (CLAUDE.md secrets rule). |
| T-ooj-03 | Denial of service | body read and HMAC | medium | mitigate | 413 above 1 MiB, checked against Content-Length before reading and against the byte length after. An unsigned request costs one HMAC and no tick. |
| T-ooj-04 | Tampering | `event_key` into TBA URLs and D1 keys | medium | mitigate | zod `z.string().regex(/^\d{4}[a-z0-9]+$/)`; anything else → 400. The key only filters the live windows manifest; an unknown key reaches nothing. |
| T-ooj-05 | Denial of service | misconfiguration | medium | mitigate | An unset secret → 503 and a warn line, never accepting unsigned requests. The docs order "set the secret and deploy" before "register with TBA", because TBA can delete a webhook that answers non-200. |
| T-ooj-06 | Tampering | live state integrity: the 30 s `waitUntil` cap | medium | accept (flagged) | A webhook tick cancelled between `claimEventAdvance` and the Phase A state write leaves that match out of live state until a re-baseline. One-event ticks are median about 4 s, so this needs a tick about 7 times slower than usual. The docs name Cloudflare's cancellation message and `durationMs` on webhook tick lines so it is visible. Raised with the orchestrator as a follow-up candidate. |
| T-ooj-07 | Tampering | each algorithm's league row across invocations | medium | accept (flagged) | The 261018-3ju state lock serializes Phase A inside one invocation only. Webhook ticks raise the rate at which two invocations fold different events at once. Whether the 261019-oim lease covers this is read from the code in Task 3 and stated in the docs and the summary. Raised with the orchestrator before the webhook is registered. |
| T-ooj-08 | Repudiation | replay of a captured signed body | low | accept | A replay triggers one more idempotent one-event tick. `claimEventAdvance`'s compare-and-swap and the event lease prevent a double fold. |
| T-ooj-09 | Information disclosure | `verificationKey` in logs | low | accept | It is a one-time activation key, usable only from the logged-in TBA account page, and the operator has to read it from the tail. |
</threat_model>

<verification>
Run from the repo root, never `timeout n pnpm ...`:
- `npx vitest run apps/worker`: all green, including the new cases in scheduled.test.ts, scheduled.district.test.ts and tbaWebhook.test.ts.
- `npx vitest run scripts/secrets-boundary.test.ts`: green.
- `npx tsc --noEmit -p apps/worker/tsconfig.json` and `npx tsc --noEmit`: clean. Triage every error; never batch-dismiss one as pre-existing.
- `git log --oneline -4` shows three commits from this plan; `git status` is clean apart from `.planning/` files, which are not committed.
- Executor limits: no network, no `wrangler deploy`, no `wrangler secret put`, no push (the orchestrator deploys and registers nothing for Jacob). Never Read, cat or echo `.env`. Stage by path, never `git add -A`. Do not write SUMMARY.md: return the summary as TEXT in the final message, including (1) whether the 261019-oim lease code was present and where the filter sits relative to `acquireEventLeases`, (2) what that lease does and does not cover for two invocations folding different events (T-ooj-07), and (3) the test counts before and after.
</verification>

<success_criteria>
- A signed `match_score`, `schedule_updated` or `alliance_selection` POST to `/tba-webhook` answers 200 `{"accepted":true}` at once and runs a one-event tick for that event in `waitUntil`, logged as a `tick` line with `trigger:"webhook"` and `eventKey`.
- Unsigned, wrongly signed, oversized, malformed or bad-key requests are refused with 401, 413 or 400 and run nothing. An unset secret answers 503.
- A one-event tick never writes the tick meta row, never touches another event, and drops the recently-ended district watch.
- The cron tick and its log line are unchanged; all existing tests still pass unmodified.
- The runbook lets Jacob set the secret, deploy, register, verify, subscribe and watch without asking anything, and it states the cache, 30 s and league-row caveats honestly.
</success_criteria>

<output>
The executor returns its summary as text in its final message. The orchestrator writes `.planning/quick/261019-ooj-push-instead-of-poll-a-worker-fetch-hand/261019-ooj-SUMMARY.md`.
</output>
