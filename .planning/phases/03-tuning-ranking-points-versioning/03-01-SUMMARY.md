---
phase: 03-tuning-ranking-points-versioning
plan: 01
subsystem: algorithms
tags: [sigma1, kalman, hyperparameter-tuning, versioning, reproducibility, zod, sha256, vitest]

# Dependency graph
requires:
  - phase: 02-prediction-models-epa-sigma1
    provides: Sigma1's AlgorithmModule (predict/update/teamMetrics/carrySeason), carryover.ts's epaCarryover and EPA constants, the harness's runSeasons/score.ts/artifact.ts machinery
provides:
  - "Sigma1Params: the full 17-field tunable hyperparameter interface, threaded through makeSigma1 instead of read as module constants"
  - "DEFAULT_SIGMA1_PARAMS: provably reproduces every pre-Phase-3 Sigma1 numeric default"
  - "packages/harness/tune.ts: offline hyperparameter search entry point with structural holdout blindness (ALGO-04's infrastructure)"
  - "packages/harness/promote.ts: explicit version promotion — validates, replays a bounded slice, writes a committed SHA-256 digest (D-13/D-14/D-15)"
  - "packages/harness/digest.test.ts: SC-5 reproducibility CI gate"
  - "sigma1Carryover: Sigma1's own tunable season-carry copy, provably decoupled from EPA's frozen carry (D-04)"
  - "data/algorithm-versions/: the first committed promoted version, proving the tuning->promotion->reproduction spine works end to end"
affects: [03-02-ranking-points, 03-04-adaptation, 03-05-sensitivity-screen-joint-search, 03-06-final-integration]

actuals:
  tokens: 27524
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Parameterized algorithm module: makeSigma1 resolves params once and threads it as an explicit trailing argument through predict/update/teamMetrics/carrySeason, rather than each function reading a bare module constant"
    - "Leaf-module constant ownership to avoid ESM import cycles: a shared params.ts imports from single-purpose leaf modules (kalman.ts/consistency.ts/covariance.ts/linkFunctions.ts/carryover.ts) but is never imported back by the module that assembles them (sigma1/index.ts) for the same constants"
    - "Validate-then-write for committed artifacts: promote.ts builds a candidate object and PromotedVersionSchema.parse()s it before any write, matching artifact.ts's buildArtifact discipline"
    - "Structural double-gate for a forbidden input class: tune.ts checks HOLDOUT_SEASONS both before any corpus read AND after scoring (on every produced ScoreSlice), so leakage is a runtime impossibility, not a convention"

key-files:
  created:
    - packages/core/algorithms/sigma1/params.ts
    - packages/core/algorithms/sigma1/params.test.ts
    - packages/core/algorithms/sigma1/carryover.ts
    - packages/core/algorithms/sigma1/carryover.test.ts
    - packages/harness/tune.ts
    - packages/harness/promote.ts
    - packages/harness/digest.test.ts
    - data/algorithm-versions/sigma1@2.0.0+tracer-check.json
  modified:
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/consistency.ts
    - packages/core/algorithms/sigma1/covariance.ts
    - packages/core/algorithms/carryover.ts
    - .gitignore
    - package.json

key-decisions:
  - "The four constants the plan drafted for sigma1/index.ts (SIGMA1_COLD_START_TEAM_TOTAL, SIGMA1_COLD_START_CONSISTENCY_VARIANCE, SIGMA1_FALLBACK_SCORE_SD, SIGMA1_CONSISTENCY_CARRY_DECAY) now live in params.ts itself, with index.ts importing and re-exporting them -- the literal plan instruction created a genuine ESM circular import (index.ts needs Sigma1Params/DEFAULT_SIGMA1_PARAMS for its own top-level makeSigma1(...) calls; params.ts would need index.ts's constants for DEFAULT_SIGMA1_PARAMS's own top-level object literal), which throws a TDZ ReferenceError at load time regardless of import order"
  - "tune.ts does not import cli.ts's exported runSeasons (the plan's stated key_link) -- runSeasons has no event-bounding parameter, and the plan's own --events flag requires one. tune.ts instead mirrors runSeasons's season-loop/carrySeason-threading orchestration locally while reusing the actual leak-proof primitives (buildSeasonStream, WalkForwardSimulator) unchanged, so every optimizer evaluation still inherits toLeakProofUpcoming's guarantee"
  - "ALGO-04/ALGO-06 are NOT marked complete in REQUIREMENTS.md by this plan, despite appearing in its frontmatter requirements list -- both IDs also appear in 03-05's and 03-06's requirements lists, and this plan ships the tuning/versioning INFRASTRUCTURE (tracer search over one knob, one promoted test version) rather than the full sensitivity screen + joint search (03-05) or final integration (03-06) those requirements actually describe. Matches the ALGO-03 precedent from plan 02-02 (STATE.md decision log): mark complete only what a plan actually shipped, never what its frontmatter merely lists"

