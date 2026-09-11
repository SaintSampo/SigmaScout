# Statbotics' breakdown key structure — recovered reference

**Why this file exists.** Twice now a SigmaScout measurement has been blocked because a
Statbotics detail was NAMED in planning docs but never transcribed into the repo. Quick task
260910-x09 hit it with the 2018 switch/scale sigmoid (`unmeasurable-no-reference`), and quick
task 260911-gfe hit it again with `all_keys[year]` — `02-RESEARCH.md:84` claims the table was
fetched on 2026-08-13 and line 664 cites the source file, but no transcription survived
anywhere in the repo. This file is the fix: the structure lives here, in the repo, so the next
reader does not have to re-fetch a third-party source to answer a question about our own model.

**Provenance and its limits — read before relying on anything below.** Fetched 2026-09-11 from
`raw.githubusercontent.com/avgupta456/statbotics/master/backend/src/breakdown.py` and
`backend/src/tba/breakdown.py`. The fetch returned a SUMMARY produced by a small model, not a
verbatim file dump, with the single exception of the quoted code fragments below. Treat the
quoted fragments as reliable and the surrounding prose as a faithful-but-secondhand reading.
**Any conclusion that needs exact per-season key spellings is NOT established by this file** and
requires a verbatim re-fetch. The structural conclusion in §3 does not need them.

---

## 1. The shape of `all_keys[year]`

```python
all_keys[year] = [
    "no_foul_points",
    "auto_points",
    "teleop_points",
    "endgame_points",
    "rp_1",
    "rp_2",
    "rp_3",
    "tiebreaker_points",
]
```

…followed by appending the mapped component names from `key_to_name[year]["comp_i"]` for
`i = 0..9`.

Each year's cleaned breakdown carries this template:

```python
{
    "score": score,
    "no_foul_points": no_foul_points,
    "foul_points": foul_points,
    "auto_points": auto_points,
    "teleop_points": teleop_points,
    "endgame_points": endgame_points,
    "rp_1": rp_1,
    "rp_2": rp_2,
    "rp_3": rp_3,
    "tiebreaker": tiebreaker,
    "comp_0" ... "comp_9": [component values]
}
```

## 2. The additive identity Statbotics itself enforces

This fragment came back verbatim, and it is the load-bearing fact:

```python
error = no_foul_points - (auto_points + teleop_points + endgame_points)
```

Statbotics validates that `no_foul_points` **equals** `auto_points + teleop_points +
endgame_points`. So the three phase keys ARE a disjoint additive partition of the non-foul
alliance score, and Statbotics checks it rather than assuming it.

## 3. `all_keys[year]` is a RATED-QUANTITY LIST, not a partition

This is the finding that matters, and it settles the question SigmaScout kept asking:

- `no_foul_points` is the **sum** of the three phase keys, so listing it alongside them
  double-counts the entire score.
- `comp_0..comp_9` are **sub-elements within** those phases — detailed breakdowns of the base
  categories, not independent score sources.
- `rp_1`/`rp_2`/`rp_3`/`tiebreaker_points` are not score contributions at all.
- In 2022 and 2026, `endgame_points` appears **twice** — once as a base key and again as a
  mapped component name.

So `all_keys[year]` enumerates everything Statbotics RATES, at several overlapping levels of
granularity at once. It is not, and was never intended to be, a partition of the score.

**Consequence for any SigmaScout comparison.** There is no such thing as "Statbotics' component
partition" derived from `all_keys`. Asking whether SigmaScout's per-season map "differs from
Statbotics' table" compares two different kinds of object: SigmaScout's map is an additive
partition used to reconstruct a score, Statbotics' list is a rating menu. The comparable
quantity is the one in §2 — the auto/teleop/endgame partition — and that one is well defined.

## 4. Per-season component names (NOT verbatim — do not rely on spellings)

Reported by the fetch, secondhand. Recorded for orientation only:

| season | base keys | component names (approximate) |
|---|---|---|
| 2022 | the eight above | `auto_taxi_points`, `auto_cargo_lower`, `auto_cargo_upper`, `teleop_cargo_lower`, `teleop_cargo_upper`, `endgame_points` (duplicate) |
| 2023 | the eight above | ten, `auto_charge_station_points` … `endgame_charge_station_points` |
| 2024 | the eight above | ten, `auto_leave_points` … `endgame_spotlight_points` |
| 2025 | nine (incl. `rp_3`) | ten, `auto_coral_points` … `barge_points` |
| 2026 | nine | seven, `auto_fuel` … `endgame_tower` |

