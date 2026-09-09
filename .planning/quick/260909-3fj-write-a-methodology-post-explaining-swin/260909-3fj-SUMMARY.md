---
phase: quick-260909-3fj
plan: 01
subsystem: web
tags: [methodology, docs-page, svg, accessibility, swing-factor, match-band]
status: complete

requires:
  - packages/harness/swingFactor.ts (SWING_FACTOR_HALF_LIFE_MATCHES, swingDecayFor, swingFactorFromDeviations, allianceSwingBandVariance)
  - apps/web/src/components/team/matchAxis.ts (MATCH_GEOMETRY, allianceMarkPositions, scaleToPlot, padAxisDomain, axisTicks)
provides:
  - route /methodology/swing
  - apps/web/src/components/methodology/swingContent.ts (SWING_SECTIONS, SWING_FIGURES, SWING_PAGE_TITLE, SWING_LEAD)
  - the fourth /methodology hub card
affects:
  - apps/web/src/components/methodology/methodologyCardData.ts (to union widened, third descriptor added)
  - apps/web/src/components/methodology/MethodologyCards.tsx (fourth Link, grid ladder)
  - apps/web/src/routeTree.gen.ts (generated, gitignored)

tech-stack:
  added: []
  patterns:
    - content-as-data module plus a runtime voice gate over exported VALUES (epaComparisonContent house pattern)
    - hand authored inline SVG whose measured quantities are computed by the shipping module at render time
    - structure pinned by equality against hand-typed literal arrays (iteration list trap antidote)

key-files:
  created:
    - apps/web/src/components/methodology/swingContent.ts
    - apps/web/src/components/methodology/swingContent.test.ts
    - apps/web/src/components/methodology/SwingPage.tsx
    - apps/web/src/routes/methodology.swing.tsx
    - apps/web/src/routes/methodology.swing.test.tsx
    - apps/web/src/components/methodology/methodologyCardData.test.ts
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx

decisions:
  - The figures call the shipping code rather than restating its constants, so a constant change moves the picture.
  - Every figure is flagged illustrative and says "example" in its own caption, because all five draw teaching data.
  - The hub grid is sm:grid-cols-2 lg:grid-cols-4, deliberately not md:grid-cols-4.
  - The live frc254 per algorithm figures stayed out of the prose, as the plan directed.

metrics:
  duration: ~50 min
  completed: 2026-09-09
  tasks: 3
  commits: 3

actuals:
  tokens: 16930
  tasks: 3
  commits: 3
---

# Quick Task 260909-3fj: Swing Factor and the match band Summary

A new static page at `/methodology/swing` explains the grey `±` beside a rating
and the coloured bars on a match row for a high school reader, carrying five
hand authored inline SVG figures, wired as the third of four cards on the
`/methodology` hub.

## What shipped

Before this, there was **no user facing explanation of either concept anywhere
on the site**. The only text a reader saw was the `±` ribbon toggle's
`aria-label`. The prose that half explained it lived on the Intro to VPR page,
purged 2026-09-08.

Seven sections, five figures, in the order the plan's `<content_spec>` fixed:

| Section | Figure | Carries |
|---|---|---|
| Where the number starts | F1 `even-split` | FRC publishes no per robot score, so the number is inferred; the even split |
| One team, many matches | F2 `deviations` | Recency weighting AND centring in one picture |
| What a big swing means | F3 `same-rating` | Same rating, different `±`; the three scouting stories |
| Three robots, one band | F4 `squares-add` | Squares add; all or nothing |
| Reading the match band | F5 `match-band` | Overlap IS the win probability; walk forward |
| How the two numbers were picked | none | Measured, not chosen; the circular first attempt; excluded from tuning |
| What it cannot do | none | The 0.59 ceiling, the deliberately wide band, the two match minimum |

## The load bearing design call

**The figures compute their own numbers by calling the shipping module.** The
scale and the half life are typed nowhere in `SwingPage.tsx`, and the route
test asserts that absence:

- F2's band width is `swingFactorFromDeviations` over the example misses, and
  each dot's opacity is `swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES)` raised
  to that observation's age. The recency weighting a reader sees on screen IS
  the shipped weighting, not a guess at what it looks like.
- F3's two `±` labels are `swingFactorFromDeviations` over each row's own dots,
  so a label cannot disagree with the marks beside it.
- F4's combined bar is the square root of `allianceSwingBandVariance` over a
  three team map of 10. The prose's "±17.32, not ±30" is therefore measured on
  screen by the function that produces it in production.
- F5 imports `MATCH_GEOMETRY`, `allianceMarkPositions`, `scaleToPlot`,
  `padAxisDomain` and `axisTicks` from the match table's own axis module, so
  the figure explaining the band is drawn by the geometry the table draws
  rather than a lookalike that could drift away from it.

If either constant moves, these pictures move with it. That is the whole point:
this project's failure log is named for documentation that described a model
which had been deleted.

## Two independent dash gates, because one could not cover the page

The user's requirement was no hyphens. Neither gate covers the whole page alone:

1. **`swingContent.test.ts`** checks the three dash characters at runtime over
   exported string VALUES, never as a source grep, because this file's own doc
   comments legitimately use normal punctuation and a whole file grep would
   false positive on them.
2. **`methodology.swing.test.tsx`** checks `document.body.textContent`. Roughly
   half the words on this page are labels INSIDE the SVG figures, which are JSX
   and invisible to gate 1. This is the gate that actually enforces the
   requirement across the whole page.

Both were spot checked by hand rather than assumed. An em dash typed into a
paragraph fails gate 1 with a message naming the exact section and paragraph
index. A hyphen typed into an SVG label fails gate 2. Both were reverted.

