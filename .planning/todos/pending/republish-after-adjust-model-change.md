---
id: republish-after-adjust-model-change
created: 2026-09-04
source: quick task 260904-6a1 (D-8) — deliberately deferred, not performed by that task
resolves_phase:
priority: medium
---

# Re-measure and republish after the adjust-zeroed-alliance / adjust-pinning model change

## What changed (quick task 260904-6a1)

Two model-correctness changes landed in both EPA and Sigma1, discovered investigating
`2026bc2_sf14m1` (BattleCry June SF14-1: a genuine ~456-point alliance zeroed to 0 by a
scorekeeper's `adjustPoints: -456`, with **no DQ flags at all**):

1. `isAdjustZeroedAlliance` (`packages/core/algorithms/dq.ts`) — a sibling to
   `isFullyDqZeroScoreAlliance` — drops an alliance's own observation when its recorded score
   is exactly 0 and its PARSED `adjust` value is negative, even when no DQ was filed. Measured
   population: 13 alliance-sides (2019-2026) carry a score-zeroed, empty-DQ, negative parsed
   `adjustPoints` not already caught by the whole-alliance-DQ predicate.
2. `adjust` is now PINNED at exactly `0` for every team, in every match, in both algorithms —
   never folded, never carried across a season boundary, excluded from every cold-start and
   carried-share divisor. `adjust` is a scorekeeper's ruling applied to an alliance total, not
   a quantity any robot produces.

Both algorithm versions bumped MAJOR (`epa.ts` `3.0.0+baseline -> 4.0.0+baseline`,
`SIGMA1_CODE_VERSION` `7.0.0 -> 8.0.0`), and all three committed `data/algorithm-versions/*.json`
files were re-promoted under the new code — but **nothing published to R2 was touched**. This
todo is that deliberately-deferred follow-up (D-8), named as four separate items.

## Item 1 — re-measure the baseline fingerprint

`data/baselines/*.json`'s SC-3 fingerprints (`sc3-offseason-inclusive-2026-08.json`,
`sc3-rolling-origin-2026-09.json`) and the event-scoped fingerprint
(`opr-event-scoped-2026-08.json`) all describe accuracy/Brier measurements taken under the
OLD model (adjust folded as real per-team performance, whole-alliance DQ the only ruling-zero
exclusion). They are frozen historical records per this project's own "do not rewrite, add
alongside" convention (`packages/harness/baselineFingerprint.test.ts`'s header) — do NOT edit
them. Add a NEW fingerprint file measured under `epa@4.0.0+baseline` / `vpr@8.0.0+*`, and a new
test block in `baselineFingerprint.test.ts` alongside the existing ones (matching that file's own
"the fingerprint count only ever goes up" discipline).

## Item 2 — re-run the EPA-vs-Statbotics comparison

`npx tsx scripts/epaVsStatbotics.ts --check` gates the current EPA replay against
`data/baselines/epa-vs-statbotics-2026-09.json`. That baseline was measured under
`epa@3.0.0+baseline` (pre-this-task); re-run the script to produce fresh figures under
`epa@4.0.0+baseline`, refresh `docs/models/epa-vs-statbotics.md` with the new numbers (its
historical narrative sentences describing what a PAST version produced stay as written — only
the "current verdict" section needs the new measurement), and update the checked-in baseline
JSON if the script's own convention calls for a new dated file rather than an in-place edit
(follow whatever `epaVsStatbotics.ts`'s own header says; do not guess).

## Item 3 — republish artifacts

Run `pnpm publish:seasons` (`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026
--include-offseason`) to push R2 artifacts built from the new model. **The publish-budget summary
this command prints is NOT written to `docs/publish-budget.md` automatically** — it must be
transcribed by hand into that file's dated log, in the same format every prior entry uses, or
`docs/publish-budget.md`'s own budget tests stay red against a doc that never recorded the run
that changed the numbers (see the project memory note: "publish-budget is a manual step").

## Item 4 — ordering constraint with the pending re-tune

`.planning/todos/pending/retune-sigma1-rolling-origin.md` is a separate, independent job that
also touches `data/algorithm-versions/vpr@*` and needs its own republish. Its own header now
records (as of this task) that Sigma1's model changed 2026-09-04 and that the ten already-run
verdicts are non-comparable to a future re-tune under the new model — but it does NOT require
this republish to happen first, and this republish does NOT require the re-tune to happen first;
they are independent. **What DOES matter**: if the re-tune runs and promotes a NEW parameter set
before this republish happens, do this republish AFTER that promotion lands, once, rather than
publishing twice — the same "one authorized republish per phase" discipline
`republish-playoff-bonus-arrays.md` (completed) already names as the reason to batch rather than
multiply republish runs.

## Related

- `packages/core/algorithms/dq.ts`, `epa.ts`, `sigma1/index.ts` (this task's changes)
- `.planning/todos/pending/retune-sigma1-rolling-origin.md` (Item 4's ordering constraint)
- `packages/harness/baselineFingerprint.test.ts` (Item 1's frozen-history convention)
- `docs/publish-budget.md` (Item 3's manual-transcription requirement)
