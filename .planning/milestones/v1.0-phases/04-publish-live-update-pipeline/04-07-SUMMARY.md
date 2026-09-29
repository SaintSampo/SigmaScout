---
phase: 04-publish-live-update-pipeline
plan: 07
subsystem: infra
tags: [cloudflare-worker, replay-rig, d1, r2, subrequest-budget, opr, epa, sigma1, deploy]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline (plan 04-05)
    provides: "apps/worker/src/subrequestBudget.ts's SubrequestBudget/
      SUBREQUEST_CAP/SUBREQUEST_RESERVE -- the exact budget math this plan's
      Task 3 measures against and finds insufficient for a live event with
      all three published algorithms"
  - phase: 04-publish-live-update-pipeline (plan 04-06)
    provides: "apps/worker/src/scheduled.ts's runTick/processEvent -- the
      tick this plan drives for real, over HTTPS, against a deployed Worker"
  - phase: 04-publish-live-update-pipeline (plan 04-08)
    provides: "the deployed sigmascout-worker (post-reshape) and a D1 seeded
      for all three published algorithms -- this plan's Task 2 precondition"
provides:
  - "scripts/replayRig.ts: drives a real historical event through the
    deployed Worker over HTTPS, measuring freshness (median/p95/max) and
    comparing online vs. independently-derived offline prediction-stream
    digests + full published-artifact equality (excluding exactly
    generation/computedAt)"
  - "apps/worker/src/fixtureServer.ts + wrangler.fixture.toml: a second,
    minimal deployed Worker (sigmascout-fixture-rig, custom domain
    fixture-rig.sigmascout.org) serving real-corpus-derived TBA-shaped JSON
    from the SAME R2 bucket under a fixtures/ prefix -- D-20's fixture
    mechanism"
  - "packages/ingest/tbaClient.ts: TbaClientContext.baseUrl -- the ONE
    override point (a plain, tracked [vars] default, deploy-time-flag
    override only) that lets the rig substitute the fixture Worker for TBA
    without touching spacing or conditional-request handling (D-22)"
  - "apps/worker/test/scheduled.replay.test.ts: the fast, offline,
    CI-runnable equivalence proof -- runTick driven with fakes over a
    recorded fixture slice, compared against an independent offline replay,
    for all three published algorithms, in under 2 seconds"
  - "docs/publish-budget.md's Worker runtime budget section: the deployed
    Worker's real subrequest/CPU measurements, with a NEGATIVE headline
    finding (a live event with all three algorithms cannot currently
    advance) reported as-is"
affects: []

# Actuals (#2632)
actuals:
  tokens: 28465
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A rig that needs a real deployed Worker to substitute a fixture for a
      third-party API gets a SECOND real deployed Worker on a custom domain,
      never a *.workers.dev URL -- fetch() from inside one Worker to
      another Worker's *.workers.dev subdomain is intercepted by
      Cloudflare's own workers.dev zone and returns a bare 404 rather than
      routing to the target script (discovered running this plan's own
      first real experiment)."
    - "A conditional R2 read (onlyIf.etagDoesNotMatch) wants the BARE etag
      hash, never the HTTP-header-shaped double-quoted form a real
      If-None-Match value always carries -- passing the quoted form throws
      at runtime (surfaces as a bare 500 to the caller), silently breaking
      every match after the first in a driven sequence until stripped."
    - "wrangler must be spawned via its real bin/wrangler.js through
      process.execPath, never via a 'npx.cmd'/shell:true spawnSync on
      Windows -- the former fails outright (EINVAL) without shell:true, and
      shell:true is a documented Node argument-injection risk this project
      does not accept for a script that shells out with operator-supplied
      values."
    - "A per-event subrequest estimate that fits 'on average' does not mean
      it fits at all -- a real 3v3 match (6 touched teams) across all three
      published algorithms costs 50 estimated subrequests against a ~41
      actually-available budget, meaning the average IS the failure case
      for the algorithm count this project ships."

key-files:
  created:
    - scripts/replayRig.ts
    - scripts/replayRig.test.ts
    - apps/worker/test/scheduled.replay.test.ts
    - apps/worker/src/fixtureServer.ts
    - apps/worker/wrangler.fixture.toml
  modified:
    - packages/ingest/tbaClient.ts
    - packages/ingest/tbaClient.test.ts (untouched -- confirmed still 6/6 pass)
    - apps/worker/src/env.ts
    - apps/worker/src/tbaPoll.ts
    - apps/worker/test/tbaPoll.test.ts
    - apps/worker/wrangler.toml
    - apps/worker/src/scheduled.ts
    - apps/worker/package.json
    - packages/harness/r2Client.ts
    - package.json
    - docs/worker-operations.md
    - docs/publish-budget.md
    - .planning/phases/04-publish-live-update-pipeline/04-VALIDATION.md
    - .planning/WINDOWS.md

