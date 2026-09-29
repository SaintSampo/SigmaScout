---
phase: 10-district-points-ledger-the-road-to-district-champs-tab-from-
plan: 04
subsystem: districts
tags: [monte-carlo, district-points, alliance-selection, bracket, quantile, web-worker, corpus-reconciliation]

requires:
  - phase: 10-01
    provides: "districtQualPoints, districtTierWeight, districtSelectionPoints, BRACKET_SETS, routeBracket, playoffPoints, divisionedDcmpPlayoffPmf, assertBracketSeason, and simulateRanks's optional onDraw hook"
  - phase: 10-02
    provides: "allianceWinProbability with its AllianceMemberRating input type, and awardBaseRate with AWARD_POINT_SUPPORT and its source rung"
  - phase: 10-03
    provides: "DistrictPointPmfSchema's offset encoding, which encodeDistrictPointPmf serialises into"
provides:
  - "simulateDistrictEvent: one joint run over one district event yielding a correlated (qual, selection, playoff, award) quadruple per team per draw, plus the per-draw event total, as five per-team Int32Array marginals of the same runs"
  - "Stage awareness: alliances announced, playoffs done and awards posted are optional inputs; a finished qualification stage is zero remaining matches and the slider's rewind is the caller's row selection"
  - "The progressive captain rule and the serpentine draft, reconciled against every 2023-plus eight-alliance district event in the corpus"
  - "convolveDistrictGrandTotal: the exact N-event convolution plus rookie bonus and adjustments"
  - "encodeDistrictPointPmf: the event-level publish-boundary encoder into 10-03's offset encoding (and deliberately no grand-total encoder)"
  - "pointSummary.ts: the single module the blue-cell text rules live in"
  - "continuousQuantile promoted to packages/core, reachable from the Worker and the Node pipeline"
affects: [10-06, 10-07, 10-08]

actuals:
  tokens: 36263
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Two mulberry32 streams from one seed, so a per-draw hook consumes none of the rank stream and the joint run's rank marginal is bit-identical to a bare simulateRanks run"
    - "Per-draw observer as a test seam outside the structured-cloneable input object, so correlation can be asserted per draw rather than on aggregates"
    - "Teacher-forced corpus reconciliation of a model rule, with the rejected alternative rule scored beside it in the same run"

key-files:
  created:
    - packages/core/algorithms/simulation/continuousQuantile.ts
    - packages/core/algorithms/simulation/continuousQuantile.test.ts
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - packages/core/districts/selectionModel.reconciliation.test.ts
    - packages/core/districts/pointSummary.ts
    - packages/core/districts/pointSummary.test.ts
  modified:
    - apps/web/src/lib/simQuantile.ts
    - packages/harness/browserSafeSchemas.test.ts

key-decisions:
  - "Captains follow the PROGRESSIVE rule, not the top eight by ranking. The plan's own brief said top eight; the corpus says that is right at 3 of 491 events, while the progressive walk is right at 3,879 of 3,880 captain slots."
  - "Round two of the draft runs alliance N down to 1 (serpentine), from the measured second-pick rank gradient of 24.83 at alliance 1 falling to 20.10 at alliance 8."
  - "Declines are NOT modelled. The measured size of that omission is one captain slot in 3,880, at 2026milac alliance 8."
  - "Two mulberry32 streams from one seed (LEDGER_STREAM_SALT), so the district tab's qualification marginal reproduces the event page's Simulation tab exactly for the same seed."
  - "Every stage is an optional INPUT and there is deliberately no quals-known flag: a finished qualification stage is zero remaining matches, so one state has one expression."
  - "A known stage's work is SKIPPED rather than routed and discarded, because routing a bracket and throwing the result away would consume the ledger stream and change every later draw."
  - "A backup robot (supplied pick slot 3) does NOT enter the roster the bracket is priced from — it replaces a robot rather than adding one — but it does receive the alliance's placement points and its own selection value of zero."
  - "The whole module is scoped to 2023 and later via assertBracketSeason in the up-front validation, rather than letting playoffPoints raise it from inside the draw loop."
  - "A negative combined rookie-bonus-plus-adjustment shift THROWS rather than clamping, because adjustments is 0 in all 16,345 corpus rows so clamping would fabricate a value."
  - "No grand-total encoder exists at all: point_total reaches 445 in the corpus against DistrictPointPmfSchema's 256-entry cap, and the grand total is browser-side and never published."
  - "continuousQuantile was PROMOTED to packages/core rather than copied, with apps/web/src/lib/simQuantile.ts left as a re-export so all four importers are byte-unchanged."

