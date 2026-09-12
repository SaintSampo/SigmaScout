# EPA divergences from Statbotics (D-13)

D-13 (`.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md`): "Faithful core, our plumbing. Match the algorithm that matters ... using our own component extraction, skip Statbotics' per-season post-processing quirks ... Every deliberate divergence must be documented with its reasoning." This file is that record — every point at which SigmaScout's `epa.ts` reimplementation deliberately produces a different number than Statbotics' own `EPARating`/`EPA` classes would, and why.

Statbotics' source, verified verbatim against `github.com/avgupta456/statbotics` during this phase's research (`.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md`, fetched 2026-08-13): `backend/src/models/epa/{math,main,init,constants,breakdown}.py`, `backend/src/breakdown.py`.

**See `docs/models/epa-vs-statbotics.md` (quick task 260904-4aa, re-measured 260904-5px) for the measurement these divergences predict.** Every deliberate divergence listed below is a reason SigmaScout's EPA does not land at an OLS slope of exactly 1.0 against Statbotics' own per-team `epa.total_points`. §1 (elimination-match handling) is now CLOSED (see below) — the remaining ones are §3 (no per-season post-processing), the independently-derived component maps, and Pitfall EPA-1's expanding-window win-probability scale, plus the offseason-population effect (§7, NARROWED as of `epa@6.0.0+baseline`) and the season-boundary carry scale anchor (§8, NARROWED as of `epa@8.0.0+baseline`). That document is the committed, re-runnable per-team comparison (SC-2).

**Version status of the quoted figures. SHIPPING MODEL IS NOW `epa@9.0.0+baseline` (quick task 260911-j2w, 2026-09-11): EPA's win-probability denominator and its season-boundary carry anchor both read a FROZEN WEEK-1 aggregate from week 2 onward, and the live expanding estimate during week 1 only (§4 below). REPUBLISH DEBT IS NOW CUMULATIVE AND UNPAID: 8.0.0 already owed one and it was never run, and 9.0.0 adds a second. Every published EPA rating and every published `pRedWin` on the live site predates BOTH. `scripts/epaVsStatbotics.ts --check` was ALREADY failing against `data/baselines/epa-vs-statbotics-2026-09.json` under 8.0.0 and still fails; that is pre-existing and was deliberately NOT re-baselined by j2w.**

**Previous status, retained because every paragraph below is written against it. SHIPPING MODEL WAS `epa@8.0.0+baseline` (quick task 260911-3kc, 2026-09-11): the season-boundary carry scale anchor is corrected, so a carried rating enters a new season in THAT season's point units (§8 below). Every "beats EPA" and every Statbotics-agreement figure in this document, in `epa-vs-statbotics.md`, and in `data/baselines/epa-vs-statbotics-2026-09.json` was measured against an EARLIER EPA and is stale until re-run; `scripts/epaVsStatbotics.ts --check` will now fail, and that failure is correct rather than a regression. A REPUBLISH IS OWED — published EPA ratings change — and had not been run when 8.0.0 landed.**

**Previous status, retained because the paragraph below is still written against it. SHIPPING MODEL WAS `epa@7.0.0+baseline` (quick task 260910-5ym, 2026-09-10), and the agreement figures in the paragraph below had NOT been re-measured under it.** 7.0.0 changed two things that move per-team ratings: 2024's component map is grouped at phase granularity (§6), and the win-probability denominator is re-seeded per season instead of pooled across all of them (§4). The second cannot move a per-team total at all — it only scales `pRedWin` — but the first changes 2024's EWMA dynamics, so 2024's agreement row genuinely needs re-running. `scripts/epaVsStatbotics.ts --check` is the gate, and until it is re-run against `data/baselines/epa-vs-statbotics-2026-09.json` the 6.0.0 status below is history rather than a live claim.

Re-measured under `epa@6.0.0+baseline` on 2026-09-08 (quick task 260908-615, §7): the offseason-inclusive min-matches-arm slope range is now **0.82-0.96**, with Pearson 0.91-0.98. `scripts/epaVsStatbotics.ts --check` PASSED, so `data/baselines/epa-vs-statbotics-2026-09.json` is unchanged and its bands still gate the shipped model. Full per-season before/after table: `epa-vs-statbotics.md` §"Carry-instant change (`epa@6.0.0+baseline`)".

**No stale figure remains on this line as of 2026-09-08 (quick task 260908-n5o).** This paragraph previously named the offseason-EXCLUDED range (0.95-1.01) as "the one stale number on this line", retained from the retired `epa@2.0.0+baseline` and never re-run under 5.0.0 or 6.0.0. That arm has now been re-measured under the shipping model, over the full 2022-2026 season set rather than 2022-2025: the min-matches arm reads **slope 0.970-1.014, Pearson 0.993-0.998**, and the all-teams arm 0.972-1.014 with Pearson 0.991-0.998. Both arms of the A/B now come from one model version and one season set. See `epa-vs-statbotics.md` §"Offseason inclusion materially widens the gap".

**Live source for the site, and what it actually measures.** The explainer at `/methodology/epa-vs-statbotics` reads one published object, `v1/methodology/epa-vs-statbotics.json`. As of quick task 260908-n5o it carries a THIRD arm, not either of the two above: each team’s rating at its own LAST OFFICIAL MATCH, which is the number the Teams list and the team-page header actually display (`publish.ts`’s `lastOfficialMetricsByTeam`; `apps/web/src/lib/officialSnapshot.ts`). Both arms above measure a SEASON-FINAL rating that no surface on this site shows, so scoring against them understated agreement with Statbotics: official-only reads slope 0.970-1.014 and Pearson 0.993-0.998, against the offseason-inclusive 0.82-0.96 and 0.91-0.98. Each published row carries `basis: "last-official-match"` so the object names its own quantity. This narrows §7 in practice: offseason play still moves a rating within a season, but it no longer reaches the published comparison at all, and the offseason A/B has been retired from the page. The offseason-inclusive arm still gates the committed tolerance bands via `--check`.


