---
phase: quick-260910-vof
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/methodology/sprContent.ts
  - apps/web/src/components/methodology/sprContent.test.ts
  - apps/web/src/components/methodology/SprPage.tsx
  - apps/web/src/components/methodology/methodologyCardData.ts
  - apps/web/src/components/methodology/methodologyCardData.test.ts
  - apps/web/src/components/methodology/MethodologyCards.tsx
  - apps/web/src/components/methodology/sigmaContent.ts
  - apps/web/src/components/methodology/sigmaContent.test.ts
  - apps/web/src/components/compare/MethodologyNote.tsx
  - apps/web/src/routes/methodology.spr.tsx
  - apps/web/src/routes/methodology.spr.test.tsx
  - apps/web/src/routes/methodology.sigma.test.tsx
  - apps/web/src/routes/methodology.compare.test.tsx
autonomous: true
requirements: [QUICK-260910-vof]

estimate:
  tokens: 96000
  raw_tokens: 48000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Visiting /methodology/spr renders a page titled around SPR that explains what the number is, in points per match, without transcribing any accuracy figure."
    - "The /methodology hub shows five cards, the SPR explainer first, and clicking it lands on /methodology/spr."
    - "No methodology surface renders the display label BPR any more; the compare note, the hub blurb and the Sigma page prose all read SPR."
    - "The internal algorithm id is still the literal string bpr, so every published artifact still resolves and the algorithm dropdown still reads BPR."
    - "The SPR page states the alliance-attribution, who-you-play-with and foul-adjustment reasons SPR is not a solo score, and says explicitly that three teammates' SPRs do not sum."
  artifacts:
    - apps/web/src/components/methodology/sprContent.ts
    - apps/web/src/components/methodology/sprContent.test.ts
    - apps/web/src/components/methodology/SprPage.tsx
    - apps/web/src/routes/methodology.spr.tsx
    - apps/web/src/routes/methodology.spr.test.tsx
  key_links:
    - "METHODOLOGY_CARDS array order <-> MethodologyCards.tsx positional destructure <-> methodologyCardData.test.ts equality pin. All three move together or the hub renders the wrong blurb under the wrong title with every test green."
    - "MethodologyCardDescriptor.to union <-> routeTree.gen.ts. The typed Link will not compile against a stale generated route tree, so the tree must be regenerated before typecheck."
    - "sprContent.ts <-> BPR_PARAMS in packages/core/algorithms/bpr.ts. The rank weights are derived at module evaluation, never hand typed, so the page cannot drift from the shipped model."
---

<objective>
Rename the user-visible label BPR to SPR (Sigma Power Rating) on SigmaScout's methodology
surfaces, and add a new `/methodology/spr` page that states precisely what the number is.

Purpose: the site's premier rating had an internal-sounding name on the pages meant to
explain it, and nowhere on the site said what the number actually measures. This closes both.

Output: a new methodology page (content module + page component + route + two test files),
a fifth hub card, and a display-label rename across four existing methodology surfaces with
every pinning test moved in the same commit.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Load before writing any UI: `Skill("sketch-findings-sigmascout")` — its
`references/uncertainty-display.md` governs how an interval is described, and its
green-is-ink-not-paint rule governs the one link this page adds.

Read as the pattern to follow (content-as-data + page component + thin route + two tests):
@apps/web/src/components/methodology/sigmaContent.ts
@apps/web/src/components/methodology/SigmaPage.tsx
@apps/web/src/routes/methodology.sigma.tsx
@apps/web/src/routes/methodology.sigma.test.tsx
@apps/web/src/components/methodology/methodologyCardData.ts
@apps/web/src/components/methodology/MethodologyCards.tsx

Read for the in-prose `<Link>` pattern (DOM, not a prose string):
@apps/web/src/components/methodology/AcknowledgmentsPage.tsx

Read for the facts the new page states (verify each one yourself before writing it):
@packages/core/algorithms/bpr.ts
</context>

<blocking_discovery>
## READ THIS FIRST — the tree was mid-rename when this plan was written