patterns-established:
  - "Correlation proof by per-draw assertion: the rank-one team is alliance 1's captain in that same draw, and no unallied team outranks any captain, over 2,000 draws with zero violations. A marginal comparison cannot detect a broken join."
  - "Non-perturbation pin: exact integer equality between a hooked run's derived marginal and a bare unhooked run's histogram pushed through the same formula, under one seed."
  - "Measure the rejected rule beside the adopted one in the same corpus test, so a later simplification back to the rejected rule turns the suite red."
  - "Cost is measured and printed, never asserted against a millisecond bar."

requirements-completed: [SC-2]

coverage:
  - id: D1
    description: "One joint run over one district event yields a CORRELATED (qual, selection, playoff, award) quadruple per team, proven per draw rather than by marginal comparison"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#in EVERY draw the team the ranking placed first is alliance 1's captain, and no unallied team outranks any captain"
        status: pass
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#each category's histogram sums to draws for every team, and the per-draw quadruple sums to that draw's event total"
        status: pass
    human_judgment: false
  - id: D2
    description: "The joint run perturbs the ranking not at all: the qualification marginal is bit-identical to a bare four-argument simulateRanks run pushed through districtQualPoints"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#the qualification marginal is entry-for-entry identical to a bare four-argument simulateRanks run pushed through districtQualPoints, under the same seed"
        status: pass
    human_judgment: false
  - id: D3
    description: "The bracket is priced by 10-02's single measured allianceWinProbability through 10-01's single routeBracket topology, and the award category drawn from 10-02's single base-rate lookup"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#requests exactly BRACKET_SETS's own 13 semifinal identifiers in table order, then two or three final matches"
        status: pass
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#the tallied award histogram matches the 10-02 lookup's own pmf within Monte Carlo tolerance at 20,000 draws"
        status: pass
      - kind: other
        ref: "grep -c '^import' packages/core/districts/ledgerSimulation.ts -> 7, every specifier a packages/core sibling"
        status: pass
    human_judgment: false
  - id: D4
    description: "The draft rule the browser runs is reconciled against real corpus alliance selections at 3,879 of 3,880 captain slots across 485 events, with the naive rule scored beside it"
    requirement: "SC-2"
    verification:
      - kind: integration
        ref: "packages/core/districts/selectionModel.reconciliation.test.ts#reproduces the real captain at at least 3879 of 3880 slots, teacher-forced"
        status: pass
      - kind: integration
        ref: "packages/core/districts/selectionModel.reconciliation.test.ts#the single permitted miss is 2026milac alliance 8"
        status: pass
      - kind: integration
        ref: "packages/core/districts/selectionModel.reconciliation.test.ts#the second-pick rank gradient is non-increasing from alliance 1 to alliance 8"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every stage the page can be in, and the slider's rewind, is an input rather than a branch that guesses, with a supplied alliance set validated rather than trusted"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#all four known at once gives five point masses, a ledger-stream consumption count of exactly zero"
        status: pass
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#rejects %s with a typed error naming the offending alliance and team"
        status: pass
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#fixes every team's elim points and never routes the bracket"
        status: pass
    human_judgment: false
  - id: D6
    description: "The grand total is the exact convolution of however many event totals a team has, plus rookie bonus and adjustments, with a negative shift throwing rather than clamping"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#two two-point event totals convolve to 0.125, 0.125, 0.375, 0.375, every entry to within 1e-12"
        status: pass
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#%i event totals is a real state"
        status: pass
    human_judgment: false
  - id: D7
    description: "The blue-cell text rules live in one pure module returning numbers and which of CONTEXT's two forms to use, rendering no words"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/districts/pointSummary.test.ts#the module carries no percent sign and none of the sketch's cell copy"
        status: pass
      - kind: unit
        ref: "packages/core/districts/pointSummary.test.ts#returns undefined for an all-mass-at-zero histogram — the honest null, never 0 and never NaN"
        status: pass
      - kind: unit
        ref: "packages/core/districts/pointSummary.test.ts#AT the threshold value itself the result is the median form"
        status: pass
    human_judgment: false
  - id: D8
    description: "continuousQuantile has exactly one implementation, reachable from packages/core, with all four existing importers byte-unchanged and their shipped tests green"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/continuousQuantile.test.ts#the promoted export and apps/web/src/lib/simQuantile.js's export are the SAME function object"
        status: pass
      - kind: other
        ref: "git diff --stat HEAD~3..HEAD -- apps/web/src/lib/simQuantile.test.ts apps/web/src/components/event/rankRows.ts scripts/measureFieldAveragedRanks.ts apps/web/src/lib/simAxis.test.ts -> empty"
        status: pass
    human_judgment: false
  - id: D9
    description: "The 1,000-draw cost on a realistic fixture is measured and recorded for 10-07's frame-budget decision, with no millisecond bar asserted"
    verification:
      - kind: unit
        ref: "packages/core/districts/ledgerSimulation.test.ts#completes 1,000 draws over roughly 40 teams and roughly 60 remaining matches with well-formed marginals, and PRINTS its elapsed time"
        status: pass
    human_judgment: false

