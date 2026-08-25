---
phase: 06-team-pages
plan: 01
subsystem: ui
tags: [tanstack-router, tanstack-query, zod, shadcn, radix-tabs, react, team-page]

requires:
  - phase: 05-site-shell-navigation-browsing
    provides: teams.ts fetch/Zod/query-options pattern, RootSearchSchema, Skeletons.tsx/StateViews.tsx family, shadcn install
provides:
  - "/team/$teamNumber route with a single artifact fetch, D-16 tab shell, and the page's four non-populated states"
  - "toTeamKey/teamNumberFromKey — the one home for the frc{number} corpus-key convention"
  - "OverviewTab/SeasonHeader/EventSectionList — frozen composition seams for plans 06-07/06-08"
  - "alliance-red/alliance-blue/loser-ink theme tokens"
affects: [06-05, 06-07, 06-08, 06-09]

actuals:
  tokens: 13800
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Route.update({id,path,getParentRoute}) inside a test builds a self-contained router tree carrying the REAL exported file-Route object, mirroring what routeTree.gen.ts itself does at build time — used to test a file route without depending on the gitignored generated tree"
    - "Local optional-field type intersection (TeamSeasonArtifact & {activeYears?: readonly number[]}) as a forward-compatible escape hatch for a field a same-wave sibling plan adds to the shared schema"

key-files:
  created:
    - apps/web/src/lib/teamKey.ts
    - apps/web/src/lib/api/team.ts
    - apps/web/src/routes/team.$teamNumber.tsx
    - apps/web/src/components/team/OverviewTab.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/EventSectionList.tsx
    - apps/web/src/components/team/TeamStates.tsx
    - apps/web/src/components/ui/tabs.tsx
    - apps/web/e2e/team-page.spec.ts
  modified:
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/styles/theme.css
    - apps/web/src/components/Skeletons.tsx
    - apps/web/playwright.config.ts

key-decisions:
  - "TeamSearchSchema extends RootSearchSchema with exactly one field (tab) per D-16 — no sort/sortDir, the team page has no sortable table"
  - "A 404 from the artifact fetch always means D-19 year-mismatch (never the generic error state); every other failure status stays the ordinary page-level ErrorState"
  - "Alliance/loser-ink tokens defined in this plan (wave 1) rather than the plan that first renders them (06-08, wave 4), because 06-07 also edits theme.css in that same wave"

patterns-established:
  - "File-route testing via Route.update() into a hand-built router tree, reusing the real exported Route object"
  - "Local optional-field type intersection as the escape hatch for a same-wave sibling plan's not-yet-landed schema field"

requirements-completed: [TEAM-02, TEAM-03, TEAM-04]

coverage:
  - id: D1
    description: "/team/{number} fetches, parses and renders a real published team artifact (nickname, number, record)"
    requirement: TEAM-02
    verification:
      - kind: unit
        ref: "apps/web/src/lib/api/team.test.ts"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/team.$teamNumber.test.tsx#a populated artifact renders the season header and record inside the Overview panel"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/team-page.spec.ts#renders a real team's nickname, number and record from the live bucket"
        status: fail
    human_judgment: true
    rationale: "The e2e spec is logically correct — a direct curl reproduces the exact same HTTP interaction against the live sigma1@2.0.0+tuned-2026-08 team artifact for frc1114/2024, and the route's typecheck/unit/component coverage all pass — but apps/web/playwright.config.ts requires the DEPLOYED production origin (R2 CORS does not allow-list localhost/*.pages.dev, confirmed live: no Access-Control-Allow-Origin header for an Origin: http://localhost request), and this worktree branch is not deployed. A human (or the orchestrator, post-merge-and-deploy) must re-run `pnpm --filter web test:e2e -- team-page` before trusting this deliverable end-to-end."
  - id: D2
    description: "?tab= is a typed, .catch()-guarded, back/forward-navigable search param (D-16); both tabs render from first paint regardless of query state (E8)"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/searchParams.test.ts"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/team.$teamNumber.test.tsx — tab shell describe block"
        status: pass
    human_judgment: false
  - id: D3
    description: "The four non-populated page states (loading skeleton, error, D-19 year-mismatch, E5 zero-events) render with their exact specified copy"
    requirement: TEAM-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/TeamStates.test.tsx"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/team.$teamNumber.test.tsx — states describe block"
        status: pass
    human_judgment: false
  - id: D4
    description: "teamKey <-> team number conversion (frc{number}) is confined to one module (D-15); a non-numeric path param never fires a fetch"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/teamKey.test.ts"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/team.$teamNumber.test.tsx#renders the invalid-team-number message and fires no team artifact fetch"
        status: pass
    human_judgment: false
  - id: D5
    description: "OverviewTab/SeasonHeader/EventSectionList exist with frozen prop contracts, and neither child imports the other, so plans 06-07/06-08 can run in the same wave without touching one another's files"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/OverviewTab.tsx (imports both); grep confirms no cross-import between SeasonHeader.tsx and EventSectionList.tsx"
        status: pass
    human_judgment: false

