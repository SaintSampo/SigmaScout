---
status: resolved
trigger: "EPA pre-schedule (presim) sidecar pricing is about 8x slower per event than SPR"
created: 2026-10-04
updated: 2026-10-04
---

# Debug: EPA presim sidecar pricing is about 8x slower per event than SPR

## Symptoms

<!-- DATA_START -->
- **Expected:** EPA's pre-schedule sidecar costs no more per event than SPR's. EPA's ranking-point odds use the Statbotics sigmoid method (additive sums and a logistic, quick task 260929-mat, epa 14.0.0), which should be cheaper than SPR's analytic lattice pmf.
- **Actual:** a dry-run publish at bd040e70 (`npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2016 --dry-run --skip-state`, 2026-09-29 21:25 to 2026-09-30 05:16) logged:
  - 2026: `2026/epa sidecars 3320.6s` against `2026/spr sidecars 425.7s` (about 15 s against about 2 s per event)
  - all seasons: EPA sidecars 23,638 s, SPR sidecars 3,834 s, total run 28,245 s
  - per season EPA/SPR seconds: 2016 628.9/430.4, 2017 1833.0/402.8, 2018 2010.3/414.6, 2019 2733.4/358.6, 2020 1043.3/83.6, 2022 2610.9/354.3, 2023 2957.7/373.9, 2024 3167.6/417.2, 2025 3331.9/572.9, 2026 3320.6/425.7
  - note 2016's ratio (1.5x) is far smaller than every later season's (4.5x to 8x)
- **Error messages:** none. The run exits clean.
- **Timeline:** EPA presim sidecars did not exist before 260929-mat (commits 34d215db, e8f21627). The slowness is as old as the feature.
- **Reproduction:** the command above (7.85 h in full). Full log: reports/presim-allyears/dryrun.out.log (gitignored). A single-season run (`--seasons 2026 --presim-from-season 2026 --dry-run --skip-state`) starts cold and is NOT the published state, but reproduces the cost shape faster.
- **Related measurement:** quick task 260929-mkn (.planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-FINDINGS.md) found that for SPR, schedule generation is 76 to 88 percent of presim wall time and pricing about 7 percent. The schedule-structure LRU memo in packages/harness/preSchedule.ts is keyed by (roster size, matches per team); whether EPA and SPR share its cells within one run, or EPA's pass evicts and regenerates them, is unchecked.
<!-- DATA_END -->

## Constraints

- Profile first (for example `node --cpu-prof` through tsx on one season, or timers around generate / predict / fill / draw) before changing anything. Do not guess.
- The fix must NOT change published numbers. Prove it: sidecar bodies byte-identical before and after for a fixed sample (at least one small, one mid, one large 2026 event, EPA and SPR), with a fixed generation and computedAt. If the only fix changes output, STOP and ask Jacob; changed numbers need an epa version bump.
- No publish, no deploy, no R2 or D1 writes, no push. Dry runs with `--dry-run --skip-state` are fine; never pass `--write-budget`.
- Never Read or print .env. Let tsx load it with `--env-file=.env`.
- Run vitest as `npx vitest run <file>` from the repo root and verify by the output, not the exit code.
- Stage by explicit path. Other sessions share this checkout. Run `git status` after each commit.
- Long runs (over about 5 minutes): detach with PowerShell Start-Process and watch a log; Bash background runs get killed on this machine.
- Report the before and after seconds for the same command as a within-run comparison (EPA against SPR in one run), not as absolute bars.

## Current Focus

- hypothesis: CONFIRMED (formed from the profile, then tested by run 3). `epa.predict` copies the state's whole `teamComponents` map (`new Map(teamComponents)` in `materializePendingTeams`) on every call whose match names a team still in `carryPending`. A presim sidecar calls `predict` 50,000 to 132,000 times per event against one frozen pre-event state, so an event with any season-debut teams pays an O(all teams) copy on nearly every call.
- bug_class: Bohrbug (deterministic cost, reproduces on every run)
- state: fix APPLIED in the working tree, not yet committed (`packages/core/algorithms/epaCarryScale.ts`, `epa.ts`, and their two test files). Six-event sample verified byte-identical in both configurations; every page artifact verified byte-identical.
- next_action: none (resolved 2026-10-04; closed out by the orchestrator after the session manager was interrupted)
- full BEFORE run in flight: PID 5212, started 2026-10-04T21:20:48-04:00, `presimProbe.mts --seasons 2025,2026 --presim-from 2026 --algorithms opr,epa,spr --include-offseason` (every 2026 sidecar, no event filter, no timers). Output `full-before.json`, log `full-before.out.log`, bodies `before-bodies-full/` in the scratchpad. Its modules loaded at start (the import graph of `publish.ts` has no dynamic import on this path), so source edits made while it runs cannot reach it.
- full AFTER run in flight: PID 24264, started 2026-10-04T21:40:26-04:00, the same command writing `full-after.json`, `full-after.out.log`, `after-bodies-full/`.
- do NOT edit any repo source file while PID 4036 (vitest) is alive: its workers read source as they load.

