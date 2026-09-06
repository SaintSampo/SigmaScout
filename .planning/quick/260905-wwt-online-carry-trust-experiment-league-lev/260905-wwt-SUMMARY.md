---
quick_id: 260905-wwt
phase: quick-260905-wwt
plan: 01
subsystem: sigma1-experiment
tags: [experiment, sigma1, carry-variance, negative-result]
status: complete
dependency-graph:
  requires: []
  provides: []
  affects:
    - packages/core/algorithms/sigma1/index.ts (working-tree only, patched twice, reverted twice, never committed)
tech-stack:
  added: []
  patterns:
    - "Working-tree-only model experiment: patch -> typecheck -> replay -> revert -> confirm clean, never committed"
key-files:
  created:
    - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs
    - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md
  modified: []
decisions:
  - "DOES-NOT-VALIDATE: criterion (b) (rescue must halve the 2024 pattern-break loss) fails — the online rescue only reduces it by ~29%, though it never costs accuracy elsewhere and retains 98.5% of the seed's own gain in seasons where the seed helps (criteria (a) and (c) both pass)"
  - "Independent Rule-A ship-relevance reading also fails both legs: pooled five-season accuracy is DOWN vs baseline (-0.000143) and pooled Brier is WORSE (+0.000476) for Arm SR, so neither arm would ship under the operator's existing acceptance standard even setting the mechanism question aside"
  - "No promotion, no tuning, no SIGMA1_CODE_VERSION bump — recorded as a completed negative measurement per the plan's explicit instruction not to productionize on a positive OR negative result"
metrics:
  duration: "~65min"
  completed: 2026-09-06
actuals:
  tokens: 78000
  tasks: 3
  commits: 1
---

# Quick task 260905-wwt: Online carry-trust experiment Summary

Tested whether a league-level, walk-forward-learned "carry reliability" signal (`carryTrust`,
an EWMA of squared normalized innovations from carried teams' early matches) could let VPR seed
season boundaries at Stage 2's confident level while automatically defusing 2024's pattern-break
loss — two arms (Arm S: confident seed alone at factor 0.5; Arm SR: same seed plus the online
rescue) isolated the rescue's contribution via SR-minus-S. **Result: DOES-NOT-VALIDATE.** The
rescue is directionally correct (shrinks the 2024 loss ~29%, never costs accuracy elsewhere,
retains 98.5% of the seed's gain where the seed helps) but falls short of the pre-committed bar
that it must halve the 2024 loss. The independent Rule-A ship-relevance reading also fails on
both legs (pooled accuracy down, pooled Brier worse). No code shipped; both patches were
working-tree-only and fully reverted.

## What Was Built

**Task 1** — `score-carrytrust.cjs`, a four-series (baseline/epa/s/sr) scoring instrument
adapted from Stage 1's `score-carryvar.cjs`, with a per-series `algorithmVersion` guard and a
new SR-minus-S delta column. Validated against two independent anchors before any replay ran:
reproduced Stage 1's exact 83,655-match scored-count and the harness artifacts' own per-season
winner-accuracy directions (2024 = the one season vpr beats epa; all others epa ahead), with
zero matches dropped for reasons other than a tie in every season. Committed alone by explicit
path (commit `050db6db`).

**Task 2** — Patched, typechecked, replayed, and reverted each arm strictly in sequence in the
shared working tree (never both patches held at once):
- Arm S: one module-level experiment constant (`EXPERIMENT_260905_WWT_CARRY_SEED_FACTOR = 0.5`)
  and one ternary edit at `carrySeason`'s seed site, replacing (not composing with) the promoted
  `carryVarianceFactor * evidenceFactor` product.
- Arm SR: the identical Arm S edit (verbatim-contained in SR's diff) plus nine total edit sites
  adding an optional `carriedFromPriorSeason` marker on `Sigma1TeamState`, an optional `carryTrust`
  accumulator on `Sigma1State`, a trust-observations array threaded through
  `AllianceUpdateResult`/`applyAllianceUpdate`, and a one-sided rescue multiplier in
  `applyTeamProcessNoise` (clamped `[1, 8]`, applied only to carried teams within their first 12
  matches, skipped bitwise when the factor is exactly 1).

Both arms replayed via `pnpm harness --seasons 2022-2026 --algorithm vpr --out
reports/carrytrust-{s,sr}-260905` — identical command shape, season range, and algorithm id as
the reused live baseline (`reports/rpnoise-baseline-260905`, `vpr@9.0.0+rolling-2026-09c`).
Both arms' 2022 streams are byte-identical (sha256) to the baseline — the free cold-start
control, since `carrySeason` returns before the seed loop runs and no team is ever marked
carried in 2022. Both artifacts report the unchanged `9.0.0+rolling-2026-09c` version (no drift).
The file was reverted with `git checkout --` after each arm; `git status --porcelain packages`
confirmed empty after each revert.

**Task 3** — Scored all four series (`--arms s,sr`), applied the five pre-committed criteria
mechanically:
- Premise check: S beats baseline in 2023 and 2026 (2 of 5 seasons) — premise not failed.
- (a) Retention: PASSES — pooled over {2023, 2026} (n=34,565), SR retains 98.5% of S's accuracy
  gain over baseline.
- (b) Rescue of 2024: FAILS — S's 2024 loss (0.000416) is real (not vacuous); SR's loss
  (0.000297) is only a ~29% reduction, short of the required 50%.
- (c) Never the worst option: PASSES — SR is never simultaneously below both baseline and S,
  in any season.
- Overall mechanism verdict: **DOES-NOT-VALIDATE** (all three criteria required; (b) fails).
- Independent Rule-A reading (pooled accuracy up AND pooled Brier not worse, the operator's
  2026-09-05 ship standard): **FAILS both legs** for SR (accuracy -0.000143, Brier +0.000476).

Wrote `260905-wwt-RESULTS.md` with the full per-season/pooled tables, both exact patch diffs
(with SR's containment of S's diff shown directly), all five planner decisions restated
(especially P-3's 2025 caveat: the live baseline already carries factor 0.845 there, so 2025's
delta measures 0.845->0.5, not 1.0->0.5 like every other season), the verdict against every
criterion with deciding numbers, and a reproducibility note. Confirmed the tree reproduces
committed digests bitwise: `npx vitest run packages/harness/digest.test.ts` — 10/10 passed on
the fully-reverted tree. Final `git status --porcelain packages data fixtures` line count: 0.

## Deviations from Plan

None — plan executed exactly as written. Both arms' typechecks were clean on first attempt; no
Rule 1/2/3 auto-fixes were needed at any task.

## Known Stubs

None. This is a measurement task; no UI or shipped code was produced.

## Threat Flags

None beyond those already named in the plan's own threat model (all dispositioned `mitigate` or
accepted `Elevation of Privilege` for the out-of-scope promote/publish path, which was never
exercised).

## Self-Check: PASSED

- `.planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs` — FOUND (committed, hash `050db6db`)
- `.planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md` — FOUND (uncommitted, left for orchestrator)
- Commit `050db6db` — FOUND in `git log --oneline --all`
- `git status --porcelain packages` — empty (confirmed after both arm reverts and at final check)
- `npx vitest run packages/harness/digest.test.ts` — 10/10 passed on the final, fully-reverted tree
