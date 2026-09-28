---
status: testing
phase: 10-district-points-ledger
source: [10-VERIFICATION.md]
started: 2026-09-25T16:20:00.000Z
updated: 2026-09-28T04:00:00.000Z
---

## Current Test

number: 2
name: First live district weekend, the Worker refresh fires in production
expected: |
  See test 2 below. Not observable until the first 2027 district event weekend.
awaiting: 2027 district season

## Tests

### 1. Reduced motion, the drawer opens without animation
expected: Reduce motion ON: the drawer under the team appears instantly on click. Reduce motion OFF: it animates in. (UI-SPEC backstop row; `DistrictLedger.tsx` withholds `district-ledger-drawer--animated`, `theme.css` carries the `prefers-reduced-motion` override.)
result: pass (resolved by removal)
reported: "2026-09-28 Playwright on sigmascout.org, PNW at season-start: reduce ON had no animation class and opacity 1 from the first frame (pass). Reduce OFF had the class and its 120 ms opacity transition, but opacity was also 1 from the first frame, because nothing started the drawer at 0, so no fade ever played. Jacob chose to drop the animation: the class, its CSS, prefersReducedMotion and its stub test were removed from both Locks tabs, so the drawer always appears instantly and there is no motion to reduce." 

### 2. First live district weekend, the Worker refresh fires in production
expected: During the first district event weekend, `wrangler tail sigmascout-worker --format json` shows `districtsConsidered` above 0 and at least one `district-refreshed` line for the live district; on the district page a finished category (quals, selection, playoffs, awards) turns grey with TBA's points within a few minutes, and the tab's blue cells re-run after the 60 s refetch. Every observed tick since the deploy has `districtsConsidered` 0 because no district event is live in late September; the manifest carrying `districtKey` on all 52 windows is eligibility, not evidence.
result: [pending]

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
