# RP layer attribution — what each of phase 9's three model changes actually did

## Headline verdict — read this first

**All three changes REVERT. The pre-committed rule accepted none of them.**

| Change | Improved | Regressed | Tied | Meets the bar | Verdict |
|---|---|---|---|---|---|
| Win source (`p-red-win`, D-13) | 0 | 0 | 30 | no | **revert** |
| Tie model (`discrete-margin`, D-14) | 0 | 0 | 30 | no | **revert** |
| Marginal family (`negative-binomial`, D-01) | 3 | 3 | 24 | no | **revert** |

The bar requires a majority of the 30 scored bonus cells to improve on Brier **and not one to get
worse**. No single-change arm met it, so no combination was evaluated — that is the rule's own
floor, not a shortcut.

**Two of the three failed for opposite reasons, and the difference matters more than the shared
verdict.** The marginal swap moved real numbers and was refused because it made three cells worse.
The win source and the tie model moved *nothing at all* on this measurement: they are **structurally
invisible** to a per-bonus Brier, because both change only the win/tie/loss half of the ranking-point
distribution while the bar reads the bonus half. Their real effects are measured and recorded below;
the bar simply cannot see them.

The closed form itself was never on trial and ships regardless (D-10).

*This section records the MECHANICAL verdict the frozen rule produced. The decision taken on it by a
human is recorded under "The decision" below.*

## What was measured

Eight arms — the full cross product of three independently selectable config fields — each scored
against the unchanged legacy model:

| Arm | Win source | Tie model | Marginal family |
|---|---|---|---|
| `control` | `score-draw` | `continuous-equality` | `gaussian` |
| `win` | `p-red-win` | `continuous-equality` | `gaussian` |
| `tie` | `score-draw` | `discrete-margin` | `gaussian` |
| `marginal` | `score-draw` | `continuous-equality` | `negative-binomial` |
| `win+tie` | `p-red-win` | `discrete-margin` | `gaussian` |
| `win+marginal` | `p-red-win` | `continuous-equality` | `negative-binomial` |
| `tie+marginal` | `score-draw` | `discrete-margin` | `negative-binomial` |
| `win+tie+marginal` | `p-red-win` | `discrete-margin` | `negative-binomial` |

**`control` is the honest baseline** — the all-legacy config running on the closed form that plan
09-04 put in place of the 4,000-draw Monte Carlo. It is the left-hand side of the bar because D-10
ships that engine change unconditionally: the only question the bar governs is whether each
*modelling* change earns its place *given* the closed form.

**Every arm passed through the same imported `SigmaScoutLayer`, in one process, at one commit, over
one walk-forward replay per season.** There is exactly one layer construction site in the generating
script and exactly one replay per season; the arms multiply layers, never replays. That is D-11's
mitigation for the confidence intervals it declined, and it is a structural fact rather than a claim
in a header — a scorer mismatch has already manufactured a phantom regression on this project once.

Every arm provably scored the **identical observation set**: the layer's eligibility gates run before
any config branch, so the arms cannot differ in which observations they see, and both an in-flight
assertion and an at-rest test over the committed record check it.

Generating command:

```
npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026 --arms all \
  --attribution-out data/baselines/rp-attribution-2026-09.json
```

## SELECTION SLICE (2016-2020, 2022)

33 scored cells — 11 bonuses across three published algorithms. This is the slice that was free to
inform the marginal-family choice, and 09-03's warm-roster mean-deficit record is drawn from it.

**The marginal swap changed nothing here. All 33 cells tied exactly**, bit for bit, against
`control`. Pooled mean predicted 0.1179 against an observed 0.2779, identical under both arms.

That is not a null result about negative binomial as a distribution. It is a result about **reach**,
and its cause is named under "Why the marginal arm's reach is far narrower than its label" below.

## REPORTING SLICE (2023-2026)

