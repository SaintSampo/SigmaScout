---
phase: quick-260909-tom
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/teams-table/teamsBubbleModel.ts
  - apps/web/src/components/teams-table/teamsBubbleModel.test.ts
  - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
  - apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
  - apps/web/src/styles/theme.css
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/routes/teams.tsx
  - apps/web/src/routes/teams.test.tsx
autonomous: true
requirements: [QT-260909-tom]

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "On /teams a button labelled 'Bubble chart' swaps the teams table for a scatter of the currently filtered teams, X = the Total metric, Y = Swing Score (D-01, D-03)."
    - "The chart plots the SAME already-filtered row array the table consumes. It never re-applies a filter and never re-sorts (D-03)."
    - "Every plotted dot has the same radius. No third variable is encoded in size (D-01)."
    - "Dot colour is the rarity tier of the team's Total metric, read from the published `tier` field. A row with no published tier renders the defined neutral, never a coerced tier (D-02)."
    - "The toggle is a real <button> with the stable accessible name 'Bubble chart' and an aria-pressed state that flips, plus a visible pressed style."
    - "The toggle state lives in the URL as ?chart=bubble on the /teams route, so a chart view is bookmarkable. Absent or unrecognised resolves to the table (D-04)."
    - "A team with no Swing Score (fewer than two played matches) is omitted from the chart and counted in an on-screen note. It is never plotted at zero."
    - "No rendered text anywhere in the chart carries the algorithm's own spread, in any form, including any hover surface. The model module never reads that field at all."
    - "The whole point cloud renders as at most four SVG <path> nodes, one per tone, so ~4000 teams cost four DOM nodes rather than four thousand."
    - "The Y axis is labelled exactly 'Swing Score'."
    - "The table remains one click away at all times, and the filter controls stay mounted in chart mode."
  artifacts:
    - apps/web/src/components/teams-table/teamsBubbleModel.ts
    - apps/web/src/components/teams-table/teamsBubbleModel.test.ts
    - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
    - apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
    - apps/web/src/routes/teams.test.tsx
  key_links:
    - "routes/teams.tsx passes its existing `rows` memo straight into TeamsBubbleChart. That single shared array IS D-03. Any second filtering path is a defect."
    - "teamsBubbleModel.ts reads `row.metrics[TOTAL_KEY].tier` for colour, the same published field columns.tsx reads, so a team cannot be one tier in the table and another in the chart."
    - "TeamsSearchSchema's `chart` field is the only source of the toggle state. The component holds no local view state."
    - "The four --tier-*-mark tokens in theme.css are the only place a dot colour literal appears (D-06 token discipline)."
---

<objective>
On the Teams page, add a URL-backed bubble-chart view that replaces the table with a
scatter of every team currently passing the page's filters: X = the Total metric,
Y = Swing Score.

Purpose: give a reader the shape of the field at a glance. The table answers "how does
team N rank"; this answers "where does the field sit, and who is unusual". It is the
first view on the site that shows Swing Score against performance rather than beside it.

Output: one pure model module, one SVG chart component, four palette tokens, one new
search param, three test files.

**Decision IDs.** D-01 through D-04 below are the developer's locked decisions D1 through
D4, renumbered to the project's `D-NN` convention. They are NOT to be revisited:

- **D-01 — Bubble size is UNIFORM.** Every team renders at the same small radius. This is
  a scatter in effect. Do not encode a third variable in the radius. Rationale: ~4000
  teams at full filter width, and clutter beats a redundant channel.
- **D-02 — Colour is the rarity tier of the TOTAL metric.** Reuse the existing rarity-tier
  vocabulary so a team looks the same colour in the chart as in the table. A team with no
  published tier renders a defined neutral, never a coerced tier.
- **D-03 — Same filtered set, no re-filter.** The chart consumes the SAME already-filtered
  row array the table consumes. Sorting is irrelevant to it.
- **D-04 — Toggle state belongs in the URL** as a TanStack Router typed search param on
  `/teams`. Default is the table.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Read before writing any code:

- `Skill("sketch-findings-sigmascout")` — its `references/colour-and-tiers.md` and
  `references/chart-craft.md` are load-bearing for this task. The tier table, the
  "identity hues" line, the "THE BLUE MUST STAY SKY" rule, "derive coupled geometry",
  "colour is computable — compute it", and "text wears text tokens, never the series
  colour" all apply directly.
