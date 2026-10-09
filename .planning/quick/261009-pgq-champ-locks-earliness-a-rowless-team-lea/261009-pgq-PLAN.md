---
phase: quick-261009-pgq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/districts/champLedgerRows.ts
  - apps/web/src/components/districts/champLedgerRows.test.ts
  - apps/web/src/components/districts/champLedgerStatus.ts
  - apps/web/src/components/districts/champLedgerStatus.test.ts
  - scripts/measureChampJointLocks.test.ts
  - .planning/todos/pending/champ-joint-lock-follow-ups.md
autonomous: true
requirements: [261009-pgq]

estimate:
  tokens: 50000
  raw_tokens: 100000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "D1: a team with no dcmp tier source is out of the field once every FIELD FIXING dcmp key has started, where the field fixing keys are the dcmp keys minus every key K for which another dcmp key equals K plus one digit (a divisioned championship's finals key). A single championship and 2026 California's two are unchanged (every key is field fixing); a team with its own dcmp source is unchanged (its own key)."
    - "D1 downstream, and the guard that stands where D2 was withdrawn: at a divisioned stop where every division has started and the finals have not, a team with no dcmp row reads membership `out`, carries no hypothetical DCMP ceiling, and is still a rival in `jointProof.input.pool` with `extra` 0, where one consuming award covers it."
    - "D2 is withdrawn: `packages/core/districts/champJointLock.ts` and `packages/core/districts/champJointLock.test.ts` are not edited."
    - "D3: the divisioned proof's `judgedAwards` is `dcmpJudgedAwardCeiling()` times the number of division keys whose stage at the position has `award` false: 28 with neither of two divisions posted, 14 with one, 0 with both. Single and two championship inputs keep 14 per championship."
    - "Regression: every single event and California bound and locked set is BYTE IDENTICAL to the pre task dump (`dumpSingle.mts` and `pgq_dumpCa.mts`), and the sweep prints exactly the 261009-kt3 totals for those shapes: single 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754, two championships 1 / 8 / 7 / 41 / 62 / 103."
    - "`npx tsx scripts/measureChampJointLocks.ts` sweeps 48 championships with VIOLATIONS: none and SKIPPED (0)."
    - "Pins: every FNC pin and both CA pins pass with no pinned value changed. The four FIM and NE pins hold the sets as executed, never fitted: every member is `locked` or `lockedAward` at Now and no team that missed qualification is in any set."
    - "`npx tsx scripts/measureChampTenets.ts` prints VIOLATIONS: none and `npx tsx scripts/measureChampCutoff.ts --check-history` prints no drift."
    - "Scope fence: champJointLock.ts, districtLedgerStatus.ts, reservedSlots.ts, pooledLockInputs.ts, the publisher, apps/worker and packages/harness are unedited; no artifact shape, algorithm version or Worker change."
  artifacts:
    - path: "apps/web/src/components/districts/champLedgerRows.ts"
      provides: "fieldFixingDcmpKeys and the D1 rule in dcmpStartedForTeam, with the D1 measurement and the pool membership guard in its comment"
      contains: "fieldFixingDcmpKeys"
    - path: "apps/web/src/components/districts/champLedgerStatus.ts"
      provides: "the D3 judged budget over divisions whose Awards are open"
      contains: "openAwardDivisions"
    - path: "apps/web/src/components/districts/champLedgerStatus.test.ts"
      provides: "the D3 cases (28, 14, 0) and the D1 guard: a rowless team read as out is in the proof's pool with extra 0 and a consuming award covers it"
      contains: "261009-pgq"
    - path: "scripts/measureChampJointLocks.test.ts"
      provides: "the FIM and NE pins as executed after D1 and D3; the FNC and CA pins untouched"
      contains: "Divisions final, finals not started"
  key_links:
    - from: "champLedgerRows.ts dcmpStartedForTeam"
      to: "champLedgerRows.ts fieldFixingDcmpKeys"
      via: "the every started test over the field fixing keys, for a team with no dcmp source"
      pattern: "fieldFixingDcmpKeys\\(dcmpEventKeys\\)"
    - from: "champLedgerStatus.ts divisionedJointProof"
      to: "JointLockInput.judgedAwards"
      via: "dcmpJudgedAwardCeiling() times the count of division stages with award false"
      pattern: "dcmpJudgedAwardCeiling\\(\\) \\* openAwardDivisions"
    - from: "champLedgerStatus.ts pool (pointsRaceSlots over orderedKeys)"
      to: "a team with no dcmp row read as out"
      via: "orderedKeys takes every rows.teams entry, so the team stays a rival at extra 0"
      pattern: "orderedKeys.push\\(team.teamKey\\)"
