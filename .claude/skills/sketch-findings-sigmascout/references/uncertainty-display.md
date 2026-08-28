# Uncertainty Display

SigmaScout's stated differentiator is *honest uncertainty*. These decisions are about making the ±
visible rather than decorative.

## One quantity, everywhere — never a partial one

This is the single most important thing in this file.

**Supersedes prior guidance (Phase 7 plan 07-06, D-01/D-02/D-03):** this file used to say the
team-page ± and the match-prediction ± were two different quantities that must never be conflated —
D-09's match-to-match consistency alone on the team page, D-10's full predictive variance on a match
prediction. That two-quantity design is REJECTED outright, not merely corrected. A user must never
see a bare D-09 consistency value: every `±` this site prints, and every band, interval, or plot it
draws, at every aggregation level — one team's metric, an alliance's combined total, a match row's
band — is the same quantity: **one standard deviation of the full predictive variance**
(`√(P + R)`, D-01's `P + R` for one team; `√(P + Q + R)` once process noise is folded in, per team or
per alliance as the surface aggregates). A team's `spread`, an alliance's combined ±, and a match
row's band reconcile by summing SQUARES and taking the root — three robots at ±10 combine to ±17.3,
never ±30. D-09's consistency term (R) is still computed and still feeds the Kalman update
internally, but it is never displayed or published on its own under any name (D-03).

**Why this is coherent rather than a compromise:** an alliance's combined `±` is exactly
`√(Σ teams' own P + R)`, which is the SAME quantity `redScoreVarianceOwn` already is — so the site
becomes internally consistent by construction, not by discipline. Accepted consequence: a team we
have seen only a few matches of now shows a WIDE ± because we are genuinely unsure, not because it is
streaky — the honest answer, not a flattering one.

**The band-from-a-partial-variance failure is still exactly why this file exists** — it just no
longer has two names. Sketch 003's first draft drew match bands from `sqrt(sum of component
variances)`, which omitted the posterior term, and the actual results landed **7σ and ~10σ outside**
the drawn bands. The model was fine; the quantity was wrong. That lesson generalizes past the old
two-quantity framing: a band drawn from only PART of the predictive variance — the consistency term
alone (the original sketch-003 error) or the posterior term alone (an equal and opposite one) — is
wrong by multiple sigma either way. Draw the whole thing, always.

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
- **Drawing a band from only PART of the predictive variance** — the consistency term (R) alone, or
  the posterior term (P) alone. Wrong by multiple sigma either way — see the top of this file.

## Data dependency (not yet satisfied)

**Match-level predictive variance is published on the team artifact, not yet on the event artifact.**
The harness uses D-10's `P + Q + R` in `packages/core/algorithms/sigma1/linkFunctions.ts` to produce
`pRedWin`; the per-match `redScoreVarianceOwn`/`blueScoreVarianceOwn` values it also computes have
carried through to `TeamSeasonMatchSchema` since Phase 6 D-01, so a team page's own match table can
already draw a real band. `EventMatchSchema` in `packages/harness/pageArtifacts.ts` does not yet
carry those fields — Phase 7 plan 07-07 adds them to the schema and 07-08 populates them. **Any event
page's match-interval display is wrong until that lands.** See
`.planning/todos/pending/publish-match-predictive-variance.md`, folded into Phase 7 as D-18 item 3.

This blocked **TEAM-05** (Phase 6: "predicted RP ± variance" per match, now satisfied) and blocks any
Phase 7 event-page display that shows match-level uncertainty until 07-07/07-08 land.

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
