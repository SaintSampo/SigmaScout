# Quick Task 261009-kt3: Research

**Gathered:** 2026-10-09 by the orchestrator, read only against `data/corpus.sqlite`, `data/local-publish/districts` and the 2026 manual.

## 1. The shapes

| District | dcmp keys | Shape | cmpSlots 2026 |
|---|---|---|---|
| fim | micmp1, micmp2, micmp3, micmp4, micmp | 4 divisions + finals | 83 |
| ne | necmp1, necmp2, necmp | 2 divisions + finals | 32 |
| ont | oncmp1, oncmp2, oncmp | 2 divisions + finals | 21 |
| fit | txcmp1, txcmp2, txcmp | 2 divisions + finals | 28 |
| ca (2026 only) | cancmp, cascmp | two single championships | 46 |

Every division is an ordinary 8 alliance double elimination event (playoff_type 10, 80 to 120 qualification matches). The finals event has NO qualification matches and 4 alliances (FIM, playoff_type 11) or 2 alliances (NE, ON, TX, playoff_type 9, best of 3).

## 2. The finals bracket, measured

FIM finals matches mapped to alliance numbers through the finals event's `event_alliances.picks`:

- 2026micmp: sf1 a1 v a4 -> a1; sf2 a2 v a3 -> a3; sf3 a1 v a3 -> a1; sf4 a4 v a2 -> a4; sf5 a3 v a4 -> a4; f a1 v a4 -> a1, a1.
- 2025micmp: sf1 a1 v a4 -> a1; sf2 a2 v a3 -> a2; sf3 a1 v a2 -> a2; sf4 a4 v a3 -> a4; sf5 a1 v a4 -> a4; f a2 v a4 -> a2, a4, a2 (three matches).
- 2024micmp: sf1 a1 v a4 -> a4; sf2 a2 v a3 -> a2; sf3 a4 v a2 -> a2; sf4 a1 v a3 -> a1; sf5 a4 v a1 -> a1; f a2 v a1 -> a2, a2.

So: sf1 = 1 v 4, sf2 = 2 v 3, sf3 = winners (to the final), sf4 = losers (loser out, 4th), sf5 = loser sf3 v winner sf4 (winner to the final, loser 3rd), f best of 3.

2 division finals: a single best of 3 set `f`: 2023 to 2026 necmp, txcmp, oncmp show 2 or 3 matches; 2024necmp shows `f1m1: tie` then f1m2, f1m3, f1m4, so a tie is replayed and the champion is the first to two wins.

## 3. What the finals pay, manual and data

2026 manual 11.1.3 ([frcmanual.com](https://www.frcmanual.com/2026/district-tournaments)): "Each team on a Champion Alliance of a 2-Division District Championship Playoff tournament earns 10 points"; "For a 4-Division District Championship Playoff tournament, each team on a Champion Alliance earns 20 points and each team on a Finalist Alliance receives 10 points"; "Points earned at District Championships are multiplied by 3"; backups prorated per 11.1.3.

Measured finals rows (`eventPoints` at the stem key), 2023 to 2026, unweighted by 3:

| Championship | finals elim values | finals qual | finals alliance | finals award |
|---|---|---|---|---|
| fim (4 div) | 60 x3, 30 x3, 0 for award only rows | 0 | 0 | 30 x4-5, 24 x3 |
| ne, ont, fit (2 div) | 30 x3, 0 | 0 | 0 | 30 x2-4, 24 x2-4 |

A 2026 NE finalist won a Finals match (f1m2) and was paid 0: finals pay by placement only. Finals rows exist only for teams paid there (champion and finalist alliances, consuming award winners); a division champion knocked out in the finals semifinals (2026 frc6090, alliance 2) has no finals row.

Division rows pay the full DCMP playoff values: 90 / 60 / 39 / 21 (plus prorations, and 72 for a prorated champion), judged awards 15 at the divisions (12 each at every division 2023 to 2026, 11 once), never a consuming award at a division.

## 4. Winner award and consuming awards

`qualifyingAwards` type 1 (winner) sits only at the finals key: 2026micmp 3 recipients, 2026necmp 4, 2026oncmp 3, 2026txcmp 3; CA: 2026cascmp 4 and 2026cancmp 3 (both championships' winners qualify). Impact at the finals key: fim 5, ne 4, ont 2, fit 2, each CA championship 2; EI and RAS likewise at the finals key.

`dcmpAwardCountCeilings(2026, ...)`: fim {0: 5, 9: 1, 10: 2}, ne {4, 2, 2}, ont {3, 2, 1}, fit {3, 2, 2}, ca {4, 2, 2} (no own history, size band), fnc {2, 2, 2}. `dcmpJudgedAwardCeiling()` = 14.

## 5. The pre existing floor gap (D3)

`apps/web/src/components/districts/champLedgerStatus.ts` ~380: `const dcmpEntry = team.dcmpRow.sources[0]` and the loop subtracts only that source's open categories. `champLedgerRows.ts` ~946: `buildDcmpRow` sets `sources` to `[sourceOf(entry.rows[0])]`. `tierEvents` keeps artifact order: for 2026fim frc27 the rows are `[2026micmp1: 66, 48, 90, 0]` then `[2026micmp: 0, 0, 60, 30]`, so the finals 90 points never leave the floor at a rewound stop. Readers of `dcmpRow.sources`: champLedgerStatus.ts 283 (`rowStage`), 380, 460; champLedgerRows.ts 431 (`sources.length === 0`).

Finals rosters: 2026micmp alliance 4 lists frc5460, frc3538, frc7197, frc4327 while its division alliance has 3 picks; a finals listed pick absent from the division alliance is a backup (fill in). Alliance selection points at the finals event are 0 for everyone, so the "alliance points above 0" membership rule must read the DIVISION row.

## 6. Browser and sweep plumbing

- `dcmpBracketFactsFor` (districtLedgerRows.ts ~1086) requires `alliancesAreFinal(alliances, 8)` and 1..8 numbering, so it already refuses finals events; `useDistrictLedgerData.ts` ~275 attaches facts per event key; `jointProofAt` (champLedgerStatus.ts ~570) refuses `dcmpKeys.length !== 1` with `notSingleChampionship`.
- The champ tab fetches every dcmp tier event artifact (`champTierEvents`), so the finals artifact (alliances, played sf and f matches) is available at every position, live included. The rail gives the finals event no round stops; match step positions exist.
- `scripts/measureChampJointLocks.ts`: `dcmpStops`, `statusesAtStop`, `sweepJoint`, `bracketFromCorpus` (from `event_alliances` and `matches`); the skip at ~344 names the two shapes. `data/local-publish/district-events` holds no DCMP artifacts, so the corpus stays the source.

## 7. Earliness expectation (so the result is not misread)

The other division relaxation (every alive alliance at 90 plus the finals non champion maximum) means few locks at "Alliances final" for FIM: a rival needs only floor >= about 100 to reach a 265 floor. Locks arrive as divisions decide (Round 4 to 5) and at "Divisions final". That is still far earlier than today, where a divisioned championship locks nobody on points until its awards post.
