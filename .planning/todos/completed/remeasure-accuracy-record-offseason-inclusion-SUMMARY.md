---
todo: remeasure-accuracy-record-offseason-inclusion
resolves: .planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md
phase: none (standalone re-measurement, routed forward from 07-17/07-19 and the two 2026-08-30 exclusion fixes)
completed: 2026-08-30
status: complete
commits:
  - d60f7aa8 (docs: re-measure SC-3 accuracy record under offseason-inclusive model)
---

# Re-measure the accuracy record under offseason inclusion — Summary

**SC-3 still PASSES 8/8 under the model that actually ships today. 2025 (one of the two holdout
seasons the verdict depends on) is measurably worse for both EPA and VPR under the wider, noisier
stream; 2026 is flat-to-better. OPR is bit-identical on every season. No comparison flipped, no
parameter was re-tuned, nothing was published to R2.**

## Verdict on the four SC-3 comparisons — lead with this

All eight comparisons (VPR vs. OPR and vs. EPA, on both holdout Brier and holdout winner accuracy,
on both 2025 and 2026) still **PASS**:

| # | Season | Comparison | Result | Margin moved |
|---|---|---|---|---|
| 1 | 2025 | Brier vs OPR | **PASS** | narrowed 0.0507 → 0.0502 |
| 2 | 2025 | Accuracy vs OPR | **PASS** | narrowed 3.61pp → 3.41pp |
| 3 | 2025 | Brier vs EPA | **PASS** | widened 0.0320 → 0.0324 |
| 4 | 2025 | Accuracy vs EPA | **PASS** | flat 3.67pp → 3.68pp |
| 5 | 2026 | Brier vs OPR | **PASS** | widened 0.0680 → 0.0710 |
| 6 | 2026 | Accuracy vs OPR | **PASS** | widened 3.43pp → 3.83pp |
| 7 | 2026 | Brier vs EPA | **PASS** | widened 0.0211 → 0.0239 |
| 8 | 2026 | Accuracy vs EPA | **PASS** | widened 4.19pp → 4.62pp |

Nothing flipped, and even the tightest comparison (2025 Brier vs. OPR) still clears by 0.0502 on a
0-1 Brier scale. **SigmaScout's core-value claim — measurably better than the published-convention
baselines, on holdout the tuning search never saw — still rests on solid ground**, including for
the Compare page Phase 8 will build against these same figures.

## The bad news, stated plainly, not buried

**2025 got worse for both algorithms that carry state across matches.** This is the one finding
this task exists to surface, and it does not disappear into the overall PASS:

- VPR (renamed Sigma1): 2025 Brier 0.1612 → **0.1617** (worse); 2025 winner accuracy 0.7657 →
  **0.7637** (worse, −0.20 percentage points).
- EPA: 2025 Brier 0.1932 → **0.1941** (worse); 2025 winner accuracy 0.7290 → **0.7269** (worse,
  −0.21 percentage points).

2026 moved the opposite way for VPR (Brier 0.1531 → **0.1501**, better; accuracy 0.7873 →
**0.7913**, better, +0.40pp) and was flat-to-slightly-worse for EPA (Brier −0.0002, accuracy
−0.0003 — noise-scale). OPR did not move at all, on any of the five seasons, to full
floating-point precision — direct confirmation that its event-scoped design carries no state
across an event boundary and is therefore mechanically incapable of being affected by anything in
a *different* event's stream, offseason or otherwise.

A widened, noisier stream was named in the source todo as "a plausible source of some
degradation" before this measurement ran. It materialized, on one of the two holdout seasons, in
both independent algorithms that carry state — consistent direction across two different
implementations is itself evidence this is a property of the wider input, not one algorithm's own
quirk. The magnitude (hundredths of a Brier point, tenths of a percentage point) is real but an
order of magnitude smaller than the multi-percentage-point margins SC-3's verdict actually depends
on, which is why no comparison flipped.

## What was measured and how (original holdout structure preserved)

```
tsx --env-file=.env packages/harness/cli.ts --seasons 2022-2026 --algorithm opr,epa,vpr --include-offseason --out reports/offseason-remeasure-2026-08
```

