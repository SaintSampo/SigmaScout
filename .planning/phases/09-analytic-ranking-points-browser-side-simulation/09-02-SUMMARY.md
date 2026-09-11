---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 02
subsystem: api
tags: [ranking-points, declarative-rules, vitest, typescript, golden-testing]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-01's frozen data/baselines/rp-calibration-2026-09.json (D-09 'before' baseline) and data/baselines/level1-digest-2026-09.json (D-12 corpus-free gate) — this plan reads neither but must not perturb the numbers either baseline was measured from"
provides:
  - "packages/core/rankingPoints/constants.ts's BonusPredicate contract: MarginalFamily, RpLinearTerm, RpThresholdClause, RpPredicateThreshold, RpUntrackedGate, the seven-member BonusPredicate discriminated union, resolveRpThreshold, evaluateBonusPredicates"
  - "All ten season modules (2016.ts...2026.ts) declaring BONUS_PREDICATES, deriving BONUS_NAMES from it, and delegating predictThresholds to evaluateBonusPredicates"
  - "packages/core/rankingPoints/predictThresholdsGolden.json + predictThresholdsGolden.test.ts — the committed pre-rewrite behavior oracle and its corpus-free replay test"
  - "scripts/rpPredictThresholdsGolden.ts — the deterministic grid generator (pnpm rp:golden)"
  - "rules.test.ts's nine new structural assertions guarding the contract's invariants"
affects: [09-03, 09-04, 09-05, 09-06]

# Actuals (#2632)
actuals:
  tokens: 23980
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "BonusPredicate discriminated union (seven kinds) + one shared evaluateBonusPredicates — 'season rules are data entry, not branches' extended from threshold VALUES to threshold LOGIC"
    - "Golden-oracle characterization testing: a deterministic value grid, hashed to a committed digest, replayed against live code, with a recorded deliberate-perturbation proof that the oracle is not vacuous"
    - "RpUntrackedGate as pure declaration metadata the evaluator is structurally forbidden to read — the conservative/proxy choice lives in which threshold table a predicate names, never in a runtime branch"

key-files:
  created:
    - scripts/rpPredictThresholdsGolden.ts
    - packages/core/rankingPoints/predictThresholdsGolden.json
    - packages/core/rankingPoints/predictThresholdsGolden.test.ts
  modified:
    - packages/core/rankingPoints/constants.ts
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
    - packages/core/rankingPoints/rules.ts
    - packages/core/rankingPoints/rules.test.ts
    - packages/core/algorithms/sigma1/rp/distribution.test.ts
    - package.json

key-decisions:
  - "Ran the reformat pass across all ten season files (including 2026.ts, committed in Task 1) to put marginalFamily on its own line in every THRESHOLD_VARIABLES entry — a pure formatting change, zero behavior difference, needed so the tree-wide 'one distinct declaration line shape' structural check (Task 2's own acceptance criterion 6) reads cleanly rather than seeing 34 unique lines that differ only by variable name"
  - "2019 completeRocket's constant predicate carries its conservative justification in the reason field, with NO untrackedGate object — there is no alliance-level signal to name (the bonus has no threshold-variable-only fallback at all), so the gate type would have nothing real to describe. Recorded per Task 2's acceptance criterion 8's own anticipated branch: five real RpUntrackedGate objects (2018, 2023, 2024, 2025-coralBonus) plus one documented constant (2019), not six gates"
  - "distribution.test.ts's synthetic singleBonusModule now delegates predictThresholds through evaluateBonusPredicates(singleBonusPredicates, ...) rather than keeping its own hand-rolled arrow body — proves the one external RpRuleModule construction site is genuinely exercising the shared evaluator, not just satisfying the type"

patterns-established:
  - "BonusPredicate discriminated union + evaluateBonusPredicates: season rules are declared threshold LOGIC, not just declared threshold VALUES"
  - "Golden-oracle testing with a recorded non-vacuity proof (a deliberate perturbation shown to fail, then reverted) as the standard bar for a characterization test in this codebase"

