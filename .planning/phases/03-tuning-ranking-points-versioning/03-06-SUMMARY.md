---
phase: 03-tuning-ranking-points-versioning
plan: 06
subsystem: algorithms
tags: [ci, github-actions, digest-fixture, sigma1, brier-score, holdout, adaptation, ranking-points, vitest]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: "03-05's promoted sigma1@2.0.0+tuned-2026-08.json and the two equal-budget joint search logs (reports/tune-joint-{off,on}.json), 03-02's RP rule modules, 03-03's RP prediction wiring"
provides:
  - ".github/workflows/test.yml: the repository's first CI test runner (push + pull_request, no secrets)"
  - "packages/harness/fixtures/digest-slice.json + extract-digest-slice.ts: a committed, bounded (265-match, 3-event, 644KB) slice so D-15's reproducibility test runs for real in CI, where the 351MB corpus never exists"
  - "packages/harness/cli.ts's applyPromotedOverrides: sigma1 resolves to the currently-promoted version, sigma1-adapt to the adaptation-on joint search's own winner, when their source files exist"
  - "A Cauchy-Schwarz clamp on Sigma1's RP cross-covariance (rp/distribution.ts), fixing a genuine indefinite-matrix bug discovered running the real full-corpus command"
  - "docs/models/sigma1-tuning-results.md: the SC-3 verdict (8/8 PASS), the ALGO-05 adaptation finding, and the ALGO-08 worked RP example, all from one reports/tuned-v3/artifact.json run"
affects: [phase-4-cloudflare-worker-incremental-path]

actuals:
  tokens: 58500
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Per-version-file conditional it.skip in digest.test.ts, computed before the it() call (not inside it), so a version the committed fixture does not cover skips explicitly in a corpus-absent CI run instead of failing the whole suite"
    - "Lazy, file-presence-gated algorithm overrides in cli.ts (applyPromotedOverrides, called only from main(), never at module import time) so a promoted version or search-winner artifact swaps in an id's static registry entry without making module import depend on a gitignored file existing"
    - "Numerical-validity clamp (Cauchy-Schwarz bound) applied BEFORE a numerical-stability ridge escalation, distinguishing 'this input is mathematically invalid' from 'this input is merely ill-conditioned' -- two different failure modes needing two different fixes"

key-files:
  created:
    - .github/workflows/test.yml
    - packages/harness/fixtures/extract-digest-slice.ts
    - packages/harness/fixtures/digest-slice.json
    - docs/models/sigma1-tuning-results.md
  modified:
    - packages/harness/digest.test.ts
    - packages/harness/promote.ts
    - packages/harness/cli.ts
    - packages/core/algorithms/sigma1/rp/distribution.ts
    - packages/core/algorithms/sigma1/rp/distribution.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "digest.test.ts skips PER VERSION FILE (not once for the whole suite) when neither the corpus nor a matching fixture is available -- a single committed fixture is necessarily scoped to one slice (T-03-17) and cannot cover every promoted version's own recorded slice, so 'a gate that skips is not a gate' is honored for the currently-promoted version (which the fixture DOES cover) while an older version (sigma1@2.0.0+tracer-check.json, promoted before this fixture existed) skips explicitly rather than failing CI for want of coverage it was never given"
  - "cli.ts's sigma1/sigma1-adapt registry entries now resolve, at CLI-entry time only, to the currently-promoted version / the adaptation-on search's own winner when their source files exist, falling back to the pre-existing static modules otherwise -- necessary for this plan's own required literal harness command to produce the intended comparison, backward-compatible for every other invocation"
  - "RP cross-covariance clamped to its own Cauchy-Schwarz bound (0.999x sqrt(varX*varY)) before the existing Cholesky ridge escalation runs -- a Rule 1 fix for a genuinely indefinite (not merely ill-conditioned) joint covariance matrix discovered running the real 2022-2026 command, verified not to move any committed digest"
  - "ALGO-05 marked complete in REQUIREMENTS.md -- D-08 is satisfied by a measured best-vs-best answer in either direction; the measured answer here is a modest, consistent holdout Brier improvement for adaptation-on, recorded as a named decision to revisit rather than a silent default flip"
  - "SC-3 evaluated at its literal 8-comparison reading and PASSES 8/8 -- tuned Sigma1 beats both OPR and EPA on holdout Brier AND winner accuracy on both 2025 and 2026, closing the accuracy gap the Phase-2 starting position and this plan's own objective flagged as unlikely to close under a Brier-only search objective"

patterns-established:
  - "A results document's headline table states, immediately beside it, the prior phase's own starting-position numbers -- so what changed is legible from the document itself rather than requiring a reader to cross-reference an older SUMMARY"

