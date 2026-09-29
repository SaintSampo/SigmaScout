---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 06
subsystem: ranking-points
tags: [attribution, calibration, d-06-collapse, negative-result]
status: complete
requires:
  - 09-01 (frozen pre-phase calibration, the scorer's artifact mode, the Compare section)
  - 09-03 (the warm-roster mean-deficit record the marginal swap acted on)
  - 09-05 (the three arms and the resolved-family tally)
provides:
  - data/baselines/rp-attribution-2026-09.json (the eight-arm measurement, both slices)
  - data/baselines/rp-calibration-2026-09b.json (the post-collapse calibration; RP_CALIBRATION_MEASUREMENT_PATH points here)
  - docs/models/rp-attribution.md (the narrative record, sync-tested against the above)
  - a packages/core/rankingPoints/ with exactly one RP model and no selectable surface
affects:
  - 09-08 (puts this model in the Worker — read "The decision" below)
  - 09-10 (publishes this calibration; see the byte-budget finding)
tech-stack:
  added: []
  patterns: [one-scorer-one-process-one-commit, bar-frozen-before-measurement, plain-string-record-schema-outlives-its-code]
key-files:
  created:
    - data/baselines/rp-attribution-2026-09.json
    - data/baselines/rp-calibration-2026-09b.json
    - docs/models/rp-attribution.md
    - packages/harness/sigmaScoutLayer.bandGuard.test.ts
  modified:
    - scripts/measureRpCalibration.ts
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/marginals.ts
    - packages/core/rankingPoints/constants.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - apps/web/src/components/compare/RpCalibrationSection.tsx
    - docs/models/rp-layer-config-arms.md
  deleted:
    - packages/core/rankingPoints/rpLayerInertness.json
    - packages/core/rankingPoints/rpLayerInertness.test.ts
    - scripts/rpLayerInertnessGolden.ts
    - packages/harness/sigmaScoutLayer.rpArms.test.ts
decisions:
  - "All three RP model changes REVERT — the pre-committed bar accepted none of them (D-09/D-10)."
  - "The win source and tie model are structurally invisible to a per-bonus Brier; they were refused for moving nothing the bar reads, not for causing harm."
  - "clauseProbability refits combined moments as a hardcoded Gaussian, so the marginal swap only ever reached nestedSameVariable bonuses — recorded, not acted on."
  - "The resolution tally is KEPT (minus its negative-binomial counter) as a live fallback-ladder diagnostic — a deliberate deviation from the plan's revert-branch instruction to delete it."
metrics:
  duration: ~3h
  completed: 2026-09-11
actuals:
  tokens: 96000
  tasks: 4
  commits: 5
---

# Phase 09 Plan 06: RP Layer Attribution and the D-06 Collapse — Summary

Measured all eight combinations of phase 9's three candidate RP model changes through the one
published scorer, applied a bar that had been committed as executable code before any figure existed,
and — when that bar accepted none of them — deleted every losing branch and the entire config surface,
proving per-cell that the deletion moved no number.

## The decision

**09-08 and 09-10 read this section.**

**Developer authorization**, verbatim, from `09-CONTEXT.md`'s `<approvals>` block (2026-09-11):

> "spending through 2026, Approved! D1 work approved, deleting schedule generation approved, R2 delete approved"

That authorization covers **the spend of D-04's reporting slice, not the verdict**. The verdict was
taken by the pre-committed rule, run without override.

**`decideRpShipConfig`'s mechanical verdict: `acceptedFields: []`, `revertedFields: [win, tie, marginal]`.**

| Field | Mechanical verdict | Decision taken | Override? |
|---|---|---|---|
| Win source (D-13) | revert | **revert** | none |
| Tie model (D-14) | revert | **revert** | none |
| Marginal family (D-01) | revert | **revert** | none |

**The shipped combination is the legacy path on 09-04's closed form:**

```
winSource=score-draw, tieModel=continuous-equality, marginal=gaussian
```

There is no deviation from the mechanical verdict, so there is no override reason to record. D-10's
closed form was never on trial and ships regardless.

## The reporting-slice table

30 scored cells — derived from `RP_RULE_MODULES` and `PUBLISHED_ALGORITHM_IDS` at run time, matching
the `<baseline>` census exactly (10 bonuses x 3 algorithms).

| Arm | Scored | Improved | Regressed | Tied | Meets bar |
|---|---|---|---|---|---|
| `win` | 30 | 0 | 0 | 30 | no |
| `tie` | 30 | 0 | 0 | 30 | no |
| `marginal` | 30 | 3 | 3 | 24 | no |
| `win+tie` | 30 | 0 | 0 | 30 | no |
| `win+marginal` | 30 | 3 | 3 | 24 | no |
| `tie+marginal` | 30 | 3 | 3 | 24 | no |
| `win+tie+marginal` | 30 | 3 | 3 | 24 | no |

`decideRpShipConfig`'s `path`:

```
per-field gate: "win" scored=30 improved=0 regressed=0 tied=30 -> FAIL
per-field gate: "tie" scored=30 improved=0 regressed=0 tied=30 -> FAIL
per-field gate: "marginal" scored=30 improved=3 regressed=3 tied=24 -> FAIL
no single-change arm met the bar — nothing to combine, and no combination was evaluated
```

The six cells the marginal arm moved, regressions first:

| Algorithm | Season | Bonus | n | Control Brier | Marginal Brier | Delta | Outcome |
|---|---|---|---|---|---|---|---|
| opr | 2026 | supercharged | 26790 | 0.063672 | 0.064418 | +0.000746 | **REGRESS** |
| epa | 2026 | supercharged | 26790 | 0.063672 | 0.064418 | +0.000746 | **REGRESS** |
| bpr | 2026 | supercharged | 30382 | 0.058846 | 0.059476 | +0.000630 | **REGRESS** |
| opr | 2026 | energized | 26790 | 0.186335 | 0.181777 | -0.004559 | improve |
| epa | 2026 | energized | 26790 | 0.186335 | 0.181777 | -0.004559 | improve |
| bpr | 2026 | energized | 30382 | 0.197411 | 0.193987 | -0.003424 | improve |

The other 24 cells are bit-identical to `control`. On the SELECTION slice (2016-2020, 2022) **all 33
cells tied exactly** — the marginal arm changed nothing there at all.

### Two findings the measurement produced rather than assumed

**1. The win source and tie model are structurally invisible to this bar.** Both change only the
win/tie/loss half of the RP pmf; D-09's bar reads per-bonus Brier. They were refused for moving
nothing the bar looks at, not for causing harm. Their real effects are measured under "F2, F3 and F10
as measured" below. Verified as structural rather than a wiring fault by the `marginal` arm on the
same slice, which does move figures through the same plumbing.

**2. The marginal swap's reach was far narrower than its label.** `analyticPmf.ts`'s
`clauseProbability` sums a clause's terms' fitted moments and then refits the combined variable as a
**hardcoded Gaussian**, discarding the declared family. Only `nestedSameVariable` bonuses bypass it.
Counting that predicate kind per season: every season has zero except 2026, which has two — and those
two bonuses across three algorithms are exactly the six cells that moved. So 24 of 30 reporting cells
were structurally incapable of responding to the swap. **Recorded, not acted on**: changing
`clauseProbability` would re-specify the model and move `control` mid-flight, which is the line the
collapse had to stay on the safe side of. This should be routed back as a new audit finding.

## Same-scorer evidence

**The two commits, in order** (`git log --oneline -- scripts/measureRpCalibration.ts`):

```
b49217cf feat(09-06): TRACER — the arm-selecting scorer, one replay, eight layers   <- measurement
4e85b304 feat(09-06): freeze D-09's bar as code, before any measurement exists      <- the bar, FIRST
```

`git show --stat 4e85b304` — the bar-freezing commit touched **only** the scorer and its test:

```
 scripts/measureRpCalibration.test.ts | 279 ++++++++++++++++++++++++++++++-
 scripts/measureRpCalibration.ts      | 314 +++++++++++++++++++++++++++++++++++
 2 files changed, 592 insertions(+), 1 deletion(-)
```

**The bar did not move between the freeze and the measurement.** Extracting both function bodies at
`4e85b304` and at the measurement commit and comparing byte-for-byte:

```
evaluateD09Bar:     IDENTICAL  (1419 chars at freeze, 1419 at measurement)
decideRpShipConfig: IDENTICAL  (3668 chars at freeze, 3668 at measurement)
```

**One `SigmaScoutLayer` construction site.** During the measurement it read (three arguments — rule
module, resolved algorithm id, arm config):

```ts
for (const arm of arms) byArm.set(arm.name, new SigmaScoutLayer(ruleModule, algorithm.id, arm.config));
```

After the collapse it is back to two, since there is no config to pass:

```ts
const layers = new Map(algorithms.map((a) => [a.id, new SigmaScoutLayer(ruleModule, a.id)]));
```

`grep -c "new SigmaScoutLayer"` prints `1` in both states. Excluding comment lines,
`grep -cE 'rpPmfForMatch|RpMomentsAccumulator|analyticRpPmf'` prints `0` — the script reaches RP only
through `SigmaScoutLayer.foldPlayed`.

**Identical-population guard, broken on purpose and observed failing.** One observation was dropped
from a non-control arm inside the script's own accumulation, the tracer slice re-run:

```
measure:rp-calibration failed: identical-population guard FAILED for (bpr, 2026, energized):
control=30382, win=100 — every arm must score the identical observation set because #rpFieldsFor's
eligibility gates run before any config branch; a difference means an arm is wired wrong
```

Reverted; the guard passes and the full run completed with it active for all ten seasons.

## Resolved-family mix

Read from `FittedMarginal.resolved`, never `.declared`, with fallbacks on a separate axis.

| Arm | Negative binomial | Gaussian | Degenerate | Fallbacks | NB share |
|---|---|---|---|---|---|
| `control`, `win`, `tie`, `win+tie` | 0 | 2,328,695 | 89,309 | 89,309 | 0.00% |
| `marginal`, `win+marginal`, `tie+marginal`, `win+tie+marginal` | 1,683,332 | 645,363 | 89,309 | 734,672 | **69.62%** |

**The negative-binomial arm's label was NOT honest, and this is stated first rather than buried: its
share is 69.62%, below the 90% the plan set as the threshold for saying so plainly.** Roughly three in
ten fits fell back to Gaussian on the documented ladder. Read together with finding 2 above, the label
was optimistic twice over — once through the fallback ladder, and once because `clauseProbability`
discarded the family for 24 of the 30 cells regardless of what the fit resolved to. **The tally as
placed counts fits PERFORMED, not fits USED**, which is a real gap in the observability mechanism
09-05 built for exactly this hazard.

This did not change the verdict: the marginal arm failed on a regression, not on ambiguity.

## F2, F3 and F10 as measured

**F2 — pooled reporting-slice figures (n = 801,828 alliance-bonus observations):**

| Arm | Mean predicted | Observed | Ratio | Brier |
|---|---|---|---|---|
| `control` | 0.1722 | 0.3294 | 1.913x | 0.183764 |
| shipped (= `control`) | 0.1722 | 0.3294 | 1.913x | 0.183764 |
| `win+tie+marginal` | 0.1681 | 0.3294 | 1.959x | 0.183404 |

**Set beside the audit's F2 headline of 0.1507 predicted against 0.3109 observed (2.06x) — and that
comparison is CROSS-GENERATION.** The audit figure predates both 09-01's same-scorer fix and 09-04's
replacement of the Monte Carlo with the closed form, so it is the phase's starting point and not a
like-for-like predecessor. **F2 remains open**: bonus probabilities still under-predict by about 1.9x,
and none of the three candidate fixes was accepted.

The cross-generation panel itself: across 63 comparable cells, 60 moved and 3 are identical between
09-01's frozen file and the `control` arm at HEAD, largest absolute Brier movement 0.00292885. The
engine swap changed published values, as 09-04 said it would, by small amounts per bonus. This panel
was never fed to the bar, and a test asserts it cannot be.

**F3 — what the marginal swap acted on.** 09-03's `docs/models/rp-mean-deficit-warm-rosters.md` is the
record the swap was attempted against; this plan cites it and did not re-measure it. Its
REPORTING-slice half is quoted nowhere as a reason for any choice (D-04).

**F10 — the upstream cause REMAINS OPEN.**

| Algorithm | Season | Bonus | Observed | Dot-eligible, control | Dot-eligible, shipped |
|---|---|---|---|---|---|
| opr | 2025 | autoBonus | 65.94% | 0.11% | 0.11% |
| epa | 2025 | autoBonus | 65.94% | 0.11% | 0.11% |
| bpr | 2025 | autoBonus | 62.55% | 0.30% | 0.30% |

An alliance earned this bonus about two times in three and roughly one dot in a thousand could render
solid. The audit recorded "under 2.6%"; measured through the published scorer it is an order of
magnitude smaller. Nothing moved, because everything reverted. **`PREDICTED_BONUS_THRESHOLD` is
unchanged** and the display half stays out of scope; the record's `dotThreshold` is pinned equal to it
by a test on the web side.

**F6 and F7 — descriptive, neither a gate** (reporting slice, n = 159,067):

| Arm | Mean abs(pmf pRedWin − published pRedWin) | Mean predicted tie |
|---|---|---|
| `control` | 0.036968 | 0.000000 |
| `win` | **0.000000** | 0.000000 |
| `tie` | 0.037331 | **0.008239** |
| `win+tie` | 0.004116 | 0.008239 |

F6 is fully closed by the `win` arm — exactly zero, by construction. F7's legacy tie probability is
identically zero, confirming the audit's dead-branch finding; the discrete-margin branch predicts
0.008239 against the measured base rate 1206/110362 = 0.010928. Both were reverted anyway. Neither is
an accuracy claim.

## The deletion set

**The three filtered source searches** (code lines only, non-test sources under
`packages/core/rankingPoints`, `packages/harness`, `scripts`):

```
RpLayerConfig on non-test code lines: 0
RP_LAYER_CONFIG_DEFAULT on non-test code lines: 0
assertSupportedRpLayerConfig on non-test code lines: 0
describeRpLayerConfig on non-test code lines: 0
resolveDeclaredFamily on non-test code lines: 0
```

*(Including test files the count is 3, all inside `analyticPmf.test.ts`'s own deny-list — the test
that enforces these names appear on no code line. That is the guard, not a leftover.)*

**Deleted files**, all three absent and the package script gone
(`scripts['rp:inertness-golden']` prints `undefined`):
`packages/core/rankingPoints/rpLayerInertness.json`,
`packages/core/rankingPoints/rpLayerInertness.test.ts`, `scripts/rpLayerInertnessGolden.ts`, plus
`packages/harness/sigmaScoutLayer.rpArms.test.ts` (nothing in it retained a subject).

**Also deleted:** the layer-config type and its two member unions, the production default, the label
function, the support assertion, the family resolver; the constructor's config parameter and getter
and the threading through `publishSeasons`/`runEventMode`; the `p-red-win` branch and its required
`pRedWin` input; `tieProbability` and `TIE_MARGIN_HALF_WIDTH`; `splitOutcomeProbabilities` and
`OutcomeSplit`; the negative-binomial fit, its log-space exact discrete CDF, `NB_MAX_TAIL_TERMS`,
`nbTailSum`, `nbMode`; the arm registry, `resolveRpArms`, the `--arms` flag, the nested per-arm layer
map, the identical-population guard, `evaluateD09Bar` and `decideRpShipConfig`.

**`packages/core/rankingPoints/analyticPmf.ts`'s exported surface, pinned as one set equality:**

```
MarginalResolutionTally, emptyMarginalResolutionTally, convolvePmf, AllianceBonusRp,
allianceBonusRpPmf, RpOutcomeDistribution, RpOutcomeInput, matchOutcomeDistribution,
AnalyticRpPmfInput, AnalyticRpPmfResult, pmfMean, pmfStandardDeviation, analyticRpPmf
```

**The per-cell equality gate PASSES.** All 30 reporting-slice cells in
`rp-calibration-2026-09b.json` are `===` equal to the chosen arm's pre-collapse figures — count, mean
predicted, observed frequency and Brier — with no tolerance. The compared count (30) is derived from
the season modules, matching the census.

Corroborating from the re-emit run's own console: the grand-pooled figure (n=1534196, mean predicted
0.1463, observed 0.3048) and the marginal tally (gaussian=2328695, degenerate=89309, fallbacks=89309)
both reproduce the pre-collapse control arm exactly.

