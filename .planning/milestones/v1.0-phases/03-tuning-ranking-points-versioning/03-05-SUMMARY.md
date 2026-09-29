---
phase: 03-tuning-ranking-points-versioning
plan: 05
subsystem: algorithms
tags: [sigma1, kalman, hyperparameter-tuning, sensitivity-screen, coordinate-descent, versioning, brier-score, vitest]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: "03-01's Sigma1Params surface/tune.ts+promote.ts scaffolding/PromotedVersionSchema; 03-04's adaptation.ts mechanism and sigma1/sigma1-adapt registry pair"
provides:
  - "packages/harness/searchSpace.ts: SIGMA1_SEARCH_SPACE (20 justified per-parameter bounds), screenGridFor, isValidParamSet -- the search metadata both the screen and joint search read from a single source"
  - "packages/harness/tune.ts --stage screen: a real one-at-a-time sensitivity sweep answering which of Sigma1's 20 hyperparameters the tune-season data can actually distinguish (D-03a)"
  - "packages/harness/tune.ts --stage joint: a seeded random + coordinate-descent search over the screen's survivors only, with three independent structural holdout gates and a leave-one-season-out overfitting guard"
  - "docs/models/sigma1-sensitivity-screen.md: the committed, real-run answer -- 9/20 parameters survive, with an Honesty Register naming three distinct blindness mechanisms found in the actual data"
  - "data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json: the adaptation-off joint-search winner, promoted with full D-14 provenance and a reproduced digest"
affects: [03-06-final-integration]

actuals:
  tokens: 26687
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Search metadata as its own harness-only module (searchSpace.ts), never packages/core -- bounds are a tuning concern, not Worker-importable prediction data"
    - "Pure candidate-generation logic (planJointCandidates) separated from impure corpus evaluation -- the empty/singleton/random branching and the seeded random phase are unit-testable without a real replay, only evaluateCandidateBatch touches the corpus"
    - "Overfitting guard from already-computed data: LOSO re-slices each candidate's existing per-season scores rather than replaying, costing zero extra corpus reads"
    - "Escalating numerical-stability ridge (Cholesky) as a ladder of fixed values tried in order, not a single constant -- preserves bitwise output for every already-succeeding case while rescuing genuinely near-singular ones"

key-files:
  created:
    - packages/harness/searchSpace.ts
    - packages/harness/searchSpace.test.ts
    - packages/harness/tune.test.ts
    - docs/models/sigma1-sensitivity-screen.md
    - data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json
  modified:
    - packages/harness/tune.ts
    - packages/harness/promote.ts
    - packages/core/algorithms/sigma1/rp/distribution.ts
    - packages/core/algorithms/sigma1/rp/distribution.test.ts

key-decisions:
  - "The screen runs entirely at DEFAULT_SIGMA1_PARAMS' adaptationEnabled: false baseline (never forcing it true to give the 5 adaptation-only hyperparameters a fairer sweep) -- simpler, more literal to the plan's own 'every other parameter at its default' instruction, and produces a genuinely honest (if less flattering) finding: those 5 params show exactly zero measured sensitivity because adaptationFactor is provably inert when disabled, not because they were tested and found wanting. Both joint searches (on/off) therefore read the IDENTICAL survivor list from one screen artifact, satisfying Task 3's own literal acceptance criterion (survivor lists must be identical) -- the adaptation-on run's 'searches its own extra knobs too' (D-06) is consequently a null set for this specific screen run, recorded plainly rather than engineered around"
  - "Two Rule 1 blocking bugs, pre-existing in code outside this plan's stated files_modified, fixed because they blocked this plan's own required real-corpus commands: (1) runBoundedSeasons' predictions.push(...predictions) blew V8's call-stack argument limit once a full-season, multi-candidate batch reached ~117k elements -- replaced with a plain loop; (2) rp/distribution.ts's Cholesky ridge, a single fixed 1e-6 retry, could not always restore positive-definiteness for promote.ts's bounded-slice replay (which always starts every team's RP state genuinely cold, unlike a full multi-season harness run) -- escalated to a ladder of ridges, preserving bitwise output for every case that already succeeded"

