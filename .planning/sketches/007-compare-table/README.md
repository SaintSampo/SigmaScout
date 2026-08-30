---
sketch: 007
name: compare-table
question: "How do you lay out 45 accuracy numbers so the reader sees the result, not a wall of digits?"
winner: null
tags: [compare, accuracy, table, density, phase-8]
---

# Sketch 007: Compare table

## Why this exists

The Compare page has to show winner accuracy and Brier score for three algorithms (OPR, EPA, VPR)
across five seasons (2022–2026) in three match-type views (qualification / elimination /
combined) — 90 numbers if you count every cell, 45 if you count only the currently-selected view.
Statbotics doesn't attempt this; SigmaScout's whole pitch is "measurably better, and we publish
the proof," so this table is where that proof lives. The design question is purely about density:
what layout lets a reader land on "VPR wins" without reading digits, while still keeping the
digits one click away for anyone who wants them.

Two locked decisions constrain every variant:

1. **All five seasons get identical visual treatment.** No tune/holdout grouping, tiering, or
   differential emphasis — that distinction is disclosed once, in a methodology note, never as
   the table's organising principle.
2. **Exclusion counts are surfaced, worded carefully.** Offseason matches feed the model but are
   excluded from scoring — never "ignored." 2025 alone has 23,792 candidate matches and only
   17,815 scored; the 5,915-match gap is offseason exclusion plus 62 surrogate-affected matches.

## What the real data showed

**VPR has the lowest Brier score in all 15 season×view combinations in this dataset** — every
year, every match-type view, no exceptions. Combined-view Brier: 2022 VPR 0.1592 vs EPA 0.1917 /
OPR 0.1890; 2023 0.1687 vs 0.1989 / 0.2171; 2024 0.1761 vs 0.2169 / 0.2126; 2025 0.1617 vs 0.1941 /
0.2119; 2026 0.1501 vs 0.1741 / 0.2211.

**Accuracy is where the match-type split earns its keep.** VPR wins accuracy in 12 of 15 slices —
every Qualification and every Combined view — but **loses Elimination-view accuracy to OPR in
three separate seasons**: 2022 (OPR 79.30% vs VPR 78.24%), 2024 (OPR 70.94% vs VPR 70.92%, a
0.02-point margin), and 2025 (OPR 75.78% vs VPR 75.52%). A Combined-only table erases all three of
these — they only exist in the Elimination slice.

**The specific finding the brief called out:** 2025, Elimination view — OPR's Brier is **0.1767**,
beating EPA's **0.1897**, even though OPR loses badly to EPA on Qualification that same season
(OPR 0.2192 vs EPA 0.1950). VPR still wins the Elimination Brier outright (0.1640), but the
OPR-beats-EPA reversal between the two views is real and only visible once you switch off
Combined. All three variants surface it through the match-type switcher; when Elimination is
selected, the switcher's hint text states this exact comparison inline rather than leaving it
buried in the table.

**An honest edge case worth flagging for the real implementation:** at this display precision, two
genuine near-ties render as visually identical numbers with different font-weight. 2022
Elimination Brier is OPR 0.14721 vs VPR 0.14717 — both display as "0.1472," yet one is bold and
the other grey. 2024 Elimination accuracy is OPR 70.939% vs VPR 70.919% — both display as "70.9%."
The bold/grey distinction is real and float-exact in every variant here, but a reader staring at
two identical-looking numbers with different weight will reasonably wonder if it's a bug. Worth a
tie-band threshold or a tooltip in the shipped version; out of scope for this sketch.

## Variants

- **A — Season rows, algorithm columns.** Five rows (2022–2026), three algorithm column-groups
  (OPR / EPA / VPR), each carrying Accuracy and Brier. Reads chronologically — you scan down a
  column-group to see one algorithm's trend across seasons. Comparing algorithms *within* one
  season means scanning across the row instead.
- **B — Algorithm rows, season columns.** Three rows (OPR / EPA / VPR), five season column-groups.
  Reads as a head-to-head — VPR's row is almost entirely bold, OPR's and EPA's almost entirely
  grey, and that pattern alone tells the story before a digit is read. Ten data columns makes it
  the widest table of the three.
- **C — Small-multiple summary.** Three compact panels (one per algorithm), each with a win tally
  ("5/5 seasons on accuracy") and two sparklines (Accuracy, Brier) on a scale shared across all
  three panels so their shapes are directly comparable. The full Variant-A-shaped table sits
  underneath for anyone who wants the exact digits — the sparkline's shared scale compresses small
  differences (the 2022 near-tie is invisible in it), which is exactly why the table stays attached
  rather than replacing it.

