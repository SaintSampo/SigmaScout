---
status: testing
phase: 07-event-pages
source: [07-20-SUMMARY.md]
started: 2026-08-30T01:29:13Z
updated: 2026-08-30T01:29:13Z
---

## Current Test

number: 1
name: Real-device touch scroll sign-off (tab strip / table region / page scroll arbitration)
expected: |
  On a real phone (ideally one iPhone, one Android — either alone is worth doing), open each of:

  - https://sigmascout.org/event/2023cur?tab=quals&algorithm=vpr (130 qualification rows)
  - https://sigmascout.org/event/2022mirr?tab=elims&algorithm=vpr (60 elimination rows)
  - https://sigmascout.org/event/2024new?tab=breakdown&algorithm=vpr (the app's widest table, 16 columns)

  On each page, check all six of the following:

  1. Drag horizontally across the table. Only the table should move. The page should not slide
     sideways and the tab strip above should stay exactly where it is.
  2. Drag horizontally across the tab strip. Only the strip should move; the table below should
     not shift, and the page should not slide.
  3. Drag vertically anywhere over the table. The page should scroll normally — the table should
     not swallow the gesture or feel like it is fighting you.
  4. Do a deliberately diagonal drag on the table. One axis should win cleanly.
  5. Scroll the table fully right, then release. Watch the momentum settle. On iOS especially,
     look for rubber-banding that leaks into the page, and for the pinned left column bleeding
     through.
  6. On the Breakdown tab, confirm the two pinned columns stay opaque and readable throughout.

  This is necessarily manual: every automated drag in 07-20's e2e suite (122/122 passing) is a
  synthesized Chromium CDP touch gesture, which is not proof of real iOS Safari's touch-action
  arbitration (06-RESEARCH.md Pitfall 6) — this is the one check that closes that gap.
awaiting: user response

## Tests

### 1. Real-device touch scroll sign-off
expected: |
  On a real phone, all six checks above pass on all three URLs: table drags move only the table,
  strip drags move only the strip, vertical drags scroll the page, diagonal drags resolve cleanly,
  momentum settles without rubber-banding leaking or pinned-column bleed-through, and Breakdown's
  two pinned columns stay opaque throughout.
result: [pending]

### 2. Plot density at high row counts (look-and-decide)
expected: |
  At https://sigmascout.org/event/2023cur?tab=quals&algorithm=vpr, at phone width, scroll through
  the full 130-row slate. Each match should still read as its own band-tick-dot group, not as one
  continuous vertical texture. Compare against a team page's ~40-row section, e.g.
  https://sigmascout.org/team/118?year=2024&algorithm=vpr — the row density the current plot
  geometry (matchAxis.ts) was originally argued for, before Phase 7 put up to 130 rows on one tab.

  Reference screenshots from the automated run (390px, an aid only — not the answer):
  - C:\Users\Jacob\Documents\GitHub\SigmaScout\apps\web\test-results\event-scroll-regions-E5-—--a7c22-ble-after-a-full-width-drag-phone-390\quals-2023cur-130-rows.png
  - C:\Users\Jacob\Documents\GitHub\SigmaScout\apps\web\test-results\event-scroll-regions-E5-—--d6d3e-ble-after-a-full-width-drag-phone-390\quals-2025flta-84-rows.png
  - C:\Users\Jacob\Documents\GitHub\SigmaScout\apps\web\test-results\event-scroll-regions-E6-—--4ad6e-ble-after-a-full-width-drag-phone-390\elims-2022mirr-60-rows.png
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
