---
name: sketch-findings-sigmascout
description: Validated design decisions, CSS patterns, and visual direction from SigmaScout sketch experiments — rarity-tier palette, uncertainty/interval displays, and chart craft rules. Auto-loaded during UI implementation on SigmaScout.
---

<context>
## Project: SigmaScout

An FRC match-prediction site whose stated differentiator is **honest uncertainty** — Sigma-family
metrics display as `X ± Y` and every algorithm's accuracy is published. Page load speed is the top
UX priority. Audience: FRC students, mentors, and scouts, often on congested venue wifi.

**Design direction:** "Serious tool, more alive." Colour carries meaning — tier, confidence,
win/loss, alliance — and never decorates. Dense and fast, but not austere.

**Reference points:** Statbotics and The Blue Alliance, the tools this audience already knows.
Statbotics' percentile-boxed metric cells are the direct ancestor of the tier system below.

Sketch sessions wrapped: 2026-08-25
</context>

<design_direction>
## Overall Direction

**Palette.** Metric values carry a percentile **tier**, shown as a tinted box: Common (0–50) plain,
Rare (50–75) sky, Epic (75–95) purple, Legendary (95–100) amber. Discrete tiers rather than a
gradient, because a tier gives the reader a *name* and a gradient only invites comparison. Continuous
sequential shading was explored across four hues and rejected outright.

**Uncertainty.** The `X ± Y` display is the product's point, so the ± gets drawn, not just printed.
Totals render as intervals where there is room; match predictions render as two alliance bands on a
**single shared event scale**, where the overlap between them *is* the win probability.

**One ± quantity, everywhere.** (Supersedes prior guidance — Phase 7 plan 07-06, D-01/D-02/D-03.)
Every `±` this site prints and every band or interval it draws, at every aggregation level, is one
standard deviation of the full predictive variance. A user must never see a bare consistency-only
value. Drawing a band from only part of that variance produces bands that are wrong by 7–10σ. Read
`references/uncertainty-display.md` before touching either.

**Typography and tokens.** Inter, applied via Tailwind's `--font-sans` token (a bare
`body { font-family }` rule is dropped by the production CSS minifier — this was a real bug).
Every colour is a `--color-*` / `--tier-*` custom property, never a literal in component code
(D-06). That discipline held through all of Phase 5 and is what makes a palette change a token swap
rather than a component sweep.

**Accessibility is computed, not assumed.** Run the dataviz skill's `validate_palette.js` before
changing any palette. Two live constraints: the tier blue must stay **sky `#0EA5E9`**, never true
blue; FRC alliance red/blue is validated and safe as-is.
</design_direction>

<findings_index>
## Design Areas

| Area | Reference | Key Decision |
|------|-----------|--------------|
| Colour & rarity tiers | `references/colour-and-tiers.md` | Percentile tiers with Common unboxed; blue must stay sky for CVD |
| Uncertainty display | `references/uncertainty-display.md` | Match predictions as a table on one shared event scale; one ± quantity, everywhere (D-01, Phase 7) |
| Chart craft | `references/chart-craft.md` | Derive coupled geometry; grouping is proximity; mock against the real distribution |

## Read this first if you are…

- **building a table with metric values** → `colour-and-tiers.md`
- **building anything showing a prediction, a range, or a ±** → `uncertainty-display.md`
- **building any chart, or debugging one that looks subtly wrong** → `chart-craft.md`

## Blocked on data (check before building)

Two decisions here need values the published artifacts do not yet carry:

1. **Per-metric percentiles** for the tier system — pipeline-published or client-derived, undecided.
2. **Match-level predictive variance** (D-10's `P + Q + R`) — computed by the harness to produce
   `pRedWin`. Published on the team artifact since Phase 6 D-01 (`TeamSeasonMatchSchema`'s
   `redScoreVarianceOwn`/`blueScoreVarianceOwn`), so TEAM-05 is satisfied. NOT yet on the event
   artifact — `EventMatchSchema` gains these fields in Phase 7 plan 07-07 and 07-08 populates them.
   Until then, any EVENT-page match interval display is wrong. Filed at
   `.planning/todos/pending/publish-match-predictive-variance.md`, folded into Phase 7 as D-18 item 3.

## Theme

`sources/themes/default.css` — the sketch theme. Note it holds the *sketch* working palette plus the
Phase 5 shipped tokens for comparison; the tier tokens in `colour-and-tiers.md` are the decided ones.

## Source Files

Original sketch HTML is preserved in `sources/` — open them in a browser to see the winning variants
running against real published data.
</findings_index>

<metadata>
## Processed Sketches

- 001-teams-table-polish — *partial*: findings kept, visual direction superseded
- 003-alliance-axes — winner: variant C (event table, one shared scale)
- 004-rarity-tiers — winner: variant B (Common unboxed)

**Excluded:** 002-palette-options — all four continuous ramps rejected by the user. Its rejection is
recorded in `colour-and-tiers.md` under "What to Avoid" so the directions are not re-proposed.
</metadata>
