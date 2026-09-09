---
task: adversarial-review-of-the-bpr-algorithm
quick_id: 260908-vqr
date: 2026-09-08
type: analysis
read_only_model: true
recount_artifact: reports/260908-vqr-fourway/artifact.json
---

# Adversarial review of BPR

## Verdict

**78.05% is honest.** Recounted under the shared harness, over the same match
set and the same rules every other algorithm is scored by, BPR's 2023–2026
accuracy is **77.97%** (68,892 decided) — the sealed number is overstated by
**0.08pp**. The firewall held: params were sealed 2m16s before the holdout ran,
the file has exactly one revision, all three refusals fire, and a full-state
replay of real corpus matches finds zero outcome leakage.

**The "~3pp lead" is not.** Under one harness, one match set, identical
denominators, BPR's holdout-era margin is **+1.79pp over VPR** (95% CI
[1.48, 2.11]) and **+1.17pp over EPA** ([0.87, 1.49]) — not 3pp. The ~3pp figure
is BPR's margin on **2016–2022, the seasons it was tuned on** (+3.05pp / +2.60pp).
That the margin is ~1.5pp larger on the design era than the holdout is textbook,
expected, and the honest reading of the model.

Worse for the headline: the surviving holdout lead is carried by **one season**.
Excluding 2024, BPR leads VPR by +1.25pp and EPA by **+0.50pp**. And there is one
slice where BPR **loses**: championship-level events (n=5,820), where it trails
EPA by 1.84pp.

What genuinely survives every attack is **Brier**. BPR is the best-calibrated
model in every season, every comp level, and every event-size bucket — including
the champs bucket where its accuracy is worst. That, not winner accuracy, is
BPR's real result.

---

## Findings

