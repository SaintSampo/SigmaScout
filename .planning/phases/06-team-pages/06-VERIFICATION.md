---
phase: 06-team-pages
verified: 2026-08-25T20:10:00Z
status: passed
score: 4/4 roadmap truths verified (36/36 plan-level must-haves verified in code; 0 failed)
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "On a real iPhone in Safari, open a team page with >=2 event sections (e.g. frc118/2024). Drag horizontally inside the first event's match table — only that table should scroll, the page must not pan sideways. Repeat inside the second section — same result, and the first section must not move. Drag vertically over a match table — the page should scroll normally. Drag diagonally — the gesture must not stick to the wrong axis."
    expected: "Each event section's horizontal scroll is independent and gesture-isolated from page vertical scroll on real iOS Safari, not just under Chromium's CDP touch emulation."
    why_human: "06-RESEARCH.md Pitfall 6 documents historical iOS Safari gaps for directional touch-action inside a different-axis outer scroller. This is the phase's own named highest-risk item (D-10); no iOS device was available during execution (06-08-SUMMARY.md coverage D6, still `status: pending`). A passing Chromium/CDP test is not evidence of real-device behavior."

  - test: "Re-run `pnpm --filter web test:e2e -- team-page`, `-- no-page-pan`, `-- touch-scroll`, and `-- static-shell` against the deployed origin after this branch is pushed to `origin/main` and Cloudflare Pages redeploys."
    expected: "All four specs pass against the real deployed build carrying Phase 6's route, match tables, and static shell."
    why_human: "Confirmed during this verification: local `main` (HEAD `5c8af78c`) is NOT pushed to `origin/main` (still at `79ca50be`, the Phase 5 HEAD), and a live fetch of `https://sigmascout.org/` shows the OLD empty-`#root` `index.html` with no static-shell markup. `apps/web/playwright.config.ts` has no local `webServer` and targets the deployed origin exclusively (R2 CORS does not allow-list localhost), so these specs structurally cannot pass until this code ships. Every plan's own SUMMARY (06-01, 06-05, 06-08, 06-09) already recorded this as a `human_judgment: true` coverage item — confirmed independently here, not merely repeated from the SUMMARYs."

  - test: "Look at the before/after screenshots in `.planning/phases/06-team-pages/screenshots/` (or the live polished page) at desktop and phone widths."
    expected: "The team page reads as a serious data tool that is more alive than Phase 5's — event sections as distinct objects, match rows grouping correctly via the zebra tint — without the color going decorative."
    why_human: "06-09-PLAN.md's own must-have states this is judged by looking, not by a token diff. The mechanical gates (additive-only theme.css diff, zero hex literals, elevation/tint component tests) all pass, but the qualitative call is explicitly deferred to a human per the plan's own text."
---

# Phase 6: Team Pages Verification Report