patterns-established:
  - "screenGridFor's grid always includes the parameter's own exact default value at an interior slot (never perturbing the declared min/max endpoints) -- the mechanism that lets a screen honestly report 'this parameter cannot beat its own default,' verified by an exact-value test for both a log-scaled and a linear-scaled parameter"
  - "determineWinner's tie-break (strict < only ever moves the winner index) is the SAME function used by every stage (tracer/screen/joint), so 'earlier-generated candidate wins ties' cannot drift between stages"

requirements-completed: [ALGO-04, ALGO-06]

coverage:
  - id: D1
    description: "SIGMA1_SEARCH_SPACE covers all 20 searchable hyperparameters with justified bounds; screenGridFor produces a grid inclusive of both bounds, always containing the default, monotonically increasing, on the declared scale; isValidParamSet enforces the three cross-parameter constraints"
    requirement: ALGO-04
    verification:
      - kind: unit
        ref: "packages/harness/searchSpace.test.ts (14 tests: grid shape/scale/inclusivity for all 20 params, exact-value geometric and arithmetic grids, isValidParamSet's four rejection cases plus the defaults-accept case, SEARCHABLE_PARAM_KEYS exclusions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real one-at-a-time sensitivity screen over 2022,2023 (100 candidates) finds 9/20 parameters survive, published as docs/models/sigma1-sensitivity-screen.md with Method/Screen Results/Survivors/Honesty Register sections sourced from the real reports/sensitivity-screen.json"
    requirement: ALGO-04
    verification:
      - kind: integration
        ref: "pnpm tune --stage screen --seasons 2022,2023 --values 5 (real corpus run, ~14,677+16,353 matches x 100 candidates, wrote reports/sensitivity-screen.json)"
        status: pass
      - kind: manual_procedural
        ref: "docs/models/sigma1-sensitivity-screen.md reviewed against the real JSON output -- every table row, survivor list entry, and Honesty Register claim traced back to a specific reports/sensitivity-screen.json field"
        status: pass
    human_judgment: false
  - id: D3
    description: "The joint search reads the screen's survivors, is structurally unable to read holdout seasons (three independent gates), breaks ties deterministically with both parameter sets logged, reports atBound flags, handles the zero/one-survivor edges, and runs a leave-one-season-out overfitting guard from already-scored data"
    requirement: ALGO-04
    verification:
      - kind: unit
        ref: "packages/harness/tune.test.ts (15 tests: determineWinner tie-break/determinism, assertNoHoldoutLeak's throw, planJointCandidates' empty/singleton/random modes, candidate reproducibility/validity, D-01's accuracy-blindness via objectiveForCandidate)"
        status: pass
      - kind: integration
        ref: "pnpm tune --stage joint --seasons 2025 --evals 6 (real run, exits non-zero naming the holdout season); pnpm tune --stage joint --seasons 2022 --events 12 (real run, byte-identical two-run reproducibility confirmed via a stripped-generatedAt JSON diff)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two full joint searches (2022-2024, evals=60, seed=42) ran at programmatically-verified identical evals/seed/seasons/batch/survivors, differing only in --adaptation; the LOSO block records three folds naming their held-out TUNE season, none referencing 2025/2026"
    requirement: ALGO-04
    verification:
      - kind: integration
        ref: "reports/tune-joint-off.json and reports/tune-joint-on.json (real full runs) -- programmatic equality check on evals/seed/batch/seasons/survivorsPath/survivors confirmed identical; loso.folds names 2022/2023/2024 only"
        status: pass
    human_judgment: false
  - id: D5
    description: "The adaptation-off winner is promoted as sigma1@2.0.0+tuned-2026-08 with adaptationEnabled false, rpMonteCarloDraws restored to the versioned default (2000), and a full D-14 provenance block; digest.test.ts reproduces both the new version and the pre-existing tracer version bitwise"
    requirement: ALGO-06
    verification:
      - kind: integration
        ref: "pnpm promote --adaptation off --name tuned-2026-08 (real run, wrote data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json)"
        status: pass
      - kind: unit
        ref: "packages/harness/digest.test.ts (2/2 passing, real corpus re-run: sigma1@2.0.0+tracer-check.json and sigma1@2.0.0+tuned-2026-08.json both reproduce their committed digest and headline metrics bitwise)"
        status: pass
    human_judgment: false

