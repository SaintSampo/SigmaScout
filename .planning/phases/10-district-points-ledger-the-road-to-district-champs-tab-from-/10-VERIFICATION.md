---
phase: 10-district-points-ledger-the-road-to-district-champs-tab-from-
verified: 2026-09-25T16:20:00Z
status: human_needed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open a district page, click a blue cell to open the histogram drawer, with the OS reduced-motion preference ON and then OFF."
    expected: "With reduced motion set the drawer appears with no fade or slide. With it unset the 120 ms opacity transition is visible. Both paths show the same drawer content."
    why_human: "UI-SPEC row 11 is a declared `backstop`. jsdom cannot observe a CSS transition; the committed test only asserts the absence of the `district-ledger-drawer--animated` class under a `matchMedia` stub, and there is no positive-case test asserting the class IS applied without the preference, so the committed test could pass vacuously. A real browser with the OS setting toggled is the only observation that distinguishes the two states."
  - test: "During the next live district weekend, open `/districts?district={liveDistrict}` while a member event is in its live window. Watch one poll after that event's qualification matches end, then after alliance selection, then after the finals, then after awards post."
    expected: "Each category flips from a blue prediction cell to a grey earned integer within about one to three minutes of the real result, without a manual republish. `wrangler tail` shows `districtsConsidered` above zero, `districtsRefreshed` moving, `district-refreshed` log lines, and no `district-refresh-failed`."
    why_human: "SC-1's production half has never fired. The mechanism is fully exercised by `apps/worker/test/scheduled.district.test.ts` (40 tests driving the real `runTick` against mocked TBA and R2), the Worker carrying it is deployed (version 44f15512), and `v1/manifest/live-windows.json` now carries the `districtKey` field on 52 of 52 windows — but every one of those values is null because no district event is live in late September, so `districtsConsidered` has been 0 on every observed tick. Eligibility is not evidence; 10-09-SUMMARY.md records this as owed and 10-VALIDATION.md lists it under Manual-Only Verifications."
---

# Phase 10: District points ledger — the Road to District Champs tab — Verification Report

**Phase Goal:** The District Locks tab becomes the Road to District Champs ledger of sketch 021 variant A — per district event, earned district points (grey, final) and a prediction for each open category (blue: median plus likely range, or chance plus typical amount, histogram on click), event total, grand total, five statuses, a rewind slider by match; open categories simulated jointly in the browser from live event artifacts; unstarted events baked by the pipeline; awards from walk-forward base rates by decoration bucket; the district artifact refreshed during live events by the Worker.

**Verified:** 2026-09-25T16:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Method

Must-haves were taken from the ROADMAP's seven Phase 10 success criteria (the contract) merged with the `must_haves` frontmatter of all nine plans. Every claim below was checked against the source, not against SUMMARY.md. Evidence gathered this session:

- Repo-root `npx vitest run` — **280 files, 6,263 passed, 1 skipped, 0 failed** (68.65 s). Independently reproduces 10-09's recorded numbers exactly.
- `npx tsc --noEmit` at root, `-p apps/web/tsconfig.json` and `-p apps/worker/tsconfig.json` — all three silent, exit 0.
- Targeted verbose runs of the two corpus reconciliation tests, the three measurement pin tests, the two Worker district tests, the district component/worker tests, the methodology tests and the districts route tests.
- `git log --oneline 0c23e6b9..HEAD` — 74 commits, every plan's commits present in wave order.
- Debt-marker scan over all 103 non-planning files changed in the range.

