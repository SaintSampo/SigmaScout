---
phase: 06-team-pages
plan: 08
subsystem: ui
tags: [match-table, uncertainty-band, chart-craft, touch-scroll, tanstack-router, react]

requires:
  - phase: 06-team-pages
    provides: "06-01's frozen EventSectionList prop contract and alliance-red/alliance-blue/loser-ink theme tokens; 06-02's redScoreVarianceOwn/blueScoreVarianceOwn/actualRedRp/actualBlueRp/setNumber/matchNumber/sortTime schema fields; 06-06's live republish carrying all of the above on data.sigmascout.org"
provides:
  - "matchAxis.ts — the per-team-season shared score axis (MATCH_GEOMETRY, allianceMarkPositions, computeAxisDomain, scaleToPlot, axisTicks), the one computed source every match row's vertical position derives from"
  - "rpMoments.ts — predicted RP mean/sd from a published pmf, undefined for OPR/EPA"
  - "EventSection.tsx / MatchTable.tsx — the per-event match table: band/tick/dot anatomy, pinned leading column, Actual/Call columns, each section owning its own native horizontal scroll region"
  - "EventSectionList.tsx filled in — one EventSection per event with matches, axis domain computed once per team-season"
affects: [06-09]

actuals:
  tokens: 14900
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Every mark's vertical position derives from allianceMarkPositions(yBand)'s single centre — no component computes its own top value (enforced by a grep acceptance check on MatchTable.tsx)"
    - "Tailwind's built-in touch-pan-x / overscroll-x-contain utilities express touch-action: pan-x / overscroll-behavior-x: contain as literal class-name text, satisfying both the CSS behaviour and a source-level grep audit in one line, instead of an inline style object whose camelCase property names a grep can't see"
    - "Local Playwright script (chromium via @playwright/test) serving the real production build against a locally intercepted copy of the actual published R2 payload (page.route fulfilling the exact artifact + manifest URLs) — proves a real render-time number for NEW code that has not been deployed yet, sidestepping both the R2 CORS localhost block and the deploy-before-e2e constraint that blocks the Playwright suite itself"

key-files:
  created:
    - apps/web/src/components/team/matchAxis.ts
    - apps/web/src/components/team/matchAxis.test.ts
    - apps/web/src/components/team/rpMoments.ts
    - apps/web/src/components/team/rpMoments.test.ts
    - apps/web/src/components/team/EventSection.tsx
    - apps/web/src/components/team/EventSection.test.tsx
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/components/team/MatchTable.test.tsx
  modified:
    - apps/web/src/components/team/EventSectionList.tsx
    - apps/web/e2e/no-page-pan.spec.ts
    - apps/web/e2e/touch-scroll.spec.ts

key-decisions:
  - "Added two columns beyond the plan text's literal 'pinned | plot | Actual | Call' column-order list: Conf. (predicted winner + win probability as a percentage, from pRedWin, present for every row regardless of played status) and Pred. RP (rpMoments(redRpPmf)/rpMoments(blueRpPmf), rendering nothing at all — no dash, no placeholder — when the pmf is absent per D-13's precedent). TEAM-05's own must_haves truth requires 'the predicted winner, the confidence, ... the predicted ranking points with their variance' on screen, and one acceptance criterion explicitly names 'its predicted-RP cell' as a distinct target — the 4-column list in the action prose undercounts what the truths and acceptance criteria together require."
  - "matchLabel's exact format (\"Qual 12\", \"Semifinal 2-1\", \"Final 1-1\") is this plan's own discretion — CONTEXT.md/UI-SPEC.md name only the branching rule (published numbers first, matchKey suffix fallback), not literal text."
  - "The end-of-event metric snapshot renders every key from metricKeysFor(algorithmId, season) present on that row, unboxed via the existing MetricValue primitive — matching the plan's 'through the existing value-and-spread primitive, unboxed' instruction and D-17's reservation of tier boxes for the season header (06-07's job, not this plan's)."
  - "Donut-dot fill uses the plain CSS keyword white (via Tailwind's bg-white) rather than a hex literal or a new token — no existing token names pure white, and 'white' fails the file's own hex-literal grep audit trivially since it contains no hex digits."