duration: 150min
completed: 2026-08-16
status: complete
---

# Phase 3 Plan 5: Sigma1 Sensitivity Screen and Joint Search Summary

**A real 20-parameter one-at-a-time sensitivity screen (9 survivors) feeds a seeded joint search run twice at identical budgets (adaptation on/off), with the off winner promoted as `sigma1@2.0.0+tuned-2026-08`**

## Performance

- **Duration:** ~150 min (includes two real full-corpus joint searches, ~50 min each, run in parallel)
- **Started:** 2026-08-16T18:35:00Z (approx.)
- **Completed:** 2026-08-16T20:45:21Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- `searchSpace.ts` defines all 20 searchable hyperparameters' bounds with a physically-grounded justification for each (never a bare literal), `screenGridFor`'s grid always includes the parameter's exact default at an interior slot, and `isValidParamSet` enforces the three cross-parameter constraints (`processNoiseEventBoundary > processNoiseWithinEvent`, `adaptationMinFactor < adaptationMaxFactor`, carry weights in `[0,1]`).
- A REAL one-at-a-time sensitivity screen ran over 2022-2023 (100 candidates, `pnpm tune --stage screen --seasons 2022,2023 --values 5`), finding **9 of 20 parameters survive** `SCREEN_SURVIVAL_THRESHOLD = 1e-4`. `docs/models/sigma1-sensitivity-screen.md` publishes the full table plus an Honesty Register naming three distinct kinds of blindness the real data actually showed: three parameters (`minConsistencyVariance`, `shrinkagePriorMatches`, `fallbackScoreSd`) are structurally invisible to the Brier objective (they only affect `teamMetrics()` or an unreachable fallback path), the carry weights (`carryLastYearWeight`/`carryPriorYearWeight`) are mechanically inert in a 2-season screen window (their blend only activates at a team's third season of history), and all five adaptation-only hyperparameters are inert because the screen ran at the honest `adaptationEnabled: false` baseline.
- The joint search (`--stage joint`) reads the screen's survivors, generates a seeded random population (candidate 0 always the exact default) plus a one-sweep coordinate-descent refinement, is structurally unable to read holdout data (three independent gates), breaks ties deterministically with both full parameter sets logged, flags `atBound`, handles the zero/one-survivor edges without failing, and runs a leave-one-season-out overfitting guard entirely from already-scored data (no extra replays).
- Two REAL full joint searches ran over 2022-2024 (evals=60, seed=42, the identical 9-parameter survivor set), differing ONLY in `--adaptation on|off` — verified programmatically equal on every other recorded field. The off-winner reproduces its own committed digest via `digest.test.ts`.
- `promote.ts` gained `--adaptation on|off` (defaults `--from` to the matching joint log) and `--code-version`, a full D-14 provenance block (search artifact hash, objective definition, evaluation count, seed, screen artifact, survivor list, LOSO summary, adaptation mode — all additive/optional so the pre-existing tracer promotion keeps validating unchanged), and restores `rpMonteCarloDraws` to its versioned default (2000) in the promoted parameter set. The adaptation-off winner is now committed as `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json`; the adaptation-on winner is deliberately NOT promoted (D-08 — that comparison is plan 03-06's holdout best-vs-best).
- Two Rule 1 blocking bugs, discovered running this plan's own real corpus commands, were fixed: a V8 call-stack overflow in `runBoundedSeasons`' array-spread push at full-season batched scale, and an insufficiently-robust single-retry Cholesky ridge in `rp/distribution.ts` that could not always resolve `promote.ts`'s bounded-slice replay (which always starts every team's RP state genuinely cold).

## Task Commits

Each task was committed atomically, plus one out-of-scope fix commit discovered blocking Task 3:

1. **Task 1: Search space + real sensitivity screen** — `79c7464d` (feat)
2. **Task 2: Joint search over survivors, holdout blindness, LOSO guard** — `05c0ada3` (feat)
3. **[Rule 1 fix] Escalating Cholesky ridge, blocking Task 3's real promotion** — `f650ffbb` (fix)
4. **Task 3: Two equal-budget joint searches, adaptation-off winner promoted** — `7bac21c3` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update)

