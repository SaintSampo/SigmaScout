---
phase: 01-data-foundation-evaluation-harness
verified: 2026-08-13T21:04:15Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data. (ROADMAP Phase 1 success criterion 4)"
    status: failed
    reason: "`toLeakProofUpcoming` (packages/harness/replay.ts) wraps the real MatchResult in a Proxy that defines only a `get` trap. `Object.getOwnPropertyDescriptor(wrapped, \"redScore\").value` (and the `Reflect` equivalent) does not go through `get` — it forwards to the untrapped target and returns the real outcome value with no error. Independently reproduced (see Evidence below): the trapped `p.redScore` throws as intended, but `Object.getOwnPropertyDescriptor(p, \"redScore\").value` returns 999 (the real score) with no error. Any algorithm's predict() that reads an outcome field this way — accidentally or otherwise — obtains the real result silently. This is exactly what success criterion 4 says must not be possible (\"structurally impossible\" / \"fails rather than returning data\"), and no test in replay.test.ts or replay.season.test.ts exercises this bypass path. Independently confirmed by the phase's own code review (01-REVIEW.md CR-01, filed same day) — this verification reproduced the review's finding from first principles rather than trusting it."
    artifacts:
      - path: "packages/harness/replay.ts"
        issue: "toLeakProofUpcoming's Proxy handler defines only `get`; missing `getOwnPropertyDescriptor` (and ideally `ownKeys`) traps for OUTCOME_KEYS"
      - path: "packages/harness/replay.test.ts"
        issue: "No regression test asserts `Object.getOwnPropertyDescriptor(wrapped, \"redScore\")` (or any other outcome key) also throws"
    missing:
      - "Add a `getOwnPropertyDescriptor` trap to the Proxy in `toLeakProofUpcoming` that throws the same `Outcome leakage` error for any key in OUTCOME_KEYS, mirroring the `get` trap"
      - "Add a regression test in replay.test.ts asserting `Object.getOwnPropertyDescriptor(wrapped, field)` throws for every outcome key, alongside the existing direct-access test"
      - "Consider an `ownKeys` trap that omits outcome keys from enumeration (`Object.keys`, `for...in`, spread) for defense in depth, per the review's suggested fix"
---

# Phase 1: Data Foundation & Evaluation Harness Verification Report