Same structure the original SC-3 measurement used: 2022-2026 replayed cross-event, state carried
across season boundaries (`carrySeason`, 2022 cold-start), 2025/2026 held out as the headline
comparison seasons, `combined` comp-level view. `--include-offseason` widens what is *replayed*
(feeding every algorithm's `update()`) but never what is *scored* — `aggregateScores`'s pre-existing
D-06 default still excludes every offseason prediction from Brier/accuracy — confirmed directly:
every season's scored count in the new run (14603 / 16290 / 16958 / 17815 / 18337 for 2022-2026)
is identical to the pre-change baseline's `scoredCount`. Summed offseason-exclusion count across
the five seasons: **20,055** — reproducing the previously-reported corpus-wide figure exactly, an
independent confirmation this run replayed the same widened stream 07-17 measured.

`runTimestamp: 2026-08-30T19:51:06.227Z`, algorithm identities `opr@3.1.0+baseline`,
`epa@1.1.0+baseline`, `vpr@2.1.0+tuned-2026-08` (unchanged, pre-existing promoted params — no
re-tuning happened in this session).

## What changed since the record was last measured (all three, landed together)

1. **Offseason inclusion** (07-17, PD-02) — 20,055 additional played matches now enter the replay.
2. **Demo-team exclusion** (2026-08-30) — `frc9970`-`frc9999` no longer receive a rating; 428
   fully-demo alliances dropped as non-contests.
3. **Fully-DQ'd zero-score alliance exclusion** (2026-08-30) — 158 alliance-observations where a
   whole alliance was disqualified and scored 0 are no longer fitted as real performance.

**Attribution limit, stated honestly.** This re-measurement deliberately ran once against the
combined effect of all three (per both prior fixes' own "Follow-on" sequencing notes, to avoid
re-measuring three times). It can say *that* the record moved and *by how much*, but cannot
cleanly decompose which change caused which season's movement — except for OPR, whose zero
movement is fully explained by its own event-scoped construction independent of all three changes.

## Where the new figures live (published beside, never over, the existing record)

- **New narrative doc:** `docs/models/offseason-inclusion-remeasurement.md` — full old-vs-new
  tables for all three algorithms across all five seasons, the re-evaluated SC-3 verdict table
  with margin deltas, and the attribution-limits discussion in full.
- **New committed fingerprint:** `data/baselines/sc3-offseason-inclusive-2026-08.json` (generated
  via `pnpm fingerprint`) — every figure in the new doc traces to this file, never to a gitignored
  `reports/` path or to memory.
- **Forward-pointer notes added, tables left unedited:** `docs/models/sigma1-tuning-results.md`
  (intro + footer) and `docs/models/opr-baseline-change.md` (before its "Current verdict" section
  + footer) each gained a short dated note pointing to the new doc. Not one existing table, figure,
  or verdict row in either document was changed.
- **`docs/publish-budget.md`**: the 2026-08-28 "Latest run" entry that first named this divergence
  as "a standing finding routed forward, not resolved here" now has a one-line "Resolved
  2026-08-30" pointer appended, with the original entry text otherwise untouched.

## A pre-existing test this task's own acceptance criteria required updating

`packages/harness/baselineFingerprint.test.ts` hard-coded "`data/baselines/` contains exactly 3
committed fingerprints" as a tripwire against accidental extra files, and a second test assumed
every non-event-scoped file in that directory was a retired `opr@2.0.0+baseline` run. Adding the
new, legitimate fourth fingerprint (exactly what this task's acceptance criteria require) tripped
both. Updated: the count assertion now expects 4 and names both known files explicitly; the
retired-implementation loop now excludes the new file by name (it correctly carries
`opr@3.1.0+baseline`, the current code version, not the retired `2.0.0`); and one new test pins the
new fingerprint's shape (`opr`/`epa`/`vpr` only, at their current post-fix versions) so a future
accidental algorithm-list or version drift is caught the same way. This is a test-expectation
update caused directly by this task's own required output, not a Rule 4 architectural change or a
work-around of an unrelated failure.

## Test baseline

Before this session (per the task's own stated baseline): 2091 passed / 2 failed (accepted,
ledgered `payloadBudget.test.ts` pair) / 1 skipped. After: **2092 passed / 2 failed (same two,
same reason, unchanged) / 1 skipped** — +1 net test (the new fingerprint-shape assertion above),
zero regressions. `tsc --noEmit` clean.

## Secrets boundary

No `.env` value was ever rendered to any output stream, log, command, or file in this session.
`tsx --env-file=.env packages/harness/cli.ts ...` read `.env` itself; `pnpm fingerprint` and the
test/typecheck runs touched no secret at all (read-only corpus access, no network calls).

## Process hygiene

`tasklist` confirmed the documented 12-process `node.exe` baseline before AND after every
long-running step (the harness run, both `vitest run` invocations) — no stray zombie processes,
no repeat of 07-17's known Windows/Git-Bash timeout hazard. The harness run and both test runs were
launched via the background-task mechanism and waited out to real completion (artifact-file
existence / task-notification), never judged by a `timeout <n>` wrapper's exit code.

## No re-tuning, no re-scoping, no publishing (constraint check)

- No algorithm parameter changed. `vpr@2.1.0+tuned-2026-08`'s params are bit-identical to what was
  already committed before this session.
- No artifact published to R2 — this is a read-only measurement against the local corpus
  (`data/corpus.sqlite`), no network access.
- No existing committed figure, table, or fingerprint was edited or deleted. Every change is
  additive (new file) or a short forward-pointer note appended beside untouched historical content.

## Files touched

- `docs/models/offseason-inclusion-remeasurement.md` (new) — the primary narrative home for this
  re-measurement.
- `data/baselines/sc3-offseason-inclusive-2026-08.json` (new) — the committed fingerprint.
- `docs/models/sigma1-tuning-results.md`, `docs/models/opr-baseline-change.md` — forward-pointer
  notes only, no table/figure edited.
- `docs/publish-budget.md` — one-line "Resolved 2026-08-30" pointer appended to the entry that
  first named this divergence.
- `packages/harness/baselineFingerprint.test.ts` — file-count and shape assertions updated for the
  new, legitimately-added fourth committed fingerprint.

## Follow-on

None required — this todo's acceptance criteria are fully met and no comparison flipped. A future
re-tune of VPR's hyperparameters against this now-wider stream is not indicated by anything
measured here (the search's own tune-season data, 2022-2024, mostly improved or held flat), but
remains an open, unforced option per `sigma1-tuning-results.md`'s pre-existing `## Open Items`.
