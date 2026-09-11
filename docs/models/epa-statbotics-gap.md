# SigmaScout EPA versus Statbotics EPA — the per-season gap record

**What this file is for.** The developer's requirement is explicit and locked: *"I NEED to be able
to reproduce statbotics EPA perfectly."* Whether SigmaScout's EPA gets better or worse as a result
is deliberately not a consideration — a faithful reproduction is what makes the project's headline
claim ("measurably better than Statbotics") mean literally what it says.

This document is the map of the distance between the two. Its audience is the agent executing the
next stage, so it is written to be usable **without re-deriving anything and without re-fetching a
third-party source**. Every Statbotics claim below cites a section of
`docs/models/statbotics-breakdown-reference.md`, which carries the source verbatim and proves it
with a checker. Every SigmaScout claim cites `file.ts:symbol`.

Created 2026-09-11 by quick task 260911-i9f. **No model, package, script, app, artifact or version
was changed by the task that wrote it.**

---

## CORRECTION 2026-09-11 — they are WEEK 1 aggregates, not season-final

**This document says "season-final" in several places below. That is wrong, and it overstates the
problem by a wide margin.** The correction arrived after this doc was written, from
`backend/src/data/avg.py`, which was not among the eight files this task transcribed. Its
`process_year` opens:

```python
    week_one_matches = [
        m for m in matches if m.week == 1 and m.status == MatchStatus.COMPLETED
    ]
```

and then computes **every** `Year` aggregate from that list alone — `score_mean`, `score_sd`,
`no_foul_mean`, `foul_mean`, `auto_mean`, `teleop_mean`, `endgame_mean`, `rp_*_mean`,
`tiebreaker_mean`, and `comp_0_mean`..`comp_9_mean`. Nothing in the fetched source recomputes them
from the full season afterward.

**Why this matters enormously for L-01.** A week-1 aggregate is knowable as soon as week 1 is
over. For every match from week 2 onward, reading it is **not a walk-forward violation at all** —
the data already exists. The violation is confined to **week 1 itself**, where a week-1 match
would be scored using statistics that include week-1 matches not yet played.

So the reproduction problem is roughly one week wide, not one season wide. SigmaScout can adopt
Statbotics' constants *exactly* for weeks 2+, and needs a live estimate only during week 1. The
developer described this from the start as a "week 1 scaler" and was correct; the
"season-final" framing in this document was the assistant's error, introduced before
`data/avg.py` was read.

Two consequences for the verdicts below, neither yet re-derived into the per-mechanism sections:
- Mechanism 8's L-01 entry, and every other cell justified by "a season-final number is not
  knowable," is **overstated**. Re-scope each to "not knowable during week 1."
- `epa@8.0.0+baseline`'s carryover live-estimate is aimed at the right kind of quantity but the
  wrong window: `get_constants(year)` reads the INCOMING season's **week-1** mean/sd. That is a
  refinement of 8.0.0, not a reversal of it.

The 2025 branch of `process_year` also applies a processor-algae correction to `no_foul_mean`,
`teleop_mean` and `comp_7_mean` at aggregate time, which is a second place the 2025 adjustment
lives beyond `post_process_breakdown`.

---

## The two locked decisions

These frame every verdict below. Neither is relitigated here.

**L-01 — SigmaScout's reproduction carries NO walk-forward violations of its own.** Statbotics
reads aggregate quantities computed from week 1 (see the correction above; this paragraph
originally said "season-aggregate... a Week 1 prediction cannot know a season-end number").
SigmaScout live-estimates them where they are not yet knowable, exactly as `epa@8.0.0+baseline`
already does for the carryover scale anchor. **That whole category is ONE documented difference**,
not one per quantity. Reference section 19 enumerates it exhaustively: **7 read points, 21
distinct `Year` columns.**

**L-02 — EPA MUST NEVER PREDICT RANKING POINTS.** Developer, verbatim: *"I do not want EPA
predicting RP at all ever."* `rp_1`/`rp_2`/`rp_3`, `unit_sigmoid`, `inv_unit_sigmoid` and every RP
slot are DROPPED from any SigmaScout adoption. They are transcribed in the reference (sections 12,
13, 15) because the reference must be complete, and they are NOT ADOPTED here.

## How to read a verdict

Exactly three labels are used, and the rule that assigns them is:

| label | means |
|---|---|
| `ALREADY MATCHES` | The two implementations compute the same thing. Confirmed against both sources in this task, not inherited from a prior claim. |
| `DELIBERATE DIFFERENCE` | Reproduction is refused by L-01 or L-02. Not a defect and not a backlog item. |
| `GAP` | The two differ, no locked decision forbids closing it, and closing it is future work. A `GAP` that also has an unclosable remainder carries a pointer into the cannot-be-reproduced register. |

**2020 is excluded from the matrix.** `breakdown/index.ts` registers a 2020 component map and
Statbotics has a 2020 branch (reference section 15), but 2020 is not a SigmaScout corpus season —
the season was cut short, it is not replayed by the harness, and no published artifact depends on
it. 2021 is excluded for a stronger reason: `key_to_name[2021]` is the empty dict (reference
section 4), so Statbotics rates only the eight standard keys that season, and there was no on-field
FRC season with a TBA score breakdown to replay.

---

## The verdict matrix

Eleven mechanisms, nine corpus seasons, ninety-nine cells, no blanks.

| mechanism | 2016 | 2017 | 2018 | 2019 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| 1. Rated component vector | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 2. Score formula | GAP (see register R1) | GAP (see register R2) | GAP | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES |
| 3. Prediction post-processing | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES | GAP | ALREADY MATCHES |
| 4. RP `unit_sigmoid` path | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE |
| 5. Foul model | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 6. Init and carryover | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 7. Elimination weighting | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES |
| 8. Win-probability scale | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE |
| 9. Update rule | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES |
| 10. Attribution post-processing | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES |
| 11. Cleaning layer | GAP (see register R1) | GAP (see register R2) | GAP | GAP | GAP | GAP | ALREADY MATCHES | GAP | GAP |

**Tally:** 37 `ALREADY MATCHES`, 44 `GAP`, 18 `DELIBERATE DIFFERENCE` (counted from the table
above, not by hand). The two
`DELIBERATE DIFFERENCE` rows are mechanisms 4 (L-02) and 8 (L-01); every other locked-decision
collision is a remainder inside a `GAP` cell and is registered below.

---

## Mechanism 1 — the rated component vector