SC-1 to SC-7 are the ROADMAP's own success criteria and are deliberately absent from `.planning/REQUIREMENTS.md`; their absence there is not reported as a gap.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A finishing category turns grey with earned points within the freshness window, because the live Worker refreshes TBA district rankings for live districts and republishes the district artifact | ✓ VERIFIED (mechanism); production observation routed to human | `apps/worker/src/districtRefresh.ts` (299 lines) is imported and called at `scheduled.ts:1712`, after the event loop and before `writeTickMeta`, with four `TickResult` counters. `apps/worker/test/scheduled.district.test.ts` + `districtEventState.test.ts` — **40 tests pass**, driving the real `runTick`: republish with recomputed verdicts on changed rankings, no put on a 304, reserved-key ETag with `If-None-Match` only on tick two, all four state facts above the `newlyFolded` early return, the conditional `/awards` fetch and its five cases, six error-isolation cases, the pre-republish (no `districtKey`) no-op, and a static import guard proving neither module reaches the corpus, `better-sqlite3`, a `node:` built-in or the simulation. `buildLiveWindowsManifest`'s `districtKey` join is pinned by 8 passing tests in `packages/harness/manifests.test.ts` including `MANIFEST_SCHEMA_VERSION` still 1. Operator record: Worker version `44f15512` deployed 15:40:41Z, district republish generation `2026-09-25T15:47:20.912Z`, manifest rewritten with the field on 52/52 windows. **Human item 2** covers the unobserved live weekend. |
| SC-2 | Every blue cell derives from one joint per-run simulation in a Web Worker (rank histogram, then captains and greedy-by-SPR picks, then the double-elimination bracket priced by SPR) plus an award pmf from published walk-forward base rates; event total is the per-run sum; grand total is the exact convolution; histograms follow sketch 005 | ✓ VERIFIED | `packages/core/districts/ledgerSimulation.ts` (53 KB) imports exactly `allianceWinProbability`, `simulateRanks`/`drawCategorical`/`mulberry32`, `awardBaseRate`, `routeBracket`/`playoffPoints`/`divisionedDcmpPlayoffPmf`, `maxEventPoints`, `districtQualPoints`/`districtTierWeight`, `districtSelectionPoints` — no second pricer, no second bracket, no second ceiling table. `LEDGER_STREAM_SALT` gives the stages a second `mulberry32` stream so the rank marginal is unperturbed. Worker triad wired four hops: `useDistrictSimulationRun` → `createDistrictSimulationWorker` → `districtSimulation.worker.ts` (three statements, no arithmetic) → `runDistrictSimulationJob` → `simulateDistrictEvent`; protocol test proves histograms equal a direct core call under the same seed and that the payload survives `structuredClone` carrying no function. `convolveDistrictGrandTotal` is called at `districtLedgerRows.ts:669`. Drawer geometry: `districtHistGeometry.test.ts` pins the band for a point mass and proves a denominator-1 baked array and a denominator-N histogram give identical edges; `DistrictLedger.test.tsx` pins the band label to hand-computable percentiles and one shared maximum per column. |
| SC-3 | Five statuses: Locked / Locked out from `locks.ts`, In range / Out of range from a median-projection; on a finished district the counts equal the artifact's locked and eliminated counts | ✓ VERIFIED | `districtLedgerStatus.ts` imports `computeLocksWithQualifiers` and `cutLinePointsWithQualifiers` from `packages/core/districts/locks.js` and calls the latter at line 171 on median-projection inputs. `districtLedgerStatus.test.ts` passes, including *"SC-3 — a finished district reproduces the artifact's own two counts EXACTLY"* and the sibling test proving the Locked **chip** count is `locked + lockedAward`, a different number from `insights.districtLockedCount`. `DistrictLedger.test.tsx` pins the five labels, the `Locked · award` variant, the definitions, the chip filters and the red token on the Locked out chip and nothing else. Live-site look recorded 10-09: Locked 50, Locked out 76 on `2026pnw` — matching the artifact. |
| SC-4 | A slider rewinds by match across the district's interleaved timeline; rewinding into a finished event reopens its later categories and statuses recompute | ✓ VERIFIED | `districtTimeline.ts` + test: interleaves two events by `sortTime` and puts each event's four stage steps after its own last qualification row; jump chips derived from the weeks present, never a hardcoded list. `DistrictLedger.test.tsx`: *"SC-4: a position before an event's last qualification match turns its selection, playoff and award cells BLUE"*, *"recomputes the statuses at the moved position — at least one chip label changes"*, *"constructs a Worker when the slider moves into a finished event, even though the now position constructs none"*, plus URL round-trip and unknown-step fallback. `districtLedgerStatus.test.ts` proves rewinding is monotonically more conservative. |
| SC-5 | The ledger paints with zero simulation compute for finished and unstarted events; the browser simulates only events in progress and on slider moves | ✓ VERIFIED | `DistrictLedger.test.tsx`: *"constructs NO Worker at all when every district event is finished (SC-5)"* and *"constructs NO Worker for an unstarted event and still paints its blue cells from the baked pmfs (SC-5)"* — both assert an empty `instances` array, stronger than an empty `posted`. Offline bake: `packages/harness/districtBake.ts` → `buildPricedSyntheticSchedules` → `simulateDistrictEvent` → `encodeDistrictPointPmf`; `scripts/publishDistricts.ts` wires `--as-of`, `--local-out`, `--no-bake` and `assertWithinDistrictBudget` with `Buffer.byteLength`. The bake was genuinely exercised: `docs/publish-budget.md` records the `--as-of 2026-04-04` run baking 2 of 150 events with one counted line per rejection reason. Placement is the SIDECAR branch the byte measurement selected (state-only 151,351 vs inline 717,001 bytes on `2026pnw`), read by `apps/web/src/lib/api/districtLedger.ts` only for a key the artifact's own `bakedEvents` names — within CONTEXT's stated Claude's-Discretion. |
| SC-6 | The selection model's pick-order agreement with SPR and the award base-rate tables are measured walk-forward on the corpus, pinned by tests, and stated on the methodology page in its voice | ✓ VERIFIED | Measured and **re-measured this session**: `scripts/measureSelectionAgreement.test.ts` *"reproduces every recorded CAPTAIN constant EXACTLY"* and *"reproduces every recorded PICK-ORDER constant within its tolerance"* (9,077 ms against the real corpus); `scripts/measureAllianceWinProbability.test.ts` *"re-measures 2026 and reproduces every recorded constant within 1e-4"* (9,245 ms); `scripts/measureDistrictAwardBaseRates.test.ts` pins both walk-forward leak halves. `packages/core/districts/selectionModel.reconciliation.test.ts` pins 3,879 of 3,880 captain slots, the single `2026milac` miss, the naive baseline at at most 3 events and the serpentine rank gradient. Page: `/methodology/district-points` exists and is registered (route file, sixth `METHODOLOGY_CARDS` entry, positional destructure in `MethodologyCards.tsx`). Every figure on it traces to a committed constant — the page's "99.97%, or 3,879 of 3,880" ↔ `MEASURED_PROGRESSIVE_CORRECT_SLOTS = 3879`, "22.34%" ↔ `MEASURED_SECOND_PICK_EXACT_AGREEMENT = 0.22340425531914893`, "0.0552 / 0.0417 / 0.1224 / 0.1462 / 0.1443 / 0.2494 / 0.2112" ↔ the seven recorded constants in `measureAllianceWinProbability.ts`. Voice gate passes at runtime over the exported values: zero hyphen-minus, en dash, em dash, U+00B1, no retired vocabulary, no singular first person, at most three sentences per paragraph, structure pinned by equality against a hand-typed id array. `AWARDS_LEAD`'s retired "no award predictions" claim is replaced and the replacement is pinned. |
| SC-7 | Repo-root vitest green, both tsconfigs clean, CI green after the push, district artifacts republished, Worker deployed before the republish, live e2e covers the new tab | ✓ VERIFIED | Independently reproduced: **280 files / 6,263 passed / 0 failed**, and all three `tsc --noEmit` runs silent. Deploy-before-republish ordering proved by two recorded timestamps: `wrangler deploy` 15:40:41Z, `publish:districts` 15:47:19Z. Republish generation `2026-09-25T15:47:20.912Z` verified live with an `Origin` header (14 districts, 126/126 `2026pnw` teams carrying per-event `state` and `awardProfile`, 6 award base-rate rows measured through 2025). CI: runs 36156850808 / 36156850846 for `e0fd02c9` and 36157968026 / 36157968031 for the fix `cf809985`, all four success. e2e: `apps/web/e2e/districts-ledger.spec.ts` (320 lines, 5 tests) is matched by exactly the two deployed-origin projects `desktop` and `phone-390` in `playwright.config.ts` and by no `local-*` project — 10 of 10 green, full family 289 passed / 0 failed. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### UI-SPEC backstop rows

