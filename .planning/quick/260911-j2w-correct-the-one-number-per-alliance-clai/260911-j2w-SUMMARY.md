---
phase: quick-260911-j2w
plan: 01
subsystem: prediction-models
tags: [epa, statbotics-reproduction, week-1-calibration, methodology-page, walk-forward]
status: complete
requires:
  - docs/models/statbotics-breakdown-reference.md sections 3, 18, 19, 20 (avg.py verbatim)
  - data/corpus.sqlite (events.week, 0-indexed)
  - data/diagnostics/epa-deviation-ablation.json at epa@8.0.0+baseline (the BEFORE)
provides:
  - packages/core/algorithms/epaWeekOne.ts (the off-by-one constant, the null-week policy, the freeze rule)
  - UpcomingMatch.week plumbed end to end, required and non-outcome-bearing
  - epa@9.0.0+baseline (frozen week-1 SD and mean from week 2 on)
  - STATE_SNAPSHOT_SHAPE_VERSION 13
affects:
  - apps/worker/src/scheduled.ts (live fold now supplies week)
  - packages/harness/publish.ts, preSchedule.ts (synthetic matches carry the real event week)
  - /methodology/epa-vs-statbotics (component-maps entry corrected; win-probability-scale entry NOT, see debt)
tech-stack:
  added: []
  patterns:
    - "a named constant plus a corpus-backed test for an off-by-one that fails silently"
    - "seal-on-first-proof rather than lookahead, to keep a frozen aggregate walk-forward legal"
key-files:
  created:
    - packages/core/algorithms/epaWeekOne.ts
    - packages/core/algorithms/epaWeekOne.test.ts
    - .planning/quick/260911-j2w-correct-the-one-number-per-alliance-clai/before-epa-deviation-ablation.json
    - .planning/quick/260911-j2w-correct-the-one-number-per-alliance-clai/after-epa-deviation-ablation.json
  modified:
    - apps/web/src/components/methodology/epaComparisonContent.ts
    - apps/web/src/components/methodology/epaComparisonContent.test.ts
    - scripts/measureEpaDeviations.ts
    - docs/models/epa-divergences.md
    - docs/models/epa-statbotics-gap.md
    - packages/core/algorithms/types.ts
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epaCarryScale.ts
    - packages/corpus/db.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/publish.ts
    - packages/harness/preSchedule.ts
    - apps/worker/src/scheduled.ts
    - packages/harness/fixtures/digest-slice.json
    - data/baselines/level1-digest-2026-09.json
    - data/diagnostics/epa-deviation-ablation.json
decisions:
  - "Statbotics' week 1 IS this corpus's week === 0, verified against corpus data in all nine seasons rather than asserted"
  - "null-week play (championship/preseason/offseason) is UNPLACED: never in the week-1 population, never a freeze trigger"
  - "the freeze triggers on the first match with a numeric week greater than 0, which needs no lookahead and is therefore walk-forward legal"
  - "UpcomingMatch.week is REQUIRED, not optional, because null is a real state and an optional field would hide a forgotten construction site"
  - "the carry-anchor numerator is chosen at the CALL SITE, leaving epaCarryScale.ts's proven arithmetic untouched"
  - "reported the measurement as found; nothing was swept, selected or adjusted after seeing a number"
metrics:
  duration: ~4h
  completed: 2026-09-11
actuals:
  tokens: 121000
  tasks: 3
  commits: 3
---

# Quick task 260911-j2w: correct the one-number-per-alliance claim, then adopt Statbotics' week-1 calibration — Summary

Retracted a false claim live on a user-facing methodology page and in two internal surfaces, then
retargeted EPA's two live-estimated season scalars at the **frozen week-1 aggregates Statbotics
actually uses** — shipping `epa@9.0.0+baseline` with a pooled Brier improvement of 0.00153, a
pooled accuracy movement of +0.00021, and one named per-season regression reported rather than
engineered away.

## Commits

| # | Hash | What |
|---|---|---|
| 1 | `894cb923` | Task 1 — retract the one-number-per-alliance claim on all three surfaces (docs/prose only) |
| 2 | `bfe42c31` | Task 2 — plumb the event's competition week end to end, off-by-one pinned by test |
| 3 | `3f36e582` | Task 3 — `epa@9.0.0+baseline` reads a frozen week-1 aggregate from week 2 on |

