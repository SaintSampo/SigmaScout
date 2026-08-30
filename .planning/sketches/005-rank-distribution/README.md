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

**B — Shared axis, interpolated band edges.** *(Repurposed 2026-08-30 — see "Review outcome" below;
this is the second thing variant B has been.)* Identical to A in every respect — same `1..N` domain,
same histogram bars, same median tick, same `rankToX()` — except the 10th–90th band's start and stop
are no longer read straight off the integer `p10`/`p90` fields. They're computed by treating rank `r`
as occupying the interval `[r-0.5, r+0.5)` with its probability mass spread uniformly inside it, which
makes the CDF piecewise-linear and the quantile continuous (`continuousQuantile()` in `index.html`).

**C — Compact per-row treatment. REJECTED, kept for the record.** Abandons the shared scale entirely.
Each row gets its own small fixed-width cell (130px) scaled to *that team's own* occupied-rank range,
plus the median and 10th–90th numbers spelled out in adjacent columns. Built even though it violates
`uncertainty-display.md`'s shared-scale rule, specifically so the cost of that violation is visible
rather than assumed. Jacob rejected it on review, 2026-08-30, verbatim: "rank distribution C is
terrible." Its tab in `index.html` is marked (danger-coloured, labelled REJECTED) and its caption
records the verdict; it is not a live candidate.

## Review outcome, 2026-08-30

Jacob's review, verbatim: *"rank distribution C is terrible. I cant tell a difference between A and B.
Idea, for the histogram 1 SD is highlighted right? it looks like it only falls on integer ranks
though. let the SD region have noninteger start and stop points."* (The highlighted region is the
10th–90th percentile band, not 1 SD — a misremembering, not a change request; D-05 chose percentiles
deliberately because rank is bounded and skewed, and the `±` glyph stays reserved per Phase 7 D-01.
The band-edges observation is correct and is what changed.)

Three consequences:

1. **C is rejected**, kept in the file and this doc for the record, tab clearly marked.
2. **A and B (the axis-clip version) were genuinely indistinguishable** — which is exactly what "THE
   FINDING" below already proved mathematically (0px reclaimed on all three real events). The user's
   own eyes independently confirming that finding is the second, human proof of the same result. The
   old B is retired rather than kept as a dead tab, since it added a whole variant slot for a scale
   that never differs from A's.
3. **Variant B is repurposed** into the thing the integer-snap complaint actually calls for:
   continuous 10th–90th band edges. See "Variant B, take two" below.

## THE FINDING — variant B's original mechanism was a mathematical no-op on a full-field table

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

The sketch computed this live (not hardcoded) and showed the exact numbers in a callout on the old
variant B, for whichever event was selected, so it held up under inspection rather than being
asserted. That callout, and the `computeDomainB()`/clip logic behind it, are gone from `index.html`
now that B has been repurposed — this section is the historical record of why, kept because the
result (a full-field table can never clip) is still true and still worth knowing even though it no
longer drives anything on screen.

## Variant B, take two — interpolated band edges

The user's integer-snap observation is real and measurable independently of the clip finding above:
`p10`/`p90` are read straight from the simulation as the smallest/largest integer rank at or past the
target percentile, so any row whose 10th and 90th percentile land on the same integer draws a
**zero-width, invisible** band, and any two rows that happen to land on the same integer pair look
identical even when their underlying distributions differ.

**Method.** Treat rank `r` as occupying the interval `[r-0.5, r+0.5)` with its probability mass spread
uniformly inside it. That makes the CDF piecewise-linear and the quantile continuous — standard
practice, and it matches R's default type-7 quantile behaviour on binned data:

```js
// dist[i] = draws that landed at rank i+1 ; draws = total draws
function continuousQuantile(dist, p, draws) {
  const target = p * draws;
  let cum = 0;
  for (let i = 0; i < dist.length; i++) {
    const m = dist[i];
    if (m === 0) continue;
    if (cum + m >= target) {
      const frac = (target - cum) / m;
      return (i + 1) - 0.5 + frac;   // rank coordinate, continuous
    }
    cum += m;
  }
  return dist.length + 0.5;
}
```

Bounded by construction: the loop can only return either a point inside `[0.5, dist.length + 0.5]` or
the fallback `dist.length + 0.5`, so an edge can never fall below rank 0.5 or above rank N+0.5 — it
never needs its own clamp.

**Verified before/after**, `continuousQuantile()` run against the real `dist` arrays in `data.js`,
independently reproduced and matched exactly during this revision:

| Event | Team | Snapped (A) | Interpolated (B) | Width A → B |
|---|---|---|---|---|
| 2023nhgrs | 3467 | 1–1 | 0.60–1.40 | 0 → 0.80 |
| 2023nhgrs | 95 | 2–3 | 1.65–3.20 | 1 → 1.55 |
| 2023nhgrs | 4564 | 2–3 | 1.80–3.49 | 1 → 1.69 |
| 2023nhgrs | 238 | 4–5 | 3.52–4.61 | 1 → 1.08 |
| 2023nhgrs | 1922 | 5–12 | 5.28–12.36 | 7 → 7.09 |
| 2025flta | 386 | 1–1 | 0.60–1.42 | 0 → 0.82 |

Teams 95 and 4564 are the clearest case for why this matters beyond the zero-width rows: both read
`2–3` under variant A — identical, despite team 4564's distribution (330/574/87/8 across ranks 1–4)
being visibly wider than team 95's (3/666/330/0/1). Variant B separates them (1.65–3.20 vs.
1.80–3.49) because the interpolation reads the actual mass, not just which integer bin it crossed.

**Zero-width band counts**, computed live in `index.html` (`zeroWidthInfo()`) and shown as an
always-visible readout above the table on both the A and B tabs, per event:

| Event | Rows | Zero-width under A (`p10 === p90`) |
|---|---|---|
| 2023nhgrs | 39 | **2** (teams 3467, 663) |
| 2025flta | 42 | **3** (teams 386, 9627, 9493) |
| 2022ispr | 17 | **0** |

Every one of those zero-width rows is a locked leader or a locked last-place team — not visible in
variant A's band at all — and every one draws a real, sub-1-rank-wide band under variant B instead.

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
| **A** | Full shared axis, 1..N (UI-SPEC as written) | Total honesty, one trustworthy scale everywhere. ~11px/rank at 42 teams: locked top rows render as slivers, but typical mid-pack bands (median 3–7 ranks) are 33–77px and read fine. Integer-snapped band edges also produce 2–3 zero-width, invisible bands per event |
| **B** | Shared axis, interpolated band edges *(repurposed 2026-08-30)* | Same comparability and whitespace cost as A, but every row's 10th–90th band is real and continuous — no zero-width rows, no same-label collisions between differently-shaped distributions. Costs one extra decimal digit in the printed range |
| **C** | Compact, per-row own scale — **REJECTED** | Maximum per-row legibility at any team count. Destroys cross-row comparison; violates the shared-scale rule on purpose so the cost is visible. Rejected by the user on review, 2026-08-30 ("terrible") |

## Open questions for the reviewer

1. **A or B** — now that B renders real, continuous 10th–90th edges instead of the retired axis-clip,
   is the extra decimal digit in the printed range (`1.7–3.2` vs `2–3`) worth it for fixing the
   zero-width and same-label-different-width cases documented above? C is off the table (rejected on
   review, 2026-08-30).
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
