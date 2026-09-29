---
phase: 10-district-points-ledger
plan: 01
subsystem: testing
tags: [district-points, frc, monte-carlo, reconciliation, corpus, typescript, vitest]

requires:
  - phase: 09
    provides: "packages/core/districts/pointModel.ts (per-component ceilings, DISTRICT_REGISTERED_SEASONS, UnknownDistrictSeasonError) and reconciliation.test.ts's corpus-guarded harness shape"
  - phase: 07
    provides: "packages/core/algorithms/simulation/rankSimulation.ts and its Tests 1-21 regression oracle"
provides:
  - "qualPoints.ts — erfinv, qualPoints(rank, fieldSize), districtTierWeight (phase 10's single DCMP weight source), districtQualPoints"
  - "selectionPoints.ts — selectionPoints(pickSlot, allianceNumber), districtSelectionPoints"
  - "bracket.ts — BRACKET_SETS (one topology table), routeBracket(decide), PLAYOFF_PLACEMENT_POINTS, playoffPoints, DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS/PMF, divisionedDcmpPlayoffPmf"
  - "pointFormulas.reconciliation.test.ts — corpus proof of all three formulas against real TBA-reported values"
  - "simulateRanks's optional fifth parameter onDraw (SimDrawHook) — the per-draw finishing order, which is where per-draw correlation becomes observable"
affects: [10-04, 10-06, 10-07, 10-08]

actuals:
  tokens: 28540
  tasks: 4
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Browser-safe leaf module: only sibling imports, no DOM, no Node built-in — so Worker, pipeline and browser bundle can all take it"
    - "Corpus reconciliation pins POPULATIONS and EXCLUSIONS, not just the mismatch count, so an ingest regression turns the test red instead of quietly proving less"
    - "One topology table, two deciders (real matches in the test, Monte Carlo in 10-04) — the corpus test proves the exact code the browser will run"
    - "Committed counts, not committed probabilities, for a measured empirical table: an integer count reproduces bit for bit where 1/3 has no exact literal"

key-files:
  created:
    - packages/core/districts/qualPoints.ts
    - packages/core/districts/qualPoints.test.ts
    - packages/core/districts/selectionPoints.ts
    - packages/core/districts/selectionPoints.test.ts
    - packages/core/districts/bracket.ts
    - packages/core/districts/bracket.test.ts
    - packages/core/districts/pointFormulas.reconciliation.test.ts
  modified:
    - packages/core/algorithms/simulation/rankSimulation.ts
    - packages/core/algorithms/simulation/rankSimulation.test.ts

key-decisions:
  - "districtTierWeight lives in qualPoints.ts and is derived as the ratio of pointModel.ts's two public qual ceilings, never a literal 3 — pointModel.ts keeps its weight table private, so the ratio is the only way to read it without copying it, and pointModel.ts is shipped code this phase has no reason to touch"
  - "Playoff points are a FINAL-PLACEMENT table (30/20/13/7/0/0/0/0), not a per-round exit table — the research's round annotation was wrong, its topology was right"
  - "The eight-alliance restriction on the selection reconciliation filters by MEASURED alliance count, never by season or event key, so it also catches divisioned-dcmp parents and anything a future ingest adds"
  - "The divisioned-dcmp fallback commits observation COUNTS and normalizes to probabilities at module load, so the corpus test can assert the table cell for cell"
  - "onDraw is an optional FIFTH POSITIONAL parameter, invoked after histogram accumulation and outside the rng path — the minimal non-breaking shape, so both existing four-argument call sites keep compiling untouched"
  - "A three-pick alliance whose teams report differing elim_points is excluded and counted, but its PLACEMENT is still proven by asserting the highest observed value equals the routed expectation — set aside the split slot, not the proof"

patterns-established:
  - "Pinned-population reconciliation: floor on checked, ceiling on every exclusion, plus a terminal non-vacuity assertion"
  - "Refuse-to-guess typed errors (ErfInvDomainError, InvalidRankInputError, InvalidPickSlotError, InvalidPlacementError, UnsupportedBracketSeasonError, UnsupportedAllianceCountError, InvalidBracketDecisionError) over silent defaults, following UnknownDistrictSeasonError"
  - "Every corpus-guarded module carries pure unit tests that run with no corpus, because the reconciliation test skips in CI and a green skip proves nothing"

