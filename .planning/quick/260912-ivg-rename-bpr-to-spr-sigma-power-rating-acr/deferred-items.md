# Deferred items — 260912-ivg

## Pre-existing, unrelated `apps/worker` typecheck failure

`npx tsc --noEmit -p apps/worker/tsconfig.json` reports one error, unchanged before and
after every task in this plan:

```
packages/corpus/db.ts(28,35): error TS2345: Argument of type 'URL' is not assignable to
parameter of type 'string | URL'.
  Type 'URL' is not assignable to type 'import("url").URL'.
    The types returned by 'searchParams.entries()' are incompatible between these types.
      Property '[Symbol.dispose]' is missing in type 'IterableIterator<[key: string, value: string]>'
      but required in type 'URLSearchParamsIterator<[string, string]>'.
```

**Root cause (traced, not assumed):** `apps/worker/tsconfig.json` sets
`"types": ["@cloudflare/workers-types", "node"]`. `@cloudflare/workers-types` declares its
own global `URL` type, which conflicts with `@types/node`'s `url` module's `URL` type the
moment both are loaded into the same compilation unit. `packages/corpus/db.ts`'s
`fileURLToPath(new URL("./schema.sql", import.meta.url))` (line 28) is the first line in
the worker's compile graph that actually triggers the mismatch.

**Confirmed pre-existing, not caused by this plan:**
- `packages/corpus/db.ts` was never touched by any task in this plan (verified: `git diff
  --name-only` across all four commits never lists it).
- The root `npx tsc --noEmit` (which also compiles `packages/corpus/**`, just without
  `@cloudflare/workers-types` loaded) is clean — confirming the conflict is specific to the
  worker tsconfig's `types` combination, not to `corpus/db.ts`'s own code.
- `packages/corpus/db.ts` reaches the worker's compile graph via a pre-existing chain
  untouched by this plan: `apps/worker/test/scheduled.replay.test.ts` and
  `scheduled.rp.test.ts` import `SigmaScoutLayer` from `packages/harness/sigmaScoutLayer.ts`,
  which has a pre-existing `import type { PredictionRecord } from "./replay.js"`, and
  `replay.ts` imports `openCorpus`/`openCorpusReadOnly` from `corpus/db.ts`. None of
  `sigmaScoutLayer.ts`, `replay.ts`, or the two worker test files were edited by this plan.

**Disposition:** out of scope per the Scope Boundary deviation rule — fixing it would
require either changing `apps/worker/tsconfig.json`'s `types` array or restructuring
`corpus/db.ts`'s `URL` usage, neither of which this identifier-rename plan touches or
should touch. Not fixed. Recorded here rather than silently dismissed, per CLAUDE.md's
"triage type errors, don't batch-dismiss" convention — this one WAS triaged, traced to its
exact cause, and found genuinely unrelated.

**Practical effect on this plan's own verification:** Task 1, Task 2, and Task 5's `<verify>`
blocks each chain `npx tsc --noEmit -p apps/worker/tsconfig.json` with `&&`, so a literal
run of those exact chains reports non-zero on this pre-existing error alone, with zero
errors attributable to this plan's own changes. Every task's SUMMARY records this
explicitly rather than letting a chained exit code imply otherwise.
