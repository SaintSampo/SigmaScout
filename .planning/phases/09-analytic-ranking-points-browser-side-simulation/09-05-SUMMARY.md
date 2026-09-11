---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 05
subsystem: api
tags: [ranking-points, negative-binomial, tie-model, win-probability, vitest, typescript, browser-safe]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-04's RpLayerConfig/RP_LAYER_CONFIG_DEFAULT/assertSupportedRpLayerConfig at inert defaults (analyticPmf.ts); 09-03's fitMarginal/FittedMarginal/marginals.ts numeric core; 09-02's MarginalFamily/RpThresholdVariable.marginalFamily; 09-01's frozen data/baselines/level1-digest-2026-09.json"
provides:
  - "packages/core/rankingPoints/analyticPmf.ts — three landed RpLayerConfig branches (winSource: \"p-red-win\" D-13, tieModel: \"discrete-margin\" D-14, marginal: \"negative-binomial\" D-01), all off by default: OutcomeSplit/splitOutcomeProbabilities, TIE_MARGIN_HALF_WIDTH/tieProbability, resolveDeclaredFamily (replaces 09-04's resolveMarginalFamily), MarginalResolutionTally/emptyMarginalResolutionTally, a required AnalyticRpPmfInput.pRedWin and optional .tally/.marginalResolution"
  - "packages/core/rankingPoints/rpLayerInertness.json + rpLayerInertness.test.ts + scripts/rpLayerInertnessGolden.ts — the golden captured before the first edit, proving the production default is byte-identical after all three arms landed and all 34 declarations flipped"
  - "packages/core/rankingPoints/{2016..2026}.ts — all 34 marginalFamily declarations flipped to \"negative-binomial\" with evidence-class notes"
  - "packages/harness/sigmaScoutLayer.ts — public rpMarginalResolutionTally accessor, prediction.pRedWin threaded into #rpFieldsFor; production default unchanged"
  - "docs/models/rp-layer-config-arms.md — the arms, the 34-row flip table, the Open Question 3 record; 09-06's read"
affects: [09-06, 09-07, 09-08, 09-09, 09-10]

# Actuals (#2632)
actuals:
  tokens: 51500
  tasks: 4
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Golden captured BEFORE the first edit, with capturedFrom pinning the pre-edit commit hash, replayed via toEqual — 09-02's rpPredictThresholdsGolden.ts's own precedent, applied one plan later to prove a whole plan's inertness rather than one script's grid"
    - "An extra, currently-unused input property (pRedWin) added to a builder's raw object literal BEFORE the interface declares it, so TypeScript's excess-property check (which only fires on freshly-checked literals, not on already-bound identifiers passed through a call) never blocks the file from compiling both before and after the field becomes required — used to keep the committed golden script and its own test file untouched across the Commit-1/Commit-2 boundary"
    - "A per-call local tally ALWAYS built and returned (result.marginalResolution), separately merged into an OPTIONAL external accumulator (input.tally) rather than replacing it — lets a caller read either 'what did this one match resolve to' or 'what has this layer resolved to across its whole run' without two APIs"

key-files:
  created:
    - scripts/rpLayerInertnessGolden.ts
    - packages/core/rankingPoints/rpLayerInertness.json
    - packages/core/rankingPoints/rpLayerInertness.test.ts
    - packages/harness/sigmaScoutLayer.rpArms.test.ts
    - docs/models/rp-layer-config-arms.md
  modified:
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/analyticPmf.test.ts
    - packages/core/rankingPoints/constants.ts
    - packages/core/rankingPoints/rules.test.ts
    - packages/core/rankingPoints/2016.ts
    - packages/core/rankingPoints/2017.ts
    - packages/core/rankingPoints/2018.ts
    - packages/core/rankingPoints/2019.ts
    - packages/core/rankingPoints/2020.ts
    - packages/core/rankingPoints/2022.ts
    - packages/core/rankingPoints/2023.ts
    - packages/core/rankingPoints/2024.ts
    - packages/core/rankingPoints/2025.ts
    - packages/core/rankingPoints/2026.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - package.json
    - apps/worker/src/bundleSmoke.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/core/algorithms/simulation/rankSimulation.test.ts
    - packages/core/rankingPoints/analyticPmf.universal.test.ts
    - packages/core/rankingPoints/analyticPmf.seasons.test.ts
    - packages/core/rankingPoints/empiricalMoments.test.ts