| Row | Status | Evidence |
|---|---|---|
| Reduced motion: the drawer opens without animation when `prefers-reduced-motion` is set | ⚠️ BACKSTOP — routed to human | Belt-and-braces mechanism present: `DistrictLedger.tsx:359` withholds `district-ledger-drawer--animated` under `prefersReducedMotion()`, AND `theme.css:942` carries a `@media (prefers-reduced-motion: reduce)` rule zeroing the transition. Committed test asserts only the class's absence under a `matchMedia` stub, with no positive-case counterpart, so it could pass vacuously. UI-SPEC declares this a `backstop` whose "real verification is the UAT's manual check". **Human item 1.** |
| Phone width: the table scrolls inside its card, the slider and chips wrap | ✓ VERIFIED | The 390px half of `districts-ledger.spec.ts` ran green against the deployed origin (10-09 Task 7 rerun): the table's own region is the only horizontal scroller (1,319 vs 340), the sticky Team cell holds at x 25 before and after scroll, and the outer card never overflows. This backstop found a **real defect** first (the sticky cell 360px inside a 340px scrollport, Chromium far-edge alignment), fixed in `cf809985`. |

### Required Artifacts

All 33 declared artifacts across the nine plans exist, are substantive and are wired. Spot-checked sizes and wiring:

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/districts/qualPoints.ts` / `selectionPoints.ts` / `bracket.ts` | the three point formulas, browser-safe leaves | ✓ VERIFIED | 7,441 / 5,431 / 18,210 bytes; each carries pure unit tests that run with no corpus; `districtTierWeight` derived from `pointModel.ts`'s two public ceilings, never a literal 3 |
| `packages/core/districts/pointFormulas.reconciliation.test.ts` | corpus proof of all three formulas | ✓ VERIFIED | Runs against the real 592 MB `data/corpus.sqlite` (not skipped): qual 29,796 checked / 0 mismatches / 75 unresolvable (all 2020); selection 20,209 checked / 0 mismatches; playoff 10,278 checked / 0 mismatches across 478 reconciled events |
| `packages/core/algorithms/simulation/allianceWinProbability.ts` | the browser pricer, one runtime import | ✓ VERIFIED | 176 lines; registered as its own entry point in `browserSafeSchemas.test.ts` with a Node-built-in reachability assertion |
| `packages/core/districts/awardBaseRates.ts` | walk-forward tables + stated fallback ladder | ✓ VERIFIED | 22,556 bytes, seven registered seasons, `MIN_CELL_OBSERVATIONS = 100`, `source` rung on every result, `unknown` rookie state kept separate from `veteran` |
| `packages/harness/districtRankingsMerge.ts` | the ONE producer of the merged shape | ✓ VERIFIED | 525 lines; called by both `apps/worker/src/districtRefresh.ts:45` and `scripts/publishDistricts.ts`; neither reimplements the merge; registered in the static import-graph scan (`browserSafeSchemas.test.ts:37`) so it is provably Worker-bundleable |
| `scripts/publishLiveWindows.ts` + `pnpm publish:live-windows` | the one-object path to production | ✓ VERIFIED | 212 lines; `package.json:46`; dry-run-writes-nothing pinned by an injected upload function's call count; actually run by the operator at 15:48:45Z reusing generation `6c6585d0` |
| `packages/core/districts/ledgerSimulation.ts` | the joint district run | ✓ VERIFIED | 53,300 bytes + 52,529 bytes of tests; nine typed refuse-to-guess error classes; imports no verdict module |
| `packages/core/algorithms/simulation/continuousQuantile.ts` | promoted, not copied | ✓ VERIFIED | `apps/web/src/lib/simQuantile.ts` is a 23-line re-export; all four original importers unchanged; sketch 005's doc comment (including the one deliberate U+00B1 that forbids the glyph) survived the move |
| `apps/web/src/components/districts/DistrictLedger.tsx` + 10 siblings | the tab | ✓ VERIFIED | 35,664 bytes; rendered by `routes/districts.tsx:174`; tab trigger reads `DISTRICT_LEDGER_TAB_LABEL` = "Road to District Champs" at `districts.tsx:221`; 38 component tests pass |
| `apps/web/src/components/methodology/districtLedgerContent.ts` + page + route + card | the published words | ✓ VERIFIED | Six sections, seven limitations pinned by equality, 30 tests pass across content, route and awards |
| `docs/worker-operations.md` / `simulation-architecture.md` / `publish-budget.md` | the three runbooks | ✓ VERIFIED | All three now describe the district system (the word "district" appeared zero times between them before this phase): the refresh pass and its four counters, a symptom row, the third simulation engine with its measured ~12 ms per 1,000 draws, and the production byte table |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `apps/worker/src/scheduled.ts` | `runDistrictRefresh` | import at line 168, call at line 1712 after the event loop, before `writeTickMeta`, unreachable from the early returns | ✓ WIRED |
| `districtRefresh.ts` | `applyDistrictRankings` / `applyDistrictEventState` | import line 45 — called, never reimplemented | ✓ WIRED |
| `LiveWindowEntrySchema.districtKey` | the Worker's `liveDistrictsOf` | `manifests.ts:228,244` populates it from a districts join; `scheduled.ts:866` gates the state collector on it | ✓ WIRED |
| `simulateDistrictEvent` | `simulateRanks`'s optional fifth `onDraw` | `rankSimulation.ts:233` declares it, `:382` invokes it after histogram accumulation | ✓ WIRED |
| the bracket decider | `allianceWinProbability` → `standardNormalCdf` | one pricer, one `BRACKET_SETS` topology shared by the corpus test's real-match decider and the Monte Carlo decider | ✓ WIRED |
| `useDistrictSimulationRun` | `createDistrictSimulationWorker` → `districtSimulation.worker.ts` → `runDistrictSimulationJob` | four hops, one per file | ✓ WIRED |
| `districtLedgerStatus.ts` | `locks.ts`'s `cutLinePointsWithQualifiers` | import line 36, call line 171 — no hand-rolled slot subtraction | ✓ WIRED |
| the district artifact's 60 s poll | `EVENT_POLL_INTERVAL_MS` + `shouldPollDistrictArtifact` | `api/districts.ts:113-114` `refetchInterval`, `refetchIntervalInBackground` deliberately unset | ✓ WIRED |
| `METHODOLOGY_CARDS` | the positional destructure → `/methodology/district-points` | `MethodologyCards.tsx:47` sixth slot with its own `<Link>` at :98 | ✓ WIRED |
| `districts-ledger.spec.ts` | `playwright.config.ts` `desktop` + `phone-390` `testMatch` | both regexes name the spec; no `local-*` project does | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| `DistrictLedger.tsx` | `artifact` | `useDistrictEventArtifacts` / `districtQueryOptions` → `v1/district/{key}.json` | Yes — live object verified with an `Origin` header: 14 districts, 126/126 `2026pnw` teams with `state` and `awardProfile`, 6 `awardBaseRates` rows | ✓ FLOWING |
| open blue cells | `distribution.counts` | Web Worker `simulateDistrictEvent`, or a decoded baked pmf from the sidecar | Yes — protocol test proves the Worker's histograms equal a direct core call; `districtLedgerRows.test.ts` proves the decoded baked array and the simulated histogram reach the cell rules in one representation | ✓ FLOWING |
| grey final cells | `eventPoints[category]` | the artifact's own earned integers | Yes — pinned by *"prints the artifact's own earned integer in a final cell even when a simulated histogram for the same cell disagrees"* | ✓ FLOWING |
| methodology figures | exported constants | `measureSelectionAgreement.ts` / `measureAllianceWinProbability.ts` recorded constants | Yes — re-measured against the corpus this session and reproduced | ✓ FLOWING |
| unstarted-event cells | `bakedEvents` sidecar | `publishDistricts.ts` bake | Mechanism proven (2 events baked under `--as-of 2026-04-04`); **currently empty in production because zero district events in any ingested season have a future start date.** Seasonal, expected, and recorded in `docs/publish-budget.md` | ✓ FLOWING (path exercised offline) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Whole suite green | `npx vitest run` (repo root, once) | 280 files, 6,263 passed, 1 skipped, 0 failed, 68.65 s | ✓ PASS |
| Root typecheck | `npx tsc --noEmit` | silent, exit 0 | ✓ PASS |
| Web typecheck | `npx tsc --noEmit -p apps/web/tsconfig.json` | silent, exit 0 | ✓ PASS |
| Worker typecheck | `npx tsc --noEmit -p apps/worker/tsconfig.json` | silent, exit 0 | ✓ PASS |
| Corpus formula reconciliation actually runs (not skipped) | `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts --reporter=verbose` | 21 tests, real per-season counts printed, 0 mismatches everywhere | ✓ PASS |
| The recorded measurement constants still hold | `npx vitest run scripts/measure{AllianceWinProbability,SelectionAgreement,DistrictAwardBaseRates}.test.ts` | fresh corpus measurements reproduce every constant | ✓ PASS |
| Worker district pass drives the real `runTick` | `npx vitest run apps/worker/test/scheduled.district.test.ts apps/worker/test/districtEventState.test.ts` | 40 passed | ✓ PASS |
| The tab, statuses, slider and drawer | `npx vitest run apps/web/src/components/districts/DistrictLedger.test.tsx` | 38 passed | ✓ PASS |
| Live e2e against `https://sigmascout.org` | (not re-run — network) | 10-09 record: district spec 10/10, family 289 passed / 0 failed at 16:06:08Z | ✓ PASS (operator-recorded) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repo and no plan declares a probe. **Step 7c: SKIPPED (no probes in this project).**

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|---|---|---|---|
| SC-1 | 10-03, 10-05, 10-09 | ✓ SATISFIED (mechanism); production observation → human | See SC-1 row above |
| SC-2 | 10-01, 10-02, 10-04, 10-07 | ✓ SATISFIED | See SC-2 row above |
| SC-3 | 10-07 | ✓ SATISFIED | See SC-3 row above |
| SC-4 | 10-07 | ✓ SATISFIED | See SC-4 row above |
| SC-5 | 10-03, 10-06, 10-07 | ✓ SATISFIED | See SC-5 row above |
| SC-6 | 10-01, 10-02, 10-06, 10-08 | ✓ SATISFIED | See SC-6 row above |
| SC-7 | 10-08, 10-09 | ✓ SATISFIED | See SC-7 row above |

