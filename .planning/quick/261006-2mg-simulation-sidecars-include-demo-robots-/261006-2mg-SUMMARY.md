---
phase: quick-261006-2mg
plan: 01
subsystem: publish-pipeline
tags: [presim, pre-schedule, demo-teams, simulation, investigation]
status: complete
requires: [presim-roster-demo-robots todo]
provides: ["Count of events whose simulation roster carries playoff-only demo robots, verified against production, and a proposed fix"]
affects: [.planning/todos/pending/presim-roster-demo-robots.md]
key-files:
  modified:
    - .planning/todos/pending/presim-roster-demo-robots.md
decisions:
  - "Investigation only. No source change, no version bump, no republish. The fix is proposed for Jacob to choose."
  - "Recommended roster rule: a simulated team is one that played or is scheduled for a qualification match. This is the convention TBA's own rankings follow: TBA ranks demo robots that played quals (284 offseason events) and never one that played only playoffs."
actuals:
  tasks: 3
  commits: 1
completed: 2026-10-06
---

# Quick task 261006-2mg: playoff-only demo robots in simulation rosters

## Count

Live sidecars carrying demo robots that played no qualification match: **13 events, 26 sidecars**
(SPR and EPA each), out of 3,336 sidecars in generation 8ee290cd. Every one of the 13 was
confirmed by fetching the published `spr@10.0.0+baseline` and `epa@14.0.0+baseline` sidecars
on 2026-10-06.

| Event | Roster published | Qualification teams | Demo keys | Matches per team published |
|---|---:|---:|---:|---:|
| 2019week0 | 25 | 22 | 3 | 3 |
| 2022arli | 25 | 19 | 6 | 9 |
| 2022bcvi | 25 | 22 | 3 | 10 |
| 2022hiho | 27 | 24 | 3 | 10 |
| 2022mokc3 | 27 | 24 | 3 | 12 |
| 2022waspo | 25 | 19 | 6 | 9 |
| 2022wayak | 25 | 22 | 3 | 10 |
| 2023gaalb | 27 | 21 | 6 | 9 |
| 2024vapor | 26 | 23 | 3 | 10 |
| 2025ncash | 25 | 22 | 3 | 10 |
| 2026mefal | 26 | 20 | 6 | 9 |
| 2026txfor | 27 | 24 | 3 | 10 |
| 2026txmca | 27 | 18 | 9 | 8 |

Every affected sidecar has two wrong numbers, not one: the ranked roster, and `matchesPerTeam`,
which `matchesPerTeamFor` derives from the inflated roster size (2026txmca publishes 8 where 18
teams would give 12). Every schedule the sidecar baked was generated for the wrong team count.

The demo keys are always whole alliances of three (3, 6 or 9): a playoff forfeit or bye bucket,
exactly the "fully demo alliance" case `demoTeams.ts` already drops from rating updates.

### Corpus-wide, before the sidecar gates

| Population | Events | Demo robot only in non-qualification matches | Demo robot anywhere in roster | Demo robot in qualification matches |
|---|---:|---:|---:|---:|
| Official and preseason (type 0 to 6, 100) | 1,709 | 13 | 14 | 1 |
| Offseason (type 99) | 679 | 67 | 338 | 320 |

Offseason events get no pre-schedule sidecar (explicit gate, quick task 261004-uyc), so the 67
offseason events are not in production and the published count is the 13 above. The one
official event with a demo robot in quals is not affected (it played quals, so it belongs in a
qualification ranking).

By season, the 13: 2019 1 (week 0), 2022 6, 2023 1, 2024 1, 2025 1, 2026 3.

### The per-match Simulation tab shares the roster

`asOfRewind.ts` builds the rewind's baselines from `eventArtifact.teams` plus the upcoming
matches' teams. `eventArtifact.teams` is the same match-derived list the sidecar roster comes from
(`eventTeamKeys` in `publish.ts`), unfiltered. So for the 13 events the per-match rewind ranks the
same demo robots. The live 2026txmca event artifact carries nine `Off-Season Demo Team` rows with
empty metrics in `teams`.

Those rows in the event artifact's `teams` list are NOT the defect. `apps/web/src/lib/teamKey.ts`
records the carve-out: event pages show whoever actually played, and the demo robots did play
there. The defect is scoped to the qualification rank simulation, which no playoff-only robot ever
took part in.

### Out of scope, measured so nobody re-counts it

Real team keys that appear only in non-qualification matches: 506 team-event pairs at official
events. They are dominated by playoff-only events (2022cmptx, the Einstein field) and backup
robots called in during eliminations. Twelve placeholder keys (`frc0`, keys with stray
characters) do the same at offseason events. Neither is a demo-robot problem and neither is
addressed by the proposal below.

## Proposal

**Roster rule for the simulation: a team is simulated only if it played or is scheduled for a
qualification match.** When an event has no qualification rows at all, fall back to the registered
roster with demo keys removed (the fallback the publisher already uses for scheduleless events).

This is the convention TBA already publishes: TBA's qualification rankings list demo robots at 284
offseason events where they played quals, and never a robot that played only playoffs. The rule
changes exactly the 13 events above and nothing else in production.

Not recommended: a rule that also drops demo keys that played quals. It diverges from TBA's own
rankings at 284 offseason events for no published benefit, since offseason events get no sidecar.

Not viable: a web-only filter at read time. The histograms were baked over 25 to 27 ranks and
`matchesPerTeam` is baked into the schedules, so hiding rows in the browser leaves the draws
wrong. The sidecar has to be rebuilt.

### Changes

1. `packages/harness/publish.ts`: build a qualification-derived roster for
   `buildPreScheduleSidecarForEvent` (teams in played plus scheduled `qm` rows), leaving
   `eventTeamKeys` and the event artifact's `teams` untouched. Regression test on a
   2026txmca-shaped fixture: roster 18, `matchesPerTeam` 12.
2. `apps/web/src/components/districts/asOfRewind.ts`: build the rewind baselines from the `qm`
   rows (the `raw` map it already holds) rather than `eventArtifact.teams`. Web only, ships on
   the next Pages deploy, no republish.
3. Version bumps under the 2026-09-14 rule (changed published numbers ship under a new version):
   SPR 10.0.0 to 11.0.0 and EPA 14.0.0 to 15.0.0. OPR publishes no sidecar and its artifacts do
   not change. The SPR bump moves the level1-digest version string, a guarded file that stays red
   on main until Jacob approves it.
4. Full republish, 3 h 16 min at the 2026-10-05 speed, during which the Worker does not fold, so
   not during a live event. Then prune the superseded SPR and EPA generations.

The Worker needs no change: sidecars are pipeline-only and playoffs come after the pre-schedule
stop is useful.

### Cost against size

26 wrong sidecars of 3,336, every one on a page a reader can open, against a version bump on two
algorithms and a full republish. Change 2 is independent and cheap; change 1 can wait for the next
republish any other change already needs.
