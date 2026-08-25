# Chart Craft

Transferable mechanics, each one learned by getting it wrong first in a sketch. These are not
SigmaScout-specific — they apply to any chart or dense table in this codebase.

## Derive coupled geometry; never hand-tune both ends

Any two marks that must line up should share **one computed source**. Two independent magic numbers
that are supposed to agree will drift.

Sketch 003 positioned each alliance's band and its actual dot with separate hand-tuned `top` values.
They drifted: the red dot sat **4.5px above** its band's centre, the blue **1.5px below**. Nobody
noticed until it was looked at directly.

```js
// WRONG — two numbers that must agree, maintained separately
alliance(mean, sd, actual, color, soft, /* yBand */ 9, /* yDot */ 2);

// RIGHT — one source, everything derived
var centre  = yBand + BAND_H / 2;
var dotTop  = centre - DOT_H / 2;
var tickTop = centre - TICK_H / 2;
```

Fixing the numbers only resets the clock on the same bug. Fix the *coupling*.

## Grouping is proximity, not labelling

Two marks belonging to the same row must be **markedly closer to each other than to the neighbouring
row**, or the reader pairs them wrongly — especially when partners are far apart on the other axis.

Sketch 003 had the two alliance dots 12px apart in a 44px row, against a similar between-match gap.
A dot landing far from its partner horizontally read as belonging to whichever row it was nearest.
It needed roughly **4×** before the pairing read correctly:

| | |
|---|---|
| Within a match | 12px between dot centres |
| Between matches | 47.3px |
| Ratio | **3.94×** |

A zebra tint on alternate rows reinforces the block. Labels do not fix this; only proximity does.

## Render it and look at it — the validator checks colour, not layout

Sketch 003's first draft placed value labels at each alliance's mean, with tick labels between the
two bands. It collided in **all three** real matches. The labels only separate when the two alliances
differ substantially — which is precisely the case the chart exists to show, so the collision was
guaranteed in exactly the situation that mattered.

Screenshot the output and inspect it. Better, assert it — collisions are computable:

```js
const boxes = Array.from(el.querySelectorAll('.lab, .ticklab')).map(e => e.getBoundingClientRect());
// any pair overlapping on both axes is a collision
```

## Grey the loser's number, never its mark

On a predicted-vs-actual view, greying the losing score in the results column lets the reader answer
"who won" from the numbers alone.

Do **not** extend it to the plotted marks. There, colour carries *identity* (which alliance), and
greying half the marks breaks that encoding in order to restate something another column already
says. Same visual device, different jobs — apply it where it matches the job.

## Mock against the real distribution, not the visible rows

Sketch 004 computed percentiles across its 14-row sample and looked excellent. Against the true
3,709-team field, the top of the sorted table is uniformly one tier and the design conveys nothing
there.

A mockup built on a convenient sample will validate a conclusion that production disproves. Pull the
real distribution, even for a throwaway.

## Colour is computable — compute it

Never eyeball whether a palette is colourblind-safe. The dataviz skill ships
`scripts/validate_palette.js`; run it.

Two results from this project worth keeping:

- **FRC alliance red/blue passes.** `#DC2626` vs `#2563EB` → ΔE 29.9 protan. The domain convention is
  safe as-is; no need to hedge it.
- **Classic card-game rarity blue/purple fails badly.** `#3B82F6` vs `#9333EA` → ΔE 1.3 deutan. Would
  have shipped two indistinguishable tiers to ~6% of male users.

For a **sequential** ramp the check is different — lightness monotonicity in OKLab, not pairwise ΔE.

## Encoding rules that held up

- **Sequential = one hue, light→dark.** Never a rainbow.
- **Discrete tiers beat gradients when the reader needs a name**, not a comparison.
- **One axis.** Two scales in one chart make equal-looking marks mean different things.
- **Text wears text tokens, never the series colour.** A coloured mark beside a value carries
  identity; the value itself stays in normal ink.
- **Domain vocabulary wins over palette preference.** Red and blue mean alliances in FRC and cannot be
  reused. Chrome hues should avoid both so they never compete with alliance colour.

## Origin

Learned across sketches 001, 003, and 004. Source files in `sources/`.