requirements-completed: [ALGO-04, ALGO-05, ALGO-06, ALGO-08]

coverage:
  - id: D1
    description: "The reproducibility gate runs in CI: .github/workflows/test.yml triggers on push and pull_request, runs pnpm typecheck and pnpm test as separate steps with no secret referenced; digest.test.ts replays from a committed fixture when the corpus is absent and asserts corpus/fixture agreement when both exist"
    requirement: ALGO-06
    verification:
      - kind: unit
        ref: "packages/harness/digest.test.ts (3 tests with corpus present; simulated CI with corpus renamed away: reproduction assertion still RUNS and exits 0, tracer-check.json skips explicitly)"
        status: pass
      - kind: other
        ref: "node -e workflow-content check (pnpm test, pnpm typecheck, pull_request all present in .github/workflows/test.yml)"
        status: pass
    human_judgment: false
  - id: D2
    description: "One real pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt run produced every figure in docs/models/sigma1-tuning-results.md; SC-3's literal 8-comparison verdict is 8/8 PASS"
    requirement: ALGO-04
    verification:
      - kind: integration
        ref: "reports/tuned-v3/artifact.json (real full-corpus run, runTimestamp 2026-08-17T01:11:06.668Z) -- every Holdout Head-to-Head and Tune-Season Result figure traced directly from this one artifact"
        status: pass
      - kind: manual_procedural
        ref: "docs/models/sigma1-tuning-results.md's SC-3 Verdict and Adaptation Finding sections reviewed against the raw artifact numbers per this plan's own human-check instruction: verdict states what the numbers say (8/8 pass, not softened or reworded), adaptation's positive Brier finding is flagged as a named decision rather than silently promoted"
        status: pass
    human_judgment: true
    rationale: "Confirming the verdict states what the numbers say rather than what was hoped for, and that a favorable result was not glossed into overclaiming, is exactly the kind of honesty-discipline judgment this plan's own verify block designates for human review."
  - id: D3
    description: "ALGO-05's best-vs-best holdout comparison (adaptation-on vs adaptation-off, each search's own winner) is published with both searches' budgets confirmed identical, and the D-08 disposition is recorded as a named decision given a measured, consistent (if modest) positive Brier finding"
    requirement: ALGO-05
    verification:
      - kind: integration
        ref: "reports/tuned-v3/artifact.json's sigma1 (off winner) vs sigma1-adapt (on winner) rows for 2025/2026, both algorithms built via cli.ts's applyPromotedOverrides from their respective committed/search-artifact source"
        status: pass
    human_judgment: false
  - id: D4
    description: "ALGO-08's reconciliation tolerances, the two unconfirmed corpus-converged RP thresholds, and one real worked RP pmf example (predicted pmf, derived mean/SD, actual RP earned) are documented"
    requirement: ALGO-08
    verification:
      - kind: other
        ref: "docs/models/sigma1-tuning-results.md's Ranking-Point Prediction section, worked example 2025isde1_qm25 computed from reports/tuned-v3/predictions-2025.jsonl + data/corpus.sqlite's recorded red_rp_earned/blue_rp_earned"
        status: pass
    human_judgment: false

duration: 6h03m
completed: 2026-08-17
status: complete
---

# Phase 3 Plan 6: CI Reproducibility Gate and Holdout Verdicts Summary

**CI now runs D-15's reproducibility gate for real against a committed fixture; one real 2022-2026 five-algorithm harness run shows tuned Sigma1 clearing SC-3's literal reading 8/8 and adaptation-on beating adaptation-off on holdout Brier — both verdicts recorded exactly as measured, including a Cauchy-Schwarz bug fix the real run itself surfaced.**

## Performance

