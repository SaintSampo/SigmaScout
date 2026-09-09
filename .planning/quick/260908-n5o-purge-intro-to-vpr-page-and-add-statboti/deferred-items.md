# Deferred items — quick task 260908-n5o

Out-of-scope discoveries found during execution, not fixed (scope boundary: only
auto-fix issues directly caused by this task's own changes).

## Pre-existing root typecheck error in `packages/harness/tune.test.ts`

`npx tsc --noEmit` from the repo root fails with:

```
packages/harness/tune.test.ts(1069,15): error TS2304: Cannot find name 'Sigma1Params'.
```

`Sigma1Params` is used as a type annotation at line 1069 but is never imported in this
file (only mentioned in a comment at line 923). Confirmed pre-existing and unrelated to
this task: `git status --short packages/harness/tune.test.ts` shows the file untouched
by this task or by the other concurrent session (260908-5wd), and `git log -1` for the
file points at commit `f700ad2d` ("fix(260907-v1s): hold non-searched params at the
INCUMBENT, not at defaults"), which landed before this task started.

`npx vitest run` does not surface this — Vitest's transform does not perform full type
checking, so the test file's runtime behavior is unaffected. This is a type-only gap.

Not fixed here: out of scope for a VPR-purge / EPA-comparison-page task. Flagged for a
separate quick task to add the missing `import type { Sigma1Params } from ...` (or
confirm the intended import path) in `packages/harness/tune.test.ts`.