| ID | Angle | Hypothesis | Verdict | Proof | Headline impact |
|---|---|---|---|---|---|
| F-01 | A | `bpr` absent from the shared harness registry, so its comparison numbers never used the historical code path | **CONFIRMED** | `packages/harness/cli.ts:107` had `{opr,epa,vpr,vpr-defaults,vpr-seasonsd,vpr-normalcdf}`; `publish.ts:131` had `bpr`. Fixed in `4c3d16d8` | Process, not number — but the recount it unblocked cut the lead from ~3pp to ~1.2–1.8pp |
| F-02 | A | The ~3pp lead does not survive a like-for-like recount | **CONFIRMED** | Recount, identical denominators: holdout BPR−VPR **+1.79pp**, BPR−EPA **+1.17pp** | **The lead is overstated by ~1.2–1.8pp** |
| F-03 | A | The lead is carried by a single season | **CONFIRMED** | 2024 BPR−EPA +3.37pp; 2023 +0.15pp, 2025 +0.63pp, 2026 +0.68pp. Ex-2024 pooled: **+0.50pp** vs EPA, +1.25pp vs VPR | **Ex-2024 the EPA lead is ~0.5pp, inside two clustered s.e.** |
| F-04 | A | Denominators differ across algorithms | **KILLED** | Every season, every comp-level view: all four report identical `n`/`accDen`/`ties` (e.g. 2024: 16958/16764/194 for all four) | None — the comparison population is genuinely shared |
| F-05 | A/F | Sealed 78.05% inflated by convention | **CONFIRMED, negligible** | Shared-harness recount 77.97% combined, 78.27% quals (sealed 78.05 / 78.37) | **−0.08pp / −0.10pp** |
| F-06 | A | EPA/VPR run un-promoted, flattering BPR | **KILLED (VPR), CONFIRMED (EPA)** | Artifact: `vpr=11.0.0+rolling-2026-09g` (promoted), `epa=6.0.0+baseline`. `data/algorithm-versions/` holds VPR files only; `applyPromotedOverrides` branches on `vpr` alone | VPR comparison is fair and *generous*. "Beats EPA" means beats an **untuned** baseline — the EPA gap should not be quoted as a tuned-vs-tuned result |
| F-07 | A/E | Publish-path per-season figures disagree with the shared harness | **PLAUSIBLE** | Published 2025 BPR−EPA 1.09pp vs recount 0.63pp; 2026 0.97pp vs 0.68pp. 2024 agrees (3.17 vs 3.37) | Publish path shows a **larger** BPR lead by 0.3–0.5pp in 2025/2026. See "could not settle" |
| F-08 | A | Two live scoring conventions (half-credit vs D-Q3 miss) | **CONFIRMED, harmless on the holdout** | `packages/bpr/evaluate.ts:40` credits 0.5; `packages/core/scoring/brier.ts:97-104` counts a miss. Measured: BPR no-calls 2023–2026 = **0** → gap **0.000pp**; design era gap **0.163pp** | **0.00pp on 78.05%.** Independently confirms the `260908-b4t` Addendum-2 claim |
| F-09 | A | Brier / log-loss denominators inconsistent | **KILLED** | `evaluate.ts` divides by `s.n` (ties included); `scoreSet`'s `count` is "including ties and no-calls" (`brier.ts:64`). Same population | None |
| F-10 | B | Match ordering differs, letting a later match update before an earlier prediction | **KILLED** | 152,457 matches: **15** adjacent inversions, **0 within an event**; only **1** within-event `sort_time` collision group and its lexicographic tiebreak agrees with play order | None |
| F-11 | B | State leakage — some BPR state depends on the match being predicted | **KILLED** | `leakage-probe.ts`: 4,000 real 2024 matches through the shipped port, flip match 2500, first differing **prediction** = 2501, first differing **full serialized state** = 2501. `pRedWin` reads only `state.teams`/`logTau`; `state.scale` never enters it | None |
| F-12 | B | `packages/bpr/data.ts` scores a different population than the harness | **CONFIRMED, negligible** | data.ts 152,457 vs shared 152,757. data.ts scores **614** surrogate-affected matches the harness excludes (260 in the holdout) and drops ~37/season the harness keeps | Surrogate inclusion moves BPR holdout accuracy by **−0.002pp**. Real defect, no headline effect |
| F-13 | C | The holdout was evaluated more than once, or params changed after | **KILLED** | `frozen-params.json`: exactly **one** commit, `a66688af` 01:20:51. `HOLDOUT-RESULT.txt`: one commit, `07b8ce8a` 01:23:07. 2m16s apart — room for one run, not a search |
| F-14 | C | All three firewall refusals fire | **CONFIRMED (they fire)** | `BPR_TUNE_YEARS=2023` → "2023 is a holdout year"; `score.ts … 2024` → "use holdout.ts, deliberately"; `holdout.ts` without `--break-seal` → "refusing to run" | None |
| F-15 | C | The seal covers the model, not just the parameters | **CONFIRMED — real weakness** | `holdout.ts:17-38` `assertCommitted` checks only the **params path** is clean at HEAD. `model.ts` is unchecked, and in fact changed twice after the holdout (`22ad2035`, `07b02ab6`) | None today (both changes verified inert/disclosed) — but the mechanism does not protect what it is believed to protect |
| F-16 | C | `SLICE-2023-wk0-1.txt` is holdout data used in design | **CONFIRMED — but post-seal, and it did not reach the shipped model** | Slice committed `23ef664b` 01:33:22, **after** the holdout (01:23:07). It led to `22ad2035` "heteroscedastic observation noise, **diagnosed from 2023 wk0-1**", which added `obsSdSlope` — inert at default (`DEFAULTS.obsSdSlope = 0`), absent from `frozen-params.json`, never promoted | **0.00pp.** The shipped model is unchanged. But the holdout is now spent twice over: evaluated *and* mined for diagnostics |
| F-17 | C | The disclosed 2026 schema glance was strictly conservative | **CONFIRMED** | The glance forbade breakdown-field-name components. `packages/core/algorithms/bpr.ts` predicts from `totalPoints`/`foulPoints` only; the component split shipped in `260908-pcm` is display-only and structurally isolated (`predict` reads `state.teams`, never `phaseTeams`) | None — it removed a design family rather than selecting one |
| F-18 | C | The post-seal `normCdf(0)` fix constitutes tuning on the holdout | **KILLED** | Recount `noCallCount` for BPR 2023–2026 = **0** (2016: 269, 2017: 1). No dead-even match exists in the holdout era, so the fix cannot move 78.05% | None on the holdout; **−1.0pp on 2016**, independently reproduced (2016 recount 70.46% vs 71.49% pre-fix) |
| F-19 | E | The 0.30pp / 0.31pp error bars assume independence they do not have | **CONFIRMED** | Event-clustered block bootstrap, 2,000 draws: design-era BPR naive SE 0.155pp, **clustered 0.225pp, design effect 1.45x** (EPA 1.62x, VPR 1.53x). Holdout design effect 1.19–1.27x | The pre-registered **0.31pp bar should be ~0.45pp** |
| F-20 | E | The parsimony decision flips under an honest bar | **KILLED** | Parsimonious was 0.238pp below the full model against a 0.31pp bar. Under 0.45pp it is *further* inside. Decision stands, more comfortably | None — and all five "under 0.1pp" rejections stand more strongly too |
| F-21 | E | Anti-additivity no longer clears the honest bar | **PLAUSIBLE** | Its ablation delta is −0.47pp against a widened bar of ~0.45pp — a 0.02pp margin. But ablation deltas are *paired*, and I measured only the **marginal** design effect | Would not move 78.05%, but would demote "the genuinely novel piece" to undecidable. See "could not settle" |
| F-22 | D | "+3.22pp over a naive additive baseline" is inflated by the baseline's handicap | **CONFIRMED** | `packages/bpr/ablate.ts:44-58`: the "naive additive baseline" sets **`seasonShrink: 0`** — no cross-season carryover, which the same table prices at **+1.80pp**. So ≥56% of the 3.22pp is the baseline being denied memory, not BPR's structure | The structural claim is worth **~1.4pp**, not 3.22pp |
| F-23 | D | Ablation deltas are inflated by not re-tuning | **CONFIRMED** | `ablate.ts:22-58` ablates from `base` with all other params fixed at the full model's optimum. Only the parsimonious *variant* is re-tuned (`DECISION.md` rule 4), not the individual deltas | Each component's credit is an upper bound |
| F-24 | D | "An independent search on 2016–2019 rediscovered w2=0.7, w3=0.5 exactly" | **CONFIRMED as overstated** | 2016–2019 is **63,667 of 82,946 design-era matches = 76.8% overlap** — not independent. `tune.ts:77-78` grids are coarse (w2: 5 values, w3: 6), so "exactly" = "same grid point out of 30". And `validation-tune-1619.json` **disagrees** with the frozen set on ≥10 of 23 params (obsSd 1.3 vs 1.0, rhoFast 0.96 vs 0.9, priorVar 0.25 vs 0.1, rookieMean 0.4 vs 0.55, foulOn true vs false, elimWeight 0.5 vs 1) | None on the number; the *evidence for anti-additivity being real structure* is much weaker than stated |
| F-25 | D | "Five ideas rejected" were pinned, not searched | **KILLED** | `tune.ts:77-78` grid carries all five: `elimWeight` (6 values), `defPriorVar` (5), `defQ` (4), `huberK` (7), `biasLr` (5), plus `foulObsSd`/`foulQ`/`foulPriorVar`. Each was genuinely searched and landed inert | None. Corroborated by the repo's own independent elim-R negative (2026-09-05, 6/6 keep-incumbent) |
| F-26 | D | `foulOn:false` contradicts "+0.30pp foul-adjusted signal" | **KILLED** | Different things, and the source says so (`b4t` SUMMARY line 96). `ablate.ts` carries both variants separately: "no foul submodel" (`foulOn:false`) and "raw score (no foul adjustment at all)" (`useRawScore`). The port applies foul adjustment at `bpr.ts:449-452` | None |
| F-27 | D | The port's own component table claims more than the evidence | **CONFIRMED** | `packages/core/algorithms/bpr.ts:22-27` says four components each beat "a two-standard-error bar (0.31pp)" then lists **foul-adjusted signal at +0.30pp** — below the stated bar. Under F-19's honest 0.45pp bar, anti-additivity (+0.53pp) is also marginal | Doc defect; no number moves |
| F-28 | F | The port drifted from the research model | **KILLED** | `equivalence.ts`: design port 73.113 vs research 73.081 (**+0.032pp**), holdout port 78.040 vs 78.05 (**−0.010pp**) | None — the published module really is the one that scored 78.05% |
| F-29 | F | `260908-pcm`'s "152,757 matches, 0 mismatches" proves port fidelity | **CONFIRMED mis-scoped** | That comparison is "the new module **and the pre-change module at HEAD**" (`pcm` SUMMARY:19-24) — the phase refactor against itself, not the port against `packages/bpr/model.ts`. The port check is `equivalence.ts` (F-28), which reports an accuracy delta, not a per-match mismatch count | None — F-28 supplies the missing proof |
| F-30 | B | Cross-season carryover is a BPR-only advantage | **KILLED** | EPA: `packages/core/algorithms/carryover.ts`; VPR: `sigma1/carryover.ts`. Harness log prints "carried state in" for epa/vpr/bpr on every season after 2016. **OPR alone** prints "started cold" — its documented event-scoped design | None. This is the most natural explanation for the gap and it is dead |
| F-31 | G | BPR wins everywhere | **KILLED** | Holdout events of 121–200 matches (42 events, overwhelmingly champs divisions `event_type=3` and district champs): n=5,820, **BPR 74.67% vs EPA 76.51% vs VPR 75.21%** | BPR **trails EPA by 1.84pp** on championship-level play — its only measured deficit |
| F-32 | G | BPR's edge is uniform across an event | **KILLED** | By qual number, BPR−EPA: qm1–12 +1.49, qm13–48 ~+1.45, qm49–60 +0.92, **qm61+ +0.12pp**. The edge decays to nothing late in an event | Constrains where any improvement can come from |

