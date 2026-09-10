---
phase: quick-260909-tiq
plan: 01
subsystem: web-match-page
tags: [match-page, event-page, team-page, routing, robot-grid, pre-match-metrics]
dependency graph:
  requires: [EventMatchTable, team/MatchTable, SeasonHeader Avatar pattern, matchVideo.ts, eventQueryOptions, teamQueryOptions]
  provides: [/match/$matchKey route, lib/matchKey.ts, lib/preMatchMetrics.ts, components/match/MatchRobotGrid.tsx]
  affects: [EventMatchTable.tsx, team/MatchTable.tsx, test/routerHarness.tsx, lib/searchParams.ts]
tech-stack:
  added: []
  patterns: [reuse EventMatchTable for a single-row table, preceding-history-row resolver, useQueries declared above every early return]
key-files:
  created:
    - apps/web/src/lib/matchKey.ts
    - apps/web/src/lib/matchKey.test.ts
    - apps/web/src/lib/preMatchMetrics.ts
    - apps/web/src/lib/preMatchMetrics.test.ts
    - apps/web/src/routes/match.$matchKey.tsx
    - apps/web/src/routes/match.$matchKey.test.tsx
    - apps/web/src/components/match/MatchRobotGrid.tsx
    - apps/web/src/components/match/MatchRobotGrid.test.tsx
  modified:
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.test.tsx
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/team/MatchTable.test.tsx
    - apps/web/src/test/routerHarness.tsx
decisions:
  - "matchKey.ts splits at the FIRST underscore and validates the prefix by delegating to isValidEventKey -- never a second copy of the event-key regex, and deliberately does not parse compLevel/setNumber/matchNumber out of the suffix (the published row already carries those)."
  - "preMatchMetrics never falls back to seasonStats.metrics or the official-match snapshot -- absence renders as absence, never a substituted as-of instant."
  - "MatchRobotGrid is a pure function of its props (no fetching inside it); match.$matchKey.tsx owns the one useQueries hook, declared above every early return so its query-array length can change without changing the hooks count."
  - "The combined as-of line renders only when all six resolved cards agree on basis; on disagreement each card states its own basis inline instead."
actuals:
  tokens: 58000
  tasks: 3
  commits: 3
status: complete
---

# Quick Task 260909-tiq: Match page -- Summary

Added a `/match/{matchKey}` page built entirely from already-published artifacts, and made every match row on the event page (both tabs) and the team page a link to it.

## Scope decision that shaped the task

Scouting before planning found that two items in the original request are not reachable from published data: raw TBA `score_breakdown` stats (held in the corpus as `matches.score_breakdown_raw`, never published to R2) and robot photos. Jacob chose to ship the page on live data and defer breakdowns.

Robot photos turned out NOT to need pipeline work. Jacob corrected an incorrect scouting conclusion of mine, pointing out that the team page already renders robot images. It does, via `TeamSeasonArtifact.robotImageUrl`, so photos shipped in this task at zero pipeline cost.

## What was built

**Task 1 -- `860aa576`:** `lib/matchKey.ts` (the match-key convention, sibling to `eventKey.ts`: `eventKeyFromMatchKey`, `isValidMatchKey`, `InvalidMatchKeyError`). `MatchSearchSchema` added to `searchParams.ts`. `routes/match.$matchKey.tsx` reuses `eventQueryOptions` unchanged (so event-to-match navigation hits a warm cache), follows the event page's exact invalid-key/404/error/pending/populated branch order, runs `mergeEventMatches`/`computeEventAxisDomain` over ALL of the event's rows rather than a single-row domain, and reuses `EventMatchTable` for the one row plus `MatchVideoCell`/`parseMatchVideoKey` for the video. Zero new chart code, zero new video code.

**Task 2 -- `8a14975f`:** `lib/preMatchMetrics.ts` resolves a team's metrics as of immediately before a match. For a played match that is the `metricHistory` row PRECEDING the match's own row; for an unplayed match, the most recent played row. It returns `undefined` rather than a substitution for a team's first match of the season, an unresolvable roster key, or a team with no played matches. `components/match/MatchRobotGrid.tsx` renders six robot cards (red first, roster order) reusing `SeasonHeader.tsx`'s Avatar/fallback pattern verbatim, passing `metric`/`tier` only to `MetricValue` and never `swingScore`, with a per-card pending skeleton and an honest no-pre-match-metrics note when unresolved.

**Task 3 -- `9000521b`:** The Match-column label in both `EventMatchTable.tsx` and `team/MatchTable.tsx` is now a `<Link to="/match/$matchKey">` carrying year and algorithm, styled like the roster-number links beside it. `test/routerHarness.tsx` registers the new route. `StartMatchPicker.tsx` was deliberately left as a plain span -- a link inside that selection control would hijack the click.

## The off-by-one this page rests on

The planner caught that `MetricHistoryRowSchema.metrics` is the team's state AFTER that row's match. Reading the row for the match itself would have made the page's headline claim (metrics just before the match) quietly false while looking correct. Pre-match metrics therefore come from the PRECEDING row, pinned by a reference-equality property test over a synthetic five-row history asserting `rows[i-1].metrics` and never `rows[i].metrics`.

Relatedly, `MetricValue` no longer renders `metric.spread` at all -- the only plus-or-minus it draws is an explicitly-passed `swingScore`. None is passed here: the team artifact's `swingFactor` is season-final, and pairing it with an as-of-then rating would be a two-instants defect. A test asserts nothing renders for a metric that carries a spread.

## Verification (run by the orchestrator, not taken on the executor's word)

- The 7 test files this plan owns: **121/121 passing**.
- All of `apps/web`: **108 files, 1679 tests, all passing** -- confirming the shared `routerHarness.tsx` change caused no fallout.
- Repo root (the wider 234-file scope project memory warns about): **234 files, 4266 passed, 4 skipped, zero failures**.
- `npx tsc --noEmit` at root: clean. `npx tsc --noEmit -p apps/web/tsconfig.json`: three errors, all in `methodology.compare.test.tsx` (uncommitted) and `teams.test.tsx` (untracked) -- both owned by other concurrent sessions, neither touched by this plan.
- Each of the three commits audited with `git show --stat`: only this plan's intended files, no foreign edits absorbed.
- No manual browser check was performed this session. The verification basis is vitest plus tsc, not a rendered page.

## Deviations from Plan

None.

## Known Stubs

None. Raw `score_breakdown` stats are explicitly out of scope -- not implemented, not stubbed.

## Concurrency notes

This ran in the same checkout as three other active sessions (swing-tier, cold-start unification, bubble-chart), with worktree isolation disabled project-wide. Every commit was staged by explicit path. Where the shared git index already held another session's staged files, the commit used a pathspec restriction (`git commit -- <paths>`) so only the named paths landed. `MetricValue.tsx` and `theme.css` were ruled off-limits up front and neither needed editing: `MatchRobotGrid.tsx` expresses every style with existing `--color-*`/`--spacing-*`/`--radius` tokens and the existing `.data-card` class.

## Follow-up

Publishing raw TBA score breakdowns to R2 so the match page can show them. Granularity is already decided: alliance-level per side, with the genuinely per-robot fields (endgame position, auto leave/mobility, varying by season) broken out into three robot columns where the season has them. Note for whoever picks it up -- `redComponents`/`blueComponents` were deliberately removed from `EventMatchSchema` by quick task 260902-pbc after a grep found zero readers; they were modeled per-alliance predictions, not TBA's reported breakdown, so do not resurrect them as the answer.