- `Skill("dataviz")` — load it before writing the first line of chart code. Its
  `scripts/validate_palette.js` is required by Task 2.

Source files to read (each once, extracting everything needed in that pass):

@apps/web/src/components/teams-table/rowModel.ts
@apps/web/src/routes/teams.tsx
@apps/web/src/lib/searchParams.ts
@apps/web/src/routes/districts.test.tsx

Targeted reads (use grep to find the range first, then read that range only):

- `apps/web/src/components/teams-table/columns.tsx` — the `swingColumn` (~line 428) and
  the metric column's `cell` (~line 400). Reuse their accessor and label vocabulary; do
  not re-derive it.
- `apps/web/src/styles/theme.css` — the `--tier-*` token block (~line 175) and the
  `.metric-tier--*` rules (~line 743). The new tokens and classes go beside them and
  copy their shape.
- `apps/web/src/lib/metricKeys.ts` — `TOTAL_KEY`.
- `apps/web/src/lib/metricLabels.ts` — `metricDisplayLabel`.
- `apps/web/src/components/team/MetricHistoryChart.tsx` lines 1..60 — the
  measure-with-a-sane-fallback sizing pattern (`useLayoutEffect` + ref + a fallback
  constant, because jsdom always measures 0). Copy that pattern; do NOT copy its Recharts
  usage, see the rendering decision below.
</context>

<ground_truth>
Verified against HEAD before planning. Trust these; re-read the files for exact names.

- `TeamRow` (rowModel.ts) already carries BOTH axes: X is `row.metrics[TOTAL_KEY]?.value`,
  Y is `row.swingScore`. No new published field is needed and none may be added — this is
  a UI-only change. No pipeline, no publish, no R2, no artifact schema change.
- `row.swingScore` is OPTIONAL — absent for a team with fewer than two played matches.
- On the WIRE the field is named `swingFactor`; `buildTeamRows` renames it to `swingScore`.
  Test fixtures built at the artifact level must use `swingFactor`.
- The teams-table artifact carries a compact `tier` (`"rare" | "epic" | "legendary"`) per
  metric, NOT a `percentile`. `tier` is OMITTED for Common and for unranked alike — the
  client cannot tell those two apart. See the colour section below for what that means.
- Recharts 3.10.1 is a dependency of `apps/web`. This plan adds NO new dependency of any
  kind.

**VOCABULARY — three distinct terms. Do not conflate them (recorded project rule):**

- **Swing Score** — the per-team published number. This is the Y axis. Label it exactly
  "Swing Score".
- **Match Band** — a different concept entirely. It does not appear in this work.
- **spread** — the algorithm's own internal confidence, living on `metrics[key].spread`.
  It MUST NEVER be rendered to the screen anywhere, in any view, including any hover
  surface. This plan enforces that structurally: the model module never reads the field,
  and a test asserts no built point object carries it.
</ground_truth>

<rendering_decision>
**Do not use Recharts for this chart.** This is a deliberate departure from the project's
default charting library and the reason must survive into the code as a comment.

