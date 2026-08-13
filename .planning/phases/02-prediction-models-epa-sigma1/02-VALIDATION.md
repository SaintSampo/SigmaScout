---
phase: 2
slug: prediction-models-epa-sigma1
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 2` from `02-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is filled in by `/gsd-validate-phase` once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 |
| **Config file** | `vitest.config.ts` (repo root) — created in Phase 1 Task 01-01. *Corrects `02-RESEARCH.md:594`, which reported no config file exists.* |
| **Quick run command** | `pnpm vitest run <path/to/changed>.test.ts` |
| **Full suite command** | `pnpm test` (= `vitest run`) |
| **Estimated runtime** | ~2.5s suite duration / ~3.3s wall — measured 2026-08-13 at 116 tests across 12 files (Phase 1 baseline) |

**Phase-gate command beyond the unit suite** (from RESEARCH.md § Sampling Rate) — a real multi-algorithm walk-forward run must complete without throwing before `/gsd-verify-work`:

```
pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1
```

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <changed>.test.ts`
- **After every plan wave:** Run `pnpm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green **and** the full-range `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run completes
- **Max feedback latency:** 5 seconds (targeted run ≪ 1s; full suite measured 2.5s)

---

## Per-Task Verification Map

Task IDs do not exist until PLAN.md files are written. This table is seeded by requirement and by
the test file each requirement lands in; `/gsd-validate-phase` binds each row to a concrete
`{N}-{plan}-{task}` ID and updates Status.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ALGO-02 (SC-1) | — | N/A | integration | `pnpm vitest run packages/harness/replay.multiAlgorithm.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-02 (SC-2) | — | N/A | unit (synthetic fixture — live Statbotics comparison is D-14-blocked) | `pnpm vitest run packages/core/algorithms/epa.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-02 | T-02-01 | Walk-forward-safe win-probability scale; no season-final statistic leaks backward (expanding-window Welford SD) | unit | `pnpm vitest run packages/core/scoring/expandingStats.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-03 (SC-3) | — | N/A | unit + script | `pnpm vitest run packages/core/algorithms/sigma1/kalman.test.ts` · `tsx packages/harness/identifiability.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-03 | — | N/A | unit | `pnpm vitest run packages/core/algorithms/sigma1/covariance.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-07 (SC-4) | — | N/A | integration | `pnpm vitest run packages/harness/predictions.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALGO-07 | T-02-02 | `scoreBreakdownRaw` reaches `update()` but throws via the leak-proof Proxy if read pre-`update()` | unit (leakage regression) | `pnpm vitest run packages/harness/replay.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | ALGO-02 / ALGO-07 (D-20/D-21) | T-02-03 | Zod-validated artifact v2; secret-scrub applies to every new writer | unit | `pnpm vitest run packages/harness/artifact.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Framework is already installed and green (116/116) — Wave 0 here is **test-file creation only**, no tooling install.

- [ ] `packages/core/algorithms/epa.test.ts` — synthetic-fixture tests for the two-stage EWMA (`update_mean`/`add_obs`), `percent_func` decaying learning rate, and `k_func = -5/8`, cross-checked against hand-computed values from the verified Statbotics constants (`NORM_MEAN=1500`, `NORM_SD=250`, `INIT_PENALTY=0.2`, `YEAR_ONE_WEIGHT=0.7`, `MEAN_REVERSION=0.4`, `ELIM_WEIGHT=1/3`)
- [ ] `packages/core/algorithms/sigma1/kalman.test.ts` — synthetic-strength recovery test analogous to `opr.test.ts`'s "recovers known synthetic team strengths within a documented tolerance", extended to assert variance shrinks monotonically with observation count
- [ ] `packages/core/algorithms/sigma1/covariance.test.ts` — verifies D-03's full predictive-variance quadratic form `1ᵀΣ1` (not a diagonal sum) against a hand-computed 2×2 / 3×3 example
- [ ] `packages/core/scoring/expandingStats.test.ts` — Welford recurrence correctness plus a leakage regression asserting a later observation cannot change an earlier `standardDeviation()` result
- [ ] `packages/harness/replay.multiAlgorithm.test.ts` — `WalkForwardSimulator` driving `{opr, epa, sigma1}` over one shared stream, asserting byte-identical match order seen by all three (D-22's guarantee)
- [ ] `packages/harness/predictions.test.ts` — JSONL writer round-trip, one record per (match, algorithm), component vectors present per D-24
- [ ] `packages/harness/identifiability.ts` — a runnable script (not a Vitest file) producing the SC-3 write-up; acceptance = successful run reporting condition numbers per season per component, no crash
- [ ] Extend `packages/harness/replay.test.ts` — add a case proving `scoreBreakdownRaw` throws through the leak-proof Proxy exactly as the existing `OUTCOME_KEYS` fields do
- [ ] Extend `packages/harness/artifact.test.ts` — `ARTIFACT_SCHEMA_VERSION` 2 validates the `algorithms[]` array and `slices[]` tagged by `algorithmId`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EPA spot-check lands within a documented tolerance of *published* Statbotics per-team numbers | ALGO-02 (SC-2) | Blocked by D-14: Statbotics' public API returns HTTP 500 and its blog returns HTTP 403 (verified 2026-08-13). No live endpoint exists to assert against, so the automated test uses a synthetic fixture and the *tolerance statement itself* is a documented claim, not an executed comparison. | Re-attempt `https://api.statbotics.io` when it returns. If live: pull 5–10 known teams across ≥2 seasons, compare EPA output, record the delta and tolerance in the phase artifact. Until then, record the blocked state and cite D-14. |
| Identifiability write-up is a *sound* argument, not just a script that ran | ALGO-03 (SC-3) | `identifiability.ts` can report condition numbers without those numbers actually establishing that the chosen state dimensions are separable from 3-vs-3 alliance sums. The numeric output is automatable; the judgement that it *demonstrates* identifiability is a human read. | Read the generated report against REBUILD_SPEC.md's "Unidentifiable model" failure-log entry. Confirm it names each estimated state dimension, reports per-season per-component conditioning, and states an explicit pass/fail threshold with justification. |
| Per-robot `RobotN` field ↔ `red_teams`/`blue_teams` array-position mapping | ALGO-02 / ALGO-03 | RESEARCH.md flags this `[ASSUMED]` (A1) — TBA docs were unreachable this session and neither WebSearch nor WebFetch confirmed the ordering convention. A wrong mapping silently misattributes per-robot components to the wrong team. | Before any per-robot component feeds a rating: pick matches with a known lopsided single-robot contribution, verify positional alignment empirically against the corpus, and record the finding. Do not consume per-robot fields until this is settled. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] Feedback latency < 5s
- [ ] Full-range `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` completes — not just single-season smoke tests (per-season `score_breakdown` schema drift means a 2024-only pass can hide a 2026 failure; 2026 renames `foulCount`/`techFoulCount` to `majorFoulCount`/`minorFoulCount`)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
