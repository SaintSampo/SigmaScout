---
quick_id: 260908-5wd
status: complete
date: 2026-09-08
commits:
  - ad8a74a3 feat(260908-5wd) browser-computed Swing Factor wired onto the team page
  - 576c3e15 feat(260908-5wd) ribbon toggle gates every Swing Factor site-wide
  - 307670ce docs(260908-5wd) tell the Swing Factor story and record the deferred core deletion
  - 0c937d77 fix(260908-5wd) bound the Swing Factor window instead of skipping it
---

> **Read this first.** The feature as first committed was **invisible in production** — the
> defect and its fix are in "The defect the tests could not see" below, and the live
> verification that caught it is in "Verification". A second finding, about what the number
> MEANS for a weak model, is left as an open decision at the bottom.

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

## The defect the tests could not see

The first two commits shipped a feature that **did nothing on the real site**. Every unit test
passed; OPR and EPA still showed a bare number.

The merge was gated to run only when `metricsOverride` was absent. On live 2026 data a real
team's header almost always DOES resolve an as-of-last-official-match snapshot, so the gate was
always closed and the estimator never ran. The fixtures all exercised the season-final path, so
nothing in the suite could notice. It was caught only by starting the dev server against live
artifacts and reading the actual tiles.

The original reasoning behind the gate was sound — a whole-season `±` must not sit beside an
as-of-then value, which is the two-as-of-instants defect IN-01 already names on this component.
Skipping was simply the wrong remedy. `swingFactorForTeam` now takes an optional
`untilMatchKey` and folds only matches up to and including it, so the spread and the value
beside it describe the same span. A bound that never appears returns `undefined` rather than
quietly measuring a different span. `officialSnapshotRow` exposes the row the snapshot came
from; `officialSnapshotMetrics` delegates to it and keeps its exact prior meaning.

**Lesson worth keeping:** a feature whose visibility depends on a runtime gate cannot be
verified by unit tests that construct their own inputs. This one needed the real artifacts.

## Verification

Run against **live R2 artifacts** through the local proxy (`VITE_ARTIFACT_ORIGIN` = the dev
server's own origin), team 254 / 2026, driven with Playwright:

| check | result |
|---|---|
| VPR Total (published spread, must not change) | `330.75 ± 55.71` — unchanged |
| OPR Total (browser-computed, was bare) | `322.42 ± 298.92` — see open decision |
| EPA Total (browser-computed, was bare) | `328.58 ± 58.04` |
| toggle off | 24 spreads → 0, `aria-pressed` false, label flips |
| persistence | still 0 after reload |
| gating is site-wide | Teams page and EPA team page both 0 |
| toggle back on | restored to 24 |
| ribbon height | 68px desktop / 120px phone-390, no horizontal overflow |
| phone-390 | toggle present and visible |

- The task's seven test files: **97 passed**. Full `apps/web` suite after the fix: **1589
  passed across 98 files**.
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

## Still open — two decisions for the developer

**1. A weak model's Swing Factor is mostly the model's error, not the robot's swing.**
Measured on live 2026 data for team 254, same robot and same matches:

| algorithm | Swing Factor |
|---|---|
| VPR (published) | ± 55.71 |
| EPA (browser) | ± 58.04 |
| **OPR (browser)** | **± 298.92** |

The OPR figure is arithmetically correct and is not a bug. 254's four most recent matches are
Einstein, where OPR under-predicts by +239, +209, +256 and +233 points per robot — a
systematic, same-signed bias that the 6-match half-life then weights most heavily of all.

But it does not mean what the other two mean. `swing.ts` is explicit that Y is meant to be the
robot's own match-to-match swing, and concedes a residual also carries mean-model error. For VPR
and EPA that term is small and roughly centred; for OPR at the top of the field it is neither.
Rendered on the page it reads `322.42 ± 298.92`, which looks alarming and arguably overstates
what is known.

**Not silently corrected**, and the temptation is worth naming: subtracting a running mean
deviation would remove the bias and make OPR look reasonable — but `swing.ts` forbids exactly
that on measured grounds (residuals are already centred by construction; subtracting a
sampling-error mean biases Y downward). That reasoning holds for VPR and does not hold for OPR.
Resolving the asymmetry is a decision about what the published number means, so it is recorded
in `swingFactor.ts` with the measurement rather than settled here. Options: ship as is and let
the guide explain it; restrict the browser value to models whose residuals are roughly centred;
or centre the deviations for the browser estimator only.

**2. Match-prediction bands are still drawn when the toggle is off.** Deliberate — they show a
match's own full predictive variance, a different quantity, and the `uncertainty-display.md`
rule forbids drawing a band from partial variance. But it is visible: with the toggle off, a
match row still reads `42 ± 95` while every team tile has gone bare. A reader who just pressed
"Hide Swing Factor (±)" may read that as a bug. Say the word and the toggle can gate them too.

The blocking human-verify checkpoint's remaining manual steps (a human's eyes on the live site)
have effectively been run via Playwright above, apart from subjective judgement of the result.
