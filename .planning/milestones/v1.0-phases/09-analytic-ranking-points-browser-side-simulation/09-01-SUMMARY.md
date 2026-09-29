---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 01
subsystem: api
tags: [zod, react, vitest, ranking-points, compare-page, publish-pipeline]

# Dependency graph
requires:
  - phase: 08-methodology-and-compare-page
    provides: CalibrationSection.tsx / calibrationCards.ts's plain-language card pattern, the compare page's five-section layout, compare.compat.test.ts's schema-compat pin discipline
provides:
  - "scripts/measureRpCalibration.ts, same-scorer fixed and widened to every published algorithm and every registered season"
  - "CompareSliceSchema.rpCalibration - an optional, backward-compatible key on the live v1/compare/{year}.json artifact"
  - "RpCalibrationSection.tsx - a rendered RP scorecard on /methodology/compare, mounted between CalibrationSection and DataCoverageSection"
  - "data/baselines/rp-calibration-2026-09.json - the frozen D-09 per-bonus 'before' baseline, 30 records (10 seasons x 3 algorithms)"
  - "data/baselines/level1-digest-2026-09.json + packages/harness/level1Digest.test.ts - the frozen, corpus-free D-12 level-1 byte-identity gate"
affects: [09-04, 09-06, 09-10]

# Actuals (#2632)
actuals:
  tokens: 41464
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "attachRpCalibration: an exported, single write-path function that attaches a committed measurement onto matching qualification slices only, rounding at the wire boundary while the source measurement stays full precision"
    - "Structurally-duplicated Zod schemas across two files (pageArtifacts.ts's module-private wire schema, publish.ts's measurement schema) held in sync by a compile-time conditional-type equality guard PLUS a shared real-fixture runtime cross-check, since the wire schema is deliberately not exported"

key-files:
  created:
    - scripts/measureRpCalibration.test.ts
    - packages/harness/level1Digest.test.ts
    - apps/web/src/components/compare/rpCalibrationCards.ts
    - apps/web/src/components/compare/rpCalibrationCards.test.ts
    - apps/web/src/components/compare/RpCalibrationSection.tsx
    - apps/web/src/components/compare/RpCalibrationSection.test.tsx
    - apps/web/src/routes/__fixtures__/rp-calibration-2026-bpr.json
    - data/baselines/rp-calibration-2026-09.json
    - data/baselines/level1-digest-2026-09.json
  modified:
    - scripts/measureRpCalibration.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/baselineFingerprint.test.ts
    - apps/web/src/routes/methodology.compare.tsx
    - apps/web/src/routes/methodology.compare.test.tsx
    - apps/web/src/lib/api/compare.compat.test.ts

key-decisions:
  - "Fixed the same-scorer defect BEFORE freezing any baseline (D-11): scripts/measureRpCalibration.ts constructed SigmaScoutLayer with one argument, silently scoring bpr against Swing-derived band variance while the publisher scores it against Sigma-derived band variance"
  - "Dropped reliabilityBins from the RP wire/measurement schema entirely, per the plan's own pre-committed remedy, after real bytes showed attaching it pushed compare-2016.json over the committed 20,000-byte budget with nothing on the Compare page reading it"
  - "Pooling stays scoped PER ALGORITHM (never mixed) in the widened emitter's console report and headline claims, since D-09/D-11 need a per-algorithm comparison, not an averaged-away one"

patterns-established:
  - "A structurally-duplicated Zod schema pair (one file's schema deliberately not exported) held in sync by a compile-time TS conditional-type equality assertion, not just a doc comment"

requirements-completed: [F1, D-09, D-11, D-12]