---

<objective>
Make the Champ Locks Locked verdict land earlier at divisioned championships without giving up soundness, per CONTEXT D1, D3 and D4 (locked; D2 is WITHDRAWN and no core change is made):

- D1: a team with no championship row leaves the field once every DIVISION has started; the finals key no longer gates it.
- D3: the divisioned judged award budget counts only divisions whose Awards are open.
- D4: the sweep stays at zero violations and zero skipped, the pins are reported as executed, follow ups 9 and 15 are closed.
- In place of D2: a test that a rowless team read as `out` is still a pool rival at extra 0 that a consuming award covers, and a gate that every single event and California bound and locked set is byte identical to before this task.

Purpose: Jacob, 2026-10-09: "fix the first two now". At "Divisions final, finals not started" eight NE teams and four FIM teams with no row still carried a 249 point hypothetical DCMP (NE pin 5 locks short, FIM 4), and K stayed at 14 times the division count after the divisions' awards had posted (2,176 lock stops against 2,511 in the prototype).

Shape note: the orchestrator fixed the two task order below. The architecture is the shipped 261009-kt3 path, proven end to end by its sweep, so the tasks are not a tracer slice; the end to end check is the sweep, run in both tasks.

Output: `fieldFixingDcmpKeys` and the D1 rule in `champLedgerRows.ts`; the D3 budget in `champLedgerStatus.ts`; their tests; the FIM and NE pins as executed; the todo closed; the SUMMARY.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261009-pgq-champ-locks-earliness-a-rowless-team-lea/261009-pgq-CONTEXT.md
@.planning/quick/261009-kt3-champ-locks-joint-proof-for-divisioned-c/261009-kt3-SUMMARY.md
@.claude/CLAUDE.md

Scratchpad (session shared, never committed), called SCRATCH below:
`C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`
- `SCRATCH/dumpSingle.mts`: one line per SINGLE event championship stop of 2023 to 2026, `district|stop|S'n|resn|applied|locked a,b|bounds team:bound ...`. Run from the repo root with its output redirected to a file. At HEAD 0656d2f2 it writes 248 lines in about 28 s, byte identical to 261009-kt3's final `single_t5.txt` (planner run).
- `SCRATCH/pgq_dumpCa.mts`: the same line for every stop of every TWO championship district (2026 California), with the joint locked set and every pool team's summed bound. `dumpSingle.mts` skips California, so this is its companion. At HEAD it writes 8 lines in about 13 s (planner run).
- `SCRATCH/pins.mts`: prints, for every FIM, NE and CA 2026 stop, S', the joint locked set with each bound, and `bad n` (members not `locked` or `lockedAward` at Now).
- If a file is missing, rebuild it from the loop in `scripts/measureChampJointLocks.test.ts` (`championshipStops`, `statusesAtChampionshipStop`, `dcmpStops`, `statusesAtStop`, `bracketFromCorpus`, `bracketsFromCorpus` are exported by `scripts/measureChampJointLocks.ts`; `jointProofBound` by `champLedgerStatus.ts`).

The code as it stands (read once, do not re-read):

```ts
// apps/web/src/components/districts/champLedgerRows.ts ~408
export function dcmpStartedForTeam(team: DistrictTeam, startedDcmpEventKeys: ReadonlySet<string>, dcmpEventKeys: readonly string[]): boolean {
  const own = tierEvents(team, "dcmp")[0]?.eventKey;
  if (own !== undefined) return startedDcmpEventKeys.has(own);
  return dcmpEventKeys.length > 0 && dcmpEventKeys.every((key) => startedDcmpEventKeys.has(key));
}

// apps/web/src/components/districts/champLedgerStatus.ts, divisionedJointProof (~944 to 1075)
// stageByKey: Map<division key, DistrictStageFinality>, built at ~958 to 963
judgedAwards: dcmpJudgedAwardCeiling() * divisionCount,                 // ~1069
```

