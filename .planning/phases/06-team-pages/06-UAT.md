---
status: testing
phase: 06-team-pages
source: [06-VERIFICATION.md]
started: 2026-08-25T20:20:00Z
updated: 2026-08-26T01:05:00Z
---

## Current Test

number: 2
name: Real-device iOS Safari touch-gesture check
expected: |
  On a real iPhone in Safari, dragging horizontally inside a match table scrolls only that table,
  the page does not pan sideways, and vertical/diagonal drags behave correctly.
awaiting: user response

## Tests

### 1. Push and deploy, then re-run the four deployed-origin e2e specs
expected: After pushing local `main` to `origin/main` and letting Cloudflare Pages redeploy, re-run `pnpm --filter web test:e2e -- team-page`, `-- no-page-pan`, `-- touch-scroll`, and `-- static-shell`. All four pass against the real deployed build.
result: issue
reported: "Deployed 14001324 to Cloudflare Pages and ran the suite against the live apex. team-page (2/2) and static-shell (2/2) pass. no-page-pan:84 and touch-scroll:197 fail on BOTH iphone-17 and pixel-10 — the team page's per-event-section match tables cannot scroll horizontally on a phone, leaving most of each table unreachable."
severity: major

deploy_correction: |
  The premise of this test was wrong. There is NO git-integrated deploy for sigmascout.org:
  pushing to origin/main does not redeploy it. `.github/workflows/deploy.yml` is a leftover v2
  workflow targeting GitHub Pages that dies in 13s at setup-node ("Dependencies lock file is not
  found ... package-lock.json") and has never reached its build step. The only deploy path is the
  manual `pnpm --filter web run deploy` (`wrangler pages deploy dist --project-name
  sigmascout-web`), which was run here to unblock the test.

harness_note: |
  `pnpm --filter web test:e2e -- <spec>` does NOT filter — pnpm forwards `--` as a literal
  argv entry (`playwright test "--" "team-page"`) and Playwright then runs the whole suite. All
  four commands in this test's text are therefore the same command. Use
  `pnpm --filter web exec playwright test <spec>` to filter. Full-suite result: 36 passed, 4 failed.

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
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- gap_id: G-06-1
  truth: "All four deployed-origin e2e specs pass against the real deployed build"
  status: failed
  reason: "User reported: no-page-pan:84 and touch-scroll:197 fail on both iphone-17 and pixel-10 — per-event-section match tables cannot scroll horizontally on a phone"
  severity: major
  test: 1
  root_cause: "apps/web/src/routes/team.$teamNumber.tsx:151 — the overview TabsContent is a flex item of the Tabs root (`flex gap-2`) but omits `min-w-0`, so its computed min-width stays `auto`. It therefore refuses to shrink below its content's intrinsic width and lays out at 955px inside a 354px flex line. Every descendant in the chain (event-card section, both flex-col wrappers, the match-table-scroll div) correctly carries `min-w-0`; this one link does not, so the whole subtree sizes to content. The scroller ends up 905px wide with a 905px table, making scrollWidth === clientWidth — no overflow, therefore nothing to scroll, therefore scrollLeft stays 0 under a drag."
  measured: "iPhone 17 viewport 402px. All 8 match-table-scroll-* elements: scrollWidth 905 === clientWidth 905, overflow-x auto, touch-action pan-x. Ancestor Tabs root: clientWidth 354, scrollWidth 1162."
  user_impact: "On a phone the match tables render ~905px wide inside a 354px column and cannot be panned (the document itself correctly does not overflow), so roughly 60% of every match table's columns are permanently unreachable."
  artifacts:
    - path: "apps/web/src/routes/team.$teamNumber.tsx"
      issue: "TabsContent (line 151, and the sibling history panel at line 153) missing `min-w-0`"
  missing:
    - "Add `min-w-0` to the overview TabsContent className, and to the history TabsContent for the same reason"
  debug_session: ""
