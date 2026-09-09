# Deferred items — out of scope for 260909-03b

## 1. `packages/harness/seasonParamSets.test.ts` times out under parallel load

- **Test:** "D-4 equivalence gate, Leg B … replaying 2022 then 2023 (first 2
  events each) through a plain makeSigma1 module and through the facade over a
  uniform map produces byte-identical prediction streams"
- **Symptom:** `Test timed out in 5000ms` — measured at 5060ms, i.e. it fails by
  ~60ms against vitest's 5s default.
- **Passes in isolation:** yes (`npx vitest run packages/harness/seasonParamSets.test.ts`
  → 11 passed, 3.54s). Only fails when the full `packages/bpr packages/core
  packages/harness` selection runs concurrently.
- **Pre-existing:** yes. `git status --porcelain` on the path is empty, so the
  file is byte-identical to HEAD and untouched by this task. This task's changes
  are confined to `packages/bpr/*`, one type-only import in
  `packages/harness/tune.test.ts`, and the task's own evidence directory —
  none of which are reachable from a Sigma1 facade equivalence test.
- **Why not fixed here:** out of scope. It is a timing flake in an unrelated
  package, not a regression from the measurement-path work.
- **Suggested fix when someone picks it up:** give the case an explicit timeout
  (the same treatment `packages/bpr/evaluate.test.ts` needed in this task — its
  corpus-reading cases were reloading 152k matches per test and were moved to a
  single `beforeAll` with a 120s budget). A byte-identity replay over two seasons
  is legitimately slow and should not be held to the 5s default.

**Not a correctness finding.** The equivalence assertion itself passes whenever
it is given time to run.
