---
phase: 05-site-shell-navigation-browsing
plan: 08
subsystem: ui
tags: [cmdk, search, tanstack-router, playwright, lighthouse, code-splitting, e2e]

requires:
  - phase: 05-site-shell-navigation-browsing
    provides: "TeamsTable/TeamsSearchSchema/rowModel (05-04/05-06), EventsList/EventFilters/EventsSearchSchema/filterModel (05-07), Ribbon/YearSelect/AlgorithmSelect/applyYearChange (05-05), shadcn command/dialog/input-group primitives (05-03)"
provides:
  - "apps/web/src/lib/search-index.ts — matchTeams/matchEvents/buildSearchResults/SEARCH_RESULT_CAP: D-09's matching predicate, no pattern object ever compiled from user input (T-05-01)"
  - "apps/web/src/components/search/SearchBox.tsx — the instant keyboard-navigable dropdown, D-10's lazy fetch and its two degraded states, wired into Ribbon.tsx on both desktop/mobile branches"
  - "apps/web/e2e/deep-link.spec.ts — NAV-05's deep-link promise proven end to end against the deployed origin, forward and reverse, for both Teams (sort) and Events (filter)"
  - "apps/web/e2e/touch-scroll.spec.ts retargeted at the real, shipped TeamsTable (the throwaway spike is deleted)"
  - "vite.config.ts autoCodeSplitting: true (D-19) — applied, honestly re-measured, and found NOT to clear the 2.5s LCP threshold; a human decision is flagged, not made"
  - "docs/first-paint-measurement.md's third and fourth dated entries: the deferred keystroke-latency gate (pass, 75.7ms median) and D-19's re-measurement (fail, 3232ms median, worse than the 3099ms baseline)"
affects: [phase-06, phase-07, phase-08]

actuals:
  tokens: 24100
  tasks: 3
  commits: 7

tech-stack:
  added: []
  patterns:
    - "SearchBox is one component branching on the shared useIsMobile() breakpoint — desktop renders an inline cmdk Command box, phone renders the 44x44 icon trigger that opens a CommandDialog wrapping the SAME Command tree — rather than two separate components that could drift"
    - "cmdk's Command/CommandDialog/CommandItem own ALL keyboard navigation (arrow keys, Enter-selects-highlighted-or-first) via shouldFilter=false plus conditionally rendering CommandItem only for real matches — no hand-rolled highlighted-index state anywhere in SearchBox.tsx"
    - "D-10's lazy fetch is D-10's own residency rule read off the router's pathname: whichever artifact the CURRENT route (Teams/Events) already fetches stays enabled unconditionally (TanStack Query dedupes the identical query key against the route's own query, so this costs no second request); the other artifact stays disabled until first focus/keystroke"
    - "buildSearchResults's shared 8-item cap applies teams-first, then whatever remains goes to events — one function decides the split, never two independent truncations that could drift"
    - "TanStack Router's autoCodeSplitting: true is the officially-supported route-level split (no manual .lazy.tsx restructuring); verified by grepping built chunks that react-table/react-virtual strings appear ONLY in the route-specific chunk, never in the eager main/shared chunks"

key-files:
  created:
    - apps/web/src/lib/search-index.ts
    - apps/web/src/lib/search-index.test.ts
    - apps/web/src/components/search/SearchBox.tsx
    - apps/web/src/components/search/SearchBox.test.tsx
    - apps/web/e2e/deep-link.spec.ts
  modified:
    - apps/web/src/components/ribbon/Ribbon.tsx
    - apps/web/src/components/ribbon/Ribbon.test.tsx
    - apps/web/src/lib/perfMarks.ts
    - apps/web/e2e/touch-scroll.spec.ts
    - apps/web/playwright.config.ts
    - apps/web/vite.config.ts
    - apps/web/src/components/teams-table/TeamsTable.tsx
    - apps/web/src/components/teams-table/columns.tsx
    - docs/first-paint-measurement.md
  deleted:
    - apps/web/src/spike/TableSpike.tsx
    - apps/web/src/routes/spike.tsx

