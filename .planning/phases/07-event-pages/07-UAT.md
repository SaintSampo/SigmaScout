---
status: testing
phase: 07-event-pages
source: [07-20-SUMMARY.md]
started: 2026-08-30T01:29:13Z
updated: 2026-08-30T15:02:03Z
---

## Current Test

number: 1
name: Real-device touch scroll sign-off (READY TO RE-RUN — three MORE layout defects fixed, pending deploy)
expected: |
  Real-device UAT on a phone found three MORE layout defects in the same family as G-1/G-2/G-3
  (filed below as G-4, G-5, G-6) before the original six touch-arbitration checks could be
  assessed cleanly: vertical page scroll was blocked over every table/tab-strip (G-4), the tab
  strip's own trigger widths were force-equalized against varying label widths (G-5), and the tab
  strip centered its content while overflowing, making the leading tab unreachable by scrolling
  (G-6). All three are fixed and committed; awaiting deploy and live re-measurement before the
  original six touch-arbitration checks are re-run on a real phone.
awaiting: user response

## Tests

### 1. Real-device touch scroll sign-off
expected: |
  On a real phone, all six checks pass on all three URLs: table drags move only the table,
  strip drags move only the strip, vertical drags scroll the page, diagonal drags resolve
  cleanly, momentum settles without rubber-banding leaking or pinned-column bleed-through,
  and Breakdown's two pinned columns stay opaque throughout.
result: ISSUE — layout defect found before touch behaviour could be assessed.
  Reported on a real phone: the Rank / Team # / Nickname columns take the full width with
  visible gaps between them. Reproduced and measured at 390px — see G-1 and G-2.
  Touch checks 1-6 remain UNANSWERED; the layout defect blocked assessment. Re-run after fix.

### 2. Plot density at high row counts (look-and-decide)
expected: |
  At https://sigmascout.org/event/2023cur?tab=quals&algorithm=vpr, at phone width, scroll the
  full 130-row slate. Each match should still read as its own band-tick-dot group, not as one
  continuous vertical texture. Compare against a team page's ~40-row section, e.g.
  https://sigmascout.org/team/118?year=2024&algorithm=vpr — the row density the current plot
  geometry (matchAxis.ts) was argued for, before Phase 7 put up to 130 rows on one tab.
result: [pending]

## Summary

total: 2
passed: 0
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

### G-1 — Sticky column offsets desync from rendered widths (the visible gaps)

severity: high
status: fixed, pending live re-verification
surfaces: InsightsTab, BreakdownTab, TeamsTable

Every event/teams table renders with `table-layout: auto` while setting an explicit per-column
`width` AND deriving sticky `left` offsets from TanStack's `getStart("start")`, which is computed
from DECLARED sizes. Auto layout treats `width` as a hint, not a constraint, so actual widths
diverge from declared and every pinned offset is wrong by exactly that difference.

Measured live at a 390px viewport:

| surface   | worst sticky gap | pinned width (of 390px) |
|-----------|-----------------:|------------------------:|
| insights  | 50px             | 458px                   |
| breakdown | 29px             | 407px                   |
| teams     | 15px             | 350px                   |

Insights columns, declared vs actual: rank 72 to 48, teamNumber 88 to 62, nickname 220 to 348.
Header cells carry `background: var(--color-bg-surface)`, so each offset error renders as a
page-coloured stripe between pinned headers — which is what the tester saw.

PRE-EXISTING, not introduced by Phase 7. The teams page has shipped with this since that table
was built. Phase 7 copied the `width:100% + minWidth:getTotalSize()` pattern from
`TeamsTable.tsx` into three event tables, where narrower content makes it much worse.
`TeamsTable` partly masked it because its rows are absolutely positioned by the virtualizer.

Proven fix: `table-layout: fixed` makes actual equal declared on every column and every sticky
gap 0px. Verified by live style injection at 390px against the deployed site.

**Fixed** (commit `fix(07): G-1 table-layout:fixed to stop pinned sticky offsets desyncing`):
`table-layout: fixed` applied to InsightsTab/BreakdownTab/TeamsTable. TeamsTable additionally
needed `minWidth`/`maxWidth` paired with `width` on every cell — its row virtualizer
absolutely-positions each `<tr>`, which the CSS Display spec blockifies and disconnects from the
real table's column grid into an anonymous per-row auto-layout table, so `table-layout: fixed`
alone left a real ~31-56px gap in the BODY rows even though the header row (still in normal table
flow) looked fine. AlliancesTab deliberately left on `table-layout: auto` — no pinned columns (no
sticky-offset defect to fix, 0px gap measured), and its pick columns currently rely on auto
layout's free growth to show a full nickname (a separate, non-G-1 flex/`min-width:0` truncation
bug); switching to `fixed` there would likely spill the untruncated nickname instead.

Verified locally against a fixture-backed dev server (real compiled CSS/fonts, crafted worst-case
data) since `data.sigmascout.org`'s CORS excludes localhost: gaps dropped from 11-56px to 0px
across all three tables at 390px. Awaiting live re-measurement on the deployed origin.

### G-2 — Pinned identity columns consume the entire mobile viewport

severity: high
status: fixed, pending live re-verification
surfaces: InsightsTab (worst), BreakdownTab, TeamsTable

Rank (72) + Team # (88) + Nickname (220) = 380px pinned on a 390px screen. Even with G-1 fixed,
the first viewport of a match-PREDICTION site contains no prediction: not one metric column is
reachable without horizontal scrolling, and nothing signals that more columns exist. The
percentile tier key renders above a table in which no tiered value is visible.

This is a design defect, not a CSS bug — G-1's fix does not address it. Pinning exists to keep
row identity visible while scrolling data horizontally; that needs one identifier, and the team
number is the canonical one in FRC. Rank is implicit in row order on a rank-ordered table.
Nickname alone is 56% of the viewport and is already truncated.

**Fixed** (commit `fix(07): G-2 unpin nickname and tighten rank/team# widths below 768px`): below
`MOBILE_BREAKPOINT_PX` (the existing sitewide 768px mobile/desktop line, reused via `useIsMobile()`
rather than a new breakpoint), nickname stops being pinned on all three tables and rank/teamNumber
tighten to real-geometry-derived widths (56px/72px) sized to each column's true worst case — a
4-digit rank (TeamsTable ranks the full ~3,750-team season pool) and a 5-digit team number (FRC
numbers now exceed 9999). Wide-viewport sizes are left byte-for-byte unchanged.

Measured locally at 390px: Insights' pinned block drops from 380px declared (484px actual
pre-G-1) to 128px declared/actual with a 0px sticky gap — matching this gap's own ~128px target
exactly, independently derived rather than copied. Awaiting live re-measurement on the deployed
origin.

