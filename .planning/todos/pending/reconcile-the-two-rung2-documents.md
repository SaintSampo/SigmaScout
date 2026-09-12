---
id: reconcile-the-two-rung2-documents
created: 2026-09-12
source: two sessions ran rung 2 concurrently by different routes
resolves_phase: 9
priority: low
---

# Two independent rung-2 records exist and should become one

- `docs/models/rung2-generated-schedules.md` (19 KB) — Phase A/B/C, generated structure measured
  through the real `buildPreScheduleArtifact` via an inert `scheduleStructure` seam, written by
  `scripts/measureGeneratedSchedules.ts --render-doc`.
- `docs/models/random-vs-generated-schedules.md` (53 KB, `5454999e`) — the same question by a
  different route, `scripts/measureRandomSchedules.ts`.

**They corroborate rather than conflict**, which is the valuable part: independently built harnesses
reproduce each other's binding floor at the same event and count (73.7% vs 74.2% at `2025cur`,
n=1000), and both conclude the licensed grid can be dropped and the bar is the real defect.

Merge into one record, keeping both derivations where the methods differ, and state plainly that the
agreement is between independent implementations — that is the strongest evidence either one has,
and it is lost if one is simply deleted.

Neither document should be acted on before this is done, so that two sessions do not wire the
generator in from two sources of truth.
