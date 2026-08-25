---
sketch: 004
name: rarity-tiers
question: "Do Statbotics-style percentile boxes with card-game rarity colours work — and where do the tiers actually earn their place?"
winner: null
tags: [palette, teams-table, percentile, rarity, accessibility]
---

# Sketch 004: Rarity tiers

## Why this exists

The user rejected all four palettes in sketch 002 and proposed something better:

> "I want to copy something from statbotics. when an EPA is in a certain percentile, it gets a
> colored box around it. Red, white, light green, green, blue. Lets copy this but use rarity colors
> from card game. Grey, blue, purple, gold" — with bands **grey 0–50, blue 50–75, purple 75–95,
> gold 95–100**.

This is a better idea than continuous shading, for a reason worth writing down: a gradient makes you
compare, a **tier gives you a name**. "That's a gold team" is something a student can say out loud
across a pit. Statbotics already proves the banding mechanic works for this audience, and rarity
vocabulary is instantly legible to it.

## The colours are not the classic rarity set — deliberately

Classic card-game rarity blue (`#3B82F6`) against purple (`#9333EA`) measures **ΔE 1.3 under
deuteranopia**. The two middle tiers — which together cover 45% of all teams — are *literally the
same colour* to roughly 6% of males. In an FRC audience that is a lot of students.

The fix was to push blue toward **cyan** rather than true blue:

| Tier | Band | Hue | Box fill | Text |
|---|---|---|---|---|
| Common | 0–50 | slate | `#F1F5F9` | `#475569` |
| Rare | 50–75 | **sky** `#0EA5E9` | `#E0F2FE` | `#0369A1` |
| Epic | 75–95 | purple `#9333EA` | `#F3E8FF` | `#7E22CE` |
| Legendary | 95–100 | amber `#F59E0B` | `#FEF3C7` | `#B45309` |

Validated rather than eyeballed — `#0EA5E9 / #9333EA / #F59E0B` passes every check:
**ΔE 14.1 deutan · 22.7 tritan · 26.5 normal vision** (target ≥ 8), plus lightness band, chroma
floor, and contrast. Every tinted box clears **WCAG AA** for its own text (4.51–6.92:1); the
solid-pill variant uses darkened fills so white text clears AA too (4.76–6.98:1).

Same vocabulary the user asked for. Actually readable.

## THE FINDING — where tiers earn their place, and where they do not

The first build computed percentiles against the 14 visible rows and looked great. That was
flattering the idea. Rebuilt against the **real 3,709-team field**:

Band cuts on Total: **p50 = 39.2 · p75 = 74.4 · p95 = 167.8**
Tier sizes: Common 1,856 · Rare 925 · Epic 742 · **Legendary 186**

| Slice | Total column |
|---|---|
| Sorted table, ranks 1–10 | **10/10 Legendary** |
| Sorted table, ranks 1,201–1,210 | **10/10 Rare** |
| Event-shaped set (ranks 4 → 3,651) | 2 gold · 2 purple · 1 blue · 5 grey |

**On a sorted page, adjacent rows share a tier by construction** — the box restates what the rank
column already says. The tiers are informative on *mixed* sets: Event pages, Team pages, Compare,
search results.

**But the sorted column is the only flat one.** In the ranks 1,201–1,210 slice, Total is uniformly
Rare while Hub Auto and Hub Endgame vary — team 3313 is Rare overall but **Epic in Hub Auto**, team
120 is Epic in Hub Endgame. That is real signal ("unusually good at auto for its level") that a bare
number does not carry, and it is exactly what a scout is looking for. So the tiers earn their place
on the Teams page too — just on the *component* columns rather than the sorted one.

## Variants

| | Direction | Trade |
|---|---|---|
| **A** | Every tier boxed (user's spec) | Banding explicit, key complete. ~50% of teams carry a box meaning "unremarkable" |
| **B** | Common gets no box | Mirrors the Statbotics reference (its 25–75 band is white). Colour only where it means something. Common stops being nameable |
| **C** | Solid rarity pills | Strongest card-game read, unmistakable tiers. Heavy on a dense table; will compete with alliance red/blue on match pages |

## Open questions for the reviewer

1. **A, B, or C?** B is the closest to the Statbotics reference; C is the closest to the rarity idea.
2. **Should the sorted column be boxed at all?** It is uniform by construction. Suppressing it there
   would cut noise, at the cost of an inconsistent rule.
3. **Percentile within what?** Against all teams for the season (as here), or within the event / the
   visible set? Different questions, and the answer changes what the tiers mean on an Event page.
4. **This needs a percentile per metric per team, which the artifact does not publish.** Either the
   pipeline adds it, or the client derives it from the full teams artifact it already downloads.
   Worth deciding before Phase 6 builds on it.
5. Untested on a phone, where only three columns are visible at rest.

## Files

- `index.html` — three variants × three honest data slices
- `data.js` — real 2026 rows plus a thinned full-field distribution for true percentiles
- `preview-{a,b,c}.png`
- Theme: `../themes/default.css`
