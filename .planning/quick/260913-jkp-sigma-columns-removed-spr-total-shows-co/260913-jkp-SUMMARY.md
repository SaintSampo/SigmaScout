---
id: 260913-jkp
slug: sigma-columns-removed-spr-total-shows-co
description: "Sigma columns removed; SPR Total shows a joined Total ± Sigma split pill on the Teams list, team page, and event Insights, Breakdown and Alliances"
created: 2026-09-13
completed: 2026-09-13
status: complete
commits: [c1ec7cb0, 07af2f2a, 5bd7ad04, d5a429ad, 4964e298, e3110e9d, 365ea0c4, 88973dd7, fba0c84b, 6651e9cc, b12e6223, 2c27d5dd, 51692fd5, 949e78fe, 9bf8829d]
---

# Quick task 260913-jkp: Sigma columns removed, SPR Total shows Total ± Sigma

Jacob asked: "delete all sigma columns. now, anywhere total is displayed for SPR, display a combined box with
sigma after total, seperated by a +/- glyph. do this for the teams list, the total on every team page, and the
insight, breakdown, and alliance tabs on every event page."

**Built, locally verified, and the Worker deployed. The republish and the web push are NOT done.** Jacob is
handing both to another agent (see "Owed" below). Until the republish lands, event tabs render the
"Total ± Sigma" header over plain Total boxes (the honest pre-republish degrade). Task 1's commits already
reached origin through another session's push, so the live Insights tab shows that state now.

## Decisions (Jacob, 2026-09-13)

- **Event-tab Sigma source:** publish Sigma inside the event artifact (pipeline + Worker), never fetch the
  ~200 KB teams artifact from a ~20 KB event page. The whole task waited for 260913-it4 to land first.
- **Box design:** sketch 011 winner A, the split pill. One shape, two halves with no gap: Total in its own
  tier, "± Sigma" in Sigma's own (already inverted) tier.
- **Alliances Combined Total:** ± √(3 × ΣSigma²), the Match Band formula, untiered, all-or-nothing.
- **Phone-390 overflow:** leave it. Measured live: the scroller's inner width is 340px (the wrapper's 1px
  border), and the pill overshoots by 16.31px. Rank and Team # floors (52.31px for "9999", 61.89px for the
  "Team #" header) can only save 13px, so the offered "shrink Rank and Team #" fix could not fit the pill on
  its own. Jacob chose to keep the overflow. The comment in `columns.tsx` records the measurement (9bf8829d).
- **Ship:** deploy the Worker here; another agent republishes and pushes.

## Sketch

`.planning/sketches/011-total-sigma-joined-box/` (c1ec7cb0): five join treatments against live 2026 SPR data.
Winner A.


## Task 1 (tracer): Sigma rides the event artifact into the Insights Total pill

**Commits (5, explicit-path):**
- `07af2f2a` test(260913-jkp): pin sigma riding SPR event standings, absent on OPR, parity on --event (`packages/harness/publish.test.ts`)
- `5bd7ad04` feat(260913-jkp): SPR event standings publish the season-final Sigma entry (`packages/harness/publish.ts`)
- `d5a429ad` test(260913-jkp): pin the split-pill contract and its Insights wiring (`apps/web/src/components/TotalSigmaValue.test.tsx`, `apps/web/src/components/event/InsightsTab.test.tsx`)
- `4964e298` feat(260913-jkp): TotalSigmaValue split-pill component and its CSS (`apps/web/src/components/TotalSigmaValue.tsx`, `apps/web/src/styles/theme.css`)
- `e3110e9d` feat(260913-jkp): Insights Total column renders the split pill under SPR (`apps/web/src/components/event/InsightsTab.tsx`)

**Built:**
- `buildEventTeamsStanding` (publish.ts) gained a required 5th parameter `sigmaByTeam`, merged as the last metrics key after `withEventPercentiles`, so the season ranking pool never re-ranks it. The seasons path passes the existing `sigmaMetricForAlgo`, the same object feeding the teams row and team-season artifact. The `--event` path computes the code-parity equivalent from `layer.consistencyByTeam()` after the fold. Non-Sigma algorithms pass `{}`.
- `TotalSigmaValue.tsx`: shared split pill (sketch 011 winner A), plus `TOTAL_SIGMA_COLUMN_WIDTH_PX = 154`, `totalColumnHeader` and `totalColumnWidth`. With no total it renders a blank `MetricValue` cell. With no Sigma it is byte-identical to plain `MetricValue`. It never reads `total.spread`.
- `theme.css`: `.metric-pill`, `__total`, `__sigma`, `__pm`, `__sigma--neutral`, all from existing tokens.
- `InsightsTab.tsx`: the Total column renders `TotalSigmaValue`, and the skeleton header list matches.

**Verify (printed output):**
- `npx vitest run packages/harness/publish.test.ts`: 203 passed (203)
- web `TotalSigmaValue.test.tsx` + `InsightsTab.test.tsx`: 68 passed (68)
- root `tsc --noEmit`: clean. `tsc --noEmit -p apps/web`: clean.