No orphaned requirements: SC-1 to SC-7 are ROADMAP-local success criteria and every one is claimed by at least one plan's `requirements` field. `.planning/REQUIREMENTS.md` carries no SC-* ids for this phase by design.

### Prohibition Verification (must-NOTs)

| Prohibition | Status | Evidence |
|---|---|---|
| No `.env` read, printed, copied, interpolated or hashed | ✓ HELD | The three new `measure:*` entries carry no `--env-file` flag (`package.json:43-45`); the only credentialed new entry is `publish:live-windows` (`:46`), which passes the file by path via `tsx --env-file=.env`. Each measurement script's header states the omission and why |
| No display band (`sigmaMatchBandVariance`) in the win-odds formula | ✓ HELD | `allianceWinProbability.ts` reaches only `standardNormalCdf`; the multiplier grid is a printed diagnostic and the shipped function is fixed at 1.0 |
| No simulated number, predicted rank or award outcome reaches `locks.ts` | ✓ HELD | `ledgerSimulation.ts`'s import list contains no verdict module (verified by reading it, not the comment); `districtBake.ts` likewise; the publisher's verdict pass runs on earned points only |
| No U+00B1 in any new file | ✓ HELD | Grep over every new district/simulation/component file returns exactly one hit — the deliberate, plan-named exemption in `continuousQuantile.ts:25`, a doc comment that names the codepoint in order to forbid it |
| No literal hex colour in the new components | ✓ HELD | Grep over `DistrictLedger.tsx` and `DistrictPointHistogram.tsx` returns nothing |
| No second bracket, pricer, DCMP weight, ceiling table or quantile estimator | ✓ HELD | One `BRACKET_SETS`, one `routeBracket`, one `allianceWinProbability`, one `districtTierWeight` derived from `pointModel.ts`, one promoted `continuousQuantile` with a re-export shim |
| No grand-total pmf published | ✓ HELD | `districtBake.ts:26` states the deliberate non-import; no grand-total encoder is exported at all |
| `PAGE_ARTIFACT_SCHEMA_VERSION` and `MANIFEST_SCHEMA_VERSION` do not move | ✓ HELD | Pinned by a passing `manifests.test.ts` assertion; every added field is optional, which is what makes the deploy-before-republish order safe |
| Nothing published, deployed, pushed or fetched from an executor subagent | ✓ HELD | Every networked command is recorded in 10-09 as run from the main context |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` | — | **Zero** across all 103 non-planning files changed in `0c23e6b9..HEAD` |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` | — | **Zero** across the same set |
| `apps/web/src/components/districts/DistrictLocksTab.tsx`, `districtLocksHeaderStats.ts` | — | Dead district arm retained | ℹ️ INFO | The component is now only constructed with `which="champ"` (`districts.tsx:187`) and `DistrictLedger.test.tsx` proves none of the old district-tier test ids or vocabulary renders. The unused arm is named as a follow-up in 10-07 and 10-09. Not a goal blocker; per Chesterton's Fence it is kept, not flagged for removal, because the champ tab shares the file |
| `apps/web/e2e/**` | — | Typechecked by neither tsconfig | ⚠️ WARNING | Named as an owed follow-up by both 10-08 and 10-09. The specs run green against the deployed origin, so the risk is a compile-time-only blind spot in a file family that is not part of any build. Does not block the phase goal |