patterns-established:
  - "Tailwind's directional touch-action / overscroll-behavior utility classes (touch-pan-x, overscroll-x-contain) as the source-of-truth expression of D-10's CSS pattern, satisfying both the runtime behaviour and a literal-text grep audit."
  - "A locally-intercepted-payload Playwright measurement script as the escape hatch for 'measure this new code's real render time' when the deployed origin cannot yet serve it and CORS blocks a plain local preview."

requirements-completed: []

coverage:
  - id: D1
    description: "The shared per-team-season axis (matchAxis.ts) is stable across the whole season including scheduled matches, never zero-anchored, and every alliance mark's vertical position derives from one computed source"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/matchAxis.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "rpMoments derives predicted RP mean/sd from a published pmf, undefined for an absent/empty pmf, sd exactly 0 (never NaN) for a single-outcome pmf"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/rpMoments.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each event section shows the team's metrics AS CAPTURED WHEN THAT EVENT ENDED (last matching metricHistory row), never seasonStats' season-final values; the Upcoming badge shows only while every match in that event lacks a result; long event names truncate with the full name in a title attribute"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/EventSection.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "MatchTable renders the full band/tick/dot anatomy per alliance (red always above blue), the pinned column marks this team's own alliance in semibold with no row-background difference, the Actual column greys only the losing NUMBER (never a plotted mark), scheduled rows draw both bands/ticks at full weight with zero dots, OPR/EPA rows drop the band and the predicted-RP cell silently (no placeholder), and the axis draws exactly once per section, never zero-anchored"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/MatchTable.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "On a team page with >=2 event sections, each event section owns its own native horizontal scroll region; a horizontal drag inside one section never pans the document or moves a sibling section; a vertical drag scrolls the page; an axis tick label stays visible while a section is scrolled"
    requirement: "TEAM-05"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/no-page-pan.spec.ts (frc118/2024 multi-section case) and apps/web/e2e/touch-scroll.spec.ts (team page — per-event-section touch scroll describe block)"
        status: fail
    human_judgment: true
    rationale: "Both specs are logically correct and were run against the deployed origin (playwright.config.ts's baseURL, no local webServer) — they fail because this worktree branch is not yet merged/deployed, so https://sigmascout.org's CURRENT team page still runs pre-06-08 code with zero match-table scroll regions (confirmed live: the new no-page-pan.spec.ts case reports 'found 0' scrollers against the OLD deployed build, and touch-scroll.spec.ts's beforeEach times out waiting for a selector that page does not yet render). This is the identical, already-documented pattern from 06-01-SUMMARY.md and 06-05-SUMMARY.md: e2e specs targeting the deployed origin cannot pass on an unmerged branch. A human (or the orchestrator, post-merge-and-deploy) must re-run `pnpm --filter web test:e2e -- no-page-pan` and `pnpm --filter web test:e2e -- touch-scroll` before trusting this deliverable end-to-end. Separately and independently: the automated touch-drag cases drive Chromium's CDP touch dispatcher, not a real iPhone's gesture recognizer — 06-RESEARCH.md Pitfall 6 documents historical iOS Safari gaps for directional touch-action inside a different-axis outer scroller, so even a future GREEN run of these specs is not evidence the real-device human check below is satisfied."
  - id: D6
    description: "A real-device human check for the D-10 per-section gesture contract, on a team page with >=2 event sections"
    verification:
      - kind: manual
        ref: "06-08-PLAN.md Task 3's <human-check>: on a real iPhone in Safari, drag horizontally inside the first section's match table (only that table should scroll), repeat inside the second section (first section must not move), drag vertically anywhere over a match table (page should scroll normally), drag diagonally (gesture must not stick to the wrong axis)"
        status: pending
    human_judgment: true
    rationale: "No real iOS device was available in this worktree. This is the single highest-risk item in the phase (CONTEXT.md's own framing) — recorded here so it surfaces at end-of-phase verification rather than being silently assumed covered by the Chromium-driven automated cases above."
---

# Phase 6 Plan 8: Per-Event Match Tables Summary

**The phase's centre of gravity: predicted-vs-actual match rows on one shared per-team-season axis (band/tick/dot anatomy, red always on top, the team's own alliance marked in place), each event section owning its own native horizontal scroll region so a phone drag never pans the whole page.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 (3/3 complete)
- **Files modified:** 11 (8 created, 3 modified)

## Accomplishments

