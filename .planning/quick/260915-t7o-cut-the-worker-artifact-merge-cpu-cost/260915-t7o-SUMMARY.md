---
quick_id: 260915-t7o
status: complete
date: 2026-09-16
commits: [0890ac61, eb0f6b0d, 2c1423b5, 35983549]
worker_version: 89fbe44f
probe_version: 7ed31f95
serves_todo: rp-fold-exceeds-worker-cpu-budget
remeasurement: DONE 2026-09-17 (phaseB 64.0 -> 11.8 ms)
---

# 260915-t7o: Cut the Worker artifact-merge CPU cost

## Outcome

Phase B's 64 ms lump is split into attributable components, and one of the two pre-registered fixes
cleared its bar and shipped: **the tick's two read-side zod parses are now O(1) structural guards.**
Validation was the largest component of Phase B, and the Worker already validates every artifact on
the write side, so the read-side parse was a second validation of bytes it had just validated.

**The before/after re-measurement is blocked until 00:00 UTC** — the measurement campaign exhausted
D1's free-tier daily row-read cap. See "The D1 cap" below.

## The measured split (warm pass, 200 ms spacing, 40 rounds, `ok` samples only)

Whole Phase B ≈ 23 ms warm.

| Component | Mean | Share |
|---|---|---|
| **Team half (12 artifacts)** | ~18.5 ms | ~80% |
| — team zod validation | **~14.6 ms** | **largest single component** |
| — team merge | ~6.6 ms | |
| — team stringify | ~5.2 ms | |
| **Event half (1 × ~106 KB)** | ~7.2 ms | ~31% |
| — event zod validation | ~5.1 ms | |
| — event merge (splice included) | ~3.5 ms | |
| — event stringify | ~3.7 ms | |

Against the bars registered before the run:

| Quantity | Measured | Bar | Verdict |
|---|---|---|---|
| F2: event + team validation | **19.5 ± 2.6 ms, resolved** | ≥ 8 ms resolved | **BUILT** |
| F1: upcoming-union reorder | **−0.3 ± 2.6 ms, unresolved** | ≥ 3 ms resolved | **NOT BUILT** — recorded as a measured negative; no line of `pageArtifacts.ts` changed |

**The cold 30 s pass at n=12 resolved nothing** — several skip arms came out more expensive than the
full arm and both thresholds landed at ±14 ms. The warm pass decided it. Component ordering is
consistent across both (team half dominant in each), but warm understates absolute cost.

**Observed directly in the warm pass: 28 of 40 requests per Phase B arm returned `exceededCpu`** —
the platform terminating the isolate for sustained over-budget work. The analyzer drops non-ok
samples, so every mean above is biased toward the cheaper tail.

## What F2 changed

`readExistingEvent`/`readExistingTeam` now call `apps/worker/src/artifactShapeCheck.ts` instead of
the full schema parse. The guard checks only what the merges dereference: object-ness, the schema
version, that `matches`/`upcoming`/`teams` are arrays, that `state.rows` is an array of objects, and
on the team side that `seasonStats.record` is an object and every event entry's `matches` is an array.
Rows are never walked — that is the point.

It no longer catches per-row malformation, field-level malformation outside those keys, or unknown
top-level keys. That is recovered in three places:

1. **`writeArtifactObject`'s `schema.parse` is untouched**, and runs before every put and before the
   subrequest is consumed, so nothing malformed reaches R2 and a validation failure costs no
   subrequest.
2. **A bootstrap retry on a write-side schema failure.** `TeamSeasonArtifactSchema` has no `.catch`,
   so a corruption the guard does not see would fail the write and stop that team publishing
   permanently. The merge now re-runs with no existing artifact and publishes that instead. The retry
   is not taken if the budget was already consumed (the put itself failed), so the pinned 64
   subrequests holds.
3. **A malformed `state` block drops the block, not the artifact**, mirroring the schema's own
   `.catch(undefined)`.

Published bytes are unchanged for every valid input, pinned by a test comparing
`JSON.stringify(Schema.parse(merged))` across both read paths, key order included.

## The probe's two validate arms changed meaning

`eventValidate`/`teamValidate` still gate the read-path validation step, but since F2 that step is the
structural guard. A before/after of those arms across `eb0f6b0d` measures F2 itself, not the same work
twice. Recorded in `arms.mjs`, the runbook and the probe header.