duration: ~65min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 01: Team-page tracer, tab shell and page states Summary

**`/team/{number}` route that fetches and renders a real published team artifact end-to-end, plus a D-16 `?tab=` shell, two frozen composition seams for plans 06-07/06-08, and the page's four non-populated states (loading, error, D-19 year-mismatch, E5 zero-events).**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3 (plus 2 small follow-up commits)
- **Files modified:** 18

## Accomplishments

- One real path proven end to end: a live `v1/team/frc1114/2024/sigma1@2.0.0+tuned-2026-08.json` artifact (160 KB, confirmed via direct HTTP request) is fetchable, Zod-parses through `TeamSeasonArtifactSchema`, and renders on `/team/1114?year=2024&algorithm=sigma1` — the `teamKey` derivation, the `page: "team"` `artifactKey` branch, and the third file-route search-param family (`TeamSearchSchema`) all work together.
- `?tab=overview|history` is a typed, `.catch()`-guarded URL search param; both tab triggers render from first paint regardless of query state, and the active tab survives browser back/forward.
- `OverviewTab`/`SeasonHeader`/`EventSectionList` exist with frozen prop contracts (`{ artifact, algorithmId, season, teamNumber }`), letting plans 06-07 and 06-08 build the season header's metric grid and the per-event match tables in the same wave without editing each other's files.
- All four non-populated states render with their exact copy: a shaped loading skeleton (header block + 3 event-section cards, not a spinner), the canonical `ErrorState` for a real fetch failure, D-19's year-mismatch empty state (heading + optional active-year link chips), and E5's distinct zero-events data-gap message.

## Task Commits

1. **Task 1: End-to-end "/team/1114 shows a real team" tracer** - `c92588ff` (feat)
2. **Task 2: Tab shell as a typed URL search param, with frozen composition seams** - `d505bc00` (feat)
3. **Task 3: The page's four non-populated states** - `5dc1ffe1` (feat)
4. **Fix: restore `team-record` testid dropped by Task 2's route rewrite** - `4ac6a6fa` (fix)
5. **Test: cover the invalid-team-number path at the route level** - `60cb1011` (test)

## Files Created/Modified

- `apps/web/src/lib/teamKey.ts` - `toTeamKey`/`teamNumberFromKey`/`TEAM_KEY_PREFIX`, the one home for the `frc{number}` convention
- `apps/web/src/lib/api/team.ts` - `fetchTeamArtifact`/`teamQueryOptions`, mirrors `teams.ts` exactly
- `apps/web/src/routes/team.$teamNumber.tsx` - the `/team/$teamNumber` route: `validateSearch`, single query, tab shell, page-state decision tree
- `apps/web/src/components/team/OverviewTab.tsx` - composition seam mounting `SeasonHeader`/`EventSectionList`
- `apps/web/src/components/team/SeasonHeader.tsx` - team number/nickname/record/win-rate identity block
- `apps/web/src/components/team/EventSectionList.tsx` - one heading per event, ordered by `startDate`
- `apps/web/src/components/team/TeamStates.tsx` - `YearMismatchEmptyState` (D-19) and `NoEventDataState` (E5 empty)
- `apps/web/src/components/ui/tabs.tsx` - shadcn `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`
- `apps/web/src/components/Skeletons.tsx` - `TeamHeaderSkeleton`/`EventSectionSkeleton` joined the family
- `apps/web/src/lib/searchParams.ts` - `TEAM_TABS`, `TeamSearchSchema`
- `apps/web/src/styles/theme.css` - `--alliance-red`/`--alliance-red-soft`/`--alliance-blue`/`--alliance-blue-soft`/`--loser-ink`
- `apps/web/e2e/team-page.spec.ts` + `apps/web/playwright.config.ts` - the tracer's e2e proof (implemented, blocked on deploy — see Issues)
- Six new/extended test files: `teamKey.test.ts`, `api/team.test.ts`, `searchParams.test.ts`, `team.$teamNumber.test.tsx`, `TeamStates.test.tsx` (182 total unit/component tests passing)

## Decisions Made