duration: 33 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 04: The joint district ledger simulation Summary

**One Monte Carlo run over one district event now yields a correlated (qualification, alliance selection, playoff, award) quadruple for every team on every draw — with the correlation proven per draw, the draft rule reconciled against 3,879 of 3,880 real corpus captain slots, and the exact grand-total convolution and the blue-cell text rules landing beside it.**

## Performance

- **Duration:** 33 min
- **Tasks:** 3 of 3
- **Files created:** 7
- **Files modified:** 2
- **Full suite:** 5,970 passed, 1 skipped, 1 known pre-existing flake (`MetricHistoryTab.test.tsx` skeleton legend spacer, passes in isolation, untouched by this plan)

## The measured figures

These are the numbers 10-08 states on the methodology page, and every one traces to a committed artifact.

### The selection-model reconciliation (`selectionModel.reconciliation.test.ts`, run against `data/corpus.sqlite` on 2026-09-25)

| Population | Measured |
|---|---|
| Eight-alliance 2023-plus district events found | 491 |
| Usable events (every team in the first three pick slots has an `event_rankings` row) | **485** |
| Events excluded, and named | **6** — `2023gaalb`, `2024vapor`, `2025ncash`, `2026mefal`, `2026txfor`, `2026txmca` |
| Captain slots checked | **3,880** |
| Captain slots the progressive rule reproduced, teacher-forced | **3,879** |
| Events perfect on all eight slots | **484** |
| Misses | **1** |

**The single miss:** `2026milac` alliance 8. The rule expected `frc6087` (qualification rank 13); the real captain was `frc7768` (rank 14). One decline, one event. Declines are not modelled and this is the measured size of that omission.

**The naive rule, scored in the same run over the same events:** "captains are the eight lowest rank numbers" matches **3 of 491** events. It is measured beside the rule that beat it so that a later simplification of the progressive walk back into a top-eight slice turns the suite red rather than shipping quietly.

**The second-pick rank gradient** (mean qualification rank of the real second pick, by alliance number, over all 491 eight-alliance events):

| Alliance | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Mean rank | **24.83** | 24.82 | 23.64 | 23.40 | 22.29 | 22.24 | 21.27 | **20.10** |
| n | 491 | 491 | 491 | 491 | 491 | 490 | 488 | 485 |

Monotonically decreasing: alliance 8's second pick is the STRONGER one, which is only possible if alliance 8 picks first in round two. The test asserts the direction and a minimum end-to-end spread of 4.0 rather than the exact means, so a legitimate re-ingest cannot turn it red for the wrong reason.

### The 1,000-draw cost

**11.4 ms, 12.5 ms, 12.8 ms, 12.9 ms across four runs** on this machine — 1,000 draws over a 40-team fixture with 60 remaining matches, eight alliances and all four stages open.

