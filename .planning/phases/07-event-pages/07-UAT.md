---
status: testing
phase: 07-event-pages
source: [07-20-SUMMARY.md]
started: 2026-08-30T01:29:13Z
updated: 2026-08-31T00:30:00Z
---

## Current Test

number: 1
name: Real-device touch scroll sign-off (BLOCKED by layout defect — re-run after fix)
expected: |
  Blocked. A layout defect was found on a real phone before the six touch-arbitration checks
  could be assessed. See Gaps G-1 and G-2. Re-run this test once the fix lands.
awaiting: |
  G-1/G-2/G-3 code fixes are committed (see Gaps section below) and verified locally against a
  fixture-backed dev server — data.sigmascout.org's R2 CORS policy excludes localhost, so a real
  device/deployed-origin re-run was not possible from this session. Awaiting `wrangler deploy`
  (blocked for subagents) and a live re-measurement + the original six touch-arbitration checks,
  both on the deployed origin.

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