**Statbotics** rates an 18-entry per-team vector indexed by `all_keys[year]`, padded to exactly 18
slots at import time, and sums it component-wise across the alliance (reference sections 1 and 3).
**SigmaScout** rates a per-team record keyed by `OWN_FIELD_COMPONENT_MAP` plus `foulsCommitted`,
and sums it across `ratingEligibleTeams` (`epa.ts:sumComponentsAcrossTeam`, `epa.ts:predictCore`).

**Both sides rate a vector per team.** This closes the question quick task 260911-gfe got wrong.
The gap is which entries and how many — a difference of DEGREE inside a shared structure, not the
difference of KIND the repo currently claims in three places (see stage 1).

| season | Statbotics rated entries | SigmaScout rated components | what closing it requires | verdict |
|---|---|---|---|---|
| 2016 | 17 named + 1 `"empty"` pad | 10: `autoReach`, `autoCrossing`, `autoBoulder`, `teleopCrossing`, `teleopBoulder`, `teleopChallenge`, `teleopScale`, `breach`, `capture`, `adjust`, plus `foulsCommitted` | adopt `key_to_name[2016]`'s comp set; drop `breach`/`capture` per mechanism 11 | GAP |
| 2017 | 18 named | 9 offensive plus `foulsCommitted` | adopt `key_to_name[2017]`; `comp_8`/`comp_9` (`kpa`, `gears`) are derived counts SigmaScout does not compute | GAP |
| 2018 | 18 named | 8: seven ownership/vault/endgame plus `foulsCommitted` | adopt the four `*_power` ratio entries, which require `post_clean_breakdown` (reference section 17) | GAP |
| 2019 | 18 named | 5: `sandstormBonus`, `hatchPanel`, `cargo`, `habClimb`, `foulsCommitted` | adopt the eight per-location piece counts; SigmaScout reads point fields, Statbotics counts pieces out of the bay/rocket JSON | GAP |
| 2022 | 14 named + 4 pad | 5: `autoTaxi`, `autoCargo`, `teleopCargo`, `endgame`, `foulsCommitted` | adopt lower/upper cargo splits | GAP |
| 2023 | 18 named | 8 | adopt the bottom/middle/top piece counts, `links`, and the cube/cone point split | GAP |
| 2024 | 18 named | 5: `auto`, `teleop`, `endgame`, `adjust`, `foulsCommitted` | adopt the ten `comp_*` entries; note reference section 10 measured that coarsening 2024 to three phase groups BEAT eleven components by 1.7 points of winner accuracy | GAP |
| 2025 | 18 named | 6: `autoMobility`, `autoCoral`, `teleopCoral`, `algae`, `endGameBarge`, `foulsCommitted` | adopt the four coral-level counts and the processor/net algae split | GAP |
| 2026 | 15 named + 3 pad | 10: `autoTower`, `endGameTower`, `hubAuto`, `hubTransition`, `hubShift1`..`hubShift4`, `hubEndgame`, `foulsCommitted` | SigmaScout is FINER here: it rates shifts 1-4 separately where Statbotics pairs them into `first_shift_fuel`/`second_shift_fuel` | GAP |

**A caution that survives from `epa-divergences.md` section 6 and must not be lost:** the accuracy
curve TURNS OVER with component count. On 2024, eleven components scored 0.7348, three scored
0.7520, one scored 0.7403. Adopting Statbotics' entry set is a FIDELITY move, not an accuracy move,
and on at least one season it is measurably an accuracy LOSS. That is the developer's stated
trade and it is recorded here so nobody re-litigates it as a bug.

## Mechanism 2 — the score formula

**Statbotics** reads a per-season subset of the vector in `get_score_from_breakdown` (reference
sections 15 and 18). **SigmaScout** sums every rated component except its own `foulsCommitted`
(`epa.ts:predictCore`, `redOffensiveTotal`).

**The key structural fact, and the reason five seasons come out `ALREADY MATCHES`:** SigmaScout's
attribution and EWMA are both LINEAR, and every component of a team shares one `percent` and one
`weight` (`epa.ts:applyComponentUpdate` computes `percent` once per team, before the component
loop). So the SUM of SigmaScout's per-component EWMAs evolves exactly as a single EWMA on the SUM.
Where Statbotics' branch is `score = breakdown[keys.index("no_foul_points")]` — an identity read of
one linearly-updated entry — the two compute the same functional. They still differ in VALUE,
because the cold-start vectors differ (mechanism 6) and the foul handling differs (mechanism 5),
but those are other rows; the FORMULA matches.

That equivalence holds only because `adjust` is pinned at exactly 0 per team
(`epa.ts:applyComponentUpdate`, `updatedComponents[ADJUST_COMPONENT] = 0`) and Statbotics counts
`adjustPoints` on the foul side (`no_foul_points = score - foulPoints - adjustPoints`, reference
section 2). Both sides therefore target the same quantity: score minus fouls minus adjust.

| season | what Statbotics does | what SigmaScout does today | what closing the gap requires | verdict |
|---|---|---|---|---|
| 2016 | reads index 0; **in ELIMS adds `rp_1_pred * 20 + rp_2_pred * 25`** (ref. 15) | sums components, identically in quals and elims (`epa.ts:predictCore`) | quals: nothing. Elims: blocked by L-02 — register R1 | GAP (see register R1) |
| 2017 | reads index 0; **in ELIMS adds `rp_1_pred * 100 + rp_2_pred * 20`** (ref. 15) | same | quals: nothing. Elims: blocked by L-02 — register R2 | GAP (see register R2) |
| 2018 | seven own entries plus three opponent entries, with `min(15/45/90)` caps and three `zero_sigmoid` terms — **non-linear** (ref. 18) | linear sum | implement `zero_sigmoid`, the caps, and opponent coupling. A re-grouping cannot do this | GAP |
| 2019 | reads index 0 (ref. 15) | linear sum of the same modeled quantity | nothing at this mechanism | ALREADY MATCHES |
| 2022 | reads index 0 (ref. 15) | linear sum | nothing at this mechanism | ALREADY MATCHES |
| 2023 | seven entries with `min(9, links)` and `min(30, endgame_charge_station_points)` — **non-linear** (ref. 18) | linear sum | implement both caps and the entry set | GAP |
| 2024 | reads index 0 (ref. 15) | linear sum | nothing at this mechanism | ALREADY MATCHES |
| 2025 | reads index 0 via the `else` fallback (ref. 15) | linear sum | nothing at this mechanism; the 2025 divergence lives in mechanism 3 | ALREADY MATCHES |
| 2026 | reads index 0 via the `else` fallback (ref. 15) | linear sum | nothing at this mechanism | ALREADY MATCHES |

