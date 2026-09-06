---
phase: quick-260905-ttv
plan: 01
subsystem: ui
tags: [react, tanstack-router, zod, tailwind, opr, teams-artifact]

requires:
  - phase: quick-260905-ldu
    provides: "buildTeamRankScopes/deriveTeamRegions/isRealPublishedTeamKey in packages/harness/teamRanks.ts, and the original (standalone-row) RankCards component this task rewrites"
provides:
  - "percentileForRank(rank, total) in teamRanks.ts — the one rank-to-percentile convention, joining percentiles.ts's mid-rank formula"
  - "country/stateProv/districtKey published on every teams/{year} artifact row (additive, no schema version bump)"
  - "Country/State/District filters on the Teams page, URL-backed via TeamsSearchSchema"
  - "Rank cards v2: header-mounted, fixed-width, tier-coloured, each a real /teams link filtered to its own scope"
affects: [teams-page, team-page, teams-artifact-schema]

actuals:
  tokens: 26620
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "percentileForRank specialises percentiles.ts's mid-rank formula to a strict total order, joining the site's one percentile convention rather than opening a second one"
    - "teamFilterModel.ts mirrors events-list/filterModel.ts's shape (option-list derivation + filter predicate) without importing across the teams-table/events-list module boundary — copied per SeasonHeader.tsx's existing formatRecord precedent"
    - "Rank-card tier colouring reuses lib/tiers.ts's tierForPercentile — no second tier-cut implementation"

key-files:
  created:
    - apps/web/src/components/teams-table/teamFilterModel.ts
    - apps/web/src/components/teams-table/teamFilterModel.test.ts
    - apps/web/src/components/teams-table/TeamsFilters.tsx
    - apps/web/src/components/teams-table/TeamsFilters.test.tsx
  modified:
    - packages/harness/teamRanks.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/routes/teams.tsx
    - apps/web/src/components/teams-table/TeamsTable.tsx
    - apps/web/src/components/team/RankCards.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/OverviewTab.tsx
    - apps/web/src/styles/theme.css
    - apps/web/src/test/routerHarness.tsx
    - apps/web/src/routes/team.$teamNumber.tsx

key-decisions:
  - "rankableTeamRows in publish.ts now ranks against ROUNDED metrics (roundTeamMetricRecord), not raw values — a rounding-induced tie between two teams is exactly the collision the invariant test proves is still resolved consistently between the per-team artifact's rank and the teams artifact's own sort order"
  - "Region fields on the teams artifact are additive optional fields; PAGE_ARTIFACT_SCHEMA_VERSION was deliberately NOT bumped, matching the ldu precedent one day earlier for the same artifact family"
  - "TeamsFilters.tsx uses one wrapping control row for both viewports, deliberately no mobile sheet (unlike EventFilters.tsx) — three dimensions with no staged-apply decision fit the existing row-sizing convention without D-15's mechanism"
  - "rows are filtered BEFORE buildTeamRows in routes/teams.tsx so the Teams table's rank column reflects the active filter's own pool — the invariant the rank cards' links depend on"
  - "RankCards moved from a standalone row below the header into SeasonHeader's own identity row; OverviewTab no longer mounts it"
  - "The rank-cards-basis caption is permanently deleted, not hidden — the cards now sit in the same card as the as-of line, which already labels the same official-only snapshot pool"
  - "SeasonHeaderProps/OverviewTabProps.algorithmId narrowed string -> PublishedAlgorithmId so RankCards' Link typechecks; no real caller needed a code change"

patterns-established:
  - "Pattern: a rank card's tier is derived per-card from percentileForRank(rank, total) then tierForPercentile — never a second set of tier cuts"
  - "Pattern: .rank-card is declared after .data-card in theme.css specifically so a tier modifier's background wins at equal specificity"

requirements-completed: []

