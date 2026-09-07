---
task: VPR simplification stab — Stage 1
date: 2026-09-07
status: complete
commits: [d2600e93, 15fbf94e]
outcome: measurement only — deletion list produced, nothing promoted or published
---

# Summary

Stage 1 asked which VPR parameters are actually load-bearing for prediction
accuracy. Answer: **8 of 19, and possibly 7.**

## What was done

Built `probe.ts`, a measurement harness that rebuilds the parameter-relevance
instrument on the three axes the existing sensitivity screen gets wrong for an
accuracy-first objective. The screen runs on 2019/2020, against Brier, around
DEFAULT values; this probe scores **2026 accuracy** around the **shipped 2026
values** with **event-blocked paired** standard errors. Two runs: a 96-config
one-at-a-time sweep over all 19 searchable parameters, and a 9-config joint pin
test that leave-one-out structurally cannot substitute for.

## Results

1. **`linkC` and `covEwmaAlpha` are provably incapable of changing winner
   accuracy**, by algebra rather than measurement — and confirmed bitwise.
   `linkC` is the top-ranked survivor of the existing Brier screen.
2. **11 of 19 parameters pin at identity for exactly zero accuracy cost.**
3. **The adaptation subsystem is inert while enabled** — 6 parameters, a state
   field and a module, never previously measured where it actually operates.
4. **The carry-damping family is optimal switched off**, reproducing quick task
   260906-6zc by a different objective on a different season.
5. **`attributionShrinkage` is the one unexploited gain**: +0.00213 at 0.9, and
   the resulting 8-parameter model leads EPA on 2026 by **+1.01σ** — a lead the
   size of its own uncertainty, recorded as a direction, not a win.

Two problems found while reading the previous run's artifacts, both written up
in `RESULTS.md`: the acceptance comparison is **contaminated on origins 2023 and
2024** (the incumbent's parameters for those seasons were selected on a window
containing them, while every candidate is blinded), and the incumbent is
**stale by its own provenance note** — fit against a retired R estimator.

## Corrections to this author's own prior work

`maxTeamKalmanGain`, added and promoted the previous session, is the weakest
knob of all nineteen (0.3σ) and its cap never binds because real Kalman gains
never exceed 0.54. Recorded in `RESULTS.md` rather than quietly dropped.

## Scope held

No `packages/` change. Nothing promoted, nothing published, no field deleted.
The deletion list is Stage 2's input and is explicitly gated on first re-running
this probe across origins 2022–2025 — every result here is one season.

See `RESULTS.md` for the full tables, the invariance proof, and the four things
Stage 1 does **not** establish.
