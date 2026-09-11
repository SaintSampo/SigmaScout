---
phase: quick-260911-i9f
plan: 01
subsystem: models/epa
tags: [statbotics, epa, reference, gap-analysis, documentation]
status: complete
requires: []
provides:
  - docs/models/statbotics-breakdown-reference.md (verbatim Statbotics EPA source)
  - docs/models/epa-statbotics-gap.md (per-season gap matrix + register + stage sequence)
affects:
  - docs/models/epa-divergences.md (its section 6 heading is now known-wrong; stage 1 fixes it)
  - apps/web/src/components/methodology/epaComparisonContent.ts (carries a disproven claim; stage 1)
  - scripts/measureEpaDeviations.ts (same; stage 1)
tech-stack:
  added: []
  patterns:
    - "Generated-not-typed transcription: the reference doc is built by slicing exact line ranges out of the fetched bytes, so hand-transcription error is not a failure mode it has"
key-files:
  created:
    - docs/models/epa-statbotics-gap.md
  modified:
    - docs/models/statbotics-breakdown-reference.md
decisions:
  - "Section numbers 6-10 of the reference doc were held STABLE rather than renumbered, because scripts/measureEpaDeviations.ts cites 'section 8' and this task was forbidden from editing that file"
  - "Task 1 was NOT committed separately despite being a tracer: the plan's own verification gate requires `git show --stat HEAD` to list exactly two files, which a separate tracer commit would fail"
metrics:
  duration: ~50min
  completed: 2026-09-11
actuals:
  tokens: 24000
  tasks: 3
  commits: 1
---

# Quick Task 260911-i9f: Transcribe Statbotics EPA Source and Build the Gap Table

Statbotics' EPA source is now in this repo verbatim — 37 python fences, each proven
byte-identical to the fetched bytes by a checker — and the per-season gap between it and
SigmaScout's EPA is tabulated as 11 mechanisms x 9 corpus seasons with no blank cells.

**Commit:** `38ea33bd` — exactly two files, both under `docs/models/`.

## The two errors the previous task shipped, corrected

**1. "Statbotics rates one number per alliance" is FALSE.** `predict_match` computes
`np.array([self.epas[t].mean for t in teams]).sum(axis=0)` — a per-team 18-entry VECTOR over
`all_keys[year]`, summed component-wise across the alliance and addressed by key name through
`keys.index(...)`. Statbotics rates a vector per team, structurally the same shape SigmaScout
uses. What is true is narrower: `get_score_from_breakdown` READS only a subset of that vector,
and for most seasons that subset is the single entry `no_foul_points` — but **not all seasons**
(2018 reads 7 own + 3 opponent entries; 2023 reads 7).

**2. The secondhand-summary caveat is now scoped.** Provenance is split into block A (the
2026-09-11 verbatim transcription, covering 14 named sections) and block B (residual prose,
covering 5 named sections). Every section is assigned to exactly one.

## Load-bearing discovery not in the brief: the 18-slot pad

`src/tba/breakdown.py` lines 7-11 pad **every** year's key list to exactly 18 entries at import
time. This makes the vector's index order a closed fact rather than an inference, and it is
confirmed three independent ways: the pad itself, `pre_record_team`'s index reads (0=epa,
1/2/3=phases, 4/5/6=RP, 7=tiebreaker, i+8=comp_i), and `get_mean_components`'s 18-element array
in the same order.

Corollary worth knowing: `keys.index()` is a NAME lookup, so where a season's `comp_i` name
duplicates a standard name (2020 `comp_8`, 2022 `comp_5`, both spelled `endgame_points`) it
resolves to the standard slot, index 3 — never the comp slot.

## The season-aggregate list, CLOSED and COUNTED

The brief said "at least three". That was an undercount. The closed list is **7 read points
resolving to 21 distinct `Year` columns** (reference section 19).

### The 7 read points

| # | read point | file:line | feeds |
|---|---|---|---|
| 1 | `get_constants(year)` | `models/epa/init.py:16-21` | `num_teams`, `year_mean`, `year_sd` for `get_init_epa` |
| 2 | `year.get_mean_components()` | `models/epa/init.py:47` | the entire 18-entry cold-start mean vector |
| 3 | `self.year_obj.score_sd` | `models/epa/main.py:125` | the `norm_diff` denominator (win-probability scale) |
| 4 | `self.year_obj.get_foul_rate()` | `models/epa/main.py:128` | the `score * (1 + foul_rate)` multiplier |
| 5 | `year.comp_6_mean` | `models/epa/breakdown.py:167` | 2018-only `auto_scale_power` reference in `post_process_attrib` |
| 6 | `year.comp_7_mean` | `models/epa/breakdown.py:171` | 2018-only `switch_power` reference |
| 7 | `year.comp_8_mean` | `models/epa/breakdown.py:172` | 2018-only `scale_power` reference |

