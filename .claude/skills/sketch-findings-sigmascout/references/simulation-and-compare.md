# Simulation & Compare

Decisions from sketches 005, 006 and 007 (2026-08-30), all validated against **real published data** —
1000-draw Monte Carlo output over live `pRedWin` / `redRpPmf` artifacts, and the live
`v1/compare/{year}.json` files. No synthetic samples were used to reach any conclusion here.

## Design Decisions

### The rank-distribution row (sketch 005, winner B)

**Shared `1..N` rank axis, drawn once in a table header. Per-row: histogram bars, a translucent
10th–90th band overlaid on top of them, a median tick drawn last.**

**The band's edges are CONTINUOUS, not integer ranks.** This is the decision. Treat rank `r` as
occupying `[r-0.5, r+0.5)` with its probability mass spread uniformly inside, making the CDF
piecewise-linear and the quantile continuous — R's default (type-7) estimator on binned data, not a
bespoke smoothing. Reference implementation is `continuousQuantile()` in
`sources/005-rank-distribution/index.html`.

Bounded by construction: an edge can never fall below `0.5` or above `N+0.5`, so a band never implies
a rank that cannot exist.

Measured against real data, integer snapping caused three distinct defects:

| | Snapped | Interpolated |
|---|---|---|
| A locked team (3467 @ 2023nhgrs) | `1–1`, width **0 — invisible** | `0.60–1.40`, width 0.80 |
| Team 95 @ 2023nhgrs | `2–3`, width 1 | `1.65–3.20`, width 1.55 |
| Team 4564 @ 2023nhgrs | `2–3`, width 1 | `1.80–3.49`, width 1.69 |

1. Locked teams vanish — 2 of 39 rows at `2023nhgrs`, 3 of 42 at `2025flta`, drew a zero-width band.
2. Genuinely different distributions render as identical bands (95 vs 4564 above).
3. Up to a full rank of quantization error at each edge.

**Never label a rank spread with `±`.** Phase 7 D-01 reserves that glyph for exactly one standard
deviation of full predictive variance; a percentile range is a different quantity. Write it out:
`10th–90th: 1.7–3.2`, one decimal place.

**Mean ± SD was rejected for rank outright** — rank is bounded and skewed, so mean 3.0 with SD 4.0
produces a band spanning −1.0 to 7.0, and rank −1 does not exist.

**Per-row scales were rejected by the user** ("terrible"). The shared-scale rule from
`uncertainty-display.md` holds here: one scale per view, never per row.

### The calibration display (sketch 006, winner C)

**Lead with a sentence, demote the chart to supporting evidence.** The primary content reads like
`when VPR said 70%, red actually won 71% of the time (1,204 matches)`. A reliability diagram asks the
reader to judge distance from a 45° line, which is a learned skill this audience (FRC students,
mentors, scouts) mostly does not have.

**The sentence form MUST print the sample count and MUST flag small samples.** Bin counts range from a
single match to 5,950. Prose hides sparsity that a shrunken chart point makes obvious, so the
sparse-bin encoding is what keeps this variant truthful rather than a decoration on it.

**Series colours, validated with the dataviz skill's `validate_palette.js`** (`--pairs all`, light
mode): OPR orange `#EA580C`, EPA violet `#7C3AED`, VPR teal `#0D9488`. Worst-pair CVD ΔE 13.8/13.6,
normal-vision ΔE 28.8. Two candidate trios were tested and rejected for failing CVD checks
(orange/violet/fuchsia; orange/teal/magenta). These avoid alliance red/blue and the win/loss
emerald/rose.

### The accuracy table (sketch 007, winner A)

**Season rows, algorithm columns** — five rows (2022–2026), three algorithm column-groups, each
carrying accuracy and Brier. Six data columns.

**No per-algorithm identity colour anywhere.** The palette is spent: red/blue means alliances,
sky/purple/amber means rarity tier, teal/cyan/indigo/slate means percentile tier, green/rose means
win/loss. Labelled, spatially-separated columns disambiguate three algorithms without a fourth hue.

