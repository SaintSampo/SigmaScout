---
phase: quick-261024-jvv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/event/BreakdownTab.tsx
  - apps/web/src/components/event/BreakdownTab.test.tsx
  - apps/web/e2e/breakdown-desktop-overflow.spec.ts
  - apps/web/src/components/event/InsightsTab.tsx
  - apps/web/src/components/event/InsightsTab.test.tsx
  - apps/web/src/components/event/TeamsTab.tsx
  - apps/web/src/components/event/TeamsTab.test.tsx
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/routes/event.$eventKey.test.tsx
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/searchParams.test.ts
  - apps/web/src/lib/metricKeys.ts
  - apps/web/src/lib/metricKeys.test.ts
  - apps/web/src/lib/metricLabels.ts
  - apps/web/src/components/team/EventSection.tsx
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/event/AlliancesTab.test.tsx
  - apps/web/src/components/event/RankDistributionTable.tsx
  - apps/web/src/components/event/RankDistributionTable.test.tsx
  - apps/web/src/components/event/SimulationTab.test.tsx
  - apps/web/src/components/teams-table/columns.tsx
  - apps/web/src/components/ribbon/AlgorithmSelect.tsx
  - apps/web/src/components/ui/tabs.tsx
  - apps/web/src/test/helpers.ts
  - apps/web/playwright.config.ts
  - apps/web/e2e/event-scroll-regions.spec.ts
  - apps/web/e2e/table-layout-quality.spec.ts
  - apps/web/e2e/touch-action-vertical-scroll.spec.ts
  - apps/web/e2e/tab-strip-trigger-sizing.spec.ts
  - apps/web/e2e/event-live-artifact.spec.ts
  - apps/web/e2e/event-page.spec.ts
autonomous: true
requirements: [QUICK-261024-jvv]

estimate:
  tokens: 100000
  raw_tokens: 200000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "The event page tab strip shows exactly five tabs in this order: Teams, Qualifications, Alliances, Playoffs, Simulation. No Breakdown tab exists (LD-1, LD-2)"
    - "A bare event URL, ?tab=teams, and the retired ?tab=insights and ?tab=breakdown links all render the Teams panel (LD-2)"
    - "On the Teams table, the Rank, RP, Total, Auto, Teleop and Endgame headers are buttons that re-sort the rows; Team #, Team Name and Record are not sortable and carry no aria-sort (LD-3)"
    - "First click on a column sorts it in its natural direction (Rank ascending, RP and every metric descending); clicking the active column toggles direction; the URL search does not change (LD-3)"
    - "A row missing the sorted value sorts last in both directions, exact ties break by ascending team number, and every Rank cell keeps its official or fallback rank number under any sort (LD-3)"
    - "The default row order and the fallback, pending and counted banners are unchanged from today (LD-3)"
    - "The team page's event heading links open the event page on the Teams tab (LD-2)"
  artifacts:
    - path: "apps/web/src/components/event/TeamsTab.tsx"
      provides: "TeamsTab, TeamsTabSkeleton, buildTeamsRows, sortTeamsRows, nextTeamsSort, effectiveTeamsSort"
    - path: "apps/web/src/components/event/TeamsTab.test.tsx"
      provides: "renamed Insights tests plus the column sorting cases"
    - path: "apps/web/src/lib/searchParams.ts"
      provides: "EVENT_TABS = teams, quals, alliances, elims, simulation; DEFAULT_EVENT_TAB = teams"
  key_links:
    - from: "apps/web/src/routes/event.$eventKey.tsx"
      to: "apps/web/src/components/event/TeamsTab.tsx"
      via: "import of TeamsTab and TeamsTabSkeleton inside renderTeamsContent"
      pattern: "TeamsTab"
    - from: "apps/web/src/lib/searchParams.ts EVENT_TABS"
      to: "REGISTERED_EVENT_TABS and the TabsTrigger/TabsContent value attributes in the route"
      via: "the same five ids in the same order"
      pattern: "\"teams\""
    - from: "TeamsTab component"
      to: "useTable data"
      via: "useMemo applying sortTeamsRows to buildTeamsRows rows when effectiveTeamsSort is non-null"
      pattern: "sortTeamsRows"
---

<objective>
Remove the event page's Breakdown tab, rename the Insights tab to Teams (id, label, file, identifiers, test ids), and make the Teams table's Rank, RP, Total, Auto, Teleop and Endgame headers sortable with local component state.

Purpose: one event table instead of two overlapping ones, named for what it shows, with the sort control readers already know from the Teams page.
Output: TeamsTab.tsx (renamed from InsightsTab.tsx) with sorting, BreakdownTab files and its e2e spec deleted, five registered event tabs, every test and e2e reference updated.