**Phase Goal:** Users can see a team's season at a glance and every one of its matches with predictions sitting beside actuals
**Verified:** 2026-08-25
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A team page shows the team's name, robot image for the selected year, a working TBA link, and its season record, win rate, and metrics | ✓ VERIFIED | `apps/web/src/components/team/SeasonHeader.tsx` renders nickname (with `Team {n}` fallback), Display-28/600 team number, `Avatar`/`AvatarFallback` for `robotImageUrl` (with `role="img"` accessible fallback), a `https://www.thebluealliance.com/team/{n}` anchor (`target="_blank" rel="noopener"`), record/win-rate, and a tier-boxed metric grid keyed by `metricKeysFor`. `SeasonHeader.test.tsx` (9 cases) exercises every branch. Live network fetch of `v1/team/frc118/2024/sigma1@...json` confirms `robotImageUrl`, `activeYears`, and a `percentile`-carrying metric are all real, non-synthetic values on the published artifact. |
| 2 | One section per attended/upcoming event; a finished event shows metrics as captured when that event ended, not today's | ✓ VERIFIED | `EventSection.tsx`'s `endOfEventMetrics()` returns the LAST `metricHistory` row matching `event.eventKey`, explicitly never reading `artifact.seasonStats.metrics` for the per-event snapshot (source read directly, confirmed — see code excerpt below). `EventSection.test.tsx` asserts a fixture where the event-end Total (61.4) differs from and does not match the season-final Total (88.2). `EventSectionList.tsx` renders one section per event ordered by `startDate`, filtering zero-match events into the page-level empty state; `Upcoming` badge shows only while every match in that event lacks a result. |
| 3 | Each event section lists matches with both alliances, predicted winner, confidence, predicted scores, predicted RP ± variance, actual scores, and actual RP | ✓ VERIFIED | `MatchTable.tsx` renders, per row: pinned column (match label + both alliances' team numbers, own alliance bolded), a shared-axis plot with band (from `redScoreVarianceOwn`/`blueScoreVarianceOwn` — the D-10 *predictive* variance) + tick + ringed dot per alliance, a Confidence column (`pRedWin`-derived %), a Predicted-RP column (`rpMoments(redRpPmf/blueRpPmf)`), an Actual column (scores + RP, loser greyed by `--loser-ink`, never the plotted mark), and a Call column (✓/✗ in plain ink with accessible labels). The two ± quantities are kept genuinely distinct in code: `MatchTable`/`matchAxis.ts` read only `redScoreVarianceOwn`/`blueScoreVarianceOwn` for match bands, while `EventSection`'s end-of-event snapshot and `MetricHistoryChart` read only `TeamMetric.spread` — no shared code path merges them (confirmed by direct source reading, not just doc comments). Live fetch confirms a real played match carries `redScoreVarianceOwn: 525.10`, `blueScoreVarianceOwn: 390.77`, `actualRedRp: 0`, `actualBlueRp: 2` simultaneously with the summed `variance: 915.87`, i.e., three distinct numbers, not one derived from another. `MatchTable.test.tsx` covers band/tick/dot presence, scheduled-row full-weight bands with zero dots, OPR/EPA silent band/RP omission, and the loser-ink/plotted-mark distinction. |
| 4 | A second tab plots the team's metrics across the season with matches on the x-axis, including a variance band for Sigma metrics | ✓ VERIFIED | `MetricHistoryTab.tsx` lazy-loads `MetricHistoryChart.tsx` (Recharts `ComposedChart`) behind a measured dynamic import (D-14, confirmed via a real A/B first-paint measurement in `docs/first-paint-measurement.md`'s fifth entry). `metricHistorySeries.ts`'s `buildMetricSeries` plots array position (never season-wide `matchIndex`), `detectEventBands` groups by `eventKey`. The chart draws an `Area` band only where `spread` exists (silent on OPR/EPA per D-13) and a `Line` for `TOTAL_KEY` only (D-11). 16 `metricHistorySeries` tests + `MetricHistoryChart.test.tsx` (9 tests including zero/one/many points and a high-match-count density fixture) all pass. |

**Score:** 4/4 roadmap truths verified; 0 behavior-unverified; 0 failed.

### Plan-Level Must-Haves Summary

