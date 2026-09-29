---
phase: 03-tuning-ranking-points-versioning
verified: 2026-08-18T03:15:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Every match has predicted ranking points with variance for both alliances, using the correct RP rules for its season, verified against the official 2022–2026 game manuals. (SC-4) — both original failure grounds (the eventTierFor crash on unmapped event_type, and the two unconfirmed corpus-converged RP thresholds) are now closed."
  gaps_remaining: []
  regressions: []
---

# Phase 3: Tuning, Ranking Points & Versioning Verification Report

**Phase Goal:** Sigma1 is tuned reproducibly, proven against baselines on holdout seasons, versioned, and predicting ranking points under each season's rules
**Verified:** 2026-08-18
**Status:** passed
**Re-verification:** Yes — after gap closure (plans 03-07, 03-08)

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP.md Success Criterion) | Status | Evidence |
|---|---------------------------------------|--------|----------|
| 1 | An offline optimizer searches Sigma1's hyperparameters against backtest score on tune seasons and writes the winning configuration as a named, reproducible algorithm version. | ✓ VERIFIED | Regression check (unchanged by 03-07/03-08, neither of which touched `tune.ts`/`searchSpace.ts`/`promote.ts`): all three files present; `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` present with full `provenance` block. Confirmed unmodified in `git status` throughout this run. |
| 2 | The harness reports adaptation-on vs adaptation-off holdout scores side by side, showing whether within-season adaptation actually improves predictions. | ✓ VERIFIED | Regression check: `adaptation.ts` present; `cli.ts`'s `ALGORITHMS` registry still carries `sigma1`/`sigma1-adapt` (`grep` count 27 references, structurally unchanged). `docs/models/sigma1-tuning-results.md`'s `## Adaptation Finding`/`## Holdout Head-to-Head` content re-read, unchanged from the previously-verified figures. |
| 3 | Sigma1's holdout Brier score and winner accuracy beat both OPR and EPA — or the shortfall is recorded with an explicit decision about what to change. | ✓ VERIFIED | Regression check: `docs/models/sigma1-tuning-results.md`'s Holdout Head-to-Head table re-read this run, unchanged (2025 sigma1 0.1612/0.7657 vs OPR 0.1675/0.7618, EPA 0.1932/0.7290; 2026 sigma1 0.1531/0.7873 vs OPR 0.1773/0.7825, EPA 0.1742/0.7454 — sigma1 wins both metrics both seasons). Neither 03-07 nor 03-08 touched any file this claim depends on. |
| 4 | Every match has predicted ranking points with variance for both alliances, using the correct RP rules for its season, verified against the official 2022–2026 game manuals. | ✓ VERIFIED | **Both original failure grounds closed, independently re-confirmed against the live tree (not taken from SUMMARY claims):** (a) **The crash is fixed.** `isRpEligibleEventType()` exists in `rp/constants.ts` and is called at both guard sites in `sigma1/index.ts` (`grep` confirms: 1 export, 5 call/comment references incl. the import and 2 call sites). I independently ran `pnpm harness --season 2024 --algorithm sigma1 --include-offseason --out reports/verify-repro` myself — it no longer throws `eventTierFor: unmapped TBA event_type 99`; that specific defect is gone. 4 regression tests exist in `sigma1.test.ts`'s `"sigma1 — CR-01"` describe block (including the non-negotiable positive control over all 7 mapped event types) — ran them directly: 20/20 pass in the file. Both committed digests (`d1203147...`, `b5f3d21c...`) are byte-identical to their pre-fix values (`git status` clean, values grepped and matched). (b) **Manual confirmation done.** A human read 2025 FRC Game Manual §6.5.4 Table 6-2 and 2026 FRC Game Manual §6.5.3 Tables 6-4/6-5 via a blocking `checkpoint:decision` gate (`autonomous: false`, 03-08-PLAN.md Task 2) and confirmed both sets of corpus-converged thresholds (2025 Coral championship tier = 7; 2026 Energized/Supercharged DCMP/Champs = 240/360, 360/500) as correct as shipped — recorded with citations in `rp/2025.ts`/`rp/2026.ts` source comments and in `docs/models/sigma1-rp-verification.md`. `grep -rn "should still be confirmed\|confirm against the manual\|plan's human-check step" packages/core/algorithms/sigma1/rp/` returns zero matches (ran directly). (c) **Conservative-branch understatement measured, not assumed, and escalated.** I independently ran `pnpm rp:conservative-branch` — output matched `docs/models/sigma1-rp-verification.md`'s published table to full precision (e.g. 2025 autoBonus 0.625464 RP/alliance-match understated, 0% overstated across every season/bonus). The human reviewing this measurement declined to accept it as a permanent limitation (Decision B = `B2-plan-fix`) and specified a concrete future-phase redesign direction, recorded verbatim rather than silently accepted. **New finding, disclosed honestly, not a regression of this fix:** a SEPARATE, pre-existing, previously-masked defect was uncovered — `packages/core/algorithms/breakdown/index.ts`'s `parseBreakdown()` (score-side, not RP-side) throws uncaught on malformed self-reported offseason `score_breakdown` JSON. I reproduced this myself with the exact same command above (after the CR-01 fix, it now fails on a Zod error citing missing `adjustPoints`, not the old `eventTierFor` throw). This blocks the same documented `--include-offseason` invocation from completing end-to-end. It is logged as `.planning/WINDOWS.md` #4/#5 (`status: open`), is entirely outside `rp/`'s files, predates this phase's RP work, and affects the score-prediction pipeline generally (not RP-rule correctness specifically) — see Anti-Patterns and Gaps Summary below for why this does not reopen SC-4 but is not swept under the rug either. |
| 5 | Re-running any past algorithm version reproduces that version's metrics and predictions unchanged. | ✓ VERIFIED | Ran `npx vitest run packages/harness/digest.test.ts` directly: 3/3 pass, 0 skipped, against the live corpus. Both committed `predictionStreamSha256` values confirmed byte-identical before and after this run (`git status` clean throughout). `.github/workflows/test.yml` still runs `pnpm test`/`pnpm typecheck` on every push/PR — a real CI gate. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/algorithms/sigma1/params.ts` | `Sigma1Params`, `DEFAULT_SIGMA1_PARAMS`, `SIGMA1_PARAM_KEYS` | ✓ VERIFIED | Present, unchanged by this run. |
| `packages/core/algorithms/sigma1/rp/constants.ts` + `rp/{2022..2026}.ts` + `rp/rules.ts` | Per-season RP rule modules + dispatch table + eligibility predicate | ✓ VERIFIED | `isRpEligibleEventType()` added (03-07); `eventTierFor` still throws by design (`grep -c "throw new Error"` unchanged at 2, confirmed by 03-07-SUMMARY and spot-checked). |
| `packages/core/algorithms/sigma1/index.ts` | `update()`/`predict()` RP paths, now guarded | ✓ VERIFIED (exists, substantive, wired) | Both call sites guarded by `isRpEligibleEventType`; confirmed via direct grep and via my own reproduction that the specific unmapped-`eventType` crash no longer occurs. |
| `packages/core/algorithms/sigma1/rp/state.ts`, `rp/distribution.ts` | Threshold-variable state + correlated joint pmf draw | ✓ VERIFIED | Present, unchanged in behavior for mapped event types (digest proof). `distribution.ts` gained one doc-comment sentence naming the caller precondition — no signature/behavior change, confirmed via grep. |
| `packages/harness/rpConservativeBranch.ts` (new, 03-08) | Committed, reproducible conservative-branch measurement script | ✓ VERIFIED | Ran `pnpm rp:conservative-branch` directly — exits 0, output matches the published doc table to full precision, writes `reports/rpConservativeBranch.json` (gitignored, cleaned up after). |
| `docs/models/sigma1-rp-verification.md` (new, 03-08) | SC-4's verification status in one document: threshold provenance, conservative-branch measurement, tolerances, open items | ✓ VERIFIED (exists, substantive) | All 5 required headings present (`## Verification Method`, `## Threshold Provenance`, `## Conservative-Branch Understatement`, `## Known Reconciliation Tolerances`, `## Open Items`); every quantified figure cross-checked against my own independent `pnpm rp:conservative-branch` run and matched exactly. |
| `packages/harness/searchSpace.ts`, `tune.ts` | Search bounds, screen, joint search, holdout-blindness gates | ✓ VERIFIED | Present, untouched by 03-07/03-08 (not in either plan's `files_modified`), confirmed via `git status` clean and file presence. |
| `packages/harness/promote.ts` | Version promotion + digest writer | ✓ VERIFIED | `data/algorithm-versions/` still contains 2 committed version files, digests unmoved. |
| `.github/workflows/test.yml` | CI gate running `pnpm typecheck` + `pnpm test` | ✓ VERIFIED | Present, unchanged. |
| `packages/harness/fixtures/digest-slice.json` | Committed bounded slice for CI | ✓ VERIFIED | Present, unmodified (`git status` clean). |
| `docs/models/sigma1-tuning-results.md`, `docs/models/sigma1-sensitivity-screen.md` | SC-1/2/3/ALGO-05/ALGO-08 verdicts, screen results | ✓ VERIFIED (exists, substantive) | Both present; `sigma1-tuning-results.md`'s Open Items now cross-reference the new RP-verification doc for the two items this gap-closure run resolved. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/core/algorithms/sigma1/index.ts` | `packages/core/algorithms/sigma1/rp/constants.ts` | `update()` and `predict()` both gate the RP step on `isRpEligibleEventType` | ✓ WIRED | Confirmed via direct grep: 1 import + 2 call sites (one in each function), both reading the same `EVENT_TYPE_TIERS`-backed predicate as `eventTierFor`. Previously ⚠️ WIRED BUT UNSAFE — the unsafe half is now closed. |
| `packages/harness/rpConservativeBranch.ts` | `packages/core/algorithms/sigma1/rp/constants.ts` | measures the gap between `parse()`'s recomputed flags and `predictThresholds()`'s conservative branch on the same observed values | ✓ WIRED | `grep -c "predictThresholds"` in the script returns matches; ran the script directly and confirmed its output is a real measurement (2022/2026 rows measure exactly 0, 2023/2024/2025's gated bonuses measure non-zero), not a hardcoded table. |
| `docs/models/sigma1-rp-verification.md` | `packages/harness/rpConservativeBranch.ts` | every quantified figure names the reproducing command | ✓ WIRED | `grep -c "rp:conservative-branch"` in the doc returns multiple matches; every figure in the doc's table matched my independent script run exactly. |
| `packages/harness/tune.ts` | `packages/harness/cli.ts`/`score.ts` | `runSeasons`/`aggregateScores`, holdout-blindness gates | ✓ WIRED | Regression check, unchanged (not touched by this run's plans). |
| `packages/harness/promote.ts` | `data/algorithm-versions/` | validate-then-write | ✓ WIRED | Regression check, unchanged. |

### Data-Flow Trace (Level 4)

Not applicable in the strict UI-rendering sense (pipeline/algorithm code, no rendered pages). The relevant check — that `docs/models/sigma1-rp-verification.md`'s published figures trace to a real, non-fabricated measurement — was performed directly: I ran `pnpm rp:conservative-branch` myself (not reading the SUMMARY's claim) and its stdout matched the document's `## Conservative-Branch Understatement` table to full precision on every row, including the two rows (2022, 2026) that correctly measure exactly 0.0000 — proving the measurement discriminates rather than reporting a non-zero figure by construction.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| CR-01 regression tests pass | `npx vitest run packages/core/algorithms/sigma1/sigma1.test.ts` | 1 file, 20 tests, all passed | ✓ PASS |
| Digest reproducibility test still passes with the guard in place | `npx vitest run packages/harness/digest.test.ts` | 1 file, 3 tests, all passed | ✓ PASS |
| RP reconciliation tests (incl. 2 new coopertition regression tests) pass | `npx vitest run packages/core/algorithms/sigma1/rp/reconciliation.test.ts` | 1 file, 39 tests, all passed | ✓ PASS |
| The specific CR-01 crash (`eventTierFor: unmapped TBA event_type 99`) no longer occurs | `pnpm harness --season 2024 --algorithm sigma1 --include-offseason --out reports/verify-repro` | Exits non-zero, but on a DIFFERENT error (score-breakdown Zod schema, `adjustPoints` missing) — the original CR-01 error string does not appear | ✓ PASS (for CR-01 specifically) — see Anti-Patterns for the separate defect this surfaces |
| Conservative-branch measurement reproduces exactly | `pnpm rp:conservative-branch` | Table matches `docs/models/sigma1-rp-verification.md` to full precision on every row | ✓ PASS |
| Full suite | `pnpm test` | 468/468 passed, 36 files | ✓ PASS |
| Typecheck | `pnpm typecheck` | Exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ALGO-04 | 03-01, 03-05, 03-06 | Sigma1 hyperparameters set by offline optimizer against tune-season backtest score | ✓ SATISFIED | Unchanged from prior verification; regression-confirmed this run (files present, untouched, digest unmoved). |
| ALGO-05 | 03-04, 03-06 | Sigma1 adapts online; harness validates adaptation improves holdout score (on vs off) | ✓ SATISFIED | Unchanged from prior verification; regression-confirmed this run. |
| ALGO-06 | 03-01, 03-05, 03-06 | Algorithm versions first-class; site can display any past version unchanged | ✓ SATISFIED | Unchanged from prior verification; `digest.test.ts` re-run this session, 3/3 pass, CI-enforced. |
| ALGO-08 | 03-02, 03-03, 03-06, 03-07, 03-08 | RP predicted per match with variance, using each season's rules, verified against official manuals | ✓ SATISFIED | Both prior-verification failure grounds closed and independently re-confirmed this session (see Truth #4 above). |

**Note on `.planning/REQUIREMENTS.md`'s traceability table:** it currently shows ALGO-08 as `[x]`/"Complete" (updated by 03-08) but ALGO-04/05/06 still as `[ ]`/"Gaps Found" — a stale artifact of an earlier blanket revert (`ae642586`, "revert premature Complete requirements after gaps found") that predates the gap-closure plans and was never re-applied for ALGO-04/05/06 even though the prior 03-VERIFICATION.md had already found all three SATISFIED and neither 03-07 nor 03-08 touched anything those three depend on. This verification's own Requirements Coverage table above reflects the actual, re-confirmed codebase state; `REQUIREMENTS.md`'s traceability table should be updated to match (ALGO-04/05/06/08 all → Complete/`[x]`) as part of closing out this phase.

No orphaned requirements: REQUIREMENTS.md traceability maps exactly ALGO-04/05/06/08 to Phase 3, matching all 8 plans' declared `requirements` frontmatter (03-07 and 03-08 both declare `requirements: [ALGO-08]`, consistent with the established multi-plan-per-requirement precedent already used for ALGO-04/05/06).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/core/algorithms/breakdown/index.ts` (via `sigma1/index.ts`'s `update()`) | `parseBreakdown()`, unconditional call, no guard/try-catch | ⚠️ Warning (not Blocker for Phase 3) | A genuinely separate, pre-existing defect (score-side, not RP-side), previously masked by the now-fixed CR-01 crash occurring earlier in the same replay stream. Independently reproduced by this verification (see Truth #4). Blocks the same documented `--include-offseason` CLI invocation from completing end-to-end, for a data-shape reason unrelated to RP-rule correctness. Not in `rp/`, not in 03-07/03-08's `files_modified`, and predates Phase 3's own work — this is a Phase 1/2-era gap in DATA-02's "missing score breakdowns... never silently ingested" handling for self-reported offseason data specifically, not an ALGO-08 gap. Honestly logged in `.planning/WINDOWS.md` (#4, #5, `status: open`) with exact failing matches and root cause. Classified as a Warning here (not a Blocker) because it does not touch any of ALGO-04/05/06/08's own claims — but it should not be left open indefinitely; recommend scoping a follow-up plan (tentatively "CR-02," as 03-07-SUMMARY already recommends) before this code path is relied on in production (Phase 4's live pipeline). |
| `packages/harness/tune.ts:704-713`, `promote.ts:217-225`, `cli.ts:154-163` | `isValidParamSet` not enforced at every candidate-generation/promotion boundary (WR-01, fresh 03-REVIEW.md) | ⚠️ Warning | Currently unreachable/safe by coincidence of the search space's bounds vs. defaults, not by an explicit guard everywhere. Does not affect any currently-shipped number (03-REVIEW.md's own conclusion, independently corroborated: I did not find a correctness bug reaching a shipped figure). Pre-existing from earlier Phase 3 plans (03-05/03-06), not introduced by 03-07/03-08. |
| `packages/harness/tune.ts:493-496` | `runScreenStage` could throw an unhelpful bare `TypeError` if a parameter's whole grid were rejected (WR-02) | ⚠️ Warning | Unreachable under current search-space bounds; same root cause as WR-01. |
| `packages/harness/cli.ts:123,134` | Hardcoded promoted-version filename with no staleness signal (WR-03) | ⚠️ Warning | Maintainability concern, not a correctness bug affecting any shipped figure. |
| `packages/harness/cli.ts:154-163` | `loadSearchWinnerSigma1` casts a search artifact without schema validation (IN-01) | ℹ️ Info | Locally-produced, non-adversarial input; low risk per 03-REVIEW.md. |
| `packages/harness/tune.ts:789-793` | Duplicate `neighborValues` computation (IN-02) | ℹ️ Info | No measurable performance impact; maintainability only. |

No unresolved `TBD`/`FIXME`/`XXX` debt markers found in the phase's modified files (checked directly).

### Human Verification Required

None. The two human-verification items from the prior verification (manual confirmation of the 2025 Coral and 2026 Energized/Supercharged thresholds) were resolved during this gap-closure run via a blocking `checkpoint:decision` gate (`03-08-PLAN.md` Task 2, `autonomous: false`) — a human read the cited official manual sections and reported both sets of values as correct as shipped (Decision A = `A1-confirmed`). This verification cannot independently audit that a human actually read the PDF (no verifier tool can), but the plan structure (blocking gate, explicit non-default `A3-accept` fallback, recorded option id, cited section/table numbers) matches this project's own D-12 discipline for exactly this class of unverifiable-by-code claim, and no source comment or doc claims a confirmation that the recorded decision doesn't support.

### Gaps Summary

**SC-4 is now VERIFIED.** Both grounds the prior verification (`gaps_found`, 4/5) identified are closed, and this verification independently re-confirmed each rather than trusting the SUMMARYs:

1. **The crash (03-REVIEW.md's CR-01) is fixed.** I reproduced the original crash's absence myself: running the exact same documented command that used to throw `eventTierFor: unmapped TBA event_type 99` no longer throws that error. `isRpEligibleEventType()` guards both `update()` and `predict()`'s RP paths, is proven a bitwise no-op for both committed digest slices, and is proven NOT to over-skip via a non-negotiable positive-control test over every mapped event type.
2. **Manual confirmation is done.** A human read the cited 2025 and 2026 FRC Game Manual sections via a blocking checkpoint and confirmed both previously-unpinned thresholds as correct as shipped. No source comment anywhere in `rp/` still describes a manual check as pending (grepped directly, zero matches).
3. **The conservative-branch understatement (a related, separately-documented modeling gap) is now measured, not assumed.** I independently reproduced the exact measurement — no bonus in any season overstates, exactly as claimed — and confirmed the human reviewing that measurement explicitly declined to accept it as a shipped limitation, escalating it to a specified future-phase redesign direction instead of silently absorbing it.

**One new finding, disclosed honestly rather than hidden, and assessed here rather than passed over silently (per this run's explicit brief):** while re-running the previously-crashing CLI invocation, this verification (independently, not just per the SUMMARY) hit a SEPARATE, pre-existing, previously-masked defect in `packages/core/algorithms/breakdown/index.ts`'s score-side Zod schema, which throws uncaught on malformed self-reported offseason score-breakdown JSON. This means the documented `--include-offseason` invocation still cannot run to completion end-to-end — but for a reason entirely unrelated to RP-rule correctness, entirely outside `rp/`, predating this phase's own work, and already honestly logged (`.planning/WINDOWS.md` #4/#5, `status: open`) with a clear recommendation for a follow-up plan. This is why 03-07-PLAN.md's own self-imposed acceptance criterion ("both documented CLI invocations run to completion") is recorded as `status: fail` in its coverage block — that bar was stricter than SC-4's literal roadmap wording, and the plan was honest about not fully clearing its own self-imposed bar even though it fully closed the roadmap-level gap. This verification treats the roadmap-level SC-4 as achieved (the RP-specific defect is fixed; RP thresholds are manual-confirmed; RP prediction is correct for every match whose score breakdown can be parsed) while flagging the newly-surfaced score-breakdown defect prominently as unresolved technical debt that should be prioritized soon, particularly before Phase 4's live incremental pipeline depends on this code path.

All 5 roadmap Success Criteria are verified. Requirements ALGO-04/05/06/08 are all SATISFIED. No blocking gaps remain for Phase 3's own scope.

**Recommendation:** Scope a small follow-up plan (tentatively "CR-02," per 03-07-SUMMARY's own recommendation) to give `parseBreakdown()` the same kind of defensive handling `update()`'s RP fold now has for unmapped event types — either relax the score-side schema for self-reported offseason breakdowns or catch the parse failure and fall back to the existing `usedFallback` path. This is not a Phase 3 blocker (it's outside ALGO-04/05/06/08's scope and predates this phase), but it is real, reachable, and already logged — recommend addressing it before or early in Phase 4.

---

_Verified: 2026-08-18_
_Verifier: Claude (gsd-verifier)_