Locked decisions from the orchestrator, cited below as LD-1 to LD-4:
- LD-1: Breakdown tab removed entirely; its EPA per-phase component expansion is dropped, not ported; `packages/core/algorithms/breakdown/` is untouched.
- LD-2: Insights becomes Teams, id and all; retired `?tab=insights` and `?tab=breakdown` land on Teams through the existing `.catch(DEFAULT_EVENT_TAB)`.
- LD-3: Teams table gets sortable headers, local `useState` only, never a URL search param.
- LD-4: verification commands run from the repo root, no `timeout` wrapper, no Playwright, no `pnpm install`.

Task order is remove, then rename, then sort (the orchestrator suggested rename first). Removing Breakdown first means the rename in Task 2 is a mechanical pass over a surface with no Breakdown cross-references left, and the retired-id note and test are written once.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/web/src/components/event/InsightsTab.tsx
@apps/web/src/lib/searchParams.ts

Executor ground rules for this plan:
- The working tree carries UNCOMMITTED edits from a concurrent session (quick 261024-jdz): `apps/worker/src/scheduled.ts`, `apps/worker/src/eventsListRebuild.ts`, `apps/worker/test/*`, `packages/core/algorithms/cancelledEvent.ts`, `.planning/quick/261024-jdz-*`. Never stage, edit, stash, reset or commit any of them. Stage by explicit path only (`git add <path>` / `git rm <path>` / `git mv`), never `git add -A`, `git add .` or `git commit -a`.
- Run every command from the repo root `C:/Users/Jacob/Documents/GitHub/SigmaScout`. Never run vitest from `apps/web`, never wrap a command in `timeout`, never run `pnpm install`, never run Playwright (the e2e suite only runs against the live site).
- In bash, single-quote any path containing `$eventKey`, for example `'apps/web/src/routes/event.$eventKey.test.tsx'`.
- Do not edit `.planning/STATE.md`; the orchestrator records the quick task row.
- Never read, print or touch `.env` (CLAUDE.md secrets rule). This plan needs no secret.
- When a comment you rewrite refers to the event Teams tab, say "the event Teams tab" (or `TeamsTab.tsx`) so it is never confused with the `/teams` page and its `TeamsTable.tsx`.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove the Breakdown tab, its tests, its e2e spec and every reference to it</name>
  <files>apps/web/src/components/event/BreakdownTab.tsx, apps/web/src/components/event/BreakdownTab.test.tsx, apps/web/e2e/breakdown-desktop-overflow.spec.ts, apps/web/src/routes/event.$eventKey.tsx, apps/web/src/routes/event.$eventKey.test.tsx, apps/web/src/lib/searchParams.ts, apps/web/src/lib/searchParams.test.ts, apps/web/src/lib/metricKeys.ts, apps/web/src/lib/metricKeys.test.ts, apps/web/src/lib/metricLabels.ts, apps/web/src/components/event/InsightsTab.tsx, apps/web/src/components/event/InsightsTab.test.tsx, apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/event/AlliancesTab.test.tsx, apps/web/src/components/event/RankDistributionTable.tsx, apps/web/src/components/event/RankDistributionTable.test.tsx, apps/web/src/components/event/SimulationTab.test.tsx, apps/web/src/components/teams-table/columns.tsx, apps/web/src/components/ribbon/AlgorithmSelect.tsx, apps/web/src/components/ui/tabs.tsx, apps/web/src/test/helpers.ts, apps/web/playwright.config.ts, apps/web/e2e/event-scroll-regions.spec.ts, apps/web/e2e/table-layout-quality.spec.ts, apps/web/e2e/touch-action-vertical-scroll.spec.ts, apps/web/e2e/tab-strip-trigger-sizing.spec.ts</files>
  <read_first>
    - apps/web/src/routes/event.$eventKey.tsx lines 1-60 (module doc, REGISTERED_EVENT_TABS), 220-256 (renderBreakdownContent), 336-440 (page cap comment, tab strip, TabsContent pairs)
    - apps/web/src/routes/event.$eventKey.test.tsx lines 1-30 (imports), 138-160 (TabCase, TAB_CASES), 185-332 (per-tab it.each blocks, tab strip tests, Tests 5 to 7), 333 (test title), 500-506 (Test 14)
    - apps/web/src/lib/searchParams.ts lines 270-305 and apps/web/src/lib/searchParams.test.ts lines 76-112
    - apps/web/src/lib/metricKeys.ts lines 25-75
    - apps/web/e2e/event-scroll-regions.spec.ts lines 35-60 and 320-390; apps/web/e2e/table-layout-quality.spec.ts lines 1-40, 80-115, 155-165, 325-335; apps/web/playwright.config.ts lines 125-180
  </read_first>
  <action>
