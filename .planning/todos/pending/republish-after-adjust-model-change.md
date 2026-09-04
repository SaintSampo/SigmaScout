---
id: republish-after-adjust-model-change
created: 2026-09-04
updated: 2026-09-04 (quick task 260904-5px folded its own EPA changes into this todo rather than
  filing a second, competing one — see "What ALSO changed" below)
source: quick task 260904-6a1 (D-8) — deliberately deferred, not performed by that task
resolves_phase:
priority: medium
---

# Re-measure and republish after the adjust-pinning AND fouls/elimination model changes

**This todo now covers THREE model-correctness changes to EPA, landed by two quick tasks in the
same session, all before any republish happened.** `epa@2.0.0+baseline` is still what R2 serves;
the code has since moved through `3.0.0` (fouls exclusion), `4.0.0` (adjust pinning), to
`5.0.0+baseline` (elimination discount) — see `packages/core/algorithms/epa.ts`'s own stacked
version-bump comments for the full, corrected history of which change landed under which string.
One republish, run once against the FINAL code, closes all three at once — do not republish after
6a1's change alone and then again after 5px's; that would be the "publish twice" mistake Item 4
below already names as the thing to avoid.

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

Both algorithm versions bumped MAJOR (`epa.ts` `3.0.0+baseline -> 4.0.0+baseline` at the time,
`SIGMA1_CODE_VERSION` `7.0.0 -> 8.0.0`), and all three committed `data/algorithm-versions/*.json`
files were re-promoted under the new code — but **nothing published to R2 was touched**. This
todo is that deliberately-deferred follow-up (D-8), named as four separate items.

## What ALSO changed (quick task 260904-5px, D-01/D-05) — EPA only, landed the same session

Two further EPA-only changes, in separate commits, both landing AFTER 6a1's above (so EPA moved
`2.0.0 -> 3.0.0 -> 4.0.0 -> 5.0.0`; VPR/Sigma1 stayed at 6a1's `8.0.0`, untouched by 5px):

1. **D-01 — fouls excluded from the published `total`.** `epa.ts`'s `teamMetrics()` no longer sums
   `foulsCommitted` into `total`, matching Statbotics' own no-foul `epa.total_points`.
   `foulsCommitted` is still published as its own per-team entry; `predict()` and
   `carrySeason()`'s carryover input are untouched (carryover stays fouls-INCLUSIVE, a deliberate
   asymmetry — see `docs/models/epa-divergences.md` §2's third correction). Verified as an
   arithmetic identity: `scripts/epaVsStatbotics.ts --check` passed with
   `data/baselines/epa-vs-statbotics-2026-09.json` byte-identical to the retired `2.0.0`-measured
   file, before anything else changed.
2. **D-05 — Statbotics' elimination discount adopted.** An elimination-match observation now
   blends at `EPA_ELIM_WEIGHT` (1/3) instead of full weight, and the per-team match counter no
   longer advances on an elimination match — closing `docs/models/epa-divergences.md` §1 (now
   retired there with a dated closure note). This is the change that actually moves the prediction
   stream; the baseline was re-measured (not just proven identical) once this landed —
   `data/baselines/epa-vs-statbotics-2026-09.json` and `docs/models/epa-vs-statbotics.md` both
   carry the current `epa@5.0.0+baseline` figures, folding in 6a1's adjust change too, with an
   honest before/after table (movement is small and mixed, not a clean win either way).

## Item 1 — re-measure the baseline fingerprint

