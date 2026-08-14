---
phase: 02-prediction-models-epa-sigma1
plan: 05
subsystem: algorithms
tags: [jsonl, sidecar, zod, sigma1, harness, cli, vitest]

# Dependency graph
requires:
  - phase: 02-prediction-models-epa-sigma1
    provides: "AlgorithmModule contract (D-27), shared-stream runAll with the unused onMatchComplete hook (02-01), Sigma1's assembled sigma1/sigma1SeasonSd/sigma1NormalCdf modules (02-04)"
provides:
  - "predictions.ts: PredictionRecordSchema/PersistedPredictionRecord — streaming JSONL writer for one (match, algorithm) prediction per line, full component vectors, variance present exactly where an algorithm models it (D-23/D-24/D-25)"
  - "metricHistory.ts: MetricHistoryRowSchema — streaming JSONL writer for the 6 involved teams' teamMetrics after every match, per algorithm (D-28)"
  - "cli.ts ALGORITHMS registry extended to 5 entries (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf) — D-12's three link modes scored side by side in one run"
  - "cli.ts --predictions-out / --metric-history flags wiring both sidecars through runSeasons' per-season open/close loop"
affects: [phase-03-hyperparameter-tuning, phase-04-publishing, phase-06-team-page, phase-07-event-page, phase-08-compare-page]

actuals:
  tokens: 12300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Streaming validate-then-append writer (open/write/close triple) reused identically across predictions.ts and metricHistory.ts — a fresh fd per season, truncate-on-open, one Zod-validated line at a time"
    - "onMatchComplete (02-01's previously-unused runAll hook) as the single seam for per-match, per-algorithm side effects — no second replay pass"

key-files:
  created:
    - packages/harness/predictions.ts
    - packages/harness/predictions.test.ts
    - packages/harness/metricHistory.ts
    - packages/harness/metricHistory.test.ts
  modified:
    - packages/harness/cli.ts
    - packages/harness/replay.multiAlgorithm.test.ts

key-decisions:
  - "redComponents/blueComponents are a required field on PersistedPredictionRecord, but validly empty ({}) for an algorithm (OPR) whose Prediction never populates them — D-24's 'full component vectors, not totals-only' is a schema capability, not a per-algorithm mandate; OPR's Prediction type genuinely carries no components today"
  - "Alliance-total variance and per-component variance are both z.number().optional() and simply omitted (JSON.stringify drops undefined keys) rather than written as 0 — verified on real 2024 output: 0 of 85,145 OPR records have a variance key anywhere"
  - "predictions-{season}.jsonl and metrics-{season}.jsonl both open with fs 'w' (truncate), not 'a' (append) — a fresh replay produces a fresh sidecar per season, never a mix of two runs' lines, matching writeArtifact's single-writer-per-run semantics"
  - "metric-history's matchIndex is the match's position in the season's own buildSeasonStream order (shared across every algorithm), not a per-team or per-algorithm counter — precomputed once via a Map before the replay loop starts"
  - "Both season-path sidecar writers are passed secretToScrub: undefined with an inline comment, not silently omitted — runSeasonsMode never has the TBA API key in scope (openCorpusReadOnly, no network calls)"
  - "replay.ts needed no code change: 02-01's onMatchComplete hook already fires after update() with the post-update state, exactly D-28's contract — only replay.multiAlgorithm.test.ts gained a regression proving the ordering property, closing the gap between 'exists' and 'proven'"

patterns-established:
  - "A plan's own literal <verify> script can sample a pathological edge case (here: the season's first-ever match, predicted before Sigma1's componentOrder is ever resolved by update()) — re-sampling a representative match and documenting why is the correct response, not treating the script as unquestionable"

requirements-completed: [ALGO-07, ALGO-03]

