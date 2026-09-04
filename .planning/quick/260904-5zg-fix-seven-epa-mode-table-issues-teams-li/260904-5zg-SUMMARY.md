---
phase: quick-260904-5zg
plan: "01"
subsystem: ui
tags: [react, tanstack-table, epa, teams-table, alliances-tab, metric-display]

requires: []
provides:
  - "withDerivedGroupMetrics (lib/metricGroups.ts): client-side exact-sum derivation of Auto/Teleop/Endgame group values for any algorithm that publishes components but not spread-carrying group metrics (EPA today)"
  - "EPA grouped Teams-table view (Total/Auto/Teleop/Endgame, toggle to full components) at feature parity with VPR's"
  - "Total-leads-metrics column order (D-5) on the Teams table (both views), the event Breakdown tab, and the event Insights tab"
  - "'Team Name' header label sitewide, column id 'nickname' unchanged"
  - "Algorithm-dependent (spread-carrying vs spread-less) column widths for the Teams table's metric columns and the Alliances tab's pick/combined columns, derived from measured rendered geometry against the live 2026 artifacts"
affects: [teams-page, event-page, team-page]

actuals:
  tokens: 19900
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Derive-not-duplicate: a single withDerivedGroupMetrics function feeds three consuming surfaces (Teams table row model, team-page SeasonHeader, event Insights tab) so a value can never differ between them"
    - "Algorithm-class-dependent column widths (spread-carrying vs spread-less) instead of one flat literal, exported as small predicate + width functions so a later width edit has one call site"

key-files:
  created: []
  modified:
    - apps/web/src/lib/metricGroups.ts
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/components/teams-table/rowModel.ts
    - apps/web/src/components/teams-table/columns.tsx
    - apps/web/src/components/ribbon/AlgorithmSelect.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/event/InsightsTab.tsx
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/RankDistributionTable.tsx
    - apps/web/src/components/event/AlliancesTab.tsx

key-decisions:
  - "EPA's Auto/Teleop/Endgame are derived client-side as an exact sum of published component VALUES only (no spread, no percentile, no tier) — legitimate because EPA publishes no spread anywhere, so there is no spread to get wrong; VPR's published group entries (with real spread/percentile/tier) are never overwritten"
  - "hasGroupedTeamsView widened from 'publishes group metrics' (VPR only) to 'can show real grouped values, published or derived' (every algorithm but OPR); the narrower fact is preserved as the new publishesGroupMetrics"
  - "metricKeysFor now leads with TOTAL_KEY for every algorithm — one change that lands D-5 (Total immediately right of the team-name column) on the Teams table's components view AND the event Breakdown tab simultaneously"
  - "Metric column widths are a function of whether the algorithm ever publishes a spread (VPR) rather than one flat literal — VPR's real worst case barely fits its pre-existing 120px/190px budgets, so those stayed unchanged; EPA/OPR's spread-less cells measured far smaller and were tightened (Teams metric columns 120->88, Alliances pick columns 190->150)"
  - "Alliances Combined Total column width is HEADER-bound for the spread-less case (128px, not the 88px the value alone would need) — caught by re-rendering the after-screenshot, which is exactly why the plan required one"
  - "Alliances pick-cell number-to-metric gap widened from --spacing-xs (4px) to --spacing-sm (8px) for both algorithms, directly answering 'EPA is too close to team number'"

patterns-established:
  - "A throwaway Playwright measurement script (deleted before commit) that intercepts requests to the R2 artifact origin and fulfills them server-side with an added CORS header, letting a real dev-server page render real published data despite R2 not allow-listing localhost"

requirements-completed: [D-1, D-2, D-3, D-4, D-5, D-6, D-7]

