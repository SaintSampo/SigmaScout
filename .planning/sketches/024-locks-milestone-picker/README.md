---
sketch: 024
name: locks-milestone-picker
question: "Round two of 023: if the rewind picks an event and then one of nine milestones (plus Live), how should that picker sit on the page without B's vertical sprawl?"
winner: "Q"
tags: [districts, locks, champ-locks, dcmp, slider, rewind, milestones, cutoff-chart, interaction]
---

# Sketch 024: Locks milestone picker

## Design Question
Jacob's feedback on 023: the hard part is that there are many points in time and some matter much more
than others. He liked B (event lanes) but found it clunky and too tall, liked D's cutoff chart, and asked
for "event, then milestone" with a Live option. Milestones per event:

Schedule release · Quals 1/4 · 1/2 · 3/4 · Quals done · Alliance selection done · Playoffs 1/2 · Playoffs done · Awards done

## How to View
open .planning/sketches/024-locks-milestone-picker/index.html

## Variants
- **P: Season strip** — cutoff chart, then every event packed into three thin rows on the same time axis (weeks never overlap, so three rows hold the season). Tap a bar to pick the event; the nine milestones open below as big targets.
- **Q: Event, then milestone** — one native event menu grouped by week, the nine-stop milestone stepper, previous/next arrows that walk every milestone in time order and name the next one, and a slim cutoff strip.
- **R: Week grid** — cutoff chart, week tabs, and the chosen week as a grid: events are rows, milestones are columns. At most three rows at a time.

All three: a Live pill with a pulse, future milestones drawn dashed and disabled, a red "now" line
inside a live event, the chosen event's milestones dotted on the cutoff line, and tapping the chart
jumps to the nearest milestone.

## What to Look For
- Height: which one gives the ledger the most room above the fold, especially on a phone?
- Does "event, then milestone" read without explanation?
- Is the cutoff chart useful as a way to navigate, or only as context?
- Is Live easy to find and obviously different from "awards done of the last event"?
