---
phase: quick-261014-jfx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/districtLedgerRows.test.ts
  - apps/web/src/components/districts/districtLedgerOutcomes.ts
  - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
  - apps/web/src/components/districts/ledgerVerdict.ts
  - apps/web/src/components/districts/ledgerVerdict.test.ts
  - apps/web/src/components/districts/LedgerParts.tsx
  - apps/web/src/components/districts/LedgerParts.test.tsx
  - apps/web/src/components/districts/DistrictLedger.test.tsx
  - apps/web/src/components/districts/ChampLocksLedger.test.tsx
  - apps/web/src/components/districts/champLedgerRows.test.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - apps/web/src/components/methodology/districtLedgerContent.test.ts
autonomous: true
requirements: [261014-jfx]

estimate:
  tokens: 100000
  raw_tokens: 200000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "An open Playoffs cell whose run reported its alliance routes reads bold `~not picked` over small `<n>% picked` when the runs leave the team off every alliance more often than they produce any one finish (1st, 2nd, 3rd or 4th, 5th to 8th). The small line carries no `pays` and no `at least`. n goes through `districtLedgerCellChance`, so it never reads 100% and reads `0%` where no run picked the team."
    - "n is 100 minus the not picked run count the drawer headline prints (both from one helper), so the cell's picked percent and the headline's not picked count always add to 100."
    - "5th to 8th's share is the zero point mass minus the not picked share. Every open cell the committed simulation can produce makes this exact, because a routed draw pays playoff points only to alliance members. A test proves it draw by draw through the simulation's observer."
    - "A tie goes to the better finish, so any finish on an alliance beats not picked. A bracket milestone or a secured figure above zero rules not picked out (the team is proven to be on an alliance), and the cell never names it there."
    - "The Playoffs drawer's headline and most likely tile follow the cell: `Not picked in 97 of 100 runs.` and `Not picked`. The row model gains a Not picked row, and Out before the top four then means picked but out. Both are zero point rows the drawer list already hides (261007-3ik), so the shown list stays the paying rows and the row chances still sum to 1."
    - "Where no route view exists (an event that has not started and is priced from a baked sidecar, the Champ Locks simulated DCMP, a finals shifted DCMP cell, the Champ Locks District points row), every Playoffs cell prints exactly what it prints today."
    - "The post selection not picked cell (`not picked` over `backup call only`) prints exactly as before. Its drawer headline now reads `Not picked in 100 of 100 runs.`"
    - "The legend reads `~ = this site's prediction`. The methodology names not picked as a best guess finish with its chance of being picked, and states that at an event that has not started 5th to 8th also counts the runs that left the team off every alliance. It has zero hyphen, en dash or em dash characters and at most three sentences per paragraph."
    - "Display only: no distribution, total, status, cutoff or lock computation changes. `packages/core/districts/ledgerSimulation.ts` and its test are not edited."
  artifacts:
    - path: apps/web/src/components/districts/districtLedgerRows.ts
      provides: "one route view helper used by both the Alliance selection branch and the Playoffs branch; open Playoffs cells with routes carry `selection`"
      contains: "selection"
    - path: apps/web/src/components/districts/districtLedgerOutcomes.ts
      provides: "`notPicked` outcome row and finish; `districtPlayoffOutcomes(..., selection?)` split of the zero point mass; `districtOutcomeUnaccountedMass` counting a shared point value once"
      contains: "notPicked"
    - path: apps/web/src/components/districts/districtLedgerCopy.ts
      provides: "not picked finish words and labels, the picked word, the shared run count helper, the not picked lines, the legend wording"
      contains: "this site's prediction"
    - path: apps/web/src/components/districts/ledgerVerdict.ts
      provides: "Playoffs drawer rows read the cell's route view; both zero point rows hidden from the shown list"
    - path: apps/web/src/components/methodology/districtLedgerContent.ts
      provides: "methodology sentences for the not picked best guess and the unstarted event limit"
  key_links:
    - from: apps/web/src/components/districts/districtLedgerRows.ts
      to: "DistrictEventDistributions.selectionRoutesByTeam (the run's own route counts)"
      via: "one helper builds the DistrictSelectionRouteView for the Alliance selection cell and for the Playoffs cell, each with its own cell's denominator"
    - from: apps/web/src/components/districts/districtLedgerOutcomes.ts
      to: "districtPlayoffOutcomes (same module)"
      via: "districtPlayoffBestGuess passes cell.selection, so the cell, the drawer rows and the headline read one array"
    - from: apps/web/src/components/districts/ledgerVerdict.ts
      to: apps/web/src/components/districts/districtLedgerOutcomes.ts
      via: "verdictOutcomeRows passes cell.selection into districtPlayoffOutcomes"
    - from: apps/web/src/components/districts/champLedgerRows.ts
      to: apps/web/src/components/districts/districtLedgerRows.ts
      via: "case 2 DCMP row reIds the championship pass's Playoffs cell by spread, carrying `selection` unchanged (no edit needed, pinned by a test)"
