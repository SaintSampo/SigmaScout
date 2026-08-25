---
sketch: 001
name: teams-table-polish
question: "How much colour, and carrying what meaning, does the Teams table want — and is D-05's 'not TBA/Statbotics blue' still the right call?"
winner: null
tags: [teams-table, palette, ribbon, density, uncertainty]
---

# Sketch 001: Teams table polish

## Why this exists

At Phase 5's real-device sign-off the user reviewed the live site on a phone and said:

> "Really I would expect a more polished UI. the current UI is both too minimal and rough
> around the edges. There should be a little bit of color."

The "rough edges" were real layout defects and were fixed in plan 05-08. **"Too minimal" was
not a defect** — it is `05-UI-SPEC.md`'s 60/30/10 palette working exactly as specified. Rather
than improvise a palette change at a closing gate, the phase closed and this sketch was opened
so there is something concrete to react to.

Intake answers: feel should be **"serious tool, more alive"** — colour as information, not
decoration. Reference point: **Statbotics / TBA**. Scope: **Teams table + ribbon**.

## The data is real

`data.js` holds 14 real rows from `v1/teams/2026/sigma1@2.0.0+tuned-2026-08.json`, fetched
2026-08-25. Nothing is invented. That matters here more than usual, because the real
distribution is the design problem:

- **Total** ranges from −92.5 to 418.4 across all 3,709 teams
- **Spread** ranges from ±2.09 to ±91.14, median ±5.57
- Rank 2 (**4414 HighTide**) has a 70–2 record but ±11.15; rank 1 (**1690 Orbit**) has 47–5
  and ±5.22. Two teams that look similar on record are *not* similarly certain.

## Variants

| | Direction | What it tests |
|---|---|---|
| **0** | As shipped | The honest baseline — what is live today, not a flattering reconstruction |
| **A** | Familiar (TBA/Statbotics) | Blue chrome + percentile-shaded metric cells. Lowest learning curve; reads as a sibling of Statbotics |
| **B** | Colour as information | Keeps indigo identity. Rank-tier stripe, confidence bar, win–loss colouring. Every colour answers a question |
| **C** | Uncertainty forward | Total as an interval, not a point. Makes the project's differentiator the visual hero |

## What building it revealed

**Variant C did not work as first drawn, and fixing it produced the sketch's most useful
finding.** Drawn on a zero-anchored axis the intervals collapsed to a few identical pixels —
totals span 274–418 while spreads are only 5–11, so the ±range was invisible at that scale.
Zooming the axis to the visible data range (260–430) made it legible.

With it legible, something the shipped table actively hides became obvious: **ranks 6 through
14 have almost entirely overlapping intervals.** Those nine teams are statistically
indistinguishable, but variant 0 presents them as a confident ordered list. That is arguably a
correctness problem in how the current page communicates, not just an aesthetic one — and it is
exactly the kind of thing this project's core value ("honest uncertainty") claims to care about.

Trade-off to weigh: the zoomed axis means bar *length* no longer encodes total magnitude, only
position does. If C ships, that axis has to be labelled.

## Open questions for the reviewer

1. **Is D-05 still right?** It deliberately avoided TBA/Statbotics blue so SigmaScout reads as
   its own tool. The intake picked them as a reference. A and B are the two sides of that.
2. **Does the interval treatment earn its horizontal cost?** C spends roughly a column and a
   half of width on something no other FRC tool shows.
3. **Do the tier stripes in B help or just decorate?** They encode rank, which the rank column
   already states. Their value is scanability, not new information.
4. Everything here is desktop-width. Mobile is where the user's complaint originated, so
   whichever direction wins needs a phone pass before it is locked.

## Files

- `index.html` — all four variants, tab-switchable
- `data.js` — the real rows
- `preview-{now,a,b,c}.png` — rendered screenshots
- Theme: `../themes/default.css`