Recharts' `<Scatter>` mounts one React component and one SVG node per point. At the real
2026 field size (3,709 teams, per `colour-and-tiers.md`'s measured distribution) that is
~3,700 components rebuilt on every filter change and every resize, on the page whose stated
top priority is load and interaction speed. `MetricHistoryChart.tsx` correctly stays on
Recharts because it plots one team's season — tens to low hundreds of points.

Instead: a hand-rolled SVG, with the entire point cloud drawn as **one `<path>` per tone**
— at most four `<path>` nodes total, regardless of team count. Concretely, each dot is an
arc-pair circle subpath concatenated into that tone's `d` string:

    M{cx},{cy}m-{r},0a{r},{r} 0 1,0 {2r},0a{r},{r} 0 1,0 -{2r},0

Round `cx`/`cy` to one decimal to keep the string tight. Use the DEFAULT `fill-rule`
(nonzero) and state that in a comment: two overlapping dots inside one path would punch a
hole under `evenodd`. All subpaths wind the same direction, so nonzero unions them.

Do NOT use the zero-length-subpath-with-round-linecap dot trick. It is shorter but it
depends on a stroke-rendering corner of the spec, and a silent failure there is a blank
chart.

Axis tick generation is the one thing Recharts would have given for free, so it is written
here as a pure, unit-tested function instead — which is a net gain, since Recharts' tick
values are opaque to a test.

**No tooltip and no per-point hover.** That is the whole reason the point cloud costs four
DOM nodes. It is a decision, not an omission: D-01's own rationale is that clutter is the
enemy at this density, and the table with its per-team rows and links is one click away.
</rendering_decision>

<colour_decision>
D-02 says two things that need reconciling against what the wire actually carries, so the
reconciliation is settled here rather than left to the executor.

The teams artifact omits `tier` for Common AND for unranked, indistinguishably. The TABLE
resolves that ambiguity by coercing to Common (`?? "common"`, quick task 260904-7rt) — but
in the table the Common ring is *redundant*: a reader who cannot resolve the hairline still
sees the number. `colour-and-tiers.md` says that reasoning explicitly does not transfer to
any tier "whose ring would be its only signal". On a scatter, the dot IS the only signal.

So the chart resolves it the other way and D-02's two sentences both hold:

- A row whose Total metric carries a published `tier` renders that tier's mark colour.
- A row whose Total metric carries no `tier` renders **one defined neutral**, labelled
  honestly in the key as "Common / unranked". This is never coerced to Common.
- This still satisfies "same colour as the table": the table's Common is also colourless
  (hairline ring, no fill, text inherits). Neither surface claims a tier it cannot prove.
- A row with no Total metric at all has no X value and is omitted from the chart entirely.

**Mark colours are computed, not picked.** `colour-and-tiers.md` names "identity hues (for
legends, chips, and anywhere the tier needs a solid colour): sky `#0EA5E9` · purple
`#9333EA` · amber `#F59E0B`", validated as a trio at ΔE 14.1 deutan / 22.7 tritan / 26.5
normal. A small dot on the white surface has a second requirement the identity trio was
never checked against: legibility. Task 2 resolves this with the validator, under a
deterministic rule stated there. Do not eyeball it and do not skip it.
</colour_decision>

<tasks>

<!--
  No tracer task. Tracer-first exists to surface an architectural dead end on the agent's
  best early-context tokens, and there is no architecture at risk here: this is one new
  component slotted into an already-working route beside an already-working table, using
  data already on the row. The three tasks below are ordered pure model, then component,
  then wiring, so each one's tests run against something real before the next depends on it.
-->

<task type="auto" tdd="true">
  <name>Task 1: teamsBubbleModel.ts — the pure projection, tones, omissions and axes</name>
  <files>apps/web/src/components/teams-table/teamsBubbleModel.ts, apps/web/src/components/teams-table/teamsBubbleModel.test.ts</files>
  <read_first>
    `rowModel.ts` for the exact `TeamRow` shape (`metrics`, `swingScore`, `teamKey`,
    `teamNumber`, `nickname`). `lib/metricKeys.ts` for `TOTAL_KEY`. Note D-03: this module
    takes rows as given and must not filter or reorder them.
  </read_first>
  <behavior>
    - `buildBubbleModel` returns one point per row that has BOTH a Total value and a Swing Score, in input order.
    - A row with `swingScore: undefined` produces no point and increments `omittedNoSwing`. No point is ever emitted with `y === 0` for such a row.
    - A row whose `metrics[TOTAL_KEY]` is absent produces no point and increments `omittedNoTotal`.
    - `tone` is the published tier for rows that have one; a Total metric with no `tier` yields `"neutral"`, never `"common"`.
    - Given a row whose Total metric carries the algorithm's own confidence field, the built point object's own keys do not include it.
    - `niceAxis` returns a domain whose first and last ticks ARE the domain edges, and at least two ticks.
    - `niceAxis` on a zero-width range (every value identical, including all-zero) still returns a usable domain and at least two ticks, never a degenerate `[v, v]`.
    - `tonePathData` emits exactly one `M` command per point and returns the empty string for an empty group.
    - A point at the domain minimum projects to the plot rect's left/bottom edge; a point at the maximum projects to the right/top edge (Y is inverted in SVG coordinates).
  </behavior>
  <action>
Create a pure module. No React import, no TanStack import, no DOM access — the same
discipline `rowModel.ts` keeps.

Export, in this shape:

- `export type BubbleTone = "neutral" | "rare" | "epic" | "legendary";`
- `export const BUBBLE_TONE_DRAW_ORDER: readonly BubbleTone[] = ["neutral", "rare", "epic", "legendary"];`
  Document why the order is load-bearing: at the real field size Legendary is 186 teams
  against 1,856 Common, so painting neutral first and Legendary last is what keeps the
  rare tiers from being buried. This constant is the single source of both the draw order
  and the key row's order.