coverage:
  - id: D1
    description: "EPA Teams-list column widths re-derived from measured rendered content (120px -> 88px wide-viewport for spread-less algorithms), before/after measurements recorded"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/columns.test.tsx#metricColumnWidth — D-1 spread-carrying vs spread-less"
        status: pass
      - kind: automated_ui
        ref: "shots/teams-epa-grouped-{before,after}-{1440,390}.png, shots/teams-epa-components-{before,after}-{1440,390}.png"
        status: pass
    human_judgment: false
  - id: D2
    description: "EPA Teams table lands on grouped Total/Auto/Teleop/Endgame view by default with a working expand toggle and a legal ?cols=components URL"
    requirement: "D-2"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/groupedView.test.tsx#displayedMetricKeys"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/metricGroups.test.ts#withDerivedGroupMetrics"
        status: pass
    human_judgment: false
  - id: D3
    description: "EPA team-page Auto/Teleop/Endgame tiles carry real numbers instead of blank"
    requirement: "D-3"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/SeasonHeader.test.tsx#D-3 (260904-5zg)"
        status: pass
    human_judgment: false
  - id: D4
    description: "EPA event-Insights Auto/Teleop/Endgame columns carry real numbers instead of blank"
    requirement: "D-4"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx#InsightsTab — EPA derived group columns (D-4, 260904-5zg)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Total is the first metric column in the Teams table's expanded view and on the event Breakdown/Insights tabs"
    requirement: "D-5"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/metricKeys.test.ts#every returned array LEADS with the total key"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx#vpr/2024: exactly Team #, Team Name, Total..."
        status: pass
    human_judgment: false
  - id: D6
    description: "Every team-name column header reads 'Team Name'; column id stays 'nickname' everywhere"
    requirement: "D-6"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx, BreakdownTab.test.tsx (header text assertions)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Alliances pick columns re-sized from measurement (190px->150px spread-less), team number and metric visibly separated (gap 4px->8px)"
    requirement: "D-7"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#D-7 (260904-5zg)"
        status: pass
      - kind: automated_ui
        ref: "shots/alliances-epa-{before,after}-{1440,390}.png, shots/alliances-vpr-control-{before,after}-{1440,390}.png"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-09-04
status: complete
---

# Quick Task 260904-5zg: Seven EPA-Mode Table Issues Summary

**Client-side derivation gives EPA a real grouped Teams view and real Auto/Teleop/Endgame numbers on the team and event pages; Teams-table and Alliances-tab column widths retuned from measured geometry per algorithm instead of one flat literal.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-09-04
- **Tasks:** 3/3
- **Files modified:** 21 (apps/web/src only, plus a throwaway measurement script deleted before commit)

## Accomplishments

- **D-2/D-3/D-4 (root cause, three faces):** `lib/metricGroups.ts`'s new `withDerivedGroupMetrics(metrics, season)` sums each phase group's PRESENT published component values client-side and returns a value-only entry (no spread, no percentile, no tier — asserted absent, not just present). It never overwrites a published group entry, so VPR's covariance-derived spread/percentile/tier are provably unchanged (byte-identical, `.toBe()` reference-equality tested). One function feeds the Teams table row model, the team page's `SeasonHeader`, and the event page's `InsightsTab` — an EPA Auto number can never differ between those three surfaces.
- **D-2:** EPA's Teams table now lands on the same grouped Total/Auto/Teleop/Endgame default VPR has, with the same `All components ▸`/`◂ Grouped view` toggle and a legal `?cols=components` URL. `hasGroupedTeamsView` widened from "VPR only" to "every algorithm but OPR"; the narrower "does the pipeline publish the group" fact survives as `publishesGroupMetrics`.
- **D-5:** `metricKeysFor` now leads every algorithm's key array with `TOTAL_KEY` — one change that puts Total immediately right of the team-name column on the Teams table's components view AND the event Breakdown tab. The event Insights tab's own `metricGroupColumns` had a pre-existing code/comment disagreement (comment claimed Total was first, code appended it last) — Task 2 resolved it in the comment's stated direction.
- **D-6:** Every team-name column header across the site (`columns.tsx`, `InsightsTab.tsx`, `BreakdownTab.tsx`, `RankDistributionTable.tsx`) now reads "Team Name". The column id stays `nickname` everywhere — pinning, sticky offsets, `data-testid`, and e2e selectors are all untouched.
- **D-1/D-7:** Measured real rendered geometry against the deployed 2026 artifacts (a throwaway Playwright script, deleted before commit, intercepting R2 requests and fulfilling them with an added CORS header so a localhost page could render real published data). Confirmed the plan's hypothesis: metric columns were a flat 120px sized for VPR's `value ± spread` string, leaving a fixed surplus for spread-less algorithms. New `metricColumnWidth(algorithmId)`/`pickColumnWidth`/`combinedColumnWidth` functions return the pre-existing (measured-safe, unchanged) width for VPR and a smaller, independently measured width for EPA/OPR. The Alliances pick cell's number-to-metric gap widened from 4px to 8px for both algorithms, directly answering "EPA is too close to team number."

## Task Commits

1. **Task 1: derive the phase groups once, and wire them through the Teams table (D-2, D-5, D-6)** — `ee6a5ee3` (fix)
2. **Task 2: the same numbers on the team page and event Insights (D-3, D-4)** — `4bd66753` (fix)
3. **Task 3: render, measure, then fix the two spacing complaints (D-1, D-7)** — `be01f04b` (fix)

All three tasks were TDD (failing test written before implementation) where the plan specified it (Tasks 1 and 2); Task 3 wrote its own new width-variance assertions after measuring, per its own "measure first, edit second" instruction.

