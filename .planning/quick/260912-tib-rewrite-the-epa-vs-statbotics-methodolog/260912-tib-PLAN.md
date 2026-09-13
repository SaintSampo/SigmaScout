---
phase: quick-260912-tib
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/methodology/epaComparisonContent.ts
  - apps/web/src/components/methodology/epaComparisonContent.test.ts
  - apps/web/src/components/methodology/EpaComparisonPage.tsx
  - apps/web/src/routes/methodology.epa-vs-statbotics.tsx
  - apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx
autonomous: true
requirements: [QUICK-260912-tib]

estimate:
  tokens: 30000
  raw_tokens: 60000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "Visiting /methodology/epa-vs-statbotics shows three parts in this order: a 'Same on both sites' list, a 'Where they differ' section of seven comparison cards, and a 'How much it matters' section holding the head-to-head table, its summary sentence and the provenance line."
    - "No per-season agreement table, and no slope, Pearson, correlation or mean absolute difference wording, appears anywhere on the page, even though the fixture and the live artifact still carry an agreement array."
    - "Every accuracy and Brier number on the page is read from the artifact. The only decimal numbers in the page copy are the 2024 score-piece figures 73.5, 74.0 and 75.2."
    - "The lead, the shared list and all seven cards render from first paint, including while the artifact is pending, on a 404 and on a fetch error. Only the head-to-head results slot waits on the artifact."
    - "The week 1 card says Statbotics takes its score spread and foul rate from all of week 1, says SigmaScout uses running estimates during week 1, and says the difference never changes a winner pick. No string says the spread is computed once the season is over."
    - "The score data card claims no deliberate reason for SigmaScout skipping the corrections; it says they have not been adopted yet."
    - "Each card stacks to one column at 390px (Statbotics line, then SigmaScout line, then note) and places the two site lines side by side from the md breakpoint."
    - "The hub card keeps its URL, position, title and blurb (untouched by this plan)."
  artifacts:
    - path: apps/web/src/components/methodology/epaComparisonContent.ts
      provides: "Every prose string the page renders: title, lead, three section headings, six shared items, seven difference cards, head-to-head intro, and the unchanged headToHeadSummarySentence"
    - path: apps/web/src/components/methodology/EpaComparisonPage.tsx
      provides: "EpaComparisonPage (static three-part layout with a results slot), EpaHeadToHeadResults, EpaHeadToHeadSkeleton, and the testid exports"
    - path: apps/web/src/routes/methodology.epa-vs-statbotics.tsx
      provides: "Route that owns the query and fills the results slot with the 404, error, pending or populated branch"
    - path: apps/web/src/components/methodology/epaComparisonContent.test.ts
      provides: "Equality pins on item ids, card ids and note labels; voice, fact and liability gates over every exported string"
    - path: apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx
      provides: "Rendered-DOM coverage: first-paint prose in every query state, card order equals the content constant, no agreement output, dash gate over the whole rendered page"
  key_links:
    - "EPA_DIFFERENCE_CARD_IDS <-> the hand-typed expected array in epaComparisonContent.test.ts (equality) <-> the rendered article testids in DOM order in the route test (equality). A silently added, dropped or reordered card fails one of the two."
    - "Route query branches <-> EpaComparisonPage's results prop. The route owns the single useQuery; the page component never fetches."
    - "headToHeadSummarySentence <-> artifact.headToHead rows. Its season counts are derived from the rows at render time, never typed."
    - "EpaComparisonArtifactSchema still requires an agreement array, so the route test fixture must keep one even though nothing renders it."
---

<objective>
Replace the body of `/methodology/epa-vs-statbotics` with a page written from scratch that explains
how SigmaScout's EPA (live `epa@10.0.0+baseline`) differs from Statbotics' EPA, in three parts:
what is the same, one comparison card per difference, and the head-to-head accuracy table.

Purpose: the current copy is stale and partly false (it says Statbotics computes its win
probability spread only after the season; Statbotics computes it from week 1), it omits most of the
real differences, and it renders an agreement table Jacob decided to drop.