- `export interface BubblePoint { teamKey: string; teamNumber: number; nickname: string; x: number; y: number; tone: BubbleTone }`
  Document that `x` is the Total metric value and `y` is the Swing Score, and that the
  algorithm's own confidence field on the source metric is deliberately never copied onto
  this object — that absence is what makes the never-render rule structural rather than a
  convention a future edit could break.
- `export interface BubbleAxis { domain: readonly [number, number]; ticks: readonly number[]; decimals: number }`
  `decimals` is the one source every tick label on that axis formats with.
- `export interface BubbleModel { points: readonly BubblePoint[]; omittedNoSwing: number; omittedNoTotal: number; x: BubbleAxis; y: BubbleAxis }`
- `export interface PlotRect { left: number; top: number; width: number; height: number }`
- `export const BUBBLE_CHART` — a frozen constants object holding `height`,
  `fallbackWidth`, `marginTop`, `marginRight`, `marginBottom`, `marginLeft`, `dotRadius`
  and `targetTickCount`. Suggested values: height 420, fallbackWidth 880, margins
  12/16/48/64 (top/right/bottom/left — bottom and left hold the tick labels and axis
  titles), dotRadius 2.5, targetTickCount 6. Every geometric number in the component comes
  from here. Cite chart-craft.md's "derive coupled geometry; never hand-tune both ends" in
  the comment: the plot rect, the tick positions and the dot positions must all descend
  from this one object or they will drift.
- `export function plotRectFor(width: number): PlotRect` — derives the plot rect from
  `width` and `BUBBLE_CHART`. Clamp width and height to a non-negative minimum so a
  collapsed container cannot produce negative geometry.
- `export function niceAxis(min: number, max: number, targetTickCount: number): BubbleAxis`
  — 1/2/5×10^k step selection: raw step is `(max - min) / targetTickCount`, chosen step is
  the smallest 1/2/5×10^k at or above it; `lo = Math.floor(min / step) * step`,
  `hi = Math.ceil(max / step) * step`; generate ticks by index (`lo + i * step`) rather
  than by repeated addition, and round each to `decimals` so floating-point drift never
  produces a tick label like `0.30000000000000004`. `decimals` is
  `Math.min(2, Math.max(0, -Math.floor(Math.log10(step))))`. Handle `min === max` by
  widening to `[min - 0.5, min + 0.5]` before the step selection.
- `export function buildBubbleModel(rows: readonly TeamRow[]): BubbleModel` — single pass
  over `rows` in the order given, no sort, no filter beyond the two omission cases. Read
  `row.metrics[TOTAL_KEY]` once per row; take `value` for `x` and `tier ?? "neutral"` for
  `tone`; take `row.swingScore` for `y`. Axes come from the SURVIVING points only. When
  there are no points, return axes built from `niceAxis(0, 1, ...)` so the caller never
  has to special-case an undefined axis. Per D-02, do not import `tiers.ts`'s
  `tierForPercentile` here — the teams artifact publishes `tier` directly and there is no
  percentile on this row to derive from.
- `export function tonePathData(points, x: BubbleAxis, y: BubbleAxis, plot: PlotRect): string`
  — projects each point and concatenates the arc-pair circle subpath given in this plan's
  rendering-decision section, coordinates rounded to one decimal. Returns `""` for an
  empty input. Put the nonzero fill-rule warning in this function's doc comment, beside
  the code it constrains.

