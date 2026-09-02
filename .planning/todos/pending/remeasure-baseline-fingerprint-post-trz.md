---
id: remeasure-baseline-fingerprint-post-trz
created: 2026-09-01
source: quick task 260901-trz Task 7 — supersedes remeasure-baseline-fingerprint-post-is2
resolves_phase:
priority: medium
---

# Re-measure the offseason-inclusive baseline fingerprint — post-`260901-trz`

## Relationship to `remeasure-baseline-fingerprint-post-is2.md`

**This supersedes it.** That todo is still correct about the procedure; it is now one
version behind for `vpr`. A single re-measurement closes both, so do them as one job and
close both together.

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