coverage:
  - id: D1
    description: "Every replayed match has, for every algorithm in a run, a persisted JSONL record carrying predicted winner, win probability, predicted red/blue scores, and full component vectors — Sigma1's carrying alliance-total and per-component variance, OPR's carrying neither field at all (never a zero)"
    requirement: ALGO-07
    verification:
      - kind: unit
        ref: "packages/harness/predictions.test.ts (all describe blocks)"
        status: pass
      - kind: integration
        ref: "reports/sidecars/predictions-2024.jsonl — 85,145 lines (17,029 matches x 5 algorithms), 0 OPR records carry a variance key anywhere (alliance-total or per-component), every Sigma1 record does"
        status: pass
    human_judgment: false
  - id: D2
    description: "Predictions stream to predictions-{season}.jsonl beside artifact.json, never into the corpus; a writer closed mid-sequence leaves a file whose every complete line parses; lines for one match are contiguous in stable algorithm order"
    requirement: ALGO-07
    verification:
      - kind: unit
        ref: "packages/harness/predictions.test.ts#D-25 interrupted-run property, #contiguous per-match algorithm order"
        status: pass
      - kind: integration
        ref: "reports/sidecars/predictions-2024.jsonl — every one of 17,029 matches has exactly 5 contiguous lines"
        status: pass
    human_judgment: false
  - id: D3
    description: "After each match the six involved teams' teamMetrics are snapshotted into metrics-{season}.jsonl for every algorithm, from inside runAll's existing loop via the (previously unused) onMatchComplete hook — no second corpus pass"
    requirement: ALGO-07
    verification:
      - kind: unit
        ref: "packages/harness/metricHistory.test.ts (integration describe block), packages/harness/replay.multiAlgorithm.test.ts#D-28 onMatchComplete ordering regression"
        status: pass
      - kind: integration
        ref: "reports/sidecars/metrics-2024.jsonl — 510,870 rows, exactly 6 per (match, algorithm) across all 85,145 groups"
        status: pass
    human_judgment: false
  - id: D4
    description: "cli.ts's ALGORITHMS registry carries all 5 entries (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf); one real 2024 run scores all 5 over the shared stream, with Sigma1's three link modes producing identical predicted scores but at least two distinct win probabilities on a sampled match, and reports/, data/ staying untracked"
    requirement: ALGO-07
    verification:
      - kind: integration
        ref: "pnpm harness --season 2024 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --metric-history --out reports/sidecars (real run, exit 0); reports/sidecars/artifact.json carries algorithms.length === 5; sampled match 2024mibro_qm67: identical predictedRedScore/predictedBlueScore across all 3 sigma1 variants, pRedWin = {0.821, 0.702, 0.936}; git status --porcelain reports/ data/ empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "Whether the ~58-minute real-corpus 2024/5-algorithm run time (dominated by OPR's per-match cost and metric-history's ~511K-row write volume) is an acceptable baseline for Phase 3's tune-season backtests and Phase 4's incremental-update budget"
    verification: []
    human_judgment: true
    rationale: "This plan measures and reports the real run time and sidecar file sizes (395MB metrics, 144MB predictions for one season, five algorithms); whether that scales acceptably to Phase 3's 2022-2024 tune-season sweep or needs a compiled build / narrower default sidecar scope is a planning judgment for those phases, not something this plan's tests can adjudicate."

duration: ~95min (dominated by a ~58min real 2024/5-algorithm harness run)
completed: 2026-08-14
status: complete
---

# Phase 02 Plan 05: Prediction & Metric-History Sidecars Summary

**Every (match, algorithm) prediction from a 2024/5-algorithm run now persists to a streaming, Zod-validated `predictions-2024.jsonl` with full component vectors and honest-absent variance, every match's 6 involved teams' metrics snapshot to `metrics-2024.jsonl` from inside the existing replay loop, and `cli.ts` scores OPR, EPA, and all three Sigma1 link modes side by side in one run.**

## Performance

- **Duration:** ~95 min total, of which ~58 min was one real `pnpm harness --season 2024 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --metric-history --out reports/sidecars` invocation against the full 2024 corpus (17,029 matches, 5 algorithms, 510,870 metric-history rows)
- **Tasks:** 3
- **Files modified:** 6 across 3 commits (4 new files, 2 modified)

## Accomplishments

