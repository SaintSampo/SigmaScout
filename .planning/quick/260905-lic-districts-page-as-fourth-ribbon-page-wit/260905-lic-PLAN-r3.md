---
quick_id: 260905-lic
type: execute
mode: quick-revision
revises: 260905-lic-PLAN-r2.md
autonomous: true
---

# Revision R3: Insights + Breakdown become algorithm-scoped (VPR/OPR/EPA); points detail folds into Locks as expandable columns

User correction after R2: "the district insights and breakdown tables are now for district
points. they are for VPR/opr/epa." The Locks tabs own the district-points story; Insights and
Breakdown must show the site's prediction metrics for the district's teams, following the
ribbon's algorithm dropdown exactly as the event page does.

## User decisions (locked, from AskUserQuestion)

1. **Insights** = rank + metrics join, mirroring the event Insights tab: district teams in
   DISTRICT-POINTS rank order; columns Rank, Team #, Team Name, District Points, then the
   selected algorithm's Total / Auto / Teleop / Endgame, metric columns tier-boxed.
2. **Breakdown** = the event page's Breakdown pattern over the district roster: per-team
   metric components, grouped phase columns that expand in place, sortable headers, tier
   boxes, no rank column. OPR stays flat Total-only (standing user decision).
3. **Points detail** folds into BOTH Locks tabs as COLUMNS, explicitly NOT expandable
   dropdown rows: default columns stay as they are today (rank, team, current points, max
   attainable, status, sent by, points still needed); a single toggle button adds the
   per-event point-component columns (per district event the team played: qual / alliance /
   playoff / award, plus rookie bonus and adjustments) in place. "Only show the most
   important columns by default, let the user hit a button to expand the number of columns."

## Scope: apps/web ONLY

Data: no pipeline/publish change. The algorithm metrics come from the already-published
algorithm-scoped teams artifact (the Teams page's own fetcher in `apps/web/src/lib/api/teams.ts`,
which goes through `useAlgorithmVersion`), joined client-side against the district detail
artifact's roster team keys. District points, per-event components, rank all already live on
the district artifact.

## Files

apps/web/src/routes/districts.tsx (+ test), apps/web/src/components/districts/
DistrictInsightsTab.tsx (rewrite), DistrictBreakdownTab.tsx (rewrite),
DistrictLocksTab.tsx (+ test), plus any new small shared module + tests.

## Read first

- apps/web/src/components/event/InsightsTab.tsx — the rank+metrics join pattern to mirror
  (pinned columns, tier boxes via tierForPercentile, TierKeyRow, D-5 Total-leads order).
- apps/web/src/components/event/BreakdownTab.tsx — the grouped/expandable metric columns
  pattern (METRIC_GROUPS, withDerivedGroupMetrics, hasGroupedTeamsView, sort rules,
  column pinning registered locally).
- apps/web/src/lib/api/teams.ts — the algorithm-scoped teams artifact fetcher to reuse.
- apps/web/src/routes/event.$eventKey.tsx — how algorithm-scoped tabs coexist with
  renderTabState.

## Requirements

- Both new tabs follow the ribbon's algorithm and year; changing either updates them.
  District detail fetch stays algorithm-independent (locks/points don't vary by algorithm).
- Insights rank column = district-points rank (from the district artifact), labeled so a
  reader knows it is the district standings rank, not a metric rank. Teams present in the
  district roster but missing from the teams artifact render with metric cells em-dashed,
  never dropped from the table.
- Breakdown roster = district roster; reuse (or mirror faithfully) the event BreakdownTab's
  grouped-columns construction, including the OPR flat case and the collapse-resets-sort rule.
  Do NOT import across a module boundary the existing code deliberately keeps local — mirror
  the construction as event/BreakdownTab.tsx itself does relative to teams-table.
- Locks tabs: the toggle adds per-event component columns in place. Wide content scrolls
  within the table container (overflow-x auto) rather than the page. Chronological event
  order; group each event's four components under an event-name band consistent with the
  Breakdown group-band pattern. Include rookie bonus + adjustments in the expanded set.
  Keep every existing default column, chip color, awards column, and header stat untouched.
- DistrictBreakdownTab's old district-points table code is deleted (its content now lives in
  the Locks expanded columns).
- Load Skill("sketch-findings-sigmascout") before writing JSX.

## Verify

- npx vitest run apps/web/src/routes/districts.test.tsx apps/web/src/components/districts/
  apps/web/src/components/ribbon/Ribbon.test.tsx
- Full apps/web suite + pnpm --filter web run typecheck
- sigma1 files untouched; commit by explicit path only (shared index may carry another
  session's staged files — use `git commit -- <paths>`).
