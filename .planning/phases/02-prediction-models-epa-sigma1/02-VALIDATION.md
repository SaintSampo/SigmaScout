---
phase: 2
slug: prediction-models-epa-sigma1
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-13
validated: 2026-08-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 2` from `02-RESEARCH.md` § Validation Architecture.
> Audited and bound to real task IDs by `/gsd-validate-phase 2` on 2026-08-19.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 |
| **Config file** | `vitest.config.ts` (repo root) — created in Phase 1 Task 01-01. *Corrects `02-RESEARCH.md:594`, which reported no config file exists.* |
| **Quick run command** | `pnpm vitest run <path/to/changed>.test.ts` |
| **Full suite command** | `pnpm test` (= `vitest run`) |
| **Typecheck command** | `pnpm typecheck` (= `tsc --noEmit`, strict) |
| **Measured runtime** | **7.97s wall / 9.25s test duration at 563 tests across 39 files** — measured 2026-08-19 on the post-audit suite. (Phase 1 baseline was 116 tests / ~2.5s; the phase-2 seed of this file predicted that figure before phase 2's own tests existed.) |
| **Corpus dependency** | `reconciliation.test.ts` and the T-02-04 regression read `data/corpus.sqlite` (351 MB) read-only via `openCorpusReadOnly`. Both `describe.skip` with an explicit message — never a silent pass — when the corpus is absent, so a fresh clone fails for the right reason. |

**Phase-gate command beyond the unit suite** (from RESEARCH.md § Sampling Rate) — a real multi-algorithm walk-forward run must complete without throwing before `/gsd-verify-work`:

```
pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1
```

Executed for real during plan 02-06 as a 5-algorithm × 5-season run into `reports/full-v2/` (gitignored per D-26). See `02-VERIFICATION.md` SC-1.

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <changed>.test.ts`
- **After every plan wave:** Run `pnpm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green **and** the full-range `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run completes
- **Max feedback latency:** 5 seconds (targeted run ≪ 1s; full suite measured 7.97s wall — **exceeds the 5s target**, see Sign-Off note)

---

## Per-Task Verification Map

