# Sketch Manifest

Throwaway HTML mockups for exploring design directions before committing to implementation.
Nothing here ships — these exist to make a decision reviewable.

## Design direction

**Feel:** "Serious tool, more alive." Colour carries meaning — rank tiers, confidence, win/loss,
uncertainty — never decoration. Dense and fast, but not austere.

**Reference points:** Statbotics and The Blue Alliance. This sits in tension with **D-05**, which
deliberately avoided their blue-dominant chrome so SigmaScout would read as its own tool. Sketch 001
put both sides side by side; sketch 002 turns it into a concrete choice.

**Settled so far:**
- **Discrete percentile tiers, not continuous shading** — the user rejected all four ramps in 002 and
  proposed Statbotics-style banded boxes with card-game rarity colours (sketch 004). A gradient makes
  you compare; a tier gives you a name you can say out loud.
- **Interval axes** (001-C) are wanted, and wanted *more widely* — extended to match predictions in
  sketch 003 at the user's request.
- **DECIDED (004-B): rarity tiers, Common unboxed.** Rare `#E0F2FE`/`#0369A1`, Epic
  `#F3E8FF`/`#7E22CE`, Legendary `#FEF3C7`/`#B45309`; 0–50 renders plain. Identity hues are sky
  `#0EA5E9` / purple `#9333EA` / amber `#F59E0B` — **sky, never true blue**, for the CVD reason
  below. This supersedes 002 entirely and largely answers D-05: the palette is neither Statbotics
  blue nor the shipped indigo.

**Constraints carried in from Phase 5:**
- `05-UI-SPEC.md` locked 60/30/10: slate-50 / slate-100 / indigo-600, accent for interactive-or-active
  states only.
- **D-06's token discipline held through all of Phase 5** — verified zero hex literals in component code
  outside shadcn's generated files. A palette change is a token swap, not a component sweep.
- The `X ± Y` sigma display (D-07) is the stated differentiator and must survive any visual direction.
- **~~D-09 vs D-10~~ — SUPERSEDED 2026-08-30 by Phase 7 D-01.** This file previously said the
  team-page ± (match-to-match consistency) and the match-prediction ± (full predictive variance)
  were deliberately *different quantities*. **They are not, any more.** Phase 7 D-01 rejected that
  two-quantity design outright: **every `±` on this site, in every table and every plot, is one
  standard deviation of the full predictive variance `√(P + R)`.** D-09 consistency is still
  computed but is never displayed and never published. Drawing a band from only part of the
  variance produces bands wrong by 7–10σ.

  Corollary for any new sketch: a spread that is *not* that quantity — a rank percentile range,
  for instance — must never be labelled with a `±` glyph at all. Write the range explicitly.

## Sketches