### Disconfirmation Pass

Per the Confirmation Bias Counter, three deliberate attempts to falsify:

1. **A requirement only partially met.** SC-5's baked half: the code path and the artifact contract are complete and the bake is exercised offline, but **zero baked events exist in production today** because no district event in any ingested season has a future start date. Anticipated and stated in 10-06's own must-haves and in `docs/publish-budget.md`. The browser's baked-pmf read path is proven by a component test rather than by a live artifact. Honest, seasonal, not a gap.
2. **A test that passes without testing the stated behavior.** The reduced-motion test (`DistrictLedger.test.tsx:952`) asserts only that `district-ledger-drawer--animated` is *absent* under a `matchMedia` stub. There is no positive-case test asserting the class is *present* without the preference, so the assertion would survive the class being deleted entirely. Mitigated by the independent `@media (prefers-reduced-motion: reduce)` rule at `theme.css:942`, but this is exactly why the UI-SPEC marked the row `backstop` — routed to **Human item 1**.
3. **An uncovered error path.** None found in the district Worker pass: `scheduled.district.test.ts` covers a throwing poll, an unparseable payload, an empty rankings array, a missing artifact, a rejected put and a rejected district key, each asserting the *other* district still refreshes and the rotation cursor still writes, plus a secret-leak assertion over every failure mode. The browser side covers a Worker that cannot be constructed, an unpriceable roster isolated to its own event, and unknown slider/drawer ids resolving to safe defaults rather than to a neighbour.

