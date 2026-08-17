---
phase: 03-tuning-ranking-points-versioning
verified: 2026-08-17T00:30:00Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Every match has predicted ranking points with variance for both alliances, using the correct RP rules for its season, verified against the official 2022–2026 game manuals."
    status: failed
    reason: "Two independent problems, both confirmed directly against the codebase rather than taken from SUMMARY.md claims. (1) A real, live-reproduced crash: Sigma1's shipped `update()`/`predict()` RP path calls `eventTierFor()`/`ruleModule.parse()`/`ruleModule.predictThresholds()` unconditionally on `result.eventType`/`match.eventType`, with no guard for an unmapped event type. `eventTierFor` throws by design for TBA `event_type: 99` (offseason). Two documented, supported CLI invocations reach this with real data: `pnpm harness --season <Y> --algorithm sigma1 --include-offseason` and `pnpm harness --event <offseasonEventKey> --algorithm sigma1`. I wrote and ran a standalone reproduction test (`sigma1.update()` on a synthetic offseason match with a real score breakdown) and confirmed it throws an uncaught exception rather than predicting or gracefully skipping — this is not merely the code-review's static finding (03-REVIEW.md CR-01), it is empirically confirmed against the current tree. This means 'every match' is false for the offseason-match category reachable via documented, supported harness usage: the run crashes entirely rather than producing a (skipped or predicted) result for that match. (2) The 'verified against the official 2022–2026 game manuals' clause is not fully met: `packages/core/algorithms/sigma1/rp/2025.ts` (Coral Bonus championship-tier threshold, converged to 7) and `packages/core/algorithms/sigma1/rp/2026.ts` (Energized/Supercharged District-Championship/Championship thresholds, converged to 240/360 and 360/500) are explicitly commented in the source as 'corpus-converged this session ... should still be confirmed against the official manual' — the manual-confirmation step was never performed, by the plan's own record (03-02-SUMMARY.md, `docs/models/sigma1-tuning-results.md`'s own Open Items). A separate, related modeling gap (03-03-SUMMARY.md coverage.D6): three bonuses (2023 sustainabilityBonus, 2024 melodyBonus, 2025 coralBonus/autoBonus) are predicted at a conservative branch because `RpThresholdVariable`'s design does not track the alliance-level gating signal their real achievement condition depends on — predicted probability is systematically understated for these, a known and documented but unresolved limitation."
    artifacts:
      - path: "packages/core/algorithms/sigma1/index.ts"
        issue: "update() (RP fold branch, ~line 800-807) and predict() (rpPmfForMatch call, ~line 671-685) call into the RP rule modules with no `isRpEligibleEventType`-style guard; no such guard function exists anywhere in the codebase (confirmed via grep)."
      - path: "packages/core/algorithms/sigma1/rp/2025.ts"
        issue: "Coral Bonus championship-tier threshold (7) is corpus-converged, not manual-confirmed (source comment admits this directly)."
      - path: "packages/core/algorithms/sigma1/rp/2026.ts"
        issue: "Energized/Supercharged District-Championship/Championship thresholds are corpus-converged, not manual-confirmed (source comment admits this directly)."
    missing:
      - "A guard (e.g. `isRpEligibleEventType`) in `sigma1/index.ts`'s `update()` and `predict()` that no-ops the RP fold/pmf step for an unmapped `eventType`, mirroring the existing `usedFallback`/`compLevel !== \"qm\"` skip pattern — 03-REVIEW.md CR-01 already specifies the fix and a regression test to add."
      - "Opening the actual official 2025 and 2026 FRC Game Manual PDFs to confirm the two corpus-converged thresholds (2025 Coral championship tier = 7; 2026 Energized/Supercharged DCMP/Champs = 240/360 and 360/500), or recording a decision to accept the corpus-converged values without manual confirmation."
      - "A decision (not necessarily a fix, but a recorded one) about the three conservative-branch-understated bonuses (2023 sustainability, 2024 melody, 2025 coral/auto) before treating ALGO-08/SC-4 as fully closed — 03-03-SUMMARY.md already recommends this as a follow-up plan."
