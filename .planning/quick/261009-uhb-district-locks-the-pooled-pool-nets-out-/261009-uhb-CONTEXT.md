# Quick Task 261009-uhb: The pooled pool nets out settled playoff points - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob's rule, 2026-10-08: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked."

The planner of quick task 261009-txb prototyped a District Locks sweep with real bracket facts and found that rule broken on the District Locks tab at rewound stops: 41 team stops over 21 district events of 2023 to 2026 where a team reads Locked at "Alliances final" (or an early round), In range at Round 4 or Round 5, and Locked again at "Playoffs final". Example: 2026cthar frc2067, Locked through Round 3, In range at Rounds 4 and 5, Locked again at Playoffs final. Every one of those teams did qualify, so no lock was false, but a shown lock was withdrawn.

Cause, confirmed in code. Quick task 261008-26o settles a knocked out alliance's playoff points as soon as its bracket placement is decided, and an EXACT settled value joins the team's FLOOR (`settledElimBounds`, `apps/web/src/components/districts/districtLedgerRows.ts`). The pooled remaining points lock (`packages/core/districts/locks.ts` `pooledLockTest`, fed by `packages/core/districts/pooledLockInputs.ts` and `pointPool.ts` `eventRemainingPool`) still counts that event's WHOLE playoff pool (`PLAYOFF_POOL`) as not yet handed out, because the event's Playoffs category is still open. The same points sit in rivals' floors and in the pool. The pooled test gets harder to pass exactly when information arrives.

All 41 are teams Locked by the pooled argument alone. The Champ Locks tab passes no pooled argument and shows zero take backs over all 48 championships and 412 stops (orchestrator's check, 2026-10-09).

Scope: `packages/core/districts/pooledLockInputs.ts` (and `pointPool.ts` if the subtraction lives there), `apps/web/src/components/districts/districtLedgerStatus.ts`, their tests. The publisher and the Worker call `pooledLockInputs` with no bracket facts and must behave exactly as today.

</domain>

<decisions>
## Implementation Decisions

### D1. The event's remaining pool is reduced by the playoff points already counted in floors
- `pooledLockInputs` takes, per event, an optional amount: the playoff points that event has ALREADY handed out and that are counted in team floors at the position. The event's remaining pool is its `eventRemainingPool` minus that amount, never below 0. Absent (every caller today): nothing is subtracted and every result is byte identical.
- The browser (`computeDistrictLedgerStatuses`) supplies it: for each district tier event whose Playoffs category is open at the position, the sum over every team row at that event of the settled playoff points that `settledElimBounds` puts in a FLOOR (the `exact` ones). A settled value that is not exact joins only a ceiling, is in no floor, and nets nothing.
- Soundness, to state in the module header: `PLAYOFF_POOL` is an upper bound on ALL the playoff points an event hands out (the measured maximum, `pointPool.ts`). The total is what has been handed out plus what remains, so what remains is at most the pool minus what has been handed out. Points handed to teams outside the district are not known and are not subtracted, which only leaves the pool larger (the conservative side).
- Why this restores "no take back": each rival's cost in the pooled test falls by at most the points it banked, and the pool falls by the sum of all points banked, so a pooled lock that held before the points were banked still holds after.

### D2. Tests
- Unit (core): an event with Playoffs open and 60 points banked has its pool reduced by 60; never below 0; absent input is byte identical to today (the existing tests pass untouched).
- Unit (status): a three or four team synthetic district where a team is pooled locked at "Alliances final", a rival's alliance is then decided with exact points in its floor, and the team is STILL pooled locked (it is not today). Pin the before behaviour in a comment, not as a passing test.
- The 2026cthar frc2067 sequence as a corpus gated pin if the local artifact and corpus are present: Locked at every stop from Alliances final to Playoffs final.

### D3. Gates
- If quick task 261009-txb's sweep exists at HEAD (`scripts/measureLedgerSettledTenets.ts`): run it; tenets A, B, C and D (no take back across an event's stops) must all read zero. If it does not exist yet, use the planner prototype `txbProto.mts` in the session scratchpad for C, and say so.
- `npx tsx scripts/measureLedgerTenets.ts` (tenet A 0, tenet B 0), `measureChampTenets.ts`, `measureChampJointLocks.ts` (zero violations, unchanged totals: the champ tier passes no pooled argument).
- The publisher's whole artifact before and after comparison prints the clean line (the published verdicts pass no settled points, so nothing may change): the scratch `r9x-compare.mjs` over `publishDistricts.ts --dry-run --no-bake --local-out`.
- `measureChampCutoff.ts --check-history`: stop and report on drift.
- Full `npx vitest run`, three typechecks chained with `&&` and a sentinel echo.

### D4. Docs
- Methodology (`districtLedgerContent.ts`): only if a sentence now reads false. The pooled paragraph says Locked tests the points still available to rivals; that stays true.
- Todo: note under item 2 of `locks-settled-playoffs-follow-ups.md` that the sweep found this and this task fixed it.

### Claude's Discretion
- The name and shape of the new optional input; whether the subtraction is in `pooledLockInputs` or `eventRemainingPool`.
- If a step is ambiguous take the side that leaves the pool LARGER and record the reading.

</decisions>

<specifics>
## Specific Ideas

- `pooledLockInputs` has three callers: the browser's District Locks status, the offline publisher and the live Worker through the shared verdict pass (`packages/harness/districtRankingsMerge.ts`). Only the browser has bracket facts.
- Every settled value at a rewound stop over a finished event is exact (TBA's own number); at a live event it is not exact and joins no floor, so this defect and this fix both act on history views.
- Planner prototypes in the session scratchpad: `txbProto.mts` (the sweep, `--allviol` lists every row), `txbDetail.mts` (one event stop by stop).
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`). Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/locks.ts` (`pooledLockTest`), `pooledLockInputs.ts`, `pointPool.ts`; `apps/web/src/components/districts/districtLedgerStatus.ts` (the pooled entries, ~387 to 450), `districtLedgerRows.ts` (`settledPlayoffPoints`, `settledElimBounds`)
- `.planning/quick/261008-26o-locks-a-team-knocked-out-of-the-playoffs/261008-26o-SUMMARY.md`, `.planning/quick/261009-txb-district-locks-settled-playoffs-sweep-wi/261009-txb-PLAN.md` (planner findings)
</canonical_refs>
