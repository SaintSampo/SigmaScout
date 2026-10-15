---
phase: quick-261015-s1t
plan: 01
subsystem: districts / Locks tab strip
tags: [locks, tabs, ui]
status: complete
requires: []
provides: [locksTabSlotsText]
key-files:
  modified:
    - apps/web/src/routes/districts.tsx
    - apps/web/src/routes/districts.test.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
decisions:
  - "Prototype 01 of the five Locks tab prototypes (artifact https://claude.ai/artifact/6Y8SHfRcC8hhJ6n8fM8brG), chosen by Jacob, made as wide as the table."
  - "The tab matches the table (Jacob, follow up fdc3f12d). The mounted ledger reports the Locked count its chips print through onLockedCount, so the open tab reads exactly what its table reads, rewinds included. The unmounted tab reads the artifact alone: the district tier applies the same championship field rule the table applies at Live (championshipFieldLockedCount), otherwise the published verdicts (locked and lockedAward hold a slot; prequalified never does)."
  - "A Locked count above the published capacity prints as a bare 'N locked' (2026 FIM seated 161 teams for 160 slots), never 'N of M'."
  - "Why uncalled slots exist at season end: every one is a tie at the cut line. locks.ts carries no tiebreaker, so a tied team is neither Locked nor Locked out on the published verdicts; the field view resolves it from who actually played."
  - "data-[state=active] replaces the primitive's data-active: variants on this strip. Radix never sets a data-active attribute, so those classes match nothing on the built page. The other pages' line tabs still carry them and are out of this task's scope."
metrics:
  completed: 2026-10-15
actuals:
  tasks: 1
  commits: 1
---

# Quick 261015-s1t: Locks tabs as a full width segmented switch with slot counts

The District Locks and Champ Locks tab strip on the Locks page is now a full width
segmented switch. The open tab is a white segment on the inset rail. Each tab carries
its tier's count, for example "159 of 160 slots called", or "N locked" when the
capacity is unpublished. On a phone the count wraps under the label and both segments
stand the same height.

Verified on a local preview build at 1280 and 390 wide against the live 2026 FIM
artifact, and by the route tests (two new count tests) and the copy test.