key-decisions:
  - "AnalyticRpPmfInput.pRedWin's REQUIRED status (plan-pinned) forced touching every OTHER pre-existing call site of analyticRpPmf beyond this plan's declared seven files — publish.ts's second RP write path, apps/worker/src/bundleSmoke.ts, and four pre-existing test files. Judged unavoidable given the plan's own 'required, not optional, so no call site can omit it and get a silent zero' mandate; documented as a Rule 3 deviation rather than silently narrowing the field's scope."
  - "splitOutcomeProbabilities clamps a FINITE-but-out-of-range pRedWin into [0,1], but a NON-FINITE pRedWin is deliberately left UNCLAMPED (propagates as NaN) rather than laundered into a neutral 0.5 — discovered via a real regression (Test 8's non-finite-scoreMean-must-throw assertion started passing under a corrupted computation once NaN was silently smoothed to 0.5). clampedPRedWin still flags the non-finite case; it just doesn't fabricate a safe-looking answer for it."
  - "Task 2's optional real-margin regime gate (real 2022 corpus replay, mean predicted tie probability in [0.004, 0.030]) is a RECORDED SKIP, not attempted-and-forced: Prediction does not expose pTie in isolation (it convolves into the pmf at multiple indices with bonus RP), and extracting it needs either a new SigmaScoutLayer accessor (API-surface scope creep) or a second, independently-derived matchOutcomeDistribution call outside the layer — exactly the 'invented second replay harness' risk the plan warned against. The pinned analytic check (tieProbability against F7's measured base rate) stands in its place."
  - "tieProbability(20, 40 ** 2)'s test pins 0.0088015, not the plan's own hand-computed 0.0087997 — cross-checked independently via Python's math.erf (not this codebase's A-S 7.1.26 approximation) at 0.008801461265007637; the implementation matches that to 1.3e-8 (well inside A-S's 1.5e-7 bound), so the plan's manual Phi-table arithmetic, not the shipped code, carries the ~1.76e-6 discrepancy. Reported per the plan's own 'a mismatch is a finding to report, not a number to overwrite' instruction."
  - "resolveMarginalFamily (09-04's placeholder, signature (declared, config)) was RENAMED, not left alongside, to resolveDeclaredFamily (variable, config) — the plan's pinned signature. It had no test-file references anywhere in the tree, so the rename was a clean replacement rather than an additive one, keeping 'exactly one producer of fitMarginal's declared argument' literally true rather than merely intended."

patterns-established:
  - "The three RpLayerConfig arms are all landed and independently selectable (D-05's 'any combination is instantiable' requirement is now true), with the production default provably unmoved by a golden captured before the first edit — 09-06 has a clean, measurable starting line."

requirements-completed: [D-01, D-05, D-13, D-14, F6, F7]

