---
quick_id: 260905-phf
type: execute
mode: quick
wave: 1
depends_on: []
autonomous: false
requirements:
  - QT-260905-phf
files_modified:
  - apps/web/src/routes/methodology.tsx
  - apps/web/src/routes/methodology.index.tsx
  - apps/web/src/routes/methodology.index.test.tsx
  - apps/web/src/routes/methodology.vpr.tsx
  - apps/web/src/routes/methodology.vpr.test.tsx
  - apps/web/src/routes/methodology.compare.tsx
  - apps/web/src/routes/methodology.compare.test.tsx
  - apps/web/src/routes/compare.tsx
  - apps/web/src/routes/compare.test.tsx
  - apps/web/src/routeTree.gen.ts
  - apps/web/src/components/methodology/methodologyCards.ts
  - apps/web/src/components/methodology/MethodologyCards.tsx
  - apps/web/src/components/methodology/vprGuideContent.ts
  - apps/web/src/components/methodology/VprGuide.tsx
  - apps/web/src/components/ribbon/Ribbon.tsx
  - apps/web/src/components/ribbon/Ribbon.test.tsx
  - apps/web/e2e/compare-narrow-legibility.spec.ts

estimate:
  tokens: 180000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The third ribbon link reads 'Methodology' and lands on a guide page of cards, not on the accuracy tables."
    - "One card opens a plain-language 'Intro to VPR' page whose full explanatory prose is written and shipped, not stubbed."
    - "A second card opens the accuracy-comparison page whose rendered content is identical to what /compare rendered before this task."
    - "An existing shared or bookmarked /compare URL still reaches the accuracy-comparison content."
    - "Every claim on the Intro to VPR page is traceable to a named source file in this repo; the page states no numeric accuracy figure of its own."
  artifacts:
    - apps/web/src/routes/methodology.tsx
    - apps/web/src/routes/methodology.index.tsx
    - apps/web/src/routes/methodology.vpr.tsx
    - apps/web/src/routes/methodology.compare.tsx
    - apps/web/src/components/methodology/vprGuideContent.ts
    - apps/web/src/components/methodology/methodologyCards.ts
  key_links:
    - "Ribbon.tsx NAV_LINKS[2] -> /methodology (label 'Methodology'), replacing the /compare + 'Compare' entry"
    - "methodology.index.tsx cards -> /methodology/vpr and /methodology/compare, both typed Links against the regenerated routeTree.gen.ts"
    - "compare.tsx redirect -> /methodology/compare, search params carried through"
    - "vprGuideContent.ts section constants -> methodology.vpr.test.tsx assertions (test iterates the constant, never a hand-typed second copy)"
---

<objective>
Turn the third ribbon slot from a link to the accuracy tables into a link to a
**Methodology guide hub**: a card page that points at the pages explaining how
SigmaScout works. Ship two real destinations behind it — the existing Compare
page moved intact to `/methodology/compare`, and a newly written **Intro to VPR**
explainer at `/methodology/vpr` aimed at a high-school FRC audience.

Purpose: the accuracy tables are one piece of methodology, not the whole of it.
The site currently has no page that answers "what is this VPR number and what
does the ± mean?" — the question every student, mentor and scout asks first.

Output: four routes (`/methodology` layout, hub index, `/methodology/vpr`,
`/methodology/compare`), a `/compare` redirect that keeps already-shared links
alive, a renamed ribbon link, and the finished VPR explainer prose.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./.claude/CLAUDE.md

**Load before writing ANY markup:** `Skill("sketch-findings-sigmascout")` — the
pine palette (dark green ribbon, white surfaces, green is ink not paint), the
uncertainty/interval display rules, and the card/typography craft rules this
task's two new pages must obey.

Read-first for patterns (do not re-read after extracting the pattern):
@apps/web/src/routes/districts.tsx
@apps/web/src/components/ribbon/Ribbon.tsx
@apps/web/src/components/compare/CalibrationSection.tsx
</context>

<source_audit>

