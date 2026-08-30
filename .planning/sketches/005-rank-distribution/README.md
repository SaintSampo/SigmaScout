---
sketch: 005
name: rank-distribution
question: "How should a team's simulated rank distribution be drawn, given what real data actually looks like?"
winner: TBD — awaiting user review
tags: [simulation, rank-distribution, uncertainty, phase-8]
---

# Sketch 005: Rank distribution

## Why this exists

The remaining-quals rank simulation runs client-side (1000 draws over published win probabilities
and RP distributions), and every team ends up with a `dist[rank]` histogram — a locked leader has
one 100%-tall spike, a mid-pack team spreads across a dozen ranks. The UI-SPEC locks a shared rank
axis `1..N` at `PLOT_W = 470` so every row reads on one trustworthy scale. But at 42 teams that is
`470 / 42 ≈ 11px` per rank. That sounded fatal when this sketch was commissioned, on the strength of
a top-12 sample suggesting near-universal 1-rank spreads. **Measured over every team, it is not.**
p10–p90 spreads run 0–12 of 39 ranks (median 7) at `2023nhgrs`, 0–10 of 42 (median 3) at `2025flta`,
and 1–5 of 17 (median 3) at `2022ispr`. So a typical mid-pack band is 33–77px wide, not 11px, and the
"mostly empty cell" premise holds only for the handful of locked rows at the top of the table.

The constraint that *does* survive measurement is harder and more interesting: **a 0-width band and a
12-wide band must both read correctly in the same column, on adjacent rows.** Rank 1 at `2023nhgrs` is
locked at 100% while a team ten rows down spans 12 ranks.
`uncertainty-display.md` locks "one shared scale per view, never per row," so the obvious fix
(zoom each row to its own data) is already ruled out by a standing project decision. This sketch
makes that trade visible using **real** 1000-draw output, not a convenient synthetic sample, over
three events chosen to span the regime space:

- **2023nhgrs** — 39 teams, 26 of 93 quals remaining. Heterogeneous: rank 1 is locked at 100% while
  a team ten rows down (1073, `p10=7, median=10, p90=16`) spans 9 ranks — and the true worst case in
  this field is wider still: teams 1058 and 6763 both span 12 ranks (`7–19` and `15–27`).
- **2025flta** — 42 teams, 21 of 84 remaining. Mostly near-locked (most spreads are 1–4 ranks), but
  not uniformly — a mid-pack cluster (9313, 2556, 6322) still spans 9–10 ranks. `data.js`'s own
  descriptive `note` field ("every spread 0–4") undersells this; the sketch trusts the computed
  `dist` arrays, not the note.
- **2022ispr** — 17 teams, 32 of 32 remaining, nothing played yet. Widest available regime, and still
  only 1–5 ranks (team 8223: `p10=7, median=9, p90=12`).

## What each variant does

**A — Full shared axis, 1..N, as the UI-SPEC specs it.** One shared scale drawn once in the table
header, histogram bars (bar height normalized to that row's own peak draw count — a density
visualization, not a second value axis, so it doesn't conflict with the shared-scale rule, which
governs rank *position* only), a translucent 10th–90th band drawn on top of the bars, and a solid
median tick drawn last, on top of everything. The whitespace problem renders exactly as bad as the
arithmetic predicts — nothing is flattered.

**B — Shared axis, clipped to the observed data.** Same single scale (still fully comparable across
rows), but the domain is computed live from the union of every team's occupied ranks in `dist`,
padded ~5% and clamped to `[1, N]`, instead of hardcoded to `1..N`.

**C — Compact per-row treatment.** Abandons the shared scale entirely. Each row gets its own small
fixed-width cell (130px) scaled to *that team's own* occupied-rank range, plus the median and
10th–90th numbers spelled out in adjacent columns. Built even though it violates
`uncertainty-display.md`'s shared-scale rule, specifically so the cost of that violation is visible
rather than assumed.