---

## Task 1 — the three corrected surfaces, quoted

### Surface 1 (published): `apps/web/src/components/methodology/epaComparisonContent.ts`, the `component-maps` entry

**BEFORE** (paragraphs 2 and 3):

> "Statbotics predicts from a single number instead. For 2024 it rates one quantity per alliance, the match score with penalty points taken out, and predicts directly from that. It does publish piece by piece figures beside it, and those are worth reading, but they are extra views rather than the thing its predicted score is built from. Several of them overlap, counting the same points at two levels of detail at once."
>
> "So the two sites are not slicing the same score two different ways. One rates several pieces and adds them up. The other rates one total. For 2024 the three pieces SigmaScout rates are the three phases of a match, which is also the split Statbotics uses when it checks its own numbers add up."

**AFTER:**

> "Statbotics rates a list of pieces for every team too, and adds those lists together across an alliance the same way. What differs is how many pieces from that list its predicted score reads back. For 2024 it reads one of them, the match score with penalty points taken out. For 2018 and 2023 it reads seven, and in 2018 it also reads three pieces belonging to the other alliance."
>
> "The pieces Statbotics rates overlap each other on purpose. Its list carries a full total beside the smaller pieces that total is made from, so adding the whole list up would count the same points twice. SigmaScout's pieces are built not to overlap, because adding them is how the predicted score is made. For 2024 the three pieces SigmaScout rates are the three phases of a match, which is also the split Statbotics uses when it checks its own numbers add up."

One further sentence was tightened for accuracy in the measured-figures paragraph — **BEFORE:** "Rating a single total, which is the shape Statbotics uses, predicted 74.0 percent." **AFTER:** "Rating a single total, which is what Statbotics' own 2024 prediction reads, predicted 74.0 percent."

The `heading` ("How a match score is split into pieces") is **unchanged**, as the developer named by that exact phrase. `EPA_DIFFERENCE_IDS` is **byte-identical** — verified as 0 changed lines across all three commits. The thin-evidence paragraph, the 73.5 / 75.2 / 74.0 percent figures, and the overlapping-list fact all survive.

The module header's `260911-gfe` revision note was corrected in place (it argued for the claim the body has now dropped) and a new dated `260911-j2w` note added above it citing reference section 3.

### Surface 2: `scripts/measureEpaDeviations.ts`, `deviationRegister()`'s `component-map` entry

**BEFORE** (`summary`, final sentence):

> "What this entry used to call a difference in GROUPING turns out to be a difference in KIND: SigmaScout rates several components and sums them, Statbotics rates one quantity per season and predicts from it directly."

**AFTER:**

> "BOTH SIDES RATE A PER-TEAM VECTOR and sum it across the alliance (reference section 3: predict_match sums an 18-entry vector component-wise). What differs is which entries the predicted score READS: one (no_foul_points) in most seasons, seven in 2018 and 2023, plus three of the OPPONENT's in 2018, and 2018 and 2023 read them non-linearly through min() caps and zero_sigmoid terms. That is a difference of DEGREE inside a shared structure. Corrected by quick task 260911-j2w; this field previously asserted a difference of kind."

`reason` was also updated — its old supporting claim that "there is nothing to point the arm at" no longer holds, since reference sections 15/17/18 now give a concrete per-season target. It **keeps its `statbotics-breakdown-reference` citation**, which `measureEpaDeviations.test.ts:642` asserts. `status`, `armIds`, `priorMeasurement` and `ARM_IDS` are untouched: registering an arm is a separate decision.

### Surface 3: `docs/models/epa-divergences.md` section 6

**BEFORE** (sub-heading and closing paragraph):

> "### CORRECTED 2026-09-11 (quick task 260911-gfe): this is a difference in KIND, not in grouping"
>
> "So there is no 'Statbotics component partition' to compare a SigmaScout map against. The two objects are different in kind: an additive partition summed into a prediction on one side, a rating menu on the other."

**AFTER:**

> "### CORRECTED 2026-09-11 (quick task 260911-j2w): both sides rate a per-team vector, and the difference is one of DEGREE"
>
> "**Statbotics rates a per-team vector and sums it across the alliance, structurally the same thing SigmaScout does.** Every entry keeps being rated, updated by `attribute_match` every match, and published by `post_record_team`, whether or not a predicted score ever reads it."
>
> "So there is still no 'Statbotics component partition' that a SigmaScout map can be diffed against entry-for-entry, and an arm built by hand-picking a non-overlapping subset of those keys would measure this project's own construction under Statbotics' name."

