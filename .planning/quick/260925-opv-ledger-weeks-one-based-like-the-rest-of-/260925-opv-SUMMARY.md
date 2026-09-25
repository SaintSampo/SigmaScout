---
id: 260925-opv
slug: ledger-weeks-one-based-like-the-rest-of-
kind: quick
status: complete
completed: 2026-09-25
subsystem: apps/web
key-files:
  modified:
    - apps/web/src/components/districts/districtTimeline.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
decisions:
  - "Week labels are display only: chip ids stay `week-<raw>` so every shared URL and the timeline resolver are untouched."
  - "The slider commits once, 160 ms after the last input, with replace navigation; jump chips still commit immediately. The readout follows the committed URL position, the thumb follows the hand."
owed:
  - "Live check after deploy: a drag must leave history.length unchanged and the readout must settle on the dragged position."
---

# Quick task 260925-opv: one based weeks, a slider that follows the hand

Chips now read "After week 1" to "After week 4" on FNC 2026 (weeks 0 to 3 in TBA's numbering),
tick labels and event cells likewise. The slider keeps a local thumb while dragging and commits a
single replace navigation after the hand pauses. 186 district tests green, web typecheck clean.
