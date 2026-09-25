---
phase: 10-district-points-ledger
plan: 07
subsystem: ui
tags: [react, web-worker, tanstack-router, tanstack-query, districts, locks, histograms, simulation, zod]

requires:
  - phase: 10-03
    provides: DistrictEventStateSchema, DistrictPointPmfSchema, awardProfile, awardBaseRates, bakedEvents, districtPreSimKey, DistrictPreSimArtifactSchema
  - phase: 10-04
    provides: simulateDistrictEvent, convolveDistrictGrandTotal, pointSummary.ts (pointQuantile/pointPercentiles/pointCellSummary/POINT_CELL_CHANCE_FORM_THRESHOLD), UnratedTeamError
  - phase: 10-02
    provides: allianceWinProbability, allianceRatingsFromMetrics, AllianceMemberRating, awardBaseRates.ts
  - phase: 10-01
    provides: pointModel.ts maxEventPoints, qualPoints.ts, selectionPoints.ts, bracket.ts
  - phase: 10-05
    provides: the Worker district refresh and its freshness limit
  - phase: 10-06
    provides: the offline publisher's baked sidecars and award base-rate table
provides:
  - The Road to District Champs tab, replacing the District Locks table on the district tier
  - A district simulation Web Worker triad mirroring the shipped one file-for-file
  - districtLedgerRows.ts, districtLedgerStatus.ts, districtTimeline.ts, districtHistGeometry.ts, districtLedgerCopy.ts
  - The `road-to-district-champs` tab id and three new typed search params (`at`, `drawerTeam`, `drawerCell`)
  - A date-free district-artifact poll gate at the 60 s floor
affects: [10-08, 10-09, champ-locks-narrowing-follow-up]

actuals:
  tokens: 81000
  tasks: 6
  commits: 6

tech-stack:
  added: []
  patterns:
    - "A second Web Worker triad (thin entry, fat testable protocol, factory with the inline `new URL(...)`), mirroring the shipped one file-for-file"
    - "A per-event failure-isolating Worker protocol: one bad event becomes an unavailable ENTRY, never a terminal error"
    - "ONE distribution representation (dense array whose index IS the point value, plus an explicit denominator), decoded from 10-03's offset encoding exactly once"
    - "A points-axis adapter over the shipped rank-plot geometry, owning the single `v + 1` / `m + 1` index shift"
    - "Acyclic data flow: artifacts -> timeline -> stage -> simulation, split across two hooks"

key-files:
  created:
    - apps/web/src/workers/districtSimulationProtocol.ts
    - apps/web/src/workers/districtSimulation.worker.ts
    - apps/web/src/workers/createDistrictSimulationWorker.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictPointHistogram.tsx
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/districtTimeline.ts
    - apps/web/src/components/districts/districtHistGeometry.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/useDistrictSimulationRun.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/lib/api/districtLedger.ts
  modified:
    - apps/web/src/lib/api/districts.ts
    - apps/web/src/lib/liveEvent.ts
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/routes/districts.tsx
    - apps/web/src/styles/theme.css

key-decisions:
  - "The baked-pmf branch resolved to SIDECAR: `grep -c bakedEvents packages/harness/pageArtifacts.ts` returned 1 and `grep -c districtPreSimKey` returned 3, so `apps/web/src/lib/api/districtLedger.ts` WAS created, mirroring `preSchedule.ts` including its 404-returns-null divergence."
  - "The Worker protocol does NOT chunk draws. `simulateDistrictEvent` builds both its generators from the seed it is handed, so a chunked accumulation would either repeat a chunk or break 10-04's non-perturbation pin. Progress is per EVENT instead, and the protocol test asserts equality with a direct core call, which is strictly stronger than additivity."
  - "One seed for every event in a run is safe because the grand total is an EXACT CONVOLUTION of per-event marginals, never a per-draw cross-event sum. Nothing downstream may start summing per-draw across events without revisiting this."
  - "In range / Out of range is decided by a SECOND call to the shipped `cutLinePointsWithQualifiers` over median-projection inputs with `maxRemaining: 0`, never by a hand-rolled slot subtraction in the browser. No file under `packages/` was edited."
  - "The floor at a position is derived by SUBTRACTING reopened earned points from `team.pointTotal`, never by re-summing categories, because `pointTotal` carries the rookie bonus, the adjustments and TBA's own arithmetic."
  - "A position on the Rewind slider is a step that HAS happened, so a category is final exactly when its own stage step sits at or before the position and rewinding reopens later categories by construction."
  - "The FETCH set and the SIMULATION set are different sets: a rewind widens the fetch set to every started district-tier event (the timeline is built from their schedules) while the simulation set skips any event whose four categories are all final. That split is what keeps artifacts -> timeline -> stage acyclic and preserves SC-5 at the now position."
  - "No palette entry was added. The Locked out chip reuses the shipped `--lock-status-eliminated-*` rose pair, Locked the shipped green, Prequalified the shipped purple, In range / Out of range are outline-only from `--color-text-primary`/`--color-text-muted`/`--color-border`, and the blue open cell reuses the shipped `--lock-status-locked-award-*` pair (free on this tab, because the award variant here renders under the LOCKED green)."