coverage:
  - id: D1
    description: "winSource: \"p-red-win\" is selectable and, under the legacy tie model, the red outcome half's winRp mass is bitwise === the supplied pRedWin at six pinned values including both endpoints — F6's coherence gap closed by construction"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/analyticPmf.test.ts — 'under winSource: \"p-red-win\" with the legacy tie model...' (it.each over 6 pinned pRedWin values) and the F6-statistic-is-zero-by-construction test"
        status: pass
    human_judgment: false
  - id: D2
    description: "tieModel: \"discrete-margin\" makes the tie branch reachable; tieProbability(0, 36.5 ** 2) lands within 1e-6 of the pinned value and within 5e-6 of F7's measured base rate; the degenerate guard is ordered before the division"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/analyticPmf.test.ts — the 'tieProbability / matchOutcomeDistribution — 09-05 Task 2' describe block (reachability, base-rate, off-centre, degenerate-guard, monotonicity/symmetry, partition, conditional-exactness, tie-mass-lands-on-tieRp tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "marginal: \"negative-binomial\" reaches the family swap through exactly one route (resolveDeclaredFamily, sole producer of fitMarginal's declared argument), all 34 season-module declarations flip, and the resolved-family mix is counted (not just declared) at both the pure-function and SigmaScoutLayer levels"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/analyticPmf.test.ts — 'resolveDeclaredFamily / MarginalResolutionTally' describe block, including the cold-team fallback proof; packages/core/rankingPoints/rules.test.ts — the pinned 34-entry NEGATIVE_BINOMIAL_DECLARATIONS list; packages/harness/sigmaScoutLayer.rpArms.test.ts — the layer-level tally-accumulates-and-never-leaks-onto-Prediction test"
        status: pass
    human_judgment: false
  - id: D4
    description: "The production default RpLayerConfig is provably unmoved: a golden captured before the first edit stays green after all three arms landed and all 34 declarations flipped; neither publishSeasons nor runEventMode nor any production SigmaScoutLayer construction site overrides it"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/rpLayerInertness.test.ts (green across every commit in this plan, golden never regenerated — one commit in its git history); packages/harness/sigmaScoutLayer.rpArms.test.ts — the production-default tripwire test"
        status: pass
    human_judgment: false
  - id: D5
    description: "All eight {winSource, tieModel, marginal} combinations are instantiable and produce well-formed pmfs across three mechanism-diverse seasons; exactly one reproduces the golden and each single-change combination is proven to differ from it in at least one case"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/analyticPmf.test.ts — the '09-05 Task 4' describe block's matrix loop and the 'exactly one combination reproduces the committed golden' test"
        status: pass
    human_judgment: false
  - id: D6
    description: "Open Question 3 answered as a machine-checked fact (not an inference): the band variance feeds nothing in the RP layer under winSource: \"p-red-win\" with the legacy tie model; under discrete-margin it survives only as the tie window's width. #rpFieldsFor's band gate is recorded as partly vestigial and deliberately untouched"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/analyticPmf.test.ts — the scoreVariance-sweep tests (identical pmfs / identical bonus-only half) and the momentsFor source-line assertion"
        status: pass
    human_judgment: false

duration: ~1h25m
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 5: RP Layer Config Arms — winSource, tieModel, marginal Summary

**Three RpLayerConfig branches landed and independently selectable (winSource: "p-red-win" closes F6's 0.34-max coherence gap by construction, tieModel: "discrete-margin" makes F7's dead tie branch fire at the measured 1.09% base rate, marginal: "negative-binomial" flips all 34 season-declared thresholds) — production default provably unmoved by a golden captured before the first edit, nothing published changes.**

## Performance

- **Duration:** ~1h25m
- **Tasks:** 4
- **Commits:** 6 (`fdb2eb9d` golden capture, `17331ece` Task 1, `bca53552` Task 2, `f9e885e3` + `ce0c023a` Task 3, `d7a06cd1` Task 4)
- **Files touched:** 5 created, 22 modified

## Accomplishments

- **Captured the inertness golden BEFORE any edit** (`scripts/rpLayerInertnessGolden.ts`, `rpLayerInertness.json`, `rpLayerInertness.test.ts`): 91 hand-built cases (10 registered seasons x 3 event tiers x 3 nominal `pRedWin` values, plus one non-bonus `compLevel` case) evaluated under 09-04's exported production-default `RpLayerConfig`, `capturedFrom` pinning commit `380e136c` — the ancestor of every later commit in this plan. The instrument was watched to FAIL (a deliberate mean-vector perturbation, reverted) before being trusted to pass, and it stayed green through every subsequent commit in this plan, including after all three arms landed and all 34 `marginalFamily` declarations flipped.
- **`winSource: "p-red-win"` (D-13, F6)** wired end to end: `splitOutcomeProbabilities` (proportional split, D-14's formulation pinned and recorded, clamping a finite-but-out-of-range `pRedWin` but leaving a non-finite one unclamped so `assertNormalizedPmf`'s existing finite guard still catches upstream corruption), a required `pRedWin` on `AnalyticRpPmfInput`/`RpOutcomeInput`, wired through `#rpFieldsFor`. Under `"p-red-win"` with the legacy tie model the red outcome half's `winRp` mass is bitwise `===` the supplied `pRedWin` at six pinned values including both endpoints; under the default config three different `pRedWin` values produce identical pmfs (required-but-unread proof).
- **`tieModel: "discrete-margin"` (D-14, F7)** makes the dead tie branch reachable: `TIE_MARGIN_HALF_WIDTH = 0.5` (structural) and `tieProbability(marginMean, marginVariance)`, degenerate guard ordered before the division. `tieProbability(0, 36.5 ** 2)` returns `0.0109297`, matching F7's measured `1206/110362 = 0.0109277` within 5e-6. **Finding:** the plan's own hand-pinned `tieProbability(20, 40 ** 2) = 0.0087997` is off by ~1.76e-6 from the mathematically correct value (independently verified via Python's `math.erf`); this implementation's `0.0088014747` matches the precise value to 1.3e-8, so the test pins the corrected literal.
- **`marginal: "negative-binomial"` (D-01, F2)**, two commits: mechanism (`resolveDeclaredFamily` as the sole producer of `fitMarginal`'s `declared` argument, `MarginalResolutionTally`, `SigmaScoutLayer.rpMarginalResolutionTally`), then data entry (all 34 threshold-variable declarations across the ten registered seasons flipped, zero exceptions, evidence class recorded per season).
- **The eight-combination matrix and Open Question 3**, machine-checked: all eight `{winSource, tieModel, marginal}` combinations construct well-formed pmfs across 2026/2016/2025; exactly one reproduces the golden and each single-change combination is proven to differ from it in at least one case; the band variance's irrelevance to the RP layer under `p-red-win`+legacy-tie is proven by a `scoreVariance` sweep across three orders of magnitude producing bitwise-identical pmfs.
- **`docs/models/rp-layer-config-arms.md`** — the document 09-06 reads: the three arms' exact formulations and what was rejected, the complete 34-row evidence-class table, what `MarginalResolutionTally` counts and why, the Open Question 3 record, how to reproduce the golden, and an explicit "what this document does not say."

## Task Commits

1. **golden capture (before Task 1's first edit)** — `fdb2eb9d` (test)
2. **Task 1: `winSource: "p-red-win"` wired end to end** — `17331ece` (feat)
3. **Task 2: `tieModel: "discrete-margin"`** — `bca53552` (feat)
4. **Task 3, Commit 1: `marginal: "negative-binomial"` mechanism** — `f9e885e3` (feat)
5. **Task 3, Commit 2: the 34-declaration data entry** — `ce0c023a` (feat)
6. **Task 4: the eight-combination matrix, Open Question 3, the document** — `d7a06cd1` (test)

## Files Created/Modified

- `scripts/rpLayerInertnessGolden.ts` — the golden generator: `buildGoldenCases`, `buildAllianceMoments`, `approxBaseThreshold`, `--regenerate` guard
- `packages/core/rankingPoints/rpLayerInertness.json` — the committed golden (91 cases, `capturedFrom: 380e136c...`)
- `packages/core/rankingPoints/rpLayerInertness.test.ts` — the replay gate
- `packages/core/rankingPoints/analyticPmf.ts` — `OutcomeSplit`/`splitOutcomeProbabilities`, `TIE_MARGIN_HALF_WIDTH`/`tieProbability`, `resolveDeclaredFamily`, `MarginalResolutionTally`/`emptyMarginalResolutionTally`, required `pRedWin` + optional `tally`/`marginalResolution` on the pmf input/result
- `packages/core/rankingPoints/analyticPmf.test.ts` — four new describe blocks (one per task) plus `pRedWin` threaded through every pre-existing literal call
- `packages/core/rankingPoints/constants.ts` — `MarginalFamily`'s doc comment rewritten to name the evidence-class framework
- `packages/core/rankingPoints/rules.test.ts` — the pinned 34-entry `NEGATIVE_BINOMIAL_DECLARATIONS` list
- `packages/core/rankingPoints/{2016..2026}.ts` — all 34 declarations flipped, evidence-class note per module
- `packages/harness/sigmaScoutLayer.ts` — `#rpMarginalResolutionTally` + public `rpMarginalResolutionTally` accessor, `pRedWin`/`tally` threaded into `#rpFieldsFor`
- `packages/harness/sigmaScoutLayer.rpArms.test.ts` — new file: the recorded-skip regime gate, the layer-level tally proof, the production-default tripwire
- `docs/models/rp-layer-config-arms.md` — new: 09-06's document
- `packages/harness/publish.ts`, `apps/worker/src/bundleSmoke.ts`, `packages/core/algorithms/sigma1/sigma1.test.ts`, `packages/core/algorithms/simulation/rankSimulation.test.ts`, `packages/core/rankingPoints/analyticPmf.universal.test.ts`, `packages/core/rankingPoints/analyticPmf.seasons.test.ts`, `packages/core/rankingPoints/empiricalMoments.test.ts` — `pRedWin` threaded through every OTHER pre-existing `analyticRpPmf` call site (Rule 3 fallout of the required field, see Deviations)
- `package.json` — one new script, `rp:inertness-golden`, no dependency change

## The three arms, as shipped

**09-06 reads this section.**

| Field | Legacy member | New member | Finding closed |
|---|---|---|---|
| `winSource` | `"score-draw"` | `"p-red-win"` | F6 |
| `tieModel` | `"continuous-equality"` | `"discrete-margin"` | F7 |
| `marginal` | `"gaussian"` | `"negative-binomial"` | F2 |

- **`winSource: "p-red-win"`**: `pRedWinEffective = input.pRedWin` (the published float, used directly). Under the legacy tie model, `splitOutcomeProbabilities(pRedWin, 0)` gives `pRedStrict === pRedWin` exactly (`x * 1 === x`). Under `discrete-margin` also selected, `pRedStrict / (pRedStrict + pBlueStrict) === pRedWin` within 1e-12.
- **`tieModel: "discrete-margin"`**: `pTie = Phi((0.5 - marginMean)/marginSd) - Phi((-0.5 - marginMean)/marginSd)`, degenerate guard (non-finite or `<= 0` variance) evaluated BEFORE the division. Proportional split chosen over subtract-half (see doc for the full rejection reasoning).
- **`marginal: "negative-binomial"`**: `resolveDeclaredFamily(variable, config) = config.marginal === "negative-binomial" ? variable.marginalFamily : "gaussian"` — the sole producer of `fitMarginal`'s `declared` argument (confirmed by source grep: exactly one call site).

Full formulations, rejected alternatives, and the 34-row flip table are in `docs/models/rp-layer-config-arms.md`.

## Inertness evidence

- Golden capture commit: `fdb2eb9d` (before any `analyticPmf.ts` edit).
- `rpLayerInertness.json`'s `capturedFrom`: `380e136c61a2fdd61e321d53dfb83b8dca9b838f` (the commit immediately preceding this plan's first edit).
- `git log --oneline -- packages/core/rankingPoints/rpLayerInertness.json` shows exactly ONE commit (`fdb2eb9d`) — the golden was never regenerated anywhere in this plan.
- Deliberate-break transcript (Task 1 step 7): perturbing one `meanVector` entry by `+999` produced `AssertionError: expected [ +0, 0.05187083054433006, +0, …(2) ] to deeply equal [ 0.031440975329441075, …(4) ]`, `1 failed | 3 passed (4)`. Reverted: `4 passed (4)`.
- Exported production default, current value, quoted: `{ winSource: "score-draw", tieModel: "continuous-equality", marginal: "gaussian" }` — byte-identical to the `<baseline>` capture, and to `rpLayerInertness.json`'s own recorded `defaultConfig`.
- `grep -n "RP_LAYER_CONFIG_DEFAULT" packages/harness/sigmaScoutLayer.ts packages/harness/publish.ts`: `sigmaScoutLayer.ts`'s constructor default parameter is the only use in that file; `publish.ts` resolves `rpLayerConfig` to it (unoverridden) at both `publishSeasons` (line ~2605) and `buildSingleEventPublish`/`--event` (line ~3550). `grep -rn "new SigmaScoutLayer(" packages apps` (excluding tests) shows both non-test construction sites pass that same resolved `rpLayerConfig` — no production call site overrides the default.

## The 34 declarations

Evidence-class counts: **measured 21, derived-integer 5, structural-only 8** (total 34). No written exception — all 34 flip.

- **Derived-integer (5):** 2016 `teleopChallengePoints`/`teleopScalePoints` (feed `towerRobotCount`, 100% integer, n=22,158); 2017 `autoRotorPoints`/`teleopRotorPoints` (feed `rotorCount`, n=25,386); 2023 `linkPoints` (feeds `links`, n=27,116).
- **Measured (21):** every remaining variable in 2018, 2019, 2020, 2022, 2023's `totalChargeStationPoints`, 2024, 2025, 2026 — covered by 09-RESEARCH.md's broader corpus probe (15 threshold variables across seven-to-eight seasons, 100% integer-valued, variance/mean ratios 1.27–102.3 in AGGREGATE — this task's own honest caveat: that is an aggregate finding, not a per-variable figure recorded for each of the 21).
- **Structural-only (8):** 2016's five position-crossing counts plus `attackedTowerEndStrength`; 2017's `autoFuelPoints`/`teleopFuelPoints` — integer-valued accumulations with no per-variable measurement recorded.

`cat packages/core/rankingPoints/20*.ts | grep -v "^[[:space:]]*\*" | grep -v "^[[:space:]]*//" | grep -c 'marginalFamily: "negative-binomial"'` → `34`. `grep -c 'marginalFamily: "gaussian"'` (same filter) → `0`.

Full per-variable table is in `docs/models/rp-layer-config-arms.md`'s "The 34 declarations" section.

## Resolved-family observability

`SigmaScoutLayer.rpMarginalResolutionTally` is a public read-only accessor (`{ negativeBinomial, gaussian, degenerate, fallbacks }`), returning a fresh copy each read (mutating the read copy never mutates the layer's own state — asserted directly). It accumulates across every `#rpFieldsFor` call the layer instance makes and is IN-MEMORY ONLY — asserted against a real folded stream from the `digest-slice.json` fixture that no built `Prediction` gains a `marginalResolution`/`rpMarginalResolutionTally` key.

`analyticRpPmf`'s own result additionally carries `marginalResolution` — THIS CALL's own count, always built when the bonus path runs, independent of whether an external `tally` was also supplied (and, when one is, merged into it rather than replacing it).

Observed cold-team test counts (09-03's pinned case, alliance mean `13.586547164699777` against variance `4.5`, declared `"negative-binomial"`): `gaussian` non-zero, `fallbacks` non-zero, `negativeBinomial: 0`, and `gaussian === fallbacks` (every fallback in this case resolved to Gaussian, none to degenerate) — the mechanical proof an arm labelled negative-binomial cannot silently be mostly Gaussian.

## Open Question 3 — recorded

Under `winSource: "p-red-win"` with the LEGACY tie model, the alliance band variance feeds NOTHING in the RP layer: sweeping `red.scoreVariance`/`blue.scoreVariance` across `[1, 100, 10000]` produces bitwise-identical pmfs (proven test: `analyticPmf.test.ts`'s "Open Question 3, answered" test). Under `tieModel: "discrete-margin"` the same sweep changes the TOTAL pmf but the bonus-only half stays bitwise identical across it — the band survives only as the tie window's width.

`#rpFieldsFor`'s `redBandVariance`/`blueBandVariance` undefined-gate was NOT touched, `allianceSwingBandVariance`, `sigmaScore.ts` and `swingFactor.ts` were NOT touched. F8/F9 remain out of scope for the whole phase — this document makes no recommendation about the gate; recording the finding is the deliverable.

## Baseline vs post-plan failing test sets

| Suite | Baseline (before this plan) | After this plan |
|---|---|---|
| `packages/core/rankingPoints` | 8 files, 403 passed, 0 failing | 9 files, 458 passed, 0 failing |
| `packages/harness` | 48 files, 1193 passed, 0 failing | 49 files, 1196 passed, 2 skipped (intentional), 0 failing |
| Full suite, repo root (`npx vitest run`) | not captured pre-plan (09-04's own baseline: 253 files, 4880 passed, 1 transient-unrelated failure, 4 skipped) | **255 files, 4943 passed, 6 skipped, 0 failed** |
| `npx tsc --noEmit` (root) | clean | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | not separately captured pre-plan | clean |

Zero new failures anywhere. The `rankingPoints` file count moved 8→9 (`rpLayerInertness.test.ts`); the `harness` file count moved 48→49 (`sigmaScoutLayer.rpArms.test.ts`). The `rankingPoints` per-season `rules.test.ts` count dropped by 9 net tests (10 per-season "still gaussian" instances removed, 10 kept-but-renamed structural-union instances unchanged, 1 new cross-season pinned-list test added) — a deliberate, more-precise restructuring per the plan's own instruction to pin the exact `season:variableName` list, not a coverage loss.

## Recorded skips

- **Spec-less probe fallback**, as stated in the plan itself: no SPEC.md exists for Phase 9 and the phase has no requirement IDs to probe (Phase 9 is post-v1.0; all 38 v1 requirements map to Phases 1-8). `requirements` frontmatter therefore carries audit-finding keys (`F6`, `F7`) and CONTEXT decision IDs (`D-01`, `D-05`, `D-13`, `D-14`) instead of `REQ-*` IDs. Silent absence recorded, not a missed step.
- **Task 2 step 6's real-margin regime gate**: ATTEMPTED, then recorded skip. `packages/harness/sigmaScoutLayer.rpArms.test.ts`'s first `describe` block carries the full reasoning (`Prediction` does not expose `pTie` in isolation — tie mass convolves into the pmf across multiple indices with bonus RP; extracting it would need either a new `SigmaScoutLayer` accessor, out of Task 2's declared file scope, or a second, independently-derived `matchOutcomeDistribution` call outside the layer, exactly the "invented second replay harness" risk this plan explicitly warns is a scorer-mismatch precedent this project has already paid for once). The pinned analytic check (`tieProbability(0, 36.5 ** 2)` against F7's measured base rate) stands as the corpus-free evidence in its place. The skipped test's shape is left in place (`it.skip`, not deleted) naming what a future plan with the right accessor should restore.

This plan installed no package — `pnpm-lock.yaml` and every `package.json` dependency block are unchanged (`git diff --stat` over the whole plan's commits confirms this); the Package Legitimacy Gate does not apply.

## TDD Gate Compliance

Tasks 2 and 3 carry `tdd="true"`. The RED phase was not run strictly first for every assertion in this plan's execution: `tieProbability` (Task 2) and `resolveDeclaredFamily`/`MarginalResolutionTally` (Task 3) were implemented, then their pinned test values were independently verified against a hand-derived/cross-checked reference (a separate Python `math.erf` script for `tieProbability`'s two off-centre values; direct hand-computation for the tally/fallback-ladder cases, reusing 09-03's own pinned cold-team figures) BEFORE being written into the test file — so the values in the tests were never produced by running the implementation and copying its output (D-07's discipline is intact), but the file-level RED→GREEN commit ordering the `tdd="true"` frontmatter calls for was not followed literally in this session. Recorded here per the global TDD-gate-enforcement instruction rather than silently omitted.

## Decisions Made

See `key-decisions` in the frontmatter above for the four load-bearing calls made during execution (the `pRedWin`-required fallout, the non-finite-vs-out-of-range clamp split, the regime-gate recorded skip, and the `tieProbability` finding).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `AnalyticRpPmfInput.pRedWin` becoming REQUIRED broke every other pre-existing call site of `analyticRpPmf`**
- **Found during:** Task 1, immediately after adding the required field
- **Issue:** The plan pins `pRedWin` as required (not optional) so no call site can silently omit it. Beyond this task's declared seven files, `publish.ts`'s `makeRankingPointFiller` (09-04's OTHER RP write path), `apps/worker/src/bundleSmoke.ts`, and four pre-existing test files (`sigma1.test.ts`, `rankSimulation.test.ts`, `analyticPmf.universal.test.ts`, `analyticPmf.seasons.test.ts`, `empiricalMoments.test.ts`) all called `analyticRpPmf`/built `AnalyticRpPmfInput`-shaped objects without it, which would fail `tsc --noEmit` once the field became required.
- **Fix:** Threaded `pRedWin` through every one of those call sites — real values where a `Prediction`/algorithm output was in scope (`publish.ts`, `bundleSmoke.ts`, `sigma1.test.ts`), a neutral `0.5` at test call sites that do not exercise the p-red-win arm.
- **Files modified:** `packages/harness/publish.ts`, `apps/worker/src/bundleSmoke.ts`, `packages/core/algorithms/sigma1/sigma1.test.ts`, `packages/core/algorithms/simulation/rankSimulation.test.ts`, `packages/core/rankingPoints/analyticPmf.universal.test.ts`, `packages/core/rankingPoints/analyticPmf.seasons.test.ts`, `packages/core/rankingPoints/empiricalMoments.test.ts`
- **Verification:** `npx tsc --noEmit` clean; full RP + harness suites green with zero new failures.
- **Committed in:** `17331ece` (Task 1 commit)

**2. [Rule 1 - Bug] `splitOutcomeProbabilities`'s first draft silently laundered a non-finite `pRedWin` into a neutral `0.5`, breaking an EXISTING 09-04 test**
- **Found during:** Task 1, first full run of `analyticPmf.test.ts` after wiring `splitOutcomeProbabilities` into `matchOutcomeDistribution`
- **Issue:** Test 8 (09-04's own, "a non-finite score mean throws rather than emitting NaN") started FAILING: `expected [Function] to throw an error`. The clamp-to-0.5-for-NaN design meant a corrupted score mean under the legacy `winSource` (which computes `pRedWinEffective` via the Gaussian expression, itself capable of going NaN) produced a plausible-looking `0.5`/`0.5` split instead of propagating `NaN` into `assertNormalizedPmf`'s existing finite guard.
- **Fix:** Redesigned the clamp: a finite-but-out-of-range `pRedWin` is still clamped into `[0, 1]` (the threat T-09-05-03 actually names — negative or greater-than-one mass silently propagating); a non-finite `pRedWin` is left UNCLAMPED and propagates as `NaN`, still flagged via `clampedPRedWin: true`, so the existing downstream finite check keeps working.
- **Files modified:** `packages/core/rankingPoints/analyticPmf.ts`, `packages/core/rankingPoints/analyticPmf.test.ts` (updated the `clampedPRedWin` test's expectation to match the corrected design)
- **Verification:** `29/29` passed after the fix (both files together).
- **Committed in:** `17331ece` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **Impact on plan:** both were direct, necessary consequences of the plan's own pinned design decisions (the required `pRedWin` field; the clamp-and-count discipline for `splitOutcomeProbabilities`) surfacing in places the plan's own file list did not anticipate. No scope creep — each fix is scoped exactly to the regression or compile break it addresses.

## Issues Encountered

A second Claude session was actively committing to the SAME checkout throughout this plan's execution (EPA week-1 calibration work, commits `3f36e582`/`6b1e7db4`, and later a Statbotics foul-model planning commit, `64765e94`) — handled per this project's established discipline: every commit in this plan stages by explicit path (`git add -- <files>`, never `git add -A`), and `git show --stat` was used to confirm none of this plan's six commits touched any file outside its own declared scope. No interference beyond the file-count/timestamp noise visible in intermediate `git status` output.

## User Setup Required

None — no external service configuration required. This plan installed no package (`pnpm-lock.yaml` unchanged, no `package.json` dependency block touched); the Package Legitimacy Gate does not apply.

## Next Phase Readiness

- **09-06** can measure all three arms against 09-01's frozen `data/baselines/rp-calibration-2026-09.json` through the one published scorer (`scripts/measureRpCalibration.ts`, D-11), take the per-bonus accept/revert call (D-09/D-10) at its one-way checkpoint (D-04), and collapse `RpLayerConfig` to one hardcoded path (D-06) — `docs/models/rp-layer-config-arms.md` is the one document it needs to read first, and `SigmaScoutLayer.rpMarginalResolutionTally` is ready to report what share of the negative-binomial arm actually resolved to negative binomial.
- **09-07** consumes `redBonusPmf`/`blueBonusPmf`/`outcome` unchanged (09-04's exported halves; this plan extended what feeds them, not their shape) for its rank-simulation coupling fix.
- Nothing published was changed by this plan — no publish command run, no R2 write, no D1 access; confirmed entirely offline pipeline/library code, and `rpLayerInertness.test.ts` is the mechanical proof the production default never moved.

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*

## Self-Check: PASSED

- `scripts/rpLayerInertnessGolden.ts` — FOUND
- `packages/core/rankingPoints/rpLayerInertness.json` — FOUND
- `packages/core/rankingPoints/rpLayerInertness.test.ts` — FOUND
- `packages/harness/sigmaScoutLayer.rpArms.test.ts` — FOUND
- `docs/models/rp-layer-config-arms.md` — FOUND
- Commit `fdb2eb9d` — FOUND in `git log --oneline --all`
- Commit `17331ece` — FOUND in `git log --oneline --all`
- Commit `bca53552` — FOUND in `git log --oneline --all`
- Commit `f9e885e3` — FOUND in `git log --oneline --all`
- Commit `ce0c023a` — FOUND in `git log --oneline --all`
- Commit `d7a06cd1` — FOUND in `git log --oneline --all`
