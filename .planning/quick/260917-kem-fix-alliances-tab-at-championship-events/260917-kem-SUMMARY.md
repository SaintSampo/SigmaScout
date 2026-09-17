---
phase: quick-260917-kem
plan: 01
subsystem: event-pages
tags: [zod, react, tanstack-table, event-artifact, alliances]

requires: []
provides:
  - "EventArtifactSchema.allianceTeams: an additive optional array publishing as-of-event metrics for a playoff pick who never took the field at that event"
  - "AlliancesTab fallback resolution (teams first, allianceTeams second) so a never-played pick still renders a pill and its alliance can combine"
  - "Championship-gated (event_type 3/4) suppression of the misleading '(backup)' suffix on a real fourth alliance member"
affects: [event-pages, publish-pipeline]

key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/publish.ts
    - apps/web/src/components/event/AlliancesTab.tsx

key-decisions:
  - "D-01: the '(backup)' suffix renders only when artifact.eventType is NOT 3 or 4 (Championship division / Championship finals-Einstein); an absent eventType reads as 'not a Championship', preserving pre-260915-isq artifact behavior"
  - "D-02: allianceTeams is a new additive optional EventArtifactSchema field, reusing EventTeamSchema unchanged, populated only for alliance picks the season's walk-forward actually saw and who have no teams row; never enters teams/matches/upcoming, so those three arrays stay byte-identical with or without it (Jacob: Alliances tab only, standings unchanged)"
  - "D-03: ALLIANCE_COMBINED_PICK_COUNT stays 3. The Combined Total is still the first three picks; a first-three pick resolved through allianceTeams DOES enter the sum and the Sigma band (this is what makes Einstein alliance 1 combinable), while a fourth member never does, played or not"

patterns-established:
  - "A second, narrower metricsAsOfEvent/buildEventTeamsStanding pass (rather than widening the first) whenever a key set needs the same walk-forward computation but must not perturb the original key set's byte-identical output"

requirements-completed: [QUICK-260917-kem]

coverage:
  - id: D1
    description: "Published event artifacts carry allianceTeams for a playoff pick with no teams row, sourced from the season's walk-forward, absent for a pick the season never saw, and never affecting teams/matches/upcoming"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts (buildEventArtifact and publishSeasons allianceTeams groups)"
        status: pass
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts (EventArtifactSchema.allianceTeams)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AlliancesTab renders a pick resolved via allianceTeams (pill + combinability), prefers a teams row when both exist, and the '(backup)' suffix is suppressed only at Championship event types"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx (D-01 and D-02 groups, 11 new tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live verification on real 2026cmptx (Einstein) after republish and deploy"
    verification: []
    human_judgment: true
    rationale: "Needs the owed republish and web deploy, both outside the executor's network-denied sandbox"

completed: 2026-09-17
status: complete
---

# Quick Task 260917-kem: Fix Alliances Tab at Championship Events

**Championship alliances (event_type 3/4) stop mislabelling a real fourth member as "(backup)", and a playoff pick with no teams row at an event (Einstein's frc3006, and every unplayed fourth member) now gets a published `allianceTeams` fallback row so its pill renders and its alliance can combine.**

## Root cause

Verified against the live `2026cmptx` artifact. `publish.ts` builds an event's `teams` from the robots that appear in its matches. Einstein has no qualification matches, so only the 24 robots that took the field got a row. frc3006 (alliance 1, replaced on the field by frc7407) and seven fourth members had none, which left their cells bare and alliance 1 without a Combined Total. Separately, `BackupCell` printed "(backup)" on every pick at index 3 or later, which is wrong wherever alliances have four real members.

## Accomplishments

- `EventArtifactSchema.allianceTeams` (additive, optional, no schema-version bump) reuses `EventTeamSchema`, so the row shape can never diverge from `teams`.
- `publish.ts` derives the alliance-only key list per event (picks minus the standings roster, filtered to teams the season's walk-forward saw, which also drops demo keys) and runs a second, separately scoped `metricsAsOfEvent`/`buildEventTeamsStanding` pass. `teams`/`matches`/`upcoming` are pinned byte-identical with and without the field, at builder level and through `publishSeasons`.
- `pickFromTeamKey` resolves against `teams` first and `allianceTeams` only on a miss. Pill, combinability, Combined Total and Sigma band fall out of the existing path.
- The "(backup)" suffix is gated on `isChampionshipEventType` (TBA event_type 3 or 4). `backupColumnWidth` returns the plain pick width when unlabelled. Column id `pickBackup` and all seven headers are unchanged.
- The approximate-tier pool still reads `artifact.teams` only, so `ALLIANCE_APPROX_TIER_DISCLOSURE` stays true.
- No `apps/worker` change: `artifactMerge.ts` is spread-then-override, so the new field survives a live tick.

## Task Commits

1. **Task 1: publish allianceTeams end to end** - `4e17c6aa` (feat)
2. **Task 2: client fallback and Championship label gate** - `04cf4897` (fix, tests watched red first)
3. **Task 3: dual-scope verification sweep** - verification only, no commit

## Verification

- `publish.test.ts` + `pageArtifacts.test.ts`: 402 to 411 passed. `AlliancesTab.test.tsx`: 63 to 74 passed.
- `apps/web` scope: 116 files, 1893 tests, all passed. Root `tsc --noEmit` and the apps/web tsconfig: clean.
- Root vitest: 5592 passed, 2 failed, neither from this task. `level1Digest.test.ts` was already red at baseline (recorded `4.0.0+baseline` against the live `5.0.0+baseline` bump from 260917-jzh). `apps/worker/test/stateProbe.test.ts` fails against another session's uncommitted `apps/worker/src/stateProbe.ts`.

## Issues Encountered

A concurrent session committed to the same checkout throughout. Once, its staged deletion of `apps/web/src/components/team/useTeamUpcomingOverlay.ts` landed in the index between the executor's status check and its `git add`. It was unstaged with `git restore --staged` (index only) before committing. Neither commit contains a foreign file.

## Owed before this is live

1. `pnpm publish:seasons --write-budget`, then commit `docs/publish-budget.md`. Until then no artifact carries `allianceTeams`. The label fix needs only the web deploy.
2. Web deploy, verified with an `Origin` header or a real browser.
3. Human check on live `2026cmptx`: eight alliances, four numbered members each, no "(backup)" text, alliance 1 shows a Combined Total with its Sigma band, notice gone. Spot-check one regional with a genuine called-in backup for a surviving suffix.
4. Re-run the live-only Playwright specs after deploy.
