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

---

# Sketch Wrap-Up Summary — session 2

**Date:** 2026-08-30
**Sketches processed:** 3 (all included)
**Design area added:** Simulation & Compare
**Skill output:** `./.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md`

## Included Sketches

| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 005 | rank-distribution | **B** — shared 1..N axis, interpolated band edges | Simulation & Compare |
| 006 | calibration-curve | **C** — plain-language first | Simulation & Compare |
| 007 | compare-table | **A** — season rows, algorithm columns | Simulation & Compare |

## Why this session mattered

Every sketch ran against **real published data** — 1000-draw Monte Carlo output over live
`pRedWin`/`redRpPmf` artifacts, and the live `v1/compare/{year}.json` files. That is what produced
the findings below; none would have surfaced from a synthetic sample.

**1. A proposed variant was mathematically impossible.** Sketch 005's variant B was originally
"clip the shared rank axis to the union of occupied ranks." Every draw assigns each of N ranks to
exactly one team, so every rank column sums to the draw count and every rank is always occupied. The
clip reclaims exactly zero pixels on any full field — proved computationally, then independently
confirmed when the user reported seeing no difference between the two variants. B was repurposed.

**2. A stated design premise was wrong, and measuring corrected it.** The sketch was commissioned on
the belief that rank spreads are near-universally 1 rank wide, making the UI-SPEC's 470px shared axis
98% whitespace. That came from sampling the top 12 rows. Measured over every team, spreads run 0–12
ranks (median 7) at `2023nhgrs`. The real constraint is harder: a 0-width band and a 12-wide band must
read correctly on adjacent rows.

**3. The user found a defect the build missed.** Integer-snapped band edges meant a locked team's band
had width zero and vanished — 2 of 39 rows at `2023nhgrs`, 3 of 42 at `2025flta` — and two teams with
genuinely different distributions both rendered as `2–3`. His proposal (non-integer band edges) fixed
all three defects. Implemented as a piecewise-linear CDF quantile, bounded to `[0.5, N+0.5]`.

**4. A publishable algorithm is confidently wrong in a way accuracy hides.** 2026 qualification, OPR:
predicted 85.3%, observed 52.8%, across 395 matches — a 32.5pp overconfidence gap — while its headline
accuracy (74.8%) sits four points behind VPR's. This is the concrete argument for putting calibration
on the Compare page.

**5. Three published comparisons are too close to call.** VPR loses elimination *accuracy* to OPR in
2022, 2024 and 2025, every gap inside a naive one-standard-error bound, one of them 0.6 matches out of
2,867. A fourth case (2022 elimination Brier) differs by `0.00004` and renders as two identical
numbers, one bold and one grey. Recorded as **D-11** in `08-CONTEXT.md`: near-ties render as ties.

## Documentation drift corrected during this session

- `MANIFEST.md` still told every future sketch that the team-page `±` and the match-prediction `±`
  are deliberately different quantities. Phase 7 D-01 superseded that; struck and recorded.
- `SKILL.md`'s "Blocked on data" section listed two blockers, both since resolved. Rewritten with the
  one item that is genuinely still open.
- `.claude/CLAUDE.md`'s skill blurb repeated the same two stale gaps. Updated.