## 1. Elimination matches — CLOSED as of `epa@5.0.0+baseline` (was D-08: full weight and counted, not discounted)

**CLOSED 2026-09-04 (quick task 260904-5px, D-05).** This project adopted BOTH halves of
Statbotics' elimination handling described below: the one-third outer EWMA weight on every
elimination-match observation (`EPA_ELIM_WEIGHT`, `packages/core/algorithms/epa.ts`), and the
per-team match counter that does not advance on an elimination match (`applyComponentUpdate`'s
`isElimination ? matchCount : matchCount + 1`). The developer's goal is for SigmaScout's EPA to
track the real Statbotics as closely as possible, and this divergence — the single largest
remaining rating-mechanics reason the measured slope sat below 1.0 — is now closed rather than
carried forward. What follows is the historical record of the divergence AS IT STOOD before this
adoption; it is kept, not deleted, because a future reader auditing what changed and why needs the
"before" half of the story.

**What this project measured, closing the "Why" paragraph's open question below:** the original
"Why" reasoning said the walk-forward harness itself would show whether adopting Statbotics'
discount was worth it, rather than assuming it a priori. That question is now answered by
measurement, not assumption — see `docs/models/epa-vs-statbotics.md`'s before/after table
(`epa@2.0.0+baseline` vs `epa@5.0.0+baseline`) for the per-season OLS slope, Pearson, mean absolute
difference, and win-probability accuracy/Brier movement the adoption produced, and whether
agreement with Statbotics got tighter or looser as a result.

**Statbotics:** `update_team` applies `ELIM_WEIGHT = 1/3` to every elimination-match observation's outer EWMA blend, and does **not** increment the team's match counter for elim matches — so an elim match both moves a team's rating less than a qual match and never advances the decaying learning-rate schedule (`percent_func`).

**This project (historical, pre-`5.0.0+baseline`):** `epa.ts`'s `update()`/`applyComponentUpdate()` called `twoStageEwma(..., percent, 1)` — `weight` was always `1`, never Statbotics' `1/3` discount — and `epaPercentFunc`'s match counter incremented on every match, elims included (`nextCounts.set(team, matchCount + 1)`, unconditional).

**Why (historical):** D-08 locked this as a deliberate divergence: elimination matches were learned from normally — predict, then update, treated as ordinary observations. Statbotics' own elim-discount reflects an assumption (elim matches are less representative of a team's "true" ability, perhaps due to strategic/alliance-selection effects) that this project did not adopt without evidence; the walk-forward harness itself (Brier score, sliced by `compLevelView` including `elimination`) was named as the mechanism that would show if this choice costs accuracy, rather than assuming Statbotics' discount is correct a priori — see the measurement note above for how that question was resolved.

**Effect (historical):** EPA's ratings moved faster per elim match, and the per-team learning-rate schedule decayed faster overall (since elims counted toward the same 12-match threshold `percent_func` uses to reach its floor of `0.2`) than the equivalent Statbotics computation over the identical match history.

## 2. Fouls — NARROWED as of `epa@10.0.0+baseline`: the PREDICTION half is retired, the component survives

**NARROWED 2026-09-11 by quick task 260911-l2k. Read this before the rest of the section, because
the headline sentence below is now HISTORY for the prediction path.** Statbotics' foul model is
now REPRODUCED: `epa.ts:predictCore` computes the margin, the logistic scale and `pRedWin` from the
two NO-FOUL totals with no foul term anywhere, then multiplies BOTH published scores by one shared
`(1 + foulRate)` — `main.py:125-130`, reference section 14. Because the multiplier is a single
scalar applied identically to both alliances, fouls can no longer move the predicted winner or the
win probability, and a test pins `pRedWin` bitwise invariant to any `foulsCommitted` value. The
rate is `foulMean / noFoulMean` over Statbotics' week-1 population, frozen at the seal
`epaWeekOne.ts` already owned and live-estimated only during week 1.

**WHAT THIS DOES NOT RETIRE, stated first so nothing below reads as withdrawn.** `foulsCommitted`
is still a per-team rated component, still derived from the OPPOSING alliance's raw `foulPoints`,
still published as its own `teamMetrics` entry, still `carrySeason`'s fouls-INCLUSIVE carryover
input, and still the quantity `fallbackObserved` nets out of an imputed observation. Everything
this section says about WHAT the component means and HOW it is learned still holds exactly. Only
the sentence about `predict()` adding it to the opponent's score is retired.

Verdict in `docs/models/epa-statbotics-gap.md`'s matrix moved `GAP` -> `DELIBERATE DIFFERENCE` for
mechanism 5 in all nine seasons: the placement is closed outright, and the only remainder is that
the rate is live-estimated during week 1 (L-01, register R3 item 3).


**Statbotics:** multiplies a no-foul predicted score by a season-level foul rate — `red_score * (1 + foul_rate)` — a single scalar correction applied uniformly, not a per-team learned quantity.

**This project:** models `foulsCommitted` as its own per-team component (D-04), derived per `breakdown/*.ts`'s `parse()` from the **opposing** alliance's raw `foulPoints` field (`result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints`) — the points an alliance's own fouls cost the *other* side. **RETIRED 2026-09-11 (l2k) — this sentence described `predict()` until `epa@10.0.0+baseline` and is kept only so the change is legible:** `predict()` then adds each side's OWN offensive total to the OPPONENT's predicted `foulsCommitted`, never its own: `redScore = redOffensiveTotal + blueComponents[FOULS_COMMITTED_COMPONENT].mean`. Red's and blue's foul means are different numbers, so that term moved the margin and therefore the predicted winner — the inverse of what Statbotics does, which is why it went. `redOffensiveTotal` itself is unchanged and is now the no-foul total the shared scalar multiplies.

