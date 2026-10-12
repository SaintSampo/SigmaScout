# Quick Task 261012-nff: A prequalified team that wins a championship award or the event no longer uses up a district slot - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning (plan against HEAD 9a6c9fae, pushed and live)

<domain>
## Task Boundary

Jacob, 2026-10-12, after a comparison of SigmaScout's Champ Locks against frclocks.com: "fix the prequalified slot".

### The defect

FIRST works out a district's FIRST Championship slots after the prequalified teams are removed ("Districts receive the percentage of available slots ... calculated by taking the total number of slots at FIRST Championship and subtracting the number of pre-qualified teams", firstinspires.org, Championship eligibility). So a prequalified team is never one of the district's `cmpSlots`, whatever it wins.

Today a prequalified team that ALSO holds a District Championship qualifying award (Impact, Engineering Inspiration, Rookie All Star, or Winner) takes one of the district's slots:

- `packages/harness/districtRankingsMerge.ts` (about line 1100): `champQualifiers = { awardQualified: awardQualified.dcmp, prequalified: prequalifiedTeams(season) }`. The two sets are not kept apart.
- `packages/core/districts/locks.ts` `pointsRaceSlots` (about line 463): `awardQualifiedRankedCount = teamKeys.filter((teamKey) => qualifiers.awardQualified.has(teamKey)).length`. Every award qualified key consumes, a prequalified one included.
- `packages/core/districts/advancementChance.ts` champ mode repeats the arithmetic by hand: `postedConsumed` (about line 557) and `drawnConsumed` (about line 660, through `rankedIsAwardQualified`).

`locks.ts` and `prequalified.ts` both already SAY the intent: prequalified is the NON-CONSUMING set. The overlap case is simply not handled.

### Measured, 2026-10-12, on `data/local-publish/districts` and `data/corpus.sqlite`

The published `champLock.status` reads `eliminated` for the team next in line in six championships since 2023. Six of the seven teams played at the FIRST Championship that season (`event_teams` and `matches`, event types 3 and 4):

| District | Prequalified team with a DCMP award | Next in line, reads eliminated | Played at the Championship |
| --- | --- | --- | --- |
| 2026fch | frc1629 (Engineering Inspiration) | frc614, 185 points | yes (2026gal) |
| 2025chs | frc1629 (Engineering Inspiration) | frc3748, 178 | yes (2025mil) |
| 2025isr | frc1690 (Winner), frc5614 (Impact) | frc1942, 201 and frc5987, 188 | yes, both |
| 2024fma | frc1676 (Impact) | frc1218, 154 | yes (2024hop) |
| 2023isr | frc2096 (Impact) | frc5654, 201 | yes (2023joh) |
| 2023chs | frc1629 (Engineering Inspiration) | frc6802, 173 | no |

frclocks.com's live 2026 Chesapeake page shows frc614 at 100% (13 teams in on points, where SigmaScout counts 12).

Scope: `packages/core/districts/locks.ts`, `packages/core/districts/advancementChance.ts`, their tests, any test or sweep pin the change moves, the generated champ cutoff files if the history check drifts. No artifact schema change. No algorithm version change (no rating algorithm is touched; the district files republish in place, as the 2026-10-06 rewind release did).

</domain>

<decisions>
## Implementation Decisions

