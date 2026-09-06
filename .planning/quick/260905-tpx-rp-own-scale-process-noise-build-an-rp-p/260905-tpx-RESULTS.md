# 260905-tpx: RP own-scale process noise — measurement and verdict

## Motivation

`.planning/todos/pending/rp-process-noise-own-scale.md` records that RP's three process-noise
parameters (`rpProcessNoiseWithinEvent`, `rpProcessNoiseEventBoundary`, `rpColdStartVariance`)
were pinned to fixed absolute constants during the `SIGMA1_CODE_VERSION` 4.0.0 reparameterization
— dimensionally safe, but not dimensionally principled, since a threshold variable's process
noise arguably should scale with that variable's own measured spread rather than a single
constant shared across every season's differently-scaled game pieces. The todo names the real
reason this sits at `low` priority rather than merely deferred: D-01's tuning objective (Brier
over predicted win probability) is structurally blind to the RP pmf, so no objective exists that
could evaluate a change to these three parameters at all — they sit in `SEARCH_EXCLUSIONS` for
exactly that reason. This task builds that missing objective (an RP-pmf log-loss scorer),
baselines the live model under it, and A/B's the own-spread-relative form as a reverted
working-tree experiment.

## Measured reference spreads (Instrument B — `measure-rp-spread.ts`)

Per-season-per-threshold-variable population variance of each rating-eligible teammate's
per-team SHARE of that alliance-variable's observed sum, folded exactly as
`foldRpObservation` folds `rpVariableMean` (once per rating-eligible teammate, walk-forward
order by `sort_time`):

| season | variable | count | mean | population variance (m2/count) | sqrt(variance) |
|---|---|---|---|---|---|
| 2022 | autoCargoTotal | 72246 | 0.902652 | 0.382386 | 0.618374 |
| 2022 | endgamePoints | 72246 | 4.815547 | 10.238915 | 3.199830 |
| 2022 | matchCargoTotal | 72246 | 5.149545 | 10.320848 | 3.212608 |
| 2023 | linkPoints | 81235 | 4.195728 | 9.852675 | 3.138897 |
| 2023 | totalChargeStationPoints | 81235 | 8.250976 | 11.630189 | 3.410306 |
| 2024 | endGameTotalStagePoints | 84724 | 1.672655 | 1.379148 | 1.174371 |
| 2024 | ensembleBonusOnStageRobotsThreshold | 84724 | 0.667627 | 0.000319 | 0.017863 |
| 2024 | ensembleBonusStagePointsThreshold | 84724 | 3.338133 | 0.007977 | 0.089313 |
| 2024 | melodyBonusThresholdCoop | 84724 | 5.258392 | 0.347762 | 0.589713 |
| 2024 | melodyBonusThresholdNonCoop | 84724 | 6.283391 | 0.445670 | 0.667585 |
| 2024 | noteCount | 84724 | 4.800434 | 4.757942 | 2.181271 |
| 2024 | onStageRobotCount | 84724 | 0.315896 | 0.095685 | 0.309331 |

All three seasons: `skippedRowCount=0` (every played, non-offseason `qm` row with a breakdown
parsed cleanly on both sides).

**Reference aggregates** over every 2022-2024 (season, variable) pair:

- WEIGHTED (observation-count-weighted mean of population variances): **3.964037** — the one
  the patch uses, since `2024`'s seven low-spread indicator variables (0.000319-4.757942) would
  otherwise be counted equally against `2022`/`2023`'s three high-spread variables
  (9.85-11.63), even though 2024 alone contributes more raw observations.
- UNWEIGHTED (simple mean across the 12 (season, variable) pairs): 4.121626.

**Derived relative constants** (`default / reference`):

| constant | default | WEIGHTED (used) | UNWEIGHTED (comparison only) |
|---|---|---|---|
| within-event | 0.5 | 0.1261340319 | 0.1213113341 |
| event-boundary | 8 | 2.0181445097 | 1.9409813460 |
| cold-start | 25 | 6.3067015929 | 6.0655667061 |

