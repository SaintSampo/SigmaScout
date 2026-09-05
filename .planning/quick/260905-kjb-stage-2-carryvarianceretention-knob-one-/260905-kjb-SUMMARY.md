---
phase: quick-260905-kjb
plan: "01"
subsystem: sigma1-algorithm
tags: [hyperparameter, carrySeason, season-boundary, search-space]
dependency graph:
  requires: [quick-260905-jyf (Stage 1 experiment results)]
  provides: [carryVarianceFactor knob, searchable at {min:0.05, max:1, scale:log}]
  affects: [packages/harness/tune.ts (future joint re-tune), future promotion]
tech-stack:
  added: []
  patterns: [dimensionless multiplier passed through resolveSigma1Params unchanged, explicit ===1 inertness branch, team-level carry gate]
key-files:
  created: []
  modified:
    - packages/core/algorithms/sigma1/params.ts
    - packages/core/algorithms/sigma1/params.test.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/harness/searchSpace.ts
    - packages/harness/searchSpace.test.ts
decisions:
  - "carryVarianceFactor uses R2's TEAM-LEVEL reach gate (oldTeamState !== undefined), not R1's per-component name-matched gate, because component names are season-specific and a name-matched gate reaches only foulsCommitted at any real boundary"
  - "Value is a free searchable constant, never derived from reversionOverGap(carryMeanReversion, gap) -- that specific derivation (R2) measured negative"
  - "screenGridFor now returns the endpoint-pinned grid directly when a parameter's default equals min or max, guarded symmetrically at both ends"
  - "SIGMA1_CODE_VERSION stays 8.0.0 and STATE_SNAPSHOT_SHAPE_VERSION stays 8 -- both non-bumps recorded in params.ts with full reasoning"
metrics:
  duration: ~55min
  completed: 2026-09-05
actuals:
  tokens: 34000
  tasks: 3
  commits: 3
status: complete
---

# Quick Task 260905-kjb: Stage 2 carryVarianceFactor Knob Summary

Registered `Sigma1Params.carryVarianceFactor` — a uniform per-team multiplier (schema-defaulted to exactly `1`, domain `(0, 1]`) on the cold-start belief-variance prior a returning team is seeded with at a season boundary in `carrySeason` — wired it end to end, made it searchable, and recorded the resulting `SIGMA1_CODE_VERSION` non-bump. Implementation and tests only; no tuning run, screen, promotion, or publish was performed.

## What was built

**Task 1** (`d0a8c6dc`): Added the field to `Sigma1Params` (interface, `DEFAULT_SIGMA1_PARAMS`, `Sigma1ParamsSchema` with `.finite().positive().max(1).default(1)`), mirroring `elimObservationNoiseMultiplier`'s treatment. Wired the single seed site in `carrySeason` (`index.ts`, per-component loop): an explicit `carryVarianceFactor === 1 || oldTeamState === undefined` branch returns `coldStartVariance` unchanged; otherwise `Math.max(resolved.minConsistencyVariance, coldStartVariance * resolved.carryVarianceFactor)`. Lines computing `carriedObserved`/`consistency[name]` (the accumulator) are byte-identical in the diff. Added a full test group to `params.test.ts`: schema round-trip/domain rejection, inertness (byte-identical cross-boundary stream at factor 1), wiring (differing stream at 0.3), boundary gate (single-season control byte-identical), no-carried-state branch (a team reaching `carryResult.teamPointTotals` only via `priorSeasonRatings.lastSeason`, per the D-16/D-17 route), the all-components reach pin (named on `"algae"`, present in 2025's component map and absent from 2024's), the pinned `adjust` branch, and monotonicity.

**Task 2** (`97659fbe`): Added `carryVarianceFactor: { min: 0.05, max: 1, scale: "log" }` to `SIGMA1_SEARCH_SPACE`, with bound justification citing both of quick task 260905-jyf's Stage 1 results (R1's win, R2's negative closure at ~0.069). Since the default (`1`) sits exactly at the bound's `max`, added an endpoint guard to `screenGridFor` that returns the grid directly (skipping the interior-slot overwrite) when the default equals `min` or `max` — the first searchable parameter to hit this case. Updated the function's own doc comment (its prior claim that every searchable parameter has an interior default was true until now). Moved pinned counts 15/14/29 → 16/14/30 in `searchSpace.test.ts`.

**Task 3** (`dc6fa58c`): Recorded a `NOT BUMPED at CVR-PARAM/CVR-WIRE` entry in `params.ts`'s version-history block, following the ELIM-R/ELIM-OFF entry's structure — applying the file's two bump triggers (shape change, observable output change) and showing neither fires, with `digest.test.ts`'s bitwise reproduction as the evidence. Confirmed `stateSnapshot.ts` needs no changes (no new `Sigma1State` field). Verified `git diff --stat` across all three commits touches exactly the five planned files.

## Deviations from Plan

None — plan executed exactly as written. One test-writing mistake was caught and self-corrected during development (an early draft of the "ALL-COMPONENTS reach" test incorrectly asserted `"algae"` absent from the factor-1 *carried* result rather than from the pre-boundary 2024 fixture state; fixed before commit, not a deviation from the plan's design).

## Follow-ups explicitly deferred to the MAIN context (no network in this subagent)

- **A fresh sensitivity screen** including `carryVarianceFactor`, followed by **the joint re-tune per origin** against the live `vpr@8.0.0+rolling-2026-09b` incumbent, and any resulting **promotion**.
- **Promoting a factor below 1 is a real model change** and earns its own `SIGMA1_CODE_VERSION` bump under the block's normal rules (trigger (b): observable output moves) — this task only registered the knob.

## The REACH (why this plan was revised mid-flight, and what the next reader needs to know)

The knob is gated on the team having carried state at all (**team-level**, `oldTeamState !== undefined`), NOT on a per-component name match. It therefore moves EVERY modeled component's seeded variance for a returning team. The name-matched alternative (Stage 1's R1 shape) was measured during planning to reach only `foulsCommitted` at any real season boundary and was rejected for that reason — whoever reads the eventual tune result needs to know it is this team-level shape that was tuned, not R1's.

## The PRIOR EVIDENCE points both ways

R1 (name-matched) won its pre-committed criteria but was worth only a few hundredths of a Brier point — an order of magnitude under the ~1.3pt EPA-vs-VPR early-slice gap it targeted. R2 (this same uniform-factor shape, but with the value derived from `reversionOverGap`) closed NEGATIVE at -10.46 pooled SE-units at its own derived value (~0.069). A keep-incumbent verdict (factor stays at 1) from the eventual joint search is therefore a **plausible outcome, not a defect** in this implementation. The untested region this task exists to expose is roughly **0.2–0.8**.

## Self-Check: PASSED

- FOUND: packages/core/algorithms/sigma1/params.ts
- FOUND: packages/core/algorithms/sigma1/params.test.ts
- FOUND: packages/core/algorithms/sigma1/index.ts
- FOUND: packages/harness/searchSpace.ts
- FOUND: packages/harness/searchSpace.test.ts
- FOUND commit d0a8c6dc
- FOUND commit 97659fbe
- FOUND commit dc6fa58c
