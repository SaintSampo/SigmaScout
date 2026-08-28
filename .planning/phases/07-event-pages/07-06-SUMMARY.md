---
phase: 07-event-pages
plan: 06
subsystem: algorithms
tags: [sigma1, kalman, variance, uncertainty, zod, schema-doc]

# Dependency graph
requires:
  - phase: 06
    provides: TeamMetric.spread and Prediction.redScoreVarianceOwn/blueScoreVarianceOwn already shipped on the team artifact
  - phase: 07-01
  - phase: 07-02
provides:
  - "TeamMetric.spread (per-component, per-phase-group, TOTAL) redefined from √R (consistency alone) to √(P + R) — one standard deviation of full predictive variance, at every aggregation level"
  - "The alliance-additivity identity: three teams' TOTAL spread squares sum in quadrature to predict()'s own redScoreVarianceOwn/blueScoreVarianceOwn, proven by test against predict()'s own output"
  - "Every binding document in the repo (code doc comments, published-schema doc comments, the sketch-findings skill) rewritten to the single-quantity uncertainty rule"
affects: [07-10, 07-11, 07-12, 07-13, 07-14, 07-17, 07-19]

# Actuals (#2632)
actuals:
  tokens: 12700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seeded/threaded accumulator pattern for extracting a shared per-team summation helper without changing a hot floating-point-sensitive path's addition order (IEEE-754 non-associativity vs. bit-identical reproducibility gates)"

key-files:
  created: []
  modified:
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/core/algorithms/sigma1/consistency.ts
    - packages/core/algorithms/sigma1/adaptation.ts
    - packages/core/algorithms/sigma1/rp/state.ts
    - packages/core/algorithms/types.ts
    - packages/harness/pageArtifacts.ts
    - .claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md
    - .claude/skills/sketch-findings-sigmascout/SKILL.md

key-decisions:
  - "A literal 'sum each team's subtotal in isolation, then add the subtotals' refactor of allianceComponentVarianceSum (as the plan's action text described it) flips both committed sigma1@2.0.0 digests via IEEE-754 re-association, even though it is mathematically equivalent — fixed by threading a running-total seed through the shared teamOwnComponentVarianceSum helper so predict()'s addition order stays byte-identical, while teamMetrics' new call site (seed-less) still shares the one implementation"
  - "Two additional stale two-quantity-model doc sites (adaptation.ts x2, rp/state.ts x1) found live by Task 2's own sweep-gate grep, outside PD-02's enumerated 12 sites and outside this plan's declared files_modified — corrected under Rule 2, since leaving them would fail the plan's own mechanically-checked acceptance criterion"
  - "Task 2's literal acceptance-criteria text ('case count 3 higher than after Task 1') does not match its own <behavior> section (Test 5, Test 6 are real; Test 7 is explicitly 'do not edit, no new test' — the same pattern Task 1's Test 4 established). Reported the real count (+2, not +3) rather than padding with a vacuous test, matching Task 1's own precedent for exactly this ambiguity"
  - "EVNT-02/EVNT-05 NOT marked complete in REQUIREMENTS.md (still Pending) — this plan changes the quantity those tabs will display but does not own the tabs themselves (07-11/07-14 do), matching the 07-02 precedent for partial-requirement plans. EVNT-03 was already Complete (07-01) and is untouched"

patterns-established:
  - "When a plan's action text implies a refactor shape that turns out to break a bit-identical reproducibility gate, prefer restructuring the SAME shared function (e.g. via a threaded accumulator) over duplicating logic or reverting the extraction outright — preserves both the single-source-of-truth intent and the hard invariant"

requirements-completed: []

