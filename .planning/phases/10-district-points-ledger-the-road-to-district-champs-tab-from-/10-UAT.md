---
status: testing
phase: 10-district-points-ledger
source: [10-VERIFICATION.md]
started: 2026-09-25T16:20:00.000Z
updated: 2026-09-25T16:20:00.000Z
---

## Current Test

number: 1
name: Reduced motion, the drawer opens without animation
expected: |
  With the OS "reduce motion" setting ON, open https://sigmascout.org/districts (Pacific Northwest, Road to District Champs), click any blue cell: the drawer appears at once with no slide or fade. With the setting OFF the drawer animates in. Both directions matter, because the committed test only checks that the animation class is withheld under a stubbed media query.
awaiting: user response

## Tests

### 1. Reduced motion, the drawer opens without animation
expected: Reduce motion ON: the drawer under the team appears instantly on click. Reduce motion OFF: it animates in. (UI-SPEC backstop row; `DistrictLedger.tsx` withholds `district-ledger-drawer--animated`, `theme.css` carries the `prefers-reduced-motion` override.)
result: [pending]

### 2. First live district weekend, the Worker refresh fires in production
expected: During the first district event weekend, `wrangler tail sigmascout-worker --format json` shows `districtsConsidered` above 0 and at least one `district-refreshed` line for the live district; on the district page a finished category (quals, selection, playoffs, awards) turns grey with TBA's points within a few minutes, and the tab's blue cells re-run after the 60 s refetch. Every observed tick since the deploy has `districtsConsidered` 0 because no district event is live in late September; the manifest carrying `districtKey` on all 52 windows is eligibility, not evidence.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
