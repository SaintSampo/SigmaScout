---
phase: 07-event-pages
verified: 2026-08-30T01:46:07Z
status: human_needed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Real-device touch scroll sign-off (tab strip / table region / page scroll arbitration)"
    expected: |
      On a real iOS and/or Android phone, at https://sigmascout.org/event/2023cur?tab=quals&algorithm=vpr
      (130 rows), https://sigmascout.org/event/2022mirr?tab=elims&algorithm=vpr (60 rows), and
      https://sigmascout.org/event/2024new?tab=breakdown&algorithm=vpr (16-column widest table):
      table drags move only the table, tab-strip drags move only the strip, vertical drags scroll the
      page normally, diagonal drags resolve to one axis, momentum settles without rubber-banding
      leaking into the page or pinned-column bleed-through, and Breakdown's two pinned columns stay
      opaque throughout.
    why_human: |
      Every automated drag in the 07-20 e2e suite (122/122 passing) is a synthesized Chromium CDP
      touch gesture over a real HTTP server, which 07-RESEARCH.md Pitfall 6 and 07-UAT.md both name as
      not proof of real iOS Safari's touch-action arbitration. This is deliberately deferred to a
      physical device per developer decision recorded in 07-UAT.md.
  - test: "Plot density at high row counts (look-and-decide)"
    expected: |
      At https://sigmascout.org/event/2023cur?tab=quals&algorithm=vpr, at phone width, the full
      130-row slate should still read as individual band-tick-dot groups, not as one continuous
      vertical texture, compared against a team page's ~40-row section.
    why_human: |
      A subjective visual-density judgment at a row count (up to 130) that 07-UI-SPEC.md's own E5
      backstop names as "the highest-risk item on this tab" — no automated check can substitute for a
      look-and-decide call on whether the existing match-plot geometry still reads correctly at this
      density. Deliberately deferred in 07-UAT.md.
---

# Phase 7: Event Pages Verification Report

