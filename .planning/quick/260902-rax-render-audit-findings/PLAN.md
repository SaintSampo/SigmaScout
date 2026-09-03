---
quick_id: 260902-rax
slug: render-audit-findings
date: 2026-09-02
type: execute
mode: quick
worktree: false
autonomous: false
source: render-and-measure audit of 2026-09-02 (11 pages x 2 viewports)
files_modified:
  - apps/web/src/components/teams-table/columns.tsx
  - apps/web/src/components/events-list/EventsList.tsx
---

# Two defects from the render audit

A render-and-measure sweep over 11 pages at desktop (1440) and phone (390)
found the five fixes shipped earlier today all holding — zero doubled-box,
missing-focus-ring, hover-shift, page-overflow or console-error findings
anywhere. Two real defects surfaced, both below.

Findings deliberately NOT actioned, so they are not re-raised: `axis-ticks`
overflowing its own 470px box (absorbed by a 511px `overflow: visible` parent —
nothing visibly clips); event-name and nickname ellipsis (deliberate table
truncation); the phone algorithm selector clipping to `VPR` (reads cleanly
today, but is accidental clipping rather than a designed short label — a latent
risk of cutting mid-token at other widths, worth a todo, not a fix here).

## Task 1 — the phone rank header says nothing

Measured on a 390px viewport: `[data-testid="teams-header-rank"]` renders
**`VPR …`** — 78px of text in a 56px column. "RANK" is ellipsized away entirely,
on the one column the whole table is ordered by.

**This sits between two recorded decisions — read both before editing.**

- **G-2** (`columns.tsx:318-325`): below the breakpoint the column tightens to
  `RANK_COLUMN_WIDTH_NARROW_PX` (56), and the comment explicitly accepts that
  "the header may ellipsis-truncate there … an accepted narrow-mode trade for
  two extra metric columns' worth of width".
- **D-20** (`columns.tsx:311-317`): the label is derived from
  `algorithmDisplayLabel` at render time, never a literal, so that a
  wrong-provenance claim — naming an algorithm that did not produce the
  ordering — is "structurally unreachable". A bare `Rank` is what D-20 fixed.

What the G-2 trade did not anticipate is **which half** the truncation eats.
`VPR Rank` at 56px keeps `VPR` — already displayed in the ribbon's algorithm
selector — and cuts `Rank`, the only informative half.

**Resolution (user decision, 2026-09-02): keep the narrow width, show `Rank`,
keep provenance reachable.**

- In narrow mode only, the **visible** header text becomes `Rank`.
- The full `${algorithmDisplayLabel(algorithm)} Rank` string must remain
  available to hover and assistive tech via `title` **and** `aria-label` on an
  element that legally accepts a name.
  **Read the CR-02 lesson first** (`.planning/quick/260902-i8i-.../SUMMARY.md`):
  `aria-label` is ignored on a bare `<span>`'s implicit `role="generic"`, so the
  carrier needs a real role — the `<th>` itself already has one
  (`columnheader`), which is the natural home. Do NOT reintroduce the bare-span
  bug that quick task just fixed.
- Wide mode is unchanged: full `VPR Rank` visible, no title needed.
- Do NOT change `RANK_COLUMN_WIDTH_NARROW_PX`. G-2's width stands.
- Update the G-2/D-20 comment block to record how the tension resolved and why —
  a future reader must not "simplify" the visible label back to the full string
  (re-breaking it) or drop the accessible name (re-breaking D-20).

## Task 2 — the Events sort buttons have a 14px hit area

Measured on the Events page: the column-header sort buttons render at ~40×14
(`Event` 40×14, `Type` 32×14, `Date` 47×14, `Teams` 43×14, `Matches` 59×14).
This project's own convention is `.tap-target { min-width: 44px; min-height: 44px }`
(`theme.css:395`), which these do not meet.

`EventsList.tsx:95-102` renders a bare
`<button className="flex items-center gap-[var(--spacing-xs)]">` inside a
`TableHead`. The button hugs its text, so only the glyphs are clickable while
the rest of the header cell — which looks equally clickable — is dead.

- Expand the button's hit area to fill its header cell so the whole cell is the
  target, rather than only setting a `min-height` that leaves dead space beside
  the label.
- Do not change the visual appearance of the header row: same type, same
  alignment, same spacing. This is a hit-area fix, not a restyle. Verify the
  header row's rendered height and the label positions are unchanged before and
  after.
- Numeric columns are right-aligned (`column.numeric`); the expanded target must
  respect that alignment rather than forcing every label left.

## Verification

1. `cd apps/web && npx vitest run` — full suite green. Never `timeout <n> pnpm ...`
   (swallows output, exits 0 — project memory).
2. `cd apps/web && npx tsc --noEmit -p tsconfig.json`.
3. Probe the running dev server at `http://localhost:5280` (ALREADY RUNNING — do
   not start another):
   - At 390px: `[data-testid="teams-header-rank"]` has `scrollWidth <= clientWidth`
     (no truncation) and its accessible name still contains the algorithm label.
   - At 1440px: the same header still reads the full `VPR Rank`.
   - On `/events?year=2026`: every sort button's rendered box is >= 44px tall,
     and the header row's total height and label x-positions are unchanged from
     before the fix.
4. Add a regression test for each task. The narrow-mode header one is the
   important one — it must assert the VISIBLE text and the ACCESSIBLE NAME
   separately, since the whole point is that they differ.

## Commits

One commit per task.