reasoning_checkpoint:
  hypothesis: "EPA's presim sidecar pass is slow because `epa.predict` rebuilds a full copy of `state.teamComponents` (about 3,900 entries here, more in an all-seasons run) on every call that touches a carry-pending team, and the sidecar builder makes 50,000 to 132,000 such calls per event against one unchanging state. The copy exists only so `predictCore` can read at most six teams' rescaled components."
  confirming_evidence:
    - "CPU profile (run 2): `materializePendingTeams` holds 39.9 s of SELF time, 85% of `epa.predict`'s 46.9 s inside the sidecar builder; `predictCore` is 6.2 s."
    - "Timers (run 1): 163 to 188 us per synthetic predict at the four week-2 events, 13 us at the two late events, on identical code."
    - "Counts (run 3): the share of calls touching a pending team is 1.00, 1.00, 0.97, 0.93 at the four slow events and 0 at the two fast ones; cost tracks the share (0.93 gives 163 us, 1.00 gives 185 to 188 us)."
    - "Symptom data: 2016, the only cold-start season in the all-seasons run (empty `carryPending`), is the only season at 1.5x; 2020, whose events are all early-season, is the worst at 12.5x."
  falsification_test: "With `predict` no longer copying the whole map, EPA's per-predict cost at the four week-2 events must fall to the late events' level (about 13 us) and `materializePendingTeams` must leave the top of the profile. If the week-2 events stay near 170 us per predict, the hypothesis is wrong."
  fix_rationale: "`predictCore` reads `state.teamComponents` in exactly two places, both `sumComponentsAcrossTeam` over the match's own rating-eligible teams. A map holding only those teams' entries (rescaled where pending) answers every one of those reads with the same values in the same order, so the arithmetic is bit for bit the same and the per-call cost drops from O(all teams) to O(match teams). `update` keeps the full-map materializer, because its result becomes the next state. This removes the cause for every caller of `predict` (sidecars, district bake, Worker, browser pricing), instead of caching around it in the publisher."
  blind_spots: "(1) Verified on a two-season state (2025 then 2026); the all-seasons production run was not rerun (7.85 h), so its absolute seconds are extrapolated. (2) The scoped map is safe only while `predictCore` reads no team outside the match; a regression test compares it against the full-map path on a state with bystander teams to catch a future read that breaks this. (3) Worker and browser bundles import the same `epa.ts`; they were not deployed or exercised here."
  candidate_causes:
    - "code: `materializePendingTeams` copies the whole map per `predict` call (CONFIRMED, the EPA-specific cost)"
    - "config (run order): algorithms run opr, epa, spr, so EPA's `sidecars` timer absorbs every structure-cache miss and SPR's none (CONFIRMED as a second, independent share of the timer gap: 46.1 s of 111.7 s in run 1; it is an attribution effect, not extra work, since one of the two passes must generate each structure once)"
    - "config (cache size): the 128-cell LRU evicting cells between EPA's pass and SPR's, forcing regeneration (ELIMINATED, see Eliminated)"
    - "data: early-season pre-event states making `predictCore` itself slower (ELIMINATED, see Eliminated)"
    - "environment: GC pressure slowing EPA's pass (a CONSEQUENCE of the copies, 27.5 s process-wide in run 2, not an independent cause; rechecked after the fix)"
  and_gate: "yes, for the cost to show: (a) the per-call whole-map copy in `predict` [code], (b) a caller that calls `predict` tens of thousands of times on one state [the presim sidecars, new for EPA in 260929-mat], and (c) a carried season with roster teams still pending [state]. (a) is the defect; (b) and (c) are what expose it, which is why a season replay (one predict per real match) never showed it and why the cold-start season does not. Fixing (a) removes the cost under any (b) and (c). The structure-generation share is a separate additive effect and is not gated on any of these."