## Mechanism 3 — prediction post-processing (`post_process_breakdown`)

**Statbotics** runs `post_process_breakdown` on each alliance's summed vector BEFORE the score
read, mutating entries in place and writing the net change back into index 0 via
`breakdown[0] += total_change` (reference section 15). **SigmaScout applies none of this** —
`epa.ts` has no `post_process_breakdown` equivalent at all (documented as D-13 in
`epa-divergences.md` section 3).

Setting aside the RP `unit_sigmoid` block, which is mechanism 4, only three seasons have a branch.

| season | what Statbotics does | what SigmaScout does today | what closing the gap requires | verdict |
|---|---|---|---|---|
| 2016 | no branch; `total_change` stays 0 and the writeback is a no-op | nothing | nothing | ALREADY MATCHES |
| 2017 | no branch | nothing | nothing | ALREADY MATCHES |
| 2018 | rewrites `switch_power`, `scale_power`, `opp_switch_power` as `zero_sigmoid` of an opponent-coupled difference (ref. 15) | nothing | implement the contest rewrite, and note the **double sigmoid**: the score branch applies `zero_sigmoid` again to these already-sigmoided entries, while `auto_scale_power` is single-sigmoided (ref. 18, observation 1) | GAP |
| 2019 | no branch | nothing | nothing | ALREADY MATCHES |
| 2022 | no branch | nothing | nothing | ALREADY MATCHES |
| 2023 | a 9-piece cascade spilling top into middle into bottom, a cube/cone proportional regrade, and `total_change` into index 0 (ref. 15) | nothing | implement the cascade; it is order-dependent (top, then middle, then bottom) and its `total_change` moves `no_foul_points` itself | GAP |
| 2024 | no branch | nothing | nothing | ALREADY MATCHES |
| 2025 | adds 3 points per processor algae scored by **both** alliances, into `processor_algae_points`, `net_algae_points`, `teleop_points` and index 0 (ref. 15) | nothing | implement it, and note it makes 2025's apparently one-entry score read **opponent-coupled** (ref. 18, observation 2) | GAP |
| 2026 | no branch | nothing | nothing | ALREADY MATCHES |

## Mechanism 4 — the RP `unit_sigmoid` path — NOT ADOPTED (L-02)

**One sentence for all nine seasons, rather than nine rows.** Statbotics maintains three RP slots
(indices 4, 5, 6) that are pre-imaged through `inv_unit_sigmoid` at init (reference section 13),
forward-sigmoided through `unit_sigmoid` on every prediction (reference section 15), frozen during
elimination attribution (reference section 15), and published by `record_match` (reference section
14). **L-02 drops all of it.** `epa.ts` contains no RP machinery of any kind — a repo-wide search
of that file for `rp_1`, `rankingPoint` or `rpPmf` returns nothing. Verdict
`DELIBERATE DIFFERENCE` in every season, permanently.

The only place this collides with a SCORE rather than an RP is 2016 and 2017 elimination matches;
that is register entries R1 and R2, not this row.

## Mechanism 5 — the foul model

**This is the mechanism whose analysis changed most on reading the source, and the change is worth
stating first.**

Statbotics computes the win probability BEFORE applying fouls, and applies the same scalar to both
alliances (reference section 14, `predict_match` lines 125-130):

1. `norm_diff = (red_score - blue_score) / score_sd`
2. `win_prob = 1 / (1 + 10 ** (k * norm_diff))`
3. *then* `red_score_with_fouls = red_score * (1 + foul_rate)`, and the same for blue.

Because `foul_rate` is a single season scalar applied identically to both sides, **fouls do not
affect Statbotics' predicted winner or its win probability at all.** They inflate the two published
predicted SCORES and nothing else.

SigmaScout does the opposite. `foulsCommitted` is a per-team rated component derived from the
OPPONENT's raw `foulPoints` (D-04; every `breakdown/{year}.ts` sets
`result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints`), and `epa.ts:predictCore` adds the
opposing alliance's `foulsCommitted` mean to this alliance's predicted score. Red's and blue's
foul means are different numbers, so **fouls DO move SigmaScout's margin, and therefore its
predicted winner.**

| season | what Statbotics does | what SigmaScout does today | what closing the gap requires | verdict |
|---|---|---|---|---|
| 2016 | season scalar `get_foul_rate()`, applied after `win_prob` | per-team `foulsCommitted`, cross-attributed, inside the margin | move the foul term after the win-probability computation; the rate itself is an L-01 aggregate (register R3) | GAP |
| 2017 | same | same | same | GAP |
| 2018 | same | same | same | GAP |
| 2019 | same | same | same | GAP |
| 2022 | same | same | same | GAP |
| 2023 | same | same | same | GAP |
| 2024 | same | same | same | GAP |
| 2025 | same | same | same | GAP |
| 2026 | same | same | same | GAP |

The mechanism is season-independent, which is why every row is identical; it is tabulated per
season anyway so the matrix has no special cases.

**Note on what is and is not blocked.** The PLACEMENT (after `win_prob`, same scalar both sides) is
freely reproducible and is a real `GAP`. The RATE (`foul_mean / no_foul_mean`, a season aggregate)
is L-01 and must be live-estimated — register R3. Closing the placement without the rate is still
worth doing, and it is the larger of the two effects, because placement changes the predicted
WINNER and the rate only scales a published score.

## Mechanism 6 — init and carryover

**The five Statbotics-parity constants already match exactly**, confirmed against both sources in
this task rather than inherited:

| constant | Statbotics (ref. 11) | SigmaScout (`carryover.ts`) | match |
|---|---|---|---|
| `NORM_MEAN` | 1500 | `EPA_NORM_MEAN = 1500` (line 79) | yes |
| `NORM_SD` | 250 | `EPA_NORM_SD = 250` (line 82) | yes |
| `INIT_PENALTY` | 0.2 | `EPA_INIT_PENALTY = 0.2` (line 91) | yes |
| `YEAR_ONE_WEIGHT` | 0.7 | `EPA_CARRY_LAST_YEAR_WEIGHT = 0.7` (line 105) | yes |
| `MEAN_REVERSION` | 0.4 | `EPA_MEAN_REVERSION = 0.4` (line 98) | yes |

