---
phase: 08-simulation-compare
plan: 14
subsystem: ui
tags: [simulation, rank-distribution, quantile-estimation, chart-geometry, mock-before-build, tanstack-table, vitest]

requires:
  - phase: 08-simulation-compare
    plan: "04"
    provides: "apps/web/src/lib/simQuantile.ts's continuousQuantile() and apps/web/src/lib/simAxis.ts's PLOT_W/SIM_GEOMETRY/x()/rankBandExtent/medianTickLeft/histBarExtent — the single estimator and geometry source this plan's row builder and table consume unchanged"
  - phase: 08-simulation-compare
    plan: "03"
    provides: "packages/core/algorithms/simulation/rankSimulation.ts's simulateRanks/SimResult shape (Int32Array rank histograms) — the exact input this plan's row builder joins to the roster"
  - phase: 08-simulation-compare
    plan: "11"
    provides: "apps/web/src/lib/simulationInputs.ts's buildSimulationInputs/buildQualRows and D-12's baseline precedence rules — the assembly this plan's mock exercises against real bytes"
  - phase: 08-simulation-compare
    plan: "13"
    provides: "SimulationTab.tsx's useSimulationRun()/RunControl wiring and the gated completed SimResult (isResultCurrent) this plan mounts behind"
  - phase: 08-simulation-compare
    plan: "05"
    provides: "The republish ledger (08-05-SUMMARY.md) naming 2024auwarp as the real zero-rp rewind object and 2023cur as the largest pmf-bearing roster — this plan's mock event selection"
provides:
  - "apps/web/src/components/event/rankRows.ts — buildRankDistributionRows/medianDisplayRank/histBarHeight/rankBandLabel, the single row-builder both the shipped table and the mock script import unchanged"
  - "scripts/mockRankDistribution.ts + docs/ui/rank-distribution-mock.md — the committed mock-before-build measurement, run against real published bytes for 2023nhgrs/2024auwarp/2023cur"
  - "apps/web/src/lib/simAxis.ts's rankAxisTicks()/RANK_TICK_MIN_GAP_PX — the computable non-collision tick selection"
  - "apps/web/src/components/event/RankDistributionTable.tsx — the shipped four-column rank-distribution table, mounted in SimulationTab.tsx behind a completed, current simulation result"
affects: ["08-15 (S3 overflow's rendered/touch-interaction half at the 78-team roster; S2's error-state evidence already built in 08-13)"]

