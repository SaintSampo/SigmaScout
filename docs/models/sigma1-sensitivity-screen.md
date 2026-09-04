# Sigma1 sensitivity screen (D-03a)

This is the committed answer to "which of Sigma1's Phase-3 hyperparameters can the tune-season
data actually distinguish" — the direct application of the failure log's unidentifiable-model
lesson (REBUILD_SPEC.md): before a joint search spends its budget on 20 dimensions, find out
which of them the data can even tell apart from their own default. Every number below is quoted
from `reports/sensitivity-screen.json`, produced by `packages/harness/tune.ts --stage screen`
(`pnpm tune --stage screen --seasons 2022,2023 --values 5`) against the real corpus
(`data/corpus.sqlite`).

## Method

- **Seasons:** 2022, 2023 (both TUNE seasons — see plan's default; 2024 is intentionally left
  out of the screen, reserved for the joint search's own three-tune-season budget, and 2025/2026
  were HOLDOUT and structurally unreachable by `tune.ts` at the time this screen ran — see below
  for what is still true today and what governs eligibility now).
- **Grid:** every one of `SEARCHABLE_PARAM_KEYS`' 20 parameters swept ONE AT A TIME over 5 values
  each (`--values 5`, `screenGridFor`'s geometric spacing for `log`-scaled parameters, arithmetic
  for `linear`), inclusive of both declared bounds and always including the parameter's own
  default, with every OTHER parameter held at `DEFAULT_SIGMA1_PARAMS` (including
  `adaptationEnabled: false` throughout — see the Honesty Register's adaptation note). 100
  candidates total (20 x 5), batched 8 at a time through a shared stream build per
  `packages/harness/tune.ts`'s batching contract; every candidate additionally fixes
  `rpMonteCarloDraws: 0` (plan 03-03 proved this never moves `pRedWin`/predicted scores).
- **Objective:** mean tune-season `brierScore` (`combined` `compLevelView`), minimized — the
  identical D-01 objective the joint search (Task 2) uses, so a parameter's screen verdict and
  its joint-search behaviour are directly comparable.
- **Survival threshold:** `SCREEN_SURVIVAL_THRESHOLD = 1e-4`
  (`packages/harness/tune.ts`), justified in prose there and repeated here: roughly 0.06% of
  Phase 2's measured ~0.17 combined-view tune Brier (03-CONTEXT.md's own starting-position
  table) — small enough to keep anything that plausibly reflects a real effect, large enough to
  exclude pure replay noise. Stated as a starting point, not a once-and-for-all calibrated
  constant.
- **Holdout blindness (historical — F-4, quick task 260903-tk6):** at the time this screen ran,
  the guard was structural, not conventional — `tune.ts` refused any requested season in
  `HOLDOUT_SEASONS` before any corpus read, independently re-checked every requested season via
  `seasonSplit`, and re-checked every produced score slice for `seasonLabel`/`headlineEligible`
  after scoring. `HOLDOUT_SEASONS`, `seasonSplit`, and `seasonLabel` have since been retired —
  none of the three runs anymore. What remains true and still checkable from this screen's own
  reported seasons: it swept 2022 and 2023 only and never touched 2025 or 2026. Headline
  eligibility today is governed instead by `score.ts`'s two-clause corpus-relative
  `isHeadlineEligible` — at least `MIN_PRIOR_SEASONS_FOR_HEADLINE` distinct prior seasons in the
  declared corpus, AND the season absent from the scoring algorithm's own selected-on set —
  sourced from `selectionProvenance.ts`'s registry.

## Screen Results

