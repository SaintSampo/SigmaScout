---
quick_id: 261006-lxp
description: Implement sketch 025 variant A (verdict-first drawer) on both Locks tabs
date: 2026-10-06
mode: quick
phase: quick-261006-lxp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
  - apps/web/src/components/districts/districtHistGeometry.ts
  - apps/web/src/components/districts/districtHistGeometry.test.ts
  - apps/web/src/components/districts/ledgerVerdict.ts
  - apps/web/src/components/districts/ledgerVerdict.test.ts
  - apps/web/src/components/districts/DistrictPointHistogram.tsx
  - apps/web/src/components/districts/DistrictOutcomeList.tsx
  - apps/web/src/components/districts/LedgerVerdictDrawer.tsx
  - apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx
  - apps/web/src/components/districts/LedgerParts.tsx
  - apps/web/src/components/districts/DistrictLedger.tsx
  - apps/web/src/components/districts/ChampLocksLedger.tsx
  - apps/web/src/components/districts/DistrictLedger.test.tsx
  - apps/web/src/components/districts/ChampLocksLedger.test.tsx
  - apps/web/src/components/districts/districtLedgerOutcomes.ts
  - apps/web/src/styles/theme.css
  - apps/web/e2e/districts-ledger.spec.ts
autonomous: true
requirements: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10]

estimate:
  tokens: 110000
  raw_tokens: 220000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Clicking any blue cell on District Locks or Champ Locks opens ONE drawer for that cell only: an eyebrow, a one sentence headline, figure tiles, the note 'likely = 8 of 10 runs', and one chart. No caption paragraphs, no second grand total plot, no per event or per source table."
    - "A grand total drawer's headline answers 'am I in': 'Qualifies in N of 100 runs.' with the SAME N the Status cell prints, or the status sentence for a guarantee, a Declined team, a pending run or a No call."
    - "The grand total chart draws the cutoff as a labelled dashed line ('cutoff ~N') with its likely zone hatched, and the cutoff tile shows the stat line's own figure, or a short state word where no cutoff is drawn."
    - "Histogram bars touch with no gap, an axis wider than 95 slots is binned, a bin under half a pixel is not drawn, and every x position comes from districtHistGeometry with plotW 560."
    - "Playoffs, Awards and routed Alliance selection cells show labelled chance bars with '{n} pts' or '{a} to {b} pts', and the headline names the most likely outcome."
    - "Grand total, Event total and Subtotal drawers carry one source line; category cells carry none."
    - "The Team column scrolls with the table on both Locks tabs."
  artifacts:
    - path: "apps/web/src/components/districts/ledgerVerdict.ts"
      provides: "Pure verdict model builder, grand verdict mapping, source chip builders"
      contains: "export function buildVerdictModel"
    - path: "apps/web/src/components/districts/LedgerVerdictDrawer.tsx"
      provides: "VerdictDrawer, the one pane both tabs render"
      contains: "export function VerdictDrawer"
    - path: "apps/web/src/components/districts/DistrictPointHistogram.tsx"
      provides: "Responsive SVG histogram with cutoff, hatch zone, cap label and legend"
      contains: "viewBox"
    - path: "apps/web/src/components/districts/DistrictOutcomeList.tsx"
      provides: "Labelled outcome bars as a CSS grid"
      contains: "district-ledger-verdict-outcomes"
    - path: "apps/web/src/styles/theme.css"
      provides: "The verdict drawer block, tokens only"
      contains: "end of the Locks drawer verdict block"
  key_links:
    - from: "apps/web/src/components/districts/DistrictLedger.tsx"
      to: "apps/web/src/components/districts/LedgerVerdictDrawer.tsx"
      via: "DrawerRow renders VerdictDrawer with buildVerdictModel"
      pattern: "<VerdictDrawer"
    - from: "apps/web/src/components/districts/ChampLocksLedger.tsx"
      to: "apps/web/src/components/districts/LedgerVerdictDrawer.tsx"
      via: "ChampDrawerRow renders VerdictDrawer with buildVerdictModel"
      pattern: "<VerdictDrawer"
    - from: "apps/web/src/components/districts/ledgerVerdict.ts"
      to: "apps/web/src/components/districts/LedgerParts.tsx"
      via: "cutoff tile and zone read through ledgerCutoffDisplay, category chips through openCellLines"
      pattern: "ledgerCutoffDisplay\\("
    - from: "apps/web/src/components/districts/DistrictPointHistogram.tsx"
      to: "apps/web/src/components/districts/districtHistGeometry.ts"
      via: "every x position through the adapter with VERDICT_PLOT_W"
      pattern: "VERDICT_PLOT_W"
---

# Quick task 261006-lxp: the verdict-first drawer on both Locks tabs

<objective>
Make the drawer a blue cell opens on District Locks and Champ Locks read the way sketch 025 variant A
reads: one pane for the clicked cell, top down as an answer. Eyebrow, one headline sentence, two or
three figure tiles, the note line, one chart (the histogram with the cutoff and its hatched zone, or
the outcome bars), and for totals a single source line. No captions and no computation disclosure.

THE SKETCH IS THE SPEC: `.planning/sketches/025-locks-drawer-concepts/index.html`, functions
`drawerA()`, `histSVG()`, `headline()` and the `.A` / `.A .obars` CSS. Variants B and C, the sketch
chrome and `howText()` are NOT implemented. Where this plan and the sketch disagree, the sketch wins,
except for the four corrections recorded under "Deliberate departures" below.

Scope is apps/web only: no Worker, pipeline or artifact change.

Requirement IDs are the orchestrator's numbered list: R1 one pane and the deletions, R2 layout CSS,
R3 headlines, R4 tiles, R5 histogram, R6 outcome cells, R7 source line, R8 team column not sticky,
R9 tests, R10 commits.

Tracer-first is waived for this plan, on the planner's own `--no-tracer` grounds: the architecture
(ledger rows, open cells, drawer row, adapter over the shipped axis geometry) is shipped and proven,
the change is presentational against a finished sketch, and a thin slice would force two drawers to
coexist across commits. The split is horizontal and every commit stays green: pure functions first
(additive), then the components with the two old panes adopting the new chart props, then the swap
and the deletions.

Output: the new drawer on both tabs, three commits, and the SUMMARY text returned in the final
message (the orchestrator writes and commits every `.planning` file).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/sketches/025-locks-drawer-concepts/index.html
@.planning/sketches/025-locks-drawer-concepts/README.md
@.claude/skills/sketch-findings-sigmascout/SKILL.md
@apps/web/src/components/districts/districtLedgerCopy.ts
@apps/web/src/components/districts/districtHistGeometry.ts
@apps/web/src/components/districts/DistrictPointHistogram.tsx
@apps/web/src/components/districts/DistrictOutcomeList.tsx
</context>

<rules>
These bind every task.

- STAGE BY EXPLICIT PATH ONLY (`git add <path> ...`), never `git add -A` or `.`; one commit per task;
  conventional messages carrying `261006-lxp`; never push; never stage or commit any `.planning` file.
  Run `git status` after each commit and confirm nothing you edited was left unstaged.
- Never read, cat or echo `.env` (project CLAUDE.md, Secrets handling). Nothing here needs it.
- Run vitest from the REPO ROOT with `npx vitest run <paths>`; never from apps/web (it hides about 90
  files) and never through `timeout ... pnpm ...` (swallows output, exits 0). Judge every run by its
  printed file and test counts, not by its exit code.
