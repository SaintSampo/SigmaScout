# SC-3 re-measured under the offseason-inclusive, demo-excluded, DQ-fixed model (2026-08-30)

This is the single narrative home for
`.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md` — the accuracy record's
first re-run since `docs/models/sigma1-tuning-results.md` and `docs/models/opr-baseline-change.md`
were measured. Every figure below traces to one committed file, never to a gitignored `reports/`
path and never to memory: `data/baselines/sc3-offseason-inclusive-2026-08.json`.

## Headline verdict — read this first

**SC-3 still passes, 8/8, under the model that actually ships today.** VPR (renamed Sigma1) beats
both OPR and EPA on holdout Brier and holdout winner accuracy, on both holdout seasons (2025,
2026) — the same structure, the same eight comparisons, `docs/models/opr-baseline-change.md`'s
SC-3 table already establishes.

**But it is not uniform good news, and that is the important part.** 2025 (one of the two holdout
seasons SC-3's verdict depends on) got measurably *worse* for both algorithms that carry state
across matches:

- VPR's 2025 Brier moved from 0.1612 to **0.1617** (worse) and 2025 winner accuracy moved from
  0.7657 to **0.7637** (worse, −0.20 percentage points).
- EPA's 2025 Brier moved from 0.1932 to **0.1941** (worse) and 2025 winner accuracy moved from
  0.7290 to **0.7269** (worse, −0.21 percentage points).

2026, the other holdout season, moved the opposite direction for VPR (Brier 0.1531 → **0.1501**,
better; accuracy 0.7873 → **0.7913**, better, +0.40 points) and was flat-to-slightly-worse for EPA.
OPR — event-scoped by construction, with no state carried across events or seasons — did not move
at all, on any season, to full floating-point precision. Every comparison SC-3 depends on still
clears with a comfortable margin (the tightest, 2025 Brier vs. OPR, is still a 0.0502 gap on a
0-1 scale), so **no comparison flipped**, but 2025's degradation is real, measured, and reported
here rather than averaged away by 2026's improvement.

## What changed, all landing together

Three separate changes to the model's input have shipped since the accuracy record was last
measured, none reflected in `docs/models/` or `data/baselines/` until this re-measurement. This
run picks up all three at once — deliberately, per the sequencing both prior fix's SUMMARYs record,
so the record is re-measured once against the final model rather than three times:

1. **Offseason inclusion** (07-17, PD-02). `buildSeasonStream` now includes offseason and
   preseason matches in the walk-forward replay. Measured directly in this run: **20,055 offseason
   matches** were replayed and excluded from scoring (never contributing a scored prediction),
   summed across 2022-2026 — reproducing the previously-reported figure exactly. These matches
   still feed every algorithm's `update()`, so a team's rating carries whatever an offseason event
   taught the model, even though that offseason event's own predictions are never scored.
2. **Demo-team exclusion** (2026-08-30). `frc9970`-`frc9999` (TBA's own "Off-Season Demo Team"
   entries) no longer receive a rating in any algorithm; 428 fully-demo alliances are dropped as
   non-contests rather than fitted as real robot performance.
3. **Fully-DQ'd zero-score alliance exclusion** (2026-08-30). 158 alliance-observations where an
   entire alliance was disqualified and TBA recorded a `0` are no longer fitted as genuine
   performance (previously, one such match drove `frc4788` to a published `-1354.13`).

**Attribution limits, stated honestly.** These three changes landed together, and this
re-measurement was deliberately run once against their combined effect, not three times against
each in isolation (per `exclude-offseason-demo-teams-SUMMARY.md`'s and
`exclude-whole-alliance-dq-zero-scores-SUMMARY.md`'s own "Follow-on" notes). This document can say
*that* the record moved and *how much*, but cannot cleanly decompose how much of any single
season's movement is attributable to which of the three changes. What CAN be said with confidence:
OPR is untouched by any of the three changes on its own holdout figures — it is event-scoped,
never carries state across an event boundary, and its 2025/2026 figures are bit-identical to the
pre-change baseline — so 100% of OPR's zero movement is explained by its own construction, and
100% of EPA's and VPR's movement is attributable to some combination of the widened stream, the
demo exclusion, and the DQ fix, in a mixture this measurement does not isolate.

## Re-measurement command and provenance

```
tsx --env-file=.env packages/harness/cli.ts --seasons 2022-2026 --algorithm opr,epa,vpr --include-offseason --out reports/offseason-remeasure-2026-08
```

`runTimestamp: 2026-08-30T19:51:06.227Z`, `corpusIdentity: data/corpus.sqlite`,
`artifactSchemaVersion: 3`. Algorithm identities: `opr@3.1.0+baseline`, `epa@1.1.0+baseline`,
`vpr@2.1.0+tuned-2026-08` (`vpr` resolved via `applyPromotedOverrides` to the currently-pinned
promoted version, unchanged params from the original tuning search — no re-tuning happened here).

Same holdout structure the original SC-3 measurement used, preserved exactly: seasons 2022-2026
replayed cross-event, state carried across season boundaries via `carrySeason` (2022 cold-start),
2025 and 2026 held out as the headline comparison seasons, `combined` (qual + elimination)
comp-level view, offseason and surrogate-affected predictions excluded from scoring by
`aggregateScores`'s pre-existing D-06 default (unchanged by `--include-offseason`, which only
widens what is *replayed*, never what is *scored*) — confirmed directly: every season's `scored`
count below is identical to the pre-change baseline's `scoredCount` (14603 / 16290 / 16958 / 17815
/ 18337 for 2022-2026 respectively).