| # | Name | Question | Winner | Tags |
|---|------|----------|--------|------|
| 001 | teams-table-polish | How much colour, carrying what meaning — and is D-05 still right? | A's shading + C's axis (partial) | teams-table, palette, ribbon, density, uncertainty |
| 002 | palette-options | Which hue carries percentile shading? | **rejected** — superseded by 004 | palette, teams-table, sequential |
| 004 | rarity-tiers | Statbotics-style percentile boxes in rarity colours — where do tiers earn their place? | **B — Common unboxed** | palette, percentile, rarity, accessibility |
| 003 | alliance-axes | How should match predictions with uncertainty be laid out, at what scale? | **C — event table, one shared scale** | match-prediction, uncertainty, phase-6, phase-7 |
| 005 | rank-distribution | How should a team's simulated rank distribution be drawn, given what real data actually looks like? | **B — interpolated band edges** | simulation, rank-distribution, uncertainty, phase-8 |
| 006 | calibration-curve | How do you draw a calibration curve an FRC student understands in one read? | **C — plain-language first** | compare, calibration, uncertainty, accessibility, phase-8 |
| 007 | compare-table | How do you lay out 45 accuracy numbers so the reader sees the result, not a wall of digits? | **A — season rows, algorithm columns** | compare, accuracy, table, density, phase-8 |
| 008 | common-tier-treatment | How should Common (0–50) be treated so it reads as a tier, not an absence? (revisits 004-B "Common unboxed" at the user's request) | *pending* | palette, percentile, rarity, accessibility |

## Findings so far

**Design**

- **The uncertainty spread is real design material, not a footnote.** Team spreads range ±2.09 to ±91.14
  (median ±5.57); teams with near-identical records differ substantially in confidence.
- **Ranks 6–14 in 2026 have overlapping ±1σ intervals** — statistically indistinguishable, yet the shipped
  table renders them as a confident ordered list. Arguably a correctness problem in how the page
  communicates, not merely an aesthetic one.
- **Interval visualisations need a zoomed axis.** Anchored at zero, spreads of 5–11 against totals of
  274–418 collapse to invisible. Trade: bar *length* then stops encoding magnitude, so the axis must be
  labelled.
- **…but zoom PER VIEW, never per row.** 003's first two drafts gave each match its own domain, which
  made rows readable alone and incomparable to each other — two matches ~150 points apart rendered at
  similar positions. **DECIDED (003-C): one shared scale per event**, axis drawn once in a table header.
  A miss then reads as distance on a scale you can trust across rows.
- **Layout must be rendered and looked at, not reasoned about.** 003's first draft had label collisions in
  all three real matches — they only separate when the alliances differ, which is precisely the case the
  chart exists to show. A later draft had every actual dot mis-centred on its band, because the dot's
  position was a separate hand-tuned constant rather than derived from the band's.
- **Derive coupled geometry, never hand-tune both ends.** Any two marks that must line up should share
  one computed source; two independent magic numbers silently drift.
- **Grouping is proximity, not labelling.** Two marks belonging to the same row must be markedly closer
  to each other than to the neighbouring row — 003 needed ~4x (12px within vs 47px between) before the
  pairing read correctly.
- **Grey the loser's NUMBER, never its mark.** On a predicted-vs-actual view, greying the losing score
  in the results column lets the reader answer "who won" from the numbers alone. Do NOT extend it to the
  plotted marks: there, colour carries alliance *identity*, and greying half the dots breaks that
  encoding to restate what the Call column already says. Same device, different jobs.

**Colour (computed, not eyeballed)**

- **FRC red/blue passes CVD validation**: `#DC2626` vs `#2563EB` → ΔE 29.9 protan (target ≥ 8), plus
  lightness, chroma, and contrast. The domain convention is safe to keep.
- All four candidate sequential ramps (indigo / teal / amber / slate) verified **monotonic in OKLab
  lightness**.
- Structural argument for a non-red, non-blue chrome hue: red and blue are spoken for by alliances, so a
  chrome that avoids both never competes with alliance colour on match pages.
- **Classic card-game rarity colours fail CVD.** Rarity blue `#3B82F6` vs purple `#9333EA` → ΔE 1.3
  deutan: the two middle tiers are the same colour to ~6% of males. Pushing blue toward CYAN fixes it —
  `#0EA5E9` vs `#9333EA` → ΔE 14.1 deutan / 26.5 normal. Same vocabulary, readable.
- **Sorted columns cannot carry tier information.** Adjacent rows in a sorted table share a tier by
  construction, so the box restates the rank. Tiers earn their place on mixed sets (Event, Team,
  Compare) and — importantly — on the *unsorted component columns* of the Teams table, where "Rare
  overall but Epic in Hub Auto" is real scouting signal.
- **Mock against the real distribution, not the visible rows.** 004's first build computed percentiles
  within its 14-row sample and looked great; against the true 3,709-team field the top of the table is
  uniformly Legendary. The flattering version would have shipped a wrong conclusion.

**Pipeline gap uncovered by sketching (actionable)**

- **Match-level predictive variance (D-10's `P + Q + R`) is computed by the harness but never published.**
  `EventMatchSchema` carries scores, `pRedWin`, and per-component mean/variance only. Any interval display
  of a match prediction is therefore either wrong or impossible until the artifact publishes it. Cheap to
  add — the value already exists at compute time. **Input for Phase 6/7 planning.**