---

## Angle A — the like-for-like recount

Command (one run, one match stream, one convention):

```
pnpm harness --seasons 2016-2020,2022-2026 --algorithm opr,epa,vpr,bpr --out reports/260908-vqr-fourway
```

`bpr` had to be registered first (`packages/harness/cli.ts`, commit `4c3d16d8`) — it
was in `publish.ts`'s `BASE_PUBLISH_ALGORITHMS` but not in the CLI registry, so
this command previously threw `Unknown algorithm`. That is F-01: **BPR's published
comparison numbers had never passed through the code path that produced every
historical OPR/EPA/VPR figure.** Registering it broke nothing (`packages/harness`:
44 files / 1073 tests pass).

### Winner accuracy, combined view, identical denominators

| year | OPR | EPA | VPR | **BPR** | n / accDen / ties |
|---|---|---|---|---|---|
| 2016 | 63.42 | 70.49 | 70.16 | **70.46** | 13263 / 13117 / 146 |
| 2017 | 57.86 | 66.79 | 62.75 | **67.24** | 15364 / 15103 / 261 |
| 2018 | 61.59 | 73.36 | 71.76 | **74.40** | 16889 / 16861 / 28 |
| 2019 | 61.66 | 64.27 | 68.61 | **73.19** | 17972 / 17664 / 308 |
| 2020 | 62.52 | 71.13 | 69.49 | **72.67** | 4644 / 4618 / 26 |
| 2022 | 69.31 | 77.20 | 76.26 | **78.85** | 14603 / 14427 / 176 |
| 2023 | 66.35 | 76.20 | 75.29 | **76.33** | 16290 / 16144 / 146 |
| 2024 | 65.53 | 73.48 | 73.28 | **76.84** | 16958 / 16764 / 194 |
| 2025 | 67.69 | 77.75 | 76.79 | **78.34** | 17815 / 17692 / 123 |
| 2026 | 69.94 | 79.43 | 79.02 | **80.09** | 18337 / 18292 / 45 |

