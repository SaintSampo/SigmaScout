---
plan: 05-02
phase: 05-site-shell-navigation-browsing
status: complete
requirements-completed: [EVNT-01]
completed: 2026-08-24
---

# 05-02 Summary: Event location and calendar facts

## What was built

The five location and calendar facts the Events page filters on — real `name`, competition
`week`, `country`, `stateProv` and `districtKey` — now flow end to end from TBA through the
ingest schema, the normalizer, the corpus, the publish query and the artifact schema, and are
live in every published `events/{year}` artifact.

Before this plan, `EventsListRowSchema` declared `name` and `week`, but `publish.ts` fed `name`
the event key and hard-coded `week` to `null`, and `country`/`state_prov`/`district` were absent
from the TBA ingest schema entirely. EVNT-01's four filter dimensions had zero backing data and
NAV-03's "find an event by name" could not work against what was published.

## Key files

**Created**
- `packages/harness/r2ClientRetry.test.ts` — retry-policy tests (see Deviations)

**Modified**
- `packages/ingest/schemas.ts`, `normalize.ts`, `cli.ts` — carry the five TBA fields
- `packages/corpus/schema.sql`, `db.ts` — new columns and upsert
- `packages/harness/pageArtifacts.ts`, `publish.ts` — publish the fields
- `packages/harness/r2Client.ts` — transient-write retry (deviation)
- `docs/publish-budget.md` — re-measured events budget

## Verification

Live, against the real serving origin `https://data.sigmascout.org` (per D-17a — note the plan
text's `https://sigmascout.org/v1/...` URL is stale and now returns the site's `index.html` with
HTTP 200 and `Content-Type: text/html`):

```
v1/events/2025/sigma1@2.0.0+tuned-2026-08.json
events artifact OK, rows=350
sample: {"eventKey":"2025alhu","name":"Rocket City Regional","eventType":0,
         "isOffseason":false,"startDate":"2025-03-12","week":2,"teamCount":44,
         "matchCount":96,"playedMatchCount":96,"country":"USA","stateProv":"AL",
         "districtKey":null}
week non-null: 194/350 | district non-null: 125/350
```

All five fields present on every row; at least one row carries a district and at least one
carries `null`; at least one carries a week; no row publishes its key as its name. The
nullability split is real, not coerced — 194/350 weeks and 125/350 districts, with offseason
events correctly carrying `null`.

Corpus after refetch: 1,581 events, all with real names, 934 with a week, 1,581 with a country,
625 with a district.

Republish: 54,671 page objects plus 2 manifests, 2,274,389,691 bytes. All three D1 seed files
applied per `docs/worker-operations.md`'s re-baselining sequence.

Root `pnpm typecheck` exits 0; `vitest run` passes 65 files / 945 tests.

## Deviations

**1. Retry logic added to `packages/harness/r2Client.ts` (out of declared scope, user-approved).**

The first full republish aborted on `PUT "v1/team/frc8285/2022/opr@3.0.0+baseline.json" failed
with status 500`. `putObject` issued exactly one `fetch` with no retry, so a single transient 5xx
anywhere in a ~55,000-PUT run killed the whole publish. R2 was verified healthy either side of the
failure with a remote put/get/delete probe, confirming the 500 was transient rather than a quota
or credential problem.

`r2Client.ts` is a Phase 4 file and is not in this plan's `files_modified`. The user was asked at
an execution checkpoint and chose the durable fix over blind-retrying a 15-minute publish.

Retries 5xx, 429, 408 and network-level rejections with exponential backoff plus jitter, bounded
at 5 attempts. Permanent 4xx still fails on the first response, so a bad key or bad credentials
does not burn Class-A operations against the free-tier cap. Each attempt re-signs the request —
SigV4 embeds `x-amz-date`, so reusing one signature across a backoff window is a correctness
hazard, not a style point. Six tests cover the policy, proven non-vacuous by pinning
`PUT_MAX_ATTEMPTS` to 1 (5 of the 6 then fail). The subsequent republish completed without abort.

**2. Task 3 was completed by the orchestrator, not this plan's executor.**

The executor stalled three times in the same way: it launched the long publish as a detached
background process, then ended its turn waiting on a completion signal from a process that had
already died with its turn. Each stall left Task 3 untouched while the two code commits sat
looking complete. The orchestrator ran the publish under harness tracking instead and finished
Steps 3-5 directly.

## Issues encountered

- **`pnpm <script>` is unsafe in a worktree while sibling executors run.** An orchestrator attempt
  to run `pnpm publish:seasons` triggered pnpm 11's pre-flight dependency check, which ran
  `pnpm install`, which hit `EPERM` renaming `better-sqlite3` (file locked by a sibling worktree's
  process) and left the package half-installed and unresolvable. Repaired by copying the intact
  package from the main checkout's virtual store. Invoking `npx tsx ...` directly bypasses the
  pre-flight entirely and is the reliable form on this machine. Plan 05-04 independently hit the
  same class of problem and worked around it with `pnpm_config_verify_deps_before_run=false`.

- **The plan's own verify command hardcodes a stale host.** It names
  `https://sigmascout.org/v1/events/...`, which after D-17a returns HTML with HTTP 200 rather than
  failing cleanly — `JSON.parse` throws something misleading instead. Verification used
  `data.sigmascout.org`.

- **Secrets:** every credentialed command received its values through `tsx --env-file=.env` or an
  exported shell environment. No task read, printed, echoed or interpolated a value from `.env`,
  and no value appears in any commit message, log or this document.

## Self-Check: PASSED
