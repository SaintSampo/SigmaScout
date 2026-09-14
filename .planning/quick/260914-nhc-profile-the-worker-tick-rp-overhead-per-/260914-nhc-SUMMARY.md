---
quick_id: 260914-nhc
status: complete
date: 2026-09-14
commits: [3ac5c790, 42b23657, 67f0b739, b1e4951d, d457c5f3]
probe_versions: [36d5fb70, 28051f5c]
---

# 260914-nhc: Profile the Worker tick's RP overhead per component

## Outcome

**Pacing dominates `cpuTime`.** With the isolate kept warm (200 ms spacing), the whole Phase A tick is
5 ms p50 with every RP piece on. At a cron-like 30 s spacing it is 15–23 ms p50 and over 10 ms on
92–100% of requests. On reused isolates, where RP decides whether the tick is over budget, RP costs
9.5 ± 2.1 ms. Of that:

- upcoming-loop RP is 7.2 ± 2.1 ms;
- the `analyticRpPmf` formula is 6.0 ± 2.5 ms, about 175 µs per call against 7.5 µs warm in Node;
- the wrapper, resume and beliefs are below resolution.

A current-engine Node benchmark shows the first 34 calls cost 2.5–3 ms under every JIT flag set. The
cold cost is first-call work, not arithmetic. Fresh isolates (about 15–19% of requests) are about
18 ms even with RP off. The full record is in `todos/pending/rp-fold-exceeds-worker-cpu-budget.md`,
"COMPONENT PROFILE".

## Commits

- The executor's three commits:
  - `3ac5c790`: re-mirror the probe's Phase A to the post-teardown tick, with a call-name mirror guard
    (Group 7).
  - `42b23657`: `rpSkip` per-component arms, nine arms with counters pinned by equality (Group 8), and
    the runbook row.
  - `67f0b739`: measurement driver and analyzer scripts in `measure/`.
- Two orchestrator commits made during measurement:
  - `algorithms=` param. Live D1's opr/epa league rows are still shape 15, so every probe response
    was a 500 and the driver's warm-up gate refused to run. `algorithms=spr` is also tick-shaped.
    There is a test for it, mutation-checked.
  - A per-isolate request counter logged to `wrangler tail`, used to split fresh from reused isolates.

## Verification

- `npx vitest run apps/worker/test/stateProbe.test.ts`: 55 passed.
- `npx tsc --noEmit -p apps/worker/tsconfig.json` and root `npx tsc --noEmit`: clean.
- `analyze-arms.mjs --self-test`: passed.
- Three live passes against deployed probes, zero non-ok outcomes:
  - warm, 9 arms × 60, on `36d5fb70`;
  - cold, 2 arms × about 19, on `36d5fb70`;
  - cold, 9 arms × 12 (13 with warm-up), on `28051f5c`.
- Invariants: `bandsProduced` was 124 in every arm, and gate additivity passed. The one failure,
  `rpPmfsProduced` in skipObserve, is the known observe/formula confound.

## Deviations

- The probe was measured with `algorithms=spr` rather than all three algorithms (see above).
- A per-isolate counter and a cold-cadence pass were added beyond the plan, after the warm pass
  disagreed with 2026-09-12 by 2.6x. The warm pass alone would have recorded the wrong dominant cost.
- Horizon repricing was recorded in the todo as rejected by Jacob (2026-09-14).

## Side findings

- Live D1 opr/epa league rows are shape 15 while spr is 16. This is harmless while the live tier is
  spr-only, and would fail loudly if `LIVE_ALGORITHM_IDS` ever adds them.
- `rpPmfsProduced` is 34 of 62 at `teamCount=21`, down from 43 on 2026-09-12. The probe still
  under-prices a fully warm roster.

## Left running

The probe `sigmascout-state-probe` is left deployed at `28051f5c`: D1 binding only, no cron. Raw tail
and driver files stay in the session scratchpad and are not committed, because they carry the client
IP.
