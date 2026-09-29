---
phase: 06-team-pages
plan: 05
subsystem: ui
tags: [recharts, react-lazy, tanstack-router, tanstack-table, vitest, playwright]

requires:
  - phase: 06-team-pages
    provides: "plan 06-01's /team/$teamNumber route, tab shell (?tab= search param), and the metric-history-panel testid placeholder"
provides:
  - "MetricHistoryChart.tsx — the Recharts ComposedChart (Total-only line, D-13 variance band, D-12 event bands), default-exported for dynamic import"
  - "metricHistorySeries.ts — buildMetricSeries/detectEventBands, the pure array-position derivation that avoids matchIndex's season-wide gaps"
  - "MetricHistoryTab.tsx — the React.lazy boundary with a chart-shaped skeleton, an import-scoped error boundary, and an injectable loadChart test seam"
  - "A real, measured D-14 first-paint verdict (docs/first-paint-measurement.md fifth entry): the lazy import is faster on every network profile, unlike D-19's reverted Teams-route split"
  - "The search box and Teams table both navigate to /team/{teamNumber}, closing the two Phase 5 interim-destination notes"
affects: [06-09]

actuals:
  tokens: 22363
  tasks: 3
  commits: 3

tech-stack:
  added: ["recharts@3.10.1"]
  patterns:
    - "Chart sizing via a useLayoutEffect measure-with-fallback hook (mirrors TeamsTable.tsx's scrollHeight pattern) instead of Recharts' ResponsiveContainer, since jsdom's stubbed ResizeObserver never calls back and would leave the chart permanently zero-width under test"
    - "React.lazy() wrapper recreated via useMemo keyed on a retry counter, not a bare Suspense key change alone — a rejected lazy() promise is cached forever inside that one lazy() instance, so Retry must construct a brand-new lazy() to genuinely re-attempt the dynamic import"
    - "Injectable loadChart prop (defaults to the real dynamic import) as the test seam for asserting a dynamic-import retry's call count deterministically, without depending on real chunk-fetch timing"
    - "Real local-build A/B measurement for a code-split decision (two `vite build` outputs, two local static servers, Playwright + real CDP throttling, PerformanceObserver-sourced LCP) — reused verbatim from the Phase 5 D-19 close-out's fourth first-paint-measurement.md entry"

key-files:
  created:
    - apps/web/src/components/team/metricHistorySeries.ts
    - apps/web/src/components/team/metricHistorySeries.test.ts
    - apps/web/src/components/team/MetricHistoryChart.tsx
    - apps/web/src/components/team/MetricHistoryChart.test.tsx
    - apps/web/src/components/team/MetricHistoryTab.tsx
    - apps/web/src/components/team/MetricHistoryTab.test.tsx
    - apps/web/src/components/teams-table/columns.test.tsx
  modified:
    - apps/web/package.json
    - apps/web/src/routes/team.$teamNumber.tsx
    - apps/web/src/components/search/SearchBox.tsx
    - apps/web/src/components/search/SearchBox.test.tsx
    - apps/web/src/components/teams-table/columns.tsx
    - apps/web/src/components/teams-table/TeamsTable.test.tsx
    - apps/web/playwright.config.ts
    - docs/first-paint-measurement.md

key-decisions:
  - "Chart width is measured via a useLayoutEffect hook with a DEFAULT_CHART_WIDTH fallback, not Recharts' ResponsiveContainer — ResponsiveContainer's ResizeObserver-driven sizing never resolves under this repo's jsdom test setup (the stubbed ResizeObserver never calls back), which would make every chart test observe a permanently zero-width, childless SVG"
  - "Event-boundary labels use a custom Recharts label render function (not the plain string `label` prop) so the truncated on-chart text carries a real accessible full-text affordance via a native SVG <title>, matching the plain-HTML event-section header's title-attribute pattern on a different rendering path"
  - "MetricHistoryTab's retry mechanism creates a brand-new React.lazy() wrapper on each retry (via useMemo keyed on a counter), not a key-only Suspense remount — React permanently caches a rejected lazy() promise inside that one lazy() call, so only a fresh lazy() instance actually re-attempts the dynamic import"
  - "eventNameByKey is built inside MetricHistoryTab from the full artifact it already receives, not threaded as a separate prop from the route — the route already passes the whole artifact down, and building the map one level closer to its only consumer avoids one extra prop hop for the same data"
  - "Teams-table team-number/nickname Links carry a fixed tab: \"overview\" search param (not a spread updater) — there is no 'previous team route search' to preserve when arriving from a different route, and Overview is D-16's own stated default"
  - "playwright.config.ts's iphone-17/pixel-10 projects widened to also match no-page-pan.spec.ts (Rule 3) — the spec existed on disk but matched no project's testMatch at all, the same class of gap 06-01-PLAN.md already fixed for team-page.spec.ts, and this plan's own literal verify command names it"

