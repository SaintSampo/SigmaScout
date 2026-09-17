---
phase: quick
plan: 260917-jaf
subsystem: web-ui
tags: [match-table, event-table, css-grid, theme, e2e]
key-files:
  created: []
  modified:
    - apps/web/src/styles/theme.css
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/team/MatchTable.test.tsx
    - apps/web/src/components/team/matchAxis.ts
    - apps/web/src/components/team/matchAxis.test.ts
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.test.tsx
    - apps/web/e2e/event-scroll-regions.spec.ts
    - apps/web/e2e/zebra-stripe-full-row.spec.ts
decisions:
  - "Predicted RP / Actual RP became Prediction / Actual. The columns never printed an RP total, so the old labels named a quantity the cells do not show."
  - "Both tables read observed before forecast: Match, Result, Actual, rule, Prediction, Confidence, axis, Call. The event table has no Result column and gained none, so Actual sits right of Match there."
  - "MATCH_ROW_GRID (LABEL_H 16, LINE_H 22) is the single source for the three-slot row grid. MATCH_GEOMETRY's PLOT_H, Y_RED and Y_BLUE are derived from it (values unchanged: 60, 23, 45), and CSS reads the same two numbers through custom properties set once on each table."
  - "Result, Confidence and Call centre on the two alliance lines rather than sitting on the match-label line."
commits: [2fd168ac, 224a14c1, 4e08405c, ca39db58, afc747d7]
status: complete
---

# Quick Task 260917-jaf: match tables, new labels, new order, a rule, and one row grid

Scope grew once mid-task: Jacob added "fix the vertical spacing so that an alliance, its
predicted score, actual score/RPs, and match band are all in a horizontal line." The
orchestrator added that as Task 3 of the plan before execution.

## What was built

**Labels and order.** `MatchTable.tsx` reads Match, Result, Actual, Prediction, Confidence,
axis, Call (7 columns). `EventMatchTable.tsx` reads Match, Actual, Prediction, Confidence,
axis, Call (6 columns, `EVENT_MATCH_TABLE_COLUMN_COUNT` still 6). Body cells moved intact
with their testids. `EVENT_MATCH_TABLE_HEADERS` feeds the live header and the skeleton, so
the skeleton followed.

**Rule.** `.match-table-rule` in `theme.css`: a 1px left border in `var(--color-border)` on
the Prediction header and every `predicted-score-` cell in both tables, plus the skeleton
header. Under `borderSpacing: 0` it reads as one line from header to last row.

**Row grid.** The plot was already on the roster lines. The Prediction and Actual cells were
the ones off: their two score lines started at the top of the cell with no offset for the
match-label line, so every score sat one line too high, and the blue score sat level with
the red band. The existing numbers already described a 16 / 22 / 22 grid (that is where
`PLOT_H` 60, `Y_RED` 23 and `Y_BLUE` 45 come from), so that grid became the source:
`MATCH_ROW_GRID` in `matchAxis.ts`, `.match-row-grid` plus `__label`, `__red`, `__blue` and
`__both` slot classes in `theme.css`, and `MATCH_ROW_GRID_STYLE` setting the two custom
properties on each table. Match, Prediction and Actual cells put red in slot 2 and blue in
slot 3. Result, Confidence and Call use the `__both` slot.

**e2e.** `event-scroll-regions.spec.ts` looks up the header as "Actual";
`zebra-stripe-full-row.spec.ts` had a stale comment. Both specs are live-only and were not
run. They are the only changes here that are unverified until a deploy.

## Found after execution, by screenshot

The executor composed the Prediction header's classes with `cn()`. `cn()` runs
tailwind-merge, which reads `text-role-label` and `text-[var(--color-text-muted)]` as one
conflicting group and drops the label class, so the header rendered at body size in primary
ink. The suite was green because no test looked. Fixed in `afc747d7` with plain class
strings on the three header call sites; both component tests now pin `text-role-label` on
that header. The `td` call sites also use `cn()` but carry no `text-*` class, so nothing is
dropped there.

## Verification

- `npx vitest run` from the repo root: 247 of 247 files, 5497 passed, 1 skipped. The first
  pass had one timeout in `MetricHistoryTab.test.tsx`, a file this task does not touch. It
  passed alone and on the full rerun.
- After the header fix: `npx vitest run MatchTable.test`, 2 files, 90 passed.
- `npx tsc --noEmit` at the root and `-p apps/web/tsconfig.json`: both clean.
- No "Predicted RP" or "Actual RP" left under `apps/web/src` or `apps/web/e2e`.
- Measured in Chromium against live 2026casnv data, team 254 and the event quals tab, three
  played rows each. In every row the roster line, predicted score, actual score, band tick
  and actual dot share one vertical centre per alliance, equal to 0.1px (team row 1: red
  706.8 across all five, blue 728.8 across all five). Confidence and Call sit midway between
  the two lines.
- Not pushed, not deployed.

## Deviations

None from the plan. Two test-construction fixes in `EventMatchTable.test.tsx`: the
skeleton-versus-live comparison scopes each render with `within(container)`, and compares
only non-empty skeleton labels since the skeleton never renders `AxisHeader`.

## Note for the next local screenshot

`VITE_ARTIFACT_ORIGIN=` (empty) no longer works as a local proxy recipe: `vite.config.ts`
now uses that same value as the proxy target, and an empty target resolves to
`base.invalid` and every `/v1` request returns 502. This task fulfilled `/v1` requests from
`https://data.sigmascout.org` inside Playwright with `page.route` instead, with no repo
change.
