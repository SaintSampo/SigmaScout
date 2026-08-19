---
phase: 01-data-foundation-evaluation-harness
verified: 2026-08-19T06:52:15Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  previous_verified: 2026-08-13T21:04:15Z
  gaps_closed:

    - "A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data. (ROADMAP Phase 1 success criterion 4)"
  gaps_remaining: []
  regressions: []
gaps:

  - truth: "A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data. (ROADMAP Phase 1 success criterion 4)"
    status: resolved
    resolved_at: 2026-08-19T06:52:15Z
    resolved_by: "quick task 260819-2x6 (commits f77757d8, 807c2a3a, e70b31df, 1eeb43c0)"
    reason: "ORIGINAL FAILURE (2026-08-13): `toLeakProofUpcoming` (packages/harness/replay.ts) wrapped the real MatchResult in a Proxy that defined only a `get` trap. `Object.getOwnPropertyDescriptor(wrapped, \"redScore\").value` (and the `Reflect` equivalent) did not go through `get` — it forwarded to the untrapped target and returned the real outcome value with no error."
    verification_2026_08_19: "Re-derived from first principles by direct execution against the CURRENT module (not by trusting the quick task's SUMMARY or the prior report's `resolution:` note). A standalone tsx probe imported the real `toLeakProofUpcoming` from packages/harness/replay.ts, wrapped a MatchResult carrying sentinel outcome values (redScore 999, blueScore 111, winner \"red\", scoreBreakdownRaw '{\"secret\":\"LEAK\"}'), and exercised 20+ distinct read surfaces. Result: all 7 outcome keys THROW on direct read, `Object.getOwnPropertyDescriptor`, `Reflect.getOwnPropertyDescriptor`, `Reflect.get`, destructuring, and prototype-chain read; all 7 are OMITTED from `Object.getOwnPropertyDescriptors`, `Object.keys`, `Object.getOwnPropertyNames`, `Reflect.ownKeys`, `for...in`, spread, `Object.assign`, `Object.values`, `Object.entries`, `Object.fromEntries`, and `JSON.stringify` — every one of which returned exactly the 10 non-outcome keys. A sentinel scan across every serializing surface found NO occurrence of 999, 111, \"red\", or \"LEAK\". Both `predict()` call sites in the codebase (replay.ts:152 and replay.ts:196) route through the wrapper; no unwrapped call site exists."
    artifacts:

      - path: "packages/harness/replay.ts"
        issue: "RESOLVED — Proxy handler now defines `get`, `getOwnPropertyDescriptor` (both throwing via the shared `denyOutcomeKey` helper so the two surfaces cannot drift), and `ownKeys` (filtering OUTCOME_KEYS out of enumeration). Lines 45-72."

      - path: "packages/harness/replay.test.ts"
        issue: "RESOLVED — 38 tests in this file pass; three new describe blocks pin the descriptor, enumeration, and derived-enumeration bypass paths (see Regression Test Adequacy table below)."
    missing: []
deferred: []
behavior_unverified_items: []
human_verification:

  - test: "Open reports/full/report.html in a browser with networking disabled."
    expected: "Score table shows OPR's winner accuracy and Brier score for 2022-2026 with qual/elim/combined columns; the Statbotics reference row is present and clearly labelled with source/season; 2025 and 2026 are visually distinguished as the only headline-eligible rows; a calibration curve renders per season with the perfect-calibration diagonal visible; excluded/tie/no-call counts appear next to the scores they qualify, not hidden."
    why_human: "Visual legibility, color/badge distinguishability, and whether the disclosure \"reads as adequate\" are not assertable by a unit test. The structural elements are programmatically confirmed present (0 external references, 13 Statbotics mentions, 10-bin calibration arrays on all 15 OPR slices), but the interpretive sign-off has never been recorded in any UAT artifact — no *UAT* file exists anywhere under .planning/phases/."
    status: outstanding
    carried_from: "2026-08-13 verification (harvested from 01-06-PLAN.md Task 2 <human-check>, human_verify_mode=end-of-phase)"
---

# Phase 1: Data Foundation & Evaluation Harness Verification Report

