---
task: VPR simplification stab — Stage 1 results
date: 2026-09-07
status: measurement complete; no code change proposed for promotion
---

# Stage 1 results: 11 of 19 searched parameters cost nothing to delete

## Headline

Measured on **2026 winner accuracy** (18,403 matches / 214 events, replay
2024→2025→2026 carrying state, scoring 2026 only), against the shipped
`vpr@10.0.0+rolling-2026-09d` 2026 parameter set:

- **Two parameters are provably incapable of changing winner accuracy** — not
  "flat within noise", algebraically zero. One of them is the **top-ranked
  survivor of the existing sensitivity screen.**
- **Eleven of nineteen searchable parameters can be pinned at identity with
  zero net accuracy cost.** The `minimal` configuration lands on exactly the
  shipped model's accuracy with 8 live parameters instead of 19.
- **The whole adaptation subsystem is inert** — 5 numeric parameters, a
  boolean, a state field and a module — while *enabled* on 2026.
- **`attributionShrinkage` is a real lead**: monotone across its full bound,
  worth **+0.00213** at 0.9, putting VPR ahead of EPA on 2026 by +1.01σ — a
  lead the size of its own uncertainty, not a win.
- On 2026 alone, shipped VPR and EPA are a **dead heat**: 0.79270 vs 0.79291,
  a −0.00022 gap against a paired SE of 0.00192 (0.11σ). The −0.204pt deficit
  that motivated yesterday's work is a multi-season aggregate, not a 2026 fact.

## Why the existing screen pointed the wrong way

`tune.ts --stage screen` decides which knobs enter the joint search. It runs on
**2019/2020**, against **Brier**, around **default** parameter values. All three
are wrong for this question, and the cost is concrete: it ranked `linkC` the
single most important parameter of nineteen (Brier range 2.72e-2, ~3x the next),
and `linkC` cannot change a single winner call.

## The invariance theorem

`linkFunctions.ts:113`, the `predictive-variance` link the shipped model uses:

```ts
return logistic(margin / (c * Math.sqrt(predictiveVariance)));
```

`logistic(x) > 0.5` exactly when `x > 0`. Both `c` and `sqrt(predictiveVariance)`
are strictly positive, so the sign of that argument **is** the sign of `margin`.
And `index.ts:1162-1163` computes `margin = redScore - blueScore` from the belief
**means** alone, while the folded covariance enters only through
`predictiveVariance`.

Therefore: **winner accuracy is exactly invariant to `linkC` and to every
parameter entering only via `predictiveVariance`.**

Confirmed empirically and jointly. Sweeping `linkC` across its full 16x bound
[0.25, 4] moved 2026 Brier 0.14316 → 0.21217 (a 48% degradation) with winner
accuracy **bitwise identical at every point** and a paired SE of exactly 0.
Same for `covEwmaAlpha`. The `pin-variance` combo (both pinned at once) is also
bitwise identical in accuracy.

This splits `Sigma1Params` cleanly:

| set | touches | effect on accuracy |
|---|---|---|
| **margin parameters** | belief means, via the Kalman gain | can change winner calls |
| **variance parameters** | predictive spread only (`linkC`, `covEwmaAlpha`, `covShrinkage`, RP/display family) | **provably zero** |

The variance set does not belong in an accuracy-first joint search at all. It
belongs in a separate 1-D calibration fit, which cannot trade against accuracy
and costs one cheap pass.

## One-at-a-time sensitivity, 2026 accuracy

`span` = accuracy range across the knob's entire registered bound. `SE` = the
largest event-blocked **paired** standard error observed on that knob (paired,
because two configs differing in one parameter produce highly correlated
prediction streams and an unpaired SE would hide real effects).

| knob | acc span | paired SE | span/SE | reading |
|---|---|---|---|---|
| `covEwmaAlpha` | 0.00000 | 0.00000 | — | provably dead |
| `linkC` | 0.00000 | 0.00000 | — | provably dead |
| `carryMeanReversion` | 0.02132 | 0.00237 | 9.0 | live, one-sided → wants 0 |
| `carryVarianceFactor` | 0.01564 | 0.00244 | 6.4 | live, one-sided → wants 1 |
| `carryEvidenceRate` | 0.01011 | 0.00163 | 6.2 | live, one-sided → wants 0 |
| `processNoiseWithinEventRel` | 0.00481 | 0.00095 | 5.0 | live, wants LARGER |
| `consistencyEwmaAlpha` | 0.00771 | 0.00183 | 4.2 | live |
| `coldStartConsistencyVarianceRel` | 0.00804 | 0.00194 | 4.1 | live |
| `consistencyCarryDecay` | 0.00536 | 0.00148 | 3.6 | live, one-sided → wants 1 |
| `processNoiseEventBoundaryRel` | 0.00563 | 0.00195 | 2.9 | live, wants LARGER |
| `carryPriorYearShare` | 0.00257 | 0.00124 | 2.1 | weak |
| `adaptationMaxFactor` | 0.00066 | 0.00033 | 2.0 | noise |
| `attributionShrinkage` | 0.00202 | 0.00114 | 1.8 | **monotone lead** |
| `adaptationExponent` | 0.00126 | 0.00074 | 1.7 | noise |
| `adaptationMinFactor` | 0.00082 | 0.00056 | 1.5 | noise |
| `adaptationEwmaAlpha` | 0.00049 | 0.00053 | 0.9 | dead |
| `adaptationMinObservations` | 0.00022 | 0.00040 | 0.6 | dead |
| `minConsistencyVarianceRel` | 0.00044 | 0.00082 | 0.5 | dead |
| `maxTeamKalmanGain` | 0.00049 | 0.00147 | 0.3 | dead |

