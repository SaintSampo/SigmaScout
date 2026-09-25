---
id: 260925-opv
slug: ledger-weeks-one-based-like-the-rest-of-
kind: quick
mode: inline
created: 2026-09-25
description: "Ledger weeks one based like the rest of the site, and a slider that does not fight the hand: local thumb, debounced replace navigation, no history spam"
files_modified:
  - apps/web/src/components/districts/districtTimeline.ts
  - apps/web/src/components/districts/DistrictLedger.tsx
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
  - apps/web/src/components/districts/DistrictLedger.test.tsx
autonomous: true
---

# Quick task 260925-opv: one based weeks, and a slider that follows the hand

Jacob, 2026-09-25: "the weeks chips still seem wrong. there are not enough?" and "the slider is
glitchy". FNC 2026 showed chips only "up to week 3": TBA weeks are zero indexed and this tab
printed them raw, while every other page prints `Week ${week + 1}` (EventHeader, the events
list). So FNC's four district weeks read 0 to 3 instead of 1 to 4. Fix: chips, tick labels and
the event cell print week + 1; chip ids and shared URLs keep the raw week.

The slider navigated on every input event: one history entry per step, a simulation re-run per
step, and a controlled value that fought the pointer when a render landed mid-drag (the timeline
refines from 33 to 549 steps once the rewind loads the artifacts). Fix: the thumb is local state
while a hand is on it, one commit fires 160 ms after the hand pauses, and the commit navigates
with `replace` so a drag is one gesture in history.

Executed inline.