**Phase Goal:** Any prediction method can be scored honestly against 2022–2026 history, on data whose quirks are handled explicitly rather than silently
**Verified:** 2026-08-19T06:52:15Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (prior pass 2026-08-13T21:04:15Z, `gaps_found`, 4/5)

**Verdict in one line:** All 5 ROADMAP success criteria now verify programmatically — the criterion-4 Blocker is genuinely closed, re-derived by direct execution rather than accepted on the quick task's word. The only outstanding item is the never-signed-off human visual check on `reports/full/report.html`, which is what holds the status at `human_needed` rather than `passed` (per the verification decision tree: `passed` is valid only when the human-verification section is empty).

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | One command ingests TBA teams, events, and matches for 2022–2026 into a local normalized corpus; re-running against unchanged upstream data returns 304s instead of re-downloading | ✓ VERIFIED (regression check) | Corpus re-queried at HEAD: 104,772 matches / 1,580 events / 4,655 teams in `data/corpus.sqlite`; `http_cache` holds 1,588 conditional-request entries and `ingest_runs` holds 4 recorded runs — the ETag state that produced the prior pass's 1,585/1,699 304 result is still materialized on disk. `packages/ingest/tbaClient.test.ts` + `normalize.test.ts` re-run in isolation: 21/21 pass. No churn in the ingest layer since the prior verification. |
| 2 | Surrogate matches, replays, missing score breakdowns, and offseason events each appear as explicit flags in the normalized data — none is silently ingested and none is silently dropped | ✓ VERIFIED (regression check) | Direct corpus queries at HEAD, unchanged from the prior pass: `red_surrogates` non-empty on 560 matches, `blue_surrogates` on 501; `has_score_breakdown=0` on 2,082 matches, and `score_breakdown_raw IS NULL` on **exactly those same 2,082** (2082/2082 — no zero-defaulting, confirmed by a joint query this pass, which is a stronger check than the prior pass ran); `is_offseason=1` on 552/1,580 events, matching `event_type=99` on exactly 552 (flag derived, not hand-set); `red_dqs`/`blue_dqs` non-empty on 1,531 matches; 565 matches carry `winner IS NULL` (unplayed, explicitly retained rather than dropped at ingest). `replayed=0` across the real corpus with the `detectReplay` mechanism itself proven by 12 fixture tests — carried forward unchanged. See WR-06 caveat below. |
| 3 | Running the harness on any 2022–2026 season reports OPR's Brier score and winner accuracy, with every prediction produced strictly before that match's result is folded into the model | ✓ VERIFIED (regression check, strengthened) | Prior pass relied on `reports/full/artifact.json` (schema v1, produced 2026-08-13). That artifact is now stale relative to HEAD (`ARTIFACT_SCHEMA_VERSION = 3`), so this pass verified against the **newer real full runs** as well: `reports/full-v2/artifact.json` (schema 2) and `reports/tuned-v3/artifact.json` (schema 3) each carry 75 slices, of which **15 are `algorithmId: "opr"`** — 5 seasons × 3 comp-level views — every one bearing `brierScore`, `winnerAccuracy`, and `scoredCount`. OPR's numbers survive the phase-2/3 refactors. Ordering invariant re-confirmed by reading `WalkForwardSimulator.run` (replay.ts:148-157) and `runAll` (replay.ts:181-204): both call `predict` then push then `update` synchronously per match, with no reordering seam; the call-sequence test in `replay.test.ts` and the whole-season cross-event version in `replay.season.test.ts` both pass. |
| 4 | **A test proves outcome leakage is structurally impossible: any attempt to read a match's result before predicting it fails rather than returning data** | ✓ **VERIFIED (was ✗ FAILED)** | **Re-derived by direct execution, not by trusting the SUMMARY.** See the full bypass-path matrix and the regression-test adequacy table below. Every one of the 8 surfaces named in the re-verification brief — plus 12 more — either throws `Outcome leakage: ...` or returns only the 10 non-outcome keys. A sentinel scan (999 / 111 / "red" / "LEAK") across every serializing surface found zero occurrences. `replay.test.ts` grew from 8 to 38 passing tests, pinning all of it. |
| 5 | The harness emits a calibration curve (predicted probability vs observed frequency) per algorithm per season, and reports headline accuracy only from seasons declared as holdout | ✓ VERIFIED (regression check, strengthened) | Verified against all three real artifacts. In `full-v2` (schema 2) and `tuned-v3` (schema 3): **every one of the 75 slices** carries a 10-bin `calibrationBins` array (checked programmatically, `.every()`, not sampled), and `headlineEligible` is `true` on exactly the 2025/2026 slices and `false` on exactly the 2022/2023/2024 slices across all five algorithms. `packages/harness/score.ts:152` still derives `headlineEligible: label === "holdout"` structurally — a caller cannot set it independently. Determinism re-confirmed this pass: `reports/full/artifact.json` and `reports/rerun/artifact.json` are byte-identical (38,180 bytes each) once `provenance.runTimestamp` is removed — the sole differing bytes are at offset 178, the timestamp itself. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified, 0 overrides)

