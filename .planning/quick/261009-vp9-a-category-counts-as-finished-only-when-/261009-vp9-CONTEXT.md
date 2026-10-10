# Quick Task 261009-vp9: A category counts as finished only when its points are in - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning (plan against the code AFTER quick task 261009-tx6 has landed)

<domain>
## Task Boundary

Jacob's rule: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked." Jacob, 2026-10-09: "fix the gaps. do not leave anything undone."

Quick tasks 261009-r9x and 261009-tx6 closed the timing gap for AWARDS: the site no longer reads Awards as finished until the judged awards are listed, their points are in and the list has settled. The plan checker of 261009-tx6 (warning W1) pointed out that the SAME gap exists for the three earlier categories, on both Locks tabs and in the published verdicts:

- An event's state block (qualification matches played, alliances picked, playoffs done) is derived from MATCH results and moves within a minute.
- Each team's points per category come from TBA's district rankings, a different feed that can lag by minutes.
- `districtEventCategoryFinality` (`packages/core/districts/reservedSlots.ts`) reads the state alone. So for a few minutes after playoffs end, the Playoffs category reads final while the winner's points are not yet in any row: rivals lose their playoff ceiling before their points land, and a team can read Locked and then lose it when the points arrive.

History views are not affected: at a rewound stop the points are the season's final ones. This is a LIVE gap only.

Scope: a shared corroboration rule in `packages/core/districts`, its use at the live position in the browser's stage derivation for both Locks tabs and in the shared verdict pass (`packages/harness/districtRankingsMerge.ts`), tests including a staged replay, methodology, docs. No artifact schema change, no algorithm version change, no D1 migration. The Worker bundle changes (the verdict pass), so the orchestrator deploys the Worker after this task.

</domain>

<decisions>
## Implementation Decisions

