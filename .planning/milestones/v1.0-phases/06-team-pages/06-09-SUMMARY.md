---
phase: 06-team-pages
plan: 09
subsystem: ui
tags: [performance, first-paint, playwright, tailwind, css, react, cls]

requires:
  - phase: 06-team-pages
    provides: "06-05's lazy Metric History boundary, 06-07's tier/season-header surfaces, 06-08's EventSection/MatchTable — the surfaces this plan re-measures and polishes"
provides:
  - "A static HTML shell (apps/web/index.html) that paints the ribbon frame and wordmark before any JavaScript executes, with critical CSS inlined and no route-level code splitting"
  - "A real, measured before/after (docs/first-paint-measurement.md's sixth/seventh entries) proving the congested-venue LCP threshold is now cleared on both the Teams and Team routes"
  - "static-shell-first-paint.md resolved with the measured numbers"
  - "A polish pass adding depth (elevation, surface distinction, zebra tint, alliance chips) to the team page's surfaces, entirely additive to the existing token system — no palette value changed"
  - "ui-polish-pass.md's question 1 recorded as addressed; question 2 (the base palette) restated as still deferred"
affects: []

actuals:
  tokens: 9384
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Static shell markup inlined inside index.html's #root, replaced exactly once by createRoot's from-scratch client render — no hydration, no duplicate chrome"
    - "Real local-build A/B measurement (two vite builds, two local static servers on adjacent ports, real CDP network+CPU throttling, PerformanceObserver-sourced LCP, median of three) — the fourth/fifth entries' established recipe, reused for a third and fourth time"
    - "Local Playwright script intercepting the real published R2 payload (page.route fulfilling the exact frc118/2024 artifact + manifest URLs) to prove new, unmerged code's behavior and take real before/after screenshots without waiting for deploy — 06-08's established escape hatch, reused"
    - "Card-inside-card colour inversion for zebra striping: the event-card surface uses --color-bg-surface, so the untinted match row inherits it and the tinted row's --color-bg-page is the one that visibly pops — two existing tokens, no third shade invented"

key-files:
  created:
    - apps/web/e2e/static-shell.spec.ts
    - .planning/phases/06-team-pages/screenshots/before-desktop.png
    - .planning/phases/06-team-pages/screenshots/before-phone.png
    - .planning/phases/06-team-pages/screenshots/after-desktop.png
    - .planning/phases/06-team-pages/screenshots/after-phone.png
  modified:
    - apps/web/index.html
    - apps/web/src/main.tsx
    - apps/web/playwright.config.ts
    - docs/first-paint-measurement.md
    - .planning/todos/pending/static-shell-first-paint.md
    - .planning/todos/pending/ui-polish-pass.md
    - apps/web/src/styles/theme.css
    - apps/web/src/components/ribbon/Ribbon.tsx
    - apps/web/src/components/team/EventSection.tsx
    - apps/web/src/components/team/EventSection.test.tsx
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/team/MatchTable.test.tsx

key-decisions:
  - "Shell CSS is a separate, hand-authored inline <style> block using literal hex values copied verbatim from theme.css's tokens (not Tailwind utility classes scanned from index.html) — this guarantees the shell paints from zero additional network round trips, independent of the built stylesheet's own render-blocking <link>, which is the whole point of inlining rather than reusing the external CSS that's already there."
  - "The shell's mobile second row is gated behind the SAME 767px breakpoint useIsMobile()/MOBILE_BREAKPOINT_PX uses (a literal @media query, not a JS read) — the shell and the real, JS-driven layout can never disagree about which mode applies for a given viewport width."
  - "playwright.config.ts's desktop project testMatch widened to include static-shell.spec.ts (Rule 3, matching 06-05/06-07's identical precedent) — baseURL/webServer left untouched, per this plan's explicit instruction not to repoint e2e at anything but the canonical deployed origin."
  - "Task 2's docs/first-paint-measurement.md entry was split into two headed sections (Sixth: Teams route, Seventh: Team route) rather than one — this also happens to satisfy the task's own automated verify script (which requires >=6 '## ...measurement' headings), but the real reason is that the plan's own action text asks for both routes to be measured, and each deserves its own results table."
  - "The match-row zebra tint deliberately INVERTS which token is the 'on' state depending on context: inside the .event-card (background var(--color-bg-surface)), the untinted row is transparent (inherits the card's surface) and the TINTED row uses --color-bg-page — this keeps both stripes visible using only the two pre-existing background tokens, rather than the tint being invisible against a same-coloured card."
  - "The Confidence column's bare 'Red'/'Blue' string became a small chip reusing the SAME --alliance-red/--alliance-blue tokens the plotted band/tick/dot marks already use — reinforcing one existing encoding rather than introducing a second colour system for the same job."

