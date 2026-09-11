---
task: "Add the EPA component-map seam and settle whether the component-map divergence is real"
quick_id: 260911-gfe
date: 2026-09-11
status: complete
subsystem: algorithms/epa + measurement/diagnostics + methodology page
tags: [epa, statbotics, component-map, seam, reference-recovery, provenance, port-fidelity]
requires:
  - packages/core/algorithms/epa.ts (update, carrySeason)
  - packages/core/algorithms/breakdown/index.ts (tryParseBreakdownPair)
  - scripts/measureEpaDeviations.ts (the stage-1 ablation harness)
provides:
  - an optional SeasonComponentMap parameter on epa.update / epa.carrySeason / tryParseBreakdownPair
  - scripts/measureEpaDeviations.ts componentMapArm()
  - docs/models/statbotics-breakdown-reference.md (recovered reference + per-season verdict table)
affects:
  - apps/web/src/components/methodology/epaComparisonContent.ts
  - docs/models/epa-divergences.md section 6
  - packages/core/algorithms/breakdown/2024.ts (comment only)
tech-stack:
  added: []
  patterns: [inert-optional-seam, satisfies-over-annotation, arms-as-wrappers, reference-transcribed-into-repo]
key-files:
  created:
    - docs/models/statbotics-breakdown-reference.md
  modified:
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/breakdown/2024.ts
    - scripts/measureEpaDeviations.ts
    - scripts/measureEpaDeviations.test.ts
    - data/diagnostics/epa-deviation-ablation.json
    - docs/models/epa-divergences.md
    - apps/web/src/components/methodology/epaComparisonContent.ts
decisions:
  - "Statbotics has no component partition. all_keys[year] is a rated-quantity list that double-counts by construction, so the divergence is a difference in KIND, not in grouping."
  - "No season is partition-constructible, so ARM_IDS is deliberately unchanged. The machinery exists and is unit-tested; no arm runs."
  - "epa is now declared with `satisfies AlgorithmModule<EpaState>` so the optional third parameter survives on the exported object."
  - "RECOMMEND KEEPING component-maps in EPA_DIFFERENCE_IDS. The divergence got BIGGER, not smaller. Developer's decision."
metrics:
  duration: ~1h20m (incl. two full 9-season regeneration runs)
  completed: 2026-09-11
actuals:
  tokens: 41000
  tasks: 3
  commits: 3
---

# Quick Task 260911-gfe: the component-map seam, and what it found

## THE ANSWER: is this actually different still?

Yes, and it is a bigger difference than the page has been claiming, not a smaller one. The old
story was that both sites chop a match score into pieces and simply chop it differently.
That turns out not to be true. **SigmaScout rates several pieces per team and adds them up to
predict a score. Statbotics rates one number per alliance and predicts straight from it.** The
per-season key list people point at as "Statbotics' component table" is not a table of pieces
that add up to a score at all. It is a menu of everything Statbotics puts a rating on, at several
overlapping levels of detail at once: it lists the no-foul total right beside the three phase
totals that no-foul total is the sum of, its finer keys sit *inside* those phases, and in two
seasons one key is listed twice. You cannot compare SigmaScout's map against that, because
those are two different kinds of object. So there was never a delta to compute here, and the
right output was never a number. For 2024, where the question CAN be pinned down, the honest
version of it has already been measured: doing it Statbotics' way (rate one no-foul total)
predicts 74.0 percent of winners, where SigmaScout's three-phase map predicts 75.2 percent.
Copying Statbotics here would cost roughly 1.2 percentage points of winner accuracy. The
divergence is real, deliberate, and now measured rather than asserted.

## Did the WebFetch of Statbotics' source succeed?

**Partly, and the limit matters — every season verdict other than 2024's depends on it.** The
executor sandbox denies network Bash. The orchestrator ran the fetch and wrote
`docs/models/statbotics-breakdown-reference.md` before this task started. What came back was a
SUMMARY produced by a small model, **not** a verbatim file dump, with the exception of two quoted
code fragments. Those fragments are the load-bearing ones and they are reliable:

