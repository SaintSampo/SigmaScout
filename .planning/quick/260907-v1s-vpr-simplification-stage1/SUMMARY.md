---
task: VPR simplification stab — Stages 1, 1b, 1c, 1d + Stage 2A (the deletion)
date: 2026-09-07
status: complete
commits: [d2600e93, 15fbf94e, 339ab332, 8d23367c, cd705f95, 06232d62, d3c36f6f, c400808a, 97c25673]
outcome: 7 parameters DELETED at SIGMA1_CODE_VERSION 11.0.0; three follow-up hypotheses refuted; NOT republished
stopped_at: operator halted the line of work 2026-09-08; origin 2022's Stage 1d run has no data
---

# Summary

Stage 1 asked which VPR parameters are load-bearing for prediction accuracy.
Stage 1b then checked the answer on the other four origins, and **refuted part
of it.** Final answer: **9 of 19 parameters are confirmed free, not 11.**

## What was done

Built `probe.ts`, which rebuilds the parameter-relevance instrument on the three
axes the existing sensitivity screen gets wrong for an accuracy-first objective
(it screens on 2019/2020, against Brier, around DEFAULT values). This probe
scores a chosen origin's accuracy around that origin's **shipped** values with
**event-blocked paired** standard errors. Six runs: full 19-knob sweeps on 2026,
2025 and 2024, plus the joint pin test on all five origins 2022–2026.

## What survived

1. **`linkC` and `covEwmaAlpha` cannot change winner accuracy** — proved from
   `linkFunctions.ts:113` (`logistic(margin / (c·√variance))`, both factors
   positive, so sign of argument = sign of margin), and confirmed **+0.00000
   with a paired SE of exactly 0 on all five origins**. `linkC` is the
   top-ranked survivor of the existing Brier screen.
2. **The adaptation subsystem is free to delete** — 6 fields, a state field and
   a module, verified on the three origins that actually ship it enabled.
3. **`maxTeamKalmanGain` never binds on any origin** — 0.54→1.0 bitwise
   identical on 2024, 2025 and 2026.

That is **9 fields**: 2 moved to a post-hoc calibration fit, 7 deleted.

## What was refuted — by my own follow-up

The 2026 headline of "11 free" **does not generalise**. `minimal` costs 2024
−3.2σ and 2022 −2.1σ.

- **`minConsistencyVarianceRel` is not dead.** 0.53σ on 2026 but **3.58σ on
  2024**, where it wants to be *higher*, not lower. It alone accounts for the
  entire 2024 regression.
- **The three carry-damping fields are conditional.** Free on four origins,
  −1.7σ on 2022 — the one origin shipping all three away from identity.

The lesson generalises past this task: **a single-season relevance screen cannot
be trusted, and that includes this one.** It is the same failure the existing
2019/2020 screen makes, just at a different season.

## New findings from the multi-season pass

- **VPR already beats EPA outright on 2024 by +5.5σ.** The aggregate deficit is
  not uniform — it is three losing seasons plus one strong win.
- **A fixed `attributionShrinkage: 0.9` cuts the mean EPA gap by 44%**
  (−0.266pt → −0.148pt), improving 2023, 2025 and 2026 while costing 2024 —
  consistent with the 2026-09-06 tune rejecting it hardest on that origin.
- The acceptance comparison is **contaminated on origins 2023 and 2024** (the
  incumbent's parameters for those seasons were selected on a window containing
  them, while candidates are blinded), and the incumbent is **stale by its own
  provenance note**.

## Corrections to this author's own prior work

`maxTeamKalmanGain`, added and promoted the previous session, never binds on any
season measured. `attributionShrinkage`, added in the same session, is the one
genuine lead in the whole parameter set.

## Scope held

No `packages/` change. Nothing promoted, published, or deleted. Every number is
a measurement; the deletion list is Stage 2's input.

See `RESULTS.md` — the 2026 sections are left standing unedited with Stage 1b as
the correction, so the retraction is visible rather than tidied away.
