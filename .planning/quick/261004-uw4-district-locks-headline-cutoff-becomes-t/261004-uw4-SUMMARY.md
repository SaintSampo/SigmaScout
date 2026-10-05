---
phase: quick-261004-uw4
plan: 01
subsystem: web/districts
tags: [district-locks, predicted-cutoff, simulation, methodology]
status: complete
requires: [quick-260927-6bf, quick-260926-37q, quick-260925-uf8]
provides:
  - ledgerRangeState.ts, the one range state both Locks tabs read
  - District Locks headline as the median of the per run simulated line
affects: [DistrictLedger, ChampLocksLedger, methodology/district-points]
key-files:
  created:
    - apps/web/src/components/districts/ledgerRangeState.ts
    - apps/web/src/components/districts/ledgerRangeState.test.ts
  modified:
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/predictedCutoff.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/e2e/districts-ledger.spec.ts
decisions:
  - "District Locks headline is the median of the per run simulated line, with its 10 to 90 range from the same call; In range and Out of range cut at that number (Jacob, 2026-10-04)"
  - "A run that landed but excluded a team keeps the shipped midpoint rule (no range, chances still printed) rather than withholding the district (orchestrator amendment, protects 260925-uf8)"
  - "In flight is Pending, a failed run is not available with its reason; never a figure from fallback projections"
  - "No accuracy or coverage claim for the district line; backtest todo logged"
metrics:
  completed: 2026-10-04
  tasks: 3
  commits: 3
---

# Quick 261004-uw4: District Locks headline cutoff becomes the simulated line

The District Locks "Predicted cutoff" is now the median of the per run simulated line, with its likely
range from the same call, so the figure cannot sit outside the range printed beside it. Work was done
in the sibling worktree `SigmaScout-locks-fixes` (branch `locks-fixes`, based on origin/main) because
the main checkout carried another session's unpushed EPA work.

## Why

Measured on the live site, 22 rewound positions in four districts: the headline sat BELOW its own
likely range at 8 (PNW 6 of 6, e.g. "~56 · likely 59–64"), near the bottom at 14, never above. The
headline was the midpoint of the median projections at pool rank n and n+1; the range was the
percentiles of the n-th highest DRAWN total. In any run some teams under the line draw high and pass
it, so the realised line sits above the line through the medians.

## What changed

- `ledgerRangeState.ts` (new): one pure module for the range state, chip rule and cutoff view of both
  tabs. Champ names are aliases and delegations; the three champ suites pass byte identical.
- `simulatedChampLine` renamed `simulatedLine`; both tabs read it.
- The District tab's three way rule while something is open:
  1. run landed, no team excluded: simulated median, range, chips cut at that number;
  2. run landed, a team excluded: the shipped midpoint rule, no range, chances still printed;
  3. otherwise no figure: Pending in flight, not available with its reason on failure.
- final, absent, capacity unknown, and Locked / Locked out / Prequalified are untouched.
- A second chip definition set prints while the chips cut at the predicted cutoff.
- Methodology describes the rule and says its accuracy has not been measured; the 16.4 and 41.0
  figures are attributed to the Champ Locks tab by name.

## Commits (branch locks-fixes)

- 764b74fa fix(locks): rewinds of large districts simulate again; sponsored event names shorten
  (same session, separate fix: MAX_DISTRICT_SIMULATION_EVENTS 24 to 64 because 2026fim runs 27
  events and a week one rewind was refused whole, printing "Predicted cutoff ~0"; the short name
  template drops a "presented by <sponsor>" tail)
- 9efadf8e feat(261004-uw4): District Locks headline is the median of the simulated line
- 8cf8a1d2 test(261004-uw4): pending and refused arms on the District tab; chip definitions match the cut
- c1626f2a docs(261004-uw4): Methodology states the District Locks cutoff rule; comment sweep; live spec guard

## Verification

- Executor: `npx vitest run apps/web` 132 files, 2505 tests passed; root, web and e2e typechecks clean.
- Orchestrator, vite dev server from the worktree on live data: the same probe over PNW, FIM, NE and
  FMA, 24 positions: headline inside its range at 24 of 24 (before: 14 of 22, PNW 0 of 6).
  `2026miche:awards` reads "pending" then "~65 · likely 64–67" (before: "~0", every cell unavailable).
  Sponsored FIM names print short in the menu and the Event cell.
- Not yet run: the live e2e spec (after deploy).

## Noticed, not addressed

- Rewound to Michigan week one, team 2337 reads Locked with 0 points earned, and week five events
  print very tight predictions. The rewind may be reading end of season facts for verdicts or
  ratings. Worth its own investigation.
- District line accuracy unmeasured: `.planning/todos/pending/district-cutoff-line-backtest.md`.