Per LD-1. Step 0, before deleting anything: run `grep -rn "BreakdownTab" apps/web/src apps/web/e2e` and `grep -rnE "groupCanExpand|visibleMetricKeys|sortBreakdownRows|buildBreakdownRows|BREAKDOWN_|DEFAULT_BREAKDOWN_SORT|NO_GROUPS_EXPANDED|BreakdownSort|BreakdownRow|BreakdownMetricEntry" apps/web/src apps/web/e2e`. The planner's own scan found the only importers to be the route and BreakdownTab.test.tsx, and every other hit is a comment. If the executor's scan finds a real import elsewhere, move that symbol into its consumer before deleting; otherwise nothing is ported. The `tierForPercentile` import in InsightsTab.tsx comes from `@/lib/tiers`, not from BreakdownTab, so it is unaffected.

Delete with `git rm`: `apps/web/src/components/event/BreakdownTab.tsx`, `apps/web/src/components/event/BreakdownTab.test.tsx`, `apps/web/e2e/breakdown-desktop-overflow.spec.ts`. Do NOT touch anything under `packages/core/algorithms/breakdown/`.

searchParams.ts: drop the breakdown id from `EVENT_TABS`, giving five ids (insights, quals, alliances, elims, simulation). Rewrite the tuple's doc comment from "six tab ids ... Insights, Breakdown, Quals ..." to five ids without Breakdown. In the `EventSearchSchema` doc comment, change "Neither Insights nor Breakdown exposes a clickable-to-resort header" to say the Insights tab exposes none (Task 2 renames it, Task 3 rewrites the sentence).

searchParams.test.ts: update the EVENT_TABS equality test and the "six ids / six iterations / toHaveLength(6)" test to five. Add one case, named so its title contains the word "retired": `EventSearchSchema.parse({ tab: "breakdown" }).tab` returns the default tab id.

Route `event.$eventKey.tsx`: remove the BreakdownTab import, the breakdown entry in `REGISTERED_EVENT_TABS`, `renderBreakdownContent`, and the breakdown TabsTrigger and TabsContent pair. Rewrite the comments that name Breakdown as a live tab: the module doc (lines ~23-27, "relative to the Breakdown table's" becomes the active tab table's own scroll region), the page-cap comment block above the return (~341-355; keep `max-w-[1200px]` exactly as is and say a wide event table scrolls inside its own card), and the strip scroll-region comment (~366-367, name a tab table's own `*-table-scroll` region instead of `breakdown-table-scroll`).

Route test: delete the breakdown TabCase and remove `"breakdown"` from the `TabCase.tab` union. Change both `otherTab` and `startTab` expressions to toggle between insights and quals (when the case is insights use quals, otherwise insights). Update the tab strip test (~252-258) to five tabs in the order Insights, Qualifications, Alliances, Playoffs, Simulation. Delete the two Breakdown column-set tests (~261-293), then delete the `componentsInGroup` import (line ~25) because nothing else uses it. Test 5: keep the insights-panel-visible assertion and assert `quals-panel` is hidden in place of `breakdown-panel`. Test 6: five ids, `toHaveLength(5)`. Replace Test 7 with a test whose title contains "retired": `/event/2024casf?algorithm=spr&tab=breakdown` renders `insights-panel` visible. Retitle the test at ~333 to drop its Breakdown clause. Test 14 (~505): assert the Qualifications tab instead of Breakdown.