coverage:
  - id: D1
    description: "TeamMetric.spread (TOTAL) is redefined from √R to √(P+R), proven by the alliance-additivity identity against predict()'s own redScoreVarianceOwn/blueScoreVarianceOwn on both alliances"
    requirement: "EVNT-05"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#Test 1 (the tracer's proof)"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#Test 2 (non-vacuity of Test 1)"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#Test 3 (the floor errs wide, never narrow)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every published metric key (per-component, phase-group) also carries √(P+R), and a phase group's P and R sums cover the same present-only component set"
    requirement: "EVNT-02"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#Test 5 — every published metric key's spread strictly exceeds the square root of that key's R term alone"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#Test 6 — a phase group's P and R sums cover the SAME present-only component set (PD-07)"
        status: pass
    human_judgment: false
  - id: D3
    description: "predict()'s pRedWin/redScore/blueScore path is provably unaffected — both committed sigma1@2.0.0 digests reproduce bitwise"
    verification:
      - kind: unit
        ref: "packages/harness/digest.test.ts — 3 tests, 0 skipped"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every remaining binding document (code doc comments, published-schema doc comments, sketch-findings skill) rewritten to the single-quantity rule, no schema shape or client code touched"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts and packages/harness/browserSafeSchemas.test.ts — 59 tests, 0 skipped"
        status: pass
      - kind: other
        ref: "grep -rniE \"two meanings|consistency spread|stay separate|team-page spread|team-page \\`±\\`|Never displayed\" across packages/core/algorithms/sigma1/, types.ts, pageArtifacts.ts, .claude/skills/sketch-findings-sigmascout/ — 0 matches"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 06: Site-wide ± redefinition (D-01/D-02/D-03) Summary

**`TeamMetric.spread` redefined at its Sigma1 assembly site from `√R` (consistency alone) to `√(P + R)` — the same construction `redScoreVarianceOwn` already uses — proven by an alliance-additivity identity test against `predict()`'s own output, with R still computed internally but never published, and every binding document in the repo swept to match.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-27T22:01:17-04:00 (Task 1 commit)
- **Completed:** 2026-08-27T22:11:34-04:00 (Task 3 commit)
- **Tasks:** 3
- **Files modified:** 9

## Baseline

`pnpm test` before Task 1: **1 failing assertion** (`packages/harness/payloadBudget.test.ts`'s
`teams/{year}` internal-consistency check — the accepted, signed `WINDOWS.md` ledger #11 override,
explicitly out of scope), 107 test files passed / 1 failed (108 total), 1497 tests passed / 1 failed
(1498 total).

`pnpm test` after Task 3: **the same single failing assertion**, 107 passed / 1 failed (108 total),
1502 tests passed / 1 failed (1503 total) — exactly 5 new tests (Task 1's 3 + Task 2's 2), zero new
failures.

**Pre-fix RED evidence for Task 1's Test 1** (quoted, not claimed — observed by running the new tests
against the pre-`index.ts`-change tree):

```
AssertionError: expected 294.02103409588904 to be less than 1e-9
 ❯ packages/core/algorithms/sigma1/sigma1.test.ts:533:73
    531|     );
    532|
    533|     expect(Math.abs(redSumOfSquares - prediction.redScoreVarianceOwn!)…
       |                                                                         ^
    534|     expect(Math.abs(blueSumOfSquares - prediction.blueScoreVarianceOwn…
    535|   });
```

Test 3 (floor-errs-wide) also failed RED, as expected under the pre-fix formula:
`AssertionError: expected 1 to be greater than 1` (a cold-start team's TOTAL spread was exactly
`√(floor)` before the fix, not strictly greater than it).

