---
sketch: 019
name: bonus-dot-tier-contrast
question: "The three tier predicted bonus dot shipped with a 60% fill for likely and a 25% tint for toss-up, and at 14px the two are too hard to tell apart. What should separate them?"
winner: "F"
tags: [match-table, bonus-rp, uncertainty, prediction, accessibility]
---

# Sketch 019: Bonus dot tier contrast

## Design Question

Quick task 260917-06d replaced the fill to the odds (sketch 012 C) with three tiers: empty under ⅓,
faint from ⅓ to ⅔, solid above ⅔. Jacob's first look at the live row (2026-09-17): solid and faint
are too hard to tell apart.

Why it fails: both tiers carry the same dark letter, so the only cue is ground shade, and the two
grounds differ by 1.8:1. The actual earned dot (30% tint) sits between the two, so the reader sees
three near-identical pinks across one row.

## How to View

open .planning/sketches/019-bonus-dot-tier-contrast/index.html

- **Design** switches between what shipped and A–E. "All five" puts them side by side on the alliance
  pair from Jacob's screenshot, then on real walk-forward odds (sketch 012's data).
- **Actual earned dot** switches the results side between today's 30% tint and full ink. This is a
  second decision, independent of the variant: should "solid" mean the same thing on both sides?
- **1x / 2x** zooms. Judge at 1x, since that is where it failed.
- **Phone 390** checks narrow width.

`preview-all-today-actual.png` and `preview-all-full-actual.png` are 2x captures of "All five".

## Variants

Every variant makes likely full alliance ink with a white letter (white on `#DC2626` 4.83:1, on
`#2563EB` 5.17:1). They differ in what a toss-up looks like.

- **A: Full ink.** Toss-up keeps the 25% tint with a coloured letter. The letter flips from white to
  colour, so the read no longer depends on judging a shade. Two CSS rules.
- **B: Half fill.** Toss-up fills only the bottom half. A shape cue: survives glare, dim screens,
  colour blindness. The letter crosses the fill line.
- **C: Hatched.** Toss-up is diagonal stripes. Texture is the common chart convention for "unsure".
  Stripes are 2px at this size and can shimmer behind the letter.
- **D: No tint.** Toss-up is an alliance outline, unlikely a grey outline. Nothing is ever faint.
  Cost: predicted toss-up equals actual "not earned", and unlikely sits near the dashed "no data" dot.
- **E: Size step.** A's likely and toss-up, but unlikely shrinks to a small letterless pip. Only
  bonuses in play draw a full dot. The pip keeps its slot, so position still names the bonus.

- **F: Jacob's mix. ★ Selected (Jacob, 2026-09-17), with the 30% hatch.** Built from Jacob's pick across
  the first five. Toss-up is hatched (from C). An actual "not earned" shrinks to the small letterless pip
  (from E). Everything else stays as shipped: likely is the 60% fill, predicted unlikely is a full size
  empty outline with its letter, actual earned is the 30% tint. Every letter is black (`#0f172a` in the
  sketch), predicted or actual; the border keeps the alliance colour. The first build striped at 60% and
  Jacob asked for a lighter hatch; 60 / 45 / 30% became a control and 30% won, because the black letter
  reads cleanly over it and the gap to the solid likely dot gets wider, not narrower.

## Decision

**F with the 30% hatch.** Sketch only for now: Jacob asked to hold implementation for a separate request.
The full ink "likely" that A to E shared was NOT taken; likely stays the shipped 60% fill. The actual
earned dot stays the 30% tint (Jacob declined full ink).

Implementation notes for whoever builds it:

- Toss-up ground: `repeating-linear-gradient(135deg, <30% alliance> 0 2px, #fff 2px 4px)`. The 30% colour
  is the existing `--alliance-*-soft` token, so the `--alliance-*-fill-faint` tokens added by 260917-06d
  become unused.
- The pip is 6px with a 1px alliance border and 4px side margins, so it keeps the 14px slot and the row
  does not reflow. It applies to actual `missed` only, never to `unknown` (still dashed) and never to a
  predicted dot.
- One black letter everywhere replaces `--alliance-*-dot-ink` on predicted dots and the alliance coloured
  letter on actual dots. Compute the contrast of the chosen token on the 60% fill before shipping.
- The pip has no letter, so its `title` / `aria-label` must still name the bonus.

## What to Look For

- At 1x, without reading the Odds column, can you sort a row into likely / toss-up / unlikely?
- Does the predicted side still read as the same family as the actual side? Flip the Actual toggle.
- Busy rows (2025 and 2026 carry three dots per alliance): does the option add noise or remove it?
- The dashed "no data" dot in each key: does any tier collide with it?