**No millisecond bar is asserted anywhere.** Project memory `project_worker_cputime_not_reproducible` records roughly 5 ms of run-to-run spread on unchanged code, so an absolute bound would manufacture a flake while proving nothing. The figure is recorded here because 10-07 needs it to decide whether a district's two events fit inside a frame budget; on this evidence a two-event district run is roughly 25 ms, comfortably inside one.

### The promotion left every importer byte-unchanged

```
git diff --stat HEAD~3..HEAD -- apps/web/src/lib/simQuantile.test.ts \
  apps/web/src/components/event/rankRows.ts \
  scripts/measureFieldAveragedRanks.ts apps/web/src/lib/simAxis.test.ts
```

Empty. All four importers still reach the estimator through `apps/web/src/lib/simQuantile.ts`, which is now a re-export; the shipped `simQuantile.test.ts` passes untouched and is the promotion's regression oracle. A test asserts strict function identity between the promoted export and the `apps/web` one, so there is provably one function object rather than two that agree.

## The exported API surface

10-06 and 10-07 import by these names.

### `packages/core/districts/ledgerSimulation.ts`

**The entry point**

```ts
simulateDistrictEvent(
  input: DistrictLedgerEventInput,
  draws: number,
  seed: number,
  observer?: DistrictDrawObserver
): DistrictLedgerResult
```

**The stage-aware input shape**

```ts
interface DistrictLedgerEventInput {
  readonly eventKey: string;
  readonly season: number;                 // 2023+ only; assertBracketSeason runs up front
  readonly tier: DistrictTier;             // "district" | "dcmp"
  readonly fieldSize: number;              // event_rankings.total_teams, passed explicitly
  readonly allianceCount: number;          // 8 routes the bracket; 2 and 4 take the measured fallback
  readonly remainingMatches: readonly SimMatchInput[];   // zero = quals done; a rewind hands played rows back here
  readonly baselines: readonly SimTeamBaseline[];
  readonly ratings: ReadonlyMap<string, AllianceMemberRating>;   // 10-02's OWN roster-member type
  readonly awardProfiles: ReadonlyMap<string, DistrictAwardProfile>;
  readonly knownAlliances?: readonly SuppliedAlliance[];          // STAGE: alliances announced
  readonly knownElimPoints?: ReadonlyMap<string, number>;         // STAGE: playoffs done
  readonly knownAwardPoints?: ReadonlyMap<string, number>;        // STAGE: awards posted
}

interface DistrictAwardProfile { readonly bucket: DecorationBucket; readonly rookieState: RookieState }
interface SuppliedAlliance { readonly allianceNumber: number; readonly picks: readonly string[] }
```

There is deliberately NO `knownQualPoints` / quals-done flag. A finished qualification stage is `remainingMatches: []`.

**The result**

```ts
interface DistrictLedgerResult {
  readonly eventKey: string;
  readonly draws: number;
  readonly qualPoints: ReadonlyMap<string, Int32Array>;
  readonly selectionPoints: ReadonlyMap<string, Int32Array>;
  readonly elimPoints: ReadonlyMap<string, Int32Array>;
  readonly awardPoints: ReadonlyMap<string, Int32Array>;
  readonly eventTotal: ReadonlyMap<string, Int32Array>;
  readonly awardSources: ReadonlyMap<string, AwardBaseRateSource>;  // empty when knownAwardPoints was supplied
}
```

**Index `i` holds the DRAW COUNT for exactly `i` points.** Offset zero, value equals index, never a probability. Every array's length is `maxEventPoints(season, tier)`'s value for that category plus one; the event total's length is the sum of all four plus one. Everything is structured-cloneable and nothing in the input or the result is a function.

**Also exported**

