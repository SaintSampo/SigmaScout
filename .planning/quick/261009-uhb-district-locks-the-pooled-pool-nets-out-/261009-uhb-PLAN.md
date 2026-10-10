---
phase: quick-261009-uhb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/districts/pooledLockInputs.ts
  - packages/core/districts/pooledLockInputs.test.ts
  - apps/web/src/components/districts/districtLedgerStatus.ts
  - apps/web/src/components/districts/districtLedgerStatus.test.ts
  - scripts/districtLocksNoTakeBack.test.ts
  - .planning/todos/pending/locks-settled-playoffs-follow-ups.md
autonomous: true
requirements: [261009-uhb]

estimate:
  tokens: 35000
  raw_tokens: 70000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "D1: `pooledLockInputs(teams, playoffPointsInFloorsByEvent?)` takes an optional map from event key to the playoff points that event has already handed out and that are counted in team floors at the position. An event's remaining pool is its `eventRemainingPool` less that amount, only while the event's Playoffs category is open at the position, and never by more than `PLAYOFF_POOL`, so no event's pool goes below 0 and the qualification, selection and award pools are never reduced."
    - "D1: with the second argument absent every result is deep equal to today's. `packages/harness/districtRankingsMerge.ts` (the offline publisher and the live Worker) keeps its one argument call and is not edited; the existing cases of `pooledLockInputs.test.ts`, `pointPool.test.ts`, `locks.test.ts` and `districtRankingsMerge.test.ts` pass untouched; the publisher's whole artifact comparison prints `R9X COMPARE CLEAN` with 0 differing artifacts."
    - "D1: `computeDistrictLedgerStatuses` supplies the amount. Per district tier event whose Playoffs category is open at the position it is the sum, over every team row at that event, of `settledElimBounds(row.settledElim).floor`, the same call `districtLockBounds` adds to that team's floor. A settled value that is not exact is in no floor and nets nothing."
    - "D2: in a twelve team synthetic district (one leader, eleven rivals 42 points behind, nine DCMP slots, one event rewound to Playoffs open) the leader is Locked by the pooled argument alone at Alliances final and is STILL Locked by the pooled argument alone once the third place alliance's three teams carry 13 exact playoff points each in their floors; the pool falls by exactly 39. Before this task that second stop read In range."
    - "D2: on the local 2026ne artifact and the corpus, 2026cthar frc2067 reads Locked on points at all seven stops from Alliances final to Playoffs final, the pool falls by exactly the settled points at every stop (21 at Round 4, 60 at Round 5, 0 elsewhere), nobody is lost to the settled rule at any stop, and the event carries no tenet violation."
    - "D3: `npx tsx scripts/measureLedgerSettledTenets.ts` over 2023 to 2026 prints `VIOLATIONS: none` and exits 0: tenets A, B, C and D all zero over 418 events and 2,926 stops. At 62c21b5d it printed 82 violations (41 tenet C and 41 tenet D, the same 41 team stops). Locked on points under the settled rule moves 37,408 to 37,484, lost moves 41 to 0, Locked out stays 83,235."
    - "D3: `measureLedgerTenets.ts`, `measureChampTenets.ts` and `measureChampJointLocks.ts` print the same report before and after (none of them passes bracket facts to the district status code), `measureChampCutoff.ts --check-history` prints no drift, the three typechecks are clean and the full root `npx vitest run` passes."
    - "No artifact schema, no algorithm version, no Worker file, and none of `locks.ts`, `pointPool.ts`, `districtRankingsMerge.ts`, `districtLedgerRows.ts`, `champLedgerStatus.ts` or `scripts/measureLedgerSettledTenets.ts` is edited. Nothing is pushed."
    - "D4: the methodology copy is not edited (its pooled sentence and its knocked out sentence both still read true), and item 2 of `locks-settled-playoffs-follow-ups.md` carries a note that the sweep found the take backs and this task fixed the cause."
  artifacts:
    - path: "packages/core/districts/pooledLockInputs.ts"
      provides: "the optional per event playoff points in floors input, the netting against the playoff pool, and the header that states why it is sound"
      contains: "playoffPointsInFloorsByEvent"
    - path: "apps/web/src/components/districts/districtLedgerStatus.ts"
      provides: "the per event sum of exact settled playoff points, handed to pooledLockInputs"
      contains: "playoffPointsInFloors"
    - path: "packages/core/districts/pooledLockInputs.test.ts"
      provides: "the netting cases: 60 off, capped at the playoff pool, absent input identical, Playoffs final nets nothing"
      contains: "261009-uhb"
    - path: "apps/web/src/components/districts/districtLedgerStatus.test.ts"
      provides: "the twelve team synthetic district that keeps its pooled lock once a rival alliance is decided"
      contains: "261009-uhb"
    - path: "scripts/districtLocksNoTakeBack.test.ts"
      provides: "the corpus gated 2026cthar frc2067 pin through the sweep's own exports"
      contains: "2026cthar"
  key_links:
    - from: "apps/web/src/components/districts/districtLedgerStatus.ts"
      to: "packages/core/districts/pooledLockInputs.ts"
      via: "the second argument of the one pooledLockInputs call in computeDistrictLedgerStatuses"
      pattern: "pooledLockInputs\\(pooledEntries, playoffPointsInFloors"
    - from: "apps/web/src/components/districts/districtLedgerStatus.ts"
      to: "apps/web/src/components/districts/districtLedgerRows.ts"
      via: "settledElimBounds(row.settledElim).floor, the same call districtLockBounds adds to the floor"
      pattern: "settledElimBounds"
    - from: "packages/core/districts/pooledLockInputs.ts"
      to: "packages/core/districts/pointPool.ts"
      via: "PLAYOFF_POOL caps what can be netted"
      pattern: "PLAYOFF_POOL"
    - from: "packages/harness/districtRankingsMerge.ts"
      to: "packages/core/districts/pooledLockInputs.ts"
      via: "the unchanged one argument call (publisher and Worker)"
      pattern: "pooledLockInputs\\(entries\\)"
    - from: "scripts/districtLocksNoTakeBack.test.ts"
      to: "scripts/measureLedgerSettledTenets.ts"
      via: "settledDistrictContext, settledStops, statusesAtSettledStop and sweepSettledEvent, imported and never restated"
      pattern: "sweepSettledEvent"