patterns-established:
  - "Every Sigma1Params field's doc comment names the exact source constant it was imported from and preserves the 'Phase 3 hyperparameter, default unverified' tag verbatim where it applies -- the sensitivity screen (03-05) greps for this exact phrase"
  - "A field's wiring proof is scoped to WHERE its effect actually surfaces (predict/update replay stream vs. teamMetrics-only vs. a field requiring a hand-built low-observation-count state) rather than forcing every field through one generic comparison, which would produce false 'not wired' failures for fields that are correctly wired but only observable through a different code path"

requirements-completed: []

coverage:
  - id: D1
    description: "Sigma1's 17 hyperparameters are plain data (Sigma1Params) threaded through makeSigma1, with DEFAULT_SIGMA1_PARAMS provably reproducing every pre-Phase-3 numeric default"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/params.test.ts#DEFAULT_SIGMA1_PARAMS reproduces Phase-2 behaviour exactly"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts (full suite, unmodified)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every field wired by the end of Task 2 is proven read by the update/predict/teamMetrics path via a differing output when perturbed, not just present in the type"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/params.test.ts#fields observable through the predict/update replay stream"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/params.test.ts#fields observable only through teamMetrics"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/params.test.ts#fallbackScoreSd — predict-only, but unreachable via a normal replay"
        status: pass
    human_judgment: false
  - id: D3
    description: "An offline search (tune.ts) with structural holdout blindness searches processNoiseEventBoundary against tune-season Brier and writes a search log; a real 2022 corpus replay confirms the pipeline"
    verification:
      - kind: integration
        ref: "pnpm tune --seasons 2022 --events 8 --stage tracer (writes reports/tune-tracer.json with 3 candidates, 1 winner)"
        status: pass
      - kind: integration
        ref: "pnpm tune --seasons 2025 --stage tracer (exits non-zero, stderr names the holdout season)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Explicit promotion (promote.ts) validates the winning parameter set, replays a bounded deterministic slice, and writes a committed, schema-valid version file with a full-precision SHA-256 digest"
    verification:
      - kind: integration
        ref: "pnpm promote --from reports/tune-tracer.json --name tracer-check --slice-events 2 (writes data/algorithm-versions/sigma1@2.0.0+tracer-check.json)"
        status: pass
      - kind: integration
        ref: "Running pnpm promote twice with identical flags produces a byte-identical digest.predictionStreamSha256"
        status: pass
    human_judgment: false
  - id: D5
    description: "digest.test.ts re-runs a promoted version on its own recorded slice and reproduces its committed digest and headline metrics bitwise (SC-5)"
    verification:
      - kind: unit
        ref: "packages/harness/digest.test.ts#promoted algorithm version reproducibility (D-15/SC-5)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Sigma1 carries its own tunable copy of the three carry constants (sigma1Carryover); EPA's carry constants are frozen and proven immovable by any Sigma1 parameter perturbation"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/carryover.test.ts (all 4 tests, including the D-04 freeze proofs)"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-08-15
status: complete
---

# Phase 3 Plan 1: Sigma1 Parameter Surface, Tuning, and Version Reproducibility Summary

**Sigma1's Kalman/carry hyperparameters became versionable plain data, proven end to end by a real tuned-promoted-reproduced version committed to `data/algorithm-versions/`**

## Performance

- **Duration:** ~70 min (including a tracer human-verification checkpoint pause)
- **Started:** 2026-08-15T02:19:54Z
- **Completed:** 2026-08-15T03:28:18Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- Sigma1's full 17-field hyperparameter set (`Sigma1Params`) is threaded through `makeSigma1` as explicit data — `DEFAULT_SIGMA1_PARAMS` provably reproduces every Phase-2 default (the whole pre-existing Sigma1 test suite passes unmodified), and every field is proven actually read by the code (not just declared) via a targeted per-field wiring test.
- `tune.ts` (offline search) and `promote.ts` (explicit version promotion) built and proven against the real corpus: a bounded 3-candidate search over `processNoiseEventBoundary` on 2022 data produced a winner, which was promoted to a committed, schema-valid `data/algorithm-versions/sigma1@2.0.0+tracer-check.json` carrying a full-precision SHA-256 prediction-stream digest.
- `digest.test.ts` re-runs that committed version on its own recorded bounded slice and asserts the digest and headline metrics reproduce bitwise — this test actually RAN (not skipped) against the real local corpus and passed.
- Holdout blindness is structural: `tune.ts` refuses to even start against 2025/2026, and independently re-checks every produced score slice after scoring — not a convention, a runtime impossibility.
- EPA's carry constants (Statbotics' own published values) are now provably frozen: Sigma1 has its own tunable `sigma1Carryover`, and a test proves perturbing Sigma1's carry parameters cannot move `epaCarryover`'s output or a full `epa` module's prediction stream across a real season boundary.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "one knob tuned, promoted, and reproduced"** (tracer) - `fb10c901` (feat)
2. **Task 2: Expand the parameter surface — every tagged constant becomes searchable data** - `d6e34bda` (feat)
3. **Task 3: Split carryover so Sigma1 carries its own tunable constants and EPA stays frozen (D-04)** - `8970d859` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md update)