- **The prediction sidecar is real, streaming, and validated — not an end-of-run dump.** `predictions.ts` opens one fd per season (truncate-on-open), validates each `PersistedPredictionRecord` through `PredictionRecordSchema`, and appends it as one JSON line before moving to the next — proven by a test that closes the writer after 5 of 10 intended records and asserts the file's 5 lines all parse (D-25).
- **Variance is honestly absent, never a zero.** Verified against real 2024 output, not just synthetic fixtures: 0 of 85,145 OPR prediction records carry a `variance` key anywhere (alliance-total or per-component); every Sigma1 record does.
- **D-28's metric-history snapshot cost 4 lines of wiring, not a second replay.** `runAll`'s `onMatchComplete` hook, built in 02-01 and unused until now, already fires after `update()` with the post-update state — exactly the "state including this match" contract D-28 needs. `replay.ts` required no code change at all; only a new regression test (`replay.multiAlgorithm.test.ts`) proving the once-per-(match,algorithm)/strictly-after-update ordering property.
- **All 5 algorithm entries scored in one real run.** `cli.ts`'s `ALGORITHMS` registry now carries `opr`, `epa`, `sigma1`, `sigma1-seasonsd`, `sigma1-normalcdf`. `reports/sidecars/artifact.json` carries all 5 in `algorithms[]`; every one of 17,029 matches has exactly 5 contiguous prediction lines and 6 metric rows per algorithm (510,870 total).
- **D-12's "one run, three modes, side by side" is now an observable fact on real data, not a synthetic-fixture proof.** Sampled match `2024mibro_qm67`: all three Sigma1 variants predict identical scores (50.81 red / 33.24 blue, since `update`'s state-transition math is shared) but disagree on win probability — `pRedWin` = 0.821 (predictive-variance), 0.702 (season-sd), 0.936 (normal-cdf).
- **The threat model's three `mitigate` items are all closed and tested:** T-02-02 (secret-scrub, both writers, throw-before-write), T-02-13 (corpus stays read-only — `runSeasonsMode` still uses `openCorpusReadOnly`), T-02-14 (every record parsed through its Zod schema before serialization).
- Test suite 249 → 271 (22 new tests across 3 files); `pnpm typecheck` and `pnpm test` both exit 0.

## Task Commits

1. **Task 1: JSONL prediction sidecar** — `7bb9e90e` (test)
2. **Task 2: Per-match team metric snapshots** — `9aafa611` (test)
3. **Task 3: Register Sigma1's three link modes, wire both sidecars into cli.ts** — `d6293061` (feat)

## Files Created/Modified

- `packages/harness/predictions.ts` — `PredictionRecordSchema`/`PersistedPredictionRecord`, `PREDICTIONS_SCHEMA_VERSION`, `openPredictionsWriter`/`writePredictionLine`/`closePredictionsWriter`
- `packages/harness/predictions.test.ts` — 9 tests covering every Task 1 behavior bullet, including a round-trip re-validation
- `packages/harness/metricHistory.ts` — `MetricHistoryRowSchema`, `openMetricHistoryWriter`/`writeMetricHistoryRows`/`closeMetricHistoryWriter`
- `packages/harness/metricHistory.test.ts` — writer unit tests plus an integration test driving `WalkForwardSimulator.runAll` directly (36-row 3-algorithm/2-match fixture, surrogate inclusion, spread presence)
- `packages/harness/replay.multiAlgorithm.test.ts` — new D-28 regression: `onMatchComplete` fires once per (match, algorithm), strictly after that pair's own `update`
- `packages/harness/cli.ts` — `ALGORITHMS` registry extended to 5 entries; `RunSeasonsSidecarConfig`; `runSeason`/`runSeasons`/`runSeasonsMode` thread optional `predictionsWriter`/`metricHistoryWriter` through the season loop, opening/closing each per season boundary; `--predictions-out`/`--metric-history` CLI flags

## Decisions Made

- `redComponents`/`blueComponents` are a required schema field but validly `{}` for OPR, whose `Prediction` type carries no components today — D-24's "full component vectors" is a schema capability the file always supports, not a per-algorithm mandate every algorithm must currently satisfy.
- Both sidecar files open with `"w"` (truncate), not `"a"` (append) — one writer's lifetime is exactly one season of one run, matching `writeArtifact`'s single-writer-per-run discipline.
- `metricIndex`/`matchIndex` is the match's position in the season's shared chronological stream (one `Map` built once before the replay loop), not a per-team or per-algorithm counter.
- Both season-path writers pass `secretToScrub: undefined` with an inline comment rather than a silent omission — the season/seasons path is read-only against the corpus and never has the TBA API key in scope.
- `replay.ts` needed zero code changes — 02-01's `onMatchComplete` hook already satisfied D-28's contract exactly; only test coverage was missing.

## Deviations from Plan

### Auto-fixed Issues

None — Rules 1-3 did not trigger; no bugs, missing critical functionality, or blocking issues were found in the plan's own scope.

