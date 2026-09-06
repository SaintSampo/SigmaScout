# Quick task 260906-6zc: Carry-mean shrinkage sweep — RESULTS

**Verdict: HYPOTHESIS FALSIFIED. Axis closed negative and exhausted.**

Raising `carryMeanReversion` hurts monotonically in every season and every metric. The promoted
low values (0.0693 / 0.0880) are better than every larger value tested, including EPA's frozen
0.40. The axis is not merely unhelpful in the direction tried — arithmetic below shows the
remaining direction cannot close the gap either, so this knob should not be re-proposed.

## Method

Three working-tree arms, each replacing `params.carryMeanReversion` uniformly at the single
prediction-moving site (`sigma1CarryNormalizedRating`, `packages/core/algorithms/sigma1/carryover.ts`),
applied by the committed `patch-arm.cjs` so all three are character-identical except the constant:

| arm | `carryMeanReversion` | note |
|---|---|---|
| baseline | 0.0693 (2023, 2024) / 0.0880 (2025, 2026) | the live promoted `vpr@9.0.0+rolling-2026-09c` |
| r25 | 0.25 | |
| r40 | 0.40 | EPA parity (`EPA_MEAN_REVERSION`, frozen) |
| r60 | 0.60 | |

Each arm: patch -> `npx tsc --noEmit` (clean, 0 errors) -> `pnpm harness --seasons 2022-2026
--algorithm vpr --out reports/carrymean-{arm}-260906` -> `git checkout --` -> confirm
`git status --porcelain` empty for the file. Never two patches held at once.

Scored by the committed `score-carrymean.cjs` against two reused, never-re-replayed baselines:
`reports/rpnoise-baseline-260905` (vpr, the promoted pin) and `reports/autopsy-260905` (epa rows
only). 83,655 matches scored, 0 dropped for any reason other than a tie, in every arm.

## Criteria (pre-committed in PLAN.md before any arm ran)

- **C-1 — FAILED (the hypothesis).** No arm improved winner accuracy on ANY of 2023, 2025 or
  2026. Every arm was worse on every one of them. This is the falsification condition as written.
- **C-2 — 2024 degrades too.** 0.7451 (baseline) -> 0.7448 (r25) -> 0.7429 (r40) -> 0.7404 (r60).
  2024 is not the exception here: it wants the un-shrunk carried mean exactly like every other
  season. This matters — see "What this overturns" below.
- **C-3 — PASSED.** Every arm's 2022 predictions stream is sha256-identical to the baseline's,
  and every 2022 metric is identical to four decimal places (+0.00 SE). 2022 is the cold-start
  season (`isColdStart: index === 0`), so `carrySeason` returns before the carry runs. The patch
  did not leak outside the carry path.
- **C-4 — FAILED (the goal).** No arm beats EPA pooled. VPR's deficit WIDENS with every arm:
  -0.20pt (baseline) -> -0.27 -> -0.42 -> -0.64.
- **C-5 — FAILED for all three arms**, on both legs (accuracy down AND Brier worse).

## Results

### Pooled, all five seasons (n = 83,655)

| series | accuracy | brier | early_acc | d_base_se | d_epa_pt |
|---|---|---|---|---|---|
| baseline | 0.7648 | 0.1587 | 0.7450 | | -0.20 |
| epa | 0.7669 | 0.1634 | 0.7516 | | |
| r25 | 0.7642 | 0.1592 | 0.7428 | -0.42 | -0.27 |
| r40 | 0.7627 | 0.1599 | 0.7397 | -1.44 | -0.42 |
| r60 | 0.7605 | 0.1611 | 0.7356 | -2.97 | -0.64 |

```
RULE_A r25: acc -0.06pt (DOWN), brier +0.000536 (WORSE) -> FAILS
RULE_A r40: acc -0.21pt (DOWN), brier +0.001198 (WORSE) -> FAILS
RULE_A r60: acc -0.44pt (DOWN), brier +0.002391 (WORSE) -> FAILS
```

### Per-season winner accuracy

| season | epa | baseline | r25 | r40 | r60 |
|---|---|---|---|---|---|
| 2022 (control) | 0.7670 | 0.7637 | 0.7637 | 0.7637 | 0.7637 |
| 2023 | 0.7623 | 0.7563 | 0.7550 | 0.7534 | 0.7511 |
| 2024 | 0.7325 | **0.7451** | 0.7448 | 0.7429 | 0.7404 |
| 2025 | 0.7763 | 0.7656 | 0.7647 | 0.7630 | 0.7610 |
| 2026 | 0.7932 | 0.7906 | 0.7900 | 0.7880 | 0.7842 |

Monotone decreasing in all four carry-active seasons. No interior optimum, no crossover, no
season that prefers more shrinkage.

## The finding that matters most