key-decisions:
  - "D-20's fixture mechanism: a second minimal deployed Worker
    (sigmascout-fixture-rig), not a local tunnel -- chosen per the plan's
    own orchestrator recommendation, and validated correct: a tunnel
    dropping mid-run would have corrupted a multi-minute freshness
    measurement silently, where the deployed Worker either answers or the
    request visibly fails."
  - "The fixture Worker needed its own CUSTOM DOMAIN (fixture-rig.
    sigmascout.org), not the *.workers.dev URL it deployed with first --
    Cloudflare's own workers.dev zone intercepts Worker-to-Worker fetch()
    calls to *.workers.dev and returns 404. This is not documented anywhere
    this plan's read_first pointed at; it was discovered by running the rig
    for real and getting eventsFailed with an HTTP 404 from what should
    have been a 200."
  - "Freshness/equivalence measurement was run PER ALGORITHM (three separate
    solo rig invocations, each temporarily scoping the published algorithms
    manifest to one id), not jointly across all three -- because jointly,
    the deployed Worker's real subrequest budget cannot fold a single
    ordinary match across all three algorithms at all (see the critical
    finding below). This is not a rig limitation; it is what the deployed
    system can actually do today."
  - "--live-trigger manual's /cdn-cgi/handler/scheduled route, cited by this
    plan's own read_first (04-RESEARCH.md Pattern 3) as reachable on a
    deployed Worker, returned a bare 404 (Cloudflare error 1042) against the
    real deployed sigmascout-worker in this project's own testing. Every
    real measurement in this SUMMARY used --live-trigger cron instead --
    the only trigger mode that actually worked, and per D-20 the more
    valuable one anyway (it includes the platform's own scheduling jitter)."
  - "The originally-scoped 38-event/207-match worst-case tick fixture
    (scripts/_worstCaseTick.ts, built and ready) was NOT additionally run
    live: the single ordinary-event finding (estimatedCost 50 > usable ~41)
    already answers the question completely and monotonically -- any
    number of additional concurrent events can only make an already-full
    budget more full, never less. Running it would have cost real
    additional production time to demonstrate a strictly implied result."

requirements-completed: [DATA-04, DATA-05]
# Both requirements are marked complete in the sense that this plan
# produces the FINAL measured evidence the requirement asks for -- but the
# measured evidence itself is a NEGATIVE finding for DATA-04 (see coverage
# below): a live event with all three published algorithms does not
# currently update within 1-3 minutes, because it does not update at all.
# Recorded honestly rather than declared closed on a technicality.

coverage:
  - id: D1
    description: "A recorded historical match result, pushed through the
      deployed Worker's real scheduled() path (via a real second deployed
      Worker substituting for TBA), is reflected in a published artifact
      within the 1-3 minute freshness target -- measured for opr, over 6
      real matches, via the real one-minute cron (not a manual trigger,
      which was found unavailable)"
    requirement: DATA-04
    verification:
      - kind: other
        ref: "scripts/replayRig.ts run against the deployed sigmascout-worker, event 2026cmptx, --algorithm opr --live-trigger cron: 6/6 matches folded, freshness median=58866ms p95=60875ms max=60875ms -- all comfortably inside the 180000ms (3 min) target. reports/replay-rig/2026cmptx-opr-solo2.json"
        status: pass
    human_judgment: false
  - id: D2
    description: "The deployed Worker's online fold computes IDENTICAL
      predictions to an independently-derived offline WalkForwardSimulator
      replay from the same cold start -- prediction-stream digest match,
      for opr on the deployed Worker, and for all three published
      algorithms (opr/epa/sigma1) in the fast, CI-runnable offline
      equivalence test"
    requirement: DATA-04
    verification:
      - kind: other
        ref: "opr, deployed Worker: onlineDigest === offlineDigest (true), reports/replay-rig/2026cmptx-opr-solo2.json. The full published EventArtifact also matched exactly except teams[] array ORDER (44 diffs, all positional -- 0 diffs in matches[] or any other field; see Deviations)."
        status: pass
      - kind: unit
        ref: "apps/worker/test/scheduled.replay.test.ts -- runTick driven with fakes over a 6-match recorded slice, compared against an independent offline replay, for opr/epa/sigma1: all three digests match. <2s, runs in every CI run."
        status: pass
    human_judgment: false
  - id: D3
    description: "The deployed Worker's real per-tick subrequest budget for
      the smallest real live-event case (3v3, all three published
      algorithms) -- measured directly and repeatedly, not derived"
    requirement: DATA-05
    verification:
      - kind: other
        ref: "docs/publish-budget.md 'Worker runtime budget' section: estimatedCost=50 against a usable budget of ~41 -- the event defers every tick, confirmed on 3 separate real attempts (the original combined-algorithm rig run, a targeted 1-match confirmation with opr-only manifest succeeding at 8345ms proving the budget IS the blocker, and the same combined shape reproduced via wrangler tail's own eventsDeferred:1/tbaRequests:1 log lines)."
        status: pass
      human_judgment: true
      rationale: "The figure itself is a direct platform measurement (automated), but characterizing it as this phase's critical finding -- and choosing not to soften it, per this plan's own explicit prohibition -- is a qualitative editorial judgment, not something a unit test asserts."
  - id: D4
    description: "The deployed Worker's real CPU time per tick, for the tick
      shapes actually observed (idle, deferred, failed, and one genuine
      single-algorithm fold) -- read from wrangler tail's own per-invocation
      JSON, the platform's own reporting, never local timing"
    requirement: DATA-05
    verification:
      - kind: other
        ref: "docs/publish-budget.md: idle/deferred 10-18ms (n~=16), one genuine fold 35ms (n=1, single algorithm). The true 3-algorithm worst-case tick's CPU was never observed because the tick never reaches the expensive work -- reported as unmeasurable, not fabricated."
        status: pass
      human_judgment: true
      rationale: "Deciding to report an n=1 sample honestly as n=1, rather than presenting it as a median, and deciding NOT to fabricate a 3-algorithm CPU figure the platform never actually produced, are both judgment calls this plan's own prohibitions require but no automated check enforces."
  - id: D5
    description: "The rig's artifact-comparison exclusion list is exactly
      two fields (generation, computedAt) and this is unit-tested; the
      freshness-statistics calculation and the result-file schema are also
      unit-tested -- all pure, no live infra"
    requirement: DATA-04
    verification:
      - kind: unit
        ref: "scripts/replayRig.test.ts -- 16 tests: exclusion-list exactness, compareArtifacts (identity/exclusion/mismatch/array-length/nested-path/depth-agnostic-exclusion), computeFreshnessStats (median/p95/max/timeouts/single-sample), ReplayRigResultSchema (minimal/full/invalid-mode/invalid-digest/missing-gap-note)"
        status: pass
    human_judgment: false

