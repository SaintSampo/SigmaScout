---
quick_id: 260927-wnh
date: 2026-09-27
description: >-
  Alliances tab Combined Total tier from the season cut points: classify the
  combined total divided by 3 against the event artifact's tierCuts Total entry
  through tierFromCuts, replacing the interpolation over the event teams'
  published percentiles, which thinned during live folds and clamped at the
  event's own value range.
status: planned
phase: quick-260927-wnh
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [quick-260927-wnh]
files_modified:
  - apps/web/src/lib/allianceTierApproximation.ts
  - apps/web/src/lib/allianceTierApproximation.test.ts
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/AlliancesTab.test.tsx
  - packages/harness/tierCuts.ts
  - .planning/todos/completed/live-merges-drop-percentiles.md

estimate:
  tokens: 40000
  raw_tokens: 80000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "During a live fold, an alliance whose three picks carry values but no published percentile still renders a tiered Combined Total, as long as the event artifact carries tierCuts with a Total entry"
    - "The Combined Total tier is exactly tierFromCuts(tierCuts Total entry, combined / 3): the season pool tier of the per team equivalent, exact at a cut boundary, and honouring the entry's lower marker"
    - "A strong alliance can tier above every team on the event's standings roster; nothing clamps the estimate to the event's own value range"
    - "An event artifact with no tierCuts, or with tierCuts but no Total entry, renders the Combined Total untiered with no disclosure group, even when every team publishes a percentile (no fallback to the old interpolation)"
    - "Wherever a Combined Total tier box is drawn, the approximate disclosure is exposed, and its text says the comparison is to the season's single team totals"
    - "Pick cells, the neutral Sigma band and the combined value itself render exactly as before"
    - "The closed todo's 2026-09-27 block records the Alliances tier as fixed by 260927-wnh, not accepted and out of scope"
  artifacts:
    - path: apps/web/src/lib/allianceTierApproximation.ts
      provides: "estimateCombinedTier(combinedValue, tierCuts) -> Tier | undefined via tierFromCuts at combinedValue / 3"
      contains: "tierFromCuts"
    - path: apps/web/src/components/event/AlliancesTab.tsx
      provides: "buildAllianceRows passes artifact.tierCuts; CombinedCell takes a resolved Tier; season wording in the disclosure"
      contains: "comparing that to the season's single-team totals"
    - path: apps/web/src/lib/allianceTierApproximation.test.ts
      provides: "cut rule cases: boundary exactness, rounding onto a cut, lower marker, absent cuts, absent Total entry, the divide by 3"
    - path: apps/web/src/components/event/AlliancesTab.test.tsx
      provides: "live folded roster, no clamp, no cuts, no Total entry, published percentiles without cuts, disclosure copy cases"
    - path: .planning/todos/completed/live-merges-drop-percentiles.md
      provides: "CLOSED block names 260927-wnh as the Alliances fix"
      contains: "fixed by 260927-wnh"
  key_links:
    - from: apps/web/src/components/event/AlliancesTab.tsx
      to: apps/web/src/lib/allianceTierApproximation.ts
      via: "estimateCombinedTier(combined.value, artifact.tierCuts) inside buildAllianceRows"
      pattern: "estimateCombinedTier\\(combined\\.value, artifact\\.tierCuts\\)"
    - from: apps/web/src/lib/allianceTierApproximation.ts
      to: packages/harness/tierCuts.ts
      via: "tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3)"
      pattern: "tierFromCuts\\("
---

<!-- planner-discipline-allow: buildTeamValuePercentilePoints -->
<!-- planner-discipline-allow: TierApproximationPoint -->
<!-- planner-discipline-allow: AllianceApproxTier -->
<!-- planner-discipline-allow: buildTeamValuePercentilePoints|TierApproximationPoint|AllianceApproxTier -->
<!-- planner-discipline-allow: Accepted and out of scope -->

<objective>
Make the Alliances tab's Combined Total tier come from the season cut points. Today
`estimateCombinedTier` estimates the season pool percentile of (combined / 3) by monotone
interpolation over the event teams' published `(total.value, total.percentile)` pairs. That has two
defects. A live fold strips percentiles, so folded teams drop out of the points and the estimate
thins or vanishes mid event. The clamp at the ends of the points also caps an alliance whose per team
equivalent sits above every percentile carrying event team (a pick resolved through `allianceTeams`,
or a roster whose strongest teams were live folded).

