---
sketch: 006
name: calibration-curve
question: "How do you draw a calibration curve so an FRC student, mentor, or scout understands it in one read — and how do you keep sparse bins from overstating their own reliability?"
winner: TBD — awaiting user review
tags: [compare, calibration, uncertainty, accessibility, phase-8]
---

# Sketch 006: Calibration curve

## Why this exists

A calibration curve answers a specific question — "when this model claimed 70% confidence, how
often did that actually happen?" — and it is the single strongest evidence that SigmaScout's
`X ± Y` uncertainty is honest rather than decorative. That is the project's whole stated
differentiator against Statbotics. But almost nobody in the target audience has seen one before,
so this sketch treats the explanation as being at least as important as the chart itself.

Three variants, tab-switchable, over the same nine real slices per year (`opr` / `epa` / `vpr` ×
`combined` / `qualification` / `elimination`), for all five published years 2022–2026:

- **A — Classic reliability diagram.** Predicted probability on x, observed frequency on y, a
  45° "perfectly calibrated" diagonal, one point-and-line series per algorithm. The convention a
  statistician expects.
- **B — Deviation view.** Collapses the diagonal to a flat zero baseline and plots
  `observed − predicted` directly, so "how far off were we" is read as a bar height instead of a
  distance-from-diagonal judgment.
- **C — Plain language first.** Leads with a sentence per algorithm — *"When VPR put red's win
  chance at about 65%, red actually won 61% of the time — across 954 matches"* — with the chart
  demoted to a small supporting strip underneath.

No winner is declared here; each variant's caption states what it optimises for and what it
costs, and that trade is the user's call.

## The sparse-bin problem — the most interesting design problem here

`count` per bin varies by two orders of magnitude within the *same slice*. In the 2026
qualification view alone (pooled across all three algorithms), the extreme bins run **163 to
5,950** matches. In the 2025 elimination view it's worse: one bin holds a **single match**,
another holds **1,318**. Six bins across the whole dataset (all `epa` × `elimination`, always at
bin 0 or bin 9) have **zero** matches, where `meanPredicted`/`observedFrequency` are `null`.

A design that draws all ten bins with equal visual weight overstates the reliability of the
sparse ones — a single-match bin sitting at 0% or 100% "observed" looks exactly as confident as a
bin backed by a thousand matches. Each variant handles this differently, all three derived from
the *same* per-view `{min, median, max}` count computed once (`countStats()`), so the encoding
and its legend can never drift apart:

- **A** encodes count as point **area** (`sizeScale`, sqrt-scaled so *area*, not radius, tracks
  count — the perceptually correct mapping), with a size-key legend built from that view's actual
  min/median/max counts, and zero-count bins drawn as a small axis tick rather than a point.
- **B** encodes count as bar **opacity** (`opacityScale`, same sqrt curve), with the matching
  opacity-key legend, and zero-count bins as a tick on the zero line.
- **C** states it in **words**: any bin under 30 matches gets a `small sample` tag directly in
  its sentence, and zero-count bins read *"No matches landed in this confidence range"* rather
  than a fabricated percentage. This is the most direct handling of the three — nothing to
  *notice*, it's just said.

Every variant also carries a `.warn` callout stating the current view's real min/max bin count, so
the sparse-bin caveat is never buried in a caption the reader might skip.

## What the real data showed

The most striking finding wasn't a sparse-bin artifact at all — it showed up in a well-populated
bin. **2026 OPR, qualification view, bin 0.8–0.9**: predicted **85.3%**, observed **52.8%** — a
**32.5 percentage-point** overconfidence gap, backed by **395 matches**. The 0–0.1 bin is even
larger in absolute terms: predicted 0.8%, observed 21.7%, on **5,950 matches**. Across that same
slice, OPR's deviation swings from **+26pp** (bin 0.1–0.2) to **−32.5pp** (bin 0.8–0.9) — a real,
well-evidenced miscalibration, not noise.

VPR — SigmaScout's own algorithm — is dramatically better calibrated in the same slice: every bin
deviation stays within about **±7pp**, and it posts the best Brier score (0.149) and win accuracy
(79.0%) of the three algorithms in that same 2026 qualification slice. EPA sits in between, systematically
underconfident at low predicted probabilities and overconfident at high ones by a smaller, steadier
margin (roughly −9 to +9pp).

This is exactly the case a calibration curve exists to surface and a bare accuracy number would
hide: OPR's winner accuracy (74.8% in 2026 qualification) looks respectable in isolation, but the
calibration view shows its *confidence numbers* cannot be trusted at face value — a 90% OPR
prediction has not behaved like a 90% probability in this dataset. The sketch defaults to this
exact year/view (`2026` / `qualification`) so the finding is visible on first load.

## Series colour — orange / violet / teal

Three algorithms share one chart, so they need three CVD-safe, mutually distinguishable series
colours that do not collide with domain meaning:

| Algorithm | Colour | Hex |
|---|---|---|
| OPR | orange | `#EA580C` |
| EPA | violet | `#7C3AED` |
| VPR | teal | `#0D9488` |