- **`matchAxis.ts`**: `MATCH_GEOMETRY`'s locked pixel constants (band 8px, dot 12px, tick 14px, plot 44px, red/blue centres 12px apart), `allianceMarkPositions(yBand)` deriving every top from one `centre`, `computeAxisDomain(events)` spanning the WHOLE team-season including scheduled matches and each alliance's own predicted-score variance band (never per-event, never played-only), `scaleToPlot`/`axisTicks` (never zero-anchored). 16 unit tests, including two that assert domain STABILITY (a scheduled match sitting outside the played range still extends the domain; the domain is identical before and after that same match gets a result inside the existing range).
- **`rpMoments.ts`**: predicted RP mean/sd from a published pmf, `undefined` for an absent/empty pmf (OPR/EPA), sd exactly `0` — never `NaN` — for a degenerate single-outcome pmf.
- **`EventSection.tsx`**: event heading (truncated, full name in `title`), start date, `Upcoming` badge (shown only while every match in that event lacks a result), the team's end-of-event metric snapshot from the LAST matching `metricHistory` row (never `seasonStats`' season-final values — verified by a fixture whose event ends at 61.40 while `seasonStats.metrics.total.value` is 88.20), and its own `touch-pan-x overscroll-x-contain overflow-x-auto` scroll region with `min-w-0` on every ancestor.
- **`MatchTable.tsx`**: the shared axis drawn exactly once per event; a sticky pinned leading column (match label + both alliances' team numbers, this team's own three numbers semibold, no row-background difference); per-alliance band/tick/dot marks positioned entirely from `matchAxis.ts` (a grep for a literal `top: <number>` in this file returns 0); red always above blue regardless of which alliance the team itself is on; Confidence and Predicted-RP columns; an Actual column that greys only the losing NUMBER (`--loser-ink`) and never a plotted mark; a Call column in plain ink with an accessible label; scheduled rows draw both bands/ticks at full weight with zero dots and a weekday/time string; OPR/EPA rows drop the band and the predicted-RP cell entirely (no placeholder, per D-13). `matchLabel` prefers published set/match numbers, falls back to the matchKey suffix — tested for a qualification, a semifinal-with-set-number, a final, and the fallback branch. 20 component tests.
- **`EventSectionList.tsx`**: computes the axis domain once per team-season and passes it to every `EventSection`; filters out zero-match events (folds into the page-level E5 empty state, unchanged from 06-01); wires the existing `artifact-parsed -> first-rows-rendered` performance-mark pair (`perfMarks.ts`, previously Teams-page-only) so a real many-section render-time number is obtainable for this new code.
- **`no-page-pan.spec.ts` / `touch-scroll.spec.ts`** extended with frc118/2024 (D-05's named 292-match outlier, the team-page payload's largest published object) as the multi-section fixture: a scroller-count assertion runs BEFORE the document-overflow check; a companion case confirms each scroller's own content is wider than its own viewport; four touch-drag assertions confirm a first-section drag never moves the document or the second section, a vertical drag scrolls the page, and the document never gains horizontal overflow; an axis-tick-label-stays-visible assertion runs mid-scroll.
- **Real many-section render-time measurement, obtained despite the deploy blocker**: a local Playwright script served this branch's actual production build and intercepted the exact `v1/team/frc118/2024/...json` and `v1/manifest/algorithms.json` requests with the REAL published payloads (fetched once via `curl`, no CORS involved since interception happens before the request leaves the browser) — proving a real number for code that is not yet deployed, rather than skipping the measurement or reporting an assumed one. **Team frc118, season 2024, algorithm sigma1, 8 event sections: median ≈14.5ms parse-to-paint** (5 runs: 14.1, 14.1, 14.5, 16.3, 16.5 ms). The section list is a plain vertical scroll with no pagination/virtualization; at this volume (8 sections, the phase's own named worst case) it is comfortably fast, not merely "expected to be fine."

## Task Commits

1. **Task 1: The axis, the coupled geometry, and the two derivations the rows need** - `122588bf` (feat)
2. **Task 2: The event sections and the match table** - `446d5e99` (feat)
3. **Task 3: Prove the mobile gesture contract** - `cd03fe23` (test)

_No plan-metadata commit — this executor is a worktree-parallel agent; the orchestrator makes the metadata commit after the wave merges._

## Files Created/Modified

