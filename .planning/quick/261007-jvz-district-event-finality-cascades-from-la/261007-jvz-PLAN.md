---
phase: quick-261007-jvz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/districts/reservedSlots.ts
  - packages/core/districts/reservedSlots.test.ts
  - apps/web/src/lib/liveEvent.ts
  - apps/web/src/lib/liveEvent.test.ts
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/districtLedgerRows.test.ts
  - apps/web/src/components/districts/districtMilestones.ts
  - apps/web/src/components/districts/districtMilestones.test.ts
  - scripts/measureLedgerTenets.ts
  - scripts/measureLedgerTenets.test.ts
  - packages/core/districts/champCutoffTuning.generated.ts
  - packages/core/districts/qualification.ts
  - packages/core/districts/qualification.test.ts
  - packages/harness/districtRankingsMerge.ts
  - apps/web/src/components/districts/districtLedgerStatus.ts
  - apps/web/src/components/districts/districtLedgerStatus.test.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - apps/web/src/components/methodology/districtLedgerContent.test.ts
  - apps/web/src/components/districts/predictedCutoff.ts
  - scripts/measureDistrictCutoff.ts
  - .planning/todos/pending/champ-cutoff-backtest-season-skips.md
  - .planning/todos/pending/locks-tab-award-at-uncounted-event.md
  - .planning/todos/completed/champ-cutoff-backtest-season-skips.md
  - .planning/todos/completed/locks-tab-award-at-uncounted-event.md
  - .planning/todos/pending/champ-cutoff-2022isr-week-tie.md
autonomous: true
requirements: [261007-jvz, champ-cutoff-backtest-season-skips, locks-tab-award-at-uncounted-event]

estimate:
  tokens: 150000
  raw_tokens: 300000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "districtEventCategoryFinality cascades: qualification is final on a fully played schedule OR alliancesPicked OR playoffsDone OR awardsPosted; alliance selection on alliancesPicked OR playoffsDone OR awardsPosted; playoffs on playoffsDone OR awardsPosted; awards on awardsPosted. A state with every fact false (null total or not) and an absent state block stay all open. 2023nhgrs (52 of 78 played) and 2022gacar (awards posted, playoffs never marked done) read finished."
    - "Rebuilt offline over 2016 to 2020 and 2022 to 2026, the publisher's 119 district objects are identical before and after the cascade apart from generation and computedAt: no published verdict, cut line or count moves for any event, curtailed, cancelled or otherwise (planner simulation: 0 of 109 artifacts move)."
    - "npx tsx scripts/measureChampCutoff.ts scores 68 district seasons with 2022isr the only skip, and reads simulated MAE 18.19 against 40.38 and coverage 48 of 69 (69.6%): the published Champ cutoff sentence exactly. Every selected tuning setting is unchanged, champCutoffTuning.generated.ts differs from its 2026-10-05 version (117960cd^) only in the Generated line, and --check-history prints no drift for both files."
    - "The District Locks tab counts an Impact award at any event that some team's rows resolve to the district tier, gated on that event's award finality at the position from one district wide map the slot reservation also reads, so an event is either consuming or reserving and never both. An award at an event no row names stays uncounted."
    - "measureLedgerTenets reads tenet A 0 and tenet B 0 on the default yardstick; against publishedFinalVerdicts over the rebuilt artifacts it reads 0 and 0 (from 4 and 0), and the publisher and the tab's district tier final standing agree on every team (from 37 differing). measureChampTenets reads 0 and 0."
    - "The District Points methodology page's District cutoff sentence reads 47 district seasons, 203 positions, 1.2 against 1.8, and 181 of those 203 positions, 89%; the Champ cutoff sentence is unchanged because the re-run reproduces it."
    - "Both todos sit in .planning/todos/completed/ with a closing note ending in the line: Release: pending republish by the orchestrator (2026-10-07). A new pending todo records the 2022isr week tie."
  artifacts:
    - path: "packages/core/districts/reservedSlots.ts"
      provides: "The cascading finality rule, documented with the 2023nhgrs and 2022gacar cases"
      contains: "2023nhgrs"
    - path: "packages/core/districts/qualification.ts"
      provides: "eventTierByKey, the one artifact derived event tier map the publisher and the tab share"
      contains: "export function eventTierByKey"
    - path: "apps/web/src/components/districts/districtLedgerStatus.ts"
      provides: "District wide award tier and award finality for the consuming award set"
      contains: "eventTierByKey("
    - path: "packages/core/districts/champCutoffTuning.generated.ts"
      provides: "Tuning fit statistics with the six curtailed seasons scored again"
      contains: "fitCount: 10"
    - path: "apps/web/src/components/methodology/districtLedgerContent.ts"
      provides: "District cutoff sentence at 47 seasons, 203 positions, 181 of 203"
      contains: "181 of those 203 positions, 89%"
  key_links:
    - from: "packages/core/districts/reservedSlots.ts districtEventCategoryFinality"
      to: "packages/harness/districtRankingsMerge.ts pooledDistrictPoints and reservedImpactSlots (publisher and Worker)"
      via: "the shared verdict pass recomputeDistrictVerdicts"
      pattern: "districtEventCategoryFinality\\(stateByEvent"
    - from: "packages/core/districts/reservedSlots.ts districtEventCategoryFinality"
      to: "apps/web/src/components/districts/districtLedgerRows.ts deriveStageFromState, apps/web/src/lib/liveEvent.ts shouldPollDistrictArtifact, apps/web/src/components/districts/districtMilestones.ts"
      via: "deriveStageFromState and districtEventStateFinished"
      pattern: "districtEventCategoryFinality\\(state\\)"
    - from: "packages/core/districts/qualification.ts eventTierByKey"
      to: "apps/web/src/components/districts/districtLedgerStatus.ts computeDistrictLedgerStatuses and packages/harness/districtRankingsMerge.ts awardQualifiedSets"
      via: "import"
      pattern: "eventTierByKey"
---

<objective>
Make a curtailed district event read final, so the Champ cutoff backtest scores its seasons again and the District Locks tab stops showing that event's qualification open forever. Then make the District Locks tab count a consuming award at any district tier event the way the publisher does. Close both todos.

- Task 1 (part 1): the finality cascade in the core rule, its consumers and their tests. It proves offline that no published artifact moves and that the champ backtest scores the six curtailed seasons again, and it regenerates the champ tuning.
- Task 2 (part 2): the district wide award rule in the tab, sharing one event tier map with the publisher. It runs both tenet sweeps against both yardsticks.
- Task 3 (part 3): publishes the measured methodology figures, closes both todos and records the 2022isr finding.

ONE DEVIATION FROM THE ORCHESTRATOR'S ORDER, ON PURPOSE. The methodology sentence edits move from part 1 to Task 3. Both backtests call `computeDistrictLedgerStatuses`, which Task 2 changes, so the page's figures are measured once, after both changes. The planner's simulation shows Task 2 moves neither backtest (see Planner measurements). Task 1 still runs both backtests and records the part 1 reading. The champ tuning regeneration stays in Task 1 so `--check-history` is green at every commit.

Purpose: the champ backtest, the live tab and the publisher read one finality rule and one award rule, and the methodology page quotes the measured result.

