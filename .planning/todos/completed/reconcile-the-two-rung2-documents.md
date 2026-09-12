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

~~Neither document should be acted on before this is done, so that two sessions do not wire the
generator in from two sources of truth.~~ **GATE DELETED 2026-09-12 — see the closure below. It was
blocking work Jacob unblocked the same day, and the merge it was gating is not going to happen.**

---

## CLOSED 2026-09-12 — the prescribed merge is REFUSED; one residue moved to `drop-licensed-schedule-templates`

Closed by the 2026-09-12 backlog triage (`.planning/triage-2026-09-12.md` §3).

### Why the merge is not being done

**Both rung-2 documents are machine-rendered, and both advertise that as their anti-drift
guarantee.** Verified at HEAD:

- `docs/models/rung2-generated-schedules.md:5` — "**Written by
  `npx tsx scripts/measureGeneratedSchedules.ts --render-doc`, not transcribed from terminal
  output.**" It then names the trap it is avoiding: on this project `publish:seasons` prints a
  payload-budget summary it does not write, and the budget tests stay red until a human copies the
  numbers across.
- `docs/models/random-vs-generated-schedules.md:7` — "**This document is WRITTEN BY
  `scripts/measureRandomSchedules.ts --write-doc`, not transcribed from its terminal output.**"

A hand-merged third document would be the only one of the three with no generator behind it. It
would drift **by construction** on the next re-run of either script, and it would drift in exactly
the direction this project's failure log names — a prose record describing a measurement that has
since moved. Merging two anti-drift documents into one drifting one is a net loss, whatever the
prose gains.

The valuable observation this todo was written around — that two independently built harnesses
reproduce each other's binding floor — is preserved. It does not need a merged document; it needs
the sentence that states it to be **true**, which is the residue below.

### The gate is deleted

The "neither document should be acted on before this is done" line above is struck out and void. It
was written on 2026-09-12 to stop two sessions wiring the generator in from two sources of truth.
Later the same day Jacob settled the schedule count and bar
(`preschedule-schedule-count-and-acceptance-bar`), which unblocked
`drop-licensed-schedule-templates` — and since the merge this gate was waiting on is now refused
outright, the gate could never lift on its own terms. It would have blocked that work indefinitely.

**Note the work is still blocked, but by something else entirely and for a real reason:** D-19, the
schedule-template redistribution licensing judgement, is LIVE (`09-CONTEXT.md:402`), it is Jacob's
and was never delegated to an agent. That block is recorded in `drop-licensed-schedule-templates`
and is unaffected by this closure.

### The one residue, moved

The corroboration sentence is **fabricated in one direction**: it cites a figure that does not exist
in the document it names. Verified at HEAD — `74.2` appears nowhere in
`docs/models/random-vs-generated-schedules.md`, and the sentence claiming that document's
"separately-built 74.2% at `2025cur`" is **hardcoded** in
`scripts/measureGeneratedSchedules.ts:1170-1173` (so `--render-doc` re-emits it on every run,
landing at `docs/models/rung2-generated-schedules.md:31`), and repeated by hand at
`drop-licensed-schedule-templates.md:11-12`.

Recorded as a must-fix-before-wiring inside `drop-licensed-schedule-templates`. It matters there
rather than here because it over-credits the generator in exactly the change that moves
visitor-facing rank bands.