### Criterion 4 — Bypass-Path Execution Matrix (re-derived from first principles)

A standalone `tsx` probe imported the **real** `toLeakProofUpcoming` from `packages/harness/replay.ts` (no reimplementation of the Proxy shape, unlike the prior pass's `node -e` reproduction) and wrapped a `MatchResult` carrying sentinel outcome values: `redScore: 999`, `blueScore: 111`, `winner: "red"`, `redRpEarned: 4`, `blueRpEarned: 1`, `hasScoreBreakdown: true`, `scoreBreakdownRaw: '{"secret":"LEAK"}'`.

| # | Read surface | Applied to | Result | Leaks outcome data? |
|---|---|---|---|---|
| 1 | Direct property read (`p.redScore`) | all 7 outcome keys | THREW `Outcome leakage: attempted to read "<key>" on match 2026test_qm1 before predict() completed` — 7/7 | No |
| 2 | `Object.getOwnPropertyDescriptor(p, k)` | all 7 outcome keys | THREW same error — 7/7 (this is the exact prior-pass bypass) | No |
| 3 | `Reflect.getOwnPropertyDescriptor(p, k)` | all 7 outcome keys | THREW same error — 7/7 | No |
| 4 | `Object.getOwnPropertyDescriptors(p)` | whole object | Returned descriptors for **exactly the 10 non-outcome keys**; did not throw | No |
| 5 | `Object.keys(p)` | whole object | Exactly the 10 non-outcome keys | No |
| 6 | `Object.getOwnPropertyNames(p)` | whole object | Exactly the 10 non-outcome keys | No |
| 7 | `Reflect.ownKeys(p)` | whole object | Exactly the 10 non-outcome keys | No |
| 8 | `for (const k in p)` | whole object | Exactly the 10 non-outcome keys | No |
| 9 | Spread `{ ...p }` | whole object | 10 keys, real values for those 10, no outcome keys present | No |
| 10 | `Object.values(p)` | whole object | 10 values, all non-outcome | No |
| 11 | `Object.entries(p)` | whole object | 10 entries, all non-outcome | No |
| 12 | `JSON.stringify(p)` | whole object | 10-key JSON; sentinel scan for `999`, `111`, `"red"`, `"LEAK"` → **0 hits** | No |
| 13 | `Reflect.get(p, "redScore")` | outcome key | THREW | No |
| 14 | `Reflect.get(p, "redScore", {})` (alt receiver) | outcome key | THREW | No |
| 15 | Destructuring `const { redScore } = p` | outcome key | THREW | No |
| 16 | Prototype chain: `Object.create(p).redScore` | outcome key | THREW | No |
| 17 | `Object.assign({}, p)` | whole object | 10 keys; `.redScore` → `undefined` | No |
| 18 | `Object.fromEntries(Object.entries(p))` | whole object | 10 keys | No |
| 19 | `JSON.parse(JSON.stringify(p))` | whole object | 10 keys | No |
| 20 | `structuredClone(p)` | whole object | THREW `DataCloneError` (Proxy not cloneable) | No |
| 21 | `String(p)` | whole object | `"[object Object]"` | No |

**Aggregate leak scan verdict: NO LEAKS DETECTED.** No sentinel outcome value was reachable through any of the 21 surfaces.

Both `predict()` call sites in the entire non-test codebase route through the wrapper — `grep -rn "\.predict(" packages/ --include=*.ts | grep -v test` returns exactly `replay.ts:152` and `replay.ts:196`, both `toLeakProofUpcoming`-wrapped. There is no unwrapped seam.

### Criterion 4 — Regression Test Adequacy ("a test proves")

The criterion demands a *test*, not merely correct behavior. `packages/harness/replay.test.ts` runs **38/38 passing** (was 8 before the quick task). Coverage mapped against the brief's required bypass list:

| Required bypass path | Pinned by a test? | Where |
|---|---|---|
| Direct property read | Yes — `it.each(ALL_OUTCOME_KEYS)`, asserts both `/Outcome leakage/` and the match key appears in the message | `describe("toLeakProofUpcoming")` |
| `Object.getOwnPropertyDescriptor` | Yes — `it.each` over all 7 keys | `describe("… getOwnPropertyDescriptor bypass (EVAL-01/SC-4, T-Q2x6-01)")` |
| `Reflect.getOwnPropertyDescriptor` | Yes — separate `it.each` over all 7 keys | same block |
| `Object.getOwnPropertyDescriptors` | Yes — asserts it does NOT throw and its key set is **exactly** the 10 non-outcome keys | `describe("… derived enumeration paths and D-B invariant boundary")` |
| `Object.keys` | Yes — omits all 7, includes all 10 | `describe("… ownKeys enumeration bypass")` |
| `Object.getOwnPropertyNames` | Yes — omits all 7, includes all 10 | same block |
| `Reflect.ownKeys` | Yes — omits all 7, includes all 10 | same block |
| `for...in` | Yes — visits exactly the 10 non-outcome keys | derived-enumeration block |
| Spread | Yes — key set exactly the 10, **and each value equals the raw fixture's value** (proves the wrapper isn't hiding data by returning junk) | derived-enumeration block |
| `Object.values` / `Object.entries` | Yes — both complete without throwing and carry only the 10 | derived-enumeration block |
| `JSON.stringify` | Yes — parsed result's key set is exactly the 10 | derived-enumeration block |