The derivation choice (weighted vs. unweighted) moves each constant by roughly 4%, small
relative to the log-loss deltas measured below.

## Instrument A validation (stale autopsy stream)

`node score-rp-logloss.cjs --series autopsy=reports/autopsy-260905`: exited 0, `outOfRange=0`
every season, `droppedNoCorpusRp=21` in 2024 / `0` elsewhere, exactly one `vpr` version
(`8.0.0+rolling-2026-09b`) — confirming the join before any replay was spent, and confirming
the autopsy stream is stale relative to the live `9.0.0` promoted set (as the interface facts
predicted).

## Log-loss epsilon and zero-mass reporting

`LOG_LOSS_EPSILON = 1e-6`. Per observation, log-loss is `-ln(max(pmf[actualRp], epsilon))`,
with a missing index or non-finite value treated as mass `0`. The epsilon sets the ceiling on
how bad a single calibration failure can look (`-ln(1e-6) ≈ 13.8`) — without a floor, one
genuinely zero-mass prediction on an actual outcome would score `+Infinity` and poison every
mean it entered. `zeroMass` (predicted mass exactly `0`) is counted and reported SEPARATELY
from the mean, never folded in silently, because a rising zero-mass count and a rising mean
log-loss are different failure signatures (the former is "flatly ruled out," the latter is
"still assigns something, just less").

## Commands run (all replays reused across scoring passes)

```
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-baseline-260905
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-control-260905   # under Patch C
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-ownscale-260905  # under Patch X

node score-rp-logloss.cjs --series autopsy=reports/autopsy-260905
node score-rp-logloss.cjs --series baseline=reports/rpnoise-baseline-260905
node score-rp-logloss.cjs --series control=reports/rpnoise-control-260905,ownscale=reports/rpnoise-ownscale-260905,baseline=reports/rpnoise-baseline-260905
node score-rp-logloss.cjs --series baseline=reports/rpnoise-baseline-260905,control=reports/rpnoise-control-260905,ownscale=reports/rpnoise-ownscale-260905

npx tsx measure-rp-spread.ts
```

All three replays report the identical `vpr` `algorithmVersion` — `9.0.0+rolling-2026-09c` —
proving the same promoted parameter set ran in all three cases and no version bump or
parameter-file change leaked in alongside a patch.

## Why the control run exists

The live promoted set (`vpr@9.0.0+rolling-2026-09c.json`) runs 2023/2024 at legacy tuned
absolutes (`0.14522393520915602 / 1 / 16.75421168559074`) and 2022/2025/2026 at the code
defaults (`0.5 / 8 / 25`). The candidate's relative constants are derived from the DEFAULTS.
A raw candidate-vs-baseline delta in 2023/2024 would confound the scaling SHAPE (own-spread
relative vs. flat absolute) with a magnitude jump back toward the defaults. Patch C holds every
season at the defaults with the unmodified flat-absolute SHAPE, so candidate-vs-control isolates
shape alone across all five seasons. Patch C vs. baseline is also a free finding on its own: what
the legacy-tuned RP absolutes are worth on RP log-loss (control beats baseline in every season
except 2025, per the tables below — the legacy 2023/2024 tuning was a net win on this new
objective, which D-01's Brier objective could never have told us).

## Patch diffs (exact, reproducible; state.ts was reverted after each replay — see the tree-clean
gate below; these are the literal edits applied and undone)

### Patch C — magnitude control (`packages/core/algorithms/sigma1/rp/state.ts`)