## 5. What this means for SigmaScout's 2024 map

`docs/models/epa-divergences.md` §6 records that 2024's map was narrowed to phase groups
(auto/teleop/endgame) and matches three of Statbotics' own rated keys. Against §2 above, that
is not a partial match — the phase partition **is** Statbotics' additive partition, the one its
own validation enforces. For 2024, SigmaScout and Statbotics agree on the split.

## 6. Known mislabelled figure in this repo

`experiments/260910-4x0/granularity.ts` carries an arm labelled *"Statbotics comp partition
(leave/auto/tele/eg)"*, and its 0.7461 winner-accuracy figure is quoted in
`scripts/measureEpaDeviations.ts`'s deviation register as "Statbotics' comp partition". Per §3
that label is wrong: no such partition exists in Statbotics. The arm is a four-way grouping
this project assembled from `comp_*` names by monkey-patching `breakdown2024`. The number is a
real measurement of a real alternative — it is only the attribution that is incorrect, and it
should be relabelled as SigmaScout's own construction rather than deleted.

**Relabelled 2026-09-11** (quick task 260911-gfe) in `scripts/measureEpaDeviations.ts`'s
`component-map` `priorMeasurement.values`, from *"Statbotics' comp partition"* to *"a four-way
grouping THIS PROJECT assembled from comp_* names (NOT Statbotics' own)"*, and in
`docs/models/epa-divergences.md` §6. The value 0.7461 is unchanged; only what it is a number OF
is corrected.

## 7. Repo-side verification: the claim that this was already transcribed is FALSE

Checked 2026-09-11, before relying on anything above, because the plan for quick task
260911-gfe asserted this and required it be verified rather than assumed:

- `.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md:84` states the session
  "fetched Statbotics' actual source ... plus ... the full `all_keys[year]` component-name table
  for 2022-2026".
- Line 561 of that same file goes further: "Statbotics' `all_keys[year]` (verified, **quoted
  verbatim above**)".
- Line 664 cites `backend/src/breakdown.py` as "fetched verbatim".

There is no such quotation. A repo-wide search for the strings that would have to appear in any
verbatim transcription of that table — `comp_0`, `key_to_name`, `no_foul_points`,
`get_score_from_breakdown`'s per-year branches — returns nothing in `02-RESEARCH.md` except the
three prose citations above. The table was read in that session and never written down.

This is the SAME failure quick task 260910-x09 filed against the 2018 switch/scale sigmoid
(`unmeasurable-no-reference`: "the exact form was never transcribed into this repo"), hitting a
second time on a different fact from the same source file. Both times a later task was blocked by
a reference that a planning document confidently claimed to have.

The countermeasure is this file. It is deliberately in `docs/models/`, not in a phase folder, so
it is not archived with a milestone.

## 8. Per-season verdict: is a faithful Statbotics partition constructible?

`partition-constructible` takes exactly one of four values:

- `yes` — a non-overlapping additive partition of the quantity Statbotics rates exists and can be
  built from fields this project already parses.
- `no-overlapping-keys` — `all_keys[year]` double-counts, so there is no partition in it to match.
- `no-rates-a-single-quantity` — Statbotics predicts a season's score from ONE directly-rated
  quantity, so the only faithful "partition" is the degenerate one-cell one.
- `not-established` — the evidence in this repo does not support any verdict.