### Discretionary adjustment (not a code deviation)

**1. [Discretion] Task 3's literal `<verify>` sample match hit a genuine cold-start edge case**

- **Found during:** Task 3's real-run verification, running the plan's `<verify>` node script verbatim.
- **Issue:** The script samples `L[0].matchKey` (the file's first line) to check the three Sigma1 variants disagree on `pRedWin`. The season's first-ever match predicts BEFORE `sigma1/index.ts`'s `update()` has ever run once, so `Sigma1State.componentOrder` is still `[]` (02-04's `initState()` leaves it empty until the first `update()` resolves a season) — every alliance's component sum is trivially `{}`, `predictedRedScore`/`predictedBlueScore` are both exactly `0`, margin is exactly `0`, and every link mode's own documented boundary handling (`predict()`'s doc comment) gives `pRedWin === 0.5` for all three modes identically. This is correct, pre-existing (02-04) cold-start behavior, not a bug this plan introduced.
- **Resolution:** Re-ran the identical assertions against a mid-season match (`2024mibro_qm67`, the 5001st distinct match key) instead of the literal first line. All three variants: identical predicted scores (50.807/33.236), three distinct win probabilities (0.821/0.702/0.936) — the property the acceptance criterion actually intends. The `byMatch` "exactly 5 lines per match" check (which does NOT depend on the sampled match) ran against all 17,029 matches unmodified and passed before this substitution was needed.
- **No code change** — this is a verification-methodology adjustment, documented here per the executor's discretion to substitute a representative sample when a plan's literal script targets an edge case, not a fix to `predictions.ts`/`metricHistory.ts`/`cli.ts`.

---

**Total deviations:** 0 auto-fixed; 1 documented discretionary verification-sampling adjustment.
**Impact on plan:** No scope creep, no code change outside the plan's own file list. The substituted sample proves the intended property; the literal script's edge case is now documented rather than silently worked around.

## Issues Encountered

- **The real 2024/5-algorithm run took ~58 minutes** (vs. 02-03's ~16-23 min/season for 2 algorithms) — dominated by two additive costs: OPR's O(n²)-per-match Sherman-Morrison update (unchanged from prior plans, present regardless of the other 4 algorithms), and `--metric-history`'s 510,870-row write volume across the season (metrics-2024.jsonl: 395MB; predictions-2024.jsonl: 144MB). Both sidecars are gitignored and were left in place after the run for this summary's measurements; carried forward as a real number for Phase 3/4 runtime and payload budgeting (see coverage D5, a flagged human-judgment item, not silently assumed acceptable).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready.** Every artifact SC-4 requires now exists and is proven against real 2024 data: per-match, per-algorithm predictions with full component vectors and honest variance presence, and per-match team metric snapshots ready for Phase 6's metric-history plot and Phase 7's Breakdown tab to read directly, without a recompute.

**Carry forward:**
- Phase 3's tune-season sweep (2022-2024) should budget real wall-clock time using this plan's measured ~58 min/season/5-algorithm figure as a starting point, not the smaller 2-algorithm figure from 02-03 — coverage D5 flags this explicitly for human judgment before Phase 3/4 planning locks in a runtime/payload budget.
- `metrics-{season}.jsonl`'s real per-season size (395MB for 2024 alone) is a concrete number for Phase 4's "compact precomputed artifact" design to react to — `--metric-history` staying opt-in (default off) is the mitigation already in place; whether Phase 4's published artifact needs a coarser format (e.g. sampled matchIndex intervals rather than every match) is an open question for that phase, not this one.
- Plan 02-06 (full 2022-2026 range, per ROADMAP) inherits this plan's sidecar writers unchanged — no further wiring needed, only a wider `--seasons` argument.
- **Open judgment call carried forward (coverage D5):** the ~58-minute/season runtime and ~540MB/season combined sidecar volume are measured facts, not yet judged acceptable or unacceptable for Phase 3/4's budgets.

---
*Phase: 02-prediction-models-epa-sigma1*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 7 created/modified files (predictions.ts, predictions.test.ts, metricHistory.ts, metricHistory.test.ts, cli.ts, replay.multiAlgorithm.test.ts, this SUMMARY.md) verified present on disk; all 3 task commit hashes (`7bb9e90e`, `9aafa611`, `d6293061`) verified present in `git log --oneline --all`.
