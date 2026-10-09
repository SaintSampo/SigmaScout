# Quick Task 261009-2tr: Research

**Gathered:** 2026-10-08 and 2026-10-09, by the orchestrator, read only against the live site, the local artifacts and `data/corpus.sqlite`.

## 1. The live rule, measured

Champ Locks, FNC 2026 (`2026fnc`, 15 slots, 52 teams at the DCMP `2026nccmp`), probed on sigmascout.org with Playwright:

| Stop | Locked | In range | Reserved slots | Lock slots |
|---|---|---|---|---|
| Alliances done | 0 | 10 | 9 | 6 |
| Round 3 | 0 | 11 | 9 | 6 |
| Round 5 | 0 | 11 | 9 | 6 |
| Playoffs final, awards open | 6 (4 winner, 2 points) | 6 | 5 | 10 |

Emulating Round 5 from the Now artifact (quals and alliance final, decided alliances settled, finalists open at +90, awards open at +45 for everyone):

| Team | floor | shipped threats (need < 6) | joint bound (need < 15) | qualified at Now |
|---|---|---|---|---|
| 2724 | 260 | 10, no | 11, LOCKED | yes (locked) |
| 9496 | 259 | 10, no | 10, LOCKED | yes |
| 9032 | 259 | 10, no | 10, LOCKED | yes |
| 4795 | 244 | 10, no | 9, LOCKED | yes (winner) |
| 3506 | 243 | 10, no | 12, LOCKED | yes |
| 4561 | 232 | 14, no | 10, LOCKED | yes (winner) |
| 8429 | 231 | 15, no | 13, LOCKED | yes |
| 1533 | 226 | 15, no | 14, LOCKED | yes |
| 7890 | 220 | 16, no | 15, no | yes |
| 6500 | 216 | 16, no | 16, no | no (eliminated) |

The joint bound there used a cruder placement relaxation than CONTEXT D2 (every non winner alive alliance at +60, or none); D2's distinct 60/39/21 assignment sits between and is the spec.

## 2. Why the shipped rule is loose (code)

- `packages/core/districts/champReservedSlots.ts:95` `reservedChampSlots`: `4 + sum(award ceilings)` while playoffs and awards are open. Flat; never reads which alliances are alive; a rival counted as a threat is also implicitly reserved against.
- `apps/web/src/components/districts/champLedgerStatus.ts` header decision 2 and line ~356: "No pooled argument is passed." Every rival's `maxRemaining` adds the whole 45 award ceiling (and 249 before the DCMP starts).
- Only a DECIDED placement enters a rival's reach (`settledElim`, quick task 261008-26o). A finalist's floor carries nothing from the playoffs.
- `locks.ts` `computeLocksSplit` ORs the ceiling and pooled proofs; `lockedBy` is `"ceiling" | "pooled" | "both" | null`. The joint proof follows the same OR pattern.

## 3. Award structure at DCMPs, measured (`data/local-publish/districts`, 2023 to 2026, awards posted)

Non division championships (CHS, GA, IN, IS, MR, NC, PN, SC, CA x2 in 2026), 70 entries:

- 15 point judged awards: 11 or 12 at every one, never more (`n15 = (sum - 30*impact - 24*(ei + ras)) / 15`).
- Consuming awards: Impact 1 to 2, EI 1 to 2, RAS 0 to 2 (`dcmpAwardCountCeilings` already covers these).
- Per team award maximum: 30 (Impact alone). Nobody stacked awards. The 45 ceiling is therefore conservative.
- Total award points: 219 to 336 per championship. The district tier award pool constant times 3 (273) UNDERSTATES this, so a pooled award argument must use DCMP measurements, never the district constants scaled.

Division championships (FIM `micmp1..4` + `micmp`, NE, ON, TX): each division gives 12 judged awards and 0 consuming; the finals event gives the consuming awards (Impact up to 5 at FIM). `perChampionship` folds these keys; the proof does not run for them (CONTEXT D1).

Sample, FNC 2026 DCMP (TBA awards): Impact 4561; EI 2682 and 587 (both far below the cut, which is the slot stealing the reservation exists for); RAS 11417 and 11297; twelve 15 point judged awards; Woodie Flowers Finalist, Leadership Finalist, Volunteer of the Year and Dean's List pay nothing.

## 4. Alliances and backups, measured (`data/corpus.sqlite`)

- DCMP alliance sizes 2023 to 2026 (event_type 2 and 5): 3 picks at 559 alliances, 4 picks at 65; never more than 4. `MAX_WINNING_ALLIANCE_SIZE = 4` holds.
- At non division DCMPs, every fourth listed pick with a district row carries 0 alliance selection points (35 of 35; 8 had no row). A listed pick with 0 alliance points is a backup robot that joined during the playoffs. 5 third picks also carry 0 (short alliances filled by a backup).
- Unpicked teams later paid playoff points (backup calls): 2 to 5 percent of unpicked teams per season and tier; 4.6 percent at 2026 DCMPs. So an unpicked team is never settled at 0 and a winning alliance can include a team from the unpicked pool.
- `event_alliances.picks` is a JSON array in TBA pick order; `status_raw` carries TBA's status object (`won`, `eliminated`, `level`).

