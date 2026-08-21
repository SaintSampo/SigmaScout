---
phase: 4
slug: publish-live-update-pipeline
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

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
| _pending planner_ | — | — | DATA-03 | — | — | unit | `pnpm test -- packages/harness/publish.test.ts` | ❌ W0 | ⬜ pending |
| _pending planner_ | — | — | DATA-03 | — | — | unit | `pnpm test -- packages/harness/payloadBudget.test.ts` | ❌ W0 | ⬜ pending |
| _pending planner_ | — | — | DATA-04 | — | — | integration | replay rig (`apps/worker/test/scheduled.replay.test.ts` or `scripts/replayRig.ts`) | ❌ W0 | ⬜ pending |
| _pending planner_ | — | — | DATA-04 | — | — | integration | same replay rig, asserting offline↔online equivalence (D-14) | ❌ W0 | ⬜ pending |
| _pending planner_ | — | — | DATA-05 | — | — | unit | extends `packages/ingest/tbaClient.test.ts` (`TbaRequestCounter`) | ✅ pattern exists | ⬜ pending |

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

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Peak-tick subrequest count stays under 50 | DATA-05 | Cannot be asserted without a live deploy — the subrequest cap is enforced by the Cloudflare runtime, not by any local simulator | Run the replay rig against a deployed Worker; read subrequest count from Workers Observability / Logpush; record the number in the D-23 budget doc |
| Peak-tick CPU time stays under 10 ms | DATA-05 | Same — free-tier CPU accounting only exists on the real runtime | Same run; read CPU-time percentiles from Workers Observability; record in the D-23 budget doc |
| Per-page payload sizes recorded as a committed budget | DATA-03 | Sizes are measured artifacts of a real publish run, not a green/red assertion (the *regression* against the recorded budget IS automated — see `payloadBudget.test.ts`) | Run the full-season publish; record per-page byte sizes into the D-05 budget file, which the automated test then guards |
| R2 / KV daily write volume inside free-tier quotas | DATA-05 | Quota consumption is an account-level Cloudflare metric | Read R2 Class-A op count and KV write count from the Cloudflare dashboard after a replay-rig day; record in the D-23 budget doc |

> These four are "measured and recorded", not pass/fail unit tests. Per RESEARCH.md
> § Sampling Rate, they must be separately tracked plan items — the automated suite
> does **not** cover them, and treating a green `pnpm test` as satisfying Success
> Criteria 3 and 4 would be false.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] Measured-number items above recorded in the D-23 budget doc
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