Read points 5-7 are the easiest in the model to miss: 2018-only, buried in an attribution
function, and the reason a 2018 reproduction needs an aggregate no other season needs.

### The 21 distinct `Year` columns

All declared in `db/models/year.py:20-40`. Reached via `get_constants`, `get_foul_rate()`
(`year.py:176-177`) and `get_mean_components()` (`year.py:179-203`):

| # | column | declared | # | column | declared |
|---|---|---|---|---|---|
| 1 | `score_mean` | `year.py:20` | 12 | `comp_0_mean` | `year.py:31` |
| 2 | `score_sd` | `year.py:21` | 13 | `comp_1_mean` | `year.py:32` |
| 3 | `foul_mean` | `year.py:22` | 14 | `comp_2_mean` | `year.py:33` |
| 4 | `no_foul_mean` | `year.py:23` | 15 | `comp_3_mean` | `year.py:34` |
| 5 | `auto_mean` | `year.py:24` | 16 | `comp_4_mean` | `year.py:35` |
| 6 | `teleop_mean` | `year.py:25` | 17 | `comp_5_mean` | `year.py:36` |
| 7 | `endgame_mean` | `year.py:26` | 18 | `comp_6_mean` | `year.py:37` |
| 8 | `rp_1_mean` | `year.py:27` | 19 | `comp_7_mean` | `year.py:38` |
| 9 | `rp_2_mean` | `year.py:28` | 20 | `comp_8_mean` | `year.py:39` |
| 10 | `rp_3_mean` | `year.py:29` | 21 | `comp_9_mean` | `year.py:40` |
| 11 | `tiebreaker_mean` | `year.py:30` | | | |

Excluded deliberately: `year.year` (a season number, knowable in advance, carries no future
information) and the `epa_*p` / `epa_*_acc` / `epa_*_mse` columns (`year.py:43-159`), which the
model writes and only `to_dict` reads.

## The verdict matrix — 11 mechanisms x 9 seasons, 99 cells, no blanks

| mechanism | 2016 | 2017 | 2018 | 2019 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| 1. Rated component vector | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 2. Score formula | GAP R1 | GAP R2 | GAP | MATCHES | MATCHES | GAP | MATCHES | MATCHES | MATCHES |
| 3. Prediction post-processing | MATCHES | MATCHES | GAP | MATCHES | MATCHES | GAP | MATCHES | GAP | MATCHES |
| 4. RP `unit_sigmoid` path | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB |
| 5. Foul model | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 6. Init and carryover | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 7. Elimination weighting | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES |
| 8. Win-probability scale | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB | DELIB |
| 9. Update rule | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES | MATCHES |
| 10. Attribution post-processing | MATCHES | MATCHES | GAP | MATCHES | MATCHES | MATCHES | MATCHES | GAP | MATCHES |
| 11. Cleaning layer | GAP R1 | GAP R2 | GAP | GAP | GAP | GAP | MATCHES | GAP | GAP |

*(`MATCHES` = `ALREADY MATCHES`, `DELIB` = `DELIBERATE DIFFERENCE`, abbreviated here only; the
doc itself spells all three labels in full.)*

**Tally, counted programmatically: 37 `ALREADY MATCHES`, 44 `GAP`, 18 `DELIBERATE DIFFERENCE`.**

Four findings behind the surprising cells:

- **Mechanism 9 matches completely.** `add_obs`, `percent_func` (the `2/3` branch) and the
  `margin_func`-degenerate error split are line-for-line equivalent to `twoStageEwma`,
  `epaPercentFunc` and `applyComponentUpdate`. `margin_func` returns 0 for every year except
  2002/2003, so `err` collapses to `my_err` exactly as SigmaScout computes it.
- **Mechanism 8's FORM matches exactly**; only its denominator's source differs. Checked
  algebraically rather than assumed: `1/(1+10^(k·nd))` with `k=-5/8` equals
  `1/(1+exp(-margin/scale))` with `scale = sd/(-EPA_K·ln10)`. Sign, base and coefficient agree.
- **Mechanism 2 matches on five seasons** because SigmaScout's attribution and EWMA are both
  linear and share one `percent`/`weight` per team, so the SUM of per-component EWMAs evolves
  exactly as one EWMA on the sum. Where Statbotics' branch is an identity read of index 0, the
  two compute the same functional. This holds only because `adjust` is pinned at 0 per team and
  Statbotics counts `adjustPoints` on the foul side — both sides target score minus fouls minus
  adjust.
- **Mechanism 11 matches on 2024** by algebra, not by coincidence: Statbotics' teleop expression
  expands to `2·speakerCount + 5·amplified`, which is exactly what TBA's
  `teleopSpeakerNotePoints` + `teleopSpeakerNoteAmplifiedPoints` sum to.

