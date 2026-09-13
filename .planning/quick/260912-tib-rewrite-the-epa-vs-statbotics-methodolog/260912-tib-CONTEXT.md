# Quick Task 260912-tib: Rewrite the EPA vs Statbotics methodology page from scratch - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Task Boundary

Delete the current `/methodology/epa-vs-statbotics` page body and its content module, and replace
them with a new page written from scratch. The new page explains how SigmaScout's EPA (live
`epa@10.0.0+baseline`, confirmed in the live `v1/manifest/algorithms.json` on 2026-09-12) differs
from Statbotics' EPA.

Why now: the old page's copy is stale and partly false. Its `win-probability-scale` entry says
Statbotics' spread number is "calculated only once the season is over". Statbotics actually
computes it from week 1 (`docs/models/epa-divergences.md` section 4). The old page also leaves out
most of the differences that actually exist.

Out of scope: the publish pipeline, `packages/harness/pageArtifacts.ts`'s artifact schema,
`scripts/publishEpaComparison.ts`, and every `docs/models/*.md` file. The published
`v1/methodology/epa-vs-statbotics.json` keeps its `agreement` array. The page just stops rendering it.

</domain>

<decisions>
## Implementation Decisions (locked by Jacob, 2026-09-12)

### URL and hub card
- Keep the route at `/methodology/epa-vs-statbotics` and keep the hub card in the same position, so
  no links break. The card's title and blurb may be reworded to fit the new page. The blurb currently
  says "and by how much", which still fits if the head-to-head table stays.

### Data tables: HEAD-TO-HEAD ONLY
- Keep the head-to-head table (winner accuracy and Brier, SigmaScout EPA against Statbotics EPA, per
  season), plus its data-derived summary sentence and the provenance line.
- REMOVE the per-season agreement table (OLS slope, Pearson, mean absolute difference) and its intro.
  Do not quote any agreement figure anywhere in the page's copy either.
- Every number on the page still comes from the artifact. No accuracy or Brier literal goes in copy.
  The one exception is the already-published 2024 score-piece figures (73.5 / 75.2 / 74.0), which the
  old page also quoted.

### Layout: COMPARISON CARDS
- The page has three parts:
  1. A short "Same on both sites" list.
  2. A "Where they differ" section. It has one compact card per difference, each with a title, a
     Statbotics line, a SigmaScout line, and a one-line "why" (or "what it changes").
  3. A "How much it matters" section with the head-to-head table.
- The cards must stack cleanly at 390px. Load `Skill("sketch-findings-sigmascout")` before building
  and follow its palette and tokens. Reuse the existing methodology page chrome and table markup
  instead of inventing new treatments.

### Go live
- After the change is verified locally, it will be pushed to main so Cloudflare Pages deploys it.
  The ORCHESTRATOR does the push and the live check, not the executor. Executor subagents' sandbox
  blocks network access.

### Claude's Discretion
- Exact wording, card order, and component/file structure, within the voice rules below.
- Whether "fouls" becomes its own card or folds into the week-1 card. The facts below favor folding
  it in: predictions now handle fouls the same way on both sites, and the only remaining difference
  is the week-1 rate.

</decisions>

<specifics>
## Verified fact sheet (the page's copy must stay within these facts)

Sources: `docs/models/epa-statbotics-gap.md` (verdict matrix and mechanisms 1-11),
`docs/models/epa-divergences.md` (sections 2-8), and `packages/core/algorithms/{epa,carryover,epaCarryScale}.ts`.
The constants below were spot-checked in code on 2026-09-12.

### Same on both sites
- **Rating update:** after every match, each team's rating moves toward what the match showed, with
  the same two-stage moving-average formula. The learning rate starts high and settles as a team
  plays more matches.
- **Elimination matches:** they count one third as much (`EPA_ELIM_WEIGHT = 1/3`) and do not advance
  a team's match count.
- **Win-probability curve:** the same logistic curve, applied to the predicted score gap without
  fouls.
- **Fouls in predictions:** since `epa@10.0.0` both sites work out the win probability from no-foul
  scores, then multiply BOTH predicted scores by one shared `(1 + foul rate)`. Fouls can never change
  who is favored on either site.
- **New-season carryover formula:** the same constants on both sites. 70% last season plus 30% the
  season before, then pulled 40% back toward a starting value slightly below average (1500 − 0.2 × 250 = 1450).
- **No ±:** neither site's EPA shows an uncertainty range. It is a single number on both.

### Where they differ
1. **Season numbers taken from week 1** (the score spread behind win probability, and the foul rate).
   - Statbotics works these out from all of week 1 after the fact and uses them for every match,
     week 1 included.
   - SigmaScout uses the same week-1 numbers from week 2 on. During week 1 it uses a running estimate
     from matches already played.
   - Why: a week-1 prediction cannot use week-1 matches that have not happened yet.
   - What it changes: only how confident predictions are during week 1. Dividing the score gap by a
     different positive number never flips which alliance is favored, so winner picks are unaffected.
