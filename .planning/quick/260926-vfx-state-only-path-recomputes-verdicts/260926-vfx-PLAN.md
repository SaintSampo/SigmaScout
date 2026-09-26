---
id: 260926-vfx
slug: state-only-path-recomputes-verdicts
kind: quick
mode: inline
created: 2026-09-26
description: "applyDistrictEventState recomputes verdicts with the state attached, so the publisher no longer ships every finished event as a pending Impact award"
files_modified:
  - packages/harness/districtRankingsMerge.ts
  - packages/harness/districtRankingsMerge.test.ts
  - scripts/publishDistricts.ts
  - apps/worker/test/scheduled.district.test.ts
autonomous: true
---

# Quick task 260926-vfx: the state-only path recomputes verdicts

The district republish at generation 2026-09-26T03:18:01Z demoted eight Locked PNW teams to
contending (census 34/8/8/76 against the previous generation's 42/8/0/76). The publisher computes
its verdicts on state-free rows, then attaches the per-event state blocks through
`applyDistrictEventState`, which left the verdicts as found. The Locked test holds one slot back
per event whose Impact award is pending, and a missing state block counts as pending, so every
finished season shipped with all eight events read as pending: eight held back slots.

Fix: `applyDistrictEventState` ends with `recomputeDistrictVerdicts`, exactly as
`applyDistrictRankings` does, and takes an optional `tierByEvent` the publisher forwards. Three
tests that pinned "a state observation never moves a verdict" now pin the recompute's fixed point;
one of them shows the observation is not inert (playoffs and awards still ahead loosen a lock).
A regression test proves a posted award releases its slot through the state-only path.

Executed inline.