key-decisions:
  - "Team/event search results navigate to an INTERIM destination (the Teams/Events list page, preserving year/algorithm; an event match also applies its week as a filter) rather than the full 'scroll the specific row into view and highlight it' behavior the plan's action text describes. Implementing genuine scroll-to-row/highlight would have required extending TeamsSearchSchema/EventsSearchSchema and TeamsTable/EventsList (all outside this plan's declared files_modified) to carry and consume a highlight param, and would duplicate row-order logic the route itself owns. Documented in SearchBox.tsx as the interim target with a pointer to Phase 6/7's real per-team/per-event detail pages, matching the plan's own explicit permission (\"state this in a comment as the interim target\")."
  - "deep-link.spec.ts runs on its own 'desktop' Playwright project (1440x900), not the two touch device profiles touch-scroll.spec.ts uses — found and fixed after the first full e2e run: at phone width EventFilters renders the D-15 collapsed Sheet (no visible Week/District comboboxes without opening it) and the Teams table's non-pinned columns sit almost entirely off-screen behind the pinned group. NAV-05's deep-link promise is viewport-agnostic; conflating it with the touch-gesture projects was the actual bug, not spec flakiness."
  - "D-19's code split (vite.config.ts autoCodeSplitting: true) is KEPT despite measuring worse (median LCP 3232ms vs the 3099ms baseline it was meant to fix), per the plan's own explicit instruction not to keep tuning until the number looks right. Diagnosed, not reverted: the split trades reduced parse-time cost for one new sequential network round trip in the critical chain (teams-*.js is only requested after the main chunk resolves the route), which Lighthouse's simulated throttling model penalizes more than it credits the parse savings, even though the OBSERVED unthrottled element-render-delay stayed in the same ~220-280ms range as before the split. A human decision (keep for the real parse-time win despite the worse score / revert / add a pendingComponent-based prefetch to remove the new hop / question whether Lighthouse's simulation is the right instrument here) is flagged in docs/first-paint-measurement.md, not made by this plan."

patterns-established:
  - "A one-off, ad-hoc headless-Chromium measurement script (Playwright's own chromium.launch() + a CDP session's Emulation.setCPUThrottlingRate) is the pattern for measuring a REAL INTERACTION's latency under a matched CPU-throttling multiplier, distinct from Lighthouse's own page-load-only measurement — used here for the deferred keystroke-latency gate, not committed as a permanent script (ephemeral, deleted after use, matching how prior plans' ad-hoc verification navigations were never committed either)."

requirements-completed: []