- **Duration:** ~6h03m (dominated by the required real `pnpm harness --seasons 2022-2026` five-algorithm run — OPR alone costs roughly 30 minutes per season at this corpus's scale, matching Phase 2's own measured cost)
- **Started:** 2026-08-16T21:52:53Z (approx., first task commit)
- **Completed:** 2026-08-17T03:55:53Z (approx., final docs commit)
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- `.github/workflows/test.yml` is the repository's first CI test runner: triggers on every push and pull request, runs `pnpm typecheck` and `pnpm test` as separate steps, references no secret. `packages/harness/fixtures/extract-digest-slice.ts` extracts the promoted `sigma1@2.0.0+tuned-2026-08` version's recorded slice into a committed, bounded fixture (265 matches, 3 events, 644.4 KB); `digest.test.ts` now replays from the corpus when present or the fixture otherwise, asserts the two agree when both exist, and skips per version file (never for the whole suite) only when neither source covers that specific version — verified by simulating CI locally (corpus renamed away): the reproduction assertion still runs and the suite still exits 0.
- A real, required `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/tuned-v3` run needed `cli.ts`'s registry wired so `sigma1` resolves to the promoted tuned version and `sigma1-adapt` to the adaptation-on joint search's own winning candidate (rather than untuned defaults) — `applyPromotedOverrides`, applied lazily at CLI-entry time only, does this without touching module-import-time behavior other tests depend on.
- That real run surfaced a genuine, pre-existing bug: Sigma1's RP joint covariance matrix could be mathematically indefinite (not merely ill-conditioned), because the cross-covariance estimate (an EWMA of observed residual products) and its paired diagonal variances (Kalman posterior variances) are two estimators on different scales the model never otherwise constrained to stay mutually consistent. Fixed by clamping the cross term to its own Cauchy-Schwarz bound before the existing ridge escalation runs — verified against the real discovery's exact magnitude, and verified not to move any committed digest.
- `docs/models/sigma1-tuning-results.md` — every figure traced to the one required run (`reports/tuned-v3/artifact.json`) — records: **SC-3 PASSES 8/8** (tuned Sigma1 beats both OPR and EPA on holdout Brier AND winner accuracy, on both 2025 and 2026, closing the accuracy gap the Phase-2 starting position flagged as unlikely under a Brier-only objective); **ALGO-05's best-vs-best holdout comparison** shows adaptation-on beating adaptation-off on Brier on both holdout seasons (modest, consistent, ~0.8-2.4% relative), with the D-08 shipped-disabled default flagged as a named decision to revisit rather than silently flipped; and **ALGO-08's** reconciliation tolerances, unconfirmed corpus-converged thresholds, and a real worked RP pmf example.
- `.planning/REQUIREMENTS.md` marks ALGO-05 complete (D-08: satisfied by a measured answer in either direction) in both the checkbox list and traceability table; ALGO-04/ALGO-06/ALGO-08 were already complete from prior plans.

## Task Commits

1. **Task 1: Committed fixture slice + CI runner** — `7e4b09f4` (feat)
2. **[Rule 1 fix] RP cross-covariance Cauchy-Schwarz clamp, blocking Task 2's required real run** — `c4e270a7` (fix)
3. **[Rule 3 fix] cli.ts registry wiring to the promoted version and the on-search winner** — `3d81f440` (feat)
4. **Task 2: Holdout comparison, SC-3 verdict, ALGO-05 finding, REQUIREMENTS.md update** — `47b3d32b` (docs)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update)

## Files Created/Modified

- `.github/workflows/test.yml` — CI: `pnpm typecheck` + `pnpm test` on push/pull_request, no secrets
- `packages/harness/fixtures/extract-digest-slice.ts` — one-shot committed slice extraction (mirrors `identifiability.ts`'s standalone-script shape)
- `packages/harness/fixtures/digest-slice.json` — the committed 265-match/3-event/644KB fixture
- `packages/harness/digest.test.ts` — corpus-or-fixture replay, per-version-file explicit skip, corpus/fixture agreement assertion
- `packages/harness/promote.ts` — prints the exact fixture re-extraction command after every promotion
- `packages/harness/cli.ts` — `sigma1-defaults` registered; `applyPromotedOverrides` swaps `sigma1`/`sigma1-adapt` for their promoted-version/search-winner builds when present
- `packages/core/algorithms/sigma1/rp/distribution.ts` — `clampCrossCovariance`, applied before `CHOLESKY_RIDGES` escalation
- `packages/core/algorithms/sigma1/rp/distribution.test.ts` — 2 new tests: clamp fires and produces a valid pmf; an already-valid cross-covariance is untouched
- `docs/models/sigma1-tuning-results.md` — the SC-3/ALGO-05/ALGO-08/ALGO-06 verdicts, all 8 required sections
- `.planning/REQUIREMENTS.md` — ALGO-05 marked complete

## Decisions Made

See `key-decisions` in frontmatter. The two most consequential:

1. **SC-3 passes at its literal 8-comparison reading (8/8)** — a genuinely different outcome than the starting position and this plan's own `<objective>` anticipated ("winner accuracy is the live gap ... D-01's Brier-steered search may not close it"). Reported at the precision measured (margins are real but modest: +0.39pp/+0.48pp accuracy over OPR), not amplified or hedged.
2. **ALGO-05's adaptation finding is a genuine, if asymmetric and modest, positive Brier signal** — recorded as a named decision to revisit D-08's shipped-disabled default rather than either silently flipping it or forcing a negative-result writeup that the numbers do not support.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Blocking bug] RP joint covariance matrix could be mathematically indefinite, not merely ill-conditioned**
- **Found during:** Task 2, running the plan's required real `pnpm harness --seasons 2022-2026 --algorithm sigma1,sigma1-defaults,sigma1-adapt` command
- **Issue:** `rpPmfForMatch: joint covariance matrix ... is not positive definite even after escalating ridges up to 100`. Root cause: match `2026rikin_qm1`'s cold-start blue alliance had `scoreCrossCovariance=1315.57` against a Cauchy-Schwarz bound of `sqrt(511.26*1985.45)=1007.48` — a ~30% violation the existing `CHOLESKY_RIDGES` escalation (a diagonal-only fix) could never repair, since the determinant stays negative regardless of ridge magnitude when the off-diagonal term itself is invalid.
- **Fix:** Clamp each cross-covariance entry to `0.999 * sqrt(varX * varY)` before building the covariance matrix, so an already-invalid estimate is narrowed to the boundary of validity while every already-valid estimate is untouched.
- **Files modified:** `packages/core/algorithms/sigma1/rp/distribution.ts`, `packages/core/algorithms/sigma1/rp/distribution.test.ts`
- **Verification:** New tests prove the clamp resolves a fixture at the real discovery's exact magnitude and leaves an in-bound cross-covariance identical; full test suite (462/462) passes; both committed version digests still reproduce bitwise (confirming the clamp never fired on their recorded slices).
- **Committed in:** `c4e270a7`