- `apps/web/src/components/team/matchAxis.ts` / `.test.ts` - shared axis domain, locked geometry, `allianceMarkPositions`, `scaleToPlot`, `axisTicks`
- `apps/web/src/components/team/rpMoments.ts` / `.test.ts` - predicted RP mean/sd from a pmf
- `apps/web/src/components/team/EventSection.tsx` / `.test.tsx` - one event: heading, badge, end-of-event snapshot, own scroll region
- `apps/web/src/components/team/MatchTable.tsx` / `.test.tsx` - the band/tick/dot row anatomy, pinned column, Confidence/Predicted-RP/Actual/Call columns, `matchLabel`
- `apps/web/src/components/team/EventSectionList.tsx` - domain computed once, filters zero-match events, wires the parse-to-paint perf marks
- `apps/web/e2e/no-page-pan.spec.ts` / `apps/web/e2e/touch-scroll.spec.ts` - the frc118/2024 multi-section fixture and its touch-drag assertions

## Decisions Made

- **Two columns beyond the plan's literal 4-column list.** The plan's action text names only "pinned | plot | Actual | Call", but TEAM-05's own `must_haves` truth and one acceptance criterion ("its predicted-RP cell") require the predicted winner, confidence and predicted RP ± variance to actually render somewhere. Added a Confidence column (predicted winner + win probability as a percentage, present for every row regardless of played status, per D-08's "prediction is the interesting part before a match") and a Predicted RP column (`rpMoments` per alliance, rendering nothing at all — no placeholder — when the pmf is absent, mirroring D-13's precedent for the score band).
- **`matchLabel`'s literal text is this plan's discretion.** CONTEXT.md/UI-SPEC.md specify only the branching rule (published numbers first, matchKey-suffix fallback); the exact strings ("Qual 12", "Semifinal 2-1") were chosen for readability and tested for their own shape, not against any spec-mandated literal.
- **Wired `EventSectionList.tsx` into the existing `artifact-parsed`/`first-rows-rendered` performance marks** (`perfMarks.ts`, not itself modified) rather than inventing a second mark pair — this is a Rule 2 addition (missing critical functionality): without it, Task 3's explicit instruction to "capture the time from artifact parse to the last event section painted using the existing performance marks" was literally impossible to satisfy, since nothing on the team route ever called `markFirstRowsRendered()`.
- **The donut dot's white fill uses the CSS keyword `white`** (via Tailwind's `bg-white`), not a hex literal — no existing token names pure white, and the keyword trivially satisfies this file's own hex-literal grep audit.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing-functionality gaps, or blocking issues were found in code this plan did NOT already need to touch for its own tasks.

### Documented additions (Rule 2)

