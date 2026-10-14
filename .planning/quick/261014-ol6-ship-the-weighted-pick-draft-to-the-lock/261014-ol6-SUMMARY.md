---
phase: quick-261014-ol6
plan: 01
subsystem: districts / Locks simulation
tags: [locks, pick-draft, simulation, web-worker, bake]
status: complete
requires: [e36fd8e9 PICK_POSITION_COUNTS]
provides: [pickPositionPmfForSeason, DistrictLedgerResult.randomDraft, DistrictEventDistributions.draftFixed, MAX_PICK_POSITION_PMF_LENGTH, caller guard]
affects: [Live Locks run, as-of REAL, as-of GENERATED, Champ Locks simulated DCMP bake, publisher district bake, measureDistrictCutoff, measureChampCutoff earlier positions]
key-files:
  created:
    - packages/core/districts/pickDraft.ts
    - packages/core/districts/pickDraft.test.ts
    - apps/web/src/workers/districtPickDraftPaths.test.ts
    - scripts/pickDraftCallers.test.ts
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - packages/harness/districtBake.ts
    - apps/web/src/workers/districtSimulationProtocol.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
    - apps/web/src/components/districts/LedgerParts.test.tsx
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/workers/districtSimulationProtocol.test.ts
    - packages/harness/browserSafeSchemas.test.ts
decisions:
  - "The pmf comes from one place, pickPositionPmfForSeason(season), set inside buildDistrictEventSimulationInput and bakeDistrictEvent at every stage. No caller passes it."
  - "randomDraft is set only when the draft actually runs (no knownAlliances) with weight beyond position 1, so a run with no pmf or the degenerate [1] pmf stays deep equal to the old greedy draft."
  - "The web reads the core's rankingFixed in exactly one line (draftFixed = rankingFixed && randomDraft !== true). Settled captions, drawer omissions and not picked key on draftFixed, true only once the alliances are announced."
  - "No version bump: SPR predict() untouched, no D1 state change, no artifact schema change, and no district presim sidecar is published or bake eligible; every Locks number is computed in the browser."
metrics:
  completed: 2026-10-14
actuals:
  tasks: 3
  commits: 3
---

# Quick 261014-ol6: ship the weighted pick draft to every Locks number

Jacob, 2026-10-14: "ship this change", after 261014-mji measured the weighted pick draft beating the fixed SPR draft under his pre registered rule. Every simulated draft behind a Locks number now draws its picks from the walk forward tables (2016 to the season before) through `pickPositionPmfForSeason`, and the tab no longer shows a drawn draft as settled: the settled caption, the drawer's omitted routes and not picked all wait for the announced alliances. Built in its own worktree (SigmaScout-ol6) because another session held uncommitted award edits in the main checkout.

## What was built
- `packages/core/districts/pickDraft.ts`: `pickPositionTableSeason`, `pickPositionPmfForSeason` (counts over total, memoised and frozen; a season uses its own table, seasons after the newest use the newest, seasons before 2023 get none), `PickTableLeakError`.
- `ledgerSimulation.ts`: optional `randomDraft?: true`, set by a conditional spread beside `rankingFixed`; comments that called the option a measurement candidate rewritten. `ledgerSimulation.test.ts` untouched and green.
- `districtLedgerRows.ts`: `buildDistrictEventSimulationInput` sets `pickPositionPmf` at every stage; `draftFixed` replaces `rankingFixed` on the web side; `teamNotPickedAtPosition` reads it.
- `districtBake.ts`: one pmf per season on every schedule's input; a republish stays byte identical (the pmf is committed data).
- `districtSimulationProtocol.ts`: `MAX_PICK_POSITION_PMF_LENGTH` (256) and `isPickPositionPmf` at the Worker message boundary.
- `districtLedgerOutcomes.ts`: settled route, outcome rows and Not selected read `draftFixed`.
- `scripts/pickDraftCallers.test.ts`: a source guard pinning the exact callers of `simulateDistrictEvent(`, the exact writers of a `DistrictLedgerEventInput` literal, both builders calling `pickPositionPmfForSeason(`, and no simulation import in apps/worker.