**The gate's failure mode, demonstrated.** Perturbing its own comparison by 1e-12:

```
AssertionError: brierScore moved for opr|2023|activationBonus:
expected 0.23209061284396756 to be 0.23209061284496757 // Object.is equality
```

Reverted; the gate passes. The document sync test's failure mode was demonstrated the same way
(`reportingCellCount` 240 → 241 fails it, naming the field) and reverted.

**D-12 confirmation:** `npx vitest run packages/harness/level1Digest` passes after the deletion pass —
3 tests, no cross-level leak.

## Vestigial band record

**The shipped combination DOES read the alliance band variance.** The arm that would have left it
without a consumer (`win`, taking the win half from the published win probability) did not ship, so
the vestigiality 09-05 warned about did not materialise.

**`#rpFieldsFor`'s guard was not touched.** `git diff packages/harness/sigmaScoutLayer.ts` shows no
change to its lines; it still takes both alliance band variances and still returns `{}` when either is
undefined. It now has a dedicated behavioral test
(`packages/harness/sigmaScoutLayer.bandGuard.test.ts`) asserting that a cold roster produces no RP
fields at all — including 09-07's five decomposition keys, which are absent rather than empty — plus a
source assertion that both parameters and the guard line survive. That file's header records why it
must not be deleted as redundant. **F8/F9 stays out of scope.**