Quick mode: the single source is the task description. No ROADMAP goal,
REQUIREMENTS ids, RESEARCH.md or CONTEXT.md decisions exist for this task.

| # | Source item (verbatim intent) | Covered by |
|---|---|---|
| 1 | Rename the Compare tab/ribbon link to "Methodology" | Task 1 |
| 2 | The Methodology route becomes a guide page with cards linking to several pages | Task 1 |
| 3 | Page (1): exactly what the Compare page is right now, moved to its own route, linked from a card | Task 1 |
| 4 | Page (2): new "Intro to VPR" page, high level, high-school FRC audience | Task 1 (route + shell), Task 2 (full prose) |
| 5 | The Intro to VPR content must actually be written, not stubbed | Task 2 |
| 6 | Follow existing page/route patterns; load the sketch-findings skill first | Task 1 and Task 2 `<action>`s; `<context>` above |
| 7 | Ground the explainer in what the codebase actually says about VPR; invent no mechanics | Task 2 (fixed claim list with per-claim source file) |

No item is MISSING. No item is deferred.
</source_audit>

<routing_decision>

**Route naming, decided here so the executor does not re-litigate it mid-task:**

| URL | File | Role |
|---|---|---|
| `/methodology` | `routes/methodology.tsx` | Layout route. Renders `<Outlet />` and nothing else — no heading, no chrome, so it adds nothing visible to its children. |
| `/methodology` (index child) | `routes/methodology.index.tsx` | The guide hub: heading + card grid. |
| `/methodology/vpr` | `routes/methodology.vpr.tsx` | Intro to VPR. |
| `/methodology/compare` | `routes/methodology.compare.tsx` | Today's Compare page, moved. |
| `/compare` | `routes/compare.tsx` | Redirect to `/methodology/compare`, search params preserved. |

Why a layout route plus an index child rather than a bare `methodology.index.tsx`:
this repo's flat route files (`event.$eventKey.tsx` with no `event.tsx`) attach
directly to root, so the plugin never synthesises a parent. Introducing
`methodology.vpr.tsx` alongside a hub file makes `methodology.tsx` the parent by
the plugin's own flat-nesting rule — so the parent is authored deliberately as a
pass-through layout, and the hub's own content lives in the index child. This is
the idiomatic TanStack Router shape and makes `to="/methodology"` a valid typed
target for the ribbon.

Why `/compare` survives as a redirect rather than being deleted: the site is
public and `/compare` has been shareable since Phase 8. A four-line redirect
costs nothing and keeps every already-shared link landing on the same content.

Why the moved files need no import-path edits: flat route naming keeps
`methodology.compare.tsx` in the SAME `src/routes/` directory as `compare.tsx`,
so every `../lib/...` and `../../../../packages/...` specifier stays correct.
</routing_decision>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end "Methodology ribbon link reaches all three pages" — routes, hub cards, compare move, redirect</name>
  <files>
    apps/web/src/routes/methodology.tsx,
    apps/web/src/routes/methodology.index.tsx,
    apps/web/src/routes/methodology.index.test.tsx,
    apps/web/src/routes/methodology.vpr.tsx,
    apps/web/src/routes/methodology.compare.tsx,
    apps/web/src/routes/methodology.compare.test.tsx,
    apps/web/src/routes/compare.tsx,
    apps/web/src/routes/compare.test.tsx,
    apps/web/src/routeTree.gen.ts,
    apps/web/src/components/methodology/methodologyCards.ts,
    apps/web/src/components/methodology/MethodologyCards.tsx,
    apps/web/src/components/ribbon/Ribbon.tsx,
    apps/web/src/components/ribbon/Ribbon.test.tsx,
    apps/web/e2e/compare-narrow-legibility.spec.ts
  </files>
  <read_first>
    `apps/web/src/routes/districts.tsx` (the fourth-ribbon-page precedent, commit b67ec75a),
    `apps/web/src/components/ribbon/Ribbon.tsx` and its test,
    `apps/web/src/components/compare/CalibrationSection.tsx` (its `.event-card ... shadow-sm` card and `grid gap-[var(--spacing-md)] md:grid-cols-3` grid are the card pattern to mirror),
    `apps/web/src/routeTree.gen.ts` (to see the generated shape before regenerating it).
  </read_first>
  <action>
