---
phase: 08-simulation-compare
plan: 09
subsystem: ui
tags: [react, tanstack-router, radix-tabs, zod, event-page, simulation]

requires:
  - phase: 08-simulation-compare (plan 08-05)
    provides: "Production republish — redRpPmf/blueRpPmf and actualRedRp/actualBlueRp live on every played EventMatchSchema row (56,774 objects, generation e2d220d9), plus the Republish ledger this plan calibrates its unavailable-state branch against"
provides:
  - "EVENT_TABS grown to its sixth and final id, `simulation`, in searchParams.ts — DEFAULT_EVENT_TAB provably unchanged"
  - "REGISTERED_EVENT_TABS grown to six in event.$eventKey.tsx; resolveActiveTab takes a named-field options object (PD-01) with a new simulation branch"
  - "The D-04 plain-disabled Simulation TabsTrigger, gated only on the resolved algorithm search param (never query state) — Phase 7 D-17's treatment reused verbatim"
  - "SimulationTab.tsx — the panel shell: three distinguishable states (zero-qm empty, no-pmf unavailable, pre-run placeholder), the exported pmf-presence predicate hasSimulatableRankInputs, SIMULATION_ALGORITHM_ID, and the layout stack testid 08-11/08-13/08-14 each mount into"
  - "Two new Copywriting Contract strings (SIMULATION_UNAVAILABLE_HEADING/BODY), minted by this plan and flagged for a future ui-phase pass to adopt"
affects: [08-11, 08-13, 08-14, 08-15]

actuals:
  tokens: 12200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "resolveActiveTab's named-field options object (PD-01) rather than a second positional boolean — a module-private function with one call site, so a transposition between two adjacent booleans becomes a compile error instead of a silent wrong-tab bug"
    - "A tab's disabled boolean is EITHER a data claim (isAlliancesDisabled, gated on resolved/non-placeholder query state) OR an algorithm-only claim (isSimulationDisabled, gated on nothing but the already-resolved search param) — the two are never conflated"

key-files:
  created:
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
  modified:
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx

key-decisions:
  - "hasSimulatableRankInputs reads artifact.matches/artifact.upcoming directly (PD-05), never the merged EventMatchRow — that shared Phase 7 type deliberately carries no pmf pair"
  - "The predicate answers the CLASS question only (PD-06: is this event in the pmf-bearing class at all), never per-row completeness after a chosen start match — that sharper question is routed to 08-11's simulationInputs.ts"
  - "The unavailable-state copy states the observable fact first and hedges the cause (PD-04) — EventArtifactSchema carries no eventType, so the component cannot confirm offseason is the reason for any individual event, only that it is the usual one across the corpus"
  - "The pre-run state renders as a plain muted paragraph, not the canonical EmptyState (UI-SPEC S3 empty) — nothing failed, there is simply no simulation output yet, and a centred empty-state block would replace the picker/run-control 08-11/08-13 mount above it"

patterns-established:
  - "A minted Copywriting Contract string discovered mid-phase (not present in the signed-off UI-SPEC) gets its exact text fixed in the plan's own <action> block and flagged for a future ui-phase pass to formally adopt, rather than left as an executor improvisation"

requirements-completed: [EVNT-07]