The `predict_match` line is now quoted verbatim in the doc, and a per-season table of which entries the score reads was added. Every surviving fact was kept: the `all_keys[year]` double-counting bullets, the 0.7461 label correction, the 2024 narrowing table, and the "curve turns over" caution. The section's `**Statbotics:**` opening line was also corrected from "rates a per-season list" to "rates a PER-TEAM vector ... sums that vector component-wise across the alliance".

### The pin

`epaComparisonContent.test.ts` gained a gate asserting the `component-maps` entry's joined heading + paragraphs contain none of `"rates one quantity per alliance"`, `"rates one quantity per season"`, `"predicts from a single number instead"`, `"the other rates one total"`. **Proven to fail**: the retired phrase was temporarily pasted back, the test went red naming the exact string, and the injection was reverted.

---

## The week mapping — VERIFIED, not assumed

Statbotics' `backend/src/data/avg.py` filters `m.week == 1`. This corpus stores TBA's week
**0-indexed**. So **Statbotics' week 1 is this corpus's `week === 0`.**

Corpus evidence, queried directly from `data/corpus.sqlite`:

| season | week-0 window | week-1 window | week 0 closes before week 1 opens |
|---|---|---|---|
| 2016 | 2016-02-24 .. 2016-02-24 | 2016-03-02 .. 2016-03-08 | yes |
| 2017 | 2017-03-01 .. 2017-03-06 | 2017-03-08 .. 2017-03-13 | yes |
| 2018 | 2018-02-28 .. 2018-03-02 | 2018-03-05 .. 2018-03-10 | yes |
| 2019 | 2019-02-27 .. 2019-03-01 | 2019-03-04 .. 2019-03-09 | yes |
| 2022 | 2022-03-02 .. 2022-03-06 | 2022-03-08 .. 2022-03-13 | yes |
| 2023 | 2023-02-26 .. 2023-03-03 | 2023-03-08 .. 2023-03-12 | yes |
| 2024 | **2024-02-24 .. 2024-03-03** | **2024-03-05 .. 2024-03-08** | yes |
| 2025 | 2025-02-23 .. 2025-02-28 | 2025-03-04 .. 2025-03-08 | yes |
| 2026 | 2026-03-03 .. 2026-03-07 | 2026-03-09 .. 2026-03-15 | yes |

2024's week-0 window is FRC's own Week 1 (Feb 24 – Mar 3). If corpus week 0 were a preseason
bucket, that window would sit in January. Corpus week 1 opens 2024-03-05, which is FRC Week 2.

Pinned by three corpus-backed assertions in `epaWeekOne.test.ts` (they RAN, not skipped — 21/21
passing with the corpus present):

1. 2024's week-0 events start on or after 2024-02-24 and strictly before the first week-1 event.
2. The week-0 window closes before the week-1 window opens in **every** corpus season (the property the freeze rule depends on).
3. **No** event carrying a non-null week is offseason or preseason (`event_type >= 99 OR is_offseason = 1` returns 0 rows corpus-wide) — nothing unofficial can reach the week-1 population.

Plus two boundary assertions: `selectMatchesChronological(db, {year: 2024})` returns rows with
`week === 0`, rows with `week === null`, and no row where the key is absent; and
`isStatboticsWeekOne` selects exactly the corpus's own week-0 played count for 2024.

Week-0 population size, per season (played matches): 2016 **102**, 2017 1906, 2018 1897, 2019
1532, 2022 1777, 2023 2354, 2024 2773, 2025 2177, 2026 2401. **2016's single week-0 event is the
thinnest, and it is the season whose Brier regressed** — see the measurement below.

### Null-week matches (championship, preseason, offseason)

**Policy: a null-week match is UNPLACED. It never joins the week-1 population and never triggers
the freeze.** It is neither week 1 nor "after week 1", and treating unplaced play as either would
be a guess. The bucket is genuinely heterogeneous, which is why: in 2024 it is 143 events and
6,255 played matches whose start dates span 2024-02-03 to 2024-12-27 — some before week 1, some
long after. The policy is written in `epaWeekOne.ts`'s header where a reader of the fold rule
will see it, and encoded in the signature (`isStatboticsWeekOne(week: number | null)` answers
`false` for `null` explicitly rather than by coercion).

