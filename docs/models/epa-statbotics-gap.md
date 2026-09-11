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
| 5. Foul model | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE |
| 6. Init and carryover | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP | GAP |
| 7. Elimination weighting | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES |
| 8. Win-probability scale | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE | DELIBERATE DIFFERENCE |
| 9. Update rule | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES |
| 10. Attribution post-processing | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | ALREADY MATCHES | GAP | ALREADY MATCHES |
| 11. Cleaning layer | GAP (see register R1) | GAP (see register R2) | GAP | GAP | GAP | GAP | ALREADY MATCHES | GAP | GAP |

**Tally:** 37 `ALREADY MATCHES`, 35 `GAP`, 27 `DELIBERATE DIFFERENCE` (counted from the table
above, not by hand). The three
`DELIBERATE DIFFERENCE` rows are mechanisms 4 (L-02), 5 (L-01, as of quick task 260911-l2k) and
8 (L-01); every other locked-decision collision is a remainder inside a `GAP` cell and is
registered below.

**Mechanism 5 moved from `GAP` to `DELIBERATE DIFFERENCE` on 2026-09-11 (quick task 260911-l2k),
and the direction of that move is worth stating because it is not a defeat.** The PLACEMENT half —
the winner-changing half — was closed outright: the foul term is out of the margin and is applied
after the win probability as one scalar shared by both alliances. What remains is the RATE, which
is an L-01 season aggregate now ADOPTED from week 2 on and live-estimated during week 1 only. That
is precisely mechanism 8's situation after quick task 260911-j2w, and it takes mechanism 8's label
rather than a fourth one being invented for it. The remainder is registered as R3 item 3.

---

## Mechanism 1 — the rated component vector

**Statbotics** rates an 18-entry per-team vector indexed by `all_keys[year]`, padded to exactly 18
slots at import time, and sums it component-wise across the alliance (reference sections 1 and 3).
**SigmaScout** rates a per-team record keyed by `OWN_FIELD_COMPONENT_MAP` plus `foulsCommitted`,
and sums it across `ratingEligibleTeams` (`epa.ts:sumComponentsAcrossTeam`, `epa.ts:predictCore`).

**Both sides rate a vector per team.** This closes the question quick task 260911-gfe got wrong.

**RE-DERIVED 2026-09-11 (quick task 260911-pon). The framing below replaces "which entries and how
many — a difference of DEGREE."** That framing is not false, but it is not the finding, and by
reading as a data-entry problem it hides the structural reason this gap is not data entry. The
finding, in three facts checked against both sides:

1. **Statbotics' RATED vector and the subset its SCORE READS are different objects.**
   `get_score_from_breakdown` reads a per-season subset of the 18 slots, and in seven of the nine
   corpus seasons that subset is a single entry (reference section 18). The other seventeen slots
   are still rated, still updated every match, and still published through the API — they simply
   never reach the predicted score in that season.
2. **The rated vector DOUBLE-COUNTS by construction, so it is not an additive partition and never
   was.** Reference section 2's shared cleaner enforces
   `no_foul_points == auto_points + teleop_points + endgame_points`, and `comp_0..comp_9` are
   sub-elements *within* those same phases — the vector carries a total beside its own parts. This
   is the same fact `scripts/measureEpaDeviations.ts`'s `component-map` deviation-register entry
   already records under `reason`, and **the two must not be allowed to drift apart**: if one is
   edited, the other is edited in the same change.
3. **In SigmaScout the rated set IS the score-read set.** `epa.ts:predictCore`'s
   `redOffensiveTotal` / `blueOffensiveTotal` reducers sum EVERY rated component except the
   alliance's own `FOULS_COMMITTED_COMPONENT` into the offensive total. There is no channel at all
   for a component that is rated but not scored.

**So mechanism 1 is TWO separable sub-gaps, and they must never again be conflated:**

- **1a — the SCORE-READ set.** What `get_score_from_breakdown` actually reads for that season.
  **Buildable TODAY**, with no interface change, through the existing `componentMapArm` seam
  (commit `b62c3655`; `scripts/measureEpaDeviations.ts:componentMapArm`), for every season whose
  score read is a linear sum of that alliance's own entries. A season-specific component map is
  handed to `epa.update` for the match's own season and to `epa.carrySeason` for the INCOMING
  season, and the shipped map is never touched.
- **1b — the FULL RATED vector**, including every entry the score never reads. Those entries are
  display, API and ranking-point quantities upstream. **SigmaScout has no rated-but-not-scored
  channel**, per fact 3 above, so 1b is not reachable without building one. That is a structural
  change to what a rated component means in this project; it is not designed here, and no amount of
  per-season map work reaches it.

The per-season table below therefore carries a **score-read column** (sourced from reference
section 18) beside the rated-entry column, so the next agent can see at a glance which seasons are
1a-cheap and which are not. Section 18's three "must not miss" observations — 2018's double
`zero_sigmoid`, `post_process_breakdown` writing back into index 0 before the read, and its
per-alliance in-place mutation — are carried BY REFERENCE and are deliberately not re-quoted here.

