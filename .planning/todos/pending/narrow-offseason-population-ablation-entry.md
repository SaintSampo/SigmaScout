---
id: narrow-offseason-population-ablation-entry
created: 2026-09-11
source: quick task 260911-r7e — measured the thing the register calls unmeasurable, but regenerating the register is a long run
resolves_phase:
priority: low
---

# The ablation register still calls `offseason-population` unmeasurable — it has been measured

`scripts/measureEpaDeviations.ts` registers a deviation `offseason-population` with status
`unmeasurable-in-this-harness`, and that status is baked into the committed
`data/diagnostics/epa-deviation-ablation.json`.

Quick task 260911-r7e measured it against winner accuracy: **no effect.** Offseason-inclusive and
offseason-excluded replay streams produce 0.7576 vs 0.7576 in 2022, with no season moving by more
than 0.03 pp.

The reason is structural, which closes the question rather than leaving it open for a future
harness:

1. **Offseason events are post-championship.** Within a season they occur after every official
   match, so they cannot influence a prediction made earlier that season.
2. `aggregateScores` already excludes offseason matches from *scoring*, in both arms.

So the divergence is real for published **season-end values** (it is the dominant term in the
per-team OLS slope / Pearson residual, see `docs/models/epa-vs-statbotics.md`) and structurally
cannot reach **predictions on official matches**.

## Why it was not edited in 260911-r7e

Editing the register in `measureEpaDeviations.ts` without regenerating
`data/diagnostics/epa-deviation-ablation.json` would leave the committed JSON stale against its own
generator — the failure mode the project has hit before (a doc describing a model that no longer
exists). Regenerating it means a full multi-arm nine-season ablation run.

## The fix

Change the entry's `status` from `unmeasurable-in-this-harness` to a measured status, with a
`priorMeasurement` block citing quick task 260911-r7e, the two arms, and the structural reason —
**then regenerate** `data/diagnostics/epa-deviation-ablation.json` with
`pnpm measure:epa-deviations` in the same change, so source and artifact stay in step.

Best done alongside some other change that already requires regenerating that artifact, rather than
paying for a full ablation run on its own.