metricKeys.ts: after the deletion, `publishesComponentMetrics` has no production caller (planner grep: only metricKeys.ts and its test). Confirm with `grep -rn "publishesComponentMetrics" apps packages scripts`. If only metricKeys.ts and metricKeys.test.ts remain, delete the function, its doc comment and its test case (metricKeys.test.ts ~59-63, and drop it from that file's import). Rewrite the metricKeys.ts comments at ~30-31 and ~55-70 that name the event Breakdown tab so they no longer describe it as existing.

Comment cleanup. Every comment below names Breakdown or BreakdownTab as code that exists. Rewrite each one to drop the reference, or point it at a surviving file such as `teams-table/rowModel.ts` or `TeamsTable.tsx`. Never invent a new claim.
- InsightsTab.tsx at ~19, 71, 95, 355, 369-371, 420 and 465. Line 465 names `BREAKDOWN_SKELETON_ROW_COUNT`.
- InsightsTab.test.tsx header at ~6 and ~11. Also the test title at ~299 ("unlike Breakdown's" becomes "the column count is algorithm independent").
- AlliancesTab.tsx at ~6, 737 and 747.
- AlliancesTab.test.tsx ~4, RankDistributionTable.test.tsx ~4 and SimulationTab.test.tsx ~41. Describe the self-contained-tree fixture technique without naming a file.
- RankDistributionTable.tsx at ~3 and 155.
- teams-table/columns.tsx at ~36 and ~72.
- AlgorithmSelect.tsx at ~14 and ~73. The `algorithmDisplayLabel` export stays.
- metricLabels.ts ~4 and test/helpers.ts at ~23 and ~62.

Leave the historical measurement comments in ui/tabs.tsx ~94 and tab-strip-trigger-sizing.spec.ts ~5, 11 and 66 in place. Reword them only so they read as history ("the former Breakdown tab's label").

e2e: in `playwright.config.ts`, remove `breakdown-desktop-overflow\.spec\.ts` from both `testMatch` regexes (~129 and ~179) and from the comment at ~168. Keep every other alternation byte-identical. `event-scroll-regions.spec.ts`:
- remove the breakdown entry from the scroll-id map (~40) and from `TABS` (~55);
- delete the whole E4 describe block (~323-361);
- set `EXPECTED_TAB_LABELS` (~369) to the five labels;
- change the "6 tabs" / "exactly 6" titles to 5.

`table-layout-quality.spec.ts`:
- delete the Breakdown `TABLES` entry (~99-111);
- drop "Breakdown" from the comments at ~9, 37, 160 and 332;
- `TABLES[0]` stays Insights, and no other index is referenced.

`touch-action-vertical-scroll.spec.ts`: delete the Breakdown table entry (~42).

Commit (stage by path only, including the three `git rm` paths): `refactor(quick-261024-jvv): remove the event Breakdown tab`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event 'apps/web/src/routes/event.$eventKey.test.tsx' apps/web/src/lib/searchParams.test.ts apps/web/src/lib && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && test "$(grep -rniE 'breakdowntab|breakdown-|breakdown_' apps/web/src apps/web/e2e apps/web/playwright.config.ts | grep -vE 'score_breakdown|algorithms/breakdown|apps/web/src/routes/districts\.' | wc -l)" = "0" && echo GATE-OK</automated>
  </verify>
  <done>BreakdownTab.tsx, BreakdownTab.test.tsx and breakdown-desktop-overflow.spec.ts are gone. EVENT_TABS and REGISTERED_EVENT_TABS each hold five ids. The tab strip renders five tabs. `?tab=breakdown` renders the Insights panel. `publishesComponentMetrics` is deleted if it had no production caller. Vitest, the web typecheck and the e2e typecheck pass. The breakdown grep gate prints GATE-OK. Exactly one commit, containing only this task's paths.</done>
</task>

<task type="auto">
  <name>Task 2: Rename Insights to Teams: tab id, label, file, identifiers, test ids, links and e2e</name>
  <files>apps/web/src/components/event/InsightsTab.tsx, apps/web/src/components/event/TeamsTab.tsx, apps/web/src/components/event/InsightsTab.test.tsx, apps/web/src/components/event/TeamsTab.test.tsx, apps/web/src/routes/event.$eventKey.tsx, apps/web/src/routes/event.$eventKey.test.tsx, apps/web/src/lib/searchParams.ts, apps/web/src/lib/searchParams.test.ts, apps/web/src/components/team/EventSection.tsx, apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/event/RankDistributionTable.tsx, apps/web/src/components/teams-table/columns.tsx, apps/web/src/components/ribbon/AlgorithmSelect.tsx, apps/web/src/test/helpers.ts, apps/web/e2e/event-scroll-regions.spec.ts, apps/web/e2e/table-layout-quality.spec.ts, apps/web/e2e/touch-action-vertical-scroll.spec.ts, apps/web/e2e/tab-strip-trigger-sizing.spec.ts, apps/web/e2e/event-live-artifact.spec.ts, apps/web/e2e/event-page.spec.ts</files>
  <read_first>
    - apps/web/src/lib/searchParams.ts: the DISTRICT_TABS doc comment just below EVENT_TABS. It is the precedent wording for a default tab whose id was renamed.
    - apps/web/src/components/team/EventSection.tsx around line 129
    - `grep -rn -i "insights" apps/web/src apps/web/e2e`: the full hit list. Skip `components/districts/`, `routes/districts.*`, `workers/districtPickDraftPaths.test.ts` and `e2e/districts-ledger.spec.ts`. Those use the district artifact's own `insights` field or the Locks page's former Insights tab, and they are out of scope.
  </read_first>
  <action>
Per LD-2. File renames first, with `git mv`: InsightsTab.tsx becomes TeamsTab.tsx, and InsightsTab.test.tsx becomes TeamsTab.test.tsx, both in apps/web/src/components/event. Then edit. When the edits are done, run `git status` BEFORE committing. Unstaged edits to a renamed file are easy to lose, so stage the renamed paths again after editing.

Identifier renames inside TeamsTab.tsx, then every importer:

| Old | New |
|-----|-----|
| InsightsTab | TeamsTab |
| InsightsTabSkeleton | TeamsTabSkeleton |
| InsightsTabProps | TeamsTabProps |
| buildInsightsRows | buildTeamsRows |
| buildInsightsColumns | buildTeamsColumns |
| InsightsRow | TeamsRow |
| InsightsRowBase | TeamsRowBase |
| InsightsRowModel | TeamsRowModel |
| InsightsOrderSource | TeamsOrderSource |
| InsightsNotice | TeamsNotice |
| insightsNoticeFor | teamsNoticeFor |
| insightsFallbackNotice | teamsFallbackNotice |
| insightsLiveNotice | teamsLiveNotice |
| insightsPreEventNotice | teamsPreEventNotice |
| insightsAwaitingOfficialNotice | teamsAwaitingOfficialNotice |
| INSIGHTS_RP_DECIMALS | TEAMS_RP_DECIMALS |
| INSIGHTS_SKELETON_ROW_COUNT | TEAMS_SKELETON_ROW_COUNT |

Rename test-local helpers the same way, for example `renderInsights` becomes `renderTeams` and `fullInsightsMetrics` becomes `fullTeamsMetrics`.

Test ids in TeamsTab.tsx:

| Old | New |
|-----|-----|
| insights-fallback-banner | teams-fallback-banner |
| insights-pending-banner | teams-pending-banner |
| insights-live-banner | teams-live-banner |
| insights-table-scroll | teams-table-scroll |
| insights-header-* | teams-header-* |
| insights-row | teams-row |
| insights-cell-* | teams-cell-* |

The route's `insights-panel` becomes `teams-panel`. The `teams-table-scroll`, `teams-row`, `teams-header-*` and `teams-cell-*` ids are also used by the `/teams` page's TeamsTable. The two tables never share a page, so this is not a DOM collision. Do NOT merge, dedupe or reorder the `/teams` entries in e2e specs that list both tables. In particular, the per-URL `TABLES` entries in table-layout-quality.spec.ts stay separate.

User-facing copy is unchanged apart from the tab label. Every banner sentence keeps its exact text.

searchParams.ts:
- set `EVENT_TABS` to ["teams", "quals", "alliances", "elims", "simulation"] and `DEFAULT_EVENT_TAB` to "teams";
- rewrite the two doc comments so they name the Teams tab;
- in the `DEFAULT_EVENT_TAB` comment, record the rename the way the DISTRICT_TABS comment records the Locks rename: the `.catch(DEFAULT_EVENT_TAB)` lands every retired link on the Teams panel, so no shared link breaks;
- put each retired id on its own comment line that contains the word "retired", for example a line saying that retired id `insights` was renamed to `teams` and a line saying that retired id `breakdown` was removed, both in quick task 261024-jvv;
- the `EventSearchSchema` comment now says the Teams tab (Task 3 rewrites that sentence).

searchParams.test.ts: replace every `"insights"` expectation with `"teams"`, and change the "falls back to insights" title. Add a local `RETIRED_EVENT_TAB_IDS` const holding the two retired ids. The Task 1 retired-breakdown case becomes an `it.each` over that const asserting each parses to `"teams"`.

Route: import TeamsTab and TeamsTabSkeleton from `../components/event/TeamsTab.js`. Rename `renderInsightsContent` to `renderTeamsContent`. Change the REGISTERED_EVENT_TABS entry, the TabsTrigger value and its label text ("Teams"), and the TabsContent value and testid. Update any comment saying Insights.

Route test:
- every `insights` tab id, `"Insights"` trigger name, `insights-*` testid and title becomes the Teams equivalent;
- the TabCase union and TAB_CASES use teams with triggerName "Teams" and scrollTestId "teams-table-scroll";
- the otherTab/startTab toggle is teams/quals;
- the five-tab order is Teams, Qualifications, Alliances, Playoffs, Simulation;
- `DEFAULT_EVENT_TAB` is `"teams"`;
- the retired-breakdown test becomes an `it.each` over a local `RETIRED_EVENT_TAB_IDS` (insights, breakdown) asserting `/event/2024casf?algorithm=spr&tab=<id>` renders `teams-panel` visible. Keep the word "retired" in the title.

EventSection.tsx line ~129: `tab: "teams"`.

Comments in AlliancesTab.tsx (~297, 737, 747), RankDistributionTable.tsx (~155, 165), teams-table/columns.tsx (~35, 49, 54, 71, 87, 104, 394), AlgorithmSelect.tsx (~14) and test/helpers.ts (~23, 62): rename Insights/InsightsTab/buildInsightsColumns to the event Teams tab / TeamsTab / buildTeamsColumns.

e2e:
- event-scroll-regions.spec.ts: map key and `TABS` entry `teams`, `teams-table-scroll`, the E3 describe title, `eventUrl(..., "teams")`, `teams-row`, `teams-header-*`, the first EXPECTED_TAB_LABELS entry "Teams", and every `eventUrl(STRUCTURAL_EVENT_KEY, "insights")`;
- table-layout-quality.spec.ts: the TABLES[0] entry (name, `?tab=teams`, region/header/cell/row ids) and the comments that say Insights;
- touch-action-vertical-scroll.spec.ts: lines ~40-41 (`tab=teams`, name "Teams tab table", `teams-table-scroll`);
- tab-strip-trigger-sizing.spec.ts ~21: `tab=teams`;
- event-live-artifact.spec.ts: titles, `?tab=teams`, and the `teams-fallback-banner` / `teams-row` ids;
- event-page.spec.ts ~21-37: `TeamsTab.tsx`, `teams-row`.

Commit (stage by path: both renamed pairs plus every edited file): `refactor(quick-261024-jvv): rename the event Insights tab to Teams`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event 'apps/web/src/routes/event.$eventKey.test.tsx' apps/web/src/lib/searchParams.test.ts apps/web/src/lib apps/web/src/components/team && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && test "$(grep -rniE 'insights|breakdowntab|breakdown-|breakdown_' apps/web/src apps/web/e2e apps/web/playwright.config.ts | grep -vE 'apps/web/src/components/districts/|apps/web/src/routes/districts\.|apps/web/src/workers/districtPickDraftPaths\.test\.ts|apps/web/e2e/districts-ledger\.spec\.ts|score_breakdown|algorithms/breakdown' | grep -vi 'retired' | wc -l)" = "0" && echo GATE-OK</automated>
  </verify>
  <done>TeamsTab.tsx and TeamsTab.test.tsx exist as git renames. The InsightsTab files are gone. The strip's first tab reads "Teams" with id `teams` and is the default. The retired `?tab=insights` and `?tab=breakdown` both render `teams-panel`. The team page's event link carries `tab: "teams"`. Vitest, the web typecheck and the e2e typecheck pass. The full gate prints GATE-OK. `git status` was checked before the commit, and the commit holds only this task's paths.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Sortable column headers on the event Teams table (local state), plus final gates</name>
  <files>apps/web/src/components/event/TeamsTab.tsx, apps/web/src/components/event/TeamsTab.test.tsx, apps/web/src/routes/event.$eventKey.test.tsx, apps/web/src/lib/searchParams.ts</files>
  <read_first>
    - Load `Skill("sketch-findings-sigmascout")` before touching the table header UI.
    - apps/web/src/components/teams-table/TeamsTable.tsx lines 214-270: the button-in-th, aria-sort and accent glyph affordance to copy. Its button className, the glyph span's `aria-hidden` and accent class, and its `aria-sort` derivation are the reference.
    - BreakdownTab.tsx was deleted in Task 1. If its old click handler and visible-key fallback are wanted as reference, read them with `git show 509f9764:apps/web/src/components/event/BreakdownTab.tsx` (the pre-plan base, where the file still exists), lines ~111-125 and ~434-483. The idea to keep: the click handler computes from the EFFECTIVE sort, never the raw state.
    - apps/web/src/components/event/TeamsTab.tsx: the header row render (~592-617) and the component body (~521-545)
  </read_first>
  <behavior>
    Pure layer, exported from TeamsTab.tsx:
    - sortTeamsRows on total, descending: rows ordered by the Total value high to low; a row with no Total sorts last; two equal values come out in ascending team number order.
    - sortTeamsRows on total, ascending: low to high, and the row with no Total is STILL last.
    - sortTeamsRows on rank, ascending and descending: rows ordered by displayRank; an unranked row (displayRank undefined) is last in both directions.
    - sortTeamsRows on rp, descending: a real 0 sorts before a row with rp undefined.
    - sortTeamsRows on a phase metric key such as phaseAuto: orders by that metric's value with the same three rules.
    - sortTeamsRows never mutates its input array.
    - nextTeamsSort(null, "rank") gives rank ascending. nextTeamsSort(null, "rp") and nextTeamsSort(null, "phaseAuto") give descending. From total descending, clicking "total" gives total ascending. From rank ascending, clicking "rank" gives rank descending. From total descending, clicking "rank" gives rank ascending.
    - effectiveTeamsSort(sort, visibleIds) returns null when sort is null or its key is not in visibleIds, and returns sort unchanged otherwise.
    Rendered table:
    - Default render: row order identical to buildTeamsRows order. Exactly six columnheaders contain a button: rank, rp, total, phaseAuto, phaseTeleop, phaseEndgame. Each carries aria-sort "none". The teamNumber, nickname and record headers contain no button and carry no aria-sort. No ▲ or ▼ glyph is present. Header textContent is unchanged, so the existing nine-header tests pass untouched.
    - Click the Total header button: rows reorder by Total descending, the total header's aria-sort is "descending" and shows ▼, and every other sortable header reads "none". Click it again: "ascending" and ▲.
    - After sorting by Total so that team 254 (official rank 1) no longer leads, its rank cell (`teams-cell-rank` in its row) still reads 1.
    - Fallback-mode fixture (no ranks, a played qm match, no standings marker): after a sort, the fallback banner still renders, and each row's rank cell keeps its fallback position number.
    - Route level: on `/event/2024casf?algorithm=spr&tab=teams`, clicking a sortable header re-sorts the rows. The router's location search still has `tab` "teams" and has no `sort` or `sortDir` key, so the sort is not in the URL.
  </behavior>
  <action>
Per LD-3. RED first: write the behavior cases above into TeamsTab.test.tsx under a new describe "TeamsTab — column sorting (quick 261024-jvv)", and the route-level case into event.$eventKey.test.tsx. Use `fireEvent.click` from `@testing-library/react`, the established pattern in TeamsTable.test.tsx; add no new dependency. Run them and confirm they fail.

Delete the existing test "no columnheader contains a button, and no header carries aria-sort" (~1148 in the renamed file). It asserts the opposite of LD-3. The new default-render case replaces it.

GREEN, in TeamsTab.tsx:

1. Add exported types `TeamsSortDir` ("asc" or "desc") and `TeamsSort` (readonly key: string, readonly dir: TeamsSortDir). Sort state is `useState<TeamsSort | null>(null)`, where null means the default order, the one `buildTeamsRows` returns.

   This is Claude's discretion, and the reasons are:
   - LD-3 says the first click on Rank applies ascending, which presumes Rank is not already the active column on arrival;
   - the default order mixes official rank and the fallback Total order, depending on the event;
   - the default state then paints no glyph inside the narrow 56px Rank column.

2. Export `TEAMS_SORTABLE_COLUMN_IDS`: "rank", "rp", "total", then every `METRIC_GROUPS` entry's `metricKey`, in that constant's own order. Never retype the metric keys as literals. The Total column's id is the literal "total" (see buildTeamsColumns), and its value lives at `row.metrics[TOTAL_KEY]`.

3. Export `teamsSortValue(row, columnId)`:
   - "rank" returns `row.displayRank`;
   - "rp" returns `row.rp`;
   - "total" returns `row.metrics[TOTAL_KEY]?.value`;
   - any other id returns `row.metrics[columnId]?.value`.

4. Export `sortTeamsRows(rows, sort)`. It is pure and copies its input. It applies the three rules:
   - a row missing the value sorts last whatever the direction;
   - otherwise compare by direction;
   - an exact tie breaks on the module's existing `byTeamNumberAscending`.

5. Export `nextTeamsSort(current, columnId)`. If the current key equals the clicked id, toggle the direction. Otherwise apply the natural direction: ascending for "rank", descending for every other id.

6. Export `effectiveTeamsSort(sort, visibleIds)`. It returns null when the key is not visible. This is the in-place algorithm-switch rule LD-3 carries over from Breakdown. The column set is algorithm independent today, so this guard is defensive, and the pure test is what proves it.

7. In `TeamsTab`, add `useState` to the react import. Keep the existing `useMemo` around `buildTeamsRows` untouched, along with `orderSource` and `teamsNoticeFor`, so the banner logic cannot change. Then:
   - compute the visible ids from the built columns (`table.getAllLeafColumns()` or the `columns` array ids) intersected with TEAMS_SORTABLE_COLUMN_IDS;
   - derive `activeSort` with effectiveTeamsSort;
   - derive `sortedRows` in a `useMemo`: `rows` when activeSort is null, otherwise `sortTeamsRows(rows, activeSort)`;
   - pass `sortedRows` as `useTable`'s `data`.

   `displayRank` is computed inside buildTeamsRows before any user sort, so the Rank cells keep their official or fallback numbers by construction. Do not recompute it.

8. In the header row, for each header:
   - `isSortable` is true when the visible sortable set contains the column id;
   - `isActive` is true when `activeSort?.key` equals the column id;
   - `aria-sort` on the TableHead is undefined for a column that is not sortable, otherwise "ascending" or "descending" when active, and "none" when inactive.

   A sortable header renders TeamsTable's exact button: `type="button"`, plain string className `tap-target inline-flex items-center gap-[var(--spacing-xs)]`. The onClick sets the state to nextTeamsSort(activeSort, id), always computed from activeSort and never from the raw state. The button contains the FlexRender header and, only when active, an `aria-hidden="true"` span with className `text-[var(--color-accent)]` holding ▲ for ascending or ▼ for descending.

   A non-sortable header keeps the bare FlexRender it has today. Keep the th className `text-role-label truncate`, its style object, its `teams-header-<id>` testid and the trailing aria-hidden filler th unchanged.

   Keep classNames as plain strings: do not pass a text-role class through `cn()` beside a `text-[var(...)]` class. The skeleton keeps plain headers with no buttons and no aria-sort.

9. Update TeamsTab.tsx's module header doc comment with a short sorting paragraph covering:
   - which six columns sort, and that Team #, Team Name and Record do not;
   - local state by decision, never a URL param;
   - null means the buildTeamsRows order;
   - the natural directions;
   - the three ordering rules;
   - the effective-sort fallback;
   - that a re-sort never recomputes displayRank.

searchParams.ts: rewrite the `EventSearchSchema` doc comment. It must now say the event Teams tab's headers DO re-sort its table, but by decision (quick task 261024-jvv) that sort is local component state, a transient reading posture and not a shareable view, so `sort`/`sortDir` are deliberately NOT extended here.

REFACTOR only if needed, with tests green.

Final gates (all from the repo root):
- the vitest command below;
- the root typecheck `npx tsc --noEmit`, then `npx tsc --noEmit -p apps/web/tsconfig.json`, then `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`;
- the full grep gate.

If the root typecheck reports errors ONLY in files this plan never touched, for example the concurrent session's `apps/worker/*` or `packages/core/algorithms/cancelledEvent.ts` edits, do not edit those files and do not wave the errors away. Record each error with its file path in the SUMMARY under "Typecheck findings outside this task", and attribute it by path. Any error inside an apps/web file must be fixed.

Commit (stage by path): `feat(quick-261024-jvv): sortable column headers on the event Teams table`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event 'apps/web/src/routes/event.$eventKey.test.tsx' apps/web/src/lib/searchParams.test.ts apps/web/src/lib && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit && test "$(grep -rniE 'insights|breakdowntab|breakdown-|breakdown_' apps/web/src apps/web/e2e apps/web/playwright.config.ts | grep -vE 'apps/web/src/components/districts/|apps/web/src/routes/districts\.|apps/web/src/workers/districtPickDraftPaths\.test\.ts|apps/web/e2e/districts-ledger\.spec\.ts|score_breakdown|algorithms/breakdown' | grep -vi 'retired' | wc -l)" = "0" && echo GATE-OK</automated>
  </verify>
  <done>Every behavior case passes. On the Teams tab, the six sortable headers are buttons with aria-sort, and the three identity and record headers are not. The first click applies the natural direction and a second click toggles it. Missing values sort last and ties break by team number. Rank cells keep their published or fallback numbers. The banners are unchanged and the URL carries no sort. The EventSearchSchema comment states the local-sort decision. All three typechecks pass, or any red outside apps/web is recorded by file path in the SUMMARY. The grep gate prints GATE-OK. One commit.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL search to router | `?tab=` is reader-controlled; a retired or hostile value must never open an empty or disabled panel |
| Published event artifact to DOM | nickname, event name and key strings render in the Teams table |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261024-jvv-01 | Tampering | EventSearchSchema `tab` | low | mitigate | `z.enum(EVENT_TABS).catch(DEFAULT_EVENT_TAB)` is kept unchanged. The retired-id tests in searchParams.test.ts and the route test prove that `insights`, `breakdown` and bogus values all land on `teams` |
| T-261024-jvv-02 | Information disclosure / XSS | TeamsTab header buttons and cells | low | accept | No new sink: sort buttons render FlexRender headers, and artifact strings stay plain JSX text nodes or `title` values, exactly as today |
| T-261024-jvv-03 | Denial of service | sortTeamsRows | low | accept | It sorts 20 to 80 rows in a useMemo keyed on rows and sort, so its cost is negligible |
</threat_model>

<verification>
- After each task, its own verify command passes, run from the repo root.
- After Task 3, the root, web and e2e typechecks are run, and the full grep gate prints GATE-OK.
- `git log --oneline -3` shows the three quick-261024-jvv commits. `git status` shows the concurrent session's files still unstaged and untouched.
- Playwright is NOT run (LD-4).
</verification>

<success_criteria>
- The Breakdown tab, its component, its unit tests and its e2e spec are gone, and `packages/core/algorithms/breakdown/` is untouched (LD-1).
- The Teams tab is the default, with id `teams` and label "Teams", and retired links resolve to it (LD-2).
- The Teams table sorts on Rank, RP, Total, Auto, Teleop and Endgame with local state, natural first-click directions, a toggle on the active column, missing values last, team-number tie breaks, and stable Rank cells (LD-3).
- Every verification command passes as LD-4 specifies.
</success_criteria>

<output>
Do NOT write the SUMMARY.md file and do not use a heredoc. Return the full SUMMARY.md content (standard summary template, frontmatter included) as your final text message. The orchestrator writes it to `.planning/quick/261024-jvv-event-page-remove-the-breakdown-tab-rena/261024-jvv-SUMMARY.md`.

The SUMMARY must include:
- the three commit hashes;
- whether `publishesComponentMetrics` was deleted;
- any "Typecheck findings outside this task", by file path;
- this post-deploy note for Jacob. The live e2e specs now target `?tab=teams` and the `teams-*` ids, so they stay red until the web deploy ships; rerun them after it. On a 390px phone, check the Rank header after clicking it. The narrow Rank column is 56px, while the sort button's `tap-target` is at least 44px wide and adds the glyph to the label. So "RANK ▲" may clip, and so may "SPR RANK ▲" in the 96px fallback-mode column. This is a visual check only, and no change is planned.
</output>