| season | Statbotics RATED entries (1b) | entries the SCORE READS (1a, ref. 18) | SigmaScout rated components | what closing 1a requires | verdict |
|---|---|---|---|---|---|
| 2016 | 17 named + 1 `"empty"` pad | **1 own**: `no_foul_points`; plus `rp_1`/`rp_2` in ELIMS only (registers R1/R2, decision D-2) | 10: `autoReach`, `autoCrossing`, `autoBoulder`, `teleopCrossing`, `teleopBoulder`, `teleopChallenge`, `teleopScale`, `breach`, `capture`, `adjust`, plus `foulsCommitted` | collapse to one rated no-foul total; drop `breach`/`capture` per mechanism 11; carry the elim bonus terms per D-2 | GAP |
| 2017 | 18 named | **1 own**: `no_foul_points`; plus `rp_1`/`rp_2` in ELIMS only (R1/R2, D-2) | 9 offensive plus `foulsCommitted` | collapse to one rated no-foul total; drop `rotorBonus`/`kPaBonus` per mechanism 11; carry the elim bonus terms per D-2 | GAP |
| 2018 | 18 named | **7 own + 3 OPPONENT**, with the double-`zero_sigmoid` asymmetry | 8: seven ownership/vault/endgame plus `foulsCommitted` | not a re-grouping at all: opponent coupling, two sigmoid layers, `min()` caps, and `post_clean_breakdown`'s four `*_power` ratios | GAP |
| 2019 | 18 named | **1 own**: `no_foul_points` | 5: `sandstormBonus`, `hatchPanel`, `cargo`, `habClimb`, `foulsCommitted` | collapse to one rated no-foul total (1a); the eight per-location piece counts are 1b only | GAP |
| 2022 | 14 named + 4 pad | **1 own**: `no_foul_points` | 5: `autoTaxi`, `autoCargo`, `teleopCargo`, `endgame`, `foulsCommitted` | collapse to one rated no-foul total (1a); the lower/upper cargo splits are 1b only | GAP |
| 2023 | 18 named | **7 own**, with `min(9, links)` and `min(30, endgame_charge_station_points)` | 8 | the 9-piece cascade, the cube/cone regrade and two caps — a component sum cannot express it | GAP |
| 2024 | 18 named | **1 own**: `no_foul_points` | 5: `auto`, `teleop`, `endgame`, `adjust`, `foulsCommitted` | collapse to one rated no-foul total — **BUILT AND MEASURED as an arm by quick task 260911-pon; see the tracer result below** — while the ten `comp_*` entries stay 1b only | GAP |
| 2025 | 18 named | **1 own**: `no_foul_points` via the `else` fallback — but index 0 has already been moved by an OPPONENT-COUPLED processor-algae correction (ref. 18, observation 2) | 6: `autoMobility`, `autoCoral`, `teleopCoral`, `algae`, `endGameBarge`, `foulsCommitted` | collapse to one rated no-foul total, then the coupled correction (mechanism 3); the coral-level counts and the processor/net split are 1b only | GAP |
| 2026 | 15 named + 3 pad | **1 own**: `no_foul_points` via the `else` fallback | 10: `autoTower`, `endGameTower`, `hubAuto`, `hubTransition`, `hubShift1`..`hubShift4`, `hubEndgame`, `foulsCommitted` | collapse to one rated no-foul total (1a). For 1b SigmaScout is FINER: it rates shifts 1-4 separately where Statbotics pairs them into `first_shift_fuel`/`second_shift_fuel` | GAP |

**Statbotics rates NO per-team foul entry at all, and SigmaScout still does — recorded here rather
than left as a silent omission (quick task 260911-l2k, D-1).** Every row above ends "plus
`foulsCommitted`", and that trailing component has no counterpart anywhere in `all_keys[year]`:
upstream handles fouls exclusively through the season-level `get_foul_rate()` scalar (mechanism 5).
l2k moved WHERE that component enters a prediction — it no longer enters one at all — but
deliberately kept it rated, published and carried, because deleting it would reach identical
predicted numbers while disturbing a user-facing metric, `UNGROUPED_COMPONENTS`, every carried
rating, and `fallbackObserved`'s netting. So this remains a mechanism-1 entry-set difference in all
nine seasons, and it is NOT closed by mechanism 5's closure. It is a **1b** difference specifically:
nothing either side's SCORE reads depends on it.

**NO TRANSCRIPTION AND NO FETCH IS OWED AT THIS MECHANISM.** Reference section 17 carries all
eleven `clean_breakdown_{year}` functions verbatim, 2016 through 2026, plus `post_clean_breakdown`,
and that file's Provenance block A proves each is a byte-identical substring of a fetched source.
Quick task 260911-pon re-checked every one of them mechanically against the on-disk
`tba_breakdown.py`: eleven of eleven, plus `post_clean_breakdown`, came back verbatim. Any text
elsewhere implying mechanism 1 still waits on a fetch or a transcription is stale.

**A caution that survives from `epa-divergences.md` section 6 and must not be lost:** the accuracy
curve TURNS OVER with component count. On 2024, eleven components scored 0.7348, three scored
0.7520, one scored 0.7403. Adopting Statbotics' entry set is a FIDELITY move, not an accuracy move,
and on at least one season it is measurably an accuracy LOSS. That is the developer's stated
trade and it is recorded here so nobody re-litigates it as a bug.

