---
quick_id: 261019-ooj
slug: push-instead-of-poll-a-worker-fetch-hand
description: Push instead of poll: a Worker fetch handler for TBA webhooks (match_score, schedule_updated, alliance_selection) that runs a one-event tick at once
date: 2026-10-19
status: complete
commits:
  task1: d60e74c8
  task2: 811c019d
  task2_fix: 31324b8c
  task3: a4a79979
files_changed:
  - apps/worker/src/tbaWebhook.ts (new)
  - apps/worker/src/tickLog.ts (new)
  - apps/worker/src/scheduled.ts
  - apps/worker/src/env.ts
  - apps/worker/wrangler.toml
  - apps/worker/test/tbaWebhook.test.ts (new)
  - apps/worker/test/scheduled.test.ts
  - apps/worker/test/scheduled.district.test.ts
  - docs/worker-operations.md
tests:
  worker: "31 files, 658 tests (was 30 files, 630 after 261019-oim)"
  whole_repo: "383 files: 382 passed, 1 failed (DistrictLedger drawer first-paint, a web timing flake under the 35 min full run; passes alone 105/105 and in CI); 9670 passed, 1 skipped"
typecheck:
  worker: "tsc --noEmit -p apps/worker/tsconfig.json exit 0"
  root: "tsc --noEmit exit 0"
deployed: "Worker version 2afdb64a-286c-4ecd-bfea-d267a8abdc27, 2026-10-20 01:16Z; TBA_WEBHOOK_SECRET not yet set, every webhook POST answers 503 until it is"
research:
  - "The all-events firehose is open to any TBA account: myTBA page, Subscriptions tab, Subscribe to all events this year. One season at a time, redo every January. TBA recommends a separate account not linked to a phone, because every notification also goes to the account's phones."
  - "Protocol read from TBA's source (webhook_request.py and the notification classes): POST, X-TBA-HMAC = hex HMAC-SHA256 of the raw body keyed with the shared secret, body {message_type, message_data}. match_score carries event_key, match_key, event_name and the v3 match object; schedule_updated carries event_key, event_name, optional first_match_time; alliance_selection carries event_key, event_name and the v3 event object; verification carries verification_key. TBA waits 10 s and may delete a webhook that answers non-200."
  - "Cloudflare cancels fetch-handler waitUntil work 30 s after the response (developers.cloudflare.com/workers/runtime-apis/context, checked 2026-10-19). The cron path has no such cap."
decisions:
  - "The webhook tick is the existing tick restricted to one event (RunTickDeps.onlyEventKeys): it never writes the tick meta row, drops the 24 hour district watch, and runs under deadlineMs = arrival + 20 s, after which it takes no fold claim (tick-deadline-skip) and no fold lease (FoldLeaseTimeoutError, claim reverted). The cron keeps no claim deadline."
  - "The handler takes runTick through deps (no value import of scheduled.ts) and the tick log line moved to tickLog.ts, so there is no import cycle. The cron's tick line is byte for byte what it was."
  - "A 1 MiB body cap before the HMAC check; error answers are fixed text; nothing from the request, the header or the secret is ever logged."
---

# Quick task 261019-ooj: push instead of poll, a Worker fetch handler for TBA webhooks

## Why

After 261018-3ju the tick span median is 4 s, but TBA's `post_result_time` to the page's
`published_at` is still median 122 s, p90 200 s (measured for 261019-oim). The cron polls once a
minute and TBA's API serves `/matches` from a cache of up to 61 s. A webhook arrives when TBA has
the change.

## What changed

- **`handleTbaWebhook`** (`apps/worker/src/tbaWebhook.ts`), served by a new `fetch` entry on the
  Worker's default export at `/tba-webhook`. Checks in order: path (404), method (405), secret
  present (503 and `tba-webhook-secret-missing`), size (413 over 1 MiB), `X-TBA-HMAC` over the raw
  body bytes compared in constant time (401), JSON and envelope (400). `verification` logs the
  activation key as `tba-webhook-verification` (not a secret; the operator types it into the TBA
  account page). `ping` and every other type answer 200 `{"accepted":false}`. `match_score`,
  `schedule_updated` and `alliance_selection` validate `event_key`, log `tba-webhook-accepted`,
  start the one-event tick in `ctx.waitUntil` and answer 200 `{"accepted":true}` at once.