**G-2 part 2 — the fix above still left zero data pixels visible.** Live re-measurement (the
orchestrator, deployed origin, 390px, insights/`2023cur`) found the unpinning fix worked for the
SCROLLED state but the first-paint state was still broken: nickname's own `size` stayed at 220,
so `rank(56) + teamNumber(72) + nickname(220) = 348px` still exceeded the 342px scroller (390
minus the page's 24px-each-side padding) before any data column began — 0 of 342 scroller pixels
carrying data, measured live, across all three tables.

**Fixed** (commit `fix(07): G-2 part 2 narrow nickname below breakpoint so data reaches first
paint`): added a shared `NICKNAME_COLUMN_WIDTH_NARROW_PX = 90` (`teams-table/columns.tsx`), applied
below `MOBILE_BREAKPOINT_PX` to all three tables' nickname columns, the wide-viewport size (220)
untouched. 90 is the largest width that still leaves TeamsTable's layout — the one table where a
full 120px metric column sits immediately after nickname, unlike Insights (`record` at 100) or
Breakdown (only `teamNumber` pinned, 72px budget) — with a real, fully-visible metric column at
scroll 0: `128 (pinned) + 90 (nickname) + 120 (metric) = 338px`, 4px under the 342px scroller (pure
declared-pixel arithmetic under `table-layout: fixed`, not a font-measurement margin — there is no
cross-browser hinting variance to buffer against here). Insights clears its own binding constraint
(`record` at 100) with 24px to spare; Breakdown clears with 60px.

Verified against real nicknames at 90px (Playwright + the app's actual compiled `text-role-body`
CSS + `@fontsource-variable/inter` font): `"Black Hawk Robotics"` → `"Black Haw…"`, `"The Bucks'
Wrath"` → `"The Bucks…"`, `"FIRST Israel Off Season"` → `"FIRST Isra…"` — a readable multi-word
prefix in every case. A single shared constant (matching `RANK_COLUMN_WIDTH_NARROW_PX`/
`TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`'s own precedent) rather than three independently-tuned numbers,
even though only TeamsTable's layout is the binding constraint.

**Judgement call:** the team number is FRC's canonical identifier and stays fully visible pinned at
72px, so nickname is supplementary once unpinned — the choice was between spending more of the
scroller on nickname readability versus getting real data on screen, and the task's own framing (a
match-PREDICTION site showing zero predictions on first paint) makes that trade favor data. A
2-column-visible target (nickname ~30px) was tried and rejected: at that width every tested
nickname renders as a bare `"…"` with no readable characters at all, which is worse than showing
one full data column and a readable nickname prefix. 90px was chosen as the largest width clearing
every table's own binding constraint, rather than picking a number and hoping it worked.

Extended `table-layout-quality.spec.ts` with a new assertion class ("G-2 part 2"): at least one
non-pinned, non-nickname header cell fully visible inside the scroll region at scroll 0, discovered
dynamically via `data-pinned="false"` (not a hardcoded metric-key id, since that set is
season/algorithm-dependent). Proven RED against the deployed origin pre-fix, both `phone-390` (342px
scroller) and `pixel-10` (312px scroller): all six table/viewport combinations failed at 0 of N data
columns fully visible (0-50px total visible), matching the reported defect exactly — e.g. Insights
`phone-390`: `0 of 5 data columns fully visible ... (total 0.0px of data-column pixels visible)`.
Awaiting live re-measurement on the deployed origin for GREEN confirmation.

### G-3 — 122 passing e2e tests did not catch either defect

severity: medium
status: fixed
surfaces: apps/web/e2e/

07-20's suite asserts scroll ARBITRATION ("only the table moved", "the strip did not shift") and
never asserts layout QUALITY. A table can be fully broken — wrong widths, visible gaps, no data
on screen — and still pass all 122 assertions. This is why the defect reached a human tester.

Any fix must add an assertion that bites on this class: declared-vs-actual column width, and a
bound on pinned width as a fraction of the viewport.

**Fixed** (commit `test(07): G-3 add layout-quality e2e assertions, proven RED pre-fix`): added
`apps/web/e2e/table-layout-quality.spec.ts` with three assertion classes over Insights/Breakdown/
TeamsTable at phone width — declared-vs-actual column width, sticky offset correctness (0px gap
between consecutive pinned columns, checked on both the header row and the first body row), and
pinned width bounded at 50% of the viewport (read dynamically from `data-pinned="true"`, so a
future re-pinning regression is still caught). Also corrected `event-scroll-regions.spec.ts`'s
E3/E4 pinned-column assertions, which had encoded the pre-G-2 "nickname stays pinned" behavior
this fix deliberately changes.

Proven to bite: ran all three assertion classes locally against the pre-fix commit (3c2b356f) —
7 of 9 tests failed RED with the exact numbers G-1 reported (e.g. Insights gap 11px, TeamsTable
body-row gap 56px, pinned width up to 124% of viewport). Restored to the fixed commits: all 9
GREEN.

### G-4 — Vertical page scroll is blocked on mobile (`touch-action: pan-x` too narrow)

severity: critical
status: fixed, pending live re-verification
surfaces: InsightsTab, BreakdownTab, QualsTab, ElimsTab, AlliancesTab, EventSection (team page), the event tab strip

Reported live on a real phone: "it is hard to scroll up and down on the page. I have to do it
very precisely." `touch-action: pan-x` (Tailwind's `touch-pan-x`) was applied to every
horizontally-scrolling table AND the event tab strip — `pan-x` permits ONLY horizontal panning, so
a vertical touch gesture that STARTS on one of these elements is never handed to the page's own
vertical scroller. Since these regions occupy nearly the whole phone viewport, a real user had to
hunt for the thin non-table strips to scroll the page at all.

`06-RESEARCH.md` Pitfall 6 ("`touch-action: pan-x` is not fully reliable on iOS Safari") warned
specifically that a passing Playwright/CDP touch-emulation test does not prove real-device gesture
arbitration — this is that exact failure mode: `touch-scroll.spec.ts` and
`event-scroll-regions.spec.ts` were both green with the defect shipped, because CDP's synthetic
touch dispatcher does not reproduce a real phone's touch-action-driven gesture arbitration.

**Fixed** (commit `fix(07): G-4 permit vertical page scroll and pinch-zoom on every table/tab-strip
scroller`): added a custom Tailwind utility `touch-pan-xy` (`touch-action: pan-x pan-y
pinch-zoom`) in `apps/web/src/styles/theme.css`, since Tailwind's own `touch-pan-x`/`touch-pan-y`
utilities both set the same single-value CSS property and overwrite each other. `pinch-zoom` is
named explicitly — `pan-x` alone also disables pinch-zoom, an accessibility regression on dense
data tables the fix would otherwise have silently kept. `overscroll-x-contain` (the property that
actually stops the PAGE panning sideways, guarded by `no-page-pan.spec.ts`) is untouched
everywhere it already appears — a completely different CSS property from `touch-action`.

Verified against a local build: Chromium's `getComputedStyle` canonicalizes a computed `touch-action:
pan-x pan-y pinch-zoom` down to the single equivalent keyword `"manipulation"` rather than echoing
the three keywords back verbatim.

`QualsTab.test.tsx`'s scroll-region-siblinghood assertion previously pinned `touch-pan-x` as
expected behaviour — that test encoded the defect itself; updated to assert `touch-pan-xy`.

**Test evidence** (commit `test(07): G-4 add computed touch-action e2e assertions, proven RED
pre-fix`): `apps/web/e2e/touch-action-vertical-scroll.spec.ts` (phone-390/pixel-10) asserts computed
`touch-action` permits vertical panning (and `overscroll-behavior-x` stays `"contain"`) across
every named region. Run against the currently deployed origin (pre-fix): all 7 assertions failed
RED with computed `touch-action` exactly `"pan-x"` on every region — the event tab strip, all five
event tables, and the team page's per-event match-table scroller.

Stated honestly (per this test's own file header): this checks the CSS CONTRACT only. It cannot
and does not prove real-device gesture arbitration — that remains Test 1's human real-device
check, exactly per Pitfall 6's own warning.

### G-5 — Tab strip trigger widths are force-equalized against varying label widths

severity: medium
status: fixed, pending live re-verification
surfaces: event tab strip (`apps/web/src/components/ui/tabs.tsx`'s `TabsTrigger`)

Reported: "visually the tabs are not spaced well." Measured live at 390px — every tab box was
forced to an identical 67px while the label text varied 36-76px, so the visual gap between
adjacent labels varied nearly 4x:

| tab | box | text | slack | visual gap to previous |
|-----------|----:|----:|-----:|-----:|
| Insights  | 67 | 54 | 14 | - |
| Breakdown | 67 | **76** | **-9** | 6px |
| Quals     | 67 | 39 | 28 | 14px |
| Alliances | 67 | 62 | 5  | 21px |
| Elims     | 67 | 36 | 31 | 22px |

342px strip / 5 tabs is about 68, so `TabsTrigger`'s base `flex-1` was splitting the container
evenly — "Breakdown" text at 76px overflowed its own 67px box. Padding (`px-1.5`) and the list's
own `gap-1` were already uniform; the equalization was the only source of non-uniform spacing.

**Fixed** (commit `fix(07): G-5 size event tab strip triggers to their own content`): added a
scoped `group-data-[variant=line]/tabs-list:flex-none` override so `line`-variant triggers (the
only variant this codebase renders in a scrollable strip — event AND team page tab strips both use
it) size to their own content instead of stretching equally. Scoped to `variant=line` only, not
applied unconditionally, so a future `default`-variant segmented control (which legitimately wants
equal-width children) is unaffected. Verified the compiled CSS specificity resolves correctly:
the override's selector computes to (0,2,0) against the base `.flex-1`'s (0,1,0), winning
regardless of source order.

Verified against a local build (the tab strip renders independent of artifact data, so this did
not need the deployed origin's live data): adjacent-label gaps became exactly uniform (18.0px each
— measured via a Range over each trigger's own text node, not the button's box, since box-to-box
measurement stays uniform even with the pre-fix defect fully present and would not have caught
it), previously 6-22px, with zero label overflow.

**Test evidence**: `apps/web/e2e/tab-strip-trigger-sizing.spec.ts` (phone-390/pixel-10) proven RED
against the currently deployed origin pre-fix: "Breakdown"'s scrollWidth (71px) exceeded its own
clientWidth (65px), reproducing the exact overflow measured above. Confirmed GREEN against a local
build of the fixed commit.

### G-6 — Centered justification on an overflowing tab strip hides the leading tab

severity: medium
status: fixed, pending live re-verification
surfaces: event tab strip (`apps/web/src/components/ui/tabs.tsx`'s `TabsList`)

The tab strip's `TabsList` computed `justify-content: center` while the strip overflows
(scrollWidth 358px > clientWidth 342px at 390px). In a scrollable flex container, centered
justification pushes overflow past the scroll origin, so the leading content cannot be reached by
scrolling — there is no negative `scrollLeft`.

**Fixed** (commit `fix(07): G-6 start-align the tab strip's TabsList once it overflows`): switched
`justify-center` to Tailwind's `justify-center-safe` (`justify-content: safe center`) — the CSS
Box Alignment spec's own answer to exactly this shape: center when the content fits, fall back to
start-alignment the instant it would overflow. No JS measurement needed, and centering still
applies (as this gap's own framing asked for) whenever the strip's content is short enough to fit.

Verified against a local build: computed `justify-content` resolved to `"safe center"`, and the
first tab's left edge (27px) sits inside the scroller's own left edge (24px) at `scrollLeft` 0 —
reachable, whereas plain `"center"` pre-fix pushed it out of reach.

**Test evidence**: `apps/web/e2e/tab-strip-alignment.spec.ts` (phone-390/pixel-10) proven RED
against the currently deployed origin pre-fix: `TabsList`'s computed `justify-content` was exactly
`"center"` while the strip overflows. Confirmed GREEN against a local build of the fixed commit.

### G-7 — Breakdown table overflows its scroller on desktop; not all columns reachable without horizontal scroll

severity: high
status: partially fixed (real, measured improvement — full elimination is architecturally blocked, see below), pending deploy
surfaces: BreakdownTab (`apps/web/src/components/event/BreakdownTab.tsx`), the event route's content container (`apps/web/src/routes/event.$eventKey.tsx`)

Developer report, desktop: "on breakdown, I should see every column always. I have to jank scroll
right to see total" — "jank" meaning awkward/fiddly to reach, not stuttery (a fitting problem, not
a rendering-performance one).

Measured live on the deployed site, `2024new` Breakdown tab, at both 1440px and 1280px (both
capped identically by the shared `max-w-[1200px]` content column — same class team pages use):

```
scroller = 1152px      tableTotal = 1988px      OVERFLOW = 836px
16 columns: teamNumber(88) + nickname(220) + 14 metric columns @120px
```

**Approved approach (developer-directed):** widen the Breakdown tab's own container (scoped to
this tab only) and allow header labels to wrap.

