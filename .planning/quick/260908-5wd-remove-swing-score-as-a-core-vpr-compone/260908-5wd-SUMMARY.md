---
quick_id: 260908-5wd
status: complete
date: 2026-09-08
commits:
  - ad8a74a3 feat(260908-5wd) browser-computed Swing Factor wired onto the team page
  - 576c3e15 feat(260908-5wd) ribbon toggle gates every Swing Factor site-wide
  - 307670ce docs(260908-5wd) tell the Swing Factor story and record the deferred core deletion
---

# Swing Factor is the site's stat now, not VPR's

The `Y` in `X ± Y` has a name — **Swing Factor** — and it no longer belongs to VPR. The browser
computes it from whichever algorithm's artifact is open, so OPR and EPA carry one where they
previously showed a bare number, and a switch in the ribbon turns every `±` on the site off at
once.

Nothing here required a republish or a retune, and no prediction changed.

## What shipped

**A pure browser estimator** (`apps/web/src/lib/swingFactor.ts`). Same algebra as the core:
a team's per-match deviation is its share of its alliance's residual,
`(actual − predicted) / rosterSize`, folded into a recency-weighted RMS about zero with a
6-match half-life and a 1.92 scale. It reads only fields the artifact already publishes
(`predictedRedScore`/`predictedBlueScore`, `actualRedScore`/`actualBlueScore`,
`redTeams`/`blueTeams`), so it works for any algorithm with no pipeline change. The never-blank
rule carried over intact: one played match yields a real number, and there is no floor and no
minimum-match threshold.

**A published-wins merge** (`withBrowserSwingFactor` in `SeasonHeader.tsx`). The browser value
fills the Total tile's `spread` **only when the artifact published none** — which today means
OPR and EPA and never VPR. This is the load-bearing safety property, not a detail; see below.

**A persisted ribbon toggle** (`stores/displaySettings.ts`, `ribbon/SwingFactorToggle.tsx`).
`MetricValue` — the single `±` primitive every metric surface already routes through — reads
`showSwingFactor` from the store directly, so one edit gates the whole site. Defaults to on,
persists to `localStorage`, present in both the mobile and desktop ribbon branches.

**A rewritten methodology guide**, which no longer presents the `±` as part of what makes VPR
VPR.

## Three things worth knowing

**1. Why the browser value never overwrites VPR's.** The `sketch-findings-sigmascout` skill's
load-bearing rule is *one ± quantity, everywhere*: a team's `spread`, an alliance's combined ±,
and a match band must reconcile by summing squares, and `redScoreVarianceOwn` is schema-defined
as the sum of its three teams' `spread` squares. Had the browser value replaced a published VPR
spread, that identity would break silently and the team page and the Teams table would print
two different Swing Factors for the same team. Published-wins makes that structurally
impossible rather than merely avoided — and it is the removal path for free: when a future
model version stops publishing `spread`, the browser value takes over with no code change.

**2. The core deletion was deferred, deliberately.** `Sigma1ParamsSchema` is a `z.strictObject`,
so dropping `swingScale`/`swingHalfLifeMatches` forces a params major → a new `legacyParams.ts`
migration → a `stateSnapshot.ts` shape bump (7 → 8) that invalidates live worker D1 state → a
migration pass over every promoted set in `data/algorithm-versions/`. All of that rides a retune
and republish, which this task was scoped to avoid. Recorded with its full file list and its
trigger (the next Sigma1 params major) at
`.planning/todos/pending/remove-swing-from-sigma1-core.md`, and noted in `swing.ts`'s header.
That module stays the **measurement of record** for both constants; the todo carries an explicit
instruction to move that evidence into the web module rather than let it die with the file.

**3. The Teams table cannot show this, and that is a data limit.** `TeamsTableRowRawSchema`
carries season aggregates only — no per-match rows — so a browser-computed Swing Factor is
unreachable there without a payload change and a republish. The guide states this plainly rather
than leaving a reader to notice the gap. The event artifact has matches but only for one event,
which is a different (within-event) quantity and was deliberately not built.

## Where the estimator knowingly diverges from the pipeline

The browser includes **elimination matches** alongside qualification matches, and does not
reproduce the pipeline's surrogate handling. Stated rather than tuned away: it does not need to
match, because published-wins means this number is only ever displayed where the pipeline
published nothing to disagree with. If a future change ever shows both for one team, this
divergence becomes a real bug — which is why it is written into `swingFactor.ts`'s own header.

## Verification

- The task's seven test files: **97 passed**.
- Full repo-root `npx vitest run`: **3989 passed, 4 skipped, 1 failed** — the failure is
  `packages/harness/seasonParamSets.test.ts`'s D-4 Leg B gate, already documented as
  intermittent in `.planning/todos/pending/flaky-seasonparamsets-equivalence-gate.md` (1 failure
  in 4 full runs, 0 in 3 isolated). Re-ran it isolated here: passed. This task's only core edit
  is a comment, so it cannot affect a prediction stream.
- `apps/web` typecheck: **clean**.
- Root typecheck: one error in `packages/core/algorithms/bpr.test.ts`, which is **another
  session's in-flight untracked work** (the file appeared mid-run, along with modifications to
  `packages/bpr/model.ts`, `packages/core/algorithms/bpr.ts`, `harness/cli.ts`,
  `harness/publish.ts`). Not from this task; every commit here was staged by explicit path.

## Still open

The blocking human-verify checkpoint has not been run — see the question below.