## Files Created/Modified

- `packages/core/algorithms/sigma1/params.ts` - `Sigma1Params`, `DEFAULT_SIGMA1_PARAMS`, `Sigma1ParamsSchema` (strict, finite), `SIGMA1_PARAM_KEYS`, `SIGMA1_CODE_VERSION`; also now owns `SIGMA1_COLD_START_TEAM_TOTAL`/`SIGMA1_COLD_START_CONSISTENCY_VARIANCE`/`SIGMA1_FALLBACK_SCORE_SD`/`SIGMA1_CONSISTENCY_CARRY_DECAY` (moved here to avoid a circular import — see Deviations)
- `packages/core/algorithms/sigma1/params.test.ts` - default-reproduces-Phase-2 equality, schema strict/finite enforcement, `SIGMA1_PARAM_KEYS` derivation, determinism, and per-field wiring proofs split by where each field's effect surfaces
- `packages/core/algorithms/sigma1/carryover.ts` - `sigma1Carryover(input, params)`, Sigma1's own tunable copy of the season-boundary carry
- `packages/core/algorithms/sigma1/carryover.test.ts` - behaviour-preservation at defaults, the D-04 freeze proof (perturbing Sigma1 never moves `epaCarryover`), and a full cross-module replay proof
- `packages/core/algorithms/sigma1/index.ts` - `makeSigma1` threads `params` through `predict`/`update`/`teamMetrics`/`carrySeason`; `version` is now `{SIGMA1_CODE_VERSION}+{paramSetName}`; every remaining direct constant read converts to a `params.*` field read; `carrySeason` calls `sigma1Carryover` instead of `epaCarryover`; adds `sigma1Defaults` baseline export
- `packages/core/algorithms/sigma1/consistency.ts` - `shrinkConsistency` gains a trailing defaulted `minVariance` argument
- `packages/core/algorithms/sigma1/covariance.ts` - `ewmaCovariance` gains a trailing defaulted `shrinkage` argument
- `packages/core/algorithms/carryover.ts` - exports `populationMeanSd`/`normalizedFromPoints` (pure widening); extends the module header to state the EPA carry constants are frozen per D-04 and this module must never read Sigma1's parameter set
- `packages/harness/tune.ts` - offline hyperparameter search entry point (`pnpm tune`), structural holdout blindness, bounded-event replay reusing `buildSeasonStream`/`WalkForwardSimulator`
- `packages/harness/promote.ts` - explicit promotion entry point (`pnpm promote`), `PromotedVersionSchema`, `computePredictionStreamDigest`
- `packages/harness/digest.test.ts` - SC-5 reproducibility CI gate over every committed `data/algorithm-versions/*.json`
- `.gitignore` - `data/` → `data/*` + `!data/algorithm-versions/` (git cannot re-include a path whose parent is fully excluded)
- `package.json` - `tune`/`promote` scripts

## Decisions Made