coverage:
  - id: D1
    description: "Region fields (country/stateProv/districtKey) published on every teams/{year} artifact row, additive and schema-version-stable"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#TeamsTableRowRawSchema — country/stateProv/districtKey (quick task 260905-ttv)"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts#buildTeamsArtifact — region field emission/omission tests (quick task 260905-ttv)"
        status: pass
      - kind: integration
        ref: "packages/harness/publish.test.ts#publishSeasons — World rank cross-artifact agreement — region field assertions on the seeded 2026rnk corpus"
        status: pass
    human_judgment: false
  - id: D2
    description: "percentileForRank(rank, total) — the one rank-to-percentile convention, agreeing with percentiles.ts's percentileRanks"
    verification:
      - kind: unit
        ref: "packages/harness/teamRanks.test.ts#percentileForRank (quick task 260905-ttv)"
        status: pass
    human_judgment: false
  - id: D3
    description: "World rank on a team's own artifact agrees with the teams artifact's own sort order after the wire round-trip, even when two teams tie exactly under OPR's rounded metrics"
    verification:
      - kind: integration
        ref: "packages/harness/publish.test.ts#publishSeasons — World rank cross-artifact agreement — rounding-collision tie test"
        status: pass
    human_judgment: false
  - id: D4
    description: "Country/State/District dropdowns on the Teams page, URL-backed, disabled-and-empty on a pre-republish artifact, filtering rows before ranking"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/teamFilterModel.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/teams-table/TeamsFilters.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/teams-table/TeamsTable.test.tsx#filtered-to-zero empty state (quick task 260905-ttv)"
        status: pass
    human_judgment: true
    rationale: "Live rendering/wrapping behavior at real viewport widths and the on-site look of the filter row are visual judgments; the plan's own post_plan_note also states the filters stay disabled on the live site until the pending republish lands, so live spot-check is deferred to that event."
  - id: D5
    description: "Rank cards v2: mounted inside SeasonHeader's identity row, fixed-width, tier-coloured, each a /teams link carrying year+algorithm+scope, with the district/state rank-agreement invariant proven by a test"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/RankCards.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/team/SeasonHeader.test.tsx#rank cards render inside the header (quick task 260905-ttv)"
        status: pass
    human_judgment: true
    rationale: "Visual layout (right-aligned at wide widths, wrapping below at narrow ones) and the rarity-tier colour treatment are visual/design judgments the sketch-findings-sigmascout skill's palette validates in principle but a human should spot-check on the live page once republished, per the plan's post_plan_note."

duration: ~2h
completed: 2026-09-06
status: complete
---

# Quick Task 260905-ttv: Rank Cards v2 and Teams Page Region Filters Summary

**Region fields on the teams artifact, Country/State/District filters on the Teams page, and rank cards v2 — mounted in the season-header identity row, fixed-width, tier-coloured, each a real `/teams` link filtered to its own scope, with the district/state rank agreement proven by a test.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-09-06T04:09:53Z
- **Tasks:** 3
- **Files modified:** 22 (across 3 commits; 4 new files)

## Accomplishments

- `packages/harness/teamRanks.ts` gained `percentileForRank(rank, total)` — the mid-rank percentile convention specialised to a strict total order, joining `percentiles.ts`'s one existing convention rather than opening a second one. Verified: rank 1 of 3481 lands at/above the Legendary cut, rank 3481 of 3481 lands below the Common cut, rank 1 of 1 lands at exactly 50 (a deliberate, tested outcome), and the function agrees with `percentileRanks` on a shared fixture.
- Every published `teams/{year}` artifact row now carries `country`/`stateProv`/`districtKey` (additive optional fields, `PAGE_ARTIFACT_SCHEMA_VERSION` unchanged) sourced from the once-per-season `deriveTeamRegions` map already computed for the per-team rank cards.
- `publish.ts`'s per-team World-rank computation now ranks against ROUNDED metrics (`roundTeamMetricRecord`), closing a latent one-place-off gap between the rank a team's own artifact publishes and the rank a client recomputes from the wire-rounded teams artifact. Proven with a fixture where two teams are mathematically indistinguishable to OPR's design matrix (always paired on the same alliance) and therefore tie exactly — the published World rank for both still equals their index+1 in the sorted, rounded artifact.
- The Teams page gained Country/State/District dropdowns (`teamFilterModel.ts`, `TeamsFilters.tsx`), URL-backed via three new `TeamsSearchSchema` fields shared by name with `EventsSearchSchema`. Rows are filtered BEFORE `buildTeamRows`, so the rank column reflects the active filter's own pool. A pre-republish artifact (no region fields) renders all three dropdowns disabled and empty, no error. `TeamsTable`'s empty state now branches between the year-gap copy and a filtered-to-zero copy naming the filters as the cause, with a Clear-filters action.
- Rank cards v2: `RankCards` now mounts inside `SeasonHeader`'s identity row (right-aligned, wrapping below at narrow widths) instead of as a standalone row `OverviewTab` used to render. Every card shares one fixed-width `.rank-card` class (theme.css, declared after `.data-card` so a tier's background wins the cascade) regardless of label length, with long labels truncating and carrying the full text on `title`. Each card is coloured by `tierForPercentile(percentileForRank(rank, total))` — its own rank/total, so the four cards on one page can and do carry different tiers. Each card is a real TanStack `Link` to `/teams` carrying the page's current year and algorithm plus its own scope preset (World: none; Country: `country`; District: `district`; State: `country=USA` + `state`). The "Ranked by total, official play only" basis caption is permanently deleted. The district and state scopes' rank/total are proven to agree with `buildTeamRows(applyTeamFilters(...))` under each card's own link preset — the invariant this whole feature rests on, checked by a test rather than a comment.