Facts the plan rests on (verified by the planner against HEAD 0656d2f2):
- The joint proof's pool is `pointsRaceSlots(orderedKeys, ...).poolKeys`, and `orderedKeys` takes EVERY `rows.teams` entry, a team with no dcmp row included (`champLedgerStatus.ts` ~471 to 485, ~634). Measured at "Divisions final, finals not started": 2026 NE 98 of 98 rowless teams in the pool, 2026 FIM 368 of 369 (the one missing is award qualified). So a consuming award to such a team is already counted inside the proof's min, which is why D2 was withdrawn.
- `ChampLocksLedger.tsx`, `scripts/measureChampJointLocks.ts` and `scripts/measureChampTenets.ts` reach the field rule only through `dcmpStartedForTeam` (directly or via `buildChampLedgerRows`); none needs an edit.
- In the sweep, every divisioned stop from "Alliances final" to "Divisions final, finals not started" has `startedKeys` = the division keys only, and the division stage is ALL_FINAL (Awards posted) at "Divisions final" and at every finals stop. The two California keys have no parent key.
- `dcmpBracketFactsFor` with role `division` does not gate on the Awards stage, so the divisioned proof runs with a division's Awards final.
- `champLedgerStatus.test.ts` already imports from `packages/core/districts/champJointLock.js`, so reading `jointLockBound` there adds no new dependency.
</context>

<planner_readings>
## Readings of D1 to D4 this plan fixes (each binding)

