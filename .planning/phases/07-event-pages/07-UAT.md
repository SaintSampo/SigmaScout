---
status: testing
phase: 07-event-pages
source: [07-20-SUMMARY.md]
started: 2026-08-30T01:29:13Z
updated: 2026-08-30T02:40:00Z
---

## Current Test

number: 1
name: Real-device touch scroll sign-off (BLOCKED by layout defect — re-run after fix)
expected: |
  Blocked. A layout defect was found on a real phone before the six touch-arbitration checks
  could be assessed. See Gaps G-1 and G-2. Re-run this test once the fix lands.
awaiting: layout fix

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
status: failed
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

### G-2 — Pinned identity columns consume the entire mobile viewport

severity: high
status: failed
surfaces: InsightsTab (worst), BreakdownTab, TeamsTable

Rank (72) + Team # (88) + Nickname (220) = 380px pinned on a 390px screen. Even with G-1 fixed,
the first viewport of a match-PREDICTION site contains no prediction: not one metric column is
reachable without horizontal scrolling, and nothing signals that more columns exist. The
percentile tier key renders above a table in which no tiered value is visible.

This is a design defect, not a CSS bug — G-1's fix does not address it. Pinning exists to keep
row identity visible while scrolling data horizontally; that needs one identifier, and the team
number is the canonical one in FRC. Rank is implicit in row order on a rank-ordered table.
Nickname alone is 56% of the viewport and is already truncated.

### G-3 — 122 passing e2e tests did not catch either defect

severity: medium
status: failed
surfaces: apps/web/e2e/

07-20's suite asserts scroll ARBITRATION ("only the table moved", "the strip did not shift") and
never asserts layout QUALITY. A table can be fully broken — wrong widths, visible gaps, no data
on screen — and still pass all 122 assertions. This is why the defect reached a human tester.

Any fix must add an assertion that bites on this class: declared-vs-actual column width, and a
bound on pinned width as a fraction of the viewport.
