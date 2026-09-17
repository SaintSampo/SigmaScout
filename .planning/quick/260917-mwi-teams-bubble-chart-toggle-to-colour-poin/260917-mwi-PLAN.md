---
phase: quick-260917-mwi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/teams-table/teamsBubbleModel.ts
  - apps/web/src/components/teams-table/teamsBubbleModel.test.ts
  - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
  - apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/searchParams.test.ts
  - apps/web/src/routes/teams.tsx
  - apps/web/src/routes/teams.test.tsx
autonomous: true
requirements: [QUICK-260917-mwi]

estimate:
  tokens: 55000
  raw_tokens: 55000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The teams bubble chart offers a two-option Colour by control whose selection lives in the URL as `tint`, absent meaning colour by Total (D-01)."
    - "In sigma mode a point's tone is `row.sigmaTier` passed straight through for rare/epic/legendary, with BOTH `\"common\"` and `undefined` landing on `\"neutral\"` (D-02)."
    - "No tier is ever derived in the web app from a value; sigma mode reads only the published `sigmaTier` field (D-02)."
    - "`TeamsBubbleChart` still imports nothing from `@tanstack/react-router`; the route owns the navigate call (D-03)."
    - "The control does not render in the no-Sigma (OPR/EPA) state, where the chart itself is not drawn (D-03)."
    - "Toggling colour preserves year, algorithm, sort, sortDir, the three region filters and `chart` (D-01)."
    - "`pathByTone` stays keyed on `[model, plot]`; `colorBy` enters only through `model`, never as its own memo dependency, and the at-most-four-tone-path node invariant is unchanged (D-05)."
  artifacts:
    - apps/web/src/components/teams-table/teamsBubbleModel.ts
    - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/routes/teams.tsx
  key_links:
    - "`TeamsSearchSchema.tint` <-> `teams.tsx`'s `colorBy` derivation <-> `TeamsBubbleChart`'s `colorBy` prop <-> `buildBubbleModel`'s second parameter."
    - "`rowModel.ts`'s `deriveSigmaTier` (the ONLY place `\"common\"` is materialised) <-> `buildBubbleModel`'s sigma-mode tone mapping, which must collapse that `\"common\"` back to `\"neutral\"`."
    - "The control's segment labels <-> `metricDisplayLabel(TOTAL_KEY)` and `SIGMA_AXIS_LABEL`, imported not re-typed, and <-> the svg axis titles that read the same two constants."
---

<objective>
Add a two-option "Colour by" control to the Teams bubble chart so its point cloud
can be tinted by the Sigma Score rarity tier instead of the Total rarity tier.
Geometry does not change: X stays Total, Y stays Sigma Score, only the tone
assignment moves.

Purpose: the chart today answers "who is good" by colour and "who is consistent"
by height. Colouring by Sigma rarity lets the same cloud answer "who is
unusually consistent for their rating" at a glance, which is the question the
2026-09-17 Sigma rarity rework (quick task 260917-jzh) made answerable.

Output: a URL-backed `tint` search param, a `colorBy` parameter on
`buildBubbleModel`, a segmented control in the chart's key row, and tests at all
three levels.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@apps/web/src/components/teams-table/teamsBubbleModel.ts
@apps/web/src/components/teams-table/TeamsBubbleChart.tsx
@apps/web/src/components/teams-table/rowModel.ts
@apps/web/src/components/compare/CompLevelSwitcher.tsx
@apps/web/src/routes/teams.tsx
</context>

<execution_notes>
**Load the UI skill first.** Run `Skill("sketch-findings-sigmascout")` before
touching any `.tsx`, and read `references/colour-and-tiers.md`. The binding rules
for this task: tier colour is spoken for as tier meaning and must not be reused
for navigation or accents; use design tokens only, never a literal colour; accent
means interactive or active, nothing else.

**Do not touch `packages/harness`.** This toggle reads whatever tier the pipeline
already publishes. No pipeline, schema, publisher or Worker change, and no
republish.

**Concurrent session in this checkout.** `use_worktrees` is false and another
session is committing here. Stage by explicit path only — never `git add -A` —
and touch only the eight files in `files_modified`. Before committing, check
`git status` and confirm nothing foreign is staged.