| Parameter | Default | Best | Best Brier | Brier range | At bound | Survives |
|---|---|---|---|---|---|---|
| `processNoiseWithinEvent` | 0.5 | 1.581 | 0.173301 | 4.517e-3 | no | **yes** |
| `processNoiseEventBoundary` | 8 | 8 | 0.173916 | 2.135e-3 | no | **yes** |
| `consistencyEwmaAlpha` | 0.2 | 0.02 | 0.169264 | 5.779e-3 | yes | **yes** |
| `shrinkagePriorMatches` | 8 | 1 | 0.173916 | 0.000e+0 | yes | no |
| `minConsistencyVariance` | 1 | 0.1 | 0.173916 | 0.000e+0 | yes | no |
| `covEwmaAlpha` | 0.1 | 0.455 | 0.173104 | 2.848e-3 | no | **yes** |
| `covShrinkage` | 0.3 | 0 | 0.173587 | 4.823e-4 | yes | **yes** |
| `linkC` | 1 | 1 (default) | 0.173916 | 4.206e-2 | no | **yes** |
| `coldStartTeamTotal` | 20 | 5 | 0.173898 | 2.173e-5 | yes | no |
| `coldStartConsistencyVariance` | 25 | 8.944 | 0.173459 | 2.244e-3 | no | **yes** |
| `fallbackScoreSd` | 25 | 8 | 0.173916 | 0.000e+0 | yes | no |
| `consistencyCarryDecay` | 0.5 | 1 | 0.173779 | 7.396e-4 | yes | **yes** |
| `carryMeanReversion` | 0.4 | 0 | 0.173354 | 2.194e-3 | yes | **yes** |
| `carryLastYearWeight` | 0.7 | 0 | 0.173916 | 0.000e+0 | yes | no |
| `carryPriorYearWeight` | 0.3 | 0 | 0.173916 | 0.000e+0 | yes | no |
| `adaptationEwmaAlpha` | 0.2 | 0.02 | 0.173916 | 0.000e+0 | yes | no |
| `adaptationExponent` | 0.5 | 0 | 0.173916 | 0.000e+0 | yes | no |
| `adaptationMinFactor` | 0.25 | 0.05 | 0.173916 | 0.000e+0 | yes | no |
| `adaptationMaxFactor` | 4 | 1 | 0.173916 | 0.000e+0 | yes | no |
| `adaptationMinObservations` | 3 | 1 | 0.173916 | 0.000e+0 | yes | no |

`linkC`'s "best=1" is its own default value — it "wins" its sweep at the exact point the grid was
built to always include, which is a legitimate `atBound: false` result (1 is interior to
`[0.25, 4]`), not a sign of a bug.

## Survivors

**9 of 20 parameters survive** (`brierRange > 1e-4`), in `SEARCHABLE_PARAM_KEYS` order:

1. `carryMeanReversion`
2. `coldStartConsistencyVariance`
3. `consistencyCarryDecay`
4. `consistencyEwmaAlpha`
5. `covEwmaAlpha`
6. `covShrinkage`
7. `linkC`
8. `processNoiseEventBoundary`
9. `processNoiseWithinEvent`

These 9 feed plan 03-05 Task 2's joint search (`reports/sensitivity-screen.json`'s own
`survivors` array — Task 2 reads this file directly, never a hand-copied list). The remaining 11
are held at their exact `DEFAULT_SIGMA1_PARAMS` value in both joint searches.