- instrument: `%TEMP%/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/0c0931fc-1f09-44e1-954e-aaadeb5c0eee/scratchpad/presimProbe.ts`. No repo file is edited. It observes sidecar bodies through `Buffer.byteLength` (the dry-run uploader measures every sidecar body with it) and restricts events by wrapping each algorithm's `predict` so an unselected event's schedule-0 probe sees "no RP model". Selected events pass through untouched.
- sample for byte identity: small 2026arli (25 teams), 2026txwac (25); mid 2026casnd (40), 2026mibel (39); large 2026mrcmp (66), 2026arc (75). Pinned generation `debug-epa-presim-slow-0001`, computedAt `2026-10-04T12:00:00.000Z`.

## Evidence

- timestamp: 2026-10-04 (session start)
  checked: knowledge base `.planning/debug/knowledge-base.md`
  found: one entry (worker-tick-exceeds-cpu-budget). No keyword overlap with presim, sidecar or schedule generation.
  implication: no known-pattern candidate. Proceed open-ended.

- timestamp: 2026-10-04
  checked: `packages/harness/publish.ts` sidecar call site (lines 2554 to 2616) and `buildPreScheduleSidecarForEvent` (1376 to 1452); `packages/harness/preSchedule.ts` in full
  found: the algorithm loop is the outer loop and the event loop the inner one, in `PUBLISHED_ALGORITHM_IDS` order opr, epa, spr. So within one season EPA's whole sidecar pass runs before SPR's. Both passes read one process-wide `SHARED_STRUCTURE_CACHE` (128 cells, LRU). `sidecarMs` wraps the whole of `buildPreScheduleSidecarForEvent`: structure generation, 1000 schedules of `predict`, 1000 x 50 draws, schema parse and `JSON.stringify`.
  implication: EPA's `sidecars` timer includes every structure-cache miss of the season and SPR's includes none of them when the cells survive. The two timers are not like for like on generation. How much of the gap that explains is a measurement question, not an assumption.

- timestamp: 2026-10-04
  checked: the `ArtifactSink` hook as a way to capture sidecar bodies
  found: `BoundedUploader.publishSidecarThenEvent` hands the sink the EVENT body only. The sidecar body goes to `sidecarRecords` as key and byte count.
  implication: the sink cannot capture sidecar bodies. The probe hashes them at `Buffer.byteLength` instead, which sees the exact string that would be uploaded.

