# Quick Task 261009-txb: A sweep for the District Locks settled playoffs rule - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the gaps. do not leave anything undone." Quick task 261008-26o made the District Locks tab settle a knocked out alliance's playoff points as soon as its bracket placement is decided, and feeds that into the lock math (`settledPlayoffPoints`, `settledElimBounds`, read by `apps/web/src/components/districts/districtLedgerStatus.ts`). The two offline tenet sweeps (`scripts/measureLedgerTenets.ts`, `scripts/measureChampTenets.ts`) pass no bracket facts, so at the DISTRICT tier that rule has never been swept against history (item 2 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`). The Championship tier got its bracket sweep in 261009-2tr (`scripts/measureChampJointLocks.ts`). This task gives the district tier the same.

This is a measurement task. It adds a script, a test and a package.json line. It changes NO lock math. If the sweep finds a violation, that is a real defect in shipped code: stop and report it, do not loosen the check and do not fix the lock math inside this task.

</domain>

<decisions>
## Implementation Decisions

### D1. The sweep
- New `scripts/measureLedgerSettledTenets.ts`, corpus gated like `scripts/measureChampJointLocks.ts` (skip with a message when `data/corpus.sqlite` is absent), plus `measure:ledger-settled-tenets` in package.json.
- Over every district season of 2023 to 2026 with a published `dcmpSlots` (`data/local-publish/districts`), and every DISTRICT tier event of that season whose alliances and playoff matches are in the corpus.
- Stops per event, built on the District Locks tab's own timeline exactly as `measureLedgerTenets.ts` and `measureChampJointLocks.ts` build theirs: that event at "Alliances final", after Round 1 to Round 5, and "Playoffs final, awards open". Every other event sits where the timeline puts it at that position, with no bracket facts (the blunt rule, as today's sweep).
- At each stop the statuses are computed with the tab's OWN functions (`buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`), twice: once with no bracket facts (the blunt rule) and once with distributions that carry only that event's `playoffMilestoneByTeam`, built from the corpus alliances and the played rows up to that round by the same helpers the browser uses (`playedBracketMatchesFor`, the milestone builder). No Monte Carlo.
- Tenets, with the outcome rules `measureLedgerTenets.ts` already uses: (A) a team shown Locked on points at any stop is `locked` or `lockedAward` in the artifact's `districtLock.status` at Now; (B) a team shown Locked out is not qualified at Now. Also (C): no team Locked under the blunt rule loses its lock under the settled rule at the same stop.
- Exit 1 on any violation. Report per season: events swept, stops, Locked on points under the blunt rule, under the settled rule, the difference, Locked out under each, violations; and the events skipped with the reason (no alliances, a bracket that does not route, not an eight alliance bracket).

### D2. Test
- A small `scripts/measureLedgerSettledTenets.test.ts` (corpus gated for the real data part): the stop builder on a synthetic event; a pin on one real event of the committed PNW 2026 fixture district if its bracket is in the corpus; the script's `main` exits 0 on the real data.

### D3. Result handling
- Run it in this task and put the totals table in the SUMMARY. Zero violations is the acceptance bar.
- Todo: strike item 2 of `locks-settled-playoffs-follow-ups.md` as CLOSED by this task.

### Claude's Discretion
- Reuse of `bracketFromCorpus`, `dcmpStops` and the other exported helpers of `scripts/measureChampJointLocks.ts` (export what is needed rather than copying).

</decisions>

<specifics>
## Specific Ideas

- If quick task 261009-tx8 has landed, tied playoff matches route (the decided rows of a set are renumbered); the sweep simply uses whatever `bracket.ts` does at HEAD.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); typechecks root, web, e2e chained with `&&` and a sentinel echo. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `scripts/measureLedgerTenets.ts`, `scripts/measureChampJointLocks.ts` (helpers and shape), `apps/web/src/components/districts/districtLedgerRows.ts` (`settledPlayoffPoints`, `playedBracketMatchesFor`, `dcmpBracketMilestonesByTeam`), `districtLedgerStatus.ts`
- `.planning/quick/261008-26o-locks-a-team-knocked-out-of-the-playoffs/261008-26o-SUMMARY.md`
</canonical_refs>
