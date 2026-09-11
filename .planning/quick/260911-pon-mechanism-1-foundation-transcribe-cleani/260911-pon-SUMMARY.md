---
phase: quick-260911-pon
plan: 01
subsystem: epa
tags: [epa, statbotics-fidelity, mechanism-1, component-maps, documentation, measured-arm]
status: complete
requires:
  - epa@10.0.0+baseline (the shipped baseline both arms were measured against)
  - componentMapArm seam, commit b62c3655
  - docs/models/statbotics-breakdown-reference.md sections 2, 10, 17, 18, 19, 20
  - CONTEXT.md decisions D-1, D-2, D-3 (locked at resume, after the plan was written)
provides:
  - scripts/statboticsComponentMaps.ts (2024 score-read map, unregistered arm)
  - mechanism 1's 1a/1b split and per-season score-read column
  - a corrected, re-derived mechanism 8
  - stage 7 unblocked under decision D-2
affects:
  - docs/models/epa-statbotics-gap.md
  - scripts/
tech-stack:
  added: []
  patterns: [wrap-the-proven-parse, drive-the-seam-never-mutate, equality-pin-never-iterate]
key-files:
  created:
    - scripts/statboticsComponentMaps.ts
    - scripts/statboticsComponentMaps.test.ts
  modified:
    - docs/models/epa-statbotics-gap.md
decisions:
  - "Mechanism 8's verdict re-derived under mechanism 5's precedent and it does NOT change"
  - "Mechanism 1 splits into 1a (score-read set, buildable today) and 1b (full rated vector, no channel)"
  - "The tracer season is 2024 and only 2024"
  - "The tracer lands as a measured ARM, never as the shipped default"
  - "Stage 7 (2016/2017) is unblocked by D-2; rp_1/rp_2 are an internal score term, L-02 unchanged"
metrics:
  duration: ~1h
  completed: 2026-09-11
actuals:
  tokens: 52000
  tasks: 3
  commits: 3
---

# Quick Task 260911-pon: Mechanism 1 Foundation and the Mechanism 8 Body Fix — Summary

Repaired a stale mechanism in `docs/models/epa-statbotics-gap.md`, re-derived another into a
structural split that names what closing it actually requires, and built plus measured the first
season of that closure as an arm — a loss on both metrics, reported as found.

## What landed

| # | commit | what |
|---|---|---|
| 1 | `9aec4e00` | Part A — mechanism 8's body repaired, verdict re-derived |
| 2 | `c676057d` | Part B foundation — mechanism 1 re-derived, stage 7 unblocked |
| 3 | `73d62aef` | Part B tracer — the 2024 map, its test, and the measured result |

Nothing shipped changed. `epa.version` is still `10.0.0+baseline`, `ARM_IDS` is unchanged,
`EPA_DIFFERENCE_IDS` was never opened, `SEASON_COMPONENT_MAPS` does not carry the new map,
`breakdown/2024.ts` is byte-unchanged, and `data/diagnostics/epa-deviation-ablation.json` was not
regenerated. No republish, no deploy, no R2 write, no network, no BPR/SPR contact, no sealed-holdout
spend.

## Mechanism 8: the verdict was re-derived and it did NOT change

**It stays `DELIBERATE DIFFERENCE` in all nine seasons.** The matrix row and the tally are
untouched; the tally was recounted from the table at 37 `ALREADY MATCHES` / 35 `GAP` / 27
`DELIBERATE DIFFERENCE` = 99.

The rule applied is the one quick task 260911-l2k applied to mechanism 5, and mechanism 5 is named
in the body as the precedent so a later reader can see the label was re-derived rather than left
alone: a quantity adopted exactly from week 2 onward and live-estimated during week 1 alone stays
`DELIBERATE DIFFERENCE`, because the week-1 window is an L-01 remainder no code can close.

Three factual errors were replaced, not softened:

1. `self.year_obj.score_sd` was called "a season-final constant". It is the **week-1 alliance-score
   SD, fouls included** — `avg.py`'s `process_year` filters to `week_one_matches` and derives every
   `Year` column from that list alone.
2. SigmaScout's denominator was described as an expanding-window Welford SD in the general case.
   Since `epa@9.0.0+baseline` it is the **frozen week-1 SD from week 2 onward**, and the expanding
   estimate (with `EPA_FALLBACK_SCORE_SD = 25` before two observations) is the **week-1 branch
   only**, or the branch after a seal that found too little data.
3. The argument that adopting upstream's constant "would leak season-end variance into a Week 1
   prediction" was wrong twice — there is no season-end variance in it, and the violation is one
   week wide, not one season wide.