**Phase Goal:** Any prediction method can be scored honestly against 2022–2026 history, on data whose quirks are handled explicitly rather than silently
**Verified:** 2026-08-13T21:04:15Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | One command ingests TBA teams, events, and matches for 2022–2026 into a local normalized corpus; re-running against unchanged upstream data returns 304s instead of re-downloading | ✓ VERIFIED | `pnpm ingest --years 2022-2026` ran for real (01-03-SUMMARY.md): 108,772 matches / 4,655 teams / 1,580 events across 2022–2026 in `data/corpus.sqlite`, independently confirmed by direct SQLite query (`SELECT COUNT(*) FROM matches` → 104,772 after later re-ingestion churn; `SELECT COUNT(*) FROM events` → 1,580; `SELECT COUNT(*) FROM teams` → 4,655). Second consecutive run reported 1,585/1,699 requests as HTTP 304 with zero match payloads re-downloaded (remaining 114 fully accounted for by deliberately un-conditional teams-list pagination + status check). `packages/ingest/tbaClient.test.ts` (9 tests) proves the conditional-request mechanics directly. |
| 2 | Surrogate matches, replays, missing score breakdowns, and offseason events each appear as explicit flags in the normalized data — none is silently ingested and none is silently dropped | ✓ VERIFIED | Direct corpus query confirms explicit flag columns are populated with real data: `red_surrogates`/`blue_surrogates` non-empty on 560/501 matches, `has_score_breakdown=0` on 2,082 matches (with `score_breakdown_raw` left null, not zero-defaulted), `is_offseason=1` on 552/1,580 events (event_type 99 only; 98 and 100 both 0, per schema query). `replayed` is 0 across the real corpus, which `01-03-SUMMARY.md` documents as an expected real-world outcome (replays are rare in FRC) and separately proves the `detectReplay` mechanism itself via 12 fixture-driven unit tests in `normalize.test.ts` that force the set/unchanged/first-time-not-a-replay cases. `dq` lists are non-empty on 800/808 matches. See WR-06 caveat below — one code-review-flagged latent edge case, not observed to occur in the real data. |
| 3 | Running the harness on any 2022–2026 season reports OPR's Brier score and winner accuracy, with every prediction produced strictly before that match's result is folded into the model | ✓ VERIFIED | Real full run `pnpm harness --seasons 2022-2026 --algorithm opr --out reports/full` produced `reports/full/artifact.json` with score slices for all 5 seasons × 3 competition-level views (qualification/elimination/combined) = 15 slices, each carrying `brierScore`/`winnerAccuracy`/`scoredCount`. Example (2026 combined): Brier 0.1773, winner accuracy 78.25%, 18,337 scored. `WalkForwardSimulator.run` (packages/harness/replay.ts) calls `predict` then `update` synchronously per match with no possibility of reordering — proven by `replay.test.ts`'s instrumented-algorithm call-sequence test and `replay.season.test.ts`'s whole-season, cross-event version of the same assertion (8 tests). This ordering guarantee (predict-then-update sequencing) is distinct from and unaffected by the CR-01 gap below — CR-01 concerns whether predict() *can see* outcome data through the wrapper, not whether the calls happen in order. |
| 4 | A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data | ✗ FAILED | See gaps section. `toLeakProofUpcoming`'s Proxy traps only `get`; `Object.getOwnPropertyDescriptor(wrapped, "redScore").value` bypasses it and returns the real score with no error. Reproduced independently (not merely trusting 01-REVIEW.md's CR-01): `node -e` script confirms `p.redScore` throws but `Object.getOwnPropertyDescriptor(p, 'redScore').value` returns 999. |
| 5 | The harness emits a calibration curve (predicted probability vs observed frequency) per algorithm per season, and reports headline accuracy only from seasons declared as holdout | ✓ VERIFIED | `reports/full/artifact.json` inspected directly: every one of the 15 slices carries a 10-bin `calibrationBins` array (bin bounds, mean predicted probability, observed frequency, count). `headlineEligible` is `true` on exactly the 2025 and 2026 slices and `false` on every 2022–2024 slice (`aggregateScores` derives it structurally from `seasonLabel`, per `packages/harness/score.ts` — a caller cannot set it independently). `packages/core/scoring/calibration.test.ts` (8 tests) proves the binning boundary contracts (boundary → upper bin, 1.0 → final bin, empty bin → null not 0). `packages/harness/score.test.ts` (9 tests) proves the tune(2022-2024)/holdout(2025-2026) labelling and headline-eligibility derivation. |