Load `Skill("sketch-findings-sigmascout")` FIRST, before writing any markup.

Wire one path — ribbon slot three through the layout route to each of the three
destinations — so the whole structure is proven before any prose is written.

**1. Move the Compare page (a rename, not a rewrite).**
Use `git mv apps/web/src/routes/compare.tsx apps/web/src/routes/methodology.compare.tsx`
and `git mv apps/web/src/routes/compare.test.tsx apps/web/src/routes/methodology.compare.test.tsx`.
In the moved route change exactly one expression: the `createFileRoute` argument
becomes the new path. Leave every import, every component, every comment and the
`<h1>` text untouched — the rendered page must be identical to today's. In the
moved test, update the import specifier to the renamed module and the three
places the old path string appears in `renderCompareRoute` (route `id`, route
`path`, and the memory-history entry).

Project memory warning that applies here: a `git mv` performed after an unstaged
edit can silently commit the file without the edit. Run `git status` after
committing the renamed files and confirm both moves plus their content changes
landed.

**2. Author the layout route.** `methodology.tsx` exports a `createFileRoute`
route whose component renders `<Outlet />` alone. Give it a doc comment saying it
exists only so the plugin nests the three children, and that it must never grow
a heading or a container — page chrome belongs to each child.

**3. Author the hub.** `methodologyCards.ts` exports a readonly array of card
descriptors, each carrying `to`, `title`, `blurb` and `testId`. `MethodologyCards.tsx`
maps it to a `grid gap-[var(--spacing-md)] md:grid-cols-2` of whole-card
`<Link>` elements wearing the `.event-card` class plus `shadow-sm` and
`p-[var(--spacing-md)]`, with a hover that changes border or shadow only — no
green fill, per the skill's green-is-ink rule. Each `Link` passes search params
through with the same updater-identity pattern `Ribbon.tsx`'s `preserveSearch`
uses. Note in a comment that the typed `to` prop needs per-route literals, so
if mapping over the descriptor union loses overload resolution, write the two
`<Link>` elements explicitly and keep the constant as the single source of
titles and order — exactly the tradeoff `Ribbon.tsx`'s `NavLinks` already
documents.

`methodology.index.tsx` renders the page container used by every other route
(`mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]`), an `<h1>` with
`text-role-heading` reading "Methodology", one short muted `text-role-body` lede
sentence saying these pages explain how SigmaScout's numbers are produced and
measured, then `<MethodologyCards />`. It fetches nothing.

The two cards, in this order:
  - "Intro to VPR" -> `/methodology/vpr`. Blurb: what VPR is and what the ±
    beside it means, in plain language.
  - "Algorithm accuracy" -> `/methodology/compare`. Blurb: how VPR's predictions
    score against OPR and EPA, season by season.

**4. Create the VPR route shell.** `methodology.vpr.tsx` gets the same page
container, an `<h1>` reading "Intro to VPR", and renders `<VprGuide />` imported
from `apps/web/src/components/methodology/VprGuide.tsx`. Create `VprGuide.tsx`
and `vprGuideContent.ts` in this task only as far as needed to make the route
render and typecheck — Task 2 writes their real content and is the task that
owns the prose. Do not describe the shell as a version, a placeholder or a
future enhancement in any comment; it is one commit's worth of scaffolding
inside a plan that finishes it.

**5. Redirect `/compare`.** Rewrite `routes/compare.tsx` as a route whose
`beforeLoad` throws `redirect({ to: "/methodology/compare", replace: true })`
carrying the current search params forward. If the cross-route search typing
resists, reuse the narrow local `as never` escape hatch `Ribbon.tsx`'s
`preserveSearch` already documents, and cite that precedent in a comment.