---

<objective>
Stop the District Locks tab taking a lock back. At a rewound playoff round stop the settled playoffs rule (quick task 261008-26o) puts a knocked out alliance's exact playoff points into its teams' floors while the pooled remaining points lock still counts that event's whole playoff pool as not yet handed out. The same points sit on both sides of the pooled test, so a team shown Locked at Alliances final reads In range at Round 4 or Round 5 and Locked again at Playoffs final: 41 team stops over 21 district events of 2023 to 2026. This plan nets those points out of the pool (CONTEXT D1), tests it (D2), proves it on the corpus (D3) and notes it (D4).

Purpose: Jacob's rule, 2026-10-08: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked."

Output: one optional input on `pooledLockInputs`, one map built in `computeDistrictLedgerStatuses`, their tests, one corpus gated pin file, one todo note. The publisher and the Worker are byte identical in behaviour.
</objective>

<planner_findings>
The planner prototyped the fix before writing this plan: scratch copies of `pooledLockInputs.ts` and `districtLedgerStatus.ts` carrying the change of Task 1, run through the 261009-txb sweep prototype and then through the landed sweep itself. Every number below is PRE-REGISTERED: the executor compares its own runs against them, reports every difference, and never fits code or a pin to them.

**1. The fix brings every take back to zero. No extra step is needed.**

| measure, 48 district seasons, 418 events, 2,926 stops | before (62c21b5d) | after (prototype) |
|---|---|---|
| tenet A (Locked shown, then not qualified) | 0 | 0 |
| tenet B (Locked out shown, then qualified) | 0 | 0 |
| tenet C (Locked blunt, not Locked settled, same stop) | 41 | 0 |
| tenet D (Locked at a stop, not Locked at a later stop of the event) | 41 | 0 |
| take backs over the whole season walk (every timeline position in order, round stops inserted, 3,858 stops) | 41 | 0 |
| Locked on points, blunt rule | 36,982 | 36,982 |
| Locked on points, settled rule | 37,408 | 37,484 |
| gained by the settled rule over the blunt rule | 467 | 502 |
| lost to the settled rule | 41 | 0 |
| Locked out, blunt and settled | 82,092 and 83,235 | 82,092 and 83,235 |

Per season, Locked on points under the settled rule, before then after: 2023 8,214 then 8,227; 2024 8,786 then 8,805; 2025 9,126 then 9,142; 2026 11,282 then 11,310. Gained after: 107, 81, 161, 153. The fix adds 76 Locked on points displays (the 41 restored and 35 new at Round 4 and Round 5), takes none away, and moves no Locked out display. Of the 37,484, the sweep's census reads kept 36,770, award qualified 714, violations 0. The pool is reduced at 834 stops by 33,209 points in all, which is exactly the sweep's own "settled rows 21428 (exact 21428, not exact 0), 33209 points"; the most netted at one stop is 61, far inside the 213 point playoff pool. With no bracket facts the patched status code returned a model equal to today's at all 2,926 blunt stops.

RE-MEASURED at 16d0f64e, after 261009-tx8's tie routing commit landed during planning: every tenet and every Locked and Locked out count in the table is unchanged, before and after. Only the settled census moved, as the 261009-txb planner predicted (2023ncash Round 4 and Round 5 now settle): 836 stops netted, 33,291 points, settled rows 21,438, all exact. Expect those three figures, not the 62c21b5d ones.

**2. Why it works (the argument the header must state).** The pooled test asks whether the remaining points can lift enough rivals to a team's floor. When points are banked, each rival's cost falls by at most what it banked and the pool falls by the sum of everything banked, so any way to unseat the team after the banking is also a way to unseat it before. A pooled lock that held before still holds after. The same argument covers Round 5 to Playoffs final, where the whole 213 leaves the pool and at most 212 (the measured maximum) joins floors.