## The cannot-be-reproduced register — every entry carries a number

| id | what | collides with | exposure |
|---|---|---|---|
| **R1** | 2016 elim branch adds `rp_1_pred·20 + rp_2_pred·25` to the SCORE | L-02 | **2,223 official elim matches, 16.7% of 2016's 13,286** |
| **R2** | 2017 elim branch adds `rp_1_pred·100 + rp_2_pred·20` to the SCORE | L-02 | **2,741 official elim matches, 17.8% of 2017's 15,424** |
| **R3** | the 21 season aggregates | L-01 | **every match in every season — all 9 corpus seasons, 100%.** THE one documented difference |
| **R4** | 2018's `post_process_attrib` reads `comp_6/7/8_mean` | L-01 | **every 2018 match — 1 of 9 seasons.** Registered separately because it is the only place an aggregate feeds an ATTRIBUTION |

R1+R2 together: roughly 5,000 matches, about one in six across those two seasons. The document
lays out the three scoping options (accept / quals-only / revisit L-02, the last marked LOCKED
and not reopened) and states plainly that this is a developer decision, not a footnote.

### A new finding that changes what R1/R2 cost

SigmaScout **already rates the underlying quantity in points**, with no RP machinery:
`breakdown/2016.ts` rates `breach`/`capture`, `breakdown/2017.ts` rates `rotorBonus`/`kPaBonus`.
Statbotics REMOVES exactly those fields at clean time (`no_foul_points -= rp_1_points +
rp_2_points`) and re-adds an EXPECTED version in elims. The two estimate the same bonus points by
different routes.

One read-only corpus query (SQL recorded verbatim in the doc) confirmed those TBA fields are
nonzero only in elims and **exactly zero in every qualification match**: 2016 quals 0/11,550,
elims 2,322 and 1,173 of 2,351; 2017 quals 0/13,920, elims 890 and 420 of 3,119. That population
is matches-with-a-breakdown and must NOT be differenced against the exposure figures above.

This does not make R1/R2 reproducible — a smeared EWMA over mostly-zero observations is not
`unit_sigmoid` of a rated RP — but it means option A costs less than it looks like it costs.

### Ruled-OUT collisions (recorded so nobody re-checks them)

`unit_sigmoid` on rp_1/2/3 (writes only indices 4-6, contributes nothing to `total_change`); the
elim RP freeze (same indices); `get_init_epa`'s `inv_unit_sigmoid` pre-image (same indices);
**`rp_3_pred`, which is passed to `get_score_from_breakdown` and never referenced in its body in
any branch — a dead parameter**; `tiebreaker_points` (rated and published, read by no branch); and
most notably **`get_foul_rate()`'s effect on the predicted WINNER** — the multiplier is applied
AFTER `win_prob` and is the same scalar for both alliances, so fouls cannot change Statbotics'
predicted winner at all. SigmaScout's cross-attributed per-team `foulsCommitted` *does* move the
margin, which is why mechanism 5 is a real `GAP` and its placement half is the larger effect.

## The recommended stage sequence, and why it is ordered that way

1. **Correct the three surfaces carrying the disproven claim.** First because it costs nothing,
   changes no number, owes no republish, and one surface is live to users. Named turnkey:
   `apps/web/src/components/methodology/epaComparisonContent.ts` lines 105-106 (+ the revision
   note at 25-40); `scripts/measureEpaDeviations.ts` `deviationRegister()`'s `component-map`
   `reason`, lines 689-699; `docs/models/epa-divergences.md` section 6's "difference in KIND"
   heading. **Constraint:** `scripts/measureEpaDeviations.test.ts:642` asserts the `reason` still
   matches `/statbotics-breakdown-reference/` — a reword must keep that citation.
2. **Live-estimate the per-component season mean profile.** Second because every later stage's
   measurement is meaningless without it: reshaping the component set while the cold start is
   still a flat even split confounds "did adopting Statbotics' entries help?" with a seeding
   scheme that degrades as component count grows.
3. **Move the foul term after the win-probability computation.** Small, season-independent, and
   it changes the predicted WINNER — so isolate it before the per-season work.
4. **Adopt the per-season cleaning layer**, one quick task per season, 2024 first as a
   zero-change verification that proves the harness can detect agreement before it is asked to
   detect disagreement.