## The D1 cap (found the hard way)

`wrangler d1 info sigmascout-state` reported **rows_read_24h = 5,538,199** against a **5,000,000/day**
free-tier cap. Every subsequent D1 read fails account-wide until 00:00 UTC — **including a live
tick's**.

Cause: the probe ran its two discovery queries on every request even when the roster and event were
pinned. Each is an `ORDER BY scope_key` scan of `algorithm_state`, about 2,100 rows read. The day's
~740 measurement requests spent ~4.7M rows on answers that were then discarded.

Fixed: the probe skips discovery when both `teams=` and `event=` are supplied (~22 rows read per
request instead of ~4,200), `discovery.queries` reports 0, two tests pin it, and a mutation confirmed
they bite. The rig now pins `event=2026alhu` alongside the roster, and the runbook carries the cap,
the symptom and the `wrangler d1 info` check.

No visitor impact: D1 is Worker-internal and no live window is open.

## Team-artifact assessment (recommendation, not built)

| Option | Verdict |
|---|---|
| (a) Append-shaped or per-event team artifacts | **Recommended, conditional on the re-measurement.** The only option that removes both the whole-season parse and the stringify. Costs request count, not freshness. |
| (b) Defer team rewrites | Rejected: a tick only runs when a match folds (~7 min), so a shorter deferral defers nothing and a longer one makes team pages lag their own event page. |
| (c) Narrow what is rewritten | Exhausted: a touched team just played, so there is no unchanged team to skip. |
| (d) Split Phase B across invocations | Fallback valve: redistributes cost rather than reducing it. |

**Honest caveat:** the case for (a) rested on the team half being ~80% of Phase B — and ~63 of those
80 points were the team zod parse F2 just deleted. The post-F2 share cannot be computed by
subtraction, so the re-measurement decides.

## Verification

- Full suite from the repo root: 248 files, 5,519 passed, 1 skipped (baseline 5,479). Worker suite
  322 tests after the discovery fix. Root, web and worker typechecks clean.
- `SUBREQUESTS_PER_LIVE_TICK` still 64; the live/offline parity tests appear in no commit and pass.
- Five executor mutations; one survived and exposed a real gap (nothing pinned the probe to the
  tick's read path), closed with three new tests. Plus one orchestrator mutation on the discovery
  skip, which failed as required.

## Deployed

- Live Worker `89fbe44f` (F2 in production).
- Probe `7ed31f95` (breakdown arms + discovery skip), D1 binding only.

## Re-measurement (M3, done 2026-09-17)

The D1 cap cleared at 00:00 UTC. Both passes ran on probe `7ed31f95`, same pinned roster and event.

**Cold pass** (30 s spacing, 4 arms, 20 rounds, reused-isolate stratum):

| Arm | mean | p50 | % over 10 ms |
|---|---|---|---|
| Phase A only | 5.7 ms | 5 | 0% |
| full tick | **17.5 ms** | 16 | **100%** |
| tick without team artifacts | 9.9 ms | 9 | 31% |

- **phaseB: 11.8 ± 1.8 ms**, down from 64.0 ± 9.3 — 5.4x cheaper.
- **teamHalf: 7.6 ± 1.8 ms, 64% of Phase B** — the whole remaining lever.
- teamValidate: 1.0 ± 2.1, unresolved (it was the largest component of all before F2).
- Fresh isolates: 40.8 ms mean, untouched and untouchable from inside the tick.

**Warm pass** (200 ms, 13 arms, 40 rounds): Phase B 6.8 ± 0.4 ms (was ~23); team half 4.4 (was
~18.5), of which merge + stringify is 2.6 and the read guard 0.4; event half 1.9 (was ~7.2).
**`exceededCpu` went from 28 of 40 per Phase B arm to zero.**

**The team-artifact caveat is resolved:** the team half still dominates after F2, so option (a)
(per-event or append-shaped team artifacts) is the only structural reduction left inside Phase B.
It is now merge + stringify of whole-season artifacts, not validation.

**The tick still does not fit** — 17.5 ms mean on 100% of reused-isolate requests against a 10 ms
budget enforced on consistency. The gate decision goes to Jacob.