And the blend is algebraically identical: Statbotics' `(1 - mr) * prev + mr * INIT_EPA`
(reference section 13) versus `carryover.ts:carryNormalizedRating`'s
`blended + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - blended)`, with
`EPA_ROOKIE_BASELINE = 1500 - 0.2 * 250 = 1450 = NORM_MEAN - INIT_PENALTY * NORM_SD`.

**Three things do NOT match, and they are why every cell is `GAP`:**

1. **The distribution across components.** Statbotics builds the entire 18-entry cold-start vector
   from the season's own per-component mean profile: `curr_epa_mean = mean / num_teams + sd * z`,
   where `mean = year.get_mean_components()` and `sd = mean * (year_sd / year_mean)` (reference
   section 13). Each component is seeded proportional to what that component is actually worth that
   season. SigmaScout splits ONE carried total **evenly** across components —
   `epa.ts:carrySeason`'s `share = carriedTotal / modeledToSeasonComponents.length` — and cold
   starts a never-seen team at `EPA_INIT_COMPONENT_TOTAL / componentCount`
   (`epa.ts:componentColdStartValue`), a flat constant of about 19.33 points spread evenly. An
   even split across 2023's eight components says endgame and auto pieces are worth the same at
   cold start; Statbotics' profile says they are not.
2. **The floor.** Statbotics floors the Z-SCORE at `max(-year_mean / num_teams / year_sd, z)`
   (reference section 13), which makes index 0 non-negative and lets individual components fall
   where they fall. `carryover.ts:normalizedToSeasonUnits` floors the POINTS at
   `Math.max(0, points)` on the team total. The two coincide on the total and differ per component.
3. **The 2026 `district == "isr"` exception.** Statbotics sets `mean_reversion = 0` for Israeli
   district teams in 2026, because they did not compete before champs (reference section 14,
   `start_season`). SigmaScout has no equivalent — a repo-wide search of
   `packages/core/algorithms/` for `isr` returns nothing.

| season | what closing the gap requires | verdict |
|---|---|---|
| 2016 | per-component mean-profile seeding; z-score floor. The profile itself is L-01 (register R3) | GAP |
| 2017 | same | GAP |
| 2018 | same | GAP |
| 2019 | same | GAP |
| 2022 | same | GAP |
| 2023 | same | GAP |
| 2024 | same | GAP |
| 2025 | same | GAP |
| 2026 | same, **plus** the `district == "isr"` mean-reversion exception, which needs a district field SigmaScout's carry path does not currently read | GAP |

## Mechanism 7 — elimination weighting — ALREADY MATCHES, confirmed not inherited

The plan for this task required confirming this against both sources rather than carrying forward
the D-05 claim. Confirmed:

| half of the decision | Statbotics | SigmaScout |
|---|---|---|
| outer EWMA weight | `ELIM_WEIGHT = 1 / 3` (ref. 11); `weight = ELIM_WEIGHT if match.elim else 1` in `update_team` (ref. 14) | `EPA_ELIM_WEIGHT = 1 / 3` (`epa.ts:227`); `isElimination ? EPA_ELIM_WEIGHT : 1` in `applyComponentUpdate` |
| learning-rate counter | `if not match.elim: self.counts[team] += 1` (ref. 14) | `nextCounts.set(team, isElimination ? matchCount : matchCount + 1)` |

Both halves match, in both value and coupling. Statbotics treats them as one decision and so does
SigmaScout. `ALREADY MATCHES` in all nine seasons; the mechanism is season-independent.

## Mechanism 8 — the win-probability scale — DELIBERATE DIFFERENCE (L-01)

**The functional form is algebraically IDENTICAL**, and this task checked the sign and the base
explicitly rather than assuming. Statbotics (reference section 14):
`win_prob = 1 / (1 + 10 ** (k * norm_diff))` with `k = -5/8` for years >= 2008 (reference section
14, `k_func`) and `norm_diff = (red - blue) / score_sd`.

SigmaScout (`epa.ts:predictCore`): `pRedWin = 1 / (1 + Math.exp(-margin / scale))` with
`scale = seasonScoreSd / (-EPA_K * Math.LN10)` and `EPA_K = -5 / 8` (`epa.ts:193`).

Substituting: `margin / scale = margin * (5/8) * ln(10) / sd = (5/8) * ln(10) * norm_diff`, so
SigmaScout's denominator is `1 + exp(-(5/8) ln(10) norm_diff)` and Statbotics' is
`1 + 10^(-(5/8) norm_diff) = 1 + exp(-(5/8) ln(10) norm_diff)`. **The same expression.** Sign, base
and coefficient all agree.

**What differs is the denominator's source, and it is exactly L-01.** Statbotics divides by
`self.year_obj.score_sd` — a season-final constant, read point 3 of reference section 19.
SigmaScout divides by an EXPANDING-WINDOW Welford SD over alliance scores already replayed
(`epa.ts:predictCore`, `standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD)`), with
a documented `EPA_FALLBACK_SCORE_SD = 25` before two observations exist. Adopting Statbotics'
constant would leak season-end variance into a Week 1 prediction, which is precisely the violation
L-01 forbids and which this project's own failure log names as a past failure.

`DELIBERATE DIFFERENCE` in all nine seasons. See register R3.

## Mechanism 9 — the update rule — ALREADY MATCHES

Three sub-parts, all confirmed:

| sub-part | Statbotics | SigmaScout | match |
|---|---|---|---|
| two-stage EWMA | `add_obs`: `new_mean = (1-percent)*mean + percent*x`, then `weight*new_mean + (1-weight)*mean` (ref. 12) | `epa.ts:twoStageEwma`, line for line | yes |
| decaying learning rate | `percent_func`: `2/3 * min(0.5, max(0.3, 0.5 - 0.2/6 * (x - 6)))` for years > 2015 (ref. 14) | `epa.ts:epaPercentFunc`, same expression with `2/3` hardcoded | yes |
| margin handling | `margin_func` returns 0 for every year except 2002 and 2003, so `err = (my_err - 0) / 1 = my_err`, and `attrib = epa + err / num_teams` (ref. 14 and 15) | `epa.ts:applyComponentUpdate`: `attributed = currentMean + (allianceValue - predictedAllianceTotals[c]) / teams.length` | yes |

