---
phase: quick-261009-2tr
verified: 2026-10-09T14:40:00Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Quick 261009-2tr: Champ Locks joint worst case lock proof, Verification Report

**Goal:** a joint worst case lock proof OR-ed with the ceiling test, plus a corpus sweep guaranteeing no lock is shown for a team that then misses. Soundness first, earliness second.
**Status:** passed. No under count found. Re-verification: No.

## Evidence run by the verifier (not taken from SUMMARY.md)

| Check | Command | Result |
|---|---|---|
| Unit and component suites | `npx vitest run packages/core/districts apps/web/src/components/districts` | 51 files, 1465 tests passed |
| Sweep and methodology suites | `npx vitest run scripts/measureChampJointLocks.test.ts apps/web/src/components/methodology/districtLedgerContent.test.ts` | 22 passed (FNC pins included) |
| Corpus sweep | `npx tsx scripts/measureChampJointLocks.ts` | exit 0; 31 championships, 248 stops, proof ran at 217; shipped 340, joint only 414, combined 754; 167 qualifiers earlier; `VIOLATIONS: none` |
| Tenet sweep | `npx tsx scripts/measureChampTenets.ts` | `VIOLATIONS: none` (Locked on points 7,234 shown, 0 violations) |
| History drift | `npx tsx scripts/measureChampCutoff.ts --check-history` | no drift, both generated files |
| Maxima | scratch `tsx` | `maxPlayoffPointsByPlacement(2026,"dcmp",1..8)` = 90,75,39,21,0,0,0,0; `playoffPoints(2026,"dcmp",2)` = 60; district 2nd = 25; `dcmpJudgedAwardCeiling()` = 14 |
| Typechecks | `npx tsc --noEmit -p .` and `-p apps/web/tsconfig.json` | clean |
| Independent oracle (verifier written, scratchpad) | 400 random instances, 1,980 team checks | 0 violations, bound equal to the oracle maximum in 1,825 |

The independent oracle is separate from the shipped tests. It randomizes 3 to 8 alliances with 0 to 4 members, 0 to 4 unpicked teams, slot only rivals (one on a winning alliance), random alive subsets, posted winner and decided winner cases, C 0 to 3 and K 0 to 4. For every candidate winner and every ordered placement assignment it enumerates every placement of the unpicked teams (none, a seat on an assigned alliance within its spare seat count, a fill in on the winner), then takes the exact award maximum `min(N, min(K, L) + C)` by formula rather than by the shipped dynamic program. The shipped `jointLockBound` never fell below it, so the dynamic program, the pruning (`ceiling <= best`), the seat cache and the `alwaysCovered` prefilter are not hiding an under count.

## Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | D2 exists as a pure core proof; `jointLockedTeams` locks T iff bound < S' | VERIFIED | `packages/core/districts/champJointLock.ts` imports only `./bracket.js`; `jointLockedTeams` uses `jointLockBound(..., pointsSlots) < pointsSlots` |
| 2 | Soundness is tested: exhaustive E1, E2 and sampled S1 | VERIFIED | The tests pass (E1 128 completions, E2, S1 4 cases x 20,000). The verifier's oracle agrees |
| 3 | Maxima 90,75,39,21,0,0,0,0; `playoffPoints` unchanged; both placement spots read maxima | VERIFIED | Printed values above. `champLedgerStatus.ts` passes `maxPlayoffPointsByPlacement(year,"dcmp",2..4)` and `settledPlayoffPoints` sets `ceiling` from it |
| 4 | D7: decided non exact placement prints 60, ceiling 75 on both Locks tabs | VERIFIED | `settledPlayoffPoints` returns `{points: playoffPoints, exact:false, ceiling: max...}`; `settledElimBounds` returns `{floor:0, ceiling: settled.ceiling}`; `districtLedgerStatus.ts` is not in the diff and calls `settledElimBounds` (line 334); pins at `districtLedgerRows.test.ts` lines 1587, 1590, 1752, 1753 |
| 5 | One point paying award per rival, a named constant | VERIFIED | `MAX_POINT_PAYING_AWARDS_PER_TEAM = 1`; read only in `judgedCost` (cost > 1 gives Infinity), which feeds both the picked prefix sums and the unpicked dynamic program. No path gives a rival two judged awards or a judged plus consuming lift |
| 6 | R1, R2, R3 greedy undercount cases give 2; dominance over a reference greedy | VERIFIED | In the passing suite; exact maximum structure confirmed by reading the code and by the oracle |
| 7 | `computeLocksWithQualifiers` OR-ing and `lockedBy` union | VERIFIED | `locks.ts` diff: `lockedByJoint` OR-ed beside the pooled test, `lockedByOf` returns the three shipped values when joint is false, elimination branch and `pointsToLock` untouched; `pointsSlots` (unreserved S') is what the proof reads |
| 8 | `judgedAwards` in the history; K = 14; `--check-history` clean | VERIFIED | Printed above |
| 9 | Tab preconditions and refusals | VERIFIED | `jointProofAt` refuses in order: no distributions, not exactly one dcmp key, no facts, Qualification or Alliance selection not final or Awards final, no capacity, never happening, winner not posted, unroutable bracket, no candidate winner. `dcmpBracketFactsFor` also refuses a partial list, 2022, a non district-tier-dcmp, and any unresolved row |
| 10 | Browser carries bracket facts from the run's own input | VERIFIED | `useDistrictLedgerData.ts` builds `dcmpBracketFactsFor` from `request.input.knownAlliances` and `playedElimMatches` (set at `districtLedgerRows.ts` lines 985 and 988) and `unresolved` from `assembled.eventsWithUnresolvedElimMatches`; `ChampLocksLedger.tsx` passes `distributions: data.distributions` |
| 11 | Sweep uses the tab's own functions and exits 1 on a violation | VERIFIED | `statusesAtStop` calls `buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`, `buildChampLedgerRows`, `computeChampLedgerStatuses`; `process.exitCode = 1` when violations exist; also fails when the combined run drops a shipped lock. Ran: 0 violations, exit 0 |
| 12 | FNC 2026 pins (Round 5 and Playoffs final) | VERIFIED | `scripts/measureChampJointLocks.test.ts` passes; Round 5 locks 2724, 9496, 9032, 4795, 3506 and not 4561, 8429, 1533, 7890, 6500 |
| 13 | Methodology paragraph, flat third person, no dash, Impact paragraph unchanged | VERIFIED | Diff adds exactly one paragraph directly after the pooled Locked paragraph; it contains no hyphen or dash character; no other paragraph touched |

Behavior dependent truths (1, 2, 5, 7) rest on passing tests, not on symbol presence.

## Under count hunt (the specific cases asked about)

| Suspect | Result |
|---|---|
| One resource covering two rivals | None. The count is `covered + min(\|X\|, SJ + C + min(f, \|X_U\|))`. A seat or judged award is spent by the dynamic program once per rival (usage per seat value and judged budget are tracked), consuming awards and fill ins are separate counted resources, and the union bound over categories can only over count |
| Strict comparison where a tie counts against T | None. Points pass uses `>=`; `judgedCost` takes `ceil(deficit/15)` so a lift to exactly T's floor counts; seat plus judged uses `deficit - seatValue <= 0` as cost 0 |
| A rival taken below its maximum | None found. `extra` is the shipped open ceiling minus only the DCMP Awards ceiling (modelled by C and K) and an unsettled open DCMP Playoffs ceiling (modelled by placements and seats). A settled non exact placement sits at its maximum via `settled.ceiling`; a settled team with no routed placement gets the whole elim ceiling via `jointDecidedPlacementTopUp`. Alliances with any unsettled listed pick are forced alive |
| `playoffPoints` where a maximum is needed | None. `champLedgerStatus.ts` and `settledPlayoffPoints` use `maxPlayoffPointsByPlacement` / `maxEventPoints(...).elim` for every bound; `playoffPoints` is used only for the printed `points` |
| Prequalified or posted award qualified teams | Handled. Posted award qualifiers are out of the pool and out of S'. Prequalified teams not award qualified are `slotOnlyRivals`: counted as W members, consuming recipients and fill ins, never on points |
| The one award per rival constant bypassed | No. Single read site, `judgedCost` |
| Placement assignment reduction (reading 9) | Sound: placements 5 to 8 pay 0, so only 2nd to 4th are positive, the top `min(3, \|others\|)` maxima assigned to every ordered choice of distinct alive non winner alliances dominate every real assignment. Confirmed by exhaustive tests and the oracle |
| Early return and pruning | `alwaysCovered >= stopAt` is a valid lower bound only if a non skipped winner exists, which is checked first. The `ceiling <= best` skip uses a valid upper bound on SJ (`min(liftable rivals, K + seats)`) |

No concrete input that triggers an under count was found.

## Assumptions the proof rests on (not gaps; recorded so they stay visible)

1. **Alliance roster at most 4, backups only from teams on no alliance.** Data check: winner award recipients per 2023 to 2026 DCMP are 3 (42 events) or 4 (7 events), never more.
2. **A backup robot TBA never lists** (follow up todo item 8). Verifier measured the corpus: across all 94 DCMP events of 2023 to 2026 with published alliances, zero teams played a playoff match without being in some alliance's `picks`. The concern is empirically absent; the proof still reads such a team as unpicked with no playoff points from a decided alliance. Worth watching live, not a blocker.
3. **Constants C, K = 14, one point paying award per team, placement maxima** are measured constants (CONTEXT D2, D3). The sweep is the guard if one changes. K = 14 was confirmed (13 maximum observed plus margin 1).
4. **"Final" stage implies TBA has posted the rows**, the same assumption the shipped ceiling test makes. Not introduced by this task.
5. Live membership before TBA posts DCMP alliance points reads no members (todo item 6). Verified sound by reasoning: every alliance then has four spare seats and every winner four fill ins, which covers the real roster.

## Advisory, not blocking

- The `useDistrictLedgerData.ts` memo and the `ChampLocksLedger.tsx` argument are wiring verified by code and type reading and by the shared function path in the sweep. No hook level test exercises them, and the e2e specs are live only. An optional visual check on a finished or live single event championship (for example a past 2026fnc Round 5 stop) would show Locked on the five pinned teams.
- The sweep checks one realized future per stop. Soundness over all futures rests on the exhaustive and sampled tests plus the verifier oracle above, all of which pass.

---

_Verified: 2026-10-09_
_Verifier: Claude (gsd-verifier)_