### The carry-damping family is optimal switched off

The three highest-ranked knobs are all **one-sided**: their large spans come
from bounds that reach into badly-wrong territory, not from a delicate interior
optimum. Every one is best at its identity value.

- `carryVarianceFactor` best at **1** (no inflation); 0.05 costs −0.01564.
- `carryEvidenceRate` best at **0** (no decay); 0.03 costs −0.01011.
- `carryMeanReversion` best at **~0**; 1.0 costs −0.02159, and 0 vs the shipped
  0.088 is −0.00027, inside noise.
Three parameters exist to damp the season carry, and all three want to be
silent. This independently reproduces quick task 260906-6zc's finding that the
carried mean is **under-used, not over-dispersed** — reached there by a Brier
sweep on other seasons, here by an accuracy sweep on 2026.

**One loose end, flagged rather than smoothed over.** `carryPriorYearShare` is
mildly *better* at 0 (+0.00087) — that is, weakly in favour of carrying LESS
prior-year weight. At 0.7σ it is not distinguishable from noise, but the
direction sits oddly beside `carryMeanReversion` wanting 0, which says keep the
carried value untouched. Both parameters pull toward `EPA_ROOKIE_BASELINE` by
different routes (`carryover.ts:128`), so a weak "carry less" and a strong
"don't revert" may be describing the same surface from two directions, or may
be a genuine tension. Stage 2 should resolve it explicitly rather than let the
tidy version of the story stand.

### Adaptation contributes nothing, while enabled

All five numeric adaptation knobs, swept across their entire bounds, produce
deltas within ±0.00126; the best single point is +0.00044 at 0.8σ. 2026 ships
`adaptationEnabled: true`, so this is the live configuration, not a disabled
path.

Note this is the gap flagged earlier in the session: the five adaptation
numerics measured range **exactly 0** in the 2019/2020 screen because that
screen runs with adaptation **off**, so they were never tuned. This probe is
the first time they have been measured where they actually operate — and the
answer is that the mechanism does not earn its parameters.

### The two knobs added on 2026-09-06 do not hold up on 2026

Recorded plainly because they are this author's own work from the previous
session:

- **`maxTeamKalmanGain` is the weakest knob of all nineteen** (0.3σ). Values
  0.54 → 1.0 are *bitwise identical*: the cap never binds, because real Kalman
  gains never exceed 0.54. Roughly half its registered bound is a no-op.
- **`attributionShrinkage` is the opposite and is the one genuine lead.**
  Monotone increasing across all five sweep points, reaching **+0.00202** at
  0.9 — larger than the entire EPA gap. Yesterday's tuner rejected it for 2026
  while a direct sweep finds it wants the top of its bound.

## Joint pin test

Leave-one-out cannot rule out that individually-flat knobs matter *together*.
Every pin below is the knob's **identity** value — the behaviour left after the
field is deleted and its mechanism hardcoded off — not its `DEFAULT_SIGMA1_PARAMS`
value. Those differ and the difference matters: `carryMeanReversion`'s default
is 0.4, but deleting mean reversion leaves 0.

Both references carry their own paired standard error. The config-vs-EPA
interval is measured directly rather than derived from the config-vs-baseline
and baseline-vs-EPA intervals — those two deltas share the baseline's own
prediction stream, so they are correlated and their standard errors do not
combine.

| config | knobs removed | accuracy | Δ vs shipped | SE | Δ vs EPA | SE | σ vs EPA | Brier |
|---|---|---|---|---|---|---|---|---|
| baseline (shipped) | 0 | 0.79270 | — | — | −0.00022 | 0.00192 | −0.11 | 0.14316 |
| EPA | — | 0.79291 | +0.00022 | 0.00192 | — | — | — | 0.14456 |
| `pin-variance` | 2 | 0.79270 | **+0.00000** | **0.00000** | −0.00022 | 0.00192 | −0.11 | 0.15527 |
| `no-adaptation` | 6 | 0.79226 | −0.00044 | 0.00062 | −0.00066 | 0.00192 | −0.34 | 0.14345 |
| `pin-dead` | 8 | 0.79209 | −0.00060 | 0.00060 | −0.00082 | 0.00192 | −0.43 | 0.14356 |
| `pin-carry-damping` | 3 | 0.79242 | −0.00027 | 0.00049 | −0.00049 | 0.00191 | −0.26 | 0.14286 |
| **`minimal`** | **11** | **0.79270** | **+0.00000** | 0.00069 | −0.00022 | 0.00193 | −0.11 | 0.15536 |
| **`minimal+shrink`** | 11 | **0.79483** | **+0.00213** | 0.00114 | **+0.00191** | 0.00189 | **+1.01** | 0.15444 |
| `baseline+shrink` | 0 | 0.79472 | +0.00202 | 0.00114 | +0.00180 | 0.00185 | +0.98 | 0.14224 |