SigmaScout hardcodes the `2/3` era factor rather than branching on `year <= 2015`. That is
invisible on this corpus — every corpus season is 2016 or later — but a reproduction that ever
replayed 2015 or earlier would silently diverge. Recorded so it is not a surprise later.

`ALREADY MATCHES` in all nine seasons.

## Mechanism 10 — attribution post-processing (`post_process_attrib`)

`post_process_attrib` (reference section 15) does three things on top of the error split:

- **2018:** overwrites `auto_points`, `teleop_points` and `no_foul_points` in the attribution from
  the switch/scale powers, using `zero_sigmoid` against `year.comp_6_mean` / `comp_7_mean` /
  `comp_8_mean` — three season aggregates used nowhere else in the model (reference section 19,
  read points 5-7).
- **2025:** subtracts `3 * err[processor_algae]` from `processor_algae_points`, `teleop_points` and
  `no_foul_points`, then recomputes `attrib = epa + err`.
- **All seasons >= 2016:** freezes the RP slots during elimination matches. **Not adopted, L-02**,
  and it touches only indices 4/5/6, so it cannot affect a score.

SigmaScout's attribution is the plain error split with no post-processing at all.

| season | what closing the gap requires | verdict |
|---|---|---|
| 2016 | nothing (only the RP freeze applies, and that is mechanism 4) | ALREADY MATCHES |
| 2017 | nothing | ALREADY MATCHES |
| 2018 | implement the total-points overwrite, which needs three season aggregates SigmaScout must live-estimate — register R4 | GAP |
| 2019 | nothing | ALREADY MATCHES |
| 2022 | nothing | ALREADY MATCHES |
| 2023 | nothing — 2023's adjustments are all in `post_process_breakdown`, mechanism 3 | ALREADY MATCHES |
| 2024 | nothing | ALREADY MATCHES |
| 2025 | implement the processor-algae attribution correction; no aggregate needed | GAP |
| 2026 | nothing | ALREADY MATCHES |

## Mechanism 11 — the cleaning layer (what each side rates at all)

This is distinct from mechanism 1. Mechanism 1 asks which entries exist; this asks what NUMBER goes
into each entry. Statbotics cleans TBA's raw `score_breakdown` in `src/tba/breakdown.py`
(reference section 17); SigmaScout parses it in `breakdown/{year}.ts`'s `parse()`.

| season | what Statbotics does | what SigmaScout does today | what closing the gap requires | verdict |
|---|---|---|---|---|
| 2016 | **subtracts `breachPoints + capturePoints` from `no_foul_points`** at clean time (ref. 17); corrects boulder counts against `autoBoulderPoints`; carries two hardcoded per-match fixes (`2016mndu2_f1m2`, `2016capl_f1m1`, `2016milsu_qf4m1`) | rates `breach` and `capture` as ordinary point components (`2016.ts:OWN_FIELD_COMPONENT_MAP`) | drop the two bonus components from the rated score; adopt the boulder correction and the three match fixes | GAP (see register R1) |
| 2017 | **subtracts `rotorBonusPoints + kPaBonusPoints`**; redistributes 40 points per auto rotor into teleop; derives `kpa` and `gears` (ref. 17) | rates `rotorBonus` and `kPaBonus` as ordinary components (`2017.ts`) | drop the two bonus components; adopt the rotor redistribution | GAP (see register R2) |
| 2018 | forces the additive identity by pushing the residual into switch or scale seconds, whichever is smaller (ref. 17); computes four `*_power` RATIOS in `post_clean_breakdown` | rates `2 * autoSwitchOwnershipSec` etc. directly, no residual redistribution, no ratios | adopt the residual rule and `post_clean_breakdown` | GAP |
| 2019 | counts pieces out of the `bay*` / `*Rocket*` JSON, including the pre-match-bay exclusion (ref. 17) | reads `hatchPanelPoints` / `cargoPoints` style fields | adopt `count_pieces_2019` | GAP |
| 2022 | corrects sensor error against `autoCargoPoints` / `teleopCargoPoints`, pushing the residual into whichever of lower/upper is larger (ref. 17) | reads point fields directly | adopt both sensor corrections | GAP |
| 2023 | counts pieces out of `autoCommunity` / `teleopCommunity` grids, with a `teleopGamePieceCount == 27` supercharge special case (ref. 17) | reads point fields | adopt `count_pieces_2023` and the supercharge case | GAP |
| 2024 | `auto = autoLeavePoints + 2*autoAmpNoteCount + 5*autoSpeakerNoteCount`; `teleop = 1*amp + 2*(speaker+amplified) + 3*amplified`; `endgame` sums the five endgame fields (ref. 17) | `auto/teleop/endgame` sum TBA's matching point fields (`2024.ts:OWN_FIELD_COMPONENT_MAP`) | **nothing** — the two are algebraically equal. TBA's `teleopSpeakerNotePoints` is `2 × count` and `teleopSpeakerNoteAmplifiedPoints` is `5 × amplified`, and Statbotics' expression expands to `2*count + 5*amplified` | ALREADY MATCHES |
| 2025 | `processor_algae_points = 6 * wallAlgaeCount` at clean time, then corrected back toward 3 in both post-processing paths (ref. 17) | one `algae` component | adopt the 6-then-correct-to-3 construction and the processor/net split | GAP |
| 2026 | pairs `shift1+shift2` into `first_shift_fuel` and `shift3+shift4` into `second_shift_fuel` (ref. 17) | rates `hubShift1`..`hubShift4` separately — SigmaScout is FINER | pair the shifts, or accept the finer split as a documented divergence | GAP |

---

## The cannot-be-reproduced register

Everything that CANNOT be reproduced under L-01 or L-02, each with a number attached. Ordered by
how much of the corpus it touches.

### R1 — 2016 elimination matches fold RP predictions into the SCORE

**Mechanism:** `get_score_from_breakdown`'s 2016 branch (reference section 15) adds
`rp_1_pred * 20 + rp_2_pred * 25` to the predicted score, in ELIMINATION matches only.
`rp_1_pred` and `rp_2_pred` are the unit-sigmoided RP entries from the rated vector.

**Collides with:** L-02. Those entries do not exist in SigmaScout, so the terms cannot be formed.

**Exposure: 2,223 official elimination matches in 2016 — 16.7% of that season's 13,286.**

**Why no workaround exists *by Statbotics' method*:** the terms are expectations over a predicted
ranking-point probability. There is no way to produce that number without predicting a ranking
point, which L-02 forbids in any form.

