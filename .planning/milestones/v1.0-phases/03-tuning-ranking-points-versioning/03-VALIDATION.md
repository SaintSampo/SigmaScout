---
phase: 3
slug: tuning-ranking-points-versioning
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-14
validated: 2026-08-18
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `03-RESEARCH.md` § Validation Architecture; per-task map completed
> by `/gsd-validate-phase` on 2026-08-18 against the 8 executed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (`package.json`) |
| **Config file** | `vitest.config.ts` — `include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"]`, `environment: "node"`, `globals: false` |
| **Quick run command** | `pnpm test -- <touched package path>` (e.g. `pnpm test -- packages/core/algorithms/sigma1/rp`) |
| **Full suite command** | `pnpm test` |
| **Typecheck command** | `pnpm typecheck` (`tsc --noEmit`, strict) |
| **CI** | `.github/workflows/test.yml` — runs `pnpm typecheck` then `pnpm test` on every push and PR (added by plan 03-06 Task 1) |
| **Measured runtime** | **10.5s** full suite (37 files, 508 tests) — well inside the 30s latency budget |

> `globals: false` — every test file imports `describe`/`it`/`expect` from `vitest` explicitly.

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- <touched package path>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite green, plus a real `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run producing the SC-3 verdict
- **Max feedback latency:** 30 seconds — **met** (10.5s measured)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01 T1–T3 | 03-01 | 1 | ALGO-04 | — | N/A | unit (executable spec) | `pnpm test -- packages/core/algorithms/sigma1/params.test.ts` | ✅ | ✅ green |
| 03-01 T1–T3 | 03-01 | 1 | ALGO-06 | — | N/A | integration (reproducibility) | `pnpm test -- packages/harness/digest.test.ts` | ✅ | ✅ green |
| 03-01 T3 | 03-01 | 1 | ALGO-04 | — | N/A | unit (D-04 carry decoupling) | `pnpm test -- packages/core/algorithms/sigma1/carryover.test.ts` | ✅ | ✅ green |
| 03-02 T1–T2 | 03-02 | 1 | ALGO-08 | — | N/A | unit (season dispatch + thresholds) | `pnpm test -- packages/core/algorithms/sigma1/rp/rules.test.ts` | ✅ | ✅ green |
| 03-02 T3 | 03-02 | 1 | ALGO-08 | — | N/A | integration (corpus-backed) | `pnpm test -- packages/core/algorithms/sigma1/rp/reconciliation.test.ts` | ✅ | ✅ green |
| 03-03 T2 | 03-03 | 2 | ALGO-08 | — | N/A | unit (threshold-variable state) | `pnpm test -- packages/core/algorithms/sigma1/rp/state.test.ts` | ✅ | ✅ green |
| 03-03 T2 | 03-03 | 2 | ALGO-08 | — | N/A | unit (joint pmf, elim degenerate) | `pnpm test -- packages/core/algorithms/sigma1/rp/distribution.test.ts` | ✅ | ✅ green |
| 03-03 T3 | 03-03 | 2 | ALGO-06 | — | N/A | unit (version identity in artifact) | `pnpm test -- packages/harness/artifact.test.ts` | ✅ | ✅ green |
| 03-04 T1–T2 | 03-04 | 3 | ALGO-05 | — | N/A | unit (adaptation mechanism) | `pnpm test -- packages/core/algorithms/sigma1/adaptation.test.ts` | ✅ | ✅ green |
| 03-04 T2 | 03-04 | 3 | ALGO-05 | — | N/A | unit (D-08 on/off bitwise identity) | `pnpm test -- packages/core/algorithms/sigma1/params.test.ts` | ✅ | ✅ green |
| 03-05 T1 | 03-05 | 4 | ALGO-04 | — | N/A | unit (search space + grids) | `pnpm test -- packages/harness/searchSpace.test.ts` | ✅ | ✅ green |
| 03-05 T2 | 03-05 | 4 | ALGO-04 | — | N/A | unit (holdout-leak gate, winner determinism) | `pnpm test -- packages/harness/tune.test.ts` | ✅ | ✅ green |
| 03-05 T3 | 03-05 | 4 | ALGO-04 | — | N/A | manual (full-corpus search) | *see Manual-Only* | — | 📋 manual |
| 03-06 T1 | 03-06 | 5 | ALGO-06 | — | N/A | integration (CI + fixture freshness) | `pnpm test -- packages/harness/digest.test.ts` | ✅ | ✅ green |
| **03-06 T2** | 03-06 | 5 | **ALGO-06** | — | N/A | **unit+integration (promoted-version resolution)** | `pnpm test -- packages/harness/promotedOverrides.test.ts` | ✅ **added 2026-08-18** | ✅ green |
| **03-06 T2** | 03-06 | 5 | **ALGO-05** | — | N/A | **unit+integration (registry on/off wiring)** | `pnpm test -- packages/harness/promotedOverrides.test.ts` | ✅ **added 2026-08-18** | ✅ green |
| 03-06 T2 | 03-06 | 5 | SC-3 | — | N/A | manual (full-corpus holdout run) | *see Manual-Only* | — | 📋 manual |
| 03-07 T1 | 03-07 | 6 | ALGO-08 | — | N/A | unit (offseason eligibility guard) | `pnpm test -- packages/core/algorithms/sigma1/rp/rules.test.ts` | ✅ | ✅ green |
| 03-07 T1 | 03-07 | 6 | ALGO-08 | — | N/A | unit (breakdown parse guard, T-03-18b/T-03-21) | `pnpm test -- packages/core/algorithms/breakdown/breakdown.test.ts` | ✅ | ✅ green |
| 03-08 T3 | 03-08 | 7 | ALGO-08 | — | N/A | unit (2025 Coral Bonus coopertition regression pin) | `pnpm test -- packages/core/algorithms/sigma1/rp/reconciliation.test.ts` | ✅ | ✅ green |

*Status: 📋 manual · ✅ green · ❌ red · ⚠️ flaky*

**Totals:** 20 mapped rows — **18 automated (green)**, 2 manual-only.

---

## Wave 0 Requirements

- [x] `packages/core/algorithms/sigma1/params.ts` — `Sigma1Params` type
- [x] `packages/core/algorithms/sigma1/rp/` — RP rule-module tree + reconciliation test
- [x] `packages/harness/tune.ts` — sensitivity screen + joint search script
- [x] `packages/harness/promote.ts` — version promotion + digest writer
- [x] `packages/harness/digest.test.ts` — D-15 reproducibility test
- [x] `.github/workflows/test.yml` — CI runner for `pnpm typecheck` + `pnpm test` (added by plan 03-06 Task 1)

*Everything else — `runSeasons` / `aggregateScores` / `WalkForwardSimulator`, the corpus schema, the `ALGORITHMS` registry — already existed and was reused unchanged.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC-3 holdout verdict: tuned Sigma1 beats both OPR and EPA | SC-3 | Requires a multi-minute full-corpus run over 2022–2026 against the local corpus + TBA data. Does not belong in a 10s CI gate, and the verdict is durably recorded rather than recomputed. | `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/tuned-v3`, then read the holdout table. **Verified 2026-08-16: SC-3 PASSES 8/8** (Brier *and* winner accuracy, both 2025 and 2026) — recorded in `docs/models/sigma1-tuning-results.md`. |
| ALGO-05 best-vs-best holdout comparison (adaptation on vs off) | ALGO-05 | The *mechanism* and the *registry wiring* are both automated (rows above). The **score comparison itself** is a full-corpus measurement, not a unit-testable property. | Same run as SC-3, comparing the `sigma1` and `sigma1-adapt` rows. **Verified 2026-08-16:** adaptation-on beats off on Brier on both holdout seasons (~0.8–2.4% relative). D-08 ships disabled by default — flagged as a named decision to revisit, not silently flipped. |
| Full-corpus joint hyperparameter search | ALGO-04 | Plan 03-05 Task 3's two equal-budget searches are an offline experiment (`reports/` is gitignored per D-14 — a search evaluation is not a version). The *search logic* is unit-tested; the *search run* is not reproducible in CI. | `pnpm tune --stage joint`. The winner is durably captured only when promoted via `pnpm promote`, which writes a committed, digest-verified version file. |
| Higher-tier RP thresholds for 2025 Coral Bonus and 2026 Energized/Supercharged at District Championship / Championship | ALGO-08 | Research confirmed tier existence but could not pin exact numeric values from a primary source (MEDIUM/LOW confidence). | Read the official 2025 and 2026 game manuals at the cited sections; confirm or correct the threshold constants. **Partially resolved by plan 03-08** — see `docs/models/sigma1-tuning-results.md` for the unconfirmed-threshold disposition. |
| SC-3 shortfall decision | ALGO-04 | If tuned Sigma1 had not beaten both baselines, the criterion is satisfied by an explicit recorded human judgement. | **Moot as of 2026-08-16** — SC-3 passed 8/8, so no shortfall decision was required. |

---

## Validation Audit 2026-08-18

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

**Gaps closed:**

1. **ALGO-06 — promoted-version resolution was entirely untested.** `applyPromotedOverrides` / `loadPromotedSigma1` / `loadSearchWinnerSigma1` (`packages/harness/cli.ts`, added by plan 03-06) are the D-13/D-14 link that makes `--algorithm sigma1` mean the *committed promoted version* rather than untuned Phase-2 defaults. `digest.test.ts` proves a promoted version reproduces its own digest but never proved the CLI **loads** it — a silent fallback to defaults would have left every digest test green while every real run scored the wrong model.
2. **ALGO-05 — harness registry wiring was untested.** The adaptation on/off *mechanism* was already covered in `params.test.ts`, but nothing asserted that the registry exposes `sigma1-adapt` and `sigma1-defaults` as genuinely distinct modules — the layer the ALGO-05 holdout comparison actually runs through.

**Test added:** `packages/harness/promotedOverrides.test.ts` (24 tests).

**Implementation change:** `packages/harness/cli.ts` — `export` keyword added to `ALGORITHMS`, `loadPromotedSigma1`, `loadSearchWinnerSigma1`, and `applyPromotedOverrides` (4 lines) solely for testability. **No logic, no behavior, and no doc comments changed.** The lazy file-resolution contract is preserved and is itself asserted by the new suite.

**Non-vacuity verified by mutation:** with `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` temporarily removed, the two override tests fail (2 failed / 22 passed) and pass again once restored — confirming they detect the exact silent-fallback regression they were written for. Assertions are made against observables (version identity, differing predict/update streams, pmf emission), never against the mere presence of an object, because `makeSigma1` closes over `params` and exposes no accessor.

**Suite after audit:** 37 files, **508 tests**, all green in 10.5s. `pnpm typecheck` clean.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a recorded Manual-Only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (10.5s measured)
- [ ] `nyquist_compliant: true` — **not set.** ALGO-04/05/06/08 are fully automated, but **SC-3 and the ALGO-05 score comparison remain manual-only by design**: both require a multi-minute full-corpus run that cannot execute in CI. Both have been *performed and recorded* (SC-3 passes 8/8), so the phase is verified — it is `PARTIAL` in the Nyquist sense rather than non-compliant.

**Approval:** validated (PARTIAL) — 2026-08-18