- timestamp: 2026-10-04
  checked: per-season lines of reports/presim-allyears/dryrun.out.log
  found: season replay is 57 to 92 s; `build` is 1 to 6 s per algorithm. 2016 (the run's cold-start season) is the only season where EPA/SPR is 1.5x; every carried season is 4.5x to 12.5x (2020: 1043.3 s against 83.6 s).
  implication: a single-season 2026 run starts cold like 2016 did, so it may NOT reproduce the slow shape. The repro runs 2025 then 2026 with `--presim-from 2026`, so 2026 carries state in.

- timestamp: 2026-10-04 21:14 to 21:18 (run 1, timers; HEAD 21ae0d56, clean tree)
  checked: `node --env-file=.env --import tsx presimProbe.mts --seasons 2025,2026 --presim-from 2026 --algorithms epa,spr --events 2026arli,2026txwac,2026casnd,2026mibel,2026mrcmp,2026arc --time`
  found: `2026/epa sidecars 111.7s` against `2026/spr sidecars 21.3s`, same run, same six events (5.2x). Per event, EPA then SPR:
    | event (teams, week) | EPA wall | EPA structure generation | EPA `predict` total | EPA us per predict | SPR wall | SPR structure |
    | 2026arli (25, wk 2) | 13.2 s | 2.4 s (1000 misses) | 9.2 s | 185 | 2.0 s | 0.005 s |
    | 2026txwac (25, wk 2) | 9.5 s | 0.006 s (same shape as arli, all hits) | 8.2 s | 163 | 2.0 s | 0.007 s |
    | 2026casnd (40, wk 2) | 23.4 s | 5.9 s | 15.0 s | 188 | 3.1 s | 0.007 s |
    | 2026mibel (39, wk 2) | 21.9 s | 5.5 s | 14.0 s | 180 | 3.2 s | 0.010 s |
    | 2026mrcmp (66, wk 6) | 21.5 s | 16.0 s | 1.7 s | 13 | 5.6 s | 0.016 s |
    | 2026arc (75, division) | 21.8 s | 16.3 s | 1.7 s | 13 | 5.4 s | 0.009 s |
  implication: two separate things sit inside EPA's timer. (1) Structure generation: 46.1 s of the 111.7 s. EPA pays every cache miss because it runs first; SPR's pass is all hits. (2) EPA's own `predict` costs 163 to 188 us per synthetic match at the four week-2 events and 13 us at the two late events, a 14x swing on the same code. Take structure generation out and a late event costs the same under both algorithms (2026arc: 5.4 s EPA, 5.4 s SPR), while an early one is still 5.6x (2026casnd: 17.5 s against 3.1 s).

- timestamp: 2026-10-04 21:14 to 21:18 (run 2, `node --cpu-prof`, no timers, same six events)
  checked: V8 CPU profile, subtree under `buildPreScheduleSidecarForEvent` (130.2 s sampled; the run logged `2026/epa sidecars 121.3s`, `2026/spr sidecars 20s`)
  found: by inclusive time: `generateSchedule` 49.2 s (37.8%); `epa.predict` 46.9 s (36.0%), of which `materializePendingTeams` (`packages/core/algorithms/epaCarryScale.ts`) is 40.2 s with 39.9 s SELF and `predictCore` only 6.2 s; `roundPmf` 13.5 s; SPR's `analyticRpPmf` 8.0 s; `simulateRanks` 7.5 s. Whole process: `(garbage collector)` 27.5 s.
  implication: 85% of EPA's `predict` time is self time in `materializePendingTeams`. Its only non-trivial statement is `new Map(teamComponents)`, a copy of the state's whole team map, run again on every `predict` call that touches a still-pending team.

- timestamp: 2026-10-04 21:19
  checked: sidecar digests of run 1 against run 2 (two independent processes, pinned generation `debug-epa-presim-slow-0001`, computedAt `2026-10-04T12:00:00.000Z`)
  found: 12 of 12 sha256 digests and byte counts equal.
  implication: the capture is deterministic, so a before and after digest comparison is a valid byte-identity test. These 12 are the BEFORE digests for the six-event sample (listed under Resolution).

- timestamp: 2026-10-04 21:22 to 21:26 (run 3, `pendingProbe.mts`, counts only, no timers)
  checked: for each sample event, how many synthetic EPA `predict` calls name a team that is in `state.carryPending` and in `state.teamComponents` (the calls that take the copy path), and the size of the map copied
  found:
    | event | predict calls | calls touching a pending team | share | roster teams pending | `teamComponents.size` | us per predict (run 1) |
    | 2026arli | 50,000 | 49,980 | 1.00 | 16 of 25 | 3,864 | 185 |
    | 2026casnd | 80,000 | 79,988 | 1.00 | 29 of 40 | 3,923 | 188 |
    | 2026mibel | 78,000 | 75,654 | 0.97 | 16 of 39 | 3,877 | 180 |
    | 2026txwac | 50,000 | 46,512 | 0.93 | 8 of 25 | 3,880 | 163 |
    | 2026mrcmp | 132,000 | 0 | 0 | 0 of 66 | 4,013 | 13 |
    | 2026arc | 125,000 | 0 | 0 | 0 of 75 | 4,015 | 13 |
  implication: dose and response line up. Cost per predict is about 13 us plus about 172 us times the share of calls that touch a pending team. Eight pending teams on a 25-team roster already put 93% of synthetic matches on the copy path, so any event with a few season-debut teams pays on nearly every call. Each such call copies a map of about 3,900 entries (two seasons in this repro; the all-seasons run carries more teams, so each copy costs more there). An event whose teams have all played this season pays nothing.

- timestamp: 2026-10-04 21:26 to 21:31 (run 4, `allArtifactsProbe.mts`, BEFORE capture of every page artifact)
  checked: `--seasons 2025,2026 --presim-from 2026 --algorithms opr,epa,spr --include-offseason --events <the six>`, with a read-only `ArtifactSink` hashing every page body
  found: 24,377 page artifacts hashed (event 1,926; team 22,437; teams 6; events 6; compare 2), digest of digests `01bc6e733450abc2d002fb3a60a559f361bfbfb0e93ef2cc73e10cefdf9c79d7`, plus 12 sidecar digests for this configuration. `2026/epa sidecars 119.6s` against `2026/spr sidecars 22.1s`.
  implication: a BEFORE baseline for every published body that passes through `epa.predict` in replay, not only the sidecars. The sidecar digests differ from runs 1 and 2 because this run adds `--include-offseason`; each configuration is compared only with itself.

- timestamp: 2026-10-04 21:33:32 (RED, before the fix)
  checked: `npx vitest run packages/core/algorithms/epa.test.ts` with the two new tests written and the source untouched
  found: `Tests 1 failed | 97 passed (98)`. The failure is the driving test, "predict reads only the match's own teams: a pending team never makes it enumerate the whole team map": `expected 1 to be +0`, one whole-map enumeration per `predict` call. The second new test (scoped against full-map equivalence) passes on the old code, as it must: the old code IS the full-map path.
  implication: the driving test reproduces the root cause itself (the copy), deterministically and without a timer.

- timestamp: 2026-10-04 21:34:39 (GREEN, fix applied)
  checked: `npx vitest run packages/core/algorithms/epa.test.ts packages/core/algorithms/epaCarryScale.test.ts`
  found: `Test Files 2 passed (2)`, `Tests 114 passed (114)`.
  implication: the driving test passes and the exact-equality tests hold on the fixed code.

- timestamp: 2026-10-04 21:35 to 21:39 (AFTER, run 1's command again, with timers)
  checked: per-predict cost and the 12 sidecar digests of the no-offseason configuration
  found: `2026/epa sidecars 80.9s` against `2026/spr sidecars 26.3s` (before: 111.7 s against 21.3 s). EPA us per predict: 2026arli 17, 2026txwac 19, 2026casnd 19, 2026mibel 16, 2026mrcmp 18, 2026arc 18 (before: 185, 163, 188, 180, 13, 13). EPA structure generation in this run: 52.8 s of the 80.9 s, so EPA without it is 28.1 s against SPR's 26.3 s (before: 65.6 s against 21.3 s). 12 of 12 digests identical to run 1. This run shared the machine with three other probe runs, which is why SPR's own seconds rose 23%; compare within the run.
  implication: the falsification test passed. The four week-2 events now price at the late events' rate, and what is left of the EPA and SPR timer gap in this sample is structure generation, which EPA pays because it runs first.

- timestamp: 2026-10-04 21:35 to 21:40 (AFTER, run 4's command again)
  checked: every page artifact and the 12 sidecars of the include-offseason configuration
  found: 24,377 of 24,377 page artifacts identical (digest of digests `01bc6e733450abc2d002fb3a60a559f361bfbfb0e93ef2cc73e10cefdf9c79d7` both times); 12 of 12 sidecar digests identical; the 12 saved body files are `cmp`-identical. `2026/epa sidecars 83.3s` against `2026/spr sidecars 25.8s` (before: 119.6 s against 22.1 s).
  implication: no published byte moved in any page kind for 2025 or 2026 under opr, epa or spr.

- timestamp: 2026-10-04 21:35 to 21:39 (AFTER, run 2's command again under `node --cpu-prof`)
  checked: the profile under `buildPreScheduleSidecarForEvent`
  found: 96.1 s sampled (before 130.2 s). No `materializePendingTeams` or `materializePendingTeamsScoped` entry in the top 28 by self time. `generateSchedule` 49.5 s (before 49.2 s, unchanged, now 51.5% of the subtree); `roundPmf` 14.9 s; SPR's `analyticRpPmf` 9.8 s; `simulateRanks` 8.7 s; EPA's `predictCore` 1.2 s self. Whole process `(garbage collector)` 23.9 s (before 27.5 s).
  implication: the 40 s is gone and nothing replaced it. The largest remaining cost in the sidecar pass is schedule-structure generation, common to both algorithms and not part of this bug.

- timestamp: 2026-10-04 21:38
  checked: `npx tsc --noEmit` at the root, `-p apps/worker/tsconfig.json` and `-p apps/web/tsconfig.json`
  found: worker and web clean. Root reports 3 errors, all at `scripts/measureChampCutoff.ts:845` (`Property 'chips' does not exist on type 'DistrictTimeline'`). `git show HEAD:scripts/measureChampCutoff.ts` has the same line, and the file is not in this session's diff.
  implication: the root typecheck is red at HEAD 21ae0d56 for a reason unrelated to this fix (the `chips` field left `DistrictTimeline` in the 260929-ttp refactor, 53e97103). Not touched here; reported to the orchestrator.

- timestamp: 2026-10-04 21:40:27 to 21:44:33 (adjacent tests)
  checked: `npx vitest run --maxWorkers=3` from the repo root, fix applied
  found: `Test Files 312 passed (312)`, `Tests 7236 passed | 1 skipped (7237)`, duration 245.69 s. Read from the printed summary, not the exit code.
  implication: nothing in the import graph of `epa.ts` or `epaCarryScale.ts` broke, including the corpus-backed publish, replay, state-snapshot and prediction-digest suites.

- timestamp: 2026-10-04 21:45 (revert and reconfirm, which is also the manual mutant at the fix site)
  checked: put the full-map `materializePendingTeams` back in `predict` (one identifier), ran `npx vitest run packages/core/algorithms/epa.test.ts`, then restored the fix and reran both test files
  found: reverted: `Tests 1 failed | 97 passed (98)`, the driving test again `expected 1 to be +0`. Restored: `Tests 114 passed (114)`. `git diff -- packages/core/algorithms | sha256sum` is `5c39437514f6a10c6123ca2108535ffea9c45c8310abb8830ab5e7225fd50117` before the revert and after the restore.
  implication: this change is what makes the test pass, and the test kills the one mutant that matters (the full-map copy back at the fix site). Stryker is not installed in this repo, so no automated mutation run exists; this manual mutant stands in for it.

## Eliminated

- hypothesis: EPA's pass evicts schedule-structure cells from the 128-cell LRU, so SPR's pass (or EPA's own later events) regenerates them
  evidence: run 1 timed `SHARED_STRUCTURE_CACHE.get` per event. SPR's 1,000 calls per event cost 5 to 16 ms in total at all six events (pure hits). Within EPA's pass, 2026txwac (same shape as 2026arli, priced after it) cost 6 ms. A season reaches about 72 distinct cells, under the cap, and the cells a season just used are the most recent ones.
  timestamp: 2026-10-04 21:18

- hypothesis: early-season pre-event states make `predictCore` itself more expensive (a different code path before the week 1 seal)
  evidence: run 2's profile puts `predictCore` at 6.2 s inclusive across all six events, against 40.2 s in `materializePendingTeams`. The slow events' extra time is not in `predictCore`.
  timestamp: 2026-10-04 21:19

- hypothesis: EPA's ranking-point math (sigmoid slots and `bonusMarginalRpPmf`) is itself slower than SPR's lattice pmf
  evidence: run 2's profile: `bonusMarginalRpPmf` 0.37 s self and `allianceBonus` 0.81 s self for EPA, against 8.0 s inclusive in SPR's `analyticRpPmf`. At the two late events EPA and SPR cost the same once structure generation is set aside (2026arc 5.4 s and 5.4 s).
  timestamp: 2026-10-04 21:19

## Resolution

- root_cause: `epa.predict` copied the state's whole `teamComponents` map (`materializePendingTeams`) on every call whose match named a carry-pending team. A presim sidecar calls `predict` 50,000 to 132,000 times per event against one frozen state, so early-season events paid an O(all teams) copy per call. A second, independent share of the EPA against SPR timer gap is attribution: EPA runs first and its `sidecars` timer carries the season's schedule-structure generation, which SPR then reads warm.
- fix: `predict` builds a map scoped to the match's own teams (973e06e5). `update` keeps the full-map materializer. A comment at the `sidecars` timer in `packages/harness/publish.ts` records that the per-algorithm figure is not like for like.
- verification: full 2026 probe (seasons 2025,2026, presim from 2026, opr/epa/spr, pinned generation and computedAt) on the old code and on the fixed code: 418 sidecar bodies each, `diff -rq` reports 0 differing files. EPA sidecars 2895.4 s before, 1186.8 s after; SPR 537.1 s and 633.2 s. The two runs overlapped each other and a full vitest run on the same machine, so the seconds are indicative, not a clean benchmark. Root vitest: 7236 passed, 1 skipped. The planned separate revert-and-reconfirm step was not run; the old-code run serves as the before arm. The all-seasons 7.85 h run was not repeated.
- files_changed: packages/core/algorithms/epa.ts, packages/core/algorithms/epaCarryScale.ts, packages/core/algorithms/epa.test.ts, packages/core/algorithms/epaCarryScale.test.ts, packages/harness/publish.ts (comment only)