### R2 — 2017 elimination matches fold RP predictions into the SCORE

**Mechanism:** the 2017 branch adds `rp_1_pred * 100 + rp_2_pred * 20` in elimination matches.

**Collides with:** L-02, identically to R1.

**Exposure: 2,741 official elimination matches in 2017 — 17.8% of that season's 15,424.**

Together R1 and R2 cover **roughly 5,000 matches, about one in six across those two seasons.**

### R1 + R2: this is a real scoping decision, not a footnote

The developer should decide this explicitly, and the options are genuinely different:

| option | what it means | cost |
|---|---|---|
| **A. Accept that 2016 and 2017 never reproduce in elims** | The reproduction claim is scoped: "reproduces Statbotics exactly, except in 2016 and 2017 elimination matches." | ~5,000 matches carry a permanent known divergence. Honest, and publishable as a scoped claim. |
| **B. Reproduce those two seasons in QUALS only** | The comparison excludes 2016/2017 elims entirely rather than reporting them as mismatches. | Cleanest claim, but it quietly removes 1 match in 6 from two seasons of any accuracy comparison, which must then be disclosed wherever the comparison is published. |
| **C. Revisit L-02** | Allow an RP-shaped internal quantity for the sole purpose of these two branches. | **L-02 is LOCKED and this task does not reopen it.** Listed only so the option set is complete and nobody believes it was overlooked. |

**A finding that materially changes the choice, and that this task measured.** SigmaScout ALREADY
rates the underlying quantity, in points, without any RP machinery. `breakdown/2016.ts` rates
`breach` (from `breachPoints`) and `capture` (from `capturePoints`) as ordinary components, and
`breakdown/2017.ts` rates `rotorBonus` and `kPaBonus` the same way. Statbotics REMOVES exactly
those point fields at clean time (`no_foul_points -= rp_1_points + rp_2_points`, reference section
17) and re-adds an EXPECTED version in elims. So the two projects estimate the same bonus points by
different routes: Statbotics through an RP probability, SigmaScout through a directly-rated point
component.

Those TBA fields are nonzero in elimination matches and **exactly zero in every qualification
match**, which this task confirmed with one read-only query against `data/corpus.sqlite`:

```sql
SELECT substr(m.event_key,1,4) AS season,
  CASE WHEN m.comp_level='qm' THEN 'qual' ELSE 'elim' END AS phase,
  COUNT(*) AS matches,
  SUM(CASE WHEN json_extract(m.score_breakdown_raw,'$.red.breachPoints')>0
           OR json_extract(m.score_breakdown_raw,'$.blue.breachPoints')>0 THEN 1 ELSE 0 END) AS any_breach,
  SUM(CASE WHEN json_extract(m.score_breakdown_raw,'$.red.capturePoints')>0
           OR json_extract(m.score_breakdown_raw,'$.blue.capturePoints')>0 THEN 1 ELSE 0 END) AS any_capture
FROM matches m
WHERE substr(m.event_key,1,4)='2016' AND m.has_score_breakdown=1
GROUP BY season, phase;
```

Result (and the same query with `rotorBonusPoints`/`kPaBonusPoints` for 2017):

| season | phase | matches with a breakdown | any bonus-1 > 0 | any bonus-2 > 0 |
|---|---|---|---|---|
| 2016 | qual | 11,550 | 0 | 0 |
| 2016 | elim | 2,351 | 2,322 | 1,173 |
| 2017 | qual | 13,920 | 0 | 0 |
| 2017 | elim | 3,119 | 890 | 420 |

**These counts are a DIFFERENT population from the exposure figures above** — they count matches
carrying a parsed score breakdown, not decided official matches — and the two must not be
differenced against each other. They are reported only to establish the qual/elim pattern, which
they do unambiguously.

**What this means for the decision.** SigmaScout is not missing the phenomenon; it is modelling it
in a different unit. A team's `breach` component will sit near zero because it observes zero in
every qual, and will contribute a small positive amount in elims — which is qualitatively what
Statbotics' `rp_1_pred * 20` term does, arrived at without an RP. This does **not** make R1 and R2
reproducible: the numbers will differ, because a smeared EWMA over mostly-zero observations is not
`unit_sigmoid` of a rated RP. But it does mean option A costs less than it looks like it costs, and
that option C is not the only way to have any signal at all in those matches. **This is a
developer decision and this task does not make it.**

### R3 — the 21 season aggregates (L-01) — THE one documented difference

**Mechanism:** Statbotics reads 21 distinct season-level `Year` columns through 7 read points
(reference section 19). Every one is a season-final number.

**Collides with:** L-01.

**Exposure: every match in every season — all nine corpus seasons, 100%.** This is the widest entry
in the register by far, and it is deliberately ONE entry rather than 21, per L-01.

**Why no workaround exists:** a season-final mean or SD is not knowable at the time of an
early-season prediction. Adopting it is a walk-forward violation by construction. SigmaScout
live-estimates each from the data available so far.

| # | Statbotics quantity | where it is read (ref. 19) | what SigmaScout live-estimates instead |
|---|---|---|---|
| 1 | `score_sd` in `norm_diff` | `main.py:125` | expanding-window Welford SD over alliance scores replayed so far (`epa.ts:predictCore`), `EPA_FALLBACK_SCORE_SD = 25` before 2 observations |
| 2 | `score_sd`, `no_foul_mean`, `score_mean` in `get_constants` | `init.py:16-21` | `epaCarryScale.ts:cleanSeasonMean` plus the expanding stats, seeded across the boundary by `reseedFromPrior` with `EPA_SCORE_SD_SEED_COUNT` |
| 3 | `foul_mean` and `no_foul_mean` in `get_foul_rate()` | `main.py:128`, via `year.py:176-177` | nothing equivalent — SigmaScout has no foul-rate scalar at all. Its per-team `foulsCommitted` EWMA is the live estimate of the same phenomenon (mechanism 5) |
| 4 | the 18 columns behind `get_mean_components()` | `init.py:47`, via `year.py:179-203` | not estimated per component at all — `epa.ts:carrySeason` splits one carried total evenly, and `componentColdStartValue` seeds a flat constant. **This is the largest single divergence inside R3** and is also mechanism 6's `GAP` |
| 5 | `comp_6_mean`, `comp_7_mean`, `comp_8_mean` (2018 only) | `models/epa/breakdown.py:167,171,172` | nothing — see R4 |

