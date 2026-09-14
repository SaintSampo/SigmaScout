---
quick_id: 260913-nvn
slug: simplify-codebase-audit
date: 2026-09-13
status: complete
closed: 2026-09-14
closed_reason: Jacob closed it with the held-back remainder moved to .planning/todos/pending/finish-nvn-held-back-trims-and-sigma-rename.md
commits: 182
net_lines_outside_planning: -35575
files_deleted: 82
---

# Quick Task 260913-nvn: Simplification audit and cuts

Five read-only audits (`260913-nvn-AUDIT.md`) produced a ranked cut list. Jacob approved, via one batched question:
all four delete sets; the leftovers, comment-diet and test/component-dedup refactors (NOT Worker+D1 SPR-only);
stop-dead-work, self-writing budget and build/upload overlap for republish (NOT --emit-from-season);
and only the cheap page-load wins.

**Totals (27 commits tagged 260913-nvn, outside `.planning/`):** +4,708 / -34,296 lines, net **-29,588**, 80 files deleted.
The lockfile accounts for 2,107 of the deletions.

## Plan 01: non-web deletes (COMPLETE)

`207bf86d`, `f05b07d0`, `dc541717`, `820fe8d7`. Net -23,669 lines, 72 files deleted.

- packages/gbr, packages/pcm, 7 packages/spr research files, one-shot cleanup/recon/mock scripts, statboticsComponentMaps,
  verify-native-module, the EPA-deviation and alliance-reconstruction measure scripts, four Sigma1 docs.
- Harness diagnostics: eventScopeDiagnostic, identifiability (mulberry32 repointed to rankSimulation), baselineFingerprint,
  rpConservativeBranch. The `pnpm harness` backtest CLI cluster (cli, report, artifact, predictions, metricHistory).
- `publish.ts --event` mode and its parity tests. `algorithmIdentity.test.ts`. Worker `bundleSmoke.ts`. Small dead core exports.
- 17 root package.json scripts removed. Todos closed: algorithm-identity-sweep-reads-all-of-data,
  narrow-offseason-population-ablation-entry, event-mode-replays-cold-and-writes-different-numbers.
- Node suite 136 files / 3,551 tests before, 116 / 3,208 after, no failures. Root and worker tsc clean.
- Kept after re-verification (live importers): measureFieldAveragedRanks + the field-averaged builder, measureRandomSchedules,
  statbotics.ts. 260913-pnp (drop licensed schedule templates) is sequenced to delete the first two.

## Plan 02: apps/web (COMPLETE)

`7b1fc266`, `334fff54`, `417e42b9`, `d0ca0797`, lockfile `513ece74`. apps/web net -1,451 lines; lockfile -2,107.

- Web orphans, dead spread CSS and absence assertions, unused exports and shadcn parts, deps `@fontsource-variable/geist` and `shadcn`.
- **Bug fixed:** SPR had no Compare palette colour (`--compare-algo-vpr` renamed to spr; the test now iterates the published ids).
- Spread-sized column widths removed (SPR non-Total columns 120px to 88px). Simulation tab gated to SPR. Event rows read Match Band variance directly.
- Page load: manifest preconnect + preload injected at build for the configured origin, `prefetchQuery` before render,
  footer logo 81 KB PNG replaced by a small WebP with dimensions, `public/_headers` immutable `/assets/*`, Pine shell ribbon, index.html comments stripped.
- Shared `src/test/helpers.ts`; event route tests collapsed with `it.each` (1,007 to 555 lines); EventMatchTable reuses the team MatchTable leaf components.
- Web suite 116 files / 1,891 tests before, 114 / 1,875 after (two deleted test files), no failures. Main chunk 263.50 to 263.24 KB gzip (dead code was already tree-shaken); CSS 15.19 to 14.29 KB gzip.

## Plan 03: republish speed (COMPLETE except one rename)

`4463933f`, `2919f37e`.

