---
phase: 01-data-foundation-evaluation-harness
plan: 05
subsystem: evaluation-harness
tags: [zod, vitest, calibration, brier-score, tune-holdout, statbotics, inline-svg]

# Dependency graph
requires:
  - phase: 01-data-foundation-evaluation-harness (Plan 02)
    provides: The tracer's brier.ts (two functions) and report.ts (ad hoc HarnessArtifact/writeArtifact), which this plan extends and formalizes
provides:
  - "scoreSet — Brier score, winner accuracy, and explicit tie/no-call/empty-set boundary contracts (EVAL-02)"
  - "calibrationBins — reliability-diagram binning with boundary-to-upper-bin and 1.0-final-bin rules, null (never fabricated-zero) empty bins (EVAL-03)"
  - "aggregateScores/seasonSplit — tune/holdout labelling (D-09) made structural via headlineEligible, and exclusion accounting broken out by reason (EVAL-04)"
  - "HarnessArtifactSchema/buildArtifact/writeArtifact — the versioned, Zod-validated canonical JSON artifact contract Phase 8's Compare page will consume (D-02)"
  - "statboticsReference — live-fetch-then-fallback D-04 reference row with explicit fetched/dated-constant provenance"
  - "renderHtmlReport — self-contained HTML rendered only from the validated artifact, with inline SVG score bars and calibration diagrams"
affects: ["01-06", "08"]

# Actuals (#2632)
actuals:
  tokens: 20450
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "null (never 0, never NaN) is the single contract for 'nothing was measured' across scoreSet, calibrationBins, aggregateScores, and the HTML renderer's not-applicable marker — proven by JSON round-trip tests at every layer"
    - "HarnessArtifactSchema (Zod) is the single executable spec for the JSON artifact; buildArtifact and writeArtifact both independently re-validate (defense in depth) so a hand-constructed or mutated artifact can never reach disk without passing the same check"
    - "renderHtmlReport takes only a validated HarnessArtifact and returns a string — no corpus access, no recomputation — the JSON-is-canonical rendering pattern Phase 8's Compare page will also follow (D-02)"
    - "headlineEligible is derived from seasonLabel inside aggregateScores, never set independently by a caller — this is what makes D-09's tune/holdout discipline structural rather than an operator convention"

key-files:
  created:
    - packages/core/scoring/calibration.test.ts
    - packages/harness/score.ts
    - packages/harness/score.test.ts
    - packages/harness/artifact.ts
    - packages/harness/artifact.test.ts
    - packages/harness/statbotics.ts
    - packages/harness/report.test.ts
  modified:
    - packages/core/scoring/brier.ts
    - packages/core/scoring/calibration.ts
    - packages/core/scoring/brier.test.ts
    - packages/harness/report.ts
    - packages/harness/cli.ts

key-decisions:
  - "cli.ts was rewired to use score.ts's aggregateScores, artifact.ts's buildArtifact/writeArtifact, statbotics.ts's statboticsReference and report.ts's new renderHtmlReport, even though cli.ts is outside this plan's files_modified list — necessary because Task 1 and Task 3 changed the exported shapes cli.ts depended on (brier.ts's old brierScore/winnerAccuracy, report.ts's old ad hoc HarnessArtifact/writeArtifact), and pnpm typecheck is part of every task's own verify command. Kept strictly to the tracer's existing single-event scope; Plan 06's read_first for its Task 2 already expects cli.ts to be exactly this — 'the tracer's single-event entry point, which this task widens to a season range' — so no work was duplicated or foreclosed."
  - "statboticsReference always attempts a live fetch before falling back, rather than hardcoding straight to the fallback constant based on Plan 01's recon finding — a future Statbotics fix is picked up with no code change. Re-confirmed live during this plan's execution (2026-08-13): /v3/year/{year} and two alternate shapes still return HTTP 500."
  - "KNOWN STUB: STATBOTICS_REFERENCE_FALLBACK's five per-season values (~0.70-0.72) are best-available estimates, not individually verified against Statbotics' own published figures — their blog page renders numbers client-side from the same broken API, so this offline pipeline has no way to scrape a real value. The mechanism (schema, fetch-then-fallback, provenance labelling, no-throw-on-failure) is fully tested; the five numeric constants are not verified. Logged as an open stub in .planning/WINDOWS.md (entry #1) and flagged in-code."
  - "Per-season score bars and calibration reliability diagrams render only the 'combined' competition-level view, one chart per season — the score table still carries full qualification/elimination/combined splits, but charting only the combined view keeps the report legible rather than tripling every chart"
  - "The artifact schema carries a single algorithmId/algorithmVersion per run (not a per-slice algorithm dimension) — correct for Phase 1's single baseline (OPR); a multi-algorithm comparison shape is deferred until Sigma1/EPA exist and an actual comparison need arises"