### The two decisions quick task 260911-pon made about closing mechanism 1

**Decision 1 — the tracer season is 2024, and only 2024.** Three reasons, recorded so the choice is
auditable rather than arbitrary:

- Mechanisms 2 and 11 both read `ALREADY MATCHES` for 2024, so a 2024 arm isolates mechanism 1 with
  nothing else moving. On the other one-entry seasons at least one neighbouring mechanism is still
  `GAP`, and the measurement would be confounded by it.
- 2024's score read is a single own entry, so sub-gap 1a is expressible in today's interface with
  no new machinery.
- Its cost is already approximately known, which makes the arm a CHECK on a prior number rather
  than a leap into one.

**The cost figure to carry forward is about 1.2 points of winner accuracy, NOT 1.7.** Reference
section 10 measured 2024's single no-foul total at **0.7403** against the shipped phase-group map's
**0.7520** — about 1.2 percentage points. The 1.7-point figure that also circulates in this
project's notes is the gap between the RETIRED eleven-component map (0.7348) and the shipped phase
groups (0.7520); that is a granularity measurement of **this project's own maps** and is not what
adopting Statbotics' score read costs. Conflating the two overstates the price by roughly half.

**Decision 2 — the tracer lands as a measured ARM, never as the shipped default.** Three reasons:

- Mechanism 1 is only coherent when all nine seasons are done. One season adopted alone leaves the
  model inconsistent across seasons — 2024 predicting off one rated total while its neighbours
  predict off phase groups — which is worse than a uniform, documented gap.
- A faithful 2024 map collapses to two components, which would disturb `groups.ts`'s published
  phase metrics and `UNGROUPED_COMPONENTS` for a fidelity move that is not yet complete.
- Shipping it would incur republish debt on top of the debt already owed for `epa@9.0.0+baseline`
  and `epa@10.0.0+baseline`. Nothing published changes while it is an arm.

Accordingly `SEASON_COMPONENT_MAPS` in `packages/core/algorithms/breakdown/index.ts` is unchanged,
`packages/core/algorithms/breakdown/2024.ts` is unchanged, `ARM_IDS` in
`scripts/measureEpaDeviations.ts` is unchanged, and `epa.version` is unchanged. The faithful map
lives at `scripts/statboticsComponentMaps.ts`, outside `packages/`, so it cannot be mistaken for a
shipped default.

### The eight non-tracer seasons are DEFERRED, keyed to this document's own stages

No partial season map is left half-built anywhere. Each group below is sized as its own quick task
and is keyed to the stage sequence this document already has — a second, parallel grouping is
deliberately not invented.

- **2019, 2022, 2025, 2026 — stage 5's remaining linear seasons.** One quick task each, the same
  shape as the 2024 tracer: collapse to one rated no-foul total behind `componentMapArm`, measure,
  report as found. 2025 carries the opponent-coupled processor-algae correction on top
  (mechanism 3), so it goes last of the four.
- **2023 — stage 6, first.** Seven entries, the 9-piece cascade, the cube/cone regrade, two `min()`
  caps. No opponent coupling, which is what makes it strictly simpler than 2018.
- **2018 — stage 6, last.** `zero_sigmoid`, the double-sigmoid asymmetry, opponent coupling,
  `post_clean_breakdown`'s four `*_power` ratios, and a hard dependency on register R4's three
  2018-only season aggregates.
- **2016, 2017 — stage 7. NO LONGER BLOCKED as of decision D-2 (2026-09-11).** The developer's
  ruling is *"for 2016/2017 RP do whatever Statbotics does"*: `rp_1` and `rp_2` are two ordinary
  slots of the same rated vector, and in ELIMINATION matches of 2016 and 2017 only, the score
  formula adds them back at their playoff bonus-point values (`rp_1 * 20 + rp_2 * 25` in 2016,
  `rp_1 * 100 + rp_2 * 20` in 2017 — reference section 15). Registers R1 and R2 record what that
  does and does not license; in particular those terms are INTERNAL score arithmetic and **L-02
  stands unchanged** — EPA publishes no ranking-point number, anywhere, in any season.

**This task closes NOTHING in the verdict matrix.** Mechanism 1's nine cells still read `GAP` in
every season and the tally beneath the matrix is untouched. What changed is what closing mechanism 1
*means*: 1a is now a named, buildable, per-season job with one season proven, and 1b is a named
structural gap with no channel to build it through.

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
| 2016 | reads index 0; **in ELIMS adds `rp_1_pred * 20 + rp_2_pred * 25`** (ref. 15) | sums components, identically in quals and elims (`epa.ts:predictCore`) | quals: nothing. Elims: **UNBLOCKED by D-2** — carry `rp_1 * 20 + rp_2 * 25` as an internal score term (register R1) | GAP (see register R1) |
| 2017 | reads index 0; **in ELIMS adds `rp_1_pred * 100 + rp_2_pred * 20`** (ref. 15) | same | quals: nothing. Elims: **UNBLOCKED by D-2** — carry `rp_1 * 100 + rp_2 * 20` as an internal score term (register R2) | GAP (see register R2) |
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

## Mechanism 5 — the foul model — PLACEMENT CLOSED, RATE ADOPTED FROM WEEK 2 (L-01 remainder)

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

