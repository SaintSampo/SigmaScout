# Quick Task 261009-tx9: The divisioned joint proof follows the backup robot rule - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the gaps. do not leave anything undone." Quick task 261009-kt3 left three cautious terms in the DIVISIONED joint lock proof (`packages/core/districts/champJointLock.ts`, `divisionedJointFrames`) because the backup robot rule was unverified ("a team on a division roster and then on a finals roster"). They cost about 22 of 2,667 divisioned lock stops (follow ups 13 and 16 of `.planning/todos/pending/champ-joint-lock-follow-ups.md`). The rule is now verified, so the terms go.

THE RULE, three independent sources:
- 2026 manual, District Tournaments ([frcmanual.com/2026/district-tournaments](https://www.frcmanual.com/2026/district-tournaments)): "If an ALLIANCE in a District Championship Playoff has not yet recruited a BACKUP TEAM per section 10.6.3 BACKUP TEAMS, the ALLIANCE CAPTAIN may bring in only the highest ranked team from their division's BACKUP POOL to join its ALLIANCE."
- FIRST's 2026 Alliance Selection Script: the backup pool is the next eight highest ranking UNSELECTED teams; each alliance has ONE opportunity to substitute in a robot from the backup pool; backups come in by ranking order.
- Corpus (`data/corpus.sqlite`, every divisioned championship 2017 to 2026: 24 championships, 64 finals alliances): no division or finals alliance lists more than 4 teams; exactly 2 teams were added for a finals, both UNPICKED teams of the alliance's OWN division; no finals roster ever carried a team from another alliance or another division.

So, at a divisioned championship: an alliance has at most ONE backup for the whole championship (division playoffs and finals together); a backup is an unselected team of that alliance's OWN division; a team already on an alliance is never a backup.

Scope: the divisioned frames in `champJointLock.ts`, the divisioned inputs in `apps/web/src/components/districts/champLedgerStatus.ts`, their tests, the sweep pins. The SINGLE and MULTIPLE (California) shapes are NOT touched: every single event and California bound and locked set must stay byte identical.

Soundness first. Zero sweep violations, zero skipped, and no stop may LOSE a lock it has today.

</domain>

<decisions>
## Implementation Decisions

### D1. One backup per alliance for the whole championship (removes reading R5's extra seats)
- An alliance's spare seats stay `MAX_WINNING_ALLIANCE_SIZE` minus its CONFIRMED picks (alliance selection points above 0 at its division; 261009-kt3 D10 and guards G1, G2 stay: at a rewound stop a listed backup is a hindsight fact, so it is read as an unpicked rival and the seat stays open). Those seats are ONE pool per alliance: a backup that joins in the division playoffs is the alliance's backup in the finals. Remove the second set of seats R5 added (the candidate winner W's extra seats at the division value while its division is undecided beside its finals fill ins, and the extra seats at the finals non champion value on alive alliances of other divisions).
- A backup on W: covered as a fill in (it qualifies with the champion), at most `spare(W)` of them.
- A backup on an alive alliance of another division: paid that alliance's scenario value, which already is 90 plus the finals non champion maximum (261009-kt3 D4 step 3), at most `spare(A)` each.
- A backup on a decided division winner still alive in the finals: paid its finals scenario value, at most `spare(A)`.

### D2. A backup comes only from the alliance's own division's unselected teams (removes "finals seats open to any rival" and guard G3)
- Every seat and every fill in of an alliance in division d can be taken only by an UNPICKED rival of division d: a pool or slot only rival that has a dcmp row at division d's key and is on no alliance's confirmed picks there. A rival with no dcmp row cannot take a seat (it is not competing; the proof runs only once Qualification and Alliance selection are final, when every competing team has a row).
- Remove `anyRivalSeats` (the 261009-kt3 executor's addition) and `fillInsFromAnyRival` (G3): a pick of an eliminated alliance is never a backup, and a fill in never comes from another division.
- A rival with no row still takes a slot through a consuming award, as today.

### D3. A seat in the champion's division pays the division value only (removes D9)
- Remove `enumeratedSeatBonus`: an alive alliance other than W in W's division does not reach the finals, and its backup is not available to another alliance.

### D4. Tests keep the proof honest
- The exhaustive and sampled soundness tests (E3 and its variants, S2, the targeted real future tests) are regenerated over RULE LEGAL futures: each alliance takes at most one backup for the whole championship, drawn from its own division's unpicked teams with a row; the champion's backup qualifies with it; a backup is paid the points of the matches its alliance wins after it joins, never more than the alliance's own value. Every legal future's real slot takers must stay at or below the bound.
- A legality test on the samplers themselves: no sampled future contains a second backup on one alliance, a backup from another division, or a backup that was a confirmed pick.
- Mutation checks, each reverted and reported: (M1) drop the finals non champion value from other division values; (M2) drop W's fill ins; (M3) drop the seats on alive alliances of other divisions; (M4) restrict fill ins to rivals already covered; each must make at least one soundness test fail.
- The 261009-kt3 unit tests that pinned R5's extra seats, D9's bonus and the any rival seats are rewritten to pin their absence, each citing the rule.

### D5. Gates
- `npx tsx scripts/measureChampJointLocks.ts`: zero violations, zero floor gaps, `SKIPPED (0)`; the single subtotal line `31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0` unchanged, unless quick task 261009-tx8's tie routing has already moved it, in which case the line must equal the line printed BEFORE this task's first edit (take that baseline first).
- Single event and California dumps byte identical before and after (the scratch `dumpSingle.mts` and `pgq_dumpCa.mts`).
- Per stop, per divisioned championship: combined locks after are at or above before (no lock lost). Report the gains per stop.
- FIM and NE pins: replaced with the executed sets, reported, never fitted; every member `locked` or `lockedAward` at Now; nobody who missed in a set.
- `measureChampTenets.ts`, `measureChampCutoff.ts --check-history` (stop and report on drift), full vitest, three typechecks.

### D6. Header and todo
- The module header states the rule with its three sources and replaces the paragraphs that justified R5, D9 and the any rival seats.
- Todo: strike items 13 and 16 as CLOSED by this task.

### D7. Amendments after the plan check (orchestrator, 2026-10-09)
- D2's sentence "a rival with no dcmp row cannot take a seat" is REPLACED: a pool or slot only rival that no division group names is eligible in EVERY group (the covering side), so the proof never depends on a competing team's row being posted. Measured cost on the 16 championships: zero lock stops.
- A gap in the shipped 261009-kt3 proof is fixed here: when T is only a LISTED, unconfirmed fourth of an alive alliance, the frame where that alliance wins was skipped as if it qualified T. The frame is no longer skipped when a seat group names T (T is not yet on that alliance at the stop). Cost on the corpus: zero. Mutation M7 guards it.
- No new todo items: readings go in the module header and the SUMMARY.
- The soundness tests enumerate listed unconfirmed fourths (both futures) and a decided division with a spare seat; mutations M1 to M7 must each fail a soundness test; mutations are applied as patches and removed with `git checkout`, never by copying a saved file back.

### Claude's Discretion
- How the per division unpicked sets reach the frames (a field on the divisioned input).
- If a step is ambiguous take the side that covers MORE rivals and record the reading.

</decisions>

<specifics>
## Specific Ideas

- Current divisioned frames: `divisionedJointFrames`, `JointLockFrame.anyRivalSeats`, `fillInsFromAnyRival`, `finalsSpareByAlliance`, `enumeratedSeatBonus`, guards G1 to G3 (261009-kt3 SUMMARY "Readings applied" and "Deviations").
- Current numbers (after 261009-pgq): divisioned 16 championships / 156 stops / proof at 140 / shipped 1,582 / joint only 1,085 / combined 2,667 / 0 violations. Pins: FIM Divisions final 63, FIM Finals decided 64, NE Divisions final 18, NE Finals decided 16.
- Additions for a finals in the corpus: 2023micmp alliance 1 added frc5926, 2026micmp alliance 4 added frc4327, both unpicked in their own division.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); typechecks root, web, e2e chained with `&&` and a sentinel echo. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/261009-kt3-champ-locks-joint-proof-for-divisioned-c/` (CONTEXT D4, D9, D10; SUMMARY readings R5, R8 and the executor's deviation 1; VERIFICATION)
- `.planning/quick/261009-pgq-champ-locks-earliness-a-rowless-team-lea/261009-pgq-SUMMARY.md`
- `packages/core/districts/champJointLock.ts`, `champJointLock.test.ts`; `apps/web/src/components/districts/champLedgerStatus.ts` (`divisionedJointProof`); `scripts/measureChampJointLocks.ts`, `scripts/measureChampJointLocks.test.ts`
</canonical_refs>