30 scored cells — 10 bonuses across three published algorithms, derived from the season modules and
the published algorithm list rather than hardcoded. This slice had no say in any choice, which is
what makes the figure below out-of-sample and free of a disclosure caveat.

| Arm | Scored | Improved | Regressed | Tied | Meets bar |
|---|---|---|---|---|---|
| `win` | 30 | 0 | 0 | 30 | no |
| `tie` | 30 | 0 | 0 | 30 | no |
| `marginal` | 30 | 3 | 3 | 24 | no |
| `win+tie` | 30 | 0 | 0 | 30 | no |
| `win+marginal` | 30 | 3 | 3 | 24 | no |
| `tie+marginal` | 30 | 3 | 3 | 24 | no |
| `win+tie+marginal` | 30 | 3 | 3 | 24 | no |

The rule's own trace:

```
per-field gate: "win" scored=30 improved=0 regressed=0 tied=30 -> FAIL
per-field gate: "tie" scored=30 improved=0 regressed=0 tied=30 -> FAIL
per-field gate: "marginal" scored=30 improved=3 regressed=3 tied=24 -> FAIL
no single-change arm met the bar — nothing to combine, and no combination was evaluated
```

### Every cell, `control` against `marginal`, regressions first

| Algorithm | Season | Bonus | n | Control mean pred. | Observed | Control Brier | Marginal mean pred. | Marginal Brier | Delta | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| opr | 2026 | supercharged | 26790 | 0.0456 | 0.0886 | 0.063672 | 0.0520 | 0.064418 | +0.000746 | **REGRESS** |
| epa | 2026 | supercharged | 26790 | 0.0456 | 0.0886 | 0.063672 | 0.0520 | 0.064418 | +0.000746 | **REGRESS** |
| bpr | 2026 | supercharged | 30382 | 0.0407 | 0.0811 | 0.058846 | 0.0467 | 0.059476 | +0.000630 | **REGRESS** |
| opr | 2026 | energized | 26790 | 0.5784 | 0.5913 | 0.186335 | 0.5325 | 0.181777 | -0.004559 | improve |
| epa | 2026 | energized | 26790 | 0.5784 | 0.5913 | 0.186335 | 0.5325 | 0.181777 | -0.004559 | improve |
| bpr | 2026 | energized | 30382 | 0.5520 | 0.5768 | 0.197411 | 0.5087 | 0.193987 | -0.003424 | improve |
| opr | 2023 | activationBonus | 23794 | 0.4476 | 0.5876 | 0.232091 | 0.4476 | 0.232091 | +0.000000 | tie |
| opr | 2023 | sustainabilityBonus | 23794 | 0.0539 | 0.2643 | 0.202011 | 0.0539 | 0.202011 | +0.000000 | tie |
| epa | 2023 | activationBonus | 23794 | 0.4476 | 0.5876 | 0.232091 | 0.4476 | 0.232091 | +0.000000 | tie |
| epa | 2023 | sustainabilityBonus | 23794 | 0.0539 | 0.2643 | 0.202011 | 0.0539 | 0.202011 | +0.000000 | tie |
| bpr | 2023 | activationBonus | 27116 | 0.4142 | 0.5655 | 0.240491 | 0.4142 | 0.240491 | +0.000000 | tie |
| bpr | 2023 | sustainabilityBonus | 27116 | 0.0478 | 0.2430 | 0.187905 | 0.0478 | 0.187905 | +0.000000 | tie |
| opr | 2024 | melodyBonus | 24794 | 0.1770 | 0.4107 | 0.246260 | 0.1770 | 0.246260 | +0.000000 | tie |
| opr | 2024 | ensembleBonus | 24794 | 0.0143 | 0.1174 | 0.106816 | 0.0143 | 0.106816 | +0.000000 | tie |
| epa | 2024 | melodyBonus | 24794 | 0.1770 | 0.4107 | 0.246260 | 0.1770 | 0.246260 | +0.000000 | tie |
| epa | 2024 | ensembleBonus | 24794 | 0.0143 | 0.1174 | 0.106816 | 0.0143 | 0.106816 | +0.000000 | tie |
| bpr | 2024 | melodyBonus | 28282 | 0.1613 | 0.3887 | 0.239849 | 0.1613 | 0.239849 | +0.000000 | tie |
| bpr | 2024 | ensembleBonus | 28282 | 0.0127 | 0.1095 | 0.100111 | 0.0127 | 0.100111 | +0.000000 | tie |
| opr | 2025 | autoBonus | 25978 | 0.1959 | 0.6594 | 0.404387 | 0.1959 | 0.404387 | +0.000000 | tie |
| opr | 2025 | coralBonus | 25978 | 0.0081 | 0.1910 | 0.181903 | 0.0081 | 0.181903 | +0.000000 | tie |
| opr | 2025 | bargeBonus | 25978 | 0.2486 | 0.4590 | 0.238178 | 0.2486 | 0.238178 | +0.000000 | tie |
| epa | 2025 | autoBonus | 25978 | 0.1959 | 0.6594 | 0.404387 | 0.1959 | 0.404387 | +0.000000 | tie |
| epa | 2025 | coralBonus | 25978 | 0.0081 | 0.1910 | 0.181903 | 0.0081 | 0.181903 | +0.000000 | tie |
| epa | 2025 | bargeBonus | 25978 | 0.2486 | 0.4590 | 0.238178 | 0.2486 | 0.238178 | +0.000000 | tie |
| bpr | 2025 | autoBonus | 29642 | 0.1790 | 0.6255 | 0.395855 | 0.1790 | 0.395855 | +0.000000 | tie |
| bpr | 2025 | coralBonus | 29642 | 0.0072 | 0.1769 | 0.168798 | 0.0072 | 0.168798 | +0.000000 | tie |
| bpr | 2025 | bargeBonus | 29642 | 0.2279 | 0.4401 | 0.239283 | 0.2279 | 0.239283 | +0.000000 | tie |
| opr | 2026 | traversal | 26790 | 0.0001 | 0.0012 | 0.001228 | 0.0001 | 0.001228 | +0.000000 | tie |
| epa | 2026 | traversal | 26790 | 0.0001 | 0.0012 | 0.001228 | 0.0001 | 0.001228 | +0.000000 | tie |
| bpr | 2026 | traversal | 30382 | 0.0000 | 0.0012 | 0.001214 | 0.0000 | 0.001214 | +0.000000 | tie |