`data/baselines/*.json`'s SC-3 fingerprints (`sc3-offseason-inclusive-2026-08.json`,
`sc3-rolling-origin-2026-09.json`) and the event-scoped fingerprint
(`opr-event-scoped-2026-08.json`) all describe accuracy/Brier measurements taken under the
OLD model (adjust folded as real per-team performance, whole-alliance DQ the only ruling-zero
exclusion, full-weight/counted elimination matches). They are frozen historical records per this
project's own "do not rewrite, add alongside" convention
(`packages/harness/baselineFingerprint.test.ts`'s header) — do NOT edit them. Add a NEW fingerprint
file measured under the FINAL code this todo's republish actually ships — `epa@5.0.0+baseline` (not
`4.0.0+baseline`, superseded by quick task 260904-5px's own D-01/D-05 changes before this item was
ever actioned) / `vpr@8.0.0+*` — and a new test block in `baselineFingerprint.test.ts` alongside the
existing ones (matching that file's own "the fingerprint count only ever goes up" discipline).

## Item 2 — re-run the EPA-vs-Statbotics comparison — RESOLVED (quick task 260904-5px, 2026-09-04)

Done, but under `epa@5.0.0+baseline`, not the `4.0.0+baseline` this item originally named — 5px's
own D-05 elimination-discount change landed after this item was filed and made a SECOND
re-measurement necessary anyway, so both changes were folded into one re-measurement rather than
running the comparison twice. `data/baselines/epa-vs-statbotics-2026-09.json` is current
(`algorithmVersion: "epa@5.0.0+baseline"`, `--check` passes), and
`docs/models/epa-vs-statbotics.md` carries the current per-team tables, the re-measured tolerance
bands, a BEFORE (`epa@2.0.0+baseline`)/AFTER (`epa@5.0.0+baseline`) accuracy-and-Brier table, and a
per-season slope-direction table (agreement with Statbotics moved tighter in 3 of 5 seasons,
looser in 2 — small movements, reported as a mixed result rather than a clean win). No further
action needed on this item.

## Item 3 — republish artifacts

Run `pnpm publish:seasons` (`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026
--include-offseason`) to push R2 artifacts built from the new model, THEN `pnpm manifest:algorithms`
(`tsx --env-file=.env scripts/publishAlgorithmsManifest.ts`) to update the algorithms manifest the
browser reads. **This order is load-bearing, not a style preference**: the browser resolves an
artifact's R2 object key from the manifest's advertised version
(`v1/**/epa@{version}.json`-shaped keys) — a manifest that advertises `5.0.0+baseline` while only
`2.0.0+baseline` objects exist in R2 would 404 every EPA page. Artifacts before manifest, always.

**Both halves of what "stale" means here, not just the ratings:** until this republish runs, every
published EPA artifact — every rank, percentile, and alliance total the site serves — is still the
fouls-inclusive, full-weight-elim, un-pinned-adjust `epa@2.0.0+baseline` figure. But the elimination
discount (5px, D-05) moved the PREDICTION stream too, not just the ratings — so every published
match prediction and any accuracy/Brier surface derived from EPA predictions is ALSO pre-5.0.0
until this republish lands, not merely the team ratings 6a1's own change affected.

**The ribbon label needs no second edit for this republish.** `AlgorithmSelect.tsx`'s D-03
version-gated label (quick task 260904-5px) reads the manifest directly and already renders the
honest older version string until this republish updates it — once `manifest:algorithms` runs,
the ribbon will read `EPA Statbotics 5.0` automatically, with no separate UI change required.

**The publish-budget summary this command prints is NOT written to `docs/publish-budget.md`
automatically** — it must be transcribed by hand into that file's dated log, in the same format
every prior entry uses, or `docs/publish-budget.md`'s own budget tests stay red against a doc that
never recorded the run that changed the numbers (see the project memory note: "publish-budget is a
manual step").

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

- `packages/core/algorithms/dq.ts`, `epa.ts`, `sigma1/index.ts` (6a1's changes; `epa.ts` also
  carries 5px's D-01/D-05 changes on top)
- `docs/models/epa-divergences.md` (5px: §1 retired, §2's third correction)
- `docs/models/epa-vs-statbotics.md`, `data/baselines/epa-vs-statbotics-2026-09.json` (5px: Item 2,
  resolved)
- `apps/web/src/components/ribbon/AlgorithmSelect.tsx` (5px: D-03's version-gated ribbon label,
  self-correcting once this republish lands)
- `.planning/todos/pending/retune-sigma1-rolling-origin.md` (Item 4's ordering constraint)
- `packages/harness/baselineFingerprint.test.ts` (Item 1's frozen-history convention)
- `docs/publish-budget.md` (Item 3's manual-transcription requirement)
