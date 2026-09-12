---
id: stop-baking-preschedule-schedules
created: 2026-09-12
source: rung-2 experiment Phase C — the aggregate grows logarithmically, the schedules block does not
resolves_phase: 9
priority: medium
---

# The pre-schedule artifact ships priced schedules nothing reads — dropping them makes a high count cheaper than today

`preScheduleResult.ts:42` reads only `baked.histograms`. The priced `schedules` block is shipped and
never computed from. Plan 09-09 independently measured it at **95.8-98.6%** of the artifact.

Measured at `2025cur`:

| schedules | aggregate-only | whole artifact |
|---|---|---|
| 20 | 16,084 B | 411 KB |
| 4,000 | **28,200 B** | 79 MB |

**200x the schedules for 1.75x the bytes** — the aggregate grows logarithmically because it is a
rank histogram, not a match list. The whole artifact grows linearly and is unshippable at any useful
count.

So a high schedule count is not merely affordable: it ships **smaller than today's file** while
being far more accurate. This is what makes
`preschedule-schedule-count-and-acceptance-bar` actionable rather than theoretical, and it should
land first or alongside it.

Nothing on the client needs changing — it already reads only the aggregate. This is dropping a field
from the published shape and its schema, not a rewrite.
