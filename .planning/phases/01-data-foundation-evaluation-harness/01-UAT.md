---
status: complete
phase: 01-data-foundation-evaluation-harness
source: 01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md
started: 2026-08-19T02:55:00Z
updated: 2026-08-19T03:12:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Root toolchain installs, typechecks, and tests green
expected: Root toolchain (package.json/pnpm-workspace.yaml/tsconfig.json/vitest.config.ts) installs, typechecks, and runs an empty test suite green
result: pass
source: automated
coverage_id: 01-01/D1

### 2. better-sqlite3 loads without a node-gyp build
expected: better-sqlite3 native module loads and executes SQL without a node-gyp build step
result: pass
source: automated
coverage_id: 01-01/D2

### 3. TBA API key is unstageable and absent from output
expected: TBA API key is provably unstageable (.env gitignored) and provably absent from generated output
result: pass
source: automated
coverage_id: 01-01/D3

### 4. Field recon answers both RESEARCH open questions from observed data
expected: docs/data/tba-field-recon.md answers both RESEARCH.md Open Questions (TBA RP field coverage 2022-2026; Statbotics endpoint resolution) with observed, not assumed, data
result: pass
source: automated
coverage_id: 01-01/D4

### 5. Algorithm contract types defined as specified
expected: packages/core/algorithms/types.ts defines the AlgorithmModule<S>/UpcomingMatch/MatchResult/Prediction contract exactly as specified in the plan's interfaces block
result: pass
source: automated
coverage_id: 01-02/D1

### 6. OPR baseline produces real ridge-regularized ratings
expected: OPR baseline (packages/core/algorithms/opr.ts) computes real, non-placeholder ratings via ridge-regularized least squares and produces a calibrated win probability
result: pass
source: automated
coverage_id: 01-02/D2

### 7. TBA ingestion is ETag-conditional, Zod-validated, quirk-aware
expected: tbaClient.ts + schemas.ts + normalize.ts + db.ts fetch an event and its matches with ETag-conditional requests, Zod-validate at the boundary, and store quirk-aware rows
result: pass
source: automated
coverage_id: 01-02/D3

### 8. Walk-forward simulator structurally enforces predict-before-update
expected: WalkForwardSimulator + toLeakProofUpcoming structurally enforce predict-before-update; reading an outcome field before update() throws
result: pass
source: automated
coverage_id: 01-02/D4

### 9. Artifact and self-contained HTML report from one run, no key leakage
expected: Both the canonical JSON artifact and a self-contained, escaped HTML report are produced from one harness run; no TBA API key value appears in either output
result: pass
source: automated
coverage_id: 01-02/D5

### 10. Corpus schema and deterministic chronological total order
expected: Corpus schema covers teams/events/matches/http_cache/ingest_runs with every DATA-02 quirk column, and selectMatchesChronological is a proven deterministic total order with eventKey/year/excludeOffseason filters
result: pass
source: automated
coverage_id: 01-03/D1

### 11. TBA client hardened for full backfill
expected: TbaRequestCounter tallies 200/304 separately, a named-constant throttle is enforced inside tbaFetch, and the client exposes helpers for exactly the eight COVERAGE.md INTEGRATE capabilities and none marked OPT-OUT
result: pass
source: automated
coverage_id: 01-03/D2

### 12. Every DATA-02 quirk is an explicit queryable flag
expected: Surrogates, disqualifications, replays, missing score breakdowns (never zero-defaulted), offseason events, unplayed matches (NULL not 0), ties, and RP awards are all explicit flags
result: pass
source: automated
coverage_id: 01-03/D3

### 13. Full 2022-2026 backfill, second run costs only 304s
expected: `pnpm ingest --years 2022-2026` populates the corpus for all five seasons, and a second consecutive run downloads no match payload
result: pass
source: automated
coverage_id: 01-03/D4

### 14. OPR recovers synthetic strengths, never NaN/Infinity
expected: OPR is a season-pooled, ridge-regularized baseline that recovers known synthetic team strengths within a documented tolerance and never produces NaN/Infinity even in an under-determined cold start
result: pass
source: automated
coverage_id: 01-04/D1

### 15. Tuning constants exported with reasoning; SVD-based solve
expected: OPR_RIDGE_LAMBDA and OPR_LOGISTIC_SCALE are exported constants with reasoning comments, and the solve runs via ml-matrix's SingularValueDecomposition
result: pass
source: automated
coverage_id: 01-04/D2

### 16. Ratings pool across all events attended this season
expected: A team's rating pools observations across every event it has attended so far this season, not just the current event
result: pass
source: automated
coverage_id: 01-04/D3