**6. Rename the ribbon link.** In `Ribbon.tsx`, `NAV_LINKS[2]` becomes
`{ to: "/methodology", label: "Methodology" }`. Update the corresponding explicit
`<Link>` element and every comment naming the canonical link order. Check the
mobile branch still fits four links at 390px with the existing
`gap-[var(--spacing-md)]`; the new label is longer than "Compare", so if it
overflows, shrink the gap rather than hiding a link. Update `Ribbon.test.tsx`:
the stub route path and label, and each expected link-order array.

**7. Regenerate and confirm.** Run the web build so the router plugin rewrites
`routeTree.gen.ts`, then read the regenerated file and confirm the four new
`fullPath` entries are what the `Link` props above assume. If the generated
strings differ from the assumption, change the `Link` props to match the
generated tree — never hand-edit `routeTree.gen.ts`.

**8. E2E const.** In `apps/web/e2e/compare-narrow-legibility.spec.ts`, point
`COMPARE_URL` at the new path so the spec exercises the route directly instead
of a redirect hop.

Write `methodology.index.test.tsx`: render the hub route and assert that, for
every descriptor in the exported constant, a link with that title exists and its
`href` ends with that descriptor's `to`. Iterate the constant — never hand-type a
second copy of the titles.
  </action>
  <verify>
    <automated>cd apps/web &amp;&amp; npx tsc --noEmit -p tsconfig.json &amp;&amp; npx vite build</automated>
    <automated>npx vitest run apps/web/src/routes/methodology.index.test.tsx apps/web/src/routes/methodology.compare.test.tsx apps/web/src/components/ribbon/Ribbon.test.tsx</automated>
    <automated>grep -n "methodology" apps/web/src/routeTree.gen.ts</automated>
  </verify>
  <done>
Typecheck and build pass. The regenerated `routeTree.gen.ts` carries
`/methodology`, `/methodology/vpr` and `/methodology/compare`. The moved Compare
test passes unchanged in substance against the renamed module. The ribbon test
passes with "Methodology" in slot three. The hub test proves both cards render
and point at their routes. `git status` confirms both renames committed with
their edits.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Write the Intro to VPR explainer</name>
  <files>
    apps/web/src/components/methodology/vprGuideContent.ts,
    apps/web/src/components/methodology/VprGuide.tsx,
    apps/web/src/routes/methodology.vpr.test.tsx
  </files>
  <read_first>
    `packages/core/algorithms/sigma1/index.ts` — the module header (lines 1-40) and the
    `teamMetrics` doc comment beginning near line 1560 ("WHAT THE ± IS FOR"). These two
    blocks are the authoritative description of the shipped model.
    `.planning/phases/07-event-pages/07-CONTEXT.md` around line 96 — the D-04 rename.
    `apps/web/src/components/MetricValue.tsx` — props are `{ metric?: { value, spread? } }`,
    pure, no fetch, so it can render a labelled illustration.
  </read_first>
  <behavior>
    - Test 1: rendering the `/methodology/vpr` route shows an `h1` reading "Intro to VPR".
    - Test 2: for every section descriptor exported by `vprGuideContent.ts`, a heading with
      that section's title renders — the test iterates the exported constant, never a
      hand-typed second copy of the titles.
    - Test 3: every section descriptor carries at least one paragraph of body prose, so an
      emptied section fails rather than rendering a bare heading.
    - Test 4: the page renders a link whose `href` ends with the accuracy-comparison route.
  </behavior>
  <action>
Load `Skill("sketch-findings-sigmascout")` first if this task runs in a fresh
context.

Structure the page as content-as-data: `vprGuideContent.ts` exports a readonly
array of section descriptors (`id`, `title`, `paragraphs: readonly string[]`),
and `VprGuide.tsx` maps it to `<section>` elements with `text-role-heading`
titles and `max-w-[72ch] text-role-body` paragraphs, matching
`CalibrationSection.tsx`'s explainer paragraph treatment. This is the same
"derive from a named constant, never a hand-typed second copy" discipline
`MethodologyNote.tsx` and `AccuracyTable.tsx` already follow, and it is what
lets the test in `<behavior>` above be structural rather than brittle.