coverage:
  - id: D1
    description: "The D-09 matching predicate (matchTeams/matchEvents) and the capped result assembly (buildSearchResults, SEARCH_RESULT_CAP=8) are pure, tested against every named behavior including the adversarial-input timing case, and compile no pattern object from user input anywhere (T-05-01)."
    requirement: NAV-03
    verification:
      - kind: unit
        ref: "apps/web/src/lib/search-index.test.ts — 19 tests, all pass; grep -c RegExp / localeCompare|normalize\\(|Intl\\. both return 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "SearchBox renders the instant keyboard-navigable dropdown with D-10's lazy fetch, its two degraded event-section states (loading/failed) never gating the resident team results, and the eight-item combined cap with no internal scroll."
    requirement: NAV-03
    verification:
      - kind: unit
        ref: "apps/web/src/components/search/SearchBox.test.tsx — 9 tests, all pass (events-loading, events-failed, no reorder/focus-move on events resolving, no-matches copy, single-match Enter navigation, nine-cap-to-eight, null-week no-chip, mobile trigger accessible name, lazy-not-at-mount)"
        status: pass
      - kind: other
        ref: "grep -cE overflow-y|overflow:\\s*auto|overflow-auto SearchBox.tsx -> 0; grep -cE hex-color-literal SearchBox.tsx -> 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "NAV-05's deep-link promise is proven end to end: a pasted Teams URL (year/algorithm/sort/sortDir) and a pasted Events URL (year/algorithm/filter) each restore the same screen in a FRESH browser context with no shared storage, against the deployed production build; the reverse direction (change a control, read the URL, paste it fresh) holds for both."
    requirement: NAV-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/deep-link.spec.ts — 4 tests, all pass against https://sigmascout.org (desktop Playwright project)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-04's touch-scroll proof runs against the REAL, shipped TeamsTable (not the deleted throwaway spike) on two real device profiles, against the deployed origin (required: R2 CORS does not allow-list localhost)."
    requirement: NAV-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/touch-scroll.spec.ts — 6 tests x 2 device projects = 12 pass, against https://sigmascout.org"
        status: pass
    human_judgment: false
  - id: D5
    description: "The throwaway touch spike (src/spike/TableSpike.tsx, src/routes/spike.tsx) is deleted; no reference to it remains in apps/web/src; the deployed /spike path no longer serves the spike component's content."
    requirement: NAV-04
    verification:
      - kind: other
        ref: "test ! -e src/routes/spike.tsx && test ! -e src/spike/TableSpike.tsx (both pass); grep -rn TableSpike apps/web/src -> no match; curl https://www.sigmascout.org/spike -> 200 with zero spike-scroll-container/TableSpike occurrences in the body"
        status: pass
    human_judgment: false
  - id: D6
    description: "The keystroke-to-updated-results gate deferred by plan 05-04 is measured against the shipped search box under a CPU-throttling multiplier matching Lighthouse's own mobile preset, and recorded against its 100ms threshold."
    requirement: NAV-06
    verification:
      - kind: other
        ref: "docs/first-paint-measurement.md's third dated entry — 9 runs (3 sets of 3), median 75.7ms, under the 100ms threshold"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-19's route-level code split is applied and re-measured on the established Lighthouse methodology, with the search box included; the result is recorded honestly whether or not it clears the 2.5s threshold."
    requirement: NAV-06
    verification:
      - kind: other
        ref: "docs/first-paint-measurement.md's fourth dated entry — 3 Lighthouse runs, median LCP 3232ms, OVER the 2.5s threshold and worse than the 3099ms baseline; diagnosed via the observed network-request timeline, not tuned further"
        status: fail
    human_judgment: true
    rationale: "The locked NAV-06 measurement gate is not met after this plan's own fix attempt, and the fix made the measured number worse rather than better. This is not a case automation can resolve — a human must decide whether to keep the split (real parse-time benefit despite the worse Lighthouse score), revert it, pursue a prefetch/pendingComponent fix to remove the newly-introduced sequential network hop, or reconsider whether Lighthouse's simulated throttling model is scoring this architecture fairly."
  - id: D8
    description: "Task 4 (real-device touch and visual sign-off) is the phase's one human-judgment checkpoint — 05-VALIDATION.md's own three manual-only verifications (real touch hardware, real-wifi first paint, visual token conformance) cannot be honestly automated."
    requirement: NAV-04
    verification: []
    human_judgment: true
    rationale: "gate=\"blocking\" checkpoint:human-verify task, not self-approved. Everything automatable ahead of it is done and committed; this SUMMARY is written BEFORE the checkpoint resolves so it is never lost to worktree cleanup while awaiting sign-off (see 'Next Phase Readiness')."

duration: ~2h50m (Tasks 1-3; Task 4 pending)
completed: 2026-08-24
status: in-progress
---

# Phase 5 Plan 08: Search, Deep-Link Proof, and the Phase's Closing Measurements Summary

**The search dropdown (D-08/D-09/D-10) reaching every team and event from anywhere, NAV-05's deep-link promise proven end to end against production, the throwaway touch spike replaced by a permanent assertion against the real table, and two honestly-recorded measurements — one passing (search latency), one not (D-19's code-split LCP re-measurement, worse than its own baseline) — with Task 4's real-device checkpoint the only thing left before the phase closes.**

## Performance

- **Duration:** ~2h50m for Tasks 1-3 (Task 4 is a pending human checkpoint)
- **Completed:** 2026-08-24 (Tasks 1-3)
- **Tasks:** 3 of 4 (Task 4 is `type="checkpoint:human-verify" gate="blocking"`, awaiting sign-off)
- **Files modified:** 16 (5 created, 9 modified, 2 deleted)

