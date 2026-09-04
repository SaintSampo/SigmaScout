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

Sketch sessions wrapped: 2026-08-25, 2026-08-30
</context>

<design_direction>
## Overall Direction

**Palette (revised 2026-08-31, ui-polish-pass).** The chrome is now GREEN-tinted (user-picked, anchored on #4CAF50): surface `#E8F5E9`, border `#C8E6C9`, accent `#2E7D32` (green-800 — the seed fails WCAG as ink and is not a token); page ground stays neutral `#F8FAFC`. Accent still means interactive/active ONLY. Tier palette below is unchanged and still authoritative.

**Tiers.** Metric values carry a percentile **tier**, shown as a tinted box: Common (0–50)
outline-only (hairline `--tier-common-edge` inset ring, no fill, text unchanged — sketch 008-C,
2026-09-04, superseding 004-B's bare cell), Rare (50–75) sky, Epic (75–95) purple, Legendary
(95–100) amber. Discrete tiers rather than a gradient, because a tier gives the reader a *name* and
a gradient only invites comparison. Continuous sequential shading was explored across four hues and
rejected outright.

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
| Colour & rarity tiers | `references/colour-and-tiers.md` | Percentile tiers; Common outline-only (008-C); blue must stay sky for CVD |
| Uncertainty display | `references/uncertainty-display.md` | Match predictions as a table on one shared event scale; one ± quantity, everywhere (D-01, Phase 7) |
| Chart craft | `references/chart-craft.md` | Derive coupled geometry; grouping is proximity; mock against the real distribution |
| Simulation & Compare | `references/simulation-and-compare.md` | Interpolated (continuous) rank-band edges; plain-language-first calibration; near-ties render as ties |

## Read this first if you are…

- **building a table with metric values** → `colour-and-tiers.md`
- **building anything showing a prediction, a range, or a ±** → `uncertainty-display.md`
- **building any chart, or debugging one that looks subtly wrong** → `chart-craft.md`
- **building the rank simulation, the calibration display, or the Compare table** → `simulation-and-compare.md`

## Blocked on data (check before building)

**Both of this section's original blockers are now RESOLVED** (verified against live published
artifacts, 2026-08-30). Kept as a record so they are not re-investigated:

1. ~~**Per-metric percentiles**~~ — resolved. `TeamMetricSchema.percentile` (0–100) ships on the
   per-team artifact; the teams-table artifact carries the compact `tier` instead
   (`rare`/`epic`/`legendary`, omitted for Common). The split was a measured payload decision:
   publishing `percentile` on every metric costs +42% gzipped, `tier` costs +10%.
2. ~~**Match-level predictive variance on the event artifact**~~ — resolved by Phase 7 plans 07-07
   and 07-08. `redScoreVarianceOwn`/`blueScoreVarianceOwn` are live on `EventMatchSchema` and on
   `EventUpcomingMatchSchema`.

**~~One genuinely open item, for Phase 8~~ — RESOLVED (2026-08-31):**

- **Played event matches carry no `redRpPmf`/`blueRpPmf`.** Only `upcoming[]` does — verified live on
  `2025flta`. The harness *does* compute them (the team artifact publishes them on played matches), so
  this is publisher plumbing, not new computation. Phase 8 D-03 adds them at ~84 bytes/match against
  ~22.7KB of headroom under the 350,000-byte event-artifact budget. **That republish LANDED (08-05, 2026-08-31: 56,774 objects, one generation, verify:subset 35/35) — played event matches now carry `redRpPmf`/`blueRpPmf` (season-dependent length: 5 for 2022–2024, 7 for 2025–2026) plus `actualRedRp`/`actualBlueRp`, and the rank simulation rewinds into played matches on every event.**

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
- 004-rarity-tiers — winner: variant B (Common unboxed; Common treatment superseded by 008)
- 008-common-tier-treatment — winner: variant C (outline-only Common; shipped in quick 260904-7rt)
- 005-rank-distribution — winner: variant B (shared 1..N axis, interpolated band edges); variant C rejected outright
- 006-calibration-curve — winner: variant C (plain-language first)
- 007-compare-table — winner: variant A (season rows, algorithm columns)

**Excluded:** 002-palette-options — all four continuous ramps rejected by the user. Its rejection is
recorded in `colour-and-tiers.md` under "What to Avoid" so the directions are not re-proposed.
</metadata>
