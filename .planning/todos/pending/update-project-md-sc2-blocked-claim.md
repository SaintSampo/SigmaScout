---
id: update-project-md-sc2-blocked-claim
created: 2026-09-04
source: found by the executor while closing SC-2 (quick task 260904-4aa)
resolves_phase: 02-prediction-models-epa-sigma1
priority: medium
---

# `PROJECT.md`'s Success Metrics table still records SC-2 as blocked

`.planning/PROJECT.md`, Success Metrics table, the "EPA reimplemented, not pulled from Statbotics
API" row currently reads:

> ⚠ Partially held (Phase 2) — reimplementation works walk-forward at every boundary, but the
> spot-check mitigation is **blocked**: `api.statbotics.io/v3/year/{year}` reproducibly 500s
> (D-14, WINDOWS entries 1–2). EPA correctness currently rests on synthetic-fixture tests and
> walk-forward structural proofs instead.

This is now false. Quick task 260904-4aa (2026-09-04) closed SC-2: the Statbotics blocker
resolved, and a committed, re-runnable per-team tolerance check now exists —
`scripts/epaVsStatbotics.ts`, `packages/harness/epaStatboticsCompare.ts`,
`data/baselines/epa-vs-statbotics-2026-09.json`, and the verdict document
`docs/models/epa-vs-statbotics.md`.

## Why this file was not edited directly

`260904-4aa-PLAN.md`'s `files_modified` list does not include `PROJECT.md`, and the plan's own
instruction is explicit: "If the corrected accuracy figures contradict a comparative claim made
anywhere in the repo or on the site, do NOT quietly restate that claim to fit ... Retracting a
published claim is the developer's call, not this task's." This todo is that flag.

## Suggested correction

Change the row's status from "⚠ Partially held" to "✓ Held (Phase 2, closed by quick task
260904-4aa)" and replace the blocked-endpoint prose with a pointer to
`docs/models/epa-vs-statbotics.md`'s verdict: SC-2 is met at the tolerance recorded in
`data/baselines/epa-vs-statbotics-2026-09.json`, with the caveat that offseason-inclusive
agreement is measurably looser than offseason-excluded agreement (see that document's
"comparability boundary" section).

## Related

- `docs/models/epa-vs-statbotics.md` — the full verdict this todo asks `PROJECT.md` to reflect
- `data/baselines/epa-vs-statbotics-2026-09.json` — the committed tolerance
- `02-VERIFICATION.md` (line 5) also records SC-2 as "verified with a documented, human-approved,
  externally-blocked sub-component" — same stale status, same fix, lower priority since it is a
  dated verification snapshot rather than a living status table.