| Symbol | Kind | What it is |
|---|---|---|
| `LEDGER_STREAM_SALT` | const | XORed into the seed to build the second stream |
| `DistrictDrawObservation`, `DistrictDrawObserver` | types | the per-draw TEST SEAM; never send it across a Worker boundary |
| `decideBracketMatch(allianceA, allianceB, rosterA, rosterB, setId, rng)` | fn | the bracket decider's pricing step, exported so its refusal branch is directly testable |
| `DistrictEventTotalInput` | type | `{ counts: ArrayLike<number>; denominator: number }` |
| `convolveDistrictGrandTotal(eventTotals, rookieBonus, adjustments): Float64Array` | fn | the exact N-event convolution plus the combined shift |
| `DistrictPointPmfEncoding` | type | `{ offset: number; p: readonly number[] }` |
| `encodeDistrictPointPmf(histogram, draws): DistrictPointPmfEncoding` | fn | EVENT LEVEL ONLY — 10-03's offset encoding |
| `UnratedTeamError` | error | an absent, non-finite or zero-spread published SPR pair; **10-07 catches this and renders the event's open cells as unavailable** |
| `MissingAwardProfileError` | error | a roster member with no profile and no known award points |
| `InvalidFieldSizeError` | error | a field size below the roster, or non-integer |
| `InsufficientRosterError` | error | the roster cannot fill the alliances, or a non-positive alliance count |
| `InvalidAllianceSetError` | error | a malformed SUPPLIED alliance set, naming every offender |
| `AlliancePricingError` | error | the measured pricer declined; never coerced to a coin |
| `NegativeDistrictShiftError` | error | a non-integer addend, a non-positive denominator, or a combined shift below zero |
| `EmptyHistogramError` | error | an all-zero histogram or a non-positive draw count at the encoder |

`UnknownDistrictSeasonError` (from `pointModel.ts`), `UnsupportedBracketSeasonError` and `UnsupportedAllianceCountError` (from `bracket.ts`) propagate untouched.

### `packages/core/districts/pointSummary.ts`

```ts
pointQuantile(histogram: ArrayLike<number>, p: number, denominator: number): number
pointPercentiles(histogram: ArrayLike<number>, denominator: number): PointPercentiles   // { p10, p50, p90 }
chanceOfAnyPoints(histogram: ArrayLike<number>, denominator: number): number
conditionalMedianGivenPoints(histogram: ArrayLike<number>, denominator: number): number | undefined
POINT_CELL_CHANCE_FORM_THRESHOLD = 0.995
pointCellSummary(histogram: ArrayLike<number>, denominator: number): PointCellSummary
InvalidDenominatorError

type PointCellSummary =
  | { form: "chance"; chance: number; conditionalMedian: number | undefined }
  | { form: "median"; percentiles: PointPercentiles };
```

One import, the promoted estimator. Returns numbers and a form; renders no words.

### `packages/core/algorithms/simulation/continuousQuantile.ts`

```ts
continuousQuantile(dist: ArrayLike<number>, p: number, draws: number): number
```

## Task Commits

1. **Task 1 (TRACER): one joint draw, end to end** — `e3437469` (feat)
2. **Task 2: stage awareness, the rewind, the non-eight fallback, and the corpus reconciliation** — `44c5bbf3` (feat)
3. **Task 3: the exact grand-total convolution, the encoder, and the cell rules** — `d9653843` (feat)

## Files Created/Modified

- `packages/core/algorithms/simulation/continuousQuantile.ts` — sketch 005's estimator, moved verbatim with its whole doc comment plus one paragraph recording why it moved
- `packages/core/algorithms/simulation/continuousQuantile.test.ts` — strict function identity with the `apps/web` re-export, counts-versus-pmf equivalence, `Int32Array` parity
- `packages/core/districts/ledgerSimulation.ts` — the joint draw, the stage inputs, the convolution and the event-level encoder
- `packages/core/districts/ledgerSimulation.test.ts` — 67 pure tests: the correlation proof, the non-perturbation pin, the hand-computed draft, the bracket topology, the placement multiset, every validation case, the four stage combinations, the fallback, the convolution and the encoder
- `packages/core/districts/selectionModel.reconciliation.test.ts` — the corpus-guarded, teacher-forced reconciliation; skips cleanly without `data/corpus.sqlite`
- `packages/core/districts/pointSummary.ts` — the blue-cell text rules, singular
- `packages/core/districts/pointSummary.test.ts` — 21 tests including the hand-computed 3.667 median and both sides of the 0.995 boundary
- `apps/web/src/lib/simQuantile.ts` — reduced to a re-export; its four importers are untouched
- `packages/harness/browserSafeSchemas.test.ts` — purely additive: one entry-point constant and one `it(...)` with a non-vacuity assertion on two 10-01 formula leaves