The `win` and `tie` arms are omitted from this table because every one of their 30 cells is bit-identical
to `control`. That is the finding, not an omission.

## Why the marginal arm's reach is far narrower than its label

**This is the most important structural finding in this measurement, and it was discovered by the
measurement rather than assumed.**

Every one of the 34 per-variable declarations says `negative-binomial`, and the resolved-family tally
confirms that the fits genuinely happen: 1,683,332 of 2,418,004 fits resolved to negative binomial.
Yet only **six of the thirty** reporting cells moved at all, and all six are in one season.

The cause is in `analyticPmf.ts`'s `clauseProbability`. That function takes the fitted marginals'
*moments*, sums them across the clause's terms, and then **refits the combined variable as a
hardcoded Gaussian**, discarding the declared and resolved family entirely. Only bonuses whose
predicate is `nestedSameVariable` bypass it — those route through the interval enumeration, which
calls `probAtLeast` on the fitted marginal directly and therefore does honour the family.

Counting `nestedSameVariable` predicates per season gives the whole picture: every season has zero
except the last, which has two. Those two bonuses, across three algorithms, are exactly the six cells
that moved.

**Consequently the resolved-family tally OVERSTATES the arm's reach.** It counts fits *performed*,
not fits *used to produce a published probability*. The tally was introduced precisely so that an arm
labelled negative binomial could not be silently mostly Gaussian — and on this measurement it reports
a 69.62% negative-binomial share for an arm whose published output is Gaussian-derived for 24 of its
30 cells. The mitigation was real and the hazard it was aimed at is real; it simply does not cover
this route.