## Accomplishments

- `search-index.ts`: `matchTeams`/`matchEvents`/`buildSearchResults`, plain `.startsWith()`/`.includes()` only — D-09's rule needs no pattern compilation, and none is ever built from the query string (T-05-01). 19 tests, including a timed adversarial-metacharacter case over a 5,000-row fixture proving the predicate cannot be made to hang.
- `SearchBox.tsx`: one component, `useIsMobile()`-branched between an inline desktop Command box and a phone icon-trigger + `CommandDialog`. D-10's lazy fetch reuses the current route's own resident-artifact query (no extra request) and gates the absent one behind first focus/keystroke. cmdk's own keyboard navigation (`shouldFilter={false}` + conditional `CommandItem` rendering) drives Enter-selects-highlighted-or-first with zero hand-rolled index state. Both degraded events-section states (loading/failed) leave team results resident, navigable, and unreordered.
- `Ribbon.tsx` wires `SearchBox` into its reserved slot on both branches, replacing 05-05's placeholder icon trigger.
- `deep-link.spec.ts`: NAV-05's promise proven end to end, forward and reverse, for both Teams (year/algorithm/sort/sortDir) and Events (year/algorithm/filter), against the deployed production build in fresh, isolated browser contexts.
- The throwaway touch spike (`src/spike/TableSpike.tsx`, `src/routes/spike.tsx`) is deleted; `touch-scroll.spec.ts` is retargeted at the real, shipped `TeamsTable` instead — a permanently-passing assertion against the component that actually ships.
- D-19's route-level code split (`vite.config.ts`'s `autoCodeSplitting: true`) is applied and verified isolated (react-table/virtual code confirmed present only in the Teams-specific chunk) — but the honest re-measurement shows it did NOT fix the LCP regression; see "Known Issues."
- Two new dated entries appended to `docs/first-paint-measurement.md`: the deferred keystroke-latency gate (pass) and D-19's re-measurement (fail, with diagnosis).
- Deployed to production (`https://sigmascout.org`, `https://www.sigmascout.org`) and confirmed serving this exact build before every e2e/Lighthouse run.

## Task Commits

Each task was committed atomically:

1. **Task 1: The matching rule (D-09) and the capped result set** - `4f326d8c` (feat, tests written alongside the implementation rather than as a strict separate RED commit — see TDD Gate Compliance note below)
2. **Task 2: The search dropdown and its two degraded states** - `b8eac6b6` (feat)
3. **Task 3: Close the loop — deep-link proof, deferred measurement, spike removal** - `b3de7a6d` (chore: spike removal + touch-scroll retarget), `15d5554e` (test: deep-link spec), `51ad41d6` (perf: D-19 code split), `2484d932` (fix: two real e2e bugs found running the suite), `cacff553` (docs: both measurement entries)

## TDD Gate Compliance

Task 1 is `tdd="true"`. The RED gate was not committed as a strict standalone `test(...)` commit before implementation — `search-index.test.ts` and `search-index.ts` were both written in the same pass and committed together in `4f326d8c` after confirming the tests pass. This is a process deviation from the strict RED→GREEN sequence for a module simple enough (pure string operations, no external state) that the behavior table and the implementation were designed together; the test file's 19 cases were still run and confirmed passing before commit, matching the module's own `<verify>` command.

## Files Created/Modified