### D1. The rule, in ONE place
- A team in `qualifiers.prequalified` never uses a district slot. `pointsRaceSlots` counts a key as consuming only when it is in `awardQualified` AND NOT in `prequalified`. Status labels do not change (`computeLocksWithQualifiers` already answers `prequalified` first).
- `advancementChance.ts` champ mode follows the same rule for BOTH counts: a posted award qualifier that is prequalified consumes nothing, and a DRAWN winner or drawn award winner that is prequalified consumes nothing. Do not keep a second hand written copy of the rule: export one small predicate or count from `locks.ts` and have both places read it. The RNG consumption order must not change (it is part of that module's contract); only the slot count moves.
- Fix the headers that state the rule (`locks.ts` reserved slots block and `pointsRaceSlots` doc, `QualifierSets` doc which says the sets are "expected to be disjoint in practice", `advancementChance.ts` lines about "every RANKED award qualifier consumes a slot", `prequalified.ts` if it needs a line). Match the surrounding comment voice. State the source (FIRST's eligibility page wording above) and the measured cases.

### D2. Files that are HELD by another live session: do not touch
- Quick task 261012-mw2 is being worked in the main checkout right now and holds: `apps/web/src/components/districts/champLedgerStatus.ts`, `champLedgerRows.ts`, `districtLedgerRows.ts`, `districtLedgerStatus.ts`, `LedgerParts.tsx`, `districtLedgerCopy.ts`, `ledgerVerdict.ts`, `packages/core/districts/champJointLock.ts`, `bracket.ts`, `finalsBracket.ts`, and the monotone and staged walk tests.
- This task must NOT edit any of those source files. `champLedgerStatus.ts` already calls `pointsRaceSlots` with both sets, so the tab picks the rule up with no edit.
- The joint proof keeps counting a prequalified team as a rival that can take a slot by winning or by a consuming award (`slotOnlyRivals`, 261009-2tr reading 3). Under the corrected rule that is an over count, which only delays a lock and never makes one false. Leave it. Say so in the `locks.ts` header and in the SUMMARY as a stated limit (sharpening it belongs to a later task, after 261012-mw2 lands).
- If a held file turns out to NEED a code change for the tests or gates to pass, STOP and report it. A held TEST file whose pin moves is the one exception: report the moved pin, change only that pin, and list it in the SUMMARY so the merge can re pin it.

### D3. Unit tests (CI runs these; the local data tests skip there)
- `locks.test.ts`: a prequalified team that is also award qualified takes no slot (`pointsRaceSlots` and `computeLocksWithQualifiers`: the next team on points reads `locked` at an all final position, the cut line is one team lower, the prequalified team still reads `prequalified`); two such teams free two slots; the existing property tests hold with overlapping sets; a pending reservation is unchanged.
- `advancementChance.test.ts`: posted and drawn cases as in D1; an input with no overlap gives byte equal results to today (the existing golden values must not move).
- A test at the publisher's verdict pass (`districtRankingsMerge.test.ts` or `publishDistricts.test.ts`, whichever already builds a district with awards): a prequalified DCMP award winner leaves `cmpSlots` whole for the others.

### D4. Regenerate the local district files and prove what moved
- In this worktree, rebuild every district file with the new code and no network: `npx tsx scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --no-bake --local-out data/local-publish/districts` (check the flags against the script first; a dry run uploads nothing and reads nothing from R2). `data/local-publish/districts-before` holds the files built by the old code.
- Diff EVERY team's `champLock` (status, pointsToLock, threatCount, cutLinePoints) and each district's `insights` champ numbers, before against after, over all 119 files. Expected: a district moves only if a prequalified team holds a qualifying award at its championship; the seven teams of the table read `locked`; no team anywhere goes from `locked` or `lockedAward` to anything else; `districtLock` moves nowhere. Report the full list of moved districts and teams (2016 to 2022 included). Anything outside that expectation: STOP and report.
- If the new files differ from the old in any way OTHER than champ verdicts and champ insights (for instance because the old files were built by a full publish with the bake), say what differs and why before going on.

### D5. Gates (history may only gain; nothing is fitted)
- The four sweeps with zero violations and the same SKIPPED list as before: `scripts/measureChampTenets.ts`, `measureChampJointLocks.ts`, `measureLedgerTenets.ts`, `measureLedgerSettledTenets.ts`. The orchestrator ran them on the old code first; the before logs are in the scratchpad path named in the specifics. Report every total that moved.
- `npx tsx scripts/measureChampCutoff.ts --check-history`: on drift, regenerate with the script's own write flags, commit the generated files, and report the before and after figures. Never hand edit a generated file.
- Pins in tests are replaced with executed values only, each one reported.
- Full `npx vitest run` from the worktree root, and the four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo.
- The orchestrator, not the executor, runs the long local data tests (`REQUIRE_LOCAL_DATA=1` on `scripts/champJointMonotone.test.ts`, `champFieldStagedWalk.test.ts`, `districtLocksStagedReplay.test.ts`). The executor must NOT start them.
- The Worker bundles `locks.ts` through `districtRankingsMerge.ts`, so the Worker bundle DOES change. That is expected here. The executor does not deploy.

### D6. Release is not part of this task
- No push, no R2 upload, no `wrangler deploy`, no `pnpm rebaseline`. The branch is handed off. What is owed after the merge: a Worker deploy, a district republish, and the web push.

### Claude's Discretion
- The name and shape of the shared predicate or count in `locks.ts`.
- Whether the publisher level test sits in `districtRankingsMerge.test.ts` or `publishDistricts.test.ts`.
- No new todo items: readings and limits go in headers and the SUMMARY.

</decisions>

<specifics>
## Specific Ideas

- THIS TASK RUNS IN A SIBLING WORKTREE, not the main checkout: `C:/Users/Jacob/Documents/GitHub/SigmaScout-nff`, branch `quick/261012-nff`. Every Bash command starts with `cd /c/Users/Jacob/Documents/GitHub/SigmaScout-nff &&`. Every Read, Edit and Write path contains `SigmaScout-nff`. Nothing under `C:/Users/Jacob/Documents/GitHub/SigmaScout/` (no suffix) is written, staged or committed.
- The worktree has its own `node_modules` (installed with `--ignore-scripts`; better-sqlite3 loads from its bundled prebuild), its own `data/corpus.sqlite` (a VACUUM INTO copy made 2026-10-12), `data/local-publish/districts` and `data/local-publish/districts-before` (both copies of the main checkout's files, built by the old code), and a copied `apps/web/src/routeTree.gen.ts`. There is no `.env` in the worktree and none is needed.
- Before logs of the four sweeps and the history check on the old code: `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/b60ff6ac-5992-4086-99fd-afcc4f623f4e/scratchpad/nff/before/`.
- Tests: `npx vitest run <paths>` from the worktree root (never `timeout <n> pnpm`, never `pnpm <script>`: pnpm's pre flight install can break a worktree). Run every `npx` from the worktree root and download nothing. Long content goes through the Write tool, never a Bash heredoc.
- Commit by pathspec (`git add <paths> && git commit -m "..." -- <paths>`), and read `git diff --cached --name-only` before each commit.
- The executor returns the SUMMARY text in its final message. The orchestrator writes the SUMMARY file.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/locks.ts` (`pointsRaceSlots`, `qualifierPool`, `computeLocksWithQualifiers`, `cutLinePointsWithQualifiers`), `locks.test.ts`
- `packages/core/districts/advancementChance.ts` (champ mode, about lines 531 to 700), `advancementChance.test.ts`
- `packages/core/districts/prequalified.ts`
- `packages/harness/districtRankingsMerge.ts` (`recomputeDistrictVerdicts`, about lines 1040 to 1110), `scripts/publishDistricts.ts`
- Readers of `pointsRaceSlots` that must simply follow: `apps/web/src/components/districts/champLedgerStatus.ts` (line 1076, HELD, read only), `predictedCutoff.ts`, `scripts/measureChampCutoff.ts`
- `scripts/measureChampTenets.ts`, `measureChampJointLocks.ts`, `measureLedgerTenets.ts`, `measureLedgerSettledTenets.ts`, `measureChampCutoff.ts`
- FIRST Championship eligibility: https://www.firstinspires.org/resources/library/frc/championship-eligibility
</canonical_refs>
