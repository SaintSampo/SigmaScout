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

## Not known

- How many events. Nobody has counted. A count needs one pass over the 3,336 sidecars comparing
  each roster against the event's qualification teams.
- Whether the live Simulation tab's per-match run has the same roster for those events.

## What a fix involves

Restrict the sidecar roster to teams that play (or are scheduled for) a qualification match. That
changes published histograms, so it ships under a new SPR version and a new EPA version (Jacob's
rule, 2026-09-14) and needs a full republish, 3 h 16 min at today's speed.

Count the affected events first. If the list is short, weigh the republish against the size of the
problem with Jacob.