coverage:
  - id: D1
    description: "The event page exposes exactly six tabs (Insights, Breakdown, Quals, Alliances, Elims, Simulation) in that order, all rendering from first paint before any artifact resolves"
    requirement: "EVNT-07"
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#the strip exposes exactly six elements with role tab, named Insights, Breakdown, Quals, Alliances, Elims and Simulation in that order"
        status: pass
    human_judgment: false
  - id: D2
    description: "EVENT_TABS is the six-id tuple ending in simulation; EventSearchSchema round-trips ?tab=simulation and falls back to insights on anything bogus; DEFAULT_EVENT_TAB is provably still insights"
    requirement: "EVNT-07"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/searchParams.test.ts#EVENT_TABS is the six fixed ids in UI-SPEC order, with the default's id first and 'simulation' last"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/searchParams.test.ts#DEFAULT_EVENT_TAB is still exactly 'insights' and is NOT the last element of EVENT_TABS"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Simulation trigger is disabled when and only when the resolved algorithm is not VPR, carries disabled and nothing else (no title/aria-label/aria-describedby), and its boolean is derived without reading query state (proven by the permanently-pending contrast against isAlliancesDisabled)"
    requirement: "EVNT-07"
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#with the artifact fetch left permanently pending, ?algorithm=opr renders a DISABLED Simulation trigger"
        status: pass
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#in that same permanently-pending ?algorithm=opr render, the Alliances trigger is still ENABLED while Simulation is disabled"
        status: pass
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#the disabled Simulation trigger has no title, no aria-label and no aria-describedby, and its textContent is exactly 'Simulation'"
        status: pass
    human_judgment: false
  - id: D4
    description: "?tab=simulation on a non-VPR algorithm resolves to Insights without navigating and without rewriting the search param"
    requirement: "EVNT-07"
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#?algorithm=opr&tab=simulation renders the Insights panel as the visible one while the Simulation panel is present and hidden, and the URL's tab search param still reads 'simulation' afterwards"
        status: pass
    human_judgment: false
  - id: D5
    description: "SimulationTab renders three distinguishable states, including a real unavailable state for an event whose qualification matches carry no ranking-point distributions (the 08-05-measured offseason gap), confirmed against real production bytes in both directions"
    requirement: "EVNT-07"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#renders the UNAVAILABLE state (not the empty state) when qualification matches exist but carry no pmf anywhere"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#hasSimulatableRankInputs — full seven-case predicate coverage"
        status: pass
      - kind: other
        ref: "node -e fetch check against https://data.sigmascout.org/v1/event/2024wvrox/vpr@2.1.0+tuned-2026-08.json (135 qm rows, 0 both-pmf) and .../2024new/... (125 qm rows, 125 both-pmf)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No Web Worker is constructed anywhere in this plan, and the five pre-existing tabs are behaviourally unchanged"
    requirement: "EVNT-07"
    verification:
      - kind: other
        ref: "grep -nE 'new Worker' and grep -nE \"from ['\\\"].*workers/\" over SimulationTab.tsx — both zero matches"
        status: pass
      - kind: unit
        ref: "npx vitest run apps/web/src — 881/881 passing, 0 failing, identical to the pre-edit baseline's 0-failing set"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 09: The sixth tab exists end to end — URL contract, D-04 disabled trigger, three-state panel shell Summary

**Grew `EVENT_TABS`/`REGISTERED_EVENT_TABS` to six ids ending in `simulation`, wired D-04's plain-disabled trigger (query-independent, unlike Alliances' D-17), and shipped `SimulationTab.tsx` with three honest states — including the no-pmf "unavailable" state 08-05 discovered on real offseason bytes, confirmed here against production R2 in both directions (2024wvrox: 135 qm rows/0 pmfs; 2024new: 125 qm rows/125 pmfs).**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-31T17:42:00Z (baseline capture)
- **Completed:** 2026-08-31T21:51:48Z
- **Tasks:** 3 (all `type="auto" tdd="true"`/`type="auto"`)
- **Files modified:** 6 (2 new, 4 modified)

## Baseline Capture (recorded before Task 1)

1. **08-05 landed.** `.planning/phases/08-simulation-compare/08-05-SUMMARY.md` exists with a `## Republish ledger` section. Its three labelled lines, quoted verbatim:
   - **RP-eligible events with pmfs, one per season:** "2022 -> `2022ilpe` (70/70); 2023 -> `2023cur` (130/130) and `2023nhgrs` (52/52); 2024 -> `2024casf` (72/72) and `2024new` (125/125); 2025 -> `2025flta` (63/63); 2026 -> `2026vache` (60/60). All five seasons covered, every count exactly matches its own `playedQmRowCount`."
   - **Events publishing NO pmfs and why:** "(a) offseason (`event_type` 99, `isRpEligibleEventType` excludes it): `2022mirr`, `2023cnsh`, `2024vabrb`, `2024wvrox`, `2025isios`, `2025bc`, `2026wvrox`, `2024auwarp` -- 8 entries, all report `playedQmBothPmfCount: 0` while still carrying `actualRedRp`/`actualBlueRp` on every played row. (b) algorithm-level, regardless of event type: `2024casf/opr` and `2024casf/epa` -- neither OPR nor EPA models ranking points at all."
   - **D-12's fallback case:** "`2024auwarp` -- 47 played `qm` rows, `actualRedRp`/`actualBlueRp` present (key-count 47, zero nulls) on all of them, **zero teams carrying `rp`**."
