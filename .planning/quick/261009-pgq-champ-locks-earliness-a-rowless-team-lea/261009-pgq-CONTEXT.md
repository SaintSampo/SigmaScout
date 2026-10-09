# Quick Task 261009-pgq: Champ Locks earliness, rowless teams and the judged budget - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the first two now", the two earliness items left by quick task 261009-kt3 (follow ups 15 and 9 in `.planning/todos/pending/champ-joint-lock-follow-ups.md`):

1. A team with no championship row keeps the whole hypothetical DCMP ceiling (249 in 2026) until EVERY dcmp tier key has started, the finals event included. At a divisioned championship the finals start days after the divisions, so at "Divisions final, finals not started" eight NE teams and four FIM teams with no row still carried 249 points of threat. It cost the NE pin 5 locks and the FIM pin 4.
2. The divisioned proof's judged award budget is 14 times the division count at every stop, even once a division's awards have posted. Counting only divisions whose Awards are still open measured 2,511 lock stops against 2,176 in the planner's prototype.

Soundness first, as before: the corpus sweep (`npx tsx scripts/measureChampJointLocks.ts`, 48 championships, 412 stops) must stay at zero violations and zero skipped; the older tenet sweep must stay green.

</domain>

<decisions>
## Implementation Decisions

### D1. The field is fixed once every DIVISION has started (item 1)
- `dcmpStartedForTeam` (`apps/web/src/components/districts/champLedgerRows.ts` ~408) decides when a team with no dcmp tier source leaves the field. Today it requires every dcmp key to have started. Change: it requires every FIELD FIXING key to have started, where the field fixing keys are the dcmp keys minus any divisioned championship's parent (finals) key: a key K is a parent when some other dcmp key equals K plus a digit. Single and multiple shapes are unchanged (every key is field fixing). A team with its own dcmp source is unchanged (its own key).
- Everything downstream follows: `champFieldMembership` reads `out`, the status module's pre registration branch (`champLedgerStatus.ts` ~560, `membership !== "out" && dcmpEntry === undefined`) adds no hypothetical DCMP ceiling, the table hides the team at the DCMP as today.
- **Soundness, measured.** The only teams this could misjudge are teams REGISTERED at a division or single DCMP that earned no points there (judging only or no show), which the artifact at Now cannot tell from unregistered teams. Corpus, 2023 to 2026, every single and division DCMP event: 18 such teams, every one `eliminated` at Now, and every one at least 113 points below its district's cut line (gaps 113 to 217; totals 0 to 56), so a 45 point award could never have carried one past a locked team. Their one remaining way to take a slot, a consuming award, is covered by D2. Record this measurement in the module comment and in the SUMMARY.

### D2. WITHDRAWN (orchestrator, 2026-10-09, after the planner's pool check)
- D2 proposed adding `max(0, consumingAwards - uncovered)` to the bound for award winners outside the pool. Its premise was false: every unqualified artifact team, a team with no championship row included, is already a rival in the joint proof's pool (`orderedKeys` takes every `rows.teams` entry; measured at "Divisions final, finals not started": 2026 NE 98 of 98 rowless teams in the pool, 2026 FIM 368 of 369, the one missing being award qualified). A consuming award to such a team is therefore already counted inside the `min`. No core change is made. `packages/core/districts/champJointLock.ts` is NOT edited by this task.
- What guards D1 instead: a test in `champLedgerStatus.test.ts` asserting that a team with no dcmp source, read as `out`, is present in `jointProof.input.pool` (with extra 0) and is coverable by a consuming award; and the regression gate that every SINGLE EVENT and CALIFORNIA bound and locked set is byte identical to before this task (the planner's `dumpSingle.mts` dump), since D1 and D3 touch only the divisioned shape.
- Pins: FNC and CA must not move at all. FIM and NE may gain members through D1 and D3; report as executed, never fit, and confirm every member is `locked` or `lockedAward` at Now and nobody who missed is in a set.

### D3. The judged budget counts only divisions whose Awards are open (item 2)
- In `divisionedJointProof` (`champLedgerStatus.ts` ~1069) `judgedAwards` becomes `dcmpJudgedAwardCeiling()` times the number of division keys whose stage at the position has `award` false. Zero once every division's awards are posted (the finals event gives no judged awards; measured in 261009-kt3 RESEARCH section 3). Sound because posted judged points are already in every floor and a division with final awards cannot give another.
- Single and multiple shapes keep K = 14 per championship (their awards are open whenever the proof runs).
- Unit test in `champLedgerStatus.test.ts`: two divisions, one with awards posted, `jointProof.input.judgedAwards` equals 14; both posted, 0; neither, 28.

### D4. Sweep, pins, docs
- Run the full sweep; zero violations and zero skipped stay the gate. Put the per shape totals and the pin sets as executed in the SUMMARY, with the list of every changed single event bound from D2.
- Close follow ups 9 and 15 in the todo (strike through, "CLOSED by quick 261009-pgq"), and add the D1 measurement as a note under item 15.
- Methodology copy: no change unless a sentence now reads false; if one does, fix it in the flat voice with no dash characters.

### Claude's Discretion
- Where the field fixing key rule lives (a small exported helper beside `dcmpStartedForTeam`, reused by `champTeamHiddenAtDcmp` if that reads the same rule).
- Test placement for D1: `champLedgerRows.test.ts` (a divisioned district whose divisions started and finals not: a rowless team is `out`; a single district: unchanged).

</decisions>

<specifics>
## Specific Ideas

- Sweep and gates: `npx tsx scripts/measureChampJointLocks.ts`, `npx tsx scripts/measureChampTenets.ts`, `npx tsx scripts/measureChampCutoff.ts --check-history`; tests with `npx vitest run <paths>` from the repo root, never `timeout <n> pnpm`; three typechecks chained with `&&` ending in a `TYPECHECKS CLEAN` echo. Never Read, cat or echo `.env`.
- Current single subtotal: 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0. Divisioned: 16 / 156 / 140 / 1,539 / 810 / 2,349 / 0. CA: 1 / 8 / 7 / 41 / 62 / 103 / 0. Pins as executed in 261009-kt3 SUMMARY: FIM Divisions final 50, FIM Finals decided 63, NE Divisions final 12, NE Finals decided 15, CA Round 5 15, CA Playoffs final 19, FNC Round 5 the five teams.
- The measurement script for D1 is `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/noRow2.cjs` (reads `event_teams` against the district artifacts).

</specifics>

<canonical_refs>
## Canonical References

- Quick tasks 261009-2tr and 261009-kt3 (CONTEXT, SUMMARY, VERIFICATION) and their follow ups todo
- `packages/core/districts/champJointLock.ts` (`jointLockBoundAt` total at ~657 and ~677, the cover upper bound), `apps/web/src/components/districts/champLedgerRows.ts` (`dcmpStartedForTeam`, `champFieldMembership`, `champTeamHiddenAtDcmp`), `champLedgerStatus.ts` (`divisionedJointProof`, the pre registration branch)
</canonical_refs>