Output: a rewritten content module and its test, a rewritten page component, a rewritten route and
its test. Same URL. The published artifact, its schema, the publish scripts, `docs/models/*.md` and
the hub card files are not touched.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/260912-tib-rewrite-the-epa-vs-statbotics-methodolog/260912-tib-CONTEXT.md

Load before writing any UI: `Skill("sketch-findings-sigmascout")`. The rules that bind here: every
colour is a `--color-*` token, never a literal; green is ink, not paint (no green fills, and the
accent colour means interactive only, so the SigmaScout line gets NO accent treatment); only the
two font weights 400 and 600 exist.

The files being replaced (read once, then rewrite; do not port their revision-history comments):
@apps/web/src/components/methodology/epaComparisonContent.ts
@apps/web/src/components/methodology/epaComparisonContent.test.ts
@apps/web/src/components/methodology/EpaComparisonPage.tsx
@apps/web/src/routes/methodology.epa-vs-statbotics.tsx
@apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx

Pattern references (content-as-data, collector-based voice gate, card chrome):
@apps/web/src/components/methodology/sprContent.test.ts
@apps/web/src/components/methodology/MethodologyCards.tsx
</context>

<blocking_discovery>
## READ THIS FIRST: another session is editing the methodology hub right now

At planning time `git status` showed a concurrent session (quick task 260912-tm8, an awards page)
with UNCOMMITTED edits to `methodologyCardData.ts`, `methodologyCardData.test.ts` and
`MethodologyCards.tsx`, plus untracked `AwardsPage.tsx`, `awardsContent.ts`,
`awardsContent.test.ts`, `methodology.awards.tsx` and `methodology.awards.test.tsx`.

Consequences:

1. **This plan does not touch the hub card.** CONTEXT.md allows a blurb reword but does not require
   one, and says the current blurb still fits because the head-to-head table stays. Do not open,
   edit, stage or "tidy" `methodologyCardData.ts`, its test, or `MethodologyCards.tsx`.
2. **Stage by explicit path only, every commit.** Never `git add -A`, `git add .`, or
   `git commit -a`. This repo has a recorded incident where a commit absorbed a concurrent
   session's edits.
3. **A red result outside your five files may be theirs.** If the full `apps/web` vitest run or the
   web typecheck reports a failure in an awards file, a hub card file, or anything else this plan
   does not list, record it in the SUMMARY as pre-existing/concurrent with the file name and do not
   fix it. Every failure inside the five files listed in `files_modified` is yours and must be fixed.
</blocking_discovery>

<copy_deck>
## Copy deck (the exact strings; every one is traced to CONTEXT.md's verified fact sheet)

Use these strings verbatim. If a string must change to satisfy a gate, keep the change inside the
fact sheet and record it in the SUMMARY. None of these strings contains an em dash or en dash; do
not introduce one. Hyphens inside words are allowed on this page.

### Page title and lead
- Title: `Our EPA vs Statbotics' EPA`
- Lead: `SigmaScout and Statbotics both publish EPA (Expected Points Added), a rating of how many points an FRC team adds to its alliance's score. Most of the calculation is the same on both sites. This page lists what is shared, where the two differ, and how much the differences change match predictions.`

### Section headings
- Shared list: `Same on both sites`
- Cards: `Where they differ`
- Results: `How much it matters`

### Shared list (id, text), in this order
1. `rating-update`: `After every match, each team's rating moves part of the way toward what that match showed. Both sites use the same formula, and on both the learning rate (how far one match can move a rating) starts high and settles as a team plays more matches.`
2. `elimination-matches`: `Elimination matches count one third as much as qualification matches, and they do not add to a team's match count.`
3. `win-probability-curve`: `Win probability comes from the same logistic curve, an S-shaped curve that turns the predicted score gap without foul points into a chance of winning.`
4. `fouls-in-predictions`: `Fouls are added back into predicted scores the same way: both alliances' scores are multiplied by one shared number, so fouls never change which alliance is favored.`
5. `new-season-carryover`: `A team's first rating in a new season uses the same formula: 70 percent of last season's rating plus 30 percent of the season before, pulled 40 percent of the way back toward a starting value slightly below average.`
6. `no-uncertainty-range`: `EPA is a single number on both sites, with no ± range showing how uncertain it is.`

