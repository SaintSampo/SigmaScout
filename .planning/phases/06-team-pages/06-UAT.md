---
status: testing
phase: 06-team-pages
source: [06-VERIFICATION.md]
started: 2026-08-25T20:20:00Z
updated: 2026-08-25T20:20:00Z
---

## Current Test

number: 1
name: Push and deploy, then re-run the four deployed-origin e2e specs
expected: |
  All four specs (team-page, no-page-pan, touch-scroll, static-shell) pass against the real
  deployed build carrying Phase 6's route, match tables, and static shell.
awaiting: user response

## Tests

### 1. Push and deploy, then re-run the four deployed-origin e2e specs
expected: After pushing local `main` to `origin/main` and letting Cloudflare Pages redeploy, re-run `pnpm --filter web test:e2e -- team-page`, `-- no-page-pan`, `-- touch-scroll`, and `-- static-shell`. All four pass against the real deployed build.
result: [pending]

note: |
  Blocking cause, confirmed independently during verification: local `main` (`5c8af78c`) is 125
  commits ahead of `origin/main` (still `79ca50be`, the Phase 5 HEAD), and a live fetch of
  https://sigmascout.org/ returns the OLD empty-`#root` index.html with no static-shell markup.
  `apps/web/playwright.config.ts` has no local `webServer` and targets the deployed origin
  exclusively, because R2 CORS does not allow-list localhost. These specs structurally cannot pass
  until this code ships. This is a deploy gap, not a code defect.

  Do this test FIRST — tests 2 and 3 are easier once the code is live.

### 2. Real-device iOS Safari touch-gesture check
expected: On a real iPhone in Safari, open a team page with >=2 event sections (e.g. frc118/2024). Dragging horizontally inside the first event's match table scrolls only that table — the page must not pan sideways. Repeat in the second section: same result, and the first section must not move. Dragging vertically over a match table scrolls the page normally. Dragging diagonally must not stick to the wrong axis.
result: [pending]

note: |
  This is the phase's own named highest-risk item (D-10). The defect it guards against already
  shipped once and was caught at real-device sign-off — not by any spec. 06-RESEARCH.md Pitfall 6
  documents historical iOS Safari gaps for directional `touch-action` inside a different-axis outer
  scroller. A passing Chromium/CDP test is NOT evidence of real-device behavior. No iOS device was
  available during execution.

### 3. UI polish visual sign-off
expected: Viewing the before/after screenshots in `.planning/phases/06-team-pages/screenshots/` (or the live polished page) at desktop and phone widths, the team page reads as a serious data tool that is more alive than Phase 5's — event sections as distinct objects, match rows grouping correctly via the zebra tint — without the colour going decorative.
result: [pending]

note: |
  06-09-PLAN.md's own must-have states this is judged by looking, not by a token diff. The
  mechanical gates all pass (additive-only theme.css diff, zero hex literals in components,
  elevation/tint component tests), but the qualitative call is deferred to you by the plan's text.
  This is also where your Phase 5 sign-off note ("too minimal, needs a little colour") gets its
  answer — the plan scoped in only the depth that stays inside the existing palette.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