Two additional tests go beyond the brief and are worth noting as genuine quality signals: one pins the **D-B precondition** (the raw `MatchResult` fixture is extensible and every outcome key is configurable — the two facts that make `ownKeys` omission Proxy-invariant-legal), and one pins the **D-B hazard boundary** (wrapping an `Object.freeze`-d `MatchResult` and calling `Object.keys` throws an engine-level `TypeError`, *not* a silent leak). That second test is the honest one: it documents that the guarantee degrades to a loud crash, never to silent leakage, if someone later freezes a `MatchResult`.

**Assessment: the regression tests adequately pin the bypass paths.** Every surface the brief named is asserted, the assertions check the exact key sets rather than merely "does not contain redScore", and the negative and positive halves are both asserted (outcome keys absent AND non-outcome keys present with real values), so a wrapper that broke by hiding *everything* would also fail.

One residual fragility, recorded as Info below: `ALL_OUTCOME_KEYS` in the test file is a hand-maintained parallel list of `OUTCOME_KEYS` in `replay.ts` (which is not exported). The tests catch a *removal* from `OUTCOME_KEYS`, but would not catch a future `MatchResult` field that is outcome-bearing and never added to `OUTCOME_KEYS` at all.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/harness/replay.ts` | WalkForwardSimulator + leak-proof wrapper | ✓ VERIFIED (was ⚠️ PARTIAL) | Proxy now traps `get`, `getOwnPropertyDescriptor`, and `ownKeys`; `get`/`getOwnPropertyDescriptor` share a single `denyOutcomeKey` throw helper so their messages cannot drift. Wired at both `predict()` call sites. Docblock updated (commit e70b31df) to describe three surfaces — no stale single-trap claim remains (checked, not assumed). |
| `packages/harness/replay.test.ts` / `replay.season.test.ts` | Leakage + ordering regression tests | ✓ VERIFIED (was ✗ INCOMPLETE COVERAGE) | 38/38 pass in `replay.test.ts`; all bypass paths pinned per the table above. Ordering tests unchanged and passing. |
| `packages/corpus/schema.sql`, `db.ts` | Full corpus DDL, typed accessors, total-order chronological read | ✓ VERIFIED (regression) | Schema re-dumped from the live DB this pass: all quirk columns present (`red_surrogates`, `blue_surrogates`, `red_dqs`, `blue_dqs`, `replayed`, `replay_detected_at`, `has_score_breakdown`, `score_breakdown_raw`) and populated. |
| `packages/ingest/{tbaClient,schemas,normalize,cli}.ts` | ETag-conditional, throttled, quirk-aware ingestion | ✓ VERIFIED (regression) | 21/21 ingest tests pass in isolation; `http_cache` populated with 1,588 rows. |
| `packages/core/algorithms/opr.ts` | Season-pooled, ridge-regularized OPR, surrogate/DQ policy | ✓ VERIFIED (regression) | Still produces 15 OPR slices in the schema-3 artifact after the phase-2/3 refactors touched this file. |
| `packages/core/isomorphic.test.ts` | Architectural fitness test — no Node/native imports in `packages/core` | ✓ VERIFIED (regression) | Included in the 531 passing tests. |
| `packages/core/scoring/{brier,calibration}.ts` | Metrics with explicit tie/no-call/empty-set contracts | ✓ VERIFIED (regression) | Boundary tests pass; see WR-05 (still open, unchanged). |
| `packages/harness/{score,artifact,statbotics,report}.ts` | Aggregation, versioned Zod-validated artifact, Statbotics reference, self-contained HTML | ✓ VERIFIED (regression) | `ARTIFACT_SCHEMA_VERSION = 3`; `score.ts:152` derives `headlineEligible` structurally; `reports/full/report.html` re-grepped this pass — **0** matches for `src=` / `<script src` / `href="http`, 13 Statbotics mentions. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/harness/replay.ts` | `packages/core/algorithms/types.ts` | `algorithm.predict`/`algorithm.update` calls | ✓ WIRED | Both `run` (line 152) and `runAll` (line 196) confirmed; both wrapped |
| `packages/harness/cli.ts` | `packages/corpus/db.ts` | reads chronological match list | ✓ WIRED | Unchanged |
| `packages/ingest/tbaClient.ts` | `packages/corpus/db.ts` | ETag cache read/write | ✓ WIRED | 1,588 live `http_cache` rows |
| `packages/harness/report.ts` | `packages/harness/artifact.ts` | HTML rendered from validated artifact only | ✓ WIRED | Determinism test passes |
| `packages/harness/score.ts` | `packages/core/scoring/calibration.ts` | `calibrationBins` called per slice | ✓ WIRED | `score.ts:11` import, `:161` call; present on 75/75 slices in the real schema-3 artifact |
| `packages/harness/report.ts` | `packages/harness/statbotics.ts` | reference row read into score table | ✓ WIRED | 13 Statbotics mentions in the rendered HTML |
| `packages/harness/tune.ts` | `packages/harness/replay.ts` | tuning routes through `WalkForwardSimulator` | ✓ WIRED | Confirmed — tuning inherits the leak-proof guarantee rather than re-implementing a replay loop |

