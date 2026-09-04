---
sketch: 008
name: common-tier-treatment
question: "How should Common (0–50) be treated so it reads as a tier, not an absence?"
winner: null
tags: [palette, percentile, rarity, accessibility]
---

# Sketch 008: Common Tier Treatment

## Design Question

Sketch 004 decided Common (0–50 percentile) renders as plain text (variant B, "Common unboxed"),
so colour appears only where it carries information. The user now wants Common to look more like
the other three tiers. Which treatment names the tier at the lowest cost in table noise?

All five variants keep Rare/Epic/Legendary exactly as shipped (`--tier-*` tokens), except E,
which restyles the whole family.

## How to View

open .planning/sketches/008-common-tier-treatment/index.html

## Variants

- **A: Slate box** — full parity: `#F1F5F9` fill + `#475569` text (004-A's Common, card-game grey)
- **B: Stone box** — same anatomy, warm stone grey (`#F5F5F4`/`#57534E`) so Common has its own hue
  rather than repeating the chrome's slate
- **C: Outline only** — hairline `#CBD5E1` box, no fill, text unchanged; quietest treatment
- **D: Ghost fill** — barely-there `#EEF2F6` fill, text unchanged; presence without a colour claim
- **E: Bordered family** — every tier gains a hairline edge in its own hue so all four boxes share
  identical anatomy and Common stops being the odd one out

## What to Look For

- **Judge on the event-shaped slice** (bottom table) — half of it is Common, like a real event.
  004-B's whole argument was "half the field stays quiet"; each option re-spends that quietness.
- A vs B is a deliberate cool-vs-warm grey comparison — flip between the tabs.
- Does A read as "disabled control"? Does C read as "placeholder/input"? Does E make the whole
  table busier than the problem deserves?
- Both grey text pairs clear WCAG AA (7.0:1 and 6.6:1); grey is achromatic so it cannot collide
  with sky/purple/amber under CVD. Run `validate_palette.js` before promoting tokens anyway.
