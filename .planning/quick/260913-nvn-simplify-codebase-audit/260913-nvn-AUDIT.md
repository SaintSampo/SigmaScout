# Quick Task 260913-nvn: Simplification Audit

**Date:** 2026-09-13
**Method:** Five read-only audit agents (harness/publish, scripts+gbr+pcm+docs, web app + bundle, core+spr+worker, republish cost), import graphs built by script, "VERIFIED" claims grep-proven (comments excluded). Orchestrator spot-checked gbr/pcm importers, harness diagnostic importers, the SPR palette token, `_headers`, and the Worker upcoming-pricing bug.

**Baseline:** ~185k TS lines tracked outside `.planning/` (~77k of them tests), 602 TS files.

| Region | Files | Code lines | Test lines |
|---|---|---|---|
| apps/web | 315 | 56,827 | 27,296 |
| packages/harness | 87 | 38,018 | 19,796 |
| scripts | 53 | 33,867 | 9,455 |
| packages/core | 89 | 24,566 | 11,083 |
| apps/worker | 29 | 9,524 | 5,673 |
| packages/ingest | 21 | 5,675 | 2,752 |
| packages/corpus | 5 | 3,905 | 2,213 |
| packages/spr | 19 | 3,219 | 775 |
| packages/gbr | 13 | 2,620 | 655 |
| packages/pcm | 9 | 1,887 | 489 |

---

## A. Verified-dead delete set (~16k lines, pure deletes)

| Path(s) | Lines | Evidence | Alongside |
|---|---|---|---|
| `packages/gbr/` + `docs/models/gbr.md` | 2,774 | no importers outside itself; shelved 2026-09-08 | drop `gbr:eval`, `gbr:holdout`, `gbr:tune` scripts |
| `packages/pcm/` | 2,040 | no importers outside itself; closed negative | drop `pcm:eval`, `pcm:holdout`; stale comments `core/rankingPoints/marginals.ts:40`, `spr/sealedPaths.ts:24` |
| `packages/spr/{tune,ablate,score,slice,innovations,carryover,equivalence}.ts` | 1,010 | no importers, no script, not on the sealed list | none (confirm `sealedPaths.ts` list before deleting) |
| `scripts/deleteRetiredAlgorithmObjects.ts` + test | 1,744 | superseded by `pruneR2Generations.ts` (its own header says so) | drop `cleanup:retired-objects`; `harness/algorithmIdentity.test.ts` STRUCTURAL_EXEMPTIONS -2 entries, pinned length 11 -> 9; runbook in `docs/publish-budget.md` ~1205-1480 |
| `scripts/deleteOrphanedDemoTeamObjects.ts` + test | 468 | one-shot cleanup, done | drop `cleanup:orphaned-demo-teams`; `publish-budget.md:709` |
| `scripts/mockRankDistribution.ts`, `scripts/verifyAllianceUncertaintyIdentity.ts`, `docs/ui/rank-distribution-mock.md`, `docs/models/alliance-uncertainty-identity.md` | 1,364 | no importers; phase-9 mock + spread-metric check | drop `mock:rank-distribution`; comment `RankDistributionTable.tsx:80` |
| `docs/models/sigma1-{identifiability,reparameterization,sensitivity-screen,tuning-results}.md` | 1,185 | Sigma1 deleted; no code reads them | KEEP `sigma1-rp-verification.md` (cited by string literals in core) |
| `scripts/recon-tba-fields.ts`, `scripts/recon-rocket-rp-2019.ts` | 484 | one-shots, answered | drop `recon:tba`, `recon:rocket-rp`; KEEP their `docs/data/*.md` outputs (tested) |
| `scripts/statboticsComponentMaps.ts` + test | 318 | only its own test imports it; closed EPA-gap arm | none |
| `scripts/verify-native-module.ts` | 40 | phase-1 spike | drop `verify:native` |
| `packages/harness/eventScopeDiagnostic.ts` + test, `data/diagnostics/opr-event-scope-2026-08.json` | 1,383 | only its own test; phase 3.2 one-off | drop `event-scope-diagnostic` |
| `packages/harness/identifiability.ts` + test | 1,124 | importers: eventScopeDiagnostic (deleted above) + `scripts/rpPredictThresholdsGolden.ts:29` for `mulberry32` only, byte-identical to `core/algorithms/simulation/rankSimulation.ts:59` | repoint that import; drop `identifiability` script |
| `packages/harness/baselineFingerprint.ts` + test | 919 | only its own test | drop `fingerprint` script; its test pins `data/baselines/*` parse (move check if wanted) |
| `packages/harness/rpConservativeBranch.ts` | 281 | no importers, no test | drop `rp:conservative-branch` |
| `publish.ts --event` mode (`publish.ts:3644-3950`, `deriveSeasonFromEventKey` 3551-3558, main() branch) + `publish.test.ts` 4280-4303, 4935-5099, 5175-5248 | ~583 | no caller; own comment says never run on a real event; pRedWin wrong on 86/89 rows | closes todo `event-mode-replays-cold-and-writes-different-numbers`; fix `sigmaScoutLayer.ts` header |
| `apps/worker/src/bundleSmoke.ts` | 175 | no importer, not wrangler main; proves ml-matrix bundles (OPR not live) | none |
| Worker/core small dead: `stateStore.ts:148-167` `readAndDeserializeScopedState`; `analyticPmf.ts:825` `pmfStandardDeviation`; `pointModel.ts:198` `maxRookieBonus`; `types.ts:120` `ComponentPrediction.variance` | ~80 | zero or test-only references | none |
| Web orphans: `rpMoments.ts` + test, `ui/separator.tsx`, `lib/api/compare.compat.test.ts` + 14 KB legacy fixture, `.metric-spread-superscript` CSS, unused exports (`groupMetricKey`, `publishesGroupMetrics`, `officialSnapshotMetrics`, `formatSeasonList`, `START_MATCH_PICKER_MAX_H_PX`, `SimulationRunStatus`, `CompareCalibrationBin`, `SIGMA_STEADY_ALLIANCE_EXAMPLE_SIGMAS`, 4 search types), unused shadcn parts (+ `input.tsx`, `textarea.tsx`), deps `@fontsource-variable/geist` and `shadcn` (CLI listed as runtime dep) | ~500 | not reachable from `main.tsx` | tests asserting the absent spread class (`MetricValue.test.tsx:68`, `SeasonHeader.test.tsx:505`) |