**Tests.** Run from the repo root with `npx vitest run <path>`, and judge by the
printed output, not the exit code. Never wrap a pnpm command in `timeout`.

**Typecheck.** Root `tsc --noEmit` misses `apps/web`. Run BOTH:
`npx tsc --noEmit` and `npx tsc --noEmit -p apps/web`. The web project shows
roughly 45 spurious errors about `routeTree.gen.ts` unless a vite build has
generated it. Capture the web error count BEFORE your first edit and compare
against that baseline rather than expecting zero.

**No network.** Do not attempt a publish, a deploy, a live fetch or a push.

**Commit trailer**, on every commit:
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

**SUMMARY.** Do not write `SUMMARY.md`. Return the summary text in your final
message; the orchestrator writes the file.
</execution_notes>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: buildBubbleModel gains a colorBy parameter</name>
  <files>apps/web/src/components/teams-table/teamsBubbleModel.ts, apps/web/src/components/teams-table/teamsBubbleModel.test.ts</files>
  <read_first>
    `teamsBubbleModel.ts` lines 1-30 (the header comment and the `BubbleTone`
    type) and lines 211-256 (`buildBubbleModel`). `rowModel.ts` lines 55-72
    (`TeamRow.sigmaScore` / `TeamRow.sigmaTier`) and lines 103-112
    (`deriveSigmaTier` — the one place `"common"` is materialised, and the reason
    both `"common"` and `undefined` reach this module).
  </read_first>
  <behavior>
    - In sigma mode a row with `sigmaTier: "rare"` yields tone `"rare"`; `"epic"` yields `"epic"`; `"legendary"` yields `"legendary"`.
    - In sigma mode a row with `sigmaTier: "common"` yields tone `"neutral"`, and the emitted tone is never the string `"common"`.
    - In sigma mode a row with `sigmaTier: undefined` yields tone `"neutral"` EVEN WHEN that row's Total metric carries a published tier — the Total tier must not leak into sigma mode.
    - Calling with no second argument produces tones byte-identical to calling with `"total"`, on a row set whose Total tier and Sigma tier deliberately disagree.
    - Every non-tone field of the returned model (`points` order, `x`, `y`, `omittedNoSigma`, `omittedNoTotal`, `hasAnySigma`) is identical between the two modes for the same rows.
  </behavior>
  <action>
    Export a new type `BubbleColorBy = "total" | "sigma"` beside `BubbleTone`.

    Widen the signature to
    `buildBubbleModel(rows: readonly TeamRow[], colorBy: BubbleColorBy = "total"): BubbleModel`.
    The default is load-bearing: it keeps the existing call site and the twenty-odd
    existing model tests compiling and passing unchanged, which is what makes the
    "default equals total" behavior above a real regression pin rather than a
    tautology.

    Add one small private helper that maps a sigma tier to a tone, written so the
    `"common"`-and-`undefined` collapse is a single expression rather than two
    scattered branches:

    `sigmaTier` is typed `TeamRow["sigmaTier"]`. Type the helper's parameter as
    that indexed access rather than importing `Tier` from `lib/tiers.ts` — this
    module's header comment states it never imports `tiers.ts`, and that property
    is worth keeping structural.

    Inside the per-row loop, replace the single `tone: total.tier ?? "neutral"`
    expression with a branch on `colorBy`: `"total"` keeps exactly today's
    expression, `"sigma"` calls the new helper on `row.sigmaTier`. Derive nothing:
    never inspect `row.sigmaScore`, never call `tierForPercentile`, never consult
    an algorithm id. Per D-02 the published `sigmaTier` field is the only input.

    Leave the rest of the function untouched — the omission counters, `hasAnySigma`
    and both axes must keep reading the same fields in the same order, because the
    axes are the geometry and this change is purely about colour.

    Rewrite the header comment's colour paragraph (currently "Colour is the rarity
    tier of the Total metric ...", around lines 9-14) per D-07. The replacement
    must state: colour is the rarity tier of whichever axis `colorBy` selects;
    under `"total"` it reads `row.metrics[TOTAL_KEY].tier`; under `"sigma"` it
    reads `row.sigmaTier`, which the pipeline publishes and this module never
    derives; and that the `"common"`-to-`"neutral"` collapse exists because
    `BubbleTone` has no Common member — the key row's single "Common / unranked"
    entry already covers both the ranked-Common and the unranked case honestly.
    Keep the existing sentence about never importing `tierForPercentile`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts</automated>
  </verify>
  <done>
    All pre-existing `teamsBubbleModel.test.ts` tests still pass untouched, and the
    five new behaviors above each have their own test and pass. `npx tsc --noEmit -p apps/web`
    shows no NEW error against the baseline count.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: TeamsBubbleChart renders the Colour by control</name>
  <files>apps/web/src/components/teams-table/TeamsBubbleChart.tsx, apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx</files>
  <read_first>
    `TeamsBubbleChart.tsx` lines 1-46 (header comment, including the memo
    invariant), 78-102 (props and `TONE_KEY_LABEL`), 134-158 (the two memos),
    214-268 (the no-Sigma early return and the key row) and 270-282 (the comment
    that currently forbids the "Hover a point" sentence from containing the two
    axis strings). `CompLevelSwitcher.tsx` in full — it is this codebase's one
    existing segmented-control idiom and this control copies its shape.
  </read_first>
  <behavior>
    - With `colorBy="sigma"`, a row set whose Total tiers and Sigma tiers disagree renders `data-tone` groups matching the SIGMA tiers, not the Total tiers.
    - With `colorBy` omitted, the same row set renders the Total-tier groups — the component's default matches the model's default.
    - Clicking the Sigma segment calls `onColorByChange` exactly once with `"sigma"`; clicking the Total segment calls it exactly once with `"total"`.
    - The active segment carries `aria-pressed="true"` and the inactive one `aria-pressed="false"`, tracking `colorBy`.
    - The control's two segments are `<button>` elements inside a `role="group"` whose accessible name is "Colour by", so it is keyboard reachable and announced as one control.
    - The segment labels are exactly `metricDisplayLabel(TOTAL_KEY)` and `SIGMA_AXIS_LABEL` — assert against the imported constants, never against re-typed literals.
    - In the no-Sigma state (no row carries a `sigmaScore`) the control does not render at all.
    - The node-count invariant holds with the control present: 400 rows with a hover active still yield at most four `[data-tone]` paths and at most one `<circle>`.
    - The key row element (`data-testid="bubble-chart-key"`) still has exactly four children, labelled "Common / unranked", "Rare", "Epic", "Legendary" in that order, under BOTH colour modes.
  </behavior>
  <action>
    Import `BubbleColorBy` from `./teamsBubbleModel.js` and `Button` from
    `@/components/ui/button`. Import nothing from `@tanstack/react-router` — per
    D-03 this component stays presentational so its tests keep rendering bare.

    Add two props to `TeamsBubbleChartProps`:
    `colorBy?: BubbleColorBy` (defaulted to `"total"` in the destructure) and
    `onColorByChange?: (next: BubbleColorBy) => void`. BOTH optional, mirroring the
    existing optional `onSelectTeam` — that is what lets the ~25 existing bare
    `render(<TeamsBubbleChart rows={...} />)` calls keep compiling. A bare render
    shows the control with Total pressed and clicking it is inert, which is exactly
    how `onSelectTeam` already behaves in those same tests.

    Change the model memo to `useMemo(() => buildBubbleModel(rows, colorBy), [rows, colorBy])`.
    Per D-05 that is the ONLY place `colorBy` may appear in a dependency list:
    `pathByTone` and `hitIndex` stay keyed on `[model, plot]` exactly as written,
    and `colorBy` reaches them through the new `model` identity. Do not add
    `colorBy` to either list.

    Build the option list next to the existing `const totalLabel = metricDisplayLabel(TOTAL_KEY)`:
    a two-entry readonly array of `{ value: BubbleColorBy; label: string }`, the
    first `"total"` labelled `totalLabel`, the second `"sigma"` labelled
    `SIGMA_AXIS_LABEL`. Both already exist in this file; do not re-type either
    string.

    Render the control in the key row per D-03. CRITICAL — do NOT make it a child
    of the `data-testid="bubble-chart-key"` div: `TeamsBubbleChart.test.tsx`'s
    "the key row lists four entries in draw order" test pins
    `Array.from(keyRow.children).map(textContent)` by equality, and a fifth child
    would break it. Instead wrap the existing key div and the new control in one
    flex row (`flex flex-wrap items-center justify-between gap-[var(--spacing-sm)]`),
    leaving the key div and its four spans byte-identical. The control then sits in
    the key row visually, at its right end, with the pinned assertion intact.

    Control markup: a visible muted `<span>` reading "Colour by" carrying a static
    `id`, followed by a `role="group"` with `aria-labelledby` pointing at that id
    and `data-testid="bubble-chart-color-by"`. `aria-labelledby` rather than
    `aria-label` so the visible text IS the accessible name and a screen reader is
    not told the label twice. A static id is safe because the chart renders once
    per page. Inside the group, map the option list to `Button` elements copying
    `CompLevelSwitcher`'s shape: `type="button"`, `variant={isActive ? "default" : "ghost"}`,
    `size="sm"`, `aria-pressed={isActive}`, a stable
    `data-testid={`bubble-chart-color-by-${option.value}`}`, and
    `onClick={() => onColorByChange?.(option.value)}`. Tokens only — `Button`'s own
    variants carry them; add no literal colour and no bespoke accent class. The
    accent lives in the active `default` variant and nowhere else.

    Placement means the control is absent from the no-Sigma state for free (that
    branch returns before the key row) — do not add a second gate for it. Do NOT
    hide the control in the zero-plottable-points empty state either: the key row
    renders there today and the control keeps it company.

    Add nothing to the tooltip and nothing to the svg's `aria-label` (D-06). The
    colour encoding is already stated by the key row and the control, both real
    DOM text.

    Header comments (D-07). In this file: update the opening paragraph so it says
    X is Total and Y is Sigma Score while the point COLOUR is a selectable rarity
    tier (Total by default, Sigma Score when `colorBy` says so), and state that the
    route owns the selection because it lives in a search param. Then rewrite the
    comment above the "Hover a point" sentence (around lines 270-278): its claim
    that the sentence "must contain neither Total nor Sigma Score" stops being the
    live constraint once Task 2's control puts both strings on screen. Replace it
    with the real rule — the svg's axis titles are asserted by `getByText` calls
    now SCOPED to the svg, so a second occurrence elsewhere in the component is
    fine — and keep the honest-affordance point the comment is actually making.

    Now the test-file trap (D-04). Two assertions in `TeamsBubbleChart.test.tsx`
    use unscoped single-match `getByText`, and the new control's segment labels are
    those exact strings:
      - the "Y axis title text is exactly 'Sigma Score'" test (~line 106)
      - the "X axis title is the same label the table's Total column header uses" test (~line 116)
    SCOPE them, do not weaken them: wrap each in
    `within(screen.getByRole("img"))`, which resolves to the svg (it carries
    `role="img"`). `within` is already imported in this file. Scoping keeps each
    assertion proving what it was written to prove — that the axis TITLE inside the
    chart carries that exact string — while the control's identically-worded button
    is correctly out of scope. Do not relax either to `getAllByText`, and do not
    rename a segment to dodge the collision; the labels must stay the imported
    constants. Leave the tooltip's own `Total` / `Sigma Score` assertions alone —
    they are already scoped within the tooltip.

    Add one test per behavior listed above. For the tone-group tests build a local
    fixture whose two tier sources DISAGREE (for example: Total tier `"legendary"`
    with `sigmaTier: "rare"`, Total tier `undefined` with `sigmaTier: "epic"`,
    Total tier `"epic"` with `sigmaTier: "common"`, Total tier `"rare"` with
    `sigmaTier` absent) and pin the per-tone dot counts by equality using the
    existing `countDots` helper — never by iterating a tone list, so a tone that
    silently stops rendering fails loudly. For the click tests use a `vi.fn()` and
    assert `toHaveBeenCalledTimes(1)` and `toHaveBeenCalledWith("sigma")` /
    `("total")`. Re-run the whole file, not just the new tests.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx</automated>
  </verify>
  <done>
    Every pre-existing test in the file passes (the two axis-title tests now scoped
    to the svg rather than weakened), the nine new behaviors each pass, and
    `npx tsc --noEmit -p apps/web` shows no new error against the baseline.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: the tint search param and the route wiring</name>
  <files>apps/web/src/lib/searchParams.ts, apps/web/src/lib/searchParams.test.ts, apps/web/src/routes/teams.tsx, apps/web/src/routes/teams.test.tsx</files>
  <read_first>
    `searchParams.ts` around the `chart` field (~line 122) and `applyYearChange`
    just below it. `teams.tsx` lines 24-35 (the search destructure and `isChart`)
    and 125-150 (`handleViewToggle` / `handleChartToggle` / `handleSelectTeam`) and
    255-262 (the chart render site). `teams.test.tsx` lines 30-120 (the fixture)
    and 191-250 (the existing chart-toggle route tests).
  </read_first>
  <behavior>
    - `TeamsSearchSchema` parses `tint: "sigma"` through unchanged.
    - `TeamsSearchSchema` resolves an unrecognised `tint` (e.g. `"rainbow"`) to `undefined`, and an absent `tint` to `undefined`.
    - Clicking the Sigma segment writes `tint=sigma` into the location search while `year`, `algorithm`, `sort`, `sortDir`, `country` and `chart` each keep their prior value.
    - Clicking the Total segment clears `tint` back to `undefined` while that same field set is preserved.
    - Arriving at `/teams?algorithm=spr&chart=bubble&tint=sigma` colours by Sigma with no click: against the route fixture every plotted row's `sigma` entry carries no `tier`, so all three plotted rows are Common, yielding exactly one `[data-tone]` path, `"neutral"`, holding three dots — and no rare or epic path at all.
    - The same URL with `tint` absent yields the Total-tier grouping instead (one rare dot, one epic dot, one neutral dot).
    - `applyYearChange` preserves `tint` across a year change.
  </behavior>
  <action>
    In `searchParams.ts`, add `tint: z.literal("sigma").optional().catch(undefined)`
    to `TeamsSearchSchema`, directly after `chart`. The name is free: the schema
    today carries `year`, `algorithm`, `sort`, `sortDir`, `cols`, `country`,
    `state`, `district`, `chart` and nothing else. Give it a doc comment mirroring
    `chart`'s in structure and register: it answers which QUANTITY the already-drawn
    cloud is tinted by, absent meaning the Total rarity tier (today's behaviour,
    so a URL with no `tint` is byte-identical to one written before this change)
    and `"sigma"` meaning the Sigma Score rarity tier; the `z.literal(...).catch(undefined)`
    shape makes the field structurally incapable of holding a third value; and
    `applyYearChange` spreads it through untouched, so it survives a year change
    with no change to that function.

    In `teams.tsx`: add `tint` to the `Route.useSearch()` destructure, derive
    `const colorBy: BubbleColorBy = tint === "sigma" ? "sigma" : "total";` beside
    the existing `isChart`, import the type from
    `../components/teams-table/teamsBubbleModel.js` (that import already exists for
    `BubblePoint` — extend it), and add a `handleColorByChange(next: BubbleColorBy)`
    that mirrors `handleChartToggle`'s updater form exactly:
    `navigate({ search: (prev) => ({ ...prev, tint: next === "sigma" ? "sigma" : undefined }) })`.
    Writing `undefined` rather than `"total"` is what keeps the default state out
    of the URL. Pass `colorBy={colorBy}` and `onColorByChange={handleColorByChange}`
    to `<TeamsBubbleChart>`. Change nothing else on this route — the chart toggle,
    the filters, the table branch and the `TierKeyRow` gate all stay as written.

    Add the two schema behaviors to `searchParams.test.ts` as equality pins on
    `.parse(...)`'s result. `chart` has no coverage in that file today; add
    coverage for `tint` anyway — a `.catch` is exactly the kind of silent fallback
    worth pinning, and it is two assertions.

    Add the five route behaviors to `teams.test.tsx`, in a new
    `describe("/teams route bubble-chart colour toggle")` block beside the existing
    chart-toggle block, reusing its `stubFetch` / `renderTeamsRoute` helpers.
    DO NOT modify the shared fixture: the tier pass-through is already pinned by
    Tasks 1 and 2 against local fixtures, and the existing `dotCoords(chart, "rare")`
    hover test depends on frc1 being rare in Total mode.

    Address segments by `data-testid` (`bubble-chart-color-by-sigma` /
    `-total`), not by accessible name, so these tests do not collide with the
    "Total" text that also appears in table headers elsewhere on the page. Assert
    preservation field by field with explicit equality reads off
    `router.state.location.search` — never by iterating a list of field names, so a
    field that silently stops surviving fails loudly. For the tone assertions,
    count `[data-tone]` paths and their `M` commands scoped to the
    `teams-bubble-chart` container, pinning both the tone attribute values and the
    counts by equality.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/searchParams.test.ts apps/web/src/routes/teams.test.tsx</automated>
  </verify>
  <done>
    All pre-existing tests in both files pass unchanged, the seven new behaviors
    pass, and both `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web` show no
    new error against the baseline.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL -> client | A hand-edited `?tint=` value reaches the route's search parsing. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mwi-01 | Tampering | `TeamsSearchSchema.tint` | low | mitigate | `z.literal("sigma").optional().catch(undefined)` makes the field structurally incapable of carrying any third value; Task 3 pins the `.catch` with an equality test. |
