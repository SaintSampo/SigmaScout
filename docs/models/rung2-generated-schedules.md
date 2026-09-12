# Rung 2 — a rules-based schedule generator, measured against the licensed template grid

**This is an experiment, not a ship.** Nothing here was published, deployed or deleted; `data/schedule-templates/` and `packages/harness/scheduleTemplates.ts` are untouched; `PRESIM_SCHEDULE_COUNT` and `PRESIM_DRAWS_PER_SCHEDULE` keep their shipped values (20 schedules x 50 draws); and the generator is not wired into `publish.ts`.

**Written by `npx tsx scripts/measureGeneratedSchedules.ts --render-doc`, not transcribed from terminal output.** On this project `publish:seasons` prints a payload-budget summary it does not write, and the budget tests stay red until a human copies the numbers across. This record does not reproduce that trap.

Algorithm: `bpr@3.0.0+baseline`. Sample: plan 09-09's six real finished events, re-asserted against `data/corpus.sqlite` at run time.

## Phase A — the seed-noise ceiling, and what it does to the acceptance bar

The rung-1 criterion's clause 1 asks that at least 95% of teams agree within 0.5 median ranks. Before any candidate arm can be judged against that, there is a prior question: **can the measurement itself resolve half a rank?** Phase A answers it by running the **licensed** construction against **itself** and reading how far it disagrees with its own replicate. Nothing about a candidate enters, so whatever rate comes back is a **ceiling** every arm shares, including the one currently shipping.

`drawsPerSchedule` is held **fixed at 50** (the shipped value) at every count, so the only thing varying down the table is the number of schedules. Varying both at once would conflate "more schedules" with "more draws".

### Two floors, and only one of them binds

**Draw-only floor.** The licensed arm's own priced schedules re-simulated at two draw seeds. Both sides see the *identical* set of team-to-slot shuffles, so this isolates Monte-Carlo draw noise. This is the control plan 09-09 used, and on its own it is **not** the number that governs a two-arm comparison.

**Resampling floor — the one that binds.** The licensed construction built **twice**, with fully independent shuffle-and-draw streams at the same count. A candidate arm draws its *own* K shuffles, so the disagreement it has to survive includes "which K shuffles did each side happen to draw", not just "which draws did each side happen to take". The two replicates are obtained by salting `algorithmVersion`, which in `buildPreScheduleArtifact` feeds the shuffle and baked seed hashes and nothing else — pricing is the same bound `predict` closure on both sides.

The gap between the two columns below is large and it matters: the draw-only floor reaches 100% while the binding floor is still near 80%. A concurrent session's rung-2 work (`docs/models/random-vs-generated-schedules.md`) raises exactly this criticism of the seed-only control, and it lands on this table with equal force, so the binding floor is measured here rather than argued about. Its n=1000 value independently reproduces that session's separately-built 74.2% at `2025cur`.

### Clause-1 ceiling per event, read `draw-only / resampling`

| Event | Teams | n=20 | n=150 | n=300 | n=600 | n=1000 | n=2000 | n=4000 |
|---|---|---|---|---|---|---|---|---|
| `2022on034` | 14 | 100.0% / **57.1%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** |
| `2023gaalb` | 21 | 85.7% / **61.9%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** |
| `2024caav` | 40 | 67.5% / **27.5%** | 100.0% / **52.5%** | 100.0% / **80.0%** | 100.0% / **92.5%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** |
| `2025cur` | 76 | 55.3% / **11.8%** | 84.2% / **40.8%** | 98.7% / **48.7%** | 100.0% / **61.8%** | 100.0% / **73.7%** | 100.0% / **88.2%** | 100.0% / **97.4%** |
| `2026joh` | 75 | 64.0% / **13.3%** | 85.3% / **22.7%** | 93.3% / **41.3%** | 98.7% / **48.0%** | 100.0% / **65.3%** | 100.0% / **85.3%** | 100.0% / **97.3%** |
| `2026txmca` | 18 | 100.0% / **83.3%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** |
| **POOLED** (roster-weighted) | **244** | 68.4% / **27.0%** | 90.6% / **50.0%** | 97.5% / **62.7%** | 99.6% / **70.9%** | 100.0% / **81.1%** | 100.0% / **91.8%** | 100.0% / **98.4%** |

### Pooled, with the extrapolated count clause 1 would need