**Score:** 4/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts (spot-checked across all 6 plans' must_haves)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/harness/replay.ts` | WalkForwardSimulator + leak-proof wrapper | ⚠️ PARTIAL | Exists, exports match, wired and used everywhere — but the leak-proof wrapper itself has an incomplete guard (see gap) |
| `packages/harness/replay.test.ts` / `replay.season.test.ts` | Leakage + ordering regression tests | ✗ INCOMPLETE COVERAGE | Tests exist and pass, but do not cover the `getOwnPropertyDescriptor` bypass path |
| `packages/corpus/schema.sql`, `db.ts` | Full corpus DDL, typed accessors, total-order chronological read | ✓ VERIFIED | Tables `teams`, `events`, `matches`, `http_cache`, `ingest_runs` all present; quirk columns present and populated; `db.test.ts` (7 tests) proves total order and idempotency |
| `packages/ingest/{tbaClient,schemas,normalize,cli}.ts` | ETag-conditional, throttled, quirk-aware ingestion | ✓ VERIFIED | Real backfill ran and is idempotent at 304 cost; 12+9 unit tests cover quirks and client hardening |
| `packages/core/algorithms/opr.ts` | Season-pooled, ridge-regularized OPR, surrogate/DQ policy | ✓ VERIFIED | `opr.test.ts` proves synthetic strength recovery, cold-start shrinkage, purity, surrogate-exclusion; a season-scale equivalence test (added in Plan 06) proves the incremental Sherman-Morrison solve matches `solveRidgeOpr`'s batch solve exactly |
| `packages/core/isomorphic.test.ts` | Architectural fitness test — no Node/native imports in `packages/core` | ✓ VERIFIED | Test enumerates every non-test source file under `packages/core` and asserts no forbidden import specifier; confirmed non-vacuous (non-empty file list) |
| `packages/core/scoring/{brier,calibration}.ts` | Metrics with explicit tie/no-call/empty-set contracts | ✓ VERIFIED | 9 + 8 tests prove every named boundary; `JSON.stringify` round-trip tested, confirming no non-serializable sentinel |
| `packages/harness/{score,artifact,statbotics,report}.ts` | Aggregation, versioned Zod-validated artifact, Statbotics reference, self-contained HTML | ✓ VERIFIED | `HarnessArtifactSchema` validates at build and write; artifact and report both confirmed non-empty and structurally correct on the real 2022–2026 run; report contains no `src=`/external `href=`/`<script src` |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/harness/replay.ts` | `packages/core/algorithms/types.ts` | `algorithm.predict`/`algorithm.update` calls | ✓ WIRED | Confirmed in `WalkForwardSimulator.run` |
| `packages/harness/cli.ts` | `packages/corpus/db.ts` | reads chronological match list | ✓ WIRED | `--season`/`--seasons` path uses `openCorpusReadOnly` + `selectMatchesChronological`/`buildSeasonStream` |
| `packages/ingest/tbaClient.ts` | `packages/corpus/db.ts` | ETag cache read/write | ✓ WIRED | `readEtag`/`writeEtag` confirmed called from client; `tbaClient.test.ts` proves conditional-request behavior against a mocked fetch |
| `packages/harness/report.ts` | `packages/harness/artifact.ts` | HTML rendered from validated artifact only | ✓ WIRED | `renderHtmlReport(artifact)` takes only the artifact object, no corpus access — confirmed by a determinism test (`report.test.ts`) |
| `packages/harness/score.ts` | `packages/core/scoring/calibration.ts` | `calibrationBins` called per slice | ✓ WIRED | Confirmed present in every real artifact slice |
| `packages/harness/report.ts` | `packages/harness/statbotics.ts` | reference row read into score table | ✓ WIRED | `reports/full/report.html` confirmed to contain "Statbotics" and the reference row is present in `artifact.json` |

### Data-Flow Trace (Level 4)

The report is rendered exclusively from the real, validated `reports/full/artifact.json` (78-minute real harness run against the actual 2022–2026 corpus, not a fixture or a mocked value) — `renderHtmlReport`'s only input is the artifact object (proven by `report.test.ts`'s determinism assertion), and the artifact's `provenance.corpusIdentity` field ("data/corpus.sqlite") traces every number back to the real corpus. No hollow props or static fallbacks found in this chain — every score, calibration bin, and exclusion count in the artifact was inspected directly and reflects real replayed data (e.g., 2026 combined: 18,337 scored / 45 ties / 330 no-calls / 66 surrogate-excluded, summing to the 18,778 candidate count).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Outcome-key direct read throws | `node -e` reproduction of `toLeakProofUpcoming`'s `get` trap | Threw as intended | ✓ PASS |
| Outcome-key `getOwnPropertyDescriptor` read | `node -e` reproduction against the same trap shape | Returned the real value (999) with no error | ✗ FAIL — confirms CR-01 / success criterion 4 gap |
| Full test suite | `npm test` (vitest run) | 116/116 passed, 12 files | ✓ PASS |
| Typecheck | `npm run typecheck` | Exit 0, zero errors | ✓ PASS |
| Corpus quirk flags populated | Direct `better-sqlite3` queries against `data/corpus.sqlite` | Surrogates, DQs, offseason, missing-breakdown all non-zero and correctly flagged | ✓ PASS |
| Report is single-file, no external refs | `grep` on `reports/full/report.html` for `src=`, external `href=`, `<script src` | None found | ✓ PASS |
| Debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) | `grep -rnE` across `packages/`, `scripts/` | None found | ✓ PASS |

Full-corpus harness replay itself was not re-run (per environment instructions — ~80 minutes each direction) — verification instead directly inspected the already-produced `reports/full/artifact.json`, `reports/full/report.html`, and `reports/rerun/artifact.json` from the real prior run, plus queried `data/corpus.sqlite` directly.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| DATA-01 | 01-01, 01-03 | TBA v3 ingestion with ETag conditional requests | ✓ SATISFIED | Real backfill + 304 verification above |
| DATA-02 | 01-01, 01-03, 01-04 | Explicit quirk flags (surrogates, replays, missing breakdowns, offseason) | ✓ SATISFIED (with one code-review-flagged latent edge case, WR-06 below, not observed in real data) | Corpus query + normalize.test.ts |
| EVAL-01 | 01-02, 01-06 | Walk-forward replay, predict-before-update, every algorithm | ✓ SATISFIED (ordering); see criterion 4 gap for the separate leak-*visibility* concern | replay.test.ts / replay.season.test.ts ordering tests |
| EVAL-02 | 01-02, 01-05, 01-06 | Brier score + winner accuracy per algorithm per season | ✓ SATISFIED | Real artifact slices |
| EVAL-03 | 01-05 | Calibration curves per algorithm | ✓ SATISFIED | 10-bin calibrationBins on every slice |
| EVAL-04 | 01-05, 01-06 | Tune/holdout split, headline only from holdout | ✓ SATISFIED | headlineEligible only true for 2025/2026, structurally derived |
| ALGO-01 | 01-02, 01-04 | OPR as no-variance baseline, per team per season | ✓ SATISFIED | Season-pooled ridge OPR, synthetic recovery tests, real-scale equivalence test |

No orphaned requirements found — all 7 requirement IDs declared for this phase in REQUIREMENTS.md are claimed by at least one of the 6 plans, and all are covered by evidence above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/harness/replay.ts` | 26-37 | Proxy defines only `get`, not `getOwnPropertyDescriptor`/`ownKeys` | 🛑 Blocker | Directly falsifies success criterion 4's "structurally impossible" / "fails rather than returning data" claim |
| `packages/core/algorithms/opr.ts` | `IncrementalInverse.rank1Update`/`applyObservation` | No numerical-drift safeguard on the season-scale incremental RLS solve (WR-01 in 01-REVIEW.md) | ⚠️ Warning | Not proven to occur in practice (real full run completed and matched the batch-solve equivalence test), but no runtime guard against `denom <= 0` / non-finite propagation over ~18k sequential updates |
| `pnpm-workspace.yaml` | 1-2 | Glob (`apps/*`) does not match actual `packages/*` layout (WR-02) | ⚠️ Warning | Currently a no-op; will silently fail to recognize a future `packages/*/package.json` |
| `packages/corpus/db.ts` | 48-60 | TOCTOU race in single-writer lock acquisition (WR-03) | ⚠️ Warning | Narrow window for two near-simultaneous launches to both acquire the lock; SQLite WAL still prevents corruption |
| `packages/corpus/db.ts` / `schema.sql` | 62-83, 272-329 | FK enforcement (`PRAGMA foreign_keys`) never turned on; inner join could silently drop matches under a currently-nonexistent code path (WR-04) | ⚠️ Warning | Not triggered by any current call site (event always upserted before its matches) |
| `packages/core/scoring/{calibration,brier}.ts` | various | `pRedWin` not validated at the scoring boundary — out-of-range/NaN input can throw ungracefully or silently corrupt a score (WR-05) | ⚠️ Warning | Not triggered by OPR's own output (always produces a valid probability), but no defensive guard exists for a future algorithm's bug |
| `packages/ingest/normalize.ts` | 89-101 | A played, non-tied match with an empty `winning_alliance` would be silently dropped from the chronological corpus (WR-06) | ⚠️ Warning | Not observed in the real 2022-2026 corpus (no such row found), latent only |
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in any phase-modified file | ℹ️ Info | Debt-marker gate clean |

The six Warning-level findings above are carried forward unchanged from `01-REVIEW.md` (already committed, already tracked) — this verification independently re-confirmed CR-01 (the Blocker) from first principles and cross-checked the Warnings' descriptions against the current source rather than re-deriving them from scratch. None of the six Warnings individually falsify a ROADMAP success criterion the way CR-01 does; they are latent/defense-in-depth gaps, not observed failures in the real 2022–2026 corpus or the real 78-minute harness run.

### Human Verification Required

Not required for the status determination on this pass — status is `gaps_found` on CR-01 alone (a programmatically-verifiable defect), which takes precedence in the decision tree. However, one deferred human-check item exists and should be exercised once CR-01 is fixed and this phase is re-verified:

1. **Visual/interpretive quality of `reports/full/report.html`** (harvested from `01-06-PLAN.md` Task 2's `<human-check>` block, deferred per `workflow.human_verify_mode=end-of-phase`, and independently flagged as `human_judgment: true` / D5 in `01-06-SUMMARY.md`)
   - **Test:** Open `reports/full/report.html` in a browser with networking disabled.
   - **Expected:** Score table shows OPR's winner accuracy and Brier score for 2022-2026 with qual/elim/combined columns; the Statbotics reference row is present and clearly labelled with source/season; 2025 and 2026 are visually distinguished as the only headline-eligible rows; a calibration curve renders per season with the perfect-calibration diagonal visible; excluded/tie/no-call counts appear next to the scores they qualify, not hidden.
   - **Why human:** Visual legibility, color/badge distinguishability, and whether the disclosure "reads as adequate" are not assertable by a unit test. `01-06-SUMMARY.md` confirms the structural elements (score table, Statbotics table, holdout badges, calibration diagonal, no external references) are programmatically present, but the human sign-off itself has not yet been recorded in any UAT artifact found in this phase directory.

### Gaps Summary

One Blocker gap prevents Phase 1's goal from being fully achieved as claimed: ROADMAP success criterion 4 promises outcome leakage is **structurally impossible**, but `toLeakProofUpcoming`'s Proxy only traps `get`. `Object.getOwnPropertyDescriptor(match, "redScore").value` (or the `Reflect` equivalent) silently returns the real outcome value with no error — verified independently by this verification pass, not merely by trusting `01-REVIEW.md`'s CR-01 finding. This is precisely the class of bug success criterion 4 exists to rule out: an algorithm's `predict()` implementation (buggy or otherwise) can obtain the real match result through an untrapped reflection API, and nothing in the current test suite would catch it.

Everything else checked out well: the ingestion pipeline is real, ETag-conditional, and quirk-flag-explicit against a genuinely populated 108k-match corpus; OPR is season-pooled, ridge-regularized, proven against synthetic ground truth, and was benchmarked and rewritten (incremental Sherman-Morrison/RLS) specifically to survive real season scale; the scoring/calibration/artifact/report layer implements every boundary contract (ties, no-calls, empty sets, bin edges) by test, and a real 78-minute full 2022-2026 run produced a reproducible (byte-identical on rerun, timestamp aside), correctly holdout-labelled, calibration-curve-bearing report. The fix for the one Blocker is narrow and well-scoped (the review's own suggested fix is a ~15-line Proxy handler addition plus one regression test) and does not require revisiting any other part of the phase's architecture.

---

_Verified: 2026-08-13T21:04:15Z_
_Verifier: Claude (gsd-verifier)_