**CLOSED 2026-09-11 by quick task 260911-l2k (`epa@10.0.0+baseline`). SigmaScout now does the
same thing.** `epa.ts:predictCore` computes the margin, the logistic scale and `pRedWin` from the
two NO-FOUL totals with no foul term anywhere, and only afterwards multiplies BOTH published
scores by one shared `(1 + foulRate)`. A test pins the defining property bitwise: changing either
alliance's `foulsCommitted` mean by any amount — including by a factor of a hundred thousand —
leaves `pRedWin` unchanged.

The rate is `foulMean / noFoulMean` over Statbotics' week-1 population, frozen by the same seal
`epaWeekOne.ts` already owned for `score_sd`, and live-estimated from a season-wide expanding pair
before that seal. No second freeze mechanism was invented.

**What SigmaScout USED TO DO, kept here because the matrix row above changed and a reader needs to
know what it changed FROM.** `foulsCommitted` is a per-team rated component derived from the
OPPONENT's raw `foulPoints` (D-04; every `breakdown/{year}.ts` sets
`result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints`), and `predictCore` used to add the
opposing alliance's `foulsCommitted` mean to this alliance's predicted score BEFORE taking the
margin. Red's and blue's foul means are different numbers, so fouls moved SigmaScout's margin and
therefore its predicted winner — the inverse of what Statbotics does. That is what `10.0.0`
retired.

**`foulsCommitted` itself survives unchanged (D-1 of the l2k plan), and the scope decision is
recorded rather than left implicit.** It is still rated per team, still published as its own
`teamMetrics` entry, still `carrySeason`'s fouls-INCLUSIVE carryover input, and still the quantity
`fallbackObserved` nets out of an imputed observation. Only its place in a PREDICTION moved.
Deleting the component would have reached the same predicted numbers — `redOffensiveTotal` already
excluded an alliance's own `foulsCommitted`, so it already WAS the no-foul total — while
disturbing four things that had no reason to move, including a published user-facing metric and
every carried rating. The smaller change was taken.

| season | what Statbotics does | what SigmaScout does today | what closing the gap requires | verdict |
|---|---|---|---|---|
| 2016 | season scalar `get_foul_rate()`, applied after `win_prob` | **PLACEMENT ADOPTED:** scalar applied after `win_prob`, identical to both sides. **RATE ADOPTED from week 2 on:** frozen week-1 `foulMean / noFoulMean`; live season-wide estimate during week 1 | nothing on placement. The week-1 live estimate is L-01 and cannot be closed (register R3 item 3) | DELIBERATE DIFFERENCE |
| 2017 | same | same | same | DELIBERATE DIFFERENCE |
| 2018 | same | same | same | DELIBERATE DIFFERENCE |
| 2019 | same | same | same | DELIBERATE DIFFERENCE |
| 2022 | same | same | same | DELIBERATE DIFFERENCE |
| 2023 | same | same | same | DELIBERATE DIFFERENCE |
| 2024 | same | same | same | DELIBERATE DIFFERENCE |
| 2025 | same | same | same | DELIBERATE DIFFERENCE |
| 2026 | same | same | same | DELIBERATE DIFFERENCE |

The mechanism is season-independent, which is why every row is identical; it is tabulated per
season anyway so the matrix has no special cases.

**Note on what is and is not blocked — UPDATED 2026-09-11 (quick task 260911-l2k).** The
PLACEMENT (after `win_prob`, same scalar both sides) was freely reproducible and is now CLOSED.
The RATE (`foul_mean / no_foul_mean`) is a week-1 aggregate, so it is adopted exactly from week 2
onward and live-estimated during week 1 alone — the same narrowing `avg.py` permitted for
`score_sd`. Only the week-1 window remains an L-01 difference; see register R3 item 3.

The placement half was, as predicted here, the larger of the two effects: it changes the predicted
WINNER, where the rate only scales a published score. The measured before/after cost of that
change is recorded in
`.planning/quick/260911-l2k-adopt-statbotics-foul-model-scalar-after/260911-l2k-SUMMARY.md` and
was adopted for FIDELITY, not accuracy.

**A KNOWN AND ACCEPTED CONSEQUENCE: exactly-tied margins became common, and every one of them is
called RED.** Measured over the nine corpus seasons at `epa@10.0.0+baseline`: **2,667 of 148,094
matches (1.8%) now predict an exactly-zero margin**, up from a rate low enough never to have
mattered before. Per season the exact-zero count runs 246 (2022) to 331 (2025 and 2026).

The cause is this mechanism's own closure and is not a defect. The retired cross-attribution added
the OPPONENT's `foulsCommitted` mean to each alliance's score, and those two means are different
numbers, so it separated two otherwise identically-rated alliances on essentially every match.
With it gone, two alliances carrying equal ratings — the common case early in a season, when every
team still sits at the same cold-start value — produce two equal no-foul totals and a margin of
exactly 0. `epa.ts:predictCore` resolves `pRedWin >= 0.5` to `"red"`, matching `opr.ts`'s tie
convention, so all 2,667 are predicted red.