---

<objective>
Make the Locks Playoffs box stop predicting a placing for a team that most likely lands on no alliance. Today 6932 at UNC Asheville (2026, a quals stage stop) reads `~5th to 8th` over `99% · pays 0`, and its drawer reads "Out before the top four in 100 of 100 runs". Its Alliance selection cell, though, reads `2% captain`. The Playoffs distribution's zero point mass mixes two outcomes: on an alliance that finishes 5th to 8th, and on no alliance at all. NOT PICKED becomes a fifth best guess finish, on both the District Locks tab and the Champ Locks DCMP row. Jacob's decisions 1 to 6 in the planning context are locked and implemented exactly.

Purpose: the Playoffs box answers one question honestly for every team, including the third of a large event's field that no alliance takes.
Output: the route view on the Playoffs cell, a split zero point mass, a fifth finish in the best guess, cell and drawer copy, legend and methodology wording, and every pinned test moved.

Planner choices (state these in the SUMMARY):
1. DATA SOURCE, ONE OBJECT. The run already counts, per team, the draws that left it on no alliance (`DistrictSelectionRoutes.notSelectedDraws`, reported through `DistrictEventDistributions.selectionRoutesByTeam`). The row builder already turns that into a `DistrictSelectionRouteView` for the Alliance selection cell. One helper now builds that view, and the Playoffs branch hangs it on the open Playoffs cell under the SAME `selection` field, with the Playoffs cell's own denominator. Both denominators are `result.draws` (`distributionsFromResult`). Every current reader of `selection` already checks `cell.cell === "alliance"` first (`districtCellPay`, `openCellLines`, `verdictOutcomeRows`), so nothing else changes meaning. It is attached under the same guard as the Alliance selection cell (routes present and `rankingFixed` defined), on every open Playoffs cell, including a `notPicked` flagged one.
2. THE 5TH TO 8TH SHARE IS EXACT, NOT APPROXIMATE, for every open Playoffs cell the committed simulation can produce. In `simulateDistrictEvent` step 3, `elim` starts at 0 for every team and only alliance members (`allianceMemberIndices`) are paid. The one path that pays a non member is `knownElimPoints`, which is supplied only once TBA's playoff points are in (`buildDistrictEventSimulationInput`, `points.elim`), and the Playoffs cell is grey then. So the not selected draws are a subset of the zero point draws, and 5th to 8th = zero point share minus not selected share exactly. Task 1 proves this draw by draw with the simulation's own observer seam, with no simulation edit. DEFENSIVE CLAMP: the not picked chance is min(not selected share, zero point share), and 5th to 8th is the zero point share minus that. The rows then always sum to the distribution's mass. If a future simulation ever paid a not selected team while the cell is open (a modelled backup call), the clamp could only OVERSTATE not picked and understate 5th to 8th, by at most the paid backup share. Clean fix if that ever happens: the simulation reports a joint count of not selected and zero point draws. That is a follow up, not part of this plan (`ledgerSimulation.ts` carries another session's uncommitted edits).
3. DRAWER LIST SHAPE. `districtPlayoffOutcomes` takes the route view as an optional fifth argument. With a view it appends a `notPicked` row (points 0, the clamped not picked chance) and reduces the `none` row (Out before the top four) to picked but out. Both are zero point rows. The shown list already hides the implicit zero point row (Jacob, 261007-3ik), so it hides both, and the shown list stays the paying rows. The headline and the most likely tile name the best guess, as the cell does. `districtOutcomeUnaccountedMass` counts each distinct point value once, so two rows at 0 do not double count, and a test pins that the row chances sum to 1. A milestone rules not picked out with the rows it already removes.
4. THE PICKED PERCENT is printed as `districtLedgerCellChance((100 - runs) / 100)`, where runs is the not picked run count from one shared helper (`Math.round(100 * chance)`, the expression the drawer headline already uses). This is 1 minus the not selected share, rounded so the cell and the headline never add to 101 (0.975 would otherwise read `98 of 100` beside `3% picked`).
5. THE SECURED PREFIX cannot coexist with not picked. A secured figure above zero proves the team's alliance has won playoff matches, so the best guess skips the not picked finish there, exactly as a milestone rules finishes out. The small line still passes through `withSecured` for every form, so the code path is uniform and honest.
6. NO ROUTE VIEW, NO CHANGE (as instructed). A baked sidecar (an event that has not started, at Now or at a rewound stop) and the Champ Locks simulated DCMP (case 3) carry no routes. A `shiftedByFinals` cell and the District points row are plain folded cells that print the median form anyway. These keep today's behavior, and the methodology says so in one sentence. Found while planning, for Jacob, not built: under a simulated draft every drafted slot pays at least 1 selection point and no backup is drafted. So a baked event's Alliance selection pmf mass at 0 equals its not selected share, which could split those events too.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/261014-i1c-locks-playoffs-box-shows-a-best-guess-fi/261014-i1c-SUMMARY.md
@apps/web/src/components/districts/districtLedgerOutcomes.ts
@apps/web/src/components/districts/districtLedgerCopy.ts
@apps/web/src/components/districts/ledgerVerdict.ts