**On the EPA comparison, read the sigma column and not the sign.** The two
shrinkage configurations are ahead of EPA on 2026, and as far as this project's
records go that is the first time any VPR configuration has led EPA on the
current season. But **+1.01σ is not a win** — it is a lead the size of its own
uncertainty, on one season. Treat it as a direction worth pursuing in Stage 2,
not as a result.

The Brier degradation in every `pin-variance` row is entirely `linkC` pinned to
1 instead of its tuned 0.52 — the calibration constant, refit separately.
`baseline+shrink` leaves it tuned and Brier *improves* to 0.14224.

## Deletion list

### A — remove from the joint search, keep as calibration (2)

Provably accuracy-invariant. These are not model parameters; they map a
variance to a calibrated probability, and the site publishes those
probabilities. Fit them in a 1-D pass against Brier *after* the accuracy
search, where they cannot consume search budget or trade against accuracy.

- `linkC`
- `covEwmaAlpha` (`covShrinkage` is already search-excluded and is the same class)

### B — delete the field and hardcode the mechanism off (11)

| field | evidence |
|---|---|
| `adaptationEnabled` | whole subsystem −0.00044 (0.7σ) |
| `adaptationEwmaAlpha` | 0.9σ over full bound |
| `adaptationExponent` | 1.7σ, best point negative |
| `adaptationMinFactor` | 1.5σ |
| `adaptationMaxFactor` | 2.0σ, best point +0.00005 |
| `adaptationMinObservations` | 0.6σ |
| `maxTeamKalmanGain` | 0.3σ; never binds above 0.54 |
| `minConsistencyVarianceRel` | 0.5σ; every value negative |
| `carryVarianceFactor` | optimal exactly at identity 1 |
| `carryEvidenceRate` | optimal exactly at identity 0 |
| `carryMeanReversion` | optimal at ~0; identity costs 0.55σ |

Deleting all eleven together costs **exactly zero** 2026 accuracy (`minimal`).
Also removes `adaptation.ts`, the `InnovationStats` state field, and one
`Sigma1State` shape concern.

`consistencyCarryDecay` is a **twelfth candidate** not tested here: 2026 already
ships it at its identity value of 1, so deleting it is free on 2026 by
construction. Other seasons use 0.414 and 0.120, so it is a multi-season
question rather than a 2026 one.

### C — keep (6, plus the lead) — the actual core

`processNoiseWithinEventRel`, `processNoiseEventBoundaryRel`,
`consistencyEwmaAlpha`, `coldStartConsistencyVarianceRel`,
`consistencyCarryDecay`, `carryPriorYearShare` — plus `attributionShrinkage`,
which is the only knob in the whole set with an unexploited gain.

Both process-noise terms want to be **larger** than shipped, and the
`processNoiseEventBoundaryRel > processNoiseWithinEventRel` invariant is
**binding** — the top of the within-event bound was skipped as invalid, so the
optimum may sit at or beyond a constraint the search cannot currently reach.
That is worth its own look in Stage 2.

## What Stage 1 does NOT establish

Stated explicitly so none of the above gets over-read:

1. **One season.** Everything here is 2026. Other seasons plainly use these
   knobs differently — 2022's promoted set carries `carryMeanReversion` 0.229
   and `attributionShrinkage` 0.844. A deletion that is free on 2026 is not yet
   shown free on 2022–2025.
2. **Not a re-tune.** `minimal+shrink` is the *shipped* values with pins
   applied, not an optimum for the reduced set. A properly re-tuned 8-parameter
   model should do better than +0.00213, not worse — but that is a prediction,
   not a measurement.
3. **`attributionShrinkage: 0.9` sits at the bound edge.** The true optimum may
   be beyond 0.9; the bound needs widening before anyone reads 0.9 as "the
   answer."
4. **Beating EPA on 2026 is one season at roughly 1σ.** It is not a claim that
   VPR beats EPA.

## Recommended Stage 2

1. Re-run this probe on origins 2022–2025 before deleting anything, to confirm
   the deletions hold outside 2026.
2. Delete category B; move category A out of the search into a post-hoc
   calibration fit.
3. Widen `attributionShrinkage`'s bound past 0.9 and revisit the process-noise
   ordering constraint.
4. Re-tune the ~7 survivors on 2024+2025 with a real optimizer (CMA-ES) against
   a smooth accuracy-aligned surrogate, at a budget far above 67 evaluations.
5. Rebuild the incumbent before any acceptance comparison — the current one is
   in-sample on 2023/2024 and self-declared stale.

## Artifacts

- `probe.ts` — the measurement script (sweep + combos modes)
- `reports/v1s-sensitivity-2026.json` / `.log` — 96-config sweep
- `reports/v1s-combos-2026.json` / `.log` — joint pin test
- `reports/v1s-combos-vs-epa-2026.json` / `.log` — same, paired against EPA
