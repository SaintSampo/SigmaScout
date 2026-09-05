---
phase: quick-260905-ldu
plan: 01
subsystem: ui
tags: [react, zod, ranking, team-page, teams-table, pipeline]

requires: []
provides:
  - "packages/harness/teamRanks.ts: shared isRealPublishedTeamKey/compareTeamsByTotal/deriveTeamRegions/buildTeamRankScopes module, importable by both the offline pipeline and the browser bundle"
  - "TeamSeasonArtifactSchema.ranks: optional, max-4 World/Country/District/State rank array, additive and backward-compatible"
  - "RankCards.tsx: presentational rank-card row mounted on the team page Overview"
affects: [teams-table, team-page, publish-pipeline]

actuals:
  tokens: 16400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One comparator, two consumers: packages/harness/teamRanks.ts's compareTeamsByTotal is now the single ranking implementation shared by the offline pipeline (publish.ts) and the client (rowModel.ts), so a published rank and a client-computed rank cannot disagree by construction."
    - "Rank the rows about to be published, not a separately assembled set: publish.ts computes rank scopes from the SAME teamsRows array that becomes the teams/{year} artifact."

key-files:
  created:
    - packages/harness/teamRanks.ts
    - packages/harness/teamRanks.test.ts
    - apps/web/src/components/team/RankCards.tsx
    - apps/web/src/components/team/RankCards.test.tsx
  modified:
    - packages/harness/browserSafeSchemas.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - apps/web/src/components/teams-table/rowModel.ts
    - apps/web/src/lib/teamKey.ts
    - apps/web/src/components/team/OverviewTab.tsx

key-decisions:
  - "isRealTeamKey (apps/web/src/lib/teamKey.ts) now re-exports teamRanks.ts's isRealPublishedTeamKey under its original name, rather than keeping a second copy of the frc{digits}-positive rule."
  - "rowModel.ts's buildTeamRows sorts with the shared compareTeamsByTotal instead of an inline comparator; byTeamNumberAscending is kept only for sortTeamRows, a genuinely different concern."
  - "publish.ts derives home regions (deriveTeamRegions) exactly once per season, before the per-algorithm loop, since a team's competition geography does not depend on which algorithm scored it."
  - "buildTeamSeasonArtifact normalizes both an omitted ranks param and an empty array to an omitted ranks key on the wire -- 'computed, found nothing' and 'never computed' both render identically, so the schema never needs to carry an empty array."
  - "browserSafeSchemas.test.ts gained a seventh entry point for teamRanks.ts, checked ONLY for Node built-in imports (not the stricter 'never reaches packages/core/algorithms/' check) because this module intentionally imports eventTypes.ts/types.ts from there -- same treatment already given to the breakdown/rp-constants/rank-simulation entry points."

requirements-completed: []

coverage: []

duration: ~60min
completed: 2026-09-05
status: complete
---

# Quick Task 260905-ldu: World/Country/District/State Rank Cards Summary

**Shared World-ranking comparator (`teamRanks.ts`) now powers both the Teams table and a new set of up to four rank cards published on every team artifact and rendered on the team page Overview.**

## Performance

- **Duration:** ~60 min
- **Tasks:** 3
- **Files modified/created:** 12

## Accomplishments

- New dependency-free `packages/harness/teamRanks.ts` module: `isRealPublishedTeamKey`, `compareTeamsByTotal`, `deriveTeamRegions`, and `buildTeamRankScopes` — one implementation the offline pipeline and the browser both import, so a team's published World rank and the Teams table's client-side rank cannot drift apart.
- `deriveTeamRegions` infers each team's home country/state/district purely from where it competed this season, excluding neutral-site championship events (Championship Division/Finals/Festival of Champions) from the geo vote, breaking frequency ties by earliest-starting event.
- `TeamSeasonArtifactSchema.ranks`: a new optional, max-4-entry array published on the per-team artifact — additive, no schema version bump, following the `robotImageUrl`/`activeYears`/`EventsListRowSchema` precedent for backward-compatible optional fields.
- `publish.ts` derives regions once per season (before the per-algorithm loop) and computes each team's rank scopes from the exact `teamsRows` array it is about to publish on the teams/{year} artifact — proven by an end-to-end cross-artifact agreement test against a seeded corpus.
- `RankCards.tsx`: renders up to four cards (World, Country, District, State) directly from the published `ranks` array, with `districtDisplayName` used for district labels, a locale-grouped denominator always visible, one basis caption, and each card's label/number pair exposed as a single accessible group. Renders nothing at all when `ranks` is absent or empty.
- `rowModel.ts` and `teamKey.ts` rewired onto the shared module (`compareTeamsByTotal`, `isRealPublishedTeamKey`) with zero behavior change — proven by the pre-existing `rowModel.test.ts`/`teamKey.test.ts`/`teamKey.realTeams.test.ts` suites passing unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared home-region derivation and scoped ranking** - `31a3dc2b` (feat)
2. **Task 2: Publish the four ranks on the team artifact, and put the Teams table on the same comparator** - `086aef90` (feat)
3. **Task 3: RankCards on the team page Overview** - `b6524d88` (feat)