The Worker applies the same rule: a failed TBA event-detail fetch yields `week = null`, **never
`0`**, because `0` is a real week.

---

## The freeze rule, and why it is walk-forward legal

Implemented in `packages/core/algorithms/epaWeekOne.ts`:

- `foldWeekOneAllianceScore(state, week, score)` — advances a **week-1-only** Welford accumulator, and only when `isStatboticsWeekOne(week)` and the state is not yet sealed. Non-finite scores are dropped rather than folded.
- `sealWeekOneIfPast(state, week)` — **the first match carrying a numeric week greater than 0 freezes the aggregate.** `week === null` never seals; `week === 0` never seals.
- A seal that finds fewer than `EPA_WEEK_ONE_MIN_OBS = 2` observations, or a non-finite/non-positive spread, records `sealed: true` with `frozen: null`: the caller keeps its live estimate and **the state records that it did**, rather than shipping a degenerate constant (a zero SD is an infinite logistic scale).
- Once sealed, a late week-1 arrival does **not** reopen the aggregate.
- `carrySeason` resets the whole thing, so each new season starts unsealed with an empty accumulator — deliberately **not** seeded from the outgoing season, which would be last season's point scale masquerading as this one's.

**Why it is legal.** Matches stream in chronological order, so the first match with a numeric week
greater than 0 *proves* every week-1 match has already been played. It needs no lookahead. During
week 1 itself `frozen` is `null` and both read points fall back to the live expanding estimate, so
**a week-1 prediction can never be informed by a week-1 match that has not been played.** This
narrows L-01 from a season-wide divergence to a one-week one.

The corpus-backed assertion that the week-0 window closes before the week-1 window opens in every
season is what makes the trigger sound rather than merely plausible.

`EPA_WEEK_ONE_MIN_OBS = 2` is `standardDeviation`'s own contract boundary, not a tuned threshold.
Nothing was searched.

### Two costs, named rather than hidden

1. **One-match lag.** The seal happens inside `update`, so a season's first week-2 match is *predicted* before its own fold seals the aggregate and still reads the live estimate. One match per season out of roughly sixteen thousand. Left as-is deliberately: closing it would need a second, lazily-computed read path in `predict` that could drift from the sealed value.
2. **Late week-1 arrivals are excluded.** Week-0 and week-1 *event* windows never overlap by start date, but a multi-day week-0 event can still run a match on the day a week-1 event opens. Such a match is excluded rather than reopening the freeze, so the frozen population can be slightly smaller than Statbotics' offline `week_one_matches` list. A frozen constant that keeps moving is not a constant.

---

## The two read points, and how far each reaches

**(a) `predict`'s norm-diff denominator** — frozen week-1 SD after the seal, `standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD)` before it. This is an **EXACT target**: `avg.py` computes `year.score_sd` from the RAW alliance score with fouls INCLUDED (`no_foul_mean` keeps only its mean; its SD is discarded into `_`), and the raw alliance score is precisely what `epa.ts` already folds. Reaches **every match from week 2 onward, in every season**.

**(b) `carryRescaleRatio`'s numerator** — the frozen week-1 mean after the seal, `cleanSeasonMean`'s live unwind before it. Chosen at the **call site** (`carryRescaleRatioFor`), so `epaCarryScale.ts`'s proven arithmetic is untouched and its reproduction gate stayed green with no edit to any expectation.

A carried team is rescaled on **first sight** in the new season, so read point (b)'s reach is
decided by when each team first plays. Counted from the corpus directly (no replay):

| season | teams playing | first seen in week 0 (live unwind, as 8.0.0) | first seen after week 0 (frozen mean) | first seen null-week |
|---|---|---|---|---|
| 2017 | 3454 | 869 | **2433** | 152 |
| 2018 | 3715 | 858 | **2734** | 123 |
| 2019 | 3876 | 655 | **3083** | 138 |
| 2022 | 3150 | 767 | **2268** | 115 |
| 2023 | 3409 | 1004 | **2256** | 149 |
| 2024 | 3574 | 1176 | **2246** | 152 |
| 2025 | 3787 | 939 | **2720** | 128 |
| 2026 | 3751 | 1009 | **2657** | 85 |