## Files Created/Modified

- `packages/harness/searchSpace.ts` — `SIGMA1_SEARCH_SPACE`, `SearchableParamKey`, `SEARCHABLE_PARAM_KEYS`, `screenGridFor`, `isValidParamSet`
- `packages/harness/searchSpace.test.ts` — 14 unit tests
- `packages/harness/tune.ts` — `--stage screen` (`SCREEN_SURVIVAL_THRESHOLD`, `runScreenStage`) and `--stage joint` (`planJointCandidates`, `determineWinner`, `computeLoso`, `runJointStage`); shared `objectiveForCandidate`/`assertNoHoldoutLeak`/`evaluateCandidateBatch`/`evaluateAll` used by every stage; `--stage tracer` unchanged in behavior
- `packages/harness/tune.test.ts` — 15 pure unit tests (no corpus)
- `packages/harness/promote.ts` — `--adaptation on|off`, `--code-version`; extended `ProvenanceSchema` (additive/optional fields); restores `rpMonteCarloDraws` post-search
- `packages/core/algorithms/sigma1/rp/distribution.ts` — `CHOLESKY_RIDGES` escalating ladder replacing the single `CHOLESKY_RIDGE` retry
- `packages/core/algorithms/sigma1/rp/distribution.test.ts` — 2 new tests (near-singular fixture resolves; well-conditioned fixture untouched)
- `docs/models/sigma1-sensitivity-screen.md` — the committed screen result
- `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` — the promoted version

## Decisions Made

See `key-decisions` in frontmatter. The two consequential ones:

1. **The screen runs at the honest `adaptationEnabled: false` baseline throughout**, rather than forcing it true just to give the 5 adaptation-only hyperparameters a fairer individual sweep. This is simpler, more literal to the plan's own "every other parameter at its default" instruction, and satisfies Task 3's own literal acceptance criterion that both joint searches' survivor lists be identical (verified programmatically). The consequence — D-06's "searches its own extra knobs too" is a null set for this specific screen — is recorded plainly in the Honesty Register rather than engineered around.
2. **Two Rule 1 bugs outside this plan's stated file scope were fixed because they blocked this plan's own required real-corpus commands** (Task 3's promotion step could not complete without the Cholesky fix; Task 1's full screen could not complete without the stack-overflow fix). Both are minimal, behavior-preserving for every already-working case, and covered by new tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Blocking bug] `runBoundedSeasons`' array-spread push overflowed V8's call-stack argument limit at full-season batched scale**
- **Found during:** Task 1, running the real full screen (`pnpm tune --stage screen --seasons 2022,2023 --values 5`)
- **Issue:** `all.push(...predictions)` with `predictions.length` up to 117,416 (14,677 matches x 8 candidates) exceeds V8's spread-as-function-arguments stack limit, throwing `Maximum call stack size exceeded`. `cli.ts`'s `runSeasons` carries the identical pattern but at a smaller per-run scale that has not yet tripped it — out of this plan's file scope, not touched.
- **Fix:** Replaced with a plain `for...of` loop.
- **Files modified:** `packages/harness/tune.ts`
- **Verification:** Re-ran the real full screen successfully; full test suite passes.
- **Committed in:** `79c7464d` (Task 1 commit)

