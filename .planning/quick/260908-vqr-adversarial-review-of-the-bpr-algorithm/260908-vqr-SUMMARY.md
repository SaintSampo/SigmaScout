---
task: adversarial-review-of-the-bpr-algorithm
quick_id: 260908-vqr
status: complete
date: 2026-09-08
type: analysis
depends_on:
  - 260908-b4t-fresh-2023-blind-model
  - 260908-pcm-bpr-display-only-phase-components
read_only_model: true
verdict: "78.05% is honest (recounts to 77.97%); the ~3pp lead is not (it is +1.79pp over VPR, +1.17pp over EPA)"
honest_holdout_accuracy: 0.7797
honest_gap_vs_vpr_pp: 1.79
honest_gap_vs_epa_pp: 1.17
recount_artifact: reports/260908-vqr-fourway/artifact.json
---

# Adversarial review of BPR

## Verdict

**The number is honest. The margin is not.**

Recounted under the shared harness -- one match set, identical denominators, the
same D-Q3 rules every other algorithm is scored by -- BPR's 2023-2026 accuracy is
**77.97%** against a sealed 78.05%. **Overstated by 0.08pp**, fully decomposed:

```
78.05%   sealed research model, data.ts population, half-credit convention
78.04%   shipped port, same population            (-0.01  port drift)
77.97%   shipped port, shared harness rules       (-0.07  convention + population)
```

The firewall held. Params sealed 2m16s before the holdout ran, exactly one
revision of `frozen-params.json`, all three refusals fire when invoked, and a
full-state replay of 4,000 real corpus matches through the shipped port finds
**zero** outcome leakage -- first differing prediction *and* first differing
serialized state both land one match after the flip.

**The ~3pp lead does not survive.** Under one harness:

| comparison | design 2016-2022 | holdout 2023-2026 | holdout ex-2024 |
|---|---|---|---|
| BPR - VPR | +3.05pp | **+1.79pp** [1.48, 2.11] | +1.25pp |
| BPR - EPA | +2.60pp | **+1.17pp** [0.87, 1.49] | **+0.50pp** |

The ~3pp figure is BPR's margin on **the seasons it was tuned on**. That the
margin shrinks by ~1.5pp out of sample is textbook and expected -- the ordering
that looked "backwards" is in fact the normal one. Both holdout gaps still
exclude zero under an event-clustered bootstrap, so the lead is real, just
smaller.

Two things make it smaller still. It is **carried by one season**: ex-2024 the
EPA gap is +0.50pp. And there is one slice where BPR **loses** -- championship
events (n=5,820), where it trails EPA by 1.84pp.

**What survives every attack is Brier.** Holdout 0.1487 vs VPR 0.1696 and EPA
0.1929, and BPR is best-calibrated in every season, every comp level, and every
event-size bucket *including the champs bucket where its accuracy is worst*.
BPR's defensible claim is calibration, not winner accuracy.

## Findings that move the number

Full table of 32 classified hypotheses in `260908-vqr-REVIEW.md`. The ones with
headline impact:

- **F-02 / F-03 (CONFIRMED).** The lead is +1.17-1.79pp, not ~3pp, and ex-2024
  the EPA gap is +0.50pp. This is the review's main result.
- **F-22 (CONFIRMED).** "+3.22pp over a naive additive baseline" is inflated:
  `ablate.ts:44-58` builds that baseline with `seasonShrink: 0`, denying it
  cross-season carryover, which the same table prices at +1.80pp. The structural
  claim is worth **~1.4pp**, not 3.22pp -- and F-23 shows even that is an upper
  bound, since ablations hold every other parameter at the full model's optimum.
- **F-19 (CONFIRMED).** The 0.31pp selection bar assumed independent matches.
  Measured design effect on the design era is **1.45x**, so the honest bar is
  ~0.45pp. The parsimony decision survives (F-20, it is further inside than
  before) but anti-additivity's -0.47pp delta now sits 0.02pp from the bar
  (F-21, PLAUSIBLE -- ablation deltas are paired and I measured only marginal SE).
- **F-06 (CONFIRMED).** EPA is `6.0.0+baseline` and has never been tuned;
  `data/algorithm-versions/` holds VPR files only. "BPR beats EPA" is a
  tuned-vs-untuned comparison and must not be quoted as evidence about tuning.
  VPR *is* promoted (`11.0.0+rolling-2026-09g`), so that comparison is fair.
