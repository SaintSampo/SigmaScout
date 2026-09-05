---
status: complete
quick_id: 260905-jyf
phase: quick-260905-jyf
plan: 01
subsystem: sigma1-carry
tags: [experiment, vpr, carry-season, measurement, negative-result]
dependency-graph:
  requires: [reports/autopsy-260905/FINDINGS.md]
  provides: [260905-jyf-RESULTS.md, score-carryvar.cjs]
  affects: []
tech-stack:
  added: []
  patterns: [walk-forward-replay-scoring, working-tree-experiment-patch-and-revert, SE-unit-mechanical-verdict]
key-files:
  created:
    - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs
    - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md
  modified: []
decisions:
  - "R1 (seed belief variance from carried, gap-decayed consistency) WINS the pre-committed criteria: improves early-slice accuracy on both 2023 and 2025, never moves overall accuracy by more than 2 binomial SE in any season -- but the effect is small (pooled accuracy +0.20 SE-units, ~0.03pt)."
  - "R2 (seed belief variance from cold-start prior scaled by reversionOverGap(carryMeanReversion, gap)) is a NO-WIN, in fact a clear negative result: 2023/2024/2025 breach the -2.0 SE floor (worst -12.69 SE in 2025), pooled accuracy -10.46 SE-units. This closes off that specific formulation as a Stage-2 direction."
  - "Both patches reverted; digest.test.ts (8/8) confirms the tree reproduces the committed prediction digests bitwise -- neither patch survived."
metrics:
  duration: "~35min"
  completed: 2026-09-05
actuals:
  tokens: 42000
  tasks: 3
  commits: 0
---

# Stage 1 carry-variance experiment — two parameter-free boundary-variance seed rules Summary

Built and validated a join-and-score instrument against `reports/autopsy-260905/FINDINGS.md`'s
independently-produced 83,655-scored-match baseline (exact match, 0 seasons with a
non-zero unexplained drop count), then patched, replayed, and reverted two
parameter-free candidate seed rules for `carrySeason`'s belief-variance boundary reset
(`packages/core/algorithms/sigma1/index.ts`), scoring all four series (epa, baseline-vpr,
r1, r2) over 2022-2026 on one shared matchKey intersection and one early-slice event set.

**R1** (seed belief variance from carried, gap-decayed consistency, floored at
`minConsistencyVariance`) **WINS** the pre-committed criteria: it improves early-slice
accuracy over baseline-vpr on both 2023 (0.7402 -> 0.7413) and 2025 (0.7405 -> 0.7407),
and never moves overall accuracy by more than 2 binomial SE in any season (deltas ranged
0.00 to 0.37 SE-units). The effect is real but small — pooled accuracy improved only
+0.20 SE-units (0.7641 -> 0.7644), an order of magnitude smaller than the ~1.3pt
EPA-vs-VPR early-slice gap the autopsy diagnosed. Directionally validates the mechanism;
does not by itself close the gap.

**R2** (seed belief variance from the cold-start prior scaled by
`reversionOverGap(carryMeanReversion, gap)`) is a clear **NO-WIN** — a genuine negative
result, not merely an unexplored one. It made early-slice accuracy WORSE on both required
seasons (2023: 0.7402 -> 0.7292, 2025: 0.7405 -> 0.7099) and breached the -2.0 SE floor on
three of five seasons, worst at 2025's -12.69 SE. Pooled accuracy dropped 10.46 SE-units.
Scaling the full cold-start prior directly by the mean-carry reversion fraction
overshoots into overconfidence for teams with carried state — the opposite of the
diagnosed fix.

No promotion, tuning, parameter addition, or version bump followed — per plan scope, both
verdicts are complete measurements handed to the user for the Stage-2 decision.

## Task-by-task

1. **Instrument built and validated** (`score-carryvar.cjs`): streams five ~30-66MB
   baseline JSONL files with `readline`, retains only five scalar fields per row (never
   the `*Components` blobs), joins on `matchKey`, derives the early-event set once from
   baseline first-appearance chronological order, and computes accuracy/Brier plus an
   SE-unit delta column. `--candidates none` reproduced `TOTAL_SCORED=83655` exactly and
   matched FINDINGS.md's per-season direction (2024 vpr>epa, 2025 epa>vpr) before any
   replay was run.
2. **R1 and R2 patched, replayed, reverted — strictly sequentially.** Each patch: applied
   with Edit, typechecked clean (`npx tsc --noEmit`), replayed via
   `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carryvar-{r1,r2}-260905`
   (foreground, completed within the tool timeout, no `timeout` binary wrapper used), then
   reverted with `git checkout -- packages/core/algorithms/sigma1/index.ts`. Never both
   patches held at once. Both candidate artifacts report `algorithmVersion
   8.0.0+rolling-2026-09b`, identical to baseline — no version or parameter drift leaked
   in. Tree confirmed clean after each revert.
3. **Scored all four series, wrote the verdict.** `260905-jyf-RESULTS.md` contains the
   motivation, both patches as fenced diffs, exact commands, full per-season tables, the
   early-slice definition, the mechanical verdict for both rules with quoted deciding
   numbers, and a reproducibility note (`reports/` is gitignored; the four stream sets
   must be regenerated from the recorded commands). `npx vitest run
   packages/harness/digest.test.ts` passed 8/8 on the final reverted tree, proving
   bitwise-live behavior.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 deviations encountered; no auth
gates; no package installs.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. Both threat-register
mitigations (T-jyf-01 `.env` non-disclosure, T-jyf-02 patch revert + digest proof,
T-jyf-03 explicit-path staging) were followed; `.env` was never read/cat/echoed, only
consumed by `tsx --env-file` inside `pnpm harness`.

## Self-Check: PASSED

- `.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs` — FOUND
- `.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md` — FOUND
- `reports/carryvar-r1-260905/predictions-{2022..2026}.jsonl` (5 files) — FOUND
- `reports/carryvar-r2-260905/predictions-{2022..2026}.jsonl` (5 files) — FOUND
- `git status --porcelain packages data fixtures reports` — 0 lines (clean)
- `npx vitest run packages/harness/digest.test.ts` — 8/8 passed
- No commits made in this execution (per constraint — orchestrator commits afterward)