**SEEN AND ACCEPTED by the developer on 2026-09-11, not missed, and deliberately NOT acted on.**
Calling red on a true coin flip costs nothing in expectation, and Statbotics has the same property,
so matching it is arguably the correct behaviour rather than a wart to paper over. The tie
convention is unchanged and this was not investigated further. It is recorded here so a future
reader who notices a red-heavy tail on tied matches finds the explanation instead of re-opening it.

One downstream note, because it is where this DID have a visible effect: it walked
`scripts/measureEpaDeviations.ts`'s pre-registered winner-accuracy invariant onto a floating-point
knife-edge on a single 2016 match. That guard was amended in place, with approval, on the same
date — see its own comment.

**NAMED RESIDUAL, recorded rather than hidden (l2k D-2).** The no-foul/foul split this project
folds is taken from the SCORE — `foul side = own raw foulPoints + own adjustPoints`,
`no-foul = score - foul side` — which is reference section 2's shared cleaner VERBATIM. But the
module that writes `Match.red_foul` / `Match.red_no_foul`, the columns `avg.py` actually averages,
was never fetched. That those columns are written from this same cleaner (and therefore that
upstream's `red_foul` includes `adjustPoints`) is an INFERENCE from section 2, not a
transcription. If it is wrong, this project's foul rate counts `adjustPoints` where upstream does
not — a small effect, since `adjust` is zero in the overwhelming majority of matches, but a real
one. Closing it needs a fetch of that module.

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

## Mechanism 8 — the win-probability scale — SD ADOPTED FROM WEEK 2, DELIBERATE DIFFERENCE (L-01 remainder)

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

**BODY CORRECTED 2026-09-11 (quick task 260911-pon).** Everything from here down replaces prose
that went stale when `epa@9.0.0+baseline` shipped. Register R3 item 1 was updated at the time;
this mechanism's own body was not, so it kept asserting three things that are no longer true —
that `score_sd` is a season-final constant, that SigmaScout's denominator is an expanding-window
Welford SD in the general case, and that adopting upstream's constant would leak season-end
variance into a Week 1 prediction. Each of those is retracted below and replaced, not softened.

**What Statbotics' denominator actually is.** `self.year_obj.score_sd` — read point 3 of reference
section 19, `models/epa/main.py:125` — is **a WEEK-1 aggregate**. `backend/src/data/avg.py`'s
`process_year` filters to `week_one_matches` and derives every `Year` column from that list alone
(reference section 20; see also the correction block at the top of this file). It is the SD of
week-1 ALLIANCE SCORES with fouls INCLUDED — the raw score, not the no-foul total — which is
exactly the quantity `epa.ts:update` already folds, so it is an EXACT target rather than a named
neighbour.

**What SigmaScout's denominator actually is, in two branches.** Since `epa@9.0.0+baseline` (quick
task 260911-j2w) `predictCore` reads `state.weekOne.frozen.sd`, the FROZEN week-1 alliance-score
SD, for every match from week 2 onward. It falls back to the live expanding-window Welford SD —
`standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD)`, with
`EPA_FALLBACK_SCORE_SD = 25` before two observations exist — only while week 1 is still running, or
after a seal that found too little usable data to freeze anything. The freeze fires on the first
match carrying a numeric week greater than corpus week 0, which in a chronological stream proves
every week-1 match has already been played (`epaWeekOne.ts:sealWeekOneIfPast`). **So the expanding
estimate is the WEEK-1 branch, not the general case.**

**The correct walk-forward argument, which is one week wide rather than one season wide.** A week-1
aggregate is knowable the moment week 1 ends, so reading it from week 2 onward is not a
walk-forward violation at all — which is precisely why it was adopted rather than refused. The
violation is confined to **week 1 itself**, where scoring a week-1 match against a week-1 aggregate
would read matches not yet played. The old claim that adopting upstream's constant "would leak
season-end variance into a Week 1 prediction" is wrong twice over: there is no season-end variance
in the constant, and the leak it names is confined to one week.

**VERDICT RE-DERIVED, NOT ASSUMED — and it does NOT change.** The rule applied is the one quick
task 260911-l2k applied to mechanism 5, and mechanism 5 is named here as the precedent because two
mechanisms in identical states must not carry different labels. That rule: a quantity ADOPTED
exactly from week 2 onward and LIVE-ESTIMATED during week 1 alone remains
`DELIBERATE DIFFERENCE`, because the week-1 window is an L-01 remainder that no implementation work
can close. Mechanism 5's body already states the correspondence from the other direction — *"That
is precisely mechanism 8's situation after quick task 260911-j2w, and it takes mechanism 8's label
rather than a fourth one being invented for it"* — so re-deriving mechanism 8 under mechanism 5's
rule returns mechanism 8's existing label.

**The two residuals that keep the label.** Neither is closable by writing code, and the second was
checked against `epaWeekOne.ts` and `epa.ts:update` rather than asserted:

1. **The week-1 window** — register R3 item 1. During week 1 SigmaScout live-estimates where
   Statbotics reads a completed week-1 constant. There is also a stated ONE-MATCH LAG at the
   boundary: the seal happens inside `update`, so the first week-2 match of a season is PREDICTED
   off the live estimate before its own fold seals the constant (`epaWeekOne.ts` header).
