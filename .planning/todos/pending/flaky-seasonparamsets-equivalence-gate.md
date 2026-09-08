---
id: flaky-seasonparamsets-equivalence-gate
created: 2026-09-07
source: observed during quick task 260907-203 follow-up (Compare floor move)
resolves_phase:
priority: medium
---

# Intermittent failure: seasonParamSets D-4 equivalence gate, Leg B

`packages/harness/seasonParamSets.test.ts` fails **intermittently** in full repo-root runs:

```
FAIL |node| packages/harness/seasonParamSets.test.ts
  > D-4 equivalence gate, Leg B (evidence, not the bar): the season-boundary differential
  > replaying 2022 then 2023 (first 2 events each) through a plain makeSigma1 module
    and through the facade over a uniform map produces byte-identical prediction streams
```

## What was actually observed, 2026-09-07

| run | result |
|---|---|
| `npx vitest run` (full, repo root) | **FAILED** |
| `npx vitest run` (full, repo root) x3 more | passed |
| `npx vitest run packages/harness/seasonParamSets.test.ts` x3 | passed |

So: **1 failure in 4 full runs, 0 failures in 3 isolated runs.** The assertion text beyond the
test name was not captured — the three attempts to reproduce it for detail all passed. That is
the main gap; the next person to see it should grab the full failure output immediately.

## Why this is worth chasing rather than retrying

The assertion is a **byte-identical prediction-stream comparison**. A deterministic replay
producing different bytes intermittently is either:

1. a genuine nondeterminism in the replay path (shared mutable state between the plain module
   and the facade, or iteration-order dependence), which would be a real correctness bug and
   would also undermine every promoted version's `predictionStreamSha256` digest; or
2. a resource/timeout artifact under full-suite parallelism — this test opens the ~700 MB
   corpus while ~200 other files run, and a timeout can surface as a failed assertion rather
   than a clean timeout message.

(2) is more likely given it passes in isolation, but (1) has consequences serious enough that
"it passed on retry" is not an acceptable resolution. Note this project has already been bitten
by a green suite hiding a real divergence (see the Worker typecheck "cosmetic" drift that turned
out to be a live/offline DQ divergence).

## Relevant recent change

`seasonParamSets.test.ts` was edited on 2026-09-07 by the `rolling-2026-09e` re-pin: its
uniform-map season list widened 7 -> 10 entries. The failing leg replays only 2022 and 2023
(first 2 events each), so the widening should not touch it directly — but the file as a whole
got heavier, which is consistent with hypothesis (2).

## First steps

1. Run the full suite in a loop until it fails, capturing complete output (`npx vitest run
   2>&1 | tee`), to get the actual diff or timeout message. Do NOT use `timeout N pnpm ...` —
   it swallows output and exits 0.
2. If it is a real byte difference, diff the two streams and find the first differing record.
3. If it is a timeout, raise this test's own timeout or mark the file to run serially rather
   than widening a global timeout.