2. **Both edit sites confirmed still the pre-phase five-id tuple:**
   - `grep -n 'EVENT_TABS = ' apps/web/src/lib/searchParams.ts` → `229:export const EVENT_TABS = ["insights", "breakdown", "quals", "alliances", "elims"] as const;`
   - `grep -n 'REGISTERED_EVENT_TABS' apps/web/src/routes/event.$eventKey.tsx` → `43:const REGISTERED_EVENT_TABS: readonly EventTab[] = ["insights", "breakdown", "quals", "alliances", "elims"];`
3. **Pre-edit failing-test-name set:** `npx vitest run apps/web/src` → **57 test files passed (57), 858 tests passed (858)**. The failing-test-name set is EMPTY — no baseline failures to preserve or compare against.
4. **e2e tab list confirmed a local constant with no count assertion.** `apps/web/e2e/event-scroll-regions.spec.ts:47` declares `const TABS = [...]` (five elements) and iterates it at line 220; no `toHaveLength`/count assertion anywhere in the file. File was not touched by this plan.

## Accomplishments

- `EVENT_TABS` grows to the six-id tuple `["insights", "breakdown", "quals", "alliances", "elims", "simulation"]`; `DEFAULT_EVENT_TAB` provably still `"insights"` (new test case asserts both facts and that they're distinct).
- `REGISTERED_EVENT_TABS` grows to six; `resolveActiveTab` takes a named-field options object (`{ isAlliancesDisabled, isSimulationDisabled }`) per PD-01, with a new `simulation` branch that resolves — never navigates, never rewrites the URL.
- The Simulation `TabsTrigger` is D-17's plain-disabled treatment reused verbatim, gated ONLY on `algorithm !== SIMULATION_ALGORITHM_ID` — proven query-independent by a permanently-pending contrast test against `isAlliancesDisabled` (which stays enabled under identical pending conditions).
- `SimulationTab.tsx` ships three distinguishable states in the required order: zero qualification matches (canonical empty state), qualification matches with no `redRpPmf`/`blueRpPmf` anywhere (a new, distinct unavailable state), and a pre-run placeholder inside the layout stack otherwise.
- `hasSimulatableRankInputs` exported and directly tested against 7 hand-built adversarial artifact shapes, plus confirmed against two REAL production artifacts (see below).

## The two real-artifact checks (offseason and RP-eligible), with numbers

Taken from 08-05's ledger, fetched live from `https://data.sigmascout.org`:

- **Offseason, zero pmfs:** `2024wvrox` (`v1/event/2024wvrox/vpr@2.1.0+tuned-2026-08.json`) — `qmCount=135 bothPmfCount=0`. Matches the ledger's recorded `playedQmRowCount: 135, playedQmBothPmfCount: 0` exactly.
- **RP-eligible, full pmfs:** `2024new` (`v1/event/2024new/vpr@2.1.0+tuned-2026-08.json`) — `qmCount=125 bothPmfCount=125`. Matches the ledger's recorded `playedQmRowCount: 125, playedQmBothPmfCount: 125` exactly.

Both confirm the predicate's negative and positive branches occur on real production bytes, not only in this plan's hand-written test fixtures.

## Minted Copywriting Contract strings (flagged planner assumption, per plan output spec)

`08-UI-SPEC.md` had no row for "qualification matches exist but carry no ranking-point distributions" — 08-05 discovered this state after the contract was signed off. Shipped verbatim as written in the plan's `<action>`:

- `SIMULATION_UNAVAILABLE_HEADING` = `"Rank simulation isn't available for this event"`
- `SIMULATION_UNAVAILABLE_BODY` = `"This event's matches don't carry the predicted ranking-point distributions the simulation needs. Offseason events are the usual reason — they sit outside the ranking-point model."`

Flagged for a future `ui-phase` pass to formally adopt into the Copywriting Contract rather than a third paraphrase being minted later.

## The three rewritten position assertions (PD-09) — before and after

1. **Test 6** ("REGISTERED_EVENT_TABS and EVENT_TABS hold the same N ids") — before: `toHaveLength(5)`; after: `toHaveLength(6)`. Name updated from "five ids" to "six ids".
2. **The ordering case** ("exactly N tabs exist, named ... IN THAT ORDER") — before: `toEqual(["Insights", "Breakdown", "Quals", "Alliances", "Elims"])`; after: `toEqual([..., "Elims", "Simulation"])`. Name updated to include Simulation and cite 08-09 as the registering plan.
3. **The "Elims is last" case** — before: asserted `tabs.at(-1)?.textContent === "Elims"`; after (intent preserved, not weakened): asserts `tabs.at(-2)?.textContent === "Elims"` AND `tabs.at(-1)?.textContent === "Simulation"`. Test name and an inline PD-09 comment explain the rewrite reads "a newly-registered tab lands in its declared position rather than wherever the JSX put it" — the same intent, now pointed at the new last tab.
4. **The final "strip exposes exactly N elements" case** (not separately named in the plan's PD-09 list but structurally identical to case 2) — updated the same way: `toHaveLength(5)` → `(6)`, array grown by `"Simulation"`.

## Post-edit failing-test-name set (compared to baseline)

`npx vitest run apps/web/src` after all edits: **58 test files passed (58), 881 tests passed (881)**. The failing-test-name set is still EMPTY — identical to the baseline's empty set. Names that moved: none failed; 23 new test names were ADDED (14 in `searchParams.test.ts`, up from the pre-existing baseline count via 4 rewritten + 1 new case; 15 in the new `SimulationTab.test.tsx`; and in `event.$eventKey.test.tsx`, 3 rewritten + 7 new = the file's total grew from 46 to 53 passing cases). No pre-existing test name disappeared or changed status.

## Task Commits

1. **Task 1: The URL contract grows to six ids** — `a893a7c8` (feat)
2. **Task 2: `SimulationTab` — panel shell with three honest states** — `b8eb881b` (feat)
3. **Task 3: Register the sixth tab in the route** — `b3b66040` (feat)
4. **Fix-up (test-count alignment):** `063a2448` (test) — split one combined test case into two so the printed count matches the plan's acceptance criteria literally ("seven new cases"); see Deviations below.

## Files Created/Modified

- `apps/web/src/lib/searchParams.ts` — `EVENT_TABS` grown to six ids, doc comment extended to describe the new third reachability state (registered-but-conditionally-disabled)
- `apps/web/src/lib/searchParams.test.ts` — ordering/round-trip cases rewritten to six ids; new default-separation case
- `apps/web/src/components/event/SimulationTab.tsx` — new: the panel shell, predicate, copy constants, skeleton
- `apps/web/src/components/event/SimulationTab.test.tsx` — new: 15 cases covering all three states, the predicate, both prohibition guards, the skeleton
- `apps/web/src/routes/event.$eventKey.tsx` — sixth tab import/registration/trigger/panel; `resolveActiveTab` signature change (PD-01); `isSimulationDisabled` derivation
- `apps/web/src/routes/event.$eventKey.test.tsx` — three PD-09 rewrites plus 7 new cases

## Decisions Made

- **PD-01–PD-09 applied exactly as the plan specified** — named-field options object for `resolveActiveTab`, `SIMULATION_ALGORITHM_ID` as the one spelling of the VPR id, the panel not re-deriving D-04's rule, the unavailable copy hedging its cause, the predicate reading raw arrays (PD-05) and answering the class question only (PD-06), no state in the shell (PD-07), no `checkpoint:decision` (PD-08), and the three position assertions rewritten not deleted (PD-09).
- Split the combined vpr-enabled/opr-disabled trigger test into two separate `it()` blocks (see Deviations) so the printed test count (7) matches the plan's own acceptance criteria text literally, rather than leaving a 6-vs-7 mismatch between the `<behavior>` bullet list and the `<acceptance_criteria>` count for a future reader to puzzle over.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/inconsistency] Split one combined test case into two to match the acceptance criteria's stated count**
- **Found during:** Task 3, while verifying the acceptance criteria's "prints all seven new cases" claim
- **Issue:** The plan's `<behavior>` bullet list names 6 new test scenarios; one bullet ("`?algorithm=vpr` renders an enabled Simulation trigger and `?algorithm=opr` renders a disabled one") bundles two assertions. Written as a single `it()` block, the route test file printed only 6 new named tests, not the 7 the `<acceptance_criteria>` explicitly names.
- **Fix:** Split that one test into two separate `it()` blocks (enabled-on-vpr, disabled-on-opr), each independently named and independently passing.
- **Files modified:** `apps/web/src/routes/event.$eventKey.test.tsx`
- **Verification:** `npx vitest run apps/web/src/routes/event.$eventKey.test.tsx` — 53/53 passing (was 52/52 before the split); full suite re-run at 881/881, 0 failing.
- **Committed in:** `063a2448`

---

**Total deviations:** 1 auto-fixed (1 bug/inconsistency)
**Impact on plan:** No scope creep — purely a test-count alignment so the acceptance criteria's literal claim is checkable rather than approximately true.

## Issues Encountered

- One initial test-authoring mistake (not a deviation from the plan, an in-flight bug in this session's own test draft): the first version of the "zero-qualification-matches empty state" route case used two separate `waitFor` blocks, the first of which (checking `simulation-panel` visibility) resolved trivially on the FIRST render — before the mocked artifact fetch had returned — because tab visibility is driven by the URL/`resolveActiveTab`, not by data. The subsequent `getByText` assertion then ran against the still-pending page and failed. Fixed by collapsing to a single `waitFor` around the data-dependent assertion itself (the empty-state heading text), which naturally waits for the fetch to resolve. Caught and fixed before this task's commit — no bad code was ever committed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Routed to 08-11** (per plan `<output>` instructions): `hasSimulatableRankInputs` answers the CLASS question only (PD-06) — per-row pmf completeness after a chosen start match is unhandled by this plan; that belongs to `simulationInputs.ts`. The predicate is also a candidate to re-home into that module once it exists (flagged assumption 4 in the plan).
- **Routed to 08-11, 08-13, 08-14:** the exported `SIMULATION_STACK_TESTID` and the three commented mount positions (picker / run control / rank table) in `SimulationTab.tsx`, in UI-SPEC's declared top-to-bottom order — each later plan mounts a child there rather than restructuring the panel.
- **Routed to 08-15:** the six-trigger strip shipped into Phase 7's unchanged `overflow-x-auto`/`justify-center-safe` scroll pattern (no new responsive treatment introduced); 08-15's S0 row owns the first real 390px touch-interaction measurement of that assumption. `apps/web/e2e/event-scroll-regions.spec.ts`'s local `TABS` array is still five elements (untouched, per baseline item 4 and the plan's explicit scope boundary) because the Simulation panel has no `*-table-scroll` region until 08-11 and 08-14 land.
- **Routed to a future `ui-phase` pass:** the two minted copy strings (`SIMULATION_UNAVAILABLE_HEADING`/`BODY`) and the Dimension-1 "no next step" departure UI-SPEC's flagged assumption 2 already named — this component's unavailable state genuinely has no actionable next step for the reader, by design.
- **Explicit confirmations:** `DEFAULT_EVENT_TAB` was not changed (still `"insights"`); no new npm dependency was added; no theme token was added or changed; no Web Worker was constructed anywhere in this plan (proven by grep gates, not just doc comments); no published artifact or R2 object was touched (read-only fetch checks only); `apps/web/e2e/event-scroll-regions.spec.ts` was not modified.
- Ready for 08-11 (start-match picker + `simulationInputs.ts`) to mount into the established stack.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*

## Self-Check: PASSED

All files and commit hashes verified present (see below).