patterns-established:
  - "Pattern: a Worker protocol whose per-event `try`/`catch` turns a typed core error into an unavailable RESULT entry, reserving the terminal `error` message for a malformed request alone"
  - "Pattern: two hooks (`useDistrictEventArtifacts` then `useDistrictLedgerData`) so a derived timeline can sit between the fetch and the simulation without a cycle"
  - "Pattern: a geometry adapter that re-exports the shipped plot constants and owns the single index shift, with a comment-stripped grep proving the component never reaches past it"

requirements-completed: [SC-2, SC-3, SC-4, SC-5]

coverage:
  - id: D1
    description: "The district simulation Web Worker triad: a thin entry, a fat testable protocol with per-event failure isolation and named cost ceilings, and a factory whose inline `new URL(...)` Vite actually detects"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "apps/web/src/workers/districtSimulationProtocol.test.ts#forwards the core's per-event histograms unreshaped"
        status: pass
      - kind: unit
        ref: "apps/web/src/workers/districtSimulationProtocol.test.ts#isolates a per-event failure"
        status: pass
      - kind: other
        ref: "vite build emitted dist/assets/districtSimulation.worker-D7cBzdF5.js — the worker chunk really is emitted"
        status: pass
    human_judgment: false
  - id: D2
    description: "The nine-column ledger table: grey final cells carrying the artifact's own integer, blue open cells carrying both round-four text forms, the event and grand totals, the sort by median projected grand total, the team search and the stat line"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "apps/web/src/components/districts/districtLedgerRows.test.ts#selects the form per CATEGORY, not per cell"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/districts/districtLedgerRows.test.ts#convolves two event totals entry for entry, against a hand-computed answer"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#renders BOTH blue text forms on one fixture"
        status: pass
    human_judgment: false
  - id: D3
    description: "The five statuses, their chips as filters with district-wide counts and verbatim definitions, and a finished district reproducing the artifact's own two counts"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "apps/web/src/components/districts/districtLedgerStatus.test.ts#matches insights.districtLockedCount and insights.districtEliminatedCount, per VERDICT status"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/districts/districtLedgerStatus.test.ts#splits on the SHIPPED cutLinePointsWithQualifiers over median-projection inputs"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#toggles a chip off to hide those rows and back on to restore them, WITHOUT changing the counts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Rewind slider over the district's interleaved by-match timeline, with derived jump chips, a shareable typed step id, and a rewound position reopening a finished event's later categories"
    requirement: SC-4
    verification:
      - kind: unit
        ref: "apps/web/src/components/districts/districtTimeline.test.ts#interleaves two events by sortTime and puts each event's four stage steps after its own last qualification row"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#SC-4: a position before an event's last qualification match turns its selection, playoff and award cells BLUE"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/searchParams.test.ts#falls a malformed rewind step id back to absent"
        status: pass
    human_judgment: false
  - id: D5
    description: "The drawer: the clicked cell's histogram beside the grand total's, on sketch 005 continuous 10th-to-90th edges with a median tick and a fixed per-column scale, today's line marked as a floor"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "apps/web/src/components/districts/districtHistGeometry.test.ts#maps point value v to slot v + 1 of m + 1 bins, EXACTLY"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#opens ONE drawer under the clicked team, closes it on a second click, and moves it on a different cell"
        status: pass
      - kind: automated_ui
        ref: "playwright:scratchpad/shots/desktop-table-drawer.png (local preview against a fixture origin)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Zero simulation compute for a finished or unstarted district: no Worker is constructed and no event artifact is fetched at the now position, and the unstarted case still paints its blue cells from the baked pmfs"
    requirement: SC-5
    verification:
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#constructs NO Worker at all when every district event is finished (SC-5)"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#constructs NO Worker for an unstarted event and still paints its blue cells from the baked pmfs (SC-5)"
        status: pass
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#constructs a Worker when the slider moves into a finished event"
        status: pass
    human_judgment: false
  - id: D7
    description: "The old District Locks table, its header stats card and its superseded status vocabulary no longer render on the district tier, while the Champ Locks tab renders unchanged"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#renders none of the old District Locks test ids on this tier"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/districts.test.tsx#?tab=champ-locks still deep-links directly to the Champ Locks tab, which renders the shipped champ table unchanged"
        status: pass
    human_judgment: false
  - id: D8
    description: "Reduced motion: the drawer opens without animation when `prefers-reduced-motion` is set"
    verification:
      - kind: unit
        ref: "apps/web/src/components/districts/DistrictLedger.test.tsx#opens with NO animation class when a reduced-motion preference is set"
        status: pass
    human_judgment: true
    rationale: "A UI-SPEC BACKSTOP row. The committed test asserts the class is absent under a `matchMedia` stub, which proves the branch and not the rendering; the real verification is the UAT's manual OS-setting check."
  - id: D9
    description: "Phone width: the table scrolls inside its card, the page never pans, and the slider and chips wrap"
    verification:
      - kind: automated_ui
        ref: "playwright:scratchpad/shots/phone-table.png at 390x844 — documentScrollWidth 390 equals documentClientWidth 390, the sticky Team column holds at left 0, the status chips wrap onto 2 rows and the jump chips onto 3"
        status: pass
    human_judgment: true
    rationale: "A UI-SPEC BACKSTOP row. The local preview measurement is against a fixture origin on this machine; the real verification is 10-08's deployed e2e spec at 390px, run from the main context after 10-09's deploy."