requirements-completed: [SC-2, SC-6]

coverage:
  - id: D1
    description: "Qualification points from rank and field size reproduce every resolvable district-tier qual_points TBA reported, across all ten registered seasons"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "packages/core/districts/qualPoints.test.ts (19 tests)"
        status: pass
      - kind: integration
        ref: "packages/core/districts/pointFormulas.reconciliation.test.ts — qualification block, 29,796 checked, 0 mismatches, 75 unresolvable"
        status: pass
    human_judgment: false
  - id: D2
    description: "Alliance selection points from pick slot and alliance number reproduce every resolvable alliance_points at eight-alliance district events, all ten seasons"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "packages/core/districts/selectionPoints.test.ts (14 tests, exhaustive over all 32 slot-by-alliance combinations)"
        status: pass
      - kind: integration
        ref: "packages/core/districts/pointFormulas.reconciliation.test.ts — selection block, 20,209 checked, 0 mismatches"
        status: pass
    human_judgment: false
  - id: D3
    description: "One bracket topology routes both real match results and any future Monte Carlo decider; placement maps to 30/20/13/7/0 and reproduces TBA's elim_points"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "packages/core/districts/bracket.test.ts (25 tests, including the placement-permutation invariant over 2,000 randomized routings)"
        status: pass
      - kind: integration
        ref: "packages/core/districts/pointFormulas.reconciliation.test.ts — playoff block, 478 brackets routed, 10,278 values checked, 0 mismatches"
        status: pass
    human_judgment: false
  - id: D4
    description: "A non-eight-alliance district event gets a measured empirical pmf from a committed table; an unregistered count or a pre-2023 season throws"
    requirement: "SC-6"
    verification:
      - kind: integration
        ref: "packages/core/districts/pointFormulas.reconciliation.test.ts — reproduces DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS exactly from the corpus, cell for cell"
        status: pass
      - kind: unit
        ref: "packages/core/districts/bracket.test.ts — divisionedDcmpPlayoffPmf typed-error and pmf-shape cases"
        status: pass
    human_judgment: false
  - id: D5
    description: "simulateRanks hands every draw's complete finishing order to a caller, provably the same ranking that draw's histogram recorded, with the existing four-argument behaviour and rng consumption unchanged"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/rankSimulation.test.ts — Tests 22 through 28 (15 new cases), plus Tests 1-21 unmodified and green"
        status: pass
      - kind: integration
        ref: "npx vitest run apps/web/src/workers/simulationProtocol.test.ts packages/harness/preSchedule.test.ts — both existing four-argument call sites, 38 tests"
        status: pass
    human_judgment: false

duration: 25 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 01: District point formulas and the per-draw simulation hook Summary

**Three browser-safe district point formula modules — qualification, alliance selection and playoff placement — each reconciled to zero mismatches against real TBA-reported corpus values (29,796 + 20,209 + 10,278 rows), plus an additive `onDraw` hook that hands `simulateRanks`'s per-draw finishing order to a caller without changing a single existing histogram or rng call.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-25T09:24Z
- **Completed:** 2026-09-25T09:49Z
- **Tasks:** 4 of 4
- **Files modified:** 9 (7 created, 2 modified), 2,574 insertions, 5 deletions

## Accomplishments

- **Every district point formula the Road to District Champs tab will print is now proven against TBA's own reported numbers, not against a hand-typed fixture.** Three blocks, zero mismatches in all three, each pinning its population and its exclusions rather than only its mismatch count.
- **One bracket topology table serves both deciders.** `routeBracket(decide)` is routed in the reconciliation test by real `matches` rows and will be routed in 10-04 by a Monte Carlo decider — so the corpus test proves the exact routing code the browser will run, and 10-04 never re-derives the bracket.
- **The per-draw correlation the ledger depends on is now observable.** `simulateRanks` accepts an optional fifth `onDraw` parameter; its order is provably the ranking that draw's histogram recorded, asserted over every rank column, and the existing four-argument callers are byte-identical.
- **Two planning facts were corrected against the corpus during execution** (see Deviations): the plan's qualification total, and the scope of Fact 3's backup-robot exclusion.

