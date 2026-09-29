---
phase: 07-event-pages
plan: 15
subsystem: ui
tags: [tanstack-router, tanstack-react-query, react, zod, event-pages, navigation]

# Dependency graph
requires:
  - phase: 07-event-pages (plans 01, 07, 08, 10, 14)
    provides: the event route contract and five-tab strip (07-01), EventArtifactSchema's identity fields name/startDate/location/week and composeEventLocation (07-07), the publish-side non-empty name test (07-08 PD-05), a real published subset carrying those fields (07-10), the completed Alliances tab (07-14)
provides:
  - "EventHeader.tsx — the D-18 item 8 identity header: name as the page's single h1 (event-key fallback), a three-segment date/location/week metadata line with week 0 distinguished from Offseason and absent, and a working 'View on TBA' link"
  - "eventKeyForSeason(eventKey, season) in lib/eventKey.ts — the season-swap helper Phase 5 D-12's extension point needed"
  - "EventsList.tsx rows and SearchBox.tsx event selections both navigate to /event/{eventKey}, carrying year/algorithm/DEFAULT_EVENT_TAB — Phase 7 is reachable from the deployed site for the first time"
  - "EventsList.tsx's location cell delegates to the pipeline's composeEventLocation, closing the one-composer-two-surfaces claim from 07-07"
  - "D-20's per-algorithm Teams-page rank column header (columns.tsx), derived from algorithmDisplayLabel so 07-18's relabel carries it for free"
  - "resolveYearChangeTarget in YearSelect.tsx — Phase 5 D-12's reserved year-change extension point, an allow-list membership fetch at click time mapping an event-detail year change to the same event code in the target season or falling back to that season's Events list"
affects: [07-16, 07-17, 07-18, 07-19, 07-20]

actuals:
  tokens: 19000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Page-chrome identity header as a DOM sibling above a tab strip, fed by the same single artifact fetch every tab reads — no second request"
    - "Router-harness test technique (ChildrenContext/RouteBody/TestHarness) reused a third time (after TeamsTable.test.tsx) for a component whose cells became router Links"
    - "Click-time-only allow-list membership fetch (resolveYearChangeTarget) as the pattern for a globally-mounted control whose target route genuinely varies per current pathname"

key-files:
  created:
    - apps/web/src/components/event/EventHeader.tsx
    - apps/web/src/components/event/EventHeader.test.tsx
  modified:
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx
    - apps/web/src/components/events-list/EventsList.tsx
    - apps/web/src/components/events-list/EventsList.test.tsx
    - apps/web/src/routes/events.tsx
    - apps/web/src/components/search/SearchBox.tsx
    - apps/web/src/components/search/SearchBox.test.tsx
    - apps/web/src/components/teams-table/columns.tsx
    - apps/web/src/components/teams-table/columns.test.tsx
    - apps/web/src/components/ribbon/YearSelect.tsx
    - apps/web/src/components/ribbon/YearSelect.test.tsx
    - apps/web/src/lib/eventKey.ts
    - apps/web/src/lib/eventKey.test.ts

key-decisions:
  - "EventHeader.tsx renders on the populated and pending branches only, never on any error branch including the 404 (PD-05) — the tab content's own EmptyState/ErrorState already name the event key"
  - "eventMetaLine's week segment tests === undefined and === null explicitly, never by truthiness or nullish coalescing, so week: 0 renders 'Week 0' rather than being swallowed into the offseason branch"
  - "Only the Events-list name cell becomes a router Link (PD-06) — every other cell stays inert, matching teams-table/columns.tsx's own cell-level-link precedent over a whole-row anchor"
  - "SearchBox's SearchNavigate union narrowed to the team and event detail routes; the interim /teams and /events destinations were removed because after this edit no call site targets either"
  - "D-20's rank header is derived from algorithmDisplayLabel(algorithm) at render time, never a literal — rowModel.ts and the column's ordering behaviour are untouched"
  - "resolveYearChangeTarget is an allow-list membership test, not a syntactic guess: the swapped event key is navigated to only after it is found in the target season's PUBLISHED events array, fetched at click time only via the same query keys routes/events.tsx and SearchBox.tsx already use"

patterns-established:
  - "Pattern: a header-shaped identity block for a tab-strip page reads from the same artifact every tab already fetched, never a second request, and is proven a DOM sibling of the strip by a bidirectional .contains() assertion"

requirements-completed: [EVNT-02, EVNT-03]

