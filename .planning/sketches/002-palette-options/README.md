---
sketch: 002
name: palette-options
question: "Which hue should carry percentile shading — and does D-05's 'not TBA/Statbotics blue' survive?"
winner: null
tags: [palette, teams-table, sequential, phase-5-followup]
---

# Sketch 002: Palette options

## Why this exists

Direct user request after sketch 001:

> "I like the color descisions on A, although I was you to suggest different pallets."

Sketch 001-A's mechanic — **percentile shading of metric cells**, the way Statbotics and FanGraphs shade
theirs — was the part that landed. This sketch holds that mechanic fixed and varies only the hue, so the
comparison is like for like. The chrome and shading share one hue per variant.

## Why these four

Percentile shading is a **sequential** encoding (magnitude), so the rule is one hue, light→dark — never a
rainbow, never a diverging pair. All four ramps were checked for **monotonic OKLab lightness** rather than
eyeballed:

| Ramp | L steps | |
|---|---|---|
| Indigo | 0.962 → 0.870 → 0.785 → 0.680 → 0.511 | monotonic |
| Teal | 0.984 → 0.953 → 0.855 → 0.785 → 0.600 | monotonic |
| Amber | 0.987 → 0.962 → 0.879 → 0.769 → 0.555 | monotonic |
| Slate | 0.984 → 0.929 → 0.869 → 0.711 → 0.446 | monotonic |

**Indigo** — keeps D-05's identity decision intact; this is the shipped accent extended into a ramp.

**Teal** — furthest from every other FRC tool while still reading as a serious instrument. Its real
argument is structural: **red and blue are spoken for in this domain** (alliances), so a chrome hue that
avoids both never competes with alliance colour on match pages. Sketch 003 makes that concrete.

**Amber** — warmest and most energetic, closest to a sports product. Two honest strikes against it: amber
is conventionally a *caution* signal, so using it for "good" inverts an expectation; and it collides with
the uncertainty colour used in 001-C and 003.

**Slate** — no hue at all; density alone carries magnitude. The most restrained, and the one that scales
best if later phases add more colour-coded dimensions, because it leaves the entire colour budget free for
meaning (alliance, win/loss, confidence).

## The question underneath

D-05 deliberately avoided TBA's and Statbotics' blue-dominant chrome so SigmaScout would read as its own
tool. The intake for sketch 001 named Statbotics/TBA as the reference. **These four are the range between
those two positions**, and picking one effectively rules on D-05 — so the choice should be made
deliberately rather than by preference alone.

Worth weighing: D-06's token discipline held through all of Phase 5 (verified — zero hex literals in
component code outside shadcn's generated files), so whichever wins is a token swap, not a component
sweep. The switching cost is as low as it will ever be.

## Open questions for the reviewer

1. Which hue — and is D-05 revised or reaffirmed by that choice?
2. **Should shading apply to every metric column, or only Total?** Shading all of them is how Statbotics
   reads, but with 18 columns on Sigma1 it may become noise rather than signal. Not tested here.
3. Does the shading survive a phone, where only three columns are visible at rest?
4. Untested: how any of these look with 001-B's tier stripes or 003's alliance colours on the same page.

## Files

- `index.html` — four palettes, tab-switchable, same table and same real data throughout
- `data.js` — real 2026 rows (shared with sketch 001)
- `preview-{indigo,teal,amber,slate}.png`
- Theme: `../themes/default.css`