### Planning-vs-execution note (not a gap)

10-01's must-have states the qualification reconciliation as "29,896 of 29,896". The corpus says **29,796** — the ten per-season figures in the plan each reproduce exactly, but the plan's stated sum was 100 too high. The executor caught this, recorded it as a Rule 1 deviation in 10-01-SUMMARY.md, wrote the correct floor into the test, and left a comment at `pointFormulas.reconciliation.test.ts:92` naming the plan's slip. The must-have's *intent* — every TBA-reported district-tier value reproduced exactly, zero mismatches, 75 unresolvable rows all in 2020 — is verified against the live corpus. This is a planning arithmetic error honestly corrected, not an execution failure.

### Human Verification Required

#### 1. Reduced-motion drawer

**Test:** Open any district page with a blue cell, click it to open the histogram drawer — once with the OS "reduce motion" setting ON, once with it OFF.
**Expected:** With reduced motion set, the drawer appears instantly with no fade. With it unset, the 120 ms opacity transition is visible. Drawer content is identical either way.
**Why human:** UI-SPEC declares this a `backstop`. jsdom cannot observe a CSS transition, and the committed test only checks for the absence of a class name with no positive-case counterpart, so it could pass vacuously. Only a real browser with the OS setting toggled distinguishes the two states.

#### 2. The first live district weekend