coverage:
  - id: D1
    description: "scripts/measureRpCalibration.ts is provably the same scorer the publisher runs, for every algorithm (D-11) - the layer's second constructor argument selects Sigma-vs-Swing band variance identically to publish.ts"
    verification:
      - kind: unit
        ref: "scripts/measureRpCalibration.test.ts#same-scorer structural assertions (D-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CompareSliceSchema carries an optional rpCalibration key; a pre-phase artifact with no such key still parses and renders as absent, never coerced to zero"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/api/compare.compat.test.ts#CompareSliceSchema.rpCalibration"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/compare/RpCalibrationSection.test.tsx#absence is absence"
        status: pass
    human_judgment: false
  - id: D3
    description: "/methodology/compare renders an RP calibration card per published algorithm per season, sentence-first with mandatory sample counts and sparse flags, in the settled display form"
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/rpCalibrationCards.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/compare/RpCalibrationSection.test.tsx"
        status: pass
    human_judgment: true
    rationale: "Plain-language calibration copy's honesty to a non-statistician reader is a judgment call the plan itself designates manual-only (09-VALIDATION.md); no browser was available this session to perform the /methodology/compare cold-read check, so this remains an open manual verification (recorded below, WINDOWS.md append attempted but blocked by a pre-existing CRLF parse issue in that file, unrelated to this plan)."
  - id: D4
    description: "data/baselines/rp-calibration-2026-09.json covers the full cross product of registered seasons and published algorithms, validated before write, and is buildCompareArtifact's single input"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#data/baselines/rp-calibration-2026-09.json"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts#RP calibration wire-budget cost"
        status: pass
    human_judgment: false
  - id: D5
    description: "data/baselines/level1-digest-2026-09.json + level1Digest.test.ts re-prove D-12 automatically, run without the corpus, and have had their failure mode observed"
    verification:
      - kind: unit
        ref: "packages/harness/level1Digest.test.ts#level-1 output byte-identity gate (D-12, phase 09 plan 09-01)"
        status: pass
      - kind: unit
        ref: "packages/harness/level1Digest.test.ts#the gate's failure mode, demonstrated rather than asserted"
        status: pass
    human_judgment: false

duration: 4h
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 1: RP Scorecard Tracer, Widened Baseline, and the D-12 Gate Summary

**Fixed a live same-scorer defect in the RP calibration script, wired a plain-language RP scorecard end to end onto `/methodology/compare`, and froze two committed baselines (D-09's per-bonus "before" measurement and D-12's corpus-free level-1 digest gate) that the rest of Phase 9 scores against.**

## Performance

- **Duration:** ~4h
- **Started:** 2026-09-11T~16:00Z
- **Completed:** 2026-09-11T~20:00Z
- **Tasks:** 3
- **Files modified:** 21 (9 created, 12 modified, across 3 task commits)

## Accomplishments

