---
id: drop-licensed-schedule-templates
created: 2026-09-12
source: rung-2 experiment (rung2-generated-schedules.md, random-vs-generated-schedules.md)
resolves_phase: 9
priority: high
---

# A generated schedule structure matches the licensed grid — the template dependency can go

Measured by two independent sessions, different routes, agreeing floors (73.7% vs 74.2% at
`2025cur` / n=1000).

Compared at the **same** schedule count (n=4000), a rules-based generated structure agrees with the
licensed cheesy-arena grid on **97.1%** of teams within half a median rank (clause 1 needs 95%),
**every** team within 1.0 rank, **100.0% / 99.6%** at the band edges, mean signed shift -0.0018.
All three clauses pass. That 97.1% sits **1.2pp** under the 98.4% same-construction ceiling, so the
residual is not distinguishable from resampling noise.

The arms are genuinely different, so this is not vacuous: at `2025cur` the licensed grid has 0.0%
repeat partners against the generator's 0.1%, 0.1% vs 3.3% repeat opponents, and the generator has
a *shorter* worst idle gap (19.3 vs 24.0). Credited appearances and surrogate counts match exactly.

## What this closes

**D-19 (schedule-template redistribution licensing) evaporates.** It was conditional on the ladder
reaching rung 2 with licensed templates. It no longer is. No licence file has been read or reasoned
about by any agent, and none now needs to be.

## The work

Wire the generator into `buildPreScheduleArtifact` in place of `loadScheduleTemplate`, retire
`packages/harness/scheduleTemplates.ts` and `data/schedule-templates/` (1,331 files), and drop the
`ScheduleTemplateUnavailableError` / `ScheduleTemplateMissingError` skip branches.

**Do not do this before `preschedule-schedule-count-and-acceptance-bar` is settled.** The generator
is only proven at n=4000; at the shipped n=20 nothing is distinguishable from anything, so wiring it
in at the current count would ship an unproven change under a passing-looking test.

`buildPreScheduleArtifact` already gained an optional `scheduleStructure` field, inert at default,
during the experiment — that is the seam.
