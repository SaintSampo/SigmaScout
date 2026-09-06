# Quick task 260906-7fj: Early-match Kalman gain cap — RESULTS

**Verdict: POSITIVE. First mechanism in this investigation to pass Rule A and to narrow the
EPA gap.** A single global cap of 0.20 closes 38% of VPR's pooled deficit with better Brier.
The per-season optima differ enough that this should become a tuned per-season parameter — but
NOT by the in-sample selection shown here. See "The honest caveat".

## Headline

| configuration | pooled accuracy | gap to EPA | gap closed |
|---|---|---|---|
| epa@5.0.0+baseline | 0.76687 | | |
| vpr baseline (promoted) | 0.76483 | -0.204pt | |
| **vpr, single cap 0.20** | **0.76560** | **-0.127pt** | **38%** |
| vpr, per-season best cap | 0.76710 | **+0.023pt** | 111% — **IN-SAMPLE, see caveat** |

## Method

Seven arms, each capping the per-team alliance-sum Kalman gain at a fixed value, applied by the
committed `patch-gain.cjs` (six anchored edits across `kalman.ts` and `index.ts`, generated from
one script so all arms are character-identical except the constant). Score components only —
`rp/state.ts` passes three arguments and keeps the uncapped gain (P-3), so the result is
attributable to the score side alone.

Each arm: patch -> `npx tsc --noEmit` (clean) -> `pnpm harness --seasons 2022-2026 --algorithm
vpr` -> `git checkout --` -> confirm clean. Never two patches held at once. All seven artifacts
report the unchanged `9.0.0+rolling-2026-09c`.

**Inertness proven bitwise, not asserted (Task 2).** Patched at `maxGain = 1` and replayed 2022:
the predictions stream came back sha256-identical to the baseline
(`2ea000c2a73f8dd96d403a680e12d6ed241ce69fd78a8dfb1cc9fc905764127e`). `K_j = P_j / (Sum P_i + R)
<= 1` always, so `Math.min(K_j, 1)` is exact in IEEE-754. The six edits are a true no-op at
default; any movement in the arms is the cap itself.

Scored by the committed `score-gaincap.cjs` against the two reused baselines
(`reports/rpnoise-baseline-260905` vpr, `reports/autopsy-260905` epa rows). 83,655 matches
scored, 0 dropped for any reason other than a tie, in every arm.

## Full sweep — winner accuracy, delta vs baseline in baseline-SE units

| season | epa | baseline | g60 | g45 | g30 | g20 | g15 | g10 | g05 |
|---|---|---|---|---|---|---|---|---|---|
| 2022 | 0.7670 | 0.7637 | +0.00 | +0.00 | +0.16 | **+0.27** | +0.20 | +0.12 | -1.54 |
| 2023 | 0.7623 | 0.7563 | +0.00 | +0.00 | +0.09 | +0.81 | +0.84 | **+1.46** | -1.02 |
| 2024 | 0.7325 | **0.7451** | +0.00 | -0.12 | -0.42 | -0.57 | -1.33 | -2.94 | -6.24 |
| 2025 | 0.7763 | 0.7656 | +0.00 | +0.00 | +0.09 | +0.39 | **+0.67** | +0.57 | -0.90 |
| 2026 | 0.7932 | 0.7906 | +0.00 | +0.02 | +0.09 | +0.29 | +0.49 | **+1.03** | -1.12 |
| **pooled** | 0.76687 | 0.76483 | +0.00 | -0.05 | -0.01 | **+0.52** | +0.38 | +0.07 | -4.90 |

```
RULE_A g60: acc +0.00pt (DOWN), brier -0.000000 (ok)    -> FAILS
RULE_A g45: acc -0.01pt (DOWN), brier -0.000000 (ok)    -> FAILS
RULE_A g30: acc -0.00pt (DOWN), brier -0.000044 (ok)    -> FAILS
RULE_A g20: acc +0.08pt (up),   brier -0.000295 (ok)    -> PASSES
RULE_A g15: acc +0.05pt (up),   brier -0.000454 (ok)    -> PASSES
RULE_A g10: acc +0.01pt (up),   brier +0.000363 (WORSE) -> FAILS
RULE_A g05: acc -0.72pt (DOWN), brier +0.006330 (WORSE) -> FAILS
```

Every season's optimum is bracketed: all seven curves turn over between 0.05 and 0.30.

## Criteria (pre-committed before any arm ran)

- **C-1 — PASSED.** g20 and g15 both improve pooled winner accuracy vs the promoted baseline
  (+0.08pt and +0.05pt).
- **C-2 — PASSED, and this is the load-bearing one.** The mechanism had to show up in the early
  window or the result would be unexplained. At g20, pooled `early_acc` rises 0.7450 -> 0.7466
  (+0.0016) against full-set accuracy's +0.0008 — the early slice improves at TWICE the overall
  rate. At g15 it is +0.0023 against +0.0005. The effect is concentrated exactly where the
  autopsy said EPA's advantage lived.