The algebraic-identity paragraph (`10 ** (k * norm_diff)` versus `exp(-margin / scale)`, sign, base
and coefficient all agreeing) survives intact.

Two residuals keep the label, and the second was **checked against `epaWeekOne.ts` and
`epa.ts:update` rather than asserted**: the week-1 window (R3 item 1, plus the stated one-match lag
at the seal), and the frozen population (R3 residual gap 4) — SigmaScout's streaming accumulator
skips ruling-zero alliances, never folds a `null`-week match, and ignores a late week-0 arrival once
sealed, where Statbotics filters an offline list.

The heading now reads `SD ADOPTED FROM WEEK 2, DELIBERATE DIFFERENCE (L-01 remainder)` — the label
is kept because it did not change, and the state is added so the heading is no longer misleading.

## Mechanism 1: re-derived into 1a and 1b

Three facts, checked against both sides, replace the "which entries and how many" framing:

1. Statbotics' **rated vector and the subset its score READS are different objects** — in seven of
   nine corpus seasons the score reads exactly one entry.
2. That vector **double-counts by construction** (`no_foul_points` sits beside the phase keys it is
   the sum of; `comp_0..comp_9` are sub-elements within those phases), so it is not an additive
   partition and never was. This is the same fact `measureEpaDeviations.ts`'s `component-map`
   register entry records, and the doc now says the two must be edited together.
3. `predictCore` sums **every** rated component except the alliance's own `foulsCommitted`, so in
   SigmaScout the rated set IS the score-read set — there is **no rated-but-not-scored channel**.

Hence the split: **1a** is the score-read set, buildable today through `componentMapArm` for every
season whose read is a linear sum of own entries. **1b** is the full rated vector, and it is not
reachable without building a channel that does not exist. A per-season score-read column was added
to the table from reference section 18.

Two corrections folded in:

- **The transcription blocker is closed.** All eleven `clean_breakdown_{year}` functions plus
  `post_clean_breakdown` were re-checked mechanically against the on-disk `tba_breakdown.py`:
  **11 of 11 verbatim**, no exceptions. The plan's preflight finding held.
- **Residual gap 1's "single most valuable remaining fetch" bullet is retracted in place.**
  `avg.py` has been fetched, it answers the question, and the correction block at the top of the
  document already said so.

## The 2024 tracer, measured

`scripts/statboticsComponentMaps.ts` exports a two-component 2024 map — one `noFoulPoints` total
plus `foulsCommitted` — built by **wrapping `breakdown2024.parse`** and summing its `auto`,
`teleop` and `endgame` outputs. No second field list, no second Zod schema, no mutation of the
shipped object. `adjust` is dropped rather than relocated (reference section 2 puts `adjustPoints`
on the foul side) and is numerically inert regardless, since `applyComponentUpdate` pins it at 0.

`scripts/statboticsComponentMaps.test.ts` proves it against 2,000 real 2024 corpus matches:
component names by **equality pin** (not a loop), the no-foul total equal to the shipped map's three
phase totals exactly, that same total equal to `totalPoints - foulPoints - adjustPoints` on every
sampled side, `foulsCommitted` bit-identical, and `breakdown2024` untouched after use — the
anti-monkey-patch guard. 7 tests, all passing, run from the repo root. `npx tsc --noEmit` clean.

The arm was driven through the `componentMapArm` seam (never by mutation) over a 2016→2023 replay
off one shared carry, scoring 2024 twice. Output is on disk at `experiments/260911-pon/run.out` and
`experiments/260911-pon/precise.out`; the second run reproduced the first exactly.

| arm | comps | scored | correct | winner accuracy | Brier |
|---|---|---|---|---|---|
| BASELINE — shipped phase groups | 5 | 16,764 | 12,699 | 0.757516 | 0.168389 |
| FAITHFUL — Statbotics' 2024 score read | 2 | 16,764 | 12,693 | 0.757158 | 0.168543 |

**Delta, faithful minus baseline: winner accuracy −0.000358 (−0.036 percentage points, 6 matches);
Brier +0.000154. A LOSS on both metrics.** Reported exactly as measured. No tuning, no sweep, no
grid search, no variant selection anywhere in the work.