## B. Judgment-call deletes

| Path(s) | Lines | Why | Caveat |
|---|---|---|---|
| Closed-experiment measure scripts: `measureEpaDeviations.ts` + test, `measureAllianceReconstruction.ts` + test, `measureRandomSchedules.ts`, `measureFieldAveragedRanks.ts` + `preSchedule.ts:360-529` field-averaged builder + `FieldAveragedPreScheduleArtifactSchema` | ~5,700 | EPA gap work closed; field-averaged closed NO-SHIP; BPR-vs-OPR one-off | KEEP `data/diagnostics/epa-deviation-ablation.json` (EPA page figures); `measureRandomSchedules` doc cited by the pending templates todo (keep doc) |
| `pnpm harness` backtest CLI cluster: `cli.ts`, `report.ts`, `artifact.ts`, `predictions.ts`, metricHistory writer, maybe `statbotics.ts`, and their tests | ~3,660 | output consumers were eventScopeDiagnostic, baselineFingerprint, and the deleted tune/promote; `publish --dry-run` computes the same compare slices | move `ALGORITHMS` registry to a tiny module first (imported by 3 measure scripts + 2 tests) |
| `harness/algorithmIdentity.test.ts` | 508 | sigma1-rename guard, rename finished 2026-08-29; reads all of `data/` (591 MB corpus) every test run | closes todo `algorithm-identity-sweep-reads-all-of-data` |
| Negative-binomial path (`marginals.ts` ~130, `analyticPmf.ts` branches, tests) | ~440 | every season declares gaussian | NB closed on cost not result; 2023-2026 slice unspent and code-guarded. Not recommended |
| Whole `packages/spr` | 3,253 | backs the sealed holdout only | award page scripts import `spr/data.ts`, `spr/model.ts`; provenance of a published number. Not recommended |

## C. Structural simplification