## Measured reconciliation results

All figures below are printed by `pointFormulas.reconciliation.test.ts` itself on every run in a checkout with `data/corpus.sqlite`, and asserted rather than merely logged. Run with `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts --reporter=verbose --silent=false` to reproduce the output.

### Qualification block — 29,796 checked, 0 mismatches

| Season | Checked | Mismatches | Unresolvable |
|---|---|---|---|
| 2016 | 2,314 | 0 | 0 |
| 2017 | 2,845 | 0 | 0 |
| 2018 | 3,055 | 0 | 0 |
| 2019 | 3,519 | 0 | 0 |
| 2020 | 1,193 | 0 | 75 |
| 2022 | 2,854 | 0 | 0 |
| 2023 | 3,146 | 0 | 0 |
| 2024 | 3,321 | 0 | 0 |
| 2025 | 3,464 | 0 | 0 |
| 2026 | 4,085 | 0 | 0 |
| **Total** | **29,796** | **0** | **75** |

The 75 unresolvable rows are all in 2020, the truncated season, and carry no `event_rankings` row at all. Every per-season figure matches the plan's Fact 4 exactly; their sum is 29,796, not the 29,896 Fact 4 states (see Deviations).

### Alliance selection block — 20,209 checked, 0 mismatches

| Season | Checked | Mismatches | Absent team | Dcmp-tier slots | Excluded non-eight alliances |
|---|---|---|---|---|---|
| 2016 | 1,477 | 0 | 83 | 168 | 16 |
| 2017 | 1,838 | 0 | 82 | 312 | 4 |
| 2018 | 1,952 | 0 | 88 | 336 | 6 |
| 2019 | 2,296 | 0 | 104 | 360 | 6 |
| 2020 | 825 | 0 | 15 | 0 | 0 |
| 2022 | 1,731 | 0 | 45 | 384 | 102 |
| 2023 | 2,255 | 0 | 63 | 420 | 10 |
| 2024 | 2,380 | 0 | 41 | 425 | 10 |
| 2025 | 2,473 | 0 | 55 | 437 | 10 |
| 2026 | 2,982 | 0 | 69 | 527 | 10 |
| **Total** | **20,209** | **0** | **645** | **3,369** | **174** |

Every per-season checked count matches Fact 5 exactly, and the excluded-non-eight total (174, with 102 in 2022) matches too. Fact 5's single figure of 4,014 unresolved pick slots is reproduced as its two real causes: 645 slots whose team has no `event_points_raw` entry for the event at any tier (a non-district team playing a district event) plus 3,369 whose only entry is dcmp-tier (a district championship's own alliances, outside this base-tier block's scope). 645 + 3,369 = 4,014.

**The eight-alliance restriction was verified load-bearing, not decorative.** Removing it (a one-off local flip of `reconcileSelectionPoints(year, false)`, reverted before commit) produces exactly **209 mismatches in 2022**, every one at a COVID-era four-alliance split-day district event — `2022dc305`, `2022on034`, `2022va319` and siblings — whose values read as if seeded on a four-alliance ladder (alliance 2's captain reads 14 where the eight-alliance model says 15, alliance 4's second pick reads 8 where it says 4). The restriction and its reason are written into the test's own comment.

### Playoff bracket block — 478 brackets routed, 10,278 checked, 0 mismatches

| Season | Brackets reconciled | Unreconcilable | Checked | Mismatches | Four-robot alliances excluded | Prorated three-pick | Absent team |
|---|---|---|---|---|---|---|---|
| 2023 | 105 | 6 | 2,253 | 0 | 70 | 0 | 57 |
| 2024 | 112 | 3 | 2,407 | 0 | 81 | 1 | 35 |
| 2025 | 118 | 3 | 2,605 | 0 | 58 | 0 | 53 |
| 2026 | 143 | 1 | 3,013 | 0 | 121 | 0 | 56 |
| **Total** | **478** | **13** | **10,278** | **0** | **330** | **1** | **201** |