## 5. Playoff points: the manual's rule, proration, and the 25 point finalist

2026 manual 11.1.3 ([frcmanual.com](https://www.frcmanual.com/2026/district-tournaments)): base points by placement, first 20, second 20, third 13, fourth 7, PLUS "5 points for each Finals MATCH won and in which the team participated, up to a maximum of 10 points"; backups "DE Points equal their beta value multiplied by the percentage of DE MATCHES won by their ALLIANCE in which that team participated". So the winner's members reach 30 and a LOSING FINALIST who won one Finals match reaches 25, above `playoffPoints`' 20. TBA's rows confirm it (unweighted, 2023 to 2026): district tier rows at 25 appear 4, 1, 4 and 4 times per season; DCMP rows never show 75 so far but the rule allows it. Every other off table value (4, 5, 6, 9, 12, 14, 15, 17, 19, 24) is a proration BELOW a placement maximum. Consequences for the proof: placement maxima are 30 / 25 / 13 / 7 (90 / 75 / 39 / 21 at a DCMP); T's own alive alliance playoff points cannot be banked as a floor (T could be substituted), so m_T carries none. The simulation's 20 for second place is a separate, small under prediction to record as a todo, not part of this task.

## 5b. Award stacking, measured

TBA district point rows, per team per event, award points unweighted: 2023 to 2026 show ONLY the values 5, 8 and 10 at district events (6,500 rows with points) and 15, 24 and 30 at DCMPs (1,150 rows). No team has been paid for two awards at one event since 2022 (one row in 2022; 12 to 21 rows per season in 2016 to 2020, values 13 and 15). FIRST's judging guidance: no team receives more than one judged award at an event (the Judge Manual PDF is image only; the sentence is quoted by secondary sources). Jacob, 2026-10-09: the proof caps each rival at ONE point paying award.

## 6. Data the browser already has at a DCMP stop

- The champ tab fetches the DCMP event artifact for the rewind (`useAsOfRewind`, `asOfRewind.ts`); `EventArtifactSchema.alliances` (`allianceNumber`, `picks`, optional `record`) and `matches` (played elimination rows with `compLevel`, `setNumber`, `matchNumber`, `actualWinner`, team lists).
- `districtLedgerRows.ts`: `playedBracketMatchesFor(artifact, asOfKeys)` resolves played elimination matches to alliance numbers (with `unresolvedMatchKeys` disclosed); `suppliedAlliances(artifact)`; `allianceListIsPartial`. The browser run's result carries `playoffMilestones` (derived once from `routePlayedBracket`, no Monte Carlo error) and reaches the rows as `DistrictEventDistributions.playoffMilestoneByTeam`.
- The district artifact rows carry each team's DCMP `alliance` (selection points) and `elim`, which the membership rule in CONTEXT D2 reads.
- `computeChampLedgerStatuses` builds `lockInputs` (floor, maxRemaining) per team, reads `settledElim` from `ChampLedgerSource`, and calls `computeLocksWithQualifiers(lockInputs, cmpSlots, qualifiers, reservedSlots)` with no pooled argument. `pointsRaceSlots` gives `pointsSlots` (S' in D2) and `lockSlots`.

## 7. Sweep infrastructure

- `scripts/measureChampTenets.ts` sweeps every position of every published district with NO distributions (so no bracket facts) and checks the two tenets against the artifact's published `champLock.status` at Now; `pnpm measure:champ-tenets`. Its loop (`sweepChamp`) is the shape to mirror: `champTierEvents`, `buildDistrictTimeline`, `districtStageAtPosition`, `buildDistrictLedgerRows` for the locked out set, `buildChampLedgerRows`, `computeChampLedgerStatuses`.
- `data/local-publish/district-events` holds NO DCMP event artifacts (0 files match `cmp`), so the bracket and alliances for a sweep come from the corpus. Corpus gated tests already exist (`packages/harness/eventRank.tracer.test.ts`, `pointPool.reconciliation.test.ts`); the corpus is opened with `node:sqlite` `DatabaseSync` read only via `packages/corpus/db.ts`.
- `scripts/measureChampCutoff.ts --write-history` generates `packages/core/districts/dcmpHistory.generated.ts` from the local district artifacts; `--check-history` fails on drift. Memory: run `--check-history` after any district verdict change.

## 8. Risks

- A judged award count above the ceiling would break soundness; the margin of 1 over the all time maximum and the uniform FIRST award slate make this remote, and the sweep would catch a historical case.
- Using Now's alliance list at a rewound stop can only ADD a backup that joined later; the membership rule (alliance points > 0) removes it, and fill ins cover it as an arbitrary unpicked team, so the count bound is not weakened.
- A playoff match whose sides cannot be mapped to one alliance each (`unresolvedMatchKeys`) must disable the proof for that stop, not be skipped.
- Performance: at most 8 winners x 210 placement assignments x 52 rivals per team per position, about 9 million simple operations for a 52 team field, fine in the browser; the sweep runs offline.