## Before/After Width Measurements (D-1, D-7)

All measured live against the deployed 2026 EPA/VPR/OPR artifacts (a throwaway Playwright script, deleted before this task's commit, intercepted `data.sigmascout.org` requests and fulfilled them with an added `Access-Control-Allow-Origin` header so a localhost dev server could render real data despite R2 not allow-listing localhost).

**D-1 — Teams table metric columns, at/above the breakpoint:**

| Algorithm class | Before | After | Real worst-case content measured |
|---|---|---|---|
| Spread-carrying (VPR) | 120px | 120px (unchanged) | "295.08 ± 105.31" boxed = 107.44px — the measurement found VPR genuinely cannot shrink further |
| Spread-less (EPA/OPR) | 120px | **88px** | "415.98"/OPR's real "-38.48" boxed = 65.16px (6-char, tabular-nums) |

Below `MOBILE_BREAKPOINT_PX` both stay the pre-existing 120px, unchanged — G-2/G-11's measured narrow arithmetic needed no re-derivation.

Screenshots: `shots/teams-epa-grouped-before-1440.png` vs `shots/teams-epa-grouped-after-1440.png` (and the `-390` narrow pair, plus `teams-epa-components-*` and `teams-vpr-grouped-control-*` as the VPR control at both viewports).

**D-7 — Alliances tab:**

| Column | Algorithm class | Before | After |
|---|---|---|---|
| pick0/pick1/pick2 | Spread-carrying (VPR) | 190px | 190px (unchanged — real worst case: 5-digit team "10428" + "295.08 ± 105.31" boxed barely fits) |
| pick0/pick1/pick2 | Spread-less (EPA/OPR) | 190px | **150px** |
| Combined Total | Spread-carrying (VPR) | 160px | **130px** |
| Combined Total | Spread-less (EPA/OPR) | 160px | **128px** (header-bound: "COMBINED TOTAL" itself needs 123.53px; the value alone would only need 88px — an oversight the after-screenshot caught and Task 3 fixed before commit) |
| Number-to-metric gap (all picks) | both | 4px (`--spacing-xs`) | **8px** (`--spacing-sm`) |

Record column re-measured (full-corpus sweep of every 2026 alliance record) and left unchanged at 72px — the real worst case is still single-digit-per-field ("6-4-1").

Screenshots: `shots/alliances-epa-before-1440.png` vs `shots/alliances-epa-after-1440.png` (and the `-390` narrow pair, plus `alliances-vpr-control-*` as the VPR control at both viewports). The after-screenshots visibly show the wider number/metric gap and the tightened, evenly-used column widths; the "COMBINED TOTAL" header no longer truncates.

## Files Created/Modified

- `apps/web/src/lib/metricGroups.ts` — `withDerivedGroupMetrics`, the one derivation
- `apps/web/src/lib/metricKeys.ts` — `metricKeysFor` leads with Total; `hasGroupedTeamsView`/`publishesGroupMetrics` split
- `apps/web/src/components/teams-table/rowModel.ts` — `buildTeamRows` derives group metrics per row
- `apps/web/src/components/teams-table/columns.tsx` — grouped view leads with Total; `metricColumnWidth`/`algorithmPublishesSpread` (D-1); Team Name label
- `apps/web/src/components/ribbon/AlgorithmSelect.tsx` — sort resolution uses `teamsSortKeyUniverse` so a grouped sort key survives an algorithm switch
- `apps/web/src/components/team/SeasonHeader.tsx` — phase tiles run metrics through `withDerivedGroupMetrics`
- `apps/web/src/components/event/InsightsTab.tsx` — `buildInsightsRows` derives group metrics from `artifact.season`; Total-leads column order fix; Team Name label
- `apps/web/src/components/event/BreakdownTab.tsx` — Team Name label (order fix comes free from `metricKeysFor`'s Total-first change)
- `apps/web/src/components/event/RankDistributionTable.tsx` — Team Name label
- `apps/web/src/components/event/AlliancesTab.tsx` — `pickColumnWidth`/`combinedColumnWidth` (D-7); widened number-to-metric gap

Test files updated alongside every source file above (TDD RED-then-GREEN where the plan specified it).

## Decisions Made

See frontmatter `key-decisions`. The most consequential: EPA's derived group values carry a value alone and are never allowed to look as authoritative as a published one (no ±, no tier box, asserted by explicit absence in every new test) — this was the plan's own T-5zg-03 threat mitigation (spoofing of confidence), directly implemented rather than left as a stated intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `routes/event.$eventKey.test.tsx` broken by the D-6 label change, then again by the D-5 order change**
- **Found during:** Task 1, then again in Task 2
- **Issue:** This file (outside the plan's declared `files_modified` list) asserts the Insights tab's header text/order literally. D-6's "Nickname" -> "Team Name" rename broke it in Task 1; D-5's Total-leads reorder broke it again in Task 2.
- **Fix:** Updated the same two header-array assertions both times, matching the fix already applied to the in-scope `InsightsTab.test.tsx`.
- **Files modified:** `apps/web/src/routes/event.$eventKey.test.tsx`
- **Verification:** Full `apps/web` suite green after each fix.
- **Committed in:** `ee6a5ee3` and `4bd66753` (part of each task's own commit — the file is a test-only edit, not a new source change).

**2. [Rule 1 - Bug] Alliances `COMBINED TOTAL` header truncated at the first-derived spread-less width (88px)**
- **Found during:** Task 3, re-rendering the "after" screenshot (exactly the step the plan required for this reason)
- **Issue:** `COMBINED_COLUMN_WIDTH_SPREADLESS_PX` was initially derived from the VALUE's content alone (88px, matching `METRIC_COLUMN_WIDTH_SPREADLESS_PX`), but the "COMBINED TOTAL" header text itself needs 123.53px (measured against the real `.th-cell-label` uppercase treatment) — wider than the value. The header rendered with a truncating ellipsis.
- **Fix:** Measured the header's real intrinsic width and set `COMBINED_COLUMN_WIDTH_SPREADLESS_PX = 128` (header-bound, not value-bound), documented explicitly in the constant's own doc comment.
- **Files modified:** `apps/web/src/components/event/AlliancesTab.tsx`, `AlliancesTab.test.tsx`
- **Verification:** Re-rendered after-screenshot shows the full "COMBINED TOTAL" label with no ellipsis; `AlliancesTab.test.tsx` asserts 128px explicitly.
- **Committed in:** `be01f04b` (part of Task 3's own commit, before the task was considered done).

**3. [Rule 3 - Blocking] The dev server on port 5173 the orchestrator said was pre-verified was serving a different project**
- **Found during:** Task 3, the precondition check
- **Issue:** `curl http://localhost:5173/v1/compare/2026.json` returned HTTP 200 but the body was an unrelated project's ("LearnXRP2") `index.html`, not a SigmaScout artifact — a `/v1` proxy that looked "up" by status code alone but was not actually serving this app.
- **Fix:** Followed the plan's own precondition fallback ("if it is gone, start `pnpm --filter web dev` and re-confirm") — started a fresh dev server for this repo, which auto-incremented past ports 5173–5175 (occupied by other concurrent sessions) to port 5176, confirmed serving the real app with a working proxy. Stopped that server after Task 3's measurements completed.
- **Files modified:** none (environment-only)
- **Verification:** `curl http://localhost:5176/v1/compare/2026.json` returned real JSON with correct `Content-Type: application/json`.
- **Committed in:** n/a (no code change) — noted in Task 3's commit message.

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking issue)
**Impact on plan:** All three were necessary corrections to keep the plan's own stated gates (full suite green, no truncated header, real measurements against a real server) genuinely true. No scope creep — every fix stayed inside this plan's D-1..D-7 scope.

## Issues Encountered

- Two concurrent quick-task sessions (`260904-5px`, `260904-6a1`) were editing shared files (`packages/core/algorithms/epa.ts`, `breakdown/groups.ts`, `sigma1/index.ts`, `apps/web/src/styles/theme.css`, etc.) throughout this session. Verified via `git show --stat` on each of this plan's three commits that none of those files were ever staged — every commit is scoped exactly to its declared `files_modified` list plus the two documented out-of-scope test fixes above.
- The measurement script's first run wrote screenshots to the wrong location twice (once to `apps/web/.planning/...` due to a cwd-relative path bug, once to `apps/.planning/...` due to an under-counted `path.resolve` `..` chain) before landing correctly at the plan's stated `.planning/quick/.../shots/` path. Both stray directories were deleted; none were committed.

## Known Stubs

None.

## Threat Flags

None — every threat this plan's own `<threat_model>` named (T-5zg-01 through T-5zg-04) was mitigated exactly as planned; no new security-relevant surface was introduced.

## Next Phase Readiness

All seven user-reported items (D-1 through D-7) are closed and verified: EPA's grouped Teams view works end-to-end, its Auto/Teleop/Endgame numbers are real on every surface that shows them, Total leads the metric block everywhere D-5 applies, every team-name header reads "Team Name", and both spacing complaints are fixed with measured, algorithm-aware widths. No blockers. The `apps/web` suite (1227 tests) and typecheck are both green on the current `main` HEAD.

---
*Quick task: 260904-5zg*
*Completed: 2026-09-04*
