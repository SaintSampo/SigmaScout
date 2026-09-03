---
quick_id: 260902-rax
slug: render-audit-findings
date: 2026-09-02
status: complete
tasks_completed: 2
source: render-and-measure audit of 2026-09-02 (11 pages x 2 viewports)
---

# Summary — the two defects the render audit found

## Commits

| SHA | What a user would have seen |
|---|---|
| `389d0644` | On a 390px phone the Teams table's leading, order-defining column header read **"VPR …"** — "Rank" ellipsized clean away, on the one column the whole table sorts by. Now it reads "Rank", with "VPR Rank" still reachable on hover and to a screen reader. |
| `c2c72fbd` | The Events page's sort controls had a real clickable box of ~40×14 hugging the label text, while the rest of the header cell looked equally clickable and did nothing. Now the whole cell sorts. |
| `864d9624` | **Regression fix for `c2c72fbd`.** That commit's hit-area overlay hung 8px past the header cell and onto the first result row: clicking the top 7px of row 1 sorted the table instead of opening the event. |

## Task 1 — a conflict between two recorded decisions, not an oversight

The truncation was **deliberate**: G-2 (`columns.tsx`) tightens the rank column
to 56px on narrow and explicitly accepts that the header "may ellipsis-truncate
there … an accepted narrow-mode trade for two extra metric columns' worth of
width". D-20 separately requires the label be derived from
`algorithmDisplayLabel`, never a literal, so a wrong-provenance claim is
structurally unreachable.

What G-2 did not anticipate is **which half** the truncation eats. `VPR Rank`
at 56px keeps "VPR" — already displayed in the ribbon's algorithm selector two
inches above — and drops "Rank", the only informative word.

Resolved on the user's decision (2026-09-02) without reversing either: narrow
mode shows `Rank` visibly, and the full `VPR Rank` rides the `<th>`'s
`aria-label`/`title`. The `<th>` was chosen as the carrier because it already
has an implicit `columnheader` role — `aria-label` is dropped on a bare
`<span>`'s `role="generic"`, which is precisely the CR-02 bug quick task
`260902-i8i` had just fixed. `rankColumnAccessibleLabel` is now the single
place the string is derived, so the wide-mode visible text and the narrow-mode
accessible name cannot drift apart.

Verified live: narrow reports `scrollWidth === clientWidth` (56 === 56, no
truncation) with visible text `Rank` and accessible name `VPR Rank`; wide is
untouched at `VPR Rank`. Confirmed through a real
`getByRole("columnheader", { name: /VPR Rank/ })` query rather than by
asserting an attribute exists.

## Task 2 — the hit-area fix, and the regression it shipped

The visible sort `<button>` hugged its text (~40×14) inside a much larger
header cell. `c2c72fbd` added a second, invisible, absolutely-positioned button
(`aria-hidden`, `tabIndex={-1}`) to catch pointer input across the cell, leaving
the visible button untouched.

**That commit then bought its 44px by growing the overlay past its own cell**
(`-bottom-2`), specifically so the header row's height would not change. The
overhang landed on the first body row. Measured after the fact by the
orchestrator: overlay bottom 229 against first-row top 222, and clicks at 2px
and 4px into row 1 fired `onSortChange` instead of opening the event, while 8px
and beyond behaved.

The original verification **observed this exact behaviour and recorded it as
success** — "a click 3px below the visible cell still fires onSortChange" — an
assertion that the overhang was live, written without asking what else occupies
that space. A hit-area extension is only correct if nothing else wants those
pixels; that question was never posed.

`864d9624` makes the overlay `inset-0` (exactly its cell) and gives the header
row `h-11`, so the cell is 44px on its own. Growing the row 4px is the honest
price for the target. Verified: overlay bottom 225 == first-row top 225 (no
overlap), clicks at 2/4/8/18px into row 1 all open the event, cell height 44px,
label offset 8px and all seven column widths unchanged.

Also worth recording from that task: a first attempt made the *visible* button
absolute, which removed the header text from the browser's auto-layout content
measurement (this table has no `table-layout: fixed`) and visibly narrowed the
TEAMS column. Self-corrected before commit.

## What the audit found overall

11 pages × 2 viewports, seven checks. **Zero** findings for doubled-box,
missing-focus-ring, hover-shift, page-overflow or console errors — the five
defect classes fixed earlier the same day are clear site-wide.

Triaged and deliberately not actioned, so they are not re-raised:

- `axis-ticks` overflowing its own 470px box on three pages — absorbed by a
  511px `overflow: visible` parent; nothing visibly clips. False positive.
- Event-name and nickname ellipsis (52 + 13 instances) — deliberate table
  truncation, working as designed.
- The phone algorithm selector clipping `VPR 2.1.0+tuned-2026-08` to `VPR` —
  reads cleanly today, but it is *accidental* clipping rather than a designed
  short label, so another width could cut mid-token (`VPR 2.1.0+tun`). Latent;
  worth a todo, not a fix.
- ~220 "small tap target" hits were mostly table-row links whose 21px text sits
  inside a much taller clickable row. The check was too blunt.

The audit harness was run from a temp directory and deliberately **not**
committed (user decision).

## Verification

`apps/web` suite green (77 files / 1188 tests) and `tsc --noEmit` clean after
all three commits. Every geometric claim above was re-measured by the
orchestrator against the running dev server rather than taken from the
executor's report — which is how the `c2c72fbd` regression was caught.