## Task Commits

Each task was committed atomically:

1. **Task 1: Region fields on the teams artifact, and the rank-to-percentile rule — pipeline end to end** - `bc9df4f2` (feat)
2. **Task 2: Country / State / District filters on the Teams page** - `a9a18bcc` (feat)
3. **Task 3: Rank cards v2 — into the header card, fixed width, tier-coloured, clickable** - `69fcae13` (feat)

_No separate TDD test/feat/refactor commit split — each task's RED+GREEN landed in one commit per the plan's stated per-task commit protocol._

## Files Created/Modified

- `packages/harness/teamRanks.ts` - added `percentileForRank`
- `packages/harness/teamRanks.test.ts` - tests for `percentileForRank`
- `packages/harness/pageArtifacts.ts` - `TeamsTableRowRawSchema` gains optional `country`/`stateProv`/`districtKey`
- `packages/harness/pageArtifacts.test.ts` - schema tests for the new region fields, including alongside positional metrics
- `packages/harness/publish.ts` - `TeamsArtifactTeamInput` widened; `buildTeamsArtifact` emits region fields when present; `teamsRows` spreads `teamRegions`; `rankableTeamRows` ranks against rounded metrics
- `packages/harness/publish.test.ts` - region-field emission tests, seeded-corpus region assertions, and the rounding-collision tie test
- `apps/web/src/components/teams-table/teamFilterModel.ts` (new) - option-list derivation + filter predicate over the teams artifact's region fields
- `apps/web/src/components/teams-table/teamFilterModel.test.ts` (new) - tests
- `apps/web/src/components/teams-table/TeamsFilters.tsx` (new) - Country/State/District control row
- `apps/web/src/components/teams-table/TeamsFilters.test.tsx` (new) - tests
- `apps/web/src/components/teams-table/TeamsTable.tsx` - `hasActiveFilter`/`onClearFilters` props, branched empty state
- `apps/web/src/components/teams-table/TeamsTable.test.tsx` - empty-state branch tests
- `apps/web/src/lib/searchParams.ts` - `TeamsSearchSchema` gains `country`/`state`/`district`
- `apps/web/src/routes/teams.tsx` - filters wired to the URL, applied before ranking, `TeamsFilters` rendered above the table
- `apps/web/src/components/team/RankCards.tsx` (rewritten) - header-mounted, fixed-width, tier-coloured, clickable cards
- `apps/web/src/components/team/RankCards.test.tsx` (rewritten) - full new behavior coverage plus the district/state agreement test
- `apps/web/src/components/team/SeasonHeader.tsx` - accepts `ranks`, `algorithmId` narrowed to `PublishedAlgorithmId`, identity row restructured to host the cards
- `apps/web/src/components/team/SeasonHeader.test.tsx` - new case asserting cards render inside the header
- `apps/web/src/components/team/OverviewTab.tsx` - no longer mounts `RankCards` directly; threads `artifact.ranks` to `SeasonHeader`
- `apps/web/src/styles/theme.css` - `.rank-card` + four `.rank-card--{tier}` modifiers
- `apps/web/src/test/routerHarness.tsx` - added a `/teams` route so Link-rendering tests have a real target
- `apps/web/src/routes/team.$teamNumber.tsx` - the zero-events branch's direct `SeasonHeader` call now passes `ranks`

## Decisions Made