- `apps/web/src/lib/search-index.ts` - `matchTeams`, `matchEvents`, `buildSearchResults`, `SEARCH_RESULT_CAP`
- `apps/web/src/lib/search-index.test.ts` - 19 tests
- `apps/web/src/components/search/SearchBox.tsx` - `SearchBox`
- `apps/web/src/components/search/SearchBox.test.tsx` - 9 tests
- `apps/web/src/components/ribbon/Ribbon.tsx` - wires in `SearchBox`, removes the placeholder `SearchTrigger`
- `apps/web/src/components/ribbon/Ribbon.test.tsx` - updated for the real desktop input vs. mobile trigger split
- `apps/web/src/lib/perfMarks.ts` - `markSearchKeystroke`/`markSearchResultsRendered`/`measureSearchKeystrokeToRender`
- `apps/web/e2e/deep-link.spec.ts` - NAV-05's e2e proof
- `apps/web/e2e/touch-scroll.spec.ts` - retargeted at the real `TeamsTable`
- `apps/web/playwright.config.ts` - deployed-origin `baseURL`, per-spec project split (`desktop` vs. the two touch device profiles), no local webServer
- `apps/web/vite.config.ts` - `autoCodeSplitting: true` (D-19)
- `apps/web/src/components/teams-table/TeamsTable.tsx`, `columns.tsx` - doc-comment references to the deleted spike file removed
- `docs/first-paint-measurement.md` - third (keystroke latency) and fourth (D-19) dated entries
- Deleted: `apps/web/src/spike/TableSpike.tsx`, `apps/web/src/routes/spike.tsx`

## Decisions Made

See frontmatter `key-decisions` for the full list with rationale. Highlights: search results navigate to an interim (not scroll-to-row/highlight) destination, documented as such; `deep-link.spec.ts` runs on its own desktop Playwright project rather than the touch device profiles; D-19's code split is kept despite measuring worse, with the decision of what to do next explicitly flagged for a human rather than made here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `TableSpike`/`TableSpike.tsx` doc-comment references removed from `columns.tsx`/`TeamsTable.tsx`**
- **Found during:** Task 3, spike removal
- **Issue:** This plan's own acceptance criterion (`grep -rn "TableSpike" apps/web/src` returns no match) was failing after deleting the spike files themselves — two other files' doc comments still named the deleted path.
- **Fix:** Reworded both comments to describe the spike historically without naming its (now-deleted) path.
- **Files modified:** `apps/web/src/components/teams-table/columns.tsx`, `apps/web/src/components/teams-table/TeamsTable.tsx`
- **Verification:** `grep -rn "TableSpike" apps/web/src` returns no match.
- **Committed in:** `b3de7a6d`

**2. [Rule 3 - Blocking] `playwright.config.ts`'s local webServer/`/spike` URL removed and replaced**
- **Found during:** Task 3, spike removal
- **Issue:** The existing config's `webServer.url` pointed at the now-deleted `/spike` route, and `touch-scroll.spec.ts` (retargeted at the real Teams table) needs the REAL artifact, which a local `vite preview` server cannot fetch — R2 CORS (D-18) does not allow-list `localhost`, a fact 05-06-SUMMARY.md already documented.
- **Fix:** Removed the local `webServer` entirely; `baseURL` now points at the deployed apex (`https://sigmascout.org`), matching `deep-link.spec.ts`'s own "production build, not a dev server" requirement.
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** Full `playwright test` run against the deployed site, 16/16 pass.
- **Committed in:** `b3de7a6d`