Bound to real `02-{plan}-{task}` IDs on 2026-08-19. Every row's command was executed; all green.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 02-01-01 | 01 | 1 | ALGO-02, ALGO-07 | — | N/A | integration | `pnpm harness --season 2024 --algorithm opr,epa --out reports/tracer` | ✅ green |
| 02-01-02 | 01 | 1 | ALGO-02, ALGO-07 | — | N/A | **checkpoint (human-verify, blocking)** | — see Manual-Only | ✅ approved |
| 02-01-03 | 01 | 1 | ALGO-07 | T-02-02 | `scoreBreakdownRaw` is in `OUTCOME_KEYS`; both the `get` and `getOwnPropertyDescriptor` traps throw via one shared helper, so the two surfaces cannot drift | unit (leakage regression) | `pnpm vitest run packages/harness/replay.test.ts` *(38 tests)* | ✅ green |
| 02-01-03 | 01 | 1 | ALGO-07 | — | N/A | unit (shared-stream order) | `pnpm vitest run packages/harness/replay.multiAlgorithm.test.ts` *(5)* | ✅ green |
| 02-01-03 | 01 | 1 | ALGO-02 | — | N/A | unit (EPA two-stage EWMA, D-08 elim divergence) | `pnpm vitest run packages/core/algorithms/epa.test.ts` *(17)* | ✅ green |
| 02-01-03 | 01 | 1 | ALGO-02 | T-02-01 | Walk-forward-safe win-probability scale; no season-final statistic leaks backward (expanding-window Welford SD) | unit (leakage regression) | `pnpm vitest run packages/core/scoring/expandingStats.test.ts` *(6)* | ✅ green |
| 02-01-03 | 01 | 1 | ALGO-07 | T-02-05 | `writeArtifact`'s `secretToScrub` check survives the v2 restructure; `report.ts` escapes every artifact-sourced string | unit | `pnpm vitest run packages/harness/artifact.test.ts` *(17)* | ✅ green |
| 02-01-04 | 01 | 1 | ALGO-07 | — | N/A | integration | real 2024 replay → `reports/tracer/artifact.json`, `algorithms: [epa, opr]` | ✅ green |
| 02-02-01 | 02 | 2 | ALGO-02 | T-02-01 | Per-season Zod `.finite()` parse boundary throws rather than coercing | unit (corpus-backed, >2000 matches/season) | `pnpm vitest run packages/core/algorithms/breakdown/reconciliation.test.ts` *(32)* | ✅ green |
| 02-02-01 | 02 | 2 | ALGO-02 | **T-02-04** | `Object.create(null)` + fixed allowlist at all 6 construction sites; a poisoned `__proto__`/`constructor`/`prototype` key cannot reach `Object.prototype` | unit (prototype-pollution regression) | `pnpm vitest run packages/core/algorithms/breakdown/reconciliation.test.ts` | ✅ green **(added by this audit)** |
| 02-02-02 | 02 | 2 | ALGO-02 | **T-02-07** | 2026 reads `majorFoulCount`/`minorFoulCount` and derives `foulsCommitted` from the opponent's `foulPoints`; no `foulCount`/`techFoulCount` read exists in non-comment code | unit (grep-enforced absence) | `pnpm vitest run packages/core/algorithms/breakdown/reconciliation.test.ts` | ✅ green **(added by this audit)** |
| 02-02-03 | 02 | 2 | ALGO-02 | T-02-06 | `distributeResidual`'s all-zero branch splits uniformly rather than evaluating 0/0, so no `NaN` propagates into component means | unit | `pnpm vitest run packages/core/algorithms/breakdown/breakdown.test.ts` *(20)* | ✅ green |
| 02-03-01 | 03 | 3 | ALGO-02 | — | N/A | unit (D-16 carry shape) | `pnpm vitest run packages/core/algorithms/carryover.test.ts` *(16)* | ✅ green |
| 02-03-02 | 03 | 3 | ALGO-02 | T-02-08 | `carrySeason` only ever called with `fromSeason: season - 1` in an ascending replay; a 2022-only run is byte-identical to the 2022 portion of a 2022–2023 run | unit (backward-leak regression) | `pnpm vitest run packages/harness/cli.season-carry.test.ts` *(3)* | ✅ green |
| 02-03-03 | 03 | 3 | ALGO-02 | T-02-09 | Statbotics reference row carries `sourceLabel`/`capturedAt`/`fetched: false`; the UNVERIFIED marker is rendered loud | unit | `pnpm vitest run packages/harness/report.test.ts` *(18)* | ✅ green |
| 02-04-01 | 04 | 3 | ALGO-03 | T-02-10 | `updateAllianceSum` guards `teammates.length === 0` and `pooledVariance === 0`, returning unchanged beliefs rather than publishing `NaN` as a plausible blank `±` | unit (synthetic strength recovery) | `pnpm vitest run packages/core/algorithms/sigma1/kalman.test.ts` *(10)* | ✅ green |
| 02-04-01 | 04 | 3 | ALGO-03 | T-02-11 | `shrinkTowardDiagonal` keeps the EWMA covariance PSD over a rank-deficient residual history (Sylvester's criterion) | unit (D-03 full `1ᵀΣ1` quadratic form) | `pnpm vitest run packages/core/algorithms/sigma1/covariance.test.ts` *(8)* | ✅ green |
| 02-04-02 | 04 | 3 | ALGO-03 | — | N/A | unit (D-11 shrinkage) | `pnpm vitest run packages/core/algorithms/sigma1/consistency.test.ts` *(7)* | ✅ green |
| 02-04-02 | 04 | 3 | ALGO-03 | — | N/A | unit (D-12 three link modes, mode-2→mode-1 nesting) | `pnpm vitest run packages/core/algorithms/sigma1/linkFunctions.test.ts` *(9)* | ✅ green |
| 02-04-03 | 04 | 3 | ALGO-03 | T-02-12 | Two teams with identical means but different residual histories report **different** spreads — a regression substituting a constant spread fails rather than shipping dishonest uncertainty | unit (honest-variance) | `pnpm vitest run packages/core/algorithms/sigma1/sigma1.test.ts` *(25)* | ✅ green |
| 02-04-03 | 04 | 3 | ALGO-07 | T-02-01 | Gate 2: `assertFiniteComponents` runs on every observed component immediately before it folds into state | unit (Worker-importability) | `pnpm vitest run packages/core/isomorphic.test.ts` *(2)* · `pnpm typecheck` | ✅ green |
| 02-05-01 | 05 | 4 | ALGO-07 | T-02-02b, T-02-14 | Every JSONL record is Zod-parsed before serialization; `secretToScrub` is checked before any write, throwing first | unit (D-23/D-24/D-25 round-trip) | `pnpm vitest run packages/harness/predictions.test.ts` *(13)* | ✅ green |
| 02-05-02 | 05 | 4 | ALGO-07 | T-02-02b | Same scrub-before-write contract on the metric-history writer | unit (D-28) | `pnpm vitest run packages/harness/metricHistory.test.ts` *(8)* | ✅ green |
| 02-05-03 | 05 | 4 | ALGO-07, ALGO-03 | T-02-15 | `.gitignore` covers `data/*` and `reports/`; `git status --porcelain` stays clean after a ~620,000-row run | integration | `pnpm harness --season 2024 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --metric-history --out reports/sidecars` | ✅ green |
| 02-06-01 | 06 | 5 | ALGO-03 (SC-3) | T-02-13 | `identifiability.ts` opens the corpus through `openCorpusReadOnly` only | script | `pnpm identifiability --seasons 2022-2026 --identifiability-out reports/identifiability.json` | ✅ green |
| 02-06-01 | 06 | 5 | ALGO-03 (SC-3) | — | N/A | unit (union-find, SVD rank, seeded-shuffle determinism) | `pnpm vitest run packages/harness/identifiability.test.ts` *(22)* | ✅ green **(added by this audit)** |
| 02-06-02 | 06 | 5 | ALGO-02 | — | N/A | unit (EPA event-boundary invariance — the checkpoint-flagged gap) | `pnpm vitest run packages/core/algorithms/epa.test.ts` | ✅ green |
| 02-06-02 | 06 | 5 | ALGO-07, T-02-16 | T-02-16 | No hyperparameter, default, threshold, or variant changed in response to any full-range figure including the 2025–2026 holdout | integration | `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --out reports/full-v2` | ✅ green |
| 02-06-03 | 06 | 5 | ALGO-03 (SC-3) | T-02-09 | — | **checkpoint (human-verify, blocking)** | — see Manual-Only | ✅ approved |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Coverage:** 3/3 phase requirements (ALGO-02, ALGO-03, ALGO-07) have automated verification. 4/4 success criteria verified (`02-VERIFICATION.md`), with SC-2's Statbotics-tolerance sub-clause externally blocked and human-adjudicated — see Manual-Only.

---

## Wave 0 Requirements

Framework was already installed and green — Wave 0 here was **test-file creation only**, no tooling install. All complete.

- [x] `packages/core/algorithms/epa.test.ts` — two-stage EWMA, decaying learning rate, `k_func = -5/8`, cross-checked against Statbotics' published constants
- [x] `packages/core/algorithms/sigma1/kalman.test.ts` — synthetic-strength recovery over every k-combination of teams; variance shrinks monotonically with observation count
- [x] `packages/core/algorithms/sigma1/covariance.test.ts` — D-03's full `1ᵀΣ1` quadratic form against a hand-computed example
- [x] `packages/core/scoring/expandingStats.test.ts` — Welford recurrence plus the leakage regression
- [x] `packages/harness/replay.multiAlgorithm.test.ts` — shared-stream byte-identical match order (D-22)
- [x] `packages/harness/predictions.test.ts` — JSONL round-trip, one record per (match, algorithm), component vectors per D-24
- [x] `packages/harness/identifiability.ts` — runnable SC-3 script *(and, since this audit, `identifiability.test.ts` covering its pure functions)*
- [x] Extend `packages/harness/replay.test.ts` — `scoreBreakdownRaw` throws through the leak-proof Proxy
- [x] Extend `packages/harness/artifact.test.ts` — `ARTIFACT_SCHEMA_VERSION` 2 validates `algorithms[]` and `slices[]` tagged by `algorithmId`

**Beyond the seeded plan**, execution also produced: `breakdown/reconciliation.test.ts`, `breakdown/breakdown.test.ts`, `carryover.test.ts`, `sigma1/consistency.test.ts`, `sigma1/linkFunctions.test.ts`, `sigma1/sigma1.test.ts`, `cli.season-carry.test.ts`, `metricHistory.test.ts` — 14 new test files in total.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EPA spot-check lands within a documented tolerance of *published* Statbotics per-team numbers | ALGO-02 (SC-2) | Blocked by D-14: `api.statbotics.io` reproducibly returns HTTP 500 and the blog returns HTTP 403 — re-confirmed live on 2026-08-13, 08-14, and again at verification. No live endpoint exists to assert against, so the automated test uses a synthetic fixture and the *tolerance statement itself* is a documented claim, not an executed comparison. | Re-attempt `https://api.statbotics.io` when it returns. If live: pull 5–10 known teams across ≥2 seasons, compare EPA output, record the delta and tolerance. Until then, record the blocked state and cite D-14. Tracked in `.planning/WINDOWS.md` entry 2 as a `deviation`, not a defect. |
| Identifiability write-up is a *sound* argument, not just a script that ran | ALGO-03 (SC-3) | `identifiability.ts` can report condition numbers without those numbers actually establishing that the chosen state dimensions are separable from 3-vs-3 alliance sums. The numeric output is automatable (and, since this audit, regression-tested); the judgement that it *demonstrates* identifiability is a human read. | **Approved at the 02-06 Task 3 blocking checkpoint.** The write-up honestly reports a partial negative (2022 and 2024 are not full column rank) and attributes it to district islands + sparse-recording artifacts, without minimizing. Re-read against REBUILD_SPEC.md's "Unidentifiable model" failure-log entry if the state dimensions change. |
| Per-robot `RobotN` field ↔ `red_teams`/`blue_teams` array-position mapping | ALGO-02 / ALGO-03 | RESEARCH.md flags this `[ASSUMED]` (A1) — TBA docs were unreachable and the ordering convention was never confirmed. A wrong mapping silently misattributes per-robot components to the wrong team. | **Deferred by construction, not left open.** Per-robot fields are *forbidden* this phase and the ban is test-enforced: `reconciliation.test.ts` asserts no parsed component record has a key ending in `Robot1/2/3` for any of the five seasons. Settle the ordering empirically before any per-robot field is consumed. |
| Whether the ~58-min real-corpus run time and 395 MB/144 MB sidecar volume are an acceptable baseline | ALGO-07 | A planning judgment for Phase 3's tune sweep and Phase 4's incremental budget, not something a unit test adjudicates. Measured and reported in `02-05-SUMMARY.md` coverage D5. | Revisit if Phase 3's backtest wall-clock becomes a blocker; options are a compiled build or a narrower default sidecar scope. |
| Whether A2's independent-teams simplification costs measurable accuracy vs OPR/EPA | ALGO-03 | Synthetic fixtures prove Sigma1's math; whether the no-cross-team-covariance simplification costs accuracy is a measured question for Phase 3's backtest. | Compare Sigma1 against OPR/EPA on holdout seasons in Phase 3. |

---

## Validation Audit 2026-08-19

| Metric | Count |
|--------|-------|
| Gaps found | 4 |
| Resolved | 3 |
| Escalated | 0 |
| Documentation-only | 1 |

**Gaps found and resolved:**

1. **`packages/harness/identifiability.ts` had no test file and exported nothing** (ALGO-03 / SC-3). Its `computeConnectedComponents` union-find and `computeDesignMatrix` SVD rank pass are quoted as published fact in `docs/models/sigma1-identifiability.md`; a regression would have silently changed a published claim with nothing failing. **Resolved:** `export` added to 4 pure functions and their supporting types (additive only, no logic change — the file's existing entry-point guard means importing it does not run `main()`); new `packages/harness/identifiability.test.ts` with 22 fixture-based tests, including the load-bearing assertion that **opponents in the same match are not unioned** (only teammates sharing a row).

2. **T-02-04 prototype-pollution had no regression test.** `02-SECURITY.md:49` closed it *"— with caveat: no dedicated prototype-pollution regression test exists; the control is structural."* **Resolved:** a corpus-backed regression driving a poisoned payload through `parseBreakdown`'s real `JSON.parse` boundary (`breakdown/index.ts:74`) across all five seasons plus `fallback.ts`'s `distributeResidual` — the 6th construction site.

3. **T-02-07's grep-enforced `techFoulCount`-absence test was never written.** `02-SECURITY.md:52` closed it *"— with caveat: that specific test was not written."* **Resolved:** the test now reads `2026.ts`, strips comments, and asserts zero occurrences of `foulCount`/`techFoulCount` in executable code.

4. **Documentation gap (no test needed):** this file's Per-Task Map carried 8 `TBD`/`⬜ pending` rows naming only 5 of the 14 test files the phase shipped, and cited threat **`T-02-03`, an ID that was never assigned** (`02-SECURITY.md:71` records it as a numbering gap). The map above is rebound to real task IDs with correct threat references.

**Mutation-verified.** Each new test was confirmed to fail when its control is removed, so none is a tautology:

| Mutation | Expected failure | Observed |
|----------|------------------|----------|
| `Object.create(null)` → `{}` in `2024.ts` and `fallback.ts` | T-02-04 season-2024 row + `distributeResidual` row | ✅ both failed (`expected {…(12)} to be null`) |
| Add a real `techFoulCount` read to `2026.ts` | T-02-07 row | ✅ failed (`expected 2 to be +0`) |

> **Note on the vector.** The first draft of the T-02-04 test built its payload as an object *literal* — `{ __proto__: {...} }`. In JavaScript that is a syntactic prototype-setter that creates **no own property**, so the pollution vector was inert and the pollution assertions could not fail. The shipped test injects the poison into the raw JSON *string* and parses it, which is both the realistic path (the corpus stores `score_breakdown_raw` as text) and a live vector. `assertVectorIsLive` now asserts the own key really exists before the real assertions run, so this cannot silently regress into a tautology again.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] **Feedback latency < 5s — NOT MET.** The full suite is 7.97s wall (563 tests / 39 files), past the 5s target set when the suite was 116 tests. *Targeted* runs remain well under 1s (`reconciliation.test.ts`, the slowest single file at 32 corpus-backed tests, runs in 1.77s), and the per-task-commit sampling rate uses targeted runs — so the practical inner-loop latency is still inside budget. The full-suite figure is recorded honestly rather than restated as a pass; revisit if it approaches ~15s.
- [x] Full-range `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` completes — executed in plan 02-06 as a 5-algorithm × 5-season run
- [x] `nyquist_compliant: true` set in frontmatter

**Suite state at sign-off:** 563 tests / 39 files, all passing. `pnpm typecheck` clean.

**Approval:** validated 2026-08-19 via `/gsd-validate-phase 2`