```diff
@@ coldStartRpTeamState @@
   for (const name of variableNames) {
     rpBeliefs[name] = {
       mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
-      variance: params.rpColdStartVariance,
+      variance: 25, // PATCH C (quick-260905-tpx magnitude control) — was params.rpColdStartVariance
     };
   }

@@ foldRpObservation, per-team loop @@
       const sameEvent = existing.lastEventKey === null || existing.lastEventKey === eventKey;
-      // F3 (4.0.0): RP's OWN absolute process noise, never the score side's
-      // now-scale-relative pair. A threshold variable is a COUNT on roughly a
-      // 0-20 scale; the score-side value is a fraction of an alliance-score
-      // variance that reaches ~20,000 in 2026, so multiplying the two would
-      // inject several hundred times this variable's own range as noise every
-      // match. See this module's header for the full argument, the rejected
-      // per-variable-SD alternative, and the search consequence.
-      const q = sameEvent ? params.rpProcessNoiseWithinEvent : params.rpProcessNoiseEventBoundary;
+      const q = sameEvent ? 0.5 : 8; // PATCH C (quick-260905-tpx magnitude control) — was params.rpProcessNoiseWithinEvent : params.rpProcessNoiseEventBoundary
       const rpBeliefs: Record<string, TeamComponentBelief> = {};
       for (const name of variableNames) {
         const belief = existing.rpBeliefs[name] ?? {
           mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
           // F3: RP's own absolute cold-start variance, for the same
           // dimensional reason — see `coldStartRpTeamState` above.
-          variance: params.rpColdStartVariance,
+          variance: 25, // PATCH C (quick-260905-tpx magnitude control) — was params.rpColdStartVariance
         };
```

### Patch X — own-scale candidate (`packages/core/algorithms/sigma1/rp/state.ts`, applied to a
freshly-reverted tree, never combined with Patch C)

```diff
@@ new module-level constants and helper, inserted after RP_COLD_START_VARIABLE_MEAN and
   before rpLeagueMeanFor @@
 const RP_COLD_START_VARIABLE_MEAN = 0;

+/**
+ * PATCH X (quick task 260905-tpx, WORKING-TREE EXPERIMENT — never committed
+ * with these constants active): the own-spread-relative RP process-noise
+ * candidate `.planning/todos/pending/rp-process-noise-own-scale.md` defers.
+ *
+ * `RP_REFERENCE_VARIANCE` is the observation-count-WEIGHTED mean of the
+ * 2022-2024 per-season-per-threshold-variable population variance of each
+ * rating-eligible teammate's per-team SHARE of that alliance-variable's
+ * observed sum — measured by `measure-rp-spread.ts` (quick task 260905-tpx),
+ * run 2026-09-05: WEIGHTED aggregate = 3.964037. Each relative constant is
+ * that section's own default (`kalman.ts:76`/`kalman.ts:91`/`params.ts:633`)
+ * divided by this reference, so `rel * RP_REFERENCE_VARIANCE` reproduces the
+ * exact absolute default — this is also why `RP_REFERENCE_VARIANCE` is the
+ * correct FALLBACK to pass into `rpLeagueVarianceFor` below: when fewer than
+ * two observations exist for a variable, `rel * fallback` collapses back to
+ * today's absolute value exactly, by construction.
+ */
+const RP_REFERENCE_VARIANCE = 3.964037;
+const RP_WITHIN_EVENT_REL = 0.1261340319; // 0.5 / RP_REFERENCE_VARIANCE
+const RP_EVENT_BOUNDARY_REL = 2.0181445097; // 8 / RP_REFERENCE_VARIANCE
+const RP_COLD_START_REL = 6.3067015929; // 25 / RP_REFERENCE_VARIANCE
+
 function rpLeagueMeanFor(league: RpLeague, name: string, fallback: number): number {
   const stats = league.rpVariableMean[name];
   return stats && stats.count > 0 ? stats.mean : fallback;
 }
+
+/**
+ * PATCH X: this variable's own population variance (`m2 / count`, mirroring
+ * `expandingStats.ts`'s own `standardDeviation(stats, fallback)` contract),
+ * or `fallback` when fewer than two observations exist yet. Reads
+ * `league.rpVariableMean`, which is pre-match state (leak-proof by
+ * construction).
+ */
+function rpLeagueVarianceFor(league: RpLeague, name: string, fallback: number): number {
+  const stats = league.rpVariableMean[name];
+  return stats && stats.count >= 2 ? stats.m2 / stats.count : fallback;
+}

@@ coldStartRpTeamState @@
   for (const name of variableNames) {
     rpBeliefs[name] = {
       mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
-      variance: params.rpColdStartVariance,
+      // PATCH X (quick-260905-tpx own-scale candidate) — was params.rpColdStartVariance
+      variance: RP_COLD_START_REL * rpLeagueVarianceFor(league, name, RP_REFERENCE_VARIANCE),
     };
   }

@@ foldRpObservation, per-team loop @@
       const sameEvent = existing.lastEventKey === null || existing.lastEventKey === eventKey;
-      // F3 (4.0.0): RP's OWN absolute process noise, never the score side's
-      // now-scale-relative pair. A threshold variable is a COUNT on roughly a
-      // 0-20 scale; the score-side value is a fraction of an alliance-score
-      // variance that reaches ~20,000 in 2026, so multiplying the two would
-      // inject several hundred times this variable's own range as noise every
-      // match. See this module's header for the full argument, the rejected
-      // per-variable-SD alternative, and the search consequence.
-      const q = sameEvent ? params.rpProcessNoiseWithinEvent : params.rpProcessNoiseEventBoundary;
       const rpBeliefs: Record<string, TeamComponentBelief> = {};
       for (const name of variableNames) {
         const belief = existing.rpBeliefs[name] ?? {
           mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
-          // F3: RP's own absolute cold-start variance, for the same
-          // dimensional reason — see `coldStartRpTeamState` above.
-          variance: params.rpColdStartVariance,
+          // PATCH X (quick-260905-tpx own-scale candidate) — was params.rpColdStartVariance
+          variance: RP_COLD_START_REL * rpLeagueVarianceFor(league, name, RP_REFERENCE_VARIANCE),
         };
+        // PATCH X: q is no longer one scalar shared by every threshold
+        // variable — each variable's own measured population variance
+        // (read from `league`, pre-match, leak-proof by construction) scales
+        // its own process noise. Was: `params.rpProcessNoiseWithinEvent :
+        // params.rpProcessNoiseEventBoundary`, hoisted above this loop.
+        const rel = sameEvent ? RP_WITHIN_EVENT_REL : RP_EVENT_BOUNDARY_REL;
+        const q = rel * rpLeagueVarianceFor(league, name, RP_REFERENCE_VARIANCE);
         rpBeliefs[name] = applyProcessNoise(belief, q);
       }
