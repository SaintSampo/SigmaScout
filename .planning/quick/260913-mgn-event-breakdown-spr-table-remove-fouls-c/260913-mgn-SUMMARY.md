---
phase: 260913-mgn-event-breakdown-spr-table-remove-fouls-c
plan: 01
subsystem: web-event-breakdown-tab
tags: [breakdown-tab, spr, metric-keys, sorting]
requires: []
provides:
  - "lib/metricKeys.ts publishesComponentMetrics(algorithmId): true for epa only"
  - "event Breakdown tab: SPR six-column shape (no Fouls Committed, no phase toggles, no band row)"
affects:
  - "apps/web/src/routes/event.$eventKey.tsx (BreakdownTab consumer, unmodified; its route test updated)"
tech-stack:
  added: []
  patterns:
    - "activeSort derivation (visible-key fallback to DEFAULT_BREAKDOWN_SORT) guards stale sort state across an in-place algorithm switch"
key-files:
  created: []
  modified:
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/lib/metricKeys.test.ts
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/BreakdownTab.test.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx
decisions:
  - "publishesComponentMetrics is a new predicate distinct from hasGroupedTeamsView: SPR keeps its phase columns and sort buttons (hasGroupedTeamsView true) but is not expandable (publishesComponentMetrics false), because its event artifacts publish no per-team components to expand into."
  - "activeSort (sort when its key is visible, else DEFAULT_BREAKDOWN_SORT) replaces raw sort state everywhere sort is read, so a sort key that disappears after an in-place algorithm switch or a group collapse never silently persists."
  - "Desktop identity header labels (Team #, Team Name) sit in the sort buttons' own 44px centered box without being buttons, so the label row lines up now that it is the table's top edge under SPR."
metrics:
  completed: "2026-09-13"
actuals:
  tasks: 2
  commits: 6
status: complete
---

# Quick Task 260913-mgn: SPR event Breakdown drops Fouls Committed and the phase toggles

