---
quick_id: 260902-pbc
slug: drop-unpublished-match-components
date: 2026-09-02
status: complete
tasks_completed: 1
source: payload-budget attribution, 2026-09-02
---

# Summary — stop publishing per-match alliance components nothing reads

## Commits

| SHA | What a user would have seen |
|---|---|
| `f139d03c` | Nothing today — no page renders these fields, and nothing already in R2 is touched. Once the later republish lands, the worst team page drops 675,956 → 378,843 B (**−44.0%**) and the event artifact the Worker rewrites every minute during a live event nearly halves (**−47.6%**). |

## Why this was safe to remove

`redComponents`/`blueComponents` were published on every match of the team and
event artifacts. A repo-wide grep over `apps/web/src` finds them in three test
files only — throwaway mock fixtures, never asserted on, never rendered. No
route, component or hook reads them.

The case is that **nothing consumes them**, not that they are redundant: measured
across 468 alliance-component blocks on three teams and two seasons, 93.8% are
fully distinct and 0% identical. They are real, differentiated model output —
just output no page asks for.

## Scope boundary held

The **model** still computes and returns per-component predictions —
`packages/core/algorithms/**` has a zero-byte diff, verified. Only the published
page artifacts stopped carrying them. Removing them from the model would change
predictions; removing them from the artifact cannot. The internal, never-published
scoring sidecar (`predictions.ts`'s `PredictionRecordSchema`) also keeps them.

## Decisions

- **`PAGE_ARTIFACT_SCHEMA_VERSION` not bumped**, following the codebase's own
  precedent rather than a new rule: D-02 (plan 07-06) redefined
  `TeamMetric.spread`'s *meaning* under the same field name — a strictly riskier
  change, since a stale reader could misinterpret a value — and did not bump it
  either. Here there is no reader to mislead.
- **A fourth copy of the helper was found and fixed.** `scripts/replayRig.ts` —
  the 04-07 offline/online equivalence rig — carried its own `roundComponentsLocal`
  building a comparison row that still included the fields. Left alone, its
  deep-diff would have reported a spurious mismatch against the field-free Worker
  output the next time anyone ran it. Not in the plan's file list; caught by
  actually running down the rig the plan asked about.

## Backwards compatibility — verified, not assumed

Production still serves artifacts **with** these fields and will until the
republish, so a deploy landing first must tolerate both shapes.

- Neither `TeamSeasonArtifactSchema` nor `EventArtifactSchema` uses
  `.strict()`/`.strictObject()` — confirmed by grep against the file. Zod strips
  unlisted keys rather than rejecting them, so a live pre-removal artifact parses
  clean against the new schema. The executor also proved this empirically by
  running the real `frc3538/2024` artifact through `safeParse`.
- `apps/web` imports `TeamSeasonArtifactSchema` from
  `packages/harness/pageArtifacts.js` — **the same file**, not a mirrored copy —
  so client/server schema drift is impossible by construction.

## Verification

- Full repo suite from the root: **166 of 167 files pass, 2,882 tests pass**, with
  exactly 2 failures — the pre-existing `payloadBudget.test.ts` over-budget cases,
  which read `docs/publish-budget.md` and can only clear after the republish
  re-measures it. That file was not edited and `publish:seasons` was not run.
- `tsc --noEmit` clean for `packages/**`/`scripts/**` and `apps/web`.
  `apps/worker` has 4 pre-existing errors (missing `redDqs`/`blueDqs` on fixtures,
  a `Sigma1Params` mismatch) on lines this change never touched — left alone.
- Saving proven on real data rather than restated: the live artifact fetched,
  fields stripped programmatically, 675,956 → 378,843 B.

**Note on test scope:** this task was verified with `npx vitest run` from the repo
root (167 files), not `cd apps/web && npx vitest run` (77 files). The narrower
command is what let the payload-budget failures sit unnoticed for a week.
