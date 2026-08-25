# Colour & Rarity Tiers

## Design Decisions

**Metric values carry a percentile tier, shown as a tinted box.** Borrowed from Statbotics, which
boxes EPA values by percentile — but with card-game rarity vocabulary instead of its red/white/green
scale. Chosen over continuous sequential shading for one reason: **a gradient makes you compare, a
tier gives you a name.** "That's a gold team" is something a student can say out loud across a pit.

**Common (0–50) renders as a plain cell — no box.** This is sketch 004 variant B, selected over
boxing every tier. Mirrors the Statbotics reference, whose middle band is white. Colour then appears
only where it carries information, and roughly half the field stays quiet so the eye goes straight to
Rare and above.

| Tier | Percentile | Box fill | Text |
|---|---|---|---|
| Common | 0–50 | *(none — plain cell)* | inherit |
| Rare | 50–75 | `#E0F2FE` | `#0369A1` |
| Epic | 75–95 | `#F3E8FF` | `#7E22CE` |
| Legendary | 95–100 | `#FEF3C7` | `#B45309` |

Identity hues (for legends, chips, and anywhere the tier needs a solid colour):
sky `#0EA5E9` · purple `#9333EA` · amber `#F59E0B`.

Every tinted box clears **WCAG AA** for its own text (4.51–6.92:1).

## THE BLUE MUST STAY SKY — do not "fix" it

Classic card-game rarity blue is `#3B82F6`. Against rarity purple `#9333EA` it measures
**ΔE 1.3 under deuteranopia** — the Rare and Epic tiers, which together cover 45% of all teams, are
*literally the same colour* to roughly 6% of males. In an FRC audience that is a lot of students.

Pushing blue toward **cyan** fixes it. The shipped set `#0EA5E9 / #9333EA / #F59E0B` measures
**ΔE 14.1 deutan · 22.7 tritan · 26.5 normal vision** (target ≥ 8) and passes lightness, chroma, and
contrast.

A future contributor may look at `#0EA5E9` and think it should be "proper" blue. **It should not.**
That regression is invisible to anyone with normal colour vision and silently breaks the tier
distinction for a real fraction of users. Validate any change with the dataviz skill's
`validate_palette.js` before making it.

## Where tiers earn their place — and where they do not

Measured against the real 2026 field (3,709 teams). Band cuts on Total: **p50 = 39.2 · p75 = 74.4 ·
p95 = 167.8**. Tier sizes: Common 1,856 · Rare 925 · Epic 742 · Legendary 186.

| Slice | Total column |
|---|---|
| Sorted table, ranks 1–10 | **10/10 Legendary** |
| Sorted table, ranks 1,201–1,210 | **10/10 Rare** |
| Event-shaped set (ranks 4 → 3,651) | 2 gold · 2 purple · 1 blue · 5 grey |

**On a sorted page, adjacent rows share a tier by construction** — the box on the *sorted* column
restates what the rank column already says.

**But the sorted column is the only flat one.** In the ranks 1,201–1,210 slice, Total is uniformly
Rare while Hub Auto and Hub Endgame vary — team 3313 is Rare overall but **Epic in Hub Auto**. That
is real scouting signal ("unusually good at auto for its level") that a bare number does not carry.

**So: tier the component columns everywhere; the sorted column earns it only on mixed sets** (Event
pages, Team pages, Compare, search results).

## CSS Patterns

```css
/* Tier tokens — define once, never as literals in components (D-06). */
:root {
  --tier-rare-bg:      #E0F2FE;  --tier-rare-fg:      #0369A1;
  --tier-epic-bg:      #F3E8FF;  --tier-epic-fg:      #7E22CE;
  --tier-legendary-bg: #FEF3C7;  --tier-legendary-fg: #B45309;
  /* Common has no tokens on purpose — it renders as an untreated cell. */
}

/* The box. min-width keeps a column of boxes aligned despite varying digit counts. */
.metric-tier {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 5px;
  min-width: 80px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.metric-tier--rare      { background: var(--tier-rare-bg);      color: var(--tier-rare-fg); }
.metric-tier--epic      { background: var(--tier-epic-bg);      color: var(--tier-epic-fg); }
.metric-tier--legendary { background: var(--tier-legendary-bg); color: var(--tier-legendary-fg); }
/* .metric-tier--common intentionally has no rule. */
```

## HTML Structures

```html
<!-- Common: plain, no wrapper class beyond the layout box -->
<td class="num"><span class="metric-tier">58.90 <span class="spread">± 3.99</span></span></td>

<!-- Rare and above: the tier modifier carries the colour -->
<td class="num"><span class="metric-tier metric-tier--epic">76.23 <span class="spread">± 2.85</span></span></td>
```

A key row belongs above the table, showing the bands with Common marked as unboxed:

```
Key (percentile)  [0–50 · no box]  [50–75]  [75–95]  [95–100]   Common · Rare · Epic · Legendary
```

## What to Avoid

- **Continuous sequential shading.** Tried in sketch 002 across four hues (indigo, teal, amber,
  slate) and rejected outright. Gradients make the reader compare cell against cell; discrete tiers
  give a nameable answer. Do not re-propose a ramp.
- **Classic rarity blue `#3B82F6`.** See above — fails CVD against purple.
- **Amber as a "good" signal in chrome.** Amber conventionally means caution, and it is already
  spoken for as the Legendary tier. Do not also use it for navigation or accents.
- **Tiering the sorted column on a sorted page.** It is uniform by construction and adds noise
  without information.
- **Judging a percentile design against a top-N sample.** 004's first build computed percentiles
  within its 14 visible rows and looked great; against the true field the top of the table is
  uniformly Legendary. Always mock against the real distribution.

## Data dependency (not yet satisfied)

Tiers need a **percentile per metric per team**, which the published artifact does not carry. Either
the pipeline adds it, or the client derives it from the teams artifact it already downloads. Decide
before building on this. See `.planning/todos/pending/` for the related pipeline gaps.

## Origin

Synthesized from sketch: 004 (winner: variant B).
Sketch 002 was explicitly excluded — all its palettes were rejected — but its rejection is recorded
above because it is part of why 004 looks the way it does.
Source files: `sources/004-rarity-tiers/`