patterns-established:
  - "Validate-before-write, twice: buildArtifact validates at construction, writeArtifact independently re-validates before touching disk — a test proves a hand-mutated artifact still fails at the write boundary even if it bypassed buildArtifact"
  - "Every boundary contract (tie, no-call, empty set, single element, exact 0.0/1.0, bin edge, empty bin) is proven by a hand-computed-expected-value test, not asserted by comment"

requirements-completed: [EVAL-02, EVAL-03, EVAL-04]

coverage:
  - id: D1
    description: "scoreSet (packages/core/scoring/brier.ts) and calibrationBins (packages/core/scoring/calibration.ts) implement every boundary contract this plan's must_haves require: 0.5-no-call exclusion, tie-scored-against-0.5, empty-set-returns-null, single-element, exact 0.0/1.0, bin-boundary-to-upper-bin, 1.0-to-final-bin, empty-bin-returns-null"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "packages/core/scoring/brier.test.ts (9 tests)"
        status: pass
      - kind: unit
        ref: "packages/core/scoring/calibration.test.ts (8 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "aggregateScores/seasonSplit (packages/harness/score.ts) produce one slice per season per competition-level view (qual/elim/combined), label 2022-2024 tune and 2025-2026 holdout, mark only holdout slices headlineEligible, and carry exclusion counts (offseason/surrogateAffected/missingResult) that sum with scoredCount to candidateCount"
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: "packages/harness/score.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "HarnessArtifactSchema/buildArtifact/writeArtifact (packages/harness/artifact.ts) produce a versioned, Zod-validated JSON artifact carrying run provenance, unrounded metrics, and per-slice calibration bins; an artifact missing a required field fails validation at both build and write time and is never written to disk"
    requirement: EVAL-02
    verification:
      - kind: unit
        ref: "packages/harness/artifact.test.ts (13 tests)"
        status: pass
      - kind: integration
        ref: "pnpm harness --event 2024casj --algorithm opr --out data/tracer-05 (manual smoke test, output deleted after inspection) — real artifact.json inspected: unrounded floats, correct exclusion/tie/no-call accounting (93 candidates = 84 scored + 2 tie + 7 no-call), no TBA_API_KEY value in output"
        status: pass
    human_judgment: false
  - id: D4
    description: "statboticsReference (packages/harness/statbotics.ts) attempts a live fetch, validates the response with Zod, and falls back to a dated manual constant on any failure (network error, non-2xx, schema mismatch) without throwing; the returned object always carries source label, season, match population and capture date"
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: "packages/harness/artifact.test.ts statboticsReference describe block (6 tests, incl. live-fetch, network failure, non-2xx, schema-mismatch, and disk-cache behaviors)"
        status: pass
    human_judgment: false
  - id: D5
    description: "renderHtmlReport (packages/harness/report.ts) renders a single self-contained HTML file from the artifact alone: score table, Statbotics reference table, per-season winner-accuracy bars, per-season calibration reliability diagrams; holdout rows visually distinguished, null metrics render an explicit n/a marker with their count rather than a fabricated 0, empty calibration bins omitted rather than plotted at zero, every interpolated string escaped, no src/href/script/link to anything off disk"
    requirement: EVAL-03
    verification:
      - kind: unit
        ref: "packages/harness/report.test.ts (10 tests)"
        status: pass
      - kind: integration
        ref: "pnpm harness --event 2024casj --algorithm opr smoke test — rendered report.html visually inspected (score table, Statbotics row, bar chart, calibration diagram with dots/diagonal all present and correctly formatted)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rendered report reads as a scoreboard against Statbotics (CONTEXT.md's Specific Ideas note) — legible layout, clear holdout/tune distinction, disclosure of exclusions adjacent to scores rather than buried"
    verification: []
    human_judgment: true
    rationale: "Visual/interpretive quality of the HTML (does it actually read clearly to a human, are the badges and colors legible, does the disclosure register as adequate) cannot be asserted by a unit test. Plan 06's Task 2 human-check explicitly covers opening the real full 2022-2026 report in a browser with networking disabled and confirming these same five points against real data."

