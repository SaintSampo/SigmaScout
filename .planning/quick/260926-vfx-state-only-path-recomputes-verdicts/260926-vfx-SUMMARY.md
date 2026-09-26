---
id: 260926-vfx
slug: state-only-path-recomputes-verdicts
kind: quick
status: complete
completed: 2026-09-26
subsystem: packages/harness
key-files:
  modified:
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - scripts/publishDistricts.ts
    - apps/worker/test/scheduled.district.test.ts
decisions:
  - "The verdict pass runs in BOTH producer entry points. A state observation can move a verdict without moving a point: a posted award releases its held back slot, and playoffs still ahead reopen the remaining pool."
  - "Worker tests seed their fixtures at the recompute's fixed point, as a published artifact already is, instead of trusting hand-written stub verdicts."
owed:
  - "Republish districts and confirm 2026pnw reads locked 42 / lockedAward 8 / eliminated 76 on the live origin."
---

# Quick task 260926-vfx: the state-only path recomputes verdicts

Dry run of the 2026 publish reads 2026pnw at locked 42 / lockedAward 8 / eliminated 76 (was
34/8/8/76 in the regressed generation). Harness, scripts and Worker suites: 93 files, 2,357 tests
green; root and Worker typechecks clean.
