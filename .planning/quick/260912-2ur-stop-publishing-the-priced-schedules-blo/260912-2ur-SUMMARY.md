---
phase: quick/260912-2ur
plan: 260912-2ur
subsystem: api
tags: [zod, schema, publish-pipeline, r2, sigmascout]

# Dependency graph
requires:
  - phase: 09-09 (rung-1/rung-2 acceptance harness)
    provides: scripts/measureFieldAveragedRanks.ts and scripts/measureGeneratedSchedules.ts, which read buildPreScheduleArtifact's in-memory `schedules` block directly and must keep doing so
provides:
  - PublishedPreScheduleArtifactSchema (packages/harness/pageArtifacts.ts) — the R2 wire shape for the pre-schedule sidecar, carrying scheduleCount instead of the priced schedules block, tolerant of the legacy shape already on R2
  - publish.ts writes the projected (published) body instead of the raw in-memory artifact
  - apps/web reads scheduleCount end to end (fetch, decode, render)
affects: [next step — raising PRESIM_SCHEDULE_COUNT from 20 to 1,000, which now lands on top of a published shape whose size no longer scales linearly with schedule count]

# Actuals (#2632)
actuals:
  tokens: 11373
  tasks: 4
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two schemas over one shared base for an in-memory-vs-wire split (TeamsArtifactWireSchema/TeamsArtifactSchema precedent), rather than making a required field optional and pushing possibly-undefined reads into unrelated call sites"
    - "Publish-boundary re-parse through the published schema as the single projection point, so a derived scalar (scheduleCount) can never disagree with what was actually built"

key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - apps/web/src/lib/api/preSchedule.ts
    - apps/web/src/lib/api/preSchedule.test.ts
    - apps/web/src/lib/preScheduleResult.ts
    - apps/web/src/lib/preScheduleResult.test.ts
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
    - apps/web/src/components/event/simulationTestFixtures.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts

key-decisions:
  - "Rejected making `schedules` optional on the single PreScheduleArtifactSchema (the low-churn candidate) — PreScheduleArtifact is that schema's INFERRED type, so optionality would have propagated possibly-undefined `schedules` reads into scripts/measureFieldAveragedRanks.ts and scripts/measureGeneratedSchedules.ts, which are explicitly out of scope for this task and are the rung-1/rung-2 acceptance harness the next step depends on."
  - "Two schemas over one shared base instead: PreScheduleArtifactSchema (builder's in-memory shape, schedules required, unchanged) and PublishedPreScheduleArtifactSchema (R2 wire shape, schedules dropped, scheduleCount carried). Both extend PreScheduleArtifactBaseSchema and call three shared invariant predicate functions, so the roster/histogram bounds that make rankRows.ts's MalformedRankHistogramError unreachable have one home instead of two copies that could drift."
  - "The published schema tolerates the legacy shape on purpose: every sidecar on R2 today carries schedules and no scheduleCount, and this task runs no publish. scheduleCount ?? schedules.length resolves the count from whichever is present; a refinement rejects an object with neither. This means there is no flag-day/deploy-ordering constraint between this commit landing and the next real publish."
  - "The C-06/PD-02 pricing-provenance test assertion (artifact.schedules[0].matches[0].rp) had no referent once the block stopped being published. Relocated to a recording variant of fakeRpAlgorithm.predict that records every synthetic presim match's (matchKey, matchCount) pair, asserting every 2026lat_presim... match was priced at the pre-event matchCount — states the same C-06 fact more directly and doesn't depend on the block being on the wire."
  - "The --event/publishSeasons sidecar-parity test's literal `schedules` comparison had no referent for the same reason. Widened to compare roster, pricedFrom, matchesPerTeam, scheduleCount, baked.draws and baked.histograms (generation/computedAt excluded — they identify the run, not the numbers), since the histograms are a deterministic function of the priced schedules under a seeded mulberry32 and still catch a pricing/shuffle divergence between the two paths."

patterns-established:
  - "In-memory-vs-wire schema split for a page artifact: builder-facing schema keeps a field required and fully typed for internal consumers that need it; a published schema derives what a reader actually needs and drops the rest via a `.transform()`, with a refinement first resolving the derived value from either the new field or the legacy field it replaces."

requirements-completed: []

coverage: []

# Metrics
duration: 13min
completed: 2026-09-12
status: complete
---