- TYPECHECK THREE WAYS before Task 3's commit: `npx tsc --noEmit` (root), `npx tsc --noEmit -p
  apps/web/tsconfig.json` (web; root tsc does not see apps/web), `npx tsc --noEmit -p
  apps/web/tsconfig.e2e.json`. Tasks 1 and 2 run at least the web one.
- TRIAGE EVERY TYPE ERROR. Never batch-dismiss errors as cosmetic or pre-existing: a past "cosmetic"
  red on this repo was a real live/offline divergence. Read each one, fix it or state in the SUMMARY
  exactly why it is unrelated. A test importing a constant that no longer exists gets `undefined` at
  runtime under vitest and can still PASS; only the web typecheck catches it.
- Copy discipline: every drawer string lives in `districtLedgerCopy.ts`. Flat third person. No dash
  characters (hyphen, en dash, em dash) except the en dash inside a printed numeric range. Never the
  plus-minus codepoint.
- Colour discipline: every colour in theme.css is a shipped token or a `color-mix` of shipped tokens;
  no hex, rgb or hsl literal in the new block. TSX writes no colour at all: SVG fills and strokes come
  from CSS classes. Class lists are PLAIN STRINGS, never `cn()` (tailwind-merge drops `text-role-*`).
- Faint ink is `--district-ledger-faint` (this repo has no `--color-text-faint`).
- Source-reading tests normalise CRLF first (`.replace(/\r\n/g, "\n")`): `core.autocrlf` is true here.
- Code comments describe removed things by concept and never name a removed identifier or class:
  Task 3's final gate greps the whole of `apps/web/src` for them.
</rules>

<deliberate_departures>
Four places where this plan corrects the sketch rather than copying it. Each is a sketch defect or a
case the sketch never drew; the executor implements the plan's version and the SUMMARY lists all four.

1. BAND AND ZONE EDGES. The sketch draws the band from `x(p10 - 0.5)` to `x(p90 + 0.5)`, but its own
   `quantile()` already returns slot-edge positions, so that widens the band by one slot. The shipped
   `pointPercentiles` uses the same convention (bounded in [-0.5, m + 0.5]) and the adapter maps it
   exactly, so the band and the hatch zone go through the adapter's band extent with no extra shift.
   On the 426-slot grand total the difference is under a pixel; on the 23-slot qualification axis it is
   24px.
2. THE CAP LABEL. The sketch sets `top = 6` when no cutoff is drawn and puts the cap label at
   `top - 7`, which is y = -1, outside the viewBox, so its own "66 cap" never shows. Here `top` is 20
   whenever a cutoff OR a cap label is drawn.
3. THE HATCH LEGEND ITEM appears only when the hatched zone is drawn. A cutoff drawn by the midpoint
   rule has no likely range, and a legend key for a zone that is not on the chart would describe
   nothing.
4. EYEBROW TITLES. The sketch only ever opened DCMP-row cells. On the District tab a team can have two
   open event rows (one live, one baked), and on the Champ tab both subtotals can be open, so: District
   tab per-event cells read "{Column title} at {short event name}"; Champ subtotals read "District
   subtotal" / "DCMP subtotal" (the sketch's own word); every other cell keeps the plain column title,
   as the sketch does.
</deliberate_departures>

<test_triage>
Which existing tests are REWRITTEN (same intent, new expectations), DELETED (their subject is gone),
or KEPT. Line numbers are approximate; find each by its `it(` title.

districtLedgerCopy.test.ts (Task 3, after the constants go):
- "pins the two legend keys and the likely/tilde explainer character for character": REWRITE, drop
  only the rookie bonus caption expectation.
- "says where the drawer's chance comes from...": DELETE.
- "gives each outcome list its OWN caption...": DELETE.
- "prints a contribution row's earned total, or the honest absence": DELETE.
- "carries no dash character in the two new lists' own copy": REWRITE over the outcome labels plus
  every new verdict string from Task 1.
- "gives the selection list its own caption...": REWRITE to keep only the list label pin.
- "carries no dash character in any of the route copy": REWRITE, drop the alliance caption entry.
- "names the contribution list's two rows from the SAME table...": DELETE.
- "says in the caption WHY the two subtotals do not add to the grand total": DELETE.
- "says in two sentences what the dashed rule is...": DELETE.
- "carries no dash character in any of the cutoff copy": REWRITE over the four labels, the cutoff
  figure, the likely text and the two cutoff tile words.
- "describes the district tab's simulated line as a median...": DELETE.
- "carries no dash character in any of the simulated champ cutoff copy": REWRITE, drop the two
  deleted captions.
- "never says In range or Out of range on a withheld chip, and describes the simulated line's likely
  range": REWRITE to the withheld chip half only.
- "says cutoff, never the retired wording, in the two absence captions": REWRITE to assert the retired
  word ("today") appears in none of the new verdict strings.
- Remove every import of a deleted export from the file's import list.

DistrictLedger.test.tsx, the drawer describe and the two cutoff timing describes:
- Task 2 updates (component internals changed, intent unchanged): "prints each playoff outcome's own
  point value...", "lists Rookie All Star for a ROOKIE...", "never lists an award outcome above
  Impact...", "lists the four routes in the drawer...", "leaves a settled captain ONE row in the
  drawer...": selectors move to the new outcome grid classes and values gain " pts". "prints a
  PREDICTED cutoff with a tilde...": the "drawer contains the Predicted cutoff label" assertion becomes
  "the chart's cutoff label reads `cutoff ~{printed}`".
- Task 3 REWRITES: "prints a PREDICTED cutoff..." (tile plus label, no caption), "draws both
  histograms, with the predicted cutoff on the grand total plot and its caption beneath it" (one pane),
  "draws NO cutoff and says so instead when the capacity is unpublished" (grand total, tile word),
  "pins the band-edge label to the hand-computable percentiles..." (likely and median tiles), "draws
  the grand total histogram ONCE when the grand total is the clicked cell, beside a per-event list"
  (source line), "keeps the cutoff and its caption on the grand total drawer" (label and tile), "still
  draws the grand total plot BESIDE a category cell's own pane" (INVERTED: no grand plot), the midpoint
  fallback test's drawer half ("keeps the midpoint cutoff, with no likely range..."), and the pending
  test's drawer half ("reads Pending, with no figure, no dashed rule and no range chip...").
- KEPT unchanged: "opens ONE drawer...", "tracks aria-expanded...", "uses ONE maximum per column...",
  "resolves an unknown drawer team or cell id to CLOSED...", "renders an OUTCOME LIST and no histogram
  for the Playoffs cell", "renders an OUTCOME LIST for the Awards cell...", "keeps the shipped histogram
  on Qualification and the event total", "prints no plus-minus codepoint anywhere in either outcome
  list", "is shareable...", "leaves a settled second pick with NO captain row...", "keeps the shipped
  wording and the histogram for an UNSTARTED event...".

ChampLocksLedger.test.tsx (Task 3):
- "draws the grand total ONCE beside a two row contribution list": REWRITE to one plot plus the
  source line.
- "prints the field chance the DCMP row is weighted by, in the contribution list, at a rewound
  position": REWRITE to the source line's field suffix plus the DCMP subtotal headline.
- Every other drawer test: KEPT.

apps/web/e2e/districts-ledger.spec.ts (Task 3): "the table's own region is the only horizontal
scroller and the sticky Team column holds": REWRITE so the Team cell MOVES with the scroll.
</test_triage>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Verdict copy, plotW geometry and the pure verdict model</name>
  <files>apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts, apps/web/src/components/districts/districtHistGeometry.ts, apps/web/src/components/districts/districtHistGeometry.test.ts, apps/web/src/components/districts/ledgerVerdict.ts, apps/web/src/components/districts/ledgerVerdict.test.ts</files>
  <read_first>
    - .planning/sketches/025-locks-drawer-concepts/index.html: `headline()` (lines ~342-349), `histSVG()` (~357-378), `drawerA()` (~379-393), the data model (~273-315)
    - apps/web/src/components/districts/districtLedgerCopy.ts: `districtLedgerChanceLine` and its two limit constants, `districtLedgerShortEventName`, `districtLedgerOutcomeChance`, `districtLedgerOutcomePointsRange`, `districtLedgerRookieBonusLine`, `districtLedgerCutoffFigure`, `CHAMP_LEDGER_CUTOFF_PENDING_FIGURE`, `DISTRICT_LEDGER_UNAVAILABLE_CELL`, `DISTRICT_LEDGER_OUTCOME_LIST_LABELS`, the three outcome label maps, `DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL` / `..._GRAND_PLOT_LABEL`
    - apps/web/src/components/districts/LedgerParts.tsx lines 400-575 (`ledgerCutoffDisplay`, `openCellLines`) and 680-786 (the open-cell pane's outcome branches, which this task ports)
    - apps/web/src/components/districts/districtHistGeometry.ts (whole) and apps/web/src/lib/simAxis.ts (`x`, `rankSlotWidth`, `rankBandExtent`)
    - apps/web/src/components/districts/districtLedgerOutcomes.ts exports; districtLedgerRows.ts (`DistrictLedgerCell`, `DistrictEventContribution`, `DistrictCellKind`); champLedgerRows.ts (`ChampLedgerCell`, `ChampContribution`, `ChampLedgerTeam.membership` / `grandTotalIsDistrictOnly` / `fieldChance`); predictedCutoff.ts (`LedgerCutoffView`, `SimulatedCutoffRange`); packages/core/districts/pointSummary.ts (`pointPercentiles`, `pointCellSummary`)
  </read_first>
  <behavior>
    - Grand headline: chance 0.57 gives "Qualifies in 57 of 100 runs."; 0.996 gives "Qualifies in 99 of 100 runs."; 0.049 gives "Qualifies in fewer than 5 of 100 runs."; qualified, lockedOut, declined, pending, noCall give their five fixed sentences; open gives "Likely 330–372 grand total points." from p10 330.2, p90 371.6.
    - p10 clamps at 0 and every drawer figure is an integer: p10 -0.5, p90 3.4 gives "0–3".
    - Field headline: 0.71 with p50 129.6 gives "In the field in 71 of 100 runs, and ~130 points if there."; 0.02 gives "fewer than 5".
    - Cap headline: ceiling 22, mass 0.58 gives "Finishes quals at the 22 point cap in 58 of 100 runs."
    - Outcome headline: the highest chance row wins; on an exact tie the row with more points wins.
    - Model: a Qualification cell whose p50 is at least ceiling minus 0.5 gets the cap headline, any other gets "Likely a–b qualification points."; both carry the cap label "{ceiling} cap".
    - Model: a grand total with a simulated cutoff and a likely range gets a cutoff tile "~213", a chart cutoff labelled "cutoff ~213" and a zone; a settled cutoff gets "213" and no zone; capacity unknown gets "not published", absent gets "none", pending gets "pending", unavailable gets "not available", and none of those four draws a cutoff.
    - Grand verdict mapping: a rangeCall beats every status; then a printed chance; then Locked or Prequalified (award variants included), Locked out, Declined; anything else is open.
    - Source chips (District): settled events sum into one earned chip naming them in order, each open event adds a predicted chip, a rookie bonus adds "+10 rookie bonus".
    - Source chips (Champ): the DCMP chip carries ", in the field 71% of runs" only while the field chance is under 1, reads ", in the field <5% of runs" below the floor, and becomes "district points only" for a team out of the field, a district-only grand total, or an unpriced DCMP.
    - Adapter: bins over 0..425 at plotW 560 are 5 slots wide, tile the axis edge to edge with no gap (first left 0, last right 560), and match direct `simAxis` calls; a point mass band is at least 3 wide and stays inside the box; axis ticks follow the 100/50/20/10 ladder.
    - Guard: DistrictPointHistogram.tsx, comments stripped, never names the shared rank geometry module.
  </behavior>
  <action>
Write the tests first for each part (RED), then the code (GREEN). Everything here is ADDITIVE: no
existing export is removed or renamed in this task, so every current consumer still compiles.

PART A, districtLedgerCopy.ts: append a new section headed "The verdict drawer (sketch 025 variant
A)", flat third person, no dash characters except the en dash in numeric ranges. Exact strings:
- `DISTRICT_LEDGER_VERDICT_NOTE` = "likely = 8 of 10 runs".
- `DISTRICT_LEDGER_VERDICT_TILE_LABELS` = { median: "median", likely: "likely", cutoff: "cutoff",
  mostLikely: "most likely", chanceOfPoints: "chance of points" }.
- `DISTRICT_LEDGER_VERDICT_LEGEND` = { bars: "how often each total came up", band: "likely range",
  tick: "median", cutoff: "cutoff", zone: "where the cutoff lands in 8 of 10 runs" }.
- `DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS` = { capacityUnknown: "not published", absent: "none" }.
  These two words, plus the existing pending figure and the existing unavailable word, are where the
  four retired cutoff-absence captions survive (R1): as the cutoff tile's value and nowhere else.
- `DISTRICT_LEDGER_VERDICT_CELL_TITLES` = { grandTotal: "Grand total", eventTotal: "Event total", qual:
  "Qualification", alliance: "Alliance selection", elim: "Playoffs", award: "Awards" } (a test pins each
  equal to its `DISTRICT_LEDGER_COLUMN_LABELS` entry).
- `CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES` = { district: "District subtotal", dcmp: "DCMP subtotal" }.
- `DISTRICT_LEDGER_VERDICT_POINT_NOUNS` = { grandTotal: "grand total", qual: "qualification", alliance:
  "alliance selection", elim: "playoff", award: "award", district: "district", dcmp: "DCMP" }.
- `DISTRICT_LEDGER_VERDICT_CHIP_LABELS` = { qual: "Quals", alliance: "Alliance", elim: "Playoffs", award:
  "Awards" } (the sketch's own chip words).
- `CHAMP_LEDGER_VERDICT_SOURCE_WORDS` = { districtEarned: "earned at district events",
  districtPredicted: "predicted at district events", dcmpEarned: "earned at the DCMP", dcmpPredicted:
  "predicted at the DCMP", districtOnly: "district points only" }.
- type `LedgerGrandVerdict` = { kind: "chance"; chance: number } or { kind: "qualified" | "lockedOut" |
  "declined" | "pending" | "noCall" | "open" }.
- `districtLedgerVerdictRuns(chance)`: "fewer than 5" when chance × 100 is under
  `DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT` (tested before rounding, exactly as `districtLedgerChanceLine`
  does), else String(min(round(chance × 100), `DISTRICT_LEDGER_CHANCE_CEILING_PERCENT`)). Reuse the two
  existing constants; never restate 5 or 99.
- `districtLedgerVerdictMedian(p50)` = "~{round(max(0, p50))}"; `districtLedgerVerdictLikelyRange(p10,
  p90)` = "{round(max(0, p10))}–{round(max(0, p90))}" (en dash).
- `districtLedgerVerdictGrandHeadline(verdict, p10, p90)`: chance gives "Qualifies in {runs} of 100
  runs."; qualified "Already qualified."; lockedOut "Cannot qualify on points."; declined "Earned a place
  and is not in the field."; pending "Chance still being simulated."; noCall "No call at this
  position."; open gives the likely headline with the grandTotal noun ("Likely a–b grand total
  points."). The open arm is this plan's choice for a team with no printed chance and no guarantee
  (capacity unpublished, or the chance run not landed): the sketch never drew it.
- `districtLedgerVerdictLikelyHeadline(p10, p90, noun)` = "Likely {range} {noun} points.".
- `districtLedgerVerdictEventTotalHeadline(p10, p90, eventName)` = "Likely {range} points at {short
  name}." (shortens through `districtLedgerShortEventName`).
- `districtLedgerVerdictFieldHeadline(fieldChance, p50)` = "In the field in {runs} of 100 runs, and
  ~{round(max(0, p50))} points if there.".
- `districtLedgerVerdictCapHeadline(ceiling, massAtCeiling)` = "Finishes quals at the {ceiling} point
  cap in {round(100 × mass)} of 100 runs.".
- `districtLedgerVerdictOutcomeHeadline(label, chance)` = "{label} in {round(100 × chance)} of 100
  runs." (unclamped: the outcome rows are counts, as in the sketch).
- `districtLedgerVerdictChanceOfPoints(chance)` = "{round(100 × chance)}%".
- `districtLedgerVerdictEyebrow(cellTitle, teamNumber, nickname)` = "{cellTitle} · {teamNumber}
  {nickname}"; `districtLedgerVerdictEventCellTitle(title, eventName)` = "{title} at {short name}".
- `districtLedgerVerdictCutoffLabel(figure)` = "cutoff {figure}"; `districtLedgerVerdictCapLabel(ceiling)`
  = "{ceiling} cap".
- `districtLedgerVerdictEarnedAt(eventNames)` = "earned at {short names joined with ', '}";
  `districtLedgerVerdictPredictedAt(eventName)` = "predicted at {short name}".
- `champLedgerVerdictFieldSuffix(chance)` = ", in the field {N}% of runs" with N clamped by the same
  two constants, and ", in the field <5% of runs" below the floor.
- `districtLedgerOutcomePointsLabel(points, pointsHigh?)` = "{districtLedgerOutcomePointsRange(points,
  pointsHigh ?? points)} pts" ("30 pts", "27 to 48 pts").
Tests in districtLedgerCopy.test.ts: pin every string above character for character, the clamp edges
(0.049, 0.05, 0.994, 0.996, 1), the tie-free headline forms, and a no-dash check over every new
constant and every function output except the en dash inside a range.

PART B, districtHistGeometry.ts: add, re-deriving nothing that `simAxis` already provides:
- `VERDICT_PLOT_W = 560` and `VERDICT_GEOMETRY` = { PLOT_H: 84, AXIS_H: 16, BOTTOM_PAD: 4, TOP_MARKED:
  20, TOP_PLAIN: 6, BAR_MAX_H: 82, BAND_MIN_W: 3, BIN_TARGET: 95, LABEL_GAP: 5, LABEL_EDGE: 80,
  LABEL_RISE: 7, LINE_RISE: 2, TICK_LABEL_DROP: 13 } as const (every number is the sketch's own).
- `pointBinSize(maxPoints)` = max(1, ceil(pointSlots(maxPoints) / BIN_TARGET)).
- `pointBinExtent(from, to, maxPoints, plotW = PLOT_W)`: ONE touching bar from value `from`'s slot left
  edge to value `to`'s slot right edge, computed as `x(from + 1, slots, plotW) - half` to `x(to + 1,
  slots, plotW) + half` where half is `rankSlotWidth(slots, plotW) / 2` (import `rankSlotWidth` from
  simAxis here; the adapter is the one file allowed to). No gap, unlike `pointBarExtent`.
- `pointVerdictBandExtent(p10, p90, maxPoints, plotW = PLOT_W)`: `pointBandExtent` widened about its
  centre to `VERDICT_GEOMETRY.BAND_MIN_W` when narrower, clamped into [0, plotW].
- `pointVerdictAxisTicks(maxPoints)`: values 0, step, 2·step, ... up to maxPoints, step 100 when
  maxPoints > 300, 50 when > 100, 20 when > 40, else 10.
Tests in districtHistGeometry.test.ts: the behaviours above, every expectation against a direct
`simAxis` call as the file already does; plus the GREP GUARD that R9 refers to (it does not exist yet):
read DistrictPointHistogram.tsx with `readFileSync` relative to `import.meta.url`, normalise CRLF,
strip block and line comments, then assert the text has no occurrence of the shared rank geometry
module's name and does import "./districtHistGeometry.js".

PART C, new pure module ledgerVerdict.ts (no React import; type-only imports wherever a type is all
that is needed). Exports:
- `VerdictOutcomeRow` { key, label, points, pointsHigh?, chance } (Task 2's outcome list takes this
  type). `VerdictTile` { key: "median" | "likely" | "cutoff" | "mostLikely" | "chanceOfPoints"; label;
  value }. `VerdictSourceChip` = { kind: "earned"; figure; text } | { kind: "predicted"; figure; text }
  | { kind: "note"; text } | { kind: "category"; label; figure; small: string | undefined; open:
  boolean }. `VerdictHistogramChart` { kind: "histogram"; testId: "district-ledger-drawer-grand-plot" |
  "district-ledger-drawer-cell-plot"; label; counts; denominator; maxPoints; p10; p50; p90; cutoff: {
  position; label; zone: SimulatedCutoffRange | undefined } | undefined; capLabel: string | undefined }.
  `VerdictOutcomeChart` { kind: "outcomes"; label; rows }. `VerdictModel` { eyebrow; headline; tiles;
  chart; sourceChips }. `VerdictTotalContext` = { kind: "event"; eventName } | { kind: "district" } |
  { kind: "dcmp"; fieldChance: number | undefined }.
- `verdictOutcomeRows(cell, season, tier, isRookie, namedOutcomes)`: the open-cell pane's two outcome
  branches ported VERBATIM in behaviour (routed alliance first, then Playoffs and Awards via
  `districtCellRendersOutcomeList`), returning { label, rows } or undefined when the cell draws a
  histogram (including an empty row list).
- `ledgerGrandVerdict({ statusKey, rangeCall, chance })` with statusKey typed
  `DistrictLedgerShownState | undefined` (champ status keys are a subset): the mapping in the behaviour
  list. Withheld teams carry status "capacityUnknown" plus a rangeCall, which is why rangeCall is read
  first.
- `buildVerdictModel(input)` with input { cell (open), cellTitle, teamNumber, nickname, season,
  isRookie, tier, namedOutcomes, grand?: { verdict, cutoff: LedgerCutoffView }, total?:
  VerdictTotalContext, sourceChips? }:
  1. eyebrow from `districtLedgerVerdictEyebrow`.
  2. Outcome rows present: top row = highest chance, ties to the earlier row (rows arrive points
     descending, so the earlier row pays more); headline `districtLedgerVerdictOutcomeHeadline`; tiles
     mostLikely = top label, chanceOfPoints = sum of chance over rows whose (pointsHigh ?? points) is
     above 0; chart outcomes.
  3. Otherwise histogram, percentiles from `pointPercentiles(counts, denominator)`. grandTotal: throw
     a named Error when `grand` is absent; headline from the grand verdict; tiles median, likely,
     cutoff. The cutoff tile and chart cutoff read `ledgerCutoffDisplay(grand.cutoff)` (import it from
     LedgerParts.tsx; one-way, LedgerParts never imports this module): tile value is
     `DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS[kind]` for the capacityUnknown and absent arms and
     `display.figure` for every other arm (settled "213", predicted "~213", "pending", "not
     available"); chart cutoff exists exactly when `display.markedPosition` is defined, labelled
     `districtLedgerVerdictCutoffLabel(display.figure)`, with zone = `grand.cutoff.likely` exactly when
     `display.likelyText` is defined. eventTotal: throw a named Error when `total` is absent; event
     uses the event total headline, district the likely headline with noun "district", dcmp the field
     headline when fieldChance is defined and under 1, else the likely headline with noun "DCMP".
     qual: cap headline when p50 is at least ceiling minus 0.5, mass = counts[round(ceiling)] /
     denominator, else the likely headline; capLabel `districtLedgerVerdictCapLabel(ceiling)` on every
     Qualification cell. alliance, elim, award drawn as histograms: likely headline with their noun.
     Non-grand histogram tiles are median and likely. testId and label: grand plot ids and
     `DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL` for the grand total, cell plot ids and
     `DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL` otherwise.
  4. sourceChips = input.sourceChips ?? [].
- `districtGrandSourceChips(contributions, rookieBonus)`: settled = entries whose `open` is
  undefined; when any, ONE earned chip, figure String(round(sum of earned ?? 0)), text
  `districtLedgerVerdictEarnedAt(names in row order)`; one predicted chip per open entry, figure
  `districtLedgerVerdictMedian(open.p50)`, text `districtLedgerVerdictPredictedAt(name)`; a note chip
  `districtLedgerRookieBonusLine(round(rookieBonus))` when the bonus is above 0.
- `champGrandSourceChips(contributions, { membership, grandTotalIsDistrictOnly, rookieBonus })`:
  district row earned gives an earned chip (districtEarned), open gives a predicted chip
  (districtPredicted). DCMP row: membership "out", a district-only grand total, `notYetPriced`, or no
  earned and no open gives a note chip `districtOnly`; earned gives an earned chip (dcmpEarned); open
  gives a predicted chip whose text is dcmpPredicted plus `champLedgerVerdictFieldSuffix` when the
  row's own `fieldChance` is defined and under 1. Rookie bonus note chip as on the District tab (the
  retired grand total caption printed it on both tabs; dropping it on Champ would lose it).
- `verdictCategoryChips(cells: readonly ChampLedgerCell[])`: for each qual, alliance, elim, award cell
  in order; final gives { category, label from the chip labels, figure String(round(earned)), small
  undefined, open false }; open gives figure and small from `openCellLines(cell)`, open true; every
  other kind is skipped.
Tests in ledgerVerdict.test.ts: build open cells with `pointCellSummary` from packages/core plus a
`{ counts, denominator }` distribution and a `ceiling`; cover every behaviour line above, with the
2026 season and `maxEventPoints`-consistent ceilings (22 for district qualification).
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/districtLedgerCopy.test.ts apps/web/src/components/districts/districtHistGeometry.test.ts apps/web/src/components/districts/ledgerVerdict.test.ts && npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>Three test files pass with the new cases counted in the output; the web typecheck prints no error (or every remaining one is triaged in the SUMMARY); no existing export changed. Committed as `feat(261006-lxp): verdict copy, plotW geometry and the verdict model`, staged by explicit path.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: SVG histogram, outcome bars and the verdict drawer, styled to the sketch</name>
  <files>apps/web/src/components/districts/DistrictPointHistogram.tsx, apps/web/src/components/districts/DistrictOutcomeList.tsx, apps/web/src/components/districts/LedgerVerdictDrawer.tsx, apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx, apps/web/src/styles/theme.css, apps/web/src/components/districts/LedgerParts.tsx, apps/web/src/components/districts/DistrictLedger.test.tsx</files>
  <read_first>
    - .planning/sketches/025-locks-drawer-concepts/index.html: `.A` and `.A .obars` CSS (lines ~106-139), `histSVG()`, `drawerA()`
    - apps/web/src/styles/theme.css lines 955-1240 (the ledger block, its `:root`, the outcome list and pane caption rules) and the picker block's marker comments (its CSS test must keep finding them)
    - apps/web/src/components/districts/LocksMilestonePicker.test.tsx lines 244-276 (the CSS contract test pattern to mirror)
    - apps/web/src/components/districts/ledgerVerdict.ts and districtHistGeometry.ts (Task 1)
    - apps/web/src/components/districts/LedgerParts.tsx lines 676-830 (the two drawer panes this task adapts)
    - apps/web/src/components/districts/DistrictLedger.test.tsx lines 1264-1300, 1400-1470, 2400-2460
  </read_first>
  <behavior>
    - Histogram with a cutoff: viewBox "0 0 560 124", the SVG has width 100% and max width 560 through CSS, a hatch pattern and zone rect, the band, touching crisp bars whose tallest is 82 high, the 2px median tick, a dashed cutoff line from top minus 2 to the baseline, the label "cutoff ~213" anchored start 5px right of the line, or anchored end 5px left when the line sits within 80px of the right edge.
    - Without a cutoff or cap: viewBox height 110, no pattern, no line, no label, and the legend has three items; with a cutoff and zone it has five; with a cutoff and no zone, four.
    - A Qualification chart with a cap label draws "22 cap" anchored end at the top right with top 20.
    - Axis: a hairline at the plot bottom, tick labels at the ladder values, the first anchored start and the rest middle.
    - Outcome bars: one grid row per outcome in the given order; fill width is chance × 100%; chance via the shipped chance formatter; points "30 pts" or "27 to 48 pts"; a zero chance row carries the zero modifier on its label and chance; no caption.
    - Drawer: renders the eyebrow, an h3 headline, the tiles with the lead modifier on the first, the note "likely = 8 of 10 runs", the chart, and the source line only when chips exist, chips separated by a middle dot.
    - CSS block: found between its two markers, carries the sketch's grid, gaps, breakpoint and sizes, and writes no hex, rgb or hsl literal.
  </behavior>
  <action>
PART A, rewrite DistrictPointHistogram.tsx as a responsive SVG (R5). Keep the export name and the
props `counts`, `denominator`, `maxPoints`, `p10`, `p50`, `p90`, `label`, `testId`; replace the
marked-position pair with `cutoff?: { position: number; label: string; zone?: { p10: number; p90:
number } }` and add `capLabel?: string`. Every x comes from districtHistGeometry with
`VERDICT_PLOT_W` passed as plotW; every vertical number from `VERDICT_GEOMETRY`; the file imports
nothing from the shared rank geometry module or from rankRows (the old bar height helper caps at 32
and is no longer used). Rewrite the header comment to describe the new chart without naming the
shared module. Structure:
- outer div with the testId, an sr-only span carrying `label` (the shipped accessible name pattern),
  then an `<svg aria-hidden="true" className="district-ledger-verdict-hist__svg">` carrying
  `viewBox="0 0 560 {top + 84 + 16 + 4}"`, `data-plot-max={maxPoints}` and `data-denominator`.
- top = TOP_MARKED when a cutoff or a cap label is drawn, else TOP_PLAIN.
- bins: size `pointBinSize(maxPoints)`; for each bin start v the mass is the sum of counts from v to
  the bin's last value (clamped at the last index and at maxPoints); modal = the largest bin mass;
  height = mass / modal × BAR_MAX_H; a bin under 0.5 high is not drawn. Each drawn bin is ONE rect
  from `pointBinExtent(v, last, maxPoints, VERDICT_PLOT_W)`, y = top + PLOT_H − height,
  `shapeRendering="crispEdges"`, data-testid "district-hist-bar", class
  "district-ledger-verdict-hist__bar".
- paint order: (1) when `cutoff.zone`: a `<defs><pattern>` 4 by 4, `patternUnits="userSpaceOnUse"`,
  `patternTransform="rotate(135)"`, holding a 1 by 4 rect with class
  "district-ledger-verdict-hist__hatch"; the pattern id comes from React `useId()` with every
  character outside [A-Za-z0-9_-] stripped, prefixed "district-ledger-hatch-"; then the zone rect
  (data-testid "district-hist-cutoff-zone", fill `url(#id)`) spanning
  `pointVerdictBandExtent(zone.p10, zone.p90, ...)` over the full plot height. (2) the band rect
  (data-testid "district-hist-band", class `__band`) from `pointVerdictBandExtent(p10, p90, ...)`.
  (3) the bars. (4) the median tick rect (data-testid "district-hist-median-tick", class `__tick`) at
  `pointMedianTickLeft(p50, maxPoints, VERDICT_PLOT_W)`, width `SIM_GEOMETRY.MEDIAN_TICK_W`, full plot
  height. (5) tick labels (data-testid "district-hist-tick", class `__tick-label`) at
  `pointX(v, maxPoints, VERDICT_PLOT_W)` for each `pointVerdictAxisTicks(maxPoints)` value, y = top +
  PLOT_H + TICK_LABEL_DROP, textAnchor "start" for 0 and "middle" otherwise. (6) the axis hairline
  (class `__axis`) from 0 to 560 at y = top + PLOT_H + 0.5. (7) when a cutoff: the line (data-testid
  "district-hist-marked-line", class `__cutoff`) at cx = `pointX(cutoff.position, ...)` from
  y = top − LINE_RISE to top + PLOT_H, strokeWidth 1.5, strokeDasharray "4 3"; and its label
  (data-testid "district-hist-cutoff-label", class `__cutoff-label`) at y = top − LABEL_RISE, anchored
  "end" at cx − LABEL_GAP when cx > 560 − LABEL_EDGE, else "start" at cx + LABEL_GAP. (8) when a cap
  label: text (data-testid "district-hist-cap", class `__cap`) at `pointX(maxPoints, ...)`, y = top −
  LABEL_RISE, anchored "end".
- the legend under the SVG (data-testid "district-hist-legend", class
  "district-ledger-verdict-legend"): one span per item, each a decorative swatch `<i aria-hidden>` with
  class `district-ledger-verdict-legend__swatch` plus a modifier (`--bars`, `--band`, `--tick`, `--cut`,
  `--zone`) followed by the `DISTRICT_LEDGER_VERDICT_LEGEND` word. Bars, band and tick always; cutoff
  when the line is drawn; zone only when the zone is drawn (deliberate departure 3).

PART B, rewrite DistrictOutcomeList.tsx (R6). Props `rows: readonly VerdictOutcomeRow[]` (type-only
import from ledgerVerdict.ts), `label`, `testId`; the caption prop and the old fixed-width bar
constants go. Render a `div role="list" aria-label={label}` with class
"district-ledger-verdict-outcomes" and the testId; one `div role="listitem"` per row with class
"district-ledger-verdict-outcomes__row", data-testid "district-ledger-outcome-row" and
`data-outcome={row.key}`, holding four spans in order: `__label` (row.label), `__track` (aria-hidden)
containing `__fill` (data-testid "district-ledger-outcome-bar", inline style width
`{clamp01(chance) × 100}%`; a width is geometry, not colour), `__chance`
(`districtLedgerOutcomeChance(row.chance)`), `__points` (`districtLedgerOutcomePointsLabel(row.points,
row.pointsHigh)`). A row whose chance is 0 or below adds `district-ledger-verdict-outcomes__zero` to
its label and chance spans. Rows render in the order given (points descending, as today). Rewrite the
header comment accordingly.

PART C, new LedgerVerdictDrawer.tsx: `VerdictDrawer({ model }: { model: VerdictModel })` renders
`div.district-ledger-verdict` (data-testid "district-ledger-verdict") with two children. Left
(`__summary`): `div.__eyebrow` (testid "district-ledger-verdict-eyebrow"); `h3.__headline` (testid
"district-ledger-verdict-headline"); `div.__tiles` (testid "district-ledger-verdict-tiles") of one
`div.__tile` per tile (testid "district-ledger-verdict-tile", `data-tile={key}`; the first tile also
gets `__tile--lead`) holding `span.__tile-label` and `b.__tile-value`; `p.__note` (testid
"district-ledger-verdict-note") with `DISTRICT_LEDGER_VERDICT_NOTE`. Right (`__chart`): the histogram
(from the chart fields) or the outcome list (testId "district-ledger-drawer-outcomes"), then, only
when `sourceChips` is non-empty, `div.__source` (testid "district-ledger-verdict-source") with chips
separated by `span.__sep` holding "·". Chip markup: earned = `<span><b>{figure}</b> {text}</span>`;
predicted = `<span><span className="district-ledger-verdict__pred">{figure}</span> {text}</span>`;
note = `<span>{text}</span>`; category settled = `<span>{label} {figure}</span>`; category open =
`<span>{label} <b>{figure}</b>` plus ` <i>{small}</i>` when small exists `</span>`.

PART D, theme.css (R2). Replace the outcome list rules and their header comment (the block that
starts at the outcome list comment from quick task 260925-uf8 and ends after the `__bar` rule) with a
new block whose first comment line contains "The Locks drawer, verdict first (sketch 025 variant A)"
and whose last comment contains "end of the Locks drawer verdict block". KEEP the pane caption rule
and its comment, and the contribution list rules, exactly where they are: Task 3 removes them with
their consumers. Inside the new block, tokens only:
- its own `:root` with `--district-ledger-drawer-bg: color-mix(in srgb, var(--tier-rare-bg) 22%,
  var(--color-bg-surface))` (lands about #f8fcff, within 2 per channel of the sketch's #f8fbfd, adding
  no palette entry) and `--district-ledger-band: color-mix(in srgb, var(--tier-rare-mark) 22%,
  transparent)`.
- `.district-ledger-table tbody tr.district-ledger-row--drawer > td`: background
  `var(--district-ledger-drawer-bg)`, padding `14px 16px 16px` (outranks the shared padding rule by
  specificity; theme.css is unlayered so it beats the cell's utility classes).
- `.district-ledger-verdict`: grid, `grid-template-columns: minmax(240px, 300px) minmax(280px, 1fr)`,
  `gap: 12px 32px`, `align-items: start`, `text-align: left`, and `white-space: normal` (LOAD-BEARING:
  the shared table cell carries a no-wrap utility and the headline and source line must wrap);
  `@media (max-width: 760px)` one column `1fr`.
- `__eyebrow` 11px, `letter-spacing: .04em`, uppercase, faint, 600. `__headline` `margin: 2px 0
  10px`, 18px, `line-height: 1.25`, 600, `text-wrap: balance`, primary ink. `__tiles` flex wrap gap
  8px. `__tile` surface background, `1px solid var(--color-border)`, radius 8px, padding `6px 10px`,
  `min-width: 78px`. `__tile-label` block 11px faint. `__tile-value` 16px 600 `line-height: 1.2`
  primary ink; `__tile--lead .__tile-value` `var(--tier-rare-fg)`. `__note` `margin: 10px 0 0`, 12px,
  faint. `__chart` `min-width: 0`.
- `.district-ledger-verdict-hist__svg` block, `width: 100%`, `max-width: 560px`, `height: auto`;
  `__bar` fill `var(--sim-hist-bar)`; `__band` fill `var(--district-ledger-band)`; `__tick` fill
  `var(--sim-median-tick)`; `__hatch` fill `color-mix(in srgb, var(--color-text-primary) 18%,
  transparent)`; `__axis` stroke `var(--color-border)`; `__tick-label` 10px, fill faint; `__cutoff`
  stroke primary ink; `__cutoff-label` 11px, 600, fill primary ink; `__cap` 11px, fill faint.
- `.district-ledger-verdict-legend` flex wrap, `gap: 4px 14px`, 11px, faint, `margin-top: 4px`;
  `__swatch` inline-block, `vertical-align: -2px`, `margin-right: 4px`, 12 by 10; `--bars` background
  `var(--sim-hist-bar)`; `--band` `var(--district-ledger-band)`; `--tick` width 2px background
  `var(--sim-median-tick)`; `--cut` width 0 with `border-left: 1px dashed var(--color-text-primary)`;
  `--zone` background `repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-text-primary)
  18%, transparent) 0 1px, transparent 1px 4px)`.
- `.district-ledger-verdict-outcomes`: grid, `grid-template-columns: max-content 1fr max-content
  max-content`, `gap: 6px 12px`, `align-items: center`, 13px, `max-width: 560px`; `__row` `display:
  grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center`; `__label`
  `white-space: nowrap`, primary ink; `__track` block, height 10px, background
  `var(--color-bg-inset)`, radius 3px, `overflow: hidden`, `min-width: 120px`; `__fill` block, height
  100%, background `var(--tier-rare-mark)`, radius 3px; `__chance` right aligned, 600, `min-width:
  38px`, tabular numbers; `__points` right aligned, muted, `min-width: 48px`, tabular numbers; `__zero`
  faint.
- `__source` `margin-top: 8px`, 12px, muted, flex wrap, `gap: 4px 10px`; `__source b` primary ink 600;
  `.district-ledger-verdict__pred` `var(--tier-rare-fg)` 600.

PART E, LedgerParts.tsx: the two existing drawer panes adopt the new component props so the tree stays
green; Task 3 replaces both panes. The open-cell pane passes no caption to the outcome list (drop that
import); its histogram call is unchanged. The grand total pane replaces its marked-position pair with
`cutoff` built from the same `ledgerCutoffDisplay`: position `markedPosition`, label
`districtLedgerVerdictCutoffLabel(display.figure)`, zone the view's `likely` exactly when
`display.likelyText` is defined. Nothing else in LedgerParts changes in this task.

PART F, tests. New LedgerVerdictDrawer.test.tsx covers every behaviour line, rendering the histogram,
the outcome list and the drawer directly with synthetic data (a 0..425 grand total with mass split
across two lumps, a 0..22 qualification lump at the cap, a five-row playoff list with a zero row), plus
the CSS contract test modelled on LocksMilestonePicker.test.tsx (CRLF normalised, block sliced between
the two markers, comment-stripped no-literal check). Then run DistrictLedger.test.tsx and
ChampLocksLedger.test.tsx and update ONLY the assertions the component rewrite changed, as listed
under "Task 2 updates" in the test triage: `.district-ledger-verdict-outcomes__points` (values now end
" pts"; parse with parseInt where a test compares numbers), `.district-ledger-verdict-outcomes__chance`
for the chance figure, and the cutoff label `cutoff ~{printed}` in place of the drawer containing the
predicted cutoff label. Leave every caption assertion alone in this task: the old panes still print
them.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx apps/web/src/components/districts/districtHistGeometry.test.ts apps/web/src/components/districts/DistrictLedger.test.tsx apps/web/src/components/districts/ChampLocksLedger.test.tsx apps/web/src/components/districts/LocksMilestonePicker.test.tsx && npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>All five files pass (counts read from output); the grep guard still passes against the rewritten histogram; the web typecheck is clean or every error triaged. Committed as `feat(261006-lxp): SVG histogram, outcome bars and the verdict drawer`, staged by explicit path.</done>
</task>

<task type="auto">
  <name>Task 3: One verdict pane on both Locks tabs, dead drawer copy and CSS removed, Team column unpinned</name>
  <files>apps/web/src/components/districts/LedgerParts.tsx, apps/web/src/components/districts/DistrictLedger.tsx, apps/web/src/components/districts/ChampLocksLedger.tsx, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts, apps/web/src/components/districts/districtLedgerOutcomes.ts, apps/web/src/styles/theme.css, apps/web/src/components/districts/DistrictLedger.test.tsx, apps/web/src/components/districts/ChampLocksLedger.test.tsx, apps/web/e2e/districts-ledger.spec.ts</files>
  <read_first>
    - apps/web/src/components/districts/DistrictLedger.tsx lines 1-265 (imports, DrawerRow, the per event list) and 540-749 (chances, cutoff view, openDrawer, the table and the drawer row call)
    - apps/web/src/components/districts/ChampLocksLedger.tsx lines 60-362 (imports, cells, the per source list, ChampDrawerRow) and 700-920 (chances, openDrawer, the table and the drawer row call)
    - apps/web/src/components/districts/LedgerParts.tsx header comment, imports, lines 129-140 (Team cell class), 400-500 (`ledgerCutoffDisplay`), 640-830 (Team cell, the two drawer panes)
    - the test triage block of this plan, then the named tests in districtLedgerCopy.test.ts, DistrictLedger.test.tsx (1234-1545, 1987-2020, 2081-2135) and ChampLocksLedger.test.tsx (744-890)
    - apps/web/e2e/districts-ledger.spec.ts lines 110-120 and 455-505
  </read_first>
  <action>
PART A, wire the one pane (R1, R7).
- DistrictLedger.tsx: extend the `openDrawer` memo to return the event row the clicked cell belongs to
  (`row: DistrictLedgerEventRow | undefined`, undefined for the grand total) by walking `team.rows`
  instead of flattening them. DrawerRow takes { team, row, cell, cutoff, columnCount, chance, status,
  season, isRookie } and renders, inside the unchanged `TableRow`/`TableCell` (testid
  "district-ledger-drawer", `data-drawer-cell`), `<VerdictDrawer model={buildVerdictModel(...)} />`
  with: cellTitle "Grand total" for the grand total, else
  `districtLedgerVerdictEventCellTitle(DISTRICT_LEDGER_VERDICT_CELL_TITLES[cell.cell], row.eventName)`;
  tier "district"; namedOutcomes true; grand = { verdict: `ledgerGrandVerdict({ statusKey:
  status?.status, rangeCall: status?.rangeCall, chance })`, cutoff } on the grand total; total =
  { kind: "event", eventName: row.eventName } on the event total; sourceChips =
  `districtGrandSourceChips(districtEventContributions(team), team.rookieBonus)` on the grand total
  and `verdictCategoryChips(row.cells)` on the event total. The caller passes the raw chance
  (`chances?.byTeam.get(team.teamKey)`) and the displayed status, not the chance line. Delete the per
  event list component and every import only it used.
- ChampLocksLedger.tsx: same shape for ChampDrawerRow with { team, row (kind or undefined), cell,
  cutoff, columnCount, chance, status, season, isRookie }: cellTitle "Grand total", or
  `CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES[row]` for a subtotal, else the plain
  `DISTRICT_LEDGER_VERDICT_CELL_TITLES[cell.cell]` (deliberate departure 4); tier dcmp on the DCMP row
  else district; namedOutcomes true only on the DCMP row; total = { kind: "district" } or { kind:
  "dcmp", fieldChance: team.fieldChance }; sourceChips = `champGrandSourceChips(champContributions(team),
  { membership: team.membership, grandTotalIsDistrictOnly: team.grandTotalIsDistrictOnly, rookieBonus:
  team.rookieBonus })` on the grand total and `verdictCategoryChips((row === "dcmp" ? team.dcmpRow :
  team.districtRow).cells)` on a subtotal. Delete the per source list component and its imports.
- LedgerParts.tsx: delete the open-cell pane, the grand total pane and the percentile band label
  helper (and the rank band prefix import if it becomes unused); remove the `caption` field from
  `LedgerCutoffDisplay` and from every arm of `ledgerCutoffDisplay` (its only reader is gone), and drop
  the caption imports. Leave `LedgerCutoffView.tier` and its plumbing in predictedCutoff.ts and
  ledgerRangeState.ts untouched; it loses its only reader, so name it in the SUMMARY as a follow-up.
  Rewrite the header comment's drawer paragraph by concept ("the drawer is one verdict pane, built in
  ledgerVerdict.ts and rendered by LedgerVerdictDrawer.tsx").
- districtLedgerOutcomes.ts: reword the one comment near line 170 that names the deleted open-cell
  pane, by concept. No code change.

PART B, delete the dead copy and CSS (R1). districtLedgerCopy.ts loses: the drawer cell caption, the
no points caption function, the midpoint cutoff caption, the district simulated cutoff caption, the
two absence captions (no line, no cutoff), the drawer chance caption, the outcome column labels, the
outcome captions, every `DISTRICT_LEDGER_CONTRIBUTION_` export and its earned formatter, the rookie
bonus caption function, every `CHAMP_LEDGER_CONTRIBUTION_` export and its chance note function, the
champ simulated cutoff caption, the champ pending caption and the champ no call caption function.
KEEP the two plot labels, the outcome list labels, every outcome label map, the outcome chance and
points formatters, the pending figure, the no call reasons and description, and the rookie bonus line.
theme.css loses the pane caption rule and its comment and the whole contribution list rule group.
Update districtLedgerCopy.test.ts exactly as the test triage says.

PART C, unpin the Team column (R8). `TEAM_CELL_CLASS` becomes "bg-[var(--color-bg-surface)]
align-middle" (the three positioning utilities go; the surface background and vertical alignment
stay). Keep the Team cell's width cap and reword its comment: the cap now keeps the column narrow.
Add a unit assertion in DistrictLedger.test.tsx that `TEAM_CELL_CLASS` equals that exact string.
apps/web/e2e/districts-ledger.spec.ts: rename the 390px test to "the table's own region is the only
horizontal scroller and the Team column scrolls with it", keep the overflow and no-page-pan premises,
and replace the hold assertion with `after.x` less than `before.x - 1` and a message saying the Team
column is not pinned since sketch 025; update the console line and the TEST_IDS comment on `teamCell`.
Do not run Playwright; it targets the live site. Grep apps/web/e2e for drawer, caption and outcome
strings and list in the SUMMARY every spec the orchestrator should rerun after deploy (expected: this
one only).

PART D, rewrite the ledger tests per the test triage (R9). Concrete expectations:
- grand total drawer, District tab: exactly one `district-ledger-drawer-grand-plot`, no cell plot, no
  outcome list; headline matches `^(Qualifies in (\d+|fewer than 5) of 100 runs\.|Already
  qualified\.|Cannot qualify on points\.|Chance still being simulated\.|No call at this
  position\.|Likely \d+–\d+ grand total points\.)$`; for a team whose Status cell prints "N% chance"
  the headline is exactly "Qualifies in N of 100 runs." (and "fewer than 5" for "<5% chance"); the
  `[data-tile="cutoff"]` value equals the stat line's figure; the chart label reads "cutoff ~{figure}";
  `district-hist-cutoff-zone` exists exactly when the stat line prints a likely range; the source
  line contains "24 earned at Done Event" and a "~{n} predicted at Live Event" chip (the fixture names
  match no shortening template, so they print verbatim); the eyebrow is "Grand total · {number}
  {nickname}".
- capacity unpublished: open the GRAND TOTAL; no marked line; cutoff tile "not published"; headline
  "Likely a–b grand total points.".
- qualification cell: one cell plot, no grand plot; headline is the likely or the cap form; tiles
  median "~n" and likely "a–b" (integers, en dash); no cutoff tile; eyebrow "Qualification at Live
  Event · {number} {nickname}"; the table cell itself still prints its one-decimal likely line.
- playoffs cell: outcome list, no grand plot, no histogram; headline "{label} in N of 100 runs." where
  label is the row with the highest printed chance; tiles "most likely" and "chance of points" ("N%").
- midpoint fallback: the marked line is drawn, the cutoff tile equals the stat line figure, and no
  hatch zone. Pending: no marked line and the cutoff tile reads "pending"; after release the marked
  line appears and the tile reads "~{n}".
- Champ: the grand total shows one plot and a source line containing "district events" and either
  "predicted at the DCMP" or "district points only"; at season start the DCMP chip matches
  `predicted at the DCMP, in the field (\d+|<5)% of runs` and the `dcmp-row:eventTotal` drawer headline
  matches `^In the field in (\d+|fewer than 5) of 100 runs, and ~\d+ points if there\.$` with eyebrow
  starting "DCMP subtotal · ".
- No test asserts on a deleted string, and every import of a deleted export is removed.

PART E, verify the whole repo and triage. Run the full root suite and all three typechecks (see
verify). Read every failure and every type error; fix it or record in the SUMMARY precisely why it is
unrelated to this task.
  </action>
  <verify>
    <automated>npx vitest run</automated>
    <automated>npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json</automated>
    <automated>grep -rnE "DrawerCellPane|GrandTotalPlot|ContributionList|district-ledger-pane-caption|district-ledger-outcomes|district-ledger-contributions|OUTCOME_CAPTIONS|_CONTRIBUTION_|RookieBonusCaption|NoPointsCaption|DrawerNoCallCaption|DRAWER_(CELL|CUTOFF|SIMULATED_CUTOFF|CHANCE|NO_LINE|NO_CUTOFF|PENDING)_CAPTION|ContributionChanceNote|ContributionEarned|OUTCOME_COLUMN_LABELS|bandLabel|How this is computed" apps/web/src | wc -l   (must print 0)</automated>
    <automated>grep -c "<VerdictDrawer" apps/web/src/components/districts/DistrictLedger.tsx apps/web/src/components/districts/ChampLocksLedger.tsx   (each must print 1)</automated>
    <human-check>End of phase, by the orchestrator after deploy or on the local preview recipe: open a bubble team's grand total, a qualification cell, a playoffs cell and a DCMP subtotal on Champ Locks at 1440px and at 390px, beside the sketch's variant A. Check the tile row, the hatched zone under the "cutoff ~N" label, touching bars, the outcome bars, and that the Team column scrolls away.</human-check>
  </verify>
  <done>The full root suite passes (file count in the output is the repo-root count, about 170 files, not the apps/web count); all three typechecks are clean or every error triaged in the SUMMARY; the regex gate prints 0; both tabs render VerdictDrawer. Committed as `feat(261006-lxp): one verdict pane on both Locks tabs, team column unpinned`, staged by explicit path. The final message carries the SUMMARY text: commits, the four deliberate departures, the e2e specs to rerun after deploy, the `LedgerCutoffView.tier` follow-up, and every triaged type error.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| R2 artifact to browser render | Event names and team nicknames from the published district artifact reach the eyebrow, headline and source line |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-lxp-01 | Tampering | VerdictDrawer text nodes (eyebrow, headline, chips) | low | mitigate | Rendered as React text children only; no `dangerouslySetInnerHTML`, no string-built markup, SVG pattern id sanitised to [A-Za-z0-9_-] |
| T-lxp-02 | Information disclosure | Executor transcripts | medium | mitigate | No task needs `.env`; the rules block forbids reading or echoing it (CLAUDE.md Secrets handling) |
| T-lxp-03 | Denial of service | Histogram render on a 426 slot axis | low | accept | At most 96 bins and constant-size SVG per open drawer; one drawer open at a time |
</threat_model>

<verification>
- Task order is the dependency order; each commit leaves the tree green (Task 1 additive, Task 2 keeps
  the two old panes compiling against the new chart props, Task 3 swaps and deletes).
- If apps/web/src/routeTree.gen.ts is missing (a fresh worktree), run the web build once before
  reading the web typecheck; about 45 route errors otherwise are not real.
- Source coverage: GOAL (sketch 025 A on both tabs) Tasks 2 and 3; R1 Task 3 (plus tile words in Task
  1); R2 Task 2; R3 and R4 Task 1, rendered Task 2, wired Task 3; R5 Tasks 1 and 2; R6 Tasks 1 and 2;
  R7 Task 1 builders, Task 3 wiring; R8 Task 3; R9 every task; R10 every task. README decisions: no
  disclosure (Task 3 gate), bars touch (Tasks 1 and 2), Team column not sticky (Task 3). Variants B
  and C are out of scope by the orchestrator's instruction.
</verification>

<success_criteria>
- Both Locks tabs open one verdict pane per clicked cell, matching sketch 025 variant A apart from the
  four recorded departures.
- No drawer caption, contribution table or second grand total plot remains in apps/web/src.
- Three green commits carrying 261006-lxp, nothing pushed, no `.planning` file committed.
</success_criteria>

<output>
Do not write or commit any `.planning` file. Return the SUMMARY content (frontmatter plus body, per
the summary template) in the final message; the orchestrator writes
`.planning/quick/261006-lxp-implement-sketch-025-variant-a-verdict-f/261006-lxp-SUMMARY.md`.
</output>