### D1. The rule: a category is finished when the state says so AND the points that prove it are in the rows
For one event, reading the district artifact's own rows at that event (any team):
- **Awards** finished: `state.awardsPosted` (already the strong flag of 261009-r9x and 261009-tx6: a judged award listed, award points present, the list settled).
- **Playoffs** finished: Awards finished, OR `state.playoffsDone` AND some row at the event carries the WINNER's playoff value (`maxEventPoints(year, tier).elim`; for a divisioned championship's finals event the finals champion value, `maxFinalsPointsByPlacement`). A team shows the winner's value only after TBA has scored the deciding match.
- **Alliance selection** finished: Playoffs finished, OR `state.alliancesPicked` AND some row at the event carries alliance selection points above 0.
- **Qualification** finished: Alliance selection finished. TBA shows provisional qualification points during an event, so their presence proves nothing; the alliance points landing is the proof that qualification is over and scored. (Until then Qualification reads open at the live position even after the last qualification match.)
- An absent state block reads every category open, as today. An event with no qualification schedule of its own (a divisioned championship's finals event) keeps today's reading for the categories it does not have.
- The rule only ever makes a category read OPEN where today it reads final. It never closes one early.

### D2. Where it applies
- **The browser, at the LIVE position only**: wherever a row's stage at Now is derived from its state block (`deriveStageFromState` and the per event Now stage maps of both Locks tabs), the corroborated rule replaces the bare one, so the cells and the lock math agree (an uncorroborated category shows as open, not as a grey final number). A REWOUND position keeps its stage from the timeline, exactly as today.
- **The shared verdict pass**: the one helper call quick task 261009-tx6 (D8) reads category finality through, and the reservation readers (`reservedDistrictSlots`, the champ reservation) where they read `playoffsDone` or `awardsPosted`.
- The stage WORD an event row prints may follow the corroborated reading (it prints the earliest open category), which is honest: the points for the stage are not in yet.

### D3. Tests
- Unit: each line of D1; the cascade; an absent state; a finals event; the rule never closes a category the bare rule leaves open.
- STAGED REPLAY over all eight PNW 2026 district events (fixture `data/fixtures/phase10/district-2026pnw.json`, the list derived from the fixture and its count asserted), through the shared merge AND the browser's own status code computed at Now from each tick's artifact: qualification in progress; last qualification match played with the rankings not caught up; rankings catch up; alliances picked with alliance points not yet in; alliance points land; playoffs done with playoff points not yet in; playoff points land; then the award walk of 261009-tx6. Assert at every tick, for every team: (a) the PUBLISHED `districtLock` never reads `locked` or `lockedAward` and then something else later; (b) the District Locks status computed by `computeDistrictLedgerStatuses` never reads Locked and then not Locked later; (c) a category whose points are not in reads open. Run the same walk with the corroboration switched off inside the test to show it fails without it (so the test proves something).
- A Champ tier version of the walk on a synthetic single championship (the champ status code at Now).

### D4. Gates (history must not move)
- `npx tsx scripts/measureLedgerSettledTenets.ts` (zero A, B, C, D), `measureLedgerTenets.ts`, `measureChampTenets.ts`, `measureChampJointLocks.ts`: totals identical to a baseline taken before the first edit.
- The publisher whole artifact comparison prints the clean line.
- `measureChampCutoff.ts --check-history`: stop and report on drift.
- Full `npx vitest run`, four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo.
- At Now for every published season (finished events): every category that read final before still reads final (the award flag is true, so the cascade closes everything). Assert it over the local artifact set and report any event where a category now reads open, with the reason; if any finished event regresses, STOP and report.

### D5. Docs
- Methodology (`districtLedgerContent.ts`): one flat sentence, no dash characters: a category counts as finished once its points are posted. `docs/worker-operations.md`: a short paragraph. Module header comments.

### D6. The awards flag waits for the Impact award where the event gives one (orchestrator, 2026-10-10)
- The verifier of 261009-tx6 measured the settle time's limit: with the flag true on a list with no Impact award, an Impact listed later takes frc5920 from held to eliminated at 2026wasam and 2026wasno, and at 2026pncmp a late Impact, Engineering Inspiration or Rookie All Star takes frc9450 and frc3674 from held to contending.
- Live rule, for an event that gives an Impact award (every district tier event and every dcmp tier event that is not a division): the flag turns true only when a judged award is listed, award points are present, the Impact award is listed, and the list has been unchanged for 60 minutes. With no Impact listed the flag waits until the list has been unchanged for 12 hours (12 district events since 2022 list judged awards and no Impact). A division keeps the 60 minute rule. Hindsight is unchanged.
- Tests: the measured late award cases as replay variants; a no Impact event at 12 hours; a division at 60 minutes. Docs and the methodology row say it plainly.

### D7. Decisions after the planner's prototype (orchestrator, 2026-10-10)
- **D6 extended:** at a dcmp tier event that is not a division the flag waits for EVERY consuming award the event gives (Impact, Winner, Engineering Inspiration, Rookie All Star). Prototype: a late Engineering Inspiration or Rookie All Star still lost two held places under the Impact only rule and loses none under this one.
- **Winner hold:** the four winner places are released only when Playoffs are final AND a Winner is recorded at that championship.
- **D2 is REVISED: two readings, never mixed.** What has happened on the field (state only) drives the simulation run, the published alliances and played bracket it conditions on, the bracket facts, the timeline and the rail. Whether a category's number is FINAL (the live reading: state plus the proving points) drives which cells are grey and everything the lock math reads. Nothing live goes dark while points lag; only finality waits. The joint proof's eligibility reads the live stage.
- **Not verified:** whether TBA posts points during an event. Both cases are stated in the header and the SUMMARY.
- **Prototype:** the staged walk on the eight PNW events takes a lock back 32 times today (published and on the District tab) and 0 times with the rule; zero finished events regress at Now; the four history sweeps do not move.
- **Stated limits (no todo):** a second recipient of an already listed award arriving more than an hour after the list last changed; an expected award first listed after 12 unchanged hours.

### D8. Binding addenda after the plan check (orchestrator, 2026-10-10; the plan text does not carry these, the executor applies them)
- **History gates in every task that touches the row builder (Tasks 1 and 3), not only the last:** run the four sweeps and diff them against the Step 0 baselines in those tasks' verify steps; stop before committing if any line moves.
- **The 12 hour path through the catch up is tested (Task 2):** a catch up event whose awards cursor row is 12 hours old and whose list lacks an expected award turns its flag true; the same with a row 11 hours 59 minutes old does not.
- **A championship goes through the real tick (Task 2):** at least one dcmp tier tick test (a championship with the 12 hour set) exercises the Worker's kind derivation and pass through. If the tick harness truly cannot carry a dcmp tier event, say exactly why in the SUMMARY.
- **The presence memo is safe (Task 1):** one test calls the finality reader on a teams array, then on a NEW array with a winner row added or removed, and gets the right answer both times; the module comment states that team arrays are treated as immutable.
- **Copy:** the methodology Limits cell names the awards instead of "them"; the Task 3 truth reads "settles at its placement, not exact".
- **Release note for the orchestrator:** deploy the Worker only when no district or championship event sits between playoffs done and awards posted (the first tick under the new rule can raise rivals' ceilings at such an event).

### Claude's Discretion
- The helper's name and file; how the presence facts are computed once per artifact and passed (a per event map).
- If a step is ambiguous take the side that reads a category OPEN and record the reading.

</decisions>

<specifics>
## Specific Ideas

- Today's rule: `districtEventCategoryFinality` (`packages/core/districts/reservedSlots.ts` ~166): `award = awardsPosted; elim = playoffsDone || award; alliance = alliancesPicked || elim; qual = (total !== null && played === total) || alliance`.
- `deriveStageFromState` has about 23 call sites outside tests (both tabs, the sweeps, the milestone picker). The sweeps must keep their history behaviour; they may keep calling the bare rule for rewound stops.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`). Never Read, cat or echo `.env`. The executor has no network and must not push or deploy.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/reservedSlots.ts`, `pointModel.ts`; `packages/harness/districtRankingsMerge.ts`; `apps/web/src/components/districts/districtLedgerRows.ts` (`deriveStageFromState`), `districtLedgerStatus.ts`, `champLedgerStatus.ts`, `DistrictLedger.tsx`, `ChampLocksLedger.tsx`
- `.planning/quick/261009-tx6-worker-awards-watch-settle-time-day-long/` (PLAN D8 and the replay harness; the plan checker's W1)
- `.planning/quick/261009-r9x-awards-posted-flag-waits-for-a-judged-aw/261009-r9x-SUMMARY.md`
</canonical_refs>