**Byte cost:** about 40 bytes per rostered SPR team. The largest live SPR event artifact is 2016micmp at 223,178 bytes and 102 teams, so it grows about 4.3 KB to about 227.5 KB, still about 118 KB under the 350,000-byte ceiling. EPA is unaffected.

**Width measurement:** in the `TotalSigmaValue.tsx` doc comment: 130.31 + 16 + 6 = 152.31, rounded up to 154.

**Deviations:** HEAD had moved past d52e5ced through other sessions' commits, none on this task's files, and the cited lines were re-confirmed. A foreign uncommitted Ribbon.test.tsx edit was left untouched. Tests and implementation were written in one pass, then checked for non-vacuous assertions. One test-authoring fix: unmount between the two skeleton renders.

## Task 2: The live Worker keeps the published Sigma entry on touched teams

**Commits:**
- `365ea0c4` test(260913-jkp): failing tests for live-tick Sigma carry-forward (`apps/worker/test/scheduled.test.ts`)
- `88973dd7` feat(260913-jkp): live Worker keeps the published Sigma entry on touched teams (`apps/worker/src/scheduled.ts`)

**Built:** exported `touchedEventTeamMetrics(priorMetrics, freshMetrics)` beside `touchedTeamsRowMetrics`. It returns `roundTeamMetricRecord(freshMetrics)` with the prior record's `SIGMA_METRIC_KEY` entry (value and percentile, as published, not re-rounded) appended last. The entry is added only when the prior record has it and the fresh one lacks it. It is wired into `mergeEventArtifact`'s touched-team rows and `mergeTeamSeasonArtifact`'s `seasonStats.metrics`. `roundTeamMetricRecord` is unchanged.

**Tests:** 4 unit tests (carry-forward with last-key order, fresh wins, undefined prior, no other key carried) and one `runTick` test. The runTick test seeds prior event and team-season artifacts with a Sigma entry, folds a new match for that team, and asserts both written artifacts keep Sigma while `total` updates.

**Verify (printed output):**
- `npx vitest run apps/worker/test/scheduled.test.ts -t "260913-jkp"`: 5 passed, 27 skipped (32)
- scheduled + replay + officialRecord + rp tests: 52 passed (52)
- `npx vitest run apps/worker`: 178 passed (178)
- `npx tsc --noEmit -p apps/worker`: clean

**Deviation:** the runTick test uses the file's default `opr` fixtures with an artificially seeded Sigma entry, the same pattern as the neighbouring 260912-tnk tier-carry test. The carry-forward path is not algorithm-gated, so this exercises the real code without new SPR-specific runTick plumbing.

## Task 3: Delete the Sigma column and tile; split pill on the Teams list, team page, Breakdown and Alliances

**Commits:**
- `fba0c84b` feat(260913-jkp): delete the Teams list Sigma column, Total renders the split pill
- `6651e9cc` feat(260913-jkp): delete the team page's separate Sigma tile, Total renders the split pill
- `b12e6223` feat(260913-jkp): Breakdown's Total column renders the split pill under Sigma-enabled algorithms
- `2c27d5dd` feat(260913-jkp): Alliances picks and Combined Total render the split pill and neutral Sigma band
- `51692fd5` docs(260913-jkp): Sigma page copy describes the new Total ± Sigma placement
- `949e78fe` test(260913-jkp): fix event route skeleton header expectation for Total ± Sigma

**Files:** teams-table `columns.tsx`, `columns.test.tsx`, `rowModel.ts`, `TeamsBubbleChart.tsx`; team `SeasonHeader.tsx` and test; event `BreakdownTab.tsx` and test; `AlliancesTab.tsx` and test; methodology `sigmaContent.ts`; `MetricValue.tsx`; `routes/event.$eventKey.test.tsx`.

**Surfaces:**
- **Teams list:** the 84px Sigma column is deleted. Under SPR, Total renders `TotalSigmaValue` with the header "Total ± Sigma" at 154px in both views. OPR and EPA are unchanged. The bubble chart's Sigma axis stays.
- **Team page:** `SigmaScoreTile` is deleted. The Total tile (the Total-first layout from f33a07ce) renders the pill, reading Sigma from `artifact.seasonStats.metrics`. It no longer reads the last-official-match snapshot, whose history rows carry no Sigma; that is what made today's tile vanish once the events query resolved.
- **Breakdown:** the Total column renders the pill, with an algorithm-aware header and width shared by the table, its group-header spacer and the skeleton. Component columns are unchanged.
- **Alliances:** each pick and backup renders the pill with that team's own Sigma. The Combined Total gets a neutral, untiered ± √(3 × ΣSigma²) band (`AllianceRow.combinedSigma`), but only when all three leading picks carry Sigma.
- **Sigma methodology page:** the copy names the new placement and the Alliances band, with no dash characters.

**Width constants** (source: the plan's measurement block and `TotalSigmaValue.tsx`'s doc comment): `TOTAL_SIGMA_COLUMN_WIDTH_PX = 154`. Alliances: `PICK_COLUMN_WIDTH_SIGMA_PX = 214`, `COMBINED_COLUMN_WIDTH_SIGMA_PX = 180`, `BACKUP_COLUMN_WIDTH_SIGMA_PX = 274`. The widths for algorithms without Sigma are unchanged.