### Card line labels
- `Statbotics` and `SigmaScout` (the two site lines are written without repeating the site name,
  because the label already names it)
- Note labels: exactly `Why` or `What it changes`

### Difference cards, in this display order (id, title, Statbotics line, SigmaScout line, notes)

1. `week-one-numbers`, title `Season numbers from week 1`
   - Statbotics: `Takes the score spread (how widely alliance scores vary) and the foul rate (how many extra points fouls add on average) from all of week 1, once week 1 is over. Uses both for every match, week 1 included.`
   - SigmaScout: `Uses the same week 1 numbers from week 2 on. During week 1, uses running estimates built from the matches already played.`
   - Why: `A week 1 prediction cannot use week 1 matches that have not happened yet.`
   - What it changes: `How confident week 1 predictions are, and how large their predicted scores are. This difference never changes a winner pick, because dividing the score gap by a different positive number, or scaling both scores by the same amount, cannot flip which alliance is ahead.`

2. `score-pieces`, title `How a score is split into pieces`
   - Statbotics: `Rates a list of about 18 numbers per team. The list overlaps itself: a total sits next to the pieces it is made of. In most seasons the predicted score reads only one entry, the total without fouls. In 2018 and 2023 it reads seven pieces through caps and curves, and 2018 also reads three of the other alliance's pieces.`
   - SigmaScout: `Rates pieces that do not overlap and adds all of them up. The 2026 split is finer: four separate hub shifts, where Statbotics uses two pairs.`
   - Why: `Measured on 2024: three pieces (one per match phase) picked 75.2 percent of winners, a single total picked 74.0 percent, and eleven pieces picked 73.5 percent. These three figures come from one measurement and compare only with each other, not with the table below.`

3. `new-season-start`, title `Starting ratings in a new season`
   - Statbotics: `Splits a team's starting rating across scoring pieces by what each piece was worth in week 1. Converts a carried-over rating (the one brought forward from last season) into the new game's point scale using week 1 numbers it already has. Makes one exception in 2026: Israeli district teams are not pulled back toward average, because they did not compete before the Championship.`
   - SigmaScout: `Splits a starting rating evenly across pieces. Converts a carried-over rating only once 250 alliance scores from the new season are in, so a team that plays before then keeps its rating unconverted. Makes no exception for any group of teams.`
   - Why: `Nobody knows a new game's scoring scale before it has been played.`

4. `score-data-cleanup`, title `Cleaning up FIRST's score data`
   - Statbotics: `Corrects the score breakdowns (the detailed per-match scoring records) it gets from The Blue Alliance before rating. Fixes sensor miscounts in 2022, counts game pieces from the field grids in 2019 and 2023, removes bonus points in 2016 and 2017, reworks 2025's algae points, and patches a few individual matches by hand.`
   - SigmaScout: `Uses the official point values as reported. These corrections have not been adopted yet.`
   - What it changes: `The two sites rate exactly the same score data only in 2024.`
   - HONESTY RULE: this card must never say or imply a deliberate reason. No "deliberate", "on purpose", "chose" or "choice" anywhere in it.

5. `season-adjustments`, title `Season-specific adjustments`
   - Statbotics: `Adjusts predictions in some seasons: 2018 for the switch and scale, plus 2023 and 2025.`
   - SigmaScout: `Applies no season-specific adjustments.`
   - Why: `A deliberate choice that keeps the calculation identical in every season.`

6. `ranking-points`, title `Ranking points`
   - Statbotics: `Also predicts ranking points, the points that order teams in the qualification standings. In 2016 and 2017 elimination matches, mixes those predictions into the predicted score.`
   - SigmaScout: `Predicts scores and winners only, never ranking points.`
   - Why: `A deliberate choice by SigmaScout's developer.`

7. `offseason-events`, title `Offseason events`
   - Statbotics: `Ignores offseason events entirely.`
   - SigmaScout: `Includes offseason matches, and they can move a rating. The rating on the Teams list and team pages, and a team's starting point for next season, both come from its last official match.`
   - What it changes: `Nothing for predictions of official matches.`

Fouls are folded into card 1 rather than given their own card (Claude's discretion per CONTEXT.md:
prediction-time foul handling is now identical, and the only remaining difference is the week 1 rate).

