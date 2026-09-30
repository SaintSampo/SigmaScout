---
id: locks-cutoff-strip-chart
created: 2026-09-29
source: quick 260929-ttp (sketch 024 Q)
priority: medium
---

# Add sketch 024 Q's slim cutoff strip below the Locks milestone picker

## Why this matters

Sketch 024 variant Q draws a 52px cutoff strip (`chartHTML(52)`) under its milestone picker. It shows where the predicted cutoff moved over the season, and tapping it jumps to the nearest milestone. Quick task 260929-ttp shipped the picker without it (user decision 3), because the site has no per district cutoff history to draw: the predicted cutoff is computed at one position at a time, in the browser, for the position the reader is at.

## What to do

1. Precompute a per district predicted cutoff history in the publish pipeline: the predicted cutoff and its likely range at each milestone of each event, for both the DCMP and the Champs target.
2. Have the Worker tick append to it live, as each new milestone happens.
3. Render it as Q's strip under the picker:
   - the likely range band and the cutoff line;
   - the chosen event's happened milestones dotted on the line;
   - a cursor at the selected position, with its cutoff label;
   - the "not played yet" hatch after the live position;
   - the week axis, with the live week marked;
   - the title "Predicted <target> cutoff, with its likely range".
4. Tapping or dragging on it jumps to the nearest happened milestone, through the same `?at=` the picker writes.
