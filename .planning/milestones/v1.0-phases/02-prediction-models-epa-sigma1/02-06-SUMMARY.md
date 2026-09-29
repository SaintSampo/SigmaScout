---
phase: 02-prediction-models-epa-sigma1
plan: 06
subsystem: prediction-models
tags: [epa, sigma1, opr, identifiability, svd, ml-matrix, walk-forward, brier-score, vitest]

# Dependency graph
requires:
  - phase: 02-prediction-models-epa-sigma1 (plans 01-05)
    provides: EPA and Sigma1 AlgorithmModule implementations, corpus, breakdown maps, harness CLI, prediction/metric-history sidecars
provides:
  - "Runnable SC-3 identifiability check (packages/harness/identifiability.ts) with a committed, reproducible connected-components pass for rank-deficient seasons"
  - "docs/models/sigma1-identifiability.md: every Sigma1 state dimension, thresholds, D-06 reasoning, foul weakness measured, SC-2 blocked record"
  - "docs/models/epa-divergences.md: every deliberate EPA divergence from Statbotics (D-13)"
  - "One 5-algorithm (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf) x 5-season (2022-2026) head-to-head artifact and report (reports/full-v2/, gitignored)"
  - "Measured per-match update cost for every algorithm, including EPA's over-budget p99"
  - "ALGO-02 walk-forward-at-any-point-in-a-season boundary-by-boundary adjudication, including a new test closing the one named gap (EPA event-boundary invariance)"
affects: [phase-3-hyperparameter-tuning, phase-4-cloudflare-worker-incremental-path]

# Actuals (#2632)
actuals:
  tokens: 18700
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "SVD-based identifiability check (never hand-rolled rank/elimination) over a fixed, seeded event sample, with an explicit numeric pass/fail threshold stated and justified in the script header"
    - "Deterministic union-find over the alliance-PARTNERSHIP graph (teammates only, never opponents or same-event attendees) to attribute rank deficiency to specific disconnected event islands, shipped in the script rather than left as an ad-hoc pass"
    - "Sampled high-resolution per-match update-cost timing (opt-in --measure-update-cost flag), zero overhead when absent"

key-files:
  created:
    - packages/harness/identifiability.ts
    - docs/models/sigma1-identifiability.md
    - docs/models/epa-divergences.md
  modified:
    - packages/harness/cli.ts
    - package.json
    - packages/core/algorithms/epa.test.ts

key-decisions:
  - "Gap 1 (checkpoint follow-up): identifiability.ts now ships computeConnectedComponents, a deterministic union-find over the seeded sample, run automatically whenever a season's design matrix is not full column rank — emitted into reports/identifiability.json's connectedComponents field so the rank-deficiency diagnosis is reproducible by re-running pnpm identifiability, not merely asserted in prose."
  - "Re-running the committed pass produced a DIFFERENT, more granular result than the prior ad-hoc pass (2022: 7 components not 4; 2024: 3 components not 2) — sigma1-identifiability.md was corrected to match the committed script's output, per this project's honesty discipline (do not tune the script to match the prose)."
  - "The connectivity model is alliance-PARTNERSHIP (teammates sharing a row), never opponents or same-event attendees — this is the exact connectivity the design matrix's own rank measures, and it is finer-grained than 'same event,' which explains why the corrected pass finds small additional islands (sparse-recording/placeholder-alliance artifacts) the looser prior pass missed."
  - "Gap 2 (checkpoint follow-up): added a test pinning EPA's event-boundary invariance — epa.update()'s resulting state is identical whether a team's second match shares its first match's eventKey or falls in a different event of the same season. EPA's event-blindness (D-13, faithful to Statbotics) is now a verified invariant, not merely the absence of code."
  - "SC-2 (Statbotics per-team tolerance) recorded blocked on an external dependency per D-14 — api.statbotics.io reproducibly 500s, re-confirmed 2026-08-13/14 across plans 02-01 through 02-06 — not redefined into something achievable."
  - "No hyperparameter, hyperparameter default, threshold, or algorithm variant was changed in response to any full-range (including 2025-2026 holdout) figure — the tune/holdout split's integrity is preserved (T-02-16)."

patterns-established:
  - "When a corpus-derived diagnostic script's finding is quoted in prose, ship the diagnostic itself as a committed, deterministic, re-runnable pass — never leave a load-bearing claim's derivation as an ad-hoc script run once and discarded."

