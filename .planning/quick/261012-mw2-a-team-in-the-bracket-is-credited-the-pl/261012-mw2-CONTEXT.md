# Quick Task 261012-mw2: A team in the bracket is credited the playoff points it has already secured from the matches it has played - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning (plan against HEAD 9a6c9fae, pushed and live)

<domain>
## Task Boundary

Jacob, 2026-10-12, looking at the live Champ Locks tab: "In FNC 2026 DCMP round 5 why is 4561 not locked, even though they have more points than 3506 and 2724 who are locked?" After the answer: "yea, any team in the bracket should be credited with the points that they essentially have already earned, given the matches they have played."

Standing rules of this work (Jacob, 2026-10-08): "it is mission critical that no team is told they are locked at any stop, and then later they are not locked. but also once a team is locked, we should know it as soon as we can."

### What happened at 2026 FNC, Round 5 (measured 2026-10-12, 15 slots)

| Team | "earned" in the page header | Floor the lock math counts | Joint bound | Status |
| --- | --- | --- | --- | --- |
| frc2724 (alliance 4, out in third) | 221 | 260 (its settled 39 is in the floor, not in the header) | 12 | Locked |
| frc3506 (alliance 3, out, paid 0) | 243 | 243 | 14 | Locked |
| frc4561 (alliance 2, a FINALIST) | 232 | 232 (no playoff point counted) | 16 | In range |

A finalist cannot finish below second place (60 at a DCMP), yet the lock math counts nothing for its playoffs until its alliance is knocked out or the playoffs are final. Being knocked out raises a floor; staying in does not. frc4561's alliance then won (it was paid 90). The reason the credit is held back: TBA pays a robot LESS than its alliance's placement value when it sat out matches (that weekend frc7763, on the same winning alliance, was paid 72 of 90; 2026pncmp frc3663 was paid 12 of 21), so "at least the placement value" is not guaranteed for every member.

Two defects follow, one of earliness and one of display:
1. A team whose alliance is still in the bracket gets no credit for what it has secured.
2. The header's "earned" leaves out settled playoff points the lock math counts, so the page and the lock disagree (2724 looked 11 behind 4561 and was 28 ahead).