**Audience and register.** High school students in the FRC community. Short
sentences. No formulas, no Greek letters beyond the ± glyph itself, no jargon
introduced without a plain-language gloss in the same sentence. Assume the reader
knows what a match, an alliance, a qualification ranking and OPR are; assume
nothing else.

**The claim list. Write these and only these mechanics.** Each is followed by the
file that licenses it. Inventing a mechanism not on this list is the one failure
mode this task cannot ship with — this project's failure log already records a
README that described a model which had been deleted.

  1. VPR stands for Variance Power Rating, and it is SigmaScout's own rating.
     (`07-CONTEXT.md` D-04)
  2. A VPR number has two parts: a rating in points, and a ± beside it. They
     answer two different questions. (`sigma1/index.ts` header)
  3. The rating estimates how many points a robot itself contributes. After every
     match, VPR compares what it expected each alliance to score against what
     that alliance actually scored, and nudges each of the three robots'
     estimates toward explaining the difference. It does this separately for each
     part of the game's score breakdown, not just the final total.
     (`sigma1/index.ts` header; `kalman.ts`, `updateAllianceSum`, `distributeResidual`)
  4. The ± is NOT how unsure the site is about the rating. It is how much that
     robot swings from match to match, weighted toward its recent matches. It
     answers one question: is this the same robot every match?
     (`sigma1/index.ts` "WHAT THE ± IS FOR")
  5. Say plainly who that helps, in the source's own framing: an alliance captain
     picking first wants a low ±; a low seed hunting an upset wants a high one; a
     partner mid-qualifications needs to know which they are playing beside.
     (same source)
  6. A team that has played no matches has no swing to summarise, so it shows no
     ± at all. That is an absence of evidence, not a zero. (`sigma1/index.ts` D-Y2)
  7. VPR measures offense only. It has no defense term, on purpose: an alliance's
     final score cannot tell you which robot was being defended. When a robot
     scores less than expected for a reason VPR cannot see, that shows up as a
     wider ±, rather than being credited to a defense number the data cannot
     support. (`sigma1/index.ts` D-06)
  8. At a new season a team starts near where it finished, but VPR treats that
     starting point as less certain, because a team can rebuild completely over
     the off-season. (`packages/core/algorithms/carryover.ts`, `carrySeason`)
  9. VPR's own settings are not hand-picked. An automated search tunes them on
     past seasons, and the result is then scored on seasons the search never saw.
     (`REBUILD_SPEC.md`, "tuned and adjusted automatically";
     `docs/models/sigma1-tuning-results.md`)
 10. Every accuracy number the site publishes comes from predicting each match
     using only what was known before that match was played, then updating.
     Nothing is scored with hindsight. (project methodology constraint in
     `.claude/CLAUDE.md`)
 11. Close with where to check the claim, and link to the accuracy-comparison
     route: VPR is scored head-to-head against OPR and EPA there, season by
     season.

**Two hard prohibitions.**

  - This page states no numeric accuracy figure of its own. No Brier value, no
    accuracy percentage, no season-by-season score. Those are derived from
    fetched artifacts on the accuracy page and would be a hand-typed second copy
    here, free to drift. The closing section links there instead.
  - No claim that VPR is better than any other rating. The accuracy page reports
    the measurement; this page explains the mechanism.

**One illustration is allowed.** A single clearly-labelled example rendering of
`<MetricValue metric={{ value: ..., spread: ... }} />` with a caption naming it as
an illustration and not a real team's numbers, placed in the section that
introduces the ±. Pass literal numbers; render no team name and no season. If
this is at all awkward against the skill's uncertainty-display rules, drop it —
the prose carries the section on its own.

Aim for six to eight sections and roughly 500-800 words total. Long enough to
actually teach, short enough that a student reads it.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/routes/methodology.vpr.test.tsx apps/web/src/routes/methodology.index.test.tsx</automated>
    <automated>cd apps/web &amp;&amp; npx tsc --noEmit -p tsconfig.json</automated>
    <automated>npx vitest run</automated>
  </verify>
  <done>
