# Deferred Items — Phase 07 (event-pages)

Out-of-scope discoveries logged during execution, per the executor's scope-boundary rule
(fix only what the current task's own changes touch; log everything else here instead).

## RESOLVED — VPR 2026 cold-start extreme outlier (`total: -1354.13`, `hubEndgame: -1141.94 ± 155.53`)

**Discovered during:** G-11 (07-UAT.md), while independently re-confirming the real worst-case
metric-tier content width across every published season/algorithm before deciding whether a
metric column could safely narrow to fit a 94px mobile budget.

**Not fixed here** — this is a modelling/pipeline concern (VPR's cold-start prior for a team with
~0 matches in the barely-started 2026 season), not a layout one, and is outside `columns.tsx`/
`InsightsTab.tsx`'s file ownership. Flagged because it is a real, currently-live number that
already exceeds the previously-accepted worst case (`"284.89 ± 8.75"`, G-10) this site's shipped
`BREAKDOWN_METRIC_COLUMN_WIDTH_PX`/`_TOTAL_` no-clip guarantee was sized against — if this value
renders inside a `.metric-tier` box anywhere (Breakdown, Team page, Teams table, Insights), it will
overflow that box's declared width regardless of this phase's mobile-layout fixes.

**Recommendation:** either bound VPR's published value/spread magnitude for teams with
near-zero season match counts (a pipeline-side fix), or re-measure `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`/
`_TOTAL_PX` against this new worst case once the 2026 season has enough real matches to judge
whether it is a transient cold-start artifact or a durable one.

## RESOLVED — G-2 part 2 still RED on `pixel-10` (312px scroller) for Insights and TeamsTable

**Discovered during:** G-7 (Breakdown desktop-overflow fix, `apps/web/e2e/table-layout-quality.spec.ts`
regression check against the deployed origin, 2026-08-30).

**Not touched by G-7** — `InsightsTab.tsx` and `TeamsTable.tsx` are outside this task's file
ownership (`BreakdownTab.tsx` and the event route container only).

`table-layout-quality.spec.ts`'s "G-2 part 2 — at least one full data column visible at scroll 0"
suite fails on the `pixel-10` project (312px scroller) for **Insights** and **TeamsTable**, both
reporting `0 of N data columns fully visible` (`Insights (2023cur, widest real roster)`:
0 of 5, 94.0px total visible; `TeamsTable (2024 season)`: 0 of 16, 94.0px total visible).
The identical assertion for **Breakdown** passes on both `pixel-10` and `phone-390`.

Reproduced twice with `--retries=2` (not a flake) directly against the currently-deployed origin
(`https://sigmascout.org`), independent of any commit in this task.

07-UAT.md's own G-2 entry is recorded as `status: fixed, pending live re-verification` — its
verification narrative only claims RED-then-GREEN confirmation at 390px
(`phone-390`)/`pixel-10`'s 312px width was named as ALSO proven RED pre-fix, but the entry never
records a GREEN confirmation specifically at 312px. This live failure suggests that confirmation
either never happened or the fix (`NICKNAME_COLUMN_WIDTH_NARROW_PX = 90`, chosen against the
390px/342px-scroller binding constraint) does not clear TeamsTable's/Insights' own binding
constraint at the narrower 312px scroller Pixel 10 presents.

**Recommendation:** re-open G-2 (or file a new gap) and re-derive
`NICKNAME_COLUMN_WIDTH_NARROW_PX`/`RANK_COLUMN_WIDTH_NARROW_PX`/`TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`
against the tighter 312px scroller as the binding constraint, or confirm 312px is out of this
site's supported viewport range if it is not.

**Resolved by 07-UAT.md G-11**: `nickname`/`rank`/`teamNumber` were not the binding constraint after
all (they already fit) — the column immediately following them (Insights' `record`, TeamsTable's
first metric column) was too wide for the 94px `pixel-10` budget. Fixed via a new
`RECORD_COLUMN_WIDTH_NARROW_PX` (80px) plus a narrow-only reorder in `TeamsTable`'s `buildColumns`
that puts `record` ahead of the metric columns. See G-11 for the full arithmetic and why the
metric-tier column itself could not be narrowed instead.
