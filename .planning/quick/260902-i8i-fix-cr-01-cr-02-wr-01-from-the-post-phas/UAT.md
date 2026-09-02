---
status: complete
phase: quick-260902-i8i
source: [.planning/quick/260902-i8i-fix-cr-01-cr-02-wr-01-from-the-post-phas/SUMMARY.md, .planning/reviews/260902-post-phase08-ungoverned-ui/REVIEW.md]
started: 2026-09-02T13:30:00Z
updated: 2026-09-02T13:47:00Z
test_origin: http://localhost:5280 (local vite dev, VITE_ARTIFACT_ORIGIN proxied to https://data.sigmascout.org)
deploy_state: NOT DEPLOYED — main is 53 commits ahead of origin/main (000b05e1); the live site does not carry these fixes
---

## Current Test

[testing complete]

## Tests

### A1. CR-01 crash path — podium hides instead of taking down the front door
expected: A schema-valid 200 compare artifact missing one algorithm's combined slice, and an algorithm pooling to zero scored matches, both render the page with no podium rather than a router error surface
result: pass
source: automated
coverage_id: CR-01
verification: apps/web/src/routes/index.test.tsx — "hides the podium instead of taking down the front door when a 200 artifact is missing one algorithm's combined slice"; "hides the podium when an algorithm pools to zero scored matches, the helper's other throw"

### A2. CR-02 role exposure — the aria-label is legal and reaches the a11y tree
expected: The boxed Combined Total is an accessible group whose name is the approximate-tier disclosure; an unboxed Combined Total exposes no group and no label
result: pass
source: automated
coverage_id: CR-02
verification: apps/web/src/components/event/AlliancesTab.test.tsx — "the approximate-tier disclosure carries a ROLE, so the aria-label is legal and actually exposed"; "an unboxed Combined Total exposes no group and no label"

### A3. WR-01 filter model — out-of-band weeks collapse to one Other bucket
expected: No numeric week option above the season bound; the three Israeli events land in "other"; the chip reads Other; a hand-edited ?week=16 never renders "Week 17"; other stays disjoint from week0/champs/offseason
result: pass
source: automated
coverage_id: WR-01
verification: apps/web/src/components/events-list/filterModel.test.ts + EventFilters.test.tsx — 10 tests incl. "the 'other' filter returns exactly the three real Israeli events, which 208 played matches depend on being reachable"

### 1. Home page renders with the podium (CR-01 regression)
expected: http://localhost:5280/ loads the front door — hero, search, three CTAs, and a three-step podium showing opr / epa / vpr with accuracy percentages
result: pass

### 2. Events page Week dropdown has no nonsense season weeks (WR-01, live data)
expected: On http://localhost:5280/events?year=2026 the Week dropdown lists real season weeks and ends with "Other" — no "Week 17", "Week 18" or "Week 19" anywhere in it
result: pass

### 3. The Other bucket reaches the three Israeli events (WR-01, live data)
expected: Selecting "Other" filters the list to exactly the three FIRST Israel events; the active-filter chip reads "Other"; the URL carries week=other and reloading keeps the filter
result: pass

### 4. Alliances approximate-tier disclosure is reachable (CR-02, visual)
expected: On the Alliances tab of an event, hovering a colour-boxed Combined Total shows the "Approximate tier…" explanation; the cell shows no visible ≈ glyph
result: pass
note: "User passed the disclosure itself and separately asked for the D-15 independence caveat beneath the table to be removed — a new copy decision, not a defect in this fix. Routed to its own quick task; see ## Follow-Ups."

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — all seven checks resolved clean]

## Follow-Ups

- test: 4
  request: "remove the D-15 independence caveat beneath the Alliances table"
  text: "Combined values assume each robot's performance is independent of its alliance partners. Real alliances are not fully independent, so the true uncertainty is likely larger than shown."
  kind: copy-change (not a defect — test 4 itself passed)
  touches:
    - apps/web/src/components/event/AlliancesTab.tsx (the pinned constant + its render, testid alliances-independence-caveat)
    - apps/web/src/components/event/AlliancesTab.test.tsx (two tests assert it word-for-word and assert document order against it)
    - the Copywriting Contract D-15 row that pins the wording
  routed_to: quick task