So roughly **63–80% of each season's teams** take the frozen-mean branch. The pre-freeze half is
load-bearing and not a mere fallback: the remaining ~25% first seen in week 0 would **forfeit
their rescale entirely** if the anchor waited for the seal. Keeping 8.0.0's live estimate during
week 1 and switching at the boundary is what makes this a refinement of 8.0.0 rather than a
reversal of it.

**Honest caveat on instrumentation.** `data/diagnostics/epa-deviation-ablation.json`'s `carryScale`
rows are **byte-identical** before and after. That is expected and is *not* evidence that read
point (b) did nothing: that diagnostic is computed independently by the script from the
season-END accumulator via `cleanSeasonMean` (`measureEpaDeviations.ts:1629-1648`), not read off
the per-team ratio the model actually applied. Read point (b)'s behaviour is evidenced by the unit
tests and by the table above, not by that row.

---

## BEFORE / AFTER: winner accuracy and Brier, per season and pooled, event-blocked

**Verdict, stated plainly: pooled Brier improved by 0.00153 and pooled winner accuracy by 0.00021.
Brier improved in 8 of 9 seasons and REGRESSED in 2016. Winner accuracy regressed in 2017, 2023
and 2024.** All movements are small. This was a reproduction-fidelity change, not an accuracy
play, and no constant was touched after any number was seen.

Both sides come from the **same scorer in the same script** (`packages/harness/score.ts`
`aggregateScores`, ties counted in Brier, combined comp-level view), the **same stream population**
(`offseason-inclusive`) and the **same nine seasons** — verified field-by-field on the two
artifacts. They are therefore directly comparable to each other, and **neither may be differenced
against any figure from a scratch scorer that handles ties differently.**

BEFORE = `epa@8.0.0+baseline`, generated 2026-09-11T16:31:12.921Z.
AFTER = `epa@9.0.0+baseline`, generated 2026-09-11T18:55:57.466Z.

| scope | season | events | n | ACC before | ACC after | ACC Δ | Brier before | Brier after | Brier Δ |
|---|---|---|---|---|---|---|---|---|---|
| season | 2016 | 136 | 12994 | 0.7195 | 0.7195 | 0.00000 | 0.1857 | 0.1862 | **+0.00052** |
| season | 2017 | 165 | 15363 | 0.6718 | 0.6718 | **-0.00007** | 0.2045 | 0.2043 | -0.00028 |
| season | 2018 | 179 | 16889 | 0.7315 | 0.7320 | +0.00053 | 0.1802 | 0.1798 | -0.00041 |
| season | 2019 | 194 | 17972 | 0.7213 | 0.7214 | +0.00011 | 0.1883 | 0.1834 | -0.00493 |
| season | 2022 | 184 | 14603 | 0.7757 | 0.7767 | +0.00097 | 0.1570 | 0.1549 | -0.00201 |
| season | 2023 | 185 | 16290 | 0.7595 | 0.7591 | **-0.00037** | 0.1639 | 0.1627 | -0.00116 |
| season | 2024 | 192 | 16958 | 0.7547 | 0.7544 | **-0.00024** | 0.1695 | 0.1682 | -0.00130 |
| season | 2025 | 204 | 17815 | 0.7781 | 0.7783 | +0.00017 | 0.1588 | 0.1571 | -0.00174 |
| season | 2026 | 214 | 18337 | 0.7929 | 0.7936 | +0.00071 | 0.1534 | 0.1517 | -0.00168 |
| **pooled** | — | **1653** | **147221** | **0.7465** | **0.7467** | **+0.00021** | **0.1729** | **0.1714** | **-0.00153** |

Onset window (first 500 matches of each season), same two runs:

