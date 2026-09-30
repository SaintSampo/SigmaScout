---
id: locks-picker-playoffs-half-stop
created: 2026-09-29
source: quick 260929-ttp (sketch 024 Q)
priority: low
---

# Restore the Locks milestone picker's ninth stop, "Playoffs ½ done"

## Why this matters

Sketch 024 variant Q has nine milestones per event. The shipped picker has eight: quick task 260929-ttp dropped "Playoffs ½ done" (user decision 2), because nothing underneath it can take that position yet.

- The district timeline (`apps/web/src/components/districts/districtTimeline.ts`) holds ONE playoffs step per event. There is no step for a half played bracket to resolve to.
- The district simulation cannot take a partly played bracket at a rewound position. A rewound position either has the whole bracket open or the whole bracket decided.

A stop that resolved to either of those would claim a position the ledger cannot show.

## What to do

1. Give the timeline a mid bracket step, or one step per playoff match, in `districtTimeline.ts`, ordered after the event's alliance step and before its playoffs step.
2. Give the rewound simulation input a partly played bracket at that position, so the Playoffs cells show the bracket as it stood.
3. Add the stop back to the picker:
   - `DISTRICT_MILESTONE_KEYS` gains `playoffsHalf` between `alliance` and `playoffs`, with sub word "½" and long word "playoffs ½ done" in `districtLedgerCopy.ts`, and a happened rule from the state facts.
   - The stepper goes back to nine columns in `theme.css`: `repeat(9, minmax(0, 1fr))`, a line inset of `calc(100% / 18)`, a fill of `/ 8`, and a now marker at `/ 9`.
   - The group spans go back to the sketch's own: Schedule 1/2, Qualification 2/6, Alliances 6/7, Playoffs 7/9, Awards 9/10.
   - Update the CSS contract and copy tests that pin eight columns.