Every cell in a row shares its denominator — F-04 is dead, the population is
genuinely common.

| pool | OPR | EPA | VPR | **BPR** | den |
|---|---|---|---|---|---|
| design 2016–2022 | 62.62 | 70.28 | 69.83 | **72.87** | 81,790 |
| holdout 2023–2026 | 67.45 | 76.79 | 76.18 | **77.97** | 68,892 |
| all 2016–2026 | 64.83 | 73.25 | 72.73 | **75.20** | 150,682 |

### The margin, honestly

| comparison | design 2016–2022 | holdout 2023–2026 | holdout ex-2024 |
|---|---|---|---|
| BPR − VPR | **+3.05pp** | **+1.79pp** [1.48, 2.11] | +1.25pp |
| BPR − EPA | **+2.60pp** | **+1.17pp** [0.87, 1.49] | **+0.50pp** |
| BPR − OPR | +10.25pp | +10.52pp | — |

> Per-season deltas quoted in F-03 and in Angle G come from `edge-output.txt`,
> which retains surrogate-affected matches; the pooled table above applies the
> harness's D-07 exclusion. The two disagree by less than 0.05pp per season
> (2023: +0.15 vs +0.13, 2025: +0.63 vs +0.59, 2026: +0.68 vs +0.66) — the
> surrogate population is too small to matter, as F-12 measures.

The "~3pp" is real — **on the design era, the seasons BPR was tuned on.** On the
holdout it is 1.2–1.8pp. The ordering the task flagged as "backwards from what
tuning should buy" is in fact the *normal* ordering: BPR's advantage is larger
where it was fitted. Nothing anomalous survives.

Two qualifiers that cut in opposite directions:

- **VPR is promoted** (`11.0.0+rolling-2026-09g`), tuned on a rolling origin that
  includes 2023–2026. Losing to a model that never saw those seasons by 1.79pp is
  still a genuine, non-trivial result.
- **EPA is not tuned at all** (`6.0.0+baseline`; `data/algorithm-versions/` holds
  VPR files only, and `applyPromotedOverrides` branches on `vpr` alone). The
  BPR−EPA gap is a tuned-vs-untuned comparison and should never be quoted as
  evidence about tuning.

### Brier — where the result actually is

| pool | OPR | EPA | VPR | **BPR** |
|---|---|---|---|---|
| design 2016–2022 | 0.2181 | 0.2049 | 0.1956 | **0.1756** |
| holdout 2023–2026 | 0.1911 | 0.1929 | 0.1696 | **0.1487** |

BPR beats VPR by 0.021 and EPA by 0.044 on holdout Brier. Relative to the
accuracy gaps this is enormous, and unlike accuracy it is **consistent across
every season, comp level and event size** — including the champs bucket where
BPR's accuracy is worst (BPR 0.1634 vs VPR 0.1700 vs EPA 0.1855). EPA's holdout
Brier (0.1929) is worse than OPR's (0.1911) despite EPA being 9pp more accurate:
EPA is accurate and badly calibrated. **BPR's defensible claim is calibration.**