478 is comfortably above the plan's floor of 400. The 13 unreconcilable events carry a complete eight-alliance bracket whose real `matches` rows cannot resolve a routing (a tie or an unplayed set); they are counted, never silently dropped.

### Divisioned-dcmp fallback table — measured from 16 parent events

Population: the 16 divisioned district championship parents of 2023 through 2026 — `micmp` (four alliances, one per season) and `necmp`/`oncmp`/`txcmp` (two alliances each, one set per season). **7 alliances resolve to no `district_rankings` entry at all and are excluded; 0 show a prorated disagreement.** The committed table is re-measured from the corpus and asserted cell for cell in the same run.

`DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS`, as committed (base point values, i.e. raw `elim_points` divided by the 3x DCMP weight):

| Alliance count | Alliance number | Observations |
|---|---|---|
| 2 | 1 | 0 pts x3, 10 pts x7 |
| 2 | 2 | 0 pts x5, 10 pts x5 |
| 4 | 1 | 0 pts x1, 10 pts x1, 20 pts x1 |
| 4 | 2 | 10 pts x1, 20 pts x2 |
| 4 | 3 | 0 pts x2, 20 pts x1 |
| 4 | 4 | 0 pts x2, 10 pts x2 |

`DIVISIONED_DCMP_PLAYOFF_PMF` normalizes these counts to probabilities once at module load. Counts rather than probabilities are what is committed because an integer count reproduces bit for bit while 1/3 has no exact decimal literal. **The sample is small** — ten observations per two-alliance seed, three or four per four-alliance seed — and it is the entire population that exists. The value set 0/10/20 is disjoint from the eight-alliance set except at 20, which is why a fabricated bracket for these events would be wrong.

## Task Commits

1. **Task 1 (tracer): qualification points, end to end against real corpus rows** — `c3d073fb` (feat)
2. **Task 2: alliance selection points, reconciled against real pick slots** — `ee12bd3d` (feat)
3. **Task 3: bracket topology, placement points, measured non-eight fallback** — `b05098e9` (feat)
4. **Task 4: the additive per-draw `onDraw` hook on `simulateRanks`** — `ac75994d` (feat)

Per the plan's own `<verification>` item 5 ("one commit per task, four commits"), the two `tdd="true"` tasks were written test-first but committed once each rather than split into RED/GREEN commits. RED was confirmed locally for both (Task 2's selection tests failed on the absent module before it was written).

## Files Created/Modified

- `packages/core/districts/qualPoints.ts` — `ErfInvDomainError`, `InvalidRankInputError`, `erfinv` (hand-written Winitzki, no new dependency), `qualPoints(rank, fieldSize)`, `districtTierWeight(season, tier)`, `districtQualPoints`. One import line, the `./pointModel.js` sibling.
- `packages/core/districts/qualPoints.test.ts` — 19 pure unit tests.
- `packages/core/districts/selectionPoints.ts` — `InvalidPickSlotError`, `selectionPoints(pickSlot, allianceNumber)`, `districtSelectionPoints`.
- `packages/core/districts/selectionPoints.test.ts` — 14 tests, exhaustive over all 32 slot-by-alliance combinations, and pins the wrong `9 - allianceNumber` second-pick form as a negative assertion.
- `packages/core/districts/bracket.ts` — `BRACKET_SETS`, `routeBracket`, `BracketDecider`, `PLAYOFF_PLACEMENT_POINTS`, `playoffPoints`, `assertBracketSeason`, `BRACKET_REGISTERED_SEASONS`, `DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS`, `DIVISIONED_DCMP_PLAYOFF_PMF`, `divisionedDcmpPlayoffPmf`, and four typed error classes.
- `packages/core/districts/bracket.test.ts` — 25 tests, including the eight-distinct-placements invariant over 2,000 randomized routings and the best-of-three short circuit.
- `packages/core/districts/pointFormulas.reconciliation.test.ts` — all three corpus blocks plus the fallback-table re-measurement. Skips with an explicit message where `data/corpus.sqlite` is absent.
- `packages/core/algorithms/simulation/rankSimulation.ts` — new `SimDrawHook` export, new optional fifth parameter `onDraw`, header prose updated. `SimResult` and every existing export unchanged.
- `packages/core/algorithms/simulation/rankSimulation.test.ts` — Tests 22 through 28 appended. 243 insertions, **0 deletions**; 22 pre-existing tests to 37.

