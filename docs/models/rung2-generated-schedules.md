# Rung 2 — a rules-based schedule generator, measured against the licensed template grid

**This is an experiment, not a ship.** Nothing here was published, deployed or deleted; `data/schedule-templates/` and `packages/harness/scheduleTemplates.ts` are untouched; `PRESIM_SCHEDULE_COUNT` and `PRESIM_DRAWS_PER_SCHEDULE` keep their shipped values (20 schedules x 50 draws); and the generator is not wired into `publish.ts`.

**Written by `npx tsx scripts/measureGeneratedSchedules.ts --render-doc`, not transcribed from terminal output.** On this project `publish:seasons` prints a payload-budget summary it does not write, and the budget tests stay red until a human copies the numbers across. This record does not reproduce that trap.

Algorithm: `bpr@3.0.0+baseline`. Sample: plan 09-09's six real finished events, re-asserted against `data/corpus.sqlite` at run time.

## Verdict

**At the schedule count where the acceptance bar is usable at all, the rules-based generator is indistinguishable from the licensed grid.** Compared at the SAME count n=4,000, the generated structure agrees with the licensed one on **97.1%** of teams within half a median rank (clause 1 needs 95%), with **every** team inside one rank, **100.0% / 99.6%** at the band edges, and a mean signed shift of -0.0018 ranks. **All three clauses pass.**

That 97.1% sits against a same-construction ceiling of **98.4%** at the same count — the licensed grid measured against its own replicate. The generator is therefore within **1.2pp** of the best any method could score, which is another way of saying the remaining disagreement is not distinguishable from resampling noise.

**Against what ships today the generated arm scores 39.3% and fails — and so does the licensed grid, by the same amount.** The control (licensed structure at the same high count, differing from the shipped arm in the count and nothing else) scores 39.3%. The failure belongs entirely to the shipped 20-schedule arm's resolution, which Phase A measures directly, and not to the generator.

**What this does and does not license.** It says a generated structure reproduces the licensed one's rank bands to within the measurement's own noise, and that the artifact-size objection to a high schedule count dissolves if only the aggregate is baked. It does NOT say the shipped default should change, it does not touch the licensing question, and it is not a validation of either arm against realised rankings.

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
| `2022on034` | 14 | 20 | 52,351 | 51,283 | 1,070 | 98.0% |
| `2022on034` | 14 | 150 | 385,870 | 384,661 | 1,211 | 99.7% |
| `2022on034` | 14 | 300 | 770,625 | 769,309 | 1,318 | 99.8% |
| `2022on034` | 14 | 600 | 1,540,016 | 1,538,654 | 1,364 | 99.9% |
| `2022on034` | 14 | 1000 | 2,565,600 | 2,564,216 | 1,386 | 99.9% |
| `2022on034` | 14 | 2000 | 5,129,887 | 5,128,451 | 1,438 | 100.0% |
| `2022on034` | 14 | 4000 | 10,258,597 | 10,257,062 | 1,537 | 100.0% |
| `2023gaalb` | 21 | 20 | 104,902 | 103,030 | 1,874 | 98.2% |
| `2023gaalb` | 21 | 150 | 775,183 | 772,876 | 2,309 | 99.7% |
| `2023gaalb` | 21 | 300 | 1,548,234 | 1,545,884 | 2,352 | 99.8% |
| `2023gaalb` | 21 | 600 | 3,093,847 | 3,091,165 | 2,684 | 99.9% |
| `2023gaalb` | 21 | 1000 | 5,154,336 | 5,151,599 | 2,739 | 99.9% |
| `2023gaalb` | 21 | 2000 | 10,306,167 | 10,303,411 | 2,758 | 100.0% |
| `2023gaalb` | 21 | 4000 | 20,609,276 | 20,606,330 | 2,948 | 100.0% |
| `2024caav` | 40 | 20 | 186,301 | 181,209 | 5,094 | 97.3% |
| `2024caav` | 40 | 150 | 1,366,406 | 1,359,984 | 6,424 | 99.5% |
| `2024caav` | 40 | 300 | 2,726,674 | 2,720,000 | 6,676 | 99.8% |
| `2024caav` | 40 | 600 | 5,447,164 | 5,439,843 | 7,323 | 99.9% |
| `2024caav` | 40 | 1000 | 9,074,182 | 9,066,435 | 7,749 | 99.9% |
| `2024caav` | 40 | 2000 | 18,140,799 | 18,132,719 | 8,082 | 100.0% |
| `2024caav` | 40 | 4000 | 36,274,934 | 36,266,518 | 8,418 | 100.0% |
| `2025cur` | 76 | 20 | 410,707 | 394,597 | 16,112 | 96.1% |
| `2025cur` | 76 | 150 | 2,980,309 | 2,959,645 | 20,666 | 99.3% |
| `2025cur` | 76 | 300 | 5,940,908 | 5,918,839 | 22,071 | 99.6% |
| `2025cur` | 76 | 600 | 11,861,514 | 11,838,443 | 23,073 | 99.8% |
| `2025cur` | 76 | 1000 | 19,753,700 | 19,729,396 | 24,306 | 99.9% |
| `2025cur` | 76 | 2000 | 39,486,455 | 39,459,417 | 27,040 | 99.9% |
| `2025cur` | 76 | 4000 | 78,939,118 | 78,910,886 | 28,234 | 100.0% |
| `2026joh` | 75 | 20 | 374,772 | 359,121 | 15,653 | 95.8% |
| `2026joh` | 75 | 150 | 2,714,412 | 2,694,349 | 20,065 | 99.3% |
| `2026joh` | 75 | 300 | 5,410,015 | 5,388,597 | 21,420 | 99.6% |
| `2026joh` | 75 | 600 | 10,800,253 | 10,777,908 | 22,347 | 99.8% |
| `2026joh` | 75 | 1000 | 17,987,845 | 17,964,104 | 23,743 | 99.9% |
| `2026joh` | 75 | 2000 | 35,953,897 | 35,927,701 | 26,198 | 99.9% |
| `2026joh` | 75 | 4000 | 71,885,864 | 71,858,544 | 27,322 | 100.0% |
| `2026txmca` | 18 | 20 | 103,776 | 102,296 | 1,482 | 98.6% |
| `2026txmca` | 18 | 150 | 767,611 | 765,816 | 1,797 | 99.8% |
| `2026txmca` | 18 | 300 | 1,532,889 | 1,531,007 | 1,884 | 99.9% |
| `2026txmca` | 18 | 600 | 3,064,443 | 3,062,358 | 2,087 | 99.9% |
| `2026txmca` | 18 | 1000 | 5,105,242 | 5,103,131 | 2,113 | 100.0% |
| `2026txmca` | 18 | 2000 | 10,209,296 | 10,207,166 | 2,132 | 100.0% |
| `2026txmca` | 18 | 4000 | 20,414,282 | 20,411,943 | 2,341 | 100.0% |

