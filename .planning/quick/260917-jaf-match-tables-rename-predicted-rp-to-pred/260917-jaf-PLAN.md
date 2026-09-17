---
quick_id: 260917-jaf
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [260917-jaf]
files_modified:
  - apps/web/src/styles/theme.css
  - apps/web/src/components/team/MatchTable.tsx
  - apps/web/src/components/team/MatchTable.test.tsx
  - apps/web/src/components/team/matchAxis.ts
  - apps/web/src/components/team/matchAxis.test.ts
  - apps/web/src/components/event/EventMatchTable.tsx
  - apps/web/src/components/event/EventMatchTable.test.tsx
  - apps/web/e2e/event-scroll-regions.spec.ts
  - apps/web/e2e/zebra-stripe-full-row.spec.ts

estimate:
  tokens: 40000
  raw_tokens: 80000
  tasks: 4
  confidence: high   # derived from 63 calibration samples (factor 0.5), not self-rated

must_haves:
  truths:
    - "The team match table's header row reads, left to right: Match, Result, Actual, Prediction, (axis), Call — with Confidence between Prediction and the axis."
    - "The event match table's header row reads, left to right: Match, Actual, Prediction, Confidence, (axis), Call — and no Result column is added."
    - "A single vertical rule sits on the left edge of the Prediction column in both tables, unbroken from the header cell down through the last body row."
    - "The event skeleton header carries the same labels in the same order with the same rule, so the loading and loaded states do not disagree."
    - "In both tables, each alliance roster line, its Prediction score line, its Actual score line and its Match Band marks share one horizontal centre line."
    - "Every existing data-testid still resolves to the same content it did before, and the column counts are unchanged (7 team, 6 event)."
  artifacts:
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/styles/theme.css
  key_links:
    - "EVENT_MATCH_TABLE_HEADERS is the single source both EventMatchTable's live header and EventMatchTableSkeleton read — reorder it once, both move."
    - "One named CSS class carries the vertical rule, shared by the th and the td in both tables, so header and body can never drift to different colours or widths."
---

<objective>
Rename and reorder the two match-table column sets so a reader sees what happened
before what was predicted, with a visible rule between the two halves.

Purpose: "Predicted RP" and "Actual RP" name a quantity the columns do not actually
print (the RP total is deliberately not rendered — bonus RP is the dots, win/tie RP is
the Confidence chip and the Call column). "Prediction" and "Actual" describe what is
really in each cell, and grouping the observed columns to the left of a rule separates
fact from forecast at a glance.

Output: Both match tables re-headed and re-ordered, a shared rule class in theme.css,
updated tests pinning the new header order, and the live-only e2e lookup fixed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md

Load `Skill("sketch-findings-sigmascout")` BEFORE editing any component or CSS in this
plan. It carries the decided palette tokens and the table/chart craft rules this repo's
UI is held to.

Source files (read the regions you are changing; do not re-read a range twice):
@apps/web/src/components/team/MatchTable.tsx
@apps/web/src/components/event/EventMatchTable.tsx
@apps/web/src/styles/theme.css

**Scouting already verified against HEAD — use it, do not re-derive:**

- Exactly two components render these headers. No third table exists.
- `MatchTable.tsx` — header at ~507-535, `MatchRow` cells at ~301-446. Current column
  order: Match, Result, Confidence, Predicted RP, Actual RP, axis plot, Call.
- `EventMatchTable.tsx` — header at ~194-219, `EventMatchRowView` cells at ~59-191,
  `EVENT_MATCH_TABLE_COLUMN_COUNT` (line 45) and `EVENT_MATCH_TABLE_HEADERS` (line 47),
  `EventMatchTableSkeleton` at ~227-244. Current order: Match, Confidence, Predicted RP,
  Actual RP, axis plot, Call. This table has NO Result column and must not gain one.
- `--color-border` (theme.css line 30) is the established neutral hairline token; other
  rules in that file already use `1px solid var(--color-border)`. Never write a new hex.
- Both tables set `borderCollapse: separate; borderSpacing: 0`, so a `border-left` on a
  column's `th` and every `td` renders as one continuous vertical line.
- No test anywhere in `apps/web` currently pins these header strings or asserts a match
  row's cells by index. `EventMatchTable.test.tsx` pins only the header COUNT (lines 61,
  401). `event.$eventKey.test.tsx:341` pins the Insights tab's headers — unrelated table,
  do not touch.
- `apps/web/e2e/event-scroll-regions.spec.ts:101` looks up a `columnheader` by the name
  "Actual RP". Its logic only compares bounding-box x before/after a drag, so it is
  position-independent — only the NAME needs changing. e2e is live-only (hits
  sigmascout.org, not CI) and cannot run in this task.