### 17. predict and update are pure
expected: Both return new values and leave their state/input arguments unmutated, proven by reference and structural snapshot comparison
result: pass
source: automated
coverage_id: 01-04/D4

### 18. Surrogate modeling policy resolved (D-07)
expected: A surrogate's own rating is unaffected by its surrogate appearance, while its teammates still receive a correctly offset observation
result: pass
source: automated
coverage_id: 01-04/D5

### 19. Disqualification policy implemented and reasoned
expected: The DQ policy (opposite of surrogates: keep the column, update the rating) is implemented, tested, and its reasoning recorded adjacent to ratingEligibleTeams
result: pass
source: automated
coverage_id: 01-04/D6

### 20. packages/core cannot drift into Node-only code
expected: An architectural fitness test fails if packages/core gains a Node-only or better-sqlite3 dependency; the test cannot pass vacuously
result: pass
source: automated
coverage_id: 01-04/D7

### 21. Brier and calibration boundary contracts
expected: scoreSet and calibrationBins implement every boundary contract: 0.5-no-call exclusion, tie-scored-against-0.5, empty-set-returns-null, single-element, exact 0.0/1.0, bin-boundary-to-upper-bin, 1.0-to-final-bin, empty-bin-returns-null
result: pass
source: automated
coverage_id: 01-05/D1

### 22. Tune/holdout split and headline eligibility
expected: One slice per season per competition-level view (qual/elim/combined), 2022-2024 labelled tune and 2025-2026 holdout, only holdout slices headlineEligible, exclusion counts sum with scoredCount to candidateCount
result: pass
source: automated
coverage_id: 01-05/D2

### 23. Versioned Zod-validated artifact, never written when invalid
expected: HarnessArtifactSchema/buildArtifact/writeArtifact produce a versioned artifact with run provenance, unrounded metrics, and per-slice calibration bins; an artifact missing a required field fails validation at both build and write time
result: pass
source: automated
coverage_id: 01-05/D3

### 24. Statbotics reference fetch with dated fallback, never throws
expected: statboticsReference attempts a live fetch, Zod-validates, and falls back to a dated manual constant on any failure without throwing; always carries source label, season, match population, capture date
result: pass
source: automated
coverage_id: 01-05/D4

### 25. Report renders self-contained from the artifact alone
expected: renderHtmlReport produces a single self-contained HTML file from the artifact alone — score table, Statbotics table, accuracy bars, calibration diagrams; holdout rows distinguished, nulls render explicit n/a not 0, empty bins omitted, everything escaped, no off-disk references
result: pass
source: automated
coverage_id: 01-05/D5

### 26. Whole-season stream interleaves concurrent events correctly
expected: buildSeasonStream returns one chronological match list per season across all its events — concurrent events interleave by time, stable total order, predict-before-update holds across event boundaries, offseason excluded by default, read-only corpus handle
result: pass
source: automated
coverage_id: 01-06/D1

### 27. CLI widened to --season/--seasons with progress reporting
expected: cli.ts supports --season/--seasons (read-only, no network) alongside --event; --out defaults to reports/; --include-offseason controls replay inclusion; per-season progress line prints replayed/scorable/excluded counts
result: pass
source: automated
coverage_id: 01-06/D2

### 28. Full-corpus run is reproducible
expected: Two consecutive full 2022-2026 runs produce artifacts identical in every field once provenance.runTimestamp is removed, with slices for all five seasons and only 2025/2026 headlineEligible
result: pass
source: automated
coverage_id: 01-06/D3

### 29. Incremental Sherman-Morrison solve is exact, not approximate
expected: OPR's update() uses an incremental RLS solve whose ratings match solveRidgeOpr's from-scratch batch solve exactly over the same accumulated observations, making full-season replay tractable
result: pass
source: automated
coverage_id: 01-06/D4

### 30. Scoreboard report reads clearly (plan-05 render contract)
expected: reports/full/report.html reads as a scoreboard against Statbotics — legible layout, clear holdout/tune distinction, exclusion disclosure adjacent to the scores it qualifies rather than buried
result: pass
coverage_id: 01-05/D6

### 31. Full-corpus report presents all five seasons legibly
expected: reports/full/report.html shows a score table with qual/elim/combined columns for 2022-2026, a clearly-labelled Statbotics reference row per season, 2025/2026 visually distinguished as the only headline-eligible rows, a calibration reliability diagram with the perfect-calibration diagonal per season, and exclusion/tie/no-call counts next to each score
result: pass
coverage_id: 01-06/D5

## Summary

total: 31
passed: 31
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