### Head-to-head intro
`This table shows how often each site's EPA picked the winner of a match, and each one's Brier score. A Brier score measures how close predicted win probabilities came to what actually happened. Lower is better, and 0 would mean a perfect prediction every time.`

### Summary sentence
Keep `headToHeadSummarySentence(statboticsAheadCount, totalSeasons)` with its current four-branch
body and wording exactly as it is today.
</copy_deck>

<tasks>

<task type="tracer">
  <name>Task 1: End to end rebuild of the page structure, one shared item and one card</name>
  <precondition>`git status --short -- apps/web/src/components/methodology/epaComparisonContent.ts apps/web/src/components/methodology/epaComparisonContent.test.ts apps/web/src/components/methodology/EpaComparisonPage.tsx apps/web/src/routes/methodology.epa-vs-statbotics.tsx apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx` prints nothing. If it prints anything, another session holds these files: HALT and report, do not commit around it and do not revert it.</precondition>
  <files>apps/web/src/components/methodology/epaComparisonContent.ts, apps/web/src/components/methodology/epaComparisonContent.test.ts, apps/web/src/components/methodology/EpaComparisonPage.tsx, apps/web/src/routes/methodology.epa-vs-statbotics.tsx, apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx</files>
  <read_first>The five files above (whole, once each); apps/web/src/components/methodology/sprContent.test.ts (its collectStrings pattern); apps/web/src/components/methodology/MethodologyCards.tsx (the `.event-card ... shadow-sm` class string only); the copy_deck section of this plan.</read_first>
  <behavior>
    - Content test: the shared item ids equal the hand-typed array containing only `rating-update`; the card ids equal the hand-typed array containing only `week-one-numbers`; the note labels per card equal the hand-typed object mapping `week-one-numbers` to `Why` then `What it changes`.
    - Content test: a voice gate over every exported string (collected as where/text records) rejects the em dash, the en dash, and the hedge regex `sigmaContent.test.ts` uses; the summary sentence outputs for (0,0), (0,5), (3,5), (5,5) are included in the collection.
    - Content test: a liability gate rejects, case-insensitively, the phrases `rates one quantity per alliance`, `rates one quantity per season`, `predicts from a single number instead`, `the other rates one total`, and `once the season is over`; rejects the words slope, pearson, correlation and the phrase mean absolute difference; and asserts every match of the pattern for digits-dot-digits across all strings is one of 73.5, 74.0, 75.2.
    - Content test: the three existing headToHeadSummarySentence behavior tests are kept.
    - Route test: in the pending, 404 and 500 states the shared list testid and the difference cards testid are both present; pending shows a skeleton and no head-to-head table; 500 shows the retry button; 404 shows the empty state heading and no retry button.
    - Route test, populated: one head-to-head body row per season; the summary contains `3 of 5`; the provenance line contains the fixture's epaVersion; the rendered article testids inside the cards container, in DOM order, equal the content module's card ids mapped through the testid helper; the rendered list items' text equals the shared item texts in order; each rendered card contains the exact texts `Statbotics` and `SigmaScout`; no element with testid `epa-comparison-agreement-table` exists and no text matches the regexes for agreement, slope or pearson; the whole rendered body text contains no em dash and no en dash.
  </behavior>
  <action>
Load `Skill("sketch-findings-sigmascout")` first.

CONTENT MODULE. Rewrite `epaComparisonContent.ts` from scratch. Delete every old export (the old
entry interface, the old three-entry array and its id tuple, the old lead, and both old intro
constants) and the entire old header comment including its revision history. Write a short new
header comment: this module is the single source of every prose string on
`/methodology/epa-vs-statbotics` (quick task 260912-tib); the voice rules from CONTEXT.md (FRC
community audience, no em dash, short declarative sentences, no hedging openers, no restating the
previous sentence, neutral between the two sites, a term explained where it first appears); the
facts come from `docs/models/epa-statbotics-gap.md`, `docs/models/epa-divergences.md` and
`packages/core/algorithms/{epa,carryover,epaCarryScale}.ts`; no accuracy or Brier literal may
appear except the three 2024 score-piece figures; and the published artifact still carries an
`agreement` array that this page deliberately does not render (Jacob, 2026-09-12). Do not name any
retired algorithm id in comments or copy (a repo-wide sweep test scans for them).