### Convention diff

| | `packages/bpr/evaluate.ts` | `core/scoring/brier.ts` + `harness/score.ts` |
|---|---|---|
| no-call (`p == 0.5`) vs decided match | **half credit** (`:40` `correct += 0.5`) | **miss** (D-Q3, `accuracyCall`) |
| actual tie | excluded from accuracy denominator (`decided`) | excluded (`accuracyCall` → `null`) — **same** |
| accuracy denominator | non-tie matches | non-tie matches — **same** |
| Brier denominator | `s.n`, ties included | `count`, "including ties and no-calls" — **same** |
| excluded from scoring | offseason, `event_type = 100`, null score/winner | offseason, **surrogate-affected**, missing result, invalid `pRedWin` |

Only two rows differ. Both measured:

- **No-call convention:** BPR records **0** no-calls in 2023–2026 → the gap is
  **0.000pp** on 78.05%. On the design era it is 0.163pp. (OPR's gap is 3.55pp —
  it has ~5,000 no-calls from event-scoped cold starts, which is why OPR looks so
  much worse under D-Q3 than under half-credit.)
- **Surrogate exclusion:** including them, as `packages/bpr` does, moves BPR's
  holdout accuracy by **−0.002pp**.

So: **the sealed 78.05% was produced under the half-credit convention over the
`data.ts` population; the published per-season figures were produced under D-Q3
over the harness population; and the two conventions differ by less than 0.1pp
for BPR.** The split is a real defect worth closing (P1) but it never inflated
the headline.

### Port fidelity

`packages/bpr/equivalence.ts`:

```
design 2016-2022  port 73.113  research 73.081  delta +0.032pp
holdout 2023-2026 port 78.040  research 78.05   delta -0.010pp
```

The disclosed lazy-vs-eager `carrySeason` divergence is the expected cause and it
is worth ~0.03pp — it cannot move accuracy meaningfully because with
`seasonShrink = 1.0` the mean is untouched either way; only a season-skipping
team's variance differs.

Full decomposition of the sealed number:

```
78.05%   sealed research model, data.ts population, half-credit convention
78.04%   shipped port, same population and convention        (-0.01  port drift)
77.97%   shipped port, shared harness population and D-Q3    (-0.07  convention + population)
```

**Total overstatement: 0.08pp.**

---

## Angle B — leakage and causality

`packages/bpr/model.test.ts:55` flips one synthetic match and compares
**predictions only**, which cannot see state that never reaches `pRedWin`. I closed
that gap with `scripts/leakage-probe.ts`: 4,000 **real** 2024 corpus matches
through the **shipped port**, one match's score flipped to 5–300, diffing the
entire serialized state at every step.

```
flipped match index 2500 (2024cthar_sf9m1)
first PREDICTION that differs:          2501
first FULL-STATE digest that differs:   2501
PASS
```

Structurally this is guaranteed rather than lucky: `update` is pure and returns a
**new** state object, so the value stepped with a match cannot reach the `predict`
that preceded it. And `pRedWin` (`bpr.ts:286-301`) reads only `state.teams` and
`state.logTau` — **`state.scale` never enters the win probability**, only the
display score, so the online scale cannot influence accuracy at all even in
principle.

Ordering (F-10) and population (F-12) are the two places `packages/bpr/data.ts`
genuinely diverges from the shared path. Ordering is a non-issue: 15 adjacent
inversions in 152,457 matches, **none within an event**, because `sort_time`
almost never collides inside one event (1 group in the whole corpus, and its
lexicographic tiebreak happens to agree with play order). The feared
`qm10`-before-`qm2` case does not occur. Population is a real but tiny defect,
measured at −0.002pp.

---

## Angle C — the firewall

**What held.** `frozen-params.json` has exactly one commit (`a66688af`,
01:20:51). `HOLDOUT-RESULT.txt` has exactly one (`07b8ce8a`, 01:23:07). The
2m16s gap is enough for one replay and not a search. All three refusals fire when
actually invoked. The 2026 schema glance was genuinely conservative — it forbade
a design family, and the component split that eventually shipped is display-only
and structurally isolated from `predict`.

**What did not hold, and matters.** `holdout.ts:17-38`'s `assertCommitted` seals
the **parameter file** only. `model.ts` is never checked. The seal is read as
"the model that produced this number is pinned in git"; it actually guarantees
only that the *parameters* were. `model.ts` did change twice after the holdout
ran, and I verified both are inert or disclosed — but that verification took
manual forensics, which is exactly what a seal is supposed to make unnecessary.

