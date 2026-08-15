---
phase: 3
slug: tuning-ranking-points-versioning
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `03-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (`package.json`) |
| **Config file** | `vitest.config.ts` — `include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"]`, `environment: "node"` |
| **Quick run command** | `pnpm test -- <touched package path>` (e.g. `pnpm test -- packages/core/algorithms/sigma1`) |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds (full suite); scoped runs a few seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- <touched package path>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite green, plus a real `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run producing the SC-3 verdict
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned when PLAN.md files are written. This table is seeded from the
> requirement→test map in `03-RESEARCH.md` and is completed by `/gsd-validate-phase`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ALGO-04 | — | N/A | integration | `pnpm tsx packages/harness/tune.ts --seasons 2022-2024` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-05 | — | N/A | integration | `pnpm test -- packages/harness/adaptation.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-06 | — | N/A | unit/integration | `pnpm test -- packages/harness/digest.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-08 | — | N/A | integration (corpus-backed) | `pnpm test -- packages/core/algorithms/sigma1/rp` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-08 | — | N/A | unit | `pnpm test -- packages/core/algorithms/sigma1/rp` (elim degenerate pmf) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SC-3 | — | N/A | integration (full-corpus) | `pnpm harness --seasons 2025-2026 --algorithm opr,epa,sigma1` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/algorithms/sigma1/params.ts` — `Sigma1Params` type (no existing file)
- [ ] `packages/core/algorithms/sigma1/rp/` — RP rule-module tree + reconciliation test (no existing files)
- [ ] `packages/harness/tune.ts` — sensitivity screen + joint search script (no existing file)
- [ ] `packages/harness/promote.ts` — version promotion + digest writer (no existing file)
- [ ] `packages/harness/digest.test.ts` — D-15 reproducibility test (no existing file)
- [ ] `.github/workflows/test.yml` — CI runner for `pnpm test` (currently absent; `deploy.yml` is a stale pre-monorepo scaffold with no test step)

*Everything else — `runSeasons` / `aggregateScores` / `WalkForwardSimulator`, the corpus schema, the `ALGORITHMS` registry — already exists and is reused unchanged.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Higher-tier RP thresholds for 2025 Coral Bonus and 2026 Energized/Supercharged at District Championship / Championship | ALGO-08 | Research confirmed tier existence but could not pin exact numeric values from a primary source (MEDIUM/LOW confidence) | Read the official 2025 and 2026 game manuals at the cited sections; confirm or correct the threshold constants before the reconciliation test is treated as authoritative |
| SC-3 shortfall decision | ALGO-04 | If tuned Sigma1 does not beat both OPR and EPA on holdout, the criterion is satisfied by an explicit recorded decision, which is a human judgement | Read the holdout comparison table; record the decision about what to change in the phase's committed results document |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