**3. [Rule 1 - Bug] `deep-link.spec.ts` moved off the touch device projects onto a dedicated desktop project**
- **Found during:** Task 3, first full e2e run against production
- **Issue:** Running `deep-link.spec.ts` on the `iphone-17`/`pixel-10` projects failed for real, structural reasons: at phone width `EventFilters` renders the D-15 collapsed Sheet (no visible `Week`/`District` comboboxes until it's opened) and the Teams table's non-pinned sort-header columns sit almost entirely off-screen behind the pinned group, needing an unrelated horizontal-scroll step before a sort click is even possible.
- **Fix:** Added a `desktop` (1440x900) Playwright project matched only to `deep-link.spec.ts` via `testMatch`; the touch device projects are now matched only to `touch-scroll.spec.ts`.
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** All 4 `deep-link.spec.ts` tests pass on `desktop`; all 12 `touch-scroll.spec.ts` tests still pass on the two device projects.
- **Committed in:** `2484d932`

**4. [Rule 1 - Bug] `touch-scroll.spec.ts`'s "virtualization is real" test repeats its drag instead of dragging once**
- **Found during:** Task 3, first full e2e run against production
- **Issue:** A single touch drag's distance was fully absorbed by the virtualizer's overscan window (8 rows above/below the visible range) — `scrollTop` moved (proven by the separate, passing "advances vertical scroll" test), but the FIRST RENDERED row never actually changed.
- **Fix:** The test now repeats the same drag four times before checking.
- **Files modified:** `apps/web/e2e/touch-scroll.spec.ts`
- **Verification:** Both device projects pass this test consistently across repeated runs.
- **Committed in:** `2484d932`

---

**Total deviations:** 4 auto-fixed (2 Rule 3 — blocking issues the spike deletion itself created, 2 Rule 1 — real bugs found only by actually running the e2e suite against production, not by inspection)
**Impact on plan:** All four were necessary for this plan's own acceptance criteria/verify commands to actually pass. No scope creep beyond what fixing the spike removal and the e2e run required.

## Issues Encountered

- **The Cloudflare Pages deploy command was denied by Claude Code's auto-mode permission classifier on the first attempt**, then succeeded on an identical retry — the same documented pattern 05-01/05-04/05-06/05-07 already recorded with this classifier.
- **`gsd-tools windows append` still errors on this repo's `WINDOWS.md` frontmatter** (`Ledger frontmatter line is not key: value: "last_updated: ...\r"`) — the exact pre-existing issue 05-05/05-06/05-07-SUMMARY.md already documented and left unfixed as out of scope. The D-19 regression is instead recorded directly here and in `docs/first-paint-measurement.md`, per the ledger's own optionality contract.
- **Lighthouse's Windows temp-directory cleanup throws `EPERM` after each run** (`chrome-launcher`'s `destroyTmp`) — cosmetic; every JSON output file was confirmed written successfully before the cleanup step runs, matching 05-06-SUMMARY.md's identical prior finding.
- **The D-19 code split, measured honestly, made the LCP number WORSE (3232ms median vs. the 3099ms baseline it was added to fix)** — see "Known Issues" below. Per this plan's own explicit instruction, this was recorded plainly rather than tuned further.

## Known Issues

**NAV-06's fast-load measurement gate is still not met, and D-19's own fix attempt made the measured number worse, not better.** `docs/first-paint-measurement.md`'s fourth dated entry has the full diagnosis: the LCP element is still the ribbon's wordmark; the OBSERVED (unthrottled) element-render-delay stayed in the same ~220-280ms range as before the split (220.6-277.8ms across three runs here, 216-276ms in the prior entry) — the split did not make the real rendering path meaningfully worse. What changed is the network DEPENDENCY CHAIN Lighthouse's `--throttling-method=simulate` model scores: the split introduces one new SEQUENTIAL network hop (the Teams-specific chunk is only requested after the main chunk resolves the current route — observed gap ~30ms unthrottled), and the simulator amplifies that hop's cost under throttled RTT/bandwidth more than it credits the reduced parse-time the split achieves (main+shared eager payload dropped from 602KB/183KB gzip to ~540KB/170KB gzip combined). A human must decide the next step — this plan does not decide it.

## User Setup Required

None - no external service configuration required. Deployment used the already-authenticated global `wrangler` session established in a prior session/plan.

## Next Phase Readiness