| n | Total draws | Draw-only c1 | **Binding c1** (needs >= 95.0%) | Binding mean \|d median\| | Binding pooled 95th pct | Binding worst team | Binding c2 p10 / p90 (needs >= 90.0%) | Extrapolated n for clause 1 |
|---|---|---|---|---|---|---|---|---|
| 20 | 1,000 | 68.4% | **27.0%** | 2.039 | 6.190 | 10.61 | 54.5% / 52.9% | ~3,066 |
| 150 | 7,500 | 90.6% | **50.0%** | 0.770 | 2.346 | 4.44 | 79.1% / 74.2% | ~3,302 |
| 300 | 15,000 | 97.5% | **62.7%** | 0.538 | 1.833 | 3.13 | 86.1% / 84.8% | ~4,033 |
| 600 | 30,000 | 99.6% | **70.9%** | 0.381 | 1.247 | 1.97 | 90.6% / 92.2% | ~3,732 |
| 1000 | 50,000 | 100.0% | **81.1%** | 0.275 | 0.878 | 1.17 | 96.7% / 99.2% | ~3,084 |
| 2000 | 100,000 | 100.0% | **91.8%** | 0.192 | 0.598 | 1.13 | 99.2% / 100.0% | ~2,860 |
| 4000 | 200,000 | 100.0% | **98.4%** | 0.129 | 0.412 | 0.71 | 100.0% / 100.0% | ~2,720 |

The final column is an **extrapolation**, labelled as one. Clause 1 is satisfied exactly when the pooled 95th percentile of `|median_A - median_B|` falls to 0.5 ranks, and the binding floor's mean scales as `n^(-1/2)` across every count measured (2.039 -> 0.770 -> 0.538 -> 0.381 -> 0.275 -> 0.192 -> 0.129 against counts rising 20 -> 4000). Under that scaling `requiredCount = measuredCount * (q95 / 0.5)^2`. It is printed at **every** count on purpose: a drifting answer would mean the scaling assumption fails and the number should not be relied on.

### Is 95% reachable, and at what count

**Yes — measured directly at n=4000 schedules** (200,000 draws), where the binding ceiling reaches 98.4%. The extrapolation from **every** measured count agrees with that and is stable: it puts the crossing between roughly 2,700 and 4,000 schedules, and the direct measurements bracket it (91.8% at n=2,000, 98.4% at n=4,000).

At the **shipped** 20 schedules the binding ceiling is **27.0%**. So clause 1 is unreachable today by **any** method, including the licensed path that is live — a fact about the measurement's resolution, not about any candidate. Anything scored against clause 1 at the shipped count is scoring noise.

No measured count reaches a 99.0% binding ceiling, so the later phases run at **n=4000** and the residual 1.6pp of floor is carried explicitly into reading their verdicts rather than quietly ignored.

The n=20 draw-only pooled figure reproduces plan 09-09's independently recorded 68.4% exactly, which is the check that this harness is the same harness.

## Artifact size — the priced schedules are almost the whole file

Measured on the real artifacts by serialising them twice: once whole, once with the `schedules` block emptied — i.e. **baking only the aggregate rank distribution** the first-paint band actually reads. Not estimated from a fraction.

