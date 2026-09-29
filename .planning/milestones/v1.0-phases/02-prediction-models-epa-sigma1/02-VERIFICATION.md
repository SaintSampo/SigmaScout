---
phase: 02-prediction-models-epa-sigma1
verified: 2026-08-14T17:20:00Z
status: passed
score: 4/4 success criteria verified (SC-2 verified with a documented, human-approved, externally-blocked sub-component)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 02: Prediction Models (EPA + Sigma1) Verification Report

**Phase Goal:** Three algorithms produce match-level predictions on the same corpus, with Sigma1 carrying honest uncertainty
**Verified:** 2026-08-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A single harness run scores OPR, EPA, and Sigma1 head-to-head across the same seasons, producing one comparable table. | ✓ VERIFIED | `reports/full-v2/artifact.json` on disk (schemaVersion 2, `algorithms: [opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf]`, seasons `[2022..2026]`, `runTimestamp: 2026-08-14T21:09:37.541Z`). Read the artifact directly with `node -e`: per-season combined-view Brier/accuracy for every algorithm matches `02-06-SUMMARY.md`'s published table to the reported precision (spot-checked all 25 rows programmatically). `reports/full-v2/report.html` (109 KB) exists. `packages/harness/report.ts` renders one head-to-head table grouped by (algorithm, season, view) with no computed deltas (D-21), verified by reading the renderer and its test file. |
| 2 | EPA runs walk-forward at any point in a season, and spot-checked teams land within a documented tolerance of published Statbotics numbers. | ✓ VERIFIED (with a documented, human-approved external-dependency exception on the tolerance sub-clause) | **Walk-forward-at-any-point half:** `02-06-SUMMARY.md`'s boundary-by-boundary adjudication (season start, mid-season, event boundary, season boundary, cold-start-season first match, single-observation team, arbitrary-index resume) is backed by real, passing tests — confirmed directly: `epa.update — event-boundary invariance (ALGO-02 checkpoint gap, D-13)` exists in `packages/core/algorithms/epa.test.ts` and passes; `carryover.test.ts`, `cli.season-carry.test.ts`, and `expandingStats.test.ts` cases named in the adjudication table were located and confirmed present. This was the one checkpoint-flagged gap (the `unclassified` ALGO-02 edge row) and it is closed, not merely asserted. **Statbotics-tolerance half:** independently re-confirmed live this session — `curl https://api.statbotics.io/v3/year/2024` returns HTTP 500 right now, matching D-14's evidence. This is recorded honestly as `open` in `.planning/WINDOWS.md` entry 2 (a `deviation`, not a defect), was the explicit subject of plan 02-06 Task 3's blocking human-verify checkpoint (resume-signal "approved" was given, per `02-06-SUMMARY.md`), and EPA's correctness instead rests on synthetic-fixture tests cross-checked against Statbotics' own published source constants (`NORM_MEAN=1500`, `YEAR_ONE_WEIGHT=0.7`, `ELIM_WEIGHT=1/3`, etc., per `sigma1-identifiability.md` §7) plus the walk-forward structural proofs. This is a legitimate, transparently-documented, already-human-adjudicated exception — not a silently-skipped criterion. |
| 3 | Sigma1 reports every team metric as a mean and variance renderable as `X ± Y` (1 standard deviation), backed by a documented identifiability check for the state dimensions it estimates. | ✓ VERIFIED | `sigma1/index.ts`'s `teamMetrics` returns a `spread` on every component including `total`; the "honest-variance" test (`teamMetrics — honest-variance check > two teams with identical means but different observed residual histories report different spread values`) exists and passes (confirmed by running it directly). `docs/models/sigma1-identifiability.md` and `packages/harness/identifiability.ts` exist; the script's committed `computeConnectedComponents` output was independently re-derived from `reports/identifiability.json` on disk and matches the doc's numbers exactly for both rank-deficient seasons (2022: rank 767/775, condition number 7.08, 7 components sized 670/48/30/18/3/3/3; 2024: rank 888/891, condition number 9.07, 3 components sized 857/31/3) — the write-up is not retyped-from-memory prose, it is reproducible from the committed script. The identifiability check honestly reports a partial negative (2022 and 2024 are not full column rank) and explains why (regional district islands + sparse-recording artifacts) without hiding or minimizing it. |
| 4 | Every match in the corpus has a predicted winner, a win probability, and predicted alliance scores for each algorithm; Sigma1's predictions additionally carry variance. | ✓ VERIFIED | Direct read of `reports/full-v2/predictions-2024.jsonl` (5 algorithm records per match; 85,145 lines / 5 = 17,029, matching the artifact's own `candidateCount: 17029` for that season exactly). A scanned prefix of 17,029 matches showed zero matches with fewer than 5 algorithm records. Spot-checked records: OPR records have no `variance` key; a Sigma1 record's `variance` field is present and numeric (`1522.55`). This directly confirms D-24's "variance present exactly where an algorithm models it, absent — not zero — where it doesn't." |

