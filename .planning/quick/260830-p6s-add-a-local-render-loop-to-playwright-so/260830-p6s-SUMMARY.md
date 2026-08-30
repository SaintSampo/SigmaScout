---
phase: quick-260830-p6s
plan: 01
subsystem: testing
tags: [playwright, vite, e2e, ci, proxy, cors]

requires: []
provides:
  - "Local Playwright webServer (build + preview) with a same-origin /v1 artifact proxy to https://data.sigmascout.org"
  - "local-desktop and local-phone-390 Playwright projects covering all 12 named layout/visual specs against http://localhost:4173"
  - "`pnpm --filter web test:e2e:local` — the one-word command a developer runs while building UI"
affects: [08-simulation-compare, future-frontend-phases]

actuals:
  tokens: 3779
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Vite server/preview proxy (/v1 -> https://data.sigmascout.org, changeOrigin: true) used to make a local page's artifact fetches same-origin, sidestepping R2 CORS entirely rather than routing around it or building a fixture server."
    - "Playwright project-level grepInvert used to exclude a single test-by-title from one project when its own premise (not the app's layout) does not hold at that project's viewport, without editing the spec file."

key-files:
  created: []
  modified:
    - apps/web/vite.config.ts
    - apps/web/playwright.config.ts
    - apps/web/package.json
    - apps/web/e2e/event-header-overflow.spec.ts

key-decisions:
  - "VITE_ARTIFACT_ORIGIN is picked up by Vite's env loader directly off process.env with no .env file and no define() fallback needed — verified live by grepping the built bundle for localhost:4173."
  - "Two origins, two projects each (local-desktop/local-phone-390 vs the four pre-existing deployed projects); use.baseURL stays https://sigmascout.org and none of the four existing projects were touched."
  - "event-header-overflow.spec.ts's project-name guard widened from an exact phone-390 match to an endsWith(\"phone-390\") suffix match — the only spec assertion touched in this task, and it widens rather than weakens the guard."
  - "no-page-pan.spec.ts's per-section-scroller-must-overflow test excluded from local-desktop via project-level grepInvert (not a spec edit) — a premise mismatch found live on the very first desktop-width run of this file, not a layout defect."

patterns-established:
  - "A spec runs on a local project only where its own premise (a real overflow, hasTouch, a genuine narrow-viewport defect class) holds — documented inline in playwright.config.ts beside the testMatch/grepInvert it affects, matching the file's pre-existing widening-history convention."

requirements-completed:
  - G-06-2

coverage:
  - id: D1
    description: "A local Vite server/preview proxy makes /v1 artifact requests same-origin, so a locally-built page loads real published R2 bytes without hitting data.sigmascout.org's CORS policy."
    requirement: "G-06-2"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/no-page-pan.spec.ts — 6/6 passed against http://localhost:4173, local-phone-390 project, Task 1 tracer run"
        status: pass
      - kind: other
        ref: "grep -c localhost:4173 apps/web/dist/assets/*.js — non-zero match confirms VITE_ARTIFACT_ORIGIN was baked into the built bundle"
        status: pass
    human_judgment: false
  - id: D2
    description: "webServer (build+preview, reuseExistingServer, VITE_ARTIFACT_ORIGIN) plus local-desktop/local-phone-390 projects cover all 12 named layout/visual specs at the width(s) where each spec's own premise holds; deployed-origin projects (use.baseURL, all four pre-existing projects) are byte-identical to before this task."
    requirement: "G-06-2"
    verification:
      - kind: e2e
        ref: "playwright test --list --project=local-desktop --project=local-phone-390 — Total: 107 tests in 12 files"
        status: pass
      - kind: e2e
        ref: "playwright test --list --project=desktop --project=iphone-17 --project=pixel-10 --project=phone-390 — Total: 181 tests in 17 files, unchanged from before this task"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full local loop (test:e2e:local) runs and its real output, classified FINDING vs HARNESS, is reported below; the one failure found on the first real desktop run was a HARNESS mis-assignment (fixed via grepInvert, not a spec edit), not an app layout defect."
    requirement: "G-06-2"
    verification:
      - kind: e2e
        ref: "playwright test --project=local-desktop --project=local-phone-390 --reporter=list, post-fix — 106 passed (0 failed)"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-08-30
status: complete
---

# Quick Task 260830-p6s: Add a local render loop to Playwright Summary

**A local Playwright `webServer` (build + `vite preview` behind a same-origin `/v1` proxy to real R2 artifact bytes) plus two new local projects (`local-desktop`, `local-phone-390`) cover all 12 layout/visual specs at `http://localhost:4173` — `pnpm --filter web test:e2e:local` closes the render-and-look loop G-06-2 found structurally broken, without touching R2's CORS policy or any deployed-origin project.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-30
- **Tasks:** 3/3
- **Files modified:** 4 (`apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json`, `apps/web/e2e/event-header-overflow.spec.ts`)

## Accomplishments

- **Task 1 (tracer):** proved the riskiest unknown — a local page origin CAN get real published artifact bytes — with one spec (`no-page-pan.spec.ts`, 6/6 passing) on one project (`local-phone-390`) before expanding. `VITE_ARTIFACT_ORIGIN` confirmed baked into the build bundle with no `define()` fallback needed.
- **Task 2:** expanded to `local-desktop` + widened `local-phone-390`, assigning all 12 named layout/visual specs to the local project(s) where each spec's own premise holds (verified against each spec's own header/premise-guard code, not assumed from the plan's table). Rewrote `playwright.config.ts`'s header to state the two-origin split as a decision. Fixed `event-header-overflow.spec.ts`'s vacuous-pass hazard (exact `"phone-390"` match -> `endsWith("phone-390")`). Added `test:e2e:local`.
- **Task 3:** ran the loop for real, found one HARNESS-class failure on the very first desktop-width run of `no-page-pan.spec.ts` (a test whose own premise — "the section scroller overflows" — does not hold at 1440px), fixed it with a project-level `grepInvert` (not a spec edit), re-ran, and got a clean 106/106 pass. Measured cold vs warm timing and confirmed `reuseExistingServer: true` genuinely skips the build (0 `[WebServer]` build lines in the warm run's log vs `$ vite build` / `$ vite preview` in the cold run's).

## Task Commits

1. **Task 1: One layout spec runs green against a locally-built page, end to end** - `f50b2d6d` (feat)
2. **Task 2: Expand to both viewports, all twelve specs, and document the two-origin split** - `d88ff1c7` (feat)
3. **Task 3 (harness fix, part of running the loop): exclude a desktop-width-premise-mismatched test from local-desktop** - `6b13a449` (fix)

_Task 3 itself is documentation/reporting (this SUMMARY); its one required code change (the HARNESS fix found by actually running the loop) is `6b13a449`._

## Files Created/Modified

- `apps/web/vite.config.ts` — added `server`/`preview` config with a shared `/v1 -> https://data.sigmascout.org` proxy (`changeOrigin: true`); pinned `preview.port: 4173` + `strictPort: true`.
- `apps/web/playwright.config.ts` — added `LOCAL_URL` constant, top-level `webServer` (build+preview, `reuseExistingServer: true`, 180s timeout, `VITE_ARTIFACT_ORIGIN` env), `local-desktop` and `local-phone-390` projects, a `grepInvert` HARNESS exclusion on `local-desktop`, and a new header section naming the two-origin split as a decision (G-06-2, proof-family assignment, CORS answer, top-level-`webServer` cost, `reuseExistingServer` staleness foot-gun).
- `apps/web/package.json` — added `"test:e2e:local": "playwright test --project=local-desktop --project=local-phone-390"`.
- `apps/web/e2e/event-header-overflow.spec.ts` — widened the 390px-only test's project-name guard from `!== "phone-390"` to `!testInfo.project.name.endsWith("phone-390")`; no assertion changed.

## Decisions Made

- `VITE_ARTIFACT_ORIGIN` reaches the built bundle via Vite's default `process.env` pickup — no `.env` file, no `define()` override needed. Verified live: `grep -c "localhost:4173" apps/web/dist/assets/*.js` returned a non-zero match on the very first build.
- The spec-to-project assignment table from the plan was verified against each spec file's own header/premise code (not trusted blind) before being encoded in `testMatch` — confirmed `setViewportSize` calls in `breakdown-desktop-overflow`/`search-results-overflow`/`metric-history-axis-legibility`, `hasTouch`/`touchDrag` dependence in `event-scroll-regions`/`touch-action-vertical-scroll`/`touch-scroll`, and the overflow-premise guards in `tab-strip-alignment`/`tab-strip-trigger-sizing`, and `table-layout-quality`'s own phone-390/pixel-10-only scoping comment.
- The one real-run failure (`no-page-pan.spec.ts`'s per-section-scroller-overflow test at 1440px) was fixed via `grepInvert` at the config level rather than editing the spec, honoring this task's own prohibition on touching any spec assertion other than `event-header-overflow.spec.ts`'s guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found by running the loop] `no-page-pan.spec.ts`'s per-section-scroller premise does not hold at 1440px**
- **Found during:** Task 3, first real `local-desktop` + `local-phone-390` run
- **Issue:** `no-page-pan.spec.ts:88` ("each of the team page's per-section scrollers is individually wider than its own viewport") unconditionally asserts `scrollWidth > clientWidth` for every `match-table-scroll-*` region. At 1440px, the `frc118/2024` fixture's `match-table-scroll-2024txkat` region measured `scrollWidth: 1102` === `clientWidth: 1102` — the section's real content genuinely fits inside a 1440px-wide container, so the test's own premise ("a region that never overflows proves nothing" — its own comment) is false at this width. This file never ran on a desktop-width project before this task (the deployed `desktop` project's `testMatch` never included `no-page-pan.spec.ts`), so this premise mismatch was structurally unreachable until this task's own render loop exercised it for the first time.
- **Fix:** Added a `grepInvert` regex to the `local-desktop` project excluding this one test by its exact title, with an inline comment explaining the premise mismatch and pointing to the same shape already documented for `tab-strip-alignment`/`tab-strip-trigger-sizing`. The file's other three tests (the real "document never pans" invariant, genuinely true at both widths) still run on `local-desktop` unweakened.
- **Files modified:** `apps/web/playwright.config.ts` (config only — no spec file touched, per this task's own prohibition)
- **Verification:** Re-ran `playwright test --project=local-desktop --project=local-phone-390 --reporter=list` — 106 passed, 0 failed.
- **Committed in:** `6b13a449`

---

**Total deviations:** 1 auto-fixed (Rule 1 — a HARNESS-class premise mismatch, not a layout defect, found by the loop this task built).
**Impact on plan:** The fix is a config-only exclusion, matching the plan's own required discipline ("verify per spec ... say so in the config comment rather than forcing it"). No app layout code and no spec assertion were touched to make this run green.

## Issues Encountered

None beyond the deviation above.

## What The Loop Found — Real Output

**Command run:** `cd apps/web && pnpm --filter web exec playwright test --project=local-desktop --project=local-phone-390 --reporter=list` (equivalent to `pnpm --filter web test:e2e:local`).

### First run (before the HARNESS fix), read from `--reporter=list` stdout

```
1) [local-desktop] › e2e\no-page-pan.spec.ts:88:1 › each of the team page's per-section scrollers is individually wider than its own viewport

    Error: match-table-scroll-2024txkat: scrollWidth 1102 does not exceed clientWidth 1102

    expect(received).toBeGreaterThan(expected)

    Expected: > 1102
    Received:   1102

  1 failed
    [local-desktop] › e2e\no-page-pan.spec.ts:88:1 › each of the team page's per-section scrollers is individually wider than its own viewport
  106 passed (33.8s)
```

**Classification: HARNESS.** Documented and fixed above (`6b13a449`) — this is a mis-assignment of a premise-bearing test to a width where its premise is false, not a layout bug. Per this task's own instruction, the app's layout was not touched and no assertion was weakened.

### Corrected run, read from `--reporter=list` stdout

```
106 passed (34.0s)   [cold: fresh vite build + preview]
106 passed (29.3s)   [warm: preview server already listening, webServer skipped entirely]
```

**Real per-spec-file pass counts (106 total, both projects combined, warm run):**

| Spec file | Passed |
|---|---|
| `event-scroll-regions.spec.ts` | 31 |
| `table-layout-quality.spec.ts` | 13 |
| `event-header-overflow.spec.ts` | 12 |
| `no-page-pan.spec.ts` | 11 |
| `zebra-stripe-full-row.spec.ts` | 10 |
| `touch-scroll.spec.ts` | 10 |
| `touch-action-vertical-scroll.spec.ts` | 7 |
| `breakdown-desktop-overflow.spec.ts` | 6 |
| `search-results-overflow.spec.ts` | 2 |
| `metric-history-axis-legibility.spec.ts` | 2 |
| `tab-strip-trigger-sizing.spec.ts` | 1 |
| `tab-strip-alignment.spec.ts` | 1 |
| **Total** | **106** |

Per project: `local-desktop` 26 passed, `local-phone-390` 80 passed (106 total). Zero failures, zero skips, in both the cold and the warm run.

**No FINDING-class failures were produced by this task's own run.** Every one of the 12 specs already encoded a real, previously-proven-passing assertion at its assigned local width; the loop's first-ever local pass reproduced the same clean state the deployed origin already showed for these specs, plus new coverage (`no-page-pan.spec.ts` on `local-desktop`, all specs on the local origin at all) that had never run before. The one failure this task's own run surfaced was HARNESS-class (above), not a layout defect — there is nothing to report under "still-unfixed layout bug" for this run.

### Cold vs. warm timing — proving `reuseExistingServer`

- **Cold** (`local-desktop`+`local-phone-390`, port 4173 free beforehand, Playwright starts `pnpm build && pnpm preview` itself): **34.0s** wall clock for the full 106-test run. The `[WebServer]` log stream shows `$ vite build` followed by `$ vite preview`.
- **Warm** (preview server started manually — `pnpm preview` — and already `LISTENING` on port 4173 *before* `playwright test` starts): **29.3s** wall clock. The `[WebServer]` log stream is **empty** — zero lines — confirming Playwright detected the already-running server and skipped starting `webServer` (no build, no preview invocation) entirely.
- **The build itself, measured standalone:** `VITE_ARTIFACT_ORIGIN=http://localhost:4173 pnpm build` completed in **`✓ built in 580ms`** (Vite's own reported time; ~2s wall clock including `pnpm` process overhead). This is why the cold/warm wall-clock gap (~4-5s) is modest relative to the ~29-34s test-execution time that dominates both runs: this app's Vite build is fast in absolute terms, but `reuseExistingServer: true` still removes 100% of that build+server-start cost on every run after the first (confirmed skipped, not merely fast, by the empty `[WebServer]` log).

**Important caveat for a future reader:** `reuseExistingServer: true` only skips the build when a server is *already listening* on `http://localhost:4173` **before** `playwright test` starts (e.g., a developer left `pnpm --filter web preview` running in a second terminal, or `pnpm --filter web dev`). Playwright does not persist the server it starts itself between separate `playwright test` invocations — a normal `pnpm --filter web test:e2e:local` run with no server already up will always be a cold run.

### Could every listed spec move to the local origin?

**Yes — all 12.** No spec was left un-movable. Every spec named in Task 2's assignment table now runs against `http://localhost:4173` on at least one of `local-desktop`/`local-phone-390`, at the width(s) where its own premise holds (documented inline in `playwright.config.ts` beside each `testMatch`/`grepInvert`).

### What a developer types now, and its cost

**`pnpm --filter web test:e2e:local`** — cold: ~34s (first run, or after stopping a stale preview server following a source change); warm: ~29s (subsequent runs against an already-running preview server). No deploy in the loop.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 8 (Simulation & Compare) can use `pnpm --filter web test:e2e:local` as its render-and-look loop while building its three new visual surfaces, without waiting for a deploy. The deployed-origin proofs (`deep-link.spec.ts`, `static-shell.spec.ts`, `team-page.spec.ts`, `event-page.spec.ts`, `event-live-artifact.spec.ts`) are unaffected and still gate the real deploy. No blockers.

## Self-Check: PASSED

- `apps/web/vite.config.ts` — FOUND, contains `server`/`preview` proxy config.
- `apps/web/playwright.config.ts` — FOUND, contains `LOCAL_URL`, `webServer`, `local-desktop`, `local-phone-390`, `grepInvert` exclusion.
- `apps/web/package.json` — FOUND, contains `test:e2e:local` script.
- `apps/web/e2e/event-header-overflow.spec.ts` — FOUND, guard widened to `endsWith("phone-390")`.
- Commit `f50b2d6d` — FOUND in `git log --oneline --all`.
- Commit `d88ff1c7` — FOUND in `git log --oneline --all`.
- Commit `6b13a449` — FOUND in `git log --oneline --all`.

---
*Quick task: 260830-p6s*
*Completed: 2026-08-30*
