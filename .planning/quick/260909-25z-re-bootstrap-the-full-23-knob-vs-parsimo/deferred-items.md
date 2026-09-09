# Deferred items — 260909-25z

## packages/harness/browserSafeSchemas.test.ts is RED, and it is not this task's

- **Failure:** `ENOENT ... packages/core/algorithms/sigma1/rp/constants.ts`, raised by
  `extractImportSpecifiers` at `browserSafeSchemas.test.ts:84`.
- **Cause:** a CONCURRENT SESSION in this same checkout has an in-flight
  `git mv` refactor moving `packages/core/algorithms/sigma1/rp/*` to
  `packages/core/rankingPoints/*`. `git status` shows staged renames for the
  season files plus modified `sigma1/index.ts`, `rp/state.ts`,
  `rankSimulation.ts`, `algorithms/types.ts` and a dozen `apps/web` files. The
  test walks import specifiers and follows a path the refactor has already moved.
- **Not mine.** This task's only code changes are three `export` keywords in
  `packages/bpr/holdout.ts` and new assertions in `packages/bpr/holdout.test.ts`.
  Neither touches `packages/core` or any ranking-point path.
- **Action: none.** Out of scope per the executor's scope boundary. It will
  resolve when the other session finishes its rename. Do not "fix" it from here —
  editing files that session has staged would absorb or clobber its work.
- `npx vitest run packages/bpr` passes 39/39, which is the suite this task's
  changes are in.