**3. Readings the planner chose (each leaves the pool LARGER, per CONTEXT discretion).**
- R1. The subtraction lives in `pooledLockInputs.ts`, as D1's own sentence says. `pointPool.ts` is not edited: `eventRemainingPool` still returns the whole open pool.
- R2. "Never below 0" is applied to the playoff pool, not the whole event pool: the amount is playoff points, so at most `PLAYOFF_POOL` is netted and only while the event's Playoffs category is open at the position. An amount above 213 (never measured) leaves the award pool whole, where D1's literal floor would have eaten it.
- R3. An amount that is absent, not finite or not above 0 subtracts nothing, and nothing is thrown: this module must never be the reason a verdict pass throws.
- R4. D2 asks for a three or four team synthetic district. That cannot show the defect: with Playoffs and awards open one event still holds at least 213 + 78 = 291 points, and a rival the ceiling test still counts as a threat sits at most 45 behind (the Playoffs ceiling 30 plus the award ceiling 15), so a pooled only lock needs at least seven such rivals. Measured: the four team version is contending at Alliances final. The synthetic has twelve teams, the smallest that reproduces it with one decided alliance.
- R5. The 2026cthar pin lives in its own file, `scripts/districtLocksNoTakeBack.test.ts`, and calls the landed sweep's exports. `scripts/measureLedgerSettledTenets.test.ts` belongs to 261009-txb, whose Task 2 still has an edit to make there.

**4. The 261009-txb sweep landed during planning.** `scripts/measureLedgerSettledTenets.ts` and its test landed at 62c21b5d with all four tenets, so D3's first branch applies. Run at 62c21b5d it prints `VIOLATIONS (82)` and exits 1. Run against the prototype it prints `VIOLATIONS: none` with the after column above, and `--district 2026pnw` is unchanged (351 and 360), so that file's 2026waahs pins do not move. After this plan lands, 261009-txb's Task 2 zero branch (the `main` exits 0 test, closing todo item 2) is open to the orchestrator. It is not this plan's work.

**5. The pins, measured through the sweep's own exports.** 2026ne, 2026cthar, after the fix, stops in order Alliances final, Round 1 to Round 5, Playoffs final with awards open: Locked on points blunt 6, 6, 6, 6, 6, 6, 9 and settled 6, 6, 6, 6, 6, 7, 9; pool blunt 4,323 six times then 4,110; pool settled 4,323, 4,323, 4,323, 4,323, 4,302, 4,263, 4,110; settled points 0, 0, 0, 0, 21, 60, 0; gained only frc1699 at Round 5; lost nobody; frc2067 Locked on points at all seven, by `pooled` at the first six and `both` at the last; no violation. At 62c21b5d the same event reads frc2067 In range at Round 4 and Round 5 with the pool 4,323 in both runs and four violations (C and D at each).

**6. A shared checkout.** Another session is editing `districtLedgerRows.ts`, `bracket.ts`, the methodology content and their tests right now (261009-tx8); its tie routing commit 16d0f64e landed while this plan was written and more of its edits sit uncommitted in the tree. None of the files this plan edits has changed since 62c21b5d. The bar is zero violations; totals are reported, not matched.

**7. Planner scratch files** in `SCRATCH/uhb/` (see context for `SCRATCH`): `uhbGate.mts` (the gate: tenets A to D plus the whole season walk through the repo's own code; printed `UHB GATE FAILED` with 41, 41, 41 at 62c21b5d and `UHB GATE CLEAN` on the prototype), `capture.sh` and `compare.sh` (the unchanged outputs check, tested: about 40 to 70 seconds, prints `UHB UNCHANGED CLEAN`), `applyFix.cjs` (the prototype patch, a map of where the change goes), `planner-before/` (the planner's own capture at 62c21b5d).
</planner_findings>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261009-uhb-district-locks-the-pooled-pool-nets-out-/261009-uhb-CONTEXT.md
@.claude/CLAUDE.md

`SCRATCH` below means `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`.

Line numbers are at 62c21b5d. Other sessions commit to this checkout; if a range has moved, find it by the quoted name.

<interfaces>
Existing contracts (read these, do not re-explore the files):

