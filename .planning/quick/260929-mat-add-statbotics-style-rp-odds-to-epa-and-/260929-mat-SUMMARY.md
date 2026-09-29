---
phase: quick-260929-mat
plan: 01
subsystem: epa-ranking-points
status: complete
tags: [epa, ranking-points, statbotics, simulation, worker, d1, presim, calibration]
requires:
  - epa@13.0.0+baseline (score path, week 1 seal, carry z)
  - RP rule modules 2016-2020, 2022-2026
provides:
  - epa@14.0.0+baseline with its own Statbotics-method RP odds (pmfs, marginals, decomposition)
  - publishesRankingPoints (spr, epa) split from layerPricesRankingPoints (spr only)
  - STATE_SNAPSHOT_SHAPE_VERSION 18 (EPA slots in D1)
  - EPA pre-schedule sidecars priced from EPA's own predict
  - data/baselines/rp-calibration-2026-09h.json (spr + epa)
affects:
  - event Simulation tab (enabled on SPR and EPA, disabled on OPR)
  - live Worker tick (EPA RP folds inside epa.update)
  - Compare page (EPA RP calibration card)
tech-stack:
  added: []
  patterns:
    - algorithm-priced RP passes through SigmaScoutLayer untouched; layer RP machinery gated on layerPricesRankingPoints
    - RP fields appended after final score fields so the level 1 digest proves score invariance
key-files:
  created:
    - packages/core/rankingPoints/bonusMarginalPmf.ts
    - packages/core/rankingPoints/bonusMarginalPmf.test.ts
    - packages/core/algorithms/epaRankingPoints.ts
    - packages/core/algorithms/epaRankingPoints.test.ts
    - data/baselines/rp-calibration-2026-09h.json
  modified:
    - packages/core/algorithms/epa.ts
    - packages/harness/sigmaScore.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/publish.ts
    - apps/worker/src/scheduled.ts
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/components/methodology/epaComparisonContent.ts
    - docs/models/epa-statbotics-gap.md
    - docs/models/statbotics-breakdown-reference.md
decisions:
  - "User decision (Jacob, 2026-09-29): keep Statbotics' bonus-slot seeding EXACTLY as Statbotics does it (get_init_epa carried-strength init with its z term, including the early-season rare-bonus oddity where a stronger team's cold slot is lower below a ~12% league rate). League-rate-only seeding was NOT substituted."
  - "EPA's slot update error uses the raw per-bonus alliance probability (Statbotics' pred_mean after unit_sigmoid), not the clamped published 2026 supercharged marginal; the clamp is a publication-shape rule only."
  - "The 09h rpLayer label still describes SPR's layer only; EPA's odds do not come from that layer. Left as is."
metrics:
  duration: "~45 min"
  completed: 2026-09-29
estimate:
  tokens: 180000
actuals:
  tokens: 51417
  tasks: 3
  commits: 3
---

# Quick 260929-mat Plan 01: EPA ranking point odds by Statbotics' method Summary

EPA 14.0.0 predicts every bonus ranking point from per-team Statbotics RP slots (inv_unit_sigmoid cold seed with the z term, alliance sum, unit_sigmoid, qualification-only folding), emits the same nine RP fields SPR does, folds them live through D1 at state shape 18, prices its own pre-schedule sidecars, and enables the event Simulation tab under EPA while EPA's winner, scores and components stay byte-identical and OPR stays RP-free.

## User decision recorded

**Jacob, 2026-09-29:** keep Statbotics' bonus-slot seeding exactly as Statbotics does it. The cold slot is `get_init_epa`'s RP term kept whole, `cold = preImage(rate) * (1/3 + sdFrac * max(-mean/(3*sd), z_team))`, with the carried-strength z term included, which reproduces the early-season rare-bonus oddity: below a league rate of about 12% the pre-image is negative, so a stronger team's cold slot goes down. League-rate seeding was not substituted. Pinned by `epaRankingPoints.test.ts` ("below about 12% a stronger team's cold slot is LOWER").

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (tracer) | 34d215db | feat(260929-mat): EPA predicts ranking points by Statbotics' method; Simulation enabled under EPA |
| 2 | e8f21627 | feat(260929-mat): EPA ranking points fold live, persist in D1 (state shape 18), and price pre-schedule sidecars |
| 3 | 01a19793 | docs(260929-mat): EPA RP calibration baseline, L-02 lifted, methodology and ops docs |

Base SHA before any edit: `aef03e77`. Two commits from the concurrent 260929-mkn session landed between Task 2 and Task 3 (b81a1071, 0433e0a8, 2bfae95d); none of my commits absorbed a foreign file (staged by explicit path, stats checked).

## Equivalence gate (D-05)

