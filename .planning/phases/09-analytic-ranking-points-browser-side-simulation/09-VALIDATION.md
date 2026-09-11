---
phase: 9
slug: analytic-ranking-points-browser-side-simulation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-11
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `09-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (project-standard) |
| **Config file** | existing root/package-level Vitest config (unchanged by this phase) |
| **Quick run command** | `npx vitest run packages/core/rankingPoints` (scope to the package under edit) |
| **Full suite command** | `npx vitest run` **from repo root** |
| **Estimated runtime** | ~60–120 seconds (full suite, 167 files) |

> **Two recorded pitfalls apply to every command above.**
> 1. Never run the full suite from `apps/web` — it collects 77 files instead of 167 and hid an 8-day red CI.
> 2. Never wrap a suite in `timeout <n> pnpm <cmd>` — it swallows all output and exits 0. Use `npx vitest run` and judge by output, not exit code.

---

## Sampling Rate

- **After every task commit:** Run the package-scoped quick run for the package under edit
- **After every plan wave:** Run `npx vitest run` from repo root
- **Before `/gsd-verify-work`:** Full suite green, **plus** the D-12 byte-identical level-1 corpus-slice check, **plus** `scripts/measureRpCalibration.ts` before/after showing D-09's per-bonus acceptance bar either cleared or explicitly reverted per bonus (D-10's unconditional-ship rule)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

*Populated during planning — one row per task once PLAN.md files exist.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | — | — | N/A | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Deliverable → Test Map

| Deliverable | Behavior proving it works | Test Type | Automated Command | Exists? |
|---|---|---|---|---|
| 1 declarative contract | All 7 mechanism classes evaluate correctly, incl. the 2026 nested-threshold case | unit, hand-computed expectations (D-07) | `npx vitest run packages/core/rankingPoints/marginals.test.ts` | ❌ Wave 0 |
| 1 declarative contract | `predictThresholds` conservative-branch output BYTE-IDENTICAL to today | regression | `npx tsx packages/harness/rpConservativeBranch.ts` | ✅ exists |
| 2 `analyticRpPmf` | Pmf sums to 1; all-variance-zero case reproduces `parse`'s boolean flags | unit | `npx vitest run packages/core/rankingPoints/analyticPmf.test.ts` | ❌ Wave 0 |
| 2 `analyticRpPmf` | Existing `rules.test.ts` / `reconciliation.test.ts` pass unchanged | regression | `npx vitest run packages/core/rankingPoints` | ✅ exists |
| 3 win RP from `pRedWin` | Pmf-implied win probability equals published `pRedWin` exactly (closes F6's 0.12 p90 gap) | integration | extend `scripts/measureRpCalibration.ts` | ❌ Wave 0 |
| 3 tie RP | Tie branch reachable; predicted tie rate near the measured 1.09% base rate | unit + corpus | new case in `analyticPmf.test.ts` | ❌ Wave 0 |
| 4 marginal swap | Per-bonus Brier improves for a majority on 2023–2026, none regress (D-09) | integration, same-scorer (D-11) | `npx tsx scripts/measureRpCalibration.ts --seasons 2023-2026 --algorithm bpr`, before/after | ⚠️ scorer exists, comparison harness is the gap |
| 5 RP scorecard | Compare artifact carries RP calibration data the page renders | schema + component | new schema test + `apps/web` component test | ❌ Wave 0 |
| 6 live Worker RP | Live/offline row-shape parity on played rows (D-21) | integration | new test beside `apps/worker/test/scheduled.replay.test.ts` | ❌ Wave 0 |
| 6 live Worker RP | State-shape 12 round-trips (`withRpBeliefs`/`readRpBeliefs`) | unit | extend `packages/harness/stateSnapshot.test.ts` | ✅ file exists, new cases |
| 7 rank sim coupling | Red and blue can no longer both win the same draw | unit + regression | `npx vitest run packages/core/algorithms/simulation` | ✅ exists |
| 8 rung 1 | Field-averaged rank bands match baked output within the chosen tolerance | integration, real events | new script, mirrors `scripts/measureRewindGap.ts` | ❌ Wave 0 |
| D-12 level-1 invariance | `pRedWin`/`redScore`/`blueScore` unchanged before/after the whole phase | regression, exact equality | before/after digest over a corpus slice, `digest.test.ts` pattern | ⚠️ pattern exists, harness is the gap |

---

## Wave 0 Requirements

- [ ] `packages/core/rankingPoints/marginals.test.ts` — NB fit/CDF, Poisson-binomial convolution, erf; hand-computed expectations across the 7 mechanism classes (D-07)
- [ ] `packages/core/rankingPoints/analyticPmf.test.ts` — replaces `distribution.test.ts`'s scope
- [ ] Before/after comparison harness wrapping `measureRpCalibration.ts` for D-09's per-bonus bar (wraps, does not replace, the scorer — D-11 same-scorer rule)
- [ ] Live/offline row-shape parity test for D-21
- [ ] D-12 byte-identical level-1 regression test (before/after digest, corpus slice)
- [ ] Rung-1 measurement script comparing field-averaged rank bands to baked output on real events
- [ ] Compare-page schema + component tests for the RP scorecard

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| RP calibration scorecard reads honestly to a non-statistician | Deliverable 5 | Plain-language calibration copy is a judgment call, not an assertion (see `sketch-findings-sigmascout` → `references/simulation-and-compare.md`) | Load the Compare page locally with `VITE_ARTIFACT_ORIGIN=local`, read the scorecard cold, confirm no number implies more precision than it has |
| Live event RP survives a real tick | Deliverable 6 | Requires an actual live event; replay tests cover shape but not production CPU behavior | During the next live event, confirm played rows carry `redRpPmf`/`blueRpPmf` and `cpuTime` stays off the 10ms pin |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