## Decisions Made

- **The DCMP weight has exactly one home.** `districtTierWeight(season, tier)` in `qualPoints.ts`, derived as `maxEventPoints(season, "dcmp").qual / maxEventPoints(season, "district").qual`. `selectionPoints.ts` and `bracket.ts` import it; neither re-derives it. The doc comment says why it is not in `pointModel.ts`, so the next reader does not "clean it up" into a third location.
- **A prorated alliance is set aside, not its placement.** Rather than dropping a prorated alliance outright, the playoff block asserts that the highest value its teams report equals the routed placement's expectation — so the routing stays proven and only the split slot is excluded.
- **The fallback table throws on an unobserved cell.** No smoothing, no uniform prior. `divisionedDcmpPlayoffPmf(8, n)` also throws: eight alliances route, they never read the table.
- **`onDraw` receives the function's own reused buffer**, documented plainly at the type and asserted by a test (Test 28) that shows the failure mode a caller who does not copy will hit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's qualification total is an arithmetic slip; the corpus says 29,796, not 29,896**
- **Found during:** Task 1 (tracer)
- **Issue:** Fact 4 lists ten per-season counts and states their total as 29,896. The plan's `must_haves` and Task 1's acceptance criteria both repeat that total. Every one of the ten per-season figures reproduces EXACTLY against the corpus, but they sum to 29,796 — the total is 100 too high. Asserting a floor of 29,896 would have been unsatisfiable against correct data.
- **Fix:** Asserted the ten per-season floors (each matched exactly) rather than a wrong aggregate. Recorded the corrected total in `qualPoints.ts`'s header and in the reconciliation test's own comment, both naming the plan's figure and why it differs, so nobody later "fixes" the code to match the plan.
- **Files modified:** `packages/core/districts/qualPoints.ts`, `packages/core/districts/pointFormulas.reconciliation.test.ts`
- **Verification:** Per-season counts printed and asserted; the block reports 29,796 checked, 0 mismatches, 75 unresolvable.
- **Committed in:** `c3d073fb`