| T-mwi-02 | Information disclosure | `buildBubbleModel` sigma-mode tone | low | mitigate | Sigma mode reads the published `sigmaTier` only. It never reads `sigmaScore` and never touches the algorithm's own `spread`, so the never-render rule on `spread` stays structural (the existing "no plus-minus glyph, no confidence field name" tests still cover the whole component). |

No new dependency, no package install, no network call, no server or pipeline
surface: this change is entirely client-side rendering over already-published data.
</threat_model>

<verification>
Run all four touched test files together from the repo root, plus both typechecks:

```
npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx apps/web/src/lib/searchParams.test.ts apps/web/src/routes/teams.test.tsx
npx tsc --noEmit
npx tsc --noEmit -p apps/web
```

Then run the full web suite from the REPO ROOT, not from `apps/web` — running
vitest from `apps/web` sees only ~77 of the repo's ~167 test files and has hidden
a red suite here before:

```
npx vitest run
```

Judge every one of these by its printed output, not by the exit code.

Mutation check (cheap, high value given the `.catch` and the default parameter):
after the suite is green, temporarily flip `buildBubbleModel`'s default parameter
from `"total"` to `"sigma"` and confirm a test fails; then flip the sigma-mode
`"common"` mapping to pass `"common"` through and confirm a different test fails.
Revert both. Report both as caught in the summary.
</verification>