**Reasoning:**

- **Alliance red/blue is off the table.** `#DC2626` / `#2563EB` mean "red alliance" / "blue
  alliance" everywhere else on this site (chart-craft.md is explicit on this). Reusing them for
  algorithm identity would make every calibration point look like it was claiming a side.
- **Win/loss green/rose is also off the table.** The shipped theme reserves emerald `#059669` for
  "win" and rose `#E11D48` for "loss" (`--win` / `--loss` in `themes/default.css`). A calibration
  chart is not a win/loss chart, and reusing those hues would silently imply one.
- **Validated with the dataviz skill's `validate_palette.js`**, `--pairs all` (all 3 pairs, not
  just adjacent — appropriate for a scatter/point chart like variant A), light mode, surface
  `#FFFFFF`: worst-pair CVD ΔE **13.8 protan / 13.6 tritan** (target ≥8), worst-pair
  normal-vision ΔE **28.8** (hard floor is 15). Comfortably clear on every check, including the
  lightness band and chroma floor.
- **Two rejected candidates, for the record:** orange/violet/fuchsia (`#EA580C` / `#7C3AED` /
  `#C026D3`) failed outright — violet↔fuchsia measured protan ΔE 4.1 and normal-vision ΔE 14.0,
  both below floor. Orange/teal/magenta (`#EA580C` / `#0D9488` / `#DB2777`) also failed — teal↔
  magenta measured deutan ΔE 3.8. Both are consistent with the palette skill's general finding
  that purple/magenta family hues sit close together under CVD simulation; the passing set
  deliberately spaces one warm hue (orange) against two cool-but-separated hues (violet, teal)
  instead.
- **Teal happens to coincide with `--tier-1`/`--certain`** (`#0D9488`, "elite tier" / "tight
  spread" elsewhere in the shipped palette). This sketch lives on a different page (Compare, not
  a Teams metric table) and encodes a different thing (algorithm identity, not a percentile tier
  or a confidence width), so the risk of a reader conflating the two is low — flagged here rather
  than silently accepted, in case a future page puts both encodings in view at once.

Per binding rule #2, colour never carries a number: every `.dot`/swatch uses a `SERIES` colour,
but every adjacent value — algorithm name, predicted %, observed %, Brier score, match count —
renders in a text token (`var(--color-text)` / `var(--color-text-muted)`), never the series hex.

## Binding-rule compliance, for auditability

- **One axis, always.** Each chart has exactly one x-scale and one y-scale; count is encoded via
  mark *size* or *opacity*, never a second plotted scale.
- **Coupled geometry from one source, twice over.** (1) `sizeScale`/`opacityScale` back both the
  actual marks *and* their legend swatches, called with the same `maxCount` — they cannot drift
  apart the way sketch 003's hand-tuned band/dot pair did. (2) Variant B's main chart and variant
  C's three per-algorithm mini-charts share one `D` (max absolute deviation, `niceCeil`-padded)
  computed once per view — a bar's height means the same thing in the big chart and the small one.
- **Tabular numerals everywhere.** `font-variant-numeric: tabular-nums` is set on `body` and on
  SVG `text` globally, not per-element.
- **Text-halo fix, found by rendering and looking.** The first render put "perfectly calibrated"
  right where well-calibrated algorithms' points *cluster* (near the diagonal's top-right end in
  A, near the zero line in B) — a near-guaranteed collision, the same failure shape chart-craft.md
  documents for sketch 003's label placement. Fixed with an SVG text halo
  (`paint-order="stroke"` + a `--color-surface` stroke) rather than hunting for empty space that
  won't stay empty across every year/view combination.

## Required UI

- Year switcher (2022–2026) and match-type switcher (combined / qualification / elimination) —
  both drive a single `STATE` object and a full re-render; every variant reflects the same
  slice at all times.
- House variant-nav tab bar, structurally copied from sketch 004.
- Sketch toolbar, fixed bottom-right, independent of the theme (`rgba(15,23,42,.92)`,
  opacity 0.4 → 1 on hover), with 390 / 768 / 1280 / Full viewport presets that resize a `#stage`
  wrapper around the content — the fixed nav bars stay full-width.
- Header note naming the data source (`/v1/compare/{year}.json`, fetched 2026-08-30 from
  data.sigmascout.org) sits in the variant-nav bar on every variant.

## Verification

Rendered with Playwright (`apps/web`'s installed `@playwright/test`) across multiple year/view
combinations, including the sparsest real view (2025 elimination, pooled counts 1–1,318 — the 1
from EPA's bin 0, the 1,318 from OPR's bin 9) and the zero-count slices (2022–2024 EPA
elimination, bins 0 and 9). No console or page errors on load or on any control interaction. The
label-collision fix above was found this way, not by inspection.

## Files

- `index.html` — three variants, full year/match-type control, real data throughout
- `data.js` — real published `/v1/compare/{year}.json` artifacts, 2022–2026 (pre-existing, not
  regenerated for this sketch)
- Theme: `../themes/default.css`
