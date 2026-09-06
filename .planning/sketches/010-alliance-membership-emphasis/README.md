---
sketch: 010
name: alliance-membership-emphasis
question: "On a team page's match table, how should the team's own alliance — and its own number within that alliance — be marked, without using bold?"
winner: "C"
tags: [team-page, match-table, alliance, emphasis, accessibility, density]
gap: 10px
---

# Sketch 010: Alliance-membership emphasis

## Design Question

The team page's match table prints two rows of three team numbers per match. Today the whole
row the team is on goes `font-semibold` ([MatchTable.tsx:319-327](../../../apps/web/src/components/team/MatchTable.tsx#L319-L327)).
Two complaints, both from the user:

1. **The bold is unwanted**, and it is also weak — 600 against 400 at 14px is a small step.
2. **Alliance membership is hard to read at a glance** — you cannot tell which side is yours
   while scanning down the column.

A third problem shows up as soon as you look at real data: because the bold paints *all three*
numbers, it never says **which one is your team**. So the cue has two jobs, not one.

Plus a specific ask: **a smidge more space between the alliance members' numbers.**

## How to View

```
start .planning/sketches/010-alliance-membership-emphasis/index.html
```

Variants are deep-linkable: append `#rail`, `#ink`, `#tint`, or `#recede`.

## Variants

- **Current (bold)** — the reference. What ships today, shown so the comparison is against
  reality rather than against memory.
- **A: Margin rail** — a 3px alliance-coloured bar in the left margin marks the row; numbers
  stay slate-900 at weight 400. Own number takes a hairline ring in the alliance colour.
  No colour lands on text.
- **B: Alliance ink** — both rows take their alliance colour, echoing the bands in the next
  column. Own number takes a ring in its alliance colour.
- **C: Ground tint ★ SELECTED** — the team's row rides on a soft alliance-tinted pill, its own number a
  shade deeper. Figure stays neutral; the ground carries the signal.
- **D: Recede the opponent** — adds no ink anywhere. The opposing alliance drops to slate-600;
  the team's row simply stays full-strength slate-900. Emphasis by contrast, not decoration.

## Decision

**Winner: C — ground tint, at a 10px gap between alliance members' numbers.**

The team's alliance row rides on a soft alliance-tinted pill (`--alliance-*` at 10% over the row
ground); its own number sits on the same hue at 20%. Numbers stay slate-900 at weight 400
throughout — **no bold anywhere, and no coloured text**. The two-level ask is met by two tint
depths rather than by two different mechanisms.

Measured: slate-900 reads 15.28:1 on the 10% tint, 15.50:1 on blue, and 13.06:1 on the 20%
own-number tint. Nothing in C needed an accessibility fix, which is not true of B or D.

### What this settles

- **Bold is gone from the match table's roster lines.** The `font-semibold` at
  [MatchTable.tsx:319-327](../../../apps/web/src/components/team/MatchTable.tsx#L319-L327) is
  replaced, not softened.
- **Alliance membership is carried by ground, not by figure.** Consistent with the rest of the
  site's rule that colour carries meaning — here the meaning is "this is your side", in the same
  hue the bands to the right already use for that alliance.
- **Emphasis is two-level:** 10% for the alliance row, 20% for the team's own number.
- **Gap between alliance members is 10px** (from a literal space, ≈4px). The slider made this a
  measurement rather than an argument.

### Constraints implementation must honour

1. **The pill takes no vertical padding.** `padding: 0 5px` only. `Y_RED`/`Y_BLUE` (23/45) are
   locked so band centres land on the roster line centres (27.1/49.1); any vertical growth in
   this cell breaks the cross-column read. Height comes from line-height.
2. **`margin-left: -5px` on the pill** keeps the marked row's first digit x-aligned with the
   unmarked row above it. Without it the team's row indents by 5px and the column reads ragged.
3. **The tints are new tokens, not literals.** D-06's discipline (zero hex literals in component
   code) holds — these need `--alliance-red-ground` / `--alliance-blue-ground` and their 20%
   counterparts in `theme.css`, not inline `rgba()`.
4. **C adds a second boxed shape** to a cell whose box vocabulary is otherwise spoken for by
   tier values. The pill is fully rounded (`999px`) where tier boxes use `--radius` (6px), which
   is what keeps them from reading as the same object. Keep that distinction.

## What to Look For

- **Scan the Match column top to bottom, don't study one row.** The cue's whole job is
  peripheral. 5951 switches alliance at Qual 3, back at Qual 9, again at Qual 12 — if a variant
  works, those flips are obvious without reading.
- **Can you find 5951 itself?** Its slot moves (1st, 3rd, 2nd, 3rd, 1st, 2nd, 1st, 2nd). This is
  the job today's bold does not do at all.
- **Look at B beside the plot column, not on its own.** The question is whether two coloured
  systems in adjacent cells reinforce each other or compete for the same attention.
- **Watch C's second box.** This table will also carry boxed tier values; C adds another boxed
  shape to a cell that already has box vocabulary spoken for.
- **Then set the spacing.** The slider at the top applies to all variants, so spacing never
  confounds the emphasis comparison. The previous value was 4px (a literal space); **10px was chosen**.

## Data

Real, not invented: `v1/team/frc5951/2026/vpr@9.0.0+rolling-2026-09c`, fetched from
`data.sigmascout.org` on 2026-09-06. Team 5951 "Makers Assemble", Israel Team Practice
(`2026isrtp`), rank 7/12, all 8 quals.

Chosen because the awkward properties are real: the team **switches alliance** between matches,
**moves slot** within the alliance, and the roster mixes 4- and 5-digit numbers (`1690` beside
`10935`) — which is what the spacing slider has to hold up against. A mock with the team always
blue and always leftmost would make all five variants look fine.

The axis domain, `PLOT_W` scaling and `Y_RED`/`Y_BLUE` band geometry are ported verbatim from
the shipped [matchAxis.ts](../../../apps/web/src/components/team/matchAxis.ts) rather than
re-approximated — see Findings.

## Findings

### Two variants failed WCAG on their first draft, and the measurement changed the design

Per the findings skill's "accessibility is computed, not assumed", every treatment was run
through a contrast check before being shown. Two failed:

| Treatment | First draft | Verdict | Fixed to |
|---|---|---|---|
| B — opponent dimmed to 72% opacity | 3.13–3.32:1 | **fails** AA (4.5:1) for 14px text | full strength, no dim |
| D — opponent at `--loser-ink` (slate-400) | 2.45–2.56:1 | **fails** AA badly | `--color-text-muted` (slate-600), 7.24–7.58:1 |

`--loser-ink` is legitimate where it already ships — on a *losing score*, which the Result chip
has already told you and which you can skip. A **team number is an identifier someone came to
the page to read**, so the same token is not transferable. 17.85:1 against 7.58:1 is still an
unmistakable step, and D survives the fix intact.

B is the more interesting casualty: the dim was doing the "which row is mine" work, and removing
it exposes that B's only remaining own-row cue is the ring. That weakness is now visible rather
than hidden behind a failing dim.

### `--tier-common-edge`'s contrast exemption does not transfer to this cue

The Common-tier ring (008-C) sits at **1.48:1**, under WCAG 1.4.11's 3:1 non-text floor, and
that was accepted on the explicit grounds that the ring is *redundant* — the tier is also stated
by the value itself. Reused here for the own-number ring it would be **the only thing** saying
"this one is yours", so the exemption's own premise fails. A and D use the alliance tokens
(4.83:1 / 5.17:1) and slate-600 (7.58:1) instead.

Worth carrying forward: a token can be safe in one place and unsafe in another purely because
its redundancy changed, with no colour change involved.

### The rail slot must exist in every variant, transparent when unused

First pass added the 3px rail only in variant A, which indented A's numbers 9px relative to the
other four. The comparison then partly measured indentation rather than emphasis. The slot is
now always present and transparent — the same class of mistake as `chart-craft.md`'s drifted
dots, caught by rendering rather than by reasoning.

### Variant C's pill cannot take vertical padding

`padding: 1px 5px` on the tint pill grew the line by 2px and pushed the blue roster line off the
blue band it is supposed to share a baseline with. Since `Y_RED`/`Y_BLUE` (23/45) are locked
specifically so band centres land at 27.1/49.1 — the roster line centres — any variant that
changes the cell's vertical rhythm silently breaks the cross-column read. The pill now uses
`padding: 0 5px` and relies on line-height for its height.

**General rule this suggests:** an emphasis treatment in the Match cell may change colour,
weight, or horizontal space freely, but must not change vertical rhythm.

### The shipped axis is not zero-anchored, and re-deriving it by hand got that wrong

A hand-rolled `floor(min/100)*100` domain anchored the axis at 0 and flattened every band —
precisely the failure `chart-craft.md` records. The real policy is a 5% proportional pad
(10 minimum) on the ±1σ and actual extents, floored at 0 but never *anchored* there. Ported
verbatim; the rendered domain is 42–508 for this event.
