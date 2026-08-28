---
phase: 07-event-pages
plan: 14
subsystem: ui
tags: [react, tanstack-router, tanstack-table, event-pages, alliances, uncertainty]

requires:
  - phase: 07-event-pages (07-01)
    provides: "The /event/$eventKey route, the { artifact, algorithmId, season } tab prop contract, REGISTERED_EVENT_TABS narrowing, the three-independent-scroll-regions pattern"
  - phase: 07-event-pages (07-06)
    provides: "TeamMetric.spread redefined to √(P+R) — the per-team total predictive standard deviation this tab sums; without it this tab's arithmetic would have been the wrong quantity"
  - phase: 07-event-pages (07-07)
    provides: "EventAllianceSchema (allianceNumber, optional name, picks[]) and EventArtifactSchema.alliances — the published shape this tab reads"
  - phase: 07-event-pages (07-10)
    provides: "The real published subset this tab was verified against, plus the routed 2025isios empty-alliances finding"
  - phase: 07-event-pages (07-11)
    provides: "renderTabState — the route's one shared page-state branch order, reused unchanged as this tab's fifth caller"
  - phase: 07-event-pages (07-13)
    provides: "The route file as 07-13 left it, including the comment asking this plan to insert Alliances between Quals and Elims, and the unregistered-tab probe this plan finally retires"
provides:
  - "apps/web/src/components/event/AlliancesTab.tsx — the EVNT-05 alliances table, the D-15/D-16 combined arithmetic as a pure exported function (combineAlliancePicks), the D-15 independence caveat, the incomplete-combination notice, hasAllianceData (D-17), and the pending skeleton"
  - "apps/web/src/routes/event.$eventKey.tsx — 'alliances' registered between Quals and Elims (the last of EVENT_TABS' five ids), D-17's disabled-trigger predicate computed only from a genuinely resolved artifact, and the disabled-tab-resolves-to-default extension"
affects: [07-15-event-header, 07-17-republish-and-vpr-rename, 07-18-default-tab-flip, 07-20-real-device-overflow-pass]

actuals:
  tokens: 17600
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "This is the ONE component in the app that computes a number from published values rather than rendering one — legitimate here because an alliance's cross-team covariance is zero by the model's own construction (sigma1/covariance.ts's header), unlike a component group's real, unpublished off-diagonal terms"
    - "All-or-nothing combination: combineAlliancePicks returns undefined unless all three of the first three picks resolve a published total — never a partial sum over the present subset, proven against both measured causes (a sub-three-pick alliance and a pick with no metrics row)"
    - "Two independent absence rules over one cell: the value needs all three totals; the ± needs all three spreads on top of that — mirrors 07-07's PD-04 value/spread separation at the render boundary"
    - "A disabled tab id resolves to DEFAULT_EVENT_TAB by extending 07-01's existing REGISTERED_EVENT_TABS narrowing rather than adding a second resolution mechanism — resolve only, never navigate"

key-files:
  created:
    - apps/web/src/components/event/AlliancesTab.tsx
    - apps/web/src/components/event/AlliancesTab.test.tsx
  modified:
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx

key-decisions:
  - "The Combined Total is all-or-nothing over exactly three resolved terms — never a partial sum (plan Decision 1). A sub-three-pick alliance needs no special case: it has no third position, so the third position simply does not resolve."
  - "The value's absence and the spread's absence are two independent rules over the same cell (plan Decision 2) — a summed value with two of three spreads present renders bare, never suppressed."
  - "A muted incomplete-combination notice renders beneath the independence caveat whenever at least one row cannot combine (plan Decision 3) — minted under CONTEXT.md's Claude's Discretion clause since UI-SPEC's Copywriting Contract has no row for it."
  - "The trigger's disabled state is computed only from a genuinely resolved artifact for this event key (not pending, not errored, not placeholder data), and a disabled tab id resolves to the default without navigating (plan Decision 4)."
  - "The table gets a horizontal scroll region even though UI-SPEC dismisses E7 overflow (plan Decision 5) — four of six columns carry both a team number and a nickname, the widest cell content on any tab this phase."
  - "The unregistered-tab probe test (carried since 07-01, moved tab-to-tab through 07-12/07-13) is retired, not moved — alliances was the LAST unregistered id in EVENT_TABS, so no unregistered id remains for a future plan to inherit the probe."

requirements-completed: [EVNT-05]