Export, in this order: `EPA_COMPARISON_PAGE_TITLE`; `EPA_COMPARISON_LEAD`;
`EPA_SAME_SECTION_HEADING`; `EPA_DIFFERENCE_SECTION_HEADING`; `EPA_HEAD_TO_HEAD_SECTION_HEADING`;
`EPA_HEAD_TO_HEAD_INTRO`; `EPA_CARD_STATBOTICS_LABEL` and `EPA_CARD_SIGMASCOUT_LABEL`; a type
`EpaNoteLabel` that is the union of the two note label strings; interface `EpaCardNote` with
readonly `label: EpaNoteLabel` and `text: string`; tuple `EPA_SAME_ITEM_IDS` as const with derived
type `EpaSameItemId`; interface `EpaSameItem` with readonly `id` and `text`; `EPA_SAME_ITEMS`;
tuple `EPA_DIFFERENCE_CARD_IDS` as const with derived type `EpaDifferenceCardId`; interface
`EpaDifferenceCard` with readonly `id`, `title`, `statbotics`, `sigmascout`, and
`notes: readonly EpaCardNote[]`; `EPA_DIFFERENCE_CARDS`; and `headToHeadSummarySentence` with its
existing body unchanged. For THIS task the two tuples and arrays carry only the first copy deck
entry each (`rating-update` and `week-one-numbers` with both of its notes). All other strings come
from the copy deck in full.

CONTENT TEST. Rewrite `epaComparisonContent.test.ts` from scratch per the behavior block: hand-typed
expected arrays and a hand-typed expected note-label object pinned by `toEqual` (never only
iterating the exported constant); a `collectStrings()` returning where/text records over every
exported string, mirroring `sprContent.test.ts`; voice and liability gates asserted at runtime over
those values (never by grepping source text, since comments may legitimately discuss retired
wording). Write a short fresh header comment saying so.

PAGE COMPONENT. Rewrite `EpaComparisonPage.tsx` from scratch with a fresh header comment (route owns
the query, this file never fetches; static prose renders from first paint and only the results slot
waits on the artifact; `.event-card` is reused from `MethodologyCards.tsx` and
`CalibrationSection.tsx`; the head-to-head table markup mirrors `AccuracyTable.tsx`; the artifact's
agreement array is intentionally unused). Exports:

- `EpaComparisonPage({ results }: { readonly results: ReactNode })`, a `flex flex-col gap-[var(--spacing-lg)]` column holding: the lead paragraph (`max-w-[72ch] text-role-body text-[var(--color-text-primary)]`); a `section id="same-on-both-sites"` with an `h2` (`text-role-heading text-[var(--color-text-primary)]`) and a `ul` carrying the shared-list testid, classes `flex max-w-[72ch] list-disc flex-col gap-[var(--spacing-xs)] pl-[var(--spacing-lg)]`, one `li` (`text-role-body text-[var(--color-text-primary)]`) per item keyed by id; a `section id="where-they-differ"` with its `h2` and a `div` carrying the cards testid, classes `flex flex-col gap-[var(--spacing-md)]`, holding one `article` per card; and a `section id="how-much-it-matters"` (`flex flex-col gap-[var(--spacing-sm)]`) with its `h2`, the intro paragraph, then `results`.
- Each card `article` carries `data-testid` from the helper, classes `event-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)] shadow-sm`, and contains: an `h3` title (`text-role-body font-semibold text-[var(--color-text-primary)]`); a `dl` with classes `grid gap-[var(--spacing-sm)] md:grid-cols-2` holding two `div` groups (`flex min-w-0 flex-col gap-[var(--spacing-xs)]`), each a `dt` label (`text-role-label text-[var(--color-text-muted)]`) and a `dd` line (`text-role-body text-[var(--color-text-primary)]`), Statbotics first; then one more `div` group per note with the same inner classes plus `md:col-span-2 border-t border-[var(--color-border)] pt-[var(--spacing-sm)]`. No accent colour, no fill, no colour literal. This is what makes the card stack at 390px and sit side by side from md.
- `EpaHeadToHeadResults({ artifact }: { readonly artifact: EpaComparisonArtifact })`: the head-to-head table copied from the current file (same two-row header, same classes, same `(dated)` marker when `statboticsFetched` is false, same sort and comparable-row counting), then the summary paragraph, then the provenance line (`Measured under EPA {epaVersion} on {measuredAt first 10 chars}.`, muted). The null formatter returns an empty string instead of a dash glyph, matching `AccuracyTable.tsx`, so no dash character can reach the DOM from a missing value.
- `EpaHeadToHeadSkeleton()`: a small column of `Skeleton` blocks sized like the table and the summary line.
- Testid exports: `EPA_COMPARISON_SAME_LIST_TESTID` (`epa-comparison-same-list`), `EPA_COMPARISON_DIFFERENCE_CARDS_TESTID` (`epa-comparison-difference-cards`), function `epaDifferenceCardTestId(id: EpaDifferenceCardId)` returning `epa-difference-card-` plus the id, and the three existing head-to-head exports `EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID`, `EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID`, `EPA_COMPARISON_PROVENANCE_TESTID` with their current string values. Remove the agreement table, its formatters, its testid and its export alias entirely.