- the shape of `all_keys[year]` (the eight base keys plus `comp_0..comp_9`), and
- the identity Statbotics validates: `error = no_foul_points - (auto_points + teleop_points + endgame_points)`.

The surrounding prose is a faithful-but-secondhand reading, and the per-season component NAME
SPELLINGS in that file's section 4 are explicitly **not established**. Nothing in the verdict
table below rests on those spellings; that is deliberate, and section 8 of the reference file
says so in its own words.

I also verified, as the plan required rather than assumed, that the repo's existing claim is
false. `.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md:561` says Statbotics'
`all_keys[year]` was "verified, quoted verbatim above". **There is no such quotation anywhere in
that file** — a repo-wide search for `comp_0`, `key_to_name`, `no_foul_points` and
`get_score_from_breakdown` returns only the three prose citations. The table was read in that
session and never written down. This is the same failure quick task 260910-x09 filed against the
2018 switch/scale sigmoid, hitting a second time on a different fact from the same source file.
That is why the reference now lives in `docs/models/`, not in a phase folder that gets archived.

## Per-season constructibility

Four verdicts: `yes` (a faithful additive partition of what Statbotics rates exists and is
buildable), `no-overlapping-keys` (its key list double-counts, so there is no partition in it),
`no-rates-a-single-quantity` (it predicts from ONE rated number, so the only faithful partition
is the degenerate one-cell one), `not-established` (the evidence here does not support a verdict).

| season | constructible? | cost in accuracy / Brier | evidence, and why not more |
|---|---|---|---|
| 2016 | `no-overlapping-keys` | n/a, nothing to measure | Structural argument (sections 1+2+3 of the reference): `all_keys` lists `no_foul_points` beside the three phase keys it is the sum of. Year-independent, does not need spellings. Its own `get_score_from_breakdown` branch NOT ESTABLISHED. |
| 2017 | `no-overlapping-keys` | n/a | as 2016 |
| 2018 | `no-overlapping-keys` | n/a | as 2016. Same season whose post-processing sigmoid is already `unmeasurable-no-reference` for the same never-transcribed reason. |
| 2019 | `no-overlapping-keys` | n/a | as 2016 |
| 2020 | `no-overlapping-keys` | n/a | as 2016. A 2020 map is registered but the harness does not replay 2020, so any arm would score almost nothing. |
| 2021 | `not-established` | n/a | No 2021 map is registered and the corpus carries no 2021 matches. |
| 2022 | `no-overlapping-keys` | n/a | as 2016, plus the reference reports `endgame_points` listed TWICE this year (secondhand, orientation only). |
| 2023 | `no-overlapping-keys` | n/a | as 2016 |
| **2024** | **`no-rates-a-single-quantity`** | **0.7403 vs shipped 0.7520 winner accuracy, about -1.2pp.** Brier not comparable, see caution. | The only season with a DIRECTLY verified branch: `score = breakdown["no_foul_points"]`, verified 2026-09-10 against `backend/src/models/epa/breakdown.py`. Overlap is concrete here, not just structural: `speaker_points` re-counts notes already inside `auto_note_points`/`teleop_note_points`. |
| 2025 | `no-overlapping-keys` | n/a | as 2016 |
| 2026 | `no-overlapping-keys` | n/a | as 2016, plus the duplicated `endgame_points` again. |

**No season is `yes`.** `ARM_IDS` is therefore unchanged and no new arm runs. That is the
finding, not a shortfall — and it is the reason no number was manufactured for the empty cells.

Two cautions attached to the 2024 figures, both carried into the register and into
`epa-divergences.md` section 6:

- Those numbers come from `experiments/260910-4x0`'s scratch scorer. They are comparable to
  **each other** only. Never difference one of them against a published figure, which counts ties
  (the scorer-mismatch hazard that already invented one imaginary regression on this project).
- **The curve turns over.** Eleven components scored 0.7348, three scored 0.7520, one scored
  0.7403. "Fewer is better" is not the lesson, and no other season may be coarsened on the
  strength of 2024's result without measuring that season the same way.

