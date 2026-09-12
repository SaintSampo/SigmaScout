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

---

## RESOLVED 2026-09-11 — option 1, re-baselined onto the warm arm

Decided by the developer. `data/baselines/epa-vs-statbotics-2026-09.json` is regenerated from the
warm arm (`--warmup 2016-2020`), which is how `compare:epa-statbotics` actually invokes the script,
so the gate and the npm script can no longer describe different arms.

**The file now names its own arm as data, not prose** — the omission that let the drift go unnoticed.
Added `arm: "warm"`, `armDescription`, and `warmupSeasons: [2016..2020]`. `algorithmVersion` also
corrected from a three-versions-stale `epa@5.0.0+baseline` to `epa@10.0.0+baseline`.

**Half-width formula unchanged** from the 2026-09-04 bands: slope/pearson ±0.05,
meanAbsoluteDifference ±1.0, both standard deviations ±max(1.5, 10% of measured). No half-width grew.
Still gated on the `minMatchesFiltered` (≥12) arm.

**One correction to this todo's framing, measured rather than assumed.** `--check` was run against
the OLD cold bands under the warm arm **and it PASSED**. The cold bands were wide enough to absorb
the arm change, so this was a **latent mislabel, not an active false-fail**. The re-baseline was
still right — the file named the wrong arm and carried a stale version stamp — but no gate was
firing, and a later reader should not infer a regression that never happened.

Verified after: `--check` PASSES against the new bands; `baselineFingerprint.test.ts` and the
`scripts/` suite are green (19 files, 389 tests). That fingerprint test excludes this file by name,
so the tolerance record is not pinned by a hash and needed no companion update.