| scope | season | events | n | ACC before | ACC after | ACC Δ | Brier before | Brier after | Brier Δ |
|---|---|---|---|---|---|---|---|---|---|
| onset | 2017 | 11 | 500 | 0.6450 | 0.6450 | 0.00000 | 0.2140 | 0.2140 | 0.00000 |
| onset | 2018 | 13 | 500 | 0.6513 | 0.6493 | **-0.00200** | 0.2137 | 0.2138 | **+0.00005** |
| onset | 2019 | 12 | 500 | 0.6660 | 0.6680 | +0.00202 | 0.2246 | 0.2246 | -0.00001 |
| onset | 2022 | 12 | 500 | 0.7530 | 0.7551 | +0.00202 | 0.1780 | 0.1780 | -0.00003 |
| onset | 2023 | 18 | 500 | 0.6962 | 0.6962 | 0.00000 | 0.1935 | 0.1935 | -0.00001 |
| onset | 2024 | 16 | 500 | 0.6884 | 0.6884 | 0.00000 | 0.2067 | 0.2067 | -0.00001 |
| onset | 2025 | 12 | 500 | 0.7238 | 0.7258 | +0.00202 | 0.1894 | 0.1894 | -0.00001 |
| onset | 2026 | 12 | 500 | 0.7103 | 0.7103 | 0.00000 | 0.1874 | 0.1874 | -0.00003 |
| **onset pooled** | — | **106** | **4000** | **0.6917** | **0.6922** | **+0.00050** | **0.2009** | **0.2009** | **-0.00001** |

The onset window barely moves, which is exactly what the design predicts: most onset matches are
week-1 matches, and during week 1 the model reads what 8.0.0 read.

### About the 2016 regression

2016 is the one season whose Brier is definitively worse. It is also the season with **one**
week-0 event and 102 played matches — by far the thinnest week-1 population in the corpus (every
other season has 1,500–2,800). A frozen constant estimated from a single regional is then applied
to the whole season. This is reported as the result, not fixed: no threshold was introduced to
exclude thin seasons, because introducing one after seeing this number is exactly the tuning this
task forbids.

### Uncertainty, stated honestly

These are **point estimates with no confidence intervals**. BEFORE and AFTER are two separate runs
of the script rather than two arms inside one run (the change ships inside the module, not as a
toggleable deviation), so the script's paired, event-blocked bootstrap machinery — which is what
produces the intervals quoted elsewhere in this repo — does not apply across them. The
`eventCount` column is given beside every row so the event-blocked denominator is visible, but a
"95% interval" must not be read into any delta above.

---

## Version bumps

**`epa.version` 8.0.0+baseline → `9.0.0+baseline`.** MAJOR, deliberately: every published
`pRedWin` from week 2 onward changes in every season, and every carried rating rescaled after a
freeze changes too. Same D-13 invariant as every prior bump — no version string may stand for two
structurally different computations. The dated comment names the change, the walk-forward
argument, the fidelity-not-accuracy framing, and the three limitations.

**`STATE_SNAPSHOT_SHAPE_VERSION` 12 → `13`. This one is load-bearing**, for exactly the reason
the 11 → 12 block already records: `apps/worker/src/stateStore.ts`'s `readScopedState` filters
rows by `algorithm_id` **only** and never by version, so bumping `epa.version` alone does **not**
make a stale seeded row unreachable. A shape-12 EPA league row would deserialize with the
`weekOne` fields **absent**, leaving the frozen aggregate permanently unavailable — so the Worker
would use the **live expanding estimate for the entire season** while the offline publisher used
the **frozen week-1 constant**. The two would then disagree on every prediction from week 2
onward, **with no error, no NaN and no malformed row to find**: both sides look perfectly healthy
and only the numbers differ. The shape check is the only thing that turns that into a loud
`LeagueRowShapeVersionError` naming the re-seed as the fix. That paragraph is written into the
12 → 13 doc block.

`weekOne` is serialized in the **LEAGUE** row (an accumulator, a nullable `{mean, sd}` and a
boolean — none scale with team count, the D-13 rule), with **no `??` default on deserialize**:
a default would be precisely the silent degradation the bump exists to prevent. Four round-trip
tests were added: frozen, unsealed, sealed-with-nothing-frozen (distinct from unsealed and not
interchangeable with it), and a stale shape-12 row throwing.

**Seed first, deploy second.** The Worker needs a re-seed from a fresh publish run.

---

## The named residual gap (a remaining difference, not papered over)

**Statbotics' MEAN target and SigmaScout's frozen mean are not the same quantity.**
`get_constants(year)` reads week-1 **`no_foul_mean`** (falling back to `score_mean`). SigmaScout's
frozen mean is over the **RAW alliance score, fouls INCLUDED**.

- The **SD** target is **EXACT**: `avg.py` computes `year.score_sd` from the raw score with fouls included, and discards `no_foul_mean`'s own SD into `_`. Read point (a) hits it exactly.
- The **MEAN** target is a **named neighbour**. Read point (b) is aimed at the right window and the right kind of quantity, but at a foul-inclusive mean rather than a foul-free one.

