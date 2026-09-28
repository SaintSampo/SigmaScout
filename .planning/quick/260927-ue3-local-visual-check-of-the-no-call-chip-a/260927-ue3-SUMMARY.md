---
quick_id: 260927-ue3
date: 2026-09-27
status: complete
commit: f846c01a
---

# 260927-ue3 Summary: No call and a DCMP priced before it starts, seen in a real browser

The two Champ Locks states that 260927-6bf could not render offline are now screenshotted in real
Chromium at 1440 wide. The six PNGs and a README are in `screenshots/`. No app source changed. The
harness (a private build, a Playwright script, a prep script and fixtures) lived under the gitignored
`apps/web/reports/260927-ue3/` and has been deleted.

## State 1, No call

- Forced from a Playwright init script: a `window.Worker` subclass sent only the champ run's request
  to the real built Worker, with `draws: 0`. The real protocol posted a real error.
- 2026 PNW at `2026waahs:awards`: 51 No call chips, exactly the control's 15 In range plus 36 Out of
  range. Locked out 75 is unchanged. The stat line reads "Predicted cutoff not available · the
  simulation did not finish in this browser", and no figure appeared on the way there.
- No call chip width 88 px, the same as Pending (88) and Out of range (88.3).
- The plan expected the district run to pass through unforced. At that position no district category
  is open, so that run never starts. The champ run was the only Worker.

## State 2, the DCMP priced before it starts

- Stand in `v1/district-presim/2026pnw/2026pncmp.json` built from the live 2026pncmp SPR event
  artifact with the shipped rewind input and simulator. It was served beside doctored `2026pnw` artifacts
  (DCMP points removed, registered teams given an unstarted DCMP entry, `bakedEvents` set).
- At the live position every registered team's DCMP row is priced from the sidecar and every other
  team's row reads the estimate. Roster variant: 50 priced and 76 estimated. First batch variant: 30
  priced and 96 estimated. Zero event requests, sidecar served once, nothing reads district only or
  unavailable.

## Finding

frc2635 earned 24 DCMP points from an award alone and played no DCMP match, so it has no row in a
sidecar built from the event roster. Registered as a DCMP entrant, its row would read unavailable.
Whether a real bake meets this case is unverified.

## Deviations

- Executed in the main context instead of a subagent, as the plan says, because the harness needs
  localhost and data.sigmascout.org.
- The clean tree check found changes, but not from this task. Mid task, another session committed
  ee988fb0 and a44ba6f9 and began editing `apps/worker/src/artifactMerge.ts` and `scheduled.ts`. This
  task wrote nothing tracked outside `screenshots/`. The commit passed explicit paths, so another
  session's staged todo file stayed out of it and is still staged.
- The roster variant registers the 50 match roster teams rather than all 51 DCMP point earners,
  because of the finding above.
