---
sketch: 015
name: awards-page-rewrite
question: "How short can the Predicting awards page get on Jacob's goal / model / results outline, and do the numbers belong in prose or tables?"
winner: "B2"
tags: [copy, methodology, awards, de-ai, tables]
---

# Sketch 015: Awards Page Rewrite

## Design Question
Jacob judged the live `/methodology/awards` page (1,369 words, nine sections) "too wrong to fix"
by hand and gave an outline to rebuild it on:

1. The goal: predict awards
2. The model: what we built
3. Our results
   - Past winners win again (merged with "the simple rule won")
   - Team age: no real difference
   - Predicting a single winner is much harder than predicting a short list

The calibration, qualifying and "what it cannot do" sections are dropped in every variant.
Every number used is one the live page already states (so it traces to the two measure scripts).
No hyphen or dash characters in any copy string.

## How to View
open .planning/sketches/015-awards-page-rewrite/index.html

## Variants
- **A: Bare minimum** — flat tone from sketch 014, one short paragraph per section, one headline
  number per finding.
- **B: Numbers in tables** — one sentence per finding, numbers in small tables. Only variant that
  needs a component change (`AwardsPage.tsx` renders paragraphs only).
- **C: Your draft, finished** — starts from the sentences Jacob typed into `awardsContent.ts`
  (uncommitted at sketch time), continues in that "we" voice, keeps the rookie finding.

## What to Look For
- Prose numbers (A, C) versus tables (B).
- Whether the rookie / lowest team number finding survives the cut (only C keeps it).
- Whether the 3% random guess yardstick is enough context for the percentages.

## Implementation notes for whichever wins
- `awardsContent.test.ts` pins nine section ids by equality and about 57 figures as substrings.
  Both lists must shrink with the page. It also requires "lowest team number" in the `team-age`
  section (only C satisfies that) and "does not show award predictions" in the lead (all three do).
- "Our results" with three subheadings needs either an optional `subsections` field on
  `AwardsSection` or flat headings.
- Jacob's working copy of `awardsContent.ts` has an uncommitted edit whose section id
  (`the-goal:-predict-awards`) is not in the id union; the rewrite replaces it.

## Outcome (2026-09-16)
**Winner: B2, tables plus a fourth result.** Jacob liked B, asked for the SPR finding, then
rejected comparing Autonomous against Impact. The shipped table instead shows SPR alone (the B2
baseline row in `pnpm measure:award-predictability`) against the simple rule (B1) on the five
judged awards where SPR alone does best. SPR alone beats the simple rule only on Autonomous
(17.7% vs 14.3%) and, barely, Excellence in Engineering (13.1% vs 12.1%). Dean's List Finalist
(10.1% vs 20.5%) was left out of the table as a student award. His heading for the last result:
"Predicting just one winner is much harder than predicting a short list".

Shipped to `awardsContent.ts` with a table block and h3 subsections in `AwardsPage.tsx`.
Takeaway: for results pages, one sentence per finding plus a small table beats prose numbers.