Closing it needs a **second, no-foul week-1 accumulator**, which this task deliberately did NOT
build. Registered in `docs/models/epa-statbotics-gap.md`'s R3 entry as residual gap 1, alongside
two others recorded there:

2. **`avg.py`'s 2025 processor-algae correction is NOT adopted.** Upstream subtracts `3 * comp_6_mean` from `no_foul_mean`, `teleop_mean` and `comp_7_mean` at aggregate time — a second site for the same adjustment beyond `post_process_breakdown`. SigmaScout applies neither.
3. **The frozen population can be slightly smaller than Statbotics' `week_one_matches`** (late week-1 arrivals, above).

---

## Republish debt — OWED, CUMULATIVE, UNPAID

**A republish is owed for `epa@9.0.0+baseline` AND for the still-unpublished `epa@8.0.0+baseline`.**
8.0.0 landed earlier the same day (quick task 260911-3kc) and its republish had never been run, so
every published EPA rating and every published `pRedWin` on the live site now predates **both**
changes. No republish, no R2 write and no retune was performed by this task — all were out of
scope by explicit prohibition.

Also recorded, so it is not mistaken for new breakage:

- **`scripts/epaVsStatbotics.ts --check` was already failing** against `data/baselines/epa-vs-statbotics-2026-09.json` under 8.0.0 (documented at the top of `docs/models/epa-divergences.md`). It still fails. That is **pre-existing** and was deliberately **not** re-baselined here.

---

## Deviations from plan

### Auto-fixed