**2. [Rule 2 - Missing critical] Fact 3's backup-robot exclusion misses a real shape, and dropping the row would have lost the proof**
- **Found during:** Task 3
- **Issue:** Fact 3 scopes the proration exclusion to alliances whose `picks` array has four entries. At `2024onwat` alliance 2 — the event winner — a backup robot (`frc9659` replaced by `frc9663`, visible in the first final's `red_teams`) took a share of the slot WITHOUT TBA adding a fourth `picks` entry, so the alliance reads 30, 30, 25 against a placement worth 30. That produced the block's only mismatch, out of 10,279 values, and it was a data shape rather than a routing error.
- **Fix:** Three-pick alliances whose resolvable `elim_points` disagree are now excluded and COUNTED separately (`proratedThreePick`, ceiling pinned at 1). Rather than dropping them silently, the block asserts that the HIGHEST value observed on such an alliance equals the routed placement's expectation — the unprorated teams carry the full value, so the placement is still proven and only the split slot is set aside.
- **Files modified:** `packages/core/districts/pointFormulas.reconciliation.test.ts`
- **Verification:** Playoff block now reports 478 events, 10,278 checked, 0 mismatches, 1 prorated three-pick alliance.
- **Committed in:** `b05098e9`

**3. [Rule 3 - Blocker] `packages/corpus/db.ts` is reached as `../../corpus/db.js`, not `packages/core/corpus`**
- **Found during:** Task 1
- **Issue:** Minor path discovery — `openCorpusReadOnly` lives at `packages/corpus/db.ts`, which from `packages/core/districts/` resolves as `../../corpus/db.js`. Mirrored from `reconciliation.test.ts` exactly, so no change was needed once located.
- **Fix:** None required; noted for the next plan's benefit.
- **Committed in:** `c3d073fb`

---

**Total deviations:** 2 substantive auto-fixes (1 x Rule 1, 1 x Rule 2) plus 1 trivial path discovery.
**Impact on plan:** Both substantive deviations strengthen the proof rather than weaken it. Neither changes the plan's scope, its file list, or any shipped formula — deviation 1 corrects a number in the plan's own prose, and deviation 2 generalizes an exclusion rule while keeping the placement it would otherwise have dropped.

## Issues Encountered

- **An unrelated `apps/web` test is load-flaky.** The first full-suite run showed `apps/web/src/components/team/MetricHistoryTab.test.tsx > skeleton legend spacer` timing out at 5,000 ms. It passes in isolation (7/7 in 2.47s) and the immediately following full-suite re-run was fully green (254 files, 5,671 passed, 1 skipped). `apps/web` keeps vitest's 5s default while the root node project raises `testTimeout` to 30s for exactly this reason. **No file in this plan touches that test or anything it imports**, so under the executor's scope boundary it was not fixed. Flagged here for whoever owns the web suite's timeout configuration.
- The Git Bash heredoc failed on the large test-append (the known `project_subagent_summary_write_block` / long-prose heredoc issue on this machine); the `Edit` tool was used instead.

## User Setup Required

None - no external service configuration required. Nothing in this plan fetches, publishes, deploys or installs; `package.json` and the lockfile are untouched (verified by `git diff --stat 445ef142..HEAD -- package.json pnpm-lock.yaml`, empty).

## Self-Check: PASSED

- All 9 files in the plan's `files_modified` exist on disk.
- All four task commits exist in `git log` (`c3d073fb`, `ee12bd3d`, `b05098e9`, `ac75994d`).
- Plan `<verification>` re-run at close-out:
  1. `npx vitest run packages/core/districts packages/core/algorithms/simulation` — 151 + 37 tests green, reconciliation shows real assertions with counts printed, not a skip.
  2. `npx vitest run` from the repo root — 254 files, 5,671 passed, 1 skipped, 0 failed.
  3. `npx tsc --noEmit` clean AND `npx tsc --noEmit -p apps/web/tsconfig.json` clean.
  4. No `package.json` and no lockfile in the diff.
  5. `git log --oneline` — four commits, one per task, each naming its task.

## Next Phase Readiness

Ready for 10-02 (award base-rate tables) and, in wave order, for the plans that consume this file set:

- **10-04** imports `routeBracket` with a Monte Carlo decider, `playoffPoints`, `divisionedDcmpPlayoffPmf`, `districtQualPoints`, `districtSelectionPoints`, and calls `simulateRanks` with an `onDraw` hook. Two things it must know: the `order` array handed to the hook is **reused between draws and must be copied** if kept, and `divisionedDcmpPlayoffPmf` **throws for an alliance count of 8** — eight alliances route, they never read the fallback.
- **10-06** imports the same three formula modules for the offline bake.
- **10-08** states the selection model's measured agreement on the methodology page. Every number it needs is in the tables above and every one traces to a committed artifact: the 20,209-of-20,209 selection figure, the 29,796 qualification figure, and the 478-bracket / 10,278-value playoff figure.

Two caveats worth carrying forward. The divisioned-dcmp fallback rests on a **very small sample** (16 parent events, 7 alliances unresolvable) and should be described as empirical rather than modelled wherever it surfaces. And the reconciliation test **skips wherever `data/corpus.sqlite` is absent**, which is CI — the per-module unit tests are what CI actually proves, so any future change to these formulas must keep them in step.

---
*Phase: 10-district-points-ledger*
*Completed: 2026-09-25*