Cite D-01, D-02 and D-03 in the module header: uniform radius means this module emits no
size channel at all; tone comes from the published tier with a neutral fallback; the row
array arrives already filtered and is neither re-filtered nor reordered here.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts</automated>
    Run from the REPO ROOT, not from apps/web (a recorded project trap: apps/web sees 77
    files, the root sees 167). Judge by the printed pass/fail counts, never by exit code —
    do not wrap it in `timeout`, which swallows output and exits 0.
  </verify>
  <done>
    Nine behaviors above have a test each and all pass. The module imports no React, no
    TanStack and no DOM API. A grep of the module for the algorithm's confidence field name
    returns nothing.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: the four mark tokens, and TeamsBubbleChart.tsx</name>
  <files>apps/web/src/styles/theme.css, apps/web/src/components/teams-table/TeamsBubbleChart.tsx, apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx</files>
  <read_first>
    `theme.css`'s `--tier-*` block and `.metric-tier--*` rules — the new tokens and classes
    sit beside them and copy their shape and their comment discipline.
    `MetricHistoryChart.tsx` lines 1..60 for the measured-width pattern.
    Load `Skill("dataviz")` before writing chart code or choosing any colour.
  </read_first>
  <behavior>
    - Renders exactly one path per NON-EMPTY tone, and the count of `M` commands in each path's `d` equals that tone's point count.
    - Those paths appear in the DOM in BUBBLE_TONE_DRAW_ORDER, neutral first and legendary last.
    - With rows whose Swing Score is absent, an on-screen note names the count and says the reason is fewer than two played matches. The note is absent when nothing was omitted.
    - With rows carrying no Total metric, a second note names that count separately.
    - With zero plottable points, an empty-state message renders and no tone path is emitted.
    - The svg carries role="img" and an accessible name naming both axes and the plotted team count.
    - The Y axis title text is exactly "Swing Score".
    - The X axis title is the same label the table's Total column header uses.
    - The rendered text of the whole component contains no plus-minus glyph and no occurrence of the algorithm's own confidence field name, given rows whose Total metric carries one.
    - A row whose Total metric has no published tier lands in the neutral tone path, not the rare/epic/legendary ones.
    - The key row lists four entries in draw order, the first labelled for the ambiguous Common-or-unranked case.
  </behavior>
  <action>
**Step 1 — compute the palette before writing it.** Run the dataviz skill's
`scripts/validate_palette.js` and apply this deterministic rule:

1. Candidate set A is the skill's identity hues: sky `#0EA5E9`, purple `#9333EA`, amber
   `#F59E0B`. Candidate set B is the existing `--tier-*-fg` values: `#0369A1`, `#7E22CE`,
   `#B45309`.
2. A mark set is admissible only if BOTH hold: every pair separates by ΔE at least 8 under
   normal, deutan, protan and tritan; and every member reaches at least 3:1 contrast
   against `--color-bg-surface` (`#ffffff`), the WCAG 1.4.11 non-text floor a small dot
   must clear because here the dot is the only signal.
3. Test set A first — it is the skill's stated answer for "anywhere the tier needs a solid
   colour". If any member of A fails the contrast floor, use set B **for all three**. Never
   mix members of A and B; a half-swapped trio has not been validated as a trio.
4. Then add the neutral. Start from slate-500 `#64748B` and re-run the validator over all
   four marks together, all pairs. If the neutral fails against any tier mark, darken or
   lighten it along the slate ramp until all four pass — do not add chroma, the neutral
   must stay visibly the quiet one. Do NOT reuse `--tier-common-edge` (`#CBD5E1`): it is
   ~1.4:1 on white, and `colour-and-tiers.md` states in as many words that its
   low-contrast precedent does not transfer to a mark that is the only signal.
5. Paste the validator's actual ΔE and contrast numbers into the token block's comment, the
   way the existing `--compare-algo-*` block records its own run. A future reader must be
   able to see that this was computed, and re-run it.

**Step 2 — the tokens and classes.** In `theme.css`, beside the existing tier tokens, add
`--tier-neutral-mark`, `--tier-rare-mark`, `--tier-epic-mark`, `--tier-legendary-mark`
holding the four values from step 1. Then, beside `.metric-tier--*`, add one class family:

    .bubble-tone--neutral   { fill: var(--tier-neutral-mark);   background-color: var(--tier-neutral-mark); }

...and the same for rare, epic and legendary, plus a shared `.bubble-tone { fill-opacity: 0.8 }`.
Setting both `fill` and `background-color` in one rule is intentional and must be
commented: an SVG `<path>` uses the `fill` and ignores the background, an HTML `<span>` in
the key row does the reverse, so one class family serves both and the mark colour and the
key swatch colour cannot drift apart. Component code must reference these classes, never a
colour literal (D-06 token discipline). Note in the comment that `fill-opacity` on a single
path does NOT darken where two dots of the SAME tone overlap — this chart is not a density
plot and no copy anywhere may read as if it were; the opacity exists only so a lower tone
layer shows through an upper one.

**Step 3 — the component.** `export function TeamsBubbleChart({ rows }: { rows: readonly TeamRow[] })`,
a named export, statically imported (unlike `MetricHistoryChart`, which is dynamically
imported to keep Recharts out of the eager bundle — this component pulls in no library at
all, so a static import is right; say so in the header comment).