## Tests that moved
Four `DistrictLedger.test.tsx` tests assumed a decided draft at Quals done; they now run at the announced alliances position, where the draft is a fact, with their original assertions unchanged. New Quals done tests: no settled route line, a picked chance between 1% and 98%, the drawer lists all four routes, and selection over without a published list prints no not picked. Per path spy tests cover Live, as of REAL, as of GENERATED (40 schedules), the simulated DCMP bake (40) and the publisher bake.

## Verification (executor, worktree)
- Full root suite `npx vitest run`: 360 files passed, 11 skipped; 8,940 tests passed, 144 skipped, 0 failed.
- Typechecks root, apps/web, apps/web e2e: 0 errors.
- Exactly one non comment line in apps/web/src reads `rankingFixed` (the `draftFixed` derivation).

## Methodology copy handed to 261014-ol7
1. "Once qualification is over the ranking is settled, so the cell prints the exact points and the alliance the draft gives that team." Fixed on ol7 (22b47799).
2. "Rows the bracket or the ranking has already ruled out are left off." Fixed on ol7 (22b47799).
3. "Picks are taken in rating order among the teams still available." Replaced on ol7 (b9d14d91).
4. "A team on no alliance once alliance selection is over reads not picked." Still true where the published list is complete; left as is.
5. The district cutoff backtest figures, re-measured in the release.

## Follow up (not done)
At Quals done the rank 1 team loses its "captain, alliance 1" caption, though its captaincy is certain; only alliance 1's captain follows from the ranking alone.

## Commits
- bb00f7c9 feat: the weighted pick draft reaches a Live Quals done run, and a drawn draft stops printing as settled
- b3aecb86 feat: every other caller draws the weighted picks; one test per path
- e4d217d8 refactor: name the fact honestly (draft fixed, not ranking fixed) and guard the callers

## Self-Check: PASSED

## Release checks (orchestrator, 2026-10-14)
Measured in two clean worktrees so another session's uncommitted award edits could not leak in: BEFORE at e36fd8e9 (SigmaScout-before), AFTER at this branch (SigmaScout-ol6), same corpus (hard link), same copied origin cache and district files.

| Backtest | Before (fixed draft) | After (weighted draft) |
|---|---|---|
| District cutoff, simulated line MAE | 1.25 | 1.19 |
| District cutoff, midpoint rule MAE | 2.43 | 1.93 |
| Gate 1 (sim below midpoint) | PASS | PASS |
| Range holds the settled cutoff | 183 of 205 (89.3%) | 194 of 205 (94.6%) |
| Gate 2 (range holds 72% to 88%) | FAIL | FAIL, further above the band |
| In range to locked, district | 73.9% (2338 of 3165) | 75.6% (2364 of 3129) |
| In range to locked, champ | 66.0% (583 of 883) | 66.2% (579 of 874) |
| champ cutoff --check-history | no drift | no drift |

- Publisher bake proof: all 14 sidecars of `verify:district-bake` differ before vs after (the draft reaches the publisher). The census reads baked 14 at --as-of 2026-04-04 (the plan expected 2; the before run reads 14 too).
- `publishDistricts --dry-run` over 2016-2020 and 2022-2026: baked 0 in every season, so no republish is owed.
- Corpus tests: measureRandomPickDraft, measureSelectionAgreement and selectionModel.reconciliation pass; securedPlayoffCorpus needs data/fixtures/phase10, absent in a worktree; rerun from the main checkout after the merge.

**Push held by Jacob:** the range widening (89.3% to 94.6%, target 72% to 88%) traces to `advancementChance.ts` drawing every team's season total independently, which ignores that points are conserved inside an event; the weighted draft widens each team's marginal and the independent draws pile that up. Jacob chose to fix the cause first (draw each event jointly) and ship both together, measured against the registered gates.