This is recorded as a finding and **was not acted on here**. Changing `clauseProbability` would be a
re-specification of the model, not an attribution measurement, and it would change what `control`
means mid-flight — the same reason `probAtLeast`'s Gaussian branch carries its own warning against
adding a continuity correction.

## The bar, and why it has no effect-size floor

**D-09, as frozen in code before any figure existed:** one scored cell is one
`(algorithmId, season, bonusName)` triple with at least one observation in both arms. A cell improves
when its Brier is strictly lower, regresses when strictly higher, ties when the two compare equal
exactly. An arm meets the bar when `improved > scored / 2` **and** `regressed === 0`.

**Ties sit in the denominator and help neither side**, so a tie makes the majority harder to reach.
That is the conservative direction and it was chosen deliberately: a change that moves nothing should
not be able to buy a majority out of cells it did not affect. On this measurement that choice is
load-bearing — it is why two arms of thirty ties fail rather than vacuously pass.

**There is no minimum effect size, and that is honest here rather than sloppy.** D-11 declined a
paired-bootstrap interval and said any improvement in the right direction counts. That would normally
be indefensible. It holds in *this* measurement because plan 09-04 deleted the 4,000-draw Monte
Carlo: both arms are exact deterministic computations over the identical observation set, differing
only in the config field under test. The sampling scatter an effect-size floor would guard against is
precisely what the phase removed, so a difference of any magnitude is a real difference and not a
draw of the dice. Were the Monte Carlo ever restored, this reasoning — and therefore this bar —
would stop holding.

Note what this permissiveness did **not** buy the candidate arms. The bar's generosity is all on the
improvement side; its no-regression clause is absolute, and a regression of +0.00063 fails an arm
exactly as surely as a large one would.

## Resolved-family mix

Read from each fitted marginal's **resolved** family, never its declared one, with fallbacks counted
on a separate axis — a declared Gaussian default is not a fallback, and conflating the two would
overstate how much of an arm ran the model its name claims.

| Arm | Negative binomial | Gaussian | Degenerate | Fallbacks | NB share |
|---|---|---|---|---|---|
| `control` | 0 | 2,328,695 | 89,309 | 89,309 | 0.00% |
| `win` | 0 | 2,328,695 | 89,309 | 89,309 | 0.00% |
| `tie` | 0 | 2,328,695 | 89,309 | 89,309 | 0.00% |
| `marginal` | 1,683,332 | 645,363 | 89,309 | 734,672 | **69.62%** |
| `win+tie` | 0 | 2,328,695 | 89,309 | 89,309 | 0.00% |
| `win+marginal` | 1,683,332 | 645,363 | 89,309 | 734,672 | **69.62%** |
| `tie+marginal` | 1,683,332 | 645,363 | 89,309 | 734,672 | **69.62%** |
| `win+tie+marginal` | 1,683,332 | 645,363 | 89,309 | 734,672 | **69.62%** |

**69.62% is below 90%, and that is stated plainly rather than buried.** Roughly three in ten fits
under the negative-binomial arm did not resolve to negative binomial — 645,363 fell back to Gaussian
on the documented fallback ladder, most commonly where the variance does not exceed the mean and a
negative binomial has no valid parameterisation. Read this figure together with the reach finding
above: the label was doubly optimistic, once through the fallback ladder and once through
`clauseProbability` discarding the family altogether.

## Cross-generation panel (engine swap, not on trial)

Plan 09-01's frozen `data/baselines/rp-calibration-2026-09.json` was captured **before** 09-04
replaced the Monte Carlo with the closed form. The difference between it and the `control` arm is
therefore attributable to **the engine swap**, which D-10 ships unconditionally and which is not on
trial. It is reported as free evidence about 09-04's work and never fed to the bar — a test asserts
that the bar's inputs come only from arms measured in this process.