## Decisions Made

Recorded in the frontmatter's `key-decisions`. The three that a later reader is most likely to want the reasoning for:

1. **The progressive captain rule overrides the plan's own brief.** The brief said "captains = top eight by that ranking". Measured, that is right at 3 of 491 events while the progressive walk is right at 3,879 of 3,880 slots. The corpus wins, and the naive rule is scored beside it in the same test so the decision cannot be quietly undone.
2. **Two random streams from one seed.** The hook closes over whichever generator it calls; drawing from the rank stream would advance it and make this tab's rank marginal disagree with the event page's Simulation tab for the same seed, with no bug to find. The non-perturbation pin asserts exact integer equality and is what enforces it.
3. **A known stage's work is skipped, not routed and discarded.** Routing a bracket whose result is thrown away consumes the ledger stream and silently changes every later draw, so the skip is a correctness requirement. The tests assert a `routeBracket` call count of exactly 0 and a ledger consumption count of exactly 0.

## Deviations from Plan

### 1. [Rule 3 - Blocker] The award-pmf tests could not inject a synthetic pmf

- **Found during:** Task 1 (the award draw tests)
- **Issue:** `<behavior>` asked for "an award profile whose pmf is a point mass at the zero entry" and "a two-point pmf". An award profile is `(bucket, rookieState)` and the pmf comes from 10-02's measured `awardBaseRate` lookup, which is exactly the point — the plan's own prohibitions forbid restating a rate here. There is no input through which a synthetic pmf can reach the draw, and adding one would have been a second, unmeasured rate source.
- **Fix:** Tested against the REAL lookup instead, which is strictly stronger: the tallied award histogram matches `awardBaseRate(2026, "none", "veteran")`'s own pmf within Monte Carlo tolerance at 20,000 draws, and a separate test pins that a bucket whose exact cell is absent reports `source: "bucket-pooled"` rather than a rung it did not use. The deterministic point-mass case is covered through `knownAwardPoints` in Task 2.
- **Files modified:** `packages/core/districts/ledgerSimulation.test.ts`
- **Verification:** `npx vitest run packages/core/districts/ledgerSimulation.test.ts`
- **Committed in:** `e3437469` (Task 1) and `44c5bbf3` (Task 2)

### 2. [Rule 2 - Missing critical] A backup robot must not inflate the alliance mean

- **Found during:** Task 2 (alliances announced)
- **Issue:** TBA's `picks[3]` is a backup robot, which REPLACES a robot rather than adding one. Passing all four supplied picks to `allianceWinProbability` would have added a whole robot's rating to that alliance's mean and its variance, quietly distorting every bracket match that alliance played.
- **Fix:** The roster the pricer sees is the first three picks; the backup still receives the alliance's placement points and its own slot-3 selection value of zero. Stated in `SuppliedAlliance`'s doc comment and at the roster build.
- **Files modified:** `packages/core/districts/ledgerSimulation.ts`
- **Verification:** the alliances-announced test asserts the observed rosters equal the supplied picks and that slot 3 is a point mass at 0
- **Committed in:** `44c5bbf3`

### 3. [Rule 2 - Missing critical] The season guard had to move up front

- **Found during:** Task 2 (the pre-2023 case)
- **Issue:** `playoffPoints` raises `UnsupportedBracketSeasonError` from INSIDE the draw loop, so a pre-2023 season would have run a full draft before failing — and on the non-eight fallback path, which does not call `playoffPoints` at all, it would not have failed. The measured fallback table is 2023-plus too.
- **Fix:** `assertBracketSeason(season)` runs unconditionally in the up-front validation. The module is scoped to 2023 and later, which CONTEXT already states ("earlier seasons have no open categories and need no bracket").
- **Files modified:** `packages/core/districts/ledgerSimulation.ts`
- **Verification:** `a pre-2023 season throws through 10-01's own bracket-season guard`
- **Committed in:** `44c5bbf3`

### 4. [Process] Task 1 briefly carried Task 2 and Task 3 code before being trimmed back