- `TeamSearchSchema` extends `RootSearchSchema` with exactly one field (`tab`) — no `sort`/`sortDir`, matching D-16's own instruction that the team page has no sortable table.
- The 404-vs-other-error split lives on `error instanceof ArtifactFetchError && error.status === 404` — a 404 always routes to D-19's `YearMismatchEmptyState` regardless of whether `activeYears` is known; every other failure (500, network, validation) stays the ordinary page-level `ErrorState`.
- Alliance/loser-ink theme tokens landed in this plan (wave 1) rather than in 06-08 (the plan that first renders them, wave 4), because 06-07 also edits `theme.css` in that same wave 4 — defining both blocks up front keeps two wave-4 plans from touching one file.
- File-route test pattern: `Route.update({ id, path, getParentRoute })` inside a hand-built `createRootRoute().addChildren([...])` tree, reusing the REAL exported `Route` object from the route module — mirrors exactly what the gitignored `routeTree.gen.ts` does at build time, so the actual route component is under test rather than a re-implementation of it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `team-record` testid dropped by Task 2's route rewrite**
- **Found during:** post-Task-3 review
- **Issue:** Task 1's e2e spec targets `[data-testid="team-record"]`, but Task 2 moved the record render from the route file into `SeasonHeader.tsx` without carrying the testid over — a real regression in the tracer's own verification target.
- **Fix:** Added `data-testid="team-record"` to `SeasonHeader`'s record `<span>`.
- **Files modified:** `apps/web/src/components/team/SeasonHeader.tsx`
- **Verification:** `pnpm --filter web typecheck`/`test` clean; the e2e spec's selector now resolves (confirmed by reading the rendered markup shape; the live e2e run itself remains blocked, see Issues below).
- **Committed in:** `4ac6a6fa`

**2. [Rule 3 - Blocking] `playwright.config.ts`'s desktop project didn't match the new e2e spec**
- **Found during:** Task 1
- **Issue:** `apps/web/e2e/team-page.spec.ts` matched neither project's `testMatch` regex (`deep-link.spec.ts` only for `desktop`, `touch-scroll.spec.ts` only for the two mobile projects), so `pnpm --filter web test:e2e -- team-page` would report "no tests found" rather than actually running the spec.
- **Fix:** Widened the `desktop` project's `testMatch` to `/deep-link\.spec\.ts|team-page\.spec\.ts/` — a real desktop width suits the tracer's assertions (no touch gesture or phone-viewport dependency).
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** `pnpm --filter web test:e2e -- team-page` now actually runs the two new tests (confirmed by output showing them attempted, not skipped).
- **Committed in:** `c92588ff`

**3. [Rule 3 - Blocking, cross-plan] `TeamSeasonArtifactSchema.activeYears` not yet on disk**
- **Found during:** Task 3
- **Issue:** D-19's decision logic needs `artifact.activeYears` (D-05), but that field is added to `packages/harness/pageArtifacts.ts` by plan 06-02 — a same-wave sibling with no `depends_on` relationship to this plan, so this worktree's copy of the schema predates it. Accessing `.activeYears` directly on `TeamSeasonArtifact` would not compile.
- **Fix:** A local type intersection, `type TeamSeasonArtifactWithActiveYears = TeamSeasonArtifact & { activeYears?: readonly number[] }`, used only at the read site in `team.$teamNumber.tsx` — the same "loose cast + graceful fallback" escape hatch `YearSelect.tsx`/`AlgorithmSelect.tsx` already use for a cross-route search cast. Resolves cleanly once 06-02 merges (an optional field intersected onto a type that already carries it is a no-op).
- **Files modified:** `apps/web/src/routes/team.$teamNumber.tsx`
- **Verification:** `pnpm --filter web typecheck` clean against the current (pre-06-02) schema.
- **Committed in:** `5dc1ffe1`

**4. [Rule 4-adjacent, documented simplification] D-19's "season header above the empty body" cannot render for a pure 404**
- **Found during:** Task 3
- **Issue:** The plan's own text says "In both cases the season header still renders above the empty body." For the zero-events-but-successful-fetch branch this is straightforward (the full artifact, including `seasonStats`, exists). For the 404 branch, NO artifact was ever fetched — there is no data to build a `SeasonHeader` from at all.
- **Resolution (not a fix, a scoped decision):** The zero-events branch renders the real `SeasonHeader` above the empty state, exactly as specified. The 404 branch instead relies on `YearMismatchEmptyState`'s own `nickname=""` fallback, which renders "Team {teamNumber} didn't compete in {year}" — an honest degrade using the one piece of identity that IS always known (the URL's own team number), rather than inventing data. Documented here rather than silently narrowed, since it's a real, if minor, gap against the plan's literal text.
- **Files modified:** `apps/web/src/routes/team.$teamNumber.tsx`
- **Committed in:** `5dc1ffe1`

---