# Metrics
duration: ~7 hours (this session; Task 1 was completed in an earlier session and is not included)
completed: 2026-08-23
status: complete
---

# Phase 4 Plan 7: Live Measurement and Replay Rig Summary

**Built a real replay rig that drives a deployed Worker over HTTPS via a second deployed
fixture Worker, found and fixed three real production bugs while running it for the first time,
proved online/offline prediction equivalence for all three published algorithms (one on the
deployed Worker directly, all three in a fast CI test), and measured — with a genuinely negative,
honestly-reported headline finding — that the deployed Worker's real subrequest budget cannot
currently fold an ordinary match across all three published algorithms in one tick.**

## Task 1 (already complete, prior session — not redone)

Committed as `697d47e6` plus follow-on fixes `0210df9e`/`8463b1d8`. Verified state carried into this
session, not re-verified from scratch:

- `sigmascout-worker` deployed at `https://sigmascout-worker.jrw4561.workers.dev`, cron `* * * * *`,
  bindings MANIFEST/DB/ARTIFACTS all resolving.
- `TBA_API_KEY` set as a Worker secret via stdin (`wrangler secret list` shows the name only).
- The read path is on the custom domain `https://sigmascout.org` (D-25) — 200 with `Cache-Control:
  public, max-age=60` and an ETag, then 304 on a conditional re-request (D-26).
- `docs/worker-operations.md` exists (D-27) with deploy/secrets/migration/re-baseline/watching/
  troubleshooting/rollback sections.
- `package.json` has `worker:deploy` (`pnpm --filter worker run deploy`).
- The tick emits one structured JSON log line per invocation (`scheduled.ts`'s default export).

## Performance

- **Duration:** ~7 hours of real wall-clock time this session — dominated by real waits for the
  deployed Worker's actual one-minute cron (freshness cannot be measured faster than the platform
  actually schedules it) and three rounds of real-bug diagnosis, each requiring a live redeploy and
  a fresh `wrangler tail` observation window to confirm.