```ts
// packages/core/districts/pooledLockInputs.ts, today (127 lines)
export interface PooledTeamEvent { readonly eventKey: string; readonly final: DistrictCategoryFinality }
export interface PooledTeamEntry { readonly teamKey: string; readonly rookie: boolean; readonly events: readonly PooledTeamEvent[] }
export interface PooledEventContribution { readonly eventKey: string; readonly fieldSize: number; readonly rookieCount: number; readonly points: number } // these four fields stay exactly these
export interface PooledLockInputsResult extends PooledRemainingPoints { readonly byEvent: readonly PooledEventContribution[] }
export function pooledLockInputs(teams: readonly PooledTeamEntry[]): PooledLockInputsResult;
// line 121 today: const points = fieldSize === 0 ? 0 : eventRemainingPool({ fieldSize, rookieCount, final });

// after this plan
export function pooledLockInputs(teams: readonly PooledTeamEntry[], playoffPointsInFloorsByEvent?: ReadonlyMap<string, number>): PooledLockInputsResult;

// packages/core/districts/pointPool.ts (READ ONLY, not edited)
export const PLAYOFF_POOL: number;                       // 213
export function awardPool(rookieCount: number): number;  // 78, 86, 91 for 0, 1, 2 or more rookies
export function eventRemainingPool(event: { fieldSize: number; rookieCount: number; final: DistrictCategoryFinality }): number;

// packages/harness/districtRankingsMerge.ts line 283 (READ ONLY, not edited): return pooledLockInputs(entries);

// apps/web/src/components/districts/districtLedgerRows.ts (READ ONLY; another session is editing this file)
export interface SettledPlayoffs { readonly points: number; readonly exact: boolean; readonly ceiling: number }
export function settledElimBounds(settled: SettledPlayoffs): { readonly floor: number; readonly ceiling: number }; // exact: floor is points; not exact: floor is 0
// DistrictLedgerEventRow: eventKey, stage.final.{qual,alliance,elim,award}, earned, settledElim?: SettledPlayoffs

// apps/web/src/components/districts/districtLedgerStatus.ts
export function districtLockBounds(source, rows, ceilings): { floor: number; openCeiling: number }; // NOT edited; existing tests toEqual its two fields
export function computeDistrictLedgerStatuses(options: { artifact: DistrictArtifact; teams: readonly DistrictLedgerTeam[] }): DistrictLedgerStatusModel;
// line 387 const pooledEntries; line 394 the districtLockBounds call inside the team loop; line 447 const pooled = pooledLockInputs(pooledEntries);
// DistrictLedgerStatusModel and DistrictLedgerStatusResult gain NO field (other test files build them as literals)

// scripts/measureLedgerSettledTenets.ts (landed at 62c21b5d; READ ONLY, not edited)
export interface SettledStop { readonly label: string; readonly index: number; readonly playedKeys: ReadonlySet<string> }
export function settledDistrictContext(artifact: DistrictArtifact): SettledDistrictContext;
export function settledStops(timeline: DistrictTimeline, eventKey: string, bracket: BracketSourceEvent): SettledStop[];
export function statusesAtSettledStop(artifact, context, eventKey, stop, bracket, withSettled: boolean): { readonly statuses: DistrictLedgerStatusModel; readonly teams: readonly DistrictLedgerTeam[] };
export function sweepSettledEvent(artifact, context, eventKey, bracket, finalVerdicts: ReadonlyMap<string, LockStatus>): SettledEventSweep;
// SettledEventSweep: { eventKey, stops: SettledStopRecord[], takeBackBlunt, violations }
// SettledStopRecord: label, blunt and settled { lockedOnPoints, lockedOut, pooledRemainingPoints, ... }, gained, lost, settledRows, settledExact, settledPoints
// scripts/measureChampJointLocks.ts: CORPUS_PATH, bracketFromCorpus(db, new Map(), season, eventKey)
// scripts/measureLedgerTenets.ts: districtTierFinalVerdicts(artifact)
```
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The pooled pool nets out the settled playoff points in floors, end to end from the core input to the corpus sweep (D1, D2)</name>
  <files>packages/core/districts/pooledLockInputs.ts, packages/core/districts/pooledLockInputs.test.ts, apps/web/src/components/districts/districtLedgerStatus.ts, apps/web/src/components/districts/districtLedgerStatus.test.ts</files>
  <precondition>`scripts/measureLedgerSettledTenets.ts` exists at HEAD, and `data/corpus.sqlite` and `data/local-publish/districts` exist in the main checkout (gitignored local data; worktrees are off).</precondition>
  <read_first>
    - .planning/quick/261009-uhb-district-locks-the-pooled-pool-nets-out-/261009-uhb-CONTEXT.md (D1 to D4)
    - packages/core/districts/pooledLockInputs.ts (whole)
    - packages/core/districts/pooledLockInputs.test.ts lines 1 to 30 (the `entry` and `roster` helpers, `ALL_FINAL`)
    - apps/web/src/components/districts/districtLedgerStatus.ts lines 60 to 72, 174 to 182 and 367 to 450
    - apps/web/src/components/districts/districtLedgerStatus.test.ts lines 36 to 105 (`team`, `artifactOf`, `FINISHED`, `NO_DISTRIBUTIONS`) and 792 to 897 (the 261008-26o describe: `LIVE`, `OPEN_PLAYOFFS`, `eventRow`, `decided`, `knockedOutArtifact`, `modelWith`)
    - SCRATCH/uhb/applyFix.cjs (the planner's prototype patch: three anchors per file. It shows where the change goes; write the real code and its comments yourself)
  </read_first>
  <behavior>
    Core, a new describe in `pooledLockInputs.test.ts` named for quick task 261009-uhb, all synthetic:
    - 36 veterans at `e1` with qualification and alliance selection final, Playoffs and awards open, and a map `e1` to 60: `remainingPoints` is `PLAYOFF_POOL + awardPool(0) - 60`, `byEvent` deep equals one entry with `eventKey` e1, `fieldSize` 36, `rookieCount` 0 and that `points`, and all 36 teams are still in `hasRemainingEvent`.
    - Capped at the playoff pool: with 213 and with 500 the result is `awardPool(0)`, the award pool whole. With the award final too (only Playoffs open) and 500 the result is 0, never negative.
    - Absent input is identical: for a wholly open roster, a part played roster and a finished roster, the call with one argument deep equals the call with `undefined` and the call with an empty map. A map keyed by an event no team carries changes nothing.
    - Playoffs final at the position (Playoffs final, awards open) with 60: nothing is subtracted, the result is `awardPool(0)`.
    - An amount of 0, of -5, of NaN and of Infinity each subtracts nothing.
    - Two events both with Playoffs open and only `e1` keyed at 60: `e2` keeps its whole pool, `e1` is 60 lower, and `remainingPoints` is the sum of the two `points`.

    Status, a new describe nested at the end of the 261008-26o describe in `districtLedgerStatus.test.ts` (so `eventRow`, `decided`, `OPEN_PLAYOFFS`, `modelWith` are in scope), named for quick task 261009-uhb. Fixture: `frc1` with `pointTotal` 100 and one `eventRow("a", qual 100, alliance 0, elim 0, award 0, FINISHED)`; `frc2`, `frc3`, `frc4` with `pointTotal` 71 and `eventRow("a", qual 58, alliance 0, elim 13, award 0, FINISHED)`; `frc5` to `frc12` with `pointTotal` 58 and `eventRow("a", qual 58, alliance 0, elim 0, award 0, FINISHED)`; `dcmpSlots` 9. Both stops are built with `stageByEvent` mapping `a` to `OPEN_PLAYOFFS` (the finished event rewound to Playoffs open).
    - Alliances final (no distributions): `reservedSlots` is 1, `frc1` has verdict `locked` and `lockedBy` `pooled`, and `pooledRemainingPoints` is `PLAYOFF_POOL + awardPool(2)` (no team carries an `awardProfile`, so all twelve count as rookies; 304 at 62c21b5d).
    - The third place alliance decided (`decided("a", { frc2: 3, frc3: 3, frc4: 3 })`): the three rows carry `settledElim` equal to points 13, exact true, ceiling 0; `frc1` has status `locked`, verdict `locked` and `lockedBy` `pooled`; `pooledRemainingPoints` is the Alliances final value minus 39, and 39 is the sum of the exact settled points over every built row.
    - A settled value that is not exact nets nothing: `modelWith(decided("a", { frc2: 5, frc3: 6 })).pooledRemainingPoints` equals `modelWith(NO_DISTRIBUTIONS).pooledRemainingPoints` (the existing live `knockedOutArtifact`).
    The before behaviour goes in a comment above the second case, never in a passing test: before quick task 261009-uhb this stop read In range (verdict `contending`, `lockedBy` null) with the pool still 304. Eight rivals must pass `frc1`; the eight cheapest cost 3 x 29 + 5 x 42 = 297, which an unreduced 304 covers, and the eight undecided rivals' ceilings (58 + 30 + 15 = 103) still reach 100, so the ceiling test did not lock it either. Netted, the pool is 265 and 297 does not fit.
  </behavior>
  <action>
Step 0, before any edit. Record the base with `git rev-parse --short HEAD` and `git status --short` (expect other sessions' modified paths; leave them alone all task). Take the BEFORE capture Task 2 compares against: `bash SCRATCH/uhb/capture.sh SCRATCH/uhb/exec-before` (read only, no network, no credential, about 40 to 70 seconds; it must end with a line starting `UHB CAPTURE DONE` and four `exit 0` lines). Then run `npx tsx scripts/measureLedgerSettledTenets.ts` once and keep its PER SEASON table and its last block for the SUMMARY: at the base it is red (the planner measured `VIOLATIONS (82)`, 41 tenet C and 41 tenet D). That red run is this tracer's failing end to end test.

Step 1, tests first. Add the two describes of the behavior block, import `PLAYOFF_POOL` and `awardPool` into the status test from `packages/core/districts/pointPool.js` with the file's existing relative import style, and run `npx vitest run packages/core/districts/pooledLockInputs.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts`. The new cases that pass an amount, and the second status case, must FAIL on their values (vitest does not typecheck, so the extra argument is silently ignored until Step 2). Every existing case must still pass. State pool sizes through `PLAYOFF_POOL` and `awardPool`, not as bare literals, except where the behavior block names a literal.

Step 2, the core input (D1, reading R1 to R3). In `packages/core/districts/pooledLockInputs.ts`: give `pooledLockInputs` a second, optional parameter `playoffPointsInFloorsByEvent` of type `ReadonlyMap<string, number>`; add `PLAYOFF_POOL` to the existing import from `./pointPool.js`. In the per event loop, the amount netted is 0 unless all of these hold: the event's Playoffs category is open (`final.elim` false), the field size is above 0, and the map carries for this event key a finite number above 0; then it is the smaller of that number and `PLAYOFF_POOL`. The event's `points` is its `eventRemainingPool` less the amount netted. Throw nothing for a bad amount. `PooledEventContribution` keeps exactly its four fields (existing cases `toEqual` them); update the doc of `points` to say it is the remaining pool less the playoff points already counted in floors. Document the parameter on the function. Add a header section to the module, titled for quick task 261009-uhb, that states in this order: what the input is (per event, the playoff points that event has ALREADY handed out and that are counted in team floors at the position); the defect it removes (quick task 261008-26o settles a knocked out alliance's exact playoff points into floors while the event's Playoffs category is still open, so without the netting the same points sat in rivals' floors and in the pool, the pooled test got harder exactly when information arrived, and a lock shown at Alliances final was withdrawn at Round 4 or Round 5, 41 team stops over 21 events of 2023 to 2026); the soundness argument of CONTEXT D1 in full (`PLAYOFF_POOL` is an upper bound on ALL the playoff points an event hands out; the total is what has been handed out plus what remains, so what remains is at most the pool minus what has been handed out; points handed to teams outside the district are not known and not subtracted, which only leaves the pool larger); why it restores no take back (each rival's cost falls by at most what it banked and the pool falls by the sum of everything banked, so a pooled lock that held before still holds after); the three bounds of readings R2 and R3, each said to leave the pool larger; and that only the browser has bracket facts, so the offline publisher and the live Worker pass no second argument and get exactly the results they got before.

Step 3, the browser supplies it (D1). In `computeDistrictLedgerStatuses` in `apps/web/src/components/districts/districtLedgerStatus.ts`: declare a `Map<string, number>` named `playoffPointsInFloors` beside `pooledEntries`. Inside the team loop, directly after the `districtLockBounds` call (so only a team that has a source and a lock input counts), walk that team's rows: for a row whose Playoffs category is open in its own stage and that carries `settledElim`, take `settledElimBounds(row.settledElim).floor`, and when it is above 0 add it to the sum under `row.eventKey`. That is the very call `districtLockBounds` adds to the floor, so the pool can only lose what a floor gained; a value that is not exact returns 0 and adds no key. Pass the map as the second argument of the one `pooledLockInputs` call. Rewrite the last sentence of the header paragraph that starts "A TEAM KNOCKED OUT OF THE PLAYOFFS" (lines 68 to 71: it says the pooled inputs keep counting a settled alliance's share of the playoff pool and that this only delays a pooled lock, which was never true and is now false): say that the exact settled points this module puts in floors are summed per event and handed to `pooledLockInputs`, which takes them off that event's playoff pool, that counting them in floors and in the pool at once withdrew pooled locks at later playoff rounds, and that a settled value that is not exact is in no floor and nets nothing. Bring the comment above the `pooledLockInputs` call and the doc of `pooledRemainingPoints` (lines 176 to 181) in line with that. Add NO field to `DistrictLedgerStatusModel` or `DistrictLedgerStatusResult`, and do not change `districtLockBounds`.

Do not edit `pointPool.ts`, `locks.ts`, `packages/harness/districtRankingsMerge.ts`, `champLedgerStatus.ts`, `districtLedgerRows.ts`, `scripts/measureLedgerSettledTenets.ts`, any artifact schema, any algorithm version constant or anything under `apps/worker`.

Step 4. Run the verify command. Read the vitest counts and the sweep's printed blocks, not only the exit code. The sweep must print `VIOLATIONS: none`; compare its PER SEASON table with planner finding 1 and report every number that differs (finding 6 says which may). If it still prints a violation, STOP and report the rows with their stop, team and `lockedBy`: do not widen the netting beyond D1 (never net a value that is not exact, never net outside the playoff pool, never touch the ceiling test) to reach zero. If an existing test in a file this task did not edit fails, or a typecheck fails in a path `git status --short` shows another session editing, report it and do not fix it.

Step 5. Stage by explicit path (`git add` the four files of this task and nothing else), confirm `git diff --cached --stat` lists exactly those four, commit `fix(261009-uhb): the pooled remaining points lock nets out the playoff points already settled into floors`, then run `git status --short`. Do not push. Do not commit anything under `.planning/`.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/pooledLockInputs.test.ts packages/core/districts/pointPool.test.ts packages/core/districts/locks.test.ts packages/harness/districtRankingsMerge.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts && npx tsx scripts/measureLedgerSettledTenets.ts && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && echo UHB_TASK1_OK</automated>
  </verify>
  <done>The new cases failed before Step 2 and pass after it, and every pre existing case of the five test files passes unedited (read the counts; never `timeout <n> pnpm`). `scripts/measureLedgerSettledTenets.ts` over 2023 to 2026 prints `VIOLATIONS: none` and exits 0, with tenets A, B, C and D at 0 and lost at 0. The three typechecks are clean and `UHB_TASK1_OK` is printed. One commit holds exactly the four files of this task. `SCRATCH/uhb/exec-before/` holds the BEFORE capture taken at the base commit.</done>
</task>

<task type="auto">
  <name>Task 2: The 2026cthar pin, the gates of D3 and the todo note (D2, D3, D4)</name>
  <files>scripts/districtLocksNoTakeBack.test.ts, .planning/todos/pending/locks-settled-playoffs-follow-ups.md</files>
  <precondition>Task 1 is committed, `SCRATCH/uhb/exec-before/exits.txt` exists, and `data/corpus.sqlite` and `data/local-publish/districts/v1__district__2026ne.json` exist in the main checkout.</precondition>
  <read_first>
    - scripts/measureLedgerSettledTenets.test.ts lines 26 to 46 and 212 to 262 (the gating idiom with an explicit `it.skip` message, `loadPin`, `stopNamed`, `recordNamed`)
    - scripts/measureLedgerSettledTenets.ts lines 139 to 146, 240 to 252, 275 to 282, 332 to 382 and 419 to 425 (the exports the pin calls). Read only.
    - This plan's planner_findings 1, 5 and 6
    - apps/web/src/components/methodology/districtLedgerContent.ts lines 158 to 163 (read only)
    - .planning/todos/pending/locks-settled-playoffs-follow-ups.md (item 2)
  </read_first>
  <action>
Part A, the pin (D2). Create `scripts/districtLocksNoTakeBack.test.ts`. Header doc: what it pins and why (Jacob's rule; quick task 261009-uhb; the cause in two sentences); that it is gated on BOTH gitignored local sources, `data/local-publish/districts/v1__district__2026ne.json` and `data/corpus.sqlite`, and skips with a message when either is absent, never a silent pass; that it calls the sweep's own exports so the pinned stops are exactly what `scripts/measureLedgerSettledTenets.ts` sweeps; the before behaviour of planner finding 5 as a comment (at 62c21b5d frc2067 read In range at Round 4 and Round 5, the pool read 4,323 in both runs, the settled rule lost frc2067 at both, and the event carried four violations); and the rule that if the implementation ever differs the inputs are checked first and no lock rule is changed to meet a pin. Imports use the `.js` extension style of the neighbouring scripts tests: `DistrictArtifactSchema`, `openCorpusReadOnly`, `bracketFromCorpus` and `CORPUS_PATH`, `districtTierFinalVerdicts`, and `settledDistrictContext`, `settledStops`, `statusesAtSettledStop`, `sweepSettledEvent`, `bracketSkipReason` from `./measureLedgerSettledTenets.js`. Load the artifact and the 2026cthar bracket behind the gate, closing the corpus in a `finally`, as `loadPin` does.

One describe, gated with `it.skip` and a message naming the absent path, with these cases for district 2026ne, event 2026cthar, team frc2067:
- the bracket is sweepable and the stops are, in order, Alliances final, Round 1, Round 2, Round 3, Round 4, Round 5, Playoffs final, awards open;
- in the settled run (`statusesAtSettledStop` with the last argument true) frc2067 has status `locked` and `byAward` false at every one of the seven stops, and `lockedBy` `pooled` at the first six;
- at every stop `record.blunt.pooledRemainingPoints` minus `record.settled.pooledRemainingPoints` equals `record.settledPoints`, that list is 0, 0, 0, 0, 21, 60, 0, and `settledExact` equals `settledRows`;
- Locked on points is 6, 6, 6, 6, 6, 6, 9 in the blunt run and 6, 6, 6, 6, 6, 7, 9 in the settled run; `lost` is empty at every stop; `gained` is empty at every stop but Round 5, where it is exactly frc1699;
- `sweep.violations` is empty and `sweep.takeBackBlunt` is 0.

Part B, the gates (D3). Run them in this order and keep each printed verdict for the SUMMARY. They are chained in the verify command; run the chain in two or three Bash calls with a 600000 ms timeout if one call would run out, and read the printed lines, never a piped exit code.
1. `npx vitest run scripts/districtLocksNoTakeBack.test.ts scripts/measureLedgerSettledTenets.test.ts`: both files pass and the gated groups RAN (no skipped line).
2. `npx tsx scripts/measureLedgerSettledTenets.ts`: `VIOLATIONS: none`, exit 0. This is D3's sweep: tenets A, B, C and D.
3. `npx tsx SCRATCH/uhb/uhbGate.mts`: its last line is `UHB GATE CLEAN`. It is the planner's independent witness through the repo's own code, and adds the take back check over the whole season walk (3,858 stops at 62c21b5d). Report its table.
4. `bash SCRATCH/uhb/capture.sh SCRATCH/uhb/exec-after`, then `bash SCRATCH/uhb/compare.sh SCRATCH/uhb/exec-before SCRATCH/uhb/exec-after`: the last line is `UHB UNCHANGED CLEAN`. That one line covers `measureLedgerTenets.ts` (tenet A 0, tenet B 0), `measureChampTenets.ts` and `measureChampJointLocks.ts` (`VIOLATIONS: none`), all three reports identical to the BEFORE capture, and the publisher's whole artifact comparison (`R9X COMPARE CLEAN` over `publishDistricts.ts --dry-run --no-bake --local-out`, which needs no `.env`). If it prints `UHB UNCHANGED FAILED`, first run `git log --oneline` from the Task 1 base to HEAD: when a commit that is not this task's landed between the two captures, report the differing lines with that commit and stop there; otherwise the difference is this task's and is a defect, report it and stop.
5. `npx tsx scripts/measureChampCutoff.ts --check-history`: two lines starting `no drift`. On any drift STOP and report it; regenerate nothing.
6. The three typechecks, then the full root `npx vitest run`. Read the totals.

Part C, docs (D4). Read lines 158 to 163 of `apps/web/src/components/methodology/districtLedgerContent.ts`. The planner read them at 62c21b5d: the pooled sentence (Locked when the points still available in the district cannot lift enough rivals past the team) and the knocked out sentence both still read true, so nothing is edited. If either now reads false, report the sentence and do not edit the file: another session owns it in this batch. Then, in `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`, add one short paragraph directly under item 2 with a scoped Edit (another task also edits this file; re-read it first and touch only item 2): quick task 261009-txb built the sweep (`scripts/measureLedgerSettledTenets.ts`); its first run found 41 team stops over 21 events where a pooled lock shown at Alliances final was withdrawn at Round 4 or Round 5; quick task 261009-uhb fixed the cause (the pooled pool now nets out the settled playoff points already in floors); and the sweep's four tenets read zero, with the all seasons line of your own run. Do not mark item 2 closed: closing it is 261009-txb's Task 2. Do not commit the todo.

Part D. Stage `scripts/districtLocksNoTakeBack.test.ts` by explicit path, confirm `git diff --cached --stat` lists exactly that file, commit `fix(261009-uhb): pin 2026cthar frc2067 Locked at every stop from Alliances final to Playoffs final`, run `git status --short`. Do not push.
  </action>
  <verify>
    <automated>npx vitest run scripts/districtLocksNoTakeBack.test.ts scripts/measureLedgerSettledTenets.test.ts && npx tsx scripts/measureLedgerSettledTenets.ts && npx tsx "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/uhbGate.mts" && bash "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/capture.sh" "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/exec-after" && bash "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/compare.sh" "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/exec-before" "C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/uhb/exec-after" && npx tsx scripts/measureChampCutoff.ts --check-history && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && echo UHB_TYPECHECKS_OK && npx vitest run && echo UHB_ACCEPTED</automated>
  </verify>
  <done>The pin file's cases pass and RAN on this machine. The sweep prints `VIOLATIONS: none`; the planner gate prints `UHB GATE CLEAN`; the compare prints `UHB UNCHANGED CLEAN` with `R9X COMPARE CLEAN` and 0 differing artifacts; the history check prints two `no drift` lines; `UHB_TYPECHECKS_OK` and `UHB_ACCEPTED` are printed and the full suite's totals show no failure. One commit holds exactly the pin file. The todo carries the note under item 2 and is not committed. The methodology file is not edited by this task. `git diff --name-only` from the Task 1 base to HEAD, restricted to this task's two commits, names only the five source and test files of `files_modified`.</done>
</task>

</tasks>

<verification>
- `npx tsx scripts/measureLedgerSettledTenets.ts` prints `VIOLATIONS: none` and exits 0 over 2023 to 2026 (it printed `VIOLATIONS (82)` at 62c21b5d). Its PER SEASON table is in the SUMMARY beside planner finding 1, with every difference named.
- `npx tsx SCRATCH/uhb/uhbGate.mts` prints `UHB GATE CLEAN`: tenets A, B, C, D and the whole season walk all zero.
- `bash SCRATCH/uhb/compare.sh SCRATCH/uhb/exec-before SCRATCH/uhb/exec-after` prints `UHB UNCHANGED CLEAN`: the three shipped sweeps print the same report and the publisher's artifacts are identical, so the publisher and the Worker callers behave exactly as before.
- `npx tsx scripts/measureChampCutoff.ts --check-history` prints no drift.
- `npx vitest run packages/core/districts/pooledLockInputs.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts scripts/districtLocksNoTakeBack.test.ts`: the new cases pass, the gated pin ran.
- `npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && echo TYPECHECKS_OK` prints the sentinel; the full root `npx vitest run` passes. Verify by printed counts, never by an exit code alone and never through `timeout <n> pnpm ...`.
- This task's two commits touch only `packages/core/districts/pooledLockInputs.ts`, its test, `apps/web/src/components/districts/districtLedgerStatus.ts`, its test and `scripts/districtLocksNoTakeBack.test.ts`. Nothing under `apps/worker`, no schema file, no version file, nothing under `.planning/`.
- `.env` is never read, printed or passed to a command: no command here needs a credential.
- Nothing is pushed.
</verification>

<success_criteria>
- A lock the District Locks tab shows at a stop is shown at every later stop: tenets C and D read 0 where they read 41 each, over every district event of 2023 to 2026, and tenets A and B stay 0.
- The pool loses exactly the playoff points the floors gained, and nothing else: 33,291 points over 836 stops at 16d0f64e (the sweep's own settled points figure), never more than the playoff pool at any event.
- A caller that passes no bracket facts (the publisher, the Worker, the three shipped sweeps) gets the results it got before, proved by identical reports and identical artifacts.
- The readings R1 to R5 are recorded in the SUMMARY as readings, each with its reason.
</success_criteria>

<output>
Produce `.planning/quick/261009-uhb-district-locks-the-pooled-pool-nets-out-/261009-uhb-SUMMARY.md` with `requirements_completed: [261009-uhb]` only when `UHB_ACCEPTED` was printed. It carries: the base commit and the two commit hashes; the sweep's PER SEASON table before (the Step 0 run) and after, beside planner finding 1 with every difference named; the planner gate's table and verdict line; the compare verdict with the `R9X COMPARE` line; the history check lines; the full suite totals; readings R1 to R5; the todo note as written; and a line saying that 261009-txb's Task 2 zero branch is now open to the orchestrator. If a gate stopped the task, the SUMMARY leads with that gate, its rows and what was and was not committed. If the harness blocks writing a SUMMARY.md from a subagent, return the full SUMMARY text to the orchestrator instead; do not route around the block through Bash. Never commit `.planning/` files; worktrees are off; stage by explicit path; check `git status --short` after each commit; do not push.
</output>