Sizing: copy `MetricHistoryChart.tsx`'s pattern exactly — a `useLayoutEffect` reading the
container ref's real width, falling back to `BUBBLE_CHART.fallbackWidth` where the measured
width is 0 (jsdom always measures 0). Do not reach for a resize-observing container.

Body:

- `const model = useMemo(() => buildBubbleModel(rows), [rows]);`
- `const plot = useMemo(() => plotRectFor(width), [width]);`
- Group `model.points` by tone once, then `tonePathData` per tone, both memoized on
  `[model, plot]`. At ~4000 points the `d` strings are the only real work this component
  does; they must not rebuild on an unrelated render.
- If `model.points.length === 0`, render only the empty-state message (and the omission
  notes, which are exactly what explain the emptiness) — no `<svg>`, no tone paths.
- Otherwise render `<svg role="img" aria-label={...} width={width} height={BUBBLE_CHART.height} viewBox={...}>`
  containing, in order: the gridlines and tick labels for both axes, then the tone paths in
  `BUBBLE_TONE_DRAW_ORDER` (skipping empty groups), then the two axis titles. Every
  coordinate derives from `plot`, `model.x`, `model.y` and `BUBBLE_CHART` — no literal
  offsets in the JSX.
- Each tone path: `<path key={tone} data-tone={tone} className={cn("bubble-tone", \`bubble-tone--${tone}\`)} d={d} />`.
  The `data-tone` attribute is what the test counts on; keep it.
- Gridlines use `stroke="var(--color-border)"`; tick labels and axis titles use
  `fill="var(--color-text-muted)"`. chart-craft.md: text wears text tokens, never the
  series colour.
- X axis title: `metricDisplayLabel(TOTAL_KEY)`, imported, never a re-typed literal. Y axis
  title: the literal string `Swing Score`, rendered rotated -90 in the left margin. Per the
  recorded vocabulary rule the axis says the full name even though the table column
  abbreviates it to fit; the axis has room.
- `aria-label`: name the plotted count and both axes, e.g. a sentence covering "N teams",
  "horizontal axis" + the Total label, "vertical axis Swing Score".
- The key row, rendered as ordinary HTML above the svg (not inside it), iterating
  `BUBBLE_TONE_DRAW_ORDER`: a swatch `<span>` wearing `bubble-tone bubble-tone--{tone}` plus
  a text label. Labels: `Common / unranked`, `Rare`, `Epic`, `Legendary`. The first label is
  deliberately not "Common" — see this plan's colour-decision section; the wire cannot
  distinguish the two cases and the key must not claim it can.
- The omission notes, rendered as muted `<p>` elements below the svg, one per non-zero
  count. Copy must state the reason, e.g. "142 teams are not plotted: they have played
  fewer than two matches, so they have no Swing Score." and, separately, "N teams are not
  plotted: they carry no Total for this algorithm." Never imply an omitted team's Swing
  Score is zero.

Cite D-01 in the comment on `BUBBLE_CHART.dotRadius`: uniform by decision, not by
oversight, because ~4000 teams at full filter width make a size channel pure clutter.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx</automated>
    Run from the REPO ROOT. Judge by the printed counts, not the exit code; do not wrap in
    `timeout`.

    The two negative behaviors (no plus-minus glyph, no confidence-field name in rendered
    text) are asserted against the rendered container's `textContent`, NOT by grepping any
    source file — a source grep would trip over this module's own explanatory comments.
  </verify>
  <done>
    Eleven behaviors above have a test each and all pass. The validator run's ΔE and
    contrast numbers are recorded in theme.css. No colour literal appears in
    TeamsBubbleChart.tsx. A ~4000-point render produces at most four elements carrying
    `data-tone`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: the ?chart=bubble search param, the toggle, and the route swap</name>
  <files>apps/web/src/lib/searchParams.ts, apps/web/src/routes/teams.tsx, apps/web/src/routes/teams.test.tsx</files>
  <read_first>
    `searchParams.ts`'s `TeamsSearchSchema` — in particular the existing `cols` field,
    which this new field copies exactly, and the module header's rule about `view`.
    `routes/teams.tsx` in full. `routes/districts.test.tsx` for this repo's route-test
    pattern: a self-contained tree built with `Route.update({...})`, a
    `QueryClientProvider`, and `global.fetch` stubbed with URL-matched `Response` objects.
  </read_first>
  <behavior>
    - With no chart param, /teams renders the table and not the chart.
    - Arriving at /teams?chart=bubble renders the chart and not the table, with no click needed.
    - Clicking the toggle from the table view writes chart=bubble into the router's location search and swaps the view.
    - Clicking it again removes the param and restores the table.
    - The toggle is a button whose accessible name is "Bubble chart" in both states, with aria-pressed false then true.
    - ?chart= carrying an unrecognised value resolves to the table.
    - With a region filter active, the number of dots the chart plots equals the number of filtered rows that have both a Total and a Swing Score, proving the chart consumes the table's own filtered array (D-03).
    - applyYearChange preserves the chart param across a year change.
  </behavior>
  <action>