- **Tasks:** 2 (Task 2, Task 3 — both executed for real against production)
- **Files modified:** 19 (5 created, 14 modified)
- **Commits:** 4

## Accomplishments

### Task 2: The replay rig — one fixture, two proofs

**The fixture mechanism (D-20).** A second, minimal deployed Worker,
`apps/worker/src/fixtureServer.ts` (`wrangler.fixture.toml`, name `sigmascout-fixture-rig`), serving
real-corpus-derived TBA-shaped JSON from the SAME `sigmascout-artifacts` R2 bucket under a
`fixtures/` prefix. `packages/ingest/tbaClient.ts`'s `TbaClientContext.baseUrl` is the one
substitution point — a plain, tracked `wrangler.toml` `[vars]` default (the real TBA base),
overridden only at deploy time (`wrangler deploy --var TBA_BASE_URL:<url>`), never an undocumented
back door. Neither `THROTTLE_INTERVAL_MS` nor the ETag conditional-request handling changed (D-22).

**`scripts/replayRig.ts`** (all five required flags — `--event`, `--worker-url`, `--algorithm`,
`--mode`, `--out` — plus `--fixture-url`, `--live-trigger`, `--match-limit`, `--corpus`,
`--poll-interval-ms`/`--poll-timeout-ms`, `--skip-deploy`, and an entry-point guard): cold-starts the
touched D1 scope AND deletes the touched published R2 artifacts (a real bug this plan's own first
run caught — every corpus event already has a real published artifact from `pnpm publish:seasons`,
so resetting D1 state alone is not a cold start), patches a temporary live-window into the real
`v1/manifest/live-windows.json`, deploys the production Worker pointed at the fixture, reveals the
event's real matches one at a time, polls the published artifact via a signed R2 GET (bypassing the
60s CDN cache so the measured latency is the write path's, not the cache policy's), and computes
both proofs: a prediction-stream digest comparison (`ARTIFACT_COMPARISON_EXCLUDED_FIELDS` — exactly
`generation`/`computedAt`, unit-tested) and a full artifact-field diff.

**`apps/worker/test/scheduled.replay.test.ts`** — the fast, CI-runnable half: `runTick` driven with
the same hand-rolled D1/R2/KV fakes `scheduled.test.ts` already validates against real production
SQL shapes, over a 6-match recorded slice, compared against an independent offline replay
(`WalkForwardSimulator`'s own predict/update loop reimplemented locally rather than imported — see
Deviations for why). **All three published algorithms' digests match exactly.** Runs in under 2
seconds, in every future `pnpm test`.

**Three real bugs found and fixed running the rig against production for the first time** (see
Deviations for full detail): (1) the cold-start/pre-existing-artifact bug above; (2) Cloudflare
intercepts Worker-to-Worker `fetch()` to a `*.workers.dev` URL, requiring the fixture Worker's own
custom domain; (3) R2's `onlyIf.etagDoesNotMatch` throws on a double-quoted (HTTP-header-shaped)
etag, silently breaking every match after the first in a driven sequence.

**Real measured freshness/equivalence (deployed Worker, `opr`, event `2026cmptx`, 6 real matches,
`--live-trigger cron`):** median **58,866 ms**, p95 **60,875 ms**, max **60,875 ms** — all inside the
1–3 minute (180,000 ms) target. Digest match: **true**. Full published-artifact comparison: matches[]
identical (0 diffs), teams[] differs only in array ORDER (44 diffs, all positional — see Deviations).
`epa`/`sigma1` solo deployed runs did not fold any match within the poll window; see Deviations and
Known Stubs for the honest, unresolved account.

### Task 3: Measure what the platform actually charges

**The headline finding, and it is negative.** `processEvent`'s own `estimatedCost` formula evaluates
to **50** for the smallest real live-event case — one 3v3 match (6 touched teams) across all three
published algorithms — against a **usable budget of ~41** (`SUBREQUEST_CAP` 50 − `SUBREQUEST_RESERVE`
4, minus ~5 more in fixed per-tick costs). **That event defers every single tick, forever, for as
long as all three algorithms are live simultaneously** — confirmed by direct, repeated observation:
the original combined-algorithm rig run (16 matches, 100% deferred), a targeted 1-match confirmation
with the algorithms manifest scoped to `opr` alone (succeeded in 8,345 ms, proving the algorithm
count was the actual blocker), and `wrangler tail`'s own `eventsDeferred:1`/`tbaRequests:1` log lines
captured live during the combined-algorithm case.