## Baseline vs post-plan failing test sets

| | Baseline (before Task 1) | After Task 4 |
|---|---|---|
| Full suite, **from the repo root** | **255 files**, 4997 passed, 6 skipped | **254 files**, 4948 passed, 4 skipped |
| Failing test names | **none** | **none** |
| `npx tsc --noEmit` | clean | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean | clean |

**Zero new failures; both failing sets are empty.** The file count drops by one on net: two test files
deleted (the inertness golden's and the arm-matrix's), one added (the band guard's). The 49 fewer
tests and 2 fewer skips are the arm-matrix, negative-binomial and frozen-bar cases whose subjects were
deleted. 254 is the repo-root count — not the 77 that would mean the command ran from `apps/web`.

Scope: `git diff --stat` against `docs/publish-budget.md`, `data/baselines/rp-calibration-2026-09.json`,
`packages/harness/pageArtifacts.ts`, `apps/web/src/lib/bonusRp.ts` and `pnpm-lock.yaml` is **empty**.

## Byte budget — a finding for 09-10

The largest post-attach compare artifact is **19,811 bytes against the committed 20,000 ceiling —
189 bytes of headroom**, not the 5,912 that 09-01 recorded. The test passes and
`docs/publish-budget.md` is unchanged.

**This plan did not cause it and did not spend that headroom.** Attaching the old measurement and the
new one to every compare fixture produces byte-identical artifacts (19,811 both), so the new optional
`rpLayer` label costs exactly zero wire bytes as designed. The `compare-2026.json` fixture is now
**18,653 bytes bare**, with the RP attachment accounting for 1,158 of the total. The growth is in the
fixture itself. **09-10 should treat 189 bytes as the real headroom**, and the standing remedy is to
shrink the block rather than raise the budget.

## Deviations from Plan

**1. [Rule 2 — deliberate judgement] The resolution tally was KEPT, minus its negative-binomial counter.**
The plan's revert branch says to "delete the counter and its layer accessor". The deletion rule that
governs the whole pass is that anything which "can only ever take one value after the collapse" goes.
The tally does not meet that test: `resolved` still ranges over `gaussian` and `degenerate`, the
fallback ladder is still live, and the counter is a genuine multi-valued diagnostic rather than a
toggle that lost its second position. The plan's own SHIP branch describes it as "a permanent
fallback-ladder diagnostic" for exactly this reason. Kept with its doc comment rewritten to say what
it now is; its `negativeBinomial` field — which genuinely could only be zero — was deleted.

**2. [Rule 3 — blocking] Commit boundaries differ from the plan's four.** The plan's Commit 1
(remove the config surface) and Commit 2 (collapse each field to its decided branch) cannot be
separated: deleting the config object forces every branch to choose a member in the same change, or
the tree does not compile. They landed as one commit (`2731bfab`). Commits 3 and 4 are as planned. The
count is still four 09-06 code/doc commits plus the bar-freezing commit.

**3. [Rule 1 — bug] The baseline-directory enumerator had to learn about two new files.**
`packages/harness/baselineFingerprint.test.ts` asserts the exact contents of `data/baselines/` and
parses every `.json` there against the fingerprint schema. Task 2's attribution record and Task 4's
re-emitted calibration are not fingerprints and have their own schemas. Updated from 9 to 11 files
with both excluded from the schema sweep, each with a doc comment saying why. **This should have
failed at Task 2**, where I ran only the scoped scorer and `bonusRp` suites rather than the harness
suite; it surfaced at Task 4's harness run.

**4. [Rule 1 — bug] Two pre-existing findings routed here by 09-02, both fixed.**
`constants.ts`'s 0.625464 understatement figure for 2025 `autoBonus` predates the 2026-09-09 auto
tracking fix and describes a superseded state — labelled with a stale-figure warning rather than
silently re-guessed, since re-running `pnpm rp:conservative-branch` is out of this plan's scope.
`rules.test.ts`'s case titled *"2025: autoBonus is always false"* passed only because it supplied
neither auto variable; it now supplies both and asserts both directions (true when both thresholds
are met, false when either is missed).

**5. [Rule 1 — bug, caught by tests] Removing the family resolver briefly shipped negative binomial.**
Deleting `resolveDeclaredFamily` made `allianceBonusRpPmf` honour each variable's declaration
directly — and all 34 still said `negative-binomial`, so the collapse momentarily shipped the arm the
bar had just refused. The 2026 hand-computed tracer tests failed loudly (0.8642 against an expected
Gaussian 0.841344746) and the declarations were reverted in the same commit. Recorded because the
failure was the intended safety net working, and because a green suite at that moment would have
published the opposite of the decision.

**6. [assertion correction, before any reporting figure existed] One hand-computed expectation of mine
was arithmetically wrong.** In the zero-observation exclusion case I asserted `meetsBar === false` for
a table of 3 scored / 2 improved / 0 regressed; 2 > 3/2 is true, so the bar returns `true`. The
`<baseline>` table pins only the exclusion from `scored` for that row and says nothing about
`meetsBar`, so this was my own added assertion, not a pinned value. Corrected to `true` with the
arithmetic spelled out. **This happened during Task 1, before any measurement code existed and before
any 2023-2026 figure had been seen** — the bar's logic was not touched.

## Known Stubs

None. No stub, placeholder or unwired component was introduced.

## Recorded skips

- **Spec-less probe fallback.** No `SPEC.md` exists for Phase 9 and the phase has no requirement IDs
  to probe — all 38 v1 requirements map to Phases 1-8 and this phase is post-v1.0. No probe-derived
  predicates were generated; the `requirements` frontmatter carries CONTEXT decision ids (D-04, D-06,
  D-09, D-10, D-11) and audit-finding keys (F2, F3, F10) instead. Recorded so a later audit can tell a
  deliberate absence from a missed step.
- **The plan's console-report byte-for-byte preservation was not attempted.** Each per-season block
  now prints `── {season} [{algorithm} / {arm}] ──` rather than `── {season} [{algorithm}] ──`, so the
  audit's reproduction command produces the same figures under a slightly different block header.
  Deliberate: the plan asked for one block per arm rather than a collapse, and `--arms` still defaults
  to `control` alone so every pre-existing invocation keeps its meaning.
- **`pnpm rp:conservative-branch` was not re-run** to refresh the stale 0.625464 figure. Out of scope;
  the figure is labelled rather than replaced.
- **No gate failed to run.** Every verification step in the plan was executed.

## Scope statements

- **This plan installed no package.** There is no `npm`/`pnpm add`, no `pnpm remove`, no `pip` and no
  `cargo` anywhere in it; `pnpm-lock.yaml` is unchanged and no `package.json` dependency block moved
  (the only `package.json` edit is the removal of one script entry). **The Package Legitimacy Gate
  therefore did not apply** and no `[ASSUMED]`/`[SUS]` checkpoint was required.
- **No secret was read, printed, copied or interpolated anywhere.** `.env` was never opened by any
  tool, command, test name, assertion message, log line, document or commit message. Nothing in this
  plan needed a credential: no R2 write, no manifest bump, no Worker deploy, no D1 touch, no network
  request and no publish command.
- **Worktrees were disabled** (`workflow.use_worktrees` is `false`), as required — Tasks 1, 2 and 4
  read `data/corpus.sqlite` (582,705,152 bytes, mtime 2026-09-10T02:49:34Z), which is gitignored and
  does not merge back out of a worktree.
- **Another session was committing to this checkout throughout.** Every commit staged explicit paths;
  `git status --short` was checked before each. No foreign edit was absorbed.

## Self-Check: PASSED

Created files verified present: `data/baselines/rp-attribution-2026-09.json`,
`data/baselines/rp-calibration-2026-09b.json`, `docs/models/rp-attribution.md`,
`packages/harness/sigmaScoutLayer.bandGuard.test.ts`. Deleted files verified absent:
`rpLayerInertness.json`, `rpLayerInertness.test.ts`, `rpLayerInertnessGolden.ts`,
`sigmaScoutLayer.rpArms.test.ts`.

Commits verified in `git log`: `4e85b304`, `b49217cf`, `ed94baef`, `2731bfab`, `80b526aa`, `b06ee364`.