ROUTE. Rewrite `methodology.epa-vs-statbotics.tsx` with a fresh header comment (one useQuery, no
validateSearch, fixed branch order 404 / other error / pending / populated, prose never gated on
the query). Delete the old comment's claim that the hub does not link here yet. Keep the
container `mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]` and the `h1` classes; the `h1`
renders `EPA_COMPARISON_PAGE_TITLE`. Compute a `results` node: the existing `EmptyState` (same
heading and body) on 404, the existing `ErrorState` with retry on any other error, `EpaHeadToHeadResults`
when data is present, otherwise `EpaHeadToHeadSkeleton`. Render `EpaComparisonPage` with it.

ROUTE TEST. Rewrite `methodology.epa-vs-statbotics.test.tsx` from scratch per the behavior block,
keeping the existing route-tree harness (real exported `Route`, `createRootRoute` with
`RootSearchSchema`, memory history, `retry: false`) and the existing five-season fixture (head-to-head
rows arranged so Statbotics leads exactly three seasons). Keep an `agreement` array in the fixture,
because `EpaComparisonArtifactSchema` still requires it; say so in a one-line comment. Set the
fixture's `epaVersion` to `10.0.0+baseline`. The title test uses the hand-typed literal title, not
the constant, so a title change fails loudly.

Run the verify commands, read the printed output, then commit these five paths by explicit path
only: `feat(260912-tib): rebuild the EPA vs Statbotics page as shared list, difference cards and head-to-head`.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run apps/web/src/components/methodology/epaComparisonContent.test.ts apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx 2>&amp;1 | tail -25; npx tsc --noEmit -p apps/web/tsconfig.json 2>&amp;1 | tail -20; grep -rnE "BLOCK_INTRO|AGREEMENT_TABLE_TESTID|EPA_DIFFERENCE_ENTRIES|EPA_DIFFERENCE_IDS|Per-season agreement|NOT linked from the hub" apps/web/src; echo "stale-identifier-grep-exit=$?"</automated>
    <note>Never wrap these in `timeout ... pnpm ...`; that form swallows output and exits 0. Read the printed pass/fail counts, not the exit code. An empty `tsc` output means zero type errors. The grep must print no matching lines and `stale-identifier-grep-exit=1`. A typecheck error in a file outside this plan's five files is concurrent-session work (see blocking_discovery): record it, do not fix it.</note>
  </verify>
  <done>Both test files pass with the thin one-item/one-card content; the page renders all three sections through the real Route in every query state; the agreement table and every old identifier are gone from apps/web/src; the web typecheck shows no error in any of the five files; one commit containing exactly the five paths.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Every shared item and all seven difference cards, with fact gates</name>
  <precondition>Task 1's commit exists (`git log -5 --format=%s` includes the 260912-tib feat commit; a concurrent session may have committed on top of it) and `git status --short` for this plan's five paths prints nothing.</precondition>
  <files>apps/web/src/components/methodology/epaComparisonContent.ts, apps/web/src/components/methodology/epaComparisonContent.test.ts</files>
  <read_first>The copy_deck section of this plan; the two files as committed by Task 1.</read_first>
  <behavior>
    - The shared item ids equal the hand-typed array of all six deck ids in deck order.
    - The card ids equal the hand-typed array of all seven deck ids in deck order: week-one-numbers, score-pieces, new-season-start, score-data-cleanup, season-adjustments, ranking-points, offseason-events.
    - The note labels object equals, by `toEqual`, the hand-typed mapping: week-one-numbers to Why then What it changes; score-pieces, new-season-start, season-adjustments and ranking-points to Why; score-data-cleanup and offseason-events to What it changes.
    - Fact gate over the joined shared-list text: contains `one third`, `logistic`, `70 percent`, `30 percent`, `40 percent`.
    - Fact gates per card (joined title, lines and note texts): week-one-numbers contains `week 1` and `never changes a winner pick`; score-pieces contains `75.2`, `74.0` and `73.5`; new-season-start contains `250`; score-data-cleanup contains `have not been adopted` and does NOT match the case-insensitive regex for deliberate, on purpose, chose or choice; season-adjustments and ranking-points each contain `deliberate`; offseason-events contains `last official match`.
    - All Task 1 voice and liability gates still pass over the full content, including the decimal allowlist.
  </behavior>
  <action>