duration: 40min
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 5: Scoring, Calibration, Tune/Holdout Discipline, Versioned Artifact & Scoreboard Report Summary

**Brier score, winner accuracy and reliability-diagram calibration with explicit tie/no-call/empty-set boundary contracts, a structurally-enforced tune/2022-24-vs-holdout/2025-26 season split, a Zod-validated versioned JSON artifact, and a self-contained HTML report that reads as a scoreboard against a Statbotics reference row — all proven end-to-end against the real 2024casj corpus.**

## Performance

- **Duration:** ~40 min (continuation of a session interrupted mid-Task-1 by an API session limit; this executor picked up uncommitted partial work, audited it against the plan, completed the missing test files, then executed Tasks 2 and 3 fresh)
- **Started:** 2026-08-13T16:00:00Z (approximate, continuation)
- **Completed:** 2026-08-13T16:13:38Z
- **Tasks:** 3
- **Files modified:** 12 (7 new + 5 modified)

## Accomplishments
- `packages/core/scoring/brier.ts`'s `scoreSet` extends the tracer's two bare functions into a structured result carrying Brier score, winner accuracy, and every boundary count (tie, no-call) the plan's must_haves require — proven against hand-computed fixture values, not asserted by comment
- `packages/core/scoring/calibration.ts`'s `calibrationBins` implements the reliability-diagram boundary rules explicitly: a probability on a bin boundary lands in the upper bin, exactly 1.0 lands in the final bin rather than overflowing, and an empty bin reports `null` (never `0`, never `NaN`) for both its mean predicted probability and observed frequency
- `packages/harness/score.ts`'s `aggregateScores`/`seasonSplit` make D-09's tune/holdout discipline structural: `headlineEligible` is derived from the season, not set independently, so a tune-season figure cannot be marked headline-eligible by mistake — and every excluded match (offseason, surrogate-affected, missing result) is counted, never silently dropped, with `scoredCount + exclusions === candidateCount` proven for every slice
- `packages/harness/artifact.ts`'s `HarnessArtifactSchema`/`buildArtifact`/`writeArtifact` make the JSON artifact a validated, versioned contract: an artifact missing a required field fails validation at both construction and write time and never reaches disk; metrics are stored unrounded (proven against full-precision computed values, not `toFixed`-rounded ones)
- `packages/harness/statbotics.ts`'s `statboticsReference` always attempts a live fetch first (re-confirmed still failing live, 2026-08-13) and falls back to a dated manual constant on any failure without ever throwing — the returned object always records which path produced the value
- `packages/harness/report.ts`'s `renderHtmlReport` renders one self-contained HTML file from the artifact alone (D-02: never recomputes, never touches the corpus): a score table split by season/qual/elim/combined with holdout rows visually distinguished, the Statbotics reference table alongside it, per-season winner-accuracy bars and per-season calibration reliability diagrams as hand-rolled inline SVG, every interpolated string escaped, and no `src`/`href`/`<script>`/`<link>` referencing anything off disk
- Ran `pnpm harness --event 2024casj --algorithm opr` end-to-end against the real corpus as a smoke test: the resulting `artifact.json` and `report.html` were inspected directly and both confirmed correct (unrounded floats, correct exclusion accounting, no `TBA_API_KEY` leakage, a legible rendered report with score table, Statbotics row, bar chart and calibration diagram all present)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scoring and calibration with explicit tie, no-call, empty and exclusion contracts** - `862dc1e7` (feat)
2. **Task 2: The versioned canonical JSON artifact and the Statbotics reference row** - `3be66ec7` (feat)
3. **Task 3: The self-contained HTML report — scoreboard table and calibration charts** - `f3509f0b` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/core/scoring/brier.ts` - `scoreSet`, `outcomeTarget` — Brier/accuracy with tie/no-call/empty-set contracts
- `packages/core/scoring/brier.test.ts` - Boundary-contract tests (9 tests)
- `packages/core/scoring/calibration.ts` - `calibrationBins` — reliability-diagram binning
- `packages/core/scoring/calibration.test.ts` - Boundary/empty-bin/sum-invariant tests (8 tests)
- `packages/harness/score.ts` - `aggregateScores`, `seasonSplit`, `TUNE_SEASONS`, `HOLDOUT_SEASONS` — season/view/exclusion aggregation
- `packages/harness/score.test.ts` - Aggregation/labelling/exclusion-invariant tests (9 tests)
- `packages/harness/artifact.ts` - `HarnessArtifactSchema`, `buildArtifact`, `writeArtifact`, `ARTIFACT_SCHEMA_VERSION`
- `packages/harness/artifact.test.ts` - Schema/round-trip/unrounded-metrics/statbotics/secret-scrub tests (13 tests)
- `packages/harness/statbotics.ts` - `statboticsReference`, `STATBOTICS_REFERENCE_FALLBACK`
- `packages/harness/report.ts` - `renderHtmlReport`, `escapeHtml` — rewritten to render only from the validated artifact
- `packages/harness/report.test.ts` - Score table/Statbotics table/bars/calibration/escaping/determinism tests (10 tests)
- `packages/harness/cli.ts` - Rewired to `aggregateScores`/`buildArtifact`/`writeArtifact`/`statboticsReference`/new `renderHtmlReport` (still single-event scope)

## Decisions Made
See `key-decisions` in frontmatter for full rationale. Summary:
- `cli.ts` was rewired to the new module boundaries (blocking fix, not scope creep — required for `pnpm typecheck` to pass, and matches exactly what Plan 06 already expects to find)
- `statboticsReference` always attempts a live fetch before falling back, future-proofing against a Statbotics fix
- The Statbotics fallback's five numeric constants are an explicitly-flagged Known Stub (see below), not verified published figures
- Calibration/bar charts render only the "combined" view per season, keeping the report legible while the score table still carries the full qual/elim/combined split
- The artifact schema is single-algorithm-per-run, correct for Phase 1's one baseline (OPR)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/harness/cli.ts` broke after Task 1 removed `brier.ts`'s old `brierScore`/`winnerAccuracy` exports**
- **Found during:** Task 1, `pnpm typecheck`
- **Issue:** The plan's own action explicitly required extending `brier.ts`'s two bare functions into `scoreSet` (a structured result), which necessarily removes the old exports `cli.ts` imported.
- **Fix:** Updated `cli.ts` to build `ScoredPrediction[]` (using `actualWinner` instead of the old `redWon` boolean) and call `scoreSet`, with an explicit fail-loud error if the result is somehow null rather than silently writing a fabricated zero.
- **Files modified:** `packages/harness/cli.ts`
- **Verification:** `pnpm typecheck` exits 0; `pnpm test` all green
- **Committed in:** `862dc1e7` (Task 1 commit)

