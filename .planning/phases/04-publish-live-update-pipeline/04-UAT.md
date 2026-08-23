---
status: testing
phase: 04-publish-live-update-pipeline
source: [ROADMAP.md Phase 4 Success Criteria]
started: 2026-08-23
updated: 2026-08-23
---

## Current Test

number: 3
name: Measured Worker CPU per cron invocation stays under the 10 ms free-tier limit
expected: |
  Every cron invocation's CPU time, read from `wrangler tail` on the deployed
  Worker, is under 10 ms.
awaiting: user response

## Tests

### 1. Full-season precompute publishes versioned artifacts for every page, with a recorded payload budget
expected: One offline command publishes compact versioned artifacts covering all five page kinds; per-page sizes are measured and committed as a budget; nothing is recomputed per request.
result: pass

evidence:
- `pnpm publish:seasons` published **54,671 objects / 2,274,047,079 bytes** across 2022–2026 × opr/epa/sigma1, plus both manifests. Reproduced byte-identical on a second run.
- Per-page measured sizes committed in `docs/publish-budget.md`: teams median 1,361,992 B / max 2,721,887 B; event median 81,358 B; team median 30,228 B / max 287,264 B; compare max 14,121 B.
- `packages/harness/payloadBudget.test.ts` fails the build if an artifact exceeds its recorded budget.
- Reads are served directly from R2 over `https://sigmascout.org` with no compute in the path (D-25); verified HTTP 200 + `Cache-Control: public, max-age=60` + ETag, and 304 on conditional re-request.

### 2. A new match result is reflected in published artifacts within ~1–3 minutes
expected: During an active event (replayed from history or live offseason), a new TBA result reaches published artifacts within ~1–3 minutes via the incremental path.
result: pass

evidence:
- Replay rig against the deployed Worker, real historical event `2026cmptx`, `--live-trigger cron` (real platform scheduling, not a manual trigger): freshness **median 58,866 ms, p95 60,875 ms, max 60,875 ms** — inside the 1–3 minute target.
- Prediction-stream digest matched between the live incremental path and the offline harness.
- Post-fix live fold confirmed on Worker version `77fca208`: `eventsAdvanced:1` on both matches, 24 then 26 subrequests.
- Scope: sigma1 only, by explicit user decision. opr/epa refresh at the manual re-baseline, not on the cron (see Gaps).
- Accepted limitation (D-20), recorded not glossed: the rig substitutes for TBA, so real TBA latency is not exercised; the cron-driven run covers platform scheduling jitter but not TBA's own response time.

### 3. Measured Worker CPU per cron invocation stays under the 10 ms free-tier limit
expected: Every cron invocation's CPU time is under 10 ms.
result: [pending]

measured:
- Idle tick (nothing live): **10–18 ms**, n≈14, all `outcome: ok`.
- Considered-then-deferred tick: **11–18 ms**, all `outcome: ok`.
- Advanced tick (one algorithm, full fold + 7 R2 writes): **35 ms**, n=1, `outcome: ok`.
- Every observed invocation exceeded 10 ms at least some of the time, and **none failed**.

### 4. Daily write volume inside KV/R2 quotas; TBA request counts documented and within rate limits
expected: Measured write volume stays inside free-tier quotas and TBA polling is documented and considerate.
result: partial

evidence:
- TBA: **0 requests** on an idle tick (~10 months/year); **1–2 per live tick** once an event is live. Polling reuses the existing client's 100 ms spacing, ETag conditional requests and request counter unchanged (D-22) — one politeness policy, not two.
- R2 writes: ~54,671 Class-A ops per full publish, against a 1,000,000/month free allowance.
- Gap: a full live event-day extrapolation was **not performed** — no genuinely live event occurred during the measurement window. Recorded as unmeasured rather than estimated.

## Summary

total: 4
passed: 2
issues: 0
pending: 1
skipped: 0
blocked: 0
partial: 1

## Gaps