Note that #4 is both an L-01 `DELIBERATE DIFFERENCE` (the aggregate cannot be adopted) and a
mechanism 6 `GAP` (the SHAPE of the estimate — a mean profile versus an even split — is freely
reproducible from live data). Those two halves are separable and should not be conflated: SigmaScout
could live-estimate a per-component mean profile without violating L-01 at all.

### R4 — 2018's attribution reads three season aggregates used nowhere else

**Mechanism:** `post_process_attrib`'s 2018 branch (reference section 15) references
`year.comp_6_mean`, `year.comp_7_mean` and `year.comp_8_mean` as the `zero_sigmoid` reference
points for auto-scale, switch and scale power.

**Collides with:** L-01 — these are season aggregates.

**Exposure: every 2018 match — one of nine corpus seasons.**

**Why it is registered separately from R3:** it is the only place in the model where a season
aggregate feeds an ATTRIBUTION rather than a prediction or an initialization, and it is 2018-only.
A reproduction that live-estimated the other 18 aggregates and forgot these three would produce a
2018 that looked structurally right and was numerically wrong, with nothing to flag it.

### Ruled-OUT collisions — checked, and NOT collisions

Recorded so the next reader does not re-check them. Each was found by following every site where an
RP slot or a season aggregate feeds something that affects a SCORE or a WIN PROBABILITY.

| candidate | why it is NOT a collision |
|---|---|
| `post_process_breakdown`'s `unit_sigmoid` on `rp_1`/`rp_2`/`rp_3` (all seasons >= 2016) | It writes only indices 4, 5 and 6 and contributes nothing to `total_change`. Those indices reach the score only through the 2016 and 2017 elim branches, already counted as R1 and R2. In every other season the sigmoid is invisible to the score. |
| `post_process_attrib`'s elimination RP freeze | Touches only indices 4, 5 and 6. Cannot move a score or a win probability in any season. |
| `get_init_epa`'s `inv_unit_sigmoid` pre-image on `mean[4]`, `mean[5]`, `mean[6]` | Same three indices. Its only path to a score is R1/R2. |
| `rp_3_pred` (2025 and 2026) | It is computed in `predict_match`, passed to `get_score_from_breakdown` as a parameter — **and never referenced in that function's body in any branch** (reference section 15). A dead parameter. No season's score reads it. |
| `tiebreaker_points` (index 7) | Rated every season, published by `post_record_team`, and read by no branch of `get_score_from_breakdown` in any season. |
| `get_foul_rate()`'s effect on the predicted WINNER | The foul multiplier is applied AFTER `win_prob` and is the SAME scalar for both alliances (reference section 14). It cannot change the predicted winner or the win probability. So this L-01 aggregate, despite being read on every prediction, affects only the two published predicted scores. A real collision, but a much smaller one than its position in the code suggests. |
| `record_match`'s RP predictions | Written to the database and never read back into any score computation. |
| The `derived_breakdown` table (reference section 4) | Added to API responses only; never rated, never read by any model path. |

---

## Recommended stage sequence

Each stage is sized as its own quick task: one coherent change, independently verifiable. The order
is most-foundational-and-riskiest first, and each entry states WHY it sits where it does.

**Republish debt is cumulative, and it is already nonzero.** `epa@8.0.0+baseline` ALREADY owes a
republish. Every stage below that changes a published EPA number adds to that debt, and **the
published methodology numbers are stale until it is paid.** Do not read a stage's "no republish
owed" as "the site is current" — it means only that this stage added nothing.

### Stage 1 — Correct the three surfaces still carrying the disproven claim

**Why first:** it costs nothing, changes no number, owes no republish, and one of the three
surfaces is **published to users right now**. It is also the only stage that can be done without
touching the model at all, so it cannot be blocked by any later decision. Leaving a known-false
claim on a live methodology page while doing months of model work behind it is the worse of the two
orderings.

Reference section 3 proves that Statbotics rates a per-team VECTOR summed across the alliance. The
claim that it "rates one number per alliance" survives in exactly three places:

| # | file | exact location | what to change |
|---|---|---|---|
| 1 | `apps/web/src/components/methodology/epaComparisonContent.ts` | the `component-maps` entry's paragraphs at **lines 105 and 106**, and the revision note above them at **lines 25-40** | Line 105 says Statbotics "rates one quantity per alliance"; line 106 says "One rates several pieces and adds them up. The other rates one total." Both are false as general claims. The true statement is that both rate a vector and the difference is which entries the predicted score READS — for 2024, one entry versus a sum. **This is the user-facing one.** |
| 2 | `scripts/measureEpaDeviations.ts` | the `deviationRegister()` `component-map` entry's `reason` string, **lines 689-699** | It says `all_keys[year]` "is a rated-quantity LIST, not a partition". That is true but incomplete, and the sentence it supports — that there is "nothing to point the arm at" — no longer holds: reference sections 15, 17 and 18 now give a concrete per-season target. |
| 3 | `docs/models/epa-divergences.md` | section 6, the block headed **"CORRECTED 2026-09-11 (quick task 260911-gfe): this is a difference in KIND, not in grouping"** | The heading itself states the error. It is a difference of DEGREE in a shared structure. |

**Constraint the follow-on task must respect:** `scripts/measureEpaDeviations.test.ts:642` asserts
`expect(entry.reason).toMatch(/statbotics-breakdown-reference/)`. Any reword of surface 2 **must
keep that citation** or the test goes red. The citation can point at a different section of the
reference; it cannot be removed.

**Verification:** the existing test suite, plus reading the rendered methodology page.
**Republish debt:** none. No number changes.

### Stage 2 — Live-estimate the per-component season mean profile

**Why second:** it is the largest single divergence in the register (R3 item 4), it is
season-independent, and — critically — **every later stage's measurement is meaningless without
it.** Stages 3 onward change what SigmaScout rates and how it scores; if the cold-start vector is
still a flat even split while the component set is being reshaped to match Statbotics', a
measurement of "did adopting Statbotics' entries help?" is confounded by a seeding scheme that
gets worse as the component count grows. Fix the seed before reshaping what it seeds.

**What it changes:** `epa.ts:carrySeason`'s even `share` split and `epa.ts:componentColdStartValue`'s
flat constant, replaced by a live-estimated per-component mean profile — the walk-forward analogue
of `year.get_mean_components() / num_teams`. Also the floor: z-score floor rather than a points
floor (mechanism 6, item 2).