- **Worker SPR-only** (~900 + ~230 lines): `LIVE_ALGORITHM_IDS = "spr"`; delete multi-algorithm live tier parsing, `buildAlgorithmModules`, OPR event-scoped selection (`scheduled.ts:206-385`), manifest path `liveWindows.ts:78-111`, parts of `liveAlgorithmTier.test.ts`, `eventScopedSelections.test.ts`; stop seeding OPR/EPA into D1 (`publish.ts:3474-3517`, 62% of seed row writes, 2 of 3 manual wrangler imports) plus their state serializers (`stateSnapshot.ts:572-800`) once `stateProbe.ts` is SPR-only. Drops the algorithms-manifest KV read per tick (`scheduled.ts:1738-1741`, version never checked).
- **Duplication:** `stateProbe.ts:520-720` repeats the tick's fold; `scheduled.ts:1169-1251` repeats `sigmaScoutLayer.ts:361-431` RP helpers; `parseSeasonsRange` x3; opr/epa/spr registry x4 (`cli.ts:86`, `BASE_PUBLISH_ALGORITHMS`, `manifests.ts:246`, `selectionProvenance.ts`); `splitVersion` vs `splitManifestVersion`; `team/MatchTable.tsx` vs `event/EventMatchTable.tsx` (151 identical code lines, 5 twin components); `erf/normCdf` x4.
- **Inert knobs:** `selectionProvenance.ts` + `score.ts` eligibility plumbing (all entries return `[]` since Sigma1); `paramsSeason` unused in `buildAlgorithmsManifest`; `coldStartSeason` option with no caller; `--rp-calibration` flags; `SigmaScoreOptions.scale/.talentPrior` test-only; `includeOffseason` default false but the only real run passes true; `SIMULATION_AVAILABLE = true` constant (`SimulationTab.tsx:79-102`); `publishesRankingPoints` = `usesSigmaScore`.
- **Swing/VPR/spread leftovers:** spread-sized column widths `columns.tsx:203-266` (+ tests naming VPR); `--compare-algo-vpr` token; `redScoreVarianceOwn` re-labelled band variance in `eventMatchAxis.ts`; `serializeBprState`/`deserializeBprState`; `resolvePublishAlgorithms` doc "promoted VPR"; `consistencyByTeam` / `consistencyMetric.ts` naming; `spr.ts` points at nonexistent `packages/bpr/` 8x (seal-hash sensitive); `reports/publish/SEED-COMMANDS.txt` names bpr; `verifySubsetPublish.ts` header sigma1/vpr/bpr tables; unread schema fields: team match row `variance`, team-artifact `*ScoreVarianceOwn`/`*RpPmf`, SPR `TeamMetric.spread`, record-form metrics union (`pageArtifacts.ts:1181`), old presim `schedules` block (`pageArtifacts.ts:2061-2096`).
- **Comment weight:** web `src` is 10,722 comment lines vs 14,533 code (42%); `publish.ts` 47% (1,938 lines), `pageArtifacts.ts` 61%, `sigmaScore.ts` 65%, `stateSnapshot.ts` 51%, `publishedAlgorithms.ts` 94%. Much is narration of finished cutovers. core has 189 Sigma1/VPR/BPR/Swing comment mentions across 52 files.
- **Test duplication:** `routes/event.$eventKey.test.tsx` repeats per-tab 404/500/sibling/search tests (~400 lines via `it.each`); `makeArtifact` redefined in 12 files, `mockNarrowViewport` 5, `makeQueryClient` 4.

## D. Republish time

Measured (docs/publish-budget.md): 2026-09-13 gen 174d585f ~1h55m, 108,979 objects, 4.16 GB. 2026-09-11 ~41 min before `PRESIM_SCHEDULE_COUNT` went 20 -> 1,000 (+65-74 min). No per-phase timing exists. Keys are version-addressed and overwritten in place (not generation-prefixed).

1. **Gate pre-schedule sidecars on `publishesRankingPoints`** (`publish.ts:3244-3262`): OPR/EPA calls now only return null after building a template, schedule 0, a probe prediction. Roughly -45 min vs the last measured run (much already realised by 260913-it4, unmeasured). Low risk.
2. **O(N^2) rank scopes:** `teamRanks.ts:290 rankWithin` copies and sorts the pool per team, x4 scopes, called per team at `publish.ts:3112`. Benchmarked 4.5 s per (season, algorithm) on 3,751 synthetic teams, ~110 s per republish. Sort once per scope. Low risk (keep `compareTeamsByTotal` tie-break).
3. **`events/{year}/{algo}` is algorithm-independent** (`buildEventsArtifact`, `publish.ts:1544`): 3 identical copies per season.
4. **Publish writes its own budget block** (`publish.ts:3521-3540` prints; `payloadBudget.test.ts:77` parses the hand-copied doc block). Removes a manual step. Add per-phase timers.
5. **Build and upload never overlap** (`publish.ts:3353/3367`, 16 concurrent PUTs). Try `--concurrency 48`, then a draining upload queue. Medium-low confidence.
6. **`--emit-from-season`:** replay all seasons for carry (16-29 s each) but upload only from a chosen season; 2016-2025 bodies differ only in `generation`/`computedAt` when versions are unchanged. ~90% fewer uploads on data-only refreshes. Medium risk (`verify:subset` single-generation check).
7. **`manifest:algorithms` script** is rename-only; full publish writes the manifest (`publish.ts:3450-3462`).