**Measured widening for `frc254`** (the plan's own concrete numeric check, `<baseline>`):

| Metric | Pre-change (√R only) | Post-change (√(P+R)) |
|---|---|---|
| `frc254` TOTAL spread | 2.135515773416705 | 11.996294658961157 |
| `frc254` `autoLeave` spread | 1.8162565555088115 | 3.744071213847321 |

Both widen, as required by `must_haves.truths`' never-narrows claim — never narrow.

## Accomplishments

- Task 1 (tracer): the TOTAL metric's spread became `√(P + R)`, pinned by the alliance-additivity
  identity against `predict()`'s own `redScoreVarianceOwn`/`blueScoreVarianceOwn`, on both alliances,
  with the floor proven not to be doing the work.
- Task 2: expanded the redefinition to the per-component and phase-group metric sites, and corrected
  every code doc comment describing the superseded two-quantity model — including recording (not
  erasing) the D-05 adaptation-invariant reversal.
- Task 3: swept every remaining binding document — `pageArtifacts.ts`'s file-header rule and two field
  doc comments, and both sketch-findings-sigmascout skill files — to the single-quantity rule, with
  zero schema-shape change and zero `apps/web`/`docs/` diff.

## Task Commits

1. **Task 1: TRACER — the TOTAL metric's ± becomes √(P+R)** - `8f8cf1c9` (feat)
2. **Task 2: Expand the redefinition to per-component and phase-group metrics, correct doc comments** - `2d0d4a32` (feat)
3. **Task 3: Sweep every remaining binding document** - `e67c0b0d` (docs)

## Files Created/Modified

- `packages/core/algorithms/sigma1/index.ts` - `teamOwnComponentVarianceSum` extracted (seeded
  accumulator, PD-06); all three `spread:` assembly sites now `√(P + R)`; `teamMetrics`' doc comment
  and file header corrected
- `packages/core/algorithms/sigma1/sigma1.test.ts` - 5 new tests (Tests 1, 2, 3, 5, 6) proving the
  identity, non-vacuity, floor direction, per-key coverage, and phase-group present-only-component
  discipline
- `packages/core/algorithms/sigma1/consistency.ts` - module header, three-quantity map, and
  `shrinkConsistency`'s closing sentence corrected to describe R as one of two terms
- `packages/core/algorithms/sigma1/adaptation.ts` - two doc-comment sites (found by Task 2's own
  sweep-gate grep, outside PD-02's enumerated 12) corrected
- `packages/core/algorithms/sigma1/rp/state.ts` - one doc-comment site (same discovery) corrected
- `packages/core/algorithms/types.ts` - `TeamMetric` and `Prediction.redScoreVarianceOwn` doc comments
  corrected; the unrelated `redBonusRp`/`redRpPmf` "never conflate" claim left untouched
- `packages/harness/pageArtifacts.ts` - file-header rule bullet, `TeamMetricSchema` doc,
  `redScoreVarianceOwn` doc corrected; zero schema shape change
- `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` - opening section
  rewritten as a stated supersession, sketch-003 finding kept and reframed; Data-dependency section
  corrected (team artifact already carries this since Phase 6, event artifact via 07-07/07-08)
- `.claude/skills/sketch-findings-sigmascout/SKILL.md` - `design_direction` paragraph, Design Areas
  table row, Blocked-on-data item 2 corrected

## Decisions Made

- **Threaded-seed accumulator, not a naive per-team-subtotal refactor.** The plan's action text
  described extracting `teamOwnComponentVarianceSum` and having `allianceComponentVarianceSum`
  "resolve each team's state and delegate to it." Implemented literally first — sum each team's
  subtotal via the new function, then add those subtotals — and it flipped BOTH committed
  `sigma1@2.0.0` digests (`digest.test.ts` went red), because IEEE-754 addition is not associative:
  `(prev + b1) + b2 + b3` and `prev + ((0 + b1) + b2 + b3)` can differ in the last bit even though
  they are mathematically identical. Fixed by giving `teamOwnComponentVarianceSum` an optional `seed`
  parameter (default `0`) and having `allianceComponentVarianceSum` thread its own running total
  through as that seed — this reduces to the EXACT SAME left-to-right chain of additions the original
  single flat loop performed, so `predict()` is bit-for-bit unaffected, while `teamMetrics`' new
  call site (at the default seed) still shares the one implementation. Verified: `digest.test.ts`
  passes (3/3, 0 skipped, both committed digests reproduced bitwise) with this shape, and failed with
  the naive shape.
- **Two extra doc sites fixed beyond PD-02's enumerated 12, outside this plan's declared
  `files_modified`.** Task 2's own acceptance-criteria grep (`team-page spread|team-page \`±\`|Never
  displayed`, swept over the whole `packages/core/algorithms/sigma1/` directory) matched two sites
  PD-02's table did not name: `adaptation.ts` (two doc comments referencing "the team-page spread" in
  the context of its own EWMA-alpha and min-observations reasoning) and `rp/state.ts` (one doc comment
  asserting "the published team-page `±`... numerically untouched by everything in this file"). Left
  unedited, the plan's own mechanically-checked Task 2 acceptance criterion would fail. Corrected both
  minimally — R is now named as one of two terms rather than the whole displayed value — under Rule 2
  (missing critical doc-sweep completeness), matching PD-02's own stated reasoning almost verbatim
  ("enumerating only what D-03 listed and calling the sweep done is the exact failure this plan exists
  to prevent").
- **Task 2's literal "3 higher" test-count criterion not met by design, matching Task 1's own
  precedent.** Task 2's `<behavior>` section defines Test 5, Test 6, and Test 7 — but Test 7 is
  explicitly "the existing... describe block... must still pass unmodified. Do not edit them," the
  identical pattern Task 1's own Test 4 established (no new test body, just a marker comment). Only
  Test 5 and Test 6 are real new test cases (+2, not +3). The `sigma1/` test count went 234 (pre-plan)
  → 237 (after Task 1) → 239 (after Task 2). Reported the real count rather than padding with a
  vacuous third test, for the identical reason Task 1 declined a dummy Test 4.
- **EVNT-02/EVNT-05 left Pending in REQUIREMENTS.md.** This plan changes the QUANTITY those tabs will
  display but does not own the tabs (07-11/07-14 do) — matches the established 07-02 precedent for
  plans that partially satisfy a requirement listed in their own frontmatter. EVNT-03 was already
  Complete (07-01) and is untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's literal `allianceComponentVarianceSum` refactor shape breaks bit-identical digest reproduction**
- **Found during:** Task 1, immediately after the first code edit
- **Issue:** Refactoring `allianceComponentVarianceSum` to sum each team's subtotal via the new
  `teamOwnComponentVarianceSum` helper (as literally described) re-associates the floating-point
  addition chain feeding `predict()`'s `redPosteriorSum`/`bluePosteriorSum`, changing the last bit(s)
  of `variance` and therefore `pRedWin` — both committed `sigma1@2.0.0` digests failed to reproduce.
- **Fix:** Gave `teamOwnComponentVarianceSum` a `seed` parameter and had
  `allianceComponentVarianceSum` thread its running total through as that seed, reducing to the exact
  same addition order as before.
- **Files modified:** `packages/core/algorithms/sigma1/index.ts`
- **Verification:** `packages/harness/digest.test.ts` — 3 tests, 0 skipped, both committed digests
  reproduced bitwise.
- **Committed in:** `8f8cf1c9` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Two additional stale two-quantity-model doc sites found by this plan's own sweep gate**
- **Found during:** Task 2, running the acceptance-criteria grep
- **Issue:** `adaptation.ts` (two sites) and `rp/state.ts` (one site) asserted the superseded "team-page
  spread is R alone" claim, outside PD-02's enumerated 12 sites and outside `files_modified`.
- **Fix:** Corrected all three, minimally, to name R as one of two terms rather than the whole
  displayed value.
- **Files modified:** `packages/core/algorithms/sigma1/adaptation.ts`,
  `packages/core/algorithms/sigma1/rp/state.ts`
- **Verification:** the acceptance-criteria grep (`team-page spread|team-page \`±\`|Never displayed`)
  returns zero matches across `packages/core/algorithms/sigma1/` and `types.ts`.
- **Committed in:** `2d0d4a32` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug fix, 1 Rule 2 missing-critical doc fix)
**Impact on plan:** Both fixes were necessary to satisfy the plan's own acceptance criteria
(bit-identical digest reproduction; a doc sweep with zero remaining matches on its own gate grep). No
scope creep beyond what the plan's own gates required.