### Why "just use the phase partition everywhere" is not the loophole

`auto/teleop/endgame` IS a genuine additive partition — Statbotics validates that identity
itself. It is tempting to conclude every season could be measured by replaying it under
`groups.ts`'s three phase groups. It cannot. `groups.ts` declares its grouping as a JUDGEMENT and
its own header says several of those judgements deliberately disagree with the source's roll-up:
2019's `habClimb` is grouped endgame though TBA counts it in `teleopPoints`, 2016's
`teleopChallenge`/`teleopScale` likewise, 2022's bare `endgame` likewise. And Statbotics computes
its own phase keys per year in code this repo has never transcribed. A phase arm built out of
`groups.ts` would measure SigmaScout's own phase judgement and label it Statbotics' — reproducing
exactly the mislabelling this task corrects. Recorded as section 9 of the reference file.

## The seam: inert at default AND live when supplied

Both cases were required and both were written before the implementation. An inertness case alone
would also pass for a parameter that is accepted and thrown away, which is the precise shape of a
dead seam — the arm would report a delta of exactly zero and a reader would take that as "the
component map does not matter" rather than "the arm never ran".

`epa.update(state, result, componentMap?)`, `epa.carrySeason(state, boundary, toSeasonMap?)`,
`tryParseBreakdownPair(season, raw, map?)`. `epa` is now declared with
`satisfies AlgorithmModule<EpaState>` rather than annotated with it: an annotation widens the
export to the interface, whose `update`/`carrySeason` take two parameters, and the third would
have become invisible at every call site including the arm it exists for.

**Actual comparison, 12 synthetic 2024 matches, team `frc1`'s components after the replay:**

```
DEFAULT (parameter absent)
   adjust=0.0000, auto=1.9460, endgame=1.9460, foulsCommitted=0.0597, teleop=3.8323
   sum of all components: 7.784065

EXPLICIT componentMapForSeason(2024)
   adjust=0.0000, auto=1.9460, endgame=1.9460, foulsCommitted=0.0597, teleop=3.8323
   sum of all components: 7.784065          <- INERT: identical to every printed digit

OVERRIDE a single no-foul total
   adjust=0.0000, foulsCommitted=0.1194, noFoulTotal=7.6646
   sum of all components: 7.784065          <- LIVE: three components, not five, and the
                                               fouls share DOUBLED (0.0597 -> 0.1194)
```

The liveness is not cosmetic. `foulsCommitted` doubling is the cold-start mass split moving:
`componentColdStartValue` is `EPA_INIT_COMPONENT_TOTAL / componentCount`, so under a 2-component
map the fouls component gets half the seeded mass where under a 4-component map it gets a quarter.
Since `predict` sums a team's NON-foul components and cross-attributes the opponent's fouls, that
difference moves real predictions.

`carrySeason`, same states: default and explicit `componentMapForSeason(2025)` produce byte-equal
records, `{"autoMobility":1.248328534312908, "autoCoral":1.248328534312908, ... }`, and a
different incoming map produces a different one.

**A discovery worth recording, because it nearly produced a false green.** The first version of
the harness-level test compared states AFTER a season boundary and the liveness case FAILED.
`carrySeason` sums every component into one carried total and redistributes it, so the carried
state is **partition-invariant by construction** — two maps that disagree violently within a
season produce identical states the instant a boundary is crossed (note the sum above: 7.784065
under all three maps). A liveness check placed after the boundary would pass for an arm that
dropped its map entirely. Both test suites now compare the PLAYED state, and
`measureEpaDeviations.test.ts` pins the invariance as its own assertion so the next reader who
moves the check fails and reads why.

In the repo:
- `packages/core/algorithms/epa.test.ts` — 5 cases over a canonical serialization of EVERY
  `EpaState` field (36 matches, two events, two elim matches, one null-breakdown D-05 fallback),
  every value asserted finite, `NaN` encoded as a string so it cannot compare equal by accident.
- `scripts/measureEpaDeviations.test.ts` — 5 more at harness level, including the identity arm,
  the `undefined` fall-through, the override, the carry-invariance pin, and the arm version string.