**Known and accepted:** variant A does not reflow at 390px; it scrolls horizontally inside
`.tablewrap`. That is the established shipped pattern on this site and Phase 7 built an e2e suite
around it (only the table moves, the page never pans), so A inherits a solved problem — but any
implementation must wire those scroll-arbitration guarantees rather than assume them.

## Near-ties render as ties, not defeats (cross-cutting)

**This qualifies `chart-craft.md`'s "grey the loser's number, never its mark" — that rule assumes a
loser exists.** Where the published data cannot establish one, neither value is greyed.

Sketch 007 measured two cases the Compare page would otherwise misreport:

- **2022 elimination Brier:** OPR `0.14721` vs VPR `0.14717`. VPR wins — the "VPR leads Brier in all
  15 slices" statement holds — but by `0.00004`, and both render as `0.1472`. One bold, one grey,
  identical on screen: a reader sees a rendering bug, not a result.
- **Elimination winner accuracy:** VPR loses to OPR in 2022 (1.06pp), 2024 (**0.02pp — 0.6 matches of
  2,867**) and 2025 (0.25pp). Every gap sits inside a naive one-standard-error bound.

**Honest limit on that claim, stated so nobody over-reads it:** the SE treats the algorithms as
independent when they are scored on the same matches. A paired (McNemar) test would use a smaller
error and might find 2022's gap real — but it needs the count of matches where the two disagreed, and
the artifact does not publish it. So: *the published data cannot tell a reader whether these gaps are
real.* The threshold for the tie band is therefore a judgement call, not a computed significance
level, and the page must say so.

Recorded as **D-11 in `08-CONTEXT.md`**. Does not affect SC-3, which is measured on the combined view.

## What to Avoid

- **Do not clip a shared rank axis to "the union of occupied ranks."** It is a mathematical no-op on
  any full-field table and reclaims exactly zero pixels — proven, then independently confirmed by the
  user seeing no difference between the two variants. Every draw assigns each of N ranks to exactly one
  team, so every rank column sums to the draw count and every rank is always occupied by somebody.
  (Verified: exactly 1000 per rank, every rank, all three events.) It can only help on a *partial*
  roster — one team plus neighbours — which is a different feature.
- **Do not use mean ± SD for a bounded, skewed quantity** like rank. See above.
- **Do not give each row its own scale.** Rejected by the user on sight.
- **Do not assume a rank distribution is broad.** Even simulating a whole 32-match event from scratch
  with nothing played, the middle 80% spans only 1–5 ranks of 17. Spread is concentrated mid-table:
  0–12 ranks at `2023nhgrs` (median 7), 0–10 at `2025flta` (median 3).
- **Do not generalise from the top of a rank table.** The top rows are the most locked; sampling the
  first 12 rows suggested near-universal 1-rank spreads and was wrong about the field by a factor of
  three. This mistake was actually made during this session and corrected only by measuring every row.

## Data notes for implementers

- **RP distributions are VPR-only.** OPR and EPA publish neither `redRpPmf` nor `redScoreVarianceOwn`
  — verified on the live OPR event artifact. The Simulation tab cannot run on them.
- **Played event matches do not carry `redRpPmf`/`blueRpPmf`** — only `upcoming[]` does. The team
  artifact publishes them on played matches, so the harness computes them; they are simply absent from
  the event artifact. Phase 8 D-03 adds them (~84 bytes/match).
- **A simulation restricted to genuinely-unplayed matches is dead almost everywhere:** 41 of 1,353
  corpus events have any unplayed qualification match, and most are abandoned offseason events.
- **The calibration case that justifies the whole Compare page:** 2026 qualification, OPR predicted
  85.3% and observed 52.8% across 395 matches — a 32.5pp overconfidence gap in a well-populated bin,
  while OPR's headline accuracy (74.8%) sits only four points behind VPR's. A bare accuracy number
  hides this completely.

## Origin

Synthesized from sketches: 005, 006, 007.
Source files available in: `sources/005-rank-distribution/`, `sources/006-calibration-curve/`,
`sources/007-compare-table/` — each carries its real `data.js` alongside the HTML.
