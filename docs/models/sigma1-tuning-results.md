# Sigma1 tuning results, holdout head-to-head, and phase verdicts

**Scheme retirement (2026-09-04): everything below was measured under the now-RETIRED fixed
tune/holdout split.** The shipped scheme is rolling-origin selection (D-T5, quick task
`260901-trz`): hyperparameters for a scored season are selected only on seasons strictly before
it, the promoted version carries per-season parameter sets
(`data/algorithm-versions/vpr@8.0.0+rolling-2026-09b.json` as of this note), and headline
eligibility is derived from each set's own `selectedOnSeasons` provenance rather than a season
list (`packages/harness/score.ts`) — currently 2022, 2025 and 2026 are headline-eligible, and the
live season joins each year once it completes and its preseason-committed set scores it. The
`seasonLabel` tune/holdout vocabulary this document uses is deleted from the code and the
published artifacts. The durable record of the rolling-origin searches and their D-T7 acceptance
verdicts (two runs, 2026-09-03 and 2026-09-04) is
`.planning/todos/completed/retune-sigma1-rolling-origin.md`. Nothing below has been edited — these
are the figures as measured at the time, under the scheme then in force.

**Baseline change (Phase 3.2, 2026-08-21):** OPR now means an event-scoped, qualification-matches-
only fit (matching TBA's own computation), not the season-pooled ridge regression this document
originally measured against. Every OPR figure below has been re-issued against the new baseline.
See `docs/models/opr-baseline-change.md` for the full narrative — why the switch, both baselines'
numbers side by side, and the required framing for what a widened Sigma1 margin does and does not
mean.

**Offseason-inclusive re-measurement (2026-08-30):** every table below was measured on the
offseason-EXCLUDED corpus, before 07-17's `--include-offseason` widening and before the 2026-08-30
demo-team-exclusion and whole-alliance-DQ-zero-score fixes. Nothing below has been edited — this is
what was actually measured at the time. `docs/models/offseason-inclusion-remeasurement.md` is the
dated re-run against the model as it publishes today: **SC-3 still passes 8/8**, with one holdout
season (2025) measurably worse for both EPA and VPR and the other (2026) measurably better,
reported there in full alongside this document's original figures.

**D-T7 acceptance-bar retirement (2026-09-04, quick task 260904-oiu, OBJ-BAR):** every D-T7
acceptance verdict recorded to date — including the ten already-recorded verdicts referenced
throughout `packages/harness/acceptance.ts` and `.planning/todos/completed/retune-sigma1-rolling-origin.md`'s
two rolling-origin search runs — was decided under the RETIRED Brier ship/don't-ship bar
(`sqrt(2 ln N) * SE_paired(Brier delta)`, with score-MAE as a single guardrail veto). Those figures
are left exactly as measured; nothing below has been retro-fitted to the new scheme. Any FUTURE
D-T7 verdict is decided under the accuracy-primary bar instead — `sqrt(2 ln N) *
SE_paired(accuracy delta)` — with Brier demoted to a second guardrail veto alongside score-MAE
(`packages/harness/acceptance.ts`'s own header states the full three-condition rule). No tuning
was re-run as part of this note; a re-tune under the new bar remains a separate, deliberately-
scheduled item.

The committed answer to Phase 3's four questions: did the offline search actually find something
(ALGO-04), does tuned Sigma1 beat OPR and EPA on holdout Brier *and* winner accuracy on both
holdout seasons (SC-3), does within-season adaptation improve holdout score (ALGO-05), and does
predicted ranking-point variance hold up against real matches (ALGO-08). Every EPA/Sigma1 figure in
the `## Holdout Head-to-Head` and `## Tune-Season Result` tables comes from ONE run:

```
pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/tuned-v3
```

`reports/tuned-v3/artifact.json` (gitignored, schema v3, `runTimestamp: 2026-08-17T01:11:06.668Z`)
— `sigma1` resolved (via `packages/harness/cli.ts`'s `applyPromotedOverrides`) to the promoted
`data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json`; `sigma1-defaults` to the Phase-2
defaults (`sigma1Defaults`); `sigma1-adapt` to the adaptation-ON joint search's own winning
candidate (`reports/tune-joint-on.json`, `rpMonteCarloDraws` restored to 2000, `paramSetName:
"tune-joint-on-winner"`). No baseline row in this document was spliced from an earlier run,
corpus, or algorithm version (T-03-16). **OPR's figures below are the exception**: they are
re-issued from a later re-run against the event-scoped baseline
(`data/baselines/opr-event-scoped-2026-08.json`, command and `runTimestamp` in the footer below).
`docs/models/opr-baseline-change.md`'s side-by-side table proves every non-OPR figure in this
document is identical between the two runs to four decimal places, so this substitution changes
nothing except OPR's own numbers.

## What Was Searched

**Screen** (D-03a, 9 of Sigma1's 20 hyperparameters survive `SCREEN_SURVIVAL_THRESHOLD = 1e-4`):

```
pnpm tune --stage screen --seasons 2022,2023 --values 5
```

Full method, per-parameter results table, and the Honesty Register naming three distinct kinds
of screen blindness: `docs/models/sigma1-sensitivity-screen.md`.

**Survivors fed to the joint search** (`reports/sensitivity-screen.json`'s own `survivors`
array): `carryMeanReversion`, `coldStartConsistencyVariance`, `consistencyCarryDecay`,
`consistencyEwmaAlpha`, `covEwmaAlpha`, `covShrinkage`, `linkC`, `processNoiseEventBoundary`,
`processNoiseWithinEvent`.

**Joint search** (D-06, two equal-budget runs over the survivors, tune seasons 2022-2024,
`--evals 60 --seed 42` — both are `tune.ts`'s own defaults, given explicitly here for the record):

```
pnpm tune --stage joint --adaptation off   # -> reports/tune-joint-off.json
pnpm tune --stage joint --adaptation on    # -> reports/tune-joint-on.json
```

Both runs are programmatically confirmed identical on every field except `adaptation`
(`evals: 60`, `seed: 42`, `seasons: [2022,2023,2024]`, `batch: 8`, `survivorsPath:
"reports/sensitivity-screen.json"`, `survivors`, `rejectedCandidates: 1`, `ties: []` — 03-05's own
verification). Both winners are **the same generated candidate** (`refine-76`, index 76 —
identical because both searches share seed 42 and candidate *generation* does not depend on
`--adaptation`; only the *scoring* of each candidate differs), evaluated under the two different
`adaptationEnabled` settings:

| Parameter | Off/on winner value | Search bound `[min, max]` | `atBound` |
|---|---|---|---|
| `processNoiseWithinEvent` | 0.14522 | `[0.05, 5]` (log) | no |
| `processNoiseEventBoundary` | **1** | `[1, 64]` (log) | **yes — sits exactly on the floor** |
| `consistencyEwmaAlpha` | 0.03445 | `[0.02, 0.6]` (linear) | no |
| `covEwmaAlpha` | 0.26000 | `[0.02, 0.6]` (linear) | no |
| `covShrinkage` | 0.12817 | `[0, 0.9]` (linear) | no |
| `linkC` | 1.23983 | `[0.25, 4]` (log) | no |
| `coldStartConsistencyVariance` | 16.75421 | `[1, 64]` (log) | no |
| `consistencyCarryDecay` | 0.41422 | `[0, 1]` (linear) | no |
| `carryMeanReversion` | 0.06930 | `[0, 1]` (linear) | no |

`processNoiseEventBoundary`'s winning value sits exactly on its search bound's floor (1, the
bound's own lower limit) in **both** the off and on joint searches — reported here as `atBound:
true` (`reports/tune-joint-{off,on}.json`'s own field), not silently accepted. **A value on a
bound means the bound was likely too narrow, not that the search converged on an interior
optimum** — the honest reading is that a floor of 1 pts² for the event-boundary process-noise
bump may not be the true minimum the tune-season data would pick if the bound were widened
downward (e.g. to 0.5, matching `processNoiseWithinEvent`'s own floor region). Flagged here per
D-03a's own precedent and repeated in `## Open Items`; not chased further in this plan (D-02/D-08's
"no further searches to change a verdict" discipline extends to this too — widening the bound now,
after seeing the result, would be exactly the figure-shopping this project's methodology forbids).

**Leave-one-season-out overfitting guard** (computed from already-scored data, no extra replay):
the pooled (off) winner matches the LOSO winner in 2 of 3 folds (2022, 2023 held out); the
2024-held-out fold selects a different candidate (index 71 vs. the pooled winner's 76), with a
per-season Brier spread of ~0.0130 for the pooled winner (off) and ~0.0143 for the on search — a
genuine, moderate single-season-sensitivity signal, named rather than hidden. See `## Open Items`.

**Promoted version:** `sigma1@2.0.0+tuned-2026-08` (`data/algorithm-versions/`), promoted from
`reports/tune-joint-off.json`'s winner via `pnpm promote --adaptation off --name tuned-2026-08`
(D-08's default: adaptation-off ships unless a measurement says otherwise — see
`## Adaptation Finding` for whether that default should now be revisited). Digest reproduces
bitwise (`packages/harness/digest.test.ts`).

## Tune-Season Result

**Not a headline claim.** These are the search's own training signal (2022-2024) — tuning was
selected to minimize exactly this number (D-01), so a tune-season improvement over the untuned
defaults says the search worked, never that tuned Sigma1 beats a baseline. That verdict is
`## Holdout Head-to-Head` below, from seasons the search structurally could not see.

| Season | Version | Brier | Winner accuracy |
|---|---|---|---|
| 2022 | sigma1 (tuned) | 0.1636 | 0.7604 |
| 2022 | sigma1-defaults | 0.1691 | 0.7529 |
| 2023 | sigma1 (tuned) | 0.1722 | 0.7415 |
| 2023 | sigma1-defaults | 0.1788 | 0.7299 |
| 2024 | sigma1 (tuned) | 0.1765 | 0.7318 |
| 2024 | sigma1-defaults | 0.1821 | 0.7212 |

Tuned Sigma1 beats the untuned defaults on both Brier and accuracy in every tune season — the
mean tune-season Brier across these three rows, `(0.16356+0.17219+0.17654)/3 = 0.170766`, is
*exactly* `sigma1@2.0.0+tuned-2026-08`'s recorded `provenance.objective` — this harness run's
tune-season figures reproduce the search's own recorded objective to full precision, a
consistency check the search log and this independent full-corpus run both pass.

## Holdout Head-to-Head

The headline table. One shared match stream, one corpus, one run — nothing here is spliced from
a different pass.

| Season | Algorithm | Brier | Winner accuracy |
|---|---|---|---|
| 2025 (holdout) | opr (event-scoped) | 0.2119 | 0.7296 |
| 2025 (holdout) | epa | 0.1932 | 0.7290 |
| 2025 (holdout) | sigma1-defaults | 0.1662 | 0.7539 |
| 2025 (holdout) | **sigma1 (tuned)** | **0.1612** | **0.7657** |
| 2026 (holdout) | opr (event-scoped) | 0.2211 | 0.7530 |
| 2026 (holdout) | epa | 0.1742 | 0.7454 |
| 2026 (holdout) | sigma1-defaults | 0.1554 | 0.7819 |
| 2026 (holdout) | **sigma1 (tuned)** | **0.1531** | **0.7873** |

**Phase-2 starting position** (`02-06-SUMMARY.md`, `03-CONTEXT.md` D-02), for comparison — untuned
Sigma1 already won holdout Brier on both seasons and *lost* holdout winner accuracy on both:

| Season | Sigma1 (untuned) Brier / acc | OPR Brier / acc (season-pooled, retired — preserved unedited) |
|---|---|---|
| 2025 | 0.1662 / 0.7539 | 0.1675 / 0.7618 |
| 2026 | 0.1554 / 0.7819 | 0.1773 / 0.7825 |

*This table intentionally preserves Phase 2's original season-pooled OPR measurement unchanged —
it records what `02-06-SUMMARY.md` actually measured at the time, not a current claim. For the
current event-scoped OPR figures, see the Holdout Head-to-Head table above and
`docs/models/opr-baseline-change.md`.*

This run's `sigma1-defaults` row reproduces the starting position to 4 decimal places on every
figure (0.1662/0.7539 and 0.1554/0.7819, exactly) — confirming this run's baseline is the
identical Phase-2 measurement, not a re-derived approximation. **What tuning bought, legible
against that starting position:** Brier improved further on both seasons (2025: 0.1662 -> 0.1612;
2026: 0.1554 -> 0.1531), and — the number D-01's Brier-steered search was not steering toward and
was flagged as a real risk of *not* closing — **winner accuracy also improved past the untuned
baseline AND past OPR on both seasons** (2025: 0.7539 -> 0.7657, versus event-scoped OPR's 0.7296;
2026: 0.7819 -> 0.7873, versus event-scoped OPR's 0.7530). *(OPR's figures here are the
event-scoped re-run — see the baseline note above and `docs/models/opr-baseline-change.md`.)*

## SC-3 Verdict

D-02's literal reading: tuned Sigma1 must beat **both** OPR and EPA on holdout Brier **and**
holdout winner accuracy, on **both** holdout seasons — evaluated here as four separate yes/no
comparisons per season, eight total.

| # | Season | Comparison | Tuned Sigma1 | Baseline | Result |
|---|---|---|---|---|---|
| 1 | 2025 | Brier vs OPR (event-scoped) | 0.1612 | 0.2119 | **PASS** (lower is better) |
| 2 | 2025 | Accuracy vs OPR (event-scoped) | 0.7657 | 0.7296 | **PASS** (higher is better) |
| 3 | 2025 | Brier vs EPA | 0.1612 | 0.1932 | **PASS** |
| 4 | 2025 | Accuracy vs EPA | 0.7657 | 0.7290 | **PASS** |
| 5 | 2026 | Brier vs OPR (event-scoped) | 0.1531 | 0.2211 | **PASS** |
| 6 | 2026 | Accuracy vs OPR (event-scoped) | 0.7873 | 0.7530 | **PASS** |
| 7 | 2026 | Brier vs EPA | 0.1531 | 0.1742 | **PASS** |
| 8 | 2026 | Accuracy vs EPA | 0.7873 | 0.7454 | **PASS** |

**Overall verdict: SC-3 PASSES — all 8/8 comparisons clear.** Tuned Sigma1 beats both OPR and EPA
on both holdout Brier and holdout winner accuracy, on both holdout seasons. This is the literal
reading (D-02), evaluated exactly as stated, with no comparison reworded or dropped.

**Baseline note (re-issued by Phase 3.2, 2026-08-21):** the OPR figures in the table above are
from the event-scoped re-run, not the season-pooled baseline Phase 3's search was originally
measured against. Event-scoped OPR is a materially weaker opponent than season-pooled OPR
(`docs/models/opr-baseline-change.md`), so the accuracy margin above (2025: +3.61 percentage
points; 2026: +3.43 percentage points) is wider than what Phase 3 originally measured — **that
widening is attributable to the baseline changing, not to any improvement in Sigma1**, whose
promoted parameters stayed bit-frozen across this rewrite (D-10, confirmed by the unchanged digest
gate). Phase 3's original verdict, measured against season-pooled OPR with a narrower margin
(OPR accuracy margin: +0.39 percentage points in 2025, +0.48 in 2026), is preserved dated and
unedited in `docs/models/opr-baseline-change.md`'s retired SC-3 verdict table.

**This was not the anticipated outcome, and that is worth saying plainly.** The Phase-2 starting
position and this plan's own `<objective>` explicitly flagged winner accuracy as "the live gap"
that "D-01's Brier-steered search may not close" — a Brier-only objective was expected to plausibly
buy calibration without moving the step-function accuracy metric at all. It did move it, on both
holdout seasons, past both baselines, and it is reported at exactly the precision measured rather
than rounded up to look more decisive. No parameter, threshold, or objective was changed in
response to this result; it is what the single required run produced.

## Adaptation Finding (ALGO-05)

D-06's best-vs-best holdout comparison: each search's own winning configuration, measured on both
holdout seasons, on both metrics. Both searches ran at **identical budgets** (`evals: 60`,
`seed: 42`, tune seasons `[2022, 2023, 2024]`, `rejectedCandidates: 1`, `ties: []` — confirmed
programmatically equal in 03-05; see `## What Was Searched`).

| Season | Metric | sigma1 (off winner) | sigma1-adapt (on winner) | Adaptation-on delta |
|---|---|---|---|---|
| 2025 | Brier | 0.1612 | **0.1599** | −0.0013 (better) |
| 2025 | Winner accuracy | **0.7657** | 0.7646 | −0.0011 (worse) |
| 2026 | Brier | 0.1531 | **0.1494** | −0.0036 (better) |
| 2026 | Winner accuracy | 0.7873 | **0.7887** | +0.0014 (better) |

**Reading the result:** adaptation-on beats adaptation-off on holdout **Brier on both seasons** —
a modest but *consistent* improvement (−0.0013, −0.0036), the same direction the tune-season
figures already showed (on: 0.169367 vs off: 0.170766, ~0.8% relative, `03-05-SUMMARY.md`).
Winner accuracy is mixed and tiny either way (2025 slightly worse, 2026 slightly better, both
under 0.15 percentage points) — noise-scale, not a signal in either direction. Since D-01's
search objective (and D-06's own comparison basis) is Brier, the load-bearing reading is: **on
this measurement, adaptation improves the metric the search is actually built to optimize, on
both holdout seasons, consistently.**

**A real asymmetry, stated plainly rather than glossed over:** this is *on-untuned* versus
*off-tuned*, not a fully symmetric best-vs-best on adaptation's own terms. The sensitivity screen
(`docs/models/sigma1-sensitivity-screen.md`) ran at `adaptationEnabled: false`, so adaptation's
own five hyperparameters (`adaptationEwmaAlpha`/`Exponent`/`MinFactor`/`MaxFactor`/
`MinObservations`) were bitwise inert during the screen and never survived to the joint search's
candidate set. The on-arm searched the identical 9 shared knobs the off-arm did, while adaptation
itself ran at its untuned defaults throughout. A best-vs-best comparison where adaptation's *own*
knobs were also tuned might show a larger (or smaller) effect than measured here — this
comparison answers "does adaptation help at its default settings," not "does adaptation help at
its own best settings," and the two are not the same question.

**Disposition.** D-08's pre-committed rule: if best-vs-best shows adaptation does not improve
holdout score, it ships disabled with the negative result published as a finding. That is not
what happened here — on Brier, the metric this whole search apparatus is built around, adaptation
shows a small but consistent improvement on both holdout seasons. Per this plan's own guidance,
that outcome is **not** silently converted into flipping the shipped default. Instead: **this is a
named decision to revisit, not a default D-08 supports flipping unilaterally from within this
plan.** The recorded finding is:

- Adaptation-on holdout Brier beats adaptation-off on both 2025 and 2026, by a small,
  measurement-consistent margin (~0.8-2.4% relative).
- Winner accuracy shows no clear signal either way.
- The comparison is on-untuned vs. off-tuned, an asymmetry that could understate adaptation's
  real potential (its own hyperparameters were never searched) as easily as it could be
  incidental.
- **Decision needed** (not made here): whether to (a) promote the adaptation-on winner as the new
  shipped `sigma1` default given this measured Brier improvement, (b) re-run the sensitivity
  screen at `adaptationEnabled: true` first so adaptation's own five hyperparameters get a fair
  individual read before any promotion decision, or (c) hold the current adaptation-off default
  and treat this as a promising but not yet decisive signal. `reports/tune-joint-on.json`'s
  winner remains available, unpromoted, for whichever direction is chosen.
- The code for adaptation stays in the tree behind its `adaptationEnabled` flag either way,
  exactly as D-05/D-08 already specify.

ALGO-05's own wording — "the harness validates adaptation improves holdout score (on vs off)" —
is satisfied by a measured answer in either direction (D-08); this plan produced one: a modest,
consistent, honestly-caveated positive Brier signal, with the promotion decision flagged rather
than made.

## Ranking-Point Prediction (ALGO-08)

**Reconciliation, per season** (`packages/core/algorithms/sigma1/rp/reconciliation.test.ts`,
`03-02-SUMMARY.md`): every season's recomputed bonus flags and summed RP reproduce TBA's own
recorded values across the full played-match population, with four named, measured exceptions —
never hidden, never silently absorbed into a wider tolerance:

| Season | Bonus | Measured gap | Nature |
|---|---|---|---|
| 2022 | Cargo Bonus | ~0.3% | Data artifact (corpus-recorded discrepancy, anticipated) |
| 2024 | Ensemble Bonus | ~7-7.8%, spread across ~185 events | TBA's `ensembleBonusAchieved` does not cleanly reconcile against any tried on-stage-count/points formulation of the literal manual rule |
| 2025 | Auto Bonus | ~2% | TBA's `autoLineRobot{1,2,3}` "No" cannot distinguish "did not leave" from "never enabled," which the manual's rule depends on |
| 2025 | Coral Bonus | ~0.06-0.34% at every tier (plan 03-08) | Fixed in plan 03-08: the coopertition gate incorrectly checked only `own` alliance's `coopertitionCriteriaMet` for an alliance-PAIR condition (both alliances' flags required, same "AND, never OR" pattern 2023's Sustainability Bonus already applied). Previously ~2.6-3.8% at every tier before the fix; the residual dropped roughly 10x (championship tier: 72/2004 -> 5/2004 mismatches, all false positives). See `docs/models/sigma1-rp-verification.md`. |
| 2025 | Barge Bonus | ~4% at base tier (always a false negative) | Unexplained after bracketing every plausible alternate threshold/field |

**Two thresholds corpus-converged, now manual-confirmed.** 2025 Coral Bonus's championship-tier
threshold (converged to 7) and 2026 Energized/Supercharged's District-Championship/Championship
thresholds (converged to 240/360 and 360/500, exact clean boundaries) were bracketed from corpus
evidence in plan 03-02 (D-12: the manual is the authoring source, the corpus reconciliation is the
test). **Plan 03-08's human checkpoint completed the manual-check step this document previously
recorded as open**: a human read 2025 FRC Game Manual §6.5.4, Table 6-2 and 2026 FRC Game Manual
§6.5.3, Tables 6-4/6-5, and reported both sets of converged values as correct as shipped. Full
provenance: `docs/models/sigma1-rp-verification.md`'s `## Threshold Provenance`.

**A separately-documented modeling gap** (`03-03-SUMMARY.md`, D6): three bonuses whose real
achievement condition depends on an alliance-level gating signal `RpThresholdVariable`'s
per-season design does not track (2023 `sustainabilityBonus`, 2024 `melodyBonus`, 2025
`coralBonus`/`autoBonus`) are predicted at their conservative branch — the predicted *probability*
of achieving these bonuses is systematically understated, never overstated (now measured exactly,
not just claimed — `docs/models/sigma1-rp-verification.md`'s `## Conservative-Branch
Understatement`). This affects the worked example below (`autoBonusAchieved` is one of the fields
in the conservative-branch set) — though the worked example's predicted pmf/mean/SD are unaffected
by plan 03-08's coopertition fix, since the fix touches only `parse()`'s recomputed achievement
flags (used for reconciliation), never `predictThresholds()` (the only path the Monte Carlo pmf
draw calls).

**Worked example** — a real 2025 (Reefscape) qualification match, `2025isde1_qm25` (FIRST Israel
District Event 1, match 25; red = frc1690/frc9303/frc5928, blue = frc4661/frc6738/frc5951):

| | Red alliance | Blue alliance |
|---|---|---|
| Predicted RP pmf (`P(RP=0..6)`) | `[0.5845, 0.039, 0, 0.33, 0.044, 0.0025, 0]` | `[0.243, 0.1335, 0, 0.3145, 0.309, 0, 0]` |
| Derived mean | 1.218 | 2.313 |
| Derived SD | 1.514 | 1.599 |
| Actual RP earned | 0 | 5 |
| Actual score | 44 | 98 (blue won) |

Both pmfs sum to 1 within `1e-9` (D-10's own validated invariant). The blue alliance's predicted
distribution correctly places its heaviest mass toward the higher end of the range (mean 2.31,
noticeably above red's 1.22) and blue did in fact earn the higher RP total (5 vs. 0) — but the
predicted distributions are genuinely uncertain (SD > 1.5 for both), not point predictions, and
neither alliance's exact outcome sat at its own distribution's mode. That is the expected shape
of an honest predictive distribution over a small integer outcome, not a miss to explain away.

## Reproducibility (ALGO-06 / SC-5)

`sigma1@2.0.0+tuned-2026-08` — identity `{codeVersion: "2.0.0", paramSetName: "tuned-2026-08"}`,
digest `d1203147feb7b130a085c1a992f83d2577221d8efcfcad6ac22360e1ad4bf8a6` over its recorded
265-match, 3-event 2022 slice (`2022alhu`, `2022azfl`, `2022azva`). Reproduced by:

```
pnpm test -- packages/harness/digest.test.ts
```

which re-runs the version on the committed `packages/harness/fixtures/digest-slice.json` fixture
(or the live corpus, when present — both agree, asserted directly) and asserts the recomputed
digest and headline metrics match bitwise. `.github/workflows/test.yml` runs this check, and the
full suite, on every push and pull request — D-15's guarantee is now enforced by CI, not by
intention (see this plan's Task 1).

## Open Items

Measured but not resolved by this plan — named here rather than left implicit:

- **`processNoiseEventBoundary` sits exactly on its search bound's floor (1)** in both joint
  winners (`## What Was Searched`). Worth widening the bound downward in a future re-tune; not
  chased in this plan to avoid re-running a search in response to its own result.
- **LOSO's 2024-held-out fold selects a different winner** (index 71, vs. the pooled winner's
  index 76), with a per-season Brier spread of ~0.013 (off) / ~0.014 (on) for the pooled winner —
  a genuine, moderate single-season sensitivity, not resolved further here.
- **Adaptation's own five hyperparameters have never been individually tuned** (`## Adaptation
  Finding`) — the screen ran at `adaptationEnabled: false`, so a future screen re-run at
  `adaptationEnabled: true` is the correct way to ask whether adaptation's own knobs are
  separately worth tuning, and whether the ~0.8-2.4% Brier gain measured here would grow.
- **RESOLVED (plan 03-08):** the two 2025/2026 corpus-converged RP thresholds (Coral, Energized/
  Supercharged) are now manual-confirmed — `03-02-SUMMARY.md`'s recommended follow-up is closed.
  See `docs/models/sigma1-rp-verification.md`'s `## Threshold Provenance` for the full disposition
  and cited manual sections.
- **RESOLVED as escalated, not accepted (plan 03-08):** the conservative-branch understatement
  across the three affected bonuses (2023 sustainability, 2024 melody, 2025 coral/auto) is now
  measured exactly (`pnpm rp:conservative-branch`), the "never overstates" half of its claim was
  tested and held, and the human reviewing that measurement declined to accept it as a permanent
  limitation — it is recorded as a named future-phase redesign direction (predict undecidable RPs
  from teams' own historical achievement rates, not a new latent Kalman gating dimension) rather
  than implemented here. The named reconciliation tolerances (2022 Cargo, 2024 Ensemble, 2025
  Auto/Coral/Barge) remain documented, honestly-measured modeling limitations, with 2025 Coral's
  tolerance substantially tightened by plan 03-08's coopertition-gate fix. Full disposition:
  `docs/models/sigma1-rp-verification.md`'s `## Conservative-Branch Understatement` and `##
  Known Reconciliation Tolerances`.
- **The ALGO-06 edge-probe row `unclassified`** (`03-01-PLAN.md`'s `flagged_assumptions`) remains
  unresolved. The planner's reading was that ALGO-06's edge risk is covered by the bitwise-digest
  reproducibility guarantee (D-15, now CI-enforced) plus the T-03-05 threat-register row, but that
  reading was never probe-confirmed, and this plan did not specifically re-run that probe.
- **The adaptation-on promotion decision** (`## Adaptation Finding`) is recorded as a named,
  unresolved decision, not made in this plan.

---
*Phase: 03-tuning-ranking-points-versioning*
*Generated: 2026-08-17, from `reports/tuned-v3/artifact.json` (`pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/tuned-v3`, `runTimestamp: 2026-08-17T01:11:06.668Z`) — EPA/Sigma1 figures throughout this document are from this run, unchanged*
*OPR figures re-issued 2026-08-21 (Phase 3.2), from `data/baselines/opr-event-scoped-2026-08.json` (`pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/event-scoped-v1`, `runTimestamp: 2026-08-21T17:48:49.076Z`)*
*Re-measured under the offseason-inclusive, demo-excluded, DQ-fixed model 2026-08-30 — see `docs/models/offseason-inclusion-remeasurement.md` and `data/baselines/sc3-offseason-inclusive-2026-08.json`; nothing in this document was edited*