At planning time (2026-09-10) **another concurrent session had an uncommitted
Swing -> Sigma rename in flight** across exactly the files this task touches. `git status`
showed staged deletes of `swingContent.ts` / `SwingPage.tsx` / `methodology.swing.tsx`,
untracked `sigmaContent.ts` / `SigmaPage.tsx` / `methodology.sigma.tsx`, an unstaged edit to
`methodologyCardData.ts`, and `apps/web` typecheck RED with three errors, all of them
belonging to that rename and none to this task:

- `methodologyCardData.test.ts(62,56)` still compares against `/methodology/swing`
- `methodology.swing.test.tsx(27,8)` and `(28,54)` import modules that no longer exist

Consequences you must act on:

1. **The file list in the original task description is stale.** `swingContent.ts` and
   `methodology.swing.test.tsx` no longer exist. Their BPR occurrences now live in
   `sigmaContent.ts`, `sigmaContent.test.ts` and `methodology.sigma.test.tsx`, and the
   prose is DIFFERENT and longer than the description quotes. Grep, do not trust the quotes.
2. **Never stage with `git add -A` or `git add .` in this task.** This repo has a recorded
   incident (`f0c7af48`) where a commit absorbed a concurrent session's edits. Stage by
   explicit path, every time.
3. **A red baseline typecheck is expected.** Do not attribute those three errors to your own
   work, and do not "fix" the Swing -> Sigma rename beyond what Task 1 explicitly assigns.
</blocking_discovery>

<naming_note>
`Sigma Score` is the per-team consistency number the concurrent session is renaming to right
now (published for the `bpr` id only). `SPR` / `Sigma Power Rating` is the RATING itself.
They now share a word, so the hub will carry both "Sigma Score and the match band" and the
new SPR card. Task 2 therefore gives the new page a short dedicated section that says in
plain words that these are two different numbers and links to `/methodology/sigma`. That
disambiguation is required content, not scope creep.
</naming_note>

<tasks>

<task type="tracer">
  <name>Task 1: End to end /methodology/spr — one path through every layer</name>
  <precondition>The concurrent Swing -> Sigma rename is committed. Assert `git status --short -- apps/web/src/components/methodology apps/web/src/routes` prints nothing AND `git ls-files --error-unmatch apps/web/src/components/methodology/sigmaContent.ts` succeeds. If either fails, HALT and report that another session holds these files — do not proceed, do not commit around it, do not revert their work.</precondition>
  <files>apps/web/src/components/methodology/sprContent.ts, apps/web/src/components/methodology/SprPage.tsx, apps/web/src/routes/methodology.spr.tsx, apps/web/src/routes/methodology.spr.test.tsx, apps/web/src/components/methodology/methodologyCardData.ts, apps/web/src/components/methodology/MethodologyCards.tsx, apps/web/src/components/methodology/methodologyCardData.test.ts</files>
  <read_first>apps/web/src/components/methodology/sigmaContent.ts (module shape and header discipline only — do NOT copy its dash ban, see below), apps/web/src/components/methodology/SigmaPage.tsx (its final exported section-renderer function, the last ~25 lines), apps/web/src/routes/methodology.sigma.tsx (whole file, 25 lines), apps/web/src/routes/methodology.sigma.test.tsx (the renderMethodology* route-tree harness), apps/web/src/components/methodology/methodologyCardData.ts, apps/web/src/components/methodology/MethodologyCards.tsx, apps/web/src/components/methodology/methodologyCardData.test.ts</read_first>
  <action>
Wire ONE path from content data through the page component and the route to the hub card,
proven by a rendered-DOM test. Content is deliberately thin here — Task 2 fills it in.

Create `sprContent.ts` exporting, in the shape `sigmaContent.ts` establishes:
`SPR_PAGE_TITLE` (use the string `What SPR measures`), `SPR_LEAD`, a `SprSection` interface
with `id` / `heading` / `paragraphs`, an `SPR_SECTION_IDS` tuple `as const`, a `SprSectionId`
type, and `SPR_SECTIONS`. For this task ship exactly ONE section, id `what-the-number-is`,
carrying the lead framing from the fact list in Task 2. Give the module a header doc comment
that names this quick task id and explains that the runtime gates in `sprContent.test.ts`
read exported VALUES and never grep this file's source, which is why the comment may freely
discuss the internal id and the retired figure the page itself must not state.