2. **The POPULATION the frozen SD covers** — register R3 residual gap 4. Statbotics filters an
   offline `week_one_matches` list. SigmaScout seals a streaming accumulator that folds
   `result.redScore` and `result.blueScore` — raw alliance scores, fouls included — for every
   corpus-week-0 match, and it applies three exclusions upstream's list does not: an alliance ruled
   zero is skipped (`epa.ts:update`, `if (!redIsRulingZero)` / `if (!blueIsRulingZero)`), a
   `null`-week match is never folded and never seals (`epaWeekOne.ts`'s null-week policy), and once
   sealed the accumulator ignores a late week-0 arrival rather than reopening. So the frozen SD can
   cover slightly fewer alliance scores than upstream's. All three are deliberate costs of being
   walk-forward rather than offline.

`DELIBERATE DIFFERENCE` in all nine seasons — **unchanged by this re-derivation**, so mechanism 8's
row in the verdict matrix and the tally beneath it are both untouched by quick task 260911-pon. See
register R3.

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

**R1 and R2 LEFT this register on 2026-09-11 (decision D-2) and are kept below with their
supersession marked, rather than deleted, because the exposure figures and the qual/elim evidence
in them are still the reference for stage 7's implementation.** R3 and R4 remain open.

### R1 — 2016 elimination matches fold RP predictions into the SCORE

**Mechanism:** `get_score_from_breakdown`'s 2016 branch (reference section 15) adds
`rp_1_pred * 20 + rp_2_pred * 25` to the predicted score, in ELIMINATION matches only.
`rp_1_pred` and `rp_2_pred` are the unit-sigmoided RP entries from the rated vector.

**Collides with:** ~~L-02. Those entries do not exist in SigmaScout, so the terms cannot be
formed.~~ **SUPERSEDED 2026-09-11 by decision D-2** — see "R1 + R2" below. Upstream forms both
terms out of two ordinary slots of the rated vector, and SigmaScout is to do the same, as INTERNAL
score arithmetic that publishes nothing. R1 and R2 are now implementation work (stage 7), not
permanent divergences, and L-02 is unchanged because it governs published output rather than this
term.

**Exposure: 2,223 official elimination matches in 2016 — 16.7% of that season's 13,286.**

**Why no workaround exists *by Statbotics' method*:** the terms are expectations over a predicted
ranking-point probability. There is no way to produce that number without predicting a ranking
point, which L-02 forbids in any form.

### R2 — 2017 elimination matches fold RP predictions into the SCORE

**Mechanism:** the 2017 branch adds `rp_1_pred * 100 + rp_2_pred * 20` in elimination matches.

**Collides with:** ~~L-02, identically to R1.~~ **SUPERSEDED 2026-09-11 by decision D-2,
identically to R1.**

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
that option C is not the only way to have any signal at all in those matches.

**DECIDED 2026-09-11 — decision D-2, recorded by quick task 260911-pon. The paragraph above ended
"this is a developer decision and this task does not make it"; the decision has since been made and
the option set above is settled.** The developer's ruling, verbatim: *"for 2016/2017 RP do whatever
Statbotics does."* None of options A, B or C is taken as written. What is taken is upstream's own
construction: `rp_1` and `rp_2` are two ordinary slots of the same rated vector
(`models_epa_main.py:104-110`), and in ELIMINATION matches of 2016 and 2017 only the score formula
adds them back at their playoff bonus-point values (`models_epa_breakdown.py:94-115`, reference
section 15). R1 and R2 therefore become ordinary implementation work rather than permanent
divergences, and stage 7 below is unblocked accordingly.

**This does NOT reopen L-02, and the two must not be collapsed into each other.** L-02 governs
OUTPUT — no published bonus-RP probability, no RP pmf into the rank simulation, no RP predictor
anywhere on the site — and it stands unchanged in every season. D-2 governs an INTERNAL term of two
seasons' score arithmetic, for achievements that were worth real points on the playoff scoreboard.
The terms stay inside `predictCore` and reach no artifact, no API surface and no page. Option C
("revisit L-02") remains NOT taken.

### R3 — the 21 season aggregates (L-01) — THE one documented difference

**NARROWED TWICE on 2026-09-11.** First by quick task 260911-j2w (`epa@9.0.0+baseline`): items 1
and 2 ADOPTED for weeks 2 onward. Then by quick task 260911-l2k (`epa@10.0.0+baseline`): item 3
ADOPTED on the same terms, and residual gap 1 below CLOSED. **Items 4 and 5 are UNTOUCHED and
remain fully open** — this register entry is partly closed, not closed. They are WEEK-1 aggregates, not season-final ones (reference
section 20, `avg.py` verbatim), and a week-1 aggregate is knowable the moment week 1 ends. So
reading it from week 2 onward is not a walk-forward violation at all. `epaWeekOne.ts` freezes the
week-1 aggregate on the first match carrying a numeric week greater than 0 — which in a
chronological stream PROVES every week-1 match has already been played — and `epa.ts` reads the
frozen SD as `predict`'s denominator and the frozen mean as `carryRescaleRatio`'s numerator from
that point on. During week 1 itself both read exactly what `8.0.0` read. Items 3, 4 and 5 are
UNCHANGED and still live-estimated or absent. The text below is written against the pre-j2w state
except where a row says otherwise.

**THREE NAMED RESIDUAL GAPS inside the narrowing, recorded so they are known open items rather
than undocumented divergences:**

1. **CLOSED 2026-09-11 by quick task 260911-l2k. The MEAN target is now EXACT.** This gap said
   closing it "needs a second, no-foul week-1 accumulator, which j2w deliberately did NOT build";
   l2k built exactly that accumulator (it is the same one the foul rate's denominator needs), and
   `carryRescaleRatioFor`'s numerator now reads the frozen week-1 NO-FOUL mean — the quantity
   `get_constants` reads — falling back to the frozen raw mean (`9.0.0`'s behaviour, and
   upstream's own `or year.score_mean` fallback) and then to the live unwind (`8.0.0`'s).

   **A SMALLER RESIDUAL REPLACES IT rather than the gap vanishing outright:** the two frozen means
   are taken over slightly different POPULATIONS. The raw-score accumulator folds every
   non-ruling-zero alliance; the no-foul one additionally requires a PARSED breakdown, because the
   fallback path imputes an alliance's components FROM these very means and folding an imputed
   value back in would be circular. Upstream derives both from one `week_one_matches` list. The
   difference is confined to breakdown-less matches, which are a small minority, but it is real.
2. **`avg.py`'s 2025 processor-algae correction is NOT adopted.** Upstream subtracts
   `3 * comp_6_mean` from `no_foul_mean`, `teleop_mean` and `comp_7_mean` at AGGREGATE time, a
   second site for the same adjustment beyond `post_process_breakdown`. SigmaScout applies neither
   the aggregate-time correction nor a 2025 branch of any kind (mechanism 3 / D-13).
3. **NEW 2026-09-11 (quick task 260911-l2k): `Match.red_foul`'s inclusion of `adjustPoints` is an
   INFERENCE, not a transcription.** `avg.py` averages the `Match.red_foul` / `Match.red_no_foul`
   columns, and reference section 2's shared cleaner defines
   `foul_points = foulPoints + adjustPoints`. That those columns are written BY that cleaner was
   never verified — the module that writes them has not been fetched. l2k's split follows section
   2 verbatim, so if the inference is wrong this project counts `adjustPoints` on the foul side
   where upstream does not. Small in practice (`adjust` is zero in the overwhelming majority of
   matches) but recorded so it is a known open item rather than an undocumented divergence.

4. **The frozen population can be slightly SMALLER than Statbotics' `week_one_matches`.** Statbotics
   filters an offline list; SigmaScout seals a streaming accumulator. Week-0 and week-1 event
   windows never overlap by start date in any corpus season, but a multi-day week-0 event can still
   run a match on the day a week-1 event opens, and any such late arrival is excluded by the seal.
   Reopening a frozen constant would make it not a constant, so this is a deliberate cost of being
   walk-forward rather than offline.

**Mechanism:** Statbotics reads 21 distinct season-level `Year` columns through 7 read points
(reference section 19). Every one is a WEEK-1 number (reference section 20; this line previously
said "season-final", which was the overstatement the 2026-09-11 correction block at the top of
this file retracts).

**Collides with:** L-01, for items 4 and 5, and for item 3's week-1 window alone. Items 1, 2 and
3 no longer collide from week 2 onward.

**Exposure: every match in every season — all nine corpus seasons, 100%.** This is the widest entry
in the register by far, and it is deliberately ONE entry rather than 21, per L-01.

**Why no workaround exists** — for the items still live-estimated: the quantity is not knowable at
the time of an early-season prediction, or SigmaScout computes no equivalent at all.

| # | Statbotics quantity | where it is read (ref. 19) | what SigmaScout does |
|---|---|---|---|
| 1 | `score_sd` in `norm_diff` | `main.py:125` | **ADOPTED from week 2 on (j2w):** the FROZEN week-1 alliance-score SD, an EXACT target. During week 1: expanding-window Welford SD over alliance scores replayed so far (`epa.ts:predictCore`), `EPA_FALLBACK_SCORE_SD = 25` before 2 observations |
| 2 | `score_sd`, `no_foul_mean`, `score_mean` in `get_constants` | `init.py:16-21` | **ADOPTED from week 2 on (j2w):** the FROZEN week-1 alliance-score MEAN as `carryRescaleRatio`'s numerator — a NAMED NEIGHBOUR of `no_foul_mean`, see residual gap 1 above. During week 1: `epaCarryScale.ts:cleanSeasonMean` plus the expanding stats, seeded across the boundary by `reseedFromPrior` with `EPA_SCORE_SD_SEED_COUNT` |
| 3 | `foul_mean` and `no_foul_mean` in `get_foul_rate()` | `main.py:128`, via `year.py:176-177` | **ADOPTED from week 2 on (l2k):** the FROZEN week-1 `foulMean / noFoulMean`, an EXACT target, applied as one `(1 + rate)` scalar to both published scores after the win probability. During week 1: a season-wide expanding no-foul/foul pair, reset (not reseeded) at each season boundary. `EPA_FALLBACK_FOUL_RATE = 0` when no usable population exists — this project REFUSES a degenerate divide where upstream substitutes `(self.no_foul_mean or 1)` |
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

### Stage 1 — Correct the three surfaces still carrying the disproven claim — DONE 2026-09-11

**DONE** by quick task 260911-j2w (commit `894cb923`). All three surfaces now say that both sides
rate a per-team vector and that what differs is which entries the predicted score READS.
`epaComparisonContent.test.ts` pins the retracted phrasings so they cannot return silently.
`EPA_DIFFERENCE_IDS` is byte-identical. No number changed and no republish was owed by this stage.

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

### Stage 3 — Move the foul term after the win-probability computation — DONE 2026-09-11

**DONE** by quick task 260911-l2k (`epa@10.0.0+baseline`). The foul term is out of the margin and
applied afterwards as one scalar shared by both alliances; `pRedWin` is pinned bitwise invariant to
any `foulsCommitted` value. The rate went further than this stage required — it is Statbotics' own
week-1 `foulMean / noFoulMean`, frozen at the existing seal and live-estimated only during week 1 —
which also closed R3's residual gap 1, because the no-foul accumulator that gap named is the same
one the rate's denominator needs. `STATE_SNAPSHOT_SHAPE_VERSION` is 14. A REPUBLISH IS OWED and is
unpaid, on top of `8.0.0`'s and `9.0.0`'s. The before/after measurement is in
`.planning/quick/260911-l2k-adopt-statbotics-foul-model-scalar-after/` and was reported as found.

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

### Stage 7 — 2016 and 2017 — UNBLOCKED 2026-09-11 (decision D-2), reproduce upstream exactly

**THE BLOCKER IS STRUCK.** This stage used to read `BLOCKED ON A DEVELOPER DECISION` and to say
*"no implementation work on 2016 or 2017 should start before the developer picks one"* of options
A, B or C. The developer decided on 2026-09-11, verbatim: *"for 2016/2017 RP do whatever Statbotics
does."* That sentence is the whole ruling and it resolves R1 and R2 together.

**What it requires, concretely** (`models_epa_breakdown.py:94-115`, reference section 15; and
`models_epa_main.py:104-110` for where the two values come from). `rp_1` and `rp_2` are **two
ordinary slots of the same 18-entry rated vector**, read straight off `post_process_breakdown`'s
output like any other slot — they are not a separate model and they need no separate machinery. In
**elimination matches of 2016 and 2017 only**, the score formula adds them back at their playoff
bonus-point values: `rp_1 * 20 + rp_2 * 25` in 2016, `rp_1 * 100 + rp_2 * 20` in 2017. In quals
those two seasons, and in every other season, those slots are multiplied by nothing and contribute
exactly zero to the score.

**L-02 IS UNCHANGED, and the distinction is stated here so a later session does not "fix" one into
the other.** L-02 governs OUTPUT: EPA must publish no bonus-RP probability, must feed the rank
simulation no RP pmf, and must appear nowhere on the site as an RP predictor. That stands in all
nine seasons including 2016 and 2017. D-2 governs an INTERNAL TERM of two seasons' score
arithmetic — in those seasons the achievements in question (2016 Defenses Breached / Tower
Captured, 2017 Rotor and kPa bonuses) were worth actual points on the playoff scoreboard, so
reproducing the score means carrying the term. It is a score component that happens to share a name
with a ranking point, not a ranking-point prediction. `rp_1`/`rp_2` stay internal to
`predictCore`'s score arithmetic and reach no artifact, no API surface and no page. **A reader who
believes D-2 licenses publishing an RP number has misread it.**

**Why it is still LAST in the sequence:** it is no longer gated, but it is still the most involved
of the linear seasons — both seasons also need their cleaning layer (mechanism 11 drops
`breach`/`capture` and `rotorBonus`/`kPaBonus` at clean time, which is precisely what makes
room for the elim add-back) and the 2017 rotor redistribution on top. Order, not permission, is what
keeps it here.

**Closes:** mechanisms 2 and 11 for 2016 and 2017, and registers R1 and R2 with them.
**Republish debt: YES.**

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

Reference section 20 lists ten residual gaps — facts absent from the fetched files. **ONE of them
still touches work above; the other was closed and is struck below** (quick task 260911-pon):

- ~~**Residual gap 1 — how the 21 `Year` aggregate columns are COMPUTED.**~~ **RETRACTED
  2026-09-11 (quick task 260911-pon): this bullet is stale and its claim is withdrawn.** It said
  the estimate "would be aimed at a plausible neighbour of Statbotics' quantity rather than at the
  quantity itself" and called this "the single most valuable remaining fetch". Both statements were
  true when written and are no longer: `backend/src/data/avg.py` HAS been fetched and is
  transcribed verbatim at reference section 20, it answers the question outright — every `Year`
  aggregate is computed from `week_one_matches` alone — and the correction block at the top of
  this document already records the consequence. Nothing here is blocked on that fetch. Residual
  gap 3 below is the only surviving fetch-shaped item in this section.
- **Residual gap 3 — `backend/src/models/template.py`**, which holds the match loop and therefore
  the predict-before-update sequencing. Nothing above is blocked on it today, because SigmaScout's
  own walk-forward harness already enforces that ordering, but any claim that the two ORDERINGS
  match is currently unverified and should not be published until it is fetched.

Neither is a reason to delay stages 1 through 3, and residual gap 1 is no longer a reason to
delay anything at all.
