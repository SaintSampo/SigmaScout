---
phase: 4
slug: publish-live-update-pipeline
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-21
validated: 2026-08-23


# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `04-RESEARCH.md` § Validation Architecture. The planner fills the
> Per-Task Verification Map once task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (verified: root `package.json` devDependencies) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `pnpm test -- <path-to-test-file>` |
| **Full suite command** | `pnpm test` (root script `vitest run`; 45 existing `*.test.ts` files) |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- <touched-file>.test.ts`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green **plus** the D-21/D-23
  measured-numbers requirement satisfied (see Manual-Only Verifications)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Populated by the planner from PLAN.md task IDs. Requirement column must draw
> from DATA-03 / DATA-04 / DATA-05.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01 T1 | 04-01 | 1 | DATA-05 | T-04-SC | Package legitimacy confirmed by a human before install; not auto-approvable | checkpoint | — (blocking human checkpoint) | n/a | ⬜ pending |
| 04-01 T2 | 04-01 | 1 | DATA-03 | T-04-01 | Cloudflare credentials under hash-compare, never-print discipline | unit | `pnpm vitest run scripts/secrets-boundary.test.ts` | ✅ extends existing | ⬜ pending |
| 04-01 T3 | 04-01 | 1 | DATA-03 | T-04-04, T-04-08 | Validate-before-upload; shared leak-proof guard reachable from a Worker | unit + real round trip | `pnpm vitest run packages/harness/publish.tracer.test.ts packages/harness/replay.test.ts packages/core/isomorphic.test.ts` | ❌ W0 | ⬜ pending |
| 04-02 T1 | 04-02 | 2 | DATA-03 | T-04-11, T-04-12 | Rounding confined to the publish path; rounded pmf still a valid distribution | unit | `pnpm vitest run packages/harness/rounding.test.ts` | ❌ W0 | ⬜ pending |
| 04-02 T2 | 04-02 | 2 | DATA-03 | T-04-10, T-04-13 | Raw numbers only; every artifact stamped | unit | `pnpm vitest run packages/harness/pageArtifacts.test.ts` | ❌ W0 | ⬜ pending |
| 04-02 T3 | 04-02 | 2 | DATA-03 | T-04-09 | Scheduled-match reader carries no outcome key at all | unit | `pnpm vitest run packages/corpus/db.test.ts` | ✅ extends existing | ⬜ pending |
| 04-03 T1 | 04-03 | 2 | DATA-04 | T-04-15, T-04-16, T-04-21 | Half-open live windows; manifest rejects harness-only algorithm ids | unit | `pnpm vitest run packages/harness/manifests.test.ts` | ❌ W0 | ⬜ pending |
| 04-03 T2 | 04-03 | 2 | DATA-04 | T-04-17 | Lossless state round trip, asserted by prediction-stream digest | unit | `pnpm vitest run packages/harness/stateSnapshot.test.ts` | ❌ W0 | ⬜ pending |
| 04-03 T3 | 04-03 | 2 | DATA-05 | T-04-14, T-04-18, T-04-19 | Seed SQL escaping; per-tick bookkeeping in D1, never KV | unit | `pnpm vitest run packages/harness/stateSnapshot.test.ts` | ❌ W0 | ⬜ pending |
| 04-04 T1 | 04-04 | 3 | DATA-03 | T-04-22, T-04-25 | Zero uploads on a schema-parse failure | unit | `pnpm vitest run packages/harness/publish.test.ts` | ❌ W0 | ⬜ pending |
| 04-04 T2 | 04-04 | 3 | DATA-05 | T-04-23, T-04-24, T-04-27 | Every budget figure names the run that produced it | measured + doc check | `node -e` structure check over `docs/publish-budget.md` (see plan) | ❌ W0 | ⬜ pending |
| 04-04 T3 | 04-04 | 3 | DATA-03 | T-04-28 | Payload regression fails on the commit that causes it | unit | `pnpm vitest run packages/harness/payloadBudget.test.ts` | ❌ W0 | ⬜ pending |
| 04-05 T1 | 04-05 | 3 | DATA-05 | T-04-35, T-04-36, T-04-37 | Migration proven applied by querying the live DB, not by a green build | config check + live query | `node -e` wrangler.toml check; `wrangler d1 execute … sqlite_master` | ❌ W0 | ⬜ pending |
| 04-05 T2 | 04-05 | 3 | DATA-04 | T-04-31, T-04-32, T-04-34 | Batched read/write; all-or-nothing writes; idempotent folds | unit | `pnpm vitest run apps/worker/test/stateStore.test.ts` | ❌ W0 | ⬜ pending |
| 04-05 T3 | 04-05 | 3 | DATA-05 | T-04-29, T-04-30, T-04-33 | Boundary at the cap; no event ever starved | unit | `pnpm vitest run apps/worker/test/subrequestBudget.test.ts` | ❌ W0 | ⬜ pending |
| 04-06 T1 | 04-06 | 4 | DATA-05 | T-04-39, T-04-44, T-04-46 | One TBA client, one politeness policy; key never in an error | unit | `pnpm vitest run apps/worker/test/liveWindows.test.ts apps/worker/test/tbaPoll.test.ts` | ❌ W0 | ⬜ pending |
| 04-06 T2 | 04-06 | 4 | DATA-04 | T-04-42, T-04-44 | Validate-before-put; deferral is a normal outcome, not a throw | unit | `pnpm vitest run apps/worker/test/artifactWriter.test.ts` | ❌ W0 | ⬜ pending |
| 04-06 T3 | 04-06 | 4 | DATA-04 | T-04-38, T-04-40, T-04-41, T-04-43, T-04-45 | State before artifacts; overlapping ticks fold once; failure confined per event | unit | `pnpm vitest run apps/worker/test/scheduled.test.ts` | ❌ W0 | ⬜ pending |
| 04-07 T1 | 04-07 | 5 | DATA-05 | T-04-47, T-04-48, T-04-54 | Secret set on the Worker, never in tracked config; deploy stays manual | doc/config check + live fetch | `node -e` operations-doc check; `curl -i` through the custom domain | ✅ | ✅ green |
| 04-07 T2 | 04-07 | 5 | DATA-04 | T-04-51, T-04-53 | Offline↔online equivalence by prediction-stream digest (D-14); exclusion list of exactly two fields | integration | `pnpm vitest run apps/worker/test/scheduled.replay.test.ts scripts/replayRig.test.ts` | ✅ | ✅ green |
| 04-07 T3 | 04-07 | 5 | DATA-05 | T-04-49, T-04-50 | Figures read from Cloudflare's own reporting, worst case reported separately | measured + doc check | `node -e` completeness check over `docs/publish-budget.md` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/harness/publish.ts` + `publish.test.ts` — offline page-shaped-artifact publisher (DATA-03)
- [ ] `packages/harness/payloadBudget.test.ts` — D-05 committed payload budget file + failing test
- [ ] `apps/worker/` package scaffold — `apps/` is currently empty; framework install `pnpm add -D wrangler @cloudflare/workers-types --filter worker`
- [ ] `apps/worker/migrations/0001_team_state.sql` — D1 per-team live-state schema (D-13)
- [ ] Replay-rig driver script/test (D-20 / D-14) — no existing analog; the OFFLINE half reuses `packages/harness/replay.ts`'s `WalkForwardSimulator`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Result (plan 04-07, 2026-08-23) |
|----------|-------------|------------|-------------------|
| Peak-tick subrequest count stays under 50 | DATA-05 | Cannot be asserted without a live deploy — the subrequest cap is enforced by the Cloudflare runtime, not by any local simulator | **Measured, and the finding is negative.** The smallest real live-event case (one 3v3 match, all three published algorithms) has an `estimatedCost` of 50 against a usable budget of ~41 — it never advances at all under current production settings. The one genuine single-algorithm fold observed used 24 subrequests. See `docs/publish-budget.md`'s "Worker runtime budget" section for the full measurement and what would have to change. |
| Peak-tick CPU time stays under 10 ms | DATA-05 | Same — free-tier CPU accounting only exists on the real runtime | **Partially measured.** Idle/deferred ticks: 10–18 ms (n≈16, exceeds the documented 10 ms figure already, consistent with plan 04-08's own unresolved observation that `outcome:"ok"` returns above 10 ms in practice). The one genuine fold observed: 35 ms (n=1). The true 3-algorithm worst-case tick's CPU was never observed because it never reaches the expensive work — reported as unmeasurable, not fabricated. |
| Per-page payload sizes recorded as a committed budget | DATA-03 | Sizes are measured artifacts of a real publish run, not a green/red assertion (the *regression* against the recorded budget IS automated — see `payloadBudget.test.ts`) | Closed by plan 04-04 — see `docs/publish-budget.md`'s Payload budget section. |
| R2 / KV daily write volume inside free-tier quotas | DATA-05 | Quota consumption is an account-level Cloudflare metric | **Partially measured.** KV writes/day: 0, measured directly (nothing in this codebase currently writes to KV at all — a genuine minor gap, see the budget doc). R2/KV account-level dashboard totals: not read — this automated execution has no browser/dashboard access, the same limitation plan 04-04 already recorded for its own R2 write-volume figures. Remains an open manual step. |

> These four are "measured and recorded", not pass/fail unit tests. Per RESEARCH.md
> § Sampling Rate, they must be separately tracked plan items — the automated suite
> does **not** cover them, and treating a green `pnpm test` as satisfying Success
> Criteria 3 and 4 would be false. Two of the four (subrequest count, CPU time) are now measured
> with a NEGATIVE finding — the free-tier fit does not currently hold for a live event with all
> three published algorithms — which is reported as-is per this plan's own explicit instruction not
> to soften an over-limit figure.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] Measured-number items above recorded in the D-23 budget doc
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-08-23 (plan 04-07) — with an open, honestly-recorded negative finding:
the deployed Worker's real subrequest budget cannot currently accommodate a live event with all
three published algorithms. See `docs/publish-budget.md` for the full measurement and next steps.