**2. [Rule 3 - Blocking] `packages/harness/cli.ts` broke again after Task 3 removed `report.ts`'s tracer-era `HarnessArtifact`/`PredictionArtifactRecord`/`writeArtifact` exports**
- **Found during:** Task 3, `pnpm typecheck`
- **Issue:** Task 2 moved `writeArtifact` (and the formal, Zod-validated `HarnessArtifact` shape) to `artifact.ts`; Task 3's `report.ts` rewrite correctly narrowed its exports to `renderHtmlReport`/`escapeHtml` per the plan's own `must_haves.artifacts` list, but `cli.ts` still imported the old symbols.
- **Fix:** Rewired `cli.ts`'s single-event flow to build `HarnessPredictionInput[]` records (deriving `season` from the event key's leading 4 digits, `isOffseason` from a small events-table query, `isSurrogateAffected` from `redSurrogates`/`blueSurrogates` length), call `aggregateScores`, fetch the season's `statboticsReference`, and build/write the artifact via `artifact.ts`'s `buildArtifact`/`writeArtifact`. Kept strictly to the tracer's existing single-event scope — no `--seasons` range, no `buildSeasonStream` — since Plan 06 Task 2 explicitly owns that widening and its own `read_first` already expects `cli.ts` to still be "the tracer's single-event entry point" at that point.
- **Files modified:** `packages/harness/cli.ts`
- **Verification:** `pnpm typecheck` exits 0; `pnpm test` all green (107/107); `pnpm harness --event 2024casj --algorithm opr --out data/tracer-05` run for real against the live corpus, output inspected and confirmed correct, then deleted (gitignored `data/` directory, nothing to clean up in git)
- **Committed in:** `f3509f0b` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking-issue fixes, both required for `pnpm typecheck` — part of every task's own `<verify>` command — to keep passing after this plan's own required module restructuring). No Rule 4 architectural changes were needed.
**Impact on plan:** Both fixes were necessary consequences of the plan's own explicitly-required changes (removing `brier.ts`'s old exports, narrowing `report.ts`'s exports). No scope creep beyond what compilation demanded — `cli.ts`'s widening to a season range remains entirely Plan 06's job.

