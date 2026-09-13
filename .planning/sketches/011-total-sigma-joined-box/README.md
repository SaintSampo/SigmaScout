---
sketch: 011
name: total-sigma-joined-box
question: "SPR's Total and Sigma become one joined display, each half in its own rarity tier with a ± between them. What should the join look like?"
winner: "A"
tags: [metric-cell, tiers, uncertainty, teams-table, team-page, event-page, alliances]
---

# Sketch 011: Total ± Sigma joined box

## Design Question

Quick task 260913-jkp deletes every Sigma column and tile. SPR's Total then shows Sigma
alongside it as two joined boxes: Total in Total's tier colour, Sigma in Sigma's own tier colour
(inverted at the pipeline, so a low Sigma earns the high tier), with a ± glyph separating them. The
tier palette and 008-C's outline-only Common are fixed. Only the join is in question.

The joined box applies in the Teams list, the team page's Total tile, and the event page's
Insights, Breakdown (Total column only), and Alliances tabs. The Combined Total on Alliances carries
± √(3 × ΣSigma²), the Match Band formula.

## How to View

open .planning/sketches/011-total-sigma-joined-box/index.html

Use "Phone 390" in the top bar to check narrow width. `preview-board.png` puts all five joins side by
side on the same ten spread-slice rows plus three alliance Combined Totals.

## Variants

- **A: Split pill ★ Selected (developer, 2026-09-13).** One rounded shape cut in two with no gap; the ± leads the Sigma half.
- **B: Seam badge.** The halves sit 2px apart, and a small white disc holding the ± straddles the seam.
- **C: Total + tab.** Total is a full-size box; Sigma is a smaller attached tab, so Total dominates.
- **D: Framed pair.** A hairline frame holds two separate tier chips, with the ± in the neutral gap between them.
- **E: Three segments.** Total | ± | Sigma, with the ± in its own narrow slate cell.

## What to Look For

- **Tier-on-tier clashes** in the "spread across the field" slice, e.g. Rare Total next to Epic Sigma.
  Which join keeps two adjacent colours reading as one value rather than two cells?
- **Common next to Common**: two outline rings meeting at the seam (A, C, E) versus the frame (D).
- **Hierarchy**: only C makes Total visibly dominant. Is that wanted?
- **Width at 390px**: E and D cost the most horizontal space in an already-scrolling table.

## Data

`data.js` holds real 2026 SPR data from the live R2 artifacts (`teams/2026`, `event/2026alhu`,
spr@3.0.0+baseline), fetched 2026-09-13, with tiers as published. The event rows pair as-of-event
Total with **season-final** Sigma joined from the Teams artifact. The real build publishes Sigma
inside the event file instead (developer decision, 260913-jkp).

## Open Question

The Combined Total's band has no published percentile, so the sketch renders its half in plain
slate (`t-none`) rather than inventing a tier. The Total half keeps the existing 3× approximate tier.
