---
status: partial
phase: 06-team-pages
source: [06-VERIFICATION.md]
started: 2026-08-25T20:20:00Z
updated: 2026-08-26T01:45:00Z
---

## Current Test

[testing complete — 2 issues, 1 blocked]

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
result: blocked
blocked_by: physical-device
reason: "I dont even have an iphone"

blocked_detail: |
  Not a scheduling problem — the hardware is not available to this project at all, so this check
  cannot be discharged by re-running it later. D-10's real-device question therefore stays OPEN
  for Phase 6 and must be carried forward rather than silently closed.

  Two consequences worth stating plainly:
  1. The Chromium/CDP specs (touch-scroll.spec.ts) drive Playwright's touch dispatcher, NOT WebKit
     gesture arbitration. 06-RESEARCH.md Pitfall 6 documents historical iOS Safari gaps for a
     directional `touch-action` inside a different-axis outer scroller. A green suite is not
     evidence about iOS, and no amount of re-running it becomes evidence.
  2. Any future iOS regression here will land unobserved. If real-device coverage matters for
     D-10, it needs a route that does not depend on owning the hardware — a borrowed device, a
     hosted real-device lab, or an explicit accepted-risk decision recorded in the roadmap.

  Options if this needs closing later: BrowserStack/Sauce Labs real-device session, an iPad or
  borrowed iPhone (same WebKit gesture engine), or recording it as accepted risk.

note: |
  This is the phase's own named highest-risk item (D-10). The defect it guards against already
  shipped once and was caught at real-device sign-off — not by any spec. 06-RESEARCH.md Pitfall 6
  documents historical iOS Safari gaps for directional `touch-action` inside a different-axis outer
  scroller. A passing Chromium/CDP test is NOT evidence of real-device behavior. No iOS device was
  available during execution.

### 3. UI polish visual sign-off
expected: Viewing the before/after screenshots in `.planning/phases/06-team-pages/screenshots/` (or the live polished page) at desktop and phone widths, the team page reads as a serious data tool that is more alive than Phase 5's — event sections as distinct objects, match rows grouping correctly via the zebra tint — without the colour going decorative.
result: issue
reported: "the actual page contect is decent. But the spacing is terrible. things are uncentered, overflowing, bad spacing, the worse. on mobile half the page is not accessible."
severity: major

verdict_split: |
  The colour/depth half of this plan's must-have PASSES on the user's own read ("the actual page
  content is decent") — event cards, zebra tint and alliance chips all land, and the colour did
  not go decorative. The LAYOUT half fails: spacing, centring and overflow were never part of what
  06-09 measured, and no mechanical gate in this phase looks at them.

note: |
  06-09-PLAN.md's own must-have states this is judged by looking, not by a token diff. The
  mechanical gates all pass (additive-only theme.css diff, zero hex literals in components,
  elevation/tint component tests), but the qualitative call is deferred to you by the plan's text.
  This is also where your Phase 5 sign-off note ("too minimal, needs a little colour") gets its
  answer — the plan scoped in only the depth that stays inside the existing palette.

## Summary

total: 3
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 1

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

- gap_id: G-06-2
  truth: "The team page's layout reads as considered at desktop and phone widths"
  status: failed
  reason: "User reported: spacing is terrible, things are uncentered, overflowing, bad spacing; on mobile half the page is not accessible"
  severity: major
  test: 3
  root_cause: "Not yet diagnosed as a single cause — this is a layout-quality gap, not one defect. The mobile inaccessibility is G-06-1 (min-w-0). The desktop spacing/centring/overflow complaints are separate and were never measured by any gate in this phase: 06-09's must-have was scoped to colour and depth (elevation/tint component tests, additive-only theme.css diff, zero hex literals), so spacing and alignment had no acceptance criterion at all."
  artifacts:
    - path: "apps/web/src/routes/team.$teamNumber.tsx"
      issue: "overall page layout — gutters, max-width, centring"
    - path: "apps/web/src/components"
      issue: "match table column layout: axis tick labels (-14/46/107/167) render inside the header row and read as column headings"
  missing:
    - "A layout pass judged by looking at the rendered page, not by a token diff"
  process_note: |
    Worth recording plainly: the loop that catches bad UI is rendering it and looking. In this
    phase that loop was structurally broken, which is why 9 plans and 7 planning documents did not
    catch a layout defect visible in one glance:
      - apps/web/e2e has no local webServer and asserts only against the deployed origin, and
        deploy.yml had been dead since the pnpm rebuild — so no-page-pan:84, a spec that ALREADY
        encodes this exact bug, had never actually run.
      - The before/after screenshots 06-09 produced for sign-off contain the broken mobile layout,
        but the plan's mechanical gates all looked at tokens rather than at the images.
      - Meanwhile the api-coverage verify:pre gate blocked UAT entirely over three cells exceeding
        a character count.
    The ceremony was pointed at the wrong risk. See the conversation following this UAT for the
    scope-split decision (keep the harness rigor for algorithm/pipeline work; drop to a tight
    render-and-look loop for UI).
