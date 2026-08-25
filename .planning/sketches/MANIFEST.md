# Sketch Manifest

Throwaway HTML mockups for exploring design directions before committing to implementation.
Nothing here ships — these exist to make a decision reviewable.

## Design direction

**Feel:** "Serious tool, more alive." Colour carries meaning — rank tiers, confidence, win/loss,
uncertainty — never decoration. Dense and fast, but not austere.

**Reference points:** Statbotics and The Blue Alliance. This sits in tension with **D-05**, which
deliberately avoided their blue-dominant chrome so SigmaScout would read as its own tool. Sketch 001
put both sides side by side; sketch 002 turns it into a concrete choice.

**Settled so far:**
- **Percentile shading of metric cells** (001-A's mechanic) is the direction — user liked it. Hue is
  still open; that is sketch 002.
- **Interval axes** (001-C) are wanted, and wanted *more widely* — extended to match predictions in
  sketch 003 at the user's request.

**Constraints carried in from Phase 5:**
- `05-UI-SPEC.md` locked 60/30/10: slate-50 / slate-100 / indigo-600, accent for interactive-or-active
  states only.
- **D-06's token discipline held through all of Phase 5** — verified zero hex literals in component code
  outside shadcn's generated files. A palette change is a token swap, not a component sweep.
- The `X ± Y` sigma display (D-07) is the stated differentiator and must survive any visual direction.
- **D-09 vs D-10:** the team-page ± (match-to-match consistency) and the match-prediction ± (full
  predictive variance) are deliberately *different quantities*. Any design touching both must label them
  as such — conflating them is how sketch 003 initially drew bands that were far too narrow.

## Sketches

| # | Name | Question | Winner | Tags |
|---|------|----------|--------|------|
| 001 | teams-table-polish | How much colour, carrying what meaning — and is D-05 still right? | A's shading + C's axis (partial) | teams-table, palette, ribbon, density, uncertainty |
| 002 | palette-options | Which hue carries percentile shading? | _pending_ | palette, teams-table, sequential |
| 003 | alliance-axes | Shared axis or one per alliance, for match predictions? | _pending_ | match-prediction, uncertainty, phase-6, phase-7 |

## Findings so far

**Design**

- **The uncertainty spread is real design material, not a footnote.** Team spreads range ±2.09 to ±91.14
  (median ±5.57); teams with near-identical records differ substantially in confidence.
- **Ranks 6–14 in 2026 have overlapping ±1σ intervals** — statistically indistinguishable, yet the shipped
  table renders them as a confident ordered list. Arguably a correctness problem in how the page
  communicates, not merely an aesthetic one.
- **Interval visualisations need a zoomed axis.** Anchored at zero, spreads of 5–11 against totals of
  274–418 collapse to invisible. Trade: bar *length* then stops encoding magnitude, so the axis must be
  labelled.
- **Layout must be rendered and looked at, not reasoned about.** 003's first draft had label collisions in
  all three real matches — they only separate when the alliances differ, which is precisely the case the
  chart exists to show.

**Colour (computed, not eyeballed)**

- **FRC red/blue passes CVD validation**: `#DC2626` vs `#2563EB` → ΔE 29.9 protan (target ≥ 8), plus
  lightness, chroma, and contrast. The domain convention is safe to keep.
- All four candidate sequential ramps (indigo / teal / amber / slate) verified **monotonic in OKLab
  lightness**.
- Structural argument for a non-red, non-blue chrome hue: red and blue are spoken for by alliances, so a
  chrome that avoids both never competes with alliance colour on match pages.

**Pipeline gap uncovered by sketching (actionable)**

- **Match-level predictive variance (D-10's `P + Q + R`) is computed by the harness but never published.**
  `EventMatchSchema` carries scores, `pRedWin`, and per-component mean/variance only. Any interval display
  of a match prediction is therefore either wrong or impossible until the artifact publishes it. Cheap to
  add — the value already exists at compute time. **Input for Phase 6/7 planning.**