duration: 57 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 07: The Road to District Champs tab Summary

**The district tier's Locks table replaced by a nine-column ledger whose grey cells carry TBA's own earned integers and whose blue cells carry 10-04's joint simulation through a second Web Worker triad, with five status chips recomputed from the shipped `locks.ts`, a Rewind slider over the district's interleaved by-match timeline, and sketch-005 histograms in a shareable drawer.**

## Performance

- **Duration:** 57 min
- **Started:** 2026-09-25T12:57:19Z
- **Completed:** 2026-09-25T13:54:37Z
- **Tasks:** 6
- **Files modified:** 30 (13 production modules created, 2 components, 2 hooks, 5 modified)

## Accomplishments

- **The district Worker triad**, mirroring the shipped one file-for-file: a thin entry with no arithmetic, a fat testable protocol with per-event failure isolation and named cost ceilings, and a factory whose inline `new URL(...)` Vite really does detect — the build emitted `districtSimulation.worker-D7cBzdF5.js`.
- **The nine-column ledger**: grey final cells printing the artifact's own `eventPoints[category]`, blue open cells printing either a median plus a likely range or a chance plus a tilde-prefixed conditional amount, chosen per category by 10-04's form selector; the grand total is 10-04's exact convolution over however many district-tier events a team actually played.
- **The five statuses** from the shipped `locks.ts` recomputed at the position, with In range / Out of range from a second call to the shipped `cutLinePointsWithQualifiers` over median projections. A finished district reproduces `insights.districtLockedCount` and `insights.districtEliminatedCount` exactly.
- **The Rewind slider** stepping by match across the district's interleaved `sortTime` timeline, with four stage steps after each event's last qualification row and derived jump chips; rewinding into a finished event reopens its later categories and every status recomputes.
- **The drawer**: the clicked cell's histogram beside the grand total's, every position derived from the shipped rank-plot geometry through one adapter, with today's line marked and captioned as a FLOOR.
- **SC-5 proven by absence**: no `Worker` is constructed at all — an empty `instances` array, not merely an empty `posted` array — when every event is finished or unstarted, and no event artifact is fetched either.

## Task Commits

1. **Task 1 (TRACER): one in-progress event, end to end** — `9ba2dbd6` (feat)
2. **Task 2: the full ledger table, both cell forms, the sort, the search and the stat line** — `4cd7c968` (feat)
3. **Task 3: the five statuses, the chips as filters, and their definitions** — `f2bc2467` (feat)
4. **Task 4: the Rewind slider, the interleaved timeline and the typed search params** — `b1ce9ff9` (feat)
5. **Task 5: the drawer, on sketch 005 continuous edges with today's line** — `5b1c0aca` (feat)
6. **Task 6: the removal proof, this tab's own caveat, and the hardening sweep** — `19b59015` (feat)

## Branch resolution

**SIDECAR.** The two greps the plan specified:

| Command | Result |
|---|---|
| `grep -c "bakedEvents" packages/harness/pageArtifacts.ts` | `1` |
| `grep -c "districtPreSimKey" packages/harness/pageArtifacts.ts` | `3` |

Either non-zero count selects the sidecar branch, so **`apps/web/src/lib/api/districtLedger.ts` WAS created** (and its test), mirroring `preSchedule.ts` in shape including its two recorded divergences: a 404 returns `null` because an absent sidecar is an ordinary expected state, and `markArtifactParsed()` is deliberately not called. A sidecar is fetched only for an event key the artifact's own `bakedEvents` list names, so a 404 is never control flow. The branch knowledge is confined to `districtLedgerRows.ts`'s `distributionsFromPreSim`.

## Exported symbol lists

10-08's e2e spec and any follow-up read these by name.

**`apps/web/src/workers/districtSimulationProtocol.ts`**
`MAX_DISTRICT_SIMULATION_EVENTS`, `MAX_DISTRICT_SIMULATION_ROSTER`, `INVALID_DISTRICT_REQUEST_ERROR_NAME`, `UNKNOWN_DISTRICT_ERROR_NAME`, `DistrictSimulationEventRequest`, `DistrictSimulationRequest`, `DistrictSimulationProgressMessage`, `DistrictSimulationEventSuccess`, `DistrictSimulationEventUnavailable`, `DistrictSimulationEventEntry`, `DistrictSimulationResultMessage`, `DistrictSimulationErrorMessage`, `DistrictSimulationOutboundMessage`, `isDistrictSimulationRequest`, `runDistrictSimulationJob`, plus re-exported `DEFAULT_SIMULATION_SEED` and `SIMULATION_DRAWS`.