Interfaces the executor needs (verified against HEAD c4382a87):
- districtLedgerRows.ts: `DistrictSelectionRouteView` (~336) is `{ routes: DistrictSelectionRoutes, denominator, rankingFixed }`. The open cell's `selection?` field doc is at ~406. The Alliance selection branch builds the view at ~2113 to 2129, refusing where `routes === undefined || eventDistributions?.rankingFixed === undefined` and then adding the event to `eventsWithUnknownSelectionRoutes`. The Playoffs branch is at ~2130 to 2151, in this order: `eventRuns`, the `teamNotPickedAtPosition` flag, `playoffMilestoneFor`, `securedAtLeast`. `distributionsFromResult` (~1677) gives every category `denominator: result.draws`.
- packages/core/districts/ledgerSimulation.ts (READ ONLY): `DistrictSelectionRoutes { bySlot, notSelectedDraws }`. `simulateDistrictEvent(input, draws, seed, observer?)`. The observer receives `DistrictDrawObservation`: `alliances` holds team keys per alliance in pick slot order (filler alliances are empty), and `elim` is per team indexed by `input.baselines` order. Its arrays are reused buffers, so read them inside the callback.
- districtLedgerOutcomes.ts: `districtPlayoffOutcomes(season, tier, distribution, milestone)` returns rows `winner, finalist, third, fourth, none`. `PLAYOFF_BEST_GUESS_FINISHES` is walked better first, and a strictly greater sum replaces the leader. `districtPlayoffBestGuess(cell, pricing)` returns undefined for a non Playoffs cell, `notPicked`, `shiftedByFinals`, no pricing, an unregistered season, or off table mass. `assertRouteDenominator` and `InvalidRouteDenominatorError` are in this module. `districtOutcomeUnaccountedMass` sums `counts[round(row.points)]` per row.
- districtLedgerCopy.ts: `DISTRICT_LEDGER_NOT_PICKED_WORDS` (~123, KEEP), `DISTRICT_LEDGER_LEGEND_EXPLAINER` (~134), `DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS` (~479), `DISTRICT_LEDGER_PLAYOFF_FINISH_LABELS` (~493), `DISTRICT_LEDGER_PLAYOFF_BEST_GUESS_PREFIX = "~"` (~668), `DISTRICT_LEDGER_PLAYOFF_FINISH_WORDS` (~671), `districtLedgerPlayoffBestGuessLines` (~685), `districtLedgerCellChance` (~743: rounds, caps at 99, no floor, so a tiny value prints `0%`), `districtLedgerVerdictOutcomeHeadline` (~1135: `${label} in ${Math.round(100 * chance)} of 100 runs.`). Comments that define the tilde as predicted points only are at ~130 to 132, ~728 and ~867 to 868.
- ledgerVerdict.ts: `verdictOutcomeRows` (~152) calls `districtPlayoffOutcomes(season, tier, cell.distribution, cell.playoffMilestone)`. In `buildVerdictModel` (~241), `top` is the likeliest row (an earlier row wins a tie), `guess` comes from `districtPlayoffBestGuess`, and the headline and mostLikely tile use the guess where defined. `shownRows` filters `key !== "none"` for elim and award.
- LedgerParts.tsx `openCellLines` (~563): the not picked flag returns first, then a Playoffs cell prints `districtLedgerPlayoffBestGuessLines(guess)` with `withSecured(lines.small)`, else the median fallback. It needs NO logic change. Only its doc block and the comment at ~620 change.
- champLedgerRows.ts (NOT edited): case 2 `reId` spreads the pass cell, so `selection` rides through to the DCMP row. `withFinalsAdded` builds a plain folded cell, so a shifted cell has no view. Case 3 (baked) builds cells with `openDistrictLedgerCell` and no view. The District points row is folded.
- Test helpers already present: LedgerParts.test.tsx `openFrom`, `slot`, `allianceWith`, `lines`, `PRINTED`, `DISTRICT_2026`, `DCMP_2026`. districtLedgerOutcomes.test.ts `distributionOf`, `ELIM_CEILING`, `observation`/`viewOf` (inside the selection describe, so hoist if needed). districtLedgerRows.test.ts top level `state`, `remainingEvent`, `team`, `artifactOf`, the `builtWith`/`routesFor`/`slot` helpers (~2013 to 2068), and the started event fixture (~2236 to 2330: 24 team roster, `qualRow`, `eventArtifactWith`, `buildDistrictEventSimulationInput`). That roster is exactly 8 x 3, so it never leaves anyone unpicked.

