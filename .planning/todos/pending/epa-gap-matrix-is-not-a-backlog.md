---
id: epa-gap-matrix-is-not-a-backlog
created: 2026-09-11
source: quick task 260911-r7e — the measured standing contradicts how the gap document frames its own remaining work
resolves_phase:
priority: medium
---

# `epa-statbotics-gap.md` still reads as a 35-item backlog, and a later agent will resume it

`docs/models/epa-statbotics-gap.md` is structured as an 11-mechanism × 9-season verdict matrix with
**35 `GAP` cells**, plus staged per-season plans (stages 5, 6, 7) that name one quick task per
remaining season. Read on its own, it is an instruction to burn those cells down. That is exactly
what happened across quick tasks `260911-i9f`, `-gfe`, `-l2k`, `-3kc` and `-pon`, at very large
token cost and with no measured accuracy gain.

**The measurement says the backlog is not worth running.** Quick task 260911-r7e measured the whole
accuracy deficit at **−0.11 to −0.49 pp, mean −0.26 pp** across 2022-2026 under
`epa@10.0.0+baseline`. The one mechanism-1 cell that was actually closed and measured (2024, task
260911-pon) came in at **−0.036 accuracy points — a loss.** Eight more seasons of the same shape
were queued behind it.

## Why this is a real risk and not just untidy docs

The gap document is written, in its own words, "for the agent executing the next stage... without
re-deriving anything." It is deliberately self-sufficient and persuasive. Nothing in it currently
tells that agent the total prize is a quarter of a point, or that the first closed cell lost. A
fresh session that opens it will resume stage 5.

## The fix

Add a standing-result block at the TOP of `epa-statbotics-gap.md` (beside the existing
`CORRECTION 2026-09-11` block) carrying:

- the measured per-season deficit table and the −0.26 pp mean, with its date and `epa` version
- mechanism 1's measured 2024 result (−0.036 pp, a loss) as the reason the per-season map work is
  **not** being continued
- that mechanism 8 cannot move winner accuracy at all, since accuracy is `sign(margin)` only
- that both cheap comparability hypotheses (offseason population, surrogate population) are
  measured and refuted, so the residual has no known cheap cause
- a pointer to `docs/models/epa-vs-statbotics.md`'s `epa@10.0.0+baseline` section

**Do not renumber, delete, or re-verdict anything.** The matrix is a good reference for *what*
differs; the only defect is that it does not say what closing a cell is worth. Keep all 35 `GAP`
cells as they are.

## Related pre-existing defect, still open

`docs/models/statbotics-breakdown-reference.md` has **two sections numbered 20** (line 2307
"Residual gaps" and line 2334 `avg.py`). Flagged by 260911-pon and deliberately not fixed there,
because the gap document and `scripts/measureEpaDeviations.ts` both cite section numbers by hand and
renumbering would silently break those citations. Needs its own task that updates every citation in
the same change.