actuals:
  tokens: 36440
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A row builder importable by both the browser bundle and a Node tsx script (rankRows.ts, mirroring simQuantile.ts's 08-04 precedent) — the mock-before-build script imports the SHIPPED builder rather than recomputing its own medians/band edges"
    - "A table-level shared axis drawn once in a TanStack column header, with a visually-hidden accessible label sitting beside the visible drawn axis (RankAxisHeader) so a structural four-header-count assertion and the axis's own non-text content can both hold"
    - "Two independent input assemblies for the same event in one measurement script (assembleBaselineOnly at the LAST PLAYED qm row vs assembleDrawLoopInputs at the FIRST qm row) — deliberately never sharing a returned SimMatchInput/baseline array, so a D-12 baseline-provenance finding and the full-rewind draw loop can never accidentally cross-contaminate"

key-files:
  created:
    - apps/web/src/components/event/rankRows.ts
    - apps/web/src/components/event/rankRows.test.ts
    - scripts/mockRankDistribution.ts
    - docs/ui/rank-distribution-mock.md
    - apps/web/src/components/event/RankDistributionTable.tsx
    - apps/web/src/components/event/RankDistributionTable.test.tsx
  modified:
    - apps/web/src/lib/simAxis.ts
    - apps/web/src/lib/simAxis.test.ts
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
    - package.json

key-decisions:
  - "The mock's D-12 baseline-provenance finding uses a start match at the event's LAST PLAYED qm row, deliberately different from the draw loop's own first-row-start (D-05's decision 1, D-12/A2 flagged assumption 1). Starting the baseline check at the first row would leave every team's prefix empty, trivially reporting every team as 'no-played-matches' regardless of whether TBA published a Ranking Score — the opposite of what the finding needs to show. This is a planner-discretion addition beyond the plan's literal 'still run 08-11's baseline assembly' instruction, made necessary once the first attempt (first-row start) produced a vacuous baseline result live."
  - "assembleBaselineOnly and assembleDrawLoopInputs are two structurally separate functions in mockRankDistribution.ts, never sharing a returned remainingMatches/baselines pair — an earlier draft accidentally reused the baseline-only assembly's inputs for the draw-loop simulation itself, which silently changed the draw loop's own start point. Caught and fixed before the Task 2 commit by comparing pre/post band-width numbers against the run's own first pass."
  - "No locked row occurred at either draw-loop-capable sampled event under the plan's fixed full-event-rewind methodology. Reported explicitly per the plan's own acceptance criterion ('If an event has no locked row, the output says so explicitly rather than reporting a vacuous pass') rather than treated as a gap — the underlying bar/band/tick centre-agreement identity is separately proven at the unit level (rankRows.test.ts's locked-row case, simAxis.test.ts's N=78 locked-band case) against 08-04's own recomputed real numbers."
  - "The Distribution column's header cell carries BOTH a visually-hidden ('sr-only') 'Distribution' label and the visible drawn axis, rather than the axis alone. This reconciles two of the plan's own requirements that would otherwise conflict: the header's rendered text must read exactly 'Distribution' (the four-column structural gate) while the axis itself (EventAxisHeader's own precedent) carries no separate text label of its own."

patterns-established:
  - "rankAxisTicks(teamCount): the smallest step from the ladder [1,2,5,10,20,25,50] whose pixel pitch clears RANK_TICK_MIN_GAP_PX (28px), proven non-colliding by computation at N=2/17/39/78 — chart-craft.md's render-it-and-look-at-it rule expressed as a computable property"

requirements-completed: [EVNT-07]

coverage:
  - id: D1
    description: "buildRankDistributionRows joins a SimResult to the event roster, deriving continuous median/p10/p90 from ONE continuousQuantile call per percentile, regressed against sketch 005's three real histograms through the shipped path (not the estimator in isolation)"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/rankRows.test.ts — 25 cases, all passing"
        status: pass
    human_judgment: false
  - id: D2
    description: "The mock-before-build obligation discharged for real: real published EventArtifact bytes, real 1000-draw simulation through the shipped core, one measurement line per row with a hard row-count check, covering a rewind event (2024auwarp) where EventTeamSchema.rp is genuinely absent"
    requirement: EVNT-07
    verification:
      - kind: other
        ref: "pnpm mock:rank-distribution — printed output quoted in this SUMMARY's Mock-before-build findings section; docs/ui/rank-distribution-mock.md committed with full per-row tables for both draw-loop-capable events (117 rows total)"
        status: pass
    human_judgment: false
  - id: D3
    description: "rankAxisTicks/RANK_TICK_MIN_GAP_PX: the shared rank axis's tick selection, proven non-colliding by computation at team counts 2, 17, 39, 78"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simAxis.test.ts — 18 new cases (44 total), all passing"
        status: pass
    human_judgment: false
  - id: D4
    description: "RankDistributionTable: four columns (Team #/Nickname pinned, Median, Distribution), the shared 1..N axis drawn exactly once, and the three-layer plot cell (bars, band, median tick) with band geometry equal to rankBandExtent recomputed independently and no inline opacity on the band"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/RankDistributionTable.test.tsx — 19 cases, all passing"
        status: pass
    human_judgment: false
  - id: D5
    description: "The table mounted in SimulationTab.tsx's layout stack behind 08-13's completed, current run result, constructing no second Worker and repeating no run; 08-09's empty/unavailable/pre-run branches unchanged"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx — 3 new cases (08-14 describe block) plus all 34 pre-existing cases still passing (37 total)"
        status: pass
    human_judgment: false
  - id: D6
    description: "S3 overflow's computed half (node-count budget) at the largest sampled roster (78 teams, 2023cur): 3,034 total absolutely-positioned nodes"
    requirement: EVNT-07
    verification:
      - kind: other
        ref: "docs/ui/rank-distribution-mock.md's Node-count budget table; RankDistributionTable.test.tsx's own 78-team render case"
        status: pass
    human_judgment: true
    rationale: "The rendered/touch-interaction half of UI-SPEC's S3 overflow backstop is explicitly routed to 08-15 by this plan's own decision; a human visual check of the 78-team table at real viewport widths is that plan's job, not this one's."

duration: ~50min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 14: Mock-before-build + rank-distribution table Summary

**The mock-before-build pass discharged for real against real published 1000-draw data (2023nhgrs, 2024auwarp, 2023cur — 117 measured rows total), then the shipped rank-distribution table itself: a shared 1..N axis drawn once, a three-layer plot cell (histogram bars, translucent 10th-90th band, median tick) with every position sourced from 08-04's `simAxis.ts`, mounted behind 08-13's completed simulation result.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-31 (session start)
- **Completed:** 2026-08-31T20:47:48-04:00 (Task 3 commit)
- **Tasks:** 3
- **Files modified:** 11 (6 new, 5 modified)

## Accomplishments

- `rankRows.ts` — `buildRankDistributionRows`, `medianDisplayRank`, `histBarHeight`, `rankBandLabel` — the single row builder joining a `SimResult` to the event roster, one estimator (`continuousQuantile`) producing the median and both band edges, regressed against sketch 005's three real histograms through the shipped path (25 tests).
- `scripts/mockRankDistribution.ts` + `docs/ui/rank-distribution-mock.md` — the mock-before-build pass run for real against `https://data.sigmascout.org`: 117 rows printed and tabled across two draw-loop-capable events, the D-12 summed-fallback baseline proven reachable on `2024auwarp`'s real 25-team roster (zero teams carry `rp`), the histogram-encoding falsification criterion passed at both events, and a genuine "no locked row found" finding reported explicitly per the plan's own allowance.
- `simAxis.ts` extended with `rankAxisTicks`/`RANK_TICK_MIN_GAP_PX` — the shared rank axis's tick selection, proven non-colliding by computation at N=2/17/39/78 (18 new tests).
- `RankDistributionTable.tsx` — the shipped four-column table: Team #/Nickname pinned (mirroring `BreakdownTab.tsx`'s two-column shape), Median, Distribution (the plot cell), with every position derived from `simAxis.ts`/`rankRows.ts` and no positional literal in the component (19 tests).
- Mounted in `SimulationTab.tsx` behind 08-13's completed, current run result; 08-09's empty/unavailable/pre-run branches left byte-for-byte unchanged (confirmed by diff).

## Task Commits

1. **Task 1: The row builder — one estimator, one median, one sort key** — `6fd902ba` (feat)
2. **Task 2: The mock-before-build pass — every row of real events, including one where TBA's Ranking Score is absent** — `67f7be3e` (feat)
3. **Task 3: The rank-distribution table — four columns, one shared axis drawn once, three layers per row — and its mount** — `7b70946c` (feat)

## Mock-before-build findings

Full detail: `docs/ui/rank-distribution-mock.md`. Reproduced here per this plan's own `<output>` instruction.

**1. D-12 reachability and the summed-fallback baseline.** `2024auwarp`'s draw loop CANNOT run — zero of its 47 played `qm` rows carry both `redRpPmf`/`blueRpPmf`, confirmed live against the artifact (matching 08-05's ledger exactly). With the baseline assembly's start set to the LAST PLAYED `qm` row (maximizing the played prefix), all 25 of that event's teams resolve their baseline through `"summed-actual-rp"` (D-12 rule 2), `incompleteBaselineTeamKeyCount: 0` — the summed fallback IS reachable and IS exercised against real bytes. A second, unplanned finding: rule 1 (`ranking-score-with-record`) never fired at ANY of the three sampled events under this methodology, even at the two fully-ranked events — this is `buildSimulationInputs`'s own documented behaviour (rule 1 requires a genuinely non-rewind start), not a defect, and is routed to 08-11's owner as a confirmed-by-measurement fact. The per-team fallback search (a team with played matches and no `rp` while others do) found **0 cases** at both pmf-bearing sampled events, both fully officially ranked.
- **Consequence for 08-11's fallback branch:** none required — the branch behaves exactly as documented. The finding narrows WHEN rule 1 vs rule 2 fires in production (only a genuinely forward, non-rewind start reaches rule 1), which 08-11's owner should be aware of if that distinction is ever surfaced in copy.