Every event artifact already carries `tierCuts`, built per (algorithm, season) from the same
rankingPools the published percentiles rank against, and `tierFromCuts` reproduces the published tier
for any value exactly. So `tierFromCuts(tierCuts Total entry, combined / 3)` gives exactly the thing the
interpolation approximates, with no thinning and no clamp. The divide by 3 heuristic stays, so the
tier stays labelled approximate.

Purpose: the Combined Total tier keeps working through a live event instead of degrading with every
fold, and it stops depending on which teams happen to be at the event.
Output: rewritten `allianceTierApproximation.ts` and its tests, rewired `AlliancesTab.tsx` with the
season wording in the disclosure, new render tests, a one line comment fix in
`packages/harness/tierCuts.ts`, and the closed todo's block updated.

Web only plus comments and planning docs. No Worker, publisher or artifact shape change. No
republish, no deploy.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/web/src/lib/allianceTierApproximation.ts
@apps/web/src/lib/allianceTierApproximation.test.ts
@packages/harness/tierCuts.ts
@.planning/quick/260927-uen-team-header-tiers-from-season-cut-points/260927-uen-SUMMARY.md

<interfaces>
Established facts the executor can rely on without re-reading (all verified against HEAD 800a763c):

- `packages/harness/tierCuts.ts`: `tierFromCuts(entry: SeasonTierCutEntry | undefined, value: number | undefined): Tier | undefined`. Returns undefined when either argument is undefined. Rounds the query with `roundMetric` (2 decimals) before comparing. Higher is better: `>= cuts[2]` legendary, `>= cuts[1]` epic, `>= cuts[0]` rare, else common. `entry.lower === true` flips to `<=` with `cuts` descending. It never returns undefined for a defined entry and value (Common is explicit). `apps/web/src/lib/tiers.ts` imports it as `import { tierFromCuts, type Tier } from "../../../../packages/harness/tierCuts.js";` and re-exports `type Tier`.
- `packages/harness/pageArtifacts.ts`: `SeasonTierCutEntry = { cuts: [number, number, number]; lower?: true }`; `SeasonTierCuts = Record<string, SeasonTierCutEntry>`; `EventArtifactSchema.tierCuts: SeasonTierCutsSchema.optional().catch(undefined)`. The catch means a malformed fixture silently parses to undefined, so test fixtures must use a real 3 number tuple and the literal `true` for `lower`.
- `TOTAL_KEY` (`@/lib/metricKeys`) is the string "total".
- Where the divide by 3 happens today: INSIDE the estimator (`estimateCombinedTier` computes `combinedValue / 3`); the caller `buildAllianceRows` passes the raw `combined.value`. Keep exactly that split.
- `AllianceApproxTier.percentile` (the interpolated number) is rendered nowhere: `CombinedCell` reads only `approx?.tier`, `combinedApproxTier` has no reader outside `AlliancesTab.tsx`, and no test reads it. Safe to drop.
- Nothing outside `allianceTierApproximation.ts`, its test and `AlliancesTab.tsx` imports the module (grep of apps and packages). The only other mention in code is a comment at `AlliancesTab.test.tsx` ~838-842 (the D-02 section banner).
- `AlliancesTab.tsx` already imports `SeasonTierCuts` and `resolveMetricTier, tierForPercentile` (from `@/lib/tiers`) and already reads `artifact.tierCuts` for the pick cells (~line 724).
- Test helpers in `AlliancesTab.test.tsx`: `team(overrides)` (default `metrics: { [TOTAL_KEY]: { value: 10, spread: 10 } }`, no percentile), `alliance(overrides)` (default picks frc1..frc3), `makeArtifact(teams, alliances, overrides)` which parses through `EventArtifactSchema` via `makeEventArtifact`, `FOUR_TEAMS` (frc1..frc4, value 10, no percentile), `renderAlliances(artifact)`. Cell test ids are `alliances-cell-${column.id}` with ids `allianceNumber`, `pick0` (captain), `pick1`, `pick2`, `pickBackup`, `combined`, `record`.
- The existing render tests that rely on percentile derived combined tiers (they will go untiered under the new rule and must be re-fixtured): ~277 "renders the 3x-heuristic APPROXIMATE tier", ~294 "the approximate-tier disclosure carries a ROLE", ~320 "renders the common tier ring AND the approximation disclosure". ~270 and ~312 (no percentiles, no cuts, untiered) stay true as they are.
- No methodology `*Content.ts`, `docs/` page, e2e spec or skill file describes the event relative interpolation or pins the disclosure text (grep for "single-team totals", "interpolat", "allianceTier", "Approximate tier" returned only the files in this plan). No code comment in apps, packages or docs says the Alliances tier "thins"; only planning history does.
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer, Combined Total tier from tierCuts end to end (lib, row builder, disclosure, render test)</name>
  <files>apps/web/src/lib/allianceTierApproximation.ts, apps/web/src/lib/allianceTierApproximation.test.ts, apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/event/AlliancesTab.test.tsx</files>
  <read_first>
    apps/web/src/components/event/AlliancesTab.tsx lines 1-60, 90-125, 208-290, 525-566 (the rest is pick cell and table layout this task does not touch).
    apps/web/src/components/event/AlliancesTab.test.tsx lines 1-100, 265-340, 836-845.
  </read_first>
  <behavior>
    Unit (allianceTierApproximation.test.ts, rewritten from scratch; the old interpolation and roster points suites are deleted with the code they tested). Fixture `CUTS: SeasonTierCuts = { [TOTAL_KEY]: { cuts: [20, 30, 40] } }`:
    - tierCuts undefined returns undefined.
    - tierCuts present with no Total entry (for example only an `autoPoints` entry) returns undefined.
    - Boundary exactness, higher is better: 60 -> rare (20 exactly on the Rare cut), 59.97 -> common, 90 -> epic (30 exactly), 89.97 -> rare, 120 -> legendary (40 exactly), 119.97 -> epic.
    - Rounding onto a cut: 89.988 (per team 29.996, rounds to 30.00) -> epic, because tierFromCuts rounds the query.
    - Far above and far below: 300 -> legendary, 0 -> common. No roster argument exists, so there is nothing to clamp to.
    - Lower is better via the marker: `{ [TOTAL_KEY]: { cuts: [40, 30, 20], lower: true } }` gives 60 -> legendary, 90 -> epic, 120 -> rare, 150 -> common; and 60 against the higher is better CUTS gives rare, proving direction comes from the entry, not an assumption.
    - The divide by 3: for per team values v in [0, 19.99, 20, 25, 30, 39.99, 40, 55], `estimateCombinedTier(3 * v, CUTS)` equals `tierFromCuts(CUTS[TOTAL_KEY], v)`.
    Render (AlliancesTab.test.tsx):
    - Live folded roster: FOUR_TEAMS (values only, no percentile anywhere) plus `tierCuts: { [TOTAL_KEY]: { cuts: [5, 8, 12] } }`, alliance frc1..frc3: combined 30, per team 10 -> the combined cell carries `.metric-tier--epic` and the disclosure group (`getByRole("group", { name: ALLIANCE_APPROX_TIER_DISCLOSURE })`); `buildAllianceRows(...)[0]?.combinedApproxTier` is "epic".
  </behavior>
  <action>
    Per the approved direction (the divide by 3 heuristic stays; only the reference the per team equivalent is classified against changes, from the event's interpolated percentiles to the season cut points).

    1. `apps/web/src/lib/allianceTierApproximation.ts`, rewrite the module:
       - Exports exactly one function: `estimateCombinedTier(combinedValue: number, tierCuts: SeasonTierCuts | undefined): Tier | undefined`, whose body returns `tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3)`. The division by the literal 3 stays inside this function, exactly where it is today; the caller keeps passing the raw combined value. Direction comes from the entry's own `lower` marker inside tierFromCuts; do not branch on direction here.
       - Imports: `tierFromCuts` from `../../../../packages/harness/tierCuts.js`, `type Tier` from `./tiers`, `TOTAL_KEY` from `./metricKeys`, `type SeasonTierCuts` from `../../../../packages/harness/pageArtifacts.js` (type only, erased). Drop the `tierForPercentile` and `EventArtifact` imports.
       - Delete `buildTeamValuePercentilePoints`, the `TierApproximationPoint` interface, the `AllianceApproxTier` interface (with its interpolated `percentile` field, which nothing renders), and the interpolation loop and clamp branches.
       - Rewrite the module header in the codebase's comment voice (plain declarative sentences, backticked identifiers, the quick task id cited the way 260920-qzf and 260923-3x0 are cited elsewhere). It must say: a three team sum has no published percentile of its own, and a sum's rank is not a function of its parts' ranks, so the output is always an estimate and every caller must disclose it (`AlliancesTab.tsx` does); the method divides the combined total by 3 and classifies that per team equivalent against the season `tierCuts` Total entry through `tierFromCuts`, which gives exactly the tier a single team with that value would take in the season pool the published percentiles rank against; the only approximation left is the divide by 3 itself (an alliance averaging X is treated as being as rare as one team at X); quick task 260927-wnh replaced an interpolation over the event roster's published percentiles, which thinned as live folds stripped those percentiles and clamped at the event's own value range, and the cut rule depends on neither; absent `tierCuts` or an absent Total entry returns undefined with no fallback, because the artifact that lacks cuts in production (the Worker's bootstrap write, which holds no season pool) carries no published percentiles either, and a second method behind one disclosure sentence would make that sentence false for one of them. Do not name the deleted helpers in any comment.
       - The function's own doc comment states the contract in two or three sentences: returns undefined when there is no Total cut entry, never a guess; Common is returned explicitly so the hairline ring draws.

    2. `apps/web/src/components/event/AlliancesTab.tsx`, wire the caller and the copy:
       - Import change: replace the `allianceTierApproximation` import with `import { estimateCombinedTier } from "@/lib/allianceTierApproximation";` and add `type Tier` to the existing `@/lib/tiers` import.
       - `AllianceRow.combinedApproxTier` becomes `Tier | undefined`. Rewrite its doc comment: undefined when `combined` is undefined, or when the artifact carries no `tierCuts` Total entry (a bootstrap or pre republish artifact); never an exact tier; points to `@/lib/allianceTierApproximation` for the method.
       - In `buildAllianceRows`, delete the `tierPoints` local and the four line comment above it (the standings roster argument it made is moot: the cuts do not depend on the roster at all). The row field becomes `combinedApproxTier: combined !== undefined ? estimateCombinedTier(combined.value, artifact.tierCuts) : undefined`.
       - `CombinedCell`: the `approx` prop type becomes `Tier | undefined`, `boxed` stays `approx !== undefined`, and `TotalSigmaValue` gets `totalTier={approx}`.
       - Replace the string value of `ALLIANCE_APPROX_TIER_DISCLOSURE` with exactly: Approximate tier: no percentile is published for a 3-team sum, so this is estimated by dividing the combined total by 3 and comparing that to the season's single-team totals.
       (Only the ending changes. It adds no new hyphen or dash characters: "3-team" and "single-team" were already in the old string.)
       - Leave every other comment in this file for Task 2.

    3. `apps/web/src/lib/allianceTierApproximation.test.ts`: replace the whole file with the unit cases in `<behavior>`. Import `estimateCombinedTier` from `./allianceTierApproximation`, `tierFromCuts` from `../../../../packages/harness/tierCuts.js`, `TOTAL_KEY` from `./metricKeys`, `type SeasonTierCuts` from `../../../../packages/harness/pageArtifacts.js`. Use `toBe` on the returned tier string throughout.

    4. `apps/web/src/components/event/AlliancesTab.test.tsx`, keep the suite green and add the tracer case:
       - Re-fixture the three tests that relied on percentile derived combined tiers so they tier through cuts instead, with no percentile on any team: ~277 and ~294 use `makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })], { tierCuts: { [TOTAL_KEY]: { cuts: [4, 6, 10] } } })` (combined 30, per team 10, exactly on the Legendary cut, so still `.metric-tier--legendary`), and rewrite their inline comments to say so; ~320 uses cuts `[20, 30, 40]` (per team 10 -> Common, the ring plus the disclosure) and its title and comment say "when the per team equivalent lands in Common" rather than naming an interpolated percentile. Every assertion in those three tests stays as it is.
       - Rename ~270's title to "the Combined Total cell has NO tier box when the event artifact carries no tierCuts"; its body is unchanged.
       - Add a new `describe("AlliancesTab — Combined Total tier from the season cut points (260927-wnh)", ...)` directly after the seven column anatomy describe block, holding the live folded roster case from `<behavior>` (Task 2 appends more cases to it).
       - Rewrite the D-02 section banner comment (~838-842) so it no longer names a removed helper: a real standings row always wins, and the combined arithmetic (D-03) treats an `allianceTeams` row no differently from a `teams` row.

    5. Run the verify command, read the output (not the exit code), then commit these four files by explicit path (`git add <each path>`; other sessions commit on this checkout, never `git add -A` or `.`), message `feat(quick-260927-wnh): Combined Total tier from the season cut points`.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run apps/web/src/lib/allianceTierApproximation.test.ts apps/web/src/components/event/AlliancesTab.test.tsx &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json &amp;&amp; ! grep -rqE "buildTeamValuePercentilePoints|TierApproximationPoint|AllianceApproxTier" apps/web/src packages &amp;&amp; ! grep -q "this event's own" apps/web/src/components/event/AlliancesTab.tsx &amp;&amp; grep -q "estimateCombinedTier(combined.value, artifact.tierCuts)" apps/web/src/components/event/AlliancesTab.tsx &amp;&amp; echo GATES-OK</automated>
  </verify>
  <acceptance_criteria>
    - vitest output shows both files passed with zero failures, including the new live folded roster case (judge by the printed Test Files / Tests lines, not the exit code).
    - Web tsc prints nothing. If it prints dozens of route type errors, `routeTree.gen.ts` is missing (a fresh worktree): run the web vite build once, then re-run tsc.
    - The deleted identifiers appear nowhere in apps/web/src or packages; the disclosure no longer says the comparison is to the event's own totals; `buildAllianceRows` passes `artifact.tierCuts`.
    - `GATES-OK` printed.
  </acceptance_criteria>
  <done>A live folded roster with tierCuts renders a tiered, disclosed Combined Total; the unit suite pins the cut rule; the old percentile based fixtures tier through cuts; one commit with exactly these four files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Expand, the no clamp and no cuts cases, disclosure copy pin, and the comment sweep</name>
  <files>apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/event/AlliancesTab.test.tsx, packages/harness/tierCuts.ts</files>
  <read_first>
    packages/harness/tierCuts.ts lines 1-10 only.
  </read_first>
  <behavior>
    Appended to the 260927-wnh describe block in AlliancesTab.test.tsx:
    - No clamp at the event's range: `teams` = frc1..frc4 each `metrics: { [TOTAL_KEY]: { value: 10, spread: 10, percentile: 20 } }` (published, Common); `allianceTeams` = frc5 ("Epsilon") and frc6 ("Zeta"), each `metrics: { [TOTAL_KEY]: { value: 70 } }`; alliance picks ["frc1", "frc5", "frc6"]; `tierCuts: { [TOTAL_KEY]: { cuts: [20, 30, 45] } }`. Combined 150, per team 50 -> the combined cell carries `.metric-tier--legendary` while the captain cell (`alliances-cell-pick0`, frc1, the strongest standings team) carries `.metric-tier--common`. A comment states why this fixture shape: when all three picks are percentile carrying standings teams, their average can never leave the standings range, so the old clamp bound only when a pick came through `allianceTeams` or when the roster's strongest teams had been live folded; the live folded roster case covers the second, this covers the first.
    - Published percentiles without cuts, no fallback: FOUR_TEAMS re-mapped with `percentile: 99` on every Total and no `tierCuts` -> the combined cell has no `.metric-tier`, no group role, and `buildAllianceRows(...)[0]?.combinedApproxTier` is undefined, while the captain cell is still `.metric-tier--legendary` (pick cells are unchanged).
    - Cuts without a Total entry: FOUR_TEAMS plus `tierCuts: { autoPoints: { cuts: [1, 2, 3] } }` -> the combined cell has no `.metric-tier` and no group role.
    - Disclosure copy: `ALLIANCE_APPROX_TIER_DISCLOSURE` contains "the season's single-team totals".
  </behavior>
  <action>
    1. `AlliancesTab.test.tsx`: append the four cases in `<behavior>` to the describe block Task 1 created. Use `within(cell).queryByRole("group")` for the absent group assertions, matching the existing ~312 test's style.

    2. `AlliancesTab.tsx`, comment sweep only (no code change in this step):
       - The `buildAllianceRows` doc comment currently sits orphaned above `combinedSigmaBand`'s doc comment (two JSDoc blocks in a row, so the first attaches to nothing). Move it to sit directly above `export function buildAllianceRows`, and replace its "against the FULL event roster, not just this alliance's three picks" clause with: the approximate tier classifies the combined total divided by 3 against the artifact's `tierCuts` Total entry, the same per (algorithm, season) block the pick cells fall back to, so it does not depend on which teams are at this event or which of them still carry a published percentile.
       - `CombinedCell`'s doc comment: "tiered by the 3x heuristic's APPROXIMATE percentile when one is available" becomes tiered by the 3x heuristic's approximate tier whenever the artifact carries a `tierCuts` Total entry. The rest of that comment (disclosure mechanics, the Sigma band) is still accurate; leave it.
       - The file header (~lines 17-18) and the component doc (~709, "the client-side 3x tier approximation") are still accurate; leave them.

    3. `packages/harness/tierCuts.ts`, comment only: the header sentence naming `apps/web/src/lib/tiers.ts`'s resolver as this file's only client side caller becomes one naming both client side callers, that resolver and `apps/web/src/lib/allianceTierApproximation.ts`. No other change in this file; the browser safe import rules it states are unaffected (the web module imports it exactly as `tiers.ts` does).

    4. Run the verify command, read the output, then confirm the `packages/harness/tierCuts.ts` diff is comment only (every changed line in `git diff -U0 packages/harness/tierCuts.ts` starts with ` *` after the +/- marker). Commit the three files by explicit path, message `test(quick-260927-wnh): no clamp and no cuts cases; comment sweep`.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run apps/web/src/lib/allianceTierApproximation.test.ts apps/web/src/components/event/AlliancesTab.test.tsx packages/harness/tierCuts.test.ts &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json &amp;&amp; test -z "$(git diff -U0 packages/harness/tierCuts.ts | grep -E '^[+-][^+-]' | grep -vE '^[+-] \*')" &amp;&amp; grep -q "allianceTierApproximation" packages/harness/tierCuts.ts &amp;&amp; echo GATES-OK</automated>
  </verify>
  <acceptance_criteria>
    - vitest output shows all three files passed, zero failures, and the four new cases listed by name.
    - Web tsc prints nothing.
    - The tierCuts.ts diff gate is empty (comment only) and the header names the new caller.
    - `GATES-OK` printed.
  </acceptance_criteria>
  <done>The no clamp, no fallback, no Total entry and copy cases are pinned; every comment in `AlliancesTab.tsx` describes the cut rule; `tierCuts.ts` names both client callers; one commit with exactly these three files.</done>