| Check | Result |
|---|---|
| Level 1 digest, epa `predictionStreamSha256` | `b30d7aa5f668...` byte-unchanged under `14.0.0+baseline`; `level1Digest.test.ts` green (it hashes pRedWin/redScore/blueScore) |
| Full-corpus Compare capture, before (base aef03e77) vs after (final tree) | `compare-before.json` and `compare-after.json` are BYTE-IDENTICAL (`cmp`); all 90 slices (opr/epa/spr x 10 seasons x 3 views) equal at full precision; the `--diff` table shows +0.00000 on every row, pooled epa 0.75168 / 0.16977 unchanged |
| Byte ceilings in the after-capture (real publishSeasons dry run) | Passed. Largest event artifact now `v1/event/2016micmp/epa@14.0.0+baseline.json` at 257,491 B (was 228,910 B spr) under 350,000. Teams/events/team unchanged. Total dry-run bytes 3,942,245,952 to 4,116,499,912 (+4.4%) |
| SPR RP records, 09g vs 09h | `deepStrictEqual` true for all 10 spr records; also pinned by `scripts/measureRpCalibration.test.ts` |
| SPR live-equals-offline RP digest | green (unchanged test) |

Compare page note: the capture does not pass `rpCalibration`, so its compare bodies (14,099 B max) carry no RP cards. The live 2026 Compare body with SPR's card was 14,751 B; EPA's 2026 record is 777 B of raw JSON (SPR's 799 B), so the published 2026 Compare body should land near 15.4 KB, under the 20,000 B ceiling. This is an estimate, confirmed only when the owed republish runs its own ceiling gate.

## Calibration (D-07): `data/baselines/rp-calibration-2026-09h.json`

Walk-forward (predict before update) through `SigmaScoutLayer.foldPlayed`, official play only, every registered RP season. Per-bonus column is mean predicted / observed frequency. Outcome Brier is the three-outcome Brier against `[pRedWin, pTie, pBlueWin]`; EPA models no tie (P-4).

| season | algorithm | bonus Brier | mean predicted / observed per bonus | total RP RPS | outcome Brier |
|---|---|---|---|---|---|
| 2016 | epa | 0.1352 | breach 0.623/0.700; capture 0.060/0.130 | 0.1532 | 0.3917 |
| 2016 | spr | 0.1326 | breach 0.656/0.700; capture 0.079/0.130 | 0.1519 | 0.3861 |
| 2017 | epa | 0.0463 | kPa 0.017/0.031; rotor 0.035/0.088 | 0.1218 | 0.4356 |
| 2017 | spr | 0.0534 | kPa 0.002/0.031; rotor 0.225/0.088 | 0.1227 | 0.4388 |
| 2018 | epa | 0.1322 | autoQuest 0.438/0.489; faceTheBoss 0.078/0.088 | 0.1387 | 0.3685 |
| 2018 | spr | 0.1435 | autoQuest 0.637/0.489; faceTheBoss 0.033/0.088 | 0.1405 | 0.3616 |
| 2019 | epa | 0.1034 | habDocking 0.379/0.413; completeRocket 0.029/0.047 | 0.1388 | 0.3989 |
| 2019 | spr | 0.1159 | habDocking 0.397/0.413; completeRocket 0.000/0.047 | 0.1405 | 0.3866 |
| 2020 | epa | 0.1185 | shieldOperational 0.143/0.147 | 0.1738 | 0.4183 |
| 2020 | spr | 0.1202 | shieldOperational 0.109/0.147 | 0.1682 | 0.3997 |
| 2022 | epa | 0.1621 | cargoBonus 0.291/0.340; hangarBonus 0.392/0.437 | 0.1489 | 0.3491 |
| 2022 | spr | 0.1684 | cargoBonus 0.297/0.340; hangarBonus 0.410/0.437 | 0.1451 | 0.3195 |
| 2023 | epa | 0.1676 | activationBonus 0.528/0.566; sustainabilityBonus 0.178/0.243 | 0.1523 | 0.3490 |
| 2023 | spr | 0.1801 | activationBonus 0.542/0.566; sustainabilityBonus 0.115/0.243 | 0.1545 | 0.3357 |
| 2024 | epa | 0.1210 | melodyBonus 0.352/0.389; ensembleBonus 0.095/0.110 | 0.1483 | 0.3635 |
| 2024 | spr | 0.1467 | melodyBonus 0.241/0.389; ensembleBonus 0.035/0.110 | 0.1556 | 0.3452 |
| 2025 | epa | 0.1566 | autoBonus 0.559/0.626; coralBonus 0.147/0.177; bargeBonus 0.403/0.440 | 0.1404 | 0.3418 |
| 2025 | spr | 0.1853 | autoBonus 0.692/0.626; coralBonus 0.016/0.177; bargeBonus 0.300/0.440 | 0.1456 | 0.3246 |
| 2026 | epa | 0.0782 | energized 0.544/0.577; supercharged 0.069/0.081; traversal 0.013/0.001 | 0.1170 | 0.3191 |
| 2026 | spr | 0.0837 | energized 0.629/0.577; supercharged 0.051/0.081; traversal 0.002/0.001 | 0.1137 | 0.2980 |

Pooled (count-weighted across the 10 seasons):

| pooled | bonus Brier | mean predicted | observed | total RP RPS | outcome Brier |
|---|---|---|---|---|---|
| epa | 0.1213 | 0.2589 | 0.2944 | 0.1404 | 0.3688 |
| spr | 0.1341 | 0.2634 | 0.2944 | 0.1415 | 0.3550 |

Read plainly: EPA's bonus probabilities have lower Brier than SPR's in 9 of 10 seasons (2016 is the exception) and pooled; EPA's total-RP RPS is lower pooled (6 of 10 seasons); SPR's outcome Brier is lower in 9 of 10 seasons and pooled, because EPA's outcome half is its binary win probability with zero tie mass and EPA's win probability is weaker than SPR's. EPA under-predicts bonuses overall (0.259 predicted vs 0.294 observed), as SPR does (0.263). EPA extremes: predictions below 0.05 came true 2.57% of the time (n=197,267), above 0.95 came true 93.19% (n=11,661). EPA's matchOutcomePmf[0] equals pRedWin exactly (median and max gap 0).

## Deliberate differences P-1 to P-7 (documented in `docs/models/epa-statbotics-gap.md` mechanism 4)

- **P-1** one slot per season `bonusNames` entry, keyed by bonus name, not Statbotics' `rp_1..rp_3` position; `constant` predicates still get a slot.
- **P-2** the observed flag is the rule module's `parse(...).bonusFlags` (the published actual), not TBA's `*Achieved`.
- **P-3** `get_init_epa` kept whole with its z term (user decision above); league rate walk-forward: frozen week 1 rate after EPA's seal, else live season rate after `EPA_CARRY_RESCALE_MIN_OBS` (250) alliances, else 0.5; slots stored as season-scoped offsets on the cold value.
- **P-4** no tie: outcome `[pRedWin, 0, 1 - pRedWin]`, bonuses independent of outcome.
- **P-5** independent Bernoullis except `nestedSameVariable` groups (2026 energized/supercharged): sorted by resolved threshold, clamped monotone, enumerated by interval.
- **P-6** error split across rating-eligible teams (surrogates excluded); ruling-zero alliances skipped per alliance; demo match skipped whole.
- **P-7** `EPS = 1e-6`, `CURR_YEAR = 2026` (planner's 2026-09-29 fetch); reference section 20 row 5 closed.

Residuals named in the gap doc: the `rp_x_mean` write site in `avg.py` is not transcribed (SigmaScout uses week 1 qualification alliances at RP-eligible events with a parsed breakdown); the 2016/2017 elimination score terms (R1/R2) remain not adopted because EPA's score must not change.

## What the site gains once the owed republish lands

- EPA event and team pages show predicted bonus RP dots and RP pmfs on every qualification row at an RP-eligible event (the dots are data-driven, no web change needed).
- The event Simulation tab is enabled under EPA (start match and pre-schedule); OPR's stays disabled with the title "Simulation is available on SPR and EPA. Switch the algorithm selector to SPR or EPA."
- The Compare page gains an EPA RP calibration card per season.
- Methodology copy (link for editing): `apps/web/src/components/methodology/epaComparisonContent.ts` (`EPA_SAME_PARAGRAPH` gained two sentences; the `week-one-numbers` row's Statbotics cell now names bonus ranking point rates).

## Verification

- Root `npx vitest run`: base 308 files / 7153 passed / 1 skipped, all green; final 310 files / 7197 passed / 1 skipped, 0 failures (judged by printed counts).
- `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web`, `npx tsc --noEmit -p apps/worker`: all clean.
- Worker: `scheduled.rp.test.ts` new test "epa: the LIVE pmf stream ... EQUALS an independent offline SigmaScoutLayer replay" green and non-vacuous (all 4 live matches priced on both arms, pmfs vary); OPR absence test stays.
- Shape 18: round-trip deep-equal with `frozenRates` null and set; shape 17 epa league row refused with `LeagueRowShapeVersionError`; a team without offsets has no `rpSlotOffsets` key; a replayed state reproduces RP odds exactly after serialize/deserialize.
- Presim: EPA sidecar `v1/presim/<event>/epa@14.0.0+baseline...` produced in the publish fixture; builder-level test shows every EPA simInput carries the decomposition; `fillRankingPointsFor` is `undefined` and no pre-event SPR snapshot is taken for epa.
- Tracer publish test: EPA qm rows (played and upcoming) carry pmfs and decomposition end to end; non-qm rows at most `[1]`; the same fixture under OPR carries none.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] EpaState literal fixtures outside the plan's file list**
- **Found during:** Task 1 (root tsc)
- **Issue:** the two new required `EpaState` fields broke hand-built state literals in `carryover.test.ts` and `apps/web/src/lib/metricGroups.test.ts` (plus `epa.test.ts`, `stateSnapshot.test.ts`), and `stateSnapshot.ts`'s deserializer.
- **Fix:** added `rpSlotOffsets: new Map(), rpLeague: emptyEpaRpLeague()` to each literal; Task 1 gave `deserializeEpaState` empty defaults so the Task 1 commit typechecks on its own, and Task 2 replaced them with the shape 18 wire read.
- **Commits:** 34d215db, e8f21627

**2. [Rule 3 - Blocking] Calibration path pinned to 09g in `scripts/measureRpCalibration.test.ts`**
- **Found during:** Task 3
- **Fix:** new 09h pin (path, rpLayer label, `{spr: 9.0.0, epa: 14.0.0}`, both algorithms' seasons, and spr records equal to 09g's); the 09g test kept as a frozen pin without the path assertion.
- **Commit:** 01a19793

**3. [Rule 1 - Stale pin] `attachRpCalibration` test asserted EPA attaches nothing**
- The gate stays `publishesRankingPoints` per plan, so EPA now attaches; the test now asserts that. Commit e8f21627.

**4. [Rule 2 - Honest docs] `docs/publish-budget.md` presim bullet said "SPR only"**
- Not in the plan's file list; reworded to "SPR and EPA ... OPR gets none" (prose only, the machine-written budget block untouched). Commit 01a19793.

**5. [Sequencing] Tracer feedback gate**
- `workflow.auto_advance` is false, but the orchestrator instructed executing all tasks, so the tracer gate ran as the automated re-verify. Task 1's verify list then showed 5 `publish.test.ts` failures, all pins owned by Tasks 2 and 3 (two presim SPR-only pins, one calibration attach pin, two calibration-file set-equality tests). The tracer slice itself (predict, layer pass-through, artifact, web gate, digest) was green. All 5 went green in Tasks 2 and 3; nothing was loosened.

**6. [Test fixture] Demo-match case uses placeholder keys**
- `DEMO_PSEUDO_TEAM_KEY` is not itself a demo key, so the demo test uses `frc0/frc00/frc000` (placeholders, which `isFullyDemoAlliance` treats as demo).

## Shape-mismatch window behavior (read from `apps/worker/src/scheduled.ts`)

After a shape 18 Worker deploy and before the reseed, `loadOrInitState` calls `deserializeState`, which throws `LeagueRowShapeVersionError` on any shape 17 league row. The throw is inside Phase A's try: the tick reverts the event's cursor claim, logs `{"msg":"event-failed", ...}`, counts the event failed and writes no state or artifact; the event retries next tick. Separately, once the republish moves the manifest generation and until the seed lands, `detectStateGenerationMismatch` suspends the whole tick (`state-generation-mismatch` warn). No state is corrupted in either window; live folding simply pauses until the four seed files land.

## Owed from main context (in this order; none were run here)

1. **Worker deploy**, with Jacob's in-message grant: `npx wrangler deploy` from a clean tree (or via `pnpm rebaseline`). During the window above, live events with new matches log `event-failed` and retry each tick; nothing is written until the reseed.
2. **`pnpm rebaseline --skip-ingest`** (or `--from publish` after the deploy): republishes `epa@14.0.0+baseline` and the 2026 EPA presim sidecars, seeds all four files with cursors last (shape 18), verifies, prunes. This run's ceiling gate is what confirms the Compare body with EPA's RP card stays under 20,000 B.
3. **Prune `epa@13.0.0+baseline`** after the six-hour window: `pnpm cleanup:r2-generations` or `pnpm rebaseline --from prune`.
4. **Commit `docs/publish-budget.md`** as rewritten by the publish's `--write-budget`.
5. **`pnpm verify:subset`** (the 2024casf epa entry now expects `present` pmfs on all 72 played qm rows).
6. **Live e2e simulation family**, optionally with a new EPA arm (`apps/web/e2e/support/simulation.ts` still opens `?algorithm=spr`).
7. **Push only with Jacob's go-ahead**; check `origin/main..main` for foreign commits first (the 260929-mkn session's commits are interleaved with these).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (D1 shape 18 and the breakdown fold are T-260929-01/02, mitigated as planned).

## Self-Check: PASSED

- FOUND: packages/core/rankingPoints/bonusMarginalPmf.ts, packages/core/algorithms/epaRankingPoints.ts, data/baselines/rp-calibration-2026-09h.json
- FOUND commits: 34d215db, e8f21627, 01a19793