**2. Roster completeness (RESEARCH assumption A2).** Held at all three sampled events — every `qm`-appearing team key was present in `teams[]` (39/39, 25/25, 78/78). Assumption A2 was not falsified; the fallback path (`teamNumberFromKey` recovery, em-dash nickname) remains proven only at the unit level.

**3. Histogram-encoding measurement.** Falsification criterion **PASSED** at both draw-loop-capable events: most-locked row's visible-bar count (7 at `2023nhgrs`, 4 at `2023cur`) is far below the most-spread row's (36, 56) — the per-row normalizer demonstrably carries the locked-versus-spread distinction against real data.

**4. Median-display divergence count.** 14/39 rows (35.9%) at `2023nhgrs`, 38/78 rows (48.7%) at `2023cur` have their drawn tick sitting more than 0.25 rank from their printed integer — the measured cost of the continuous-median decision, driven by this run's own maximum-spread full-rewind methodology.

**5. Node-count budget.** 3,034 total absolutely-positioned nodes at the largest sampled roster (`2023cur`, 78 teams) — the computed half of UI-SPEC's S3 `overflow` backstop; 08-15 owns the rendered/touch-interaction half.

### Locked-row alignment result

**Zero locked rows found at either draw-loop-capable event**, reported explicitly per this plan's own acceptance criterion rather than as a vacuous pass. Closest approaches: `frc3310` at `2023cur` (946/1000 draws on rank 1) and `frc9019` at the same event (708/1000 on rank 78). The bar/band/tick triple-centre-agreement identity this check exists to prove is a pure function of `x()`, rank, `teamCount`, `p10`/`p90`/`medianRank` (all derived from the identical `x()` by `simAxis.ts`'s own construction) and is separately proven at the unit level against 08-04's own recomputed real numbers: `rankRows.test.ts`'s "a LOCKED row (all 1000 draws on rank 7 of 39)" case (`p10=6.6, p90=7.4, medianRank=7` exactly) and `simAxis.test.ts`'s N=78 locked-band case. The sketch-convention offset that WOULD have applied to any locked row at these events' team counts: 12.05px at N=39, 6.03px at N=78 — matching `simAxis.ts`'s own header comment's cited figures exactly, confirming the offset formula (`rankSlotWidth(teamCount)`).

