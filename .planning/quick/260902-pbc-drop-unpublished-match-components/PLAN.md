---
quick_id: 260902-pbc
slug: drop-unpublished-match-components
date: 2026-09-02
type: execute
mode: quick
worktree: false
autonomous: false
source: payload-budget attribution, 2026-09-02 (see .planning/todos/pending/payload-budget-teams-and-team-page-overage.md)
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/publish.ts
  - apps/worker/src/scheduled.ts
---

# Stop publishing per-match alliance components that nothing reads

## The finding

`redComponents` / `blueComponents` are published on every match of both the
**team** and **event** page artifacts. **No page reads them.** A repo-wide grep
over `apps/web/src` finds zero references outside test files — no route, no
component, no hook.

Measured against the live artifacts:

| artifact | total | components | share | after dropping |
|---|---|---|---|---|
| team (`frc3538/2024`, the 292-match outlier) | 675,956 B | 297,113 B | 44.0% | **378,843 B** |
| event (`2026iscmp`) | 150,656 B | 71,769 B | **47.6%** | ~78,900 B |

The team page is currently **over** its 375,000-byte budget by 300,956 B and over
the 600,000 absolute ceiling by 75,956 B. Dropping this one unused field puts it
under the absolute ceiling with 221k of room and within 3,843 B (1%) of the
budget itself — no ceiling needs to move.

The event artifact is not over budget, but it is the one the Worker **rewrites
every minute during a live event**, so nearly halving it cuts both download
weight on the freshest page and sustained R2 write volume.

## What this is NOT

- **Not a redundancy fix.** The values are real and differentiated — measured
  across 468 alliance-component blocks on three teams and two seasons: 93.8%
  fully distinct, 0% identical. The case for dropping them is that **nothing
  consumes them**, never that they repeat.
- **Not a precision fix.** D-06's rounding is correctly applied (max 2 dp on
  metric values/spreads). Do not touch precision anywhere in this task.
- **Not a model change.** The per-component predictions stay in the algorithms
  and in the prediction type (`packages/core/algorithms/types.ts`,
  `sigma1/index.ts`, `epa.ts`). Only the **published page artifact** stops
  carrying them. Removing them from the model would change predictions; removing
  them from the artifact cannot.

## Scope

1. **`packages/harness/pageArtifacts.ts`** — remove `redComponents`/`blueComponents`
   from the team-artifact match schema and the event-artifact match schema.
   Bump `PAGE_ARTIFACT_SCHEMA_VERSION` if the codebase's own convention requires
   it for a field removal — **check how prior field changes were handled and
   follow that precedent rather than inventing one.** A published-shape change
   that readers must tolerate is exactly what that version exists for.
2. **`packages/harness/publish.ts`** — stop emitting the two fields.
3. **`apps/worker/src/scheduled.ts`** — the Worker writes event artifacts on the
   live path and references these fields; stop emitting them there too. The
   Worker and the offline publisher must produce **byte-identical** shapes — there
   is an existing offline/online equivalence rig (04-07) that will catch drift,
   so run it or its tests.
4. Update every test that asserts the fields' presence.

## Client

Confirm the client genuinely does not read them before removing (re-run the grep
yourself; do not take this plan's word for it). If the Zod schema in
`apps/web` mirrors the artifact shape, the field's removal must not make the
client's parse fail — check whether the web-side schema is `strictObject`
(which would reject *extra* keys, not missing ones) and whether the fields are
declared required there.

**Backwards compatibility matters here:** the site currently serves artifacts
that still HAVE these fields, and will keep serving them until the republish
lands. A client that requires the field absent, or a schema that rejects it,
would break the live site the moment it deploys ahead of the republish. The
safe shape is: client tolerates both.

## Verification

1. `npx vitest run` at the repo root — the FULL suite (163 files), not just
   `apps/web`. This task touches `packages/harness` and `apps/worker`, which
   `cd apps/web && npx vitest run` does not cover. That gap is exactly why the
   payload-budget failures went unnoticed for a week.
   Never `timeout <n> pnpm ...` (swallows output, exits 0 — project memory).
2. `npx tsc --noEmit` in each touched package.
3. Re-publish is NOT part of this task. Do not run `pnpm publish:seasons`.
   `payloadBudget.test.ts` reads `docs/publish-budget.md`, whose numbers come
   from a real publish run — so **those two tests will still fail after this
   task**, and that is expected. Do not edit `docs/publish-budget.md` to make
   them pass; the republish (a later task) re-measures it.
4. Prove the saving on real data rather than asserting it: take a live artifact,
   strip the fields, and record before/after bytes in the summary.

## Commit

One commit.