- Ranked `rankableTeamRows` against rounded metrics rather than raw values (Task 1) — see key-decisions above; this closes a latent bug the plan's own invariant section named as the reason the change exists.
- Kept `TeamsFilters` to one wrapping row with no mobile sheet, unlike `EventFilters` — three dimensions with no staged-apply decision don't need D-15's mechanism (documented in the component's own header).
- Gated the Teams page's filter-row visibility on `data !== undefined` (the fetch itself succeeded) rather than the literal `status === "success"` local variable, since that variable also folds in the filtered row count — hiding the filter controls the moment a filter empties the table would strand the reader with only the empty state's own Clear-filters link as a way back.
- Narrowed `SeasonHeaderProps`/`OverviewTabProps.algorithmId` from `string` to `PublishedAlgorithmId` — the plan's own bound on this change (stop if it cascades beyond these two components, their tests, and `routes/team.$teamNumber.tsx`) held; no other file needed a change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the shared `test/routerHarness.tsx` with a `/teams` route**
- **Found during:** Task 3 (writing `RankCards.test.tsx`'s new Link-rendering tests)
- **Issue:** `RankCards` now renders a real TanStack `<Link to="/teams">`. The shared router test harness (`apps/web/src/test/routerHarness.tsx`), which the plan's own read_first list pointed at for reuse, only registered `/event/$eventKey` and `/team/$teamNumber` — no `/teams` route existed for the Link to resolve against.
- **Fix:** Added a `/teams` route (`validateSearch: TeamsSearchSchema`) to the shared harness's route tree, never rendered as the initial route.
- **Files modified:** `apps/web/src/test/routerHarness.tsx`
- **Verification:** All 23 new/updated `RankCards.test.tsx` tests pass; the pre-existing consumers of this harness (`EventSection.test.tsx`, `columns.test.tsx`, `ElimsTab.test.tsx`, `QualsTab.test.tsx`, `TeamStates.test.tsx`, `EventMatchTable.test.tsx`) are unaffected — full repo test suite (1495 tests) still green.
- **Committed in:** `69fcae13` (Task 3 commit)

**2. [Rule 2 - Missing consistency] Threaded `ranks` into `team.$teamNumber.tsx`'s zero-events branch**
- **Found during:** Task 3 (moving `RankCards` inside `SeasonHeader`)
- **Issue:** `routes/team.$teamNumber.tsx` renders `SeasonHeader` directly (not via `OverviewTab`) in its zero-events branch. Now that `SeasonHeader` accepts an optional `ranks` prop and renders the cards itself, that branch would have silently continued showing no rank cards even when the artifact carries them — an inconsistency with the normal `OverviewTab` path, not a plan requirement to add but a natural gap the refactor would otherwise leave behind.
- **Fix:** Added `ranks={data.ranks}` to that one call site. `ranks` is optional and gracefully renders nothing when empty/undefined, so this is a strict improvement with no new failure mode.
- **Files modified:** `apps/web/src/routes/team.$teamNumber.tsx`
- **Verification:** `apps/web/src/routes/team.$teamNumber.test.tsx`'s existing fixtures carry no `ranks` field, so this change is a no-op for that suite (still green); `npx tsc --noEmit` clean in `apps/web`.
- **Committed in:** `69fcae13` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-consistency)
**Impact on plan:** Both auto-fixes were necessary to make the plan's own stated test coverage runnable (the router harness) and to avoid a newly-inconsistent behavior the refactor would otherwise silently introduce (the zero-events branch). No scope creep — no new user-facing feature was added beyond what the plan specified.

## Issues Encountered

None beyond the two deviations above. All three tasks' `<verify>` commands passed on the first real run once the code was in place; no test needed a second iteration to correct a wrong assumption.

## User Setup Required

None - no external service configuration required.

**Operational note (not user setup, but action-required):** Per the plan's `<post_plan_note>`, the Teams-page filters stay disabled on the live site until `pnpm publish:seasons` runs (the three region fields are new, so every artifact currently in R2 lacks them). That republish must run from the main session (executor sandboxes deny network Bash) and is not part of this quick task's scope — a republish is already pending on user signal from quick tasks 260905-jj8 and 260905-ldu, and this change can ride along with that run.

## Next Phase Readiness

- All code changes are complete, tested (1495 tests green across the full verification scope), and typecheck-clean (`apps/web` clean; `apps/worker` shows only the 4 known pre-existing `redDqs`/`blueDqs` baseline errors, unrelated to this work).
- Live verification of the filters and the rank cards' colours/links is blocked on the pending republish (see above) — the plan's own post_plan_note names the exact spot-check to do once it lands: one team page's rank cards (colours differ across the four scopes) and one rank-card click (the destination table's rank for that team matches the card).

## Self-Check: PASSED

All 13 modified/created source files and all 3 task commits (`bc9df4f2`, `a9a18bcc`, `69fcae13`) verified present on disk / in `git log --oneline --all`.

---
*Phase: quick-260905-ttv*
*Completed: 2026-09-06*