Scope: `packages/core/districts` (the pay rule and the secured minimum), `apps/web/src/components/districts` (rows, both status modules, the joint proof's floors, the header and the Playoffs cell), tests, the sweeps' pins, methodology. No artifact schema change, no algorithm version change, no Worker change (the published verdicts keep their simpler rule; if any file the Worker bundles must change in code, STOP and report).

</domain>

<decisions>
## Implementation Decisions

### D1. Learn TBA's pay rule from the data before anything else
- For every district tier and dcmp tier event of 2023 to 2026 with a bracket in the corpus: each team's played playoff rows (which matches it was on the field for, from the match rosters), its alliance's played rows, placement and Finals wins, against the `elim` points TBA paid it. Find the exact rule, rounding included (the two known cases fit "placement value times matches the team played over matches its alliance played": 72 of 90 as four of five, 12 of 21 as four of seven, but that is a guess to test, not a premise). Check both tiers (the dcmp tier is three times the district tier: is the weight applied before or after the rounding?), a divisioned championship's divisions and its finals event, a tied or replayed match, a surrogate or disqualified team, a red carded match, a backup that joined late, and a listed pick that never played.
- Report the fit as a table: teams compared, exactly equal, formula ABOVE what TBA paid (the dangerous side), formula below. Name every exception with its cause. The manual's wording and TBA's public source may be read to form the candidate, but the data decides.

### D2. The secured minimum
- For a team T at a position (live or rewound), from the alliance lists and the played rows at or before that position ONLY: the SECURED MINIMUM is the least playoff points T can end the event with over every legal way the rest of the bracket can go, in which T plays no further match, its alliance plays as many further matches as the bracket allows (replays and Finals overtime included: find the real caps in the manual and the data and say what you used), and its alliance finishes at the worst placement still open to it.
- It must be a PROVEN LOWER BOUND on what TBA pays: where the rule of D1 has any uncertainty (rounding, ties, exceptions), take the smaller value. Over the whole corpus, at EVERY bracket position of every event, the secured minimum of every team is at or below the `elim` TBA finally paid it. One team above is a failed gate: STOP and report it, do not exclude it quietly. If a class of exception cannot be bounded (a team removed from an event, for instance), say what it is, how often it has happened, and what the safe reading is; if no safe reading exists, STOP.
- It never decreases as rows are played (a minimum over fewer futures). Test that.
- A team already knocked out gets the same treatment: its secured minimum is what the rule pays it for the decided placement and the matches it played. Where TBA's own final number is in hand (a rewound stop over a finished event, or live once the Playoffs number is final) that number is used as today.

### D3. Where it counts
- The secured minimum joins the FLOOR of the team's Playoffs category wherever that category is open at the position, on BOTH Locks tabs (district tier events and championship rows), in the ceiling test, the pooled test and the joint proof (T's own floor and every rival's floor; ceilings do not move, so a rival's extra shrinks by the same amount). The settled ceiling rules stay as they are.
- This is a deliberate, bounded use of the FIELD in the lock math (quick task 261009-vp9 keeps field and number apart): the credit is read from played rows, which are in hand a minute after a match, and it rests on the measured pay rule, not on posted points. State that in the headers. When TBA's number lands it replaces the credit; D2's corpus gate is what makes that step never lower a floor.
- The published verdicts (the Worker's merge) are NOT changed.

### D4. The page says what the lock counts
- The header's "earned" equals the floor the lock math counts for that team at that position, on both tabs: settled playoff points and the secured minimum included. The grand total's low end is never below it.
- The Playoffs cell of a team still in the bracket keeps its blue chance display and gains the secured minimum in its small line when it is above zero: `at least N · pays <values>` (the existing `pays` text unchanged after it). A knocked out team's cell is unchanged (grey, its value, `up to N` where not exact, since quick task 261010-66y). No percentage prints 100; no tilde on a percentage; class lists with a text role class are plain strings, never through `cn()`. Load `Skill("sketch-findings-sigmascout")` before touching the UI.
- Methodology (`districtLedgerContent.ts`): one or two flat sentences, no dash characters: a team still playing in the playoffs is credited the points it has already secured from the matches it has played; how TBA pays a robot that sat out.

### D5. Tests and gates
- The pay rule and the secured minimum: unit tests on hand built brackets (a finalist that played every match; one that sat out; a backup; a lower bracket survivor; a tie and a replay; Finals overtime), and the corpus gate of D2 as a local data gated test (`REQUIRE_LOCAL_DATA=1`), with the fit table of D1 pinned.
- The pinned example: at 2026 FNC "Round 5" frc4561 is Locked, and frc2724, frc3506, frc4795, frc9496 and frc9032 stay Locked.
- History may only GAIN locks: the four sweeps with zero violations and `SKIPPED (0)`; every moved row reported; per stop no lock lost; `orch_takeback.mts` reads `take-backs 0`; pins replaced with executed values, never fitted. `measureChampCutoff.ts --check-history`: stop and report on drift.
- The monotone tests of quick tasks 261010-d7r and 261010-l0s (`scripts/champJointMonotone.test.ts`, `champFieldStagedWalk.test.ts`, `districtLocksStagedReplay.test.ts`) stay at 0 Locked lost, 0 margin drops and 0 bounds higher with the rules on, and gain one assertion: no team's floor drops over any walked edge, the edge where TBA's playoff number lands included. Run the walks with the credit switched off inside the test and report the locks gained by it, so the test is shown to bite.
- The core soundness tests (exhaustive, sampled, the brute forces) pass unchanged: the proof's bound is not changed by this task, only the floors it is handed.
- Full `npx vitest run`; four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo; `WORKER BUNDLE UNTOUCHED` from the closure tool of quick task 261010-d7r.

### D6. Decisions after the planner's measurements (orchestrator, 2026-10-12; BINDING, they override D1 to D5 and the Task Boundary's guess where they differ)
- **The pay rule is by WINS, not by matches played.** The guess in D1 ("placement value times matches played over alliance matches") is wrong and reads above TBA at 156 robots. The measured rule (TBA's public source, fitted exactly to 11,991 team values over 507 events of 2023 to 2026, 0 above, 0 below): only decisive semifinal and Finals rows count; each semifinal win pays the alliance a fixed amount by its set (sf7 and sf8 13; sf9, sf10, sf11 and sf13 7; sf12 6; sf1 to sf6 0; a four alliance finals sf3 and sf5 10); since 2024 a robot gets the rounded up share of those points for the semifinal wins it was on the field for, plus 5 per Finals win it was on the field for if its alliance won the Finals, then the tier weight; 2023 has its own form. Declared per season; a bracket season registered without a declared rule fails a unit test, and the header tells whoever registers a season to check that season's manual first.
- **The secured minimum** is the least the rule can pay over every way the rest of the bracket can go with the robot on the field for no further win. No caps on further matches are needed (matches played do not enter the rule). Corpus gate: 222,863 team positions, 0 above the final payment, 0 drops.
- **Where it counts, as the planner found:** the ceiling test, the pooled test and the header on both tabs read it for every team; the JOINT PROOF is handed it for T and for confirmed picks, and NOT for a pick with no alliance selection points at the key (handing it there raised 12 bounds on the 2023 PNW live walk); no credit at a divisioned championship's finals event; no credit for a backup no alliance list names.
- **D3's sentence "when TBA's number lands it replaces the credit" is WITHDRAWN.** Where a team's Playoffs category reads final, its Playoffs floor is the LARGER of TBA's posted number and the secured credit. The credit already claims TBA will pay at least that much, so this adds no assumption and makes the lock math independent of when the playoff points post once a bracket is finished. If the planner's measurement shows it makes any rules on reading worse, the plan keeps the replacement and says so.
- **The printed totals are clamped** (display only): a printed low end or median is never below the "earned" figure beside it.
- **The live re run flicker is in scope:** if the joint proof's bracket facts drop for the seconds of each live re run, joint only locks are shown and withdrawn on every refresh. Reproduce, fix, test.
- **The methodology says "wins".** The header's identity on the District Locks tab is header plus the rookie bonus and adjustments (the header has never counted those two).
- **Three executor runs:** A lock math, B walks, C page and hook.
- The rule's source is stated honestly everywhere it is cited: read from TBA's public source and fitted to four seasons, not something this code controls. If TBA changes a decisive row after posting it, a credit can fall; that is a stated limit.

### D7. Binding addenda after the plan revision and the plan check (orchestrator, 2026-10-12; the plan text may not carry all of these, the executor applies them)
- **Accepted from the revised plan:** the larger of the two (the forced awards flag reading goes from 28 lost to 0; the paid pick rule reads the larger of the two as well); the print clamp as its own task (Task 6 stays in; it holds a printed low end or median at what the lock math counts); the flicker fix by attaching the facts of a run REQUEST before its run lands (Task 7, failing hook level test first). Four executor runs: A Tasks 1 to 3, B Task 4, C Tasks 5 and 6, D Task 7. Stated limit, no todo: the larger of the two applies only where the browser has the event's played rows (every rewound stop; at Now every loaded event artifact); a district event or single championship whose awards flag is already true reads TBA's number alone.
- **Run in the main checkout, no worktree** (the corpus, `data/local-publish`, the fixtures and the installers' absolute paths need it). Every `npx` from the repo root; download nothing.
- **Long commands run in the background with a log**, then the printed `Test Files` and `Tests` lines are read; never judge by exit code alone. A full root suite also runs at the END OF TASK 2, not only from Task 3 on. Run nothing beside a verify step (one existing test, `DistrictLedger.test.tsx` "posts the advancement chance to a SECOND Worker", is load sensitive).
- **The corpus gate must not skip a new season (Task 1).** `scripts/securedPlayoffCorpus.test.ts` takes its seasons from `BRACKET_REGISTERED_SEASONS`, with no hard coded upper year. Under `REQUIRE_LOCAL_DATA=1` every registered season that has at least one finished bracket with paid values in the corpus must have at least one compared event (a registered season with none in the corpus is printed by name, not failed). The module header says a new season's declared rule must pass this gate on that season's first finished events before the credit can be trusted for it.
- **The header states the residual risk in plain words:** a Locked that rests on the credit could be withdrawn if a playoff result is corrected after it was posted.
- **No tier entry, no credit (Task 7).** Where the request facts are attached, an event artifact with no tier entry gets NO credit (not a district tier credit by default), with a test.
- **Tasks 5 and 6 are written from prose, with no reference diff:** after writing them, re read the diff of `openCellLines` and the print rule and check by test that `at least N` prints only above zero, no printed percentage reads 100, no tilde sits on a percentage, and no dash character is in the new copy.

### Claude's Discretion
- Names and placement; how the played rosters reach the status code (the event artifact's played rows already carry each side's teams).
- If a step is ambiguous take the side with the SMALLER credit and record the reading.
- No new todo items: readings and limits go in headers and the SUMMARY.

</decisions>

<specifics>
## Specific Ideas

- Today's code: `settledPlayoffPoints` and `settledElimBounds` (`apps/web/src/components/districts/districtLedgerRows.ts` ~1645 and ~1706: an exact value joins the floor, a value off the placement table joins only the ceiling); `playedBracketMatchesFor` (the played rows with `redTeams` and `blueTeams`); the floor loops in `districtLedgerStatus.ts` and `champLedgerStatus.ts` (~530 to 600); `poolRivals` and the proof inputs in `champLedgerStatus.ts`; the header's earned figure and `LedgerCell` in `LedgerParts.tsx`; `districtLedgerCopy.ts`.
- Bracket shape (2023 on): eight alliances, double elimination, Rounds 1 to 5 then a best of three Finals; placement base values 20 (first and second), 13, 7, and 5 for each Finals win of the winner (30); times 3 at the dcmp tier. Quick task 261009-tx8 measured that TBA pays a losing finalist the base value (329 of 329) and found 11 finalist rows below it (prorations).
- Gate tooling from the earlier tasks is in the session scratchpad `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad` (`d7r/gates.sh`, `66y/gates_compare.sh`, `d7r/worker_closure.mjs`, `orch_takeback.mts`, `l0s/exec/after-final` as the reading at HEAD's code; `fnc_q.mts` prints the FNC Round 5 table above).
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); run every `npx` from the repo root and download nothing. Never Read, cat or echo `.env`. The executor must not push or deploy. Long content goes through the Write tool, never a Bash heredoc.

</specifics>

<canonical_refs>
## Canonical References

- `apps/web/src/components/districts/districtLedgerRows.ts`, `districtLedgerStatus.ts`, `champLedgerStatus.ts`, `champLedgerRows.ts`, `LedgerParts.tsx`, `districtLedgerCopy.ts`, `ledgerVerdict.ts`
- `packages/core/districts/bracket.ts` (`maxPlayoffPointsByPlacement`, the routing), `finalsBracket.ts`, `pointModel.ts`, `champJointLock.ts`
- `scripts/measureChampJointLocks.ts`, `measureLedgerSettledTenets.ts`, `scripts/champJointMonotone.test.ts`, `champFieldStagedWalk.test.ts`, `districtLocksStagedReplay.test.ts`
- `.planning/quick/261008-26o-*` and `261009-tx8-*` (the settled playoffs work and the finalist measurement), `.planning/quick/261009-vp9-*` (field and number), `.planning/quick/261010-l0s-*/261010-l0s-SUMMARY.md` (the gates)
</canonical_refs>