### Band-width distribution, all rows vs top 12

| Event | Min | Median (all rows) | Max | Median (top 12 only) |
|---|---:|---:|---:|---:|
| `2023nhgrs` (39 teams) | 2.3067 | 15.7319 | 20.7698 | 11.8458 |
| `2023cur` (78 teams) | 0.8457 | 16.9931 | 27.9368 | 9.5942 |

The top-12-only median is materially tighter than the all-row median at both events — sketch 005's own sampling failure (sampling the first 12 rows was wrong about the field by a factor of three), now visible in measured output rather than merely warned about.

### Deviation from the plan's two recorded judgement calls

**None.** Both the continuous-median decision and the per-row bar normalizer performed exactly as designed: the histogram-encoding falsification criterion (which tests the normalizer) passed at both events, and the median-divergence count (which quantifies the accepted cost of the continuous-median decision) was measured, not found to require a change. Neither judgement call was altered.

## Files Created/Modified

- `apps/web/src/components/event/rankRows.ts` — the row builder (`buildRankDistributionRows`, `medianDisplayRank`, `histBarHeight`, `rankBandLabel`, `MalformedRankHistogramError`)
- `apps/web/src/components/event/rankRows.test.ts` — 25-case regression suite
- `scripts/mockRankDistribution.ts` — the credential-free mock-before-build measurement script
- `docs/ui/rank-distribution-mock.md` — the committed measurement record
- `apps/web/src/components/event/RankDistributionTable.tsx` — the shipped table
- `apps/web/src/components/event/RankDistributionTable.test.tsx` — 19-case render contract
- `apps/web/src/lib/simAxis.ts` — extended with `rankAxisTicks`/`RANK_TICK_MIN_GAP_PX`
- `apps/web/src/lib/simAxis.test.ts` — extended with 18 axis-tick cases (44 total)
- `apps/web/src/components/event/SimulationTab.tsx` — mounts `RankDistributionTable` behind a completed, current result
- `apps/web/src/components/event/SimulationTab.test.tsx` — extended with an `08-14` describe block (3 cases); I1/I7 (08-13) wrapped in a router test harness since they now reach a completed result that mounts real router `Link`s
- `package.json` — added `mock:rank-distribution` script (no `--env-file`)