**Why (as recorded at the time; the PREDICTION half of this rationale no longer applies as of l2k — a predicted total now takes the alliance-wide multiplier after all, and only the per-team RATING survives):** D-04 explicitly requires a per-team fouls-committed component so a predicted total includes the opponent's expected foul contribution, rather than a single alliance-wide multiplier. This is also the component D-04 names as the identifiability check's weakest member (see `docs/models/sigma1-identifiability.md`) — fouls are sparse (30-65% of matches carry any recorded foul, per season) and the cross-alliance attribution adds a wrinkle a uniform scalar correction never has to handle.

**Correction recorded here (not a new divergence, a bug fix to this divergence's implementation):** commit `a0ec5d54` fixed `epa.ts`'s `predict()`, which had previously summed an alliance's OWN `foulsCommitted` mean into its OWN predicted score (backwards — crediting a team's fouls to itself, and omitting the opponent's fouls entirely) rather than the opposing alliance's, as D-04 actually specifies and as `sigma1/index.ts` had implemented correctly from the start (flagged as WINDOWS.md entry 3 by plan 02-04, now resolved). Every EPA number in this phase's `reports/full-v2/artifact.json` and this SUMMARY is from a run at or after that fix; no pre-fix EPA figure is cited anywhere in this phase's published output.

**Second correction recorded here (code review, phase 02, CR-01):** `predict()`'s D-04 cross-attribution above was correct, but `update()`'s D-05 fallback path (a match with no `score_breakdown`, `epa.ts`'s `fallbackObserved`) had a related bug in the SAME quantity: it fed a fraction of an alliance's own actual score into that alliance's own `foulsCommitted` slot, and never netted the opponent's predicted foul contribution out of the alliance's own score before splitting it across offensive components — silently reintroducing the exact cross-alliance misattribution D-04/`a0ec5d54` had already closed for `predict()`, just in the fallback update path instead. Fixed in `dc6b841b`: the fallback split now mirrors `predict()`'s own formula exactly (own score net of the opponent's predicted `foulsCommitted`, split across offensive components only), and `foulsCommitted` itself is carried forward unchanged rather than synthesized (genuinely unobservable without a real breakdown). Every EPA number in `reports/full-v2/artifact.json` as of this correction is from a run at or after `dc6b841b`; see `02-06-SUMMARY.md`'s regeneration note for whether this fix moved the head-to-head figures.

**Third correction recorded here (D-01, quick task 260904-5px) — this divergence NARROWED, not withdrawn:** the per-team, cross-attributed `foulsCommitted` component described above still exists exactly as written and still drives match prediction — `predict()` is untouched by this correction. What changed is the PUBLISHED per-team metric: `epa.ts`'s `teamMetrics()` now excludes `foulsCommitted` from `total`, matching Statbotics' own no-foul `epa.total_points` (verified live: `frc254`/2024's `total_points` 51.71 reconciles against auto + teleop + endgame alone, with no foul term). `foulsCommitted` is still published as its own per-team entry — only its membership in the summed `total` moved. This creates a deliberate ASYMMETRY worth stating plainly: `carrySeason()`'s cross-season carryover input stays the fouls-INCLUSIVE per-team sum (pinned by a dedicated test in `epa.test.ts`), so the published `total` and the quantity carried across a season boundary are now two different numbers for any team that has ever committed a foul. VPR's own `total` (`sigma1/index.ts`) is unaffected by this correction and keeps summing every component including its own `foulsCommitted` — D-01 and D-05 are scoped to EPA alone, since EPA exists specifically to match Statbotics and VPR does not.

## 3. No per-season post-processing (D-13)

**Statbotics:** `post_process_breakdown`/`post_process_attrib` apply per-year quirks on top of the raw EWMA — most notably a 2018-specific switch/scale sigmoid transform, plus per-year clamps on specific components.

**This project:** `epa.ts` runs no equivalent step. The raw two-stage EWMA output (`twoStageEwma`) is the team's component mean, full stop — no season-specific sigmoid, no clamp.

**Why:** D-13 explicitly scopes the "faithful core" match to the algorithm that matters (the EWMA update, the decaying learning rate, elim weighting policy, init/carryover scheme, the win-probability form) and explicitly excludes "Statbotics' per-season post-processing quirks." The general exclusion (no per-year clamps either) is a standing policy, not a one-off skip.

**CORRECTION (quick task 260910-x09, 2026-09-11) — the second half of this justification was "2022-2026 (this project's covered seasons) postdate 2018, so the switch/scale sigmoid would not fire for any season this project scores regardless," and that is now FALSE.** The corpus was backfilled to 2016 (`project_corpus_backfill_playbook`), so the covered seasons are 2016-2019 and 2022-2026, and **2018 is scored today** — 16,889 scorable matches of it. The sigmoid fires on a season this project scores, which turns this from a moot exclusion into a live, unmeasured deviation. The standing-policy half of the reasoning above is untouched and still stands on its own; only the "never fires" convenience argument is withdrawn.

**Still unmeasured, and why.** `scripts/measureEpaDeviations.ts` could not build an arm for this: the sigmoid's exact FORM was never transcribed into this repo. D-13, `02-CONTEXT.md` and `02-RESEARCH.md` all NAME it (and list `zero_sigmoid`/`unit_sigmoid` among the functions fetched during 2026-08-13's research session) but no transcription of either body survives. Implementing a guessed sigmoid would measure an invention rather than the divergence, so the harness reports `unmeasurable-no-reference` instead of approximating. Closing this means re-fetching Statbotics' `backend/src/models/epa/{math,breakdown}.py` — a research step, not a harness step.

### 2018's zero-sum Scale — the structural measurements, and the standing decision NOT to port the sigmoid (2026-09-12)

Salvaged here from the `2018-anti-additivity-treatment` todo when that todo was deleted. It named
this document as the proper home for both halves ("this project's stated discipline is measured
divergence, and `docs/models/epa-divergences.md` is where such a decision would have to be argued
and recorded"), and the todo itself was retired because the deficit it existed to close is gone:
on live `bpr@3.0.0` 2018 now runs **+0.02pp** (74.37% vs Statbotics' 74.35%), where the VPR-era
measurement it was written against recorded -2.59pp.

**The decision, restated as a standing one.** Do not port Statbotics' 2018 switch/scale sigmoid on
the grounds that they have one. That is the general policy in the section above, and 2018 is the
season where it is most tempting to make an exception, so it is recorded specifically. Two
independent reasons:

1. **The evidence never supported it.** Across the ten-season walk-forward replay, 2018 — the one
   season that structurally violates the additivity assumption every one of these models rests on —
   had the **4th-smallest** deficit of ten, measured against a competitor that *has* the
   2018-specific correction we lack. If the missing sigmoid were costing us, 2018 should sit at the
   wrong end of that table. It did not then, and at +0.02pp it does not now.
2. **A per-season treatment is a season-conditional branch**, which this codebase has deliberately
   avoided. §3 above is the standing precedent for not adding one.

**Three structural measurements about 2018, kept because they are real and would be expensive to
re-derive.** Measured 2026-09-06 over full-season official quals:

| measurement | value |
|---|---|
| `corr(red totalPoints, blue totalPoints)`, all points | **-0.4567** |
| the same, with Scale-derived points removed | **-0.0642** (additivity essentially restored) |
| `teleopScaleOwnershipSec` red-vs-blue correlation | **-0.9109** (near-perfectly zero-sum) |
| `teleopSwitchOwnershipSec` red-vs-blue correlation | -0.1362 (ordinary) |
| Scale-derived points per alliance-side | 65.5 mean, an **18.8%** share of an alliance's own total |

So the anti-additivity is real, large, and localised to exactly one component pair. What does not
exist is any evidence that treating it would help.

**What was done for 2018, and what that is not.** `breakdown/2018.ts` SPLITS the Scale from the
Switch in both auto and teleop — seven own components, not the five a naive port would give — a
locked user decision of 2026-09-07, reconstructing TBA's own fused halves exactly (0 mismatches in
28,312 official qual alliance-sides). **That is a data-shape decision that keeps a treatment
reachable; it is not itself a treatment.** Verified 2026-09-08: `autoScaleOwnership` and
`teleopScaleOwnership` appear nowhere outside `breakdown/2018.ts` and `groups.ts`'s display
buckets. No algorithm treats them differently from any other component.

**The bar, if anyone ever reopens this.** Rule A on 2018 — improves both winner accuracy and Brier —
*and* no other season degrades.

**One open ablation, deliberately NOT run.** The corpus-extension job flagged that parameters
selected on a window containing 2018 may transfer worse to normal seasons, and proposed comparing
origin-2022 parameters selected with and without 2018. **Do not run it.** Two reasons, and the
second is decisive: BPR's parameters were frozen on a 2016-2022 window that contains 2018 and spent
once against a sealed 2023-2026 holdout, which is a direct answer to the exact transfer risk the
ablation was written to probe; and running it means re-tuning BPR, which Jacob has barred outright
(2026-09-09). It is recorded as declined, not as pending.

## 4. Win-probability scale — NARROWED as of `epa@9.0.0+baseline`: a FROZEN WEEK-1 SD from week 2 on, the expanding-window SD during week 1

### NARROWED 2026-09-11 (quick task 260911-j2w): the Statbotics constant is a WEEK-1 number, and SigmaScout now adopts it

**Everything below this block was written when this section believed Statbotics' `year_obj.score_sd` was a SEASON-FINAL constant. It is not.** `backend/src/data/avg.py` (`docs/models/statbotics-breakdown-reference.md` section 21, verbatim) opens `process_year` with

```python
    week_one_matches = [
        m for m in matches if m.week == 1 and m.status == MatchStatus.COMPLETED
    ]
```

and computes `year.score_sd` — along with every other `Year` aggregate — from that list alone. So the denominator Statbotics divides by is a WEEK-1 statistic.

**That changes the verdict, not just the wording.** A week-1 aggregate is knowable the moment week 1 ends, so reading it for a week-2-or-later match is not outcome leakage at all — every match it summarises has already been played. The leakage objection below is correct ONLY for week 1 itself.

`epa@9.0.0+baseline` therefore:

- accumulates a **week-1-only** alliance-score Welford accumulator alongside the season-wide one (`packages/core/algorithms/epaWeekOne.ts`);
- **freezes** it on the first match carrying a numeric week greater than 0, which in a chronological stream proves every week-1 match has already passed — no lookahead, so no walk-forward violation;
- divides by that **frozen week-1 SD** for every remaining match of the season;
- divides by the **live expanding-window SD** during week 1 itself, byte-identical to `8.0.0`.

**This is an EXACT target, not a neighbour.** `avg.py` computes `year.score_sd` from the RAW alliance score with fouls INCLUDED (`no_foul_mean` keeps only its mean; its SD is discarded into `_`), and the raw alliance score is exactly what `epa.ts` already folds. The carry ANCHOR's mean target is a named neighbour — see `epa-statbotics-gap.md`'s R3 entry, residual gap 1.

**The off-by-one this turns on.** This corpus stores TBA's week 0-indexed, so Statbotics' `week == 1` is this corpus's `week === 0`. Verified against `data/corpus.sqlite` in every season rather than asserted, and pinned by `epaWeekOne.test.ts`. Getting it backwards calibrates on the wrong week and nothing visibly fails.

**Null-week play is UNPLACED.** Championship, preseason and offseason events carry `week = null`; in 2024 that is 143 events and 6,255 played matches spanning 2024-02-03 to 2024-12-27. Such a match never joins the week-1 population and never triggers the freeze.

**Two costs, named.** (1) The seal happens inside `update`, so the season's first week-2 match is predicted before the freeze and still reads the live estimate — one match per season. (2) A late week-1 arrival (a multi-day week-0 event running a match on the day a week-1 event opens) is excluded rather than reopening the frozen value, so the population can be slightly smaller than Statbotics' offline `week_one_matches` list.

**PUBLISHED-SURFACE DEBT created and discovered here, unpaid as of this commit.** `/methodology/epa-vs-statbotics`'s `win-probability-scale` entry (`apps/web/src/components/methodology/epaComparisonContent.ts`) tells readers that Statbotics "uses one number for the whole season, calculated only once the season is over". The `avg.py` transcription above disproves the second half of that sentence: the number is computed from week 1, not from the finished season. The same entry's description of SigmaScout's side is now INCOMPLETE rather than false — "a running measure that only knows about matches played so far" still holds of the frozen week-1 aggregate, but the entry does not mention the freeze. Quick task 260911-j2w deliberately did NOT edit that entry: its own scope pinned three surfaces, and this page's content set is a locked decision. It is recorded here as an owed correction, to be made alongside the republish this version owes.

### The original section, retained because the paragraphs below are written against it

**Statbotics:** `predict_match` divides the score margin by `year_obj.score_sd`, described here as a season-level constant computed once. Corrected above: it is a WEEK-1 aggregate.

**This project:** `epa.ts`'s `predict()` divides by `standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD)` — an expanding-window Welford SD (`packages/core/scoring/expandingStats.ts`) folded match-by-match as `update()` runs, seeded at a season boundary from the prior season's final value (`epa.ts`'s `carrySeason`), falling back to a documented constant (`EPA_FALLBACK_SCORE_SD = 25`) before at least 2 observations exist.

**CORRECTION (quick task 260910-5ym, 2026-09-10) — the "seeded at a season boundary" clause above was FALSE as shipped, and is now true.** `carrySeason` passed the whole accumulator across the boundary, observation count included. That is not a seed: a seed fades as the new season's own data arrives, and it cannot fade while the prior seasons' count comes with it. The denominator therefore pooled every alliance score the replay had ever seen, across FRC point scales that move by 5x between seasons (2018 alliances averaged 292 points, 2019 averaged 55). Measured on the production offseason-inclusive arm: by 2024 the accumulator held 282,192 observations against that season's own 44,198 — 15.7%, unable to outvote the pool — and read an SD of 106.4 where 2024's own was 27.2. The logistic was ~3.9x too flat, which put 88.7% of the season's predictions inside [0.4, 0.6], left exactly one above 0.82, and made the published 0.6-0.7 calibration bin resolve at 95.6%. Rescoring the identical replay with a per-season scale moved 2024's Brier from 0.2204 to 0.1764 with winner accuracy unchanged to four decimals, since the scale cannot change `sign(margin)`. Across all ten seasons the absolute log of (pooled SD / season SD) correlates 0.930 with each season's Brier excess over Statbotics. `carrySeason` now calls `reseedFromPrior(stats, EPA_SCORE_SD_SEED_COUNT)`: the prior season's SD and mean survive the boundary, its observation count does not. See quick task 260910-4x0 for the full measurement.

**Why:** RESEARCH.md's Pitfall EPA-1: using Statbotics' season-FINAL `score_sd` as-is for a week-1 match's win-probability scale is outcome leakage — the prediction would be informed by variance data from matches not yet played, directly undermining the walk-forward guarantee (predict-before-update, PITFALLS.md Pitfall 3) this entire project's evaluation methodology depends on. The mathematical FORM of the logistic (natural-exp, algebraically identical to Statbotics' base-10 `k_func` form) is preserved faithfully per D-13; only the source of the scale denominator changes, and it changes because the season-batch version cannot be computed walk-forward at all — SC-2 itself ("EPA runs walk-forward at any point in a season") is not achievable with Statbotics' literal `score_sd`.

## 5. Variance — every component carries `±`, not a mean alone (this project's core value, contrasted with EPA's own docstring)

**Statbotics:** `EPARating`'s own docstring states outright: "does not handle covariance between variables" — `EPARating` carries a `mean` only, no variance, no spread.

**This project:** `epa.ts` reproduces this exactly — `EpaState.teamComponents` is a plain `Record<string, number>` per team, and `teamMetrics()` returns `{ value }` with no `spread` field (D-27's contract makes `spread` optional precisely so EPA can omit it honestly rather than fabricate one). Sigma1, the OTHER algorithm this phase ships, is the one that carries variance on every component (D-01/D-03/D-10) — the entire thesis of PROJECT.md's core value ("Sigma-family metrics are displayed as `X ± Y`").

**Why:** This is not a "fix" to Statbotics' EPA — it is a faithful reproduction of what Statbotics' EPA actually is (mean-only), stated explicitly here so a reader does not mistake EPA's lack of `±` for an oversight. The variance gap between EPA and Sigma1 is the entire point of building both: EPA is the honest, faithful, variance-free baseline; Sigma1 is the variance-carrying alternative this project is built to prove out.

## 6. Component extraction — this project's own per-season maps, and Statbotics has no partition to compare them to

**Statbotics:** rates a PER-TEAM vector of named quantities, indexed by the per-season list built in `backend/src/breakdown.py` (`all_keys[year]`), sums that vector component-wise across the alliance, and then predicts a match score from `get_score_from_breakdown`. For 2024 that branch is `score = breakdown["no_foul_points"]` — one entry of the summed vector. The rest of the vector is still rated, still updated every match, and published beside the score rather than summed into it.

**This project:** `packages/core/algorithms/breakdown/{2016..2026}.ts` are this project's own independently-built per-season component maps (D-02), verified directly against this project's own ingested corpus (`data/corpus.sqlite`) rather than ported from Statbotics' table. Granularity was chosen per season during plan 02-01/02-02, using Statbotics' own grouping as a starting reference (D-01) but re-derived independently against this project's own field inventory, per the clean-slate mandate (REBUILD_SPEC.md). EPA predicts a score by summing every rated component.

### CORRECTED 2026-09-11 (quick task 260911-j2w): both sides rate a per-team vector, and the difference is one of DEGREE

**This sub-section previously carried a heading and a closing paragraph asserting that the two implementations differ in kind rather than in grouping, on the grounds that Statbotics rates a single quantity for an alliance while SigmaScout rates and sums several. That assertion is RETRACTED.** It was written by quick task 260911-gfe from the shape of `all_keys[year]` alone, before `predict_match` had been transcribed. Reference section 3 carries that function verbatim:

```python
pred_mean = np.array([self.epas[t].mean for t in teams]).sum(axis=0)
```

`self.epas[t].mean` is an 18-entry vector, and `.sum(axis=0)` is a component-wise sum across the three teams. **Statbotics rates a per-team vector and sums it across the alliance, structurally the same thing SigmaScout does.** Every entry keeps being rated, updated by `attribute_match` every match, and published by `post_record_team`, whether or not a predicted score ever reads it.

What actually differs is **which entries the predicted score reads back out** (reference section 18, per season):

| season | own entries read | opponent entries read |
|---|---|---|
| 2016, 2017, 2019, 2022, 2024, 2025, 2026 | `no_foul_points` only | none |
| 2018 | 7 | 3 |
| 2023 | 7 | none |

2016 and 2017 additionally read two RP entries in ELIMINATION matches only. 2018 and 2023 read their seven entries **non-linearly**, through `min()` caps and `zero_sigmoid` terms, so neither is a component sum in SigmaScout's sense. The difference is therefore one of **degree inside a shared structure**: how many entries feed the score, and through what function.

What the retracted paragraph got RIGHT, and which stands unchanged: `all_keys[year]` is a rated-quantity LIST rather than an additive partition, and it double-counts by construction:

- It carries `no_foul_points` beside `auto_points`, `teleop_points` and `endgame_points`, which that first key is the SUM of. Statbotics validates exactly that identity: `error = no_foul_points - (auto_points + teleop_points + endgame_points)`.
- `comp_0..comp_9` are sub-elements WITHIN those phases, not independent score sources.
- `rp_1`/`rp_2`/`rp_3`/`tiebreaker_points` are not score contributions at all.
- In 2022 and 2026, `endgame_points` appears twice in the same list.

So there is still no "Statbotics component partition" that a SigmaScout map can be diffed against entry-for-entry, and an arm built by hand-picking a non-overlapping subset of those keys would measure this project's own construction under Statbotics' name. The full transcription, its provenance limits, and a per-season verdict table (`yes` / `no-overlapping-keys` / `no-rates-a-single-quantity` / `not-established`, one row per season 2016-2026, each citing its evidence) live in **`docs/models/statbotics-breakdown-reference.md`**. Summary of that table: **no season is `partition-constructible: yes`**. Note that the `no-rates-a-single-quantity` label in that table describes what the 2024 predicted score READS, not what the model rates; read it with this correction in hand.

### The injection seam now exists, and the blocker moved rather than closed

Quick task 260910-x09 filed this deviation as `unmeasurable-in-this-harness`, naming the missing seam: `epa.ts`'s `update()` and `carrySeason()` resolved the component map internally, so no `scripts/` wrapper could intercept it. **Commit b62c3655 added that seam** — an optional `SeasonComponentMap` parameter on `epa.update`, `epa.carrySeason` and `tryParseBreakdownPair`, inert at its default, with the inertness proven by a full-state replay test rather than asserted. `componentMapArm()` in `scripts/measureEpaDeviations.ts` builds an arm on it and is unit-tested.

The register entry is therefore now `unmeasurable-no-reference`, not `unmeasurable-in-this-harness`: the machinery exists and there is nothing to point it at. `ARM_IDS` is deliberately unchanged. Registering an arm over a non-overlapping subset hand-picked out of `comp_*` keys would measure this project's own construction while labelling it Statbotics', which is the error corrected immediately below.

### Label correction: the 0.7461 figure is OURS, not Statbotics'

`experiments/260910-4x0/granularity.ts` carries an arm labelled *"Statbotics comp partition (leave/auto/tele/eg)"*. That label is wrong. The arm is a four-way grouping THIS PROJECT assembled from `comp_*` names; no such partition exists in Statbotics. The measurement (0.7461) is real and is kept. Only the attribution is corrected, in `deviationRegister()`'s `component-map` `priorMeasurement.values` and here. Do not delete the number.

### 2024 NARROWED (quick task 260910-5ym, 2026-09-10): its map is now COARSER than Statbotics', not finer

The granularity choice this section used to defend — 2024's five separate note-point components, eleven offensive components in total — was measured and cost accuracy. 2024 carried the most granular map of any season (13 components against a median of 9) on the season with the second-lowest score variance in the corpus, so eleven noisy per-team EWMAs, each estimated from roughly a dozen quals, were summed into every predicted alliance total. Four additive partitions were replayed off one shared carry and scored on 2024's 16,764 decided official matches:

| partition | winner accuracy | what it is |
|---|---|---|
| eleven offensive components | 0.7348 | the retired 2024 map |
| a four-way grouping from `comp_*` names | 0.7461 | **this project's own construction** (was mislabelled "Statbotics' comp partition") |
| phase groups auto/teleop/endgame | **0.7520** | the shipped 2024 map |
| a single no-foul total | 0.7403 | **Statbotics' ACTUAL 2024 target** |

2024's map is now the phase-group partition, matching `groups.ts`'s existing 2024 grouping and the three phase keys Statbotics' own validation checks against.

**What faithfulness would cost, for 2024, stated as a number:** copying what Statbotics actually rates (the single no-foul total) scores 0.7403 against the shipped 0.7520, so roughly 1.2 percentage points of winner accuracy. These four figures come from a scratch scorer and are comparable to EACH OTHER only. Never difference one of them against a published figure, which counts ties.

Two things worth stating so this is not over-generalised. First, **the curve turns over**: collapsing to a single total is WORSE than three groups, so "fewer components is better" is not the lesson and must not be propagated to another season without measuring that season the same way. Second, **`groups.ts` is not a shortcut to a faithful phase partition for other seasons** — its grouping is a declared judgement that deliberately disagrees with TBA's own roll-ups in 2016, 2019 and 2022 (its own header says so), and Statbotics computes its phase keys per year in code this repo has never transcribed. Building a phase arm out of `groups.ts` would reproduce exactly the mislabelling corrected above. See `statbotics-breakdown-reference.md` §9.

**Why:** D-02 requires per-season, data-driven component maps (never hardcoded branches); each season's map is built and Zod-validated against this project's own corpus (T-02-01/ASVS V5 — every read field asserted finite, unknown fields stripped rather than passed through). Divergent granularity is an accepted consequence of independent re-derivation, not a defect — the harness's own accuracy measurement is what would surface a granularity choice that costs accuracy, not a requirement to match a table that turns out not to be a table.

## 7. Data population — offseason play. NARROWED (not closed) as of `epa@6.0.0+baseline`

Unlike §§1-6, this is not a rating-mechanics divergence at all: it is a difference in *which matches each system's rating has ever seen*. It was measured rather than assumed (quick task 260904-4aa; see `docs/models/offseason-inclusion-remeasurement.md` and `epa-vs-statbotics.md`'s own offseason A/B table), and on the offseason-inclusive production arm it is the single largest contributor to residual per-team disagreement.

**Statbotics:** its published team-year EPA reflects the OFFICIAL season only, through championships. Verified live 2026-09-08: `/v3/events?year=2025` returns 203 events, **none** flagged offseason, and `team_year` carries no offseason field. Statbotics does not ingest offseason matches at any layer — no event pages, no rating updates, no predictions, no accuracy scoring.

**This project:** production publishes with `--include-offseason`, so offseason matches are replayed and DO move ratings within the season they occur in. Scoring has always excluded them on both sides, so the published accuracy comparison was never affected by this.

### What quick task 260908-615 changed (2026-09-08)

**NARROWED, not closed.** EPA's cross-season prior is now taken at the season's **last OFFICIAL match** (`AlgorithmModule.carryFrom: "last-official-match"` → `WalkForwardSimulator.runAll`'s `carryStates`), instead of the season-final state that had kept learning through offseason and preseason play. An exhibition result in November can no longer seed a team's rating for the following February.

**What remains divergent, stated precisely:**

1. **Within-season offseason play still moves ratings.** Under `--include-offseason` an offseason match is still replayed and still updates the rating, inside the season it occurs in. Only the CARRY across the boundary is rewound.
2. **Unofficial play BEFORE a season's last official match still reaches the snapshot.** This is the accepted limitation of the locked decision (snapshot-at-last-official-match, not an exact official-only shadow state — CONTEXT.md's D-CARRY). Only the season's tail of exhibition play is excluded. Closing it would require threading a second, parallel state through every replay; deliberately not built.
3. **Preseason Week-0 nuance.** `buildSeasonStream`'s `excludeOffseason` filters the corpus's `is_offseason` column, which TBA event type 100 does not set, while `isOfficialEventType` excludes both 99 and 100. So an offseason-EXCLUDED run is unchanged by 6.0.0 only when its stream also carries no Week-0 matches.

**Predicted direction against Statbotics: closer agreement — predicted before the run, then measured and confirmed (2026-09-08).** Statbotics' own priors are championship-frozen, so removing an offseason tail from ours moves the two systems' cross-season seeding toward each other. `--check` PASSED (all 25 gated statistics inside their existing bands; the committed baseline JSON needed no re-measurement), and agreement got tighter on all three statistics in essentially every season: slope rose toward 1.0 in four seasons and held flat in the fifth, Pearson rose in all five, and mean absolute difference fell in all five. No season moved away on any statistic. The per-season table lives in `epa-vs-statbotics.md` rather than being duplicated here.

**Display-layer note (same quick task, separate concern).** The team page header and the Teams list now show W-L-T, `matchCount` and `eventCount` over official play only, matching what Statbotics' comparable surfaces count. This changes no rating and no prediction; offseason matches remain fully visible in each team's match table, event sections and metric-history chart.


## 8. Season-boundary carry scale anchor — NARROWED as of `epa@8.0.0+baseline`

**What the divergence was.** `carryover.ts`'s `epaCarryover` derived one `{mean, sd}` pair from the OUTGOING season's per-team point totals and used that same pair for BOTH directions of the normalized-to-points conversion. Every team therefore entered a new season still expressed in **last season's point units**. When FRC's scoring scale moves between games — and it moves a lot — that is not a small error: 2018 alliances averaged 291.84 points and 2019 alliances averaged 55.41, so every rating carried into 2019 was inflated by roughly 5.3x on the first day of the season.

**This contradicted the project's own recorded reference, so it was a port defect rather than a design choice.** `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md` D-16 and `02-RESEARCH.md` transcribe Statbotics' `init.py` verbatim as converting the carry into the **NEW** season's point units. `carryover.ts`'s header described the outgoing-season anchor as a discretionary placeholder a later phase might replace; it was neither discretionary nor a placeholder, it was a mistranscription of a reference this repo already held. It would have been worth fixing at neutral accuracy.

**This NARROWS an existing divergence rather than adding one** — the same framing §7 uses. It does not close it. See "What remains divergent" below.

### What changed (quick task 260910-x09 measured it, 260911-3kc landed it)

`epaCarryover` is **unchanged**. It still converts both directions with the outgoing season's distribution, which keeps its own round trip self-consistent. The correction is composed **on top**, lazily, per team, on **first sight** in the new season, by `epa.carrySeason`/`predict`/`update` reading `packages/core/algorithms/epaCarryScale.ts`:

- `carrySeason` captures the outgoing alliance-score mean into `EpaState.carrySeedMean` before delegating, and marks every carried team pending.
- On a team's first appearance, `cleanSeasonMean` unwinds the `EPA_SCORE_SD_SEED_COUNT` prior-season pseudo-observations out of the accumulator to recover the incoming season's own mean, and `carryRescaleRatio` divides it by the seed mean.
- `predict` applies that factor transiently (temp components, predict, discard); `update` applies it permanently and then runs the ordinary update. Both read the same pre-update accumulator, so they agree by construction.

### The measured effect

Nine seasons (2016-2019, 2022-2026), 147,221 scored matches, 1,653 event blocks, paired and event-blocked against `epa@7.0.0+baseline`, scored with the published scorer (ties counted in Brier).

| scope | winner accuracy | Brier |
|---|---|---|
| pooled, as shipped (`minObs = 250`) | **+0.01038** [+0.00823, +0.01265] | **-0.00528** [-0.00644, -0.00418] |
| pooled, plain fix (`minObs = 100`) | +0.01059 [+0.00846, +0.01285] | -0.00521 [-0.00638, -0.00412] |
| **2019 season** (as shipped) | **+0.07716** [+0.06510, +0.08923] | **-0.04252** [-0.04961, -0.03562] |

**The pooled figure is 2019 averaged across nine seasons, not a broad gain.** 2018 -> 2019 is the one boundary in the corpus where the point scale collapses ~5x, and 2019 is the one season that moves; every other season sits inside ±0.6pp on accuracy. That concentration was **pre-registered as the mechanism test**: a uniform effect across every boundary would have REFUTED the mechanism even with a good-looking pooled number. It concentrated exactly where the scale moved, so the test passed. Describe the result that way rather than as a general accuracy improvement.

### Where it is WORSE

Stated plainly, because a change that is only ever described by its wins is not a measurement.

- **2018 Brier: +0.00052, 95% [+0.00030, +0.00076] — WORSE, interval excludes zero.** The only definitive per-season regression anywhere in the run. Tiny, but real, and it does not go away at any of the three thresholds tested.
- **The ONSET window — the first 500 scorable matches after each boundary, pooled — was the plain fix's honest weak spot.** At `minObs = 100` it measured **+0.00184 Brier [+0.00005, +0.00365], WORSE**: the live per-season scale estimate is noisy before the season has shown much, so an early conversion trades a confidently-wrong scale for a correct-but-uncertain one. It paid that back many times over across the season, but it was not free at the instant of the boundary.
- **Raising the threshold removed that onset cost.** At the shipped `minObs = 250` the pooled onset Brier against un-fixed EPA is **-0.00020 [-0.00162, +0.00128], INDISTINGUISHABLE** — the regression is gone rather than merely smaller. That was the explicit question the threshold refinement was run to answer, and this is its answer.

### How the shipped threshold was chosen, and what is NOT confirmed about it

`EPA_CARRY_RESCALE_MIN_OBS = 250`. The candidate set `{100, 250, 500}` and the selection rule were written down, printed and serialized into `data/diagnostics/epa-deviation-ablation.json` **before the corpus was opened**: primary = pooled onset Brier measured against the incumbent 100 arm with a 95% interval excluding zero; guards = reject on a definitively worse pooled-season accuracy or Brier; tie-break = take the smaller threshold; default = keep 100 if nothing clears the bar. Both challengers passed, so 250 won on the tie-break (onset Brier -0.00203 [-0.00339, -0.00068] against the incumbent, season accuracy indistinguishable, season Brier -0.00007 [-0.00013, -0.00001]).

**That margin over the plain `minObs = 100` fix was selected on THE SAME NINE SEASONS it was measured on, with no held-out confirmation.** The carryover fix itself is independently evidenced against un-fixed EPA; the extra 150 observations of deferral are not. Quote the threshold with that caveat attached.

### What remains divergent — this is narrowed, NOT closed

**Statbotics runs offline and simply KNOWS the incoming season's scale before it converts anything. A walk-forward replay cannot.** At the instant a boundary is crossed, the incoming season has been observed zero times. So the incoming scale is ESTIMATED from that season's own folded alliance scores, and only once at least 250 of them exist. A team first seen before that threshold is materialized at ratio 1 and **forfeits its rescale permanently** — its components have already absorbed this season's observations by the time the ratio becomes readable, and rescaling that blend later would be worse than not rescaling at all.

Measured census across the eight non-cold-start boundaries, read off the shipped state:

| | team-boundaries |
|---|---|
| carried across a boundary | 37,258 |
| rescaled on first sight | 23,429 |
| **rescale deferred (forfeited)** | **1,649** |
| **never seen again in the season they were carried into** | **12,192** |

(At `minObs = 100` the deferral count was 809; the shipped 250 roughly doubles it, which is the trade the onset improvement was bought with. The three rows do not sum exactly to the carried total — a 12-team residual across nine seasons — because a carried team that appears in a match while holding no component record leaves the pending set without landing in either bucket.)

The `neverSeen` row is the larger number and is not a defect of this fix: those teams did not play in the season they were carried into, so no prediction was ever made from their carried rating. They are reported because a reader comparing "carried" against "rescaled" would otherwise read the gap as a failure rate.

The label the artifact and the code both carry for this is `approximation: "closest-walk-forward-legal"`. It is never described as parity with Statbotics.

### One thing this did NOT change

`teamMetrics` is untouched. A team that has been carried but has not yet played in the new season still publishes its carried rating in the OUTGOING season's units, exactly as the measured arm did. Correcting the display would be an unmeasured change to a published number, so it was left alone rather than folded in silently.

---

*Phase: 02-prediction-models-epa-sigma1 (plan 02-06)*
*Statbotics source citations verified 2026-08-13 (`.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md`).*
*§7 added and the header's version status updated by quick task 260908-615, 2026-09-08; Statbotics' offseason absence re-verified live the same day.*
*§8 added and the header's version status updated by quick task 260911-3kc, 2026-09-11 (measurement: quick task 260910-x09; landed as `epa@8.0.0+baseline`).*
*§3's 2018 subsection salvaged from the deleted `2018-anti-additivity-treatment` todo by the 2026-09-12 backlog triage; the measurements it carries date to 2026-09-06 and 2026-09-08, the deficit figure to live `bpr@3.0.0`.*