Under SPR the event Breakdown tab now renders exactly six columns (Team #, Team Name, Total ± Sigma, Auto, Teleop, Endgame). It has one header row, no Auto, Teleop or Endgame expand buttons, and no always-blank Fouls Committed column. Every metric header is still a sort button, and the table lands on Total descending. EPA keeps its toggles, in-place expansion and trailing Fouls Committed column. OPR is unchanged.

Developer request, verbatim: "on an event breakdown page, for SPR, remove the fouls committed column. Remove the Auto ▸ Teleop ▸ Endgame ▸ buttons, they make no sense, SPR does not expand. make sure the table looks clean after you remove those things."

## Commits

| Commit | What |
|--------|------|
| 0bd3c11f | test: failing pins for the SPR Breakdown six-column shape |
| a013ca1e | feat: SPR Breakdown shows Total and the three phases only, no Fouls Committed column and no phase toggles |
| d3d5c46d | test: pin SPR Breakdown geometry, skeleton headers and the in-place algorithm switch |
| 85f76a32 | fix: Breakdown falls back to Total when the sort column is no longer visible; docs describe the three table shapes |
| 96deb3e7 | test (orchestrator): event route pins the SPR six-column Breakdown and moves the season-follows-artifact check to EPA expansion |
| 79c6bf9c | fix (orchestrator): Team # and Team Name labels line up with the sort headers on desktop |

## What was built

**lib/metricKeys.ts.** New `publishesComponentMetrics(algorithmId)` returns true for `epa` only. SPR's phase components are display-only, and its event artifacts publish only `total`, `phaseAuto`, `phaseTeleop` and `phaseEndgame` (plus `sigma`), so expansion there would reveal only empty columns. `hasGroupedTeamsView` is unchanged; the Teams list and routes/teams.tsx still read it.

**components/event/BreakdownTab.tsx.**
- `visibleMetricKeys` has three branches: OPR returns Total only; SPR returns Total plus the three phase keys and never reads `expanded`; EPA is unchanged (phases, expansion, trailing ungrouped components).
- The group band row (`breakdown-group-row`) and `ungroupedCount` are gated on `publishesComponentMetrics`; sort buttons stay on `hasGroupedTeamsView`.
- `activeSort` falls back to Total descending whenever the stored sort key is not visible. The event route keeps the previous artifact on screen during an algorithm switch, so BreakdownTab stays mounted with its old state. Without the fallback, an EPA table sorted by a component column stayed sorted by that invisible column after switching to SPR.
- Desktop Team # and Team Name labels now sit in the sort buttons' own box (`tap-target inline-flex items-center`, not a button). See the visual check below.
- Doc comments describe the three shapes.

**Tests.**
- metricKeys.test.ts has equality pins for the predicate.
- BreakdownTab.test.tsx:
  - Adds SPR six-column and EPA seven-column pins, and unit pins for the three `visibleMetricKeys` branches.
  - Retargets the expansion tests to EPA with their assertions verbatim: the toggle swap, the partial-data blank cell, collapse resets sort, both derived-phase fallbacks, and 260913-m9m's two no-sticky tests.
  - Adds SPR and EPA desktop geometry pins, the in-place EPA-to-SPR switch, SPR and EPA skeleton headers, and the header-box alignment pin.
- event.$eventKey.test.tsx: its "seven collapsed-default columns" case was loaded under SPR. It is now two cases: an SPR route-level pin of the six ids, and an EPA case that expands Auto and pins the 2024 auto components in place. That second case is a real check that the column set follows artifact.season, not ?year=.

## RED evidence

- Task 1: 3 of 58 scoped tests failed for the expected reasons. `publishesComponentMetrics` was not a function, the SPR render had 7 header ids instead of 6, and the SPR unit pin received the component keys. The retargeted EPA tests already passed, since they describe unchanged behaviour.
- Task 2: the in-place switch test failed with `expected [2, 1] to deeply equal [1, 2]`, because the stale teleop sort survived the switch. The geometry and skeleton pins already passed after Task 1, so they are regression pins, not RED.
- Header alignment (orchestrator): the new pin failed with `expected [] to deeply equal [ 'tap-target', 'inline-flex', 'items-center' ]` before the fix.

## Verification

- `cd apps/web && npx vitest run src/components/event src/lib/metricKeys.test.ts src/routes/event.$eventKey.test.tsx`: 20 files, 552 tests passed (after the last commit).
- `npx tsc --noEmit -p apps/web`: clean (after the last commit).
- Root `npx vitest run` (executor, before the orchestrator fixes): 5441 tests, 5439 passed, 1 skipped, 1 failed. The failure was event.$eventKey.test.tsx asserting 7 SPR columns, which this task changed on purpose; fixed in 96deb3e7. The executor also saw a transient `niceYAxis` type error in MetricHistoryChart.tsx from another session's in-flight edit; the orchestrator's later web typecheck was clean.
- e2e: no spec in apps/web/e2e references the band row, the phase toggles or Fouls Committed. breakdown-desktop-overflow.spec.ts uses `algorithm=vpr`, which already falls back to SPR; its assertions are upper bounds, and this change only narrows the table. No spec was edited or run.

## Visual check (orchestrator, local dev server on live artifacts, 2026alhu)

DOM facts:
- SPR desktop: header ids teamNumber, nickname, total, phaseAuto, phaseTeleop, phaseEndgame. There is one thead row, no toggles and no sticky cells. The table is 792px inside a 794px card with no scroll, and aria-sort is descending on Total.
- SPR phone-390: the same six columns in a 646px table that scrolls inside a 342px card.
- EPA desktop and phone: the band row and three toggles are still there, plus Fouls Committed.
- In-place switch: EPA with Teleop expanded and sorted by Hub Transition, switched to SPR through the ribbon, landed on the six SPR columns sorted by Total descending.

The first SPR desktop screenshot showed one flaw. With the band row gone, the label row is the table's top edge, and the bare, top-aligned Team # and Team Name labels sat about 14px above the other labels, which are centered in 44px sort buttons. EPA had the same offset, hidden under its band row. This was fixed in 79c6bf9c, and the re-shot desktop tables for SPR and EPA show every label on one line.

The Total cells show plain boxes, not the Total ± Sigma pill, because the live 2026alhu event artifact has not been republished with Sigma yet (260913-jkp's republish is owed). That is the designed pre-republish degrade and not part of this task.

## Deviations

1. The orchestrator fixed event.$eventKey.test.tsx (outside the plan's four files): it pinned the old SPR column count.
2. The orchestrator added the desktop header-label alignment fix after the visual check, as part of the request's "make sure the table looks clean".
3. The executor could not append a deviation to .planning/WINDOWS.md because that ledger's frontmatter fails to parse. This is pre-existing and was not repaired.

## Not done

Not pushed. main is shared with other sessions whose commits a push would also deploy.