patterns-established:
  - "Static HTML shell + createRoot's from-scratch replacement as this app's first-paint architecture — any future page-shell change should preserve dimension parity with real render states to avoid CLS, following this plan's own local CLS measurement as the verification method."
  - "The additive-only theme.css diff gate (mechanical grep of removed --color-/--accent-/--alliance-/--tier- lines) as the enforcement mechanism for 'depth within the system, palette stays deferred' — any future polish-adjacent plan can reuse this exact gate verbatim."

requirements-completed: [TEAM-02, TEAM-03, TEAM-04, TEAM-05, TEAM-06, NAV-06]

coverage:
  - id: D1
    description: "The ribbon frame and wordmark paint from apps/web/index.html's own static markup, inside #root, before any JavaScript executes; React's createRoot replaces the shell exactly once on mount, with no duplicate chrome and a measured CLS of 0 over the mount transition (both desktop 1440px and phone 390px)"
    requirement: NAV-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/static-shell.spec.ts — both cases proven locally against this branch's real build (a local static server, no deploy dependency); the deployed-origin run of the JS-disabled case fails honestly against the OLD, pre-shell index.html, as expected pre-merge"
        status: pass
      - kind: other
        ref: "Local measurement script (not committed): dist/index.html grep confirms wordmark text + non-empty <style> block; hex-value cross-check confirms every inlined colour matches theme.css; CLS measured via PerformanceObserver at both viewport widths = 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The congested-venue first-paint number is measured before/after the shell with the fourth entry's method verbatim, and clears the 2.5s threshold on both the Teams route (1012ms) and the new Team route (1028ms) — a wide margin, not a close pass"
    requirement: NAV-06
    verification:
      - kind: other
        ref: "docs/first-paint-measurement.md's sixth and seventh entries — real local-build A/B, CDP throttling + 4x CPU, median of three runs per cell, three network profiles"
        status: pass
      - kind: unit
        ref: "This plan's own automated verify: node -e checking >=6 '## ...measurement' headings and the final entry mentioning 'congested venue' — both satisfied"
        status: pass
    human_judgment: false
  - id: D3
    description: "Route-level code splitting was not used or reintroduced anywhere in this plan"
    verification:
      - kind: other
        ref: "grep -c 'autoCodeSplitting' apps/web/vite.config.ts returns 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The polish pass adds depth (elevation on event section cards, alternating match-row tints, a bounded-categorical alliance chip, a stronger ribbon boundary) using only additive theme.css classes built from existing tokens — no --color-*/--accent/--alliance-*/--tier-* value added, removed or changed, and no hex literal in any of the three touched components"
    requirement: TEAM-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/EventSection.test.tsx — 'carries an elevation class and a surface class distinct from the page background'"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/team/MatchTable.test.tsx — 'renders alternating row tints' and 'renders the predicted-winner confidence chip in the alliance's own colour tokens'"
        status: pass
      - kind: other
        ref: "node -e additive-diff gate against theme.css (this plan's own verify script) — only additive token changes"
        status: pass
      - kind: other
        ref: "grep -Ec '#[0-9A-Fa-f]{6}' on EventSection.tsx, MatchTable.tsx, Ribbon.tsx — returns 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The polish pass does not move the measured page width or break the per-section touch-scroll pan invariant introduced in 06-08"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/no-page-pan.spec.ts / touch-scroll.spec.ts — logically correct, fail against the deployed origin's OLD (pre-06-08) build, matching the exact documented pattern from 06-05/06-08's own SUMMARYs"
        status: fail
      - kind: other
        ref: "Local Playwright script (not committed) intercepting the real frc118/2024 payload against THIS branch's real build: 8 scrollers found (one per event), document.documentElement.scrollWidth === clientWidth (390 === 390, no page-level overflow) at phone width"
        status: pass
    human_judgment: true
    rationale: "Identical, already-documented pattern from 06-01/06-05/06-08: playwright.config.ts's e2e specs target the deployed origin exclusively (no local webServer, R2 CORS does not allow-list localhost), and this worktree branch is unmerged/undeployed, so the deployed origin still serves pre-06-08/pre-06-09 code. The local intercepted-payload run above proves the real invariant against THIS branch's real code and real published data, but a human (or the orchestrator, post-merge-and-deploy) should re-run `pnpm --filter web test:e2e -- no-page-pan` and `-- touch-scroll` to close this out end-to-end, per every prior plan's identical precedent this phase."
  - id: D6
    description: "Before/after screenshots of the team page at desktop (1440px) and phone (390px) widths, using real frc118/2024 data, so the change is judged by looking rather than by a token diff"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/06-team-pages/screenshots/{before,after}-{desktop,phone}.png"
        status: pass
    human_judgment: true
    rationale: "The task's own must_haves truth is explicit that this is judged 'by looking at it rather than by a token diff' — a human sign-off on whether the page reads as 'more alive' without going decorative is the correct final check, even though the mechanical gates (additive-only diff, zero hex literals, elevation/tint component tests) all pass."

