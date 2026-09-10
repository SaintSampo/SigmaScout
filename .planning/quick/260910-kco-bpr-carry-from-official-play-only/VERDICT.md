# 260910-kco — VERDICT: SHIP (deferred to a clean bpr.ts moment)

Measured 2026-09-10, production harness path, design era only (2016-2020,
2022; the holdout was structurally never loaded). One shared stream, both
arms in one `runSeasons` call, `includeOffseason: true`. 197,606 prediction
rows; 82,735 paired official matches; the arms' pRedWin differs on 69,445
of them (boundary effects propagate widely once ratings diverge).

## The pre-registered rule's inputs (RULE.md, committed at 0d9c402d before any number)

| quantity | value |
|---|---|
| paired accuracy delta (candidate − incumbent) | **−0.0145pp** |
| 95% event-blocked percentile interval (911 blocks) | [−0.1130, +0.0789] |
| event-blocked SE | 0.0498pp |
| stop threshold | worse than −0.169pp |
| paired Brier delta | +0.000205 [+0.000072, +0.000350] |

**Rule outcome: SHIP.** The accuracy delta is a statistical zero (CI spans 0)
and sits nowhere near the −0.169pp stop threshold. Per RULE.md §2, a flat
result ships on principle: the sealed research model has never seen an
offseason match (`packages/bpr/data.ts`, `is_offseason = 0`), so
official-play-only carryover narrows production's unvalidated deviation from
the sealed configuration, and matches EPA's 260908-615 behavior.

**Recorded honestly, not gating (RULE.md §3):** the Brier delta is a tiny but
statistically resolved worsening — +0.000205 on a ~0.175 base, 0.12%
relative, CI excluding zero. Interpretation: offseason-seeded priors carry a
sliver of real information the candidate discards; the winner-call cost of
discarding it is indistinguishable from zero.

Per-season accuracy (candidate vs incumbent): 2016 identical (cold start, no
boundary), 2017 −0.007pp, 2018 −0.065pp, 2019 +0.045pp, 2020 −0.282pp,
2022 +0.035pp — small and sign-mixed, as a boundary-only change predicts.

## Why the ship is deferred, and what the ship is

At verdict time, `packages/core/algorithms/bpr.ts` carries ANOTHER session's
uncommitted work (the 260910-25c/2pt display-variance calibration, which has
already claimed the 1.0.0 → 2.0.0 version bump). Editing the file now would
tangle two changes in the shared checkout. The measurement above is
unaffected: that work is display-only (winner calls pinned bit-identical by
its own test), and both arms shared the same working tree.

The ship, once bpr.ts is clean:
1. Add `carryFrom: "last-official-match"` to the module literal, with a dated
   header note citing this task and EPA's 260908-615 precedent.
2. Fold into whichever code-version bump lands next (the calibration's 2.0.0
   if uncommitted at ship time, else the next bump) — a carry-behavior change
   moves published values at season boundaries, so it must not hide inside an
   unchanged version string.
3. The next full republish makes it live; the orphaned prior bpr generation
   then gets its own recorded delete pass.
4. No sealedPaths.ts edit needed: `assertSealed` requires clean-at-HEAD and
   self-documents blob shas; future holdout runs will print the new sha.