All 9 plans' `must_haves.truths`/`artifacts`/`key_links` (well over 100 individual line items across 06-01 through 06-09) were cross-checked against the actual codebase, not accepted from SUMMARY claims. No artifact was found MISSING or STUB; every key link (route → api/team.ts → `TeamSeasonArtifactSchema`, `OverviewTab` → `SeasonHeader`/`EventSectionList`, `MetricHistoryTab` → lazy `MetricHistoryChart`, `EventSection` → `matchAxis.ts`, search box/Teams table → `/team/$teamNumber`) is present and wired. Full detail below by artifact/link category.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/routes/team.$teamNumber.tsx` | `/team/$teamNumber` route, single artifact fetch, tab shell, page states | ✓ VERIFIED | `createFileRoute("/team/$teamNumber")`, `TeamSearchSchema` validateSearch, wired to `SeasonHeaderSkeleton`/`EventSectionSkeleton`, `YearMismatchEmptyState`/`NoEventDataState`, `OverviewTab`, `MetricHistoryTab`. Deviation noted in 06-07-SUMMARY (this file is not in 06-07's declared `files_modified`) — read directly and confirmed sound; wiring to the new `SeasonHeaderSkeleton` is correct and does not disturb 06-01's route contract or 06-08's `EventSectionList` wiring. |
| `apps/web/src/lib/api/team.ts` | `fetchTeamArtifact`/`teamQueryOptions` | ✓ VERIFIED | Present, mirrors `teams.ts` pattern, parses through `TeamSeasonArtifactSchema`. |
| `apps/web/src/lib/teamKey.ts` | `toTeamKey`/`teamNumberFromKey` | ✓ VERIFIED | Single home for the `frc{n}` convention; consumed by `MatchTable.tsx`'s `teamNumberLabel`. |
| `apps/web/src/components/team/SeasonHeader.tsx` | Identity, image, TBA link, record, win rate, tier grid | ✓ VERIFIED | See truth #1 evidence above. |
| `apps/web/src/components/team/EventSectionList.tsx` / `EventSection.tsx` / `MatchTable.tsx` | Per-event match display | ✓ VERIFIED | See truths #2/#3 evidence above. |
| `apps/web/src/components/team/MetricHistoryChart.tsx` / `MetricHistoryTab.tsx` / `metricHistorySeries.ts` | Metric-history tab | ✓ VERIFIED | See truth #4 evidence above. |
| `apps/web/src/lib/tiers.ts` | `tierForPercentile`/`TIER_BANDS` | ✓ VERIFIED | Boundary contract exactly as specified: `[0,50) common, [50,75) rare, [75,95) epic, [95,100] legendary`; `undefined`/out-of-range → `undefined`, no clamping. |
| `apps/web/src/components/team/matchAxis.ts` / `rpMoments.ts` | Shared axis + RP moments | ✓ VERIFIED | `allianceMarkPositions` derives band/tick/dot tops from one `centre`; `computeAxisDomain` spans whole team-season including scheduled matches and each alliance's own SD extents, never zero-anchored. |
| `packages/harness/pageArtifacts.ts` | D-01…D-05/D-09 schema fields | ✓ VERIFIED | `percentile` (bounded `[0,100]`), `robotImageUrl` (`.url()`), `activeYears`, `redScoreVarianceOwn`/`blueScoreVarianceOwn`, `actualRedRp`/`actualBlueRp`, and the D-09 cross-field `.refine()` (played match ⇒ all three actual fields; unplayed ⇒ none) are all present in the rebuilt `TeamSeasonMatchSchema`/`TeamMetricSchema`/`TeamSeasonArtifactSchema`, confirmed by direct grep + read of the schema file. |
| `packages/core/algorithms/sigma1/index.ts` | Own-variance publish | ✓ VERIFIED | `redScoreVarianceOwn`/`blueScoreVarianceOwn` attached to `predict()`'s return object; live fetch confirms non-zero, distinct values on a real match. |
| `packages/harness/percentiles.ts` | Mid-rank percentile pass | ✓ VERIFIED | `withPercentiles`/`percentileRanks`; live fetch confirms a real `percentile: 91` on a Total metric. |
| `packages/ingest/media.ts` / `team_media` table | Robot photo resolution | ✓ VERIFIED | `pickRobotPhotoUrl` allowlist-then-preferred-else-first; real ingest run recorded 17,229 team-year rows, 42.75% resolved; live artifact carries a real `i.imgur.com` URL. |
| `docs/publish-budget.md` | Re-measured payload budget | ✓ VERIFIED | `team/{teamKey}/{year}` row shows 304,862 B max (against 375,000 B budget, 18.70% headroom); `payloadBudget.test.ts` (10/10) passes; no `budgetMaxBytes` value was edited (confirmed by reading the file — only prose changed). |
| `apps/web/index.html` | Static shell | ✓ VERIFIED | Real markup inside `#root` (ribbon frame, wordmark, placeholder), inlined critical CSS with literal token values matching `theme.css`. `createRoot(el).render(...)` replaces it on mount. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `team.$teamNumber.tsx` | `lib/api/team.ts` | `teamQueryOptions` | ✓ WIRED | Confirmed in route source. |
| `lib/api/team.ts` | `pageArtifacts.ts` | `TeamSeasonArtifactSchema.parse` | ✓ WIRED | Confirmed. |
| `OverviewTab` | `SeasonHeader`/`EventSectionList` | props | ✓ WIRED | Confirmed; neither child imports the other (06-01's frozen-contract requirement). |
| `MetricHistoryTab` | `MetricHistoryChart` | `React.lazy(() => import(...))` | ✓ WIRED | Confirmed; separate build chunk (`MetricHistoryChart-*.js`, 331 KB) absent from `dist/index.html`'s eager `<script>` tags per 06-05-SUMMARY's build evidence. |
| `EventSection` | `matchAxis.ts` | `computeAxisDomain` computed once, passed down | ✓ WIRED | Confirmed in `EventSectionList.tsx`/`EventSection.tsx`. |
| `SearchBox`/`teams-table/columns.tsx` | `/team/$teamNumber` | `navigate`/`Link` | ✓ WIRED | Confirmed by source read; both carry `year`/`algorithm`. |
| `publish.ts` | `percentiles.ts`/`corpus/db.ts` | `withPercentiles`, `selectTeamMediaForYear`, `selectTeamKeysForYear` | ✓ WIRED | Confirmed in `publish.ts` and validated end-to-end by the real republish. |

### Data-Flow Trace (Level 4)

All dynamic-data surfaces trace to real, non-static sources: `SeasonHeader`/`EventSection`/`MatchTable`/`MetricHistoryChart` all consume the single `TeamSeasonArtifact` fetched by the route; a live network fetch of a real team artifact independently confirmed every Phase 6 field (`robotImageUrl`, `activeYears`, `percentile`, `redScoreVarianceOwn`/`blueScoreVarianceOwn`, `actualRedRp`/`actualBlueRp`, real event names) is populated with genuine, non-placeholder values — not an empty array/object or a static fallback masquerading as real data.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit/component suite | `node node_modules/vitest/vitest.mjs run` | 99 files / 1279 tests passed, 0 failed | ✓ PASS |
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | clean, no output | ✓ PASS |
| Payload budget gate | `node node_modules/vitest/vitest.mjs run packages/harness/payloadBudget.test.ts` | 10/10 passed | ✓ PASS |
| Live artifact field check | `fetch` against `data.sigmascout.org/v1/team/frc118/2024/sigma1@...json` | `activeYears`, `robotImageUrl`, `percentile`, own-variance, actual RP, real event name all present | ✓ PASS |
| Deployment status of this branch | `git rev-parse HEAD` vs `origin/main`; `curl https://sigmascout.org/` | Local `main` (`5c8af78c`) is ahead of `origin/main` (`79ca50be`, Phase 5 HEAD); live `index.html` still shows the pre-shell empty `#root` | ⚠ NOT YET DEPLOYED (see Human Verification) |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention or phase-declared probes found for this phase.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| TEAM-02 | 06-01, 06-03, 06-04, 06-06, 06-07, 06-09 | Team page: name, robot image, TBA link | ✓ SATISFIED | SeasonHeader, media ingest, publisher wiring, live fetch all confirmed. |
| TEAM-03 | 06-01, 06-02, 06-04, 06-06, 06-07, 06-09 | Season stats: record, win rate, metrics | ✓ SATISFIED | SeasonHeader grid + percentile tiering confirmed. |
| TEAM-04 | 06-01, 06-02, 06-04, 06-06, 06-08, 06-09 | Section per attended/upcoming event, end-of-event metrics | ✓ SATISFIED | EventSection's `endOfEventMetrics` confirmed reading `metricHistory`, not `seasonStats`. |
| TEAM-05 | 06-02, 06-04, 06-06, 06-08, 06-09 | Match rows: predictions + actuals, two distinct ± | ✓ SATISFIED | MatchTable/matchAxis confirmed using own-variance for bands, never consistency spread. |
| TEAM-06 | 06-05, 06-09 | Metric-history tab with variance band | ✓ SATISFIED | MetricHistoryChart/metricHistorySeries confirmed. |

No orphaned requirements: REQUIREMENTS.md's Phase 6 row (TEAM-02…TEAM-06) matches exactly the union of `requirements:` fields declared across all 9 plans. `REQUIREMENTS.md` itself still shows `[ ]` for these five IDs — this is expected and matches the project's own established pattern (the `[x]` flip happens in a subsequent "docs(phase-N): complete phase execution" commit, made after verification passes, as seen for every prior phase in `git log`), not a gap this verification should flag as failing.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` across the 20 core Phase 6 files (routes, components, schema, publisher, ingest) returned zero matches. No hardcoded empty-data stub patterns found in any Phase 6 component; every "empty" render path (no robot image, no percentile, no spread, zero events, zero matches) is an intentionally-designed and tested state, not an unfinished stub.

### Human Verification Required

1. **iOS Safari real-device touch-gesture check (D-10, phase's own named highest-risk item)**
   **Test:** On a real iPhone in Safari, open a team page with ≥2 event sections (e.g. `/team/118?year=2024&algorithm=sigma1`). Drag horizontally inside the first section's match table (only it should scroll); repeat in the second section (first must not move); drag vertically over a match table (page should scroll); drag diagonally (gesture must not stick to the wrong axis).
   **Expected:** Each event section's native horizontal scroll is gesture-isolated from page vertical scroll.
   **Why human:** Documented historical iOS Safari gaps for directional `touch-action` inside a different-axis outer scroller (06-RESEARCH.md Pitfall 6). No device was available during execution; 06-08-SUMMARY.md's own coverage item D6 is `status: pending`.

2. **Deployed-origin e2e re-run**
   **Test:** Re-run `pnpm --filter web test:e2e -- team-page`, `-- no-page-pan`, `-- touch-scroll`, `-- static-shell` once this branch is pushed to `origin/main` and Cloudflare Pages redeploys.
   **Expected:** All four specs pass against the real deployed build.
   **Why human:** Independently confirmed this verification pass: local `main` (`5c8af78c`) has not been pushed — `origin/main` is still at Phase 5's `79ca50be` — and the live site's `index.html` still shows the pre-Phase-6 empty `#root`. `playwright.config.ts` has no local `webServer` and R2 CORS blocks localhost, so these specs cannot pass pre-deploy by construction, not because of a code defect.

3. **UI polish pass visual sign-off**
   **Test:** Compare the before/after screenshots in `.planning/phases/06-team-pages/screenshots/` (or the live polished page) at desktop and phone widths.
   **Expected:** The team page reads as "a serious data tool that is more alive" per the developer's own Phase 5 sign-off note, without the color going decorative.
   **Why human:** 06-09-PLAN.md's own must-have states this is judged by looking, not a token diff; all mechanical gates (additive-only theme diff, zero hex literals, elevation/tint tests) already pass.

### Gaps Summary

No must-have truths, artifacts, or key links failed. Every claim in the nine plans' SUMMARYs that could be checked against the actual codebase — schema fields, publisher wiring, live published data, the two-distinct-± separation, the end-of-event-vs-season-final metric distinction, the static shell, the tier boundary contract, requirements-to-code traceability — checked out under direct inspection, not merely by trusting the SUMMARY text. The three items above are not code gaps: they are a real-device check that could not be performed in this environment, a deploy step that has not yet happened (this branch is not on `origin/main`), and an explicitly-deferred human visual judgment call. None blocks the phase's own goal from being achieved in the codebase; all three block *full* end-to-end confidence and should be resolved before or shortly after shipping.

---

_Verified: 2026-08-25T20:10:00Z_
_Verifier: Claude (gsd-verifier)_

## Accepted Gaps

Recorded 2026-08-26, by explicit decision, so Phase 6 can close with the gap visible in the
record rather than closed by silence.

### D-10 real-device iOS Safari gesture arbitration — ACCEPTED RISK

**Status:** permanently unverifiable by this project as currently equipped. Not "deferred".

**What is unverified:** that a horizontal drag inside a team page's per-event match table scrolls
only that table on real iOS Safari, without the page panning sideways or the gesture sticking to
the wrong axis.

**Why it cannot be closed:** no iOS device is available to this project, so the check cannot be
discharged by scheduling it later. `06-UAT.md` test 2 is `blocked_by: physical-device`.

**What IS verified, and what that is worth:**

- `e2e/touch-scroll.spec.ts` and `e2e/no-page-pan.spec.ts` pass on both the `iphone-17` and
  `pixel-10` projects against the deployed origin (40/40 suite).

- Those projects drive Chromium's touch dispatcher over CDP — the `iphone-17` project explicitly
  pins `browserName: "chromium"` because `context.newCDPSession()` does not exist for WebKit.
  They exercise the iPhone's viewport, user agent and `hasTouch` flag, NOT WebKit's gesture
  arbitration.

- `06-RESEARCH.md` Pitfall 6 documents historical iOS Safari gaps for a directional
  `touch-action` inside a different-axis outer scroller. A green Chromium suite is not evidence
  about that, and re-running it never becomes evidence.

**The specific exposure:** an iOS-only regression in this interaction would land unobserved. The
defect class already shipped once in this phase and was caught at real-device sign-off, not by any
spec — so this is a demonstrated failure mode, not a theoretical one.

**Routes that would close it, if it later matters:** a hosted real-device session
(BrowserStack/Sauce Labs); a borrowed iPhone or iPad (same WebKit gesture engine); or a
deliberate re-scope of D-10 away from per-section horizontal scrolling.


## Completion exception

Phase 6 is being closed with the shared completion predicate returning `passed: false`. Recording
that plainly rather than editing the UAT until the gate agrees.

```
gsd-tools phase uat-passed 06 --require-verification
  passed: false
  blockers: ["06-UAT.md: test 2 (skipped)"]
```

**Why the gate objects:** it requires every UAT test to carry `result: pass`. Test 2 is the
real-device iOS Safari check, which carries `result: skipped` under the accepted-risk decision
above. The gate is behaving correctly — a real-device check genuinely did not happen.

**Why it is closed anyway:** the gap is an explicit, recorded decision (see "## Accepted Gaps"),
not an oversight. No iOS device exists for this project, so the test cannot be discharged by
waiting.

**What was deliberately NOT done:** test 2 was not marked `pass`. That would assert a real-device
verification succeeded, which is false, and it would erase the one honest signal that this
interaction is unverified on the platform it was written for. `skipped` was chosen over `blocked`
on accuracy grounds — `blocked` implies a prerequisite that will eventually arrive — and it does
NOT satisfy the gate either, so it was not a way around it.

**Standing consequence:** an iOS-only regression in per-section touch scrolling would land
unobserved. That remains true after this phase closes, and closing the phase does not retire it.