**`districtLedgerRows.ts`**
`DISTRICT_CATEGORIES`, `DistrictCategory`, `DistrictCellKind`, `DistrictPointDistribution`, `DistrictStageFinality`, `DistrictEventStage`, `deriveStageFromState`, `decodeDistrictPointPmf`, `pointMassDistribution`, `DistrictLedgerCell`, `DistrictLedgerEventRow`, `DistrictLedgerTeam`, `DistrictLedgerGaps`, `districtTierEvents`, `inProgressDistrictEventKeys`, `allDistrictTierEventKeys`, `DistrictEventInputResult`, `BuildDistrictEventInputOptions`, `buildDistrictEventSimulationInput`, `DistrictEventDistributions`, `distributionsFromResult`, `distributionsFromPreSim`, `districtCellId`, `GRAND_TOTAL_CELL_ID`, `BuildDistrictLedgerRowsOptions`, `DistrictLedgerRowsResult`, `buildDistrictLedgerRows`, `filterDistrictLedgerTeams`, `DistrictLedgerStatLine`, `districtLedgerStatLine`.

**`districtLedgerStatus.ts`**
`DISTRICT_LEDGER_STATUS_KEYS`, `DistrictLedgerStatusKey`, `DistrictLedgerStatusState`, `DistrictLedgerStatusResult`, `DistrictLedgerStatusModel`, `ComputeDistrictLedgerStatusesOptions`, `computeDistrictLedgerStatuses`.

**`districtTimeline.ts`**
`DISTRICT_STEP_KINDS`, `DistrictStepKind`, `DISTRICT_TIMELINE_SEASON_START_ID`, `DISTRICT_TIMELINE_NOW_ID`, `DistrictTimelineStep`, `DistrictTimelinePosition`, `DistrictTimelineChip`, `DistrictTimelineGaps`, `DistrictTimeline`, `BuildDistrictTimelineOptions`, `buildDistrictTimeline`, `resolveDistrictTimelinePosition`, `districtStageAtPosition`, `remainingQualRowsAtPosition`, `startMatchKeyAtPosition`, `eventsWithOpenCategoriesAt`.

**`districtHistGeometry.ts`**
`pointSlots`, `pointX`, `pointBandExtent`, `pointMedianTickLeft`, `pointBarExtent`, `pointAxisTicks`, plus re-exported `PLOT_W`, `SIM_GEOMETRY` and `RankMarkExtent`.

**`districtLedgerCopy.ts`**
`DISTRICT_LEDGER_TAB_LABEL`, `DISTRICT_LEDGER_COLUMN_LABELS`, `DISTRICT_LEDGER_STAGE_WORDS`, `DISTRICT_LEDGER_UNAVAILABLE_CELL`, `DISTRICT_LEDGER_LIKELY_PREFIX`, `DISTRICT_LEDGER_CHANCE_WORDS`, `DISTRICT_LEDGER_LEGEND_EARNED`, `DISTRICT_LEDGER_LEGEND_OPEN`, `DISTRICT_LEDGER_LEGEND_EXPLAINER`, `DISTRICT_LEDGER_REWIND_LABEL`, `DISTRICT_LEDGER_REWIND_HINT`, `DISTRICT_LEDGER_SEARCH_LABEL`, `DISTRICT_LEDGER_SEARCH_PLACEHOLDER`, `DISTRICT_LEDGER_STAT_LINE_LABELS`, `DISTRICT_LEDGER_NO_MATCHES`, `DISTRICT_LEDGER_STATUS_LABELS`, `DISTRICT_LEDGER_LOCKED_AWARD_LABEL`, `DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED`, `DISTRICT_LEDGER_STATUS_DEFINITIONS`, `DISTRICT_LEDGER_DRAWER_CELL_CAPTION`, `districtLedgerNoPointsCaption`, `DISTRICT_LEDGER_DRAWER_LINE_CAPTION`, `DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION`, `DISTRICT_LEDGER_DRAWER_NO_CHANCE_CAPTION`, `DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL`, `DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL`, `DISTRICT_LEDGER_DRAWER_LINE_LABEL`, `DISTRICT_LEDGER_CAVEAT`, `DISTRICT_LEDGER_PROVENANCE`.

## The three ceiling constants

| Constant | Value | Reasoning |
|---|---|---|
| `MAX_DISTRICT_SIMULATION_EVENTS` | 24 | The largest district in the corpus runs about a dozen district-tier events across a whole season, which is the worst case a full-season rewind could ask for; 24 is double that, so a legitimate request can never reach it. A DoS bound on the visitor's own CPU, not an operating value. |
| `MAX_DISTRICT_SIMULATION_ROSTER` | 256 | The largest district event roster the corpus carries is well under 100 teams. Again a DoS bound with real margin. |
| draws and matches | `MAX_SIMULATION_DRAWS` (10000) and `MAX_SIMULATION_MATCHES` (500), IMPORTED unchanged | One ceiling per quantity across the site; restating either here is how two limits drift apart. |