**Total deviations:** 4 (1 Rule 1 bug fix, 2 Rule 3 blocking fixes, 1 documented scoping decision)
**Impact on plan:** All four were necessary for correctness or for the plan to compile/run at all against this worktree's actual on-disk schema state. No scope creep — no files outside this plan's declared list were touched except `playwright.config.ts` (necessary for the plan's own e2e spec to run at all).

## Issues Encountered

**The tracer's e2e spec (`pnpm --filter web test:e2e -- team-page`) fails, but not from a code defect.** `apps/web/playwright.config.ts` requires the DEPLOYED production origin (`https://sigmascout.org`) — there is no local `webServer`, by established repo convention (`https://data.sigmascout.org`'s R2 CORS policy does not allow-list `localhost`/`*.pages.dev`, confirmed live this session: a direct request with `Origin: http://localhost:4173` gets no `Access-Control-Allow-Origin` header back). This worktree branch has not been merged/deployed, so `sigmascout.org` does not yet serve this plan's new route at all — both e2e tests (nickname/record render; invalid-team-number no-fetch) fail with "element not found," which is the expected symptom of hitting the OLD deployed build, not a bug in the new code.

I verified the underlying logic is correct through every channel available in an isolated worktree:
- A direct `curl` against `https://data.sigmascout.org/v1/team/frc1114/2024/sigma1@2.0.0+tuned-2026-08.json` returns the real 160 KB artifact this route's `fetchTeamArtifact` is built to consume.
- `pnpm --filter web typecheck` and the full `pnpm --filter web test` suite (182 tests) pass clean, including component-level tests that exercise the actual route component (`team.$teamNumber.test.tsx`) with mocked fetch responses shaped exactly like the real endpoint.
- `pnpm --filter web build` produces a `dist/` whose `routeTree.gen.ts` registers `/team/$teamNumber`.

This is the same structural pattern this repo's OTHER e2e specs already follow (`touch-scroll.spec.ts`/`deep-link.spec.ts`'s own header comments: "both specs assume the current build is ALREADY DEPLOYED before playwright test runs"). **Action needed:** re-run `pnpm --filter web test:e2e -- team-page` after this branch is merged and deployed to `sigmascout.org` — recorded as coverage deliverable D1's `human_judgment: true` entry above so it surfaces at verification time rather than silently passing.

**`node_modules` did not exist at worktree start** (unlike the documented "install fails but node_modules is populated" case) — `pnpm install` failed on `better-sqlite3`'s node-gyp rebuild (no Visual Studio Build Tools, consistent with the known machine limitation) before it had linked any `.bin` symlinks at all, leaving `tsc`/`vite`/`vitest`/`playwright` all unreachable. Resolved with `pnpm install --ignore-scripts`, which completes linking (including `.bin`) without attempting the native build; functionally verified via a real `pnpm --filter web build` + `typecheck` + `test` run, per this project's own "verify functionally, not by exit code" convention. `apps/web` does not need `better-sqlite3` at runtime.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 06-07 (season header polish, D-17 tier grid, robot image, TBA link) and 06-08 (match tables) can build against `OverviewTab`'s frozen `SeasonHeader`/`EventSectionList` prop contracts without touching this plan's files.
- Plan 06-02's schema wave should be merged before the `TeamSeasonArtifactWithActiveYears` local cast in `team.$teamNumber.tsx` can be replaced with a direct, real `activeYears` field read — the cast is forward-compatible and needs no further action, but a future pass could clean it up once 06-02 lands.
- **Blocker for full sign-off:** `pnpm --filter web test:e2e -- team-page` needs a real run against the deployed origin after this wave merges — see Issues Encountered and coverage deliverable D1.
- Minor, non-blocking acceptance-criteria note: Task 1's `grep -rl 'frc\${' apps/web/src | grep -v 'lib/teamKey.ts' | wc -l` does not literally equal 0 — two PRE-EXISTING Phase 5 test fixtures (`SearchBox.test.tsx`, `search-index.test.ts`) already used the same `` `frc${...}` `` shape before this plan started, out of this plan's declared scope, and matching the PLAN.md's own inline `<!-- planner-discipline-allow: frc${ -->` marker immediately after that criterion. No NEW occurrence of the literal was introduced by this plan.

## Self-Check: PASSED

- FOUND: apps/web/src/lib/teamKey.ts
- FOUND: apps/web/src/lib/api/team.ts
- FOUND: apps/web/src/routes/team.$teamNumber.tsx
- FOUND: apps/web/src/components/team/OverviewTab.tsx
- FOUND: apps/web/src/components/team/SeasonHeader.tsx
- FOUND: apps/web/src/components/team/EventSectionList.tsx
- FOUND: apps/web/src/components/team/TeamStates.tsx
- FOUND: apps/web/src/components/ui/tabs.tsx
- FOUND: apps/web/e2e/team-page.spec.ts
- FOUND: c92588ff (git log --oneline --all)
- FOUND: d505bc00
- FOUND: 5dc1ffe1
- FOUND: 4ac6a6fa
- FOUND: 60cb1011

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
