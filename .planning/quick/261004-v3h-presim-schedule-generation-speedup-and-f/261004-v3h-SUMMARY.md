---
quick_id: 261004-v3h
phase: quick-261004-v3h
plan: 01
subsystem: harness/presim
tags: [presim, schedule-generation, performance, byte-identity, resampling-floor]
status: complete
completed: 2026-10-04
requires: []
provides:
  - golden-digest pin of generateSchedule output (17 cells)
  - generateSchedule with flat typed-array pair counts, output unchanged, about 4.8x faster
  - structure memo cap 512 (all-seasons census reaches 171 cells)
  - Part B binding resampling floor for spr on 3 events, and a keep-1000 recommendation
affects: [packages/harness/generatedSchedules.ts, packages/harness/generatedSchedules.test.ts, packages/harness/preSchedule.ts]
key-files:
  modified:
    - packages/harness/generatedSchedules.ts
    - packages/harness/generatedSchedules.test.ts
    - packages/harness/preSchedule.ts
  created:
    - .planning/quick/261004-v3h-presim-schedule-generation-speedup-and-f/261004-v3h-results.json
    - .planning/quick/261004-v3h-presim-schedule-generation-speedup-and-f/261004-v3h-FINDINGS.md
decisions:
  - Generator rewrite kept: zero differing bytes at every level (rule A1 met)
  - No on-disk structure cache, no worker threads: generation is 5.8% of 2026 sidecar seconds after the rewrite (rule A3, bar 10%)
  - Cap raised 128 to 512: census reached 171 distinct cells (rule A4)
  - Schedule count stays 1000: pooled floor at 1000 misses G2 (2.11 vs 2.0); only 2000 passes all gates; decision is Jacob's
metrics:
  tasks: 3
  commits: 5
---

# Quick 261004-v3h: presim generation speedup and the fewer-schedules floor

**One-liner:** Typed-array pair counts make presim structure generation 4.8x faster with every one of 418 sidecars byte-identical, and the Part B floor says the bake should stay at 1,000 schedules.

## What was done
- Task 1 (tracer): golden digests committed on the untouched generator (7ac8dc25), `generateSchedule` hot loop rewritten (93d400fd), 12-sidecar sample byte-identical.
- Task 2: injection validated, full 2026 set byte-identical (418 of 418), 171,000 plus 5,250 structures compared with 0 mismatches, census 171 cells so cap 128 to 512 (1e112145), results JSON partA (5c78b3a1).
- Task 3: Part B driver run on 2026txmca, 2026casnd, 2026joh at 10 pairs, FINDINGS.md and partB (f62462e3).

## Key numbers
- Sweep old/new: census 1,117.3 s to 231.5 s; 2026 cells 403.8 s to 86.9 s.
- Full run EPA sidecars 1,189.5 s to 853.6 s; SPR control 591.5 s to 635.4 s (contended).
- Rule A3 share 5.8%: no disk cache.
- Census: 171 cells, 74.43 MB encoded, 16 repeat misses at 128, 0 at 512.
- Part B: n=1000 pooled G1 96.6%, G2 2.11 (fail), G3 97.4/96.8; n=2000 passes all; recommendation keep 1000.

## Deviations from Plan
None. Plan executed as written (rewrite kept after identity held, cap raised under rule A4).

## Not measured
EPA floor, per-side structure variation, events above 76 teams, realised rankings, district bake, timed all-seasons sidecar run.

## Self-Check: PASSED
Commits 7ac8dc25, 93d400fd, 1e112145, 5c78b3a1, f62462e3 verified present by the orchestrator, each touching only planned files; PRESIM constants still 1000 and 50; `--presim-from-season` still 2026. Byte-identity and vitest figures are the executor's report (418 of 418 identical, 7,431 tests passed, 1 skipped) and were not rerun by the orchestrator.