human_verification:
  - test: "Open the official 2025 FRC Game Manual (§6.5.4 / Table 6-2) and confirm the Coral Bonus championship-tier per-level count threshold is 5 (not 7, the corpus-converged value currently shipped in `rp/2025.ts`)."
    expected: "Manual text matches the shipped constant, or the shipped constant is corrected/flagged."
    why_human: "Requires reading the actual official PDF/HTML manual, not inferable from the corpus or code."
  - test: "Open the official 2026 FRC Game Manual (§6.5.3 / Tables 6-4/6-5) and confirm the Energized/Supercharged District-Championship and Championship thresholds (240/360, 360/500) shipped in `rp/2026.ts`."
    expected: "Manual text matches the shipped constants, or they are corrected/flagged."
    why_human: "Requires reading the actual official PDF/HTML manual, not inferable from the corpus or code."
---

# Phase 3: Tuning, Ranking Points & Versioning Verification Report

**Phase Goal:** Sigma1 is tuned reproducibly, proven against baselines on holdout seasons, versioned, and predicting ranking points under each season's rules
**Verified:** 2026-08-17
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP.md Success Criterion) | Status | Evidence |
|---|---------------------------------------|--------|----------|
| 1 | An offline optimizer searches Sigma1's hyperparameters against backtest score on tune seasons and writes the winning configuration as a named, reproducible algorithm version. | ✓ VERIFIED | `packages/harness/tune.ts`/`searchSpace.ts` implement a two-stage screen+joint search with a structural holdout-blindness gate (`HOLDOUT_SEASONS` check pre-read, `seasonSplit` re-check, post-scoring `assertNoHoldoutLeak`); `packages/harness/promote.ts` writes a validated, digest-bearing version file. `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` exists with full `provenance` (search artifact, seed, evals, survivors, LOSO summary). |
| 2 | The harness reports adaptation-on vs adaptation-off holdout scores side by side, showing whether within-season adaptation actually improves predictions. | ✓ VERIFIED | `packages/harness/cli.ts`'s `ALGORITHMS` registry carries both `sigma1` (off) and `sigma1-adapt` (on) as first-class entries, built from two equal-budget joint searches (confirmed identical `evals: 60`, `seed: 42`, `seasons: [2022,2023,2024]` per `docs/models/sigma1-tuning-results.md`). `reports/tuned-v3/artifact.json` (present on disk, independently re-read by this verification) contains both algorithms' 2025/2026 combined-view Brier and winner-accuracy rows, matching the published table exactly. Adaptation-on beats adaptation-off on Brier both seasons; accuracy is mixed — reported honestly as such. The promotion decision (whether to flip the shipped default) is explicitly left open, which the truth's wording ("showing whether ... improves") does not require to be resolved. |
| 3 | Sigma1's holdout Brier score and winner accuracy beat both OPR and EPA — or the shortfall is recorded with an explicit decision about what to change. | ✓ VERIFIED | Independently re-read `reports/tuned-v3/artifact.json` (real run present on disk, `runTimestamp: 2026-08-17T01:11:06.668Z`) and confirmed its `sigma1`/`opr`/`epa` combined-view 2025/2026 rows match `docs/models/sigma1-tuning-results.md`'s Holdout Head-to-Head table exactly (e.g. 2025 sigma1 Brier 0.16119088.../accuracy 0.76565679... vs. table's 0.1612/0.7657). All 8 of SC-3's literal Brier+accuracy comparisons pass. The promoted version's `provenance.objective` (0.17076606538105618) matches the doc's claimed mean tune-season Brier to full precision — an internal consistency check that holds. |
| 4 | Every match has predicted ranking points with variance for both alliances, using the correct RP rules for its season, verified against the official 2022–2026 game manuals. | ✗ FAILED | See `gaps` above. A live-reproduced crash in the shipped `update()`/`predict()` path breaks "every match" for offseason matches reached via documented CLI usage; two RP thresholds are corpus-converged, not manual-confirmed; three bonuses are predicted at a known-conservative (understated) branch. |
| 5 | Re-running any past algorithm version reproduces that version's metrics and predictions unchanged. | ✓ VERIFIED | `packages/harness/digest.test.ts` re-runs each committed version against its recorded slice (corpus when present, else the committed `packages/harness/fixtures/digest-slice.json` fixture) and asserts a bitwise digest + headline-metric match; ran it directly (`npx vitest run packages/harness/digest.test.ts`) — 3/3 pass. `.github/workflows/test.yml` runs `pnpm test` (and `pnpm typecheck`) on every push/PR, making this a real CI gate, not an unexercised test. |

**Score:** 4/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/algorithms/sigma1/params.ts` | `Sigma1Params`, `DEFAULT_SIGMA1_PARAMS`, `SIGMA1_PARAM_KEYS` | ✓ VERIFIED | Present, wired into `makeSigma1`. |
| `packages/core/algorithms/sigma1/rp/constants.ts` + `rp/{2022..2026}.ts` + `rp/rules.ts` | Per-season RP rule modules + dispatch table | ✓ VERIFIED (exists, substantive, wired) | Present; `eventTierFor` throws by design on unmapped types (99/offseason) — this design intent is precisely what `index.ts`'s live path fails to respect (see gap). |
| `packages/core/algorithms/sigma1/rp/state.ts`, `rp/distribution.ts` | Threshold-variable state + correlated joint pmf draw | ✓ VERIFIED | Present, wired via `predict()`/`update()`. A real bug (indefinite joint covariance) was found and fixed during 03-06 (Cauchy-Schwarz clamp), per its own SUMMARY and code review — not re-litigated here since it's a positive, verified fix. |
| `packages/core/algorithms/sigma1/adaptation.ts` | Innovation-driven per-team noise adaptation | ✓ VERIFIED | Present; `sigma1-adapt` registered separately in `cli.ts`'s `ALGORITHMS`. |
| `packages/harness/searchSpace.ts`, `tune.ts` | Search bounds, screen, joint search, holdout-blindness gates | ✓ VERIFIED | Present; holdout gate code read directly (`HOLDOUT_SEASONS`, `assertNoHoldoutLeak`). |
| `packages/harness/promote.ts` | Version promotion + digest writer | ✓ VERIFIED | `data/algorithm-versions/` contains 2 committed version files with full provenance and digest blocks. |
| `.github/workflows/test.yml` | CI gate running `pnpm typecheck` + `pnpm test` | ✓ VERIFIED | Read directly; triggers on `push`/`pull_request`, no secrets referenced. |
| `packages/harness/fixtures/digest-slice.json` | Committed bounded slice for CI (no corpus available there) | ✓ VERIFIED | Present on disk (644KB). |
| `docs/models/sigma1-tuning-results.md`, `docs/models/sigma1-sensitivity-screen.md` | SC-3/ALGO-05/ALGO-08 verdicts, screen results | ✓ VERIFIED (exists, substantive) — see gap for RP-verification content specifically | Both present, detailed, and internally consistent against re-derived artifact data. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/harness/tune.ts` | `packages/harness/cli.ts`/`score.ts` | `runSeasons`/`aggregateScores`, holdout-blindness gates | ✓ WIRED | Confirmed by direct source read: 3 independent gates (pre-read, `seasonSplit` re-check, post-scoring `assertNoHoldoutLeak`). |
| `packages/harness/promote.ts` | `data/algorithm-versions/` | validate-then-write | ✓ WIRED | 2 version files present with matching schema. |
| `packages/core/algorithms/sigma1/index.ts` | `packages/core/algorithms/sigma1/rp/rules.ts`/`distribution.ts` | `rpRuleModuleForSeason`, `rpPmfForMatch` | ⚠️ WIRED BUT UNSAFE | Wired and functioning for the qualification-match/mapped-event-type population the phase's own tests exercise, but **not defensively wired** — no guard against an unmapped `eventType` reaching either call, which crashes rather than degrading gracefully (see gap). |
| `packages/harness/cli.ts` | `ALGORITHMS` registry | `sigma1`, `sigma1-defaults`, `sigma1-adapt` entries | ✓ WIRED | Confirmed via direct grep of `cli.ts`; `applyPromotedOverrides` resolves `sigma1`/`sigma1-adapt` to their promoted/search-winner builds lazily at CLI-entry time. |

### Data-Flow Trace (Level 4)

Not applicable in the strict UI-rendering sense (this phase produces pipeline/algorithm code, not rendered pages). The relevant data-flow check — that published figures in `docs/models/sigma1-tuning-results.md` trace to a real, non-fabricated run — was performed: `reports/tuned-v3/artifact.json` exists on disk with a real `runTimestamp`, and its combined-view 2025/2026 rows for `opr`, `epa`, `sigma1`, `sigma1-defaults`, `sigma1-adapt` were independently re-extracted and match the published doc to full precision. This is real, flowing data, not a fabricated or hand-typed table.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Digest reproducibility test actually runs and passes | `npx vitest run packages/harness/digest.test.ts` | 1 file, 3 tests, all passed | ✓ PASS |
| Published Holdout Head-to-Head figures trace to a real artifact | Read `reports/tuned-v3/artifact.json` directly and diffed against `docs/models/sigma1-tuning-results.md` | Exact match to full precision on every row checked | ✓ PASS |
| Promoted version's recorded objective matches the doc's claimed tune-season mean | Read `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json`'s `provenance.objective` | `0.17076606538105618` — matches doc's `0.170766` to full precision | ✓ PASS |
| Sigma1's live RP path crashes on an offseason match with a score breakdown (CR-01) | Wrote and ran a standalone `sigma1.update()` repro test with `eventType: 99` and a real `scoreBreakdownRaw`; deleted afterward, working tree confirmed clean | Test asserting `.toThrow()` passed — i.e., the call does throw | ✗ FAIL (confirms the gap) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ALGO-04 | 03-01, 03-05, 03-06 | Sigma1 hyperparameters set by offline optimizer against tune-season backtest score | ✓ SATISFIED | `tune.ts`, `searchSpace.ts`, `docs/models/sigma1-sensitivity-screen.md`, promoted version with full provenance. |
| ALGO-05 | 03-04, 03-06 | Sigma1 adapts online; harness validates adaptation improves holdout score (on vs off) | ✓ SATISFIED | `adaptation.ts`, two equal-budget searches, best-vs-best holdout comparison published with an honest, documented outcome (Brier improves, accuracy mixed; promotion decision left open per D-08's own allowed dispositions). |
| ALGO-06 | 03-01, 03-05, 03-06 | Algorithm versions first-class; site can display any past version unchanged | ✓ SATISFIED | `promote.ts`, `data/algorithm-versions/*.json`, CI-enforced `digest.test.ts`. |
| ALGO-08 | 03-02, 03-03, 03-06 | RP predicted per match with variance, using each season's rules | ✗ BLOCKED | Rule modules and joint pmf are real and well-tested for the population the tests exercise, but (a) the live path crashes on offseason matches via a documented CLI invocation (confirmed by direct reproduction), and (b) manual confirmation of 2 corpus-converged thresholds was never performed, per the phase's own record. |

No orphaned requirements: REQUIREMENTS.md traceability maps exactly ALGO-04/05/06/08 to Phase 3, matching all 6 plans' declared `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/core/algorithms/sigma1/index.ts` | ~800-807, ~671-685 | Unconditional call into a function documented to throw on unmapped input, with no caller-side guard | 🛑 Blocker | Live crash on offseason matches reached via `--include-offseason` or single-event mode on an offseason event key — see gap. Matches 03-REVIEW.md's CR-01 exactly; confirmed unfixed by direct source read and live reproduction. |
| `packages/core/algorithms/sigma1/rp/2025.ts`, `rp/2026.ts` | inline comments | Explicit "should still be confirmed against the official manual" / "corpus-converged this session ... confirm against the manual" markers on shipped threshold constants | ⚠️ Warning | These are honestly self-flagged (not hidden), but they are unresolved verification debt against SC-4's literal wording, not formally tracked against a referenced follow-up issue/plan number — only prose in Open Items sections. |
| `packages/core/algorithms/sigma1/rp/reconciliation.test.ts` | `KNOWN_TOLERANCES` (per 03-REVIEW.md IN-02) | 2024 `ensembleBonus` tolerance (10%) is ~1.4x the measured rate (~7%), wider than sibling entries, with no stated reason for the specific margin | ℹ️ Info | Not a blocker; code review already flagged this (IN-02) as a minor documentation gap, not a correctness issue. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in the phase's modified files.

### Human Verification Required

(Included above for completeness even though overall status is `gaps_found`, per the "behavior_unverified_items survive a gaps_found phase" principle — these two items are additional, separate from the CR-01 code gap.)

1. **2025 Coral Bonus championship-tier threshold**
   - **Test:** Open the official 2025 FRC Game Manual (§6.5.4, Table 6-2) and read the Coral Bonus championship-tier per-level count requirement.
   - **Expected:** Confirms or corrects the shipped, corpus-converged value of 7 in `packages/core/algorithms/sigma1/rp/2025.ts`.
   - **Why human:** Requires reading the actual official manual document; not derivable from the corpus or any test.

2. **2026 Energized/Supercharged District-Championship/Championship thresholds**
   - **Test:** Open the official 2026 FRC Game Manual (§6.5.3, Tables 6-4/6-5) and read the tier-scaled thresholds.
   - **Expected:** Confirms or corrects the shipped, corpus-converged values (240/360 base/DCMP-equal, 360/500 championship) in `packages/core/algorithms/sigma1/rp/2026.ts`.
   - **Why human:** Requires reading the actual official manual document; not derivable from the corpus or any test.

### Gaps Summary

Four of five roadmap Success Criteria are solidly verified — the tuning/promotion/reproduction spine (SC-1, SC-5), the adaptation on/off report (SC-2), and the holdout head-to-head verdict (SC-3) were all independently re-checked against artifacts and data on disk (not taken on the SUMMARY's word), and held up under a live re-derivation of the published numbers.

SC-4 ("every match has predicted ranking points ... verified against the official manuals") does not hold as stated, for two separable reasons:

1. **A real, reachable, unfixed crash bug (matches 03-REVIEW.md's CR-01 exactly).** Sigma1's shipped `update()`/`predict()` RP path has no defensive guard against an unmapped `eventType`, even though `eventTierFor` is explicitly designed to throw on exactly that input, and even though the rest of the codebase (tuner, promotion, reconciliation tests) all independently apply an offseason exclusion before ever reaching an RP rule module. Two officially documented CLI invocations reach this crash with real data. This was not just noted in the code review — this verification wrote and ran a standalone reproduction test confirming the crash occurs on the current tree, then removed the test (working tree left clean). This is a genuine defect in a documented, supported production code path, not a hypothetical.
2. **Manual verification is incomplete, by the phase's own explicit record.** Two RP thresholds (2025 Coral championship tier, 2026 Energized/Supercharged DCMP/Championship) are corpus-converged rather than confirmed against the actual official manual text — the source code itself says so in comments, and `docs/models/sigma1-tuning-results.md`'s own Open Items section lists this as unresolved. A related, separately-documented modeling gap (three bonuses predicted at a systematically-conservative branch) compounds this.

None of this is hidden by the phase's own documentation — 03-REVIEW.md, the RP source comments, and `docs/models/sigma1-tuning-results.md`'s Open Items are all honest about these limitations. But honesty about a gap does not close it: SC-4 as literally stated ("every match ... verified against the official manuals") is not yet true, and the crash is an objective, reproducible code defect, not a documentation debt.

**Recommendation:** A small, scoped fix plan for CR-01 (the guard + regression test 03-REVIEW.md already specifies) plus the two manual-confirmation checks would close this gap without disturbing any of the four already-verified Success Criteria or any committed digest (the fix is a no-op for every currently-tested, mapped-event-type match).

---

_Verified: 2026-08-17_
_Verifier: Claude (gsd-verifier)_