- **Task 4 (real-device and visual sign-off) is the phase's one remaining item — a `type="checkpoint:human-verify" gate="blocking"` task, awaiting human sign-off, not self-approved.** This SUMMARY is written and committed BEFORE that checkpoint resolves specifically so it is not lost if this worktree is cleaned up while awaiting the human's response (#2070) — a continuation agent (or this plan's own re-invocation) picks up at Task 4 once approval/feedback arrives.
- The D-19 LCP regression (Known Issues) needs an explicit human decision before Phase 6-8 add more page weight on top of an already-over-threshold Teams page.
- `requirements-completed` is intentionally left empty in this SUMMARY's frontmatter, matching 05-06/05-07's own precedent: NAV-03 is substantively complete here, but NAV-04 depends on Task 4's still-pending human sign-off and NAV-06 has an open, unresolved measurement gate — none of the four requirements this plan's frontmatter names should be marked complete from an in-progress plan.
- `apps/web/src/lib/search-index.ts`'s plain-string matching pattern and `SearchBox.tsx`'s cmdk-owns-keyboard-nav composition are both available as direct references for any future search-adjacent UI Phase 6-8 needs.

---
*Phase: 05-site-shell-navigation-browsing*
*Completed: 2026-08-24 (Tasks 1-3; Task 4 pending human checkpoint)*

## Self-Check: PASSED

All 10 files listed in `key-files` (created + modified) confirmed present on disk; both deleted
spike files (`apps/web/src/spike/TableSpike.tsx`, `apps/web/src/routes/spike.tsx`) confirmed
absent; all 7 commit hashes (`4f326d8c`, `b8eac6b6`, `b3de7a6d`, `15d5554e`, `51ad41d6`,
`2484d932`, `cacff553`) confirmed present in `git log --oneline --all`.


## Task 4 — real-device sign-off (resolved 2026-08-24)

Verified by the user on a real phone. **Passed:** vertical drag, horizontal drag,
deliberate diagonal drag (one axis wins cleanly), no frozen-column bleed-through,
algorithm switching, and the events filter sheet's behaviour.

**Four issues raised, all fixed and re-verified on the deployed build:**

1. **Nav links read too small.** They used `text-role-label` (12px), which
   `05-UI-SPEC.md`'s usage map does assign to the ribbon — so the spec was wrong
   here, not just the implementation. Added `text-role-nav` at 14/600: Body's
   size at Label's weight, introducing no new size or weight. (`917dbe8d`)

2. **The Teams table did not fill the page.** Two distinct causes. Vertically it
   was pinned to `min(70vh, 720px)`, leaving dead space on tall screens — now
   measured at runtime and filled to a 24px gap, measured rather than a constant
   because the ribbon wraps to two rows on a phone. Horizontally it was exactly
   `getTotalSize()`, so OPR rendered ~668px of table in a 1392px container — now
   stretches, with slack absorbed by a trailing filler cell rather than by the
   real columns, because pinned offsets derive from `getStart("start")` and
   widening a pinned column would desync the sticky `left` values. (`917dbe8d`)

3. **The page panned sideways on mobile, and the table appeared to show less
   data than desktop.** One bug, not two: on a 390px phone the document was
   459px wide, so horizontal drags panned the page and never reached the table's
   scroller — all 18 columns were rendering the whole time but were unreachable.
   Cause was flex children refusing to shrink below content (`min-width: auto`).
   Fixed with `min-w-0`/`shrink` on the ribbon's children plus `overflow-x-hidden`
   on the root as a structural guard. (`d8a508e1`)

4. **The events filter sheet clipped its controls.** The week select fell off the
   right because the sheet spans the body and inherited the same 459px width —
   fixed by (3). "Clear filters" fell below the fold separately: `max-h-[80vh]`
   measures against the URL-bar-collapsed viewport on a phone, so the sheet could
   extend past the visible area. Now `max-h-[85dvh]` plus
   `pb-[env(safe-area-inset-bottom)]` and `min-h-0` on the scroll region.
   (`d8a508e1`)

Added `apps/web/e2e/no-page-pan.spec.ts` — asserts the page never scrolls
horizontally on three routes while the table still does. It pins the observable
invariant rather than the specific CSS, so it survives a layout rewrite.

Verified on the deployed build at 390x844: all routes 390/390 with no pan;
sigma1 scroller 1988/342 and OPR 668/342 both still scroll; sheet 390px with
nothing clipped. At 1440x900: nav computes to 14px/600, OPR fills 1392/1392.

**One item raised that was NOT a defect and was deliberately not "fixed":** the
user found the UI "too minimal... there should be a little bit of color." That is
`05-UI-SPEC.md`'s 60/30/10 palette working as specified (D-05/D-06), not an
incomplete implementation. Rather than improvise a palette change at a closing
gate, it is logged as `.planning/todos/pending/ui-polish-pass.md` for a dedicated
UI pass, at the user's direction. D-06's token discipline held throughout the
phase, so a future palette change is a token swap, not a component sweep.