**The expected loss was about 1.2 points and the measured loss is about 0.04 — roughly thirty times
smaller, and this task does NOT explain it.** Three differences are known and none was quantified:
this run sits on `epa@10.0.0+baseline` while reference section 10's predates both `9.0.0` and
`10.0.0`; the baseline it is differenced against is therefore itself a different model; and the two
used different scratch scorers. **This must not be read as "the cost went away."** Six matches on
one season is far too small to distinguish from noise in either direction — the honest reading is
that this run makes a *smaller* claim than the 1.2-point figure, not a larger one. Re-measuring
section 10's arm on today's model would settle it and was deliberately not done here; it is recorded
in the document as a named open question.

The scorer convention is stated in both the driver output and the document: this driver's Brier
**excludes actual ties**, a published Brier does not, so the two arms are comparable to each other
and to nothing else.

## Eight seasons of mechanism 1 remain OPEN

Mechanism 1 is still `GAP` in all nine seasons — **this task closed nothing in the matrix.** No
partial season map is left half-built anywhere. The deferral is keyed to this document's own stages
rather than a new grouping:

- **2019, 2022, 2025, 2026** — stage 5, one quick task each, same shape as the 2024 tracer. 2025 is
  last of the four because of its opponent-coupled processor-algae correction.
- **2023** — stage 6, first. Seven entries, the 9-piece cascade, the cube/cone regrade, two caps.
- **2018** — stage 6, last. `zero_sigmoid`, the double-sigmoid asymmetry, opponent coupling, four
  `*_power` ratios, and a hard dependency on register R4.
- **2016, 2017** — stage 7, **no longer blocked** (see below).

## Decision D-2 applied: stage 7 is unblocked

Stage 7 used to read `BLOCKED ON A DEVELOPER DECISION`. The blocker is struck and the stage
re-labelled `UNBLOCKED 2026-09-11 (decision D-2), reproduce upstream exactly`. Upstream reads
`rp_1`/`rp_2` as two ordinary slots of the same 18-entry rated vector and, in **elimination matches
of 2016 and 2017 only**, adds them back at `rp_1 * 20 + rp_2 * 25` (2016) and `rp_1 * 100 +
rp_2 * 20` (2017).

**L-02 is unchanged and the distinction is written into the document in three places so a later
session cannot collapse one into the other.** L-02 governs OUTPUT — no published bonus-RP
probability, no RP pmf into the rank simulation, no RP predictor on the site. D-2 governs an
INTERNAL term of two seasons' score arithmetic, for achievements that were worth real points on the
playoff scoreboard. Registers R1 and R2 are marked SUPERSEDED rather than deleted, because their
exposure figures and qual/elim evidence are the reference stage 7 will implement against.

**This is a documentation change only. No 2016 or 2017 implementation was started.**

## Follow-ups, handed back

1. **`docs/models/statbotics-breakdown-reference.md` has TWO sections numbered 20** — line 2307
   ("Residual gaps — named, not guessed") and line 2334 (`avg.py`). Confirmed at HEAD. It is a real
   defect and it was **deliberately not fixed here**: the gap document and `measureEpaDeviations.ts`
   both cite section numbers by hand, and renumbering would silently break those citations. Fixing
   it needs its own task that updates every citation in the same change.
2. **The 30x discrepancy between section 10's 1.2-point figure and this run's 0.04-point figure is
   unexplained.** Re-measuring section 10's arm on `epa@10.0.0+baseline` with this driver's scorer
   would settle whether the cost genuinely shrank or the two numbers were never comparable. Until
   then decision 1's guidance to carry the 1.2-point figure forward stands, with this run recorded
   beside it.
3. **Republish debt is still owed twice over**, for `epa@9.0.0+baseline` and `epa@10.0.0+baseline`.
   This task neither discharged it nor added to it, because nothing shipped changed.

## Self-Check: PASSED

- `scripts/statboticsComponentMaps.ts` — FOUND
- `scripts/statboticsComponentMaps.test.ts` — FOUND
- `docs/models/epa-statbotics-gap.md` — FOUND, modified in all three commits
- `experiments/260911-pon/run.out`, `precise.out` — FOUND (gitignored, not committed, by design)
- commits `9aec4e00`, `c676057d`, `73d62aef` — all present in `git log`
- `git status --porcelain` — clean; nothing from the concurrent session was absorbed into any of the
  three commits, each of which was staged and committed by explicit pathspec
- `npx vitest run scripts/statboticsComponentMaps.test.ts` — 7 passed
- `npx tsc --noEmit` — clean
- `git diff HEAD -- packages/core/algorithms/breakdown/ packages/core/algorithms/epa.ts apps/web/src/components/methodology/epaComparisonContent.ts data/diagnostics/epa-deviation-ablation.json` — empty
- verdict matrix recounted from the table: 37 / 35 / 27 = 99, unchanged
