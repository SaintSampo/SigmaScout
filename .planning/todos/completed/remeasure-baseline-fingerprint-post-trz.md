---
id: remeasure-baseline-fingerprint-post-trz
created: 2026-09-01
source: quick task 260901-trz Task 7 — supersedes remeasure-baseline-fingerprint-post-is2
resolves_phase:
priority: medium
---

# Re-measure the offseason-inclusive baseline fingerprint — post-`260901-trz`

## Relationship to `remeasure-baseline-fingerprint-post-is2.md`

**This superseded it, and that todo was closed on 2026-09-03** during a backlog review —
it was correct about the procedure but one `vpr` version behind, and a single
re-measurement was always going to close both. This file is now the only open record of
the job. The predecessor survives in the git history and in
`.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/SUMMARY.md`.

## Sequencing — run this AFTER the Sigma1 re-tune, not before

Noted 2026-09-03 (backlog review); it was not recorded anywhere previously.
`retune-sigma1-rolling-origin` promotes a new tuned `vpr` set wherever the D-T7 acceptance
rule accepts one, which bumps the very version this fingerprint records. Measuring first
would produce a fingerprint that goes stale again at the moment the re-tune promotes, so
the measurement would be spent twice. Order: re-tune → promote → republish → re-measure
this fingerprint.

The one case where that order does not bind is a run in which **every** origin returns
`keep-incumbent` — no promotion, no version bump, and this measurement stands. That is a
legitimate completed outcome of the re-tune, not a failure, so do not treat "waiting on the
re-tune" as open-ended.

## What the committed fingerprint records, and how far behind it now is

`data/baselines/`'s offseason-inclusive SC-3 fingerprint was measured on **2026-08-30**,
before quick task `260901-is2`. It records:

| algorithm | fingerprint records | committed now | drift |
|---|---|---|---|
| `opr` | `3.1.0+baseline` | `4.0.0+baseline` | 1 major (D-Q4) |
| `epa` | `1.1.0+baseline` | `2.0.0+baseline` | 1 major (D-Q1) |
| `vpr` | `2.1.0+tuned-2026-08` | **`4.0.0+tuned-2026-08`** | **2 majors** (D-Q2, then D-T1/D-T2) |

Quick task `260901-trz` added the second `vpr` bump: `3.0.0 → 4.0.0`, the scale-relative
parameter reshape, which moves both `update()`'s and `teamMetrics`'s observable output.

Separately, D-Q3 changed the **winner-accuracy denominator for every algorithm** (a no-call
against a decided match now enters the denominator and counts as a miss), so even the
accuracy figures are computed under a different rule than the fingerprint's.

## The rule this job must not break

**DO NOT edit the committed fingerprint or the assertions in
`packages/harness/baselineFingerprint.test.ts` that pin its version strings.** Those record
what a committed historical file contains, and the `predictionStreamSha256` digests in it
were produced by code that no longer exists. Rewriting them to the current version strings
would attach a real digest to code that never produced it — i.e. falsify a measurement
record.

That test file's doc comment already says this in as many words, and quick task 260901-trz
updated its "how far behind" paragraph to name both bumps. Leave the assertions alone.

## What "done" looks like

A **NEW** fingerprint file, measured under `opr@4.0.0+baseline`, `epa@2.0.0+baseline` and
whatever `vpr@4.0.0+*` the rolling-origin re-tune promotes, added **alongside** the existing
one in `data/baselines/`, with its own test block asserting its own versions. The
`data/baselines/` count assertion (currently "exactly 4 committed fingerprints") moves to 5.

## Ordering

Wait for `.planning/todos/pending/retune-sigma1-rolling-origin.md`. Measuring a fingerprint
against a Sigma1 parameter set that is about to be replaced would need doing twice, for the
same reason the republish waits.

---

## CLOSED — 2026-09-04, quick task `260904-4ik` Task 3

`data/baselines/sc3-rolling-origin-2026-09.json` is committed, with its own
version-assertion block in `packages/harness/baselineFingerprint.test.ts` and the
`data/baselines/` count assertion moved from 4 to 5. The existing
`sc3-offseason-inclusive-2026-08.json` and its three pinned version assertions are
byte-unchanged, exactly as "The rule this job must not break" requires — the new
fingerprint was added ALONGSIDE it, never over it.

**Read post-hoc, not re-run.** The expensive half was already done: `reports/rolling-2026-09`
is a complete offseason-inclusive 2022-2026 run (`runTimestamp 2026-09-04T06:20:54.823Z`)
under exactly the three versions this todo asks for. `baselineFingerprint.ts` is a post-hoc
reader by design, so the measurement was read out of that run's `artifact.json` and its five
`predictions-{season}.jsonl` sidecars rather than spending a fresh multi-hour replay.

**The ordering condition was satisfied.** "Wait for `retune-sigma1-rolling-origin`" is met:
the rolling-origin re-tune has already promoted `vpr@7.0.0+rolling-2026-09`, and the
`260904-2i9` arc moved the live pin onto it. So this fingerprint records a version that is
not about to be replaced — the exact failure ("spend the measurement twice") that ordering
existed to prevent.

**Discrepancy, recorded rather than quietly resolved.** The table above predicted the new
`vpr` would be `4.0.0+*`. It is `7.0.0+rolling-2026-09`. Further code-version bumps landed
between this todo being written (2026-09-01) and the measurement (2026-09-04); the `opr` and
`epa` predictions (`4.0.0+baseline`, `2.0.0+baseline`) were exactly right.

**Comparability.** The new fingerprint's per-season `scoredCount`s match the offseason-inclusive
one exactly on all five seasons (2022:14603, 2023:16290, 2024:16958, 2025:17815, 2026:18337),
so the two score the identical match population and any difference between them is
attributable to the version bumps and D-Q3's denominator change, not to a different set of
matches. The new file's `sourceNote` records the run dir, the three versions, the harness
command LABELLED AS RECONSTRUCTED (no planning artifact records the original invocation), and
the three instruments used to verify that quick task `260904-cs1` — which landed ~25 minutes
after the run — did not move its predictions, including the fact that the digest-replay
instrument's committed slice is 2022-only and therefore proves the cold-start season alone.
