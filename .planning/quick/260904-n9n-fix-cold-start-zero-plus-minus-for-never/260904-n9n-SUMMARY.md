---
quick_id: 260904-n9n
description: Fix the cold-start 0 ± 0 defect for never-seen teams (todo sigma1-cold-start-zero-plus-minus)
completed: 2026-09-04
status: complete
---

# Summary — quick task 260904-n9n

## Verdict: the defect does not exist; the missing piece was the test that keeps it that way

The todo's required first step was to LOCATE the layer that turns a never-seen team's
absence into a published `0 ± 0` — publish, artifact schema, or client — rather than
assume it. The investigation traced every layer and found **no such site**: absence
propagates end to end, and the todo's preferred option (b) — an explicit "no data"
representation, never a numeric zero — is already in force at every layer. The full
evidence table (file:line per layer) is in this task's PLAN.md.

Key findings, per the todo's own "done" list:

1. **Defaulting site located and named:** there is none. All three algorithms omit
   never-seen teams from `teamMetrics`; publish and the Worker default to `metrics: {}`;
   the client renders a blank cell and sorts missing values last.
2. **Representation:** option (b) is in force, decided piecewise by the 2026-09-01
   blank-cell user request (`MetricValue.tsx`), quick task 260904-586's "never counted
   as a zero" percentile-pool exclusion, and rowModel's missing-sorts-last contract.
   `MetricValue.test.tsx` even pins the exact distinction the todo demanded: a real zero
   renders `0.00`, no-data renders blank.
3. **The choice is written down** — in the todo's closure note, this summary, and the
   PLAN.md evidence table.
4. **The new tests:** the one unpinned link was the omission contract itself — nothing
   asserted that `teamMetrics` for an absent team returns an ABSENT entry rather than
   zeros. Added one test to each of `sigma1.test.ts`, `epa.test.ts`, `opr.test.ts`
   (played team present, never-seen team absent). If a future refactor turns `continue`
   into a zero-fill, these fail while every downstream layer would have stayed green.
5. **epa and opr checked:** same skip pattern as Sigma1 (`epa.ts:797`, `opr.ts:467-469`);
   they do not share the hypothesized defect.
6. **Sort order:** a no-data team ranks last with a deterministic team-number tie-break
   (`rowModel.ts`), and a zero-match win rate is `null`, "never a coerced zero" — all
   already pinned by `rowModel.test.ts`.

Also noted (out of scope, already decided elsewhere): a team IN state via season carry
but with no folded matches publishes a bare value with NO spread — the deliberate D-Y1
contract, pinned with rationale at `sigma1.test.ts`'s swing tests.

## Changes

- `packages/core/algorithms/sigma1/sigma1.test.ts` — omission test in the D-27 contract describe
- `packages/core/algorithms/epa.test.ts` — omission test in the teamMetrics describe
- `packages/core/algorithms/opr.test.ts` — omission test in the teamMetrics describe
- No production code changed.

## Verification

The three suites: 135 tests, all green (includes the 3 new tests).