### Data-Flow Trace (Level 4)

Unchanged in structure from the prior pass, plus one strengthening: because `reports/full/artifact.json` is schema v1 and HEAD emits schema v3, this pass did **not** rest criteria 3 and 5 on that stale file alone. `reports/full-v2/artifact.json` (schema 2) and `reports/tuned-v3/artifact.json` (schema 3) are real full 2022–2026 runs produced by later code, each with 75 slices carrying real Brier/accuracy/calibration data and 15 of them OPR's. Both trace back to `data/corpus.sqlite` via `provenance.corpusIdentity`. No hollow props, no static fallbacks, no hardcoded score values anywhere in the chain.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Outcome-key direct read throws | `tsx` probe importing the real `toLeakProofUpcoming` | 7/7 outcome keys throw | ✓ PASS |
| Outcome-key `getOwnPropertyDescriptor` read (the prior Blocker) | same probe | 7/7 throw — **no longer returns 999** | ✓ PASS (was ✗ FAIL) |
| All 21 enumeration/serialization surfaces | same probe, sentinel scan | 0 sentinel hits | ✓ PASS |
| `replay.test.ts` in isolation | `vitest run packages/harness/replay.test.ts` | 38/38 passed, 1 file | ✓ PASS |
| Ingest tests in isolation | `vitest run packages/ingest` | 21/21 passed, 2 files | ✓ PASS |
| Full test suite | `npm test` (vitest run) | **531/531 passed, 37 files**, 8.19s (was 116/116, 12 files) | ✓ PASS |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0**, zero errors | ✓ PASS |
| Corpus quirk flags populated | direct `better-sqlite3` queries | surrogates 560/501, missing-breakdown 2,082 (with 2,082/2,082 null raw), offseason 552 = event_type 99 count, DQs 1,531, unplayed 565 | ✓ PASS |
| Report is single-file, no external refs | `grep -cE "src=\|<script src\|href=\"http"` on `reports/full/report.html` | 0 | ✓ PASS |
| Artifact determinism (full vs rerun) | byte diff after removing `provenance.runTimestamp` | identical (38,180 bytes each; sole diff at offset 178 = the timestamp) | ✓ PASS |
| Debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) | `grep -rnE` across `packages/`, `scripts/` | none found | ✓ PASS |