**Invariants held:** `epa.version` is still `8.0.0+baseline` (verified by diff, one occurrence
before and after), no `EpaState` field added, `STATE_SNAPSHOT_SHAPE_VERSION` still 12. Full-run
baseline reproduces stage 1 exactly: pooled 0.7465 accuracy / 0.1729 Brier over 147,221 scored
matches and 1,653 event blocks, nine seasons.

## The relabelled 0.7461 figure

| | |
|---|---|
| **Old attribution (wrong)** | "Statbotics' comp partition" |
| **New attribution** | "a four-way grouping THIS PROJECT assembled from `comp_*` names (NOT Statbotics' own)" |
| **Value** | 0.7461, **unchanged** |

`experiments/260910-4x0/granularity.ts` built that arm by hand out of `comp_*` NAMES
(`autoLeave` / `autoNote` / `teleopNote` / `endgame`), monkey-patching `breakdown2024`. No such
partition exists in Statbotics. The measurement is real; only what it is a number OF was wrong.
Corrected in three places: `deviationRegister()`'s `priorMeasurement.values`,
`epa-divergences.md` section 6, and `breakdown/2024.ts`'s justification table. **Not deleted.**
The experiment file itself is untouched per the plan.

## Before and after: the page copy

**BEFORE** (`component-maps`, first two paragraphs):

> "A game like FRC scores points in pieces: autonomous points, teleop points, endgame points, and finer pieces inside those. Statbotics groups the raw scoring fields FIRST publishes into these pieces using its own table."
>
> "SigmaScout built its own table instead, checked directly against the matches it has stored. In some seasons the two sites group scoring pieces differently. For 2024, SigmaScout rates three pieces, one for each phase of the match, while several other seasons are split more finely than that."

**AFTER** (first three paragraphs):

> "A match score can be broken into pieces: points scored in the autonomous period, points scored by the drivers, points scored at the end of the match. SigmaScout rates each piece separately for every team, then adds the pieces back together to predict a score."
>
> "Statbotics predicts from a single number instead. For 2024 it rates one quantity per alliance, the match score with penalty points taken out, and predicts directly from that. It does publish piece by piece figures beside it, and those are worth reading, but they are extra views rather than the thing its predicted score is built from. Several of them overlap, counting the same points at two levels of detail at once."
>
> "So the two sites are not slicing the same score two different ways. One rates several pieces and adds them up. The other rates one total. For 2024 the three pieces SigmaScout rates are the three phases of a match, which is also the split Statbotics uses when it checks its own numbers add up."

**Changed further down** (one sentence, the measured paragraph):

> BEFORE: "Going all the way down to a single piece was worse again at 74.0 percent, so there is a best middle and it is not the finest or the coarsest slicing."
>
> AFTER: "Rating a single total, which is the shape Statbotics uses, predicted 74.0 percent. There is a best middle and it is neither the finest nor the coarsest slicing."

**Unchanged and deliberately so:** the heading, "How a match score is split into pieces". You
named this exception by that phrase, and it still describes the difference correctly — one site
splits, the other does not. The thin-evidence paragraph is untouched. The 73.5 / 75.2 / 74.0
figures are untouched. The closing "neither is more correct" paragraph is reworded only to say
"how much detail to rate" instead of "how finely to slice the same total score", which was the
old framing's assumption. No em dashes; the voice gate passes.

## DECISION FOR YOU: does `component-maps` stay in `EPA_DIFFERENCE_IDS`?

This is a locked decision and I did not touch it. `EPA_DIFFERENCE_IDS` still holds exactly three
ids, in order, and the equality pin still passes.

**The question:** under your standing directive that SigmaScout's EPA is as faithful a copy of
Statbotics' as possible with exactly three accepted exceptions, is "how a match score is split
into pieces" still one of them, now that the difference turns out not to be two different
groupings?

**My recommendation: KEEP it.** Three reasons, in order of weight:

