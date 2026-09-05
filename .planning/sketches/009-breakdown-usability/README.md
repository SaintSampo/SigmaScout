---
sketch: 009
name: breakdown-usability
question: "What makes the event Breakdown table friendlier — restructuring (phase drill-down), interactivity (sort + focus), or signal-surfacing (standout markers + row detail)?"
winner: null
tags: [table, event-page, breakdown, tiers, interaction]
---

# Sketch 009: Breakdown Usability

## Design Question

The Breakdown tab is ~11 fixed metric columns (~1,400px declared) — horizontal scroll
everywhere, sort locked to Total descending, and the real scouting signal ("Rare overall
but Epic in Hub Auto") buried in a wall of tier boxes. Three dramatically different
answers, one per variant.

## How to View

open .planning/sketches/009-breakdown-usability/index.html

## Variants

- **A: Phase drill-down** — default view is Total + the three published phase metrics
  (4 metric columns, no scroll); clicking a phase header expands it into its component
  columns under a banded group header.
- **B: Sort + focus** — every header click-sorts (click again to flip); the sorted column
  highlights, gains a per-event mini-rank, and the header goes accent green (interactive
  state). Full column set stays visible.
- **C: Standout signal** — same Total-sorted table as production, but a corner dot flags
  cells where a component tier beats the team's own overall tier; clicking a row expands
  a component-percentile bar panel on one shared 0–100 scale with gridlines at the tier
  cuts (50/75/95).

## What to Look For

- **A:** does collapse-by-default lose too much? Is the expand affordance discoverable?
  Does the banded second header row read as "these columns belong to Teleop"?
- **B:** is the full-width table tolerable once you can sort it? Does the mini-rank
  earn its space? Note tiers deliberately stay season-wide — sorting never repaints them.
- **C:** do the corner dots read as signal or noise at roster scale (~24 rows)? Is the
  row-detail bar panel worth a click — and does percentile-as-length (rather than raw
  points) feel honest? Fouls Committed is deliberately excluded from bars/flags since
  high ≠ good.
- All three keep: decided tier tokens (008-C Common ring included), Team #/Name pinned,
  the D-11 model-estimates caption, no rank column, ± on every value.
- Data is an event-shaped 24-team roster; percentiles computed against the real 2026
  field quantiles (p50 39.2 / p75 74.4 / p95 167.8), never the visible rows.

## Notes

Ideas compose: A×B (sortable phase columns), C's dots on A's collapsed view (a dot on
the *phase* cell when something inside beats the overall tier). Cherry-picking is a
valid outcome.
