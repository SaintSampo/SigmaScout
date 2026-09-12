---
id: epa-statbotics-check-baseline-is-cold-arm
created: 2026-09-11
source: quick task 260911-r7e — left deliberately unmoved, because moving a tolerance gate is its own decision
resolves_phase:
priority: medium
---

# `epaVsStatbotics --check` can now fail on the arm change alone

`data/baselines/epa-vs-statbotics-2026-09.json` holds per-team agreement tolerance bands (OLS
slope/Pearson ±0.05, mean absolute difference ±1.0 points, both standard deviations ±max(1.5, 10%))
that were measured on the **cold** arm — the one that cold-started every team in 2022.

Quick task 260911-r7e made `compare:epa-statbotics` pass `--warmup 2016-2020`. Warming changes
2022's per-team EPA values, so `--check` run through the npm script now compares **warm statistics
against cold bands** and can fail for that reason alone, with nothing wrong in the model.

## Why it was not fixed in 260911-r7e

Re-measuring a committed tolerance gate is a decision about what the project promises, not a
side effect of a measurement task. Folding it into that task would have moved a gate quietly, in a
commit whose stated purpose was something else. Recorded here instead.

## The decision to make

Pick one, explicitly:

1. **Re-baseline against the warm arm.** Run `pnpm compare:epa-statbotics`, regenerate the
   baseline, commit it with the arm named in the file itself so a later reader knows which arm the
   bands describe. `--check` becomes meaningful again.
2. **Keep the cold bands and pin the arm.** If the bands are meant to describe the cold arm
   specifically, `--check` should invoke the script *without* `--warmup` and say so, so the two
   never drift apart again.
3. **Retire `--check`.** It is not run in CI (confirmed: no reference in `.github/workflows/`), and
   its only documented uses are inside closed quick-task plans from 260904. If nothing gates on it,
   a stale gate is worse than no gate.

Whichever is chosen, the baseline file should state which arm produced it. It currently does not,
which is what let this drift go unnoticed.

## Verification

- Not in CI: `grep -n "epaVsStatbotics\|compare:epa" .github/workflows/*.yml` returns nothing.
- `npx vitest run scripts/` passes (374 tests) regardless — no test depends on `--check`.