**Phase Goal:** Users can inspect any event's teams, scoring composition, and full match slate with
predictions versus actuals
**Verified:** 2026-08-30T01:46:07Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Insights tab lists the event's teams in official TBA event rank order, showing rank, record, RPs, and auto/teleop/endgame for the selected algorithm, falling back to algorithm-order with a stated notice when no official ranking exists (SC-1, EVNT-02, D-07/D-08) | ✓ VERIFIED | `apps/web/src/components/event/InsightsTab.tsx` — `buildInsightsRows` sorts by `event_rankings.rank` when any team has one, else by VPR Total with `insightsFallbackNotice` banner rendered (`data-testid="insights-fallback-banner"`); live artifact for `2023cur` returns populated `rank`/`record`/`rp` per team |
| 2 | Breakdown tab shows every metric component per team, sorted by the selected algorithm's rank, carrying no official event rank at all (SC-2, EVNT-03, D-11) | ✓ VERIFIED | `apps/web/src/components/event/BreakdownTab.tsx` — no `rank` field on `BreakdownRow` at all (doc comment + code confirmed); columns come from `metricKeysFor(algorithmId, season)` |
| 3 | Quals tab lists every qualification match with predicted winner, confidence, and predicted scores next to actual results (SC-3, EVNT-04, D-12/D-13) | ✓ VERIFIED | `apps/web/src/components/event/QualsTab.tsx` + `eventMatchAxis.ts`'s `mergeEventMatches`/`isQualCompLevel`; live artifact confirms `redScoreVarianceOwn`/`blueScoreVarianceOwn`, `pRedWin`, actual scores all populated per match |
| 4 | Alliances tab shows each alliance's combined metrics (SC-4, EVNT-05, D-15/D-16/D-17) | ✓ VERIFIED | `AlliancesTab.tsx`'s `combineAlliancePicks` implements `σ = √(σ₁²+σ₂²+σ₃²)` over the first three picks only, all-or-nothing, no zero-defaulting; passing test "combineAlliancePicks" (6 passed); live `2023cur` artifact carries 8 populated alliances |
| 5 | Elims tab lists every elimination match with predictions next to actual results (SC-5, EVNT-06, D-14) | ✓ VERIFIED | `ElimsTab.tsx` — flat chronological list, no bracket grouping, `matchLabel()` round labels, own axis domain via `computeEventAxisDomain` |
| 6 | Every `±` on the site is one SD of full predictive variance `√(P+R)`; the D-09 consistency value is never published or displayed (D-01/D-02/D-03) | ✓ VERIFIED | `packages/core/algorithms/sigma1/index.ts:1068-1113` — `spread: Math.sqrt((belief?.variance ?? 0) + shrunkVariance)` at every aggregation level; `pageArtifacts.ts` header (~line 30) and line ~152 rewritten to the single-quantity rule; `sketch-findings-sigmascout/references/uncertainty-display.md` rewritten (D-09/D-10 two-quantity rule replaced); passing test "Test 1 (the tracer's proof)" confirms per-team spread² sums to `redScoreVarianceOwn`/`blueScoreVarianceOwn` |
| 7 | Sigma1 is renamed VPR everywhere, including the algorithm ID, with old `sigma1@…` R2 objects deleted (D-04/D-05/D-06) | ✓ VERIFIED | `PUBLISHED_ALGORITHM_IDS = ["opr","epa","vpr"]`; live manifest at `https://data.sigmascout.org/v1/manifest/algorithms.json` returns `vpr` (no `sigma1`); live fetch of a `sigma1@2.0.0+tuned-2026-08.json` key returns HTTP 404; `ALGORITHM_DISPLAY_LABELS.vpr === "VPR"` |
| 8 | ROADMAP.md SC-1 is amended to match D-07's design rather than the pre-discussion "same columns as the Teams page" wording (D-19) | ✓ VERIFIED | `.planning/ROADMAP.md` line 401 carries the amended SC-1 text with an inline `(Amended 2026-08-27 ... D-19)` note |
| 9 | Teams page Rank column is relabeled per-algorithm ("VPR Rank" / "EPA Rank" / "OPR Rank") (D-20) | ✓ VERIFIED | `teams-table/columns.tsx`: `header: \`${algorithmDisplayLabel(algorithm)} Rank\``; passing test "Test 2: opr, epa and vpr each produce a distinct leading header" |
| 10 | The published event artifact carries event identity (name/startDate/location/week), extended rankings (record + RP), per-alliance predicted-score variance, and alliance data — all live in production (D-18 items 1-8) | ✓ VERIFIED | Live fetch of `v1/event/2023cur/vpr@2.0.0+tuned-2026-08.json`: `name`, `startDate`, `location` populated; `teams[].rank/record/rp` populated; `matches[].redScoreVarianceOwn/blueScoreVarianceOwn` populated; `alliances` array present with 8 entries |
| 11 | All seven UI-SPEC backstop rows (E1 overflow/long-text, E2/E3/E4/E5/E6 overflow) have wired automated evidence, per the phase's own "obligations carried from this file" | ✓ VERIFIED | `apps/web/e2e/event-header-overflow.spec.ts` (E1) and `apps/web/e2e/event-scroll-regions.spec.ts` (E2-E6) — established e2e count 122/122 across 4 projects/9 specs holds; test titles confirm each surface's pinned-column/scroll-region/truncation assertions |
| 12 | The disabled-Alliances-tab and same-page-state-branch-order rules hold across every tab (D-17, one shared error/pending/populated branch) | ✓ VERIFIED | `event.$eventKey.tsx`'s single `renderTabState` function used by all 5 tabs; passing test "with the artifact resolved and alliances absent, the Alliances trigger is disabled..." |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/routes/event.$eventKey.tsx` | `/event/{eventKey}` route, 5-tab strip | ✓ VERIFIED | Exists, wired, all 5 `TabsContent` panels populated |
| `apps/web/src/components/event/InsightsTab.tsx` | EVNT-02 | ✓ VERIFIED | Exists, substantive, wired into route |
| `apps/web/src/components/event/BreakdownTab.tsx` | EVNT-03 | ✓ VERIFIED | Exists, substantive, wired into route |
| `apps/web/src/components/event/QualsTab.tsx` | EVNT-04 | ✓ VERIFIED | Exists, substantive, wired into route |
| `apps/web/src/components/event/AlliancesTab.tsx` | EVNT-05 | ✓ VERIFIED | Exists, substantive, wired into route |
| `apps/web/src/components/event/ElimsTab.tsx` | EVNT-06 | ✓ VERIFIED | Exists, substantive, wired into route |
| `apps/web/src/components/event/eventMatchAxis.ts` | D-12/D-13 shared axis + merge logic | ✓ VERIFIED | Exists, used by Quals/Elims, own test file |
| `packages/harness/pageArtifacts.ts` (`EventArtifactSchema` etc.) | D-18 schema additions | ✓ VERIFIED | `name`/`startDate`/`location`/`week`/`alliances`/`redScoreVarianceOwn` all present in schema and in live published data |
| `packages/corpus/schema.sql` (`event_alliances`) | D-18 item 7 corpus table | ✓ VERIFIED | `CREATE TABLE IF NOT EXISTS event_alliances` present; 10,290 rows across 1,355 events per COVERAGE.md's measured pass |
| `packages/ingest/tbaClient.ts` (`fetchEventAlliances`) | D-18 item 7 ingest | ✓ VERIFIED | Named in COVERAGE.md, full 5-season live pass measured (1,586 requests, 223.1s) |
| `.claude/skills/sketch-findings-sigmascout/references/uncertainty-display.md` | D-03 rewrite | ✓ VERIFIED | Two-quantity rule replaced with single `√(P+R)` rule |
| `docs/publish-budget.md` | D-18 re-measurement obligation | ✓ VERIFIED | Latest run section dated 2026-08-29, generation `961340e8-...`, D-06 delete pass section present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `event.$eventKey.tsx` | `eventQueryOptions` / R2 artifact | `useQuery(eventQueryOptions(...))` | WIRED | Fetch + Zod-validate + TanStack Query pattern, mirrors `team.ts` |
| `AlliancesTab.tsx` | `EventArtifactSchema.alliances` | `buildAllianceRows(artifact, algorithmId)` | WIRED | Live data confirms non-empty `alliances` array reaches the tab |
| `sigma1/index.ts` spread | `pageArtifacts.ts` `TeamMetric.spread` | `publish.ts` assembly path (unchanged pass-through) | WIRED | Live published `spread` values (e.g. `total.spread: 3.84` for a real team) are non-trivial and vary per team, consistent with `√(P+R)` rather than a constant |
| `teams-table/columns.tsx` Rank header | `algorithmDisplayLabel` | Direct function call, no literal | WIRED | Single source of truth confirmed; used identically by Insights/Breakdown/Alliances captions |
| `packages/ingest/cli.ts` alliances ingest | `packages/corpus` `event_alliances` table | `ingestSeasonAlliancesOnly` | WIRED | COVERAGE.md's measured-cost section shows real row counts written per season |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| D-01 spread additivity identity (three teams' TOTAL spread² sums to alliance `redScoreVarianceOwn`/`blueScoreVarianceOwn`) | `npx vitest run packages/core/algorithms/sigma1/sigma1.test.ts -t "Test 1"` | 2 passed | ✓ PASS |
| D-15/D-16 alliance combined-value arithmetic (`√(σ₁²+σ₂²+σ₃²)`, all-or-nothing, no backup in sum) | `npx vitest run apps/web/src/components/event/AlliancesTab.test.tsx -t "combineAlliancePicks"` | 6 passed | ✓ PASS |
| D-20 per-algorithm Rank header rename | `npx vitest run apps/web/src/components/teams-table/columns.test.tsx -t "Test 2"` | 1 passed | ✓ PASS |
| D-17 disabled Alliances trigger derivation | `npx vitest run apps/web/src/routes/event.$eventKey.test.tsx -t "with the artifact resolved and alliances absent"` | 1 passed | ✓ PASS |
| VPR rename reaches production (no `sigma1@` keys resolve) | `curl -s -o /dev/null -w "%{http_code}" https://data.sigmascout.org/v1/event/2023cur/sigma1@2.0.0+tuned-2026-08.json` | 404 | ✓ PASS |
| Published event artifact carries all D-18 fields with real values | `curl` of `v1/event/2023cur/vpr@2.0.0+tuned-2026-08.json`, inspected in Node | name/startDate/location, teams[].rank/record/rp, matches[].redScoreVarianceOwn/blueScoreVarianceOwn, alliances[8] all populated | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| EVNT-02 | 07-02,04,05,06,07,08,09,10,11,15,17,19,20 | Insights tab, official-rank order with fallback | ✓ SATISFIED | `InsightsTab.tsx`, live artifact data |
| EVNT-03 | 07-01,06,09,10,15,17,19,20 | Breakdown tab, per-team component detail, no rank | ✓ SATISFIED | `BreakdownTab.tsx` |
| EVNT-04 | 07-07,08,10,12,17,19,20 | Quals tab, match predictions vs actuals | ✓ SATISFIED | `QualsTab.tsx`, `eventMatchAxis.ts` |
| EVNT-05 | 07-02,03,05,06,07,08,10,14,17,19,20 | Alliances tab, combined metrics | ✓ SATISFIED | `AlliancesTab.tsx`, live 8-alliance data |
| EVNT-06 | 07-07,08,10,13,17,19,20 | Elims tab, match predictions vs actuals | ✓ SATISFIED | `ElimsTab.tsx` |