## E. Page load

Build: main chunk `index-*.js` 899.9 KB / 263.5 KB gzip (react-dom 174, Radix+floating-ui+cmdk 102, zod 69, router-core 51, methodology 62, event/match 60, react-table+virtual 59, query-core 33, tailwind-merge 26.5, compare 21, schemas 17, districts 16). `MetricHistoryChart` lazy chunk 332.5 KB / 96.9 KB gzip (Recharts). CSS 85.9 / 15.2 KB gzip.

1. **Waterfall:** HTML -> 263 KB JS -> render -> algorithms manifest -> artifact (`useAlgorithmVersion`, `AlgorithmSelect.tsx:167-170`, used by every versioned route). No preconnect/preload in `index.html`, no route loaders, no `defaultPreload`. Fix: preconnect + `preload as=fetch` for `v1/manifest/algorithms.json`, `prefetchQuery` in `main.tsx` before render, loaders with `ensureQueryData` + `defaultPreload: "intent"`.
2. **Footer logo** `public/alfredo-systems.png` 81 KB, 1707x608, shown 32 px tall, no width/height/lazy. ~4 KB WebP.
3. **No `public/_headers`:** hashed `/assets/*` not marked immutable.
4. **Team page fetches the season events artifact** (median 68.7 KB) only to recompute `officialSnapshotRow` (`team.$teamNumber.tsx:72-76`) although `seasonStats.metrics` already is that snapshot. Publish the snapshot match key instead (verify tiers/percentiles match).
5. **Lazy-load methodology, compare, districts only** (~99 KB min / ~29 KB gzip off every other page; the earlier reverted attempt split every route, `docs/first-paint-measurement.md:347-395`).
6. **zod on the client** (~22 KB gzip + main-thread validation of 0.9-1.5 MB teams artifacts). Removing it removes the validation-error screen. Decision needed.
7. **`index.html` placeholder ribbon** is light gray vs real Pine green `#14532d` (flash on cold load); 3.1 KB of comments.
8. Router plugin scans test files in `src/routes` (`routeFileIgnorePattern`).

## F. Bugs found during the audit (not simplification)

1. **Worker re-prices upcoming matches from partial state (VERIFIED by orchestrator).** `scheduled.ts:1039` `touchedTeams` = teams in newly-folded matches only; `selectionsFor` (`:383`) loads only those D1 rows; `:1296` re-predicts EVERY still-upcoming match from that state; SPR `viewOfMap` falls back to `freshTeam` (rookie prior) for any unloaded team (`core/algorithms/spr.ts:468`); `mergeEventArtifact` replaces the whole `upcoming` array (`scheduled.ts:672`). RP is already gated for this (`:1186-1200` partial-roster gate) but win odds, predicted score, and band are not. Live-event upcoming predictions are wrong for any match containing a team that did not just play.
2. **SPR has no Compare palette colour.** `CalibrationSection.tsx:107,134`, `RpCalibrationSection.tsx:106,133` use `var(--compare-algo-${id})`; `theme.css:256-258,1249-1257` define opr/epa/vpr only; `comparePalette.test.ts:43-47` pins the vpr value.
3. **No live polling on the web.** No `refetchInterval` anywhere in apps/web; live pages refresh only after the 5-minute `staleTime`, missing the 1-3 min freshness goal. `query-client.ts:5-10` comment describes polling that does not exist.
4. **Worker liveness hazard:** SPR-only subrequest cost `4 + 2(1+n)` vs 41 remaining caps a tick at ~17 touched teams; newly-played matches are never split across ticks (`scheduled.ts:1029`), so a backlog of 3+ matches defers the event every tick indefinitely.
5. **Possible walk-forward leak in presim sidecars (SUSPECTED):** sidecars for played events use pre-event rating state but `makeRankingPointFiller` receives `rpAccumulator` and `consistencyByTeam()` after the whole season is folded (`publish.ts:2803-2840`, 2975, 3259).