- **P1. D2 is withdrawn and two things stand in its place.** No core change: `champJointLock.ts` and its test file are not opened for writing. (a) A test in `champLedgerStatus.test.ts` shows that a team with no dcmp source, read as `out`, is in `jointProof.input.pool` with `extra` 0 and that one consuming award covers it. (b) The regression gate: every single event and California bound and locked set is byte identical to the pre task dump, since D1 and D3 touch only the divisioned shape.
- **P2. The field fixing rule lives in one exported helper** `fieldFixingDcmpKeys(dcmpEventKeys)` beside `dcmpStartedForTeam` (CONTEXT discretion). It is a rule on the keys alone (K is dropped when another key has K's length plus 1, starts with K and ends in a digit), not a call to `championshipShape`, so a shape the proof refuses still gets the rule D1 states. `champTeamHiddenAtDcmp` reads the row's own sources, not a started rule, and is not changed.
- **P3. D1 reaches every divisioned stop before the finals start**, not only the pinned one (context facts above): expect the divisioned totals to move at "Alliances final" through "Divisions final". The single and two championship shapes cannot move through D1 or D3.
- **P4. Pin policy.** The FNC pins, the two CA pins, the single dump and the California dump must not move at all. The four FIM and NE pins may gain members through D1 and D3; each is replaced with the set as executed, in Task 1, only after Task 1's gates hold. Anything outside those expectations is a STOP, never an edit.
- **P5. `--check-history` drift is Jacob's call.** D1 changes field membership at rewound divisioned positions. If `measureChampCutoff.ts --check-history` prints drift, do not regenerate anything: finish the other gates, and report the drift lines to the orchestrator (a regenerated tuning table is a published number).
- **P6. Two core doc lines stay as they are.** `champJointLock.ts` is out of scope, so its header sentence near line 170 ("one budget K times the division count") and the `JointLockInput.judgedAwards` doc near line 320 keep the old wording. That wording is the upper end of what the caller passes after D3 and no code depends on it. The comment at the D3 line in the status module states the new rule, and the SUMMARY names the two lines.
- **P7. Two CONTEXT sentences predate the withdrawal.** D1's "a consuming award, is covered by D2" and D4's "the list of every changed single event bound from D2". The module comment names the pool membership guard of P1 instead, and the SUMMARY reports that zero single event and California bounds changed, with the two byte comparisons as the evidence.

## Regression rule (CONTEXT D2 as rewritten, and D4)

1. Every single event and California bound and locked set is BYTE IDENTICAL to the pre task dump. The sweep's single subtotal stays exactly 31 / 248 / 217 / 340 / 414 / 754 and its two championship totals exactly 1 / 8 / 7 / 41 / 62 / 103. Any difference is a STOP.
2. Every pin is reported as executed and never fitted: the proof, the gate and the inputs are never changed to reach a pinned set. FNC and CA do not move.
3. Every member of every pin is `locked` or `lockedAward` at Now, and no team that missed qualification is in any set. A member that missed is a soundness failure: STOP and report, do not edit the pin.
</planner_readings>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: D1 and D3 in the browser, the field is fixed by the divisions and the judged budget counts open divisions</name>
  <files>apps/web/src/components/districts/champLedgerRows.ts, apps/web/src/components/districts/champLedgerRows.test.ts, apps/web/src/components/districts/champLedgerStatus.ts, apps/web/src/components/districts/champLedgerStatus.test.ts, scripts/measureChampJointLocks.test.ts</files>
  <precondition>`data/corpus.sqlite` and `data/local-publish/districts/v1__district__2026fim.json` exist in the main checkout (the sweep, the dumps and the pins read them; a skipped pin file is not a pass).</precondition>
  <read_first>
    - apps/web/src/components/districts/champLedgerRows.ts lines 373 to 462 (dcmpEventKeysFor, dcmpStartedForTeam, champTeamHiddenAtDcmp, champFieldMembership)
    - apps/web/src/components/districts/champLedgerRows.test.ts lines 1203 to 1232 (the `withFinalsRow` fixture: parent `2026pncmp` plus division `2026pncmp1`)
    - apps/web/src/components/districts/champLedgerStatus.ts lines 556 to 575 (the pre registration branch) and 944 to 1075 (divisionedJointProof)
    - apps/web/src/components/districts/champLedgerStatus.test.ts lines 1153 to 1310 (the DIVISIONED fixture, `modelAt`, `facts`, `entry`, the two divisioned tests)
    - scripts/measureChampJointLocks.test.ts lines 189 to 275 (the six pins)
    - SCRATCH/dumpSingle.mts and SCRATCH/pgq_dumpCa.mts
  </read_first>
  <behavior>
    - `fieldFixingDcmpKeys`: the five FIM keys (`2026micmp`, `2026micmp1` to `2026micmp4`) give the four division keys; the three NE keys give the two division keys; `["2026nccmp"]` gives itself; `["2026cancmp", "2026cascmp"]` gives both; division keys without their parent give themselves; an empty list gives an empty list.
    - `dcmpStartedForTeam` for a team with no dcmp source: keys parent, d1, d2 with d1 and d2 started is true (it was false); with only d1 started is false; with nothing started is false. One key: started is true, not started is false. The two California keys: one started is false, both started is true. An empty key list is false.
    - `dcmpStartedForTeam` for a team with its own dcmp source is unchanged: it reads its own first key only.
    - Rows level, on the `withFinalsRow` fixture: with `startedDcmpEventKeys` holding only `2026pncmp1`, a team with no dcmp row has `membership` equal to `out`; with an empty started set it is `open`.
    - Status level D1, on the DIVISIONED fixture at the Round 5 stages with `startedDcmpEventKeys` passed to `buildChampLedgerRows`, for a team R with no dcmp row taken from the applied proof's own pool: `ceilingByTeam` with only DIV1 started minus `ceilingByTeam` with DIV1 and DIV2 started (the parent not started) equals one whole hypothetical DCMP, the sum of the four `maxEventPoints(2026, "dcmp")` categories (249); R's pool entry has `extra` equal to that sum with only DIV1 started.
    - The guard for the withdrawn D2 (reading P1), same fixture with both divisions started: the proof applies; R's rows `membership` is `out`; R is in `jointProof.input.pool` with `extra` 0; and a consuming award covers it: with T the pool entry of the highest floor (assert R's floor is below T's), a reduced `JointLockInput` holding only T and R as they stand in the pool, no alliance, no slot only rival, `candidateWinners: [null]`, `judgedAwards: 0` and the model's own `placementPoints`, `judgedAwardPoints` and `maxAllianceSize` gives `jointLockBound` 1 for T with `consumingAwards: 1` and 0 with `consumingAwards: 0`.
    - D3: on the DIVISIONED fixture with both divisions' Playoffs final, the finals at open Playoffs and finals facts mapping each finals alliance to a division winner (the second existing test's setup), `jointProof.input.judgedAwards` is 28 with neither division's `award` final, 14 with DIV1's final, 0 with both final; `candidateWinners` stays [11, 21] in all three.
    - D3 leaves the other shapes alone: the two championship test's inputs each read `judgedAwards` 14, and the FNC Round 5 pin's 14 passes unchanged.
  </behavior>
  <action>
    Before any edit, record `git rev-parse HEAD` as the base and write the two baselines from the repo root: `npx tsx SCRATCH/dumpSingle.mts` redirected to `SCRATCH/pgq_single_base.txt` (248 lines) and `npx tsx SCRATCH/pgq_dumpCa.mts` redirected to `SCRATCH/pgq_ca_base.txt` (8 lines).

    Per D1 and reading P2, add the exported `fieldFixingDcmpKeys(dcmpEventKeys)` beside `dcmpStartedForTeam` in `champLedgerRows.ts`: it returns the keys except every key K for which some other key has K's length plus 1, starts with K and ends in a digit. In `dcmpStartedForTeam`, the branch for a team with no dcmp source tests that list (non empty, every key started) in place of the whole key list; the own source branch is untouched. Rewrite the function's doc comment: the field is fixed once every division has started, the finals are played among the division winners and admit nobody new, and a single or two championship district is unchanged. Record the D1 measurement there as CONTEXT D1 states it (corpus 2023 to 2026, every single and division DCMP event: 18 teams registered with no points there, every one eliminated at Now, every one at least 113 points below its district's cut line, gaps 113 to 217, totals 0 to 56, so a 45 point award could not have carried one past a locked team). For the one way left to such a team, a consuming award, name the guard of reading P1 and not D2: the team stays a rival in the joint proof's pool at extra 0, so a consuming award to it is counted there, and `champLedgerStatus.test.ts` asserts it. Do not edit `champFieldMembership`, `champTeamHiddenAtDcmp`, `ChampLocksLedger.tsx` or the status module's pre registration branch: they follow from the helper.

    Per D3, in `divisionedJointProof`: count `openAwardDivisions`, the division keys whose stage in `stageByKey` has `award` false, and set `judgedAwards` to `dcmpJudgedAwardCeiling() * openAwardDivisions`. `divisionCount` keeps every other use. Say why in a comment at that line: posted judged points are already in every floor, a division whose Awards are final gives no further award, and the finals event gives no judged award (261009-kt3 RESEARCH section 3). `singleChampionshipInput` and the two championship path keep `dcmpJudgedAwardCeiling()`. Per D2 as rewritten, do not edit `packages/core/districts/champJointLock.ts` or its test file, comments included (reading P6).

    Tests per the behavior list: the helper and `dcmpStartedForTeam` cases and the rows level case in `champLedgerRows.test.ts` (a new describe naming D1 and quick task 261009-pgq; pick a FIXTURE team with no `2026pncmp` row for the rowless team); the status level D1 case, the P1 guard and the D3 cases in the divisioned describe of `champLedgerStatus.test.ts` under names carrying 261009-pgq, giving `modelAt` an optional started set that it passes as `startedDcmpEventKeys` in place of `dcmpStarted: true`, and importing `jointLockBound` beside the existing `jointLockedTeamsMultiple` import.

    Gates before touching a pin, all in the same working tree (regression rule 1, reading P4):
    1. `npx tsx scripts/measureChampJointLocks.ts`: VIOLATIONS: none, SKIPPED (0); the SINGLE SUBTOTAL line reads 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0; the two championship totals read 1 / 8 / 7 / 41 / 62 / 103.
    2. `npx tsx SCRATCH/dumpSingle.mts` written to `SCRATCH/pgq_single_after.txt` and `npx tsx SCRATCH/pgq_dumpCa.mts` written to `SCRATCH/pgq_ca_after.txt`; `cmp` each against its baseline. Both must be byte identical.
    3. `npx tsx scripts/measureChampTenets.ts`: VIOLATIONS: none.
    4. In the pin file, every FNC pin and both CA pins pass untouched.
    Any of the four failing is a STOP: do not commit, do not edit a pin, report the lines.

    Then the FIM and NE pins. Run `npx tsx SCRATCH/pins.mts` and save its output to `SCRATCH/pgq_pins.txt`. For each of the four pinned FIM and NE stops: `slots` must be unchanged (S' does not depend on D1 or D3; a moved S' is a STOP) and `bad` must be 0 (a member that is not `locked` or `lockedAward` at Now is a soundness failure: STOP). Replace each `locked` string with the executed set. Remove from a `nearMisses` string only a team the executed set now holds and that is `locked` or `lockedAward` at Now. Record per pin for the SUMMARY: old count, new count, every added and removed team with its bound, and each added team's status at Now. Never change the proof, a gate or an input to reach a set (regression rule 2).

    Edit with the Edit tool or a Python script in SCRATCH (Git Bash heredocs break on long prose here). Stage the five files by explicit path (leave out any that did not change), commit `feat(261009-pgq): a rowless team leaves the field once every division has started, and the judged budget counts open divisions only`, then check `git status`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts scripts/measureChampJointLocks.test.ts</automated>
    <automated>npx tsx scripts/measureChampJointLocks.ts</automated>
    <automated>npx tsx scripts/measureChampTenets.ts</automated>
    <automated>npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && echo "TYPECHECKS CLEAN (root, web, e2e)"</automated>
  </verify>
  <done>The D1, guard and D3 tests pass with every shipped test unchanged (read the printed counts); the pin file ran, not skipped, and passes with the FIM and NE sets as executed and the FNC and CA pins untouched; the sweep prints VIOLATIONS: none, SKIPPED (0), the single subtotal 31 / 248 / 217 / 340 / 414 / 754 and the two championship totals 1 / 8 / 7 / 41 / 62 / 103; both dumps are byte identical to their baselines; measureChampTenets prints VIOLATIONS: none; the typecheck chain prints `TYPECHECKS CLEAN (root, web, e2e)` (a `&&` chain stops at the first failure, so a missing sentinel means a typecheck failed); one commit, staged by explicit path, with no file under `packages/core/` in it.</done>
</task>

<task type="auto">
  <name>Task 2: The full gates, the report, the todo and the SUMMARY (D4)</name>
  <files>.planning/todos/pending/champ-joint-lock-follow-ups.md, apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/methodology/districtLedgerContent.test.ts</files>
  <read_first>
    - .planning/todos/pending/champ-joint-lock-follow-ups.md (items 9 and 15)
    - apps/web/src/components/methodology/districtLedgerContent.ts lines 158 to 168 (the three paragraphs that speak of the championship field and the joint proof)
    - SCRATCH/pgq_pins.txt
  </read_first>
  <action>
    Run the gates of D4 in order and read each command's printed output, never an exit code alone, never through `timeout` with pnpm: the sweep; `npx tsx scripts/measureChampTenets.ts`; `npx tsx scripts/measureChampCutoff.ts --check-history`; the full root `npx vitest run`; the three typechecks. Required: 48 championships, SKIPPED (0), VIOLATIONS: none, the single and two championship totals of regression rule 1; tenets VIOLATIONS: none; the full suite green with the pin file run, not skipped. If `--check-history` prints drift, regenerate nothing and carry the drift lines into the report (reading P5).

    Methodology per D4: read the paragraphs at `districtLedgerContent.ts` 158 to 168 against D1 and D3. No change is expected. Only if a sentence now reads false, fix that sentence in the flat third person voice with no hyphen and no dash character, update the exact string its test pins, run that test file, and commit the two files as `feat(261009-pgq): methodology copy for the Champ Locks field rule`. With no copy change this task makes no commit.

    Todo per D4 (edited, never committed): strike through items 9 and 15 and prefix each with "CLOSED by quick 261009-pgq."; under item 15 add the D1 measurement as a note (the 18 teams, eliminated at Now, gaps 113 to 217, totals 0 to 56). Add no new item.

    Assemble the SUMMARY (see the output section). It carries:
    - the commits and, per task, the printed verification lines;
    - the sweep by shape as a table (championships, stops, proof ran, shipped, joint only, combined, violations, locked earlier) beside the 261009-kt3 numbers: single 31 / 248 / 217 / 340 / 414 / 754, divisioned 16 / 156 / 140 / 1,539 / 810 / 2,349, CA 1 / 8 / 7 / 41 / 62 / 103;
    - the per stop tables for the divisioned championships as the sweep prints them;
    - the regression evidence: zero single event and zero California bounds or locked sets changed, with the two `cmp` results and the dump file names (reading P7);
    - the pins as executed: FNC Round 5 and Playoffs final and CA at both stops unmoved; FIM and NE at both stops, each with S', old count, new count, added and removed teams with bounds, and the statement that every member is `locked` or `lockedAward` at Now and no team that missed is in a set;
    - the D1 measurement, the guard test of reading P1, and that D2 was withdrawn because a rowless team is already a pool rival (NE 98 of 98, FIM 368 of 369);
    - the two core doc lines of reading P6 that keep the old K wording;
    - the `--check-history` result, the sweep time, and the scope fence check: `git diff --name-only <base>..HEAD` lists only files of `files_modified`, none under `packages/core/`.
  </action>
  <verify>
    <automated>npx tsx scripts/measureChampJointLocks.ts</automated>
    <automated>npx tsx scripts/measureChampTenets.ts && npx tsx scripts/measureChampCutoff.ts --check-history</automated>
    <automated>npx vitest run</automated>
    <automated>npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && echo "TYPECHECKS CLEAN (root, web, e2e)"</automated>
  </verify>
  <done>The sweep prints 48 championships, SKIPPED (0), VIOLATIONS: none and the single and two championship totals of regression rule 1; measureChampTenets prints VIOLATIONS: none; `--check-history` prints no drift, or its drift lines are in the report with nothing regenerated; the full root suite passes (read the totals) with the pin file run; the typecheck chain prints `TYPECHECKS CLEAN (root, web, e2e)`; todo items 9 and 15 read closed with the D1 note and no item is added; the SUMMARY text carries every list above; no `.planning/` file is committed.</done>
</task>

</tasks>

<verification>
After Task 2:
- `git diff --name-only <base>..HEAD` lists only non planning files of `files_modified` (plus the two methodology files only if a sentence read false). None of `packages/core/districts/champJointLock.ts`, `packages/core/districts/champJointLock.test.ts`, `apps/web/src/components/districts/districtLedgerStatus.ts`, `packages/core/districts/reservedSlots.ts`, `packages/core/districts/pooledLockInputs.ts`, `scripts/publishDistricts.ts`, anything under `apps/worker/` or `packages/harness/` appears.
- The sweep, measureChampTenets and `--check-history` as in Task 2; the root `npx vitest run` and the three typechecks clean. Verify by reading printed output and counts.
- Regression rules 1 to 3 of the planner readings hold, each backed by a printed line or a byte comparison named in the SUMMARY.

Soundness notes for the reviewer: D1 rests on a measurement (18 registered teams with no points, none within 113 points of a cut line) plus the tested fact that those teams stay pool rivals at extra 0, so a consuming award to one is counted; a district whose rowless registrant sat near the line would be the case to re examine. D3 rests on the finals event giving no judged award. D2 is withdrawn and the core proof is untouched.
</verification>

<success_criteria>
- Every truth in `must_haves` holds, each backed by a passing test, a printed sweep line or a byte comparison.
- Zero violations and zero skipped across all 48 championships; every single event and California bound and locked set byte identical to before; FNC and CA pins unmoved; the FIM and NE pins sets as executed whose members all qualified.
- Follow ups 9 and 15 are closed in the todo and the SUMMARY carries the per shape totals, the pin sets and the regression evidence.
</success_criteria>

<output>
Produce `.planning/quick/261009-pgq-champ-locks-earliness-a-rowless-team-lea/261009-pgq-SUMMARY.md` (`requirements_completed: [261009-pgq]`). If the harness blocks writing a SUMMARY.md from a subagent, return the full SUMMARY text to the orchestrator instead; do not route around the block through Bash. Never commit `.planning/` files; worktrees are off; edit the main checkout, stage by explicit path, check `git status` after each commit, do not push. Never Read, cat or echo `.env`.
</output>