_No TDD RED/GREEN split commits — each task's tests were authored alongside its implementation and both landed in the same atomic commit, per this plan's existing convention (matching how prior quick tasks in this repo commit `tdd="true"` tasks)._

## Files Created/Modified

- `packages/harness/teamRanks.ts` - shared isRealPublishedTeamKey/compareTeamsByTotal/deriveTeamRegions/buildTeamRankScopes module
- `packages/harness/teamRanks.test.ts` - full behavior coverage for the module above
- `packages/harness/browserSafeSchemas.test.ts` - seventh entry point proving teamRanks.ts never reaches a Node built-in import
- `packages/harness/pageArtifacts.ts` - new TeamSeasonRankSchema + TeamSeasonArtifactSchema.ranks
- `packages/harness/pageArtifacts.test.ts` - TeamSeasonRankSchema accept/reject cases
- `packages/harness/publish.ts` - once-per-season deriveTeamRegions call, per-team rank-scope computation from teamsRows, threaded into buildTeamSeasonArtifact
- `packages/harness/publish.test.ts` - buildTeamSeasonArtifact ranks emit/omit cases + end-to-end cross-artifact agreement test
- `apps/web/src/components/teams-table/rowModel.ts` - buildTeamRows now sorts with the shared compareTeamsByTotal
- `apps/web/src/lib/teamKey.ts` - isRealTeamKey re-exports teamRanks.ts's isRealPublishedTeamKey
- `apps/web/src/components/team/RankCards.tsx` - new rank-cards component
- `apps/web/src/components/team/RankCards.test.tsx` - full behavior coverage
- `apps/web/src/components/team/OverviewTab.tsx` - mounts RankCards after SeasonHeader, before EventSectionList

## Decisions Made

- `isRealTeamKey` re-exports `isRealPublishedTeamKey` rather than keeping a parallel copy — one implementation, two call sites.
- `rowModel.ts`'s ranking sort body was deleted in favor of the shared `compareTeamsByTotal`; `byTeamNumberAscending` stays for `sortTeamRows`, a different concern (per-column sort tie-break, not ranking).
- Region derivation happens exactly once per season in `publish.ts`, reusing `teamStats`'s already-computed `eventKeys` sets rather than re-walking the match stream.
- Rank scopes are computed from the exact `teamsRows` array about to be published on the teams/{year} artifact (not a separately assembled set), which is what makes the World rank agreement guarantee hold by construction rather than by convention.
- `buildTeamSeasonArtifact` normalizes both "no ranks passed" and "ranks: []" to an omitted `ranks` key on the wire — "computed, found nothing" and "never computed" render identically to a client either way, so the wire format never needs to distinguish them.
- `browserSafeSchemas.test.ts`'s new `teamRanks.ts` entry point is checked ONLY for Node built-in imports, not the stricter "never reaches packages/core/algorithms/" check — this module intentionally imports `eventTypes.ts`/`types.ts` from there, matching the existing carve-out already given to the breakdown/rp-constants/rank-simulation entry points.

## Deviations from Plan

None — plan executed exactly as written. All three tasks, their `<behavior>` specs, and their `<verify>` commands were followed literally.

## Issues Encountered

None. Three unrelated test files (`algorithmIdentity.test.ts`, `seasonParamSets.test.ts`) hit transient 5-second timeouts on one full-suite run under concurrent system load; re-running them in isolation (and the full targeted verification scope again) showed all green — not a regression from this work, and neither file was touched by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**The cards do not appear on the live site until a republish.** `ranks` is a new optional field; every artifact currently in R2 lacks it, so every team page renders zero rank cards until `pnpm publish:seasons` runs and rewrites the per-team artifacts. Per the plan's own post-plan note:

- The publish run must happen from the main session (executor sandboxes deny network Bash, including `pnpm publish:seasons`).
- `docs/publish-budget.md` needs a manual transcription pass after the run — the `team` page kind has the thinnest headroom of any page kind (400,000 byte budget vs. 376,339 current max), and four rank entries (~200 bytes) should fit comfortably but the margin is worth confirming rather than assuming.
- A republish is already pending on user signal from quick task 260905-jj8; this change can ride along with that run rather than triggering a separate one.

No blockers otherwise. `npx tsc --noEmit` is clean, and `npx vitest run packages/harness apps/web/src/components/team apps/web/src/components/teams-table apps/web/src/lib` passes 78/78 files, 1423/1423 tests.

## Self-Check: PASSED

- `packages/harness/teamRanks.ts` — FOUND
- `packages/harness/teamRanks.test.ts` — FOUND
- `apps/web/src/components/team/RankCards.tsx` — FOUND
- `apps/web/src/components/team/RankCards.test.tsx` — FOUND
- Commit `31a3dc2b` — FOUND in `git log --oneline --all`
- Commit `086aef90` — FOUND in `git log --oneline --all`
- Commit `b6524d88` — FOUND in `git log --oneline --all`

---
*Phase: quick-260905-ldu*
*Completed: 2026-09-05*