Write the failing test changes first: extend the hand-typed expected arrays and note-label object to
the full deck and add the fact gates from the behavior block (each gate names the card id in its
assertion message). Run the content test and confirm it fails on the pins. Then fill
`EPA_SAME_ITEM_IDS`, `EPA_SAME_ITEMS`, `EPA_DIFFERENCE_CARD_IDS` and `EPA_DIFFERENCE_CARDS` with
every remaining copy deck entry, verbatim and in deck order, and rerun until green. Fouls stay
folded into the week 1 card per the copy deck note. The route test needs no edit: it compares the
rendered cards and list against the content constants, which the content test now pins by equality.

If any gate forces a wording change, the replacement must stay inside CONTEXT.md's verified fact
sheet; list every such deviation from the deck in the SUMMARY.

Then run the full verification below and commit the two paths by explicit path only:
`feat(260912-tib): write every shared item and difference card from the verified fact sheet`.

SUMMARY: write `260912-tib-SUMMARY.md` in this plan's directory with the Write tool. If Write refuses,
do not route around it through Bash and do not use a heredoc; return the full SUMMARY text in your
final message for the orchestrator to write. Report the test and typecheck results as the counts
printed in the output, and list any failure attributed to concurrent-session files by file name.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run apps/web/src/components/methodology apps/web/src/routes/methodology packages/harness/algorithmIdentity.test.ts 2>&amp;1 | tail -25; cd C:/Users/Jacob/Documents/GitHub/SigmaScout/apps/web &amp;&amp; npx vitest run 2>&amp;1 | tail -25; cd C:/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json 2>&amp;1 | tail -20</automated>
    <note>Run BOTH vitest invocations: the repo root (scoped to the methodology files plus the retired-id sweep) and apps/web (full suite). They see different file sets, and a red suite has hidden in that gap before. Report the printed file and test counts from each. If the full apps/web run fails, rerun the failing file alone with its full output before deciding whether it belongs to this plan or to the concurrent awards/hub session.</note>
  </verify>
  <done>The content test pins six shared items, seven cards and their note labels by equality, and every fact, voice and liability gate passes; the route test passes unchanged against the full content; the scoped root run, the full apps/web run and the web typecheck are green for every file this plan owns, with any concurrent-session failure named; one commit containing exactly the two paths; SUMMARY written or returned.</done>
</task>

</tasks>

<source_audit>
## Multi-source coverage audit