| season | what Statbotics RATES (`get_score_from_breakdown` branch) | do its `all_keys` form a non-overlapping additive partition of that quantity? | partition-constructible | evidence |
|---|---|---|---|---|
| 2016 | not established | **no** — §1 lists `no_foul_points` beside the three phase keys it is the sum of (§2), and `comp_*` are sub-elements within those phases (§3) | `no-overlapping-keys` | §1 + §2 + §3 of this file (structural, year-independent). Branch itself never transcribed. |
| 2017 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016 |
| 2018 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016. Note 2018 is also the season whose post-processing sigmoid is `unmeasurable-no-reference` for the same never-transcribed reason. |
| 2019 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016 |
| 2020 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016. SigmaScout registers a 2020 map but the ablation harness does not replay 2020 (the season was cut short); any 2020 arm would score almost nothing. |
| 2021 | n/a — no on-field FRC season with a TBA score breakdown | n/a | `not-established` | No 2021 map is registered in `breakdown/index.ts` and the corpus carries no 2021 matches. |
| 2022 | not established | **no**, same structural argument, and §4 reports `endgame_points` appearing TWICE in this year's list (once as a base key, once as a mapped component name) | `no-overlapping-keys` | as 2016, plus §4 (secondhand, orientation only) |
| 2023 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016 |
| **2024** | **`score = breakdown["no_foul_points"]`** — ONE directly-rated quantity | **no** — and the overlap is concrete here rather than structural: `speaker_points` re-counts notes already inside `auto_note_points`/`teleop_note_points` | **`no-rates-a-single-quantity`** | `docs/models/epa-divergences.md` §6, verified against `backend/src/models/epa/breakdown.py` and `backend/src/breakdown.py`, fetched 2026-09-10. The only season with a directly verified branch. |
| 2025 | not established | **no**, same structural argument | `no-overlapping-keys` | as 2016 |
| 2026 | not established | **no**, same structural argument, and §4 reports `endgame_points` appearing twice again | `no-overlapping-keys` | as 2016, plus §4 (secondhand, orientation only) |

**No season is `yes`.** Not one row of this table supports building an arm that toggles
"SigmaScout's component map versus Statbotics' component partition", because that second object
does not exist. `ARM_IDS` in `scripts/measureEpaDeviations.ts` is therefore unchanged by quick
task 260911-gfe, and that is the finding rather than a shortfall.

**What the structural argument does and does not rest on.** It rests on §1 (the shape of the
list) and §2 (the identity Statbotics validates), both of which are year-independent and both of
which came back as quoted code. It does NOT rest on §4's per-season component-name spellings,
which are secondhand and explicitly not established. A verdict that needed those spellings would
have to be `not-established`, and none of the rows above needs them.

## 9. Why "just use the phase partition" is not a shortcut

§2 and §5 establish that auto/teleop/endgame IS a real additive partition, enforced by
Statbotics' own validation. It is tempting to conclude that SigmaScout could measure faithfulness
for every season simply by replaying each one under
`componentGroupsForSeason(season)`'s three phase groups.

It could not, and the reason is worth recording so a future reader does not try.

`packages/core/algorithms/breakdown/groups.ts` declares its grouping as a JUDGEMENT, and its own
header says so at length. Several of those judgements deliberately disagree with the source's
own roll-up:

- 2019's `habClimb` is grouped ENDGAME, and the file notes "TBA's own `teleopPoints` roll-up
  bundles HAB climb together with hatch panels and cargo".
- 2016's `teleopChallenge`/`teleopScale` are grouped ENDGAME despite TBA counting them elsewhere.
- 2022's bare `endgame` component gets the same treatment, again against a `teleopPoints`
  roll-up.

So SigmaScout's phase groups are not TBA's phase fields, and TBA's phase fields are not
necessarily Statbotics' either — Statbotics computes `auto_points`/`teleop_points`/
`endgame_points` per year in `breakdown.py`, and those per-year formulas are exactly what was
never transcribed. Building a "phase partition" arm out of `groups.ts` would measure
SigmaScout's own phase judgement, label it Statbotics', and reproduce the mislabelling §6
already documents. The one season where the two provably agree is 2024, whose shipped map IS
the phase partition already.

## 10. What this DOES leave measurable, and what it already cost

For 2024 the faithful comparison is not a different partition, it is Statbotics' actual target:
rate the single no-foul total and predict from that. That arm was already run.
`experiments/260910-4x0/granularity.ts` labels it "Statbotics' ACTUAL target (no_foul total)"
and it scored **0.7403** winner accuracy on 2024's 16,764 decided official matches, against the
shipped phase-group map's **0.7520**.

Read plainly: on 2024, copying what Statbotics rates would cost SigmaScout about **1.2 percentage
points** of winner accuracy. The divergence is real, it is deliberate, and it is measured.

Two cautions carried forward from `epa-divergences.md` §6, both still load-bearing:

- That experiment used its own scratch scorer, not `aggregateScores`. Its numbers are internally
  comparable to each other and must NOT be differenced against a published figure (see the
  scorer-mismatch hazard: a published Brier counts ties, most scratch scripts do not).
- The curve TURNS OVER. Eleven components scored 0.7348, three scored 0.7520, one scored 0.7403.
  "Fewer components is better" is not the lesson, and no other season may be coarsened on the
  strength of 2024's result without measuring that season the same way.