<success_criteria>
- The Teams bubble chart shows a "Colour by" segmented control with Total and Sigma Score segments, Total active by default.
- Selecting Sigma Score writes `?tint=sigma`; selecting Total removes the param.
- Sigma mode tones come from `sigmaTier` alone, with Common and unranked both neutral.
- No test was weakened to accommodate the new labels; the two axis-title assertions are scoped to the svg.
- The at-most-four-tone-path node invariant and the `[model, plot]` memo keying are unchanged.
- Both typechecks and the full root vitest run are green against the pre-edit baseline.
</success_criteria>

<orchestrator_notes>
**Live e2e.** `apps/web/e2e` specs run against sigmascout.org only and are not in
CI, so they cannot be run from here and they drift. After this ships and deploys,
rerun `npx playwright test` from the main context. Do NOT add a spec as part of
this task: grep found no existing bubble-chart e2e spec, so covering the toggle
there would be a new file rather than the two-line addition that would have
justified it.

**No republish, no deploy needed for correctness.** The toggle reads whatever
tier the pipeline publishes. Note for Jacob when reporting: the Sigma tiers
currently LIVE are the old scheme; quick task 260917-jzh's fix is committed but
not yet republished, so Sigma mode will look uninteresting (most teams Common)
against live data until that republish lands. That is expected and is not a bug
in this change.

**Local visual check** is optional and needs the main context: the executor has no
network, and the `/v1` proxy recipe (`VITE_ARTIFACT_ORIGIN=local`, fresh port per
restart) requires reaching R2.
</orchestrator_notes>

<output>
Return the SUMMARY text in your final message. Do NOT write SUMMARY.md — `Write`
is blocked for subagents on that path and heredocs break on this machine. The
orchestrator writes the file from your returned text.
</output>