coverage:
  - id: D1
    description: "AlliancesTab.tsx renders one row per published alliance in TBA's own seed order with six columns (Alliance # / Captain / Pick 2 / Pick 3 / Backup / Combined Total); combineAlliancePicks sums the first three picks' values and computes σ = √(σ₁²+σ₂²+σ₃²), proven against the D-15 worked example (30.00 ± 17.32, never ± 30.00) and an exact-integer fixture (spread exactly 13.00 from 3/4/12)"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#combineAlliancePicks — D-15 combination arithmetic (EVNT-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Combined Total is all-or-nothing over exactly three resolved terms — a two-pick alliance (modelled on 2022vabrb/2024vabrb), a one-pick alliance, and a pick whose team has no teams row (modelled on 2024cmptx) all render an em-dash through the same rule, never a partial sum; the value/spread absence rules are independently tested"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#AlliancesTab — the all-or-nothing rule, both measured causes (EVNT-05 empty)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The incomplete-combination notice renders beneath the D-15 independence caveat exactly when at least one alliance cannot combine, naming the count/total/algorithm label with correct singular/plural forms; the Combined Total column never carries a tier box (grep-gated: zero tierForPercentile references, zero tier= assignments) even under a percentile-99 fixture"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#AlliancesTab — the incomplete-combination notice (Claude's Discretion, no UI-SPEC row) / AlliancesTab — six-column anatomy (EVNT-05, D-15/D-16)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Adjacency and identity: two alliances sharing an allianceNumber (or an equal Combined Total) stay two separate rows in a total order that never depends on sort stability; a five-pick alliance renders both backup entries; a pick with no teams row keeps its number and loses only its nickname; a 60-char nickname truncates by CSS with the full string in title"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#AlliancesTab — ordering, adjacency and identity (EVNT-05 adjacency)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-17: the Alliances trigger is Radix-disabled with no copy of any kind on exactly the events whose artifact carries an absent or empty alliance array, computed only once the artifact for THIS event key has genuinely resolved (never during pending/error/placeholder-data states, proven via a real router.navigate to a second event key exercising keepPreviousData), and a shared ?tab=alliances link on a disabled event resolves to the default tab without navigating"
    requirement: EVNT-05
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#the Alliances tab registered, D-17 disabled trigger (07-14-PLAN.md Task 3)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The √(σ₁²+σ₂²+σ₃²) versus √redScoreVarianceOwn identity across this tab and an elimination match playing the same three teams — authored as a backstop per the plan's own flagged assumption 4, since it needs a real republished artifact carrying both quantities for the same three teams (arrives with 07-10's subset and fully with 07-17) and a strict equality assertion would be wrong given the rounding/fourth-pick differences"
    verification: []
    human_judgment: true
    rationale: "Cannot be proven by a fixture without restating the formula; requires a real republished artifact this plan does not own producing. Routed per the plan's own backstop marker."
  - id: D7
    description: "The two-pick alliance contract exercised against a real published artifact (not only a fixture) — 2022vabrb/2024vabrb are re-confirmed live in this plan's own verification (both print 'ok': 5 alliances, each 2 picks, no name key) but neither event publishes an artifact today (offseason, reachable only once 07-09's flag is used in a publish run this plan does not own)"
    verification: []
    human_judgment: true
    rationale: "Live TBA re-confirmation is complete and recorded below; proving the RENDERED page against a real artifact for these two events depends on a publish run outside this plan's scope, per the plan's own flagged assumption 1."

duration: ~25min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 14: Alliances Tab Summary

