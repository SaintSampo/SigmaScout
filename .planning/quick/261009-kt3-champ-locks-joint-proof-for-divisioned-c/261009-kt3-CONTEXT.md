# Quick Task 261009-kt3: Joint proof for divisioned championships and two championship districts - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the divisioned champs and california." Quick task 261009-2tr's joint worst case lock proof (`packages/core/districts/champJointLock.ts`, wired by `apps/web/src/components/districts/champLedgerStatus.ts` decision 5, gated by `scripts/measureChampJointLocks.ts`) runs only at a SINGLE EVENT District Championship. The 16 divisioned championships of 2023 to 2026 (FIM with 4 divisions, NE, ON and TX with 2) and 2026 California's two championships fall back to the flat reservation. This task extends the proof to both shapes, with the same two tenets in the same order: soundness (a lock shown at any stop is kept at the end, zero sweep violations) before earliness.

**A pre existing soundness gap this task MUST close (D3).** For a team with TWO dcmp tier rows (a division row and a finals row, 7 to 16 teams per divisioned championship), `computeChampLedgerStatuses` reads only `team.dcmpRow.sources[0]` (the division) for its floor and ceiling, and `buildDcmpRow` puts only `entry.rows[0]` in `sources`. The finals row's playoff and award points (frc27 at 2026micmp: elim 60, Impact 30) therefore stay in the team's floor at every REWOUND stop over a divisioned championship, as if already earned. The tenet sweep never caught it because those are the strongest teams, who qualified anyway. "No team is told they are locked at any stop and then later not locked" covers that case too.

Scope: core (`champJointLock.ts`, `bracket.ts` or a sibling for the finals topology, the measured ceilings), the browser Champ Locks status and row model, the corpus sweep, methodology, tests. Not in scope: the District Locks tab, the publisher and Worker verdicts, the simulation's pricing of finals events, the DCMP row's CELLS for a second dcmp event (display, record as todo if it comes up).

</domain>

<decisions>
## Implementation Decisions

### D1. The three championship shapes, detected from the artifact
- Group the district's dcmp tier event keys by `championshipStemOf`. One stem with one key: SINGLE (shipped). One stem with several keys where one key equals the stem: DIVISIONED, the stem key is the FINALS event and the keys with a trailing digit are the DIVISIONS. Several stems: MULTIPLE independent championships (2026 California: `2026cancmp`, `2026cascmp`, each a single 8 alliance event, sharing one `cmpSlots`). Anything else (a stem with several keys and no parent, a divisioned championship with 3 or more than 4 divisions, a finals event with an alliance count other than 2 or 4): the proof does not run, reason `unsupportedShape`, flat reservation stands.
- Each team is in at most one division (its dcmp row with a digit suffix) or, for MULTIPLE, in exactly one championship. A field team with no dcmp row at the position is an unpicked rival of unknown division: it can take a slot only by a consuming award or by a backup seat in ANY division.

### D2. Finals pay maxima and the finals bracket, from the manual and the corpus
- 2026 manual 11.1.3: "Each team on a Champion Alliance of a 2-Division District Championship Playoff tournament earns 10 points" and "For a 4-Division District Championship Playoff tournament, each team on a Champion Alliance earns 20 points and each team on a Finalist Alliance receives 10 points", times 3 at a DCMP. Backups are prorated (only lowers). Measured 2023 to 2026 (`data/local-publish/districts`): FIM finals rows pay exactly 60 (3 per season) and 30 (3 per season), NE, ON and TX finals rows pay exactly 30 (3 per season), semifinal losers and 2 division finalists 0, a 2026 NE finalist that won a Finals match still 0. So FINALS MAXIMA: 4 divisions champion 60, finalist 30, semifinal losers 0; 2 divisions champion 30, finalist 0. New `maxFinalsPointsByPlacement(season, divisions, placement)` beside `maxPlayoffPointsByPlacement`, with the manual citation. Finals rows carry qual 0 and alliance 0; the consuming awards (Impact up to 5 at FIM, EI, RAS) are given at the FINALS event key to any field team; the 15 point judged awards are given at each DIVISION (12 each, never more).
- 4 division finals bracket (TBA playoff_type 11, confirmed on 2024 to 2026 micmp): sf1 = alliance 1 v 4, sf2 = 2 v 3, sf3 = winner sf1 v winner sf2 (winner to the final), sf4 = loser sf1 v loser sf2 (loser is 4th), sf5 = loser sf3 v winner sf4 (winner to the final, loser is 3rd), f = best of 3. 2 division finals: f alone, best of 3 (TBA playoff_type 9); a tie is replayed, the first alliance to two wins is champion (2024 necmp: f1m1 tie, then three more matches). Finals alliance numbers map to divisions by roster: a finals alliance's picks are the division winning alliance's picks, possibly plus a backup.
- Finals routing: a small pure topology for both shapes (decisions by set and match, the same `bracketDecisionKey` style), giving each finals alliance `alive` (can still be champion), `finalist` (in the final), or a decided finals placement (champion, finalist, 3rd, 4th; for 2 divisions champion or finalist).