- Sidecar builder skipped for algorithms that do not publish ranking points (OPR/EPA).
- Rank scopes sort each pool once: 6.66 s to 7.6 ms per (season, algorithm) on 3,751 teams, identical output.
- Events rows built once per season and shared across the three per-algorithm keys (keys and bytes unchanged; the audit's "identical copies" claim was wrong, each body stamps its algorithm).
- Per-phase `timing:` lines in the run summary.
- Bounded upload queue (default concurrency 48, backpressure) drains while the next block builds.
- `publishBudget.ts` checks every object against its page limit before queueing (dry-run too); `--write-budget` (now in `pnpm publish:seasons`) rewrites the json budget block in `docs/publish-budget.md`, which shrank to 309 lines.
- **Byte identity:** 2025-2026 x opr/epa/spr capture, 24,194 objects / 917,532,792 bytes, deterministic across two baseline runs and identical after each task (Task 2 isolated on an export of 3b3339c7 because spr@4.0.0 landed mid-run from another session).
- Node suite 3,212 passed before, 3,247 after Task 2, no failures.
- Task 3 was reverted at the republish pause, then redone: `53ea3f74` SPR serializer names, `a9c835e9` test-only Sigma Score options dropped, `c4e878e1` current verify:subset tables, `508cdf17` shared strict season-spec parser, `14279993` headline eligibility from corpus seasons only (`selectionProvenance.ts` deleted, -497 lines), `d67723e1` `paramsSeason`/`coldStartSeason`/`--rp-calibration` flags and `splitVersion` removed, `bf7f38fa` `consistencyMetric.ts` renamed to `sigmaMetric.ts` and one opr/epa/spr registry (`manifests.ts` exports `PUBLISHED_ALGORITHM_MODULES`, publish.ts re-exports it; the reverse direction would have created an import cycle). Each group byte-identical on a fresh 24,206-object / 920,597,550-byte capture.
- **Still owed:** renaming the `SigmaScoutLayer.consistencyByTeam()` method and the `preSchedule.ts` input of the same name, plus callers (sigmaScoutLayer tests, sigmaSeed.test, scripts/measureFieldAveragedRanks.ts). Agreed with sigmascout-37: nvn keeps it and does it after sigmascout-26's all-clear and the 260913-pnp merge.

## Plan 04: comment diet (unreserved files COMPLETE)

About 150 `docs(260913-nvn)` commits across the three regions, every batch guarded as comment-only (TypeScript printer comparison, zero code/string/type changes) and tested.
- Provenance markers (quick-task, phase and plan ids in comments) across web, harness/scripts and core/worker: 3,249 to 958. Deleted-feature mentions: 641 to 306.
- Web (region A): finished. Every large production file has no provenance narration left; 1,884 web tests pass, web tsc clean, build succeeds.
- Harness/scripts (region B) and core/spr/worker (region C): finished for every unreserved file. A three-row stale reference to the deleted compare compat test in `pageArtifacts.ts` was fixed.
- Two interrupted executors left garbled half-edits (merged comment-table rows, fragments) in TeamsTable.tsx, rounding.ts and scheduled.replay.test.ts; they passed the guard but were discarded and redone.
- Full-suite check after the last run: nothing new failing; the remaining failures belonged to other sessions' uncommitted work.
- Guard "sealed file changed: packages/core/algorithms/spr.ts" lines were b8eb402e (another session's deliberate spr@4.0.0 change), never an executor edit.

**Held back for other sessions** (the last pass):
- sigmascout-26 (260914-01x, F4 ranking-point fixes and a publish): `packages/core/rankingPoints/**`, `sigmaScoutLayer.ts` and tests, `publish.ts` (the largest remaining target: 1,893 comment lines, 263 provenance markers) and `publish.test.ts`, `stateSnapshot*`, `measureRpCalibration*`, `apps/worker/src/scheduled.ts`, `stateProbe*`, `scheduled.rp.test.ts`, `BonusRpDots`, `bonusRp`, `theme.css`. Several of these already had earlier comment-only trims (analyticPmf, fieldAveraged, rankingPoints 2016-2020 and constants, scheduled.ts, sigmaScoutLayer, stateSnapshot, measureRpCalibration, sigmaScore); sigmascout-26 was sent the commit hashes.
- sigmascout-37 (260913-pnp branch): `preSchedule.ts`, `generatedSchedules.ts`, `scheduleTemplates.ts` and tests, `measureFieldAveragedRanks.ts`, the deleted schedule scripts, `packages/harness/fixtures/**`, `docs/simulation-architecture.md`, `.github/workflows/test.yml`.

## Operator notes for the next republish

1. Upload concurrency 48 has never run live against R2. If retries pile up, stop and rerun with `--concurrency 16`.
2. The publish rewrites `docs/publish-budget.md`'s budget block itself; commit the doc after the run. The memory note calling this a manual step is out of date.
3. An oversized object stops the run before it uploads; earlier blocks may already be in R2 and the next good run overwrites them. `--dry-run` is the full preflight.
4. Expect about a third of the previous 641 presim sidecars (SPR only).

## Bugs found by the audit, not fixed here

1. **Worker re-prices upcoming matches from partial state** (verified): only newly-folded teams' D1 rows load, every upcoming match is re-predicted, unloaded teams fall back to the SPR rookie prior, and the whole `upcoming` array is replaced. Another session recorded it as a todo in 5ffb34dd.
2. **No live polling on the web:** no `refetchInterval` anywhere; live pages refresh on the 5-minute staleTime.
3. **Worker liveness:** a backlog of 3+ newly-played matches exceeds the SPR subrequest budget every tick (matches are never split across ticks).
4. **Possible walk-forward leak (unverified):** presim sidecars for played events receive end-of-season RP accumulator and Sigma inputs.

## Visual checks owed (not screenshotted)

SPR teams table 88px columns; teal SPR series on `/methodology/compare`; Simulation tab disabled on OPR/EPA; merged match tables unchanged
(bands, dots, `± N`, bonus dots, call badges); Pine shell ribbon on cold load (desktop and 390px); WebP footer logo crisp with no shift;
one `algorithms.json` request with no unused-preload warning; `/assets/*` immutable after deploy.

## Remaining approved work

Closed 2026-09-14 by Jacob. The remainder is the pending todo `finish-nvn-held-back-trims-and-sigma-rename`:
the `consistencyByTeam` rename, the comment trims of every held-back file above (`publish.ts` first), and the stale
line citations in `docs/first-paint-measurement.md`. It waits for 260914-01x to push and the 260913-pnp branch to merge.
