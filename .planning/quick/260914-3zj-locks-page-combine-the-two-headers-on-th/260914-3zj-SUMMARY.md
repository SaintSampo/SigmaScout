---
quick_id: 260914-3zj
slug: locks-page-combine-the-two-headers-on-th
date: 2026-09-14
status: complete
commits: [f038ee18, b14a57e5, 27e1f896]
key-files:
  modified:
    - apps/web/src/components/districts/DistrictLocksTab.tsx
    - apps/web/src/components/districts/DistrictLocksTab.test.tsx
---

# Quick Task 260914-3zj: Locks page, one header card per tab, and the champ Lock Line republish

## What changed

### 1. One header card per tab (code)

Each Locks tab used to stack two cards: a shared "capacity + Lock Line" card, then a second one for
that tab (`DistrictScheduleStrip` or `ChampRemainingDistrictPoints`). Both are now one card built
by a new `LocksHeaderCard` component in `DistrictLocksTab.tsx`, with a single stat row that wraps
when narrow:

- District Locks: District Championship capacity, Lock Line, Pre-DCMP points remaining, District
  Points (Available/Total). The event chips sit below that row, inside the same card.
- Champ Locks: FIRST Championship capacity, Lock Line, Remaining district points.

All labels, number formats and testids are unchanged. The one new testid is
`{which}-locks-header-stat-row`. The champ header still shows the same stats. Changing what it
shows is sketch 013, which is still pending and was not touched.

Commits:

- `f038ee18`: a new test that fails first (each tab has exactly one header card, which holds every stat)
- `b14a57e5`: the merge
- `27e1f896`: doc comment update

### 2. Champ "Lock Line is low" (republish, no code)

The code fix had already landed in b186f81b (260913-l8q). That task's summary recorded
`pnpm publish:districts` as owed, and the live artifacts were still from 2026-09-07. From the main
context: ran a dry run for 2026, then `pnpm publish:districts` for every district-year in
2016-2020 and 2022-2026.

Checked live `v1/district/2026fnc.json` after the upload:

| Field | Value | Before |
|-------|-------|--------|
| computedAt | 2026-09-14T06:54:34Z | 2026-09-07 |
| cmpCutLinePoints | 231 | 172 |
| dcmpCutLinePoints | 76 | 75 |

No champ status contradicts the line: 8429 at 231 is locked, and 6500 at 216 is out of range.

## Verification

- `npx vitest run apps/web/src/components/districts`: 40/40 passed. The new tests failed against
  the two-card layout first, then passed.
- `npx tsc --noEmit -p apps/web/tsconfig.json`: 0 errors.
- `git show --stat` on each commit lists only the intended file.

## Not done

- Not pushed. The web change goes live on the next push to main.
- Not visually checked in a browser.
- Sketch 013's point that a divided DCMP's finals can award more than the modelled 249 (a ceiling
  that can be too low) is still open. This task did not address it.