Working rules for this run (project memory, mandatory):
- Worktrees are disabled. Work on main. Another session (quick task 261014-i8i) has uncommitted edits in `packages/core/districts/ledgerSimulation.ts`, its test, `package.json` and new untracked files. NEVER edit, stage or revert those. Before each task run `git status --short`. If a file this plan lists shows changes you did not make, stop and report. Re-read a file right before editing it and use scoped Edit calls. Before each commit run `git diff -- <each file>` and confirm every hunk is yours. Stage by explicit path only, never `git add -A` or `git add .`. Do not push.
- If a test failure traces into `ledgerSimulation.ts` (the other session's in-flight edits), stop and report. Do not edit it.
- Run vitest from the REPO ROOT as `npx vitest run <paths>`, never through `timeout` or a `pnpm` wrapper. Judge by the printed `Test Files` and `Tests` summary lines, not the exit code.
- Typecheck all three: `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`. The root one misses apps/web.
- New regex based source tests must normalise CRLF. Never Read `.env`. No browser: the orchestrator takes the local screenshot.
- Copy voice: lower case cell words, no tilde on a percentage, never 100%, middle dot ` · ` separator, zero hyphen, en dash or em dash characters in any new copy string or methodology sentence.
</context>

<!-- planner-discipline-allow: tilde marks predicted points -->
<!-- planner-discipline-allow: tilde is for predicted points -->
<!-- planner-discipline-allow: this site's predicted points -->

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer, from the run's not selected draws to a printed `~not picked` cell</name>
  <files>apps/web/src/components/districts/districtLedgerRows.ts, apps/web/src/components/districts/districtLedgerRows.test.ts, apps/web/src/components/districts/districtLedgerOutcomes.ts, apps/web/src/components/districts/districtLedgerOutcomes.test.ts, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts</files>
  <precondition>`git status --short` shows none of the six files above as modified before the first edit.</precondition>
  <behavior>
    - Rows (denominator 100, district 2026, view notSelected 97) over {0: 99, 7: 1}: ids winner, finalist, third, fourth, none, notPicked; none 0.02, notPicked 0.97, fourth 0.01; chances sum to 1; `districtOutcomeUnaccountedMass` is 0.
    - No view: the rows are exactly today's five, so every existing districtPlayoffOutcomes test passes unchanged.
    - Clamp: view notSelected 50 over {0: 40, 13: 60}: notPicked 0.40, none 0, sum 1.
    - A milestone of kind finalist or winner, with a view: no notPicked row, and no none row.
    - A view whose denominator is 0 or NaN throws `InvalidRouteDenominatorError`.
    - Unaccounted mass counts a shared point value once: split rows over {0: 50, 25: 50} still report 0.5.
    - Best guess, 6932 shape {0: 99, 7: 1} with notSelected 97: id notPicked, chance 0.97, pay values [0]. Printed lines: bold `~not picked`, small `3% picked`.
    - Plurality, as locked: {0: 70, 7: 8, 13: 7, 20: 8, 30: 7} with notSelected 40 gives notPicked 0.40 over 5th to 8th 0.30, printing `~not picked` over `60% picked`.
    - Tie goes to the finish on an alliance: {0: 80, 7: 10, 13: 10} with notSelected 40 gives fifthToEighth 0.40 (`~5th to 8th`, `40% · pays 0`).
    - 5th to 8th wins: {0: 70, 13: 30} with notSelected 20 gives fifthToEighth 0.50.
    - DCMP tier, same 6932 shape at 0/21: notPicked.
    - {0: 100} with notSelected 100 (selection still open, so not flagged): `~not picked` over `0% picked`.
    - No view over {0: 99, 7: 1}: `~5th to 8th`, `99% · pays 0`, exactly today.
    - securedAtLeast 13 with a contrived view never names notPicked. The notPicked flagged cell still returns undefined. shiftedByFinals and no pricing still return undefined.
    - Picked rounding: chance 0.975 prints `2% picked`, and the shared run count helper returns 98, so the two add to 100.
    - Rows layer: an open Playoffs cell carries `selection` with the run's own `notSelectedDraws` and `denominator` equal to its distribution's. It is absent where routes or `rankingFixed` are absent. A notPicked flagged cell carries it too and keeps `notPicked: true`. The Alliance selection cell is unchanged. No other category carries a view.
    - Simulation invariant (40 team roster, quals open): in every draw, a roster team on no alliance has `elim` 0. Every team's `notSelectedDraws` is at most its elim `counts[0]`.
    - End to end: the team with the most not selected draws prints `~not picked` over `<n>% picked` through `openCellLines` with district pricing. Every team that prints `~not picked` has a not picked share strictly above each of its four other grouped finishes.
  </behavior>
  <action>
ROWS (districtLedgerRows.ts), per planner choice 1. Extract one private helper that takes the event's `DistrictEventDistributions | undefined`, the team key and a denominator. It returns the `DistrictSelectionRouteView` or undefined, under exactly the shipped guard (routes present and `rankingFixed` defined). The Alliance selection branch calls it with its own distribution's denominator and keeps adding the event to `eventsWithUnknownSelectionRoutes` when it returns undefined. In the Playoffs branch, right after the `cell.kind !== "open"` early return, call the same helper with the Playoffs distribution's denominator. Spread the view onto the cell as `selection` where it is defined, then apply the existing `notPicked` flag, milestone and `securedAtLeast` spreads on top of that cell, so every open Playoffs cell with routes carries it, the flagged one included. Do not add the event to the gaps list from the Playoffs branch. Rewrite the `selection` field doc (~406): present on an Alliance selection cell AND on a Playoffs cell whose run reported its routes, the same view built by one helper. Readers must check `cell.cell` first. Extend the `DistrictSelectionRouteView` doc (~317) with one paragraph: the Playoffs cell reads the same object's `notSelectedDraws` to tell not picked from 5th to 8th (quick task 261014-jfx). Lock math, totals and summaries are untouched.

OUTCOMES (districtLedgerOutcomes.ts), per planner choices 2, 3 and 5. Add `notPicked` to `DistrictPlayoffOutcomeId` and to `DistrictPlayoffFinishId`. Give `districtPlayoffOutcomes` an optional fifth parameter `selection?: DistrictSelectionRouteView`. Where it is supplied: call `assertRouteDenominator`, take the zero point share from the `none` row, and set the not picked chance to min(max(0, notSelectedDraws / denominator), zero point share). Set the `none` row's chance to the zero point share minus that, and append a `notPicked` row at points 0, last. Add `notPicked` to both milestone ruled out sets. Rewrite the function's doc: the split, why it is exact (choice 2, naming `allianceMemberIndices` and `knownElimPoints`), the clamp and its only error direction, and that both zero point rows are implicit and the drawer list hides them. Change `districtOutcomeUnaccountedMass` to sum the mass at each DISTINCT rounded row point value once, and say so in its doc. Append the finish `notPicked` (rows: notPicked) LAST to `PLAYOFF_BEST_GUESS_FINISHES`, so the strictly greater walk gives every tie to a finish on an alliance. In `districtPlayoffBestGuess`, read the rows with `cell.selection` as the fifth argument. Keep the unaccounted mass guard on the view free rows. Skip the notPicked finish when `cell.securedAtLeast` is defined and above 0. The pay keeps its zero kept rule, so notPicked carries values [0], which the lines never print. Update its doc: five finishes, the tie rule, the secured rule out, and that without a view the zero point mass stays one finish (today's behavior, choice 6). Update the module header's first paragraph to mention the not picked row.

COPY (districtLedgerCopy.ts), per decisions 1 and 2. Add `notPicked: "Not picked"` to `DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS`. Add `notPicked` to `DISTRICT_LEDGER_PLAYOFF_FINISH_LABELS` (the outcome label) and to `DISTRICT_LEDGER_PLAYOFF_FINISH_WORDS` (the existing `DISTRICT_LEDGER_NOT_PICKED_WORDS.bold`, so the two can never drift). Add the constant `DISTRICT_LEDGER_PLAYOFF_PICKED_WORD` = `picked`, with a doc saying it means on ANY alliance, captain included, unlike the Alliance selection cell's `picked`. Add an exported one line helper `districtLedgerOutcomeRunCount(chance)` returning `Math.round(100 * chance)`, and make `districtLedgerVerdictOutcomeHeadline` use it with no output change. In `districtLedgerPlayoffBestGuessLines`, for id notPicked return bold prefix plus finish words (`~not picked`) and small `districtLedgerCellChance((100 - districtLedgerOutcomeRunCount(guess.chance)) / 100)`, a space, then the picked word. No pays line. Every other id prints exactly as before. Document choice 4 in the function doc. Leave `DISTRICT_LEDGER_NOT_PICKED_WORDS` itself and its doc untouched (decision 6).

TESTS FIRST (RED, then GREEN), covering every behavior bullet. In districtLedgerOutcomes.test.ts, add a describe for the split rows, the clamp, the milestone, the bad denominator and the shared value mass. Extend the `districtPlayoffBestGuess` describe with every best guess bullet, building cells with `openDistrictLedgerCell` plus a `selection` spread from a hoisted `viewOf`. In districtLedgerCopy.test.ts, move the finish words, finish labels and outcome labels `toEqual` pins to include notPicked. Add lines pins for 0.97 (`3% picked`), 0.975 (`2% picked`, run count 98) and 1 (`0% picked`), and assert the not picked small line has no `pays`, no tilde and no dash. Add the picked word to the dash test's list.

In districtLedgerRows.test.ts:
- Retitle "puts NO route view on any other category's cell" so it says only the Alliance selection and Playoffs cells carry one, and assert that.
- Add Playoffs cell view tests through `builtWith` with `options.elim` set: present with the right denominator and counts; absent with no routes; absent with no `rankingFixed`; present on the notPicked flagged cell.
- Add a new top level describe modelled on the started event fixture (~2236), with a 40 team roster: `qualRow` indices modulo the roster length, metric totals spread so the weakest teams are rarely drafted, 4 of 12 quals played, stage all open, about 200 draws, a fixed seed.
- In that describe, run `simulateDistrictEvent` with an observer. In each draw, collect every key in `alliances`, and for each `input.baselines` index whose key is in none, expect `elim[i]` to be 0. Count such draws and expect the count above 0, so the test cannot pass vacuously.
- Then build the rows from `distributionsFromResult`. Assert each roster team's open Playoffs cell's `selection.routes.notSelectedDraws` equals the result's and is at most its elim `counts[0]`.
- Import `openCellLines` from `./LedgerParts.js` and assert the end to end bullet with `{ season: 2026, tier: "district", isRookie: false }`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/districtLedgerOutcomes.test.ts apps/web/src/components/districts/districtLedgerRows.test.ts apps/web/src/components/districts/districtLedgerCopy.test.ts apps/web/src/components/districts/LedgerParts.test.tsx; npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>All four files pass, read from the Test Files and Tests summary lines, and the web typecheck is clean. The observer invariant ran over a positive number of not selected team draws. Committed by explicit path as `feat(quick-261014-jfx): the Locks Playoffs cell names not picked from the run's own alliance routes`. DistrictLedger.test.tsx and ChampLocksLedger.test.tsx may be red until Task 2 if their fixtures now print not picked. Note it in the SUMMARY, do not fix it here.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The Playoffs drawer reads the split rows, and the cell and tab tests read the fifth finish</name>
  <files>apps/web/src/components/districts/ledgerVerdict.ts, apps/web/src/components/districts/ledgerVerdict.test.ts, apps/web/src/components/districts/LedgerParts.tsx, apps/web/src/components/districts/LedgerParts.test.tsx, apps/web/src/components/districts/DistrictLedger.test.tsx, apps/web/src/components/districts/ChampLocksLedger.test.tsx</files>
  <precondition>Task 1 is committed, and `git status --short` shows none of the six files above as modified.</precondition>
  <behavior>
    - 6932 shape ({0: 99, 7: 1} of 100, view notSelected 97, district): headline `Not picked in 97 of 100 runs.`, mostLikely `Not picked`, chanceOfPoints `1%`. The shown list keys are exactly winner, finalist, third, fourth. The full rows from `verdictOutcomeRows` carry none 0.02 and notPicked 0.97 and sum to 1.
    - Denominator 1000, zero mass 990, notSelected 975: headline `Not picked in 98 of 100 runs.` and the drawer chip prints `2% picked`.
    - A notPicked flagged cell with its view: headline `Not picked in 100 of 100 runs.`, mostLikely `Not picked`, and the cell still prints `not picked` over `backup call only`.
    - Tie (picked finish against not picked): the drawer names the picked finish, as the cell does.
    - No view: every existing Playoffs drawer test passes unchanged (`Out before the top four in 69 of 100 runs.`).
    - Cell fixtures (LedgerParts): the 6932, plurality, tie, 5th to 8th, DCMP, all not selected and no view cases print the Task 1 lines. A secured cell with a contrived view never prints `~not picked`. The flagged cell prints `not picked` over `backup call only` with or without a view. Every not picked small line matches `^\d+% picked$`, and the PRINTED guards still hold.
    - Tab tests: the shared parse helper in each file accepts `~not picked` over `<n>% picked` (no secured prefix, no pays). The drawer headline test checks that 100 minus the headline count equals the printed picked percent. A secured alliance never reads 5th to 8th or not picked.
  </behavior>
  <action>
In ledgerVerdict.ts `verdictOutcomeRows`, pass `cell.selection` as the fifth argument to `districtPlayoffOutcomes` for a Playoffs cell. The label lookup already covers notPicked from Task 1. In `buildVerdictModel`, extend the `shownRows` filter so a Playoffs list drops both the `none` and the `notPicked` rows (both implicit zero point rows, per 261007-3ik). Update the comment above it to say so and to say the headline and tiles still read both. Update the best guess comment to name the not picked finish. `top`, `chanceOfPoints`, the histogram branch, and the Awards and Alliance selection paths are untouched. With no best guess (the flagged cell), the per row pick now lands on the notPicked row, which is the intended `Not picked in 100 of 100 runs.` (decision 3).

In LedgerParts.tsx, logic is unchanged and the docs are updated. In the `openCellLines` doc, THE ORDER says the Playoffs best guess now includes not picked (`~not picked` over the picked percent), and THE SECURED LINE's WHERE IT DOES NOT adds the not picked best guess (a secured figure rules it out, planner choice 5). Change the comment near line 620 so it no longer says the tilde stays on point figures only: a percentage never carries one, and the tilde marks this site's predictions.

Tests first. In ledgerVerdict.test.ts add a describe for every drawer bullet. Build cells with the file's own `openCell` and `sparse` helpers plus a `selection` spread, and use the `baseInput` helper with district or DCMP tier. In LedgerParts.test.tsx add a `playoffWith(mass, notSelectedDraws, ceiling)` fixture helper (an `openFrom` Playoffs cell plus a `selection` view over denominator 100), add the cell bullet fixtures, and route them through `lines` so the PRINTED guards cover them. Add one LedgerCell render test showing the bold span `~not picked` and the small span `3% picked` in the same two classes every open cell has.

In DistrictLedger.test.tsx and ChampLocksLedger.test.tsx, extend `parseBestGuess` and its finish label map:
- Accept the alternative `^~not picked(\d+)% picked$`, returning finish `not picked`, secured undefined and the chance. Check that it never reads 100%. Map `not picked` to `Not picked`.
- At every caller that asserts a secured alliance (near DistrictLedger.test.tsx 2424 to 2436, 2931 to 2971 and 3084, and ChampLocksLedger.test.tsx 1247 and 1311), also assert the finish is never not picked.
- In the drawer headline test near DistrictLedger.test.tsx 1687, compare 100 minus the headline count with the printed chance when the finish is not picked, and the count capped at 99 otherwise.
- In ChampLocksLedger.test.tsx near 549, let the DCMP small line be either the paying form (keep the DCMP value check) or `^\d+% picked$`.
- Leave the post selection test near DistrictLedger.test.tsx 2672 exactly as it is (decision 6).
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/ledgerVerdict.test.ts apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx apps/web/src/components/districts/LedgerParts.test.tsx apps/web/src/components/districts/DistrictLedger.test.tsx apps/web/src/components/districts/ChampLocksLedger.test.tsx</automated>
  </verify>
  <done>All five files pass, read from the summary lines. A Playoffs drawer over a cell with a view names Not picked where the cell does, its shown list holds only paying rows, and the post selection not picked cell prints as before. Committed by explicit path as `feat(quick-261014-jfx): the Playoffs drawer names not picked with the cell`.</done>
</task>

<task type="auto">
  <name>Task 3: Legend and methodology wording, the Champ DCMP carry through, and the full sweep</name>
  <files>apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts, apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/methodology/districtLedgerContent.test.ts, apps/web/src/components/districts/champLedgerRows.test.ts</files>
  <precondition>Tasks 1 and 2 are committed, and `git status --short` shows none of the five files above as modified by anyone else (re-read districtLedgerContent.ts first; another session may have edited other paragraphs, leave those alone).</precondition>
  <action>
LEGEND (decision 4). Set `DISTRICT_LEDGER_LEGEND_EXPLAINER` to exactly `likely = 8 of 10 runs land here · ~ = this site's prediction · % = share of 1,000 runs`. Rewrite its doc: the tilde marks this site's predictions, predicted points and a Playoffs best guess finish alike, and a percentage never carries one. Fix the other comments in this file that define the tilde as marking predicted points alone (near 728 and 867 to 868) to say this site's predictions. Pin the new legend string in districtLedgerCopy.test.ts (near line 160). DistrictLedger.test.tsx reads the constant and needs no change. Grep `apps/web/src`, `apps/web/e2e` and `apps/web/src/components/methodology` for any other sentence or test that defines the tilde as predicted points only, and fix each one. Expect none in the methodology content, which was checked while planning.

METHODOLOGY (decision 5). In districtLedgerContent.ts, section how-open-categories-are-predicted, replace these paragraphs exactly. Keep their positions and touch nothing else.
- The paragraph starting "The Playoffs cell names a best guess finish" becomes: "The Playoffs cell names a best guess finish: 1st, 2nd, 3rd or 4th, 5th to 8th, or not picked. Third and fourth are one finish, and fifth to eighth are another. The best guess is the finish that came up in the most runs, and a tie goes to the better finish."
- The paragraph starting "An alliance whose placement is already settled" becomes: "An alliance whose placement is already settled shows the points that placement pays. A team on no alliance once alliance selection is over reads not picked, and only a backup call can still earn it playoff points. Before then, a team most likely left off every alliance reads not picked too, with its chance of being picked on the line beneath."
- Directly after it, insert the new paragraph: "At an event that has not started, 5th to 8th also counts the runs that left the team off every alliance."

In districtLedgerContent.test.ts, update the 261014-i1c pin test (near line 399) to pin those three paragraphs exactly, find the new one by its opening words, and retitle the test for 261014-jfx. The voice tests (no hyphen, en dash or em dash, at most three sentences, no first person) must pass unweakened.

CHAMP DCMP CARRY THROUGH (no source change). In champLedgerRows.test.ts, beside the test near line 1646, add a test whose DCMP pass run reports routes with some not selected draws, at a quals open stage, and is not flagged. Assert the DCMP row's open Playoffs cell carries `selection` deep equal to the district pass row's own view for that team. Assert a `shiftedByFinals` DCMP cell (reuse the finals fixture near 1365 if it has an open division cell, else build one) carries no `selection`, and that the District points row's Playoffs cell carries none.

SWEEP. Run all three typechecks and the full districts and methodology test sets plus the methodology route test. Fix any failure rather than skipping it, and stay inside this plan's files; if a fix needs another file, stop and report. Confirm the e2e specs pin no Playoffs cell or legend text. Quote the Test Files and Tests counts in the SUMMARY.
  </action>
  <verify>
    <automated>bash -c 'cd /c/Users/Jacob/Documents/GitHub/SigmaScout && hits=$(grep -rnE "tilde marks predicted points|tilde is for predicted points|this site.s predicted points" apps/web/src apps/web/e2e --include=*.ts --include=*.tsx); if [ -n "$hits" ]; then echo "$hits"; echo STALE; else echo CLEAN; fi'; npx tsc --noEmit -p tsconfig.json; npx tsc --noEmit -p apps/web/tsconfig.json; npx tsc --noEmit -p apps/web/tsconfig.e2e.json; npx vitest run apps/web/src/components/districts apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx</automated>
  </verify>
  <done>The grep prints CLEAN. All three typechecks print no errors. Every districts and methodology test passes, with counts read from the summary lines and quoted in the SUMMARY. The legend and the three methodology paragraphs match the pinned text. `git status --short` shows no file of this plan left modified, and the other session's files are untouched. Committed by explicit path as `docs(quick-261014-jfx): the legend tilde means this site's prediction, and the methodology names not picked`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| simulation result to display | Route counts and distributions from the Web Worker run, or from a baked sidecar, become printed claims on a public page |
| shared checkout | Another session (261014-i8i) holds uncommitted edits in the same working tree |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jfx-01 | Repudiation (published honesty) | Playoffs cell, drawer and methodology | medium | mitigate | Not picked is named only where the run's own route counts exist. Baked events keep today's reading, and the methodology says so in one sentence. The observer test proves the split exact draw by draw. The clamp keeps the rows summing to 1 |
| T-jfx-02 | Denial of service | `districtPlayoffOutcomes` route denominator | low | mitigate | The view is built only from the cell's own positive `result.draws` denominator. `assertRouteDenominator` throws its typed error exactly as the Alliance selection path already does, and a test pins the throw |
| T-jfx-03 | Tampering | shared working tree | medium | mitigate | Stage by explicit path. Run `git diff -- <file>` before each commit. Never edit, stage or revert `ledgerSimulation.ts`, its test, `package.json` or the other session's untracked files |
</threat_model>

<verification>
- `npx vitest run apps/web/src/components/districts apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx` from the repo root passes, judged by its summary lines.
- Root, web and e2e typechecks are clean.
- The Task 3 grep prints CLEAN.
- `git log --oneline -3` shows the three task commits. `git status --short` shows only the other session's files.
- Hand check against decisions 1 to 6:
  - the `~not picked` over `<n>% picked` grammar, and the tie rule;
  - no `pays` and no `at least` on that line;
  - drawer headline, tile and list;
  - legend and methodology;
  - the post selection not picked cell unchanged;
  - no route view means no change, and the Champ DCMP row follows the district pass.
</verification>

<success_criteria>
- 6932 at a UNC Asheville quals stop (the orchestrator's screenshot) reads `~not picked` over a small `<n>% picked`, and its drawer reads `Not picked in <100 - n> of 100 runs.`
- Every open Playoffs cell with a route view names the finish with the most runs among five, with ties to a finish on an alliance. Cells without one print as today.
- The drawer never contradicts the cell. The shown list stays the paying rows, and the row model sums to 1.
- Nothing outside display changes. The simulation is not edited.
</success_criteria>

<output>
Return the SUMMARY text to the orchestrator in the final message (path `.planning/quick/261014-jfx-locks-playoffs-box-predicts-not-picked/261014-jfx-SUMMARY.md`). If the Write tool refuses that path, do not route around it through Bash or a heredoc. Return the text and let the orchestrator write it. The SUMMARY must state planner choices 1 to 6 from the objective, the commit hashes, the observer invariant's count of not selected team draws checked, and the test counts read from the summary lines.
</output>