- **Found during:** Task 1
- **Issue:** The first draft of `ledgerSimulation.ts` included the stage inputs, the fallback path, the convolution and the encoder, which Task 1's `<action>` explicitly forbids ("do not build them here, and do not leave a stub for them either").
- **Fix:** Trimmed back to the tracer's scope before any commit, so the committed Task 1 is exactly the open-event path. Nothing out of scope reached a commit; the three commits are clean task boundaries.
- **Files modified:** none beyond the plan's list
- **Verification:** `git show --stat e3437469` shows the tracer's six files only
- **Committed in:** n/a (pre-commit)

---

**Total deviations:** 3 auto-fixed (1 x Rule 3, 2 x Rule 2) plus 1 process correction.
**Impact on plan:** no scope creep. Deviations 2 and 3 are correctness requirements the plan's own prohibitions imply; deviation 1 made a test stronger rather than weaker by refusing to introduce a second rate source.

## Issues Encountered

**The rewind test's first fixture was vacuous.** With baselines separated by a full ranking point and remaining matches whose ranking-point draws span 0 to 2 over 11 played matches, no draw could move a team past its neighbour — the qualification support widened at the margins but the alliance assignment never changed, so the "selection is no longer a point mass" assertion failed. Fixed by giving that test its own tightly-spaced baselines and a wider ranking-point pmf, with a comment saying why: the wide fixture used elsewhere separates teams by more than any single match can close, which would have let the test pass vacuously once the assertion was relaxed.

**One known pre-existing flake in the full suite.** `apps/web/src/components/team/MetricHistoryTab.test.tsx`'s skeleton legend spacer test times out under full-suite parallel load and passes in isolation (re-run confirmed, 7 of 7). It is untouched by this plan.

## User Setup Required

None — nothing published, deployed, fetched, pushed or installed. No `package.json` or lockfile change, no `.env` read of any kind.

## Next Phase Readiness

**10-06 (offline publisher)** calls `simulateDistrictEvent` for each unstarted event, converts each per-team category and event-total histogram with `encodeDistrictPointPmf`, and passes each `p` array through `packages/harness/rounding.ts`'s `roundPmf` before writing into `DistrictPointPmfSchema`. It does NOT convolve grand totals — that is browser-side and has no published field.

**10-07 (web tab)** assembles the per-event input from event artifacts, mirroring `apps/web/src/lib/simulationInputs.ts` including the rewind through `findStartIndex` / `isRewindStart`, posts it to the district Web Worker, and reads every blue cell through `pointCellSummary`. Two binding handoffs, both stated in `ledgerSimulation.ts`'s header:

1. **Catch `UnratedTeamError`** and render that event's open cells as unavailable. The module deliberately does not make that decision, and deliberately does not price the teams it can and drop the rest.
2. **Print the EARNED grey number for a finished event**, never the derived qualification points. `simulateRanks`'s comparator breaks a tie on average ranking points by team key, which is this pipeline's reproducibility tiebreak and not TBA's official one, so the derived value can honestly disagree with what a tied team earned.

Also for 10-07: the per-draw observer is a TEST SEAM and must not cross the Worker boundary; the input and the result are structured-cloneable and function-free precisely so everything else can.

**10-08 (methodology copy)** states three limitations this plan records in code: declines are not modelled (measured size: one captain slot in 3,880, `2026milac` alliance 8); the award draw is independent of the on-field outcome because the base-rate table covers judged awards only; and applying a district-tier-fitted award table at the dcmp tier assumes the same earning rates. The selection model's measured behaviour is the table above.

## Self-Check: PASSED

- All 7 created files exist on disk.
- All 3 task commits exist: `e3437469`, `44c5bbf3`, `d9653843`.
- `npx tsc --noEmit` clean; `npx tsc --noEmit -p apps/web/tsconfig.json` clean.
- `npx vitest run packages/core/districts packages/core/algorithms/simulation packages/harness/browserSafeSchemas.test.ts` — all green, and `selectionModel.reconciliation.test.ts` ran with real assertions rather than a skip.
- The plus-minus codepoint appears in none of the new district files; the one exemption is the sentence carried across with the promoted doc comment, which names the codepoint in order to forbid it.
- `git diff --stat HEAD~3..HEAD` touches no `package.json`, no lockfile, and no file owned by 10-01, 10-02 or 10-03.