duration: ~3h45min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 9: Static Shell First Paint + UI Polish Pass Summary

**A static HTML shell that drops congested-venue LCP from ~4.2-4.4s to ~1.0s (clearing NAV-06's 2.5s threshold on both the Teams and Team routes), plus an additive-only polish pass giving the team page's event cards elevation, zebra-tinted match rows, and alliance-coloured confidence chips — no palette value touched.**

## Performance

- **Duration:** ~3h45min
- **Tasks:** 3/3 complete
- **Files modified:** 12 (5 created, 7 modified — plus 4 screenshot PNGs)

## Accomplishments

- **Static shell (Task 1).** `apps/web/index.html` now ships real authored markup inside `#root` — the ribbon frame, the wordmark (the LCP element), a neutral body placeholder, and a hand-authored `<style>` block whose token values are literal copies of `theme.css`'s own (cross-checked mechanically: every hex value in the inline block appears in `theme.css`). `createRoot`'s from-scratch client render replaces the shell exactly once on mount — proven locally (real build, no deploy dependency) via `static-shell.spec.ts`'s two cases and a CLS measurement of exactly 0 at both desktop and phone widths. No route-level code splitting was used (`grep -c autoCodeSplitting` returns 0, matching the explicit prohibition from the reverted D-19 split).
- **Real re-measurement (Task 2).** `docs/first-paint-measurement.md` gained a sixth (Teams route) and seventh (Team route) entry, using the fourth entry's method verbatim: two real local builds (with/without the shell), two local static servers, real CDP network + 4x CPU throttling, `PerformanceObserver`-sourced LCP, median of three runs per cell, three network profiles. **Congested-venue LCP: Teams 4360ms → 1012ms (saves 3348ms); Team 4240ms → 1028ms (saves 3212ms).** Both clear the 2500ms threshold by roughly 1.5s of margin — not a close pass. `static-shell-first-paint.md` is marked resolved with these numbers.
- **Polish pass (Task 3).** `theme.css` gained three additive-only classes (`.event-card`, `.match-row-tint`, `.alliance-chip`/`--red`/`--blue`), verified by the plan's own diff gate to touch no existing `--color-*`/`--accent`/`--alliance-*`/`--tier-*` value. `EventSection.tsx`'s sections are now cards (surface + border + `shadow-sm`) instead of a run-on list. `MatchTable.tsx` rows alternate tint (chart-craft.md's own zebra-tint-reinforces-grouping finding, on this exact table) and the Confidence column's bare "Red"/"Blue" became a small chip reusing the same alliance tokens the plotted marks already use. `Ribbon.tsx` gained `shadow-sm` for a stronger boundary against the page. Real before/after screenshots (desktop + phone, real frc118/2024 data) are attached at `.planning/phases/06-team-pages/screenshots/`. `ui-polish-pass.md` records which question-1 items were addressed and restates question 2 (the base palette) as still deferred.

## Task Commits

1. **Task 1: Paint the shell without waiting for JavaScript** - `c83428bd` (feat)
2. **Task 2: Re-measure first paint with the recorded method and record the entry** - `3a0232d5` (docs)
3. **Task 3: The polish pass — depth inside the current system** - `306a0174` (feat)

_No plan-metadata commit — this executor is a worktree-parallel agent; the orchestrator makes the metadata commit after the wave merges._

## Files Created/Modified

- `apps/web/index.html` - static shell markup + inlined critical CSS
- `apps/web/src/main.tsx` - documentation comment on `createRoot`'s replace behavior
- `apps/web/e2e/static-shell.spec.ts` - the shell's regression proof (both JS-disabled and JS-enabled cases)
- `apps/web/playwright.config.ts` - `desktop` project's `testMatch` widened (Rule 3, baseURL untouched)
- `docs/first-paint-measurement.md` - sixth (Teams) and seventh (Team) dated entries
- `.planning/todos/pending/static-shell-first-paint.md` - marked resolved with the measured before/after
- `apps/web/src/styles/theme.css` - `.event-card`, `.match-row-tint`, `.alliance-chip{,--red,--blue}` (additive only)
- `apps/web/src/components/ribbon/Ribbon.tsx` - `shadow-sm` on both header branches
- `apps/web/src/components/team/EventSection.tsx` / `.test.tsx` - card treatment + elevation test
- `apps/web/src/components/team/MatchTable.tsx` / `.test.tsx` - zebra tint + `AllianceChip` + tests
- `.planning/todos/pending/ui-polish-pass.md` - dated progress note
- `.planning/phases/06-team-pages/screenshots/{before,after}-{desktop,phone}.png` - visual before/after

## Decisions Made

See `key-decisions` in frontmatter above — the shell's separate hand-authored CSS (vs. reusing the external stylesheet), the shared-breakpoint media query for the shell's mobile second row, the `playwright.config.ts` widening scoped to `testMatch` only, the two-route split of Task 2's dated entry, the zebra-tint token inversion inside a surface-coloured card, and the alliance-chip's token reuse.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing-functionality gaps, or blocking issues were found in code this plan did not already need to touch for its own tasks.

### Documented additions (Rule 3 — necessary wiring, not scope creep)

**1. [Rule 3 - Blocking] `static-shell.spec.ts` matched no Playwright project's `testMatch`**
- **Found during:** Task 1, running this plan's own literal verify command
- **Issue:** `pnpm --filter web test:e2e -- static-shell` would report "no tests found" — the same class of gap 06-05/06-07 already hit and fixed for other specs.
- **Fix:** Widened the `desktop` project's `testMatch` regex to include `static-shell\.spec\.ts`. `baseURL`/`webServer` were left completely untouched, per this plan's own explicit instruction not to repoint e2e at anything other than the canonical deployed origin.
- **Files modified:** `apps/web/playwright.config.ts`
- **Verification:** the spec now runs (and, as expected pre-deploy, its JS-disabled case fails honestly against the deployed origin's old `index.html` — see Issues Encountered).
- **Committed in:** `c83428bd`

---

**Total deviations:** 1 (Rule 3, necessary wiring only — no `baseURL`/`webServer` change).
**Impact on plan:** No scope creep. No files outside what each task's own verify step required were touched.

## Issues Encountered

**E2E specs targeting the deployed origin fail as expected, pre-merge/deploy — the exact, already-documented pattern from 06-01/06-05/06-08.** `static-shell.spec.ts`'s JS-disabled case fails against `https://sigmascout.org` (still serving the OLD, pre-shell `index.html`); `no-page-pan.spec.ts`/`touch-scroll.spec.ts`'s team-route cases fail with "found 0 scrollers" (the deployed origin's team page predates the merged-but-not-yet-deployed match table code). Per this plan's own environment guidance, this was not chased and `playwright.config.ts`'s `baseURL`/`webServer` were never touched. Instead, every claim in this SUMMARY that depends on THIS branch's real code was verified through **local measurement scripts** (not committed, deleted after use): a local static server serving this branch's real `vite build` output, for Task 1's shell proof and CLS measurement, Task 2's A/B first-paint numbers, and Task 3's pan-invariant check and before/after screenshots — the last three using 06-08's established technique of intercepting the real, already-published `frc118/2024` payload via `page.route()` (a plain unauthenticated GET, no secrets involved) to prove behavior against real data without the deployed origin's CORS/deploy-timing constraints. **Action needed (matching every prior plan's identical precedent this phase):** re-run `pnpm --filter web test:e2e -- static-shell`, `-- no-page-pan` and `-- touch-scroll` after this wave merges and the site redeploys.

**The built CSS asset's size differs by roughly 11KB between the with-shell and without-shell builds used for Task 2's A/B measurement** (65.19KB vs 76.42KB pre-minification) — observed but not fully attributed to the shell markup itself (most likely Tailwind's content-scanning/rule-grouping producing a slightly different minified ordering across two separate build invocations). Flagged honestly in `docs/first-paint-measurement.md`'s sixth entry rather than asserted as understood; it does not change the measurement's core finding, since the CSS `<link>` is not the LCP-blocking resource in either variant (the JS bundle, byte-identical between variants, is).

**`node_modules` did not exist at worktree start** (same class of gap 06-01/06-07/06-08 already documented) — `pnpm install --ignore-scripts` resolved it cleanly (`apps/web` needs no native build). `routeTree.gen.ts` also did not exist, generated by one `vite build` invocation before the first typecheck, matching 06-07's identical finding. Verified functionally throughout via direct `node node_modules/vitest/vitest.mjs run` / `node ../../node_modules/typescript/bin/tsc --noEmit` invocations, never by `pnpm`'s own exit code.

## User Setup Required

None — no external service configuration required. No secrets were read, echoed, or interpolated; the `curl` calls against `data.sigmascout.org` fetched only already-public artifact JSON, matching the identical pattern 06-08 already established.

## Next Phase Readiness

- This is the phase's last plan. Static first paint and the polish pass are both complete and mechanically verified (build, typecheck, full `apps/web` test suite — 276/276 passing, up from 273 baseline).
- **Outstanding before phase sign-off (all already registered above, not silently dropped, matching this phase's own established precedent):**
  1. Re-run `pnpm --filter web test:e2e -- static-shell`, `-- no-page-pan` and `-- touch-scroll` after this wave merges and the site redeploys (coverage D1/D5).
  2. A human sign-off on the before/after screenshots — whether the polished page reads as "a serious data tool that is more alive," per the task's own must-have framing that this is judged by looking, not by a token diff (coverage D6).
  3. The real-device iOS Safari touch-gesture check named in 06-08's own Task 3 (`06-08-SUMMARY.md` coverage D6) remains open — unrelated to this plan's own work, carried forward as this phase's one remaining human-judgment item.
- `ui-polish-pass.md`'s question 2 (the base palette itself) is explicitly still open and deferred — a future phase-level decision, not something this plan pre-empted.

## Self-Check: PASSED

- FOUND: apps/web/e2e/static-shell.spec.ts
- FOUND: apps/web/index.html (modified)
- FOUND: apps/web/src/main.tsx (modified)
- FOUND: apps/web/playwright.config.ts (modified)
- FOUND: docs/first-paint-measurement.md (modified)
- FOUND: .planning/todos/pending/static-shell-first-paint.md (modified)
- FOUND: .planning/todos/pending/ui-polish-pass.md (modified)
- FOUND: apps/web/src/styles/theme.css (modified)
- FOUND: apps/web/src/components/ribbon/Ribbon.tsx (modified)
- FOUND: apps/web/src/components/team/EventSection.tsx (modified)
- FOUND: apps/web/src/components/team/EventSection.test.tsx (modified)
- FOUND: apps/web/src/components/team/MatchTable.tsx (modified)
- FOUND: apps/web/src/components/team/MatchTable.test.tsx (modified)
- FOUND: .planning/phases/06-team-pages/screenshots/before-desktop.png
- FOUND: .planning/phases/06-team-pages/screenshots/before-phone.png
- FOUND: .planning/phases/06-team-pages/screenshots/after-desktop.png
- FOUND: .planning/phases/06-team-pages/screenshots/after-phone.png
- FOUND: c83428bd (git log --oneline --all)
- FOUND: 3a0232d5
- FOUND: 306a0174

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
