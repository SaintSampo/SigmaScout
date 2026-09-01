# Deferred items — quick task 260901-is2

Out-of-scope discoveries found during execution. Logged, not fixed (scope boundary:
only issues directly caused by this task's changes are auto-fixed).

## 1. `payloadBudget.test.ts` — 2 pre-existing failures (NOT caused by this task)

Discovered while running the full non-web suite as a Task 1 commit-boundary gate.
Present at HEAD before any change in this task, and unrelated to scoring or to any
algorithm's output.

```
packages/harness/payloadBudget.test.ts
  > is internally consistent: medianBytes <= p95Bytes <= maxBytes <= budgetMaxBytes
      teams: maxBytes (3704776) should be <= budgetMaxBytes (3500000)
  > team page (the 292-match outlier) stays under its absolute upper bound
      team page maxBytes (675956) exceeded the absolute ceiling (600000)
```

**Why it is definitely pre-existing, not collateral.** That suite's only input is the
committed machine-readable `json budget` block in `docs/publish-budget.md` (its own
header says so). Both failing assertions compare two numbers parsed straight out of
that committed doc — no code from this task participates. `docs/publish-budget.md` is
unmodified in the working tree. Verified by re-parsing the committed block directly:

| page    | maxBytes  | budgetMaxBytes | state     |
| ------- | --------- | -------------- | --------- |
| teams   | 3,704,776 | 3,500,000      | VIOLATION |
| team    | 675,956   | 375,000        | VIOLATION |
| events  | 84,113    | 108,000        | ok        |
| event   | 342,405   | 350,000        | ok        |
| compare | 14,144    | 20,000         | ok        |

**Impact on this task's plan.** Task 6's `<done>` requires a fully green
`pnpm vitest run`. That is not currently achievable without either shrinking the
teams/team artifacts or deliberately re-measuring and raising the budget — both real
work with a real blast radius, and neither in this task's scope. Task 6 should either
carve these two out explicitly or file them as their own todo.

**What "done" looks like:** either the published teams/team artifacts shrink back under
the committed budget, or the budget is re-measured and raised deliberately (the test's
own failure message names that second option).

## 2. Plan arithmetic correction — Task 1's predicted denominator

Not a defect, recorded so the SUMMARY does not repeat the plan's error. The plan
predicted the post-D-Q3 winner-accuracy denominator would be 262 (`265 sliceMatchCount
- 3 ties`). The real answer is **261**: `aggregateScores` also excludes
surrogate-affected predictions, and this slice carries exactly 1, so the scored
population is 264, not 265. Numerators (181, 178) were exactly as predicted, and both
`predictionStreamSha256` values reproduced byte-for-byte. Verified independently
against `packages/harness/fixtures/digest-slice.json`.