**The aggregate-only size grows only logarithmically in the schedule count, while the full artifact grows linearly.** The aggregate is one roster-length x roster-length histogram block; raising the count does not add entries to it, only digits inside them. Measured on `2025cur`: 16,112 bytes at the shipped n=20 against 28,234 bytes at n=4000 — a 200x increase in schedules for a 1.75x increase in bytes, while the whole artifact goes from 411 KB to 79 MB over the same range.

That is the finding with the most leverage in this document. Phase A shows the acceptance bar only becomes usable at a high schedule count, and a high schedule count is unshippable if the priced schedules are baked. If only the aggregate is baked, the count is **nearly free on the wire** — and the artifact gets smaller than what ships today, not larger.

## Phase B — the generator's balance, side by side with the licensed structure

The generator's rules, fixed before measurement (`packages/harness/generatedSchedules.ts`):

1. **Exact appearance count.** `ceil(numTeams * matchesPerTeam / 6)` matches; every team gets exactly `matchesPerTeam` ranking-credited appearances; the leftover slots become surrogate appearances on that many distinct teams — the licensed grid's own convention, read off it structurally rather than re-invented.
2. **No team twice in a match**, by construction.
3. **Minimise repeats**, under the stated objective `3 * excessPartnerPairs + 1 * excessOpponentPairs + 1 * backToBackCount`. Partners are weighted heaviest because same-alliance outcomes are coupled far more tightly than opposing ones.
4. **Spread**, via a per-candidate recency penalty toward the natural spacing `matchCount / matchesPerTeam`.

Greedy randomised construction with restarts; best-of-`restarts` by the objective above. `generated` rows are the **mean over 20 independently seeded generated structures** per event.

| Event | Structure | Matches | Credited/team | Surrogates | Repeat-partner rate | Repeat-opponent rate | Back-to-back rate | Mean gap | Min gap | Max idle gap |
|---|---|---|---|---|---|---|---|---|---|---|
| `2022on034` | licensed | 21 | 9-9 | 0 | 28.6% | 52.4% | 24.1% | 2.32 | 1 | 5.0 |
| `2022on034` | generated (mean of 20) | 21 | 9-9 | 0 | 29.8% | 52.3% | 22.7% | 2.32 | 1 | 4.5 |
| `2023gaalb` | licensed | 42 | 12-12 | 0 | 19.8% | 47.6% | 0.0% | 3.49 | 2 | 7.0 |
| `2023gaalb` | generated (mean of 20) | 42 | 12-12 | 0 | 23.1% | 45.3% | 9.4% | 3.49 | 1 | 7.5 |
| `2024caav` | licensed | 74 | 11-11 | 4 | 0.0% | 13.4% | 0.0% | 6.65 | 3 | 12.0 |
| `2024caav` | generated (mean of 20) | 74 | 11-11 | 4 | 2.5% | 15.0% | 0.3% | 6.64 | 1.2 | 13.6 |
| `2025cur` | licensed | 127 | 10-10 | 2 | 0.0% | 0.1% | 0.0% | 12.65 | 6 | 24.0 |
| `2025cur` | generated (mean of 20) | 127 | 10-10 | 2 | 0.1% | 3.3% | 0.0% | 12.63 | 6.55 | 19.3 |
| `2026joh` | licensed | 125 | 10-10 | 0 | 0.0% | 0.0% | 0.0% | 12.50 | 6 | 24.0 |
| `2026joh` | generated (mean of 20) | 125 | 10-10 | 0 | 0.1% | 3.4% | 0.0% | 12.46 | 6.4 | 19.1 |
| `2026txmca` | licensed | 36 | 12-12 | 0 | 29.6% | 54.0% | 0.0% | 3.00 | 2 | 5.0 |
| `2026txmca` | generated (mean of 20) | 36 | 12-12 | 0 | 31.6% | 53.0% | 12.0% | 3.00 | 1 | 6.5 |