**Score:** 4/4 success criteria verified (SC-2's Statbotics-tolerance sub-clause is a formally recorded, human-checkpoint-approved external blocker, not a code gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/algorithms/epa.ts` | `AlgorithmModule<EpaState>` (ALGO-02) | ✓ VERIFIED | Exists, exports `epa`, walk-forward, D-04/D-08/D-13 divergences documented inline and match `docs/models/epa-divergences.md` |
| `packages/core/algorithms/sigma1/index.ts` | `AlgorithmModule<Sigma1State>` (ALGO-03) | ✓ VERIFIED | Exports `sigma1`, `sigma1SeasonSd`/`sigma1-seasonsd`, `sigma1NormalCdf`/`sigma1-normalcdf`, `makeSigma1`; CR-01/WR-01 fixes present (`fallbackObserved`, `foulsCommittedCarryForward`, `assertFiniteComponents`) |
| `packages/core/algorithms/breakdown/{2022..2026}.ts` | Per-season component maps (D-02) | ✓ VERIFIED | All 5 present, registered in `breakdown/index.ts`; reconciliation tests pass against the real corpus |
| `packages/harness/identifiability.ts` | SC-3's runnable check | ✓ VERIFIED | Exists, produces `reports/identifiability.json` on disk whose numbers exactly match the committed write-up |
| `docs/models/sigma1-identifiability.md` | SC-3 write-up | ✓ VERIFIED | Exists, quotes reproducible numbers, candid about the 2022/2024 rank deficiency |
| `docs/models/epa-divergences.md` | D-13's divergence record | ✓ VERIFIED | Exists, documents all 6 divergences including both the D-04 `predict()` fix and the CR-01 fallback-path fix |
| `reports/full-v2/artifact.json` + `report.html` | SC-1/SC-4 headline artifact | ✓ VERIFIED | On disk (gitignored per D-26, correctly absent from git), timestamps consistent with the documented post-fix regeneration |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `epa.ts predict()` | opponent's `foulsCommitted` | D-04 cross-alliance attribution | ✓ WIRED | Code reads `redScore = redOffensiveTotal + blueComponents[FOULS_COMMITTED_COMPONENT]?.mean` — confirmed by direct read |
| `epa.ts`/`sigma1/index.ts update()` D-05 fallback | `fallbackObserved`/`foulsCommittedCarryForward` | CR-01 fix | ✓ WIRED | Confirmed present at both call sites (git-blamed to commits `dc6b841b`, `c5975de6`), which match `02-REVIEW.md`'s resolution record exactly |
| `identifiability.ts` design matrix | `computeConnectedComponents` | Rank-deficiency attribution | ✓ WIRED | Runs automatically when `fullColumnRank === false`; output on disk reproduces the doc's numbers |
| `reports/full-v2/predictions-{season}.jsonl` | `PredictionRecordSchema` | Zod-validated JSONL sidecar | ✓ WIRED | Records parse and contain all required fields; variance present/absent per algorithm as designed |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| ALGO-02 | 02-01, 02-02, 02-03, 02-06 | EPA reimplemented, walk-forward at any point in a season | ✓ SATISFIED | `epa.ts` exists and passes its full test suite; the one checkpoint-flagged coverage gap (event-boundary invariance) is now a passing test |
| ALGO-03 | 02-02, 02-04, 02-05, 02-06 | Sigma1 produces mean+variance per team metric, X ± Y | ✓ SATISFIED | `sigma1/index.ts` + honest-variance test + identifiability check, all confirmed on disk |
| ALGO-07 | 02-01, 02-04, 02-05, 02-06 | Every match gets predicted winner/win prob/scores; Sigma predictions carry variance | ✓ SATISFIED | Confirmed via direct read of `reports/full-v2/predictions-2024.jsonl` |

No orphaned requirements: `.planning/REQUIREMENTS.md`'s traceability table maps exactly ALGO-02/ALGO-03/ALGO-07 to Phase 2, all marked `Complete`, and all three appear in at least one plan's `requirements:` frontmatter.

### Anti-Patterns Found

None blocking. Searched all phase-modified non-test files under `packages/core/algorithms`, `packages/harness`, `packages/core/scoring`, and `docs/models` for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/silent-empty-return patterns. The only hits were: (a) the word "placeholder" used exclusively in documented, deliberate cold-start-seed-constant comments (`epa.ts`, `carryover.ts`, `sigma1/index.ts`) and in `identifiability.ts`'s SQL parameter placeholders (`?` bind params, unrelated meaning) — not stubs; (b) `kalman.ts:102`'s `return []` is the explicitly-required, tested degenerate branch for an empty teammate list (all-surrogate alliance), not an unfinished implementation.

### Regression / Test Suite State

- `pnpm typecheck` — exit 0.
- `pnpm vitest run` (full suite) — 276/276 tests pass across 26 files, matching the known-context's stated baseline exactly.
- `pnpm vitest run packages/core/isomorphic.test.ts` — passes; `packages/core` (including the new `epa.ts`, `sigma1/`, `carryover.ts`, `breakdown/`) remains free of Node-only/`better-sqlite3` imports.
- Live re-check: `api.statbotics.io/v3/year/2024` returns HTTP 500 as of this verification session, confirming WINDOWS.md entry 2's evidence is not stale.

### Code Review Resolution Cross-Check

`02-REVIEW.md` recorded one critical (CR-01) and three warning-level findings from a post-execution code review. Verified directly against the codebase, not merely against the review's own "Resolution" prose:
- CR-01 (D-05 fallback misattributed `foulsCommitted`): fix code (`fallbackObserved`, `foulsCommittedCarryForward`) present in both `epa.ts` and `sigma1/index.ts`, matching commit `dc6b841b`.
- WR-01 (missing finite-value gate in EPA's fallback path): `assertFiniteComponents` call present in `epa.ts`'s `update()`, matching commit `c5975de6`.
- WR-02 (`epa_main.py` present in working tree): confirmed absent from the working tree and never committed (`git log --all -- epa_main.py` returns nothing).
- WR-03 (stale doc comment on `predictedComponentTotals`): both `epa.ts` and `sigma1/index.ts`'s doc comments now explicitly state the function is NOT interchangeable with `predict()`'s cross-attributed total.
- IN-01 (info, no functional change required): confirmed as informational-only, correctly left unaddressed by design.

The full-range artifact (`reports/full-v2/`) file timestamps (Aug 14, 14:24–17:09) postdate the fix commits, consistent with the SUMMARY's claim that the published numbers are from a post-fix regeneration, not stale pre-fix output. The regenerated Brier/accuracy figures read directly from `artifact.json` match the SUMMARY's published table to full precision.

### Human Verification Required

None. All four success criteria and their supporting must-haves were independently confirmed against artifacts on disk (source code, test runs, generated reports, a live external-dependency re-check) rather than taken from SUMMARY.md prose. The one item that would ordinarily route to human verification — SC-2's Statbotics-tolerance blocker — was already the subject of a blocking human-verify checkpoint within plan 02-06 (Task 3, gate="blocking") and received explicit approval, which this verification treats as prior human sign-off rather than re-opening it.

### Gaps Summary

No gaps found. The phase's four success criteria are all observably true in the codebase: one harness run produces one comparable multi-algorithm table (SC-1); EPA's walk-forward behavior is verified boundary-by-boundary with its one previously-flagged coverage gap now closed, and its unattainable Statbotics-tolerance sub-check is transparently documented and human-approved as externally blocked rather than silently dropped (SC-2); Sigma1's variance is provably per-team-derived and backed by a reproducible identifiability check that honestly reports a partial negative (SC-3); and every match in the corpus carries a full prediction record from every algorithm, with variance present exactly where modeled (SC-4). A critical bug found by code review (CR-01) was fixed, regression-tested, and the headline numbers were regenerated and reconciled — this verification independently confirmed the regeneration actually happened (file timestamps, numeric match against the SUMMARY table) rather than trusting the claim.

---

*Verified: 2026-08-14*
*Verifier: Claude (gsd-verifier)*