**The 2023 slice.** `SLICE-2023-wk0-1.txt` is real holdout data, examined at
01:33 — **after** the 01:23 holdout run, so it did not inform the frozen model.
It did inform commit `22ad2035`, "heteroscedastic observation noise, **diagnosed
from 2023 wk0-1**", which added an `obsSdSlope` knob. That knob is inert at
default (`DEFAULTS.obsSdSlope = 0`), is absent from `frozen-params.json`, and was
explicitly not promoted. **The shipped model is unchanged and 78.05% still
describes it.** The commit message is candid about all of this.

The honest characterisation is not "contamination" but **the holdout is now spent
twice**: once as an evaluation, and once as a diagnostic source for future model
ideas. Any future promotion of `obsSdSlope` inherits that provenance and must say
so (see P3).

---

## Angle D — attribution

**"+3.22pp over a naive additive baseline (69.86 → 73.08)."** The baseline is
built at `ablate.ts:44-58` and it sets **`seasonShrink: 0`** — no cross-season
carryover — alongside `w2=w3=1`, no fast component, no foul adjustment. The same
`DECISION.md` table prices carryover alone at **+1.80pp**. So at least 56% of the
3.22pp is the baseline being denied a season's memory, not BPR's structure. The
distinctive structural work (anti-additivity + two-timescale + foul adjustment) is
worth roughly **1.4pp**, not 3.22pp — and F-23 says even that is an upper bound,
because each ablation holds every other parameter at the full model's optimum
instead of re-tuning around the hole.

**"An independent search on 2016–2019 rediscovered w2=0.7 and w3=0.5 exactly."**
2016–2019 contains 63,667 of the design era's 82,946 matches — **76.8% overlap**.
"Independent" cannot mean much at that overlap. The grid (`tune.ts:77-78`) offers
w2 ∈ {0.6, 0.7, 0.85, 1.0, 1.15} and w3 ∈ {0.2, 0.35, 0.5, 0.6, 0.75, 1.0}, so
"exactly" means "the same point out of 30 coarse combinations". And the two
searches **disagree on most other parameters** — `validation-tune-1619.json` has
obsSd 1.3 (frozen: 1.0), rhoFast 0.96 (0.9), priorVar 0.25 (0.1), rookieMean 0.4
(0.55), tauLr 0.015 (0.005), foulOn true (false), elimWeight 0.5 (1), defQ 0.0002
(0), biasLr 0.001 (0). Reporting the two that matched and not the ten that did not
is selective. Anti-additivity may well be real structure — but this is not the
evidence for it.

**"Five ideas rejected, each under 0.1pp."** KILLED as a concern: `tune.ts`'s grid
genuinely searches all five (`elimWeight` 6 values, `huberK` 7, `biasLr` 5,
`defPriorVar` 5, `defQ` 4, plus the three foul knobs). They landed inert on their
own evidence, not by being pinned. Under F-19's widened 0.45pp bar the rejections
are *safer*, not shakier. This also independently corroborates the repo's own
elim-R negative result (2026-09-05, 6/6 keep-incumbent).

**The doc defect (F-27).** `packages/core/algorithms/bpr.ts:22-27` asserts four
components "each beating a two-standard-error bar (0.31pp)" and then lists
foul-adjusted signal at **+0.30pp**, which is below it. Under the honest 0.45pp
bar, anti-additivity (+0.53pp) is marginal too. The header should say two
components clear the bar comfortably (carryover, two-timescale), one is marginal
(anti-additivity), and one does not clear it (foul adjustment, kept on other
grounds).

---

## Angle E — honest error bars

Event-clustered block bootstrap (resample whole `eventKey` blocks with
replacement, 2,000 draws, paired by `matchKey` across algorithms):

| pool | algo | acc | naive SE | **clustered SE** | design effect |
|---|---|---|---|---|---|
| holdout | BPR | 77.97% | 0.158pp | **0.201pp** | 1.27x |
| holdout | VPR | 76.18% | 0.162pp | 0.203pp | 1.25x |
| holdout | EPA | 76.79% | 0.161pp | 0.200pp | 1.25x |
| design | BPR | 72.87% | 0.155pp | **0.225pp** | **1.45x** |
| design | EPA | 70.28% | 0.160pp | 0.258pp | 1.62x |
| design | VPR | 69.83% | 0.161pp | 0.245pp | 1.53x |

The naive SE `DECISION.md` used (0.154pp) reproduces exactly (0.155pp) — the
arithmetic was right; the independence assumption was not. **The design-era design
effect is 1.45x, so the pre-registered 0.31pp two-sigma bar should have been
~0.45pp.**

Paired differences (much tighter than comparing two marginal CIs, since all four
saw the same matches):