2. **Ranking points.**
   - Statbotics' EPA also predicts ranking points, and in 2016 and 2017 elimination matches it mixes
     ranking-point predictions into the predicted score.
   - SigmaScout's EPA predicts scores and winners only. It never predicts ranking points.
   - This is a deliberate choice by the developer.
3. **How a score is split into pieces.**
   - Statbotics rates a list of about 18 numbers per team. The list overlaps itself: a total sits
     next to the pieces it is made of. In most seasons its predicted score reads only one entry, the
     no-foul total. In 2018 and 2023 it reads seven pieces through caps and curves, and 2018 also
     reads three of the other alliance's pieces.
   - SigmaScout rates pieces that do not overlap and adds all of them up.
   - Why: measured on 2024, where three phase pieces picked 75.2% of winners, a single total 74.0%,
     and eleven pieces 73.5%. These three figures come from the same scorer and are comparable only to
     each other.
   - SigmaScout's 2026 split is finer than Statbotics': four hub shifts against Statbotics' two pairs.
4. **Cleaning up FIRST's score data.**
   - Before rating, Statbotics corrects the score breakdowns it gets from The Blue Alliance. It fixes
     sensor miscounts in 2022, counts game pieces from the field grids in 2019 and 2023, removes bonus
     points in 2016 and 2017, reworks 2025's algae points, and patches a few individual matches by hand.
   - SigmaScout uses the official point values as reported. The two agree exactly only in 2024.
   - Be honest: the gap record marks these as not yet adopted, NOT as a deliberate refusal. Do not
     claim a principled reason.
5. **Season-specific adjustments to the output.**
   - Statbotics adjusts its predictions in some seasons: 2018 (the switch and scale), 2023 and 2025.
   - SigmaScout applies no season-specific adjustments. The same calculation runs every season.
   - Deliberate: it keeps the calculation identical across seasons. Do NOT quote any 2018 accuracy
     figure. The +0.02pp figure in the docs is SPR's, not EPA's.
6. **Starting ratings in a new season.**
   - How a starting rating is split: Statbotics splits it across pieces by what each piece was worth
     in week 1. SigmaScout splits it evenly.
   - Point scale: Statbotics converts a carried rating into the new game's point scale using
     week-1 numbers it already knows. SigmaScout waits until 250 alliance scores from the new season
     are in (`EPA_CARRY_RESCALE_MIN_OBS = 250`). A team that plays before then keeps its carried
     rating unconverted.
   - Statbotics does not pull 2026 Israeli district teams back toward average, because they did not
     compete before Championship. SigmaScout has no such exception.
   - Why: nobody knows a new game's scoring scale before it has been played.
7. **Offseason events.**
   - Statbotics ignores offseason events entirely.
   - SigmaScout includes offseason matches and they can move a rating. But the rating on the Teams
     list and team page, and a team's starting point for next season, both come from the team's last
     official match.
   - What it changes: nothing for official-match predictions. The measured difference was 0.7576 vs
     0.7576. Do not quote that pair; just say it changes nothing.

### How much it matters
- The head-to-head table is rendered from the artifact. Live values, for orientation only and never
  typed into copy: SigmaScout trails Statbotics on winner accuracy in all five seasons 2022-2026, by
  0.1-0.5 points. The Statbotics column is `statboticsFetched: false`, captured 2026-09-04, so the
  existing "(dated)" marker should stay.
- The summary sentence must stay derived from the artifact's rows, as `headToHeadSummarySentence`
  already does.

## Voice rules (carried from the old content module, still binding)
FRC community audience (students, mentors, scouts). No em dash characters. Short declarative
sentences. No hedging openers. No sentence that restates the previous one. Neutral between the two
sites. A term is explained the first time it appears, in the same sentence. The existing content
test checks these rules. Keep an equivalent check.

</specifics>

<canonical_refs>
## Canonical References

- `docs/models/epa-statbotics-gap.md`: verdict matrix and mechanisms 1-11 (what matches, what differs)
- `docs/models/epa-divergences.md`: sections 2 (fouls), 3 (per-year adjustments), 4 (week-1 scale), 6 (pieces), 7 (offseason), 8 (carry scale)
- `apps/web/src/components/methodology/epaComparisonContent.ts` + `EpaComparisonPage.tsx` + `routes/methodology.epa-vs-statbotics.tsx`: the page being replaced
- `apps/web/src/components/methodology/methodologyCardData.ts`: the hub card (order is load bearing, pinned by test)
- Project memory: vitest must run from BOTH repo root and apps/web (test scope trap). Root `tsc` misses apps/web, so run the web tsconfig typecheck too. Stage commits by explicit path (concurrent sessions share this checkout).

</canonical_refs>