## The D-05 adaptation reversal (PD-03), stated plainly

Before this plan, `teamMetrics`' doc comment asserted that adaptation does NOT touch its output, and
gave a reason: the published `±` "must stay a direct empirical estimate of that team's own residual
spread, not partly a function of a tuning parameter." That invariant is now FALSE by construction.
`index.ts`'s `scaledQ = q * adaptationFactor(teamState.innovationStats, params)` scales the process
noise `kalman.ts`'s `applyTeamProcessNoise` adds to `belief.variance` — and `belief.variance` IS P,
which is now summed into every `TeamMetric.spread` this plan publishes. The published `±` is
therefore now partly a function of the adaptation tuning knob. **Consequence:** an adaptation on/off
comparison (the kind Phase 3's `sigma1-adapt` best-vs-best holdout comparison ran) can no longer
attribute the published `±` independently of the tuning parameter — adaptation now moves BOTH the
Kalman filter's responsiveness AND the number the site displays, where before it moved only the
former. This is recorded, not fixed: D-01 is a locked, one-way user decision that supersedes the
earlier D-05 constraint outright. The reversal is recorded in the code (`teamMetrics`' rewritten doc
comment), in this plan's `must_haves` (a `backstop`-verified truth), in the threat register
(`T-07-06-02`, disposition `mitigate`, residual accepted), and here.

## Nothing was published

No R2 object was written or deleted by this plan. No `publish.ts` code path was touched. No
`docs/publish-budget.md` re-measure was performed (owned by 07-19, since the widened spreads may add
digits at `ROUNDING_RULE.metric`'s two decimals — a payload effect of the eventual republish, not
measured here). The one-way door for this decision is realized at 07-10 (a small, idempotent subset
refresh) and, fully, at 07-17 (the gated full write pass) — never at this commit, which `git revert`
would undo completely.

## Doc-sweep completeness (PD-02)

All 12 sites PD-02 enumerated, plus the 2 extra sites this plan's own gate found, are corrected:

| # | File | Site | Named by D-03? | Status |
|---|---|---|---|---|
| 1 | `sigma1/index.ts` | file header ~line 11 (consistency.ts characterization) | no | done |
| 2 | `sigma1/index.ts` | `teamMetrics` doc, incl. D-05 adaptation paragraph (PD-03) | no | done |
| 3 | `sigma1/consistency.ts` | opening line | no | done |
| 4 | `sigma1/consistency.ts` | three-quantity map | no | done |
| 5 | `sigma1/consistency.ts` | `shrinkConsistency` doc closing sentence | no | done |
| 6 | `algorithms/types.ts` | `TeamMetric` doc | no | done |
| 7 | `algorithms/types.ts` | `Prediction.redScoreVarianceOwn` doc | no | done |
| 8 | `harness/pageArtifacts.ts` | file-header rule bullet | **yes** | done |
| 9 | `harness/pageArtifacts.ts` | section comment + `TeamMetricSchema` doc | **yes** | done |
| 10 | `harness/pageArtifacts.ts` | `redScoreVarianceOwn` doc | no | done |
| 11 | sketch-findings `uncertainty-display.md` | opening section + What-to-Avoid bullet | **yes** | done |
| 12 | sketch-findings `SKILL.md` | design_direction, Design Areas row, Blocked-on-data item 2 | no | done |
| extra-1 | `sigma1/adaptation.ts` | EWMA-alpha reasoning comment | no (found live) | done |
| extra-2 | `sigma1/adaptation.ts` | min-observations floor comment | no (found live) | done |
| extra-3 | `sigma1/rp/state.ts` | module header, "numerically untouched" claim | no (found live) | done |

## Issues Encountered

None beyond the two documented deviations above — both discovered by the plan's own gates (the digest
test and the sweep-gate grep) working exactly as designed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The single per-team `√(P + R)` construction is in place and proven-by-construction against
  `predict()`'s own output — 07-14 (Alliances tab) can sum three teams' published `spread` squares
  client-side and trust it equals the match band's variance without any further pipeline change.
- The already-shipped team page's `±` and metric-history band carry the new meaning automatically —
  `apps/web` diff is empty, confirmed.
- Nothing is published yet; 07-10's subset refresh and 07-17's gated full write pass are the two real
  points of no return this plan deliberately left ungated at (PD-05).

## Self-Check: PASSED

- FOUND: `packages/core/algorithms/sigma1/index.ts`
- FOUND: `packages/core/algorithms/sigma1/sigma1.test.ts`
- FOUND: `packages/core/algorithms/sigma1/consistency.ts`
- FOUND: `packages/core/algorithms/sigma1/adaptation.ts`
- FOUND: `packages/core/algorithms/sigma1/rp/state.ts`
- FOUND: `packages/core/algorithms/types.ts`
- FOUND: `packages/harness/pageArtifacts.ts`
- FOUND: `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md`
- FOUND: `.claude/skills/sketch-findings-sigmascout/SKILL.md`
- FOUND commit: `8f8cf1c9`
- FOUND commit: `2d0d4a32`
- FOUND commit: `e67c0b0d`

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*