- `apps/web/e2e/zebra-stripe-full-row.spec.ts:51` has a doc comment naming the first four
  columns; it samples `<td>`s by index only, so the code is fine and the comment is stale.

**Repo rules that bind this plan:**

- Concurrent sessions share this checkout. Stage by explicit path only — never
  `git add -A` or `git add .`. There are foreign uncommitted files under
  `.planning/sketches/` and `.planning/quick/260917-01e-*`; do not touch or stage them.
- Worktrees are disabled; work on `main` in the main checkout.
- Run vitest as `npx vitest run` from the repo root. Never `timeout ... pnpm ...` — it
  swallows output and exits 0. Judge every run by its printed output, not its exit code.
- Root `tsc --noEmit` does NOT cover `apps/web`. Both typechecks must be run.
- No push and no deploy in this plan.
</context>

<tasks>

<!-- planner-discipline-allow: Predicted RP -->
<!-- planner-discipline-allow: Actual RP -->

<task type="auto" tdd="true">
  <name>Task 1: Team match table — new labels, new order, shared rule class</name>
  <files>apps/web/src/styles/theme.css, apps/web/src/components/team/MatchTable.tsx, apps/web/src/components/team/MatchTable.test.tsx</files>
  <behavior>
    New assertions in `MatchTable.test.tsx`, written and failing before the component moves:
    - Rendering `MatchTable` with the existing multi-row fixture, the `columnheader`
      elements' trimmed `textContent`, in DOM order, equal exactly:
      `["Match", "Result", "Actual", "Prediction", <the axis header cell's own text>, "Call"]`
      plus the Confidence header in its new slot — pin the full array, deriving the axis
      cell's expected text from the same `AxisHeader` the component renders rather than
      hardcoding tick numbers. The full expected order is:
      Match, Result, Actual, Prediction, Confidence, axis, Call (7 headers).
    - The header cell whose text is "Prediction" carries the rule class, and so does each
      body row's `predicted-score-{matchKey}` cell — asserted via `classList.contains`, so
      header and body can never drift apart.
    - A body row's cells, read in DOM order by `data-testid`, come back as
      result, actual, predicted-score, confidence — proving the cells moved with their
      headers rather than only the labels changing.
    - Existing assertions for `result-*`, `confidence-*`, `predicted-score-*`, `actual-*`
      and `call-*` content keep passing untouched.
  </behavior>
  <action>
    First load `Skill("sketch-findings-sigmascout")`.

    In `apps/web/src/styles/theme.css`, near the existing match-table class family (the
    `.alliance-chip` / `.result-chip` / `.match-row-tint` block), add ONE new class named
    `match-table-rule` whose only declaration is a left border of 1px, solid, in
    `var(--color-border)`. Reuse that token exactly; introduce no new colour value and no
    new custom property. Give it a short comment saying it marks the boundary between the
    observed half of a match row and the forecast half, and that it is applied to both the
    header cell and every body cell of that column so the line reads as continuous under
    the table's `borderSpacing: 0`.

    In `MatchTable.tsx`'s `MatchTable` header (~507-535), change the fourth header's text
    from "Predicted RP" to "Prediction" and the fifth's from "Actual RP" to "Actual", then
    reorder the `th` elements to: Match, Result, Actual, Prediction, Confidence, axis,
    Call. Keep every className byte-identical to what each header already carries — the
    Result header keeps its `w-[64px]`, the axis header keeps its `pl-[var(--spacing-lg)]`
    — and add the new rule class to the Prediction header only, composed with `cn` if the
    file already imports it or appended to the existing class string otherwise.

    In `MatchRow` (~301-446), move the whole `<td>` elements so the body order matches:
    the Match cell, the `result-` cell, the `actual-` cell, the `predicted-score-` cell,
    the `confidence-` cell, the axis-plot cell, the `call-` cell. Move each `<td>` intact —
    its `data-testid`, its className, its children and its surrounding JSX comment travel
    together as one unit. Add the rule class to the `predicted-score-` cell's className.
    Change no cell's contents, no `data-testid`, and no `colSpan`; the row stays at 7
    cells.

    Update the two stale prose references in this file that name the old fourth-column
    label — the `NoPrediction` doc comment (~187) and the `MatchRow` inline comment
    (~293) — to name the column by its new label instead.
  </action>
  <verify>
    <automated>npx vitest run MatchTable.test 2>&amp;1 | tail -30</automated>
  </verify>
  <done>The team table renders 7 headers reading Match, Result, Actual, Prediction, Confidence, axis, Call; the Prediction header and every predicted-score cell carry the rule class; the new assertions pass and no pre-existing assertion in either match-table test file regressed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Event match table — same labels, same order, skeleton in step</name>
  <files>apps/web/src/components/event/EventMatchTable.tsx, apps/web/src/components/event/EventMatchTable.test.tsx</files>
  <behavior>
    New assertions in `EventMatchTable.test.tsx`, written and failing before the component
    moves:
    - Rendering `EventMatchTable`, the `columnheader` elements' trimmed `textContent` in
      DOM order equal exactly: Match, Actual, Prediction, Confidence, the axis cell's own
      text, Call — 6 headers, still `EVENT_MATCH_TABLE_COLUMN_COUNT`. No Result header
      appears.
    - Rendering `EventMatchTableSkeleton`, the labels of its non-empty header cells match
      the live table's labels position for position, and the skeleton's Prediction header
      carries the rule class too.
    - The Prediction header and every row's `predicted-score-{matchKey}` cell carry the
      rule class.
    - A body row's cells in DOM order are actual, predicted-score, confidence after the
      Match cell.
    - The existing header-count assertions at lines 61 and 401 still pass unchanged.
  </behavior>
  <action>
    Reorder `EVENT_MATCH_TABLE_HEADERS` (line 47) to the new labels and order: Match,
    Actual, Prediction, Confidence, the empty string for the axis column, Call. Leave
    `EVENT_MATCH_TABLE_COLUMN_COUNT` at 6 and update its doc comment (line 44) so the
    column list it recites matches the new labels and order, keeping the rest of that
    comment's content (the shared-with-the-skeleton rationale, the unwired Video note).

    In the `EventMatchTable` header (~194-219), apply the same relabel and reorder to the
    `th` elements, preserving each one's existing className exactly and adding the rule
    class to the Prediction header.

    In `EventMatchRowView` (~59-191), move the `<td>` elements so the body order is: Match
    cell, `actual-` cell, `predicted-score-` cell, `confidence-` cell, axis-plot cell,
    `call-` cell. Move each `<td>` intact with its testid, className, children and
    surrounding comment. Add the rule class to the `predicted-score-` cell. Do not add a
    Result column — this table has never had one and gains none here.

    In `EventMatchTableSkeleton` (~227-244), the header already maps over
    `EVENT_MATCH_TABLE_HEADERS`, so its labels and order follow automatically. Add the rule
    class conditionally to the cell whose label is the Prediction label, composed with the
    `cn` helper this file already imports, so the loading state shows the same divider the
    loaded state shows.

    Update the stale prose reference in `EventMatchRowView`'s leading comment (~51) that
    names the old third-column label, so it names the column by its new label.
  </action>
  <verify>
    <automated>npx vitest run MatchTable.test 2>&amp;1 | tail -30</automated>
  </verify>
  <done>The event table and its skeleton both render 6 headers reading Match, Actual, Prediction, Confidence, axis, Call; both carry the rule class on Prediction; EVENT_MATCH_TABLE_COLUMN_COUNT is still 6; all assertions in both match-table test files pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: One row grid — roster line, predicted line, actual line and band on the same horizontal line</name>
  <files>apps/web/src/components/team/matchAxis.ts, apps/web/src/components/team/matchAxis.test.ts, apps/web/src/styles/theme.css, apps/web/src/components/team/MatchTable.tsx, apps/web/src/components/event/EventMatchTable.tsx, both match-table test files</files>
  <behavior>
    Added by the orchestrator from Jacob's mid-task request: "fix the vertical spacing so
    that an alliance, its predicted score, actual score/RPs, and match band are all in a
    horizontal line."

    Diagnosis (verified against HEAD): the plot already sits on the roster lines. The Match
    cell stacks a label line (12px x 1.3 = 15.6px), a 1px gap, then two 21px body lines, which
    puts the red roster centre at ~27px and blue at ~49px — exactly `MATCH_GEOMETRY.Y_RED + 4`
    and `Y_BLUE + 4`. The Prediction and Actual cells are the ones that are off: their two
    score lines start at the TOP of the cell (no label-line offset) with their own 2px gap
    and their own inherited line height, so the red score sits ~17px above the red roster
    line and the red band, and the blue score sits level with the RED band.

    The existing numbers already describe a clean three-slot grid: label slot 16px, red
    slot 22px, blue slot 22px = `PLOT_H` 60, and `Y_RED` 23 = 16 + (22 - 8)/2,
    `Y_BLUE` 45 = 16 + 22 + (22 - 8)/2. Make that grid the single source.

    Tests, written first:
    - `matchAxis.test.ts`: new exported `MATCH_ROW_GRID = { LABEL_H: 16, LINE_H: 22 }`;
      `MATCH_GEOMETRY.Y_RED`, `Y_BLUE` and `PLOT_H` are DERIVED from it and `BAND_H`, and
      still equal 23, 45 and 60 (equality pins, so no plot mark moves).
      `allianceMarkPositions(Y_RED).centre === LABEL_H + LINE_H / 2` and the blue centre
      `=== LABEL_H + LINE_H * 1.5`.
    - Both component tests: in a played, priced row the Match cell, the `predicted-score-`
      cell and the `actual-` cell each contain one grid wrapper carrying the shared grid
      class, and within it the red line carries the red-slot class and the blue line the
      blue-slot class (same class names in all three cells — that shared class IS the
      alignment contract jsdom can check). The table element carries the two CSS custom
      properties with values built from `MATCH_ROW_GRID`.
  </behavior>
  <action>
    `matchAxis.ts`: add and export `MATCH_ROW_GRID` with `LABEL_H: 16` and `LINE_H: 22`, doc
    comment explaining the three slots. Rewrite `MATCH_GEOMETRY`'s `PLOT_H`, `Y_RED`, `Y_BLUE`
    as expressions of `MATCH_ROW_GRID` and `BAND_H` (values unchanged: 60, 23, 45). Keep the
    typing workable (compute into consts first if needed).

    `theme.css`, in the match-table class family: add
    - `.match-row-grid`: `display: grid; grid-template-rows: var(--match-label-h)
      var(--match-line-h) var(--match-line-h); align-items: center;` no gap, no padding.
    - `.match-row-grid__label` (grid-row 1), `.match-row-grid__red` (grid-row 2),
      `.match-row-grid__blue` (grid-row 3), and `.match-row-grid__both`
      (`grid-row: 2 / span 2; align-self: center`) for per-match content that belongs to
      neither alliance.
    - Do NOT set a line-height on the slots (it would inflate the roster ground pill);
      rely on `align-items: center`, and confirm no child is taller than 22px (the roster
      pill is 21px; check the `BonusRpDots` dot size in theme.css).
    Update the existing comment on `.match-alliance-nums--mine` so it names the grid as the
    thing that must not be disturbed.

    Both tables: set the two custom properties ONCE on the `<table>` element's style, built
    from `MATCH_ROW_GRID` (`--match-label-h` and `--match-line-h`, each `${n}px`), so
    TypeScript stays the single source and CSS never restates 16 or 22. The skeleton table
    needs nothing.

    Both row components:
    - Match cell: replace the `flex min-w-0 flex-col gap-[1px]` wrapper with the grid
      wrapper (keep `min-w-0`); the label Link goes in the label slot, the red roster span
      in the red slot, the blue roster span in the blue slot. Everything inside those spans
      is unchanged.
    - `predicted-score-` and `actual-` cells: replace `flex flex-col gap-[2px]` with the grid
      wrapper; the red `PredictedScoreLine`/`ActualScoreLine` in the red slot, blue in the
      blue slot, label slot left empty. The unplayed Actual cell's scheduled-time span goes
      in the `__both` slot of the same grid wrapper.
    - `result-`, `confidence-` and `call-` cells: wrap their content in the grid wrapper's
      `__both` slot so the Win/Loss chip, the confidence chip + percent (and `NoPrediction`)
      and the Call badge sit vertically centred on the two alliance lines rather than up on
      the label line.
    - The plot cell is untouched: `PLOT_H` is still 60 and equals the grid's total height,
      and every text cell keeps the same `py-[var(--spacing-xs)] align-top` as the plot
      cell, so slot N of every cell starts at the same y.
    Do not change `PredictedScoreLine`/`ActualScoreLine`/`AllianceRow` internals, any
    testid, or `StartMatchPicker` (it shares helpers, not this layout — confirm by grep and
    leave it alone).
  </action>
  <verify>
    <automated>npx vitest run matchAxis MatchTable.test 2>&amp;1 | tail -30</automated>
  </verify>
  <done>MATCH_ROW_GRID is the one source for slot heights in TS and (via the table's inline custom properties) in CSS; MATCH_GEOMETRY still evaluates to 60/23/45; Match, Prediction and Actual cells in both tables use the same three-slot grid with red in slot 2 and blue in slot 3; Result, Confidence and Call centre on the alliance block; all tests pass. Pixel-level confirmation is a screenshot the orchestrator takes after this plan — say so in the SUMMARY rather than claiming it.</done>
</task>

<task type="auto">
  <name>Task 4: Stale live-only references, full verification, commit</name>
  <files>apps/web/e2e/event-scroll-regions.spec.ts, apps/web/e2e/zebra-stripe-full-row.spec.ts</files>
  <action>
    In `apps/web/e2e/event-scroll-regions.spec.ts:101`, change the `columnheader` name
    passed to `getByRole` from "Actual RP" to "Actual", keeping `exact: true`. Change
    nothing else in that test — its before/after bounding-box comparison is independent of
    where the column sits, and both of its headers still scroll, so the assertions at lines
    112-113 remain correct at the new position.

    In `apps/web/e2e/zebra-stripe-full-row.spec.ts:51`, update the `CELL_SAMPLE_COUNT` doc
    comment so the columns it names are the first four in the new order. The constant's
    value and every assertion in that file stay as they are — it samples by index, and four
    cells still spans well past the sticky-cell boundary the test exists to prove.

    Do not attempt to run Playwright. These specs hit sigmascout.org and this plan ships no
    deploy; record in the SUMMARY that both e2e edits are unverifiable until a later deploy.

    Then run the full verification below. If the full vitest run surfaces a failure in a
    file this plan did not touch, check whether it is red on `main` before this plan's
    commits (`git stash` is not needed — compare against the pre-task state you recorded)
    and report it rather than fixing it here.

    Finally commit. Stage ONLY the paths this plan lists in `files_modified`, each
    named explicitly on the `git add` line. Never use `git add -A` or `git add .` — other
    sessions have uncommitted work in this checkout, including untracked files under
    `.planning/sketches/` and `.planning/quick/260917-01e-*`. After committing, run
    `git status` and confirm those foreign paths are still untracked or still modified,
    exactly as they were. Do not push.
  </action>
  <verify>
    <automated>npx vitest run 2>&amp;1 | tail -25; npx tsc --noEmit; npx tsc --noEmit -p apps/web/tsconfig.json; test "$(grep -rE 'Predicted RP|Actual RP' apps/web/src apps/web/e2e | wc -l)" -eq 0 &amp;&amp; echo "STALE-LABEL-GATE: clean"</automated>
  </verify>
  <done>The full root vitest run reports zero failures in its printed summary; both typechecks print no errors; the stale-label gate prints clean; a single commit contains exactly the listed paths and `git status` shows the other sessions' files untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none crossed | This change is presentation-layer only: header strings, DOM cell order, and one CSS border declaration. No input is parsed, no artifact schema moves, no network call changes, no published value changes. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jaf-01 | Tampering | shared git checkout | medium | mitigate | Stage by explicit path only; verify foreign uncommitted files under `.planning/` are unchanged after the commit (Task 3). |
| T-jaf-02 | Information disclosure | rendered match cells | low | accept | No cell content changes; only the order and the two header strings move, so nothing previously hidden becomes visible. |

No package-manager installs are introduced, so no legitimacy checkpoint applies.
</threat_model>

<verification>
- `npx vitest run` from the repo root, judged by its printed summary (167 test files across
  both projects — the `apps/web` half will not run if invoked from the wrong scope).
- `npx tsc --noEmit` at the repo root AND `npx tsc --noEmit -p apps/web/tsconfig.json`;
  the root config does not cover `apps/web`, so a real web error hides behind a clean root
  run.
- No occurrence of the two old header labels remains anywhere under `apps/web/src` or
  `apps/web/e2e`, comments included.
- `git status` after the commit shows the other sessions' `.planning/sketches/` and
  `.planning/quick/260917-01e-*` files in exactly the state they started in.
</verification>

<success_criteria>
- Both match tables read Prediction and Actual where they read the old labels.
- Team order: Match, Result, Actual, Prediction, Confidence, axis, Call.
- Event order: Match, Actual, Prediction, Confidence, axis, Call — no Result column added.
- One continuous vertical rule on the left edge of the Prediction column in both tables,
  header through last row, in `var(--color-border)`, defined once and reused.
- Event skeleton header matches the loaded header, labels and rule alike.
- Column counts unchanged (7 team, 6 event); `EVENT_MATCH_TABLE_COLUMN_COUNT` still 6.
- Every `data-testid` and every cell's content unchanged.
- Each alliance's roster line, predicted line, actual line and band share one horizontal line, from one grid source (`MATCH_ROW_GRID`).
- Full suite green, both typechecks clean, one explicitly-staged commit, nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/260917-jaf-match-tables-rename-predicted-rp-to-pred/260917-jaf-SUMMARY.md` when done.

Note in the SUMMARY that the two e2e edits are live-only and unverified until a future
deploy, and that they were the only changes in this task that could not be proven locally.
</output>