patterns-established:
  - "Real local-build-and-measure A/B protocol for future code-split decisions in this repo, generalized from the one-off D-19 close-out script into a reusable recipe (two vite builds, two adjacent-port static servers, Playwright + CDP Network.emulateNetworkConditions/Emulation.setCPUThrottlingRate, a PerformanceObserver init script, median of three)"

requirements-completed: [TEAM-06]

coverage:
  - id: D1
    description: "The Metric History tab plots the team's own match sequence (array position, never the season-wide matchIndex) with a variance band only where a spread exists, silent on OPR/EPA, and event boundaries as alternating tinted bands with a truncating, accessible-titled label"
    requirement: TEAM-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/metricHistorySeries.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/team/MetricHistoryChart.test.tsx (9 tests: band presence/absence, zero/one/many points, high-match-count fixture, long-event-name truncation+title, no hex literals)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Recharts loads only when the Metric History tab opens (a real, separate build chunk never referenced by dist/index.html's eager <script> tag), with a chart-shaped skeleton while pending and an import-scoped Retry on failure that never refetches data"
    requirement: TEAM-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/MetricHistoryTab.test.tsx (3 tests: pending skeleton, rejecting-stub Retry with call-count assertion and zero fetch calls, resolved chart render)"
        status: pass
      - kind: other
        ref: "pnpm --filter web build — MetricHistoryChart-Bni4eoGf.js (331.49 KB / 96.60 KB gzip) present in dist/assets, absent from dist/index.html's <script> tags"
        status: pass
    human_judgment: false
  - id: D3
    description: "The dynamic-import deferral is a real, measured win (not an assumption) — a five-cell CDP-throttled A/B on the team page's Overview tab, both local builds from this same worktree"
    requirement: TEAM-06
    verification:
      - kind: other
        ref: "docs/first-paint-measurement.md's Fifth measurement entry — 1712/364/144 ms saved across three network profiles, nine runs per variant"
        status: pass
    human_judgment: false
  - id: D4
    description: "A team hit in the search box and a Teams-table row both navigate to /team/{teamNumber}, carrying the current year and algorithm"
    verification:
      - kind: unit
        ref: "apps/web/src/components/search/SearchBox.test.tsx#a team-hit selection navigates to the real team route, carrying the selected team's number, current year and algorithm (D-15/D-16)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/teams-table/columns.test.tsx (3 tests: both cells' href/team-number, nickname title+truncation, year/algorithm search params)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Adding the two link cells does not widen the Teams table or reintroduce page-level horizontal pan"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/no-page-pan.spec.ts — 8/8 passed against the currently-deployed sigmascout.org"
        status: pass
    human_judgment: true
    rationale: "This run validated the invariant against the CURRENTLY-DEPLOYED build, which does not yet carry this plan's new Link cells (they are not deployed until this worktree merges and ships) — the spec ran and passed, but it did not exercise the exact code this plan changed. A human (or the orchestrator, post-merge-and-deploy) should re-run it once the real build with the new links is live, matching 06-01-SUMMARY.md's identical team-page.spec.ts precedent."

duration: ~95min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 05: Metric-history chart and the two Phase 5 landing-page fixes Summary

**A dynamically-imported Recharts chart plotting a team's own match sequence with a D-13 variance band and D-12 event bands, a measured (not assumed) first-paint win for deferring it, and the search box/Teams table finally landing on the real team page.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3
- **Files modified:** 16 (7 created, 9 modified, excluding the generated `pnpm-lock.yaml`)

## Accomplishments

- `metricHistorySeries.ts`'s `buildMetricSeries` derives the chart's x-axis from a row's ARRAY POSITION in the team's own `metricHistory[]`, never the season-wide `matchIndex` field — verified against a fixture whose `matchIndex` values (4, 17, 92) would otherwise leave large gaps, and `detectEventBands` groups consecutive rows by `eventKey` change with no second lookup into `events[]`.
- `MetricHistoryChart.tsx` is a real Recharts `ComposedChart` — `ReferenceArea` event bands, an `Area` variance band that renders only when at least one point in the series carries a spread (silent on OPR/EPA, D-13), and a `Line` for `TOTAL_KEY` only (D-11). Chart sizing is measured via a `useLayoutEffect` hook mirroring `TeamsTable.tsx`'s own `scrollHeight` pattern, not Recharts' `ResponsiveContainer` — that component's `ResizeObserver`-driven sizing never resolves under this repo's jsdom test setup.
- `MetricHistoryTab.tsx` wraps the chart in `React.lazy()` behind a `Suspense` with a chart-shaped, text-free skeleton, and a file-scoped error boundary whose "Chart failed to load" Retry constructs a BRAND-NEW `lazy()` wrapper (via `useMemo` keyed on a retry counter) rather than reusing the same one — React permanently caches a rejected `lazy()` promise inside that one instance, so a bare `Suspense` key change alone would not actually retry the import.
- The D-14 deferral claim is now a real measurement, not an assumption: two full local `vite build`s (with/without the lazy boundary) were served from adjacent-port local static servers and driven via Playwright with real CDP network/CPU throttling across three profiles. The lazy import won on every profile (1712/364/144 ms saved on congested-venue/decent-LTE/good-wifi), the opposite outcome from D-19's reverted Teams-route split — recorded as the fifth dated entry in `docs/first-paint-measurement.md`.
- `SearchBox.tsx`'s `handleSelectTeam` and `teams-table/columns.tsx`'s team-number/nickname cells both now navigate to `/team/{teamNumber}`, closing the two Phase 5 "interim destination" notes those files carried since plan 05-08/05-06.

## Task Commits

1. **Task 1: The series derivation and the Recharts chart** - `b52e232f` (feat)
2. **Task 2: The lazy boundary, its states, and a real measurement of the deferral** - `260ff38a` (feat)
3. **Task 3: Point the search box and the Teams table at the team route** - `05be3372` (feat)

## Files Created/Modified

- `apps/web/src/components/team/metricHistorySeries.ts` / `.test.ts` - pure `buildMetricSeries`/`detectEventBands`, no React import
- `apps/web/src/components/team/MetricHistoryChart.tsx` / `.test.tsx` - the default-exported Recharts `ComposedChart`
- `apps/web/src/components/team/MetricHistoryTab.tsx` / `.test.tsx` - the lazy boundary, skeleton, error boundary, injectable `loadChart` test seam
- `apps/web/src/routes/team.$teamNumber.tsx` - mounts `MetricHistoryTab` once the artifact resolves, inside the existing `metric-history-panel` testid wrapper
- `apps/web/src/components/search/SearchBox.tsx` / `.test.tsx` - `handleSelectTeam` now navigates to `/team/$teamNumber`
- `apps/web/src/components/teams-table/columns.tsx` / `.test.tsx` (new) - team-number/nickname cells become `Link`s
- `apps/web/src/components/teams-table/TeamsTable.test.tsx` - wrapped in a router-context test harness (Rule 1 fix, see Deviations)
- `apps/web/playwright.config.ts` - `no-page-pan.spec.ts` added to the two mobile projects' `testMatch` (Rule 3 fix, see Deviations)
- `docs/first-paint-measurement.md` - fifth dated entry (D-14 A/B measurement)
- `apps/web/package.json` / `pnpm-lock.yaml` - `recharts@3.10.1` added

## Decisions Made

See `key-decisions` in frontmatter above — chart sizing without `ResponsiveContainer`, the custom-label `<title>` accessibility affordance, the fresh-`lazy()`-per-retry mechanism, `eventNameByKey` built inside `MetricHistoryTab` rather than threaded as a route-level prop, the Teams-table links' fixed `tab: "overview"`, and the `playwright.config.ts` `testMatch` widening.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `TeamsTable.test.tsx`'s existing suite broke once `columns.tsx` gained real router `Link`s**
- **Found during:** Task 3
- **Issue:** `columns.tsx`'s new `Link` cells call `useRouter()` internally; `TeamsTable.test.tsx` rendered `<TeamsTable />` with no router context at all, so all 7 tests that render a populated table threw `useRouter must be used inside a <RouterProvider>`.
- **Fix:** Added a `TestHarness` component (a hand-built router tree carrying `/teams` and `/team/$teamNumber` routes, mirroring `TeamStates.test.tsx`'s established pattern) wrapping every render call. Two tests use testing-library's `rerender` with new `TeamsTable` props; since a route's `component` closure captures its `children` permanently at `createRoute()` time, `TestHarness` reads its current `children` through React context instead, so a `rerender` with new content actually updates what's shown without rebuilding the router.
- **Files modified:** `apps/web/src/components/teams-table/TeamsTable.test.tsx`
- **Verification:** All 10 tests in the file pass.
- **Committed in:** `05be3372`

**2. [Rule 3 - Blocking] `no-page-pan.spec.ts` matched no Playwright project's `testMatch` at all**
- **Found during:** Task 3, running this plan's own literal verify command
- **Issue:** `pnpm --filter web test:e2e -- no-page-pan` reported "No tests found" — the spec file exists on disk but none of `playwright.config.ts`'s three projects' `testMatch` regexes include it. This is the same class of gap 06-01-PLAN.md's own Task 1 fixed for `team-page.spec.ts` (widened `desktop`'s regex), left unaddressed for this spec.
- **Fix:** Widened `iphone-17`/`pixel-10`'s `testMatch` to also match `no-page-pan\.spec\.ts` — the spec's own header names the originating bug as "on a 390px phone," making a mobile-viewport project the meaningful place to run it (not `desktop`'s 1440×900).
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** `pnpm --filter web test:e2e no-page-pan` now runs and passes 8/8 (see Issues Encountered for the deployment-timing caveat).
- **Committed in:** `05be3372`

---

**Total deviations:** 2 (1 Rule 1 bug fix, 1 Rule 3 blocking fix)
**Impact on plan:** Both were necessary for this plan's own tests/verify commands to pass at all. No scope creep — no files outside the plan's declared list were touched except `playwright.config.ts` (necessary for the plan's own e2e verify step to run).

## Issues Encountered

**`no-page-pan.spec.ts` ran and passed, but against the currently-DEPLOYED build, not this plan's own changes.** `playwright.config.ts`'s `baseURL` points at `https://sigmascout.org` (the canonical deployed apex, D-17a) with no local `webServer`, matching every other e2e spec in this repo — R2's CORS policy does not allow-list `localhost` (05-06-SUMMARY.md), so a local server cannot serve the real artifacts these specs need. This worktree branch is not yet merged/deployed, so the 8/8 passing run above validated the no-horizontal-pan invariant against the OLD build (pre-this-plan), not the new team-number/nickname `Link` cells. Recorded as coverage deliverable D5's `human_judgment: true` entry above, matching 06-01-SUMMARY.md's identical precedent for `team-page.spec.ts`. **Action needed:** re-run `pnpm --filter web test:e2e -- no-page-pan` after this branch is merged and deployed.

**The gsd-tools broken-windows ledger append failed with a pre-existing, unrelated parse error** (`Ledger frontmatter line is not key: value: "last_updated: ...\r"`, a CRLF issue in `WINDOWS.md`'s own frontmatter, not something this plan touched or caused). Recorded here manually instead, per the ledger's own "best-effort, never blocks execution" instruction: the D5 deployment-timing gap above is the item that would have been appended.

**`node_modules` and `apps/web/node_modules/recharts` were missing at worktree start** (unlike this session's documented "install fails but node_modules is populated" convention) — a plain `pnpm install --ignore-scripts` from the worktree root succeeded cleanly and installed `recharts@3.10.1` via `pnpm --filter web add recharts@3.10.1` with no native-build issues (recharts has no native dependencies). All `pnpm --filter web test`/`typecheck`/`build` commands ran directly through their real exit codes for the entire plan, not the "verify functionally" fallback the environment notes describe for a broken install.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `MetricHistoryChart.tsx`'s exported `MetricHistoryChartProps`/`MetricSeriesPoint`/`EventBand` types and `metricHistorySeries.ts`'s two functions are stable, tested primitives any later phase can extend (e.g. the deferred per-component-trajectory toggle noted in `06-CONTEXT.md`'s Deferred Ideas).
- The real A/B first-paint measurement method (two local builds, two static servers, Playwright + CDP throttling, `PerformanceObserver`-sourced LCP) is now demonstrated twice in this repo (D-19's close-out, this plan's D-14 entry) and is a reusable recipe for any future code-split decision.
- **Blocker for full sign-off:** `pnpm --filter web test:e2e -- no-page-pan` needs a genuine re-run against the deployed origin after this wave merges, to confirm the new `Link` cells do not widen the table — see Issues Encountered and coverage deliverable D5.
- `MetricHistoryTab`'s `loadChart` prop is a test-only seam (default parameter covers all production call sites); no route or component outside this plan's own tests ever passes it explicitly.

## Self-Check: PASSED

- FOUND: apps/web/src/components/team/metricHistorySeries.ts
- FOUND: apps/web/src/components/team/metricHistorySeries.test.ts
- FOUND: apps/web/src/components/team/MetricHistoryChart.tsx
- FOUND: apps/web/src/components/team/MetricHistoryChart.test.tsx
- FOUND: apps/web/src/components/team/MetricHistoryTab.tsx
- FOUND: apps/web/src/components/team/MetricHistoryTab.test.tsx
- FOUND: apps/web/src/components/teams-table/columns.test.tsx
- FOUND: b52e232f (git log --oneline --all)
- FOUND: 260ff38a
- FOUND: 05be3372

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