**Fixed** (this task):
1. **Container widened, scoped to Breakdown only.** `event.$eventKey.tsx`'s content wrapper drops
   the shared `max-w-[1200px]` cap specifically when `activeTab === "breakdown"` — every other tab
   (Insights/Quals/Alliances/Elims) and the team page keep the cap unchanged, since Quals/Elims's
   own fixed 470px plot-width math depends on it. `BreakdownTab.tsx`'s own `<table>` now declares
   an EXACT pixel `width` (`table.getTotalSize()`, replacing `width: "100%"` + a `minWidth` floor)
   rather than stretching to fill the container — this is what makes the widen safe on any monitor:
   the table can never grow past its own declared column total, so widening the container beyond
   that total just leaves harmless blank space to the table's right, never inflated (G-1-breaking)
   column widths.
2. **Header labels humanized and wrapped, desktop only.** `metricLabel()` now splits a declared
   camelCase key at its own casing/digit boundaries into space-separated Title Case
   (`teleopSpeakerNoteAmplified` -> `"Teleop Speaker Note Amplified"`, `hubShift1` -> `"Hub Shift
   1"`) — necessary, not cosmetic: a bare camelCase string carries no whitespace, so allowing a
   header to wrap without also inserting real spaces would force the browser to break mid-character
   rather than at a real word boundary. `TableHead`'s fixed `h-10`/`whitespace-nowrap` is overridden
   (`h-auto`/`whitespace-normal`) so the header row grows to fit wrapped text instead of truncating
   to an ellipsis. Scoped to `!isNarrow` (desktop) only — mobile keeps the exact pre-existing
   single-line `truncate` treatment; the pending-state skeleton also keeps `truncate` (only its
   label TEXT is humanized), since it carries no `isNarrow` signal of its own and its transient,
   briefly-visible row height was never covered by any G-1/G-2/G-3 measurement.

**Real-geometry finding — full elimination is NOT achievable within this task's scope:**

