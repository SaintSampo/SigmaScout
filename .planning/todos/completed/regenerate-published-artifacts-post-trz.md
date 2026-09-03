---
status: resolved
resolved: 2026-09-03
resolved_by: "publish:seasons generation aebc5638-7892-41e3-b918-121a74c9a778"
id: regenerate-published-artifacts-post-trz
created: 2026-09-01
source: quick task 260901-trz (D-T1/D-T2) — supersedes regenerate-published-artifacts-post-is2
resolves_phase:
priority: high
---

# Regenerate published R2 artifacts — post-`260901-trz` (SUPERSEDES the post-is2 todo)

## Relationship to `regenerate-published-artifacts-post-is2.md`

**This todo supersedes it.** That one is still accurate about *what* needs regenerating and
*how*; it is now understated about *how far behind* the published data is. Do them as one
job, following the post-is2 todo's own procedure, and close both together.

## What changed since that todo was written

| algorithm | published (R2, live site) | committed now | drift |
|---|---|---|---|
| `epa` | pre-is2 (`1.1.0+baseline`) | `2.0.0+baseline` | 1 major |
| `opr` | pre-is2 (`3.1.0+baseline`) | `4.0.0+baseline` | 1 major |
| `vpr` (`SIGMA1_CODE_VERSION`) | pre-is2 (`2.1.0+tuned-2026-08`) | **`4.0.0+tuned-2026-08`** | **2 majors** |

`vpr` moved twice: `2.1.0 → 3.0.0` (quick task 260901-is2, D-Q2 — R estimated from
innovations) and `3.0.0 → 4.0.0` (this task, D-T1/D-T2 — five hyperparameters became
dimensionless fractions of the season's alliance-score variance, and the two carry weights
merged into one share). Both bumps moved `update()`'s AND `teamMetrics`'s observable output,
so every `X ± Y` on every team page is affected.

The `vpr@3.0.0+*.json` files are gone, retired and re-promoted as `vpr@4.0.0+tracer-check.json`
and `vpr@4.0.0+tuned-2026-08.json` in the same commit as the code that produced them.

## Until this runs, the live site serves the PRE-IS2 model

This is the reason the regression D-T1 fixes was never user-visible, and it is also why
there is no urgency to republish twice:

> `vpr@3.0.0` fixed the published `±` but, as a side effect, degraded predicted SCORES
> (2025 MAE 19.75 → 21.14; 2026 MAE 50.56 → 58.53). It shipped invisibly because Brier and
> SD(z) both rated it equal-or-better.

That regression is real in the committed code and **already substantially recovered** by
this task's reparameterization — measured, in `docs/models/sigma1-reparameterization.md`:
2026 MAE 58.53 → 53.14, 2025 MAE 21.14 → 20.59, with 2026 bias magnitude falling 25.89 →
13.89. But it is not fully recovered, and the rolling-origin re-tune is what closes the
rest.

## Ordering: WAIT FOR THE RE-TUNE

**Do not republish before
`.planning/todos/pending/retune-sigma1-rolling-origin.md` completes.** Every currently
promoted Sigma1 parameter bar `covShrinkage` and `linkC` was selected under the retired
absolute parameterization and is stale; republishing now would push a knowingly-stale
parameter set to R2 and then need doing again within the week. Republishing twice is wasted
work, and the live site is not currently serving anything worse than it was yesterday.

Sequence: re-tune → promote whatever cleared the D-T7 bar → republish once.

## What "done" looks like

Per the post-is2 todo's own checklist, plus: the algorithms manifest names
`vpr@4.0.0+<whatever the re-tune promoted>`, and the Compare page's accuracy figures are
recomputed under the D-Q3 winner-accuracy denominator so all three algorithms sit on one
population.


---

## RESOLVED 2026-09-03

Full republish `aebc5638-7892-41e3-b918-121a74c9a778`: 56,774 objects,
2,226,644,593 bytes total (down from 3,310,309,807, **-32.7%**).

**No ceiling was moved.** Every page kind passes its pre-existing
`budgetMaxBytes` on merit, after the two shrinks that preceded this run:

| page | budget | before | after | margin |
|---|---|---|---|---|
| teams | 3,500,000 | 3,704,776 (over) | **1,435,371** | 2,064,629 under |
| team | 375,000 | 675,956 (over) | **366,310** | 8,690 under |
| event | 350,000 | 342,405 | **160,071** | 189,929 under |

The team page was expected to land at ~378,843 and need a deliberate bump to
400,000. It came in at 366,310 — **under the existing budget** — so the bump was
dropped. Predicting a ceiling change and then not needing it is the right
direction to be wrong in.

Live manifest now serves `opr@4.0.0+baseline`, `epa@2.0.0+baseline`,
`vpr@5.0.0+tuned-2026-08`. Full repo suite: **167/167 files, 2,893 passing** —
green for the first time since 2026-08-26.