- **C-3 — one season is sacrificed, and it is named.** 2024 degrades monotonically with any cap
  (-0.57 SE at g20, -2.94 at g10, -6.24 at g05). It is the only season that does. 2024 is also
  the only season VPR already wins, and it still wins it at g20 (+1.06pt vs epa, down from
  +1.25pt).
- **C-4 — the gap narrows but does not close on a single value.** g20 takes VPR from -0.204pt to
  -0.127pt against EPA. 2026 flips outright at g10 (+0.04pt, VPR ahead).
- **C-5 — PASSED for g20 and g15** (accuracy up AND Brier better on both).

## What the mechanism actually turned out to be

The plan's stated premise was WRONG in magnitude and is corrected here. It predicted a green
team's gain approaches 1, so that one match nearly overwrites its rating. It does not:

- g60 changed 2022 not at all and every other season only negligibly. A cap of 0.60 sits ABOVE
  essentially the whole gain distribution.
- g45 left 2022 sha256-identical. In a cold-start season every team has equal variance, so three
  teammates each sit near `P/(3P+R) ~ 0.33`.

The reason is structural and worth recording: `coldStartVariance = seedConsistencyFor(...)`
(`index.ts:1877`) and the measurement noise `R` is the SUM of teammates' consistency estimates,
defaulting to `coldStartConsistencyVariance` (`index.ts:750`). **A team's belief variance `P` and
its own contribution to `R` are seeded from the same quantity.** So for a green team among
converged veterans, `K ~ P_g / (P_g + c_g + small) ~ 0.5`.

**VPR therefore already has an implicit gain ceiling near 0.5, emergent rather than designed** —
and, critically, one that no parameter can move: scaling `coldStartConsistencyVariance` moves the
numerator and the denominator together and leaves the ratio where it was.

The real finding is not that VPR over-learns catastrophically from one match. It is that VPR's
early per-team gain is **uniformly too high by roughly a factor of two**, and `Sigma1Params`
contains no degree of freedom that can lower it. That is why six previous experiments moving `P`
(carry variance) produced muted, season-inconsistent effects: they were pushing on a ratio that
re-equalises.

## The honest caveat — do not read the per-season row as "VPR beats EPA"

Selecting each season's best cap from this 7-point grid gives pooled 0.76710 against EPA's
0.76687 — VPR ahead by 0.023pt, 111% of the gap. **That number is in-sample and must not be
quoted as a win.** Two independent reasons:

1. **Selection optimism.** Each season's cap was chosen by looking at that season's own scored
   result. That is precisely the protocol this project's rolling-origin discipline exists to
   prevent.
2. **The per-season spread is the problem, not the opportunity.** The optima are 0.20 (2022),
   0.10 (2023), NO CAP (2024), 0.15 (2025), 0.10 (2026). A rolling-origin tune selects season
   S's parameters on seasons BEFORE S. For 2024, that window is 2022+2023 — both of which want a
   cap of 0.10-0.20. The tuner would therefore hand 2024 a cap, and 2024 costs -0.57 SE at g20
   and -2.94 at g10. **The one season the protocol would get wrong is the one season that
   punishes being wrong.**

So the defensible candidate from this task is the SINGLE GLOBAL VALUE, not the per-season fit:
**cap 0.20, pooled +0.08pt accuracy and -0.000295 Brier, Rule A PASS, closing 38% of the gap**,
positive in four of five seasons and costing 2024 -0.57 SE while leaving it comfortably ahead of
EPA.

## Recommendation

1. **Add `maxTeamKalmanGain` to `Sigma1Params`,** defaulting to 1 (inert, proven bitwise), read
   only by the score-side `updateAllianceSum`/`componentGains` call sites. This is the missing
   degree of freedom named above — the model currently cannot express "learn slower early" at
   all.
2. **Register it in `SIGMA1_SEARCH_SPACE`** with bounds roughly `{ min: 0.08, max: 1, scale:
   "linear" }` — the sweep shows everything below 0.05 collapses and everything above 0.45 is
   inert, so a wider bound would spend budget on dead regions.
3. **Run the rolling-origin re-tune** and let the protocol pick per-season values out-of-sample.
   Judge by `decideAcceptance` under Rule A, exactly as any other knob.
4. **Watch 2024 specifically** in that tune, for the reason in the caveat above. If out-of-sample
   selection hands 2024 a cap and 2024 regresses, the fallback is the single global 0.20, which
   is already a Rule-A pass on its own.

Nothing shipped from this task: no `Sigma1Params` field added, no `SIGMA1_CODE_VERSION` bump, no
promotion, no republish. Both files reverted after every arm and verified clean.

## Provenance

- Arms: `reports/gaincap-{g60,g45,g30,g20,g15,g10,g05}-260906/` (+ `-run.log` each), and the
  inertness run `reports/gaincap-inert-260906/`.
- Baselines reused unchanged: `reports/rpnoise-baseline-260905/`, `reports/autopsy-260905/`.
- Instruments: `score-gaincap.cjs`, `patch-gain.cjs` (both committed in this task directory).
- Predecessor: `260906-6zc` (carry-mean, falsified) — which relocated the problem here.