requirements-completed: [ALGO-02, ALGO-03, ALGO-07]

coverage:
  - id: D1
    description: "Runnable SC-3 identifiability check reports per-season, per-component rank/condition number/threshold verdict against the real corpus, with disconnected-component attribution now reproducible via a committed union-find pass"
    requirement: ALGO-03
    verification:
      - kind: other
        ref: "pnpm identifiability --seasons 2022-2026 --identifiability-out reports/identifiability.json (real corpus run, executed this session)"
        status: pass
    human_judgment: true
    rationale: "Whether the identifiability argument actually establishes separability (not just 'the script ran') was reviewed and approved by the user at the 02-06 Task 3 checkpoint, conditional on this gap closing; the reconciled write-up is documentation, not a test assertion."
  - id: D2
    description: "EPA's event-boundary invariance (the one named ALGO-02 coverage gap from the checkpoint) is now a verified test, not merely untested silence"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/epa.test.ts#epa.update — event-boundary invariance (ALGO-02 checkpoint gap, D-13)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One 5-algorithm x 5-season head-to-head run scored into one artifact/report, OPR unchanged from Phase 1 baseline, Sigma1/EPA/OPR per-match update cost measured"
    requirement: ALGO-07
    verification:
      - kind: other
        ref: "reports/full-v2/artifact.json (schemaVersion 2, 5 algorithms x 5 seasons x 3 comp-level views) — produced and human-reviewed at the 02-06 Task 3 checkpoint"
        status: pass
    human_judgment: true
    rationale: "The full-range run and its no-superiority-claim framing were reviewed and approved at the checkpoint; recorded here as the audit trail, not re-verified by an automated test."

duration: "~3h10m active execution across Tasks 1-2 (2026-08-14 03:16-06:19), plus this continuation's gap-closing work (2026-08-14, checkpoint pause excluded)"
completed: 2026-08-14
status: complete
---

# Phase 02 Plan 06: Identifiability Check, Full-Range Head-to-Head, and Checkpoint Gap Closure Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**SC-3's identifiability check now ships a committed, reproducible connected-components pass (correcting the prior ad-hoc island count), and EPA's event-boundary invariance — the checkpoint's one named ALGO-02 gap — is now a verified test; the phase's full 2022-2026 five-algorithm head-to-head (OPR/EPA/Sigma1 x3 link modes) stands as reviewed and approved.**

## Performance

- **Duration:** ~3h10m active execution for Tasks 1-2 (identifiability script + full-range run), plus a short continuation closing two checkpoint-identified gaps. The ~6h45m between the Task 3 checkpoint being raised and this continuation starting was a human-review pause, not execution time.
- **Tasks:** 3 (Task 1: identifiability check; Task 2: full-range run + divergence record; Task 3: checkpoint — human-reviewed, approved conditional on two gaps, now closed)
- **Files modified:** 6 (`packages/harness/identifiability.ts`, `docs/models/sigma1-identifiability.md`, `docs/models/epa-divergences.md`, `packages/harness/cli.ts`, `package.json`, `packages/core/algorithms/epa.test.ts`)

## Accomplishments