</task>

<task type="auto">
  <name>Task 3: Close the loop in the todo, repo wide stale sweep, full suite</name>
  <files>.planning/todos/completed/live-merges-drop-percentiles.md</files>
  <action>
    1. In `.planning/todos/completed/live-merges-drop-percentiles.md`, edit only the `STATUS 2026-09-27: CLOSED` blockquote at the top. Replace its sentence that begins "Accepted and out of scope: the Alliances Combined Total tier still thins during live folds" (it runs through "cuts give a tier, not a number.") with: The Alliances Combined Total tier, which thinned during live folds because `allianceTierApproximation.ts` interpolated the event roster's published percentiles, is fixed by 260927-wnh: it now classifies the combined total divided by 3 against the same `tierCuts` block, so it no longer depends on published percentiles or clamps at the event's own range.
       Keep every line prefixed with "> " and wrapped near the block's existing width. Leave the rest of the block and every section below it untouched: the block's own last sentence declares everything below it history, including the older "still thins" sentences there.

    2. Stale sweep outside history: run `grep -rn "thins" apps packages docs scripts --include=*.ts --include=*.tsx --include=*.md` and `grep -rn "single-team totals\|interpolat" apps/web/src/components/event apps/web/src/lib/allianceTierApproximation.ts`. Expected: no hit that describes the Alliances tier as thinning or interpolated. If one appears, fix it in the same voice and add that file to this commit (list it in the SUMMARY).

    3. Full verification from the repo root (the web directory alone runs a subset): `npx vitest run`, then `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`. Judge vitest by its printed Test Files / Tests lines. If running in a fresh git worktree, the rpSeed/sigmaSeed structural harness tests can fail on CRLF line endings there only; confirm any such failure also fails at HEAD before this task's first commit and report it as a baseline, not a regression.

    4. Commit the todo file by explicit path, message `docs(quick-260927-wnh): the Alliances Combined Total tier is fixed, not accepted`. Do not touch STATE.md or write the SUMMARY into the repo if the harness blocks it; return the SUMMARY text to the orchestrator instead.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; grep -q "fixed by 260927-wnh" .planning/todos/completed/live-merges-drop-percentiles.md &amp;&amp; test "$(sed -n '1,40p' .planning/todos/completed/live-merges-drop-percentiles.md | grep -c 'Accepted and out of scope')" = "0" &amp;&amp; npx vitest run &amp;&amp; npx tsc --noEmit &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json &amp;&amp; echo GATES-OK</automated>
  </verify>
  <acceptance_criteria>
    - The CLOSED block names 260927-wnh as the fix and no longer calls the Alliances tier accepted and out of scope; the sections below the block are byte identical to before (check `git diff` touches only lines inside the top blockquote).
    - Full repo root vitest: zero failures (or only a documented pre-existing worktree baseline), and the printed file count is the full suite, not the web subset.
    - Both tsc runs print nothing.
  </acceptance_criteria>
  <done>The todo's closing block records the fix; no live code or doc comment calls the Alliances tier thinning; the full suite and both typechecks are clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| published artifact -> browser | `tierCuts` arrives in the event artifact JSON from data.sigmascout.org and is parsed by `EventArtifactSchema` (`.optional().catch(undefined)`) before any component reads it |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-wnh-01 | Tampering | `tierCuts` block in the event artifact | low | accept | Values are schema parsed (3 number tuple, literal `true` marker); a malformed block degrades to undefined, which this plan renders untiered. The worst a tampered block can do is paint a wrong colour on a value the reader can see; the artifact origin is our own R2 bucket |