CRITICAL — do NOT copy the Sigma page's voice gate. `sigmaContent.ts` bans the hyphen-minus,
the en dash and the em dash outright, because the person who commissioned THAT page asked for
no hyphens. This page has no such requirement and needs hyphenated compounds to be accurate
(`foul-adjusted`, `least-squares`). Do not add a dash gate to `sprContent.test.ts`, and do not
copy the dash assertions from `methodology.sigma.test.tsx` into `methodology.spr.test.tsx`.

Create `SprPage.tsx`: a default-free named export `SprPage()` that renders `SPR_LEAD` as a
lead paragraph and maps `SPR_SECTIONS` to `<section id={...}>` with an `h2` heading and one
`p` per paragraph, using the exact Tailwind token classes `SigmaPage.tsx`'s own section
renderer uses (`max-w-[72ch] text-role-body text-[var(--color-text-primary)]`, gap via
`var(--spacing-*)`). This page has NO SVG figures — prose only.

Create `methodology.spr.tsx` mirroring `methodology.sigma.tsx` exactly: `createFileRoute("/methodology/spr")`,
an `h1` carrying `SPR_PAGE_TITLE`, the same `mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]`
container. No loader, no query, no fetch — the page is static.

Add the fifth card to `METHODOLOGY_CARDS` in FIRST position (it is the most fundamental
explainer, so it reads first): `to: "/methodology/spr"`, `title: "What SPR measures"`,
`blurb` a one-liner on what the number is, `testId: "methodology-card-spr"`. Widen the
`MethodologyCardDescriptor.to` union with `"/methodology/spr"`. Extend the array's existing
ORDER-IS-LOAD-BEARING doc comment to say the hub now shows five cards with the SPR explainer
first. Keep the title free of regex metacharacters — `methodology.index.test.tsx` builds a
`RegExp` straight from it, and `What SPR measures` is already safe.

In `MethodologyCards.tsx`: prepend `sprCard` to the positional destructure and its undefined
guard, add its `<Link>` block first, copying the sibling blocks verbatim. Change the grid from
`sm:grid-cols-2 lg:grid-cols-4` to `sm:grid-cols-2 lg:grid-cols-3`, and record the reason in
that file's existing grid comment: five across a 1200px container leaves each blurb about the
same ~25-character width the existing comment already rejected at the md step, so the ladder
goes one / two / three and the last row carries two. Update that comment's "four cards" phrasing.

In `methodologyCardData.test.ts`: put `/methodology/spr` first in `EXPECTED_CARD_ORDER`,
change the "four hub cards" test name to five, and fix the positional assertions — the Sigma
card is now index 3, not 2. If the concurrent session left line ~62's `find(card => card.to === ...)`
still pointing at the retired swing path, repoint it at `/methodology/sigma` as part of this
task; it is the same file and leaving it red is not an option.