- A runnable, real-corpus SC-3 identifiability check (`pnpm identifiability --seasons 2022-2026`) reports rank, condition number, non-zero-observation fraction, and an explicit pass/fail verdict per season per component, with `foulsCommitted` broken out separately for all five seasons including 2026's renamed fields.
- The rank-deficiency finding for 2022/2024 is now attributed to specific disconnected event islands by a **committed, deterministic** union-find pass (`computeConnectedComponents`) rather than an uncommitted one-off script — and re-running it surfaced a correction to the prior write-up (see Deviations).
- One command (`pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --metric-history`) scores all five algorithms across all five seasons into one artifact; OPR's combined-view Brier/accuracy is unchanged from Phase 1's measured baseline within 0.005 for every season.
- Every deliberate EPA divergence from Statbotics is written down in `docs/models/epa-divergences.md` (D-08 elim weighting, D-04 fouls cross-attribution, D-13 no per-season post-processing, Pitfall EPA-1 expanding-window win-probability scale, variance, component extraction).
- SC-2's Statbotics per-team tolerance check is recorded as blocked on an external dependency (D-14), not redefined into something achievable.
- ALGO-02's `unclassified` edge row is adjudicated boundary by boundary against the phase's actual test matrix; the one genuinely uncovered boundary (EPA's event-boundary invariance) is now closed with a dedicated test.

## Task Commits

Each task was committed atomically (this plan spanned two executor sessions across a human-review checkpoint):

1. **Task 1: Runnable identifiability check over the real corpus** - `3e23feac` (feat)
2. **Task 2: Full 2022-2026 five-algorithm run, cost measurement, divergence record** - `b3c9b058` (feat)
3. **Task 3 pre-review write-up: SC-3 identifiability document** - `f173344a` (docs)
4. **Gap 1 (checkpoint follow-up): committed connected-components pass, write-up reconciled** - `d41eca5d` (feat)
5. **Gap 2 (checkpoint follow-up): EPA event-boundary invariance test** - `6498323a` (test)

Also landed just before this plan, outside any task but required to close a WINDOWS.md item this plan's Task 2 discovered was already fixed:
- `a0ec5d54` — `fix(02): EPA predict attributes foulsCommitted to the opposing alliance (D-04)`
- `e63989bc` — `docs(02): resolve WINDOWS entry 3`

**Plan metadata:** (this commit) `docs(02-06): complete identifiability, full-range head-to-head, and checkpoint gap closure plan`

## Files Created/Modified

- `packages/harness/identifiability.ts` - SC-3's runnable identifiability check; now also ships `computeConnectedComponents`, a deterministic union-find pass over the alliance-partnership graph, run automatically when a season's design matrix is not full column rank
- `docs/models/sigma1-identifiability.md` - The SC-3 write-up; Section 3 corrected to match the committed connected-components pass's actual output
- `docs/models/epa-divergences.md` - D-13's required record of every deliberate EPA divergence from Statbotics
- `packages/harness/cli.ts` - `--measure-update-cost` opt-in flag (sampled high-resolution per-match update timing, zero overhead when absent)
- `package.json` - `identifiability` script
- `packages/core/algorithms/epa.test.ts` - New test: EPA's event-boundary invariance (closes the checkpoint's one named ALGO-02 gap)

## Full 2022-2026 head-to-head (combined view — quals + elims)

**Regenerated 2026-08-14 after the CR-01/WR-01 code review fixes** (see "Post-CR-01/WR-01 Regeneration" section below for what changed and whether it moved these numbers). Produced by `reports/full-v2/artifact.json` (schemaVersion 2, gitignored). Reported as measurements; no hyperparameter was changed in response to any of these numbers, including the 2025-2026 holdout seasons (T-02-16).

| Season | Algorithm | Brier | Winner accuracy | Scored matches |
|---|---|---|---|---|
| 2022 | opr | 0.1523 | 0.7743 | 14,603 |
| 2022 | epa | 0.1926 | 0.7387 | 14,603 |
| 2022 | sigma1 | 0.1691 | 0.7529 | 14,603 |
| 2022 | sigma1-seasonsd | 0.1732 | 0.7529 | 14,603 |
| 2022 | sigma1-normalcdf | 0.1820 | 0.7529 | 14,603 |
| 2023 | opr | 0.1706 | 0.7502 | 16,290 |
| 2023 | epa | 0.1985 | 0.7241 | 16,290 |
| 2023 | sigma1 | 0.1788 | 0.7299 | 16,290 |
| 2023 | sigma1-seasonsd | 0.1811 | 0.7299 | 16,290 |
| 2023 | sigma1-normalcdf | 0.1913 | 0.7299 | 16,290 |
| 2024 | opr | 0.1687 | 0.7501 | 16,958 |
| 2024 | epa | 0.2160 | 0.6991 | 16,958 |
| 2024 | sigma1 | 0.1821 | 0.7212 | 16,958 |
| 2024 | sigma1-seasonsd | 0.1953 | 0.7212 | 16,958 |
| 2024 | sigma1-normalcdf | 0.1869 | 0.7212 | 16,958 |
| **2025 (holdout)** | opr | 0.1675 | 0.7618 | 17,815 |
| **2025 (holdout)** | epa | 0.1932 | 0.7290 | 17,815 |
| **2025 (holdout)** | sigma1 | 0.1662 | 0.7539 | 17,815 |
| **2025 (holdout)** | sigma1-seasonsd | 0.1700 | 0.7539 | 17,815 |
| **2025 (holdout)** | sigma1-normalcdf | 0.1796 | 0.7539 | 17,815 |
| **2026 (holdout)** | opr | 0.1773 | 0.7825 | 18,337 |
| **2026 (holdout)** | epa | 0.1742 | 0.7454 | 18,337 |
| **2026 (holdout)** | sigma1 | 0.1554 | 0.7819 | 18,337 |
| **2026 (holdout)** | sigma1-seasonsd | 0.1516 | 0.7819 | 18,337 |
| **2026 (holdout)** | sigma1-normalcdf | 0.1689 | 0.7819 | 18,337 |