**2. [Rule 1 - Blocking bug] The RP joint model's single fixed Cholesky ridge could not always resolve `promote.ts`'s bounded-slice replay**
- **Found during:** implementing Task 3, running `pnpm promote` for real against the live corpus
- **Issue:** `rpPmfForMatch: joint covariance matrix ... is not positive definite even after a 0.000001 diagonal ridge` — a pre-existing (plan 03-03) numerical-stability mitigation, defeated because `promote.ts`'s bounded-slice replay always starts every team's RP state genuinely cold (unlike a full multi-season harness run), and a sparse early `rpCrossCovariance` estimate can be large relative to its own near-zero variance.
- **Fix:** Escalated the single retry into a ladder of ridges (`[1e-6, 1e-4, 1e-2, 1, 10, 100]`), stopping at the first that restores positive-definiteness. Every already-succeeding match (ridge 0 or the original 1e-6) stays bitwise unchanged since the ladder tries the identical values in the identical order first.
- **Files modified:** `packages/core/algorithms/sigma1/rp/distribution.ts`, `packages/core/algorithms/sigma1/rp/distribution.test.ts`
- **Verification:** New tests prove the escalation resolves a manufactured near-singular fixture the original single retry could not, and that a well-conditioned fixture still succeeds at ridge 0 untouched; the real `pnpm promote` run then succeeded; full test suite (459/459) passes; both committed version files reproduce their digests bitwise.
- **Committed in:** `f650ffbb` (standalone fix commit, before Task 3's feat commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1)
**Impact on plan:** Both were necessary for this plan's own required real-corpus commands to complete at all — neither is scope creep (no new capability was added beyond what was needed to unblock), and both are covered by new tests proving the fix without changing any already-correct output.

## Issues Encountered

- Output from the background `pnpm tune --stage screen`/`--stage joint` processes, redirected to a log file, buffered heavily on this platform — incremental progress lines were not visible between long gaps. Worked around by periodically checking process CPU/memory via `Get-Process` to confirm continued progress, and by waiting for the harness's own background-task-completion notifications rather than relying on log tailing.
- The initial screen design considered forcing `adaptationEnabled: true` specifically when sweeping the 5 adaptation-only hyperparameters, to give them a non-vacuous individual sensitivity reading. Rejected in favor of the simpler, more literal, honestly-documented alternative (see Decisions Made #1) after recognizing it would violate Task 3's own literal "identical survivor list" acceptance criterion.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json` is a real, committed, provenance-carrying, digest-reproducing tuned version — ready for plan 03-06's holdout comparison (SC-3: does it beat OPR/EPA on both holdout seasons' Brier AND accuracy).
- `reports/tune-joint-on.json`'s winner (adaptation-on) is available for plan 03-06's D-06 best-vs-best holdout comparison but was deliberately NOT promoted here — 03-06 is where that comparison and any resulting promotion decision belongs.
- The LOSO overfitting guard's own finding is available for 03-06's write-up: the pooled winner matches the LOSO winner in 2 of 3 folds (2022, 2023 held out); the 2024-held-out fold selects a different candidate (index 71 vs the pooled winner's 76), with a per-season Brier spread of ~0.013 for the pooled winner — a genuine, moderate overfitting signal worth naming rather than hiding.
- Both joint searches' winners sit `atBound` on `processNoiseEventBoundary` (its search bound's floor, 1) — flagged in both `reports/tune-joint-{off,on}.json`'s own `atBound` field and here: this bound may be too narrow, not evidence the search converged well; worth widening in a future re-tune.
- No blockers for 03-06.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-16*

## Self-Check: PASSED

All 5 created files verified present on disk (`searchSpace.ts`, `searchSpace.test.ts`, `tune.test.ts`, `docs/models/sigma1-sensitivity-screen.md`, `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json`); all 4 commit hashes (`79c7464d`, `05c0ada3`, `f650ffbb`, `7bac21c3`) verified present in git log.