## Decisions Made

See `key-decisions` in frontmatter. In brief: (1) the D-12 baseline-provenance mock finding measures at the LAST PLAYED `qm` row, not the first, because the first-row start trivially reports every team as "no-played-matches" regardless of `rp` presence; (2) the mock's baseline-only assembly and its draw-loop assembly are kept structurally separate after an early draft accidentally conflated them; (3) a zero-locked-row live result is reported honestly rather than worked around; (4) the Distribution column header carries both a visually-hidden text label and the visible axis to satisfy both the four-column structural gate and the axis's own no-separate-label precedent.

## Deviations from Plan

### Auto-fixed Issues

None requiring a Rule 1/2/3 fix on already-committed code. Two implementation bugs were found and corrected during Task 2's own authoring, before any commit was made (not a post-commit deviation): the baseline-only assembly initially used the array's literal last row (which can be an unplayed row sorted after every played one by `compareEventMatchRows`'s own timestamp-presence rule) instead of the last PLAYED row, and the draw-loop simulation initially reused the baseline-only assembly's own `remainingMatches`/`baselines` instead of performing its own separate first-row-start assembly. Both were caught by comparing the mock's live printed output against expectations before committing, and are recorded as Decisions (frontmatter `key-decisions`) since they reflect real design choices, not silent code changes.

Two existing 08-13 test cases (I1, I7 in `SimulationTab.test.tsx`) began failing once `RankDistributionTable`'s real router `Link`s mounted after a completed run — a genuine regression this plan's own mount introduces. Fixed under Rule 1 (bug in the test's own missing infrastructure, not production code) by wrapping only those two render calls in a scoped `RouterTestHarness`, leaving all other pre-existing cases (which never reach a completed result) untouched.

---

**Total deviations:** 1 auto-fixed (Rule 1 — the I1/I7 router-context regression, test infrastructure only); 4 documented design decisions (see Decisions Made).
**Impact on plan:** None on scope. All `must_haves.truths`, prohibitions, and the full `<verification>` block are satisfied as written, including the explicitly-anticipated zero-locked-row outcome.

## Issues Encountered

None beyond the two items already covered under Deviations from Plan.

## Known Stubs

None. No component reads placeholder or empty data; the S3 `overflow` backstop's rendered/touch half is an explicit ownership split to 08-15 (named in this plan's own `<artifacts_this_phase_produces>` section), not a stub or a drop.

## Threat Flags

None. This plan's own `<threat_model>` register (T-08-14-01 through T-08-14-05, T-08-14-SC) covers every surface this plan introduces — the render-layer structural checks against a malformed histogram, the credential-free measurement script's own structural incapacity to leak a credential, and the gitignored-report write path — and no new surface outside that register was found during implementation.

## User Setup Required

None — no external service configuration required. `.env` was never `Read`, `cat`'d, `echo`'d or interpolated at any point; `scripts/mockRankDistribution.ts` holds no credential of any kind (verified by its own grep gates: zero matches for the environment-variable/dotfile-loading constructs, zero matches for any signing-helper import).

## Next Phase Readiness

- **Routed to 08-15:** the S3 `overflow` backstop's computed half (node-count budget, 3,034 nodes at 78 teams) is already measured and documented in `docs/ui/rank-distribution-mock.md`; 08-15 owns the rendered/touch-interaction half at that same roster size.
- **Routed to 08-11's owner:** the finding that D-12 rule 1 (`ranking-score-with-record`) is unreachable from any rewind-start baseline measurement, confirmed live at three real events — a fact about `buildSimulationInputs`'s own documented behaviour, not a defect, but worth knowing if 08-11's baseline-provenance copy is ever surfaced to a reader.
- **Explicit confirmations:** no new npm dependency (`git diff --stat package.json pnpm-lock.yaml` shows only the one added script line across all three tasks), no `--color-*`/`--accent`/`--alliance-*`/`--tier-*` token changed, no CSS custom property added or edited (`theme.css` diff empty since Task 2), no published field, no schema change, no R2 write, no second Worker constructed anywhere in this plan.
- Full web suite: 1136/1136 passing (baseline 1071 at 08-13 close, +65 new tests: rankRows 25, simAxis +18, RankDistributionTable 19, SimulationTab +3). Repo-wide: 2642/2645 passing, the same two pre-existing accepted `payloadBudget.test.ts` failures (WINDOWS.md ledger #11/#15) — zero new failures anywhere.

## Self-Check: PASSED

All 6 created files confirmed present on disk (`apps/web/src/components/event/rankRows.ts`, `rankRows.test.ts`, `scripts/mockRankDistribution.ts`, `docs/ui/rank-distribution-mock.md`, `apps/web/src/components/event/RankDistributionTable.tsx`, `RankDistributionTable.test.tsx`); all 3 task commits (`6fd902ba`, `67f7be3e`, `7b70946c`) confirmed in `git log --oneline`.

## Post-close fix: web typecheck regression (found by 08-15, fixed here, 2026-08-31)

**The durable lesson, not the two missing params.** This plan's own Task 3 verification ran
`npx tsc --noEmit` at the repo root and it was clean, so the plan closed believing typecheck was
green. It was not: the repo root's `tsc --noEmit` does **not** cover `apps/web` (that project has
its own `tsconfig.json` and its own `pnpm --filter web typecheck` script), so a real type error
inside `apps/web/src` is invisible to the root-level check this plan's `<verification>` block
actually ran. `RankDistributionTable.tsx`'s two Team #/Nickname `Link` calls omitted the required
`algorithm` search param (`TeamSearchSchema` requires it; the search objects here only carried
`year`/`tab`) — a real error `pnpm --filter web typecheck` would have caught immediately, and did,
once 08-15 ran it. **The trap for future plans in this repo: the root `pnpm typecheck` is not a
substitute for `pnpm --filter web typecheck` when the touched files live under `apps/web` — both
must be run, and the plan's own `<verification>` block should say so explicitly for any
apps/web-touching plan, not just this one.**

08-15 correctly declined to fix this itself (out of its own declared file scope) and routed it
back here. Fixed by threading the real `algorithmId` — never a hardcoded `"vpr"` literal, even
though this tab is VPR-only per D-04 — from `SimulationTab`'s own prop through
`RankDistributionTable`'s props and `buildRankTableColumns`, cast to `PublishedAlgorithmId` at the
one call site that needs it via the same loose-cast escape hatch `InsightsTab.tsx`/`BreakdownTab.tsx`
already use. `pnpm --filter web typecheck`: exit 0. `npx vitest run apps/web/src`: 1140/1140, no
regression from 08-15's own close. One test fixture (`RankDistributionTable.test.tsx`'s
`renderTable` helper) updated to pass `algorithmId="vpr"`, matching the corrected prop shape.
Commit: `da26713f`.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