All three variants share the same match-type switcher (Combined / Qualification / Elimination),
the same methodology note (tune vs holdout disclosure), and the same data-coverage table
(candidate/scored/exclusion counts, worded per the locked decision above) — they differ only in
how the main comparison table is laid out.

No per-algorithm identity colour is used anywhere in this sketch. OPR/EPA/VPR are told apart by
column or row position and label text alone. SigmaScout has already spent red/blue (alliances),
sky/purple/amber (rarity tiers), teal/cyan/indigo/slate (percentile tiers), and green/rose
(win/loss) on other meanings; a 3-way table with clearly labelled, spatially-separated columns
doesn't need a fourth hue to disambiguate, so this sidesteps the "don't reuse an existing palette"
constraint by not needing new colour at all. The only colour doing work is the existing indigo
interactive accent (active nav/switcher state, sparkline ink) and plain text-weight/text-colour
for winner vs loser — bold + full ink for the winning value, grey + regular weight for the other
two, never colour-coded. That's "grey the loser's number, never its mark" from chart-craft.md,
applied to plain numerals since there's no mark to grey here.

## How each variant handles 390px

Built and reasoned through carefully rather than assumed — the toolbar's 390 viewport preset
narrows a real frame around the page content (the tab bar stays real-viewport-width, matching
house style) so this is checkable directly in a browser, not just claimed:

- **A and B do not survive 390px without horizontal scroll**, and this sketch does not pretend
  otherwise. A has a row-label column plus six data columns (three algorithm groups × Accuracy +
  Brier); B has a row-label column plus **ten** data columns (five season groups × 2) — B is
  measurably the wider table and the more scroll-dependent of the two at any narrow width. Both
  sit inside a `.tablewrap { overflow-x: auto }` container (house pattern from 004), so the page
  itself never breaks — the table scrolls internally, the switcher and methodology note above and
  below it stay put — but neither is a "read at a glance on a phone" table.
- **C is the one built with a real fallback**, not just a claim: a `max-width: 480px` media query
  switches `.panels` from a 3-across flex row to a single stacked column, so the three win-tally +
  sparkline panels are each full-width and readable without any horizontal scroll on a phone. Its
  embedded full-digit table underneath is literally Variant A's table, so it inherits the exact
  same horizontal-scroll behavior as A once you scroll down to it — the summary survives 390px
  natively; the digits-on-demand part doesn't pretend to.

## Files

- `index.html` — three variants, one shared data layer, all real 2022–2026 published numbers
- `data.js` — real published `v1/compare/{year}.json` artifacts (not regenerated for this sketch)
- Theme: `../themes/default.css`

## DECIDED during this sketch: near-ties render as ties, not defeats

The sketch surfaced that VPR loses **winner accuracy** to OPR on elimination matches in 2022, 2024
and 2025, while winning Brier in all 15 season × view slices. Measured, those three "losses" are:

| Season | VPR | OPR | Gap | In matches | Naive 1 SE |
|---|---|---|---|---|---|
| 2022 | .7824 | .7930 | 1.06pp | ~28 of 2,613 | 1.14pp |
| 2024 | .7092 | .7094 | **0.02pp** | **0.6 of 2,867** | 1.20pp |
| 2025 | .7552 | .7578 | 0.25pp | ~8 of 3,056 | 1.10pp |

Every gap sits inside one standard error, and 2024's is smaller than a single match.

**Two caveats on that arithmetic, stated so nobody over-reads it.** The SE above treats the two
algorithms as independent samples when they are scored on the *same* matches; a paired test
(McNemar's) would use a smaller error and could plausibly find 2022's 1.06pp real. That test needs
the count of matches where the two algorithms disagreed, and the published artifact does not carry
it. So the defensible claim is narrow: **the published data cannot tell a reader whether these gaps
are real.**

**Decision (user, 2026-08-30): tie band, no new published data.** Differences below a chosen
threshold render as a visual tie — both values in full ink, neither greyed — instead of declaring a
winner. This uses only what is already published. The threshold is a judgement call, not a computed
significance level, and the page must say so rather than implying statistical backing it does not
have.

Rejected: publishing bootstrap intervals or paired-disagreement counts (real harness + publisher
work plus a republish, on an already-sizeable phase); and declaring winners regardless of margin
(would render a 0.6-match difference across 2,867 matches as a defeat, which is exactly the
overclaiming this project is built against).

This qualifies `chart-craft.md`'s "grey the loser's number, never its mark" — that rule assumes
there *is* a loser. Where the data cannot establish one, neither value is greyed.

**Carry-forward:** this decision must reach the Phase 8 planner. It is not yet in `08-CONTEXT.md`.

## Winner

TBD — awaiting user review.
