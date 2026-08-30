# Deferred Items — Phase 07 (event-pages)

Out-of-scope discoveries logged during execution, per the executor's scope-boundary rule
(fix only what the current task's own changes touch; log everything else here instead).

## G-2 part 2 still RED on `pixel-10` (312px scroller) for Insights and TeamsTable

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