**Verify (printed output):**
- Scoped web suites (TotalSigmaValue, teams-table, team, event, methodology): all passed.
- `git grep sigma-score-tile` printed "OLD TILE GONE".
- Final gate, `npx vitest run` from the repo root: 252 test files passed (252); 5410 tests passed, 1 skipped (5411).
- `tsc --noEmit` for root, web and worker: all clean.

**Deviations:**
1. [Rule 1, bug] `routes/event.$eventKey.test.tsx` pinned the literal "Total" header on an SPR Insights skeleton. It regressed when Task 1 shipped `totalColumnHeader`, and Task 1's scoped verify never ran that file. Fixed in 949e78fe; the full-suite gate caught it.
2. Two fixture corrections during red-to-green: the D-1 width test read Total's width via `phaseAuto`, and the new column-id assertions needed `accessorKey` for the identity columns.
3. Two new AlliancesTab tests first used an OPR fixture that injected `sigma`, which real OPR artifacts never carry. They were rewritten with realistic fixtures.
- Sessions 260913-m45 and 260913-m9m were editing `scheduled.ts`, `scheduled.officialRecord.test.ts`, `MetricHistoryChart.tsx`, `metricHistorySeries.ts` and `RankDistributionTable.tsx` concurrently. Their in-progress state caused brief red outside this plan's files, and it cleared before the final gate. None of those files were edited here.

## Orchestrator verification

- **Full gates on a clean tree at 9bf8829d:** root vitest ran 252 test files, all passed, with 5423 tests passed and 1 skipped (5424). The root, web and worker `tsc --noEmit` runs are clean. An earlier re-run at 949e78fe was red in `BreakdownTab.tsx` and `routes/event.$eventKey.test.tsx`. That came from 260913-m9m's uncommitted sticky-column edit, which removed the `columnPinningFeature` import while code still used it, not from this task. It cleared once m9m committed.
- **Local visual check** (dev server with an empty `VITE_ARTIFACT_ORIGIN`, live artifacts via the /v1 proxy, generation 174d585f):
  - Teams list (spr 2026): 27 pills on desktop and 24 at phone-390. No Sigma column header. First pill "400.21 ± 68.35".
  - Team 2481: one pill on the Total tile ("346.62 ± 72.97"), no `sigma-score-tile`.
  - Insights, Breakdown and Alliances (2026alhu spr): the "Total ± Sigma" header over plain Total boxes and zero pills. This is correct before the republish, because the live event artifact has no `sigma` yet.
  - Teams list under OPR: zero pills.
  - No page errors.

## Deployment

- **Worker deployed:** `sigmascout-worker` version `5c32b48a-0030-4033-86e4-2ab6070d4697`, built from clean HEAD 9bf8829d (no uncommitted changes under apps/worker or packages), `schedule: * * * * *`, bindings MANIFEST (KV), DB (D1), ARTIFACTS (R2), LIVE_ALGORITHM_IDS "spr". First observed tick: outcome ok, cpuTime 2, 0 exceptions, no events considered (no live events). The bundle also carries other sessions' committed but undeployed Worker changes: 260913-it4 (retired accumulator removed, OPR and EPA publish no RP odds) and 260913-m45 (d11737cd, ffa3225e: end-of-tick Sigma on history rows). No D1 reseed is needed; the state shape is unchanged.
- Note: `pnpm --filter worker deploy` resolves to pnpm's built-in `deploy` and fails with ERR_PNPM_INVALID_DEPLOY_TARGET. Use `npx wrangler deploy` from apps/worker, or `pnpm --filter worker run deploy`.

## Owed (handed to another agent by Jacob)

1. **Republish** with `pnpm publish:seasons`, run DETACHED (PowerShell Start-Process with a PID and log file, plus a monitor). Never use `--event`. There is no version bump, so the same keys are overwritten. One republish also covers 260913-it4 (OPR and EPA drop their RP fields and presim sidecars) and 260913-m45 (per-match Sigma on history rows), if m45 has landed by then.
2. **Transcribe the budget:** publish:seasons does not write `docs/publish-budget.md`. Copy the prose and the json budget block, then run `npx vitest run packages/harness/payloadBudget.test.ts`. Expect about +4.3 KB on the largest SPR event artifact (2016micmp, 223,178 bytes, under the 350,000-byte ceiling).
3. **Verify live by content:**
   - In `v1/event/2026alhu/spr@3.0.0+baseline.json`, every team row's `metrics.sigma` equals its `teams/2026` spr row's sigma and its team-season `seasonStats.metrics.sigma` (spot-check frc2481).
   - The opr and epa event artifacts carry no `sigma` key.
   - Then re-take the event-tab screenshots and confirm the pills appear.
4. **Push the web:** check `git log origin/main..main` first, because other sessions' commits ride along. Verify the deployed bundle contains "Total ± Sigma" and `metric-pill`, and no `sigma-score-tile`.