**Test:** During the next live district event, open `/districts?district={liveDistrict}` and watch across the event's four category boundaries (quals end, alliances announced, finals decided, awards posted). In parallel, `npx wrangler tail` from the main context.
**Expected:** Each category flips from a blue prediction to a grey earned integer within about one to three minutes, with no manual republish. The tick line shows `districtsConsidered` above zero and `districtsRefreshed` moving, with `district-refreshed` log lines and no `district-refresh-failed`.
**Why human:** SC-1's production half has never fired. The Worker is deployed (version `44f15512`) and `v1/manifest/live-windows.json` carries `districtKey` on 52 of 52 windows, but every value is null out of season, so `districtsConsidered` has been 0 on every tick observed. The mechanism is fully proven by 40 passing tests driving the real `runTick` against mocked TBA and R2 — but a manifest carrying the field is eligibility, not evidence. 10-09-SUMMARY.md and `docs/worker-operations.md`'s symptom row both say so plainly; `docs/worker-operations.md` names the counters and log lines to watch.

### Gaps Summary

**No gaps.** All seven ROADMAP success criteria are verified against the codebase with running evidence, not against SUMMARY claims. Every declared artifact exists, is substantive, is wired, and carries real data. Every stated prohibition holds structurally rather than by intention. Zero debt markers were introduced. The repo-root suite, both application tsconfigs and the Worker tsconfig were re-run independently this session and reproduce 10-09's recorded results exactly.

Two items cannot be closed from the codebase and are routed to the human checkpoint: the reduced-motion drawer (a declared UI-SPEC backstop whose committed test is weaker than the claim) and the first live district weekend (SC-1's production half, which this phase deliberately records as eligible rather than exercised). Two follow-ups are named and owed but block nothing: `apps/web/e2e/**` is typechecked by neither tsconfig, and `DistrictLocksTab.tsx` retains an unreachable district arm.

---

_Verified: 2026-09-25T16:20:00Z_
_Verifier: Claude (gsd-verifier)_
