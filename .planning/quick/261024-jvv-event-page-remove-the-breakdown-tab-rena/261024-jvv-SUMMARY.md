---
phase: quick-261024-jvv
plan: 01
subsystem: web / event page
tags: [event-page, tabs, teams-table, sorting, rename, removal]
status: complete
requires: []
provides:
  - "Event page with five tabs: Teams, Qualifications, Alliances, Playoffs, Simulation"
  - "Sortable Rank, RP, Total, Auto, Teleop and Endgame headers on the event Teams table (local state)"
affects:
  - apps/web/src/components/event/TeamsTab.tsx
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/components/team/EventSection.tsx
tech-stack:
  added: []
  patterns:
    - "Pure sort layer exported beside the component (sortTeamsRows, nextTeamsSort, effectiveTeamsSort), local useState, null means the default order"
key-files:
  created:
    - apps/web/src/components/event/TeamsTab.tsx (git rename of InsightsTab.tsx)
    - apps/web/src/components/event/TeamsTab.test.tsx (git rename of InsightsTab.test.tsx)
  modified:
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/lib/metricKeys.test.ts
    - apps/web/src/components/team/EventSection.tsx
    - apps/web/playwright.config.ts
    - "plus comment and test-id updates in AlliancesTab, RankDistributionTable, columns.tsx, AlgorithmSelect, tabs.tsx, metricLabels.ts, test/helpers.ts and six e2e specs"
  deleted:
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/BreakdownTab.test.tsx
    - apps/web/e2e/breakdown-desktop-overflow.spec.ts
decisions:
  - "LD-1: Breakdown removed outright, EPA component expansion dropped, packages/core/algorithms/breakdown/ untouched"
  - "LD-2: Insights renamed to Teams including the id; retired insights and breakdown links land on Teams through the existing .catch(DEFAULT_EVENT_TAB)"
  - "LD-3: sort is local useState, never a URL param; null means the buildTeamsRows order; arrival state is no column sorted"
metrics:
  tasks: 3
  commits: 3
actuals:
  tokens: 90000
  tasks: 3
  commits: 3
---

# Quick 261024-jvv: Remove Breakdown, rename Insights to Teams, add sortable headers

One event table instead of two: the Breakdown tab is gone, Insights is now the default Teams tab, and its Rank, RP, Total, Auto, Teleop and Endgame headers sort with local state.

## Commits
- `bb299598` refactor: remove the event Breakdown tab
- `629ed18c` refactor: rename the event Insights tab to Teams
- `e4bab555` feat: sortable column headers on the event Teams table

## What changed
1. **Remove Breakdown.** Step 0 scans confirmed the only real importers were the route and BreakdownTab.test.tsx, so nothing was ported. EVENT_TABS and REGISTERED_EVENT_TABS each hold five ids. `publishesComponentMetrics` was deleted (its only callers were BreakdownTab and its own test), along with its test case. Every comment that named Breakdown as live code was rewritten. The breakdown e2e spec, both Playwright testMatch entries, the E4 describe block, the Breakdown TABLES entry and the Breakdown touch-action entry are gone.
2. **Rename Insights to Teams.** `git mv` for the component and its tests. Identifiers, test ids (`teams-*`, `teams-panel`), tab id, label and default tab were all renamed. The retired-id comments live on `DEFAULT_EVENT_TAB`. Retired `insights` and `breakdown` are covered by an `it.each` in searchParams.test.ts and in the route test. `EventSection.tsx` now links with `tab: "teams"`. User-facing banner copy is unchanged.
3. **Sorting.** Exported `TeamsSort`, `TEAMS_SORTABLE_COLUMN_IDS`, `teamsSortValue`, `sortTeamsRows`, `nextTeamsSort` and `effectiveTeamsSort`. Sort state is `useState<TeamsSort | null>(null)`, and the sorted rows feed `useTable`. Headers copy TeamsTable's button, glyph and aria-sort pattern. On arrival no column is marked sorted (all six sortable headers carry `aria-sort="none"` and no arrow) and the table shows the buildTeamsRows order. First click on Rank sorts ascending; first click on any other sortable column sorts descending; clicking the active column toggles. `displayRank` is never recomputed, so Rank cells and banners are unchanged by a re-sort. The EventSearchSchema comment now states the local-sort decision. Team #, Team Name and Record stay plain headers with no aria-sort.

## Verification
- Vitest from the repo root: event components, event route test, searchParams and lib tests all green (final run 55 files / 1016 tests; orchestrator re-ran TeamsTab + route + searchParams: 3 files / 165 tests passed).
- Typecheck: root, apps/web and apps/web/e2e all exit 0.
- Grep gate for surviving `insights` / `breakdown` tab references in apps/web/src and apps/web/e2e (excluding the districts code's legitimate `insights` artifact field and lines marked retired): 0 lines.
- Playwright was NOT run: the e2e suite only runs against the live site.

## Deviations from Plan
None of Rules 1 to 4 applied. Notes on execution:
- Two large edits (the Task 3 test block and implementation) were written through node scripts created with the Write tool because a large Bash heredoc failed to parse on this machine; no edits were lost.
- Task 2 used a sed sweep (Insights to Teams) followed by hand fixes of ambiguous comments, for example "Teams/TeamsTable" became "TeamsTab/TeamsTable" in AlliancesTab.tsx and columns.tsx.
- Planner deviation from the brief, accepted: the arrival state is "no column sorted" rather than "Rank ascending shown", so that the first click on Rank can apply ascending and the existing header-text tests stay unchanged.

## Known Stubs
None.

## Threat Flags
None. T-261024-jvv-01 is mitigated: the `.catch(DEFAULT_EVENT_TAB)` is unchanged, and the retired-id tests prove insights, breakdown and bogus values all land on teams.

## Post-deploy notes for Jacob
- The live e2e specs now target `?tab=teams` and the `teams-*` ids, so they stay red until the web deploy ships. Rerun them after it.
- On a 390px phone, check the Rank header after clicking it. The narrow Rank column is 56px, while the sort button's `tap-target` is at least 44px wide and adds the glyph to the label, so "RANK ▲" may clip, as may "SPR RANK ▲" in the 96px fallback-mode column. Visual check only; no width change was made.
- Test-id collision to know about: after the rename, `teams-table-scroll`, `teams-row`, `teams-header-*` and `teams-cell-*` are the same ids the /teams page's TeamsTable uses. The two tables never share a page, so the DOM is fine, but the entries in `table-layout-quality.spec.ts` must not be merged.

## Self-Check: PASSED
- TeamsTab.tsx and TeamsTab.test.tsx exist as git renames. BreakdownTab.tsx, BreakdownTab.test.tsx and breakdown-desktop-overflow.spec.ts are gone.
- Commits bb299598, 629ed18c and e4bab555 are on main.
- Vitest, all three typechecks and the grep gate are green.