# Quick Task 260912-2ur: Stop publishing the priced schedules block Summary

**The pre-schedule sidecar's published bytes now carry a `scheduleCount` scalar instead of the K priced synthetic schedules the client never reads — the in-memory builder artifact is untouched, so the two measurement-script acceptance harnesses that need the full block still get it.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-12T06:15:43Z
- **Completed:** 2026-09-12T06:28:39Z
- **Tasks:** 4 (3 code tasks + this SUMMARY/todo/self-check task)
- **Files modified:** 11

## Accomplishments

- Added `PublishedPreScheduleArtifactSchema` (`packages/harness/pageArtifacts.ts`) — the R2 wire
  shape for the pre-schedule rank-simulation sidecar. It shares a base schema and three named
  invariant predicates with the existing `PreScheduleArtifactSchema` (unchanged: still the
  builder's in-memory, `schedules`-required shape the two measurement scripts read), so the
  roster-uniqueness / histogram-count / histogram-length-and-sum bounds have one home instead of
  risking drift between two copies.
- The published schema tolerates BOTH shapes: `scheduleCount ?? schedules.length` resolves the
  count from whichever field is present, with a refinement rejecting an object carrying neither.
  This is what makes the change deployable with no flag day — every sidecar currently on R2
  carries the legacy shape (schedules present, no scheduleCount) and this task runs no publish.
- `apps/web` now fetches, decodes and renders through `scheduleCount`: `api/preSchedule.ts` parses
  through the published schema; `SimulationTab.tsx` reads `preSchedule?.scheduleCount` instead of
  `preSchedule?.schedules.length`; a new render test asserts the disclosure line shows the
  fixture's real count (17) rather than falling through to `?? 0`.
- `publish.ts`'s `buildPreScheduleSidecarForEvent` — the single serialization point for this
  artifact — now writes `JSON.stringify(PublishedPreScheduleArtifactSchema.parse(artifact))`
  instead of `JSON.stringify(artifact)`. The parse IS the projection: `scheduleCount` is derived
  from the block that was actually built, so it can never disagree with it, and raising
  `PRESIM_SCHEDULE_COUNT` (the next task) needs no edit here at all.
- Measured basis (both the todo and the plan cite this): a live
  `v1/presim/2026mrcmp/bpr@3.0.0+baseline.json` object cost 388,484 B to fetch, of which only
  12,275 B (3.2%) was ever read by a client. At 1,000 schedules that ratio gets far worse before
  this change; after it, the object shrinks to roughly the size of the aggregate alone (measured
  at ~24 KB in the plan's own before/after estimate for a 1,000-schedule sidecar, vs. ~18 MB if
  the block had stayed).

## Task Commits

Each task was committed atomically:

1. **Task 1: the published wire schema** — `5cd916e8` (feat) — split
   `PreScheduleArtifactSchema` into a shared base plus the strict (unchanged) schema and the new
   `PublishedPreScheduleArtifactSchema`; 6 new tests in `pageArtifacts.test.ts`.
2. **Task 2: the client reads scheduleCount** — `43e79b30` (feat) — `api/preSchedule.ts`,
   `preScheduleResult.ts`, `SimulationTab.tsx`, `simulationTestFixtures.ts` all switched to the
   published schema/type; new legacy-tolerance test in `api/preSchedule.test.ts`; new
   render-assertion test in `SimulationTab.test.tsx` with a vacuity guard against the `?? 0`
   fall-through.
3. **Task 3: the publisher stops writing the block** — `efb0c24f` (feat) — the one serialization
   point in `publish.ts` now parses through the published schema; relocated the C-06 provenance
   assertion to a recording `predict` wrapper; widened the `--event`/`publishSeasons` parity test;
   added the raw-bytes proof obligation (no own `schedules`, `scheduleCount` is 20).

**Plan metadata:** (this commit) — `docs(260912-2ur): SUMMARY`

## Files Created/Modified

- `packages/harness/pageArtifacts.ts` — `PreScheduleArtifactBaseSchema` (shared base), three named
  invariant predicates + message constants, `PublishedPreScheduleArtifactSchema` +
  `PublishedPreScheduleArtifact` type, doc comments explaining the split.
- `packages/harness/pageArtifacts.test.ts` — new `describe` block covering the new shape, the
  legacy shape, the JSON round-trip proof obligation, the neither-field rejection, and the three
  shared invariants re-asserted on the published schema.
- `apps/web/src/lib/api/preSchedule.ts` — parses through `PublishedPreScheduleArtifactSchema`;
  return type is `PublishedPreScheduleArtifact | null`.
- `apps/web/src/lib/api/preSchedule.test.ts` — fixtures rebuilt through the published schema; new
  legacy-tolerance case at the fetch boundary.
- `apps/web/src/lib/preScheduleResult.ts` — type import/parameter switched to
  `PublishedPreScheduleArtifact`; body untouched (reads only `roster`/`baked`).
- `apps/web/src/lib/preScheduleResult.test.ts` — fixture rebuilt through the published schema.
- `apps/web/src/components/event/SimulationTab.tsx` — prop type and the one read site
  (`preScheduleScheduleCount`) switched to `scheduleCount`.
- `apps/web/src/components/event/SimulationTab.test.tsx` — new test asserting the rendered
  disclosure text carries the fixture's real count and draw total, with an explicit vacuity guard.
- `apps/web/src/components/event/simulationTestFixtures.ts` — `preScheduleArtifact()` fixture now
  returns the published shape (`scheduleCount: 17`, no `schedules`).
- `packages/harness/publish.ts` — `buildPreScheduleSidecarForEvent` serializes the parsed
  projection; extended doc comment with the split and the measured byte reason.
- `packages/harness/publish.test.ts` — both `PreScheduleArtifactSchema.parse` call sites on
  published bytes switched to the published schema; C-06 provenance assertion relocated to a
  recording `predict` wrapper; raw-bytes proof obligation added; `--event`/`publishSeasons` parity
  test widened.

## Decisions Made

See `key-decisions` in the frontmatter above for the full rationale on each. In short:

- Two schemas over one shared base, not one schema with an optional field — the optional-field
  candidate was explicitly rejected because it would have propagated possibly-`undefined` reads
  into the two out-of-scope measurement scripts.
- The published schema tolerates the legacy (pre-this-task) shape by design, so no flag day is
  needed between this commit and the eventual republish.
- Two test assertions that read the (now-removed) published `schedules` block were relocated
  rather than deleted, restating the same facts (C-06 pricing provenance; builder determinism
  across the two publish paths) through seams that survive the block's removal.

## Deviations from Plan

**None — plan executed exactly as written**, including its explicitly stated deviation from the
todo's original "real work" list: the todo said "Drop it from `PreScheduleArtifactSchema`,
INCLUDING its two `schedules` refinements" — the plan deliberately did NOT do this. The strict
schema keeps `schedules` required with both of its original refinements untouched, because
`scripts/measureFieldAveragedRanks.ts` and `scripts/measureGeneratedSchedules.ts` read it directly
and are out of scope for this task. This is recorded as the todo's own resolution note, not as an
unplanned deviation from THIS plan.

No Rule 1/2/3 auto-fixes were needed. No architectural questions arose (Rule 4). No authentication
gates were encountered.

## Issues Encountered

None. `packages/core/rankingPoints/constants.ts` and a few other files carried uncommitted changes
from a concurrent session (quick task 260912-2uz) throughout this task's execution — never touched,
never staged, confirmed absent from every commit via `git status --short` before each `git add`.

## User Setup Required

None — no external service configuration required. No publish was run (out of scope); the next
publish (whenever it happens, for any reason) will emit the new shape automatically.

## Next Phase Readiness

- The published shape is now decoupled from schedule count, which is the hard prerequisite the
  todo named for raising `PRESIM_SCHEDULE_COUNT` from 20 to 1,000 (a separate, already-decided next
  step, explicitly out of scope here and untouched — `PRESIM_SCHEDULE_COUNT` and
  `PRESIM_DRAWS_PER_SCHEDULE` are unchanged).
- No republish has happened. Every sidecar object currently on R2 still carries the legacy shape
  (schedules, no scheduleCount) and will continue to be served and parsed correctly by
  `PublishedPreScheduleArtifactSchema`'s legacy-tolerance refinement until the next full publish
  naturally replaces them with the new shape.
- `.planning/todos/pending/stop-baking-preschedule-schedules.md` is moved to
  `.planning/todos/completed/` with a resolution note in the next commit.

---
*Task: quick/260912-2ur*
*Completed: 2026-09-12*