The route renders a finished explainer: every section in the exported constant
has a title and real body paragraphs, the ± section distinguishes swing from
model uncertainty, the offense-only and no-hindsight points are both present, and
the closing section links to the accuracy-comparison route. The full repo suite
(root scope, ~167 files) is green and typecheck is clean.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
Third ribbon link now reads "Methodology" and opens a card hub at `/methodology`.
Two cards: "Intro to VPR" (new, fully written) and "Algorithm accuracy" (today's
Compare page, moved to `/methodology/compare` unchanged). `/compare` redirects to
the moved page so shared links still work.
  </what-built>
  <how-to-verify>
Serve the app locally with the artifact proxy active — the recipe this project
already uses is `VITE_ARTIFACT_ORIGIN=local` on a fresh port, since R2 CORS
blocks localhost — then:

  1. `/` — confirm the ribbon's third link reads "Methodology" and that all four
     links still fit on a 390px-wide viewport without wrapping oddly.
  2. Click it. Confirm the hub shows a heading, a one-line lede and two cards
     that read as separate white cards on the page background, with no green
     fill.
  3. Open "Algorithm accuracy". Confirm the accuracy table, comp-level switcher,
     methodology note, calibration section and data-coverage table all render
     exactly as they did on `/compare` before this change.
  4. Visit `/compare` directly in the address bar. Confirm it lands on the moved
     page.
  5. Open "Intro to VPR" and actually read it. This is the check that matters:
     is it clear to a high school student, does it say what the ± means without
     hand-waving, and is anything in it wrong?

Report anything that reads as invented, over-claimed or confusing.
  </how-to-verify>
  <resume-signal>Type "approved" or describe what to change in the VPR prose or the card layout</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| published artifact -> browser | Unchanged by this task. The moved Compare page fetches the same five `v1/compare/{year}.json` objects through the same client; no new fetch, no new parse, no new origin. |
| static prose -> browser | New. The VPR guide is developer-authored string constants compiled into the bundle. No user input, no fetched content, no `dangerouslySetInnerHTML`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-phf-01 | Information disclosure | `vprGuideContent.ts` | low | mitigate | The claim list in Task 2 is closed and each item names its source file; nothing about credentials, R2 keys, or internal endpoints is in scope for the prose. |
| T-phf-02 | Tampering | `routeTree.gen.ts` | medium | mitigate | Regenerated by the router plugin during the build, never hand-edited; Task 1's verify greps the regenerated file and the `Link` props are corrected to match it rather than the reverse. |
| T-phf-03 | Denial of service | `/compare` redirect | low | mitigate | Redirect targets a single fixed literal path, never a value read from the URL, so no open-redirect and no redirect loop is constructible. |
| T-phf-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable: this task installs no package. If any install becomes necessary, stop and run the package legitimacy gate first. |
</threat_model>

<verification>
- `cd apps/web && npx tsc --noEmit -p tsconfig.json` clean.
- `npx vitest run` from the repo ROOT (project scope ~167 files, not apps/web's 77) green.
- `npx vite build` in `apps/web` succeeds and rewrites `routeTree.gen.ts`.
- `git status` after the renaming commit shows no stray modified-but-uncommitted content in the moved route or test.
- Do not use `timeout N pnpm ...` for any of the above; it swallows output and exits 0 on failure.
</verification>

<success_criteria>
- Ribbon slot three reads "Methodology" and routes to the guide hub.
- `/methodology/compare` renders content identical to the pre-change `/compare`.
- `/compare` redirects to `/methodology/compare` with search params intact.
- `/methodology/vpr` ships finished prose covering all eleven claims in Task 2's list, with no numeric accuracy figure and no better-than claim.
- All three route tests, the ribbon test and the full repo suite pass.
- Human verification of the VPR prose and card layout is approved.
</success_criteria>

<output>
Create `.planning/quick/260905-phf-rename-compare-tab-to-methodology-guide-/260905-phf-SUMMARY.md` when done.

Note for the executing agent: `Write` is blocked against SUMMARY.md for subagents.
Return the summary text to the parent context rather than routing around the block.
</output>
</content>
</invoke>