**searchParams.ts.** Add one field to `TeamsSearchSchema`, copying `cols`'s shape exactly:

    chart: z.literal("bubble").optional().catch(undefined),

Give it a doc comment in the same voice as its neighbours, and make it answer the question
a reader WILL ask, because this module's own header says "Do not add a `view` field here:
the route segment already IS that fact". State that this field is not that: it selects
which VISUALISATION of the same filtered rows to draw, while the page-view fact stays the
pathname, which is `/teams` in both modes. There is no second source of the page view here.
Note that `applyYearChange` touches only the literal key `sort` and spreads everything else
through, so this field survives a year change with no change to that function. Cite D-04.

**routes/teams.tsx.**

- Destructure `chart` from `Route.useSearch()`; `const isChart = chart === "bubble";`.
- Add `handleChartToggle`, using the updater form exactly like `handleViewToggle` so year,
  algorithm, sort and the three region filters all survive:
  `navigate({ search: (prev) => ({ ...prev, chart: prev.chart === "bubble" ? undefined : "bubble" }) })`.
- In the heading row, render the toggle UNCONDITIONALLY (unlike the `cols` toggle, which is
  gated on `canToggleView`) so the chart view is always reachable. It is a
  `<button type="button" data-testid="teams-chart-toggle" aria-pressed={isChart}>` whose
  visible text is the stable string `Bubble chart` in both states. Do NOT flip the label
  with the state — a control that carries `aria-pressed` must keep a stable name, or a
  screen-reader user hears the state twice and in contradiction. Give the pressed state a
  visible style too (accent border and inset background, reusing existing tokens), so the
  state is not announced-only.
- Hide the existing `cols` toggle while `isChart` — it changes only table columns and would
  be a control with no effect. Gate it on `canToggleView && !isChart`.
- Keep `TeamsFilters` mounted in both modes. It is what D-03's "currently passing the page's
  filters" is steered by, and hiding it would strand a reader in an empty chart.
- Swap the body: `{isChart && status === "success" ? <chartWrapper/> : <TeamsTable ... />}`.
  Comment why the `status === "success"` half of that condition is there rather than
  duplicated inside the chart: `TeamsTable` already owns the loading skeleton, the error
  state with its retry, and the filtered-to-zero empty state with its Clear-filters link.
  Falling back to it for every non-success status means chart mode inherits all four
  behaviours for free and none of them get a second, drifting implementation.
- The chart wrapper needs a declared width: the centred column is `mx-auto flex w-fit`,
  which takes the width of its widest child, and the svg has no intrinsic width to give it.
  Wrap it in `<div className="w-[1100px] max-w-full">` and comment that reasoning — without
  it the column collapses.

**routes/teams.test.tsx** (new). Follow `districts.test.tsx`: build a self-contained tree
with `TeamsRouteImport.update({ id: "/teams", path: "/teams", getParentRoute: () => rootRoute })`,
wrap in `QueryClientProvider` with `retry: false`, and stub `global.fetch` matching on the
URL — one branch returning the algorithms manifest (`useAlgorithmVersion`'s gate, without
which the artifact query never fires) and one returning a teams artifact.

The fixture artifact needs at least: two teams with a Total and a `swingFactor` in
different countries, one team with a Total and a published `tier` but NO `swingFactor`, and
one team with a Total whose metric carries NO `tier`. Remember the wire field is
`swingFactor`, not `swingScore`. Give the metrics a value under the `total` key.

Count dots by collecting every `[data-tone]` node and summing the `M` occurrences in their
`d` attributes; write that as one small helper at the top of the file and reuse it.

