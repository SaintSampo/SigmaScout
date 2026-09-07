---
task: VPR simplification stab — Stage 1 (measure, don't promote)
date: 2026-09-07
status: in-progress
---

# Stage 1: which VPR parameters are actually doing work?

## Why this exists

Yesterday's 10-arm re-tune produced a candidate **worse** than the incumbent on the
held-out origin in 8 of 10 arms, mean −0.24 accuracy points, one arm at −6σ. Two
structural problems were found while reading the artifacts:

1. **The acceptance comparison is contaminated on 2023 and 2024.** The incumbent's
   parameters for those seasons were selected on a window (2022/2023/2024) that
   *contains* them, while every candidate is properly blinded. The two contaminated
   origins are the two worst results. Of the three *fair* origins (same selection
   window on both sides) the score is +3.5σ, −0.6σ, −1.0σ.
2. **The incumbent is stale by its own admission.** `vpr@10.0.0+rolling-2026-09c`'s
   own provenance note: *"Every OTHER parameter in this set was tuned against the
   RETIRED residual-history R estimator and is stale."* Every season except 2022 is
   running parameters fit for a measurement-noise estimator that no longer exists.

Plus the search itself is underpowered: **67 evaluations in a 14-dimensional space**,
with 10 of those 67 statistically indistinguishable from the winner.

The existing sensitivity screen — the instrument that decides which knobs are "live" —
is wrong on all three axes at once. It runs on **2019/2020** (not the season we care
about), with a **Brier** objective (not accuracy), around **default** parameter values
(not the shipped optimum). Stage 1 rebuilds that instrument correctly before anyone
tunes anything else.

## Scope

**This task measures. It does not promote, publish, or delete any code.** The
deliverable is a ranked deletion list with per-parameter evidence. Field removals from
`Sigma1Params` are Stage 2, gated on these results.

## Method

All measurement is on **2026 winner accuracy**, out of sample. The replay chain is
2024 → 2025 → 2026 with state carried, scoring 2026 only. 2026's shipped parameters
were selected on 2023/2024/2025, so 2026 is genuinely held out.

Significance yardstick: **event-blocked paired bootstrap** (`eventBootstrap.ts`),
never an unpaired SE — two configs that differ in one parameter produce highly
correlated prediction streams, and an unpaired SE would hide real effects behind a
threshold that is far too wide.

### 1a — Perturbation sensitivity around the shipped optimum

For each of the 19 searchable parameters, hold every other parameter at its shipped
2026 value and sweep that one across its registered bound. A parameter whose 2026
accuracy range across its **entire** bound is below the paired-bootstrap noise floor
cannot be doing work, and is a deletion candidate.

Stated limitation, up front: this is a *local, one-at-a-time* measurement at one point
in the space. "Flat in leave-one-out" is necessary evidence for deletion, not
sufficient — a parameter could matter only in combination. Survivors of 1a get
confirmed jointly in Stage 2; nothing is deleted on 1a alone.

### 1b — Structural redundancy tests

Specific, falsifiable hypotheses about parameters that may be the same degree of
freedom wearing different names:

- **P0/R0 coupling.** `coldStartConsistencyVarianceRel` seeds both the initial belief
  variance P and the cold-start measurement noise R. Since the Kalman gain is
  `P/(ΣP + R)`, seeding both from one quantity pins the early-match gain near 0.5
  regardless of its value. Prediction: sweeping it moves 2026 accuracy far less than
  its bound width suggests.
- **The carry family.** Four parameters — `carryPriorYearShare`, `carryMeanReversion`,
  `carryVarianceFactor`, `carryEvidenceRate` — all control how much of last season
  survives into this one. Test whether the accuracy surface over the four is
  effectively one- or two-dimensional.
- **q against the R floor.** Whether `processNoiseWithinEventRel` and
  `minConsistencyVarianceRel` trade off along a ridge rather than acting
  independently. Note the honest caveat: R is *estimated from data* by the consistency
  EWMA and only floored by the parameter, so a clean q/R scale invariance is **not**
  expected — this test measures how much ridge actually exists rather than assuming it.

### 1c — Reference points

Every configuration is reported against two fixed bars on the same 2026 matches: the
**shipped VPR** parameters and **EPA**. A simplification that costs nothing against
shipped VPR but still trails EPA is a real result and gets reported as one.

## Deliverable

`RESULTS.md` with:
- per-parameter accuracy range over its full bound, against the paired noise floor
- a ranked deletion list, each entry carrying its measurement
- the redundancy findings for the carry family and the cold-start seed
- an explicit statement of what Stage 1 cannot conclude alone

## Constraints

- Runs inline in the main context. No executor subagents.
- Working-tree-only experiment pattern: any patch to `packages/` is reverted and the
  tree confirmed clean before this task closes. No committed model change.
- Judge every command by its output, never by its exit code.
- Stage explicit paths on commit; never `git add -A`.