coverage:
  - id: D1
    description: "EventHeader.tsx renders the event's own name (or event-key fallback) as the page's single h1, a three-segment date/location/week metadata line honoring every absence rule including week 0, and a working 'View on TBA' link — fed by the same artifact fetch every tab reads"
    requirement: "EVNT-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/EventHeader.test.tsx (13 tests, all passing)"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/event.$eventKey.test.tsx (Tests 13-15, header sibling/pending/error-branch coverage)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every Events-list row and every search-dropdown event hit navigates to /event/{eventKey} carrying the reader's current year, algorithm and DEFAULT_EVENT_TAB"
    requirement: "EVNT-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/events-list/EventsList.test.tsx (Tests 1-3)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/search/SearchBox.test.tsx (Test 5/6/7)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Teams page's leading rank column header names the algorithm whose Total produced the ordering (D-20), and Phase 5 D-12's event-detail year-change extension point is discharged"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/columns.test.tsx (D-20 describe block)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/ribbon/YearSelect.test.tsx (Tests 7-13)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-08-28
status: complete
---

# Phase 07 Plan 15: Event identity header and cross-site wiring Summary

**The event page finally states which event it is showing — a name/date/location/week header fed by the artifact every tab already reads — and the Events list, search dropdown, Teams-page rank column, and year dropdown all get wired to (or now correctly name) that page for the first time since 07-01 shipped it.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (1 tracer + 2 auto, all `tdd="true"`)
- **Files modified:** 15 (matches the plan's declared `files_modified` exactly)

## Accomplishments

- `EventHeader.tsx`: the D-18 item 8 identity header — h1 (name or event-key fallback), the three-segment `eventMetaLine` (date · location · week), a validated "View on TBA" link — mounted as a DOM sibling above the tab strip, rendering on populated/pending only
- Verified against the live `2024casf` `sigma1@2.0.0+tuned-2026-08` subset artifact per Task 1's precondition: `name: "San Francisco Regional"`, `location: "CA, USA"`, `week: 1`, `startDate: "2024-03-07"`
- `EventsList.tsx` rows and `SearchBox.tsx` event selections now navigate to `/event/{eventKey}` — Phase 7 is reachable from the deployed site for the first time
- `EventsList.tsx`'s location cell delegates to the pipeline's `composeEventLocation`, replacing its own local `locationText` reimplementation
- `columns.tsx`'s leading rank column header is now `${algorithmDisplayLabel(algorithm)} Rank` (D-20), with `rowModel.ts` untouched
- `YearSelect.tsx`'s `resolveYearChangeTarget` discharges Phase 5 D-12's reserved year-change extension point: on an event-detail route, a year change maps to the same event code in the target season when that season published it, and to that season's Events list otherwise

## Task Commits

1. **Task 1: TRACER — event identity header from the artifact to the h1** - `f91ab18e` (feat)
2. **Task 2: Wire Events list and search to /event/{eventKey}** - `1acefbb7` (feat)
3. **Task 3: D-20 rank header, D-12 event-detail year-change** - `718bfb53` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/components/event/EventHeader.tsx` - the identity header component, skeleton, and pure composers (`eventMetaLine`, `formatEventStartDate`, `tbaEventUrl`)
- `apps/web/src/components/event/EventHeader.test.tsx` - 13 tests covering every E1 state and absence combination including week 0
- `apps/web/src/routes/event.$eventKey.tsx` - mounts `EventHeader`/`EventHeaderSkeleton` as a sibling above the tab strip
- `apps/web/src/routes/event.$eventKey.test.tsx` - Tests 13-15 for the header's sibling relationship, pending, and error-branch absence
- `apps/web/src/components/events-list/EventsList.tsx` - name cell is now a router `Link`; location delegates to `composeEventLocation`
- `apps/web/src/components/events-list/EventsList.test.tsx` - router harness added, Tests 1-3 for the new link
- `apps/web/src/routes/events.tsx` - threads `algorithm` into `EventsList`
- `apps/web/src/components/search/SearchBox.tsx` - `SearchNavigate` narrowed to team/event routes; `handleSelectEvent` lands on the real event page
- `apps/web/src/components/search/SearchBox.test.tsx` - Test 5/6/7 for the event-selection navigation
- `apps/web/src/components/teams-table/columns.tsx` - D-20's per-algorithm rank header, width 56 -> 96
- `apps/web/src/components/teams-table/columns.test.tsx` - D-20 describe block, 3 tests
- `apps/web/src/components/ribbon/YearSelect.tsx` - `EVENT_DETAIL_ROUTE_PATTERN`, `resolveYearChangeTarget`, widened `CrossRouteNavigate`
- `apps/web/src/components/ribbon/YearSelect.test.tsx` - Tests 7-13 for the D-12 extension point
- `apps/web/src/lib/eventKey.ts` - `eventKeyForSeason`
- `apps/web/src/lib/eventKey.test.ts` - Tests 4-6

## Decisions Made

See `key-decisions` in frontmatter. Summarized: PD-01 through PD-10 applied exactly as the plan specified (single-artifact prop contract, nullish-vs-non-empty asymmetry between client and publisher, copied week rule with attribution, UTC-pinned date formatting, cell-level link, no `checkpoint:decision`, skeleton co-location, hardcoded-origin TBA URL builder). D-20 and Phase 5 D-12 discharged exactly as their own plans reserved them.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written; no Rule 1/2/3 fixes were needed.

### Documented factual corrections (not fixes — the code is correct as written)

**1. SearchBox.test.tsx's pre-existing case count was 10, not the plan's stated "thirteen"**
- **Found during:** Task 2
- **Detail:** `git show HEAD~2:apps/web/src/components/search/SearchBox.test.tsx | grep -c '  it('` returns 10. The plan's `<behavior>` and acceptance criteria both say "all thirteen pre-existing cases." All 10 pass unmodified and unweakened; one new combined test (Test 5/6/7) was added. This is a planner miscount, not a code defect — noted per this project's established precedent (07-10's corrected write-ups) rather than silently ignored.
- **Files modified:** None (observation only)

**2. `grep -c '"/events"'` over `SearchBox.tsx` reads 1, not the plan's required 0**
- **Found during:** Task 2
- **Detail:** The plan's acceptance criterion reads `grep -vE '^\s*(\*|//|/\*)' apps/web/src/components/search/SearchBox.tsx | grep -c '"/events"'` equals 0, reasoned as "no code path and no type member names the interim list destination any more." The one remaining occurrence is `const isEventsPage = pathname.startsWith("/events");` — D-10's pre-existing lazy-fetch trigger (whether the events artifact should be fetched eagerly because the reader is currently ON the Events list page), which is unrelated to `SearchNavigate`'s navigation destination and was present before this plan and is unrelated to `handleSelectEvent`. Removing it would break the D-10 lazy-fetch feature for no benefit. `SearchNavigate`'s `to` union and every navigate() call site no longer name `/events` — verified directly by reading the diff — so the criterion's literal grep is over-broad but its actual stated intent (no navigation to the interim destination) is genuinely satisfied.
- **Files modified:** None (documented as a criterion/reality mismatch, not fixed)
- **Attempted ledger entry:** `gsd-tools windows append --kind deviation ...` was run to record this in `WINDOWS.md` but failed with `Ledger entry 11 has invalid status: "resolved"` — a pre-existing, unrelated malformed entry in the ledger file blocking any new append. Per the ledger's own "best-effort, never blocks execution" policy this was not chased further; recorded here instead.

---

**Total deviations:** 0 auto-fixed; 2 documented factual corrections (planner miscount, an over-broad literal grep criterion vs. a legitimate unrelated line)
**Impact on plan:** None on shipped behavior. Both items are documentation-accuracy notes, not code defects.

## Issues Encountered

- TanStack Router resolves its initial route match asynchronously even against `createMemoryHistory`, so `EventsList.test.tsx`'s new router-harness-wrapped tests initially rendered an empty `<body><div /></body>` when asserting synchronously right after `render()`. Fixed by wrapping each test's first assertion in `waitFor`/`findBy*`, matching `TeamsTable.test.tsx`'s own already-established pattern for the identical harness. Not a plan defect — the plan's own `read_first` pointed at that file's harness, and this is exactly the asynchrony it already handles.
- `Test 3`'s both-null location case in `EventsList.test.tsx` initially used `screen.getByTitle("—")`, which is ambiguous because `districtKey` also defaults to `null` (rendering a second em-dash-titled cell). Fixed to `getAllByTitle("—")` before any commit — caught during RED-to-GREEN verification, not shipped as a defect.

## User Setup Required

None - no external service configuration required. The one live read (curl against `https://data.sigmascout.org`, Task 1's precondition) is a public, credential-free artifact fetch.

## Next Phase Readiness

- Phase 7 is now reachable end-to-end from the deployed site: Events list rows, search dropdown event hits, and the event page's own header all agree on `/event/{eventKey}`.
- `EVENT_TABS`/`DEFAULT_EVENT_TAB` untouched (`git diff --numstat apps/web/src/lib/searchParams.ts` empty) — 07-18's D-04 relabel and tab-default flip remain one-constant edits.
- `AlgorithmSelect.tsx`, `rowModel.ts`, `Skeletons.tsx` all untouched (confirmed via `git diff --numstat`), and no file outside `apps/web/` appears in this plan's diff (`git diff --stat packages/ apps/worker/` empty).
- 07-16 (the `vpr@` key shape) and 07-18 (the D-04 algorithm rename, the Insights-tab default-tab flip) both inherit `algorithmDisplayLabel` and `DEFAULT_EVENT_TAB` as the single points those later plans change.
- No blockers. `pnpm --filter web typecheck` exits 0; `pnpm --filter web test` is green across the whole 46-file, 626-test web suite (up from 613 pre-plan).

## Self-Check: PASSED

- `apps/web/src/components/event/EventHeader.tsx`: FOUND
- `apps/web/src/components/event/EventHeader.test.tsx`: FOUND
- `apps/web/src/lib/eventKey.ts` exports `eventKeyForSeason`: FOUND (grep confirmed)
- Commit `f91ab18e`: FOUND in `git log --oneline`
- Commit `1acefbb7`: FOUND in `git log --oneline`
- Commit `718bfb53`: FOUND in `git log --oneline`

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*