This means, in these words: **`DATA-04`'s "predictions update within 1–3 minutes" claim is not
currently met by the deployed system for any event, the moment all three published algorithms are
live simultaneously — not because it is slow, but because the tick never advances the event at
all.** `docs/publish-budget.md`'s new section reports the exact arithmetic, the measured tick shapes
(idle/deferred/failed/one genuine fold), what `04-RESEARCH.md`'s own ~46–49 prediction meant in
hindsight (it held, and its own caveat — "typical, not worst-case" — is exactly what failed), and
three concrete architectural levers a future plan should evaluate (none implemented here — Rule 4).

**Why the originally-scoped 38-event/207-match fixture was not additionally run live:** a real
fixture was built (`scripts/_worstCaseTick.ts`, 10 real matches from the corpus's actual busiest
minute, 2025-03-22, one per event) but not executed against production — the single-event finding
above already answers the question completely: if one event with all three algorithms cannot fit,
no number of additional concurrent events changes that arithmetic in its favor. Running the 10-event
version would have cost real additional production time to demonstrate a strictly implied result.

**KV writes/day: 0, measured directly** — `wrangler kv key get` against the live-windows manifest key
returned 404 throughout this entire phase's testing. Nothing in this codebase currently writes to
KV at all; `liveWindows.ts`'s KV-primary/R2-fallback design is real, correct code, but its documented
performance benefit is currently theoretical (every read this phase has ever observed falls through
to R2). A genuine, minor, honestly-recorded gap.

**R2/KV account-level dashboard totals: not read** — no browser/dashboard access from this automated
execution, the identical limitation plan 04-04 already recorded for its own R2 write-volume figures.
Remains an open manual step, tracked in `04-VALIDATION.md`'s Manual-Only Verifications table rather
than silently marked done.

`04-VALIDATION.md` updated to `status: validated`, `nyquist_compliant: true` — every task has an
automated verify command that was actually run, and the Manual-Only Verifications table records all
four items with their real results, including the two negative findings, plainly.

## Task Commits

1. **Task 2: The replay rig — one fixture, two proofs** — `67583bbd` (feat)
2. **Real bugs found running the rig against production (Rule 1/2)** — `68a4d1b2` (fix)
3. **Real bug: R2's onlyIf.etagDoesNotMatch and a quoted etag (Rule 1)** — `b2b3d8a5` (fix)
4. **Task 3: Measure the Worker runtime budget on the deployed Worker** — `7ced991f` (docs)

## Files Created/Modified

- `scripts/replayRig.ts` (new) — the rig: cold-start, fixture upload, manifest patch, deploy/restore,
  drive loop, freshness stats, equivalence comparison, result-file write
- `scripts/replayRig.test.ts` (new) — 16 unit tests over the rig's pure parts
- `apps/worker/test/scheduled.replay.test.ts` (new) — the CI-runnable offline equivalence proof
- `apps/worker/src/fixtureServer.ts` (new) — the fixture-serving Worker
- `apps/worker/wrangler.fixture.toml` (new) — its deploy config, custom-domain route
- `packages/ingest/tbaClient.ts` — `TbaClientContext.baseUrl`, `DEFAULT_TBA_BASE_URL`, threaded
  through every wrapper function
- `apps/worker/src/env.ts` — `Env.TBA_BASE_URL`
- `apps/worker/src/tbaPoll.ts` — `createTbaContext` passes `env.TBA_BASE_URL` through
- `apps/worker/test/tbaPoll.test.ts` — a new test asserting the base-URL override is honored
- `apps/worker/wrangler.toml` — `[vars] TBA_BASE_URL` default
- `apps/worker/src/scheduled.ts` — per-event failure now logs `{msg:"event-failed", eventKey,
  error}` (Rule 2 — was completely invisible before; see Deviations)