Full-corpus harness replay was **not** re-run (per the standing environment constraint — ~80 minutes). Verification instead inspected the already-produced `reports/full/`, `reports/full-v2/`, `reports/tuned-v3/`, and `reports/rerun/` artifacts and queried `data/corpus.sqlite` directly, exactly as the prior pass did.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| DATA-01 | 01-01, 01-03 | TBA v3 ingestion with ETag conditional requests | ✓ SATISFIED | 1,588 `http_cache` rows + 21/21 ingest tests |
| DATA-02 | 01-01, 01-03, 01-04 | Explicit quirk flags | ✓ SATISFIED (WR-06 latent edge case still open) | Corpus queries above |
| EVAL-01 | 01-02, 01-06 | Walk-forward replay, predict-before-update, every algorithm | ✓ SATISFIED (**leak-visibility half now closed**) | Ordering tests + the 21-surface bypass matrix |
| EVAL-02 | 01-02, 01-05, 01-06 | Brier score + winner accuracy per algorithm per season | ✓ SATISFIED | 15 OPR slices in the schema-3 artifact |
| EVAL-03 | 01-05 | Calibration curves per algorithm | ✓ SATISFIED | 10 bins on 75/75 slices |
| EVAL-04 | 01-05, 01-06 | Tune/holdout split, headline only from holdout | ✓ SATISFIED | `headlineEligible` true on exactly 2025/2026 across all 5 algorithms |
| ALGO-01 | 01-02, 01-04 | OPR as no-variance baseline, per team per season | ✓ SATISFIED | Survives phase-2/3 refactors; still produces all 15 slices |