```

Neither patch changed `coldStartRpTeamState`'s `params` parameter's signature (it is still
threaded through and still used by the caller), so `params` remains referenced even though
Patch X's own reads of its three RP fields disappear.

Both patches read `league` (pre-match state), never `nextRpVariableMean` (this match's own
in-progress fold) — leak-proofing holds by construction in both patches, unchanged from the
unpatched code.

Neither replay threw. The Cholesky ridge escalation / Cauchy-Schwarz clamp in
`rp/distribution.ts` was never stressed to failure by either patch's larger per-variable `q`
values.

## Win-probability guard — RESULT: VALID (PRED_WIN_IDENTICAL everywhere)

Every one of the 5 seasons, for both `control` and `ownscale` against whichever series was the
active reference (`control` in the first scoring pass, `baseline` in the second), and the pooled
row, printed `PRED_WIN_IDENTICAL`. Zero `pRedWin` divergence anywhere across 139,550 scored
alliance-observations (69,775 scored matchKeys × 2 sides). This settles, by measurement, that
the RP threshold Kalman state does NOT feed win probability — confirming `rp/state.ts`'s header
assertion and `sigma1/index.ts`'s line-ordering claim empirically rather than by inheriting it.
**The experiment is VALID as designed; a verdict may be issued.**

## Full per-season tables, both reference framings

### View 1 — CONTROL as reference (primary comparator; isolates shape from the 2023/2024
magnitude difference in the live promoted set)

| season | series | meanLogLoss | n | zeroMass | outOfRange | SE | delta vs control (SE units, + = worse) |
|---|---|---|---|---|---|---|---|
| 2022 | control | 2.071714 | 24128 | 1285 | 0 | 0.020407 | - |
| 2022 | ownscale | 1.992422 | 24128 | 1150 | 0 | 0.019463 | -3.8854 |
| 2022 | baseline | 2.071714 | 24128 | 1285 | 0 | 0.020407 | 0.0000 |
| 2023 | control | 2.808860 | 27116 | 2469 | 0 | 0.023599 | - |
| 2023 | ownscale | 2.630907 | 27116 | 2106 | 0 | 0.022170 | -7.5407 |
| 2023 | baseline | 3.168708 | 27116 | 3285 | 0 | 0.026241 | +15.2485 |
| 2024 | control | 2.690047 | 28282 | 2839 | 0 | 0.024112 | - |
| 2024 | ownscale | 2.814304 | 28282 | 3150 | 0 | 0.025088 | **+5.1533** |
| 2024 | baseline | 2.964494 | 28282 | 3502 | 0 | 0.026124 | +11.3820 |
| 2025 | control | 7.922884 | 29642 | 14570 | 0 | 0.034982 | - |
| 2025 | ownscale | 8.005273 | 29642 | 14883 | 0 | 0.035133 | +2.3552 |
| 2025 | baseline | 7.922884 | 29642 | 14570 | 0 | 0.034982 | 0.0000 |
| 2026 | control | 2.487458 | 30382 | 3414 | 0 | 0.024533 | - |
| 2026 | ownscale | 1.649866 | 30382 | 1260 | 0 | 0.016543 | -34.1412 |
| 2026 | baseline | 2.487458 | 30382 | 3414 | 0 | 0.024533 | 0.0000 |
| pooled | control | 3.673632 | 139550 | 24577 | 0 | 0.013282 | - |
| pooled | ownscale | 3.485672 | 139550 | 22549 | 0 | 0.012852 | -14.1520 |
| pooled | baseline | 3.799175 | 139550 | 26056 | 0 | 0.013566 | +9.4524 |

(`droppedNoCorpusRp=21` in 2024, `0` in every other season, all three views; `droppedNotInAllSeries=0` everywhere — one denominator, as required.)

### View 2 — BASELINE as reference (secondary view; the candidate-vs-live-model comparison)

| season | series | meanLogLoss | n | zeroMass | outOfRange | SE | delta vs baseline (SE units, + = worse) |
|---|---|---|---|---|---|---|---|
| 2022 | baseline | 2.071714 | 24128 | 1285 | 0 | 0.020407 | - |
| 2022 | control | 2.071714 | 24128 | 1285 | 0 | 0.020407 | 0.0000 |
| 2022 | ownscale | 1.992422 | 24128 | 1150 | 0 | 0.019463 | -3.8854 |
| 2023 | baseline | 3.168708 | 27116 | 3285 | 0 | 0.026241 | - |
| 2023 | control | 2.808860 | 27116 | 2469 | 0 | 0.023599 | -13.7132 |
| 2023 | ownscale | 2.630907 | 27116 | 2106 | 0 | 0.022170 | -20.4947 |
| 2024 | baseline | 2.964494 | 28282 | 3502 | 0 | 0.026124 | - |
| 2024 | control | 2.690047 | 28282 | 2839 | 0 | 0.024112 | -10.5056 |
| 2024 | ownscale | 2.814304 | 28282 | 3150 | 0 | 0.025088 | -5.7491 |
| 2025 | baseline | 7.922884 | 29642 | 14570 | 0 | 0.034982 | - |
| 2025 | control | 7.922884 | 29642 | 14570 | 0 | 0.034982 | 0.0000 |
| 2025 | ownscale | 8.005273 | 29642 | 14883 | 0 | 0.035133 | **+2.3552** |
| 2026 | baseline | 2.487458 | 30382 | 3414 | 0 | 0.024533 | - |
| 2026 | control | 2.487458 | 30382 | 3414 | 0 | 0.024533 | 0.0000 |
| 2026 | ownscale | 1.649866 | 30382 | 1260 | 0 | 0.016543 | -34.1412 |
| pooled | baseline | 3.799175 | 139550 | 26056 | 0 | 0.013566 | - |
| pooled | control | 3.673632 | 139550 | 24577 | 0 | 0.013282 | -9.2539 |
| pooled | ownscale | 3.485672 | 139550 | 22549 | 0 | 0.012852 | -23.1087 |

## Verdict against the five pre-committed criteria

Sign convention used above (and by the committed scorer): delta = `(candidateMean - refMean) /
refSE`; **positive = worse** (higher mean log-loss than the reference), **negative = better**
(lower mean log-loss). "Worsens by more than 2.0 SE" therefore means the delta exceeds **+2.0**.

### Against CONTROL (primary comparator)

1. **Per-season improves in ≥3 of 5 seasons** — PASS. Ownscale improves in 2022 (-3.8854 SE),
   2023 (-7.5407 SE), and 2026 (-34.1412 SE); worsens in 2024 (+5.1533 SE) and 2025
   (+2.3552 SE). 3 of 5.
2. **Pooled mean RP log-loss improves** — PASS. Pooled ownscale 3.485672 < pooled control
   3.673632 (delta -14.1520 SE).
3. **No season worsens by more than 2.0 SE** — **FAIL**. 2024 worsens by **+5.1533 SE**, more
   than double the 2.0 SE ceiling.
4. **No season's zeroMass exceeds control's by more than 10% + 5 observations** — **FAIL**.
   2024: control `zeroMass=2839`, ownscale `zeroMass=3150`, diff `+311`; threshold
   `2839 × 0.10 + 5 = 288.9`. `311 > 288.9`.
5. **Validity gate (win-probability guard) passed** — PASS (see above).

**Criteria 3 and 4 both fail, both at the same season (2024) — the season where the live
promoted set runs the legacy tuned absolutes rather than the code defaults.** Since ALL five
criteria must hold, this is a **NO-WIN against control**.

### Against BASELINE (secondary view)

1. **Per-season improves in ≥3 of 5 seasons** — PASS. Ownscale improves in 2022, 2023, 2024,
   and 2026 (4 of 5); worsens only in 2025 (+2.3552 SE).
2. **Pooled mean RP log-loss improves** — PASS. Pooled ownscale 3.485672 < pooled baseline
   3.799175 (delta -23.1087 SE).
3. **No season worsens by more than 2.0 SE** — **FAIL**. 2025 worsens by **+2.3552 SE**, just
   over the 2.0 SE ceiling.
4. **No season's zeroMass exceeds baseline's by more than 10% + 5 observations** — PASS. The
   only worsening season, 2025: baseline `zeroMass=14570`, ownscale `zeroMass=14883`, diff
   `+313`; threshold `14570 × 0.10 + 5 = 1462.0`. `313 < 1462.0`.
5. **Validity gate** — PASS.

**Criterion 3 fails (2025 this time, not 2024) — a NO-WIN against baseline too.**

### Do the two views agree?

**Yes, on the verdict itself: both are NO-WIN.** They disagree only on WHICH single season
carries the disqualifying worsening (2024 against control, where the promoted set's legacy
tuned magnitude already made 2024/2023 the best-performing seasons for the flat-absolute shape;
2025 against baseline, where 2025's coral-bonus binary threshold already carries the worst
absolute log-loss of any season under every series tested). **This is stated as a named caveat
for any follow-up ship task**: the candidate's failure mode is season-dependent and tracks which
comparator is used, not a single universally-bad season. A follow-up would need to resolve
*why* 2024 (control view) or 2025 (baseline view) is the outlier — plausibly evidence that a
per-variable-own-scale q interacts badly with either 2024's seven low-spread indicator-style
threshold variables (population variances as low as 0.000319, three orders of magnitude below
2022/2023's ~10) or 2025's already-poorly-calibrated coral-bonus pmf, before proposing a second
iteration of this form.

## FINAL VERDICT: NO-WIN

The own-spread-relative RP process-noise form, at the constants derived from the WEIGHTED
2022-2024 reference variance (3.964037), does **not** meet all five pre-committed criteria
under either reference framing. Two of five seasons — 2024 (vs. control) or 2025 (vs.
baseline), depending on the comparator — worsen by more than the 2.0-SE ceiling, and in the
control framing the same season also breaches the zero-mass tolerance. Per the plan's own
pre-committed rule, this closes
`.planning/todos/pending/rp-process-noise-own-scale.md` as **measured-negative**: the
dimensionally-principled form is not, on this measurement, an unambiguous improvement over
either the flat-absolute defaults or the live promoted set — it trades large wins in three
seasons (2022, 2023, 2026) for a large, ceiling-breaching loss in one (2024 or 2025 depending on
comparator), and the pre-committed criteria treat that trade as disqualifying rather than
net-positive.

This IS a positive result for the underlying measurement gap the todo names: an RP-pmf
log-loss objective now exists, is committed and runnable, and could evaluate a differently-tuned
or differently-shaped own-scale candidate (e.g. one that treats the outlier season's low-spread
threshold variables specially) in a future iteration — that door remains open. What closes here
is only the SPECIFIC candidate this task built and measured.

## Reproducibility note

`reports/` is gitignored. The three stream sets under `reports/rpnoise-baseline-260905/`,
`reports/rpnoise-control-260905/`, and `reports/rpnoise-ownscale-260905/` (predictions-2022.jsonl
through predictions-2026.jsonl for each, roughly 240MB per set) are **not recoverable from git**
and must be regenerated by re-running the three `pnpm harness` commands above — the control and
ownscale runs additionally require re-applying the exact patch diffs recorded above to
`packages/core/algorithms/sigma1/rp/state.ts` before running, and reverting with
`git checkout -- packages/core/algorithms/sigma1/rp/state.ts` afterward.

## What a ship task would entail (recorded regardless of verdict; nothing here is done by this
task)

Given the NO-WIN verdict, a ship task is not currently warranted for THIS candidate — but if a
future iteration (e.g. one that special-cases the outlier season, or re-derives the reference
variance excluding 2024's indicator-scale variables) reaches WIN, the ship task would need to:

1. Retire `rpProcessNoiseWithinEvent`, `rpProcessNoiseEventBoundary`, and `rpColdStartVariance`
   from `Sigma1Params`/`Sigma1ResolvedParams` (`packages/core/algorithms/sigma1/params.ts`).
2. Add their relative replacements (three constants analogous to `RP_WITHIN_EVENT_REL` /
   `RP_EVENT_BOUNDARY_REL` / `RP_COLD_START_REL` above, or promote them to tunable
   `Sigma1Params` fields if a future search should explore around the derived point) and wire
   `rp/state.ts` to read them permanently, replacing the reverted Patch X shape.
3. Bump `SIGMA1_CODE_VERSION` from `9.0.0` to `10.0.0` (`params.ts:545`) — a genuine model
   change, not a reparameterization, since RP dynamics actually move.
4. Retire and re-promote every committed `data/algorithm-versions/vpr@9.0.0+*.json` in the SAME
   commit as the version bump, per the established precedent (`SIGMA1_CODE_VERSION` history),
   and re-pin `PROMOTED_VPR_VERSION_PATH` (`packages/harness/promotedVersionPath.ts:92`) to the
   new promoted artifact.
5. Carry the three replacement constants/params into `SEARCH_EXCLUSIONS` with the SAME recorded
   reason the retiring three carry: D-01's tuning objective (Brier over predicted win
   probability) is structurally blind to the RP pmf, so a search still cannot evaluate them —
   *unless* this task's RP-pmf log-loss scorer (`score-rp-logloss.cjs`, now committed at
   `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs`)
   is itself promoted into the tuning loop as a second objective, which is the only condition
   under which that exclusion could ever be lifted.

**Nothing in this list is done by this task.** No `Sigma1Params` field was added or removed, no
`SIGMA1_CODE_VERSION` bump occurred, no artifact was promoted or published, and no network
request was made. `packages/`, `data/algorithm-versions/`, and `fixtures/` are untouched at
HEAD.