**1. [Rule 3 – Blocking] `replay.test.ts`'s `ALL_NON_OUTCOME_KEYS` needed `week` registered (10 → 11).**
Three leak-proof Proxy enumeration tests pin the exact non-outcome key set. `week` is non-outcome-bearing for the same reason `eventType` is (an event's week is fixed when the event is scheduled), so it belongs on that list, not in `OUTCOME_KEYS`. This is the mechanism working as designed, not an expectation loosened to pass. Commit `bfe42c31`.

**2. [Rule 3 – Blocking] `packages/harness/fixtures/digest-slice.json` re-extracted.**
The committed fixture is a `MatchResult` snapshot; adding a required field made it differ from the corpus, failing the "fixture is not stale" gates in `digest.test.ts` (×5) and `level1Digest.test.ts`. Re-extracted with the repo's own `extract-digest-slice.ts`. **The diff is `week` additions only**, and every `predictionStreamSha256` stayed identical — which is the proof Task 2 changed no behaviour. Commit `bfe42c31`.

**3. [Rule 3 – Blocking] `data/baselines/level1-digest-2026-09.json` regenerated for the version bump.**
The D-12 gate compares the recorded `algorithmVersion` first and fails with "the baseline predates this promotion ... Regenerate the baseline deliberately (never to silence a real leak) if this version bump is expected." Regenerated via plan 09-01's own recipe (fixture path, `resolvePublishAlgorithms(undefined)`, imported `computePredictionStreamDigest`). **All three digests came back UNCHANGED** — `opr`, `epa` and `bpr` — so the only diff is EPA's version string and `measuredAt`. EPA's digest is unchanged because the 2022 slice (`2022azfl` week 1, `2022azva` week 2, `2022alhu` week 5) contains **no week-0 matches**, so the seal fires with zero observations and the live estimate applies throughout. A clean inertness proof. Commit `3f36e582`.

**4. [Rule 3 – Blocking] `epa.version` and `STATE_SNAPSHOT_SHAPE_VERSION` equality pins updated.**
`epa.test.ts` pinned `"8.0.0+baseline"` inside a test whose *name* asserted the component-map seam does not bump the version. Renamed to "carries exactly one version string, pinned by equality so any bump is deliberate", with a comment recording that the seam still bumps nothing and that the string moved for an unrelated reason. `stateSnapshot.test.ts`'s `toBe(12)` → `toBe(13)`, with a new paragraph describing what a stale shape-12 row would silently do. Both are the pin mechanism working: it forced the edit to be deliberate.

**5. [Rule 2 – Missing] `epaCarryScale.ts` gained a doc pointer** naming the two numerator sources now reaching `carryRescaleRatio`, so a reader of that function is not left believing `cleanSeasonMean` is its only caller path. No behaviour change; its reproduction gate stayed green with no edit to any expectation.

### Concurrency deviations (another session active in this checkout)

**6. Two files were held back from commit `bfe42c31`** because a concurrent session (phase 09, plan 09-04) rewrote them mid-task: `apps/worker/src/bundleSmoke.ts` and `packages/harness/promotedOverrides.test.ts`. Staging them would have absorbed foreign edits. Both carried my `week: null` lines in the working tree and **both landed in that session's commit `5de615fc`** — verified present at HEAD. No work was lost and the tree is consistent.

**7. Three test failures observed mid-task were NOT mine** and resolved when that session committed: `innovationVariance.test.ts`, `sigma1.test.ts` and `publish.test.ts` RP-pmf assertions. Cause confirmed from their diff — `sigma1/index.ts`'s own new comment reads "the RP pmf block that used to live here is GONE". My diffs in those files were purely additive `week: null,` lines.

### Out of scope, NOT fixed (logged)

**8. `apps/worker/tsconfig.json` typecheck has one pre-existing error**: `packages/corpus/db.ts(28,35)` — a `URL` ambient-type collision between `@cloudflare/workers-types` and Node's types, on a line untouched by this task and byte-identical at HEAD. `apps/worker/src/liveWindows.ts`'s and `apps/worker/test/scheduled.replay.test.ts`'s own headers both document this exact collision as a known condition. Left alone per the scope boundary.

No architectural (Rule 4) decisions were needed. No authentication gates. No packages installed.

---

## Known stubs

None. Nothing was left hardcoded, placeholdered or unwired.

## Published-surface debt created and discovered (NOT a stub — a documented follow-up)

`/methodology/epa-vs-statbotics`'s **`win-probability-scale`** entry still tells readers Statbotics
"uses one number for the whole season, **calculated only once the season is over**". The `avg.py`
transcription disproves the second half: the number is computed from week 1. The same entry's
description of SigmaScout's side is now **incomplete rather than false** — "a running measure that
only knows about matches played so far" still holds of the frozen week-1 aggregate, but the entry
does not mention the freeze.

This entry was **deliberately not edited**: the plan pinned three surfaces and this page's content
set is a locked decision (`EPA_DIFFERENCE_IDS`). It is recorded in `docs/models/epa-divergences.md`
section 4 as an owed correction to be made alongside the republish this version owes, so it is a
known open item rather than a silent one. **Recommend a follow-up quick task** batched with the
republish.

## Threat flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change.
`week` enters through the existing Zod-validated `tbaEventSchema.week` and the existing
`events.week` corpus column; no new parse surface. T-j2w-01 (stale league row) was mitigated as
planned by the shape bump. T-j2w-02 (secrets) — no task read a secret, and `.env` was never read,
opened, printed or interpolated. T-j2w-03 (concurrent git index) — every commit used an explicit
pathspec, `git add -A` was never used, and `git status` was checked after each.

---

## Verification

| check | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `npx tsc --noEmit -p apps/worker/tsconfig.json` | 1 pre-existing error (deviation 8), no new ones |
| `npx vitest run` (repo root) | **253 files, 4885 passed, 4 skipped, 0 failed** |
| `epaWeekOne.test.ts` | 21 passed, corpus-backed cases RAN (not skipped) |
| negative-grep on all three Task 1 surfaces | 0, 0, 0 |
| `EPA_DIFFERENCE_IDS` changed lines across all 3 commits | 0 |
| `git diff 894cb923^..HEAD -- packages/bpr experiments/phase-bpr` | 1 file, 1 insertion: `equivalence.ts`'s `+      week: m.week,`. Nothing else. No BPR logic, no holdout read, no retune. (The plan's `HEAD~3` form is wrong now — the other session landed three commits between mine, so the range is stated explicitly.) |
| foreign `.planning/phases/09-*` files staged | 0 |
| R2 write / publish / retune | none |
| before/after delta table | every season and both pooled rows present, none MISSING |

## Self-Check: PASSED

All created files exist (`epaWeekOne.ts`, `epaWeekOne.test.ts`, `before-epa-deviation-ablation.json`,
`after-epa-deviation-ablation.json`) and all three commits are present in `git log`
(`894cb923`, `bfe42c31`, `3f36e582`).