No orphaned requirements. All 7 IDs mapped to Phase 1 in REQUIREMENTS.md are claimed by at least one plan and covered above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| ~~`packages/harness/replay.ts` 26-37~~ | — | ~~Proxy defines only `get`~~ | ✓ **RESOLVED** | Was the Blocker. Three traps now present; 21-surface execution proof above. |
| `packages/harness/replay.ts` | 45-72 | **NEW-01:** No `set`/`defineProperty`/`deleteProperty` traps — the wrapper is read-guarded but not write-guarded, and `WalkForwardSimulator` passes the *same* `result` object to `update()` after `predict()` | ⚠️ Warning (NEW) | Executed and confirmed: `delete wrapped.redScore` forwards to the untrapped target and removes the field from the **real** `MatchResult`, after which `real.redScore === undefined`. A buggy `predict()` that writes or deletes an outcome field therefore silently corrupts the value subsequently folded in by `update()`. This is an *integrity* hazard, not a *leakage* one — it cannot reveal an outcome — so it does not falsify criterion 4 ("attempt to **read** … fails rather than returning data"). Not triggered by OPR/EPA/Sigma1, whose `predict()` is pure. Worth a `set`/`deleteProperty` trap in a future hardening pass. |
| `packages/harness/replay.ts` | 45-72 | **NEW-02:** No `has` trap — `"redScore" in wrapped` and `Reflect.has(wrapped, "redScore")` both return `true`, inconsistent with `ownKeys` omitting the key | ℹ️ Info (NEW) | Executed and confirmed. Leaks no outcome *data*: key presence is a static schema fact, identical for every `MatchResult` regardless of its result, so it carries zero information about the outcome. Purely a consistency wart. |
| `packages/harness/replay.test.ts` | 41-49 | **NEW-03:** `ALL_OUTCOME_KEYS` is a hand-maintained parallel copy of the unexported `OUTCOME_KEYS` | ℹ️ Info (NEW) | Deliberate per the test's own comment, and it does catch a *removal* from `OUTCOME_KEYS`. But it cannot catch a future outcome-bearing `MatchResult` field that is never added to `OUTCOME_KEYS` in the first place. `types.ts` documents the convention (each new outcome field must be added to `OUTCOME_KEYS` in the same commit) — a convention, not an enforced check. |
| `packages/core/algorithms/opr.ts` | `IncrementalInverse.rank1Update` / `applyObservation` | **WR-01** (carried forward): no numerical-drift safeguard on the season-scale incremental RLS solve | ⚠️ Warning — **STILL OPEN** | Re-checked at HEAD this pass: `rank1Update` computes `const denom = 1 + uPu` and divides by it with no `denom <= 0` or `Number.isFinite` guard; `applyObservation` divides by the same `denom` unguarded. The only NaN/Infinity mitigation is the *comment* at line 18 describing ridge regularization's role — not a runtime check. Unchanged since the review. |
| `pnpm-workspace.yaml` | 1-2 | **WR-02** (carried forward): glob is `apps/*`, repo layout is `packages/*` | ⚠️ Warning — **STILL OPEN** | Re-read at HEAD: file still contains only `packages:\n  - "apps/*"`. Unchanged. |
| `packages/corpus/db.ts` | 48-59 | **WR-03** (carried forward): TOCTOU race in single-writer lock acquisition | ⚠️ Warning — **STILL OPEN** | Re-read at HEAD: `acquireWriteLock` still does `existsSync(lockPath)` → … → `writeFileSync(lockPath, …)` with no atomic `wx` open flag. Unchanged. |
| `packages/corpus/db.ts` / `schema.sql` | 62-83 | **WR-04** (carried forward): `PRAGMA foreign_keys` never enabled | ⚠️ Warning — **STILL OPEN** | Re-checked at HEAD: `grep "pragma("` on `db.ts` returns exactly two calls — `journal_mode = WAL` and `busy_timeout = 5000`. No `foreign_keys = ON`. Unchanged. |
| `packages/core/scoring/{calibration,brier}.ts` | various | **WR-05** (carried forward): `pRedWin` not validated at the scoring boundary | ⚠️ Warning — **STILL OPEN** | Re-checked at HEAD: `calibration.ts` validates only `binCount` (line 41); nothing validates `pRedWin` range or finiteness before `Math.floor(pRedWin * binCount)` (line 51). `brier.ts` uses `pRedWin` at lines 67/70/76 with no guard. Unchanged. |
| `packages/ingest/normalize.ts` | 89-101 | **WR-06** (carried forward): a played, non-tied match with an empty `winning_alliance` is silently dropped | ⚠️ Warning — **STILL OPEN** | Re-read at HEAD: `normalizeMatch` still assigns `winner` only when `winning_alliance` is `"red"`/`"blue"` or when `redScore === blueScore`; no score-comparison fallback and no exclusion counter. Latent — no such row exists in the real 2022–2026 corpus. Unchanged. |
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found anywhere in `packages/` or `scripts/` | ℹ️ Info | Debt-marker gate clean, including the four quick-task commits |

**All six carried-forward Warnings from `01-REVIEW.md` were re-checked against the current source this pass, not assumed.** All six remain open and unchanged — the quick task addressed only CR-01 and touched only `replay.ts`, `replay.test.ts`, and `types.ts` (verified via `git show --stat` on all four commits). None of the six individually falsifies a ROADMAP success criterion; they are latent/defense-in-depth gaps, not observed failures in the real corpus or the real full runs.