**The early-season slice degrades FASTEST.** Pooled `early_acc` (first 33% of events in
chronological order) falls 0.7450 -> 0.7428 -> 0.7397 -> 0.7356 across the sweep, a steeper
slope than the full-set accuracy in every arm. EPA's early_acc on the same population is 0.7516.

That is the exact slice `reports/autopsy-260905/FINDINGS.md` identified as the seat of EPA's
whole advantage. Diluting VPR's carried mean toward the rookie baseline makes VPR worse
precisely where it was already losing. The carried mean is therefore **informative and
under-used**, not over-dispersed.

## What this overturns

The plan's motivating hypothesis was that VPR's carried means are OVER-DISPERSED (reversion
0.069 vs EPA's 0.40), and that this explained two autopsy signatures the carry-variance work
never explained — VPR being more confident on disagreements (mean `|p-0.5|` 0.065 vs 0.039)
while losing them, and losing the blowout slice 56.1/43.9.

**That explanation is now dead.** If VPR's carried means were over-dispersed, shrinking them
would have helped somewhere. It helped nowhere, and it hurt most in the early window where the
dispersion would have done its damage. The over-confidence and blowout losses must originate
somewhere other than the season boundary.

Read together with the carry-variance results, the whole carry axis is now consistent and
closed:

- **Carried mean** — every season, 2024 included, wants it UN-SHRUNK. Measured here.
- **Carried variance/confidence** — 2025 wants more (Stage 2, +0.41pt); 2024 refuses (0-for-16).
  Net pooled: no ship.

A secondary correction this produces: 2024's reputation as the "pattern-break season that
punishes priors" is too broad. 2024 does not reject the carried mean at all — it tracks every
other season on this axis. Its 0-for-16 record is specifically against extra CONFIDENCE, not
against the prior itself.

## Why the remaining direction is not worth a fourth arm

The only untested direction is LESS shrinkage (reversion -> 0). It cannot close the gap:

- baseline -> r25 is a reversion change of +0.18 (2023/2024) for -0.06pt pooled.
- The remaining move, 0.0693 -> 0, is -0.069 — roughly 38% of that step, in the opposite
  direction.
- Linear extrapolation gives at most **+0.02pt**, about 0.16 baseline-SE units.

Against a 0.20pt pooled deficit that is an order of magnitude short, and it is well inside noise.
The axis is exhausted in both directions. **Do not re-propose `carryMeanReversion`** without a
new mechanism attached — this measurement, not an opinion, is the reason.

## Where the evidence now points

`FINDINGS.md`'s own disagreement slices contain a detail that survives this result and sharpens
it considerably:

| slice | n | EPA share |
|---|---|---|
| Someone's very 1st match | 247 | **48.6% (VPR wins)** |
| Greenest team on field: 1-5 prior matches | 1,850 | **53.6% (EPA wins)** |
| Greenest 6-15 | 2,086 | 52.1% |
| Greenest 16+ | 1,246 | 50.6% (edge gone) |

VPR wins a team's **very first** match and then loses matches 1-5. The cold-start SEED is fine;
the first few UPDATES are where the rating goes wrong. That is a within-season gain problem, not
a boundary problem — and this task has now closed the boundary's mean half while Stage 1-3 closed
its variance half.

The concrete mechanism this implicates: VPR's Kalman gain is `P / (P + R)`, unbounded in [0, 1].
A returning or new team is seeded at the full cold-start variance
(`coldStartConsistencyVarianceRel` 0.0163-0.0321 against a `minConsistencyVarianceRel` floor of
0.00097 — roughly 17-33x the floor), so the gain on that team's first observation is close to 1
and one match very nearly overwrites the rating. EPA cannot do this: its `percent_func` learning
rate is bounded and floors at 0.2, so no single match can dominate a team's estimate.

Over-dispersed ratings in the 1-5-match window is exactly what produces confident-but-wrong
predictions and lost blowout disagreements. **Capping the per-update gain (equivalently, flooring
the observation-noise-to-prior-variance ratio) for a team's first few matches** is untested, is a
within-season mechanism so 2024's confidence veto does not obviously apply, and targets EPA's
winning slices directly. It would need a new inert-at-default knob and would have to earn
promotion.

## Provenance

- Arms: `reports/carrymean-{r25,r40,r60}-260906/` (+ `-run.log` each). All three artifacts report
  the unchanged `9.0.0+rolling-2026-09c` — no version drift, confirmed by the scorer's version
  guard.
- Baselines reused unchanged: `reports/rpnoise-baseline-260905/`, `reports/autopsy-260905/`.
- Instruments: `score-carrymean.cjs`, `patch-arm.cjs` (both committed in this task directory).
- Nothing shipped. No `Sigma1Params` field added, no `SIGMA1_CODE_VERSION` bump, no promotion, no
  republish. `packages/core/algorithms/sigma1/carryover.ts` was reverted after each arm and is
  clean.