- **Circular-import fix (Rule 3, blocking):** moved four constants from a drafted `sigma1/index.ts` location into `params.ts` itself, with `index.ts` importing and re-exporting them, to avoid a genuine ESM load-time TDZ crash. Same literal values, same doc comments, no behavioral change — verified by the full pre-existing test suite passing unmodified.
- **`tune.ts` does not import `cli.ts`'s `runSeasons`** (the plan's stated key_link): that function has no event-bounding parameter, and the plan's own `--events <N>` flag requires one. `tune.ts` mirrors `runSeasons`'s season-loop/carry-threading orchestration locally while reusing the actual leak-proof primitives (`buildSeasonStream`, `WalkForwardSimulator`) unchanged.
- **ALGO-04/ALGO-06 intentionally NOT marked complete in REQUIREMENTS.md.** Both IDs also appear in 03-05's and 03-06's requirements lists; this plan ships the tuning/versioning machinery (one knob searched, one test version promoted) rather than the full sensitivity screen + joint search or final phase integration those requirements describe. Matches the ALGO-03 precedent already recorded in STATE.md's decision log.
- **Field-wiring test scoping (params.test.ts):** rather than forcing every `Sigma1Params` field through one generic predict()-stream comparison (which produced false "not wired" failures for fields whose effect only surfaces via `teamMetrics` or requires a hand-built low-observation-count state), the wiring proof is split into three groups by where each field's effect actually manifests, with each group's own comment explaining why.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Circular ESM import between `sigma1/index.ts` and `sigma1/params.ts`**
- **Found during:** Task 1, while implementing `params.ts` exactly as drafted
- **Issue:** The plan's literal instruction was to define `SIGMA1_COLD_START_TEAM_TOTAL`/`SIGMA1_COLD_START_CONSISTENCY_VARIANCE`/`SIGMA1_FALLBACK_SCORE_SD`/`SIGMA1_CONSISTENCY_CARRY_DECAY` in `sigma1/index.ts` and import them into `params.ts`. But `index.ts` also needs `Sigma1Params`/`DEFAULT_SIGMA1_PARAMS` from `params.ts` for its own top-level `makeSigma1(...)` calls (`sigma1`, `sigma1SeasonSd`, `sigma1NormalCdf`). Both modules would then dereference a binding from the other at module-top-level-evaluation time — a genuine ESM cycle that throws `ReferenceError: Cannot access '...' before initialization` (TDZ) the first time the module graph loads, regardless of which module is the entry point (traced through both possible evaluation orders before implementing the fix).
- **Fix:** Moved the four constants into `params.ts` itself (a pure leaf module importing only from `kalman.ts`/`consistency.ts`/`covariance.ts`/`linkFunctions.ts`/`carryover.ts`, never from `sigma1/index.ts`) and had `index.ts` import + re-export them — the same "leaf module owns the constant, `index.ts` imports it" shape the four pre-existing constant-owning modules already use.
- **Files modified:** `packages/core/algorithms/sigma1/params.ts`, `packages/core/algorithms/sigma1/index.ts`
- **Verification:** Full `sigma1` test suite (50 tests at the time) passed unmodified; full repo suite (277 tests) passed with zero failures. Literal values and doc-comment content preserved exactly.
- **Committed in:** `fb10c901` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Necessary for correctness (the literal instruction would have crashed at load time). No scope creep — same constants, same values, same public API surface, just relocated to the acyclic-import-safe module.

## Issues Encountered

- **`params.test.ts` field-wiring test initially failed for 5 of 12 replay-scoped fields** (`processNoiseEventBoundary`, `shrinkagePriorMatches`, `minConsistencyVariance`, `fallbackScoreSd`, `consistencyCarryDecay`) because a single generic 3-match predict()-stream comparison genuinely does not observe every field's effect — some fields only affect `teamMetrics()`, one (`fallbackScoreSd`) is architecturally unreachable through any normal replay (traced to `standardDeviation`'s fallback only applying at `allianceScoreStats.count < 2`, a state `update()` can never produce since it always folds exactly 2 observations per call). Resolved by building a combined multi-match/season-boundary observable snapshot for replay-visible fields, a separate `teamMetrics()` comparison for display-only fields, and a dedicated hand-built-state test for `fallbackScoreSd` — not a test bug fix disguised as a code fix; the underlying wiring was already correct in every case, only the test's OBSERVATION POINT was wrong.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `packages/harness/tune.ts`/`promote.ts` are ready for 03-05's real sensitivity screen (one-at-a-time over every tagged constant) and joint search — both reuse the same leak-proof replay primitives and the same `Sigma1ParamsSchema`/`SIGMA1_PARAM_KEYS` discipline this plan established.
- `Sigma1Params`'s `carryMeanReversion`/`carryLastYearWeight`/`carryPriorYearWeight` fields are wired via `sigma1Carryover` and ready for the sensitivity screen; `rpMonteCarloSeed`/`rpMonteCarloDraws` are declared but deliberately unwired, waiting for plan 03-03's RP joint model.
- `data/algorithm-versions/sigma1@2.0.0+tracer-check.json` is a real, committed, schema-valid, reproducible version — the concrete proof artifact that D-13/D-14/D-15's versioning scheme works, not just a design on paper. Later plans can promote further named parameter sets under the same `sigma1` id without any schema or script changes.
- No blockers for 03-02 (ranking-point prediction) or 03-04 (adaptation) — both build on this plan's `Sigma1Params`/`makeSigma1` surface without needing further changes to it.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-15*

## Self-Check: PASSED

All 8 created files verified present on disk; all 3 task commits (`fb10c901`, `d6e34bda`, `8970d859`) verified present in git log.
