# Sketch Manifest

Throwaway HTML mockups for exploring design directions before committing to implementation.
Nothing here ships — these exist to make a decision reviewable.

## Design direction

**Feel:** "Serious tool, more alive." Colour carries meaning — rank tiers, confidence,
win/loss, uncertainty — never decoration. Dense and fast, but not austere.

**Reference points:** Statbotics and The Blue Alliance — the tools SigmaScout's users already
know. Note this sits in tension with **D-05**, which deliberately avoided their blue-dominant
chrome so SigmaScout would read as its own tool. That tension is live, not settled, and sketch
001 puts both sides side by side.

**Constraints carried in from Phase 5:**
- `05-UI-SPEC.md` locked 60/30/10: slate-50 / slate-100 / indigo-600, with accent reserved for
  interactive-or-active states only.
- **D-06's token discipline held through all of Phase 5** — every colour in `apps/web` is a
  `--color-*` custom property, verified with zero hex literals outside shadcn's generated
  files. A palette change is therefore a token swap, not a component sweep. This is the single
  biggest reason a redesign is cheap right now.
- The `X ± Y` sigma display (D-07) is the project's stated differentiator and must survive any
  visual direction.

## Sketches

| # | Name | Question | Winner | Tags |
|---|------|----------|--------|------|
| 001 | teams-table-polish | How much colour, carrying what meaning — and is D-05 still right? | _pending_ | teams-table, palette, ribbon, density, uncertainty |

## Findings so far

- **The uncertainty spread is real design material, not a footnote.** Spreads range ±2.09 to
  ±91.14 (median ±5.57). Teams with near-identical records differ substantially in confidence.
- **Ranks 6–14 in 2026 have overlapping ±1σ intervals** — statistically indistinguishable, yet
  the shipped table renders them as a confident ordered list. Surfaced by sketch 001 variant C.
- **Interval visualisations need a zoomed axis.** Anchored at zero, spreads of 5–11 against
  totals of 274–418 collapse to invisible. Learned the hard way in 001.