### Generated vs licensed at the SAME schedule count

Both arms built at the same count, through the same `buildPreScheduleArtifact`, the same bound `predict`, the same rounding and the same per-schedule seeding convention. **The only surviving difference is the pairing structure**, which is what makes this a measurement of generator quality rather than of draw count. Scored by the unchanged rung-1 criterion.

| Comparison | Clause 1 (median, >=95% within 0.5 and every team within 1.0) | Clause 2 (edges, >=90% within 1.0) | Clause 3 (mean signed shift, +/-0.25) | Overall |
|---|---|---|---|---|
| generated n=1000 vs licensed n=1000 | FAIL — 75.8%; every team within 1.0: false (worst 1.85) | PASS — p10 95.5%, p90 95.1% | PASS — -0.0013 | **FAIL** |
| generated n=4000 vs licensed n=4000 | PASS — 97.1%; every team within 1.0: true (worst 0.77) | PASS — p10 100.0%, p90 99.6% | PASS — -0.0018 | **PASS** |

## Phase C — the ship test

The generated arm at n=4000 against **what is shipping today** (licensed structure, 20 schedules x 50 draws), scored by the same unchanged criterion. This comparison necessarily carries the shipped arm's own seed noise, quantified in Phase A.

| Comparison | Clause 1 (median, >=95% within 0.5 and every team within 1.0) | Clause 2 (edges, >=90% within 1.0) | Clause 3 (mean signed shift, +/-0.25) | Overall |
|---|---|---|---|---|
| generated n=4000 vs SHIPPED licensed n=20 | FAIL — 39.3%; every team within 1.0: false (worst 6.26) | FAIL — p10 57.0%, p90 59.0% | PASS — -0.0255 | **FAIL** |
| **CONTROL** — licensed n=4000 vs SHIPPED licensed n=20 (count change only) | FAIL — 39.3%; every team within 1.0: false (worst 6.15) | FAIL — p10 57.8%, p90 57.4% | PASS — -0.0237 | **FAIL** |

**Attribution.** Phase A measured that the shipped arm disagrees with its own replicate on 73.0% of teams, so any comparison against it is dominated by *its* resolution rather than by anything about the candidate. The control row differs from the shipped arm in the schedule count and **nothing else** — same licensed structure, same builder, same scorer. The candidate scores 39.3% on clause 1 and the control scores 39.3%, so **the generator can be responsible for at most 0.0pp** of the difference from what ships today. The rest is the shipped count.

Per event:

| Event | Teams | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |
|---|---|---|---|---|---|
| `2022on034` | 14 | 78.6% | 100.0% | 100.0% | -0.050 |
| `2023gaalb` | 21 | 95.2% | 100.0% | 100.0% | -0.050 |
| `2024caav` | 40 | 35.0% | 65.0% | 65.0% | 0.002 |
| `2025cur` | 76 | 15.8% | 40.8% | 42.1% | -0.016 |
| `2026joh` | 75 | 29.3% | 38.7% | 44.0% | -0.044 |
| `2026txmca` | 18 | 94.4% | 100.0% | 100.0% | -0.005 |

## Caveats

- **Neither arm is validated against realised rankings.** Every number here measures agreement between two forecasts, not the accuracy of either. The rewind-honesty question is `docs/models/rewind-overconfidence-gap.md`'s.
- **The seed-noise ceiling is a diagnostic and may never overrule the criterion.** It says what a rate would look like if two arms were identical and only the draw stream differed; it does not lower a threshold.
- **The licensing judgement is not made here.** This document measures whether a generated structure can stand in for the licensed one; whether it should is the developer's call alone, and no licence text was read or reasoned about in producing it.
- **Phase B and C assemble each arm one schedule at a time**, calling `buildPreScheduleArtifact` with `scheduleCount: 1` so the pairing structure can differ between schedules. The per-schedule shuffle stream is preserved by suffixing `algorithmVersion`, which feeds the seed hashes and nothing else, and the assembler asserts it got as many distinct shuffle seeds as it built schedules — without that, every schedule in an arm would share one shuffle and the arm would do no shuffle averaging at all.
- **The generator's balance is measured over 20 sampled structures per event, not over all 4,000.** The reported rates are stable to the decimal place across those 20, but they are a sample.