- **F-24 (CONFIRMED overstated).** "An independent search on 2016-2019
  rediscovered w2=0.7, w3=0.5 exactly" -- 2016-2019 is 63,667 of 82,946
  design-era matches (**76.8% overlap**), the grid is coarse (5 x 6 points), and
  the two searches disagree on >= 10 of 23 parameters. The two that matched were
  reported; the ten that did not were not.
- **F-16 (CONFIRMED, no effect).** `SLICE-2023-wk0-1.txt` is real holdout data,
  and it seeded `22ad2035` "heteroscedastic observation noise, diagnosed from
  2023 wk0-1". But it postdates the sealed run and the knob is inert at default,
  absent from `frozen-params.json`, never promoted. **The shipped model is
  unchanged.** The honest framing: the holdout is now spent twice -- evaluated,
  then mined for diagnostics.

Notable **KILLED** hypotheses, each with proof rather than silence: state
leakage (F-11), match ordering (F-10 -- 15 inversions, none within an event),
carryover asymmetry (F-30 -- EPA and VPR both carry; only OPR starts cold), port
drift (F-28 -- -0.010pp), the `normCdf` fix touching the holdout (F-18 -- zero
dead-even matches exist in 2023-2026, reproduced independently), and the "five
rejected ideas were pinned not searched" worry (F-25 -- `tune.ts`'s grid searches
all five).

## Top three proposals

All respect: spent holdout, no ensembling, inert-at-default knobs, Rule A, no
GBDT. None adds a fifth algorithm, so the `compare` artifact's 93.2%-of-ceiling
is untouched.

1. **Close the championship deficit.** Make the anti-additivity weights respond
   to the alliance's own rating spread instead of being global constants, inert
   at default. This is BPR's *only measured* deficit (champs: BPR 74.67 vs EPA
   76.51) and it sits on the axis the model's novelty lives on. At champs every
   alliance member is strong, so rank-suppressing the 2nd and 3rd over-corrects.
   Bounded upside ~+0.15pp pooled, but it removes the one embarrassment.
   Evaluable entirely on 2016-2022. **Spends no holdout.**

2. **Re-derive the selection bar, then re-audit anti-additivity.** Re-run
   `ablate.ts` emitting per-match predictions and bootstrap each ablation delta
   paired by `matchKey` over event blocks. Cheap, and it is the prerequisite for
   proposal 1 -- building on an axis before knowing whether it is load-bearing is
   backwards. **Spends no holdout.**

3. **Unify BPR's measurement path.** Point `evaluate.ts` at `accuracyCall` and
   `data.ts` at `selectMatchesChronological`, and extend `holdout.ts`'s
   `assertCommitted` to cover `model.ts` (F-15: the seal pins parameters, not
   the model, and `model.ts` did change twice post-holdout). No accuracy gain --
   it *lowers* the design figure to ~72.87 -- but it retires three findings
   permanently and makes every future BPR number directly comparable.

Also worth doing: **understand 2024 before banking it** (analysis only, on
existing artifacts). BPR's whole pooled EPA lead rests on that season. Leading
hypothesis: EPA and VPR both predict by summing components while BPR models the
total directly, so a season whose scoring concentrates in one component hurts
them and not BPR. If it holds, that is a durable argument for BPR's design and a
standing reason to reject any component-predicting BPR variant.

## Read-only guarantee - checked

`git status` and `git diff HEAD` confirm **`packages/bpr/frozen-params.json` is
untouched** (still exactly one commit, `a66688af`). No model file was modified.
No artifact was republished, no R2 write occurred, the holdout was not re-run,
and no parameter was changed. The single production edit is the harness registry
line, committed on its own as `4c3d16d8`; it adds no model code and breaks
nothing (`packages/harness`: 44 files / 1073 tests pass).

Baseline before any conclusion was drawn:
`npx vitest run packages/bpr packages/core/algorithms/bpr.test.ts packages/core/scoring`
-> 6 files / 52 tests passed, green in isolation.

## Files

- `260908-vqr-REVIEW.md` -- the full review: 32 classified findings, per-angle
  working, ranked proposals, and what could not be settled
- `recount-output.txt` / `equivalence-output.txt` / `edge-output.txt` -- measured evidence
- `scripts/` -- population-and-ordering, leakage-probe, recount-and-bootstrap, where-the-edge-lives
- `reports/260908-vqr-fourway/` -- the four-way replay (gitignored)
