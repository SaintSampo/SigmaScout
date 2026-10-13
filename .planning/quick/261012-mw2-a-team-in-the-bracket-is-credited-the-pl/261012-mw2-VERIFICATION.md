---
phase: quick-261012-mw2
verified: 2026-10-13T15:50:00-04:00
status: passed
head: b1fc2566 (main, seven commits ahead of 9a6c9fae, none pushed)
score: 10/10 checks verified; 0 blocking gaps; 4 warnings (all stated limits or pre-existing, none a soundness failure)
behavior_unverified: 0
re_verification: no
---

# Quick task 261012-mw2 verification: a team in the bracket is credited the playoff points it has secured

Verifier stance: the SUMMARY was not trusted. Every number below was produced by a run in this session or read from code at HEAD b1fc2566. No repo file was edited, nothing committed, no network, no `.env` read. Scratch programs live in `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/mw2-verify/` (`lower_bound.mts`, `reader_bound.mts`, `real_events.mts`, logs, and the gate output in `final/`).

## Verdict: PASSED (no blocking gap)

A floor that is too high is the failure that matters. I tried to break the secured minimum three independent ways (own bracket generator and own pay function, the tab's own reader under the same generator, real corpus events) and found no completion that pays a robot less than its credit.

## 1. The secured minimum is a lower bound, independently: VERIFIED

`lower_bound.mts` does not use the module's walk of futures. It carries its own eight alliance topology (asserted equal to `BRACKET_SETS` only as a cross check), its own random partial bracket generator (a random topological prefix of the 13 sets plus a partial Finals series, so positions the real schedule would never produce are included), and its own reimplementation of the pay rule written from the module header prose (`pay2`). Each partial was credited by `securedPlayoffPoints`, then completed at random 10 times (4 uniform, then up to 4 target alliance mostly loses with a rostered fourth robot excluded from every later row, and 4 target alliance mostly wins), with Finals match numbers shuffled out of order in 30% of cases. Each completion was priced by the module's `playoffPointsPaid` AND by `pay2`; every credited robot was required to be paid at least its credit by both.

| Run | Partials | Completions | Robot positions with credit > 0 | Minimum reached exactly by some completion | Violations | `pay2` vs module pay (robot values compared) | Monotone checks (credit never drops as rows are added) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| seed 99, 2023 to 2026 equally | 40,000 | 393,418 | 256,752 | 223,936 (2023 rule 49.9%, 2024 on 99.8 to 99.9%) | 0 | 7,852,442 compared, 0 mismatches | 3,146,571, 0 violations |
| seed 2026 | 20,000 | 196,160 | 127,985 | 112,033 | 0 | 0 mismatches | 0 violations |
| seed 7 (smoke) | 400 | 3,892 | 2,480 | 2,184 | 0 | 0 mismatches | 0 |

The bite is real: the minimum is reached exactly in 99.8 to 99.9% of credited positions under the 2024 on rule, so a credit one point higher would have been caught. The 2023 rule reaches it in about 50% because with a three robot roster no completion can leave a robot out of a win; the module is conservative there, which is the safe direction.

Same generator, but credited through the TAB'S reader `securedElimByTeamFor` (`reader_bound.mts`: alliance lists with the fourth robot listed half the time, sides randomly red or blue, tie noise rows): 24,000 partials, 234,106 completions, 143,070 credited positions, 0 violations, 0 mismatches. So the side to alliance mapping and the unlisted backup filter also hold.

Pay function cross check against real events (`real_events.mts`, 25% random sample of `data/corpus.sqlite`, read only): 121 events compared (2023 district 25, 2023 dcmp 8 alliance 3, 2023 dcmp 4 alliance 1, 2023 dcmp 2 alliance 1, 2024 on district 74, 2024 on dcmp 8 alliance 15, 2024 on dcmp 2 alliance 2), 2,850 team values, 0 pay mismatches; 1,789 clock order prefix positions, 10,980 credited team positions, 0 above the final payment.

Not covered by my generator: the 4 and 2 alliance finals of a divisioned championship (the module supports them and the corpus gate covers them; the tab credits nothing there).

## 2. The corpus gate: VERIFIED

`REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/securedPlayoffPoints.test.ts scripts/securedPlayoffCorpus.test.ts --reporter=verbose`: Test Files 2 passed (2), Tests 29 passed (29) (22 pure plus 7 corpus).

- Fit table: 507 events, 11,991 team values (5,946 paid above 0), exactly equal 11,991, rule above paid 0, rule below paid 0, by kind: 2023 rule district 2,255 / dcmp division 244 / dcmp single 176 / finals 4 alliance 9 / finals 2 alliance 16; 2024 on district 7,837 / division 738 / single 651 / finals 4 alliance 28 / finals 2 alliance 37. Two events with no alliance list are not compared.
- Gate on the rule: 507 events, 16,094 positions (schedule order and clock order), 222,863 team positions, 90,965 with a credit above 0, 116,871 equal to the final payment, ABOVE 0, lower than the position before 0. Two positions refused (`2023mawor clock 3` and `clock 4`, a feeder timestamped after its dependent), which credits nothing there.
- Gate on the tab's reader: 491 events, 7,987 positions, 45,513 credits, sum 762,821, largest 90, above 0, lower 0.
- Row facts: 7,554 rows, 14 ties, 6 Finals rows numbered 4 or above, 60 disqualified sides (the one that won is a 0 to 0 placeholder match), 0 sets with two decisive rows, 351 listed fourth picks.
- Cell test: 40 stops, 268 open Playoffs cells with an at least line, 0 draws below the line.
- Seasons: `load()` reads `BRACKET_REGISTERED_SEASONS` (2023 to 2026, no hard coded year). Test 7 takes its own census (separate SQL, no season filter) and fails if any registered season with a finished bracket and paid values has no compared event in any of the three gates; printed coverage: 2023 115/115/111, 2024 119/119/115, 2025 125/125/121, 2026 148/148/144 (fit / rule / reader). The executor's bite log (`mw2/exec/t1_corpus_bite.log`) shows the test failing naming `2026: 148 finished brackets with paid values, none in the fit table` when the loader was made to skip 2026. I read that log; I did not re-mutate the repo.

## 3. The owner's example: VERIFIED

`npx tsx fnc_q.mts` (2026 FNC, Round 5, 15 slots): frc4561 floor 292, joint bound 11, `locked` by `ceiling+joint` (pool entry floor 292, extra -60). frc2724 floor 260 bound 12 locked (joint); frc3506 floor 243 bound 14 locked (joint); frc4795 floor 304 bound 11 locked (ceiling+joint); frc9496 and frc9032 floor 319 bound 11 locked (ceiling+joint). frc8429 (floor 231, bound 17) and the rest of the pool stay In range or Out of range. frc4561's 292 is its previous 232 plus 60 (a finalist at a District Championship cannot be paid below 20 x 3), and TBA finally paid it 90.

## 4. The larger of the two: VERIFIED

- `openPlayoffBounds` (`districtLedgerRows.ts:1143`): for an exact settled value the floor is `max(settled.points, securedElim)`, otherwise the credit is clamped to the most the category can pay and joins the floor while the ceiling falls by the same amount. `settled.exact` is true only when the value IS TBA's posted `earned.elim` at Now (`districtLedgerRows.ts:1854`), so the number side of the max is TBA's own figure, never a placement guess.
- `securedBeyondPosted` (`:1158`) is `max(0, secured - earned.elim)`, so the floor of a category that reads final is `max(number, secured)` with the same credit that the corpus gate bounds by the final payment. Both sides of the max are therefore at or below the final payment on every corpus position (0 of 222,863 above; 0 of 45,513 through the reader). No position on real data where the max exceeds the final payment exists.
- Paid pick rule: `paidOrSecuredAt` adds a team to the confirmed set only when a secured minimum above 0 is supplied for it at that key. The reader credits a robot only if every listed robot on the winning side belongs to one alliance (otherwise the whole event is refused), so a credited robot did play a win for the alliance that lists it, which is what a payment is read to say.
- Joint proof soundness of the shape: for a rival, floor rises by c and `extra` falls by c, so floor plus extra is unchanged (confirmed in `champJointLock.ts`: `rival.floor + rival.extra` everywhere except `withoutSettled`, whose `floor + max(0, extra - settled)` can only rise when c moves from extra to floor; that is the 12 bounds the executor measured and withheld). For T itself only the floor is read, so the credit is not double counted with its alliance value.

## 5. History: locks only gained: VERIFIED

`bash d7r/gates.sh .../mw2-verify/final` ran clean at HEAD b1fc2566 (all eight exit codes 0).

- `gates_compare_mw2.sh base final both`: `MW2 GATES AS EXPECTED (both)`; champ, ledger identical to the base; joint (1,304 lines) and settled (39 lines) identical to the planner's expected output; `cutoff: no drift for both generated files`; `takeback: championships 48, stops 412, take-backs 0`; `now: identical on both tabs (artifacts 109 teams 16345)`; `UL3 COMPARE CLEAN`; `R9X COMPARE CLEAN` (publisher dry run: 119 files, 0 differing).
- `final` equals `mw2/exec/after-t4` line for line for joint, champ, ledger, settled, cutoff, takeback, now, exit: the last three tasks changed no lock result at a sweep stop.
- Violations: joint `VIOLATIONS: none`, `SKIPPED (0)`, tenet "credit: no secured minimum in a floor above the playoff points TBA finally paid" holds over 2,452 secured minimums in floors; settled tenets A to F all hold (13,628 secured rows, 176,335 points, SKIPPED (0)); champ: Locked shown 6,836, VIOLATIONS 0; Locked out shown 271,608, VIOLATIONS 0; ledger "Both tenets hold at every swept position of every swept season".
- Gained and lost against the pre task reading (`mw2/base-tree`, which I confirmed equals `9a6c9fae` for the five key files modulo CRLF; `locks_diff.mts` and `district_diff.mts` outputs equal the expected files):
  - CHAMP LOCKS, 48 championships, 412 stops: Locked on points 3,755 to 4,221, GAINED 466, LOST 0 (single 754 to 925, divisioned 2,898 to 3,178, two championships 103 to 118); Locked out 41,893 to 41,981, gained 88, lost 0; joint bounds compared 59,721, HIGHER 0, lower 1,704.
  - DISTRICT LOCKS, 418 district tier events, 2,926 stops: Locked on points 37,484 to 38,771, GAINED 1,287 (637 by the pooled test alone, 650 by the ceiling test), LOST 0; Locked out 83,235 to 83,667, gained 432, lost 0; `lost lines: 0`.
- Worker bundle: `worker_closure.mjs --fail-if-bundled` over all 32 files changed since `9a6c9fae` (not only the SUMMARY's 13): `WORKER BUNDLE UNTOUCHED (32 files probed)`.

## 6. Monotonicity on real data: VERIFIED

`REQUIRE_LOCAL_DATA=1 npx vitest run scripts/champJointMonotone.test.ts scripts/champFieldStagedWalk.test.ts scripts/districtLocksStagedReplay.test.ts`: Test Files 3 passed (3), Tests 215 passed (215), run once, no timeouts, no rerun needed.

- Rules on: group A (16 championships, 156 stops, 1,200 readings, 1,968 flag edges, 1,088 stop edges): Locked lost 0, margin drops 0; group B (two division championships and FIM seasons): 0 and 0; group D FORCED awards flag reading: Locked lost 0, margin drops 0, bounds higher 0 of 12,184, floors lower 0 of 12,232; group E: Locked lost 0, margin drops 0, bounds higher 0 of 84,991, floors lower 0 of 113,449; 2024 NE: bounds higher 0 of 11,761.
- New "no floor drops" assertion: every lattice and walk reads `0 lower` (e.g. 1,280,928 compared, 1,087,263 compared, 267,020, 89,200, 24,464 ...), the edge where TBA's playoff number lands included.
- The tests bite: forced awards flag reading with the credit OFF loses 28 Locked (22 pairs, 498 margin drops, 498 bounds higher); awarded rule off: 887 lost; stop rule off: 306 lost; field conditioned walks with the rule off still take back 32/9/26 and 34/16/24 (district, champ, tab) with the credit and 32/9/32 and 34/16/34 without; real 2026pncmp case B rule off: no take back with the credit, frc2522 and frc5937 taken back without it.
- Credit adds, with `lockedOnlyWithoutTheCredit` empty: field walks district tab +105 and +97, champ tab +19 and +22; 2026pncmp +17.

## 7. The flicker: VERIFIED, with one pre-existing window noted

- `useDistrictLedgerData.test.ts`, `.flight.test.tsx`, `.asOf.test.ts`: 3 files, 53 tests passed.
- `attachRequestFacts` (`useDistrictLedgerData.ts:393`) builds milestones, bracket facts and the secured minimums from the REQUEST being assembled (`input.knownAlliances`, `input.playedElimMatches`, and, live, the loaded event artifacts); an existing entry keeps its own `byTeam` and its own milestones and gains only what it lacks. Nothing is held over from an earlier request; for a run in flight an entry with an empty `byTeam` is created. No tier entry means no credit (`tierByEvent?.get(eventKey)`; `undefined` skips): there is a test (`useDistrictLedgerData.test.ts:1061`).
- Can request facts meet a DIFFERENT request's distributions? Only in one pre-existing window: `landedEntries` (`:560`) returns a `complete` run's events without checking the signature, and `useDistrictSimulationRun` only flips to `running` in an effect after the render, so for one render after a request change the old run's `byTeam` (and its milestones, which `attachRequestFacts` keeps when present) sit beside the new request's bracket facts and credit. Going forward in time this is conservative (older milestones are a subset; the credit and bracket facts only grow). Going BACKWARD on a rewound stop the stale milestones of the later stop could show hindsight settled values for one frame. This is not introduced by this task (before it, the whole stale entry was read, bracket facts included), so it is a warning and not a gap.
- District Locks tier map (`DistrictLedger.tsx`, new `tierByEvent`): `allDistrictTierEventKeys(artifact)` is every event key on any team's row with `tier === "district"` (`tierEvents(team, "district")`), so a dcmp tier event can never be named at the district weight; Champ Locks passes `event.tier` from `champTierEvents`. The reader refuses anything but eight alliances of at least three picks, so a finals key credits nothing even if named.

## 8. Display: VERIFIED

- `openCellLines` prints `at least N` only when `cell.cell === "elim"`, `cell.securedAtLeast` is defined and `Math.round(...) > 0` (`LedgerParts.tsx`, `securedPoints`), after the `notPicked` branch returns, before the milestone, selection and chance branches, which keep their own text; the line is `at least N · <existing small line>` or `at least N` alone.
- No dash, hyphen or tilde-on-percent in new copy: the added lines of `districtLedgerCopy.ts` and the methodology paragraph contain none of `- – — ~ %`; the only new `~` in code is the existing total median form `~N` (points), fed through `heldPercentiles`. No new percentage is printed anywhere, so none can read 100.
- The print rule is fed as an optional `least` through `TeamCell`, `GrandTotalContent`, `LedgerCell` (totals only) and `heldTeamMedian`; the status modules read `rowCountedPoints`/`countedAtPosition` nowhere. The pinned test reads statuses, projections, cell summaries and Champ floors before and after at 48 stops: 0 differ. The `LedgerParts.tsx` header states the one inconsistency left (a chip cut at the run's own median).
- `npx vitest run apps/web/src/components/districts apps/web/src/components/methodology`: Test Files 34 passed (34), Tests 1,253 passed (1,253).

## 9. Typechecks: VERIFIED

`npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo TYPECHECKS CLEAN` printed `TYPECHECKS CLEAN`.

## 10. Honesty of the SUMMARY and headers: VERIFIED

The module header, `districtLedgerRows.ts`, `districtLedgerStatus.ts` and `champLedgerStatus.ts` all say the rule was read from TBA's public source and fitted to four seasons of paid values, that this code does not control it, and in plain words that a Locked resting on the credit could be withdrawn if a playoff result is corrected after it was posted. The module header also tells whoever registers a season to read that season's manual first and that a declared rule is a claim until the corpus gate has passed on that season's first finished events; a unit test fails if a registered season has no declared rule. SUMMARY numbers I could check against my own runs all matched (507 events, 11,991, 5,946, 222,863, 90,965, 16,094, 45,513, 466, 1,287, 59,721, 1,704, 29 tests, 215 tests, 1,253 tests). I could not verify offline that the cited TBA source files say what the header says; what is measured, and what the lock math rests on, is the exact fit.

## Warnings (none blocks; each is a stated limit or pre-existing)

1. **Corrected playoff result (stated limit 2).** If TBA changes a decisive row after posting it, a credit read from the first result can fall and a Locked that rested on it could be withdrawn. Reachable in normal live operation (a head referee replay or a data correction), expected to be rare. The corpus keeps only final results, so nothing measures how often. Stated honestly everywhere; no code can remove it.
2. **Larger of the two stops where the played rows stop (stated limit 3, with limit 6).** A district event or single championship whose awards flag is already true has left the Live fetch set, so its floor is TBA's number alone. A credit based Locked would be taken back there only if TBA raised the awards flag BEFORE it posted the playoff points; the code relies on TBA computing all four categories together (read from TBA's source, not observed on a live event). Playoff points derive from match results and the flag from posted awards, so the order that would hurt is unlikely, but it is unobserved. The walks exercise the forced flag reading with rows in hand (0 lost), not the left-the-fetch-set path. The first live 2027 district event is the first real exercise.
3. **The corpus gate is local only.** `scripts/securedPlayoffCorpus.test.ts` skips when `data/corpus.sqlite` is absent (it fails only under `REQUIRE_LOCAL_DATA=1`), so CI runs the 22 pure tests, not the gate. A TBA rule change or a new season would show only when someone runs the gate locally. The header says so.
4. **One render of a stale completed run beside a new request (section 7).** Pre-existing, conservative going forward, a possible one frame hindsight on a backward rewind.

## Other stated limits, reachability in normal live operation

All other limits are smaller credits (safe direction) or print-only: no credit at a divisioned championship's finals event, for a backup no list names, for an event with a playoff row the tab cannot place on two alliances, for an event artifact with no tier entry, or for a season with no declared rule. All are reachable in ordinary operation; none can raise a floor. The print rule can leave a median a point or two above the projection its chip was cut at, and at Now while an event is in progress a median can still read below the earned figure (as before). The `PLAYOFF_POOL` margin (210 plus 3) is measured not proven and was not changed; the pooled test nets credits off that pool exactly as it already netted settled points, so the task adds no new reliance on it.

## Commands and results (for rerun)

- `REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/securedPlayoffPoints.test.ts scripts/securedPlayoffCorpus.test.ts --reporter=verbose`: 2 files, 29 tests passed.
- `npx tsx lower_bound.mts 40000 99`, `... 20000 2026`, `reader_bound.mts 24000 4242`, `real_events.mts 0.25 77`: all 0 violations (section 1).
- `bash d7r/gates.sh mw2-verify/final` then `gates_compare_mw2.sh base final both`: `MW2 GATES AS EXPECTED (both)`.
- `REQUIRE_LOCAL_DATA=1 npx vitest run scripts/champJointMonotone.test.ts scripts/champFieldStagedWalk.test.ts scripts/districtLocksStagedReplay.test.ts`: 3 files, 215 tests passed.
- hook tests 3 files 53 tests; districts plus methodology 34 files 1,253 tests; four typechecks clean; worker closure untouched over 32 files.

_Verified: 2026-10-13_
_Verifier: Claude (gsd-verifier)_
