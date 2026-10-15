---
phase: quick-261015-3oo
plan: 01
subsystem: districts / Locks alliance selection cell
tags: [locks, alliance-selection, captain, weighted-draft]
status: complete
requires: [261014-ol6 weighted pick draft]
provides: [DistrictLedgerResult.captainFacts, DistrictCaptainFacts, DistrictEventDistributions.captainFacts, DistrictSelectionRouteView.captainFact]
key-files:
  created:
    - packages/core/districts/ledgerSimulation.captainFacts.test.ts
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
decisions:
  - "Only STRUCTURAL facts of a fixed ranking settle a route while picks are drawn: rank 1 captains alliance 1; a team ranked 2k or lower never captains (k drafted alliances). Zero observed captain draws are never evidence."
  - "captainFacts is present only at a fixed ranking with a drawn draft, so every other simulation result stays deep equal and ledgerSimulation.test.ts is untouched."
metrics:
  completed: 2026-10-15
actuals:
  tasks: 3
  commits: 1
---

# Quick 261015-3oo: structural captain facts at Quals done

Since the weighted pick draft (261014-ol6), a settled Alliance selection route printed only once alliances were announced, so at Quals done the rank 1 team lost its "captain, alliance 1" caption although it is certain. Jacob chose to fix it on 2026-10-15 (item 4 of the follow ups; item 2, the champ run's joint draw, held until the award work settles).

## The facts
Under the progressive captain rule alliance n's captain ranks at most 2n minus 1: before its turn at most n minus 1 captains and n minus 1 first picks are allied, and a decline allies nobody. So rank 1 always captains alliance 1, and a team ranked 2k or lower (16 or lower at eight alliances) can never captain.

## What was built
- Core: `captainFacts { allianceOneCaptain, neverCaptain }` on the result, only when the ranking is fixed and the picks were drawn, read from the fixed finishing order captured once (no randomness consumed) and `draftedAllianceCount`.
- Web: `DistrictEventDistributions.captainFacts` forwarded; `DistrictSelectionRouteView.captainFact` ("allianceOne" or "never") via `selectionRouteViewFor`. `districtSelectionSettledRoute` returns captain, alliance 1 for the rank 1 team while the draft is drawn. `districtSelectionOutcomes` lists only the captain row for rank 1 and drops the captain row for a team ranked too low, keeping every other row.
- Copy: the district points page names the final ranking as a reason a row is left off and says the top ranked team reads captain of alliance 1 once qualification is over.

## Verification
- New core tests (5): presence with the shipped pmf at a fixed ranking; agreement with every draw; ranks 9 to 15 never in neverCaptain; the drafted count on a short roster (17 teams, 5 alliances, ranks 10 and lower); absence with no pmf, the degenerate pmf, announced alliances and matches remaining.
- Web tests: five new outcome tests; the Quals done DistrictLedger test now expects exactly one settled line, "~16captain, alliance 1"; a new drawer test lists only the captain row for rank 1.
- Full root suite `npx vitest run`: 378 files, 9,558 passed, 1 skipped, 0 failed. Typechecks root, apps/web, apps/web e2e: 0 errors.

## Commit
- db550587 feat: at Quals done the rank 1 team reads captain, alliance 1, and a team ranked too low to captain loses the Captain row

## Self-Check: PASSED
