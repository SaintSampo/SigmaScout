# Sketch Wrap-Up Summary

**Date:** 2026-08-25
**Sketches processed:** 4 (3 included, 1 excluded)
**Design areas:** Colour & rarity tiers · Uncertainty display · Chart craft
**Skill output:** `./.claude/skills/sketch-findings-sigmascout/`

## Included Sketches

| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 001 | teams-table-polish | *(partial — findings only)* | Uncertainty display, Chart craft |
| 003 | alliance-axes | C — event table, one shared scale | Uncertainty display, Chart craft |
| 004 | rarity-tiers | B — tinted boxes, Common unboxed | Colour & rarity tiers, Chart craft |

## Excluded Sketches

| # | Name | Reason |
|---|------|--------|
| 002 | palette-options | All four continuous ramps (indigo/teal/amber/slate) rejected by the user; superseded by 004's discrete tiers. Recorded as an anti-pattern in `colour-and-tiers.md` so the directions are not re-proposed. |

## Why these sketches existed

Phase 5 closed with a real-device sign-off in which the user found the shipped UI "too minimal and
rough around the edges… there should be a little bit of color." The rough edges were genuine layout
defects and were fixed in plan 05-08. **"Too minimal" was not a defect** — it was `05-UI-SPEC.md`'s
60/30/10 palette working as specified. Rather than improvise a palette change at a closing gate, the
phase closed and these sketches were opened so there was something concrete to react to.

## Design Direction

"Serious tool, more alive." Colour carries meaning — tier, confidence, win/loss, alliance — never
decoration. Dense and fast, but not austere. Statbotics and TBA are the reference points, since they
are the tools this audience already knows.

## Key Decisions

**Palette — percentile rarity tiers (004-B).** Metric values get a tinted box by percentile: Common
0–50 plain, Rare 50–75 `#E0F2FE`/`#0369A1`, Epic 75–95 `#F3E8FF`/`#7E22CE`, Legendary 95–100
`#FEF3C7`/`#B45309`. Discrete beats continuous because a tier gives the reader a nameable answer.

**The tier blue must stay sky `#0EA5E9`, never true blue `#3B82F6`** — the classic rarity pair
measures ΔE 1.3 under deuteranopia, making Rare and Epic (45% of all teams) indistinguishable to ~6%
of males. The shipped set measures ΔE 14.1.

**Tiers earn their place on component columns, not the sorted one.** Adjacent rows in a sorted table
share a tier by construction. But "Rare overall, Epic in Hub Auto" is real scouting signal.

**Match predictions — event table on one shared scale (003-C).** Both alliances as ±1σ bands on a
single axis drawn once in the header; the overlap *is* the win probability; the actual result sits on
the same axis as a ringed dot in alliance colour; the loser's *number* greys but never its mark.

**Interval axes zoom to the data, never to zero — and per view, never per row.** Per-row domains
destroy cross-row comparison, which is usually the point.

**The two ± are different quantities.** Team-page ± is consistency (D-09); match-prediction ± is full
predictive variance (D-10). Conflating them produced bands wrong by 7–10σ.

## Implications for locked Phase 5 decisions

- **D-05** ("not TBA/Statbotics blue") is effectively superseded. The winning palette is neither
  Statbotics blue nor the shipped indigo — it arrived from a card-game reference rather than by
  avoiding the competition. Worth amending D-05 when this is implemented rather than leaving the
  context describing a decision that no longer holds.
- **D-06's token discipline is what makes this cheap.** Verified zero hex literals in component code
  outside shadcn's generated files, so the palette change is a token swap, not a component sweep.
- **D-07** (`X ± Y` display) survives intact and is reinforced — the sketches push the ± further into
  the visual language rather than away from it.

## Pipeline gaps uncovered by sketching

Both are cheap now and expensive after pages are built on them.

1. **Match-level predictive variance is computed but never published.** The harness uses D-10's
   `P + Q + R` to produce `pRedWin`; `EventMatchSchema` carries only scores, `pRedWin`, and
   per-component mean/variance. Blocks **TEAM-05**. Filed at
   `.planning/todos/pending/publish-match-predictive-variance.md`.
2. **Per-metric percentiles are not published.** Required by the tier system. Either pipeline-added
   or client-derived from the teams artifact already downloaded — undecided.

## Still open

- Where the shared match-axis domain comes from (currently min/max of visible matches, which would
  shift mid-event; probably wants fixing per season).
- What an upcoming match with no actual result looks like.
- Mobile. Everything sketched is desktop-width, and the user's original complaint was on a phone.