`SIMULATION_DRAWS` (1000) and `DEFAULT_SIMULATION_SEED` are likewise imported from `simulationProtocol.ts` and re-exported, never restated: one draw count and one fixed seed across the whole site, which is what 10-04's non-perturbation pin is written against.

## The finished-district count check (SC-3)

`districtLedgerStatus.test.ts`'s SC-3 fixture: 30 teams, 12 `dcmpSlots`, 3 district-tier Impact winners. The three numbers, written into the test so a future reader cannot conflate them:

| Number | Value | What it is |
|---|---|---|
| recomputed `locked` verdict count | **9** | equals `insights.districtLockedCount` — that field counts `locked` ALONE |
| recomputed `lockedAward` verdict count | **3** | the `lockedAward` addend, counted by no artifact field |
| **Locked CHIP count** | **12** | `locked` + `lockedAward`, asserted separately AND asserted `not.toBe(9)` |
| recomputed `eliminated` verdict count | **18** | equals `insights.districtEliminatedCount` |

Twelve slots minus the three consuming Impact winners leaves nine points slots over a 27-team pool, so nine lock and the remaining eighteen are out. A test comparing the chip count against `districtLockedCount` would be testing the wrong number.

## The local `2026pnw` sanity check (Task 2)

Fed the real gitignored `data/fixtures/phase10/district-2026pnw.json` through `districtLedgerRows.ts` at the "now" position with a throwaway script, since deleted:

| Measurement | Result |
|---|---|
| teams in artifact / teams built | 126 / 126 |
| per-team row-count distribution | `2 rows -> 126 teams` (every team, exactly its district-tier event count) |
| teams whose `rowCount` disagrees with their district-tier event count | **0** |
| dcmp-tier event keys present in the artifact | `2026pncmp` |
| does the dcmp key appear in any rendered row? | **no** |
| rendered district-tier event keys | the eight: `2026orore`, `2026orsal`, `2026orwil`, `2026waahs`, `2026wabon`, `2026wasam`, `2026wasno`, `2026wayak` |
| in-progress event keys at "now" | `[]` (this generation's artifact carries no `state` blocks at all) |
| stat line | today's line floor **56** (the 50th-highest earned district-tier total at `dcmpSlots` 50), **0** open cells of **1008** total cells (126 x 2 x 4) |
| artifact's own counts, for reference | `districtLockedCount` 42, `districtEliminatedCount` 76 |

Nothing under `data/` was staged.

## The four Worker-construction assertions (SC-5)

| Case | Assertion | Result |
|---|---|---|
| every district event FINISHED, at "now" | mock handle's `instances` array is EMPTY | pass |
| every district event UNSTARTED with baked pmfs, at "now" | `instances` EMPTY **and** the blue cells still render both text lines from the baked pmfs | pass |
| MIXED (one finished, one in progress) | exactly one instance, whose request carries only `2026walive` | pass |
| the slider moved into a finished event | one instance IS constructed, whose request carries only that event | pass |

`instances` rather than `posted` is deliberate and noted in the test file: an empty `instances` array proves the construction never happened, which is strictly stronger than proving a constructed Worker was not used.

## What the local visual check showed (Task 6)

Built the app with `VITE_ARTIFACT_ORIGIN` pointed at a throwaway localhost fixture server (verified by CONTENT, not status, and killed by PID afterwards; preview verified the same way), served the real `2026pnw` artifact with `state` blocks and `awardProfile` injected so both greys and blues are on screen, and drove Chromium through Playwright at 1280x900 and 390x844.

| What the plan said to look at | What was actually seen |
|---|---|
| the grey / blue split reads at a glance | **Yes.** Grey cells are one muted integer; blue cells are two lines in the blue token and are focusable buttons. Sample open-cell text: `22 / likely 21.6–22.4` and `98% play / ~30 if in`. 1045 final cells against 341 open cells on the desktop render, 0 unavailable. |
| the sticky first column holds | **Yes.** Computed `position: sticky`, `left: 0px` on the Team cell at both widths; at 390px the Team column is what stays on screen while the rest scrolls away. |
| the table scrolls inside its card while the page does not pan | **Yes.** At 390px `document.documentElement.scrollWidth` is 390 and `clientWidth` is 390 (no page pan) while the table itself is 1519px wide inside its own scroll container. Same at 1280. |
| the slider and chips wrap | **Yes.** At 390px the five status chips wrap onto 2 rows and the six jump chips onto 3. |
| a drawer opens under the right team | **Yes.** Clicking team 5468's Qualification cell opened one drawer row spanning the table directly beneath that team's two rows, carrying the category histogram (band, bars, median tick, a 0..22 axis), the label `10th–90th: 21.6–22.4`, its caption, then the grand total histogram with the dashed today's line near 41, the "Today's line" label, the floor caption and the no-chance caption. |
| no console or page errors | **Yes.** Zero `pageerror` and zero console errors at either width. |

The controls card rendered the Rewind slider with readout "Now", six jump chips (Season start, After week 0 through 3, Now), the five chips with live counts **Prequalified 0 / Locked 33 / In range 17 / Out of range 36 / Locked out 40** (126 teams, all five accounted for), the definitions row, the team search, the stat line (today's line floor 41, 228 of 1008 open cells) and the legend, with the caveat and provenance sentence beneath. `document.body.textContent` contained no plus-minus codepoint at either width.

This was a LOCAL check against a fixture origin on this machine, not a deploy.

## No palette entry was added

The dataviz palette validator had nothing new to check, so it was deliberately not run against an unchanged palette. Every colour on this tab comes from a shipped token pair:

| Chip / mark | Token pair |
|---|---|
| Locked out | `--lock-status-eliminated-bg` / `--lock-status-eliminated-fg` (rose, shipped) |
| Locked and Locked · award | `--lock-status-locked-bg` / `--lock-status-locked-fg` (green, shipped) |
| Prequalified | `--lock-status-prequalified-bg` / `--lock-status-prequalified-fg` (purple, shipped) |
| In range / Out of range | outline-only from `--color-text-primary`, `--color-text-muted`, `--color-border` (all shipped) |
| a blue OPEN cell | `--lock-status-locked-award-bg` / `--lock-status-locked-award-fg` (blue, shipped) — free on this tab because the award variant renders under the LOCKED green here |
| the drawer's plots | `--sim-band-overlay`, `--sim-hist-bar`, `--sim-median-tick` (all shipped) |

`git diff` over this plan's `theme.css` block introduces no literal colour value: the three new `.lock-status-chip--*` modifiers and the reduced-motion query reference custom properties only.

## The two UI-SPEC backstop rows

Named as backstops, **not claimed as covered**:

| Row | What this plan actually did | Who really verifies it |
|---|---|---|
| Reduced motion: the drawer opens without animation | a committed test asserts the animation class is absent under a `matchMedia` stub, plus a `prefers-reduced-motion` query in `theme.css` | the **UAT's manual OS-setting check** |
| Phone width: the table scrolls inside its card, the slider and chips wrap | the local 390px Playwright measurement above | **10-08's deployed e2e spec at 390px**, run from the main context after 10-09's deploy |

## `git diff --stat` evidence

```
$ git diff --stat 01646e53 -- apps/web/src/components/districts/DistrictLocksTab.tsx \
                               apps/web/src/components/districts/DistrictLocksTab.test.tsx \
                               apps/web/src/components/districts/districtLocksHeaderStats.ts
(no output)

$ git diff --stat 01646e53 HEAD -- packages/ apps/worker/ package.json pnpm-lock.yaml
(no output)
```

Across the WHOLE plan: the three champ-tier files are byte-unchanged, and nothing under `packages/`, `apps/worker/`, `package.json` or the lockfile changed. Total: 30 files, 6440 insertions, 28 deletions, all under `apps/web/src/` plus `10-VALIDATION.md`.

## The named follow-up

**Narrowing `DistrictLocksTab.tsx` and `districtLocksHeaderStats.ts` to the champ tier.** After this plan the component's `which="district"` arm has NO production call site, and `computeDistrictLocksHeaderStats` is reachable only through it. Narrowing both is a clean quick task and is **deliberately out of this phase's scope**: it would rename test ids that a 583-line shipped test and 10-08's live e2e spec both depend on, for no user-visible gain. Named here rather than left for someone to discover.

## Files Created/Modified

- `apps/web/src/workers/districtSimulationProtocol.ts` — the fat testable protocol: request and message shapes, three ceilings, `isDistrictSimulationRequest`, `runDistrictSimulationJob` with per-event failure isolation and per-event progress
- `apps/web/src/workers/districtSimulation.worker.ts` — the thin entry: a locally-typed scope, one `onmessage`, one forward, no arithmetic and no core import
- `apps/web/src/workers/createDistrictSimulationWorker.ts` — the Vite bundling seam and the single site of the inline `new URL(...)`
- `apps/web/src/components/districts/useDistrictSimulationRun.ts` — the one-Worker-at-a-time lifecycle, started from an effect keyed on a request signature, posting nothing for an empty request
- `apps/web/src/components/districts/useDistrictLedgerData.ts` — `useDistrictEventArtifacts` then `useDistrictLedgerData`, the two hooks that keep artifacts -> timeline -> stage acyclic
- `apps/web/src/components/districts/districtLedgerRows.ts` — the district-tier row model, stage derivation, baked decode, the ONE distribution representation, per-event input assembly, cell descriptors, totals, projection, sort, search and stat line
- `apps/web/src/components/districts/districtLedgerStatus.ts` — the five statuses at a position, the qualifier sets, the projection cut line and the district-wide counts
- `apps/web/src/components/districts/districtTimeline.ts` — the interleaved by-match timeline, step resolver, derived jump chips and per-event stage at a position
- `apps/web/src/components/districts/districtHistGeometry.ts` — the one points-axis adapter over `simAxis.ts`
- `apps/web/src/components/districts/districtLedgerCopy.ts` — every string the tab prints
- `apps/web/src/components/districts/DistrictLedger.tsx` — the tab: controls card, nine-column table, drawer row
- `apps/web/src/components/districts/DistrictPointHistogram.tsx` — one points-axis histogram, three layers, optional today's-line rule
- `apps/web/src/lib/api/districtLedger.ts` — the sidecar fetcher (SIDECAR branch)
- `apps/web/src/lib/api/districts.ts` — the district artifact's `refetchInterval`
- `apps/web/src/lib/liveEvent.ts` — `districtEventStateStarted`, `districtEventStateFinished`, `shouldPollDistrictArtifact`
- `apps/web/src/lib/searchParams.ts` — the renamed tab id and the three new params
- `apps/web/src/routes/districts.tsx` — the renamed tab and panel, rendering `DistrictLedger`
- `apps/web/src/styles/theme.css` — three chip modifiers and a reduced-motion query, no palette entry

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing ones: the sidecar branch, no draw chunking, one seed across events, the second `cutLinePointsWithQualifiers` call for the In range boundary, the floor by subtraction, and the fetch-set / simulation-set split.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `buildSimulationInputs` cannot express a start index past the last row, so the quals-finished baseline is built locally**
- **Found during:** Task 1 (`districtLedgerRows.ts`)
- **Issue:** 10-04 expresses a finished qualification stage as ZERO remaining matches. `buildSimulationInputs(artifact, startMatchKey)` is addressed by a start MATCH KEY, and "one past the last row" has no key; passing the last row's key instead yields a rewind baseline (all zeros), which would have ranked every team by nothing.
- **Fix:** a small local `finishedQualBaselines(artifact)` in `districtLedgerRows.ts` using the IDENTICAL arithmetic to that function's own non-rewind Ranking Score path (`Math.round(rp * denominator)` against TBA's own played-match denominator), with the duplication and its reason recorded at the site. `simulationInputs.ts` is not in this plan's `files_modified`, so it was not edited.
- **Files modified:** `apps/web/src/components/districts/districtLedgerRows.ts`
- **Verification:** `districtLedgerRows.test.ts#quals-done: ZERO remaining matches with no flag of any kind` asserts `remainingMatches` is `[]` and that the baselines cover the whole roster.
- **Committed in:** `9ba2dbd6`

**2. [Rule 2 - Missing Critical] Task 1 shipped the full cell machinery rather than a Qualification-only cell**
- **Found during:** Task 1
- **Issue:** the eight columns Task 1 specifies include Event total and Grand total. Rendering those as "not available" while the data to compute them was in hand would have been a STUB on a shipped path, which the plan's own `<action>` forbids.
- **Fix:** Task 1 wired both round-four forms, the event total and the grand-total convolution immediately. Task 2 then added the labels tuple, the row spans, the sort and tie-break assertions, the search, the stat line and the legend on top.
- **Files modified:** `districtLedgerRows.ts`, `DistrictLedger.tsx`
- **Verification:** both tasks' acceptance criteria pass; no cell on any shipped path renders a placeholder.
- **Committed in:** `9ba2dbd6` and `4cd7c968`

**3. [Rule 1 - Bug] The Status column was added in Task 3, not Task 2, so the header never disagreed with the data**
- **Found during:** Task 2
- **Issue:** Task 2's `<behavior>` asserts nine column labels including Status, but statuses are Task 3's. Shipping a ninth column with nothing in it for one commit would have been a stub.
- **Fix:** Task 2 asserts the EIGHT labels it can fill; Task 3 inserts `"Status"` into `DISTRICT_LEDGER_COLUMN_LABELS` and the header test in the same commit that computes the statuses. The final header renders the nine labels the plan names, in the plan's order.
- **Files modified:** `districtLedgerCopy.ts`, `districtLedgerCopy.test.ts`, `DistrictLedger.tsx`
- **Verification:** `districtLedgerCopy.test.ts#pins the tab label and the column labels in render order` pins all nine.
- **Committed in:** `4cd7c968` and `f2bc2467`

**4. [Rule 1 - Bug] The removal test asserts "Out of range" never MEANS eliminated, rather than asserting its absence**
- **Found during:** Task 6
- **Issue:** the plan asks for "no element whose text is the champ tab's label for `eliminated`". That label IS `"Out of range"` — which is one of Jacob's five statuses on this tab, for a different meaning. A literal absence assertion would have been unsatisfiable against the UI-SPEC's own copy.
- **Fix:** the test asserts (a) `"Contending"` appears nowhere, (b) no element carries the champ tab's `.lock-status-chip--eliminated` class, and (c) every element reading `"Out of range"` carries the `--out-of-range` modifier, which is the median-projection status. The UI-SPEC's own acceptance line only requires `"Contending"` and the old header card.
- **Files modified:** `DistrictLedger.test.tsx`
- **Verification:** `DistrictLedger.test.tsx#never uses the champ tab's word for the eliminated verdict to MEAN eliminated`
- **Committed in:** `19b59015`

**5. [Rule 3 - Blocking] The fetch set widens under a Rewind, to break an otherwise circular dependency**
- **Found during:** Task 4
- **Issue:** the timeline needs the event artifacts' schedules, the stage needs the timeline, and the simulation needs the stage — but choosing WHICH artifacts to fetch from the stage would close the cycle.
- **Fix:** the fetch set is chosen from the RAW `?at=` param (absent or `now` -> the in-progress events; anything else -> every started district-tier event), while the simulation set is narrowed inside the hook by skipping any event whose four categories are all final. SC-5 at the "now" position is untouched, and the plan's own SC-5 wording ("the FIRST paint at the now position ... fetches no event artifact") still holds.
- **Files modified:** `DistrictLedger.tsx`, `useDistrictLedgerData.ts`
- **Verification:** the four Worker-construction assertions above, including the slider-into-a-finished-event case.
- **Committed in:** `b1ce9ff9`

---

**Total deviations:** 5 auto-fixed (2 blocking, 2 bug, 1 missing critical).
**Impact on plan:** No scope creep and no dropped requirement. Three are sequencing choices that avoid shipping a stub at a task boundary (the plan's own rule), one is a shared-module limitation handled in-module because the shared module is out of scope, and one is a test-assertion correction where the plan's own wording was unsatisfiable against the UI-SPEC's copy.

## Issues Encountered

- **The `2026pnw` fixture predates this phase.** The committed snapshot carries no `state` blocks, no `awardProfile`, no `awardBaseRates` and no `bakedEvents`, so at "now" the real fixture renders every category as open-and-unavailable — the honest pre-republish degrade. For the visual check a LOCAL variant was synthesized with those fields injected (six events finished, two mid-quals); it was never staged and lives only in the scratchpad.
- **`data/fixtures/phase10/presim-*.json` are the RANK-simulation pre-schedule sidecars** (`v1/presim/...`), not 10-06's district point sidecars (`v1/district-presim/...`). No district-presim fixture exists yet, so the baked path is covered by synthetic fixtures in the component test rather than by the corpus snapshot.
- **The `fieldSize` fallback is unconditional.** `totalTeams` lives on the TEAM artifact's per-event row, not on the EVENT artifact, so the browser has no published field size to read and always falls back to the roster length. Every event is therefore reported in `gaps.eventsWithFallbackFieldSize` — disclosed rather than absorbed, as 10-04 requires, and asserted by `districtLedgerRows.test.ts#reports the field size as a disclosed fallback`.

## Next Phase Readiness

**Ready for 10-08.** The rendered vocabulary and the drawer's caption claims are fixed and pinned by `districtLedgerCopy.test.ts`. The tab id is `road-to-district-champs`, its panel test id is `road-to-district-champs-panel`, and the tab label reads "Road to District Champs". The test ids 10-08's e2e spec can select on:

`district-ledger-tab`, `district-ledger-controls`, `district-ledger-rewind`, `district-ledger-rewind-readout`, `district-ledger-jump-chips`, `district-ledger-jump-chip`, `district-ledger-status-chips`, `district-ledger-status-chip`, `district-ledger-status-definitions`, `district-ledger-stat-line`, `district-ledger-legend`, `district-ledger-caveat`, `district-ledger-row`, `district-ledger-team-cell`, `district-ledger-status-cell`, `district-ledger-event-cell`, `district-ledger-grand-total`, `district-ledger-drawer`, `district-ledger-drawer-cell-plot`, `district-ledger-drawer-grand-plot`, `district-ledger-drawer-band-label`, `district-hist-band`, `district-hist-bar`, `district-hist-median-tick`, `district-hist-marked-line`, `district-hist-tick`, plus the `data-cell="final" | "open" | "unavailable"` and `data-cell-id="{eventKey}:{category}"` attributes and `road-to-district-champs-panel` / `champ-locks-panel`.

**Nothing owed to 10-09 directly.** This plan is autonomous and networkless; the deploy, republish, push, CI watch and live e2e run are all 10-09's. Two things 10-09 must know:

1. **The tab degrades honestly against a pre-republish artifact** — every category renders open-and-unavailable until 10-06's republish lands `state`, `awardProfile`, `awardBaseRates` and `bakedEvents`. That is by design (10-03 made every added field optional for exactly this window), but it means the district tier looks empty until the republish.
2. **The Worker chunk is emitted** — `vite build` produced `dist/assets/districtSimulation.worker-*.js`, so the inline `new URL(...)` really is being detected and the deployed app will ship a live worker rather than a dead chunk.

---
*Phase: 10-district-points-ledger*
*Completed: 2026-09-25*

## Self-Check: PASSED

- All 13 production files named in `key-files.created` exist on disk.
- All six task commits plus the SUMMARY commit exist in `git log`.
- Every task's `<acceptance_criteria>` was re-run at its own task gate and again in the Task 6 sweep: the repo-root suite is green (278 files, 6241 passed, 1 skipped), `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json` are both clean, and the four glyph, colour, ceiling and diff-scope greps return nothing.