No orphaned requirements — `.planning/REQUIREMENTS.md` maps exactly EVNT-02…06 to Phase 7, all five accounted for across plans.

### Anti-Patterns Found

None. Scanned all `apps/web/src/components/event/*`, the event route, `pageArtifacts.ts`, `publish.ts`, `sigma1/index.ts`, `ingest/cli.ts`, and `ingest/schemas.ts` for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches outside test files.

**Non-blocking observations (not gaps against this phase's must-haves):**

- `07-VALIDATION.md` was seeded in draft form at plan time (`status: draft`, `nyquist_compliant: false`, all Wave-0/per-task checkboxes unchecked) and was never updated during execution to reflect that every named test file it lists (`InsightsTab.test.tsx`, `BreakdownTab.test.tsx`, `eventMatchAxis.test.ts`, `AlliancesTab.test.tsx`, `ElimsTab.test.tsx`) does exist and pass. This is a documentation-completeness gap in the phase's own audit trail, not evidence of missing functionality — independently confirmed above via direct test execution and live-data inspection.
- WINDOWS.md ledger #14 (2024orbb/2025orbb non-integer RP) is marked `status: open` even though its own description states the fix landed and was verified (30→0 non-integer rows) — likely a bookkeeping oversight rather than an unresolved defect, but flagged for the developer's ledger hygiene.

### Human Verification Required

1. **Real-device touch scroll sign-off** — On a real iPhone and/or Android device, confirm the six touch-arbitration checks in `07-UAT.md` Test 1 across the three named URLs (Quals 130-row, Elims 60-row, Breakdown 16-column). Deliberately deferred — every automated equivalent is a synthesized Chromium CDP gesture, not real iOS Safari touch-action arbitration.
2. **Plot density at high row counts** — Visual look-and-decide check of the Quals tab's 130-row slate at phone width against a team-page reference, per `07-UAT.md` Test 2.

### Gaps Summary

No gaps found against the phase's must-haves. All five roadmap Success Criteria (EVNT-02…06), all cross-cutting decisions (D-01 through D-21), all nine D-18 pipeline items, and all seven UI-SPEC backstop rows are implemented, wired, and confirmed against live production data and passing named tests. The two items withholding a `passed` verdict are explicitly-deferred, developer-acknowledged human checkpoints (real-device touch behavior and a subjective density judgment) recorded in `07-UAT.md` — not defects discovered during this verification. The accepted regressions (`payloadBudget.test.ts`'s two failures, WINDOWS.md ledger #11/#15) and the tracked-but-not-yet-executed `remeasure-accuracy-record-offseason-inclusion` todo are both genuinely tracked open items, not silently dropped work, and are outside this phase's own must-have scope.

---

*Verified: 2026-08-30T01:46:07Z*
*Verifier: Claude (gsd-verifier)*