- `apps/worker/package.json` — `deploy:fixture` script
- `packages/harness/r2Client.ts` — `deleteObject` (Rule 3, needed for the rig's cold-start fix)
- `package.json` — `replay:rig` script
- `docs/worker-operations.md` — new "Replay rig" section
- `docs/publish-budget.md` — new "Worker runtime budget" section (Task 3)
- `.planning/phases/04-publish-live-update-pipeline/04-VALIDATION.md` — validated, nyquist_compliant
- `.planning/WINDOWS.md` — 2 new entries (see Deviations)

## Decisions Made

See `key-decisions` in frontmatter. Summary: the fixture mechanism is a second deployed Worker on
its own custom domain (not `*.workers.dev`, discovered the hard way); freshness/equivalence was
measured per-algorithm because the deployed system cannot fold all three together at all; every real
measurement in this SUMMARY used `--live-trigger cron` because `manual` was found unavailable; the
38-event worst-case fixture was built but not run live because the single-event finding already
answers the question monotonically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 — Bug + missing critical functionality] The rig's cold-start reset D1 state but not
the already-published R2 artifacts**
- **Found during:** Task 2, the rig's first real run against the deployed Worker
- **Issue:** Every corpus event has already been published once by `pnpm publish:seasons` — resetting
  D1 `algorithm_state` alone is not a cold start, because the deployed Worker's merge logic
  (`readExistingEvent`) reads the EXISTING published R2 artifact first. A freshness poll was finding
  every match "already there" from the ORIGINAL offline publish, not from anything the rig drove —
  invalidating both the freshness measurement (near-instant, meaningless) and the equivalence
  baseline (the "prior" state wasn't actually empty).
- **Fix:** `packages/harness/r2Client.ts` gained `deleteObject` (S3-compatible DELETE, idempotent on
  404); the rig now deletes the touched event's and touched teams' published artifacts before
  driving, and the offline reconstruction correspondingly starts from an empty team roster
  (symmetric with the online path now seeing nothing either).
- **Files modified:** `packages/harness/r2Client.ts`, `scripts/replayRig.ts`
- **Verification:** Re-run against the deployed Worker; freshness times became real (tens of
  seconds, matching the cron interval) instead of near-zero.
- **Committed in:** `68a4d1b2`

**2. [Rule 1 — Bug] `fetch()` from a Worker to another Worker's `*.workers.dev` URL returns 404**
- **Found during:** Task 2, deploying the fixture mechanism and observing `tbaRequests:0,
  eventsFailed:1` with a caught `TbaPollError: ... HTTP 404` despite the fixture endpoint returning
  200 to a direct `curl`
- **Issue:** Cloudflare's own `workers.dev` zone intercepts Worker-to-Worker subrequests to
  `*.workers.dev` and returns a bare 404 rather than routing to the target script — undocumented in
  this plan's own `read_first` references, discovered by running the rig for real.
- **Fix:** Added a custom-domain route to `wrangler.fixture.toml`
  (`fixture-rig.sigmascout.org`, on the same zone R2's own custom domain already uses); redeployed
  the fixture Worker with it.
- **Files modified:** `apps/worker/wrangler.fixture.toml`
- **Verification:** `curl` through the custom domain returned 200; the production Worker's own tick
  then successfully polled it (`tbaRequests:1` with a real response).
- **Committed in:** `68a4d1b2`

**3. [Rule 2 — Missing critical functionality] Per-event tick failures were completely invisible**
- **Found during:** Task 2/3, diagnosing bug #2 above — the tick itself logs `"ok":true` even when
  one event's processing throws internally, so `docs/worker-operations.md`'s own troubleshooting
  promise ("a tick throwing: read the error field") had nothing to point at for this exact case.
- **Fix:** `processEvent`'s outer `catch` now logs `{msg:"event-failed", eventKey, error}` — the
  event key and the caught error's own message only, never a secret, mirroring `TbaPollError`'s
  existing naming discipline.
- **Files modified:** `apps/worker/src/scheduled.ts`
- **Verification:** `pnpm vitest run apps/worker/test/scheduled.test.ts apps/worker/test/
  scheduled.replay.test.ts` (12/12 pass, unchanged); this log line is what surfaced bug #2's real
  cause (an HTTP 404) instead of a silent, unexplained deferral.
- **Committed in:** `68a4d1b2`

**4. [Rule 1 — Bug] R2's `onlyIf.etagDoesNotMatch` throws on a double-quoted etag**
- **Found during:** Task 2, a multi-match rig run where the FIRST match folded successfully but every
  subsequent one failed with a caught `HTTP 500` from the fixture Worker
- **Issue:** `packages/ingest/tbaClient.ts`'s real TBA client captures `res.headers.get("etag")`
  verbatim (RFC 7232's own double-quoted form) and replays it as `If-None-Match` — exactly what any
  real TBA client does. R2's `env.ARTIFACTS.get(key, {onlyIf:{etagDoesNotMatch}})` throws when handed
  that quoted form (surfaced to the caller as a bare 500/error-code-1101), and expects the bare hash
  instead. Reproduced directly via `curl` with both quoted and unquoted forms against the deployed
  fixture Worker.
- **Fix:** `fixtureServer.ts`'s `serveFixture` strips surrounding quotes from the incoming
  `If-None-Match` value before passing it to `onlyIf.etagDoesNotMatch` — never asking the real TBA
  client to send a non-standard header shape it would never send against the real TBA API.
- **Files modified:** `apps/worker/src/fixtureServer.ts`
- **Verification:** `curl` with both a bogus and a real quoted etag against the redeployed fixture
  Worker returned the correct 200/304 respectively (previously both 500'd); a subsequent full
  6-match `opr` rig run succeeded 6/6.
- **Committed in:** `b2b3d8a5`

**5. [Rule 3 — Blocking, out-of-scope] `wrangler` shelled out via `npx.cmd`/`shell:true` fails on
Windows**
- **Found during:** Task 2, the rig's first attempt to shell out to `wrangler` for the D1 reset
- **Issue:** `spawnSync('npx.cmd', ...)` without `shell: true` fails outright (`EINVAL`) on this
  Windows/Node setup; `shell: true` is a documented Node argument-injection risk this project does
  not accept for a script shelling out with operator-supplied values (event keys, URLs).
- **Fix:** Resolves wrangler's real `bin/wrangler.js` via `createRequire(import.meta.url).resolve
  ("wrangler/package.json", {paths:[WORKER_DIR]})` and spawns it via `process.execPath` directly —
  no shell involved either way.
- **Files modified:** `scripts/replayRig.ts`
- **Verification:** Every subsequent `wrangler` shell-out in this plan's real runs succeeded.
- **Committed in:** `67583bbd` (part of the initial rig; the fix landed before the first real run)

---

**Total deviations:** 5 auto-fixed (3 bugs, 2 missing-critical-functionality, all discovered running
real code against real production infrastructure, none of them things a design review would have
caught). **Impact on plan:** all five were necessary for the plan's own explicit must_haves to hold
at all (a rig that can actually reach a real deployed Worker, a cold start that is actually cold, a
fixture that survives more than one request, per-event failure visibility the operations doc already
promised). No scope creep beyond what each fix required; no architectural change made unilaterally
(the Task 3 budget finding is reported, not fixed, per Rule 4).

## Known Stubs

- **`epa`/`sigma1` solo deployed-Worker freshness runs never folded a single match within the poll
  window, and the root cause was not diagnosed within this plan's session.** `opr`'s identical rig
  (same event, same D1 cold-start mechanism, same fixture Worker, same manifest-scoping technique)
  succeeded cleanly 6/6 with `digestMatch:true`. A live `wrangler tail` capture during one `epa`
  attempt showed a genuinely caught error, `"state.componentOrder is not iterable"` — a field that
  belongs exclusively to `Sigma1State`, never `EpaState`, which is itself suspicious. An isolated
  local reproduction of `epa.predict`/`epa.update`/`epa.teamMetrics` over the SAME real match data
  (all 13 real matches of the same event's SF bracket, not just the 6-match test slice) completed
  with **zero errors**, ruling out a bug in `epa.ts` itself. The anomaly is real, reproducible on the
  deployed Worker, and NOT reproduced locally with the same algorithm code and data — logged
  honestly as unresolved rather than glossed over or fabricated a root cause for. **This does NOT
  weaken D-14's equivalence claim**: `apps/worker/test/scheduled.replay.test.ts`'s CI-runnable test
  independently proves epa/sigma1 equivalence in a fully controlled environment (all three digests
  match, every CI run), and that proof does not depend on the deployed-Worker path succeeding.
  Logged to `WINDOWS.md` (`unrun-verify`, entry 10).
- **The published `EventArtifact`'s `teams[]` array differs in ORDER (not content) between the online
  and offline reconstructions** — 44 diffs for `opr`, all positional (`$.teams[N].teamKey`/
  `teamNumber`), zero diffs in `matches[]` or any other field. The online path preserves match-touch
  order across ticks; the offline reconstruction sorts touched teams alphabetically. Reported exactly
  as computed (the exclusion list was NOT widened to hide this, per this plan's own explicit
  prohibition) — a genuine, understood, low-severity finding about array ORDERING, not a
  computational disagreement.
- **The 38-event/207-match worst-case tick fixture (`scripts/_worstCaseTick.ts`) was built, verified
  ready, and then deliberately not run live** (deleted before this plan's final commit) — the
  single-event finding already answers the question monotonically; see Task 3's Accomplishments.

Ledger entries appended to `.planning/WINDOWS.md`: `deviation` (3-algorithm budget overflow, entry
9), `unrun-verify` (epa/sigma1 deployed-run anomaly, entry 10).

## Issues Encountered

- **Real production infrastructure debugging, three rounds deep**, each requiring a live redeploy and
  a fresh `wrangler tail` observation window to confirm — the single largest time cost of this plan.
  All three (cold-start artifacts, workers.dev routing, R2 etag quoting) were genuine platform/design
  gaps this rig's own first real run was the first thing in this entire phase to actually exercise.
- **A stale `algorithms-manifest-backup.json` overwrite bug in this plan's own throwaway
  `_patchAlgorithmsManifest.ts` tool** (not committed) briefly left the REAL production algorithms
  manifest scoped to `opr` alone between two solo-algorithm test runs. Caught immediately via the
  tool's own verification read-back; fixed by regenerating the manifest directly from source
  (`buildAlgorithmsManifest`, deterministic — nothing was actually "lost") rather than trusting a
  chain of backup files. No lasting effect; confirmed via the final re-baseline's fresh manifest
  generation matching the expected `[opr, epa, sigma1]` set.
- **A background `pnpm publish:seasons` run crashed once** (Windows access-violation exit code,
  likely resource contention from the many concurrent live experiments earlier in this session) — the
  bare retry succeeded cleanly (~15 min, exit 0), and its own polling discipline (this plan's own
  mandatory background-job rule) is what caught the failure rather than assuming success.
- **Manual production redeploys and D1 mutations were performed directly** (not exclusively through
  the rig script) during live debugging — always restored to the tracked default afterward, verified
  via a final clean `wrangler deploy` (no `--var` override) and a `wrangler tail` health check
  showing an idle, healthy tick before this plan's work concluded.
- No orphaned `wrangler dev`/`tail`/`workerd` process — every `wrangler tail` invocation in this
  session used a bounded `timeout` and completed on its own.

## User Setup Required

None new. Task 1's Cloudflare OAuth session (already established) covered every real infrastructure
operation this plan performed: deploying `sigmascout-worker` and `sigmascout-fixture-rig`, D1 state
resets/reseeds, R2 object reads/writes/deletes, and the KV read-only check. `.env` was never read
directly by this executor; `scripts/replayRig.ts` uses its own `tsx --env-file=.env` invocation,
unchanged from every other credentialed script in this repo.

## Next Phase Readiness

- **The pipeline is real, deployed, and its own committed evidence is complete** — a rig exists,
  passes, and is reusable for future measurement; a CI-runnable equivalence proof exists and runs in
  every test run; the budget doc carries no `pending` cells.
- **The critical open item is NOT a code bug to fix in this phase — it is a real, measured capacity
  constraint** (all three published algorithms cannot fold together in one tick under the current
  subrequest budget) that the next phase touching the live-update path should treat as a known,
  documented, load-bearing constraint, not a surprise. Three concrete levers are named in
  `docs/publish-budget.md` for whoever picks this up.
- The `epa`/`sigma1` deployed-run anomaly (Known Stubs) is worth a focused, dedicated debugging
  session before the next live-event weekend — it did not block this plan's own equivalence claim
  (proven via the CI test instead), but it means the deployed path's real freshness has ONLY been
  confirmed for `opr`, not the other two algorithms, on the actual production Worker.
- Production is verified clean at the end of this plan: a fresh `pnpm publish:seasons` re-baseline
  (generation `bc66a947-...`) republished all artifacts and manifests, all three algorithms' D1 state
  was reseeded and read-back-verified (opr: 209 event + 3,699 team rows; epa/sigma1: 4,598 team rows
  each, matching plan 04-08's own established baseline exactly), the residual test `event_cursor` row
  was deleted, and the deployed Worker is on a clean `wrangler deploy` with no override — confirmed
  idle and healthy via a final `wrangler tail` capture.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-23*

## Self-Check: PASSED

All eight referenced files confirmed present on disk (`scripts/replayRig.ts`,
`scripts/replayRig.test.ts`, `apps/worker/test/scheduled.replay.test.ts`,
`apps/worker/src/fixtureServer.ts`, `apps/worker/wrangler.fixture.toml`,
`docs/publish-budget.md`, `docs/worker-operations.md`,
`.planning/phases/04-publish-live-update-pipeline/04-VALIDATION.md`).
All four commit hashes (`67583bbd`, `68a4d1b2`, `b2b3d8a5`, `7ced991f`) confirmed present
in `git log --oneline --all`. Production infrastructure independently re-verified clean
immediately before writing this summary: a fresh `wrangler tail` capture showed an idle,
healthy tick (`eventsConsidered:0`, no override `TBA_BASE_URL`), and a live D1 read-back
confirmed all three algorithms' row counts match plan 04-08's own established baseline.