Committed fingerprint: `data/baselines/sc3-offseason-inclusive-2026-08.json` (generated via
`pnpm fingerprint`, i.e. `tsx packages/harness/baselineFingerprint.ts --run-dir
reports/offseason-remeasure-2026-08 --algorithm opr,epa,vpr --seasons 2022-2026 --label
sc3-offseason-inclusive --out data/baselines/sc3-offseason-inclusive-2026-08.json`). Compare
against the pre-change baseline, `data/baselines/opr-event-scoped-2026-08.json` (unmodified,
retained unedited).

## Full head-to-head, old vs. new, all five seasons

Figures rounded to 4 decimal places, as this project's other model docs do; the committed
fingerprint carries full precision. "Old" is `data/baselines/opr-event-scoped-2026-08.json`
(offseason-excluded, pre-demo-exclusion, pre-DQ-fix); "New" is this re-measurement.

**OPR** — bit-identical on every season, confirming OPR's event-scoped design is genuinely
unaffected by anything outside the one event being fit:

| Season | Old Brier / Acc | New Brier / Acc | Moved? |
|---|---|---|---|
| 2022 | 0.1890 / 0.7445 | 0.1890 / 0.7445 | no (bit-identical) |
| 2023 | 0.2171 / 0.7133 | 0.2171 / 0.7133 | no (bit-identical) |
| 2024 | 0.2126 / 0.7060 | 0.2126 / 0.7060 | no (bit-identical) |
| 2025 (holdout) | 0.2119 / 0.7296 | 0.2119 / 0.7296 | no (bit-identical) |
| 2026 (holdout) | 0.2211 / 0.7530 | 0.2211 / 0.7530 | no (bit-identical) |

**EPA:**

| Season | Old Brier / Acc | New Brier / Acc | Brier delta | Accuracy delta |
|---|---|---|---:|---:|
| 2022 | 0.1926 / 0.7387 | 0.1917 / 0.7407 | −0.0009 (better) | +0.0020 (better) |
| 2023 | 0.1985 / 0.7241 | 0.1988 / 0.7244 | +0.0003 (noise) | +0.0003 (noise) |
| 2024 | 0.2160 / 0.6991 | 0.2169 / 0.6998 | +0.0009 (worse) | +0.0007 (better) |
| 2025 (holdout) | 0.1932 / 0.7290 | 0.1941 / 0.7269 | +0.0009 (**worse**) | −0.0021 (**worse**) |
| 2026 (holdout) | 0.1742 / 0.7454 | 0.1740 / 0.7451 | −0.0002 (noise) | −0.0003 (noise) |

**VPR (renamed Sigma1, tuned):**

| Season | Old Brier / Acc | New Brier / Acc | Brier delta | Accuracy delta |
|---|---|---|---:|---:|
| 2022 | 0.1636 / 0.7604 | 0.1592 / 0.7673 | −0.0044 (better) | +0.0069 (better) |
| 2023 | 0.1722 / 0.7415 | 0.1687 / 0.7437 | −0.0035 (better) | +0.0022 (better) |
| 2024 | 0.1765 / 0.7318 | 0.1761 / 0.7338 | −0.0004 (better) | +0.0020 (better) |
| 2025 (holdout) | 0.1612 / 0.7657 | 0.1617 / 0.7637 | +0.0006 (**worse**) | −0.0020 (**worse**) |
| 2026 (holdout) | 0.1531 / 0.7873 | 0.1501 / 0.7913 | −0.0030 (better) | +0.0040 (better) |