### D3. Fold EVERY dcmp tier row of a team, at the browser and in the sweep
- `buildDcmpRow` puts every one of `entry.rows` into `sources` (`entry.rows.map(sourceOf)`), in artifact order (division first, finals second). The DCMP row's CELLS keep reading `rows[0]` as today (display is out of scope).
- `computeChampLedgerStatuses` loops over every dcmp source: per source, its own stage at the position, each open category's earned value subtracted from the floor and its ceiling added, `settledElim` honored per source. The finals source's categories: qual and alliance are always 0; elim settled when the finals bracket decides the alliance's finals placement (exact when TBA posted, otherwise the finals maximum as `ceiling` and the table value as `points`); award open until the finals awards post. `rowStage` for the reservation reads the FINALS event's stage for a divisioned championship (it already folds `perChampionship`).
- Pin: for every team with a finals row, at a position before the finals event started, the floor is at most `pointTotal` minus the finals row's total. The sweep asserts it at every such stop for every team (D6).

### D4. The proof for a DIVISIONED championship (the spec; implement each step as written or more conservatively)
Inputs per T (pool team): S' as today; floor_X and extra_X as today but folded over every dcmp source (D3). Division structure: for each division d, alliances with members (picks whose alliance selection points at d are above 0), unpicked_d, routing_d (`routePlayedBracket` on d's played matches), alive_d, decided placements settled. Finals state from D2. Award budget: consuming C = `dcmpAwardCountCeilings(...)` summed (they are all given at the finals event, to any field team); judged K = `dcmpJudgedAwardCeiling()` (14) TIMES the number of divisions, one shared pool (a rival can only win its own division's judged awards; sharing the pool is a sound relaxation); one point paying award per rival, as before.

- **Candidate overall champions W:** every alliance that can still be champion: alive in its division, or its division's decided winner, AND not eliminated from the finals. When the finals are decided or the winner award is posted: `[decidedWinner]` or `[null]` exactly as the single case.
- For each W (skip when T is a member of W, that outcome qualifies T):
  1. members(W) other than T: covered. Fill ins f = `MAX_WINNING_ALLIANCE_SIZE` minus |members(W)|, from unpicked rivals of ANY division (a finals backup can come from the whole field; 2026micmp alliance 4 lists frc4327, who is not in its division's alliance).
  2. In div(W): the other alive alliances get the distinct division placement maxima 75 / 39 / 21 (`maxPlayoffPointsByPlacement(year, "dcmp", 2..4)`), every ordered assignment enumerated, as today. Decided alliances carry their settled values.
  3. In every other division d: SOUND RELAXATION. Every alive alliance of d gets 90 plus F_nw, where F_nw is the finals maximum for a non champion (4 divisions: 30, the finalist; 2 divisions: 0). A decided division winner of d gets its settled value plus F_nw while it is still alive in the finals, and its settled finals value once the finals decide it. Other decided alliances carry their settled values. (This gives every alive alliance of d the most ANY role in d can pay. The planner may replace it with a tighter rule only if it proves the rule dominates every feasible future and the exhaustive test still passes.)
  4. Points pass, backup seats, consuming awards, judged awards and fill ins: exactly the shipped exact resource maximum (`champJointLock.ts`), with seats pooled over every division: an alive alliance's spare seats pay that alliance's scenario value (step 2 or 3), seats on W are fill ins.
  bound_T = max over W and over div(W)'s assignments of |covered|; lockedByJoint iff bound_T < S'.
- Soundness argument for the module header: the real champion is some W; in div(W) the real placements are dominated by an enumerated assignment; in every other division no alliance can be paid more than 90 plus F_nw (the division champion's 90, and at most the finalist's 30 in a 4 division finals, since the overall champion is W); decided values are maxima; awards, seats, fill ins and the one slot per rival as before.

### D5. The proof for MULTIPLE championships (2026 California)
- Run the single championship proof once per championship. For T's own championship with T in it, as shipped. For every other championship, an OBSERVER variant: the same enumeration with T absent (m_T given, T on no alliance, every candidate winner counted). bound_T = the sum over championships. Each championship uses its own alliances, routing, fill ins and seats; consuming C per championship = the district ceiling (`dcmpAwardCountCeilings`, conservative since the ceiling is a district total), judged K = 14 per championship. Each championship's posted winner leaves the pool and the slots as today (`perChampionship` already sums reservations). Locked iff bound_T < S'.
- Soundness: slot takers partition by championship and the resources of one championship cannot reach the other.

### D6. The sweep is the gate, extended to the two shapes
- `scripts/measureChampJointLocks.ts` gains the two shapes and skips nothing of 2023 to 2026 (48 championships: 31 single, 16 divisioned, 1 multiple). Stops for a DIVISIONED championship (every division advances together; a round with no played row anywhere has no stop): "Alliances final", "after Round 1" to "after Round 5", "Divisions final, finals not started", for 4 divisions "Finals after sf1 and sf2", "Finals after sf3 and sf4", "Finals after sf5", then "Finals decided, awards open", then Now. For MULTIPLE: both championships advance together through the single event stops. `stageByEvent` per stop sets every division and the finals event accordingly (the finals event is not started until "Divisions final" and its awards open until Now).
- Tenet A as before, exit 1 on any violation. Plus the D3 pin at every stop before the finals started. Report per stop: shipped, joint only, combined, violations; first lock gains; and the previously skipped list must now be empty except `unsupportedShape` cases, which must be zero for 2023 to 2026.
- `scripts/measureChampTenets.ts` must stay green (it exercises the fallback and, after D3, the folded floors at every position).

### D7. Tests
- Finals topology: route every completion of the 4 alliance bracket and assert the placement bijection and that the three measured seasons' real match lists route to the real champions (2024 to 2026 micmp from RESEARCH), plus the 2024 necmp tie series.
- Exhaustive soundness on a reduced divisioned instance (2 divisions, few sets left, small points, C=1, K=1, every completion of both divisions and the final, every award assignment) and a sampled test (seeded, 20,000 futures, 4 divisions, C=5, K=56, real 2026 values). The multiple shape: the sum of two single instances against a sampled joint future.
- Pins: FIM 2026 at "Divisions final, finals not started" and at "Finals decided, awards open" (the set D4 produces, every member locked or lockedAward at Now, nobody who missed); NE 2026 likewise; CA 2026 at Round 5 and Playoffs final (every member locked or lockedAward at Now). The shipped FNC pins unchanged.
- D3 pin in `champLedgerStatus.test.ts`: a synthetic team with a division row and a finals row at a position before the finals: floor excludes the finals elim and award; at Now (all final) the floor is `pointTotal`.

### D8. Copy
- Methodology (`districtLedgerContent.ts`): extend the joint proof paragraph with one sentence that a championship played in divisions counts each division's bracket and the finals among the division winners, and one that a district with two championships counts both. Flat third person, no dash characters.

### D9. A seat in the champion's division also pays the finals non champion maximum (orchestrator, 2026-10-09, closing the planner's open question)
- The planner's revision noted that a listed backup of a non W alliance alive in div(W) could, once that alliance is out, join another division winner's finals roster and be paid its division seat value PLUS the finals non champion value (30 at 4 divisions), while the proof pays a rival one seat. Whether FIRST's backup rules allow a team to sit on two rosters is not verified, so the proof does not rely on it: in the divisioned frames, EVERY backup seat on an alive alliance in div(W) pays its assigned division value PLUS F_nw (seats in other divisions already pay 90 plus F_nw; fill ins on W take a slot regardless). The single and multiple shapes have no finals and are unchanged. State it in the module header beside D4 step 3 and cover it with one unit test (a div(W) seat at 21 plus 30 crosses a floor that 21 alone does not).

### D10. Seat counts come from CONFIRMED picks, on every shape (orchestrator, 2026-10-09, plan checker iteration 2 blocker)
- With membership = the listed picks (plan reading R8), EVERY seat count, `spare(A)` on the single, division and California paths as much as the finals `finalsSpare(A)`, is `MAX_WINNING_ALLIANCE_SIZE` minus A's CONFIRMED picks, where confirmed means posted alliance selection points above 0 at that key (an unposted point reads as 0, which widens). Never `MAX` minus the listed picks. Counterexample otherwise: alliance A lists [a, b, c, d] with d a listed backup at 0 points and a floor too low to be covered; a pool rival X within A's value; under listed counting `spare(A)` is 0 and X is never counted, yet in a real future d is dropped and X is added as A's backup and takes a slot. Add that exact input as a unit test (a listed fourth pick at 0 points, non coverable, and a coverable X; the bound must count X).
- This is the executor's addendum to the plan's Task 3 and Task 4 (the plan text still says `spare = MAX - |listed|` on the non finals paths). With it the shipped single event numbers are expected to reproduce; if any single event number or FNC pin still moves, stop and report, never fit.
- D9 is likewise an addendum to Task 3: `divisionedJointFrames` carries an `enumeratedSeatBonus` (F_nw, 0 at two divisions) added to the SEAT value of every enumerated alliance in div(W), not to member values; the E3 and S2 samplers let a division backup of a non W alliance also join a finals roster and be paid F_nw; a fourth mutation check drops the bonus and shows a test failing; the header states it beside D4 step 3. The FIM and NE pins may move through D9 or D10: report, never fit.

### Claude's Discretion
- Whether the finals topology lives in `bracket.ts` or a sibling `finalsBracket.ts`; whether the divisioned proof is a generalisation of `jointLockBound` over a `divisions` array (single = one division, no finals) or a separate function that reuses the resource maximum. Prefer one code path with single as the degenerate case, as long as the shipped FNC pins and the single event sweep numbers do not move.
- How the browser gets the finals event's facts: a finals variant of `dcmpBracketFactsFor` (2 or 4 alliances, its own topology), attached per dcmp key; `jointProofAt` reads the structure of D1.
- The sweep's loader for division and finals brackets from the corpus (`event_alliances`, `matches`), reusing `bracketFromCorpus`.

</decisions>

<specifics>
## Specific Ideas

- Shapes in the data: 2026fim keys `2026micmp1..4` + `2026micmp` (83 slots, 16 teams with a finals row); 2026ne `necmp1,2` + `necmp` (32 slots); 2026ont (21); 2026fit (28); 2026ca `cancmp` + `cascmp` (46 slots, no team in both).
- Finals rows: FIM 2026 frc27 `[micmp1: 66, 48, 90, 0]` and `[micmp: 0, 0, 60, 30]`; frc5460 `[micmp4: 66, 48, 90, 15]` and `[micmp: 0, 0, 30, 0]`; frc6090 (division 2 champion, semifinal loser at the finals) has NO finals row. Finals rows exist only for teams paid there.
- Winner award (type 1) is at the finals key only (3 or 4 recipients). CA: both `cancmp` (3) and `cascmp` (4) winners carry it.
- Consuming ceilings today: fim {Impact 5, EI 1, RAS 2}, ne {4, 2, 2}, ont {3, 2, 1}, fit {3, 2, 2}, ca {4, 2, 2} (band, no own history), fnc {2, 2, 2}. Judged ceiling 14.
- The rail gives the finals event no round stops (`districtMilestones.ts` ~238, by design); match step positions still exist, and Now during a live finals is a real position the proof must handle.
- Corpus match side mapping for the finals: `red_teams`/`blue_teams` resolve to finals alliance numbers through `event_alliances.picks` of the FINALS key, exactly as `playedBracketMatchesFor` does.
- Run tests with `npx vitest run <paths>` from the repo root, never `timeout <n> pnpm ...`. Three typechecks. `npx tsx scripts/measureChampJointLocks.ts`, `npx tsx scripts/measureChampTenets.ts`, `npx tsx scripts/measureChampCutoff.ts --check-history` all clean. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/261009-2tr-champ-locks-joint-worst-case-lock-proof-/` (CONTEXT D1 to D7, RESEARCH, SUMMARY: the single event proof this task generalises; its readings stay locked)
- `.planning/todos/pending/champ-joint-lock-follow-ups.md` items on divisions and California (close them in the SUMMARY)
- `packages/core/districts/champJointLock.ts`, `bracket.ts`, `champReservedSlots.ts` (`championshipStemOf`, `perChampionship`), `hypotheticalDcmp.ts`; `apps/web/src/components/districts/champLedgerStatus.ts` (`jointProofAt`, the floor loop ~360-412), `champLedgerRows.ts` (`buildDcmpRow` ~937, `sourceOf`), `districtLedgerRows.ts` (`dcmpBracketFactsFor`, `dcmpBracketMilestonesByTeam`); `scripts/measureChampJointLocks.ts`
- `.planning/quick/261009-kt3-champ-locks-joint-proof-for-divisioned-c/261009-kt3-RESEARCH.md`
</canonical_refs>