Consequences absorbed into the prose: compounds go open ("half life", "walk
forward", "match to match"), the formula is written in words ("the score an
alliance actually put up, subtract the score that was predicted for it, then
divide by the number of robots"), and no figure label carries a leading minus.
F2 names direction in words above and below the zero line and labels magnitudes
unsigned.

## Honesty constraints held

- **The retired algorithm is never named.** Coverage is phrased as "about 76%
  to 87% depending on which rating you are looking at" and the 2026 re
  validation as "came out near 2.0", both true without naming a rating the site
  no longer publishes. Asserted in both test files. OPR, EPA and BPR are named.
- **No number was invented.** All 21 measured figures from the research doc are
  pinned as substrings, so a prose rewrite cannot silently drop the provenance.
- **The limits are stated plainly and not softened**: the 0.59 ceiling as the
  data's limit, the deliberately wide band against 68.3% for a textbook one
  standard deviation, the two match minimum, and the all or nothing band rule.
- **Every figure draws example data, so every caption says "example."** A
  reader is never shown a teaching drawing that could be mistaken for a
  published result. The test enforces the pairing.
- The live `frc254` per algorithm figures stayed out, as the plan directed. The
  point they would have carried is made in words instead.

## Figure geometry was verified, not eyeballed

I could not drive a browser from here, so rather than claim a visual check I
did not do, I rendered the page and computed every SVG label's bounding box
from its `x`, `y`, `text-anchor` and `font-size`, then checked each against the
figure's bounds and against its neighbours. Results: nothing out of bounds in
any of the five figures, no label collisions, F1's "predicted 150" and
"actually scored 168" separated by 144px, F4's wrong answer label seated inside
its own bar rather than overflowing the canvas at x=660, and F5's three rows
confirmed numerically to run from heavy overlap (red 272.7 to 421.7 against
blue 281.0 to 446.5) through partial to clean separation (red 173.4 to 272.7
against blue 454.8 to 570.6). The scaffolding was deleted, not committed.

One change came out of that measurement: F5's row gap went from 14 to 26,
lifting the proximity ratio from about 2.4 to about 2.9 against the 22px
between the two alliance band centres. `chart-craft.md` records the shipped bug
this guards, where a dot landing far from its partner read as belonging to the
neighbouring row.

**Still worth a human eye** (the plan asked for it and I could not do it):
open `/methodology/swing` at desktop width and at 390px, and `/methodology` to
see the four cards at tablet width.

## Deviations from Plan

**None affecting behaviour.** Two small judgement calls inside the plan's own
latitude:

1. **F4 was drawn zero anchored from a common left baseline** rather than as
   "three bars on the left combining into a bar on the right." Bar length then
   equals the `±` value exactly, all five bars share one labelled axis, and the
   "one shared value axis per figure" rule is satisfied without a second scale.
   The comparison the plan wanted (right answer against wrong answer) reads
   more directly this way.
2. **F5's row labels are lowercase plain language** ("close to a coin flip",
   "a slight favourite", "a strong favourite") rather than anything that could
   read as a tier name. The research doc's first correction is explicit that
   this repo has no Toss up / Lean / Likely / Lock tiering and the post must not
   invent one.

## Concurrent session interference, recorded because it looked like a defect

Twice during verification a failure appeared that was **not mine**:

- A `tsc` error `TS2304: Cannot find name 'showSwingScore'` in
  `teams-table/columns.tsx`, a file this task never touches. It appeared
  between two of my typecheck runs and cleared on its own.
- A run showing `2 failed`, which on immediate re-run was `102 passed`, with
  the test count moving 1589 to 1590 between runs.

Both came from another session editing `SeasonHeader.tsx`, `SeasonHeader.test.tsx`,
`TeamsTable.tsx` and `columns.tsx` in the shared checkout while I was running.
Per the scope boundary I did not fix them and did not stage them. Every commit
here staged its files by explicit path. Worth knowing: the columns.tsx error
was a `tsc` failure while the SUITE stayed green, which is exactly the
"tests passing over an undefined imported constant" shape already in memory.

## Verification

Run from `apps/web`, judged by printed output rather than exit code:

| Gate | Baseline | After |
|---|---|---|
| `npx vitest run` | 99 files, 1552 tests, 0 failures | **102 files, 1590 tests, 0 failures** |
| `npx tsc --noEmit -p tsconfig.json` | clean | **clean, no output** |
| `npx vite build` | n/a | completes; `routeTree.gen.ts` carries `/methodology/swing` (9 occurrences) |

My three new test files contribute 36 tests (15 + 15 + 6) and
`methodology.index.test.tsx` gained 1 by picking up the fourth card from
`METHODOLOGY_CARDS.length` without being edited: 1552 + 37 = 1589. The 1590th
belongs to the concurrent session above.

Each new test fails loudly if its subject regresses. Three were confirmed by
hand and reverted: an em dash in a paragraph fails the content gate, a hyphen
in an SVG label fails the rendered gate, and swapping two entries in
`METHODOLOGY_CARDS` fails the order pin. That last one closes a real gap, since
`MethodologyCards.tsx` destructures positionally and `methodology.index.test.tsx`
would have stayed green through a swap by asserting the swapped pairing against
itself.

## Known Stubs

None. The page renders no placeholder, fetches nothing, and every value it
draws is either a labelled example or computed by the shipping module.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `b0e9d533` | `swingContent.ts` plus its voice and structure gate |
| 2 | `c22a3d59` | `SwingPage.tsx` with five figures, the route, the route test |
| 3 | `d6db934e` | The methodology hub's fourth card, order pinned by equality |

## Self-Check: PASSED

All six files verified present on disk. All three commit hashes verified in
`git log`. Route tree verified to carry `/methodology/swing`. Temporary
geometry scaffolding verified absent.
