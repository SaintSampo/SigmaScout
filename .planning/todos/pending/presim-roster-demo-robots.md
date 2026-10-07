---
id: presim-roster-demo-robots
created: 2026-10-05
source: presim-all-seasons-handoff "Things to check", confirmed on the live artifact at release
priority: high
---

# Pre-schedule sidecars include demo robots in the roster

## What is wrong

The published `v1/presim/2026txmca/spr@10.0.0+baseline.json` (generation 8ee290cd) lists 27 teams.
The event has 18 real teams. The other nine are demo robots, frc9991 to frc9999, which appear only
in its playoff matches. The roster rule takes every team in every played and scheduled match at
every comp level, so they are counted. The "Before schedule release" table for that event ranks
nine robots that never played a qualification match, and `matchesPerTeam` is 8 where 18 teams
would give 12.

This is a published number on a page a reader can open. Since 2026-10-05 the pre-schedule stop is
on every season, so any event whose playoffs carried demo or fill-in robots is affected.

## Counted (quick task 261006-2mg, 2026-10-06)

- **13 events, 26 live sidecars** (SPR and EPA each) out of 3,336, every one confirmed against
  production: 2019week0, 2022arli, 2022bcvi, 2022hiho, 2022mokc3, 2022waspo, 2022wayak,
  2023gaalb, 2024vapor, 2025ncash, 2026mefal, 2026txfor, 2026txmca. The demo keys come in whole
  alliances of three (3, 6 or 9 per event). `matchesPerTeam` is wrong on every one as well.
- 67 offseason events have the same corpus shape but get no sidecar (offseason gate), so they
  are not in production.
- The per-match Simulation tab DOES share the roster: `asOfRewind.ts` builds its baselines from
  `eventArtifact.teams`, which is the same unfiltered match-derived list. The event page's own
  `teams` rows are the recorded carve-out in `apps/web/src/lib/teamKey.ts`, not the defect.
- TBA's own qualification rankings list demo robots that played quals (284 offseason events) and
  never one that played only playoffs, so "played or scheduled for a qualification match" is the
  roster rule that follows TBA's convention and changes exactly these 13 events.
- Full write-up and the proposed changes: `.planning/quick/261006-2mg-simulation-sidecars-include-demo-robots-/261006-2mg-SUMMARY.md`.

## Web half shipped (quick task 261006-2t0, commit aa041e76, 2026-10-06)

Jacob's call: web now, sidecar later. `simulatedTeams` in `apps/web/src/lib/simulationInputs.ts`
restricts every browser simulation roster (Simulation tab, rewound view, Locks ledger input) to
teams on a qualification row, and `fieldSize` follows. **What remains is the publisher half**:
`buildPreScheduleSidecarForEvent`'s roster, SPR and EPA version bumps, and a full republish, to
ride the next republish something else already needs.

## What a fix involves

Restrict the sidecar roster to teams that play (or are scheduled for) a qualification match. That
changes published histograms, so it ships under a new SPR version and a new EPA version (Jacob's
rule, 2026-09-14) and needs a full republish, 3 h 16 min at today's speed.

Count the affected events first. If the list is short, weigh the republish against the size of the
problem with Jacob.

## Found by quick task 261007-4qr (2026-10-07)

That task taught `simulateDistrictEvent` the short-roster rule: under 24 real teams an
eight-alliance event seats `draftedAllianceCount(N, 8)` = floor((N - 1) / 3) whole real alliances,
the remaining seeds are filler alliances that forfeit, and a demo key on a published alliance is
filler. The browser Locks ledger now prices 2023gaalb, 2024vapor, 2025ncash, 2026mefal and
2026txmca. Two roster paths still sit outside that fix:

1. **The as-of GENERATED plan still counts demo robots.** `planAsOfEvent` in
   `apps/web/src/components/districts/asOfRewind.ts` takes its GENERATED roster from
   `eventArtifact.teams` (sorted), not from `simulatedTeams`. A rewound stop before a small event's
   schedule therefore prices the demo robots as teams. The PLAYED split above it already reads
   `simulatedTeams`.
2. **The publisher bake still refuses short rosters.** `packages/harness/districtBake.ts` keeps its
   own `roster-too-small-for-alliances` skip (`sortedRoster.length < allianceCount * 3`). Once
   either roster is restricted to real teams, and for any 2027 district event registered with fewer
   than 24 teams at Live before it starts (the tab reads the publisher's baked pmf there), the bake
   refuses that event. The core's `draftedAllianceCount` and filler alliance rule are now available
   to both the bake and the as-of plan. Relaxing that skip changes no finished season's output, but
   it is publisher code, so it belongs with the publisher half of this todo.