**1. [Rule 2 - missing critical functionality] Wired the team route into the existing parse-to-paint performance marks**
- **Found during:** Task 3
- **Issue:** Task 3's own acceptance criteria require "the many-section render-time measurement... recorded in the SUMMARY... using the existing performance marks" — but no code on the team route ever called `markFirstRowsRendered()`; only `teams.tsx` did.
- **Fix:** Added a guarded `useEffect` to `EventSectionList.tsx` (a file already in this plan's declared `files_modified` list) calling the existing, unmodified `markFirstRowsRendered()`/`measureParseToPaint()` exports from `perfMarks.ts`.
- **Files modified:** `apps/web/src/components/team/EventSectionList.tsx` (already declared)
- **Verification:** confirmed via the local-measurement script described below; `pnpm --filter web test`/`typecheck` clean.
- **Committed in:** `cd03fe23`

---

**Total deviations:** 1 (Rule 2 addition, within already-declared file scope)
**Impact on plan:** No files outside the plan's declared `files_modified` list were touched. No scope creep.

## Issues Encountered

**Both e2e specs (`no-page-pan`, `touch-scroll`) fail when run now — expected, not a code defect.** `apps/web/playwright.config.ts` has no local `webServer`; both specs target `https://sigmascout.org` exclusively, and R2's CORS policy does not allow-list `localhost`/`*.pages.dev` (confirmed again this session, same finding as 06-01/06-05). This worktree branch is unmerged and undeployed, so the CURRENT deployed team page still runs pre-06-08 code with zero match-table scroll regions — `no-page-pan.spec.ts`'s new case reports "found 0" scrollers, and `touch-scroll.spec.ts`'s `beforeEach` times out waiting for a selector the old deployed page does not render. I ran both specs directly (`node node_modules/@playwright/test/cli.js test -g ... --project=iphone-17`) and confirmed the failure mode is exactly "selector never appears against the old build," not a timeout/crash/syntax error — the same class of evidence 06-01/06-05 recorded. **Action needed:** re-run `pnpm --filter web test:e2e -- no-page-pan` and `-- touch-scroll` after this branch merges and deploys.

**The many-section render-time measurement could not use the literal `pnpm --filter web test:e2e` path either**, for the identical deploy-dependency reason. Rather than reporting an assumed/estimated number or skipping the acceptance criterion, I built a standalone local measurement: a real production build (`vite build`) served over a local static HTTP server, driven by `@playwright/test`'s own `chromium` launcher, with `page.route()` intercepting the exact `v1/team/frc118/2024/...json` and `v1/manifest/algorithms.json` requests and fulfilling them with the REAL published payloads (fetched once via `curl` against `data.sigmascout.org` — a plain unauthenticated GET, no secrets involved). Interception happens client-side before the request leaves the browser, so it is not subject to R2's CORS policy at all. This measures this branch's ACTUAL new code against the ACTUAL published data, not a stand-in — result: **frc118/2024/sigma1, 8 event sections, median ≈14.5ms parse-to-paint** (5 runs: 14.1/14.1/14.5/16.3/16.5ms). The temporary script and fixture files were never committed (deleted before this SUMMARY was written; confirmed via `git status --porcelain` showing them absent).

**`node_modules` did not exist at worktree start** (same as 06-01's documented case) — `pnpm install --ignore-scripts` resolved it; `apps/web` does not need `better-sqlite3` at runtime. Verified functionally throughout via direct `node node_modules/vitest/vitest.mjs run` / `node node_modules/typescript/bin/tsc --noEmit` invocations, never by `pnpm`'s own exit code.

**`gsd_run windows append` failed** with "Ledger frontmatter line is not key: value" — `.planning/WINDOWS.md`'s existing frontmatter is CRLF-terminated (confirmed via `cat -A`), which the ledger parser rejects. This is a pre-existing repo-wide condition, not something introduced by this plan, and `WINDOWS.md` is not in this plan's declared file scope — left untouched rather than risking a cross-phase shared-file edit outside this plan's authority. Per the ledger's own documented "best-effort, never blocks execution" contract, this is noted here rather than retried.

## User Setup Required

None — no external service configuration required. No secrets were read, echoed, or interpolated; the `curl` calls against `data.sigmascout.org` fetched only already-public artifact JSON.

## Next Phase Readiness

- The Overview tab's match-table surface is functionally complete and covered by 36 new unit/component tests, all green, alongside a clean `pnpm --filter web typecheck` and the full workspace suite (1178 passed / 23 skipped / 0 failed across 96 files, including every pre-existing test).
- **Outstanding before phase sign-off (both already registered above, not silently dropped):**
  1. Re-run `pnpm --filter web test:e2e -- no-page-pan` and `-- touch-scroll` after this wave merges and the site redeploys (coverage D5).
  2. The real-device iOS Safari human check named in Task 3's own `<verify>` block — CONTEXT.md's own "highest-risk item in this phase" framing (coverage D6). No iOS device was available in this worktree.
- Plan 06-09 (or whichever plan closes out the phase) can build on a fully-populated `EventSectionList`/`EventSection`/`MatchTable` stack; no further schema or publisher work is needed — 06-02's schema and 06-06's live republish already carry every field this plan reads.

## Self-Check: PASSED

- FOUND: apps/web/src/components/team/matchAxis.ts
- FOUND: apps/web/src/components/team/matchAxis.test.ts
- FOUND: apps/web/src/components/team/rpMoments.ts
- FOUND: apps/web/src/components/team/rpMoments.test.ts
- FOUND: apps/web/src/components/team/EventSection.tsx
- FOUND: apps/web/src/components/team/EventSection.test.tsx
- FOUND: apps/web/src/components/team/MatchTable.tsx
- FOUND: apps/web/src/components/team/MatchTable.test.tsx
- FOUND: apps/web/src/components/team/EventSectionList.tsx (modified)
- FOUND: apps/web/e2e/no-page-pan.spec.ts (modified)
- FOUND: apps/web/e2e/touch-scroll.spec.ts (modified)
- FOUND: 122588bf (git log --oneline --all)
- FOUND: 446d5e99
- FOUND: cd03fe23

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
