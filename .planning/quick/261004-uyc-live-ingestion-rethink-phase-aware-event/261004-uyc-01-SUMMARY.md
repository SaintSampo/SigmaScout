---
phase: quick-261004-uyc
plan: 01
subsystem: worker live ingestion, observability
tags: [ingest-log, d1, event-phase, live-report, worker]
status: complete
requirements: [QUICK-261004-uyc]
---

# 261004-uyc plan 01: ingest log, phase model, live:report

## What was built

- **Ingest log.** Migration `apps/worker/migrations/0003_ingest_log.sql` (one table, kinds
  endpoint / match / phase / failure). `apps/worker/src/ingestLog.ts` buffers rows during a tick
  and flushes once in a `finally` with one statement binding one JSON string (`json_each`). The
  flush never throws. TBA `Last-Modified` now rides through `tbaFetch` and `pollEventMatches`;
  `post_result_time` is read from the unparsed match array. Phase B's bare `catch {}` now logs a
  `phase-b-failed` warn line and a failure row.
- **Phase model.** `apps/worker/src/eventPhase.ts` (seven phases, `deriveEventPhase`,
  `endpointsToPoll`), `liveIngestState.ts` (per-event blob stored in `event_cursor` under the
  reserved key `__live_ingest__:<eventKey>`), `liveEventPass.ts` (logs a phase row on each
  transition, prunes rows past 60 days when an event completes).
- **Report.** `pnpm live:report <eventKey>`: timeline, per-match intervals, median and worst post
  to published delay overall and per phase, endpoint Last-Modified lag, gaps, failures, phase
  spans. Flags `--from-json`, `--json`, `--prune-before YYYY-MM-DD`. Operator section added to
  `docs/worker-operations.md`.

## Commits

- `dd16247b` feat(261004-uyc): ingest log tracer, one folded match from tick to D1 to live:report
- `3ca9889f` feat(261004-uyc): event phase model, remembered across ticks, with transitions in the ingest log
- `fd3b2f17` feat(261004-uyc): live:report full report and the ingest log operator section

## Verification (executor reported)

- Root `npx vitest run`: 317 files, 7334 passed, 1 skipped, 0 failed.
- `tsc` clean for apps/worker, apps/web, e2e. Root `tsc --noEmit` has 3 errors in
  `scripts/measureChampCutoff.ts:845`, a file this plan does not touch (another session's work).

## Pins moved on purpose

- `scheduled.rp.test.ts` `SUBREQUESTS_PER_LIVE_TICK` 67 to 68 (the flush, only when rows exist).

## Deviations

1. `readOpenWindowCursors` chunks its hoisted read at 90 keys (D1's 100 parameter limit).
2. The phase pass writes the cursor row before logging the phase row, so a failed write leaves no
   phantom transition.
3. `rankingsEtag` / `alliancesEtag` fields exist as defaults only; plan 02 fills them.

## Held for the orchestrator and Jacob

- Apply migration 0003 to production D1 BEFORE the Worker deploy, then deploy the Worker.