| | holdout combined | holdout quals |
|---|---|---|
| BPR − VPR | +1.79pp, SE 0.160, CI [1.48, 2.11] | +1.83pp, CI [1.47, 2.17] |
| BPR − EPA | +1.17pp, SE 0.156, CI [0.87, 1.49] | +1.07pp, CI [0.72, 1.40] |

Both exclude zero comfortably. The lead is smaller than advertised but it is
**statistically real**.

**Does the parsimony decision flip?** No (F-20). The parsimonious variant was
0.238pp below the full 23-knob model against a 0.31pp bar; under a 0.45pp bar it
is further inside. The decision stands and is now better supported.

**Does anti-additivity still clear?** Undecidable from what I measured (F-21). Its
−0.47pp ablation delta sits 0.02pp above a 0.45pp bar. But ablation deltas are
**paired** comparisons (same model, same matches, one knob changed) and paired SEs
are smaller than the marginal SEs I bootstrapped. I did not measure the
ablation-paired clustered SE, so I will not claim the component fails. Marked
PLAUSIBLE; the settling measurement is in "could not settle".

**Margin-flip noise floor.** Share of decided holdout matches with |p − 0.5| < 0.01:

| OPR | EPA | VPR | **BPR** |
|---|---|---|---|
| 9.19% | 8.61% | 3.73% | **1.82%** |

BPR is by far the most decisive — only 1,257 of 69,154 holdout calls sit on a
hair. That is a point in its favour (its accuracy is not balanced on knife edges)
and it also sets the resolution of any future claim: **treat accuracy improvements
below ~0.5pp on this corpus as unproven.**

---

## Angle F — port fidelity

Covered in Angle A. Two things to record separately:

- `equivalence.ts` is the real port check and it passes: **−0.010pp** on the
  holdout, **+0.032pp** on the design era.
- `260908-pcm`'s headline "152,757 matches compared, 0 prediction mismatches" is
  **not** a port-fidelity proof. Its own text says it replayed "the new module and
  the pre-change module at HEAD" — the phase-component refactor against itself.
  That is a valid and valuable isolation proof for *that* change; it says nothing
  about `packages/core/algorithms/bpr.ts` vs `packages/bpr/model.ts`. Anyone
  citing it for port fidelity should cite `equivalence.ts` instead.

---

## Angle G — what would make BPR genuinely better

Constraints every proposal below respects: the 2023–2026 holdout is spent (next
honest out-of-sample is 2027); no ensembling or blending; new knobs must be inert
at default and earn promotion; Rule A (ship only when accuracy **and** Brier both
improve); no trained GBDT; and none of these adds a fifth published algorithm, so
the `compare` artifact's 93.2%-of-20,000-byte ceiling is untouched.

| # | Proposal | Mechanism | Expected effect (and the evidence for it) | Cost | Spends |
|---|---|---|---|---|---|
| **P1** | **Close the champs deficit** | Make the anti-additivity weights respond to the alliance's own rating spread instead of being global constants. Inert at default: when spread equals the league mean, weights collapse to today's (1, 0.7, 0.5) | The only slice where BPR **loses**: champs-level events, n=5,820, BPR 74.67 vs EPA 76.51 (**−1.84pp**), VPR 75.21 (−0.53pp). Everywhere else BPR leads. Mechanism is plausible on its face — at champs all three alliance members are strong, so rank-suppressing the 2nd and 3rd over-corrects when the true spread is narrow. Upside bounded by the slice: ~+0.15pp pooled holdout, but it removes the model's one embarrassment | Medium — one knob, one rolling-origin design-era tune | **Nothing.** Champs exist in every design year |
| **P2** | **Re-derive the selection bar, then re-audit anti-additivity** | Re-run `ablate.ts` emitting per-match predictions; bootstrap each ablation delta paired by `matchKey` over event blocks | F-19 measured a 1.45x design effect, so the 0.31pp bar is really ~0.45pp and anti-additivity's −0.47pp is within 0.02pp of it (F-21). P1 proposes to build *on that axis*; doing so before knowing whether the axis is real is backwards | Low — one design-era ablation run plus the bootstrap already written | Nothing |
| **P3** | **Unify BPR's measurement path** | Point `packages/bpr/evaluate.ts` at `core/scoring/brier.ts`'s `accuracyCall`, and `data.ts` at `corpus/db.ts`'s `selectMatchesChronological` | No accuracy gain — it *lowers* the design-era figure from 73.081 to ~72.87 by adopting D-Q3 and the shared population. The gain is that every future BPR measurement becomes directly comparable to every historical number, and the class of bug that F-01/F-08/F-12 represent stops being possible. Also: extend `holdout.ts`'s `assertCommitted` to cover `model.ts` (F-15) | Low — half a day | Nothing |
| **P4** | **Understand 2024 before banking it** | Analysis only, on artifacts that already exist. Why do EPA *and* VPR both crater in 2024 (73.5 / 73.3) while BPR holds at 76.8? | BPR's entire pooled holdout lead over EPA rests on this season: ex-2024 it is +0.50pp (F-03). Leading hypothesis worth testing: EPA and VPR both predict by **summing components** while BPR models the total directly, so a season whose scoring concentrates in one component hurts them and not BPR. If that holds it is a durable structural argument for BPR's design — and a standing reason to reject any future component-predicting BPR variant | Low — no new runs, slice the existing four-way jsonl | Nothing |
| **P5** | **Promote `obsSdSlope = 0.35`, for Brier only** | Already implemented and inert at default | Measured in `22ad2035`: design era **+0.078pp accuracy, −0.0003 Brier, −0.0011 log loss** — Rule A satisfied on the design era. But state the two caveats plainly: the accuracy gain is far inside the 0.45pp clustered floor (claim nothing for it), and the *idea* was diagnosed from 2023 weeks 0–1 (F-16), so promotion converts a sliver of the holdout into design input and the provenance must ship with the number | Low — the code exists; needs a design-era Rule-A confirmation run | A sliver of holdout provenance |
| **P6** | **Give BPR a ranking-point model** | BPR emits no `redRpPmf`/`blueRpPmf`, so the rank simulation must fall back to VPR | Pure product value, no accuracy claim: the site's best-calibrated predictor cannot drive its most computational feature. Per-season RP rule differences are the hard part. Validate on 2016–2022 | High | Nothing |