- **The one-event tick.** `RunTickDeps` gains `onlyEventKeys` and `trigger`. The live windows are
  filtered before the idle exit, the event lease and every pass; the recently-ended district watch
  is dropped; `writeTickMeta` is skipped (a one-event tick would reset the cron's rotation offset
  to 0). A key with no live window logs `webhook-event-not-live` and costs one manifest read.
- **The deadline.** The handler passes `deadlineMs = arrival + WEBHOOK_TICK_DEADLINE_MS` (20 s).
  `processEvent` takes no fold claim at or past it (`tick-deadline-skip`, placed immediately before
  `claimEventAdvance`, writing no poll etag so the next cron poll folds the same matches), and the
  fold lease wait from 261019-oim stops there too. `TickLocks.claimDeadlineMs` is set only when the
  caller set a deadline; a cron tick claims at any point of its run, as before.
- **`reportTick`** (`apps/worker/src/tickLog.ts`): the one `tick` log line, used by the cron (no
  extra fields) and by the webhook path (`trigger: "webhook"`, `eventKey`).
- **`Env.TBA_WEBHOOK_SECRET`** (optional, set with `wrangler secret put`); `workers_dev = true` in
  `wrangler.toml`, placed above `[vars]`.
- **Runbook** (`docs/worker-operations.md`): the `TBA_WEBHOOK_SECRET` recipe (generated straight
  into `.env`, confirmed by length, never echoed), the section "Push instead of poll: TBA webhooks"
  (why, protocol, status codes, the one-event tick, running beside the cron with both leases, the
  six operator steps, caveats), and the new log lines in "Watching it".

## Running beside the cron

Whichever tick leases an event first processes it; the other skips it. Two invocations folding
different events wait for the D1 fold lease one Phase A section at a time. A webhook tick waits
only until its 20 s deadline. The remaining unguarded case is the one 261019-oim names: a team
page or the `teams/{year}` feed shared by two invocations, one team at two live events at once.

## Tests

- `tbaWebhook.test.ts`: every status code, the HMAC signed independently with Node's `createHmac`,
  each acted-on type starting exactly one tick with `{ onlyEventKeys, trigger: "webhook",
  deadlineMs }` inside `waitUntil`, the 200 answered before the tick finishes, a rejecting tick
  logged and not thrown, and the real default export's `fetch`.
- `scheduled.test.ts`: the one-event tick folds only the named event and leaves the tick meta row
  unchanged (a following full tick rewrites it); a key not in the manifest costs zero TBA requests;
  `deadlineMs` in the past claims nothing and a later tick folds.
- `scheduled.district.test.ts`: the one-event tick's district pass sees only the named event.

## Deviations from plan

- `31324b8c`: the pre-claim deadline check applies only when the caller set `deadlineMs`. The plan
  text would have given cron ticks a 60 s claim deadline too, which would leave events at the back
  of a busy tick for a later, equally slow tick.
- The executor was stopped during its final whole-repo run (reboot); the orchestrator re-ran the
  whole-repo tests and both typechecks, wrote this summary from the diff, and deployed.

## Not done here (operator steps, see the runbook section "Registering the webhook")

1. Add the webhook on TBA first (TBA generates the secret and shows it on the account page; corrected 2026-10-20, the runbook first said the operator picks it), then set `TBA_WEBHOOK_SECRET` on the Worker. Until then every webhook
   POST answers 503.
2. The webhook URL on https://www.thebluealliance.com/account is
   `https://sigmascout-worker.jrw4561.workers.dev/tba-webhook`.
3. Read the `tba-webhook-verification` key from `npx wrangler tail sigmascout-worker --format json`
   and enter it on the account page.
4. Subscribe that account to all events this year (the firehose) on the myTBA Subscriptions tab.
5. After the next live event, measure from `ingest_log` whether webhook ticks beat the cron past
   TBA's API cache; fill the "After" line in the runbook's caveat (a).

## Release

Deployed as Worker version 2afdb64a-286c-4ecd-bfea-d267a8abdc27 at 2026-10-20 01:16Z. Live probes after the deploy: GET / answers 404, GET /tba-webhook answers 405, POST /tba-webhook answers 503 because the secret is not set yet.