| T-wnh-02 | Denial of Service | `roundMetric` inside `tierFromCuts` throws on a non finite value | low | accept | The query is a sum of three schema parsed finite numbers divided by 3, so it is always finite; no new input reaches `tierFromCuts` beyond what the pick cells already pass it |
| T-wnh-03 | Information disclosure | none | low | accept | Client only change; no secrets, no network calls, no `.env` access in any task |
</threat_model>

<verification>
- `estimateCombinedTier(combinedValue, tierCuts)` returns `tierFromCuts(tierCuts?.[TOTAL_KEY], combinedValue / 3)`; the divide by 3 lives in the estimator, as before.
- A roster with no published percentiles but a `tierCuts` Total entry tiers its Combined Total; a strong alliance can tier above the best standings team; no cuts or no Total entry means untiered with no disclosure group and no fallback.
- The disclosure text ends "comparing that to the season's single-team totals."
- Full repo root vitest and both typechecks clean.
</verification>

<success_criteria>
- The Alliances Combined Total tier no longer thins during a live fold and no longer clamps at the event's value range.
- The dead interpolation code and its interpolated percentile field are gone, and no comment names them.
- Three commits, each staging only its own files by explicit path. No Worker, publisher, schema or artifact change; no republish or deploy owed.
</success_criteria>

<output>
Return the SUMMARY text for `.planning/quick/260927-wnh-alliances-combined-tier-from-season-cut-/260927-wnh-SUMMARY.md` to the orchestrator (write it directly only if the harness allows). Record: where the divide by 3 happens, the no fallback call and its reason, the exact old and new disclosure strings, why the no clamp test uses `allianceTeams`, the three commit hashes, and the test/tsc output lines.
</output>