OPR's per-season combined Brier/accuracy is within 0.005 of Phase 1's measured baseline for all five seasons (2022 0.1523/0.7743, 2023 0.1706/0.7502, 2024 0.1687/0.7501, 2025 0.1675/0.7618, 2026 0.1773/0.7825) — no regression. **This table is a comparison, not a verdict:** nothing here is a superiority claim (that is Phase 3's question, from holdout seasons only, per D-21's raw-numbers-only convention).

## Post-CR-01/WR-01 Regeneration (2026-08-14)

A code review of this phase (`02-REVIEW.md`) found a real, provable bug (CR-01, critical) in the D-05 "no `score_breakdown`" fallback path of **both** `epa.ts` and `sigma1/index.ts`: the fallback fed a fraction of an alliance's own actual score into that alliance's own `foulsCommitted` component, and never netted the opponent's predicted foul contribution out of the alliance's own score before splitting it across offensive components — a cross-alliance misattribution affecting roughly 1,500 of ~104,000 matches (the corpus's `has_score_breakdown=0` population). A related warning (WR-01) found `epa.ts` had no finite-value gate on its D-05 fallback observations, unlike `sigma1/index.ts`'s existing one.

Both were fixed (`dc6b841b`, `c5975de6`), with new regression fixtures (`a6fedb9c`) verified to fail against the pre-fix source before landing. The table above is from a full `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-seasonsd,sigma1-normalcdf --metric-history --measure-update-cost --out reports/full-v2` re-run after both fixes landed (`reports/full-v2/artifact.json` `runTimestamp: 2026-08-14T21:09:37.541Z`) — not asserted from the prior run's cached output.

**Did the fix move the results?** Compared value-by-value against the pre-fix table (same command, same corpus, same seed, `runTimestamp: 2026-08-14T10:17:24.419Z`):

- **Every Brier score is unchanged at 4-decimal precision**, for every algorithm in every season, including the two OPR/EPA/Sigma1-1/2/3 combinations that exercise the fallback path most.
- **Winner accuracy moved by 0.0001-0.0002 in exactly two places**: 2024 `epa` (0.6993 -> 0.6991, ~3-4 matches out of 16,958 flipped a razor-thin near-50% call) and all three 2025 Sigma1 variants (0.7540 -> 0.7539, ~1-2 matches out of 17,815 — identical across all three link modes because they share the same `update()`/state-transition path, D-12's own documented property).
- **No other season/algorithm cell moved at all.**

This is the expected honest result, not a coincidence: the bug is scoped to `has_score_breakdown=0` matches only (~1.5% of the corpus), and within those matches it only ever touched the `foulsCommitted` component's value and a small proportional reallocation among a team's OTHER offensive components — never the total predicted score's sign in the overwhelming majority of cases, since `foulsCommitted` is a small fraction of most alliances' totals. **The corrected attribution did not move these results materially.** A handful of individual match calls near the win-probability decision boundary did flip, which is exactly the kind of small, real, honestly-reported effect a genuine (if narrow) bug should produce — not zero, not large, and not tuned to look like either.

**Per-match update cost:** re-measured in the same run (n=4,216 sampled updates each):

| Algorithm | Mean (μs) | p99 (μs) | Under 10ms budget at p99? |
|---|---|---|---|
| sigma1 | 1,315.83 | 2,615.80 | Yes, comfortably |
| sigma1-seasonsd | 1,090.51 | 2,351.70 | Yes, comfortably |
| sigma1-normalcdf | 1,067.31 | 2,402.10 | Yes, comfortably |
| epa | 2,246.02 | **30,138.00** | **No — p99 exceeds the 10 ms budget** |
| opr | 130,822.61 | 330,469.20 | No — far over, as before; not Phase 4's live-update candidate |

Every algorithm's timing is 10-30% higher than the original 02-06 run's measurement (e.g. OPR's mean rose from 115,836.97μs to 130,822.61μs) — including OPR, whose code path this session's fixes never touched. This uniform shift across every algorithm (not just EPA/Sigma1, whose `update()` the fix actually changed) points to this session's background CPU load (this same terminal ran several hours of concurrent polling/monitoring commands during the harness run) as the cause, not a regression introduced by CR-01/WR-01. The qualitative conclusions from the original run are unchanged: Sigma1 (all three link modes) is comfortably under the 10ms budget even at p99; EPA's p99 exceeds it, plausibly a GC-pause artifact of this offline harness process rather than representative of a fresh Worker invocation (as originally noted) — a Phase-4-scoped re-measurement in a quiet environment remains the right way to get a clean number, not this run.

**Identifiability check (SC-3):** NOT re-run. `packages/harness/identifiability.ts` imports `parseBreakdown`/`componentMapForSeason` directly and never imports `epa.ts`, `sigma1/index.ts`, or `distributeResidual` — its design matrix and every reported figure are built purely from real, parsed `score_breakdown` data, never through either algorithm's `update()`/D-05 fallback path that CR-01/WR-01 touched. Its inputs are unaffected by these fixes; re-running it would have been a ~several-minute no-op. See `docs/models/sigma1-identifiability.md`'s own note recording this same reasoning.

## Measured per-match update cost (n=4,216 sampled updates each, full 2022-2026 range)

Recorded so Phase 4's 10 ms Worker CPU budget is planned against a measurement, not the RESEARCH.md estimate:

| Algorithm | Mean (μs) | p99 (μs) | Under 10ms budget at p99? |
|---|---|---|---|
| sigma1 | 897.82 | 2,295.50 | Yes, comfortably |
| sigma1-seasonsd | 813.24 | 2,207.20 | Yes, comfortably |
| sigma1-normalcdf | 802.74 | 2,168.90 | Yes, comfortably |
| epa | 1,783.90 | **24,915.20** | **No — p99 exceeds the 10 ms budget by ~2.5x** |
| opr | 115,836.97 | 314,489.10 | No — far over, consistent with `opr.ts`'s documented O(n²) incremental-solve cost at full-season scale; OPR is not Phase 4's live-update candidate |

EPA's p99 exceeding budget is flagged for Phase 4 — plausibly a long-run GC-pause artifact of this offline harness process rather than representative of a fresh Worker invocation, but not asserted as safe without a Phase-4-scoped measurement in that actual runtime. Sigma1 (all three link modes) is comfortably under budget even at p99, which is the load-bearing result for Phase 4's incremental-update design.

## Identifiability verdicts (SC-3, real corpus, 25-event seeded sample per season)

Full detail in `docs/models/sigma1-identifiability.md`. Recorded honestly, including the seasons that are NOT full column rank:

| Season | Design matrix | Rank | Condition number | Full column rank |
|---|---|---|---|---|
| 2022 | 3,520 x 775 | 767 | 7.08 | **No** — 7 connected components |
| 2023 | 4,152 x 845 | 845 | 4.52 | Yes |
| 2024 | 4,380 x 891 | 888 | 9.07 | **No** — 3 connected components |
| 2025 | 4,502 x 986 | 986 | 5.19 | Yes |
| 2026 | 4,058 x 781 | 781 | 4.46 | Yes |

- Every season's condition number, where connected, is small (single digits) — not a marginal pass anywhere.
- **2022 and 2024 are genuinely not full column rank**, reproducibly confirmed by the newly-committed `computeConnectedComponents` pass:
  - **2022:** 7 components (670, 48, 30, 18, 3, 3, 3) — `2022tuis` (48, Tunisia), `2022qcmo2`+`2022qcmo3` (30, Quebec district), `2022on410` (18, Ontario district) match regional/international district structure; plus three newly-attributed 3-team islands at `2022micmp` (x2, an 8-match sparse-recording event) and `2022wayak` (a placeholder/bye alliance) that a prior uncommitted pass missed.
  - **2024:** 3 components (857, 31, 3) — `2024isde1` (31, Israel district) matches district structure; plus a newly-attributed 3-team island at `2024oncmp` (a 2-match sparse-recording event).
  - A team inside a large district island is fully identifiable RELATIVE TO its own island; what is not established by this 25-event sample is that its rating sits on the same absolute scale as the main component. This is a known limitation of the sample size, not resolved by widening the sample post hoc (the plan's own prohibition against figure-shopping).
- `adjust` fails its non-zero-observation-fraction threshold in every season (referee adjustments are near-never non-zero by design — the correct, expected measurement of a rare event).
- `foulsCommitted` is the weakest non-`adjust` component every season it can be evaluated (2023/2025/2026), confirming D-04's prediction with a measured number: 37.5%-51.5% non-zero observation fraction (derived, per-team-cost basis) vs. 60-70%+ any-foul-recorded-per-match (raw diagnostic basis) — the two are different measurements of different things, and the write-up states which is which.
- SC-2's Statbotics per-team tolerance check is recorded blocked on an external dependency (D-14): `api.statbotics.io`'s `/v3/year/{year}`, `/v3/team_year/{team}/{year}`, `/v3/team/{team}` all return HTTP 500; the blog returns HTTP 403 to automated fetch. Reconfirmed live across plans 02-01 through 02-06, most recently 2026-08-14. Not redefined into something achievable; two rejected alternatives (running Statbotics' own model, Wayback snapshots) are recorded in the write-up.

## ALGO-02 boundary-by-boundary adjudication ("runs walk-forward at any point in a season")

Adjudicated at the Task 3 checkpoint against the phase's actual test matrix; recorded here per the checkpoint's resume-signal requirement, with the one previously-uncovered boundary now closed.

| Boundary | Verdict | Evidence |
|---|---|---|
| Start of a season (a team's first-ever match, cold-start value) | **Covered** | `epa.test.ts`'s match-count-0 fixture (`epaPercentFunc(0) === 1/3`); `carryover.test.ts`'s `carryNormalizedRating — no rating history at all` (rookie baseline) and `epa.carrySeason — isColdStart short-circuit` (cold-start season is a no-op) cases |
| Mid-season, mid-event (the ordinary case) | **Covered** | `epa.test.ts`'s standard two-stage-EWMA fixture; the full 2022-2026 replay in `reports/full-v2/` |
| Across an event boundary within a season | **Covered — was the one named gap, closed this session** | `epa.test.ts`'s new `epa.update — event-boundary invariance (ALGO-02 checkpoint gap, D-13)` test proves `update()`'s resulting state is identical whether a team's second match shares its first match's `eventKey` or falls in a different event of the same season, holding match count and observations equal — EPA's event-blindness is now a verified invariant, not merely untested silence. Sigma1's own event-boundary process-noise bump (a deliberately DIFFERENT, already-covered behavior) is separately verified by `sigma1/sigma1.test.ts`'s `D-07 process noise — cross-event vs within-event` and `kalman.test.ts`'s event-boundary-magnitude test |
| Across a season boundary | **Covered** | 02-03 Task 1's carry cases (`carryover.test.ts`) and Task 2's real 2022-2023 run (`packages/harness/cli.season-carry.test.ts`) |
| The very first match of the cold-start season (`ExpandingStats.count < 2`, win-probability scale falls back to a caller-supplied constant) | **Covered** | `expandingStats.test.ts`'s `standardDeviation — returns the caller's fallback (not 0, not NaN) when count < 2`; `epa.test.ts`'s tied-prediction test exercises this exact fallback path at true cold start (`initState`'s fresh `emptyExpandingStats()`) and confirms a well-formed (not NaN, in-range) `pRedWin` results |
| A team with a single observation ever, and a season a team did not play (`carryNormalizedRating`'s missing-input branches) | **Covered** | `carryover.test.ts`'s `carryNormalizedRating — only the immediately-prior season present` (single observation) and `epaCarryover — a team present only in priorSeasonRatings.lastSeason` (a season not played, in either direction) |
| Stopping mid-season and predicting from an arbitrary match index | **Covered, vacuously, by construction** | `predict()` is a pure function of `state` alone; `state` at match N already IS "the walk-forward state after N-1 matches," so predicting from an arbitrary index is structurally identical to the ordinary sequential-replay case already exercised at every match. No separate "mid-season snapshot resume" code path exists to leave untested — T-02-08's leak-proof Proxy (`replay.test.ts`) is what would catch a hidden dependency on match position if one existed |

**Conclusion: no uncovered boundary remains.** The checkpoint's one named gap (EPA's event-boundary invariance) is closed by the new test above.

## Decisions Made

See `key-decisions` in frontmatter. In short: the connected-components pass is now committed and re-runnable (not an ad-hoc script quoted from memory); the write-up was corrected to match its actual output rather than the reverse when the two disagreed; and EPA's event-blindness is now a proven test invariant rather than an argument from absence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Checkpoint-directed follow-up, not a Rule 1-3 auto-fix] Reconciled sigma1-identifiability.md's island attribution against the newly-committed connected-components pass**
- **Found during:** Gap 1 closure (this continuation)
- **Issue:** The prior write-up's disconnected-island attribution (2022: 4 components sizes 679/48/30/18; 2024: 2 components sizes 860/31) was produced by an ad-hoc, uncommitted union-find pass and could not be reproduced.
- **Fix:** Shipped `computeConnectedComponents` in `identifiability.ts` (deterministic union-find over the alliance-partnership graph — teammates only, never opponents or same-event attendees). Re-running against the real corpus produced a different, more granular result (2022: 7 components; 2024: 3 components) that includes small placeholder/sparse-recording islands the prior pass missed. The write-up was corrected to match the committed script's output — not tuned to preserve the old numbers — per the checkpoint's explicit honesty instruction.
- **Files modified:** `packages/harness/identifiability.ts`, `docs/models/sigma1-identifiability.md`
- **Verification:** `pnpm identifiability --seasons 2022-2026` re-run against the real corpus this session; `pnpm typecheck` and `pnpm test` both exit 0
- **Committed in:** `d41eca5d`

**2. [Checkpoint-directed follow-up] Added the EPA event-boundary invariance test the checkpoint proposed**
- **Found during:** Gap 2 closure (this continuation)
- **Issue:** `epa.test.ts` used a single `eventKey` ("2024test") throughout, so EPA's correct event-blindness (D-13, faithful to Statbotics) was unverified rather than covered.
- **Fix:** Added a test asserting `epa.update()`'s resulting state is identical for a team's second match whether it shares the first match's `eventKey` or falls in a different event of the same season, holding match count and observation equal.
- **Files modified:** `packages/core/algorithms/epa.test.ts`
- **Verification:** New test passes; 273/273 tests pass (was 272); `pnpm typecheck` exits 0
- **Committed in:** `6498323a`

---

**Total deviations:** 2 (both checkpoint-directed gap closures per explicit user instruction, not autonomous Rule 1-3 fixes)
**Impact on plan:** Both were the exact, named conditions of the user's "close both loose ends, then approved" response. No scope creep — no other checkpoint content was re-opened or re-litigated, per the user's explicit instruction.

## Issues Encountered

None beyond the two named gaps, which were closed as directed. The reconciliation in Gap 1 surfaced a real, honestly-reported discrepancy (the committed pass finds MORE disconnected islands than the prior ad-hoc estimate) rather than a clean confirmation — recorded plainly per this project's failure-log discipline rather than smoothed over.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2's four success criteria (SC-1 through SC-4) are all answerable from artifacts on disk: one run scored OPR/EPA/Sigma1 head-to-head across all five seasons (SC-1); EPA's walk-forward-at-any-point behavior is now fully adjudicated with no uncovered boundary (SC-2's Statbotics tolerance sub-check remains blocked per D-14, not redefined); Sigma1's identifiability check is reproducible and documented, including the honest 2022/2024 rank-deficiency finding (SC-3); every match carries a predicted winner, win probability, and predicted alliance scores, with Sigma1's carrying variance (SC-4).
- Phase 3 (hyperparameter tuning) has a measured, documented baseline to tune against, with the tune/holdout split's integrity preserved (no constant was changed in response to any full-range figure).
- Phase 4 (Cloudflare Worker incremental path) has real measured per-match update costs for all five algorithm configurations, including the one that exceeds the 10ms budget at p99 (EPA) — worth a Phase-4-scoped re-measurement in the actual Worker runtime before assuming the offline-harness GC-pause explanation.
- WINDOWS.md entry 2 (SC-2 blocked) remains open by design — it is a recorded, accepted external-dependency block, not a defect to fix.

---
*Phase: 02-prediction-models-epa-sigma1*
*Completed: 2026-08-14*

## Self-Check: PASSED

All created/modified files and all five plan-related commits (`3e23feac`, `b3c9b058`, `f173344a`, `d41eca5d`, `6498323a`) verified present on disk / in `git log --all`.