Across 63 comparable cells, 60 moved and 3 are identical. The largest absolute Brier movement is
0.00292885. The engine swap therefore changed published pmf values, as 09-04 said it would, but by
small amounts at the per-bonus level.

**Labelled cross-generation:** the audit's F2 headline recorded pooled predicted 0.1507 against
observed 0.3109 — a 2.06x under-prediction. That figure predates both 09-01's own same-scorer fix and
the engine swap, so it is a starting point for the phase's narrative and not a like-for-like
predecessor of the numbers above.

## F10 — the upstream half

**The upstream cause remains OPEN.** The dot-eligible share — the fraction of alliance-sides whose
predicted probability reaches the 0.5 display threshold — did not move at all, because the shipped
combination reverts everything.

| Algorithm | Season | Bonus | Observed frequency | Dot-eligible, control | Dot-eligible, shipped |
|---|---|---|---|---|---|
| opr | 2025 | autoBonus | 65.94% | 0.11% | 0.11% |
| epa | 2025 | autoBonus | 65.94% | 0.11% | 0.11% |
| bpr | 2025 | autoBonus | 62.55% | 0.30% | 0.30% |

An alliance earned this bonus about two times in three, and roughly one dot in a thousand could
possibly render solid. The audit recorded "under 2.6%"; measured through the published scorer the
real figure is an order of magnitude smaller still.

**The display threshold was not changed and is out of scope for the whole phase.** Only its upstream
cause was in scope, and that cause is not closed — this should be routed back to the ranking-points
audit rather than treated as addressed.

## F6 and F7 — the effects the bar cannot see

Both are **descriptive and neither is a gate**. A tie probability being right on average says nothing
about a bonus Brier, and neither figure may be presented as an accuracy claim.

| Arm | n | Mean abs. (pmf-implied minus published win probability) | Mean predicted tie probability |
|---|---|---|---|
| `control` | 159,067 | 0.036968 | 0.000000 |
| `win` | 159,067 | **0.000000** | 0.000000 |
| `tie` | 159,067 | 0.037331 | **0.008239** |
| `win+tie` | 159,067 | 0.004116 | 0.008239 |

**F6 is fully closed by the `win` arm** — taking the win half from the published win probability makes
the pmf-implied and displayed figures agree exactly, against a legacy mean disagreement of 0.037.
**F7's legacy tie probability is identically zero**, confirming the audit's finding that the
continuous-equality branch can never fire; the discrete-margin branch predicts 0.008239 against the
audit's measured base rate of 1206/110362, or 0.010928.

Both effects are real and both are being reverted, because the bar the phase committed to reads
per-bonus Brier and neither change touches the bonus half.

## The decision

Recorded verbatim from the developer's standing authorization of 2026-09-11:

> "spending through 2026, Approved! D1 work approved, deleting schedule generation approved, R2
> delete approved"

That authorization covers **the spend of the reporting slice, not the verdict**. The verdict was
taken by the pre-committed rule, exactly as frozen, with no override:

- **Win source (D-13): REVERT.** Mechanical verdict: revert. No override.
- **Tie model (D-14): REVERT.** Mechanical verdict: revert. No override.
- **Marginal family (D-01): REVERT.** Mechanical verdict: revert. No override.

The shipped combination is therefore the legacy path on 09-04's closed form:
`winSource=score-draw, tieModel=continuous-equality, marginal=gaussian`.

**There is no deviation from the mechanical verdict**, so there is no override reason to record. The
developer's authorization and the rule's answer are set side by side here deliberately, as they are
required to be even when they agree.

## What this document does not say

- **No claim about winner prediction or match Brier.** Those are level-1 concerns and nothing here
  touches them; the level-1 digest gate is re-run after the collapse to confirm it.