Output: code, tests, one regenerated generated file, methodology copy and todo moves. The orchestrator runs `pnpm rebaseline` afterwards. That run deploys the Worker, which picks up the cascade through the shared verdict pass. District artifacts carry no algorithm version, so no version bump is owed. This plan runs NO network command. It does not publish, deploy or push, and it never reads `.env`.

NO TRACER TASK. These are changes to two proven rules, in an order the orchestrator fixed. Each task's verify checks its rule end to end: the core rule, then the publisher rebuild, then the tab's sweeps, then both backtests.

RUNS IN THE MAIN CHECKOUT, NOT A WORKTREE. Every task reads `data/local-publish/` and `data/corpus.sqlite`. Both are gitignored and absent from any worktree.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/champ-cutoff-backtest-season-skips.md
@.planning/todos/pending/locks-tab-award-at-uncounted-event.md
@.planning/quick/261007-il9-short-roster-follow-ups-methodology-figu/261007-il9-SUMMARY.md

Source map. Read each section once with offset and limit. Several files are long.
- packages/core/districts/reservedSlots.ts (179 lines). Header and the cancelled carve out are at 1-61. `districtEventStateStarted` is at 72-82, `districtEventCategoryFinality` and its doc at 84-125, `districtEventStateFinished` at 127-137 and `isNeverHappening` at 148-154.
- packages/core/districts/reservedSlots.test.ts (143 lines). The fixtures are at 23-31 (FINISHED, PLAYOFFS_DONE_NO_AWARD, AHEAD, NEVER_HAPPENED, CANCELLED_BUT_AWARDED). The predicates are at 37-51, `districtEventCategoryFinality` at 53-77 and the carve out at 106-142.
- apps/web/src/lib/liveEvent.ts. The district poll gate and its "honest limitation" doc are at 105-150. apps/web/src/lib/liveEvent.test.ts: the district gate describe is at 117-150.
- apps/web/src/components/districts/districtLedgerRows.ts. `deriveStageFromState` and its doc are at 118-140. In districtLedgerRows.test.ts, the `state()` helper at 53-55 defaults to all true; `deriveStageFromState` tests are at 168-189 and the posted award fixture is at 1874-1905.
- apps/web/src/components/districts/districtMilestones.ts. `districtMilestoneEventStatus` is at 140-144 and `milestoneHappened` at 244-270. In districtMilestones.test.ts, helpers `state()` (65), `input` (72), `timelineOf` (76), `modelOf` (83) and `milestone` (87); "happened reads the state blocks" is at 171-203.
- apps/worker/src/districtEventState.ts (79 lines) and apps/worker/src/districtRefresh.ts 235-271. Read only. They derive the four facts. `awardsPosted` is requested only once `playoffsDone` is true.
- scripts/publishDistricts.ts 820-905. Read only. The publisher's corpus derivation of the same facts.
- packages/core/districts/pointPool.ts, pooledLockInputs.ts and champReservedSlots.ts. Read only. Consumers of the finality and the started predicate.
- packages/harness/districtRankingsMerge.ts (783 lines). `tierByEventKey` is at 145-159 and `awardQualifiedSets` at 161-193. The reservation walk is at 195-232, the pool walk at 234-286 and `reservedChampSlotsAtNow` at 300-335 (raw flags, unchanged).
- apps/web/src/components/districts/districtLedgerStatus.ts (425 lines). The result docs that cite the todo are at 92-125. `reservedSlotsAtPosition` is at 178-226 and the `computeDistrictLedgerStatuses` doc at 282-302. The own rows guard is at 323-357.
- apps/web/src/components/districts/districtLedgerStatus.test.ts (710 lines). Helpers `played`, `ahead`, `team`, `artifactOf` and `statusesFor` are at 41-104. The award filter describe is at 172-233 and the reservation describe at 302-383.
- apps/web/src/components/districts/champLedgerStatus.ts 224-301. Read only. The champ tier's award scan.
- packages/core/districts/qualification.ts (124 lines, no imports). qualification.test.ts sits beside it.
- scripts/measureLedgerTenets.ts. The header residual paragraph is at 70-83. The `publishedFinalVerdicts` doc is at 384-401 and the `districtTierFinalVerdicts` doc at 403-418 (the "19 of the 109" sentence). scripts/measureLedgerTenets.test.ts: the MEASURED pins are at 64-127 and the corpus describe starts at 450.
- scripts/measureChampCutoff.ts. `backtestDistrict` is at 517-547 and main at 971-1121.
- apps/web/src/components/methodology/districtLedgerContent.ts. Header source 8 (champ) is at 70-80 and source 9 (district) at 82-94. The District cutoff sentence is at 206 and the Champ cutoff sentence at 210. districtLedgerContent.test.ts: the figure pins are at 150-169.
- apps/web/src/components/districts/predictedCutoff.ts 140-168 (the comment carrying both backtests' figures). scripts/measureDistrictCutoff.ts 30-41 (the dated header).
- Copy voice, read before the Task 3 copy edit: .claude/skills/sketch-findings-sigmascout/SKILL.md. Methodology copy is flat third person. Rendered copy carries no hyphen, en dash or em dash characters and no how or why sentences.

Planner scratch instruments, already written and smoke tested. Use them; do not copy them into the repo.
SCR = C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/bceca0a0-ef0f-425c-b2f6-55fb04f0beaa/scratchpad
Shell state does not persist between Bash calls, so begin every Bash command that uses it with `SCR="<that path>" &&`.
- SCR/cascadeArtifactDiff.ts takes a before dir and an after dir. It deep diffs every object, ignoring generation and computedAt, and prints MOVED or UNEXPLAINED per moved file. A moved file counts as tied when it holds a district tier event whose finality the cascade changes. It also prints INPUT MOVED for any moved corpus fact, and a final "files compared N; moved M; unexplained U; input moved I; missing X" line. Smoke tested: the same dir twice reads 119 / 0 / 0 / 0 / 0.
- SCR/districtVerdictCompare.ts (from 261007-il9) takes a before dir and an after dir. Pass the same dir twice to read the tenet sweep against `publishedFinalVerdicts` and the default yardstick, plus the publisher against tab final residual by kind.
- SCR/isrProbe.ts prints 2022isr's rail and its end of district season index.
- SCR/awardRuleProbe.ts classifies every publisher against tab final difference by where the award's event resolves.
- Prediction tools, for reference only (they copy HEAD code and go stale once you edit): cascadeSim.ts, cascadeTenetSim.ts, part2TenetSim.ts, part2FinalProbe.ts, champTenetSim.ts, makePart2Mine.mjs, makeCutoffMine.mjs and the measure*.p1/p12 copies. Their outputs: jvz-champ-head.txt, jvz-champ-p1.txt, jvz-champ-p12.txt, jvz-district-head.txt, jvz-district-p1.txt, jvz-district-p12.txt and jvz-tenets-head.txt.
- SCR/districts-after-il9/ is the publisher rebuild at 75db163a. Do not use it as this plan's before set: the corpus mtime moved after it was written. Task 1 rebuilds its own.
</context>

## Planner measurements (2026-10-07, HEAD 870174cc, read only or into the scratchpad)

The cascade was simulated without editing the repo. Every state block was rewritten so the CURRENT rule reads it as the cascade would. Part 2 was simulated with a scratch copy of districtLedgerStatus.ts.

- **Which events the cascade changes** (data/local-publish/districts): 115 (event, tier) entries.
  - Curtailed district events, schedule longer than what was played, with alliances, playoffs and awards all recorded: 2016mdbet 65/78, 2017gagai 65/78, 2019vahay 70/76, 2022va319 29/34, 2022dc306 33/35, 2022gadal 61/66, 2023nhgrs 52/78, 2024mdsev 72/74 and 2024gagwi 60/62. Read only against the corpus, each event played qm1 to qmN with no gap and left the tail unplayed: a real curtailment, not ties or missing scores.
  - 2022gacar: 76/76 played and awards posted, but one quarterfinal row was never played, so `playoffsDone` is false.
  - The 2020 cancellations: 71 district tier events and 10 District Championships in 11 districts, each with no matches, a null total and awards posted.
  - Divisioned DCMP parents (dcmp tier, null total, alliances, playoffs and awards all true): every FIM, FIT, NE and ONT championship parent of 2017 to 2026 where present.
- **Publisher side**: recomputeDistrictVerdicts on the 109 rebuilt artifacts, before against cascade, moves 0 artifacts and 0 team rows.
  - In 2020 no team has a remaining event, and every maxRemainingDistrict is 0, so the ceiling test already decided every 2020 verdict. The pool cannot add a lock there, and every 2020 event's awards were already read as posted.
  - The champ pass reads raw `playoffsDone`/`awardsPosted` (`reservedChampSlotsAtNow`). An awardsPosted championship already reserves nothing, so the dcmp tier cascade moves nothing there.
- **Seasons with an unfinished district tier event at now**: 19 before (2016chs, 2017pch, 2019chs, all eleven 2020 districts, 2022chs, 2022pch, 2023ne, 2024chs and 2024pch). 0 after.
- **District tenet sweep, default yardstick** (data/local-publish/districts, 109 seasons, 4,022 positions, 921,658 team positions):

  | Census line | HEAD | Cascade | Both parts |
  |---|---|---|---|
  | tenet A / tenet B / unresolved tie | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | Locked on points shown | 76,390 | 77,202 | 76,964 |
  | Locked out shown | 166,590 | 167,428 | 167,429 |
  | Locked · award chip | 24,192 | 24,192 | 24,466 |
  | Slots held back | 26,604 at 3,804 | unchanged | unchanged |
  | Pooled only locks | 6,296 at 1,029 | 6,552 at 1,074 | 6,512 at 1,073 |

  The HEAD pins in measureLedgerTenets.test.ts equal the HEAD column exactly.
- **Against publishedFinalVerdicts** (fresh publisher rebuild): tenet A 4 (2019fma frc5113 and frc6943, at 2019paben:awards and at now) and tenet B 0, both at HEAD and under the cascade alone. With both parts: 0, 0 and 0.
  - The publisher against tab final residual is 37 teams at HEAD. 33 of them won an Impact award at an event another team carries a district row for (`otherRows`). The other 4 are the knock on ties in 2019fma and 2018ont.
  - With both parts the residual is 0. No `noRow` case exists in the 109 seasons, so the publisher's corpus supplied tier currently decides nothing the tab cannot see.
  - The orchestrator's expected "lockedAward against locked labelling difference" residual does not materialise: the label follows the counted award.
- **Champ tier tenet sweep**: HEAD 0 / 0 (114 unresolved ties). Under the cascade 0 / 0: Locked 6,953 to 7,243, Locked out 270,469 to 271,471, held back slots 44,444 to 44,404. The 40 fewer held back slots are the ten 2020 championships' playoff stops, where four winning alliance slots were held back for playoffs never played. With both parts 0 / 0, Locked out 271,506.
- **Champ cutoff backtest, main mode**:
  - HEAD: 7 skipped, n = 62, 18.50 against 39.00, 42 of 69 (60.9%).
  - Cascade alone, and both parts alike: SKIPPED 1, "2022isr: district event 2022isde4 is not final at the end of district season position". n = 68, simulated MAE 18.19 against same position naive 40.38, printed coverage 48 of 69 (69.6%). Gates 1 to 4 PASS and gate 5 FAILs; leak checks pass 68 of 68.
  - Every selected setting is unchanged (2017 uniform/fixed/1.00, every later season uniform/fixed/1.75). The fit statistics become exactly those of the 2026-10-05 file (`git show 117960cd^:packages/core/districts/champCutoffTuning.generated.ts`), for example 2018 fit n = 10, coverage 0.9, MAE 14.4.
  - **The published Champ cutoff sentence is reproduced exactly.**
- **Why the seven seasons started skipping**: the all final refusal has existed since d6fd9370 (2026-09-27). It is NOT the 10-04/05 measure script change the brief names. The skips began with c4bc0b62 (261005-5g0, 2026-10-05 18:30), "a category open now is never final at an earlier rewound Locks stop". That fix intersects every rewound stage with the now stage. Under the old rule a curtailed event's qualification was open at now, so it became open at every rewound stop. 8319959c measured the published 68 / 18.2 / 40.4 / 48 of 69 that same morning, before c4bc0b62.
- **The 2022isr cause (not finality)**: 2022isde4 (start 2022-03-22) and 2022iscmp (start 2022-03-27) both carry TBA week 3. With no event artifacts the rail orders untimed steps by week, then by event key. "2022iscmp" sorts before "2022isde4", so all four championship stage steps land ahead of isde4's. The end of district season position is therefore 2022isde3:awards (index 12 of 21), where isde4 has not happened. The cascade cannot fix this, so 68 is the right count, not 69.
- **District cutoff backtest**:
  - HEAD: 89 seasons swept, 193 scored, season start n = 45, 1.17 against 1.80, 171 of 193 (88.6%).
  - Cascade alone, and both parts alike: 108 seasons swept and 203 scored positions. Season start n = 47, which is the "district seasons" figure; 2023ne and 2024 add the positions. All positions MAE 1.2 against 1.8 (gate line 1.15 < 1.77). The range holds 181 of 203 (89.2%), three positions above the band's integer ceiling of 178. One season is skipped (2022ont, settled cutoff absent). The run reports 71 district tier events with no artifact on disk and 0 scored positions with an unpriced open event: the newly unskipped pre-2023 and 2020 seasons have no local event artifacts, and every position that needs one is a no call or settled.
- **Runtimes**: the publisher dry run takes 6 s, measureLedgerTenets 6 s, measureChampCutoff main 22 to 29 s and measureDistrictCutoff 25 to 29 s.

## Concurrent-session rules (every task, every commit)

- Another Claude session commits to this checkout today. Before editing a file, run `git status --short -- <file>`. If the file shows a modification you did not make, do not edit it: stop that step and report it.
- Stage by EXPLICIT PATH only. Never `git add -A`, `git add .`, `git commit -a` or `git stash`.
- Run `git status --short` before every commit and `git diff --cached --stat` after staging. Only this task's files may be staged. Leave any file you did not edit unstaged, and name it in your report.
- Do not commit PLAN.md, SUMMARY.md or STATE.md; the orchestrator does. Do not touch ROADMAP.md.
- No network: no publish, no deploy, no push, no `pnpm publish:*` script (those carry `--env-file=.env`), and no `wrangler`. Never read, cat or echo `.env`.
- Never write into `data/local-publish/`. Every rebuilt artifact goes to SCR.
- Verify by OUTPUT, never by exit code. Run `npx vitest run ...` from the repo root and quote the pass/fail counts. Never wrap a command in `timeout`. core.autocrlf is true, so any source regex test must normalise CRLF.
- Redirect every long measurement to a file in SCR and grep it; do not page whole reports into context.

## Pin triage rule (Tasks 1 and 2)

When the full suite turns red, classify every failing assertion before touching it:
1. It pins the OLD per fact rule itself: a finality, finished or stage test whose override sets an earlier stage open beside a later one true. Update it to the cascade. The locked fix replaces that rule.
2. Its fixture combines a later stage fact with an earlier stage open as a convenience, and the test's subject is something else. Keep every assertion. Where the stage is a parameter, pass the old stage as an explicit literal with a one line comment naming the cascade. Change an expectation only where it is a direct consequence of an earlier category now reading final.
3. It is in pointPool, pooledLockInputs, champReservedSlots or a reservation consumer and encodes "a curtailed or cancelled event stays open". Update it only if its comment shows that was not a deliberate decision. Otherwise STOP and report it.
4. Anything not explained by "an earlier category now reads final" (or, in Task 2, "an award at another team's event now counts"): STOP and report.

Name every edited test file and the class of each change in the report. Never delete an assertion and never loosen an equality.

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: District event finality cascades from later stages (core rule, consumers, offline proof, champ tuning)</name>
  <files>packages/core/districts/reservedSlots.ts, packages/core/districts/reservedSlots.test.ts, apps/web/src/lib/liveEvent.ts, apps/web/src/lib/liveEvent.test.ts, apps/web/src/components/districts/districtLedgerRows.ts, apps/web/src/components/districts/districtLedgerRows.test.ts, apps/web/src/components/districts/districtMilestones.ts, apps/web/src/components/districts/districtMilestones.test.ts, scripts/measureLedgerTenets.ts, packages/core/districts/champCutoffTuning.generated.ts</files>
  <precondition>data/local-publish/districts, data/local-publish/district-events and data/corpus.sqlite exist in the main checkout, and `git status --short` prints nothing for this task's files.</precondition>
  <behavior>
    - 2023nhgrs shape {played 52, total 78, alliances, playoffs, awards}: all four categories final; finished true.
    - 2022gacar shape {76, 76, alliances true, playoffs false, awards true}: all four final; finished true.
    - Alliances picked only {40, 60, true, false, false}: qual and alliance final, elim and award open.
    - Divisioned DCMP parent {0, null, true, true, true}: all four final. {0, null, true, false, false}: qual and alliance final.
    - The 2020 shape (CANCELLED_BUT_AWARDED): all four final; finished true; started true.
    - Mid quals {20, 60, false, false, false}, AHEAD and NEVER_HAPPENED: all four open. An absent state is all open.
    - Monotone, by enumeration over the eight combinations of the three booleans and three qualification states (full, partial, null): award implies elim, elim implies alliance, alliance implies qual, and finished always equals the four ANDed.
    - Carve out at now: CANCELLED_BUT_AWARDED (award final) beside NEVER_HAPPENED reserves 0 (it was 1). At a rewound stop with the c2020 award reopened it reserves 1 (it was 2). The 2020 event itself is still never called cancelled.
    - Poll gate: a district artifact whose only district event is curtailed {52, 78, true, true, true} does not poll (it did). The divisioned parent shape with every later fact true reads finished.
    - Milestones: the 2020 shape reads done, with Schedule, Quals done, Alliances done, Finals and Awards happened and the three quartiles and five rounds not. The 2023nhgrs shape reads done with Quals ¾ (match 59) not happened. The 2022gacar shape's Finals stop happened.
  </behavior>
  <action>
    STEP 0, BASELINE BEFORE ANY EDIT.
    - Rebuild the publisher's district objects at HEAD: `npx tsx scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --no-bake --local-out "$SCR/districts-before-jvz"`, with stdout and stderr to SCR/districts-before-jvz.log.
    - Record `stat -c '%s %Y' data/corpus.sqlite` (and data/corpus.sqlite-wal if it exists) into SCR/corpus-stat-before.txt.
    - Run `npx tsx scripts/measureLedgerTenets.ts` into SCR/jvz-tenets-t0.txt. Confirm the TOTALS block equals the HEAD column of Planner measurements.

    STEP 1, TESTS FIRST (RED). In reservedSlots.test.ts, add the behavior cases above, naming each real event in its test title (2023nhgrs 52 of 78, 2022gacar, the divisioned DCMP parent, the 2020 cancellations). Then update the pins the locked fix replaces:
    - "leaves a null qualMatchesTotal unfinished" (line 46): CANCELLED_BUT_AWARDED now reads finished. Retitle the case: a null total stays unfinished only while no later fact is true, and NEVER_HAPPENED is the case that stays unfinished.
    - "reads each category off its own state fact" (line 54): retitle it to the cascade, and expect CANCELLED_BUT_AWARDED all final.
    - "leaves qualification OPEN for a partly played schedule and for a null total" (lines 61-64): keep both opens with every later fact false, and add the two finals (partly played with alliances picked; null total with alliances picked).
    - The carve out describe (106-142): add the two 2020 neighbour cases from the behavior list, with a comment. The 2020 events now count as finished in clause 3, so a lone registered, never played event beside them is called cancelled once the season is over. No 2020 artifact carries such a row, so no published verdict moves.
    Run `npx vitest run packages/core/districts/reservedSlots.test.ts` and confirm the new cases fail.

    STEP 2, THE RULE (GREEN). In `districtEventCategoryFinality`, compute award = awardsPosted, elim = playoffsDone or award, alliance = alliancesPicked or elim, and qual = (total not null and played equals total) or alliance. Keep the absent state answer ALL_CATEGORIES_OPEN, and keep `districtEventStateStarted` byte for byte. `districtEventStateFinished` still derives from the finality.

    Rewrite the doc comments so the cascade is stated once and named:
    - The physical order: alliance selection cannot start before qualification ends, playoffs cannot finish before alliances are picked, and awards are posted at the closing ceremony after the playoffs. The Worker requests `/event/{key}/awards` only once `playoffsDone` is true (districtRefresh.ts).
    - The cases: 2023nhgrs (52 of 78 qualification matches played, then alliances, playoffs and awards); 2022gacar (awards posted, one quarterfinal row never played, so playoffs never marked done); the divisioned DCMP parent (no qualification schedule of its own); and the 2020 cancellations (awards posted, no match played), which now read finished.
    - The guarantee: every category the cascade closes has already handed out all its points. The remaining points pool shrinks only by points nobody can still earn, and a null total with no later fact stays open.
    - The header carve out: clause 1 is unchanged (awardsPosted still counts as started). Clause 3 now counts a cancelled but awarded event as finished.
    - Fix `districtEventStateFinished`'s "NULL qualMatchesTotal leaves qualification open" doc, which now holds only while no later fact is true.

    STEP 3, CONSUMERS.
    - liveEvent.ts: amend the poll gate's honest limitation paragraph. A curtailed event now finishes once its alliances are picked, so it stops polling. The limitation stays for an event that starts and is abandoned before alliance selection. No code change. In liveEvent.test.ts, update "never calls an event finished while its schedule length is unpublished" (line 137) per the behavior list, and add the curtailed poll gate case.
    - districtLedgerRows.ts: fix the `deriveStageFromState` doc the same way (no code change). In districtLedgerRows.test.ts (168-175), give each single fact override its later facts false so the assertion still isolates that fact, then add one cascade assertion. If the posted award fixture at 1874-1905 fails, apply triage class 2: build the simulation input with the literal stage { qual: false, alliance: false, elim: false, award: true } and keep every assertion.
    - districtMilestones.ts `milestoneHappened`: the `alliance` stop reads `districtEventCategoryFinality(state).alliance` and the `playoffs` (Finals) stop reads `.elim`, as `qualsDone` already reads `.qual`. Otherwise the cascade itself would leave a done 2020 event with Quals done happened and Alliances done not. Leave the quartile, round and awards stops as they are. Add the three milestone cases from the behavior list.
    - Read, change nothing, and state this in the report: apps/worker/src/districtEventState.ts and districtRefresh.ts 235-271. They derive the facts; the Worker picks up the cascade only through recomputeDistrictVerdicts. Also read pointPool.ts, pooledLockInputs.ts and champReservedSlots.ts. `dcmpNeverHappening` reads only `districtEventStateStarted`, which is unchanged.
    - Run `npx vitest run` from the repo root. Triage every failure by the pin triage rule.

    STEP 4, THE OFFLINE PUBLISHER PROOF.
    - Rebuild into SCR/districts-after-jvz with the same command as step 0, and record SCR/corpus-stat-after.txt.
    - Run `npx tsx "$SCR/cascadeArtifactDiff.ts" "$SCR/districts-before-jvz" "$SCR/districts-after-jvz"`. Expected: "files compared 119; moved 0; unexplained 0; input moved 0; missing 0".
    - If anything moved, list every moved file and field and the cascade events printed under it. Every one must read MOVED, not UNEXPLAINED. If any reads UNEXPLAINED, STOP and report.
    - If INPUT MOVED appears or the two corpus stats differ, the other session changed the corpus between the runs. Copy your edited reservedSlots.ts to SCR, write `git show HEAD:packages/core/districts/reservedSlots.ts` over it, rebuild the before set, copy your edit back, confirm `git diff --stat` shows it, rebuild the after set, and diff again.

    STEP 5, THE SWEEPS.
    - `npx tsx scripts/measureLedgerTenets.ts` into SCR/jvz-tenets-t1.txt. Expect the Cascade column: 0 and 0, and "seasons with an unfinished district-tier event at now: 0". Every floor pin still holds, so leave measureLedgerTenets.test.ts for Task 2.
    - Also run it with `--dir "$SCR/districts-after-jvz"` and expect 0 and 0.
    - `npx tsx "$SCR/districtVerdictCompare.ts" "$SCR/districts-after-jvz" "$SCR/districts-after-jvz"` into SCR/jvz-compare-t1.txt. Expect tenet A 4 and tenet B 0 against publishedFinalVerdicts, the four 2019fma rows, and the 37 team residual by kind of the il9 SUMMARY.
    - `npx tsx scripts/measureChampTenets.ts` into SCR/jvz-champtenets-t1.txt. Both tenets must read 0. If either is not 0, STOP and report the rows.
    - scripts/measureLedgerTenets.ts, `districtTierFinalVerdicts` doc (about 409-415): the "19 of the 109" sentence becomes history. Before quick task 261007-jvz, 19 of the 109 local seasons carried an event whose own state did not read finished: curtailed events, the 2020 cancellations and 2022gacar. The cascade reads all of them finished, and the census line reads 0. The forced final standing stays the yardstick, because it also covers an artifact whose rows carry no state block.

    STEP 6, THE CHAMP BACKTEST AND ITS TUNING.
    - `npx tsx scripts/measureChampCutoff.ts` into SCR/jvz-champ-t1.txt. Expect SKIPPED 1 (2022isr, the week tie above), n = 68, gate line 2 "18.19 < ...", gate line 3 "... 0.75 x 40.38", gate line 5 "48 of 69 (69.6%)", gates 1 to 4 PASS, and leak checks 68 of 68.
    - If any of gates 1 to 4 FAILs, or a selected setting differs from HEAD's, STOP before writing either generated file and report.
    - `npx tsx scripts/measureChampCutoff.ts --write-history`. If `git diff` on dcmpHistory.generated.ts shows only the Generated line, restore it with `git checkout -- packages/core/districts/dcmpHistory.generated.ts`: the history reads no finality and its content did not change. Any other line change: STOP and report.
    - `npx tsx scripts/measureChampCutoff.ts --write-tuning`. Then `git diff 117960cd^ -- packages/core/districts/champCutoffTuning.generated.ts` must show only the Generated line. That proves the regeneration restored the 2026-10-05 fit statistics.
    - Also extract each `season: N, setting: {...}` with grep -o from HEAD's file and from the working copy and diff the two lists. The diff must be empty.
    - `npx tsx scripts/measureChampCutoff.ts --check-history` must print "no drift" twice.
    - `npx tsx scripts/measureDistrictCutoff.ts` into SCR/jvz-district-t1.txt. Record the figures; Task 3 publishes them.

    COMMIT 1: stage this task's paths plus any test file the triage rule edited. Message: `fix(261007-jvz): district event finality cascades from later stages, so curtailed events read final`. The body names 2023nhgrs and 2022gacar, states the publisher rebuild moved 0 of 119 objects, and gives the champ backtest's 68 seasons and 48 of 69 with the tuning back on its 2026-10-05 fit statistics.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/reservedSlots.test.ts apps/web/src/lib/liveEvent.test.ts apps/web/src/components/districts/districtLedgerRows.test.ts apps/web/src/components/districts/districtMilestones.test.ts packages/core/districts/pointPool.test.ts packages/core/districts/pooledLockInputs.test.ts packages/core/districts/champReservedSlots.test.ts packages/harness/districtRankingsMerge.test.ts (from the repo root; quote the counts)</automated>
    <automated>npx tsx "$SCR/cascadeArtifactDiff.ts" "$SCR/districts-before-jvz" "$SCR/districts-after-jvz" prints "moved 0; unexplained 0; input moved 0"</automated>
    <automated>npx tsx scripts/measureChampCutoff.ts --check-history prints "no drift" for both files; SCR/jvz-champ-t1.txt shows SKIPPED 1 and "48 of 69 (69.6%)"</automated>
  </verify>
  <done>The cascade is the one finality rule. Its tests pin every named shape and the monotone property, the publisher rebuild is unchanged, both tenet sweeps read 0 and 0 on the default yardstick, and the champ backtest scores 68 seasons with the tuning back on its 2026-10-05 fit statistics. Commit 1 holds exactly this task's paths.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The Locks tab counts a consuming award at any district tier event, like the publisher</name>
  <files>packages/core/districts/qualification.ts, packages/core/districts/qualification.test.ts, packages/harness/districtRankingsMerge.ts, apps/web/src/components/districts/districtLedgerStatus.ts, apps/web/src/components/districts/districtLedgerStatus.test.ts, scripts/measureLedgerTenets.ts, scripts/measureLedgerTenets.test.ts</files>
  <precondition>Commit 1 is HEAD or an ancestor of HEAD, and SCR/districts-after-jvz exists.</precondition>
  <behavior>
    - eventTierByKey: an eventPoints row's tier wins over a remainingEvents row for the same key. A key only on remainingEvents resolves from it. A key on team B's rows resolves for any caller. No teams gives an empty map.
    - The 2019fma shape at now. dcmpSlots 2; events a, b and c, all FINISHED. frc1 has 100 (a 60, c 40), frc2 80 (a 50, c 30), frc3 70 (b 70). frc9 has 20 (a 10, b 10) and an Impact award at c, where frc9 has no row. Expected: frc9 has byAward true and verdict lockedAward; awardQualified is ["frc9"]; reservedSlots is 0; frc2 reads lockedOut with verdict eliminated (the old rule read it locked).
    - The reopened award. Same artifact, stage map with c's award open and everything else final. frc9 is not award qualified, reservedSlots is 1, and frc2 is neither locked nor lockedOut. The slot is reserved or consumed, never both.
    - An award at an event no team carries any row for stays uncounted: frc9 has byAward false and frc2 reads locked. This is the conservative fallback the Worker shares.
    - An award at an event another team's rows resolve to the dcmp tier stays excluded at this tier.
  </behavior>
  <action>
    STEP 1, TESTS FIRST (RED).
    - qualification.test.ts: add the eventTierByKey cases.
    - districtLedgerStatus.test.ts: add a describe "an award at an event the team has no district tier row for (261007-jvz)" with the four status cases above, built from the existing helpers (`played`, `team`, `artifactOf`, `statusesFor`, `AWARD_TYPE_IMPACT`).
    - Its doc comment names the real case: frc1391 won Chairman's at 2019paben, its third and uncounted event, and attended 2019mrcmp from below the line. The publisher already consumes that slot. FIRST's district rules qualify a district event Impact winner for the DCMP whichever of its events it won at.
    - Engineering Inspiration and Rookie All Star stay award only invites at this tier (qualification.ts), and this task does not change that.
    - Run both files and confirm the new cases fail.

    STEP 2, ONE TIER MAP.
    - Move the publisher's private `tierByEventKey` (districtRankingsMerge.ts 145-159, doc included) into qualification.ts as exported `eventTierByKey`. Type it structurally over teams carrying `eventPoints` and `remainingEvents` rows of `{ eventKey: string; tier: AwardTier }`, so qualification.ts stays import free.
    - districtRankingsMerge.ts imports it and deletes the local copy. `awardQualifiedSets` keeps its caller supplied corpus tier first. This refactor is behaviour identical, and step 4 proves it.

    STEP 3, THE TAB.
    - districtLedgerStatus.ts: add exported `awardFinalByEventAtPosition(artifact, teams)`. It holds the two lookups `reservedSlotsAtPosition` makes today, unchanged: the first row seen per event across ALL `teams[].rows` (the stage at the position), then, for a district tier event no built row names, the first artifact entry's `state?.awardsPosted === true`. `reservedSlotsAtPosition` calls it, behaviour identical.
    - In `computeDistrictLedgerStatuses`, build `eventTierByKey(artifact.teams)` and `awardFinalByEventAtPosition(artifact, teams)` once, before the team loop. Delete the per team `districtTierEventKeys` and `awardFinalByEvent` maps. An award counts when its event's tier is "district", its type consumes at the district tier, and the shared map reads its award final at the position.
    - Rewrite the comment at the guard. The tier comes from every team's rows, as the publisher's artifact derived map does, and the finality comes from the same map the reservation reads, so an event consumes or reserves and never both.
    - Update the docs that cite the todo (about 95-102, 120-125 and 290-300). The tab and the publisher now differ only where the publisher's corpus tier names an event no team carries a row for. Measured 2026-10-07 over the 109 local seasons: no such team.
    - champLedgerStatus.ts (read only): its award scan already resolves dcmp keys district wide through `dcmpEventKeysFor(artifact)`, and its gate reads the team's own championship stage, where its award was won. There is no own rows guard, so change nothing and state that in the report.
    - districtFieldOverlay.ts's award only invitee check (line 140) also reads the team's own rows. It is a display rule for EI and RAS invites, not a guarantee. Leave it and name it in the report.

    STEP 4, MEASURE (all into SCR).
    - Rebuild into SCR/districts-after-jvz-t2 and run `cascadeArtifactDiff.ts` against SCR/districts-after-jvz. Expected: moved 0.
    - `measureLedgerTenets.ts` default and with `--dir "$SCR/districts-after-jvz"`. Expect 0 and 0, and the Both parts column of Planner measurements.
    - `districtVerdictCompare.ts` with the after dir twice. Expect tenet A 0, tenet B 0, unresolved tie 0 against publishedFinalVerdicts, and no residual kind listed (0 teams). Report any residual team with its class from `awardRuleProbe.ts`.
    - `measureChampTenets.ts`: 0 and 0.
    - `measureChampCutoff.ts` main: n = 68, 18.19 against 40.38, 48 of 69, and `--check-history` with no drift twice.
    - `measureDistrictCutoff.ts`: the same figures as SCR/jvz-district-t1.txt. If either backtest moved, record the new figures for Task 3.
    - If any tenet reads above 0, STOP and report the rows.

    STEP 5, PINS AND RECORDS.
    - measureLedgerTenets.test.ts: re-pin each moved floor to the measured value. Expected: MEASURED_LOCKED_SHOWN 76,964; MEASURED_LOCKED_OUT_SHOWN 167,429; MEASURED_LOCKED_AWARD_CHIP_SHOWN 24,466; MEASURED_LOCKED_BY_POOLED_ONLY 6,512; MEASURED_POSITIONS_WITH_POOLED_ONLY_LOCK 1,073. Use your measured numbers.
    - Add a dated comment in the style of the 261005-5g0 one. Quick task 261007-jvz's finality cascade made more categories final (Locked 76,390 to 77,202, Locked out 166,590 to 167,428, pooled only 6,296 to 6,552 at 1,074). The district wide award rule then moved Locked displays onto the award chip (Locked to 76,964, chip 24,192 to 24,466). Both tenets stayed 0.
    - Equality pins never move. The reservation pins stay at 26,604 and 3,804 unless measured otherwise; report any difference.
    - Update the 24,192 pin's own doc line, which says it was unchanged by 261005-04t.
    - measureLedgerTenets.ts header residual paragraph (70-83) and `publishedFinalVerdicts` doc (384-401): after 261007-il9's 4 and 0, quick task 261007-jvz moved the tab onto the district wide award rule. Against the publisher's verdicts the sweep reads 0 and 0, and the publisher and the tab's final standing agree on every team (37 to 0). Keep the 2019fma frc1391 account as the case that motivated it.
    - Run `npx vitest run` from the repo root, triaging any failure by the pin triage rule.
    - Run `npx tsc --noEmit -p tsconfig.json`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json` and `-p apps/worker/tsconfig.json`.

    COMMIT 2: stage this task's paths. Message: `fix(261007-jvz): Locks tab counts a consuming award at any district tier event, like the publisher`. The body gives tenet A 4 to 0 against the publisher, the residual 37 to 0, and the default yardstick still 0 and 0.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/qualification.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts packages/harness/districtRankingsMerge.test.ts scripts/measureLedgerTenets.test.ts apps/worker/test (from the repo root; quote the counts)</automated>
    <automated>npx tsx "$SCR/districtVerdictCompare.ts" "$SCR/districts-after-jvz" "$SCR/districts-after-jvz" shows tenetA 0 tenetB 0 against publishedFinalVerdicts and lists no residual kind</automated>
    <automated>npx tsx scripts/measureLedgerTenets.ts and npx tsx scripts/measureChampTenets.ts each report zero violations</automated>
  </verify>
  <done>The tab and the publisher read one artifact derived tier map. The tab counts the 2019fma shape and refuses the reopened and no row shapes. Every tenet reads 0 on both yardsticks and both tiers, the residual is 0 teams, the floors are re-pinned to measured values, and the four typechecks are clean. Commit 2 holds exactly this task's paths.</done>
</task>

<task type="auto">
  <name>Task 3: Methodology figures after both changes; close both todos; record the 2022isr week tie</name>
  <files>apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/methodology/districtLedgerContent.test.ts, apps/web/src/components/districts/predictedCutoff.ts, scripts/measureDistrictCutoff.ts, .planning/todos/pending/champ-cutoff-backtest-season-skips.md, .planning/todos/pending/locks-tab-award-at-uncounted-event.md, .planning/todos/completed/champ-cutoff-backtest-season-skips.md, .planning/todos/completed/locks-tab-award-at-uncounted-event.md, .planning/todos/pending/champ-cutoff-2022isr-week-tie.md</files>
  <precondition>Commits 1 and 2 are in HEAD's history, and `git status --short` prints nothing for this task's files.</precondition>
  <action>
    STEP 1, MEASURE ONCE, AFTER BOTH CHANGES.
    - `npx tsx scripts/measureChampCutoff.ts` into SCR/jvz-champ-t3.txt and `--check-history`, which must print no drift twice.
    - `npx tsx scripts/measureDistrictCutoff.ts` into SCR/jvz-district-t3.txt.
    - Expected, from Planner measurements: champ n = 68, MAE 18.19 against 40.38, 48 of 69 (69.6%). District: season start n = 47, 203 scored positions, All positions sim MAE 1.2 against midpoint 1.8, gate line "1.15 < 1.77 (n = 203)", range holds 181 (89.2%).
    - Use the measured figures throughout. Compute "N positions above" as the coverage count minus the largest k with k/n at most 0.88 (178 for n = 203).
    - If the champ figures differ from 18.2, 40.4, 68 and 48 of 69, or if district gate 1 FAILs, STOP and report before editing copy.

    STEP 2, THE COPY. Rendered strings carry no hyphen, en dash or em dash; keep the existing flat voice.
    - districtLedgerContent.ts line 206, the District cutoff sentence: "45 district seasons" becomes "47 district seasons", "over 193 positions" becomes "over 203 positions", and "171 of those 193 positions, 89%" becomes "181 of those 203 positions, 89%". The 1.2 and 1.8 stay. Nothing else in the sentence changes.
    - Line 210, the Champ cutoff sentence: unchanged. The re-run reproduces it.
    - Header source 8 (70-80): add that on 2026-10-07, after quick task 261007-jvz's finality cascade, the run reproduced 18.2, 40.4 and 48 of 69 over 68 seasons exactly, with 2022isr the one season skipped (todo champ-cutoff-2022isr-week-tie). Between c4bc0b62 (261005-5g0) and 261007-jvz it read 18.5, 39.0 and 42 of 69 over 62 seasons, because six curtailed events never read qualification final.
    - Header source 9 (82-94): run 2026-10-07 after quick task 261007-jvz; 203 positions of 47 district seasons, 2023 to 2026; 1.15 points against 1.77; 181 of 203 positions, 89.2%, three positions above the pre-registered 72% to 88% band.
    - districtLedgerContent.test.ts (150-169). Champ comment: re-run 2026-10-07 (261007-jvz), MAE 18.19 against 40.38, n = 68 with 2022isr skipped, gate line 5 48 of 69 (69.6%); the four champ strings stay. District comment: run 2026-10-07 (261007-jvz), midpoint MAE 1.77, n = 203 over 47 seasons, gate line 2 181 of 203 (89.2%). The district strings become "47 district seasons", "1.2 points on average over 203 positions" and "181 of those 203 positions, 89%". "1.8 for the midpoint rule" stays.
    - scripts/measureDistrictCutoff.ts header (36-41): "Measured 2026-10-07 (after quick task 261007-jvz's finality cascade): 203 scored positions over 47 district seasons, simulated MAE 1.15 against the midpoint rule's 1.77, the range holding the settled cutoff at 181 of 203 (89.2%), three positions above the band's ceiling". Keep "both bars are kept as registered".
    - predictedCutoff.ts comment (147-166). Champ: add that the 2026-10-07 re-run after quick task 261007-jvz reproduced 18.2 against 40.4 and 48 of 69, 69.6%. District: run 2026-10-07 after 261007-jvz, 181 of 203 positions over 47 district seasons, 89.2%, THREE positions above the band, MAE 1.15 against 1.77.
    - Run `npx vitest run apps/web/src/components/methodology` from the repo root. The file's own no dash and voice checks must pass.

    STEP 3, THE TODOS. Run `git mv` on each todo FIRST, and only then append its closing note with Edit (an Edit before git mv can drop the edit). Then `git add` the new path.
    Each note is a "## Closed" section: "Closed 2026-10-07 by quick task 261007-jvz, commit <hash>", two to four plain lines, then exactly this line on its own: Release: pending republish by the orchestrator (2026-10-07)
    - champ-cutoff-backtest-season-skips: commit 1's hash and this commit's.
      - Cause: c4bc0b62 (261005-5g0) made a category open at now never final at an earlier stop. Under the old rule six curtailed events (2019vahay, 2022va319, 2022gadal, 2023nhgrs, 2024mdsev and 2024gagwi) never read qualification final at now.
      - The cascade restores n = 68, 18.2 against 40.4, 48 of 69: the published figures exactly. The tuning file is again the 2026-10-05 one apart from its date.
      - 2022isr is the one remaining skip, with a different cause (new todo).
    - locks-tab-award-at-uncounted-event: commit 2's hash. The tab resolves an award's tier from one artifact derived map shared with the publisher (eventTierByKey) and reads its finality from the map the reservation reads. Against the publisher's verdicts tenet A went 4 to 0, and the publisher and the tab's final standing now agree on every team (37 to 0). The default yardstick is still 0 and 0.
    - New pending todo champ-cutoff-2022isr-week-tie. Frontmatter: id, created 2026-10-07, source quick 261007-jvz, priority low.
      - Evidence: 2022isde4 (start 2022-03-22) and 2022iscmp (start 2022-03-27) both carry TBA week 3. With no event artifacts the rail breaks the week tie by event key, so 2022iscmp's four stage steps sort ahead of 2022isde4's. The end of district season position is 2022isde3:awards, so the backtest refuses the season. The same order applies to the tab's rail whenever no event artifact is loaded.
      - What a fix needs: a rail rule that, within one week, sorts a district tier event's steps ahead of a dcmp tier event's. It moves the rail for every same week championship, so both tenet sweeps and both backtests must be rerun. It would make the published 68 read 69.
    - COMMIT 3: stage this task's nine paths (the two removed, the two added, the new todo and the four copy and comment files). Run `git status --short` afterwards; it must show no leftover change in any of them. Message: `fix(261007-jvz): methodology district cutoff reads 203 positions of 47 seasons; close two todos; record the 2022isr week tie`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/methodology/districtLedgerContent.test.ts apps/web/src/components/districts/predictedCutoff.test.ts (from the repo root; quote the counts)</automated>
    <automated>git show --stat HEAD lists the two renames and the new todo; grep -c "Release: pending republish by the orchestrator (2026-10-07)" prints 1 for each completed file at HEAD</automated>
  </verify>
  <done>The page reads 47 seasons, 203 positions and 181 of 203 for the District cutoff, and the Champ cutoff sentence is verified reproduced. Both todos are in completed/ with the release line, and the 2022isr finding is pending. Commit 3 holds exactly its nine paths.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| local credentials to transcript | `.env` holds the TBA and R2 credentials. No step of this plan needs them. |
| offline tools to R2 | `publishDistricts.ts` uploads unless `--dry-run` is set. |
| state facts to guarantee | A category read final takes its points out of the remaining pool and its ceiling out of every rival's reach, so a wrong final reading publishes a Locked that is not true. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jvz-01 | Information disclosure | .env | high | mitigate | Never Read, cat or echo `.env`. Run every tool straight through tsx with no `--env-file`, and run no `pnpm publish:*` script. |
| T-jvz-02 | Tampering | R2 district objects | high | mitigate | Rebuild only with `--dry-run --no-bake --local-out` into SCR, never into `data/local-publish/`. |
| T-jvz-03 | Tampering | districtEventCategoryFinality (guarantee integrity) | high | mitigate | The cascade reads only facts that physically follow the earlier stage. The Worker requests awards only after `playoffsDone`. Both tenet sweeps, both tiers and both yardsticks must read 0 (Tasks 1 and 2 stop otherwise). The publisher rebuild must move 0 objects. |
| T-jvz-04 | Tampering | publisher awardsPosted from a partial mid event award list | medium | accept | Pre-existing for the award category: any award row reads posted, and the Worker never asks again. The cascade widens it to the earlier categories. The Worker itself never reads awards before `playoffsDone`, and full publishes are not run during live events (operating rule). Named to the orchestrator. |
| T-jvz-05 | Tampering | Locks tab award consumption | medium | mitigate | An award consumes only at an event some row resolves to the district tier and whose award is final at the position, read from the same map the reservation reads, so one slot is never both reserved and consumed. A tested case pins it. |
| T-jvz-06 | Repudiation | concurrent session commits | medium | mitigate | Stage by explicit path, run `git status --short` before each commit, and report any foreign file. |
</threat_model>

<verification>
After commit 3, from the repo root, read every result from the OUTPUT:
- `npx vitest run`: quote the Test Files and Tests lines. 261007-il9's baseline was 344 files and 7922 passed with 1 skip; expect more tests and zero failures. Name every test file the triage rule edited.
- `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.e2e.json` and `npx tsc --noEmit -p apps/worker/tsconfig.json` must all print nothing. Triage any Worker error; never dismiss one.
- `npx tsx scripts/measureChampCutoff.ts --check-history` prints no drift for both files.
- `npx tsx scripts/measureDistrictCutoff.ts` prints 203 scored positions and 181 of 203 (or the figures Task 3 published).
- `npx tsx scripts/measureLedgerTenets.ts` and `npx tsx scripts/measureChampTenets.ts` report zero violations. The districtVerdictCompare run reads 0 and 0 against publishedFinalVerdicts.
- `git log --oneline -5` shows commits 1 to 3 on top of the starting HEAD. Note any foreign commit interleaved by the other session.
</verification>

<success_criteria>
- Every item in the coverage audit below is delivered by its task.
- Nothing was published, deployed or pushed. The orchestrator's `pnpm rebaseline` carries the cascade to the Worker (shared verdict pass) and republishes the district artifacts. Those artifacts are byte identical apart from their stamps, per the Task 1 diff, so the republish only re-confirms them.
- The return message to the orchestrator lists:
  - the three commit hashes;
  - the vitest counts and the four typecheck results;
  - the artifact diff line;
  - the tenet census per task on both tiers and both yardsticks;
  - the champ and district backtest figures with the setting diff (empty);
  - every test file the triage rule touched, with its class;
  - the read only conclusions for the Worker, the poll gate, champLedgerStatus and districtFieldOverlay.
</success_criteria>

## Multi-Source Coverage Audit

| Source | Item | Covered by |
|--------|------|-----------|
| GOAL | Curtailed events read final; the tab counts a consuming award at any district event like the publisher | Tasks 1 and 2 |
| REQUIRED FIX part 1 | Cascade rule, documented with 2023nhgrs and 2022gacar | Task 1 steps 1 and 2 |
| REQUIRED FIX part 1 | 2020 cancelled events: isNeverHappening and reservedImpactSlots behaviour, stated and tested | Task 1 step 1 (carve out cases), Planner measurements |
| REQUIRED FIX part 1 | No published verdict moves for any non curtailed event; offline before/after diff tied to cascade events | Task 1 step 4 (expected 0 moved) |
| REQUIRED FIX part 1 | Worker read and unchanged; poll gate stops for a curtailed event; pointPool and champReservedSlots tests run | Task 1 step 3 |
| REQUIRED FIX part 1 | measureChampCutoff scores the seasons; sentence, header, pins; --write-history, --write-tuning, --check-history; selected settings named | Task 1 step 6 (run and tuning), Task 3 steps 1 and 2 (sentence verified reproduced, header and pin comments) |
| REQUIRED FIX part 1 | 2022isr cause found | Planner measurements; Task 3 new todo |
| REQUIRED FIX part 2 | District wide tier map from every team's rows; award finality at the position district wide; no row stays uncounted | Task 2 steps 2 and 3 |
| REQUIRED FIX part 2 | champLedgerStatus checked for the same guard | Task 2 step 3 (read only; none present) |
| REQUIRED FIX part 2 | Tests: the 2019fma shape and the reopened award | Task 2 step 1 |
| REQUIRED FIX part 2 | measureLedgerTenets both yardsticks; residual reported | Task 2 step 4 |
| REQUIRED FIX part 3 | Both todos closed with git mv, note, release line | Task 3 step 3 |
| CONSTRAINT | Three tasks, one commit each, explicit staging, verification by output, four typechecks, both cutoff scripts, both tenet sweeps | Every task and the verification section |
| PLANNER ADDITION | The Locks picker's Alliances done and Finals stops read the same cascade, so a done 2020 event shows no half state | Task 1 step 3 (flagged to the orchestrator) |
| PLANNER ADDITION | District cutoff figures move (203 / 181 / 47 seasons) and are published | Task 3 step 2 |

<output>
Do not write SUMMARY.md (the orchestrator does). Return the full summary text in the final message instead. The target file is `.planning/quick/261007-jvz-district-event-finality-cascades-from-la/261007-jvz-SUMMARY.md`.
</output>
