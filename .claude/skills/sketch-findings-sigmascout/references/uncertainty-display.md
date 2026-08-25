# Uncertainty Display

SigmaScout's stated differentiator is *honest uncertainty*. These decisions are about making the ±
visible rather than decorative.

## The two ± are different quantities — never conflate them

This is the single most important thing in this file.

- **D-09 — team-page ±:** the team's **match-to-match performance spread** (consistency). A streaky
  team keeps a wide ±; a metronomic one narrows.
- **D-10 — match-prediction ±:** the **full predictive variance** — estimate uncertainty *plus*
  performance spread (`P + Q + R`).

They answer different questions and must be labelled accordingly. Conflating them is not theoretical:
sketch 003's first draft drew match bands from `sqrt(sum of component variances)`, which omits the
performance-spread term, and the actual results landed **7σ and ~10σ outside** the drawn bands. The
model was fine; the quantity was wrong.

## Design Decisions

**Totals render as intervals, not points, wherever there is room.** A point estimate cannot express a
coin flip. Ranks 6–14 of the 2026 field have almost entirely overlapping ±1σ intervals — they are
statistically indistinguishable — yet a plain sorted table presents them as a confident ordered list.

**Interval axes are zoomed to the data, never anchored at zero.** Totals span 274–418 while spreads
are 5–11; on a 0-max axis every interval collapses to an identical invisible tick. Trade: bar
*length* then stops encoding magnitude, only position does, **so the axis must be labelled.**

**Zoom per view, never per row.** Sketch 003's first two drafts gave every match its own domain. Each
row was readable alone and incomparable to its neighbours — two matches ~150 points apart rendered at
similar positions. **One shared scale per event**, axis drawn once in a table header. A miss then
reads as distance on a scale you can trust across rows.

**Match predictions are a table, not a stack of cards.** Denser, and consistent with the rest of the
app.

## The match table (sketch 003, variant C — selected)

```
| Match | Alliances | ────────── shared axis, drawn once ────────── | Actual | Call |
```

| Element | Encodes |
|---|---|
| Soft bar | predicted ±1σ for that alliance |
| Solid tick | predicted score |
| Ringed dot | actual score, **always in alliance colour** |
| Actual column | the same numbers as text; **loser greyed** |
| Call column | ✓ / ✗ — did the predicted winner match |

The overlap between the two bands *is* the win probability, drawn rather than asserted. Heavy overlap
means a coin flip; separation means a lock.

**Grey the loser's NUMBER, never its mark.** On the plot a dot carries alliance *identity*, so
greying half the dots breaks the encoding to restate what the Call column already says. In the Actual
column the numbers are the *outcome*, so greying the loser there is doing real work — the column
alone then answers "who won". Same device, different jobs. (This was corrected during review after
being over-applied to both.)

## CSS Patterns

```css
/* Alliance colours — FRC domain vocabulary, validated for CVD (ΔE 29.9 protan). Safe as-is. */
--alliance-red:  #DC2626;   --alliance-red-soft:  rgba(220, 38, 38, .30);
--alliance-blue: #2563EB;   --alliance-blue-soft: rgba(37, 99, 235, .30);
--loser-ink:     #94A3B8;

/* Plot cell: a positioned box the marks are absolutely placed inside. */
.plot { position: relative; padding: 0; }
.gridline { position: absolute; top: 0; bottom: 0; width: 1px;
            background: var(--color-border); opacity: .55; }
```

## HTML / JS Structures

Geometry constants live together and **every y derives from them** — see `chart-craft.md` for why
this is not optional:

```js
var BAND_H = 8;
var DOT_H  = 12;   // 12 apart means the two dots touch edge-to-edge, never overlap
var TICK_H = 14;
var Y_RED = 12, Y_BLUE = 24;   // 12px apart within a match
var PLOT_H = 44;

function x(v) { return ((v - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * PLOT_W; }

function alliance(mean, sd, actual, color, soft, yBand) {
  var centre  = yBand + BAND_H / 2;
  var dotTop  = centre - DOT_H / 2;    // derived, never hand-tuned
  var tickTop = centre - TICK_H / 2;
  // band (soft, rounded) → tick (solid, at the mean) → dot (donut, at the actual)
}
```

The actual dot is a **donut** (white fill, 3px coloured ring) rather than a solid disc, so it stays
visible when it lands on top of the band it belongs to.

## What to Avoid

- **Per-row zoomed domains.** Destroys cross-row comparison, which is usually the point.
- **Two independent scales in one chart.** That is a dual-axis chart: equal-looking bands would mean
  different things. The most common charting mistake, and explicitly disallowed.
- **Zero-anchored interval axes** where spread is small relative to magnitude.
- **Greying a plotted mark to indicate outcome.** Breaks identity encoding.
- **Drawing a match interval from component variances.** Wrong quantity — see the top of this file.

## Data dependency (not yet satisfied)

**Match-level predictive variance is computed but never published.** The harness uses D-10's
`P + Q + R` in `packages/core/algorithms/sigma1/linkFunctions.ts` to produce `pRedWin`, but
`EventMatchSchema` in `packages/harness/pageArtifacts.ts` carries only scores, `pRedWin`, and
per-component mean/variance. **Any interval display of a match prediction is wrong until this
ships.** Cheap to add — the value exists at compute time. See
`.planning/todos/pending/publish-match-predictive-variance.md`.

This blocks **TEAM-05** (Phase 6: "predicted RP ± variance" per match) and any Phase 7 alliance
display that shows uncertainty.

## Open questions

- **Where does the shared domain come from?** Currently min/max of the visible matches, which would
  shift during a live event as matches complete. Probably wants fixing per season so the scale stays
  stable while a user is watching.
- **What does an upcoming match look like** (no actual yet)? The axis still works; the row needs a
  deliberate empty treatment rather than a gap.
- **Mobile.** 470px of plot does not fit a 390px screen. Likely needs a compact two-row form.

## Origin

Synthesized from sketches: 001 (findings only — its visual direction was superseded), 003 (winner:
variant C).
Source files: `sources/003-alliance-axes/`