**2. [Rule 3 - Blocking issue] `cli.ts`'s harness registry could not produce this plan's required comparison**
- **Found during:** Task 2, before the real run could start
- **Issue:** The plan's required literal command (`--algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt`) needs `sigma1-defaults` registered (it was not), `sigma1` to resolve to the promoted `tuned-2026-08` version (it resolved to Phase-2 untuned defaults), and `sigma1-adapt` to resolve to the adaptation-on joint search's own winning candidate (it resolved to untuned defaults plus a flag flip) — none of which the pre-existing static registry could do.
- **Fix:** `applyPromotedOverrides`, called once from `main()` at CLI-entry time only (never at module import time, so `cli.season-carry.test.ts`'s `runSeasons` import stays side-effect-free), swaps in the promoted-version/search-winner build when the corresponding file exists, falling back to the pre-existing static module otherwise.
- **Files modified:** `packages/harness/cli.ts`
- **Verification:** Smoke-tested on a fast single season before committing to the multi-hour full run (confirmed `artifact.json`'s `algorithms[]` carries the expected `version`/`paramSetName` for all three ids); full test suite and typecheck pass.
- **Committed in:** `3d81f440`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 3)
**Impact on plan:** Both were necessary for this plan's own required real-corpus command to run and produce the intended comparison at all — neither is scope creep, and both are covered by new tests / smoke verification proving the fix without changing any already-correct output.

## Issues Encountered

- The background harness run (`bkfivsbrj`) was reported "killed" by the runtime partway through (after finishing seasons 2022-2023, mid-2024) despite the underlying `node`/`tsx` process remaining alive and actively computing (confirmed via rising CPU time). The run was NOT restarted from scratch — the orphaned process was monitored directly (log file + process CPU) until it completed naturally, producing the one real, complete `reports/tuned-v3/artifact.json` this plan's entire results document is built from. No partial or spliced data was used.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 3's four requirements (ALGO-04, ALGO-05, ALGO-06, ALGO-08) are all marked complete in `.planning/REQUIREMENTS.md`, backed by evidence in `docs/models/sigma1-tuning-results.md` and `docs/models/sigma1-sensitivity-screen.md`.
- SC-3 (this phase's central success criterion) PASSES at its literal reading — Phase 4 (Cloudflare Worker incremental path) inherits a Sigma1 version that is measurably better than both baselines on both metrics, not merely "better on one axis."
- `## Open Items` in `docs/models/sigma1-tuning-results.md` lists six unresolved threads for a future phase or re-tune: the `processNoiseEventBoundary` bound-floor result, the LOSO 2024-fold sensitivity, adaptation's own untuned hyperparameters, the two unconfirmed RP thresholds, the RP reconciliation/conservative-branch limitations, and the unclassified ALGO-06 edge probe.
- **The adaptation-on promotion decision is explicitly unresolved** and is the one item most likely to need a human/product decision before Phase 4: whether to promote `reports/tune-joint-on.json`'s winner as the new shipped `sigma1` default given the measured Brier improvement, re-screen at `adaptationEnabled: true` first, or hold the current default.
- No blockers for Phase 4.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-17*

## Self-Check: PASSED

All 4 created files verified present on disk (`.github/workflows/test.yml`, `packages/harness/fixtures/extract-digest-slice.ts`, `packages/harness/fixtures/digest-slice.json`, `docs/models/sigma1-tuning-results.md`); all 4 task commit hashes (`7e4b09f4`, `c4e270a7`, `3d81f440`, `47b3d32b`) verified present in `git log --all`.