## Known Stubs

**`packages/harness/statbotics.ts`'s `STATBOTICS_REFERENCE_FALLBACK`** — the five per-season values (2022: 0.70, 2023: 0.70, 2024: 0.71, 2025: 0.71, 2026: 0.71) are best-available estimates of Statbotics' publicly-stated EPA winner-prediction accuracy, not individually verified against Statbotics' own published blog/site figures for each season. Statbotics' `/v3/year/{year}` endpoint reproducibly returns HTTP 500 (confirmed by Plan 01's recon, and re-confirmed live during this plan's execution across three URL shapes plus two additional shapes tried this session); their blog page renders its numbers client-side from that same broken API, and this offline pipeline has no browser-rendering capability to work around that. The mechanism around these values — live-fetch attempt, Zod validation, graceful fallback, provenance labelling (`fetched: true/false`, `sourceLabel`), never throwing — is fully implemented and tested (13 tests in `artifact.test.ts` cover live-fetch, network failure, non-2xx, schema-mismatch, and disk-caching paths). Only the five numeric constants themselves are unverified. **Logged as an open entry in `.planning/WINDOWS.md` (entry #1, kind: stub).** A human with browser access to statbotics.io should replace these with individually-sourced, cited values before any report is treated as a real comparison claim — this does not block Phase 1's own success criteria (which require a "clearly-labelled" reference row, which this delivers), but does block treating the specific numbers as trustworthy.

## Issues Encountered
None beyond the two auto-fixed deviations above and the one documented Known Stub.

## User Setup Required

None - no external service configuration required beyond the existing `.env` (unchanged from Plan 01).

## Next Phase Readiness
- Plan 06 depends on this plan's `score.ts`, `artifact.ts` and `report.ts` — all three exist with exactly the exports Plan 06's own `read_first`/`key_links` name (`aggregateScores`, `buildArtifact`/`writeArtifact`, `renderHtmlReport`)
- `cli.ts` is already wired to all three modules for the single-event case, ahead of where Plan 06 expected to find it — Plan 06's Task 2 only needs to widen the CLI to a `--seasons` range (via `buildSeasonStream`, built in Plan 06's own Task 1), not build the wiring from scratch
- The one open item before Phase 1's report can be treated as a trustworthy published comparison: replace `STATBOTICS_REFERENCE_FALLBACK`'s five estimated values with individually-verified figures (see Known Stubs above and `.planning/WINDOWS.md` entry #1)
- No blockers identified for Plan 06 (full 2022-2026 season run + human-reviewed report), which depends on Plans 03, 04 and this plan

---
*Phase: 01-data-foundation-evaluation-harness*
*Completed: 2026-08-13*

## Self-Check: PASSED

All 7 newly-created artifacts confirmed present on disk (`calibration.test.ts`, `score.ts`, `score.test.ts`, `artifact.ts`, `artifact.test.ts`, `statbotics.ts`, `report.test.ts`). All 3 referenced task commit hashes (`862dc1e7`, `3be66ec7`, `f3509f0b`) confirmed present in `git log`. Full suite re-verified: `pnpm test` 107/107 passing, `pnpm typecheck` exits 0.
