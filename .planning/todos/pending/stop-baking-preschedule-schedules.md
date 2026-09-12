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

## Correction (2026-09-12): the client is NOT free — one field feeds visitor-facing copy

The claim this todo previously made — that nothing on the client needs changing because it
already reads only the aggregate — is **wrong**. Every presim artifact field the web app touches
was enumerated on 2026-09-12 (method: field enumeration over the named source lines below, not a
re-run of anything). There are exactly two:

- `apps/web/src/lib/preScheduleResult.ts:41-44` reads only `artifact.roster` and `artifact.baked`.
  **This half of the old claim is correct** and is preserved as such — the decoder genuinely does
  not need the priced block.
- `apps/web/src/components/event/SimulationTab.tsx:408` passes `preSchedule?.schedules.length`
  into `apps/web/src/components/event/StartMatchPicker.tsx:83`'s `preScheduleScopeText`, which
  renders to **visitors** whenever the pre-schedule view is selected
  (`StartMatchPicker.tsx:262-264`):

  > "Before the schedule is released - how the field is likely to rank when nobody yet knows who
  > plays whom. Computed ahead of time across 20 randomly generated schedules, 1000 draws in
  > total."

**Dropping the `schedules` block without replacing that input makes the count fall through
`StartMatchPicker.tsx:264`'s `?? 0` and publishes "across 0 randomly generated schedules" to
visitors silently, WITH NO TEST FAILING.** This is the reason this correction exists.

### The real work (small, but real)

- Drop the `schedules` block from the published shape.
- Drop it from `PreScheduleArtifactSchema`, INCLUDING its two `schedules` refinements at
  `packages/harness/pageArtifacts.ts:2010` and `:2015`.
- Publish `scheduleCount` as a scalar field in its place.
- Change the one line at `apps/web/src/components/event/SimulationTab.tsx:408` to pass that
  scalar instead of `preSchedule?.schedules.length`.
- Update the tests that index into `schedules`: `packages/harness/preSchedule.test.ts`,
  `packages/harness/publish.test.ts`, `packages/harness/pageArtifacts.test.ts`.

### Live waste measured today (2026-09-12)

Method: unauthenticated GET against `https://data.sigmascout.org`, response parsed as JSON. On
`v1/presim/2026mrcmp/bpr@3.0.0+baseline.json`: 388,484 B fetched against 12,275 B actually read —
96.8% downloaded and discarded. This is a **live** observation and replaces nothing above; the
`2025cur` scaling table and the 95.8-98.6% share from plan 09-09 stand as measured. Against the
project's stated top UX priority — page load speed — this is the Simulation tab shipping a
payload that is 96.8% waste on a real event.

This todo should still land first or alongside `preschedule-schedule-count-and-acceptance-bar`.
