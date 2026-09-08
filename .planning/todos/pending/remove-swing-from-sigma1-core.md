---
id: remove-swing-from-sigma1-core
created: 2026-09-08
source: quick task 260908-5wd (Swing Factor moved to the browser); deferred deliberately, not dropped
resolves_phase:
priority: low
---

# Delete swing from the Sigma1 core — at the next Sigma1 params major, not before

Quick task 260908-5wd moved the site's `±` — now named **Swing Factor** — out of the model and
into the browser. `apps/web/src/lib/swingFactor.ts` computes it from whichever algorithm's
artifact is open, which is why OPR and EPA now carry one too. The core copy in
`packages/core/algorithms/sigma1/swing.ts` is therefore no longer what the site reads, and it is
scheduled to go.

It did NOT go with that task, and the reason is a hard coupling rather than a lack of appetite.

## Why it could not be done web-side

`Sigma1ParamsSchema` is a `z.strictObject`. Dropping `swingScale` and `swingHalfLifeMatches`
from it is a **params major**, and a params major drags in all of:

- a new `packages/harness/legacyParams.ts` migration for every older params version
- a `packages/harness/stateSnapshot.ts` shape bump (7 → 8), which **invalidates live worker D1
  state** — every team's carried per-match state is re-derived on the next tick
- a migration pass over every promoted set in `data/algorithm-versions/`

All of that rides a retune and a republish. None of it can ride a web-only change, and quick
task 260908-5wd was explicitly scoped to require neither.

## The mechanism that makes waiting free

The web merge fills the `total` metric's `spread` **only when the artifact did not publish
one** (`apps/web/src/components/team/SeasonHeader.tsx`'s `withBrowserSwingFactor`, the same
published-wins discipline `lib/metricGroups.ts` already uses).

So on the day a model version stops publishing `spread`, the browser value takes over by
itself — **no further web change is needed at all**. That is the whole reason this is a todo
and not a blocker: nothing is broken while it waits, and nothing needs sequencing beyond the
params major itself.

## Trigger

**The next Sigma1 params major.** Do it as part of that work, not as its own task — on its own
it would force a retune whose only product is a deletion.

## Files the deletion must touch

| File | What changes |
|---|---|
| `packages/core/algorithms/sigma1/swing.ts` | delete the module (and `swing.test.ts`) |
| `packages/core/algorithms/sigma1/index.ts` | drop the fold call and the published `spread` |
| `packages/core/algorithms/sigma1/params.ts` | drop `swingScale`/`swingHalfLifeMatches`; params major |
| `packages/harness/stateSnapshot.ts` | drop the per-team swing accumulators; shape bump 7 → 8 |
| `packages/harness/searchSpace.ts` | drop both `SEARCH_EXCLUSIONS` entries (nothing left to exclude) |
| `packages/harness/legacyParams.ts` | new migration dropping the two fields from older sets |
| `packages/harness/promote.ts` | whatever reads the two fields off a promoted set |

## One thing to preserve when deleting

`swing.ts`'s header carries the **measurement evidence** for both constants — the half-life
swept walk-forward over 275,172 team-matches, and the non-circular scale regression over 86,844
alliance-observations, including the record of the FIRST attempt that was circular and returned
~1.0. `apps/web/src/lib/swingFactor.ts` cites that file by name as the evidence of record. When
this module is deleted, **move that evidence into the web module's own comment** rather than
letting it die with the file — otherwise the site ships two measured constants with no surviving
account of where they came from, which is exactly the failure the project's own log names.
