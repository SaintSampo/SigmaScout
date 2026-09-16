---
quick_id: 260915-qgf
status: complete
date: 2026-09-15
commits: [ea5b38e3, 4e7e1f1a, 7385bad6]
probe_version: 51127dd1
serves_todo: rp-fold-exceeds-worker-cpu-budget
---

# 260915-qgf: Re-mirror the probe and re-measure cold CPU (step 4 of 4)

## Outcome

**Browser pricing fixed the term it targeted, and the first-ever Phase B measurement shows the tick
is further over budget than when the todo opened.** The pre-season gate stays closed (Jacob,
2026-09-15).

## What was built

- **`apps/worker/src/artifactMerge.ts`** — Phase B's merge path extracted from `scheduled.ts`, which
  re-exports it, so no existing test import changed. The probe imports the same module, so it
  measures the tick's real code rather than a copy. Proven behavior-free: the moved region diffs
  against `HEAD~1` with zero statement-level changes (only added `export`s and three parameter types
  widened to what the functions read).
- **Probe Phase A re-mirrored** to `processEvent` at HEAD: no upcoming pricing, the shared played-row
  builders, the Phase A bonus-flag capture, the block splice. `upcoming=` now sizes a schedule-only
  row build (`upcomingScheduled`).
- **A `phaseB=1` arm** that fetches a real published artifact over public HTTPS (GET-only, `https:`
  asserted, no body; the probe still has only the D1 binding), then runs the tick's own parse →
  merge → splice → stringify for the event and for N team artifacts, and discards the result.
- **Retired but recognized:** `rpSkip=upcomingPmf` changes no counter and emits one NOT APPLICABLE
  warning, rather than being read as a typo — an unknown token would silently discard the valid
  names beside it.
- **Measurement rig** with the fresh/reused isolate split and low-n guards.

## The measurement

Probe `51127dd1` (from `7385bad6`) against live D1; live Worker `43ed9472` (from `61f79e0a`). 9 arms,
30 s spacing, 13 measured rounds each, 126 requests, zero non-ok outcomes, all invariants PASS.

**The roster had to be pinned** (`measure/arms.mjs` `WARM_ROSTER`, chosen by the orchestrator):
discovery orders by scope key and picks up teams with no RP or Sigma beliefs plus the demo
pseudo-team, which suppressed every pmf (`rpPmfsProduced: 0`, so the RP arms would have measured
nothing) and 404'd the Phase B team fetch. With the pinned 21: resumed 21, bands 4, pmfs 2.

### Phase A, reused-isolate stratum

| Arm | 2026-09-14 | 2026-09-15 |
|---|---|---|
| all RP on | 16.2 ms mean, p50 14 | **9.6 ms mean, p50 8, 17% over 10 ms** |
| RP off | 6.7 ms mean | 6.8 ms mean |
| RP total | **9.5 ± 2.1 ms, resolved** | **2.8 ± 1.8 ms, unresolved** |
| upcoming-loop RP | 7.2 ± 2.1 ms | retired: the loop no longer exists |
| formula | 6.0 ± 2.5 ms | 2.1 ± 1.8 ms, unresolved |

### Phase B, first measurement

| Difference | Reused mean | Resolved? |
|---|---|---|
| phaseB (`allPhaseB − all`) | **+64.0 ± 9.3 ms** | yes |
| phaseBNoRp (`nonePhaseB − none`) | **+52.3 ± 7.5 ms** | yes |

`allPhaseB` absolute: 73.6 ms mean, p50 63, **100% over 10 ms**. Per request it parsed a 106,024 B
event artifact and a 32,386 B team artifact, spliced a 22-row state block, merged 97 played + 60
upcoming + 2 folded, stringified 145,958 B, then parsed/merged/stringified 12 team artifacts
(403,240 B). The cost is JSON and zod work on whole artifacts; R2's round trips are I/O and never
entered `cpuTime`.

## Not comparable to 2026-09-14

Absolute Phase A counters (`rpPmfsProduced` 34 → 2, `bandsProduced` 124 → 4) and the `formula`
magnitude, because the tick shape changed. The query string, the arm-difference method and the
reused-isolate stratification are comparable. Fresh-isolate strata have n of 0–4 here and cannot
support a per-component number (2026-09-14 measured ~18 ms fresh with RP off).

## Phase B emulation is a floor

- The state block is synthesized (out of season no published event carries one) and sized by
  `teamCount=21`, where a regional carries ~42 rows.
- The 12 team parses re-parse one team's bytes, not 12 different artifacts.
- The splice's admitted set is the probe's synthetic touched teams.
- Still excludes the TBA poll, the KV read, the global rebuild, a second concurrent event, and the
  real Phase B's R2 round trips.

## Verification

- Suite: 247 files, 5,461 passed, 1 skipped (baseline 5,431), re-run by the orchestrator. Root, web
  and worker typechecks clean.
- 4 executor mutations, each caught; two were caught by behavioral counters rather than the guards
  the plan predicted, which is recorded rather than papered over.
- Probe deploy output listed only the D1 binding.

## Decisions (Jacob, 2026-09-15)

- **The pre-season gate stays closed.** The gate note in `docs/worker-operations.md` now carries
  these numbers.
- **Next: attack the merge cost** — stop re-validating artifacts the Worker itself wrote, and stop
  rewriting whole team-season artifacts to append one row. Re-measure with the `phaseB=1` arm after
  each change.

## Left deployed

`sigmascout-state-probe` at `51127dd1`, D1 binding only, no cron.
