---
sketch: 012
name: predicted-bonus-dots
question: "Once the F4 fix makes bonus odds honest, how should a predicted bonus dot render, given that a large share of alliances are genuine toss-ups?"
winner: "B"
tags: [match-table, bonus-rp, uncertainty, prediction, event-page, team-page]
---

# Sketch 012: Predicted bonus dots

## Design Question

Audit finding F10 (`.planning/todos/pending/ranking-points-audit.md`). A predicted bonus dot today is
solid at 50% odds or more (`PREDICTED_BONUS_THRESHOLD`, `apps/web/src/lib/bonusRp.ts`) and hollow
otherwise. Under the odds published today that dot is often plainly wrong. 2016 Breach was earned 70%
of the time, yet its odds sit under 5% for nearly every alliance, so every Breach dot is hollow.

F4 (quick task 260913-tw1, `docs/models/rp-bonus-gap-attribution.md`) found the cause, and Jacob
chose the fix: lattice marginals plus a walk-forward mean shift. This sketch asks how the dot should
render **once the fix lands**, using the odds the probe expects it to publish.

## How to View

open .planning/sketches/012-predicted-bonus-dots/index.html

- **Design** switches between A–D, and "All four" puts them side by side on the same alliances, next to the real outcome.
- **Odds** switches between the expected post-fix odds and today's published odds.
- **Phone 390** checks narrow width.

`preview-board-2022.png` and `preview-board-2016.png` are zoomed crops of "All four" with post-fix odds.

## Variants

- **A: Solid at 50% (today).** Two states. The exact odds are only in the tooltip.
- **B: Three states. ★ Selected (Jacob, 2026-09-14).** Full alliance colour when likely (⅔ or more), a light tint for a toss-up (⅓ to ⅔), hollow when unlikely (under ⅓).
- **C: Fill to the odds.** The dot fills from the bottom to the probability. Continuous.
- **D: Numbers.** A small percentage chip: tinted from ⅔, outlined from ⅓, muted below.

## What the data says

Whole-season walk-forward figures, from the table under each event:

| Bonus | Earned | A's dot wrong, today | A's dot wrong, post-fix | Post-fix toss-up share (earned) |
|---|---|---|---|---|
| 2016 Breach | 70% | 70% | 26% | 27% (59%) |
| 2016 Capture | 13% | 13% | 13% | 7% (57%) |
| 2022 Cargo | 34% | 24% | 21% | 25% (57%) |
| 2022 Hangar | 44% | 30% | 28% | 45% (52%) |

Post-fix, the three bands are ordered and roughly calibrated. Across these bonuses, "unlikely" is
earned 10–39% of the time, "toss-up" 52–59% and "likely" 81–89%. Up to 45% of alliances land in the
middle band, which is a coin flip. A two-state dot can only call those one way or the other.

## Craft findings from building it

- **The shipped 30% tint is too faint to carry three states at 14px.** The first B drew a half-filled
  toss-up. Even at 2x it was indistinguishable from solid and hollow. B now gives "likely" full ink.
- **The same faintness affects today's actual dots**: earned versus not earned is a 30% tint against
  none. That was visible on the board, but it is outside this sketch's question.
- **C is unreadable at dot size.** 40% and 60% look the same.

## Decision

**B, three states.** Jacob chose it over D (numbers), A (keep the 50% rule) and C (fill). Before
building it, note:

- The cut-offs are ⅓ and ⅔. `PREDICTED_BONUS_THRESHOLD` becomes two thresholds, and the pinned tests
  in `bonusRp.test.ts` (including the attribution record's `dotThreshold`) move with it.
- "Likely" uses full alliance ink with a white letter. The toss-up tint is today's
  `--alliance-*-soft`. The white letter on `#DC2626`/`#2563EB` at 8px needs a contrast check.
- The actual dots keep their two states. Their faint earned tint is a separate question.
- Ship it with or after the F4 fix. On today's odds almost every dot would render hollow, so the new
  states would have nothing to show.

## Data

`data.js` holds real walk-forward SPR bonus odds for twelve qualification matches each from `2016necmp`
and `2022chcmp`, from the F4 probe's dump mode (`TW1_DUMP=1`, gitignored `experiments/260913-tw1/`),
generated 2026-09-14. "Post-fix" means the probe's lattice-plus-mean-shift odds. **Those odds are not
published and not promoted.** The fix still has to earn promotion on 2016–2022.