**The EVNT-05 Alliances tab: `combineAlliancePicks` sums the first three picks' means and computes σ = √(σ₁²+σ₂²+σ₃²) — never the sum of standard deviations — with an all-or-nothing absence rule proven against both measured causes (a sub-three-pick alliance and a pick with no metrics row), D-15's independence caveat rendered unconditionally, and D-17's plain-disabled trigger wired only once the artifact for the current event key has genuinely resolved.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 of 3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `AlliancesTab.tsx` exists: `combineAlliancePicks` is the pure D-15 combination — RED was observed with the wrong formula (`30.00`/`19` from summing standard deviations) before the correct sqrt-of-summed-variances formula landed (`17.32`/`13`), quoted below under Baseline/Verification.
- The all-or-nothing rule is proven against both measured causes: a sub-three-pick alliance (modelled on `2022vabrb`/`2024vabrb`'s five two-pick alliances) and a pick whose team has no `teams` row (modelled on the live `2024cmptx` shape, where `frc9432` sits at the third pick of one alliance). Both render an em-dash Combined Total through the identical rule, never a two-term sum.
- The value's absence and the spread's absence are proven as two independent rules: a fully-resolved three-team sum with only two published spreads renders the bare summed value with no `±` suffix.
- The incomplete-combination notice (`alliancesIncompleteNotice`, Claude's Discretion — no UI-SPEC Copywriting Contract row exists for it) renders beneath the D-15 independence caveat exactly when at least one alliance cannot combine, with correct singular/plural forms, naming the incomplete count, the total, and the selected algorithm's label.
- The Combined Total column never carries a tier box under any fixture, including one where all three picks publish a percentile of 99 — grep-gated at zero `tierForPercentile` references and zero `tier=` assignments over code lines.
- Adjacency and identity: two alliances sharing an `allianceNumber` (or an equal Combined Total) render as two separate rows in a total order that never depends on sort stability (tie-broken by first-pick team key); a five-pick alliance renders both backup entries; a pick with no `teams` row keeps its team number as a link and loses only its nickname.
- D-17's disabled trigger is computed only from a genuinely resolved artifact for the CURRENT event key — proven via a real `router.navigate` to a second event key that exercises `placeholderData: keepPreviousData`, confirming the previous event's alliance array never decides the new event's trigger state while its own fetch is in flight.
- A shared `?tab=alliances` link to an event whose alliances are absent resolves to the default (`breakdown`) panel without navigating — the URL's `tab` search param stays `alliances` after render, proving the resolution rather than a rewrite.
- `event.$eventKey.tsx`: `"alliances"` registered between Quals and Elims — the fifth and last of `EVENT_TABS`' ids, closing out the phase's tab registration entirely.

## Task Commits

Each task was committed atomically (RED observed before implementation for Task 1's numeric fixtures, brought to GREEN within the same task commit):

1. **Task 1: Tracer — one real alliance shows a real combined total** - `1d56c669` (feat)
2. **Task 2: The all-or-nothing rule, the sub-three-pick contract, the incomplete-combination notice** - `1094c952` (feat)
3. **Task 3: D-17 — the plain-disabled trigger and a shared link to a disabled tab** - `052e1194` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `apps/web/src/components/event/AlliancesTab.tsx` - `AlliancesTab`, `AlliancesTabSkeleton`, `AlliancesTabProps`, `AlliancePick`, `AllianceRow`, `buildAllianceRows`, `combineAlliancePicks`, `hasAllianceData`, `alliancesIncompleteNotice`, `ALLIANCE_COMBINED_PICK_COUNT`, `ALLIANCES_INDEPENDENCE_CAVEAT`, `ALLIANCES_SKELETON_ROW_COUNT`
- `apps/web/src/components/event/AlliancesTab.test.tsx` - 07-VALIDATION.md's Wave 0 EVNT-05 test file (75 tests: combination arithmetic, ordering, six-column anatomy, the all-or-nothing rule from both measured causes, the incomplete notice, adjacency/identity, `hasAllianceData`)
- `apps/web/src/routes/event.$eventKey.tsx` - `alliances` registered in `REGISTERED_EVENT_TABS`, trigger + `TabsContent` behind `renderTabState`, `isAlliancesDisabled` computed from `isPlaceholderData`/`isPending`/`error`/`hasAllianceData`, `resolveActiveTab` extended with the disabled-tab-resolves-to-default term
- `apps/web/src/routes/event.$eventKey.test.tsx` - the unregistered-tab probe retired and replaced with a real registration assertion, the two "N tabs" assertions updated from four to five, and a new "Alliances tab registered, D-17 disabled trigger" describe block (11 tests: absent/empty/populated disabled states, pending/errored/placeholder-data not-disabled states including a real cross-event `router.navigate`, disabled-tab-resolves-to-default without navigating, click-preserves-params, sibling-scroll containment, shared 404/500/pending expectations against `?tab=breakdown`)

## Decisions Made

See `key-decisions` in the frontmatter above for the full list (mirrors the plan's own Decisions 1-5 verbatim, plus one execution-time finding: the unregistered-tab probe is retired rather than moved, since this plan registers the last previously-unregistered id).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing route tests invalidated by registering the fifth (and final) tab**
- **Found during:** Task 1's route registration, discovered running the full `event.$eventKey.test.tsx` suite
- **Issue:** Two pre-existing tests asserted `?tab=alliances` (the standing "unregistered tab" probe carried since 07-01, moved through 07-12/07-13) resolves to the Breakdown panel. Once this plan registers `"alliances"`, that premise is false — and worse, both tests passed VACUOUSLY even before the fix, because they asserted only that `breakdown-panel` was `.toBeDefined()` (present in the DOM, which Radix guarantees for every mounted `TabsContent` regardless of which is active) rather than checking the `hidden` attribute this file's own established convention uses elsewhere.
- **Fix:** Rewrote both tests to assert the new true behavior — `?tab=alliances` renders the Alliances panel as the active one (`hidden` false) with Breakdown inactive (`hidden` true). Also updated the two "four tabs" assertions to "five tabs" (`Insights, Breakdown, Quals, Alliances, Elims`). Since alliances was the LAST unregistered id in `EVENT_TABS`, the probe is retired rather than moved to a new id — there is no unregistered id remaining for a future plan to inherit it, unlike the 07-12→07-13 handoff.
- **Files modified:** `apps/web/src/routes/event.$eventKey.test.tsx`
- **Verification:** Full route test file green (40/40) after the correction; `pnpm --filter web test` green across the whole web suite (45/45 files, 593/593 tests).
- **Committed in:** `1d56c669` (Task 1 commit)

**2. [Rule 1 - Bug] A JSX block comment's continuation line collided with Task 3's own no-Tooltip/no-aria-describedby grep gate**
- **Found during:** Task 3, running the acceptance-criteria grep gates after wiring the disabled trigger
- **Issue:** A `{/* ... */}` doc comment explaining D-17's treatment spelled out `aria-describedby` on a continuation line that does not start with `//`/`*`/`/*`, so the plan's own comment-excluding grep (`grep -v '^[[:space:]]*\(//\|\*\|/\*\)' ... | grep -cE 'Tooltip|aria-describedby'`) counted it as code, reading 1 instead of the required 0.
- **Fix:** Reworded to "accessible-description reference" — identical meaning, no literal substring collision. Mirrors the established 07-07/07-13 precedent for the same class of gate-vs-comment collision.
- **Files modified:** `apps/web/src/routes/event.$eventKey.tsx`
- **Verification:** The grep gate now reads 0; `event.$eventKey.test.tsx` stayed green throughout.
- **Committed in:** `052e1194` (Task 3 commit)

**3. [Rule 1 - Bug] Dead code left over from an earlier draft**
- **Found during:** Task 2, reviewing the file before adding the two prohibition comments
- **Issue:** An unused `byTeamNumberAscending` helper was declared in Task 1's draft (the actual tie-break is by first-pick team key, per D-15's adjacency rule) but never called.
- **Fix:** Removed it.
- **Files modified:** `apps/web/src/components/event/AlliancesTab.tsx`
- **Verification:** `pnpm --filter web typecheck` clean; all tests stayed green.
- **Committed in:** `1094c952` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes for test/gate collisions foreseeably caused by this plan's own registration work, 1 dead-code cleanup)
**Impact on plan:** All three fixes were required for correctness of the plan's own stated verification gates; neither changed shipped behavior beyond what the plan specified. No scope creep.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

None - no external service configuration required.

## Baseline / Verification

- **Pre-plan baseline:** `event.$eventKey.tsx` had `REGISTERED_EVENT_TABS` at four ids (`insights, breakdown, quals, elims`) and `renderTabState` called four times; `pageArtifacts.ts` already declared `EventAllianceSchema` (from 07-07). `InsightsTab.test.tsx` (49), `QualsTab.test.tsx` (11), `ElimsTab.test.tsx` (32) all green.
- **RED evidence quoted, Task 1:** with `combineAlliancePicks` implemented to sum standard deviations (the intentionally-wrong first draft), the D-15 worked example failed `expected '30.00' to be '17.32'` and the exact-integer fixture failed `expected 19 to be 13` — both numeric mis-formula failures, never a module-not-found error, per the plan's own acceptance criterion.
- **Post-plan verification:** `pnpm --filter web typecheck` clean; `pnpm --filter web test` green (45/45 files, 593/593 tests); `pnpm vitest run apps/web/src/components/event/AlliancesTab.test.tsx` green (75/75, 0 skipped); `pnpm vitest run apps/web/src/routes/event.$eventKey.test.tsx` green (40/40) with every pre-existing 07-01/07-11/07-12/07-13 assertion still passing (aside from the two corrected in Deviation 1); `InsightsTab.test.tsx`/`QualsTab.test.tsx`/`ElimsTab.test.tsx` stayed byte-identical (`git diff --numstat` empty against `HEAD~3`) and green throughout (49/11/32 unchanged).
- **All grep-gated acceptance criteria pass:** zero `tierForPercentile` references, zero `tier=` assignments, exactly one `Math.sqrt` call, zero `artifact.matches`/`artifact.upcoming` reads, zero `dangerouslySetInnerHTML`, zero `(total|spread|value) ?? 0` defaults, zero `Tooltip`/`aria-describedby` references on the disabled trigger, `isPlaceholderData`/`hasAllianceData` each referenced at least once in the route.
- **Live-data proofs, all print `ok`, no credential printed or interpolated (all loaded via `set -a; . ./.env; set +a`):**
  - Task 1: `2024cmptx`'s alliances endpoint confirms 8 alliances, all 4 picks, and `picks[2]` of alliance index 2 is `frc9432`; the published `sigma1@2.0.0+tuned-2026-08` artifact for the same event confirms `frc9432` is absent from `teams` while `frc1690` is present — the missing-metrics-row case is real, not invented.
  - Task 2: `2022vabrb` and `2024vabrb` each re-confirmed live — exactly 5 alliances, every one with exactly 2 picks, none carrying a `name` key.
  - Task 3: `2025bc`'s alliances endpoint returns `[]` (empty array); `2022ispr`'s returns a `null` body — the two absences D-17 deliberately collapses, both real.

## Next Phase Readiness

- `AlliancesTab`'s `{ artifact, algorithmId, season }` contract and its route registration are complete to EVNT-05/D-15/D-16/D-17. All five tabs (`Insights, Breakdown, Quals, Alliances, Elims`) are now registered — this is the LAST plan in the phase's tab-registration sequence.
- `DEFAULT_EVENT_TAB` still reads `breakdown` and `apps/web/src/lib/searchParams.ts` is byte-identical to before this plan (`git diff --numstat` empty) — the `breakdown`-to-`insights` flip stays 07-18's, as planned.
- **WINDOWS.md ledger #13 is NOT resolved by this plan and stays `open`.** It names `scripts/verifySubsetPublish.ts`'s committed `expectAlliances:populated` seed value for `2025isios`, which this plan's tasks (all scoped to `apps/web/src/components/event/AlliancesTab.{tsx,test.tsx}` and `apps/web/src/routes/event.$eventKey.{tsx,test.tsx}`) never touch or read. `2025isios`'s empty-alliances state is nonetheless correctly handled by this plan's own D-17 logic (an empty array disables the trigger, proven by this plan's own `hasAllianceData([])` test case) — what remains unresolved is only the SEED FILE's stale expectation value, a scripts-directory bookkeeping fact outside this plan's declared file scope. Left open, explicitly, per the inherited-ledger-item instruction: not silently expanded into scope, not silently dropped.
- **Two backstop items, both flagged by the plan itself and not owned by this plan:** (D6) the `√(σ₁²+σ₂²+σ₃²)` vs `√redScoreVarianceOwn` cross-check needs a real republished artifact carrying both quantities for the same three teams (07-10's subset and fully 07-17); (D7) the two-pick alliance contract's RENDERED-page proof against a real artifact needs `2022vabrb`/`2024vabrb` included in a publish run using 07-09's offseason flag, which this plan does not own (07-14-PLAN.md's own flagged assumption 1 recommends this to 07-10's owner, already landed by the time this plan executed — routing forward rather than backward since 07-10 already shipped without it).
- Requirement `EVNT-05` marked complete in REQUIREMENTS.md by this plan (the rendered Alliances tab), matching the established EVNT-02/EVNT-04/EVNT-06 precedent (07-11/07-12/07-13).
- The phase's remaining known ordinary work: 07-15 (event header), 07-16 (rename sweep), 07-17 (republish + VPR rename), 07-18 (default-tab flip to `insights`), 07-19 (destructive delete pass), 07-20 (real-device overflow backstop pass, which now also owns this plan's decision 5 scroll-region addition and both of this plan's own live-data-dependent backstop items).

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED
