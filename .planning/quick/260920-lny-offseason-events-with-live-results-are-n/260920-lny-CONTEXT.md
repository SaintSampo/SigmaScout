# Quick Task 260920-lny: Offseason events with live results are not picked up (Chezy Champs 2026) - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning

<domain>
## Task Boundary

SigmaScout failed to go live on Chezy Champs 2026 (`2026cc`, event_type 99), an offseason event
that published real results on TBA. Fix the discovery flaw so an event whose schedule only
appears on TBA once it starts is still picked up by the Worker, with no manual ingest + publish.

</domain>

<findings>
## Root cause (verified 2026-09-20, orchestrator)

- The Worker tick (`apps/worker/src/scheduled.ts`, `loadLiveEventsAt` in
  `apps/worker/src/liveWindows.ts`) only considers events that have a window in
  `v1/manifest/live-windows.json`. Zero live windows means the early exit.
- `buildLiveWindowsManifest` (`packages/harness/manifests.ts`) derives a window from the event's
  own `matches.sort_time` span. A zero-match event gets NO window (rule 1 in its header), and a
  window already closed at build time is dropped (rule 2).
- The live manifest is generation `0eca6b08`, computedAt 2026-09-19T16:48:47Z, and carries
  **0 windows**.
- The corpus now holds 86 `2026cc` matches, first sort_time 2026-09-19T16:50:31Z, two minutes
  AFTER that publish. TBA had no schedule for the event before it began. A later ingest picked
  the matches up; nothing republished the manifest.
- All 40 remaining 2026 offseason events in the corpus (start_date 2026-09-25 onward, plus
  `2026txrm`) hold 0 matches. Each will miss the same way.
- Rule 1 exists because of the outage in
  `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md` (cause B): two `inferred: true`
  windows for zero-match offseason events kept `liveEvents.length === 0` false, so the tick ran
  the full ~38 ms live path against the 10 ms budget. The header's premise, "TBA publishes match
  schedules well before an event runs", is false for offseason events.
- `events` table has `start_date` but, per the builder's header, no end date. Check whether TBA's
  `end_date` is available to ingest before falling back to a fixed span.
- `https://data.sigmascout.org/v1/events/2026cc.json` is a 404. Whether the Worker can fold an
  event that has no offline-published per-event artifact is NOT yet verified. Memory notes say
  state blocks only attach to events with upcoming matches, and the tick reads
  `stateBlockScopeKeys(touchedTeams)`.

</findings>

<decisions>
## Implementation Decisions

### Discovery mechanism (LOCKED, Jacob 2026-09-20)
- Cheap Worker probe. The offline builder publishes a calendar window for a zero-match event,
  marked probe-only. On a probe window the tick makes ONE ETag-conditional TBA matches request
  and exits. It enters the full live path only once matches exist.
- The scheduled ingest + republish alternative was declined.

### Guardrails (LOCKED, from project history)
- A probe window must NEVER put the tick on the full live path while the event has no matches.
  That is exactly outage cause B. Pin it with a test.
- Do not undo `loadLiveEventsAt`'s prefilter or the closed-window retention rule.
- Worker cpuTime is not reproducible run to run (~5 ms spread). Any budget claim must be a
  WITHIN-RUN difference against a control arm, never an absolute number. Cold isolates dominate.
- Free plan: 50 subrequests per invocation, 10 ms sustained CPU. Several probe windows can be
  open at once on an offseason weekend (9 events started 2026-09-18); bound probes per tick
  (the tick already rotates events via `meta.rotationOffset`).
- Week 0 (type 100) is predicted, never folded; offseason (99) folds on purpose. Do not merge
  those predicates.
- If published numbers change, the algorithm version must bump. A manifest-only change should
  not move any published number; say so explicitly in the summary.
- Executor subagents have no network. Publish, deploy (`npx wrangler deploy` from a clean tree)
  and live checks run from the main context and are owed to the orchestrator/Jacob.

### Claude's Discretion
- Reuse the existing `inferred` field or add an explicit probe marker. Manifests already in the
  wild carry only `inferred: false`, so reuse is schema-compatible.
- Window span when no end date is available.
- Scope honesty: if the Worker cannot cold-start an event with no published artifact, do NOT
  force it into this task. Ship the probe + promotion seam that is provably safe, record the gap
  in the summary, and leave the rest as a follow-up.

</decisions>

<specifics>
## Specific Ideas

- Regression fixture: a zero-match type-99 event whose start_date is today gets a probe window;
  a tick with TBA returning 304 or `[]` does no D1 work, no R2 writes, and reports the event as
  probed, not considered.
- Second fixture: the same event once TBA returns matches takes the normal live path.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`
- `docs/worker-operations.md`
- `packages/harness/manifests.ts`, `packages/harness/manifestSchemas.ts`
- `apps/worker/src/liveWindows.ts`, `apps/worker/src/scheduled.ts`

</canonical_refs>