**Closes:** mechanism 6 for all nine seasons, and the reproducible HALF of R3 item 4.
**Does not close:** R3 itself. The aggregate is still live-estimated, and that stays the one
documented difference.
**Verification:** walk-forward replay against the existing baseline; the profile must be
computable from matches already replayed and nothing else.
**Republish debt: YES.** Every rating moves.

### Stage 3 — Move the foul term after the win-probability computation

**Why third:** it is small, it is season-independent, and it changes the predicted WINNER — which
means it moves the headline accuracy metric. Doing it before the per-season entry-set work isolates
its effect; doing it after would mix a winner-changing edit into a measurement of something else.

**What it changes:** `epa.ts:predictCore` currently folds the opponent's `foulsCommitted` mean into
the margin. Statbotics computes `win_prob` from the foul-free scores and only then scales both
published scores by `(1 + foul_rate)` (mechanism 5).

**Closes:** the PLACEMENT half of mechanism 5, all nine seasons.
**Does not close:** the RATE, which is L-01 (R3 item 3).
**Flag:** this is the stage most likely to move winner accuracy in either direction, since it
removes a term that currently shifts every margin. Measure before and after with the SAME published
scorer — do not compare against a scratch script (the scorer-mismatch hazard: a published Brier
counts ties, most scratch scripts do not).
**Republish debt: YES.**

### Stage 4 — Adopt the per-season cleaning layer, season by season

**Why fourth:** it is the foundation for stages 5 and 6 — those adopt entry sets and score formulas
that are defined in terms of the cleaned values this stage produces — but it must come after
stages 2 and 3, because it is the first stage whose effect varies by season, and a per-season effect
measured on top of an unfixed seed is uninterpretable.

**Sized as one quick task PER SEASON**, not one for all nine. Reference section 17 carries each
cleaner verbatim, so each is independently transcribable and independently testable against
`data/corpus.sqlite`.

**Order within the stage:** 2024 first — mechanism 11 marks it `ALREADY MATCHES`, so it is a
**zero-change verification** that proves the harness can detect agreement before it is asked to
detect disagreement. Then 2019, 2022, 2023 (piece-counting and sensor corrections, mechanically
similar). Then 2025 and 2026. **2016, 2017 and 2018 LAST**, for the reasons in stages 5 and 7.

**Closes:** mechanism 11 per season.
**Republish debt: YES**, per season.

### Stage 5 — Adopt the entry sets and the score formulas for the linear seasons

**Why fifth:** depends on stage 4's cleaned values. Restricted to seasons whose score read is
linear: 2019, 2022, 2024, 2025, 2026. These are the seasons where mechanism 2 already says
`ALREADY MATCHES`, so this stage is really mechanism 1 alone, and it can be measured cleanly.

**Flag:** reference section 10 measured that adopting Statbotics' 2024 entry set is an accuracy
LOSS of about 1.2 points, and that eleven components scored worse than three. Expect the same shape
elsewhere. **This is a fidelity stage, and it will likely cost accuracy. That is the locked trade,
not a regression to debug.**

**Closes:** mechanism 1 for five seasons.
**Republish debt: YES.**

### Stage 6 — Implement the non-linear seasons: 2023, then 2018

**Why sixth:** these are the only two seasons a re-grouping cannot reach. 2023 needs the 9-piece
cascade, the cube/cone regrade and two `min()` caps; 2018 needs `zero_sigmoid`, the double-sigmoid
asymmetry (reference section 18, observation 1), opponent coupling, and `post_clean_breakdown`'s
four `*_power` ratios. 2023 goes first because it is strictly simpler — no opponent coupling in its
score read.

**2018 additionally depends on R4**, the three 2018-only season aggregates, which must be
live-estimated before its attribution can be implemented. Do not start 2018 before stage 2's
machinery exists.

**Also in scope:** 2025's opponent-coupled processor-algae correction (mechanism 3) and its
attribution correction (mechanism 10), which are non-linear in the same sense even though 2025's
score read looks like a single entry.

**Closes:** mechanisms 2, 3 and 10 for 2018, 2023 and 2025.
**Republish debt: YES.**

### Stage 7 — 2016 and 2017 — BLOCKED ON A DEVELOPER DECISION

**Why last, and why it is not merely last but gated:** everything else in this list is an
implementation question. This one is not. R1 and R2 put roughly 5,000 matches — about one in six
across those two seasons — permanently outside a faithful reproduction under L-02, and the three
options (A, B, C above) produce three different published claims. **No implementation work on 2016
or 2017 should start before the developer picks one.** Doing the cleaning-layer work first and
discovering afterward that option B removes those matches from the comparison entirely would waste
it.

**Flag: this stage forces the developer's hand on the 2016/2017 elim-RP collision.** It is the only
stage in this list that does.

**Closes:** mechanisms 2 and 11 for 2016 and 2017, to whatever extent the chosen option allows.
**Republish debt: YES**, if any option other than pure documentation is chosen.

### Stage 8 — The 2026 `district == "isr"` exception

**Why last and unblocked:** it is a single-season, single-condition special case
(`mean_reversion = 0` for Israeli district teams in 2026, reference section 14) affecting only 2026
carry-in. It is genuinely small, and it is placed last because it is the one item whose omission
costs the least if the effort stops early.

**BLOCKED on data, not on decision:** SigmaScout's carry path does not currently read a district
field for a team-season. Whether the corpus carries one must be checked before this is scheduled.
**Closes:** the 2026-only remainder of mechanism 6.
**Republish debt: YES**, but confined to 2026 carry-in ratings.

### Stages that are blocked on a fetch

Reference section 20 lists ten residual gaps — facts absent from the eight fetched files. Two of
them block work above:

- **Residual gap 1 — how the 21 `Year` aggregate columns are COMPUTED** (over which match
  population, at what point in the season). Stage 2 can proceed without it, because L-01 forces a
  live estimate regardless, but the estimate would be aimed at a plausible neighbour of Statbotics'
  quantity rather than at the quantity itself. **This is the single most valuable remaining fetch**
  and it is one line of work: find and fetch the module that writes `YearORM`'s `*_mean` and
  `score_sd` columns.
- **Residual gap 3 — `backend/src/models/template.py`**, which holds the match loop and therefore
  the predict-before-update sequencing. Nothing above is blocked on it today, because SigmaScout's
  own walk-forward harness already enforces that ordering, but any claim that the two ORDERINGS
  match is currently unverified and should not be published until it is fetched.

Neither is a reason to delay stages 1 through 3.