## THE FINDING — variant B is a mathematical no-op on a full-field table

The design brief for B says: *"On an event where nobody is ever worse than rank 22, this reclaims
the empty right half."* Built and measured against all three real events, that never happens:

| Event | N | Raw occupied-rank union | Padded + clamped domain | Reclaimed |
|---|---|---|---|---|
| 2023nhgrs | 39 | `[1, 39]` | `[1, 39]` | **0px of 470px** |
| 2025flta | 42 | `[1, 42]` | `[1, 42]` | **0px of 470px** |
| 2022ispr | 17 | `[1, 17]` | `[1, 17]` | **0px of 470px** |

This is not a coincidence of these three datasets — it is **provably always true for any complete
rank-distribution table**. Every draw assigns each of the N ranks to exactly one team, so for a
fixed rank position, the counts across all N teams' `dist[i]` must sum to exactly the number of
draws (verified: every single rank in every one of the three real events sums to exactly 1000).
That means every rank from 1 to N is occupied by *some* team, in every draw, always — so "the union
of all teams' occupied ranks" is mathematically identical to `1..N` the instant the table includes
the whole field. Clipping can only reclaim space if the table shows a **partial slice of teams** — a
single team's own row with a few neighbors, a playoff-bubble range — never a full-roster table.

The sketch computes this live (not hardcoded) and shows the exact numbers in a callout on variant
B, for whichever event is selected, so this holds up under inspection rather than being asserted.

## The tension with `uncertainty-display.md`

The file locks "zoom per view, never per row" specifically because 003's first drafts made every
match's band incomparable to its neighbors. That lesson transfers directly here: variant C is more
legible *per row* than A or B by a wide margin — a locked team fills its cell decisively, a
12-rank-spread team fills its cell just as clearly, regardless of team count — but two cells of
identical width can represent wildly different certainty, and the plot itself carries zero
information about which team is more or less sure of its finish. You have to read the numeric
columns, not the marks, which defeats the purpose of plotting it at all. That is the accepted rule
working as intended, made visible rather than taken on faith.

## Variants

| | Direction | Trade |
|---|---|---|
| **A** | Full shared axis, 1..N (UI-SPEC as written) | Total honesty, one trustworthy scale everywhere. ~11px/rank at 42 teams: locked top rows render as slivers, but typical mid-pack bands (median 3–7 ranks) are 33–77px and read fine |
| **B** | Shared axis, clipped to observed data + padding | Same comparability as A, in principle narrower. On real full-field data: **0px reclaimed on all three events tested**, for a structural reason, not bad luck |
| **C** | Compact, per-row own scale | Maximum per-row legibility at any team count. Destroys cross-row comparison; violates the shared-scale rule on purpose so the cost is visible |

## Open questions for the reviewer

1. **A or C — B is not a real third option on a full-field table**, per the finding above. Is there
   a page where B's mechanism *would* apply — e.g. a Team page showing one team plus its immediate
   rank neighbors, rather than the whole event field? That's a genuinely different, smaller table,
   worth its own sketch if wanted.
2. **Does the rank-distribution plot belong on the Event page at all**, given A's honest whitespace
   problem at higher team counts? Statbotics does not attempt this visualization; SigmaScout would
   be introducing it from scratch.
3. **Bar-height normalization is per-row** (each row's tallest bar reaches the same pixel height,
   regardless of that row's peak probability). This was treated as a density-visualization choice,
   not a second value axis, so it wasn't read as violating the shared-scale rule — worth confirming
   that reading holds.
4. Untested on a phone. At 390px, `PLOT_W = 470` alone exceeds the viewport; the `.tablewrap`
   scrolls horizontally, but this needs a real mobile pass before it ships.

## Files

- `index.html` — three variants × three real events, event switcher + variant tabs, viewport toolbar
- `data.js` — real 1000-draw Monte Carlo output (pre-existing, not generated by this sketch)
- Theme: `../themes/default.css`
