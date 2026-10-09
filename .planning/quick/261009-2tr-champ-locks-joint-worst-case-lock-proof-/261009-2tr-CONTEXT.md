# Quick Task 261009-2tr: Champ Locks joint worst case lock proof - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-08: "certain teams should be locked for champs earlier than they are right now." Confirmed, then: "I like your plan do it. be rigorous. we have a lot of info to work with. it is mission critical that no team is told they are locked at any stop, and then later they are not locked. but also once a team is locked, we should know it as soon as we can."

The Champ Locks tab's `Locked` verdict (Championship slots) is provably looser than "impossible not to qualify". Measured at FNC 2026, DCMP Round 5 stop (finals set, awards open, 15 slots, 52 teams): the live rule locks 0 teams; a joint worst case over the bracket and the award budget locks 8, every one of which qualified. Three causes, all in `apps/web/src/components/districts/champLedgerStatus.ts` and `packages/core/districts/champReservedSlots.ts`:

1. The reservation is flat: 4 winner slots plus every judged award ceiling (9 of FNC's 15) until awards post. It never narrows to the alliances still alive and it double counts a rival that is both a points threat and a possible slot thief.
2. No pooled or joint argument at the champ tier (header decision 2): all 52 rivals get the full 45 award points independently, though the DCMP gives out 306 award points in total across 20 awards and only 5 of them pay more than 15 to one team.
3. Nothing about the bracket enters a rival's reach except a decided placement.

This task adds a second, OR-ed proof of `locked` at the champ tier, the JOINT WORST CASE PROOF, and a corpus sweep that guarantees it never shows `Locked` for a team that then misses. Two tenets, in priority order: (1) soundness, a lock shown at any stop is kept at the end, zero violations across every published DCMP; (2) earliness, locks appear at the earliest stop the proof allows.

Scope: browser Champ Locks tab (`champLedgerStatus.ts` and the core module it calls), `packages/core/districts`, the measured history table, the tenet sweep script, methodology copy, tests. NOT in scope: the District Locks tab, the publisher's and Worker's `champLock` verdicts (not displayed on the site; record as a todo), division championships (see below).

</domain>

<decisions>
## Implementation Decisions

### D1. Where the proof applies
- A SINGLE EVENT championship only (one dcmp-tier key per championship stem, `perChampionship` size 1). FIM, NE, ON and TX play divisions into a finals event; they keep today's flat reservation path unchanged. Record a todo for divisions.
- At a position where the DCMP's Qualification and Alliance selection categories are FINAL and its Awards are OPEN. Playoffs may be open (bracket partly played) or final. Before alliance selection is final the proof does not run and the shipped ceiling test with the flat reservation stands. Once awards are final the reservation is already zero.
- The proof also needs the event artifact's alliance list to be complete (`allianceListIsPartial` false) and every played elimination match resolved to one alliance per side; otherwise it does not run (fall back, disclose nothing new).

### D2. The proof (what the executor implements, exactly)
Inputs for team T in the points pool P (not prequalified, not already award qualified), slots S' = `pointsRaceSlots(...).pointsSlots` (cmpSlots minus posted award qualifiers):

- **floor_X** for every field team X: the SAME floor the shipped ceiling test builds in `computeChampLedgerStatuses` (district tier earned minus open categories plus settled exact playoff points, DCMP qual and alliance earned). **extra_X** = that team's open DISTRICT tier ceiling (normally 0 at DCMP time) plus, for a DECIDED alliance whose settled value is not exact, the placement table value (`settledElimBounds(...).ceiling`).
- **Members at the position:** for each alliance in `eventArtifact.alliances`, the picks whose DCMP alliance selection points are greater than 0. A listed pick with 0 is a backup robot that joined during the playoffs and is NOT a member at this stop (measured: 35 of 35 fourth picks at non division DCMPs 2023 to 2026 carry 0 alliance points). **Unpicked U** = field teams on no alliance by that rule.
- **Bracket:** `routePlayedBracket(bracketDecisionsFromPlayedMatches(played matches at the position))`. Alive alliances = alliances with no decided placement. Decided alliances already carry their settled value.
- **Award budget:** consuming awards C = sum of `dcmpAwardCountCeilings(...).counts` (Impact, EI, RAS), each takes a slot regardless of points and pays at most 30. Judged budget K = the 15 point judged award ceiling (D3), each pays 15. **ONE AWARD PER RIVAL (Jacob, 2026-10-09):** a rival receives at most one point paying award in any future, either one consuming award or one judged award, never both and never two judged. FIRST's judging rule is one judged award per team per event, and TBA's district point rows agree: since 2023, 0 of about 8,800 team event rows carry two awards' points (69 did in 2016 to 2020, 1 in 2022). The cap is a named constant with that measurement as its comment, and the sweep is what would catch a rule change. RAS is NOT restricted to rookies (conservative).
- **Placement maxima are NOT `playoffPoints`' table for second place.** The 2026 manual (11.1.3): first 20 and second 20 base, third 13, fourth 7, plus 5 for each Finals match won in which the team played, up to 10. A losing finalist can therefore be paid 25 (one Finals match won), and TBA's rows show it: 13 district tier rows at 25 since 2023. So the maximum a placement can pay is 30 / 25 / 13 / 7, times the dcmp weight: 90 / 75 / 39 / 21. The proof uses these maxima (a new `maxPlayoffPointsByPlacement(season, tier, placement)` beside `playoffPoints`, with the manual citation); `playoffPoints` itself is unchanged (it is the simulation's expected value and the settled cell's print).
- **m_T** = floor_T. T receives no award and no alive playoff points in its own worst case.
- For each candidate winner W among alive alliances (plus, when the playoffs are final, the single case "no alive alliance"): if T is a member of W, that outcome qualifies T and contributes 0. Otherwise build `covered`:
  1. members(W) other than T: covered (slot regardless of points).
  2. Placements: assign 75, 39 and 21 (`maxPlayoffPointsByPlacement(year, "dcmp", 2..4)`) to up to three DISTINCT alive alliances other than W, trying every ordered assignment (at most 7 x 6 x 5), and keep the assignment that maximizes the final count. An alive alliance given nothing gets 0 playoff points.
  3. Points pass: every uncovered rival R with floor_R + extra_R + assigned placement points >= m_T is covered (ties count against T).
  3b. Backup seats on losing alliances: every alive alliance A other than W has spare = `MAX_WINNING_ALLIANCE_SIZE` - |members(A)| seats a backup robot from U can still take, and a backup is paid that alliance's placement points. Allocate those seats greedily: take the alive non winner alliances in descending assigned placement points, and for each spare seat give the points to the uncovered team of U with the highest floor_R + extra_R; cover it if the sum reaches m_T. A seat on a decided alliance pays nothing more and is ignored. (Without this step an unpicked rival that joins the finalist alliance as a backup could pass T on points without being counted.)
  4. Consuming awards: cover up to C uncovered rivals (a consuming award takes a slot whatever the points).
  5. Judged awards: cover up to K uncovered rivals whose pts_R + 15 >= m_T (one award each).
  6. Backup fill ins: f = max(0, `MAX_WINNING_ALLIANCE_SIZE` - |members(W)|); cover up to f uncovered teams of U.
  Steps 3b to 6 are resources (seats, consuming awards, judged awards, fill ins) that each cover at most one rival each, and the BOUND IS THE MAXIMUM NUMBER OF RIVALS THOSE RESOURCES CAN COVER TOGETHER, not the result of one fixed greedy order (the planner showed a fixed order undercounts: a consuming award against a fill in, seat matching, a judged award against a fill in). Implement it as the exact maximum of that small assignment problem, or as a provably not smaller bound.
  bound_T = max over W and placement assignments of |covered|.
- **lockedByJoint(T)** iff bound_T < S'. OR-ed with the ceiling test exactly as the pooled test is in `locks.ts` (`computeLocksSplit`): `lockedBy` gains `"joint"` and the combinations; `eliminated`, `pointsToLock`, the cut line and the In range rank rule are untouched by it.
- **Soundness argument (write it in the module header):** in every feasible future the set of teams that take a slot from T is a subset of one `covered` set: the real winner is some W, the real placements are one enumerated assignment or are dominated by one, every rival's real points are at most pts_R plus the points of the one award it can receive, award counts are at most the budgets, a winning alliance has at most 4 members and its extra members come from U, TBA never pays a team MORE than the placement MAXIMA 30 / 25 / 13 / 7 (manual 11.1.3; measured since 2023: no row above them, proration only lowers), and a rival takes at most one slot. So real takers <= bound_T < S' and T qualifies.

### D3. The judged award ceiling K, a measured constant
- Measured over every non division DCMP 2023 to 2026 in `data/local-publish/districts` (70 championships): the number of 15 point judged awards is 11 or 12 every time, never more; the per team award maximum is 30 (nobody stacked). Divisions give 12 each and the finals event gives the consuming awards.
- K = the maximum observed across ALL history entries (12) plus a margin of 1 = 13. Not banded by district: FIRST's DCMP award slate is uniform. Store the per championship count in `dcmpHistory.generated.ts` (extend `buildDcmpHistory` and `--write-history`; `--check-history` must still pass after regeneration) and derive K from it in `hypotheticalDcmp.ts` beside `dcmpAwardCountCeilings`. The margin is a named constant with this measurement as its comment.
- Consuming ceilings stay exactly `dcmpAwardCountCeilings` (own history plus size band maximum).

### D4. The sweep is the gate, and it runs the browser's own code
- New `scripts/measureChampJointLocks.ts` (corpus gated like `packages/harness/eventRank.tracer.test.ts`: skips with a message when `data/corpus.sqlite` is absent). For every non division DCMP of 2023 to 2026 whose district has a published `cmpSlots`: build the stops "alliances final", "after Round 1" to "after Round 5", "playoffs final, awards open", and Now, from the corpus (`event_alliances.picks`, `matches` with comp_level sf and f, the district artifact's DCMP rows for points). Compute statuses with the SAME functions the tab uses (`buildChampLedgerRows`, `computeChampLedgerStatuses`), passing distributions that carry only the bracket facts (`playoffMilestoneByTeam` plus the new bracket input), no Monte Carlo.
- Tenet A: a team shown `Locked` on points at any stop must be `locked` or `lockedAward` in the artifact's published `champLock.status` at Now. Exit 1 on any violation. Report per stop: teams locked under the shipped rule alone, teams locked by the joint proof, and the first stop each eventual qualifier is locked at, before and after.
- Add `measure:champ-joint-locks` to package.json. Run it in this task and put the full table in the SUMMARY. Zero violations is the acceptance bar; if any appears, the proof is wrong and the task stops there (do not loosen the check).
- Keep `scripts/measureChampTenets.ts` green as well (it passes no bracket, so it exercises the fallback path).

### D5. Exhaustive and property tests on the proof itself
- A pure test enumerates EVERY completion of a partly played synthetic bracket (8 alliances, small integer points) with a tiny award budget (C=1, K=1) and every award assignment, computes the real number of slot takers against each team, and asserts it never exceeds bound_T. A second, sampled test (seeded, 20,000 random futures per case) does the same with realistic budgets (C=5, K=13) and real 2026 point values.
- Pins: the FNC 2026 Round 5 case from the 2026fnc artifact and the alliance list in this file's RESEARCH. Under the one award cap and 60 for second place the planner's exact prototype locks 2724, 9496, 9032, 4795 and 3506 and not 4561, 8429, 1533, 7890 or 6500; with 75 for second place the set may shrink. The pin asserts the set D2 actually produces, AND that every team in it is `locked` or `lockedAward` in the artifact at Now, AND that 6500 (eliminated at Now) is never in it. Also pin the "playoffs final, awards open" stop (prototype: 9496, 9032, 2724, 3506 joint locked; frc7890, Locked today by the ceiling test with 10 threats against 11 slots, must NOT be joint locked, since the awards then went below its floor) and the division case where the proof does not run.
- The planner's nine readings of D2 and D3 (its planning report, 2026-10-09) are accepted and locked: exact resource maximum rather than a fixed greedy, a backup seat pays its points even when it does not reach the floor, prequalified teams not yet award qualified count as slot thieves, unpicked means every rival on no alliance, extra_X as defined there, alive means unplaced or any member without `settledElim`, a single championship means exactly one dcmp tier key (2026 California's two championships fall back), the no alive alliance case needs the posted winner, K = 14 (all time maximum 13 plus 1).

### D6. Rendering and copy
- No new chip. A joint lock reads `Locked` like any points lock; `lockedBy` carries `"joint"` for the drawer and tests.
- Methodology (`districtLedgerContent.ts`): one paragraph after the pooled Locked paragraph describing the joint proof in flat third person, no dash characters: once the District Championship alliances are picked, Locked also counts, for the team, the most rivals that can pass it or take a slot from it in any way the bracket and the awards can still fall, counting each rival once, and locks the team when that count is below the open slots. Keep the sentence about slots held back for the shipped fallback.

### D7. The shipped settled value must also use the placement MAXIMUM in the lock math (orchestrator, 2026-10-09, after the planner's reading 12)
- `settledPlayoffPoints` (quick task 261008-26o) settles a decided alliance at `playoffPoints(...)`, 60 for a losing finalist, and `settledElimBounds` puts a non exact value into the CEILING. TBA can pay that finalist 75. So at Now, between the final ending and TBA posting the rows, the shipped ceiling test under reserves a rival by 15 on BOTH Locks tabs. That is a live soundness gap and it is in scope: the ceiling a non exact settled value contributes must be `maxPlayoffPointsByPlacement`, while the grey cell keeps PRINTING `playoffPoints` (the display question stays todo 5a of 261008-26o). Split the settled record into the printed `points` and the `ceiling` the lock math reads, or equivalent, with a test pinning a decided second place at Now: cell prints 60, ceiling contributes 75, floor contributes 0. Exact values (every rewound stop over a finished event) are unchanged.

### Claude's Discretion
- Module placement: a pure `packages/core/districts/champJointLock.ts` (no React, no zod, no I/O) taking plain inputs, called from `champLedgerStatus.ts`; the bracket facts travel on `DistrictEventDistributions` (new optional field built in `districtLedgerRows.ts` from the event artifact and the district rows, not from the Monte Carlo result) or on a parallel map, whichever keeps `ChampLocksLedger.tsx` smallest.
- Whether `locks.ts` takes a per team `jointLocked` set or `champLedgerStatus.ts` ORs the result after `computeLocksWithQualifiers`. Prefer the former so `lockedBy` is set in one place.
- Test fixture shape for the corpus free tests (synthetic artifacts are fine; `data/fixtures/phase10/district-2026pnw.json` has no DCMP bracket).

</decisions>

<specifics>
## Specific Ideas

- The analysis script that produced the 8 vs 0 result: `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/champ-r5.mjs` (reads the live 2026fnc artifact saved at `%TEMP%/fnc.json`). Its placement handling is a cruder relaxation than D2; D2 is the spec.
- FNC 2026 DCMP alliances (TBA, pick order): 1 = 9496, 9032, 8205, 6004; 2 = 4795, 4561, 7763, 6639 (won); 3 = 6500, 3506, 5160; 4 = 2724, 1533, 6894; 5 = 4828, 8738, 3229, 11179; 6 = 7890, 8429, 8727; 7 = 4829, 2059, 4534; 8 = 4935, 6502, 7918. Final: alliance 2 beat alliance 1 in two matches. Awards: Impact 4561; EI 2682, 587; RAS 11417, 11297; twelve 15 point judged awards.
- 2026 dcmp values: placements 90/60/39/21, award ceiling 45, Impact 30, EI 24, RAS 24, judged 15.
- Corpus access: `packages/corpus/db.ts` (`openCorpusReadOnly`, `selectEventAlliancesForSeason`, `selectMatchesChronological`, `selectDistrictRankings`); `event_alliances.picks` is a JSON array; `district_rankings.event_points_raw` is a JSON array of per event rows with `alliance_points`, `elim_points`, `award_points`, `event_key`, `district_cmp`.
- Run tests with `npx vitest run <paths>` from the repo root, never `timeout <n> pnpm ...`. Three typechecks: `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json`. After the history regeneration run `npx tsx scripts/measureChampCutoff.ts --check-history`.
- Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/locks.ts` (ceiling and pooled proofs, `computeLocksSplit`, `pointsRaceSlots`), `champReservedSlots.ts` (the flat reservation this proof supersedes when it applies), `bracket.ts` (`routePlayedBracket`, `allianceBracketMilestones`, `bracketDecisionsFromPlayedMatches`, `playoffPoints`, `MAX_WINNING_ALLIANCE_SIZE` lives in champReservedSlots), `hypotheticalDcmp.ts` (`dcmpAwardCountCeilings`), `scripts/measureChampCutoff.ts` (`buildDcmpHistory`, `--write-history`, `--check-history`)
- `apps/web/src/components/districts/champLedgerStatus.ts` (header decisions 1 to 4), `districtLedgerRows.ts` (`playedBracketMatchesFor`, `suppliedAlliances`, `DistrictEventDistributions`, `settledPlayoffPoints`, `settledElimBounds`), `champLedgerRows.ts` (`ChampLedgerSource`, `sourceOf`)
- `scripts/measureChampTenets.ts` (the sweep shape to mirror), quick tasks 261006-3gg (reservation), 261008-26o (settled playoff cells), 260925-pl6 (pooled proof), the Liatys and Papa 2024 paper the pooled proof cites
- `.planning/quick/261009-2tr-champ-locks-joint-worst-case-lock-proof-/261009-2tr-RESEARCH.md` (measurements behind D2 and D3)
</canonical_refs>