**Ranking rationale.** P1 is first because it is the only *measured* deficit and it
sits on the axis the model's novelty lives on. P2 is second only because it is the
cheap prerequisite that tells you whether P1's axis is load-bearing at all. P3 is
third because it is nearly free and it retires three of this review's findings
permanently. P4 is analysis that could change what you believe about the model for
the cost of an afternoon. P5 is real but small and honest about it. P6 is the
biggest job and buys no accuracy.

**Explicitly not proposed:** any EPA/VPR/BPR blend; any re-tune touching 2023+;
any component-predicting BPR variant (F-17's constraint plus P4's hypothesis both
argue against it); a trained GBDT.

---

## What this review could not settle

1. **The publish-path divergence (F-07).** For 2025 and 2026 the published compare
   figures show a BPR lead 0.3–0.5pp *larger* than the shared-harness recount, while
   2024 agrees. Two candidate causes I could not separate: the published run used an
   earlier promoted VPR (09e/09f rather than 09g), and the publish path pools
   per-event slices rather than counting globally. **Settled by:** re-scoring the
   published generation's own predictions with a global pool, and pinning which VPR
   version that generation used.
2. **Whether anti-additivity clears an honest bar (F-21).** Needs the
   *ablation-paired* clustered SE, not the marginal SE I measured. **Settled by:**
   P2 — one design-era ablation run emitting per-match predictions, then the paired
   bootstrap in `scripts/recount-and-bootstrap.ts`.
3. **Whether the 2024 anomaly is structural or luck (F-03).** One season is one
   observation. **Settled by:** P4's design-era analogue study — find design-era
   seasons with a similarly concentrated scoring distribution and check whether
   component-summing models underperform there too.
4. **Whether the champs deficit is anti-additivity or the fast/form component
   (F-31).** I located the deficit but not its cause. **Settled by:** running the
   existing ablations restricted to the champs slice.
5. **Whether re-tuning the parsimonious model with the widened 0.45pp bar would
   select differently.** The bar only affects *keep/drop* decisions, and F-20 shows
   the one decision it governed does not flip — but I did not re-run the search.

---

## Baseline test state

Recorded before any conclusion was drawn, from the repo root:

```
npx vitest run packages/bpr packages/core/algorithms/bpr.test.ts packages/core/scoring
  Test Files  6 passed (6)      Tests  52 passed (52)

npx vitest run packages/harness          (after the registry line)
  Test Files  44 passed (44)    Tests  1073 passed (1073)
```

Green in isolation, no contention failures observed. The registry line added in
`4c3d16d8` breaks nothing.

## Read-only guarantee

`git status` confirms `packages/bpr/frozen-params.json` is untouched (`git diff
HEAD` empty; still exactly one commit, `a66688af`). No model file was modified. No
artifact was republished, no R2 write occurred, and the holdout was not re-run.
The only production edit is the harness registry line, committed on its own as
`4c3d16d8`.

Evidence files, all under this task's directory:
`recount-output.txt`, `equivalence-output.txt`, `edge-output.txt`,
`scripts/{population-and-ordering,leakage-probe,recount-and-bootstrap,where-the-edge-lives}.ts`,
plus the replay itself at `reports/260908-vqr-fourway/`.
