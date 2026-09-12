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

---

## DECIDED 2026-09-12 by Jacob (D3) — OPR and EPA stop drawing a match band entirely

**This is a decision record, not an implementation. No source file was changed when it was
written.** Whoever implements it does so as its own task. Recorded here because this todo was one of
three blocked on the same open question.

### The decision

The question was whether OPR and EPA's consistency estimator should be **extended to Sigma Score**,
**recalibrated per algorithm** against the shared `SWING_FACTOR_SCALE = 1.92`, or **dropped**.

**Dropped.** OPR and EPA stop drawing a match band. Their consistency figure was already
deliberately stripped on 2026-09-10; a band that is ~1.8x too wide and contains the result 88–91%
of the time, on a site whose methodology page publishes *"Sigma lands at 67.0%"*
(`sigmaContent.ts:213`), is worse than no band at all.

### Why it matters to this file

This todo's stated trigger is **"the next Sigma1 params major"**, and that trigger has become
unreachable on its own terms: VPR is retired, so no Sigma1 params major is going to happen, and a
todo that can only fire on an event that will never occur is a todo that never fires. That is a
separate problem from D3 and it is **not** solved by this decision — it is noted so the next reader
does not mistake a recorded decision for a cleared path.

What D3 does change here is the **surviving justification for keeping `sigma1/swing.ts` around as a
reference.** One reason not to delete it was that its two measured constants — the walk-forward
half-life sweep over 275,172 team-matches, and the non-circular scale regression over 86,844
alliance-observations that produced 1.92 — still described a construction the site drew for OPR and
EPA. After D3 they describe nothing the site draws for those two algorithms.

**That makes the "One thing to preserve when deleting" section MORE urgent, not less.** Read it
together with two corrections:

1. `swing-score-audit`'s **F8** records that this file's evidence-preservation clause points at
   `apps/web/src/lib/swingFactor.ts`, **which no longer exists** — the browser module was reverted
   when Swing became a published metric (260909-tgf). The evidence has no surviving destination
   named anywhere. That is exactly how measured constants lose their provenance, which is the
   failure this clause was written to prevent, happening to the clause itself.
2. The live constant is `SWING_FACTOR_SCALE = 1.92` in `packages/harness/swingFactor.ts:149`, whose
   own header carries the measurement (and the record of the first, circular attempt that returned
   ~1.0). **Re-point the preservation clause there**, or at whatever module survives, before anyone
   deletes `sigma1/swing.ts`.

### What this decision does NOT say

It does not say to delete anything here now, it does not create a trigger, and it says nothing about
D6 (whether `swing.ts` goes alone or all of `packages/core/algorithms/sigma1/` goes at once). D6 is
still open.