- **Fixed D-11's same-scorer defect.** `scripts/measureRpCalibration.ts` constructed `SigmaScoutLayer` with one constructor argument; the publisher always passes two. The second argument is the only thing that selects Sigma Score band variance over Swing Factor band variance, and `SIGMA_SCORE_ALGORITHM_IDS` is `{bpr}` — this script's own default algorithm. Every bpr figure the script reported before this fix was computed from the wrong band. Fixed, and the effect on the numbers is measured and recorded rather than absorbed silently (see below).
- **Wired the RP scorecard end to end (F1).** `CompareSliceSchema` gained an `.optional()` `rpCalibration` key (following `CompareExclusionCountsSchema.coldStart`'s precedent exactly); `buildCompareArtifact` attaches the matching record onto each qualification slice via the newly exported `attachRpCalibration`; `/methodology/compare` renders one plain-language card per published algorithm per season via the new `RpCalibrationSection.tsx` / `rpCalibrationCards.ts`, mounted between `CalibrationSection` and `DataCoverageSection`.
- **Widened to every season and algorithm (D-09).** The emitter now performs one shared `runAll` per season across all resolved algorithms (not one replay per algorithm), folding each returned record into its own algorithm's `SigmaScoutLayer`. `data/baselines/rp-calibration-2026-09.json` covers the full cross product — 10 registered seasons x 3 published algorithms, 30 records — validated through `RpCalibrationMeasurementSchema` before write and pinned by set equality, never a hand-typed loop.
- **Measured and enforced the wire-cost ceiling.** Attaching the real measurement to every committed `compare-{year}.json` fixture initially pushed `compare-2016.json` to 21,260 bytes against the committed 20,000-byte `budgetMaxBytes`. Per the plan's own pre-committed remedy, `reliabilityBins` — read by nothing on the Compare page — was dropped from the wire record entirely rather than raising the budget. The largest post-attach artifact is now `compare-2026.json` at 19,811 bytes (189 bytes / ~0.9% headroom). `docs/publish-budget.md` is unchanged.
- **Froze the D-12 level-1 digest gate.** `packages/harness/level1Digest.test.ts` + `data/baselines/level1-digest-2026-09.json` re-prove `pRedWin`/`redScore`/`blueScore` byte-identical for every published algorithm on the existing bounded 2022 slice, running from the committed fixture with the real corpus absent (verified directly: corpus renamed, both real assertion tests still ran and passed, neither skipped), with the gate's failure mode demonstrated rather than merely asserted.

## Task Commits

Each task was committed atomically:

1. **Task 1: TRACER — 2026 x bpr end-to-end, scorer to rendered Compare section** — `3cbf7783` (feat)
2. **Task 2: Widen to every season and algorithm, and freeze the per-bonus "before" baseline (D-09, D-11)** — `04d87d30` (feat)
3. **Task 3: Freeze the D-12 level-1 digest baseline as a gate that runs without the corpus** — `47df877d` (test)

**Plan metadata:** (this SUMMARY's own commit)

## Files Created/Modified

- `scripts/measureRpCalibration.ts` — same-scorer fix, `isEntryPoint` guard, `buildRpCalibrationRecord`, `RP_RELIABILITY_BUCKET_EDGES`, `--emit-artifact`, widened to every resolved algorithm sharing one `runAll` per season
- `scripts/measureRpCalibration.test.ts` — the script's first test file: buildRpCalibrationRecord math, same-scorer source assertions, the widened multi-algorithm runAll partitioning
- `packages/harness/pageArtifacts.ts` — `CompareRpBonusSchema`/`CompareRpCalibrationSchema` (module-private), `CompareRpCalibration` (exported type), `CompareSliceSchema.rpCalibration`
- `packages/harness/pageArtifacts.test.ts` — schema round-trip against the real emitted fixture, negative-count rejection
- `packages/harness/publish.ts` — `RpCalibrationMeasurementSchema`, `RP_CALIBRATION_MEASUREMENT_PATH`, `loadRpCalibrationMeasurement`, exported `attachRpCalibration`, `BuildCompareArtifactParams.rpCalibration`, `--rp-calibration`/`--no-rp-calibration` CLI flags
- `packages/harness/publish.test.ts` — attach-onto-matching-slice-only cases, six-decimal rounding, `loadRpCalibrationMeasurement` error-path cases, the cross-product baseline pin, the wire-budget test
- `packages/harness/baselineFingerprint.test.ts` — updated the `data/baselines/` closed-universe pin from 7 to 9 files, excluding the two new non-fingerprint baselines from schema-parse assertions
- `packages/harness/level1Digest.test.ts` (new) — the D-12 gate
- `apps/web/src/components/compare/rpCalibrationCards.ts` / `.test.ts` (new) — the pure card model
- `apps/web/src/components/compare/RpCalibrationSection.tsx` / `.test.tsx` (new) — the rendered section
- `apps/web/src/routes/methodology.compare.tsx` / `.test.tsx` — mounted the section, added its skeleton
- `apps/web/src/lib/api/compare.compat.test.ts` — extended with the pre-phase-artifact compat pin
- `apps/web/src/routes/__fixtures__/rp-calibration-2026-bpr.json` (new) — the real emitted record
- `data/baselines/rp-calibration-2026-09.json` (new) — the frozen D-09 baseline
- `data/baselines/level1-digest-2026-09.json` (new) — the frozen D-12 baseline

## Measured Figures (required by this plan's own `<output>` contract)

### Task 1 Step 5 — 2026 bpr, before/after the same-scorer fix

| Bonus | Before: n / predicted / observed / Brier | After: n / predicted / observed / Brier |
|---|---|---|
| energized | 26,790 / 0.5784 / 0.5913 / 0.1865 | 30,382 / 0.5520 / 0.5768 / 0.1975 |
| supercharged | 26,790 / 0.0457 / 0.0886 / 0.0637 | 30,382 / 0.0407 / 0.0811 / 0.0588 |
| traversal | 26,790 / 0.0001 / 0.0012 / 0.0012 | 30,382 / 0.0000 / 0.0012 / 0.0012 |
| **POOLED** | **80,370 / 0.2080 / 0.2270 / 0.0838** | **91,146 / 0.1976 / 0.2197 / 0.0858** |

The fix moved every published-facing bpr figure. It also widened match coverage by 13.4% (80,370 → 91,146 alliance-bonus observations): Sigma Score always has a figure once a team is seen, while Swing Factor requires two played matches first — so the fix's second effect is closing part of the cold-start gate `cold-start-chain-gates-rp-pmfs-measured.md` measured, for bpr specifically.

### Task 2 Step 3 — pooled headline vs. `ranking-points-audit.md` F2

| Scope | n | mean predicted | observed |
|---|---:|---:|---:|
| F2 (audit, recorded) | — | 0.1507 | 0.3109 |
| opr, pooled (10 seasons) | 488,002 | 0.1507 | 0.3109 |
| epa, pooled (10 seasons) | 488,002 | 0.1507 | 0.3109 |
| bpr, pooled (10 seasons) | 558,192 | 0.1382 | 0.2941 |
| **Grand pooled (all 3 algorithms)** | **1,534,196** | **0.1461** | **0.3048** |

opr and epa reproduce F2's recorded 0.1507 / 0.3109 **exactly** — neither algorithm uses Sigma Score, so neither is touched by the same-scorer fix; F2 was evidently measured on a Swing-scored algorithm all along. The fix's whole effect is concentrated in bpr, whose pooled figures moved to 0.1382 / 0.2941. The grand-pooled figure (0.1461 / 0.3048) differs from F2 only because it now blends bpr's (correctly Sigma-scored) figures in, not because F2's own population was wrong.

### Task 2 Step 5 — wire-budget cost

Largest post-attach `compare-{year}.json`: **`compare-2026.json`, 19,811 bytes**, against the committed 20,000-byte `budgetMaxBytes` (189 bytes / ~0.9% headroom). `docs/publish-budget.md` is unchanged. (Initial measurement before dropping `reliabilityBins`: `compare-2016.json` at 21,260 bytes, 1,260 bytes over.)

### Task 3 — gate-reachability demonstration

1. **Real, unmutated recomputation passes:** re-running `WalkForwardSimulator` + `SigmaScoutLayer.foldPlayed` over the committed 2022 slice and hashing the folded records via `computePredictionStreamDigest` reproduces the committed digest bitwise, for all three published algorithms (opr, epa, bpr).
2. **Mutated recomputation fails:** mutating a single folded prediction's `pRedWin` (toggling it between `0.999`/`0.001`) and re-hashing produces a digest that does NOT equal the committed one — the gate's failure mode was observed directly, not merely asserted to exist.

## Decisions Made

- **Fixed the same-scorer defect before freezing any baseline (D-11).** D-11's whole mitigation rests on `scripts/measureRpCalibration.ts` being the published scorer; freezing a baseline before the fix would have frozen a bug.
- **Dropped `reliabilityBins` from the RP wire/measurement schema entirely**, rather than trimming it selectively or raising the budget, once real bytes showed it was the sole cause of the overage and nothing on the Compare page consumed it. Applied at the schema level (both `pageArtifacts.ts`'s wire schema and `publish.ts`'s measurement schema, kept structurally identical via a compile-time equality guard), not just at the attach boundary, so no dead field survives anywhere in the pipeline.
- **Kept per-algorithm pooling scoped, never mixed**, in the widened emitter's console report and headline claims — mixing algorithms into one pooled figure would average away exactly the per-algorithm comparison D-09/D-11 need.
- **`attachRpCalibration` promoted to exported** (Task 2 Step 4, as the plan specified) so `publish.ts`'s only `buildCompareArtifact` call site threads it, verified by a source-assertion test that a second call site added later could not silently omit it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/harness/baselineFingerprint.test.ts`'s closed-universe pin over `data/baselines/` broke on the two new committed baselines**
- **Found during:** Task 2, first full-suite run after freezing `data/baselines/rp-calibration-2026-09.json`
- **Issue:** That test file assumed every `.json` file in `data/baselines/` was `BaselineFingerprintSchema`-shaped (Brier/accuracy per algorithm/season) and pinned the directory's exact file count at 7 by name. Adding this plan's two non-fingerprint baselines (`rp-calibration-2026-09.json`, `level1-digest-2026-09.json`) broke both the schema-parse loop (real Zod validation errors on fields the RP/digest baselines don't carry) and the exact-count assertion.
- **Fix:** Added `RP_CALIBRATION_BASELINE_FILE`/`LEVEL1_DIGEST_BASELINE_FILE` name constants (matching the file's own established pattern for `EPA_VS_STATBOTICS_BASELINE_FILE`, a prior non-fingerprint baseline in the same directory); excluded both from every test that assumes uniform fingerprint shape; updated the exact-count assertion from 7 to 9 and added both to the `toContain` list.
- **Files modified:** `packages/harness/baselineFingerprint.test.ts`
- **Verification:** `npx vitest run packages/harness/baselineFingerprint` — 15/15 pass; full suite confirmed green afterward.
- **Committed in:** `04d87d30` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep the full suite green after adding two legitimately new baseline files to a directory an existing test assumed was closed. No scope creep — the fix only widens an existing test's known-exceptions list, following its own established pattern.

## Issues Encountered

- The first attempt to background the full 10-season/3-algorithm baseline generation run via `nohup ... &` inside a Bash tool call was killed when that tool call returned (the process was not truly detached under Git Bash on Windows) — no file was written and the process silently vanished. Re-launched using the Bash tool's own `run_in_background: true` parameter directly on the command (no manual backgrounding), which the harness tracks independently and which completed successfully (~23 minutes wall clock, 6+ notification-eligible).
- Corpus file (`data/corpus.sqlite`) could not be renamed for the D-12 "runs without corpus" verification while the background baseline-generation process still held it open; the check was deferred until that process completed, then performed and passed cleanly.

## User Setup Required

None — no external service configuration required.

## Manual Verification Still Owed

**09-VALIDATION.md's own manual-only item was not performed this session** (no browser available in this execution environment): load `/methodology/compare` locally with `VITE_ARTIFACT_ORIGIN=local` and read the RP scorecard cold, confirming no number implies more precision than it has and every sentence prints its sample count. All automated assertions this task can make (no `%` in an absent card, headline sentence built entirely from the record's own numbers, sparse flags present, algorithm labels resolved at run time) pass. An attempt was made to record this in `.planning/WINDOWS.md` via `gsd-tools windows append`; it failed on a pre-existing CRLF line-ending parse error in that file (`"Error: Ledger frontmatter line is not key: value"`), unrelated to this plan — flagged here instead so it is not lost, and so `.planning/WINDOWS.md` itself may want a housekeeping pass to fix its own line endings.

## Next Phase Readiness

- **09-04** can immediately re-prove D-12 against `data/baselines/level1-digest-2026-09.json` once the closed-form RP replaces the Monte Carlo.
- **09-06** has its D-09 per-bonus "before" left-hand side in `data/baselines/rp-calibration-2026-09.json`, ready to score each attribution arm against; it must write a NEW dated file and repoint `RP_CALIBRATION_MEASUREMENT_PATH` rather than editing this one.
- **09-10** can re-prove D-12 at phase close against the same frozen baseline.
- The RP scorecard is live end-to-end on `/methodology/compare` in code, but has not yet been published to the real site (this plan touches no live artifact — `buildCompareArtifact`'s `rpCalibration` param defaults to `undefined` unless a real `publishSeasons` run passes the committed measurement, which no run in this plan performed).

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*