**Every surviving parameter's `atBound` flag is reported above, and none is silently accepted at
a bound without comment**: `consistencyEwmaAlpha` (0.02, its bound's own floor), `covShrinkage`
(0), `consistencyCarryDecay` (1), and `carryMeanReversion` (0) each win at an edge of their
declared range. A winner sitting on a bound means the bound may be too narrow, not that the
screen converged — this is flagged here, and the joint search (Task 2) re-flags it per-run for
whatever the ACTUAL joint winner does, since a one-at-a-time best is not necessarily the joint
best.

## Honesty Register

A one-at-a-time screen cannot see everything, and three distinct kinds of blindness showed up in
this real run — each is a genuine, expected, structural fact about this screen's OWN
construction, not a surprise or a defect to be quietly patched:

1. **A parameter that matters only in interaction with another is invisible here** (D-03's own
   accepted tradeoff). The joint stage recovers interactions only AMONG the 9 survivors above,
   never among a parameter this screen already dismissed. If, for example, `linkC` and
   `processNoiseWithinEvent` only jointly matter in some combination neither shows alone, this
   screen cannot see that — only a joint search over both (which Task 2 now runs, since both
   survived) can.

2. **Three parameters are STRUCTURALLY INVISIBLE to this screen's objective, not merely
   measured-insensitive**: `minConsistencyVariance` and `shrinkagePriorMatches` are read
   exclusively inside `teamMetrics()` (`shrinkConsistency`'s floor and empirical-Bayes prior
   weight) — the published team-page `±` spread — which `tune.ts`'s Brier-scoring replay never
   calls (only `predict`/`update`). `fallbackScoreSd` is read only inside `predict()`'s
   `standardDeviation` fallback, which fires only when fewer than 2 alliance-score observations
   exist yet this season — a state a real multi-event, multi-match replay essentially never
   revisits (03-01's own field-wiring proof calls it "unreachable via a normal replay"). Their
   `brierRange = 0.000e+0` here is not "the data says these don't matter" — it is "this
   OBJECTIVE cannot see these at all," a stronger and more specific claim. This mirrors exactly
   why `rpMonteCarloSeed`/`rpMonteCarloDraws` are excluded from the search space outright
   (`searchSpace.ts`'s own header) — the difference is these three are *included* in the search
   space (their effect matters for the SITE's published numbers, just not for this Brier
   objective), so excluding them from `SEARCHABLE_PARAM_KEYS` outright would have been wrong;
   showing them as non-survivors here, with this explanation, is the honest alternative.

3. **`carryLastYearWeight`/`carryPriorYearWeight` are structurally inert in a TWO-season screen,
   independent of any real sensitivity they might have.** `sigma1Carryover`'s blend
   (`carryLastYearWeight * lastYear + carryPriorYearWeight * yearBefore`) only activates when a
   team has THREE seasons of rating history behind a carry boundary (both `lastYear` and
   `yearBefore` present) — with `lastYear` present but `yearBefore` always `null`. A 2022→2023
   carry (the only boundary this 2-season screen crosses) is *always* the single-value fallback
   branch (`lastYear ?? yearBefore`), which reads neither weight. The 2023→2024 boundary — the
   FIRST point in the tune-season range where a team can have two full prior seasons of rating
   history — never happens inside this screen's 2022–2023 window. `carryMeanReversion`, by
   contrast, is applied unconditionally on every carry regardless of which branch produced
   `blended`, which is exactly why it DOES show measured sensitivity (rank 2.194e-3) while its
   sibling weights show none. This is a real, mechanical, season-window-driven blind spot, not a
   claim that the weights are truly dead — the joint search (Task 2) runs over 2022-2024 and
   therefore DOES cross the 2023→2024 boundary, but per this screen's own `survivors` list, the
   weights are not among the parameters it searches (they did not survive HERE), so this
   limitation carries forward: the joint search cannot rescue a parameter the screen already
   excluded from its candidate set. Widening the screen's own season window to include 2024 was
   considered and rejected for this run to keep the screen's budget separate from the joint
   search's own reserved seasons per the plan's default; a future screen re-run over 2022-2024
   would be the correct way to re-examine this specific pair.

4. **`coldStartTeamTotal` is a genuine near-miss, not a clean fail.** Its measured range
   (2.173e-5) is roughly 22% of `SCREEN_SURVIVAL_THRESHOLD` — real, non-zero, but below the
   declared bar. Recorded as such rather than silently rounded into either bucket; the threshold
   is honestly a starting point, and this is exactly the kind of borderline case a future
   recalibration of `SCREEN_SURVIVAL_THRESHOLD` would need to weigh.

5. **Adaptation's five hyperparameters (`adaptationEwmaAlpha`/`Exponent`/`MinFactor`/`MaxFactor`/
   `MinObservations`) all show `brierRange = 0.000e+0` exactly** because this screen ran with
   `adaptationEnabled: false` throughout (the honest default every other swept parameter also
   used) — `adaptationFactor` (`adaptation.ts`) returns EXACTLY `1` on the disabled path
   regardless of these five fields' values, so their sweep is bitwise inert by construction, not
   by measurement. This is the correct, structural finding for a screen run at the off baseline:
   these five knobs' effect is entirely gated behind D-06's separate `--adaptation on|off` mode
   switch, which plan 03-05 Task 3 compares as two whole-run alternatives, never as a dimension
   inside one search. Because none of the five survived this screen, the two joint searches (Task
   2/3) search an IDENTICAL 9-parameter survivor set — the only difference between the
   adaptation-on and adaptation-off joint runs is the `adaptationEnabled` flag itself; on the OFF
   run, evaluating that shared survivor set is unaffected by adaptation (it is off), and on the ON
   run, the same 9 dimensions are searched WHILE adaptation runs with its own untuned defaults.
   This is a genuine, publishable limitation of this specific screen run, not a bug: a future
   screen re-run at `adaptationEnabled: true` would be the correct way to ask whether adaptation's
   own five hyperparameters are separately tunable.

---
*Phase: 03-tuning-ranking-points-versioning*
*Generated: 2026-08-16, from `reports/sensitivity-screen.json` (`pnpm tune --stage screen --seasons 2022,2023 --values 5`)*