The pattern is consistent between EPA and VPR: both tune seasons (2022-2024) mostly improved or
held flat, both algorithms got *worse* on 2025 specifically (on both metrics), and 2026 was
flat-to-better. This is reported as measured — the shape is not smoothed into "on average, no
change."

## SC-3 verdict, re-evaluated

D-02's literal reading, unchanged: tuned VPR must beat **both** OPR and EPA on holdout Brier **and**
holdout winner accuracy, on **both** holdout seasons — eight separate yes/no comparisons.

| # | Season | Comparison | VPR (new) | Baseline (new) | Result | Old margin | New margin |
|---|---|---|---|---|---|---:|---:|
| 1 | 2025 | Brier vs OPR | 0.1617 | 0.2119 | **PASS** (lower is better) | 0.0507 | 0.0502 (narrowed) |
| 2 | 2025 | Accuracy vs OPR | 0.7637 | 0.7296 | **PASS** (higher is better) | 3.61pp | 3.41pp (narrowed) |
| 3 | 2025 | Brier vs EPA | 0.1617 | 0.1941 | **PASS** | 0.0320 | 0.0324 (widened) |
| 4 | 2025 | Accuracy vs EPA | 0.7637 | 0.7269 | **PASS** | 3.67pp | 3.68pp (flat) |
| 5 | 2026 | Brier vs OPR | 0.1501 | 0.2211 | **PASS** | 0.0680 | 0.0710 (widened) |
| 6 | 2026 | Accuracy vs OPR | 0.7913 | 0.7530 | **PASS** | 3.43pp | 3.83pp (widened) |
| 7 | 2026 | Brier vs EPA | 0.1501 | 0.1740 | **PASS** | 0.0211 | 0.0239 (widened) |
| 8 | 2026 | Accuracy vs EPA | 0.7913 | 0.7451 | **PASS** | 4.19pp | 4.62pp (widened) |

**Verdict: SC-3 PASSES — 8/8, under the offseason-inclusive, demo-excluded, DQ-fixed model that
publishes today.** No comparison flipped, and only two of the eight margins narrowed (both 2025
comparisons against OPR) — the rest either widened or held flat. The narrowing is real (a
consequence of 2025's measured VPR degradation above) but nowhere close to threatening the
verdict: even the tightest comparison (2025 Brier vs. OPR) still clears by 0.0502 on a Brier
scale that runs 0 to 1.

## Does this leave SC-3's conclusion — and the Phase 8 Compare page — on solid ground?

**Yes, with one qualification named plainly.** The comparison SigmaScout's core value proposition
rests on (VPR beats both published-convention baselines on both accuracy metrics, on data the
tuning search never saw) still holds under the model that actually ships, not just the model it
was originally tuned against. Nothing here requires re-tuning, re-scoping SC-3, or changing what
the Compare page will show.

The qualification: 2025 is measurably noisier under the wider, offseason-inclusive stream, for
both algorithms that carry state (EPA and VPR alike — the shared direction across two independent
implementations is itself evidence this is a property of the wider input, not an artifact of one
algorithm's own tuning). A widened, noisier training/eval stream was flagged as a plausible source
of degradation before this measurement ran; it materialized, on one of the two holdout seasons,
at a magnitude of a few hundredths of a Brier point and a few tenths of a percentage point of
accuracy — real, but an order of magnitude smaller than the multi-percentage-point margins SC-3's
verdict depends on.

## No re-tuning, no re-scoping, no publishing

Per this task's own constraint: no algorithm parameter was changed in response to any figure
above. `vpr`'s promoted parameters are bit-identical to the pre-existing
`data/algorithm-versions/vpr@2.1.0+tuned-2026-08.json` (a version-string re-pin from an earlier,
unrelated code-version bump, not a re-tune — see `exclude-whole-alliance-dq-zero-scores-SUMMARY.md`).
No artifact was published to R2; this is a measurement against the already-ingested local corpus,
read-only.

## Files

- `data/baselines/sc3-offseason-inclusive-2026-08.json` (new) — the committed fingerprint every
  figure in this document traces to.
- `data/baselines/opr-event-scoped-2026-08.json` (unmodified) — the "old" column throughout, the
  pre-existing frozen record this document compares against, never edited.

---
*Generated: 2026-08-30, from `reports/offseason-remeasure-2026-08/artifact.json`
(`tsx --env-file=.env packages/harness/cli.ts --seasons 2022-2026 --algorithm opr,epa,vpr
--include-offseason --out reports/offseason-remeasure-2026-08`,
`runTimestamp: 2026-08-30T19:51:06.227Z`), resolving
`.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md`.*