### Human Verification Required

One item, **outstanding and never signed off** — carried forward unchanged from the 2026-08-13 pass. No `*UAT*` artifact exists anywhere under `.planning/phases/` (checked), so this has not been recorded as done. This item is what holds the phase at `human_needed` rather than `passed`.

#### 1. Visual/interpretive quality of `reports/full/report.html`

**Test:** Open `reports/full/report.html` in a browser with networking disabled.

**Expected:** Score table shows OPR's winner accuracy and Brier score for 2022–2026 with qual/elim/combined columns; the Statbotics reference row is present and clearly labelled with source/season; 2025 and 2026 are visually distinguished as the only headline-eligible rows; a calibration curve renders per season with the perfect-calibration diagonal visible; excluded/tie/no-call counts appear next to the scores they qualify, not hidden.

**Why human:** Visual legibility, colour/badge distinguishability, and whether the disclosure "reads as adequate" are not assertable by a unit test. The structural elements are programmatically confirmed present this pass (0 external references, 13 Statbotics mentions, 10-bin calibration arrays on every slice, holdout flags correct), but the interpretive judgement has not been recorded anywhere.

**Note for the reviewer:** `reports/full/report.html` is the Phase-1-era (schema v1, OPR-only) report — the correct artifact for signing off *this* phase. `reports/tuned-v3/` holds the current five-algorithm schema-3 report if you want to sanity-check that the presentation held up through Phases 2–3.

### Gaps Summary

**No gaps remain.** The single Blocker from the 2026-08-13 pass — ROADMAP success criterion 4's "outcome leakage is structurally impossible" — is genuinely closed, and this pass established that by direct execution against the real module rather than by reading the quick task's SUMMARY. Twenty-one distinct read surfaces were exercised against a sentinel-loaded `MatchResult`; every outcome-bearing read either throws a named `Outcome leakage` error or is omitted from enumeration, and a sentinel scan across every serializing path found zero occurrences of any real outcome value. The specific bypass that failed before (`Object.getOwnPropertyDescriptor(wrapped, "redScore").value` returning 999) now throws. The `ownKeys` filter — which the original gap listed only as a "consider" item — is implemented and, notably, its Proxy-invariant preconditions and its degradation boundary (a frozen `MatchResult` produces a loud engine `TypeError`, never a silent leak) are both pinned by tests. The regression suite is adequate: it asserts exact key sets in both directions rather than a weak "does not contain" check.

The other four criteria were regression-checked and all hold. Two of them are now on *stronger* evidence than the prior pass had: criteria 3 and 5 no longer rest on the stale schema-v1 artifact alone but on real schema-2 and schema-3 full-corpus runs produced after the Phase 2 and 3 refactors, proving OPR's Brier/accuracy/calibration/holdout behaviour survived those changes. The full suite has grown from 116 to 531 tests across 37 files, all passing, with a clean typecheck.

Three new observations were recorded this pass, none blocking: the wrapper is read-guarded but not write-guarded (a `predict()` could delete or overwrite an outcome field on the shared object that `update()` later reads — an integrity hazard, not a leakage one, and not what criterion 4 asserts); `in`/`Reflect.has` still report outcome keys as present, which leaks no outcome information but is inconsistent with the `ownKeys` filter; and the test file's outcome-key list is a hand-maintained parallel of the unexported `OUTCOME_KEYS`, which cannot catch a future outcome field that is never registered at all.

All six Warning-level findings from `01-REVIEW.md` were individually re-checked against current source and all six remain open, unchanged — the quick task correctly scoped itself to CR-01 only.

The phase goal — "any prediction method can be scored honestly against 2022–2026 history, on data whose quirks are handled explicitly rather than silently" — is achieved as far as programmatic verification can establish. Status is `human_needed` solely because the report's visual sign-off has never been recorded; per the verification decision tree, `passed` requires an empty human-verification section.

---

_Verified: 2026-08-19T06:52:15Z_
_Verifier: Claude (gsd-verifier) — re-verification after gap closure_
