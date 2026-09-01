---
status: testing
phase: 08-simulation-compare
source: [08-VERIFICATION.md]
started: 2026-09-01T02:43:59Z
updated: 2026-09-01T02:43:59Z
---

## Current Test

number: 1
name: Bounded picker touch behavior — /event/2022oncmp?algorithm=vpr&tab=simulation, 134-row picker in a ~320px panel, on a real iPhone and a real Android
expected: |
  Page scrolls normally from outside the panel; the list scrolls internally while the page stays
  put from inside it; clean boundary behavior at the list's bottom (no jump, no rubber-band leak,
  no self-bounce); flick momentum doesn't fight tapping; a row two-thirds down selects cleanly on
  first tap.
awaiting: user response

## Tests

### 1. Bounded picker touch behavior — /event/2022oncmp?algorithm=vpr&tab=simulation (134-row picker, ~320px panel)
expected: Page scrolls normally from outside the panel; the list scrolls internally while the page stays put from inside it; clean boundary behavior at the list's bottom (no jump, no rubber-band leak, no self-bounce); flick momentum doesn't fight tapping; a row two-thirds down selects cleanly on first tap.
why_human: Automated evidence is synthesized CDP touch input in desktop Chromium wearing a phone viewport — not proof of real-hardware touch/momentum/rubber-band behavior.
result: [pending]

### 2. 78-row density and readability — /event/2023cur?algorithm=vpr&tab=simulation (pick first match, Run, scroll all 78 rows)
expected: Each row reads as its own distribution; a two-humped (bimodal) row is either found or its absence is reported as a finding; sideways drag keeps the pinned Team#/Nickname columns opaque; no ± glyph appears anywhere in the band-label column.
why_human: Visual/density judgment on real glass, not measurable by CDP dispatch alone.
result: [pending]

### 3. Felt responsiveness during a run — press Run, immediately try to scroll while the progress bar fills
expected: The page keeps scrolling smoothly; no hitch, freeze, or stall while the Worker runs.
why_human: SC-2's "without blocking the page" is architecturally true (Web Worker off main thread) and measured in desktop Chromium, but felt responsiveness under real touch during a live run is unconfirmed on real hardware.
result: [pending]

### 4. Six-tab strip at phone width — any event page
expected: Drag moves only the strip; Simulation is reachable at the right end; no label wraps to a second line; switching algorithm to OPR makes Simulation go visibly dead with no explanation (deliberate, D-04) and reads as intentional rather than broken.
why_human: Automated coverage proves this in CDP-emulated Chromium; real-device drag/inertia feel is unconfirmed.
result: [pending]

### 5. Compare page at phone width — /compare
expected: Accuracy table pans without moving the page; switching Combined/Qualification/Elimination causes no sideways jump; calibration chart axis labels are readable, series distinguishable, smallest dots still visible.
why_human: Same synthesized-touch limitation; visual legibility judgment on real glass.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Notes

How to run: from `apps/web`, `pnpm build && pnpm preview`, then open the machine's LAN address
(not `localhost`) from the phone. Do NOT substitute desktop device-emulation mode.
Screenshots from the automated runs are under `apps/web/test-results/` — an aid for remembering
what to look at, never the answer.

## Gaps