requirements-completed: [D-02, D-07, F2, F6, F7]

coverage:
  - id: D1
    description: "predictThresholds keeps its exact pre-rewrite signature and return shape in all ten season modules, and the pre-rewrite golden oracle (30 digests, 63 fire counts) replays byte-identical against the rewritten evaluator throughout every step of the conversion"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/predictThresholdsGolden.test.ts (94 assertions, run after every one of the ten conversions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pre-rewrite golden oracle is proven non-vacuous by a recorded deliberate perturbation (2026.ts TRAVERSAL_THRESHOLD.base 50->51) that made it fail naming season 2026, then reverted clean"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/predictThresholdsGolden.test.ts — perturbation run quoted below in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D3
    description: "All 21 bonuses across all seven mechanism classes (8 singleThreshold, 3 linearCombination, 4 conjunctionDistinct, 2 nestedSameVariable, 2 countOfIndicators, 1 dataDependentMixture, 1 constant) are declared as BonusPredicate data, with bonusNames derived from the predicate array and pinned per season in order"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/rules.test.ts — derived-bonusNames case, ten per-season order pins, 21-bonus total case"
        status: pass
    human_judgment: false
  - id: D4
    description: "The corpus-backed conservative-branch understatement table (pnpm rp:conservative-branch) is byte-identical before and after the whole rewrite, including 2018 autoQuest's documented over-firing exception"
    verification:
      - kind: other
        ref: "diff reports/rpConservativeBranch.before.txt reports/rpConservativeBranch.after.txt (quoted below, empty)"
        status: pass
    human_judgment: false
  - id: D5
    description: "bonusPredicates (RpRuleModule) and marginalFamily (RpThresholdVariable) are both required fields, proven real by a working-tree probe"
    verification:
      - kind: unit
        ref: "pnpm typecheck failure/recovery quoted below in this SUMMARY (2020.ts probe)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 2: Declarative RP BonusPredicate Contract Summary

**Rewrote all 21 FRC ranking-point bonus rules across ten seasons (2016-2026) from hand-written comparison code into a seven-mechanism `BonusPredicate` declarative contract, proven byte-identical to the pre-rewrite code by a committed golden oracle and a corpus-backed measurement — nothing published, no number changed.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-11T13:00Z
- **Completed:** 2026-09-11T13:23Z
- **Tasks:** 3
- **Files modified:** 15 (3 created, 12 modified, across 4 task commits)

## Accomplishments

- **Landed the seven-member `BonusPredicate` contract in `constants.ts`** (D-02, D-07): `MarginalFamily`, `RpLinearTerm` (a divisor, never a coefficient), `RpThresholdClause`, `RpPredicateThreshold`, `RpUntrackedGate` (pure metadata the evaluator is structurally forbidden to read), the discriminated union itself, `resolveRpThreshold`, and the shared `evaluateBonusPredicates`. Zero new runtime imports — the leaf stays the dependency-free module it already was (D-08).
- **Converted all ten season modules end to end**, in the plan's mandated order (2026 as the tracer, then 2018 for the over-firing exception, then 2016 for its three-mechanism density, then the remaining seven), running the golden test after every single conversion rather than batching. All 21 bonuses now declared as data: 8 `singleThreshold`, 3 `linearCombination`, 4 `conjunctionDistinct`, 2 `nestedSameVariable`, 2 `countOfIndicators`, 1 `dataDependentMixture`, 1 `constant`.
- **Captured a pre-rewrite golden oracle BEFORE touching any module**: `scripts/rpPredictThresholdsGolden.ts` builds a deterministic value grid (boundary sweeps per threshold variable plus 3,000 `mulberry32`-seeded random rows per season-tier) and evaluates it through each season's live `predictThresholds`. The resulting `predictThresholdsGolden.json` (30 digests, 63 fire counts) stayed byte-identical through every one of the ten conversions.
- **Proved the oracle is not vacuous by hand**: temporarily broke `2026.ts`'s `TRAVERSAL_THRESHOLD.base` (50->51), watched the test fail naming season 2026, reverted, watched it go green again — quoted in full below.
- **Preserved all six conservative-branch/proxy bonuses exactly**, including 2018 `autoQuest`'s one documented exception (the fallback OVER-fires, not under-fires). Proved unchanged with a byte-identical `pnpm rp:conservative-branch` stdout diff before and after the whole rewrite.
- **Tightened the contract to required** (Task 3): `bonusPredicates` and `marginalFamily` moved from optional (needed for Task 1's mid-migration typechecking) to required, verified real with a working-tree probe rather than assumed from a clean compile.
- **Added nine structural assertions to `rules.test.ts`**: derived-not-duplicated `bonusNames`, ten explicit per-season order pins, the 21-bonus total, the `marginalFamily` domain plus its temporary all-Gaussian state, declared-variable reachability, `nestedSameVariable` group ordering at every tier (D-07's named trap), the `countOfIndicators` required-count bound, bonus-name uniqueness, and the unmapped-event-type throw.

## Task Commits

Each task was committed atomically:

1. **Task 1: TRACER — capture the pre-rewrite oracle, land the contract, convert 2026.ts** — `41821364` (test) + `1b9acc65` (feat)
2. **Task 2: Convert the remaining nine season modules** — `1794c3ea` (feat)
3. **Task 3: Close the contract — tighten to required, add structural assertions** — `3e7254b2` (test)

**Plan metadata:** (this SUMMARY's own commit)

## Files Created/Modified

- `scripts/rpPredictThresholdsGolden.ts` — deterministic grid generator: `VALUE_LADDER`, `buildGridRows`, `digestRows`, `GRID_VERSION`, entry-point-guarded `main()`
- `packages/core/rankingPoints/predictThresholdsGolden.json` — the committed pre-rewrite oracle (30 digests, 63 fire counts)
- `packages/core/rankingPoints/predictThresholdsGolden.test.ts` — corpus-free replay test (94 assertions)
- `packages/core/rankingPoints/constants.ts` — `MarginalFamily`, `RpLinearTerm`, `RpThresholdClause`, `RpPredicateThreshold`, `RpUntrackedGate`, `BonusPredicate`, `resolveRpThreshold`, `evaluateBonusPredicates`, `bonusPredicates`/`marginalFamily` fields (required)
- `packages/core/rankingPoints/{2016,2017,2018,2019,2020,2022,2023,2024,2025,2026}.ts` — each declares `BONUS_PREDICATES`, derives `BONUS_NAMES`, delegates `predictThresholds`
- `packages/core/rankingPoints/2023.ts` — introduced `LINK_POINTS_PER_LINK = 5` (the plan's one permitted non-declaration edit), used in both `parse` and the declaration
- `packages/core/rankingPoints/rules.ts` — re-exports the new contract symbols
- `packages/core/rankingPoints/rules.test.ts` — nine new structural assertion blocks
- `packages/core/algorithms/sigma1/rp/distribution.test.ts` — the one external `RpRuleModule` construction site, updated to declare a one-element predicate array and delegate through `evaluateBonusPredicates`
- `package.json` — one new script, `rp:golden`; no dependency added or removed

## Required Evidence (per this plan's `<output>` contract)

### Non-vacuity proof — the perturbation and its revert

With `predictThresholdsGolden.test.ts` green (94/94), `2026.ts`'s `TRAVERSAL_THRESHOLD.base` was changed from `50` to `51`:

```
FAIL  |node| packages/core/rankingPoints/predictThresholdsGolden.test.ts > predictThresholdsGolden — season 2026 > event type 0 > digest matches the committed pre-rewrite oracle
AssertionError: expected '8dec241f4e5eecfa16bba16dbd21c042e9d67…' to be '2da00302fd60c58b9694094d64ed33fee8c6e…'

FAIL  |node| packages/core/rankingPoints/predictThresholdsGolden.test.ts > predictThresholdsGolden — season 2026 > event type 0 > fire count for bonus traversal matches the committed pre-rewrite oracle
AssertionError: expected 1160 to be 1220

Test Files  1 failed (1)
     Tests  2 failed | 92 passed (94)
```

After reverting `TRAVERSAL_THRESHOLD.base` back to `50`:

```
Test Files  1 passed (1)
     Tests  94 passed (94)
```

`git diff --stat packages/core/rankingPoints/2026.ts` confirmed a clean revert with no residual change.

### Corpus proof — the conservative-branch diff

```
$ diff reports/rpConservativeBranch.before.txt reports/rpConservativeBranch.after.txt
$ echo $?
0
```

No output — byte-identical. The 2018 `autoQuest` row and the script's own verdict line, unchanged before and after:

```
2018 | autoQuest | 0.0000% | 0.2225% | -0.002225 | 28312
...
OVERSTATED FOUND: the "conservative, never overstates" claim is FALSE for: 2018 autoQuest (0.2225%)
```

### Required-field tightening probe

`bonusPredicates: BONUS_PREDICATES,` was temporarily deleted from `2020.ts`:

```
$ pnpm typecheck
packages/core/rankingPoints/2020.ts(111,14): error TS2741: Property 'bonusPredicates' is missing in
  type '{ season: number; thresholdVariables: readonly RpThresholdVariable[]; ... }' but required in
  type 'RpRuleModule'.
[ELIFECYCLE] Command failed with exit code 2.
```

Restored, confirmed clean:

```
$ pnpm typecheck
$ (no errors)
```

`git status --short -- packages/core/rankingPoints/2020.ts` showed no residue.

### Full-suite and per-kind counts

- `npx vitest run` from the repo root: **249 files, 4814 passed, 4 skipped** (pre-existing skips, unrelated to this plan) — well above the 167+ floor.
- `grep -n 'kind: "' packages/core/rankingPoints/20*.ts | grep -o 'kind: "[a-zA-Z]*"' | sort | uniq -c`: 8 singleThreshold, 3 linearCombination, 4 conjunctionDistinct, 2 nestedSameVariable, 2 countOfIndicators, 1 dataDependentMixture, 1 constant.
- `grep -c "marginalFamily" ...` across the ten files sums to **34**, matching the 34 threshold-variable declarations; after a formatting pass (see Decisions), `grep -h "marginalFamily:" ... | sort -u | wc -l` is **1** — one distinct declaration line shape, all Gaussian.

## Decisions Made

- **Formatting pass across all ten files** (including 2026.ts, committed in Task 1) to put `marginalFamily` on its own line — see `key-decisions` in frontmatter. Pure formatting, zero behavior change, confirmed by the golden test staying green and the golden JSON staying byte-identical throughout.
- **2019 `completeRocket` carries no `untrackedGate`** — its `constant` predicate's `reason` field is where the conservative justification lives, since there is no alliance-level signal to name (no threshold-variable-only fallback exists at all). This is the branch Task 2's own acceptance criterion 8 explicitly anticipated and required the SUMMARY to record.
- **`distribution.test.ts`'s synthetic module delegates through `evaluateBonusPredicates`** rather than keeping a hand-rolled arrow, so the one external construction site genuinely exercises the shared evaluator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/consistency] Reformatted `marginalFamily` onto its own line in every `THRESHOLD_VARIABLES` entry, across all ten season files**
- **Found during:** Task 2, while verifying acceptance criterion 6 (`grep -h "marginalFamily:" ... | sort -u | wc -l` should be `1`)
- **Issue:** The single-line object-literal style (`{ name: "X", unit: "Y", marginalFamily: "gaussian" },`) meant every declaration line differed by the variable name, so the "one distinct declaration line shape" check reported 33 unique lines instead of 1 — a real, if narrow, mismatch with the plan's own stated acceptance bar.
- **Fix:** Reformatted every `THRESHOLD_VARIABLES` entry to a multi-line object literal with `marginalFamily: "gaussian",` on its own line, via a small one-off Node script applied to all ten files (2019.ts and 2020.ts's single-entry arrays needed a manual follow-up since their original one-line-array form didn't match the reformat script's line-based pattern). Zero behavior change — confirmed by the golden test and golden JSON staying identical before and after.
- **Files modified:** all ten season modules (`2016.ts`...`2026.ts`)
- **Verification:** `npx vitest run packages/core/rankingPoints` (246/246 before, 337/337 after Task 3's added assertions) plus the grep re-check reporting `1`.
- **Committed in:** `1794c3ea` (Task 2 commit; 2026.ts's share of the reformat rode along in the same commit since it's a pure formatting fix to Task 1's already-committed file, not new scope)

---

**Total deviations:** 1 auto-fixed (1 bug/consistency)
**Impact on plan:** Necessary to satisfy the plan's own stated acceptance criterion; no behavior change, no scope creep.

## Findings for 09-06 (per this plan's explicit routing instruction — not edited here)

Two historical figures were encountered during Task 2's transcription and are recorded here, not corrected, per the plan's explicit "declare, don't fix, and don't rename a stale test title" instruction:

1. **2025 `autoBonus`'s historical 0.625464 understatement figure is now superseded.** `constants.ts`'s `predictThresholds` doc comment (unedited by this plan) still cites `0.625464` as `autoBonus`'s measured mean RP understatement — that figure predates the 2026-09-09 fix that added `autoLineCount`/`autoCoralCount` tracking. The corpus proof run this plan performed (`pnpm rp:conservative-branch`, both before and after) now measures `autoBonus` at `0.0000%` understatedRate / `0.0000%` overstatedRate — fully tracked, no gate needed. 09-06 owns updating the published figure.
2. **`rules.test.ts`'s case titled "2025: autoBonus is always false" is a stale title that still passes for an unrelated reason.** The case (line 269, unmodified by this plan) supplies neither `autoLineCount` nor `autoCoralCount`, so both default to `0` via the `?? 0` convention and `autoBonus` evaluates `false` — but the general claim in the title ("always false", i.e. the bonus has no fallback at all) has not been true since 2026-09-09. Per the plan's explicit instruction, the title was NOT renamed and the test was NOT touched — a stale title is a documentation defect, and changing behavior (or the test) to match it would be exactly backwards.

## Issues Encountered

None beyond the formatting deviation documented above.

## User Setup Required

None — no external service configuration required. This plan installs nothing (`git diff package.json` shows exactly one added line, the `rp:golden` script; no `dependencies`/`devDependencies` change), so the Package Legitimacy Gate does not apply.

## Next Phase Readiness

- **09-03** can now dispatch on `MarginalFamily` and the `marginalFamily` field by name — every declaration currently names the Gaussian value, and `rules.test.ts`'s new "explicitly temporary" case names 09-05 as the plan that flips it and 09-03's warm-roster re-measurement as the gate.
- **09-04** can group bonuses by `BonusPredicate.kind`, with `nestedSameVariable` structurally distinguishable from `conjunctionDistinct` — 2026's `energized`/`supercharged` pair is declared with `nestedWith` naming each other, and `rules.test.ts`'s new ordering assertion proves `SUPERCHARGED_THRESHOLD[tier] >= ENERGIZED_THRESHOLD[tier]` holds at every tier, including the tier where they're exactly equal.
- **09-05** has its landing point for the marginal-family flip already declared and typed; nothing in this plan reads the field for anything beyond the temporary all-Gaussian structural assertion.
- **09-06** has the two historical findings above, plus the unchanged `RpUntrackedGate` metadata on every gated bonus, ready for its per-bonus attribution reporting.
- Nothing published, no R2 object touched, no dependency added, `docs/` untouched (`git diff --stat docs/` empty) — confirmed by `git log` showing no commit in this plan touching `packages/harness/publish.ts`, `packages/harness/pageArtifacts.ts`, or anything under `apps/`.

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*

## Self-Check: PASSED