| Source | Item | Covered by |
|--------|------|------------|
| GOAL | Delete the old page body and content module, replace from scratch at the same URL | Task 1 (all five files rewritten, route path unchanged) |
| CONTEXT | Keep route and hub card position; title and blurb may be reworded | Route unchanged in Task 1; hub card deliberately untouched (optional reword skipped because a concurrent session holds those files; CONTEXT says the blurb still fits) |
| CONTEXT | Head-to-head only: keep table, derived summary sentence, provenance line | Task 1 (EpaHeadToHeadResults, unchanged summary function) |
| CONTEXT | Remove agreement table and intro; quote no agreement figure | Task 1 (removal, liability gate, rendered-DOM negative test) |
| CONTEXT | No accuracy or Brier literal except 73.5 / 75.2 / 74.0 | Task 1 decimal allowlist gate; Task 2 score-pieces fact gate |
| CONTEXT | Layout: shared list, one compact card per difference (title, Statbotics line, SigmaScout line, why or what it changes), head-to-head section | Task 1 structure; Task 2 content |
| CONTEXT | Cards stack cleanly at 390px; load sketch-findings; reuse chrome and table markup | Task 1 (skill load, `.event-card`, md two-column grid, copied table markup); orchestrator screenshots at 390 and 1440 |
| CONTEXT | Go live via orchestrator push, not executor | Orchestrator follow-up below |
| CONTEXT discretion | Fouls folded into week 1 card | Copy deck card 1 and note |
| FACT SHEET | Six shared facts | Task 2 shared items + fact gate |
| FACT SHEET | Seven differences with their honesty constraints (cleanup not deliberate; no 2018 accuracy; offseason pair not quoted) | Task 2 cards + per-card fact gates + decimal allowlist |
| FACT SHEET | Statbotics column stays `(dated)` | Task 1 keeps the marker |
| VOICE | No em dash, short declarative, no hedging, neutral, terms explained in place | Copy deck; Task 1 voice gate over exported strings and rendered DOM |
| REQ / RESEARCH | None for a quick task | n/a |
</source_audit>

<verification>
- `/methodology/epa-vs-statbotics` renders lead, "Same on both sites" (six items), "Where they differ" (seven cards) and "How much it matters" (table, summary, provenance), proven through the real Route.
- Nothing from the agreement array renders, and no old identifier or stale route comment survives in apps/web/src.
- Content pins are equality-based; voice, fact and liability gates run over every exported string; a dash gate runs over the rendered page.
- Root scoped vitest, full apps/web vitest and the apps/web typecheck reported by printed output.
- Exactly two commits, each staging only its own explicit paths.
</verification>

<success_criteria>
- The false "only once the season is over" claim is gone and the week 1 card states both sites' real sources.
- All seven differences and six shared facts from CONTEXT.md's fact sheet appear, and nothing outside it.
- Every number in the head-to-head section comes from the artifact; the only decimal literals in copy are the three 2024 figures.
- Static prose is visible immediately, before the artifact loads.
- No file outside the five in `files_modified` is modified or staged.
</success_criteria>

<orchestrator_followup>
Not executor work (the executor sandbox has no network):

1. Local visual check with `VITE_ARTIFACT_ORIGIN=local` (activates the /v1 proxy) on a fresh port, at
   1440 and 390 widths, of `/methodology/epa-vs-statbotics`: cards stack Statbotics above SigmaScout
   above the note at 390 with no horizontal page overflow (the table may scroll inside its own
   container); the two site lines sit side by side at 1440; card borders and the note divider read
   as neutral chrome with no green fill; the head-to-head table and `(dated)` markers render. Also
   glance at `/methodology` to confirm the hub card still reads correctly (the concurrent awards
   session may have changed the grid by then).
2. Read the provenance line: if it names an EPA version older than `10.0.0+baseline`, the head-to-head
   figures predate the live model. The page is still honest (it prints the version), but surface it
   to Jacob as a possible republish; do not republish inside this task.
3. Push to main, then verify live by content (the new section headings and card titles present, no
   "OLS slope" header), not by status code.
4. `docs/models/epa-divergences.md` section 4 still records the old page claim as unpaid published
   debt. Docs are out of scope for this task; mention to Jacob that this page now pays it.
5. STATE.md quick-task row: keep any pipe character out of the description.
</orchestrator_followup>

<output>
Create `.planning/quick/260912-tib-rewrite-the-epa-vs-statbotics-methodolog/260912-tib-SUMMARY.md` when done (or return its text if the Write tool refuses).
</output>