The 120px metric-column width was **not** narrowed, despite the container widen freeing up real
space, because doing so is unsafe. Measured directly (Playwright, `min-width` disabled to read the
box's true content need) against the real DEPLOYED `2024new` and `2026alhu` artifacts: the widest
real `"value ± spread"` string `MetricValue.tsx` ever renders needs **~97-106px of content width**
on its own (`.metric-tier`'s shared `min-width: 80px` floor in `theme.css` turns out not even to be
the binding constraint — the real text run for a 2-decimal value plus a 2-decimal spread, e.g.
`"284.89 ± 8.75"`, is 12-13 tabular-numeral characters and is what actually needs the room).
Combined with `TableCell`'s own `p-2` padding, this leaves essentially no room to shrink a metric
column below its current 120px without risking the box visually bleeding into the next column — a
regression the developer explicitly asked this fix to avoid ("do not shrink columns so far that
values collide").

Given that hard floor, the arithmetic does not close at either target viewport, even using the
FULL viewport width (no cap at all) for the container:

```
1440px: scroller (viewport - 48px padding) = 1392px;  table total (unchanged) = 1988px;  residual overflow = 596px
1280px: scroller (viewport - 48px padding) = 1232px;  table total (unchanged) = 1988px;  residual overflow = 756px
```

Both are a **real, substantial improvement** over the 836px baseline (29% reduction at 1440px, 10%
at 1280px — 1280px is only slightly wider than the OLD 1200px cap, so it gains less), but neither
reaches zero. **What width would fit:** with the metric-column width held at its current
collision-safe 120px, all 14 columns need `308px (identity) + 14 x 120px = 1988px` of table width,
i.e. a viewport of roughly **2036px** (1988 + 48px padding) — wider than any conventional laptop
display, though within reach of a 1920px/2560px external monitor with some margin either way.

**Why this wasn't resolved further:** the binding constraint is `MetricValue.tsx`'s shared
value-display geometry (`theme.css`'s `.metric-tier`), which renders on the Team page, the Teams
table, and Insights as well as Breakdown — narrowing it is a cross-page design change, explicitly
outside this task's file ownership (`BreakdownTab.tsx` and this route's container only) and outside
the developer's own approved approach (container width + header wrap, not a value-display
redesign). Per this task's own instruction to surface infeasibility with numbers rather than ship a
silent partial fix, this is flagged here for a follow-up product/design decision: accept the
residual scroll, reduce the default-visible metric-column count (e.g. group into Auto/Teleop/
Endgame phase totals with a drill-down), target a wider desktop breakpoint only, or redesign
`MetricValue`'s box to be narrower specifically on this page.

**Test evidence**: `apps/web/e2e/breakdown-desktop-overflow.spec.ts` (new; `desktop` project,
overrides viewport to 1440px and 1280px per test). Proven RED against the currently-deployed origin
pre-fix: both viewports measured `scroller=1152.0px table=1988.0px overflow=836.0px`, exactly
matching this gap's own reported numbers. The overflow assertions bound the EXPECTED post-deploy
result (<=620px at 1440px, <=780px at 1280px — both comfortably under the 836px baseline, with a
~25px buffer for cross-environment font rendering) rather than a false "zero overflow" claim; a
header-wrap-clipping assertion and a G-1 declared-vs-actual/sticky-gap regression check both pass
already (unaffected by whether the overflow fix itself is deployed). Awaiting deploy for GREEN
confirmation on the two overflow assertions.

**Out-of-scope discovery, not fixed here:** verifying this change against
`table-layout-quality.spec.ts` surfaced a PRE-EXISTING, unrelated failure on the deployed origin —
G-2 part 2's "at least one full data column visible at scroll 0" assertion fails on the `pixel-10`
project (312px scroller) for Insights and TeamsTable (not Breakdown, which passes on both mobile
projects). Reproduced twice with retries; not a flake. Outside this task's file ownership
(`InsightsTab.tsx`/`TeamsTable.tsx`) — logged to `deferred-items.md` rather than fixed here.

### G-8 — Alliances tab rebuilt to spec (nicknames, pick labels, tiering, record) — real-device UAT

severity: high
status: fixed, pending live re-verification (deploy + full republish)
surfaces: AlliancesTab, packages/harness (pageArtifacts.ts, publish.ts), packages/corpus (db.ts)

Real-device UAT on `2023cur` alliance 1 found five separate defects/gaps in the Alliances tab,
gathered directly from the developer against the deployed site:

1. **Nicknames rendered alongside team numbers** (`5940BREAD`) — the developer wants team numbers
   ONLY, no names anywhere on this tab.
2. **The pick columns were mislabelled** — `picks[1]` (TBA's own FIRST additional pick) rendered
   under the header "Pick 2", `picks[2]` under "Pick 3", and the 4th/backup pick under "Backup".
   The first pick has been labelled "Pick 2" since this tab shipped — a correctness fix, not
   cosmetics.
3. **No per-team metric was visible on a pick cell** — only the raw number and nickname. Each
   team's own `metrics.total` (`{value, spread, percentile}`) is already published per event team;
   nothing stopped rendering it.
4. **The Combined Total carried no tier at all** — correctly, since no percentile is published for
   a 3-team sum (`apps/web/src/lib/metricGroups.ts`'s own header: "nor can a percentile be
   derived, since a sum's rank is not a function of its parts' ranks"). The developer chose a
   lighter client-side APPROXIMATION over the pipeline-side fix Phase 6 gave the Auto/Teleop/
   Endgame phase tiles for the identical problem: divide the combined value by 3 and interpolate
   that per-team-equivalent against the event's own published (total.value, total.percentile)
   pairs.
5. **The alliance's playoff win-loss-tie record existed in the corpus but was never published** —
   `event_alliances.status_raw` already carries TBA's verbatim `status` object (e.g. `{"record":
   {"losses":3,"ties":0,"wins":4},"status":"eliminated","level":"f","double_elim_round":"Finals"}`)
   but `EventAllianceSchema` published only `allianceNumber`/`name`/`picks`.

Separately, the developer made two decisions to STATE explicitly rather than change:

- The Combined Total's `√(Σσ²)` arithmetic is correct and unchanged (D-15) — it already sums only
  the first three picks and already renders a `±`. What was missing was a code comment recording
  that it assumes ZERO inter-team covariance, that `sigma1`'s `covEwmaAlpha`/`covShrinkage` govern
  only a single team's own per-component covariance fold (never a cross-team one —
  `packages/core/algorithms/sigma1/covariance.ts`'s own header, D-06 of Phase 2), and that this is
  the same trade-off `metricGroups.ts` records being resolved the OTHER way for the phase tiles.
- The approximate 3x-heuristic tier must be visibly, honestly labelled as an estimate — never
  presented with the same confidence as a team's own exact published tier.

**Fixed**, four commits:

- `feat(07-21): parse alliance playoff record from status_raw` — `packages/corpus/db.ts` gains
  `parseAllianceRecord`, a Zod-validated extraction of `{wins, losses, ties}` from TBA's `status`
  object, collapsing every honest absence (no `status_raw`, unparseable JSON, an unmodelled
  `playoff_type` shape, a partial record) to `null` through one rule — never a fabricated `0-0-0`.
  `selectEventAlliancesForSeason` now selects `status_raw` and populates
  `EventAllianceSelection.record`.
- `feat(07-21): client 3x heuristic for an alliance's combined-total tier` —
  `apps/web/src/lib/allianceTierApproximation.ts` (new file):
  `buildTeamValuePercentilePoints`/`estimateCombinedTier` implement the developer's chosen method
  exactly (divide by 3, interpolate against the event's own published per-team points, clamp
  outside the observed range, skip teams with no published percentile rather than treating them as
  0). 11 unit tests.
- `feat(07-21): publish an alliance's playoff win-loss-tie record` — `EventAllianceSchema` gains an
  optional `record` (reusing the existing `RecordSchema`), and `buildEventArtifact` threads it
  through with the same undefined-or-null-omits-the-key discipline every other optional field in
  this file already uses.
- `feat(07-21): rebuild the Alliances tab per real-device UAT` — `AlliancesTab.tsx`: dropped
  `nickname` from `AlliancePick` entirely (not merely un-rendered — the field no longer exists on
  the interface); relabelled the headers to `Captain / Pick 1 / Pick 2 / Pick 3 / Combined Total /
  Record` (column ids unchanged — `pick0`/`pick1`/`pick2`/`pickBackup`/`combined`, plus a new
  `record` — so the existing e2e suite's testid-keyed assertions did not need to change); each pick
  cell now renders the team's own total metric via `MetricValue`, tiered by
  `tierForPercentile(pick.total?.percentile)` — its OWN exact published percentile, never the
  alliance's approximate one; the Combined Total cell renders the 3x-heuristic tier through the
  SAME `MetricValue` component plus a quiet `≈` marker (rendered only when a tier box actually
  draws — Common has nothing to qualify) carrying a `title`/`aria-label` disclosure; the
  independence assumption is now documented inline on `combineAlliancePicks` per the two decisions
  above, with NO arithmetic change; a new Record column renders `formatAllianceRecord` (mirrors
  `InsightsTab.tsx`'s `formatEventRecord` convention, restated rather than imported across the
  module boundary).

**Table-layout re-evaluated** (design_context ask): this tab's pick columns previously ran
`table-layout: auto` because they relied on auto layout's free growth to show a full, untruncated
nickname (recorded in G-1's own write-up as the deliberate reason this tab was excluded from that
gap's `fixed` fix). Dropping the nickname removes that reason entirely — every pick cell now
renders only a team number plus a `MetricValue`, whose width is bounded by CSS
(`.metric-tier`'s own `min-width: 80px`), never free-growing text. Switched to `table-layout:
fixed`, matching every other event table. This tab has no pinned columns, so there was never a
sticky-offset defect either layout choice could introduce or fix here — the only property in play
is declared-vs-actual column width, which `fixed` makes equal by construction.

**Test evidence**: 26 new/changed unit tests across `packages/corpus/db.test.ts`,
`packages/harness/pageArtifacts.test.ts`, `packages/harness/publish.test.ts`,
`apps/web/src/lib/allianceTierApproximation.test.ts` and
`apps/web/src/components/event/AlliancesTab.test.tsx` (rewritten sections for the dropped
nickname, corrected labels, per-pick tiering, 3x-heuristic tiering, and the new Record column).
Full project `npx vitest run`: 2052 passed, 1 skipped, 2 failures — both the pre-accepted
`payloadBudget.test.ts` ledger entries (#11, #15); two ADDITIONAL failures observed in
`BreakdownTab.test.tsx` are pre-existing in a concurrent, uncommitted, in-progress edit to that
file by a different agent working the same phase in parallel (out of this gap's ownership scope,
per this plan's explicit file-ownership boundary) — not caused by, or fixed by, this gap's work.

Pending: the full republish (`pnpm publish:seasons`) to actually populate `record` on
already-published artifacts, and live re-verification against the deployed origin once that
republish and this commit both ship.

### G-9 — Zebra striping invisible on Quals/Elims: the untinted row borrowed its colour from an ancestor that does not exist there

severity: high
status: fixed, pending live re-verification
surfaces: EventMatchTable (Quals, Elims), theme.css's `.match-row-tint`

Developer report: "zebra stripes seem broken on event quals/elims pages."

Measured on the deployed site, `2023cur` Quals at 1280px, first three body rows:

```
row0 (untinted)  tr.bg=transparent
   td0 ownBg=rgb(241,245,249)   effective=rgb(241,245,249)
   td1..3 ownBg=transparent      effective=rgb(248,250,252)
row1 (TINTED)    tr.bg=rgb(248,250,252)  tr.class="match-row-tint"
   td0 ownBg=rgb(248,250,252)   effective=rgb(248,250,252)
   td1..3 ownBg=transparent      effective=rgb(248,250,252)
```

`.match-row-tint` is `background-color: var(--color-bg-page)`. Its own comment stated the
assumption it depended on: "Applied INSIDE an `.event-card`, so the untinted row quietly inherits
the card's own `--color-bg-surface` and this tint's `--color-bg-page` is the one that visibly
pops." That holds on the team page (`EventSection.tsx` wraps `MatchTable` in `.event-card`), but
`EventMatchTable` (shared by Quals and Elims) has no card ancestor — verified live,
`tinted.closest(".event-card")` is `false` on the event page. There the untinted row fell through
to the PAGE background, which is the exact colour the tint paints, so tinted rows rendered
invisible. The only thing that still visibly alternated was the sticky first `<td>`, which carries
its own opaque background for an unrelated reason (staying readable over horizontally-scrolling
content) — a real user sees one darker square per alternate row and no full-width stripe.

**Fixed** (commit `fix(07): G-9 paint both zebra-stripe states explicitly, independent of ancestor`):
both alternating states are now painted explicitly from existing tokens rather than one state
staying `background: transparent` and inheriting whatever happens to sit behind it —
`theme.css` gains `.match-row-untinted { background-color: var(--color-bg-surface); }` alongside
the existing `.match-row-tint { background-color: var(--color-bg-page); }`. `EventMatchTable.tsx`
and `MatchTable.tsx` (D-06: shared fix, both tables render the identical CSS classes) now apply
`tinted ? "match-row-tint" : "match-row-untinted"` to both the `<tr>` and its sticky first `<td>`
uniformly — the sticky cell previously carried an independent `bg-[var(--color-bg-surface)]`
literal in its untinted branch, which happened to equal the intended colour but was a second,
separately-maintained source of the same fact; it now reads off the same two classes the row
itself uses, so the pinned cell can never drift from its own row's stripe.

No third colour was invented (D-06): the two tokens are unchanged from before this fix
(`--color-bg-surface` / `--color-bg-page`), so the team page's rendered output is byte-identical to
when it inherited its untinted colour from `.event-card` — confirmed by this task's own e2e proof
(the team page assertion passed both before and after, since it was never broken).

**Contrast, checked against the decided palette (not invented):** the pair's rgb values differ by
~7/255 (~2.7%), a subtle delta. The `sketch-findings-sigmascout` skill's `colour-and-tiers.md` and
`chart-craft.md` name `--color-bg-page`/`--color-bg-surface` as the two tokens this exact zebra
tint is built from (`chart-craft.md`: "A zebra tint on alternate rows reinforces the block";
`theme.css`'s own header: these are the 60%/30% dominant/secondary surface tokens, the only two
neutral background tokens in the palette) and neither reference proposes an alternative, higher-
contrast pairing for this purpose. This is the genuinely decided pair — kept as-is rather than
inventing a third shade the skill does not name. The full-width fix itself (rather than a
one-darker-square accent) is what restores legibility: the same subtle delta reads clearly once it
spans the entire row rather than one ~50px sticky cell.

**Dark mode:** not applicable — this app has no dark theme. `theme.css` defines exactly one
`@theme` block with no `.dark` class or `prefers-color-scheme` override, and no component ever
toggles one (the stray `dark:` classes inside a handful of generated `src/components/ui/*`
primitives are unused shadcn boilerplate — no ancestor ever carries a `.dark` class for them to
match). Nothing to verify.

**Other event tables audited (Insights, Breakdown, Alliances, Teams table):** none of these render
zebra striping at all — verified by grep, no `match-row-tint`/`index % 2`-style row-tinting pattern
exists anywhere in `InsightsTab.tsx`, `BreakdownTab.tsx`, `AlliancesTab.tsx` or `TeamsTable.tsx`.
Their rows use only the shadcn `TableRow` primitive's default `border-b` separator between rows
(`apps/web/src/components/ui/table.tsx`) — never unstriped-by-a-bug, unstriped by design. This
gap's fix is therefore scoped correctly to the one CSS class (`match-row-tint`/
`match-row-untinted`) and the two components (`MatchTable.tsx`, `EventMatchTable.tsx`) that
actually implement this pattern.

**Test evidence**:
- Unit tests (`MatchTable.test.tsx`, `EventMatchTable.test.tsx`): both now assert the untinted row
  and its sticky cell carry the explicit `match-row-untinted` class (never merely "the two rows'
  classes differ," which the pre-fix transparent-background code already satisfied) — this is the
  assertion shape that would have caught `EventMatchTable.tsx` sharing the class without the
  `.event-card` ancestor `MatchTable.tsx` happened to have.
- New `apps/web/e2e/zebra-stripe-full-row.spec.ts` (desktop project, deployed origin): asserts the
  EFFECTIVE background colour (walking up the ancestor chain past any `transparent` box, mirroring
  exactly how this defect was diagnosed live) of the first 4 cells in each of 3 consecutive body
  rows differs from the row before it — on Quals, Elims, and the team page — plus that the sticky
  first cell's own background always matches its row's effective background. Proven RED against
  the currently-deployed origin pre-fix: Quals and Elims both failed with cells 1-3 measuring an
  IDENTICAL `rgb(248, 250, 252)` across every row (only cell 0, the sticky column, alternated:
  `rgb(241, 245, 249)` / `rgb(248, 250, 252)`), and the sticky-cell-matches-own-row assertion failed
  with the sticky cell reading `rgb(241, 245, 249)` while its row's own effective background read
  `rgb(248, 250, 252)` — reproducing this gap's own live diagnosis exactly. The team page assertion
  passed unmodified both before and after (it was never broken), serving as this fix's own
  regression guard.
- Full project `npx vitest run` (repo root): 2056 passed, 1 skipped, 2 failures — both the
  pre-accepted `payloadBudget.test.ts` ledger entries (#11, #15); no new failures.

Pending: deploy, then live re-verification of `zebra-stripe-full-row.spec.ts` against
`https://sigmascout.org` for GREEN confirmation on Quals/Elims (the team page assertion already
passes and is a regression guard only).

### G-10 — Metric-cell redesign (superscript spread) to recover Breakdown's residual overflow

severity: high
status: fixed, pending deploy + live re-verification
surfaces: `MetricValue.tsx` (shared cell — Team page, Teams table, Insights, Breakdown), `theme.css`'s `.metric-tier`, `BreakdownTab.tsx`

G-7 left Breakdown's desktop overflow at 596px/756px (1440px/1280px) because it could not touch
`MetricValue.tsx`'s shared value-display geometry — narrowing it was flagged there as a follow-up
product/design decision, not something that fix could resolve unilaterally. The developer's own
verbatim direction for that follow-up: "I like the idea of redesigning the metric cell. make the
glyph and the spread smaller, make them grey, and make them like a superscript, top aligned with
the value number." The value stays full-size; only the `±` glyph and the spread number shrink,
grey, and rise.

**Fixed**, three files:

- `MetricValue.tsx`: the `± {spread}` suffix now renders through a new `.metric-spread-superscript`
  class instead of `.text-role-spread-suffix` — a deliberately SEPARATE class, not a redefinition,
  because `.text-role-spread-suffix` is also consumed by `EventMatchTable.tsx`/`MatchTable.tsx`'s
  own inline match-row sd suffix (a different surface this fix never measured or screenshotted).
  The value span, the DOM text content, and the digit/rounding logic are all byte-identical to
  before — confirmed by `MetricValue.test.tsx`'s existing assertions passing unchanged (37/37).
- `theme.css`: `.metric-spread-superscript` (9px/400/line-height 1, `position: relative; top:
  -3.5px`) and `.metric-tier`'s `min-width` lowered from 80px to 58px (a box-alignment floor, not
  a universal size — the real worst-case wide value still exceeds it and renders at its own natural
  width). `position: relative` was chosen deliberately over `vertical-align: super`/`<sup>`'s own
  default styling: both participate in the inline box's own line-height calculation and can grow
  row height, exactly the risk this table's 130-row Breakdown/Insights tables cannot absorb.
  `position: relative` paints the element offset from its normal position but keeps its ORIGINAL
  in-flow box for layout purposes, so the line box is computed as if `top` were never set.
- `BreakdownTab.tsx`: the redesign only meaningfully narrows a column's real content when the VALUE
  itself is small, so metric columns now take one of two declared widths instead of a uniform
  120px — `BREAKDOWN_METRIC_COLUMN_WIDTH_PX = 110` for the 13 non-Total columns,
  `BREAKDOWN_TOTAL_COLUMN_WIDTH_PX = 118` for `TOTAL_KEY` alone, whose value can run to six digits.

**Accessibility, computed not assumed (constraint from the developer's own brief):** the suffix's
colour is unchanged — it still resolves through `text-muted-foreground` / `--color-text-muted`
(`#475569`), the same token `.text-role-spread-suffix` already used. Superscripting makes the text
SMALLER, so the WCAG bar is the full 4.5:1 normal-text floor, not the relaxed 3:1 large-text one.
Measured live with the dataviz skill's `validate_palette.js` (its exported `contrast()` — the same
WCAG relative-luminance formula the skill uses for its own "Contrast vs surface" check) against
every background this text lands on:

| background | ratio |
|---|---|
| `--color-bg-page` (#f8fafc) | 7.24:1 |
| `--color-bg-surface` (#f1f5f9) | 6.92:1 |
| `--tier-rare-bg` (#E0F2FE) | 6.60:1 |
| `--tier-epic-bg` (#F3E8FF) | 6.42:1 |
| `--tier-legendary-bg` (#FEF3C7) | 6.81:1 |

All five clear 4.5:1 with room to spare (worst case 6.42:1, ~1.4x the floor) — no palette change
needed or made.

**Accessible name:** unaffected — this is a presentation-only change over the identical
`" ± {spread}"` string, same DOM order, same text nodes. `MetricValue.test.tsx`'s own assertions
(e.g. `"88.20 ± 3.10"` as one concatenated `textContent`) pass unchanged, proving the accessible
name a screen reader reads is byte-identical to before this fix.

**Row height, verified not assumed:** measured a Breakdown row's height with the new
`.metric-spread-superscript` (43px) against the same row with `.metric-spread-superscript`
CSS-overridden back to the OLD suffix geometry (12px, static position, no raise) — both measured
**43px**, byte-identical, confirming the `position: relative` choice above does not grow row height.

**Overflow, measured honestly against 0 (not just against the 836px original baseline):**

```
Table width: 88 (teamNumber) + 220 (nickname) + 13x110 + 1x118 = 1856px   (was 1988px, -132px)
1440px: scroller 1392px, overflow 464px   (was 596px)
1280px: scroller 1232px, overflow 624px   (was 756px)
```

**Does NOT reach zero.** Reaching zero at 1440px needs the 14 metric columns to average ~77px
(1392 - 308 identity columns, / 14) — below even this fix's own redesigned non-Total floor
(94-102px minimum real content, `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`'s own doc comment). The Total
column's own floor is wider still (six-digit values, e.g. `"284.89 ± 8.75"`, measured live against
the deployed 2026alhu artifact — 95.8px of real content). Eliminating the remaining ~460-620px
needs one of: a wider target viewport (roughly **1904px**, down from G-7's ~2036px estimate),
fewer default-visible metric columns, or hiding/collapsing the spread entirely on this one dense
table — each a further product/design decision, not something this fix resolves unilaterally.

**All four sharing surfaces shown, per-surface verdict:**

- **Breakdown** — the intended target. Narrower cells recover 132px of table width (details above);
  no clipping across 672 cells checked (48-team 2026alhu roster x 14 columns), same 43px row height.
- **Teams table** — reads well: tier boxes are visibly more compact, no readability loss, screenshot
  reviewed live against the deployed 2024 season data.
- **Insights** — reads well, same as Teams table; the tier-key legend row (`TierKeyRow.tsx`, plain
  percentile-range text, no spread) is unaffected by the `min-width` change since its own content
  never approached either the old or new floor.
- **Team page (Overview season header + per-event grid)** — **flagged, not vetoed by this fix.**
  These boxes are much WIDER than a table cell (they fill a flex row, ~390px+), and at that width a
  9px superscript reads visually sparse against the box's own size — screenshotted live
  (`13.10 ± 2.57` in the season header) for the developer's own judgement. This is exactly the risk
  named in this fix's own brief ("the team page... where the old full-size ± may have been serving
  a purpose"). Left as-is pending developer sign-off — a per-surface size variant (e.g. a larger
  superscript specifically on wide boxes) is a straightforward follow-up if the developer vetoes
  this surface, but was not built speculatively here.

**Mobile 390px, re-verified (no regression):** Breakdown's pinned `teamNumber` block measures 72px
(inside the existing 72-128px band), declared==actual within 1px, and the first non-pinned metric
column is fully visible at scroll 0 (x=96, inside the 24-366px scroller) — all unaffected by this
fix since neither the pinned identity columns nor the mobile breakpoint logic changed. The new
110px/118px metric-column widths are strictly narrower than the pre-fix 120px, so mobile horizontal
scroll distance can only decrease, never regress.

**Test evidence**:
- `MetricValue.test.tsx` (37 tests, unchanged): pass unmodified, proving the DOM text/accessible
  name is byte-identical.
- `apps/web/e2e/breakdown-desktop-overflow.spec.ts` updated (per this gap's own instruction not to
  leave a stale bound): `OVERFLOW_BOUNDS_PX` moved from `{1440: 620, 1280: 780}` to `{1440: 490,
  1280: 650}` (real measured 464px/624px plus the same ~25px cross-environment buffer G-7 used);
  the prior G-7 bound is retained as `PRE_G10_OVERFLOW_PX` so the file asserts improvement over
  BOTH the original 836px baseline and G-7's own intermediate one. Added a new clipping regression
  guard (`no metric-tier cell content clips at the narrowed column widths`) run against both
  2024new (the file's primary target) and 2026alhu (the six-digit-Total worst case this fix's
  column widths were sized against) — 6 tests total, all pass locally against a fixture-backed
  dev server serving the real, deployed 2024new/2026alhu artifacts (same measurement method this
  file's own G-7 section established; `data.sigmascout.org`'s CORS excludes localhost).
- Full project `npx vitest run` (repo root): 2056 passed, 1 skipped, 2 failures — both the
  pre-accepted `payloadBudget.test.ts` ledger entries (#11, #15); no new failures.
- `apps/web/tsc --noEmit`: clean.

Pending: deploy, then live re-verification of `breakdown-desktop-overflow.spec.ts` against
`https://sigmascout.org` for GREEN confirmation at the new bounds, and developer sign-off on the
team page's wider-box superscript treatment specifically.

---

## Developer decisions, 2026-08-30 (closing G-7 / G-10)

**G-7 / G-10 — Breakdown desktop overflow: ACCEPTED AT 464px. Not a defect; a decision.**

Three passes, each a real reduction, measured live at 1440px:

| pass | overflow |
|------|---------:|
| original | 836px |
| G-7 widen container + wrap headers | 596px |
| G-10 superscript metric cell | **464px** |

Styling has run out of room. The remaining floor is the Total column's genuine worst case
(`284.89 ± 8.75`, from the live 2026alhu artifact) — real data width, not waste. Reaching zero at
1440px would need ~1904px of viewport. The only remaining lever is showing fewer columns by
default (a column picker), which the developer declined in favour of banking the 45% reduction.

Breakdown therefore remains horizontally scrollable on desktop, deliberately. `Total` is still
off-screen at 1440px. Do NOT reopen this as a bug — reopen it only as a column-picker feature.

**G-10 — superscript metric cell: KEPT ON ALL FOUR SURFACES.**

The team page's wider season-header metric boxes read visually sparse with the 9px superscript
(flagged rather than silently shipped). The developer chose consistency across team page, Teams
table, Insights and Breakdown over per-surface optimisation. If that box is revisited later, adjust
its padding rather than reintroducing a second `±` treatment.

Contrast validated via the dataviz skill's `validate_palette.js`: grey `#475569` measures 6.42-7.24:1
across page, surface, and all four tier tints — above the 4.5:1 small-text floor. Row height
unchanged (43px). Accessible text byte-identical.

### G-11 — G-2 part 2 still RED on `pixel-10` (312px scroller): Insights `record` and TeamsTable's first metric column both miss by a few pixels

severity: high
status: fixed, pending deploy + live re-verification
surfaces: `teams-table/columns.tsx` (`RECORD_COLUMN_WIDTH_NARROW_PX`, `buildColumns`), `InsightsTab.tsx`

Logged in `deferred-items.md` during G-7 as out-of-scope for that task; promoted to a gap and fixed
here. `table-layout-quality.spec.ts`'s "G-2 part 2 — at least one full data column visible at
scroll 0" failed on `pixel-10` (312px scroller, 360px viewport) for Insights and TeamsTable only
(Breakdown already passed both mobile projects). Measured live against the deployed origin:

```
insights @390px  scroller=342  rank:56/56  teamNumber:72/72  nickname:90/90  record:100/100 ✓  rp:84/24
insights @360px  scroller=312  rank:56/56  teamNumber:72/72  nickname:90/90  record:100/94  ✗  rp:84/0
teams    @390px  scroller=342  rank:56/56  teamNumber:72/72  nickname:90/90  autoLeave:120/120 ✓
teams    @360px  scroller=312  rank:56/56  teamNumber:72/72  nickname:90/90  autoLeave:120/94  ✗
```

Identity (rank+teamNumber+nickname) is 218px at both widths; `phone-390`'s 342px scroller leaves
124px (enough for the old 100-120px column), `pixel-10`'s 312px scroller leaves only 94px. G-2
part 2's own `NICKNAME_COLUMN_WIDTH_NARROW_PX` derivation was checked only against `phone-390`;
this is the same class of miss, one scroller-width narrower.

**Investigated and rejected: narrowing the metric-tier column itself.** G-10's superscript redesign
lowered `.metric-tier`'s `min-width` from 80 to 58, freeing real space — the first candidate fix was
narrowing the shared 120px metric column to fit inside the 94px budget (~88-90px). Checked against
real rendered geometry before committing to it: G-10's own live measurement (this file, above)
already established the real worst-case NON-Total value+spread string needs ~86.7px of rendered box
width on its own, which already exceeds 94px before `TableCell`'s 16px `p-2` padding is even added
(86.7 + 16 = 102.7px minimum, zero buffer). Independently re-confirmed live against every published
`teams/{year}/{vpr,opr,epa}@*.json` and `event/2026alhu/{opr,epa}@*.json` artifact (2022-2026): OPR/
EPA carry no spread at all (`"total: 429.48"`, 2026 OPR, no `±`) but VPR's spread-bearing values
reach `"total: 100.13 ± 26.24"` (2025) at full magnitude. A `.metric-tier` box genuinely cannot
shrink to 94px without a real risk of a value visually bleeding into its neighbour's cell — table
cells default to `overflow: visible`, so this would not even fail as a clean, detectable clip. Per
this gap's own "do not clip metric values" instruction, this path was rejected with the arithmetic
above rather than forced.

Separately discovered and NOT fixed here (out of scope, logged to `deferred-items.md`): the current
`2026` VPR artifact carries an extreme outlier — `total: -1354.13`, `hubEndgame: -1141.94 ± 155.53`
— almost certainly a cold-start artifact for a team with ~0 matches this (barely started) season
(`coldStartTeamTotal`/`coldStartConsistencyVariance` in the published VPR params). This number alone
would already break the *existing, shipped* `BREAKDOWN_METRIC_COLUMN_WIDTH_PX`/`_TOTAL_` no-clip
guarantee if it ever renders in a metric-tier box; it is a modelling/pipeline concern, not a layout
one, and outside this gap's file ownership.

**Fixed** (commit `fix(07): G-11 narrow record's column and reorder it ahead of TeamsTable's
metrics below the breakpoint`): a new `RECORD_COLUMN_WIDTH_NARROW_PX = 80`
(`teams-table/columns.tsx`), applied below `MOBILE_BREAKPOINT_PX` to both `InsightsTab`'s and
`TeamsTable`'s `record` column (Breakdown has no `record` column). `record`'s content
(`formatRecord`/`formatEventRecord`'s `{wins}-{losses}-{ties}`) renders through `numeric-cell`,
which carries `font-feature-settings: "tnum"` (tabular digits) — so its rendered width is a pure
function of CHARACTER COUNT, never the specific digits. Verified live against the app's real
compiled CSS/font: `"121-42-4"`, `"165-99-9"` and `"999-99-9"` (all 8 characters) render at the
identical 56.48px. Queried every published `teams/{year}/vpr@*.json` artifact 2022-2026
(3,100-3,757 teams/year): the real worst case is an 8-character `WWW-LL-T` string (e.g.
`"121-42-4"`, max wins observed across all five years: 165) — never 9+ characters in any published
season. 56.48px + `TableCell`'s 16px `p-2` padding + a 6px cross-browser font-hinting buffer (the
same margin `RANK_COLUMN_WIDTH_NARROW_PX` uses) rounds up to 80.

`InsightsTab.tsx` already places `record` immediately after `nickname` — only the width needed to
shrink. `TeamsTable`'s `buildColumns` puts the metric columns there instead (`record` normally
trails after them), so `record` is additionally REORDERED to sit right after `nickname` below the
breakpoint only — at/above the breakpoint the order is byte-for-byte unchanged (metrics, then
record, then win rate). `record` was never sortable either way (`sortableColumnIds` never lists
it), so this is a presentation-only reorder, not a behaviour change.

**Arithmetic, both widths:**

```
Insights  @360px (312 scroller): 56+72+90+80 = 298   -> 14px margin (was -6px)
Insights  @390px (342 scroller): 56+72+90+80 = 298   -> 44px margin (was 0px, now more headroom)
Teams     @360px (312 scroller): 56+72+90+80 = 298   -> 14px margin (was -26px)
Teams     @390px (342 scroller): 56+72+90+80 = 298   -> 44px margin (record now first; previously
                                                          a 120px metric column was first with 4px
                                                          margin — this trades "a real predictive
                                                          metric visible at 390px only" for "a
                                                          fully-visible column at both 360px and
                                                          390px, consistently, without ever risking
                                                          a metric value clipping")
```

At `phone-390`, TeamsTable no longer shows a real metric column at scroll 0 (it showed one before,
with only 4px of margin). This is a deliberate trade, not an oversight: `record` is real,
meaningful competitive data (not a placeholder), G-2's own original complaint was about ZERO data
being visible on first paint (not specifically an algorithmic metric), and a single `isNarrow`
boolean cannot special-case 390px differently from 360px without a second breakpoint (which this
gap's own instructions rule out). Both widths pass with identical, comfortable margin.

**Test evidence**: `apps/web/src/components/teams-table/columns.test.tsx` and
`apps/web/src/components/event/InsightsTab.test.tsx`'s existing suites (93 tests total across
`columns.test.tsx`/`TeamsTable.test.tsx`/`InsightsTab.test.tsx`/`BreakdownTab.test.tsx`) pass
unmodified — none asserted a specific column order beyond `columns[0]`/`columns[1]`
(rank/teamNumber), which this fix never touches. Full project `npx vitest run`: 2056 passed, 1
skipped, 2 failures — both the pre-accepted `payloadBudget.test.ts` ledger entries (#11, #15); no
new failures. `apps/web/tsc --noEmit`: clean.

Pending: deploy, then live re-verification of `table-layout-quality.spec.ts`'s "G-2 part 2" suite
against `https://sigmascout.org` for GREEN confirmation on `pixel-10` for Insights and TeamsTable
(Breakdown's own assertion already passes and is unaffected by this fix).

### G-12 — Search results turned the ribbon into a scrollable area instead of overlaying the page

severity: high
status: fixed, pending deploy + live re-verification
surfaces: `Ribbon.tsx` (both header sites), `__root.tsx`

Developer report: "the search bar is kinda broken. results turn the ribbon into a scrollable area
instead of flowing down into the page."

Root cause, confirmed by measurement: `Ribbon.tsx`'s `<header>` (both the mobile and desktop
branches) carried `overflow-x-hidden` with no authored `overflow-y`. Per the CSS Overflow spec, an
`overflow-x`/`overflow-y` pair where one side is non-`visible` and the other is left at its
`visible` default forces the `visible` side's USED value to `auto` — the header silently became a
Y-axis scroll container the instant `SearchBox`'s absolutely-positioned results list made the
header's content taller than the header itself. Instead of the dropdown overlaying the page below
the ribbon, the ribbon scrolled and the results were clipped to (and reachable only by scrolling)
the header's own box.

This is the SECOND time this exact CSS rule has bitten this codebase this phase — the 07-20 agent
hit it as a false positive in `assertNoIntermediateScroller` when `__root.tsx`'s own
`overflow-x-hidden` div was flagged as a scroller.

Measured live against the deployed site (desktop, 8 combined team/event results open):

```
header computed overflow-x: hidden   overflow-y: auto (never authored — the used value CSS forces)
header scrollHeight 433   clientHeight 78   headerScrolls: TRUE
```

**Fixed** (commit `fix(07): G-12 use overflow-x-clip on ribbon and root layout to stop vertical
scroll capture`): `overflow-x-hidden` replaced with `overflow-x-clip` on both of `Ribbon.tsx`'s
`<header>` sites. `clip` blocks horizontal overflow identically to `hidden` (`no-page-pan.spec.ts`,
the property this token exists to guard, is unaffected — confirmed by compiling the real Tailwind
CSS output: `.overflow-x-clip{overflow-x:clip}`) but does not force a scroll container onto the Y
axis, so the dropdown escapes the header and overlays the page normally.

`__root.tsx`'s root layout div carries the identical `overflow-x-hidden`-with-no-`overflow-y`
pattern. It has never scrolled in practice (`min-h-screen` keeps its content taller than the
viewport today), but that is incidental to page content length, not a property the element
guarantees, and this exact rule has now produced two real defects in this codebase — changed
proactively to `overflow-x-clip` as well, at no cost.

**Test evidence**: `apps/web/e2e/search-results-overflow.spec.ts` (new; `desktop` project, viewport
set per-test to 1440px and 390px). Proven RED against the currently-deployed origin pre-fix:
desktop measured `overflowY: "auto"`, `scrollHeight: 433` vs `clientHeight: 78` (matching this
gap's own reported shape almost exactly). The 390px case is a regression guard, not a second
reproduction — at that width `SearchBox` renders the 44x44 icon trigger and `CommandDialog`, whose
`DialogContent` renders through a Radix `Portal` straight to `document.body`, entirely outside the
header's DOM subtree — but the header's own computed `overflow-y` is still measurably `"auto"`
there too pre-fix (`scrollHeight`/`clientHeight` both 118, i.e. never actually overflowed, but the
CSS property itself was still wrong). Full project `npx vitest run`: 2056 passed, 1 skipped, 2
failures — both the pre-accepted `payloadBudget.test.ts` ledger entries (#11, #15); no new
failures. `apps/web/tsc --noEmit`: clean.

Pending: deploy, then live re-verification of `search-results-overflow.spec.ts` against
`https://sigmascout.org` for GREEN confirmation at both widths, plus a manual re-check that
`no-page-pan.spec.ts` stays green (unaffected by this change — `overflow-x-clip` blocks the same
horizontal overflow `overflow-x-hidden` did).

### G-13 — Metric History chart's Y-axis renders float-noise, clipped tick labels for extreme values

severity: high
status: fixed, pending deploy + live re-verification
surfaces: `MetricHistoryChart.tsx` (`<YAxis>`)

Developer report: "There is some kind of overflow problem on the Y axis of the metric history
tab." Reproduced on `https://sigmascout.org/team/4788?year=2026&algorithm=vpr` (Metric History
tab): the axis rendered labels reading `99999997` — the visible tail of clipped values like
`-1349.99999997` — alongside one readable `62.69`.

Two distinct defects, both in the shared `<YAxis>` element:

1. **No `tickFormatter`.** Recharts generates its own tick VALUES via floating-point interval
   arithmetic over the domain, which surfaces noise like `-1349.99999997` rather than the clean
   `-1350` a reader expects — this is a chart-library-generated tick, never a published datum
   (`packages/harness/rounding.ts`'s publish-time rounding rule governs published values only).
2. **No explicit `width`.** Recharts' 60px default clipped any label wider than that, and the
   `domain={["dataMin", "dataMax"]}` extremes this component already used made a wide label
   inevitable for any team whose total swings deeply negative.

Measured live against the deployed site (`frc4788`/2026/vpr, before this fix):

```
tick "-2126.0299999999997"   left -70.7px relative to the SVG's own left edge (clipped)
tick "-1576.0299999999997"   left -70.2px
tick "-1026.0299999999997"   left -71.3px
tick "-476.0299999999997"    left -65.9px
tick "62.69"                 left  27.2px  (the one readable label, matching the report exactly)
```

This is latent, not new: for a normal team (values roughly 0-400) labels are short and fit inside
the 60px default fine — confirmed live against `frc254`/2026/vpr, which already passes cleanly
(`116.9`, `186.9`, `256.9`, `326.9`, `379.03`, all unclipped, no noise). It only became visible
because `frc4788` publishes a deeply negative `total` (a separate, already-filed modelling defect —
`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md` — NOT fixed here; this fix only
makes the CHART render legibly whatever value it is handed).

**Fixed** (commit `fix(07): G-13 format Y-axis ticks and size axis width in metric history chart`):
`formatYAxisTick` rounds a tick to 2 decimals via `toFixed(2)` (correctly rounds the float-noise
case) then round-trips through `Number`/`toString` to strip trailing zeros (`-1350.00` ->
`-1350`). `computeYAxisWidth` derives the axis's `width` from the SAME set of Y-axis domain values
(chart-craft.md's "derive coupled geometry" rule) — the widest formatted label's character count
times a measured per-character estimate, floored at 48px — so the width and the formatter can
never disagree, and a typical short-label team gets a NARROWER axis than the old 60px default
(more room for the plot) while an extreme one gets wider. Only Recharts-generated tick display is
touched; the plotted `value`/`band` series and `packages/harness/rounding.ts`'s publish-time
rounding are unaffected — confirmed by all 9 pre-existing `MetricHistoryChart.test.tsx` assertions
passing unmodified.

**Test evidence**:
- Two new `MetricHistoryChart.test.tsx` unit tests (11 total, all passing): no rendered Y-axis tick
  exceeds 2 decimal places on an extreme negative domain mirroring `frc4788`'s own shape, and the
  Y axis widens for a wide extreme label / narrows for a short typical one (extreme computed 96px,
  normal computed 51px — both bounded by `computeYAxisWidth`'s own floor/character-width formula,
  never a fixed magic number).
- New `apps/web/e2e/metric-history-axis-legibility.spec.ts` (`desktop` project). Proven RED against
  the currently-deployed origin pre-fix on the extreme case with the exact live measurements above;
  the normal-team case already passes cleanly and serves as this fix's regression guard.
- Full project `npx vitest run`: 2058 passed, 1 skipped, 2 failures — both the pre-accepted
  `payloadBudget.test.ts` ledger entries (#11, #15); no new failures. `apps/web/tsc --noEmit`:
  clean.

Pending: deploy, then live re-verification of `metric-history-axis-legibility.spec.ts` against
`https://sigmascout.org` for GREEN confirmation on the extreme case (the normal-team case already
passes and is unaffected by this fix).