For the last behavior, import `applyYearChange` from `searchParams.js` and assert directly
on its return value — a pure-function assertion, no rendering needed.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/routes/teams.test.tsx</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>npx vitest run</automated>
    All from the REPO ROOT. Both typechecks are required: a recorded project trap is that
    the root `tsc --noEmit` returns clean while `apps/web` has real errors, so the root run
    alone proves nothing about this change. The final full-suite run must be read by its
    printed file and test counts — the root config sees both projects (~167 files) where a
    run from `apps/web` sees ~77. Do not wrap any of these in `timeout`.
  </verify>
  <done>
    Eight behaviors above have a test each and all pass. Both typechecks are clean. The full
    suite is green with three new test files and no previously passing test broken, judged
    by the printed counts.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL → route | Hand-edited or shared search params reach `TeamsSearchSchema` before any component reads them |
| R2 artifact → client | Published JSON reaches `buildTeamRows` and then this chart's model |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260909-tom-01 | Tampering | `TeamsSearchSchema.chart` | low | mitigate | `z.literal("bubble").optional().catch(undefined)` — the field is structurally incapable of holding a value other than `"bubble"` or absent, so a hand-edited param can only ever resolve to one of the two declared view states (the same T-05-02 discipline every other field on this schema keeps) |
| T-260909-tom-02 | Information disclosure | `teamsBubbleModel.ts` | medium | mitigate | The algorithm's own confidence field must never reach a screen. Mitigated structurally rather than by convention: the model never reads it, `BubblePoint` has no field to hold it, and Task 1 and Task 2 each carry a test asserting its absence — one on the built object's keys, one on the rendered `textContent` |
| T-260909-tom-03 | Denial of service | `TeamsBubbleChart.tsx` | medium | mitigate | A ~4000-team unfiltered render is the realistic worst case, not a hypothetical. Bounded by construction: the point cloud is at most four `<path>` nodes regardless of team count, and the `d` strings are memoized on `[model, plot]` so a filter change rebuilds them once, not per render |
| T-260909-tom-04 | Repudiation | `theme.css` mark tokens | low | mitigate | The palette claim ("these four marks are CVD-safe and legible") is recorded with the validator's actual ΔE and contrast numbers in the token comment, so a later reader can re-run and check it rather than take it on trust |
| T-260909-tom-SC | Tampering | package installs | n/a | accept | This plan adds no dependency of any kind — Recharts is already present and is deliberately not used here. No package-legitimacy checkpoint applies |
</threat_model>

<verification>
Automated, all from the repo root, judged by printed output and never by exit code:

1. `npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts`
2. `npx vitest run apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx`
3. `npx vitest run apps/web/src/routes/teams.test.tsx`
4. `npx tsc --noEmit -p apps/web/tsconfig.json`
5. `npx tsc --noEmit`
6. `npx vitest run` — the full suite, both projects, read by file and test counts

Developer visual check before considering this shipped (`chart-craft.md`: "Render it and
look at it — the validator checks colour, not layout"). Per the recorded local-verification
recipe, start the dev server with `VITE_ARTIFACT_ORIGIN=local` on a fresh port and open
`/teams?year=2026&algorithm=bpr` unfiltered — the ~3,700-team case, which is the only one
that proves the perf claim and the only one that shows what the real distribution looks
like:

- The chart appears within a frame or two of the toggle click, and the page does not jank.
- Legendary and Epic dots are visible on top of the neutral mass, not buried.
- The four key swatches are distinguishable from each other, and every dot is visible
  against the white surface.
- The omitted-teams note names a plausible count and gives its reason.
- Nothing on screen shows the algorithm's own confidence value.
- The URL reads `?chart=bubble`; reloading that URL lands straight on the chart.
</verification>

<success_criteria>
- `/teams` carries a `Bubble chart` toggle that swaps table for scatter, with X = Total and
  Y = Swing Score over the currently filtered set (D-01, D-02, D-03, D-04).
- The chart consumes the route's existing `rows` memo. No second filtering path exists.
- Dot radius is uniform; dot colour is the published Total tier with a defined neutral for
  the untiered case, and both are token-driven.
- The toggle state round-trips through the URL and is bookmarkable; an unrecognised value
  falls back to the table.
- Teams with no Swing Score are omitted and counted on screen, never plotted at zero.
- The algorithm's own confidence value is unreachable from this view, structurally.
- Point cloud is at most four DOM nodes at any team count.
- Three new test files pass; both typechecks clean; full suite green by printed counts.
</success_criteria>

<output>
Create `.planning/quick/260909-tom-add-a-bubble-chart-toggle-to-the-teams-p/260909-tom-SUMMARY.md` when done.
</output>
</content>
</invoke>