Create `methodology.spr.test.tsx` using the `renderMethodologySigma`-style harness from
`methodology.sigma.test.tsx` (real exported `Route`, `createRootRoute` with `RootSearchSchema`,
`createMemoryHistory`). For this task assert only: the `h1` carries `SPR_PAGE_TITLE`, the lead
renders, and the one section's heading and paragraphs render. Do NOT copy that file's dash
describe block.
  </action>
  <verify>
    <automated>cd apps/web &amp;&amp; npx vite build 2>&amp;1 | tail -5; cd .. &amp;&amp; cd .. &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json; npx vitest run apps/web/src/components/methodology/methodologyCardData.test.ts apps/web/src/routes/methodology.index.test.tsx apps/web/src/routes/methodology.spr.test.tsx</automated>
    <note>The `vite build` step is NOT optional and NOT cosmetic: `apps/web/src/routeTree.gen.ts` is gitignored and regenerated by the TanStack router plugin at build time. Until it is regenerated it does not know `/methodology/spr` exists, and the typed `Link to` will not compile. Run vitest from the REPO ROOT with `npx vitest run`, never `timeout ... pnpm ...` — that form swallows output and exits 0 on failure. Read the printed results; do not trust the exit code.</note>
  </verify>
  <done>`/methodology/spr` renders its own h1 and lead through the real exported Route; the hub shows five cards with SPR first and its link resolves to `/methodology/spr`; `apps/web` typecheck reports zero errors; all three named test files pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fill in what SPR actually measures, with gates that keep it true</name>
  <files>apps/web/src/components/methodology/sprContent.ts, apps/web/src/components/methodology/sprContent.test.ts, apps/web/src/components/methodology/SprPage.tsx, apps/web/src/routes/methodology.spr.test.tsx</files>
  <read_first>packages/core/algorithms/bpr.ts — the module header (lines ~30 to ~80), `displaySdFactor`'s doc comment and `BPR_PARAMS` (lines ~120 to ~200), the rank-weighting doc comment (lines ~427 to ~455), the weighting and credit-allocation code (lines ~473 to ~517 and ~618 to ~640), and `teamMetrics` (lines ~828 to ~850). Also `apps/web/src/components/methodology/AcknowledgmentsPage.tsx` for the in-prose `<Link>` pattern, and `apps/web/src/components/districts/districtLocksHeaderStats.ts` line 49 for this repo's relative import path into `packages/core`.</read_first>
  <behavior>
    - `sprContent.test.ts` pins `SPR_SECTIONS.map(s => s.id)` BY EQUALITY against a hand-typed array of the six ids. An added or removed section fails loudly rather than being absorbed by a loop (this repo's recorded iteration-list trap).
    - `sprContent.test.ts` asserts `SPR_SECTION_IDS` equals that same hand-typed array.
    - `sprContent.test.ts` asserts every section has a non-blank heading and at least one non-blank paragraph.
    - A fact gate asserts the joined prose contains the phrase for each of: points per match, foul adjustment, the three-copies framing, non-additivity versus OPR, and the absence of a ranking-point model.
    - A liability gate asserts no exported string value contains the digits of the retired sealed holdout figure, and none contains the old display label. Both run over VALUES, never over source text.
    - A derivation gate asserts the rank-weight sentence contains the weights recomputed in the test from `BPR_PARAMS`, so the prose cannot drift from the shipped model.
    - `methodology.spr.test.tsx` asserts every section heading and paragraph reaches the DOM, and that a link to `/methodology/compare` is present.
  </behavior>
  <action>
Expand `SPR_SECTIONS` from one section to six, in this exact order, with these exact ids:
`what-the-number-is`, `not-a-solo-score`, `why-three-do-not-add-up`, `the-displayed-interval`,
`spr-and-sigma-score-are-different`, `what-it-does-not-do`. Write the headings in the site's
plain register. Audience is FRC students and mentors: plain language first, precise second.

Every claim below is verified against `packages/core/algorithms/bpr.ts` at HEAD. Confirm each
one in the source yourself before writing it, then state it precisely.

- **what-the-number-is.** The published value is `(muL + muS) * unit` where `unit = state.scale / 3`
  and `scale` is the online estimate of mean FOUL-ADJUSTED alliance output in points. So SPR is
  a team's expected contribution to its alliance's foul-adjusted score, in points per match.
  Lead with the exact framing: a team's SPR is one third of what an alliance of three copies of
  that robot would score. That is exact rather than an analogy — the rank weights are
  renormalized to sum to 3 by construction, so three identical ratings collapse to three times
  the value. Say so.

- **not-a-solo-score.** Three distinct reasons, all three stated.
  (a) It is an attribution of alliance totals and never a solo observation. FRC records no
  per-robot score. Credit for an alliance's surprise is split so that each team absorbs a share
  proportional to its own remaining uncertainty times its expected-rank weight — an uncertain
  team moves more, and a team the model expects to contribute less absorbs less.
  (b) A team's points contribution depends on who it is with. Within an alliance the teams are
  ranked and the largest weight is matched to the largest rating, so the same robot contributes
  more as its alliance's strongest member than as its weakest. This is a SPREAD AMPLIFIER: a
  star plus two weak partners is predicted to outscore three mediocre robots of the same total
  rating. Quote the corrected behaviour in that doc comment, not the superseded claim the
  comment records having replaced.
  (c) It is foul adjusted. Foul points and the scorekeeper's manual `adjustPoints` correction
  are both subtracted from the scoring target, so SPR is robot output rather than scoreboard
  output.

  DERIVE the three weights, never hand type them. Import `BPR_PARAMS` from
  `packages/core/algorithms/bpr.js` using the same relative-path form the rest of `apps/web`
  already uses. Compute the normalized weights at module evaluation as `[1, w2, w3]` each
  scaled by `3 / (1 + w2 + w3)`, and interpolate the rounded values into the paragraph with a
  template literal. Add a doc comment stating why, pointing at the same never-retype-a-shipping-
  constant discipline `SigmaPage.tsx` already documents.

- **why-three-do-not-add-up.** SPR is not an additive decomposition: three teammates' SPRs do
  not sum to the predicted alliance score. Call out that this is the deliberate difference from
  OPR, whose least-squares definition is precisely that they do sum, because an FRC reader will
  arrive assuming OPR semantics.

- **the-displayed-interval.** The displayed plus-or-minus is calibrated separately from the
  filter's internal variance. The filter's own variance runs about twice its realized variance,
  so the raw filter number is not what ships. Describe that in words; do not transcribe the
  fitted coefficients, which are not exported and would be a maintenance liability. Follow the
  `sketch-findings-sigmascout` skill's uncertainty-display rules for how the interval is
  described in prose.

- **spr-and-sigma-score-are-different.** Short. SPR is the rating — how much a team is expected
  to contribute. Sigma Score is a separate per-team number about how much that contribution
  moves between matches, and it is published for this rating only. Same first word, different
  questions. Render a `<Link to="/methodology/sigma">` for the cross reference.

- **what-it-does-not-do.** SPR carries no ranking-point model, so it emits no RP probability
  mass function and cannot drive the rank simulation. State that this is a deliberate scope
  boundary rather than an omission. For how well it actually predicts, render a
  `<Link to="/methodology/compare">` and say the measured numbers live there.

  HARD CONSTRAINT: do not state 78.05% or any other accuracy percentage on this page. That
  figure describes a revision of the model that predates the 2026-09-10 interval-calibration
  and scoring-target changes; the live version is 3.0.0. Transcribed numbers here are a
  liability across republishes. Link instead.
  <!-- planner-discipline-allow: 78.05 -->
  <!-- planner-discipline-allow: BPR -->

In `SprPage.tsx`, render the two cross-reference links as DOM rather than as prose strings —
the same split `AcknowledgmentsPage.tsx` documents — styled
`text-[var(--color-accent)] underline underline-offset-2`. Accent IS correct here, unlike on
the Sigma page: these are genuinely clickable, and green-is-ink-not-paint bans green fills,
not green link text. Attach each link to its own section by id so the "every paragraph renders"
loop stays simple.

Create `sprContent.test.ts` implementing the `<behavior>` gates, modelled on
`sigmaContent.test.ts`'s structure-by-equality plus runtime-voice split — MINUS its dash gate.
Give it a header comment stating that the gates run over exported VALUES and never as a source
grep, which is exactly what lets this test file and the content module's own comments discuss
the internal id and the retired figure in prose while the page itself states neither.

Extend `methodology.spr.test.tsx` to loop `SPR_SECTIONS` asserting each `h2` and each paragraph
reaches the DOM, to assert the rendered body text states neither the retired figure's digits nor
the old display label, and to assert a link whose href path is `/methodology/compare` is present.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/methodology/sprContent.test.ts apps/web/src/routes/methodology.spr.test.tsx; npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <note>Repo root, `npx vitest run`. Read the printed pass/fail lines; a green exit code alone is not evidence.</note>
  </verify>
  <done>Six sections render with all their paragraphs; the rank-weight sentence's numbers are recomputed from `BPR_PARAMS` by the test and match; the page states no accuracy percentage and no occurrence of the old display label in any rendered text; both cross-reference links resolve; typecheck clean.</done>
</task>

<task type="auto">
  <name>Task 3: Rename the display label on the four existing methodology surfaces</name>
  <files>apps/web/src/components/methodology/methodologyCardData.ts, apps/web/src/components/methodology/sigmaContent.ts, apps/web/src/components/methodology/sigmaContent.test.ts, apps/web/src/components/compare/MethodologyNote.tsx, apps/web/src/routes/methodology.sigma.test.tsx, apps/web/src/routes/methodology.compare.test.tsx</files>
  <read_first>Run `grep -rn "BPR" apps/web/src/components/methodology apps/web/src/components/compare apps/web/src/routes/methodology.*` first and work from THAT list, not from any list in this plan — the concurrent Swing -> Sigma rename moved several of these and reworded the prose.</read_first>
  <action>
Change DISPLAY LABELS ONLY, and move every test that pins a changed string in this same task.
Never in a follow-up.

Source changes:
- `methodologyCardData.ts`: the compare card's blurb, `How BPR's predictions score against OPR
  and EPA, season by season.` — swap the label for SPR.
- `sigmaContent.ts`: the `what-a-big-sigma-means` paragraph that reads "The site publishes three
  ratings, OPR, EPA and BPR. Sigma is worked out for BPR only..." names the label twice. Swap
  both. Grep the file rather than trusting this quote; the paragraph is long and was reworded
  by the concurrent rename.
- `sigmaContent.ts` header doc comment (near line 4) mentioning that Sigma shipped for BPR:
  reword to say it shipped for the SPR rating, and note parenthetically that the published id
  is still the literal `bpr`. A doc comment is exactly where that reconciliation belongs.
- `MethodologyNote.tsx` line ~202, the `bestClause` template: `... is BPR's single best season
  of the ...` becomes SPR.
- `MethodologyNote.tsx` line ~71, the `PREMIER_ALGORITHM_ID` doc comment "which became BPR on
  2026-09-09": reword so it stays historically accurate — the id became `bpr` on 2026-09-09 when
  the prior premier rating left the published set, and the label displayed on methodology pages
  became SPR on 2026-09-10. Leave `const PREMIER_ALGORITHM_ID = "bpr"` untouched.

Test changes, same task:
- `sigmaContent.test.ts`: the test named around "names OPR, EPA and BPR" and its
  `["OPR", "EPA", "BPR"]` array. Update both the name and the array.
- `methodology.sigma.test.tsx`: the same pair.
- `methodology.compare.test.tsx`: the `it(...)` test NAME around line 330 carries the label in
  its description. Update names and any explanatory comments that refer to the DISPLAY label.
  Where a comment refers to the artifact id or a historical quick task, leave it, or say
  `the bpr artifact` so it stays true.
- `MethodologyNote.test.tsx`: grep it. Planning found no literal pin on the changed sentence
  there, but confirm before assuming.

DO NOT TOUCH, all three deliberate:
1. The internal id stays the literal string `bpr` everywhere — `PUBLISHED_ALGORITHM_IDS` in
   `packages/harness/publishedAlgorithms.ts`, `DEFAULT_ALGORITHM` in `apps/web/src/lib/searchParams.ts`,
   `apps/web/src/lib/metricKeys.ts`, `apps/web/src/components/teams-table/columns.tsx`. It is the
   R2 artifact key; renaming it breaks live lookups.
2. `apps/web/src/components/ribbon/AlgorithmSelect.tsx` and its test. Its label still reads BPR
   and the user decided to leave it that way this pass. Every derived label downstream of it —
   the alliances notice, the insights fallback, the "BPR Rank" column header and their tests —
   therefore stays reading BPR too. Record this deliberate inconsistency in the SUMMARY as the
   obvious follow-up. Do not fix it.
3. Non-methodology comments mentioning the label as project history (`MetricValue.tsx`,
   `rowModel.ts`, `columns.tsx`, `calibrationSeries.test.ts`, `compare.compat.test.ts`,
   `index.test.tsx`, the event tab tests, `SeasonHeader.*`, `ElimsTab.test.tsx`).

Stage by explicit path. Do not run `git add -A` or `git add .` — another session's work may be
in this tree.
  </action>
  <verify>
    <automated>grep -rn "BPR" apps/web/src/components/methodology apps/web/src/components/compare apps/web/src/routes/methodology.compare.test.tsx apps/web/src/routes/methodology.sigma.test.tsx | grep -vE ':[0-9]+: *(\*|//|/\*)' ; echo "---exit $? (1 means no matches, which is the pass)---" ; npx vitest run apps/web/src/components/methodology apps/web/src/components/compare/MethodologyNote.test.tsx apps/web/src/routes/methodology.sigma.test.tsx apps/web/src/routes/methodology.compare.test.tsx apps/web/src/routes/methodology.index.test.tsx apps/web/src/routes/methodology.spr.test.tsx ; npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <note>The grep gate filters doc-comment lines before counting, because comments legitimately retain the old label when explaining the id or the history. A bare unfiltered grep would fail on prose that is correct. `methodology.compare.test.tsx` takes roughly 28 seconds on its own; that is normal, not a hang.</note>
  </verify>
  <done>No non-comment line under the methodology or compare component trees renders the old display label; the compare note's best-season sentence, the hub blurb and the Sigma page prose all read SPR; `AlgorithmSelect.tsx` is unmodified (`git diff --stat` shows it absent); the internal id is still `bpr` everywhere; every named test file passes and `apps/web` typecheck is clean.</done>
</task>

</tasks>

<verification>
Run from the REPO ROOT, in this order:

1. `cd apps/web && npx vite build` — regenerates the gitignored `routeTree.gen.ts` so the new
   route exists for the type system. Not optional.
2. `npx tsc --noEmit -p apps/web/tsconfig.json` — the root `tsc --noEmit` does NOT cover
   `apps/web` and will report clean over real web errors. Zero errors expected at the end;
   note that three pre-existing errors from the concurrent rename may be present at the START.
3. `npx vitest run apps/web/src/components/methodology apps/web/src/components/compare apps/web/src/routes/methodology.compare.test.tsx apps/web/src/routes/methodology.sigma.test.tsx apps/web/src/routes/methodology.index.test.tsx apps/web/src/routes/methodology.spr.test.tsx`
   Repo root, `npx vitest run`. Never `timeout ... pnpm ...`. Verify by reading the printed
   results, not the exit code.
4. `git diff --stat` — confirm `AlgorithmSelect.tsx`, `publishedAlgorithms.ts`, `searchParams.ts`,
   `metricKeys.ts` and `columns.tsx` are ABSENT from the diff.
</verification>

<success_criteria>
- `/methodology/spr` exists, renders six sections, and is reachable from the hub's first card.
- The page states what SPR is in points per match, the three reasons it is not a solo score,
  the non-additivity versus OPR, the separately calibrated interval, the Sigma Score
  disambiguation, and the absent ranking-point model.
- The page states no accuracy percentage and links to `/methodology/compare` instead.
- The rank weights in the prose are computed from `BPR_PARAMS`, not typed by hand.
- No methodology or compare surface renders the old display label outside a doc comment.
- The internal id `bpr` is unchanged; `AlgorithmSelect.tsx` is untouched.
- `apps/web` typecheck clean; all named test files pass.
- Three atomic commits, staged by explicit path.
</success_criteria>

<output>
Create `.planning/quick/260910-vof-rename-bpr-to-spr-on-methodology-pages-a/260910-vof-SUMMARY.md` when done.

The SUMMARY must record, as explicit follow-ups:
1. `AlgorithmSelect.tsx` still labels the ribbon dropdown BPR, deliberately, so every label
   derived from it (alliances notice, insights fallback, teams-table "BPR Rank" header) still
   reads BPR. The site is knowingly inconsistent until that is done.
2. Whether the concurrent Swing -> Sigma rename was committed by its own session before this
   task started, and whether any of its files were touched here.
</output>
</content>
</invoke>
