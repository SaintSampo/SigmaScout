---
sketch: 023
name: locks-rewind-slider
question: "How should a visitor move the DCMP Locks and Champ Locks tabs to a past moment in the season, so landing on a specific match, stage or status change is easy?"
winner: "none, superseded by 024 Q"
tags: [districts, locks, champ-locks, dcmp, slider, rewind, timeline, interaction]
---

# Sketch 023: Locks rewind slider

## Design Question
Both tabs share one `RewindSlider` (apps/web/src/components/districts/LedgerParts.tsx). It is a native
range over every step in the district: each qualification match, plus quals done, alliance selection,
playoffs and awards per event. That is over 800 steps by Week 4. What should replace it?

## How to View
open .planning/sketches/023-locks-rewind-slider/index.html

## Diagnosis of the shipped control
- Hundreds of steps on one thin track: a pixel is several matches.
- The readout sits beside the label, away from the thumb.
- Tick labels and jump chips repeat each other; the chips cost a row.
- Nothing on the track shows where statuses changed.

## Variants
- **Now: Shipped** — today's control, reproduced for comparison.
- **A: Snap rail** — the same slider, fixed: bubble readout on the thumb, week segments as big click targets, stage notches the drag snaps to, step buttons by Match / Stage / Status change / Week.
- **B: Event lanes** — one lane per event grouped by week (Fri to Sat), drag along one event's lane to scrub only its matches, stage dots after each lane, finished weeks fold.
- **C: Replay** — play/pause the district forward, week chapters, skip between status changes, a feed of changes passed so far, optional pause on every change.
- **D: Status chart** — the track is a stacked chart of Locked / In range / Out of range / Locked out, with the cutoff and likely range under it; drag snaps to status changes.
- **E: Jump to** — no dragging: three menus (week, event, moment), a search box ("lansing 41"), shortcuts around your own team's events, and recent status changes.

All variants drive one shared preview (status counts, cutoff, what changed at this step) so only the
control differs. Sample data: a 14-event Michigan-style district, Week 4 live; the Champ tab adds
the two DCMP divisions as future events.

## What to Look For
- Can you land on one exact qualification match without fighting the control? Try phone width.
- Can you find the moment a status changed?
- Does the control explain where "now" is and what has not been played?
- Which ideas combine well (e.g. A's thumb bubble with D's chart, or E's team shortcuts beside any rail)?