1. **The divergence got bigger, not smaller.** "We group the pieces differently" would have been
   a minor difference. "We rate several quantities and sum them where they rate one" is a
   structural difference in how the model is built, and it is prediction-affecting on every match
   in every season. If it were removed, the single largest structural difference between the two
   models would be the one thing the page does not mention.
2. **It has a measured price and you are paying it on purpose.** For 2024, matching Statbotics
   costs about 1.2 percentage points of winner accuracy. A deliberate, measured, load-bearing
   divergence is exactly what the three-exception list is for. The other two entries are weaker
   on this test, not stronger.
3. **The precedent in the file argues against churn in this set.** The header comment already
   records that 8.0.0's carryover fix was deliberately NOT added as a fourth entry. Removing an
   entry because its wording turned out wrong is the same instinct pointing the other way; the
   fix for wrong wording is the rewritten wording, which is what landed.

Removing it would take the set to two and is yours alone to decide. Nothing else in the repo
depends on the count.

## Deviations from plan

1. **`breakdown/2024.ts` relabelled (comment only).** Task 2 forbids touching `packages/` and
   Task 3's file list is the page plus `epa-divergences.md`. But `2024.ts`'s justification table
   carried a fourth copy of "Statbotics' comp partition", in the file a future season-map author
   reads first. Correcting three surfaces and leaving the fourth asserting the falsehood defeats
   the point of the task. Comment only: no code, no behaviour, no version. Committed with Task 3
   and named in its commit message.
2. **The register's `reason` was rewritten twice.** The first wording contained the literal phrase
   "INJECTION SEAM", which the plan's own artifact check rejects with
   `/injection point|injection seam/i` regardless of whether the sentence blames it or announces
   it. Caught before the artifact was finalized. The full run was killed mid-flight and restarted
   so the committed JSON matches the committed code; no JSON was hand-edited. The exact regex is
   now pinned as a test assertion so the check and the register cannot drift apart.
3. **`WebFetch` was not attempted.** The orchestrator had already performed it and written the
   reference file; the executor sandbox denies network access. Provenance limits recorded above
   and in the file itself.
4. **`reports/epa-deviation-ablation.json` is gitignored** in this repo, so only
   `data/diagnostics/epa-deviation-ablation.json` was committed. Both were written by the run.

## Commits

| | |
|---|---|
| `b62c3655` | `feat` — the inert component-map parameter through `update`/`carrySeason`/`tryParseBreakdownPair`, `satisfies`, inertness + liveness tests |
| `1594918c` | `feat` — the recovered reference, the per-season verdict table, `componentMapArm` + tests, the flipped register entry, regenerated artifacts |
| `6c993a3b` | `docs` — the methodology page, `epa-divergences.md` section 6, the `2024.ts` relabel |

Another session was committing to this checkout throughout (`3cbf7783` landed between my first
and second commits). Every commit used an explicit pathspec; `git add -A` was never run, and no
foreign file was staged.

## Verification

- `npx vitest run packages/core/algorithms/epa.test.ts scripts/measureEpaDeviations.test.ts apps/web/src/components/methodology/epaComparisonContent.test.ts packages/harness/stateSnapshot.test.ts` — 158 passed.
- `npx vitest run packages` — 110 files, 2,459 passed, 4 skipped. `npx vitest run scripts` — 15 files, 303 passed.
- `npx tsc --noEmit` clean. `npx tsc -p apps/web/tsconfig.json --noEmit` clean. Both were run, because the root config does not cover the web app.
- The plan's artifact check prints `component-map status: unmeasurable-no-reference` and a reason
  that no longer names a missing seam as the blocker.
- `git diff 115b90f4 HEAD -- packages/core/algorithms/epa.ts` shows three changed function
  signatures and nothing else structural: no `version:` line, no `EpaState` field.

## Self-Check: PASSED

All three commits present in `git log`. `docs/models/statbotics-breakdown-reference.md` exists and
is tracked. `data/diagnostics/epa-deviation-ablation.json` carries all nine seasons, three arms,
57 metric rows and 76 contrasts, regenerated by the script rather than edited.