5. **Adopt entry sets and score formulas for the linear seasons** (2019, 2022, 2024, 2025, 2026).
6. **Implement the non-linear seasons**: 2023 first (no opponent coupling), then 2018 (depends on
   R4's aggregates existing).
7. **2016 and 2017 — BLOCKED on a developer decision.** The only stage that forces the
   developer's hand; no implementation should start before an option is picked.
8. **The 2026 `district == "isr"` exception** — last, and blocked on whether the corpus carries a
   district field.

**Republish debt is cumulative and already nonzero:** `epa@8.0.0+baseline` already owes one, so
every stage from 2 onward adds to it and the published methodology numbers stay stale until paid.
Stage 1 alone owes nothing.

## What could NOT be transcribed — absent from the eight files

Ten residual gaps are named in reference section 20 with the upstream file that would answer each.
The two that block work:

- **How the 21 `Year` aggregate columns are COMPUTED** — over which match population, at what
  point in the season. `db/models/year.py` declares and reads them; nothing in the fetched set
  writes them, and this task will not guess the writer's filename. **The single most valuable
  remaining fetch**, because L-01 forces a live estimate whose target is currently a plausible
  neighbour of Statbotics' quantity rather than the quantity itself.
- **`backend/src/models/template.py`** — the match loop, and therefore the predict-before-update
  sequencing. Nothing is blocked today (SigmaScout's harness enforces the ordering itself), but
  any claim that the two ORDERINGS match is unverified and must not be published until fetched.

The other eight: `TeamYear.norm_epa` and `TeamYear.district` (`db/models/team_year.py`); `r()`
(`utils/utils.py`) — affects the last digit of every published figure; `EPS` and `CURR_YEAR`
(`constants.py`); `AlliancePred`/`Attribution`/`MatchPred` (`models/types.py`); `BreakdownDict`
and `empty_breakdown` (`tba/types.py`); `Match.get_red/get_blue/get_breakdowns/elim`
(`db/models/match.py`) — in particular whether `get_red()` includes surrogates, which SigmaScout
excludes.

**Closed by this task:** the previous headline gap, `backend/src/tba/breakdown.py`, is now
reference section 17, and section 2's additive identity is verbatim at `tba_breakdown.py:878` —
both were recorded as unverifiable on 2026-09-10.

## Deviations from Plan

**1. [Rule 1 — Bug] Published tally in the gap doc was wrong**
- **Found during:** Task 2, before commit
- **Issue:** The matrix tally was hand-written as 40/41/18. A programmatic count of the table
  returned 37 `ALREADY MATCHES` / 44 `GAP` / 18 `DELIBERATE DIFFERENCE`.
- **Fix:** Corrected to the counted values and annotated "counted from the table above, not by
  hand". A wrong published count in a document whose whole purpose is ending unverified claims is
  exactly the failure mode it exists to prevent.
- **Files:** `docs/models/epa-statbotics-gap.md`

**2. [Plan-contract] Task 1 not committed separately despite being `type="tracer"`**
- The generic per-task commit protocol wants one commit per task. The plan's task 3 specifies a
  single commit of both docs, and its verification gate requires `git show --stat HEAD` to list
  exactly two files. A separate tracer commit would have failed that gate. The plan's explicit,
  checkable contract took precedence. The tracer feedback gate itself was honoured: the verbatim
  checker was run and passed before any expansion work began.

**3. [Plan superseded by orchestrator] Reference section 2 transcribed verbatim, not retagged**
- The plan instructed retagging section 2's fence as ```text and recording it as unconfirmed,
  because `tba/breakdown.py` was missing when the plan was written. The orchestrator supplied that
  file before execution. Section 2 is now verbatim at `tba_breakdown.py:878` and the residual-gap
  entry records the closure instead.

**4. [Scope] Section numbers 6-10 held stable rather than renumbered**
- `scripts/measureEpaDeviations.ts:696` and `:1170` cite "section 8" of the reference doc, and
  prohibition 1 forbids editing that file. Renumbering would have silently broken two live
  citations. New material was appended as sections 11-20 instead.

## Verification

| gate | result |
|---|---|
| `verify-verbatim.cjs` | `python fences: 37 \| non-verbatim: 0 \| missing symbols: none` |
| `verify-gap.cjs` | `verdict rows: 78 \| seasons absent: none \| malformed verdict cells: 0 \| 2016+2017 elim exposure present: true` |
| matrix shape | 99 cells, no blanks, every label one of the three legal values (checked programmatically) |
| `git show --stat HEAD` | exactly 2 files, both `docs/models/*.md`; no `packages/`, `apps/`, `scripts/`, `pipeline/`, `experiments/`, `data/` or `reports/` path |
| `git status --short` | both docs gone from the list; `package.json` and three foreign untracked files from a concurrent session still present and untouched |

No network call was made. No `.env` was read. No version string changed. No test file changed. No
retune, no republish, no BPR/SPR contact.

## Self-Check: PASSED

- `docs/models/statbotics-breakdown-reference.md` — FOUND (2,330 lines)
- `docs/models/epa-statbotics-gap.md` — FOUND (688 lines)
- Commit `38ea33bd` — FOUND