| Event | Teams | n | Full bytes | `schedules` block | Aggregate-only bytes | `schedules` share |
|---|---|---|---|---|---|---|
| `2022on034` | 14 | 20 | 52,816 | 51,283 | 1,535 | 97.1% |
| `2022on034` | 14 | 150 | 386,194 | 384,661 | 1,535 | 99.6% |
| `2022on034` | 14 | 300 | 770,842 | 769,309 | 1,535 | 99.8% |
| `2022on034` | 14 | 600 | 1,540,187 | 1,538,654 | 1,535 | 99.9% |
| `2022on034` | 14 | 1000 | 2,565,749 | 2,564,216 | 1,535 | 99.9% |
| `2022on034` | 14 | 2000 | 5,129,984 | 5,128,451 | 1,535 | 100.0% |
| `2022on034` | 14 | 4000 | 10,258,798 | 10,257,265 | 1,535 | 100.0% |
| `2023gaalb` | 21 | 20 | 105,973 | 103,030 | 2,945 | 97.2% |
| `2023gaalb` | 21 | 150 | 775,819 | 772,876 | 2,945 | 99.6% |
| `2023gaalb` | 21 | 300 | 1,548,827 | 1,545,884 | 2,945 | 99.8% |
| `2023gaalb` | 21 | 600 | 3,094,108 | 3,091,165 | 2,945 | 99.9% |
| `2023gaalb` | 21 | 1000 | 5,154,542 | 5,151,599 | 2,945 | 99.9% |
| `2023gaalb` | 21 | 2000 | 10,306,354 | 10,303,411 | 2,945 | 100.0% |
| `2023gaalb` | 21 | 4000 | 20,609,385 | 20,606,442 | 2,945 | 100.0% |
| `2024caav` | 40 | 20 | 189,592 | 181,209 | 8,385 | 95.6% |
| `2024caav` | 40 | 150 | 1,368,367 | 1,359,984 | 8,385 | 99.4% |
| `2024caav` | 40 | 300 | 2,728,383 | 2,720,000 | 8,385 | 99.7% |
| `2024caav` | 40 | 600 | 5,448,226 | 5,439,843 | 8,385 | 99.8% |
| `2024caav` | 40 | 1000 | 9,074,818 | 9,066,435 | 8,385 | 99.9% |
| `2024caav` | 40 | 2000 | 18,141,102 | 18,132,719 | 8,385 | 100.0% |
| `2024caav` | 40 | 4000 | 36,275,314 | 36,266,931 | 8,385 | 100.0% |
| `2025cur` | 76 | 20 | 422,815 | 394,597 | 28,220 | 93.3% |
| `2025cur` | 76 | 150 | 2,987,863 | 2,959,645 | 28,220 | 99.1% |
| `2025cur` | 76 | 300 | 5,947,057 | 5,918,839 | 28,220 | 99.5% |
| `2025cur` | 76 | 600 | 11,866,661 | 11,838,443 | 28,220 | 99.8% |
| `2025cur` | 76 | 1000 | 19,757,614 | 19,729,396 | 28,220 | 99.9% |
| `2025cur` | 76 | 2000 | 39,487,635 | 39,459,417 | 28,220 | 99.9% |
| `2025cur` | 76 | 4000 | 78,942,585 | 78,914,367 | 28,220 | 100.0% |
| `2026joh` | 75 | 20 | 386,423 | 359,121 | 27,304 | 92.9% |
| `2026joh` | 75 | 150 | 2,721,651 | 2,694,349 | 27,304 | 99.0% |
| `2026joh` | 75 | 300 | 5,415,899 | 5,388,597 | 27,304 | 99.5% |
| `2026joh` | 75 | 600 | 10,805,210 | 10,777,908 | 27,304 | 99.7% |
| `2026joh` | 75 | 1000 | 17,991,406 | 17,964,104 | 27,304 | 99.8% |
| `2026joh` | 75 | 2000 | 35,955,003 | 35,927,701 | 27,304 | 99.9% |
| `2026joh` | 75 | 4000 | 71,883,380 | 71,856,078 | 27,304 | 100.0% |
| `2026txmca` | 18 | 20 | 104,632 | 102,296 | 2,338 | 97.8% |
| `2026txmca` | 18 | 150 | 768,152 | 765,816 | 2,338 | 99.7% |
| `2026txmca` | 18 | 300 | 1,533,343 | 1,531,007 | 2,338 | 99.8% |
| `2026txmca` | 18 | 600 | 3,064,694 | 3,062,358 | 2,338 | 99.9% |
| `2026txmca` | 18 | 1000 | 5,105,467 | 5,103,131 | 2,338 | 100.0% |
| `2026txmca` | 18 | 2000 | 10,209,502 | 10,207,166 | 2,338 | 100.0% |
| `2026txmca` | 18 | 4000 | 20,415,674 | 20,413,338 | 2,338 | 100.0% |

**The aggregate-only size does not depend on the schedule count at all** — it is one roster-length x roster-length histogram block, identical whether it was accumulated over 20 schedules or 1000. That is the finding with the most leverage in this document: raising the schedule count is what closes the seed-noise gap in Phase A, and if only the aggregate is baked, raising it is **free on the wire**.

## Caveats

- **Neither arm is validated against realised rankings.** Every number here measures agreement between two forecasts, not the accuracy of either. The rewind-honesty question is `docs/models/rewind-overconfidence-gap.md`'s.
- **The seed-noise ceiling is a diagnostic and may never overrule the criterion.** It says what a rate would look like if two arms were identical and only the draw stream differed; it does not lower a threshold.
- **The licensing judgement is not made here.** This document measures whether a generated structure can stand in for the licensed one; whether it should is the developer's call alone, and no licence text was read or reasoned about in producing it.
- **Phase B and C build each schedule as its own single-schedule artifact**, so a schedule at index k takes seed `...|shuffle|0` rather than `...|shuffle|k`. That changes which random stream each schedule draws, never how — and the size of that effect is exactly what Phase A reports.