- **No recommendation about F4, F8, F9 or F12.** All are out of scope for the whole phase.
- **No figure from the selection slice is presented as out-of-sample.** The published headline comes
  from the reporting slice alone, and the two are kept under separate headings above with a test that
  checks no season appears under the wrong one.
- **No claim that negative binomial is the wrong distribution for ranking-point thresholds.** What was
  measured is this implementation's reach, which `clauseProbability` limits to one predicate shape.
  A future attempt that fixed that first would be measuring a different thing, and would need a fresh
  reporting slice.

## Machine-readable record

Every figure in the prose above traces to this block, which is generated from
`data/baselines/rp-attribution-2026-09.json`. The sync test
`docs/models/rp-attribution.md cannot drift off the record it describes` in
`scripts/measureRpCalibration.test.ts` deep-equals this block against the digest of the committed
record, so a figure edited here without regenerating it fails loudly.

```json
{
  "measuredAt": "2026-09-11T22:03:19.775Z",
  "command": "npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026 --arms all --attribution-out data/baselines/rp-attribution-2026-09.json",
  "corpusIdentity": {
    "path": "data/corpus.sqlite",
    "sizeBytes": 582705152,
    "mtime": "2026-09-10T02:49:34.635Z"
  },
  "arms": [
    "control",
    "win",
    "tie",
    "marginal",
    "win+tie",
    "win+marginal",
    "tie+marginal",
    "win+tie+marginal"
  ],
  "armConfigs": {
    "control": {
      "winSource": "score-draw",
      "tieModel": "continuous-equality",
      "marginal": "gaussian"
    },
    "win": {
      "winSource": "p-red-win",
      "tieModel": "continuous-equality",
      "marginal": "gaussian"
    },
    "tie": {
      "winSource": "score-draw",
      "tieModel": "discrete-margin",
      "marginal": "gaussian"
    },
    "marginal": {
      "winSource": "score-draw",
      "tieModel": "continuous-equality",
      "marginal": "negative-binomial"
    },
    "win+tie": {
      "winSource": "p-red-win",
      "tieModel": "discrete-margin",
      "marginal": "gaussian"
    },
    "win+marginal": {
      "winSource": "p-red-win",
      "tieModel": "continuous-equality",
      "marginal": "negative-binomial"
    },
    "tie+marginal": {
      "winSource": "score-draw",
      "tieModel": "discrete-margin",
      "marginal": "negative-binomial"
    },
    "win+tie+marginal": {
      "winSource": "p-red-win",
      "tieModel": "discrete-margin",
      "marginal": "negative-binomial"
    }
  },
  "dotThreshold": 0.5,
  "selectionSeasons": [
    2016,
    2017,
    2018,
    2019,
    2020,
    2022
  ],
  "reportingSeasons": [
    2023,
    2024,
    2025,
    2026
  ],
  "reportingCellCount": 240,
  "selectionCellCount": 264,
  "armVerdicts": [
    {
      "arm": "win",
      "scored": 30,
      "improved": 0,
      "regressed": 0,
      "tied": 30,
      "meetsBar": false
    },
    {
      "arm": "tie",
      "scored": 30,
      "improved": 0,
      "regressed": 0,
      "tied": 30,
      "meetsBar": false
    },
    {
      "arm": "marginal",
      "scored": 30,
      "improved": 3,
      "regressed": 3,
      "tied": 24,
      "meetsBar": false
    },
    {
      "arm": "win+tie",
      "scored": 30,
      "improved": 0,
      "regressed": 0,
      "tied": 30,
      "meetsBar": false
    },
    {
      "arm": "win+marginal",
      "scored": 30,
      "improved": 3,
      "regressed": 3,
      "tied": 24,
      "meetsBar": false
    },
    {
      "arm": "tie+marginal",
      "scored": 30,
      "improved": 3,
      "regressed": 3,
      "tied": 24,
      "meetsBar": false
    },
    {
      "arm": "win+tie+marginal",
      "scored": 30,
      "improved": 3,
      "regressed": 3,
      "tied": 24,
      "meetsBar": false
    }
  ],
  "decision": {
    "shipConfig": {
      "winSource": "score-draw",
      "tieModel": "continuous-equality",
      "marginal": "gaussian"
    },
    "acceptedFields": [],
    "revertedFields": [
      "win",
      "tie",
      "marginal"
    ],
    "path": [
      "per-field gate: \"win\" scored=30 improved=0 regressed=0 tied=30 -> FAIL",
      "per-field gate: \"tie\" scored=30 improved=0 regressed=0 tied=30 -> FAIL",
      "per-field gate: \"marginal\" scored=30 improved=3 regressed=3 tied=24 -> FAIL",
      "no single-change arm met the bar — nothing to combine, and no combination was evaluated"
    ]
  },
  "shippedArm": "control",
  "marginalResolution": {
    "control": {
      "negativeBinomial": 0,
      "gaussian": 2328695,
      "degenerate": 89309,
      "fallbacks": 89309
    },
    "win": {
      "negativeBinomial": 0,
      "gaussian": 2328695,
      "degenerate": 89309,
      "fallbacks": 89309
    },
    "tie": {
      "negativeBinomial": 0,
      "gaussian": 2328695,
      "degenerate": 89309,
      "fallbacks": 89309
    },
    "marginal": {
      "negativeBinomial": 1683332,
      "gaussian": 645363,
      "degenerate": 89309,
      "fallbacks": 734672
    },
    "win+tie": {
      "negativeBinomial": 0,
      "gaussian": 2328695,
      "degenerate": 89309,
      "fallbacks": 89309
    },
    "win+marginal": {
      "negativeBinomial": 1683332,
      "gaussian": 645363,
      "degenerate": 89309,
      "fallbacks": 734672
    },
    "tie+marginal": {
      "negativeBinomial": 1683332,
      "gaussian": 645363,
      "degenerate": 89309,
      "fallbacks": 734672
    },
    "win+tie+marginal": {
      "negativeBinomial": 1683332,
      "gaussian": 645363,
      "degenerate": 89309,
      "fallbacks": 734672
    }
  },
  "pooledReporting": {
    "control": {
      "n": 801828,
      "meanPredicted": 0.1721562003731528,
      "observedFrequency": 0.3293898442059893
    },
    "shipped": {
      "n": 801828,
      "meanPredicted": 0.1721562003731528,
      "observedFrequency": 0.3293898442059893
    },
    "fullChange": {
      "n": 801828,
      "meanPredicted": 0.16810215085551986,
      "observedFrequency": 0.3293898442059893
    }
  },
  "f10AutoBonus2025Bpr": {
    "control": 0.003036232372984279,
    "shipped": 0.003036232372984279,
    "observedFrequency": 0.6254638688347615
  },
  "outcomeCoherence": [
    {
      "arm": "control",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.03696791018377215,
      "meanPredictedTie": 0
    },
    {
      "arm": "win",
      "n": 159067,
      "meanAbsPRedWinDiff": 0,
      "meanPredictedTie": 0
    },
    {
      "arm": "tie",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.03733084840111983,
      "meanPredictedTie": 0.008239189427368981
    },
    {
      "arm": "marginal",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.03696791018377215,
      "meanPredictedTie": 0
    },
    {
      "arm": "win+tie",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.0041155362744556,
      "meanPredictedTie": 0.008239189427368981
    },
    {
      "arm": "win+marginal",
      "n": 159067,
      "meanAbsPRedWinDiff": 0,
      "meanPredictedTie": 0
    },
    {
      "arm": "tie+marginal",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.03733084840111983,
      "meanPredictedTie": 0.008239189427368981
    },
    {
      "arm": "win+tie+marginal",
      "n": 159067,
      "meanAbsPRedWinDiff": 0.0041155362744556,
      "meanPredictedTie": 0.008239189427368981
    }
  ]
}
```
