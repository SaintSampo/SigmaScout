---
status: passed
phase: 04-publish-live-update-pipeline
source: [ROADMAP.md Phase 4 Success Criteria]
started: 2026-08-23
updated: 2026-08-23
completed: 2026-08-23
---

## Current Test

none — all tests resolved. One gap (G1) accepted as a known unmeasured shape
rather than a blocker, on the user's decision: no `exceededCpu` outcome has ever
been observed, including during the live folds already performed.

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

### 3. Measured Worker CPU (`cpuTime` as reported by Workers Logs, NOT wall time) per cron invocation stays under the 10 ms free-tier limit
expected: Every cron invocation's `cpuTime` — the field Cloudflare enforces the limit against — is under 10 ms. Wall time and the tick's own `durationMs` are different quantities and do not test this criterion.
result: pass (idle path); advanced-tick shape unverified — see Gaps

measured:
- Idle tick, `cpuTime` from `wrangler tail --format json`, deployed version `cfdafca8`, two independent samples: **n=10 → median 7 ms, range 5–9, one 14 ms cold start**; **n=9 → median 7 ms, range 5–10**. Combined n=19, **zero invocations over 10 ms** apart from the single cold start.
- Wall time on the same traces: 162–212 ms — an order of magnitude above CPU, as expected for a tick dominated by awaiting I/O. Confirms the two quantities were being conflated.
- `outcome` was `ok` on every one of the 19 traces; **`exceededCpu` appeared in none**. Exceeding the limit produces Error 1102 and an `exceededCpu` outcome, so this is a positive-reporting instrument returning a negative, not merely an absence of complaints.
- The earlier "10–18 ms idle / 35 ms advanced" figures are withdrawn: they match neither `cpuTime`, `wallTime`, nor `durationMs` from the same traces and their provenance could not be reconstructed. Correction recorded in `docs/publish-budget.md`.
- The 10 ms limit itself was confirmed current against Cloudflare's docs and applies to Cron Triggers identically to HTTP-triggered Workers.

### 4. Daily write volume inside KV/R2 quotas; TBA request counts documented and within rate limits
expected: Measured write volume stays inside free-tier quotas and TBA polling is documented and considerate.
result: partial

evidence:
- TBA: **0 requests** on an idle tick (~10 months/year); **1–2 per live tick** once an event is live. Polling reuses the existing client's 100 ms spacing, ETag conditional requests and request counter unchanged (D-22) — one politeness policy, not two.
- R2 writes: ~54,671 Class-A ops per full publish, against a 1,000,000/month free allowance.
- Gap: a full live event-day extrapolation was **not performed** — no genuinely live event occurred during the measurement window. Recorded as unmeasured rather than estimated.

## Summary

total: 4
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0
partial: 1

## Gaps

### G1. The advanced (real fold) tick's CPU has never been measured against `cpuTime`
status: open
severity: low
source: Test 3

The only tick shape that does the expensive work — Phase A fold plus Phase B's
seven sequential R2 read-then-writes — has no trustworthy CPU figure. Its
recorded "35 ms" came from the same unattributable source as the withdrawn idle
range, and its 6,682 ms wall time makes it the shape where a wall-for-CPU
substitution would be largest.

Idle is settled at median 7 ms (n=19). The realistic worst case is not. It is
plausible it is fine — a sigma1 fold plus seven R2 round-trips is mostly awaited
I/O, which does not accrue CPU — but that is reasoning, not measurement, and
this phase has repeatedly found that the two diverge.

**To close:** drive one live fold through `scripts/replayRig.ts` and read
`cpuTime` off the `eventsAdvanced:1` trace. Requires temporarily pointing the
deployed Worker at the fixture Worker via `wrangler deploy --var TBA_BASE_URL:…`
and restoring tracked config afterwards, so it is a real production operation
rather than a passive observation.

**Not a blocker:** no `exceededCpu` outcome has ever been observed, including
during the live folds already performed in plan 04-07 and the quick task.
